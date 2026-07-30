import * as THREE from 'three';
import { Batch, InstanceSet } from './mesh.js';
import { MAP_SIZE, HALF } from './layout.js';

/**
 * Spatial chunking and level of detail.
 *
 * The city used to merge every material into exactly one mesh spanning the
 * whole 840 x 840 m map. That is the cheapest possible draw-call count, but
 * it also makes frustum culling useless: a bounding sphere covering the
 * entire city always intersects the view, so a camera looking down one
 * street still submits every roof, chimney and downpipe in Brno. With the
 * post-processing stack rendering the scene several times per frame, that
 * is the dominant cost in the whole project.
 *
 * So geometry is merged per material *per chunk* instead, in three tiers,
 * chosen by what a triangle is actually for:
 *
 *   SILHOUETTE  walls, roofs, main cornices — the shapes that block light.
 *               Frustum-culled, and casts into the shadow cascades.
 *   NOSHADOW    chimneys, dormers, ridges, firewalls, parapets — skyline
 *               reads at any distance, but their shadows land on the roof
 *               they are standing on and nobody will ever notice. Visible
 *               at any range, excluded from every cascade.
 *   DETAIL      plinths, string courses, gutters, downpipes, aerials,
 *               dishes, shopfronts, plates, rooftop plant. Frustum-culled,
 *               distance-culled, and never in a cascade.
 *
 * Shadow exclusion is the highest-leverage flag in this file: the renderer
 * runs three cascades, so a triangle kept out of the shadow pass is saved
 * three times over.
 */
export const TIER = { SILHOUETTE: 0, DETAIL: 1, NOSHADOW: 2 };

let matSeq = 0;
const matIds = new WeakMap();
function materialId(material) {
  let id = matIds.get(material);
  if (id === undefined) matIds.set(material, (id = ++matSeq));
  return id;
}

export class Chunks {
  /**
   * @param {object} opts
   * @param {number} opts.cells  chunks per axis (cells x cells over the map)
   * @param {number} opts.detailRadius  metres past which the detail tier hides
   */
  constructor({ cells = 6, detailRadius = 150 } = {}) {
    this.cells = cells;
    this.cellSize = MAP_SIZE / cells;
    this.detailRadius = detailRadius;
    /** @type {Map<string, {batch: Batch, material: THREE.Material, tier: number, cell: number}>} */
    this.entries = new Map();
    /** @type {{mesh: THREE.Mesh, cx: number, cz: number, reach: number}[]} */
    this.detailMeshes = [];
    this.meshCount = 0;
  }

  cellOf(x, z) {
    const gx = Math.max(0, Math.min(this.cells - 1, Math.floor((x + HALF) / this.cellSize)));
    const gz = Math.max(0, Math.min(this.cells - 1, Math.floor((z + HALF) / this.cellSize)));
    return gz * this.cells + gx;
  }

  cellCentre(cell) {
    const gx = cell % this.cells;
    const gz = Math.floor(cell / this.cells);
    return [
      gx * this.cellSize - HALF + this.cellSize / 2,
      gz * this.cellSize - HALF + this.cellSize / 2,
    ];
  }

  /** Batch for `material` in the chunk containing (x, z), at the given tier. */
  get(material, x, z, tier = TIER.SILHOUETTE) {
    const cell = this.cellOf(x, z);
    const key = `${cell}|${materialId(material)}|${tier}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { batch: new Batch(), material, tier, cell };
      this.entries.set(key, entry);
    }
    return entry.batch;
  }

  get triangles() {
    let n = 0;
    for (const e of this.entries.values()) n += e.batch.triangles;
    return n;
  }

  finish(group) {
    const halfDiag = (this.cellSize * Math.SQRT2) / 2;
    for (const entry of this.entries.values()) {
      const geo = entry.batch.geometry();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, entry.material);
      const kind = entry.tier === TIER.DETAIL ? 'detail'
        : entry.tier === TIER.NOSHADOW ? 'shell' : 'city';
      mesh.name = `${kind}:${entry.material.name || entry.material.type}`;
      mesh.castShadow = entry.tier === TIER.SILHOUETTE;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      this.meshCount++;
      if (entry.tier === TIER.DETAIL) {
        // Distance test against this bucket's own bounding sphere rather than
        // the chunk centre: a bucket holding six downpipes in one corner of
        // a chunk should not stay visible because the chunk is nominally
        // near. Geometry is baked in world space, so the sphere already is.
        const sphere = geo.boundingSphere;
        this.detailMeshes.push({
          mesh,
          cx: sphere ? sphere.center.x : this.cellCentre(entry.cell)[0],
          cz: sphere ? sphere.center.z : this.cellCentre(entry.cell)[1],
          reach: this.detailRadius + (sphere ? sphere.radius : halfDiag),
        });
      }
    }
    this.entries.clear();
    return this.meshCount;
  }

  /** Show the detail tier only for chunks near the camera. */
  update(camX, camZ) {
    for (let i = 0; i < this.detailMeshes.length; i++) {
      const d = this.detailMeshes[i];
      const dx = d.cx - camX;
      const dz = d.cz - camZ;
      d.mesh.visible = dx * dx + dz * dz < d.reach * d.reach;
    }
  }
}

/**
 * Chunked instancing: one InstancedMesh per (chunk, prop kind), so a forest
 * of 1500 trees spread over 840 m is frustum-culled like the merged
 * geometry instead of being submitted whole from every camera.
 *
 * Worth it only for props that are both numerous and spatially clustered —
 * trees and undergrowth. For a few hundred cars or pedestrians a single
 * instanced mesh is cheaper than thirty-six tiny ones.
 */
export class InstanceGrid {
  constructor(chunks, geometry, material, opts = {}) {
    this.chunks = chunks;
    this.geometry = geometry;
    this.material = material;
    this.opts = opts;
    this.tier = opts.tier ?? TIER.SILHOUETTE;
    this.sets = new Map();
    this.count = 0;
  }

  push(x, y, z, rot = 0, sx = 1, sy = sx, sz = sx, colour = null) {
    const cell = this.chunks.cellOf(x, z);
    let set = this.sets.get(cell);
    if (!set) {
      set = new InstanceSet(this.geometry, this.material, this.opts);
      this.sets.set(cell, set);
    }
    set.push(x, y, z, rot, sx, sy, sz, colour);
    this.count++;
  }

  finish(group) {
    const halfDiag = (this.chunks.cellSize * Math.SQRT2) / 2;
    let meshes = 0;
    for (const [cell, set] of this.sets) {
      const mesh = set.finish(group);
      if (!mesh) continue;
      mesh.frustumCulled = true;
      mesh.computeBoundingSphere();
      meshes++;
      if (this.tier === TIER.DETAIL) {
        mesh.castShadow = false;
        const sphere = mesh.boundingSphere || mesh.geometry.boundingSphere;
        const [ccx, ccz] = this.chunks.cellCentre(cell);
        this.chunks.detailMeshes.push({
          mesh,
          cx: sphere ? sphere.center.x : ccx,
          cz: sphere ? sphere.center.z : ccz,
          reach: this.chunks.detailRadius + (sphere ? sphere.radius : halfDiag),
        });
      }
    }
    this.sets.clear();
    return meshes;
  }
}

/**
 * Camera position tracking without touching the interface contract.
 *
 * `buildCity(...).update(dt, time)` takes no camera, and `src/main.js`
 * belongs to another engineer, so the LOD needs the view position from
 * somewhere else. `Object3D.onBeforeRender` receives the camera being
 * rendered with, so a mesh that is always submitted (the ground plane) can
 * report it. Shadow and depth prepasses render with orthographic cameras,
 * which are filtered out, and the value is only *applied* in update(), so
 * nothing mutates the scene graph mid-render.
 */
export function trackCamera(sentinel) {
  const at = { x: 0, z: 0, seen: false };
  const previous = sentinel.onBeforeRender;
  sentinel.onBeforeRender = function onBeforeRender(renderer, scene, camera, ...rest) {
    if (camera && camera.isPerspectiveCamera) {
      at.x = camera.position.x;
      at.z = camera.position.z;
      at.seen = true;
    }
    if (previous) previous.call(this, renderer, scene, camera, ...rest);
  };
  return at;
}
