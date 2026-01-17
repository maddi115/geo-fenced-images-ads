// Hover-to-reveal ad info functionality (temporary reveal)

function enableHoverReveal() {
  if (!map || !AppState.fence) return;
  
  // Add hover listeners to fence
  AppState.fence.on('mouseover', onFenceHoverIn);
  AppState.fence.on('mouseout', onFenceHoverOut);
  
  console.log('🖱️ Hover-to-reveal enabled');
}

function onFenceHoverIn(e) {
  const zoom = map.getZoom();
  
  // Only allow hover at zoom < 16
  if (zoom < 16) {
    revealAdInfoTemporarily();
  }
}

function onFenceHoverOut(e) {
  const zoom = map.getZoom();
  
  // Only hide if zoom < 16
  if (zoom < 16) {
    hideAdInfoTemporarily();
  }
}

function revealAdInfoTemporarily() {
  AppState.adInfoHovered = true;
  console.log('✨ Ad info revealed on hover');
  
  // Update zoom label
  const label = document.getElementById('zoomLabel');
  if (label) label.textContent = "AD INFO PREVIEW";
  
  // Show marker and comment
  showMarker();
  showCommentBubble();
  
  // Re-render to show blue fill
  scheduleRender();
}

function hideAdInfoTemporarily() {
  if (AppState.adInfoHovered) {
    AppState.adInfoHovered = false;
    console.log('🔄 Ad info hidden - back to image');
    
    // Hide marker and comment
    hideMarker();
    hideCommentBubble();
    
    // Re-render to show image
    scheduleRender();
  }
}
