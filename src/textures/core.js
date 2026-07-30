import * as THREE from 'three';
import { Rng } from '../rng.js';

/* ------------------------------------------------------------------ */
/* resolution tiers — lets the performance engineer halve every        */
/* generated texture on low quality settings without touching any      */
/* generator. All base sizes below are powers of two; tierSize keeps   */
/* the scaled result a power of two too, so mipmapping stays cheap.     */
/* ------------------------------------------------------------------ */
let RES_TIER = 1;

export function setResolutionTier(t) {
  RES_TIER = Math.max(0.25, Math.min(1, t));
}

export function getResolutionTier() {
  return RES_TIER;
}

export function tierSize(base) {
  const scaled = Math.max(32, base * RES_TIER);
  return Math.pow(2, Math.round(Math.log2(scaled)));
}

/* ------------------------------------------------------------------ */
/* canvas helpers                                                      */
/* ------------------------------------------------------------------ */
export function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Draw the same procedure twice with the same seed, once producing a
 * colour (albedo) canvas and once a greyscale height/relief canvas — the
 * two stay in perfect registration because they consume the RNG in
 * identical order. `draw(ctx, rng, mode)` should call `pick()` (see below)
 * for every fill so it emits the right kind of style per mode. */
export function dual(seed, w, h, draw) {
  const color = canvas(w, h);
  const height = canvas(w, h);
  draw(color.getContext('2d'), new Rng(seed), 'albedo');
  draw(height.getContext('2d'), new Rng(seed), 'height');
  return { color, height };
}

/** Helper for use inside a `dual()` draw callback: returns the albedo
 * colour string in 'albedo' mode, or an `rgb(v,v,v)` grey string (v in
 * 0..255) in 'height' mode. 0 = deepest recess, 255 = highest relief. */
export function pick(mode, albedoStyle, heightGray) {
  if (mode === 'height') {
    const v = Math.max(0, Math.min(255, Math.round(heightGray)));
    return `rgb(${v},${v},${v})`;
  }
  return albedoStyle;
}

export function grain(ctx, w, h, amount, rng) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng.next() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 1;
}

export function shade(hex, amt) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt / 100)));
  return `#${c.getHexString()}`;
}

/* ------------------------------------------------------------------ */
/* texture wrapping — colour-space-correct, anisotropic, tileable       */
/* ------------------------------------------------------------------ */

/** Albedo / emissive texture: sRGB, repeat-wrapped, anisotropic. */
export function tex(c, repeatX = 1, repeatY = 1, srgb = true, aniso = 8) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = aniso;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Data texture (normal / roughness / metalness / AO / packed ORM) — must
 * never be treated as sRGB or lighting goes flat and washed out. */
export function linearTex(c, repeatX = 1, repeatY = 1, aniso = 8) {
  return tex(c, repeatX, repeatY, false, aniso);
}
