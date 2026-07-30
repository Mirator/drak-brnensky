import * as THREE from 'three';
import { Rng } from '../rng.js';
import { canvas, dual, pick, grain, shade, tierSize } from './core.js';
import { heightToNormal, aoFromHeight, noiseGray, packORM } from './pbr.js';
import { makeFbm, makeWorley } from './noise.js';
import { drawSign, CZECH_SIGNS } from './signage.js';

/* ------------------------------------------------------------------ */
/* facades — one tile == one window bay (BAY_W x FLOOR_H metres)        */
/* ------------------------------------------------------------------ */
// Bay module this generator's window geometry is designed against (see the
// 'plain' window fractions below). Central-European historicist bay
// spacing runs 2.6-3.6 m, most commonly ~3.0; typical upper-floor height
// runs 3.0-3.4 m (docs/brno-reference.md, "Addendum: townhouse
// proportions") -- 3.1 / 3.4 sits inside both ranges. Any caller sizing a
// bay mesh in world space must use *these* metres per tile, not a locally
// guessed module, or the window will drift off its portrait ratio again.
export const BAY_W = 3.1;
export const FLOOR_H = 3.4;

/* Brno old-town plaster palette — must stay exactly 6 entries: city.js
 * picks a style with a hardcoded `rng.int(0, 5)` so the array length is
 * load-bearing, not just its contents. */
export const FACADE_STYLES = [
  { plaster: '#c9915a', trim: '#ecdcc0', name: 'ochre' },
  { plaster: '#d8cdb4', trim: '#f5efe0', name: 'cream' },
  { plaster: '#9aa593', trim: '#dbe0d4', name: 'grey-green' },
  { plaster: '#b3644a', trim: '#e6d0bd', name: 'terracotta' },
  { plaster: '#c9a0a3', trim: '#f0dcdc', name: 'dusty-pink' },
  { plaster: '#b99248', trim: '#eddfb8', name: 'mustard' },
];

const H_WALL = 128;
const H_RECESS = 46;
const H_ARCHITRAVE = 195;
const H_SILL = 205;
const H_PILASTER = 160;
const H_CORNICE = 210;
const H_CRACK = 96;

/**
 * Paints one facade bay (albedo/height/emissive). `kind` selects the bay
 * archetype: 'plain' (existing look, upgraded), 'shopfront' (ground floor
 * commercial + signage), 'pianoNobile' (tall window, pediment, balcony),
 * 'attic' (dormer / low band). Height canvas is co-drawn with the albedo
 * so a normal map and cavity AO can be derived from real relief rather
 * than painted-on shading.
 *
 * `size` is the base canvas resolution (still run through `tierSize()`, so
 * `setResolutionTier()` keeps scaling it down further on low quality tiers
 * on top of whatever base a caller picks here). Defaults to 128, not 256 --
 * measured on the live boot path, 18 facade-bay materials at 256 cost
 * ~2.1 s of city-generation time (~115 ms each: two dual() passes plus
 * heightToNormal's Sobel filter plus aoFromHeight's two blur/upsample
 * passes, all O(w*h) full-canvas walks). Facade bays are seen at a
 * distance across most of a frame and the relief comes from the derived
 * normal/AO maps, not raw texel count, so 128 reads as very close to
 * indistinguishable from 256 in play for the ~4x cost cut. Pass
 * `size: 256` (or higher) explicitly for a hero/close-inspection facade
 * where it's worth paying for.
 */
export function paintFacadeBay(style, { seed = 7, kind = 'plain', signText = null, size = 128 } = {}) {
  const S = tierSize(size);
  const rngNoise = new Rng(seed * 13 + 1);
  const mottle = makeFbm(rngNoise, { cells: 3, octaves: 3, gain: 0.55 });
  const cracks = makeWorley(rngNoise, 4);

  const { plaster, trim } = style;

  const draw = (ctx, rng, mode) => {
    const f = (albedo, hgray) => pick(mode, albedo, hgray);

    // plaster base with within-wall colour/height mottling
    if (mode === 'albedo') {
      for (let y = 0; y < S; y += 4) {
        for (let x = 0; x < S; x += 4) {
          const m = mottle(x / S, y / S);
          ctx.fillStyle = shade(plaster, (m - 0.5) * 14);
          ctx.fillRect(x, y, 4, 4);
        }
      }
    } else {
      ctx.fillStyle = `rgb(${H_WALL},${H_WALL},${H_WALL})`;
      ctx.fillRect(0, 0, S, S);
    }

    // rustication on ground-floor commercial bay
    if (kind === 'shopfront') {
      const bandH = 14;
      for (let y = 0; y < S; y += bandH) {
        ctx.fillStyle = f(mode === 'albedo' ? 'rgba(0,0,0,0.10)' : undefined, H_WALL - 10);
        ctx.fillRect(0, y, S, 3);
      }
    }

    // pilasters at both edges
    ctx.fillStyle = f(trim, H_PILASTER);
    ctx.globalAlpha = mode === 'albedo' ? 0.85 : 1;
    ctx.fillRect(0, 0, S * 0.06, S);
    ctx.fillRect(S - S * 0.06, 0, S * 0.06, S);
    ctx.globalAlpha = 1;

    // floor separation line / cornice shadow (bottom of tile)
    ctx.fillStyle = f(trim, H_CORNICE);
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, S - S * 0.04, S, S * 0.03);
    ctx.globalAlpha = mode === 'albedo' ? 0.22 : 1;
    ctx.fillStyle = f('rgba(0,0,0,1)', H_WALL - 30);
    ctx.fillRect(0, S - S * 0.07, S, S * 0.02);
    ctx.globalAlpha = 1;

    // string course under cornice
    ctx.fillStyle = f(trim, H_CORNICE - 10);
    ctx.fillRect(0, S * 0.02, S, S * 0.02);

    // window geometry, shaped by bay kind. The 'plain' base fractions
    // (ww=0.40, wh=0.62) are sized against BAY_W x FLOOR_H = 3.1 x 3.4 m:
    // 0.40*3.1 = 1.24 m wide, 0.62*3.4 = 2.11 m tall, a 1:1.70 portrait
    // window -- inside the 1.1-1.4 m x 1.8-2.4 m opening docs/brno-
    // reference.md specifies, and matching its "never square" note (the
    // previous 0.53 x 0.60 fractions gave a near-square 1:1.13 window on
    // every plain upper floor, the majority of every facade). Centred
    // horizontally (wx = (1 - ww) / 2) as before.
    let wx = S * 0.30, wy = S * 0.17, ww = S * 0.40, wh = S * 0.62;
    if (kind === 'shopfront') { wx = S * 0.10; wy = S * 0.34; ww = S * 0.8; wh = S * 0.46; }
    if (kind === 'pianoNobile') { wy = S * 0.10; wh = S * 0.72; }
    if (kind === 'attic') { wx = S * 0.30; wy = S * 0.30; ww = S * 0.4; wh = S * 0.42; }

    // architrave / surround
    ctx.fillStyle = f(trim, H_ARCHITRAVE);
    ctx.fillRect(wx - S * 0.055, wy - S * 0.055, ww + S * 0.11, wh + S * 0.11);
    ctx.fillStyle = f('rgba(0,0,0,0.25)', H_ARCHITRAVE - 30);
    ctx.fillRect(wx - S * 0.055, wy - S * 0.055, ww + S * 0.11, S * 0.03);

    // pediment on the piano nobile bay
    if (kind === 'pianoNobile') {
      ctx.beginPath();
      ctx.moveTo(wx - S * 0.07, wy - S * 0.06);
      ctx.lineTo(wx + ww / 2, wy - S * 0.16);
      ctx.lineTo(wx + ww + S * 0.07, wy - S * 0.06);
      ctx.closePath();
      ctx.fillStyle = f(trim, H_ARCHITRAVE);
      ctx.fill();
    }

    // glass
    if (mode === 'albedo') {
      const g = ctx.createLinearGradient(wx, wy, wx + ww, wy + wh);
      g.addColorStop(0, '#2b3742');
      g.addColorStop(0.45, '#161d25');
      g.addColorStop(0.5, '#3d4c5a');
      g.addColorStop(1, '#0f141a');
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = `rgb(${H_RECESS},${H_RECESS},${H_RECESS})`;
    }
    ctx.fillRect(wx, wy, ww, wh);

    // mullions
    ctx.strokeStyle = f(trim, H_ARCHITRAVE);
    ctx.lineWidth = S * 0.03;
    ctx.beginPath();
    ctx.moveTo(wx + ww / 2, wy);
    ctx.lineTo(wx + ww / 2, wy + wh);
    if (kind !== 'shopfront') {
      ctx.moveTo(wx, wy + wh * 0.42);
      ctx.lineTo(wx + ww, wy + wh * 0.42);
    }
    ctx.stroke();
    ctx.strokeRect(wx, wy, ww, wh);

    // sill
    ctx.fillStyle = f(trim, H_SILL);
    ctx.fillRect(wx - S * 0.08, wy + wh + S * 0.02, ww + S * 0.16, S * 0.045);

    // small balcony on the piano nobile bay
    if (kind === 'pianoNobile') {
      ctx.fillStyle = f('#4a4c4e', H_SILL - 10);
      ctx.fillRect(wx - S * 0.1, wy + wh + S * 0.06, ww + S * 0.2, S * 0.02);
      ctx.lineWidth = S * 0.012;
      ctx.strokeStyle = f('#3a3c3e', H_SILL - 20);
      for (let i = 0; i <= 6; i++) {
        const bx = wx - S * 0.08 + (ww + S * 0.16) * (i / 6);
        ctx.beginPath();
        ctx.moveTo(bx, wy + wh + S * 0.06);
        ctx.lineTo(bx, wy + wh + S * 0.12);
        ctx.stroke();
      }
    }

    // shopfront awning + sign band + glazing bar
    if (kind === 'shopfront') {
      ctx.fillStyle = f('#7a2f28', H_ARCHITRAVE + 5);
      ctx.fillRect(wx - S * 0.1, wy - S * 0.18, ww + S * 0.2, S * 0.07);
      if (mode === 'albedo') {
        ctx.fillStyle = '#5c221d';
        for (let i = 0; i < 8; i++) ctx.fillRect(wx - S * 0.1 + (ww + S * 0.2) * i / 8, wy - S * 0.18, (ww + S * 0.2) / 16, S * 0.07);
      }
      if (mode === 'albedo' && signText) drawSign(ctx, signText, wx - S * 0.1, wy - S * 0.18, ww + S * 0.2, S * 0.07);
    }

    // attic dormer band
    if (kind === 'attic') {
      ctx.fillStyle = f(trim, H_CORNICE);
      ctx.fillRect(0, 0, S, S * 0.06);
    }

    // weathering: staining running down from the sill / cornice
    if (mode === 'albedo') {
      ctx.globalAlpha = 0.16;
      const stain = ctx.createLinearGradient(0, wy + wh, 0, S);
      stain.addColorStop(0, 'rgba(30,26,20,0.9)');
      stain.addColorStop(1, 'rgba(30,26,20,0)');
      ctx.fillStyle = stain;
      ctx.fillRect(wx - S * 0.06, wy + wh, ww + S * 0.12, S - (wy + wh));
      ctx.globalAlpha = 1;
    } else {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = `rgb(${H_WALL - 14},${H_WALL - 14},${H_WALL - 14})`;
      ctx.fillRect(wx - S * 0.06, wy + wh, ww + S * 0.12, (S - (wy + wh)) * 0.6);
      ctx.globalAlpha = 1;
    }

    // patchy plaster repairs + hairline cracks (worley-seeded)
    for (let i = 0; i < 5; i++) {
      const px = rng.float(0, S), py = rng.float(0, S);
      const pr = rng.float(8, 22) * (S / 256);
      if (rng.chance(0.5)) {
        ctx.beginPath();
        ctx.ellipse(px, py, pr, pr * rng.float(0.5, 0.9), rng.float(0, Math.PI), 0, Math.PI * 2);
        ctx.fillStyle = f(shade(plaster, rng.float(6, 16)), H_WALL + 10);
        ctx.globalAlpha = 0.5;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = f('rgba(0,0,0,0.3)', H_CRACK);
    for (let i = 0; i < 3; i++) {
      if (cracks(rng.float(0, 1), rng.float(0, 1)).f1 > 0.4) continue;
      let cx = rng.float(S * 0.1, S * 0.9), cy = rng.float(S * 0.1, S * 0.9);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let s = 0; s < 4; s++) {
        cx += rng.float(-14, 14) * (S / 256);
        cy += rng.float(6, 16) * (S / 256);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    grain(ctx, S, S, mode === 'albedo' ? 14 : 6, rng);
  };

  const { color, height } = dual(seed, S, S, draw);

  // emissive: lit-window mask, varied by a per-style warm/cool tone and a
  // faint curtain silhouette so the signature dusk glow reads as inhabited
  // rather than uniformly identical windows.
  const e = canvas(S, S);
  const ectx = e.getContext('2d');
  ectx.fillStyle = '#000';
  ectx.fillRect(0, 0, S, S);
  // must stay pixel-identical to the window geometry in draw() above, or
  // the emissive glow mask drifts off the actual glass.
  let wx = S * 0.30, wy = S * 0.17, ww = S * 0.40, wh = S * 0.62;
  if (kind === 'shopfront') { wx = S * 0.10; wy = S * 0.34; ww = S * 0.8; wh = S * 0.46; }
  if (kind === 'pianoNobile') { wy = S * 0.10; wh = S * 0.72; }
  if (kind === 'attic') { wx = S * 0.30; wy = S * 0.30; ww = S * 0.4; wh = S * 0.42; }
  const cold = rngNoise.chance(0.18);
  const eg = ectx.createLinearGradient(wx, wy, wx, wy + wh);
  if (cold) {
    eg.addColorStop(0, '#bfe0ff');
    eg.addColorStop(1, '#6f9dc9');
  } else {
    eg.addColorStop(0, '#ffd79a');
    eg.addColorStop(1, '#c98a3c');
  }
  ectx.fillStyle = eg;
  ectx.fillRect(wx + S * 0.015, wy + S * 0.015, ww - S * 0.03, wh - S * 0.03);
  // curtain silhouette
  if (rngNoise.chance(0.4)) {
    ectx.fillStyle = 'rgba(0,0,0,0.4)';
    ectx.fillRect(wx + S * 0.015, wy + wh * 0.55, ww - S * 0.03, wh * 0.42);
  }
  ectx.strokeStyle = '#000';
  ectx.lineWidth = S * 0.016;
  ectx.beginPath();
  ectx.moveTo(wx + ww / 2, wy);
  ectx.lineTo(wx + ww / 2, wy + wh);
  if (kind !== 'shopfront') {
    ectx.moveTo(wx, wy + wh * 0.42);
    ectx.lineTo(wx + ww, wy + wh * 0.42);
  }
  ectx.stroke();

  const normal = heightToNormal(height, 1.6);
  const ao = aoFromHeight(height, { strength: 1.3 });
  const rough = noiseGray(S, S, mottle, { base: 0.82, variation: 0.22 });
  const orm = packORM(S, S, { ao, rough, metal: 0.02 });

  return { map: color, emissive: e, normal, orm };
}

/** Wrap a paintFacadeBay() result into a ready MeshStandardMaterial, with
 * consistent colour spaces / anisotropy / wrapping. Shared by
 * makeFacadeMaterials() (existing per-style whole-building tile) and
 * materials.js's `facade` registry entry (per-style, per-bay-kind). */
export function facadeBayMaterial({ map, emissive, normal, orm }) {
  const m = new THREE.CanvasTexture(map);
  m.wrapS = m.wrapT = THREE.RepeatWrapping;
  m.anisotropy = 8;
  m.colorSpace = THREE.SRGBColorSpace;
  const em = new THREE.CanvasTexture(emissive);
  em.wrapS = em.wrapT = THREE.RepeatWrapping;
  em.anisotropy = 8;
  em.colorSpace = THREE.SRGBColorSpace;
  const nm = new THREE.CanvasTexture(normal);
  nm.wrapS = nm.wrapT = THREE.RepeatWrapping;
  nm.anisotropy = 8;
  nm.colorSpace = THREE.NoColorSpace;
  const ormT = new THREE.CanvasTexture(orm);
  ormT.wrapS = ormT.wrapT = THREE.RepeatWrapping;
  ormT.anisotropy = 8;
  ormT.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: m,
    emissiveMap: em,
    emissive: new THREE.Color(0xffb45a),
    emissiveIntensity: 0.85,
    normalMap: nm,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: ormT,
    metalnessMap: ormT,
    aoMap: ormT,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.6,
  });
  mat.userData.tiled = true;
  return mat;
}

export function makeFacadeMaterials() {
  return FACADE_STYLES.map((s, i) => facadeBayMaterial(paintFacadeBay(s, { seed: 11 + i * 7, kind: 'plain' })));
}

export { CZECH_SIGNS };
