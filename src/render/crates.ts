import { crates } from '../combat/crates';
import { ctx } from '../gfx/canvas';
import { pixelLine } from '../gfx/draw';

// --- Supply Crate Rendering ---
// Crates are drawn in world space (~9x8 pixels) using string sprites.
// Weapon crates are wooden with a yellow ammo mark; armor crates are steel-blue
// with a heraldic shield emblem. Parachuting crates have a swaying pixel dome.

const WEAPON_PALETTE: Record<string, string> = {
  d: '#331c0e', // dark wood outline
  b: '#8c4e28', // wood planks
  h: '#c47d46', // highlighted wood
  c: '#5c566b', // metal corner braces
  Y: '#ffd23b', // bright yellow ammo mark
  y: '#d4961e', // dark yellow shading
};

const WEAPON_SPRITE = [
  'chhhhhhhc',
  'hbbbybbbd',
  'hbbdYdbbd',
  'hbbYYYbbd',
  'hbbbybbbd',
  'hbbdydbbd',
  'hbbbbbbbd',
  'cdddddddc',
];

const ARMOR_PALETTE: Record<string, string> = {
  d: '#1a2433', // dark steel outline
  b: '#46749e', // steel-blue body
  h: '#8ec4ec', // steel highlight
  m: '#2d5073', // darker steel blue
  S: '#ffffff', // bright shield crest
  s: '#5ca0d3', // shield blue interior
};

const ARMOR_SPRITE = [
  'dhhhhhhhd',
  'hbSSSSShd',
  'hbSsssShd',
  'hbbSsShbd',
  'hbbbShbbd',
  'hbbbbbbbd',
  'hmmmmmmmd',
  'ddddddddd',
];

// Draws all active crates in world space (caller has translated by -camX).
export function drawCrates(): void {
  for (const c of crates) {
    const cx = Math.round(c.x);
    const cy = Math.round(c.y);
    const left = cx - 4;
    const top = cy - 7;

    // Draw parachute if floating down
    if (c.parachute) {
      const swayOffset = Math.round(Math.sin(c.sway) * 4);
      const canopyX = cx + swayOffset;
      const canopyBottomY = cy - 18;

      // 3 suspension cords linking canopy base to crate top
      pixelLine(canopyX - 7, canopyBottomY, cx - 3, top, '#a09ab5');
      pixelLine(canopyX, canopyBottomY, cx, top, '#d8d4e6');
      pixelLine(canopyX + 7, canopyBottomY, cx + 3, top, '#a09ab5');

      // Parachute canopy dome (integer pixel rows)
      // Top cap
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(canopyX - 3, canopyBottomY - 6, 7, 1);

      // Row 1
      ctx.fillStyle = '#ff6b4a';
      ctx.fillRect(canopyX - 5, canopyBottomY - 5, 3, 1);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(canopyX - 2, canopyBottomY - 5, 5, 1);
      ctx.fillStyle = '#ff6b4a';
      ctx.fillRect(canopyX + 3, canopyBottomY - 5, 3, 1);

      // Row 2
      ctx.fillStyle = '#ff5a3a';
      ctx.fillRect(canopyX - 7, canopyBottomY - 4, 5, 1);
      ctx.fillStyle = '#f0ecfa';
      ctx.fillRect(canopyX - 2, canopyBottomY - 4, 5, 1);
      ctx.fillStyle = '#ff5a3a';
      ctx.fillRect(canopyX + 3, canopyBottomY - 4, 5, 1);

      // Rows 3-5 (full width dome body)
      for (let dy = -3; dy <= -1; dy++) {
        ctx.fillStyle = dy === -1 ? '#d94026' : '#ff5a3a';
        ctx.fillRect(canopyX - 8, canopyBottomY + dy, 6, 1);
        ctx.fillStyle = dy === -1 ? '#c8c2dc' : '#f0ecfa';
        ctx.fillRect(canopyX - 2, canopyBottomY + dy, 5, 1);
        ctx.fillStyle = dy === -1 ? '#d94026' : '#ff5a3a';
        ctx.fillRect(canopyX + 3, canopyBottomY + dy, 6, 1);
      }

      // Bottom scalloped rim
      ctx.fillStyle = '#2a2438';
      ctx.fillRect(canopyX - 8, canopyBottomY, 17, 1);
    }

    // Draw the 9x8 crate body
    const sprite = c.kind === 'weapon' ? WEAPON_SPRITE : ARMOR_SPRITE;
    const palette = c.kind === 'weapon' ? WEAPON_PALETTE : ARMOR_PALETTE;

    for (let ry = 0; ry < 8; ry++) {
      const row = sprite[ry];
      for (let rx = 0; rx < 9; rx++) {
        const char = row[rx];
        const color = palette[char];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(left + rx, top + ry, 1, 1);
        }
      }
    }
  }
}
