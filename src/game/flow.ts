import { setLoop, sfxBlip, sfxCrank, stopLoops, toggleMute } from '../audio';
import { closeDevMenu, updateDevMenu } from '../dev';
import { startDying } from '../combat/death';
import { cratesBusy, maybeDropCrate, resetCrates, updateCrates } from '../combat/crates';
import { updateParticle } from '../combat/effects';
import { fire, updateProjectile } from '../combat/projectiles';
import { resetWeapons, updateWeapons, weaponsBusy } from '../combat/weapons';
import { MAX_SLOPE, findSpawnX, groundSlope, makeTank, tryMove, updateTank, type Tank } from '../combat/tanks';
import { MOVE_FUEL, VW, W, WEAPONS } from '../config';
import { IMPACT_LINGER, LOOK_RESET_KEYS, camera, updateCamera } from './camera';
import { game } from './state';
import { endInputTick, held, pressed, repeatKey, takeDrag } from '../input';
import { clamp, rand, randInt } from '../util/math';
import { ARENAS, type Arena } from '../world/arenas';
import { buildBackdrop } from '../world/backdrop';
import { resetBackground, updateBackground } from '../world/background-war';
import { buildClouds, updateClouds } from '../world/clouds';
import { placeObstacles } from '../world/obstacles';
import { generateTerrain, settleTerrain, surfaceY, terrainSettling } from '../world/terrain';

// Title battlefield selection: index 0..ARENAS.length-1 for a specific arena,
// or ARENAS.length for RANDOM (picks a fresh random battlefield at match start).
export let arenaChoice = 0;

export function previewArena(): Arena {
  return arenaChoice === ARENAS.length
    ? ARENAS[randInt(0, ARENAS.length - 1)]
    : ARENAS[arenaChoice];
}

export function getArenaChoiceInfo() {
  if (arenaChoice === ARENAS.length) {
    return {
      name: 'RANDOM',
      tagline: 'SURPRISE BATTLEFIELD EACH MATCH',
      counter: '?/12',
    };
  }
  const arena = ARENAS[arenaChoice];
  return {
    name: arena.name,
    tagline: arena.tagline,
    counter: `${arenaChoice + 1}/${ARENAS.length}`,
  };
}

// --- Game flow ---
// States: title -> aim -> flying -> resolving -> aim (next player) ... -> gameover

// New sky, terrain and obstacles. Returns tank start positions (none on the
// title screen), which obstacles are kept away from.
export function newScenery(arena: Arena, players = 0) {
  game.arena = arena;
  buildBackdrop(arena);
  buildClouds(arena);
  generateTerrain(arena);
  resetBackground();
  const xs: number[] = [];
  for (let i = 0; i < players; i++) {
    xs.push(findSpawnX(Math.round(clamp(W * (i + 0.5) / players + rand(-30, 30), 24, W - 25))));
  }
  placeObstacles(xs, arena);
  return xs.sort(() => Math.random() - 0.5);  // shuffle who stands where
}

// Clears all transient effects, so nothing carries over between matches.
export function resetEffects() {
  stopLoops();
  game.projectiles = [];
  game.explosions = [];
  game.particles = [];
  game.floaters = [];
  game.trauma = 0;
  game.hitstop = 0;
  game.flash = 0;
  game.banner = null;
  resetWeapons();
  resetCrates();
}

export function startGame(players: number) {
  if (DEV) closeDevMenu();
  const arena = arenaChoice === ARENAS.length
    ? ARENAS[randInt(0, ARENAS.length - 1)]
    : ARENAS[arenaChoice];
  const xs = newScenery(arena, players);
  resetEffects();
  game.tanks = xs.map((x, i) => {
    const t = makeTank(i, x);
    t.y = surfaceY(t.x) - 1;
    t.tilt = clamp(groundSlope(t.x, t.y), -MAX_SLOPE, MAX_SLOPE);
    return t;
  });

  game.wind = game.arena.wind === 0 ? 0 : randInt(-game.arena.wind, game.arena.wind);
  game.current = randInt(0, players - 1);
  camera.x = clamp(game.tanks[game.current].x - VW / 2, 0, W - VW);
  beginTurn();
}

export function beginTurn() {
  const t = game.tanks[game.current];
  camera.free = false;
  camera.impact = null;
  t.fuel = MOVE_FUEL;
  if (t.ammo[t.weapon] <= 0) t.weapon = 0;
  game.state = 'aim';
  game.banner = { text: t.title, color: t.color.body, age: 0, life: 90 };
  sfxBlip(880);
}

export function nextTurn() {
  do game.current = (game.current + 1) % game.tanks.length; while (!game.tanks[game.current].alive);
  game.wind = game.arena.wind === 0 ? 0 : clamp(game.wind + randInt(-3, 3), -game.arena.wind, game.arena.wind);
  maybeDropCrate();  // sometimes a supply crate parachutes in
  beginTurn();
}

export function cycleWeapon(t: Tank, dir: number) {
  for (let i = 1; i <= WEAPONS.length; i++) {
    const next = (t.weapon + dir * i + WEAPONS.length * 2) % WEAPONS.length;
    if (t.ammo[next] > 0) {
      t.weapon = next;
      sfxBlip(520);
      return;
    }
  }
}

export function updateAim() {
  const t = game.tanks[game.current];
  if (t.hp <= 0) {  // drove off a cliff and died
    game.state = 'resolving';
    return;
  }
  const before = t.angle;
  if (repeatKey('ArrowLeft')) t.angle = Math.min(180, t.angle + 1);
  if (repeatKey('ArrowRight')) t.angle = Math.max(0, t.angle - 1);
  if (t.angle !== before) {
    t.lastTurnTick = game.ticks;
    // One ratchet click per 2° so fast turning stays a crank, not a buzz.
    if (++t.cranks % 2 === 0) sfxCrank(t.cranks % 4 === 0);
  }
  if (repeatKey('ArrowUp')) t.power = Math.min(100, t.power + 1);
  if (repeatKey('ArrowDown')) t.power = Math.max(5, t.power - 1);
  if (pressed.has('KeyQ')) cycleWeapon(t, -1);
  if (pressed.has('KeyE')) cycleWeapon(t, 1);
  if (held.has('KeyA') && game.ticks % 2 === 0) tryMove(t, -1);
  if (held.has('KeyD') && game.ticks % 2 === 0) tryMove(t, 1);
  if (pressed.has('Space')) fire(t);
}

export function updateResolving() {
  // Wait until everything that can still change the terrain or move a tank
  // has finished: shells, explosions, flying dirt, settling dirt, falling
  // tanks, special weapons (laser beams, pending airstrikes) and crates in
  // free fall (they can land on a tank and be collected).
  const busy = game.projectiles.length > 0 ||
    game.explosions.length > 0 ||
    game.particles.some(p => p.kind === 'debris') ||
    terrainSettling() ||
    weaponsBusy() ||
    cratesBusy() ||
    game.tanks.some(t => t.falling || t.sliding || t.dying > 0);
  if (busy) {
    game.resolveDelay = 20;
    return;
  }

  // Destroyed tanks go critical, then blow up (see updateDying) — which can
  // damage, and chain into, other tanks.
  let died = false;
  for (const t of game.tanks) {
    if (t.alive && t.hp <= 0) {
      startDying(t);
      died = true;
    }
  }
  if (died) return;

  if (game.resolveDelay > 0) {
    game.resolveDelay--;
    return;
  }
  // Linger on where the shot landed before moving on.
  if (camera.impact && game.ticks - camera.impact.tick < IMPACT_LINGER) return;
  if (game.tanks.filter(t => t.alive).length <= 1) {
    game.state = 'gameover';
    return;
  }
  nextTurn();
}

export function update() {
  game.ticks++;
  if (pressed.has('KeyM')) toggleMute();

  // World simulation runs in every state, except during a hit-stop freeze.
  if (game.hitstop > 0) {
    game.hitstop--;
  } else {
    updateClouds();
    updateBackground();
    for (const p of game.projectiles) updateProjectile(p);
    game.projectiles = game.projectiles.filter(p => !p.dead);
    updateWeapons();
    for (const p of game.particles) updateParticle(p);
    game.particles = game.particles.filter(p => p.life > 0);
    for (const e of game.explosions) e.age++;
    game.explosions = game.explosions.filter(e => e.age < e.life);
    for (const f of game.floaters) { f.y -= 0.4; f.life--; }
    game.floaters = game.floaters.filter(f => f.life > 0);
    for (let pass = 0; pass < 4; pass++) settleTerrain();
    for (const t of game.tanks) updateTank(t);
    updateCrates();
    if (game.banner && ++game.banner.age >= game.banner.life) game.banner = null;
  }
  // The shake keeps going through the freeze, which sells the impact.
  game.trauma = Math.max(0, game.trauma - 0.015);
  game.flash = Math.max(0, game.flash - 0.08);

  switch (game.state) {
    case 'title': {
      let cycle = 0;
      if (pressed.has('ArrowLeft')) cycle--;
      if (pressed.has('ArrowRight')) cycle++;
      if (cycle !== 0) {
        const total = ARENAS.length + 1;
        arenaChoice = (arenaChoice + cycle + total) % total;
        sfxBlip();
        newScenery(previewArena());
      }
      for (const n of [2, 3, 4]) {
        if (pressed.has(`Digit${n}`) || pressed.has(`Numpad${n}`)) startGame(n);
      }
      break;
    }
    case 'aim':
      if (DEV && updateDevMenu()) {
        // Cheat menu is open: world simulates, but tank controls are suppressed.
      } else {
        updateAim();
      }
      break;
    case 'flying':
      if (DEV) closeDevMenu();
      if (game.projectiles.length === 0) game.state = 'resolving';
      break;
    case 'resolving':
      if (DEV) closeDevMenu();
      updateResolving();
      break;
    case 'gameover':
      if (DEV) closeDevMenu();
      if (pressed.has('Enter')) goToTitle();
      break;
  }
  if (pressed.has('Escape') && game.state !== 'title') goToTitle();

  // Look around: Z/C or drag with the mouse. Aiming, driving or firing snaps
  // the camera back to the action.
  if (game.state === 'flying' || LOOK_RESET_KEYS.some(k => pressed.has(k))) camera.free = false;
  const look = (held.has('KeyC') ? 1 : 0) - (held.has('KeyZ') ? 1 : 0);
  const drag = takeDrag();
  if (look || drag) {
    camera.free = true;
    camera.x += look * 8 - drag;
  }
  updateCamera();

  // Engine rumbles while the active tank is driving (moves happen every 2 ticks).
  const driver = game.state === 'aim' ? game.tanks[game.current] : null;
  const driving = !!driver && game.ticks - driver.lastMoveTick < 5;
  setLoop('engine', driving, driving ? 52 + driver.lastClimb * 14 : 38);
  const turning = !!driver && game.ticks - driver.lastTurnTick < 3;
  setLoop('turret', turning, 72);  // 72 Hz motor hum, gear teeth at 24 Hz

  endInputTick();
}

export function goToTitle() {
  game.state = 'title';
  if (DEV) closeDevMenu();
  game.tanks = [];
  resetEffects();
  newScenery(previewArena());
}
