/**
 * The Drak brněnský fight — src/creatures/bossfight.js.
 *
 * A single 7 600 HP enemy carries the whole endgame, and the thing that makes
 * it a fight rather than a damage race is a schedule: entrance, ground phase
 * with six cooldown- and range-gated abilities, an airborne phase, and a
 * vulnerable window after every big commitment. Every one of those transitions
 * is a threshold, and a regression in any of them is either an unwinnable boss
 * (no exhausted window) or a trivial one (permanent exhausted window).
 *
 * `bossfight.js` is pure logic over a manager-shaped object and a creature
 * record, so the fakes below are the whole test harness. Their shape is taken
 * from the real caller:
 *
 *   - `bossBrain(mgr, e, info)`   src/enemies.js:1100
 *   - `bossActTick(mgr, e, info, act, bt)`  src/enemies.js:485
 *   - `bossActCommit(mgr, e, info, act)`    src/enemies.js:526
 *   - `initBoss(e)`               src/enemies.js:321
 *   - the manager methods reached for: `startAct` (:460), `groundAt` (:799),
 *     `los` (:803), `hitPlayer` (:577), `rangedAttack` (:585),
 *     `bossBreathTick` (:619), `onBossRoar` / `onBossPhase` (:133-134),
 *     `vfx`, `vfxRng`, `rng`, `scratch`.
 *
 * `vfx` is left null throughout, which is a supported configuration — every
 * effect in this module is behind an `if (mgr.vfx)` and src/creatures/fx.js
 * returns immediately without one. That keeps the fake to what the *rules*
 * need. The act timings come from the real DRAGON archetype rather than being
 * invented, so a retune of the anticipation windows is visible here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Rng } from '../src/rng.js';
import { initBoss, bossBrain, bossActCommit, bossActTick } from '../src/creatures/bossfight.js';
import { DRAGON } from '../src/creatures/index.js';
import { beat, actLength } from '../src/creatures/kit.js';
import { ENEMY_TYPES } from '../src/enemies.js';

/* ------------------------------------------------------------------ */
/* fakes                                                              */
/* ------------------------------------------------------------------ */

const DT = 1 / 60;
/** Mirrors GROUND_ABILITIES at src/creatures/bossfight.js:21-29. */
const ABILITIES = ['buffet', 'tail', 'breath', 'bite', 'charge', 'fan'];

function fakeMgr(over = {}) {
  const calls = { acts: [], hits: [], roars: 0, phases: 0, ranged: 0, breath: 0 };
  const mgr = {
    calls,
    vfx: null,
    vfxRng: new Rng(0xd4a6),
    rng: new Rng(0x51ee),
    scratch: new THREE.Vector3(),
    groundAt: () => 0,
    los: () => true,
    /* Shaped after EnemyManager#startAct (src/enemies.js:460-478): it reads the
     * archetype's act spec, stamps ant/com/rec onto a fresh act, merges `extra`
     * and puts the creature into the 'attack' state. */
    startAct(e, id, extra = null) {
      const spec = DRAGON.acts[id];
      if (!spec) return null;
      e.act = { id, ant: spec.ant, com: spec.com, rec: spec.rec, t: 0, fired: false, hit: false, after: 'chase' };
      if (extra) Object.assign(e.act, extra);
      e.state = 'attack';
      e.stateT = 0;
      calls.acts.push({ id, extra, act: e.act });
      return e.act;
    },
    hitPlayer(e, dmg, dirX, dirZ, knock = 1) {
      calls.hits.push({ dmg, dirX, dirZ, knock, act: e.act ? e.act.id : null, t: e.act ? e.act.t : -1 });
    },
    rangedAttack() { calls.ranged++; },
    bossBreathTick(e, dt) { calls.breath++; e.breath -= dt; },
    onBossRoar() { calls.roars++; },
    onBossPhase() { calls.phases++; },
    ...over,
  };
  return mgr;
}

/** A dragon in the shape `EnemyManager.spawn()` leaves one in. */
function boss(over = {}) {
  const type = ENEMY_TYPES.boss;
  const e = {
    typeId: 'boss',
    type: { ...type },
    hp: type.hp,
    maxHp: type.hp,
    speed: type.speed,
    moveSpeed: type.speed,
    damage: type.damage,
    scale: type.scale,
    pos: new THREE.Vector3(0, 0, 0),
    vel: new THREE.Vector3(),
    facing: 0,
    moveX: 0,
    moveZ: 0,
    faceX: undefined,
    faceZ: undefined,
    strafe: 1,
    sweepSide: 1,
    flyTarget: new THREE.Vector3(),
    flying: false,
    soar: 0,
    climb: 0,
    breath: 0,
    breathCd: 6,
    phase2: false,
    act: null,
    state: 'ground',
    stateT: 1,
  };
  initBoss(e);                                     // then let overrides win
  return Object.assign(e, over);
}

/**
 * The `info` record the manager fills in each frame (src/enemies.js:1048-1057).
 * The dragon sits at the origin facing yaw 0, whose forward is
 * (-sin 0, -cos 0) = (0, -1), so a player at -z is straight ahead of it.
 */
function info(distFlat = 10, over = {}) {
  const player = {
    pos: new THREE.Vector3(0, 0, -distFlat),
    vel: new THREE.Vector3(),
    centre: new THREE.Vector3(0, 1, -distFlat),
    facing: 0,
  };
  return {
    dt: DT,
    player,
    pp: player.pos,
    pc: player.centre,
    distFlat,
    distFull: distFlat,
    toX: 0,
    toZ: -1,
    ...over,
  };
}

/** All cooldowns cleared, so ability choice is decided by range alone. */
function readyAll(e) {
  for (const id of ABILITIES) e.abilityCd[id] = 0;
  e.breathCd = 0;
  return e;
}

/* ================================================================== */
/* initialisation                                                      */
/* ================================================================== */

test('initBoss puts every ability a third of the way through its cooldown', () => {
  /* src/creatures/bossfight.js:33. Starting from zero would let the dragon open
   * with its whole repertoire at once; starting from full would give the player
   * eleven free seconds. A consistent fraction of each is the middle ground,
   * and this pins that they are staggered by their own cooldown rather than all
   * set to the same number. */
  const e = boss();
  const cds = ABILITIES.map((id) => e.abilityCd[id]);
  assert.equal(cds.length, 6, 'six ground abilities');
  for (const cd of cds) assert.ok(cd > 0, 'nothing is available on the first frame');
  /* buffet's cooldown is 9.0 and bite's is 2.6, so the ratio has to survive. */
  assert.ok(Math.abs(e.abilityCd.buffet / e.abilityCd.bite - 9.0 / 2.6) < 1e-9,
    'the cooldowns were flattened instead of scaled');
  assert.equal(e.airCd, 20, 'and the first take-off is 20 s out');
  assert.equal(e.airT, 0);
  assert.equal(e.exhaustT, 0);
  assert.equal(e.vulnerable, 0, 'it does not start the fight vulnerable');
});

/* ================================================================== */
/* phase 2                                                             */
/* ================================================================== */

test('phase 2 triggers the instant health crosses half, and exactly once', () => {
  const mgr = fakeMgr();
  const e = boss({ hp: ENEMY_TYPES.boss.hp * 0.5 });

  /* The test is `hp < maxHp * 0.5` (src/creatures/bossfight.js:45) — strictly
   * below, so landing exactly on half is still phase 1. Pinning the boundary
   * matters because the callback drives a one-shot roar and screen effect in
   * main.js; firing it twice, or a frame early, is visible. */
  bossBrain(mgr, e, info());
  assert.equal(e.phase2, false, 'exactly half is not yet across the line');
  assert.equal(mgr.calls.phases, 0);

  e.hp -= 0.1;
  bossBrain(mgr, e, info());
  assert.equal(e.phase2, true);
  assert.equal(mgr.calls.phases, 1, 'the phase callback fires once');
  assert.equal(e.speed, ENEMY_TYPES.boss.speed * 1.25, 'and it speeds up');
  assert.ok(Math.abs(e.type.attackCd - ENEMY_TYPES.boss.attackCd * 0.7) < 1e-9,
    'and attacks more often');
  assert.equal(e.type !== ENEMY_TYPES.boss, true,
    'the retune is on a copy, so the shared archetype is not mutated');
  assert.equal(ENEMY_TYPES.boss.attackCd, 2.2, 'and the archetype really is untouched');

  /* It announces itself with an act rather than just a number change. */
  assert.equal(e.act && e.act.id, 'phase');
  assert.equal(e.act.after, 'ground');
  assert.equal(e.state, 'attack');
  assert.equal(e.flying, false, 'and it comes down to do it');
  assert.equal(e.exhaustT, 0);

  const acts = mgr.calls.acts.length;
  const speed = e.speed;
  bossBrain(mgr, e, info());
  assert.equal(mgr.calls.phases, 1, 'a second frame does not re-trigger');
  assert.equal(mgr.calls.acts.length, acts, 'and does not start a second phase act');
  assert.equal(e.speed, speed, 'nor apply the speed bonus twice');
});

test('a dying dragon does not enter phase 2 on the way out', () => {
  /* Overkill takes hp through half and through zero in the same hit, and the
   * manager sets state to 'dead' before the brain runs again. Without the
   * `state !== 'dead'` guard the corpse would rear up and slam the square. */
  const mgr = fakeMgr();
  const e = boss({ hp: 40, state: 'dead' });
  bossBrain(mgr, e, info());
  assert.equal(e.phase2, false);
  assert.equal(mgr.calls.phases, 0);
  assert.equal(mgr.calls.acts.length, 0);
});

/* ================================================================== */
/* ground phase: ability selection                                     */
/* ================================================================== */

test('the ground phase picks the first ability whose range fits, in priority order', () => {
  /* GROUND_ABILITIES is ordered deliberately (src/creatures/bossfight.js:20):
   * the big committed moves outrank the filler bite, and the long-range fan
   * sits below the charge. So each distance band has one right answer.
   *
   * At 12.5 m the tail is skipped even though its range covers it, because the
   * player is in front and further than 6 m (:159-163) — a tail sweep at
   * someone standing in your face is nonsense — which is why 'breath' wins
   * there and not 'tail'. */
  for (const [distFlat, expected] of [[5, 'buffet'], [11.5, 'buffet'], [12.5, 'breath'], [20, 'breath'], [40, 'charge'], [58, 'charge']]) {
    const mgr = fakeMgr();
    const e = readyAll(boss());
    bossBrain(mgr, e, info(distFlat));
    assert.deepEqual(mgr.calls.acts.map((a) => a.id), [expected],
      `at ${distFlat} m it chose ${mgr.calls.acts.map((a) => a.id)}`);
  }
});

test('a cooling ability is skipped and the next one down takes the slot', () => {
  const mgr = fakeMgr();
  const e = readyAll(boss());
  e.abilityCd.buffet = 3;                          // the 0-12 m first choice is down
  bossBrain(mgr, e, info(10));
  /* tail is next and the player is inside 6 m of... no: at 10 m and dead ahead
   * the tail gate rejects, so the 8-30 m breath takes it. */
  assert.deepEqual(mgr.calls.acts.map((a) => a.id), ['breath']);

  const mgr2 = fakeMgr();
  const e2 = readyAll(boss());
  e2.abilityCd.buffet = 3;
  e2.abilityCd.breath = 3;
  bossBrain(mgr2, e2, info(10));
  assert.deepEqual(mgr2.calls.acts.map((a) => a.id), ['bite'], 'and the filler bite is the fallback');
});

test('the tail sweep is only used on a player who is not in front of it', () => {
  /* src/creatures/bossfight.js:159-163. `toX/toZ` point at the player; the gate
   * compares them against the dragon's forward. Behind or beside it, the tail
   * is the right answer and it also picks a sweep side. */
  const mgr = fakeMgr();
  const e = readyAll(boss());
  e.abilityCd.buffet = 9;                          // clear the higher priority
  // player directly behind: forward is (0,-1), so to = (0,+1)
  bossBrain(mgr, e, info(10, { toX: 0, toZ: 1, pp: new THREE.Vector3(0, 0, 10) }));
  assert.deepEqual(mgr.calls.acts.map((a) => a.id), ['tail']);
  assert.ok(e.sweepSide === 1 || e.sweepSide === -1, 'and the sweep has a side');
});

test('breath needs line of sight and its own cooldown, not just the ability cooldown', () => {
  /* The breath is gated twice: `abilityCd.breath` paces the ability, and
   * `breathCd` — set when the previous jet ended (src/creatures/bossfight.js:65)
   * — stops back-to-back jets. Both have to be clear, and there has to be a
   * clear line, or the dragon roasts a facade. */
  const blind = fakeMgr({ los: () => false });
  const e1 = readyAll(boss());
  e1.abilityCd.buffet = 9;
  e1.abilityCd.tail = 9;
  e1.abilityCd.charge = 9;
  bossBrain(blind, e1, info(20));
  assert.equal(blind.calls.acts.length, 0, 'nothing in range with no line of sight');
  assert.equal(blind.calls.roars, 0);

  /* At 10 m, with buffet down and the tail rejected for being face-on, breath
   * would be the pick — but a jet that is still cooling falls through to the
   * filler bite instead of firing early. */
  const seeing = fakeMgr();
  const e2 = readyAll(boss());
  e2.abilityCd.buffet = 9;
  e2.breathCd = 2;                                 // the jet itself is still cooling
  bossBrain(seeing, e2, info(10));
  assert.deepEqual(seeing.calls.acts.map((a) => a.id), ['bite'],
    'a hot breath falls through to the next option in range');

  const ready = fakeMgr();
  const e3 = readyAll(boss());
  e3.abilityCd.buffet = 9;
  bossBrain(ready, e3, info(20));
  assert.deepEqual(ready.calls.acts.map((a) => a.id), ['breath']);
  assert.equal(ready.calls.roars, 1, 'and the roar goes up as the jet starts');
});

test('a committing ability books the vulnerable window, a filler does not', () => {
  /* The `exhausts` column of GROUND_ABILITIES. Buffet, breath and charge each
   * hand the player an opening; tail, bite and fan do not. This is the fight's
   * entire risk/reward loop, so which is which is worth pinning. */
  const expectations = [
    ['buffet', 5, true], ['breath', 20, true], ['charge', 40, true],
    ['bite', 10, false], ['fan', 20, false],
  ];
  for (const [id, distFlat, exhausts] of expectations) {
    const mgr = fakeMgr();
    const e = readyAll(boss());
    for (const other of ABILITIES) if (other !== id) e.abilityCd[other] = 30;
    bossBrain(mgr, e, info(distFlat));
    assert.deepEqual(mgr.calls.acts.map((a) => a.id), [id], `${id} was not the one chosen`);
    const act = mgr.calls.acts[0].act;
    assert.equal(act.after, exhausts ? 'exhausted' : 'ground', `${id}.after`);
    if (exhausts) {
      assert.ok(act.exhaust > 0, `${id} books no vulnerable time`);
      /* Phase 2 shortens the window — 1.5 s instead of 2.3 — which is most of
       * what makes the second half of the fight harder. */
      const mgr2 = fakeMgr();
      const e2 = readyAll(boss({ phase2: true, hp: 100 }));
      for (const other of ABILITIES) if (other !== id) e2.abilityCd[other] = 30;
      bossBrain(mgr2, e2, info(distFlat));
      const enraged = mgr2.calls.acts.find((a) => a.id === id);
      assert.ok(enraged && enraged.act.exhaust < act.exhaust,
        `${id} gives the same opening in phase 2 as in phase 1`);
    } else {
      assert.equal(act.exhaust, undefined);
    }
  }
});

test('a charge locks its line into the act so it can be sidestepped', () => {
  const mgr = fakeMgr();
  const e = readyAll(boss());
  for (const other of ABILITIES) if (other !== 'charge') e.abilityCd[other] = 30;
  bossBrain(mgr, e, info(40, { toX: 0.6, toZ: -0.8 }));

  const act = mgr.calls.acts[0].act;
  assert.equal(act.id, 'charge');
  assert.ok(Math.abs(act.chargeX - 0.6) < 1e-12 && Math.abs(act.chargeZ + 0.8) < 1e-12,
    'the run direction is captured on the act, not re-read from the player every frame');
});

test('two attacks cannot be chained back to back', () => {
  /* `if (e.stateT < 0.55) return` (src/creatures/bossfight.js:151). The
   * recovery of one act plus half a second of stalking is the player's window
   * to actually do something; without it the dragon would attack on the frame
   * it returned to the ground state. */
  const mgr = fakeMgr();
  const e = readyAll(boss({ stateT: 0 }));
  for (let t = 0; t < 0.55 - DT; t += DT) {
    e.stateT = t;
    bossBrain(mgr, e, info(10));
  }
  assert.equal(mgr.calls.acts.length, 0, `attacked ${mgr.calls.acts.length} times inside the gap`);

  e.stateT = 0.56;
  bossBrain(mgr, e, info(10));
  assert.equal(mgr.calls.acts.length, 1, 'and then it goes');
});

/* ================================================================== */
/* take-off, airborne, landing                                         */
/* ================================================================== */

test('the airborne timer takes it off the ground and books the landing', () => {
  const mgr = fakeMgr();
  const e = readyAll(boss({ airCd: 0 }));
  bossBrain(mgr, e, info(10));

  /* Take-off outranks every ability: `ground()` returns straight after
   * (src/creatures/bossfight.js:122-131). A dragon that fired off a buffet on
   * the same frame it left the ground would land the hit from mid-air. */
  assert.deepEqual(mgr.calls.acts.map((a) => a.id), ['takeoff']);
  assert.equal(e.state, 'attack', 'startAct owns the state while the act runs');
  assert.equal(mgr.calls.acts[0].act.after, 'airborne', 'and it resumes airborne');
  assert.equal(mgr.calls.acts[0].extra.takeoff, true);
  assert.equal(e.flying, true);
  assert.ok(e.airCd >= 22, `the next take-off is ${e.airCd} s out — should be 22-28`);
  assert.ok(e.airCd <= 28);
  assert.equal(e.flyTarget.y, 14, 'cruise altitude is 14 m over the ground in phase 1');

  const enraged = fakeMgr();
  const e2 = readyAll(boss({ airCd: 0, phase2: true, hp: 100 }));
  bossBrain(enraged, e2, info(10));
  assert.equal(e2.flyTarget.y, 17, 'and 17 m once it is enraged');
  assert.ok(e2.airCd >= 15 && e2.airCd <= 21, 'with a tighter turnaround');
});

test('a long chase with the player out of reach also lifts it off', () => {
  /* The second take-off trigger: 46 m of separation for 3 s
   * (src/creatures/bossfight.js:122). Without it a player who simply ran away
   * could stall the fight indefinitely. */
  const mgr = fakeMgr();
  const e = readyAll(boss({ airCd: 12, stateT: 4 }));
  bossBrain(mgr, e, info(50));
  assert.deepEqual(mgr.calls.acts.map((a) => a.id), ['takeoff']);

  const patient = fakeMgr();
  const e2 = readyAll(boss({ airCd: 12, stateT: 1 }));
  bossBrain(patient, e2, info(50));
  assert.equal(patient.calls.acts.some((a) => a.id === 'takeoff'), false,
    'one second of distance is not enough');
});

test('an airborne dragon keeps orbiting while it attacks', () => {
  /* src/creatures/bossfight.js:76 — the early return that stops it hovering
   * like a piñata over the player's head. With an act running and `flying` set,
   * the brain must produce steering and start nothing new. */
  const mgr = fakeMgr();
  const e = readyAll(boss({ state: 'attack', flying: true }));
  e.act = { id: 'fan', ...DRAGON.acts.fan, t: 0.1 };
  bossBrain(mgr, e, info(30));

  assert.equal(mgr.calls.acts.length, 0, 'no new act');
  assert.ok(Math.hypot(e.moveX, e.moveZ) > 0.1, 'but it is still flying somewhere');
  assert.ok(e.moveSpeed > e.speed, 'and at cruise, not a stroll');
  assert.equal(e.flyTarget.y, 14, 'holding cruise altitude');
});

test('the airborne phase comes down hard, but only once its act has finished', () => {
  const mgr = fakeMgr();
  const e = readyAll(boss({ state: 'airborne', flying: true, airT: 20 }));
  /* Both airborne attacks parked, so the only thing left for the phase to do is
   * land — otherwise it would quite correctly open with a strafing fan run. */
  e.abilityCd.fan = 30;
  e.breathCd = 30;
  e.act = { id: 'fan', ...DRAGON.acts.fan, t: 0.1 };

  /* `done && !e.act` (src/creatures/bossfight.js:216). Landing out from under a
   * running attack would cut its animation and its damage window in half. */
  for (let i = 0; i < 60; i++) bossBrain(mgr, e, info(20));
  assert.equal(mgr.calls.acts.length, 0, 'it did not land on top of its own attack');
  assert.equal(e.state, 'airborne');

  e.act = null;
  bossBrain(mgr, e, info(20));
  const landing = mgr.calls.acts.find((a) => a.id === 'land');
  assert.ok(landing, 'and then it comes down');
  assert.equal(landing.extra.after, 'exhausted', 'the landing is itself an opening');
  assert.equal(landing.extra.slam, true);
  assert.ok(landing.extra.exhaust > 0);
  assert.equal(e.flying, false);
});

test('the entrance walks the fly target down to the ground and then lands', () => {
  const mgr = fakeMgr();
  const e = boss({ state: 'entrance', stateT: 0, pos: new THREE.Vector3(0, 24, 0) });
  bossBrain(mgr, e, info(30));
  assert.equal(e.flying, true);
  assert.equal(e.flyTarget.y, 24, 'the descent starts at 24 m above the ground');

  e.stateT = 1;
  bossBrain(mgr, e, info(30));
  assert.equal(e.flyTarget.y, 12, 'and walks down 12 m a second');

  e.stateT = 2.5;
  bossBrain(mgr, e, info(30));
  assert.equal(e.flyTarget.y, 0, 'clamped at the ground, never below it');

  /* Two ways out: close enough to the ground, or a 4.5 s timeout so a dragon
   * that cannot get down never strands the fight. */
  const near = fakeMgr();
  const low = boss({ state: 'entrance', stateT: 1, pos: new THREE.Vector3(0, 2, 0) });
  bossBrain(near, low, info(30));
  const land = near.calls.acts.find((a) => a.id === 'land');
  assert.ok(land, 'it lands once it is low enough');
  assert.equal(land.extra.after, 'exhausted', 'and the arrival is an opening too');
  assert.equal(low.flying, false);

  const stuck = fakeMgr();
  const high = boss({ state: 'entrance', stateT: 5, pos: new THREE.Vector3(0, 200, 0) });
  bossBrain(stuck, high, info(30));
  assert.ok(stuck.calls.acts.some((a) => a.id === 'land'), 'and the timeout is a backstop');
});

/* ================================================================== */
/* the vulnerable window                                               */
/* ================================================================== */

test('the exhausted window is vulnerable, immobile, and ends on its own timer', () => {
  const mgr = fakeMgr();
  const e = boss({ state: 'exhausted', moveX: 1, moveZ: 1 });
  /* Four and a half frames, so the closing frame is unambiguous rather than
   * landing exactly on zero and depending on how 5/60 rounds. */
  e.exhaustT = 4.5 * DT;

  for (let i = 0; i < 4; i++) {
    bossBrain(mgr, e, info(10));
    assert.equal(e.vulnerable, 1, `frame ${i}: the window closed early`);
    assert.equal(e.state, 'exhausted');
    assert.equal(e.moveX, 0, 'and it does not walk while it is winded');
    assert.equal(e.moveZ, 0);
    assert.equal(e.flying, false);
  }

  bossBrain(mgr, e, info(10));
  assert.equal(e.vulnerable, 0, 'the window closes when the timer runs out');
  assert.equal(e.state, 'ground', 'and it stands back up into the ground phase');
  assert.equal(e.stateT, 0, 'with the 0.55 s no-chain gate reset');
  assert.equal(mgr.calls.acts.length, 0, 'and it did not attack out of the window');
});

/* ================================================================== */
/* never a second act inside the first                                 */
/* ================================================================== */

test('bossBrain starts no new act while one is running on the ground', () => {
  /* The manager keeps `e.state === 'attack'` for the whole of an act
   * (src/enemies.js:476, cleared at :511-521), and 'attack' is not a case in
   * bossBrain's switch — so the brain is structurally incapable of interrupting
   * itself. This drives four seconds of frames with every cooldown clear and
   * every range satisfied, which is the state that would expose a leak. */
  const mgr = fakeMgr();
  const e = readyAll(boss({ state: 'attack', stateT: 0 }));
  e.act = { id: 'bite', ...DRAGON.acts.bite, t: 0 };

  for (let i = 0; i < 240; i++) {
    e.stateT += DT;
    e.act.t += DT;
    bossBrain(mgr, e, info(10));
  }
  assert.equal(mgr.calls.acts.length, 0, `started ${mgr.calls.acts.length} acts mid-act`);
  assert.equal(e.act.id, 'bite', 'and the original act is untouched');
});

test('the only act that may interrupt another is the phase change', () => {
  /* The documented exception (src/creatures/bossfight.js:44-59): crossing half
   * health is a scripted beat that fires wherever the dragon happens to be, and
   * it deliberately replaces whatever was running. Pinned so the exception
   * stays the single one. */
  const mgr = fakeMgr();
  const e = readyAll(boss({ state: 'attack', hp: ENEMY_TYPES.boss.hp * 0.5 - 1 }));
  e.act = { id: 'charge', ...DRAGON.acts.charge, t: 0.4 };

  bossBrain(mgr, e, info(10));
  assert.deepEqual(mgr.calls.acts.map((a) => a.id), ['phase'], 'the phase act cuts in');
  assert.equal(e.act.id, 'phase');

  /* And once it has fired, the boss is back to being uninterruptible. */
  for (let i = 0; i < 120; i++) {
    e.act.t += DT;
    bossBrain(mgr, e, info(10));
  }
  assert.equal(mgr.calls.acts.length, 1, 'no further interruptions');
});

/* ================================================================== */
/* telegraph before damage                                             */
/* ================================================================== */

/**
 * Run one act across its whole timeline, exactly the way `_tickAct` does
 * (src/enemies.js:480-522): advance the clock, derive the beat, hand it to
 * `bossActTick` every frame, and call `bossActCommit` on the first frame at or
 * past the anticipation. Returns every hit with the act time it landed at.
 */
function playAct(mgr, e, id, { extra = null, infoFor = () => info(4) } = {}) {
  const act = mgr.startAct(e, id, extra);
  assert.ok(act, `${id} is not a dragon act`);
  const total = actLength(act);
  for (let n = 0; act.t < total; n++) {
    act.t += DT;
    const bt = beat(act);
    const i = infoFor(bt, n, act);
    bossActTick(mgr, e, i, act, bt);
    if (!act.fired && act.t >= act.ant) {
      act.fired = true;
      bossActCommit(mgr, e, i, act);
    }
    assert.ok(n < 10000, 'runaway act');
  }
  return { act, hits: mgr.calls.hits };
}

test('every damaging dragon act telegraphs first — no hit lands during anticipation', () => {
  /* The readability contract for the whole fight. Each act gets a wind-up long
   * enough to see and act on; the earliest possible damage is the frame the
   * commit beat opens. The dragon is put right on top of the player and facing
   * him, so nothing is spared by range or arc — if a hit can land early, it
   * will here. */
  for (const id of ['bite', 'tail', 'buffet', 'charge', 'land', 'fan', 'breath', 'phase']) {
    const mgr = fakeMgr();
    const e = boss({ facing: Math.PI });            // forward = (0, +1)
    const extra = id === 'charge' ? { chargeX: 0, chargeZ: 1 } : null;
    const at = () => info(3, { toX: 0, toZ: 1, pp: new THREE.Vector3(0, 0, 3), pc: new THREE.Vector3(0, 1, 3) });

    const spec = DRAGON.acts[id];
    assert.ok(spec.ant > 0, `${id} has no anticipation`);
    const { hits } = playAct(mgr, e, id, { extra, infoFor: at });

    for (const hit of hits) {
      assert.ok(hit.t >= spec.ant - 1e-9,
        `${id} hit at t=${hit.t}, inside its ${spec.ant} s wind-up`);
    }
    /* And the wind-up is long enough to be a real tell: nothing in the fight
     * commits in under a third of a second. */
    assert.ok(spec.ant >= 0.34, `${id} winds up in only ${spec.ant} s`);
  }
});

test('a charge locks its line late, then hits once and only once', () => {
  /* src/creatures/bossfight.js:355-362: the run direction keeps tracking the
   * player until 72 % through the anticipation and then freezes, so a dodge at
   * the last moment still works. And `act.hit` is a latch, so a 1.6 s charge
   * cannot bill the player every frame it overlaps him. */
  const mgr = fakeMgr();
  const e = boss({ facing: 0 });
  const spec = DRAGON.acts.charge;
  let lockedAt = null;

  const { act, hits } = playAct(mgr, e, 'charge', {
    extra: { chargeX: 0, chargeZ: -1 },
    infoFor: (bt, n, running) => {
      // the player breaks hard left, but only in the last quarter of the wind-up
      const late = bt.phase === 'ant' && bt.k >= 0.72;
      if (late && lockedAt === null) lockedAt = [running.chargeX, running.chargeZ];
      return info(4, late ? { toX: 1, toZ: 0 } : { toX: 0, toZ: -1 });
    },
  });

  assert.deepEqual(lockedAt, [0, -1], 'fixture sanity: the line was set before the lock');
  assert.deepEqual([act.chargeX, act.chargeZ], [0, -1],
    'the line moved after it should have been locked');
  assert.equal(hits.length, 1, `the charge billed the player ${hits.length} times`);
  assert.equal(hits[0].act, 'charge');
  assert.ok(hits[0].t >= spec.ant - 1e-9, 'and not before the commit');
  assert.ok(Math.abs(hits[0].dmg - e.damage * 1.15) < 1e-9,
    'a connecting charge is the hardest single hit in the fight');
  assert.ok(hits[0].knock >= 3, 'and it throws the player');
});

test('a charge that misses hits nobody, however long the run', () => {
  /* The other half of the dodge: the hit test is a live distance check inside
   * the commit (src/creatures/bossfight.js:348), so a player who is not on the
   * line simply is not hit. */
  const mgr = fakeMgr();
  const e = boss({ facing: 0 });
  const { hits } = playAct(mgr, e, 'charge', {
    extra: { chargeX: 0, chargeZ: -1 },
    infoFor: () => info(30),                       // never comes within 6.5 * 1.45 m
  });
  assert.equal(hits.length, 0, 'a dodged charge cost the player health anyway');
});

test('a landing pulls the dragon down during the anticipation, then slams', () => {
  /* src/creatures/bossfight.js:364-371. The fall is the telegraph: the ring of
   * embers and the shadow growing on the cobbles are what tell the player to
   * move, and the damage only arrives once it is down. */
  const mgr = fakeMgr();
  const e = boss({ pos: new THREE.Vector3(0, 14, 0), flying: true });
  const spec = DRAGON.acts.land;
  const heights = [];

  const { hits } = playAct(mgr, e, 'land', {
    infoFor: (bt) => {
      if (bt.phase === 'ant') heights.push(e.pos.y);
      return info(4);
    },
  });

  assert.ok(heights.length > 1, 'the anticipation ran');
  assert.ok(heights[heights.length - 1] < heights[0],
    `it did not descend during the wind-up (${heights[0]} -> ${heights[heights.length - 1]})`);
  assert.equal(hits.length, 1);
  assert.ok(hits[0].t >= spec.ant - 1e-9, 'the slam lands after the fall, not during it');
  assert.ok(Math.abs(hits[0].dmg - e.damage * 0.8) < 1e-9);
});

test('a take-off puts the dragon in the air only after its anticipation', () => {
  /* `act.id === 'takeoff' && bt.phase !== 'ant'` — the crouch reads as a crouch
   * because it happens on the ground (src/creatures/bossfight.js:372-374). */
  const mgr = fakeMgr();
  const e = boss({ flying: false });
  const seen = [];
  playAct(mgr, e, 'takeoff', {
    infoFor: (bt) => { seen.push([bt.phase, e.flying]); return info(6); },
  });

  const duringAnt = seen.filter(([phase]) => phase === 'ant');
  assert.ok(duringAnt.length > 1, 'the wind-up ran');
  for (const [, flying] of duringAnt) assert.equal(flying, false, 'it left the ground too early');
  assert.equal(e.flying, true, 'and it is airborne by the end');
});

test('the breath commit arms the jet rather than dealing instant damage', () => {
  /* The flame is a sustained cone ticked by `bossBreathTick` while `e.breath`
   * runs down (src/enemies.js:619), not a hit on the commit frame. The commit
   * only sets the fuse. */
  const mgr = fakeMgr();
  const e = boss();
  const { hits } = playAct(mgr, e, 'breath', { infoFor: () => info(12) });
  assert.equal(hits.length, 0, 'the commit itself hurts nobody');
  assert.ok(e.breath > 0, 'but the jet is lit');

  /* And the brain then ticks it and re-arms the cooldown once it burns out. */
  e.act = null;
  e.state = 'ground';
  let ticks = 0;
  for (let i = 0; i < 200 && e.breath > 0; i++) {
    bossBrain(mgr, e, info(12));
    ticks++;
  }
  assert.ok(ticks > 1, 'the jet was ticked while it burned');
  assert.equal(mgr.calls.breath, ticks, 'once per frame, no more');
  assert.ok(e.breathCd > 0, 'and the jet cooldown is re-armed as it dies');
});

test('the fan commit fires a volley of projectiles and no melee damage', () => {
  const mgr = fakeMgr();
  const e = boss();
  const { hits } = playAct(mgr, e, 'fan', { infoFor: () => info(30) });
  assert.equal(mgr.calls.ranged, 1, 'exactly one volley per fan');
  assert.equal(hits.length, 0, 'and nothing at melee range');
});
