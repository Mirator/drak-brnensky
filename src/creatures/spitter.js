import * as THREE from 'three';
import {
  loft, boneSegment, spike, membranePanel, place, off, ramp, region, glowRegion, paleRegion, boneRegion,
  resetPose, beat, damp, dampAngle, clamp, clamp01, lerp, hump, easeOut, easeIn, smoothstep,
  creatureMaterial,
} from './kit.js';
import { skinSheet, creatureStandard, membraneSheet } from './skin.js';

/* ==================================================================
   CHRLIČ — the spitter. A gargoyle, and it should read like one: stone
   flesh, a hunched perching crouch, a wide grinning maw and a throat sac
   that swells and lights up from inside before it spits.

   The wings are a real three-segment skeleton — humerus, radius, a fanned
   finger strut — with a membrane skinned across all three, so folding the
   elbow and wrist actually crumples the membrane instead of scaling it.
   ================================================================== */

const bones = [
  ['hips', null, 0, 1.02, 0.06],
  ['spine', 'hips', 0, 0.18, -0.02],
  ['chest', 'spine', 0, 0.22, -0.03],
  ['neck', 'chest', 0, 0.14, -0.04],
  ['head', 'neck', 0, 0.12, -0.03],
  ['jaw', 'head', 0, -0.07, -0.05],
  ['throat', 'neck', 0, -0.01, -0.11],
  ['tail1', 'hips', 0, -0.02, 0.16],
  ['tail2', 'tail1', 0, -0.05, 0.22],
  ['tail3', 'tail2', 0, -0.07, 0.20],
];
for (const s of [-1, 1]) {
  const k = s < 0 ? 'L' : 'R';
  bones.push(
    // wing: shoulder → elbow → wrist → finger fan (authored spread)
    [`wingA${k}`, 'chest', s * 0.26, 0.30, 0.08],
    [`wingB${k}`, `wingA${k}`, s * 0.80, 0.20, 0.05],
    [`wingC${k}`, `wingB${k}`, s * 0.80, -0.15, -0.08],
    [`wingD${k}`, `wingC${k}`, s * 0.46, -0.42, 0.16],
    // digitigrade legs
    [`hip${k}`, 'hips', s * 0.17, -0.06, 0.02],
    [`knee${k}`, `hip${k}`, 0, -0.36, -0.12],
    [`hock${k}`, `knee${k}`, 0, -0.34, 0.16],
    [`foot${k}`, `hock${k}`, 0, -0.26, -0.10],
    // short clawed arms
    [`armA${k}`, 'chest', s * 0.23, 0.05, 0.01],
    [`armB${k}`, `armA${k}`, s * 0.06, -0.30, 0.05],
    [`armC${k}`, `armB${k}`, s * 0.02, -0.26, -0.07],
  );
}

/* ------------------------------------------------------------------ */
function build(pb, tpl) {
  const R = tpl.rest;

  /* deep-chested stone torso */
  pb.add(region(loft(
    [off(R.hips, 0, -0.14, 0.04), R.hips, R.spine, R.chest, off(R.neck, 0, -0.02, 0)],
    {
      tubular: 12,
      radial: 9,
      radius: ramp([[0, 0.14], [0.25, 0.20], [0.62, 0.245], [1, 0.16]]),
      squash: ramp([[0, 0.85], [0.7, 0.78], [1, 0.85]]),
    },
  ), 0.02, 0.02, 0.6, 0.62), ['hips', 'spine', 'chest', 'neck'], 'body');

  /* pale weathered chest plate */
  pb.add(paleRegion(loft(
    [off(R.spine, 0, -0.06, -0.16), off(R.chest, 0, 0.02, -0.19), off(R.neck, 0, -0.04, -0.14)],
    { tubular: 5, radial: 6, radius: ramp([[0, 0.09], [0.5, 0.115], [1, 0.07]]), squash: 0.42 },
  )), ['spine', 'chest', 'neck'], 'body');

  /* hunched shoulder ridges — the gargoyle silhouette lives here */
  for (const s of [-1, 1]) {
    const g = loft(
      [off(R.chest, s * 0.06, 0.10, 0.06), off(R.chest, s * 0.22, 0.19, 0.03), off(R.chest, s * 0.32, 0.13, -0.04)],
      { tubular: 4, radial: 6, radius: ramp([[0, 0.10], [0.5, 0.115], [1, 0.06]]), squash: 0.8 },
    );
    pb.add(region(g, 0.04, 0.04, 0.42, 0.4), 'chest', 'body');
  }

  /* neck + throat sac */
  pb.add(region(loft(
    [R.chest, R.neck, off(R.head, 0, -0.01, 0.01)],
    { tubular: 4, radial: 7, radius: ramp([[0, 0.145], [1, 0.10]]), squash: 0.95 },
  ), 0.05, 0.62, 0.3, 0.94), ['chest', 'neck', 'head'], 'body');
  const sac = new THREE.SphereGeometry(0.115, 9, 7);
  sac.scale(1, 0.9, 1.05);
  pb.add(glowRegion(place(sac, R.throat.x, R.throat.y, R.throat.z)), 'throat', 'body');

  /* gargoyle skull: heavy brow, blunt snout, wide grin */
  pb.add(region(loft(
    [off(R.head, 0, 0.05, 0.10), R.head, off(R.head, 0, 0.005, -0.13), off(R.head, 0, -0.03, -0.24)],
    {
      tubular: 6,
      radial: 8,
      radius: ramp([[0, 0.075], [0.35, 0.125], [0.72, 0.095], [1, 0.05]]),
      squash: ramp([[0, 0.9], [1, 0.7]]),
    },
  ), 0.36, 0.6, 0.66, 0.98), 'head', 'body');
  // brow shelf
  pb.add(region(place(boneSegment(off(R.head, -0.13, 0.07, -0.07), off(R.head, 0.13, 0.07, -0.07),
    0.045, 0.045, { radial: 5, rings: 1 }), 0, 0, 0), 0.1, 0.12, 0.28, 0.3), 'head', 'body');
  /* jaw with a row of blunt stone teeth */
  pb.add(region(loft(
    [off(R.jaw, 0, 0.02, 0.08), R.jaw, off(R.jaw, 0, 0.01, -0.19)],
    { tubular: 4, radial: 7, radius: ramp([[0, 0.06], [0.5, 0.085], [1, 0.045]]), squash: 0.5 },
  ), 0.36, 0.28, 0.62, 0.56), 'jaw', 'body');
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1;
    const z = R.head.z - 0.09 - Math.floor(i / 2) * 0.055;
    pb.add(boneRegion(place(spike(0.019, 0.05, { radial: 3, rings: 1 }), s * 0.062, R.head.y - 0.075, z, Math.PI, 0, 0)), 'head', 'body');
    pb.add(boneRegion(place(spike(0.017, 0.045, { radial: 3, rings: 1 }), s * 0.058, R.jaw.y + 0.02, z + 0.005)), 'jaw', 'body');
  }
  /* eyes and swept horns */
  for (const s of [-1, 1]) {
    pb.add(glowRegion(place(new THREE.SphereGeometry(0.036, 6, 5), s * 0.072, R.head.y + 0.025, R.head.z - 0.10)), 'head', 'body');
    pb.add(boneRegion(place(spike(0.036, 0.30, { radial: 5, rings: 3, curve: 0.35 }),
      s * 0.10, R.head.y + 0.085, R.head.z + 0.06, -0.65, 0, s * 0.55)), 'head', 'body');
    // ear fin
    const fin = spike(0.05, 0.14, { radial: 4, rings: 2 });
    fin.scale(0.3, 1, 1);
    pb.add(region(place(fin, s * 0.115, R.head.y + 0.01, R.head.z + 0.02, 0.2, 0, s * 1.3), 0.12, 0.12, 0.3, 0.34), 'head', 'body');
  }

  /* stubby tail, wraps around the feet when it perches */
  pb.add(region(loft(
    [R.hips, R.tail1, R.tail2, R.tail3, off(R.tail3, 0, -0.04, 0.14)],
    { tubular: 8, radial: 6, radius: ramp([[0, 0.10], [0.5, 0.065], [1, 0.02]]), squash: 0.9 },
  ), 0.02, 0.04, 0.4, 0.5), ['hips', 'tail1', 'tail2', 'tail3'], 'body');

  /* ---- wings: struts + membrane ---- */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const A = R[`wingA${k}`];
    const B = R[`wingB${k}`];
    const C = R[`wingC${k}`];
    const D = R[`wingD${k}`];
    // humerus / radius / leading finger
    pb.add(region(boneSegment(A, B, 0.058, 0.044, { radial: 6, rings: 1, cap0: 0.6 }), 0.06, 0.06, 0.3, 0.26), `wingA${k}`, 'body');
    pb.add(region(boneSegment(B, C, 0.044, 0.034, { radial: 6, rings: 1, cap0: 0.6 }), 0.3, 0.06, 0.54, 0.26), `wingB${k}`, 'body');
    pb.add(region(boneSegment(C, D, 0.032, 0.02, { radial: 5, rings: 1, cap0: 0.6 }), 0.06, 0.3, 0.3, 0.5), `wingC${k}`, 'body');
    // thumb claw at the wrist — the hook a gargoyle hangs off
    pb.add(boneRegion(place(spike(0.02, 0.13, { radial: 4, rings: 2, curve: 0.3 }),
      C.x, C.y + 0.02, C.z - 0.02, -1.2, 0, s * 0.5)), `wingC${k}`, 'body');

    // three fanned finger struts off the wrist
    const fingers = [
      [D.x + s * 0.02, D.y - 0.06, D.z + 0.06],
      [C.x + s * 0.30, C.y - 0.72, C.z + 0.30],
      [C.x + s * 0.06, C.y - 0.66, C.z + 0.44],
    ];
    fingers.forEach((f, i) => {
      pb.add(region(boneSegment(C, new THREE.Vector3(f[0], f[1], f[2]), 0.024, 0.012,
        { radial: 4, rings: 2 }), 0.3, 0.3, 0.5, 0.5), i === 0 ? `wingD${k}` : `wingC${k}`, 'body');
    });

    /* membrane. Weights blend along the wing's X span so a folding elbow
     * crumples the sheet the way a real bat wing does. */
    const wingWeights = (x) => {
      const ax = Math.abs(x);
      const aA = Math.abs(A.x);
      const aB = Math.abs(B.x);
      const aC = Math.abs(C.x);
      if (ax <= aB) {
        const f = clamp01((ax - aA) / Math.max(0.01, aB - aA));
        return [[`wingA${k}`, 1 - f], [`wingB${k}`, f]];
      }
      const f = clamp01((ax - aB) / Math.max(0.01, aC - aB));
      return [[`wingB${k}`, 1 - f], [`wingC${k}`, f * 0.7], [`wingD${k}`, f * 0.3]];
    };

    const armLead = [[A.x, A.y, A.z], [B.x, B.y + 0.02, B.z], [C.x, C.y, C.z]];
    const armTrail = [
      [A.x * 0.3, A.y - 0.34, A.z + 0.22],
      [B.x * 0.92, B.y - 0.52, B.z + 0.30],
      [fingers[2][0], fingers[2][1], fingers[2][2]],
    ];
    pb.add(region(membranePanel(armLead, armTrail, 5, 4), 0.02, 0.02, 0.96, 0.5), wingWeights, 'membrane');

    const handLead = [[C.x, C.y, C.z], [(C.x + D.x) / 2, (C.y + D.y) / 2 + 0.02, (C.z + D.z) / 2], [D.x, D.y, D.z]];
    const handTrail = [
      [C.x, C.y - 0.02, C.z + 0.04],
      [fingers[1][0], fingers[1][1], fingers[1][2]],
      [fingers[0][0], fingers[0][1], fingers[0][2]],
    ];
    pb.add(region(membranePanel(handLead, handTrail, 4, 3), 0.04, 0.52, 0.9, 0.98), wingWeights, 'membrane');
  }

  /* legs */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    pb.add(region(boneSegment(R[`hip${k}`], R[`knee${k}`], 0.095, 0.07, { radial: 7, rings: 2, cap0: 0.7 }), 0.05, 0.05, 0.3, 0.35), `hip${k}`, 'body');
    pb.add(region(boneSegment(R[`knee${k}`], R[`hock${k}`], 0.07, 0.05, { radial: 6, rings: 2, cap0: 0.5 }), 0.3, 0.05, 0.55, 0.35), `knee${k}`, 'body');
    pb.add(region(boneSegment(R[`hock${k}`], R[`foot${k}`], 0.05, 0.038, { radial: 5, rings: 1, cap0: 0.5 }), 0.05, 0.35, 0.3, 0.6), `hock${k}`, 'body');
    // three-toed grasping foot — this is what grips a ledge
    for (let c = -1; c <= 1; c++) {
      const toe = off(R[`foot${k}`], c * 0.05, 0.02, -0.13 + Math.abs(c) * 0.03);
      pb.add(paleRegion(boneSegment(off(R[`foot${k}`], c * 0.02, 0.03, 0), toe, 0.03, 0.02, { radial: 4, rings: 1, cap0: 0.5 })), `foot${k}`, 'body');
      pb.add(boneRegion(place(spike(0.015, 0.06, { radial: 3, rings: 2, curve: 0.5 }), toe.x, toe.y - 0.01, toe.z - 0.02, -1.4, 0, 0)), `foot${k}`, 'body');
    }
    // heel spur
    pb.add(boneRegion(place(spike(0.016, 0.07, { radial: 3, rings: 1 }), R[`foot${k}`].x, R[`foot${k}`].y + 0.03, R[`foot${k}`].z + 0.07, 1.5, 0, 0)), `foot${k}`, 'body');

    /* arms */
    pb.add(region(boneSegment(R[`armA${k}`], R[`armB${k}`], 0.05, 0.04, { radial: 5, rings: 1, cap0: 0.7 }), 0.06, 0.4, 0.26, 0.6), `armA${k}`, 'body');
    pb.add(region(boneSegment(R[`armB${k}`], R[`armC${k}`], 0.04, 0.03, { radial: 5, rings: 1, cap0: 0.6 }), 0.28, 0.4, 0.48, 0.6), `armB${k}`, 'body');
    for (let c = -1; c <= 1; c++) {
      pb.add(boneRegion(place(spike(0.012, 0.075, { radial: 3, rings: 2, curve: 0.4 }),
        R[`armC${k}`].x + c * 0.025, R[`armC${k}`].y - 0.01, R[`armC${k}`].z - 0.02, -1.9, 0, 0)), `armC${k}`, 'body');
    }
  }
}

/* ------------------------------------------------------------------ */
function materials() {
  const sheet = () => skinSheet({
    seed: 0x4a3a,
    pattern: 'plates',
    palette: {
      light: '#8b8378', dark: '#403a3c', mortar: '#241f22', mortarH: 46,
      pale: '#a89c86', paleSpeck: '#6d6355', bone: '#cfc4a6',
      cell: 34, jitter: 0.22, round: 0.2, crown: 0.1, bandFreq: 0.55, bandWeight: 0.35,
    },
    glow: { hot: '#fff2c8', mid: '#ff7a1e', cool: '#2a0e06' },
    relief: { strength: 3.0, roughBase: 0.82, roughVar: 0.16 },
  });
  return {
    body: creatureMaterial('gargoyle-stone', () => creatureStandard(sheet(), {
      emissive: 0xff6a1e, emissiveIntensity: 2.0, roughness: 1, metalness: 0.02, normalScale: 1.3,
    })),
    membrane: creatureMaterial('wing-membrane', () => creatureStandard(membraneSheet(), {
      color: 0x9a8074, emissive: 0x220802, emissiveIntensity: 0.6,
      roughness: 1, metalness: 0, side: THREE.DoubleSide, normalScale: 0.9,
    }), { tint: 'gargoyle' }),
  };
}

function attach(model) {
  const b = model.bones;
  model.wings = [];
  model.legs = [];
  model.arms = [];
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    model.wings.push({ a: b[`wingA${k}`], b: b[`wingB${k}`], c: b[`wingC${k}`], d: b[`wingD${k}`], side: s });
    model.legs.push({ hip: b[`hip${k}`], knee: b[`knee${k}`], hock: b[`hock${k}`], foot: b[`foot${k}`], side: s, phase: s < 0 ? 0 : Math.PI });
    model.arms.push({ a: b[`armA${k}`], b: b[`armB${k}`], c: b[`armC${k}`], side: s });
  }
  model.tail = [b.tail1, b.tail2, b.tail3];
}

/* ------------------------------------------------------------------ */
/* animation                                                           */
/* ------------------------------------------------------------------ */
function animate(e, dt, ctx) {
  const m = e.model;
  if (e.ragdoll) return;   // handed off to an external ragdoll solver
  const b = m.bones;
  const a = e.a;
  resetPose(m);

  const bt = beat(e.act);
  const spitting = bt.id === 'spit';
  const dead = e.state === 'dead';
  const perched = e.state === 'perch';
  const flying = e.flying && !dead;
  const dying = dead ? clamp01(e.stateT / 0.7) : 0;
  const settled = dead ? clamp01((e.landedT ?? 0) / 0.6) : 0;

  /* wing cycle: flap hard when climbing, hold and soar when cruising */
  const soar = flying ? clamp01(e.soar ?? 0) : 0;
  e.gait += dt * (flying ? (3.4 + (1 - soar) * 4.6) : (2.0 + e.run * 6.5));
  const g = e.gait;
  const flap = Math.sin(g);

  /* --- posture ----------------------------------------------------- */
  a.down = damp(a.down, e.state === 'downed' ? 1 : 0, e.state === 'downed' ? 14 : 4.5, dt);
  const crouch = perched ? 1 : (flying ? 0.15 : 0.35 - e.run * 0.2 + a.down * 0.6);
  a.crouch = damp(a.crouch, crouch, 6, dt);
  const stagger = e.stagger > 0 ? clamp01(e.stagger / 0.6) : 0;
  const flinch = e.flinch > 0 ? clamp01(e.flinch / 0.32) : 0;

  const bob = flying
    ? Math.sin(g) * 0.09 + Math.sin(g * 2) * 0.02
    : Math.abs(Math.sin(g)) * 0.03 * (0.3 + e.run);
  b.hips.position.y += bob - a.crouch * 0.30 - a.down * 0.34 - dying * 0.30 * easeOut(dying) - stagger * 0.06;
  b.hips.rotation.x = (flying ? -0.30 - e.climb * 0.35 : 0.16 + a.crouch * 0.22 - e.run * 0.1)
    + flinch * e.flinchZ * 0.4 + dying * 0.5 + (spitting && bt.phase === 'ant' ? -0.12 * bt.k : 0);
  b.hips.rotation.z = Math.sin(g * 0.5) * 0.05 * (flying ? 1 : e.run)
    + flinch * e.flinchX * 0.5 + stagger * e.flinchX * 0.5 + a.down * 0.55 * e.deathSide
    - dying * 1.0 * easeOut(dying) * e.deathSide;
  b.spine.rotation.x = -a.crouch * 0.14 + (flying ? -0.1 : 0.08) + dying * 0.25;
  b.chest.rotation.x = a.crouch * 0.30 + (flying ? 0.16 : 0.06) - (spitting ? 0 : 0) + dying * 0.2;
  b.chest.rotation.z = -b.hips.rotation.z * 0.35;

  /* --- head / throat sac: the telegraph ---------------------------- */
  let sac = 1;
  let jaw = 0.05;
  let rear = 0;
  if (spitting) {
    if (bt.phase === 'ant') {
      // sac swells and lights up, head pulls back like a cocked hammer
      sac = 1 + easeIn(bt.k) * 0.95;
      rear = smoothstep(0.05, 0.85, bt.k);
      jaw = 0.05 + smoothstep(0.55, 1, bt.k) * 0.5;
    } else if (bt.phase === 'com') {
      sac = 1.9 - easeOut(bt.k) * 1.1;
      rear = -0.9 * easeOut(bt.k);
      jaw = 0.9;
    } else {
      sac = 0.85 + hump(bt.k) * 0.12; // panting
      rear = -0.25 * (1 - bt.k);
      jaw = 0.35 * (1 - bt.k) + Math.abs(Math.sin(bt.k * 18)) * 0.1;
    }
  }
  a.sac = damp(a.sac ?? 1, sac, 22, dt);
  a.rear = damp(a.rear, rear, 20, dt);
  a.jaw = damp(a.jaw, dead ? 0.5 : jaw, 20, dt);
  b.throat.scale.setScalar(a.sac);
  b.jaw.rotation.x = -a.jaw;

  const headYaw = dead ? 0 : clamp(e.look.yaw, -1.1, 1.1);
  const headPitch = dead ? 0 : clamp(e.look.pitch, -0.7, 0.8);
  a.headYaw = dampAngle(a.headYaw, headYaw, 8, dt);
  a.headPitch = damp(a.headPitch, headPitch, 7, dt);
  b.neck.rotation.x = 0.1 + a.crouch * 0.30 + a.rear * 0.55 + a.headPitch * 0.35 + dying * 0.6;
  b.neck.rotation.y = a.headYaw * 0.4;
  b.head.rotation.x = -b.neck.rotation.x * 0.5 - a.rear * 0.35 + a.headPitch * 0.55
    - b.hips.rotation.x * 0.6 + dying * 0.4;
  b.head.rotation.y = a.headYaw * 0.5;
  b.head.rotation.z = -b.hips.rotation.z * 0.7 + (perched ? Math.sin(e.stateT * 0.7) * 0.10 : 0);

  /* --- wings ------------------------------------------------------- */
  //           folded              soaring            power stroke
  const fold = flying ? 0 : 1;
  a.fold = damp(a.fold ?? 1, dead ? 0.7 : fold, 7, dt);
  const flare = spitting && bt.phase !== 'rec' ? smoothstep(0.2, 0.9, bt.k) * (bt.phase === 'ant' ? 1 : 0.6) : 0;
  a.flare = damp(a.flare, flare, 14, dt);

  for (const w of m.wings) {
    const s = w.side;
    const beatUp = flap * (1 - soar * 0.75);
    // spread: sweep the humerus down/back and open the elbow + wrist
    const openZ = lerp(-1.25, 0.12 + beatUp * 0.55, 1 - a.fold) + a.flare * 0.7;
    const openY = lerp(0.95, 0.16 - beatUp * 0.12, 1 - a.fold);
    w.a.rotation.z = s * openZ;
    w.a.rotation.y = s * openY;
    w.a.rotation.x = lerp(0.25, -0.12 + beatUp * 0.2, 1 - a.fold) + (dying ? 0.5 * dying : 0);
    w.b.rotation.z = -s * lerp(2.15, 0.20 - beatUp * 0.30, 1 - a.fold) - s * a.flare * 0.35;
    w.b.rotation.y = -s * lerp(0.55, 0.05, 1 - a.fold);
    w.c.rotation.z = -s * lerp(1.55, 0.05 + beatUp * 0.22, 1 - a.fold);
    w.d.rotation.z = -s * lerp(0.85, -0.10 - beatUp * 0.18, 1 - a.fold);
    w.d.rotation.x = lerp(0.3, beatUp * 0.25, 1 - a.fold);
    if (dead) {
      w.b.rotation.z += -s * 0.5 * dying;
      w.a.rotation.x += 0.4 * dying;
    }
  }

  /* --- legs: tucked in flight, gripping on a perch ----------------- */
  for (const leg of m.legs) {
    const ph = g + leg.phase;
    const swing = Math.max(0, Math.sin(ph));
    if (flying) {
      leg.hip.rotation.x = -0.55 + Math.sin(g + leg.phase) * 0.06;
      leg.knee.rotation.x = -1.5;
      leg.hock.rotation.x = 0.9;
      leg.foot.rotation.x = -0.5;
    } else {
      const stride = perched ? 0 : (0.3 + e.run * 0.9);
      leg.hip.rotation.x = Math.sin(ph) * stride * 0.5 + a.crouch * 0.55 - 0.1;
      leg.hip.rotation.z = leg.side * (0.06 + a.crouch * 0.22);
      leg.knee.rotation.x = -0.35 - swing * stride * 0.8 - a.crouch * 0.85;
      leg.hock.rotation.x = 0.3 + swing * stride * 0.45 + a.crouch * 0.55;
      leg.foot.rotation.x = -0.1 - swing * stride * 0.2;
      if (dead) {
        leg.knee.rotation.x = lerp(leg.knee.rotation.x, -1.6, dying);
        leg.hip.rotation.x = lerp(leg.hip.rotation.x, -0.5, dying);
      }
      const planted = Math.sin(ph) < -0.85;
      if (planted && !leg.planted && e.run > 0.3 && e.onGround && !dead) {
        leg.planted = true;
        if (ctx.vfx) {
          ctx.vfx.burst(ctx.scratch.set(e.pos.x + leg.side * 0.2, e.pos.y + 0.05, e.pos.z),
            0x6b6055, 2, 1.3, { size: 0.13, life: 0.32, drag: 5 });
        }
      } else if (Math.sin(ph) > 0) leg.planted = false;
    }
  }

  /* --- arms: clutched at the chest, thrown wide as it spits -------- */
  for (const arm of m.arms) {
    const s = arm.side;
    arm.a.rotation.x = -0.5 + a.crouch * 0.3 - a.flare * 0.9 + (flying ? -0.3 : 0);
    arm.a.rotation.z = s * (0.35 - a.flare * 0.5);
    arm.b.rotation.x = -1.25 + a.flare * 0.6;
    arm.c.rotation.x = -0.35;
    if (dead) {
      arm.a.rotation.x = lerp(arm.a.rotation.x, 0.4, dying);
      arm.b.rotation.x = lerp(arm.b.rotation.x, -0.3, dying);
    }
  }

  /* --- tail -------------------------------------------------------- */
  m.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(g * 0.6 - i * 0.6) * (flying ? 0.16 : 0.09 + e.run * 0.12);
    seg.rotation.x = (perched ? 0.35 : (flying ? -0.25 : 0.12)) - (dead ? 0.1 : 0)
      + Math.sin(g * 0.8 - i * 0.5) * 0.05;
  });

  /* throat glow drives the whole emissive set */
  e.glow = (spitting
    ? (bt.phase === 'ant' ? 3.2 * easeIn(bt.k) : bt.phase === 'com' ? 3.4 : 1.2 * (1 - bt.k))
    : 0) + Math.sin(e.stateT * 2.2 + e.animPhase) * 0.18 - (dead ? 0.9 * settled : 0);
}

export const SPITTER = {
  id: 'spitter',
  boundingRadius: 3.0,
  bones,
  build,
  materials,
  attach,
  animate,
  emissiveBase: 2.0,
  ragdoll: [
    { name: 'hips', parent: null, tip: 'spine', radius: 0.2, mass: 9 },
    { name: 'spine', parent: 'hips', tip: 'chest', radius: 0.22, mass: 9 },
    { name: 'chest', parent: 'spine', tip: 'neck', radius: 0.24, mass: 10 },
    { name: 'neck', parent: 'chest', tip: 'head', radius: 0.13, mass: 2.5, cone: 0.7 },
    { name: 'head', parent: 'neck', length: 0.34, radius: 0.13, mass: 3.5, cone: 0.6 },
    { name: 'tail1', parent: 'hips', tip: 'tail3', radius: 0.08, mass: 1.4, cone: 1.0 },
    { name: 'hipL', parent: 'hips', tip: 'kneeL', radius: 0.09, mass: 2.4 },
    { name: 'kneeL', parent: 'hipL', tip: 'footL', radius: 0.07, mass: 1.8 },
    { name: 'hipR', parent: 'hips', tip: 'kneeR', radius: 0.09, mass: 2.4 },
    { name: 'kneeR', parent: 'hipR', tip: 'footR', radius: 0.07, mass: 1.8 },
    { name: 'armAL', parent: 'chest', tip: 'armBL', radius: 0.05, mass: 0.9 },
    { name: 'armAR', parent: 'chest', tip: 'armBR', radius: 0.05, mass: 0.9 },
    { name: 'wingAL', parent: 'chest', tip: 'wingBL', radius: 0.06, mass: 1.6, cone: 1.2 },
    { name: 'wingBL', parent: 'wingAL', tip: 'wingCL', radius: 0.05, mass: 1.1, cone: 1.4 },
    { name: 'wingAR', parent: 'chest', tip: 'wingBR', radius: 0.06, mass: 1.6, cone: 1.2 },
    { name: 'wingBR', parent: 'wingAR', tip: 'wingCR', radius: 0.05, mass: 1.1, cone: 1.4 },
  ],
  acts: {
    /* 0.72 s of sac-swelling wind-up: long enough to break line of sight */
    spit: { id: 'spit', ant: 0.72, com: 0.14, rec: 0.52 },
    swipe: { id: 'swipe', ant: 0.34, com: 0.12, rec: 0.34 },
  },
};
