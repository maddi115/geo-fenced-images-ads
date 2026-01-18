// Manage cursor style based on zoom level

function updateFenceCursor() {
  if (!AppState.fence) return;

  const zoom = map.getZoom();
  const fenceElement = AppState.fence.getElement?.();

  if (!fenceElement) return; // Skip if fence is hidden/doesn't have DOM element

  if (zoom < 16) {
    fenceElement.style.setProperty('cursor', 'pointer', 'important');
  } else {
    fenceElement.style.setProperty('cursor', '', '');
  }
}

map.on('zoomend', updateFenceCursor);
