import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAG, FlagGrid } from '../src/city.js';
import { Rng } from '../src/rng.js';
import { generatePlots, rotRectHitsRect } from '../src/city/blocks.js';
import { FALLBACK_FOOTPRINTS, GN } from '../src/city/layout.js';
import * as landmarksModule from '../src/landmarks.js';

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
