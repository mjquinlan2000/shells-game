import {
  DIM,
  H,
  INK,
  MAX_ARMOR,
  MAX_HP,
  MOVE_FUEL,
  VW,
  WEAPONS,
  WHITE,
  type Weapon,
} from '../config';
import type { Tank } from '../combat/tanks';
import { game } from '../game/state';
import { ctx } from '../gfx/canvas';
import { pixelLine } from '../gfx/draw';
import { drawCentered, drawText, textWidth } from '../gfx/font';
import { mix } from '../util/color';
import { clamp } from '../util/math';

// --- HUD: floating corner panels, meters, title screen, banners ---

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

// 9x9 pixel-art weapon icons (# = weapon color, * = white highlight, . = transparent)
const WEAPON_ICONS: Record<string, string[]> = {
  SHELL: [
    '....*....',
    '...*#*...',
    '..##*##..',
    '..##*##..',
    '..##*##..',
    '..##*##..',
    '..#####..',
    '..#####..',
    '.........',
  ],
  HEAVY: [
    '..*###*..',
    '.*#####*.',
    '.#######.',
    '.#######.',
    '.#######.',
    '..#####..',
    '..#.#.#..',
    '.##.#.##.',
    '.........',
  ],
  TRIPLE: [
    '..#.#.#..',
    '.*#*#*#*.',
    '.##*##*#.',
    '.##*##*#.',
    '..#.#.#..',
    '..#.#.#..',
    '.........',
    '.........',
    '.........',
  ],
  CLUSTER: [
    '..#...#..',
    '....*....',
    '..*#*#*..',
    '.##*#*##.',
    '..*#*#*..',
    '....*....',
    '..#...#..',
    '.........',
    '.........',
  ],
  DRILL: [
    '..#####..',
    '.#*#####.',
    '.###*###.',
    '..####*..',
    '..*###*..',
    '...##*...',
    '...*#*...',
    '....*....',
    '.........',
  ],
  LASER: [
    '....#....',
    '....#....',
    '....*....',
    '..#####..',
    '#***#***#',
    '..#####..',
    '....*....',
    '....#....',
    '....#....',
  ],
  AIRSTRIKE: [
    '....*....',
    '....#....',
    '...###...',
    '..#####..',
    '#########',
    '..#.#.#..',
    '....#....',
    '..##.##..',
    '.........',
  ],
  NUKE: [
    '..#####..',
    '.*#####*.',
    '.#######.',
    '..*###*..',
    '...*#*...',
    '....#....',
    '...###...',
    '..#####..',
    '.#######.',
  ],
};

function drawWeaponIcon(name: string, color: string, x: number, y: number) {
  const sprite = WEAPON_ICONS[name] || WEAPON_ICONS.SHELL;
  for (let r = 0; r < 9; r++) {
    const row = sprite[r];
    for (let c = 0; c < 9; c++) {
      const ch = row[c];
      if (ch === '#') {
        ctx.fillStyle = color;
        ctx.fillRect(x + c, y + r, 1, 1);
      } else if (ch === '*') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
  }
}

function drawInfinityGlyph(x: number, y: number, color: string) {
  // 7x3 pixel infinity glyph: .##.##. / #..#..# / .##.##.
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y, 2, 1);
  ctx.fillRect(x + 4, y, 2, 1);
  ctx.fillRect(x, y + 1, 1, 1);
  ctx.fillRect(x + 3, y + 1, 1, 1);
  ctx.fillRect(x + 6, y + 1, 1, 1);
  ctx.fillRect(x + 1, y + 2, 2, 1);
  ctx.fillRect(x + 4, y + 2, 2, 1);
}

// The tank whose turn the panels last slid in for. Tracking the tank object
// (not its index) means a new match always replays the slide, even when the
// same player index happens to start again.
let lastTurnTank: Tank | null = null;
let turnStartTick = -99;

function drawPlayerCard(slideY: number) {
  const t = game.tanks[game.current];
  if (!t) return;

  const hasArmor = t.armor > 0;
  const cardW = 120;
  const cardH = hasArmor ? 56 : 46;
  const cardX = 6;
  const cardY = H - cardH - 6 + slideY;

  drawPanel(cardX, cardY, cardW, cardH);

  // Left colour accent strip in player's body colour
  ctx.fillStyle = t.color.body;
  ctx.fillRect(cardX + 1, cardY + 1, 3, cardH - 2);

  // Player name/title
  drawText(t.title, cardX + 8, cardY + 4, t.color.body);

  // Low HP (<25) pulses bright red / white
  const lowHp = t.hp < 25;
  const hpPulse = lowHp && game.ticks % 16 < 8;
  const hpTextCol = hpPulse ? '#ff3b5c' : DIM;
  const hpValCol = hpPulse ? '#ffffff' : (t.hp > 50 ? '#3ee06a' : t.hp > 25 ? '#ffa040' : '#ff3b5c');

  // HP Bar (MAX_HP, red -> green)
  const hpY = cardY + 15;
  drawText('HP', cardX + 8, hpY, hpTextCol);
  const hpColA = hpPulse ? '#ffffff' : '#ff3b5c';
  const hpColB = hpPulse ? '#ff3b5c' : '#3ee06a';
  drawBar(cardX + 26, hpY + 1, 56, 5, clamp(t.hp / MAX_HP, 0, 1), hpColA, hpColB);
  drawText(Math.max(0, t.hp), cardX + 88, hpY, hpValCol);

  let nextY = hpY + 10;

  // ARMOR Bar (steel blue, /MAX_ARMOR), shown when t.armor > 0
  if (hasArmor) {
    drawText('ARM', cardX + 8, nextY, '#8fd3ff');
    drawBar(cardX + 28, nextY + 1, 54, 4, clamp(t.armor / MAX_ARMOR, 0, 1), '#2b507a', '#8fd3ff');
    drawText(t.armor, cardX + 88, nextY, '#8fd3ff');
    nextY += 10;
  }

  // FUEL Bar (/MOVE_FUEL)
  drawText('FUEL', cardX + 8, nextY, DIM);
  drawBar(cardX + 34, nextY + 1, 48, 4, clamp(t.fuel / MOVE_FUEL, 0, 1), '#1f8a4a', '#3ee06a');
  drawText(t.fuel, cardX + 88, nextY, WHITE);
}

function drawWeaponTray(slideY: number) {
  const t = game.tanks[game.current];
  if (!t) return;

  // Collect all weapons this tank has ammo for
  const available: { weapon: Weapon; index: number }[] = [];
  for (let i = 0; i < WEAPONS.length; i++) {
    if (t.ammo[i] > 0) available.push({ weapon: WEAPONS[i], index: i });
  }
  if (available.length === 0) return;

  const slotW = 18;
  const slotH = 22;
  const slotGap = 2;
  const slotsTotalW = available.length * slotW + (available.length - 1) * slotGap;
  const trayW = Math.max(96, slotsTotalW + 28);
  const trayH = 42;
  const trayX = Math.round((VW - trayW) / 2);
  const trayY = H - trayH - 6 + slideY;

  drawPanel(trayX, trayY, trayW, trayH);

  // Current weapon name above the tray slots
  const curWeapon = WEAPONS[t.weapon] || WEAPONS[0];
  const nameW = textWidth(curWeapon.name);
  drawText(curWeapon.name, Math.round(trayX + (trayW - nameW) / 2), trayY + 4, curWeapon.color);

  // Small Q / E hints at the tray ends
  drawText('Q', trayX + 4, trayY + 21, DIM);
  drawText('E', trayX + trayW - 9, trayY + 21, DIM);

  // Slots
  const slotsStartX = Math.round(trayX + (trayW - slotsTotalW) / 2);
  const slotY = trayY + 15;

  for (let s = 0; s < available.length; s++) {
    const { weapon: w, index: wIdx } = available[s];
    const sx = slotsStartX + s * (slotW + slotGap);
    const isSelected = wIdx === t.weapon;

    // Slot background
    ctx.fillStyle = isSelected ? '#1c1538' : '#100c22';
    ctx.fillRect(sx, slotY, slotW, slotH);

    // Slot frame
    ctx.fillStyle = isSelected ? w.color : '#2d2448';
    ctx.fillRect(sx, slotY, slotW, 1);
    ctx.fillRect(sx, slotY + slotH - 1, slotW, 1);
    ctx.fillRect(sx, slotY, 1, slotH);
    ctx.fillRect(sx + slotW - 1, slotY, 1, slotH);

    // Hand-drawn pixel icon
    drawWeaponIcon(w.name, w.color, sx + 5, slotY + 2);

    // Ammo count below icon
    if (t.ammo[wIdx] === Infinity) {
      drawInfinityGlyph(sx + 6, slotY + 15, isSelected ? w.color : WHITE);
    } else {
      const num = String(t.ammo[wIdx]);
      drawText(num, sx + Math.round((slotW - textWidth(num)) / 2), slotY + 13, isSelected ? w.color : WHITE);
    }
  }
}

function drawAimPanel(slideY: number) {
  const t = game.tanks[game.current];
  if (!t) return;

  const aimW = 124;
  const aimH = 50;
  const aimX = VW - aimW - 6;
  const aimY = H - aimH - 6 + slideY;

  drawPanel(aimX, aimY, aimW, aimH);

  // Row 1: ANGLE
  drawText('ANGLE', aimX + 8, aimY + 5, DIM);
  drawText(`${t.angle}°`, aimX + 50, aimY + 5, WHITE);

  // Row 2: POWER
  drawText('PWR', aimX + 8, aimY + 19, DIM);
  drawBar(aimX + 32, aimY + 20, 54, 5, clamp(t.power / 100, 0, 1), '#ffd23b', '#ff3b5c');
  drawText(t.power, aimX + 92, aimY + 19, WHITE);

  // Row 3: WIND
  drawText('WIND', aimX + 8, aimY + 33, DIM);
  const cx = aimX + 63;
  if (game.wind === 0) {
    ctx.fillStyle = '#8fd3ff';
    ctx.fillRect(cx - 1, aimY + 35, 3, 3);
  } else {
    const dir = Math.sign(game.wind);
    const len = Math.max(3, Math.round((Math.abs(game.wind) / 10) * 22));
    const start = cx - dir * Math.floor(len / 2);
    const end = start + dir * len;
    ctx.fillStyle = '#8fd3ff';
    ctx.fillRect(Math.min(start, end), aimY + 36, len, 1);
    for (let k = 0; k < 3; k++) ctx.fillRect(end - dir * k, aimY + 36 - k, 1, k * 2 + 1);
  }
  drawText(Math.abs(game.wind), aimX + 92, aimY + 33, WHITE);
}

export function drawTurnRoster() {
  if (game.tanks.length === 0) return;

  const rosterW = 88;
  const rosterH = game.tanks.length * 11 + 6;
  const rosterX = VW - rosterW - 6;
  const rosterY = 6;

  drawPanel(rosterX, rosterY, rosterW, rosterH);

  for (let i = 0; i < game.tanks.length; i++) {
    const t = game.tanks[i];
    const ry = rosterY + 4 + i * 11;

    // Current player blinking arrow
    if (i === game.current && (game.ticks % 20 < 13)) {
      ctx.fillStyle = t.color.body;
      ctx.fillRect(rosterX + 3, ry + 1, 1, 5);
      ctx.fillRect(rosterX + 4, ry + 2, 1, 3);
      ctx.fillRect(rosterX + 5, ry + 3, 1, 1);
    }

    // Player colour chip
    ctx.fillStyle = t.alive ? t.color.body : '#4a4252';
    ctx.fillRect(rosterX + 8, ry + 1, 4, 5);
    if (!t.alive) {
      pixelLine(rosterX + 7, ry, rosterX + 13, ry + 6, '#ff3b5c');
      pixelLine(rosterX + 7, ry + 6, rosterX + 13, ry, '#ff3b5c');
    }

    // Name (greyed and struck-through if dead)
    const nameCol = t.alive ? (i === game.current ? WHITE : DIM) : '#4a4252';
    drawText(t.name, rosterX + 15, ry, nameCol);
    if (!t.alive) {
      ctx.fillStyle = '#ff3b5c';
      ctx.fillRect(rosterX + 15, ry + 3, textWidth(t.name), 1);
    }

    // Tiny HP bar (+ armor tint if any)
    const barX = rosterX + 32;
    const barY = ry + 1;
    const barW = 50;
    const barH = 5;

    ctx.fillStyle = INK;
    ctx.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);
    ctx.fillStyle = '#221b38';
    ctx.fillRect(barX, barY, barW, barH);

    if (t.alive) {
      const hpW = Math.round(clamp(t.hp / MAX_HP, 0, 1) * barW);
      const hpCol = t.hp > 50 ? '#3ee06a' : t.hp > 25 ? '#ffa040' : '#ff3b5c';
      if (t.armor > 0) {
        const armW = Math.round(clamp(t.armor / MAX_ARMOR, 0, 1) * barW);
        ctx.fillStyle = '#8fd3ff';
        ctx.fillRect(barX, barY, armW, 2);
        ctx.fillStyle = hpCol;
        ctx.fillRect(barX, barY + 2, hpW, 3);
      } else {
        ctx.fillStyle = hpCol;
        ctx.fillRect(barX, barY, hpW, barH);
      }
    }
  }
}

export function drawHud() {
  const t = game.tanks[game.current];
  if (!t) return;

  if (t !== lastTurnTank) {
    lastTurnTank = t;
    turnStartTick = game.ticks;
  }

  // Subtle ease-in slide for the bottom panels at turn start (~14 ticks)
  const elapsed = Math.max(0, game.ticks - turnStartTick);
  const slideProgress = Math.min(1, elapsed / 14);
  const slideEase = 1 - Math.pow(1 - slideProgress, 3);
  const slideY = Math.round((1 - slideEase) * 32);

  drawPlayerCard(slideY);
  drawWeaponTray(slideY);
  drawAimPanel(slideY);
  drawTurnRoster();
}

export const TITLE_GRADIENT = ['#fff09a', '#ffd23b', '#ffb02e', '#ff8a24', '#ff6a2a', '#ff4d3a', '#e8344a'];

export function drawTitle() {
  drawCentered('SHELLS', 42, TITLE_GRADIENT, 7, '#2a0f2a');
  drawCentered('TURN-BASED ARTILLERY', 104, '#e6e0ff', 2);
  if (Math.floor(game.ticks / 30) % 2 === 0) drawCentered('PRESS 2, 3 OR 4 TO START', 136, '#ffd23b', 2);

  const controls = [
    ['LEFT/RIGHT', 'AIM'],
    ['UP/DOWN', 'POWER'],
    ['A/D', 'DRIVE'],
    ['Q/E', 'WEAPON'],
    ['SPACE', 'FIRE'],
    ['Z/C, DRAG', 'LOOK AROUND'],
    ['M / ESC', 'MUTE / MENU'],
  ];
  // Dev builds (`npm run dev`) also list the cheat menu key; production
  // builds compile this out, so their title screen is unchanged.
  if (DEV) controls.push(['/', 'DEV POWER-UPS']);
  // The panel grows by one row height per extra control.
  const extra = (controls.length - 7) * 14;
  drawPanel(190, 168, 260, 144 + extra);
  controls.forEach(([key, action], i) => {
    drawText(key, 206, 178 + i * 14, '#8fd3ff');
    drawText(action, 314, 178 + i * 14, WHITE);
  });

  // Divider line
  ctx.fillStyle = '#3d2f6e';
  ctx.fillRect(202, 280 + extra, 236, 1);

  // Short line explaining crates
  drawCentered('GRAB CRATES: DRIVE INTO OR SHOOT THEM', 288 + extra, '#ffd23b', 1);
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
