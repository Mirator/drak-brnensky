import { clamp, clamp01, damp } from './kit.js';
import { ring, intake, impactDust } from './fx.js';

/* ==================================================================
   Per-archetype AI layers.

   These only ever decide *where the creature wants to go* and *when it
   commits to an action*. The manager still owns steering, the obstacle
   probe, the progress-based stuck recovery and the motion integration —
   the behaviours that were deliberately fixed in earlier passes — so
   nothing here can regress them.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* Ještěrka: pack tactics                                             */
/* ------------------------------------------------------------------ */
/**
 * The pack coordinator. Whelps get slots on a ring around the player,
 * biased to his flanks and back, and only a couple hold the "press" token
 * at a time. One of the near ones plays bait: it dances in and out of
 * reach and throws feints, which is what pulls a dodge out of the player
 * and opens him up to the flankers.
 */
export function updatePack(mgr, dt, info) {
  const pack = mgr.pack;
  pack.t -= dt;
  if (pack.t > 0) return;
  pack.t = 0.32;

  const members = pack.members;
  members.length = 0;
  for (const e of mgr.list) {
    if (e.typeId !== 'whelp' || e.hp <= 0 || e.state === 'dead') continue;
    if (Math.hypot(e.pos.x - info.pp.x, e.pos.z - info.pp.z) > 46) continue;
    members.push(e);
  }
  if (!members.length) return;
  for (const e of members) {
    e.packDist = Math.hypot(e.pos.x - info.pp.x, e.pos.z - info.pp.z);
  }
  // deterministic ordering: distance, then spawn serial
  members.sort((a, b) => (a.packDist - b.packDist) || (a.serial - b.serial));

  // slots fan out behind and to the sides of where the player is looking
  const SLOTS = [2.6, -2.6, 1.5, -1.5, 3.1, 0.7, -0.7, -3.1, 2.0, -2.0, 1.1, -1.1, 2.9, -2.9];
  for (let i = 0; i < members.length; i++) {
    const e = members[i];
    e.packAngle = info.player.facing + SLOTS[i % SLOTS.length];
    e.packRadius = 5.4 + (i % 3) * 1.7;
    e.pressT = (e.pressT ?? 0) + 0.32;
    e.role = 'flank';
  }
  // the bait is the closest one, and only while there is a pack to bait for
  let first = 0;
  if (members.length > 1) {
    members[0].role = 'bait';
    first = 1;
  }
  /* Hand the press token to whoever has waited longest — a presser resets
   * its own timer, so the token rotates on its own and no whelp is ever
   * left circling forever while the same two do all the work. */
  const queue = members.slice(first).sort((a, b) => (b.pressT - a.pressT) || (a.serial - b.serial));
  const pressers = Math.max(1, Math.min(3, Math.ceil(members.length / 3)));
  for (let i = 0; i < queue.length && i < pressers; i++) queue[i].role = 'press';
}

export function whelpBrain(mgr, e, info) {
  const t = e.type;
  const dt = info.dt;
  e.moveSpeed = e.speed;

  if (e.state !== 'chase') return;

  const role = e.role || 'press';
  const closing = role === 'press' || info.distFlat > 24 || mgr.pack.members.length <= 1;

  if (closing) {
    e.moveX = info.toX;
    e.moveZ = info.toZ;
    if (role === 'press') e.pressT = 0;
  } else {
    // steer to the slot, then orbit it so nothing stands still
    const sx = info.pp.x + Math.sin(e.packAngle) * e.packRadius;
    const sz = info.pp.z + Math.cos(e.packAngle) * e.packRadius;
    const dx = sx - e.pos.x;
    const dz = sz - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1.8) {
      e.moveX = dx / d;
      e.moveZ = dz / d;
      e.moveSpeed = e.speed * (role === 'bait' ? 0.85 : 1);
    } else {
      e.moveX = -info.toZ * e.strafe;
      e.moveZ = info.toX * e.strafe;
      e.moveSpeed = e.speed * 0.7;
      if (mgr.rng.chance(dt * 0.5)) e.strafe *= -1;
      /* A flanker circling its slot with eyes on the player is doing its
       * job, not wedged behind a fountain — so it must not feed the
       * progress-based stuck timer, which would teleport it every few
       * seconds. One that never reaches its slot (blocked, no line of
       * sight) still accumulates and still gets relocated. */
      if (mgr.los(e, info, 30)) e.stuckT = 0;
    }
    // a quadruped should look where it is going unless it is closing in
    if (info.distFlat > 5.5) {
      e.faceX = e.moveX;
      e.faceZ = e.moveZ;
    }
  }

  /* commit: the pounce starts well outside its bite reach and closes the
   * gap during the commit beat, so the anticipation is dodgeable */
  e.attackCd -= dt;
  const reach = t.attackRange + 2.6;
  if (e.attackCd <= 0 && info.distFlat < reach && Math.abs(info.pp.y - e.pos.y) < 3.4) {
    if (role === 'bait' && info.distFlat < 6.5 && mgr.rng.chance(0.55)) {
      mgr.startAct(e, 'feint');
      e.attackCd = t.attackCd * mgr.rng.float(0.5, 0.9);
    } else if (role !== 'flank' || info.distFlat < t.attackRange + 1.2) {
      mgr.startAct(e, 'lunge');
      e.attackCd = t.attackCd * mgr.rng.float(0.85, 1.25);
      e.pressT = 0;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Chrlič: height, perches and kiting                                 */
/* ------------------------------------------------------------------ */
export function spitterBrain(mgr, e, info) {
  const t = e.type;
  const dt = info.dt;
  e.moveSpeed = e.speed;
  e.perchScan = (e.perchScan ?? 0) - dt;

  if (e.state === 'perch') {
    e.moveX = 0;
    e.moveZ = 0;
    e.perchT += dt;
    const los = mgr.los(e, info, t.attackRange + 6);
    e.perchBlind = los ? 0 : e.perchBlind + dt;
    // spit from the parapet
    e.attackCd -= dt;
    if (e.attackCd <= 0 && los && info.distFull < t.attackRange + 8) {
      mgr.startAct(e, 'spit');
      e.attackCd = t.attackCd * mgr.rng.float(0.8, 1.15);
    }
    // leave when crowded, bored, or blind — never sit there forever.
    // Crowding is measured in 3D: a player 10 m away and 20 m below is not
    // crowding a gargoyle on a parapet.
    if ((e.perchT > 1.5 && info.distFull < 13) || e.perchT > 11 || e.perchBlind > 2.6) {
      mgr.spitterTakeOff(e, info);
    }
    return;
  }

  if (e.state === 'fly') {
    const target = e.flyTarget;
    const dx = target.x - e.pos.x;
    const dy = target.y - e.pos.y;
    const dz = target.z - e.pos.z;
    const flat = Math.hypot(dx, dz);
    e.moveX = flat > 0.4 ? dx / flat : 0;
    e.moveZ = flat > 0.4 ? dz / flat : 0;
    e.moveSpeed = e.speed * (e.flyMode === 'perch' ? 2.3 : 1.9);
    e.climb = clamp(dy * 0.5, -1, 1);
    e.soar = damp(e.soar ?? 0, flat > 8 && Math.abs(dy) < 3 ? 1 : 0, 2.5, dt);
    // face where it is going while it commutes
    if (flat > 3) { e.faceX = e.moveX; e.faceZ = e.moveZ; }

    if (flat < 1.6 && Math.abs(dy) < 1.2) {
      if (e.flyMode === 'perch') {
        e.state = 'perch';
        e.stateT = 0;
        e.perchT = 0;
        e.perchBlind = 0;
        e.flying = false;
        e.vel.set(0, 0, 0);
        if (mgr.vfx) impactDust(mgr.vfx, mgr.vfxRng, e.pos.x, e.pos.y, e.pos.z, 0.5, 0x8a8074);
      } else {
        mgr.spitterLand(e);
      }
    }
    // strafing shots on the wing
    e.attackCd -= dt;
    if (e.attackCd <= 0 && info.distFull < t.attackRange && mgr.los(e, info, t.attackRange + 6)) {
      mgr.startAct(e, 'spit');
      e.attackCd = t.attackCd * mgr.rng.float(1.0, 1.5);
    }
    // a hovering spitter that cannot find anywhere to be drops back down
    if (e.stateT > 14) mgr.spitterLand(e);
    return;
  }

  if (e.state !== 'chase') return;

  /* ---- grounded kiting: the shape of this is the original tuning ---- */
  const wantRange = t.keepDistance ?? t.attackRange * 0.7;
  if (info.distFlat < wantRange * 0.75) {
    e.moveX = -info.toX;
    e.moveZ = -info.toZ;
    e.moveSpeed = e.speed * 0.85;
  } else if (info.distFlat < wantRange * 1.35) {
    e.moveX = -info.toZ * e.strafe;
    e.moveZ = info.toX * e.strafe;
    e.moveSpeed = e.speed * 0.75;
    if (mgr.rng.chance(dt * 0.4)) e.strafe *= -1;
  } else {
    e.moveX = info.toX;
    e.moveZ = info.toZ;
  }

  /* look for high ground — a gargoyle belongs on a ledge */
  if (e.perchScan <= 0) {
    e.perchScan = 1.7;
    const crowded = info.distFlat < 13;
    const blind = !mgr.los(e, info, t.attackRange + 6);
    if ((crowded || blind || mgr.rng.chance(0.3)) && e.perchCd <= 0) {
      const perch = mgr.findPerch(e, info);
      if (perch) mgr.spitterTakeOff(e, info, perch);
    }
  }
  e.perchCd -= dt;

  /* ground spit — unchanged gates: range, height difference and LOS */
  e.attackCd -= dt;
  if (e.attackCd <= 0 && info.distFull < t.attackRange && Math.abs(info.pp.y - e.pos.y) < 24) {
    if (mgr.los(e, info, t.attackRange + 6)) {
      mgr.startAct(e, 'spit');
      e.attackCd = t.attackCd * mgr.rng.float(0.85, 1.25);
    }
  } else if (info.distFlat < 3.4 && e.attackCd <= 0.4) {
    mgr.startAct(e, 'swipe');
    e.attackCd = t.attackCd * 0.8;
  }
}

/* ------------------------------------------------------------------ */
/* Kamenný golem: shield and advance                                  */
/* ------------------------------------------------------------------ */
export function golemBrain(mgr, e, info) {
  const t = e.type;
  const dt = info.dt;

  e.recentHit = Math.max(0, e.recentHit - dt);
  if (e.state !== 'chase') {
    e.shield = damp(e.shield, 0, 6, dt);
    return;
  }

  /* raise the guard over the core whenever it is being shot at from a
   * distance, and walk through it — slower, but the core is covered */
  const wantShield = e.recentHit > 0 && info.distFlat > 5.5 && (e.brokenPlates ?? 0) < 3;
  e.shield = damp(e.shield, wantShield ? 1 : 0, wantShield ? 7 : 3.5, dt);

  e.moveX = info.toX;
  e.moveZ = info.toZ;
  e.moveSpeed = e.speed * (0.62 + (1 - e.shield) * 0.38);

  e.attackCd -= dt;
  if (e.attackCd <= 0 && info.distFlat < t.attackRange + t.radius * 0.4
    && Math.abs(info.pp.y - e.pos.y) < 3.4) {
    // a player hugging its flank gets the backhand instead of the slam
    const side = 1 - Math.abs(info.toX * -Math.sin(e.facing) + info.toZ * -Math.cos(e.facing));
    if (side > 0.35 || info.distFlat < 2.6) {
      e.sweepSide = (info.toX * -Math.cos(e.facing) - info.toZ * -Math.sin(e.facing)) > 0 ? 1 : -1;
      mgr.startAct(e, 'sweep');
    } else {
      mgr.startAct(e, 'slam');
    }
    e.attackCd = t.attackCd * mgr.rng.float(0.9, 1.3);
  }
}

/* ------------------------------------------------------------------ */
/* telegraph hooks, called by the manager each frame of an action       */
/* ------------------------------------------------------------------ */
export function telegraph(mgr, e, bt, info) {
  const vfx = mgr.vfx;
  if (!vfx) return;
  const rng = mgr.vfxRng;
  const y = e.pos.y;

  if (bt.id === 'slam' && bt.phase === 'ant') {
    // growing ember ring exactly where the fists will land
    if (rng.chance(0.55)) {
      const r = 2.2 + bt.k * 1.6;
      ring(vfx, rng, e.pos.x - Math.sin(e.facing) * 2.2, y, e.pos.z - Math.cos(e.facing) * 2.2,
        r, 0xff8a2a, 5, { size: 0.22, life: 0.35, up: 0.6, speed: 0.4 });
    }
    if (rng.chance(0.5)) {
      intake(vfx, rng, e.pos.x, y + 2.1, e.pos.z, 1.4, 0xff9a3a, 2);
    }
  } else if (bt.id === 'sweep' && bt.phase === 'ant') {
    if (rng.chance(0.4)) {
      intake(vfx, rng, e.pos.x, y + 1.8, e.pos.z, 1.2, 0xffa040, 2);
    }
  } else if (bt.id === 'lunge' && bt.phase === 'ant') {
    // scrabbling claws: dust kicked backwards as it loads the pounce
    if (rng.chance(0.6)) {
      vfxDust(vfx, rng, e, 0.35);
    }
  } else if (bt.id === 'spit' && bt.phase === 'ant') {
    const h = e.pos.y + e.type.height * 0.82;
    if (rng.chance(0.8)) intake(vfx, rng, e.pos.x, h, e.pos.z, 0.9 + bt.k * 0.5, 0xff7a2a, 2);
  } else if ((bt.id === 'breath' || bt.id === 'fan') && bt.phase === 'ant') {
    const h = e.pos.y + 4.7 * e.scale;
    intake(vfx, rng, e.pos.x, h, e.pos.z, 2.2 + bt.k * 1.6, 0xff6a1a, bt.id === 'breath' ? 4 : 2);
  } else if (bt.id === 'buffet' && bt.phase === 'ant') {
    if (rng.chance(0.7)) {
      ring(vfx, rng, e.pos.x, y, e.pos.z, 9 * e.scale * (0.5 + bt.k * 0.5), 0xffb060, 7,
        { size: 0.3, life: 0.4, up: 0.8, inward: true, speed: 2 });
    }
  } else if (bt.id === 'charge' && bt.phase === 'ant') {
    if (rng.chance(0.8)) vfxDust(vfx, rng, e, 1.1 * e.scale);
  } else if (bt.id === 'tail' && bt.phase === 'ant') {
    if (rng.chance(0.5)) {
      const a = e.facing + Math.PI + e.sweepSide * 1.2;
      ring(vfx, rng, e.pos.x + Math.sin(a) * 5 * e.scale, y, e.pos.z + Math.cos(a) * 5 * e.scale,
        1.6, 0xffa050, 5, { size: 0.28, life: 0.35, up: 0.5 });
    }
  } else if (bt.id === 'phase') {
    if (rng.chance(0.9)) {
      ring(vfx, rng, e.pos.x, y, e.pos.z, 4 + bt.t * 6, 0xff4a1a, 10,
        { size: 0.45, life: 0.6, up: 2.4, speed: 3 });
    }
  }
}

function vfxDust(vfx, rng, e, power) {
  const bx = e.pos.x + Math.sin(e.facing) * 0.8;
  const bz = e.pos.z + Math.cos(e.facing) * 0.8;
  impactDust(vfx, rng, bx, e.pos.y + 0.05, bz, power, 0x8a7a58);
}

export const BRAINS = {
  whelp: whelpBrain,
  spitter: spitterBrain,
  golem: golemBrain,
};

export { clamp01 };
