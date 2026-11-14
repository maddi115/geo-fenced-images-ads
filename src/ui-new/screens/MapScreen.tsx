import { Component, onMount, onCleanup, createEffect } from 'solid-js';
import { MapEngine } from '../../infrastructure/engine/engine';
import { PostComposer } from '../components/panel/PostComposer';
import { CheckoutModal } from '../components/panel/CheckoutModal';
import { posts, draft, drawMode, postActions } from '../../use-cases/posts/posts-store';
import { MAP_CONFIG } from '../../config-new/constants';
import './interface.css';
import '../components/map/posts.css';

// 3 ways to post:
//   1. Free  - red pixel + comment
//   2. Paid  - custom uploaded icon (fixed 225px) + comment
//   3. Paid  - custom zone upload (image fills a drawn area) + comment
// The map itself is the C++ engine in engine/src (compiled to public/engine.wasm).
export const MapScreen: Component = () => {
  let canvas!: HTMLCanvasElement;
  let engine: MapEngine | undefined;

  onMount(async () => {
    const e = new MapEngine(canvas, {
      onClick: (at) => postActions.placeAt(at),
      onHoverZone: (id) => postActions.setHoveredZone(id),
    });
    engine = e;
    (window as any).__engine = e; // handy for debugging in the browser console
    await e.start(MAP_CONFIG.initialCenter, MAP_CONFIG.initialZoom);

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
  });

  onCleanup(() => engine?.destroy());

  return (
    <div>
      <canvas ref={canvas} style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }} />

      <div class="interface-layer">
        <PostComposer />
      </div>

      <div class="map-attribution">
        <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ·{' '}
        <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ·{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>
      </div>

      <CheckoutModal />
    </div>
  );
};
