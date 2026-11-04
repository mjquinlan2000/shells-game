import { H, VW, W } from '../config';
import { rand, randInt } from '../util/math';
import type { Arena } from './arenas';
import { T, getArenaMaterials, setPixel, surfaceY, type ArenaMaterials } from './terrain';

// --- Obstacles: boulders, monoliths, floating islands ---
// Obstacle frequency, surface moss, island roots/vines, and island rock materials
// are configured by the active Arena's obstacles and palette settings.

export interface Monolith {
  x: number;
  y: number;
  phase: number;
}

export interface ObstacleClearance {
  x: number;
  r: number;
}

export let monoliths: Monolith[] = [];  // remembered for their rune glow

// Places obstacles, keeping clear of the tanks' start positions.
export function placeObstacles(spawns: number[], arena: Arena) {
  monoliths = [];
  const ground: ObstacleClearance[] = spawns.map(x => ({ x, r: 30 }));
  const sky: ObstacleClearance[] = spawns.map(x => ({ x, r: 34 }));
  const place = (taken: ObstacleClearance[], r: number, build: (x: number) => boolean | void) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = randInt(r + 4, W - r - 5);
      if (taken.some(t => Math.abs(t.x - x) < t.r + r)) continue;
      if (build(x) === false) continue;
      taken.push({ x, r });
      return;
    }
  };
  const screens = W / VW;  // obstacle counts are per screen-width of map

  const [bMin, bMax] = arena.obstacles.boulders;
  for (let n = randInt(bMin, bMax) * screens; n > 0; n--) {
    const rx = randInt(7, 13);
    place(ground, rx + 4, x => makeBoulder(x, rx, randInt(6, 10), arena.palette.moss));
  }

  const [mMin, mMax] = arena.obstacles.monoliths;
  for (let n = randInt(mMin, mMax) * screens; n > 0; n--) place(ground, 10, makeMonolith);

  const [iMin, iMax] = arena.obstacles.islands;
  const mats = getArenaMaterials(arena);
  for (let n = randInt(iMin, iMax) * screens; n > 0; n--) {
    const hw = randInt(20, 45);
    place(sky, hw + 6, x => makeIsland(x, hw, mats, arena.palette.vines));
  }
}

export function makeBoulder(cx: number, rx: number, ry: number, moss: boolean) {
  const cy = surfaceY(cx) - ry + 3;  // sunk a little into the ground
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28);
  // A lumpy ellipse: the radius wobbles with the angle.
  const inside = (dx: number, dy: number) => {
    const a = Math.atan2(dy / ry, dx / rx);
    const wobble = 1 + 0.12 * Math.sin(a * 3 + p1) + 0.06 * Math.sin(a * 5 + p2);
    return (dx / rx) ** 2 + (dy / ry) ** 2 <= wobble * wobble;
  };
  for (let dy = -ry - 2; dy <= ry + 2; dy++) {
    for (let dx = -rx - 2; dx <= rx + 2; dx++) {
      if (!inside(dx, dy)) continue;
      // Lit from the top-left, with a little noise; moss grows on top.
      const shade = (dx / rx) * 0.6 + (dy / ry) * 0.8 + rand(-0.15, 0.15);
      let m = shade < -0.45 ? T.BOULDER_HI : shade > 0.35 ? T.BOULDER_LO : T.BOULDER;
      if (moss && !inside(dx, dy - 1) && dy < -ry * 0.3 && Math.random() < 0.6) m = T.MOSS;
      setPixel(cx + dx, cy + dy, m);
    }
  }
}

export const RUNE_GLYPHS = ['010111010', '101010101', '111101111', '110011110', '011110011', '111010111'];

export function makeMonolith(cx: number): boolean | void {
  const w = randInt(4, 6), h = randInt(26, 42);
  let base = 0;
  for (let dx = -w; dx <= w; dx++) base = Math.max(base, surfaceY(cx + dx));
  base += 4;  // planted into the ground
  const top = base - h;
  if (top < 47) return false;  // keep tall rocks out of the top of the sky
  for (let y = top; y <= base; y++) {
    const fromTop = y - top;
    const half = w - (fromTop < 3 ? 3 - fromTop : 0);  // bevelled top
    for (let dx = -half; dx <= half; dx++) {
      let m = dx === -half ? T.STONE_HI : dx === half ? T.STONE_LO : T.STONE;
      if (m === T.STONE && Math.random() < 0.08) m = T.STONE_LO;
      setPixel(cx + dx, y, m);
    }
  }
  // A column of runes down the middle.
  for (let ry = top + 6; ry + 3 < base - 6; ry += 7) {
    const glyph = RUNE_GLYPHS[randInt(0, RUNE_GLYPHS.length - 1)];
    for (let k = 0; k < 9; k++) if (glyph[k] === '1') setPixel(cx - 1 + (k % 3), ry + Math.floor(k / 3), T.RUNE);
  }
  monoliths.push({ x: cx, y: (top + base) / 2, phase: rand(0, 6.28) });
}

export function makeIsland(cx: number, hw: number, mats: ArenaMaterials, vines: boolean): boolean | void {
  // Float well clear of the ground below.
  let highest = H;
  for (let x = cx - hw; x <= cx + hw; x++) highest = Math.min(highest, surfaceY(x));
  const depth = Math.round(hw * 0.6);
  const lowestTop = highest - 30 - depth;
  if (lowestTop < 57) return false;  // islands float below the minimap and roster
  const ty = randInt(57, lowestTop);
  for (let x = cx - hw; x <= cx + hw; x++) {
    const u = (x - cx) / hw;
    const topY = ty + Math.round(u * u * 3 + rand(0, 1));
    const d = Math.round((1 - u * u) ** 0.7 * depth * rand(0.85, 1.1)) + 2;
    for (let y = topY; y <= topY + d; y++) {
      const k = y - topY;
      const m = k < 2 ? (Math.random() < 0.3 ? mats.isleTopDark : mats.isleTop)
        : k < d * 0.45 ? (Math.random() < 0.3 ? mats.isleSoilDark : mats.isleSoil)
          : mats.isleRock;
      setPixel(x, y, m);
    }
    // Tufts poking up from the island surface (skip if arena has none).
    if (mats.tuft && mats.tuftTip && Math.random() < 0.3) {
      setPixel(x, topY - 1, Math.random() < 0.5 ? mats.tuftTip : mats.tuft);
    }
    // Roots and vines dangling underneath (only when arena has vines).
    if (vines && Math.random() < 0.25) {
      const len = randInt(2, 9), vine = Math.random() < 0.5;
      for (let k = 1; k <= len; k++) {
        setPixel(x, topY + d + k, vine ? (k === len ? T.VINE_TIP : T.VINE) : T.ROOT);
      }
    }
  }
}
