import * as THREE from 'three';
import { Batch } from './mesh.js';
import {
  FLAG, FlagGrid, GRID_RES, HALF, MAP_SIZE, addRotatedBox,
} from './layout.js';
import { Chunks, TIER } from './chunks.js';
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

const SETT_SURFACES = ['paving_stones', 'sett', 'cobblestone', 'unhewn_cobblestone'];
const SETT_KINDS = ['pedestrian', 'footway', 'path', 'steps'];

function roadStyle(road) {
  if (SETT_SURFACES.includes(road.surface)) return 'sett';
  if (SETT_KINDS.includes(road.kind)) return 'sett';
  return 'asphalt';
}

const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** OSM ids of the squares the visual overrides single out for hero treatment. */
function heroAreaIds(overrides) {
  const ids = new Set();
  for (const site of Object.values(overrides?.sites || {})) {
    if (site.areaId) ids.add(site.areaId);
  }
  return ids;
}

/** OSM ids of the areas whose outline should be edged with a kerb. */
function kerbedAreaIds(overrides) {
  const ids = new Set();
  for (const site of Object.values(overrides?.sites || {})) {
    if (site.areaId && site.kerb) ids.add(site.areaId);
  }
  return ids;
}

/**
 * Build the geospatial street-life layout without mutating the legacy module
 * fixtures. This keeps buildCity re-entrant and prevents the geospatial path
 * from changing a later procedural build in the same process.
 */
export function installImportedLayout(map, visualOverrides = null) {
  const places = Object.fromEntries(
    Object.entries(map.places).map(([key, value]) => [key, { ...value }]),
  );

  const propRoads = map.roads
    .filter((road) => road.name || road.width >= 9)
    .sort((a, b) => b.width - a.width || compareStrings(String(a.id), String(b.id)))
    .slice(0, 120);
  const roads = propRoads.map((road) => ({
    name: road.name || road.kind,
    w: road.width,
    tram: false,
    paving: roadStyle(road),
    shops: road.kind === 'pedestrian' ? 0.8 : 0,
    pts: qLine(road.points),
  }));

  const plazas = [];
  for (const area of map.areas) {
    if (area.kind !== 'park' && area.kind !== 'plaza' && area.kind !== 'pedestrian') continue;
    for (const poly of decodedPolygons(area)) {
      const b = boundsOfPolygon(poly);
      plazas.push({
        id: area.id,
        r: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ],
        type: area.kind === 'park' ? FLAG.PARK : FLAG.PLAZA,
        name: area.name || area.id,
        paving: area.kind === 'park' ? null : 'fan',
      });
    }
  }
  // Props are budgeted to sixty squares. Sort the hero squares to the front so
  // the cut never lands on Náměstí Svobody or Zelný trh.
  const heroAreas = heroAreaIds(visualOverrides);
  plazas.sort((a, b) => Number(heroAreas.has(b.id)) - Number(heroAreas.has(a.id))
    || compareStrings(String(a.id), String(b.id)));
  plazas.length = Math.min(60, plazas.length);

  const tramRoutes = stitchLines(map.trams.map((tram) => qLine(tram.points))).slice(0, 5);
  const tramStops = ['ceska', 'svoboda', 'zelnyTrh', 'nadrazi']
    .filter((key) => places[key])
    .map((key) => nearestTramStop(places[key], map.trams, map.tramStops || []));
  return { places, roads, plazas, tramRoutes, tramStops };
}

function nearestTramStop(place, trams, platforms = []) {
  let platform = null;
  for (const candidate of platforms) {
    const distance = Math.hypot(candidate.x - place.x, candidate.z - place.z);
    if (distance < 170 && (!platform || distance < platform.distance)) platform = { ...candidate, distance };
  }
  const query = platform || place;
  let best = { distance: Infinity, x: query.x, z: query.z, rot: 0 };
  for (const tram of trams) {
    const points = qLine(tram.points);
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1]; const [bx, bz] = points[i];
      const dx = bx - ax; const dz = bz - az; const lengthSq = dx * dx + dz * dz;
      if (!lengthSq) continue;
      const t = Math.max(0, Math.min(1, ((query.x - ax) * dx + (query.z - az) * dz) / lengthSq));
      const x = ax + dx * t; const z = az + dz * t;
      const distance = Math.hypot(query.x - x, query.z - z);
      if (distance >= best.distance) continue;
      const length = Math.sqrt(lengthSq);
      const nx = -dz / length; const nz = dx / length;
      const side = ((query.x - x) * nx + (query.z - z) * nz) >= 0 ? 1 : -1;
      best = {
        distance,
        x: platform ? platform.x : x + nx * side * 5.5,
        z: platform ? platform.z : z + nz * side * 5.5,
        rot: Math.atan2(-dz, dx),
      };
    }
  }
  return { name: place.name, x: best.x, z: best.z, rot: best.rot };
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

const WATER_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0x284c5e, roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.84,
});
WATER_MATERIAL.name = 'imported-water';

function areaMaterial(area) {
  if (area.kind === 'park') return getMaterial(area.surface === 'gravel' ? 'gravel' : 'grass');
  if (area.kind === 'water') return WATER_MATERIAL;
  if (['paving_stones', 'concrete', 'concrete:plates'].includes(area.surface)) return getMaterial('pavementSlab');
  return getMaterial('cobbleFan');
}

function addDrapedTriangle(batchFor, a, b, c, terrain, lift, maxSpan, depth = 0) {
  const edges = [
    [a, b, a.distanceToSquared(b)],
    [b, c, b.distanceToSquared(c)],
    [c, a, c.distanceToSquared(a)],
  ].sort((u, v) => v[2] - u[2]);
  if (edges[0][2] > maxSpan * maxSpan && depth < 12) {
    const [u, v] = edges[0];
    const m = u.clone().add(v).multiplyScalar(0.5);
    const other = u === a && v === b ? c : u === b && v === c ? a : b;
    addDrapedTriangle(batchFor, u, m, other, terrain, lift, maxSpan, depth + 1);
    addDrapedTriangle(batchFor, m, v, other, terrain, lift, maxSpan, depth + 1);
    return;
  }
  const p = (v) => [v.x, terrain.heightAt(v.x, v.y) + lift, v.y];
  const cx = (a.x + b.x + c.x) / 3;
  const cz = (a.y + b.y + c.y) / 3;
  batchFor(cx, cz).tri(
    p(c), p(b), p(a),
    [c.x / 8, c.y / 8], [b.x / 8, b.y / 8], [a.x / 8, a.y / 8],
  );
}

export function addDrapedPolygon(batchFor, poly, terrain, lift = 0.045, maxSpan = 4) {
  const contour = poly[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = poly.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const points = contour.concat(...holes);
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  for (const [a, b, c] of faces) {
    addDrapedTriangle(batchFor, points[a], points[b], points[c], terrain, lift, maxSpan);
  }
}

/** Signed angle of the left-hand normal of a segment, in the x/z plane. */
function normalAngle(dx, dz) {
  return Math.atan2(dx, -dz);
}

/** Shortest signed turn from `from` to `to`. */
function angleDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function addRoad(batchFor, points, width, terrain, lift = 0.06, lateralOffset = 0, maxSpan = 4) {
  const half = width / 2;
  const p = (x, z) => [x, terrain.heightAt(x, z) + lift, z];
  for (let i = 1; i < points.length; i++) {
    const [sourceAx, sourceAz] = points[i - 1]; const [sourceBx, sourceBz] = points[i];
    const sourceDx = sourceBx - sourceAx; const sourceDz = sourceBz - sourceAz;
    const sourceLength = Math.hypot(sourceDx, sourceDz);
    // The strip is draped on the heightfield, so a long segment has to be cut
    // into spans short enough to follow it instead of tunnelling through.
    const pieces = Math.max(1, Math.ceil(sourceLength / maxSpan));
    for (let piece = 0; piece < pieces; piece++) {
      const t0 = piece / pieces; const t1 = (piece + 1) / pieces;
      const ax = sourceAx + sourceDx * t0; const az = sourceAz + sourceDz * t0;
      const bx = sourceAx + sourceDx * t1; const bz = sourceAz + sourceDz * t1;
      const dx = bx - ax; const dz = bz - az; const len = Math.hypot(dx, dz);
      if (len < 0.05) continue;
      const sideX = -dz / len; const sideZ = dx / len;
      const nx = sideX * half; const nz = sideZ * half;
      const ox = sideX * lateralOffset; const oz = sideZ * lateralOffset;
      const a = p(ax + ox + nx, az + oz + nz); const b = p(bx + ox + nx, bz + oz + nz);
      const c = p(bx + ox - nx, bz + oz - nz); const d = p(ax + ox - nx, az + oz - nz);
      batchFor((ax + bx) / 2, (az + bz) / 2).quad4(
        a, b, c, d, [0, 0], [0, len / 6], [width / 6, len / 6], [width / 6, 0],
      );
    }
  }
  if (lateralOffset !== 0 || width <= 0.3) return;
  /* Close the wedge that opens on the outside of a bend. Only the arc the
   * turn actually sweeps is filled, and only when the gap it leaves is wide
   * enough to see: a full disc at every vertex cost 63k triangles on the
   * committed map, roughly half of them at vertices that barely bend. */
  for (let i = 1; i + 1 < points.length; i++) {
    const [px, pz] = points[i - 1]; const [x, z] = points[i]; const [qx, qz] = points[i + 1];
    const from = normalAngle(x - px, z - pz);
    const delta = angleDelta(from, normalAngle(qx - x, qz - z));
    if (half * Math.abs(delta) < 0.12) continue;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 8)));
    const lo = Math.min(from, from + delta);
    const centre = p(x, z);
    const batch = batchFor(x, z);
    const rim = (angle) => p(x + Math.cos(angle) * half, z + Math.sin(angle) * half);
    const uv = (point) => [point[0] / 6, point[2] / 6];
    // The gap sits on one side of the joint and an overlap on the other, and
    // which is which flips with the turn direction. Filling both arcs costs
    // one extra triangle and is always right.
    for (const base of [lo, lo + Math.PI]) {
      for (let k = 0; k < steps; k++) {
        const inner = rim(base + (Math.abs(delta) * k) / steps);
        const outer = rim(base + (Math.abs(delta) * (k + 1)) / steps);
        batch.tri(centre, outer, inner, uv(centre), uv(outer), uv(inner));
      }
    }
  }
}

export function buildImportedPlan(group, map, terrain, chunks = null, visualOverrides = null) {
  const flags = new FlagGrid();
  flags.fill(FLAG.FREE);
  const targetChunks = chunks || new Chunks({ cells: 11, detailRadius: 180 });
  const ownsChunks = !chunks;
  const before = targetChunks.entries.size;
  const batchFor = (mat, x, z) => targetChunks.get(mat, x, z, TIER.NOSHADOW);
  const kerbed = kerbedAreaIds(visualOverrides);
  const kerbMat = getMaterial('kerb');

  for (const area of map.areas) {
    const flag = area.kind === 'park' ? FLAG.PARK
      : area.kind === 'water' ? FLAG.RESERVED : FLAG.PLAZA;
    const mat = areaMaterial(area);
    for (const poly of decodedPolygons(area)) {
      paintPolygon(flags, poly, flag);
      addDrapedPolygon(
        (x, z) => batchFor(mat, x, z),
        poly,
        terrain,
        area.kind === 'water' ? 0.02 : 0.045,
      );
      if (kerbed.has(area.id)) {
        for (const ring of poly) {
          addRoad((x, z) => batchFor(kerbMat, x, z), ring, 0.22, terrain, 0.085, 0, 3);
        }
      }
    }
  }

  const asphalt = getMaterial('asphalt');
  const cobble = getMaterial('cobbleRunning');
  for (const road of map.roads) {
    const points = qLine(road.points);
    flags.line(points, road.width, FLAG.ROAD);
    const mat = roadStyle(road) === 'sett' ? cobble : asphalt;
    addRoad((x, z) => batchFor(mat, x, z), points, road.width, terrain);
  }

  const railMat = getMaterial('paintedMetal', { seed: 25833, color: '#7b7770' });
  const trackBed = getMaterial('cobbleTramTrack');
  for (const tram of map.trams) {
    const points = qLine(tram.points);
    flags.line(points, 3.2, FLAG.TRACK);
    addRoad((x, z) => batchFor(trackBed, x, z), points, 2.25, terrain, 0.072);
    for (const offset of [-0.72, 0.72]) {
      addRoad((x, z) => batchFor(railMat, x, z), points, 0.09, terrain, 0.105, offset);
    }
  }

  for (const building of map.buildings) {
    for (const poly of decodedPolygons(building)) paintPolygon(flags, poly, FLAG.RESERVED);
  }

  const meshes = targetChunks.entries.size - before;
  if (ownsChunks) targetChunks.finish(group);
  return { flags: flags.data, meshes };
}

const FACADE_STYLES = [0, 1, 2, 3, 4, 5];

function facadeMaterial(style, band = 'plain', lit = false) {
  return getMaterial('facade', { style, bay: band, lit });
}

function hashId(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function siteExclusions(overrides) {
  const ids = new Set();
  for (const site of Object.values(overrides?.sites || {})) {
    for (const id of site.excludeBuildingIds || []) ids.add(id);
  }
  return ids;
}

function facadeRecipes(overrides) {
  const out = new Map();
  for (const site of Object.values(overrides?.sites || {})) {
    for (const [id, recipe] of Object.entries(site.facadeRecipes || {})) out.set(id, recipe);
  }
  return out;
}

function distanceToSegment(x, z, a, b) {
  const dx = b.x - a.x; const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lengthSq)) : 0;
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

/**
 * The corridor the player actually walks: the squares on the authored hero
 * route plus the streets between them. Buildings inside it get banded facades
 * and cornices; everything else stays plain massing.
 */
function heroCorridor(map, overrides) {
  const route = (overrides?.heroRoute || []).map((key) => map.places[key]).filter(Boolean);
  return (x, z) => {
    for (const place of route) if (Math.hypot(x - place.x, z - place.z) < 95) return true;
    for (let i = 1; i < route.length; i++) {
      if (distanceToSegment(x, z, route[i - 1], route[i]) < 72) return true;
    }
    return false;
  };
}

function facadeStyle(building, recipe) {
  if (recipe === 'mamlasu') return 5;
  if (recipe === 'lipy') return 0;
  if (recipe === 'omega') return 2;
  if (/church|cathedral|civic|public/.test(building.use || '')) return 1;
  return FACADE_STYLES[hashId(building.id) % FACADE_STYLES.length];
}

function roofMaterial(building) {
  const material = building.roof?.material || '';
  const colour = building.roof?.colour || '';
  if (/slate/.test(material) || /black|grey|gray/.test(colour)) return getMaterial('roofSlate');
  if (/metal|copper/.test(material) || /green/.test(colour)) return getMaterial('roofCopper');
  return getMaterial('roof');
}

function ringArea(ring) {
  let area = 0;
  for (let i = 1; i < ring.length; i++) area += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(area) / 2;
}

/**
 * Drop vertices that only restate a straight edge.
 *
 * OSM footprints routinely carry nodes shared with a neighbour's wall or left
 * behind by an old trace, so a plain rectangle can arrive with a dozen
 * corners. The roof fitter counts corners to decide whether a gable can sit on
 * a footprint, and without this it read those rectangles as free-form blocks
 * and capped them flat — which is most of why the roofscape came out level.
 */
export function simplifyRing(ring, tolerance = 0.3) {
  if (ring.length < 5) return ring;
  const points = ring.slice(0, -1);
  const kept = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[(i - 1 + points.length) % points.length];
    const q = points[i];
    const r = points[(i + 1) % points.length];
    const base = Math.hypot(r[0] - p[0], r[1] - p[1]);
    const cross = Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    if (!base || cross / base > tolerance) kept.push(q);
  }
  if (kept.length < 3) return ring;
  return kept.concat([kept[0]]);
}

export function orientedBounds(ring) {
  let best = null;
  for (let i = 1; i < ring.length; i++) {
    const dx = ring[i][0] - ring[i - 1][0]; const dz = ring[i][1] - ring[i - 1][1];
    const length = Math.hypot(dx, dz);
    if (!best || length > best.length) best = { dx, dz, length };
  }
  if (!best || best.length < 0.1) return null;
  const ux = best.dx / best.length; const uz = best.dz / best.length;
  const vx = -uz; const vz = ux;
  let minU = Infinity; let maxU = -Infinity; let minV = Infinity; let maxV = -Infinity;
  for (const [x, z] of ring) {
    const u = x * ux + z * uz; const v = x * vx + z * vz;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const cu = (minU + maxU) / 2; const cv = (minV + maxV) / 2;
  return {
    cx: cu * ux + cv * vx, cz: cu * uz + cv * vz,
    width: maxU - minU, depth: maxV - minV,
    rotation: Math.atan2(-uz, ux), ux, uz, vx, vz,
  };
}

function pointOnBox(bounds, u, v, y) {
  return [bounds.cx + bounds.ux * u + bounds.vx * v, y, bounds.cz + bounds.uz * u + bounds.vz * v];
}

function addHipRoof(batch, bounds, y, height, mansard = false) {
  const hw = bounds.width / 2; const hd = bounds.depth / 2;
  const ridgeHalf = Math.max(0, (bounds.width - bounds.depth) * 0.28);
  const a = pointOnBox(bounds, -hw, -hd, y); const b = pointOnBox(bounds, hw, -hd, y);
  const c = pointOnBox(bounds, hw, hd, y); const d = pointOnBox(bounds, -hw, hd, y);
  const r1 = pointOnBox(bounds, -ridgeHalf, 0, y + height); const r2 = pointOnBox(bounds, ridgeHalf, 0, y + height);
  if (!mansard) {
    batch.quad4(a, b, r2, r1, [0, 0], [bounds.width / 4, 0], [bounds.width / 4, height / 4], [0, height / 4]);
    batch.quad4(c, d, r1, r2, [0, 0], [bounds.width / 4, 0], [bounds.width / 4, height / 4], [0, height / 4]);
    batch.tri(d, a, r1, [0, 0], [bounds.depth / 4, 0], [bounds.depth / 8, height / 4]);
    batch.tri(b, c, r2, [0, 0], [bounds.depth / 4, 0], [bounds.depth / 8, height / 4]);
    return;
  }
  const insetU = hw * 0.72; const insetV = hd * 0.58; const breakY = y + height * 0.68;
  const ia = pointOnBox(bounds, -insetU, -insetV, breakY); const ib = pointOnBox(bounds, insetU, -insetV, breakY);
  const ic = pointOnBox(bounds, insetU, insetV, breakY); const id = pointOnBox(bounds, -insetU, insetV, breakY);
  batch.quad4(a, b, ib, ia, [0, 0], [1, 0], [1, 1], [0, 1]);
  batch.quad4(b, c, ic, ib, [0, 0], [1, 0], [1, 1], [0, 1]);
  batch.quad4(c, d, id, ic, [0, 0], [1, 0], [1, 1], [0, 1]);
  batch.quad4(d, a, ia, id, [0, 0], [1, 0], [1, 1], [0, 1]);
  const upper = { ...bounds, width: insetU * 2, depth: insetV * 2 };
  addHipRoof(batch, upper, breakY, height * 0.32, false);
}

function addFlatRoof(batch, poly, top) {
  const contour = poly[0].map(([x, z]) => new THREE.Vector2(x, z));
  const holes = poly.slice(1).map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const points = contour.concat(...holes);
  for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(contour, holes)) {
    const va = points[a]; const vb = points[b]; const vc = points[c];
    batch.tri([vc.x, top, vc.y], [vb.x, top, vb.y], [va.x, top, va.y],
      [vc.x / 4, vc.y / 4], [vb.x / 4, vb.y / 4], [va.x / 4, va.y / 4]);
  }
}

function bandForHeight(localBottom, localTop, height, shopfront = false) {
  const bands = [];
  let y = localBottom;
  const groundTop = Math.min(localTop, localBottom + 4.2);
  if (groundTop > y + 0.1) bands.push([shopfront ? 'shopfront' : 'plain', y, groundTop]);
  y = groundTop;
  const pianoTop = Math.min(localTop, localBottom + 8.0);
  if (pianoTop > y + 0.1) bands.push(['pianoNobile', y, pianoTop]);
  y = pianoTop;
  const atticBottom = Math.max(y, localTop - Math.min(2.8, height * 0.18));
  if (atticBottom > y + 0.1) bands.push(['plain', y, atticBottom]);
  if (localTop > atticBottom + 0.1) bands.push(['attic', atticBottom, localTop]);
  return bands;
}

/**
 * Raise the facade shell of one footprint, band by band.
 *
 * `batchFor(band)` hands back the batch for a band's material, so the caller
 * owns the material choice and this stays testable without a canvas.
 *
 * Bands split the wall at flat break lines measured from `foundation`, which
 * is sampled once at the footprint centre. Only the bands above the ground
 * floor can honour that: the ground band follows the terrain at each corner
 * instead. Clamping it to the foundation as well left two fifths of the
 * committed stock hanging over its own downhill wall, by up to ten metres
 * under the terraces on Petrov.
 */
export function addFootprintWalls(batchFor, poly, bands, terrain, minHeight = 0) {
  for (const ring of poly) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, az] = ring[i - 1]; const [bx, bz] = ring[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.1) continue;
      const ay = terrain.heightAt(ax, az) + minHeight;
      const by = terrain.heightAt(bx, bz) + minHeight;
      for (let b = 0; b < bands.length; b++) {
        const [band, bandBottom, bandTop] = bands[b];
        const bottomA = b === 0 ? ay : Math.max(ay, bandBottom);
        const bottomB = b === 0 ? by : Math.max(by, bandBottom);
        if (bandTop <= Math.max(bottomA, bottomB) + 0.05) continue;
        // polygon-clipping normalizes outer rings counter-clockwise and
        // courtyard rings clockwise. In both cases the empty side of the
        // boundary is to the right, so emit B->A to point the wall normal out
        // of the occupied building volume. A->B made whole street walls
        // disappear under back-face culling, leaving only their cornices and
        // roofs apparently floating over the square.
        batchFor(band).quad4(
          [bx, bottomB, bz], [ax, bottomA, az], [ax, bandTop, az], [bx, bandTop, bz],
          [0, bottomB / 3.4], [len / 3.1, bottomA / 3.4],
          [len / 3.1, bandTop / 3.4], [0, bandTop / 3.4],
        );
      }
    }
  }
}

export function buildImportedBuildings(group, collision, map, terrain, chunks, visualOverrides = null) {
  const wallSets = new Map();
  const roofSets = new Map();
  const centralCell = chunks.cellOf(0, 0);
  const centralShadowMass = new Batch();
  const excluded = siteExclusions(visualOverrides);
  const recipes = facadeRecipes(visualOverrides);
  const onHeroRoute = heroCorridor(map, visualOverrides);
  const detailMat = getMaterial('concrete', { color: '#c8bfae' });
  const entryFor = (sets, material, x, z) => {
    let byCell = sets.get(material);
    if (!byCell) sets.set(material, (byCell = new Map()));
    const cell = chunks.cellOf(x, z);
    let batch = byCell.get(cell);
    if (!batch) byCell.set(cell, (batch = new Batch()));
    return batch;
  };

  let count = 0; let courtyards = 0; let pitchedRoofs = 0; let detailed = 0;
  for (const building of map.buildings) {
    if (excluded.has(building.id)) continue;
    const recipe = recipes.get(building.id) || null;
    const style = facadeStyle(building, recipe);
    const litBuilding = hashId(building.id) % 5 === 0;
    for (const poly of decodedPolygons(building)) {
      if (!poly[0]?.length) continue;
      if (poly.length > 1) courtyards += poly.length - 1;
      const bounds = boundsOfPolygon(poly);
      const cx = (bounds.minX + bounds.maxX) / 2; const cz = (bounds.minZ + bounds.maxZ) / 2;
      const central = chunks.cellOf(cx, cz) === centralCell;
      const detailedHere = onHeroRoute(cx, cz);
      const lit = detailedHere && litBuilding;
      const taggedShape = building.roof?.shape;
      const modern = recipe === 'omega' || /commercial|office|industrial|warehouse/.test(building.use || '')
        || (building.levels || 0) >= 7;
      let roofShape = taggedShape || (modern ? 'flat' : 'gabled');
      const outline = simplifyRing(poly[0]);
      const oriented = orientedBounds(outline);
      const rectangular = oriented && poly.length === 1 && outline.length <= 6
        && ringArea(outline) / Math.max(1, oriented.width * oriented.depth) > 0.9;
      // Every pitched form is fitted to the oriented bounding box, so a
      // free-form footprint can only be capped flat.
      if (!rectangular) roofShape = 'flat';
      const defaultRoof = Math.max(2.2, Math.min(7.5, Math.min(oriented?.depth || 8, 16) * 0.42));
      const roofHeight = roofShape === 'flat' ? 0 : (building.roof?.height || defaultRoof);
      const totalHeight = Math.max(2.5, building.height - (building.minHeight || 0));
      const wallHeight = Math.max(2.5, totalHeight - roofHeight);
      const foundation = terrain.heightAt(cx, cz) + (building.minHeight || 0);
      const top = foundation + wallHeight;
      const hasShopfront = Boolean(recipe || building.name)
        || /commercial|retail|office/.test(building.use || '');
      const bands = detailedHere
        ? bandForHeight(foundation, top, wallHeight, hasShopfront)
        : [['plain', foundation, top]];

      addFootprintWalls(
        (band) => entryFor(wallSets, facadeMaterial(style, band, lit), cx, cz),
        poly, bands, terrain, building.minHeight || 0,
      );

      for (const ring of poly) {
        for (let i = 1; i < ring.length; i++) {
          const [ax, az] = ring[i - 1]; const [bx, bz] = ring[i];
          const dx = bx - ax; const dz = bz - az; const len = Math.hypot(dx, dz);
          if (len < 0.1) continue;
          const ay = terrain.heightAt(ax, az) + (building.minHeight || 0);
          const by = terrain.heightAt(bx, bz) + (building.minHeight || 0);
          if (central) {
            centralShadowMass.quad4(
              [bx, by, bz], [ax, ay, az], [ax, top, az], [bx, top, bz],
              [0, 0], [len / 4, 0], [len / 4, wallHeight / 4], [0, wallHeight / 4],
            );
          }
          const oblique = Math.min(Math.abs(dx), Math.abs(dz)) / len > 0.18;
          const collisionTop = top + roofHeight;
          if (oblique && len > 4) {
            addRotatedBox(collision, (ax + bx) / 2, (az + bz) / 2, len, 0.38,
              Math.atan2(-dz, dx), Math.min(ay, by), collisionTop - Math.min(ay, by), 'building', 'stone');
          } else {
            collision.add((ax + bx) / 2, (az + bz) / 2, Math.abs(dx) + 0.38, Math.abs(dz) + 0.38,
              Math.min(ay, by), collisionTop - Math.min(ay, by), 'building', 'stone');
          }
          if (detailedHere && ring === poly[0] && len > 2.5) {
            const rot = Math.atan2(-dz, dx);
            const details = chunks.get(detailMat, (ax + bx) / 2, (az + bz) / 2, TIER.DETAIL);
            details.box((ax + bx) / 2, top - 0.5, (az + bz) / 2, len + 0.25, 0.34, 0.42, rot);
            if (wallHeight > 9) details.box((ax + bx) / 2, foundation + 4.05, (az + bz) / 2,
              len + 0.12, 0.18, 0.25, rot);
          }
        }
      }

      const roofMat = roofMaterial(building);
      const roofBatch = entryFor(roofSets, roofMat, cx, cz);
      const emitRoof = (target) => {
        if (roofShape === 'gabled') {
          target.gable(oriented.cx, top, oriented.cz, oriented.width, oriented.depth,
            roofHeight, oriented.rotation, 4);
        } else if (roofShape === 'skillion') {
          const hw = oriented.width / 2; const hd = oriented.depth / 2;
          const a = pointOnBox(oriented, -hw, -hd, top); const b = pointOnBox(oriented, hw, -hd, top);
          const c = pointOnBox(oriented, hw, hd, top + roofHeight);
          const d = pointOnBox(oriented, -hw, hd, top + roofHeight);
          target.quad4(a, b, c, d, [0, 0], [oriented.width / 4, 0],
            [oriented.width / 4, oriented.depth / 4], [0, oriented.depth / 4]);
        } else if (roofShape !== 'flat') {
          addHipRoof(target, oriented, top, roofHeight, roofShape === 'mansard');
        } else {
          addFlatRoof(target, poly, top);
        }
      };
      emitRoof(roofBatch);
      if (central) emitRoof(centralShadowMass);
      if (roofShape !== 'flat') pitchedRoofs++;
      if (detailedHere) detailed++;
      count++;
    }
  }

  let meshes = 0;
  for (const [material, cells] of wallSets) {
    for (const batch of cells.values()) {
      const geo = batch.geometry();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = 'mass:facade';
      mesh.castShadow = false;
      mesh.receiveShadow = true; group.add(mesh); meshes++;
    }
  }
  for (const [material, cells] of roofSets) {
    for (const batch of cells.values()) {
      const geo = batch.geometry();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = 'mass:roof';
      mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh); meshes++;
    }
  }
  const shadowGeometry = centralShadowMass.geometry();
  if (shadowGeometry) {
    const shadowMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    shadowMaterial.name = 'building-shadow-proxy';
    const mesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
    mesh.name = 'mass:building-shadow-proxy';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    group.add(mesh);
    meshes++;
  }
  return { count, courtyards, meshes, pitchedRoofs, detailed };
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
    this.walkableGrid = new Uint8Array(this.distance.length);
    for (let iz = 0; iz < this.width; iz++) {
      for (let ix = 0; ix < this.width; ix++) {
        const [x, z] = this.worldAt(ix, iz);
        this.walkableGrid[iz * this.width + ix] = (
          this.flagAt(x, z) !== FLAG.RESERVED && this.terrain.slopeAt(x, z) <= 0.62
        ) ? 1 : 0;
      }
    }
    this.targetX = Infinity;
    this.targetZ = Infinity;
    this.rebuildThreshold = cellSize * 6;
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
    return this.walkableGrid[iz * this.width + ix] === 1;
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
    if (Math.hypot(targetX - this.targetX, targetZ - this.targetZ) > this.rebuildThreshold) {
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
      const attr = object.geometry?.attributes?.position;
      // Direct meshes use local geometry even when legitimately positioned at
      // world origin. World-baked batches must opt into vertex draping.
      if (object.userData?.terrainDrape !== 'vertices') {
        object.position.y += terrain.heightAt(object.position.x, object.position.z);
        object.updateMatrix();
        return;
      }
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
