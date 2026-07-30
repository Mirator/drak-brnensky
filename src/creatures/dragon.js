import * as THREE from 'three';
import {
  loft, boneSegment, spike, membranePanel, place, off, ramp, region,
  glowRegion, paleRegion, boneRegion,
  resetPose, beat, damp, dampAngle, clamp, clamp01, lerp, hump, easeOut, easeIn, smoothstep,
  creatureMaterial,
} from './kit.js';
import { skinSheet, creatureStandard, membraneSheet } from './skin.js';

/* ==================================================================
   DRAK BRNĚNSKÝ.

   The thing hanging in the passage of the Old Town Hall is a crocodile, and
   that is the whole design brief: this is a saurian, not a wyvern. Broad
   flat crocodilian skull with the eyes set high on top, interdigitated
   teeth, a low semi-erect sprawl on four heavy legs, armoured osteoderm
   scutes in paravertebral rows down the back that merge into a double keel
   on the tail, pale belly banding — and then the mythic half: a serpentine
   neck, wings that fold down along the flanks when it is grounded, and a
   throat that heats from the inside before it breathes.
   ================================================================== */

const bones = [
  ['pelvis', null, 0, 2.30, 2.10],
  ['spineA', 'pelvis', 0, 0.10, -1.05],
  ['spineB', 'spineA', 0, 0.06, -1.05],
  ['chest', 'spineB', 0, 0.02, -1.10],
  ['withers', 'chest', 0, 0.06, -0.85],
  ['neckA', 'withers', 0, 0.26, -0.55],
  ['neckB', 'neckA', 0, 0.32, -0.50],
  ['neckC', 'neckB', 0, 0.28, -0.52],
  ['neckD', 'neckC', 0, 0.14, -0.50],
  ['head', 'neckD', 0, 0.02, -0.48],
  ['jaw', 'head', 0, -0.20, -0.18],
  ['throat', 'neckB', 0, -0.30, -0.12],
  ['tailA', 'pelvis', 0, -0.02, 1.00],
  ['tailB', 'tailA', 0, -0.08, 1.00],
  ['tailC', 'tailB', 0, -0.14, 0.95],
  ['tailD', 'tailC', 0, -0.20, 0.90],
  ['tailE', 'tailD', 0, -0.26, 0.85],
  ['tailF', 'tailE', 0, -0.30, 0.80],
  ['tailG', 'tailF', 0, -0.32, 0.75],
];
for (const s of [-1, 1]) {
  const k = s < 0 ? 'L' : 'R';
  bones.push(
    // front limb — sprawled, elbow out
    [`shl${k}`, 'chest', s * 0.62, -0.06, -0.10],
    [`humF${k}`, `shl${k}`, s * 0.42, -0.62, 0.04],
    [`radF${k}`, `humF${k}`, s * 0.16, -0.72, -0.16],
    [`metF${k}`, `radF${k}`, s * 0.06, -0.68, 0.10],
    [`pawF${k}`, `metF${k}`, s * 0.02, -0.34, -0.18],
    // hind limb — heavier, drives the walk
    [`hipH${k}`, 'pelvis', s * 0.70, -0.10, -0.06],
    [`femH${k}`, `hipH${k}`, s * 0.50, -0.78, 0.10],
    [`tibH${k}`, `femH${k}`, s * 0.14, -0.80, -0.24],
    [`metH${k}`, `tibH${k}`, s * 0.04, -0.48, 0.16],
    [`pawH${k}`, `metH${k}`, s * 0.02, -0.12, -0.26],
    // wing — humerus, radius, wrist, finger fan
    [`wingA${k}`, 'withers', s * 0.55, 0.30, 0.35],
    [`wingB${k}`, `wingA${k}`, s * 2.30, 0.55, 0.30],
    [`wingC${k}`, `wingB${k}`, s * 2.40, -0.30, 0.10],
    [`wingD${k}`, `wingC${k}`, s * 1.50, -1.10, 0.50],
  );
}

/* ------------------------------------------------------------------ */
function build(pb, tpl) {
  const R = tpl.rest;

  /* ---- trunk: one heavy loft, deep-chested, hips high ---- */
  pb.add(region(loft(
    [off(R.withers, 0, 0.05, -0.25), R.chest, R.spineB, R.spineA, R.pelvis, off(R.tailA, 0, 0, 0.25)],
    {
      tubular: 26,
      radial: 16,
      radius: ramp([[0, 0.52], [0.18, 0.80], [0.45, 0.86], [0.72, 0.82], [1, 0.52]]),
      squash: ramp([[0, 0.92], [0.5, 0.84], [1, 0.94]]),
    },
  ), 0.02, 0.02, 0.72, 0.66), ['withers', 'chest', 'spineB', 'spineA', 'pelvis', 'tailA'], 'body');

  /* pale banded belly — crocodile plastron */
  pb.add(paleRegion(loft(
    [off(R.chest, 0, -0.55, -0.30), off(R.spineB, 0, -0.72, 0), off(R.spineA, 0, -0.70, 0), off(R.pelvis, 0, -0.58, 0.20)],
    { tubular: 12, radial: 8, radius: ramp([[0, 0.28], [0.5, 0.44], [1, 0.26]]), squash: 0.3 },
  )), ['chest', 'spineB', 'spineA', 'pelvis'], 'body');

  /* transverse belly bands — the give-away crocodile detail */
  {
    const chain = ['chest', 'spineB', 'spineA', 'pelvis'];
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const z = lerp(R.chest.z - 0.2, R.pelvis.z + 0.25, t);
      const bone = chain[Math.min(chain.length - 1, Math.floor(t * chain.length))];
      const width = 0.62 - Math.abs(t - 0.5) * 0.4;
      const g = new THREE.BoxGeometry(width * 2, 0.1, 0.16);
      pb.add(paleRegion(place(g, 0, lerp(R.chest.y - 0.86, R.pelvis.y - 0.82, t), z)), bone, 'detail');
    }
  }

  /* ---- serpentine neck ---- */
  pb.add(region(loft(
    [off(R.withers, 0, 0.10, -0.20), R.neckA, R.neckB, R.neckC, R.neckD, off(R.head, 0, 0.02, 0.10)],
    {
      tubular: 20,
      radial: 14,
      radius: ramp([[0, 0.50], [0.35, 0.38], [0.7, 0.32], [1, 0.28]]),
      squash: ramp([[0, 0.95], [1, 0.88]]),
    },
  ), 0.04, 0.68, 0.44, 0.99), ['withers', 'neckA', 'neckB', 'neckC', 'neckD', 'head'], 'body');
  /* throat sac — heats up from inside before a breath */
  const sac = new THREE.SphereGeometry(0.30, 12, 9);
  sac.scale(1.05, 0.85, 1.5);
  pb.add(glowRegion(place(sac, R.throat.x, R.throat.y + 0.05, R.throat.z)), 'throat', 'body');

  /* ---- crocodilian skull ---- */
  pb.add(region(loft(
    [off(R.head, 0, 0.06, 0.26), R.head, off(R.head, 0, -0.02, -0.42), off(R.head, 0, -0.02, -0.90), off(R.head, 0, 0.01, -1.24)],
    {
      tubular: 10,
      radial: 12,
      radius: ramp([[0, 0.30], [0.22, 0.46], [0.5, 0.33], [0.82, 0.28], [1, 0.16]]),
      squash: ramp([[0, 0.72], [0.35, 0.52], [1, 0.42]]),
    },
  ), 0.44, 0.7, 0.72, 0.99), 'head', 'body');
  /* lower jaw, same flat plan */
  pb.add(region(loft(
    [off(R.jaw, 0, 0.04, 0.24), R.jaw, off(R.jaw, 0, 0.01, -0.48), off(R.jaw, 0, 0.02, -1.02)],
    {
      tubular: 8,
      radial: 10,
      radius: ramp([[0, 0.24], [0.3, 0.34], [0.7, 0.26], [1, 0.13]]),
      squash: ramp([[0, 0.5], [1, 0.38]]),
    },
  ), 0.44, 0.34, 0.72, 0.64), 'jaw', 'body');
  /* raised nostrils and the bony ridge over the snout */
  for (const s of [-1, 1]) {
    pb.add(region(place(new THREE.SphereGeometry(0.075, 6, 5), R.head.x + s * 0.075, R.head.y + 0.11, R.head.z - 1.16), 0.5, 0.5, 0.6, 0.6), 'head', 'body');
    // eyes sit high on the skull, like a crocodile watching the waterline
    pb.add(glowRegion(place(new THREE.SphereGeometry(0.10, 8, 6), R.head.x + s * 0.20, R.head.y + 0.20, R.head.z - 0.24)), 'head', 'body');
    pb.add(region(place(spike(0.11, 0.34, { radial: 5, rings: 2, curve: -0.3 }),
      R.head.x + s * 0.22, R.head.y + 0.24, R.head.z - 0.10, -0.9, 0, s * 0.35), 0.5, 0.6, 0.62, 0.72), 'head', 'detail');
    // swept back horns — the mythic half of the design
    pb.add(boneRegion(place(spike(0.13, 1.15, { radial: 6, rings: 4, curve: 0.55 }),
      R.head.x + s * 0.26, R.head.y + 0.22, R.head.z + 0.24, -0.55, 0, s * 0.42)), 'head', 'detail');
    pb.add(boneRegion(place(spike(0.08, 0.55, { radial: 5, rings: 3, curve: 0.3 }),
      R.head.x + s * 0.34, R.head.y - 0.02, R.head.z + 0.16, 0.1, 0, s * 1.15)), 'head', 'detail');
    // jaw cheek scutes
    pb.add(region(place(spike(0.09, 0.26, { radial: 4, rings: 2 }),
      R.jaw.x + s * 0.26, R.jaw.y + 0.04, R.jaw.z - 0.40, 0, 0, s * 1.5), 0.46, 0.36, 0.56, 0.46), 'jaw', 'detail');
  }
  /* interdigitated teeth — the crocodile read */
  for (let i = 0; i < 9; i++) {
    for (const s of [-1, 1]) {
      const t = i / 8;
      const z = R.head.z - 0.28 - i * 0.11;
      const w = lerp(0.28, 0.14, t);
      const size = i === 1 || i === 4 ? 0.055 : 0.036;
      pb.add(boneRegion(place(spike(size, size * 5.2, { radial: 4, rings: 2 }),
        s * w, R.head.y - 0.16 - Math.abs(Math.sin(i)) * 0.01, z, Math.PI, 0, 0)), 'head', 'detail');
      if (i < 8) {
        pb.add(boneRegion(place(spike(size * 0.92, size * 4.6, { radial: 4, rings: 2 }),
          s * (w - 0.012), R.jaw.y + 0.10, z - 0.055)), 'jaw', 'detail');
      }
    }
  }
  /* the furnace at the back of the throat */
  const maw = new THREE.SphereGeometry(0.24, 10, 8);
  pb.add(glowRegion(place(maw, 0, R.jaw.y + 0.16, R.jaw.z - 0.30)), 'jaw', 'body');

  /* ---- armoured back: paravertebral scute rows + keel ---- */
  const spineRow = ['neckC', 'neckB', 'neckA', 'withers', 'chest', 'spineB', 'spineA', 'pelvis',
    'tailA', 'tailB', 'tailC', 'tailD', 'tailE', 'tailF', 'tailG'];
  spineRow.forEach((name, i) => {
    const t = i / (spineRow.length - 1);
    const onNeck = i < 3;
    const onTail = i >= 8;
    const top = R[name].y + (onNeck ? 0.30 : onTail ? 0.28 : 0.80);
    const keel = spike(onNeck ? 0.14 : 0.22 - t * 0.06, onNeck ? 0.34 : 0.62 - t * 0.16, { radial: 5, rings: 3 });
    keel.scale(0.42, 1, 1.15);
    pb.add(boneRegion(place(keel, 0, top, R[name].z, -0.35 + t * 0.25, 0, 0)), name, 'detail');
    // paravertebral rows: two flatter osteoderms either side of the keel
    if (!onNeck) {
      for (const s of [-1, 1]) {
        const plate = spike(0.26 - t * 0.08, 0.30 - t * 0.10, { radial: 5, rings: 2 });
        plate.scale(1, 1, 1.5);
        pb.add(region(place(plate,
          s * (0.42 - t * 0.14), top - 0.22, R[name].z,
          -0.2, 0, s * 0.75), 0.06, 0.06, 0.34, 0.3), name, 'detail');
      }
    }
  });
  /* flank vents — they glow when the furnace is lit */
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const names = ['chest', 'spineB', 'spineA', 'pelvis'];
      const g = new THREE.BoxGeometry(0.1, 0.26, 0.7);
      pb.add(glowRegion(place(g, s * 0.80, R[names[i]].y - 0.34, R[names[i]].z, 0, 0, s * 0.2)), names[i], 'detail');
    }
  }

  /* ---- heavy tail ---- */
  pb.add(region(loft(
    [R.pelvis, R.tailA, R.tailB, R.tailC, R.tailD, R.tailE, R.tailF, R.tailG, off(R.tailG, 0, -0.12, 0.70)],
    {
      tubular: 30,
      radial: 13,
      radius: ramp([[0, 0.52], [0.18, 0.44], [0.45, 0.32], [0.75, 0.18], [1, 0.05]]),
      squash: ramp([[0, 0.95], [0.5, 1.15], [1, 1.35]]),
    },
  ), 0.02, 0.06, 0.6, 0.6), ['pelvis', 'tailA', 'tailB', 'tailC', 'tailD', 'tailE', 'tailF', 'tailG'], 'body');

  /* ---- legs ---- */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const front = [`shl${k}`, `humF${k}`, `radF${k}`, `metF${k}`, `pawF${k}`];
    const hind = [`hipH${k}`, `femH${k}`, `tibH${k}`, `metH${k}`, `pawH${k}`];
    const limb = (chain, radii) => {
      for (let i = 0; i < chain.length - 1; i++) {
        pb.add(region(boneSegment(R[chain[i]], R[chain[i + 1]], radii[i], radii[i + 1],
          { radial: 9, rings: 2, cap0: 0.55 }), 0.06 + (i % 2) * 0.28, 0.06 + Math.floor(i / 2) * 0.28, 0.32 + (i % 2) * 0.28, 0.32 + Math.floor(i / 2) * 0.28), chain[i], 'body');
      }
      const paw = chain[chain.length - 1];
      // splayed toes with big claws
      for (let c = -2; c <= 2; c++) {
        const spread = c * 0.16;
        const fwd = -0.42 + Math.abs(c) * 0.10;
        const toe = off(R[paw], spread, 0.02, fwd);
        pb.add(paleRegion(boneSegment(off(R[paw], spread * 0.35, 0.08, 0), toe, 0.10, 0.06,
          { radial: 5, rings: 1, cap0: 0.5, cap1: 0.4 })), paw, 'body');
        pb.add(boneRegion(place(spike(0.05, 0.26, { radial: 4, rings: 2, curve: 0.35 }),
          toe.x, toe.y + 0.02, toe.z - 0.06, -1.35, 0, 0)), paw, 'detail');
      }
    };
    limb(front, [0.34, 0.30, 0.26, 0.22, 0.20]);
    limb(hind, [0.46, 0.40, 0.32, 0.26, 0.22]);
    // thigh muscle mass
    const thigh = new THREE.SphereGeometry(0.42, 9, 7);
    thigh.scale(0.85, 1.1, 1.25);
    pb.add(region(place(thigh, R[`hipH${k}`].x + s * 0.18, R[`hipH${k}`].y - 0.24, R[`hipH${k}`].z + 0.06), 0.06, 0.06, 0.4, 0.4), `hipH${k}`, 'body');
  }

  /* ---- wings ---- */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const A = R[`wingA${k}`];
    const B = R[`wingB${k}`];
    const C = R[`wingC${k}`];
    const D = R[`wingD${k}`];
    pb.add(region(boneSegment(A, B, 0.20, 0.15, { radial: 8, rings: 2, cap0: 0.6 }), 0.06, 0.06, 0.3, 0.28), `wingA${k}`, 'body');
    pb.add(region(boneSegment(B, C, 0.15, 0.11, { radial: 7, rings: 2, cap0: 0.6 }), 0.3, 0.06, 0.54, 0.28), `wingB${k}`, 'body');
    pb.add(region(boneSegment(C, D, 0.11, 0.06, { radial: 6, rings: 2, cap0: 0.6 }), 0.06, 0.3, 0.3, 0.5), `wingC${k}`, 'body');
    pb.add(boneRegion(place(spike(0.07, 0.5, { radial: 5, rings: 2, curve: 0.3 }),
      C.x, C.y + 0.10, C.z - 0.06, -1.1, 0, s * 0.4)), `wingC${k}`, 'detail');

    const fingers = [
      [D.x + s * 0.35, D.y - 0.35, D.z + 0.55],
      [C.x + s * 1.05, C.y - 2.35, C.z + 1.35],
      [C.x + s * 0.25, C.y - 2.30, C.z + 2.15],
    ];
    fingers.forEach((f, i) => {
      pb.add(region(boneSegment(i === 0 ? D : C, new THREE.Vector3(f[0], f[1], f[2]), 0.08, 0.03,
        { radial: 5, rings: 3 }), 0.3, 0.3, 0.5, 0.5), i === 0 ? `wingD${k}` : `wingC${k}`, 'body');
    });

    const weights = (x) => {
      const ax = Math.abs(x);
      const aA = Math.abs(A.x);
      const aB = Math.abs(B.x);
      const aC = Math.abs(C.x);
      if (ax <= aB) {
        const f = clamp01((ax - aA) / Math.max(0.01, aB - aA));
        return [[`wingA${k}`, 1 - f], [`wingB${k}`, f]];
      }
      const f = clamp01((ax - aB) / Math.max(0.01, aC - aB));
      return [[`wingB${k}`, 1 - f], [`wingC${k}`, f * 0.72], [`wingD${k}`, f * 0.28]];
    };

    const armLead = [[A.x, A.y, A.z], [B.x, B.y + 0.06, B.z], [C.x, C.y, C.z]];
    const armTrail = [
      [A.x * 0.35, A.y - 1.15, A.z + 0.85],
      [B.x * 0.9, B.y - 1.9, B.z + 1.25],
      [fingers[2][0], fingers[2][1], fingers[2][2]],
    ];
    pb.add(region(membranePanel(armLead, armTrail, 7, 5), 0.02, 0.02, 0.96, 0.5), weights, 'membrane');

    const handLead = [[C.x, C.y, C.z], [(C.x + D.x) / 2, (C.y + D.y) / 2 + 0.06, (C.z + D.z) / 2], [D.x, D.y, D.z]];
    const handTrail = [
      [C.x, C.y - 0.06, C.z + 0.12],
      [fingers[1][0], fingers[1][1], fingers[1][2]],
      [fingers[0][0], fingers[0][1], fingers[0][2]],
    ];
    pb.add(region(membranePanel(handLead, handTrail, 6, 4), 0.04, 0.52, 0.9, 0.98), weights, 'membrane');
  }
}

/* ------------------------------------------------------------------ */
function materials() {
  const sheet = () => skinSheet({
    seed: 0x3f4a,
    pattern: 'plates',
    palette: {
      light: '#6e7448', dark: '#2b3320', mortar: '#151a10', mortarH: 38,
      pale: '#a99a6f', paleSpeck: '#7c7048', bone: '#d8cba8',
      cell: 44, jitter: 0.26, round: 0.15, crown: 0.14, bandFreq: 0.7, bandWeight: 0.45,
    },
    glow: { hot: '#fff4d0', mid: '#ff6a18', cool: '#2e0a02' },
    relief: { strength: 3.2, roughBase: 0.72, roughVar: 0.26 },
  });
  return {
    body: creatureMaterial('dragon-scute', () => creatureStandard(sheet(), {
      emissive: 0xff5a1a, emissiveIntensity: 2.6, roughness: 1, metalness: 0.05, normalScale: 1.35,
    })),
    membrane: creatureMaterial('wing-membrane', () => creatureStandard(membraneSheet(), {
      color: 0x6a3a30, emissive: 0x220802, emissiveIntensity: 0.5,
      roughness: 1, metalness: 0, side: THREE.DoubleSide, normalScale: 1.0,
    }), { tint: 'dragon' }),
  };
}

function attach(model) {
  const b = model.bones;
  model.neck = [b.neckA, b.neckB, b.neckC, b.neckD, b.head];
  model.tail = [b.tailA, b.tailB, b.tailC, b.tailD, b.tailE, b.tailF, b.tailG];
  model.spine = [b.pelvis, b.spineA, b.spineB, b.chest, b.withers];
  model.wings = [];
  model.legs = [];
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    model.wings.push({ a: b[`wingA${k}`], b: b[`wingB${k}`], c: b[`wingC${k}`], d: b[`wingD${k}`], side: s });
    model.legs.push({
      root: b[`shl${k}`], a: b[`humF${k}`], b: b[`radF${k}`], c: b[`metF${k}`], paw: b[`pawF${k}`],
      side: s, front: true, phase: s < 0 ? 0 : Math.PI,
    });
    model.legs.push({
      root: b[`hipH${k}`], a: b[`femH${k}`], b: b[`tibH${k}`], c: b[`metH${k}`], paw: b[`pawH${k}`],
      side: s, front: false, phase: (s < 0 ? Math.PI : 0),
    });
  }
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
  const dead = e.state === 'dead';
  const airborne = e.flying && !dead;
  const exhausted = e.state === 'exhausted';
  const dying = dead ? clamp01(e.stateT / 2.2) : 0;

  e.gait += dt * (airborne ? 2.0 + (1 - (e.soar ?? 0)) * 1.6 : 1.2 + e.run * 2.6);
  const g = e.gait;

  /* ---------- posture blends ---------- */
  const rear = a.rear ?? 0;               // reared up on the hind legs
  let rearTarget = 0;
  let pitch = 0;
  let sink = 0;
  let twist = 0;

  if (bt.id === 'buffet') {
    if (bt.phase === 'ant') { rearTarget = smoothstep(0, 0.9, bt.k) * 0.85; pitch = -0.22 * bt.k; }
    else if (bt.phase === 'com') { rearTarget = 0.85 * (1 - easeIn(bt.k)); pitch = 0.25 * bt.k; }
    else { sink = 0.35 * (1 - bt.k); }
  } else if (bt.id === 'phase') {
    // the phase-2 transition is a set piece: rear, wings wide, then slam
    if (bt.phase === 'ant') { rearTarget = smoothstep(0, 0.7, bt.k); pitch = -0.4 * bt.k; }
    else if (bt.phase === 'com') { rearTarget = 1 - easeIn(bt.k); pitch = 0.35; }
    else { sink = 0.5 * (1 - bt.k); }
  } else if (bt.id === 'tail') {
    twist = bt.phase === 'ant' ? smoothstep(0, 1, bt.k) * 0.55
      : bt.phase === 'com' ? lerp(0.55, -0.75, easeOut(bt.k))
        : -0.75 * (1 - easeIn(bt.k));
    sink = bt.phase === 'ant' ? 0.3 * bt.k : 0.25;
  } else if (bt.id === 'charge') {
    if (bt.phase === 'ant') { pitch = -0.18 + 0.34 * bt.k; sink = 0.35 * bt.k; }
    else if (bt.phase === 'com') pitch = 0.16;
    else pitch = 0.3 * (1 - bt.k);
  } else if (bt.id === 'bite') {
    pitch = bt.phase === 'ant' ? -0.12 * bt.k : bt.phase === 'com' ? 0.20 : 0.1 * (1 - bt.k);
  } else if (bt.id === 'land') {
    sink = bt.phase === 'com' ? 0.8 : bt.phase === 'rec' ? 0.8 * (1 - easeOut(bt.k)) : 0;
  } else if (bt.id === 'takeoff') {
    // coil down onto the haunches, then throw itself upwards
    sink = bt.phase === 'ant' ? 0.55 * smoothstep(0, 1, bt.k) : 0.55 * (1 - easeOut(bt.k));
    pitch = bt.phase === 'ant' ? 0.12 * bt.k : -0.28;
  }
  a.rear = damp(a.rear, dead ? 0 : rearTarget, 9, dt);
  a.pitch = damp(a.pitch, pitch, 10, dt);
  a.sink = damp(a.sink, sink + (exhausted ? 0.45 : 0), 7, dt);
  a.twist = damp(a.twist, twist, 12, dt);

  const stagger = e.stagger > 0 ? clamp01(e.stagger / 0.9) : 0;
  const flinch = e.flinch > 0 ? clamp01(e.flinch / 0.4) : 0;

  /* ---------- trunk ---------- */
  const walkBob = airborne ? Math.sin(g) * 0.28 : Math.abs(Math.sin(g * 2)) * 0.07 * (0.4 + e.run);
  b.pelvis.position.y += walkBob - a.sink * 0.8 + a.rear * 0.55 - dying * 1.5 * easeOut(dying);
  b.pelvis.rotation.x = a.pitch - a.rear * 0.55 + (airborne ? -0.12 - e.climb * 0.3 : e.run * 0.06)
    + flinch * e.flinchZ * 0.14 + dying * 0.35;
  b.pelvis.rotation.z = Math.sin(g) * (airborne ? 0.05 : 0.07 * (0.3 + e.run))
    + flinch * e.flinchX * 0.16 + stagger * e.flinchX * 0.22 - dying * 0.55 * easeOut(dying) * e.deathSide;
  b.pelvis.rotation.y = a.twist * 0.35 - Math.sin(g) * 0.05 * e.run;

  m.spine.forEach((seg, i) => {
    if (i === 0) return;
    const t = i / (m.spine.length - 1);
    seg.rotation.y = a.twist * 0.25 + Math.sin(g - i * 0.5) * 0.035 * (0.3 + e.run);
    seg.rotation.x = a.rear * 0.28 * (1 - t * 0.4) + a.pitch * 0.15 + dying * 0.18
      + (bt.id === 'bite' && bt.phase === 'com' ? 0.08 : 0);
    seg.rotation.z = -b.pelvis.rotation.z * 0.25;
  });

  /* ---------- neck: serpentine, head stabilised on target ---------- */
  const headYaw = dead ? 0 : clamp(e.look.yaw, -1.3, 1.3);
  const headPitch = dead ? 0 : clamp(e.look.pitch, -0.8, 0.9);
  a.headYaw = dampAngle(a.headYaw, headYaw, 6, dt);
  a.headPitch = damp(a.headPitch, headPitch, 6, dt);

  let neckCoil = 0;      // pulls the head back over the shoulders
  let neckThrust = 0;    // shoots it forward
  if (bt.id === 'breath') {
    if (bt.phase === 'ant') neckCoil = smoothstep(0, 0.8, bt.k);
    else if (bt.phase === 'com') { neckCoil = 0.55; neckThrust = 0.35; }
    else neckCoil = 0.2 * (1 - bt.k);
  } else if (bt.id === 'bite') {
    if (bt.phase === 'ant') neckCoil = smoothstep(0, 0.9, bt.k);
    else if (bt.phase === 'com') neckThrust = easeOut(bt.k);
    else neckThrust = 0.4 * (1 - easeIn(bt.k));
  } else if (bt.id === 'fan') {
    neckCoil = bt.phase === 'ant' ? bt.k * 0.35 : 0.2;
  } else if (bt.id === 'phase' || bt.id === 'buffet') {
    neckCoil = bt.phase === 'ant' ? -0.5 * bt.k : 0; // throws the head skyward
  }
  a.coil = damp(a.coil, neckCoil, 11, dt);
  a.thrust = damp(a.thrust, neckThrust, 18, dt);

  const exhaustDrop = exhausted ? 1 : 0;
  a.drop = damp(a.drop, exhaustDrop, 4, dt);
  m.neck.forEach((seg, i) => {
    const t = i / (m.neck.length - 1);
    const wave = Math.sin(g * 0.6 - i * 0.55) * 0.05 * (0.4 + e.run * 0.6);
    seg.rotation.x = (i === 0 ? -0.12 : -0.04) + a.coil * (0.34 - t * 0.1) - a.thrust * (0.4 - t * 0.12)
      + a.headPitch * 0.18 + wave * 0.6
      + a.drop * (0.42 - t * 0.06) + dying * (0.4 - t * 0.05)
      - a.rear * 0.15;
    seg.rotation.y = a.headYaw * (0.22 + t * 0.08) + wave;
    seg.rotation.z = -b.pelvis.rotation.z * 0.15 * (1 - t);
  });
  // the head itself counter-rotates so the eyes hold the player
  b.head.rotation.x = -a.coil * 0.5 + a.thrust * 0.4 + a.headPitch * 0.5 + a.drop * 0.3
    - b.pelvis.rotation.x * 0.5 + dying * 0.4;
  b.head.rotation.y = a.headYaw * 0.3;

  /* jaw: gapes for the breath, snaps for the bite, hangs when exhausted */
  let jaw = 0.04 + (airborne ? 0.05 : 0);
  if (bt.id === 'breath') {
    jaw = bt.phase === 'ant' ? 0.1 + smoothstep(0.5, 1, bt.k) * 0.5
      : bt.phase === 'com' ? 1.0 : 0.5 * (1 - bt.k);
  } else if (bt.id === 'bite') {
    jaw = bt.phase === 'ant' ? smoothstep(0.2, 1, bt.k) * 0.95
      : bt.phase === 'com' ? 0.95 * (1 - easeIn(clamp01(bt.k * 1.6))) : 0.15 * (1 - bt.k);
  } else if (bt.id === 'fan') {
    jaw = bt.phase === 'ant' ? 0.25 + Math.abs(Math.sin(bt.k * 12)) * 0.25 : 0.7;
  } else if (bt.id === 'phase') {
    jaw = 1.0;
  }
  if (exhausted) jaw = Math.max(jaw, 0.45 + Math.sin(e.stateT * 7) * 0.12);
  if (dead) jaw = 0.55 * dying;
  a.jaw = damp(a.jaw, jaw, 16, dt);
  b.jaw.rotation.x = -a.jaw;

  const sacScale = 1 + (bt.id === 'breath'
    ? (bt.phase === 'ant' ? easeIn(bt.k) * 0.7 : bt.phase === 'com' ? 0.75 : 0.3 * (1 - bt.k))
    : 0);
  a.sac = damp(a.sac ?? 1, sacScale, 14, dt);
  b.throat.scale.setScalar(a.sac);

  /* ---------- tail: mass, counter-swing, and the sweep ---------- */
  const sweepPhase = bt.id === 'tail'
    ? (bt.phase === 'ant' ? smoothstep(0, 1, bt.k) : bt.phase === 'com' ? lerp(1, -1.35, easeOut(bt.k)) : -1.35 * (1 - easeIn(bt.k)))
    : 0;
  m.tail.forEach((seg, i) => {
    const t = i / (m.tail.length - 1);
    const lag = i * 0.45;
    const idle = Math.sin(g * 0.55 - lag) * (0.06 + e.run * 0.12 + (airborne ? 0.05 : 0));
    seg.rotation.y = idle - b.pelvis.rotation.y * 0.5 + sweepPhase * (0.34 - t * 0.12) * e.sweepSide;
    seg.rotation.x = (airborne ? -0.02 : 0.03) + Math.sin(g * 0.7 - lag) * 0.03
      + a.rear * 0.12 + (dead ? 0.02 : 0) - (bt.id === 'charge' ? 0.05 : 0);
    if (dead) seg.rotation.y *= 1 - clamp01((e.stateT - 1.2) / 1.2);
  });

  /* ---------- wings ---------- */
  const spread = airborne ? 1
    : bt.id === 'buffet' ? (bt.phase === 'ant' ? smoothstep(0, 0.8, bt.k) : bt.phase === 'com' ? 1 - easeIn(bt.k) * 0.6 : 0.3 * (1 - bt.k))
      : bt.id === 'phase' ? (bt.phase === 'rec' ? 1 - bt.k : 1)
        : bt.id === 'land' ? (bt.phase === 'ant' ? 1 : 1 - easeOut(bt.k))
          : bt.id === 'takeoff' ? (bt.phase === 'ant' ? smoothstep(0.3, 1, bt.k) : 1)
            : 0;
  a.spread = damp(a.spread, dead ? 0.15 : spread, bt.id === 'buffet' && bt.phase === 'com' ? 26 : 6, dt);
  const flapPower = airborne ? (1 - (e.soar ?? 0) * 0.8) : 0;
  const beatUp = Math.sin(g) * flapPower + (bt.id === 'buffet' && bt.phase === 'com' ? -1.6 * easeIn(bt.k) : 0);

  for (const w of m.wings) {
    const s = w.side;
    // folded: humerus swept back and down along the flank, elbow/wrist tucked
    w.a.rotation.z = s * lerp(-1.15, 0.18 + beatUp * 0.62, a.spread);
    w.a.rotation.y = s * lerp(1.05, 0.10, a.spread);
    w.a.rotation.x = lerp(0.35, -0.10 + beatUp * 0.22, a.spread);
    w.b.rotation.z = -s * lerp(2.35, 0.22 - beatUp * 0.34, a.spread);
    w.b.rotation.y = -s * lerp(0.75, 0.04, a.spread);
    w.c.rotation.z = -s * lerp(1.85, 0.06 + beatUp * 0.26, a.spread);
    w.d.rotation.z = -s * lerp(1.05, -0.12 - beatUp * 0.22, a.spread);
    w.d.rotation.x = lerp(0.4, beatUp * 0.3, a.spread);
    if (dead) w.b.rotation.z += -s * 0.6 * dying;
  }

  /* ---------- legs ---------- */
  for (const leg of m.legs) {
    const ph = g + leg.phase + (leg.front ? 0.55 : 0);
    const raw = Math.sin(ph);
    const swing = Math.max(0, raw);
    const stride = (0.3 + e.run * 0.9) * (leg.front ? 0.85 : 1);
    let root = raw * stride * 0.32;
    let up = -0.1 - swing * stride * 0.55;
    let mid = 0.18 + swing * stride * 0.4;
    let low = -0.1 - swing * stride * 0.2;

    if (airborne) {
      root = -0.15;
      up = leg.front ? -0.9 : -0.7;
      mid = 1.5;
      low = -0.9;
    }
    if (a.rear > 0.02) {
      // front legs come off the ground, hind legs brace hard
      if (leg.front) {
        root = lerp(root, 1.5, a.rear);
        up = lerp(up, -1.1, a.rear);
        mid = lerp(mid, 0.9, a.rear);
      } else {
        root = lerp(root, -0.35, a.rear);
        up = lerp(up, 0.35, a.rear);
        mid = lerp(mid, -0.2, a.rear);
      }
    }
    if (exhausted) {
      root = lerp(root, leg.front ? 0.35 : -0.2, 0.6);
      up = lerp(up, -0.5, 0.5);
      mid = lerp(mid, 0.6, 0.5);
    }
    if (dead) {
      const buckle = easeOut(clamp01((e.stateT - (leg.front ? 0 : 0.35)) / 0.8));
      root = lerp(root, leg.front ? 0.7 : -0.5, buckle);
      up = lerp(up, -1.5, buckle);
      mid = lerp(mid, 1.3, buckle);
    }

    leg.root.rotation.x = root;
    leg.root.rotation.z = leg.side * (0.12 + e.run * 0.06);
    leg.a.rotation.x = up;
    leg.b.rotation.x = mid;
    leg.c.rotation.x = low;
    leg.paw.rotation.x = -low * 0.6;

    // a footfall you can feel: dust ring plus a shake through the VFX
    const planted = raw < -0.92;
    if (planted && !leg.planted && !airborne && !dead) {
      leg.planted = true;
      if (ctx.vfx) {
        ctx.vfx.burst(
          ctx.scratch.set(e.pos.x + leg.side * 1.6 * e.scale, e.pos.y + 0.1, e.pos.z + (leg.front ? -1.6 : 2.2) * e.scale),
          0x8a7a5c, 9, 3.4, { size: 0.5, life: 0.7, drag: 4, up: 1.2, grav: -1.4 },
        );
      }
    } else if (raw > 0) leg.planted = false;
  }

  /* ---------- furnace glow ---------- */
  let glow = 0.35 + Math.sin(e.stateT * 1.4 + e.animPhase) * 0.2;
  if (bt.id === 'breath') {
    glow += bt.phase === 'ant' ? 4.2 * easeIn(bt.k) : bt.phase === 'com' ? 4.6 : 1.6 * (1 - bt.k);
  } else if (bt.id === 'fan') {
    glow += bt.phase === 'ant' ? 1.4 + Math.abs(Math.sin(bt.k * 14)) * 1.6 : 2.2;
  } else if (bt.id === 'phase') {
    glow += 3.4 + Math.abs(Math.sin(bt.k * 20)) * 2;
  }
  if (e.phase2) glow += 0.9;
  if (exhausted) glow -= 0.55 - Math.sin(e.stateT * 6) * 0.15;   // the furnace gutters out
  if (dead) glow -= 1.6 * clamp01(e.stateT / 2.5);
  e.glow = glow;
}

export const DRAGON = {
  id: 'boss',
  boundingRadius: 12,
  bones,
  build,
  materials,
  attach,
  animate,
  emissiveBase: 2.6,
  /* 23 driver bones out of 47: the rest follow their parents. Radii and
   * masses are bind-space metres / kg — scale them by e.scale (1.45). */
  ragdoll: [
    { name: 'pelvis', parent: null, tip: 'spineA', radius: 0.8, mass: 900 },
    { name: 'spineA', parent: 'pelvis', tip: 'spineB', radius: 0.85, mass: 900 },
    { name: 'spineB', parent: 'spineA', tip: 'chest', radius: 0.85, mass: 900 },
    { name: 'chest', parent: 'spineB', tip: 'withers', radius: 0.75, mass: 800 },
    { name: 'withers', parent: 'chest', tip: 'neckA', radius: 0.55, mass: 400, cone: 0.5 },
    { name: 'neckA', parent: 'withers', tip: 'neckC', radius: 0.4, mass: 220, cone: 0.7 },
    { name: 'neckC', parent: 'neckA', tip: 'head', radius: 0.33, mass: 180, cone: 0.7 },
    { name: 'head', parent: 'neckC', length: 1.25, radius: 0.4, mass: 260, cone: 0.6 },
    { name: 'tailA', parent: 'pelvis', tip: 'tailC', radius: 0.45, mass: 260, cone: 1.0 },
    { name: 'tailC', parent: 'tailA', tip: 'tailE', radius: 0.3, mass: 150, cone: 1.1 },
    { name: 'tailE', parent: 'tailC', tip: 'tailG', radius: 0.16, mass: 70, cone: 1.2 },
    { name: 'shlL', parent: 'chest', tip: 'radFL', radius: 0.3, mass: 180 },
    { name: 'radFL', parent: 'shlL', tip: 'pawFL', radius: 0.24, mass: 130 },
    { name: 'shlR', parent: 'chest', tip: 'radFR', radius: 0.3, mass: 180 },
    { name: 'radFR', parent: 'shlR', tip: 'pawFR', radius: 0.24, mass: 130 },
    { name: 'hipHL', parent: 'pelvis', tip: 'tibHL', radius: 0.4, mass: 260 },
    { name: 'tibHL', parent: 'hipHL', tip: 'pawHL', radius: 0.28, mass: 170 },
    { name: 'hipHR', parent: 'pelvis', tip: 'tibHR', radius: 0.4, mass: 260 },
    { name: 'tibHR', parent: 'hipHR', tip: 'pawHR', radius: 0.28, mass: 170 },
    { name: 'wingAL', parent: 'withers', tip: 'wingBL', radius: 0.2, mass: 90, cone: 1.2 },
    { name: 'wingBL', parent: 'wingAL', tip: 'wingCL', radius: 0.15, mass: 60, cone: 1.4 },
    { name: 'wingAR', parent: 'withers', tip: 'wingBR', radius: 0.2, mass: 90, cone: 1.2 },
    { name: 'wingBR', parent: 'wingAR', tip: 'wingCR', radius: 0.15, mass: 60, cone: 1.4 },
  ],
  acts: {
    bite: { id: 'bite', ant: 0.62, com: 0.16, rec: 0.55 },
    tail: { id: 'tail', ant: 0.72, com: 0.30, rec: 0.62 },
    buffet: { id: 'buffet', ant: 0.95, com: 0.28, rec: 0.75 },
    charge: { id: 'charge', ant: 1.05, com: 1.60, rec: 0.85 },
    breath: { id: 'breath', ant: 0.95, com: 1.90, rec: 0.55 },
    fan: { id: 'fan', ant: 0.70, com: 0.22, rec: 0.50 },
    land: { id: 'land', ant: 0.45, com: 0.20, rec: 0.85 },
    takeoff: { id: 'takeoff', ant: 0.55, com: 0.25, rec: 0.55 },
    phase: { id: 'phase', ant: 1.30, com: 0.35, rec: 0.85 },
  },
};
