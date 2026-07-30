import * as THREE from 'three';
import { Rng } from '../rng.js';
import { dual, pick, grain, shade, tierSize } from './core.js';
import { heightToNormal, aoFromHeight, noiseGray, packORM } from './pbr.js';
import { makeFbm, makeWorley } from './noise.js';

const H_MORTAR = 60;
const H_BLOCK = 150;

/**
 * Gothic ashlar: horizontal courses, varied block widths, weathering
 * streaks running down from ledges, lichen patches, soot in recesses,
 * tool-mark hatching on the block faces.
 *
 * `scale` keeps its original meaning (it feeds straight into the texture's
 * UV repeat, exactly as before) so every existing call site — the
 * cathedral, the castle, both sharing one material at scale=2 — keeps
 * working unmodified. The base canvas resolution instead scales with the
 * *requested tile detail* (`detail`, new/optional) so a caller that does
 * know its own world-space footprint (a landmark author picking a bigger
 * `scale` for a broad rampart vs. a thin buttress) gets a denser texel
 * grid rather than the same blurry 128px tile stretched further.
 */
/** Real-world metres spanned by ONE repeat of the ashlar texture, i.e. at
 * `scale = 1`: the draw loop always lays 8 fixed courses across the tile
 * (`rows = 8`) regardless of `scale` (only the UV repeat count and the
 * canvas's texel density change with `scale`, not the course count), and a
 * real Gothic ashlar course runs ~0.30-0.50 m tall -- at the 0.40 m
 * midpoint, 8 * 0.40 = 3.2 m per tile. `scale` is the repeat count on top of
 * that: a wall `H` metres tall wants `scale = H / STONE_TILE_M` (see
 * `groundRepeat()` in materials.js). At today's uncommented `scale: 2` call
 * sites that's 6.4 m of coverage -- whether that's right for the wall in
 * question is for the call site's owner to check against `STONE_TILE_M`. */
export const STONE_TILE_M = 3.2;

export function makeStoneMaterial(base = '#8d8577', mortar = '#6e675c', scale = 1) {
  const S = tierSize(Math.max(256, Math.min(512, Math.round(256 * Math.sqrt(Math.max(1, scale))))));
  const seed = 4242;
  const rngNoise = new Rng(seed + 5);
  const blotch = makeFbm(rngNoise, { cells: 5, octaves: 3 });
  const lichenField = makeWorley(rngNoise, 6);

  const draw = (ctx, rng, mode) => {
    ctx.fillStyle = pick(mode, mortar, H_MORTAR);
    ctx.fillRect(0, 0, S, S);
    const rows = 8;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = r % 2 ? -S * 0.11 : 0;
      while (x < S) {
        const w = rng.float(S * 0.15, S * 0.27);
        const u = (x + w / 2) / S, v = r / rows;
        const b = blotch(u * 3, v * 3);
        const soot = v < 0.28 ? (0.28 - v) * 1.4 : 0; // soot gathers high in recesses
        const lichenD = lichenField(u * 6, v * 6).f1;
        const lichen = lichenD < 0.28;

        if (mode === 'albedo') {
          let fill = shade(base, (b - 0.5) * 24 - soot * 18);
          if (lichen) fill = shade('#7a8a52', (b - 0.5) * 20);
          ctx.fillStyle = fill;
        } else {
          ctx.fillStyle = pick(mode, undefined, H_BLOCK + (b - 0.5) * 40 - (lichen ? 12 : 0));
        }
        ctx.fillRect(x + S * 0.01, r * rh + S * 0.01, w - S * 0.02, rh - S * 0.02);

        if (mode === 'albedo') {
          // tool-mark hatching
          ctx.strokeStyle = 'rgba(0,0,0,0.06)';
          ctx.lineWidth = 1;
          for (let hx = x; hx < x + w; hx += S * 0.02) {
            ctx.beginPath();
            ctx.moveTo(hx, r * rh + S * 0.015);
            ctx.lineTo(hx + S * 0.012, r * rh + rh - S * 0.015);
            ctx.stroke();
          }
        }
        x += w;
      }
    }

    // weathering streaks running down from ledges (every other course top)
    for (let r = 0; r < rows; r += 3) {
      const streakX = rng.float(S * 0.1, S * 0.9);
      const w = rng.float(S * 0.03, S * 0.07);
      ctx.globalAlpha = mode === 'albedo' ? 0.14 : 0.25;
      const g = ctx.createLinearGradient(0, r * rh, 0, S);
      g.addColorStop(0, mode === 'albedo' ? 'rgba(20,18,14,0.9)' : `rgb(${H_BLOCK - 30},${H_BLOCK - 30},${H_BLOCK - 30})`);
      g.addColorStop(1, 'rgba(20,18,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(streakX, r * rh, w, S - r * rh);
      ctx.globalAlpha = 1;
    }

    grain(ctx, S, S, mode === 'albedo' ? 16 : 8, rng);
  };

  const { color, height } = dual(seed, S, S, draw);
  const map = new THREE.CanvasTexture(color);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(scale, scale);
  map.anisotropy = 8;
  map.colorSpace = THREE.SRGBColorSpace;

  const normal = heightToNormal(height, 1.7);
  const nmap = new THREE.CanvasTexture(normal);
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping;
  nmap.repeat.set(scale, scale);
  nmap.anisotropy = 8;
  nmap.colorSpace = THREE.NoColorSpace;

  const ao = aoFromHeight(height, { strength: 1.4 });
  const rough = noiseGray(S, S, blotch, { base: 0.82, variation: 0.2 });
  const orm = packORM(S, S, { ao, rough, metal: 0.02 });
  const ormMap = new THREE.CanvasTexture(orm);
  ormMap.wrapS = ormMap.wrapT = THREE.RepeatWrapping;
  ormMap.repeat.set(scale, scale);
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
    envMapIntensity: 0.7,
  });
}
