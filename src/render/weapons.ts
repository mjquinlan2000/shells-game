import { activeBeam, activeMushroomClouds, activePlane, activeShockwaves, type MushroomCloud, pendingStrike } from '../combat/weapons';
import { ctx } from '../gfx/canvas';
import { fillCircle, fillRing, pixelLine } from '../gfx/draw';
import { bayer, mix } from '../util/color';
import { surfaceY } from '../world/terrain';
// --- Weapons World-Space Rendering ---
// Caller has already translated ctx by -camX. Integer coordinates only.

// 24x8 pixel bomber sprite (facing right)
// r = red accent, h = highlight, b = fuselage, c = cockpit, d = shadow
const BOMBER_ROWS = [
  '........hhhh............',
  '......hhhhhhhh..........',
  '...hhhhhhhhhhhhhh.......',
  'rrrrhbbbbccccbbbbddddd..',
  'rrrrhbbbbbbbbbbbbddddd..',
  '...dddddddddddddd.......',
  '......dddddddd..........',
  '........dddd............',
];

const BOMBER_PALETTE: Record<string, string> = {
  r: '#ff3b5c',
  h: '#7d7590',
  b: '#4a4252',
  c: '#8fd3ff',
  d: '#262230',
};


interface CapLobe {
  dx: number;
  dy: number;
  r: number;
  vortex: -1 | 0 | 1; // -1: left vortex roll, 1: right vortex roll, 0: central turbulence
  phase: number;
}

// Lobes for the massive mushroom cap (~140px wide: ±68px span)
// Multi-pass toroidal vortex rolling cloud
const CAP_DARK_LOBES: CapLobe[] = [
  // Bottom rim under-curls (toroidal underside curling inward)
  { dx: -16, dy: 10, r: 12, vortex: 0, phase: 0.1 },
  { dx: 16, dy: 10, r: 12, vortex: 0, phase: 0.3 },
  { dx: 0, dy: 9, r: 14, vortex: 0, phase: 0.5 },
  { dx: -32, dy: 9, r: 13, vortex: -1, phase: 0.7 },
  { dx: 32, dy: 9, r: 13, vortex: 1, phase: 0.9 },
  { dx: -48, dy: 7, r: 13, vortex: -1, phase: 1.2 },
  { dx: 48, dy: 7, r: 13, vortex: 1, phase: 1.4 },
  { dx: -60, dy: 4, r: 11, vortex: -1, phase: 1.6 },
  { dx: 60, dy: 4, r: 11, vortex: 1, phase: 1.8 },
  // Shoulders (widest billows: span ±68px)
  { dx: -68, dy: -6, r: 13, vortex: -1, phase: 2.1 },
  { dx: 68, dy: -6, r: 13, vortex: 1, phase: 2.3 },
  { dx: -62, dy: -15, r: 15, vortex: -1, phase: 2.5 },
  { dx: 62, dy: -15, r: 15, vortex: 1, phase: 2.7 },
  { dx: -48, dy: -22, r: 16, vortex: -1, phase: 3.0 },
  { dx: 48, dy: -22, r: 16, vortex: 1, phase: 3.2 },
  // Crown rim
  { dx: -32, dy: -28, r: 17, vortex: 0, phase: 3.5 },
  { dx: 32, dy: -28, r: 17, vortex: 0, phase: 3.7 },
  { dx: -16, dy: -32, r: 18, vortex: 0, phase: 4.0 },
  { dx: 16, dy: -32, r: 18, vortex: 0, phase: 4.2 },
  { dx: 0, dy: -34, r: 19, vortex: 0, phase: 4.5 },
  { dx: 0, dy: -20, r: 18, vortex: 0, phase: 4.8 },
];

const CAP_MID_LOBES: CapLobe[] = [
  { dx: -54, dy: -8, r: 12, vortex: -1, phase: 0.2 },
  { dx: 54, dy: -8, r: 12, vortex: 1, phase: 0.4 },
  { dx: -42, dy: -16, r: 14, vortex: -1, phase: 0.6 },
  { dx: 42, dy: -16, r: 14, vortex: 1, phase: 0.8 },
  { dx: -28, dy: -24, r: 15, vortex: 0, phase: 1.0 },
  { dx: 28, dy: -24, r: 15, vortex: 0, phase: 1.2 },
  { dx: -14, dy: -28, r: 16, vortex: 0, phase: 1.5 },
  { dx: 14, dy: -28, r: 16, vortex: 0, phase: 1.7 },
  { dx: 0, dy: -28, r: 17, vortex: 0, phase: 2.0 },
  { dx: 0, dy: -14, r: 16, vortex: 0, phase: 2.2 },
  { dx: -24, dy: -4, r: 13, vortex: 0, phase: 2.4 },
  { dx: 24, dy: -4, r: 13, vortex: 0, phase: 2.6 },
  { dx: 0, dy: 4, r: 13, vortex: 0, phase: 2.8 },
  { dx: -18, dy: 6, r: 10, vortex: 0, phase: 3.0 },
  { dx: 18, dy: 6, r: 10, vortex: 0, phase: 3.2 },
];

const CAP_HIGH_LOBES: CapLobe[] = [
  { dx: -46, dy: -18, r: 9, vortex: -1, phase: 0.3 },
  { dx: 46, dy: -18, r: 9, vortex: 1, phase: 0.5 },
  { dx: -30, dy: -26, r: 11, vortex: 0, phase: 0.7 },
  { dx: 30, dy: -26, r: 11, vortex: 0, phase: 0.9 },
  { dx: -14, dy: -31, r: 12, vortex: 0, phase: 1.1 },
  { dx: 14, dy: -31, r: 12, vortex: 0, phase: 1.3 },
  { dx: 0, dy: -32, r: 13, vortex: 0, phase: 1.5 },
  { dx: 0, dy: -18, r: 10, vortex: 0, phase: 1.8 },
];

function getLobePos(lobe: CapLobe, capX: number, capY: number, age: number): { x: number; y: number; r: number } {
  let lx = lobe.dx;
  let ly = lobe.dy;
  if (lobe.vortex === -1) {
    const ang = lobe.phase + age * 0.04;
    lx += Math.round(Math.cos(ang) * 2.5);
    ly += Math.round(Math.sin(ang) * 2);
  } else if (lobe.vortex === 1) {
    const ang = lobe.phase + age * 0.04;
    lx += Math.round(-Math.cos(ang) * 2.5);
    ly += Math.round(Math.sin(ang) * 2);
  } else {
    lx += Math.round(Math.sin(lobe.phase + age * 0.09) * 2);
    ly += Math.round(Math.cos(lobe.phase * 1.3 + age * 0.08) * 1.5);
  }
  const lr = Math.max(3, lobe.r + Math.round(Math.sin(lobe.phase * 2 + age * 0.07) * 1.5));
  return { x: capX + lx, y: capY + ly, r: lr };
}

function drawMushroomCloud(c: MushroomCloud): void {
  // Fade out over last ~100 ticks before life expires at 480 ticks (~8 s)
  const fadeStart = 380;
  const alpha = c.age <= fadeStart ? 1 : Math.max(0, (c.life - c.age) / (c.life - fadeStart));
  if (alpha <= 0) return;

  ctx.globalAlpha = alpha;

  // Rise progression: cap climbs toward ~60-80px from top of world
  const riseT = Math.min(1, Math.max(0, (c.age - 10) / 160));
  const ease = 1 - Math.pow(1 - riseT, 3);
  const maxClimb = Math.max(60, c.y - 70);
  const stemH = Math.round(maxClimb * ease);

  const cx = Math.round(c.x);
  const cy = Math.round(c.y);
  const capX = Math.round(c.x + c.windOffset);
  const capY = Math.round(c.y - stemH);

  // Thermal cooling & darkening progression:
  // - Heat (fire core): 1.0 at detonation down to 0 at tick 220
  // - Darken (smoke body): warm copper/rust shifting to sooty grey/charcoal by tick 280
  const heat = Math.max(0, 1 - c.age / 220);
  const darkenT = Math.min(1, c.age / 280);

  const colDark = mix('#38140a', '#181413', darkenT);
  const colMid = mix('#8e381c', '#3e3532', darkenT);
  const colHigh = mix('#ff882e', '#645852', darkenT);
  const colSkirt = mix('#f5c69a', '#5a504b', darkenT);
  const colSkirtDark = mix('#70361a', '#221c1a', darkenT);
  const colCore = heat > 0.5
    ? mix('#ff7214', '#fff888', (heat - 0.5) * 2)
    : mix('#ab220a', '#ff7214', heat * 2);

  // 1. Ground Zero Fireball Sphere (Detonation phase: ticks 0..38)
  // Swelling fireball sphere at ground zero with Bayer-dithered bands white→yellow→orange→red
  if (c.age < 38) {
    const fbT = c.age / 38;
    const fbEase = Math.sin(fbT * Math.PI * 0.5);
    const fbR = Math.round(10 + 52 * fbEase);
    const fbCenterY = cy - Math.round(fbR * 0.55);

    const COLORS = ['#ffffff', '#fff044', '#ff5e10', '#8b1406'];

    for (let dy = -fbR; dy <= fbR; dy++) {
      const half = Math.floor(Math.sqrt(fbR * fbR - dy * dy));
      const py = fbCenterY + dy;
      let spanColor = '';
      let spanStartX = 0;
      let spanLen = 0;

      for (let dx = -half; dx <= half; dx++) {
        const px = cx + dx;
        const dist = Math.hypot(dx, dy);
        const norm = dist / fbR;
        const b = (bayer(px, py) - 0.5) * 0.12;
        const val = norm + b;

        let colorIdx = 0;
        if (val < 0.26) colorIdx = 0;
        else if (val < 0.50) colorIdx = 1;
        else if (val < 0.76) colorIdx = 2;
        else colorIdx = 3;

        const cHex = COLORS[colorIdx];
        if (cHex === spanColor) {
          spanLen++;
        } else {
          if (spanLen > 0) {
            ctx.fillStyle = spanColor;
            ctx.fillRect(spanStartX, py, spanLen, 1);
          }
          spanColor = cHex;
          spanStartX = px;
          spanLen = 1;
        }
      }
      if (spanLen > 0) {
        ctx.fillStyle = spanColor;
        ctx.fillRect(spanStartX, py, spanLen, 1);
      }
    }
  }

  // 2. Ground-hugging Base Surge rolling outward both ways along the terrain (ticks 6..180)
  if (c.age >= 6 && c.age <= 180) {
    const surgeAlpha = c.age < 85 ? 1 : Math.max(0, 1 - (c.age - 85) / 95);
    ctx.globalAlpha = alpha * surgeAlpha;

    const maxDist = Math.min(160, (c.age - 6) * 2.2);
    const surgeDark = mix('#422016', '#26201e', darkenT);
    const surgeMid = mix('#844426', '#4a3e38', darkenT);
    const surgeHigh = mix('#b56a42', '#685c54', darkenT);

    for (const dir of [-1, 1]) {
      // Leading surge billow
      const headX = Math.round(cx + dir * maxDist);
      const headY = surfaceY(headX);
      const headR = Math.min(14, Math.round(6 + maxDist * 0.05));
      fillCircle(headX, headY - 2, headR, surgeDark);
      fillCircle(headX, headY - 3, Math.max(1, headR - 2), surgeMid);
      fillCircle(headX - dir * 2, headY - 5, Math.max(1, headR - 5), surgeHigh);

      // Rolling trailing puffs along the ground
      const steps = Math.floor(maxDist / 18);
      for (let i = 1; i <= steps; i++) {
        const dist = i * 18;
        const sx = Math.round(cx + dir * dist);
        const sy = surfaceY(sx);
        const roll = Math.round(Math.sin(c.age * 0.15 + i) * 1.5);
        const r = Math.max(5, Math.round(9 - (dist / maxDist) * 3));
        fillCircle(sx, sy - 2 + roll, r, surgeDark);
        fillCircle(sx, sy - 3 + roll, Math.max(1, r - 2), surgeMid);
      }
    }
    ctx.globalAlpha = alpha;
  }

  // 3. Crater base billows (anchors the column to the impact crater)
  if (stemH >= 4) {
    fillCircle(cx, cy + 2, 14, colDark);
    fillCircle(cx - 18, cy + 1, 11, colDark);
    fillCircle(cx + 18, cy + 1, 11, colDark);
    fillCircle(cx - 30, cy + 3, 9, colDark);
    fillCircle(cx + 30, cy + 3, 9, colDark);

    fillCircle(cx, cy + 1, 11, colMid);
    fillCircle(cx - 16, cy, 9, colMid);
    fillCircle(cx + 16, cy, 9, colMid);
    fillCircle(cx - 28, cy + 2, 6, colMid);
    fillCircle(cx + 28, cy + 2, 6, colMid);

    fillCircle(cx - 14, cy - 2, 5, colHigh);
    fillCircle(cx + 14, cy - 2, 5, colHigh);

    if (heat > 0.15) {
      fillCircle(cx, cy - 1, Math.max(1, Math.round(8 * heat)), colCore);
    }
  }

  // 4. Thick rising stem with updraft streaks (width ~28-48px)
  if (stemH >= 8) {
    for (let sy = cy - 2; sy >= capY + 4; sy -= 3) {
      const progress = Math.min(1, Math.max(0, (cy - sy) / stemH));
      const sx = Math.round(c.x + c.windOffset * (progress * progress));
      const wave = Math.round(Math.sin(sy * 0.16 + c.age * 0.1) * 2);

      const baseFlare = progress < 0.28 ? (1 - progress / 0.28) * 11 : 0;
      const topFlare = progress > 0.65 ? ((progress - 0.65) / 0.35) * 8 : 0;
      const r = Math.max(8, Math.round(13 + baseFlare + topFlare));

      fillCircle(sx + wave, sy, r, colDark);
      fillCircle(sx + Math.round(wave * 0.5), sy, Math.max(1, r - 2), colMid);
      if (r >= 9) {
        fillCircle(sx - Math.round(r * 0.32), sy - 1, Math.max(1, r - 5), colHigh);
      }
      if (heat > 0.08) {
        const coreR = Math.max(1, Math.round((r - 4) * heat));
        fillCircle(sx, sy, coreR, colCore);
      }
    }

    // Updraft streaks inside the rising column
    const streakColor = heat > 0.25 ? '#ffb82c' : colHigh;
    for (let streak = -3; streak <= 3; streak++) {
      const streakSpeed = 4.2;
      const streakYOffset = Math.round((c.age * streakSpeed + (streak + 4) * 23) % stemH);
      const sy = cy - streakYOffset;
      if (sy > capY + 10 && sy < cy - 6) {
        const prog = (cy - sy) / stemH;
        const sx = Math.round(c.x + c.windOffset * (prog * prog) + streak * 5);
        pixelLine(sx, sy, sx, sy - 7, streakColor);
      }
    }
  }

  // 5. Condensation (Wilson) Ring flashing around mid-stem / cap (ticks 14..75)
  if (stemH >= 24 && c.age >= 14 && c.age <= 75) {
    const wAge = c.age - 14;
    let wAlpha = 0;
    if (wAge < 10) wAlpha = wAge / 10;
    else if (wAge < 35) wAlpha = 1;
    else wAlpha = 1 - (wAge - 35) / 26;

    if (wAlpha > 0.05) {
      ctx.globalAlpha = alpha * wAlpha;
      const wr = Math.round(24 + wAge * 1.5);
      const ringY = Math.round(cy - stemH * 0.55);
      const ringX = Math.round(c.x + c.windOffset * (0.55 * 0.55));

      for (let dy = -Math.round(wr * 0.22); dy <= Math.round(wr * 0.22); dy++) {
        const half = Math.floor(Math.sqrt(Math.max(0, wr * wr - dy * dy * 16)));
        if (half > 0) {
          ctx.fillStyle = colSkirtDark;
          ctx.fillRect(ringX - half, ringY + dy + 1, half * 2 + 1, 1);
          ctx.fillStyle = colSkirt;
          ctx.fillRect(ringX - half, ringY + dy, half * 2 + 1, 1);
          if (dy < 0) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(ringX - Math.floor(half * 0.7), ringY + dy, Math.floor(half * 1.4) + 1, 1);
          }
        }
      }
      ctx.globalAlpha = alpha;
    }
  }

  // 6. Massive Churning Cap (~140px wide) with Toroidal Underside & Flickering Hot Core
  // Silhouette & Under-curl Pass
  for (const lobe of CAP_DARK_LOBES) {
    const p = getLobePos(lobe, capX, capY, c.age);
    fillCircle(p.x, p.y, p.r, colDark);
  }

  // Midtone Volume Pass
  for (const lobe of CAP_MID_LOBES) {
    const p = getLobePos(lobe, capX, capY, c.age);
    fillCircle(p.x, p.y, p.r, colMid);
  }

  // Upper Highlight Rim Pass
  for (const lobe of CAP_HIGH_LOBES) {
    const p = getLobePos(lobe, capX, capY, c.age);
    fillCircle(p.x, p.y, p.r, colHigh);
  }

  // Glowing Hot Core Pass: flickers inside the throat and interior
  if (heat > 0.06) {
    const flick = 0.85 + 0.15 * Math.sin(c.age * 0.75) + 0.1 * Math.cos(c.age * 1.4);
    const coreR = Math.max(2, Math.round(18 * heat * flick));

    fillCircle(capX, capY - 6, coreR, colCore);
    fillCircle(capX - 16, capY - 2, Math.max(1, Math.round(12 * heat * flick)), colCore);
    fillCircle(capX + 16, capY - 2, Math.max(1, Math.round(12 * heat * flick)), colCore);
    fillCircle(capX, capY + 4, Math.max(1, Math.round(13 * heat * flick)), colCore);
    fillCircle(capX, capY - 18, Math.max(1, Math.round(11 * heat * flick)), colCore);

    if (heat > 0.42) {
      const whiteR = Math.max(1, Math.round(9 * (heat - 0.42) * 1.8));
      fillCircle(capX, capY - 7, whiteR, '#fffde0');
      fillCircle(capX, capY + 3, Math.max(1, whiteR - 2), '#fffde0');
      fillCircle(capX - 8, capY - 3, Math.max(1, whiteR - 3), '#fffde0');
      fillCircle(capX + 8, capY - 3, Math.max(1, whiteR - 3), '#fffde0');
    }
  }

  ctx.globalAlpha = 1;
}
export function drawWeapons(): void {
  // 1. Laser Beam: bright white core with cyan outer edges, fading over ~40 ticks
  if (activeBeam) {
    const alpha = Math.max(0, 1 - activeBeam.age / activeBeam.maxAge);
    ctx.globalAlpha = alpha;

    const x0 = Math.round(activeBeam.x0);
    const y0 = Math.round(activeBeam.y0);
    const x1 = Math.round(activeBeam.x1);
    const y1 = Math.round(activeBeam.y1);

    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const ox = dx > dy ? 0 : 1;
    const oy = dx > dy ? 1 : 0;

    // Cyan glowing edges
    pixelLine(x0 + ox, y0 + oy, x1 + ox, y1 + oy, '#5cf2ff');
    pixelLine(x0 - ox, y0 - oy, x1 - ox, y1 - oy, '#5cf2ff');
    // White hot core
    pixelLine(x0, y0, x1, y1, '#ffffff');

    ctx.globalAlpha = 1;
  }

  // 2. Airstrike marker flare
  if (pendingStrike && pendingStrike.flareLife > 0) {
    fillCircle(
      Math.round(pendingStrike.markerX),
      Math.round(pendingStrike.markerY),
      2,
      Math.random() < 0.5 ? '#ff3b5c' : '#ffffff',
    );
  }

  // 3. Pixel-art bomber plane (~24x8)
  if (activePlane) {
    const px = Math.round(activePlane.x - 12);
    const py = Math.round(activePlane.y - 4);
    const facingRight = activePlane.vx > 0;

    for (let r = 0; r < 8; r++) {
      const row = BOMBER_ROWS[r];
      for (let c = 0; c < 24; c++) {
        const char = facingRight ? row[c] : row[23 - c];
        const color = BOMBER_PALETTE[char];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(px + c, py + r, 1, 1);
        }
      }
    }
  }

  // 4. Expanding staggered shockwave rings
  for (const s of activeShockwaves) {
    if (s.delay > 0) continue;
    const p = s.age / s.life;
    const rad = Math.round(s.radius);
    if (rad <= 2) continue;

    if (s.kind === 'blast') {
      // Primary fast bright shock front: thick intense white ring with glowing outer lip
      ctx.globalAlpha = Math.max(0, (1 - p) * 0.9);
      fillRing(Math.round(s.x), Math.round(s.y), rad, Math.max(0, rad - 3), '#ffffff');
      if (p < 0.45) {
        ctx.globalAlpha = Math.max(0, (0.45 - p) * 1.4);
        fillRing(Math.round(s.x), Math.round(s.y), rad + 1, rad, '#fff6d0');
      }
    } else if (s.kind === 'secondary') {
      // Secondary compression wave: bright golden/cyan ring
      ctx.globalAlpha = Math.max(0, (1 - p) * 0.75);
      fillRing(Math.round(s.x), Math.round(s.y), rad, Math.max(0, rad - 2), '#ffd68a');
    } else {
      // Slower heat-haze ring: warm shimmering amber ring
      ctx.globalAlpha = Math.max(0, (1 - p) * 0.55);
      fillRing(Math.round(s.x), Math.round(s.y), rad, Math.max(0, rad - 1), '#ff7824');
    }
    ctx.globalAlpha = 1;
  }

  // 5. Mushroom clouds (purely decorative, drawn in world space with integer coordinates)
  for (const c of activeMushroomClouds) {
    drawMushroomCloud(c);
  }
}
