import L from 'leaflet';
import { MARKER } from '../../../config-new/constants';

let marker: L.Marker | null = null;

export function createMarker(
  map: L.Map,
  center: L.LatLngExpression,
  image: HTMLImageElement | null
) {
  // Remove old marker
  if (marker) {
    map.removeLayer(marker);
  }

  // Create icon (matching old marker-component.js)
  const html = image 
    ? `<img src="${image.src}" />` 
    : '<div class="placeholder-marker"></div>';

  const icon = L.divIcon({
    className: 'image-marker',
    html,
    iconSize: [MARKER.SIZE, MARKER.SIZE],
    iconAnchor: [MARKER.HALF_SIZE, MARKER.HALF_SIZE]
  });

  // Create and add marker
  marker = L.marker(center, { icon }).addTo(map);
  marker.setOpacity(0); // Start hidden
  
  console.log('📍 Marker created');
  return marker;
}

export function showMarker() {
  if (marker) {
    marker.setOpacity(1);
  }
}

export function hideMarker() {
  if (marker) {
    marker.setOpacity(0);
  }
}

export function getMarkerElement(): HTMLElement | null {
  return marker?.getElement() ?? null;
}

export function destroyMarker(map: L.Map) {
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
}
