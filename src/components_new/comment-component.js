// Comment bubble - full lifecycle
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
  if (!AppState.fence || !AppState.image) return;
  
  if (!AppState.commentBubble) {
    AppState.commentBubble = createCommentBubble();
    document.body.appendChild(AppState.commentBubble);
  }
  
  positionCommentBubble();
  AppState.commentBubble.style.display = 'block';
}

function hideCommentBubble() {
  if (AppState.commentBubble) {
    AppState.commentBubble.style.display = 'none';
  }
}

function positionCommentBubble() {
  if (!AppState.commentBubble) return;
  
  let targetLatLng;
  if (AppState.marker) {
    targetLatLng = AppState.marker.getLatLng();
  } else if (AppState.fence) {
    targetLatLng = AppState.fence.getBounds().getCenter();
  } else {
    return;
  }
  
  const point = map.latLngToContainerPoint(targetLatLng);
  const bubbleLeft = point.x - (BUBBLE.WIDTH / 2);
  const markerTop = point.y - MARKER.HALF_SIZE;
  const arrowTip = markerTop - BUBBLE.GAP_ABOVE_MARKER;
  const bubbleBottom = arrowTip - BUBBLE.ARROW_HEIGHT;
  const bubbleTop = bubbleBottom - BUBBLE.HEIGHT;
  
  AppState.commentBubble.style.left = bubbleLeft + 'px';
  AppState.commentBubble.style.top = bubbleTop + 'px';
}
