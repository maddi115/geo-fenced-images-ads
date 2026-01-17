// Zoom change handling
function onZoomChange() {
  // Clear hover state - let zoom level control visibility
  AppState.hovered = false;
  
  updateVisibility();
  updateCursor();
}

function updateCursor() {
  if (!AppState.fence) return;
  
  const zoom = map.getZoom();
  const fenceElement = AppState.fence.getElement?.();
  
  if (!fenceElement) return;
  
  if (zoom < ZOOM.AD_INFO_THRESHOLD) {
    fenceElement.style.setProperty('cursor', 'pointer', 'important');
  } else {
    fenceElement.style.setProperty('cursor', '', '');
  }
}

// Attach zoom listener
map.on('zoomend', onZoomChange);
map.on('moveend', () => {
  scheduleRenderSmart('normal'); // Debounced
  positionCommentBubble();
});
