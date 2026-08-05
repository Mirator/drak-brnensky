/**
 * `CollisionWorld.resolve()` — the capsule push-out, checked for correctness.
 *
 * This is the single hottest function in the game: the player and every
 * creature run it once per frame, and `test/performance.test.js:268-286`
 * already guards what it *costs*. Nothing guarded what it *does*. A regression
 * here does not crash — it produces a player who slides to a stop in the middle
 * of a square, or wedges in a doorway, or pops through a wall onto a roof, and
 * you only find out by playing.
 *
 * Everything below is derived rather than recorded. `resolve()` is a pure
 * closest-point push-out: for a capsule of radius r whose axis is at (x, z),
 * the nearest point c on the box is clamped per axis, and the capsule is moved
 * to c + normalize(pos - c) * r. So every expected position in this file is
 * written as an expression in the box's face coordinate and the radius, and a
 * test fails with the number it wanted rather than a magic constant.
 *
 * The two capsule sizes used are the real ones: the player is RADIUS 0.42 /
 * HEIGHT 1.78 (src/player.js:39-40) and a golem is radius 1.05 / height 2.9
 * with stepUp 1.15 (src/enemies.js:35, and the resolve call at
 * src/enemies.js:1263).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics.js';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const R = 0.42;          // player capsule radius, src/player.js:39
const H = 1.78;          // player capsule height, src/player.js:40
const DT = 1 / 60;

function world() {
  const w = new CollisionWorld();
  w.bounds = { x0: -400, z0: -400, x1: 400, z1: 400 };
  return w;
}

/**
 * A long facade whose near face sits at `face` on the +x side of the corridor,
 * i.e. solid for x >= face. Returned so a test can read the face back off the
 * box rather than restating it.
 */
function wallAtX(w, face, { depth = 40, height = 6 } = {}) {
  const box = w.add(face + 20, 0, 40, depth, 0, height, 'building');
  assert.equal(box.x0, face, 'fixture sanity: the near face is where the test thinks');
  return box;
}

/** The same, solid for z >= face. */
function wallAtZ(w, face, { width = 40, height = 6 } = {}) {
  const box = w.add(0, face + 20, width, 40, 0, height, 'building');
  assert.equal(box.z0, face);
  return box;
}

/**
 * One frame of the player's horizontal step, exactly as src/player.js:455-457
 * does it: integrate, then resolve. Returns the displacement resolve removed,
 * which is the "normal component" the slide tests care about.
 */
function step(w, pos, vx, vz, dt = DT, radius = R, height = H, stepUp) {
  const wantX = pos.x + vx * dt;
  const wantZ = pos.z + vz * dt;
  pos.x = wantX;
  pos.z = wantZ;
  const hit = stepUp === undefined
    ? w.resolve(pos, radius, height)
    : w.resolve(pos, radius, height, stepUp);
  return { hit, removedX: wantX - pos.x, removedZ: wantZ - pos.z };
}

/* ================================================================== */
/* push-out distance and direction                                     */
/* ================================================================== */

test('a penetrating capsule is pushed out along the face normal, by exactly the overlap', () => {
  const w = world();
  const wall = wallAtX(w, 4.5);

  /* A face contact: the closest point on the box is directly inboard, so the
   * normal is -x and the push is (r - d) where d is the axis-to-face gap. */
  for (const overlap of [0.001, 0.05, 0.2, R - 1e-6]) {
    const pos = new THREE.Vector3(wall.x0 - R + overlap, 0, 0);
    const before = pos.clone();
    assert.equal(w.resolve(pos, R, H), true, `overlap ${overlap} was not reported as a hit`);

    assert.ok(Math.abs(pos.x - (wall.x0 - R)) < 1e-12,
      `overlap ${overlap}: ended at x=${pos.x}, wanted ${wall.x0 - R}`);
    assert.ok(Math.abs((pos.x - before.x) + overlap) < 1e-12,
      `overlap ${overlap}: pushed ${pos.x - before.x}, wanted -${overlap}`);
    assert.equal(pos.z, before.z, 'and nothing was moved along the wall');
    assert.equal(pos.y, before.y, 'resolve() is horizontal only — y is the caller\'s business');
  }
});

test('the resting position against a wall is a fixed point of resolve()', () => {
  const w = world();
  const wall = wallAtX(w, 4.5);

  /* This is the position every push-out above produces, so it has to be stable
   * under repetition — a resolve that nudged again here would make a player
   * leaning on a facade creep away from it a little every frame.
   *
   * Note what is *not* asserted: the return flag. `wall.x0 - R` is 4.08, and
   * 4.5 - 4.08 rounds to 0.41999999999999993 in doubles — a hair inside the
   * radius — so the `d2 > radius*radius` early-out at src/physics.js:228 misses
   * and resolve() reports a hit. The push it then computes is ~1.7e-16 of a
   * radius, far below the ULP of 4.08, so the position does not move at all.
   * Nothing in src reads the flag for the player or the creatures
   * (src/player.js:457, src/enemies.js:1263 both discard it), and position is
   * the contract that matters; asserting the flag here would pin a rounding
   * accident instead. */
  const pos = new THREE.Vector3(wall.x0 - R, 0, 3);
  for (let i = 0; i < 10; i++) {
    w.resolve(pos, R, H);
    assert.equal(pos.x, wall.x0 - R, `pass ${i} moved the capsule off the wall`);
    assert.equal(pos.z, 3, `pass ${i} slid the capsule along the wall`);
  }

  // and a capsule with real daylight around it is untouched, flag included
  const clear = new THREE.Vector3(wall.x0 - R - 0.5, 0, 3);
  assert.equal(w.resolve(clear, R, H), false, 'no contact reported when there is none');
  assert.equal(clear.x, wall.x0 - R - 0.5);
});

test('a corner contact pushes out along the diagonal, not along an axis', () => {
  const w = world();
  /* A single block whose near corner is at (4.5, 4.5). Approaching that corner
   * diagonally, the closest point on the box IS the corner, so the normal is
   * (-1,-1)/sqrt(2) and the capsule lands r/sqrt(2) back along both axes. This
   * is what rounds the outside of a building instead of catching on it. */
  const box = w.add(10, 10, 11, 11, 0, 6, 'building');
  assert.deepEqual([box.x0, box.z0], [4.5, 4.5]);

  const pos = new THREE.Vector3(4.3, 0, 4.3);
  assert.equal(w.resolve(pos, R, H), true);

  const expected = 4.5 - R / Math.SQRT2;
  assert.ok(Math.abs(pos.x - expected) < 1e-12, `x=${pos.x}, wanted ${expected}`);
  assert.ok(Math.abs(pos.z - expected) < 1e-12, `z=${pos.z}, wanted ${expected}`);
  /* And it really is on the circle: distance from the corner is exactly r. */
  assert.ok(Math.abs(Math.hypot(pos.x - 4.5, pos.z - 4.5) - R) < 1e-12);
});

test('boxes the capsule can step onto are ignored, boxes it cannot are not', () => {
  const w = world();
  /* The step-up filter is `b.top <= pos.y + stepUp` (src/physics.js:221). A
   * 0.5 m kerb is walked over; the same kerb 0.8 m tall blocks the player and
   * is stepped over by a golem, whose stepUp is 1.15. */
  const kerb = w.add(3, 0, 1, 40, 0, 0.5, 'street');
  const pos = new THREE.Vector3(kerb.x0 - R + 0.2, 0, 0);
  assert.equal(w.resolve(pos, R, H), false, 'a 0.5 m kerb does not stop a 0.7 m step');

  const w2 = world();
  const step80 = w2.add(3, 0, 1, 40, 0, 0.8, 'street');
  const p2 = new THREE.Vector3(step80.x0 - R + 0.2, 0, 0);
  assert.equal(w2.resolve(p2, R, H), true, '0.8 m is above the player\'s 0.7 m step');
  assert.ok(Math.abs(p2.x - (step80.x0 - R)) < 1e-12);

  const golem = new THREE.Vector3(step80.x0 - 1.05 + 0.2, 0, 0);
  assert.equal(w2.resolve(golem, 1.05, 2.9, 1.15), false, 'a golem strides over it');

  /* Overhead geometry the capsule passes under is ignored too: the guard is
   * `b.bottom >= pos.y + height`. An archway at 2 m clears a 1.78 m player. */
  const w3 = world();
  const arch = w3.add(3, 0, 1, 40, 2.0, 3, 'building');
  const p3 = new THREE.Vector3(arch.x0 - R + 0.2, 0, 0);
  assert.equal(w3.resolve(p3, R, H), false, 'the player walks under the arch');
  assert.equal(w3.resolve(p3, 1.05, 2.9, 1.15), true, 'the golem does not fit');
});

/* ================================================================== */
/* move and slide                                                      */
/* ================================================================== */

test('sliding along a wall keeps the tangential motion and removes only the normal', () => {
  const w = world();
  const wall = wallAtX(w, 4.5);
  const pos = new THREE.Vector3(3.0, 0, 0);

  /* Push in at 45°: 6 m/s into the wall, 6 m/s along it. The along-wall
   * displacement must survive untouched frame after frame, or a player brushing
   * a facade grinds to a halt — which is the classic symptom of a push-out that
   * cancels the whole motion instead of its normal component. */
  let slid = 0;
  for (let i = 0; i < 120; i++) {
    const zBefore = pos.z;
    const { removedZ } = step(w, pos, 6, 6);
    assert.ok(Math.abs(removedZ) < 1e-12, `frame ${i}: resolve stole ${removedZ} m of tangential motion`);
    slid += pos.z - zBefore;
  }

  assert.ok(Math.abs(pos.x - (wall.x0 - R)) < 1e-12, `ended at x=${pos.x}, wanted flush at ${wall.x0 - R}`);
  /* Tangential distance is exactly 120 frames of 6 m/s. */
  assert.ok(Math.abs(slid - 6 * 120 * DT) < 1e-12, `slid ${slid} m, wanted ${6 * 120 * DT}`);
  assert.ok(Math.abs(pos.z - 6 * 120 * DT) < 1e-12);
});

test('the removed component is exactly the projection onto the wall normal', () => {
  const w = world();
  const wall = wallAtX(w, 4.5);

  /* Start flush and push in at an arbitrary angle. The overlap resolve has to
   * undo is precisely the into-wall part of this frame's motion, vx*dt — no
   * more (which would bounce) and no less (which would leave the capsule
   * embedded and let the next frame's ground probe read the wall's roof). */
  for (const [vx, vz] of [[3, 0], [3, 9], [12, -4], [40, 40]]) {
    const pos = new THREE.Vector3(wall.x0 - R, 0, 0);
    const { removedX, removedZ } = step(w, pos, vx, vz);
    assert.ok(Math.abs(removedX - vx * DT) < 1e-12,
      `v=(${vx},${vz}): removed ${removedX} of the ${vx * DT} normal component`);
    assert.equal(removedZ, 0, 'and nothing tangential');
  }
});

/* ================================================================== */
/* the inner corner                                                    */
/* ================================================================== */

/** Two facades meeting at (4.5, 4.5); the open quadrant is x < 4.5, z < 4.5. */
function innerCorner() {
  const w = world();
  const a = wallAtX(w, 4.5);
  const b = wallAtZ(w, 4.5);
  return { w, a, b };
}

test('an inner corner resolves to the one correct point, from any depth', () => {
  const { w, a, b } = innerCorner();

  /* Three ways in: barely clipped, deeply inside both facades, and inside one
   * of them well away from the corner. All three must arrive at the same
   * place — flush with both faces — because that is the only position outside
   * both boxes nearest to where the capsule was. The deep cases exercise the
   * `d2 < 1e-8` shortest-axis ejection at src/physics.js:229-237, which is the
   * branch that could plausibly fling the player out the far side. */
  const target = [a.x0 - R, b.z0 - R];
  for (const start of [[4.55, 4.55], [5.0, 5.0], [6.0, 5.2], [4.6, 12.0]]) {
    const pos = new THREE.Vector3(start[0], 0, start[1]);
    assert.equal(w.resolve(pos, R, H), true);
    assert.ok(pos.x <= a.x0 - R + 1e-9, `from ${start}: x=${pos.x} is still inside the +x facade`);
    assert.ok(pos.z <= b.z0 - R + 1e-9, `from ${start}: z=${pos.z} is still inside the +z facade`);
    /* Never ejected through: the open quadrant is the one it came from, so a
     * capsule must not end up on the far side of either wall. */
    assert.ok(pos.x > a.x0 - 20, `from ${start}: teleported to x=${pos.x}`);
    assert.ok(pos.z > b.z0 - 20, `from ${start}: teleported to z=${pos.z}`);
  }

  const pos = new THREE.Vector3(4.55, 0, 4.55);
  w.resolve(pos, R, H);
  assert.ok(Math.abs(pos.x - target[0]) < 1e-12 && Math.abs(pos.z - target[1]) < 1e-12,
    `corner rest position was (${pos.x}, ${pos.z}), wanted (${target})`);
});

test('resolve is idempotent in a corner, so a parked capsule cannot buzz', () => {
  const { w, a, b } = innerCorner();
  const pos = new THREE.Vector3(4.7, 0, 4.7);
  w.resolve(pos, R, H);
  const settled = pos.clone();

  /* Re-resolving a settled capsule ten times must not move it. If it did, the
   * position would oscillate every frame and the animator's lean springs would
   * read it as jitter — the "wedged in the corner" bug. (The contact flag stays
   * set here for the rounding reason documented in the wall test above; the
   * position is the invariant.) */
  for (let i = 0; i < 10; i++) {
    w.resolve(pos, R, H);
    assert.equal(pos.x, settled.x, `pass ${i} moved x`);
    assert.equal(pos.z, settled.z, `pass ${i} moved z`);
  }
  assert.ok(Math.abs(settled.x - (a.x0 - R)) < 1e-12);
  assert.ok(Math.abs(settled.z - (b.z0 - R)) < 1e-12);
});

test('walking hard into an inner corner for ten seconds neither wedges nor escapes', () => {
  const { w, a, b } = innerCorner();
  const pos = new THREE.Vector3(0, 0, 0);

  /* Sprint diagonally into the corner and keep pushing. Once it arrives the
   * position must be dead still: sampling the last 60 frames must show zero
   * spread, and every frame in between must stay in the open quadrant. */
  const tail = [];
  for (let i = 0; i < 600; i++) {
    step(w, pos, 9.8, 9.8);
    assert.ok(pos.x <= a.x0 - R + 1e-9 && pos.z <= b.z0 - R + 1e-9,
      `frame ${i}: leaked into the geometry at (${pos.x}, ${pos.z})`);
    if (i >= 540) tail.push([pos.x, pos.z]);
  }

  const xs = tail.map((p) => p[0]);
  const zs = tail.map((p) => p[1]);
  assert.equal(Math.max(...xs) - Math.min(...xs), 0, 'x oscillated while pinned in the corner');
  assert.equal(Math.max(...zs) - Math.min(...zs), 0, 'z oscillated while pinned in the corner');
  assert.ok(Math.abs(pos.x - (a.x0 - R)) < 1e-12, `parked at x=${pos.x}`);
  assert.ok(Math.abs(pos.z - (b.z0 - R)) < 1e-12, `parked at z=${pos.z}`);
});

test('a corner still lets go the moment the push reverses', () => {
  const { w } = innerCorner();
  const pos = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 200; i++) step(w, pos, 9.8, 9.8);
  const pinned = pos.clone();

  /* Escaping matters as much as not passing through: a resolve that kept
   * re-ejecting would hold the player in the corner after they let go of the
   * stick. One second of walking away must clear the contact entirely. */
  for (let i = 0; i < 60; i++) step(w, pos, -5.4, -5.4);
  assert.ok(pinned.x - pos.x > 5, `only backed off ${(pinned.x - pos.x).toFixed(3)} m`);
  assert.equal(w.resolve(pos.clone(), R, H), false, 'and is free of the geometry');
});

test('a golem-sized capsule resolves a corner it does not fit in without exploding', () => {
  /* A 1.05 m radius creature pressed into a 1.4 m wide alcove: it cannot fit,
   * so both walls push it out at once. The requirement is not a specific
   * position — there is no correct one — but that it stays finite, stays in
   * bounds, and ends up outside the alcove rather than inside a wall. */
  const w = world();
  const left = w.add(-1.2, 4, 1, 8, 0, 6, 'building');    // x -1.7 .. -0.7
  const right = w.add(1.2, 4, 1, 8, 0, 6, 'building');    // x 0.7 .. 1.7
  const pos = new THREE.Vector3(0, 0, 2);

  for (let i = 0; i < 300; i++) {
    step(w, pos, 0, 2.9, DT, 1.05, 2.9, 1.15);
    assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.z), `frame ${i} went non-finite`);
    assert.ok(Math.abs(pos.x) < 400 && Math.abs(pos.z) < 400, `frame ${i} left the world`);
  }
  const insideLeft = pos.x > left.x0 && pos.x < left.x1;
  const insideRight = pos.x > right.x0 && pos.x < right.x1;
  assert.equal(insideLeft || insideRight, false, `ended inside a wall at x=${pos.x}`);
});

/* ================================================================== */
/* standing on ground: slopes, terrain, stairs                         */
/* ================================================================== */

/** A constant-gradient heightfield, in the shape `CollisionWorld` expects. */
function slopeTerrain(gradient) {
  return {
    cellSize: 4,
    maxHeight: 400,
    heightAt: (x) => gradient * x,
    normalAt: () => ({ x: 0, y: 1, z: 0 }),
  };
}

/**
 * The player's vertical step, verbatim from src/player.js:455-471: resolve
 * horizontally, integrate gravity, then snap up to `groundHeight`. Reproduced
 * here rather than driving a whole `Player` so the assertion can be about the
 * collision world alone. `test/player.test.js` covers the real object.
 */
function walk(w, pos, vx, vz, frames, { radius = R, height = H, gravity = 24 } = {}) {
  let vy = 0;
  let deepest = 0;
  let onGround = true;
  for (let i = 0; i < frames; i++) {
    pos.x += vx * DT;
    pos.z += vz * DT;
    w.resolve(pos, radius, height);
    vy -= gravity * DT;
    pos.y += vy * DT;
    const gy = w.groundHeight(pos.x, pos.z, pos.y, radius + 0.1, 0.75);
    if (pos.y <= gy) {
      pos.y = gy;
      vy = 0;
      onGround = true;
    } else if (pos.y > gy + 0.06) {
      onGround = false;
    }
    /* How far below the surface directly underfoot the capsule ended up.
     * Anything positive is sinking. */
    const support = w.groundHeight(pos.x, pos.z, pos.y, radius, 0.02);
    deepest = Math.max(deepest, support - pos.y);
  }
  return { deepest, onGround, vy };
}

test('walking uphill across a heightfield never sinks below the surface', () => {
  const gradient = 0.25;                       // ~14°, steeper than any Brno street
  const w = world().setTerrain(slopeTerrain(gradient));
  const pos = new THREE.Vector3(0, 0, 0);

  /* 20 seconds of uphill walking. The snap-up in the loop is unconditional, so
   * the capsule should track the surface exactly — the assertion is equality
   * with the analytic height, not a tolerance band. */
  const { deepest, onGround } = walk(w, pos, 5.4, 0, 1200);

  assert.equal(deepest, 0, `sank ${deepest} m into the hillside at some point`);
  assert.ok(Math.abs(pos.x - 5.4 * 1200 * DT) < 1e-9, 'and covered the ground it should have');
  assert.ok(Math.abs(pos.y - gradient * pos.x) < 1e-9,
    `ended at y=${pos.y}, the slope is at ${gradient * pos.x}`);
  assert.equal(onGround, true, 'and is standing on it, not hovering');
});

test('walking downhill across a heightfield never sinks either', () => {
  const gradient = 0.25;
  const w = world().setTerrain(slopeTerrain(gradient));
  const pos = new THREE.Vector3(0, 0, 0);

  /* Downhill is the direction that goes wrong: the walker outruns gravity and
   * spends most frames a little airborne, so a resolve that let the capsule
   * catch on the far side of a cell would show up as sinking. */
  const { deepest } = walk(w, pos, -5.4, 0, 1200);

  assert.equal(deepest, 0, `sank ${deepest} m going downhill`);
  assert.ok(Math.abs(pos.y - gradient * pos.x) < 1e-9,
    `ended at y=${pos.y}, the slope is at ${gradient * pos.x}`);
});

test('a capsule circling a heightfield for 20 s stays on the surface every frame', () => {
  /* A bumpy field rather than a plane, walked in a circle so the capsule
   * crosses cell boundaries in both axes at every angle. Twelve hundred frames,
   * and the surface must be underfoot on all of them. */
  const terrain = {
    cellSize: 4,
    maxHeight: 400,
    heightAt: (x, z) => 3 * Math.sin(x * 0.15) + 2 * Math.cos(z * 0.11),
    normalAt: () => ({ x: 0, y: 1, z: 0 }),
  };
  const w = world().setTerrain(terrain);
  const pos = new THREE.Vector3(0, terrain.heightAt(0, 0), 0);
  let vy = 0;
  let deepest = 0;

  for (let i = 0; i < 1200; i++) {
    const a = i * 0.02;
    pos.x += Math.cos(a) * 5.4 * DT;
    pos.z += Math.sin(a) * 5.4 * DT;
    w.resolve(pos, R, H);
    vy -= 24 * DT;
    pos.y += vy * DT;
    const gy = w.groundHeight(pos.x, pos.z, pos.y, R + 0.1, 0.75);
    if (pos.y <= gy) { pos.y = gy; vy = 0; }
    deepest = Math.max(deepest, terrain.heightAt(pos.x, pos.z) - pos.y);
  }

  assert.equal(deepest, 0, `dipped ${deepest} m under the terrain`);
  assert.ok(Number.isFinite(pos.y));
});

test('a box staircase is climbed step by step, never sunk into', () => {
  const w = world();
  /* Ten 1 m treads rising 0.5 m each — inside the player's 0.7 m step. Both
   * halves matter: the treads must not block (they are low enough to be
   * ignored by resolve) and the ground probe must find each one in turn. */
  for (let i = 0; i < 10; i++) w.add(i + 0.5, 0, 1, 12, 0, (i + 1) * 0.5, 'building');

  /* 130 frames of 5.4 m/s from x = -2 puts the capsule at x = 9.7, which is on
   * the tenth tread (x 9..10, top 5.0) and not yet off the end of it. */
  const pos = new THREE.Vector3(-2, 0, 0);
  const { deepest } = walk(w, pos, 5.4, 0, 130);

  assert.equal(deepest, 0, `sank ${deepest} m into a tread`);
  assert.ok(Math.abs(pos.x - 9.7) < 1e-9, `fixture drift: ended at x=${pos.x}`);
  assert.ok(Math.abs(pos.y - 5.0) < 1e-9, `topped out at y=${pos.y}, the tenth tread is at 5.0`);
});

test('a wall one step too tall is not climbed', () => {
  const w = world();
  /* The mirror image of the staircase: a 0.8 m riser is above the step
   * tolerance, so the player is stopped flush against it and stays at street
   * level. Without this the step-up filter would be a free wall climb. */
  const riser = w.add(6, 0, 4, 12, 0, 0.8, 'building');
  const pos = new THREE.Vector3(0, 0, 0);
  const { deepest } = walk(w, pos, 5.4, 0, 300);

  assert.equal(deepest, 0);
  assert.equal(pos.y, 0, 'still on the street');
  assert.ok(Math.abs(pos.x - (riser.x0 - R)) < 1e-9, `stopped at x=${pos.x}, wanted ${riser.x0 - R}`);
});

test('the world bounds are the last word, whatever the push-out did', () => {
  const w = new CollisionWorld();
  w.bounds = { x0: -10, z0: -10, x1: 10, z1: 10 };
  /* src/physics.js:249-252 clamps after every push. It is what stops a corner
   * ejection at the edge of the map from throwing anything into the void. */
  const pos = new THREE.Vector3(500, 0, -500);
  w.resolve(pos, R, H);
  assert.deepEqual([pos.x, pos.z], [10, -10]);
});
