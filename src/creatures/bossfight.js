import { clamp, clamp01, damp } from './kit.js';
import { ring, impactDust, shards } from './fx.js';

/* ==================================================================
   The Drak brněnský fight, choreographed.

   Ground phase and airborne phase, six telegraphed abilities, and — the
   thing that turns a damage race into a fight — a vulnerable window after
   every big commitment. Breath, wing buffet, charge and every landing all
   dump the dragon into 'exhausted': head down at chest height, furnace
   guttering, taking 80 % extra damage. Learn the tells, punish the pause.

   onBossRoar fires the moment a breath begins (exactly where it did
   before: the flame cone is still driven by e.breath / e.breathCd).
   onBossPhase fires the instant health crosses half, as before.
   ================================================================== */

/* Priority order matters: the first ability whose range fits and whose
 * cooldown is up gets used, so the big committed moves sit above the filler
 * bite and the long-range fan sits below the charge. */
const GROUND_ABILITIES = [
  // id,      min,  max,  cooldown, exhausts
  ['buffet', 0, 12, 9.0, true],
  ['tail', 0, 13, 5.5, false],
  ['breath', 8, 30, 7.0, true],
  ['bite', 0, 11, 2.6, false],
  ['charge', 16, 60, 11.0, true],
  ['fan', 12, 60, 3.2, false],
];

export function initBoss(e) {
  e.abilityCd = {};
  for (const [id, , , cd] of GROUND_ABILITIES) e.abilityCd[id] = cd * 0.35;
  e.airCd = 20;
  e.airT = 0;
  e.exhaustT = 0;
  e.vulnerable = 0;
  e.entranceH = 0;
}

export function bossBrain(mgr, e, info) {
  const dt = info.dt;

  /* --- phase 2 at half health: same trigger moment as before -------- */
  if (!e.phase2 && e.hp < e.maxHp * 0.5 && e.state !== 'dead') {
    e.phase2 = true;
    e.speed *= 1.25;
    e.type = { ...e.type, attackCd: e.type.attackCd * 0.7 };
    mgr.vfx && mgr.vfx.explosion(mgr.scratch.copy(e.pos).setY(e.pos.y + 4), 12, 0xff3a1a);
    mgr.onBossPhase && mgr.onBossPhase(e);
    // and make it a visible event, not just a number: it rears, roars,
    // throws its wings wide and slams the square
    if (e.state !== 'dead') {
      mgr.startAct(e, 'phase', { after: 'ground' });
      e.state = 'attack';
      e.exhaustT = 0;
      e.flying = false;
    }
  }

  /* --- the fire breath cone: verbatim behaviour ---------------------- */
  e.breathCd = (e.breathCd ?? 6) - dt;
  if (e.breath > 0) {
    mgr.bossBreathTick(e, dt, info);
    if (e.breath <= 0) e.breathCd = e.phase2 ? 4.5 : 7;
  }

  for (const id of Object.keys(e.abilityCd)) e.abilityCd[id] -= dt;
  // the airborne timer runs all the time, not only while it is stalking,
  // or a long ground fight would never get off the floor
  if (e.state !== 'entrance') e.airCd -= dt;
  e.moveSpeed = e.speed;

  // an airborne dragon keeps flying while it attacks — otherwise it hovers
  // like a piñata over the player's head
  if (e.state === 'attack' && e.flying) return orbit(mgr, e, info);

  switch (e.state) {
    case 'entrance': return entrance(mgr, e, info);
    case 'ground': return ground(mgr, e, info);
    case 'airborne': return airborne(mgr, e, info);
    case 'exhausted': return exhausted(mgr, e, info);
    default: return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* the landing entrance                                                */
/* ------------------------------------------------------------------ */
function entrance(mgr, e, info) {
  const dt = info.dt;
  e.flying = true;
  e.soar = 1;
  e.climb = -0.6;
  const gy = mgr.groundAt(e);
  // the manager flies it to flyTarget.y; walk that target down to the ground
  e.flyTarget.set(e.pos.x, gy + Math.max(0, 24 - e.stateT * 12), e.pos.z);
  // drift in over the player while it comes down
  const want = Math.max(9, info.distFlat - 14);
  e.moveX = info.distFlat > want ? info.toX : 0;
  e.moveZ = info.distFlat > want ? info.toZ : 0;
  e.moveSpeed = e.speed * 1.4;
  if (mgr.vfx && mgr.vfxRng.chance(0.4)) {
    ring(mgr.vfx, mgr.vfxRng, e.pos.x, gy, e.pos.z, 6 * e.scale, 0xffa050, 6,
      { size: 0.35, life: 0.5, up: 0.6, inward: true, speed: 2 });
  }
  if (e.pos.y < gy + 3.4 || e.stateT > 4.5) {
    mgr.startAct(e, 'land', { after: 'exhausted', exhaust: 1.1 });
    e.flying = false;
  }
}

/* ------------------------------------------------------------------ */
/* ground phase                                                        */
/* ------------------------------------------------------------------ */
function ground(mgr, e, info) {
  const dt = info.dt;
  e.flying = false;

  // take off when the player has been out of reach for a while, or on a
  // timer that tightens in phase 2
  if (e.airCd <= 0 || (info.distFlat > 46 && e.stateT > 3)) {
    e.state = 'airborne';
    e.stateT = 0;
    e.airT = 0;
    e.flying = true;
    e.airCd = (e.phase2 ? 15 : 22) + mgr.rng.float(0, 6);
    e.flyTarget.set(e.pos.x, mgr.groundAt(e) + (e.phase2 ? 17 : 14), e.pos.z);
    mgr.startAct(e, 'takeoff', { after: 'airborne', takeoff: true });
    return;
  }

  /* stalk: close to just outside bite range, circling slightly */
  const want = 8.5;
  if (info.distFlat > want + 2) {
    e.moveX = info.toX;
    e.moveZ = info.toZ;
    e.moveSpeed = e.speed * (info.distFlat > 24 ? 1 : 0.8);
  } else if (info.distFlat < want - 3) {
    e.moveX = -info.toX * 0.6 - info.toZ * e.strafe * 0.6;
    e.moveZ = -info.toZ * 0.6 + info.toX * e.strafe * 0.6;
    e.moveSpeed = e.speed * 0.5;
  } else {
    e.moveX = -info.toZ * e.strafe;
    e.moveZ = info.toX * e.strafe;
    e.moveSpeed = e.speed * 0.45;
    if (mgr.rng.chance(dt * 0.35)) e.strafe *= -1;
  }

  /* pick an ability — nearest-appropriate first, cooldown-gated */
  if (e.stateT < 0.55) return;   // never chain two attacks back to back
  for (const [id, min, max, cd, exhausts] of GROUND_ABILITIES) {
    if (e.abilityCd[id] > 0) continue;
    if (info.distFlat < min || info.distFlat > max) continue;
    if (id === 'breath') {
      if (e.breathCd > 0 || !mgr.los(e, info, 34)) continue;
    }
    if (id === 'fan' && !mgr.los(e, info, 60)) continue;
    if (id === 'tail') {
      // the tail sweep only makes sense if he is beside or behind it
      const face = -info.toX * Math.sin(e.facing) - info.toZ * Math.cos(e.facing);
      if (face > 0.45 && info.distFlat > 6) continue;
      e.sweepSide = (info.toX * -Math.cos(e.facing) - info.toZ * -Math.sin(e.facing)) > 0 ? 1 : -1;
    }
    const spec = { after: exhausts ? 'exhausted' : 'ground' };
    if (exhausts) spec.exhaust = (e.phase2 ? 1.5 : 2.3) * (id === 'charge' ? 1.15 : 1);
    if (id === 'charge') {
      spec.chargeX = info.toX;
      spec.chargeZ = info.toZ;
    }
    mgr.startAct(e, id, spec);
    e.abilityCd[id] = cd * (e.phase2 ? 0.68 : 1) * mgr.rng.float(0.9, 1.2);
    if (id === 'breath') mgr.onBossRoar && mgr.onBossRoar(e);
    return;
  }
}

/* ------------------------------------------------------------------ */
/* airborne phase                                                      */
/* ------------------------------------------------------------------ */
/** Wide banking orbit at cruise altitude — used both between attacks and
 * during them, so it never stops moving while it is in the air. */
function orbit(mgr, e, info) {
  const dt = info.dt;
  const gy = mgr.groundAt(e);
  const cruise = gy + (e.phase2 ? 17 : 14);
  e.flyTarget.set(e.pos.x, cruise, e.pos.z);
  e.climb = clamp((cruise - e.pos.y) * 0.3, -1, 1);
  e.soar = damp(e.soar ?? 0, info.distFlat > 26 ? 0.85 : 0.2, 1.5, dt);
  const want = 24;
  const radial = clamp((info.distFlat - want) * 0.14, -1, 1);
  e.moveX = info.toX * radial - info.toZ * e.strafe * 0.9;
  e.moveZ = info.toZ * radial + info.toX * e.strafe * 0.9;
  e.moveSpeed = e.speed * 1.35;
  if (mgr.rng.chance(dt * 0.25)) e.strafe *= -1;
}

function airborne(mgr, e, info) {
  const dt = info.dt;
  e.flying = true;
  e.airT += dt;
  orbit(mgr, e, info);

  if (!e.act) {
    if (e.abilityCd.fan <= 0 && mgr.los(e, info, 70)) {
      mgr.startAct(e, 'fan', { after: 'airborne' });
      e.abilityCd.fan = (e.phase2 ? 2.4 : 3.4) * mgr.rng.float(0.9, 1.2);
    } else if (e.airT > 5 && e.breathCd <= 0 && info.distFlat < 26 && mgr.los(e, info, 34)) {
      // a strafing breath run from above
      mgr.startAct(e, 'breath', { after: 'airborne' });
      mgr.onBossRoar && mgr.onBossRoar(e);
    }
  }

  const done = e.airT > (e.phase2 ? 13 : 10);
  if (done && !e.act) {
    // come down hard — the landing is itself an attack and an opening
    e.state = 'attack';
    mgr.startAct(e, 'land', { after: 'exhausted', exhaust: e.phase2 ? 1.2 : 1.8, slam: true });
    e.flying = false;
  }
}

/* ------------------------------------------------------------------ */
/* the vulnerable window                                               */
/* ------------------------------------------------------------------ */
function exhausted(mgr, e, info) {
  const dt = info.dt;
  e.flying = false;
  e.moveX = 0;
  e.moveZ = 0;
  e.vulnerable = 1;
  e.exhaustT -= dt;
  if (mgr.vfx && mgr.vfxRng.chance(0.25)) {
    // smoke curling out of the maw
    const h = e.pos.y + 4.2 * e.scale;
    mgr.vfx.burst(mgr.scratch.set(
      e.pos.x - Math.sin(e.facing) * 3.4 * e.scale, h,
      e.pos.z - Math.cos(e.facing) * 3.4 * e.scale,
    ), 0x50423a, 3, 1.1, { size: 0.5, life: 1.3, up: 1.2, drag: 1.6 });
  }
  if (e.exhaustT <= 0) {
    e.vulnerable = 0;
    e.state = 'ground';
    e.stateT = 0;
  }
}

/* ------------------------------------------------------------------ */
/* per-act effects, called by the manager                              */
/* ------------------------------------------------------------------ */
export function bossActCommit(mgr, e, info, act) {
  const vfx = mgr.vfx;
  const rng = mgr.vfxRng;
  const scale = e.scale;
  const fwdX = -Math.sin(e.facing);
  const fwdZ = -Math.cos(e.facing);

  switch (act.id) {
    case 'bite': {
      const reach = 9 * scale;
      if (info.distFlat < reach && Math.abs(info.pp.y - e.pos.y) < 6) {
        const dot = info.toX * fwdX + info.toZ * fwdZ;
        if (dot > 0.55) mgr.hitPlayer(e, e.damage, info.toX, info.toZ);
      }
      break;
    }
    case 'tail': {
      const reach = 12 * scale;
      if (info.distFlat < reach) {
        mgr.hitPlayer(e, e.damage * 0.85, info.toX, info.toZ, 1.6);
      }
      if (vfx) {
        const base = e.facing + Math.PI;
        for (let i = 0; i < 3; i++) {
          const a = base + e.sweepSide * (0.5 + i * 0.55);
          impactDust(vfx, rng, e.pos.x + Math.sin(a) * reach * 0.7, e.pos.y,
            e.pos.z + Math.cos(a) * reach * 0.7, 1.4);
        }
      }
      break;
    }
    case 'buffet': {
      const reach = 11 * scale;
      if (info.distFlat < reach) {
        mgr.hitPlayer(e, e.damage * 0.7, info.toX, info.toZ, 2.4);
      }
      if (vfx) {
        ring(vfx, rng, e.pos.x, e.pos.y, e.pos.z, reach * 0.8, 0xffc080, 26,
          { size: 0.5, life: 0.7, up: 2.5, speed: 9 });
        impactDust(vfx, rng, e.pos.x, e.pos.y, e.pos.z, 2.2);
      }
      break;
    }
    case 'takeoff': {
        if (vfx) {
          impactDust(vfx, rng, e.pos.x, e.pos.y, e.pos.z, 2.6);
          ring(vfx, rng, e.pos.x, e.pos.y, e.pos.z, 7 * scale, 0xffb070, 18, { size: 0.5, life: 0.8, up: 4 });
        }
      break;
    }
    case 'land': {
      if (vfx) {
        vfx.explosion(mgr.scratch.copy(e.pos).setY(e.pos.y + 1.2), 8 * scale, 0xffa050);
        impactDust(vfx, rng, e.pos.x, e.pos.y, e.pos.z, 3);
        ring(vfx, rng, e.pos.x, e.pos.y, e.pos.z, 8 * scale, 0xffc080, 24, { size: 0.6, life: 0.9, up: 3, speed: 10 });
      }
      if (info.distFlat < 12 * scale) {
        mgr.hitPlayer(e, e.damage * 0.8, info.toX, info.toZ, 2);
      }
      break;
    }
    case 'charge': {
      // the commit is handled per-frame in bossActTick; nothing on entry
      break;
    }
    case 'breath': {
      e.breath = 1.9;
      break;
    }
    case 'fan': {
      mgr.rangedAttack(e, info.player);
      break;
    }
    case 'phase': {
      if (vfx) {
        vfx.explosion(mgr.scratch.copy(e.pos).setY(e.pos.y + 3), 16, 0xff5a1a);
        ring(vfx, rng, e.pos.x, e.pos.y, e.pos.z, 12 * scale, 0xff6a20, 34,
          { size: 0.7, life: 1.2, up: 5, speed: 14 });
        shards(vfx, rng, e.pos.x, e.pos.y + 0.4, e.pos.z, 26, 0x8a7a5c, 11);
      }
      if (info.distFlat < 14) mgr.hitPlayer(e, e.damage * 0.5, info.toX, info.toZ, 1.8);
      break;
    }
    default: break;
  }
}

/** Per-frame work inside an act (the charge run, breath aim, telegraphs). */
export function bossActTick(mgr, e, info, act, bt) {
  if (act.id === 'charge') {
    if (bt.phase === 'com') {
      e.moveX = act.chargeX;
      e.moveZ = act.chargeZ;
      e.moveSpeed = e.speed * 2.6;
      e.faceX = act.chargeX;
      e.faceZ = act.chargeZ;
      if (!act.hit && info.distFlat < 6.5 * e.scale) {
        act.hit = true;
        mgr.hitPlayer(e, e.damage * 1.15, act.chargeX, act.chargeZ, 3);
      }
      if (mgr.vfx && mgr.vfxRng.chance(0.6)) {
        impactDust(mgr.vfx, mgr.vfxRng, e.pos.x, e.pos.y, e.pos.z, 1.3);
      }
    } else if (bt.phase === 'ant') {
      // lock the line late so a dodge at the last moment still works
      if (bt.k < 0.72) {
        act.chargeX = info.toX;
        act.chargeZ = info.toZ;
      }
      e.moveX = 0;
      e.moveZ = 0;
    }
  } else if (act.id === 'land' && bt.phase === 'ant') {
    // fall out of the sky during the anticipation
    const gy = mgr.groundAt(e);
    e.pos.y = damp(e.pos.y, gy, 9, info.dt);
    if (mgr.vfx && mgr.vfxRng.chance(0.7)) {
      ring(mgr.vfx, mgr.vfxRng, e.pos.x, gy, e.pos.z, 8 * e.scale, 0xffa050, 8,
        { size: 0.4, life: 0.4, up: 0.5, inward: true, speed: 3 });
    }
  } else if (act.id === 'takeoff' && bt.phase !== 'ant') {
    e.flying = true;
  }
}

export { clamp01 };
