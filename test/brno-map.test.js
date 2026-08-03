import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import {
  buildingHeight, chooseStart, normalizeOsm, parseArgs, PINNED_SOURCE_DATE, quantize,
  resolveBuildingParts,
} from '../scripts/import-brno-map.mjs';
import {
  decodeTerrain, Heightfield, geoToWorld, validateBrnoArtifacts, worldToGeo,
} from '../src/city/data.js';
import {
  addDrapedPolygon, addFootprintRoof, addFootprintWalls, addRoad, drapeChildren, facadeMetrics,
  footprintRoofRise, frontageRun, insetRing, installImportedLayout, NavigationField,
  orientedBounds, polygonContains, ringSelfIntersects, simplifyRing, stitchLines,
} from '../src/city/imported.js';
import { Batch } from '../src/city/mesh.js';
import {
  PLACES as LEGACY_PLACES,
  PLAZAS as LEGACY_PLAZAS,
  ROADS as LEGACY_ROADS,
  TRAM_ROUTES as LEGACY_TRAM_ROUTES,
  TRAM_STOPS as LEGACY_TRAM_STOPS,
} from '../src/city/layout.js';
import { transformLandmarkPoint } from '../src/landmarks/detail.js';
import { CollisionWorld } from '../src/physics.js';

const map = JSON.parse(fs.readFileSync(new URL('../src/data/brno-map.json', import.meta.url), 'utf8'));
const visualOverrides = JSON.parse(fs.readFileSync(
  new URL('../src/data/brno-visual-overrides.json', import.meta.url), 'utf8',
));

function terrainBuffer(width, height, values) {
  const buffer = new ArrayBuffer(32 + width * height * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < 7; i++) view.setUint8(i, 'BRNOHT1'.charCodeAt(i));
  view.setUint16(8, width, true);
  view.setUint16(10, height, true);
  view.setFloat32(12, 4, true);
  view.setFloat32(16, -4, true);
  view.setFloat32(20, -4, true);
  view.setFloat32(24, 215, true);
  view.setFloat32(28, 0.05, true);
  values.forEach((value, i) => view.setInt16(32 + i * 2, value, true));
  return buffer;
}

test('committed Brno artifacts carry bounds, landmarks and separate attribution', () => {
  assert.equal(map.schema, 2);
  assert.equal(map.metadata.size, 1500);
  assert.deepEqual(map.metadata.bounds, { minX: -750, minZ: -750, maxX: 750, maxZ: 750 });
  for (const key of ['svoboda', 'zelnyTrh', 'radnice', 'petrov', 'spilberk', 'moravske',
    'janacek', 'mahen', 'nadrazi', 'ceska', 'column', 'orloj']) {
    assert.equal(map.places[key].fallback, false, `${key} should use an OSM anchor`);
  }
  assert.equal(map.metadata.attribution.license, 'ODbL-1.0');
  assert.equal(map.terrain.attribution.license, 'CC-BY-4.0');
  for (const place of Object.values(map.places)) {
    assert.ok(Math.abs(place.x) <= 750 && Math.abs(place.z) <= 750);
  }
  assert.ok(map.buildings.some((building) => building.polygons.some((polygon) => polygon.length > 1)),
    'at least one imported courtyard/hole is preserved');
  assert.ok(map.buildings.filter((building) => building.levels).length > 1000);
  assert.ok(map.buildings.filter((building) => building.roof?.shape).length > 500);
  assert.ok(map.roads.filter((road) => road.surface).length > 2000);
  assert.ok(map.tramStops.length > 0);
  assert.equal(validateBrnoArtifacts(map, visualOverrides), true);
});

test('hero-site exclusions are explicit and do not erase Petrov neighbours by radius', () => {
  const petrov = visualOverrides.sites.petrov.excludeBuildingIds;
  assert.deepEqual(petrov, [
    'way/32877797', 'way/377366823', 'way/377366824', 'way/377366825',
    'way/377366826', 'way/377366827', 'way/962125777',
  ]);
  assert.equal(petrov.includes('way/32923542'), false);
  for (const id of Object.keys(visualOverrides.sites.svoboda.facadeRecipes)) {
    assert.ok(map.buildings.some((building) => building.id === id));
  }
});

test('committed Brno artifact hashes match the pinned checksum manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(
    new URL('../src/data/brno-checksums.json', import.meta.url), 'utf8',
  ));
  assert.equal(manifest.sourceDate, PINNED_SOURCE_DATE);
  for (const name of ['brno-map.json', 'brno-terrain.bin']) {
    const data = fs.readFileSync(new URL(`../src/data/${name}`, import.meta.url));
    assert.equal(createHash('sha256').update(data).digest('hex'), manifest.sha256[name]);
  }
  assert.equal(parseArgs([]).date, PINNED_SOURCE_DATE);
  assert.equal(parseArgs(['--date=2026-08-01']).date, '2026-08-01T23:59:59Z');
});

test('Náměstí Svobody spawn is inside its OSM polygon and faces the Marian column', () => {
  const square = map.areas.find((area) => area.id === 'way/4934858');
  assert.ok(square, 'square footprint was imported');
  const polygons = square.polygons.map((poly) => poly.map((ring) => ring.map(([x, z]) => [x / 10, z / 10])));
  assert.ok(polygons.some((poly) => polygonContains(poly, map.start.x, map.start.z)));
  const yaw = Math.atan2(map.places.column.x - map.start.x, map.places.column.z - map.start.z);
  const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
  const toColumn = new THREE.Vector2(
    map.places.column.x - map.start.x,
    map.places.column.z - map.start.z,
  ).normalize();
  assert.ok(forward.x * toColumn.x + forward.z * toColumn.y > 0.999);
  let railClearance = Infinity;
  for (const tram of map.trams) {
    const points = tram.points.map(([x, z]) => new THREE.Vector2(x / 10, z / 10));
    for (let i = 1; i < points.length; i++) {
      const segment = points[i].clone().sub(points[i - 1]);
      const t = Math.max(0, Math.min(1,
        new THREE.Vector2(map.start.x, map.start.z).sub(points[i - 1]).dot(segment) / segment.lengthSq()));
      const nearest = points[i - 1].clone().addScaledVector(segment, t);
      railClearance = Math.min(railClearance, nearest.distanceTo(new THREE.Vector2(map.start.x, map.start.z)));
    }
  }
  assert.ok(railClearance >= map.start.clearance);
  const raw = fs.readFileSync(new URL('../src/data/brno-terrain.bin', import.meta.url));
  const actualTerrain = decodeTerrain(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  assert.ok(Number.isFinite(actualTerrain.heightAt(map.start.x, map.start.z)));
});

test('terrain binary decoder is little-endian and bilinear at borders', () => {
  const terrain = decodeTerrain(terrainBuffer(2, 2, [0, 20, 40, 60]));
  assert.equal(terrain.heightAt(-4, -4), 0);
  assert.ok(Math.abs(terrain.heightAt(0, 0) - 3) < 1e-6);
  assert.ok(Math.abs(terrain.heightAt(-2, -2) - 1.5) < 1e-6);
  assert.ok(Math.abs(terrain.absoluteHeightAt(-2, -2) - 216.5) < 1e-6);
  const normal = terrain.normalAt(-2, -2);
  assert.ok(Number.isFinite(normal.x) && normal.y > 0 && Number.isFinite(normal.z));
});

test('terrain-aware collision supports ground, rays and swept spheres', () => {
  const terrain = new Heightfield({
    width: 3, height: 3, cellSize: 4, minX: -4, minZ: -4,
    verticalDatum: 0, scale: 1, samples: new Int16Array([0, 1, 2, 0, 1, 2, 0, 1, 2]),
  });
  const collision = new CollisionWorld().setTerrain(terrain);
  assert.equal(collision.groundHeight(0, 0), 1);
  const down = new THREE.Vector3(0, -1, 0);
  assert.ok(Math.abs(collision.raycast(new THREE.Vector3(0, 10, 0), down, 20) - 9) < 0.01);
  const hit = collision.sweepSphere(new THREE.Vector3(0, 10, 0), down, 20, 0.5, {});
  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.py - 1.5) < 0.02);
});

test('4 m navigation flow stays in the player-connected walkable component', () => {
  const flat = new Heightfield({
    width: 5, height: 5, cellSize: 4, minX: -8, minZ: -8,
    verticalDatum: 0, scale: 1, samples: new Int16Array(25),
  });
  const blocked = (x) => (x > 0 ? 120 : 30);
  const nav = new NavigationField(blocked, flat, 4);
  assert.equal(nav.rebuild(-6, 0), true);
  assert.equal(nav.reachable(-6, 6), true);
  assert.equal(nav.reachable(6, 6), false);
  const direction = nav.directionAt(-6, 6, -6, 0);
  assert.ok(direction && direction.z < 0);
});

test('navigation caches static walkability across flow-field rebuilds', () => {
  let slopeSamples = 0;
  const terrain = { slopeAt: () => { slopeSamples++; return 0; } };
  const nav = new NavigationField(() => 30, terrain, 100);
  const afterConstruction = slopeSamples;
  assert.equal(afterConstruction, nav.width * nav.width);
  assert.equal(nav.rebuild(0, 0), true);
  nav.rebuild(200, 0);
  assert.equal(slopeSamples, afterConstruction);
});

test('tram stitching joins reversible fragments and respects tolerance', () => {
  const stitched = stitchLines([
    [[0, 0], [45, 0]],
    [[90, 0], [45, 0]],
    [[200, 0], [290, 0]],
  ], 0.1);
  assert.deepEqual(stitched[0], [[0, 0], [45, 0], [90, 0]]);
  assert.deepEqual(stitched[1], [[200, 0], [290, 0]]);
});

test('imported layout is capped, deterministic, and leaves legacy fixtures untouched', () => {
  const before = {
    places: JSON.stringify(LEGACY_PLACES),
    roads: JSON.stringify(LEGACY_ROADS),
    plazas: JSON.stringify(LEGACY_PLAZAS),
    tramRoutes: JSON.stringify(LEGACY_TRAM_ROUTES),
    tramStops: JSON.stringify(LEGACY_TRAM_STOPS),
  };
  const first = installImportedLayout(map);
  const second = installImportedLayout(map);
  assert.deepEqual(first, second);
  assert.ok(first.roads.length <= 120);
  assert.ok(first.plazas.length <= 60);
  assert.deepEqual({
    places: JSON.stringify(LEGACY_PLACES),
    roads: JSON.stringify(LEGACY_ROADS),
    plazas: JSON.stringify(LEGACY_PLAZAS),
    tramRoutes: JSON.stringify(LEGACY_TRAM_ROUTES),
    tramStops: JSON.stringify(LEGACY_TRAM_STOPS),
  }, before);
});

test('drapeChildren lifts a local mesh positioned at the world origin', () => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  const beforeY = mesh.geometry.attributes.position.getY(0);
  group.add(mesh);
  drapeChildren(group, 0, { heightAt: () => 7 });
  assert.equal(mesh.position.y, 7);
  assert.equal(mesh.geometry.attributes.position.getY(0), beforeY);
});

test('landmark transforms rotate around their authored anchor and follow a fitted plane', () => {
  const point = transformLandmarkPoint(12, 3, 20, {
    originX: 10, originZ: 20,
    targetX: 100, targetZ: 200,
    rotation: Math.PI / 2,
    y: 5, slopeX: 0.1, slopeZ: 0.2,
  });
  assert.ok(Math.abs(point.x - 100) < 1e-9);
  assert.ok(Math.abs(point.z - 198) < 1e-9);
  assert.ok(Math.abs(point.y - 7.6) < 1e-9);
});

test('draped polygons and roads subdivide terrain spans to four metres', () => {
  const terrain = { heightAt: (x, z) => x * 0.01 + z * 0.02 };
  const polygonBatch = new Batch();
  addDrapedPolygon(() => polygonBatch, [[
    [0, 0], [16, 0], [16, 12], [0, 12], [0, 0],
  ]], terrain);
  const roadBatch = new Batch();
  addRoad(() => roadBatch, [[0, 0], [12, 0], [12, 9]], 2, terrain);
  const maxTriangleEdge = (positions) => {
    let max = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const points = [[positions[i], positions[i + 2]], [positions[i + 3], positions[i + 5]],
        [positions[i + 6], positions[i + 8]]];
      for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
        max = Math.max(max, Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]));
      }
    }
    return max;
  };
  assert.ok(maxTriangleEdge(polygonBatch.p) <= 4.01);
  assert.ok(maxTriangleEdge(roadBatch.p) <= 4.5);
  assert.ok(roadBatch.triangles > 10, 'bend fan and subdivided strips should both be present');
});

test('oriented roof bounds follow the dominant frontage edge', () => {
  const bounds = orientedBounds([[0, 0], [12, 12], [8, 16], [-4, 4], [0, 0]]);
  assert.ok(bounds);
  assert.ok(Math.abs(bounds.width - Math.hypot(12, 12)) < 0.01);
  assert.ok(Math.abs(bounds.depth - Math.hypot(4, 4)) < 0.01);
});

test('imported walls reach the ground at every corner of a sloping footprint', () => {
  /* 20 x 20 m footprint on a 1-in-5 slope. The foundation is sampled once at
   * the centre (y = 2), so a ground band clamped to it hangs two metres over
   * the downhill corner — on the committed map that left 428 of 2048
   * footprints floating by more than a metre. */
  const terrain = { heightAt: (x) => x * 0.2 };
  const ring = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]];
  const foundation = terrain.heightAt(10);

  const plain = new Batch();
  addFootprintWalls(() => plain, [ring], [['plain', foundation, foundation + 12]], terrain, { base: foundation });
  const lowest = (batch) => {
    let min = Infinity;
    for (let i = 1; i < batch.p.length; i += 3) min = Math.min(min, batch.p[i]);
    return min;
  };
  assert.equal(lowest(plain), terrain.heightAt(0));

  // Banded facades keep their flat break lines, but the ground band still
  // follows the terrain.
  const banded = new Batch();
  addFootprintWalls(() => banded, [ring], [
    ['shopfront', foundation, foundation + 4.2],
    ['pianoNobile', foundation + 4.2, foundation + 12],
  ], terrain, { base: foundation });
  assert.equal(lowest(banded), terrain.heightAt(0));
  const breaks = new Set();
  for (let i = 1; i < banded.p.length; i += 3) breaks.add(Math.round(banded.p[i] * 1000));
  assert.ok(breaks.has(Math.round((foundation + 4.2) * 1000)),
    'the band break stays level all the way round');

  // min_height lifts the whole shell without reintroducing the gap.
  const raised = new Batch();
  addFootprintWalls(() => raised, [ring], [['plain', foundation, foundation + 12]], terrain,
    { minHeight: 3, base: foundation });
  assert.equal(lowest(raised), terrain.heightAt(0) + 3);
});

test('facade rhythm is measured per building, not shared by the whole city', () => {
  // building:levels is tagged on two thirds of the stock, so most storey
  // heights are measured; the rest are hashed off the id and stay stable.
  const measured = facadeMetrics({ id: 'way/1', levels: 4 }, 15.2);
  assert.ok(Math.abs(measured.floor - 3.8) < 1e-9, 'four levels over 15.2 m is a 3.8 m storey');
  const tall = facadeMetrics({ id: 'way/1', levels: 6 }, 15.2);
  assert.ok(tall.floor < measured.floor, 'more levels in the same height means shorter storeys');

  const untagged = ['way/10', 'way/11', 'way/12', 'way/13', 'way/14', 'way/15']
    .map((id) => facadeMetrics({ id }, 14));
  assert.ok(new Set(untagged.map((m) => `${m.bay}|${m.floor}`)).size > 1,
    'untagged neighbours do not all land on one bay grid');
  for (const m of untagged) {
    assert.ok(m.floor >= 2.7 && m.floor <= 4.6, `storey ${m.floor} stays plausible`);
    assert.ok(m.bay >= 2.6 && m.bay <= 3.9, `bay ${m.bay} stays plausible`);
  }
  assert.deepEqual(facadeMetrics({ id: 'way/10' }, 14), untagged[0], 'deterministic per id');

  // A degenerate levels tag must not produce a nonsense storey height.
  assert.ok(facadeMetrics({ id: 'way/2', levels: 40 }, 6).floor >= 2.7);
});

test('ring inset mitres corners and collapses a rectangle to its ridge', () => {
  const square = [[0, 0], [20, 0], [20, 20], [0, 20], [0, 0]];
  const inset = insetRing(square, 4);
  assert.equal(inset.length, 5);
  for (const [x, z] of inset.slice(0, 4)) {
    assert.ok((Math.abs(x - 4) < 1e-6 || Math.abs(x - 16) < 1e-6)
      && (Math.abs(z - 4) < 1e-6 || Math.abs(z - 16) < 1e-6), `mitred corner ${x},${z}`);
  }
  // A 30 x 10 block inset by half its depth leaves a ridge line, not an area.
  const ridge = insetRing([[0, 0], [30, 0], [30, 10], [0, 10], [0, 0]], 5);
  for (const [, z] of ridge) assert.ok(Math.abs(z - 5) < 1e-6, 'ridge sits on the centre line');

  // Winding must not matter: the same plan traced clockwise insets inward too.
  const clockwise = insetRing([[0, 0], [0, 20], [20, 20], [20, 0], [0, 0]], 4);
  for (const [x, z] of clockwise.slice(0, 4)) {
    assert.ok(x >= 3.99 && x <= 16.01 && z >= 3.99 && z <= 16.01, `inward ${x},${z}`);
  }
});

test('footprint roofs cover L-shaped plans and refuse the ones they would break', () => {
  const height = 3;
  const top = 10;
  const ell = [[[0, 0], [24, 0], [24, 10], [10, 10], [10, 26], [0, 26], [0, 0]]];
  const roof = new Batch();
  assert.equal(addFootprintRoof(roof, ell, top, height), true,
    'an L-shape is exactly what the bounding-box fitters could not do');
  let lowest = Infinity; let highest = -Infinity;
  for (let i = 1; i < roof.p.length; i += 3) {
    lowest = Math.min(lowest, roof.p[i]); highest = Math.max(highest, roof.p[i]);
  }
  assert.equal(lowest, top, 'eaves sit on the wall head');
  assert.ok(Math.abs(highest - (top + height)) < 1e-6, 'ridge sits one roof height up');

  // Every ridge vertex has to stay over the footprint, or the roof overhangs
  // into the street.
  for (let i = 1; i < roof.p.length; i += 3) {
    if (roof.p[i] < top + height - 1e-6) continue;
    assert.ok(polygonContains(ell, roof.p[i - 1], roof.p[i + 1]),
      `ridge vertex ${roof.p[i - 1]},${roof.p[i + 1]} is over the plan`);
  }

  // A 3 m wide spur cannot carry a 3 m rise. It gets a shallower roof rather
  // than none — footprintRoofRise is what the caller uses to agree the wall
  // height with that up front.
  const sliver = [[[0, 0], [40, 0], [40, 3], [0, 3], [0, 0]]];
  assert.ok(footprintRoofRise(sliver, height) < height * 0.5,
    'a 3 m wide wing is not allowed a 3 m ridge');
  assert.ok(footprintRoofRise(ell, height) >= height - 1e-9,
    'a plan wide enough for the tagged rise keeps it');
  const shallow = new Batch();
  assert.equal(addFootprintRoof(shallow, sliver, top, footprintRoofRise(sliver, height)), true);
  let sliverRidge = -Infinity;
  for (let i = 1; i < shallow.p.length; i += 3) sliverRidge = Math.max(sliverRidge, shallow.p[i]);
  assert.ok(sliverRidge < top + height, 'and its ridge stays under the tagged height');

  // A plan too thin for any roof at all is refused, so the caller caps it flat.
  assert.equal(addFootprintRoof(new Batch(), [[[0, 0], [40, 0], [40, 0.6], [0, 0.6], [0, 0]]],
    top, 3), false);

  // Containment alone does not prove an offset is usable: a ring that swaps
  // vertex order builds overlapping shards with holes between them.
  assert.equal(ringSelfIntersects([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]), false);
  assert.equal(ringSelfIntersects([[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]), true);
});

test('a perimeter block is roofed round its courtyard, not over it', () => {
  // 60 x 40 m block built 13 m deep around a 34 x 14 yard: the shape most of
  // central Brno is made of.
  const block = [
    [[0, 0], [60, 0], [60, 40], [0, 40], [0, 0]],
    [[13, 13], [13, 27], [47, 27], [47, 13], [13, 13]],
  ];
  const solid = [block[0]];

  // Counting the yard as masonry says the block is 24 m thick and could carry
  // a ten-metre ridge. Measuring the built band gives a real wing depth.
  assert.ok(footprintRoofRise(solid, 20) > 9, 'the solid reading over-estimates');
  const rise = footprintRoofRise(block, 20);
  assert.ok(rise > 3 && rise < 6.5, `wing depth gives a plausible ridge, got ${rise}`);

  const roof = new Batch();
  assert.equal(addFootprintRoof(roof, block, 12, rise), true);

  /* No roof may span the yard: that was the regression. Vertices are allowed
   * on the yard wall — those are its eaves — so this tests triangle centres. */
  const yard = [block[1]];
  for (let i = 0; i < roof.p.length; i += 9) {
    const cx = (roof.p[i] + roof.p[i + 3] + roof.p[i + 6]) / 3;
    const cz = (roof.p[i + 2] + roof.p[i + 5] + roof.p[i + 8]) / 3;
    assert.equal(polygonContains(yard, cx, cz), false,
      `a roof triangle centred on ${cx.toFixed(1)},${cz.toFixed(1)} spans the courtyard`);
  }
  // And both walls carry eaves, so the yard side slopes too.
  let atEaves = 0;
  for (let i = 1; i < roof.p.length; i += 3) if (Math.abs(roof.p[i] - 12) < 1e-9) atEaves++;
  assert.ok(atEaves > 12, 'street wall and courtyard wall both spring from the wall head');
});

test('a straight bend contributes no joint geometry, a real corner does', () => {
  const terrain = { heightAt: () => 0 };
  const straight = new Batch();
  addRoad(() => straight, [[0, 0], [3, 0.01], [6, 0]], 8, terrain);
  const corner = new Batch();
  addRoad(() => corner, [[0, 0], [3, 0], [3, 3]], 8, terrain);
  assert.equal(straight.triangles, 4, 'two strip quads, no fan at a 0.4-degree kink');
  assert.ok(corner.triangles > 4, 'a right-angle bend still gets its wedge filled');
});

test('a rectangle traced with redundant nodes still reads as a rectangle', () => {
  // Same 20 x 8 m footprint, once with bare corners and once with the extra
  // wall-sharing nodes OSM footprints routinely carry.
  const bare = [[0, 0], [20, 0], [20, 8], [0, 8], [0, 0]];
  const traced = [[0, 0], [7, 0], [13, 0], [20, 0], [20, 5], [20, 8],
    [11, 8], [4, 8], [0, 8], [0, 4], [0, 0]];
  assert.deepEqual(simplifyRing(bare), bare);
  assert.equal(simplifyRing(traced).length, 5);
  assert.ok(Math.abs(orientedBounds(simplifyRing(traced)).width - 20) < 0.01);
  // A genuine corner survives: an L keeps all six of its own vertices.
  const ell = [[0, 0], [20, 0], [20, 8], [10, 8], [10, 16], [0, 16], [0, 0]];
  assert.equal(simplifyRing(ell).length, 7);
});

test('chooseStart validates its fallback when the square footprint is absent', () => {
  const buildings = [{
    polygons: [[[
      [-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5],
    ]]],
  }];
  const places = {
    svoboda: { x: 0, z: 0 },
    column: { x: 20, z: 20 },
    orloj: { x: -20, z: -20 },
  };
  const start = chooseStart([], buildings, [], places);
  assert.equal(start.clearance, 2.2);
  assert.notDeepEqual([start.x, start.z], [0, 0]);
});

test('projection helpers round-trip and importer output is deterministic', () => {
  const point = worldToGeo(map, 123.4, -87.6);
  const roundTrip = geoToWorld(map, point.lon, point.lat);
  assert.ok(Math.abs(roundTrip.x - 123.4) < 0.01);
  assert.ok(Math.abs(roundTrip.z + 87.6) < 0.01);
  assert.equal(quantize(1.234), 12);
  assert.equal(buildingHeight({ height: '999 m', 'building:levels': '4' }, 'way/1'), 12.8);
  assert.equal(buildingHeight({ height: '17.45 m' }, 'way/1'), 17.5);

  const fixture = {
    version: 0.6,
    osm3s: { timestamp_osm_base: '2026-07-30T07:34:01Z' },
    elements: [
      { type: 'node', id: 1, lat: 49.19465, lon: 16.60830 },
      { type: 'node', id: 2, lat: 49.19465, lon: 16.60855 },
      { type: 'node', id: 3, lat: 49.19483, lon: 16.60855 },
      { type: 'node', id: 4, lat: 49.19483, lon: 16.60830 },
      { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: {
        building: 'residential', 'building:levels': '4', 'roof:shape': 'gabled',
        'roof:height': '3.2', 'building:material': 'plaster', name: 'Fixture House',
      } },
      { type: 'node', id: 5, lat: 49.19469, lon: 16.60836 },
      { type: 'node', id: 6, lat: 49.19469, lon: 16.60849 },
      { type: 'node', id: 7, lat: 49.19479, lon: 16.60849 },
      { type: 'node', id: 8, lat: 49.19479, lon: 16.60836 },
      { type: 'way', id: 11, nodes: [5, 6, 7, 8, 5], tags: {
        'building:part': 'yes', height: '9.4', 'roof:shape': 'nonsense', 'roof:height': '999',
      } },
    ],
  };
  const a = normalizeOsm(fixture, '2026-07-30T07:34:01Z');
  const b = normalizeOsm(fixture, '2026-07-30T07:34:01Z');
  assert.deepEqual(a, b);
  assert.equal(a.schema, 2);
  assert.equal(a.buildings.length, 2);
  const parent = a.buildings.find((building) => building.id === 'way/10');
  const part = a.buildings.find((building) => building.id === 'way/11');
  assert.equal(parent.remainder, true);
  assert.equal(parent.levels, 4);
  assert.equal(parent.use, 'residential');
  assert.equal(parent.roof.shape, 'gabled');
  assert.equal(parent.roof.height, 3.2);
  assert.equal(parent.name, 'Fixture House');
  assert.equal(part.part, true);
  assert.equal(part.parentId, 'way/10');
  assert.equal(part.height, 9.4);
  assert.equal(part.roof.shape, null);
  assert.equal(part.roof.height, null);
  const resolvedAgain = resolveBuildingParts([parent, part]);
  assert.ok(resolvedAgain.some((building) => building.id === 'way/10'));
});
