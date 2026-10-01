import { tone } from '../audio';
import { explode, smoke, spark, type Shrapnel } from './effects';
import type { Tank } from './tanks';
import { game } from '../game/state';
import { packColor } from '../util/color';
import { rand, randInt } from '../util/math';

// --- Death sequence ---
// A destroyed tank doesn't blow at once: it goes critical, spewing sparks and
// smoke with little pops while it shakes and glows, then explodes.

export const DEATH_TICKS = 100;
export const HOT_COLORS = { light: '#ffffff', body: '#ffe08a', dark: '#ff5a3a' };

export function startDying(t: Tank) {
  t.dying = DEATH_TICKS;
  game.floaters.push({ x: t.x, y: t.y - 40, text: 'CRITICAL!', color: '#ff3b5c', life: 60, s: 1 });
  tone('sawtooth', 110, 900, DEATH_TICKS / 60, 0.05);  // rising whine
}

export function updateDying(t: Tank) {
  t.dying--;
  const p = 1 - t.dying / DEATH_TICKS;  // 0 → 1 as the end nears

  // A fountain of sparks out of the hull, getting more violent.
  for (let i = 0; i < 1 + p * 5; i++) {
    const a = -Math.PI / 2 + rand(-0.7, 0.7), v = rand(1.5, 3.5 + p * 3);
    game.particles.push(spark(t.x + rand(-6, 6), t.y - rand(3, 8), Math.cos(a) * v, Math.sin(a) * v));
  }
  if (game.ticks % 3 === 0) {
    game.particles.push(smoke(t.x + rand(-5, 5), t.y - 8, rand(2, 4), { color: '#2a2633', alpha: 0.6 }));
  }

  // Random pops: little bursts from the hull, more often near the end.
  if (t.pop) t.pop.life--;
  if (Math.random() < 0.04 + p * 0.12) {
    const px = t.x + rand(-7, 7), py = t.y - rand(2, 8);
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), v = rand(1, 3.5);
      game.particles.push(spark(px, py, Math.cos(a) * v, Math.sin(a) * v - 1));
    }
    t.pop = { x: px, y: py, life: 5 };
    game.trauma = Math.min(1, game.trauma + 0.06);
    tone('square', rand(300, 900), 60, 0.07, 0.05);
  }
  game.trauma = Math.max(game.trauma, p * 0.35);  // a building rumble

  if (t.dying > 0) return;
  t.alive = false;
  t.pop = null;
  // Shrapnel: bits of the tank flying everywhere.
  const metal = [t.color.body, t.color.dark, '#5c566b', '#8f88a0'].map(packColor);
  for (let i = 0; i < 30; i++) {
    const a = rand(-Math.PI, 0), v = rand(2, 7);
    const s: Shrapnel = {
      kind: 'shrapnel', x: t.x, y: t.y - 5, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: randInt(50, 90), color: metal[randInt(0, metal.length - 1)],
    };
    game.particles.push(s);
  }
  explode(t.x, t.y - 4, 30, 30);
  game.floaters.push({ x: t.x, y: t.y - 40, text: 'BOOM!', color: '#ffa040', life: 80, s: 2 });
}
