// Control view based on zoom level and hover state
function updateZoomView(zoom) {
  // Clear hover state when zooming - let zoom level dictate visibility
  if (zoom < ZOOM.AD_INFO_THRESHOLD && AppState.adInfoHovered) {
    AppState.adInfoHovered = false;
  }
  
  updateVisibility();
}
