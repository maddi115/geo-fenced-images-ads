// Prevents hover state loss when moving between fence/marker/bubble

function isMovingToMarkerOrBubble(relatedTarget) {
  if (!relatedTarget) return false;
  
  const markerElement = AppState.marker?.getElement();
  const bubbleElement = AppState.commentBubble;
  
  // Check if moving to marker
  if (markerElement && 
      (relatedTarget === markerElement || 
       markerElement.contains(relatedTarget))) {
    return true;
  }
  
  // Check if moving to bubble
  if (bubbleElement && 
      (relatedTarget === bubbleElement || 
       bubbleElement.contains(relatedTarget))) {
    return true;
  }
  
  return false;
}

function shouldMaintainHover(event) {
  const relatedTarget = event.originalEvent?.relatedTarget;
  return isMovingToMarkerOrBubble(relatedTarget);
}
