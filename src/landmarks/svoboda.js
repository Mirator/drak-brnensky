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
 * The square's three named frontages — **Dům u čtyř mamlasů** (1899-1902,
 * Wanderley), **Schwanzův palác / Dům pánů z Lipé** (from 1589) and **Palác
 * Omega** (2006) — used to be authored here as free-standing blocks on guessed
 * rectangles. They are now raised from their own OSM shells, with the plaster
 * style picked per building by `facadeRecipes` in
 * src/data/brno-visual-overrides.json, so they stand on the real frontage line
 * instead of doubling it. (The brief's "Schwansee" does not exist — see the
 * dossier's flagged name correction.)
 *
 * GAMEPLAY: the boss fight happens here. Nothing is added inside the plaza rect
 * except the column and the orloj that were already there, and neither gained
 * footprint.
 */

export const SITE = { cx: BRNO_PLACES.svoboda.x, cz: BRNO_PLACES.svoboda.z };
/** The corroborated height: 20 m to the top of the Marian figure. */
export const COLUMN_H = 20.0;
export const COLUMN_AT = [BRNO_PLACES.column.x, BRNO_PLACES.column.z];
/** ~6 m, per the dossier. */
export const ORLOJ_H = 6.0;
export const ORLOJ_AT = [BRNO_PLACES.orloj.x, BRNO_PLACES.orloj.z];

/**
 * Footprints. Only the column and the orloj are reserved here — the frontages
 * are imported buildings now, and reserving their old guessed rectangles would
 * punch holes in the paving where nothing stands.
 */
export const RECTS = [
  [ORLOJ_AT[0], ORLOJ_AT[1], 16, 16], // orloj plinth and its apron
  [COLUMN_AT[0], COLUMN_AT[1], 14, 14], // plague column steps
];

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

  /* The three named frontages and the tram shelters that used to be authored
   * here are gone: the frontages are raised from their OSM shells (see the
   * module comment) and the shelters are placed on the imported tram
   * centreline by src/city/props.js. Both were duplicating what the
   * geospatial city already builds, a few metres off the real line. */

  info.svoboda = {
    name: 'Náměstí Svobody',
    pos: new THREE.Vector3(0, 0, -20),
    radius: 40,
    top: COLUMN_H,
  };
}
