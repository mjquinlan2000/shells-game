import { DEG, rand } from './util/math';

// --- Audio synthesis ---
// Everything is synthesized with the Web Audio API — no sound files needed.

export let audioCtx: AudioContext | null = null;
export let master: DynamicsCompressorNode | null = null; // compressor everything plays through: loud but no clipping
export let noiseBuffer: AudioBuffer | null = null;
export let crunchCurve: Float32Array<ArrayBuffer> | null = null; // wave-shaper curve for distortion
export let muted = false;

export function toggleMute(): void {
  muted = !muted;
}

export function audio(): AudioContext | null {
  if (muted) return null;
  let ctx = audioCtx;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = ((3 + 40) * x * 20 * DEG) / (Math.PI + 40 * Math.abs(x));
    }
    audioCtx = ctx;
    master = comp;
    noiseBuffer = nb;
    crunchCurve = curve;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function tone(type: OscillatorType, from: number, to: number, duration: number, volume: number): void {
  const a = audio();
  if (!a || !master) return;
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

export const sfxFire = (): void => tone('square', 320, 60, 0.2, 0.12);
export const sfxBlip = (freq = 660): void => tone('square', freq, freq, 0.05, 0.06);

export function sfxBoom(size: number): void {
  const a = audio();
  if (!a || !master) return;
  tone('sine', 110, 28, 0.4 + size * 0.01, 0.45); // sub-bass thump you feel
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
export function sfxTankHit(strength: number): void {
  const a = audio();
  if (!a || !master) return;
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

export type LoopTune = (pitch: number, t: number) => void;

export interface LoopSoundSpec {
  volume: number;
  build: (a: AudioContext, out: GainNode) => LoopTune;
}

export interface LoopInstance {
  gain: GainNode;
  tune: LoopTune;
  key: string;
}

// Looping machine sounds, faded in and out. Each builds its own little synth
// once and returns a function that retunes it; only touched on state changes.
export const LOOP_SOUNDS = {
  // Engine: a gritty rumble from two detuned oscillators, pitching up on climbs.
  engine: {
    volume: 0.16,
    build(a: AudioContext, out: GainNode): LoopTune {
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
      return (pitch: number, t: number) => {
        low.frequency.setTargetAtTime(pitch, t, 0.08);
        high.frequency.setTargetAtTime(pitch * 1.51, t, 0.08); // a rough fifth: gritty
      };
    },
  },
  // Turret: a geared motor — a low buzzing hum plus gear teeth chattering,
  // made by switching filtered noise on and off ~24 times a second.
  turret: {
    volume: 0.12,
    build(a: AudioContext, out: GainNode): LoopTune {
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
      teeth.gain.value = 0.5; // the gate below swings this between 0 and 1
      const gate = a.createOscillator();
      gate.type = 'square';
      const gateDepth = a.createGain();
      gateDepth.gain.value = 0.5;
      gate.connect(gateDepth).connect(teeth.gain);
      noise.connect(teethFilter).connect(teeth).connect(out);
      noise.start();
      gate.start();
      return (pitch: number, t: number) => {
        motor.frequency.setTargetAtTime(pitch, t, 0.05);
        gate.frequency.setTargetAtTime(pitch / 3, t, 0.05);
      };
    },
  },
} satisfies Record<string, LoopSoundSpec>;

export type LoopName = keyof typeof LOOP_SOUNDS;

export const loops: Record<string, LoopInstance | undefined> = {};

export function setLoop(name: LoopName, on: boolean, pitch: number): void {
  if (!audioCtx && !on) return;
  const a = audio();
  const loop = loops[name];
  if (!a) {
    if (loop && audioCtx) {
      loop.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.05); // muted
      loop.key = '';
    }
    return;
  }
  const spec = LOOP_SOUNDS[name];
  if (!loop) {
    if (!master) return;
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
export function sfxCrank(high: boolean): void {
  const a = audio();
  if (!a || !master) return;
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
export function sfxClank(): void {
  const a = audio();
  if (!a || !master) return;
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
export function stopLoops(): void {
  if (!audioCtx) return;
  for (const loop of Object.values(loops)) {
    if (!loop) continue;
    loop.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.03);
    loop.key = '';
  }
}

// A far-off explosion: muffled and quiet. (The delay before it's heard is
// counted in game ticks by the background war, so resets cancel it.)
export function sfxDistantBoom(size: number): void {
  const a = audio();
  if (!a || !master) return;
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

// Bright rising chime for collecting a supply crate. Everything starts at
// once (a quick upward sweep over a major chord) rather than as delayed
// notes: audio delays must be counted in game ticks so resets cancel them,
// and a pickup is short enough not to need any.
export function sfxPickup(): void {
  tone('triangle', 523.25, 1046.5, 0.18, 0.12);  // C5 sweeping up an octave
  tone('triangle', 659.25, 659.25, 0.22, 0.07);  // E5
  tone('triangle', 783.99, 783.99, 0.26, 0.06);  // G5
}

// High-energy laser beam zap.
export function sfxLaser(): void {
  tone('sawtooth', 960, 120, 0.26, 0.16);
  tone('square', 480, 80, 0.2, 0.1);
  const a = audio();
  if (!a || !master || !noiseBuffer) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2400, t);
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.25);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.24, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + 0.25);
}

// The nuke's roar and aftershocks last seconds, so they play through their
// own gain "bus" instead of straight into master. stopNukeAudio() fades those
// buses out, so going back to the title or starting a new match silences a
// roar that is still rolling (nothing may carry over between matches).
let nukeBuses: GainNode[] = [];

function nukeBus(a: AudioContext): GainNode {
  const bus = a.createGain();
  bus.connect(master!);
  nukeBuses.push(bus);
  return bus;
}

export function stopNukeAudio(): void {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  for (const bus of nukeBuses) {
    bus.gain.cancelScheduledValues(t);
    bus.gain.setTargetAtTime(0, t, 0.03);  // ~0.1 s fade, no click
  }
  nukeBuses = [];
}

// Nuclear detonation audio: a sharp supersonic crack, then a massive
// sub-bass roar swelling and rolling for ~4.5 s.
export function sfxNuke(): void {
  const a = audio();
  if (!a || !master || !noiseBuffer) return;
  const t = a.currentTime;
  const bus = nukeBus(a);

  // 1. Initial sharp acoustic crack (violent shock front snapping the air)
  const crackOsc = a.createOscillator();
  const crackGain = a.createGain();
  crackOsc.type = 'sawtooth';
  crackOsc.frequency.setValueAtTime(2400, t);
  crackOsc.frequency.exponentialRampToValueAtTime(140, t + 0.08);
  crackGain.gain.setValueAtTime(0.5, t);
  crackGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  crackOsc.connect(crackGain).connect(master);
  crackOsc.start(t);
  crackOsc.stop(t + 0.09);

  const crackNoise = a.createBufferSource();
  crackNoise.buffer = noiseBuffer;
  const crackFilter = a.createBiquadFilter();
  crackFilter.type = 'bandpass';
  crackFilter.frequency.setValueAtTime(3400, t);
  crackFilter.frequency.exponentialRampToValueAtTime(700, t + 0.12);
  crackFilter.Q.value = 1.4;
  const crackNoiseGain = a.createGain();
  crackNoiseGain.gain.setValueAtTime(0.65, t);
  crackNoiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
  crackNoise.connect(crackFilter).connect(crackNoiseGain).connect(master);
  crackNoise.start(t);
  crackNoise.stop(t + 0.14);

  // 2. Sub-bass roar swelling and rolling for ~4.5 s
  const sub = a.createOscillator();
  const subGain = a.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(65, t);
  sub.frequency.exponentialRampToValueAtTime(18, t + 4.5);
  subGain.gain.setValueAtTime(0.05, t);
  subGain.gain.linearRampToValueAtTime(0.8, t + 0.35); // swell
  subGain.gain.exponentialRampToValueAtTime(0.001, t + 4.8);
  sub.connect(subGain).connect(bus);
  sub.start(t);
  sub.stop(t + 4.8);

  // Gritty triangle giving heavy texture to the low roar
  const rumble = a.createOscillator();
  const rumbleGain = a.createGain();
  rumble.type = 'triangle';
  rumble.frequency.setValueAtTime(46, t);
  rumble.frequency.exponentialRampToValueAtTime(16, t + 3.8);
  rumbleGain.gain.setValueAtTime(0.05, t);
  rumbleGain.gain.linearRampToValueAtTime(0.45, t + 0.4);
  rumbleGain.gain.exponentialRampToValueAtTime(0.001, t + 4.0);
  rumble.connect(rumbleGain).connect(bus);
  rumble.start(t);
  rumble.stop(t + 4.0);

  // 3. Heavy rolling thunder noise swelling and rolling for ~4.5 s
  const roarNoise = a.createBufferSource();
  roarNoise.buffer = noiseBuffer;
  const roarFilter = a.createBiquadFilter();
  roarFilter.type = 'lowpass';
  roarFilter.frequency.setValueAtTime(450, t);
  roarFilter.frequency.exponentialRampToValueAtTime(36, t + 4.5);
  const roarGain = a.createGain();
  roarGain.gain.setValueAtTime(0.1, t);
  roarGain.gain.linearRampToValueAtTime(0.7, t + 0.45); // swell
  roarGain.gain.exponentialRampToValueAtTime(0.001, t + 4.8);
  roarNoise.connect(roarFilter).connect(roarGain).connect(bus);
  roarNoise.start(t);
  roarNoise.stop(t + 4.8);
}

// Delayed rumbling aftershock from distant atmospheric and terrain echoes.
// Driven in game ticks from updateWeapons() so resets cancel it cleanly.
export function sfxNukeAftershock(strength: number): void {
  const a = audio();
  if (!a || !master || !noiseBuffer) return;
  const t = a.currentTime;
  const bus = nukeBus(a);
  const duration = 1.6 * strength;

  // Deep low-frequency thud
  const sub = a.createOscillator();
  const subGain = a.createGain();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(42, t);
  sub.frequency.exponentialRampToValueAtTime(16, t + duration);
  subGain.gain.setValueAtTime(0.45 * strength, t);
  subGain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  sub.connect(subGain).connect(bus);
  sub.start(t);
  sub.stop(t + duration);

  // Rolling rumble noise
  const noise = a.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = a.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(260, t);
  filter.frequency.exponentialRampToValueAtTime(28, t + duration);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.45 * strength, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  noise.connect(filter).connect(gain).connect(bus);
  noise.start(t);
  noise.stop(t + duration);
}

// Falling bomb whistle for airstrike drops.
export function sfxWhistle(): void {
  tone('sine', 1600, 480, 0.35, 0.12);
}
