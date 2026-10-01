import { sfxLaser, sfxNukeAftershock, sfxTankHit, sfxWhistle, stopNukeAudio } from '../audio';
import { crateAt, collectCrate } from './crates';
import { smoke, spark } from './effects';
import { barrelTip, hurt, type Tank } from './tanks';
import { H, W, WEAPONS, type Weapon } from '../config';
import { camera } from '../game/camera';
import { game } from '../game/state';
import { DEG, clamp, rand } from '../util/math';
import { BORE, markDirty, surfaceY, terrain } from '../world/terrain';

// --- Weapons and Special Munitions ---

// Sub-munitions are distinct Weapon configs (NOT added to WEAPONS, so tank.ammo is unaffected).
export const BOMBLET_WEAPON: Weapon = {
  name: 'BOMBLET',
  kind: 'shell',
  radius: 13,
  damage: 22,
  ammo: 0,
  color: '#ff6ad5',
  drop: 0,
  pickup: 0,
};

export const BOMB_WEAPON: Weapon = {
  name: 'BOMB',
  kind: 'shell',
  radius: 18,
  damage: 28,
  ammo: 0,
  color: '#3ee06a',
  drop: 0,
  pickup: 0,
};

// 1. Laser Beam state
export interface LaserBeam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  age: number;
  maxAge: number;
}

export let activeBeam: LaserBeam | null = null;

// Instant hitscan straight line up to 480px or world edge.
export function fireLaser(t: Tank): void {
  const w = WEAPONS[t.weapon];
  const tip = barrelTip(t, t.angle);
  const rad = t.angle * DEG;
  const dx = Math.cos(rad);
  const dy = -Math.sin(rad);

  let endX = tip.x;
  let endY = tip.y;
  const hitTanks = new Set<Tank>();
  let minDirtyX = tip.x;
  let maxDirtyX = tip.x;

  for (let dist = 1; dist <= 480; dist++) {
    const cx = tip.x + dx * dist;
    const cy = tip.y + dy * dist;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) {
      endX = clamp(cx, 0, W - 1);
      endY = clamp(cy, 0, H - 1);
      break;
    }
    endX = cx;
    endY = cy;

    const ix = Math.round(cx);
    const iy = Math.round(cy);

    // Stop where the beam meets indestructible terrain (see BORE).
    const centerMat = terrain[iy * W + ix];
    if (BORE[centerMat]) {
      break;
    }

    // Burn a channel of half-width w.radius (2px) through destructible terrain.
    const halfWidth = w.radius;
    for (let p = -halfWidth; p <= halfWidth; p++) {
      const px = Math.round(cx - dy * p);
      const py = Math.round(cy + dx * p);
      if (px >= 0 && px < W && py >= 0 && py < H) {
        const idx = py * W + px;
        const v = terrain[idx];
        if (v && !BORE[v]) {
          terrain[idx] = 0;  // burned clean through, even cracked boulders
          if (px < minDirtyX) minDirtyX = px;
          if (px > maxDirtyX) maxDirtyX = px;
        }
      }
    }

    // Collect any crate the beam crosses.
    const crate = crateAt(ix, iy);
    if (crate) {
      collectCrate(crate, t);
    }

    // Every alive tank crossed (except shooter) takes damage once.
    for (const other of game.tanks) {
      if (other.alive && other !== t) {
        if (cx >= other.x - 8 && cx <= other.x + 8 && cy >= other.y - 9 && cy <= other.y) {
          hitTanks.add(other);
        }
      }
    }
  }

  // Damage tanks crossed.
  for (const hit of hitTanks) {
    hurt(hit, w.damage);
    sfxTankHit(1);
  }

  markDirty(Math.floor(minDirtyX) - 2, Math.ceil(maxDirtyX) + 2);

  // Sparks at the end point.
  for (let i = 0; i < 14; i++) {
    game.particles.push(spark(endX, endY, rand(-2.5, 2.5), rand(-2.5, 2.5)));
  }

  // Visual trauma, white flash, and audio.
  game.trauma = Math.min(1, game.trauma + 0.25);
  game.flash = Math.max(game.flash, 0.4);
  sfxLaser();

  // Beam remains visible for ~40 ticks while fading out.
  activeBeam = {
    x0: tip.x,
    y0: tip.y,
    x1: endX,
    y1: endY,
    age: 0,
    maxAge: 40,
  };

  camera.impact = { x: Math.round(endX), tick: game.ticks };
  game.state = 'flying';
}

// 2. Airstrike state
export interface PendingStrike {
  owner: Tank;
  markerX: number;
  markerY: number;
  delay: number;
  flareLife: number;
}

export let pendingStrike: PendingStrike | null = null;

export interface BomberPlane {
  owner: Tank;
  x: number;
  y: number;
  vx: number;
  markerX: number;
  bombsDropped: number;
  dropXs: number[];
}

export let activePlane: BomberPlane | null = null;

export function triggerAirstrike(owner: Tank, markerX: number, markerY: number): void {
  pendingStrike = {
    owner,
    markerX,
    markerY,
    delay: 45,
    flareLife: 85,
  };
  camera.impact = { x: Math.round(markerX), tick: game.ticks };

  // Initial flare puff of red sparks and smoke.
  for (let i = 0; i < 8; i++) {
    game.particles.push(spark(markerX, markerY, rand(-1.5, 1.5), rand(-2.5, -0.5)));
    game.particles.push(smoke(markerX, markerY, rand(2, 4), { color: '#ff3b5c', alpha: 0.7 }));
  }
}

// 3. Shockwave state
export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  speed: number;
  age: number;
  life: number;
  kind: 'blast' | 'secondary' | 'haze';
  delay: number;
}

export let activeShockwaves: Shockwave[] = [];

export function addShockwave(x: number, y: number, maxRadius = 140): void {
  activeShockwaves.push({
    x,
    y,
    radius: 8,
    maxRadius,
    speed: 0.14,
    age: 0,
    life: 38,
    kind: 'blast',
    delay: 0,
  });
}

// 4. Mushroom Cloud state (decorative nuclear detonation visual)
export interface MushroomCloud {
  x: number;          // ground impact center x
  y: number;          // ground impact surface y
  age: number;        // current age in ticks
  life: number;       // total lifetime in ticks (~480 ticks = ~8 s)
  windOffset: number; // accumulated wind drift for cap
}

export let activeMushroomClouds: MushroomCloud[] = [];

export function addMushroomCloud(x: number, y: number): void {
  activeMushroomClouds.push({
    x,
    y,
    age: 0,
    life: 480,
    windOffset: 0,
  });
}

// 5. Nuke Screen Tint (display-layer whiteout & warm atmospheric tint)
export interface NukeScreenTint {
  age: number;
  maxAge: number;
}

export let activeNukeTint: NukeScreenTint | null = null;

// 6. Nuke Aftershocks & Sustained Rumble
export interface NukeAftershock {
  delay: number;
  strength: number;
}

export let pendingNukeAftershocks: NukeAftershock[] = [];
export let nukeRumbleTicks = 0;

// Coordinate all dramatic aftermath of a nuclear impact:
// 3 staggered shockwaves, massive mushroom cloud, screen flash & tint,
// camera rumble sustain, and tick-scheduled audio aftershocks.
export function triggerNukeDetonation(x: number, y: number): void {
  addMushroomCloud(x, y);

  // 3 staggered shockwave rings:
  // - Fast bright shock front
  // - Slower secondary compression ring
  // - Slow rolling heat-haze ring
  activeShockwaves.push(
    { x, y, radius: 8, maxRadius: 280, speed: 0.16, age: 0, life: 36, kind: 'blast', delay: 0 },
    { x, y, radius: 6, maxRadius: 220, speed: 0.12, age: 0, life: 44, kind: 'secondary', delay: 7 },
    { x, y, radius: 4, maxRadius: 175, speed: 0.07, age: 0, life: 58, kind: 'haze', delay: 14 },
  );

  activeNukeTint = { age: 0, maxAge: 240 };
  nukeRumbleTicks = 60; // Sustained screen trauma for ~1 s

  // 3 delayed rumbling aftershocks scheduled in game ticks
  pendingNukeAftershocks = [
    { delay: 40, strength: 0.8 },
    { delay: 90, strength: 0.55 },
    { delay: 150, strength: 0.35 },
  ];
}


// 4. Update weapons module logic (called every tick by flow.ts)
export function updateWeapons(): void {
  // Laser beam fade
  if (activeBeam) {
    activeBeam.age++;
    if (activeBeam.age >= activeBeam.maxAge) {
      activeBeam = null;
    }
  }

  // Pending strike: flare particles and delay countdown
  if (pendingStrike) {
    pendingStrike.flareLife--;
    if (pendingStrike.flareLife > 0 && Math.random() < 0.6) {
      game.particles.push(smoke(pendingStrike.markerX + rand(-2, 2), pendingStrike.markerY - 2, rand(2, 4), {
        color: '#ff3b5c',
        vy: -rand(0.6, 1.2),
        drag: 0.95,
        alpha: 0.65,
      }));
      if (Math.random() < 0.4) {
        game.particles.push(spark(pendingStrike.markerX, pendingStrike.markerY, rand(-1, 1), -rand(1, 2.5)));
      }
    }

    pendingStrike.delay--;
    if (pendingStrike.delay <= 0 && !activePlane) {
      // Spawn bomber plane flying toward marker from shooter's side
      const fromLeft = pendingStrike.owner.x <= pendingStrike.markerX;
      const vx = fromLeft ? 4 : -4;
      const startX = fromLeft ? -30 : W + 30;
      const mx = pendingStrike.markerX;
      // 5 bombs spaced ~20px centred on markerX: -40, -20, 0, +20, +40
      const dropXs = fromLeft
        ? [mx - 40, mx - 20, mx, mx + 20, mx + 40]
        : [mx + 40, mx + 20, mx, mx - 20, mx - 40];

      activePlane = {
        owner: pendingStrike.owner,
        x: startX,
        y: 24,
        vx,
        markerX: mx,
        bombsDropped: 0,
        dropXs,
      };
      pendingStrike = null;
    }
  }

  // Bomber plane flying across and releasing bombs
  if (activePlane) {
    activePlane.x += activePlane.vx;

    // Drop bombs when passing each target X
    while (activePlane.bombsDropped < 5) {
      const targetX = activePlane.dropXs[activePlane.bombsDropped];
      const reached = activePlane.vx > 0 ? (activePlane.x >= targetX) : (activePlane.x <= targetX);
      if (reached) {
        const isMiddle = activePlane.bombsDropped === 2;
        game.projectiles.push({
          x: activePlane.x,
          y: activePlane.y + 6,
          vx: activePlane.vx * 0.5,
          vy: 0.5,
          weapon: BOMB_WEAPON,
          owner: activePlane.owner,
          age: 0,
          trail: [],
          tracked: isMiddle,
          dead: false,
        });
        sfxWhistle();
        activePlane.bombsDropped++;
      } else {
        break;
      }
    }

    // Leave the world after dropping all 5 bombs
    const leftWorld = activePlane.vx > 0 ? activePlane.x > W + 40 : activePlane.x < -40;
    if (activePlane.bombsDropped === 5 && leftWorld) {
      activePlane = null;
    }
  }

  // Nuke screen tint progression
  if (activeNukeTint) {
    activeNukeTint.age++;
    if (activeNukeTint.age >= activeNukeTint.maxAge) {
      activeNukeTint = null;
    }
  }

  // Sustained camera rumble: trauma held high for ~1 s then allowed to decay naturally
  if (nukeRumbleTicks > 0) {
    nukeRumbleTicks--;
    game.trauma = Math.max(game.trauma, 0.95);
  }

  // Delayed rumbling aftershocks driven in game ticks
  for (const a of pendingNukeAftershocks) {
    if (--a.delay === 0) {
      sfxNukeAftershock(a.strength);
      game.trauma = Math.min(1, game.trauma + 0.22 * a.strength);
    }
  }
  pendingNukeAftershocks = pendingNukeAftershocks.filter(a => a.delay > 0);

  // Shockwave expansion & ground dust kick-up
  for (const s of activeShockwaves) {
    if (s.delay > 0) {
      s.delay--;
      continue;
    }
    s.age++;
    s.radius += (s.maxRadius - s.radius) * s.speed;

    // Kicked-up dust where the expanding ring meets the terrain surface
    if (s.age > 2 && s.age < s.life * 0.85 && s.age % 2 === 0) {
      for (const dir of [-1, 1]) {
        const gx = Math.round(s.x + dir * s.radius);
        if (gx >= 0 && gx < W) {
          const gy = surfaceY(gx);
          if (Math.abs(s.y - gy) <= s.radius + 8) {
            game.particles.push(smoke(gx, gy - 2, rand(3, 5), {
              color: '#7a4a36',
              vx: dir * rand(0.8, 2.2),
              vy: -rand(0.4, 1.3),
              drag: 0.92,
              alpha: 0.55,
            }));
          }
        }
      }
    }
  }
  activeShockwaves = activeShockwaves.filter(s => s.delay > 0 || s.age < s.life);

  // Mushroom cloud drift, aging, and fallout particles
  for (const c of activeMushroomClouds) {
    c.age++;
    c.windOffset += game.wind * 0.015;

    // Fallout: glowing embers and ash raining down around the cloud for several seconds
    // (Cheap particles; total concurrent stays <= ~70, well under 400)
    if (c.age >= 38 && c.age <= 340) {
      const riseT = Math.min(1, Math.max(0, (c.age - 10) / 160));
      const ease = 1 - Math.pow(1 - riseT, 3);
      const maxClimb = Math.max(60, c.y - 70);
      const stemH = Math.round(maxClimb * ease);
      const capX = c.x + c.windOffset;
      const capY = c.y - stemH;

      // Glowing ember spark falling from cap
      if (Math.random() < 0.7) {
        game.particles.push(spark(
          capX + rand(-58, 58),
          capY + rand(6, 24),
          rand(-0.4, 0.4) + game.wind * 0.02,
          rand(0.4, 1.5),
        ));
      }

      // Soft ash flake drifting down
      if (c.age % 2 === 0) {
        game.particles.push(smoke(
          capX + rand(-64, 64),
          capY + rand(4, 26),
          rand(1.5, 2.5),
          {
            color: '#342e2b',
            vx: rand(-0.2, 0.2) + game.wind * 0.03,
            vy: rand(0.5, 1.2),
            drag: 0.98,
            alpha: 0.5,
          },
        ));
      }
    }
  }
  activeMushroomClouds = activeMushroomClouds.filter(c => c.age < c.life);
}

// True while any special weapon sequence is in motion
export function weaponsBusy(): boolean {
  return activeBeam !== null || pendingStrike !== null || activePlane !== null;
}

// Reset all weapon module state on match reset
export function resetWeapons(): void {
  activeBeam = null;
  pendingStrike = null;
  activePlane = null;
  activeShockwaves = [];
  activeMushroomClouds = [];
  activeNukeTint = null;
  pendingNukeAftershocks = [];
  nukeRumbleTicks = 0;
  stopNukeAudio();  // a roar still rolling must not carry into the next match
}
