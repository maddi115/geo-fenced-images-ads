// Manage cursor style based on zoom level

function updateFenceCursor() {
  if (!AppState.fence) return;
  
  const zoom = map.getZoom();
  
  if (zoom < 16) {
    // Enable pointer cursor (hoverable)
    AppState.fence.getElement()?.style.setProperty('cursor', 'pointer', 'important');
  } else {
    // Disable pointer cursor at zoom 16+
    AppState.fence.getElement()?.style.setProperty('cursor', '', '');
  }
}

// Update cursor on zoom change
map.on('zoomend', updateFenceCursor);
