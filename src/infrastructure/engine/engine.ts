// Bridge between the browser and the C++ map engine (engine/src/engine.cpp -> public/engine.wasm).
//
// The browser only lets JavaScript touch WebGL, the network and image decoding, so this file:
//   * hands WebGL2 calls to the C++ engine (it decides what to draw)
//   * downloads vector tiles and passes the raw bytes to C++
//   * turns images and comment text into pixel buffers for C++ to upload to the GPU
//   * forwards mouse / touch / wheel input to C++ (camera logic lives in C++)

import type { Post } from '../../use-cases/posts/post-schemas';
import type { Draft } from '../../use-cases/posts/posts-store';
import type { LatLng } from '../../domain/geo/geo-schemas';
import { ICON, MARKER, PIXEL, ZONE, ZOOM } from '../../config-new/constants';

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const MAX_PARALLEL_TILES = 8;

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
  engine_tile_loaded: (z: number, x: number, y: number, ptr: number, len: number) => void;
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
  engine_wheel: (x: number, y: number, dy: number) => void;
  engine_dblclick: (x: number, y: number) => void;
  engine_frame: (w: number, h: number, dpr: number) => number;
  engine_invalidate: () => void;
};

interface Tex { tex: number; w: number; h: number }

export interface EngineEvents {
  onClick?: (at: LatLng) => void;
  onHoverZone?: (postId: string | null) => void;
}

export class MapEngine {
  private ex!: Exports;
  private gl!: WebGL2RenderingContext;
  private handles: any[] = [null];
  private tileUrl = '';
  private tileQueue: [number, number, number][] = [];
  private tilesInFlight = 0;
  private texCache = new Map<string, Promise<Tex>>();
  private postIds: string[] = [];
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
    const gl = this.canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;

    const bytes = await (await fetch(`${import.meta.env.BASE_URL}engine.wasm`)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      gl: this.glImports(),
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

    this.bindInput();
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
    this.ex.engine_frame(w, h, dpr);
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
      if (index >= 0) this.postIds[index] = p.id;
    }
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
      this.events.onClick?.(at);
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('pointerleave', () => this.ex.engine_pointer_leave());
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

  // ------------------------------------------------------------ tiles
  private pumpTiles() {
    if (!this.tileUrl) return;
    while (this.tilesInFlight < MAX_PARALLEL_TILES && this.tileQueue.length) {
      const [z, x, y] = this.tileQueue.pop()!; // newest first = what you're looking at now
      this.tilesInFlight++;
      this.fetchTile(z, x, y).finally(() => {
        this.tilesInFlight--;
        this.pumpTiles();
      });
    }
  }

  private async fetchTile(z: number, x: number, y: number) {
    const url = this.tileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      let buf = new Uint8Array(await res.arrayBuffer());
      if (buf[0] === 0x1f && buf[1] === 0x8b) {
        const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
        buf = new Uint8Array(await ds.arrayBuffer());
      }
      const ptr = this.ex.engine_alloc(buf.length);
      new Uint8Array(this.ex.memory.buffer, ptr, buf.length).set(buf);
      this.ex.engine_tile_loaded(z, x, y, ptr, buf.length);
      this.ex.engine_free(ptr);
    } catch {
      this.ex.engine_tile_failed(z, x, y);
    }
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
      cv.width = img.naturalWidth;
      cv.height = img.naturalHeight;
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
      const s = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(b, b, size, size, 6 * dpr);
      ctx.clip();
      ctx.drawImage(img, b + (size - w) / 2, b + (size - h) / 2, w, h);
      ctx.restore();
      return this.uploadCanvas(cv);
    });
  }

  // comment text in a white bubble, drawn at device resolution so it stays sharp
  private labelTex(text: string, draft: boolean) {
    const dpr = this.dpr;
    return this.cached(`label:${dpr}:${draft}:${text}`, async () => {
      const font = `600 ${12 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      const pad = { x: 8 * dpr, y: 5 * dpr };
      const maxW = 220 * dpr;
      const meas = document.createElement('canvas').getContext('2d')!;
      meas.font = font;
      const lines = wrap(meas, text, maxW - pad.x * 2);
      const lineH = 16 * dpr;
      const w = Math.ceil(Math.min(maxW, Math.max(...lines.map((l) => meas.measureText(l).width)) + pad.x * 2));
      const h = Math.ceil(lines.length * lineH + pad.y * 2);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = dpr;
      if (draft) ctx.setLineDash([4 * dpr, 3 * dpr]);
      ctx.beginPath();
      ctx.roundRect(dpr / 2, dpr / 2, w - dpr, h - dpr, 8 * dpr);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#111827';
      ctx.font = font;
      ctx.textBaseline = 'middle';
      lines.forEach((l, i) => ctx.fillText(l, pad.x, pad.y + lineH * (i + 0.5)));
      return this.uploadCanvas(cv);
    });
  }

  // ------------------------------------------------------------ imports for C++
  private str(ptr: number, len: number) {
    return new TextDecoder().decode(new Uint8Array(this.ex.memory.buffer, ptr, len));
  }

  private glImports() {
    const H = this.handles;
    const add = (o: any) => { H.push(o); return H.length - 1; };
    const g = () => this.gl;
    const self = this;
    return {
      createShader: (t: number) => add(g().createShader(t)),
      shaderSource: (s: number, p: number, l: number) => g().shaderSource(H[s], self.str(p, l)),
      compileShader: (s: number) => {
        g().compileShader(H[s]);
        const ok = g().getShaderParameter(H[s], g().COMPILE_STATUS);
        if (!ok) console.error(g().getShaderInfoLog(H[s]));
        return ok ? 1 : 0;
      },
      createProgram: () => add(g().createProgram()),
      attachShader: (p: number, s: number) => g().attachShader(H[p], H[s]),
      linkProgram: (p: number) => {
        g().linkProgram(H[p]);
        const ok = g().getProgramParameter(H[p], g().LINK_STATUS);
        if (!ok) console.error(g().getProgramInfoLog(H[p]));
        return ok ? 1 : 0;
      },
      useProgram: (p: number) => g().useProgram(H[p]),
      getUniformLocation: (p: number, n: number, l: number) => {
        const loc = g().getUniformLocation(H[p], self.str(n, l));
        return loc ? add(loc) : 0;
      },
      uniform1f: (l: number, a: number) => l && g().uniform1f(H[l], a),
      uniform2f: (l: number, a: number, b: number) => l && g().uniform2f(H[l], a, b),
      uniform4f: (l: number, a: number, b: number, c: number, d: number) => l && g().uniform4f(H[l], a, b, c, d),
      uniform1i: (l: number, a: number) => l && g().uniform1i(H[l], a),
      createBuffer: () => add(g().createBuffer()),
      deleteBuffer: (b: number) => { g().deleteBuffer(H[b]); H[b] = null; },
      bindBuffer: (t: number, b: number) => g().bindBuffer(t, H[b]),
      bufferData: (t: number, p: number, n: number, u: number) =>
        g().bufferData(t, new Uint8Array(self.ex.memory.buffer, p, n), u),
      createVertexArray: () => add(g().createVertexArray()),
      deleteVertexArray: (v: number) => { g().deleteVertexArray(H[v]); H[v] = null; },
      bindVertexArray: (v: number) => g().bindVertexArray(H[v]),
      enableVertexAttribArray: (i: number) => g().enableVertexAttribArray(i),
      vertexAttribPointer: (i: number, s: number, t: number, n: number, st: number, o: number) =>
        g().vertexAttribPointer(i, s, t, !!n, st, o),
      drawArrays: (m: number, f: number, c: number) => g().drawArrays(m, f, c),
      drawElements: (m: number, c: number, t: number, o: number) => g().drawElements(m, c, t, o),
      viewport: (x: number, y: number, w: number, h: number) => g().viewport(x, y, w, h),
      clearColor: (r: number, gg: number, b: number, a: number) => g().clearColor(r, gg, b, a),
      clear: (m: number) => g().clear(m),
      enable: (c: number) => g().enable(c),
      disable: (c: number) => g().disable(c),
      blendFunc: (s: number, d: number) => g().blendFunc(s, d),
      createTexture: () => add(g().createTexture()),
      deleteTexture: (t: number) => { g().deleteTexture(H[t]); H[t] = null; },
      bindTexture: (t: number, x: number) => g().bindTexture(t, H[x]),
      activeTexture: (u: number) => g().activeTexture(u),
      texImage2D: (w: number, h: number, p: number) => {
        const gl = g();
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE,
          new Uint8Array(self.ex.memory.buffer, p, w * h * 4));
      },
      texParameteri: (t: number, p: number, v: number) => g().texParameteri(t, p, v),
      generateMipmap: (t: number) => g().generateMipmap(t),
    };
  }

  private envImports() {
    return {
      request_tile: (z: number, x: number, y: number) => {
        this.tileQueue.push([z, x, y]);
        queueMicrotask(() => this.pumpTiles());
      },
      on_hover: (index: number) => this.events.onHoverZone?.(index >= 0 ? this.postIds[index] ?? null : null),
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

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string) {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
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
