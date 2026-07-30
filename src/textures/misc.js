import * as THREE from 'three';
import { Rng } from '../rng.js';
import { canvas, dual, pick, grain, shade, tierSize } from './core.js';
import { heightToNormal, aoFromHeight, noiseGray, packORM, solidGray } from './pbr.js';
import { makeFbm, makeWorley } from './noise.js';

function build(seed, size, draw, { roughBase = 0.6, roughVar = 0.15, metal = 0, normalStrength = 1, aoStrength = 1.2, envMapIntensity = 0.8, sampler } = {}) {
  const S = size;
  const { color, height } = dual(seed, S, S, draw);
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace;
  const normal = heightToNormal(height, normalStrength);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.anisotropy = 8; nmap.colorSpace = THREE.NoColorSpace;
  const ao = aoFromHeight(height, { strength: aoStrength });
  const rough = noiseGray(S, S, sampler || (() => 0.5), { base: roughBase, variation: roughVar });
  const orm = packORM(S, S, { ao, rough, metal });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping; ormMap.anisotropy = 8; ormMap.colorSpace = THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({
    map, normalMap: nmap, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: ormMap, metalnessMap: ormMap, aoMap: ormMap,
    roughness: 1, metalness: 1, envMapIntensity,
  });
}

/* ------------------------------------------------------------------ */
/* tram rail steel                                                      */
/* ------------------------------------------------------------------ */
export function makeTramRailMaterial({ seed = 71, size = tierSize(256) } = {}) {
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#4b4b4d', 140);
    ctx.fillRect(0, 0, size, size);
    // polished running band down the middle (wheel-worn, shinier + brighter)
    ctx.fillStyle = pick(mode, '#9a9a9c', 190);
    ctx.fillRect(size * 0.3, 0, size * 0.4, size);
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = pick(mode, 'rgba(0,0,0,0.06)', 150);
      ctx.fillRect(0, rng.float(0, size), size, rng.float(0.5, 1.5));
    }
    grain(ctx, size, size, mode === 'albedo' ? 10 : 5, rng);
  };
  return build(seed, size, draw, { roughBase: 0.35, roughVar: 0.25, metal: 0.95, normalStrength: 0.6, envMapIntensity: 1.2 });
}

/* ------------------------------------------------------------------ */
/* painted metal — lamp posts, bollards, benches                       */
/* ------------------------------------------------------------------ */
export function makePaintedMetalMaterial({ seed = 72, size = tierSize(256), color = '#1f3a2a' } = {}) {
  const rngNoise = new Rng(seed);
  const chip = makeWorley(rngNoise, 10);
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, color, 150);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 30; i++) {
      const x = rng.float(0, size), y = rng.float(0, size);
      if (chip(x / size * 10, y / size * 10).f1 > 0.18) continue;
      const r = rng.float(2, 6);
      ctx.fillStyle = pick(mode, 'rgba(120,110,95,0.6)', 95); // rust/chip through to bare metal
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    grain(ctx, size, size, mode === 'albedo' ? 10 : 5, rng);
  };
  return build(seed, size, draw, { roughBase: 0.45, roughVar: 0.2, metal: 0.3, normalStrength: 0.9, envMapIntensity: 0.7 });
}

/* ------------------------------------------------------------------ */
/* weathered wood                                                       */
/* ------------------------------------------------------------------ */
export function makeWoodMaterial({ seed = 73, size = tierSize(256), color = '#5a4230' } = {}) {
  const rngNoise = new Rng(seed);
  const grainField = makeFbm(rngNoise, { cells: 2, octaves: 4, gain: 0.6 });
  const draw = (ctx, rng, mode) => {
    for (let x = 0; x < size; x++) {
      const n = grainField(x / size * 10, 0.5);
      if (mode === 'albedo') ctx.fillStyle = shade(color, (n - 0.5) * 30);
      else ctx.fillStyle = pick(mode, undefined, 140 + (n - 0.5) * 60);
      ctx.fillRect(x, 0, 1, size);
    }
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = pick(mode, 'rgba(0,0,0,0.2)', 110);
      ctx.lineWidth = 1;
      ctx.beginPath();
      let y = rng.float(0, size);
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += size / 8) { y += rng.float(-6, 6); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    grain(ctx, size, size, mode === 'albedo' ? 12 : 6, rng);
  };
  return build(seed, size, draw, { roughBase: 0.75, roughVar: 0.15, metal: 0, normalStrength: 1.1, envMapIntensity: 0.5, sampler: grainField });
}

/* ------------------------------------------------------------------ */
/* DPMB tram livery — red/white                                        */
/* ------------------------------------------------------------------ */
export function makeTramLiveryMaterial({ seed = 74, size = tierSize(512) } = {}) {
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#e6e6e2', 170);
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = pick(mode, '#a8342e', 150);
    ctx.fillRect(0, size * 0.62, size, size * 0.3);
    ctx.fillStyle = pick(mode, '#2c2c2e', 100);
    ctx.fillRect(0, size * 0.6, size, size * 0.02);
    ctx.fillRect(0, size * 0.93, size, size * 0.02);
    grain(ctx, size, size, mode === 'albedo' ? 8 : 4, rng);
  };
  // Flat painted livery panels — no bare-metal chip/wear mask like
  // makePaintedMetalMaterial has, so the whole surface is intact paint.
  // A dielectric coating (near-zero metalness) is correct; 0.6 previously
  // made every tram body three-fifths metallic with no basis for it.
  return build(seed, size, draw, { roughBase: 0.35, roughVar: 0.1, metal: 0.04, normalStrength: 0.5, envMapIntensity: 0.9 });
}

/* ------------------------------------------------------------------ */
/* bare concrete                                                        */
/* ------------------------------------------------------------------ */
export function makeConcreteMaterial({ seed = 75, size = tierSize(512) } = {}) {
  const rngNoise = new Rng(seed);
  const field = makeFbm(rngNoise, { cells: 6, octaves: 4 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#8b8a84', 140);
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 3) {
      for (let x = 0; x < size; x += 3) {
        const n = field(x / size * 6, y / size * 6);
        if (mode === 'albedo') ctx.fillStyle = shade('#8b8a84', (n - 0.5) * 10);
        else ctx.fillStyle = pick(mode, undefined, 140 + (n - 0.5) * 30);
        ctx.fillRect(x, y, 3, 3);
      }
    }
    // formwork seams
    for (let x = 0; x < size; x += size / 4) {
      ctx.fillStyle = pick(mode, 'rgba(0,0,0,0.12)', 120);
      ctx.fillRect(x, 0, 2, size);
    }
    grain(ctx, size, size, mode === 'albedo' ? 14 : 7, rng);
  };
  return build(seed, size, draw, { roughBase: 0.88, roughVar: 0.1, metal: 0, normalStrength: 0.8, envMapIntensity: 0.4, sampler: field });
}

/* ------------------------------------------------------------------ */
/* plaster with graffiti (tag over an existing facade-like plaster base) */
/* ------------------------------------------------------------------ */
export function makeGraffitiPlasterMaterial({ seed = 76, size = tierSize(256), plaster = '#c9a878' } = {}) {
  const rngNoise = new Rng(seed);
  const colors = ['#d43b3b', '#3b6dd4', '#e0b23c', '#3bd48f'];
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, plaster, 128);
    ctx.fillRect(0, 0, size, size);
    for (let s = 0; s < 3; s++) {
      const cx = rng.float(size * 0.2, size * 0.8), cy = rng.float(size * 0.3, size * 0.7);
      const col = colors[Math.floor(rngNoise.float(0, colors.length))];
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rng.float(-0.15, 0.15));
      ctx.fillStyle = pick(mode, col, 150);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.moveTo(-size * 0.18, 0);
      ctx.quadraticCurveTo(0, -size * 0.12, size * 0.18, 0);
      ctx.quadraticCurveTo(0, size * 0.1, -size * 0.18, 0);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    grain(ctx, size, size, mode === 'albedo' ? 14 : 6, rng);
  };
  return build(seed, size, draw, { roughBase: 0.85, roughVar: 0.15, metal: 0, normalStrength: 1.0, envMapIntensity: 0.5 });
}

/* ------------------------------------------------------------------ */
/* bronze / verdigris statuary, gilded detail                          */
/* ------------------------------------------------------------------ */
export function makeBronzeMaterial({ seed = 77, size = tierSize(256), verdigris = true } = {}) {
  const rngNoise = new Rng(seed);
  const patina = makeFbm(rngNoise, { cells: 4, octaves: 3 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#4a3623', 140);
    ctx.fillRect(0, 0, size, size);
    if (verdigris) {
      for (let y = 0; y < size; y += 2) {
        for (let x = 0; x < size; x += 2) {
          const n = patina(x / size * 4, y / size * 4);
          if (n > 0.55) {
            ctx.fillStyle = mode === 'albedo' ? `hsl(160,${rng.float(25, 40)}%,${rng.float(30, 45)}%)` : `rgb(${140 - (n - 0.55) * 100},${140 - (n - 0.55) * 100},${140 - (n - 0.55) * 100})`;
            ctx.fillRect(x, y, 2, 2);
          }
        }
      }
    }
    grain(ctx, size, size, mode === 'albedo' ? 10 : 5, rng);
  };
  return build(seed, size, draw, { roughBase: 0.45, roughVar: 0.25, metal: 0.85, normalStrength: 1.0, envMapIntensity: 1.0, sampler: patina });
}

export function makeGildedMaterial({ seed = 78, size = tierSize(256) } = {}) {
  const rngNoise = new Rng(seed);
  const wear = makeFbm(rngNoise, { cells: 5, octaves: 2 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#d9a828', 170);
    ctx.fillRect(0, 0, size, size);
    grain(ctx, size, size, mode === 'albedo' ? 6 : 3, rng);
  };
  return build(seed, size, draw, { roughBase: 0.22, roughVar: 0.18, metal: 0.95, normalStrength: 0.5, envMapIntensity: 1.3, sampler: wear });
}

/* ------------------------------------------------------------------ */
/* glass with per-pane roughness variation                             */
/* ------------------------------------------------------------------ */
/** Kept signature-compatible: no args, same look-and-feel as before, but a
 * touch of real relief/AO so panes don't read as a flat colour swatch. */
export function glassMaterial() {
  const size = tierSize(64);
  const ao = solidGray(size, size, 0.95);
  const rough = noiseGray(size, size, () => 0.5, { base: 0.12, variation: 0.06 });
  const orm = packORM(size, size, { ao, rough, metal: 0.85 });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.colorSpace = THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({
    color: 0x223344,
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    roughness: 1,
    metalness: 1,
    emissive: 0x0a1420,
    emissiveIntensity: 1,
    envMapIntensity: 1.1,
  });
}

/** Per-pane glass: a grid of panes each with independently jittered
 * roughness/tint, for shopfronts and large curtain-wall windows viewed up
 * close (landmarks, hero facades). */
export function makePaneGlassMaterial({ seed = 79, size = tierSize(256), panesX = 3, panesY = 4, envMapIntensity = 1.2 } = {}) {
  const rng = new Rng(seed);
  const draw = (ctx, rng2, mode) => {
    ctx.fillStyle = pick(mode, '#0f141a', 60);
    ctx.fillRect(0, 0, size, size);
    const pw = size / panesX, ph = size / panesY;
    for (let py = 0; py < panesY; py++) {
      for (let px = 0; px < panesX; px++) {
        const tint = rng2.float(-14, 14);
        if (mode === 'albedo') {
          const g = ctx.createLinearGradient(px * pw, py * ph, px * pw, (py + 1) * ph);
          g.addColorStop(0, shade('#2b3742', tint));
          g.addColorStop(1, shade('#111820', tint));
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = pick(mode, undefined, 60 + tint);
        }
        ctx.fillRect(px * pw + 1, py * ph + 1, pw - 2, ph - 2);
      }
    }
    ctx.strokeStyle = pick(mode, '#8a8a86', 190);
    ctx.lineWidth = Math.max(1, size * 0.012);
    for (let px = 0; px <= panesX; px++) { ctx.beginPath(); ctx.moveTo(px * pw, 0); ctx.lineTo(px * pw, size); ctx.stroke(); }
    for (let py = 0; py <= panesY; py++) { ctx.beginPath(); ctx.moveTo(0, py * ph); ctx.lineTo(size, py * ph); ctx.stroke(); }
  };
  const roughSampler = () => 0.5;
  const mat = build(seed, size, draw, { roughBase: 0.14, roughVar: 0.12, metal: 0.7, normalStrength: 0.4, envMapIntensity, sampler: roughSampler });
  mat.emissive = new THREE.Color(0x0a1420);
  mat.emissiveIntensity = 0.3;
  return mat;
}

/* ------------------------------------------------------------------ */
/* decal library — alpha-mapped, polygonOffset set up against z-fighting */
/* ------------------------------------------------------------------ */
function decalCanvas(size, draw) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  draw(ctx);
  return c;
}

function decalMaterial(size, draw, { color = 0xffffff } = {}) {
  const c = decalCanvas(size, draw);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    map,
    color,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    roughness: 0.9,
    metalness: 0,
  });
}

export function makeScorchDecal({ seed = 81, size = tierSize(256) } = {}) {
  const rng = new Rng(seed);
  return decalMaterial(size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(10,8,8,0.9)');
    g.addColorStop(0.5, 'rgba(20,14,10,0.55)');
    g.addColorStop(1, 'rgba(20,14,10,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${rng.float(0.2, 0.5)})`;
      ctx.lineWidth = rng.float(2, 6);
      ctx.beginPath();
      const a = rng.float(0, Math.PI * 2);
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(a) * size * 0.45, size / 2 + Math.sin(a) * size * 0.45);
      ctx.stroke();
    }
  });
}

export function makeImpactDecal({ seed = 82, size = tierSize(256) } = {}) {
  const rng = new Rng(seed);
  return decalMaterial(size, (ctx) => {
    ctx.fillStyle = 'rgba(20,18,16,0.8)';
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size * 0.14, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + rng.float(-0.2, 0.2);
      const len = rng.float(size * 0.15, size * 0.4);
      ctx.strokeStyle = `rgba(20,18,16,${rng.float(0.3, 0.6)})`;
      ctx.lineWidth = rng.float(1, 4);
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(a) * size * 0.12, size / 2 + Math.sin(a) * size * 0.12);
      ctx.lineTo(size / 2 + Math.cos(a) * len, size / 2 + Math.sin(a) * len);
      ctx.stroke();
    }
  });
}

export function makeCrackDecal({ seed = 83, size = tierSize(256) } = {}) {
  const rng = new Rng(seed);
  return decalMaterial(size, (ctx) => {
    ctx.strokeStyle = 'rgba(10,10,10,0.85)';
    ctx.lineWidth = rng.float(2, 4);
    let x = size * 0.1, y = rng.float(size * 0.3, size * 0.5);
    ctx.beginPath(); ctx.moveTo(x, y);
    while (x < size * 0.9) { x += rng.float(10, 26); y += rng.float(-14, 14); ctx.lineTo(x, y); }
    ctx.stroke();
  });
}

export function makeStainDecal({ seed = 84, size = tierSize(256) } = {}) {
  const rng = new Rng(seed);
  return decalMaterial(size, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, size);
    g.addColorStop(0, 'rgba(30,26,20,0.55)');
    g.addColorStop(1, 'rgba(30,26,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(size * 0.2, 0, size * 0.6, size);
  });
}

export function makeScuffDecal({ seed = 85, size = tierSize(256) } = {}) {
  const rng = new Rng(seed);
  return decalMaterial(size, (ctx) => {
    for (let i = 0; i < 20; i++) {
      ctx.strokeStyle = `rgba(40,38,34,${rng.float(0.1, 0.3)})`;
      ctx.lineWidth = rng.float(1, 3);
      const y = rng.float(size * 0.3, size * 0.7);
      ctx.beginPath();
      ctx.moveTo(rng.float(0, size * 0.3), y + rng.float(-10, 10));
      ctx.lineTo(rng.float(size * 0.6, size), y + rng.float(-10, 10));
      ctx.stroke();
    }
  });
}
