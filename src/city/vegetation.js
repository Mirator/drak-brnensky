import * as THREE from 'three';
import { getMaterial } from '../materials.js';
import { partsGeometry, label } from './mesh.js';
import { TIER, InstanceGrid } from './chunks.js';
import { HALF, FLAG, ROADS, PLAZAS, segments } from './layout.js';
import { parkPaths } from './plan.js';

/**
 * Vegetation.
 *
 * Denisovy sady is an arboretum with 150+ exotic species, so the parks in the
 * green ring get a real species mix rather than one repeated blob: five
 * canopy archetypes (linden, plane, chestnut, poplar, conifer), plus
 * undergrowth, clipped hedges and low planting along the gravel spines.
 * Street trees default to linden, the safe regional default.
 *
 * Cost control, in the order it mattered:
 *
 *  - Trees are the most numerous thing in the city and the most spatially
 *    clustered, so trunks and canopies go through `InstanceGrid`: one
 *    instanced mesh per chunk per species, which restores frustum culling.
 *    A camera looking down one street no longer submits the woodland on the
 *    far side of Brno.
 *  - The forest ring beyond `collision.bounds` is canopy only — no trunk, no
 *    collider, no shadow casting. Nobody can ever stand in it.
 *  - Undergrowth is a single 20-triangle blob in the distance-culled detail
 *    tier and never casts a shadow.
 */

const SPECIES = [
  { name: 'linden', colour: 0x39602f, blobs: [[0, 0.62, 0, 0.46], [-0.34, 0.86, 0.16, 0.3], [0.3, 0.9, -0.14, 0.28]], slim: 1 },
  { name: 'plane', colour: 0x4a6b34, blobs: [[0, 0.58, 0, 0.52], [-0.42, 0.8, 0.2, 0.36], [0.4, 0.84, -0.22, 0.34]], slim: 1.12 },
  { name: 'chestnut', colour: 0x2f5228, blobs: [[0, 0.66, 0, 0.44], [-0.26, 0.94, -0.2, 0.3], [0.28, 0.9, 0.22, 0.3]], slim: 0.95 },
  { name: 'poplar', colour: 0x46652c, blobs: [[0, 0.7, 0, 0.26], [0, 0.96, 0, 0.22], [0, 1.2, 0, 0.16]], slim: 0.6 },
  { name: 'conifer', colour: 0x22402a, blobs: null, slim: 0.7 },
];

function canopyGeometry(spec) {
  if (!spec.blobs) {
    return partsGeometry([
      { geo: new THREE.ConeGeometry(0.44, 1.5, 8), y: 0.95 },
      { geo: new THREE.ConeGeometry(0.3, 1.0, 8), y: 1.6 },
    ]);
  }
  const parts = spec.blobs.map(([x, y, z, r]) => {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.86, 1);
    return { geo: g, x, y, z };
  });
  return partsGeometry(parts);
}

/** One blob, 20 triangles: the map-edge forest is silhouette and nothing else. */
function distantCanopyGeometry() {
  const g = new THREE.IcosahedronGeometry(0.62, 0);
  g.scale(1, 1.15, 1);
  g.translate(0, 0.74, 0);
  return g;
}

function trunkGeometry() {
  const g = new THREE.CylinderGeometry(0.11, 0.2, 1, 6);
  g.translate(0, 0.5, 0);
  return g;
}

function shrubGeometry() {
  const g = new THREE.IcosahedronGeometry(0.46, 0);
  g.scale(1, 0.8, 1);
  g.translate(0, 0.34, 0);
  return g;
}

export function buildVegetation(group, collision, { rng, chunks }) {
  const trunkMat = getMaterial('wood', { seed: 1801, color: '#42332a' });
  const hedgeMat = new THREE.MeshStandardMaterial({ color: 0x2c4a26, roughness: 0.95, flatShading: true });
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x33562c, roughness: 0.95, flatShading: true });
  label({ treeTrunk: trunkMat, hedge: hedgeMat, shrub: shrubMat });

  const trunk = new InstanceGrid(chunks, trunkGeometry(), trunkMat);
  const canopies = SPECIES.map((spec) => new InstanceGrid(
    chunks,
    canopyGeometry(spec),
    new THREE.MeshStandardMaterial({
      name: `canopy-${spec.name}`, color: spec.colour, roughness: 0.95, flatShading: true,
    }),
  ));
  const forestMat = new THREE.MeshStandardMaterial({
    name: 'canopy-forest', color: 0x2c4a2a, roughness: 0.96, flatShading: true,
  });
  const forestGrid = new InstanceGrid(chunks, distantCanopyGeometry(), forestMat, { castShadow: false });
  const shrubs = new InstanceGrid(chunks, shrubGeometry(), shrubMat, {
    castShadow: false, tier: TIER.DETAIL,
  });

  let trees = 0;
  let colliders = 0;
  const plant = (x, z, size, speciesIndex) => {
    const spec = SPECIES[speciesIndex];
    const trunkH = size * 0.42;
    const lean = rng.float(0, Math.PI * 2);
    trunk.push(x, 0, z, lean, size * 0.13, trunkH, size * 0.13);
    canopies[speciesIndex].push(x, trunkH * 0.72, z, lean,
      size * 0.5 * spec.slim, size * 0.52, size * 0.5 * spec.slim);
    collision.add(x, z, 0.75, 0.75, 0, Math.min(3.2, trunkH), 'tree', 'wood');
    colliders++;
    trees++;
  };

  /* ---- parks: mixed species, undergrowth, hedged edges ---- */
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    if (p.type !== FLAG.PARK) continue;
    const arboretum = p.name === 'denisovy' || p.name === 'spilberk';
    const n = Math.floor((w * d) / (arboretum ? 210 : 300));
    for (let i = 0; i < n; i++) {
      const x = cx + rng.float(-w / 2 + 3, w / 2 - 3);
      const z = cz + rng.float(-d / 2 + 3, d / 2 - 3);
      if (collision.isSolidAt(x, 2, z)) continue;
      const sp = arboretum ? rng.int(0, SPECIES.length - 1)
        : (rng.chance(0.55) ? 0 : rng.int(1, SPECIES.length - 1));
      plant(x, z, rng.float(3.2, 7.4), sp);
    }
    for (let i = 0; i < Math.floor((w * d) / 220); i++) {
      const x = cx + rng.float(-w / 2 + 1.5, w / 2 - 1.5);
      const z = cz + rng.float(-d / 2 + 1.5, d / 2 - 1.5);
      if (collision.isSolidAt(x, 1, z)) continue;
      shrubs.push(x, 0.01, z, rng.float(0, 3.1),
        rng.float(0.7, 1.5), rng.float(0.6, 1.4), rng.float(0.7, 1.5));
    }
    // clipped hedge along the two long edges, broken by the path mouths
    for (const side of [-1, 1]) {
      const zz = cz + side * (d / 2 - 1.1);
      for (let x = cx - w / 2 + 2; x < cx + w / 2 - 2; x += 4.2) {
        if (rng.chance(0.35)) continue;
        chunks.get(hedgeMat, x, zz, TIER.DETAIL).box(
          x, 0.01, zz, 3.9, rng.float(0.75, 1.15), 0.9, 0,
          (f) => [(f === 0 || f === 1 ? 0.9 : 3.9) / 0.8, 1.2, 0, 0],
        );
      }
    }
    // low planting alongside the gravel spines
    for (const path of parkPaths(p, rng)) {
      if (path.dirt) continue;
      for (let i = 0; i < 6; i++) {
        const k = Math.min(path.pts.length - 2,
          Math.floor(rng.float(0, 1) * (path.pts.length - 1)));
        const seg = path.pts[k];
        const nxt = path.pts[k + 1];
        const u = rng.float(0, 1);
        const px = seg[0] + (nxt[0] - seg[0]) * u + rng.float(-3.5, 3.5);
        const pz = seg[1] + (nxt[1] - seg[1]) * u + rng.float(-3.5, 3.5);
        if (collision.isSolidAt(px, 1, pz)) continue;
        shrubs.push(px, 0.01, pz, rng.float(0, 3.1), rng.float(0.8, 1.6), 1, rng.float(0.8, 1.6));
      }
    }
  }

  /* ---- avenue trees along the wide streets ---- */
  for (const road of ROADS) {
    if (road.w < 14) continue;
    for (const seg of segments(road.pts)) {
      for (let t = 12; t < seg.len - 8; t += rng.float(20, 32)) {
        for (const side of [-1, 1]) {
          const off = road.w / 2 + 2.4;
          const x = seg.ax + seg.tx * t + seg.nx * off * side;
          const z = seg.az + seg.tz * t + seg.nz * off * side;
          if (collision.isSolidAt(x, 2, z)) continue;
          plant(x, z, rng.float(3.4, 5.4), rng.chance(0.72) ? 0 : 1);
        }
      }
    }
  }

  /* ---- forest ring at the map edge, outside the playable bounds ---- */
  let forestTrees = 0;
  for (let i = 0; i < 620; i++) {
    const side = rng.int(0, 3);
    const along = rng.float(-HALF, HALF);
    const depth = rng.float(HALF - 24, HALF - 2);
    const x = side === 0 ? -depth : side === 1 ? depth : along;
    const z = side === 2 ? -depth : side === 3 ? depth : along;
    const size = rng.float(4.5, 8.5);
    forestGrid.push(x, 0, z, rng.float(0, Math.PI * 2),
      size * 0.5, size * 0.55, size * 0.5);
    forestTrees++;
  }

  let meshes = trunk.finish(group);
  for (const c of canopies) meshes += c.finish(group);
  meshes += forestGrid.finish(group);
  meshes += shrubs.finish(group);

  return {
    meshes,
    trees: trees + forestTrees,
    parkTrees: trees,
    forestTrees,
    shrubs: shrubs.count,
    colliders,
    species: SPECIES.length,
  };
}
