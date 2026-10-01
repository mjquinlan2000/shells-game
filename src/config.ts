export const VW = 640;   // the visible screen, in game pixels
export const W = 1280;   // the whole battlefield; the camera scrolls across it
export const H = 360;
export const TICK_MS = 1000 / 60;   // the simulation always steps at 60 Hz
export const GRAVITY = 0.1;         // px per tick², pulls shells down
export const WIND_ACCEL = 0.003;    // px per tick² per point of wind
export const MAX_SPEED = 9;         // shell speed at 100 power, px per tick
export const MAX_HP = 100;
export const MOVE_FUEL = 60;        // pixels a tank may drive per turn
export const MAX_ARMOR = 50;       // armor soaks damage before HP does
export const ARMOR_PICKUP = 25;    // armor gained from one armor crate

// How a weapon behaves when fired (see fire() in projectiles.ts).
//   shell     – an ordinary ballistic shell (spread: three of them)
//   cluster   – splits into bomblets at the top of its arc
//   drill     – burrows through the ground, then explodes
//   laser     – an instant straight beam; ignores gravity and wind
//   airstrike – a marker; a bomber then carpet-bombs where it lands
//   nuke      – a huge blast with a mushroom cloud
export type WeaponKind = 'shell' | 'cluster' | 'drill' | 'laser' | 'airstrike' | 'nuke';

export interface Weapon {
  name: string;
  kind: WeaponKind;
  radius: number;   // crater radius, px (cluster/airstrike: per bomblet/bomb; laser: beam half-width)
  damage: number;   // damage at the centre of the blast (cluster/airstrike: per bomblet/bomb)
  ammo: number;     // shots at the start of a match (Infinity = unlimited, 0 = crates only)
  spread?: number;  // fires three shells this many degrees apart
  color: string;    // HUD / icon accent colour
  drop: number;     // how likely a weapon crate holds it (relative weight, 0 = never)
  pickup: number;   // shots gained from one crate
}

export const WEAPONS: Weapon[] = [
  { name: 'SHELL', kind: 'shell', radius: 20, damage: 35, ammo: Infinity, color: '#ffd23b', drop: 0, pickup: 0 },
  { name: 'HEAVY', kind: 'shell', radius: 34, damage: 55, ammo: 2, color: '#ff8a24', drop: 2, pickup: 2 },
  { name: 'TRIPLE', kind: 'shell', radius: 15, damage: 25, ammo: 2, spread: 6, color: '#8fd3ff', drop: 2, pickup: 2 },
  { name: 'CLUSTER', kind: 'cluster', radius: 13, damage: 22, ammo: 0, color: '#ff6ad5', drop: 3, pickup: 2 },
  { name: 'DRILL', kind: 'drill', radius: 24, damage: 45, ammo: 0, color: '#c8a070', drop: 3, pickup: 2 },
  { name: 'LASER', kind: 'laser', radius: 2, damage: 40, ammo: 0, color: '#5cf2ff', drop: 2, pickup: 1 },
  { name: 'AIRSTRIKE', kind: 'airstrike', radius: 18, damage: 28, ammo: 0, color: '#3ee06a', drop: 2, pickup: 1 },
  { name: 'NUKE', kind: 'nuke', radius: 64, damage: 90, ammo: 0, color: '#c6ff3b', drop: 1, pickup: 1 },
];

// The three shades a tank is painted with ('#rrggbb').
export interface TankColors {
  body: string;
  light: string;
  dark: string;
}

export const PLAYER_COLORS: TankColors[] = [
  { body: '#ff3b5c', light: '#ff8fa0', dark: '#9c1f45' },
  { body: '#2fa8ff', light: '#8fd3ff', dark: '#1d4f9c' },
  { body: '#3ee06a', light: '#a6f5b0', dark: '#1f8a4a' },
  { body: '#ffd23b', light: '#fff09a', dark: '#b07a1f' },
];

export const INK = '#0a0a1f';    // darkest UI colour, used for shadows and panels
export const WHITE = '#f4f0ff';
export const DIM = '#8b84b0';
