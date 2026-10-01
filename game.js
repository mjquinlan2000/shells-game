'use strict';

// ---------------------------------------------------------------------------
// SHELLS — a turn-based artillery game with a "modern retro" look.
//
// Rendering happens in two layers:
//   1. A 640x360 pixel-art canvas (`pix`). Everything gameplay-related — sky,
//      terrain, tanks, text — is drawn here, one crisp pixel at a time.
//   2. The visible full-window canvas (`displayCanvas`). The pixel art is
//      scaled up onto it without smoothing, then high-resolution effects are
//      layered on top: glowing light, a vignette, and smooth screen shake.
// Chunky pixels + smooth light is what makes it feel retro but modern.
//
// Structure of this file:
//   1. Settings          — tweak numbers here to change how the game feels
//   2. Canvases & helpers
//   3. Pixel font        — a hand-made 5x7 font
//   4. Sound             — synthesized blips and booms (no audio files)
//   5. Input
//   6. World: backdrop, clouds, background war, terrain materials, obstacles,
//      tanks, death sequence, projectiles, explosions and particles
//   7. Game flow         — whose turn it is, win checks, camera
//   8. Rendering
//   9. Main loop         — fixed 60 updates/second, render every frame
// ---------------------------------------------------------------------------

// ===== 1. Settings ==========================================================

const VW = 640;   // the visible screen, in game pixels
const W = 1280;   // the whole battlefield; the camera scrolls across it
const H = 360;
const TICK_MS = 1000 / 60;   // the simulation always steps at 60 Hz
const GRAVITY = 0.1;         // px per tick², pulls shells down
const WIND_ACCEL = 0.003;    // px per tick² per point of wind
const MAX_SPEED = 9;         // shell speed at 100 power, px per tick
const MAX_HP = 100;
const MOVE_FUEL = 60;        // pixels a tank may drive per turn
const HUD_H = 17;

const WEAPONS = [
  { name: 'SHELL', radius: 20, damage: 35, ammo: Infinity },
  { name: 'HEAVY', radius: 34, damage: 55, ammo: 2 },
  { name: 'TRIPLE', radius: 15, damage: 25, ammo: 2, spread: 6 },
];

const PLAYER_COLORS = [
  { body: '#ff3b5c', light: '#ff8fa0', dark: '#9c1f45' },
  { body: '#2fa8ff', light: '#8fd3ff', dark: '#1d4f9c' },
  { body: '#3ee06a', light: '#a6f5b0', dark: '#1f8a4a' },
  { body: '#ffd23b', light: '#fff09a', dark: '#b07a1f' },
];

const INK = '#0a0a1f';    // darkest UI colour, used for shadows and panels
const WHITE = '#f4f0ff';
const DIM = '#8b84b0';

// ===== 2. Canvases & helpers ================================================

const displayCanvas = document.getElementById('game');
const dctx = displayCanvas.getContext('2d');

const pix = document.createElement('canvas');
pix.width = VW;
pix.height = H;
const ctx = pix.getContext('2d');

// Backdrop, terrain and particles are written straight into this pixel buffer
// each frame; sprites and text are drawn on top with fillRect.
const frameImage = ctx.createImageData(VW, H);
const framePixels = new Uint32Array(frameImage.data.buffer);

// Where the pixel-art canvas lands on the display, in device pixels.
const view = { scale: 1, x: 0, y: 0 };
let vignette = null;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  displayCanvas.width = Math.round(innerWidth * dpr);
  displayCanvas.height = Math.round(innerHeight * dpr);
  displayCanvas.style.width = `${innerWidth}px`;
  displayCanvas.style.height = `${innerHeight}px`;
  // Integer scaling keeps every game pixel exactly the same size.
  const fit = Math.min(displayCanvas.width / VW, displayCanvas.height / H);
  view.scale = fit >= 1 ? Math.floor(fit) : fit;
  view.x = Math.floor((displayCanvas.width - VW * view.scale) / 2);
  view.y = Math.floor((displayCanvas.height - H * view.scale) / 2);
  vignette = makeVignette(Math.round(VW * view.scale), Math.round(H * view.scale));
}

function makeVignette(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, 'rgba(5,3,15,0)');
  grad.addColorStop(1, 'rgba(5,3,15,0.6)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return c;
}

addEventListener('resize', resize);
resize();

const DEG = Math.PI / 180;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

// Blend two '#rrggbb' colours; t=0 gives a, t=1 gives b.
function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// '#rrggbb' -> 32-bit pixel value for the Uint32Array view (little-endian ABGR).
function packColor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0xff000000 | b << 16 | g << 8 | r) >>> 0;
}

// 4x4 ordered-dither matrix: blends two colours with a fine pattern instead
// of a smooth gradient — the classic 16-bit look.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

function fillCircle(cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

// A pixel-perfect ring between radius `inner` and `outer`.
function fillRing(cx, cy, outer, inner, color) {
  ctx.fillStyle = color;
  for (let dy = -outer; dy <= outer; dy++) {
    const ho = Math.floor(Math.sqrt(outer * outer - dy * dy));
    if (Math.abs(dy) > inner) {
      ctx.fillRect(cx - ho, cy + dy, ho * 2 + 1, 1);
    } else {
      const hi = Math.floor(Math.sqrt(inner * inner - dy * dy));
      ctx.fillRect(cx - ho, cy + dy, ho - hi, 1);
      ctx.fillRect(cx + hi + 1, cy + dy, ho - hi, 1);
    }
  }
}

// Bresenham line, one pixel at a time (canvas lines would be anti-aliased).
function pixelLine(x0, y0, x1, y1, color) {
  ctx.fillStyle = color;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ===== 3. Pixel font ========================================================
// Each glyph is 5 wide x 7 tall; rows separated by '|', '#' = pixel on.

const FONT_SRC = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#', B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.', D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####', F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.####', H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '.###.|..#..|..#..|..#..|..#..|..#..|.###.', J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', N: '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.', P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.', T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.', V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', 1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####', 3: '####.|....#|....#|.###.|....#|....#|####.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', 5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '.###.|#....|#....|####.|#...#|#...#|.###.', 7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.', 9: '.###.|#...#|#...#|.####|....#|....#|.###.',
  ':': '.....|..#..|..#..|.....|..#..|..#..|.....', '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|..#..|.#...', '-': '.....|.....|.....|.###.|.....|.....|.....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '/': '....#|....#|...#.|..#..|.#...|#....|#....', '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.', '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##', '°': '.##..|#..#.|#..#.|.##..|.....|.....|.....',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
};
const FONT = {};
for (const [ch, src] of Object.entries(FONT_SRC)) FONT[ch] = src.split('|').map(row => [...row].map(c => c === '#'));
const ADVANCE = 6;

// `color` may be one colour or an array of 7 (one per row, for gradients).
function drawGlyphs(str, x, y, color, s) {
  for (const ch of str) {
    const g = FONT[ch];
    if (g) {
      for (let r = 0; r < 7; r++) {
        ctx.fillStyle = Array.isArray(color) ? color[r] : color;
        for (let c = 0; c < 5; c++) if (g[r][c]) ctx.fillRect(x + c * s, y + r * s, s, s);
      }
    }
    x += ADVANCE * s;
  }
  return x;
}

// Returns the x position right after the text, handy for laying out the HUD.
function drawText(str, x, y, color, s = 1, shadow = INK) {
  str = String(str).toUpperCase();
  if (shadow) drawGlyphs(str, x, y + s, shadow, s);
  return drawGlyphs(str, x, y, color, s);
}

const textWidth = (str, s = 1) => String(str).length * ADVANCE * s - s;

function drawCentered(str, y, color, s = 1, shadow = INK) {
  drawText(str, Math.round((VW - textWidth(str, s)) / 2), y, color, s, shadow);
}

// ===== 4. Sound =============================================================
// Everything is synthesized with the Web Audio API — no sound files needed.

let audioCtx = null;
let master = null;       // compressor everything plays through: loud but no clipping
let noiseBuffer = null;
let crunchCurve = null;  // wave-shaper curve for distortion
let muted = false;

function audio() {
  if (muted) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
    master = audioCtx.createDynamicsCompressor();
    master.connect(audioCtx.destination);
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    crunchCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      crunchCurve[i] = ((3 + 40) * x * 20 * DEG) / (Math.PI + 40 * Math.abs(x));
    }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(type, from, to, duration, volume) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + duration);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + duration);
}

const sfxFire = () => tone('square', 320, 60, 0.2, 0.12);
const sfxBlip = (freq = 660) => tone('square', freq, freq, 0.05, 0.06);

function sfxBoom(size) {
  const a = audio();
  if (!a) return;
  tone('sine', 110, 28, 0.4 + size * 0.01, 0.45);  // sub-bass thump you feel
  const t = a.currentTime;
  const duration = 0.3 + size * 0.015;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1400, t);
  filter.frequency.exponentialRampToValueAtTime(60, t + duration);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + duration);
}

// A shell hitting a tank: a clang of armour plate, a heavy bass hit and a
// distorted metal crunch, plus an ear-ringing tail on big hits. strength 0..1.
function sfxTankHit(strength) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const out = a.createGain();
  out.gain.value = 0.6 + strength * 0.4;
  out.connect(master);

  // Clang: inharmonic partials, the way struck metal rings.
  for (const [f, v] of [[180, 0.25], [287, 0.2], [463, 0.15], [741, 0.1], [1133, 0.06]]) {
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f * rand(0.97, 1.03), t);
    osc.frequency.exponentialRampToValueAtTime(f * 0.9, t + 1);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4 + strength * 0.6);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 1.1);
  }

  // Bass hit.
  const bass = a.createOscillator();
  const bassGain = a.createGain();
  bass.type = 'sine';
  bass.frequency.setValueAtTime(140, t);
  bass.frequency.exponentialRampToValueAtTime(30, t + 0.7);
  bassGain.gain.setValueAtTime(0.8, t);
  bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  bass.connect(bassGain).connect(out);
  bass.start(t);
  bass.stop(t + 0.7);

  // Crunch: a distorted burst of noise.
  const noise = a.createBufferSource();
  noise.buffer = noiseBuffer;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 0.8;
  const shaper = a.createWaveShaper();
  shaper.curve = crunchCurve;
  const crunchGain = a.createGain();
  crunchGain.gain.setValueAtTime(0.5, t);
  crunchGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  noise.connect(band).connect(shaper).connect(crunchGain).connect(out);
  noise.start(t);
  noise.stop(t + 0.25);

  // Ringing ears after a big hit.
  if (strength > 0.6) {
    const ring = a.createOscillator();
    const ringGain = a.createGain();
    ring.type = 'sine';
    ring.frequency.value = 3200;
    ringGain.gain.setValueAtTime(0.0001, t);
    ringGain.gain.exponentialRampToValueAtTime(0.03, t + 0.1);
    ringGain.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    ring.connect(ringGain).connect(out);
    ring.start(t);
    ring.stop(t + 2);
  }
}

// Looping machine sounds, faded in and out. Each builds its own little synth
// once and returns a function that retunes it; only touched on state changes.
const LOOP_SOUNDS = {
  // Engine: a gritty rumble from two detuned oscillators, pitching up on climbs.
  engine: {
    volume: 0.16,
    build(a, out) {
      const filter = a.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 320;
      filter.connect(out);
      const low = a.createOscillator(), high = a.createOscillator();
      low.type = 'sawtooth';
      high.type = 'square';
      for (const osc of [low, high]) {
        osc.connect(filter);
        osc.start();
      }
      return (pitch, t) => {
        low.frequency.setTargetAtTime(pitch, t, 0.08);
        high.frequency.setTargetAtTime(pitch * 1.51, t, 0.08);  // a rough fifth: gritty
      };
    },
  },
  // Turret: a geared motor — a low buzzing hum plus gear teeth chattering,
  // made by switching filtered noise on and off ~24 times a second.
  turret: {
    volume: 0.12,
    build(a, out) {
      const motor = a.createOscillator();
      motor.type = 'square';
      const motorFilter = a.createBiquadFilter();
      motorFilter.type = 'lowpass';
      motorFilter.frequency.value = 380;
      const motorGain = a.createGain();
      motorGain.gain.value = 0.5;
      motor.connect(motorFilter).connect(motorGain).connect(out);
      motor.start();

      const noise = a.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;
      const teethFilter = a.createBiquadFilter();
      teethFilter.type = 'bandpass';
      teethFilter.frequency.value = 1100;
      teethFilter.Q.value = 3;
      const teeth = a.createGain();
      teeth.gain.value = 0.5;  // the gate below swings this between 0 and 1
      const gate = a.createOscillator();
      gate.type = 'square';
      const gateDepth = a.createGain();
      gateDepth.gain.value = 0.5;
      gate.connect(gateDepth).connect(teeth.gain);
      noise.connect(teethFilter).connect(teeth).connect(out);
      noise.start();
      gate.start();
      return (pitch, t) => {
        motor.frequency.setTargetAtTime(pitch, t, 0.05);
        gate.frequency.setTargetAtTime(pitch / 3, t, 0.05);
      };
    },
  },
};
const loops = {};

function setLoop(name, on, pitch) {
  if (!audioCtx && !on) return;
  const a = audio();
  const loop = loops[name];
  if (!a) {
    if (loop) {
      loop.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05);  // muted
      loop.key = '';
    }
    return;
  }
  const spec = LOOP_SOUNDS[name];
  if (!loop) {
    const gain = a.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    loops[name] = { gain, tune: spec.build(a, gain), key: '' };
    return setLoop(name, on, pitch);
  }
  const key = `${on}:${pitch}`;
  if (key === loop.key) return;
  loop.key = key;
  const t = a.currentTime;
  loop.gain.gain.setTargetAtTime(on ? spec.volume : 0, t, on ? 0.03 : 0.1);
  loop.tune(pitch, t);
}

// Turret ratchet: a heavy gear thunk under a metallic click, alternating
// high/low like a crank being wound.
function sfxCrank(high) {
  const a = audio();
  if (!a) return;
  tone('sine', high ? 220 : 180, 90, 0.06, 0.25);
  const t = a.currentTime;
  const osc = a.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(high ? 1250 : 900, t);
  osc.frequency.exponentialRampToValueAtTime(high ? 700 : 500, t + 0.025);
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = high ? 2400 : 1700;
  band.Q.value = 4;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.18, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(band).connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + 0.03);
}

// Tread clank: a tiny metallic click every few pixels of driving.
function sfxClank() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const band = a.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = rand(1800, 3200);
  band.Q.value = 6;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.connect(band).connect(gain).connect(master);
  src.start(t, rand(0, 0.9));
  src.stop(t + 0.04);
}

// Silences the looping machine sounds right away — for when the tab loses
// focus (updates may stop, so the per-tick logic can't turn them off).
function stopLoops() {
  if (!audioCtx) return;
  for (const loop of Object.values(loops)) {
    loop.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03);
    loop.key = '';
  }
}

// A far-off explosion: muffled and quiet. (The delay before it's heard is
// counted in game ticks by the background war, so resets cancel it.)
function sfxDistantBoom(size) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 220;
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.setValueAtTime(0.06 + size * 0.012, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + 0.9);
}

// ===== 5. Input =============================================================
// `pressed` holds keys that went down since the last tick (one-shot actions);
// `held` maps keys that are down to how many ticks they've been held.

const pressed = new Set();
const held = new Map();
const BLOCKED_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

addEventListener('keydown', e => {
  if (BLOCKED_KEYS.has(e.code)) e.preventDefault(); // stop the page scrolling
  if (e.repeat) return;
  pressed.add(e.code);
  held.set(e.code, 0);
});
addEventListener('keyup', e => held.delete(e.code));
addEventListener('blur', () => {
  held.clear();
  stopLoops();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoops();
});

// Dragging with the mouse looks around the battlefield (converted from
// screen pixels to game pixels here, consumed by the camera each tick).
let dragging = false;
let dragDX = 0;
displayCanvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', e => {
  if (dragging) dragDX += (e.movementX * (window.devicePixelRatio || 1)) / view.scale;
});

// True on the first press, then every tick once the key has been held a while.
const repeatKey = code => pressed.has(code) || (held.get(code) ?? 0) >= 18;

function endInputTick() {
  pressed.clear();
  for (const [code, n] of held) held.set(code, n + 1);
}

// ===== 6. World =============================================================

// --- Backdrop ---
// The sky, stars and moon are fixed to the screen. Two layers of distant
// hills scroll slower than the battlefield (parallax), which sells depth.
// All are built once per match into pixel arrays, then copied every frame.

const SKY = ['#0a0a1f', '#141a3a', '#22265a', '#3d2f6e', '#6a3a78', '#a8487a', '#e0687a', '#ffa07a'];
const MOON = { x: 505, y: 62, r: 20 };
const STAR_BRIGHT = packColor('#fff6e0');
const STAR_DIM = packColor('#8f88c0');
const sky = new Uint32Array(VW * H);
let twinkles = [];

// A parallax layer moves `f` pixels per pixel the camera moves.
function makeLayer(f) {
  const w = VW + Math.ceil((W - VW) * f);
  return { f, w, data: new Uint32Array(w * H), top: H };
}
const farHills = makeLayer(0.25);
const nearHills = makeLayer(0.55);

function buildBackdrop() {
  const bands = SKY.map(packColor);
  for (let y = 0; y < H; y++) {
    const t = clamp(y / (H * 0.72), 0, 1) * (bands.length - 1);
    const i = Math.floor(t);
    for (let x = 0; x < VW; x++) {
      sky[y * VW + x] = t - i > bayer(x, y) ? bands[Math.min(i + 1, bands.length - 1)] : bands[i];
    }
  }

  // Stars: most static, some twinkle (animated in composeFrame).
  twinkles = [];
  for (let n = 0; n < 260; n++) {
    const x = randInt(0, VW - 1), y = randInt(HUD_H + 2, Math.floor(H * 0.5));
    const i = y * VW + x;
    if (Math.random() < 0.12) {
      twinkles.push({ i, phase: rand(0, 6.28), speed: rand(0.03, 0.09) });
    } else {
      sky[i] = Math.random() < 0.25 ? STAR_BRIGHT : STAR_DIM;
    }
  }

  // Moon with soft shading and craters.
  const craters = [[-7, -5, 4], [5, 3, 5], [-3, 8, 3], [8, -8, 2]];
  for (let dy = -MOON.r; dy <= MOON.r; dy++) {
    for (let dx = -MOON.r; dx <= MOON.r; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > MOON.r) continue;
      let c = (dx + dy) / (2 * MOON.r) > 0.3 ? '#d9cfb4' : '#f4ecd2';
      for (const [cx, cy, cr] of craters) if (Math.hypot(dx - cx, dy - cy) < cr) c = '#c8bc9f';
      if (d > MOON.r - 1.2 && bayer(dx, dy) > 0.5) c = '#b8ad95';
      sky[(MOON.y + dy) * VW + MOON.x + dx] = packColor(c);
    }
  }

  // Far mountains (jagged, rim-lit).
  const p = Array.from({ length: 4 }, () => rand(0, 6.28));
  const farTop = packColor('#4a3f80'), far = packColor('#2c2558');
  farHills.data.fill(0);
  farHills.top = H;
  for (let x = 0; x < farHills.w; x++) {
    const ridge = Math.max(0, Math.round(H * 0.5 - Math.abs(Math.sin(x * 0.011 + p[0])) * 44 - Math.abs(Math.sin(x * 0.027 + p[1])) * 18));
    farRidge[x] = ridge;
    farHills.top = Math.min(farHills.top, ridge);
    for (let y = ridge; y < H; y++) farHills.data[y * farHills.w + x] = y < ridge + 2 ? farTop : far;
  }

  // Nearer hills with pine trees.
  const nearColor = packColor('#1c1838');
  const nearRidge = [];
  nearHills.data.fill(0);
  nearHills.top = H;
  for (let x = 0; x < nearHills.w; x++) {
    nearRidge[x] = Math.round(H * 0.6 + Math.sin(x * 0.009 + p[2]) * 16 + Math.sin(x * 0.031 + p[3]) * 6);
    for (let y = nearRidge[x]; y < H; y++) nearHills.data[y * nearHills.w + x] = nearColor;
  }
  for (let n = Math.round(45 * nearHills.w / VW); n > 0; n--) {
    const tx = randInt(4, nearHills.w - 5), base = nearRidge[tx] + 2, h = randInt(8, 18);
    nearHills.top = Math.min(nearHills.top, base - h);
    for (let k = 0; k <= h; k++) {
      const half = Math.floor(k * 0.32) - (k % 4 === 3 ? 1 : 0);
      for (let dx = -half; dx <= half; dx++) {
        const x = tx + dx, y = base - h + k;
        if (x >= 0 && x < nearHills.w && y >= 0) nearHills.data[y * nearHills.w + x] = nearColor;
      }
    }
  }
}

// --- Clouds: small pixel sprites that drift with the wind ---
// They live in their own parallax space, between the hills and the ground.

const CLOUD_PARALLAX = 0.4;
const CLOUD_SPACE = VW + Math.ceil((W - VW) * CLOUD_PARALLAX);

let clouds = [];

function makeCloud(depth) {
  const w = randInt(50, 96), h = randInt(14, 24);
  const blobs = Array.from({ length: randInt(4, 7) }, () => ({
    x: rand(h * 0.5, w - h * 0.5), y: rand(h * 0.5, h * 0.7), r: rand(h * 0.3, h * 0.5),
  }));
  // Nearer clouds are brighter; all are lit from above by the moon.
  const tones = ['#6b5a9a', '#4b3f7a', '#352c5e'].map(c => packColor(mix(c, '#141a3a', 1 - depth)));
  const data = new Uint32Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      let m = Infinity;
      for (const b of blobs) m = Math.min(m, Math.hypot(x - b.x, (y - b.y) * 1.3) / b.r);
      if (m >= 1 || (m > 0.8 && bayer(x, y) < (m - 0.8) / 0.2)) continue;
      data[y * w + x] = tones[y < h * 0.4 ? 0 : y < h * 0.7 ? 1 : 2];
    }
  }
  return { w, h, data };
}

function buildClouds() {
  clouds = Array.from({ length: Math.round(7 * CLOUD_SPACE / VW) }, () => {
    const depth = rand(0.4, 1);
    const c = makeCloud(depth);
    return { ...c, depth, x: rand(-c.w, CLOUD_SPACE), y: randInt(26, 120) };
  });
}

function updateClouds() {
  for (const c of clouds) {
    c.x += (0.04 + wind * 0.025) * c.depth;
    if (c.x > CLOUD_SPACE) c.x = -c.w;
    if (c.x < -c.w) c.x = CLOUD_SPACE;
  }
}

// --- Background war: jets, rockets and explosions far off in the distance ---
// Pure decoration. Everything lives in a parallax space like the hills (layer
// x = screen x + camera x * f), so it scrolls slowly and reads as far away.
// It's drawn between the far mountains and the near hills.

const FAR_F = farHills.f;  // rockets and ground explosions sit on the far mountains
const JET_F = 0.35;        // jets fly a little closer
const farRidge = [];       // the far mountains' ridge line, set by buildBackdrop

const JET_SPRITE = ['##..........', '####...##...', '############', '....####....'];
const JET_DARK = packColor('#6a60a0');
const JET_LIT = packColor('#b8b0e8');
const NAV_RED = packColor('#ff3b5c');
const NAV_GREEN = packColor('#3ee06a');
const CONTRAIL = ['#9a92c8', '#7d74ae', '#615893', '#4a4278'].map(packColor);
const BG_FIRE = ['#ffffff', '#ffe08a', '#ffa040', '#ff5a3a', '#7a3a4a'].map(packColor);
const BG_SMOKE = packColor('#3a3352');
const BG_EXHAUST = packColor('#544c70');

const bg = { jets: [], rockets: [], booms: [], puffs: [], sounds: [], nextJet: 0, nextRocket: 0, nextBoom: 0 };
const spaceWidth = f => VW + (W - VW) * f;
const bgScreenX = (x, f) => x - camera.x * f;
const bgVisible = (x, f, margin = 40) => bgScreenX(x, f) > -margin && bgScreenX(x, f) < VW + margin;

function resetBackground() {
  bg.jets = [];
  bg.rockets = [];
  bg.booms = [];
  bg.puffs = [];
  bg.sounds = [];
  bg.nextJet = randInt(60, 200);
  bg.nextRocket = randInt(120, 300);
  bg.nextBoom = randInt(40, 150);
}

function spawnJets() {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const count = Math.random() < 0.35 ? randInt(2, 3) : 1;  // sometimes a formation
  const y = randInt(HUD_H + 16, 110), speed = rand(2.2, 3.4);
  const startX = dir > 0 ? -20 : spaceWidth(JET_F) + 20;
  for (let k = 0; k < count; k++) {
    bg.jets.push({ x: startX - dir * k * 16, y: y + k * 5, vx: dir * speed, dir, trail: [], age: 0 });
  }
}

function spawnRockets() {
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

function spawnBoom(x, y, f, r, ground) {
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

function updateBackground() {
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
    p.x += p.vx + wind * 0.008;
    p.y += p.vy;
    p.r += p.grow;
    p.life--;
  }
  bg.puffs = bg.puffs.filter(p => p.life > 0);

  for (const s of bg.sounds) if (--s.delay === 0) sfxDistantBoom(s.size);
  bg.sounds = bg.sounds.filter(s => s.delay > 0);
}

function bgPixel(lx, y, f, color) {
  const x = Math.round(lx - camX * f);
  y = Math.round(y);
  if (x >= 0 && x < VW && y >= 0 && y < H) framePixels[y * VW + x] = color;
}

// A filled circle; `density` below 1 dithers it away for a retro fade.
function bgDisc(lx, cy, f, r, color, density = 1) {
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

function drawBackgroundWar() {
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
    bgPixel(j.x - j.dir * 7, j.y + 2, JET_F, BG_FIRE[1 + (ticks & 1)]);  // afterburner
    if (ticks % 40 < 4) bgPixel(j.x, j.y + 3, JET_F, ticks % 80 < 40 ? NAV_RED : NAV_GREEN);  // blinking nav light
  }

  for (const r of bg.rockets) {
    if (r.delay > 0) continue;
    bgPixel(r.x, r.y, FAR_F, BG_FIRE[0]);
    bgPixel(r.x - r.vx, r.y - r.vy, FAR_F, BG_FIRE[1 + (ticks & 1)]);
  }

  for (const b of bg.booms) {
    const p = b.age / b.life;
    const r = b.r * (p < 0.2 ? 0.4 + p * 3 : 1 - (p - 0.2) * 0.6);
    bgDisc(b.x, b.y, b.f, r, BG_FIRE[Math.min(4, Math.floor(p * 5))]);
    if (p < 0.5) bgDisc(b.x, b.y, b.f, r * 0.5, BG_FIRE[Math.floor(p * 2)]);
  }
}

function backgroundLights(lights) {
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

// --- Terrain: one material index per pixel, 0 means air ---
// Each material has a colour plus rules for how it behaves:
//   solid  — blocks shells and tanks (decoration like grass tufts doesn't)
//   loose  — falls when the ground under it is blown away
//   blast  — what an explosion turns it into: 'AIR', another material
//            (boulders crack before they break), or 'SELF' (indestructible)
//   rubble — what it lands as when flung out as debris (null = nothing)
//   scorch — whether the crater rim chars it

const MATERIAL_DEFS = [
  ['GRASS', '#4fbf4a'], ['GRASS_DARK', '#2f8a45'],
  ['DIRT', '#a5603c'], ['DIRT_1', '#87492f'], ['DIRT_2', '#663626'], ['DIRT_3', '#47261e'], ['DIRT_4', '#2e1915'],
  ['ROCK', '#6b6170', { scorch: false }], ['ROCK_DARK', '#4a4252', { scorch: false }],
  ['SCORCH', '#3a2420'], ['SCORCH_DARK', '#22140f'],
  // Boulders: the first blast cracks them, the second breaks them.
  ...['BOULDER_HI:#a49cb0:CRACKED_HI', 'BOULDER:#7d7590:CRACKED', 'BOULDER_LO:#565068:CRACKED_LO'].map(s => {
    const [name, color, cracked] = s.split(':');
    return [name, color, { loose: false, scorch: false, blast: cracked, rubble: 'ROCK' }];
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

const T = {};
const MATERIALS = [null];
for (const [name, color, props] of MATERIAL_DEFS) {
  T[name] = MATERIALS.length;
  MATERIALS.push({ name, color, solid: true, loose: true, blast: 'AIR', rubble: name, scorch: true, ...props });
}
// Flat lookup tables, indexed by material, for the hot loops.
const SOLID = Uint8Array.from(MATERIALS, m => (m && m.solid ? 1 : 0));
const LOOSE = Uint8Array.from(MATERIALS, m => (m && m.loose ? 1 : 0));
const SCORCHABLE = Uint8Array.from(MATERIALS, m => (m && m.scorch ? 1 : 0));
const BLAST = Uint8Array.from(MATERIALS, (m, i) => (!m || m.blast === 'AIR' ? 0 : m.blast === 'SELF' ? i : T[m.blast]));
const RUBBLE = Uint8Array.from(MATERIALS, m => (m && m.rubble ? T[m.rubble] : 0));
const T_BASE = MATERIALS.map(m => (m ? packColor(m.color) : 0));
const T_LIGHT = MATERIALS.map(m => (m ? packColor(mix(m.color, '#fff4d6', 0.25)) : 0));
const T_DARK = MATERIALS.map(m => (m ? packColor(mix(m.color, INK, 0.35)) : 0));

const terrain = new Uint8Array(W * H);

function soilAt(depth) {
  if (depth < 3) return Math.random() < 0.3 ? T.GRASS_DARK : T.GRASS;
  if (depth < 6) return Math.random() < (depth - 2) / 4 ? T.DIRT : T.GRASS_DARK;
  const band = clamp(Math.floor((depth + rand(-5, 5)) / 30), 0, 4);
  return T.DIRT + (Math.random() < 0.06 ? Math.min(band + 1, 4) : band);
}

function fillColumn(x, top) {
  for (let y = 0; y < H; y++) terrain[y * W + x] = y >= top ? soilAt(y - top) : 0;
}

function setPixel(x, y, material) {
  if (x >= 0 && x < W && y >= 0 && y < H) terrain[y * W + x] = material;
}

function generateTerrain() {
  // Rolling hills = a few sine waves of different sizes added together.
  const waves = [
    [rand(0.004, 0.007), rand(0, 6.28), rand(36, 60)],
    [rand(0.01, 0.018), rand(0, 6.28), rand(12, 24)],
    [rand(0.03, 0.045), rand(0, 6.28), rand(2, 6)],
  ];
  const base = rand(H * 0.55, H * 0.68);
  const tops = [];
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

// --- Obstacles: boulders, monoliths, floating islands ---

let monoliths = [];  // remembered for their rune glow

// Places obstacles, keeping clear of the tanks' start positions.
function placeObstacles(spawns) {
  monoliths = [];
  const ground = spawns.map(x => ({ x, r: 30 }));
  const sky = spawns.map(x => ({ x, r: 34 }));
  const place = (taken, r, build) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = randInt(r + 4, W - r - 5);
      if (taken.some(t => Math.abs(t.x - x) < t.r + r)) continue;
      if (build(x) === false) continue;
      taken.push({ x, r });
      return;
    }
  };
  const screens = W / VW;  // obstacle counts are per screen-width of map
  for (let n = randInt(3, 5) * screens; n > 0; n--) {
    const rx = randInt(7, 13);
    place(ground, rx + 4, x => makeBoulder(x, rx, randInt(6, 10)));
  }
  for (let n = randInt(1, 2) * screens; n > 0; n--) place(ground, 10, makeMonolith);
  for (let n = randInt(1, 2) * screens; n > 0; n--) {
    const hw = randInt(20, 45);
    place(sky, hw + 6, x => makeIsland(x, hw));
  }
}

function makeBoulder(cx, rx, ry) {
  const cy = surfaceY(cx) - ry + 3;  // sunk a little into the ground
  const p1 = rand(0, 6.28), p2 = rand(0, 6.28);
  // A lumpy ellipse: the radius wobbles with the angle.
  const inside = (dx, dy) => {
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
      if (!inside(dx, dy - 1) && dy < -ry * 0.3 && Math.random() < 0.6) m = T.MOSS;
      setPixel(cx + dx, cy + dy, m);
    }
  }
}

const RUNE_GLYPHS = ['010111010', '101010101', '111101111', '110011110', '011110011', '111010111'];

function makeMonolith(cx) {
  const w = randInt(4, 6), h = randInt(26, 42);
  let base = 0;
  for (let dx = -w; dx <= w; dx++) base = Math.max(base, surfaceY(cx + dx));
  base += 4;  // planted into the ground
  const top = base - h;
  if (top < HUD_H + 30) return false;
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

function makeIsland(cx, hw) {
  // Float well clear of the ground below.
  let highest = H;
  for (let x = cx - hw; x <= cx + hw; x++) highest = Math.min(highest, surfaceY(x));
  const depth = Math.round(hw * 0.6);
  const lowestTop = highest - 30 - depth;
  if (lowestTop < HUD_H + 40) return false;
  const ty = randInt(HUD_H + 40, lowestTop);
  for (let x = cx - hw; x <= cx + hw; x++) {
    const u = (x - cx) / hw;
    const topY = ty + Math.round(u * u * 3 + rand(0, 1));
    const d = Math.round((1 - u * u) ** 0.7 * depth * rand(0.85, 1.1)) + 2;
    for (let y = topY; y <= topY + d; y++) {
      const k = y - topY;
      const m = k < 2 ? (Math.random() < 0.3 ? T.ISLE_GRASS_DARK : T.ISLE_GRASS)
        : k < d * 0.45 ? (Math.random() < 0.3 ? T.ISLE_DIRT_DARK : T.ISLE_DIRT)
          : T.ISLE_ROCK;
      setPixel(x, y, m);
    }
    if (Math.random() < 0.3) setPixel(x, topY - 1, Math.random() < 0.5 ? T.TUFT_TIP : T.TUFT);
    // Roots and vines dangling underneath.
    if (Math.random() < 0.25) {
      const len = randInt(2, 9), vine = Math.random() < 0.5;
      for (let k = 1; k <= len; k++) {
        setPixel(x, topY + d + k, vine ? (k === len ? T.VINE_TIP : T.VINE) : T.ROOT);
      }
    }
  }
}

// The bottom edge of the screen counts as solid ground.
function solid(x, y) {
  if (y >= H) return true;
  if (x < 0 || x >= W || y < 0) return false;
  return SOLID[terrain[y * W + x]] === 1;
}

function surfaceY(x) {
  for (let y = 0; y < H; y++) if (solid(x, y)) return y;
  return H;
}

// Columns touched by explosions; loose material in them falls 1px per pass.
let dirtyMin = W;
let dirtyMax = -1;

function markDirty(x0, x1) {
  dirtyMin = Math.min(dirtyMin, Math.max(0, x0));
  dirtyMax = Math.max(dirtyMax, Math.min(W - 1, x1));
}

function settleTerrain() {
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

const terrainSettling = () => dirtyMax >= dirtyMin;

// --- Tanks ---
// A tank's (x, y) is the bottom-centre pixel of its 17x9 sprite. Tanks tilt
// to follow the ground, up to MAX_SLOPE; steeper slopes can't be driven up.
// h = highlight, b = body, d = shadow, t = tread; row 7 is animated wheels.

const MAX_SLOPE = 30 * DEG;    // steepest a tank can climb, and the most it tilts
const SLIDE_SLOPE = 35 * DEG;  // anything steeper and a resting tank slides down

const TANK_SPRITE = [
  '......hhhhh......',
  '.....hbbbbbd.....',
  '..hhhhhhhhhhhhh..',
  '.hbbbbbbbbbbbbbd.',
  'hbbbbbbbbbbbbbbbd',
  'ddddddddddddddddd',
  '.ttttttttttttttt.',
  null,
  '.ttttttttttttttt.',
];
const WRECK_COLORS = { light: '#4a4252', body: '#3a3442', dark: '#26222e' };

function makeTank(index, x) {
  return {
    name: `P${index + 1}`,
    title: `PLAYER ${index + 1}`,
    color: PLAYER_COLORS[index],
    x,
    y: 0,
    tilt: 0,        // radians; positive = right side lower
    angle: x < W / 2 ? 45 : 135,  // 0 = pointing right, 90 = up, 180 = left
    power: 55,
    hp: MAX_HP,
    alive: true,
    fuel: MOVE_FUEL,
    weapon: 0,
    ammo: WEAPONS.map(w => w.ammo),
    falling: false,
    sliding: false,
    fallFrom: 0,
    vy: 0,
    fy: 0,
    tread: 0,       // wheel animation frame
    recoil: 0,      // barrel kick after firing
    flash: 0,       // muzzle flash timer
    dying: 0,       // ticks left in the death sequence (0 = not dying)
    pop: null,      // last little hull explosion while dying, for its light
    lastPath: [],   // where this tank's previous shot flew, drawn as a hint
    lastMoveTick: -99,  // for the engine sound
    lastClimb: 0,       // +1 climbing, -1 descending, 0 level
    lastTurnTick: -99,  // for the turret sound
    cranks: 0,          // ratchet clicks so far, alternates the click pitch
  };
}

function grounded(t) {
  for (let dx = -2; dx <= 2; dx++) if (solid(t.x + dx, t.y + 1)) return true;
  return false;
}

// Height of the ground in column x, searched in a window around y.
function groundAt(x, y) {
  for (let gy = y - 8; gy <= y + 12; gy++) if (solid(x, gy)) return gy;
  return y + 12;
}

// Angle of the ground under a tank's treads at (x, y).
const groundSlope = (x, y) => Math.atan2(groundAt(x + 6, y) - groundAt(x - 6, y), 12);

function hurt(t, amount) {
  if (!t.alive || amount <= 0) return;
  t.hp = Math.max(0, t.hp - amount);
  floaters.push({ x: t.x, y: t.y - 30, text: `-${amount}`, color: '#ff6b6b', life: 70, s: 1 });
}

// --- Death sequence ---
// A destroyed tank doesn't blow at once: it goes critical, spewing sparks and
// smoke with little pops while it shakes and glows, then explodes.

const DEATH_TICKS = 100;
const HOT_COLORS = { light: '#ffffff', body: '#ffe08a', dark: '#ff5a3a' };

function startDying(t) {
  t.dying = DEATH_TICKS;
  floaters.push({ x: t.x, y: t.y - 40, text: 'CRITICAL!', color: '#ff3b5c', life: 60, s: 1 });
  tone('sawtooth', 110, 900, DEATH_TICKS / 60, 0.05);  // rising whine
}

function updateDying(t) {
  t.dying--;
  const p = 1 - t.dying / DEATH_TICKS;  // 0 → 1 as the end nears

  // A fountain of sparks out of the hull, getting more violent.
  for (let i = 0; i < 1 + p * 5; i++) {
    const a = -Math.PI / 2 + rand(-0.7, 0.7), v = rand(1.5, 3.5 + p * 3);
    particles.push(spark(t.x + rand(-6, 6), t.y - rand(3, 8), Math.cos(a) * v, Math.sin(a) * v));
  }
  if (ticks % 3 === 0) {
    particles.push(smoke(t.x + rand(-5, 5), t.y - 8, rand(2, 4), { color: '#2a2633', alpha: 0.6 }));
  }

  // Random pops: little bursts from the hull, more often near the end.
  if (t.pop) t.pop.life--;
  if (Math.random() < 0.04 + p * 0.12) {
    const px = t.x + rand(-7, 7), py = t.y - rand(2, 8);
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), v = rand(1, 3.5);
      particles.push(spark(px, py, Math.cos(a) * v, Math.sin(a) * v - 1));
    }
    t.pop = { x: px, y: py, life: 5 };
    trauma = Math.min(1, trauma + 0.06);
    tone('square', rand(300, 900), 60, 0.07, 0.05);
  }
  trauma = Math.max(trauma, p * 0.35);  // a building rumble

  if (t.dying > 0) return;
  t.alive = false;
  t.pop = null;
  // Shrapnel: bits of the tank flying everywhere.
  const metal = [t.color.body, t.color.dark, '#5c566b', '#8f88a0'].map(packColor);
  for (let i = 0; i < 30; i++) {
    const a = rand(-Math.PI, 0), v = rand(2, 7);
    particles.push({
      kind: 'shrapnel', x: t.x, y: t.y - 5, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: randInt(50, 90), color: metal[randInt(0, metal.length - 1)],
    });
  }
  explode(t.x, t.y - 4, 30, 30);
  floaters.push({ x: t.x, y: t.y - 40, text: 'BOOM!', color: '#ffa040', life: 80, s: 2 });
}

function updateTank(t) {
  if (t.recoil > 0) t.recoil -= 0.25;
  if (t.flash > 0) t.flash--;
  if (t.dying > 0) updateDying(t);
  if (!t.alive && ticks % 6 === 0) {
    // Wrecks keep smouldering.
    particles.push(smoke(t.x + rand(-4, 4), t.y - 6, 2));
    if (Math.random() < 0.3) particles.push(spark(t.x + rand(-4, 4), t.y - 6, rand(-0.4, 0.4), rand(-1.5, -0.5)));
  }

  if (grounded(t)) {
    if (t.falling) {
      const dist = t.y - t.fallFrom;
      if (dist > 12) hurt(t, dist - 12);
      t.falling = false;
    }
    // Too steep to rest on? Slide downhill a pixel every few ticks.
    const slope = groundSlope(t.x, t.y);
    if (Math.abs(slope) <= SLIDE_SLOPE) t.sliding = false;
    else if (ticks % 3 === 0) t.sliding = slide(t, slope > 0 ? 1 : -1);
    // Ease toward the ground's angle so the tank settles rather than snaps.
    t.tilt += (clamp(slope, -MAX_SLOPE, MAX_SLOPE) - t.tilt) * 0.3;
    return;
  }
  if (!t.falling) {
    t.falling = true;
    t.fallFrom = t.y;
    t.vy = 0;
    t.fy = 0;
  }
  t.vy = Math.min(t.vy + 0.3, 6);
  t.fy += t.vy;
  while (t.fy >= 1) {
    t.fy -= 1;
    t.y++;
    if (grounded(t)) break;
  }
}

// Moves a tank one pixel sideways, hugging the ground: stepping up small
// ledges or down along a slope (bigger drops become a fall). False if blocked.
function stepAlongGround(t, dir) {
  const nx = t.x + dir;
  if (nx < 8 || nx > W - 9) return false;
  let ny = t.y;
  while (solid(nx, ny) && t.y - ny < 4) ny--;
  if (solid(nx, ny)) return false;  // a wall
  while (!solid(nx, ny + 1) && ny - t.y < 4) ny++;
  t.lastClimb = Math.sign(t.y - ny);
  t.x = nx;
  t.y = ny;
  t.tread += dir;
  return true;
}

// A slide step only counts if it goes downhill, so sliding always comes to
// rest instead of rocking back and forth in a pit.
function slide(t, dir) {
  const { x, y, tread } = t;
  if (stepAlongGround(t, dir) && t.y > y) return true;
  t.x = x;
  t.y = y;
  t.tread = tread;
  return false;
}

function tryMove(t, dir) {
  if (t.fuel <= 0 || t.falling) return;
  // Steep climbs are blocked; steep descents are fine (the tank slides anyway).
  const slope = groundSlope(t.x + dir, t.y);
  if (slope * dir < 0 && Math.abs(slope) > MAX_SLOPE) return;
  if (!stepAlongGround(t, dir)) return;
  t.lastMoveTick = ticks;
  t.fuel--;
  if (t.tread % 4 === 0) sfxClank();
}

// The turret sits 7px above the tank's base, rotated with the hull. The
// barrel's aim angle stays absolute, so 45° always means 45° from horizontal.
function turretPivot(t) {
  return { x: t.x + Math.sin(t.tilt) * 7, y: t.y - Math.cos(t.tilt) * 7 };
}

function barrelTip(t, angle, length = 12) {
  const p = turretPivot(t);
  return {
    x: p.x + Math.cos(angle * DEG) * length,
    y: p.y - Math.sin(angle * DEG) * length,
  };
}

// Picks the spot nearest `target` where the ground is gentle enough to start on.
function findSpawnX(target) {
  let best = target, bestSlope = Infinity;
  for (let d = 0; d <= 40; d++) {
    for (const x of [target - d, target + d]) {
      if (x < 24 || x > W - 25) continue;
      const s = Math.abs(groundSlope(x, surfaceY(x) - 1));
      if (s <= 20 * DEG) return x;
      if (s < bestSlope) {
        best = x;
        bestSlope = s;
      }
    }
  }
  return best;
}

// --- Projectiles ---

let projectiles = [];

function fire(t) {
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
    projectiles.push({
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
  for (let i = 0; i < 3; i++) particles.push(smoke(tip.x, tip.y, 2));
  state = 'flying';
  sfxFire();
}

// The tank a shell at (x, y) is touching, if any.
function struckTank(p, x, y) {
  return tanks.find(t =>
    t.alive &&
    !(t === p.owner && p.age < 8) &&  // don't collide with our own barrel
    x >= t.x - 8 && x <= t.x + 8 && y >= t.y - 9 && y <= t.y) ?? null;
}

function updateProjectile(p) {
  p.vx += wind * WIND_ACCEL;
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
      if (p.tracked) camera.impact = { x: clamp(ix, 0, W - 1), tick: ticks };
      return;
    }
    const struck = struckTank(p, ix, iy);
    if (iy >= H - 1 || (iy >= 0 && solid(ix, iy)) || struck) {
      p.dead = true;
      if (p.tracked) camera.impact = { x: ix, tick: ticks };
      explode(ix, Math.min(iy, H - 1), p.weapon.radius, p.weapon.damage, struck);
      return;
    }
  }
  p.trail.push({ x: p.x, y: p.y });
  if (p.trail.length > 14) p.trail.shift();
  if (p.tracked && p.age % 3 === 0) p.owner.lastPath.push({ x: Math.round(p.x), y: Math.round(p.y) });
}

// --- Explosions, particles, floating text ---
// Particle kinds: 'debris' (dirt that lands and becomes terrain again),
// 'spark' (glowing embers) and 'smoke' (soft puffs: smoke and dust clouds).

let explosions = [];
let particles = [];
let floaters = [];

// Impact feel. `trauma` (0..1) is added by explosions and decays over time;
// the actual shake is trauma², so small hits barely nudge the screen while big
// or chained explosions really throw it around.
let trauma = 0;
let hitstop = 0;   // ticks the world freezes on a big impact
let flash = 0;     // white screen flash, 0..1
const MAX_SHAKE = 22;     // game pixels at full trauma
const MAX_TILT = 0.035;   // radians (~2°) at full trauma

const SPARK_COLORS = ['#ffffff', '#ffe08a', '#ffa040', '#ff5a3a'].map(packColor);
const SMOKE_COLOR = '#544c66';
const DUST_COLOR = '#7a4a36';

function spark(x, y, vx, vy) {
  return {
    kind: 'spark', x, y, vx, vy, life: randInt(15, 40),
    color: SPARK_COLORS[randInt(0, SPARK_COLORS.length - 1)], glow: Math.random() < 0.4,
  };
}

function smoke(x, y, r, { color = SMOKE_COLOR, vx = rand(-0.3, 0.3), vy = rand(-0.6, -0.2), drag = 0.99, alpha = 0.4 } = {}) {
  const life = randInt(60, 120);
  return { kind: 'smoke', x, y, vx, vy, r, color, drag, alpha, life, max: life };
}

function debris(idx, x, y, size, angle, speed) {
  return {
    kind: 'debris', idx, x, y, size,
    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: randInt(90, 150),
  };
}

// `struck` is the tank a shell hit directly, if any (for the metal clang).
function explode(x, y, radius, damage, struck = null) {
  // Bigger blasts throw dirt faster and higher.
  const power = Math.sqrt(radius / 20);

  // 1. Carve a crater and scorch its rim. Each material decides what the
  //    blast does to it: most break, boulders crack first, monoliths shrug it
  //    off. Some broken earth erupts upward as clods that land as terrain.
  const rim = radius + 4;
  const cracked = [];
  for (let dy = -rim; dy <= rim; dy++) {
    for (let dx = -rim; dx <= rim; dx++) {
      const d2 = dx * dx + dy * dy;
      if (d2 > rim * rim) continue;
      const px = x + dx, py = y + dy;
      if (px < 0 || px >= W || py < 0 || py >= H) continue;
      const i = py * W + px;
      const v = terrain[i];
      if (!v) continue;
      if (d2 > radius * radius) {
        // The rim: dirt gets charred, grass and roots burn away.
        if (!SOLID[v]) terrain[i] = 0;
        else if (SCORCHABLE[v] && Math.random() < 1 - (Math.sqrt(d2) - radius) / 4.5) {
          terrain[i] = Math.random() < 0.5 ? T.SCORCH : T.SCORCH_DARK;
        }
        continue;
      }
      const after = BLAST[v];
      if (after === v) continue;  // indestructible
      terrain[i] = after;
      if (after) {
        // Cracked, not broken: chip off a few stone flakes.
        cracked.push(i);
        if (Math.random() < 0.03) {
          const a = -Math.PI / 2 + rand(-1.2, 1.2), v0 = rand(1.5, 4);
          particles.push({ kind: 'shrapnel', x: px, y: py, vx: Math.cos(a) * v0, vy: Math.sin(a) * v0, life: randInt(40, 70), color: T_BASE[v] });
        }
        continue;
      }
      const rubble = RUBBLE[v];
      if (!rubble) continue;
      const roll = Math.random();
      if (roll < 0.06) {
        // Clods: a wide fan, leaning away from the blast centre.
        const a = -Math.PI / 2 + rand(-0.9, 0.9) + (dx / radius) * 0.4;
        const size = Math.random();
        particles.push(debris(rubble, px, py, size < 0.35 ? 1 : size < 0.75 ? 2 : size < 0.95 ? 3 : 4, a, rand(1.5, 5.5) * power));
      } else if (roll < 0.11) {
        // Geyser: a narrow, fast plume of dirt straight up.
        const a = -Math.PI / 2 + rand(-0.3, 0.3);
        particles.push(debris(rubble, px, py, randInt(1, 2), a, rand(4, 8) * power));
      }
    }
  }
  // Draw crack lines wandering through freshly cracked stone.
  for (let n = Math.min(8, Math.ceil(cracked.length / 40)); n > 0; n--) {
    const start = cracked[randInt(0, cracked.length - 1)];
    let cx = start % W, cy = Math.floor(start / W), a = rand(0, Math.PI * 2);
    for (let step = randInt(5, 12); step > 0; step--) {
      cx += Math.round(Math.cos(a));
      cy += Math.round(Math.sin(a));
      a += rand(-0.6, 0.6);
      const m = cx >= 0 && cx < W && cy >= 0 && cy < H ? terrain[cy * W + cx] : 0;
      if (m !== T.CRACKED_HI && m !== T.CRACKED && m !== T.CRACKED_LO) break;
      terrain[cy * W + cx] = T.CRACK;
    }
  }
  markDirty(x - rim, x + rim);

  // 2. Damage tanks: full damage near the centre, fading out at the edge.
  const reach = radius + 8;
  let struckDamage = 0;
  for (const t of tanks) {
    if (!t.alive) continue;
    const d = Math.hypot(t.x - x, t.y - 4 - y);
    if (d >= reach) continue;
    const dealt = Math.round(damage * clamp((reach - d) / (reach - 6), 0, 1));
    hurt(t, dealt);
    if (t === struck) struckDamage = dealt;
  }
  // Metal clang only for a direct hit; splash damage just gets the boom.
  if (struckDamage > 0) sfxTankHit(Math.min(1, struckDamage / 55));

  // 3. Fire, sparks, smoke and dust.
  explosions.push({ x, y, radius, age: 0, life: 28 });
  for (let i = 0; i < 14 + radius / 2; i++) {
    const a = rand(0, Math.PI * 2), v = rand(1, 4.5);
    particles.push(spark(x, y, Math.cos(a) * v, Math.sin(a) * v - 1.5));
  }
  for (let i = 0; i < 4 + radius / 4; i++) {
    particles.push(smoke(x + rand(-radius / 2, radius / 2), y + rand(-radius / 2, 0), rand(3, 6)));
  }
  // A column of dust shooting up out of the crater...
  for (let i = 0; i < 6 + radius / 3; i++) {
    particles.push(smoke(x + rand(-radius / 3, radius / 3), y - rand(0, radius / 2), rand(3, 7), {
      color: DUST_COLOR, vx: rand(-0.4, 0.4), vy: -rand(1, 3) * power, drag: 0.96, alpha: 0.55,
    }));
  }
  // ...and a ring of dust rolling out along the ground.
  for (let i = 0; i < 10 + radius / 2; i++) {
    const dir = Math.random() < 0.5 ? -1 : 1;
    particles.push(smoke(x + dir * rand(0, radius / 2), y + rand(-2, 4), rand(3, 6), {
      color: DUST_COLOR, vx: dir * rand(1.5, 4) * power, vy: -rand(0.1, 0.5), drag: 0.93, alpha: 0.5,
    }));
  }

  // 4. Impact: shake, freeze-frame, flash, boom.
  trauma = Math.min(1, trauma + radius / 40);
  hitstop = Math.max(hitstop, Math.round(radius / 7));
  flash = Math.max(flash, radius / 70);
  sfxBoom(radius);
}

function updateParticle(p) {
  p.life--;
  if (p.kind === 'smoke') {
    p.x += p.vx + wind * 0.02;
    p.y += p.vy;
    p.vx *= p.drag;
    p.vy *= p.drag;
    p.r += 0.05;
    return;
  }
  p.vy += 0.15;
  p.x += p.vx;
  p.y += p.vy;
  const ix = Math.round(p.x), iy = Math.round(p.y);
  if (ix < 0 || ix >= W || iy >= H) {
    p.life = 0;
  } else if ((p.kind === 'debris' || p.kind === 'shrapnel') && p.vy > 0 && solid(ix, iy + (p.size ?? 1) - 1)) {
    // A clod lands and becomes terrain again, so dirt piles up. Each clod
    // only removed one pixel from the crater, so it only puts one back —
    // otherwise repeated shots would slowly raise the battlefield.
    if (p.kind === 'debris') {
      const ty = iy + p.size - 2;
      if (ty >= 0 && !terrain[ty * W + ix]) terrain[ty * W + ix] = p.idx;
      markDirty(ix, ix);
    }
    p.life = 0;
  }
}

// ===== 7. Game flow =========================================================
// States: title -> aim -> flying -> resolving -> aim (next player) ... -> gameover

let state = 'title';
let tanks = [];
let current = 0;
let wind = 0;
let banner = null;
let resolveDelay = 0;
let ticks = 0;

// New sky, terrain and obstacles. Returns tank start positions (none on the
// title screen), which obstacles are kept away from.
function newScenery(players = 0) {
  buildBackdrop();
  buildClouds();
  generateTerrain();
  resetBackground();
  const xs = [];
  for (let i = 0; i < players; i++) {
    xs.push(findSpawnX(Math.round(clamp(W * (i + 0.5) / players + rand(-30, 30), 24, W - 25))));
  }
  placeObstacles(xs);
  return xs.sort(() => Math.random() - 0.5);  // shuffle who stands where
}

// Clears all transient effects, so nothing carries over between matches.
function resetEffects() {
  stopLoops();
  projectiles = [];
  explosions = [];
  particles = [];
  floaters = [];
  trauma = 0;
  hitstop = 0;
  flash = 0;
  banner = null;
}

function startGame(players) {
  const xs = newScenery(players);
  resetEffects();
  tanks = xs.map((x, i) => {
    const t = makeTank(i, x);
    t.y = surfaceY(t.x) - 1;
    t.tilt = clamp(groundSlope(t.x, t.y), -MAX_SLOPE, MAX_SLOPE);
    return t;
  });

  wind = randInt(-6, 6);
  current = randInt(0, players - 1);
  camera.x = clamp(tanks[current].x - VW / 2, 0, W - VW);
  beginTurn();
}

function beginTurn() {
  const t = tanks[current];
  camera.free = false;
  camera.impact = null;
  t.fuel = MOVE_FUEL;
  if (t.ammo[t.weapon] <= 0) t.weapon = 0;
  state = 'aim';
  banner = { text: t.title, color: t.color.body, age: 0, life: 90 };
  sfxBlip(880);
}

function nextTurn() {
  do current = (current + 1) % tanks.length; while (!tanks[current].alive);
  wind = clamp(wind + randInt(-3, 3), -10, 10);
  beginTurn();
}

function cycleWeapon(t, dir) {
  for (let i = 1; i <= WEAPONS.length; i++) {
    const next = (t.weapon + dir * i + WEAPONS.length * 2) % WEAPONS.length;
    if (t.ammo[next] > 0) {
      t.weapon = next;
      sfxBlip(520);
      return;
    }
  }
}

function updateAim() {
  const t = tanks[current];
  if (t.hp <= 0) {  // drove off a cliff and died
    state = 'resolving';
    return;
  }
  const before = t.angle;
  if (repeatKey('ArrowLeft')) t.angle = Math.min(180, t.angle + 1);
  if (repeatKey('ArrowRight')) t.angle = Math.max(0, t.angle - 1);
  if (t.angle !== before) {
    t.lastTurnTick = ticks;
    // One ratchet click per 2° so fast turning stays a crank, not a buzz.
    if (++t.cranks % 2 === 0) sfxCrank(t.cranks % 4 === 0);
  }
  if (repeatKey('ArrowUp')) t.power = Math.min(100, t.power + 1);
  if (repeatKey('ArrowDown')) t.power = Math.max(5, t.power - 1);
  if (pressed.has('KeyQ')) cycleWeapon(t, -1);
  if (pressed.has('KeyE')) cycleWeapon(t, 1);
  if (held.has('KeyA') && ticks % 2 === 0) tryMove(t, -1);
  if (held.has('KeyD') && ticks % 2 === 0) tryMove(t, 1);
  if (pressed.has('Space')) fire(t);
}

function updateResolving() {
  // Wait until everything that can still change the terrain or move a tank
  // has finished: shells, explosions, flying dirt, settling dirt, falling tanks.
  const busy = projectiles.length > 0 ||
    explosions.length > 0 ||
    particles.some(p => p.kind === 'debris') ||
    terrainSettling() ||
    tanks.some(t => t.falling || t.sliding || t.dying > 0);
  if (busy) {
    resolveDelay = 20;
    return;
  }

  // Destroyed tanks go critical, then blow up (see updateDying) — which can
  // damage, and chain into, other tanks.
  let died = false;
  for (const t of tanks) {
    if (t.alive && t.hp <= 0) {
      startDying(t);
      died = true;
    }
  }
  if (died) return;

  if (resolveDelay > 0) {
    resolveDelay--;
    return;
  }
  // Linger on where the shot landed before moving on.
  if (camera.impact && ticks - camera.impact.tick < IMPACT_LINGER) return;
  if (tanks.filter(t => t.alive).length <= 1) {
    state = 'gameover';
    return;
  }
  nextTurn();
}

function update() {
  ticks++;
  if (pressed.has('KeyM')) muted = !muted;

  // World simulation runs in every state, except during a hit-stop freeze.
  if (hitstop > 0) {
    hitstop--;
  } else {
    updateClouds();
    updateBackground();
    for (const p of projectiles) updateProjectile(p);
    projectiles = projectiles.filter(p => !p.dead);
    for (const p of particles) updateParticle(p);
    particles = particles.filter(p => p.life > 0);
    for (const e of explosions) e.age++;
    explosions = explosions.filter(e => e.age < e.life);
    for (const f of floaters) { f.y -= 0.4; f.life--; }
    floaters = floaters.filter(f => f.life > 0);
    for (let pass = 0; pass < 4; pass++) settleTerrain();
    for (const t of tanks) updateTank(t);
    if (banner && ++banner.age >= banner.life) banner = null;
  }
  // The shake keeps going through the freeze, which sells the impact.
  trauma = Math.max(0, trauma - 0.015);
  flash = Math.max(0, flash - 0.08);

  switch (state) {
    case 'title':
      for (const n of [2, 3, 4]) {
        if (pressed.has(`Digit${n}`) || pressed.has(`Numpad${n}`)) startGame(n);
      }
      break;
    case 'aim':
      updateAim();
      break;
    case 'flying':
      if (projectiles.length === 0) state = 'resolving';
      break;
    case 'resolving':
      updateResolving();
      break;
    case 'gameover':
      if (pressed.has('Enter')) goToTitle();
      break;
  }
  if (pressed.has('Escape') && state !== 'title') goToTitle();

  // Look around: Z/C or drag with the mouse. Aiming, driving or firing snaps
  // the camera back to the action.
  if (state === 'flying' || LOOK_RESET_KEYS.some(k => pressed.has(k))) camera.free = false;
  const look = (held.has('KeyC') ? 1 : 0) - (held.has('KeyZ') ? 1 : 0);
  if (look || dragDX) {
    camera.free = true;
    camera.x += look * 8 - dragDX;
    dragDX = 0;
  }
  updateCamera();

  // Engine rumbles while the active tank is driving (moves happen every 2 ticks).
  const driver = state === 'aim' ? tanks[current] : null;
  const driving = !!driver && ticks - driver.lastMoveTick < 5;
  setLoop('engine', driving, driving ? 52 + driver.lastClimb * 14 : 38);
  const turning = !!driver && ticks - driver.lastTurnTick < 3;
  setLoop('turret', turning, 72);  // 72 Hz motor hum, gear teeth at 24 Hz

  endInputTick();
}

function goToTitle() {
  state = 'title';
  tanks = [];
  resetEffects();
  newScenery();
}

// --- Camera ---
// Follows the action: your tank while aiming, the shell in flight, then where
// it landed until the next turn, which then pans over to the next player.
// On the title screen it drifts slowly across the battlefield.

const camera = { x: 0, free: false, impact: null };  // impact: where the last shot landed
const IMPACT_LINGER = 90;  // ticks to hold on the impact before the next turn (1.5 s)
const LOOK_RESET_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space'];

function cameraFocus() {
  if (state === 'title') return W / 2 + Math.sin(ticks * 0.004) * (W - VW) / 2;
  const shell = projectiles.find(p => p.tracked) ?? projectiles[0];
  if (shell) return shell.x;
  const dying = tanks.find(t => t.dying > 0);
  if (dying) return dying.x;
  if (explosions.length > 0) return explosions[explosions.length - 1].x;
  if (camera.impact) return camera.impact.x;
  return tanks[current]?.x ?? W / 2;
}

function updateCamera() {
  if (!camera.free) {
    const goal = cameraFocus() - VW / 2;
    camera.x += (goal - camera.x) * (projectiles.length > 0 ? 0.12 : 0.06);
  }
  camera.x = clamp(camera.x, 0, W - VW);
}

// ===== 8. Rendering =========================================================

const TRAIL_COLORS = ['#3a3442', '#7a3a4a', '#ff5a3a', '#ffa040', '#ffe08a'].map(packColor);
const SHELL_CORE = packColor('#ffffff');
const SHELL_EDGE = packColor('#ffe08a');

// Where the camera is this frame, snapped to whole pixels for crisp art.
let camX = 0;

// Takes world coordinates.
function putPixel(x, y, color) {
  x = Math.round(x) - camX;
  y = Math.round(y);
  if (x >= 0 && x < VW && y >= 0 && y < H) framePixels[y * VW + x] = color;
}

function blitLayer(layer) {
  const offset = Math.round(camX * layer.f);
  for (let y = layer.top; y < H; y++) {
    const row = y * layer.w + offset, out = y * VW;
    for (let x = 0; x < VW; x++) {
      const v = layer.data[row + x];
      if (v) framePixels[out + x] = v;
    }
  }
}

// Background layers, written straight into the pixel buffer, back to front.
function composeFrame() {
  framePixels.set(sky);

  for (const s of twinkles) {
    const b = Math.sin(ticks * s.speed + s.phase);
    if (b > -0.3) framePixels[s.i] = b > 0.5 ? STAR_BRIGHT : STAR_DIM;
  }

  blitLayer(farHills);
  drawBackgroundWar();
  blitLayer(nearHills);

  for (const c of clouds) {
    const cx = Math.round(c.x - camX * CLOUD_PARALLAX);
    if (cx >= VW || cx + c.w <= 0) continue;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0; x < c.w; x++) {
        const v = c.data[y * c.w + x];
        const sx = cx + x;
        if (v && sx >= 0 && sx < VW) framePixels[(c.y + y) * VW + sx] = v;
      }
    }
  }

  // Terrain, with edge lighting: lit from above-left, shadowed below-right.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < VW; x++) {
      const wx = camX + x;
      const i = y * W + wx;
      const v = terrain[i];
      if (!v) continue;
      let color;
      if (y === 0 || !terrain[i - W]) color = T_LIGHT[v];
      else if (y < H - 1 && !terrain[i + W]) color = T_DARK[v];
      else if (wx > 0 && !terrain[i - 1]) color = T_LIGHT[v];
      else if (wx < W - 1 && !terrain[i + 1]) color = T_DARK[v];
      else color = T_BASE[v];
      framePixels[y * VW + x] = color;
    }
  }

  for (const p of particles) {
    if (p.kind === 'spark') {
      putPixel(p.x, p.y, p.color);
    } else if (p.kind === 'shrapnel') {
      putPixel(p.x, p.y, p.color);
      putPixel(p.x + 1, p.y, p.color);
    } else if (p.kind === 'debris') {
      // Clods: lit top-left pixel, shaded bottom-right.
      const x = Math.round(p.x), y = Math.round(p.y), n = p.size;
      for (let dy = 0; dy < n; dy++) {
        for (let dx = 0; dx < n; dx++) {
          const c = n > 1 && dx + dy === 0 ? T_LIGHT[p.idx] : n > 1 && dx + dy === 2 * n - 2 ? T_DARK[p.idx] : T_BASE[p.idx];
          putPixel(x + dx, y + dy, c);
        }
      }
    }
  }

  for (const p of projectiles) {
    p.trail.forEach((q, k) => putPixel(q.x, q.y, TRAIL_COLORS[Math.floor((k / p.trail.length) * TRAIL_COLORS.length)]));
    putPixel(p.x - 1, p.y, SHELL_EDGE);
    putPixel(p.x + 1, p.y, SHELL_EDGE);
    putPixel(p.x, p.y - 1, SHELL_EDGE);
    putPixel(p.x, p.y + 1, SHELL_EDGE);
    putPixel(p.x, p.y, SHELL_CORE);
  }
}

function drawSmoke() {
  for (const p of particles) {
    if (p.kind !== 'smoke') continue;
    ctx.globalAlpha = p.alpha * (p.life / p.max);
    fillCircle(Math.round(p.x), Math.round(p.y), Math.round(p.r), p.color);
  }
  ctx.globalAlpha = 1;
}

function drawTank(t, active) {
  if (t.dying <= 0) {
    drawTankBody(t, active, t.alive ? t.color : WRECK_COLORS);
    return;
  }
  // Going critical: shake harder and flash white-hot more often near the end.
  const p = 1 - t.dying / DEATH_TICKS;
  const j = Math.round(p * 2);
  ctx.save();
  ctx.translate(randInt(-j, j), randInt(-j, j));
  drawTankBody(t, false, Math.random() < 0.15 + p * 0.5 ? HOT_COLORS : t.color);
  ctx.restore();
}

function drawTankBody(t, active, colors) {
  // Barrel: dark underside plus light top makes it 2px thick.
  const pivot = turretPivot(t);
  const px = Math.round(pivot.x), py = Math.round(pivot.y);
  const tip = barrelTip(t, t.angle, 11 - t.recoil);
  const bx = Math.round(tip.x), by = Math.round(tip.y);
  pixelLine(px, py + 1, bx, by + 1, t.alive ? '#5c566b' : '#26222e');
  pixelLine(px, py, bx, by, t.alive ? '#d8d4e6' : '#4a4252');

  // Hull: rotated pixel by pixel. For every screen pixel around the tank we
  // rotate back into sprite space and copy the nearest sprite pixel — this
  // keeps the art crisp with no gaps or blur.
  const palette = { h: colors.light, b: colors.body, d: colors.dark, t: '#2a2633', w: '#5c566b', l: '#8f88a0' };
  const wheels = ['w', 'l', 'w', 't'];
  const cos = Math.cos(t.tilt), sin = Math.sin(t.tilt);
  for (let dy = -12; dy <= 4; dy++) {
    for (let dx = -12; dx <= 12; dx++) {
      const rx = Math.round(dx * cos + dy * sin) + 8;
      const ry = Math.round(-dx * sin + dy * cos) + 8;
      if (rx < 0 || rx > 16 || ry < 0 || ry > 8) continue;
      const row = TANK_SPRITE[ry];
      const ch = row ? row[rx] : (rx === 0 || rx === 16 ? 't' : wheels[((rx + t.tread) % 4 + 4) % 4]);
      if (ch === '.') continue;
      ctx.fillStyle = palette[ch];
      ctx.fillRect(t.x + dx, t.y + dy, 1, 1);
    }
  }

  if (t.flash > 3) {
    const f = barrelTip(t, t.angle, 14);
    fillCircle(Math.round(f.x), Math.round(f.y), 2, '#ffe08a');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
  }

  if (!t.alive) return;

  // Name tag and health bar.
  drawText(t.name, t.x - Math.floor(textWidth(t.name) / 2), t.y - 28, t.color.body);
  ctx.fillStyle = INK;
  ctx.fillRect(t.x - 11, t.y - 18, 23, 5);
  ctx.fillStyle = '#3a3442';
  ctx.fillRect(t.x - 10, t.y - 17, 21, 3);
  ctx.fillStyle = t.hp > 50 ? '#3ee06a' : t.hp > 25 ? '#ffa040' : '#ff3b5c';
  ctx.fillRect(t.x - 10, t.y - 17, Math.ceil((21 * t.hp) / MAX_HP), 3);

  // Bobbing arrow over the active tank.
  if (active) {
    const ay = t.y - 40 + Math.round(Math.sin(ticks * 0.12) * 2);
    ctx.fillStyle = INK;
    for (let k = 0; k < 4; k++) ctx.fillRect(t.x - 3 + k, ay + k + 1, 7 - k * 2, 1);
    ctx.fillStyle = t.color.body;
    for (let k = 0; k < 4; k++) ctx.fillRect(t.x - 3 + k, ay + k, 7 - k * 2, 1);
  }
}

function drawExplosion(e) {
  const p = e.age / e.life;
  if (p < 0.5) {
    const ring = Math.round(e.radius * (0.7 + p * 1.6));
    ctx.globalAlpha = 1 - p * 2;
    fillRing(e.x, e.y, ring, ring - 2, '#fff1e8');
    ctx.globalAlpha = 1;
  }
  const r = p < 0.15 ? e.radius * (0.5 + (p / 0.15) * 0.5) : e.radius * (1 - (p - 0.15) / 0.85);
  if (r < 1) return;
  const outer = p < 0.1 ? '#ffffff' : p < 0.35 ? '#ffe08a' : p < 0.6 ? '#ffa040' : p < 0.8 ? '#ff5a3a' : '#7a3a4a';
  fillCircle(e.x, e.y, Math.round(r), outer);
  if (p < 0.6) fillCircle(e.x, e.y - Math.round(r * 0.1), Math.round(r * 0.6), p < 0.3 ? '#ffffff' : '#ffe08a');
}

function drawPanel(x, y, w, h) {
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = INK;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#3d2f6e';
  ctx.fillRect(x, y, w, 1);
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x, y, 1, h);
  ctx.fillRect(x + w - 1, y, 1, h);
}

// A meter whose fill shades from colour a to colour b along its length.
function drawBar(x, y, w, h, frac, a, b) {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#2a2448';
  ctx.fillRect(x, y, w, h);
  const filled = Math.round(w * frac);
  for (let i = 0; i < filled; i++) {
    ctx.fillStyle = mix(a, b, i / w);
    ctx.fillRect(x + i, y, 1, h);
  }
}

function drawHud() {
  const t = tanks[current];
  const w = WEAPONS[t.weapon];
  drawPanel(-1, -1, VW + 2, HUD_H + 1);

  let x = 6;
  const y = 5;
  x = drawText(t.title, x, y, t.color.body) + 14;
  x = drawText('ANGLE', x, y, DIM) + 6;
  x = drawText(`${t.angle}°`, x, y, WHITE) + 14;
  x = drawText('POWER', x, y, DIM) + 6;
  drawBar(x, y + 1, 60, 5, t.power / 100, '#ffd23b', '#ff3b5c');
  x = drawText(t.power, x + 64, y, WHITE) + 14;
  x = drawText(w.name, x, y, '#ffd23b') + 4;
  if (Number.isFinite(w.ammo)) {
    for (let k = 0; k < w.ammo; k++) {
      ctx.fillStyle = k < t.ammo[t.weapon] ? '#ffd23b' : '#3d2f6e';
      ctx.fillRect(x + k * 5, y + 2, 3, 3);
    }
    x += w.ammo * 5;
  }
  x += 14;
  x = drawText('FUEL', x, y, DIM) + 6;
  drawBar(x, y + 2, 30, 3, t.fuel / MOVE_FUEL, '#1f8a4a', '#3ee06a');

  // Wind: an arrow whose length shows strength.
  const windLabelX = VW - 6 - textWidth('10') - 46 - textWidth('WIND');
  drawText('WIND', windLabelX, y, DIM);
  const cx = windLabelX + textWidth('WIND') + 23;
  ctx.fillStyle = '#8fd3ff';
  if (wind === 0) {
    ctx.fillRect(cx - 1, y + 2, 3, 3);
  } else {
    const dir = Math.sign(wind), len = 2 + Math.abs(wind) * 2;
    const start = cx - dir * Math.floor(len / 2), end = start + dir * len;
    ctx.fillRect(Math.min(start, end), y + 3, len, 1);
    for (let k = 0; k < 3; k++) ctx.fillRect(end - dir * k, y + 3 - k, 1, k * 2 + 1);
  }
  drawText(Math.abs(wind), VW - 6 - textWidth(Math.abs(wind)), y, WHITE);
}

// --- Minimap: the whole battlefield at 1/8 scale, under the HUD ---
const MINI_SCALE = 8;
const MINI_W = W / MINI_SCALE, MINI_H = H / MINI_SCALE;
const MINI_X = 6, MINI_Y = HUD_H + 5;  // top-left, clear of the moon
const miniCanvas = document.createElement('canvas');
miniCanvas.width = MINI_W;
miniCanvas.height = MINI_H;
const miniCtx = miniCanvas.getContext('2d');
const miniImage = miniCtx.createImageData(MINI_W, MINI_H);
const miniPixels = new Uint32Array(miniImage.data.buffer);

let miniRefreshed = -99;

function drawMinimap() {
  // Terrain changes slowly; resample it a few times a second.
  if (ticks - miniRefreshed >= 6 || ticks < miniRefreshed) {
    miniRefreshed = ticks;
    for (let my = 0; my < MINI_H; my++) {
      for (let mx = 0; mx < MINI_W; mx++) {
        const v = terrain[(my * MINI_SCALE + 4) * W + mx * MINI_SCALE + 4];
        miniPixels[my * MINI_W + mx] = SOLID[v] ? T_BASE[v] : 0;
      }
    }
    miniCtx.putImageData(miniImage, 0, 0);
  }
  drawPanel(MINI_X - 2, MINI_Y - 2, MINI_W + 4, MINI_H + 4);
  ctx.drawImage(miniCanvas, MINI_X, MINI_Y);

  // The part of the battlefield on screen.
  const vx = MINI_X + Math.round(camX / MINI_SCALE), vw = VW / MINI_SCALE;
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = WHITE;
  ctx.fillRect(vx, MINI_Y, vw, 1);
  ctx.fillRect(vx, MINI_Y + MINI_H - 1, vw, 1);
  ctx.fillRect(vx, MINI_Y, 1, MINI_H);
  ctx.fillRect(vx + vw - 1, MINI_Y, 1, MINI_H);
  ctx.globalAlpha = 1;

  for (const t of tanks) {
    if (!t.alive) continue;
    if (t === tanks[current] && state === 'aim' && ticks % 30 < 10) continue;  // blink
    ctx.fillStyle = t.color.body;
    ctx.fillRect(MINI_X + Math.floor(t.x / MINI_SCALE) - 1, MINI_Y + Math.floor(t.y / MINI_SCALE) - 1, 3, 2);
  }
  ctx.fillStyle = '#ffe08a';
  for (const p of projectiles) {
    ctx.fillRect(MINI_X + Math.floor(p.x / MINI_SCALE), MINI_Y + Math.floor(p.y / MINI_SCALE), 1, 1);
  }
}

const TITLE_GRADIENT = ['#fff09a', '#ffd23b', '#ffb02e', '#ff8a24', '#ff6a2a', '#ff4d3a', '#e8344a'];

function drawTitle() {
  drawCentered('SHELLS', 48, TITLE_GRADIENT, 7, '#2a0f2a');
  drawCentered('TURN-BASED ARTILLERY', 110, '#e6e0ff', 2);
  if (Math.floor(ticks / 30) % 2 === 0) drawCentered('PRESS 2, 3 OR 4 TO START', 144, '#ffd23b', 2);

  drawPanel(200, 178, 240, 127);
  const controls = [
    ['LEFT/RIGHT', 'AIM'],
    ['UP/DOWN', 'POWER'],
    ['A/D', 'DRIVE'],
    ['Q/E', 'WEAPON'],
    ['SPACE', 'FIRE'],
    ['Z/C, DRAG', 'LOOK AROUND'],
    ['M / ESC', 'MUTE / MENU'],
  ];
  controls.forEach(([key, action], i) => {
    drawText(key, 220, 190 + i * 15, '#8fd3ff');
    drawText(action, 320, 190 + i * 15, WHITE);
  });
}

function drawBanner() {
  // Slides down with an ease-out, then flickers away.
  const e = Math.min(1, banner.age / 14);
  const y = Math.round(70 - 30 * (1 - e) ** 3);
  if (banner.life - banner.age < 14 && ticks % 4 < 2) return;
  drawCentered(banner.text, y, banner.color, 3);
}

// Glowing lights are drawn on the display canvas at full resolution with
// additive blending, so they bloom smoothly over the crisp pixel art.
const glowCache = new Map();

function glowSprite(color) {
  let c = glowCache.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, rgba(color, 1));
  grad.addColorStop(0.2, rgba(color, 0.6));
  grad.addColorStop(0.5, rgba(color, 0.18));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowCache.set(color, c);
  return c;
}

function collectLights() {
  // `screen: true` lights are fixed to the screen; the rest are in the world.
  const lights = [{ x: MOON.x, y: MOON.y, r: 140, color: '#9fb4ff', a: 0.14, screen: true }];
  if (state === 'title') lights.push({ x: VW / 2, y: 70, r: 170, color: '#ff8a24', a: 0.22, screen: true });
  backgroundLights(lights);
  for (const m of monoliths) {
    lights.push({ x: m.x, y: m.y, r: 34, color: '#5ff2ff', a: 0.22 + 0.1 * Math.sin(ticks * 0.05 + m.phase) });
  }
  for (const e of explosions) {
    const p = e.age / e.life;
    lights.push({ x: e.x, y: e.y, r: e.radius * 3.5, color: '#ffb347', a: (1 - p) ** 2 });
    if (p < 0.12) lights.push({ x: e.x, y: e.y, r: e.radius * 6, color: '#ffffff', a: 0.5 });
  }
  for (const p of projectiles) lights.push({ x: p.x, y: p.y, r: 16, color: '#ffb347', a: 0.8 });
  for (const p of particles) {
    if (p.kind === 'spark' && p.glow) lights.push({ x: p.x, y: p.y, r: 6, color: '#ffa040', a: Math.min(1, p.life / 20) });
  }
  for (const t of tanks) {
    if (!t.alive) lights.push({ x: t.x, y: t.y - 6, r: 22 + Math.random() * 6, color: '#ff7a2a', a: 0.35 });
    if (t.dying > 0) {
      const p = 1 - t.dying / DEATH_TICKS;
      lights.push({ x: t.x, y: t.y - 6, r: 18 + p * 30, color: '#ff7a2a', a: 0.3 + 0.6 * p * Math.random() });
      if (t.pop && t.pop.life > 0) lights.push({ x: t.pop.x, y: t.pop.y, r: 30, color: '#ffffff', a: t.pop.life / 5 });
    }
    if (t.flash > 0) {
      const f = barrelTip(t, t.angle, 14);
      lights.push({ x: f.x, y: f.y, r: 26, color: '#ffe08a', a: t.flash / 6 });
    }
  }
  if (state === 'gameover') {
    const winner = tanks.find(t => t.alive);
    if (winner) lights.push({ x: VW / 2, y: 170, r: 200, color: winner.color.body, a: 0.25, screen: true });
  }
  return lights;
}

function render() {
  // --- pixel-art layer ---
  camX = Math.round(camera.x);
  composeFrame();
  ctx.putImageData(frameImage, 0, 0);

  // World-space sprites, shifted by the camera.
  ctx.save();
  ctx.translate(-camX, 0);
  drawSmoke();
  if (state !== 'title') {
    const active = tanks[current];
    // Ghost of the active player's previous shot.
    if (state === 'aim') {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = active.color.light;
      for (const q of active.lastPath) ctx.fillRect(q.x, q.y, 1, 1);
      ctx.globalAlpha = 1;
    }
    for (const t of tanks) drawTank(t, t === active && state === 'aim');
    for (const e of explosions) drawExplosion(e);
    for (const f of floaters) {
      drawText(f.text, Math.round(f.x - textWidth(f.text, f.s) / 2), Math.round(f.y), f.color, f.s);
    }
  }
  ctx.restore();

  // Screen-space UI.
  if (state === 'title') {
    drawTitle();
  } else {
    drawHud();
    drawMinimap();
    if (banner) drawBanner();
    if (state === 'gameover') {
      const winner = tanks.find(t => t.alive);
      drawPanel(-1, 140, VW + 2, 84);
      drawCentered(winner ? `${winner.title} WINS!` : 'DRAW!', 154, winner ? winner.color.body : WHITE, 4);
      if (Math.floor(ticks / 30) % 2 === 0) drawCentered('PRESS ENTER', 196, WHITE, 2);
    }
  }
  if (muted) drawText('MUTED', VW - 6 - textWidth('MUTED'), H - 12, DIM);

  // --- display layer: scale up, add light, vignette ---
  // Shake is trauma², not pixel-snapped, plus a slight tilt for big hits.
  const s = view.scale;
  const jolt = trauma * trauma;
  const ox = view.x + rand(-1, 1) * MAX_SHAKE * jolt * s;
  const oy = view.y + rand(-1, 1) * MAX_SHAKE * jolt * s;
  const tilt = Math.sin(ticks * 0.9) * MAX_TILT * jolt;
  dctx.setTransform(1, 0, 0, 1, 0, 0);
  dctx.globalCompositeOperation = 'source-over';
  dctx.globalAlpha = 1;
  dctx.fillStyle = '#05050f';
  dctx.fillRect(0, 0, displayCanvas.width, displayCanvas.height);
  const cx = displayCanvas.width / 2, cy = displayCanvas.height / 2;
  dctx.translate(cx, cy);
  dctx.rotate(tilt);
  dctx.translate(-cx, -cy);
  dctx.imageSmoothingEnabled = false;
  dctx.drawImage(pix, ox, oy, VW * s, H * s);

  dctx.globalCompositeOperation = 'lighter';
  for (const l of collectLights()) {
    const lx = l.screen ? l.x : l.x - camX;
    if (lx + l.r < 0 || lx - l.r > VW) continue;  // off screen
    const r = l.r * s;
    dctx.globalAlpha = clamp(l.a, 0, 1);
    dctx.drawImage(glowSprite(l.color), ox + lx * s - r, oy + l.y * s - r, r * 2, r * 2);
  }
  if (flash > 0) {
    dctx.globalAlpha = flash * 0.5;
    dctx.fillStyle = '#fff4e0';
    dctx.fillRect(ox, oy, VW * s, H * s);
  }
  dctx.globalCompositeOperation = 'source-over';
  dctx.globalAlpha = 1;
  dctx.drawImage(vignette, ox, oy);
  dctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ===== 9. Main loop =========================================================
// Fixed timestep: physics always advances in 1/60 s steps no matter the
// monitor's refresh rate, so shots fly the same on every machine.

newScenery();

let lastTime = performance.now();
let accumulator = 0;

function loop(now) {
  accumulator += Math.min(now - lastTime, 250);
  lastTime = now;
  while (accumulator >= TICK_MS) {
    update();
    accumulator -= TICK_MS;
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
