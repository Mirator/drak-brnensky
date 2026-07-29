import * as THREE from 'three';
import { PROFILE, polyPath } from './detail.js';
import { mergeAll } from '../geometry.js';

/**
 * Moravské náměstí — Jošt's statue, St Thomas's church, the Governor's Palace.
 *
 * Sourced (docs/brno-reference.md §7):
 * - **Jošt of Luxembourg** (Jaroslav Róna), bronze, **8 m** total, of which
 *   roughly **4 m is horse leg** — four absurdly long, thin legs planted
 *   straight into the paving, tall enough to walk between. That is the point of
 *   the piece, not an error to correct, so the legs here are 4.0 m of 0.22 m
 *   bronze and the collision is four thin posts you can walk between.
 * - **St Thomas's** (Kostel sv. Tomáše): Gothic Augustinian foundation, present
 *   appearance Baroque, 17th-c. remodel, on the south side of the square.
 * - the **Governor's Palace** (Místodržitelský palác): the attached former
 *   monastery, Baroque 1730s remodel, now the Moravian Gallery.
 * - the square is split by a tram road into a church forecourt and a park, so
 *   the church and palace sit east of Lidická and the statue stands in the park.
 */

export const SITE = { cx: 18, cz: -136 };
export const JOST = { x: 18, z: -136 };
/** Corroborated: 8 m overall, ~4 m of it leg. */
export const JOST_H = 8.0;
export const JOST_LEG = 4.0;

/** True ground footprint. The statue's own footprint is four thin legs, so it
 * reserves only a small plinth-sized patch; the church and palace are real. */
export const RECTS = [
  [JOST.x, JOST.z, 10, 8],
  [56, -128, 24, 34], // St Thomas's church
  [56, -160, 24, 26], // Governor's Palace / Moravian Gallery
];

export function build(b, ctx) {
  const { M, info } = ctx;
  b.cluster('moravske');

  /* ================= 1. Jošt, on four four-metre legs ============== */
  {
    const { x, z } = JOST;
    b.tier(0);
    // the paving slab the legs are planted into — flush, not a pedestal
    b.box(M.granite, x, 0, z, 9.4, 0.22, 7.4, { tag: 'terrain' });
    const legs = [];
    const HOOF = 0.24;
    for (const [sx, sz, lean] of [[-1, 1.5, 0.05], [1, 1.5, 0.05], [-1, -1.5, -0.06], [1, -1.5, -0.06]]) {
      const g = new THREE.CylinderGeometry(0.2, 0.26, JOST_LEG, 7);
      g.rotateX(lean);
      g.translate(sx * 0.62, 0.22 + JOST_LEG / 2, z * 0 + sz);
      legs.push(g);
      legs.push(new THREE.CylinderGeometry(0.3, 0.24, HOOF, 7).translate(sx * 0.62, 0.22 + HOOF / 2, sz));
      // the knee joint, which is all the articulation the real horse gets
      legs.push(new THREE.SphereGeometry(0.24, 6, 5).translate(sx * 0.62, 0.22 + JOST_LEG * 0.58, sz + lean * 1.2));
    }
    // body, neck and head at the top of the legs
    const bodyY = 0.22 + JOST_LEG;
    legs.push(new THREE.BoxGeometry(1.15, 1.45, 4.0).translate(0, bodyY + 0.72, 0));
    legs.push(new THREE.CylinderGeometry(0.55, 0.72, 1.5, 7).rotateX(-0.5).translate(0, bodyY + 1.7, -1.85));
    legs.push(new THREE.BoxGeometry(0.6, 0.62, 1.6).rotateX(0.35).translate(0, bodyY + 2.35, -2.6));
    for (const s of [-1, 1]) legs.push(new THREE.ConeGeometry(0.1, 0.36, 4).translate(s * 0.18, bodyY + 2.75, -2.3));
    // tail
    legs.push(new THREE.ConeGeometry(0.2, 1.5, 5).rotateX(-0.5).translate(0, bodyY + 0.9, 2.1));
    // the rider: ordinary human scale, which is what makes the legs read
    const rider = mergeAll([
      new THREE.BoxGeometry(0.72, 1.0, 0.56).translate(0, bodyY + 1.95, 0.1),
      new THREE.BoxGeometry(0.86, 0.24, 0.6).translate(0, bodyY + 2.42, 0.1),
      new THREE.SphereGeometry(0.26, 8, 6).translate(0, bodyY + 2.78, 0.06),
      new THREE.CylinderGeometry(0.3, 0.26, 0.34, 8).translate(0, bodyY + 2.98, 0.06),
      new THREE.BoxGeometry(0.2, 0.9, 0.2).rotateX(0.7).translate(-0.44, bodyY + 1.9, 0.18),
      new THREE.BoxGeometry(0.2, 0.9, 0.2).rotateX(0.4).translate(0.44, bodyY + 1.9, 0.14),
      new THREE.BoxGeometry(0.24, 1.1, 0.28).rotateX(1.1).translate(-0.5, bodyY + 1.1, 0.5),
      new THREE.BoxGeometry(0.24, 1.1, 0.28).rotateX(1.1).translate(0.5, bodyY + 1.1, 0.5),
    ]);
    legs.push(rider);
    // the sword, held down along the horse's flank
    legs.push(new THREE.BoxGeometry(0.09, JOST_H - bodyY - 0.4, 0.2)
      .rotateX(0.35).translate(0.58, bodyY + 1.1, 0.9));
    const g = mergeAll(legs);
    g.translate(x, 0, z);
    b.raw(M.bronze, g);
    // collision: four thin posts, so you can walk under and between them
    for (const [sx, sz] of [[-1, 1.5], [1, 1.5], [-1, -1.5], [1, -1.5]]) {
      b.solid(x + sx * 0.62, z + sz, 0.7, 0.7, 0, JOST_LEG + 0.4);
    }
    // and the body overhead, so shots hit the horse rather than sail through
    b.solid(x, z, 1.6, 4.2, 0.22 + JOST_LEG, JOST_H - JOST_LEG);
  }

  /* ================= 2. St Thomas's church ========================= */
  {
    const cx = 56, cz = -128, W = 22, D = 32, EAVES = 19;
    b.tier(0);
    b.box(M.sandstone, cx, 0, cz, W, EAVES, D);
    b.mould(M.stonePale, cx, 0, cz, W + 0.6, D + 0.6, PROFILE.plinth);
    b.mould(M.stonePale, cx, EAVES - 1.0, cz, W + 0.5, D + 0.5, PROFILE.cornice);
    b.gable(M.roof, cx, EAVES, cz, W + 1, D + 1, 8.0);
    // polygonal presbytery to the south
    b.cyl(M.sandstone, cx, 0, cz + D / 2, W / 2, W / 2, EAVES - 2, 8, { solid: true, rotY: Math.PI / 8 });
    b.cone(M.roof, cx, EAVES - 2, cz + D / 2, W / 2 + 0.6, 7.0, 8, { rotY: Math.PI / 8 });
    // a single baroque west tower with an onion helmet
    const tx = cx - W / 2 + 4.5, tz = cz - D / 2 + 4.5;
    b.box(M.sandstone, tx, 0, tz, 9.4, 30, 9.4);
    for (const y of [10, 19]) b.mould(M.stonePale, tx, y, tz, 9.8, 9.8, PROFILE.string);
    b.mould(M.stonePale, tx, 28.8, tz, 10.4, 10.4, PROFILE.cornice);
    b.cyl(M.copper, tx, 30, tz, 3.6, 4.2, 1.4, 12);
    b.sphere(M.copper, tx, 33.0, tz, 4.0, { seg: 14, seg2: 9, sy: 1.15 });
    b.cyl(M.copper, tx, 35.6, tz, 1.0, 1.6, 1.8, 10);
    b.sphere(M.copper, tx, 38.2, tz, 1.5, { seg: 12, seg2: 8, sy: 1.2 });
    b.cyl(M.gold, tx, 39.4, tz, 0.09, 0.11, 2.6, 6);
    b.sphere(M.gold, tx, 42.2, tz, 0.36);
    for (let f = 0; f < 3; f++) {
      b.window(tx, 4 + f * 7.4, tz - 4.76, 1.7, 3.4, { kind: 'baroque' });
    }
    b.raw(M.litGlass, new THREE.BoxGeometry(2.0, 3.6, 0.3).translate(tx, 24.6, tz - 4.66));
    // the volute gable and the portal on the north front
    const nz = cz - D / 2;
    b.tier(1);
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('volute', 3.6, 0.7, 0.8), cx + s * 5.4, EAVES - 0.6, nz - 0.5,
        { rotY: s > 0 ? 0 : Math.PI, rotZ: s > 0 ? 0 : 0 });
      b.place(M.stonePale, b.p('column', 12.0, 0.5, 2), cx + s * 4.2, 0, nz - 1.2, {});
      b.place(M.stonePale, b.p('figure', 'saint', 80 + s), cx + s * 7.4, 12.6, nz - 0.9, { scale: 2.5, rotY: Math.PI });
    }
    b.place(M.stonePale, b.p('roundArchRing', 5.0, 7.6, 0.6, 1.2, { steps: 6, bevel: 0.07 }), cx, 0, nz - 1.3, {});
    b.tier(0);
    b.box(M.doorway, cx, 0, nz - 0.6, 3.8, 6.0, 0.8, { solid: false });
    b.mould(M.stonePale, cx, 12.2, nz - 1.0, 18, 2.4, PROFILE.cornice);
    b.window(cx, 13.4, nz - 0.06, 3.4, 5.4, { kind: 'baroque' });
    // flank windows
    for (let f = 0; f < 2; f++) {
      for (const i of [-1, 0, 1]) {
        for (const s of [-1, 1]) {
          b.window(cx + s * (W / 2 + 0.06), 4.2 + f * 7.2, cz + i * 7.0, 2.0, 4.6,
            { kind: 'baroque', rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
        }
      }
    }
    info.stTomas = {
      name: 'Kostel sv. Tomáše',
      pos: new THREE.Vector3(cx, 0, nz - 6),
      radius: 22,
      top: 42.6,
    };
  }

  /* ================= 3. the Governor's Palace ====================== */
  {
    const cx = 56, cz = -160, W = 22, D = 24, EAVES = 16;
    b.tier(0);
    b.box(M.sandstone, cx, 0, cz, W, EAVES, D);
    b.mould(M.stonePale, cx, 0, cz, W + 0.6, D + 0.6, PROFILE.plinth);
    b.mould(M.stonePale, cx, 4.6, cz, W + 0.35, D + 0.35, PROFILE.string);
    b.mould(M.stonePale, cx, EAVES - 1.0, cz, W + 0.5, D + 0.5, PROFILE.cornice);
    // mansard roof with dormers, the 1730s signature
    b.hip(M.slate, cx, EAVES, cz, W + 1, D + 1, 4.2, 0.72);
    b.hip(M.slate, cx, EAVES + 4.2, cz, (W + 1) * 0.72, (D + 1) * 0.72, 3.6, 0.2);
    for (const i of [-1, 0, 1]) {
      b.raw(M.slate, new THREE.BoxGeometry(2.2, 2.2, 2.0).translate(cx + i * 6.4, EAVES + 1.0, cz - D / 2 + 1.6));
      b.raw(M.litGlass, new THREE.BoxGeometry(1.2, 1.4, 0.2).translate(cx + i * 6.4, EAVES + 1.2, cz - D / 2 + 0.65));
      b.raw(M.slate, new THREE.ConeGeometry(1.7, 1.3, 4).rotateY(Math.PI / 4)
        .translate(cx + i * 6.4, EAVES + 2.8, cz - D / 2 + 1.6));
    }
    // the central portal risalit with its balcony on consoles
    const nz = cz - D / 2;
    b.box(M.sandstone, cx, 0, nz - 1.0, 9.0, EAVES, 2.6);
    b.tier(1);
    b.place(M.stonePale, b.p('roundArchRing', 4.2, 6.0, 0.55, 1.1, { steps: 6, bevel: 0.06 }), cx, 0, nz - 2.35, {});
    for (const s of [-1, 1]) {
      b.place(M.stonePale, b.p('column', 6.4, 0.36, 1), cx + s * 3.2, 0, nz - 2.5, {});
      b.raw(M.stonePale, new THREE.BoxGeometry(0.7, 0.7, 1.2).translate(cx + s * 2.4, 6.4, nz - 2.5));
    }
    b.tier(0);
    b.box(M.doorway, cx, 0, nz - 1.6, 3.2, 5.0, 0.8, { solid: false });
    b.box(M.stonePale, cx, 7.1, nz - 2.9, 8.0, 0.4, 2.0, { solid: false });
    b.balustrade(cx, 7.5, nz - 3.6, 7.6, { h: 1.05 });
    for (let f = 0; f < 3; f++) {
      for (const i of [-3, -2, 2, 3]) {
        b.window(cx + i * 3.1, 5.6 + f * 3.4, nz - 0.06, 1.5, 2.5, { kind: 'baroque' });
      }
    }
    b.tier(1);
    for (const i of [-1, 1]) {
      b.place(M.stonePale, b.p('urn', 2.0), cx + i * 4.4, EAVES - 0.4, nz - 2.8, {});
    }
    b.tier(0);
    void polyPath;
    info.mistodrzitelsky = {
      name: 'Místodržitelský palác',
      pos: new THREE.Vector3(cx, 0, nz - 6),
      radius: 20,
      top: EAVES + 7.8,
    };
  }

  info.moravske = {
    name: 'Moravské náměstí',
    pos: new THREE.Vector3(SITE.cx, 0, SITE.cz),
    radius: 34,
    top: JOST_H,
  };
}
