import { DEATH_TICKS, HOT_COLORS } from '../combat/death';
import { TANK_SPRITE, WRECK_COLORS, barrelTip, turretPivot, type Tank } from '../combat/tanks';
import { INK, MAX_HP, type TankColors } from '../config';
import { game } from '../game/state';
import { ctx } from '../gfx/canvas';
import { fillCircle, pixelLine } from '../gfx/draw';
import { drawText, textWidth } from '../gfx/font';
import { randInt } from '../util/math';

// --- Tank rendering: rotated hull sprite, barrel, health bar, player tag ---

export function drawTank(t: Tank, active: boolean) {
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

export function drawTankBody(t: Tank, active: boolean, colors: TankColors) {
  // Barrel: dark underside plus light top makes it 2px thick.
  const pivot = turretPivot(t);
  const px = Math.round(pivot.x), py = Math.round(pivot.y);
  const tip = barrelTip(t, t.angle, 11 - t.recoil);
  const bx = Math.round(tip.x), by = Math.round(tip.y);
  pixelLine(px, py + 1, bx, by + 1, t.alive ? '#5c566b' : '#26222e');
  pixelLine(px, py, bx, by, t.alive ? '#d8d4e6' : '#4a4252');
  // Dotted aim guide from the barrel tip, scaling with power.
  if (active && t.alive) {
    const angRad = (t.angle * Math.PI) / 180;
    const cosA = Math.cos(angRad), sinA = -Math.sin(angRad);
    const guideLen = Math.round((t.power / 100) * 50);
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = colors.light;
    for (let d = 3; d <= guideLen; d += 3) {
      ctx.fillRect(Math.round(tip.x + cosA * d), Math.round(tip.y + sinA * d), 1, 1);
    }
    ctx.restore();
  }

  // Hull: rotated pixel by pixel. For every screen pixel around the tank we
  // rotate back into sprite space and copy the nearest sprite pixel — this
  // keeps the art crisp with no gaps or blur.
  const palette: Record<string, string> = { h: colors.light, b: colors.body, d: colors.dark, t: '#2a2633', w: '#5c566b', l: '#8f88a0' };
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
  // Faint steel-blue shield outline and shimmer around the hull when armored.
  if (t.alive && t.armor > 0) {
    ctx.save();
    const shimmer = 0.35 + Math.sin(game.ticks * 0.15 + t.x) * 0.15;
    ctx.globalAlpha = shimmer;
    ctx.fillStyle = '#8fd3ff';
    const steps = 36;
    for (let i = 0; i < steps; i++) {
      const th = (i / steps) * Math.PI * 2;
      if (Math.sin(th * 5 + game.ticks * 0.1) < -0.3) continue;
      const ex = Math.round(Math.cos(th) * 14);
      const ey = Math.round(Math.sin(th) * 8);
      const wx = Math.round(t.x + ex * cos - ey * sin);
      const wy = Math.round(t.y - 4 + ex * sin + ey * cos);
      ctx.fillRect(wx, wy, 1, 1);
    }
    ctx.restore();
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
    const ay = t.y - 40 + Math.round(Math.sin(game.ticks * 0.12) * 2);
    ctx.fillStyle = INK;
    for (let k = 0; k < 4; k++) ctx.fillRect(t.x - 3 + k, ay + k + 1, 7 - k * 2, 1);
    ctx.fillStyle = t.color.body;
    for (let k = 0; k < 4; k++) ctx.fillRect(t.x - 3 + k, ay + k, 7 - k * 2, 1);
  }
}
