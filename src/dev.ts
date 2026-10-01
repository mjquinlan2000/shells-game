// ---------------------------------------------------------------------------
// Developer Cheat Menu (state & input handling).
//
// In dev builds (`npm run dev`), pressing '/' during a match opens an in-game
// menu allowing the developer or tester to grant weapons, replenish armor, or
// drop supply crates near their tank.
//
// Build-time gating:
// Every call site and action is guarded by `if (DEV)`. In production builds
// (`npm run build`), esbuild substitutes `DEV = false`, allowing tree-shaking
// and dead-code elimination to drop this entire module from the output bundle.
// ---------------------------------------------------------------------------

import { sfxBlip } from './audio';
import { dropCrate } from './combat/crates';
import type { Tank } from './combat/tanks';
import { ARMOR_PICKUP, MAX_ARMOR, W, WEAPONS } from './config';
import { game } from './game/state';
import { pressed, repeatKey } from './input';
import { clamp } from './util/math';

// Whether the cheat menu is currently displayed over the playfield.
export let devMenuOpen = false;

// The index of the currently highlighted row in `DEV_MENU_ITEMS`.
export let devMenuSelected = 0;

// Track the simulation tick when cursor navigation last occurred.
// `repeatKey` triggers every tick after 18 ticks of hold; throttling key repeats
// to every 8 ticks (~7.5 rows per second) keeps list scrolling controllable.
let lastDevNavTick = -999;

export interface DevMenuItem {
  name: string;
  color: string;
  // Dynamic string shown on the right side of the row (e.g. current ammo count).
  count?: (t: Tank) => string;
  // Apply this power-up or action to the specified tank.
  apply: (t: Tank) => void;
}

// Builds the full list of power-up actions available in the dev menu.
export function buildDevMenuItems(): DevMenuItem[] {
  const items: DevMenuItem[] = [];

  // 1. One row per finite weapon in WEAPONS (exclude unlimited ammo Infinity).
  for (let i = 0; i < WEAPONS.length; i++) {
    const w = WEAPONS[i];
    if (Number.isFinite(w.ammo)) {
      items.push({
        name: w.name,
        color: w.color,
        count: (t: Tank) => `x${t.ammo[i] ?? 0}`,
        apply: (t: Tank) => {
          t.ammo[i] = (t.ammo[i] ?? 0) + 1;
          t.weapon = i;
          sfxBlip(880);
          game.floaters.push({
            x: t.x,
            y: t.y - 30,
            text: `+1 ${w.name}`,
            color: w.color,
            life: 60,
            s: 1,
          });
        },
      });
    }
  }

  // 2. Armor top-ups.
  items.push({
    name: '+25 ARMOR',
    color: '#8fd3ff',
    count: (t: Tank) => `${t.armor}/${MAX_ARMOR}`,
    apply: (t: Tank) => {
      const before = t.armor;
      t.armor = Math.min(MAX_ARMOR, t.armor + ARMOR_PICKUP);
      const gained = t.armor - before;
      sfxBlip(880);
      game.floaters.push({
        x: t.x,
        y: t.y - 30,
        text: gained > 0 ? `+${gained} ARMOR` : 'ARMOR FULL',
        color: '#8fd3ff',
        life: 60,
        s: 1,
      });
    },
  });

  items.push({
    name: 'MAX ARMOR',
    color: '#8fd3ff',
    count: (t: Tank) => `${t.armor}/${MAX_ARMOR}`,
    apply: (t: Tank) => {
      t.armor = MAX_ARMOR;
      sfxBlip(880);
      game.floaters.push({
        x: t.x,
        y: t.y - 30,
        text: 'MAX ARMOR',
        color: '#8fd3ff',
        life: 60,
        s: 1,
      });
    },
  });

  // 3. Drop supply crates near the current player (approx 40 px toward center).
  items.push({
    name: 'DROP WEAPON CRATE',
    color: '#ffe08a',
    apply: (t: Tank) => {
      const towardCenter = t.x <= W / 2 ? 1 : -1;
      const dropX = clamp(Math.round(t.x + towardCenter * 40), 24, W - 24);
      dropCrate(dropX, 'weapon');
      sfxBlip(880);
      game.floaters.push({
        x: t.x,
        y: t.y - 30,
        text: 'WEAPON CRATE',
        color: '#ffe08a',
        life: 60,
        s: 1,
      });
    },
  });

  items.push({
    name: 'DROP ARMOR CRATE',
    color: '#8fd3ff',
    apply: (t: Tank) => {
      const towardCenter = t.x <= W / 2 ? 1 : -1;
      const dropX = clamp(Math.round(t.x + towardCenter * 40), 24, W - 24);
      dropCrate(dropX, 'armor');
      sfxBlip(880);
      game.floaters.push({
        x: t.x,
        y: t.y - 30,
        text: 'ARMOR CRATE',
        color: '#8fd3ff',
        life: 60,
        s: 1,
      });
    },
  });

  // 4. Give at least 3 ammo to every finite weapon.
  items.push({
    name: 'ALL WEAPONS x3',
    color: '#ffd23b',
    apply: (t: Tank) => {
      for (let i = 0; i < WEAPONS.length; i++) {
        if (Number.isFinite(WEAPONS[i].ammo)) {
          t.ammo[i] = Math.max(t.ammo[i] ?? 0, 3);
        }
      }
      sfxBlip(880);
      game.floaters.push({
        x: t.x,
        y: t.y - 30,
        text: 'ALL WEAPONS x3',
        color: '#ffd23b',
        life: 60,
        s: 1,
      });
    },
  });

  return items;
}

// `@__PURE__` tells esbuild this call has no side effects, so production
// builds (where nothing reads DEV_MENU_ITEMS) can drop the whole module.
export const DEV_MENU_ITEMS: DevMenuItem[] = /* @__PURE__ */ buildDevMenuItems();

export function closeDevMenu(): void {
  devMenuOpen = false;
}
// Called each tick during `aim` state from `flow.ts`.
// Returns `true` if the dev menu is active, signaling to the caller that
// `updateAim()` must NOT run (so tank controls are ignored).
export function updateDevMenu(): boolean {
  if (!DEV) return false;

  // The menu must close automatically if the match leaves the aiming phase
  // (e.g. shot fired, turn resolving, or sudden death).
  if (game.state !== 'aim') {
    devMenuOpen = false;
    return false;
  }

  // Pressing '/' toggles the menu during aim.
  if (pressed.has('Slash')) {
    pressed.delete('Slash');
    devMenuOpen = !devMenuOpen;
    if (devMenuOpen) sfxBlip(660);
    return true; // suppress aim update on the toggle frame
  }

  // If the menu is closed, let the game handle normal aiming input.
  if (!devMenuOpen) return false;

  // Intercept Escape: closes the cheat menu without abandoning the match.
  // We delete 'Escape' from `pressed` so flow's goToTitle() handler won't fire.
  if (pressed.has('Escape')) {
    pressed.delete('Escape');
    devMenuOpen = false;
    return true;
  }

  const items = DEV_MENU_ITEMS;
  const now = game.ticks;

  // Navigate rows with up/down arrows (repeatKey allows smooth scrolling when held).
  if (pressed.has('ArrowUp') || (repeatKey('ArrowUp') && now - lastDevNavTick >= 8)) {
    pressed.delete('ArrowUp');
    devMenuSelected = (devMenuSelected - 1 + items.length) % items.length;
    lastDevNavTick = now;
  } else if (pressed.has('ArrowDown') || (repeatKey('ArrowDown') && now - lastDevNavTick >= 8)) {
    pressed.delete('ArrowDown');
    devMenuSelected = (devMenuSelected + 1) % items.length;
    lastDevNavTick = now;
  }

  // Apply selected item to current player's tank using Enter or Space.
  // The menu stays open so multiple items/ammo can be added consecutively.
  if (pressed.has('Enter') || pressed.has('Space')) {
    pressed.delete('Enter');
    pressed.delete('Space');
    const t = game.tanks[game.current];
    if (t) {
      items[devMenuSelected]?.apply(t);
    }
  }

  return true;
}
