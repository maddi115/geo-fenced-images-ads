// Manage marker at fence center or custom location

function createMarker() {
  if (!AppState.fence) return;
  // Remove old marker
  if (AppState.marker) {
    map.removeLayer(AppState.marker);
  }
  // Create image marker icon
  const icon = L.divIcon({
    className: 'image-marker',
    html: AppState.image ? `<img src="${AppState.image.src}" />` : '<div class="placeholder-marker"></div>',
    iconSize: [MARKER.SIZE, MARKER.SIZE],
    iconAnchor: [MARKER.HALF_SIZE, MARKER.HALF_SIZE]
  });
  // Add marker at center by default
  const center = AppState.fence.getBounds().getCenter();
  AppState.marker = L.marker(center, { icon }).addTo(map);
  // Show/hide based on zoom and hover state
  const zoom = map.getZoom();
  if (zoom >= ZOOM.AD_INFO_THRESHOLD || AppState.adInfoHovered) {
    showMarker();
  } else {
    hideMarker();
  }
  console.log('📍 Marker created at center');
}

function placeMarkerAt(latlng) {
  if (!AppState.fence) return;
  // Remove old marker
  if (AppState.marker) {
    map.removeLayer(AppState.marker);
  }
  // Create image marker icon
  const icon = L.divIcon({
    className: 'image-marker',
    html: AppState.image ? `<img src="${AppState.image.src}" />` : '<div class="placeholder-marker"></div>',
    iconSize: [MARKER.SIZE, MARKER.SIZE],
    iconAnchor: [MARKER.HALF_SIZE, MARKER.HALF_SIZE]
  });
  // Add marker at clicked location
  AppState.marker = L.marker(latlng, { icon }).addTo(map);
  // Show/hide based on zoom and hover state
  const zoom = map.getZoom();
  if (zoom >= ZOOM.AD_INFO_THRESHOLD || AppState.adInfoHovered) {
    showMarker();
  } else {
    hideMarker();
  }
  // Update comment bubble position
  positionCommentBubble();
  console.log('📍 Marker placed at:', latlng);
}

function updateMarker() {
  // Don't auto-update if user manually placed marker
}

function showMarker() {
  if (AppState.marker) {
    AppState.marker.setOpacity(1);
    console.log('👁️ Marker visible');
  }
}

function hideMarker() {
  if (AppState.marker) {
    AppState.marker.setOpacity(0);
    console.log('🙈 Marker hidden');
  }
}
