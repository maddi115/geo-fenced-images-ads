import { createStore, produce } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { LatLng } from '../../domain/geo/geo-schemas';
import { PostSchema, type Post, type PostKind } from './post-schemas';
import { loadPosts, savePosts } from '../../infrastructure/storage/local-posts';
import { resizeImageFile } from '../../infrastructure/images/resize-image';
import { startCheckout } from '../../infrastructure/payments/checkout';
import { ICON, ZONE, PRICES } from '../../config-new/constants';

export interface Draft {
  kind: PostKind;
  comment: string;
  imageUrl: string | null; // icon + zone only (JPEG XL data URL)
  previewUrl: string | null; // small PNG preview for the panel
  imageBytes: number;
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
  at: null,
  coordinates: null,
  placing: false,
});

const [posts, setPosts] = createStore<Post[]>(loadPosts());
const [draft, setDraft] = createStore<Draft>(emptyDraft('pixel'));
const [hoveredZoneId, setHoveredZoneId] = createSignal<string | null>(null);
const [message, setMessage] = createSignal<string>('');
const [busy, setBusy] = createSignal(false);
export type DrawMode = 'rect' | 'poly' | null;
// cross streets of the draft's location: null = not placed, 'loading', or the text ('' = none found)
const [draftAddress, setDraftAddress] = createSignal<string | null>(null);
const [drawMode, setDrawMode] = createSignal<DrawMode>(null);

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
      setDraft({ imageUrl: img.url, previewUrl: img.preview, imageBytes: img.bytes });
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

  // "Here" button: place at the user's current location
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
      let paymentId: string | null = null;
      const price = PRICE_BY_KIND[draft.kind];
      if (price > 0) {
        const label = draft.kind === 'icon' ? 'Custom icon (225px)' : 'Custom zone upload';
        paymentId = await startCheckout(label, price);
        if (!paymentId) {
          setMessage('Payment cancelled');
          return false;
        }
      }

      const base = {
        id: crypto.randomUUID(),
        comment: draft.comment.trim(),
        createdAt: new Date().toISOString(),
      };
      const candidate =
        draft.kind === 'pixel'
          ? { ...base, kind: 'pixel', at: draft.at }
          : draft.kind === 'icon'
            ? { ...base, kind: 'icon', at: draft.at, imageUrl: draft.imageUrl, paymentId }
            : { ...base, kind: 'zone', coordinates: draft.coordinates, imageUrl: draft.imageUrl, paymentId };

      const parsed = PostSchema.safeParse(candidate);
      if (!parsed.success) {
        console.error(parsed.error);
        setMessage('Something was wrong with that post');
        return false;
      }

      const next = [...posts, parsed.data];
      if (!savePosts(next)) {
        setMessage('Browser storage is full. Delete some posts.');
        return false;
      }
      setPosts(next);
      setDraft({ ...emptyDraft(draft.kind) });
      setMessage('Posted ✓');
      return true;
    } finally {
      setBusy(false);
    }
  },

  cancelDraft() {
    setDrawMode(null);
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

export { posts, draft, hoveredZoneId, message, busy, drawMode, draftAddress };
