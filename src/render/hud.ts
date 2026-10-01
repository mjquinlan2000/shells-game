import { DIM, HUD_H, INK, MOVE_FUEL, VW, WEAPONS, WHITE } from '../config';
import { game } from '../game/state';
import { ctx } from '../gfx/canvas';
import { drawCentered, drawText, textWidth } from '../gfx/font';
import { mix } from '../util/color';

// --- HUD: status bar, meters, title screen, banners ---

export function drawPanel(x: number, y: number, w: number, h: number) {
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
export function drawBar(x: number, y: number, w: number, h: number, frac: number, a: string, b: string) {
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

export function drawHud() {
  const t = game.tanks[game.current];
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
  if (game.wind === 0) {
    ctx.fillRect(cx - 1, y + 2, 3, 3);
  } else {
    const dir = Math.sign(game.wind), len = 2 + Math.abs(game.wind) * 2;
    const start = cx - dir * Math.floor(len / 2), end = start + dir * len;
    ctx.fillRect(Math.min(start, end), y + 3, len, 1);
    for (let k = 0; k < 3; k++) ctx.fillRect(end - dir * k, y + 3 - k, 1, k * 2 + 1);
  }
  drawText(Math.abs(game.wind), VW - 6 - textWidth(Math.abs(game.wind)), y, WHITE);
}

export const TITLE_GRADIENT = ['#fff09a', '#ffd23b', '#ffb02e', '#ff8a24', '#ff6a2a', '#ff4d3a', '#e8344a'];

export function drawTitle() {
  drawCentered('SHELLS', 48, TITLE_GRADIENT, 7, '#2a0f2a');
  drawCentered('TURN-BASED ARTILLERY', 110, '#e6e0ff', 2);
  if (Math.floor(game.ticks / 30) % 2 === 0) drawCentered('PRESS 2, 3 OR 4 TO START', 144, '#ffd23b', 2);

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

export function drawBanner() {
  const banner = game.banner;
  if (!banner) return;
  // Slides down with an ease-out, then flickers away.
  const e = Math.min(1, banner.age / 14);
  const y = Math.round(70 - 30 * (1 - e) ** 3);
  if (banner.life - banner.age < 14 && game.ticks % 4 < 2) return;
  drawCentered(banner.text, y, banner.color, 3);
}
