import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, FlagGrid } from '../src/city.js';
import { Rng } from '../src/rng.js';
import { generatePlots, rotRectHitsRect } from '../src/city/blocks.js';
import { FALLBACK_FOOTPRINTS, GN } from '../src/city/layout.js';
import * as landmarksModule from '../src/landmarks.js';
import * as THREE from 'three';
import { createBreakables, instanceVisual, rebuildableColliders } from '../src/city/breakables.js';
import { CollisionWorld } from '../src/physics.js';
import { InstanceSet } from '../src/city/mesh.js';

test('flag grid stores only exact classifications at shape borders', () => {
  const grid = new FlagGrid();
  grid.fill(FLAG.FREE);
  grid.rect(0, 0, 20, 20, FLAG.PARK);
  grid.line([[-20, -20], [20, 20]], 5, FLAG.ROAD);
  grid.circle(0, 0, 4, FLAG.RESERVED);

  const known = new Set(Object.values(FLAG));
  assert.equal([...grid.data].every((value) => known.has(value)), true);
  assert.equal(grid.data[210 * 420 + 210], FLAG.RESERVED);
});

/* ------------------------------------------------------------------ */
/* landmark reservations                                               */
/* ------------------------------------------------------------------ */

/** The footprints the city consumes, resolved exactly as src/city.js does. */
function footprints() {
  const fromLandmarks = landmarksModule.LANDMARK_FOOTPRINTS;
  if (Array.isArray(fromLandmarks) && fromLandmarks.length) {
    return fromLandmarks
      .map((entry) => (Array.isArray(entry)
        ? { key: 'landmark', rects: [entry] }
        : { key: entry.key ?? 'landmark', rects: entry.rects ?? [] }))
      .filter((f) => f.rects.length);
  }
  return FALLBACK_FOOTPRINTS;
}

test('LANDMARK_FOOTPRINTS is consumed as the reservation source of truth', () => {
  const fps = footprints();
  assert.ok(fps.length > 0, 'no landmark footprints resolved');
  for (const fp of fps) {
    assert.equal(typeof fp.key, 'string');
    assert.ok(Array.isArray(fp.rects) && fp.rects.length > 0, `${fp.key} has no rects`);
    for (const rect of fp.rects) {
      assert.equal(rect.length, 4, `${fp.key} rect is not [cx, cz, w, d]`);
      assert.ok(rect[2] > 0 && rect[3] > 0, `${fp.key} rect has no extent`);
    }
  }
  // when the landmark module exports them, the hardcoded fallback is not in use
  if (landmarksModule.LANDMARK_FOOTPRINTS) {
    assert.notEqual(fps, FALLBACK_FOOTPRINTS);
  }
});

test('rotated rect vs reserved rect overlap test is sound', () => {
  // a 10 x 10 box 20 m away does not touch a 10 x 10 reservation
  assert.equal(rotRectHitsRect(0, 0, 10, 10, 0, 20, 0, 10, 10), false);
  // 9 m apart, it does
  assert.equal(rotRectHitsRect(0, 0, 10, 10, 0, 9, 0, 10, 10), true);
  // rotated 45 degrees a corner leads, so its reach along x grows from 5 to
  // 7.07 m: 11 m apart now hits where the unrotated box would have cleared
  assert.equal(rotRectHitsRect(0, 0, 10, 10, 0, 11, 0, 10, 10), false);
  assert.equal(rotRectHitsRect(0, 0, 10, 10, Math.PI / 4, 11, 0, 10, 10), true);
  // and it still clears at 13 m, which is past the 12.07 m corner reach
  assert.equal(rotRectHitsRect(0, 0, 10, 10, Math.PI / 4, 13, 0, 10, 10), false);
  // the margin argument inflates the moving box
  assert.equal(rotRectHitsRect(0, 0, 10, 10, 0, 12, 0, 10, 10, 0), false);
  assert.equal(rotRectHitsRect(0, 0, 10, 10, 0, 12, 0, 10, 10, 3), true);
});

/**
 * The regression that has already bitten this project once: a building
 * standing on a landmark's terrace. Plot generation is pure, so it is driven
 * here over completely open ground, which is the hardest case — nothing
 * except the reservation test stops a plot from being placed.
 */
test('zero buildings overlap any reserved landmark footprint', () => {
  const fps = footprints();
  const flags = new Uint8Array(GN * GN); // every cell FLAG.FREE: worst case
  const { buildings, reserved } = generatePlots(new Rng(20250726), { flags, footprints: fps });

  assert.ok(buildings.length > 400, `only ${buildings.length} buildings generated`);
  assert.equal(reserved.length, fps.reduce((n, f) => n + f.rects.length, 0));

  const offenders = [];
  for (const b of buildings) {
    for (const [rx, rz, rw, rd] of reserved) {
      if (rotRectHitsRect(b.x, b.z, b.w, b.d, b.rot || 0, rx, rz, rw, rd)) {
        offenders.push({ building: [b.x, b.z, b.w, b.d], rect: [rx, rz, rw, rd] });
      }
    }
  }
  assert.deepEqual(offenders, [], `${offenders.length} buildings overlap a reservation`);
});

/* ------------------------------------------------------------------ */
/* determinism                                                         */
/* ------------------------------------------------------------------ */

test('plot generation is byte-identical for a given seed', () => {
  const fps = footprints();
  const run = () => {
    const flags = new Uint8Array(GN * GN);
    const { plots, buildings } = generatePlots(new Rng(20250726), { flags, footprints: fps });
    return JSON.stringify({ plots, buildings });
  };
  assert.equal(run(), run());
});

test('a different seed produces a different city', () => {
  const fps = footprints();
  const run = (seed) => {
    const flags = new Uint8Array(GN * GN);
    return JSON.stringify(generatePlots(new Rng(seed), { flags, footprints: fps }).buildings);
  };
  assert.notEqual(run(20250726), run(99));
});

test('the flag grid is identical across two identical paint sequences', () => {
  const paint = () => {
    const grid = new FlagGrid();
    grid.fill(FLAG.FREE);
    grid.rect(0, -18, 74, 108, FLAG.PLAZA);
    grid.line([[8, 246], [4, 180], [2, 110], [0, 46]], 22, FLAG.ROAD);
    grid.circle(-108, 176, 55, FLAG.RESERVED);
    return grid.copy();
  };
  const a = paint();
  const b = paint();
  assert.equal(a.length, b.length);
  assert.equal(a.every((v, i) => v === b[i]), true);
});

/* ------------------------------------------------------------------ */
/* breakable props                                                     */
/* ------------------------------------------------------------------ */

/**
 * Stand-in for PhysicsWorld with just the surface the city touches:
 * `registerBreakable`, `clear` (which is what throws boot registrations
 * away) and enough of `breakProp` to fire the descriptor's onBreak.
 */
function fakePhysicsWorld(collision = null) {
  const world = {
    collision,
    breakables: [],
    /** how many times chunks have been shed, for the break-once assertions */
    chunkSpawns: 0,
    registerBreakable(opts) {
      const prop = { ...opts, broken: false };
      world.breakables.push(prop);
      return prop;
    },
    clear() {
      world.breakables.length = 0;
    },
    /* same order of business as PhysicsWorld.breakProp: refuse a second
     * break, drop the static collider out of the grid, empty the prop's own
     * collider list, spawn chunks, then notify. */
    breakProp(prop) {
      if (prop.broken) return [];
      prop.broken = true;
      if (collision) collision.removeAll(prop.colliders);
      prop.colliders.length = 0;
      world.chunkSpawns++;
      if (prop.onBreak) prop.onBreak(prop, []);
      return [{}];
    },
  };
  return world;
}

function threeProps() {
  return [
    { colliders: [{}], surface: 'wood', label: 'bench' },
    { colliders: [{}], surface: 'metal', label: 'litter bin' },
    { colliders: [{}], surface: 'wood', label: 'kiosk' },
  ];
}

test('registration survives the clear() that startGame does', () => {
  const registry = createBreakables();
  for (const d of threeProps()) registry.add(d);
  const world = fakePhysicsWorld();

  assert.equal(registry.register(world), 3);
  assert.equal(world.breakables.length, 3);

  // an accidental second call is free, which is what the memo is for
  assert.equal(registry.register(world), 0);
  assert.equal(world.breakables.length, 3);

  // startGame(): the world drops every registration on the floor
  world.clear();
  assert.equal(world.breakables.length, 0);

  // ...and this is the path that puts them back
  assert.equal(registry.reregister(world), 3);
  assert.equal(world.breakables.length, 3);
  assert.equal(registry.register(world, { force: true }), 3);
  assert.equal(world.breakables.length, 6);
});

test('registration degrades gracefully with no usable physics world', () => {
  const registry = createBreakables();
  registry.add({ colliders: [{}], surface: 'wood', label: 'bench' });
  assert.equal(registry.register(undefined), 0);
  assert.equal(registry.register(null), 0);
  assert.equal(registry.register({}), 0);
  assert.equal(registry.reregister({ registerBreakable: 'not a function' }), 0);
  // and still registers for real afterwards
  assert.equal(registry.register(fakePhysicsWorld()), 1);
});

test('breaking a prop collapses its instanced visual', () => {
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const indices = [
    set.push(10, 0, 20),
    set.push(30, 0, 40),
    set.push(50, 0, 60),
  ];
  assert.deepEqual(indices, [0, 1, 2]);
  const group = new THREE.Group();
  const mesh = set.finish(group);
  assert.equal(mesh.count, 3);

  const scaleOf = (i) => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixScale(m).length();
  };
  const positionOf = (i) => {
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };
  assert.ok(scaleOf(1) > 0);

  const registry = createBreakables();
  const desc = registry.add({
    colliders: [{}], surface: 'wood', label: 'bench',
    ...instanceVisual([[set, indices[1]]]),
  });
  const world = fakePhysicsWorld();
  registry.register(world);
  world.breakProp(world.breakables[0]);

  // the broken one is gone, its neighbours untouched
  assert.equal(scaleOf(1), 0);
  assert.ok(scaleOf(0) > 0);
  assert.ok(scaleOf(2) > 0);
  // collapsed in place, so debris and prop agree on where it was
  assert.deepEqual(
    [positionOf(1).x, positionOf(1).z],
    [30, 40],
  );
  // and it never comes back on a restart
  assert.equal(desc.broken, true);
  assert.equal(registry.intact, 0);
  world.clear();
  assert.equal(registry.reregister(world), 0);
  assert.equal(world.breakables.length, 0);

  // show() puts it back, for whoever wants to restore a fresh city
  assert.equal(set.show(indices[1]), true);
  assert.ok(scaleOf(1) > 0);
});

/* ------------------------------------------------------------------ */
/* restoring a broken city                                             */
/* ------------------------------------------------------------------ */

/** A bench: real CollisionWorld box, real InstancedMesh, real descriptor. */
function benchFixture() {
  const collision = new CollisionWorld();
  const set = new InstanceSet(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  const index = set.push(12, 0, 34, 0.5);
  const mesh = set.finish(new THREE.Group());
  const registry = createBreakables();
  const desc = registry.add({
    ...rebuildableColliders(collision, [[12, 34, 2.8, 1.2, 0, 0.95, 'prop', 'wood']]),
    chunks: 6, threshold: 32, mass: 26, surface: 'wood', seed: 7, label: 'bench',
    ...instanceVisual([[set, index]]),
  });
  const original = new THREE.Matrix4();
  mesh.getMatrixAt(index, original);
  return {
    collision, set, mesh, index, registry, desc, original,
    /** boxes the spatial grid actually returns over the bench's footprint */
    inGrid: () => collision.query(11, 33, 13, 35),
    scale: () => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(index, m);
      return new THREE.Vector3().setFromMatrixScale(m).length();
    },
    matrix: () => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(index, m);
      return m;
    },
  };
}

test('restore() puts a broken prop back in the collision grid and on screen', () => {
  const f = benchFixture();
  const world = fakePhysicsWorld(f.collision);

  assert.equal(f.inGrid().length, 1);
  assert.ok(f.scale() > 0);
  assert.equal(f.registry.register(world), 1);

  world.breakProp(world.breakables[0]);
  // gone from the grid, gone from the screen, latched as broken
  assert.equal(f.inGrid().length, 0);
  assert.equal(f.scale(), 0);
  assert.equal(f.desc.broken, true);
  assert.equal(f.registry.intact, 0);

  assert.equal(f.registry.restore(), 1);

  // back in the grid — asserted against the grid, not just the array
  const back = f.inGrid();
  assert.equal(back.length, 1);
  assert.equal(back[0].tag, 'prop');
  assert.equal(back[0].surface.id, 'wood');
  assert.equal(f.collision.isSolidAt(12, 0.5, 34), true);
  // the descriptor points at the box that is actually in the world now
  assert.equal(f.desc.colliders.length, 1);
  assert.equal(f.desc.colliders[0], back[0]);
  // visual back at exactly its original matrix
  assert.ok(f.scale() > 0);
  assert.deepEqual([...f.matrix().elements], [...f.original.elements]);
  assert.equal(f.desc.broken, false);
  assert.equal(f.registry.intact, 1);
  // and restoring cleared the memo, so a plain register() takes effect
  assert.equal(f.registry.register(world), 1);
});

test('a restored prop is breakable again, and sheds chunks exactly once', () => {
  const f = benchFixture();
  const world = fakePhysicsWorld(f.collision);
  f.registry.register(world);

  world.breakProp(world.breakables[0]);
  assert.equal(world.chunkSpawns, 1);
  // a second hit on the same wreckage must not spawn a second set
  world.breakProp(world.breakables[0]);
  assert.equal(world.chunkSpawns, 1);

  // restart: pristine city, handed to the world again
  assert.equal(f.registry.restore(), 1);
  world.clear();
  assert.equal(f.registry.register(world, { force: true }), 1);
  assert.equal(world.breakables.length, 1);

  world.breakProp(world.breakables[0]);
  assert.equal(world.chunkSpawns, 2);
  assert.equal(f.inGrid().length, 0);
  assert.equal(f.scale(), 0);
  world.breakProp(world.breakables[0]);
  assert.equal(world.chunkSpawns, 2);
});

test('restore() is a no-op when nothing is broken, and is safe to repeat', () => {
  const collision = new CollisionWorld();
  const registry = createBreakables();
  for (let i = 0; i < 2; i++) {
    registry.add({
      ...rebuildableColliders(collision, [[i * 10, 0, 1, 1, 0, 1, 'prop', 'wood']]),
      surface: 'wood', label: 'bench',
    });
  }
  assert.equal(registry.restore(), 0);
  assert.equal(registry.restore(), 0);
  assert.equal(collision.boxes.length, 2);

  // after a break and a restore, a further restore is also a no-op
  const world = fakePhysicsWorld(collision);
  registry.register(world);
  world.breakProp(world.breakables[0]);
  assert.equal(registry.restore(), 1);
  assert.equal(registry.restore(), 0);
  assert.equal(collision.boxes.length, 2);
});

test('reregister() still refuses to resurrect, restore() is the only way back', () => {
  const f = benchFixture();
  const world = fakePhysicsWorld(f.collision);
  f.registry.register(world);
  world.breakProp(world.breakables[0]);
  world.clear();

  // the deliberate protection: a re-registration alone leaves it broken
  assert.equal(f.registry.reregister(world), 0);
  assert.equal(world.breakables.length, 0);
  assert.equal(f.desc.broken, true);
  assert.equal(f.scale(), 0);

  // only the explicit restore brings it back
  assert.equal(f.registry.restore(), 1);
  assert.equal(f.registry.reregister(world), 1);
  assert.ok(f.scale() > 0);
});
