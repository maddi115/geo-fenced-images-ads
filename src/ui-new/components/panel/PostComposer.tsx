import { Component, For, Show, createSignal, createEffect, on } from 'solid-js';
import {
  draft, posts, message, busy, drawMode, draftAddress, picking, postActions, PRICE_BY_KIND, missingForDraft,
} from '../../../use-cases/posts/posts-store';
import type { PostKind } from '../../../use-cases/posts/post-schemas';
import { formatPrice } from '../../../infrastructure/payments/checkout';
import { COMMENT, LIFETIME_LABEL, PROFILE } from '../../../config-new/constants';
import { username, avatar, setName, setAvatarFile, removeAvatar, shortName, avatarColor } from '../../../infrastructure/identity/profile';
import { getMyKeys } from '../../../infrastructure/identity/keys';

const KINDS: { kind: PostKind; title: string; sub: string }[] = [
  { kind: 'pixel', title: 'Red pixel', sub: `Free · ${LIFETIME_LABEL.pixel}` },
  { kind: 'icon', title: 'Custom icon', sub: `${formatPrice(PRICE_BY_KIND.icon)} · ${LIFETIME_LABEL.icon}` },
  { kind: 'zone', title: 'Zone image', sub: `${formatPrice(PRICE_BY_KIND.zone)} · ${LIFETIME_LABEL.zone}` },
];

// your username + profile picture (shown on every post you make)
const ProfileRow: Component = () => {
  const [editing, setEditing] = createSignal(false);
  const [text, setText] = createSignal('');
  const [error, setError] = createSignal('');
  const [color, setColor] = createSignal('#1a73e8');
  getMyKeys().then((k) => setColor(avatarColor(k.publicKey))).catch(() => {});
  const save = () => {
    const err = setName(text());
    if (err) setError(err);
    else { setError(''); setEditing(false); }
  };
  return (
    <div class="profile-row">
      <label class="avatar-btn" title="Change profile picture" style={{ background: color() }}>
        <Show when={avatar()} fallback={<span class="avatar-letter">{username().charAt(0).toUpperCase()}</span>}>
          <img src={avatar()!} alt="" />
        </Show>
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const err = await setAvatarFile(e.currentTarget.files?.[0]);
            setError(err ?? '');
            e.currentTarget.value = '';
          }}
        />
      </label>
      <Show
        when={editing()}
        fallback={
          <>
            <span class="profile-name">{username()}</span>
            <button class="link-btn" onClick={() => { setText(shortName(username()).slice(0, PROFILE.NAME_MAX_LETTERS)); setEditing(true); }}>
              Edit name
            </button>
            <Show when={avatar()}>
              <button class="link-btn" onClick={() => removeAvatar()}>Remove photo</button>
            </Show>
          </>
        }
      >
        <input
          class="name-input"
          maxLength={PROFILE.NAME_MAX_LETTERS}
          value={text()}
          placeholder="Name"
          autofocus
          onInput={(e) => setText(e.currentTarget.value.replace(/[^A-Za-z]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        />
        <button class="link-btn" onClick={save}>Save</button>
        <button class="link-btn" onClick={() => { setEditing(false); setError(''); }}>Cancel</button>
      </Show>
      <Show when={error()}>
        <span class="profile-error">{error()}</span>
      </Show>
    </div>
  );
};

const Pin = (props: { muted?: boolean }) => (
  <svg class="pin" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      fill={props.muted ? '#9aa0a6' : '#ea4335'}
      d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"
    />
  </svg>
);

const isPhone = () => window.matchMedia('(max-width: 640px)').matches;

export const PostComposer: Component = () => {
  // phones: start folded so the map has the screen
  const [collapsed, setCollapsed] = createSignal(isPhone());
  // phones: fold away while placing / drawing on the map, reopen when done
  let autoFolded = false;
  createEffect(on(() => draft.placing || picking() || !!drawMode(), (busyOnMap) => {
    if (!isPhone()) return;
    if (busyOnMap && !collapsed()) { autoFolded = true; setCollapsed(true); }
    else if (!busyOnMap && autoFolded) { autoFolded = false; setCollapsed(false); }
  }, { defer: true }));
  const price = () => PRICE_BY_KIND[draft.kind];
  const count = () => draft.comment.length;
  const counterClass = () =>
    count() >= COMMENT.CHAR_DANGER_THRESHOLD ? 'danger' : count() >= COMMENT.CHAR_WARNING_THRESHOLD ? 'warning' : 'safe';
  const hasDraftContent = () => !!(draft.at || draft.coordinates || draft.imageUrl || draft.comment);
  const placed = () => (draft.kind === 'zone' ? !!draft.coordinates : !!draft.at);

  return (
    <div class={`composer ${collapsed() ? 'collapsed' : ''}`}>
      <button class="composer-header" onClick={() => { autoFolded = false; setCollapsed(!collapsed()); }} aria-expanded={!collapsed()}>
        <span class="composer-title">
          {picking() ? 'Move the map to set the pin' : drawMode() ? 'Draw your zone on the map' : collapsed() ? 'Open menu' : 'Close menu'}
        </span>
        <span class="chevron">{collapsed() ? '▴' : '▾'}</span>
      </button>

      <Show when={!collapsed()}>
        <ProfileRow />

        <div class="kind-tabs">
          <For each={KINDS}>
            {(k) => (
              <button class={`kind-tab ${draft.kind === k.kind ? 'active' : ''}`} onClick={() => postActions.setKind(k.kind)}>
                <span class="kind-title">{k.title}</span>
                <span class="kind-sub">{k.sub}</span>
              </button>
            )}
          </For>
        </div>

        {/* comment */}
        <div class="field">
          <div class="comment-box">
            <textarea
              class="composer-input"
              maxLength={COMMENT.CHAR_LIMIT}
              placeholder="What's happening here?"
              value={draft.comment}
              onInput={(e) => postActions.setComment(e.currentTarget.value)}
            />
            <span class={`char-counter ${counterClass()}`}>{count()}/{COMMENT.CHAR_LIMIT}</span>
          </div>
        </div>

        {/* photo */}
        <Show when={draft.kind !== 'pixel'}>
          <label class={`photo-drop ${draft.previewUrl ? 'has-photo' : ''}`}>
            <Show
              when={draft.previewUrl}
              fallback={
                <span class="photo-empty">
                  <span class="photo-plus">＋</span>
                  <span>{draft.kind === 'icon' ? 'Add icon image' : 'Add zone image'}</span>
                  <span class="photo-hint">PNG, JPG… saved as JPEG XL</span>
                </span>
              }
            >
              <img class="photo-preview" src={draft.previewUrl!} alt="" />
              <span class="photo-meta">
                <span class="photo-change">Change</span>
                <span class="image-size">
                  {Math.max(1, Math.round(draft.imageBytes / 1024))} KB · JPEG XL
                  <Show when={draft.originalBytes > draft.imageBytes}>
                    {` · ${Math.round((1 - draft.imageBytes / draft.originalBytes) * 100)}% smaller`}
                  </Show>
                </span>
              </span>
            </Show>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                postActions.setImage(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </Show>

        {/* location: one line, one button */}
        <Show
          when={draft.kind !== 'zone'}
          fallback={
            <div class="location-row">
              <Pin muted={!placed()} />
              <div class="location-text">
                <Show when={placed()} fallback={<span class="muted">Draw your zone</span>}>
                  {draftAddress() === 'loading' ? 'Finding cross streets…' : draftAddress() || 'Zone drawn'}
                </Show>
              </div>
              <div class="draw-row">
                <button
                  class={`chip ${drawMode() === 'rect' ? 'active-tool' : ''}`}
                  onClick={() => (drawMode() === 'rect' ? postActions.stopDraw() : postActions.startDraw('rect'))}
                >
                  ▭ Rect
                </button>
                <button
                  class={`chip ${drawMode() === 'poly' ? 'active-tool' : ''}`}
                  onClick={() => (drawMode() === 'poly' ? postActions.stopDraw() : postActions.startDraw('poly'))}
                >
                  ⬟ Shape
                </button>
              </div>
            </div>
          }
        >
          <button class="location-row as-button" onClick={() => postActions.startPicking()}>
            <Pin muted={!placed()} />
            <span class="location-text">
              <Show when={placed()} fallback={<span class="muted">Choose location</span>}>
                {draftAddress() === 'loading' ? 'Finding cross streets…' : draftAddress() || 'Location set'}
              </Show>
            </span>
            <span class="location-action">{placed() ? 'Change' : 'Set'}</span>
          </button>
        </Show>

        <button
          class="btn btn-primary"
          disabled={busy() || !!missingForDraft(draft)}
          title={missingForDraft(draft) ?? ''}
          onClick={() => postActions.submit()}
        >
          {busy() ? 'Posting…' : price() > 0 ? `Pay ${formatPrice(price())} & post` : 'Post for free'}
        </button>

        <Show when={message() || missingForDraft(draft)}>
          <div class={message() ? 'composer-message' : 'hint'}>{message() || `Next: ${missingForDraft(draft)}`}</div>
        </Show>

        <div class="composer-footer">
          <span>{posts.length} post{posts.length === 1 ? '' : 's'} on the map</span>
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
      </Show>
    </div>
  );
};
