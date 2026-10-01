import { sfxBlip, sfxFire } from '../audio';
import { crateAt, collectCrate } from './crates';
import { explode, explodeNuke, smoke, spark, DUST_COLOR } from './effects';
import { barrelTip, type Tank } from './tanks';
import { BOMBLET_WEAPON, fireLaser, triggerAirstrike } from './weapons';
import { GRAVITY, H, MAX_SPEED, W, WEAPONS, WIND_ACCEL, type Weapon } from '../config';
import { camera } from '../game/camera';
import { game } from '../game/state';
import { DEG, clamp, rand, type Point } from '../util/math';
import { BORE, markDirty, solid, terrain } from '../world/terrain';

// Extra ticks the camera lingers on a nuke, on top of IMPACT_LINGER, so the
// mushroom cloud gets its moment before the next turn pans away.
export const NUKE_LINGER = 240;
// --- Projectiles ---

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weapon: Weapon;
  owner: Tank;
  age: number;        // ticks in flight
  trail: Point[];     // recent positions, drawn as a glowing streak
  tracked: boolean;   // the camera follows it (the middle shell of a TRIPLE)
  dead: boolean;
  drilling?: boolean;
  drillRemaining?: number;
  drillDir?: Point;
}

export function fire(t: Tank) {
  const w = WEAPONS[t.weapon];
  if (t.ammo[t.weapon] <= 0) return;

  // Laser has no physical projectile: instant hitscan straight beam
  if (w.kind === 'laser') {
    t.ammo[t.weapon]--;
    t.lastPath = [];
    t.recoil = 4;
    t.flash = 6;
    const tip = barrelTip(t, t.angle);
    for (let i = 0; i < 3; i++) game.particles.push(smoke(tip.x, tip.y, 2));
    fireLaser(t);
    return;
  }

  t.ammo[t.weapon]--;
  t.lastPath = [];
  t.recoil = 4;
  t.flash = 6;
  // Nuke flies slower to convey huge mass
  const speedMult = w.kind === 'nuke' ? 0.72 : 1;
  const speed = (t.power / 100) * MAX_SPEED * speedMult;

  for (const offset of w.spread ? [-w.spread, 0, w.spread] : [0]) {
    const angle = t.angle + offset;
    const tip = barrelTip(t, angle);
    game.projectiles.push({
      x: tip.x,
      y: tip.y,
      vx: Math.cos(angle * DEG) * speed,
      vy: -Math.sin(angle * DEG) * speed,
      weapon: w,
      owner: t,
      age: 0,
      trail: [],
      tracked: offset === 0,
      dead: false,
    });
  }
  const tip = barrelTip(t, t.angle);
  for (let i = 0; i < 3; i++) game.particles.push(smoke(tip.x, tip.y, 2));
  game.state = 'flying';
  sfxFire();
}

// The tank a shell at (x, y) is touching, if any.
export function struckTank(p: Projectile, x: number, y: number): Tank | null {
  return game.tanks.find(t =>
    t.alive &&
    !(t === p.owner && p.age < 8) &&  // don't collide with our own barrel
    x >= t.x - 8 && x <= t.x + 8 && y >= t.y - 9 && y <= t.y) ?? null;
}

function splitCluster(p: Projectile, hit: boolean): void {
  p.dead = true;
  for (let i = 0; i < 5; i++) {
    let vx: number;
    let vy: number;
    if (hit) {
      // Fan upward away from the ground
      const baseAngle = p.vy > 0 ? Math.atan2(-Math.abs(p.vy) * 0.7, p.vx) : Math.atan2(p.vy, p.vx);
      const angle = baseAngle + (i - 2) * (14 * DEG);
      const spd = Math.max(3.5, Math.hypot(p.vx, p.vy)) * (0.85 + Math.abs(i - 2) * 0.1);
      vx = Math.cos(angle) * spd;
      vy = Math.sin(angle) * spd;
    } else {
      // Apex fan in the direction of flight
      const baseAngle = Math.atan2(p.vy, p.vx);
      const angle = baseAngle + (i - 2) * (12 * DEG);
      const spd = Math.max(3, Math.hypot(p.vx, p.vy)) * (0.85 + Math.abs(i - 2) * 0.1);
      vx = Math.cos(angle) * spd;
      vy = Math.sin(angle) * spd;
    }
    game.projectiles.push({
      x: p.x,
      y: hit ? p.y - 2 : p.y,
      vx,
      vy,
      weapon: BOMBLET_WEAPON,
      owner: p.owner,
      age: 0,
      trail: [],
      tracked: i === 2 && p.tracked,
      dead: false,
    });
  }
  for (let k = 0; k < 6; k++) {
    game.particles.push(spark(p.x, p.y, rand(-2, 2), rand(-2, 2)));
  }
  sfxBlip(520);
}

export function updateProjectile(p: Projectile) {
  // 1. DRILL burrowing behavior (straight line, no gravity, carving a ~3px tunnel)
  if (p.drilling) {
    p.age++;
    const dir = p.drillDir ?? { x: 0, y: 1 };
    const stepSpeed = 2.5;
    const dist = Math.min(stepSpeed, p.drillRemaining ?? 60);
    const steps = Math.ceil(dist);

    for (let s = 0; s < steps; s++) {
      const d = dist / steps;
      p.x += dir.x * d;
      p.y += dir.y * d;
      p.drillRemaining = (p.drillRemaining ?? 60) - d;

      const ix = Math.round(p.x);
      const iy = Math.round(p.y);

      if (ix < 0 || ix >= W || iy >= H - 1) {
        p.dead = true;
        if (p.tracked) camera.impact = { x: clamp(ix, 0, W - 1), tick: game.ticks };
        explode(clamp(ix, 0, W - 1), Math.min(iy, H - 1), p.weapon.radius, p.weapon.damage);
        return;
      }

      const struck = struckTank(p, ix, iy);
      if (struck) {
        p.dead = true;
        if (p.tracked) camera.impact = { x: ix, tick: game.ticks };
        explode(ix, iy, p.weapon.radius, p.weapon.damage, struck);
        return;
      }

      // Carve ~3px-radius tunnel through ground; stop at indestructible terrain
      let hitIndestructible = false;
      let minX = ix;
      let maxX = ix;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy > 9) continue;
          const tx = ix + dx;
          const ty = iy + dy;
          if (tx < 0 || tx >= W || ty < 0 || ty >= H) continue;
          const idx = ty * W + tx;
          const v = terrain[idx];
          if (!v) continue;
          if (BORE[v]) {  // indestructible (monoliths): the drill stops here
            hitIndestructible = true;
            break;
          }
          terrain[idx] = 0;
          if (tx < minX) minX = tx;
          if (tx > maxX) maxX = tx;
        }
        if (hitIndestructible) break;
      }
      markDirty(minX, maxX);

      if (hitIndestructible || (p.drillRemaining ?? 0) <= 0) {
        p.dead = true;
        if (p.tracked) camera.impact = { x: ix, tick: game.ticks };
        explode(ix, iy, p.weapon.radius, p.weapon.damage);
        return;
      }
    }

    // Throw sparks and dust while drilling (no debris that would add terrain)
    if (Math.random() < 0.75) {
      game.particles.push(smoke(p.x, p.y, rand(2, 4), {
        color: DUST_COLOR,
        vx: -dir.x * rand(0.5, 1.5) + rand(-0.3, 0.3),
        vy: -dir.y * rand(0.5, 1.5) + rand(-0.3, 0.3),
        drag: 0.92,
        alpha: 0.5,
      }));
    }
    if (Math.random() < 0.5) {
      game.particles.push(spark(p.x, p.y, -dir.x * rand(1, 2) + rand(-0.5, 0.5), -dir.y * rand(1, 2) + rand(-0.5, 0.5)));
    }

    p.trail.push({ x: p.x, y: p.y });
    if (p.trail.length > 14) p.trail.shift();
    if (p.tracked && p.age % 3 === 0) p.owner.lastPath.push({ x: Math.round(p.x), y: Math.round(p.y) });
    return;
  }

  // 2. Ballistic flight
  p.vx += game.wind * WIND_ACCEL;
  const grav = p.weapon.kind === 'nuke' ? GRAVITY * 0.75 : GRAVITY;
  const prevVy = p.vy;
  p.vy += grav;
  p.age++;

  // CLUSTER shell: splits into 5 bomblets at top of arc (vy goes >= 0)
  if (p.weapon.kind === 'cluster' && p.age > 2 && prevVy < 0 && p.vy >= 0) {
    splitCluster(p, false);
    return;
  }

  // Move in 1px sub-steps so fast shells can't tunnel through thin ground.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
  for (let s = 0; s < steps; s++) {
    p.x += p.vx / steps;
    p.y += p.vy / steps;
    const ix = Math.round(p.x);
    const iy = Math.round(p.y);
    if (ix < 0 || ix >= W || p.age > 1500) {
      p.dead = true;
      if (p.tracked) camera.impact = { x: clamp(ix, 0, W - 1), tick: game.ticks };
      return;
    }

    // Crate contact counts as impact, and collects crate for shooter
    const crate = crateAt(ix, iy);
    if (crate) {
      collectCrate(crate, p.owner);
    }

    const struck = struckTank(p, ix, iy);
    const hitTerrain = iy >= H - 1 || (iy >= 0 && solid(ix, iy));
    const hitCrate = !!crate;

    if (hitTerrain || struck || hitCrate) {
      const impactY = Math.min(iy, H - 1);

      // CLUSTER splits on premature impact as well
      if (p.weapon.kind === 'cluster') {
        splitCluster(p, true);
        return;
      }

      // DRILL burrows on solid ground, but explodes immediately on tank, crate, or bottom
      if (p.weapon.kind === 'drill') {
        if (struck || hitCrate || iy >= H - 1) {
          p.dead = true;
          if (p.tracked) camera.impact = { x: ix, tick: game.ticks };
          explode(ix, impactY, p.weapon.radius, p.weapon.damage, struck);
          return;
        }
        p.drilling = true;
        p.drillRemaining = 60;
        const spd = Math.hypot(p.vx, p.vy);
        p.drillDir = spd > 0.001 ? { x: p.vx / spd, y: p.vy / spd } : { x: 0, y: 1 };
        return;
      }

      // AIRSTRIKE marker canister (no crater; drops flare and starts strike)
      if (p.weapon.kind === 'airstrike') {
        p.dead = true;
        if (p.tracked) camera.impact = { x: ix, tick: game.ticks };
        triggerAirstrike(p.owner, ix, impactY);
        return;
      }

      // NUKE
      if (p.weapon.kind === 'nuke') {
        p.dead = true;
        // Date the impact in the future so the camera stays on the mushroom
        // cloud ~4 s longer before panning to the next player (the next turn
        // waits for this linger in updateResolving). The cloud itself still
        // never blocks the turn; this is a fixed, finite pause.
        if (p.tracked) camera.impact = { x: ix, tick: game.ticks + NUKE_LINGER };
        explodeNuke(ix, impactY, p.weapon.radius, p.weapon.damage, struck);
        return;
      }

      // Ordinary SHELL / HEAVY / TRIPLE / BOMBLET / BOMB
      p.dead = true;
      if (p.tracked) camera.impact = { x: ix, tick: game.ticks };
      explode(ix, impactY, p.weapon.radius, p.weapon.damage, struck);
      return;
    }
  }
  p.trail.push({ x: p.x, y: p.y });
  if (p.trail.length > 14) p.trail.shift();
  if (p.tracked && p.age % 3 === 0) p.owner.lastPath.push({ x: Math.round(p.x), y: Math.round(p.y) });
}
