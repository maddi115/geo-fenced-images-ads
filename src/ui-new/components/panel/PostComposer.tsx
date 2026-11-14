import { Component, For, Show } from 'solid-js';
import { draft, posts, message, busy, drawMode, postActions, PRICE_BY_KIND, missingForDraft } from '../../../use-cases/posts/posts-store';
import type { PostKind } from '../../../use-cases/posts/post-schemas';
import { formatPrice } from '../../../infrastructure/payments/checkout';
import { COMMENT, ICON } from '../../../config-new/constants';

const KINDS: { kind: PostKind; title: string; sub: string }[] = [
  { kind: 'pixel', title: 'Red pixel', sub: 'Free' },
  { kind: 'icon', title: 'Custom icon', sub: `${ICON.SIZE}px · ${formatPrice(PRICE_BY_KIND.icon)}` },
  { kind: 'zone', title: 'Zone image', sub: `Draw area · ${formatPrice(PRICE_BY_KIND.zone)}` },
];

export const PostComposer: Component = () => {
  const price = () => PRICE_BY_KIND[draft.kind];
  const count = () => draft.comment.length;
  const counterClass = () =>
    count() >= COMMENT.CHAR_DANGER_THRESHOLD ? 'danger' : count() >= COMMENT.CHAR_WARNING_THRESHOLD ? 'warning' : 'safe';
  const hasDraftContent = () => !!(draft.at || draft.coordinates || draft.imageUrl || draft.comment);

  return (
    <div class="composer">
      <div class="composer-title">Post on the map</div>

      <div class="kind-tabs">
        <For each={KINDS}>
          {(k) => (
            <button
              class={`kind-tab ${draft.kind === k.kind ? 'active' : ''}`}
              onClick={() => postActions.setKind(k.kind)}
            >
              <span class="kind-title">{k.title}</span>
              <span class="kind-sub">{k.sub}</span>
            </button>
          )}
        </For>
      </div>

      <label class="field-label">Comment</label>
      <textarea
        class="composer-input"
        maxLength={COMMENT.CHAR_LIMIT}
        placeholder={`Say something (${COMMENT.CHAR_LIMIT} chars max)`}
        value={draft.comment}
        onInput={(e) => postActions.setComment(e.currentTarget.value)}
      />
      <div class={`char-counter ${counterClass()}`}>{count()}/{COMMENT.CHAR_LIMIT}</div>

      <Show when={draft.kind !== 'pixel'}>
        <label class="field-label">Image</label>
        <div class="image-row">
          <Show when={draft.imageUrl}>
            <img class="image-preview" src={draft.imageUrl!} alt="" />
          </Show>
          <label class="btn btn-secondary file-btn">
            {draft.imageUrl ? 'Change image' : 'Upload image'}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                postActions.setImage(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </Show>

      <Show
        when={draft.kind !== 'zone'}
        fallback={
          <>
            <div class="draw-row">
              <button
                class={`btn btn-secondary ${drawMode() === 'rect' ? 'active-tool' : ''}`}
                onClick={() => (drawMode() === 'rect' ? postActions.stopDraw() : postActions.startDraw('rect'))}
              >
                ▭ Rectangle
              </button>
              <button
                class={`btn btn-secondary ${drawMode() === 'poly' ? 'active-tool' : ''}`}
                onClick={() => (drawMode() === 'poly' ? postActions.stopDraw() : postActions.startDraw('poly'))}
              >
                ⬟ Shape
              </button>
            </div>
            <Show when={draft.coordinates && !drawMode()}>
              <div class="hint">✓ Zone drawn. Draw again to replace it.</div>
            </Show>
          </>
        }
      >
        <button class="btn btn-secondary" disabled={draft.placing} onClick={() => postActions.startPlacing()}>
          {draft.placing ? 'Click the map…' : draft.at ? 'Move it' : 'Place on map'}
        </button>
      </Show>

      <button
        class="btn btn-primary"
        disabled={busy() || !!missingForDraft(draft)}
        title={missingForDraft(draft) ?? ''}
        onClick={() => postActions.submit()}
      >
        {price() > 0 ? `Pay ${formatPrice(price())} & post` : 'Post for free'}
      </button>

      <Show when={missingForDraft(draft)}>
        <div class="hint">Next: {missingForDraft(draft)}</div>
      </Show>
      <Show when={message()}>
        <div class="composer-message">{message()}</div>
      </Show>

      <div class="composer-footer">
        <span>{posts.length} post{posts.length === 1 ? '' : 's'} saved</span>
        <span class="footer-actions">
          <Show when={hasDraftContent()}>
            <button class="link-btn" onClick={() => postActions.cancelDraft()}>Cancel</button>
          </Show>
          <Show when={posts.length > 0}>
            <button
              class="link-btn danger"
              onClick={() => {
                if (confirm('Delete all saved posts in this browser?')) postActions.clearAll();
              }}
            >
              Clear all
            </button>
          </Show>
        </span>
      </div>
    </div>
  );
};
