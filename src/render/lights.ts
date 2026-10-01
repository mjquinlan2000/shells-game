import { DEATH_TICKS } from '../combat/death';
import { barrelTip } from '../combat/tanks';
import { VW } from '../config';
import { game } from '../game/state';
import { rgba } from '../util/color';
import { MOON } from '../world/backdrop';
import { backgroundLights } from '../world/background-war';
import { monoliths } from '../world/obstacles';

// Glowing lights are drawn on the display canvas at full resolution with
// additive blending, so they bloom smoothly over the crisp pixel art.

export interface Light {
  x: number;
  y: number;
  r: number;         // radius, game pixels
  color: string;     // '#rrggbb'
  a: number;         // brightness (alpha), 0..1
  screen?: boolean;  // true: screen coordinates; otherwise world coordinates
}

export const glowCache = new Map<string, HTMLCanvasElement>();

export function glowSprite(color: string): HTMLCanvasElement {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!; // 2D context always exists on a newly created canvas
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.2, rgba(color, 0.6));
  grad.addColorStop(0.5, rgba(color, 0.18));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowCache.set(color, c);
  return c;
}

export function collectLights() {
  // `screen: true` lights are fixed to the screen; the rest are in the world.
  const lights: Light[] = [{ x: MOON.x, y: MOON.y, r: 140, color: '#9fb4ff', a: 0.14, screen: true }];
  if (game.state === 'title') lights.push({ x: VW / 2, y: 70, r: 170, color: '#ff8a24', a: 0.22, screen: true });
  backgroundLights(lights);
  for (const m of monoliths) {
    lights.push({ x: m.x, y: m.y, r: 34, color: '#5ff2ff', a: 0.22 + 0.1 * Math.sin(game.ticks * 0.05 + m.phase) });
  }
  for (const e of game.explosions) {
    const p = e.age / e.life;
    lights.push({ x: e.x, y: e.y, r: e.radius * 3.5, color: '#ffb347', a: (1 - p) ** 2 });
    if (p < 0.12) lights.push({ x: e.x, y: e.y, r: e.radius * 6, color: '#ffffff', a: 0.5 });
  }
  for (const p of game.projectiles) lights.push({ x: p.x, y: p.y, r: 16, color: '#ffb347', a: 0.8 });
  for (const p of game.particles) {
    if (p.kind === 'spark' && p.glow) lights.push({ x: p.x, y: p.y, r: 6, color: '#ffa040', a: Math.min(1, p.life / 20) });
  }
  for (const t of game.tanks) {
    if (!t.alive) lights.push({ x: t.x, y: t.y - 6, r: 22 + Math.random() * 6, color: '#ff7a2a', a: 0.35 });
    if (t.dying > 0) {
      const p = 1 - t.dying / DEATH_TICKS;
      lights.push({ x: t.x, y: t.y - 6, r: 18 + p * 30, color: '#ff7a2a', a: 0.3 + 0.6 * p * Math.random() });
      if (t.pop && t.pop.life > 0) lights.push({ x: t.pop.x, y: t.pop.y, r: 30, color: '#ffffff', a: t.pop.life / 5 });
    }
    if (t.flash > 0) {
      const f = barrelTip(t, t.angle, 14);
      lights.push({ x: f.x, y: f.y, r: 26, color: '#ffe08a', a: t.flash / 6 });
    }
  }
  if (game.state === 'gameover') {
    const winner = game.tanks.find(t => t.alive);
    if (winner) lights.push({ x: VW / 2, y: 170, r: 200, color: winner.color.body, a: 0.25, screen: true });
  }
  return lights;
}
