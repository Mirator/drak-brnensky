import * as THREE from 'three';
import { Rng } from '../rng.js';
import {
  block, spike, place, region, glowRegion, boneRegion,
  resetPose, beat, damp, dampAngle, clamp, clamp01, lerp, easeOut, easeIn, smoothstep,
  creatureMaterial,
} from './kit.js';
import { skinSheet, creatureStandard } from './skin.js';

/* ==================================================================
   KAMENNÝ GOLEM — sandstone masonry walking.

   Built out of real courses of blocks with real gaps between them, wrapped
   around a glowing core you can see burning through the joints. It shields
   its core with its forearms while it closes, telegraphs an overhead slam
   for the best part of a second, and sheds armour plates as it takes
   damage until the core is wide open.
   ================================================================== */

const bones = [
  ['hips', null, 0, 1.50, 0],
  ['spine', 'hips', 0, 0.26, -0.02],
  ['chest', 'spine', 0, 0.30, 0],
  ['core', 'chest', 0, -0.06, -0.10],
  ['head', 'chest', 0, 0.40, -0.02],
  // breakable armour — each plate gets its own bone so it can be thrown off
  ['plateChest', 'chest', 0, 0.02, -0.30],
  ['plateBack', 'spine', 0, 0.06, 0.30],
  ['plateHip', 'hips', 0, -0.10, 0],
];
for (const s of [-1, 1]) {
  const k = s < 0 ? 'L' : 'R';
  bones.push(
    [`clav${k}`, 'chest', s * 0.42, 0.26, 0],
    [`armA${k}`, `clav${k}`, s * 0.34, -0.08, 0],
    [`armB${k}`, `armA${k}`, s * 0.06, -0.62, 0.02],
    [`armC${k}`, `armB${k}`, s * 0.02, -0.58, 0],
    [`pauldron${k}`, `clav${k}`, s * 0.18, 0.16, 0],
    [`hip${k}`, 'hips', s * 0.30, -0.14, 0],
    [`knee${k}`, `hip${k}`, 0, -0.62, 0.02],
    [`ankle${k}`, `knee${k}`, 0, -0.60, -0.04],
    [`foot${k}`, `ankle${k}`, 0, -0.12, -0.06],
  );
}

/* ------------------------------------------------------------------ */
const BODY_UV = [0.02, 0.02, 0.84, 0.84];
function stoneRegion(geo, rng) {
  // every block claims a different patch of the masonry sheet, so no two
  // blocks share the same mortar lines
  const w = 0.2;
  const u = rng.float(BODY_UV[0], BODY_UV[2] - w);
  const v = rng.float(BODY_UV[1], BODY_UV[3] - w);
  return region(geo, u, v, u + w, v + w);
}

function build(pb, tpl) {
  const R = tpl.rest;
  const rng = new Rng(0x6b6459);

  const brick = (bone, x, y, z, w, h, d, tilt = 0.06, ry = 0) => {
    const g = block(w, h, d);
    pb.add(stoneRegion(place(g, x, y, z,
      rng.float(-tilt, tilt), ry + rng.float(-tilt * 2, tilt * 2), rng.float(-tilt, tilt)), rng), bone, 'body');
  };

  /* ---- torso: three courses of blocks around a hollow core ---- */
  const courses = [
    { y: R.hips.y - 0.20, r: 0.40, n: 8, h: 0.22, bone: 'hips' },
    { y: R.hips.y - 0.01, r: 0.44, n: 9, h: 0.20, bone: 'hips' },
    { y: R.hips.y + 0.18, r: 0.46, n: 9, h: 0.20, bone: 'spine' },
    { y: R.spine.y + 0.08, r: 0.49, n: 10, h: 0.22, bone: 'spine' },
    { y: R.spine.y + 0.28, r: 0.51, n: 10, h: 0.22, bone: 'chest' },
    { y: R.chest.y + 0.06, r: 0.52, n: 10, h: 0.24, bone: 'chest' },
    { y: R.chest.y + 0.28, r: 0.47, n: 9, h: 0.22, bone: 'chest' },
  ];
  for (const c of courses) {
    for (let i = 0; i < c.n; i++) {
      const ang = (i / c.n) * Math.PI * 2 + (c.n % 2) * 0.2;
      const w = (Math.PI * 2 * c.r) / c.n * 0.82; // 18% gap: the core shows through
      brick(c.bone,
        Math.sin(ang) * c.r, c.y + rng.float(-0.02, 0.02), Math.cos(ang) * c.r * 0.78,
        w, c.h * rng.float(0.88, 1.06), 0.26 * rng.float(0.9, 1.1), 0.1, ang);
    }
  }

  /* ---- the core: a molten heart, plus shards in the gaps ---- */
  pb.add(glowRegion(place(new THREE.SphereGeometry(0.30, 12, 9), R.core.x, R.core.y, R.core.z)), 'core', 'body');
  for (let i = 0; i < 7; i++) {
    const g = spike(0.05, 0.16, { radial: 4, rings: 1 });
    const ang = rng.float(0, Math.PI * 2);
    pb.add(glowRegion(place(g,
      Math.sin(ang) * 0.34, R.core.y + rng.float(-0.22, 0.26), Math.cos(ang) * 0.3,
      rng.float(-1, 1), ang, rng.float(-1, 1))), 'core', 'body');
  }

  /* ---- armour plates ---- */
  const plate = (bone, x, y, z, w, h, d) => {
    pb.add(stoneRegion(place(block(w, h, d), x, y, z), rng), bone, 'body');
  };
  plate('plateChest', R.plateChest.x, R.plateChest.y, R.plateChest.z, 0.86, 0.72, 0.16);
  plate('plateChest', R.plateChest.x, R.plateChest.y - 0.42, R.plateChest.z + 0.03, 0.7, 0.2, 0.14);
  plate('plateBack', R.plateBack.x, R.plateBack.y, R.plateBack.z, 0.9, 0.86, 0.18);
  for (let i = 0; i < 3; i++) {
    plate('plateHip', (i - 1) * 0.34, R.plateHip.y, -0.34 + Math.abs(i - 1) * 0.06, 0.32, 0.42, 0.14);
  }
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    const P = R[`pauldron${k}`];
    plate(`pauldron${k}`, P.x, P.y, P.z, 0.44, 0.30, 0.52);
    plate(`pauldron${k}`, P.x + s * 0.04, P.y - 0.24, P.z, 0.40, 0.22, 0.46);
    pb.add(boneRegion(place(spike(0.09, 0.34, { radial: 4, rings: 2 }),
      P.x + s * 0.06, P.y + 0.14, P.z, -0.2, 0, s * 0.5)), `pauldron${k}`, 'body');
  }

  /* ---- head: a keystone with a burning visor slot ---- */
  brick('head', R.head.x, R.head.y, R.head.z, 0.62, 0.5, 0.58, 0.02);
  brick('head', R.head.x, R.head.y + 0.28, R.head.z + 0.02, 0.5, 0.14, 0.5, 0.03);
  brick('head', R.head.x, R.head.y - 0.2, R.head.z - 0.06, 0.44, 0.16, 0.44, 0.04);
  pb.add(glowRegion(place(block(0.46, 0.1, 0.06), R.head.x, R.head.y + 0.02, R.head.z - 0.30)), 'head', 'body');
  for (const s of [-1, 1]) {
    pb.add(boneRegion(place(spike(0.07, 0.36, { radial: 4, rings: 2, curve: 0.2 }),
      R.head.x + s * 0.24, R.head.y + 0.16, R.head.z + 0.10, -0.3, 0, s * 0.55)), 'head', 'body');
  }
  // neck stub
  brick('chest', 0, R.chest.y + 0.3, -0.02, 0.3, 0.2, 0.3, 0.02);

  /* ---- limbs: stacks of blocks, tapering ---- */
  const limb = (bone, a, b, w0, w1, n, depth) => {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const w = lerp(w0, w1, t);
      brick(bone,
        lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t),
        w, (a.distanceTo(b) / n) * 1.02, lerp(depth, depth * 0.86, t), 0.07);
    }
  };
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    limb(`armA${k}`, R[`armA${k}`], R[`armB${k}`], 0.40, 0.34, 4, 0.42);
    limb(`armB${k}`, R[`armB${k}`], R[`armC${k}`], 0.44, 0.40, 4, 0.46);
    // fist: a wrecking ball of six blocks
    for (let i = 0; i < 6; i++) {
      const ox = (i % 2 ? 1 : -1) * 0.16;
      const oz = (i % 3 - 1) * 0.17;
      brick(`armC${k}`, R[`armC${k}`].x + ox, R[`armC${k}`].y - 0.2 - (i > 2 ? 0.2 : 0), R[`armC${k}`].z + oz, 0.3, 0.3, 0.3, 0.14);
    }
    pb.add(glowRegion(place(block(0.42, 0.06, 0.06), R[`armB${k}`].x + s * 0.02, R[`armB${k}`].y - 0.30, R[`armB${k}`].z - 0.24)), `armB${k}`, 'body');
    // elbow rubble
    for (let i = 0; i < 3; i++) {
      brick(`armB${k}`, R[`armB${k}`].x + s * 0.1, R[`armB${k}`].y + 0.06, R[`armB${k}`].z + (i - 1) * 0.18, 0.26, 0.22, 0.2, 0.2);
    }

    limb(`hip${k}`, R[`hip${k}`], R[`knee${k}`], 0.46, 0.40, 4, 0.50);
    limb(`knee${k}`, R[`knee${k}`], R[`ankle${k}`], 0.42, 0.34, 4, 0.46);
    brick(`knee${k}`, R[`knee${k}`].x, R[`knee${k}`].y - 0.02, R[`knee${k}`].z - 0.22, 0.36, 0.3, 0.16, 0.12);
    brick(`foot${k}`, R[`foot${k}`].x, R[`foot${k}`].y + 0.06, R[`foot${k}`].z - 0.08, 0.5, 0.22, 0.72, 0.02);
    brick(`foot${k}`, R[`foot${k}`].x, R[`foot${k}`].y + 0.2, R[`foot${k}`].z + 0.16, 0.42, 0.2, 0.3, 0.04);
    for (let i = -1; i <= 1; i++) {
      brick(`foot${k}`, R[`foot${k}`].x + i * 0.15, R[`foot${k}`].y + 0.02, R[`foot${k}`].z - 0.44, 0.14, 0.14, 0.16, 0.1);
    }
  }

  /* rubble collar — hides the shoulder joints */
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    brick(`clav${k}`, R[`clav${k}`].x, R[`clav${k}`].y, R[`clav${k}`].z, 0.34, 0.3, 0.4, 0.1);
    brick(`clav${k}`, R[`clav${k}`].x - s * 0.12, R[`clav${k}`].y - 0.18, R[`clav${k}`].z, 0.24, 0.22, 0.34, 0.18);
    brick('chest', s * 0.2, R.chest.y + 0.36, -0.1, 0.24, 0.16, 0.24, 0.2);
  }
}

/* ------------------------------------------------------------------ */
function materials() {
  const sheet = () => skinSheet({
    seed: 0x6b64,
    pattern: 'masonry',
    palette: {
      light: '#a8946f', dark: '#6d5f47', mortar: '#3a3227', streak: '#4a4034',
      pale: '#b6a684', paleSpeck: '#8a7a5c', bone: '#cdbf9c',
      course: 46,
    },
    glow: { hot: '#fff4cc', mid: '#ff8a26', cool: '#301004' },
    relief: { strength: 3.4, roughBase: 0.9, roughVar: 0.1 },
  });
  return {
    body: creatureMaterial('stone-golem', () => creatureStandard(sheet(), {
      emissive: 0xff8a2a, emissiveIntensity: 2.4, roughness: 1, metalness: 0.0,
      flatShading: true, normalScale: 1.4,
    })),
  };
}

function attach(model) {
  const b = model.bones;
  model.arms = [];
  model.legs = [];
  model.plates = [b.plateChest, b.plateBack, b.plateHip, b.pauldronL, b.pauldronR];
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R';
    model.arms.push({ clav: b[`clav${k}`], a: b[`armA${k}`], b: b[`armB${k}`], c: b[`armC${k}`], side: s });
    model.legs.push({
      hip: b[`hip${k}`], knee: b[`knee${k}`], ankle: b[`ankle${k}`], foot: b[`foot${k}`],
      side: s, phase: s < 0 ? 0 : Math.PI,
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
  const slam = bt.id === 'slam';
  const sweep = bt.id === 'sweep';
  const dead = e.state === 'dead';
  const downed = e.state === 'downed';
  const dying = dead ? clamp01(e.stateT / 1.1) : 0;

  /* slow, long-duty-cycle gait: most of the cycle is stance */
  e.gait += dt * (1.0 + e.run * 3.2);
  const g = e.gait;

  const shield = e.shield ?? 0;
  a.shield = damp(a.shield, dead ? 0 : shield, 5, dt);
  const stagger = e.stagger > 0 ? clamp01(e.stagger / 0.8) : 0;
  const flinch = e.flinch > 0 ? clamp01(e.flinch / 0.35) : 0;
  a.kneel = damp(a.kneel, downed ? 1 : 0, downed ? 9 : 3.5, dt);

  /* --- torso: weight transfer, not a bob --------------------------- */
  const sway = Math.sin(g) * 0.14 * (0.4 + e.run);
  const drop = -Math.abs(Math.cos(g)) * 0.05 * (0.3 + e.run);
  b.hips.position.y += drop - a.kneel * 0.62 - dying * 0.85 * easeOut(dying)
    + (slam && bt.phase === 'ant' ? 0.08 * smoothstep(0.3, 1, bt.k) : 0)
    - (slam && bt.phase === 'com' ? 0.16 * bt.k : 0);
  b.hips.rotation.z = sway * 0.35 + flinch * e.flinchX * 0.22 + stagger * e.flinchX * 0.3;
  b.hips.rotation.y = -Math.sin(g) * 0.14 * e.run;
  b.hips.rotation.x = e.run * 0.10 + a.kneel * 0.24 + dying * 0.55
    - (slam && bt.phase === 'ant' ? 0.22 * smoothstep(0.2, 1, bt.k) : 0)
    + (slam && bt.phase === 'com' ? 0.5 * easeOut(bt.k) : 0)
    + (slam && bt.phase === 'rec' ? 0.42 * (1 - easeIn(bt.k)) : 0)
    + flinch * e.flinchZ * 0.18 - stagger * 0.2;
  b.spine.rotation.y = Math.sin(g) * 0.10 * e.run + (sweep ? sweepTwist(bt) : 0);
  b.spine.rotation.x = a.shield * 0.14 + dying * 0.3;
  b.chest.rotation.y = -b.hips.rotation.y * 0.5 + (sweep ? sweepTwist(bt) * 0.8 : 0);
  b.chest.rotation.x = -a.shield * 0.06 + dying * 0.25;

  /* --- head: sunk between the shoulders, tucked behind the guard --- */
  const headYaw = dead ? 0 : clamp(e.look.yaw, -0.7, 0.7);
  const headPitch = dead ? 0 : clamp(e.look.pitch, -0.4, 0.5);
  a.headYaw = dampAngle(a.headYaw, headYaw, 5, dt);
  a.headPitch = damp(a.headPitch, headPitch, 5, dt);
  b.head.rotation.y = a.headYaw - b.chest.rotation.y;
  b.head.rotation.x = a.headPitch * 0.6 + a.shield * 0.28 + a.kneel * 0.3 + dying * 0.5
    - (slam && bt.phase === 'ant' ? 0.2 * bt.k : 0);
  b.head.rotation.z = -b.hips.rotation.z * 0.6;

  /* --- arms: guard, overhead slam, or a wide backhand sweep -------- */
  for (const arm of m.arms) {
    const s = arm.side;
    let sh = -0.12 + Math.sin(g + (s > 0 ? Math.PI : 0)) * 0.16 * e.run;
    let el = -0.35 - Math.abs(Math.sin(g + (s > 0 ? Math.PI : 0))) * 0.12 * e.run;
    let shZ = s * (0.16 + Math.abs(Math.sin(g)) * 0.05);
    let shY = 0;

    // shield: forearms crossed over the core
    sh = lerp(sh, -1.05, a.shield);
    el = lerp(el, -1.75, a.shield);
    shZ = lerp(shZ, s * 0.55, a.shield);
    shY = lerp(shY, -s * 0.5, a.shield);

    if (slam) {
      if (bt.phase === 'ant') {
        // both fists rise over the head — the read is unmistakable
        const k = smoothstep(0, 0.85, bt.k);
        sh = lerp(sh, 2.5, k);
        el = lerp(el, -0.6, k);
        shZ = lerp(shZ, s * 0.30, k);
      } else if (bt.phase === 'com') {
        const k = easeIn(bt.k);
        sh = lerp(2.5, -0.35, k);
        el = lerp(-0.6, -0.15, k);
        shZ = s * 0.28;
      } else {
        // fists buried in the cobbles: the vulnerable window
        sh = lerp(-0.35, -0.2, bt.k) - 0.1 * (1 - bt.k);
        el = -0.2;
        shZ = s * 0.24;
      }
    } else if (sweep) {
      const lead = s === e.sweepSide ? 1 : 0.2;
      if (bt.phase === 'ant') {
        const k = smoothstep(0, 1, bt.k);
        sh = lerp(sh, -0.3, k);
        shY = lerp(shY, s * 1.5 * lead, k);
        el = lerp(el, -1.5 * lead, k);
      } else if (bt.phase === 'com') {
        sh = -0.2;
        shY = lerp(s * 1.5 * lead, -s * 1.4 * lead, easeOut(bt.k));
        el = lerp(-1.5 * lead, -0.2, bt.k);
      } else {
        shY = -s * 1.4 * lead * (1 - easeIn(bt.k));
        el = -0.3;
      }
    }
    if (downed || dead) {
      const k = Math.max(a.kneel, dying);
      sh = lerp(sh, 0.55, k);
      el = lerp(el, -0.9, k);
      shZ = lerp(shZ, s * 0.4, k);
    }

    arm.a.rotation.set(sh, shY, shZ);
    arm.b.rotation.x = el;
    arm.c.rotation.x = -0.1 + a.shield * 0.3;
    arm.clav.rotation.z = s * (a.shield * 0.12 + (slam && bt.phase === 'ant' ? 0.18 * bt.k : 0));
  }

  /* --- legs: braced, wide, planted --------------------------------- */
  for (const leg of m.legs) {
    const ph = g + leg.phase;
    // long stance / short swing
    const raw = Math.sin(ph);
    const swing = Math.max(0, raw - 0.45) / 0.55;
    const stride = 0.35 + e.run * 0.75;
    let hip = raw * stride * 0.38 - 0.04;
    let knee = -0.18 - swing * stride * 0.9;
    let ankle = 0.1 + swing * stride * 0.4;

    if (slam && bt.phase !== 'rec') {
      hip += (bt.phase === 'ant' ? -0.18 * bt.k : 0.12);
      knee -= 0.3 * (bt.phase === 'ant' ? bt.k : 1 - bt.k);
    }
    if (downed || dead) {
      const k = Math.max(a.kneel, dying);
      // right knee goes down, left stays braced — a real kneel
      if (leg.side > 0) {
        hip = lerp(hip, 0.55, k);
        knee = lerp(knee, -1.9, k);
        ankle = lerp(ankle, 0.9, k);
      } else {
        hip = lerp(hip, -0.45, k);
        knee = lerp(knee, -0.55, k);
      }
    }
    leg.hip.rotation.x = hip;
    leg.hip.rotation.z = leg.side * (0.08 + a.shield * 0.04);
    leg.knee.rotation.x = knee;
    leg.ankle.rotation.x = ankle;
    leg.foot.rotation.x = -ankle * 0.5;

    // heavy footfall: dust ring and grit
    const planted = raw < -0.9;
    if (planted && !leg.planted && !dead) {
      leg.planted = true;
      if (ctx.vfx && e.run > 0.12) {
        const px = e.pos.x + leg.side * 0.35;
        ctx.vfx.burst(ctx.scratch.set(px, e.pos.y + 0.06, e.pos.z), 0x8a7a5c, 7, 2.6,
          { size: 0.3, life: 0.55, drag: 4.5, up: 0.8, grav: -1.2 });
      }
    } else if (raw > 0) leg.planted = false;
  }

  /* --- armour: plates get thrown off as the core is exposed -------- */
  m.plates.forEach((plate, i) => {
    const brokenAt = e.brokenPlates ?? 0;
    if (i < brokenAt) {
      const age = (e.plateAge && e.plateAge[i]) ?? 1;
      if (age < 0.5) {
        // tumble away for a moment before it is culled
        const k = age / 0.5;
        plate.position.z += k * 0.9;
        plate.position.y += k * 0.35 - k * k * 0.9;
        plate.rotation.x = k * 4;
        plate.scale.setScalar(1 - easeIn(k));
      } else {
        plate.scale.setScalar(0.0001);
      }
    } else if (dead) {
      plate.scale.setScalar(Math.max(0.0001, 1 - clamp01((e.stateT - 0.3) / 0.5)));
    }
  });

  /* core light: breathing at rest, white-hot on the wind-up, blazing
   * once the armour is gone */
  const exposure = (e.brokenPlates ?? 0) * 0.45;
  e.glow = 0.2 + exposure + Math.sin(e.stateT * 1.6 + e.animPhase) * 0.22
    + (slam ? (bt.phase === 'ant' ? 2.6 * easeIn(bt.k) : bt.phase === 'com' ? 2.8 : 0.7 * (1 - bt.k)) : 0)
    + (sweep && bt.phase === 'ant' ? 1.4 * bt.k : 0)
    + a.shield * 0.4 - (dead ? 1.2 * clamp01(e.stateT / 1.4) : 0);
}

function sweepTwist(bt) {
  if (bt.phase === 'ant') return smoothstep(0, 1, bt.k) * 0.5;
  if (bt.phase === 'com') return lerp(0.5, -0.55, easeOut(bt.k));
  return -0.55 * (1 - easeIn(bt.k));
}

export const GOLEM = {
  id: 'golem',
  boundingRadius: 3.4,
  bones,
  build,
  materials,
  attach,
  animate,
  emissiveBase: 2.4,
  ragdoll: [
    { name: 'hips', parent: null, tip: 'spine', radius: 0.44, mass: 90 },
    { name: 'spine', parent: 'hips', tip: 'chest', radius: 0.48, mass: 90 },
    { name: 'chest', parent: 'spine', tip: 'head', radius: 0.5, mass: 110, cone: 0.4 },
    { name: 'head', parent: 'chest', length: 0.5, radius: 0.3, mass: 40, cone: 0.5 },
    { name: 'armAL', parent: 'chest', tip: 'armBL', radius: 0.22, mass: 45 },
    { name: 'armBL', parent: 'armAL', tip: 'armCL', radius: 0.24, mass: 55 },
    { name: 'armAR', parent: 'chest', tip: 'armBR', radius: 0.22, mass: 45 },
    { name: 'armBR', parent: 'armAR', tip: 'armCR', radius: 0.24, mass: 55 },
    { name: 'hipL', parent: 'hips', tip: 'kneeL', radius: 0.24, mass: 60 },
    { name: 'kneeL', parent: 'hipL', tip: 'ankleL', radius: 0.21, mass: 45 },
    { name: 'hipR', parent: 'hips', tip: 'kneeR', radius: 0.24, mass: 60 },
    { name: 'kneeR', parent: 'hipR', tip: 'ankleR', radius: 0.21, mass: 45 },
  ],
  acts: {
    /* 0.85 s overhead wind-up, 0.7 s of fists-in-the-ground recovery */
    slam: { id: 'slam', ant: 0.85, com: 0.18, rec: 0.70 },
    sweep: { id: 'sweep', ant: 0.62, com: 0.16, rec: 0.52 },
  },
};
