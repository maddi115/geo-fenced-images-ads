// Show/hide comment bubble orchestration

function showCommentBubble() {
  if (!AppState.fence || !AppState.image) return;

  // Create comment bubble if doesn't exist
  if (!AppState.commentBubble) {
    AppState.commentBubble = buildCommentBubble();
    document.body.appendChild(AppState.commentBubble);
  }

  // Position bubble above marker
  positionCommentBubble();
  AppState.commentBubble.style.display = 'block';
}

function hideCommentBubble() {
  if (AppState.commentBubble) {
    AppState.commentBubble.style.display = 'none';
  }
}
