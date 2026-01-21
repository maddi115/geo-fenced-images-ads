import { Component, onMount, createEffect, onCleanup, createSignal } from 'solid-js';
import { zoneState, currentImage, currentZoom } from '../../../use-cases/custom-zones/zone-store';
import { calculateViewMode, getVisibilityActions } from '../../../domain/visibility/visibility-rules';
import { ZOOM, MARKER } from '../../../config-new/constants';
import { CommentBubble } from './CommentBubble';
import type { LeafletAdapter } from '../../../infrastructure/adapters/map-adapter';
import L from 'leaflet';
import './marker.css';

interface ZoneMarkerProps {
  mapAdapter: LeafletAdapter;
  onMarkerElementChange: (element: HTMLElement | null) => void;
  onBubbleElementChange: (element: HTMLElement | null) => void;
}

export const ZoneMarker: Component<ZoneMarkerProps> = (props) => {
  let marker: L.Marker | null = null;
  const [markerElement, setMarkerElement] = createSignal<HTMLElement | null>(null);

  onMount(() => {
    createEffect(() => {
      const activeZone = zoneState.zones[zoneState.zones.length - 1];
      if (!activeZone) return;
      const image = currentImage();
      const map = props.mapAdapter.getMapInstance();

      if (marker) map.removeLayer(marker);

      const icon = L.divIcon({
        className: 'image-marker',
        html: image ? `<img src="${image.src}" />` : '<div class="placeholder-marker"></div>',
        iconSize: [MARKER.SIZE, MARKER.SIZE],
        iconAnchor: [MARKER.HALF_SIZE, MARKER.HALF_SIZE]
      });

      const lats = activeZone.coordinates.map(c => c.lat);
      const lngs = activeZone.coordinates.map(c => c.lng);
      const center = [(Math.max(...lats) + Math.min(...lats)) / 2, (Math.max(...lngs) + Math.min(...lngs)) / 2];

      marker = L.marker(center as L.LatLngExpression, { icon }).addTo(map);
      const el = marker.getElement();
      if (el) {
        setMarkerElement(el);
        props.onMarkerElementChange(el);
      }
    });

    createEffect(() => {
      if (!marker) return;
      const mode = calculateViewMode({
        zoom: currentZoom(),
        zoomThreshold: ZOOM.AD_INFO_THRESHOLD,
        hasImage: !!currentImage(),
        isHovered: zoneState.hovered,
      });
      const actions = getVisibilityActions(mode);
      marker.setOpacity(actions.showMarker ? 1 : 0);
    });
  });

  onCleanup(() => {
    if (marker) props.mapAdapter.getMapInstance().removeLayer(marker);
  });

  return (
    <>
      {markerElement() && (
        <CommentBubble 
          markerElement={markerElement()!} 
          show={calculateViewMode({
            zoom: currentZoom(),
            zoomThreshold: ZOOM.AD_INFO_THRESHOLD,
            hasImage: !!currentImage(),
            isHovered: zoneState.hovered,
          }) === 'preview' || calculateViewMode({
            zoom: currentZoom(),
            zoomThreshold: ZOOM.AD_INFO_THRESHOLD,
            hasImage: !!currentImage(),
            isHovered: zoneState.hovered,
          }) === 'technical'} 
          onBubbleElementChange={props.onBubbleElementChange} 
        />
      )}
    </>
  );
};
