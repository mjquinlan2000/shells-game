import { H, VW } from '../config';

// --- Canvases & display ---

export interface View {
  scale: number;
  x: number;
  y: number;
}

export const displayCanvas = document.getElementById('game') as HTMLCanvasElement;
// 2D context is guaranteed to exist for standard HTMLCanvasElement
export const dctx = displayCanvas.getContext('2d')!;

export const pix = document.createElement('canvas');
pix.width = VW;
pix.height = H;
// 2D context is guaranteed to exist for standard HTMLCanvasElement
export const ctx = pix.getContext('2d')!;

// Backdrop, terrain and particles are written straight into this pixel buffer
// each frame; sprites and text are drawn on top with fillRect.
export const frameImage = ctx.createImageData(VW, H);
export const framePixels = new Uint32Array(frameImage.data.buffer);

// Where the pixel-art canvas lands on the display, in device pixels.
export const view: View = { scale: 1, x: 0, y: 0 };

// vignette is created in resize(), which is called immediately below on module load
export let vignette!: HTMLCanvasElement;

export function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  displayCanvas.width = Math.round(innerWidth * dpr);
  displayCanvas.height = Math.round(innerHeight * dpr);
  displayCanvas.style.width = `${innerWidth}px`;
  displayCanvas.style.height = `${innerHeight}px`;
  // Integer scaling keeps every game pixel exactly the same size.
  const fit = Math.min(displayCanvas.width / VW, displayCanvas.height / H);
  view.scale = fit >= 1 ? Math.floor(fit) : fit;
  view.x = Math.floor((displayCanvas.width - VW * view.scale) / 2);
  view.y = Math.floor((displayCanvas.height - H * view.scale) / 2);
  vignette = makeVignette(Math.round(VW * view.scale), Math.round(H * view.scale));
}

export function makeVignette(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // 2D context is guaranteed to exist for standard HTMLCanvasElement
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, 'rgba(5,3,15,0)');
  grad.addColorStop(1, 'rgba(5,3,15,0.6)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return c;
}

addEventListener('resize', resize);
resize();
