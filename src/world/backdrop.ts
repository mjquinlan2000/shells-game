import { H, VW, W } from '../config';
import { bayer, mix, packColor } from '../util/color';
import { clamp, rand, randInt } from '../util/math';
import type { Arena } from './arenas';

// --- Backdrop ---
// The sky, stars and moon are fixed to the screen. Two layers of distant
// hills scroll slower than the battlefield (parallax), which sells depth.
// All are built once per match into pixel arrays, then copied every frame.

export interface Layer {
  f: number;
  w: number;
  data: Uint32Array;
  top: number;
}

export interface Twinkle {
  i: number;
  phase: number;
  speed: number;
}

export let STAR_BRIGHT = packColor('#fff6e0');
export let STAR_DIM = packColor('#8f88c0');
export const sky = new Uint32Array(VW * H);
export let twinkles: Twinkle[] = [];

// A parallax layer moves `f` pixels per pixel the camera moves.
export function makeLayer(f: number): Layer {
  const w = VW + Math.ceil((W - VW) * f);
  return { f, w, data: new Uint32Array(w * H), top: H };
}
export const farHills = makeLayer(0.25);
export const nearHills = makeLayer(0.55);

export function buildBackdrop(arena: Arena) {
  const bands = arena.sky.map(packColor);
  for (let y = 0; y < H; y++) {
    const t = clamp(y / (H * 0.72), 0, 1) * (bands.length - 1);
    const i = Math.floor(t);
    for (let x = 0; x < VW; x++) {
      sky[y * VW + x] = t - i > bayer(x, y) ? bands[Math.min(i + 1, bands.length - 1)] : bands[i];
    }
  }

  // Stars: most static, some twinkle (animated in composeFrame).
  STAR_BRIGHT = packColor(arena.starColors[0]);
  STAR_DIM = packColor(arena.starColors[1]);
  twinkles = [];
  for (let n = 0; n < arena.stars; n++) {
    const x = randInt(0, VW - 1), y = randInt(19, Math.floor(H * 0.5));
    const i = y * VW + x;
    if (Math.random() < 0.12) {
      twinkles.push({ i, phase: rand(0, 6.28), speed: rand(0.03, 0.09) });
    } else {
      sky[i] = Math.random() < 0.25 ? STAR_BRIGHT : STAR_DIM;
    }
  }

  // Safe pixel plot within sky buffer bounds (VW x H)
  function setSkyPixel(px: number, py: number, color: number) {
    if (px >= 0 && px < VW && py >= 0 && py < H) {
      sky[py * VW + px] = color;
    }
  }

  // Moon helper: shaded disc with craters, scaled by radius
  function drawMoon(cx: number, cy: number, r: number, colors: [string, string, string]) {
    const [lit, shade, detail] = colors;
    // Crater positions scaled by radius (exact match for r=20 VALE: [-7, -5, 4], [5, 3, 5], [-3, 8, 3], [8, -8, 2])
    const craters: [number, number, number][] = [
      [Math.round(-0.35 * r), Math.round(-0.25 * r), Math.max(1, Math.round(0.2 * r))],
      [Math.round(0.25 * r), Math.round(0.15 * r), Math.max(1, Math.round(0.25 * r))],
      [Math.round(-0.15 * r), Math.round(0.4 * r), Math.max(1, Math.round(0.15 * r))],
      [Math.round(0.4 * r), Math.round(-0.4 * r), Math.max(1, Math.round(0.1 * r))],
    ];
    const edgeColor = arena.id === 'VALE' ? '#b8ad95' : mix(detail, '#000000', 0.15);
    const edgePack = packColor(edgeColor);
    const litPack = packColor(lit);
    const shadePack = packColor(shade);
    const detailPack = packColor(detail);

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        let c = (dx + dy) / (2 * r) > 0.3 ? shadePack : litPack;
        for (const [ccx, ccy, ccr] of craters) {
          if (Math.hypot(dx - ccx, dy - ccy) < ccr) c = detailPack;
        }
        if (d > r - 1.2 && bayer(dx, dy) > 0.5) c = edgePack;
        setSkyPixel(cx + dx, cy + dy, c);
      }
    }
  }

  // Sun: flat bright disc with dithered detail halo ring
  function drawSun(cx: number, cy: number, r: number, colors: [string, string, string]) {
    const [lit, shade, detail] = colors;
    const litPack = packColor(lit);
    const shadePack = packColor(shade);
    const detailPack = packColor(detail);
    const haloR = r + Math.max(4, Math.round(r * 0.4));

    for (let dy = -haloR; dy <= haloR; dy++) {
      for (let dx = -haloR; dx <= haloR; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > haloR) continue;
        const px = cx + dx, py = cy + dy;
        if (d <= r) {
          const c = (d > r - 1.2 && bayer(px, py) > 0.5) ? shadePack : litPack;
          setSkyPixel(px, py, c);
        } else {
          const t = (d - r) / (haloR - r);
          if (bayer(px, py) > t) {
            setSkyPixel(px, py, detailPack);
          }
        }
      }
    }
  }

  // Planet: ocean sphere with green land blobs
  function drawPlanet(cx: number, cy: number, r: number, colors: [string, string, string]) {
    const [lit, shade, detail] = colors;
    const litPack = packColor(lit);
    const shadePack = packColor(shade);
    const detailPack = packColor(detail);
    const darkEdge = packColor(mix(shade, '#000000', 0.25));

    const continents: [number, number, number][] = [
      [Math.round(-0.25 * r), Math.round(-0.2 * r), Math.round(0.38 * r)],
      [Math.round(-0.05 * r), Math.round(-0.1 * r), Math.round(0.3 * r)],
      [Math.round(0.25 * r), Math.round(0.2 * r), Math.round(0.36 * r)],
      [Math.round(0.35 * r), Math.round(0.05 * r), Math.round(0.25 * r)],
      [Math.round(-0.2 * r), Math.round(0.35 * r), Math.round(0.28 * r)],
      [Math.round(0.08 * r), Math.round(-0.35 * r), Math.round(0.2 * r)],
    ];

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const px = cx + dx, py = cy + dy;
        let isLand = false;
        for (const [lx, ly, lr] of continents) {
          if (Math.hypot(dx - lx, dy - ly) < lr) {
            isLand = true;
            break;
          }
        }
        let c = isLand ? detailPack : ((dx + dy) / (2 * r) > 0.25 ? shadePack : litPack);
        if (d > r - 1.2 && bayer(px, py) > 0.5) c = darkEdge;
        setSkyPixel(px, py, c);
      }
    }
  }

  // Twin: two moons, r and ~0.6r, offset
  function drawTwin(cx: number, cy: number, r: number, colors: [string, string, string]) {
    const r2 = Math.max(6, Math.round(r * 0.6));
    const ox = Math.round(r * 1.4);
    const oy = Math.round(r * 0.6);
    drawMoon(cx + ox, cy + oy, r2, colors);
    drawMoon(cx, cy, r, colors);
  }

  // Sky body dispatch
  const b = arena.body;
  if (b.kind === 'moon') {
    drawMoon(b.x, b.y, b.r, b.colors);
  } else if (b.kind === 'sun') {
    drawSun(b.x, b.y, b.r, b.colors);
  } else if (b.kind === 'planet') {
    drawPlanet(b.x, b.y, b.r, b.colors);
  } else if (b.kind === 'twin') {
    drawTwin(b.x, b.y, b.r, b.colors);
  }

  // Far mountains / hills by shape
  const p = Array.from({ length: 4 }, () => rand(0, 6.28));
  const farTop = packColor(arena.farHills.colors[0]);
  const far = packColor(arena.farHills.colors[1]);
  farHills.data.fill(0);
  farHills.top = H;

  for (let x = 0; x < farHills.w; x++) {
    let ridge: number;
    switch (arena.farHills.shape) {
      case 'jagged':
        ridge = Math.max(0, Math.round(H * 0.5 - Math.abs(Math.sin(x * 0.011 + p[0])) * 44 - Math.abs(Math.sin(x * 0.027 + p[1])) * 18));
        break;
      case 'mesa': {
        const v = Math.sin(x * 0.008 + p[0]) + 0.35 * Math.sin(x * 0.02 + p[1]);
        const plateau = Math.max(-0.4, Math.min(0.6, v * 2.5));
        const tilt = Math.sin(x * 0.002 + p[2]) * 8;
        ridge = Math.max(0, Math.round(H * 0.48 - plateau * 42 + tilt));
        break;
      }
      case 'dunes': {
        const wave = Math.sin(x * 0.006 + p[0]) * 30 + Math.sin(x * 0.014 + p[1]) * 12;
        ridge = Math.max(0, Math.round(H * 0.48 - wave));
        break;
      }
      case 'spires': {
        const s1 = Math.max(0, 1.0 - Math.abs(Math.sin(x * 0.03 + p[0])) * 3.5);
        const s2 = Math.max(0, 1.0 - Math.abs(Math.sin(x * 0.015 + p[1])) * 3.0);
        const sp = s1 * 55 + s2 * 40;
        const base = Math.sin(x * 0.005 + p[2]) * 8;
        ridge = Math.max(0, Math.round(H * 0.52 - sp - base));
        break;
      }
      case 'domes': {
        const d1 = Math.max(0, Math.sin(x * 0.011 + p[0]));
        const d2 = Math.max(0, Math.sin(x * 0.022 + p[1]));
        const dome = Math.sqrt(d1) * 36 + Math.sqrt(d2) * 18;
        const base = Math.sin(x * 0.005 + p[2]) * 6;
        ridge = Math.max(0, Math.round(H * 0.5 - dome - base));
        break;
      }
    }
    farRidge[x] = ridge;
    farHills.top = Math.min(farHills.top, ridge);
    for (let y = ridge; y < H; y++) {
      farHills.data[y * farHills.w + x] = y < ridge + 2 ? farTop : far;
    }
  }

  // Nearer hills with props
  const nearColor = packColor(arena.nearHills.color);
  const nearRidge: number[] = [];
  nearHills.data.fill(0);
  nearHills.top = H;

  for (let x = 0; x < nearHills.w; x++) {
    nearRidge[x] = Math.round(H * 0.6 + Math.sin(x * 0.009 + p[2]) * 16 + Math.sin(x * 0.031 + p[3]) * 6);
    nearHills.top = Math.min(nearHills.top, nearRidge[x]);
    for (let y = nearRidge[x]; y < H; y++) {
      nearHills.data[y * nearHills.w + x] = nearColor;
    }
  }

  const propCount = Math.round(45 * nearHills.w / VW);

  function setNearPixel(x: number, y: number) {
    if (x >= 0 && x < nearHills.w && y >= 0 && y < H) {
      nearHills.data[y * nearHills.w + x] = nearColor;
      if (y < nearHills.top) nearHills.top = y;
    }
  }

  if (arena.nearHills.props === 'pine') {
    for (let n = propCount; n > 0; n--) {
      const tx = randInt(4, nearHills.w - 5), base = nearRidge[tx] + 2, h = randInt(8, 18);
      nearHills.top = Math.min(nearHills.top, base - h);
      for (let k = 0; k <= h; k++) {
        const half = Math.floor(k * 0.32) - (k % 4 === 3 ? 1 : 0);
        for (let dx = -half; dx <= half; dx++) {
          const x = tx + dx, y = base - h + k;
          if (x >= 0 && x < nearHills.w && y >= 0 && y < H) nearHills.data[y * nearHills.w + x] = nearColor;
        }
      }
    }
  } else if (arena.nearHills.props === 'cactus') {
    for (let n = propCount; n > 0; n--) {
      const tx = randInt(5, nearHills.w - 6), base = nearRidge[tx] + 1;
      const h = randInt(10, 18);
      for (let dy = 0; dy <= h; dy++) {
        setNearPixel(tx, base - dy);
        setNearPixel(tx + 1, base - dy);
      }
      if (Math.random() < 0.85) {
        const armY = base - Math.round(h * 0.45);
        const len = randInt(2, 3);
        const up = randInt(3, 5);
        for (let dx = 1; dx <= len; dx++) setNearPixel(tx - dx, armY);
        for (let dy = 0; dy <= up; dy++) setNearPixel(tx - len, armY - dy);
      }
      if (Math.random() < 0.85) {
        const armY = base - Math.round(h * 0.6);
        const len = randInt(2, 3);
        const up = randInt(3, 5);
        for (let dx = 1; dx <= len; dx++) setNearPixel(tx + 1 + dx, armY);
        for (let dy = 0; dy <= up; dy++) setNearPixel(tx + 1 + len, armY - dy);
      }
    }
  } else if (arena.nearHills.props === 'dead') {
    for (let n = propCount; n > 0; n--) {
      const tx = randInt(5, nearHills.w - 6), base = nearRidge[tx] + 1;
      const h = randInt(10, 19);
      const splitY = base - Math.round(h * 0.45);
      for (let y = base; y >= splitY; y--) {
        setNearPixel(tx, y);
        if (h > 13) setNearPixel(tx + 1, y);
      }
      let lx = tx, ly = splitY;
      const len1 = randInt(5, 9);
      for (let k = 0; k < len1; k++) {
        ly--;
        if (k % 2 === 0) lx--;
        setNearPixel(lx, ly);
      }
      let rx = tx + (h > 13 ? 1 : 0), ry = splitY;
      const len2 = randInt(5, 9);
      for (let k = 0; k < len2; k++) {
        ry--;
        if (k % 2 === 0) rx++;
        setNearPixel(rx, ry);
      }
      if (Math.random() < 0.5) {
        let cx = tx, cy = splitY;
        const len3 = randInt(3, 6);
        for (let k = 0; k < len3; k++) {
          cy--;
          if (k % 3 === 0) cx += Math.random() < 0.5 ? 1 : -1;
          setNearPixel(cx, cy);
        }
      }
    }
  } else if (arena.nearHills.props === 'crystal') {
    for (let n = propCount; n > 0; n--) {
      const tx = randInt(5, nearHills.w - 6), base = nearRidge[tx] + 1;
      const h = randInt(8, 20);
      const w = randInt(3, 6);
      const tilt = rand(-0.35, 0.35);
      for (let k = 0; k <= h; k++) {
        const half = Math.max(0, Math.floor((k / h) * (w / 2)));
        const shift = Math.round((h - k) * tilt);
        for (let dx = -half; dx <= half; dx++) {
          setNearPixel(tx + shift + dx, base - h + k);
        }
      }
    }
  } else if (arena.nearHills.props === 'stacks') {
    for (let n = propCount; n > 0; n--) {
      const tx = randInt(6, nearHills.w - 7), base = nearRidge[tx] + 1;
      const h = randInt(10, 22);
      const w = randInt(3, 7);
      const halfW = Math.floor(w / 2);
      for (let dy = 0; dy <= h; dy++) {
        const y = base - dy;
        const extra = dy >= h - 1 ? 1 : 0;
        for (let dx = -halfW - extra; dx <= halfW + extra; dx++) {
          setNearPixel(tx + dx, y);
        }
      }
    }
  } else if (arena.nearHills.props === 'coral') {
    for (let n = propCount; n > 0; n--) {
      const tx = randInt(6, nearHills.w - 7), base = nearRidge[tx] + 1;
      const h = randInt(9, 17);
      for (let dy = 0; dy <= 3; dy++) {
        setNearPixel(tx, base - dy);
        setNearPixel(tx + 1, base - dy);
      }
      const numFingers = randInt(3, 4);
      for (let f = 0; f < numFingers; f++) {
        const angle = -0.5 + (f / (numFingers - 1)) * 1.0 + rand(-0.1, 0.1);
        const len = randInt(h - 4, h);
        let fx = tx + (f > numFingers / 2 ? 1 : 0);
        let fy = base - 3;
        for (let step = 0; step < len; step++) {
          fy--;
          if (step % 2 === 0) fx += angle < 0 ? -1 : 1;
          setNearPixel(fx, fy);
        }
        setNearPixel(fx - 1, fy);
        setNearPixel(fx + 1, fy);
        setNearPixel(fx, fy - 1);
      }
    }
  }
}

export const farRidge: number[] = [];       // the far mountains' ridge line, set by buildBackdrop
