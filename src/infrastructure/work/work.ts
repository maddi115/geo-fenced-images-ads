import { sha256 } from '@noble/hashes/sha2.js';
import { TRUST } from '../../config-new/constants';

// Anti-spam puzzle (proof of work), like webtorrent-db: before a post is shared, your
// device tries numbers until a hash of "post id + number" starts with enough zero bits.
// One post: about a second. Thousands of spam posts: very expensive.
// Checking someone else's answer takes one hash.

const enc = new TextEncoder();

export function leadingZeroBits(bytes: Uint8Array) {
  let bits = 0;
  for (const b of bytes) {
    if (b === 0) { bits += 8; continue; }
    return bits + Math.clz32(b) - 24;
  }
  return bits;
}

export const workText = (id: string, nonce: number) => `gfmap-work-1:${id}:${nonce}`;

export function hasWork(id: string, nonce: number, bits: number = TRUST.WORK_BITS) {
  if (bits <= 0) return true;
  if (!Number.isSafeInteger(nonce) || nonce < 0) return false;
  return leadingZeroBits(sha256(enc.encode(workText(id, nonce)))) >= bits;
}

/** Solves the puzzle in a background thread so the map stays smooth */
export function solveWork(id: string, bits: number = TRUST.WORK_BITS): Promise<{ nonce: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const w = new Worker(new URL('./work-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ nonce: number }>) => {
      w.terminate();
      resolve({ nonce: e.data.nonce, ms: performance.now() - t0 });
    };
    w.onerror = (e) => {
      w.terminate();
      reject(new Error(e.message || 'Anti-spam puzzle failed'));
    };
    w.postMessage({ id, bits });
  });
}
