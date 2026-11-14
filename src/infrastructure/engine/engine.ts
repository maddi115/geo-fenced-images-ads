// Bridge between the browser and the C++ map engine (engine/src/engine.cpp -> public/engine.wasm).
//
// The browser only lets JavaScript touch the GPU, the network and image decoding, so this file:
//   * picks a GPU backend (WebGPU, or WebGL2 as fallback) that executes C++'s draw commands
//   * runs background worker threads that download tiles and build them with the C++ code
//   * turns images and comment text into pixel buffers for C++ to send to the GPU
//   * forwards mouse / touch / wheel input to C++ (camera logic lives in C++)

import type { Post } from '../../use-cases/posts/post-schemas';
import type { Draft } from '../../use-cases/posts/posts-store';
import type { LatLng } from '../../domain/geo/geo-schemas';
import { ICON, MARKER, PIXEL, ZONE, ZOOM } from '../../config-new/constants';
import type { GfxBackend } from './backends/backend';
import { WebGPUBackend } from './backends/webgpu';
import { WebGL2Backend } from './backends/webgl2';
import { decodeToBitmap } from '../images/jxl';

const FONT_FAMILY = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const TEXT_PX = 14;

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const MAX_TILES_PER_WORKER = 3;

type Exports = {
  memory: WebAssembly.Memory;
  _initialize: () => void;
  engine_alloc: (n: number) => number;
  engine_free: (p: number) => void;
  engine_init: () => void;
  engine_config: (...a: number[]) => void;
  engine_set_view: (lng: number, lat: number, zoom: number) => void;
  engine_get_zoom: () => number;
  engine_screen_to_lnglat: (x: number, y: number, out: number) => void;
  engine_lnglat_to_screen: (lng: number, lat: number, out: number) => void;
  engine_tile_upload: (z: number, x: number, y: number, ptr: number, len: number) => void;
  worker_build_tile: (ptr: number, len: number) => number;
  engine_stat_tiles: () => number;
  engine_cross_streets: (index: number, buf: number, cap: number) => number;
  engine_set_hover_info: (index: number, tex: number, w: number, h: number) => void;
  engine_tile_failed: (z: number, x: number, y: number) => void;
  engine_tex_create: (ptr: number, w: number, h: number) => number;
  engine_tex_delete: (t: number) => void;
  engine_posts_clear: () => void;
  engine_add_pixel: (lng: number, lat: number, label: number, lw: number, lh: number, alpha: number) => number;
  engine_add_icon: (lng: number, lat: number, tex: number, tw: number, th: number, label: number, lw: number, lh: number, alpha: number) => number;
  engine_add_zone: (ptr: number, n: number, tex: number, thumb: number, thw: number, thh: number, label: number, lw: number, lh: number, alpha: number, draft: number) => number;
  engine_set_preview: (ptr: number, n: number, closed: number) => void;
  engine_set_pan: (on: number) => void;
  engine_pointer_down: (id: number, x: number, y: number) => void;
  engine_pointer_move: (id: number, x: number, y: number) => void;
  engine_pointer_up: (id: number, x: number, y: number) => number;
  engine_pointer_leave: () => void;
  engine_tap: (x: number, y: number) => number;
  engine_cross_streets_at: (lng: number, lat: number, buf: number, cap: number) => number;
  engine_wheel: (x: number, y: number, dy: number) => void;
  engine_dblclick: (x: number, y: number) => void;
  engine_frame: (w: number, h: number, dpr: number) => number;
  engine_invalidate: () => void;
};

interface Tex { tex: number; w: number; h: number }

export interface EngineStats {
  backend: string;
  gpu: string;
  screen: string;       // canvas size in device pixels @ pixel ratio
  maxFrameMs: number;   // slowest frame in the last half second
  workers: number;
  moving: boolean;      // false = nothing changed, so nothing was redrawn (saves battery)
  fps: number;          // frames drawn per second while moving
  frameMs: number;      // average time to build + submit one frame (C++ + backend)
  budgetPct: number;    // share of a 60 fps frame (16.7 ms) that frameMs uses
  tileBuildMs: number;  // average time to decode + triangulate a tile (in workers)
  tiles: number;        // tiles ready on the GPU
}

export interface EngineEvents {
  onClick?: (at: LatLng) => void;
  onHoverZone?: (postId: string | null) => void;
}

export class MapEngine {
  private ex!: Exports;
  backend!: GfxBackend;
  private module!: WebAssembly.Module;
  private tileUrl = '';
  private tileQueue: [number, number, number][] = [];
  private workers: { w: Worker; busy: number }[] = [];
  private mainThreadBusy = 0;
  // stats
  private drawn = 0;
  private drawMsSum = 0;
  private buildMsSum = 0;
  private builds = 0;
  private statWindowStart = performance.now();
  private lastStats: EngineStats = { backend: '', gpu: '', screen: '', maxFrameMs: 0, workers: 0, moving: false, fps: 0, frameMs: 0, budgetPct: 0, tileBuildMs: 0, tiles: 0 };
  private drawMsMax = 0;
  private hoverIndex = -1;
  private textBuf = 0;
  private texCache = new Map<string, Promise<Tex>>();
  private postIds: string[] = [];
  private postInfo: { comment: string; imageUrl: string | null }[] = [];
  private placing = false;
  private raf = 0;
  private dpr = 1;
  private scratch = 0;
  private updateVersion = 0;
  // drawing tool state
  private drawKind: 'rect' | 'poly' | null = null;
  private drawPts: LatLng[] = [];
  private rectStart: LatLng | null = null;
  private onDrawDone: ((c: LatLng[]) => void) | null = null;
  private onDrawCancel: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private events: EngineEvents = {}) {}

  // ------------------------------------------------------------ setup
  async start(center: [number, number], zoom: number) {
    // WebGPU first; WebGL2 if the browser doesn't have it (or ?renderer=webgl in the URL)
    const choice = new URLSearchParams(location.search).get('renderer'); // 'webgl' | 'webgpu-offscreen' (debug)
    const backend =
      (choice !== 'webgl' && (await WebGPUBackend.create(this.canvas, choice === 'webgpu-offscreen'))) ||
      WebGL2Backend.create(this.canvas);
    if (!backend) throw new Error('This browser supports neither WebGPU nor WebGL2');
    this.backend = backend;
    console.log(`[engine] renderer: ${backend.name}`);

    this.module = await WebAssembly.compileStreaming(fetch(`${import.meta.env.BASE_URL}engine.wasm`));
    const instance = await WebAssembly.instantiate(this.module, {
      gfx: backend.imports(() => this.ex.memory.buffer),
      env: this.envImports(),
      wasi_snapshot_preview1: this.wasiImports(),
    });
    this.ex = instance.exports as unknown as Exports;
    this.ex._initialize();
    this.ex.engine_init();
    this.ex.engine_config(
      ICON.SIZE, ICON.REF_ZOOM, ICON.MIN_SIZE, ICON.SCALE_WITH_ZOOM ? 1 : 0,
      PIXEL.SIZE, hexNum(PIXEL.COLOR), MARKER.SIZE, ZOOM.AD_INFO_THRESHOLD,
      hexNum(ZONE.FILL_COLOR), ZONE.FILL_OPACITY, hexNum(ZONE.BORDER_COLOR), ZONE.BORDER_WIDTH
    );
    this.ex.engine_set_view(center[1], center[0], zoom);
    this.scratch = this.ex.engine_alloc(16);
    this.textBuf = this.ex.engine_alloc(512);

    // labels are drawn with Inter: make sure the font is ready before the first label
    await Promise.all([document.fonts.load(`500 ${TEXT_PX}px Inter`), document.fonts.load(`600 ${TEXT_PX}px Inter`)]).catch(() => {});

    this.bindInput();
    this.startWorkers();
    this.loop();

    try {
      const tj = await (await fetch(TILEJSON_URL)).json();
      this.tileUrl = tj.tiles[0];
      this.pumpTiles();
    } catch (e) {
      console.error('Could not load map tiles', e);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.workers.forEach((w) => w.w.terminate());
  }

  stats(): EngineStats {
    const now = performance.now();
    const secs = (now - this.statWindowStart) / 1000;
    if (secs >= 0.5) {
      const moving = this.drawn >= 12; // steady redraws (not just a short fade) = something is moving
      const frameMs = this.drawn ? this.drawMsSum / this.drawn : this.lastStats.frameMs;
      this.lastStats = {
        backend: this.backend?.name ?? '',
        gpu: this.backend?.gpu ?? '',
        screen: `${this.canvas.width}x${this.canvas.height}@${this.dpr}`,
        maxFrameMs: this.drawMsMax,
        workers: this.workers.length,
        moving,
        fps: moving ? this.drawn / secs : this.lastStats.fps,
        frameMs,
        budgetPct: (frameMs / (1000 / 60)) * 100,
        tileBuildMs: this.builds ? this.buildMsSum / this.builds : this.lastStats.tileBuildMs,
        tiles: this.ex ? this.ex.engine_stat_tiles() : 0,
      };
      this.drawn = 0;
      this.drawMsSum = 0;
      this.drawMsMax = 0;
      this.statWindowStart = now;
    }
    return this.lastStats;
  }

  private loop = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.texCache.clear(); // labels are drawn at device resolution
    }
    const t0 = performance.now();
    const r = this.ex.engine_frame(w, h, dpr);
    if (r & 1) {
      const ms = performance.now() - t0;
      this.drawn++;
      this.drawMsSum += ms;
      if (ms > this.drawMsMax) this.drawMsMax = ms;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // ------------------------------------------------------------ public API
  get zoom() {
    return this.ex.engine_get_zoom();
  }

  screenToLngLat(cssX: number, cssY: number): LatLng {
    this.ex.engine_screen_to_lnglat(cssX * this.dpr, cssY * this.dpr, this.scratch);
    const f = new Float64Array(this.ex.memory.buffer, this.scratch, 2);
    return { lng: f[0], lat: f[1] };
  }

  /** Re-send all posts + the draft to C++ */
  async setPosts(posts: readonly Post[], draft: Draft) {
    const version = ++this.updateVersion;
    const list: (Post & { draft?: boolean })[] = posts.map((p) => ({ ...p }));
    const d = draftToPost(draft);
    if (d) list.push({ ...d, draft: true });

    // prepare every texture first (async), then hand everything to C++ in one go
    const prepared = await Promise.all(
      list.map(async (p) => {
        const label = p.comment.trim() ? await this.labelTex(p.comment.trim(), !!p.draft) : null;
        const image = 'imageUrl' in p && p.imageUrl ? await this.imageTex(p.imageUrl) : null;
        const thumb = p.kind === 'zone' && p.imageUrl ? await this.thumbTex(p.imageUrl) : null;
        return { p, label, image, thumb };
      })
    );
    if (version !== this.updateVersion) return;

    const ex = this.ex;
    ex.engine_posts_clear();
    this.postIds = [];
    this.postInfo = [];
    for (const { p, label, image, thumb } of prepared) {
      const a = p.draft ? 0.75 : 1;
      const L = label ?? { tex: 0, w: 0, h: 0 };
      let index = -1;
      if (p.kind === 'pixel' || (p.kind === 'icon' && !image)) {
        const at = (p as any).at as LatLng;
        index = ex.engine_add_pixel(at.lng, at.lat, L.tex, L.w, L.h, a);
      } else if (p.kind === 'icon' && image) {
        index = ex.engine_add_icon(p.at.lng, p.at.lat, image.tex, image.w, image.h, L.tex, L.w, L.h, a);
      } else if (p.kind === 'zone') {
        const n = p.coordinates.length;
        const ptr = ex.engine_alloc(n * 16);
        const f = new Float64Array(ex.memory.buffer, ptr, n * 2);
        p.coordinates.forEach((c, i) => { f[i * 2] = c.lng; f[i * 2 + 1] = c.lat; });
        const T = thumb ?? { tex: 0, w: 0, h: 0 };
        index = ex.engine_add_zone(ptr, n, image?.tex ?? 0, T.tex, T.w, T.h, L.tex, L.w, L.h, a, p.draft ? 1 : 0);
        ex.engine_free(ptr);
      }
      if (index >= 0) {
        this.postIds[index] = p.id;
        this.postInfo[index] = { comment: p.comment.trim(), imageUrl: 'imageUrl' in p && p.imageUrl ? p.imageUrl : null };
      }
    }
  }

  /** Nearest cross streets for a point; waits (up to ~6 s) for the street data to load. */
  async addressAt(at: LatLng): Promise<string> {
    for (let i = 0; i < 30; i++) {
      const n = this.ex.engine_cross_streets_at(at.lng, at.lat, this.textBuf, 512);
      if (n >= 0) return n ? new TextDecoder().decode(new Uint8Array(this.ex.memory.buffer, this.textBuf, n)) : '';
      await new Promise((r) => setTimeout(r, 200));
    }
    return '';
  }

  // ------------------------------------------------------------ zone drawing tool
  startDrawing(kind: 'rect' | 'poly', done: (c: LatLng[]) => void, cancel: () => void) {
    this.stopDrawing(false);
    this.drawKind = kind;
    this.drawPts = [];
    this.rectStart = null;
    this.onDrawDone = done;
    this.onDrawCancel = cancel;
    this.canvas.style.cursor = 'crosshair';
    if (kind === 'rect') this.ex.engine_set_pan(0);
  }

  stopDrawing(cancelled = true) {
    if (!this.drawKind) return;
    this.drawKind = null;
    this.drawPts = [];
    this.rectStart = null;
    this.ex.engine_set_pan(1);
    this.setPreview([], false);
    this.canvas.style.cursor = '';
    const cb = this.onDrawCancel;
    this.onDrawDone = this.onDrawCancel = null;
    if (cancelled) cb?.();
  }

  get drawing() {
    return this.drawKind !== null;
  }

  setPlacingCursor(on: boolean) {
    this.placing = on;
    if (!this.drawKind) this.canvas.style.cursor = on ? 'crosshair' : '';
  }

  private finishDrawing(coords: LatLng[]) {
    const done = this.onDrawDone;
    this.onDrawCancel = null;
    this.stopDrawing(false);
    done?.(coords);
  }

  private setPreview(pts: LatLng[], closed: boolean) {
    const ex = this.ex;
    const n = pts.length;
    const ptr = ex.engine_alloc(Math.max(1, n) * 16);
    const f = new Float64Array(ex.memory.buffer, ptr, n * 2);
    pts.forEach((p, i) => { f[i * 2] = p.lng; f[i * 2 + 1] = p.lat; });
    ex.engine_set_preview(ptr, n, closed ? 1 : 0);
    ex.engine_free(ptr);
  }

  // ------------------------------------------------------------ input
  private bindInput() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    const pos = (e: MouseEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const p = pos(e);
      this.ex.engine_pointer_down(e.pointerId, p.x * this.dpr, p.y * this.dpr);
      if (this.drawKind === 'rect') this.rectStart = this.screenToLngLat(p.x, p.y);
    });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      this.ex.engine_pointer_move(e.pointerId, p.x * this.dpr, p.y * this.dpr);
      if (this.drawKind === 'rect' && this.rectStart) {
        this.setPreview(rect(this.rectStart, this.screenToLngLat(p.x, p.y)), true);
      } else if (this.drawKind === 'poly' && this.drawPts.length) {
        this.setPreview([...this.drawPts, this.screenToLngLat(p.x, p.y)], this.drawPts.length >= 2);
      }
    });
    const up = (e: PointerEvent) => {
      const p = pos(e);
      const click = this.ex.engine_pointer_up(e.pointerId, p.x * this.dpr, p.y * this.dpr) === 1;
      if (this.drawKind === 'rect' && this.rectStart) {
        const a = this.rectStart;
        const b = this.screenToLngLat(p.x, p.y);
        this.rectStart = null;
        const sa = this.lngLatToScreen(a);
        if (Math.abs(sa.x - p.x) > 8 && Math.abs(sa.y - p.y) > 8) this.finishDrawing(rect(a, b));
        else this.setPreview([], false);
        return;
      }
      if (!click) return;
      const at = this.screenToLngLat(p.x, p.y);
      if (this.drawKind === 'poly') {
        if (this.drawPts.length >= 3) {
          const first = this.lngLatToScreen(this.drawPts[0]);
          if (Math.hypot(first.x - p.x, first.y - p.y) < 12) {
            this.finishDrawing([...this.drawPts]);
            return;
          }
        }
        this.drawPts.push(at);
        this.setPreview(this.drawPts, false);
        return;
      }
      // tapping a post opens its card (phones have no hover); not while placing something
      if (!this.placing && this.ex.engine_tap(p.x * this.dpr, p.y * this.dpr) >= 0) return;
      this.events.onClick?.(at);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    // touch screens fire pointerleave after every tap, which would close the card right away
    c.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') this.ex.engine_pointer_leave(); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pos(e);
      const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      this.ex.engine_wheel(p.x * this.dpr, p.y * this.dpr, dy);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const p = pos(e);
      if (this.drawKind === 'poly') {
        // the double-click also added a duplicate point
        const pts = this.drawPts.slice(0, -1);
        if (pts.length >= 3) this.finishDrawing(pts);
        return;
      }
      if (!this.drawKind) this.ex.engine_dblclick(p.x * this.dpr, p.y * this.dpr);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.drawKind) this.stopDrawing(true);
    });
  }

  private lngLatToScreen(p: LatLng) {
    this.ex.engine_lnglat_to_screen(p.lng, p.lat, this.scratch);
    const f = new Float64Array(this.ex.memory.buffer, this.scratch, 2);
    return { x: f[0] / this.dpr, y: f[1] / this.dpr };
  }

  // ------------------------------------------------------------ tiles (background workers)
  private startWorkers() {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    for (let i = 0; i < n; i++) {
      try {
        const w = new Worker(new URL('./tile-worker.ts', import.meta.url), { type: 'module' });
        const slot = { w, busy: 0 };
        w.onmessage = (e) => this.onWorkerMessage(slot, e.data);
        w.postMessage({ type: 'init', module: this.module });
        this.workers.push(slot);
      } catch (e) {
        console.warn('Workers unavailable, building tiles on the main thread', e);
        break;
      }
    }
  }

  private onWorkerMessage(slot: { busy: number }, msg: any) {
    if (msg.type === 'ready') return this.pumpTiles();
    slot.busy--;
    if (msg.type === 'tile') {
      this.buildMsSum += msg.ms;
      this.builds++;
      const blob = msg.blob as Uint8Array;
      const ptr = this.ex.engine_alloc(blob.length);
      new Uint8Array(this.ex.memory.buffer, ptr, blob.length).set(blob);
      this.ex.engine_tile_upload(msg.z, msg.x, msg.y, ptr, blob.length);
      this.ex.engine_free(ptr);
    } else {
      this.ex.engine_tile_failed(msg.z, msg.x, msg.y);
    }
    this.pumpTiles();
  }

  private tileUrlFor(z: number, x: number, y: number) {
    return this.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  }

  private pumpTiles() {
    if (!this.tileUrl) return;
    if (!this.workers.length) {
      // no workers: build on the main thread
      while (this.mainThreadBusy < 6 && this.tileQueue.length) {
        const [z, x, y] = this.tileQueue.pop()!;
        this.mainThreadBusy++;
        this.fetchTileHere(z, x, y).finally(() => { this.mainThreadBusy--; this.pumpTiles(); });
      }
      return;
    }
    while (this.tileQueue.length) {
      const slot = this.workers.reduce((a, b) => (b.busy < a.busy ? b : a));
      if (slot.busy >= MAX_TILES_PER_WORKER) break;
      const [z, x, y] = this.tileQueue.pop()!; // newest first = what you're looking at now
      slot.busy++;
      slot.w.postMessage({ type: 'tile', z, x, y, url: this.tileUrlFor(z, x, y) });
    }
  }

  private async fetchTileHere(z: number, x: number, y: number) {
    try {
      const res = await fetch(this.tileUrlFor(z, x, y));
      if (!res.ok) throw new Error(String(res.status));
      let buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
        buf = new Uint8Array(await ds.arrayBuffer());
      }
      const t0 = performance.now();
      const ptr = this.ex.engine_alloc(buf.length);
      new Uint8Array(this.ex.memory.buffer, ptr, buf.length).set(buf);
      const out = this.ex.worker_build_tile(ptr, buf.length);
      this.ex.engine_free(ptr);
      const size = new Uint32Array(this.ex.memory.buffer, out, 1)[0];
      this.buildMsSum += performance.now() - t0;
      this.builds++;
      this.ex.engine_tile_upload(z, x, y, out, size);
    } catch {
      this.ex.engine_tile_failed(z, x, y);
    }
  }

  // ------------------------------------------------------------ post card on hover / tap
  // One card like a Google Maps place card: image, comment, and the nearest cross streets.
  private async showCrossStreets(index: number) {
    if (index !== this.hoverIndex) return;
    const info = this.postInfo[index];
    if (!info) return;
    const n = this.ex.engine_cross_streets(index, this.textBuf, 512);
    // -1 = street data still loading: show the card now, C++ calls on_hover again when it arrives
    const address = n > 0
      ? new TextDecoder().decode(new Uint8Array(this.ex.memory.buffer, this.textBuf, n))
      : n < 0 ? null : '';
    const t = await this.makePostCard(info.comment, info.imageUrl, address);
    if (index !== this.hoverIndex) { this.ex.engine_tex_delete(t.tex); return; }
    // C++ owns the texture from here (deletes it when the card closes)
    this.ex.engine_set_hover_info(index, t.tex, t.w, t.h);
  }

  private async makePostCard(comment: string, imageUrl: string | null, address: string | null): Promise<Tex> {
    const dpr = this.dpr;
    const W = 280 * dpr;                 // card width
    const pad = 12 * dpr;
    const img = imageUrl ? await loadImage(imageUrl).catch(() => null) : null;
    const thumb = img ? 64 * dpr : 0;
    const textX = pad + (thumb ? thumb + 12 * dpr : 0);
    const textW = W - textX - pad;

    const titleFont = `600 ${15 * dpr}px ${FONT_FAMILY}`;
    const addrFont = `500 ${13 * dpr}px ${FONT_FAMILY}`;
    const meas = document.createElement('canvas').getContext('2d')!;
    meas.font = titleFont;
    const title = comment || 'Pinned spot';
    const lines = wrap(meas, title, textW).slice(0, 3);
    const titleLH = Math.round(20 * dpr);
    const addrLH = Math.round(18 * dpr);
    const textH = lines.length * titleLH + 6 * dpr + addrLH;
    const bodyH = Math.max(thumb, textH) + pad * 2;
    const arrow = 8 * dpr;

    const { cv, ctx, m } = shadowCanvas(W, bodyH + arrow, dpr);
    // card with a small pointer at the bottom
    ctx.save();
    ctx.shadowColor = 'rgba(60, 64, 67, 0.3)';
    ctx.shadowBlur = 6 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(m, m, W, bodyH, 12 * dpr);
    ctx.moveTo(m + W / 2 - arrow, m + bodyH - 1);
    ctx.lineTo(m + W / 2, m + bodyH + arrow);
    ctx.lineTo(m + W / 2 + arrow, m + bodyH - 1);
    ctx.fill();
    ctx.restore();

    if (img && thumb) {
      const ty = m + (bodyH - thumb) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(m + pad, ty, thumb, thumb, 8 * dpr);
      ctx.clip();
      const sc = Math.max(thumb / img.width, thumb / img.height);
      ctx.fillStyle = '#f1f3f4';
      ctx.fillRect(m + pad, ty, thumb, thumb);
      ctx.drawImage(img, m + pad + (thumb - img.width * sc) / 2, ty + (thumb - img.height * sc) / 2, img.width * sc, img.height * sc);
      ctx.restore();
    }

    let y = m + (bodyH - textH) / 2;
    ctx.fillStyle = '#202124';
    ctx.font = titleFont;
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, m + textX, y + titleLH * (i + 0.5), textW));
    y += lines.length * titleLH + 6 * dpr;

    // address row: red pin + cross streets
    const px = m + textX + 5 * dpr, py = y + addrLH / 2 - 1 * dpr, r = 4.5 * dpr;
    ctx.fillStyle = address === '' ? '#9aa0a6' : '#ea4335';
    ctx.beginPath();
    ctx.arc(px, py - r * 0.35, r, Math.PI, 0);
    ctx.lineTo(px, py + r * 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(px, py - r * 0.35, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = addrFont;
    ctx.fillStyle = '#5f6368';
    const addrText = address === null ? 'Finding cross streets…' : address || 'No street names here';
    ctx.fillText(addrText, m + textX + 16 * dpr, y + addrLH / 2, textW - 16 * dpr);

    return this.uploadCanvas(cv);
  }

  // ------------------------------------------------------------ textures
  private uploadCanvas(cv: HTMLCanvasElement | OffscreenCanvas): Tex {
    const ctx = cv.getContext('2d') as CanvasRenderingContext2D;
    const { width: w, height: h } = cv;
    const data = ctx.getImageData(0, 0, w, h).data;
    const ptr = this.ex.engine_alloc(data.length);
    new Uint8Array(this.ex.memory.buffer, ptr, data.length).set(data);
    const tex = this.ex.engine_tex_create(ptr, w, h);
    this.ex.engine_free(ptr);
    return { tex, w, h };
  }

  private cached(key: string, make: () => Promise<Tex>) {
    let t = this.texCache.get(key);
    if (!t) { t = make(); this.texCache.set(key, t); }
    return t;
  }

  private imageTex(url: string) {
    return this.cached(`img:${url.length}:${url.slice(-64)}`, async () => {
      const img = await loadImage(url);
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      cv.getContext('2d')!.drawImage(img, 0, 0);
      return this.uploadCanvas(cv);
    });
  }

  // square thumbnail with a white border, like the original zone marker
  private thumbTex(url: string) {
    const dpr = this.dpr;
    return this.cached(`thumb:${dpr}:${url.length}:${url.slice(-64)}`, async () => {
      const img = await loadImage(url);
      const size = Math.round(MARKER.SIZE * dpr);
      const b = Math.round(3 * dpr);
      const total = size + b * 2;
      const cv = document.createElement('canvas');
      cv.width = cv.height = total;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.roundRect(0, 0, total, total, 8 * dpr);
      ctx.fill();
      const s = Math.max(size / img.width, size / img.height);
      const w = img.width * s, h = img.height * s;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(b, b, size, size, 6 * dpr);
      ctx.clip();
      ctx.drawImage(img, b + (size - w) / 2, b + (size - h) / 2, w, h);
      ctx.restore();
      return this.uploadCanvas(cv);
    });
  }

  // comment text on a white card with a soft shadow (Google Maps style), drawn at device
  // resolution so it stays sharp
  private labelTex(text: string, draft: boolean) {
    const dpr = this.dpr;
    return this.cached(`label:${dpr}:${draft}:${text}`, async () => {
      const font = `600 ${TEXT_PX * dpr}px ${FONT_FAMILY}`;
      const pad = { x: 10 * dpr, y: 6 * dpr };
      const maxW = 240 * dpr;
      const meas = document.createElement('canvas').getContext('2d')!;
      meas.font = font;
      const lines = wrap(meas, text, maxW - pad.x * 2);
      const lineH = Math.round(TEXT_PX * 1.35 * dpr);
      const cardW = Math.ceil(Math.min(maxW, Math.max(...lines.map((l) => meas.measureText(l).width)) + pad.x * 2));
      const cardH = Math.ceil(lines.length * lineH + pad.y * 2);
      const { cv, ctx, m } = shadowCanvas(cardW, cardH, dpr);
      card(ctx, m, m, cardW, cardH, 8 * dpr, dpr, draft);
      ctx.fillStyle = '#202124';
      ctx.font = font;
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, m + pad.x, m + pad.y + lineH * (i + 0.5)));
      return this.uploadCanvas(cv);
    });
  }


  // ------------------------------------------------------------ imports for C++
  private str(ptr: number, len: number) {
    return new TextDecoder().decode(new Uint8Array(this.ex.memory.buffer, ptr, len));
  }

  private envImports() {
    return {
      request_tile: (z: number, x: number, y: number) => {
        this.tileQueue.push([z, x, y]);
        queueMicrotask(() => this.pumpTiles());
      },
      on_hover: (index: number) => {
        this.hoverIndex = index;
        this.events.onHoverZone?.(index >= 0 ? this.postIds[index] ?? null : null);
        // look up cross streets after C++ returns from this call
        if (index >= 0) queueMicrotask(() => this.showCrossStreets(index));
      },
      log: (p: number, l: number) => console.log('[engine]', this.str(p, l)),
      now_ms: () => performance.now(),
    };
  }

  private wasiImports() {
    return {
      fd_write: () => 0,
      fd_close: () => 0,
      fd_seek: () => 0,
      random_get: (p: number, n: number) => {
        crypto.getRandomValues(new Uint8Array(this.ex.memory.buffer, p, n));
        return 0;
      },
      proc_exit: (code: number) => { throw new Error(`engine exited (${code})`); },
    };
  }
}

// ------------------------------------------------------------ helpers
function hexNum(h: string) {
  return parseInt(h.replace('#', ''), 16);
}

function rect(a: LatLng, b: LatLng): LatLng[] {
  const n = Math.max(a.lat, b.lat), s = Math.min(a.lat, b.lat);
  const w = Math.min(a.lng, b.lng), e = Math.max(a.lng, b.lng);
  return [{ lat: n, lng: w }, { lat: n, lng: e }, { lat: s, lng: e }, { lat: s, lng: w }];
}

function draftToPost(d: Draft): Post | null {
  const base = { id: 'draft', comment: d.comment, createdAt: '' };
  if (d.kind === 'pixel' && d.at) return { ...base, kind: 'pixel', at: d.at };
  if (d.kind === 'icon' && d.at) return { ...base, kind: 'icon', at: d.at, imageUrl: d.imageUrl ?? '', paymentId: '' };
  if (d.kind === 'zone' && d.coordinates)
    return { ...base, kind: 'zone', coordinates: d.coordinates, imageUrl: d.imageUrl ?? '', paymentId: '' };
  return null;
}

const imageCache = new Map<string, Promise<ImageBitmap>>();
function loadImage(url: string) {
  let p = imageCache.get(url);
  if (!p) {
    p = decodeToBitmap(url); // JPEG XL (native or WebAssembly), PNG, JPEG...
    imageCache.set(url, p);
  }
  return p;
}

// canvas with room around the card for its shadow
function shadowCanvas(w: number, h: number, dpr: number) {
  const m = Math.ceil(5 * dpr);
  const cv = document.createElement('canvas');
  cv.width = w + m * 2;
  cv.height = h + m * 2;
  return { cv, ctx: cv.getContext('2d')!, m };
}

function card(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, dpr: number, dashed: boolean) {
  ctx.save();
  ctx.shadowColor = 'rgba(60, 64, 67, 0.32)';
  ctx.shadowBlur = 4 * dpr;
  ctx.shadowOffsetY = 1 * dpr;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  if (dashed) {
    ctx.save();
    ctx.strokeStyle = '#9aa0a6';
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.roundRect(x + dpr / 2, y + dpr / 2, w - dpr, h - dpr, r);
    ctx.stroke();
    ctx.restore();
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
