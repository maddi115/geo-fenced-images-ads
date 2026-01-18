// Disable double-click zoom on map

function disableDoubleClickZoom() {
  if (!map) {
    console.error('Map not initialized');
    return;
  }
  
  map.doubleClickZoom.disable();
  console.log('🚫 Double-click zoom disabled');
}

// Auto-initialize when map is ready
if (map) {
  disableDoubleClickZoom();
}
