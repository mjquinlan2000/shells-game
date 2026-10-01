import { sfxFire } from '../audio';
import { explode, smoke } from './effects';
import { barrelTip, type Tank } from './tanks';
import { GRAVITY, H, MAX_SPEED, W, WEAPONS, WIND_ACCEL, type Weapon } from '../config';
import { camera } from '../game/camera';
import { game } from '../game/state';
import { DEG, clamp, type Point } from '../util/math';
import { solid } from '../world/terrain';

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
}

export function fire(t: Tank) {
  const w = WEAPONS[t.weapon];
  if (t.ammo[t.weapon] <= 0) return;
  t.ammo[t.weapon]--;
  t.lastPath = [];
  t.recoil = 4;
  t.flash = 6;
  const speed = (t.power / 100) * MAX_SPEED;
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

export function updateProjectile(p: Projectile) {
  p.vx += game.wind * WIND_ACCEL;
  p.vy += GRAVITY;
  p.age++;
  // Move in 1px sub-steps so fast shells can't tunnel through thin ground.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
  for (let s = 0; s < steps; s++) {
    p.x += p.vx / steps;
    p.y += p.vy / steps;
    const ix = Math.round(p.x);
    const iy = Math.round(p.y);
    if (ix < 0 || ix >= W || p.age > 1500) {
      p.dead = true;  // flew off the side of the map
      if (p.tracked) camera.impact = { x: clamp(ix, 0, W - 1), tick: game.ticks };
      return;
    }
    const struck = struckTank(p, ix, iy);
    if (iy >= H - 1 || (iy >= 0 && solid(ix, iy)) || struck) {
      p.dead = true;
      if (p.tracked) camera.impact = { x: ix, tick: game.ticks };
      explode(ix, Math.min(iy, H - 1), p.weapon.radius, p.weapon.damage, struck);
      return;
    }
  }
  p.trail.push({ x: p.x, y: p.y });
  if (p.trail.length > 14) p.trail.shift();
  if (p.tracked && p.age % 3 === 0) p.owner.lastPath.push({ x: Math.round(p.x), y: Math.round(p.y) });
}
