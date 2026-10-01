import { sfxDistantBoom } from '../audio';
import { H, HUD_H, VW, W } from '../config';
import { camera } from '../game/camera';
import { game } from '../game/state';
import { framePixels } from '../gfx/canvas';
import { camX } from '../render/render';
import type { Light } from '../render/lights';
import { bayer, packColor } from '../util/color';
import { rand, randInt } from '../util/math';
import { farHills, farRidge } from './backdrop';

// --- Background war: jets, rockets and explosions far off in the distance ---
// Pure decoration. Everything lives in a parallax space like the hills (layer
// x = screen x + camera x * f), so it scrolls slowly and reads as far away.
// It's drawn between the far mountains and the near hills.

export const FAR_F = farHills.f;  // rockets and ground explosions sit on the far mountains
export const JET_F = 0.35;        // jets fly a little closer

export const JET_SPRITE = ['##..........', '####...##...', '############', '....####....'];
export const JET_DARK = packColor('#6a60a0');
export const JET_LIT = packColor('#b8b0e8');
export const NAV_RED = packColor('#ff3b5c');
export const NAV_GREEN = packColor('#3ee06a');
export const CONTRAIL = ['#9a92c8', '#7d74ae', '#615893', '#4a4278'].map(packColor);
export const BG_FIRE = ['#ffffff', '#ffe08a', '#ffa040', '#ff5a3a', '#7a3a4a'].map(packColor);
export const BG_SMOKE = packColor('#3a3352');
export const BG_EXHAUST = packColor('#544c70');

export interface ContrailPoint {
  x: number;
  y: number;
  age: number;
}

export interface BgJet {
  x: number;
  y: number;
  vx: number;
  dir: number;
  trail: ContrailPoint[];
  age: number;
  inside?: boolean;
  gone?: boolean;
}

export interface BgRocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
  life: number;
  age: number;
  done?: boolean;
}

export interface BgBoom {
  x: number;
  y: number;
  f: number;
  r: number;
  age: number;
  life: number;
}

export interface BgPuff {
  x: number;
  y: number;
  f: number;
  vx: number;
  vy: number;
  r: number;
  grow: number;
  life: number;
  max: number;
  color: number;
}

export interface BgSound {
  delay: number;
  size: number;
}

export interface BackgroundWarState {
  jets: BgJet[];
  rockets: BgRocket[];
  booms: BgBoom[];
  puffs: BgPuff[];
  sounds: BgSound[];
  nextJet: number;
  nextRocket: number;
  nextBoom: number;
}

export const bg: BackgroundWarState = { jets: [], rockets: [], booms: [], puffs: [], sounds: [], nextJet: 0, nextRocket: 0, nextBoom: 0 };
export const spaceWidth = (f: number): number => VW + (W - VW) * f;
export const bgScreenX = (x: number, f: number): number => x - camera.x * f;
export const bgVisible = (x: number, f: number, margin = 40): boolean => bgScreenX(x, f) > -margin && bgScreenX(x, f) < VW + margin;

export function resetBackground() {
  bg.jets = [];
  bg.rockets = [];
  bg.booms = [];
  bg.puffs = [];
  bg.sounds = [];
  bg.nextJet = randInt(60, 200);
  bg.nextRocket = randInt(120, 300);
  bg.nextBoom = randInt(40, 150);
}

export function spawnJets() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const count = Math.random() < 0.35 ? randInt(2, 3) : 1;  // sometimes a formation
  const y = randInt(HUD_H + 16, 110), speed = rand(2.2, 3.4);
  const startX = dir > 0 ? -20 : spaceWidth(JET_F) + 20;
  for (let k = 0; k < count; k++) {
    bg.jets.push({ x: startX - dir * k * 16, y: y + k * 5, vx: dir * speed, dir, trail: [], age: 0 });
  }
}

export function spawnRockets() {
  const salvo = Math.random() < 0.45 ? randInt(2, 4) : 1;
  const x = randInt(20, farHills.w - 21), lean = rand(-1, 1);
  for (let k = 0; k < salvo; k++) {
    const rx = x + k * randInt(3, 7);
    bg.rockets.push({
      x: rx, y: farRidge[rx] ?? H / 2, vx: lean + rand(-0.15, 0.15), vy: -rand(2.2, 3),
      delay: k * randInt(10, 25), life: randInt(80, 140), age: 0,
    });
  }
}

export function spawnBoom(x: number, y: number, f: number, r: number, ground: boolean) {
  bg.booms.push({ x, y, f, r, age: 0, life: 30 });
  // A rising column of smoke for ground hits, a few dark puffs for air bursts.
  for (let k = 0; k < (ground ? randInt(6, 10) : randInt(3, 4)); k++) {
    const life = randInt(120, 220);
    bg.puffs.push({
      x: x + rand(-r / 2, r / 2), y: y - (ground ? k * 2 : rand(-2, 2)), f,
      vx: rand(-0.05, 0.05), vy: ground ? -rand(0.08, 0.25) : -rand(0, 0.05),
      r: rand(2, 4), grow: 0.03, life, max: life, color: BG_SMOKE,
    });
  }
  // Sound travels slower than light: the boom arrives a moment after the flash.
  if (bgVisible(x, f)) bg.sounds.push({ delay: randInt(18, 48), size: r });
}

export function updateBackground() {
  if (--bg.nextJet <= 0) {
    spawnJets();
    bg.nextJet = randInt(240, 600);
  }
  if (--bg.nextRocket <= 0) {
    spawnRockets();
    bg.nextRocket = randInt(300, 700);
  }
  if (--bg.nextBoom <= 0) {
    const x = randInt(10, farHills.w - 11);
    spawnBoom(x, farRidge[x], FAR_F, rand(6, 12), true);
    bg.nextBoom = randInt(150, 420);
  }

  for (const j of bg.jets) {
    j.x += j.vx;
    j.age++;
    // Formations start staggered off-screen, so a jet is only done once it has
    // crossed the whole sky (not merely "not inside yet").
    const sky = spaceWidth(JET_F);
    j.inside = j.x > -80 && j.x < sky + 80;
    j.gone = j.dir > 0 ? j.x >= sky + 80 : j.x <= -80;
    if (j.inside) j.trail.push({ x: j.x - j.dir * 7, y: j.y + 2, age: 0 });
    for (const p of j.trail) p.age++;
    j.trail = j.trail.filter(p => p.age < 90);
  }
  bg.jets = bg.jets.filter(j => !j.gone || j.trail.length > 0);

  for (const r of bg.rockets) {
    if (r.delay > 0) {
      if (--r.delay === 0) bg.booms.push({ x: r.x, y: r.y, f: FAR_F, r: 2, age: 0, life: 10 });  // launch flash
      continue;
    }
    r.vy += 0.015;
    r.x += r.vx;
    r.y += r.vy;
    r.age++;
    if (r.age % 2 === 0) {
      const life = randInt(50, 90);
      bg.puffs.push({ x: r.x, y: r.y + 1, f: FAR_F, vx: 0, vy: -0.03, r: 1, grow: 0.025, life, max: life, color: BG_EXHAUST });
    }
    if (r.age >= r.life) {
      r.done = true;
      spawnBoom(r.x, r.y, FAR_F, rand(4, 7), false);
    }
  }
  bg.rockets = bg.rockets.filter(r => !r.done);

  for (const b of bg.booms) b.age++;
  bg.booms = bg.booms.filter(b => b.age < b.life);

  for (const p of bg.puffs) {
    p.x += p.vx + game.wind * 0.008;
    p.y += p.vy;
    p.r += p.grow;
    p.life--;
  }
  bg.puffs = bg.puffs.filter(p => p.life > 0);

  for (const s of bg.sounds) if (--s.delay === 0) sfxDistantBoom(s.size);
  bg.sounds = bg.sounds.filter(s => s.delay > 0);
}

export function bgPixel(lx: number, y: number, f: number, color: number) {
  const x = Math.round(lx - camX * f);
  y = Math.round(y);
  if (x >= 0 && x < VW && y >= 0 && y < H) framePixels[y * VW + x] = color;
}

// A filled circle; `density` below 1 dithers it away for a retro fade.
export function bgDisc(lx: number, cy: number, f: number, r: number, color: number, density = 1) {
  const cx = Math.round(lx - camX * f);
  cy = Math.round(cy);
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 0 || x >= VW || y < 0 || y >= H || bayer(x, y) >= density) continue;
      framePixels[y * VW + x] = color;
    }
  }
}

export function drawBackgroundWar() {
  for (const p of bg.puffs) bgDisc(p.x, p.y, p.f, p.r, p.color, (p.life / p.max) * 0.85);

  for (const j of bg.jets) {
    // Contrail: join consecutive points into a solid line that dithers away with age.
    for (let k = 1; k < j.trail.length; k++) {
      const a = j.trail[k - 1], b = j.trail[k];
      const color = CONTRAIL[Math.min(3, Math.floor(a.age / 22))];
      for (let x = Math.round(Math.min(a.x, b.x)); x <= Math.round(Math.max(a.x, b.x)); x++) {
        if (bayer(x, Math.round(a.y)) < a.age / 90) continue;
        bgPixel(x, a.y, JET_F, color);
      }
    }
    if (!j.inside) continue;
    JET_SPRITE.forEach((row, ry) => {
      for (let c = 0; c < 12; c++) {
        if (row[c] === '.') continue;
        bgPixel(j.x + (j.dir > 0 ? c - 6 : 5 - c), j.y + ry, JET_F, ry === 0 || (ry === 1 && row[c - 1] !== '#') ? JET_LIT : JET_DARK);
      }
    });
    bgPixel(j.x - j.dir * 7, j.y + 2, JET_F, BG_FIRE[1 + (game.ticks & 1)]);  // afterburner
    if (game.ticks % 40 < 4) bgPixel(j.x, j.y + 3, JET_F, game.ticks % 80 < 40 ? NAV_RED : NAV_GREEN);  // blinking nav light
  }

  for (const r of bg.rockets) {
    if (r.delay > 0) continue;
    bgPixel(r.x, r.y, FAR_F, BG_FIRE[0]);
    bgPixel(r.x - r.vx, r.y - r.vy, FAR_F, BG_FIRE[1 + (game.ticks & 1)]);
  }

  for (const b of bg.booms) {
    const p = b.age / b.life;
    const r = b.r * (p < 0.2 ? 0.4 + p * 3 : 1 - (p - 0.2) * 0.6);
    bgDisc(b.x, b.y, b.f, r, BG_FIRE[Math.min(4, Math.floor(p * 5))]);
    if (p < 0.5) bgDisc(b.x, b.y, b.f, r * 0.5, BG_FIRE[Math.floor(p * 2)]);
  }
}

export function backgroundLights(lights: Light[]) {
  for (const j of bg.jets) {
    if (j.inside) lights.push({ x: bgScreenX(j.x - j.dir * 7, JET_F), y: j.y + 2, r: 7, color: '#ffb347', a: 0.5, screen: true });
  }
  for (const r of bg.rockets) {
    if (r.delay <= 0) lights.push({ x: bgScreenX(r.x, FAR_F), y: r.y, r: 12, color: '#ffb347', a: 0.7, screen: true });
  }
  for (const b of bg.booms) {
    const p = b.age / b.life;
    lights.push({ x: bgScreenX(b.x, b.f), y: b.y, r: b.r * 6, color: '#ff8a3a', a: (1 - p) ** 2 * 0.6, screen: true });
    if (p < 0.15) lights.push({ x: bgScreenX(b.x, b.f), y: b.y, r: b.r * 9, color: '#ffffff', a: 0.3, screen: true });
  }
}
