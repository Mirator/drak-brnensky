import { canvas, linearTex } from './core.js';

/**
 * Height-field → PBR map conversion. This is the core trick that makes flat
 * canvas art read as real relief once `scene.environment` is lighting it:
 * every generator paints a greyscale "height" canvas (0 = deepest recess,
 * 255 = highest relief) alongside its albedo, using the exact same drawing
 * calls (see `dual()` in core.js), then this module turns that height
 * canvas into a tangent-space normal map and a cheap cavity AO map.
 */

/** Sobel-filtered height → tangent-space normal map. Wraps at the edges so
 * the result tiles seamlessly. `strength` scales the apparent bump depth. */
export function heightToNormal(heightCanvas, strength = 1.5) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0, p = 0; i < src.length; i += 4, p++) {
    H[p] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  }
  const at = (x, y) => {
    const xi = ((x % w) + w) % w;
    const yi = ((y % h) + h) % h;
    return H[yi * w + xi];
  };

  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -gx * strength;
      let ny = -gy * strength;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const p = (y * w + x) * 4;
      img.data[p] = Math.round((nx * 0.5 + 0.5) * 255);
      img.data[p + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      img.data[p + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[p + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Cheap multi-scale cavity AO from a height field: blur the height map and
 * darken pixels that sit below their local neighbourhood (cracks, grout
 * lines, window reveals, mortar joints). Two downsample/upsample passes
 * keep this O(w*h) instead of a real per-pixel horizon search. */
export function aoFromHeight(heightCanvas, { strength = 1.4, blur = 0.12, blur2 = 0.035 } = {}) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const heightData = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;

  const blurred = (fraction) => {
    const sw = Math.max(4, Math.round(w * fraction));
    const sh = Math.max(4, Math.round(h * fraction));
    const small = canvas(sw, sh);
    const sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(heightCanvas, 0, 0, sw, sh);
    const big = canvas(w, h);
    const bctx = big.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    bctx.drawImage(small, 0, 0, w, h);
    return bctx.getImageData(0, 0, w, h).data;
  };

  const b1 = blurred(blur);
  const b2 = blurred(blur2);

  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  for (let i = 0; i < heightData.length; i += 4) {
    const hgt = (heightData[i] + heightData[i + 1] + heightData[i + 2]) / (3 * 255);
    const local = (b1[i] + b1[i + 1] + b1[i + 2]) / (3 * 255);
    const wide = (b2[i] + b2[i + 1] + b2[i + 2]) / (3 * 255);
    const cavity = Math.max(0, local - hgt) * 0.7 + Math.max(0, wide - hgt) * 0.3;
    const ao = Math.max(0, Math.min(1, 1 - cavity * strength * 3));
    const v = Math.round(ao * 255);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** A flat grey canvas — convenience for constant roughness/metalness inputs
 * to packORM without special-casing "no map" everywhere. */
export function solidGray(w, h, value01) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const v = Math.max(0, Math.min(255, Math.round(value01 * 255)));
  ctx.fillStyle = `rgb(${v},${v},${v})`;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/** Noisy roughness canvas: base value plus per-pixel variation driven by a
 * tileable noise sampler (see noise.js), so worn/weathered patches read as
 * rougher or glossier rather than a uniform plastic sheen. */
export function noiseGray(w, h, sampler, { base = 0.6, variation = 0.25, freq = 1 } = {}) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = sampler((x / w) * freq, (y / h) * freq);
      const v = Math.max(0, Math.min(255, Math.round((base + (n - 0.5) * variation) * 255)));
      const p = (y * w + x) * 4;
      img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v; img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Pack ambient-occlusion / roughness / metalness into one RGB canvas —
 * three.js reads aoMap from R, roughnessMap from G, metalnessMap from B
 * (the glTF ORM convention), so one texture serves all three slots and
 * saves 2 of every 3 texture uploads. `ao`/`rough` may be a canvas (same
 * size as w,h) or omitted (defaults to fully lit / mid-rough); `metal` may
 * be a canvas or a constant 0..1 number.
 */
export function packORM(w, h, { ao = null, rough = null, metal = 0 } = {}) {
  const out = canvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const aoData = ao ? ao.getContext('2d').getImageData(0, 0, w, h).data : null;
  const roughData = rough ? rough.getContext('2d').getImageData(0, 0, w, h).data : null;
  const metalData = metal && metal.getContext ? metal.getContext('2d').getImageData(0, 0, w, h).data : null;
  const metalConst = typeof metal === 'number' ? Math.max(0, Math.min(255, Math.round(metal * 255))) : 0;
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = aoData ? aoData[i] : 255;
    img.data[i + 1] = roughData ? roughData[i] : 200;
    img.data[i + 2] = metalData ? metalData[i] : metalConst;
    img.data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Assign a packed ORM canvas + normal canvas to a MeshStandardMaterial with
 * the correct linear colour space and sane defaults. Albedo/emissive maps
 * are NOT touched here — assign those yourself with `tex()` (sRGB).
 */
export function applyReliefMaps(mat, { normal, orm, normalStrength = 1, aoIntensity = 1, repeatX = 1, repeatY = 1, aniso = 8 } = {}) {
  if (normal) {
    mat.normalMap = linearTex(normal, repeatX, repeatY, aniso);
    mat.normalScale.set(normalStrength, normalStrength);
  }
  if (orm) {
    const t = linearTex(orm, repeatX, repeatY, aniso);
    mat.roughnessMap = t;
    mat.metalnessMap = t;
    mat.aoMap = t;
    mat.aoMapIntensity = aoIntensity;
  }
  return mat;
}
