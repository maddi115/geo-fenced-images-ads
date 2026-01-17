// Wire up all event handlers

// Map events
map.on('zoomend', () => {
  scheduleRender();
  positionCommentBubble();
});

map.on('moveend', () => {
  scheduleRender();
  positionCommentBubble();
});

// Window resize
window.addEventListener('resize', () => {
  scheduleRender();
  positionCommentBubble();
});

// Update bubble position during drag
map.on('move', () => {
  if (AppState.commentBubble && AppState.commentBubble.style.display !== 'none') {
    positionCommentBubble();
  }
});
