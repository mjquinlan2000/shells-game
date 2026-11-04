import { H, INK, VW, W } from '../config';
import { mix, packColor } from '../util/color';
import { clamp, rand, randInt } from '../util/math';
import { ARENAS, type Arena } from './arenas';

// --- Terrain: one material index per pixel, 0 means air ---
// The active arena defines the battlefield's appearance and geography:
//   - Material palette: surface top layer, 5 soil bands, buried rock pockets,
//     floating island stone, and surface tufts. Material rows are generated
//     for each arena at load time and compiled into flat lookup tables.
//   - Ground shape: height lines shaped by GroundShape generators (rolling,
//     dunes, peaks, caldera, craters, plateaus, flat, canyon, valley).
//
// Each material has a colour plus rules for how it behaves:
//   solid  — blocks shells and tanks (decoration like tufts/vines doesn't)
//   loose  — falls when the ground under it is blown away (settleTerrain)
//   blast  — what an explosion turns it into: 'AIR', another material
//            (boulders crack before breaking), or 'SELF' (indestructible)
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

function buildMaterialDefs(): MaterialDef[] {
  const defs: MaterialDef[] = [];

  // Per-arena rows generated from every arena in ARENAS
  for (const arena of ARENAS) {
    const id = arena.id;
    // Surface top and dark speckle
    defs.push([`${id}_TOP`, arena.palette.top[0]]);
    defs.push([`${id}_TOP_DARK`, arena.palette.top[1]]);

    // Deeper soil bands 0..4
    for (let i = 0; i < 5; i++) {
      defs.push([`${id}_SOIL_${i}`, arena.palette.soil[i]]);
    }

    // Buried rock pockets
    defs.push([`${id}_ROCK`, arena.palette.rock[0], { scorch: false }]);
    defs.push([`${id}_ROCK_DARK`, arena.palette.rock[1], { scorch: false }]);

    // Floating island stone (fixed in air, drops loose arena rubble when broken)
    defs.push([`${id}_ISLE_TOP`, arena.palette.top[0], { loose: false, scorch: false, rubble: `${id}_TOP` }]);
    defs.push([`${id}_ISLE_TOP_DARK`, arena.palette.top[1], { loose: false, scorch: false, rubble: `${id}_TOP_DARK` }]);
    defs.push([`${id}_ISLE_SOIL`, arena.palette.soil[1], { loose: false, scorch: false, rubble: `${id}_SOIL_1` }]);
    defs.push([`${id}_ISLE_SOIL_DARK`, arena.palette.soil[2], { loose: false, scorch: false, rubble: `${id}_SOIL_2` }]);
    defs.push([`${id}_ISLE_ROCK`, arena.palette.rock[1], { loose: false, scorch: false, rubble: `${id}_ROCK_DARK` }]);

    // Decorative tufts poking up from the ground (only when arena has deco)
    if (arena.palette.deco) {
      defs.push([`${id}_TUFT`, arena.palette.deco[0], { solid: false, scorch: false, rubble: null }]);
      defs.push([`${id}_TUFT_TIP`, arena.palette.deco[1], { solid: false, scorch: false, rubble: null }]);
    }
  }

  // Shared rows:
  // Shared grey rock pair for boulder / cracked stone debris
  defs.push(['ROCK', '#6b6170', { scorch: false }]);
  defs.push(['ROCK_DARK', '#4a4252', { scorch: false }]);

  defs.push(['SCORCH', '#3a2420']);
  defs.push(['SCORCH_DARK', '#22140f']);

  // Boulders: the first blast cracks them, the second breaks them.
  defs.push(['BOULDER_HI', '#a49cb0', { loose: false, scorch: false, blast: 'CRACKED_HI', rubble: 'ROCK' }]);
  defs.push(['BOULDER', '#7d7590', { loose: false, scorch: false, blast: 'CRACKED', rubble: 'ROCK' }]);
  defs.push(['BOULDER_LO', '#565068', { loose: false, scorch: false, blast: 'CRACKED_LO', rubble: 'ROCK' }]);

  defs.push(['MOSS', '#3e8f3a', { loose: false, scorch: false, rubble: null }]);

  defs.push(['CRACKED_HI', '#8a8296', { loose: false, scorch: false, rubble: 'ROCK' }]);
  defs.push(['CRACKED', '#655e78', { loose: false, scorch: false, rubble: 'ROCK' }]);
  defs.push(['CRACKED_LO', '#433e52', { loose: false, scorch: false, rubble: 'ROCK_DARK' }]);
  defs.push(['CRACK', '#1e1a28', { loose: false, scorch: false, rubble: 'ROCK_DARK' }]);

  // Ancient monoliths: indestructible, carved with glowing runes.
  defs.push(['STONE_HI', '#5a6a88', { loose: false, scorch: false, blast: 'SELF' }]);
  defs.push(['STONE', '#3c4660', { loose: false, scorch: false, blast: 'SELF' }]);
  defs.push(['STONE_LO', '#262c40', { loose: false, scorch: false, blast: 'SELF' }]);
  defs.push(['RUNE', '#5ff2ff', { loose: false, scorch: false, blast: 'SELF' }]);

  // Decoration: roots and vines dangling from floating islands
  defs.push(['ROOT', '#5c3a2a', { solid: false, loose: false, scorch: false, rubble: null }]);
  defs.push(['VINE', '#3e8f3a', { solid: false, loose: false, scorch: false, rubble: null }]);
  defs.push(['VINE_TIP', '#8be36b', { solid: false, loose: false, scorch: false, rubble: null }]);

  return defs;
}

export const MATERIAL_DEFS: MaterialDef[] = buildMaterialDefs();

export const T: Record<string, number> = {};
export const MATERIALS: (Material | null)[] = [null];
for (const [name, color, props] of MATERIAL_DEFS) {
  T[name] = MATERIALS.length;
  MATERIALS.push({ name, color, solid: true, loose: true, blast: 'AIR', rubble: name, scorch: true, ...props });
}
if (MATERIALS.length > 256) {
  throw new Error(`Too many terrain materials (${MATERIALS.length} > 256)`);
}

// Flat lookup tables, indexed by material, for the hot loops.
export const SOLID = Uint8Array.from(MATERIALS, m => (m && m.solid ? 1 : 0));
export const LOOSE = Uint8Array.from(MATERIALS, m => (m && m.loose ? 1 : 0));
export const SCORCHABLE = Uint8Array.from(MATERIALS, m => (m && m.scorch ? 1 : 0));
export const BLAST = Uint8Array.from(MATERIALS, (m, i) => (!m || m.blast === 'AIR' ? 0 : m.blast === 'SELF' ? i : T[m.blast]));
// What a material ends up as once a laser or drill has worked right through
// it: BLAST applied repeatedly, so boulders go cracked → air in one pass
// instead of leaving a solid cracked plug. Indestructible materials (or
// anything whose chain ends in one) keep that material, which stops the bore.
export const BORE = Uint8Array.from(MATERIALS, (_, i) => {
  let v = i;
  for (let n = 0; n < MATERIALS.length && v && BLAST[v] !== v; n++) v = BLAST[v];
  return v;
});
export const RUBBLE = Uint8Array.from(MATERIALS, m => (m && m.rubble ? T[m.rubble] : 0));
export const T_BASE = MATERIALS.map(m => (m ? packColor(m.color) : 0));
export const T_LIGHT = MATERIALS.map(m => (m ? packColor(mix(m.color, '#fff4d6', 0.25)) : 0));
export const T_DARK = MATERIALS.map(m => (m ? packColor(mix(m.color, INK, 0.35)) : 0));

export const terrain = new Uint8Array(W * H);

export interface ArenaMaterials {
  top: number;
  topDark: number;
  soil: number[];       // 5 entries: SOIL_0 .. SOIL_4
  rock: number;
  rockDark: number;
  isleTop: number;
  isleTopDark: number;
  isleSoil: number;
  isleSoilDark: number;
  isleRock: number;
  tuft: number;
  tuftTip: number;
}

export function getArenaMaterials(arena: Arena): ArenaMaterials {
  const p = arena.id;
  return {
    top: T[`${p}_TOP`],
    topDark: T[`${p}_TOP_DARK`],
    soil: [
      T[`${p}_SOIL_0`],
      T[`${p}_SOIL_1`],
      T[`${p}_SOIL_2`],
      T[`${p}_SOIL_3`],
      T[`${p}_SOIL_4`],
    ],
    rock: T[`${p}_ROCK`],
    rockDark: T[`${p}_ROCK_DARK`],
    isleTop: T[`${p}_ISLE_TOP`],
    isleTopDark: T[`${p}_ISLE_TOP_DARK`],
    isleSoil: T[`${p}_ISLE_SOIL`],
    isleSoilDark: T[`${p}_ISLE_SOIL_DARK`],
    isleRock: T[`${p}_ISLE_ROCK`],
    tuft: T[`${p}_TUFT`] || 0,
    tuftTip: T[`${p}_TUFT_TIP`] || 0,
  };
}

// Initial fallback so soilAt/fillColumn have valid materials before the first generateTerrain call.
let activeArenaMaterials: ArenaMaterials = getArenaMaterials(ARENAS[0]);

export function soilAt(depth: number) {
  if (depth < 3) return Math.random() < 0.3 ? activeArenaMaterials.topDark : activeArenaMaterials.top;
  if (depth < 6) return Math.random() < (depth - 2) / 4 ? activeArenaMaterials.soil[0] : activeArenaMaterials.topDark;
  const band = clamp(Math.floor((depth + rand(-5, 5)) / 30), 0, 4);
  const soilIdx = Math.random() < 0.06 ? Math.min(band + 1, 4) : band;
  return activeArenaMaterials.soil[soilIdx];
}

export function fillColumn(x: number, top: number) {
  for (let y = 0; y < H; y++) terrain[y * W + x] = y >= top ? soilAt(y - top) : 0;
}

export function setPixel(x: number, y: number, material: number) {
  if (x >= 0 && x < W && y >= 0 && y < H) terrain[y * W + x] = material;
}

// Rolling hills: the classic terrain, adding three sine waves together.
function shapeRolling(base: number, amp: number): number[] {
  const waves = [
    [rand(0.004, 0.007), rand(0, 6.28), rand(36, 60)],
    [rand(0.01, 0.018), rand(0, 6.28), rand(12, 24)],
    [rand(0.03, 0.045), rand(0, 6.28), rand(2, 6)],
  ];
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    let h = base;
    for (const [freq, phase, waveAmp] of waves) h += Math.sin(x * freq + phase) * waveAmp * amp;
    tops[x] = Math.round(clamp(h, 80, H - 30));
  }
  return tops;
}

// Dunes: long, smooth, lopsided sand waves with gentle windward slopes.
function shapeDunes(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28);
  const freq = rand(0.007, 0.010);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    const t = x * freq + p1;
    // Skewed harmonic produces an asymmetrical slip-face dune wave.
    const dune = (Math.sin(t) - 0.2 * Math.sin(2 * t)) * 24 * amp;
    const ripple = Math.sin(x * 0.03 + p2) * 2 * amp;
    tops[x] = Math.round(clamp(base + dune + ripple, 80, H - 30));
  }
  return tops;
}

// Peaks: sharp mountain ridges with deep notches and standable saddles for spawns.
function shapePeaks(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28), p3 = rand(0, 6.28);
  const raw: number[] = [];
  for (let x = 0; x < W; x++) {
    // Inverted absolute sines generate knife-edge mountain crests and V-shaped notches.
    const r1 = (Math.abs(Math.sin(x * 0.006 + p1)) - 0.5) * 44 * amp;
    const r2 = (Math.abs(Math.cos(x * 0.013 + p2)) - 0.5) * 16 * amp;
    const rough = Math.sin(x * 0.035 + p3) * 2 * amp;
    raw.push(base + r1 + r2 + rough);
  }
  // Subtle ledges near player spawn zones ensure tanks have standable ground.
  const spawnZones = [160, 213, 320, 480, 640, 800, 960, 1067, 1120];
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    let h = raw[x];
    let minD = Infinity, closest = spawnZones[0];
    for (const sz of spawnZones) {
      const d = Math.abs(x - sz);
      if (d < minD) { minD = d; closest = sz; }
    }
    if (minD < 16) {
      const blend = 1.0 - (minD / 16.0) ** 2;
      h = h * (1.0 - blend * 0.7) + raw[closest] * (blend * 0.7);
    }
    tops[x] = Math.round(clamp(h, 80, H - 30));
  }
  return tops;
}

// Caldera: two volcanic cones around a wide sunken bowl.
function shapeCaldera(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28);
  const cone1X = 340 + rand(-20, 20);
  const cone2X = 940 + rand(-20, 20);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    const d1 = Math.abs(x - cone1X);
    const d2 = Math.abs(x - cone2X);
    const cone1 = Math.exp(-((d1 / 140) ** 2)) * 55 * amp;
    const cone2 = Math.exp(-((d2 / 140) ** 2)) * 55 * amp;
    const bowlD = Math.abs(x - (cone1X + cone2X) / 2);
    const bowl = Math.exp(-((bowlD / 200) ** 2)) * 20 * amp;
    const rough = Math.sin(x * 0.03 + p1) * 3 * amp;
    tops[x] = Math.round(clamp(base - (cone1 + cone2) + bowl + rough, 80, H - 30));
  }
  return tops;
}

// Craters: gentle rolling plain pocked with round impact craters.
function shapeCraters(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28);
  const centers = [180 + rand(-20, 20), 420 + rand(-20, 20), 680 + rand(-20, 20), 920 + rand(-20, 20), 1140 + rand(-20, 20)];
  const radii = centers.map(() => rand(45, 65));
  const depths = centers.map(() => rand(18, 28) * amp);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    let h = base + Math.sin(x * 0.005 + p1) * 6 * amp;
    for (let i = 0; i < centers.length; i++) {
      const dist = Math.abs(x - centers[i]);
      const r = radii[i];
      if (dist < r) {
        const u = dist / r;
        const bowl = (1 - u * u) * depths[i];
        const rim = Math.exp(-(((dist - r) / 8) ** 2)) * 6 * amp;
        h += bowl - rim;
      }
    }
    tops[x] = Math.round(clamp(h, 80, H - 30));
  }
  return tops;
}

// Plateaus: flat-topped stepped terraces joined by short ramps.
function shapePlateaus(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28);
  const levels = [-20 * amp, 15 * amp, -10 * amp, 25 * amp, -5 * amp];
  const edges = [255, 535, 775, 1035];
  const rw = 20;  // half ramp width
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    let h = base;
    if (x < edges[0] - rw) {
      h += levels[0];
    } else if (x < edges[0] + rw) {
      const u = (x - (edges[0] - rw)) / (2 * rw);
      h += levels[0] + (levels[1] - levels[0]) * (u * u * (3 - 2 * u));
    } else if (x < edges[1] - rw) {
      h += levels[1];
    } else if (x < edges[1] + rw) {
      const u = (x - (edges[1] - rw)) / (2 * rw);
      h += levels[1] + (levels[2] - levels[1]) * (u * u * (3 - 2 * u));
    } else if (x < edges[2] - rw) {
      h += levels[2];
    } else if (x < edges[2] + rw) {
      const u = (x - (edges[2] - rw)) / (2 * rw);
      h += levels[2] + (levels[3] - levels[2]) * (u * u * (3 - 2 * u));
    } else if (x < edges[3] - rw) {
      h += levels[3];
    } else if (x < edges[3] + rw) {
      const u = (x - (edges[3] - rw)) / (2 * rw);
      h += levels[3] + (levels[4] - levels[3]) * (u * u * (3 - 2 * u));
    } else {
      h += levels[4];
    }
    const grit = Math.sin(x * 0.05 + p1) * 1.5;
    tops[x] = Math.round(clamp(h + grit, 80, H - 30));
  }
  return tops;
}

// Flat: low, almost level wetland ground with soft bumps.
function shapeFlat(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    const h = base + Math.sin(x * 0.006 + p1) * 8 * amp + Math.sin(x * 0.02 + p2) * 3 * amp;
    tops[x] = Math.round(clamp(h, 80, H - 30));
  }
  return tops;
}

// Canyon: high mesas on both sides with a deep central gulch in the middle third.
function shapeCanyon(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28), p3 = rand(0, 6.28);
  const floorY = clamp(base + 95 * amp, base + 50, H - 45);
  const mesaL = base;
  const mesaR = base + rand(-10, 10) * amp;
  const wallL0 = 380, wallL1 = 450;
  const wallR0 = 830, wallR1 = 900;
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    let h: number;
    if (x < wallL0) {
      h = mesaL + Math.sin(x * 0.015 + p1) * 4 * amp;
    } else if (x < wallL1) {
      const u = (x - wallL0) / (wallL1 - wallL0);
      h = mesaL + (floorY - mesaL) * (u * u * (3 - 2 * u));
    } else if (x < wallR0) {
      h = floorY + Math.sin(x * 0.01 + p2) * 5 * amp;
    } else if (x < wallR1) {
      const u = (x - wallR0) / (wallR1 - wallR0);
      h = floorY + (mesaR - floorY) * (u * u * (3 - 2 * u));
    } else {
      h = mesaR + Math.sin(x * 0.015 + p3) * 4 * amp;
    }
    tops[x] = Math.round(clamp(h, 80, H - 30));
  }
  return tops;
}

// Valley: a low basin floor leaving ample open sky for floating islands.
function shapeValley(base: number, amp: number): number[] {
  const p1 = rand(0, 6.28);
  const tops: number[] = [];
  for (let x = 0; x < W; x++) {
    const u = (x - W / 2) / (W / 2);
    const dip = (1 - u * u) * 15 * amp;
    const ripple = Math.sin(x * 0.008 + p1) * 5 * amp;
    tops[x] = Math.round(clamp(base + dip + ripple, 80, H - 30));
  }
  return tops;
}

export function generateTerrain(arena: Arena) {
  activeArenaMaterials = getArenaMaterials(arena);

  const base = rand(H * arena.ground.base[0], H * arena.ground.base[1]);
  const amp = arena.ground.amp;

  let tops: number[];
  switch (arena.ground.shape) {
    case 'dunes':    tops = shapeDunes(base, amp); break;
    case 'peaks':    tops = shapePeaks(base, amp); break;
    case 'caldera':  tops = shapeCaldera(base, amp); break;
    case 'craters':  tops = shapeCraters(base, amp); break;
    case 'plateaus': tops = shapePlateaus(base, amp); break;
    case 'flat':     tops = shapeFlat(base, amp); break;
    case 'canyon':   tops = shapeCanyon(base, amp); break;
    case 'valley':   tops = shapeValley(base, amp); break;
    case 'rolling':
    default:         tops = shapeRolling(base, amp); break;
  }

  for (let x = 0; x < W; x++) {
    fillColumn(x, tops[x]);
  }

  // Buried rocks (count scaled by arena.palette.pockets, using arena's rock materials).
  const pocketCount = Math.round(30 * (W / VW) * arena.palette.pockets);
  for (let n = pocketCount; n > 0; n--) {
    const cx = randInt(0, W - 1), cy = tops[cx] + randInt(15, 120), r = rand(2, 5);
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= W || y >= H || Math.hypot(dx, dy * 1.4) > r) continue;
        if (terrain[y * W + x]) terrain[y * W + x] = dy > 0 ? activeArenaMaterials.rockDark : activeArenaMaterials.rock;
      }
    }
  }

  // Surface tufts poking up from the ground (when deco is non-null).
  if (arena.palette.deco && activeArenaMaterials.tuft && activeArenaMaterials.tuftTip) {
    for (let x = 0; x < W; x++) {
      if (Math.random() > arena.palette.decoChance) continue;
      const h = randInt(1, 3);
      for (let k = 1; k <= h; k++) {
        const y = tops[x] - k;
        if (y >= 0) terrain[y * W + x] = k === h ? activeArenaMaterials.tuftTip : activeArenaMaterials.tuft;
      }
    }
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
