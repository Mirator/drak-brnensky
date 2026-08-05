/**
 * Pack tactics — `updatePack` in src/creatures/brains.js.
 *
 * This is the one piece of genuinely emergent behaviour in the game: a handful
 * of Ještěrky that would individually be trivial become dangerous because only
 * a couple press at a time, one plays bait, and the rest wait on a ring. It is
 * also pure logic over a manager-shaped object, with no RNG, no scene and no
 * geometry — so it can be tested exactly rather than statistically, which is
 * why the fakes below are as small as they are.
 *
 * The fake manager's shape is taken from the real one: `mgr.pack`
 * (src/enemies.js:153), `mgr.list` (:132) and the `info` record the manager
 * fills in before calling (src/enemies.js:155-158, 1012-1019). The single call
 * site is src/enemies.js:1019.
 *
 * The invariants that matter, and what breaks if they go:
 *   - at most three press tokens: more and the pack collapses into a scrum that
 *     no amount of dodging survives;
 *   - exactly one bait: two and the feint stops reading as a feint;
 *   - dead and distant whelps hold no tokens: otherwise a corpse on the far
 *     side of the square holds a press slot and the live pack circles forever;
 *   - the assignment depends only on distance and spawn serial, never on
 *     iteration order, or a seeded run stops replaying.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Rng } from '../src/rng.js';
import { updatePack, whelpBrain } from '../src/creatures/brains.js';
import { ENEMY_TYPES } from '../src/enemies.js';

/* ------------------------------------------------------------------ */
/* fakes, shaped after the real call site                              */
/* ------------------------------------------------------------------ */

/** The fields `updatePack` and `whelpBrain` read off a creature. */
function whelp(serial, x, z, over = {}) {
  return {
    typeId: 'whelp',
    type: ENEMY_TYPES.whelp,
    hp: ENEMY_TYPES.whelp.hp,
    maxHp: ENEMY_TYPES.whelp.hp,
    speed: ENEMY_TYPES.whelp.speed,
    state: 'chase',
    serial,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    role: 'unassigned',
    pressT: 0,
    packAngle: 0,
    packRadius: 0,
    packDist: 0,
    strafe: 1,
    stuckT: 0,
    attackCd: 1,
    moveX: 0,
    moveZ: 0,
    moveSpeed: 0,
    ...over,
  };
}

/**
 * `mgr.pack.t` starts at 0 so the first call always runs, matching a manager
 * fresh out of its constructor (src/enemies.js:153).
 */
function manager(list, over = {}) {
  return {
    list,
    pack: { t: 0, members: [] },
    rng: new Rng(0xbeef),
    los: () => true,
    startAct() {},
    ...over,
  };
}

function info(px = 0, pz = 0, facing = 0, dt = 1 / 60) {
  return { dt, pp: { x: px, y: 0, z: pz }, player: { facing } };
}

/** n whelps in a line, closest first, so distance order equals serial order. */
function line(n, from = 4, gap = 1.5) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(whelp(i, from + i * gap, 0));
  return out;
}

const roles = (list) => list.map((w) => w.role);
const count = (list, role) => roles(list).filter((r) => r === role).length;

/* ================================================================== */
/* token budget                                                        */
/* ================================================================== */

test('at most three press tokens are ever live, however big the pack', () => {
  /* The budget is `max(1, min(3, ceil(n/3)))` (src/creatures/brains.js:63): one
   * in three whelps presses, hard-capped at three. Three is the number the
   * player's dodge and 14-round magazine were tuned against — a fourth
   * simultaneous attacker is what turns a wave into a wall. */
  for (const [n, expected] of [[1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 2], [7, 3], [9, 3], [12, 3], [20, 3]]) {
    const list = line(n);
    updatePack(manager(list), 0.4, info());
    const pressing = count(list, 'press');
    assert.equal(pressing, expected, `${n} whelps handed out ${pressing} press tokens`);
    assert.ok(pressing <= 3, 'the cap is three, always');
  }
});

test('exactly one whelp is the bait, and only when there is a pack to bait for', () => {
  /* A lone whelp has nobody to open the player up for, so it presses instead of
   * dancing (src/creatures/brains.js:54-58). From two upwards, precisely one
   * bait — the nearest — and it is never also a presser. */
  const solo = line(1);
  updatePack(manager(solo), 0.4, info());
  assert.equal(count(solo, 'bait'), 0, 'a single whelp does not play bait to itself');
  assert.equal(solo[0].role, 'press');

  for (const n of [2, 3, 5, 8, 14]) {
    const list = line(n);
    updatePack(manager(list), 0.4, info());
    assert.equal(count(list, 'bait'), 1, `${n} whelps produced ${count(list, 'bait')} baits`);
    assert.equal(list[0].role, 'bait', 'and it is the closest one');
    assert.equal(count(list, 'press') + count(list, 'bait') + count(list, 'flank'), n,
      'every member has exactly one role');
  }
});

test('the bait is the nearest whelp, not the first in the list', () => {
  /* Ordering is by distance then serial (src/creatures/brains.js:42), so the
   * bait is whoever is actually in the player's face. Handing the role to
   * whatever the list happened to hold first would put the feint 40 m away. */
  const list = [whelp(0, 30, 0), whelp(1, 6, 0), whelp(2, 14, 0)];
  updatePack(manager(list), 0.4, info());
  assert.equal(list[1].role, 'bait', 'the whelp 6 m out is the bait');
  assert.notEqual(list[0].role, 'bait');
  assert.notEqual(list[2].role, 'bait');
});

/* ================================================================== */
/* who is even in the pack                                            */
/* ================================================================== */

test('dead, distant and non-whelp creatures get no tokens and no slots', () => {
  const alive = [whelp(0, 4, 0), whelp(1, 6, 0)];
  const excluded = [
    whelp(2, 8, 0, { hp: 0 }),                          // killed, hp already zero
    whelp(3, 10, 0, { state: 'dead' }),                 // corpse still in the list
    whelp(4, 50, 0),                                    // 50 m out, past the 46 m cut
    whelp(5, 4, 0, { typeId: 'spitter' }),              // wrong archetype
  ];
  const list = [...alive, ...excluded];
  const mgr = manager(list);
  updatePack(mgr, 0.4, info());

  assert.deepEqual(mgr.pack.members.map((w) => w.serial), [0, 1],
    'only the two live whelps in range are members');
  for (const w of excluded) {
    assert.equal(w.role, 'unassigned', `serial ${w.serial} was handed the role ${w.role}`);
    assert.equal(w.packRadius, 0, `serial ${w.serial} was given a ring slot`);
    assert.equal(w.pressT, 0, `serial ${w.serial} accrued press seniority while ineligible`);
  }
  /* And the ones that are in the pack really did get everything. */
  for (const w of alive) {
    assert.notEqual(w.role, 'unassigned');
    assert.ok(w.packRadius > 0);
    assert.ok(w.pressT > 0);
  }
});

test('the 46 m cut is on the boundary, not approximate', () => {
  /* src/creatures/brains.js:34. A whelp on the far side of the square is not
   * part of this fight; one at 45.9 m closing in is. */
  const inside = whelp(0, 45.9, 0);
  const outside = whelp(1, 46.1, 0);
  const near = whelp(2, 5, 0);
  const mgr = manager([near, inside, outside]);
  updatePack(mgr, 0.4, info());

  assert.deepEqual(mgr.pack.members.map((w) => w.serial), [2, 0]);
  assert.equal(outside.role, 'unassigned');
  /* The distance is measured flat, from the player, and cached on the creature
   * for the brain to reuse. */
  assert.ok(Math.abs(inside.packDist - 45.9) < 1e-12);
  assert.ok(Math.abs(near.packDist - 5) < 1e-12);
});

test('a corpse that was pressing is dropped from the pack on the next pass', () => {
  /* The failure this rules out: a whelp dies holding a press token, stays in
   * `mgr.list` for its whole corpse life, and the rest of the pack keeps
   * circling because the budget is already spent. */
  const list = line(4);
  const mgr = manager(list);
  updatePack(mgr, 0.4, info());
  const presser = list.find((w) => w.role === 'press');
  assert.ok(presser, 'somebody was pressing to begin with');

  presser.hp = 0;
  presser.state = 'dead';
  mgr.pack.t = 0;
  updatePack(mgr, 0.4, info());

  assert.equal(mgr.pack.members.includes(presser), false, 'the corpse left the pack');
  assert.ok(count(list.filter((w) => w.hp > 0), 'press') >= 1,
    'and a live whelp picked the token up');
});

/* ================================================================== */
/* the ring: slots                                                     */
/* ================================================================== */

test('slots are handed out in mirrored pairs at three staggered radii', () => {
  const list = line(14);
  updatePack(manager(list), 0.4, info(0, 0, 0));

  /* The SLOTS table (src/creatures/brains.js:45) is a mirrored set, and members
   * arrive in distance order, so the nearest whelps are sent to opposite sides
   * of the player. That is what makes a pack bracket you rather than queue up on
   * one flank.
   *
   * Two claims, because the table only alternates strictly at the front: for
   * the first four members — the common case, a wave of two to four — slots
   * alternate side by side; and across the whole table every offset's mirror
   * image is present, so a full ring is balanced. */
  const offsets = list.map((w) => w.packAngle - 0);      // player facing is 0
  for (let i = 0; i + 1 < 4; i += 2) {
    assert.ok(Math.abs(offsets[i] + offsets[i + 1]) < 1e-12,
      `slots ${i} and ${i + 1} are not mirrored: ${offsets[i]} / ${offsets[i + 1]}`);
  }
  for (const s of offsets) {
    assert.ok(Math.abs(s) > 1e-6, `a slot sits on the player's own axis`);
    const mirrors = offsets.filter((o) => Math.abs(o + s) < 1e-12).length;
    const same = offsets.filter((o) => Math.abs(o - s) < 1e-12).length;
    assert.equal(mirrors, same, `offset ${s} has ${mirrors} mirrors for ${same} copies`);
  }

  /* Radii cycle 5.4 / 7.1 / 8.8 (`5.4 + (i % 3) * 1.7`), so the ring has depth
   * instead of being a single circle everything crowds onto. Every one of them
   * is far outside bite reach (attackRange 2.3), which is what makes a slotted
   * whelp a threat-in-waiting rather than a free hit. */
  assert.deepEqual([...new Set(list.map((w) => w.packRadius))].sort((a, b) => a - b),
    [5.4, 5.4 + 1.7, 5.4 + 3.4]);
  for (const w of list) {
    assert.ok(w.packRadius > ENEMY_TYPES.whelp.attackRange * 2,
      `a slot at ${w.packRadius} m is inside striking distance`);
  }
});

test('slots rotate with the player, so the ring is player-relative', () => {
  /* `packAngle = player.facing + SLOTS[i]` — turn and the whole ring turns with
   * you. If it did not, spinning on the spot would leave the pack behind. */
  const a = line(6);
  const b = line(6);
  updatePack(manager(a), 0.4, info(0, 0, 0));
  updatePack(manager(b), 0.4, info(0, 0, 1.2));

  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs((b[i].packAngle - a[i].packAngle) - 1.2) < 1e-12,
      `slot ${i} did not follow the player's facing`);
    assert.equal(b[i].packRadius, a[i].packRadius, 'and the radius is facing-independent');
  }
});

test('the slot table places whelps off the player\'s axis, on both sides, at every depth', () => {
  /* Pinning what the table actually produces, so any retune of SLOTS is a
   * deliberate act rather than a typo.
   *
   * The bearing convention: three.js yaw `f` means forward is (-sin f, -cos f),
   * while a slot at angle `a` sits at `pp + (sin a, cos a) * radius`
   * (src/creatures/brains.js:83-84). So a slot offset `s` from the player's
   * facing has dot(slotDir, forward) = -cos(s): an offset of 0 is directly
   * BEHIND the player and an offset of ±pi is directly in front.
   *
   * TODO(design): the comment above SLOTS says the ring "fans out behind and to
   * the sides of where the player is looking", but under that convention eight
   * of the fourteen offsets (|s| > pi/2) put the whelp in front of him. The
   * numbers read as if they were written as offsets from *forward* rather than
   * from behind. Behaviour is pinned as-is here — nothing about it is broken,
   * a whelp on a 5-9 m ring is a threat from any bearing — but it is worth a
   * designer's eye, and this assertion will fail loudly if the table is
   * changed without one. */
  const list = line(14);
  updatePack(manager(list), 0.4, info(0, 0, 0));
  const forward = { x: -Math.sin(0), z: -Math.cos(0) };
  const dots = list.map((w) => {
    const d = { x: Math.sin(w.packAngle), z: Math.cos(w.packAngle) };
    return d.x * forward.x + d.z * forward.z;
  });

  assert.equal(dots.filter((d) => d > 0).length, 8, 'slots ahead of the player');
  assert.equal(dots.filter((d) => d < 0).length, 6, 'slots behind him');
  /* Nobody is ever sent to the exact centre of his view or his back — the
   * closest the table comes is |cos| = 0.999 at an offset of 3.1 rad. */
  for (const d of dots) assert.ok(Math.abs(d) < 0.9995, `a slot is dead on the axis (dot ${d})`);
  /* And the ring uses both flanks evenly. The lateral component of a slot at
   * offset `s` is sin(s) — the projection onto the player's right-hand axis —
   * and the mirrored table makes those cancel exactly. A lopsided ring would
   * mean the pack always came round the same shoulder. */
  const lateral = list.reduce((s, w) => s + Math.sin(w.packAngle - 0), 0);
  assert.ok(Math.abs(lateral) < 1e-12, `the ring is lopsided by ${lateral}`);
});

/* ================================================================== */
/* the throttle                                                        */
/* ================================================================== */

test('the coordinator runs on a 0.32 s tick and leaves the pack alone in between', () => {
  /* Re-shuffling roles every frame would make the pack twitch; the throttle at
   * src/creatures/brains.js:26-29 is what gives a flanker time to actually
   * reach its slot. Also: it is what bounds the cost of this function, which
   * runs against the whole creature list. */
  const list = line(3);
  const mgr = manager(list);
  updatePack(mgr, 0.4, info());
  assert.equal(mgr.pack.t, 0.32, 'the tick is re-armed at 0.32 s');
  const before = roles(list);

  const late = whelp(9, 5, 0);
  list.push(late);
  updatePack(mgr, 0.1, info());
  assert.ok(Math.abs(mgr.pack.t - 0.22) < 1e-12, 'the timer counted down');
  assert.deepEqual(roles(list.slice(0, 3)), before, 'and nothing was reassigned');
  assert.equal(late.role, 'unassigned', 'the newcomer waits for the next pass');
  assert.equal(mgr.pack.members.length, 3, 'and is not in the member list yet');

  updatePack(mgr, 0.25, info());                        // pushes pack.t below zero
  assert.equal(mgr.pack.t, 0.32);
  assert.equal(mgr.pack.members.length, 4, 'now it joins');
  assert.notEqual(late.role, 'unassigned');
});

test('an empty or all-dead pack leaves the member list empty and does not throw', () => {
  const mgr = manager([]);
  updatePack(mgr, 0.4, info());
  assert.equal(mgr.pack.members.length, 0);

  const dead = [whelp(0, 4, 0, { hp: 0 }), whelp(1, 5, 0, { state: 'dead' })];
  const mgr2 = manager(dead);
  updatePack(mgr2, 0.4, info());
  assert.equal(mgr2.pack.members.length, 0);
  /* The early return at src/creatures/brains.js:37 happens *after* the timer is
   * re-armed, so an empty pack still costs one pass in 0.32 s, not one a frame. */
  assert.equal(mgr2.pack.t, 0.32);
});

/* ================================================================== */
/* token rotation and determinism                                      */
/* ================================================================== */

test('the press token rotates, so no whelp circles forever while two do the work', () => {
  /* Seniority: the token goes to whoever has waited longest, and pressing
   * resets your own timer (src/creatures/brains.js:62-64, and
   * src/creatures/brains.js:79 / :122 in the brain). Over a dozen passes every
   * whelp except the bait must have held it at least once. */
  const list = line(6);
  const mgr = manager(list);
  const held = new Set();

  for (let pass = 0; pass < 12; pass++) {
    mgr.pack.t = 0;
    updatePack(mgr, 0.4, info());
    for (const w of list) {
      if (w.role === 'press') {
        held.add(w.serial);
        w.pressT = 0;                                  // what whelpBrain does on a press
      }
    }
  }

  const eligible = list.filter((w) => w.role !== 'bait').map((w) => w.serial);
  for (const serial of eligible) {
    assert.ok(held.has(serial), `whelp ${serial} never got a turn in 12 passes`);
  }
  assert.equal(held.has(list[0].serial), false, 'and the bait never doubles as a presser');
});

test('the assignment depends only on distance and serial, never on list order', () => {
  /* This is what makes a seeded run replay: `mgr.list` order is an artefact of
   * spawn and death order, and the sort at src/creatures/brains.js:42 has to
   * wash it out completely — including the serial tie-break for two whelps at
   * the same distance. */
  const build = () => [
    whelp(0, 12, 0), whelp(1, 4, 0), whelp(2, 8, 0), whelp(3, 6, 0),
    whelp(4, 8, 0),                                   // ties with serial 2 on distance
    whelp(5, 0, 8),                                   // same distance, different bearing
  ];
  const key = (list) => list
    .slice()
    .sort((a, b) => a.serial - b.serial)
    .map((w) => [w.serial, w.role, w.packAngle.toFixed(12), w.packRadius].join(':'))
    .join(' | ');

  const forwards = build();
  const backwards = build().reverse();
  const shuffled = build();
  shuffled.push(...shuffled.splice(0, 3));
  for (const list of [forwards, backwards, shuffled]) updatePack(manager(list), 0.4, info());

  assert.equal(key(backwards), key(forwards), 'reversing the list changed the plan');
  assert.equal(key(shuffled), key(forwards), 'rotating the list changed the plan');
});

/* ================================================================== */
/* what the roles actually do                                          */
/* ================================================================== */

test('a presser closes in and a flanker steers to its slot instead', () => {
  /* The point of the token, checked through `whelpBrain`: only a presser runs
   * straight at the player. A flanker outside its slot heads for the slot, and
   * the direction it picks must be the slot's, not the player's. */
  const list = line(6);
  const mgr = manager(list);
  updatePack(mgr, 0.4, info(0, 0, 0));

  const presser = list.find((w) => w.role === 'press');
  const flanker = list.find((w) => w.role === 'flank');
  assert.ok(presser && flanker, 'the pack produced both roles');

  const to = (e) => {
    const dx = 0 - e.pos.x;
    const dz = 0 - e.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    return { toX: dx / d, toZ: dz / d, distFlat: d };
  };

  const pi = { ...info(0, 0, 0), ...to(presser) };
  whelpBrain(mgr, presser, pi);
  assert.ok(Math.abs(presser.moveX - pi.toX) < 1e-12 && Math.abs(presser.moveZ - pi.toZ) < 1e-12,
    'a presser goes straight at the player');
  assert.equal(presser.pressT, 0, 'and its seniority is spent');

  const fi = { ...info(0, 0, 0), ...to(flanker) };
  whelpBrain(mgr, flanker, fi);
  const slotX = Math.sin(flanker.packAngle) * flanker.packRadius;
  const slotZ = Math.cos(flanker.packAngle) * flanker.packRadius;
  const dx = slotX - flanker.pos.x;
  const dz = slotZ - flanker.pos.z;
  const d = Math.hypot(dx, dz);
  assert.ok(d > 1.8, 'fixture sanity: the flanker starts away from its slot');
  assert.ok(Math.abs(flanker.moveX - dx / d) < 1e-12 && Math.abs(flanker.moveZ - dz / d) < 1e-12,
    'a flanker heads for its slot, not for the player');
});

test('a far-off pack all closes in regardless of role', () => {
  /* src/creatures/brains.js:75 — the ring only makes sense once the pack has
   * arrived. Beyond 24 m everyone runs in, or a wave spawned across the square
   * would orbit a point the player is nowhere near. */
  const list = line(6, 30, 1);
  const mgr = manager(list);
  updatePack(mgr, 0.4, info(0, 0, 0));

  for (const e of list) {
    const dx = -e.pos.x;
    const dz = -e.pos.z;
    const d = Math.hypot(dx, dz);
    const i = { ...info(0, 0, 0), toX: dx / d, toZ: dz / d, distFlat: d };
    whelpBrain(mgr, e, i);
    assert.ok(Math.abs(e.moveX - i.toX) < 1e-12,
      `${e.role} at ${d.toFixed(1)} m did not close in`);
  }
});
