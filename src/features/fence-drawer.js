// Handle fence creation
map.on(L.Draw.Event.CREATED, (e) => {
  // Clear previous fence
  AppState.drawnItems.clearLayers();
  
  // Store new fence
  AppState.fence = e.layer;
  AppState.drawnItems.addLayer(AppState.fence);
  
  // Create marker at center
  createMarker();
  
  // Render
  scheduleRender();
});
