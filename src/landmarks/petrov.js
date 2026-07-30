import * as THREE from 'three';
import { PROFILE, polyPath, linePath, roseWindow, sweepProfile } from './detail.js';

/**
 * Katedrála sv. Petra a Pavla — the hero building.
 *
 * Sourced (docs/brno-reference.md §1):
 * - twin spires **84.0 m** to the tip. `SPIRE_TIP` is the single number every
 *   tower stage is derived from, so the height cannot drift as the model
 *   changes. The dossier's stray "81 m" is treated as the flagged outlier.
 * - stepped/tiered buttresses (odstupňované opěráky) per the heritage catalogue.
 * - a terraced platform with retaining walls dropping toward Zelný trh.
 * - baroque body (Grimm, 18th c.), neo-gothic presbytery (1879-91) and
 *   neo-gothic west front and towers (Kirstein, 1904-09). The window
 *   vocabulary therefore *changes along the building*: round-arched baroque
 *   over nave and aisles, pointed tracery over presbytery and towers.
 * - the clock reads **11:00**. Brno rings noon an hour early because in 1645
 *   the defenders rang it early and Torstenson's Swedes lifted the siege.
 *
 * GUESSED — the dossier explicitly could not source these:
 * - nave/footprint dimensions: 22 m nave, 6 m aisles, 44 m body, 16 m
 *   presbytery with a 5/8 apse. Chosen to fit the terrace and the street grid.
 * - rose window diameter: 8.0 m (R = 4.0).
 */

export const SITE = { cx: -108, cz: 172 };
/** Terrace platform top. Everything above the ground is measured from here. */
export const BASE_Y = 6.6;
/** The corroborated number: 84 m from the platform to the tip of the cross. */
export const SPIRE_TIP = 84.0;

/** True ground footprint — platform, retaining walls, the great north stair. */
export const RECTS = [
  [SITE.cx, SITE.cz + 4, 112, 110],
  [SITE.cx, SITE.cz - 50, 16, 12],
];

export function build(b, ctx) {
  const { M, info } = ctx;
  const { cx, cz } = SITE;
  const baseY = BASE_Y;
  b.cluster('petrov');

  /* ================= 1. blockout: the terraced hill ================= */
  // Shallow 0.55 m terraces, so the hill stays walkable from the south and
  // west. The north and east faces get real retaining walls instead — which
  // is what the Petrov terraces actually are.
  b.mound(M.grass, M.darkStone, cx, cz + 4, 112, 92, baseY, 0.55);

  const wallZ = cz - 44;
  const retain = (x, z, len, rotY) => {
    b.tier(0).mould(M.darkStone, x, 0, z, 0, 0, PROFILE.batter(2.6, baseY - 0.35, 0.7),
      { path: linePath(len), closed: false, rotY });
    b.mould(M.stonePale, x, baseY - 0.35, z, 0, 0, PROFILE.coping(2.6, 0.32, 0.35),
      { path: linePath(len + 0.2), closed: false, rotY });
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    b.solid(x, z, len * c + 4 * s, len * s + 4 * c, 0, baseY - 0.3);
  };
  for (const sx of [-1, 1]) {
    const len = 34, wx = cx + sx * (8 + len / 2);
    retain(wx, wallZ, len, 0);
    b.balustrade(wx, baseY - 0.03, wallZ, len, { h: 1.15 });
  }
  retain(cx + 50, cz + 6, 70, Math.PI / 2);
  b.balustrade(cx + 50, baseY - 0.03, cz + 6, 70, { h: 1.15, rotY: Math.PI / 2 });

  // the great stair up the axis, and a service flight from the east
  b.stairs(M.darkStone, cx, 0, wallZ - 4.6, 15, 0, 1, 13, 0.5, 0.72);
  b.stairs(M.darkStone, cx + 48, 0, cz + 40, 7, -1, 0, 13, 0.5, 0.72);
  for (const s of [-1, 1]) {
    b.tier(0).box(M.darkStone, cx + s * 8.6, 0, wallZ - 1.0, 2.0, baseY + 0.4, 4.0);
    b.tier(1).place(M.stonePale, b.p('pinnacle', 4.6, 1.5), cx + s * 8.6, baseY + 0.4, wallZ - 1.0, {});
  }

  /* ================= 2. structural masses ========================== */
  const NAVE_W = 22, AISLE_W = 6, TOWER = 13;
  const naveZ = cz + 8, naveD = 44;
  const naveN = naveZ - naveD / 2, naveS = naveZ + naveD / 2;
  const eavesAisle = 13, eavesNave = 23, eavesChoir = 19;
  const aisleFace = NAVE_W / 2 + AISLE_W;
  const choirZ = naveS + 7;
  const apseZ = choirZ + 7;

  b.tier(0);
  b.box(M.stone, cx, baseY, naveZ, NAVE_W, eavesNave, naveD);
  for (const s of [-1, 1]) {
    b.box(M.stone, cx + s * (NAVE_W / 2 + AISLE_W / 2), baseY, naveZ, AISLE_W, eavesAisle, naveD - 4);
  }
  b.box(M.stone, cx, baseY, choirZ, 16, eavesChoir, 14);
  b.cyl(M.stone, cx, baseY, apseZ, 8, 8, eavesChoir, 8, { solid: true, rotY: Math.PI / 8 });

  /* ================= 3. form: cornices, buttresses, roofs ========== */
  b.tier(0).mould(M.darkStone, cx, baseY, naveZ, NAVE_W + AISLE_W * 2 + 0.5, naveD + 0.5, PROFILE.plinth);
  b.mould(M.stonePale, cx, baseY + eavesAisle - 0.95, naveZ, aisleFace * 2 + 0.4, naveD - 3.6, PROFILE.cornice);
  b.mould(M.stonePale, cx, baseY + eavesNave - 0.95, naveZ, NAVE_W + 0.4, naveD + 0.4, PROFILE.cornice);
  b.mould(M.stonePale, cx, baseY + eavesChoir - 0.95, choirZ, 16.4, 14.4, PROFILE.cornice);
  b.mould(M.stonePale, cx, baseY + eavesChoir - 0.95, apseZ, 0, 0, PROFILE.cornice,
    { path: polyPath(8, 8.3, Math.PI / 8) });

  b.gable(M.roof, cx, baseY + eavesNave, naveZ, NAVE_W + 1.0, naveD + 1.0, 9);
  for (const s of [-1, 1]) {
    b.gable(M.roof, cx + s * (NAVE_W / 2 + AISLE_W / 2), baseY + eavesAisle, naveZ, AISLE_W + 0.6, naveD - 3.4, 2.8);
  }
  b.gable(M.roof, cx, baseY + eavesChoir, choirZ, 16.6, 14.6, 7);
  b.cone(M.roof, cx, baseY + eavesChoir, apseZ, 8.7, 8.5, 8, { rotY: Math.PI / 8 });
  // ridge cresting
  b.tier(1);
  for (let z = -20; z <= 20; z += 2.4) {
    b.place(M.stonePale, b.p('crocket'), cx, baseY + eavesNave + 9.05, naveZ + z, { scale: 1.6, rotX: -Math.PI / 2 });
  }

  /**
   * Stepped buttress: a broad solid lower stage (the one you take cover
   * behind), a weathered set-back, a narrower upper stage, and a pinnacle.
   * `dir` is ±1 for the east/west flanks, 0 for the ones facing along z.
   */
  const buttress = (bx, bz, dir) => {
    const w = 2.9, d = 2.5;
    const wx = dir ? d : w, wz = dir ? w : d;
    b.tier(0).box(M.stone, bx, baseY, bz, wx, 9.6, wz);
    b.mould(M.stonePale, bx, baseY + 9.6, bz, wx + 0.34, wz + 0.34, PROFILE.setback);
    const ix = bx - dir * 0.4;
    b.box(M.stone, ix, baseY + 10.3, bz, wx - 0.8, 6.0, wz - 0.8, { solid: false });
    b.mould(M.stonePale, ix, baseY + 16.3, bz, wx - 0.45, wz - 0.45, PROFILE.cap);
    b.tier(1).place(M.stonePale, b.p('pinnacle', 7.6, 1.6), ix, baseY + 16.6, bz, {});
  };
  const BUTT_Z = [-14, -4.6, 4.8, 14.2];
  for (const i of BUTT_Z) for (const s of [-1, 1]) buttress(cx + s * (aisleFace + 1.2), naveZ + i, s);
  for (const s of [-1, 1]) {
    buttress(cx + s * 9.2, choirZ - 5, s);
    buttress(cx + s * 9.2, choirZ + 4.5, s);
  }

  /* ================= 4. openings on the baroque body =============== */
  const WIN_Z = [-9.3, 0.1, 9.5];
  for (const i of WIN_Z) {
    for (const s of [-1, 1]) {
      const rotY = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      b.window(cx + s * (aisleFace + 0.06), baseY + 4.4, naveZ + i, 2.1, 4.8, { kind: 'baroque', rotY });
      b.window(cx + s * (NAVE_W / 2 + 0.06), baseY + 15.4, naveZ + i, 2.0, 4.4, { kind: 'baroque', rotY });
    }
  }
  // neo-gothic presbytery: three-light tracery to the flanks, two-light to
  // the apse facets
  for (const s of [-1, 1]) {
    b.window(cx + s * 8.06, baseY + 5.4, choirZ - 0.2, 3.4, 10, { lights: 3, rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
  }
  for (const k of [-1, 0, 1]) {
    const a = k * (Math.PI / 4);
    b.window(cx + Math.sin(a) * 8.06, baseY + 5.4, apseZ + Math.cos(a) * 8.06, 2.6, 9, { lights: 2, rotY: a + Math.PI });
  }
  // south transept-ish gable end of the nave, blind arcaded
  b.tier(1);
  for (let k = -1; k <= 1; k++) {
    b.place(M.stonePale, b.p('archRing', 3.0, 7.0, 0.4, 0.45, 0.5, { steps: 5 }),
      cx + k * 6.2, baseY + 6, naveN - 0.05, { rotY: 0 });
  }

  /* ================= 5. the west front ============================= */
  const towerZ = naveN - 0.5;
  const frontZ = towerZ - TOWER / 2;
  const FRONT_W = TOWER * 2 - 15; // clear span between the tower inner faces
  const shaftTop = 40;
  const roseR = 4.0;
  const roseY = 26.5;

  b.tier(0);
  // lower stage: the portal is a real hole through a 3.2 m thick wall
  b.place(M.stone, b.p('archedWall', FRONT_W, 17, 3.2, 7.6, 13, { spring: 0.5 }), cx, baseY, frontZ, {});
  b.solid(cx, frontZ + 1.6, FRONT_W + 0.4, 3.4, baseY, 34);
  // rose stage: four panels around the opening, so the tracery is seen against
  // the lit interior rather than pasted onto a wall
  b.place(M.stone, b.p('circleWall', FRONT_W, 17, 3.2, roseR + 0.6, roseY - 17), cx, baseY + 17, frontZ, {});
  // doors, trumeau and tympanum
  b.box(M.doorway, cx - 1.95, baseY, frontZ + 2.5, 3.1, 9.2, 0.7, { solid: false });
  b.box(M.doorway, cx + 1.95, baseY, frontZ + 2.5, 3.1, 9.2, 0.7, { solid: false });
  b.box(M.stonePale, cx, baseY, frontZ + 2.4, 0.7, 9.6, 0.9, { solid: false });
  b.place(M.stonePale, b.p('archPanel', 7.0, 3.6, 0.5), cx, baseY + 9.3, frontZ + 1.9, {});
  b.tier(1);
  b.place(M.stonePale, b.p('figure', 'standing', 41), cx, baseY + 9.9, frontZ + 1.6, { scale: 2.4, rotY: Math.PI });
  // archivolts: concentric moulded rings stepping back into the reveal
  for (let k = 0; k < 3; k++) {
    b.place(M.stonePale, b.p('archRing', 7.6 + k * 1.55, 13 + k * 1.15, 0.72, 0.55, 0.5, { steps: 7, bevel: 0.07 }),
      cx, baseY, frontZ - 0.06 - k * 0.52, {});
  }
  // jamb figures
  for (let k = 0; k < 3; k++) {
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('figure', 'saint', k * 2 + (s > 0 ? 1 : 0)),
        cx + s * (4.6 + k * 0.85), baseY + 3.6, frontZ - 0.45 - k * 0.52, { scale: 2.1, rotY: Math.PI });
    }
  }
  // wimperg: a steep crocketed gable over the portal with a finial
  const wRise = 6.2, wHalf = 6.2;
  const wAng = Math.atan2(wHalf, wRise);
  for (const s of [-1, 1]) {
    const len = Math.hypot(wHalf, wRise);
    b.raw(M.stonePale, new THREE.BoxGeometry(0.95, len, 0.85)
      .rotateZ(s * wAng).translate(cx + s * (wHalf / 2), baseY + 13.4 + wRise / 2, frontZ - 0.62));
  }
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('crocket'), cx + s * wHalf * (1 - t) * 0.95, baseY + 13.9 + t * wRise, frontZ - 0.8,
        { scale: 1.6, rotY: s * Math.PI / 2 });
    }
  }
  b.place(M.stonePale, b.p('pinnacle', 2.2, 1.0), cx, baseY + 19.5, frontZ - 0.62, {});
  for (const s of [-1, 1]) b.place(M.stonePale, b.p('pinnacle', 9.0, 1.8), cx + s * 5.1, baseY + 13.4, frontZ - 0.5, {});

  /**
   * The rose window as geometry: a moulded rim, twelve radiating tracery
   * bars, cusped lights between them, a sexfoil hub. Not a painted disc.
   * Diameter guessed at 8 m — the dossier could not source one.
   */
  b.tier(1).raw(M.stonePale, roseWindow(roseR, { spokes: 12, depth: 0.9 })
    .translate(cx, baseY + roseY, frontZ - 0.5));
  b.tier(0).raw(M.stonePale, sweepProfile(PROFILE.cap, polyPath(24, roseR + 0.62), { closed: true })
    .rotateX(-Math.PI / 2).translate(cx, baseY + roseY, frontZ - 0.55));
  b.discZ(M.litGlass, cx, baseY + roseY, frontZ + 1.4, roseR * 0.95, 0.3, 24);
  // front parapet with statues, between the towers
  b.tier(0).mould(M.stonePale, cx, baseY + 33.2, frontZ + 1.6, FRONT_W + 0.6, 3.6, PROFILE.cornice);
  b.balustrade(cx, baseY + 33.8, frontZ + 0.4, FRONT_W - 0.6, { h: 1.5 });
  b.tier(1);
  for (const s of [-1, 0, 1]) {
    b.place(M.stonePale, b.p('figure', 'saint', 50 + s), cx + s * 3.2, baseY + 35.3, frontZ + 1.0, { scale: 2.6, rotY: Math.PI });
  }

  /* ================= 6. the twin towers ============================ */
  for (const s of [-1, 1]) {
    const tx = cx + s * (TOWER / 2 + 5.5);
    b.cluster('petrov').tier(0);
    b.box(M.stone, tx, baseY, towerZ, TOWER, shaftTop, TOWER);
    b.mould(M.darkStone, tx, baseY, towerZ, TOWER + 0.5, TOWER + 0.5, PROFILE.plinth);
    // corner buttresses with two set-backs: the neo-gothic taper
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const bx = tx + ox * (TOWER / 2 - 0.5), bz = towerZ + oz * (TOWER / 2 - 0.5);
      b.tier(0).box(M.stone, bx, baseY, bz, 2.8, 20, 2.8, { solid: false });
      b.mould(M.stonePale, bx, baseY + 20, bz, 3.1, 3.1, PROFILE.setback);
      b.box(M.stone, bx - ox * 0.4, baseY + 20.7, bz - oz * 0.4, 2.1, 12.0, 2.1, { solid: false });
      b.mould(M.stonePale, bx - ox * 0.4, baseY + 32.7, bz - oz * 0.4, 2.4, 2.4, PROFILE.setback);
      b.box(M.stone, bx - ox * 0.8, baseY + 33.4, bz - oz * 0.8, 1.6, 6.6, 1.6, { solid: false });
    }
    for (const y of [11, 21, 30]) {
      b.tier(0).mould(M.stonePale, tx, baseY + y, towerZ, TOWER + 0.35, TOWER + 0.35, PROFILE.string);
    }
    for (let f = 0; f < 3; f++) {
      const wy = baseY + 12.6 + f * 9.2;
      b.window(tx, wy, towerZ - TOWER / 2 - 0.06, 2.6, 7.2, { lights: 2 });
      b.window(tx + s * (TOWER / 2 + 0.06), wy, towerZ, 2.6, 7.2, { lights: 2, rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
    }
    b.tier(0).mould(M.stonePale, tx, baseY + shaftTop - 1.4, towerZ, TOWER + 0.7, TOWER + 0.7, PROFILE.cornice);
    // pierced quatrefoil parapet, then the corner pinnacles
    b.tier(1);
    for (const [dx, dz, rot] of [[0, -1, 0], [0, 1, Math.PI], [-1, 0, Math.PI / 2], [1, 0, -Math.PI / 2]]) {
      for (let k = -1; k <= 1; k++) {
        b.place(M.stonePale, b.p('quatrefoilPanel', 3.1, 1.6, 0.32),
          tx + dx * (TOWER / 2 + 0.05) + dz * k * 3.3, baseY + shaftTop - 0.55,
          towerZ + dz * (TOWER / 2 + 0.05) + dx * k * 3.3, { rotY: rot });
      }
    }
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.place(M.stonePale, b.p('pinnacle', 11.5, 2.3),
        tx + ox * (TOWER / 2 - 0.5), baseY + shaftTop - 0.8, towerZ + oz * (TOWER / 2 - 0.5), {});
    }

    /* the belfry: correctly octagonal above the square shaft */
    const belfryY = baseY + shaftTop;
    const belfryH = 11;
    const rBel = 5.6;
    b.tier(0);
    b.cyl(M.stone, tx, belfryY, towerZ, rBel, rBel, belfryH, 8, { solid: true, rotY: Math.PI / 8 });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const ox = Math.sin(a), oz = Math.cos(a);
      b.tier(0).raw(M.litGlass, new THREE.BoxGeometry(2.5, 7.4, 0.4)
        .rotateY(a).translate(tx + ox * rBel * 0.94, belfryY + 4.8, towerZ + oz * rBel * 0.94));
      if (k % 2 === 0) {
        // a bell hangs behind every other louvre. They ring at 11:00.
        b.raw(M.bronze, new THREE.CylinderGeometry(0.95, 1.35, 1.9, 8)
          .translate(tx + ox * rBel * 0.4, belfryY + 5.6, towerZ + oz * rBel * 0.4));
      }
      b.tier(1).place(M.stonePale, b.p('archRing', 3.1, 8.2, 0.44, 0.5, 0.5, { steps: 5 }),
        tx + ox * (rBel * 0.96), belfryY + 1.0, towerZ + oz * (rBel * 0.96), { rotY: a + Math.PI });
    }
    b.tier(0).mould(M.stonePale, tx, belfryY + belfryH - 1.1, towerZ, 0, 0, PROFILE.cornice,
      { path: polyPath(8, rBel + 0.55, Math.PI / 8) });
    b.tier(1);
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      b.place(M.stonePale, b.p('pinnacle', 6.8, 1.5),
        tx + Math.sin(a) * (rBel + 0.15), belfryY + belfryH - 0.7, towerZ + Math.cos(a) * (rBel + 0.15), {});
    }

    /* the spire — 84.0 m to the tip, with lucarnes and crocketed arrises */
    const spireY = belfryY + belfryH;
    const finialH = 3.6;
    const spireH = SPIRE_TIP - spireY - finialH;
    b.tier(0).cone(M.slate, tx, spireY, towerZ, rBel * 0.99, spireH, 8, { rotY: Math.PI / 8 });
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 8 + (k / 4) * Math.PI * 2;
      const t = 0.2;
      const rr = rBel * 0.99 * (1 - t);
      const lx = tx + Math.sin(a) * rr * 0.9, lz = towerZ + Math.cos(a) * rr * 0.9;
      const ly = spireY + spireH * t;
      b.raw(M.slate, new THREE.BoxGeometry(1.8, 2.3, 1.8).rotateY(a).translate(lx, ly + 1.15, lz));
      b.raw(M.litGlass, new THREE.BoxGeometry(0.95, 1.4, 0.2).rotateY(a)
        .translate(lx + Math.sin(a) * 0.9, ly + 1.05, lz + Math.cos(a) * 0.9));
      b.raw(M.slate, new THREE.ConeGeometry(1.4, 1.8, 4).rotateY(a + Math.PI / 4).translate(lx, ly + 3.2, lz));
    }
    b.tier(1);
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      for (let i = 0; i < 7; i++) {
        const t = 0.3 + (i / 7) * 0.62;
        const rr = rBel * 0.99 * (1 - t);
        b.place(M.stonePale, b.p('crocket'),
          tx + Math.sin(a) * rr, spireY + spireH * t, towerZ + Math.cos(a) * rr,
          { scale: 1.6 - t * 0.7, rotY: a });
      }
    }
    // finial: ball, cross-arm and the tip landing on exactly 84.0 m
    b.tier(0);
    b.cyl(M.gold, tx, spireY + spireH, towerZ, 0.15, 0.22, finialH * 0.46, 6);
    b.sphere(M.gold, tx, spireY + spireH + finialH * 0.6, towerZ, 0.58);
    b.cyl(M.gold, tx, spireY + spireH + finialH * 0.6, towerZ, 0.08, 0.09, finialH * 0.4, 5);
    b.raw(M.gold, new THREE.BoxGeometry(1.0, 0.12, 0.12)
      .translate(tx, spireY + spireH + finialH * 0.84, towerZ));

    /* the clock, frozen at 11:00 */
    const clockY = baseY + 34.6;
    const cr = 2.5;
    b.discZ(M.stonePale, tx, clockY, towerZ - TOWER / 2 - 0.14, cr + 0.45, 0.36, 20);
    b.discZ(M.granite, tx, clockY, towerZ - TOWER / 2 - 0.34, cr, 0.24, 20);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.raw(M.gold, new THREE.BoxGeometry(0.17, 0.42, 0.12).rotateZ(-a)
        .translate(tx + Math.sin(a) * cr * 0.84, clockY + Math.cos(a) * cr * 0.84, towerZ - TOWER / 2 - 0.48));
    }
    const hand = (len, ang, w) => {
      const g = new THREE.BoxGeometry(w, len, 0.12);
      g.translate(0, len / 2, 0);
      g.rotateZ(-ang);
      g.translate(tx, clockY, towerZ - TOWER / 2 - 0.52);
      b.raw(M.gold, g);
    };
    hand(cr * 0.6, -Math.PI / 6, 0.22); // hour hand on XI
    hand(cr * 0.88, 0, 0.16); // minute hand on XII
  }

  /* ================= 7. surface: statuary and spouts =============== */
  b.cluster('petrov').tier(1);
  for (const i of [-16, -8, 0, 8, 16]) {
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('figure', i % 16 === 0 ? 'saint' : 'standing', i + s),
        cx + s * (aisleFace - 1.0), baseY + eavesAisle - 0.4, naveZ + i,
        { scale: 2.2, rotY: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  // waterspouts leaning off every buttress head
  for (const i of BUTT_Z) {
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('beast', 'dragon'), cx + s * (aisleFace + 2.4), baseY + eavesAisle - 1.6, naveZ + i,
        { scale: 1.5, rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2, rotX: -0.4 });
    }
  }
  b.tier(0);

  info.petrov = {
    name: 'Katedrála na Petrově',
    pos: new THREE.Vector3(cx, baseY, cz - 16),
    radius: 34,
    top: SPIRE_TIP,
  };
}
