// Each browser makes its own signing key (Ed25519) once and keeps it.
// Posts are signed with it, so nobody can fake your name or change your post.
// Same approach as webtorrent-db.

const KEY_STORAGE = 'geofence-studio:signing-key:v1';
const enc = new TextEncoder();

export interface MyKeys {
  publicKey: string; // base64url, 43 characters
  privateKey: CryptoKey;
}

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export const isPublicKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
export const isSignature = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{86}$/.test(v);

async function importKeys(privateKey: string, publicKey: string): Promise<MyKeys> {
  return {
    publicKey,
    privateKey: await crypto.subtle.importKey('pkcs8', fromBase64Url(privateKey), 'Ed25519', false, ['sign']),
  };
}

async function loadOrCreate(): Promise<MyKeys> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_STORAGE) || 'null');
    if (saved?.privateKey && isPublicKey(saved.publicKey)) return await importKeys(saved.privateKey, saved.publicKey);
  } catch {
    // a broken saved key is replaced below
  }
  const pair = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  const saved = {
    privateKey: toBase64Url(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
    publicKey: toBase64Url(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
  try {
    localStorage.setItem(KEY_STORAGE, JSON.stringify(saved));
  } catch {
    // the key still works until this page closes
  }
  return importKeys(saved.privateKey, saved.publicKey);
}

let mine: Promise<MyKeys> | null = null;
export function getMyKeys() {
  if (!mine) mine = loadOrCreate();
  return mine;
}

export async function signText(text: string, keys?: MyKeys): Promise<string> {
  const k = keys ?? (await getMyKeys());
  return toBase64Url(await crypto.subtle.sign('Ed25519', k.privateKey, enc.encode(text)));
}

const verifyKeys = new Map<string, Promise<CryptoKey>>();
export async function verifyText(publicKey: string, signature: string, text: string): Promise<boolean> {
  if (!isPublicKey(publicKey) || !isSignature(signature)) return false;
  try {
    let key = verifyKeys.get(publicKey);
    if (!key) {
      if (verifyKeys.size > 5000) verifyKeys.clear();
      key = crypto.subtle.importKey('raw', fromBase64Url(publicKey), 'Ed25519', false, ['verify']);
      verifyKeys.set(publicKey, key);
    }
    return await crypto.subtle.verify('Ed25519', await key, fromBase64Url(signature), enc.encode(text));
  } catch {
    return false;
  }
}
