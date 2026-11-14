import { Component, onMount, onCleanup, createEffect, getOwner, runWithOwner } from 'solid-js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GpuPosts } from '../components/map/gpu-posts';
import { ZoneDrawer } from '../../infrastructure/adapters/maplibre-draw';
import { PostComposer } from '../components/panel/PostComposer';
import { CheckoutModal } from '../components/panel/CheckoutModal';
import { posts, draft, drawMode, hoveredZoneId, postActions } from '../../use-cases/posts/posts-store';
import { MAP_CONFIG } from '../../config-new/constants';
import './interface.css';
import '../components/map/posts.css';

// Map style. Swap the URL to change the look.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

// 3 ways to post:
//   1. Free  - red pixel + comment
//   2. Paid  - custom uploaded icon (fixed 225px) + comment
//   3. Paid  - custom zone upload (image fills a drawn area) + comment
// Everything on the map is drawn by MapLibre on the GPU (no Leaflet, no DOM markers).
export const MapScreen: Component = () => {
  let container!: HTMLDivElement;
  let map: maplibregl.Map | undefined;

  onMount(() => {
    const owner = getOwner();
    map = new maplibregl.Map({
      container,
      style: STYLE_URL,
      center: [MAP_CONFIG.initialCenter[1], MAP_CONFIG.initialCenter[0]],
      zoom: MAP_CONFIG.initialZoom,
      minZoom: 2,
      maxZoom: MAP_CONFIG.maxZoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    (window as any).__map = map; // handy for debugging in the browser console
    const m = map;

    m.once('load', () => runWithOwner(owner, () => {
      const gpu = new GpuPosts(m, (id) => postActions.setHoveredZone(id));
      gpu.install();

      const drawer = new ZoneDrawer(
        m,
        (coords) => postActions.setZone(coords),
        () => postActions.stopDraw()
      );
      drawer.install();

      // Pixel + icon: placed with a map click
      m.on('click', (e) => {
        if (drawer.active) return;
        postActions.placeAt({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });

      // keep the GPU layers in sync with saved posts + the draft
      createEffect(() => {
        posts.forEach((p) => p.id);
        draft.kind;
        draft.at;
        draft.coordinates;
        draft.imageUrl;
        draft.comment;
        gpu.update(posts, draft);
      });

      createEffect(() => gpu.setHovered(hoveredZoneId()));

      createEffect(() => {
        const mode = drawMode();
        if (mode) drawer.start(mode);
        else if (drawer.active) drawer.stop(false);
      });

      createEffect(() => {
        m.getCanvasContainer().classList.toggle('placing', draft.placing);
      });
    }));
  });

  onCleanup(() => map?.remove());

  return (
    <div>
      <div ref={container} style={{ position: 'absolute', inset: '0' }} />

      <div class="interface-layer">
        <PostComposer />
      </div>

      <CheckoutModal />
    </div>
  );
};
