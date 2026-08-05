/**
 * Performance tests.
 *
 * Deliberately not benchmarks. A millisecond figure measured on whatever
 * machine happens to run `npm test` is worthless as an assertion — it either
 * passes everywhere including on a regression, or flakes on a busy CI box. So
 * with one flagged exception these count *work* instead of timing it: boxes
 * examined, heightfield samples taken, bodies allocated, programs asked for.
 * A counted budget means the same thing on any machine, and it fails for a
 * reason you can read off the assertion.
 *
 * What is guarded here, and why each one earned a test:
 *
 *   - The shader warm-up. A wave start used to cost 139-442 ms because the
 *     boot warm-up compiled program variants no frame ever used, leaving the
 *     real ones to build on the frame the first rift, its particle layers and
 *     its decals all appeared at once. The renderer half of that fix cannot be
 *     tested under `node --test` (no WebGL context), but the two invariants it
 *     rests on can be, and they are the ones a future edit would break
 *     silently rather than loudly.
 *   - The collision broad phase. Every creature resolve, every ground probe
 *     and every bolt goes through it, tens of thousands of times a second,
 *     against ~48 000 colliders. Losing the grid would not fail a correctness
 *     test — it would just make the game unplayable.
 *   - The terrain ray march. Its sample count is set by a step size that looks
 *     like a tuning knob and is really a per-shot cost multiplier.
 *   - The body pool. It is preallocated precisely so that a wave of deaths
 *     does not hand the GC 128 fresh bodies mid-fight.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics.js';
import { PhysicsWorld } from '../src/rigidbody.js';
import { createRift, warmRiftProgram } from '../src/vfx/rift.js';
import { makeShared } from '../src/vfx/shared.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Deterministic 0..1 stream — these tests must not drift run to run. */
function stream(seed) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

/**
 * A collider population the size and shape of the real thing: `world.stats`
 * reports ~48 000 boxes over the 1.5 km map, which is the number the broad
 * phase actually has to survive.
 */
function cityLike(count, { extent = 1500, seed = 12345 } = {}) {
  const world = new CollisionWorld();
  const rnd = stream(seed);
  for (let i = 0; i < count; i++) {
    world.add(
      (rnd() - 0.5) * extent, (rnd() - 0.5) * extent,
      6 + rnd() * 18, 6 + rnd() * 18,
      0, 8 + rnd() * 24, 'building',
    );
  }
  return world;
}

/** Counts the candidates the broad phase hands to a narrow-phase test. */
function countingWorld(world) {
  const query = world.query.bind(world);
  const tally = { queries: 0, candidates: 0 };
  world.query = (...args) => {
    const out = query(...args);
    tally.queries++;
    tally.candidates += out.length;
    return out;
  };
  return tally;
}

/**
 * The VFX facade a rift borrows its pools from, reduced to a tally. `createRift`
 * takes every shared system through this object, so a fake is enough to build a
 * real rift with no renderer, no canvas and no atlas in sight.
 */
function fakeFx() {
  const calls = { scorch: 0, inflow: 0, wisp: 0, open: 0, collapse: 0, adopted: [], remembered: [], forgotten: [] };
  return {
    calls,
    rng: { float: (a, b) => (a + b) / 2, next: () => 0.5 },
    acquireRiftLight: () => null,
    scorch: () => { calls.scorch++; },
    riftInflow: () => { calls.inflow++; },
    riftWisp: () => { calls.wisp++; },
    riftOpen: () => { calls.open++; },
    riftCollapse: () => { calls.collapse++; },
    adoptDyingRift: (mesh, geo, mat) => calls.adopted.push({ mesh, geo, mat }),
    rememberRift: (r) => calls.remembered.push(r),
    forgetRift: (r) => calls.forgotten.push(r),
  };
}

/* ================================================================== */
/* shader warm-up                                                      */
/* ================================================================== */

/**
 * Everything three bakes into a program cache key that a ShaderMaterial can
 * differ on. `side` is in here because it becomes DOUBLE_SIDED/FLIP_SIDED
 * defines, `premultipliedAlpha` and `alphaToCoverage` because they are program
 * parameters in their own right, and the blend factors because a warm-up that
 * matched the program but not the blend state would still not be warming what
 * the game draws.
 */
const PROGRAM_KEYED = [
  'vertexShader', 'fragmentShader', 'glslVersion', 'flatShading', 'side',
  'transparent', 'premultipliedAlpha', 'alphaToCoverage', 'depthTest', 'depthWrite',
  'blending', 'blendSrc', 'blendDst', 'blendSrcAlpha', 'blendDstAlpha', 'blendEquation',
];

test('the parked rift warm-up asks for exactly the program a real rift draws with', () => {
  const scene = new THREE.Scene();
  const shared = makeShared();

  const warm = warmRiftProgram(scene, shared);
  const rift = createRift(fakeFx(), scene, shared, new THREE.Vector3(112, 0, -34), 1);

  /* If these ever diverge the warm-up still compiles a rift-shaped program at
   * boot — just not the one any rift uses — and the stall comes back looking
   * exactly like it did before, with nothing in the code to point at. */
  for (const key of PROGRAM_KEYED) {
    assert.deepEqual(
      warm.material[key], rift.mesh.material[key],
      `warm-up and live rift materials differ on '${key}', so they are two programs`,
    );
  }
  assert.deepEqual(
    Object.keys(warm.material.uniforms).sort(),
    Object.keys(rift.mesh.material.uniforms).sort(),
    'both materials must declare the same uniform block',
  );
  /* Per-rift values are the whole reason a rift cannot share one material: the
   * seed decides where in the noise field its tear is torn. */
  assert.notEqual(
    rift.mesh.material.uniforms.uSeed.value, warm.material.uniforms.uSeed.value,
    'a rift seeds itself from its position — the warm-up is not doubling as a template',
  );
});

test('a hidden warm-up mesh is reachable by the traversal renderer.compile() uses', () => {
  const scene = new THREE.Scene();
  const warm = warmRiftProgram(scene, makeShared());

  assert.equal(warm.visible, false, 'the warm-up must never draw');

  /* This is the property the whole prewarm rests on, and it is a property of
   * three, not of this repo: compile() gathers *lights* with traverseVisible
   * but materials with plain traverse. That is what lets the pooled creatures,
   * the idle particle layers and this mesh all be warmed while hidden. If a
   * three upgrade ever changed it, every one of them would go cold again and
   * this is the test that would say so. */
  const traversed = [];
  scene.traverse((o) => { if (o.isMesh) traversed.push(o); });
  assert.ok(traversed.includes(warm), 'traverse() reaches it, so compile() warms it');

  const visible = [];
  scene.traverseVisible((o) => { if (o.isMesh) visible.push(o); });
  assert.equal(visible.includes(warm), false, 'and traverseVisible() does not — no frame draws it');
});

test('sealing a rift releases its own mesh and never the parked warm-up', () => {
  const scene = new THREE.Scene();
  const shared = makeShared();
  const fx = fakeFx();

  const warm = warmRiftProgram(scene, shared);
  const baseline = scene.children.length;

  /* Rifts are opened and sealed every wave, so a leak here compounds for as
   * long as a run lasts, and a warm-up disposed along with them would take the
   * cached program with it — three drops a program once its last material is
   * gone. */
  for (let i = 0; i < 6; i++) {
    const rift = createRift(fx, scene, shared, new THREE.Vector3(i * 30, 0, i * 12), 1);
    assert.equal(scene.children.length, baseline + 1, 'one mesh per live rift');
    rift.dispose();
    assert.equal(scene.children.length, baseline, 'and it leaves when sealed');
  }

  assert.ok(scene.children.includes(warm), 'the warm-up outlives every rift');
  assert.equal(warm.material.uniforms.uOpen.value, 0, 'and was never driven by one');
  assert.deepEqual(fx.calls.forgotten.length, 6, 'each rift deregistered itself');
});

test('a rift killed by gunfire hands its mesh over instead of leaking it', () => {
  const scene = new THREE.Scene();
  const shared = makeShared();
  const fx = fakeFx();
  warmRiftProgram(scene, shared);

  const rift = createRift(fx, scene, shared, new THREE.Vector3(0, 0, 0), 1);
  /* What VFX.explosion() sets when a blast lands on a live rift, one line
   * before main.js disposes it. The mesh then belongs to VFX for the length of
   * the collapse, which is the only path where dispose() must NOT free it. */
  rift._collapsing = 1;
  rift.dispose();

  assert.equal(fx.calls.adopted.length, 1, 'the dying mesh is handed to VFX');
  const adopted = fx.calls.adopted[0];
  assert.equal(adopted.mesh, rift.mesh);
  assert.ok(adopted.geo && adopted.mat, 'with the geometry and material VFX has to free');
  assert.ok(scene.children.includes(rift.mesh), 'still in the scene — VFX removes it when the collapse ends');
});

/* ================================================================== */
/* collision broad phase                                               */
/* ================================================================== */

test('colliders on the far side of the city cost a local query nothing', () => {
  /* The invariant is not "candidate count is constant" — a denser district
   * genuinely has more boxes under a point. It is that distance is free: 40 000
   * colliders a kilometre away must not enter a single narrow-phase test. That
   * is exactly what a linear scan would get wrong. */
  const near = cityLike(60, { extent: 200, seed: 7 });
  const probes = [];
  const rnd = stream(4242);
  for (let i = 0; i < 500; i++) probes.push([(rnd() - 0.5) * 180, (rnd() - 0.5) * 180]);

  const sample = (world) => {
    const tally = countingWorld(world);
    for (const [x, z] of probes) world.isSolidAt(x, 2, z);
    return tally.candidates;
  };

  const before = sample(near);

  // same 60 colliders, plus a full city's worth well outside the probe area
  const rnd2 = stream(99);
  for (let i = 0; i < 40000; i++) {
    near.add(600 + rnd2() * 400, 600 + rnd2() * 400, 10, 10, 0, 20, 'building');
  }
  const after = sample(near);

  assert.equal(near.boxes.length, 40060, 'the far colliders really are in the world');
  assert.equal(after, before, `distant colliders leaked into local queries (${before} -> ${after})`);
});

test('a point query against the whole city examines a handful of boxes, not the city', () => {
  const world = cityLike(48000);
  const tally = countingWorld(world);
  const rnd = stream(31337);

  const probes = 4000;
  for (let i = 0; i < probes; i++) {
    world.isSolidAt((rnd() - 0.5) * 1400, 2, (rnd() - 0.5) * 1400);
  }

  const perQuery = tally.candidates / tally.queries;
  /* Measured at ~4.6 candidates per probe against 48 000 colliders. The ceiling
   * is loose because it tracks how densely the fixture happens to pack the map,
   * not the grid's behaviour; what it catches is the difference between a grid
   * lookup and a scan, which is four orders of magnitude away from here. */
  assert.ok(
    perQuery < 60,
    `${perQuery.toFixed(1)} boxes examined per point query — the broad phase is not culling`,
  );
  assert.equal(tally.queries, probes, 'one broad-phase lookup per query, no repeats');
});

test('a capsule resolve re-queries once per push pass and no more', () => {
  /* resolve() deliberately refreshes its candidates every iteration, because a
   * push can move the capsule into a box the previous rectangle missed. Three
   * passes is the budget; a fourth would be a silent 33% on the hottest path
   * in the game, since every creature and the player run this every frame. */
  const world = cityLike(2000, { seed: 5 });
  const tally = countingWorld(world);

  const pos = new THREE.Vector3(0, 1, 0);
  world.resolve(pos, 0.4, 1.8);
  assert.ok(tally.queries >= 1 && tally.queries <= 3, `${tally.queries} broad-phase lookups in one resolve`);

  // wedged into a corner, so every pass pushes and none of them short-circuits
  world.add(2, 0, 4, 4, 0, 10, 'building');
  world.add(-2, 0, 4, 4, 0, 10, 'building');
  world.add(0, 2, 4, 4, 0, 10, 'building');
  tally.queries = 0;
  world.resolve(pos.set(0, 1, 0), 0.4, 1.8);
  assert.ok(tally.queries <= 3, `${tally.queries} lookups for a wedged capsule — the pass cap slipped`);
});

/* ================================================================== */
/* terrain ray march                                                   */
/* ================================================================== */

test('a terrain cast samples the heightfield a bounded number of times', () => {
  let samples = 0;
  const terrain = {
    cellSize: 4,
    maxHeight: 60,
    heightAt() { samples++; return 8; },
    normalAt() { return { x: 0, y: 1, z: 0 }; },
  };
  const world = new CollisionWorld().setTerrain(terrain);
  const origin = new THREE.Vector3(0, 40, 0);
  const dir = new THREE.Vector3(0.4, -0.28, 0.87).normalize();

  /* The march steps at min(requested, cellSize/2) and then binary-refines the
   * bracketing pair ten times. Every bolt, every line-of-sight check and every
   * explosion occlusion ray pays this, so the budget is per-metre: shrinking
   * the step to please one caller multiplies the cost of all of them. */
  for (const [dist, budget] of [[40, 120], [120, 320], [300, 700]]) {
    samples = 0;
    world.raycast(origin, dir, dist);
    assert.ok(samples <= budget, `a ${dist} m cast took ${samples} heightfield samples (budget ${budget})`);
    assert.ok(samples > 0, 'and it really did march the terrain');
  }

  /* A cast that hits must stop there rather than march out its full length —
   * this is what keeps a point-blank shot cheaper than a skyline one. */
  samples = 0;
  world.raycast(new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, -1, 0), 600);
  const short = samples;
  samples = 0;
  world.raycast(new THREE.Vector3(0, 400, 0), new THREE.Vector3(0, -1, 0), 600);
  assert.ok(short < samples, 'a cast that hits immediately must not pay for the whole ray');
});

test('a cast that starts above the heightfield ceiling is rejected without marching', () => {
  let samples = 0;
  const terrain = {
    cellSize: 4,
    maxHeight: 60,
    heightAt() { samples++; return 8; },
    normalAt() { return { x: 0, y: 1, z: 0 }; },
  };
  const world = new CollisionWorld().setTerrain(terrain);

  // the dragon's-eye case: high up, looking up. Nothing below can be hit.
  world.raycast(new THREE.Vector3(0, 800, 0), new THREE.Vector3(0.2, 0.9, 0.3).normalize(), 900);
  assert.equal(samples, 0, 'the maxHeight early-out is what keeps flying cheap');
});

/* ================================================================== */
/* body pool                                                           */
/* ================================================================== */

test('forty waves of debris allocate no bodies beyond the pool', () => {
  const world = cityLike(3000, { seed: 11 });
  const physics = new PhysicsWorld(world, { seed: 4 });
  const capacity = physics.opt.maxBodies;

  /* Body identity is the witness here: the pool is built once in the
   * constructor and a released body goes back into it, so a run that churns
   * through a thousand spawns must keep handing out the same 128 objects. The
   * moment it does not, every wave is feeding the GC mid-fight. */
  const seen = new Set();
  for (let wave = 0; wave < 40; wave++) {
    for (let i = 0; i < 24; i++) {
      const body = physics.spawnBody({
        shape: 'box',
        position: { x: i * 2, y: 20, z: wave * 3 },
        half: { x: 0.3, y: 0.3, z: 0.3 },
        mass: 8,
      });
      if (body) seen.add(body);
    }
    for (let s = 0; s < 20; s++) physics.step(1 / 60);
  }

  assert.equal(seen.size, capacity, `${seen.size} distinct bodies handed out for a pool of ${capacity}`);
  assert.equal(physics.bodies.length + physics._pool.length, capacity, 'every body is either live or pooled');
  assert.equal(physics.stats().capacity, capacity);
});

test('a pile-up stays inside the preallocated contact budget', () => {
  const world = cityLike(1, { seed: 3 });
  const physics = new PhysicsWorld(world, { seed: 6 });

  /* Contacts are preallocated too, and the solver refuses to grow the array
   * mid-step. Dropping the whole pool into one heap is the worst case: if the
   * budget were ever undersized for it, contacts would be silently dropped and
   * the pile would sink into itself rather than hitching — so this asserts the
   * count is inside the budget *and* that the heap is actually contacting. */
  for (let i = 0; i < physics.opt.maxBodies; i++) {
    physics.spawnBody({
      shape: 'box',
      position: { x: (i % 8) * 0.5, y: 0.4 + Math.floor(i / 8) * 0.45, z: 0 },
      half: { x: 0.3, y: 0.2, z: 0.3 },
      mass: 6,
      lifetime: Infinity,
    });
  }
  /* Sampled per step, not at the end: the count is per-step state, and a heap
   * this size has settled and fallen asleep by the time the loop is over. */
  let peak = 0;
  for (let s = 0; s < 120; s++) {
    physics.step(1 / 60);
    peak = Math.max(peak, physics.stats().contacts);
  }

  assert.ok(peak > 0, 'the heap really is in contact with itself');
  assert.ok(
    peak < physics._maxContacts,
    `peak ${peak} contacts against a budget of ${physics._maxContacts} — the pool is undersized`,
  );
});

test('a full body pool steps in well under a frame', () => {
  /* The one wall-clock test in this file, and the only one that can flake.
   * `lastStepMs` is the solver's own measurement, the budget is ~50x what this
   * costs on a dev machine, and the point is not to measure anything: it is to
   * catch a change that makes the solver quadratic in body count, which would
   * blow through this by orders of magnitude on any hardware. Widen it, do not
   * delete it, if a slow CI box ever trips it. */
  const world = cityLike(2000, { seed: 9 });
  const physics = new PhysicsWorld(world, { seed: 12 });
  for (let i = 0; i < physics.opt.maxBodies; i++) {
    physics.spawnBody({
      shape: 'box',
      position: { x: (i % 16) * 1.5, y: 2 + Math.floor(i / 16), z: (i % 7) * 1.5 },
      half: { x: 0.3, y: 0.3, z: 0.3 },
      mass: 6,
      lifetime: Infinity,
    });
  }

  let worst = 0;
  for (let s = 0; s < 240; s++) {
    physics.step(1 / 60);
    worst = Math.max(worst, physics.stats().lastStepMs);
  }
  assert.equal(physics.bodies.length, physics.opt.maxBodies, 'the pool really is full');
  assert.ok(worst < 25, `worst physics frame ${worst.toFixed(2)} ms with a full pool`);
});
