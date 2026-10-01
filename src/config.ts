export const VW = 640;   // the visible screen, in game pixels
export const W = 1280;   // the whole battlefield; the camera scrolls across it
export const H = 360;
export const TICK_MS = 1000 / 60;   // the simulation always steps at 60 Hz
export const GRAVITY = 0.1;         // px per tick², pulls shells down
export const WIND_ACCEL = 0.003;    // px per tick² per point of wind
export const MAX_SPEED = 9;         // shell speed at 100 power, px per tick
export const MAX_HP = 100;
export const MOVE_FUEL = 60;        // pixels a tank may drive per turn
export const HUD_H = 17;

export interface Weapon {
  name: string;
  radius: number;   // crater radius, px
  damage: number;   // damage at the centre of the blast
  ammo: number;     // shots per match (Infinity = unlimited)
  spread?: number;  // fires three shells this many degrees apart
}

export const WEAPONS: Weapon[] = [
  { name: 'SHELL', radius: 20, damage: 35, ammo: Infinity },
  { name: 'HEAVY', radius: 34, damage: 55, ammo: 2 },
  { name: 'TRIPLE', radius: 15, damage: 25, ammo: 2, spread: 6 },
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
