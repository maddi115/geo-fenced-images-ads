// Control view based on zoom level
function updateZoomView(zoom) {
  const label = document.getElementById('zoomLabel');
  
  if (zoom >= 17 && AppState.fence) {
    label.textContent = "TECHNICAL VIEW";
    showCommentBubble();
    showMarker();
  } else if (zoom <= 16 && AppState.image) {
    label.textContent = "MACRO VIEW";
    hideCommentBubble();
    hideMarker();
  } else {
    label.textContent = "STANDBY";
    hideCommentBubble();
    hideMarker();
  }
}
