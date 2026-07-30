import * as THREE from 'three';
import { Rng } from '../rng.js';
import { canvas, dual, pick, grain, tierSize } from './core.js';
import { heightToNormal, aoFromHeight, noiseGray, packORM, solidGray } from './pbr.js';
import { makeFbm, makeWorley } from './noise.js';

const H_MORTAR = 70;
const H_SETT = 165;

/* ------------------------------------------------------------------ */
/* granite setts — fan pattern (squares) + running bond (streets)       */
/* ------------------------------------------------------------------ */
function paintCobbles(seed, { size, pattern = 'running', trackGrooves = false } = {}) {
  const S = size;
  const rngNoise = new Rng(seed + 9);
  const speckle = makeFbm(rngNoise, { cells: 6, octaves: 2 });

  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#575047', H_MORTAR);
    ctx.fillRect(0, 0, S, S);

    if (pattern === 'fan') {
      // radiating fan of small setts, several fan centres tiled across the canvas
      const centres = [[S * 0.0, S * 0.0], [S * 1.0, S * 0.0], [S * 0.0, S * 1.0], [S * 1.0, S * 1.0], [S * 0.5, S * 0.5]];
      const rings = 14;
      for (const [cx, cy] of centres) {
        for (let ring = 1; ring <= rings; ring++) {
          const rad = (ring / rings) * S * 0.72;
          const setts = Math.max(6, Math.round(ring * 3.2));
          for (let i = 0; i < setts; i++) {
            const a = (i / setts) * Math.PI * 2 + (ring % 2 ? 0.12 : 0);
            const sx = cx + Math.cos(a) * rad, sy = cy + Math.sin(a) * rad;
            if (sx < -S * 0.05 || sx > S * 1.05 || sy < -S * 0.05 || sy > S * 1.05) continue;
            const sw = S * 0.032, sh = S * 0.026;
            const n = speckle(sx / S, sy / S);
            const hue = rng.float(24, 40), sat = rng.float(3, 9), light = rng.float(30, 50);
            if (mode === 'albedo') {
              ctx.fillStyle = `hsl(${hue},${sat}%,${light + n * 8}%)`;
            } else {
              ctx.fillStyle = pick(mode, undefined, H_SETT + (n - 0.5) * 40);
            }
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(a + Math.PI / 2);
            ctx.beginPath();
            ctx.roundRect(-sw / 2, -sh / 2, sw, sh, sw * 0.2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    } else {
      const s = S / 20;
      for (let y = 0; y < S; y += s) {
        for (let x = 0; x < S; x += s) {
          const off = (Math.round(y / s)) % 2 ? s / 2 : 0;
          const n = speckle((x + off) / S, y / S);
          const hue = rng.float(28, 44), sat = rng.float(4, 12), light = rng.float(28, 48);
          if (mode === 'albedo') {
            ctx.fillStyle = `hsl(${hue},${sat}%,${light + n * 6}%)`;
          } else {
            ctx.fillStyle = pick(mode, undefined, H_SETT + (n - 0.5) * 44);
          }
          ctx.beginPath();
          ctx.roundRect(x + off + 1, y + 1, s - 2, s - 2, 2.5 * (S / 512));
          ctx.fill();
        }
      }
    }

    if (trackGrooves) {
      // worn tram-track grooves: two dark, smoothed channels
      for (const gx of [S * 0.36, S * 0.64]) {
        ctx.globalAlpha = mode === 'albedo' ? 0.35 : 1;
        ctx.fillStyle = pick(mode, 'rgba(20,18,16,0.6)', H_SETT - 70);
        ctx.fillRect(gx - S * 0.02, 0, S * 0.04, S);
        ctx.globalAlpha = 1;
      }
    }

    grain(ctx, S, S, mode === 'albedo' ? 18 : 9, rng);
  };

  // `speckle` already carries the per-sett blotch variation used to paint
  // the setts themselves (same (u,v) domain, 0..1 across the tile) -- reuse
  // it as the roughness sampler too, instead of finishGround()'s flat
  // fallback, so worn/polished setts read as a real reflectance difference
  // rather than a uniform sheen.
  return { ...dual(seed, S, S, draw), sampler: speckle };
}

function finishGround(color, height, { roughBase = 0.85, roughVar = 0.18, metal = 0, normalStrength = 1.4, aoStrength = 1.3, sampler } = {}) {
  const S = color.width;
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 16; map.colorSpace = THREE.SRGBColorSpace;
  const normal = heightToNormal(height, normalStrength);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.anisotropy = 16; nmap.colorSpace = THREE.NoColorSpace;
  const ao = aoFromHeight(height, { strength: aoStrength });
  const rough = noiseGray(S, S, sampler || (() => 0.5), { base: roughBase, variation: roughVar });
  const orm = packORM(S, S, { ao, rough, metal });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping; ormMap.anisotropy = 16; ormMap.colorSpace = THREE.NoColorSpace;
  return { map, normal: nmap, orm: ormMap };
}

/** Backward-compatible export: returns a plain canvas (albedo only), same
 * contract as before — city.js wraps it with makeTexture() itself. Quality
 * of the sett rendering is upgraded internally (real granite colour
 * variation, running-bond layout); full relief (normal/AO) is available
 * to new code via `makeCobbleMaterial()` below. */
export function makeCobbleTexture(size = 512) {
  const { color } = paintCobbles(1234, { size, pattern: 'running' });
  return color;
}

/** Real-world metres spanned by one tile of the running-bond pattern
 * (`cobbleRunning` / `cobbleTramTrack`): the draw loop lays 20 setts across
 * the tile edge (`s = S / 20`) and a real granite sett module (Brno
 * old-town paving) is about 0.10 m, so 20 * 0.10 = 2.0 m per tile. Pass this
 * (or a multiple of it) to `groundRepeat()` in materials.js to size the
 * texture repeat from a real surface footprint instead of guessing. */
export const SETT_TILE_M = 2.0;

/** Real-world metres per tile of the fan-bond pattern (`cobbleFan`): setts
 * there are drawn at `sw = S * 0.032` of the tile edge, so at the same 0.10 m
 * sett module, one tile spans 0.10 / 0.032 ~= 3.1 m. Approximate -- the fan
 * layout isn't a uniform grid like the running bond, so sett size varies
 * slightly by ring. */
export const FAN_SETT_TILE_M = 3.1;

/** Full PBR cobble material for new call sites: real granite-sett relief,
 * fan pattern for squares, running bond for streets, optional worn
 * tram-track grooves. */
export function makeCobbleMaterial({ seed = 1234, pattern = 'running', trackGrooves = false, size = tierSize(1024) } = {}) {
  const { color, height, sampler } = paintCobbles(seed, { size, pattern, trackGrooves });
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.88, roughVar: 0.16, normalStrength: 1.7, aoStrength: 1.5, sampler });
  return new THREE.MeshStandardMaterial({
    map, normalMap: normal, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: orm, metalnessMap: orm, aoMap: orm,
    roughness: 1, metalness: 1, envMapIntensity: 0.5,
  });
}

/* ------------------------------------------------------------------ */
/* asphalt — patched repairs, painted line wear                        */
/* ------------------------------------------------------------------ */
/** Cross-checked from the one fixed-width feature this texture draws: the
 * faded lane/edge line is `S * 0.02` wide, and a standard road-marking line
 * is ~0.12 m wide, so 0.12 / 0.02 = 6.0 m per tile. (The random patch-repair
 * width, 8-20% of tile for a plausible ~1 m real patch, lands in the same
 * 5-12 m range, which is a reasonable cross-check for a non-gridded
 * texture.) */
export const ASPHALT_TILE_M = 6.0;

export function makeAsphaltMaterial({ seed = 55, size = tierSize(512) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed);
  const speckle = makeFbm(rngNoise, { cells: 8, octaves: 3 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#26262a', 110);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < S * S / 40; i++) {
      const x = rng.float(0, S), y = rng.float(0, S), r = rng.float(0.5, 1.6);
      const n = speckle(x / S, y / S);
      ctx.fillStyle = mode === 'albedo' ? `rgba(${180 + n * 40},${180 + n * 40},${180 + n * 40},0.05)` : `rgb(${110 + n * 20},${110 + n * 20},${110 + n * 20})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    // patch repairs
    for (let i = 0; i < 3; i++) {
      const px = rng.float(S * 0.1, S * 0.9), py = rng.float(S * 0.1, S * 0.9);
      const pw = rng.float(S * 0.08, S * 0.2), ph = rng.float(S * 0.06, S * 0.16);
      ctx.fillStyle = pick(mode, '#2f2f34', 118);
      ctx.fillRect(px, py, pw, ph);
      ctx.strokeStyle = pick(mode, 'rgba(0,0,0,0.4)', 100);
      ctx.lineWidth = 2; ctx.strokeRect(px, py, pw, ph);
    }
    // faded painted line
    ctx.globalAlpha = mode === 'albedo' ? 0.5 : 1;
    ctx.fillStyle = pick(mode, '#e8dcb0', 150);
    ctx.fillRect(0, S * 0.48, S, S * 0.02);
    ctx.globalAlpha = 1;
    grain(ctx, S, S, mode === 'albedo' ? 14 : 6, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.92, roughVar: 0.1, normalStrength: 0.8, aoStrength: 1.1, sampler: speckle });
  return new THREE.MeshStandardMaterial({
    map, normalMap: normal, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: orm, metalnessMap: orm, aoMap: orm,
    roughness: 1, metalness: 1, envMapIntensity: 0.4,
  });
}

/* ------------------------------------------------------------------ */
/* kerbstones, tactile paving, drain covers, slabs, gravel, grass       */
/* ------------------------------------------------------------------ */
/** No baked repeat unit exists in this texture (it's continuous
 * stone-surface noise, not a discrete grid) -- 1 tile is documented here as
 * 1 standard kerbstone length (~1.0 m), the natural mapping for a texture
 * meant to be applied once per kerbstone segment. */
export const KERB_TILE_M = 1.0;

export function makeKerbMaterial({ seed = 61, size = tierSize(256) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed + 9);
  const weather = makeFbm(rngNoise, { cells: 5, octaves: 2 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#b7b2a6', 170);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 10; i++) {
      const y = rng.float(0, S);
      ctx.fillStyle = pick(mode, 'rgba(0,0,0,0.08)', 150);
      ctx.fillRect(0, y, S, rng.float(1, 3));
    }
    ctx.fillStyle = pick(mode, 'rgba(0,0,0,0.25)', 60);
    ctx.fillRect(0, 0, S, S * 0.08);
    grain(ctx, S, S, mode === 'albedo' ? 12 : 6, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.75, roughVar: 0.1, normalStrength: 1.2, aoStrength: 1.2, sampler: weather });
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, envMapIntensity: 0.5 });
}

/** 8x8 blister-stud grid (`d = S / 8`) at the ~50 mm centre-to-centre pitch
 * standard tactile paving studs use -> 8 * 0.05 = 0.4 m per tile. */
export const TACTILE_TILE_M = 0.4;

export function makeTactilePavingMaterial({ seed = 62, size = tierSize(256), color: hue = '#a8402f' } = {}) {
  const S = size;
  const rngNoise = new Rng(seed + 9);
  const weather = makeFbm(rngNoise, { cells: 4, octaves: 2 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, hue, 150);
    ctx.fillRect(0, 0, S, S);
    const d = S / 8;
    for (let y = d / 2; y < S; y += d) {
      for (let x = d / 2; x < S; x += d) {
        ctx.fillStyle = pick(mode, 'rgba(0,0,0,0.3)', 210);
        ctx.beginPath(); ctx.arc(x, y, d * 0.28, 0, Math.PI * 2); ctx.fill();
      }
    }
    grain(ctx, S, S, mode === 'albedo' ? 10 : 4, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.7, roughVar: 0.1, normalStrength: 1.6, aoStrength: 1.3, sampler: weather });
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, envMapIntensity: 0.5 });
}

/** This texture draws one complete grate (a fixed 6x6 bar grid across the
 * whole canvas), not a repeating pattern -- it's a single-prop texture
 * meant to map 1:1 onto one physical gully/drain cover, a standard 0.6 m x
 * 0.6 m unit in Central European streetscapes. */
export const DRAIN_TILE_M = 0.6;

export function makeDrainCoverMaterial({ seed = 63, size = tierSize(256) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed + 9);
  const wear = makeFbm(rngNoise, { cells: 4, octaves: 2 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#3a3a3c', 120);
    ctx.fillRect(0, 0, S, S);
    const rows = 6, cols = 6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((r + c) % 2) continue;
        ctx.fillStyle = pick(mode, '#1c1c1e', 60);
        ctx.fillRect((c + 0.15) * S / cols, (r + 0.15) * S / rows, S / cols * 0.7, S / rows * 0.7);
      }
    }
    ctx.strokeStyle = pick(mode, 'rgba(0,0,0,0.5)', 90);
    ctx.lineWidth = S * 0.02;
    ctx.strokeRect(S * 0.02, S * 0.02, S * 0.96, S * 0.96);
    grain(ctx, S, S, mode === 'albedo' ? 10 : 5, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.5, roughVar: 0.15, metal: 0.85, normalStrength: 1.8, aoStrength: 1.6, sampler: wear });
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, envMapIntensity: 1 });
}

/** 4x4 slab grid (`s = S / 4`) at a 0.40 m real paving-slab module (typical
 * Brno concrete/granite pavement slab) -> 4 * 0.40 = 1.6 m per tile. */
export const SLAB_TILE_M = 1.6;

export function makePavementSlabMaterial({ seed = 64, size = tierSize(512) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed);
  const speckle = makeFbm(rngNoise, { cells: 5, octaves: 2 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#9b968b', 150);
    ctx.fillRect(0, 0, S, S);
    const s = S / 4;
    for (let y = 0; y < S; y += s) {
      for (let x = 0; x < S; x += s) {
        const n = speckle(x / S, y / S);
        const sat = rng.float(4, 10); // drawn unconditionally to keep both mode passes' RNG in lockstep
        ctx.fillStyle = mode === 'albedo' ? `hsl(40,${sat}%,${58 + n * 10}%)` : `rgb(${150 + n * 30},${150 + n * 30},${150 + n * 30})`;
        ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
      }
    }
    ctx.strokeStyle = pick(mode, 'rgba(0,0,0,0.25)', 80);
    ctx.lineWidth = 2;
    for (let y = 0; y <= S; y += s) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
    for (let x = 0; x <= S; x += s) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
    grain(ctx, S, S, mode === 'albedo' ? 12 : 6, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.8, roughVar: 0.12, normalStrength: 1.0, aoStrength: 1.2, sampler: speckle });
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, envMapIntensity: 0.5 });
}

/** Approximate -- scattered stones (radius 1..3.4px on the S=512 default
 * canvas) at a ~15 mm target real gravel-stone diameter give roughly
 * 0.015 / ((1+3.4)*2/512/2) ~= 1.7 m per tile. Loose-fill textures like this
 * don't have a hard grid the way setts/slabs do, so treat this as a
 * reasonable default rather than an exact derivation. */
export const GRAVEL_TILE_M = 1.7;

export function makeGravelMaterial({ seed = 65, size = tierSize(512) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed);
  const worley = makeWorley(rngNoise, 22);
  const roughSampler = (u, v) => worley(u * 22, v * 22).f1;
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#82786c', 130);
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < S * S / 30; i++) {
      const x = rng.float(0, S), y = rng.float(0, S), r = rng.float(1, 3.4);
      const w = worley(x / S * 22, y / S * 22).f1;
      const hue = rng.float(30, 45), sat = rng.float(6, 14), light = rng.float(32, 55);
      const rot = rng.float(0, Math.PI);
      ctx.fillStyle = mode === 'albedo' ? `hsl(${hue},${sat}%,${light}%)` : `rgb(${130 + (0.4 - w) * 100},${130 + (0.4 - w) * 100},${130 + (0.4 - w) * 100})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.8, rot, 0, Math.PI * 2); ctx.fill();
    }
    grain(ctx, S, S, mode === 'albedo' ? 20 : 10, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.95, roughVar: 0.05, normalStrength: 2.0, aoStrength: 1.6, sampler: roughSampler });
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, envMapIntensity: 0.3 });
}

/** Grass/terrain patchiness has no discrete real-world unit the way paving
 * does -- this is a documented tiling-scale convention (large enough that
 * the worn-dirt patch noise reads as natural terrain variegation rather
 * than a visibly repeating tile), not a derivation from a literal blade
 * size. */
export const GRASS_TILE_M = 3.0;

export function makeGrassMaterial({ seed = 66, size = tierSize(512) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed);
  const patch = makeFbm(rngNoise, { cells: 4, octaves: 4 });
  const pathField = makeFbm(new Rng(seed + 1), { cells: 3, octaves: 2 });
  const roughSampler = (u, v) => patch(u * 4, v * 4);
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#3e5c33', 120);
    ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 3) {
      for (let x = 0; x < S; x += 3) {
        const n = patch(x / S * 4, y / S * 4);
        const worn = pathField(x / S * 3, y / S * 3);
        const isDirt = worn > 0.62;
        const dirtHue = rng.float(28, 36), dirtSat = rng.float(30, 45), dirtLight = rng.float(28, 38);
        const grassHue = rng.float(85, 105), grassSat = rng.float(30, 50), grassLight = rng.float(20, 34);
        if (mode === 'albedo') {
          ctx.fillStyle = isDirt
            ? `hsl(${dirtHue},${dirtSat}%,${dirtLight}%)`
            : `hsl(${grassHue},${grassSat}%,${grassLight + n * 8}%)`;
        } else {
          ctx.fillStyle = pick(mode, undefined, isDirt ? 95 : 130 + (n - 0.5) * 30);
        }
        ctx.fillRect(x, y, 3, 3);
      }
    }
    grain(ctx, S, S, mode === 'albedo' ? 16 : 8, rng);
  };
  const { color, height } = dual(seed, S, S, draw);
  const { map, normal, orm } = finishGround(color, height, { roughBase: 0.96, roughVar: 0.04, normalStrength: 1.0, aoStrength: 1.2, sampler: roughSampler });
  return new THREE.MeshStandardMaterial({ map, normalMap: normal, normalScale: new THREE.Vector2(1, 1), roughnessMap: orm, metalnessMap: orm, aoMap: orm, roughness: 1, metalness: 1, envMapIntensity: 0.25 });
}

/** Wet-mask variant: takes any of the ground materials above's colour+height
 * pair conceptually — in practice, a puddle decal material with much lower
 * roughness and a very shallow normal ripple, meant to be layered as a
 * thin extra plane/decal over cobbles or asphalt at puddle spots. */
export function makePuddleMaterial({ seed = 67, size = tierSize(256) } = {}) {
  const S = size;
  const rngNoise = new Rng(seed);
  const ripple = makeFbm(rngNoise, { cells: 6, octaves: 3, gain: 0.6 });
  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, '#1c2530', 130);
    ctx.fillRect(0, 0, S, S);
    grain(ctx, S, S, mode === 'albedo' ? 4 : 3, rng);
  };
  const { color, height: baseHeight } = dual(seed, S, S, draw);
  // shallow ripple height field, independent of the flat base draw above
  const rippleCanvas = canvas(S, S);
  const rctx = rippleCanvas.getContext('2d');
  const img = rctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const v = 128 + (ripple(x / S * 6, y / S * 6) - 0.5) * 12;
      const p = (y * S + x) * 4;
      img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v; img.data[p + 3] = 255;
    }
  }
  rctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8; map.colorSpace = THREE.SRGBColorSpace;
  const normal = heightToNormal(rippleCanvas, 0.4);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping; nmap.anisotropy = 8; nmap.colorSpace = THREE.NoColorSpace;
  const orm = packORM(S, S, { rough: solidGray(S, S, 0.06), metal: 0.02 });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping; ormMap.anisotropy = 8; ormMap.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map, normalMap: nmap, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: ormMap, metalnessMap: ormMap,
    roughness: 1, metalness: 1,
    transparent: true, opacity: 0.85,
    envMapIntensity: 1.4,
  });
  return mat;
}
