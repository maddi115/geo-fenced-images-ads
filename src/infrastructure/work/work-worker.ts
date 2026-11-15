/// <reference lib="webworker" />
import { sha256 } from '@noble/hashes/sha2.js';
import { leadingZeroBits, workText } from './work';

const enc = new TextEncoder();

self.onmessage = (e: MessageEvent<{ id: string; bits: number }>) => {
  const { id, bits } = e.data;
  let nonce = 0;
  while (leadingZeroBits(sha256(enc.encode(workText(id, nonce)))) < bits) nonce++;
  (self as unknown as Worker).postMessage({ nonce });
};
