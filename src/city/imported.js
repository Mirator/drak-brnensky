import * as THREE from 'three';
import { Batch } from './mesh.js';
import {
  FLAG, FlagGrid, GRID_RES, HALF, MAP_SIZE, PLACES, PLAZAS, ROADS,
  TRAM_ROUTES, TRAM_STOPS,
} from './layout.js';
import { getMaterial } from '../materials.js';

const qPoint = ([x, z]) => [x / 10, z / 10];
const qLine = (points) => points.map(qPoint);

function ringContains(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polygonContains(polygon, x, z) {
  if (!polygon.length || !ringContains(polygon[0], x, z)) return false;
  for (let i = 1; i < polygon.length; i++) if (ringContains(polygon[i], x, z)) return false;
  return true;
}

function decodedPolygons(feature) {
  return feature.polygons.map((poly) => poly.map(qLine));
}

function boundsOfPolygon(poly) {
  let minX = Infinity; let minZ = Infinity; let maxX = -Infinity; let maxZ = -Infinity;
  for (const [x, z] of poly[0]) {
    minX = Math.min(minX, x); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z);
  }
  return { minX, minZ, maxX, maxZ };
}

function paintPolygon(grid, poly, flag) {
  const b = boundsOfPolygon(poly);
  grid.paintBounds(b.minX, b.minZ, b.maxX, b.maxZ, flag, (x, z) => polygonContains(poly, x, z));
}

function roadStyle(kind) {
  if (kind === 'pedestrian' || kind === 'footway' || kind === 'path' || kind === 'steps') return 'sett';
  return 'asphalt';
}

/** Replace the legacy compressed plan arrays in-place so props and trams reuse the imported plan. */
export function installImportedLayout(map) {
  for (const [key, value] of Object.entries(map.places)) {
    PLACES[key] = { ...value };
  }

  const propRoads = map.roads
    .filter((road) => road.name || road.width >= 9)
    .sort((a, b) => b.width - a.width || String(a.id).localeCompare(String(b.id)))
    .slice(0, 120);
  ROADS.splice(0, ROADS.length, ...propRoads.map((road) => ({
    name: road.name || road.kind,
    w: road.width,
    tram: false,
    paving: roadStyle(road.kind),
    shops: road.kind === 'pedestrian' ? 0.8 : 0,
    pts: qLine(road.points),
  })));

  PLAZAS.splice(0, PLAZAS.length);
  for (const area of map.areas) {
    if (area.kind !== 'park' && area.kind !== 'plaza' && area.kind !== 'pedestrian') continue;
    for (const poly of decodedPolygons(area)) {
      const b = boundsOfPolygon(poly);
      PLAZAS.push({
        r: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ],
        type: area.kind === 'park' ? FLAG.PARK : FLAG.PLAZA,
        name: area.name || area.id,
        paving: area.kind === 'park' ? null : 'fan',
      });
      if (PLAZAS.length >= 60) break;
    }
    if (PLAZAS.length >= 60) break;
  }

  const routes = stitchLines(map.trams.map((tram) => qLine(tram.points)));
  TRAM_ROUTES.splice(0, TRAM_ROUTES.length, ...routes.slice(0, 5));
  TRAM_STOPS.splice(0, TRAM_STOPS.length,
    ...['ceska', 'svoboda', 'zelnyTrh', 'nadrazi'].filter((key) => PLACES[key]).map((key) => ({
      name: PLACES[key].name, x: PLACES[key].x, z: PLACES[key].z, rot: 0,
    })));
}

/** Join unordered Overpass way fragments into a small number of useful continuous tram routes. */
export function stitchLines(source, tolerance = 2.5) {
  const lines = source.filter((line) => line.length > 1).map((line) => line.slice());
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i]; const b = lines[j];
        const variants = [
          [distance(a[a.length - 1], b[0]), a, b],
          [distance(a[a.length - 1], b[b.length - 1]), a, b.slice().reverse()],
          [distance(a[0], b[b.length - 1]), b, a],
          [distance(a[0], b[0]), b.slice().reverse(), a],
        ].sort((u, v) => u[0] - v[0]);
        if (variants[0][0] > tolerance) continue;
        lines[i] = variants[0][1].concat(variants[0][2].slice(1));
        lines.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  const length = (line) => line.slice(1).reduce((n, p, i) => n + distance(line[i], p), 0);
  return lines.filter((line) => length(line) > 80).sort((a, b) => length(b) - length(a));
}

function areaMaterial(kind) {
  if (kind === 'park') return getMaterial('grass');
  if (kind === 'water') return new THREE.MeshStandardMaterial({
    color: 0x284c5e, roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.84,
  });
  return getMaterial('cobbleFan');
}

function addDrapedPolygon(batch, poly, terrain, lift = 0.045) {
  const contour = poly[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = poly.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const points = contour.concat(...holes);
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const [a, b, c] of faces) {
    const va = points[a]; const vb = points[b]; const vc = points[c];
    const p = (v) => [v.x, terrain.heightAt(v.x, v.y) + lift, v.y];
    batch.tri(p(vc), p(vb), p(va), [vc.x / 8, vc.y / 8], [vb.x / 8, vb.y / 8], [va.x / 8, va.y / 8]);
  }
}

function addRoad(batch, points, width, terrain, lift = 0.06, lateralOffset = 0) {
  const half = width / 2;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]; const [bx, bz] = points[i];
    const dx = bx - ax; const dz = bz - az; const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const sideX = -dz / len; const sideZ = dx / len;
    const nx = sideX * half; const nz = sideZ * half;
    const ox = sideX * lateralOffset; const oz = sideZ * lateralOffset;
    const p = (x, z) => [x, terrain.heightAt(x, z) + lift, z];
    const a = p(ax + ox + nx, az + oz + nz); const b = p(bx + ox + nx, bz + oz + nz);
    const c = p(bx + ox - nx, bz + oz - nz); const d = p(ax + ox - nx, az + oz - nz);
    batch.quad4(a, b, c, d, [0, 0], [0, len / 6], [width / 6, len / 6], [width / 6, 0]);
  }
}

export function buildImportedPlan(group, map, terrain) {
  const flags = new FlagGrid();
  flags.fill(FLAG.FREE);
  const batches = new Map();
  const batchFor = (mat) => {
    let batch = batches.get(mat);
    if (!batch) batches.set(mat, (batch = new Batch()));
    return batch;
  };

  for (const area of map.areas) {
    const flag = area.kind === 'park' ? FLAG.PARK
      : area.kind === 'water' ? FLAG.RESERVED : FLAG.PLAZA;
    const mat = areaMaterial(area.kind);
    for (const poly of decodedPolygons(area)) {
      paintPolygon(flags, poly, flag);
      addDrapedPolygon(batchFor(mat), poly, terrain, area.kind === 'water' ? 0.02 : 0.045);
    }
  }

  const asphalt = getMaterial('asphalt');
  const cobble = getMaterial('cobbleRunning');
  for (const road of map.roads) {
    const points = qLine(road.points);
    flags.line(points, road.width, FLAG.ROAD);
    addRoad(batchFor(roadStyle(road.kind) === 'sett' ? cobble : asphalt), points, road.width, terrain);
  }

  const railMat = getMaterial('paintedMetal', { seed: 25833, color: '#7b7770' });
  for (const tram of map.trams) {
    const points = qLine(tram.points);
    flags.line(points, 3.2, FLAG.TRACK);
    for (const offset of [-0.72, 0.72]) {
      const rail = new Batch();
      addRoad(rail, points, 0.09, terrain, 0.105, offset);
      const geo = rail.geometry();
      if (geo) {
        const mesh = new THREE.Mesh(geo, railMat);
        mesh.receiveShadow = true; mesh.castShadow = false; group.add(mesh);
      }
    }
  }

  for (const building of map.buildings) {
    for (const poly of decodedPolygons(building)) paintPolygon(flags, poly, FLAG.RESERVED);
  }

  let meshes = 0;
  for (const [material, batch] of batches) {
    const geometry = batch.geometry();
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `map:${material.name || material.type}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
    meshes++;
  }
  return { flags: flags.data, meshes };
}

const FACADE_STYLES = [0, 2, 4];

function facadeMaterial(index) {
  return getMaterial('facade', {
    style: FACADE_STYLES[index % FACADE_STYLES.length],
    bay: 'plain',
  });
}

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function buildImportedBuildings(group, collision, map, terrain, chunks) {
  const walls = Array.from({ length: FACADE_STYLES.length }, () => new Map());
  const roofs = new Map();
  const roofMat = getMaterial('roof');
  const entryFor = (sets, style, x, z) => {
    const cell = chunks.cellOf(x, z);
    let batch = sets[style].get(cell);
    if (!batch) sets[style].set(cell, (batch = new Batch()));
    return batch;
  };
  const roofFor = (x, z) => {
    const cell = chunks.cellOf(x, z);
    let batch = roofs.get(cell);
    if (!batch) roofs.set(cell, (batch = new Batch()));
    return batch;
  };

  let count = 0;
  let courtyards = 0;
  for (const building of map.buildings) {
    if (building.landmark) continue;
    const style = hashId(building.id) % FACADE_STYLES.length;
    for (const poly of decodedPolygons(building)) {
      if (!poly[0]?.length) continue;
      if (poly.length > 1) courtyards += poly.length - 1;
      const b = boundsOfPolygon(poly);
      const cx = (b.minX + b.maxX) / 2; const cz = (b.minZ + b.maxZ) / 2;
      const base = terrain.heightAt(cx, cz) + (building.minHeight || 0);
      const height = Math.max(2.5, building.height - (building.minHeight || 0));
      const top = base + height;
      const wallBatch = entryFor(walls, style, cx, cz);
      for (const ring of poly) {
        for (let i = 1; i < ring.length; i++) {
          const [ax, az] = ring[i - 1]; const [bx, bz] = ring[i];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.1) continue;
          const ay = terrain.heightAt(ax, az) + (building.minHeight || 0);
          const by = terrain.heightAt(bx, bz) + (building.minHeight || 0);
          wallBatch.quad4(
            [ax, ay, az], [bx, by, bz], [bx, top, bz], [ax, top, az],
            [0, 0], [len / 3.1, 0], [len / 3.1, height / 3.4], [0, height / 3.4],
          );
          // One tight AABB per imported wall edge. Slicing every diagonal
          // facade would multiply the historic centre into hundreds of
          // thousands of colliders with no gameplay benefit.
          collision.add(
            (ax + bx) / 2, (az + bz) / 2,
            Math.abs(bx - ax) + 0.38, Math.abs(bz - az) + 0.38,
            Math.min(ay, by), top - Math.min(ay, by), 'building', 'stone',
          );
        }
      }

      const contour = poly[0].map(([x, z]) => new THREE.Vector2(x, z));
      const holes = poly.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
      const points = contour.concat(...holes);
      for (const [a, b0, c] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
        const va = points[a]; const vb = points[b0]; const vc = points[c];
        roofFor(cx, cz).tri(
          [vc.x, top, vc.y], [vb.x, top, vb.y], [va.x, top, va.y],
          [vc.x / 4, vc.y / 4], [vb.x / 4, vb.y / 4], [va.x / 4, va.y / 4],
        );
      }
      count++;
    }
  }

  let meshes = 0;
  const centralCell = chunks.cellOf(0, 0);
  for (let style = 0; style < walls.length; style++) {
    const material = facadeMaterial(style);
    for (const [cell, batch] of walls[style]) {
      const geo = batch.geometry();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material);
      // Keep cascaded shadows on the historic-core bucket. Distant massing
      // still receives shadows but does not get submitted three extra times.
      mesh.castShadow = cell === centralCell;
      mesh.receiveShadow = true; group.add(mesh); meshes++;
    }
  }
  for (const batch of roofs.values()) {
    const geo = batch.geometry();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, roofMat);
    // Roof silhouettes are already grounded by facade shadows; excluding
    // these dense triangulations keeps the cascaded submission below budget.
    mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh); meshes++;
  }
  return { count, courtyards, meshes };
}

export function buildImportedMinimap(map) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const p = ([x, z]) => [(x / 10 + HALF) * 512 / MAP_SIZE, (z / 10 + HALF) * 512 / MAP_SIZE];
  ctx.fillStyle = '#29302a'; ctx.fillRect(0, 0, 512, 512);
  for (const area of map.areas) {
    ctx.fillStyle = area.kind === 'park' ? '#40533a' : area.kind === 'water' ? '#284c5e' : '#59564f';
    for (const poly of area.polygons) {
      ctx.beginPath();
      for (const ring of poly) {
        ring.forEach((point, i) => {
          const [x, y] = p(point);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  ctx.strokeStyle = '#77736c';
  for (const road of map.roads) {
    ctx.lineWidth = Math.max(0.6, road.width * 512 / MAP_SIZE);
    ctx.beginPath();
    road.points.forEach((point, i) => {
      const [x, y] = p(point);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.fillStyle = '#191b1c';
  for (const building of map.buildings) {
    for (const poly of building.polygons) {
      ctx.beginPath();
      for (const ring of poly) {
        ring.forEach((point, i) => {
          const [x, y] = p(point);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }
  return canvas;
}

export function createFlagAt(flags) {
  return (x, z) => {
    const gx = Math.floor((x + HALF) / GRID_RES);
    const gz = Math.floor((z + HALF) / GRID_RES);
    if (gx < 0 || gz < 0 || gx >= MAP_SIZE / GRID_RES || gz >= MAP_SIZE / GRID_RES) return FLAG.RESERVED;
    return flags[gz * (MAP_SIZE / GRID_RES) + gx];
  };
}

export class NavigationField {
  constructor(flagAt, terrain, cellSize = 4) {
    this.flagAt = flagAt;
    this.terrain = terrain;
    this.cellSize = cellSize;
    this.width = Math.ceil(MAP_SIZE / cellSize);
    this.distance = new Int32Array(this.width * this.width);
    this.distance.fill(-1);
    this.targetX = Infinity;
    this.targetZ = Infinity;
  }

  indexAt(x, z) {
    const ix = Math.max(0, Math.min(this.width - 1, Math.floor((x + HALF) / this.cellSize)));
    const iz = Math.max(0, Math.min(this.width - 1, Math.floor((z + HALF) / this.cellSize)));
    return [ix, iz, iz * this.width + ix];
  }

  worldAt(ix, iz) {
    return [
      ix * this.cellSize - HALF + this.cellSize / 2,
      iz * this.cellSize - HALF + this.cellSize / 2,
    ];
  }

  walkable(ix, iz) {
    const [x, z] = this.worldAt(ix, iz);
    return this.flagAt(x, z) !== FLAG.RESERVED && this.terrain.slopeAt(x, z) <= 0.62;
  }

  rebuild(x, z) {
    this.distance.fill(-1);
    const [sx, sz, start] = this.indexAt(x, z);
    if (!this.walkable(sx, sz)) return false;
    const queue = new Int32Array(this.distance.length);
    let head = 0; let tail = 0;
    queue[tail++] = start;
    this.distance[start] = 0;
    while (head < tail) {
      const index = queue[head++];
      const ix = index % this.width;
      const iz = Math.floor(index / this.width);
      const nextDistance = this.distance[index] + 1;
      for (const [nx, nz] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
        if (nx < 0 || nz < 0 || nx >= this.width || nz >= this.width) continue;
        const ni = nz * this.width + nx;
        if (this.distance[ni] !== -1 || !this.walkable(nx, nz)) continue;
        this.distance[ni] = nextDistance;
        queue[tail++] = ni;
      }
    }
    this.targetX = x; this.targetZ = z;
    return true;
  }

  reachable(x, z) {
    return this.distance[this.indexAt(x, z)[2]] >= 0;
  }

  directionAt(x, z, targetX = this.targetX, targetZ = this.targetZ) {
    if (Math.hypot(targetX - this.targetX, targetZ - this.targetZ) > this.cellSize * 1.5) {
      this.rebuild(targetX, targetZ);
    }
    const [ix, iz, index] = this.indexAt(x, z);
    let best = this.distance[index];
    if (best < 0) return null;
    let bx = ix; let bz = iz;
    for (const [nx, nz] of [[ix - 1, iz], [ix + 1, iz], [ix, iz - 1], [ix, iz + 1]]) {
      if (nx < 0 || nz < 0 || nx >= this.width || nz >= this.width) continue;
      const d = this.distance[nz * this.width + nx];
      if (d >= 0 && d < best) { best = d; bx = nx; bz = nz; }
    }
    if (bx === ix && bz === iz) return { x: 0, z: 0 };
    const [wx, wz] = this.worldAt(bx, bz);
    const dx = wx - x; const dz = wz - z; const length = Math.hypot(dx, dz) || 1;
    return { x: dx / length, z: dz / length };
  }
}

/** Lift world-baked procedural batches onto DMR terrain before they are uploaded. */
export function drapeChunkBatches(chunks, terrain) {
  for (const entry of chunks.entries.values()) {
    const p = entry.batch.p;
    for (let i = 0; i < p.length; i += 3) p[i + 1] += terrain.heightAt(p[i], p[i + 2]);
  }
}

/** Drape meshes appended by procedural prop/vegetation builders. */
export function drapeChildren(group, firstChild, terrain) {
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (const child of group.children.slice(firstChild)) {
    child.traverse((object) => {
      if (!object.isMesh) return;
      if (object.isInstancedMesh) {
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, matrix);
          matrix.decompose(pos, quat, scale);
          pos.y += terrain.heightAt(pos.x, pos.z);
          matrix.compose(pos, quat, scale);
          object.setMatrixAt(i, matrix);
        }
        object.instanceMatrix.needsUpdate = true;
        object.computeBoundingSphere();
        return;
      }
      if (Math.abs(object.position.x) > 0.001 || Math.abs(object.position.z) > 0.001) {
        object.position.y += terrain.heightAt(object.position.x, object.position.z);
        object.updateMatrix();
        return;
      }
      const attr = object.geometry?.attributes?.position;
      if (!attr) return;
      for (let i = 0; i < attr.count; i++) {
        const x = attr.getX(i); const z = attr.getZ(i);
        attr.setY(i, attr.getY(i) + terrain.heightAt(x, z));
      }
      attr.needsUpdate = true;
      object.geometry.computeBoundingSphere();
      object.geometry.computeBoundingBox();
    });
  }
}

export function drapeCollisionBoxes(collision, firstBox, terrain) {
  for (let i = firstBox; i < collision.boxes.length; i++) {
    const box = collision.boxes[i];
    const x = (box.x0 + box.x1) / 2;
    const z = (box.z0 + box.z1) / 2;
    const lift = terrain.heightAt(x, z);
    box.bottom += lift;
    box.top += lift;
  }
}
