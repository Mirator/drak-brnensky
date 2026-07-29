import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld, SURFACES } from '../src/physics.js';
import {
  PhysicsWorld, RigidBodySystem, RAGDOLL_TEMPLATES, buildRagdollBones, fracture,
  ragdollBonesFromObjects, playerRagdollBones, PLAYER_RAGDOLL_SPEC,
} from '../src/rigidbody.js';
import { Rng } from '../src/rng.js';

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */
function flatWorld(bounds = 200) {
  const world = new CollisionWorld();
  world.bounds = { x0: -bounds, z0: -bounds, x1: bounds, z1: bounds };
  return world;
}

function run(physics, seconds, dt = 1 / 60) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) physics.step(dt);
}

function finite(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/* ================================================================== *
 * surfaces — additive, and existing add() calls keep working
 * ================================================================== */
test('colliders get a surface inferred from their tag, and can override it', () => {
  const world = flatWorld();
  const plain = world.add(0, 0, 2, 2, 0, 2);                       // no tag at all
  const building = world.add(10, 0, 2, 2, 0, 2, 'building');
  const pane = world.add(20, 0, 2, 2, 0, 2, 'prop', 'glass');
  const custom = world.add(30, 0, 2, 2, 0, 2, 'prop', SURFACES.metal);

  assert.equal(world.surfaceOf(plain).id, 'stone');
  assert.equal(world.surfaceOf(building).id, 'stone');
  assert.equal(world.surfaceOf(pane).id, 'glass');
  assert.equal(world.surfaceOf(custom).id, 'metal');
  // the implicit street plane
  assert.equal(world.surfaceOf(null).id, 'cobble');
  assert.equal(world.surfaceAt(20, 1, 0).id, 'glass');
  assert.equal(world.surfaceAt(200, 1, 200).id, 'cobble');
});

test('raycastHit reports normal, collider and surface', () => {
  const world = flatWorld();
  world.add(5, 0, 1, 4, 0, 3, 'prop', 'wood');
  const hit = world.raycastHit(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(1, 0, 0), 10);
  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.t - 4.5) < 1e-9);
  assert.deepEqual([hit.nx, hit.ny, hit.nz], [-1, 0, 0]);
  assert.equal(hit.surface.id, 'wood');

  // ignoreGround leaves the street plane out of the way
  const down = new THREE.Vector3(0, -1, 0);
  assert.equal(world.raycastHit(new THREE.Vector3(0, 5, 0), down, 10).hit, true);
  assert.equal(world.raycastHit(new THREE.Vector3(0, 5, 0), down, 10, undefined, true).hit, false);
});

/* ================================================================== *
 * swept collision — the thin wall case
 * ================================================================== */
test('swept sphere hits a 10 cm wall no matter how fast the sweep is', () => {
  const world = flatWorld();
  world.add(50, 0, 0.1, 20, 0, 6, 'building');   // wall spans x 49.95 .. 50.05

  for (const dist of [60, 600, 6000, 60000]) {
    const hit = world.sweepSphere(
      new THREE.Vector3(0, 2, 0), new THREE.Vector3(1, 0, 0), dist, 0.05,
    );
    assert.equal(hit.hit, true, `missed the wall over ${dist} m`);
    assert.ok(Math.abs(hit.t - 49.9) < 1e-6, `t was ${hit.t}`);
    assert.deepEqual([hit.nx, hit.ny, hit.nz], [-1, 0, 0]);
  }
});

test('a projectile at 900 m/s cannot tunnel a thin wall', () => {
  const world = flatWorld();
  world.add(120, 0, 0.08, 30, 0, 8, 'building', 'glass');
  const physics = new PhysicsWorld(world, { seed: 5 });

  let hit = null;
  physics.onProjectileHit = (p, h) => {
    hit = { x: h.px, surface: h.surface.id, nx: h.nx };
  };
  physics.spawnProjectile(
    new THREE.Vector3(0, 2, 0), new THREE.Vector3(900, 0, 0),
    { radius: 0.02, gravity: 0, drag: 0 },
  );
  run(physics, 0.5);

  assert.ok(hit, 'projectile passed straight through the wall');
  assert.ok(Math.abs(hit.x - 119.94) < 1e-6, `hit at x=${hit.x}`);
  assert.equal(hit.nx, -1);
  assert.equal(hit.surface.id ?? hit.surface, 'glass');
  assert.equal(physics.projectiles.length, 0, 'projectile should have despawned');
});

test('a rigid body launched at 200 m/s stops at the wall instead of through it', () => {
  const world = flatWorld();
  world.add(30, 0, 0.12, 40, 0, 10, 'building');
  const physics = new PhysicsWorld(world, { seed: 5 });
  const b = physics.spawnBody({
    shape: 'box', half: { x: 0.15, y: 0.15, z: 0.15 },
    position: { x: 0, y: 2, z: 0 }, mass: 5,
    velocity: { x: 200, y: 0, z: 0 },
  });
  run(physics, 2);
  assert.ok(b.active, 'body should still be alive');
  assert.ok(b.position.x < 30, `body ended up at x=${b.position.x}, past the wall`);
});

/* ================================================================== *
 * integration stability
 * ================================================================== */
test('10 000 steps stay finite, in bounds, and settle', () => {
  const world = flatWorld(60);
  world.add(0, 0, 10, 10, 0, 6, 'building');
  world.add(-14, 6, 3, 3, 0, 1.2, 'prop', 'wood');
  world.add(12, -8, 1.4, 8, 0, 2.4, 'prop', 'metal');

  const physics = new PhysicsWorld(world, { seed: 1234, maxBodies: 64 });
  const rng = new Rng(99);
  const bodies = [];
  for (let i = 0; i < 40; i++) {
    bodies.push(physics.spawnBody({
      shape: i % 5 === 0 ? 'sphere' : (i % 7 === 0 ? 'capsule' : 'box'),
      half: { x: rng.float(0.1, 0.4), y: rng.float(0.1, 0.4), z: rng.float(0.1, 0.4) },
      radius: rng.float(0.1, 0.3),
      length: rng.float(0.2, 0.7),
      position: { x: rng.float(-20, 20), y: rng.float(1, 14), z: rng.float(-20, 20) },
      velocity: { x: rng.float(-25, 25), y: rng.float(-10, 10), z: rng.float(-25, 25) },
      angularVelocity: { x: rng.float(-20, 20), y: rng.float(-20, 20), z: rng.float(-20, 20) },
      mass: rng.float(1, 30),
      lifetime: Infinity,
    }));
  }

  for (let i = 0; i < 10000; i++) {
    physics.step(1 / 60);
    if (i % 500 === 0) {
      for (const b of bodies) {
        if (!b.active) continue;
        assert.ok(finite(b.position), `position went non-finite at step ${i}`);
        assert.ok(finite(b.velocity), `velocity went non-finite at step ${i}`);
        assert.ok(finite(b.angularVelocity), `spin went non-finite at step ${i}`);
        assert.ok(Number.isFinite(b.quaternion.x + b.quaternion.w), 'quaternion went bad');
      }
    }
  }

  let alive = 0;
  for (const b of bodies) {
    if (!b.active) continue;
    alive++;
    assert.ok(finite(b.position));
    assert.ok(b.position.x >= -60 && b.position.x <= 60, `escaped in x: ${b.position.x}`);
    assert.ok(b.position.z >= -60 && b.position.z <= 60, `escaped in z: ${b.position.z}`);
    assert.ok(b.position.y > -6.001, `fell out of the world: ${b.position.y}`);
    assert.ok(b.position.y < 40, `climbed out of the world: ${b.position.y}`);
    assert.ok(b.sleeping, 'everything should have gone to sleep by now');
    // Resting, not sunk into the ground: no penetration beyond the slop.
    assert.ok(b.position.y > -0.05, `sank through the floor: ${b.position.y}`);
  }
  assert.ok(alive >= 35, `too many bodies vanished: ${alive}/40`);
  assert.equal(physics.stats().awake, 0);
});

test('a dropped box comes to rest on top of its support, not inside it', () => {
  const world = flatWorld();
  world.add(0, 0, 4, 4, 0, 2, 'building');       // a 2 m block
  const physics = new PhysicsWorld(world, { seed: 8 });
  const b = physics.spawnBody({
    shape: 'box', half: { x: 0.25, y: 0.25, z: 0.25 },
    position: { x: 0.2, y: 6, z: -0.1 }, mass: 8, lifetime: Infinity,
  });
  run(physics, 6);
  assert.ok(b.sleeping, 'should have settled');
  // top of the block (2) + half extent (0.25), within the solver's slop
  assert.ok(Math.abs(b.position.y - 2.25) < 0.05, `rested at y=${b.position.y}`);
});

/* ================================================================== *
 * sleeping
 * ================================================================== */
test('bodies fall asleep when they settle and wake on an impulse', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 2 });
  const b = physics.spawnBody({
    shape: 'box', half: { x: 0.2, y: 0.2, z: 0.2 },
    position: { x: 0, y: 1.5, z: 0 }, mass: 5, lifetime: Infinity,
  });

  assert.equal(b.sleeping, false);
  run(physics, 4);
  assert.equal(b.sleeping, true, 'should be asleep after settling');
  const restY = b.position.y;

  // A sleeping body must not integrate at all.
  run(physics, 2);
  assert.equal(b.position.y, restY, 'a sleeping body moved');
  assert.equal(b.velocity.lengthSq(), 0);

  b.applyImpulse(new THREE.Vector3(0, 60, 0));
  assert.equal(b.sleeping, false, 'an impulse must wake the body');
  run(physics, 0.2);
  assert.ok(b.position.y > restY + 0.2, 'should have been launched');
});

test('an explosion wakes sleeping debris', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 2 });
  const b = physics.spawnBody({
    shape: 'box', half: { x: 0.2, y: 0.2, z: 0.2 },
    position: { x: 3, y: 1, z: 0 }, mass: 5, lifetime: Infinity,
  });
  run(physics, 4);
  assert.equal(b.sleeping, true);
  const res = physics.applyExplosion(new THREE.Vector3(0, 0.8, 0), 12, 300);
  assert.equal(res.bodies, 1);
  assert.equal(b.sleeping, false);
  assert.ok(b.velocity.length() > 1, 'the blast should have moved it');
});

/* ================================================================== *
 * pool cap and eviction
 * ================================================================== */
test('the pool has a hard cap and evicts the oldest sleeping body first', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 3, maxBodies: 6 });
  // Bodies are pooled, so an evicted slot is handed straight back to the next
  // spawn — identity is not a witness. Watch the removal hook instead.
  const evicted = [];
  physics.onBodyRemove = (b) => evicted.push(b.serial);

  const settled = [];
  for (let i = 0; i < 3; i++) {
    settled.push(physics.spawnBody({
      shape: 'box', half: { x: 0.15, y: 0.15, z: 0.15 },
      position: { x: i * 3, y: 0.6, z: 0 }, mass: 4, lifetime: Infinity,
    }));
  }
  run(physics, 4);
  for (const b of settled) assert.equal(b.sleeping, true);
  const sleepingSerials = settled.map((b) => b.serial);

  // Fill the rest with bodies that are still moving.
  const flying = [];
  for (let i = 0; i < 3; i++) {
    flying.push(physics.spawnBody({
      shape: 'box', half: { x: 0.15, y: 0.15, z: 0.15 },
      position: { x: i * 3, y: 30, z: 10 }, mass: 4, lifetime: Infinity,
    }));
  }
  assert.equal(physics.bodies.length, 6);
  const flyingSerials = flying.map((b) => b.serial);
  assert.deepEqual(evicted, [], 'nothing should have been evicted yet');

  // Pool full: the oldest *sleeping* body must die, not the oldest overall.
  const extra = physics.spawnBody({
    shape: 'box', half: { x: 0.1, y: 0.1, z: 0.1 },
    position: { x: 0, y: 20, z: -10 }, mass: 2,
  });
  assert.ok(extra, 'spawn should have succeeded by evicting');
  assert.equal(physics.bodies.length, 6, 'cap must hold');
  assert.deepEqual(evicted, [sleepingSerials[0]], 'oldest sleeping body must go first');
  const live = physics.bodies.map((b) => b.serial);
  for (const s of flyingSerials) assert.ok(live.includes(s), 'awake bodies must survive');
  assert.ok(live.includes(sleepingSerials[1]));
  assert.ok(live.includes(extra.serial));

  // With nothing asleep, the oldest body overall goes.
  for (const b of physics.bodies) physics.wake(b);
  const oldest = physics.bodies.reduce((a, b) => (a.serial < b.serial ? a : b)).serial;
  evicted.length = 0;
  const more = physics.spawnBody({
    shape: 'box', half: { x: 0.1, y: 0.1, z: 0.1 },
    position: { x: 0, y: 20, z: 12 }, mass: 2,
  });
  assert.ok(more);
  assert.deepEqual(evicted, [oldest], 'oldest body overall must go when none sleep');
  assert.equal(physics.bodies.length, 6);
});

test('removed bodies fire the removal hook exactly once', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 3, maxBodies: 4 });
  let spawned = 0;
  let removed = 0;
  physics.onBodySpawn = () => spawned++;
  physics.onBodyRemove = () => removed++;
  const bodies = [];
  for (let i = 0; i < 4; i++) {
    bodies.push(physics.spawnBody({ position: { x: i, y: 5, z: 0 }, mass: 3 }));
  }
  assert.equal(spawned, 4);
  assert.equal(removed, 0);
  physics.removeBody(bodies[1]);
  assert.equal(physics.removeBody(bodies[1]), false, 'double removal must be a no-op');
  assert.equal(removed, 1);
  physics.clear();
  assert.equal(removed, 4);
  assert.equal(physics.bodies.length, 0);
});

/* ================================================================== *
 * frame-rate independence and determinism
 * ================================================================== */
test('30 Hz and 144 Hz produce the same simulation', () => {
  const build = () => {
    const world = flatWorld();
    world.add(2, 0, 3, 3, 0, 1, 'prop', 'wood');
    const physics = new PhysicsWorld(world, { seed: 77 });
    physics.spawnBody({
      shape: 'box', half: { x: 0.2, y: 0.3, z: 0.25 },
      position: { x: 0, y: 5, z: 0.4 }, mass: 7,
      velocity: { x: 4, y: 1, z: -0.5 },
      angularVelocity: { x: 3, y: -2, z: 1.5 },
      lifetime: Infinity,
    });
    return physics;
  };

  const slow = build();
  const fast = build();
  for (let i = 0; i < 30; i++) slow.step(1 / 30);        // one second
  for (let i = 0; i < 144; i++) fast.step(1 / 144);      // one second

  assert.equal(slow.stats().fixedSteps, 60);
  assert.equal(fast.stats().fixedSteps, 60);
  const a = slow.bodies[0];
  const b = fast.bodies[0];
  for (const k of ['x', 'y', 'z']) {
    assert.ok(
      Math.abs(a.position[k] - b.position[k]) < 1e-9,
      `position.${k} diverged: ${a.position[k]} vs ${b.position[k]}`,
    );
    assert.ok(Math.abs(a.velocity[k] - b.velocity[k]) < 1e-9, `velocity.${k} diverged`);
  }
});

test('a fixed seed gives a bit-identical simulation', () => {
  const script = () => {
    const world = flatWorld();
    world.add(0, 0, 6, 6, 0, 3, 'building');
    const stall = world.add(-9, 0, 3, 1.2, 0, 1.2, 'prop', 'wood');
    const physics = new PhysicsWorld(world, { seed: 20250729 });
    const prop = physics.registerBreakable({
      collider: stall, chunks: 7, threshold: 30, mass: 45, seed: 4242,
    });
    physics.spawnDebris(new THREE.Vector3(1, 3, 1), 8, { speed: 7 });
    run(physics, 1);
    physics.applyExplosion(new THREE.Vector3(-8, 1, 0), 14, 500);
    assert.equal(prop.broken, true, 'the blast should have broken the stall');
    run(physics, 4);
    return physics.bodies
      .slice()
      .sort((x, y) => x.serial - y.serial)
      .map((b) => [
        b.serial,
        b.position.x, b.position.y, b.position.z,
        b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w,
      ]);
  };

  const a = script();
  const b = script();
  assert.ok(a.length > 8, `expected debris and chunks, got ${a.length}`);
  assert.deepEqual(a, b, 'same seed must give the same result, exactly');
});

test('pre-fracture is deterministic and conserves the prop volume', () => {
  const size = { x: 2.2, y: 1.1, z: 0.8 };
  const a = fracture(size, 9, new Rng(5));
  const b = fracture(size, 9, new Rng(5));
  assert.deepEqual(a, b);
  assert.equal(a.length, 9);
  let vol = 0;
  for (const c of a) vol += (c.hx * 2) * (c.hy * 2) * (c.hz * 2);
  assert.ok(Math.abs(vol - size.x * size.y * size.z) < 1e-9, `volume drifted: ${vol}`);
  // every chunk sits inside the original box
  for (const c of a) {
    assert.ok(Math.abs(c.ox) + c.hx <= size.x / 2 + 1e-9);
    assert.ok(Math.abs(c.oy) + c.hy <= size.y / 2 + 1e-9);
    assert.ok(Math.abs(c.oz) + c.hz <= size.z / 2 + 1e-9);
  }
});

/* ================================================================== *
 * destruction and multi-cell collider removal
 * ================================================================== */
test('breaking a prop removes its collider from every grid cell it spanned', () => {
  const world = flatWorld(400);
  // CELL is 24, so a 30x30 kiosk straddling the origin covers 4 cells; the
  // second collider spans 9. This is the bug class this project has hit before.
  const wide = world.add(0, 0, 30, 30, 0, 4, 'prop', 'wood');
  const wider = world.add(60, 60, 50, 50, 0, 5, 'prop', 'wood');
  const keep = world.add(-100, -100, 4, 4, 0, 3, 'building');

  const physics = new PhysicsWorld(world, { seed: 6 });
  const prop = physics.registerBreakable({
    colliders: [wide, wider], chunks: 5, threshold: 10, mass: 50, seed: 1,
  });

  assert.equal(world.boxes.length, 3);
  const chunks = physics.breakProp(prop, new THREE.Vector3(0, 20, 0), new THREE.Vector3(0, 2, 0));
  assert.equal(chunks.length, 5);

  assert.equal(world.boxes.includes(wide), false);
  assert.equal(world.boxes.includes(wider), false);
  assert.equal(world.boxes.includes(keep), true);
  assert.equal(world.boxes.length, 1);

  // No grid cell anywhere may still hold a reference.
  for (const [key, list] of world.grid) {
    assert.equal(list.includes(wide), false, `cell ${key} still holds the kiosk`);
    assert.equal(list.includes(wider), false, `cell ${key} still holds the second collider`);
    assert.ok(list.length > 0, `cell ${key} was left empty instead of deleted`);
  }
  assert.deepEqual(world.query(-40, -40, 100, 100), []);

  // And a ray straight through where it used to be now passes.
  assert.equal(world.raycast(
    new THREE.Vector3(-40, 2, 0), new THREE.Vector3(1, 0, 0), 200,
  ), Infinity);
  assert.equal(world.raycast(
    new THREE.Vector3(60, 2, -40), new THREE.Vector3(0, 0, 1), 200,
  ), Infinity);
  // Breaking twice must not spawn a second wave of chunks.
  assert.deepEqual(physics.breakProp(prop), []);
  assert.equal(physics.breakables.length, 0);
});

test('props break on an impulse threshold and not below it', () => {
  const world = flatWorld();
  const collider = world.add(4, 0, 1.6, 1.6, 0, 1, 'prop', 'wood');
  const physics = new PhysicsWorld(world, { seed: 6 });
  let brokeWith = null;
  const prop = physics.registerBreakable({
    collider, chunks: 4, threshold: 100, mass: 30, seed: 2,
    onBreak: (p, bodies) => { brokeWith = bodies.length; },
  });

  const point = new THREE.Vector3(4, 0.5, 0);
  assert.equal(physics.reportImpact(point, 20, new THREE.Vector3(1, 0, 0), 1.4), 0);
  assert.equal(prop.broken, false, 'a light tap must not break it');
  assert.equal(world.boxes.includes(collider), true);

  // Damage accumulates, so repeated small hits eventually do it.
  assert.equal(physics.reportImpact(point, 40, new THREE.Vector3(1, 0, 0), 1.4), 0);
  assert.equal(physics.reportImpact(point, 60, new THREE.Vector3(1, 0, 0), 1.4), 1);
  assert.equal(prop.broken, true);
  assert.equal(brokeWith, 4);
  assert.equal(world.boxes.includes(collider), false);

  const chunk = physics.bodies[0];
  assert.equal(chunk.kind, 'chunk');
  assert.equal(chunk.surface.id, 'wood');
});

test('a far-away prop is untouched by an impact', () => {
  const world = flatWorld();
  const collider = world.add(40, 0, 1, 1, 0, 1, 'prop', 'wood');
  const physics = new PhysicsWorld(world, { seed: 6 });
  const prop = physics.registerBreakable({ collider, chunks: 3, threshold: 5, seed: 3 });
  physics.reportImpact(new THREE.Vector3(0, 1, 0), 10000, new THREE.Vector3(1, 0, 0));
  assert.equal(prop.broken, false);
  assert.equal(world.boxes.length, 1);
});

/* ================================================================== *
 * explosions
 * ================================================================== */
test('explosion impulses fall off with distance and respect line of sight', () => {
  const world = flatWorld();
  // A wall to the east, from x = 4.5 to 5.5, tall and wide.
  world.add(5, 0, 1, 40, 0, 12, 'building');
  const physics = new PhysicsWorld(world, { seed: 9 });

  const near = physics.spawnBody({ position: { x: 0, y: 1, z: 2 }, mass: 5, lifetime: Infinity });
  const far = physics.spawnBody({ position: { x: 0, y: 1, z: 9 }, mass: 5, lifetime: Infinity });
  const shielded = physics.spawnBody({ position: { x: 9, y: 1, z: 0 }, mass: 5, lifetime: Infinity });
  const outside = physics.spawnBody({ position: { x: 0, y: 1, z: 30 }, mass: 5, lifetime: Infinity });

  const res = physics.applyExplosion(new THREE.Vector3(0, 1, 0), 14, 600);
  assert.equal(res.bodies, 2, 'only the two unobstructed, in-range bodies');

  const vNear = near.velocity.length();
  const vFar = far.velocity.length();
  assert.ok(vNear > 0, 'near body should have been thrown');
  assert.ok(vFar > 0, 'far body should have been thrown');
  assert.ok(vNear > vFar * 1.5, `falloff missing: ${vNear} vs ${vFar}`);
  assert.equal(shielded.velocity.lengthSq(), 0, 'the wall must shadow the blast');
  assert.equal(outside.velocity.lengthSq(), 0, 'out of radius');

  // Bodies pick up spin, not just a shove.
  assert.ok(near.angularVelocity.lengthSq() > 0);
});

test('occlusion can be softened or switched off', () => {
  const world = flatWorld();
  world.add(5, 0, 1, 40, 0, 12, 'building');
  const physics = new PhysicsWorld(world, { seed: 9 });
  const shielded = physics.spawnBody({ position: { x: 9, y: 1, z: 0 }, mass: 5, lifetime: Infinity });

  physics.applyExplosion(new THREE.Vector3(0, 1, 0), 20, 600, { occlusion: false });
  const full = shielded.velocity.length();
  assert.ok(full > 0);

  shielded.velocity.set(0, 0, 0);
  physics.applyExplosion(new THREE.Vector3(0, 1, 0), 20, 600, { occludedScale: 0.25 });
  const partial = shielded.velocity.length();
  assert.ok(partial > 0 && partial < full * 0.5, `${partial} vs ${full}`);
});

test('debris lying on the street is not shadowed by the street', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 9 });
  const b = physics.spawnBody({
    shape: 'box', half: { x: 0.2, y: 0.2, z: 0.2 },
    position: { x: 6, y: 0.6, z: 0 }, mass: 4, lifetime: Infinity,
  });
  run(physics, 4);
  assert.equal(b.sleeping, true);
  // Epicentre slightly above ground; the ray to the body grazes the pavement.
  const res = physics.applyExplosion(new THREE.Vector3(0, 1.4, 0), 12, 400);
  assert.equal(res.bodies, 1, 'the ground plane must not occlude');
  assert.ok(b.velocity.length() > 1);
});

/* ================================================================== *
 * ballistics
 * ================================================================== */
test('a projectile follows a ballistic arc and lands where the maths says', () => {
  const world = flatWorld(1000);
  const physics = new PhysicsWorld(world, { seed: 4 });
  let landed = null;
  let apex = 0;
  physics.onProjectileHit = (p, h) => { if (!landed) landed = { x: h.px, y: h.py }; };
  // 45° at 40 m/s from a 1.2 m muzzle, no drag, g = 24. The sphere lands when
  // its centre reaches y = r, so 12t² − 28.284t − 1.15 = 0 → t = 2.397 s and
  // x = 67.8 m. Apex is at 1.2 + vy²/2g = 17.9 m.
  const s = 40 / Math.SQRT2;
  const p = physics.spawnProjectile(
    new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(s, s, 0),
    { radius: 0.05, drag: 0, gravity: -24, life: 20 },
  );
  for (let i = 0; i < 360; i++) {
    physics.step(1 / 60);
    if (p.alive && p.position.y > apex) apex = p.position.y;
  }
  assert.ok(landed, 'projectile never landed');
  assert.ok(Math.abs(landed.x - 67.79) < 2, `landed at x=${landed.x}, expected ~67.8`);
  assert.ok(Math.abs(landed.y - 0.05) < 0.02, `landed at y=${landed.y}`);
  assert.ok(Math.abs(apex - 17.87) < 0.5, `apex was ${apex}, expected ~17.9`);
});

test('drag shortens the flight and projectiles expire', () => {
  const world = flatWorld(1000);
  const physics = new PhysicsWorld(world, { seed: 4 });
  const reach = (drag) => {
    let x = 0;
    physics.onProjectileHit = (p, h) => { if (!x) x = h.px; };
    const s = 40 / Math.SQRT2;
    physics.spawnProjectile(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(s, s, 0),
      { radius: 0.05, drag, gravity: -24, life: 20 });
    run(physics, 6);
    return x;
  };
  const dry = reach(0);
  const wet = reach(0.05);
  assert.ok(wet < dry * 0.9, `drag did nothing: ${wet} vs ${dry}`);

  physics.onProjectileHit = null;
  physics.spawnProjectile(new THREE.Vector3(0, 40, 0), new THREE.Vector3(0, 20, 0),
    { radius: 0.05, gravity: 0, drag: 0, life: 0.5 });
  assert.equal(physics.projectiles.length, 1);
  run(physics, 1);
  assert.equal(physics.projectiles.length, 0, 'life should have expired');
});

test('a projectile impact can break a prop and shove debris', () => {
  const world = flatWorld();
  const collider = world.add(20, 0, 1.4, 1.4, 0, 1.2, 'prop', 'wood');
  const physics = new PhysicsWorld(world, { seed: 4 });
  const prop = physics.registerBreakable({ collider, chunks: 5, threshold: 40, mass: 25, seed: 7 });
  physics.spawnProjectile(
    new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(300, 0, 0),
    { radius: 0.04, gravity: 0, drag: 0, impactImpulse: 90 },
  );
  run(physics, 0.5);
  assert.equal(prop.broken, true);
  assert.equal(physics.bodies.length, 5);
  assert.equal(world.boxes.includes(collider), false);
});

/* ================================================================== *
 * ragdolls
 * ================================================================== */
test('every creature template builds a connected ragdoll', () => {
  for (const name of Object.keys(RAGDOLL_TEMPLATES)) {
    const world = flatWorld();
    const physics = new PhysicsWorld(world, { seed: 12, maxBodies: 64 });
    const bones = buildRagdollBones(RAGDOLL_TEMPLATES[name], new THREE.Vector3(0, 0, 0));
    const rag = physics.spawnRagdoll(bones, { impulse: new THREE.Vector3(0, 40, 30) });
    assert.ok(rag, `${name} failed to spawn`);
    assert.equal(rag.bones.length, bones.length, `${name} lost bones`);
    assert.equal(rag.joints.length, bones.length - 1, `${name} lost joints`);
    for (const bone of bones) {
      assert.ok(rag.transform(bone.name), `${name} is missing output for ${bone.name}`);
    }
    // The per-frame loop form must give the same objects as the Map lookup.
    for (const bone of rag.bones) {
      assert.equal(bone.out, rag.transform(bone.name), `${name}: bone.out mismatch`);
      assert.ok(bone.out.position instanceof THREE.Vector3);
      assert.ok(bone.out.quaternion instanceof THREE.Quaternion);
    }
    // Joints must hold: bone origins stay near their parents through a fall.
    const pairs = rag.joints.map((j) => [j.a, j.b, Math.hypot(
      j.a.position.x - j.b.position.x, j.a.position.y - j.b.position.y, j.a.position.z - j.b.position.z,
    )]);
    run(physics, 3);
    for (const [a, b, d0] of pairs) {
      const d = Math.hypot(
        a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z,
      );
      assert.ok(Number.isFinite(d), `${name} produced a non-finite bone distance`);
      assert.ok(d < d0 + 0.35, `${name} joint stretched from ${d0.toFixed(2)} to ${d.toFixed(2)}`);
    }
    physics.clear();
  }
});

test('a ragdoll blends out of the animated pose instead of snapping', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 13, maxBodies: 64 });
  const bones = buildRagdollBones(RAGDOLL_TEMPLATES.humanoid, new THREE.Vector3(0, 0, 0));
  const rag = physics.spawnRagdoll(bones, {
    impulse: new THREE.Vector3(0, 200, 400), hitBone: 'chest', blendTime: 0.25,
  });

  // At spawn the reported pose is exactly the pose we handed in.
  const pelvisIn = bones.find((b) => b.name === 'pelvis');
  const pelvis = rag.transform('pelvis');
  assert.ok(Math.abs(pelvis.position.x - pelvisIn.position.x) < 1e-9);
  assert.ok(Math.abs(pelvis.position.y - pelvisIn.position.y) < 1e-9);
  assert.equal(rag.blend, 0);

  // One frame later it has moved a little, not teleported.
  let prev = pelvis.position.clone();
  for (let i = 0; i < 20; i++) {
    physics.step(1 / 60);
    const step = rag.transform('pelvis').position.distanceTo(prev);
    assert.ok(step < 0.5, `pose jumped ${step.toFixed(3)} m in one frame`);
    prev = rag.transform('pelvis').position.clone();
  }
  assert.ok(rag.blend > 0.9, 'blend should be complete after 20 frames');
});

test('a ragdoll settles, then fades and despawns, freeing its bodies', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 14, maxBodies: 64 });
  const rag = physics.spawnRagdoll(
    buildRagdollBones(RAGDOLL_TEMPLATES.whelp, new THREE.Vector3(0, 0.2, 0)),
    { settleTimeout: 1, fadeTime: 0.5 },
  );
  const boneCount = rag.bones.length;
  assert.equal(physics.bodies.length, boneCount);
  let removed = 0;
  physics.onRagdollRemove = () => removed++;

  run(physics, 4);
  assert.equal(rag.settled, true, 'should have come to rest');
  run(physics, 3);
  assert.equal(rag.alive, false, 'should have despawned');
  assert.equal(removed, 1);
  assert.equal(physics.bodies.length, 0, 'bone bodies must go back to the pool');
  assert.equal(physics.ragdolls.length, 0);

  // The pool is genuinely reusable afterwards.
  const again = physics.spawnRagdoll(
    buildRagdollBones(RAGDOLL_TEMPLATES.whelp, new THREE.Vector3(4, 0.2, 0)), {},
  );
  assert.ok(again);
  assert.equal(physics.bodies.length, boneCount);
});

test('ragdoll bones do not fight each other and never fall through the street', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 15, maxBodies: 64 });
  const rag = physics.spawnRagdoll(
    buildRagdollBones(RAGDOLL_TEMPLATES.humanoid, new THREE.Vector3(0, 1.2, 0)),
    { impulse: new THREE.Vector3(120, 60, 0), hitBone: 'head', settleTimeout: 1e9, maxLifetime: 1e9 },
  );
  run(physics, 8);
  assert.equal(rag.alive, true);
  for (const bone of rag.bones) {
    assert.ok(finite(bone.body.position), 'a bone went non-finite');
    assert.ok(bone.body.position.y > -0.4, `bone ${bone.name} sank to ${bone.body.position.y}`);
    assert.ok(bone.body.position.y < 6, `bone ${bone.name} flew to ${bone.body.position.y}`);
  }
  assert.equal(rag.settled, true, 'the ragdoll should have come to rest, not twitched forever');
});

test('a ragdoll can be shoved by an explosion and takes the whole body with it', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 16, maxBodies: 64 });
  const rag = physics.spawnRagdoll(
    buildRagdollBones(RAGDOLL_TEMPLATES.humanoid, new THREE.Vector3(6, 0, 0)),
    { settleTimeout: 1e9, maxLifetime: 1e9 },
  );
  run(physics, 5);
  assert.equal(rag.settled, true);
  const before = rag.transform('pelvis').position.clone();
  const res = physics.applyExplosion(new THREE.Vector3(0, 1, 0), 20, 900);
  assert.equal(res.bodies, rag.bones.length, 'every bone should feel the blast');
  run(physics, 1.5);
  assert.ok(
    rag.transform('pelvis').position.distanceTo(before) > 1,
    'the blast should have thrown the corpse',
  );
});

test('ragdoll count is capped: the oldest corpse makes room', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 17, maxBodies: 96, maxRagdolls: 2 });
  const make = (x) => physics.spawnRagdoll(
    buildRagdollBones(RAGDOLL_TEMPLATES.whelp, new THREE.Vector3(x, 0.2, 0)),
    { settleTimeout: 1e9, maxLifetime: 1e9 },
  );
  const a = make(0);
  const b = make(4);
  assert.equal(physics.ragdolls.length, 2);
  const c = make(8);
  assert.equal(physics.ragdolls.length, 2);
  assert.equal(a.alive, false, 'oldest ragdoll should have been retired');
  assert.equal(b.alive, true);
  assert.equal(c.alive, true);
  assert.equal(physics.bodies.length, b.bones.length + c.bones.length);
});

/* ================================================================== *
 * live-skeleton handoff
 * ================================================================== */

/**
 * A miniature stand-in for the player rig: bones extending down local -Y, held
 * under a rotated, translated parent. Built here rather than imported from
 * src/character/ so this test never blocks the character engineer's edits.
 */
function makeMinusYSkeleton() {
  const spec = [
    ['hips', null, [0, 0.945, 0]],
    ['spine1', 'hips', [0, 0.11, 0]],
    ['chest', 'spine1', [0, 0.25, 0]],
    ['neck', 'chest', [0, 0.15, 0]],
    ['head', 'neck', [0, 0.09, 0]],
    ['legLU', 'hips', [-0.093, -0.02, 0]],
    ['legLL', 'legLU', [0, -0.445, 0]],
    ['footL', 'legLL', [0, -0.398, 0]],
    ['legRU', 'hips', [0.093, -0.02, 0]],
    ['legRL', 'legRU', [0, -0.445, 0]],
    ['footR', 'legRL', [0, -0.398, 0]],
  ];
  const byName = {};
  for (const [name, parent, p] of spec) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(p[0], p[1], p[2]);
    byName[name] = b;
    if (parent) byName[parent].add(b);
  }
  const holder = new THREE.Group();
  holder.position.set(12, 0, -5);
  holder.rotation.y = 0.7;
  holder.add(byName.hips);
  holder.updateMatrixWorld(true);
  return { byName, holder };
}

test('a ragdoll built from live -Y bones starts in exactly the animated pose', () => {
  const { byName } = makeMinusYSkeleton();
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 22, maxBodies: 64 });

  const bones = ragdollBonesFromObjects([
    { name: 'hips', parent: null, object: byName.hips, tip: byName.spine1, radius: 0.15, mass: 11 },
    { name: 'spine1', parent: 'hips', object: byName.spine1, tip: byName.chest, radius: 0.14, mass: 8 },
    { name: 'chest', parent: 'spine1', object: byName.chest, tip: byName.neck, radius: 0.16, mass: 12 },
    { name: 'head', parent: 'chest', object: byName.head, length: 0.22, radius: 0.12, mass: 4.5 },
    { name: 'legLU', parent: 'hips', object: byName.legLU, tip: byName.legLL, radius: 0.09, mass: 6.5 },
    { name: 'legLL', parent: 'legLU', object: byName.legLL, tip: byName.footL, radius: 0.075, mass: 4 },
    { name: 'legRU', parent: 'hips', object: byName.legRU, tip: byName.legRL, radius: 0.09, mass: 6.5 },
    { name: 'legRL', parent: 'legRU', object: byName.legRL, tip: byName.footR, radius: 0.075, mass: 4 },
  ], { boneAxis: '-y' });

  assert.equal(bones.length, 8);
  // Lengths come off the live rig, not from guesses.
  assert.ok(Math.abs(bones[4].length - 0.445) < 1e-6, `thigh length ${bones[4].length}`);
  assert.ok(Math.abs(bones[5].length - 0.398) < 1e-6, `shin length ${bones[5].length}`);
  // World placement follows the holder's transform.
  assert.ok(Math.abs(bones[0].position.x - 12) < 1e-9);
  assert.ok(Math.abs(bones[0].position.y - 0.945) < 1e-9);

  const rag = physics.spawnRagdoll(bones, {
    impulse: new THREE.Vector3(120, 90, -40), hitBone: 'chest',
  });
  assert.ok(rag);
  assert.equal(rag.joints.length, 7);

  // Nothing may move on the frame of death.
  for (const spec of bones) {
    const t = rag.transform(spec.name);
    assert.ok(
      Math.hypot(
        t.position.x - spec.position.x,
        t.position.y - spec.position.y,
        t.position.z - spec.position.z,
      ) < 1e-9,
      `${spec.name} snapped at spawn`,
    );
    assert.ok(Math.abs(Math.abs(t.quaternion.dot(
      new THREE.Quaternion(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w),
    )) - 1) < 1e-9, `${spec.name} orientation snapped at spawn`);
  }

  // And the capsule really lies along the bone: the far end of the thigh sits at
  // the knee, which is what makes the collision shape match the visible limb.
  const thigh = rag.bones.find((b) => b.name === 'legLU');
  const knee = rag.bones.find((b) => b.name === 'legLL');
  const axisEnd = new THREE.Vector3(0, 1, 0)
    .applyQuaternion(thigh.body.quaternion)
    .multiplyScalar(thigh.length * 0.5)
    .add(thigh.body.position);
  assert.ok(axisEnd.distanceTo(knee.out.position) < 1e-6, 'capsule is not aligned with the bone');

  run(physics, 4);
  assert.equal(rag.settled, true, 'a rig-driven ragdoll should settle like any other');
  for (const bone of rag.bones) {
    assert.ok(bone.body.position.y > -0.3, `${bone.name} sank`);
  }
});

test('playerRagdollBones skips bones a rig does not have', () => {
  const { byName } = makeMinusYSkeleton();
  const bones = playerRagdollBones(byName);
  const names = bones.map((b) => b.name);
  // The stand-in rig has no arms or spine2, so those are dropped, and the arm
  // children that hang off them go with their parents.
  assert.ok(names.includes('hips'));
  assert.ok(names.includes('legLL'));
  assert.equal(names.includes('armLU'), false);
  assert.equal(names.includes('spine2'), false);
  // Whatever survives must still be a valid tree: every parent present.
  for (const b of bones) {
    if (b.parent) assert.ok(names.includes(b.parent), `${b.name} kept a missing parent`);
  }
  assert.ok(PLAYER_RAGDOLL_SPEC.length > bones.length);
  // And it must still simulate.
  const physics = new PhysicsWorld(flatWorld(), { seed: 23, maxBodies: 64 });
  const rag = physics.spawnRagdoll(bones, {});
  assert.ok(rag);
  run(physics, 4);
  assert.equal(rag.settled, true);
});

/* ================================================================== *
 * integration surface
 * ================================================================== */
test('RigidBodySystem is the same class, and stats() reports the budget', () => {
  assert.equal(RigidBodySystem, PhysicsWorld);
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 18, maxBodies: 32 });
  physics.spawnDebris(new THREE.Vector3(0, 3, 0), 5, { speed: 4 });
  physics.step(1 / 60);
  const s = physics.stats();
  assert.equal(s.bodies, 5);
  assert.equal(s.capacity, 32);
  assert.equal(s.awake, 5);
  assert.equal(s.fixedSteps, 1);
  assert.ok(s.lastStepMs >= 0);
  assert.equal(typeof s.contacts, 'number');
});

test('step() ignores nonsense deltas and never runs away', () => {
  const world = flatWorld();
  const physics = new PhysicsWorld(world, { seed: 19 });
  physics.spawnBody({ position: { x: 0, y: 4, z: 0 }, mass: 5, lifetime: Infinity });
  assert.equal(physics.step(0), 0);
  assert.equal(physics.step(-1), 0);
  assert.equal(physics.step(NaN), 0);
  assert.equal(physics.step(1 / 600), 0, 'a tiny delta banks time instead of stepping');
  // A one-minute hitch must not run 3600 steps.
  const steps = physics.step(60);
  assert.ok(steps <= physics.opt.maxStepsPerFrame, `ran ${steps} steps`);
  assert.ok(finite(physics.bodies[0].position));
});
