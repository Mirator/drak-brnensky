import * as THREE from 'three';
import { PROFILE, polyPath } from './detail.js';
import { mergeAll } from '../geometry.js';

/**
 * Stará radnice — the old town hall.
 *
 * Sourced (docs/brno-reference.md §3):
 * - tower **62.66 m**, 173 steps (two independent sources agree). `TOWER_H`
 *   is the only place that height is written down in the file.
 * - the tower is a composite of three campaigns — a 13th-c. base, +4 m by
 *   Pietro Gabri in 1577, +5 m in the 1904-05 makeover — so the masonry is
 *   banded: dark medieval ashlar low down, warmer stone above the third string
 *   course, pale 1900s stone at the gallery and lantern.
 * - **Pilgram's portal, 1510-11**: five pinnacles, the centre one visibly bent.
 *   The councillors shorted his fee and he left the crooked spire as a grudge
 *   in stone. It is the single most recognisable detail on the building, so it
 *   is built as a straight stub carrying a spirelet kinked hard off the axis —
 *   a bend, not a lean.
 * - the crocodile ("dragon") and the cartwheel hang in the **same** vaulted
 *   passage as the portal, which the player walks through.
 * - Renaissance arcaded courtyard gallery, 1587-88.
 *
 * GUESSED: no plan dimensions were sourced. 28 m of street frontage, 19 m deep
 * to the courtyard, 27 m of site in total.
 */

export const SITE = { cx: -18, cz: 44 };
/** The corroborated height: 62.66 m to the tip of the finial. */
export const TOWER_H = 62.66;

/** True ground footprint — block, passage and the arcaded courtyard behind. */
export const RECTS = [
  [SITE.cx, SITE.cz + 3, 28, 27],
];

export function build(b, ctx) {
  const { M, info, group, animated } = ctx;
  const { cx, cz } = SITE;
  b.cluster('oldtown');

  const NORTH = cz - 10; // the Radnická street frontage, z = 34
  const DEPTH = 19;
  const EAVES = 16;
  const PASS_X = cx - 9; // centre line of the vaulted passage
  const PASS_W = 4.2;
  const PASS_H = 5.4;

  /* ================= 1. the block and its passage ================== */
  b.tier(0);
  // The passage block is one extruded mass with the passage as a real hole, so
  // the barrel vault you walk under is genuine geometry seen from inside.
  b.place(M.sandstone, b.p('archedWall', 10, EAVES, DEPTH, PASS_W, PASS_H, { spring: 0.5 }),
    PASS_X, 0, NORTH, {});
  b.solid(PASS_X - PASS_W / 2 - 1.45, NORTH + DEPTH / 2, 2.9, DEPTH, 0, EAVES);
  b.solid(PASS_X + PASS_W / 2 + 1.45, NORTH + DEPTH / 2, 2.9, DEPTH, 0, EAVES);
  b.box(M.sandstone, cx + 5, 0, NORTH + DEPTH / 2, 18, EAVES, DEPTH);

  b.mould(M.stonePale, cx, 0, NORTH + DEPTH / 2, 28.6, DEPTH + 0.6, PROFILE.plinth);
  b.mould(M.stonePale, cx, EAVES - 0.95, NORTH + DEPTH / 2, 28.4, DEPTH + 0.4, PROFILE.cornice);
  b.gable(M.roof, cx, EAVES, NORTH + DEPTH / 2, 29, DEPTH + 1, 6.4);
  b.mould(M.stonePale, cx, 4.7, NORTH + DEPTH / 2, 28.3, DEPTH + 0.3, PROFILE.string);
  // rusticated banding across the ground storey
  b.tier(1);
  for (let i = -13.2; i <= 13.2; i += 1.9) {
    for (const y of [1.0, 2.3, 3.6]) {
      if (Math.abs(cx + i - PASS_X) < PASS_W / 2 + 0.3) continue;
      b.raw(M.stonePale, new THREE.BoxGeometry(1.72, 0.3, 0.16).translate(cx + i, y, NORTH - 0.08));
    }
  }
  b.tier(0);
  // gabled dormers over the street
  for (const dx of [-8.5, 1, 10]) {
    b.raw(M.roof, new THREE.BoxGeometry(2.6, 2.8, 2.6).translate(cx + dx, EAVES + 1.4, NORTH + 3.4));
    b.raw(M.roof, new THREE.ConeGeometry(2.1, 1.8, 4).rotateY(Math.PI / 4).translate(cx + dx, EAVES + 3.7, NORTH + 3.4));
    b.raw(M.litGlass, new THREE.BoxGeometry(1.2, 1.5, 0.2).translate(cx + dx, EAVES + 1.5, NORTH + 2.15));
  }
  // street windows with moulded surrounds; skip the passage bay
  for (let f = 0; f < 3; f++) {
    for (let i = -4; i <= 4; i++) {
      const x = cx + i * 3.1;
      if (Math.abs(x - PASS_X) < 3.4) continue;
      b.window(x, 5.7 + f * 3.4, NORTH - 0.06, 1.5, 2.4, { kind: 'baroque' });
    }
  }

  /* ================= 2. the tower — 62.66 m ======================== */
  const tx = cx + 7, tz = NORTH + 7;
  const S1 = 30, S2 = 38, LANT = 46, SPIRE_TOP = 57.6;
  b.tier(0);
  b.box(M.darkStone, tx, 0, tz, 10.4, S1, 10.4); // 13th-century base and shaft
  b.box(M.sandstone, tx, S1, tz, 9.6, S2 - S1, 9.6); // 1577, Gabri: +4 m
  b.mould(M.stonePale, tx, S1 - 0.4, tz, 10.9, 10.9, PROFILE.string);
  for (const y of [9.5, 18, 25]) b.mould(M.stonePale, tx, y, tz, 10.7, 10.7, PROFILE.string);
  b.mould(M.stonePale, tx, S2 - 1.1, tz, 10.6, 10.6, PROFILE.cornice); // 1904-05: +5 m
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    b.balustrade(tx + dx * 5.2, S2 - 0.05, tz + dz * 5.2, 9.2, { h: 1.35, rotY: dx ? Math.PI / 2 : 0 });
  }
  b.tier(1);
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.place(M.stonePale, b.p('pinnacle', 8.2, 1.7), tx + ox * 5.3, S2 - 0.3, tz + oz * 5.3, {});
  }
  for (let f = 0; f < 4; f++) {
    b.window(tx, 8.6 + f * 6.6, tz - 5.26, 2.2, 4.6, { lights: 2 });
    b.window(tx + 5.26, 8.6 + f * 6.6, tz, 2.2, 4.6, { lights: 2, rotY: -Math.PI / 2 });
  }
  // octagonal lantern
  b.tier(0);
  b.cyl(M.stonePale, tx, S2 + 1.3, tz, 3.9, 4.3, LANT - S2 - 1.3, 8, { solid: true, rotY: Math.PI / 8 });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    b.raw(M.litGlass, new THREE.BoxGeometry(1.7, 3.8, 0.3).rotateY(a)
      .translate(tx + Math.sin(a) * 3.85, S2 + 3.7, tz + Math.cos(a) * 3.85));
  }
  b.mould(M.stonePale, tx, LANT - 1.0, tz, 0, 0, PROFILE.cornice, { path: polyPath(8, 4.5, Math.PI / 8) });
  b.cone(M.copper, tx, LANT, tz, 4.4, SPIRE_TOP - LANT, 8, { rotY: Math.PI / 8 });
  b.tier(1);
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
    if (k % 2 === 0) {
      b.place(M.stonePale, b.p('pinnacle', 5.4, 1.2), tx + Math.sin(a) * 4.3, LANT - 0.4, tz + Math.cos(a) * 4.3, {});
    }
    for (let i = 0; i < 5; i++) {
      const t = 0.22 + (i / 5) * 0.68;
      b.place(M.stonePale, b.p('crocket'), tx + Math.sin(a) * 4.4 * (1 - t),
        LANT + (SPIRE_TOP - LANT) * t, tz + Math.cos(a) * 4.4 * (1 - t), { scale: 1.3 - t * 0.5, rotY: a });
    }
  }
  // finial: the tip lands on exactly 62.66 m
  b.tier(0);
  b.cyl(M.gold, tx, SPIRE_TOP, tz, 0.16, 0.24, 1.5, 6);
  b.sphere(M.gold, tx, SPIRE_TOP + 2.1, tz, 0.62);
  b.cyl(M.gold, tx, SPIRE_TOP + 2.1, tz, 0.09, 0.1, TOWER_H - SPIRE_TOP - 2.1, 5);
  b.raw(M.gold, new THREE.BoxGeometry(1.1, 0.13, 0.13).translate(tx, TOWER_H - 0.55, tz));
  // clock on the street face
  b.discZ(M.stonePale, tx, 28.4, tz - 5.3, 2.3, 0.34, 18);
  b.discZ(M.granite, tx, 28.4, tz - 5.5, 1.95, 0.2, 18);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.raw(M.gold, new THREE.BoxGeometry(0.13, 0.34, 0.1).rotateZ(-a)
      .translate(tx + Math.sin(a) * 1.6, 28.4 + Math.cos(a) * 1.6, tz - 5.62));
  }
  b.raw(M.gold, new THREE.BoxGeometry(0.17, 1.2, 0.1).rotateZ(0.9).translate(tx - 0.42, 28.9, tz - 5.66));
  b.raw(M.gold, new THREE.BoxGeometry(0.12, 1.7, 0.1).rotateZ(-2.1).translate(tx + 0.72, 27.7, tz - 5.66));

  /* ================= 3. Pilgram's portal, 1510-11 ================== */
  const px = PASS_X, pz = NORTH;
  b.tier(1);
  // three moulded archivolts stepping out of the passage mouth
  for (let k = 0; k < 3; k++) {
    b.place(M.stonePale, b.p('archRing', PASS_W + 0.6 + k * 0.95, PASS_H + 0.6 + k * 0.75, 0.44, 0.42, 0.5,
      { steps: 6, bevel: 0.05 }), px, 0, pz - 0.05 - k * 0.42, {});
  }
  // shield-bearing civic figures on brackets either side
  for (const s of [-1, 1]) {
    b.raw(M.stonePale, new THREE.BoxGeometry(0.95, 0.5, 0.75).translate(px + s * 3.6, 4.2, pz - 1.6));
    b.place(M.stonePale, b.p('figure', 'standing', s > 0 ? 3 : 8), px + s * 3.6, 4.45, pz - 1.7,
      { scale: 2.0, rotY: Math.PI });
    b.place(M.stonePale, b.p('quatrefoilPanel', 1.05, 1.15, 0.24), px + s * 3.6, 2.8, pz - 1.8, { rotY: Math.PI });
  }
  // the crocketed hood mould climbing over the arch
  for (let k = 0; k <= 5; k++) {
    const t = k / 5;
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('crocket'), px + s * 2.8 * (1 - t), PASS_H + 1.0 + t * 3.2, pz - 1.95,
        { scale: 1.45, rotY: s * Math.PI / 2 });
    }
  }
  b.tier(0).mould(M.stonePale, px, PASS_H + 4.4, pz - 1.7, 8.6, 1.6, PROFILE.cap);

  /**
   * The five pinnacles (fiály). Numbers 1, 2, 4 and 5 are dead straight;
   * number 3 — the middle one — is deliberately, visibly bent.
   */
  b.tier(1);
  for (let i = 0; i < 5; i++) {
    const fx = px + (i - 2) * 2.2;
    if (i !== 2) {
      b.place(M.stonePale, b.p('pinnacle', 4.5, 0.98), fx, PASS_H + 4.6, pz - 1.7, {});
    } else {
      b.place(M.stonePale, b.p('pinnacle', 2.1, 1.08), fx, PASS_H + 5.4, pz - 1.7, {});
      // the kink: 24 degrees off the vertical and swung round with it
      b.place(M.stonePale, b.p('pinnacle', 4.1, 0.92), fx + 0.2, PASS_H + 7.3, pz - 1.85,
        { rotZ: 0.42, rotX: 0.17, rotY: 0.3 });
    }
  }

  /* ================= 4. the Renaissance arcaded courtyard ========== */
  const yardZ = NORTH + DEPTH + 2.5; // 55.5
  const WINGS = [
    { x: cx - 12.4, z: yardZ, len: 7, along: [0, 1], face: [1, 0] },
    { x: cx + 12.4, z: yardZ, len: 7, along: [0, 1], face: [-1, 0] },
    { x: cx, z: yardZ + 3.4, len: 25, along: [1, 0], face: [0, -1] },
  ];
  for (const w of WINGS) {
    const [ax, az] = w.along;
    const wx = ax ? w.len : 3.2, wz = ax ? 3.2 : w.len;
    b.tier(0).box(M.sandstone, w.x, 0, w.z, wx, 11, wz);
    b.mould(M.stonePale, w.x, 10.2, w.z, wx + 0.4, wz + 0.4, PROFILE.cornice);
    b.gable(M.roof, w.x, 11, w.z, wx + 0.6, wz + 0.6, 3.2);
    const n = Math.max(2, Math.round(w.len / 3.2));
    const rotY = ax ? 0 : -Math.PI / 2 * w.face[0];
    for (let i = 0; i < n; i++) {
      const u = -w.len / 2 + (w.len / n) * (i + 0.5);
      const bx = w.x + ax * u + w.face[0] * 1.65;
      const bz = w.z + (w.along[1] ? u : 0) + w.face[1] * 1.65;
      for (const [yy, hh] of [[0.35, 4.9], [5.7, 4.1]]) {
        b.tier(1).place(M.stonePale, b.p('roundArchRing', 2.5, hh - 0.4, 0.34, 0.65, { steps: 5, bevel: 0.05 }),
          bx, yy, bz, { rotY });
        b.tier(0).box(M.doorway, bx - w.face[0] * 0.4, yy, bz - w.face[1] * 0.4,
          ax ? 2.0 : 0.3, hh - 1.0, ax ? 0.3 : 2.0, { solid: false });
      }
      b.tier(1).place(M.stonePale, b.p('column', 5.4, 0.32, 1),
        bx + ax * (w.len / n) / 2, 0.35, bz + w.along[1] * (w.len / n) / 2, {});
    }
    b.tier(0);
  }
  b.balustrade(cx, 5.3, yardZ + 1.8, 24, { h: 1.1 });

  /* ================= 5. the dragon and the wheel =================== */
  // Both hang in the vaulted passage, exactly as the real ones do.
  const dz = NORTH + 8;
  const dragon = new THREE.Group();
  {
    const segs = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const r = 0.55 * (1 - t * 0.75) + 0.12;
      segs.push(new THREE.BoxGeometry(r * 2, r * 1.5, 0.75).translate(0, 0, i * 0.72));
      segs.push(new THREE.ConeGeometry(0.16, 0.4, 4).translate(0, r * 0.9, i * 0.72));
    }
    segs.push(new THREE.BoxGeometry(1.15, 0.62, 1.9).translate(0, 0.05, -1.1));
    segs.push(new THREE.BoxGeometry(1.0, 0.3, 1.7).translate(0, -0.42, -1.2));
    for (let i = 0; i < 6; i++) {
      segs.push(new THREE.ConeGeometry(0.08, 0.3, 4).rotateX(Math.PI)
        .translate(-0.35 + (i % 3) * 0.35, -0.18, -0.5 - Math.floor(i / 3) * 0.6));
    }
    for (const [sx, sz] of [[-1, 0.9], [1, 0.9], [-1, 4.1], [1, 4.1]]) {
      segs.push(new THREE.BoxGeometry(0.28, 0.9, 0.32).translate(sx * 0.62, -0.45, sz));
    }
    const mesh = new THREE.Mesh(mergeAll(segs), M.dragonSkin);
    mesh.name = 'brno-dragon';
    mesh.castShadow = true;
    dragon.add(mesh);
    const eyes = [];
    for (const s of [-1, 1]) eyes.push(new THREE.SphereGeometry(0.11, 7, 5).translate(s * 0.36, 0.24, -1.75));
    const eyeMesh = new THREE.Mesh(mergeAll(eyes), M.ember);
    eyeMesh.name = 'brno-dragon-eyes';
    dragon.add(eyeMesh);
  }
  dragon.position.set(PASS_X, 4.3, dz);
  dragon.rotation.y = Math.PI / 2 + 0.12; // hangs broadside, like the real one
  dragon.scale.setScalar(1.15);
  group.add(dragon);
  animated.push({ obj: dragon, kind: 'sway', base: dragon.position.y });

  // the iron bracket and its chains
  b.tier(0);
  b.raw(M.metal, new THREE.BoxGeometry(4.0, 0.28, 0.28).translate(PASS_X, 5.9, dz));
  for (const off of [-1.7, 1.7]) {
    b.raw(M.metal, new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5).translate(PASS_X + off, 5.2, dz));
  }

  // the Brno Wheel, hung flat against the passage wall
  {
    const wx = PASS_X + PASS_W / 2 - 0.32, wy = 2.6, wz = dz + 3.6;
    b.raw(M.metal, new THREE.TorusGeometry(1.32, 0.09, 5, 18).rotateY(Math.PI / 2).translate(wx, wy, wz));
    b.raw(M.wood, new THREE.TorusGeometry(1.18, 0.14, 4, 16).rotateY(Math.PI / 2).translate(wx, wy, wz));
    for (let i = 0; i < 10; i++) {
      b.raw(M.wood, new THREE.BoxGeometry(0.12, 2.36, 0.12)
        .rotateX((i / 10) * Math.PI).rotateY(Math.PI / 2).translate(wx, wy, wz));
    }
    b.raw(M.wood, new THREE.CylinderGeometry(0.24, 0.24, 0.45, 8).rotateZ(Math.PI / 2).translate(wx, wy, wz));
  }

  info.radnice = {
    name: 'Stará radnice',
    pos: new THREE.Vector3(cx, 0, NORTH - 2),
    radius: 22,
    top: TOWER_H,
  };
}
