# AGENTS.md

SHELLS: a turn-based 2D artillery game (Scorched Earth / Worms style) for the browser, with a "modern retro" look — crisp pixel art plus smooth high-resolution lighting. 2–4 players share one keyboard (hotseat).

The owner is new to game development. Keep code readable and commented for a learner; explain *why*, not just *what*.

## Running

No build step, no dependencies, no package manager.

- Open `index.html` directly in a browser, or
- `python3 -m http.server 8000` and open http://localhost:8000

## Files

| File | Contents |
|---|---|
| `index.html` | Full-window `<canvas id="game">` and a classic `<script src="game.js">` |
| `game.js` | The entire game, split into numbered sections (see the header comment) |

`game.js` is a single classic script on purpose: it works from `file://` (ES modules would not) and every top-level function and variable is reachable from the browser console, which the test workflow below relies on. Keep it one file; find your way around with the `// ===== N.` section banners and `// ---` subsection banners.

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
- `hitstop` freezes the world simulation for a few ticks on big impacts; trauma and flash keep decaying during the freeze.
- State machine: `title → aim → flying → resolving → aim (next player) … → gameover`. `updateResolving()` only advances when nothing can still change: its `busy` check covers projectiles, explosions, airborne `debris`, settling terrain, and falling / sliding / dying tanks. **Anything new that can alter terrain or move a tank must be added to that check**, or the next turn starts mid-motion.
- After a shot, `camera.impact` holds the landing point; the next turn waits `IMPACT_LINGER` ticks after impact so the camera can rest there before panning to the next player.

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

Gameplay feel lives in section 1 (`GRAVITY`, `WIND_ACCEL`, `MAX_SPEED`, `MOVE_FUEL`, `WEAPONS`) plus a few named constants next to the systems they control: `MAX_SHAKE`, `MAX_TILT`, `DEATH_TICKS`, `MAX_SLOPE`, `SLIDE_SLOPE`, `IMPACT_LINGER`, parallax factors, and spawn intervals in `updateBackground()`. Durations are in ticks (60 = 1 second). Obstacle, cloud and buried-rock counts scale with `W / VW`.

## Verifying changes

There is no test suite; verify by running the game. The established workflow, using a headless browser:

1. Serve the folder (`python3 -m http.server 8137`) and open it in a dedicated headless Chromium, **not** the user's own browser.
2. Headless tabs throttle `requestAnimationFrame`, so wall-clock waits don't advance the game. Stop the real loop with `window.requestAnimationFrame = () => 0`, then drive it deterministically from page JS: call `update()` N times and `render()` once before each screenshot.
3. Stage scenarios directly through globals (`startGame(n)`, `fire(tank)`, `explode(x, y, r, dmg)`, `fillColumn(x, top)`, `bg.*`), assert on state (`state`, `tanks`, `camera.x`, `terrain` counts), and check `tab.errors()` is empty.
4. For pixel-level checks, crop `pix` into a scaled canvas with smoothing off and inspect that image.
5. Audio can't be heard in headless runs; at least exercise the code path (`muted = false`, call the sfx function) to catch exceptions, and say that the sound itself was not verified.

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
