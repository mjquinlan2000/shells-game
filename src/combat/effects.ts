import { sfxBoom, sfxNuke, sfxTankHit } from '../audio';
import { hurt, type Tank } from './tanks';
import { triggerNukeDetonation } from './weapons';
import { H, W } from '../config';
import { game } from '../game/state';
import { packColor } from '../util/color';
import { clamp, rand, randInt } from '../util/math';
import { BLAST, RUBBLE, SCORCHABLE, SOLID, T, T_BASE, markDirty, solid, terrain } from '../world/terrain';

// --- Explosions, particles, floating text ---
// Particle kinds: 'debris' (dirt that lands and becomes terrain again),
// 'shrapnel' (bits of metal or stone), 'spark' (glowing embers) and 'smoke'
// (soft puffs: smoke and dust clouds).

// Pixel-buffer colours (from packColor) are numbers; canvas colours are
// '#rrggbb' strings.
export interface Spark { kind: 'spark'; x: number; y: number; vx: number; vy: number; life: number; color: number; glow: boolean }
export interface Shrapnel { kind: 'shrapnel'; x: number; y: number; vx: number; vy: number; life: number; color: number }
export interface Debris { kind: 'debris'; idx: number; x: number; y: number; vx: number; vy: number; life: number; size: number }
export interface Smoke {
  kind: 'smoke'; x: number; y: number; vx: number; vy: number; life: number;
  max: number;    // starting life, for fading out
  r: number;      // radius; the puff grows as it drifts
  color: string; drag: number; alpha: number;
}
// A union: `p.kind` tells TypeScript (and you) which fields exist.
export type Particle = Spark | Shrapnel | Debris | Smoke;

export interface Explosion { x: number; y: number; radius: number; age: number; life: number }

// Rising text such as damage numbers; `s` is the font scale.
export interface Floater { x: number; y: number; text: string; color: string; life: number; s: number }

export interface SmokeOptions {
  color?: string;
  vx?: number;
  vy?: number;
  drag?: number;
  alpha?: number;
}
export const MAX_SHAKE = 22;     // game pixels at full trauma
export const MAX_TILT = 0.035;   // radians (~2°) at full trauma

export const SPARK_COLORS = ['#ffffff', '#ffe08a', '#ffa040', '#ff5a3a'].map(packColor);
export const SMOKE_COLOR = '#544c66';
export const DUST_COLOR = '#7a4a36';

export function spark(x: number, y: number, vx: number, vy: number): Spark {
  return {
    kind: 'spark', x, y, vx, vy, life: randInt(15, 40),
    color: SPARK_COLORS[randInt(0, SPARK_COLORS.length - 1)], glow: Math.random() < 0.4,
  };
}

export function smoke(x: number, y: number, r: number, { color = SMOKE_COLOR, vx = rand(-0.3, 0.3), vy = rand(-0.6, -0.2), drag = 0.99, alpha = 0.4 }: SmokeOptions = {}): Smoke {
  const life = randInt(60, 120);
  return { kind: 'smoke', x, y, vx, vy, r, color, drag, alpha, life, max: life };
}

export function debris(idx: number, x: number, y: number, size: number, angle: number, speed: number): Debris {
  return {
    kind: 'debris', idx, x, y, size,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: randInt(90, 150),
  };
}

// `struck` is the tank a shell hit directly, if any (for the metal clang).
export function explode(x: number, y: number, radius: number, damage: number, struck: Tank | null = null) {
  // Bigger blasts throw dirt faster and higher.
  const power = Math.sqrt(radius / 20);

  // 1. Carve a crater and scorch its rim. Each material decides what the
  //    blast does to it: most break, boulders crack first, monoliths shrug it
  //    off. Some broken earth erupts upward as clods that land as terrain.
  const rim = radius + 4;
  const cracked: number[] = [];
  for (let dy = -rim; dy <= rim; dy++) {
    for (let dx = -rim; dx <= rim; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > rim * rim) continue;
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const i = py * W + px;
      const v = terrain[i];
      if (!v) continue;
      if (d2 > radius * radius) {
        // The rim: dirt gets charred, grass and roots burn away.
        if (!SOLID[v]) terrain[i] = 0;
        else if (SCORCHABLE[v] && Math.random() < 1 - (Math.sqrt(d2) - radius) / 4.5) {
          terrain[i] = Math.random() < 0.5 ? T.SCORCH : T.SCORCH_DARK;
        }
        continue;
      }
      const after = BLAST[v];
      if (after === v) continue;  // indestructible
      terrain[i] = after;
      if (after) {
        // Cracked, not broken: chip off a few stone flakes.
        cracked.push(i);
        if (Math.random() < 0.03) {
          const a = -Math.PI / 2 + rand(-1.2, 1.2), v0 = rand(1.5, 4);
          const s: Shrapnel = { kind: 'shrapnel', x: px, y: py, vx: Math.cos(a) * v0, vy: Math.sin(a) * v0, life: randInt(40, 70), color: T_BASE[v] };
          game.particles.push(s);
        }
        continue;
      }
      const rubble = RUBBLE[v];
      if (!rubble) continue;
      const roll = Math.random();
      if (roll < 0.06) {
        // Clods: a wide fan, leaning away from the blast centre.
        const a = -Math.PI / 2 + rand(-0.9, 0.9) + (dx / radius) * 0.4;
        const size = Math.random();
        game.particles.push(debris(rubble, px, py, size < 0.35 ? 1 : size < 0.75 ? 2 : size < 0.95 ? 3 : 4, a, rand(1.5, 5.5) * power));
      } else if (roll < 0.11) {
        // Geyser: a narrow, fast plume of dirt straight up.
        const a = -Math.PI / 2 + rand(-0.3, 0.3);
        game.particles.push(debris(rubble, px, py, randInt(1, 2), a, rand(4, 8) * power));
      }
    }
  }
  // Draw crack lines wandering through freshly cracked stone.
  for (let n = Math.min(8, Math.ceil(cracked.length / 40)); n > 0; n--) {
    const start = cracked[randInt(0, cracked.length - 1)];
    let cx = start % W, cy = Math.floor(start / W), a = rand(0, Math.PI * 2);
    for (let step = randInt(5, 12); step > 0; step--) {
      cx += Math.round(Math.cos(a));
      cy += Math.round(Math.sin(a));
      a += rand(-0.6, 0.6);
      const m = cx >= 0 && cx < W && cy >= 0 && cy < H ? terrain[cy * W + cx] : 0;
      if (m !== T.CRACKED_HI && m !== T.CRACKED && m !== T.CRACKED_LO) break;
      terrain[cy * W + cx] = T.CRACK;
    }
  }
  markDirty(x - rim, x + rim);

  // 2. Damage tanks: full damage near the centre, fading out at the edge.
  const reach = radius + 8;
  let struckDamage = 0;
  for (const t of game.tanks) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - x, t.y - 4 - y);
    if (d >= reach) continue;
    const dealt = Math.round(damage * clamp((reach - d) / (reach - 6), 0, 1));
    hurt(t, dealt);
    if (t === struck) struckDamage = dealt;
  }
  // Metal clang only for a direct hit; splash damage just gets the boom.
  if (struckDamage > 0) sfxTankHit(Math.min(1, struckDamage / 55));

  // 3. Fire, sparks, smoke and dust.
  game.explosions.push({ x, y, radius, age: 0, life: 28 });
  for (let i = 0; i < 14 + radius / 2; i++) {
    const a = rand(0, Math.PI * 2), v = rand(1, 4.5);
    game.particles.push(spark(x, y, Math.cos(a) * v, Math.sin(a) * v - 1.5));
  }
  for (let i = 0; i < 4 + radius / 4; i++) {
    game.particles.push(smoke(x + rand(-radius / 2, radius / 2), y + rand(-radius / 2, 0), rand(3, 6)));
  }
  // A column of dust shooting up out of the crater...
  for (let i = 0; i < 6 + radius / 3; i++) {
    game.particles.push(smoke(x + rand(-radius / 3, radius / 3), y - rand(0, radius / 2), rand(3, 7), {
      color: DUST_COLOR, vx: rand(-0.4, 0.4), vy: -rand(1, 3) * power, drag: 0.96, alpha: 0.55,
    }));
  }
  // ...and a ring of dust rolling out along the ground.
  for (let i = 0; i < 10 + radius / 2; i++) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    game.particles.push(smoke(x + dir * rand(0, radius / 2), y + rand(-2, 4), rand(3, 6), {
      color: DUST_COLOR, vx: dir * rand(1.5, 4) * power, vy: -rand(0.1, 0.5), drag: 0.93, alpha: 0.5,
    }));
  }

  // 4. Impact: shake, freeze-frame, flash, boom.
  game.trauma = Math.min(1, game.trauma + radius / 40);
  game.hitstop = Math.max(game.hitstop, Math.round(radius / 7));
  game.flash = Math.max(game.flash, radius / 70);
  sfxBoom(radius);
}

// Nuclear detonation: standard crater & damage, plus blinding screen flash,
// sustained trauma rumble, longer hitstop (~20), 3 staggered shockwaves,
// massive churning mushroom cloud, fallout, and deep rolling audio.
export function explodeNuke(x: number, y: number, radius: number, damage: number, struck: Tank | null = null): void {
  explode(x, y, radius, damage, struck);

  // High-impact extras
  game.flash = 1;
  game.trauma = 1;
  game.hitstop = Math.max(game.hitstop, 20);

  // Mushroom cloud, 3 staggered shockwaves, screen tint, rumble, aftershocks
  triggerNukeDetonation(x, y);

  // Upward fiery sparks inside the rising detonation column (< 30 new particles)
  for (let i = 0; i < 24; i++) {
    game.particles.push(spark(x + rand(-8, 8), y - rand(2, 10), rand(-1.5, 1.5), -rand(2.5, 5.5)));
  }
  sfxNuke();
}

export function updateParticle(p: Particle) {
  p.life--;
  if (p.kind === 'smoke') {
    p.x += p.vx + game.wind * 0.02;
    p.y += p.vy;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.r += 0.05;
    return;
  }
  p.vy += 0.15;
  p.x += p.vx;
  p.y += p.vy;
  const ix = Math.round(p.x), iy = Math.round(p.y);
  if (ix < 0 || ix >= W || iy >= H) {
    p.life = 0;
  } else if ((p.kind === 'debris' || p.kind === 'shrapnel') && p.vy > 0 && solid(ix, iy + (p.kind === 'debris' ? p.size : 1) - 1)) {
    // A clod lands and becomes terrain again, so dirt piles up. Each clod
    // only removed one pixel from the crater, so it only puts one back —
    // otherwise repeated shots would slowly raise the battlefield.
    if (p.kind === 'debris') {
      const ty = iy + p.size - 2;
      if (ty >= 0 && !terrain[ty * W + ix]) terrain[ty * W + ix] = p.idx;
      markDirty(ix, ix);
    }
    p.life = 0;
  }
}
