import { sfxClank } from '../audio';
import { updateDying } from './death';
import { smoke, spark } from './effects';
import { MAX_HP, MOVE_FUEL, PLAYER_COLORS, W, WEAPONS, type TankColors } from '../config';
import { game } from '../game/state';
import { DEG, clamp, rand, type Point } from '../util/math';
import { solid, surfaceY } from '../world/terrain';

// --- Tanks ---
// A tank's (x, y) is the bottom-centre pixel of its 17x9 sprite. Tanks tilt
// to follow the ground, up to MAX_SLOPE; steeper slopes can't be driven up.
// h = highlight, b = body, d = shadow, t = tread; row 7 is animated wheels.

export const MAX_SLOPE = 30 * DEG;    // steepest a tank can climb, and the most it tilts
export const SLIDE_SLOPE = 35 * DEG;  // anything steeper and a resting tank slides down

export interface Tank {
  name: string;           // 'P1'
  title: string;          // 'PLAYER 1'
  color: TankColors;
  x: number;              // bottom-centre of the sprite, world pixels
  y: number;
  tilt: number;           // radians; positive = right side lower
  angle: number;          // degrees: 0 = pointing right, 90 = up, 180 = left
  power: number;          // 5..100
  hp: number;
  armor: number;          // soaks damage before hp (0..MAX_ARMOR), from armor crates
  alive: boolean;
  fuel: number;           // pixels left to drive this turn
  weapon: number;         // index into WEAPONS
  ammo: number[];         // shots left, per weapon
  falling: boolean;
  sliding: boolean;
  fallFrom: number;       // y where the current fall started (for fall damage)
  vy: number;             // fall speed
  fy: number;             // sub-pixel fall progress
  tread: number;          // wheel animation frame
  recoil: number;         // barrel kick after firing
  flash: number;          // muzzle flash timer
  dying: number;          // ticks left in the death sequence (0 = not dying)
  pop: (Point & { life: number }) | null;  // last little hull explosion while dying, for its light
  lastPath: Point[];      // where this tank's previous shot flew, drawn as a hint
  lastMoveTick: number;   // for the engine sound
  lastClimb: number;      // +1 climbing, -1 descending, 0 level
  lastTurnTick: number;   // for the turret sound
  cranks: number;         // ratchet clicks so far, alternates the click pitch
}

export const TANK_SPRITE: (string | null)[] = [
  '......hhhhh......',
  '.....hbbbbbd.....',
  '..hhhhhhhhhhhhh..',
  '.hbbbbbbbbbbbbbd.',
  'hbbbbbbbbbbbbbbbd',
  'ddddddddddddddddd',
  '.ttttttttttttttt.',
  null,
  '.ttttttttttttttt.',
];
export const WRECK_COLORS = { light: '#4a4252', body: '#3a3442', dark: '#26222e' };

export function makeTank(index: number, x: number): Tank {
  return {
    name: `P${index + 1}`,
    title: `PLAYER ${index + 1}`,
    color: PLAYER_COLORS[index],
    x,
    y: 0,
    tilt: 0,        // radians; positive = right side lower
    angle: x < W / 2 ? 45 : 135,  // 0 = pointing right, 90 = up, 180 = left
    power: 55,
    hp: MAX_HP,
    armor: 0,
    alive: true,
    fuel: MOVE_FUEL,
    weapon: 0,
    ammo: WEAPONS.map(w => w.ammo),
    falling: false,
    sliding: false,
    fallFrom: 0,
    vy: 0,
    fy: 0,
    tread: 0,       // wheel animation frame
    recoil: 0,      // barrel kick after firing
    flash: 0,       // muzzle flash timer
    dying: 0,       // ticks left in the death sequence (0 = not dying)
    pop: null,      // last little hull explosion while dying, for its light
    lastPath: [],   // where this tank's previous shot flew, drawn as a hint
    lastMoveTick: -99,  // for the engine sound
    lastClimb: 0,       // +1 climbing, -1 descending, 0 level
    lastTurnTick: -99,  // for the turret sound
    cranks: 0,          // ratchet clicks so far, alternates the click pitch
  };
}

export function grounded(t: Tank) {
  for (let dx = -2; dx <= 2; dx++) if (solid(t.x + dx, t.y + 1)) return true;
  return false;
}

// Height of the ground in column x, searched in a window around y.
export function groundAt(x: number, y: number) {
  for (let gy = y - 8; gy <= y + 12; gy++) if (solid(x, gy)) return gy;
  return y + 12;
}

// Angle of the ground under a tank's treads at (x, y).
export const groundSlope = (x: number, y: number) => Math.atan2(groundAt(x + 6, y) - groundAt(x - 6, y), 12);

export function hurt(t: Tank, amount: number) {
  if (!t.alive || amount <= 0) return;
  const absorbed = Math.min(t.armor, amount);
  t.armor -= absorbed;
  const rest = amount - absorbed;
  if (rest > 0) {
    t.hp = Math.max(0, t.hp - rest);
  }
  // Floaters: armor loss in steel blue, HP loss in red. If both took damage,
  // offset them vertically so neither text obscures the other.
  if (absorbed > 0 && rest > 0) {
    game.floaters.push({ x: t.x, y: t.y - 40, text: `-${absorbed}`, color: '#5ca0d3', life: 70, s: 1 });
    game.floaters.push({ x: t.x, y: t.y - 28, text: `-${rest}`, color: '#ff6b6b', life: 70, s: 1 });
  } else if (absorbed > 0) {
    game.floaters.push({ x: t.x, y: t.y - 30, text: `-${absorbed}`, color: '#5ca0d3', life: 70, s: 1 });
  } else if (rest > 0) {
    game.floaters.push({ x: t.x, y: t.y - 30, text: `-${rest}`, color: '#ff6b6b', life: 70, s: 1 });
  }
}

export function updateTank(t: Tank) {
  if (t.recoil > 0) t.recoil -= 0.25;
  if (t.flash > 0) t.flash--;
  if (t.dying > 0) updateDying(t);
  if (!t.alive && game.ticks % 6 === 0) {
    // Wrecks keep smouldering.
    game.particles.push(smoke(t.x + rand(-4, 4), t.y - 6, 2));
    if (Math.random() < 0.3) game.particles.push(spark(t.x + rand(-4, 4), t.y - 6, rand(-0.4, 0.4), rand(-1.5, -0.5)));
  }

  if (grounded(t)) {
    if (t.falling) {
      const dist = t.y - t.fallFrom;
      if (dist > 12) hurt(t, dist - 12);
      t.falling = false;
    }
    // Too steep to rest on? Slide downhill a pixel every few ticks.
    const slope = groundSlope(t.x, t.y);
    if (Math.abs(slope) <= SLIDE_SLOPE) t.sliding = false;
    else if (game.ticks % 3 === 0) t.sliding = slide(t, slope > 0 ? 1 : -1);
    // Ease toward the ground's angle so the tank settles rather than snaps.
    t.tilt += (clamp(slope, -MAX_SLOPE, MAX_SLOPE) - t.tilt) * 0.3;
    return;
  }
  if (!t.falling) {
    t.falling = true;
    t.fallFrom = t.y;
    t.vy = 0;
    t.fy = 0;
  }
  t.vy = Math.min(t.vy + 0.3, 6);
  t.fy += t.vy;
  while (t.fy >= 1) {
    t.fy -= 1;
    t.y++;
    if (grounded(t)) break;
  }
}

// Moves a tank one pixel sideways, hugging the ground: stepping up small
// ledges or down along a slope (bigger drops become a fall). False if blocked.
export function stepAlongGround(t: Tank, dir: number) {
  const nx = t.x + dir;
  if (nx < 8 || nx > W - 9) return false;
  let ny = t.y;
  while (solid(nx, ny) && t.y - ny < 4) ny--;
  if (solid(nx, ny)) return false;  // a wall
  while (!solid(nx, ny + 1) && ny - t.y < 4) ny++;
  t.lastClimb = Math.sign(t.y - ny);
  t.x = nx;
  t.y = ny;
  t.tread += dir;
  return true;
}

// A slide step only counts if it goes downhill, so sliding always comes to
// rest instead of rocking back and forth in a pit.
export function slide(t: Tank, dir: number) {
  const { x, y, tread } = t;
  if (stepAlongGround(t, dir) && t.y > y) return true;
  t.x = x;
  t.y = y;
  t.tread = tread;
  return false;
}

export function tryMove(t: Tank, dir: number) {
  if (t.fuel <= 0 || t.falling) return;
  // Steep climbs are blocked; steep descents are fine (the tank slides anyway).
  const slope = groundSlope(t.x + dir, t.y);
  if (slope * dir < 0 && Math.abs(slope) > MAX_SLOPE) return;
  if (!stepAlongGround(t, dir)) return;
  t.lastMoveTick = game.ticks;
  t.fuel--;
  if (t.tread % 4 === 0) sfxClank();
}

// The turret sits 7px above the tank's base, rotated with the hull. The
// barrel's aim angle stays absolute, so 45° always means 45° from horizontal.
export function turretPivot(t: Tank): Point {
  return { x: t.x + Math.sin(t.tilt) * 7, y: t.y - Math.cos(t.tilt) * 7 };
}

export function barrelTip(t: Tank, angle: number, length = 12): Point {
  const p = turretPivot(t);
  return {
    x: p.x + Math.cos(angle * DEG) * length,
    y: p.y - Math.sin(angle * DEG) * length,
  };
}

// Picks the spot nearest `target` where the ground is gentle enough to start on.
export function findSpawnX(target: number) {
  let best = target, bestSlope = Infinity;
  for (let d = 0; d <= 40; d++) {
    for (const x of [target - d, target + d]) {
      if (x < 24 || x > W - 25) continue;
      const s = Math.abs(groundSlope(x, surfaceY(x) - 1));
      if (s <= 20 * DEG) return x;
      if (s < bestSlope) {
        best = x;
        bestSlope = s;
      }
    }
  }
  return best;
}
