import { Component, createEffect, onMount, onCleanup } from 'solid-js';
import { zoneState, currentImage, currentZoom } from '../../../use-cases/custom-zones/zone-store';
import { calculateViewMode, getVisibilityActions } from '../../../domain/visibility/visibility-rules';
import { ZOOM } from '../../../config-new/constants';
import type { LeafletAdapter } from '../../../infrastructure/adapters/map-adapter';
import L from 'leaflet';

interface ZoneCanvasProps {
  mapAdapter: LeafletAdapter;
}

export const ZoneCanvas: Component<ZoneCanvasProps> = (props) => {
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;

  const hexToRgb = (hex: string) => {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 153, g: 50, b: 204 };
  };

  const render = () => {
    const activeZone = zoneState.zones[zoneState.zones.length - 1];
    if (!activeZone) return;

    const map = props.mapAdapter.getMapInstance();
    const size = map.getSize();

    // SOURCE OF TRUTH: Match canvas size to map
    if (canvas.width !== size.x || canvas.height !== size.y) {
      canvas.width = size.x;
      canvas.height = size.y;
    }

    // SOURCE OF TRUTH: Position canvas using Leaflet's positioning
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

    const points = activeZone.coordinates.map(c => map.latLngToContainerPoint(c));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();

    // SOURCE OF TRUTH: shouldShowImage logic
    const zoom = currentZoom();
    const shouldShowImage = zoom < ZOOM.AD_INFO_THRESHOLD && currentImage() && !zoneState.hovered;

    if (shouldShowImage) {
      // Render image
      ctx.save();
      ctx.clip();
      const lats = activeZone.coordinates.map(c => c.lat);
      const lngs = activeZone.coordinates.map(c => c.lng);
      const bounds = L.latLngBounds(activeZone.coordinates);
      const nw = map.latLngToContainerPoint(bounds.getNorthWest());
      const se = map.latLngToContainerPoint(bounds.getSouthEast());

      if (currentImage()) {
        ctx.drawImage(currentImage()!, nw.x, nw.y, se.x - nw.x, se.y - nw.y);
      }
      ctx.restore();
    } else {
      // Render fill
      const style = activeZone.style;
      const rgb = hexToRgb(style.fillColor);
      ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${style.fillOpacity})`;
      ctx.fill();
    }

    // Render border
    const style = activeZone.style;
    const rgb = hexToRgb(style.borderColor);
    ctx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    ctx.lineWidth = style.borderWidth;
    ctx.stroke();
  };

  onMount(() => {
    const map = props.mapAdapter.getMapInstance();
    
    // SOURCE OF TRUTH: Create canvas and append to Leaflet's overlayPane
    canvas = document.createElement('canvas');
    canvas.style.position = 'absolute';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '200'; // Below fence layer (400)
    map.getPanes().overlayPane.appendChild(canvas);
    
    ctx = canvas.getContext('2d')!;

    console.log('🎨 Canvas appended to overlay pane');

    // Listen to map events
    map.on('move', render);
    map.on('moveend', render);
    map.on('zoom', render);
    map.on('zoomend', render);

    // React to state changes
    createEffect(() => {
      zoneState.zones;
      zoneState.hovered;
      currentImage();
      currentZoom();
      render();
    });
  });

  onCleanup(() => {
    const map = props.mapAdapter.getMapInstance();
    map.off('move', render);
    map.off('moveend', render);
    map.off('zoom', render);
    map.off('zoomend', render);
    if (canvas) {
      canvas.remove();
    }
  });

  return null; // Canvas is created imperatively in Leaflet's DOM
};
