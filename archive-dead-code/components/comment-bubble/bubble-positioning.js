// Comment bubble positioning logic
function positionCommentBubble() {
  if (!AppState.commentBubble) return;

  // Position relative to marker if it exists, otherwise fence center
  let targetLatLng;
  if (AppState.marker) {
    targetLatLng = AppState.marker.getLatLng();
  } else if (AppState.fence) {
    targetLatLng = AppState.fence.getBounds().getCenter();
  } else {
    return;
  }

  // Get pixel coordinates of marker center
  const point = map.latLngToContainerPoint(targetLatLng);
  
  // Horizontal: center bubble above marker
  const bubbleLeft = point.x - (BUBBLE.WIDTH / 2);
  
  // Vertical: position bubble so arrow points to top of marker
  const markerTop = point.y - MARKER.HALF_SIZE;
  const arrowTip = markerTop - BUBBLE.GAP_ABOVE_MARKER;
  const bubbleBottom = arrowTip - BUBBLE.ARROW_HEIGHT;
  const bubbleTop = bubbleBottom - BUBBLE.HEIGHT;

  AppState.commentBubble.style.left = bubbleLeft + 'px';
  AppState.commentBubble.style.top = bubbleTop + 'px';
}
