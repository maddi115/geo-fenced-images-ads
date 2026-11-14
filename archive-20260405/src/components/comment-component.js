// Comment bubble - attached to marker DOM for smooth movement
function createCommentBubble() {
  const bubble = createElement('div', 'comment-bubble');
  
  // Textarea
  const textarea = createElement('textarea', '', {
    id: 'commentTextarea',
    placeholder: `Add your comment (${COMMENT.CHAR_LIMIT} chars max)...`,
    maxLength: COMMENT.CHAR_LIMIT
  });
  textarea.value = AppState.commentText;

  // Controls
  const controls = createElement('div', 'bubble-controls');
  const counter = createElement('div', 'char-counter safe', {
    id: 'charCounter',
    textContent: `0/${COMMENT.CHAR_LIMIT}`
  });
  const postBtn = createElement('button', 'post-btn', {
    id: 'postCommentBtn',
    textContent: 'Post',
    disabled: true
  });

  appendChildren(controls, [counter, postBtn]);
  appendChildren(bubble, [textarea, controls]);

  // Events
  textarea.addEventListener('input', (e) => {
    AppState.commentText = e.target.value;
    const length = e.target.value.length;
    const trimmedLength = e.target.value.trim().length;

    counter.textContent = `${length}/${COMMENT.CHAR_LIMIT}`;
    counter.className = 'char-counter';
    if (length >= COMMENT.CHAR_DANGER_THRESHOLD) counter.classList.add('danger');
    else if (length >= COMMENT.CHAR_WARNING_THRESHOLD) counter.classList.add('warning');
    else counter.classList.add('safe');

    postBtn.disabled = trimmedLength === 0;
  });

  postBtn.addEventListener('click', () => {
    const text = AppState.commentText.trim();
    if (text) {
      textarea.readOnly = true;
      textarea.classList.add('posted-state');
      counter.className = 'char-counter posted';
      counter.textContent = '✓ Posted';
      postBtn.textContent = 'Posted ✓';
      postBtn.classList.add('posted');
      postBtn.disabled = true;
      AppState.commentPosted = true;
      console.log('✅ Comment posted:', text);
    }
  });

  return bubble;
}

function showCommentBubble() {
  if (!AppState.fence || !AppState.image || !AppState.marker) return;

  if (!AppState.commentBubble) {
    AppState.commentBubble = createCommentBubble();
    
    // Attach bubble to marker's DOM element
    const markerElement = AppState.marker.getElement();
    if (markerElement) {
      markerElement.appendChild(AppState.commentBubble);
    }
  }

  AppState.commentBubble.style.display = 'block';
}

function hideCommentBubble() {
  if (AppState.commentBubble) {
    AppState.commentBubble.style.display = 'none';
  }
}

// No longer needed - bubble moves with marker automatically
function positionCommentBubble() {
  // Kept for backward compatibility but does nothing
}
