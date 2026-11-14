import { Component, onMount, onCleanup, createEffect, createSignal, Show } from 'solid-js';
import { MapEngine, type EngineStats } from '../../infrastructure/engine/engine';
import { reportStats } from '../../infrastructure/engine/stats-reporter';
import {
  myLocation, locStatus, startLocation, stopLocation, locStatusText, setMyAt, locHint, noteAccuracy,
} from '../../infrastructure/geo/my-location';
import { PostComposer } from '../components/panel/PostComposer';
import { CheckoutModal } from '../components/panel/CheckoutModal';
import { posts, draft, drawMode, picking, postActions } from '../../use-cases/posts/posts-store';
import { PickLocation } from '../components/map/PickLocation';
import { MAP_CONFIG } from '../../config-new/constants';
import './interface.css';
import '../components/map/posts.css';

// 3 ways to post:
//   1. Free  - red pixel + comment
//   2. Paid  - custom uploaded icon (fixed 225px) + comment
//   3. Paid  - custom zone upload (image fills a drawn area) + comment
// The map itself is the C++ engine in engine/src (compiled to public/engine.wasm).
const centerOf = (c: { lat: number; lng: number }[]) => {
  const lats = c.map((p) => p.lat), lngs = c.map((p) => p.lng);
  return { lat: (Math.max(...lats) + Math.min(...lats)) / 2, lng: (Math.max(...lngs) + Math.min(...lngs)) / 2 };
};

export const MapScreen: Component = () => {
  let canvas!: HTMLCanvasElement;
  let engine: MapEngine | undefined;
  const [stats, setStats] = createSignal<EngineStats | null>(null);
  const [eng, setEng] = createSignal<MapEngine | null>(null);
  const [dragChip, setDragChip] = createSignal<{ x: number; y: number; text: string } | null>(null);
  const [showStats, setShowStats] = createSignal(!window.matchMedia('(max-width: 640px)').matches);
  let statsTimer = 0;
  let recenter: () => void = () => startLocation();

  onMount(async () => {
    const e: MapEngine = new MapEngine(canvas, {
      // while choosing a location, tapping the map moves the pin there
      onClick: (at) => (picking() ? e.flyTo(at) : postActions.placeAt(at)),
      onMyLocationMoved: () => { setMyAt(e.getMyLocation()); setDragChip(null); },
      // live address above the blue dot while you drag it
      onMyLocationDrag: (at, screen) => {
        const a = e.addressNow(at);
        setDragChip({ x: screen.x, y: screen.y, text: a === null ? 'Finding cross streets…' : a || 'No street names here' });
      },
      onHoverZone: (id) => postActions.setHoveredZone(id),
    });
    engine = e;
    (window as any).__engine = e; // handy for debugging in the browser console
    await e.start(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);
    setEng(e);

    // keep the C++ engine in sync with saved posts + the draft
    createEffect(() => {
      posts.forEach((p) => p.id);
      draft.kind;
      draft.at;
      draft.coordinates;
      draft.imageUrl;
      draft.comment;
      e.setPosts(posts, draft);
    });

    createEffect(() => {
      const mode = drawMode();
      if (mode) e.startDrawing(mode, (coords) => postActions.setZone(coords), () => postActions.stopDraw());
      else if (e.drawing) e.stopDrawing(false);
    });

    createEffect(() => e.setPlacingCursor(draft.placing));

    // Location row in the panel: cross streets where the draft was placed
    let addrReq = 0;
    createEffect(() => {
      const at = draft.kind === 'zone' && draft.coordinates ? centerOf(draft.coordinates) : draft.kind !== 'zone' ? draft.at : null;
      const req = ++addrReq;
      if (!at) return postActions.setDraftAddress(null);
      postActions.setDraftAddress('loading');
      e.addressAt(at).then((text) => { if (req === addrReq) postActions.setDraftAddress(text); });
    });

    // my location -> blue dot in the C++ engine; fly there on the first fix
    let flewToMe = false;
    createEffect(() => {
      const loc = myLocation();
      e.setMyLocation(loc?.at ?? null, loc?.accuracy ?? 0);
      setMyAt(e.getMyLocation()); // GPS + any adjustment the user made by dragging
      if (loc) noteAccuracy(loc.accuracy);
      if (loc && !flewToMe) {
        flewToMe = true;
        // rough desktop locations: don't zoom in so far that you can't see the area
        e.flyTo(e.getMyLocation() ?? loc.at, loc.accuracy > 1000 ? 14 : Math.max(e.zoom, 16));
      }
      if (!loc) flewToMe = false;
    });
    recenter = () => {
      const at = e.getMyLocation();
      if (at) e.flyTo(at, Math.max(e.zoom, 15));
      else startLocation();
    };

    statsTimer = window.setInterval(() => {
      const st = e.stats();
      setStats({ ...st });
      reportStats(st); // dev only: prints to the npm run dev terminal
    }, 500);
  });

  onCleanup(() => {
    clearInterval(statsTimer);
    engine?.destroy();
  });

  return (
    <div>
      <canvas ref={canvas} style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }} />

      <Show when={picking() && eng()}>
        <PickLocation engine={eng()!} />
      </Show>

      <Show when={dragChip()}>
        {(c) => (
          <div class="drag-address" style={{ left: `${c().x}px`, top: `${c().y}px` }}>{c().text}</div>
        )}
      </Show>

      <div class={`interface-layer ${picking() ? 'is-picking' : ''}`}>
        <PostComposer />
      <div class="locate-wrap">
          <Show when={locStatusText(locStatus()) || locHint()}>
            <div class="locate-toast">{locStatusText(locStatus()) || locHint()}</div>
          </Show>
          <button
            class={`locate-btn ${locStatus() === 'on' ? 'on' : ''}`}
            title={locStatus() === 'on' ? 'Center on me (long-press to turn off)' : 'Show my location'}
            onClick={() => recenter()}
            onContextMenu={(ev) => { ev.preventDefault(); stopLocation(); }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.94 3A8.99 8.99 0 0 0 13 3.06V1h-2v2.06A8.99 8.99 0 0 0 3.06 11H1v2h2.06A8.99 8.99 0 0 0 11 20.94V23h2v-2.06A8.99 8.99 0 0 0 20.94 13H23v-2h-2.06zM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" />
            </svg>
          </button>
        </div>
      </div>

      <Show when={stats()}>
        {(st) => (
          <div class="engine-stats" onClick={() => setShowStats(!showStats())} title="Click to hide/show">
            <Show when={showStats()} fallback={<span>stats</span>}>
              <div><b>{st().backend}</b> · C++ engine</div>
              <Show
                when={st().moving}
                fallback={<div>idle · redraws only when something moves</div>}
              >
                <div>{st().fps.toFixed(0)} fps while moving</div>
              </Show>
              <div>
                frame: {st().frameMs.toFixed(2)} ms = {st().budgetPct.toFixed(1)}% of the 16.7 ms budget
              </div>
              <div>tiles: {st().tiles} · build {st().tileBuildMs.toFixed(1)} ms · {st().workers} workers</div>
            </Show>
          </div>
        )}
      </Show>

      <div class="map-attribution">
        <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ·{' '}
        <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ·{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
      </div>

      <CheckoutModal />
    </div>
  );
};
