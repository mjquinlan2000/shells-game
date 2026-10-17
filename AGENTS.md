# AGENTS.md

SHELLS: a turn-based 2D artillery game (Scorched Earth / Worms style) for the browser, with a "modern retro" look — crisp pixel art plus smooth high-resolution lighting. 2–4 players share one keyboard (hotseat).

The owner is new to game development. Keep code readable and commented for a learner; explain *why*, not just *what*.

## Running

The game is TypeScript in `src/`, bundled by esbuild into `dist/game.js` (one classic script, so `index.html` still works from `file://`). `tsc` only type-checks; it never emits.

- `npm install` once.
- `npm run dev` — serves the folder at http://localhost:8000 and rebuilds on every save (refresh the page to see changes).
- `npm run build` — writes `dist/game.js`; then `index.html` can be opened directly.
- `npm run typecheck` — `tsc` in strict mode. Run it before calling a change done; esbuild strips types without checking them.

`dist/` and `node_modules/` are git-ignored.

## Files

| Path | Contents |
|---|---|
| `index.html` | Full-window `<canvas id="game">` and `<script src="dist/game.js">` |
| `src/main.ts` | Entry point: fixed-timestep main loop, plus `export *` of every module for the console |
| `src/config.ts` | Tuning constants, `WEAPONS` (with `kind`, crate `drop` weights), `MAX_ARMOR`, player colours |
| `src/util/` | `math.ts` (`rand`, `clamp`, `Point`), `color.ts` (`packColor`, `mix`, `bayer` dithering) |
| `src/gfx/` | `canvas.ts` (pixel + display canvases, `resize`), `draw.ts` (`fillCircle`, `fillRing`, `pixelLine`), `font.ts` (5×7 `FONT`, `drawText`) |
| `src/audio.ts` | Web Audio synthesis: one-shots, looping engine/turret sounds, mute |
| `src/input.ts` | Keyboard (`pressed`, `held`, `repeatKey`) and mouse drag (`takeDrag`) |
| `src/world/` | `backdrop.ts` (sky, moon, parallax hills), `clouds.ts`, `background-war.ts` (`bg`), `terrain.ts` (materials, `terrain`, `solid`, settling), `obstacles.ts` |
| `src/combat/` | `tanks.ts` (`Tank`, movement, sliding, falling, armor in `hurt`), `death.ts` (dying sequence), `projectiles.ts` (`fire`, per-kind shells), `weapons.ts` (laser beam, airstrike bomber, nuke aftermath, sub-munitions), `crates.ts` (supply drops), `effects.ts` (`explode`, `explodeNuke`, particles, floaters) |
| `src/game/` | `state.ts` (the shared `game` object), `flow.ts` (turns, `update()`, win checks), `camera.ts` |
| `src/render/` | `render.ts` (`render()`, `camX`), `world.ts` (`composeFrame`, pixel-buffer drawing), `tank.ts`, `crates.ts`, `weapons.ts` (beams, bomber, shockwaves), `hud.ts` (corner panels, weapon tray, roster, title, banner), `minimap.ts`, `lights.ts` (`collectLights`, glow sprites) |

Each file owns one concern; put new code next to the system it belongs to rather than in `main.ts`. Interfaces live in the file that creates those objects (`Tank` in `tanks.ts`, `Particle` in `effects.ts`, `Light` in `lights.ts`, …).

### Shared state

An ES module may export a `let`, and importers always see its current value, but only the declaring file may assign it. So:

- Match state that several files reassign lives on the `game` object in `src/game/state.ts` (`game.state`, `game.tanks`, `game.current`, `game.wind`, `game.ticks`, `game.banner`, `game.projectiles`, `game.particles`, `game.explosions`, `game.floaters`, `game.trauma`, `game.hitstop`, `game.flash`).
- State owned by one system stays a module-level `let` and is changed through that module's functions (`toggleMute()`, `takeDrag()`, `markDirty()`, `buildClouds()`, …).

### Import cycles

Modules import each other freely (e.g. tanks ↔ effects); that's fine because cross-module calls happen at run time, not while modules load. Top-level code that runs at load (`packColor(...)` tables, `makeLayer`, `addEventListener`) may only use modules that don't import it back.

## Architecture

### Coordinates: world vs. screen

- `W` × `H` (1280 × 360) is the **world**: terrain, physics, tanks, projectiles, spawning.
- `VW` × `H` (640 × 360) is the **screen**: the pixel canvas, HUD, title, banners, minimap placement.
- `camera.x` scrolls the screen across the world. `camX` is that value rounded for the current frame.
- World sprites are drawn inside one `ctx.save(); ctx.translate(-camX, 0); … ctx.restore()` pass in `render()`. Direct framebuffer writes (`putPixel`, `composeFrame`) subtract `camX` themselves.
- Parallax layers (far hills `0.25`, background war jets `0.35`, clouds `0.4`, near hills `0.55`) use *layer space*: `screenX = layerX - camX * f`.
- Lights from `collectLights()` are in world coordinates unless marked `screen: true`.

When adding anything that is drawn, decide which space it lives in first. Using `W` where `VW` is meant (or the reverse) is the most likely bug in this codebase.

### Two-layer rendering

1. **Pixel layer** — `pix`, a `VW × H` offscreen canvas. Backgrounds, terrain and particles are written into the `framePixels` `Uint32Array` (colours from `packColor()`, little-endian ABGR) and pushed with `putImageData`. Sprites, text and UI go on top with integer-coordinate `fillRect`.
2. **Display layer** — `displayCanvas`, sized to the window at `devicePixelRatio`. The pixel layer is scaled up by an integer factor with `imageSmoothingEnabled = false`, then glows (additive `'lighter'` radial sprites from `glowSprite()`), the white flash and the vignette are drawn at full resolution. Screen shake and tilt are applied here, so they are smooth rather than pixel-snapped.

Pixel-art rules: integer coordinates only; no anti-aliased canvas strokes, arcs or `fillText` on `pix` (use `pixelLine`, `fillCircle`, `fillRing`, `drawText` with the hand-made 5×7 `FONT`); rotate sprites by inverse-mapping pixels (see `drawTankBody`), never with canvas transforms.

### Simulation

- Fixed timestep: `update()` runs at exactly 60 Hz from an accumulator in `loop()`; `render()` runs once per animation frame. All physics constants are per tick.
- `game.hitstop` freezes the world simulation for a few ticks on big impacts; trauma and flash keep decaying during the freeze.
- State machine: `title → aim → flying → resolving → aim (next player) … → gameover`. `updateResolving()` only advances when nothing can still change: its `busy` check covers projectiles, explosions, airborne `debris`, settling terrain, `weaponsBusy()` (laser beam, pending airstrike), `cratesBusy()` (crates in free fall), and falling / sliding / dying tanks. **Anything new that can alter terrain or move a tank must be added to that check**, or the next turn starts mid-motion. Two deliberate exceptions: parachuting crates are gameplay entities (a tank can collect one at any time) but drift too slowly to wait for, so they carry across turns; the nuke's mushroom cloud, rings, tint and fallout are purely decorative. To give the nuke its moment, its `camera.impact.tick` is dated `NUKE_LINGER` ticks into the future, a fixed extra pause before the next turn.
- After a shot, `camera.impact` holds the landing point; the next turn waits `IMPACT_LINGER` ticks after impact so the camera can rest there before panning to the next player.

### Weapons and crates

- `fire()` dispatches on `Weapon.kind`: `shell`, `cluster` (splits into bomblets at the top of its arc), `drill` (burrows, then explodes), `laser` (instant hitscan, 480 px, burns a channel), `airstrike` (marker, then a bomber drops 5 bombs), `nuke`. Sub-munitions (`BOMBLET_WEAPON`, `BOMB_WEAPON`) live in `weapons.ts`, not in `WEAPONS`, because `tank.ammo` parallels `WEAPONS`. Laser and drill tunnel with the `BORE` table (every `BLAST` stage at once, so boulders don't leave cracked plugs) and stop at indestructible material.
- Weapons with `ammo: 0` only come from crates. `maybeDropCrate()` runs on each turn change (50%, at most 3 on the field); a crate parachutes down at a random x. A tank collects it by touching it (driving, falling, or being landed on), by hitting it with a shell or laser, or by catching it in any explosion: `explode()` calls `collectCratesInBlast()`, which gives every crate the blast (plus its 4 px rim) overlaps to the current player, unless that player is dead or at 0 HP. Weapon crates pick by `drop` weight and add `pickup` shots; armor crates add `ARMOR_PICKUP` up to `MAX_ARMOR`. Armor absorbs damage before HP in `hurt()`.
- HUD: no top bar. Player card bottom-left, weapon tray bottom-centre (only weapons with ammo), aim/wind panel bottom-right, minimap top-left, turn roster top-right. Keep the bottom ~50 px and top ~55 px in mind when placing world features near the screen edges.
- Dev menu: `npm run dev` bundles with `DEV = true` (esbuild `--define`); during a match `/` opens a cheat menu to add any weapon, armor, or drop a crate next to the current player. `npm run build` sets `DEV = false`, so esbuild strips it. Guard dev-only code with `if (DEV)`.

### Terrain materials

`terrain` is a `Uint8Array` of material indices (0 = air). Materials are defined once in `MATERIAL_DEFS`, each with:

- `solid` — blocks shells and tanks (grass tufts, roots and vines are decoration: drawn, not solid)
- `loose` — falls when undermined (`settleTerrain`); boulders, monoliths and floating islands stay put
- `blast` — what an explosion turns it into: `'AIR'`, another material (boulders → cracked → air), or `'SELF'` (monoliths are indestructible)
- `rubble` — what it lands as when flung out as debris (`null` = none)
- `scorch` — whether a crater's rim chars it

Behaviour is read from the flat lookup tables (`SOLID`, `LOOSE`, `BLAST`, `RUBBLE`, `SCORCHABLE`, `T_BASE/T_LIGHT/T_DARK`). Add new ground types by adding a row, not by special-casing indices in physics code. Always test solidity with `solid(x, y)` / `SOLID[v]`, never `terrain[i] !== 0`.

### Invariants

- **Mass conservation:** each debris clod removed one pixel and deposits exactly one pixel when it lands. Explosions may only dig; never let landing debris add more terrain than was removed.
- **Sliding always ends:** a tank on ground steeper than `SLIDE_SLOPE` slides, but a slide step only counts if it moves the tank *down* (`slide()`), so tanks can't oscillate in pits and stall `updateResolving`.
- **Climbing:** only steep *uphill* moves are blocked (`MAX_SLOPE`); downhill is always allowed, so a tank can never be trapped on a crater wall.
- **Nothing carries over between matches:** `resetEffects()` clears projectiles, particles, shake, freeze, flash, banner and looping sounds; `resetBackground()` clears background-war entities and pending distant booms.
- **Decorative systems never affect gameplay:** clouds, parallax hills and the background war (`bg`) don't touch `terrain`, tanks or turn flow.

### Audio

Everything is synthesized with the Web Audio API; there are no audio files.

- All sound goes through `master` (a compressor) so stacked loud sounds don't clip.
- One-shots: `tone()`, `sfxBoom`, `sfxTankHit` (direct hits only — splash damage gets just the boom), `sfxCrank`, `sfxClank`, `sfxDistantBoom`.
- Loops (engine, turret motor) are built once in `LOOP_SOUNDS` and driven from `update()` via `setLoop(name, on, pitch)`, which only touches the audio graph when its state changes. `stopLoops()` must silence them on blur, tab hide and reset, because a backgrounded tab may stop calling `update()`.
- Delays are counted in game ticks (e.g. `bg.sounds`), not pre-scheduled in Web Audio or `setTimeout`, so resets cancel them.
- The owner found jet fly-by sounds annoying and had them removed — don't add ambient sounds for background jets.

## Tuning

Gameplay feel lives in `src/config.ts` (`GRAVITY`, `WIND_ACCEL`, `MAX_SPEED`, `MOVE_FUEL`, `MAX_ARMOR`, `ARMOR_PICKUP`, `WEAPONS`) plus a few named constants next to the systems they control: `MAX_SHAKE`, `MAX_TILT`, `DEATH_TICKS`, `MAX_SLOPE`, `SLIDE_SLOPE`, `IMPACT_LINGER`, crate drop odds in `maybeDropCrate()`, parallax factors, and spawn intervals in `updateBackground()`. Durations are in ticks (60 = 1 second). Obstacle, cloud and buried-rock counts scale with `W / VW`.

## Verifying changes

There is no test suite; verify with `npm run typecheck` plus running the game. The established workflow, using a headless browser:

1. `npm run build`, serve the folder (`python3 -m http.server 8137`) and open it in a dedicated headless Chromium, **not** the user's own browser.
2. Headless tabs throttle `requestAnimationFrame`, so wall-clock waits don't advance the game. Stop the real loop with `window.requestAnimationFrame = () => 0`, then drive it deterministically from page JS: call `SHELLS.update()` N times and `SHELLS.render()` once before each screenshot.
3. Everything exported is on `window.SHELLS`. Stage scenarios through it (`startGame(n)`, `fire(tank)`, `explode(x, y, r, dmg)`, `fillColumn(x, top)`, `bg.*`, `game.*`), assert on state (`game.state`, `game.tanks`, `camera.x`, `terrain` counts), and check `tab.errors()` is empty. Exported `let`s (e.g. `SHELLS.muted`, `SHELLS.camX`) are read-only from outside; change them through their module's functions.
4. For pixel-level checks, crop `SHELLS.pix` into a scaled canvas with smoothing off and inspect that image.
5. Audio can't be heard in headless runs; at least exercise the code path (unmuted, call the sfx function) to catch exceptions, and say that the sound itself was not verified.

Clean up servers and temp files afterwards.

## Controls (keep the title-screen list in `drawTitle()` in sync)

| Key | Action |
|---|---|
| 2 / 3 / 4 | Start with that many players |
| ← → | Aim (crank sound) |
| ↑ ↓ | Power |
| A / D | Drive (limited fuel per turn) |
| Q / E | Change weapon |
| Space | Fire |
| Z / C, mouse drag | Look around; any aim/drive/fire key snaps back |
| M | Mute |
| Esc | Back to title |
| Enter | (Game over) back to title |
| / | (Dev builds only) power-up cheat menu; Esc or / closes it |
