import { VW, W } from '../config';
import { game } from '../game/state';
import { bayer, mix, packColor } from '../util/color';
import { rand, randInt } from '../util/math';
import type { Arena } from './arenas';

// --- Clouds: small pixel sprites that drift with the wind ---
// They live in their own parallax space, between the hills and the ground.

export const CLOUD_PARALLAX = 0.4;
export const CLOUD_SPACE = VW + Math.ceil((W - VW) * CLOUD_PARALLAX);

export interface Cloud {
  w: number;
  h: number;
  data: Uint32Array;
  depth: number;
  x: number;
  y: number;
}

export let clouds: Cloud[] = [];

export function makeCloud(depth: number, arena: Arena) {
  const w = randInt(50, 96), h = randInt(14, 24);
  const blobs = Array.from({ length: randInt(4, 7) }, () => ({
    x: rand(h * 0.5, w - h * 0.5), y: rand(h * 0.5, h * 0.7), r: rand(h * 0.3, h * 0.5),
  }));
  // Nearer clouds are brighter; all are lit from above by the sky body.
  const tones = arena.clouds.tones.map(c => packColor(mix(c, arena.sky[1], 1 - depth)));
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (const b of blobs) m = Math.min(m, Math.hypot(x - b.x, (y - b.y) * 1.3) / b.r);
      if (m >= 1 || (m > 0.8 && bayer(x, y) < (m - 0.8) / 0.2)) continue;
      data[y * w + x] = tones[y < h * 0.4 ? 0 : y < h * 0.7 ? 1 : 2];
    }
  }
  return { w, h, data };
}

export function buildClouds(arena: Arena) {
  const baseCount = Math.round(7 * CLOUD_SPACE / VW);
  const count = Math.round(baseCount * arena.clouds.amount);
  clouds = Array.from({ length: count }, (): Cloud => {
    const depth = rand(0.4, 1);
    const c = makeCloud(depth, arena);
    return { ...c, depth, x: rand(-c.w, CLOUD_SPACE), y: randInt(26, 120) };
  });
}

export function updateClouds() {
  for (const c of clouds) {
    c.x += (0.04 + game.wind * 0.025) * c.depth;
    if (c.x > CLOUD_SPACE) c.x = -c.w;
    if (c.x < -c.w) c.x = CLOUD_SPACE;
  }
}
