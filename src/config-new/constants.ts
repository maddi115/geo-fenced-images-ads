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
