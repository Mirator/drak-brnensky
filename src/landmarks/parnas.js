import * as THREE from 'three';
import { PROFILE, starPath, polyPath } from './detail.js';
import { mergeAll } from '../geometry.js';

/**
 * Zelný trh and the Parnas fountain (Fischer von Erlach, designed 1690-96,
 * built 1693-95, sculpture by Antonín Riga).
 *
 * Sourced (docs/brno-reference.md §5):
 * - **six-pointed star basin** — built here as a real swept star, not a circle.
 * - a **triangular** rocky mass of massive crinoid-limestone blocks with a small
 *   artificial grotto open on three sides at its centre.
 * - **Hercules in the Nemean lion's skin, club in his left hand, leading
 *   three-headed Cerberus on a chain with his right**, inside the grotto.
 * - three seated allegorical empires around the rock, each with its beast:
 *   **Greece** north-east, leaning on a quiver, a winged dragon beneath her;
 *   **Babylonia** north-west, a winged lion beneath her; **Persia** south-west,
 *   holding a cornucopia, a bear emerging from the rock. Each has a crown at
 *   her feet.
 * - **Europa** on the summit with a sceptre, standing over a defeated dragon.
 *
 * DRAGON COUNT — the dossier flags a possible conflation. **Two dragons are
 * built here.** The two descriptions differ in position, scale and attitude:
 * one is a supporting beast crouched *under* the seated Greece figure at basin
 * level, the other is *trampled* under Europa at the summit, five metres higher
 * and on the building's main axis. A single sculpture cannot be in both places,
 * and the iconography needs both (Greece's attribute; Europe's triumph). If a
 * reference photo later shows one, deleting the Greece dragon is a one-line
 * change at the `GREECE` entry below.
 *
 * The square slopes (it sits between the Petrov hill and the lower town), so
 * the upper, northern third is laid as two shallow paved terraces with a kerb
 * rather than being left flat. Rises are 0.26 m, well under the 0.7 m step
 * height, so nothing here can trap the player.
 */

export const SITE = { cx: -52, cz: 78 };
const BASIN_R = 8.0;

/** True ground footprint: basin, rock, and the terraced upper apron. */
export const RECTS = [
  [SITE.cx, SITE.cz, 20, 20], // fountain basin and its surround
  [SITE.cx, SITE.cz - 20, 58, 12], // the upper paved terrace
];

export function build(b, ctx) {
  const { M, info, rng } = ctx;
  const { cx, cz } = SITE;
  b.cluster('oldtown');

  /* ================= 1. the sloping square ========================= */
  // Two shallow terraces across the upper (north) third, with a kerb, so the
  // square reads as graded instead of as a flat plaza.
  b.tier(0);
  for (let i = 0; i < 2; i++) {
    b.box(M.darkStone, cx, i * 0.26, cz - 18 - i * 5, 56 - i * 6, 0.28, 12 - i * 2, { tag: 'terrain' });
  }
  b.mould(M.stonePale, cx, 0.5, cz - 24, 44, 3.0, PROFILE.cap);

  /* ================= 2. the star basin ============================ */
  const basinPath = starPath(6, BASIN_R, BASIN_R * 0.78, Math.PI / 6);
  b.mould(M.darkStone, cx, 0, cz, 0, 0,
    [[-0.62, 0], [0.62, 0], [0.68, 0.9], [-0.56, 1.05]], { path: basinPath });
  b.mould(M.stonePale, cx, 1.02, cz, 0, 0, PROFILE.cap, { path: basinPath });
  b.collisionRing(cx, cz, BASIN_R - 0.9, 1.7, 0, 1.15, 12);
  {
    const shape = new THREE.Shape(basinPath.map(([x, z]) => new THREE.Vector2(x * 0.9, z * 0.9)));
    const water = new THREE.ShapeGeometry(shape);
    water.rotateX(-Math.PI / 2);
    water.translate(cx, 0.68, cz);
    b.raw(M.water, water);
  }
  // the low kerb ring the basin stands on
  b.mould(M.darkStone, cx, 0, cz, 0, 0, PROFILE.plinth, { path: polyPath(16, BASIN_R + 1.5) });

  /* ================= 3. the triangular rock and its grotto ========= */
  // Massive limestone blocks piled into a triangle, open on three sides at the
  // centre. The rock is deterministic — every dimension comes from `rng`.
  const ROCK = [];
  const rockAt = (x, y, z, r, sx = 1, sy = 1, sz = 1) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(sx, sy, sz);
    g.rotateY(rng.float(0, Math.PI * 2));
    g.rotateX(rng.float(-0.4, 0.4));
    g.translate(x, y, z);
    ROCK.push(g);
  };
  // three corner piers of the triangle (apex north, toward the square)
  const CORNERS = [[0, -1], [0.87, 0.5], [-0.87, 0.5]];
  for (const [ux, uz] of CORNERS) {
    for (let k = 0; k < 3; k++) {
      const rr = 2.4 - k * 0.45;
      rockAt(cx + ux * (4.4 - k * 0.5) + rng.float(-0.4, 0.4), 1.2 + k * 1.5,
        cz + uz * (4.4 - k * 0.5) + rng.float(-0.4, 0.4), rr, 1.25, 0.85, 1.25);
    }
  }
  // the block bridging the corners into a mass, leaving the grotto void below
  for (let i = 0; i < 3; i++) {
    const a = CORNERS[i], c = CORNERS[(i + 1) % 3];
    for (const t of [0.32, 0.68]) {
      const ux = a[0] + (c[0] - a[0]) * t, uz = a[1] + (c[1] - a[1]) * t;
      rockAt(cx + ux * 4.0, 4.2 + rng.float(-0.4, 0.5), cz + uz * 4.0, 2.0, 1.35, 0.7, 1.35);
    }
  }
  rockAt(cx, 5.6, cz, 2.6, 1.5, 0.62, 1.5); // the cap the Europa group stands on
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    rockAt(cx + Math.cos(a) * (5.2 + rng.float(-0.5, 0.7)), rng.float(1.0, 1.9),
      cz + Math.sin(a) * (5.2 + rng.float(-0.5, 0.7)), rng.float(1.2, 1.9), 1, 0.7, 1);
  }
  b.tier(0).raw(M.darkStone, mergeAll(ROCK));
  // the grotto stops you walking into the fountain, but only its own footprint
  b.solid(cx, cz, 7.4, 7.4, 0, 6.2);

  /* ================= 4. Hercules and Cerberus in the grotto ======== */
  b.tier(1);
  b.place(M.stonePale, b.p('figure', 'hercules', 11), cx - 0.5, 1.5, cz + 0.4, { scale: 2.5, rotY: Math.PI });
  b.place(M.stonePale, b.p('beast', 'cerberus'), cx + 1.5, 1.4, cz - 0.6, { scale: 1.7, rotY: Math.PI + 0.5 });
  // the chain in his right hand, running to Cerberus's collar
  b.tier(0).raw(M.metal, new THREE.CylinderGeometry(0.05, 0.05, 2.2, 5)
    .rotateZ(1.1).rotateY(-0.4).translate(cx + 0.7, 2.6, cz - 0.2));

  /* ================= 5. the three seated empires =================== */
  /* Each: a seated figure on a rock ledge, a crown at her feet, her beast
     below her. Positions are the dossier's compass bearings, remembering that
     +z is south on this map. */
  const EMPIRES = [
    // GREECE — north-east, quiver of arrows, winged dragon beneath her
    { u: [0.82, -0.58], beast: 'dragon', attr: 'quiver' },
    // BABYLONIA — north-west, winged lion beneath her
    { u: [-0.82, -0.58], beast: 'lion', attr: null },
    // PERSIA — south-west, cornucopia, a bear emerging from the rock
    { u: [-0.6, 0.8], beast: 'bear', attr: 'cornucopia' },
  ];
  let ei = 0;
  for (const e of EMPIRES) {
    const px = cx + e.u[0] * 5.6, pz = cz + e.u[1] * 5.6;
    const face = Math.atan2(e.u[0], e.u[1]);
    b.tier(0).raw(M.darkStone, new THREE.IcosahedronGeometry(1.9, 0)
      .scale(1.3, 0.6, 1.3).translate(px, 2.3, pz));
    b.tier(1).place(M.stonePale, b.p('figure', 'seated', 20 + ei), px, 2.7, pz, { scale: 2.6, rotY: face });
    // the crown at her feet
    b.tier(0).cyl(M.gold, px + Math.sin(face) * 1.0, 2.75, pz + Math.cos(face) * 1.0, 0.3, 0.26, 0.28, 8);
    // her beast, half emerging from the rock below
    b.tier(1).place(M.stonePale, b.p('beast', e.beast), px + Math.sin(face) * 1.5, 1.05,
      pz + Math.cos(face) * 1.5, { scale: 2.0, rotY: face });
    if (e.attr === 'quiver') {
      b.tier(0).cyl(M.stonePale, px - Math.sin(face) * 0.9, 2.7, pz - Math.cos(face) * 0.9, 0.24, 0.28, 1.1, 8);
      for (let k = 0; k < 4; k++) {
        b.raw(M.stonePale, new THREE.CylinderGeometry(0.04, 0.04, 0.7, 4)
          .rotateZ(0.2 + k * 0.06).translate(px - Math.sin(face) * 0.9 + k * 0.07, 4.0, pz - Math.cos(face) * 0.9));
      }
    } else if (e.attr === 'cornucopia') {
      b.tier(0).raw(M.stonePale, new THREE.ConeGeometry(0.34, 1.5, 8)
        .rotateZ(1.2).translate(px - Math.sin(face) * 0.8, 3.5, pz - Math.cos(face) * 0.8));
    }
    ei++;
  }

  /* ================= 6. Europa on the summit ======================= */
  // Sceptre in hand, standing over a defeated dragon — the second dragon.
  b.tier(1);
  b.place(M.stonePale, b.p('beast', 'dragon'), cx + 0.2, 6.0, cz + 0.9, { scale: 2.3, rotY: 0.6, rotZ: 0.5 });
  b.place(M.stonePale, b.p('figure', 'standing', 31), cx - 0.2, 6.6, cz - 0.3, { scale: 2.9, rotY: Math.PI });
  b.tier(0).cyl(M.gold, cx + 1.1, 7.4, cz - 0.5, 0.06, 0.08, 2.6, 6, { rotY: 0.3 });
  b.sphere(M.gold, cx + 1.1, 10.1, cz - 0.5, 0.2);

  /* jets: thin water columns off the rock into the basin */
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    b.raw(M.water, new THREE.CylinderGeometry(0.05, 0.11, 2.4, 5)
      .translate(cx + Math.cos(a) * 6.4, 1.7, cz + Math.sin(a) * 6.4));
  }

  /* ================= 7. the market ================================= */
  // Trestle stalls with striped awnings, crates and produce. Positions and
  // colours all come from the injected rng, so the market is reproducible.
  const stall = (sx, sz, rot) => {
    const wide = 3.4, deep = 2.3;
    const wobble = rng.float(-0.12, 0.12);
    const r = rot + wobble;
    b.tier(0).box(M.wood, sx, 0.72, sz, wide, 0.12, deep, { rotY: r, solid: false });
    b.solid(sx, sz, wide * Math.abs(Math.cos(r)) + deep * Math.abs(Math.sin(r)),
      wide * Math.abs(Math.sin(r)) + deep * Math.abs(Math.cos(r)), 0, 0.85, 'prop');
    // trestle legs
    for (const [ox, oz] of [[-1.4, -0.85], [1.4, -0.85], [-1.4, 0.85], [1.4, 0.85]]) {
      const px = sx + Math.cos(r) * ox - Math.sin(r) * oz;
      const pz = sz + Math.sin(r) * ox + Math.cos(r) * oz;
      b.raw(M.wood, new THREE.BoxGeometry(0.1, 0.72, 0.1).translate(px, 0.36, pz));
      b.raw(M.metal, new THREE.CylinderGeometry(0.035, 0.035, 1.5, 5).translate(px, 1.47, pz));
    }
    // striped awning: alternating red and green bands, on a slight pitch
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const mat = i % 2 ? M.canvasRed : M.stonePale; // red-and-white ticking
      const g = new THREE.BoxGeometry(wide + 0.7, 0.09, (deep + 0.7) / bands);
      g.rotateX(0.1);
      g.rotateY(r);
      const off = -(deep + 0.7) / 2 + ((deep + 0.7) / bands) * (i + 0.5);
      g.translate(sx - Math.sin(r) * off, 2.24 + off * 0.1, sz + Math.cos(r) * off);
      b.raw(mat, g);
    }
    // crates and produce on the table
    for (let k = 0; k < 3; k++) {
      const ox = rng.float(-1.2, 1.2), oz = rng.float(-0.6, 0.6);
      const px = sx + Math.cos(r) * ox - Math.sin(r) * oz;
      const pz = sz + Math.sin(r) * ox + Math.cos(r) * oz;
      b.raw(M.wood, new THREE.BoxGeometry(0.68, 0.3, 0.48).rotateY(r).translate(px, 0.93, pz));
      for (let q = 0; q < 3; q++) {
        b.raw(q % 2 ? M.canvasRed : M.gold, new THREE.SphereGeometry(0.09, 5, 4)
          .translate(px + rng.float(-0.22, 0.22), 1.12, pz + rng.float(-0.16, 0.16)));
      }
    }
    // a crate stack on the ground beside it
    if (rng.chance(0.5)) {
      const px = sx + Math.cos(r) * 2.4, pz = sz + Math.sin(r) * 2.4;
      for (let k = 0; k < 2; k++) {
        b.raw(M.wood, new THREE.BoxGeometry(0.8, 0.42, 0.56).rotateY(r + rng.float(-0.3, 0.3))
          .translate(px, 0.21 + k * 0.42, pz));
      }
    }
  };
  for (let i = 0; i < 16; i++) {
    const sx = cx + rng.float(-25, 25);
    const sz = cz + rng.float(-14, 22);
    if (Math.hypot(sx - cx, sz - cz) < 12.5) continue;
    stall(sx, sz, rng.chance(0.5) ? 0 : Math.PI / 2);
  }

  info.zelnyTrh = {
    name: 'Zelný trh',
    pos: new THREE.Vector3(cx, 0, cz),
    radius: 30,
    top: 11,
  };
}
