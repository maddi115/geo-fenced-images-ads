// Comment bubble event handlers

function setupBubbleEvents(textarea, counter, postBtn) {
  // Input event handler
  textarea.addEventListener('input', (e) => {
    AppState.commentText = e.target.value;
    const length = e.target.value.length;
    const trimmedLength = e.target.value.trim().length;

    counter.textContent = `${length}/${COMMENT.CHAR_LIMIT}`;

    // Update color based on length
    counter.className = 'char-counter';
    if (length >= COMMENT.CHAR_DANGER_THRESHOLD) {
      counter.classList.add('danger');
    } else if (length >= COMMENT.CHAR_WARNING_THRESHOLD) {
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
}
