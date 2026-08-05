/**
 * The player state machine — src/player.js.
 *
 * `Player` is the only place the game's moment-to-moment rules live: how many
 * rounds a magazine holds, what a dash costs, how long you are helpless after
 * one, when the ground catches you. Every one of those is a number that gets
 * retuned, and none of them had a test. What is pinned here is not the tuning
 * but the *accounting*: ammo never goes negative, a reload takes exactly
 * `WEAPON.reloadTime`, stamina is spent once per dash and only once, a jump
 * leaves the ground and lands again, and a dead player is inert.
 *
 * Headless notes
 * -------------
 *   - `three` is real. The rig, the skinned meshes, the cloth and the animator
 *     all run for real; there is no WebGL and no renderer.
 *   - `collision` is a real `CollisionWorld`, so `update()` takes the real
 *     move-and-slide and ground-probe path. `test/capsule-resolve.test.js`
 *     covers that path's geometry; here it is just wired up honestly.
 *   - The one substitution is `opts.materials`. `characterMaterials()` would
 *     otherwise rasterise a 256² fabric weave through a 2D canvas, which node
 *     has no business owning; the override seam is the documented one
 *     (src/character/materials.js: "an explicit `materials` object passed to
 *     the Player"), and materials have no bearing on any rule tested below.
 *
 * The command object and the hook set are both shaped after the real call
 * site, src/main.js:1263-1334 — `input.sample()` plus the `aimPoint` main.js
 * attaches at line 1290, and the eight hooks it passes at 1299-1333.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics.js';
import { Player, WEAPON } from '../src/player.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Plain materials, so nothing reaches for a canvas. See the header. */
function plainMaterials() {
  const m = () => new THREE.MeshStandardMaterial();
  return { body: m(), cloth: m(), metal: m(), glow: m(), bodyGlow: m() };
}
const MATERIALS = plainMaterials();

/** A player standing on the open street, with a real collision world. */
function spawn(opts = {}) {
  const collision = new CollisionWorld();
  collision.bounds = { x0: -400, z0: -400, x1: 400, z1: 400 };
  const scene = new THREE.Group();
  const player = new Player(scene, collision, { x: 0, z: 0, materials: MATERIALS, ...opts });
  return { collision, scene, player };
}

/**
 * One frame of input, shaped exactly like what `input.sample()` returns plus
 * the `aimPoint` main.js attaches (src/main.js:1290). `aimPoint` is not
 * optional on a firing frame — player.js:534 copies it unguarded.
 */
function cmd(over = {}) {
  return {
    forward: 0, right: 0, jump: false, sprint: false, dash: false,
    fire: false, aim: false, melee: false, reload: false, use: false,
    aimPoint: new THREE.Vector3(0, 1.5, -12),
    ...over,
  };
}

/** Counts every hook main.js supplies, so a test can assert silence too. */
function hooks() {
  const calls = { shoot: [], dryFire: 0, melee: 0, jump: 0, dash: 0, step: [], land: [] };
  return {
    calls,
    onShoot: (origin, dir) => calls.shoot.push({ origin: origin.clone(), dir: dir.clone() }),
    onDryFire: () => { calls.dryFire++; },
    onMelee: () => { calls.melee++; },
    onJump: () => { calls.jump++; },
    onDash: () => { calls.dash++; },
    onStep: (i) => calls.step.push(i),
    onLand: (v) => calls.land.push(v),
  };
}

const DT = 1 / 60;

/** Advance `frames` frames with the same command. */
function run(player, frames, command, h) {
  for (let i = 0; i < frames; i++) player.update(DT, command, 0, 0, h);
}

/* ================================================================== */
/* ammo, reload, dry fire                                              */
/* ================================================================== */

test('a magazine fires exactly WEAPON.mag rounds, one per fireRate', () => {
  const { player } = spawn();
  const h = hooks();
  const hold = cmd({ fire: true });

  let frames = 0;
  while (player.ammo > 0 && frames < 1000) {
    player.update(DT, hold, 0, 0, h);
    frames++;
  }

  assert.equal(h.calls.shoot.length, WEAPON.mag, 'one shot per round in the magazine');
  assert.equal(player.ammo, 0);
  /* Analytic: the first shot is free, each of the remaining 13 waits out a
   * `fireRate` cooldown, and a cooldown of 0.13 s spans ceil(0.13/dt) = 8
   * frames. So 1 + 13*8 = 105 frames. */
  const perShot = Math.ceil(WEAPON.fireRate / DT);
  assert.equal(frames, 1 + (WEAPON.mag - 1) * perShot, `emptied in ${frames} frames`);
  assert.equal(h.calls.dryFire, 0, 'no dry click while there were rounds left');
});

test('emptying the magazine starts a reload of exactly WEAPON.reloadTime', () => {
  const { player } = spawn();
  const h = hooks();
  const hold = cmd({ fire: true });

  while (player.ammo > 0) player.update(DT, hold, 0, 0, h);
  /* player.js:556 auto-reloads on the very frame the last round leaves, so the
   * player never has to ask. This is also why the dry-fire branch above it is
   * unreachable from a normally emptied magazine — see the next test. */
  assert.equal(player.reloading, WEAPON.reloadTime, 'the reload is armed at full length');

  let frames = 0;
  while (player.reloading > 0 && frames < 1000) {
    player.update(DT, hold, 0, 0, h);
    frames++;
  }
  assert.equal(frames, Math.ceil(WEAPON.reloadTime / DT), `reload took ${frames} frames`);
  assert.equal(player.reloading, 0);
  assert.equal(player.ammo, WEAPON.mag - 1, 'the mag is refilled, and the held trigger fires at once');
});

test('a trigger held for half a minute never drives ammo negative', () => {
  const { player } = spawn();
  const h = hooks();
  const hold = cmd({ fire: true });

  /* 1800 frames is ~15 fire-and-reload cycles. The invariant is not the shot
   * count (that is tuning) but that the counter is a real resource: bounded
   * below by zero and above by the magazine, every single frame. */
  for (let i = 0; i < 1800; i++) {
    player.update(DT, hold, 0, 0, h);
    assert.ok(player.ammo >= 0, `ammo went negative on frame ${i}`);
    assert.ok(player.ammo <= WEAPON.mag, `ammo exceeded the magazine on frame ${i}`);
    assert.ok(player.reloading >= 0 && player.reloading <= WEAPON.reloadTime);
  }
  assert.ok(h.calls.shoot.length > WEAPON.mag, 'and it kept shooting across reloads');
});

test('an empty chamber with no reload pending gives one dry click, then reloads', () => {
  /* The reachable route into player.js:550. Normal play cannot get here — the
   * auto-reload one line below the fire block closes the window — so this
   * covers the branch a restore/cheat path or a future ammo pickup could open,
   * and pins that a dry click costs a 0.35 s lockout AND starts the reload,
   * rather than letting the trigger machine-gun the empty-click sound. */
  const { player } = spawn();
  const h = hooks();
  player.ammo = 0;
  player.reloading = 0;
  player.fireCd = 0;

  player.update(DT, cmd({ fire: true }), 0, 0, h);

  assert.equal(h.calls.dryFire, 1, 'exactly one click');
  assert.equal(h.calls.shoot.length, 0, 'and nothing left the barrel');
  assert.equal(player.fireCd, 0.35, 'the empty-trigger lockout');
  assert.equal(player.reloading, WEAPON.reloadTime, 'and it reloads itself');

  // holding the trigger through the reload must not click again
  run(player, 20, cmd({ fire: true }), h);
  assert.equal(h.calls.dryFire, 1, 'no second click while the reload runs');
});

test('a manual reload is refused on a full magazine and cannot be restarted mid-way', () => {
  const { player } = spawn();
  assert.equal(player.startReload(), false, 'nothing to top up');
  assert.equal(player.reloading, 0);

  player.ammo = WEAPON.mag - 1;
  assert.equal(player.startReload(), true);
  assert.equal(player.reloading, WEAPON.reloadTime);

  /* Refusing a restart is what stops a mashed R key from holding the reload
   * animation at its first frame forever. */
  run(player, 30, cmd({ reload: true }), hooks());
  assert.ok(player.reloading < WEAPON.reloadTime - 0.4, 'the timer really is running down');
  assert.equal(player.startReload(), false, 'and cannot be re-armed from the top');
});

/* ================================================================== */
/* dash                                                                */
/* ================================================================== */

test('a dash costs 25 stamina, launches at DASH_V and locks itself out for 0.75 s', () => {
  const { player } = spawn();
  const h = hooks();
  player.update(DT, cmd(), 0, 0, h);       // settle a frame first
  const stamina = player.stamina;

  /* No movement input, so the dash goes the way the camera faces: at yaw 0
   * that is (-sin 0, cos 0) = +z (player.js:413-414). */
  player.update(DT, cmd({ dash: true }), 0, 0, h);

  assert.equal(h.calls.dash, 1);
  assert.equal(player.dashCd, 0.75);
  assert.ok(Math.abs(player.vel.z - 21) < 1e-9, `dash speed was ${player.vel.z}`);
  assert.ok(Math.abs(player.vel.x) < 1e-12, 'and straight, not fanned out');
  /* 25 spent, then the same frame's regen (+18/s) hands a little back — the
   * order in player.js:409-425 is spend, then regen, and this pins it. */
  assert.ok(Math.abs(player.stamina - (stamina - 25 + 18 * DT)) < 1e-9,
    `stamina went ${stamina} -> ${player.stamina}`);
  assert.ok(player.invuln >= 0.26 - 1e-9, 'and the dash carries its own i-frames');

  // mashing the key during the cooldown does nothing at all
  const held = player.stamina;
  player.update(DT, cmd({ dash: true }), 0, 0, h);
  assert.equal(h.calls.dash, 1, 'a second dash inside the cooldown is refused');
  assert.ok(player.stamina > held, 'and it costs nothing — stamina kept regenerating');
});

test('the dash cooldown expires on schedule and not a frame early', () => {
  const { player } = spawn();
  const h = hooks();
  player.update(DT, cmd({ dash: true }), 0, 0, h);

  /* The cooldown is decremented at the top of update() and read a few lines
   * later (player.js:394 then 409), so the Nth update after the dash is the
   * first that can dash again, where N = ceil(0.75/dt) = 45. Frame 44 must
   * still refuse — that off-by-one is the whole point of the test. */
  const frames = Math.ceil(0.75 / DT);
  run(player, frames - 2, cmd(), h);
  player.update(DT, cmd({ dash: true }), 0, 0, h);
  assert.equal(h.calls.dash, 1, `dashed again after only ${frames - 1} frames`);
  assert.ok(player.dashCd > 0, 'the cooldown had not expired yet');

  player.update(DT, cmd({ dash: true }), 0, 0, h);
  assert.equal(h.calls.dash, 2, `still refused after ${frames} frames`);
  assert.equal(player.dashCd, 0.75, 'and re-armed the cooldown');
});

test('a dash is refused on depleted stamina, so sprinting is a real trade', () => {
  const { player } = spawn();
  const h = hooks();

  /* The gate is `stamina > 25` (player.js:409), i.e. exactly 25 is not enough
   * — the cost must be payable in full, or a dash could leave it negative. */
  player.stamina = 25;
  player.update(DT, cmd({ dash: true }), 0, 0, h);
  assert.equal(h.calls.dash, 0, 'refused with exactly the cost in the tank');
  assert.equal(player.dashCd, 0, 'and it did not burn the cooldown either');

  player.stamina = 0;
  player.update(DT, cmd({ dash: true }), 0, 0, h);
  assert.equal(h.calls.dash, 0);
  assert.ok(player.stamina >= 0, 'stamina never goes negative');

  // regen back over the line and it works again
  run(player, Math.ceil((26 / 18) / DT) + 1, cmd(), h);
  assert.ok(player.stamina > 25);
  player.update(DT, cmd({ dash: true }), 0, 0, h);
  assert.equal(h.calls.dash, 1, 'dashable once the meter is back');
});

test('a dash goes where the stick points, not where the camera looks', () => {
  const { player } = spawn();
  const h = hooks();
  player.update(DT, cmd(), 0, 0, h);

  /* Camera-relative movement (player.js:401-403): at yaw 0, forward is +z and
   * screen-right is -x, so `right: 1` is -x. A dash while moving takes the
   * movement direction. */
  player.update(DT, cmd({ dash: true, right: 1 }), 0, 0, h);
  assert.ok(Math.abs(player.vel.x + 21) < 1e-9, `dashed to x=${player.vel.x}`);
  assert.ok(Math.abs(player.vel.z) < 1e-12);
});

/* ================================================================== */
/* stamina                                                             */
/* ================================================================== */

test('stamina regenerates at 18/s and sprinting spends it at 24/s', () => {
  const { player } = spawn();
  const h = hooks();

  player.stamina = 0;
  run(player, 60, cmd(), h);
  assert.ok(Math.abs(player.stamina - 18) < 1e-9, `regen gave ${player.stamina} in a second`);

  player.stamina = player.maxStamina;
  run(player, 60, cmd({ forward: 1, sprint: true }), h);
  assert.ok(Math.abs(player.stamina - (100 - 24)) < 1e-9, `sprint left ${player.stamina}`);

  /* Sprinting on the spot is not a thing: the drain is gated on `moving`
   * (player.js:423), so holding shift in a doorway does not empty the meter. */
  const parked = player.stamina;
  run(player, 60, cmd({ sprint: true }), h);
  assert.ok(player.stamina > parked, 'standing still regenerates even with sprint held');
});

test('stamina is clamped to [0, maxStamina] however long the run', () => {
  const { player } = spawn();
  const h = hooks();

  run(player, 600, cmd(), h);
  assert.equal(player.stamina, player.maxStamina, 'regen cannot overfill');

  /* A long sprint bottoms out but never goes negative. It settles just above
   * 1 rather than at 0: the sprint gate is `stamina > 1` (player.js:423), so
   * the last sip of the meter closes the gate and the regen branch takes over,
   * which is what keeps the player walking instead of stuttering at zero. */
  run(player, 600, cmd({ forward: 1, sprint: true }), h);
  assert.ok(player.stamina >= 0 && player.stamina < 2,
    `a 10 s sprint left stamina at ${player.stamina}`);
  /* With the gate flapping open and shut the target speed alternates between
   * WALK 5.4 and SPRINT 9.8, and the acceleration blend settles somewhere in
   * between — so an empty meter costs real pace without ever stuttering the
   * player to a halt. What must not happen is a free full-speed sprint. */
  const speed = Math.hypot(player.vel.x, player.vel.z);
  assert.ok(speed > 5.4 && speed < 9.3, `empty-meter pace was ${speed} m/s`);
});

/* ================================================================== */
/* jump, gravity, landing                                             */
/* ================================================================== */

test('a jump leaves the ground, arcs to the analytic apex and lands', () => {
  const { player } = spawn();
  const h = hooks();

  player.update(DT, cmd({ jump: true }), 0, 0, h);
  assert.equal(h.calls.jump, 1);
  assert.equal(player.onGround, false, 'airborne on the jump frame');
  /* JUMP_V 8.6 minus one frame of GRAVITY 24 (player.js:447-452). */
  assert.ok(Math.abs(player.vel.y - (8.6 - 24 * DT)) < 1e-9, `vy was ${player.vel.y}`);

  let apex = player.pos.y;
  let air = 1;
  for (let i = 0; i < 200 && !player.onGround; i++) {
    player.update(DT, cmd(), 0, 0, h);
    apex = Math.max(apex, player.pos.y);
    air++;
  }

  /* Continuous apex is v²/2g = 8.6²/48 = 1.5408 m and the flight lasts
   * 2v/g = 0.7167 s. A 60 Hz sampled arc undershoots the apex by at most one
   * frame of climb (8.6/60 = 0.143 m) and rounds the flight time to whole
   * frames, so both are bracketed rather than equated. */
  const analyticApex = (8.6 * 8.6) / (2 * 24);
  assert.ok(apex <= analyticApex + 1e-9 && apex > analyticApex - 8.6 * DT,
    `apex ${apex} outside the sampled bracket around ${analyticApex}`);
  const analyticFlight = (2 * 8.6) / 24;
  assert.ok(Math.abs(air * DT - analyticFlight) < 3 * DT, `flight lasted ${(air * DT).toFixed(4)} s`);

  assert.equal(player.onGround, true, 'onGround is restored on touchdown');
  assert.equal(player.pos.y, 0, 'and the feet are back on the street exactly');
  assert.equal(player.vel.y, 0, 'with the fall velocity cleared');
  assert.equal(h.calls.jump, 1, 'and no double jump snuck in mid-air');
});

test('a second jump is refused while airborne', () => {
  const { player } = spawn();
  const h = hooks();
  const held = cmd({ jump: true });

  /* Holding the key must not ratchet: the gate is `onGround` (player.js:447),
   * and this is what keeps it from being a flight control. */
  run(player, 30, held, h);
  assert.equal(h.calls.jump, 1, `jumped ${h.calls.jump} times on one press-and-hold`);
  assert.equal(player.onGround, false, 'and it is still in the air');
});

test('a fall onto the street reports its impact speed once', () => {
  const { collision, player } = spawn();
  collision.add(0, 0, 6, 6, 0, 6, 'building');        // a 6 m plinth at the origin
  player.pos.set(0, 6, 0);
  player.resetForNewRun();                            // plants the feet at the new height
  const h = hooks();

  // walk off the edge (screen-right at yaw 0 is -x) and wait for the ground
  for (let i = 0; i < 300 && h.calls.land.length === 0; i++) {
    player.update(DT, cmd({ right: 1 }), 0, 0, h);
  }

  assert.equal(h.calls.land.length, 1, 'exactly one landing');
  /* Free fall from ~6 m: v = sqrt(2*g*h) = sqrt(2*24*6) = 16.97 m/s, less a
   * frame of discretisation. The hook only fires above 12 m/s (player.js:463),
   * which is why a plain jump does not trigger it. */
  const v = h.calls.land[0];
  assert.ok(v > 16 && v <= 16.98, `landed at ${v} m/s`);
  assert.equal(player.onGround, true);
  assert.equal(player.pos.y, 0, 'and it is standing on the street, not in it');

  run(player, 60, cmd(), h);
  assert.equal(h.calls.land.length, 1, 'and the hook does not repeat while standing');
});

/* ================================================================== */
/* damage and death                                                    */
/* ================================================================== */

test('damage lands, then i-frames swallow the follow-up', () => {
  const { player } = spawn();
  const from = new THREE.Vector3(1, 0, 0);

  assert.equal(player.damage(30, from), true);
  assert.equal(player.health, player.maxHealth - 30);
  assert.ok(player.invuln > 0, 'a non-continuous hit grants i-frames');
  assert.equal(player.hurtFlash, 1);

  /* The second blow of a two-hit combo inside 0.25 s is free. Without this a
   * golem sweep and its own splash would both bill the player. */
  assert.equal(player.damage(30, from), false, 'refused during i-frames');
  assert.equal(player.health, player.maxHealth - 30, 'and did not touch health');
  assert.equal(player.damage(5, from, true), false, 'i-frames cover continuous sources too');
  assert.equal(player.health, player.maxHealth - 30);

  /* Continuous damage — the dragon's breath, main.js:800 — differs in what it
   * *grants*: it never arms i-frames of its own (player.js:243-246). That is
   * what lets standing in the flame bill the player every frame, while a
   * single melee hit still buys a quarter second of grace. */
  player.invuln = 0;
  assert.equal(player.damage(5, from, true), true, 'continuous damage lands once the grace lapses');
  assert.equal(player.health, player.maxHealth - 35);
  assert.equal(player.invuln, 0, 'and grants no grace of its own');
  assert.equal(player.damage(5, from, true), true, 'so the very next frame bills again');
  assert.equal(player.health, player.maxHealth - 40);
});

test('health reaching zero kills exactly once and clamps at zero', () => {
  const { player } = spawn();

  assert.equal(player.damage(player.maxHealth + 500, null), true);
  assert.equal(player.health, 0, 'overkill does not drive health negative');
  assert.equal(player.alive, false);

  assert.equal(player.damage(10, null), false, 'a corpse cannot be damaged again');
  assert.equal(player.health, 0);
});

test('updates after death advance the collapse and change nothing else', () => {
  const { player } = spawn();
  const h = hooks();
  run(player, 30, cmd({ forward: 1 }), h);         // get some momentum going
  player.damage(1000, null);
  assert.equal(player.alive, false);

  const before = {
    pos: player.pos.clone(), vel: player.vel.clone(),
    ammo: player.ammo, health: player.health, stamina: player.stamina,
    facing: player.facing, onGround: player.onGround,
  };
  const time = player.time;
  const shots = h.calls.shoot.length;

  /* This is the `frozen` path in main.js:1296 — two seconds of the game-over
   * sequence with every key held down. The rig has to keep ticking so the
   * death animation plays, and nothing else may move. */
  run(player, 120, cmd({ fire: true, jump: true, dash: true, forward: 1, melee: true, reload: true }), h);

  assert.deepEqual(player.pos.toArray(), before.pos.toArray(), 'a corpse does not walk');
  assert.deepEqual(player.vel.toArray(), before.vel.toArray(), 'and does not accelerate');
  assert.equal(player.ammo, before.ammo, 'and does not shoot');
  assert.equal(player.health, before.health);
  assert.equal(player.stamina, before.stamina, 'stamina stops regenerating');
  assert.equal(player.facing, before.facing);
  assert.equal(player.onGround, before.onGround);
  assert.equal(h.calls.shoot.length, shots, 'no hook fires while dead');
  assert.equal(h.calls.jump, 0);
  assert.equal(h.calls.dash, 0);
  assert.equal(h.calls.melee, 0);
  assert.ok(player.time > time, 'but the clock the death pose reads does advance');
  assert.equal(player.alive, false, 'and it stays dead');
});

test('a revive without startGame() falls back to a full reset', () => {
  /* player.js:389 — main.js may flip `alive` straight back on, and the state
   * machine has to notice rather than carry the death pose into the new run. */
  const { player } = spawn();
  const h = hooks();
  player.damage(1000, null);
  run(player, 10, cmd(), h);
  player.dashCd = 0.5;
  player.hurtFlash = 1;
  player.time = 99;

  player.alive = true;
  player.health = player.maxHealth;
  player.update(DT, cmd(), 0, 0, h);

  assert.equal(player.dashCd, 0, 'transient timers were cleared');
  assert.equal(player.hurtFlash, 0);
  assert.ok(player.time < 1, 'and the clock restarted');
  assert.equal(player.onGround, true);
});

/* ================================================================== */
/* the collision path, wired for real                                  */
/* ================================================================== */

test('walking into a wall stops the player at radius, and sliding still works', () => {
  const { collision, player } = spawn();
  /* A facade centred at x = 10, 11 m wide: its near face is x = 4.5. The
   * player capsule has RADIUS 0.42 (player.js:39). */
  collision.add(10, 0, 11, 40, 0, 6, 'building');
  const h = hooks();

  run(player, 400, cmd({ right: -1 }), h);          // straight at the wall (+x)
  assert.ok(Math.abs(player.pos.x - (4.5 - 0.42)) < 1e-9, `stopped at x=${player.pos.x}`);
  assert.ok(Math.abs(player.pos.z) < 1e-9, 'and did not drift along it');

  /* Now push diagonally into it: the into-wall component is removed and the
   * along-wall component survives, which is what makes a corridor walkable. */
  const z0 = player.pos.z;
  run(player, 60, cmd({ right: -1, forward: 1 }), h);
  assert.ok(Math.abs(player.pos.x - (4.5 - 0.42)) < 1e-9, 'still flush with the wall');
  assert.ok(player.pos.z - z0 > 1, `slid only ${(player.pos.z - z0).toFixed(3)} m along it`);
  assert.equal(player.onGround, true, 'and never lost the floor doing it');
});
