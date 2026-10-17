import { sfxPickup } from '../audio';
import { spark } from './effects';
import type { Tank } from './tanks';
import { ARMOR_PICKUP, H, MAX_ARMOR, W, WEAPONS } from '../config';
import { game } from '../game/state';
import { clamp, rand } from '../util/math';
import { solid } from '../world/terrain';

// --- Supply Crates ---
// Supply crates parachute in periodically, offering either extra weapon ammo
// or armor plating. A crate's (x, y) is the bottom-centre of its ~9x8 sprite.

export interface Crate {
  x: number;          // bottom-centre world X (pixels)
  y: number;          // bottom-centre world Y (pixels)
  kind: 'weapon' | 'armor';
  parachute: boolean; // true while floating down on a parachute
  vy: number;         // vertical velocity (px/tick)
  fy: number;         // fractional vertical accumulation
  sway: number;       // sway phase angle for gentle oscillation
}

export let crates: Crate[] = [];

// Clears all crates on match reset or title screen.
export function resetCrates(): void {
  crates.length = 0;
  crates = [];
}

// 50% chance at each turn change to drop a new supply crate (up to 3 total).
export function maybeDropCrate(): void {
  if (crates.length >= 3) return;
  if (Math.random() >= 0.5) return;
  dropCrate(rand(24, W - 24), Math.random() < 0.7 ? 'weapon' : 'armor');
}

// Parachutes one crate in at world column x. Turn changes call this through
// maybeDropCrate(); the dev menu calls it directly to drop a crate on demand.
export function dropCrate(x: number, kind: 'weapon' | 'armor'): void {
  crates.push({
    x,
    y: -10,
    kind,
    parachute: true,
    vy: 0.6,
    fy: 0,
    sway: rand(0, Math.PI * 2),
  });

  // Announce the drop near the top of the sky so players take notice
  game.floaters.push({
    x: Math.round(x),
    y: 20,
    text: 'SUPPLY DROP',
    color: '#ffe08a',
    life: 90,
    s: 1,
  });
}

// Returns the crate whose ~9x8 box contains the given world coordinate, or null.
export function crateAt(x: number, y: number): Crate | null {
  for (let i = crates.length - 1; i >= 0; i--) {
    const c = crates[i];
    if (x >= c.x - 4 && x <= c.x + 4 && y >= c.y - 8 && y <= c.y) {
      return c;
    }
  }
  return null;
}

// An explosion opens every crate it touches and hands it to the player whose
// turn it is. Every blast during a turn comes from that player's shot (or a
// chain reaction it caused, like a tank it destroyed blowing up), so they
// earned it. Without this, players had to land a shell exactly on the crate.
//
// "Touches" means the blast circle, plus the scorched rim (`radius + 4`, the
// same rim explode() chars), overlaps the crate's ~9x8 box. To test a circle
// against a box, find the point of the box closest to the circle's centre and
// check whether that point is inside the circle.
export function collectCratesInBlast(x: number, y: number, radius: number): void {
  const shooter = game.tanks[game.current];
  // A shooter who blew themselves up can't use the loot; leave it for others.
  // (A tank at 0 HP is still `alive` until its dying sequence plays out.)
  if (!shooter || !shooter.alive || shooter.hp <= 0) return;
  const reach = radius + 4;
  // Walk backwards: collectCrate() removes crates from the array as we go.
  for (let i = crates.length - 1; i >= 0; i--) {
    const c = crates[i];
    const nx = clamp(x, c.x - 4, c.x + 4);
    const ny = clamp(y, c.y - 8, c.y);
    if ((nx - x) ** 2 + (ny - y) ** 2 <= reach * reach) collectCrate(c, shooter);
  }
}

// Ground check for a crate: tests beneath its bottom-centre and edges.
function isCrateGrounded(c: Crate): boolean {
  if (c.y >= H - 1) return true;
  const cx = Math.round(c.x);
  const cy = Math.floor(c.y);
  if (solid(cx, cy)) return true;
  return solid(cx - 3, cy + 1) || solid(cx, cy + 1) || solid(cx + 3, cy + 1);
}

// Gives crate contents to the tank, removes the crate, and pops visual/audio feedback.
export function collectCrate(c: Crate, t: Tank): void {
  const idx = crates.indexOf(c);
  if (idx >= 0) crates.splice(idx, 1);

  if (c.kind === 'weapon') {
    // Weighted weapon selection by weapon.drop
    let total = 0;
    for (const w of WEAPONS) total += w.drop;
    let roll = Math.random() * total;
    let chosen = 1; // fallback
    for (let i = 0; i < WEAPONS.length; i++) {
      roll -= WEAPONS[i].drop;
      if (roll <= 0) {
        chosen = i;
        break;
      }
    }
    const w = WEAPONS[chosen];
    if (Number.isFinite(t.ammo[chosen])) {
      t.ammo[chosen] += w.pickup;
    }
    game.floaters.push({
      x: t.x,
      y: t.y - 30,
      text: `+${w.pickup} ${w.name}`,
      color: w.color,
      life: 75,
      s: 1,
    });
  } else {
    // Show what was actually gained: near the cap a crate tops armor up only
    // partly, and with full armor it gives nothing.
    const before = t.armor;
    t.armor = Math.min(MAX_ARMOR, t.armor + ARMOR_PICKUP);
    const gained = t.armor - before;
    game.floaters.push({
      x: t.x,
      y: t.y - 30,
      text: gained > 0 ? `+${gained} ARMOR` : 'ARMOR FULL',
      color: '#5ca0d3',
      life: 75,
      s: 1,
    });
  }

  // Sparkle burst to celebrate opening the mystery box
  for (let i = 0; i < 14; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(1, 3.5);
    game.particles.push(spark(c.x, c.y - 4, Math.cos(angle) * speed, Math.sin(angle) * speed));
  }

  sfxPickup();
}

// True only while some crate is free-falling without a parachute.
// Parachuting crates drift slowly and must not stall turn resolution.
export function cratesBusy(): boolean {
  return crates.some(c => !c.parachute && !isCrateGrounded(c));
}

// Updates crate positions, parachute descent, free-fall gravity, and tank pickup.
export function updateCrates(): void {
  for (let i = crates.length - 1; i >= 0; i--) {
    const c = crates[i];

    if (c.parachute) {
      // Gentle descent with sideways sway
      c.sway += 0.04;
      c.x = clamp(c.x + Math.sin(c.sway) * 0.35, 12, W - 12);

      c.vy = 0.6;
      c.fy += c.vy;
      while (c.fy >= 1) {
        c.fy -= 1;
        c.y++;
        if (isCrateGrounded(c) || c.y >= H - 1) {
          c.parachute = false;
          c.vy = 0;
          c.fy = 0;
          if (c.y >= H - 1) c.y = H - 1;
          break;
        }
      }
    } else {
      // Landed crate: falls if ground underneath has been excavated
      if (!isCrateGrounded(c)) {
        c.vy = Math.min(c.vy + 0.3, 6);
        c.fy += c.vy;
        while (c.fy >= 1) {
          c.fy -= 1;
          c.y++;
          if (isCrateGrounded(c) || c.y >= H - 1) {
            c.vy = 0;
            c.fy = 0;
            if (c.y >= H - 1) c.y = H - 1;
            break;
          }
        }
      } else {
        c.vy = 0;
        c.fy = 0;
        if (c.y >= H - 1) c.y = H - 1;
      }
    }

    // Check collision with any alive tank
    // Covers driving into it, falling onto it, or a crate landing on a tank
    let collected = false;
    for (const t of game.tanks) {
      // Crate box (x±4, y-8..y) overlaps tank box (x±8, y-9..y)
      const hit = t.alive &&
        c.x + 4 >= t.x - 8 &&
        c.x - 4 <= t.x + 8 &&
        c.y >= t.y - 9 &&
        c.y - 8 <= t.y;
      if (hit) {
        collectCrate(c, t);
        collected = true;
        break;
      }
    }
    if (collected) continue;
  }
}
