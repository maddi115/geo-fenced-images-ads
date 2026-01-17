// Master visibility controller - single decision point
function updateVisibility() {
  const zoom = map.getZoom();
  const label = document.getElementById('zoomLabel');
  
  // Decision logic
  if (zoom >= ZOOM.AD_INFO_THRESHOLD) {
    // Technical view (zoomed in)
    label.textContent = "TECHNICAL VIEW";
    showMarker();
    showCommentBubble();
  } else if (AppState.hovered) {
    // Hover preview
    label.textContent = "AD INFO PREVIEW";
    showMarker();
    showCommentBubble();
  } else if (AppState.image) {
    // Image view
    label.textContent = "MACRO VIEW";
    hideMarker();
    hideCommentBubble();
  } else {
    // Standby
    label.textContent = "STANDBY";
    hideMarker();
    hideCommentBubble();
  }
  
  scheduleRender();
}
