function render() {
  if (typeof RenderEngine !== 'undefined') {
    RenderEngine.draw(map);
  }
  if (typeof ZoomWatcher !== 'undefined') {
    ZoomWatcher.checkPopup(map.getZoom(), map);
  }
}

// Ensure map updates on every movement
map.on('zoomend moveend', render);

function resetAll() {
  drawnItems.clearLayers();
  AppState.activePolygon = null;
  AppState.overlayImage = null;
  if (AppState.commentPopup) map.removeLayer(AppState.commentPopup);
  AppState.commentPopup = null;
  document.getElementById('upload').value = '';
  render();
}
