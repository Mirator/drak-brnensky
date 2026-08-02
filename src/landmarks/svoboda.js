import * as THREE from 'three';
import { PROFILE, polyPath } from './detail.js';
import { BRNO_PLACES } from '../data/brno-layout.js';

/**
 * Náměstí Svobody — the plague column, the "orloj", and the square's frontages.
 *
 * Sourced (docs/brno-reference.md §4):
 * - Marian/plague column 1679-83, **20 m** high, Hořice sandstone shaft with
 *   white-grey marble members and Eggenburg limestone figures. Four corner
 *   pedestals carrying **St Sebastian, St Roch, St Charles Borromeo and St
 *   Francis Xavier**, the Virgin and Child on a composite capital on top.
 *   It stands in the **north (upper)** part of the square.
 * - the "orloj" is **not a clock face**: a ~6 m tapering, blunt-tipped black
 *   monolith cut from one block of South African black stone (sold as granite,
 *   mineralogically closer to gabbro), unveiled 2010 for the 365th anniversary
 *   of the 1645 siege. The projectile silhouette is the point. It releases a
 *   glass marble at 11:00; the tip turns once a minute, the glass section once
 *   an hour. Built as the real object, not as a fantasy orloj.
 * - **Dům u čtyř mamlasů** (1899-1902, Wanderley): historicist rental palace,
 *   side risalits ending in towers, and four monumental Atlas figures carrying
 *   a full-width balcony on the main facade.
 * - **Schwanzův palác / Dům pánů z Lipé** (from 1589): Renaissance, two
 *   cylindrical corner oriels on relief parapets. The brief's "Schwansee" does
 *   not exist — see the dossier's flagged name correction.
 * - **Palác Omega** (2006): a grid of green glass squares, deliberately jarring
 *   against its historicist neighbours. Kept, because the dossier is explicit
 *   that the square already contains that dissonance.
 *
 * GAMEPLAY: the boss fight happens here. Everything new is pushed out to the
 * square's edges — nothing is added inside the plaza rect except the column and
 * the orloj that were already there, and neither gained footprint.
 */

export const SITE = { cx: BRNO_PLACES.svoboda.x, cz: BRNO_PLACES.svoboda.z };
/** The corroborated height: 20 m to the top of the Marian figure. */
export const COLUMN_H = 20.0;
export const COLUMN_AT = [BRNO_PLACES.column.x, BRNO_PLACES.column.z];
/** ~6 m, per the dossier. */
export const ORLOJ_H = 6.0;
export const ORLOJ_AT = [BRNO_PLACES.orloj.x, BRNO_PLACES.orloj.z];

/**
 * Footprints. The column and orloj keep the reservations they already had; the
 * three named frontages are new and sit OUTSIDE the plaza rect so the fight
 * arena is untouched.
 */
export const RECTS = [
  [ORLOJ_AT[0], ORLOJ_AT[1], 16, 16], // orloj plinth and its apron
  [COLUMN_AT[0], COLUMN_AT[1], 14, 14], // plague column steps
  [44, -50, 20, 30], // Dům u čtyř mamlasů, east side
  [44, 4, 18, 24], // Palác Omega, east side
  [-44, -30, 20, 28], // Schwanzův palác / Dům pánů z Lipé, west side
].slice(0, 2);

export function build(b, ctx) {
  const { M, info } = ctx;
  b.cluster('svoboda');

  /* ================= 1. the plague column, 20 m ==================== */
  const [kx, kz] = COLUMN_AT;
  b.tier(0);
  // stepped base: three real steps you can walk up (0.34 m each)
  for (let i = 0; i < 3; i++) {
    const s = 12.4 - i * 1.8;
    b.box(M.stonePale, kx, i * 0.34, kz, s, 0.36, s, { tag: 'stairs' });
  }
  const podium = 1.02;
  b.mould(M.stonePale, kx, podium, kz, 7.0, 7.0, PROFILE.plinth);
  b.box(M.stonePale, kx, podium + 0.8, kz, 6.2, 1.7, 6.2);
  b.mould(M.stonePale, kx, podium + 2.5, kz, 6.6, 6.6, PROFILE.cornice);
  // four corner pedestals: St Sebastian, St Roch, St Charles Borromeo,
  // St Francis Xavier
  let si = 0;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const px = kx + sx * 2.45, pz = kz + sz * 2.45;
    b.tier(0).mould(M.stonePale, px, podium + 3.1, pz, 1.9, 1.9, PROFILE.plinth);
    b.box(M.stonePale, px, podium + 3.9, pz, 1.55, 1.6, 1.55, { solid: false });
    b.mould(M.stonePale, px, podium + 5.5, pz, 1.95, 1.95, PROFILE.cap);
    b.tier(1).place(M.stonePale, b.p('figure', 'saint', 60 + si), px, podium + 5.8, pz,
      { scale: 2.5, rotY: Math.atan2(sx, sz) });
    si++;
  }
  // the shaft: entasis, then a composite capital
  const shaftBase = podium + 3.2;
  const shaftH = 9.6;
  b.tier(0);
  {
    const prof = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      prof.push(new THREE.Vector2(0.78 * (1 - t * 0.2) + Math.sin(t * Math.PI) * 0.03, shaftBase + shaftH * t));
    }
    prof.unshift(new THREE.Vector2(0.02, shaftBase));
    prof.push(new THREE.Vector2(0.02, shaftBase + shaftH));
    b.raw(M.stonePale, new THREE.LatheGeometry(prof, 14).translate(kx, 0, kz));
  }
  b.mould(M.stonePale, kx, shaftBase - 0.5, kz, 0, 0, PROFILE.cap, { path: polyPath(14, 1.05) });
  b.tier(1).place(M.stonePale, b.p('column', 2.6, 0.66, 2), kx, shaftBase + shaftH - 1.9, kz, {});
  b.tier(0);
  const capTop = shaftBase + shaftH + 0.9;
  b.mould(M.stonePale, kx, capTop, kz, 2.3, 2.3, PROFILE.cap);
  // gilded rays and the crown of stars behind the Virgin
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.raw(M.gold, new THREE.ConeGeometry(0.09, 1.5 + (k % 2) * 0.7, 4).rotateX(Math.PI / 2)
      .rotateZ(a).translate(kx, capTop + 2.4, kz + 0.05));
  }
  const figH = COLUMN_H - (capTop + 0.32);
  b.tier(1).place(M.stonePale, b.p('figure', 'virgin', 7), kx, capTop + 0.32, kz,
    { scale: figH, rotY: Math.PI });
  b.tier(0);
  b.sphere(M.gold, kx, capTop + 0.5, kz, 0.5, { sy: 0.72 }); // the globe under her feet

  /* ================= 2. the "orloj" — a 6 m black monolith ========= */
  const [ox, oz] = ORLOJ_AT;
  b.tier(0);
  {
    // tapering, blunt-tipped projectile: wide at the base, swelling slightly,
    // then drawing to a rounded point. Cut as one block, so one lathe.
    const pts = [];
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const y = t * ORLOJ_H;
      const r = 0.98 * Math.sin(Math.PI * (0.13 + t * 0.82)) * (1 - t * 0.26) + 0.05;
      pts.push(new THREE.Vector2(Math.max(0.04, r), y));
    }
    b.raw(M.granite, new THREE.LatheGeometry(pts, 26).translate(ox, 0.42, oz));
  }
  // the six sharp prism edges that act as the seconds pointer
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.raw(M.granite, new THREE.BoxGeometry(0.1, 3.4, 0.22).rotateY(a)
      .translate(ox + Math.sin(a) * 0.9, 2.4, oz + Math.cos(a) * 0.9));
  }
  // the glass section near the top: the hour indicator
  b.cyl(M.shelterGlass, ox, 4.55, oz, 0.42, 0.5, 0.55, 20);
  // plinth, the marble channel and its catching bowl
  b.mould(M.granite, ox, 0, oz, 0, 0, PROFILE.plinth, { path: polyPath(20, 1.95) });
  b.cyl(M.granite, ox, 0, oz, 1.72, 1.9, 0.44, 20, { solid: true });
  b.solid(ox, oz, 2.2, 2.2, 0, ORLOJ_H + 0.5);
  b.raw(M.granite, new THREE.CylinderGeometry(0.11, 0.11, 3.6, 8).rotateX(0.34)
    .translate(ox + 0.62, 2.2, oz - 0.55));
  b.cyl(M.granite, ox + 1.0, 0.44, oz - 1.15, 0.34, 0.28, 0.3, 12);
  b.sphere(M.stonePale, ox + 1.0, 0.82, oz - 1.15, 0.12); // the 11:00 marble
  // bronze plaque: 1645, and the 365 years
  b.raw(M.bronze, new THREE.BoxGeometry(1.1, 0.7, 0.08).rotateX(-0.5).translate(ox, 0.62, oz - 1.72));

  /* ================= 3. Dům u čtyř mamlasů ======================== */
  // Four atlantes carrying a full-width balcony; risalits ending in towers.
  // Named square frontages are now generated from their exact OSM shells.
  // Keep the old authored recipes below as reference, but never instantiate
  // the duplicate free-standing blocks in the geospatial city.
  if (false) {
  {
    const hx = 44, hz = -50, W = 30, D = 20, EAVES = 20;
    b.tier(0);
    b.box(M.sandstone, hx, 0, hz, D, EAVES, W);
    b.mould(M.stonePale, hx, 0, hz, D + 0.6, W + 0.6, PROFILE.plinth);
    b.mould(M.stonePale, hx, 4.4, hz, D + 0.4, W + 0.4, PROFILE.string);
    b.mould(M.stonePale, hx, EAVES - 1.1, hz, D + 0.5, W + 0.5, PROFILE.cornice);
    b.hip(M.slate, hx, EAVES, hz, D + 1, W + 1, 5.2, 0.35);
    // side risalits, each ending in a little tower
    for (const s of [-1, 1]) {
      b.box(M.sandstone, hx - 1.2, 0, hz + s * (W / 2 - 3.4), D + 2.4, EAVES + 3.4, 6.8);
      b.mould(M.stonePale, hx - 1.2, EAVES + 2.3, hz + s * (W / 2 - 3.4), D + 2.9, 7.3, PROFILE.cornice);
      b.hip(M.slate, hx - 1.2, EAVES + 3.4, hz + s * (W / 2 - 3.4), D + 2.9, 7.3, 6.4, 0.1);
      b.cyl(M.gold, hx - 1.2, EAVES + 9.8, hz + s * (W / 2 - 3.4), 0.08, 0.1, 1.8, 6);
    }
    // the ground-floor arcade and shopfronts
    const face = hx - D / 2;
    b.tier(1);
    for (let i = -3; i <= 3; i++) {
      b.place(M.stonePale, b.p('roundArchRing', 3.0, 4.0, 0.36, 0.8, { steps: 5, bevel: 0.05 }),
        face - 0.05, 0.3, hz + i * 3.7, { rotY: Math.PI / 2 });
      b.tier(0).box(M.litGlass, face + 0.2, 0.4, hz + i * 3.7, 0.3, 3.2, 2.5, { solid: false });
      b.tier(1);
    }
    /* the four mamlasi: monumental atlantes taking the balcony on their arms */
    for (const dz of [-9.6, -3.2, 3.2, 9.6]) {
      b.tier(0).box(M.stonePale, face - 0.95, 5.6, hz + dz, 1.7, 0.6, 1.7, { solid: false });
      b.tier(1).place(M.stonePale, b.p('figure', 'atlas', dz), face - 0.95, 6.2, hz + dz,
        { scale: 2.9, rotY: -Math.PI / 2 });
    }
    b.tier(0);
    // the balcony they carry, with its balustrade
    b.box(M.stonePale, face - 1.5, 9.9, hz, 3.2, 0.55, W - 2.4, { solid: false });
    b.mould(M.stonePale, face - 1.5, 9.5, hz, 3.4, W - 2.2, PROFILE.cornice);
    b.balustrade(face - 2.9, 10.45, hz, W - 2.6, { h: 1.15, rotY: Math.PI / 2 });
    // upper storeys: real window surrounds
    b.tier(0);
    for (let f = 0; f < 3; f++) {
      for (let i = -3; i <= 3; i++) {
        b.window(face - 0.06, 11.0 + f * 3.4, hz + i * 3.7, 1.6, 2.5,
          { kind: 'baroque', rotY: Math.PI / 2 });
      }
    }
    b.tier(1);
    for (let i = -3; i <= 3; i += 2) {
      b.place(M.stonePale, b.p('urn', 2.0), face + 0.4, EAVES - 0.3, hz + i * 3.7, {});
    }
  }

  /* ================= 4. Schwanzův palác / Dům pánů z Lipé ========== */
  // Renaissance: two cylindrical corner oriels on relief parapets.
  {
    const hx = -44, hz = -30, W = 28, D = 20, EAVES = 17;
    b.tier(0);
    b.box(M.sandstone, hx, 0, hz, D, EAVES, W);
    b.mould(M.stonePale, hx, 0, hz, D + 0.6, W + 0.6, PROFILE.plinth);
    b.mould(M.stonePale, hx, EAVES - 1.0, hz, D + 0.5, W + 0.5, PROFILE.cornice);
    b.gable(M.roof, hx, EAVES, hz, D + 1, W + 1, 6.0);
    const face = hx + D / 2;
    // the two cylindrical oriels, corbelled out at first-floor level
    for (const s of [-1, 1]) {
      const oz2 = hz + s * (W / 2 - 4.0);
      b.cyl(M.stonePale, face + 0.4, 4.8, oz2, 2.1, 1.5, 1.0, 14, { solid: false });
      b.cyl(M.sandstone, face + 0.4, 5.8, oz2, 2.1, 2.1, 8.4, 14, { solid: false });
      b.mould(M.stonePale, face + 0.4, 14.2, oz2, 0, 0, PROFILE.cornice, { path: polyPath(14, 2.3) });
      b.cone(M.slate, face + 0.4, 14.8, oz2, 2.6, 3.4, 14);
      // the figural relief parapet under the oriel windows
      b.tier(1);
      for (let k = 0; k < 7; k++) {
        const a = -Math.PI / 2 + (k - 3) * 0.34;
        b.place(M.stonePale, b.p('quatrefoilPanel', 0.95, 1.1, 0.2),
          face + 0.4 + Math.cos(a) * 2.15, 6.1, oz2 + Math.sin(a) * 2.15, { rotY: -a - Math.PI / 2 });
      }
      b.tier(0);
      for (let f = 0; f < 2; f++) {
        for (let k = -1; k <= 1; k++) {
          const a = -Math.PI / 2 + k * 0.5;
          b.raw(M.litGlass, new THREE.BoxGeometry(1.1, 2.0, 0.2).rotateY(-a - Math.PI / 2)
            .translate(face + 0.4 + Math.cos(a) * 2.05, 8.0 + f * 3.6, oz2 + Math.sin(a) * 2.05));
        }
      }
    }
    // the arcaded courtyard entrance
    b.tier(1).place(M.stonePale, b.p('roundArchRing', 4.4, 6.0, 0.5, 1.0, { steps: 6, bevel: 0.06 }),
      face - 0.05, 0.2, hz, { rotY: -Math.PI / 2 });
    b.tier(0).box(M.doorway, face - 0.7, 0.2, hz, 0.7, 5.0, 3.6, { solid: false });
    for (let f = 0; f < 3; f++) {
      for (const i of [-2, -1, 1, 2]) {
        b.window(face + 0.06, 7.0 + f * 3.3, hz + i * 3.9, 1.5, 2.4,
          { kind: 'baroque', rotY: -Math.PI / 2 });
      }
    }
    b.tier(1);
    for (const i of [-1, 0, 1]) {
      b.place(M.stonePale, b.p('urn', 2.2), face - 0.5, EAVES - 0.2, hz + i * 7.0, {});
    }
  }

  /* ================= 5. Palác Omega — the modern intrusion ========= */
  {
    const hx = 44, hz = 4, W = 24, D = 18, H = 22;
    b.tier(0);
    b.box(M.granite, hx, 0, hz, D, H, W);
    const face = hx - D / 2;
    // a rhythmic, irregular grid of green glass squares and verticals
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 7; i++) {
        const tall = ((f * 7 + i) % 5) === 0;
        const gz = hz - W / 2 + 1.9 + i * 3.35;
        b.raw(M.glass, new THREE.BoxGeometry(0.24, tall ? 5.6 : 2.4, 2.5)
          .translate(face - 0.1, 2.4 + f * 3.4 + (tall ? 1.2 : 0), gz));
      }
    }
    b.mould(M.stonePale, hx, H - 0.9, hz, D + 0.4, W + 0.4, PROFILE.cap);
    b.box(M.metal, hx, H, hz, D - 2, 0.5, W - 2, { solid: false });
  }

  /* ================= 6. tram shelters ============================= */
  }
  // Shelters are placed from the imported tram centreline by city/props.
  for (const [sx, sz] of []) {
    b.tier(0);
    b.box(M.metal, sx, 0, sz, 9, 0.22, 3.4, { solid: false });
    for (let i = -1; i <= 1; i++) {
      b.box(M.shelterGlass, sx + i * 2.9, 0.3, sz - 1.6, 2.55, 2.3, 0.08, { solid: false });
      b.box(M.metal, sx + i * 2.9 + 1.45, 0.3, sz - 1.6, 0.12, 2.5, 0.16, { solid: false });
    }
    b.solid(sx, sz - 1.6, 9, 0.45, 0, 2.6, 'prop'); // only the back wall stops you
    b.box(M.metal, sx, 2.6, sz, 9.6, 0.26, 4, { solid: false });
    for (const c of [-4.3, 4.3]) b.cyl(M.metal, sx + c, 0, sz + 1.5, 0.1, 0.1, 2.7, 6, {});
    b.box(M.litGlass, sx + 3.2, 0.8, sz - 1.5, 1.4, 1.0, 0.1, { solid: false });
  }

  info.svoboda = {
    name: 'Náměstí Svobody',
    pos: new THREE.Vector3(0, 0, -20),
    radius: 40,
    top: COLUMN_H,
  };
}
