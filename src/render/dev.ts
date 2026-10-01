// ---------------------------------------------------------------------------
// Developer Cheat Menu (rendering).
//
// Draws the in-game developer menu and UI hint. Rendered in screen coordinates
// (VW x H = 640 x 360) onto the pixel canvas (`pix`) directly after the HUD.
//
// Rules respected:
//   - Pixel-art rules: all coordinates snapped to whole integers.
//   - Fits cleanly between the top minimap/roster and bottom HUD panels.
//   - Checks the 5x7 pixel font for arrow glyphs and falls back to text.
//   - Guarded by build-time `DEV` so production builds drop drawing code.
// ---------------------------------------------------------------------------

import { DIM, H, VW, WHITE } from '../config';
import { DEV_MENU_ITEMS, devMenuOpen, devMenuSelected } from '../dev';
import { game } from '../game/state';
import { ctx } from '../gfx/canvas';
import { FONT, drawText, textWidth } from '../gfx/font';
import { drawPanel } from './hud';

// Draws an unobtrusive dim '/ DEV' reminder under the roster at top-right
// while a player is aiming (the only phase where `/` opens the menu), so the
// developer remembers the hotkey.
export function drawDevHint(): void {
  if (!DEV || game.state !== 'aim') return;

  // The roster height depends on how many tanks are in the match.
  // We place our hint just below the roster panel, right-aligned to the margin.
  const rosterH = game.tanks.length > 0 ? game.tanks.length * 11 + 6 : 0;
  const hintY = 6 + rosterH + 4;
  const text = '/ DEV';
  const hintX = VW - 6 - textWidth(text);
  drawText(text, hintX, hintY, DIM);
}

// Draws the centered developer cheat menu panel over the battlefield when open.
export function drawDevMenu(): void {
  if (!DEV || !devMenuOpen) return;

  const currentTank = game.tanks[game.current];
  const items = DEV_MENU_ITEMS;

  // Center the panel in the 640x360 screen.
  // With 12 rows, a height of 176px places the menu between y=92 and y=268,
  // comfortably clear of both the top roster/minimap (<56px) and bottom HUD (>310px).
  const panelW = 224;
  const panelH = 176;
  const panelX = Math.round((VW - panelW) / 2);
  const panelY = Math.round((H - panelH) / 2);

  // Background box and subtle purple border
  drawPanel(panelX, panelY, panelW, panelH);

  // Menu header title
  const title = 'DEV: POWER-UPS';
  drawText(title, panelX + Math.round((panelW - textWidth(title)) / 2), panelY + 7, '#ffd23b');

  // Thin separator line below title
  ctx.fillStyle = '#3d2f6e';
  ctx.fillRect(panelX + 4, panelY + 18, panelW - 8, 1);

  // Rows of power-up options
  const rowStartX = panelX + 4;
  const rowW = panelW - 8;
  const rowsStartY = panelY + 23;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const rowY = rowsStartY + i * 11;
    const isSelected = i === devMenuSelected;

    if (isSelected) {
      // Highlighted background bar with subtle blink
      ctx.fillStyle = Math.floor(game.ticks / 15) % 2 === 0 ? '#3d2f6e' : '#281c4e';
      ctx.fillRect(rowStartX, rowY - 1, rowW, 11);

      // Blinking retro pointer arrow pointing at the active option
      if (Math.floor(game.ticks / 15) % 2 === 0) {
        drawText('>', rowStartX + 3, rowY, WHITE);
      }
    }

    // Power-up label in its weapon/item accent color
    drawText(item.name, rowStartX + 12, rowY, item.color);

    // Current quantity / status on the right side of the row
    if (currentTank && item.count) {
      const countStr = item.count(currentTank);
      drawText(countStr, rowStartX + rowW - textWidth(countStr) - 4, rowY, isSelected ? WHITE : item.color);
    }
  }

  // Thin separator line above footer
  ctx.fillStyle = '#3d2f6e';
  ctx.fillRect(panelX + 4, panelY + 158, panelW - 8, 1);

  // Footer controls hint: check font glyph availability for arrows, fall back to words if missing
  const hasArrowGlyphs = Boolean(FONT['↑'] && FONT['↓']);
  const footerHint = hasArrowGlyphs ? '↑↓ PICK  ENTER ADD  / CLOSE' : 'UP/DOWN PICK  ENTER ADD  / CLOSE';
  drawText(footerHint, panelX + Math.round((panelW - textWidth(footerHint)) / 2), panelY + 163, DIM);
}
