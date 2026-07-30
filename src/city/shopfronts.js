import * as THREE from 'three';
import { Rng } from '../rng.js';
import { getMaterial, CZECH_SIGNS } from '../materials.js';
import { label } from './mesh.js';
import { TIER } from './chunks.js';

/**
 * Ground-floor commerce.
 *
 * Every shopfront is a projecting frame (piers, lintel, stallriser) with the
 * glazing set back behind it, a lit interior, an awning on some, a fascia
 * sign, a roller shutter on the shabbier ones, and an A-board out on the
 * pavement.
 *
 * Signage is the interesting constraint: a sign baked into the facade
 * material would force one material per shop name. So *everything* painted
 * here — sixteen Czech shop fascias, four striped awning canvases, four lit
 * shop interiors and a corrugated roller shutter — lives in a single 1024²
 * atlas (albedo plus an emissive companion for the lit cells), and each
 * quad UV-maps into one 256 x 128 cell. One material, one texture upload,
 * one chunk bucket, for the whole city's commerce.
 *
 * All of it goes into the chunked detail tier: a shopfront is a ground-level
 * read, and past about a hundred metres the piers, awning and A-board are a
 * couple of pixels each.
 */

/* atlas: 4 columns x 8 rows of 256 x 128 cells */
const A_COLS = 4;
const A_ROWS = 8;
const CELL_W = 256;
const CELL_H = 128;
/** cell ranges within the atlas */
const SIGN_0 = 0;      // 0..15  shop fascias
const SIGN_N = 16;
const AWNING_0 = 16;   // 16..19 striped canvas
const AWNING_N = 4;
const SHOP_0 = 20;     // 20..23 lit interiors
const SHOP_N = 4;
const SHUTTER_0 = 24;  // 24..27 corrugated shutter, some tagged
const SHUTTER_N = 4;

const BAND_COLOURS = [
  ['#12402c', '#f2e6c8'], ['#5c1a1a', '#f6ead0'], ['#1b2f52', '#e8eef6'],
  ['#3d2a12', '#f0dfb4'], ['#0f3a3a', '#e6f2ee'], ['#4a1338', '#f4e2ee'],
  ['#2b2b2e', '#e9e4d6'], ['#6b4a10', '#fdf2d2'],
];
const AWNING_PAIRS = [
  ['#8d2b26', '#e9dcc2'], ['#1f4a33', '#e9dcc2'],
  ['#25406b', '#ded6c4'], ['#6b5a1d', '#f0e6cc'],
];
const INTERIOR_TINTS = [
  ['#3b2a12', '#ffd9a0'], ['#123028', '#bfe8d4'],
  ['#3a1c14', '#ffb877'], ['#1a2436', '#cfe0ff'],
];
const TAG_COLOURS = ['#c8452f', '#2f6fc8', '#d8b32f', '#39b573'];

/** UV window for an atlas cell. */
function cellUV(i) {
  const col = i % A_COLS;
  const row = Math.floor(i / A_COLS);
  return [col / A_COLS, 1 - (row + 1) / A_ROWS, 1 / A_COLS, 1 / A_ROWS];
}

function canvas2d(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The one shopfront atlas: albedo + emissive, everything commerce needs. */
function shopAtlas(rng) {
  const W = A_COLS * CELL_W;
  const H = A_ROWS * CELL_H;
  const col = canvas2d(W, H);
  const emi = canvas2d(W, H);
  const cc = col.getContext('2d');
  const ec = emi.getContext('2d');
  cc.fillStyle = '#14161a';
  cc.fillRect(0, 0, W, H);
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, W, H);
  const at = (i) => [(i % A_COLS) * CELL_W, Math.floor(i / A_COLS) * CELL_H];

  /* ---- shop fascias ---- */
  for (let k = 0; k < SIGN_N; k++) {
    const [x, y] = at(SIGN_0 + k);
    const [bg, fg] = BAND_COLOURS[k % BAND_COLOURS.length];
    const text = CZECH_SIGNS[k % CZECH_SIGNS.length];
    cc.fillStyle = bg;
    cc.fillRect(x, y, CELL_W, CELL_H);
    const g = cc.createLinearGradient(x, y, x, y + CELL_H);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    cc.fillStyle = g;
    cc.fillRect(x, y, CELL_W, CELL_H);
    cc.strokeStyle = fg;
    cc.lineWidth = CELL_H * 0.05;
    cc.strokeRect(x + 6, y + 6, CELL_W - 12, CELL_H - 12);
    const lit = rng.chance(0.62);
    for (const ctx of lit ? [cc, ec] : [cc]) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = CELL_H * 0.52;
      ctx.font = `bold ${size}px sans-serif`;
      while (ctx.measureText(text).width > CELL_W * 0.84 && size > 8) {
        size -= 2;
        ctx.font = `bold ${size}px sans-serif`;
      }
      ctx.fillStyle = ctx === ec ? '#ffe4ad' : fg;
      ctx.fillText(text, x + CELL_W / 2, y + CELL_H / 2);
      ctx.restore();
    }
    // grime, so they are not showroom-new
    cc.globalAlpha = 0.22;
    cc.fillStyle = '#14120e';
    for (let i = 0; i < 8; i++) {
      cc.beginPath();
      cc.ellipse(x + rng.float(0, CELL_W), y + rng.float(0, CELL_H),
        rng.float(4, 22), rng.float(3, 12), rng.float(0, 3), 0, Math.PI * 2);
      cc.fill();
    }
    cc.globalAlpha = 1;
  }

  /* ---- awning canvas: stripes run down the slope, i.e. along v ---- */
  for (let k = 0; k < AWNING_N; k++) {
    const [x, y] = at(AWNING_0 + k);
    const [a, b] = AWNING_PAIRS[k];
    const stripe = CELL_W / 10;
    for (let i = 0; i < 10; i++) {
      cc.fillStyle = i % 2 ? a : b;
      cc.fillRect(x + i * stripe, y, stripe, CELL_H);
    }
    cc.globalAlpha = 0.2;
    cc.fillStyle = '#241d14';
    for (let i = 0; i < 40; i++) {
      cc.fillRect(x + rng.float(0, CELL_W), y + rng.float(0, CELL_H),
        rng.float(1, 6), rng.float(1, 5));
    }
    cc.globalAlpha = 1;
    cc.strokeStyle = 'rgba(0,0,0,0.35)';
    cc.lineWidth = 3;
    cc.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
  }

  /* ---- lit shop interiors seen through the glazing ---- */
  for (let k = 0; k < SHOP_N; k++) {
    const [x, y] = at(SHOP_0 + k);
    const [dark, warm] = INTERIOR_TINTS[k];
    const g = cc.createLinearGradient(x, y, x, y + CELL_H);
    g.addColorStop(0, warm);
    g.addColorStop(0.55, dark);
    g.addColorStop(1, '#0d0f12');
    cc.fillStyle = g;
    cc.fillRect(x, y, CELL_W, CELL_H);
    const eg = ec.createLinearGradient(x, y, x, y + CELL_H);
    eg.addColorStop(0, warm);
    eg.addColorStop(0.7, dark);
    eg.addColorStop(1, '#000');
    ec.fillStyle = eg;
    ec.fillRect(x + 3, y + 3, CELL_W - 6, CELL_H - 6);
    // shelving and hanging goods, as silhouettes
    for (let r = 0; r < 4; r++) {
      const sy = y + CELL_H * (0.3 + r * 0.17);
      for (const ctx of [cc, ec]) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x + CELL_W * 0.06, sy, CELL_W * 0.88, CELL_H * 0.03);
      }
      for (let j = 0; j < 8; j++) {
        const bw = rng.float(CELL_W * 0.03, CELL_W * 0.07);
        const bh = rng.float(CELL_H * 0.05, CELL_H * 0.11);
        const bx = x + CELL_W * 0.08 + j * CELL_W * 0.11 + rng.float(-4, 4);
        for (const ctx of [cc, ec]) {
          ctx.fillStyle = 'rgba(0,0,0,0.42)';
          ctx.fillRect(bx, sy - bh, bw, bh);
        }
      }
    }
    for (const ctx of [cc, ec]) {
      ctx.strokeStyle = ctx === ec ? '#000' : '#5d5850';
      ctx.lineWidth = CELL_H * 0.05;
      ctx.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
      ctx.beginPath();
      ctx.moveTo(x + CELL_W / 2, y);
      ctx.lineTo(x + CELL_W / 2, y + CELL_H);
      ctx.stroke();
    }
  }

  /* ---- corrugated roller shutters, half of them tagged ---- */
  for (let k = 0; k < SHUTTER_N; k++) {
    const [x, y] = at(SHUTTER_0 + k);
    cc.fillStyle = '#6f7176';
    cc.fillRect(x, y, CELL_W, CELL_H);
    for (let yy = 0; yy < CELL_H; yy += 5) {
      cc.fillStyle = 'rgba(0,0,0,0.3)';
      cc.fillRect(x, y + yy, CELL_W, 2);
      cc.fillStyle = 'rgba(255,255,255,0.1)';
      cc.fillRect(x, y + yy + 2, CELL_W, 1);
    }
    if (k % 2 === 0) {
      for (let i = 0; i < 2; i++) {
        cc.save();
        cc.globalAlpha = 0.75;
        cc.fillStyle = TAG_COLOURS[rng.int(0, TAG_COLOURS.length - 1)];
        cc.translate(x + rng.float(CELL_W * 0.2, CELL_W * 0.8),
          y + rng.float(CELL_H * 0.3, CELL_H * 0.7));
        cc.rotate(rng.float(-0.2, 0.2));
        cc.beginPath();
        cc.moveTo(-CELL_W * 0.16, 0);
        cc.quadraticCurveTo(0, -CELL_H * 0.26, CELL_W * 0.16, 0);
        cc.quadraticCurveTo(0, CELL_H * 0.2, -CELL_W * 0.16, 0);
        cc.fill();
        cc.restore();
      }
    }
  }

  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const em = new THREE.CanvasTexture(emi);
  em.colorSpace = THREE.SRGBColorSpace;
  em.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    name: 'shopAtlas',
    map,
    emissiveMap: em,
    emissive: new THREE.Color(0xffca7a),
    emissiveIntensity: 1.2,
    roughness: 0.5,
    metalness: 0.12,
    side: THREE.DoubleSide,
  });
}

export class Shopfronts {
  constructor(rng, { breakables, seed = 20250726 }) {
    this.rng = rng;
    this.breakables = breakables;
    const art = new Rng(seed ^ 0x5f5e10d);
    this.M = {
      atlas: shopAtlas(art),
      pier: getMaterial('stone', { base: '#cdc4b2', mortar: '#b0a693', scale: 1.4 }),
      metal: getMaterial('paintedMetal', { seed: 1405, color: '#2b2f34' }),
    };
    label(this.M);
    this.jobs = [];
    this.count = 0;
  }

  add(plot) {
    this.jobs.push(plot);
  }

  finish(chunks, collision) {
    const rng = this.rng;
    for (const plot of this.jobs) {
      const { x, z, w, d, rot, storeys, shabby } = plot;
      const B = (m) => chunks.get(m, x, z, TIER.DETAIL);
      const parter = storeys[0];
      const c = Math.cos(rot), s = Math.sin(rot);
      const ax = c, az = -s;                 // along the frontage
      const ox = -s, oz = -c;                // outward, towards the street
      const px = x + ox * (d / 2), pz = z + oz * (d / 2);
      const pier = Math.min(0.9, Math.max(0.42, w * 0.07));
      const openW = Math.max(2.0, w - pier * 2 - 0.3);
      const openH = Math.min(parter.h - 0.95, 3.0);
      const riser = 0.5;

      /* piers, lintel and stallriser: the projecting frame */
      const stone = B(this.M.pier);
      for (const sgn of [-1, 1]) {
        const lx = sgn * (w / 2 - pier / 2);
        stone.box(px + ax * lx + ox * 0.28, 0, pz + az * lx + oz * 0.28,
          pier, openH + 0.45, 0.56, rot,
          (f) => [(f === 0 || f === 1 ? 0.56 : pier) / 0.7, (openH + 0.45) / 0.9, 0, 0],
          [false, false, true, false, false, true]);
      }
      stone.box(px + ox * 0.3, openH + 0.45, pz + oz * 0.3, w, 0.4, 0.6, rot,
        (f) => [(f === 0 || f === 1 ? 0.6 : w) / 0.8, 0.4, 0, 0],
        [false, false, true, false, false, true]);
      stone.box(px + ox * 0.24, 0, pz + oz * 0.24, openW, riser, 0.48, rot,
        () => [openW / 0.8, riser, 0, 0],
        [false, false, true, false, false, true]);

      /* glazing with a lit interior, set back behind the frame */
      const atlas = B(this.M.atlas);
      const [gu, gv, gsu, gsv] = cellUV(SHOP_0 + rng.int(0, SHOP_N - 1));
      atlas.quad(
        px + ax * (openW / 2) + ox * 0.1, riser, pz + az * (openW / 2) + oz * 0.1,
        -ax * openW, 0, -az * openW,
        0, openH - riser, 0,
        gsu, gsv, gu, gv,
      );

      /* roller shutter on the shabby ones */
      if (shabby && rng.chance(0.55)) {
        const [hu, hv, hsu, hsv] = cellUV(SHUTTER_0 + rng.int(0, SHUTTER_N - 1));
        atlas.quad(
          px + ax * (openW / 2) + ox * 0.16, 0.05, pz + az * (openW / 2) + oz * 0.16,
          -ax * openW, 0, -az * openW,
          0, openH - 0.05, 0,
          hsu, hsv, hu, hv,
        );
      }

      /* fascia sign */
      const [su, sv, ssu, ssv] = cellUV(SIGN_0 + ((plot.signIndex + this.count) % SIGN_N));
      const fascH = Math.min(0.72, parter.h - openH - 0.5);
      if (fascH > 0.24) {
        atlas.quad(
          px + ax * (w * 0.46) + ox * 0.38, openH + 0.86, pz + az * (w * 0.46) + oz * 0.38,
          -ax * w * 0.92, 0, -az * w * 0.92,
          0, fascH, 0,
          ssu, ssv, su, sv,
        );
      }

      /* awning over about a third of them */
      if (rng.chance(0.36)) {
        const [au, av, asu, asv] = cellUV(AWNING_0 + rng.int(0, AWNING_N - 1));
        const reach = rng.float(1.1, 1.7);
        atlas.quad(
          px - ax * (openW / 2) + ox * 0.34, openH + 0.8, pz - az * (openW / 2) + oz * 0.34,
          ax * openW, 0, az * openW,
          ox * reach, -0.62, oz * reach,
          asu, asv, au, av,
        );
        const m = B(this.M.metal);
        for (const sgn of [-1, 1]) {
          const lx = sgn * openW * 0.44;
          m.box(px + ax * lx + ox * (0.34 + reach / 2), openH + 0.5,
            pz + az * lx + oz * (0.34 + reach / 2), 0.06, 0.06, reach, rot,
            () => [0.4, 0.4, 0, 0]);
        }
      }

      /* an A-board out on the pavement */
      if (rng.chance(0.34)) {
        const bx = px + ox * rng.float(1.5, 2.3) + ax * rng.float(-w * 0.3, w * 0.3);
        const bz = pz + oz * rng.float(1.5, 2.3) + az * rng.float(-w * 0.3, w * 0.3);
        const brot = rot + rng.float(-0.7, 0.7);
        const [bu, bv, bsu, bsv] = cellUV(SIGN_0 + rng.int(0, SIGN_N - 1));
        const bc = Math.cos(brot), bs = Math.sin(brot);
        for (const lean of [-1, 1]) {
          atlas.quad(
            bx + bc * 0.28 - bs * lean * 0.06, 0.06, bz - bs * 0.28 - bc * lean * 0.06,
            -bc * 0.56, 0, bs * 0.56,
            -bs * lean * 0.24, 0.82, -bc * lean * 0.24,
            bsu, bsv, bu, bv,
          );
        }
        /* Deliberately *not* registered as breakable: an A-board is two
         * quads merged into the shared sign atlas, so it has no instance to
         * collapse, and a prop that sheds debris while still standing there
         * is worse than a prop that simply does not break. It keeps its
         * collider and its `wood` surface for footsteps and impact decals. */
        collision.add(bx, bz, 0.7, 0.55, 0, 0.9, 'prop', 'wood');
      }

      /* the frame is solid, and the glass is what the player will shoot */
      collision.add(px + ox * 0.3, pz + oz * 0.3,
        Math.abs(ax) * w + Math.abs(ox) * 0.7, Math.abs(az) * w + Math.abs(oz) * 0.7,
        0, openH + 0.85, 'window', 'glass');

      this.count++;
    }
    return { shops: this.count };
  }
}
