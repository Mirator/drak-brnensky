/**
 * Cross-module integration tests.
 *
 * `test/city.test.js` covers the breakables registry against a hand-written
 * fake physics world, which is the right unit test. These go the other way and
 * wire the *real* `CollisionWorld`, the *real* `PhysicsWorld` and the city's own
 * descriptor shape together, because the bug that reached review lived precisely
 * in the seams between them: the descriptors were correct, the registry was
 * correct, and nothing was ever breakable in the running game.
 *
 * Not covered here: the call sites in `src/main.js`. That module constructs a
 * WebGL renderer at import time, so it cannot be loaded under `node --test`.
 * What these tests pin down is the contract `main.js` depends on — that a
 * registered prop actually breaks, and that a `clear()` followed by the
 * re-registration path leaves it breakable again. The wiring itself is verified
 * in the browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics.js';
import { PhysicsWorld } from '../src/rigidbody.js';
import { createBreakables, instanceVisual, rebuildableColliders } from '../src/city/breakables.js';
import { InstanceSet } from '../src/city/mesh.js';

/**
 * A bench-like prop, built the way `src/city/props.js` builds one: the collider
 * goes through `rebuildableColliders` so the descriptor remembers the
 * `collision.add` arguments and `restore()` can recreate it. Adding the box
 * directly would still register and still break, but would silently not be
 * restorable — which is exactly the shape of bug these tests exist to catch.
 */
function benchAt(collision, registry, set, x, z) {
  const { colliders, rebuild } = rebuildableColliders(collision, [
    [x, z, 2.2, 0.8, 0, 0.95, 'prop', 'wood'],
  ]);
  const index = set.push(x, 0, z);
  const desc = registry.add({
    colliders,
    rebuild,
    chunks: 6,
    threshold: 32,
    mass: 26,
    surface: 'wood',
    seed: 0x33c1 ^ Math.round(x * 53 + z * 7),
    label: 'bench',
    ...instanceVisual([[set, index]]),
  });
  return { box: colliders[0], index, desc };
}

function scaleLengthAt(mesh, i) {
  const m = new THREE.Matrix4();
  mesh.getMatrixAt(i, m);
  return new THREE.Vector3().setFromMatrixScale(m).length();
}

test('a city breakable registered with the real PhysicsWorld actually breaks', () => {
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);
  const registry = createBreakables();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  const bench = benchAt(collision, registry, set, 40, 12);
  const mesh = set.finish(new THREE.Group());

  assert.equal(registry.register(physics), 1, 'the real world accepts the city descriptor shape');
  assert.equal(physics.breakables.length, 1);
  assert.ok(scaleLengthAt(mesh, bench.index) > 0, 'starts visible');

  /* Hold the prop by reference: breakProp() calls unregisterBreakable(), which
   * splices it out of physics.breakables, so indexing the array after a break
   * reads whatever shuffled into that slot. */
  const prop = physics.breakables[0];
  const point = { x: 40, y: 0.5, z: 12 };

  // under the threshold it only accumulates damage
  physics.reportImpact(point, 10, { x: 1, y: 0, z: 0 });
  assert.ok(!prop.broken, 'a light tap does not break it');
  assert.ok(scaleLengthAt(mesh, bench.index) > 0, 'still visible after a light tap');

  // over the threshold it breaks, sheds chunks, and stops being solid
  const bodiesBefore = physics.bodies.length;
  physics.reportImpact(point, 400, { x: 1, y: 0, z: 0 });

  assert.equal(prop.broken, true, 'breaks above the threshold');
  assert.equal(physics.breakables.length, 0, 'and leaves the live registry');
  assert.ok(physics.bodies.length > bodiesBefore, 'sheds chunk bodies');
  assert.equal(
    scaleLengthAt(mesh, bench.index), 0,
    'the intact instance is collapsed, so debris does not appear beside a standing bench',
  );
  assert.equal(
    collision.boxes.includes(bench.box), false,
    'the static collider is gone, so the player can walk through the wreckage',
  );
});

test('breakables survive the clear() that starting a run performs', () => {
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);
  const registry = createBreakables();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  benchAt(collision, registry, set, -20, 60);
  benchAt(collision, registry, set, -14, 60);
  set.finish(new THREE.Group());

  assert.equal(registry.register(physics), 2);
  assert.equal(physics.breakables.length, 2);

  /* This is what startGame() does, and it is what silently disarmed every prop
   * in the city: clear() empties the registry along with the bodies. */
  physics.clear();
  assert.equal(physics.breakables.length, 0);

  /* The plain path must NOT resurrect them — the memo is deliberate, so that an
   * accidental double call cannot double-register. */
  assert.equal(registry.register(physics), 0, 'the memo still absorbs accidental calls');
  assert.equal(physics.breakables.length, 0);

  /* ...and this is the path main.js takes after every clear(). */
  assert.equal(registry.reregister(physics), 2, 'the forced path rebuilds the registry');
  assert.equal(physics.breakables.length, 2);
});

test('a prop is still breakable after a restart cycle', () => {
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);
  const registry = createBreakables();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  const bench = benchAt(collision, registry, set, 8, -30);
  const mesh = set.finish(new THREE.Group());

  registry.register(physics);
  // run 1 ends, run 2 begins
  physics.clear();
  assert.equal(registry.reregister(physics), 1, 're-armed for the second run');

  const prop = physics.breakables[0];
  physics.reportImpact({ x: 8, y: 0.5, z: -30 }, 400, { x: 0, y: 0, z: 1 });
  assert.equal(prop.broken, true, 'breaks on the second run too');
  assert.equal(scaleLengthAt(mesh, bench.index), 0, 'and its visual is collapsed');
});

test('an already-smashed prop is not resurrected by a re-registration', () => {
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);
  const registry = createBreakables();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  const bench = benchAt(collision, registry, set, 0, 0);
  set.finish(new THREE.Group());
  registry.register(physics);

  const prop = physics.breakables[0];
  physics.reportImpact({ x: 0, y: 0.5, z: 0 }, 400, { x: 1, y: 0, z: 0 });
  assert.equal(prop.broken, true);
  assert.equal(bench.desc.broken, true, 'the descriptor is marked, not just the prop');

  /* Re-registering mid-run must not hand a smashed bench back as intact, or it
   * would shed a second set of chunks out of thin air. */
  const bodiesAfterBreak = physics.bodies.length;
  assert.equal(registry.reregister(physics), 0, 'a smashed descriptor is skipped');
  physics.reportImpact({ x: 0, y: 0.5, z: 0 }, 400, { x: 1, y: 0, z: 0 });
  assert.equal(
    physics.bodies.length, bodiesAfterBreak,
    'no second helping of debris from a prop that is already wreckage',
  );
});

test('a restart puts a prop smashed in the previous run back, solid and breakable', () => {
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);
  const registry = createBreakables();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  const bench = benchAt(collision, registry, set, 24, -8);
  const mesh = set.finish(new THREE.Group());
  const collidersIntact = collision.boxes.length;

  registry.register(physics);
  physics.reportImpact({ x: 24, y: 0.5, z: -8 }, 400, { x: 1, y: 0, z: 0 });
  assert.equal(bench.desc.broken, true, 'smashed during run 1');
  assert.equal(scaleLengthAt(mesh, bench.index), 0, 'and collapsed');
  assert.ok(collision.boxes.length < collidersIntact, 'its collider left the grid');

  /* Exactly what startGame() does on the next run. */
  physics.clear();
  const restored = registry.restore();
  const registered = registry.register(physics, { force: true });

  assert.equal(restored, 1, 'the restart restored it');
  assert.equal(registered, 1, 'and re-armed it');
  assert.equal(bench.desc.broken, false, 'no longer flagged broken');
  assert.equal(
    collision.boxes.length, collidersIntact,
    'collider count is back where it started — no leak, no double-add',
  );
  assert.ok(scaleLengthAt(mesh, bench.index) > 0, 'and it is visible again');

  /* The collider in the descriptor must be the fresh one that is actually in
   * the grid, or registerBreakable would derive centre and radius from a box
   * the world no longer knows about. */
  assert.ok(
    collision.boxes.includes(bench.desc.colliders[0]),
    'the descriptor points at the live box',
  );

  // and it breaks again on the new run, shedding chunks a second time
  const bodiesBefore = physics.bodies.length;
  physics.reportImpact({ x: 24, y: 0.5, z: -8 }, 400, { x: 1, y: 0, z: 0 });
  assert.equal(bench.desc.broken, true, 'breakable again after the restart');
  assert.ok(physics.bodies.length > bodiesBefore, 'and sheds chunks again');
});

test('restore is the only route back — re-registration alone never resurrects', () => {
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);
  const registry = createBreakables();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());

  const bench = benchAt(collision, registry, set, -60, 4);
  const mesh = set.finish(new THREE.Group());

  registry.register(physics);
  physics.reportImpact({ x: -60, y: 0.5, z: 4 }, 400, { x: 1, y: 0, z: 0 });
  assert.equal(bench.desc.broken, true);

  // mid-run re-registration must leave wreckage as wreckage
  assert.equal(registry.reregister(physics), 0);
  assert.equal(bench.desc.broken, true, 'still broken');
  assert.equal(scaleLengthAt(mesh, bench.index), 0, 'still invisible');

  // only restore brings it back
  assert.equal(registry.restore(), 1);
  assert.equal(bench.desc.broken, false);
  assert.ok(scaleLengthAt(mesh, bench.index) > 0);
});

test('the dynamic world advances a body whenever step() is called', () => {
  /* The regression this guards: `stepGame(dt, frozen)` used to skip
   * physics.step() while the player was dead, so the corpse received exactly
   * one step — the death frame — and then hung in the air for the whole
   * game-over sequence. main.js now steps unconditionally; this pins the
   * property it relies on, that stepping is what makes a body fall and not
   * stepping leaves it exactly where it was. */
  const collision = new CollisionWorld();
  const physics = new PhysicsWorld(collision);

  const body = physics.spawnBody({
    shape: 'box',
    position: { x: 0, y: 40, z: 0 },
    half: { x: 0.2, y: 0.2, z: 0.2 },
    mass: 5,
  });
  assert.ok(body, 'body pool has room');
  const startY = body.position.y;

  // not stepping must not move it
  assert.equal(body.position.y, startY);

  for (let i = 0; i < 30; i++) physics.step(1 / 60);
  assert.ok(body.position.y < startY - 0.5, `falls when stepped (y ${body.position.y})`);
  assert.ok(Number.isFinite(body.position.y), 'and stays finite');

  const midY = body.position.y;
  for (let i = 0; i < 600; i++) physics.step(1 / 60);
  assert.ok(body.position.y < midY, 'keeps falling towards the ground');
  assert.ok(body.position.y > -50, 'and does not escape the world');
});
