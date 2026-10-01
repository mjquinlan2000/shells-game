import { DEATH_TICKS } from '../combat/death';
import { barrelTip } from '../combat/tanks';
import { activeBeam, activeMushroomClouds, pendingStrike } from '../combat/weapons';
import { H, VW } from '../config';
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
  for (const p of game.projectiles) {
    if (p.weapon.kind === 'nuke') {
      const blink = Math.floor(p.age / 5) % 2 === 0;
      lights.push({
        x: p.x,
        y: p.y,
        r: blink ? 24 : 14,
        color: blink ? '#3ee06a' : '#1f8a4a',
        a: blink ? 0.95 : 0.35,
      });
    } else {
      lights.push({ x: p.x, y: p.y, r: 16, color: '#ffb347', a: 0.8 });
    }
  }
  if (activeBeam) {
    const p = activeBeam.age / activeBeam.maxAge;
    const alpha = Math.max(0, 1 - p);
    const dx = activeBeam.x1 - activeBeam.x0;
    const dy = activeBeam.y1 - activeBeam.y0;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.floor(len / 24));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      lights.push({
        x: activeBeam.x0 + dx * t,
        y: activeBeam.y0 + dy * t,
        r: 22,
        color: '#5cf2ff',
        a: alpha * 0.7,
      });
    }
    lights.push({
      x: activeBeam.x1,
      y: activeBeam.y1,
      r: 32,
      color: '#ffffff',
      a: alpha * 0.85,
    });
  }
  if (pendingStrike && pendingStrike.flareLife > 0) {
    lights.push({
      x: pendingStrike.markerX,
      y: pendingStrike.markerY,
      r: 22 + Math.random() * 4,
      color: '#ff3b5c',
      a: 0.8,
    });
  }
  for (const c of activeMushroomClouds) {
    // 1. Initial detonation flash: intense screen-space light + huge ground-zero light
    if (c.age < 30) {
      const flashA = 1 - c.age / 30;
      lights.push({ x: VW / 2, y: H / 2, r: 360, color: '#ffffff', a: flashA * 0.95, screen: true });
    }
    if (c.age < 42) {
      const worldFlashA = 1 - c.age / 42;
      lights.push({ x: c.x, y: c.y - 12, r: 260, color: '#fff6d6', a: worldFlashA * 0.9 });
      lights.push({ x: c.x, y: c.y - 12, r: 140, color: '#ffffff', a: worldFlashA });
    }

    // Geometry of rising mushroom cloud
    const riseT = Math.min(1, Math.max(0, (c.age - 10) / 160));
    const ease = 1 - Math.pow(1 - riseT, 3);
    const maxClimb = Math.max(60, c.y - 70);
    const stemH = Math.round(maxClimb * ease);
    const capX = c.x + c.windOffset;
    const capY = c.y - stemH;

    // 2. Pulsing orange glow on the climbing, billowing cap (lingers ~280 ticks)
    if (c.age < 300) {
      const heat = Math.max(0, 1 - c.age / 280);
      const pulse = 1 + 0.14 * Math.sin(c.age * 0.22) + 0.08 * Math.cos(c.age * 0.53);
      lights.push({
        x: capX,
        y: capY,
        r: Math.round((70 + heat * 85) * pulse),
        color: heat > 0.45 ? '#ff9a28' : '#ff5414',
        a: heat * 0.8,
      });

      // Hot glowing core visible inside the cap
      if (c.age < 140) {
        const coreA = 1 - c.age / 140;
        lights.push({
          x: capX,
          y: capY - 4,
          r: Math.round(48 + coreA * 30),
          color: '#ffea6c',
          a: coreA * 0.85,
        });
      }
    }

    // 3. Pulsing orange glow on the crater rim and caldera (lingers ~250 ticks)
    if (c.age >= 6 && c.age < 260) {
      const rimHeat = 1 - (c.age - 6) / 254;
      const rimPulse = 1 + 0.12 * Math.sin(c.age * 0.18);
      // Center crater floor
      lights.push({
        x: c.x,
        y: c.y - 4,
        r: Math.round((42 + rimHeat * 42) * rimPulse),
        color: '#ff4c10',
        a: rimHeat * 0.75,
      });
      // Left and right crater rims
      lights.push({
        x: c.x - 28,
        y: c.y - 2,
        r: 26,
        color: '#ff6c18',
        a: rimHeat * 0.45,
      });
      lights.push({
        x: c.x + 28,
        y: c.y - 2,
        r: 26,
        color: '#ff6c18',
        a: rimHeat * 0.45,
      });
    }
  }
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
