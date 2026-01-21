export interface Point {
  x: number;
  y: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Convert hex color to RGB
 * Extracted from canvas-component.js
 */
export function hexToRgb(hex: string): RGB {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  const expandedHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(expandedHex);
  
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 153, g: 50, b: 204 };
}
