export const ZOOM = {
  AD_INFO_THRESHOLD: 16,
} as const;

export const MARKER = {
  SIZE: 80,
  HALF_SIZE: 40,
} as const;

export const BUBBLE = {
  WIDTH: 280,
  HEIGHT: 160,
  ARROW_HEIGHT: 8,
  GAP_ABOVE_MARKER: 16,
} as const;

export const COMMENT = {
  CHAR_LIMIT: 70,
  CHAR_WARNING_THRESHOLD: 51,
  CHAR_DANGER_THRESHOLD: 66,
} as const;

export const MAP_CONFIG = {
  initialZoom: 13,
  initialCenter: [34.0522, -118.2437] as [number, number],
  minZoom: 10,
  maxZoom: 19,
} as const;

// Free post: a red pixel with a comment
export const PIXEL = {
  SIZE: 10,
  COLOR: '#ef4444',
} as const;

// Paid icon: fixed 225px. No growing over time.
// SCALE_WITH_ZOOM: true = 225px at zoom 16, smaller when zoomed out (keeps the city view clean)
//                  false = always exactly 225px on screen
export const ICON = {
  SIZE: 225,
  REF_ZOOM: 16,
  MIN_SIZE: 24,
  SCALE_WITH_ZOOM: true,
  MAX_UPLOAD_PX: 450, // uploads are shrunk to this before saving
} as const;

export const ZONE = {
  MAX_UPLOAD_PX: 1024,
  FILL_COLOR: '#0066ff',
  FILL_OPACITY: 0.09,
  BORDER_COLOR: '#0066ff',
  BORDER_WIDTH: 2,
} as const;

// Prices in cents. Change these to change what users pay.
export const PRICES = {
  icon: 300, // $3.00
  zone: 500, // $5.00
} as const;

// How long each post stays on the map. This is locked inside the post's signature,
// so nobody can make a post last longer.
const HOUR = 60 * 60 * 1000;
export const LIFETIME_MS = {
  pixel: 24 * HOUR, // free red pixel: 24 hours
  icon: 4 * 24 * HOUR, // $3 icon: 4 days
  zone: 7 * 24 * HOUR, // $5 zone image: 7 days
} as const;

export const LIFETIME_LABEL = { pixel: '24h', icon: '4 days', zone: '7 days' } as const;

// Spam protection
export const TRUST = {
  WORK_BITS: 18, // anti-spam puzzle: about 1 second on a PC, a few seconds on a phone
  MAX_POSTS_PER_MINUTE: 10, // per person (per signing key)
  MAX_FUTURE_MS: 5 * 60 * 1000, // posts dated more than 5 minutes ahead are dropped
} as const;

// Username + profile picture
export const PROFILE = {
  NAME_MAX_LETTERS: 5,
  AVATAR_PX: 64,
  AVATAR_MAX_CHARS: 12000, // the picture travels inside every post, so it stays tiny
} as const;
