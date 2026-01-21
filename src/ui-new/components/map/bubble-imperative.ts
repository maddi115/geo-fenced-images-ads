import { COMMENT } from '../../../config-new/constants';
import './comment-bubble.css';

let commentBubble: HTMLDivElement | null = null;
let commentText = '';
let commentPosted = false;

function createElement(tag: string, className = '', attrs: any = {}): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'textContent') el.textContent = value as string;
    else (el as any)[key] = value;
  });
  return el;
}

export function createCommentBubble(): HTMLDivElement {
  const bubble = createElement('div', 'comment-bubble') as HTMLDivElement;

  // Textarea
  const textarea = createElement('textarea', '', {
    placeholder: `Add your comment (${COMMENT.CHAR_LIMIT} chars max)...`,
    maxLength: COMMENT.CHAR_LIMIT
  }) as HTMLTextAreaElement;
  textarea.value = commentText;

  // Controls
  const controls = createElement('div', 'bubble-controls');
  const counter = createElement('div', 'char-counter safe', {
    textContent: `0/${COMMENT.CHAR_LIMIT}`
  });
  const postBtn = createElement('button', 'post-btn', {
    textContent: 'Post',
    disabled: true
  }) as HTMLButtonElement;

  controls.appendChild(counter);
  controls.appendChild(postBtn);
  bubble.appendChild(textarea);
  bubble.appendChild(controls);

  // Events (matching old comment-component.js)
  textarea.addEventListener('input', (e) => {
    const target = e.target as HTMLTextAreaElement;
    commentText = target.value;
    const length = target.value.length;
    const trimmedLength = target.value.trim().length;

    counter.textContent = `${length}/${COMMENT.CHAR_LIMIT}`;
    counter.className = 'char-counter';
    if (length >= COMMENT.CHAR_DANGER_THRESHOLD) counter.classList.add('danger');
    else if (length >= COMMENT.CHAR_WARNING_THRESHOLD) counter.classList.add('warning');
    else counter.classList.add('safe');

    postBtn.disabled = trimmedLength === 0;
  });

  postBtn.addEventListener('click', () => {
    const text = commentText.trim();
    if (text) {
      textarea.readOnly = true;
      textarea.classList.add('posted-state');
      counter.className = 'char-counter posted';
      counter.textContent = '✓ Posted';
      postBtn.textContent = 'Posted ✓';
      postBtn.classList.add('posted');
      postBtn.disabled = true;
      commentPosted = true;
      console.log('✅ Comment posted:', text);
    }
  });

  return bubble;
}

export function showCommentBubble(markerElement: HTMLElement | null) {
  if (!markerElement) return;

  if (!commentBubble) {
    commentBubble = createCommentBubble();
    markerElement.appendChild(commentBubble);
  }

  commentBubble.style.display = 'block';
}

export function hideCommentBubble() {
  if (commentBubble) {
    commentBubble.style.display = 'none';
  }
}

export function getCommentBubbleElement(): HTMLElement | null {
  return commentBubble;
}

export function destroyCommentBubble() {
  if (commentBubble) {
    commentBubble.remove();
    commentBubble = null;
    commentText = '';
    commentPosted = false;
  }
}
