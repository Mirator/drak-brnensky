import * as THREE from 'three';
import { PROFILE, polyPath } from './detail.js';

/**
 * Mahenovo divadlo and Janáčkovo divadlo.
 *
 * Sourced (docs/brno-reference.md §6):
 * - **Mahen**: Fellner & Helmer, opened 1882. Genuinely eclectic — neo-
 *   Renaissance, neo-Baroque and neo-Classical mixed — so: a rusticated base, a
 *   giant order over it, an arched loggia, a balustraded attic with statues and
 *   urns, corner pavilions and a central dome. It was the **first theatre in
 *   Europe lit entirely by electric light** (Edison bulbs, 1882), which is why
 *   every opening here glows warm rather than gaslight-dim, and why the
 *   forecourt gets its own row of early electric standards.
 * - **Janáček**: 1958-65, opened 2 October 1965. A monolithic reinforced
 *   concrete frame, stone/glass/steel/aluminium finish — a heavy stone-clad
 *   modernist civic block with a glazed front, not a curtain-wall tower.
 *   Forecourt with **a** water basin and fountain plus terraces (the dossier
 *   flags "fountains" plural as unconfirmed, so there is one basin).
 */

export const MAHEN = { cx: 104, cz: -66 };
export const JANACEK = { cx: 112, cz: -172 };

/** True ground footprints: both include their terraces and forecourt basins. */
export const RECTS_MAHEN = [
  [MAHEN.cx, MAHEN.cz, 44, 30],
];
export const RECTS_JANACEK = [
  [JANACEK.cx, JANACEK.cz, 66, 44],
  [JANACEK.cx, JANACEK.cz - 28, 40, 24], // forecourt terrace and water basin
];

export function buildMahen(b, ctx) {
  const { M, info } = ctx;
  const { cx, cz } = MAHEN;
  b.cluster('mahen');

  const FRONT = cz - 12; // the entrance front, facing north
  b.tier(0);
  // terrace and its steps
  b.box(M.stonePale, cx, 0, cz, 44, 0.3, 30, { tag: 'terrain' });
  b.stairs(M.stonePale, cx, 0.3, FRONT - 2.6, 22, 0, 1, 5, 0.3, 0.55);

  const BASE = 5.2, EAVES = 18.5;
  // rusticated ground storey
  b.box(M.sandstone, cx, 0.3, cz, 32, BASE, 20);
  b.tier(1);
  for (let i = -15; i <= 15; i += 2.0) {
    for (const y of [1.0, 2.5, 4.0]) {
      b.raw(M.stonePale, new THREE.BoxGeometry(1.8, 0.34, 0.16).translate(cx + i, 0.3 + y, FRONT - 0.09));
    }
  }
  b.tier(0);
  b.mould(M.stonePale, cx, 0.3 + BASE - 0.5, cz, 32.5, 20.5, PROFILE.cornice);
  // the giant order above it
  b.box(M.sandstone, cx, 0.3 + BASE, cz, 30, EAVES - BASE, 19);
  b.mould(M.stonePale, cx, 0.3 + EAVES - 1.2, cz, 30.6, 19.6, PROFILE.cornice);
  b.hip(M.slate, cx, 0.3 + EAVES, cz, 30.6, 19.6, 6.4, 0.4);

  /* the entrance loggia: five arches on columns, a balustraded balcony over */
  b.box(M.sandstone, cx, 0.3, FRONT + 2.6, 22, EAVES - 3.5, 6.4);
  const lz = FRONT - 0.6;
  for (let i = -2; i <= 2; i++) {
    b.tier(1).place(M.stonePale, b.p('roundArchRing', 3.5, 6.6, 0.5, 1.0, { steps: 6, bevel: 0.06 }),
      cx + i * 4.3, 0.3, lz - 0.05, {});
    b.tier(0).box(M.litGlass, cx + i * 4.3, 0.6, lz + 0.9, 2.6, 5.2, 0.3, { solid: false });
    b.tier(1).place(M.stonePale, b.p('column', 6.8, 0.42, 2), cx + i * 4.3 + 2.15, 0.3, lz + 0.5, {});
  }
  b.tier(1).place(M.stonePale, b.p('column', 6.8, 0.42, 2), cx - 2 * 4.3 - 2.15, 0.3, lz + 0.5, {});
  b.tier(0).mould(M.stonePale, cx, 7.2, lz + 0.6, 23, 3.4, PROFILE.cornice);
  b.balustrade(cx, 7.8, lz + 0.1, 22, { h: 1.25 });
  // giant pilasters framing the piano nobile, with corinthian capitals
  b.tier(1);
  for (const i of [-3, -1.5, 1.5, 3]) {
    b.place(M.stonePale, b.p('column', 9.6, 0.5, 2), cx + i * 3.6, 0.3 + BASE, lz + 1.4, {});
  }
  b.tier(0);
  for (const i of [-1, 0, 1]) {
    b.window(cx + i * 4.6, 9.6, lz + 1.35, 2.4, 4.4, { kind: 'baroque' });
  }
  // corner pavilions
  for (const s of [-1, 1]) {
    b.box(M.sandstone, cx + s * 15.4, 0.3, cz - 2, 6.4, EAVES + 2.2, 12);
    b.mould(M.stonePale, cx + s * 15.4, 0.3 + EAVES + 1.0, cz - 2, 7.0, 12.6, PROFILE.cornice);
    b.hip(M.slate, cx + s * 15.4, 0.3 + EAVES + 2.2, cz - 2, 7.0, 12.6, 5.6, 0.15);
    b.cyl(M.gold, cx + s * 15.4, 0.3 + EAVES + 7.8, cz - 2, 0.08, 0.1, 1.8, 6);
    for (let f = 0; f < 3; f++) {
      b.window(cx + s * 15.4, 2.4 + f * 5.2, cz - 8.06, 1.7, 3.2, { kind: 'baroque' });
    }
  }
  // the central dome
  b.mould(M.stonePale, cx, 0.3 + EAVES + 4.0, cz + 2, 0, 0, PROFILE.cornice, { path: polyPath(16, 6.4) });
  b.cyl(M.copper, cx, 0.3 + EAVES + 4.6, cz + 2, 5.6, 6.2, 3.2, 16);
  b.sphere(M.copper, cx, 0.3 + EAVES + 7.8, cz + 2, 5.8, { seg: 18, seg2: 10, phi: Math.PI / 2 });
  b.cyl(M.copper, cx, 0.3 + EAVES + 12.6, cz + 2, 1.1, 1.5, 1.6, 12);
  b.cyl(M.gold, cx, 0.3 + EAVES + 14.2, cz + 2, 0.1, 0.12, 3.0, 6);
  b.sphere(M.gold, cx, 0.3 + EAVES + 17.4, cz + 2, 0.42);
  // attic balustrade with statues and urns, the historicist signature
  b.balustrade(cx, 0.3 + EAVES + 0.2, FRONT + 5.9, 28, { h: 1.4 });
  b.tier(1);
  for (const i of [-2, -1, 0, 1, 2]) {
    if (i % 2 === 0) {
      b.place(M.stonePale, b.p('figure', 'standing', 70 + i), cx + i * 5.6, 0.3 + EAVES + 1.6, FRONT + 5.4,
        { scale: 2.7, rotY: Math.PI });
    } else {
      b.place(M.stonePale, b.p('urn', 2.2), cx + i * 5.6, 0.3 + EAVES + 1.6, FRONT + 5.4, {});
    }
  }
  // volutes buttressing the dome drum
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    b.place(M.stonePale, b.p('volute', 3.0, 0.55, 0.7), cx + Math.sin(a) * 6.0, 0.3 + EAVES + 4.6,
      cz + 2 + Math.cos(a) * 6.0, { rotY: a + Math.PI / 2 });
  }
  b.tier(0);
  // side and rear windows — the 1882 Edison bulbs are why these read warm
  for (let f = 0; f < 3; f++) {
    for (let i = -3; i <= 3; i++) {
      b.window(cx + i * 4.0, 2.6 + f * 5.0, cz + 9.56, 1.8, 3.4, { kind: 'baroque', rotY: Math.PI });
    }
    for (const s of [-1, 1]) {
      for (const j of [-1, 0, 1]) {
        b.window(cx + s * 15.06, 2.6 + f * 5.0, cz - 2 + j * 3.6, 1.6, 3.0,
          { kind: 'baroque', rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2 });
      }
    }
  }
  // the electric standards on the forecourt: the "first in Europe" note
  for (const s of [-1, 1]) {
    const px = cx + s * 12, pz = FRONT - 5.5;
    b.cyl(M.metal, px, 0.3, pz, 0.12, 0.2, 4.2, 8, { solid: true });
    b.mould(M.metal, px, 4.5, pz, 0, 0, PROFILE.cap, { path: polyPath(8, 0.34) });
    b.sphere(M.litGlass, px, 5.1, pz, 0.34);
  }

  info.mahen = {
    name: 'Mahenovo divadlo',
    pos: new THREE.Vector3(cx, 0, FRONT - 6),
    radius: 26,
    top: 0.3 + EAVES + 17.8,
  };
}

export function buildJanacek(b, ctx) {
  const { M, info } = ctx;
  const { cx, cz } = JANACEK;
  b.cluster('janacek');

  const FRONT = cz - 15;
  b.tier(0);
  // travertine terrace, stepped so it stays walkable
  for (let i = 0; i < 3; i++) {
    b.box(M.stonePale, cx, i * 0.34, cz - i * 2, 66 - i * 8, 0.36, 44 - i * 4, { tag: 'terrain' });
  }
  const Y = 1.02;
  // the block: monolithic frame, stone-clad flanks, glazed front
  b.box(M.stonePale, cx, Y, cz, 54, 18, 30);
  // the glazed foyer wall, set behind a deep colonnade of slender piers
  b.box(M.glass, cx, Y, FRONT + 0.6, 46, 16.5, 1.2, { solid: false });
  for (let i = -11; i <= 11; i++) {
    b.box(M.stonePale, cx + i * 2.1, Y, FRONT - 1.6, 0.55, 17.4, 1.2, { solid: i % 3 === 0 });
  }
  b.box(M.stonePale, cx, Y + 17.4, FRONT - 1.6, 48, 1.4, 3.4, { solid: false });
  // aluminium spandrels between the piers, and the warm foyer light behind
  for (let i = -10; i <= 10; i++) {
    b.raw(M.metal, new THREE.BoxGeometry(1.5, 0.5, 0.3).translate(cx + i * 2.1 + 1.05, Y + 8.4, FRONT - 1.0));
    b.raw(M.litGlass, new THREE.BoxGeometry(1.4, 3.4, 0.18).translate(cx + i * 2.1 + 1.05, Y + 2.4, FRONT + 0.2));
  }
  // heavy stone flanks with the vertical stone-panel rhythm of 1965
  for (const s of [-1, 1]) {
    for (let i = -6; i <= 6; i++) {
      b.raw(M.stonePale, new THREE.BoxGeometry(0.3, 17, 1.9).translate(cx + s * 27.2, Y + 8.5, cz + i * 2.15));
    }
  }
  b.mould(M.stonePale, cx, Y + 18, cz, 55, 31, PROFILE.cap);
  // auditorium mass and the fly tower behind it
  b.box(M.stonePale, cx, Y + 18.4, cz + 3, 42, 9.5, 24);
  b.box(M.stonePale, cx, Y + 27.9, cz + 6, 30, 7.5, 16);
  b.box(M.metal, cx, Y + 35.4, cz + 6, 30.6, 0.6, 16.6, { solid: false });
  b.mould(M.stonePale, cx, Y + 27.4, cz + 3, 42.6, 24.6, PROFILE.cap);

  /* the forecourt water basin — one basin, per the dossier */
  const bz = FRONT - 13;
  b.mould(M.stonePale, cx, 0, bz, 0, 0, PROFILE.cap, { path: polyPath(4, 12.4, Math.PI / 4) });
  b.mould(M.darkStone, cx, 0, bz, 26, 15, [[-0.5, 0], [0.5, 0], [0.5, 0.62], [-0.42, 0.7]]);
  b.collisionRing(cx, bz, 12.6, 1.6, 0, 0.8, 14);
  {
    const w = new THREE.PlaneGeometry(25, 14);
    w.rotateX(-Math.PI / 2);
    w.translate(cx, 0.5, bz);
    b.raw(M.water, w);
  }
  for (let i = 0; i < 9; i++) {
    const t = (i / 8 - 0.5) * 22;
    // jets rise from the water surface — b.cyl takes the BOTTOM as y
    b.cyl(M.water, cx + t, 0.52, bz, 0.05, 0.13, 2.2 + (i % 3) * 0.9, 5);
  }
  // planted terraces flanking the basin
  for (const s of [-1, 1]) {
    b.box(M.grass, cx + s * 22, 0.36, bz, 12, 0.3, 14, { tag: 'terrain' });
    b.mould(M.stonePale, cx + s * 22, 0, bz, 12.6, 14.6, PROFILE.cap);
  }

  info.janacek = {
    name: 'Janáčkovo divadlo',
    pos: new THREE.Vector3(cx, 0, FRONT - 8),
    radius: 36,
    top: Y + 36,
  };
}
