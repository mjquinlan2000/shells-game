import { H, HUD_H, VW, W } from '../config';
import { bayer, packColor } from '../util/color';
import { clamp, rand, randInt } from '../util/math';

// --- Backdrop ---
// The sky, stars and moon are fixed to the screen. Two layers of distant
// hills scroll slower than the battlefield (parallax), which sells depth.
// All are built once per match into pixel arrays, then copied every frame.

export interface Layer {
  f: number;
  w: number;
  data: Uint32Array;
  top: number;
}

export interface Twinkle {
  i: number;
  phase: number;
  speed: number;
}

export interface Moon {
  x: number;
  y: number;
  r: number;
}

export const SKY = ['#0a0a1f', '#141a3a', '#22265a', '#3d2f6e', '#6a3a78', '#a8487a', '#e0687a', '#ffa07a'];
export const MOON: Moon = { x: 505, y: 62, r: 20 };
export const STAR_BRIGHT = packColor('#fff6e0');
export const STAR_DIM = packColor('#8f88c0');
export const sky = new Uint32Array(VW * H);
export let twinkles: Twinkle[] = [];

// A parallax layer moves `f` pixels per pixel the camera moves.
export function makeLayer(f: number): Layer {
  const w = VW + Math.ceil((W - VW) * f);
  return { f, w, data: new Uint32Array(w * H), top: H };
}
export const farHills = makeLayer(0.25);
export const nearHills = makeLayer(0.55);

export function buildBackdrop() {
  const bands = SKY.map(packColor);
  for (let y = 0; y < H; y++) {
    const t = clamp(y / (H * 0.72), 0, 1) * (bands.length - 1);
    const i = Math.floor(t);
    for (let x = 0; x < VW; x++) {
      sky[y * VW + x] = t - i > bayer(x, y) ? bands[Math.min(i + 1, bands.length - 1)] : bands[i];
    }
  }

  // Stars: most static, some twinkle (animated in composeFrame).
  twinkles = [];
  for (let n = 0; n < 260; n++) {
    const x = randInt(0, VW - 1), y = randInt(HUD_H + 2, Math.floor(H * 0.5));
    const i = y * VW + x;
    if (Math.random() < 0.12) {
      twinkles.push({ i, phase: rand(0, 6.28), speed: rand(0.03, 0.09) });
    } else {
      sky[i] = Math.random() < 0.25 ? STAR_BRIGHT : STAR_DIM;
    }
  }

  // Moon with soft shading and craters.
  const craters: readonly [number, number, number][] = [[-7, -5, 4], [5, 3, 5], [-3, 8, 3], [8, -8, 2]];
  for (let dy = -MOON.r; dy <= MOON.r; dy++) {
    for (let dx = -MOON.r; dx <= MOON.r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > MOON.r) continue;
      let c = (dx + dy) / (2 * MOON.r) > 0.3 ? '#d9cfb4' : '#f4ecd2';
      for (const [cx, cy, cr] of craters) if (Math.hypot(dx - cx, dy - cy) < cr) c = '#c8bc9f';
      if (d > MOON.r - 1.2 && bayer(dx, dy) > 0.5) c = '#b8ad95';
      sky[(MOON.y + dy) * VW + MOON.x + dx] = packColor(c);
    }
  }

  // Far mountains (jagged, rim-lit).
  const p = Array.from({ length: 4 }, () => rand(0, 6.28));
  const farTop = packColor('#4a3f80'), far = packColor('#2c2558');
  farHills.data.fill(0);
  farHills.top = H;
  for (let x = 0; x < farHills.w; x++) {
    const ridge = Math.max(0, Math.round(H * 0.5 - Math.abs(Math.sin(x * 0.011 + p[0])) * 44 - Math.abs(Math.sin(x * 0.027 + p[1])) * 18));
    farRidge[x] = ridge;
    farHills.top = Math.min(farHills.top, ridge);
    for (let y = ridge; y < H; y++) farHills.data[y * farHills.w + x] = y < ridge + 2 ? farTop : far;
  }

  // Nearer hills with pine trees.
  const nearColor = packColor('#1c1838');
  const nearRidge: number[] = [];
  nearHills.data.fill(0);
  nearHills.top = H;
  for (let x = 0; x < nearHills.w; x++) {
    nearRidge[x] = Math.round(H * 0.6 + Math.sin(x * 0.009 + p[2]) * 16 + Math.sin(x * 0.031 + p[3]) * 6);
    for (let y = nearRidge[x]; y < H; y++) nearHills.data[y * nearHills.w + x] = nearColor;
  }
  for (let n = Math.round(45 * nearHills.w / VW); n > 0; n--) {
    const tx = randInt(4, nearHills.w - 5), base = nearRidge[tx] + 2, h = randInt(8, 18);
    nearHills.top = Math.min(nearHills.top, base - h);
    for (let k = 0; k <= h; k++) {
      const half = Math.floor(k * 0.32) - (k % 4 === 3 ? 1 : 0);
      for (let dx = -half; dx <= half; dx++) {
        const x = tx + dx, y = base - h + k;
        if (x >= 0 && x < nearHills.w && y >= 0) nearHills.data[y * nearHills.w + x] = nearColor;
      }
    }
  }
}

export const farRidge: number[] = [];       // the far mountains' ridge line, set by buildBackdrop
