/**
 * The enemy damage and combat contract — src/enemies.js (`EnemyManager`).
 *
 * The manager owns every rule that decides how a creature *feels* to shoot at:
 * how much armour it sheds and when, how big a hit has to be to rock it back,
 * how long its corpse lies there, and what a pooled body looks like when it
 * comes back out. All of that is threshold arithmetic on `e.hp / e.maxHp`, and
 * all of it was untested.
 *
 * Headless notes
 * -------------
 *   - `three` is real, and so are the rigs, the merged geometry, the skinning
 *     and the animators: a spawned creature here is the same object the game
 *     builds. `CollisionWorld` and `PhysicsWorld` are the real ones too.
 *   - `vfx` is a tally-only facade. `EnemyManager` only ever calls `emit`,
 *     `burst`, `explosion` and `impactSpark` on it (plus the optional
 *     `flameBreath`), which is exactly the surface below.
 *   - ONE substitution, at the top: each archetype's `materials()` is replaced
 *     with a plain `MeshStandardMaterial`. The real one rasterises a skin sheet
 *     through a 2D canvas (src/creatures/skin.js:295 → src/textures/core.js:29),
 *     which node has no `document` for. Nothing below depends on a material
 *     beyond `_shade()` being able to write `color` and `emissiveIntensity` to
 *     it, which a standard material can. This has to happen before the first
 *     `buildCreature`, because src/creatures/kit.js memoises per archetype —
 *     hence the dynamic import of enemies.js underneath it.
 *
 * What is NOT reachable here, and why: the wave director. `startWave`,
 * `WAVES` and the spawn-position picker all live in src/main.js (lines 247-369),
 * which builds a WebGL renderer at import time. So the determinism test below
 * pins the half the manager owns — that a given seed produces an identical
 * creature, field for field — which is what makes a seeded wave reproducible
 * once main.js has chosen where to put it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics.js';
import { PhysicsWorld } from '../src/rigidbody.js';
import { Rng } from '../src/rng.js';
import { ARCHETYPES } from '../src/creatures/index.js';

/* ------------------------------------------------------------------ */
/* the one headless substitution — see the header                       */
/* ------------------------------------------------------------------ */
for (const def of Object.values(ARCHETYPES)) {
  def.materials = () => ({ body: new THREE.MeshStandardMaterial({ color: 0x808080 }) });
}
const {
  EnemyManager, ENEMY_TYPES, GOLEM_PLATES, STAGGER_FRAC, STAGGER_LOCKOUT,
  CORPSE_LIFE, CORPSE_FADE,
} = await import('../src/enemies.js');

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const DT = 1 / 60;
const SEED = 0x5eed;

/** Every VFX method `EnemyManager` and src/creatures/fx.js reach for. */
function fakeVfx() {
  const calls = { emit: 0, burst: 0, explosion: 0, spark: 0 };
  return {
    calls,
    emit() { calls.emit++; },
    burst() { calls.burst++; },
    explosion() { calls.explosion++; },
    impactSpark() { calls.spark++; },
  };
}

function makeManager({ seed = SEED, physics = false } = {}) {
  const collision = new CollisionWorld();
  collision.bounds = { x0: -400, z0: -400, x1: 400, z1: 400 };
  const vfx = fakeVfx();
  const mgr = new EnemyManager(new THREE.Group(), collision, vfx, new Rng(seed));
  const world = physics ? new PhysicsWorld(collision, { seed: 5 }) : null;
  if (world) mgr.physics = world;
  return { mgr, collision, vfx, physics: world };
}

/**
 * The context object `EnemyManager.update()` reads, shaped after the real call
 * site at src/main.js:1359-1364. `findOpenPointNear` and `flowDirection` are
 * both optional there and omitted here, so the creatures steer directly.
 */
function ctx(px = 0, pz = 0) {
  const player = {
    pos: new THREE.Vector3(px, 0, pz),
    vel: new THREE.Vector3(),
    centre: new THREE.Vector3(px, 1, pz),
    facing: 0,
  };
  return { player, camera: null };
}

/** Run the manager for `seconds`, keeping the player wherever it is. */
function advance(mgr, seconds, c = ctx(), dt = DT) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) mgr.update(dt, c);
}

/* ================================================================== */
/* golem armour                                                        */
/* ================================================================== */

test('golem plates shed one at a time, at exactly the GOLEM_PLATES fractions', () => {
  const { mgr } = makeManager();
  /* The golem is parked 60 m out so its brain just walks and never attacks,
   * and the hits carry no direction — `dir` is optional (src/enemies.js:340),
   * and omitting it keeps the guard's 50 % front reduction out of the
   * arithmetic. The guard gets its own test below. */
  const e = mgr.spawn('golem', new THREE.Vector3(0, 0, 60));
  const max = ENEMY_TYPES.golem.hp;
  assert.equal(e.maxHp, max);
  assert.equal(e.brokenPlates, 0);
  assert.deepEqual(e.plateAge, [0, 0, 0, 0, 0]);

  /* 24 damage a time, with 0.3 s of manager time between hits. That gap is
   * deliberate: the burst bucket drains at maxHp*0.9 per second
   * (src/enemies.js:1029), so 0.3 s clears 64.8 — more than any single hit
   * here — and the armour ladder is isolated from the knock-down mechanic. */
  const shed = [];
  for (let i = 1; i <= 9; i++) {
    const before = e.brokenPlates;
    mgr.damage(e, 24, null);
    if (e.brokenPlates > before) shed.push({ hit: i, frac: e.hp / max, plates: e.brokenPlates });
    assert.ok(e.brokenPlates - before <= 1, `hit ${i} shed ${e.brokenPlates - before} plates at once`);
    advance(mgr, 0.3, ctx(0, 0));
  }

  /* Analytic: after n hits the fraction is 1 - 24n/240 = 1 - n/10, so a plate
   * comes off on the first hit that drops the fraction to or below each
   * threshold — 0.8 at hit 2, 0.65 at hit 4 (0.6), 0.5 at hit 5, 0.35 at hit 7
   * (0.3), 0.2 at hit 8. In order, one at a time, no skips. */
  assert.deepEqual(shed.map((s) => s.hit), [2, 4, 5, 7, 8]);
  assert.deepEqual(shed.map((s) => s.plates), [1, 2, 3, 4, 5]);
  for (const s of shed) {
    const threshold = GOLEM_PLATES[s.plates - 1];
    assert.ok(s.frac <= threshold + 1e-12,
      `plate ${s.plates} came off at ${s.frac}, above its ${threshold} threshold`);
    assert.ok(s.frac > threshold - 24 / max - 1e-12,
      `plate ${s.plates} came off late, at ${s.frac} for a ${threshold} threshold`);
  }
  assert.equal(e.brokenPlates, GOLEM_PLATES.length, 'and all five are gone by 20 % health');
});

test('one huge hit strips every remaining plate, and never more than there are', () => {
  const { mgr } = makeManager();
  const e = mgr.spawn('golem', new THREE.Vector3(0, 0, 60));

  /* The `while` loop at src/enemies.js:396 has to catch up rather than shed
   * one: a grenade that takes a golem from full to 17 % must not leave four
   * plates hanging on it. */
  mgr.damage(e, 200, null);
  assert.equal(e.hp, 40);
  assert.equal(e.brokenPlates, GOLEM_PLATES.length);

  mgr.damage(e, 20, null);
  assert.equal(e.brokenPlates, GOLEM_PLATES.length, 'the counter cannot run past the plate list');
  assert.equal(e.plateAge.length, GOLEM_PLATES.length);
});

test('a golem behind its guard eats half as much from the front and all of it from behind', () => {
  const { mgr } = makeManager();
  const e = mgr.spawn('golem', new THREE.Vector3(0, 0, 10));
  /* The gate is `shield > 0.45` plus a direction pointing into its face
   * (src/enemies.js:345-349). Facing 0 means forward is (-sin 0, -cos 0) =
   * (0, -1), so a shot travelling +z arrives head-on. */
  e.shield = 1;
  e.facing = 0;

  const before = e.hp;
  mgr.damage(e, 40, new THREE.Vector3(0, 0, 1));
  assert.equal(before - e.hp, 20, 'a guarded frontal hit is halved');

  const mid = e.hp;
  mgr.damage(e, 40, new THREE.Vector3(0, 0, -1));
  assert.equal(mid - e.hp, 40, 'coming round behind it pays full price');

  /* And the guard is gone once the core is open — three plates down disables
   * the raise entirely (src/creatures/brains.js:253). */
  e.shield = 0;
  const late = e.hp;
  mgr.damage(e, 40, new THREE.Vector3(0, 0, 1));
  assert.equal(late - e.hp, 40, 'no guard, no reduction');
});

test('the dragon\'s vulnerable window is worth 80 % extra damage', () => {
  const { mgr } = makeManager();
  const e = mgr.spawn('boss', new THREE.Vector3(0, 0, 40));

  const before = e.hp;
  mgr.damage(e, 100, null);
  assert.equal(before - e.hp, 100, 'a guarded dragon takes face value');

  e.vulnerable = 1;
  const mid = e.hp;
  mgr.damage(e, 100, null);
  assert.equal(mid - e.hp, 180, 'and 1.8x while it is exhausted — this is where the fight is won');
});

/* ================================================================== */
/* stagger, interrupt, knock-down                                      */
/* ================================================================== */

test('the stagger threshold is a fraction of max health, and locks out afterwards', () => {
  const { mgr } = makeManager();
  const e = mgr.spawn('whelp', new THREE.Vector3(0, 0, 14));
  e.state = 'chase';
  const bar = e.maxHp * STAGGER_FRAC.whelp;      // 46 * 0.34 = 15.64

  /* Just under the bar is chip damage: it flinches (a pose blend) but keeps
   * doing what it was doing. This is what stops a stream of small hits from
   * stun-locking anything. */
  mgr.damage(e, bar - 0.5, null);
  assert.equal(e.state, 'chase', 'a light hit does not rock it back');
  assert.equal(e.stagger, 0);
  assert.equal(e.staggerCd, 0);
  assert.ok(e.flinch > 0, 'but it does flinch');

  // over the bar and it is rocked back, and cannot be staggered again at once
  mgr.damage(e, bar + 0.5, null);
  assert.equal(e.state, 'stagger');
  assert.equal(e.staggerCd, STAGGER_LOCKOUT);
  const held = e.stagger;
  mgr.damage(e, bar + 0.5, null);
  assert.ok(e.stagger <= held, 'a second heavy hit inside the lockout does not extend it');
});

test('a heavy hit interrupts an attack that has not committed, and cannot touch one that has', () => {
  const { mgr } = makeManager();
  const bar = ENEMY_TYPES.whelp.hp * STAGGER_FRAC.whelp;

  /* src/enemies.js:432 — the interrupt is gated on the beat being 'ant'. A
   * lunge is 0.46 s of anticipation, 0.17 s of commit (src/creatures/whelp.js:399),
   * so a hit at 0.2 s cancels it and one at 0.5 s does not. That asymmetry is
   * the fight's core deal: read the wind-up and you get a free interrupt;
   * miss it and the bite is already paid for. */
  const early = mgr.spawn('whelp', new THREE.Vector3(0, 0, 3));
  mgr.startAct(early, 'lunge');
  early.act.t = 0.2;
  mgr.damage(early, bar + 1, null);
  assert.equal(early.act, null, 'the wind-up was cancelled');
  assert.equal(early.state, 'stagger');

  const late = mgr.spawn('whelp', new THREE.Vector3(4, 0, 3));
  mgr.startAct(late, 'lunge');
  late.act.t = 0.5;
  mgr.damage(late, bar + 1, null);
  assert.ok(late.act, 'a committed bite still lands');
  assert.equal(late.act.id, 'lunge');
});

test('burst damage past the knock-down threshold downs a creature and clears its action', () => {
  const { mgr } = makeManager();
  const e = mgr.spawn('whelp', new THREE.Vector3(0, 0, 6));
  e.state = 'chase';
  mgr.startAct(e, 'lunge');

  /* The bucket for the light archetypes is maxHp * 0.85 (src/enemies.js:418),
   * and it has to be *exceeded*. 46 * 0.85 = 39.1, so 39 is not enough and 40
   * is. Splitting it across two hits works because the bucket only drains in
   * update(), not between damage calls. */
  mgr.damage(e, 20, null);
  assert.notEqual(e.state, 'downed', 'half the bucket is not a knock-down');
  mgr.damage(e, 20, null);
  assert.equal(e.state, 'downed');
  assert.equal(e.downT, 1.1);
  assert.equal(e.act, null, 'and whatever it was doing is off the table');
  assert.equal(e.burstDmg, 0, 'the bucket is emptied so it cannot be re-downed for free');

  // and it gets back up on its own
  advance(mgr, 1.2, ctx(0, 6));
  assert.equal(e.state, 'chase', 'downed is a window, not a death sentence');
});

test('REGRESSION: a flying spitter that gets burst-downed stops flying', () => {
  /* Fixed in the working tree at src/enemies.js:423-429. `downed` is a pose
   * played on the ground, but the altitude hold in the motion step
   * (src/enemies.js:1265-1273) is driven by `e.flying` alone and ignores the
   * state — so a gargoyle knocked out of the air kept hovering at cruise
   * height, playing a collapse animation, and then stood up in mid-air. The
   * fix is the same one `_die()` has always applied (src/enemies.js:1360-1364):
   * drop the hold and let gravity have it. */
  const { mgr, collision } = makeManager();
  const e = mgr.spawn('spitter', new THREE.Vector3(0, 0, 20));
  e.state = 'fly';
  e.flying = true;
  e.flyMode = 'hover';
  e.flyTarget.set(0, 6, 20);
  e.pos.y = 6;
  e.vel.set(0, 6, 0);                              // climbing at the moment of impact

  const bucket = e.maxHp * 0.85;                   // 72 * 0.85 = 61.2
  mgr.damage(e, bucket + 1, null);

  assert.equal(e.state, 'downed', 'the burst put it down');
  assert.equal(e.flying, false, 'and it is no longer holding altitude');
  assert.ok(e.vel.y <= 0, `it must not still be climbing (vy ${e.vel.y})`);

  /* Now let the world run. Before the fix the altitude hold at
   * src/enemies.js:1265-1273 kept `pos.y` damped towards flyTarget.y, so it
   * simply stayed at 6 m. Free fall from 6 m under the creature gravity of
   * 22 m/s² takes sqrt(2*6/22) = 0.74 s, comfortably inside the 1.1 s the
   * downed pose lasts, so it must be on the cobbles by then. */
  advance(mgr, 0.3, ctx(0, 20));
  assert.ok(e.pos.y < 5.5, `not falling — still at y=${e.pos.y} after 0.3 s`);

  advance(mgr, 0.7, ctx(0, 20));
  assert.equal(e.state, 'downed', 'still playing the downed pose while it lands');
  const ground = collision.groundHeight(e.pos.x, e.pos.z, e.pos.y, ENEMY_TYPES.spitter.radius, 1.2);
  assert.ok(e.pos.y <= ground + 1e-9, `still airborne at y=${e.pos.y} over ground ${ground}`);
  assert.equal(e.onGround, true, 'and it stands back up wherever it landed');
});

test('a spitter shot dead in the air falls instead of hovering', () => {
  /* The sibling case in `_die()`, pinned alongside the regression above so a
   * future edit cannot fix one and break the other. */
  const { mgr, collision } = makeManager();
  const e = mgr.spawn('spitter', new THREE.Vector3(0, 0, 20));
  e.state = 'fly';
  e.flying = true;
  e.pos.y = 16;
  e.vel.set(0, 5, 0);

  mgr.damage(e, 9999, new THREE.Vector3(0, 0, 1));
  assert.equal(e.state, 'dead');
  assert.equal(e.flying, false);
  assert.ok(e.vel.y <= 0);
  assert.equal(e.corpseOnGround, false, 'it has some falling to do first');

  advance(mgr, 1.5, ctx(0, 20));
  const ground = collision.groundHeight(e.pos.x, e.pos.z, e.pos.y, ENEMY_TYPES.spitter.radius, 1.2);
  assert.ok(e.pos.y <= ground + 1e-9, `corpse hung at y=${e.pos.y}`);
});

/* ================================================================== */
/* telegraph before damage                                             */
/* ================================================================== */

test('no attack can hurt the player before its anticipation has run out', () => {
  /* The contract every creature in the game rests on: `_tickAct` only calls
   * `_commitAct` once `act.t >= act.ant` (src/enemies.js:487), and the lunge's
   * travelling bite is gated on the 'com' beat (src/enemies.js:493). So for
   * every act of every archetype, the first frame that can bill the player is
   * the first frame at or after `ant`. Break that and the game becomes
   * unreadable — you would be hit by animations you had already dodged. */
  const { mgr } = makeManager();
  const c = ctx(0, 0);

  for (const [typeId, acts] of [
    ['whelp', ['lunge', 'feint']],
    ['spitter', ['spit', 'swipe']],
    ['golem', ['slam', 'sweep']],
    ['boss', ['bite', 'tail', 'buffet', 'charge', 'breath', 'fan', 'land']],
  ]) {
    for (const id of acts) {
      const e = mgr.spawn(typeId, new THREE.Vector3(0, 0, 2.2));
      // stand right on top of the player, so range never spares us the hit
      e.pos.set(0, 0, 2.2);
      e.facing = Math.PI;                          // forward = (0, +1), i.e. at the player
      const hits = [];
      mgr.onPlayerHit = (src, dmg) => hits.push({ t: src.act ? src.act.t : -1, dmg });
      mgr.onShoot = () => {};

      const act = mgr.startAct(e, id, id === 'charge' ? { chargeX: 0, chargeZ: -1 } : null);
      assert.ok(act, `${typeId}/${id} is not an act of that archetype`);
      assert.ok(act.ant > 0, `${typeId}/${id} has no anticipation at all`);
      const ant = act.ant;

      /* Tick the act to its end, one frame at a time, exactly as update() does.
       * `info` is refreshed each frame with the creature glued to the player. */
      const total = act.ant + act.com + act.rec;
      for (let t = 0; t < total + DT; t += DT) {
        if (!e.act) break;
        mgr._info.player = c.player;
        mgr._info.pp.copy(c.player.pos);
        mgr._info.pc.copy(c.player.centre);
        mgr._info.dt = DT;
        mgr._info.distFlat = 2.2;
        mgr._info.distFull = 2.2;
        mgr._info.toX = 0;
        mgr._info.toZ = -1;
        mgr._tickAct(e, DT, mgr._info);
      }

      for (const hit of hits) {
        assert.ok(hit.t >= ant - 1e-9,
          `${typeId}/${id} hit at t=${hit.t}, before its ${ant} s wind-up was over`);
      }
      e.hp = 0;
      mgr.list.length = 0;                         // keep the separation loop out of it
      mgr.pools[typeId].push(e);
      mgr.onPlayerHit = null;
    }
  }
});

/* ================================================================== */
/* corpses, pooling and reuse                                          */
/* ================================================================== */

test('a corpse lies there for CORPSE_LIFE and then goes back to the pool', () => {
  const { mgr } = makeManager();
  const e = mgr.spawn('whelp', new THREE.Vector3(0, 0, 12));
  advance(mgr, 0.7, ctx(0, 12));                   // out of the spawn pop-in

  let deaths = 0;
  mgr.onDeath = () => { deaths++; };
  mgr.damage(e, 9999, new THREE.Vector3(0, 0, 1));

  assert.equal(deaths, 1, 'the death callback fires once');
  assert.equal(e.state, 'dead');
  assert.equal(e.stateT, 0, 'and the corpse clock starts at zero');
  assert.equal(mgr.aliveCount, 0, 'it stops counting towards the wave immediately');
  assert.equal(mgr.list.length, 1, 'but the body is still in the world');
  assert.equal(mgr.pools.whelp.length, 0, 'and has not been recycled yet');

  const life = CORPSE_LIFE.whelp;
  advance(mgr, life - 0.1, ctx(0, 12));
  assert.equal(mgr.list.length, 1, `the body vanished before ${life} s`);

  /* The cutoff is `stateT > life`, checked after stateT has been advanced, so
   * the body leaves on the first frame past the mark — within one frame of it,
   * never before. */
  let extra = 0;
  while (mgr.list.length && extra < 1) {
    mgr.update(DT, ctx(0, 12));
    extra += DT;
  }
  assert.equal(mgr.list.length, 0, `corpse outlived ${life} s by more than a second`);
  assert.ok(e.stateT > life && e.stateT <= life + 2 * DT,
    `recycled at stateT=${e.stateT}, expected just past ${life}`);
  assert.equal(mgr.pools.whelp.length, 1, 'and the body is back in the pool');
  assert.equal(e.object.visible, false, 'invisible, so it cannot be seen in the pool');
});

test('every archetype\'s corpse honours its own CORPSE_LIFE', () => {
  /* The table is per-archetype for a reason — a dragon's collapse is worth
   * watching and a whelp's is not — and the manager reads it through a `??`
   * default (src/enemies.js:1472). This walks the whole table so a new
   * archetype added without an entry shows up as a mismatch rather than
   * silently taking the whelp's 2.8 s. */
  for (const typeId of Object.keys(ENEMY_TYPES)) {
    const { mgr } = makeManager();
    const e = mgr.spawn(typeId, new THREE.Vector3(0, 0, 30));
    advance(mgr, 0.7, ctx(0, 30));
    mgr.damage(e, 1e6, new THREE.Vector3(0, 0, 1));
    assert.equal(e.state, 'dead', `${typeId} did not die`);

    const life = CORPSE_LIFE[typeId];
    assert.ok(life > 0, `${typeId} has no CORPSE_LIFE entry`);
    advance(mgr, life - 0.1, ctx(0, 30));
    assert.equal(mgr.list.length, 1, `${typeId} was recycled early`);
    advance(mgr, 0.2, ctx(0, 30));
    assert.equal(mgr.list.length, 0, `${typeId} was still lying there at ${life + 0.1} s`);
    assert.equal(mgr.pools[typeId].length, 1);
  }
});

test('a ragdolled corpse gets a lifetime budget derived from the same CORPSE_LIFE', () => {
  /* With a solver injected (`enemies.physics = physics`, src/main.js:693) the
   * corpse is handed over instead of playing the procedural collapse. The two
   * paths have to agree about how long a body is allowed to exist, or the
   * manager reclaims a body the solver is still simulating — hence the
   * `* 2.4` and `fadeTime` in src/enemies.js:736-737 being asserted against
   * the exported constants rather than against copies. */
  const { mgr, physics } = makeManager({ physics: true });
  const e = mgr.spawn('golem', new THREE.Vector3(0, 0, 14));
  for (let i = 0; i < 40; i++) { mgr.update(DT, ctx(0, 14)); physics.step(DT); }

  mgr.damage(e, 1e6, new THREE.Vector3(1, 0, 0));
  assert.ok(e.ragdoll, 'the golem death is heavy enough to always get a slot');
  assert.equal(e.ragdoll.maxLifetime, CORPSE_LIFE.golem * 2.4);
  assert.equal(e.ragdoll.fadeTime, CORPSE_FADE);
  assert.ok(e.ragdollFix, 'and the write-back fix map came with it');

  /* Run until the solver has settled, faded and been reclaimed. Nothing may be
   * left stranded: no live ragdoll, no body outside the pool, no visible mesh. */
  let t = 0;
  while (mgr.list.length && t < 30) {
    mgr.update(DT, ctx(0, 14));
    physics.step(DT);
    t += DT;
  }
  assert.equal(mgr.list.length, 0, 'the corpse was never reclaimed');
  assert.equal(mgr.pools.golem.length, 1);
  assert.equal(physics.ragdolls.length, 0, 'and the solver slot went back');
  assert.equal(e.ragdoll, null, 'with no dangling handle on the creature');
  assert.equal(e.object.visible, false);
});

test('a body taken out of the pool carries nothing over from its last life', () => {
  const { mgr } = makeManager();
  const first = mgr.spawn('golem', new THREE.Vector3(0, 0, 20));
  advance(mgr, 0.7, ctx(0, 20));
  /* Bruise it thoroughly first: plates off, mid-action, staggered, moving. */
  mgr.startAct(first, 'slam');
  mgr.damage(first, 200, new THREE.Vector3(1, 0, 0));
  assert.ok(first.brokenPlates > 0);
  mgr.damage(first, 1e6, new THREE.Vector3(1, 0, 0));

  advance(mgr, CORPSE_LIFE.golem + 0.2, ctx(0, 20));
  assert.equal(mgr.pools.golem.length, 1, 'the body is in the pool');

  const second = mgr.spawn('golem', new THREE.Vector3(5, 0, 5));
  assert.equal(second, first, 'the pool really did hand the same object back');

  /* Every field that could carry a stale life over. A missed reset here shows
   * up in game as a golem that spawns with no armour, or one that is already
   * mid-slam, or a corpse that never counts towards the wave. */
  assert.equal(second.hp, ENEMY_TYPES.golem.hp, 'full health');
  assert.equal(second.maxHp, ENEMY_TYPES.golem.hp);
  assert.equal(second.state, 'spawn');
  assert.equal(second.stateT, 0);
  assert.equal(second.brokenPlates, 0, 'a fresh set of plates');
  assert.deepEqual(second.plateAge, [0, 0, 0, 0, 0]);
  assert.equal(second.act, null);
  assert.equal(second.burstDmg, 0);
  assert.equal(second.stagger, 0);
  assert.equal(second.staggerCd, 0);
  assert.equal(second.flinch, 0);
  assert.equal(second.hurt, 0);
  assert.equal(second.shield, 0);
  assert.equal(second.vulnerable, 0);
  assert.equal(second.ragdoll, null);
  assert.equal(second.corpseOnGround, false);
  assert.equal(second.flying, false);
  assert.equal(second.onGround, true);
  assert.deepEqual(second.vel.toArray(), [0, 0, 0]);
  assert.equal(second.object.visible, true);
  assert.equal(mgr.aliveCount, 1, 'and it counts towards the wave again');
  assert.ok(second.serial > first.serial - 1, 'with a fresh spawn serial');
});

test('clear() returns everything, drops solver handles and rewinds the VFX stream', () => {
  const { mgr, physics } = makeManager({ physics: true });
  const kinds = ['whelp', 'whelp', 'spitter', 'golem'];
  const spawned = {};
  for (let i = 0; i < kinds.length; i++) {
    mgr.spawn(kinds[i], new THREE.Vector3(i * 4, 0, 20));
    spawned[kinds[i]] = (spawned[kinds[i]] ?? 0) + 1;
  }
  const pooled = () => Object.values(mgr.pools).reduce((n, p) => n + p.length, 0);
  const bodies = pooled() + mgr.list.length;
  advance(mgr, 0.7, ctx(0, 20));
  mgr.damage(mgr.list[3], 1e6, new THREE.Vector3(1, 0, 0));
  assert.ok(mgr.list[3].ragdoll, 'a live solver body to strand');

  /* This is what startGame() does between runs. Leaving a solver driving a
   * pooled body would have it puppeteering a creature in the next wave. */
  mgr.clear();

  assert.equal(mgr.list.length, 0);
  assert.equal(mgr.pack.members.length, 0);
  assert.equal(physics.ragdolls.length, 0, 'no ragdoll left running');
  /* Bodies are conserved: everything that was live or pooled before the clear
   * is pooled after it. Nothing is dropped on the floor for the GC, which is
   * the whole reason the pool exists. */
  assert.equal(pooled(), bodies, `${bodies} bodies existed, ${pooled()} came back`);
  for (const [typeId, count] of Object.entries(spawned)) {
    assert.ok(mgr.pools[typeId].length >= count, `${typeId}: fewer pooled than were spawned`);
  }
  for (const pool of Object.values(mgr.pools)) {
    assert.ok(pool.length >= 1, 'every archetype keeps at least its prewarmed body');
    for (const e of pool) assert.equal(e.object.visible, false);
  }

  /* The VFX stream is reset too, so run 2 throws exactly the same sparks as
   * run 1 — the property the seeded-determinism test below relies on. */
  const after = mgr.vfxRng.next();
  mgr.clear();
  assert.equal(mgr.vfxRng.next(), after, 'clear() rewinds the VFX rng');
});

/* ================================================================== */
/* seeded determinism                                                  */
/* ================================================================== */

test('the same seed spawns identical creatures, field for field', () => {
  /* Everything `spawn()` randomises (src/enemies.js:248-309) comes off the
   * shared gameplay Rng, which main.js reseeds on every startGame()
   * (src/main.js:911). So a replay of the same wave has to produce the same
   * facings, the same first attack timings and the same strafe directions. This
   * is the manager's half of a reproducible run; the spawn positions themselves
   * come from the wave director in main.js, which is not loadable here. */
  const fingerprint = (seed) => {
    const { mgr } = makeManager({ seed });
    const out = [];
    for (const typeId of ['whelp', 'whelp', 'spitter', 'golem', 'boss']) {
      const e = mgr.spawn(typeId, new THREE.Vector3(3, 0, 7));
      out.push([
        typeId, e.serial, e.facing, e.attackCd, e.animPhase, e.gait,
        e.strafe, e.avoidSide, e.sweepSide, e.deathSide,
        e.perchCd, e.perchScan, e.aggroNext, e.aggroScan,
        e.pos.x, e.pos.y, e.pos.z,
      ].join('|'));
    }
    return out.join('\n');
  };

  assert.equal(fingerprint(SEED), fingerprint(SEED), 'the same seed replays exactly');
  assert.notEqual(fingerprint(SEED), fingerprint(SEED + 1), 'and a different seed does not');
});

test('a seeded fight replays identically down to every creature position', () => {
  /* The stronger claim: not just the spawn, but ten seconds of AI, steering,
   * separation and collision. Two managers on the same seed, given the same
   * player track, must stay in lockstep. Anything reaching for Math.random in
   * the AI path — or any iteration order that depends on object identity —
   * breaks this and nothing else. */
  const trace = (seed) => {
    const { mgr } = makeManager({ seed });
    for (let i = 0; i < 5; i++) {
      mgr.spawn('whelp', new THREE.Vector3(Math.cos(i) * 18, 0, Math.sin(i) * 18));
    }
    mgr.spawn('spitter', new THREE.Vector3(0, 0, 26));
    mgr.spawn('golem', new THREE.Vector3(-14, 0, 8));

    const samples = [];
    for (let i = 0; i < 600; i++) {
      // the player walks a circle, so line of sight and range keep changing
      const a = i * 0.01;
      const c = ctx(Math.cos(a) * 6, Math.sin(a) * 6);
      mgr.update(DT, c);
      if (i % 120 === 0) {
        samples.push(mgr.list.map((e) => [
          e.typeId, e.state, e.pos.x.toFixed(9), e.pos.y.toFixed(9), e.pos.z.toFixed(9),
          e.facing.toFixed(9), e.role, e.hp,
        ].join(',')).join(';'));
      }
    }
    return samples.join('\n');
  };

  const a = trace(SEED);
  assert.equal(a, trace(SEED), 'the same seed produced a different fight');
  assert.notEqual(a, trace(SEED + 7), 'and a different seed produced the same one');
  assert.ok(a.length > 100, 'the trace is not empty');
});
