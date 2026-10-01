import { stopLoops } from './audio';
import { displayCanvas, view } from './gfx/canvas';

// --- Input handling ---
// `pressed` holds keys that went down since the last tick (one-shot actions);
// `held` maps keys that are down to how many ticks they've been held.

export const pressed: Set<string> = new Set();
export const held: Map<string, number> = new Map();
export const BLOCKED_KEYS: Record<string, true> = {
  ArrowLeft: true,
  ArrowRight: true,
  ArrowUp: true,
  ArrowDown: true,
  Space: true,
};

addEventListener('keydown', (e: KeyboardEvent) => {
  if (BLOCKED_KEYS[e.code]) e.preventDefault(); // stop the page scrolling
  if (e.repeat) return;
  pressed.add(e.code);
  held.set(e.code, 0);
});
addEventListener('keyup', (e: KeyboardEvent) => held.delete(e.code));
addEventListener('blur', () => {
  held.clear();
  stopLoops();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoops();
});
// Dragging with the mouse looks around the battlefield (converted from
// screen pixels to game pixels here, consumed by the camera each tick).
let dragging = false;
let dragDX = 0;
displayCanvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e: MouseEvent) => {
  if (dragging) dragDX += (e.movementX * (window.devicePixelRatio || 1)) / view.scale;
});
// Returns how far the mouse was dragged since the last call, then resets it.
export function takeDrag(): number {
  const dx = dragDX;
  dragDX = 0;
  return dx;
}

// True on the first press, then every tick once the key has been held a while.
export const repeatKey = (code: string): boolean => pressed.has(code) || (held.get(code) ?? 0) >= 18;

export function endInputTick(): void {
  pressed.clear();
  for (const [code, n] of held) held.set(code, n + 1);
}
