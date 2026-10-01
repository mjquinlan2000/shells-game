import { H, INK, VW, W } from '../config';
import { mix, packColor } from '../util/color';
import { clamp, rand, randInt } from '../util/math';

// --- Terrain: one material index per pixel, 0 means air ---
// Each material has a colour plus rules for how it behaves:
//   solid  — blocks shells and tanks (decoration like grass tufts doesn't)
//   loose  — falls when the ground under it is blown away
//   blast  — what an explosion turns it into: 'AIR', another material
//            (boulders crack before they break), or 'SELF' (indestructible)
//   rubble — what it lands as when flung out as debris (null = nothing)
//   scorch — whether the crater rim chars it

export interface MaterialProps {
  solid?: boolean;
  loose?: boolean;
  blast?: string;
  rubble?: string | null;
  scorch?: boolean;
}

export type MaterialDef = [name: string, color: string, props?: MaterialProps];

export interface Material {
  name: string;
  color: string;
  solid: boolean;
  loose: boolean;
  blast: string;
  rubble: string | null;
  scorch: boolean;
}

export const MATERIAL_DEFS: MaterialDef[] = [
  ['GRASS', '#4fbf4a'], ['GRASS_DARK', '#2f8a45'],
  ['DIRT', '#a5603c'], ['DIRT_1', '#87492f'], ['DIRT_2', '#663626'], ['DIRT_3', '#47261e'], ['DIRT_4', '#2e1915'],
  ['ROCK', '#6b6170', { scorch: false }], ['ROCK_DARK', '#4a4252', { scorch: false }],
  ['SCORCH', '#3a2420'], ['SCORCH_DARK', '#22140f'],
  // Boulders: the first blast cracks them, the second breaks them.
  ...['BOULDER_HI:#a49cb0:CRACKED_HI', 'BOULDER:#7d7590:CRACKED', 'BOULDER_LO:#565068:CRACKED_LO'].map(s => {
    const [name, color, cracked] = s.split(':');
    return [name, color, { loose: false, scorch: false, blast: cracked, rubble: 'ROCK' }] as MaterialDef;
  }),
  ['MOSS', '#3e8f3a', { loose: false, scorch: false, rubble: 'GRASS_DARK' }],
  ['CRACKED_HI', '#8a8296', { loose: false, scorch: false, rubble: 'ROCK' }],
  ['CRACKED', '#655e78', { loose: false, scorch: false, rubble: 'ROCK' }],
  ['CRACKED_LO', '#433e52', { loose: false, scorch: false, rubble: 'ROCK_DARK' }],
  ['CRACK', '#1e1a28', { loose: false, scorch: false, rubble: 'ROCK_DARK' }],
  // Ancient monoliths: indestructible, carved with glowing runes.
  ['STONE_HI', '#5a6a88', { loose: false, scorch: false, blast: 'SELF' }],
  ['STONE', '#3c4660', { loose: false, scorch: false, blast: 'SELF' }],
  ['STONE_LO', '#262c40', { loose: false, scorch: false, blast: 'SELF' }],
  ['RUNE', '#5ff2ff', { loose: false, scorch: false, blast: 'SELF' }],
  // Floating islands: they hang in the air, but can be blasted apart.
  ['ISLE_GRASS', '#4fbf4a', { loose: false, scorch: false, rubble: 'GRASS' }],
  ['ISLE_GRASS_DARK', '#2f8a45', { loose: false, scorch: false, rubble: 'GRASS_DARK' }],
  ['ISLE_DIRT', '#87492f', { loose: false, scorch: false, rubble: 'DIRT_1' }],
  ['ISLE_DIRT_DARK', '#663626', { loose: false, scorch: false, rubble: 'DIRT_2' }],
  ['ISLE_ROCK', '#4a4252', { loose: false, scorch: false, rubble: 'ROCK_DARK' }],
  // Decoration: drawn, but shells and treads pass straight through.
  ['TUFT', '#4fbf4a', { solid: false, scorch: false, rubble: null }],
  ['TUFT_TIP', '#8be36b', { solid: false, scorch: false, rubble: null }],
  ['ROOT', '#5c3a2a', { solid: false, loose: false, scorch: false, rubble: null }],
  ['VINE', '#3e8f3a', { solid: false, loose: false, scorch: false, rubble: null }],
  ['VINE_TIP', '#8be36b', { solid: false, loose: false, scorch: false, rubble: null }],
];

export const T: Record<string, number> = {};
export const MATERIALS: (Material | null)[] = [null];
for (const [name, color, props] of MATERIAL_DEFS) {
  T[name] = MATERIALS.length;
  MATERIALS.push({ name, color, solid: true, loose: true, blast: 'AIR', rubble: name, scorch: true, ...props });
}
// Flat lookup tables, indexed by material, for the hot loops.
export const SOLID = Uint8Array.from(MATERIALS, m => (m && m.solid ? 1 : 0));
export const LOOSE = Uint8Array.from(MATERIALS, m => (m && m.loose ? 1 : 0));
export const SCORCHABLE = Uint8Array.from(MATERIALS, m => (m && m.scorch ? 1 : 0));
export const BLAST = Uint8Array.from(MATERIALS, (m, i) => (!m || m.blast === 'AIR' ? 0 : m.blast === 'SELF' ? i : T[m.blast]));
export const RUBBLE = Uint8Array.from(MATERIALS, m => (m && m.rubble ? T[m.rubble] : 0));
export const T_BASE = MATERIALS.map(m => (m ? packColor(m.color) : 0));
export const T_LIGHT = MATERIALS.map(m => (m ? packColor(mix(m.color, '#fff4d6', 0.25)) : 0));
export const T_DARK = MATERIALS.map(m => (m ? packColor(mix(m.color, INK, 0.35)) : 0));

export const terrain = new Uint8Array(W * H);

export function soilAt(depth: number) {
  if (depth < 3) return Math.random() < 0.3 ? T.GRASS_DARK : T.GRASS;
  if (depth < 6) return Math.random() < (depth - 2) / 4 ? T.DIRT : T.GRASS_DARK;
  const band = clamp(Math.floor((depth + rand(-5, 5)) / 30), 0, 4);
  return T.DIRT + (Math.random() < 0.06 ? Math.min(band + 1, 4) : band);
}

export function fillColumn(x: number, top: number) {
  for (let y = 0; y < H; y++) terrain[y * W + x] = y >= top ? soilAt(y - top) : 0;
}

export function setPixel(x: number, y: number, material: number) {
  if (x >= 0 && x < W && y >= 0 && y < H) terrain[y * W + x] = material;
}

export function generateTerrain() {
  // Rolling hills = a few sine waves of different sizes added together.
  const waves = [
    [rand(0.004, 0.007), rand(0, 6.28), rand(36, 60)],
    [rand(0.01, 0.018), rand(0, 6.28), rand(12, 24)],
    [rand(0.03, 0.045), rand(0, 6.28), rand(2, 6)],
  ];
  const base = rand(H * 0.55, H * 0.68);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    let h = base;
    for (const [freq, phase, amp] of waves) h += Math.sin(x * freq + phase) * amp;
    tops[x] = Math.round(clamp(h, 80, H - 30));
    fillColumn(x, tops[x]);
  }
  // Buried rocks.
  for (let n = 30 * W / VW; n > 0; n--) {
    const cx = randInt(0, W - 1), cy = tops[cx] + randInt(15, 120), r = rand(2, 5);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= W || y >= H || Math.hypot(dx, dy * 1.4) > r) continue;
        if (terrain[y * W + x]) terrain[y * W + x] = dy > 0 ? T.ROCK_DARK : T.ROCK;
      }
    }
  }
  // Grass tufts poking up from the surface.
  for (let x = 0; x < W; x++) {
    if (Math.random() > 0.35) continue;
    const h = randInt(1, 3);
    for (let k = 1; k <= h; k++) terrain[(tops[x] - k) * W + x] = k === h ? T.TUFT_TIP : T.TUFT;
  }
  dirtyMin = W;
  dirtyMax = -1;
}

// The bottom edge of the screen counts as solid ground.
export function solid(x: number, y: number) {
  if (y >= H) return true;
  if (x < 0 || x >= W || y < 0) return false;
  return SOLID[terrain[y * W + x]] === 1;
}

export function surfaceY(x: number) {
  for (let y = 0; y < H; y++) if (solid(x, y)) return y;
  return H;
}

// Columns touched by explosions; loose material in them falls 1px per pass.
export let dirtyMin = W;
export let dirtyMax = -1;

export function markDirty(x0: number, x1: number) {
  dirtyMin = Math.min(dirtyMin, Math.max(0, x0));
  dirtyMax = Math.max(dirtyMax, Math.min(W - 1, x1));
}

export function settleTerrain() {
  if (dirtyMax < dirtyMin) return;
  let moved = false;
  for (let x = dirtyMin; x <= dirtyMax; x++) {
    // Bottom-up, so a whole floating chunk drops together by one pixel.
    // Boulders, monoliths and islands stay put.
    for (let y = H - 2; y >= 0; y--) {
      const i = y * W + x;
      if (LOOSE[terrain[i]] && !terrain[i + W]) {
        terrain[i + W] = terrain[i];
        terrain[i] = 0;
        moved = true;
      }
    }
  }
  if (!moved) {
    dirtyMin = W;
    dirtyMax = -1;
  }
}

export const terrainSettling = () => dirtyMax >= dirtyMin;
