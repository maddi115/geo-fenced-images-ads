import { createStore, produce } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { LatLng } from '../../domain/geo/geo-schemas';
import type { Post, PostKind } from './post-schemas';
import { loadRawPosts, savePosts } from '../../infrastructure/storage/local-posts';
import { resizeImageFile } from '../../infrastructure/images/resize-image';
import { startCheckout } from '../../infrastructure/payments/checkout';
import { ICON, ZONE, PRICES, LIFETIME_LABEL, TRUST } from '../../config-new/constants';
import { checkPost, signPost, RateLimit, type RejectReason } from './post-signing';
import { username, avatar } from '../../infrastructure/identity/profile';
import { getMyKeys } from '../../infrastructure/identity/keys';
import { devLog } from '../../infrastructure/dev/dev-log';

export interface Draft {
  kind: PostKind;
  comment: string;
  imageUrl: string | null; // icon + zone only (JPEG XL data URL)
  previewUrl: string | null; // small PNG preview for the panel
  imageBytes: number;
  originalBytes: number; // the picked file, to show how much JPEG XL saved
  at: LatLng | null; // pixel + icon
  coordinates: LatLng[] | null; // zone
  placing: boolean; // waiting for a map click (pixel + icon)
}

const emptyDraft = (kind: PostKind): Draft => ({
  kind,
  comment: '',
  imageUrl: null,
  previewUrl: null,
  imageBytes: 0,
  originalBytes: 0,
  at: null,
  coordinates: null,
  placing: false,
});

const [posts, setPosts] = createStore<Post[]>([]);
const [draft, setDraft] = createStore<Draft>(emptyDraft('pixel'));
const [hoveredZoneId, setHoveredZoneId] = createSignal<string | null>(null);
const [message, setMessage] = createSignal<string>('');
const [busy, setBusy] = createSignal(false);
export type DrawMode = 'rect' | 'poly' | null;
// cross streets of the draft's location: null = not placed, 'loading', or the text ('' = none found)
const [draftAddress, setDraftAddress] = createSignal<string | null>(null);
// choosing a location with the center pin (pixel + icon)
const [picking, setPicking] = createSignal(false);
const [drawMode, setDrawMode] = createSignal<DrawMode>(null);

// ------------------------------------------------------------ receiving posts
// Every post goes through here, from this browser now and from peers/relays later:
// checked (signature, puzzle, expiry), then the 10-a-minute limit per person.
const rate = new RateLimit();
export const trustStats: { saved: number; rejected: Partial<Record<RejectReason, number>> } = { saved: 0, rejected: {} };

export async function receivePosts(raws: unknown[]): Promise<number> {
  const have = new Set(posts.map((p) => p.id));
  const good: Post[] = [];
  for (const raw of raws) {
    const r = await checkPost(raw);
    if ('reason' in r) {
      trustStats.rejected[r.reason] = (trustStats.rejected[r.reason] ?? 0) + 1;
      continue;
    }
    const p = r.post;
    if (have.has(p.id)) continue;
    if (!rate.allows(p.author.key, p.createdAt)) {
      trustStats.rejected['too-fast'] = (trustStats.rejected['too-fast'] ?? 0) + 1;
      continue;
    }
    rate.add(p.author.key, p.createdAt);
    have.add(p.id);
    good.push(p);
  }
  if (good.length) {
    trustStats.saved += good.length;
    const next = [...posts, ...good].sort((a, b) => a.createdAt - b.createdAt);
    setPosts(next);
    savePosts(next);
  }
  return good.length;
}

// load saved posts (checked again), then remove posts as they expire
async function init() {
  const raws = loadRawPosts();
  await receivePosts(raws);
  const dropped = raws.length - posts.length;
  if (dropped > 0) {
    savePosts(posts);
    devLog('post stats', `loaded ${posts.length} posts, dropped ${dropped} (expired or edited) · ${JSON.stringify(trustStats.rejected)}`);
  }
}
function removeExpired() {
  const now = Date.now();
  if (!posts.some((p) => p.expiresAt <= now)) return;
  const next = posts.filter((p) => p.expiresAt > now);
  setPosts(next);
  savePosts(next);
}
if (typeof window !== 'undefined') {
  init();
  setInterval(removeExpired, 15_000);
}

export const PRICE_BY_KIND: Record<PostKind, number> = {
  pixel: 0,
  icon: PRICES.icon,
  zone: PRICES.zone,
};

export function missingForDraft(d: Draft): string | null {
  if (!d.comment.trim()) return 'Write a comment';
  if (d.kind !== 'pixel' && !d.imageUrl) return 'Upload an image';
  if (d.kind === 'zone' && !d.coordinates) return 'Draw a zone on the map';
  if (d.kind !== 'zone' && !d.at) return 'Place it on the map';
  return null;
}

export const postActions = {
  setKind(kind: PostKind) {
    // keep the comment when switching, clear the rest
    const comment = draft.comment;
    setDrawMode(null);
    setPicking(false);
    setDraft({ ...emptyDraft(kind), comment });
    setMessage('');
  },

  setComment(text: string) {
    setDraft('comment', text);
  },

  async setImage(file: File | undefined) {
    if (!file) return;
    try {
      setMessage('Compressing to JPEG XL…');
      const img =
        draft.kind === 'zone'
          ? await resizeImageFile(file, ZONE.MAX_UPLOAD_PX, 80)
          : await resizeImageFile(file, ICON.MAX_UPLOAD_PX, 90);
      setDraft({ imageUrl: img.url, previewUrl: img.preview, imageBytes: img.bytes, originalBytes: img.originalBytes });
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  },

  startPlacing() {
    setDrawMode(null);
    setDraft('placing', true);
    setMessage('Click the map to place it');
  },

  startPicking() {
    if (draft.kind === 'zone') return;
    setDrawMode(null);
    setDraft('placing', false);
    setPicking(true);
    setMessage('');
  },

  cancelPicking() {
    setPicking(false);
  },

  /** confirm the center-pin location */
  setPicked(at: LatLng) {
    setPicking(false);
    setDraft({ at, placing: false });
    setMessage('');
  },

  // place at a given point (e.g. the user's location)
  placeHere(at: LatLng) {
    if (draft.kind === 'zone') return;
    setDrawMode(null);
    setDraft({ at, placing: false });
    setMessage('');
  },

  // called by the map on click
  placeAt(at: LatLng) {
    if (!draft.placing || draft.kind === 'zone') return;
    setDraft({ at, placing: false });
    setMessage('');
  },

  startDraw(mode: Exclude<DrawMode, null>) {
    setDraft('placing', false);
    setDrawMode(mode);
    setMessage(
      mode === 'rect'
        ? 'Press and drag on the map'
        : 'Click points on the map. Click the first point (or double-click) to finish. Esc cancels.'
    );
  },

  stopDraw() {
    setDrawMode(null);
    if (message().startsWith('Press') || message().startsWith('Click points')) setMessage('');
  },

  // called by the map when a zone is drawn
  setZone(coordinates: LatLng[]) {
    setDrawMode(null);
    if (draft.kind !== 'zone') return false;
    setDraft('coordinates', coordinates);
    setMessage('');
    return true;
  },

  async submit(): Promise<boolean> {
    const missing = missingForDraft(draft);
    if (missing) {
      setMessage(missing);
      return false;
    }

    setBusy(true);
    try {
      // 10 posts a minute (others would drop the extra ones anyway)
      const myKey = (await getMyKeys()).publicKey;
      const mine = posts.filter((p) => p.author.key === myKey && Date.now() - p.createdAt < 60_000);
      if (mine.length >= TRUST.MAX_POSTS_PER_MINUTE) {
        setMessage('Slow down: 10 posts a minute at most');
        return false;
      }

      // 1. sign + anti-spam puzzle (before paying, so a failure never costs money)
      let signed: Record<string, unknown>;
      try {
        const r = await signPost(
          { kind: draft.kind, at: draft.at ?? undefined, coordinates: draft.coordinates ?? undefined,
            imageUrl: draft.imageUrl ?? undefined, comment: draft.comment, name: username(), avatar: avatar() },
          (step) => setMessage(step === 'signing' ? 'Signing your post…' : 'Solving anti-spam puzzle…'),
        );
        signed = r.post;
        devLog('post stats', `signed in ${r.times.signMs.toFixed(0)} ms · anti-spam puzzle (${TRUST.WORK_BITS} bits) solved in ${r.times.workMs.toFixed(0)} ms`);
      } catch (e) {
        console.error(e);
        setMessage("This browser can't sign posts. Try an up-to-date Chrome, Safari or Firefox.");
        return false;
      }

      // 2. pay (paid posts only)
      const price = PRICE_BY_KIND[draft.kind];
      if (price > 0) {
        const label = draft.kind === 'icon'
          ? `Custom icon (225px) · shows for ${LIFETIME_LABEL.icon}`
          : `Custom zone upload · shows for ${LIFETIME_LABEL.zone}`;
        setMessage('');
        const paymentId = await startCheckout(label, price);
        if (!paymentId) {
          setMessage('Payment cancelled');
          return false;
        }
        signed.paymentId = paymentId;
      }

      // 3. check it like everyone else will, then save
      const before = posts.length;
      await receivePosts([signed]);
      if (posts.length === before) {
        setMessage('Something was wrong with that post');
        return false;
      }
      setDraft({ ...emptyDraft(draft.kind) });
      setMessage(`Posted ✓ · shows for ${LIFETIME_LABEL[signed.kind as PostKind]}`);
      return true;
    } finally {
      setBusy(false);
    }
  },

  cancelDraft() {
    setDrawMode(null);
    setPicking(false);
    setDraft({ ...emptyDraft(draft.kind) });
    setMessage('');
  },

  deletePost(id: string) {
    setPosts(produce((list) => {
      const i = list.findIndex((p) => p.id === id);
      if (i >= 0) list.splice(i, 1);
    }));
    savePosts([...posts]);
  },

  clearAll() {
    setPosts([]);
    savePosts([]);
    setMessage('All posts cleared');
  },

  setDraftAddress(text: string | null) {
    setDraftAddress(text);
  },

  setHoveredZone(id: string | null) {
    setHoveredZoneId(id);
  },
};

export { posts, draft, hoveredZoneId, message, busy, drawMode, draftAddress, picking };
