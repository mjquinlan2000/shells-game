import { VW, W } from '../config';
import { game } from './state';
import { clamp } from '../util/math';

// --- Camera ---
// Follows the action: your tank while aiming, the shell in flight, then where
// it landed until the next turn, which then pans over to the next player.
// On the title screen it drifts slowly across the battlefield.

export interface CameraImpact {
  x: number;
  tick: number;
}

export interface Camera {
  x: number;
  free: boolean;
  impact: CameraImpact | null;
}

export const camera: Camera = { x: 0, free: false, impact: null };  // impact: where the last shot landed
export const IMPACT_LINGER = 90;  // ticks to hold on the impact before the next turn (1.5 s)
export const LOOK_RESET_KEYS: string[] = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Space'];

export function cameraFocus() {
  if (game.state === 'title') return W / 2 + Math.sin(game.ticks * 0.004) * (W - VW) / 2;
  const shell = game.projectiles.find(p => p.tracked) ?? game.projectiles[0];
  if (shell) return shell.x;
  const dying = game.tanks.find(t => t.dying > 0);
  if (dying) return dying.x;
  if (game.explosions.length > 0) return game.explosions[game.explosions.length - 1].x;
  if (camera.impact) return camera.impact.x;
  return game.tanks[game.current]?.x ?? W / 2;
}

export function updateCamera() {
  if (!camera.free) {
    const goal = cameraFocus() - VW / 2;
    camera.x += (goal - camera.x) * (game.projectiles.length > 0 ? 0.12 : 0.06);
  }
  camera.x = clamp(camera.x, 0, W - VW);
}
