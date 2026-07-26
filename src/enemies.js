import * as THREE from 'three';

/* ==================================================================
   Dračí potomstvo — the things crawling out of the rifts.
   Four archetypes, all built from primitives with procedural animation.
   ================================================================== */

const SKIN = {
  whelp: 0x5a6b3a,
  whelpBelly: 0x8b9a5f,
  spitter: 0x4a3a55,
  spitterGlow: 0xff6a2a,
  golem: 0x6b6459,
  golemCore: 0xff8a3a,
  boss: 0x3f4a2e,
  bossBelly: 0x7a6a3a,
};

export const ENEMY_TYPES = {
  whelp: {
    id: 'whelp', name: 'Ještěrka', hp: 46, speed: 6.4, radius: 0.55, height: 1.1,
    damage: 8, attackRange: 2.3, attackCd: 1.45, score: 100, ranged: false, mass: 1,
  },
  spitter: {
    id: 'spitter', name: 'Chrlič', hp: 72, speed: 3.5, radius: 0.6, height: 1.9,
    damage: 13, attackRange: 34, attackCd: 2.6, score: 180, ranged: true, mass: 1.4,
    keepDistance: 17,
  },
  golem: {
    id: 'golem', name: 'Kamenný golem', hp: 240, speed: 2.9, radius: 1.05, height: 2.9,
    damage: 25, attackRange: 3.4, attackCd: 1.9, score: 400, ranged: false, mass: 4,
  },
  boss: {
    id: 'boss', name: 'DRAK BRNĚNSKÝ', hp: 7600, speed: 5.4, radius: 3.8, height: 9.0,
    damage: 42, attackRange: 9.5, attackCd: 2.2, score: 5000, ranged: true, mass: 20,
    scale: 1.45,
  },
};

/* ------------------------------------------------------------------ */
/* model factories                                                     */
/* ------------------------------------------------------------------ */
function m(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.04, flatShading: true, ...opts });
}

function buildWhelp() {
  const skin = m(SKIN.whelp);
  const belly = m(SKIN.whelpBelly);
  const eyeMat = m(0xff5522, { emissive: 0xff3311, emissiveIntensity: 3.2 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 0.62;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 1.15), skin);
  body.add(torso);
  const belyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 1.0), belly);
  belyMesh.position.y = -0.24;
  body.add(belyMesh);

  const neck = new THREE.Group();
  neck.position.set(0, 0.16, -0.55);
  body.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.42), skin);
  neckMesh.position.z = -0.2;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.z = -0.42;
  neck.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.3, 0.5), skin);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.34), skin);
  snout.position.set(0, -0.02, -0.4);
  head.add(snout);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.36), belly);
  jaw.position.set(0, -0.15, -0.4);
  head.add(jaw);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), eyeMat);
    eye.position.set(s * 0.14, 0.09, -0.2);
    head.add(eye);
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.28, 4), belly);
    horn.position.set(s * 0.12, 0.2, 0.05);
    horn.rotation.x = -0.5;
    head.add(horn);
  }

  // tail
  const tail = new THREE.Group();
  tail.position.set(0, 0.05, 0.55);
  body.add(tail);
  const tailSegs = [];
  let parent = tail;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    seg.position.z = i === 0 ? 0.1 : 0.32;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22 - i * 0.04, 0.2 - i * 0.035, 0.34), skin);
    mesh.position.z = 0.16;
    seg.add(mesh);
    parent.add(seg);
    tailSegs.push(seg);
    parent = seg;
  }

  // wings (small, folded)
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.3, 0.2, -0.15);
    const membrane = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.62), belly);
    membrane.position.set(s * 0.06, 0.16, 0.1);
    w.add(membrane);
    body.add(w);
    wings.push(w);
  }

  // legs
  const legs = [];
  for (const [sx, sz] of [[-1, -0.38], [1, -0.38], [-1, 0.4], [1, 0.4]]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.3, -0.12, sz);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.34, 0.17), skin);
    thigh.position.y = -0.17;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.34;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.3, 0.14), skin);
    shin.position.y = -0.15;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.08, 0.26), belly);
    foot.position.set(0, -0.3, -0.05);
    knee.add(foot);
    body.add(hip);
    legs.push({ hip, knee, phase: (sx > 0 ? 0 : Math.PI) + (sz > 0 ? Math.PI : 0) });
  }

  return { root, parts: { body, neck, head, jaw, tailSegs, wings, legs }, mats: [skin, belly] };
}

function buildSpitter() {
  const skin = m(SKIN.spitter);
  const glow = m(0x2a1020, { emissive: SKIN.spitterGlow, emissiveIntensity: 2.4 });
  const stone = m(0x574a5e);
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.28;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.9, 0.56), skin);
  body.add(torso);
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), glow);
  throat.position.set(0, 0.34, -0.28);
  body.add(throat);

  const head = new THREE.Group();
  head.position.y = 0.72;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.5), stone);
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.44), glow);
  jaw.position.set(0, -0.24, -0.06);
  head.add(jaw);
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 4), stone);
    horn.position.set(s * 0.18, 0.3, 0.1);
    horn.rotation.set(0.5, 0, s * 0.4);
    head.add(horn);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), m(0xffcc44, { emissive: 0xffaa22, emissiveIntensity: 3 }));
    eye.position.set(s * 0.14, 0.06, -0.24);
    head.add(eye);
  }

  // big bat wings
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 0.36, 0.3, 0.1);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.12), stone);
    arm.position.x = s * 0.75;
    w.add(arm);
    const membrane = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.05), skin);
    membrane.position.set(s * 0.72, -0.42, 0.02);
    w.add(membrane);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 4), stone);
    claw.position.set(s * 1.52, 0, 0);
    claw.rotation.z = s * Math.PI / 2;
    w.add(claw);
    body.add(w);
    wings.push(w);
  }

  // arms
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.42, 0.2, 0);
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.42, 0.14), skin);
    up.position.y = -0.21;
    sh.add(up);
    const el = new THREE.Group();
    el.position.y = -0.42;
    sh.add(el);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.4, 0.12), skin);
    fore.position.y = -0.2;
    el.add(fore);
    body.add(sh);
    arms.push({ shoulder: sh, elbow: el });
  }

  // legs (digitigrade)
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.22, -0.46, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.44, 0.22), skin);
    thigh.position.y = -0.22;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.42, 0.18), skin);
    shin.position.y = -0.21;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.34), stone);
    foot.position.set(0, -0.44, -0.08);
    knee.add(foot);
    body.add(hip);
    legs.push({ hip, knee, phase: s > 0 ? 0 : Math.PI });
  }

  return { root, parts: { body, head, jaw, throat, wings, arms, legs }, mats: [skin, stone] };
}

function buildGolem() {
  const stone = m(0x6b6459, { roughness: 0.95 });
  const dark = m(0x4e483f, { roughness: 0.95 });
  const core = m(0x2a1408, { emissive: SKIN.golemCore, emissiveIntensity: 2.6 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 1.85;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.95), stone);
  body.add(torso);
  const chestCore = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.2), core);
  chestCore.position.set(0, 0.1, -0.5);
  body.add(chestCore);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.45, 1.05), dark);
  shoulders.position.y = 0.62;
  body.add(shoulders);

  const head = new THREE.Group();
  head.position.y = 0.95;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.6), stone);
  head.add(skull);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), core);
  visor.position.set(0, 0.02, -0.32);
  head.add(visor);
  for (const s of [-1, 1]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 4), dark);
    spike.position.set(s * 0.28, 0.34, 0.1);
    spike.rotation.z = s * 0.4;
    head.add(spike);
  }

  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * 0.92, 0.42, 0);
    const up = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.72, 0.44), stone);
    up.position.y = -0.36;
    sh.add(up);
    const el = new THREE.Group();
    el.position.y = -0.72;
    sh.add(el);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5), dark);
    fore.position.y = -0.4;
    el.add(fore);
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.6), stone);
    fist.position.y = -0.9;
    el.add(fist);
    const glowLine = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.08, 0.08), core);
    glowLine.position.set(0, -0.62, -0.26);
    el.add(glowLine);
    body.add(sh);
    arms.push({ shoulder: sh, elbow: el });
  }

  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.42, -0.7, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.5), stone);
    thigh.position.y = -0.33;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.66;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.46), dark);
    shin.position.y = -0.31;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.22, 0.72), stone);
    foot.position.set(0, -0.66, -0.1);
    knee.add(foot);
    body.add(hip);
    legs.push({ hip, knee, phase: s > 0 ? 0 : Math.PI });
  }

  return { root, parts: { body, head, arms, legs, core: chestCore }, mats: [stone, dark] };
}

function buildBoss() {
  const skin = m(0x5a6640, { roughness: 0.7, emissive: 0x1a1508, emissiveIntensity: 0.8 });
  const belly = m(0x9a8748, { roughness: 0.75, emissive: 0x2a1c06, emissiveIntensity: 0.9 });
  // big flat panels catch a lot of sun — keep the membrane dark or the wings
  // wash out to pale pink under ACES tone mapping
  const membrane = m(0x3a1f1c, { roughness: 0.95, side: THREE.DoubleSide, emissive: 0x140603, emissiveIntensity: 0.7 });
  const glow = m(0x3a0a04, { emissive: 0xff5a1a, emissiveIntensity: 2.8 });
  const horn = m(0xd9cbb0, { roughness: 0.5 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = 3.4;
  root.add(body);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.3, 4.6), skin);
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 3.4), belly);
  chest.position.y = -1.1;
  body.add(chest);
  // glowing vents along the flanks
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.9), glow);
      vent.position.set(side * 1.32, -0.35, -1.4 + i * 1.0);
      body.add(vent);
    }
  }
  // dorsal spikes
  for (let i = 0; i < 7; i++) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9 - i * 0.06, 4), horn);
    sp.position.set(0, 1.2 + Math.sin(i * 0.5) * 0.08, -1.9 + i * 0.62);
    body.add(sp);
  }

  // neck chain + head
  const neckSegs = [];
  let parent = body;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.7 : 0.15, i === 0 ? -2.1 : -0.95);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.15 - i * 0.12, 1.05 - i * 0.11, 1.05), skin);
    mesh.position.z = -0.5;
    seg.add(mesh);
    const scale = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 4), horn);
    scale.position.set(0, 0.5, -0.5);
    seg.add(scale);
    parent.add(seg);
    neckSegs.push(seg);
    parent = seg;
  }
  const head = new THREE.Group();
  head.position.set(0, 0, -0.95);
  parent.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.95, 1.5), skin);
  head.add(skull);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 1.15), skin);
  snout.position.set(0, -0.1, -1.2);
  head.add(snout);
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.34, -0.4);
  head.add(jaw);
  const jawMesh = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 1.5), belly);
  jawMesh.position.z = -0.6;
  jaw.add(jawMesh);
  for (let i = 0; i < 8; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 4), horn);
    tooth.rotation.x = Math.PI;
    tooth.position.set((i % 2 ? 1 : -1) * 0.3, 0.16, -0.3 - Math.floor(i / 2) * 0.34);
    jaw.add(tooth);
  }
  const maw = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), glow);
  maw.position.set(0, -0.16, -1.3);
  head.add(maw);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), m(0xffdd55, { emissive: 0xffaa22, emissiveIntensity: 4 }));
    eye.position.set(s * 0.42, 0.24, -0.6);
    head.add(eye);
    const h1 = new THREE.Mesh(new THREE.ConeGeometry(0.15, 1.3, 5), horn);
    h1.position.set(s * 0.42, 0.6, 0.35);
    h1.rotation.set(-0.6, 0, s * 0.5);
    head.add(h1);
    const h2 = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.7, 5), horn);
    h2.position.set(s * 0.5, 0.1, 0.1);
    h2.rotation.set(0.2, 0, s * 1.2);
    head.add(h2);
  }

  // wings
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * 1.2, 0.7, -0.6);
    const bone = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.24, 0.3), horn);
    bone.position.x = s * 2.2;
    w.add(bone);
    const elbow = new THREE.Group();
    elbow.position.x = s * 4.4;
    w.add(elbow);
    const bone2 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 0.24), horn);
    bone2.position.x = s * 1.8;
    elbow.add(bone2);
    const mem1 = new THREE.Mesh(new THREE.BoxGeometry(4.4, 3.0, 0.08), membrane);
    mem1.position.set(s * 2.2, -1.4, 0.1);
    w.add(mem1);
    const mem2 = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.08), membrane);
    mem2.position.set(s * 1.8, -1.0, 0.1);
    elbow.add(mem2);
    // ribs across the membrane break up the flat panel
    for (let r = 0; r < 3; r++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.0, 0.16), horn);
      rib.position.set(s * (0.9 + r * 1.2), -1.4, 0.02);
      rib.rotation.z = s * 0.12;
      w.add(rib);
    }
    for (let i = 0; i < 3; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2 - i * 0.4, 0.12), horn);
      finger.position.set(s * (0.6 + i * 1.2), -1.1, 0.02);
      finger.rotation.z = s * (0.2 + i * 0.15);
      elbow.add(finger);
    }
    body.add(w);
    wings.push({ group: w, elbow });
  }

  // tail
  const tailSegs = [];
  parent = body;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? -0.2 : 0, i === 0 ? 2.3 : 0.95);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.9 - i * 0.12, 0.85 - i * 0.11, 1.0), skin);
    mesh.position.z = 0.5;
    seg.add(mesh);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.44, 4), horn);
    spike.position.set(0, 0.42, 0.5);
    seg.add(spike);
    parent.add(seg);
    tailSegs.push(seg);
    parent = seg;
  }
  const tailTip = new THREE.Mesh(new THREE.ConeGeometry(0.3, 1.3, 5), horn);
  tailTip.rotation.x = -Math.PI / 2;
  tailTip.position.z = 1.2;
  parent.add(tailTip);

  // legs
  const legs = [];
  for (const [sx, sz, big] of [[-1, -1.3, false], [1, -1.3, false], [-1, 1.5, true], [1, 1.5, true]]) {
    const hip = new THREE.Group();
    hip.position.set(sx * 1.15, -0.9, sz);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(big ? 0.8 : 0.6, 1.5, big ? 0.9 : 0.7), skin);
    thigh.position.y = -0.75;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -1.5;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(big ? 0.6 : 0.46, 1.3, big ? 0.7 : 0.55), skin);
    shin.position.y = -0.65;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(big ? 0.9 : 0.7, 0.3, big ? 1.3 : 1.0), belly);
    foot.position.set(0, -1.35, -0.25);
    knee.add(foot);
    for (let c = 0; c < 3; c++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 4), horn);
      claw.rotation.x = -Math.PI / 2.2;
      claw.position.set((c - 1) * 0.26, -1.4, -0.85);
      knee.add(claw);
    }
    body.add(hip);
    legs.push({ hip, knee, phase: (sx > 0 ? 0 : Math.PI) + (sz > 0 ? Math.PI : 0) });
  }

  return { root, parts: { body, neckSegs, head, jaw, maw, wings, tailSegs, legs }, mats: [skin, belly, membrane] };
}

const BUILDERS = { whelp: buildWhelp, spitter: buildSpitter, golem: buildGolem, boss: buildBoss };

/* ------------------------------------------------------------------ */
/* floating health bar (only shown once something has been hurt)       */
/* ------------------------------------------------------------------ */
const BAR_GEO = new THREE.PlaneGeometry(1, 1);
const BAR_BG = new THREE.MeshBasicMaterial({ color: 0x0b0d10, transparent: true, opacity: 0.72, depthWrite: false });
const BAR_FG = new THREE.MeshBasicMaterial({ color: 0xff5a3c, transparent: true, depthWrite: false });

function makeHealthBar(width) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(BAR_GEO, BAR_BG);
  bg.scale.set(width + 0.1, 0.25, 1);
  const fg = new THREE.Mesh(BAR_GEO, BAR_FG.clone());
  fg.scale.set(width, 0.16, 1);
  fg.position.z = 0.01;
  g.add(bg, fg);
  g.visible = false;
  g.renderOrder = 4;
  return { group: g, fg, width };
}

/* ==================================================================
   Enemy manager
   ================================================================== */
export class EnemyManager {
  constructor(scene, collision, vfx) {
    this.scene = scene;
    this.collision = collision;
    this.vfx = vfx;
    this.list = [];
    this.pools = { whelp: [], spitter: [], golem: [], boss: [] };
    this.onDeath = null;
    this.onPlayerHit = null;
    this.onShoot = null;
    this.corpses = [];
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (e.hp > 0) n++;
    return n;
  }

  spawn(typeId, pos, opts = {}) {
    const type = ENEMY_TYPES[typeId];
    let e = this.pools[typeId].pop();
    if (!e) {
      const built = BUILDERS[typeId]();
      built.root.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
      });
      e = {
        type, model: built, object: built.root,
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        mats: built.mats.map((mm) => mm),
      };
      // give each instance its own materials so hit flashes are independent
      const cloned = new Map();
      built.root.traverse((o) => {
        if (!o.isMesh) return;
        let mt = cloned.get(o.material);
        if (!mt) { mt = o.material.clone(); cloned.set(o.material, mt); }
        o.material = mt;
      });
      e.flashMats = [...cloned.values()];
      e.bar = makeHealthBar(1.45);
      built.root.add(e.bar.group);
      this.scene.add(built.root);
    }
    e.type = type;
    e.typeId = typeId;
    e.hp = type.hp * (opts.hpScale ?? 1);
    e.maxHp = e.hp;
    e.speed = type.speed * (opts.speedScale ?? 1);
    e.damage = type.damage * (opts.dmgScale ?? 1);
    e.pos.copy(pos);
    e.pos.y = this.collision.groundHeight(pos.x, pos.z, pos.y + 4, type.radius) || 0;
    e.vel.set(0, 0, 0);
    e.facing = Math.random() * Math.PI * 2;
    e.state = 'spawn';
    e.stateT = 0;
    e.attackCd = 0.6 + Math.random() * 0.6;
    e.animPhase = Math.random() * 10;
    e.hurt = 0;
    e.flinch = 0;
    e.onGround = true;
    e.avoidSide = Math.random() < 0.5 ? 1 : -1;
    e.repathT = 0;
    e.strafe = Math.random() < 0.5 ? 1 : -1;
    e.attackWindup = 0;
    e.stuckT = 0;
    e.bestDist = undefined;
    e.attackDidHit = false;
    e.scale = type.scale ?? 1;
    e.object.visible = true;
    e.object.scale.setScalar(0.01);
    e.object.position.copy(e.pos);
    e.object.rotation.set(0, e.facing, 0);
    e.phase2 = false;
    this.list.push(e);
    return e;
  }

  damage(e, amount, dir, isCrit = false) {
    if (e.hp <= 0) return 0;
    e.hp -= amount;
    e.hurt = 1;
    e.flinch = Math.min(0.28, amount / 120);
    if (dir && e.typeId !== 'boss' && e.typeId !== 'golem') {
      e.vel.addScaledVector(dir, Math.min(6, amount / (e.type.mass * 4)));
    }
    if (e.hp <= 0) {
      this._die(e);
      return 1;
    }
    return 0;
  }

  _die(e) {
    e.hp = 0;
    e.state = 'dead';
    e.stateT = 0;
    const c = e.typeId === 'golem' ? 0xffa040 : e.typeId === 'boss' ? 0xff5522 : 0x9aff6a;
    this.vfx.burst(_v1.copy(e.pos).setY(e.pos.y + e.type.height * 0.5), c, e.typeId === 'boss' ? 90 : 24,
      e.typeId === 'boss' ? 18 : 7, { size: e.typeId === 'boss' ? 0.9 : 0.35, life: 1.1, grav: -3, drag: 2.2 });
    if (e.typeId === 'golem' || e.typeId === 'boss') {
      this.vfx.explosion(_v1.copy(e.pos).setY(e.pos.y + 1.4), e.typeId === 'boss' ? 14 : 5, 0xff8a3a);
    }
    this.onDeath && this.onDeath(e);
  }

  /**
   * Nearest enemy hit by the segment from `from` along `dir` for `len`.
   * Each enemy is a vertical capsule (its full body height), so shots connect
   * whether you are aiming at a golem's chest or a whelp's snout.
   */
  raySegmentHit(from, dir, len, radius) {
    let best = null;
    let bestT = Infinity;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const r = e.type.radius + radius;
      const t = closestOnSegments(
        from.x, from.y, from.z,
        dir.x * len, dir.y * len, dir.z * len,
        e.pos.x, e.pos.y + r * 0.35, e.pos.z,
        0, Math.max(0.1, e.type.height - r * 0.35), 0,
      );
      if (t.dist > r) continue;
      const hitT = t.s * len;
      if (hitT < bestT) {
        bestT = hitT;
        best = e;
      }
    }
    if (!best) return null;
    return {
      enemy: best,
      dist: bestT,
      point: _v2.copy(from).addScaledVector(dir, bestT),
    };
  }

  /**
   * The enemy the crosshair is effectively pointing at: the one closest to the
   * camera ray inside a generous cylinder. Drives both the hostile reticle and
   * the aim assist that keeps a shoulder-camera third-person shooter playable.
   */
  aimTarget(origin, dir, maxDist, assistRadius = 1.35) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const r = e.type.radius + assistRadius;
      const t = closestOnSegments(
        origin.x, origin.y, origin.z,
        dir.x * maxDist, dir.y * maxDist, dir.z * maxDist,
        e.pos.x, e.pos.y + 0.2, e.pos.z,
        0, Math.max(0.1, e.type.height - 0.2), 0,
      );
      if (t.dist > r) continue;
      // prefer the nearest along the ray, tie-broken by how centred it is
      const score = t.s * maxDist + t.dist * 4;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /** Cone sweep used by the player's melee. */
  meleeSweep(origin, dir, range, arcCos, damage) {
    let hits = 0;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const dx = e.pos.x - origin.x;
      const dz = e.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.type.radius) continue;
      if (Math.abs(e.pos.y - origin.y) > 3.2) continue;
      const dot = (dx / (d || 1)) * dir.x + (dz / (d || 1)) * dir.z;
      if (dot < arcCos) continue;
      this.damage(e, damage, _v1.set(dx / (d || 1), 0, dz / (d || 1)).multiplyScalar(1.6));
      this.vfx.impactSpark(_v2.set(e.pos.x, e.pos.y + e.type.height * 0.6, e.pos.z), 0xffe08a, true);
      hits++;
    }
    return hits;
  }

  nearest(pos, maxDist = Infinity) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const d2 = (e.pos.x - pos.x) ** 2 + (e.pos.z - pos.z) ** 2;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  clear() {
    for (const e of this.list) {
      e.object.visible = false;
      this.pools[e.typeId].push(e);
    }
    this.list.length = 0;
  }

  /* ---------------------------------------------------------------- */
  update(dt, ctx) {
    const player = ctx.player;
    const pp = player.pos;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.stateT += dt;
      e.hurt = Math.max(0, e.hurt - dt * 3.4);
      e.flinch = Math.max(0, e.flinch - dt);

      /* --- death / removal --- */
      if (e.state === 'dead') {
        if (e.bar) e.bar.group.visible = false;
        const k = Math.min(1, e.stateT / 0.85);
        e.object.rotation.z = k * 1.5;
        e.object.position.y = e.pos.y - k * 0.4;
        e.object.scale.setScalar(Math.max(0.001, e.scale * (1 - k * 0.85)));
        if (e.stateT > 0.9) {
          e.object.visible = false;
          this.pools[e.typeId].push(e);
          this.list.splice(i, 1);
        }
        this._flash(e);
        continue;
      }

      /* --- spawn pop-in --- */
      if (e.state === 'spawn') {
        const k = Math.min(1, e.stateT / 0.55);
        e.object.scale.setScalar(e.scale * (0.15 + k * 0.85 * (1 + Math.sin(k * Math.PI) * 0.12)));
        if (e.stateT >= 0.55) { e.state = 'chase'; e.object.scale.setScalar(e.scale); }
      }

      const dx = pp.x - e.pos.x;
      const dz = pp.z - e.pos.z;
      const distFlat = Math.hypot(dx, dz) || 0.001;
      const distFull = Math.hypot(dx, pp.y - e.pos.y, dz);
      const toX = dx / distFlat;
      const toZ = dz / distFlat;

      /* --- AI --- */
      let moveX = 0;
      let moveZ = 0;
      let speed = e.speed;

      if (e.state === 'chase' || e.state === 'strafe') {
        const t = e.type;
        const wantRange = t.keepDistance ?? t.attackRange * 0.7;
        if (t.ranged && distFlat < wantRange * 0.75) {
          // back off
          moveX = -toX; moveZ = -toZ;
          speed *= 0.85;
        } else if (t.ranged && distFlat < wantRange * 1.35) {
          // circle the player
          moveX = -toZ * e.strafe;
          moveZ = toX * e.strafe;
          speed *= 0.75;
          if (Math.random() < dt * 0.4) e.strafe *= -1;
        } else {
          moveX = toX; moveZ = toZ;
        }

        // obstacle avoidance: probe ahead, veer if blocked
        e.repathT -= dt;
        if (e.repathT <= 0) {
          e.repathT = 0.22;
          const probe = _v1.set(moveX, 0, moveZ).normalize();
          const eye = _v2.set(e.pos.x, e.pos.y + t.height * 0.5, e.pos.z);
          const blocked = this.collision.raycast(eye, probe, t.radius + 2.6, 0.5) !== Infinity;
          if (blocked) {
            e.avoidT = 0.5;
            // try both sides, keep the one that is open
            const a = Math.PI / 2.4 * e.avoidSide;
            const sx = probe.x * Math.cos(a) - probe.z * Math.sin(a);
            const sz = probe.x * Math.sin(a) + probe.z * Math.cos(a);
            const alt = _v3.set(sx, 0, sz).normalize();
            if (this.collision.raycast(eye, alt, t.radius + 2.6, 0.5) !== Infinity) e.avoidSide *= -1;
            e.avoidX = sx; e.avoidZ = sz;
          } else {
            e.avoidT = 0;
          }
        }
        if (e.avoidT > 0) {
          e.avoidT -= dt;
          moveX = moveX * 0.35 + e.avoidX * 0.9;
          moveZ = moveZ * 0.35 + e.avoidZ * 0.9;
        }

        // attack when in range
        e.attackCd -= dt;
        const inRange = t.ranged ? distFull < t.attackRange : distFlat < t.attackRange + t.radius * 0.4;
        if (inRange && e.attackCd <= 0 && Math.abs(pp.y - e.pos.y) < (t.ranged ? 24 : 3.4)) {
          const los = t.ranged
            ? this.collision.hasLineOfSight(
              _v1.set(e.pos.x, e.pos.y + t.height * 0.8, e.pos.z), player.centre, t.attackRange + 6)
            : true;
          if (los) {
            e.state = 'attack';
            e.stateT = 0;
            e.attackWindup = t.ranged ? 0.55 : 0.34;
            e.attackDidHit = false;
            e.attackCd = t.attackCd * (0.85 + Math.random() * 0.4);
          }
        }
      } else if (e.state === 'attack') {
        const t = e.type;
        // brief lunge for melee attackers
        if (!t.ranged && e.stateT > e.attackWindup && e.stateT < e.attackWindup + 0.14) {
          moveX = toX * 1.0; moveZ = toZ * 1.0;
          speed = e.speed * 2.4;
        }
        if (!e.attackDidHit && e.stateT >= e.attackWindup) {
          e.attackDidHit = true;
          if (t.ranged) {
            this._rangedAttack(e, player);
          } else if (distFlat < t.attackRange + 1.4 && Math.abs(pp.y - e.pos.y) < 3.2) {
            this.onPlayerHit && this.onPlayerHit(e, e.damage, _v1.set(toX, 0, toZ));
          }
        }
        if (e.stateT > (t.ranged ? 0.95 : 0.72)) {
          e.state = 'chase';
          e.stateT = 0;
        }
      }

      /* --- boss special: fire breath sweep + wing gust --- */
      if (e.typeId === 'boss') this._bossBrain(e, dt, player, distFlat, toX, toZ);

      /* --- stuck recovery ---
       * These things steer, they don't path-find. A whelp wedged behind a
       * fountain would stall the whole wave, so if one stops making progress
       * for long enough it burrows and re-emerges near the player. */
      if (e.state === 'chase' || e.state === 'strafe') {
        // Progress, not speed: something sliding along a wall is still stuck.
        e.progressT = (e.progressT || 0) + dt;
        if (e.bestDist === undefined) e.bestDist = distFlat;
        if (distFlat < e.bestDist - 1.0) {
          e.bestDist = distFlat;
          e.stuckT = 0;
        } else if (distFlat > e.type.attackRange + 2) {
          e.stuckT = (e.stuckT || 0) + dt;
        }
        if (e.stuckT > 1.2 && e.stuckT < 4.5) {
          // try harder to slide around whatever is in the way
          e.avoidT = 0.4;
        }
        if (e.stuckT > 4.5) {
          e.stuckT = 0;
          e.bestDist = undefined;
          const relocated = ctx.findOpenPointNear && ctx.findOpenPointNear(pp.x, pp.z, 22);
          if (relocated) {
            this.vfx.burst(_v1.copy(e.pos).setY(e.pos.y + 0.5), 0x8a6a3a, 14, 5, { size: 0.4, life: 0.6 });
            e.pos.copy(relocated);
            e.vel.set(0, 0, 0);
            e.bestDist = undefined;
            this.vfx.burst(_v1.copy(e.pos).setY(e.pos.y + 0.5), 0xff6a2a, 18, 6, { size: 0.45, life: 0.7, up: 3 });
          }
        }
      }

      /* --- motion --- */
      const mLen = Math.hypot(moveX, moveZ);
      if (mLen > 0.001 && e.flinch <= 0) {
        moveX /= mLen; moveZ /= mLen;
        const accel = 12;
        e.vel.x += (moveX * speed - e.vel.x) * Math.min(1, accel * dt);
        e.vel.z += (moveZ * speed - e.vel.z) * Math.min(1, accel * dt);
      } else {
        const f = Math.exp(-6 * dt);
        e.vel.x *= f;
        e.vel.z *= f;
      }

      // don't climb inside the player
      {
        const rr = e.type.radius + 0.75;
        if (distFlat < rr) {
          const push = ((rr - distFlat) / rr) * 9;
          e.vel.x -= toX * push;
          e.vel.z -= toZ * push;
        }
      }

      // separation so packs don't stack up
      for (let j = 0; j < this.list.length; j++) {
        const o = this.list[j];
        if (o === e || o.hp <= 0) continue;
        const ox = e.pos.x - o.pos.x;
        const oz = e.pos.z - o.pos.z;
        const rr = e.type.radius + o.type.radius;
        const d2 = ox * ox + oz * oz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = ((rr - d) / d) * 2.6 / e.type.mass;
          e.vel.x += ox * push;
          e.vel.z += oz * push;
        }
      }

      e.vel.y -= 22 * dt;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      this.collision.resolve(e.pos, e.type.radius, e.type.height, 1.15);
      e.pos.y += e.vel.y * dt;
      const gy = this.collision.groundHeight(e.pos.x, e.pos.z, e.pos.y, e.type.radius, 1.2);
      if (e.pos.y <= gy) {
        e.pos.y = gy;
        e.vel.y = 0;
        e.onGround = true;
      } else e.onGround = false;

      /* --- facing + animation --- */
      const targetFacing = Math.atan2(-toX, -toZ);
      let diff = ((targetFacing - e.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      e.facing += diff * Math.min(1, dt * (e.state === 'attack' ? 9 : 5.5));
      e.object.position.copy(e.pos);
      e.object.rotation.y = e.facing;
      this._animate(e, dt, Math.hypot(e.vel.x, e.vel.z));
      this._flash(e);
      this._updateBar(e, ctx.camera);
    }
  }

  _rangedAttack(e, player) {
    const t = e.type;
    // fireballs leave the mouth, not the top of the hitbox
    const origin = e.typeId === 'boss'
      ? _v1.set(e.pos.x, e.pos.y + 4.7 * e.scale, e.pos.z)
      : _v1.set(e.pos.x, e.pos.y + t.height * 0.82, e.pos.z);
    if (e.typeId === 'boss') {
      // three-shot fan of fireballs
      for (let k = -1; k <= 1; k++) {
        const dir = _v2.copy(player.centre).sub(origin).normalize();
        const a = k * 0.11;
        const nx = dir.x * Math.cos(a) - dir.z * Math.sin(a);
        const nz = dir.x * Math.sin(a) + dir.z * Math.cos(a);
        this.onShoot && this.onShoot(e, origin, _v3.set(nx, dir.y, nz).normalize(), {
          color: 0xff7a2a, speed: 48, damage: e.damage, radius: 0.85, scale: 2.4, splash: 4.5, trail: 5,
        });
      }
    } else {
      const dir = _v2.copy(player.centre).sub(origin);
      // lead the target a little
      dir.addScaledVector(player.vel, 0.22).normalize();
      this.onShoot && this.onShoot(e, origin, dir, {
        color: 0xff8a3a, speed: 42, damage: e.damage, radius: 0.5, scale: 1.5, splash: 2.2, trail: 4,
      });
    }
    this.vfx.burst(origin, 0xff7a2a, 10, 5, { size: 0.3, life: 0.35, drag: 4 });
  }

  _bossBrain(e, dt, player, distFlat, toX, toZ) {
    if (!e.phase2 && e.hp < e.maxHp * 0.5) {
      e.phase2 = true;
      e.speed *= 1.25;
      e.type = { ...e.type, attackCd: e.type.attackCd * 0.7 };
      this.vfx.explosion(_v1.copy(e.pos).setY(e.pos.y + 4), 12, 0xff3a1a);
      this.onBossPhase && this.onBossPhase(e);
    }
    e.breathCd = (e.breathCd ?? 6) - dt;
    if (e.breath > 0) {
      e.breath -= dt;
      // continuous flame cone
      const origin = _v1.set(e.pos.x, e.pos.y + 4.6 * e.scale, e.pos.z);
      const fwd = _v2.set(-Math.sin(e.facing), 0, -Math.cos(e.facing));
      const sweep = Math.sin(e.breath * 5.2) * 0.35;
      const dir = _v3.set(
        fwd.x * Math.cos(sweep) - fwd.z * Math.sin(sweep),
        -0.12,
        fwd.x * Math.sin(sweep) + fwd.z * Math.cos(sweep),
      ).normalize();
      for (let k = 0; k < 3; k++) {
        this.vfx.emit(
          origin.x + dir.x * 2, origin.y, origin.z + dir.z * 2,
          dir.x * (16 + Math.random() * 16) + (Math.random() - 0.5) * 4,
          1 + (Math.random() - 0.5) * 3,
          dir.z * (16 + Math.random() * 16) + (Math.random() - 0.5) * 4,
          _c1.set(Math.random() < 0.4 ? 0xffe08a : 0xff5a1a), 1.0, 0.55, 1.2, 0.6,
        );
      }
      // cone damage
      const pd = _v1.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
      const pdist = pd.length();
      if (pdist < 22) {
        pd.normalize();
        if (pd.x * dir.x + pd.z * dir.z > 0.86) {
          this.onPlayerHit && this.onPlayerHit(e, 22 * dt * 6, pd, true);
        }
      }
      if (e.breath <= 0) e.breathCd = e.phase2 ? 4.5 : 7;
    } else if (e.breathCd <= 0 && distFlat < 30 && e.state !== 'attack') {
      e.breath = 1.9;
      e.state = 'chase';
      this.onBossRoar && this.onBossRoar(e);
    }
  }

  _animate(e, dt, speed) {
    const p = e.model.parts;
    const t = e.type;
    e.animPhase += dt * (2.0 + speed * (e.typeId === 'boss' ? 0.55 : 1.5));
    const ph = e.animPhase;
    const run = Math.min(1, speed / Math.max(1, t.speed));
    const atk = e.state === 'attack' ? Math.min(1, e.stateT / Math.max(0.01, e.attackWindup)) : 0;
    const atkOut = e.state === 'attack' && e.stateT > e.attackWindup
      ? Math.max(0, 1 - (e.stateT - e.attackWindup) / 0.4) : 0;

    if (p.legs) {
      for (const leg of p.legs) {
        const amp = 0.6 * (0.25 + run * 0.9);
        leg.hip.rotation.x = Math.sin(ph + leg.phase) * amp;
        leg.knee.rotation.x = Math.max(0, -Math.sin(ph + leg.phase - 0.7)) * amp * 1.4;
      }
    }
    if (p.body) {
      p.body.position.y = p.body.userData.baseY ?? (p.body.userData.baseY = p.body.position.y);
      p.body.position.y += Math.abs(Math.sin(ph)) * 0.06 * (0.3 + run) * (e.typeId === 'boss' ? 3 : 1);
      p.body.rotation.z = Math.sin(ph) * 0.05 * run;
      p.body.rotation.x = -run * 0.1 + atk * 0.18 - atkOut * 0.25 - (e.flinch > 0 ? 0.3 : 0);
    }
    if (p.tailSegs) {
      p.tailSegs.forEach((seg, i) => {
        seg.rotation.y = Math.sin(ph * 0.9 - i * 0.5) * (0.12 + run * 0.16);
        seg.rotation.x = Math.sin(ph * 0.7 - i * 0.4) * 0.06;
      });
    }
    if (p.neckSegs) {
      p.neckSegs.forEach((seg, i) => {
        seg.rotation.x = -0.12 + Math.sin(ph * 0.6 - i * 0.4) * 0.05 + (e.breath > 0 ? -0.16 : 0);
        seg.rotation.y = Math.sin(ph * 0.4 - i * 0.3) * 0.07;
      });
    }
    if (p.neck) {
      p.neck.rotation.x = -0.1 + atk * 0.4 - atkOut * 0.5;
    }
    if (p.head) {
      p.head.rotation.x = (e.breath > 0 ? 0.2 : 0) + Math.sin(ph * 0.8) * 0.04;
    }
    if (p.jaw) {
      const open = e.breath > 0 ? 0.75 : atkOut * 0.6 + (e.state === 'attack' ? atk * 0.35 : 0);
      if (p.jaw.rotation) p.jaw.rotation.x = open;
    }
    if (p.maw) {
      const s = e.breath > 0 ? 1.6 : 1;
      p.maw.scale.setScalar(s);
      p.maw.material.emissiveIntensity = e.breath > 0 ? 6 : 2.4;
    }
    if (p.wings) {
      p.wings.forEach((w, i) => {
        const g = w.group ?? w;
        const s = i === 0 ? -1 : 1;
        if (e.typeId === 'boss') {
          // folded against the back while walking, thrown wide for breath/attacks
          const open = Math.max(e.breath > 0 ? 1 : 0, atk);
          const flap = Math.sin(ph * 1.6) * 0.5;
          // folded down along the flanks; raised and swept forward when it rears
          g.rotation.z = s * (0.85 - open * 1.15 + flap * 0.12);
          g.rotation.y = s * (0.75 - open * 0.55 + Math.sin(ph * 1.6 + 0.5) * 0.08);
          if (w.elbow) w.elbow.rotation.z = -s * (1.5 - open * 1.1);
        } else {
          const flap = Math.sin(ph * 2.4 + i) * 0.3;
          g.rotation.z = s * (0.35 + flap);
          g.rotation.x = flap * 0.3;
        }
      });
    }
    if (p.arms) {
      p.arms.forEach((a, i) => {
        const s = i === 0 ? -1 : 1;
        if (e.state === 'attack') {
          const swing = i === 0 ? atk : atk * 0.4;
          a.shoulder.rotation.x = -0.2 - swing * 1.9 + atkOut * 2.4;
          a.elbow.rotation.x = -0.5 + swing * 0.4;
        } else {
          a.shoulder.rotation.x = Math.sin(ph + (i ? Math.PI : 0)) * 0.35 * (0.2 + run);
          a.shoulder.rotation.z = s * 0.12;
          a.elbow.rotation.x = -0.35 - Math.abs(Math.sin(ph + (i ? Math.PI : 0))) * 0.3;
        }
      });
    }
    if (p.throat) {
      p.throat.scale.setScalar(1 + atk * 0.6);
      p.throat.material.emissiveIntensity = 1.8 + atk * 5;
    }
    if (p.core) {
      p.core.material.emissiveIntensity = 2.2 + Math.sin(ph * 2) * 0.5 + atk * 4;
    }
  }

  /** Billboard the bar and show it only for wounded, non-boss enemies. */
  _updateBar(e, camera) {
    const bar = e.bar;
    if (!bar) return;
    const frac = e.hp / e.maxHp;
    if (!camera || e.typeId === 'boss' || e.hp <= 0 || frac >= 0.999) {
      bar.group.visible = false;
      return;
    }
    bar.group.visible = true;
    // local space: undo the parent's yaw and per-type scale
    const h = e.type.height / e.scale + 0.55;
    bar.group.position.set(0, h, 0);
    bar.group.rotation.set(0, -e.facing + Math.atan2(
      camera.position.x - e.pos.x, camera.position.z - e.pos.z), 0);
    bar.fg.scale.x = bar.width * Math.max(0, frac);
    bar.fg.position.x = -bar.width * (1 - frac) * 0.5;
    bar.fg.material.color.setRGB(1 - frac * 0.35, 0.25 + frac * 0.5, 0.2);
  }

  _flash(e) {
    const f = e.hurt;
    for (const mt of e.flashMats) {
      if (!mt.emissive) continue;
      if (f > 0.01) {
        if (!mt.userData.savedEmissive) {
          mt.userData.savedEmissive = mt.emissive.clone();
          mt.userData.savedIntensity = mt.emissiveIntensity;
        }
        // a tint, not a floodlight: large surfaces blow out fast under ACES
        mt.emissive.setRGB(1, 0.34, 0.2);
        mt.emissiveIntensity = f * 0.85;
      } else if (mt.userData.savedEmissive) {
        mt.emissive.copy(mt.userData.savedEmissive);
        mt.emissiveIntensity = mt.userData.savedIntensity;
        mt.userData.savedEmissive = null;
      }
    }
  }
}

/**
 * Closest approach between segment P(s) = p + s*u and segment Q(t) = q + t*v,
 * with s and t clamped to [0,1]. Returns { s, t, dist }.
 */
const _res = { s: 0, t: 0, dist: 0 };
function closestOnSegments(px, py, pz, ux, uy, uz, qx, qy, qz, vx, vy, vz) {
  const wx = px - qx, wy = py - qy, wz = pz - qz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const denom = a * c - b * b;
  let s, t;
  if (denom < 1e-9) {
    s = 0;
    t = c > 1e-9 ? e / c : 0;
  } else {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  }
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  // re-solve t for the clamped s, then clamp and re-solve s: one pass is plenty here
  t = c > 1e-9 ? (e + b * s) / c : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  s = a > 1e-9 ? (b * t - d) / a : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const dx = wx + ux * s - vx * t;
  const dy = wy + uy * s - vy * t;
  const dz = wz + uz * s - vz * t;
  _res.s = s;
  _res.t = t;
  _res.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return _res;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c1 = new THREE.Color();
