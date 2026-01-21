// Marker creation and visibility control
function createMarker() {
  if (!AppState.fence) return;
  
  // Remove old marker
  if (AppState.marker) {
    map.removeLayer(AppState.marker);
  }
  
  // Create marker icon
  const icon = L.divIcon({
    className: 'image-marker',
    html: AppState.image ? `<img src="${AppState.image.src}" />` : '<div class="placeholder-marker"></div>',
    iconSize: [MARKER.SIZE, MARKER.SIZE],
    iconAnchor: [MARKER.HALF_SIZE, MARKER.HALF_SIZE]
  });
  
  // Place at fence center
  const center = AppState.fence.getBounds().getCenter();
  AppState.marker = L.marker(center, { icon }).addTo(map);
  AppState.marker.setOpacity(0); // Start hidden
  
  console.log('📍 Marker created');
}

function showMarker() {
  if (AppState.marker) {
    AppState.marker.setOpacity(1);
  }
}

function hideMarker() {
  if (AppState.marker) {
    AppState.marker.setOpacity(0);
  }
}
