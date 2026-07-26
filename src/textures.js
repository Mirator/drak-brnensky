import * as THREE from 'three';
import { Rng } from './rng.js';

/* ------------------------------------------------------------------ */
/* canvas helpers                                                      */
/* ------------------------------------------------------------------ */
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function grain(ctx, w, h, amount = 14, alpha = 0.5) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 1;
}

function tex(c, repeatX = 1, repeatY = 1, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ------------------------------------------------------------------ */
/* facades — one tile == one window bay (BAY_W x FLOOR_H metres)        */
/* ------------------------------------------------------------------ */
export const BAY_W = 3.4;
export const FLOOR_H = 3.6;

/**
 * Builds a tileable facade bay: plaster wall + framed window.
 * Returns { map, emissive } canvases (emissive = lit window mask).
 */
function facadeBay(plaster, trim, opts = {}) {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = new Rng(opts.seed || 7);

  // plaster
  ctx.fillStyle = plaster;
  ctx.fillRect(0, 0, S, S);
  // subtle horizontal plaster streaks
  for (let i = 0; i < 40; i++) {
    ctx.globalAlpha = rng.float(0.02, 0.06);
    ctx.fillStyle = rng.chance(0.5) ? '#000' : '#fff';
    ctx.fillRect(0, rng.float(0, S), S, rng.float(0.5, 2.2));
  }
  ctx.globalAlpha = 1;

  // floor separation line (bottom of tile)
  ctx.fillStyle = trim;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(0, S - 5, S, 4);
  ctx.globalAlpha = 0.18;
  ctx.fillRect(0, S - 9, S, 3);
  ctx.globalAlpha = 1;

  // window opening
  const wx = 30, wy = 22, ww = 68, wh = 76;
  // surround / architrave
  ctx.fillStyle = trim;
  ctx.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(wx - 7, wy - 7, ww + 14, 4);
  // glass
  const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
  g.addColorStop(0, '#2b3742');
  g.addColorStop(0.45, '#161d25');
  g.addColorStop(0.5, '#3d4c5a');
  g.addColorStop(1, '#0f141a');
  ctx.fillStyle = g;
  ctx.fillRect(wx, wy, ww, wh);
  // mullions
  ctx.strokeStyle = trim;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(wx + ww / 2, wy);
  ctx.lineTo(wx + ww / 2, wy + wh);
  ctx.moveTo(wx, wy + wh * 0.42);
  ctx.lineTo(wx + ww, wy + wh * 0.42);
  ctx.stroke();
  ctx.strokeRect(wx, wy, ww, wh);
  // sill
  ctx.fillStyle = trim;
  ctx.fillRect(wx - 10, wy + wh + 5, ww + 20, 6);

  grain(ctx, S, S, 16);

  // emissive: which windows glow at dusk (random per building via uv offset)
  const e = canvas(S, S);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, S, S);
  const eg = ectx.createLinearGradient(wx, wy, wx, wy + wh);
  eg.addColorStop(0, '#ffd79a');
  eg.addColorStop(1, '#c98a3c');
  ectx.fillStyle = eg;
  ectx.fillRect(wx + 2, wy + 2, ww - 4, wh - 4);
  ectx.strokeStyle = '#000';
  ectx.lineWidth = 4;
  ectx.beginPath();
  ectx.moveTo(wx + ww / 2, wy);
  ectx.lineTo(wx + ww / 2, wy + wh);
  ectx.moveTo(wx, wy + wh * 0.42);
  ectx.lineTo(wx + ww, wy + wh * 0.42);
  ectx.stroke();

  return { map: c, emissive: e };
}

/* Brno old-town plaster palette. */
export const FACADE_STYLES = [
  { plaster: '#c9a878', trim: '#e8dcc6' }, // ochre
  { plaster: '#a8a99c', trim: '#dcdcd2' }, // grey-green
  { plaster: '#b4826a', trim: '#e6d3c0' }, // terracotta
  { plaster: '#d3c3a4', trim: '#f2ebdc' }, // cream
  { plaster: '#8e9aa6', trim: '#cfd8e0' }, // slate blue
  { plaster: '#bb9d5f', trim: '#eee3c3' }, // mustard
];

export function makeFacadeMaterials() {
  return FACADE_STYLES.map((s, i) => {
    const { map, emissive } = facadeBay(s.plaster, s.trim, { seed: 11 + i * 7 });
    const m = tex(map, 1, 1);
    const em = tex(emissive, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      map: m,
      emissiveMap: em,
      emissive: new THREE.Color(0xffb45a),
      emissiveIntensity: 0.85,
      roughness: 0.88,
      metalness: 0.0,
    });
    mat.userData.tiled = true;
    return mat;
  });
}

/* ------------------------------------------------------------------ */
/* roofs                                                               */
/* ------------------------------------------------------------------ */
export function makeRoofMaterial() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a3b38';
  ctx.fillRect(0, 0, S, S);
  const rng = new Rng(99);
  // pantiles
  for (let y = 0; y < S; y += 16) {
    for (let x = -8; x < S; x += 20) {
      const off = (y / 16) % 2 ? 10 : 0;
      ctx.fillStyle = `hsl(${rng.float(8, 20)},${rng.float(18, 34)}%,${rng.float(20, 34)}%)`;
      ctx.beginPath();
      ctx.roundRect(x + off, y, 19, 15, 3);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  grain(ctx, S, S, 22);
  return new THREE.MeshStandardMaterial({
    map: tex(c, 1, 1),
    roughness: 0.95,
    metalness: 0,
  });
}

/* ------------------------------------------------------------------ */
/* stone / gothic materials                                            */
/* ------------------------------------------------------------------ */
export function makeStoneMaterial(base = '#8d8577', mortar = '#6e675c', scale = 1) {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rng = new Rng(4242);
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, S, S);
  const rows = 8;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 ? -14 : 0;
    while (x < S) {
      const w = rng.float(20, 34);
      ctx.fillStyle = shade(base, rng.float(-14, 14));
      ctx.fillRect(x + 1.2, r * rh + 1.2, w - 2.4, rh - 2.4);
      x += w;
    }
  }
  grain(ctx, S, S, 20);
  const t = tex(c, scale, scale);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, metalness: 0.02 });
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt / 100)));
  return `#${c.getHexString()}`;
}

/* ------------------------------------------------------------------ */
/* ground: paving / asphalt / grass tiles                              */
/* ------------------------------------------------------------------ */
export function makeCobbleTexture(size = 512) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const rng = new Rng(1234);
  ctx.fillStyle = '#575047';
  ctx.fillRect(0, 0, size, size);
  const s = 14;
  for (let y = 0; y < size; y += s) {
    for (let x = 0; x < size; x += s) {
      const off = (y / s) % 2 ? s / 2 : 0;
      ctx.fillStyle = `hsl(${rng.float(28, 44)},${rng.float(4, 12)}%,${rng.float(28, 48)}%)`;
      ctx.beginPath();
      ctx.roundRect(x + off + 1, y + 1, s - 2, s - 2, 2.5);
      ctx.fill();
    }
  }
  grain(ctx, size, size, 18);
  return c;
}

/* ------------------------------------------------------------------ */
/* misc simple materials                                               */
/* ------------------------------------------------------------------ */
export function glassMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x223344,
    roughness: 0.12,
    metalness: 0.85,
    emissive: 0x0a1420,
    emissiveIntensity: 1,
  });
}

export function makeGradientSprite(inner = '#ffd08a', outer = 'rgba(255,140,40,0)') {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSmokeTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { canvas as makeCanvas, tex as makeTexture };
