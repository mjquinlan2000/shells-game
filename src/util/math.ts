export const DEG = Math.PI / 180;  // multiply degrees by this to get radians

export interface Point {
  x: number;
  y: number;
}

// Random float in [a, b).
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
// Random integer in [a, b], both ends included.
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
