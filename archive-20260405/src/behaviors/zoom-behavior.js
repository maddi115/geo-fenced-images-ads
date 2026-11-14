// Zoom change handling
function onZoomChange() {
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

map.on('zoomend', onZoomChange);

// Render continuously during pan (no delay)
map.on('move', scheduleRender);

// Update bubble position when pan completes
map.on('moveend', () => {
  scheduleRender();
  positionCommentBubble();
});
