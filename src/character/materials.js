import * as THREE from 'three';
import { makeCanvas, makeTexture } from '../textures.js';

/* ==================================================================
   Character materials.

   The whole body is drawn with ONE material: every colour is baked
   into a vertex-colour attribute and multiplied over a shared fabric
   map, so coat / trousers / boots / skin / leather all live in a
   single draw call.

   A teammate is building a PBR registry in src/materials.js. We must
   not import it before it exists, so the lookup goes through
   `resolve()`, which will pick up either
     - an explicit `materials` object passed to the Player, or
     - `globalThis.__brnoMaterials` (`.character[key]` or `.get(key)`)
   and otherwise falls back to the procedural material below.
   ================================================================== */

/** Costume palette. sRGB hex; baked into vertex colours. */
export const C = {
  coat: 0x4a5b6b,
  coatPanel: 0x3a4856,
  coatDark: 0x2c363f,
  coatLining: 0x6d3b30,
  collar: 0x36424e,
  trousers: 0x3b414a,
  kneePad: 0x2a2e34,
  boot: 0x2a2521,
  bootCuff: 0x3a332c,
  sole: 0x171513,
  harness: 0x6b4c33,
  harnessDark: 0x4a3524,
  buckle: 0x9a8a63,
  glove: 0x413428,
  gloveGrip: 0x2b231b,
  skin: 0xc4906a,
  skinShade: 0xa2734f,
  hair: 0x33261c,
  scarf: 0xb52b28,
  scarfDark: 0x8b1f1e,
  pack: 0x39424c,
  packTrim: 0x232a31,
  metal: 0x373d45,
  metalLight: 0x4c545e,
  metalDark: 0x1e2227,
  rubber: 0x22242a,
  brass: 0x8a7448,
  glow: 0x9cf2ff,
  glowWarm: 0xffd08a,
};

/* ------------------------------------------------------------------ */
/* procedural fabric map + normal map                                  */
/* ------------------------------------------------------------------ */

/**
 * A neutral cloth/leather surface: twill weave, stitched panel seams and
 * grain. Kept close to mid-grey so the vertex colours do the colouring.
 */
function weaveCanvas(rng, S = 256) {
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b9b9b9';
  ctx.fillRect(0, 0, S, S);

  // twill: two families of short diagonal strokes
  ctx.lineWidth = 1;
  for (let i = -S; i < S * 2; i += 3) {
    ctx.strokeStyle = `rgba(255,255,255,${rng.float(0.05, 0.14).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + S, S);
    ctx.stroke();
    ctx.strokeStyle = `rgba(0,0,0,${rng.float(0.05, 0.13).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(i + 1.5, 0);
    ctx.lineTo(i + 1.5 + S, S);
    ctx.stroke();
  }
  // leather-ish blotching
  for (let i = 0; i < 220; i++) {
    const r = rng.float(4, 26);
    ctx.globalAlpha = rng.float(0.02, 0.07);
    ctx.fillStyle = rng.chance(0.5) ? '#000' : '#fff';
    ctx.beginPath();
    ctx.ellipse(rng.float(0, S), rng.float(0, S), r, r * rng.float(0.5, 1.4), rng.float(0, 6.28), 0, 6.28);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // stitch rows — reads as panel seams once wrapped round a limb
  for (let k = 0; k < 5; k++) {
    const y = rng.float(0, S);
    ctx.strokeStyle = 'rgba(0,0,0,0.30)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(0, y + 1.4);
    ctx.lineTo(S, y + 1.4);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  return c;
}

/** Sobel a greyscale canvas into a tangent-space normal map canvas. */
function heightToNormal(src, strength = 2.4) {
  const S = src.width;
  const sctx = src.getContext('2d');
  const h = sctx.getImageData(0, 0, S, S).data;
  const out = makeCanvas(S, S);
  const octx = out.getContext('2d');
  const img = octx.createImageData(S, S);
  const d = img.data;
  const at = (x, y) => h[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * S + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

let _maps = null;
function fabricMaps(rng) {
  if (_maps) return _maps;
  const h = weaveCanvas(rng);
  const map = makeTexture(h, 1, 1);
  const normal = makeTexture(heightToNormal(h), 1, 1, false);
  _maps = { map, normal };
  return _maps;
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

function fromRegistry(key) {
  const reg = globalThis.__brnoMaterials;
  if (!reg) return null;
  try {
    if (reg.character && reg.character[key]) return reg.character[key];
    if (typeof reg.get === 'function') {
      return reg.get(`character.${key}`) || reg.get(key) || null;
    }
  } catch {
    return null;
  }
  return null;
}

function resolve(key, overrides, factory) {
  const given = overrides && overrides[key];
  if (given && given.isMaterial) return given;
  const found = fromRegistry(key);
  if (found && found.isMaterial) return found;
  return factory();
}

/**
 * @param {Rng} rng deterministic source for the generated maps
 * @param {object} [overrides] optional {body, glow, metal, cloth} materials
 */
export function characterMaterials(rng, overrides) {
  const { map, normal } = fabricMaps(rng);

  const body = resolve('body', overrides, () => new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.65, 0.65),
    vertexColors: true,
    roughness: 0.74,
    metalness: 0.08,
  }));

  const cloth = resolve('cloth', overrides, () => new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.5, 0.5),
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    side: THREE.DoubleSide,
  }));

  const metal = resolve('metal', overrides, () => new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    normalScale: new THREE.Vector2(0.3, 0.3),
    vertexColors: true,
    roughness: 0.38,
    metalness: 0.72,
  }));

  const glow = resolve('glow', overrides, () => new THREE.MeshStandardMaterial({
    color: 0xdffbff,
    vertexColors: true,
    emissive: new THREE.Color(0x5fd8ff),
    emissiveIntensity: 2.6,
    roughness: 0.3,
    metalness: 0.1,
  }));

  const bodyGlow = resolve('bodyGlow', overrides, () => new THREE.MeshStandardMaterial({
    color: 0xdffbff,
    vertexColors: true,
    emissive: new THREE.Color(0x5fd8ff),
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.1,
  }));

  return { body, cloth, metal, glow, bodyGlow };
}

/** Test seam: drops the cached maps so a fresh Rng regenerates them. */
export function _resetMaterialCache() {
  _maps = null;
}
