// --- Color manipulation & dithering ---

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Blend two '#rrggbb' colours; t=0 gives a, t=1 gives b.
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// '#rrggbb' -> 32-bit pixel value for the Uint32Array view (little-endian ABGR).
export function packColor(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

// 4x4 ordered-dither matrix: blends two colours with a fine pattern instead
// of a smooth gradient — the classic 16-bit look.
export const BAYER: number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
export const bayer = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)];
