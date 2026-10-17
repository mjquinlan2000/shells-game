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
// Where things live (src/):
//   config.ts        — tweak numbers here to change how the game feels
//   util/            — maths and colour helpers
//   gfx/             — canvases, pixel drawing primitives, the 5x7 pixel font
//   audio.ts         — synthesized blips and booms (no audio files)
//   input.ts         — keyboard and mouse
//   world/           — backdrop, clouds, background war, terrain, obstacles
//   combat/          — tanks, death sequence, projectiles, special weapons, crates, explosions
//   game/            — shared match state, game flow (turns, wins), camera
//   render/          — drawing the world, tanks, HUD, minimap, lights
//   main.ts          — this file: the main loop
// ---------------------------------------------------------------------------

import { TICK_MS } from './config';
import { newScenery, update } from './game/flow';
import { ARENAS } from './world/arenas';
import { render } from './render/render';

// Fixed timestep: physics always advances in 1/60 s steps no matter the
// monitor's refresh rate, so shots fly the same on every machine.

newScenery(ARENAS[0]);

let lastTime = performance.now();
let accumulator = 0;

function loop(now: number) {
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

// Everything below is re-exported for the browser console: the bundle puts it
// on `window.SHELLS`, so you can poke at the game while it runs, e.g.
// `SHELLS.game.tanks`, `SHELLS.startGame(3)`, `SHELLS.explode(640, 200, 40, 0)`.
export * from './audio';
export * from './combat/crates';
export * from './combat/death';
export * from './combat/effects';
export * from './combat/projectiles';
export * from './combat/tanks';
export * from './combat/weapons';
export * from './config';
// (src/dev.ts and src/render/dev.ts are deliberately NOT re-exported: an
// export here would keep the dev menu in production bundles.)
export * from './game/camera';
export * from './game/flow';
export * from './game/state';
export * from './gfx/canvas';
export * from './gfx/draw';
export * from './gfx/font';
export * from './input';
export * from './render/crates';
export * from './render/hud';
export * from './render/lights';
export * from './render/minimap';
export * from './render/render';
export * from './render/tank';
export * from './render/weapons';
export * from './render/world';
export * from './util/color';
export * from './util/math';
export * from './world/arenas';
export * from './world/backdrop';
export * from './world/background-war';
export * from './world/clouds';
export * from './world/obstacles';
export * from './world/terrain';
