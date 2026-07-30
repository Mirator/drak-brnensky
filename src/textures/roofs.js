import * as THREE from 'three';
import { Rng } from '../rng.js';
import { dual, pick, grain, tierSize } from './core.js';
import { heightToNormal, aoFromHeight, noiseGray, packORM } from './pbr.js';
import { makeFbm } from './noise.js';

const H_BASE = 90;
const H_TILE = 150;
const H_RIDGE = 210;
const H_MOSS = 70;
const H_SLIP = 40;

function paintPantiles(seed = 99) {
  const S = tierSize(256);
  const rngNoise = new Rng(seed + 3);
  const mossField = makeFbm(rngNoise, { cells: 5, octaves: 2 });

  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = mode === 'albedo' ? '#4a3b38' : `rgb(${H_BASE},${H_BASE},${H_BASE})`;
    ctx.fillRect(0, 0, S, S);
    const s = S / 8;
    for (let y = 0; y < S; y += s * 0.72) {
      for (let x = -s * 0.4; x < S; x += s) {
        const off = (Math.round(y / (s * 0.72))) % 2 ? s / 2 : 0;
        const row = y / S, col = (x + off) / S;
        const slipped = rng.chance(0.03);
        const moss = mossField(col, row) > 0.62;
        let hgt = H_TILE + (slipped ? -H_SLIP : 0) + (moss ? -8 : 0);
        // Draw every rng.float() unconditionally (even in 'height' mode)
        // so the albedo and height passes consume the RNG in lockstep —
        // otherwise later tiles' `slipped`/`moss` decisions would diverge
        // between the two canvases (see dual() in core.js).
        const hue = rng.float(8, 20), sat = rng.float(18, 34), light = rng.float(20, 34) + (slipped ? 10 : 0);
        const mossHue = rng.float(78, 100), mossSat = rng.float(20, 34), mossLight = rng.float(18, 26);
        if (mode === 'albedo') {
          ctx.fillStyle = moss ? `hsl(${mossHue},${mossSat}%,${mossLight}%)` : `hsl(${hue},${sat}%,${light}%)`;
        } else {
          ctx.fillStyle = pick(mode, undefined, hgt);
        }
        ctx.beginPath();
        ctx.roundRect(x + off - (slipped ? s * 0.06 : 0), y - (slipped ? s * 0.05 : 0), s * 0.95, s * 0.75, s * 0.15);
        ctx.fill();
        if (mode === 'albedo') {
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = Math.max(1, S / 128);
          ctx.stroke();
        }
      }
    }
    // ridge line along the top
    ctx.fillStyle = pick(mode, 'rgba(20,16,14,0.5)', H_RIDGE);
    ctx.fillRect(0, 0, S, S * 0.05);
    // chimney soot stain
    ctx.globalAlpha = mode === 'albedo' ? 0.22 : 0.3;
    const stain = ctx.createLinearGradient(S * 0.55, 0, S * 0.75, S);
    stain.addColorStop(0, mode === 'albedo' ? 'rgba(10,8,8,0.8)' : `rgb(${H_BASE - 20},${H_BASE - 20},${H_BASE - 20})`);
    stain.addColorStop(1, 'rgba(10,8,8,0)');
    ctx.fillStyle = stain;
    ctx.fillRect(S * 0.5, 0, S * 0.3, S * 0.6);
    ctx.globalAlpha = 1;

    grain(ctx, S, S, mode === 'albedo' ? 22 : 8, rng);
  };

  return dual(seed, S, S, draw);
}

export function makeRoofMaterial() {
  const { color, height } = paintPantiles(99);
  const S = color.width;
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;

  const normal = heightToNormal(height, 1.8);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping;
  nmap.anisotropy = 8;
  nmap.colorSpace = THREE.NoColorSpace;

  const ao = aoFromHeight(height, { strength: 1.5 });
  const rough = noiseGray(S, S, makeFbm(new Rng(101), { cells: 4 }), { base: 0.88, variation: 0.14 });
  const orm = packORM(S, S, { ao, rough, metal: 0 });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping;
  ormMap.anisotropy = 8;
  ormMap.colorSpace = THREE.NoColorSpace;

  return new THREE.MeshStandardMaterial({
    map,
    normalMap: nmap,
    normalScale: new THREE.Vector2(1, 1),
    roughnessMap: ormMap,
    metalnessMap: ormMap,
    aoMap: ormMap,
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.5,
  });
}

/** Slate / weathered-copper roof for landmarks (Petrov, Špilberk turrets). */
export function makeSlateCopperMaterial(seed = 202, { copper = true } = {}) {
  const S = tierSize(256);
  const rngNoise = new Rng(seed);
  const patina = makeFbm(rngNoise, { cells: 4, octaves: 3 });

  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = mode === 'albedo' ? '#2c3236' : `rgb(${H_BASE + 20},${H_BASE + 20},${H_BASE + 20})`;
    ctx.fillRect(0, 0, S, S);
    const rows = 10, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? rh * 0.5 : 0;
      for (let x = -rh; x < S; x += rh * 1.6) {
        const patinaAmt = copper ? patina((x + off) / S, r / rows) : 0;
        const slateSat = rng.float(4, 10), slateLight = rng.float(20, 30); // drawn unconditionally: keep rng in lockstep across modes
        if (mode === 'albedo') {
          ctx.fillStyle = copper
            ? `hsl(${170 + patinaAmt * 25},${30 + patinaAmt * 20}%,${38 + patinaAmt * 18}%)`
            : `hsl(210,${slateSat}%,${slateLight}%)`;
        } else {
          ctx.fillStyle = pick(mode, undefined, H_TILE + patinaAmt * 40 - 20);
        }
        ctx.beginPath();
        ctx.roundRect(x + off, r * rh, rh * 1.5, rh * 0.92, rh * 0.1);
        ctx.fill();
        if (mode === 'albedo') { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }
    grain(ctx, S, S, mode === 'albedo' ? 14 : 6, rng);
  };

  const { color, height } = dual(seed, S, S, draw);
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace;
  const normal = heightToNormal(height, 1.4);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.anisotropy = 8; nmap.colorSpace = THREE.NoColorSpace;
  const ao = aoFromHeight(height, { strength: 1.2 });
  const rough = noiseGray(S, S, patina, { base: copper ? 0.5 : 0.35, variation: 0.2 });
  // Slate is stone, a dielectric — it must read near-zero metalness. Copper
  // gets a lower-than-bare-metal value too, since the weathered patina
  // (copper carbonate, itself a dielectric oxide) covers most of the
  // visible surface. These two were previously swapped (slate at 0.75,
  // copper at 0.6), which made every slate landmark roof (Petrov, Špilberk)
  // render as three-quarters metallic — losing nearly all diffuse response
  // off the direct specular highlight.
  const orm = packORM(S, S, { ao, rough, metal: copper ? 0.6 : 0.04 });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping; ormMap.anisotropy = 8; ormMap.colorSpace = THREE.NoColorSpace;

  return new THREE.MeshStandardMaterial({
    map, normalMap: nmap, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: ormMap, metalnessMap: ormMap, aoMap: ormMap,
    roughness: 1, metalness: 1, envMapIntensity: 0.8,
  });
}

/** Standing-seam metal roof — trams sheds, kiosks, modern infill. */
export function makeMetalSeamRoofMaterial(seed = 303) {
  const S = tierSize(256);
  const rngNoise = new Rng(seed + 5);
  const weather = makeFbm(rngNoise, { cells: 4, octaves: 2 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = mode === 'albedo' ? '#7c8388' : `rgb(${H_TILE},${H_TILE},${H_TILE})`;
    ctx.fillRect(0, 0, S, S);
    const seamW = S / 8;
    for (let x = 0; x < S; x += seamW) {
      ctx.fillStyle = pick(mode, 'rgba(0,0,0,0.18)', H_TILE - 30);
      ctx.fillRect(x, 0, S * 0.06, S);
      ctx.fillStyle = pick(mode, 'rgba(255,255,255,0.08)', H_TILE + 20);
      ctx.fillRect(x + S * 0.06, 0, S * 0.02, S);
    }
    grain(ctx, S, S, mode === 'albedo' ? 10 : 5, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace;
  const normal = heightToNormal(height, 2.2);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.anisotropy = 8; nmap.colorSpace = THREE.NoColorSpace;
  const ao = aoFromHeight(height, { strength: 1.1 });
  const orm = packORM(S, S, { ao, rough: noiseGray(S, S, weather, { base: 0.4, variation: 0.1 }), metal: 0.85 });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping; ormMap.anisotropy = 8; ormMap.colorSpace = THREE.NoColorSpace;
  return new THREE.MeshStandardMaterial({
    map, normalMap: nmap, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: ormMap, metalnessMap: ormMap, aoMap: ormMap,
    roughness: 1, metalness: 1, envMapIntensity: 1,
  });
}
