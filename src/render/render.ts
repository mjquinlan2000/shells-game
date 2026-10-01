import { muted } from '../audio';
import { MAX_SHAKE, MAX_TILT } from '../combat/effects';
import { DIM, H, VW, WHITE } from '../config';
import { camera } from '../game/camera';
import { game } from '../game/state';
import { ctx, dctx, displayCanvas, frameImage, pix, view, vignette } from '../gfx/canvas';
import { drawCentered, drawText, textWidth } from '../gfx/font';
import { drawBanner, drawHud, drawPanel, drawTitle } from './hud';
import { collectLights, glowSprite } from './lights';
import { drawMinimap } from './minimap';
import { drawTank } from './tank';
import { composeFrame, drawExplosion, drawSmoke } from './world';
import { clamp, rand } from '../util/math';

// --- Main render loop: pixel-art layer, camera transform, display scaling, lights, vignette ---

// Where the camera is this frame, snapped to whole pixels for crisp art.
export let camX = 0;

export function render() {
  // --- pixel-art layer ---
  camX = Math.round(camera.x);
  composeFrame();
  ctx.putImageData(frameImage, 0, 0);

  // World-space sprites, shifted by the camera.
  ctx.save();
  ctx.translate(-camX, 0);
  drawSmoke();
  if (game.state !== 'title') {
    const active = game.tanks[game.current];
    // Ghost of the active player's previous shot.
    if (game.state === 'aim') {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = active.color.light;
      for (const q of active.lastPath) ctx.fillRect(q.x, q.y, 1, 1);
      ctx.globalAlpha = 1;
    }
    for (const t of game.tanks) drawTank(t, t === active && game.state === 'aim');
    for (const e of game.explosions) drawExplosion(e);
    for (const f of game.floaters) {
      drawText(f.text, Math.round(f.x - textWidth(f.text, f.s) / 2), Math.round(f.y), f.color, f.s);
    }
  }
  ctx.restore();

  // Screen-space UI.
  if (game.state === 'title') {
    drawTitle();
  } else {
    drawHud();
    drawMinimap();
    if (game.banner) drawBanner();
    if (game.state === 'gameover') {
      const winner = game.tanks.find(t => t.alive);
      drawPanel(-1, 140, VW + 2, 84);
      drawCentered(winner ? `${winner.title} WINS!` : 'DRAW!', 154, winner ? winner.color.body : WHITE, 4);
      if (Math.floor(game.ticks / 30) % 2 === 0) drawCentered('PRESS ENTER', 196, WHITE, 2);
    }
  }
  if (muted) drawText('MUTED', VW - 6 - textWidth('MUTED'), H - 12, DIM);

  // --- display layer: scale up, add light, vignette ---
  // Shake is trauma², not pixel-snapped, plus a slight tilt for big hits.
  const s = view.scale;
  const jolt = game.trauma * game.trauma;
  const ox = view.x + rand(-1, 1) * MAX_SHAKE * jolt * s;
  const oy = view.y + rand(-1, 1) * MAX_SHAKE * jolt * s;
  const tilt = Math.sin(game.ticks * 0.9) * MAX_TILT * jolt;
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
  if (game.flash > 0) {
    dctx.globalAlpha = game.flash * 0.5;
    dctx.fillStyle = '#fff4e0';
    dctx.fillRect(ox, oy, VW * s, H * s);
  }
  dctx.globalCompositeOperation = 'source-over';
  dctx.globalAlpha = 1;
  if (vignette) dctx.drawImage(vignette, ox, oy);
  dctx.setTransform(1, 0, 0, 1, 0, 0);
}
