import { getMaterial } from '../materials.js';
import { label } from './mesh.js';

/**
 * The roofscape.
 *
 * Central European old-town roofs are dense: chimneys everywhere, dormers,
 * roof windows, ridge tiles, valleys where a courtyard wing meets the front
 * house, firewalls stepping over the party walls, aerials, satellite dishes,
 * gutters and a downpipe at every party wall. Everything here is merged
 * into the buckets the houses already use plus three of its own (brick,
 * metal, glass), so the whole roofscape costs three extra draw calls.
 */
export class Roofscape {
  constructor(rng, houseMats) {
    this.rng = rng;
    this.M = {
      brick: getMaterial('stone', { base: '#8a5546', mortar: '#6c4a41', scale: 0.7 }),
      metal: houseMats.metal,
      cornice: houseMats.cornice,
      clay: houseMats.roofClay,
      glass: getMaterial('paneGlass', { seed: 1501, panesX: 2, panesY: 2 }),
    };
    label(this.M);
    this.chimneys = 0;
    this.dormers = 0;
  }

  /** Local -> world for a mass rotated by `rot` about its centre. */
  static place(mass, lx, lz) {
    const c = Math.cos(mass.rot), s = Math.sin(mass.rot);
    return [mass.x + lx * c + lz * s, mass.z - lx * s + lz * c];
  }

  /** Everything that sits on a pitched roof. */
  add(batches, mass, { alongX, ridgeH, ow, od, skipPlusX, skipMinusX, isWing }) {
    const rng = this.rng;
    const { x, z, rot, eaves } = mass;
    // span = across the pitch, run = along the ridge
    const span = alongX ? od : ow;
    const run = alongX ? ow : od;
    const surfaceY = (across) => eaves + ridgeH * (1 - Math.min(1, Math.abs(across) / (span / 2)));
    const at = (alongRidge, across) => (alongX
      ? Roofscape.place(mass, alongRidge, across)
      : Roofscape.place(mass, across, alongRidge));

    /* ---- ridge tiles ---- */
    const ridge = batches.get(this.M.clay);
    {
      const [rx, rz] = at(0, 0);
      ridge.box(rx, eaves + ridgeH - 0.1, rz,
        alongX ? run : 0.36, 0.2, alongX ? 0.36 : run,
        rot, () => [run / 0.8, 0.3, 0, 0],
        [false, false, false, false, false, true]);
    }

    /* ---- chimneys, clustered near the ridge as they really are ---- */
    const n = mass.chimneys ?? 2;
    const brick = batches.get(this.M.brick);
    for (let i = 0; i < n; i++) {
      const alongRidge = rng.float(-run / 2 + 0.9, run / 2 - 0.9);
      const across = rng.float(-span * 0.16, span * 0.16);
      const [cx, cz] = at(alongRidge, across);
      const baseY = surfaceY(across) - 0.5;
      const h = rng.float(1.1, 2.4);
      const cw = rng.float(0.5, 0.95);
      const cd = rng.float(0.45, 0.7);
      brick.box(cx, baseY, cz, cw, h, cd, rot,
        (f) => [(f === 0 || f === 1 ? cd : cw) / 0.5, h / 0.5, 0, 0],
        [false, false, false, false, true, true]);
      brick.box(cx, baseY + h, cz, cw + 0.16, 0.14, cd + 0.16, rot,
        () => [1.4, 0.4, 0, 0], [false, false, false, false, false, true]);
      if (rng.chance(0.45)) {
        const pots = batches.get(this.M.metal);
        pots.box(cx, baseY + h + 0.14, cz, cw * 0.42, rng.float(0.24, 0.44), cd * 0.5, rot,
          () => [0.6, 0.6, 0, 0], [false, false, false, false, false, true]);
      }
      this.chimneys++;
    }

    /* ---- dormers on the street pitch ---- */
    if (!isWing && ridgeH > 3.2) {
      const count = Math.min(mass.dormers ?? 0, Math.max(0, Math.floor(run / 3.4)));
      for (let i = 0; i < count; i++) {
        const acrossSign = rng.chance(0.78) ? -1 : 1;   // mostly street side
        const across = acrossSign * span * 0.28;
        const alongRidge = ((i + 0.5) / Math.max(1, count) - 0.5) * (run - 2.2)
          + rng.float(-0.35, 0.35);
        const [dx, dz] = at(alongRidge, across);
        const y = surfaceY(across) - 0.35;
        const drot = rot + (alongX
          ? (acrossSign < 0 ? 0 : Math.PI)
          : (acrossSign < 0 ? -Math.PI / 2 : Math.PI / 2));
        const dw = rng.float(1.15, 1.6);
        const dh = rng.float(1.25, 1.7);
        // cheeks + face
        batches.get(this.M.cornice).box(dx, y, dz, dw, dh, 1.5, drot,
          (f) => [(f === 0 || f === 1 ? 1.5 : dw) / 1.2, dh / 1.2, 0, 0],
          [false, false, true, false, true, true]);
        // its own little pitched roof
        batches.get(this.M.clay).gable(dx, y + dh, dz, dw + 0.24, 1.7, 0.55, drot, 1.4);
        // glazing, slightly recessed into the face
        const fc = Math.cos(drot), fs = Math.sin(drot);
        batches.get(this.M.glass).quad(
          dx + fc * dw * 0.34 - fs * 0.78, y + 0.22, dz - fs * dw * 0.34 - fc * 0.78,
          -fc * dw * 0.68, 0, fs * dw * 0.68,
          0, dh - 0.42, 0, 1, 1,
        );
        this.dormers++;
      }
    }

    /* ---- roof windows: flush dark panes lying in the pitch ---- */
    if (rng.chance(0.42)) {
      const across = (rng.chance(0.6) ? -1 : 1) * span * 0.34;
      const alongRidge = rng.float(-run / 2 + 1.2, run / 2 - 1.2);
      const [wx, wz] = at(alongRidge, across);
      const y = surfaceY(across) + 0.04;
      const g = batches.get(this.M.glass);
      const c = Math.cos(rot), s = Math.sin(rot);
      const uX = alongX ? [c, 0, -s] : [s, 0, c];
      const uZ = alongX ? [s, 0, c] : [c, 0, -s];
      const slope = (ridgeH / (span / 2)) * (across < 0 ? 1 : -1);
      // u runs up the slope, v across the ridge, so the normal faces the sky
      g.quad(
        wx - uX[0] * 0.45 - uZ[0] * 0.5, y, wz - uX[2] * 0.45 - uZ[2] * 0.5,
        uZ[0], slope, uZ[2],
        uX[0] * 0.9, 0, uX[2] * 0.9,
        1, 1,
      );
    }

    /* ---- aerials and satellite dishes ---- */
    if (rng.chance(0.3)) {
      const [ax, az] = at(rng.float(-run / 3, run / 3), rng.float(-0.4, 0.4));
      const m = batches.get(this.M.metal);
      const top = eaves + ridgeH;
      m.box(ax, top, az, 0.05, rng.float(1.4, 2.6), 0.05, rot, () => [0.4, 3, 0, 0]);
      for (let k = 0; k < 3; k++) {
        m.box(ax, top + 0.9 + k * 0.34, az, 0.9 - k * 0.2, 0.04, 0.04, rot, () => [2, 0.3, 0, 0]);
      }
    }
    if (rng.chance(0.22)) {
      const acrossSign = rng.chance(0.5) ? -1 : 1;
      const [sx, sz] = at(rng.float(-run / 3, run / 3), acrossSign * span * 0.3);
      const y = surfaceY(acrossSign * span * 0.3);
      const m = batches.get(this.M.metal);
      m.box(sx, y, sz, 0.07, 0.5, 0.07, rot, () => [0.3, 1, 0, 0]);
      m.box(sx, y + 0.5, sz, 0.7, 0.66, 0.12, rot + rng.float(-0.6, 0.6),
        () => [1, 1, 0, 0], [false, false, false, false, false, true]);
    }
  }

  /** Rooftop clutter for the flat-roofed outer blocks. */
  addFlat(batches, mass) {
    const rng = this.rng;
    const { x, z, rot, eaves, w, d } = mass;
    const m = batches.get(this.M.metal);
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const lx = rng.float(-w / 2 + 1.4, w / 2 - 1.4);
      const lz = rng.float(-d / 2 + 1.4, d / 2 - 1.4);
      const [px, pz] = Roofscape.place(mass, lx, lz);
      const bw = rng.float(1.1, 2.6), bh = rng.float(0.7, 1.8), bd = rng.float(1, 2.2);
      m.box(px, eaves + 0.35, pz, bw, bh, bd, rot,
        (f) => [(f === 0 || f === 1 ? bd : bw) / 1.4, bh / 1.4, 0, 0],
        [false, false, false, false, false, true]);
    }
    if (rng.chance(0.5)) {
      const [px, pz] = Roofscape.place(mass, rng.float(-w / 3, w / 3), rng.float(-d / 3, d / 3));
      m.box(px, eaves + 0.35, pz, 0.06, rng.float(2.5, 5), 0.06, rot, () => [0.4, 6, 0, 0]);
    }
    void x; void z;
  }

  /** Gutter along the eaves and a downpipe at each party wall. */
  plumbing(batches, mass, { skipPlusX, skipMinusX }) {
    const { x, z, rot, eaves, w, d } = mass;
    const m = batches.get(this.M.metal);
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const sgn of [-1, 1]) {
      const gx = x - s * sgn * (d / 2 + 0.22);
      const gz = z - c * sgn * (d / 2 + 0.22);
      m.box(gx, eaves - 0.06, gz, w + 0.3, 0.16, 0.2, rot,
        () => [w / 0.5, 0.4, 0, 0], [false, false, false, false, true, true]);
    }
    // A downpipe at every party wall: always one on the -x edge, plus one on
    // the +x edge when nothing abuts there, so a boundary is never doubled.
    const edges = skipPlusX ? [-1] : [-1, 1];
    void skipMinusX;
    for (const sgn of edges) {
      const lx = sgn * (w / 2 - 0.16);
      const lz = -(d / 2 + 0.13);
      const px = x + lx * c + lz * s;
      const pz = z - lx * s + lz * c;
      m.box(px, 0, pz, 0.13, eaves - 0.1, 0.13, rot,
        () => [0.5, eaves / 1.2, 0, 0], [false, false, false, false, true, true]);
    }
  }

  finish() {
    return { meshes: 0, chimneys: this.chimneys, dormers: this.dormers };
  }
}
