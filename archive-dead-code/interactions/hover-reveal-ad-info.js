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

  // Only allow hover at zoom < threshold
  if (zoom < ZOOM.AD_INFO_THRESHOLD) {
    revealAdInfoTemporarily();
  }
}

function onFenceHoverOut(e) {
  const zoom = map.getZoom();

  // Only hide if zoom < threshold
  if (zoom < ZOOM.AD_INFO_THRESHOLD) {
    // Check if mouse is moving to marker or bubble
    const relatedTarget = e.originalEvent?.relatedTarget;
    
    if (relatedTarget) {
      const markerElement = AppState.marker?.getElement();
      const bubbleElement = AppState.commentBubble;
      
      // Don't hide if moving to marker or its children
      if (markerElement && (relatedTarget === markerElement || markerElement.contains(relatedTarget))) {
        return;
      }
      
      // Don't hide if moving to bubble or its children
      if (bubbleElement && (relatedTarget === bubbleElement || bubbleElement.contains(relatedTarget))) {
        return;
      }
    }
    
    hideAdInfoTemporarily();
  }
}

function revealAdInfoTemporarily() {
  AppState.adInfoHovered = true;
  console.log('✨ Ad info revealed on hover');
  updateVisibility();
}

function hideAdInfoTemporarily() {
  if (AppState.adInfoHovered) {
    AppState.adInfoHovered = false;
    console.log('🔄 Ad info hidden - back to image');
    updateVisibility();
  }
}
