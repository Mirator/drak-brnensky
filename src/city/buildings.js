import { getMaterial } from '../materials.js';
import { Batches, label } from './mesh.js';
import { TIER } from './chunks.js';
import { addRotatedBox } from './layout.js';
import { Roofscape } from './roofscape.js';
import { Shopfronts } from './shopfronts.js';

/**
 * Houses.
 *
 * Each plot is composed *vertically* out of bay archetypes rather than
 * wrapped in one repeating tile: a taller ground-floor shopfront bay, a
 * piano nobile and plainer diminishing uppers. One storey equals exactly one
 * texture tile in V, and every wall is snapped to a whole number of bays in
 * U, so windows land symmetrically on each face and different floors
 * genuinely show different windows — which is what gives per-window variety
 * (warm, dark, curtained, the occasional cold TV-blue) without a material
 * per building.
 *
 * Cost split: the *walls* are merged globally, one mesh per
 * (plaster style x bay kind x lit) bucket, because they are only about
 * 35k triangles all told and 48 always-drawn meshes is cheaper than
 * chunking them 36 ways. Everything heavier — cornices, roofs, chimneys,
 * dormers, plinths, gutters, downpipes, shopfronts — goes through `chunks`
 * so it can be frustum-culled, and the fine tier distance-culled too.
 */

/** Bay spacing. The painted bay puts its window at 53% of the tile width, so
 * a 2.9 m module is what keeps the window portrait (never square) against
 * the 3.0-3.4 m upper-storey heights. */
const BAY = 2.9;

function baysFor(metres) {
  return Math.max(1, Math.round(metres / BAY));
}

export function buildHouses(group, collision, plots, rng, { breakables, seed, chunks }) {
  const walls = new Batches();

  /* ---- material palette: cached, shared, one instance per variant ---- */
  const litCache = new Map();
  /* Bay archetypes actually generated. Each is a full paintFacadeBay() pass
   * (albedo + height + normal + AO + packed ORM) and costs roughly 115 ms of
   * boot per plaster style, so the set is deliberately three rather than
   * four: the attic storey reuses the 'plain' bay, which already reads as
   * the top floor under the main cornice and roof. That keeps every storey
   * of a house in one plaster colour and saves about 0.7 s of load time. */
  const BAYS = new Set(['plain', 'shopfront', 'pianoNobile']);
  const facade = (style, bay, lit) => {
    const kind = BAYS.has(bay) ? bay : 'plain';
    const key = `${style}|${kind}|${lit ? 1 : 0}`;
    let m = litCache.get(key);
    if (m) return m;
    const base = getMaterial('facade', { style, bay: kind });
    if (lit) {
      m = base;
    } else {
      // unlit variant shares every texture with the lit one — a clone is a
      // second draw call, never a second texture upload
      m = base.clone();
      m.name = `facade${style}-${kind}-dark`;
      m.emissiveIntensity = 0.05;
    }
    litCache.set(key, m);
    return m;
  };
  const MAT = {
    cornice: getMaterial('stone', { base: '#cdc4b2', mortar: '#b0a693', scale: 1.4 }),
    plinth: getMaterial('stone', { base: '#8f887b', mortar: '#726c62', scale: 1.1 }),
    brick: getMaterial('stone', { base: '#8a5546', mortar: '#6c4a41', scale: 0.7 }),
    graffiti: getMaterial('graffitiPlaster', { seed: 1401 }),
    roofClay: getMaterial('roof'),
    roofSlate: getMaterial('roofSlate', { seed: 1402 }),
    /* Copper is reserved for the landmarks: giving houses a fourth roof
     * material bought one more colour and cost a whole extra generated
     * texture set plus a chunk bucket per cell it appeared in. */
    roofSeam: getMaterial('roofMetalSeam', { seed: 1404 }),
    metal: getMaterial('paintedMetal', { seed: 1405, color: '#2b2f34' }),
    glass: getMaterial('paneGlass', { seed: 1501, panesX: 2, panesY: 3 }),
  };
  label(MAT);
  const roofMat = (kind) => (kind === 'slate' || kind === 'copper' ? MAT.roofSlate
    : kind === 'seam' ? MAT.roofSeam : MAT.roofClay);

  const roofscape = new Roofscape(rng, MAT);
  const shopfronts = new Shopfronts(rng, { breakables, seed });

  const emitMass = (mass, plot, isWing) => {
    const {
      x, z, w, d, rot, storeys, eaves, style, pitched, roofKind,
      ridgeAlongStreet, pitch, corniceRich, shabby,
    } = mass;
    /** silhouette / detail bucket for this mass */
    const S = (m) => chunks.get(m, x, z, TIER.SILHOUETTE);
    const N = (m) => chunks.get(m, x, z, TIER.NOSHADOW);
    const D = (m) => chunks.get(m, x, z, TIER.DETAIL);
    const skipPlusX = plot.side > 0 ? plot.neighbourRight : plot.neighbourLeft;
    const skipMinusX = plot.side > 0 ? plot.neighbourLeft : plot.neighbourRight;
    const bw = baysFor(w);
    const bd = baysFor(d);

    /* ---- walls, one box per storey with its own bay archetype ---- */
    let y = 0;
    for (let i = 0; i < storeys.length; i++) {
      const st = storeys[i];
      const lit = rng.chance(i === 0 ? 0.72 : 0.44);
      const mat = facade(style, st.kind, lit);
      const uv = (face) => (face === 0 || face === 1 ? [bd, 1, 0, 0] : [bw, 1, 0, 0]);
      // party walls and the top/bottom caps are never seen: skipping them
      // halves the wall triangle count and removes coplanar z-fighting
      const skip = [skipPlusX, skipMinusX, false, false, true, true];
      walls.get(mat).box(x, y, z, w, st.h, d, rot, uv, skip);
      // exposed blank flank on an alley gets plaster and, on the shabby
      // streets, a tag
      if (i === 0 && shabby && (!skipPlusX || !skipMinusX)) {
        const g = D(MAT.graffiti);
        const c = Math.cos(rot), s = Math.sin(rot);
        for (const sgn of [1, -1]) {
          if (sgn > 0 ? skipPlusX : skipMinusX) continue;
          const ox = x + c * (w / 2 + 0.03) * sgn;
          const oz = z - s * (w / 2 + 0.03) * sgn;
          g.box(ox, 0.1, oz, 0.06, Math.min(st.h * 0.8, 3.4), d * 0.92, rot,
            (face) => [face === 0 || face === 1 ? d / 3 : 1, 1, 0, 0]);
        }
      }
      // string course across the street face at the first floor line
      if (corniceRich && i === 1 && !isWing) {
        const c = Math.cos(rot), s = Math.sin(rot);
        D(MAT.cornice).box(
          x - s * (d / 2 + 0.06), y - 0.1, z - c * (d / 2 + 0.06),
          w + 0.12, 0.22, 0.2, rot, () => [w / 1.4, 0.2, 0, 0],
          [false, false, true, false, false, true],
        );
      }
      y += st.h;
    }

    /* ---- rusticated plinth at street level ---- */
    D(MAT.plinth).box(x, 0, z, w + 0.12, 0.55, d + 0.12, rot,
      (face) => [(face === 0 || face === 1 ? d : w) / 1.4, 0.5, 0, 0],
      [skipPlusX, skipMinusX, false, false, true, true]);

    /* ---- main cornice: silhouette, it draws the eaves line ---- */
    const proj = corniceRich ? 0.72 : 0.44;
    S(MAT.cornice).box(x, eaves - 0.62, z, w + proj, 0.62, d + proj, rot,
      (face) => [(face === 0 || face === 1 ? d : w) / 1.6, 0.6, 0, 0],
      [skipPlusX, skipMinusX, false, false, false, true]);

    /* ---- roof ---- */
    let ridgeH = 0;
    if (pitched) {
      const alongX = ridgeAlongStreet;
      const span = alongX ? d : w;
      ridgeH = Math.max(2.8, Math.min(9.2, (span / 2) * pitch));
      const ow = w + (skipPlusX || skipMinusX ? 0.1 : 0.35);
      const od = d + 0.6;
      const rmat = roofMat(roofKind);
      if (alongX) {
        S(rmat).gable(x, eaves, z, ow, od, ridgeH, rot, 2.2);
      } else {
        S(rmat).gable(x, eaves, z, od, ow, ridgeH, rot + Math.PI / 2, 2.2);
      }
      roofscape.add(chunks, mass, {
        alongX, ridgeH, ow, od, skipPlusX, skipMinusX, isWing,
      });
    } else {
      S(MAT.roofSeam).box(x, eaves, z, w + 0.3, 0.35, d + 0.3, rot,
        (face) => [(face === 0 || face === 1 ? d : w) / 2, 2, 0, 0],
        [false, false, false, false, false, true]);
      // parapet so rooftops still read as places you can be
      const p = N(MAT.cornice);
      for (const [ox, oz, pw, pd] of [
        [0, -d / 2, w + 0.3, 0.42], [0, d / 2, w + 0.3, 0.42],
        [-w / 2, 0, 0.42, d + 0.3], [w / 2, 0, 0.42, d + 0.3],
      ]) {
        const c = Math.cos(rot), s = Math.sin(rot);
        p.box(x + ox * c + oz * s, eaves + 0.35, z - ox * s + oz * c, pw, 0.95, pd, rot,
          () => [Math.max(pw, pd) / 1.6, 0.9, 0, 0]);
      }
      ridgeH = 1.3;
      roofscape.addFlat(chunks, mass);
    }

    /* ---- gutters and downpipes at every party wall ---- */
    roofscape.plumbing(chunks, mass, { skipPlusX, skipMinusX });

    /* ---- firewall between this plot and the one to its right ---- */
    if (skipPlusX && !isWing) {
      const c = Math.cos(rot), s = Math.sin(rot);
      N(MAT.cornice).box(
        x + c * w / 2, eaves - 0.3, z - s * w / 2,
        0.34, ridgeH * 0.55 + 0.9, d + 0.3, rot,
        (face) => [(face === 0 || face === 1 ? d : 0.4) / 1.6, 1.4, 0, 0],
      );
    }

    /* ---- collision ---- */
    addRotatedBox(collision, x, z, w, d, rot, 0,
      eaves + (pitched ? 1.0 : 0.5), 'building', 'stone');

    return ridgeH;
  };

  for (const plot of plots) {
    emitMass(plot, plot, false);
    if (plot.wing) {
      emitMass(plot.wing, {
        side: plot.side, neighbourLeft: false, neighbourRight: false,
      }, true);
    }
    if (plot.shop) shopfronts.add(plot);
  }

  const wallMeshes = walls.finish(group);
  const shopInfo = shopfronts.finish(chunks, collision);
  return {
    meshes: wallMeshes,
    chimneys: roofscape.chimneys,
    dormers: roofscape.dormers,
    shops: shopInfo.shops,
    facadeVariants: litCache.size,
  };
}

export { BAY };
