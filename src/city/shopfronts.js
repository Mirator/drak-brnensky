import * as THREE from 'three';
import { Rng } from '../rng.js';
import { getMaterial, CZECH_SIGNS } from '../materials.js';
import { Batches, label } from './mesh.js';

/**
 * Ground-floor commerce.
 *
 * Every shopfront is a projecting frame (piers, lintel, stallriser) with the
 * glazing set back behind it, a lit interior, an awning on some, a fascia
 * sign, a roller shutter on the shabbier ones, and an A-board out on the
 * pavement.
 *
 * The signage is the interesting constraint: a sign baked into the facade
 * material would force one material per shop name. Instead the names are
 * drawn into a single 4x4 *atlas* (albedo + emissive) here in city code, and
 * each fascia UV-maps into one cell — so the whole city's signage, in twelve
 * real Czech shop names and several band colours, is one draw call.
 */

const SIGN_COLS = 4;
const SIGN_ROWS = 4;
const SIGN_CELLS = SIGN_COLS * SIGN_ROWS;

const BAND_COLOURS = [
  ['#12402c', '#f2e6c8'], ['#5c1a1a', '#f6ead0'], ['#1b2f52', '#e8eef6'],
  ['#3d2a12', '#f0dfb4'], ['#0f3a3a', '#e6f2ee'], ['#4a1338', '#f4e2ee'],
  ['#2b2b2e', '#e9e4d6'], ['#6b4a10', '#fdf2d2'],
];

function canvas2d(size, h = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  return c;
}

/** 4x4 atlas of enamel-style shop fascias, plus a matching emissive mask. */
function signAtlas(rng) {
  const S = 1024;
  const cell = S / SIGN_COLS;
  const col = canvas2d(S);
  const emi = canvas2d(S);
  const cc = col.getContext('2d');
  const ec = emi.getContext('2d');
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, S, S);
  for (let i = 0; i < SIGN_CELLS; i++) {
    const cx = (i % SIGN_COLS) * cell;
    const cy = Math.floor(i / SIGN_COLS) * cell;
    const [bg, fg] = BAND_COLOURS[i % BAND_COLOURS.length];
    const text = CZECH_SIGNS[i % CZECH_SIGNS.length];
    const pad = cell * 0.04;
    cc.fillStyle = bg;
    cc.fillRect(cx, cy, cell, cell);
    // enamel sheen + border
    const g = cc.createLinearGradient(cx, cy, cx, cy + cell);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.22)');
    cc.fillStyle = g;
    cc.fillRect(cx, cy, cell, cell);
    cc.strokeStyle = fg;
    cc.lineWidth = cell * 0.022;
    cc.strokeRect(cx + pad, cy + pad, cell - pad * 2, cell - pad * 2);
    // the name, scaled to fit the band
    const lit = rng.chance(0.62);
    for (const ctx of lit ? [cc, ec] : [cc]) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = cell * 0.34;
      ctx.font = `bold ${size}px sans-serif`;
      while (ctx.measureText(text).width > cell * 0.8 && size > 6) {
        size -= 2;
        ctx.font = `bold ${size}px sans-serif`;
      }
      ctx.fillStyle = ctx === ec ? '#ffe4ad' : fg;
      ctx.fillText(text, cx + cell / 2, cy + cell / 2);
      ctx.restore();
    }
    // a little grime in the corners so they are not showroom-new
    cc.globalAlpha = 0.22;
    cc.fillStyle = '#14120e';
    for (let k = 0; k < 8; k++) {
      cc.beginPath();
      cc.ellipse(cx + rng.float(0, cell), cy + rng.float(0, cell),
        rng.float(4, 22), rng.float(3, 14), rng.float(0, 3), 0, Math.PI * 2);
      cc.fill();
    }
    cc.globalAlpha = 1;
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const em = new THREE.CanvasTexture(emi);
  em.colorSpace = THREE.SRGBColorSpace;
  em.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map, emissiveMap: em, emissive: new THREE.Color(0xffca7a), emissiveIntensity: 1.1,
    roughness: 0.55, metalness: 0.1,
  });
}

/** 2x2 atlas of lit shop interiors seen through the glazing. */
function shopGlassAtlas(rng) {
  const S = 512;
  const cell = S / 2;
  const col = canvas2d(S);
  const emi = canvas2d(S);
  const cc = col.getContext('2d');
  const ec = emi.getContext('2d');
  ec.fillStyle = '#000';
  ec.fillRect(0, 0, S, S);
  const tints = [
    ['#3b2a12', '#ffd9a0'], ['#123028', '#bfe8d4'],
    ['#3a1c14', '#ffb877'], ['#1a2436', '#cfe0ff'],
  ];
  for (let i = 0; i < 4; i++) {
    const cx = (i % 2) * cell, cy = Math.floor(i / 2) * cell;
    const [dark, warm] = tints[i];
    const g = cc.createLinearGradient(cx, cy, cx, cy + cell);
    g.addColorStop(0, warm);
    g.addColorStop(0.55, dark);
    g.addColorStop(1, '#0d0f12');
    cc.fillStyle = g;
    cc.fillRect(cx, cy, cell, cell);
    const eg = ec.createLinearGradient(cx, cy, cx, cy + cell);
    eg.addColorStop(0, warm);
    eg.addColorStop(0.7, dark);
    eg.addColorStop(1, '#000');
    ec.fillStyle = eg;
    ec.fillRect(cx + 3, cy + 3, cell - 6, cell - 6);
    // shelving and hanging goods, as silhouettes
    for (let k = 0; k < 5; k++) {
      const sy = cy + cell * (0.28 + k * 0.14);
      for (const ctx of [cc, ec]) {
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(cx + cell * 0.08, sy, cell * 0.84, cell * 0.035);
      }
      for (let j = 0; j < 6; j++) {
        const bw = rng.float(cell * 0.05, cell * 0.11);
        const bh = rng.float(cell * 0.04, cell * 0.09);
        const bx = cx + cell * 0.1 + j * cell * 0.13 + rng.float(-4, 4);
        for (const ctx of [cc, ec]) {
          ctx.fillStyle = 'rgba(0,0,0,0.42)';
          ctx.fillRect(bx, sy - bh, bw, bh);
        }
      }
    }
    // mullions
    for (const ctx of [cc, ec]) {
      ctx.strokeStyle = ctx === ec ? '#000' : '#5d5850';
      ctx.lineWidth = cell * 0.03;
      ctx.strokeRect(cx + 2, cy + 2, cell - 4, cell - 4);
      ctx.beginPath();
      ctx.moveTo(cx + cell / 2, cy);
      ctx.lineTo(cx + cell / 2, cy + cell);
      ctx.stroke();
    }
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const em = new THREE.CanvasTexture(emi);
  em.colorSpace = THREE.SRGBColorSpace;
  em.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map, emissiveMap: em, emissive: new THREE.Color(0xffc98a), emissiveIntensity: 1.5,
    roughness: 0.25, metalness: 0.3,
  });
}

/** 2x2 atlas of striped awning canvas. */
function awningAtlas(rng) {
  const S = 256;
  const cell = S / 2;
  const c = canvas2d(S);
  const ctx = c.getContext('2d');
  const pairs = [['#8d2b26', '#e9dcc2'], ['#1f4a33', '#e9dcc2'], ['#25406b', '#ded6c4'], ['#6b5a1d', '#f0e6cc']];
  for (let i = 0; i < 4; i++) {
    const cx = (i % 2) * cell, cy = Math.floor(i / 2) * cell;
    const [a, b] = pairs[i];
    const stripe = cell / 8;
    for (let k = 0; k < 8; k++) {
      ctx.fillStyle = k % 2 ? a : b;
      ctx.fillRect(cx + k * stripe, cy, stripe, cell);
    }
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#241d14';
    for (let k = 0; k < 40; k++) {
      ctx.fillRect(cx + rng.float(0, cell), cy + rng.float(0, cell), rng.float(1, 6), rng.float(1, 5));
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(cx + 1, cy + 1, cell - 2, cell - 2);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
}

/** Corrugated roller shutter, tagged on about half the cells. */
function shutterTexture(rng) {
  const S = 256;
  const c = canvas2d(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6f7176';
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 8) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, y, S, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, y + 3, S, 2);
  }
  const tags = ['#c8452f', '#2f6fc8', '#d8b32f', '#39b573'];
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = tags[rng.int(0, tags.length - 1)];
    ctx.translate(rng.float(S * 0.2, S * 0.8), rng.float(S * 0.3, S * 0.7));
    ctx.rotate(rng.float(-0.2, 0.2));
    ctx.beginPath();
    ctx.moveTo(-S * 0.2, 0);
    ctx.quadraticCurveTo(0, -S * 0.13, S * 0.2, 0);
    ctx.quadraticCurveTo(0, S * 0.1, -S * 0.2, 0);
    ctx.fill();
    ctx.restore();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.45 });
}

export class Shopfronts {
  constructor(rng, { breakables, seed = 20250726 }) {
    this.rng = rng;
    this.breakables = breakables;
    const art = new Rng(seed ^ 0x5f5e10d);
    this.M = {
      sign: signAtlas(art),
      glass: shopGlassAtlas(art),
      awning: awningAtlas(art),
      shutter: shutterTexture(art),
      pier: getMaterial('stone', { base: '#b9ae9a', mortar: '#9b9083', scale: 1.1 }),
      metal: getMaterial('paintedMetal', { seed: 1601, color: '#2c3a30' }),
      wood: getMaterial('wood', { seed: 1602, color: '#4a3524' }),
    };
    label(this.M);
    this.batches = new Batches();
    this.jobs = [];
    this.count = 0;
  }

  add(plot) {
    this.jobs.push(plot);
  }

  finish(group, collision) {
    const rng = this.rng;
    const B = (m) => this.batches.get(m);
    for (const plot of this.jobs) {
      const { x, z, w, d, rot, storeys, shabby } = plot;
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
      const cellI = rng.int(0, 3);
      const gu = (cellI % 2) * 0.5, gv = 1 - (Math.floor(cellI / 2) + 1) * 0.5;
      B(this.M.glass).quad(
        px + ax * (openW / 2) + ox * 0.1, riser, pz + az * (openW / 2) + oz * 0.1,
        -ax * openW, 0, -az * openW,
        0, openH - riser, 0,
        0.5, 0.5, gu, gv,
      );

      /* roller shutter on the shabby ones */
      if (shabby && rng.chance(0.55)) {
        B(this.M.shutter).quad(
          px + ax * (openW / 2) + ox * 0.16, 0.05, pz + az * (openW / 2) + oz * 0.16,
          -ax * openW, 0, -az * openW,
          0, openH - 0.05, 0,
          openW / 1.6, openH / 1.6,
        );
      }

      /* fascia sign */
      const si = (plot.signIndex + this.count) % SIGN_CELLS;
      const su = (si % SIGN_COLS) / SIGN_COLS;
      const sv = 1 - (Math.floor(si / SIGN_COLS) + 1) / SIGN_ROWS;
      const fascH = Math.min(0.72, parter.h - openH - 0.5);
      if (fascH > 0.24) {
        B(this.M.sign).quad(
          px + ax * (w * 0.46) + ox * 0.38, openH + 0.86, pz + az * (w * 0.46) + oz * 0.38,
          -ax * w * 0.92, 0, -az * w * 0.92,
          0, fascH, 0,
          1 / SIGN_COLS, 1 / SIGN_ROWS, su, sv,
        );
      }

      /* awning over about a third of them */
      if (rng.chance(0.36)) {
        const ai = rng.int(0, 3);
        const au = (ai % 2) * 0.5, av = 1 - (Math.floor(ai / 2) + 1) * 0.5;
        const reach = rng.float(1.1, 1.7);
        B(this.M.awning).quad(
          px - ax * (openW / 2) + ox * 0.34, openH + 0.8, pz - az * (openW / 2) + oz * 0.34,
          ax * openW, 0, az * openW,
          ox * reach, -0.62, oz * reach,
          0.5, 0.5, au, av,
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
        const bi = rng.int(0, SIGN_CELLS - 1);
        const bu = (bi % SIGN_COLS) / SIGN_COLS;
        const bv = 1 - (Math.floor(bi / SIGN_COLS) + 1) / SIGN_ROWS;
        const bc = Math.cos(brot), bs = Math.sin(brot);
        for (const lean of [-1, 1]) {
          B(this.M.sign).quad(
            bx + bc * 0.28 - bs * lean * 0.06, 0.06, bz - bs * 0.28 - bc * lean * 0.06,
            -bc * 0.56, 0, bs * 0.56,
            -bs * lean * 0.24, 0.82, -bc * lean * 0.24,
            1 / SIGN_COLS, 1 / SIGN_ROWS, bu, bv,
          );
        }
        const boards = [collision.add(bx, bz, 0.7, 0.55, 0, 0.9, 'prop', 'wood')];
        this.breakables.add({
          colliders: boards, chunks: 4, threshold: 18, mass: 8, surface: 'wood',
          seed: 0x4a11 ^ Math.round(bx * 31 + bz * 17), label: 'a-board',
        });
      }

      /* the frame is solid, and the glass is what the player will shoot */
      collision.add(px + ox * 0.3, pz + oz * 0.3,
        Math.abs(ax) * w + Math.abs(ox) * 0.7, Math.abs(az) * w + Math.abs(oz) * 0.7,
        0, openH + 0.85, 'window', 'glass');

      this.count++;
    }
    const meshes = this.batches.finish(group, { castShadow: true, receiveShadow: true });
    return { meshes, shops: this.count };
  }
}
