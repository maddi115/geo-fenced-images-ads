import { Component, createSignal, createEffect, onCleanup } from 'solid-js';
import { zoneActions, currentZoom } from '../../../use-cases/custom-zones/zone-store';
import { COMMENT, ZOOM } from '../../../config-new/constants';
import './comment-bubble.css';

interface CommentBubbleProps {
  markerElement: HTMLElement;
  show: boolean;
  onBubbleElementChange: (element: HTMLElement | null) => void;
}

export const CommentBubble: Component<CommentBubbleProps> = (props) => {
  const [text, setText] = createSignal('');
  const [posted, setPosted] = createSignal(false);
  let bubbleRef: HTMLDivElement | undefined;

  // New Arch: Use an effect to sync SolidJS DOM with Leaflet's DOM
  createEffect(() => {
    const parent = props.markerElement;
    if (bubbleRef && parent) {
      parent.appendChild(bubbleRef); // The one necessary imperative "handshake"
      props.onBubbleElementChange(bubbleRef);
    }
  });

  const handleMouseOut = (e: MouseEvent) => {
    const related = e.relatedTarget as HTMLElement;
    if (related && (props.markerElement.contains(related) || bubbleRef?.contains(related))) return;
    if (currentZoom() < ZOOM.AD_INFO_THRESHOLD) zoneActions.setHovered(false);
  };

  return (
    <div
      ref={bubbleRef!}
      class="comment-bubble"
      style={{ display: props.show ? 'block' : 'none' }}
      onMouseOut={handleMouseOut}
    >
      <textarea
        placeholder={`Add your comment (${COMMENT.CHAR_LIMIT} chars max)...`}
        maxLength={COMMENT.CHAR_LIMIT}
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        readOnly={posted()}
        class={posted() ? 'posted-state' : ''}
      />
      <div class="bubble-controls">
        <div class={`char-counter ${posted() ? 'posted' : text().length >= COMMENT.CHAR_DANGER_THRESHOLD ? 'danger' : text().length >= COMMENT.CHAR_WARNING_THRESHOLD ? 'warning' : 'safe'}`}>
          {posted() ? '✓ Posted' : `${text().length}/${COMMENT.CHAR_LIMIT}`}
        </div>
        <button
          class={`post-btn ${posted() ? 'posted' : ''}`}
          disabled={!text().trim() || posted()}
          onClick={() => setPosted(true)}
        >
          {posted() ? 'Posted ✓' : 'Post'}
        </button>
      </div>
    </div>
  );
};
