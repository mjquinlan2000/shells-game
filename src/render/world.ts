import { H, VW, W } from '../config';
import { game } from '../game/state';
import { ctx, framePixels } from '../gfx/canvas';
import { fillCircle, fillRing } from '../gfx/draw';
import { camX } from './render';
import { packColor } from '../util/color';
import { STAR_BRIGHT, STAR_DIM, farHills, nearHills, sky, twinkles, type Layer } from '../world/backdrop';
import { drawBackgroundWar } from '../world/background-war';
import { CLOUD_PARALLAX, clouds } from '../world/clouds';
import { T_BASE, T_DARK, T_LIGHT, terrain } from '../world/terrain';
import type { Explosion } from '../combat/effects';
export const TRAIL_COLORS = ['#3a3442', '#7a3a4a', '#ff5a3a', '#ffa040', '#ffe08a'].map(packColor);
export const SHELL_CORE = packColor('#ffffff');
export const SHELL_EDGE = packColor('#ffe08a');

// --- World rendering: backdrop, terrain, particles, projectiles, explosions ---

// Takes world coordinates.
export function putPixel(x: number, y: number, color: number) {
  x = Math.round(x) - camX;
  y = Math.round(y);
  if (x >= 0 && x < VW && y >= 0 && y < H) framePixels[y * VW + x] = color;
}

export function blitLayer(layer: Layer) {
  const offset = Math.round(camX * layer.f);
  for (let y = layer.top; y < H; y++) {
    const row = y * layer.w + offset, out = y * VW;
    for (let x = 0; x < VW; x++) {
      const v = layer.data[row + x];
      if (v) framePixels[out + x] = v;
    }
  }
}

// Background layers, written straight into the pixel buffer, back to front.
export function composeFrame() {
  framePixels.set(sky);

  for (const s of twinkles) {
    const b = Math.sin(game.ticks * s.speed + s.phase);
    if (b > -0.3) framePixels[s.i] = b > 0.5 ? STAR_BRIGHT : STAR_DIM;
  }

  blitLayer(farHills);
  drawBackgroundWar();
  blitLayer(nearHills);

  for (const c of clouds) {
    const cx = Math.round(c.x - camX * CLOUD_PARALLAX);
    if (cx >= VW || cx + c.w <= 0) continue;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const v = c.data[y * c.w + x];
        const sx = cx + x;
        if (v && sx >= 0 && sx < VW) framePixels[(c.y + y) * VW + sx] = v;
      }
    }
  }

  // Terrain, with edge lighting: lit from above-left, shadowed below-right.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < VW; x++) {
      const wx = camX + x;
      const i = y * W + wx;
      const v = terrain[i];
      if (!v) continue;
      let color;
      if (y === 0 || !terrain[i - W]) color = T_LIGHT[v];
      else if (y < H - 1 && !terrain[i + W]) color = T_DARK[v];
      else if (wx > 0 && !terrain[i - 1]) color = T_LIGHT[v];
      else if (wx < W - 1 && !terrain[i + 1]) color = T_DARK[v];
      else color = T_BASE[v];
      framePixels[y * VW + x] = color;
    }
  }

  for (const p of game.particles) {
    if (p.kind === 'spark') {
      putPixel(p.x, p.y, p.color);
    } else if (p.kind === 'shrapnel') {
      putPixel(p.x, p.y, p.color);
      putPixel(p.x + 1, p.y, p.color);
    } else if (p.kind === 'debris') {
      // Clods: lit top-left pixel, shaded bottom-right.
      const x = Math.round(p.x), y = Math.round(p.y), n = p.size;
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const c = n > 1 && dx + dy === 0 ? T_LIGHT[p.idx] : n > 1 && dx + dy === 2 * n - 2 ? T_DARK[p.idx] : T_BASE[p.idx];
          putPixel(x + dx, y + dy, c);
        }
      }
    }
  }

  for (const p of game.projectiles) {
    p.trail.forEach((q, k) => putPixel(q.x, q.y, TRAIL_COLORS[Math.floor((k / p.trail.length) * TRAIL_COLORS.length)]));
    putPixel(p.x - 1, p.y, SHELL_EDGE);
    putPixel(p.x + 1, p.y, SHELL_EDGE);
    putPixel(p.x, p.y - 1, SHELL_EDGE);
    putPixel(p.x, p.y + 1, SHELL_EDGE);
    putPixel(p.x, p.y, SHELL_CORE);
  }
}

export function drawSmoke() {
  for (const p of game.particles) {
    if (p.kind !== 'smoke') continue;
    ctx.globalAlpha = p.alpha * (p.life / p.max);
    fillCircle(Math.round(p.x), Math.round(p.y), Math.round(p.r), p.color);
  }
  ctx.globalAlpha = 1;
}

export function drawExplosion(e: Explosion) {
  const p = e.age / e.life;
  if (p < 0.5) {
    const ring = Math.round(e.radius * (0.7 + p * 1.6));
    ctx.globalAlpha = 1 - p * 2;
    fillRing(e.x, e.y, ring, ring - 2, '#fff1e8');
    ctx.globalAlpha = 1;
  }
  const r = p < 0.15 ? e.radius * (0.5 + (p / 0.15) * 0.5) : e.radius * (1 - (p - 0.15) / 0.85);
  if (r < 1) return;
  const outer = p < 0.1 ? '#ffffff' : p < 0.35 ? '#ffe08a' : p < 0.6 ? '#ffa040' : p < 0.8 ? '#ff5a3a' : '#7a3a4a';
  fillCircle(e.x, e.y, Math.round(r), outer);
  if (p < 0.6) fillCircle(e.x, e.y - Math.round(r * 0.1), Math.round(r * 0.6), p < 0.3 ? '#ffffff' : '#ffe08a');
}
