import type { Explosion, Floater, Particle } from '../combat/effects';
import type { Projectile } from '../combat/projectiles';
import type { Tank } from '../combat/tanks';

// Everything about the match in progress that more than one file changes.
//
// Why one object instead of loose variables? An ES module can export a `let`,
// and other files see its current value, but only the file that declared it
// may assign to it. Keeping shared, reassigned state as fields of one object
// lets any system write `game.trauma = …` or `game.particles = […]`, and gives
// the browser console a single place to inspect (`SHELLS.game`).

// States: title -> aim -> flying -> resolving -> aim (next player) ... -> gameover
export type Phase = 'title' | 'aim' | 'flying' | 'resolving' | 'gameover';

export interface Banner {
  text: string;
  color: string;
  age: number;
  life: number;
}

export const game = {
  state: 'title' as Phase,
  tanks: [] as Tank[],
  current: 0,               // index into `tanks` of whose turn it is
  wind: 0,                  // -10..10; pushes shells sideways
  banner: null as Banner | null,
  resolveDelay: 0,          // ticks to wait after everything settles
  ticks: 0,                 // simulation ticks since the page loaded (60 per second)

  projectiles: [] as Projectile[],
  explosions: [] as Explosion[],
  particles: [] as Particle[],
  floaters: [] as Floater[],  // rising damage numbers and labels

  // Impact feel. `trauma` (0..1) is added by explosions and decays over time;
  // the actual shake is trauma², so small hits barely nudge the screen while
  // big or chained explosions really throw it around.
  trauma: 0,
  hitstop: 0,               // ticks the world freezes on a big impact
  flash: 0,                 // white screen flash, 0..1
};
