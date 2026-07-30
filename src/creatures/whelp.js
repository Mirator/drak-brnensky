import * as THREE from 'three';
import {
  loft, boneSegment, spike, place, off, ramp, region, glowRegion, paleRegion, boneRegion,
  resetPose, beat, damp, dampAngle, clamp, clamp01, lerp, hump, easeOut, easeIn, smoothstep,
  creatureMaterial,
} from './kit.js';
import { skinSheet, creatureStandard } from './skin.js';

/* ==================================================================
   JEŠTĚRKA — the whelp.

   A real quadruped: digitigrade hind legs with a proper femur/tibia/
   metatarsus zig-zag, a shorter front pair, a long counter-balancing tail
   and a low, forward-slung predatory stance. It trots on the diagonals,
   drops onto its haunches to telegraph a pounce, and dies by buckling
   under its own weight.
   ================================================================== */

const bones = [
  ['hips', null, 0, 0.74, 0.30],
  ['spine', 'hips', 0, 0.02, -0.34],
  ['chest', 'spine', 0, 0.03, -0.34],
  ['neck1', 'chest', 0, 0.07, -0.24],
  ['neck2', 'neck1', 0, 0.05, -0.18],
  ['head', 'neck2', 0, 0.00, -0.16],
  ['jaw', 'head', 0, -0.07, -0.10],
  ['crest', 'head', 0, 0.09, 0.02],
  ['tail1', 'hips', 0, 0.02, 0.22],
  ['tail2', 'tail1', 0, 0, 0.28],
  ['tail3', 'tail2', 0, 0, 0.26],
  ['tail4', 'tail3', 0, 0, 0.24],
  ['tail5', 'tail4', 0, 0, 0.22],
];
for (const s of [-1, 1]) {
  const k = s < 0 ? 'L' : 'R';
  bones.push(
    // hind: hip → knee (forward) → hock (back, high) → toes. Digitigrade.
    [`hipH${k}`, 'hips', s * 0.21, -0.04, 0.00],
    [`kneeH${k}`, `hipH${k}`, 0, -0.30, -0.10],
    [`hockH${k}`, `kneeH${k}`, 0, -0.26, 0.12],
    [`footH${k}`, `hockH${k}`, 0, -0.14, -0.14],
    // front: shorter, elbow back, wrist forward
    [`hipF${k}`, 'chest', s * 0.18, -0.03, 0.02],
    [`kneeF${k}`, `hipF${k}`, 0, -0.28, 0.07],
    [`hockF${k}`, `kneeF${k}`, 0, -0.27, -0.11],
    [`footF${k}`, `hockF${k}`, 0, -0.18, 0.09],
  );
}

/* ------------------------------------------------------------------ */
function build(pb, tpl) {
  const R = tpl.rest;

  /* torso — one tapered loft from the neck base to the tail root, weighted
   * along the spine chain so the whole body bends as one piece */
  pb.add(region(loft(
    [off(R.neck1, 0, 0.01, -0.02), R.chest, R.spine, R.hips, off(R.tail1, 0, 0, 0.04)],
    {
      tubular: 14,
      radial: 9,
      radius: ramp([[0, 0.105], [0.22, 0.20], [0.5, 0.215], [0.8, 0.185], [1, 0.105]]),
      squash: ramp([[0, 0.9], [0.5, 0.82], [1, 0.9]]),
    },
  ), 0.02, 0.02, 0.62, 0.62), ['neck1', 'chest', 'spine', 'hips', 'tail1'], 'body');

  /* pale belly plating slung under the ribs */
  pb.add(paleRegion(loft(
    [off(R.chest, 0, -0.10, -0.04), off(R.spine, 0, -0.13, 0), off(R.hips, 0, -0.11, 0.02)],
    { tubular: 6, radial: 6, radius: ramp([[0, 0.07], [0.5, 0.105], [1, 0.06]]), squash: 0.34 },
  )), ['chest', 'spine', 'hips'], 'body');

  /* neck */
  pb.add(region(loft(
    [R.chest, R.neck1, R.neck2, off(R.head, 0, 0, 0.02)],
    { tubular: 6, radial: 8, radius: ramp([[0, 0.145], [0.5, 0.105], [1, 0.088]]), squash: 0.92 },
  ), 0.04, 0.66, 0.34, 0.96), ['chest', 'neck1', 'neck2', 'head'], 'body');

  /* skull: a wedge that tapers hard into the snout */
  pb.add(region(loft(
    [off(R.head, 0, 0.035, 0.10), R.head, off(R.head, 0, -0.005, -0.14), off(R.head, 0, -0.025, -0.27)],
    {
      tubular: 6,
      radial: 8,
      radius: ramp([[0, 0.055], [0.32, 0.10], [0.7, 0.062], [1, 0.026]]),
      squash: ramp([[0, 0.85], [1, 0.62]]),
    },
  ), 0.38, 0.66, 0.62, 0.98), 'head', 'body');

  /* lower jaw, hinged on its own bone */
  pb.add(paleRegion(loft(
    [off(R.jaw, 0, 0.012, 0.07), R.jaw, off(R.jaw, 0, 0.004, -0.17)],
    { tubular: 4, radial: 6, radius: ramp([[0, 0.042], [0.45, 0.058], [1, 0.024]]), squash: 0.55 },
  )), 'jaw', 'body');

  /* teeth — four up, four down, small but they catch the light */
  for (let i = 0; i < 4; i++) {
    const s = i < 2 ? -1 : 1;
    const z = -1.00 - (i % 2) * 0.09;
    pb.add(boneRegion(place(spike(0.016, 0.052, { radial: 3, rings: 2 }),
      s * 0.045, R.head.y - 0.055, z, Math.PI, 0, 0)), 'head', 'body');
    pb.add(boneRegion(place(spike(0.014, 0.044, { radial: 3, rings: 2 }),
      s * 0.042, R.jaw.y + 0.012, z + 0.01)), 'jaw', 'body');
  }

  /* eyes — hooded, forward-facing, predatory */
  for (const s of [-1, 1]) {
    pb.add(glowRegion(place(new THREE.SphereGeometry(0.034, 6, 4), s * 0.062, R.head.y + 0.035, R.head.z - 0.075)), 'head', 'body');
    pb.add(region(place(spike(0.026, 0.10, { radial: 4, rings: 2, curve: -0.35 }),
      s * 0.055, R.head.y + 0.07, R.head.z + 0.02, -0.5, 0, s * 0.4), 0.1, 0.1, 0.3, 0.3), 'head', 'body');
  }

  /* neck frill — flares when it screams before a pounce */
  for (let i = -1; i <= 1; i++) {
    const g = spike(0.035, 0.13, { radial: 4, rings: 2 });
    g.scale(1, 1, 0.35);
    pb.add(boneRegion(place(g, i * 0.055, R.crest.y - 0.02, R.crest.z + 0.03, -0.35, 0, i * 0.55)), 'crest', 'body');
  }

  /* dorsal ridge down the spine and tail */
  const ridge = ['neck2', 'neck1', 'chest', 'spine', 'hips', 'tail1', 'tail2', 'tail3'];
  ridge.forEach((name, i) => {
    const t = i / (ridge.length - 1);
    const g = spike(0.028 * (1 - t * 0.5), 0.10 - t * 0.045, { radial: 4, rings: 2 });
    g.scale(0.5, 1, 1);
    pb.add(boneRegion(place(g, 0, R[name].y + 0.12 - t * 0.02, R[name].z, -0.55, 0, 0)), name, 'body');
  });

  /* tail — the counterweight. One loft, blended along five joints. */
  pb.add(region(loft(
    [R.hips, R.tail1, R.tail2, R.tail3, R.tail4, R.tail5, off(R.tail5, 0, -0.01, 0.20)],
    {
      tubular: 15,
      radial: 7,
      radius: ramp([[0, 0.115], [0.25, 0.085], [0.6, 0.05], [1, 0.012]]),
      squash: 0.88,
    },
  ), 0.02, 0.04, 0.5, 0.56), ['hips', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5'], 'body');

  /* legs */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    for (const set of ['H', 'F']) {
      const hip = `hip${set}${k}`;
      const knee = `knee${set}${k}`;
      const hock = `hock${set}${k}`;
      const foot = `foot${set}${k}`;
      const scale = set === 'H' ? 1 : 0.9;
      pb.add(region(boneSegment(R[hip], R[knee], 0.068 * scale, 0.052 * scale,
        { radial: 6, rings: 2, cap0: 0.7 }), 0.05, 0.05, 0.25, 0.3), hip, 'body');
      pb.add(region(boneSegment(R[knee], R[hock], 0.05 * scale, 0.036 * scale,
        { radial: 6, rings: 2, cap0: 0.5 }), 0.3, 0.05, 0.5, 0.3), knee, 'body');
      pb.add(region(boneSegment(R[hock], R[foot], 0.038 * scale, 0.028 * scale,
        { radial: 5, rings: 1, cap0: 0.5 }), 0.05, 0.3, 0.25, 0.5), hock, 'body');
      // toe pad flat on the ground, claws forward
      pb.add(paleRegion(boneSegment(off(R[foot], 0, 0.026, 0), off(R[foot], 0, 0.018, -0.11),
        0.032, 0.024, { radial: 5, rings: 1, cap0: 0.6, cap1: 0.5 })), foot, 'body');
      for (let c = -1; c <= 1; c++) {
        pb.add(boneRegion(place(spike(0.013, 0.05, { radial: 3, rings: 2, curve: 0.4 }),
          R[foot].x + c * 0.028, R[foot].y + 0.016, R[foot].z - 0.10, -1.35, 0, 0)), foot, 'body');
      }
    }
  }
}

/* ------------------------------------------------------------------ */
function materials() {
  const sheet = () => skinSheet({
    seed: 0x5a6b,
    pattern: 'plates',
    palette: {
      light: '#7d8f4a', dark: '#33401d', mortar: '#161c0d', mortarH: 40,
      pale: '#a8a271', paleSpeck: '#7d7850', bone: '#d6cdae',
      cell: 26, jitter: 0.16, round: 0.8, crown: 0.22, bandFreq: 0.9, bandWeight: 0.5,
    },
    glow: { hot: '#ffe9b0', mid: '#ff5a1e', cool: '#2c0a04' },
    relief: { strength: 2.6, roughBase: 0.66, roughVar: 0.3 },
  });
  return {
    body: creatureMaterial('whelp-hide', () => creatureStandard(sheet(), {
      emissive: 0xff4a18, emissiveIntensity: 2.4, metalness: 0.03, normalScale: 1.15,
    })),
  };
}

function attach(model) {
  const b = model.bones;
  model.legs = [];
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    for (const set of ['H', 'F']) {
      model.legs.push({
        hip: b[`hip${set}${k}`],
        knee: b[`knee${set}${k}`],
        hock: b[`hock${set}${k}`],
        foot: b[`foot${set}${k}`],
        side: s,
        front: set === 'F',
        // diagonal trot: front-left pairs with hind-right
        phase: (set === 'F' ? 0 : Math.PI) + (s < 0 ? 0 : Math.PI),
      });
    }
  }
  model.spineChain = [b.hips, b.spine, b.chest];
  model.neckChain = [b.neck1, b.neck2, b.head];
  model.tail = [b.tail1, b.tail2, b.tail3, b.tail4, b.tail5];
}

/* ------------------------------------------------------------------ */
/* animation                                                           */
/* ------------------------------------------------------------------ */
function animate(e, dt, ctx) {
  const m = e.model;
  // an external solver (src/rigidbody.js) may own the bones from here on
  if (e.ragdoll) return;
  const b = m.bones;
  const a = e.a;
  resetPose(m);

  const run = e.run;
  const bt = beat(e.act);
  const lunging = bt.id === 'lunge' || bt.id === 'feint';

  /* --- gait phase from real speed, so it never skates --- */
  e.gait += dt * (2.4 + run * 9.5);
  const g = e.gait;

  /* --- posture targets --------------------------------------------- */
  // crouch: deep on anticipation, exploding out on the commit
  let crouch = 0;
  let pounce = 0;
  let recover = 0;
  if (lunging) {
    if (bt.phase === 'ant') crouch = smoothstep(0, 0.55, bt.k) * (0.85 + 0.15 * Math.sin(bt.k * 22));
    else if (bt.phase === 'com') { crouch = 1 - easeOut(bt.k); pounce = hump(bt.k * 0.8); }
    else { recover = 1 - easeIn(bt.k); crouch = recover * 0.5; }
  }
  a.crouch = damp(a.crouch, crouch, 22, dt);
  a.pounce = damp(a.pounce, pounce, 26, dt);
  a.recover = damp(a.recover, recover, 14, dt);

  const stagger = e.stagger > 0 ? clamp01(e.stagger / 0.55) : 0;
  const flinch = e.flinch > 0 ? clamp01(e.flinch / 0.3) : 0;
  // knocked flat, then scrabbling back onto its feet
  a.down = damp(a.down, e.state === 'downed' ? 1 : 0, e.state === 'downed' ? 14 : 4.5, dt);
  const dead = e.state === 'dead';
  const dying = dead ? clamp01(e.stateT / 0.75) : 0;
  const settled = dead ? clamp01((e.stateT - 0.55) / 0.9) : 0;

  /* --- body: bob, roll, pitch -------------------------------------- */
  const bob = Math.abs(Math.sin(g)) * 0.035 * (0.35 + run) + Math.sin(g * 2) * 0.012;
  const breathe = Math.sin(e.stateT * 1.8 + e.animPhase) * 0.012 * (1 - run);
  b.hips.position.y += bob + breathe - a.crouch * 0.20 + a.pounce * 0.16 - stagger * 0.06
    - a.down * 0.30 - dying * 0.34 * easeOut(dying);
  b.hips.position.z += a.crouch * 0.09 - a.pounce * 0.06;

  const roll = Math.sin(g) * 0.10 * run + flinch * e.flinchX * 0.5 + stagger * e.flinchX * 0.4;
  b.hips.rotation.z = roll + a.down * 0.85 * e.deathSide - dying * 1.15 * easeOut(dying) * e.deathSide;
  b.hips.rotation.x = -run * 0.10 + a.crouch * 0.22 - a.pounce * 0.30 + a.recover * 0.18
    + flinch * e.flinchZ * 0.35 + dying * 0.30;
  b.hips.rotation.y = Math.sin(g * 0.5) * 0.06 * run;

  b.spine.rotation.x = a.crouch * 0.12 - a.pounce * 0.16 + Math.sin(g * 2 + 0.6) * 0.02 * run + dying * 0.16;
  b.spine.rotation.z = -roll * 0.4;
  b.chest.rotation.x = -a.crouch * 0.05 - a.pounce * 0.12 + a.recover * 0.24 + dying * 0.22;
  b.chest.rotation.y = Math.sin(g * 0.5 + 0.8) * 0.05 * run;

  /* --- head: stabilised, tracks the player, drops on death --------- */
  const headYaw = dead ? 0 : clamp(e.look.yaw, -0.9, 0.9);
  const headPitch = dead ? 0 : clamp(e.look.pitch, -0.5, 0.6);
  a.headYaw = dampAngle(a.headYaw, headYaw, 9, dt);
  a.headPitch = damp(a.headPitch, headPitch, 8, dt);
  const neckDown = a.crouch * 0.5 - a.pounce * 0.35 + dying * 0.5;
  b.neck1.rotation.x = 0.06 + neckDown * 0.5 + a.headPitch * 0.3 - Math.sin(g * 2) * 0.03 * run;
  b.neck1.rotation.y = a.headYaw * 0.35 + (dead ? 0 : Math.sin(g * 0.5) * 0.04 * run);
  b.neck2.rotation.x = -0.04 + neckDown * 0.35 + a.headPitch * 0.35;
  b.neck2.rotation.y = a.headYaw * 0.35;
  // counter-rotate the head against the body so the eyes stay on target
  b.head.rotation.x = -b.hips.rotation.x * 0.7 - b.neck1.rotation.x * 0.55 + a.headPitch * 0.5
    + (bt.phase === 'ant' && lunging ? -0.12 : 0) + dying * 0.5;
  b.head.rotation.y = a.headYaw * 0.3;
  b.head.rotation.z = -roll * 0.8;

  /* jaw: gapes through the anticipation, snaps shut on the commit */
  let jaw = 0.06 + run * 0.05;
  if (lunging) {
    if (bt.phase === 'ant') jaw = 0.16 + smoothstep(0.3, 1, bt.k) * 0.55;
    else if (bt.phase === 'com') jaw = 0.75 * (1 - easeIn(bt.k)) * (bt.k < 0.45 ? 1 : 0.1);
    else jaw = 0.3 * (1 - bt.k);
  }
  if (dead) jaw = 0.45 * dying;
  a.jaw = damp(a.jaw, jaw, 26, dt);
  b.jaw.rotation.x = -a.jaw;

  /* frill flare — the single clearest "I am about to pounce" read */
  const frill = lunging && bt.phase === 'ant' ? smoothstep(0.1, 0.7, bt.k) : (bt.phase === 'com' ? 0.6 : 0);
  a.frill = damp(a.frill, frill, 18, dt);
  b.crest.rotation.x = -a.frill * 0.7;
  b.crest.scale.setScalar(1 + a.frill * 0.5);

  /* --- tail: counter-swing, lifts as a rudder in the lunge --------- */
  const tailLift = a.crouch * 0.5 + a.pounce * 0.3;
  m.tail.forEach((seg, i) => {
    const t = i / (m.tail.length - 1);
    const swing = Math.sin(g * 0.5 - i * 0.55) * (0.07 + run * 0.20) - b.hips.rotation.y * 0.6;
    seg.rotation.y = dead ? swing * 0.15 * (1 - settled) : swing;
    seg.rotation.x = -tailLift * (0.22 - t * 0.1) + Math.sin(g - i * 0.4) * 0.04 * run
      + (dead ? 0.10 * (1 - settled) : 0) + (1 - t) * 0.02;
  });

  /* --- legs -------------------------------------------------------- */
  const stride = 0.35 + run * 0.85;
  for (const leg of m.legs) {
    const ph = g + leg.phase;
    const s = Math.sin(ph);
    const swingUp = Math.max(0, s);
    const amp = stride * (leg.front ? 0.85 : 1);

    let hipRot = s * amp * 0.55;
    let kneeRot = -swingUp * amp * 0.9 - 0.12;
    let hockRot = swingUp * amp * 0.5 + 0.10;
    let footRot = -swingUp * amp * 0.25;

    // coil on anticipation, extend hard on the commit
    hipRot += a.crouch * (leg.front ? 0.35 : -0.55) - a.pounce * (leg.front ? 0.5 : -0.85);
    kneeRot += -a.crouch * 0.95 + a.pounce * 0.75;
    hockRot += a.crouch * 0.6 - a.pounce * 0.45;
    // front legs splay out on landing
    if (leg.front) hipRot += a.recover * 0.7;
    if (stagger > 0) hipRot += stagger * leg.side * 0.2 * (leg.front ? 1 : -1);
    if (a.down > 0.01) {
      // splayed and paddling — it has to get up before it can do anything
      hipRot = lerp(hipRot, (leg.front ? 0.7 : -0.55) + Math.sin(ph * 1.6) * 0.25, a.down);
      kneeRot = lerp(kneeRot, -1.15, a.down);
      hockRot = lerp(hockRot, 0.8, a.down);
    }
    if (dead) {
      const buckle = leg.front ? easeOut(clamp01(e.stateT / 0.3)) : easeOut(clamp01((e.stateT - 0.12) / 0.4));
      kneeRot = lerp(kneeRot, -1.5, buckle);
      hipRot = lerp(hipRot, leg.front ? 0.5 : -0.4, buckle);
      hockRot = lerp(hockRot, 1.0, buckle);
    }

    leg.hip.rotation.x = hipRot;
    leg.hip.rotation.z = leg.side * (0.04 + run * 0.05 + a.crouch * 0.12);
    leg.knee.rotation.x = kneeRot;
    leg.hock.rotation.x = hockRot;
    leg.foot.rotation.x = footRot;

    // footfall dust on the down-stroke
    const planted = s < -0.85;
    if (planted && !leg.planted && run > 0.25 && e.onGround && !dead) {
      leg.planted = true;
      if (ctx.vfx && ctx.rng.chance(0.5)) {
        ctx.vfx.burst(
          ctx.scratch.set(e.pos.x + leg.side * 0.2, e.pos.y + 0.05, e.pos.z),
          0x8a7a58, 2, 1.2, { size: 0.12, life: 0.3, drag: 5, up: 0.4 },
        );
      }
    } else if (s > 0) leg.planted = false;
  }

  /* eyes flare on the wind-up, dim as it dies */
  e.glow = (lunging && bt.phase === 'ant' ? 1.4 * bt.k : 0) + (bt.phase === 'com' ? 1.2 : 0)
    + (dead ? -0.85 * settled : 0) + Math.sin(e.stateT * 3 + e.animPhase) * 0.12;
}

export const WHELP = {
  id: 'whelp',
  boundingRadius: 2.0,
  bones,
  build,
  materials,
  attach,
  animate,
  emissiveBase: 2.4,
  /* Driver bones for an external ragdoll solver. `tip` names the bone whose
   * rest position gives this one its length and direction — the rig has
   * identity rest rotations, so a bone's direction lives in its child's
   * offset, not in its own quaternion. See EnemyManager#ragdollEntries(). */
  ragdoll: [
    { name: 'hips', parent: null, tip: 'spine', radius: 0.20, mass: 7 },
    { name: 'spine', parent: 'hips', tip: 'chest', radius: 0.20, mass: 6 },
    { name: 'chest', parent: 'spine', tip: 'neck1', radius: 0.19, mass: 6 },
    { name: 'neck1', parent: 'chest', tip: 'head', radius: 0.11, mass: 2, cone: 0.7 },
    { name: 'head', parent: 'neck1', length: 0.30, radius: 0.12, mass: 2.5, cone: 0.6 },
    { name: 'tail1', parent: 'hips', tip: 'tail3', radius: 0.09, mass: 1.5, cone: 1.1 },
    { name: 'tail3', parent: 'tail1', tip: 'tail5', radius: 0.05, mass: 0.8, cone: 1.2 },
    { name: 'hipHL', parent: 'hips', tip: 'kneeHL', radius: 0.07, mass: 1.4 },
    { name: 'kneeHL', parent: 'hipHL', tip: 'footHL', radius: 0.05, mass: 1 },
    { name: 'hipHR', parent: 'hips', tip: 'kneeHR', radius: 0.07, mass: 1.4 },
    { name: 'kneeHR', parent: 'hipHR', tip: 'footHR', radius: 0.05, mass: 1 },
    { name: 'hipFL', parent: 'chest', tip: 'kneeFL', radius: 0.06, mass: 1.1 },
    { name: 'kneeFL', parent: 'hipFL', tip: 'footFL', radius: 0.045, mass: 0.8 },
    { name: 'hipFR', parent: 'chest', tip: 'kneeFR', radius: 0.06, mass: 1.1 },
    { name: 'kneeFR', parent: 'hipFR', tip: 'footFR', radius: 0.045, mass: 0.8 },
  ],
  /* three-beat timings: 0.46 s of readable anticipation before it commits */
  acts: {
    lunge: { id: 'lunge', ant: 0.46, com: 0.17, rec: 0.42 },
    feint: { id: 'feint', ant: 0.34, com: 0.10, rec: 0.5 },
  },
};
