import { H, HUD_H, VW, W, WHITE } from '../config';
import { game } from '../game/state';
import { ctx } from '../gfx/canvas';
import { drawPanel } from './hud';
import { camX } from './render';
import { SOLID, T_BASE, terrain } from '../world/terrain';

// --- Minimap: the whole battlefield at 1/8 scale, under the HUD ---
export const MINI_SCALE = 8;
export const MINI_W = W / MINI_SCALE, MINI_H = H / MINI_SCALE;
export const MINI_X = 6, MINI_Y = HUD_H + 5;  // top-left, clear of the moon
export const miniCanvas = document.createElement('canvas');
miniCanvas.width = MINI_W;
miniCanvas.height = MINI_H;
export const miniCtx = miniCanvas.getContext('2d')!; // 2D context always exists on a newly created canvas
export const miniImage = miniCtx.createImageData(MINI_W, MINI_H);
export const miniPixels = new Uint32Array(miniImage.data.buffer);

export let miniRefreshed = -99;

export function drawMinimap() {
  // Terrain changes slowly; resample it a few times a second.
  if (game.ticks - miniRefreshed >= 6 || game.ticks < miniRefreshed) {
    miniRefreshed = game.ticks;
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

  for (const t of game.tanks) {
    if (!t.alive) continue;
    if (t === game.tanks[game.current] && game.state === 'aim' && game.ticks % 30 < 10) continue;  // blink
    ctx.fillStyle = t.color.body;
    ctx.fillRect(MINI_X + Math.floor(t.x / MINI_SCALE) - 1, MINI_Y + Math.floor(t.y / MINI_SCALE) - 1, 3, 2);
  }
  ctx.fillStyle = '#ffe08a';
  for (const p of game.projectiles) {
    ctx.fillRect(MINI_X + Math.floor(p.x / MINI_SCALE), MINI_Y + Math.floor(p.y / MINI_SCALE), 1, 1);
  }
}
