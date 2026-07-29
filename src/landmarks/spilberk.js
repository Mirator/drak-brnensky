import * as THREE from 'three';
import { PROFILE, linePath, polyPath } from './detail.js';

/**
 * Špilberk — the castle above the city.
 *
 * Sourced (docs/brno-reference.md §2):
 * - a broad, low, star-fort-influenced profile with corner bastions, NOT a
 *   tall central donjon.
 * - two four-sided bastions were thrown up in 1645 specifically against the
 *   Swedish attack **from the west**, so the two west corners are angular
 *   bastions and the two east corners are older round drums.
 * - casemates (1742): north wing ~109 m, south ~102 m, corridor ~7 m wide.
 *   The game map compresses the whole hill into 158 m, so the casemate mouths
 *   are modelled at their real 7 m width and the corridors are implied.
 * - the courtyard was subdivided into **two** by mid-18th-c. building — hence
 *   the cross range.
 * - the lookout is a **corner turret in the eastern part**, 103 steps: a squat
 *   masonry turret with a viewing gallery, not a soaring spire.
 * - a ~112 m deep well in the west courtyard.
 * - gate remnants survive from the south-western bastion; the game needs a
 *   gate you can walk through, so the gatehouse is on the east approach.
 *
 * GAMEPLAY CONSTRAINT (README "Collision"): the hill is 27 shallow terraces of
 * 0.55 m, not a few tall slabs, because capsules step up onto anything within
 * their 0.7 m step height. A tall slab here would make the castle unclimbable
 * and break the level. Every walkable rise in this file goes through
 * `b.mound()` or `b.stairs()`, both of which respect STEP_RISE.
 */

export const SITE = { cx: -268, cz: 44 };
export const HILL_Y = 15.0;
/** Half-extent of the curtain wall ring. */
const R = 37;

/** True ground footprint: the whole terraced hill, paved approach included. */
export const RECTS = [
  [SITE.cx, SITE.cz, 158, 158],
];

export function build(b, ctx) {
  const { M, info } = ctx;
  const { cx, cz } = SITE;
  const wallY = HILL_Y;
  b.cluster('spilberk');

  /* ================= 1. blockout: the hill ========================= */
  // 27 terraces of 0.55 m. Do not replace with slabs — see the note above.
  b.mound(M.grass, M.darkStone, cx, cz, 158, 96, wallY, 0.55);
  /* The baroque switchback approach is *paved onto the terraces themselves*:
     each slab sits exactly on the terrace it belongs to, so the road reads as a
     zig-zag climb up the east flank without introducing one riser the terracing
     does not already have. A conventional stair ramp here would put a 14 m wall
     along its flanks and cut the hill off from that side. */
  {
    const rings = Math.max(2, Math.round(wallY / 0.55));
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const half = (158 + (96 - 158) * t) / 2;
      const y = (i + 1) * (wallY / rings) + 0.04;
      const zig = Math.sin(t * Math.PI * 2.4) * 26;
      b.box(M.darkStone, cx + half - 6.0, y - 0.12, cz + zig, 12, 0.16, 10, { tag: 'terrain' });
    }
  }

  /* ================= 2. the curtain: battered, crenellated ======== */
  const T = 3.2, WH = 6.4;
  const rampart = (x, z, len, rotY) => {
    b.tier(0).mould(M.darkStone, x, wallY, z, 0, 0, PROFILE.batter(T, WH, 1.0),
      { path: linePath(len), closed: false, rotY });
    b.mould(M.stonePale, x, wallY + WH, z, 0, 0, PROFILE.coping(T, 0.34, 0.42),
      { path: linePath(len + 0.2), closed: false, rotY });
    // crenellations stay at the structural tier: they are the silhouette
    b.crenellate(x, wallY + WH + 0.42, z, len, { rotY, mat: M.stonePale, w: 2.0, h: 1.6, d: T + 0.1, gap: 1.4 });
    const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
    b.solid(x, z, len * c + (T + 2) * s, len * s + (T + 2) * c, wallY, WH + 2.1);
    // machicolation corbels stepping out under the coping
    b.tier(1);
    const n = Math.max(2, Math.floor(len / 2.6));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / (n - 1)) * i;
      const px = x + Math.cos(rotY) * u, pz = z + Math.sin(rotY) * u;
      for (const side of [-1, 1]) {
        const ox = -Math.sin(rotY) * side * (T / 2 + 0.22);
        const oz = Math.cos(rotY) * side * (T / 2 + 0.22);
        b.raw(M.stonePale, new THREE.BoxGeometry(0.46, 0.5, 0.46)
          .translate(px + ox, wallY + WH - 0.3, pz + oz));
        b.raw(M.stonePale, new THREE.BoxGeometry(0.34, 0.36, 0.34)
          .translate(px + ox * 0.72, wallY + WH - 0.72, pz + oz * 0.72));
      }
    }
    b.tier(0);
  };
  rampart(cx, cz - R, R * 2, 0);
  rampart(cx, cz + R, R * 2, 0);
  rampart(cx - R, cz, R * 2, Math.PI / 2);
  // the east curtain is split to leave the gateway
  rampart(cx + R, cz - 22.5, 29, Math.PI / 2);
  rampart(cx + R, cz + 24, 26, Math.PI / 2);

  /* the two 1645 bastions face west; the two older drums face the town */
  for (const sz of [-1, 1]) {
    // angular bastion: a pointed spur with battered faces
    const bx = cx - R - 4, bz = cz + sz * (R - 6);
    b.tier(0).mould(M.darkStone, bx, wallY - 1.4, bz, 0, 0, PROFILE.batter(2.8, WH + 1.4, 1.6),
      { path: polyPath(5, 10, Math.PI + sz * 0.4) });
    b.mould(M.stonePale, bx, wallY + WH, bz, 0, 0, PROFILE.coping(2.8, 0.4, 0.44),
      { path: polyPath(5, 10.1, Math.PI + sz * 0.4) });
    b.solid(bx, bz, 20, 20, wallY - 1.4, WH + 2.2);
    b.cyl(M.darkStone, bx, wallY - 1.4, bz, 8.6, 9.4, WH + 1.4, 5, { rotY: Math.PI + sz * 0.4 });
    for (let k = 0; k < 5; k++) {
      const a = Math.PI + sz * 0.4 + (k / 5) * Math.PI * 2;
      b.crenellate(bx + Math.cos(a) * 9, wallY + WH + 0.44, bz + Math.sin(a) * 9, 8,
        { rotY: a + Math.PI / 2, mat: M.stonePale, w: 1.8, h: 1.5, d: 2.6, gap: 1.2 });
      // gun embrasures
      b.raw(M.doorway, new THREE.BoxGeometry(1.5, 1.1, 0.5)
        .rotateY(-a).translate(bx + Math.cos(a) * 9.6, wallY + WH - 1.9, bz + Math.sin(a) * 9.6));
    }
  }
  for (const sz of [-1, 1]) {
    const dx = cx + R, dz = cz + sz * R;
    b.tier(0).cyl(M.darkStone, dx, wallY - 1.2, dz, 6.6, 8.4, WH + 1.2, 12, { solid: true });
    b.mould(M.stonePale, dx, wallY + WH, dz, 0, 0, PROFILE.coping(2.4, 0.5, 0.44), { path: polyPath(12, 6.5) });
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.place(M.stonePale, b.p('merlon', 1.8, 1.5, 2.0), dx + Math.cos(a) * 6.3, wallY + WH + 0.44,
        dz + Math.sin(a) * 6.3, { rotY: -(a + Math.PI / 2) });
    }
    b.cone(M.slate, dx, wallY + WH + 2.0, dz, 7.2, 5.4, 12);
  }

  /* ================= 3. the gatehouse you walk through ============= */
  const gx = cx + R + 1.5, gz = cz + 1;
  b.tier(0);
  // two piers with a real arch between them; only the piers are solid
  b.box(M.darkStone, gx, wallY, gz - 6.4, 8.5, 13.5, 5.5);
  b.box(M.darkStone, gx, wallY, gz + 6.4, 8.5, 13.5, 5.5);
  b.place(M.darkStone, b.p('archedWall', 8.5, 16.5, 8.0, 6.2, 8.4, { spring: 0.6 }),
    gx, wallY, gz - 4.0, { rotY: Math.PI / 2 });
  b.mould(M.stonePale, gx, wallY + 13.5, gz - 6.4, 9.2, 6.2, PROFILE.cornice);
  b.mould(M.stonePale, gx, wallY + 13.5, gz + 6.4, 9.2, 6.2, PROFILE.cornice);
  b.mould(M.stonePale, gx, wallY + 16.5, gz, 9.4, 9.4, PROFILE.cornice);
  for (const s of [-1, 1]) {
    b.hip(M.slate, gx, wallY + 14.1, gz + s * 6.4, 9.4, 6.4, 4.4, 0.12);
  }
  b.crenellate(gx, wallY + 17.1, gz, 9, { rotY: Math.PI / 2, mat: M.stonePale, w: 1.9, h: 1.5, d: 8.6, gap: 1.3 });
  // the arms of Brno over the arch, and the portcullis groove
  b.tier(1);
  b.place(M.stonePale, b.p('quatrefoilPanel', 2.4, 2.4, 0.4), gx + 4.1, wallY + 9.4, gz, { rotY: -Math.PI / 2 });
  b.tier(0);
  b.box(M.metal, gx - 3.6, wallY, gz, 0.35, 8.2, 6.2, { solid: false });

  /* ================= 4. the ranges and the two courtyards ========= */
  const WING = 15;
  const wing = (dx, dz, w, d, storeys = 3) => {
    b.tier(0).box(M.sandstone, cx + dx, wallY, cz + dz, w, WING, d);
    b.mould(M.stonePale, cx + dx, wallY, cz + dz, w + 0.5, d + 0.5, PROFILE.plinth);
    b.mould(M.stonePale, cx + dx, wallY + WING - 0.9, cz + dz, w + 0.35, d + 0.35, PROFILE.cornice);
    b.gable(M.roof, cx + dx, wallY + WING, cz + dz, w + 1.0, d + 1.0, 5.0);
    // windows: real baroque surrounds on the long faces
    const along = w > d;
    const span = along ? w : d;
    const n = Math.max(2, Math.floor((span - 8) / 7.0));
    for (let i = 0; i < n; i++) {
      const u = -(span - 6) / 2 + ((span - 6) / (n - 1)) * i;
      for (const side of [-1, 1]) {
        const wx = cx + dx + (along ? u : side * (w / 2 + 0.06));
        const wz = cz + dz + (along ? side * (d / 2 + 0.06) : u);
        const rotY = along ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        for (let f = 0; f < storeys; f++) {
          b.window(wx, wallY + 2.2 + f * 4.4, wz, 1.5, 2.9, { kind: 'baroque', rotY });
        }
      }
    }
    // dormers
    for (let i = 0; i < Math.max(1, Math.floor(span / 9)); i++) {
      const u = -span / 2 + (span / (Math.max(1, Math.floor(span / 9)) + 1)) * (i + 1);
      const wx = cx + dx + (along ? u : 0), wz = cz + dz + (along ? 0 : u);
      const off = along ? [0, -d / 2] : [-w / 2, 0];
      b.raw(M.slate, new THREE.BoxGeometry(2.2, 2.4, 2.2).translate(wx + off[0] * 0.55, wallY + WING + 0.6, wz + off[1] * 0.55));
      b.raw(M.slate, new THREE.ConeGeometry(1.8, 1.5, 4).rotateY(Math.PI / 4)
        .translate(wx + off[0] * 0.55, wallY + WING + 2.9, wz + off[1] * 0.55));
    }
  };
  wing(0, -24, 58, 13);
  wing(0, 25, 58, 13);
  wing(-25, 0, 13, 37);
  wing(24, 0, 13, 37);
  // the mid-18th-century cross range that split one courtyard into two
  wing(0, 1, 11, 36, 2);

  /* ================= 5. casemate entrances ======================== */
  // 7 m wide barrel-vaulted mouths (the dossier's corridor width) cut into the
  // terrace face below the south curtain, with the dark of the tunnel behind.
  for (const dx of [-22, 0, 22]) {
    const mz = cz + R + 8.5;
    b.tier(0).place(M.darkStone, b.p('archedWall', 11, 7.6, 2.6, 7.0, 6.2, { spring: 0.42 }),
      cx + dx, wallY - 8.0, mz, { rotY: Math.PI });
    b.box(M.doorway, cx + dx, wallY - 8.0, mz + 1.6, 6.6, 5.8, 1.2, { solid: false });
    b.solid(cx + dx - 4.6, mz, 1.8, 3.0, wallY - 8.0, 7.6);
    b.solid(cx + dx + 4.6, mz, 1.8, 3.0, wallY - 8.0, 7.6);
    b.mould(M.stonePale, cx + dx, wallY - 0.6, mz, 11.4, 3.0, PROFILE.cornice);
    b.tier(1).place(M.stonePale, b.p('figure', 'standing', dx), cx + dx, wallY - 0.4, mz - 0.4, { scale: 1.9, rotY: Math.PI });
  }

  /* ================= 6. the eastern lookout turret ================ */
  // Squat masonry: 103 steps, a viewing gallery, a low pyramid cap.
  const tx = cx + 24, tz = cz - 24;
  b.tier(0);
  b.box(M.sandstone, tx, wallY + WING, tz, 12, 11, 12);
  b.mould(M.stonePale, tx, wallY + WING + 11, tz, 13.4, 13.4, PROFILE.cornice);
  b.cyl(M.sandstone, tx, wallY + WING + 11.7, tz, 4.6, 5.0, 5.4, 8, { solid: true });
  b.balustrade(tx, wallY + WING + 11.7, tz - 6.2, 12, { h: 1.2 });
  b.balustrade(tx, wallY + WING + 11.7, tz + 6.2, 12, { h: 1.2, rotY: Math.PI });
  b.balustrade(tx - 6.2, wallY + WING + 11.7, tz, 12, { h: 1.2, rotY: Math.PI / 2 });
  b.balustrade(tx + 6.2, wallY + WING + 11.7, tz, 12, { h: 1.2, rotY: -Math.PI / 2 });
  b.cone(M.copper, tx, wallY + WING + 17.1, tz, 5.6, 5.0, 8);
  b.cyl(M.gold, tx, wallY + WING + 22.1, tz, 0.1, 0.12, 2.2, 6);
  b.sphere(M.gold, tx, wallY + WING + 24.4, tz, 0.38);
  for (let f = 0; f < 3; f++) {
    b.window(tx, wallY + WING + 1.6 + f * 3.4, tz - 6.06, 1.4, 2.2, { lights: 1, head: false });
  }
  // clock on the town-facing face
  b.discZ(M.stonePale, tx, wallY + WING + 6.6, tz - 6.2, 2.2, 0.34, 18);
  b.discZ(M.granite, tx, wallY + WING + 6.6, tz - 6.4, 1.85, 0.2, 18);
  b.raw(M.gold, new THREE.BoxGeometry(0.14, 1.3, 0.1).translate(tx, wallY + WING + 7.2, tz - 6.55));
  b.raw(M.gold, new THREE.BoxGeometry(1.0, 0.12, 0.1).rotateZ(0.5).translate(tx + 0.4, wallY + WING + 6.4, tz - 6.55));

  /* ================= 7. the west courtyard well =================== */
  b.tier(0).mould(M.darkStone, cx - 11, wallY, cz - 12, 0, 0, PROFILE.cap, { path: polyPath(12, 2.2) });
  b.cyl(M.darkStone, cx - 11, wallY, cz - 12, 2.0, 2.2, 1.15, 12, { solid: true });
  b.cyl(M.granite, cx - 11, wallY + 0.9, cz - 12, 1.6, 1.6, 0.2, 12);
  for (const s of [-1, 1]) b.cyl(M.metal, cx - 11 + s * 1.9, wallY + 1.15, cz - 12, 0.08, 0.1, 2.6, 6);
  b.raw(M.metal, new THREE.CylinderGeometry(0.16, 0.16, 4.0, 6).rotateZ(Math.PI / 2)
    .translate(cx - 11, wallY + 3.75, cz - 12));
  b.raw(M.slate, new THREE.ConeGeometry(2.9, 1.5, 4).rotateY(Math.PI / 4).translate(cx - 11, wallY + 4.6, cz - 12));
  b.raw(M.metal, new THREE.CylinderGeometry(0.03, 0.03, 2.4, 4).translate(cx - 11, wallY + 2.4, cz - 12));
  b.raw(M.wood, new THREE.CylinderGeometry(0.42, 0.42, 0.5, 8).translate(cx - 11, wallY + 1.6, cz - 12));

  info.spilberk = {
    name: 'Hrad Špilberk',
    pos: new THREE.Vector3(cx, wallY, cz),
    radius: 50,
    top: wallY + WING + 24.8,
  };
}
