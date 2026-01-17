// Control view based on zoom level and hover state
function updateZoomView(zoom) {
  const label = document.getElementById('zoomLabel');
  
  // Zoom 16+: Always show ad info
  if (zoom >= 16) {
    label.textContent = "TECHNICAL VIEW";
    showCommentBubble();
    showMarker();
  }
  // Hovered at lower zoom
  else if (AppState.adInfoHovered && zoom < 16) {
    label.textContent = "AD INFO PREVIEW";
    showCommentBubble();
    showMarker();
  }
  // Normal image view
  else if (zoom < 16 && AppState.image) {
    label.textContent = "MACRO VIEW";
    hideCommentBubble();
    hideMarker();
  }
  // No image uploaded yet
  else {
    label.textContent = "STANDBY";
    hideCommentBubble();
    hideMarker();
  }
}
