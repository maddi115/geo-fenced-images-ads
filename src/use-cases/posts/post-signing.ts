import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { LatLng } from '../../domain/geo/geo-schemas';
import { LIFETIME_MS, TRUST } from '../../config-new/constants';
import { getMyKeys, signText, verifyText } from '../../infrastructure/identity/keys';
import { isValidFullName } from '../../infrastructure/identity/profile';
import { hasWork, solveWork } from '../../infrastructure/work/work';
import { PostSchema, type Author, type Post, type PostKind } from './post-schemas';

// Signed posts, like webtorrent-db's signed links.
// Everything that matters is inside the signed text: type, where, comment, image, times,
// name and picture. If anyone changes one letter, the signature breaks and the post is dropped.
// paymentId is NOT signed: the paid receipt (later) is signed by the server over the post id.

const enc = new TextEncoder();
const hash = (s: string) => bytesToHex(sha256(enc.encode(s)));

/** 6 decimals = about 10 cm. Rounded once when posting, so everyone rebuilds the same text. */
export const round6 = (n: number) => Number(n.toFixed(6));
export const roundAt = (p: LatLng): LatLng => ({ lat: round6(p.lat), lng: round6(p.lng) });
const coordText = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

type Unsigned = {
  kind: PostKind;
  at?: LatLng;
  coordinates?: LatLng[];
  imageUrl?: string;
  comment: string;
  createdAt: number;
  expiresAt: number;
  author: Author;
};

/** The exact text the signature covers */
export function signedText(p: Unsigned): string {
  const where = p.kind === 'zone' ? (p.coordinates ?? []).map(coordText).join(';') : p.at ? coordText(p.at) : '';
  return [
    'gfmap-post-1',
    p.kind,
    where,
    p.comment,
    p.imageUrl ? hash(p.imageUrl) : '',
    p.createdAt,
    p.expiresAt,
    p.author.name,
    p.author.avatar ? hash(p.author.avatar) : '',
    p.author.key,
  ].join('\n');
}

export const postId = (p: Unsigned) => hash(signedText(p)).slice(0, 32);

export interface SignTimes {
  signMs: number;
  workMs: number;
}

/** Signs a new post and solves its anti-spam puzzle */
export async function signPost(
  p: Omit<Unsigned, 'author' | 'createdAt' | 'expiresAt'> & { name: string; avatar: string | null },
  onStep?: (step: 'signing' | 'puzzle') => void,
): Promise<{ post: Record<string, unknown>; times: SignTimes }> {
  onStep?.('signing');
  const t0 = performance.now();
  const keys = await getMyKeys();
  const createdAt = Date.now();
  const u: Unsigned = {
    kind: p.kind,
    comment: p.comment.trim(),
    createdAt,
    expiresAt: createdAt + LIFETIME_MS[p.kind],
    author: { key: keys.publicKey, name: p.name, avatar: p.avatar },
  };
  if (p.kind === 'zone') u.coordinates = (p.coordinates ?? []).map(roundAt);
  else if (p.at) u.at = roundAt(p.at);
  if (p.kind !== 'pixel') u.imageUrl = p.imageUrl;

  const sig = await signText(signedText(u), keys);
  const id = postId(u);
  const signMs = performance.now() - t0;
  onStep?.('puzzle');
  const { nonce, ms: workMs } = await solveWork(id);
  return { post: { ...u, id, sig, work: nonce }, times: { signMs, workMs } };
}

export type RejectReason =
  | 'bad-format' | 'bad-name' | 'bad-expiry' | 'from-future' | 'expired'
  | 'bad-id' | 'no-work' | 'bad-signature' | 'too-fast';

/** Checks a post from anywhere (this browser, peers, relays). null = good */
export async function checkPost(raw: unknown, now = Date.now()): Promise<{ post: Post } | { reason: RejectReason }> {
  const parsed = PostSchema.safeParse(raw);
  if (!parsed.success) return { reason: 'bad-format' };
  const p = parsed.data;
  if (!isValidFullName(p.author.name)) return { reason: 'bad-name' };
  if (p.expiresAt - p.createdAt !== LIFETIME_MS[p.kind]) return { reason: 'bad-expiry' };
  if (p.createdAt > now + TRUST.MAX_FUTURE_MS) return { reason: 'from-future' };
  if (p.expiresAt <= now) return { reason: 'expired' };
  if (postId(p) !== p.id) return { reason: 'bad-id' };
  if (!hasWork(p.id, p.work)) return { reason: 'no-work' };
  if (!(await verifyText(p.author.key, p.sig, signedText(p)))) return { reason: 'bad-signature' };
  return { post: p };
}

/** 10 posts a minute per person. Fed every accepted post; asks before accepting a new one. */
export class RateLimit {
  private times = new Map<string, number[]>();
  allows(key: string, at: number) {
    const near = (this.times.get(key) ?? []).filter((t) => Math.abs(t - at) < 60_000);
    return near.length < TRUST.MAX_POSTS_PER_MINUTE;
  }
  add(key: string, at: number) {
    const list = this.times.get(key) ?? [];
    list.push(at);
    // only the last few minutes matter
    this.times.set(key, list.filter((t) => Math.abs(t - at) < 5 * 60_000));
  }
}
