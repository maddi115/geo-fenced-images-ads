import { createSignal } from 'solid-js';
import { PROFILE } from '../../config-new/constants';

// Username + profile picture, kept in this browser and sent inside every post.
// Like webtorrent-db: you pick up to 5 letters, then a random #1234 and emoji are added,
// so two people can both be "Sam" and still look different.

const NAME_KEY = 'geofence-studio:username:v1';
const AVATAR_KEY = 'geofence-studio:avatar:v1';
const EMOJIS = ['⭐', '🔥', '💎', '🚀', '🌙', '⚡', '🎮', '🎯', '🎨', '🎵', '🎸', '🍄', '🌵', '🌊', '🍀', '🦋'];

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
const tag = () => `#${Math.floor(1000 + Math.random() * 9000)}${pick(EMOJIS)}`;

export function isValidName(name: string) {
  return new RegExp(`^[A-Za-z]{1,${PROFILE.NAME_MAX_LETTERS}}$`).test(name);
}

/** what a full username can look like when it arrives in someone else's post */
export function isValidFullName(full: unknown): full is string {
  return typeof full === 'string' && full.length <= 24 && /^[A-Za-z0-9]{1,8}#\d{4}\S{1,4}$/u.test(full);
}

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // still works until this page closes
  }
}

function initialName() {
  const saved = load(NAME_KEY);
  if (isValidFullName(saved)) return saved;
  const made = `User${Math.floor(Math.random() * 1000)}${tag()}`;
  save(NAME_KEY, made);
  return made;
}

const [username, setUsernameSignal] = createSignal(initialName());
const [avatar, setAvatarSignal] = createSignal<string | null>(load(AVATAR_KEY));

export { username, avatar };

/** the part people typed, without #1234⭐ */
export const shortName = (full: string) => full.split('#')[0];

export function setName(name: string): string | null {
  const clean = name.trim();
  if (!isValidName(clean)) return `Use 1 to ${PROFILE.NAME_MAX_LETTERS} letters (A to Z)`;
  const full = `${clean}${tag()}`;
  save(NAME_KEY, full);
  setUsernameSignal(full);
  return null;
}

/** Makes a tiny square profile picture (64px) so it can travel inside every post */
export async function setAvatarFile(file: File | undefined): Promise<string | null> {
  if (!file) return null;
  if (!file.type.startsWith('image/')) return 'Please pick an image file.';
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return "Couldn't read that image.";
  }
  const size = PROFILE.AVATAR_PX;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const s = Math.max(size / bmp.width, size / bmp.height); // center crop
  ctx.drawImage(bmp, (size - bmp.width * s) / 2, (size - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  bmp.close();
  let url = c.toDataURL('image/webp', 0.8);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.8);
  if (url.length > PROFILE.AVATAR_MAX_CHARS) url = c.toDataURL('image/jpeg', 0.5);
  if (url.length > PROFILE.AVATAR_MAX_CHARS) return 'That picture is too detailed. Try another one.';
  save(AVATAR_KEY, url);
  setAvatarSignal(url);
  return null;
}

export function removeAvatar() {
  save(AVATAR_KEY, null);
  setAvatarSignal(null);
}

/** a steady color per person (same as on the map card) when they have no profile picture */
export function avatarColor(key: string) {
  let n = 0;
  for (const ch of key) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${n % 360} 55% 48%)`;
}
