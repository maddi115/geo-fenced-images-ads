// Fence creation and lifecycle
map.on(L.Draw.Event.DRAWSTART, (e) => {
  console.log('🟡 Drawing started');
});

map.on(L.Draw.Event.CREATED, (e) => {
  // Clear previous
  AppState.drawnItems.clearLayers();
  
  // Store fence
  AppState.fence = e.layer;
  AppState.drawnItems.addLayer(AppState.fence);
  
  // Hide Leaflet's rendering BUT keep it barely visible for mouse events
  AppState.fence.setStyle({
    fillOpacity: 0.001,
    opacity: 0.001,
    fillColor: '#000000',
    color: '#000000'
  });
  
  // Invalidate cache on new fence
  invalidateImageCache();
  
  // Create marker
  createMarker();
  
  // Attach hover
  attachHoverListeners();
  
  // Cache if image exists
  if (AppState.image) {
    cacheClippedImage();
  }
  
  // Update view
  updateVisibility();
  
  console.log('✅ Fence created');
});

map.on(L.Draw.Event.DRAWSTOP, (e) => {
  if (!AppState.fence) {
    console.log('❌ Drawing cancelled');
  }
});
