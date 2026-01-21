// Hover reveal logic
function attachHoverListeners() {
  if (!AppState.fence) return;
  
  AppState.fence.on('mouseover', onFenceHover);
  AppState.fence.on('mouseout', onFenceUnhover);
  
  console.log('🖱️ Hover listeners attached');
}

function onFenceHover() {
  const zoom = map.getZoom();
  if (zoom < ZOOM.AD_INFO_THRESHOLD) {
    AppState.hovered = true;
    updateVisibility();
    console.log('✨ Hovered - showing ad info');
  }
}

function onFenceUnhover(e) {
  const zoom = map.getZoom();
  if (zoom < ZOOM.AD_INFO_THRESHOLD) {
    // Check if moving to marker/bubble - if so, keep hover
    if (shouldMaintainHover(e)) {
      console.log('⏸️ Maintaining hover - on marker/bubble');
      return;
    }
    
    AppState.hovered = false;
    updateVisibility();
    console.log('🔄 Unhovered - back to image');
  }
}
