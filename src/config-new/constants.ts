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
