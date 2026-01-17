// Centralized visibility control for marker and comment bubble

function updateVisibility() {
  const zoom = map.getZoom();
  const label = document.getElementById('zoomLabel');

  // Zoom 16+: Always show ad info (technical view)
  if (zoom >= ZOOM.AD_INFO_THRESHOLD) {
    label.textContent = "TECHNICAL VIEW";
    showAdInfo();
  }
  // Hovered at lower zoom (preview)
  else if (AppState.adInfoHovered && zoom < ZOOM.AD_INFO_THRESHOLD) {
    label.textContent = "AD INFO PREVIEW";
    showAdInfo();
  }
  // Normal image view
  else if (zoom < ZOOM.AD_INFO_THRESHOLD && AppState.image) {
    label.textContent = "MACRO VIEW";
    hideAdInfo();
  }
  // No image uploaded yet
  else {
    label.textContent = "STANDBY";
    hideAdInfo();
  }
}

function showAdInfo() {
  showMarker();
  showCommentBubble();
  scheduleRender();
}

function hideAdInfo() {
  hideMarker();
  hideCommentBubble();
  scheduleRender();
}
