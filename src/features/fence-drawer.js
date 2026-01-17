// Handle fence creation with state tracking
map.on(L.Draw.Event.DRAWSTART, (e) => {
  onFenceDrawStart();
});

map.on(L.Draw.Event.CREATED, (e) => {
  // Clear previous fence
  AppState.drawnItems.clearLayers();
  
  // Store new fence
  AppState.fence = e.layer;
  AppState.drawnItems.addLayer(AppState.fence);
  
  // Mark as placed
  onFencePlaced();
  
  // Create marker at center
  createMarker();
  
  // Enable hover-to-reveal (replaces click)
  enableHoverReveal();
  
  // Render
  scheduleRender();
});

map.on(L.Draw.Event.DRAWSTOP, (e) => {
  if (!AppState.fence) {
    onFenceDrawCancel();
  }
});
