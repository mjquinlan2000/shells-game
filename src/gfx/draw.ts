import { ctx } from './canvas';

// --- Pixel-art drawing primitives ---

export function fillCircle(cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

// A pixel-perfect ring between radius `inner` and `outer`.
export function fillRing(cx: number, cy: number, outer: number, inner: number, color: string): void {
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
export function pixelLine(x0: number, y0: number, x1: number, y1: number, color: string): void {
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
