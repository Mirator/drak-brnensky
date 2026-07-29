import * as THREE from 'three';
import { makeCanvas, makeTexture } from '../textures.js';
import { Rng } from '../rng.js';
import { GLOW_UV, PALE_UV, BONE_UV, clamp01, lerp } from './kit.js';

/* ==================================================================
   Creature skin sheets.

   Every archetype gets ONE sheet: albedo + a height field that becomes a
   normal and a roughness map, plus a tiny emissive mask. Parts claim
   sub-rects of the sheet (see region() in kit.js) instead of tiling it, so
   the whole creature — scales, mortar, glowing core and all — renders from
   a single material in a single draw call. The ember patch in the top-right
   corner of every sheet is where all glowing details point (GLOW_UV), which
   is why one emissiveIntensity per instance can pulse an eye, a throat sac
   or a golem's core without a second material.
   ================================================================== */

const ALBEDO = 512;
const RELIEF = 256;
const MASK = 128;

const _ca = new THREE.Color();
const _cb = new THREE.Color();

function mix(a, b, t) {
  _ca.set(a);
  _cb.set(b);
  _ca.lerp(_cb, clamp01(t));
  return `#${_ca.getHexString()}`;
}

/** Albedo colour or the matching height grey, chosen by draw mode. */
function tone(mode, colour, height) {
  if (mode !== 'height') return colour;
  const v = Math.max(0, Math.min(255, Math.round(height)));
  return `rgb(${v},${v},${v})`;
}

/* ------------------------------------------------------------------ */
/* height field → normal + roughness                                   */
/* ------------------------------------------------------------------ */
function reliefMaps(heightCanvas, { strength = 2.4, roughBase = 0.72, roughVar = 0.3 } = {}) {
  const small = makeCanvas(RELIEF, RELIEF);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.drawImage(heightCanvas, 0, 0, RELIEF, RELIEF);
  const src = sctx.getImageData(0, 0, RELIEF, RELIEF).data;
  const H = new Float32Array(RELIEF * RELIEF);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    H[p] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  }
  const at = (x, y) => {
    const xi = ((x % RELIEF) + RELIEF) % RELIEF;
    const yi = ((y % RELIEF) + RELIEF) % RELIEF;
    return H[yi * RELIEF + xi];
  };

  const normal = makeCanvas(RELIEF, RELIEF);
  const rough = makeCanvas(RELIEF, RELIEF);
  const nctx = normal.getContext('2d');
  const rctx = rough.getContext('2d');
  const nimg = nctx.createImageData(RELIEF, RELIEF);
  const rimg = rctx.createImageData(RELIEF, RELIEF);
  for (let y = 0; y < RELIEF; y++) {
    for (let x = 0; x < RELIEF; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1))
        - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -gx * strength;
      let ny = -gy * strength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const p = (y * RELIEF + x) * 4;
      nimg.data[p] = Math.round((nx * 0.5 + 0.5) * 255);
      nimg.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      nimg.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      nimg.data[p + 3] = 255;
      // recesses read rougher, raised scale crowns a touch glossier
      const h = at(x, y);
      const r = Math.round(clamp01(roughBase + (1 - h) * roughVar) * 255);
      rimg.data[p] = r; rimg.data[p + 1] = r; rimg.data[p + 2] = r; rimg.data[p + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return { normal, rough };
}

/* ------------------------------------------------------------------ */
/* pattern painters — each called twice, once per draw mode             */
/* ------------------------------------------------------------------ */

/**
 * Overlapping plates: the shared basis for lizard scales, gargoyle
 * stone-flesh and crocodilian scutes. `cell` is the plate size in pixels at
 * ALBEDO resolution, `round` how arc-like each plate is.
 */
function paintPlates(ctx, S, rng, mode, o) {
  const cell = o.cell * (S / ALBEDO);
  const rows = Math.ceil(S / (cell * 0.72)) + 1;
  const cols = Math.ceil(S / cell) + 1;
  ctx.fillStyle = tone(mode, o.mortar, o.mortarH);
  ctx.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    const y = r * cell * 0.72;
    const stagger = (r % 2) * cell * 0.5;
    // dorsal banding: a couple of darker rows every few plates
    const band = 0.5 + 0.5 * Math.sin(r * o.bandFreq);
    for (let c = 0; c < cols; c++) {
      const x = c * cell + stagger + rng.float(-cell * o.jitter, cell * o.jitter);
      const w = cell * rng.float(0.86, 1.12);
      const h = cell * rng.float(0.72, 0.96);
      const t = clamp01(rng.float(0, 1) * 0.7 + band * o.bandWeight);
      ctx.fillStyle = tone(mode, mix(o.light, o.dark, t), lerp(232, 168, t));
      ctx.beginPath();
      if (o.round > 0.5) {
        ctx.ellipse(x, y, w * 0.54, h * 0.6, 0, 0, Math.PI * 2);
      } else {
        // irregular quad — reads as a hard keratin scute
        const k = cell * 0.18;
        ctx.moveTo(x - w * 0.5 + rng.float(-k, k), y - h * 0.5 + rng.float(-k, k));
        ctx.lineTo(x + w * 0.5 + rng.float(-k, k), y - h * 0.45 + rng.float(-k, k));
        ctx.lineTo(x + w * 0.48 + rng.float(-k, k), y + h * 0.5 + rng.float(-k, k));
        ctx.lineTo(x - w * 0.52 + rng.float(-k, k), y + h * 0.46 + rng.float(-k, k));
        ctx.closePath();
      }
      ctx.fill();
      // crown highlight — the bit that catches the sun on a scale
      if (o.crown > 0) {
        ctx.globalAlpha = o.crown;
        ctx.fillStyle = tone(mode, o.light, 250);
        ctx.beginPath();
        ctx.ellipse(x - w * 0.08, y - h * 0.16, w * 0.28, h * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
}

/** Ashlar masonry with recessed mortar — the golem's sandstone. */
function paintMasonry(ctx, S, rng, mode, o) {
  const bh = o.course * (S / ALBEDO);
  ctx.fillStyle = tone(mode, o.mortar, 60);
  ctx.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += bh) {
    const row = Math.round(y / bh);
    let x = (row % 2) * bh * 0.9;
    while (x < S) {
      const w = bh * rng.float(1.3, 2.4);
      const t = rng.float(0, 1);
      const inset = bh * 0.09;
      ctx.fillStyle = tone(mode, mix(o.light, o.dark, t), lerp(238, 186, t));
      ctx.fillRect(x + inset, y + inset, w - inset * 2, bh - inset * 2);
      // chipped corner
      if (rng.chance(0.18)) {
        const cw = bh * rng.float(0.14, 0.3);
        ctx.fillStyle = tone(mode, mix(o.dark, o.mortar, 0.5), 120);
        ctx.fillRect(x + inset, y + inset, cw, cw);
      }
      x += w;
    }
  }
  // weathering streaks
  for (let i = 0; i < 26; i++) {
    const x = rng.float(0, S);
    ctx.globalAlpha = rng.float(0.05, 0.16);
    ctx.fillStyle = tone(mode, o.streak, 150);
    ctx.fillRect(x, 0, rng.float(2, 9) * (S / ALBEDO), S);
    ctx.globalAlpha = 1;
  }
}

/** Leathery wing membrane: radiating veins, thin worn patches, torn edges. */
function paintMembrane(ctx, S, rng, mode, o) {
  ctx.fillStyle = tone(mode, o.base, 150);
  ctx.fillRect(0, 0, S, S);
  // blotchy translucency
  for (let i = 0; i < 90; i++) {
    const x = rng.float(0, S);
    const y = rng.float(0, S);
    const r = rng.float(S * 0.03, S * 0.16);
    ctx.globalAlpha = rng.float(0.05, 0.2);
    ctx.fillStyle = tone(mode, rng.chance(0.5) ? o.light : o.dark, rng.chance(0.5) ? 172 : 132);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // veins fanning from one corner, branching twice
  const drawVein = (x, y, ang, len, w, depth) => {
    ctx.strokeStyle = tone(mode, mix(o.vein, o.base, depth * 0.3), 210 - depth * 18);
    ctx.lineWidth = w * (S / ALBEDO);
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x;
    let cy = y;
    let a = ang;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      a += rng.float(-0.22, 0.22);
      cx += Math.cos(a) * (len / steps);
      cy += Math.sin(a) * (len / steps);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    if (depth < 2 && len > S * 0.1) {
      drawVein(cx, cy, a + rng.float(0.35, 0.8), len * 0.55, w * 0.6, depth + 1);
      drawVein(cx, cy, a - rng.float(0.35, 0.8), len * 0.5, w * 0.6, depth + 1);
    }
  };
  for (let i = 0; i < 7; i++) {
    drawVein(-S * 0.05, S * 0.5 + rng.float(-S * 0.4, S * 0.4), rng.float(-0.5, 0.5), S * 0.5, 3.2, 0);
  }
}

/** UV rect → canvas rect (three flips textures vertically by default). */
function swatchRect(uv, S) {
  return {
    x: uv[0] * S,
    y: (1 - uv[3]) * S,
    w: (uv[2] - uv[0]) * S,
    h: (uv[3] - uv[1]) * S,
  };
}

/** Ember patch every glowing detail's UVs point at. */
function paintGlow(ctx, S, mode, o) {
  const { x, y, w, h } = swatchRect(GLOW_UV, S);
  if (mode === 'height') {
    ctx.fillStyle = 'rgb(150,150,150)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    return;
  }
  const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w * 0.62);
  g.addColorStop(0, o.hot);
  g.addColorStop(0.45, o.mid);
  g.addColorStop(1, o.cool);
  ctx.fillStyle = o.cool;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Flat swatches: pale belly hide and bone (teeth, claws, horns). */
function paintSwatches(ctx, S, rng, mode, o) {
  for (const [uv, colour, height, speck] of [
    [PALE_UV, o.pale || '#b8b49a', 210, o.paleSpeck || '#8e8a72'],
    [BONE_UV, o.bone || '#d9cfb4', 226, '#b3a689'],
  ]) {
    const { x, y, w, h } = swatchRect(uv, S);
    ctx.fillStyle = tone(mode, colour, height);
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = rng.float(0.06, 0.22);
      ctx.fillStyle = tone(mode, speck, height - 26);
      const r = rng.float(1, 3.4) * (S / ALBEDO);
      ctx.beginPath();
      ctx.arc(x + rng.float(0, w), y + rng.float(0, h), r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

const PAINTERS = { plates: paintPlates, masonry: paintMasonry, membrane: paintMembrane };

/* ------------------------------------------------------------------ */
/* sheet assembly                                                      */
/* ------------------------------------------------------------------ */
/**
 * @param {object} spec
 * @param {number} spec.seed      deterministic — no Math.random anywhere
 * @param {string} spec.pattern   'plates' | 'masonry' | 'membrane'
 * @param {object} spec.palette   painter-specific colours
 * @param {object} spec.glow      { hot, mid, cool } ember patch colours
 * @returns {{map, normalMap, roughnessMap, emissiveMap}} three textures
 */
const sheetCache = new Map();

export function skinSheet(spec) {
  const key = spec.key || `${spec.pattern}:${spec.seed}`;
  const cached = sheetCache.get(key);
  if (cached) return cached;
  const sheet = buildSheet(spec);
  sheetCache.set(key, sheet);
  return sheet;
}

function buildSheet(spec) {
  const paint = PAINTERS[spec.pattern];
  const albedo = makeCanvas(ALBEDO, ALBEDO);
  const height = makeCanvas(ALBEDO, ALBEDO);
  const glow = spec.glow || { hot: '#fff0c0', mid: '#ff7a24', cool: '#2a0c04' };

  for (const [canvas, mode] of [[albedo, 'albedo'], [height, 'height']]) {
    const ctx = canvas.getContext('2d');
    const rng = new Rng(spec.seed);
    paint(ctx, ALBEDO, rng, mode, spec.palette);
    if (spec.overlay) spec.overlay(ctx, ALBEDO, rng, mode, tone);
    paintSwatches(ctx, ALBEDO, rng, mode, spec.palette);
    paintGlow(ctx, ALBEDO, mode, glow);
  }

  const { normal, rough } = reliefMaps(height, spec.relief);

  // emissive mask: black everywhere but the ember patch, so one
  // emissiveIntensity per instance drives every glowing detail
  const mask = makeCanvas(MASK, MASK);
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#000000';
  mctx.fillRect(0, 0, MASK, MASK);
  paintGlow(mctx, MASK, 'albedo', { hot: '#ffffff', mid: glow.mid, cool: '#140400' });

  return {
    map: makeTexture(albedo, 1, 1, true, 8),
    normalMap: makeTexture(normal, 1, 1, false, 8),
    roughnessMap: makeTexture(rough, 1, 1, false, 8),
    emissiveMap: makeTexture(mask, 1, 1, true, 4),
  };
}

/** Shared leathery wing membrane — the Chrlič and the dragon tint the same
 * sheet rather than generating it twice. */
export function membraneSheet() {
  return skinSheet({
    key: 'membrane:shared',
    seed: 0x3a1f,
    pattern: 'membrane',
    palette: {
      base: '#4a2a24', dark: '#2a1512', light: '#7a4a38', vein: '#1c0c0a',
      pale: '#8a6a58', paleSpeck: '#5a3a30', bone: '#cdbfa2',
    },
    glow: { hot: '#ffd9a0', mid: '#c04a14', cool: '#1c0602' },
    relief: { strength: 1.8, roughBase: 0.86, roughVar: 0.12 },
  });
}

/**
 * Standard creature material from a sheet. Flat shading is deliberately off
 * for organic archetypes (the lathe/loft surfaces are already faceted enough
 * and smooth normals let the normal map do the talking) and on for masonry.
 */
export function creatureStandard(sheet, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0xffffff,
    map: sheet.map,
    normalMap: sheet.normalMap,
    roughnessMap: sheet.roughnessMap,
    emissiveMap: sheet.emissiveMap,
    emissive: new THREE.Color(opts.emissive ?? 0xff6a24),
    emissiveIntensity: opts.emissiveIntensity ?? 2.2,
    roughness: opts.roughness ?? 1,
    metalness: opts.metalness ?? 0.04,
    flatShading: opts.flatShading ?? false,
    side: opts.side ?? THREE.FrontSide,
  });
  if (mat.normalMap) mat.normalScale.set(opts.normalScale ?? 1, opts.normalScale ?? 1);
  return mat;
}
