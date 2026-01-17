// Show/hide comment bubble above image marker with character limit and post button

function showCommentBubble() {
  if (!AppState.fence || !AppState.image) return;
  
  // Create comment bubble if doesn't exist
  if (!AppState.commentBubble) {
    const bubble = document.createElement('div');
    bubble.className = 'comment-bubble';
    
    // Textarea with 70 char limit
    const textarea = document.createElement('textarea');
    textarea.id = 'commentTextarea';
    textarea.placeholder = "Add your comment (70 chars max)...";
    textarea.value = AppState.commentText;
    textarea.maxLength = 70;
    
    // Bottom controls container
    const controls = document.createElement('div');
    controls.className = 'bubble-controls';
    
    // Character counter
    const counter = document.createElement('div');
    counter.className = 'char-counter safe';
    counter.id = 'charCounter';
    counter.textContent = '0/70';
    
    // Post button
    const postBtn = document.createElement('button');
    postBtn.className = 'post-btn';
    postBtn.id = 'postCommentBtn';
    postBtn.textContent = 'Post';
    postBtn.disabled = true;
    
    // Update counter and button on input
    textarea.addEventListener('input', (e) => {
      AppState.commentText = e.target.value;
      const length = e.target.value.length;
      const trimmedLength = e.target.value.trim().length;
      
      counter.textContent = `${length}/70`;
      
      // Update color based on length
      counter.className = 'char-counter';
      if (length >= 66) {
        counter.classList.add('danger');
      } else if (length >= 51) {
        counter.classList.add('warning');
      } else {
        counter.classList.add('safe');
      }
      
      // Enable/disable post button
      postBtn.disabled = trimmedLength === 0;
    });
    
    // Post button click handler
    postBtn.addEventListener('click', () => {
      const text = AppState.commentText.trim();
      if (text) {
        console.log('✅ Comment posted:', text);
        
        // Make textarea read-only and styled as posted
        textarea.readOnly = true;
        textarea.classList.add('posted-state');
        
        // Update counter to show posted badge
        counter.className = 'char-counter posted';
        counter.textContent = '✓ Posted';
        
        // Update button
        postBtn.textContent = 'Posted ✓';
        postBtn.classList.add('posted');
        postBtn.disabled = true;
        
        // Save posted state
        AppState.commentPosted = true;
      }
    });
    
    controls.appendChild(counter);
    controls.appendChild(postBtn);
    
    bubble.appendChild(textarea);
    bubble.appendChild(controls);
    document.body.appendChild(bubble);
    AppState.commentBubble = bubble;
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
  
  // Get pixel coordinates of marker
  const point = map.latLngToContainerPoint(targetLatLng);
  
  // Bubble dimensions
  const bubbleWidth = 240;
  const bubbleHeight = 110;
  
  // Marker dimensions
  const markerHalfSize = 40;
  
  // Arrow height from CSS
  const arrowHeight = 10;
  
  // Gap between arrow tip and marker top
  const gapAboveMarker = 15;
  
  // Calculate position
  const bubbleLeft = point.x - (bubbleWidth / 2);
  
  const markerTop = point.y - markerHalfSize;
  const arrowTip = markerTop - gapAboveMarker;
  const bubbleBottom = arrowTip - arrowHeight;
  const bubbleTop = bubbleBottom - bubbleHeight;
  
  AppState.commentBubble.style.left = bubbleLeft + 'px';
  AppState.commentBubble.style.top = bubbleTop + 'px';
}
