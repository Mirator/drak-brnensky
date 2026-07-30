import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, FlagGrid } from '../src/city.js';
import { Rng } from '../src/rng.js';
import { generatePlots, rotRectHitsRect } from '../src/city/blocks.js';
import { FALLBACK_FOOTPRINTS, GN } from '../src/city/layout.js';
import * as landmarksModule from '../src/landmarks.js';
import * as THREE from 'three';
import { createBreakables, instanceVisual } from '../src/city/breakables.js';
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
function fakePhysicsWorld() {
  const world = {
    breakables: [],
    registerBreakable(opts) {
      const prop = { ...opts, broken: false };
      world.breakables.push(prop);
      return prop;
    },
    clear() {
      world.breakables.length = 0;
    },
    breakProp(prop) {
      prop.broken = true;
      if (prop.onBreak) prop.onBreak(prop, []);
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
