import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingHeight, normalizeOsm, quantize } from '../scripts/import-brno-map.mjs';
import { decodeTerrain, Heightfield, geoToWorld, worldToGeo } from '../src/city/data.js';
import { NavigationField, polygonContains } from '../src/city/imported.js';
import { CollisionWorld } from '../src/physics.js';

const map = JSON.parse(fs.readFileSync(new URL('../src/data/brno-map.json', import.meta.url), 'utf8'));

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
  assert.ok(map.buildings.filter((building) => building.landmark).length >= 7,
    'hand-modelled landmark footprints are marked for runtime exclusion');
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
      { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes' } },
      { type: 'node', id: 5, lat: 49.19469, lon: 16.60836 },
      { type: 'node', id: 6, lat: 49.19469, lon: 16.60849 },
      { type: 'node', id: 7, lat: 49.19479, lon: 16.60849 },
      { type: 'node', id: 8, lat: 49.19479, lon: 16.60836 },
      { type: 'way', id: 11, nodes: [5, 6, 7, 8, 5], tags: { 'building:part': 'yes', height: '9.4' } },
    ],
  };
  const a = normalizeOsm(fixture, '2026-07-30T07:34:01Z');
  const b = normalizeOsm(fixture, '2026-07-30T07:34:01Z');
  assert.deepEqual(a, b);
  assert.equal(a.buildings.length, 1);
  assert.equal(a.buildings[0].part, true);
  assert.equal(a.buildings[0].height, 9.4);
});
