// Comment bubble DOM creation

function buildCommentBubble() {
  const bubble = createElement('div', 'comment-bubble');

  // Textarea
  const textarea = createElement('textarea', '', {
    id: 'commentTextarea',
    placeholder: `Add your comment (${COMMENT.CHAR_LIMIT} chars max)...`,
    maxLength: COMMENT.CHAR_LIMIT
  });
  textarea.value = AppState.commentText;

  // Controls container
  const controls = createElement('div', 'bubble-controls');

  // Character counter
  const counter = createElement('div', 'char-counter safe', {
    id: 'charCounter',
    textContent: `0/${COMMENT.CHAR_LIMIT}`
  });

  // Post button
  const postBtn = createElement('button', 'post-btn', {
    id: 'postCommentBtn',
    textContent: 'Post',
    disabled: true
  });

  appendChildren(controls, [counter, postBtn]);
  appendChildren(bubble, [textarea, controls]);

  // Setup event listeners
  setupBubbleEvents(textarea, counter, postBtn);

  return bubble;
}
