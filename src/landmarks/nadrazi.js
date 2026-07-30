import * as THREE from 'three';
import { PROFILE, worldSpaceUV } from './detail.js';

/**
 * Brno hlavní nádraží.
 *
 * Sourced (docs/brno-reference.md §8):
 * - Art Nouveau (secese) front from the 1902-05 reconstruction; in 1904 the old
 *   vestibule became a large central hall flanked by towers (Josef Oehm,
 *   Franz Uhl).
 * - **THE ASYMMETRY IS THE POINT.** The right-hand clock tower was destroyed in
 *   a 1944 air raid and never rebuilt, so the historically correct building has
 *   *one* tower. The east end here is the truncated stump the raid left, capped
 *   with a plain later parapet — visibly a scar, not a matching pair.
 * - the entrance front carries **two pairs of columns supporting sculptural
 *   groups** celebrating the railway.
 * - platform canopies: **cast-iron** frame, restored **double-pitched
 *   ("double-kinked")** roof profile — slender columns, latticed trusses,
 *   glazed strips, not a modern flat slab.
 * - a dense tram interchange sits immediately in front on Nádražní, so the
 *   forecourt is a transit hub rather than a quiet plaza.
 */

export const SITE = { cx: 22, cz: 292 };

/** True ground footprint: hall, forecourt canopy, platforms and their rails. */
export const RECTS = [
  [SITE.cx, SITE.cz + 27, 140, 90],
];

export function build(b, ctx) {
  const { M, info } = ctx;
  const { cx, cz } = SITE;
  b.cluster('nadrazi');

  const FRONT = cz - 13; // the Nádražní frontage
  const EAVES = 18;
  b.tier(0);

  /* ================= 1. the wings ================================== */
  for (const [wx, ww] of [[cx - 40, 50], [cx + 40, 50]]) {
    b.box(M.sandstone, wx, 0, cz, ww, EAVES, 26);
    b.mould(M.stonePale, wx, 0, cz, ww + 0.6, 26.6, PROFILE.plinth);
    b.mould(M.stonePale, wx, 5.0, cz, ww + 0.35, 26.35, PROFILE.string);
    b.mould(M.stonePale, wx, EAVES - 1.1, cz, ww + 0.5, 26.5, PROFILE.cornice);
    b.hip(M.slate, wx, EAVES, cz, ww + 1, 27, 5.4, 0.55);
    // ground-floor arcade with real arch rings, and lit booking-hall glazing
    const n = Math.floor(ww / 8.6);
    for (let i = 0; i < n; i++) {
      const px = wx - ww / 2 + (ww / n) * (i + 0.5);
      b.tier(1).place(M.stonePale, b.p('roundArchRing', 5.0, 7.6, 0.55, 1.0, { steps: 6, bevel: 0.06 }),
        px, 0.2, FRONT - 0.05, {});
      b.tier(0).box(M.litGlass, px, 0.5, FRONT + 0.9, 3.6, 6.2, 0.35, { solid: false });
      // upper storey windows with art-nouveau segmental heads
      b.window(px, 10.4, FRONT - 0.06, 2.2, 3.6, { kind: 'baroque' });
    }
    // the sinuous art-nouveau parapet: a shallow scalloped attic
    b.tier(1);
    for (let i = 0; i <= n * 2; i++) {
      const px = wx - ww / 2 + (ww / (n * 2)) * i;
      b.place(M.stonePale, b.p('circleRing', 1.1, 0.26, 0.3, 6), px, EAVES + 1.3, FRONT - 0.2, {});
    }
    b.tier(0).mould(M.stonePale, wx, EAVES + 2.2, FRONT + 0.3, ww, 2.0, PROFILE.cap);
  }

  /* ================= 2. the central hall =========================== */
  const HALL_W = 34, HALL_H = 25;
  b.box(M.sandstone, cx, 0, cz - 2, HALL_W, HALL_H, 30);
  b.mould(M.stonePale, cx, 0, cz - 2, HALL_W + 0.8, 30.8, PROFILE.plinth);
  b.mould(M.stonePale, cx, HALL_H - 1.3, cz - 2, HALL_W + 0.7, 30.7, PROFILE.cornice);
  b.hip(M.slate, cx, HALL_H, cz - 2, HALL_W + 1, 31, 7.4, 0.28);
  // the great arched vestibule window over the entrance
  b.tier(0).place(M.sandstone, b.p('archedWall', HALL_W, HALL_H - 1.5, 2.6, 17, 15.5, { spring: 0.42 }),
    cx, 0, FRONT - 2.6, {});
  b.solid(cx, FRONT - 1.3, HALL_W, 2.8, 0, HALL_H - 1.5);
  b.raw(M.litGlass, new THREE.BoxGeometry(16.2, 14.7, 0.4).translate(cx, 7.8, FRONT - 1.1));
  // the glazing bars across it, radiating from the springing
  b.tier(1);
  for (let i = -3; i <= 3; i++) {
    b.raw(M.stonePale, new THREE.BoxGeometry(0.3, 14.6, 0.34).translate(cx + i * 2.3, 7.9, FRONT - 1.35));
  }
  for (const y of [4.4, 8.2]) {
    b.raw(M.stonePale, new THREE.BoxGeometry(16.4, 0.3, 0.34).translate(cx, y, FRONT - 1.35));
  }
  for (let k = 0; k <= 8; k++) {
    const a = Math.PI * (k / 8);
    b.raw(M.stonePale, new THREE.BoxGeometry(0.26, 6.6, 0.3).rotateZ(Math.PI / 2 - a)
      .translate(cx + Math.cos(a) * 4.0, 11.4 + Math.sin(a) * 2.6, FRONT - 1.45));
  }
  b.tier(0);
  // the entrance itself, and the two pairs of columns carrying the groups
  b.box(M.doorway, cx, 0.2, FRONT - 3.5, 11, 5.4, 0.9, { solid: false });
  b.tier(1);
  for (const s of [-1, 1]) {
    for (const j of [0, 1]) {
      b.place(M.stonePale, b.p('column', 11.5, 0.62, 2), cx + s * (7.4 + j * 2.6), 0.2, FRONT - 4.4 + j * 1.4, {});
    }
    // the sculptural group celebrating the railway, on its own pedestal
    b.tier(0).box(M.stonePale, cx + s * 8.7, 11.7, FRONT - 3.9, 5.2, 1.1, 3.4, { solid: false });
    b.tier(1);
    b.place(M.stonePale, b.p('figure', 'standing', 90 + s), cx + s * 9.9, 12.8, FRONT - 4.1, { scale: 3.1, rotY: Math.PI });
    b.place(M.stonePale, b.p('figure', 'saint', 92 + s), cx + s * 7.5, 12.8, FRONT - 3.6, { scale: 2.9, rotY: Math.PI + s * 0.4 });
    b.place(M.stonePale, b.p('beast', 'lion'), cx + s * 8.7, 12.8, FRONT - 2.6, { scale: 1.8, rotY: Math.PI });
  }
  b.tier(0);
  b.mould(M.stonePale, cx, HALL_H + 0.2, FRONT - 1.4, HALL_W - 2, 2.4, PROFILE.cornice);
  b.balustrade(cx, HALL_H + 0.8, FRONT - 2.0, HALL_W - 6, { h: 1.4 });
  // the art-nouveau lettering band
  b.raw(M.bronze, new THREE.BoxGeometry(19, 1.5, 0.3).translate(cx, HALL_H - 3.2, FRONT - 1.5));

  /* ================= 3. the one surviving tower =================== */
  const TW = 14, TH = 42;
  const tx = cx - 55, tz = cz - 4;
  b.box(M.sandstone, tx, 0, tz, TW, TH, TW);
  b.mould(M.stonePale, tx, 0, tz, TW + 0.8, TW + 0.8, PROFILE.plinth);
  for (const y of [12, 22, 30]) b.mould(M.stonePale, tx, y, tz, TW + 0.4, TW + 0.4, PROFILE.string);
  b.mould(M.stonePale, tx, TH - 1.4, tz, TW + 0.9, TW + 0.9, PROFILE.cornice);
  for (let f = 0; f < 3; f++) {
    b.window(tx, 6.0 + f * 8.4, tz - TW / 2 - 0.06, 2.4, 4.2, { kind: 'baroque' });
    b.window(tx - TW / 2 - 0.06, 6.0 + f * 8.4, tz, 2.4, 4.2, { kind: 'baroque', rotY: Math.PI / 2 });
  }
  // the clock stage, with a real circular reveal
  b.place(M.sandstone, b.p('circleWall', TW, 8.6, 1.4, 3.0, 4.3), tx, TH - 10.6, tz - TW / 2 - 1.4, {});
  b.discZ(M.stonePale, tx, TH - 6.3, tz - TW / 2 - 1.5, 3.4, 0.4, 22);
  b.discZ(M.granite, tx, TH - 6.3, tz - TW / 2 - 1.72, 2.9, 0.24, 22);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.raw(M.gold, new THREE.BoxGeometry(0.2, 0.5, 0.12).rotateZ(-a)
      .translate(tx + Math.sin(a) * 2.4, TH - 6.3 + Math.cos(a) * 2.4, tz - TW / 2 - 1.86));
  }
  b.raw(M.gold, new THREE.BoxGeometry(0.24, 1.7, 0.12).rotateZ(-0.6).translate(tx + 0.44, TH - 5.6, tz - TW / 2 - 1.92));
  b.raw(M.gold, new THREE.BoxGeometry(0.16, 2.4, 0.12).rotateZ(2.4).translate(tx - 0.78, TH - 7.2, tz - TW / 2 - 1.92));
  // art-nouveau cupola: a shallow flared dome on a low drum
  b.cyl(M.copper, tx, TH, tz, 5.6, 6.6, 3.0, 12);
  b.sphere(M.copper, tx, TH + 3.0, tz, 5.8, { seg: 16, seg2: 9, phi: Math.PI / 2, sy: 0.78 });
  b.cyl(M.copper, tx, TH + 7.4, tz, 1.4, 2.0, 1.6, 10);
  b.cyl(M.gold, tx, TH + 9.0, tz, 0.1, 0.13, 3.4, 6);
  b.sphere(M.gold, tx, TH + 12.5, tz, 0.44);
  b.tier(1);
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.place(M.stonePale, b.p('urn', 3.0), tx + ox * (TW / 2 - 0.6), TH - 0.6, tz + oz * (TW / 2 - 0.6), {});
  }
  b.tier(0);

  /* ================= 4. the tower the 1944 raid took ============== */
  // Its twin stood here. What survives is the base, capped in 1945 with a flat
  // parapet and never carried higher.
  const sx2 = cx + 55;
  b.box(M.sandstone, sx2, 0, tz, TW, 20, TW);
  b.mould(M.stonePale, sx2, 0, tz, TW + 0.8, TW + 0.8, PROFILE.plinth);
  b.mould(M.stonePale, sx2, 12, tz, TW + 0.4, TW + 0.4, PROFILE.string);
  // a plain later cornice and parapet: no cupola, no clock, no urns
  b.mould(M.darkStone, sx2, 19.2, tz, TW + 0.6, TW + 0.6, PROFILE.cap);
  b.box(M.darkStone, sx2, 20, tz, TW + 0.2, 1.3, TW + 0.2, { solid: false });
  for (let f = 0; f < 2; f++) {
    b.window(sx2, 6.0 + f * 8.4, tz - TW / 2 - 0.06, 2.4, 4.2, { kind: 'baroque' });
    b.window(sx2 + TW / 2 + 0.06, 6.0 + f * 8.4, tz, 2.4, 4.2, { kind: 'baroque', rotY: -Math.PI / 2 });
  }
  // the raggedness where the upper stages were taken off
  b.tier(1);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    b.raw(M.stonePale, new THREE.BoxGeometry(1.5, 0.5, 1.5).rotateY(a)
      .translate(sx2 + Math.cos(a) * (TW / 2 - 1.2), 21.4, tz + Math.sin(a) * (TW / 2 - 1.2)));
  }
  b.tier(0);

  /* ================= 5. the platform canopies ===================== */
  // Cast-iron columns on 11 m centres carrying latticed trusses, with a
  // double-pitched (kinked) glazed roof over them.
  const PLAT = 3;
  for (let p = 0; p < PLAT; p++) {
    const pz = cz + 22 + p * 14;
    // the platform itself, low enough to step onto
    b.box(M.darkStone, cx, 0, pz, 124, 0.6, 9, { tag: 'terrain' });
    b.mould(M.stonePale, cx, 0.2, pz, 124.4, 9.4, PROFILE.cap);
    const colY = 0.6;
    for (let i = -5; i <= 5; i++) {
      const px = cx + i * 11;
      b.place(M.metal, b.p('ironColumn', 5.6, 0.16), px, colY, pz, {});
      b.solid(px, pz, 0.5, 0.5, colY, 5.6);
      if (i < 5) {
        b.place(M.metal, b.p('trussBay', 11, 1.0, 6, 0.11), px + 5.5, colY + 5.0, pz, {});
      }
      // cross-trusses spanning the platform width, every other bay
      if (i % 2 === 0) {
        b.place(M.metal, b.p('trussBay', 8.6, 0.9, 4, 0.1), px, colY + 5.0, pz, { rotY: Math.PI / 2 });
      }
    }
    // the double-kinked roof: a shallow inner pitch then a steeper eaves fall
    for (const s of [-1, 1]) {
      // the two pitches, segmented per column bay: a 124 m box would stretch
      // one slate tile across the whole shed
      for (let q = -5; q <= 5; q++) {
        const inner = new THREE.BoxGeometry(11.2, 0.2, 3.0);
        inner.rotateX(s * 0.14);
        inner.translate(cx + q * 11, colY + 6.55 - 0.21, pz + s * 1.55);
        b.raw(M.slate, worldSpaceUV(inner, 3.0));
        const outer = new THREE.BoxGeometry(11.2, 0.2, 2.4);
        outer.rotateX(s * 0.42);
        outer.translate(cx + q * 11, colY + 6.1, pz + s * 4.05);
        b.raw(M.slate, worldSpaceUV(outer, 3.0));
      }
      /* Glazed strip along the kink, which is how these sheds are lit —
         built as discrete panes between purlins. It was ONE 120 m box, and a
         single translucent quad that long is both wrong (real train-shed
         glazing is a run of panels) and actively broken: it sorts as one
         object, so it tinted half the frame and cut across the sky. Two panes
         per 11 m column bay keeps the longest transparent edge at 5.5 m. */
      const PANE = 5.5;
      for (let q = 0; q < Math.round(120 / PANE); q++) {
        const gx = cx - 60 + PANE * (q + 0.5);
        const pane = new THREE.BoxGeometry(PANE - 0.16, 0.1, 1.0);
        pane.rotateX(s * 0.14);
        pane.translate(gx, colY + 6.42, pz + s * 2.9);
        b.raw(M.shelterGlass, pane);
      }
    }
    b.raw(M.metal, new THREE.BoxGeometry(124, 0.4, 0.5).translate(cx, colY + 6.7, pz));
    // rails either side of the platform
    for (const off of [-6.5, -5.0, 5.0, 6.5]) {
      b.raw(M.metal, new THREE.BoxGeometry(126, 0.22, 0.16).translate(cx, 0.12, pz + off));
    }
    // platform numbers and lamps
    for (let i = -4; i <= 4; i += 2) {
      b.raw(M.litGlass, new THREE.BoxGeometry(0.8, 0.16, 0.8).translate(cx + i * 11, colY + 4.9, pz));
    }
  }

  /* ================= 6. the forecourt tram interchange ============ */
  for (const s of [-1, 1]) {
    const shx = cx + s * 30, shz = FRONT - 16;
    b.box(M.metal, shx, 0, shz, 22, 0.22, 3.6, { solid: false });
    for (let i = -3; i <= 3; i++) {
      b.box(M.shelterGlass, shx + i * 3.0, 0.3, shz - 1.7, 2.7, 2.4, 0.08, { solid: false });
      b.box(M.metal, shx + i * 3.0 + 1.5, 0.3, shz - 1.7, 0.12, 2.6, 0.16, { solid: false });
    }
    b.solid(shx, shz - 1.7, 22, 0.45, 0, 2.7, 'prop');
    b.box(M.metal, shx, 2.7, shz, 22.6, 0.26, 4.2, { solid: false });
    for (const c of [-10.6, 0, 10.6]) b.cyl(M.metal, shx + c, 0, shz + 1.6, 0.1, 0.1, 2.8, 6, {});
    b.box(M.litGlass, shx + 8, 0.9, shz - 1.6, 1.6, 1.1, 0.1, { solid: false });
  }

  info.nadrazi = {
    name: 'Hlavní nádraží',
    pos: new THREE.Vector3(cx, 0, FRONT - 10),
    radius: 46,
    top: TH + 13,
  };
}
