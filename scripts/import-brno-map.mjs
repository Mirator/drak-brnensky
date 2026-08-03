import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import proj4 from 'proj4';
import osmtogeojson from 'osmtogeojson';
import polygonClipping from 'polygon-clipping';
import * as Lerc from 'lerc';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const MAP_PATH = path.join(DATA_DIR, 'brno-map.json');
const TERRAIN_PATH = path.join(DATA_DIR, 'brno-terrain.bin');
const LAYOUT_PATH = path.join(DATA_DIR, 'brno-layout.js');
const CHECKSUM_PATH = path.join(DATA_DIR, 'brno-checksums.json');
export const PINNED_SOURCE_DATE = '2026-07-30T07:34:01Z';

export const CONFIG = Object.freeze({
  version: 1,
  origin: { lat: 49.1947292, lon: 16.6084335, osmWay: 4934858 },
  size: 1500,
  half: 750,
  grid: 4,
  terrainScale: 0.05,
});

proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs');
const ORIGIN_UTM = proj4('EPSG:4326', 'EPSG:25833', [CONFIG.origin.lon, CONFIG.origin.lat]);
const CLIP_POLYGON = [[
  [-CONFIG.half, -CONFIG.half],
  [CONFIG.half, -CONFIG.half],
  [CONFIG.half, CONFIG.half],
  [-CONFIG.half, CONFIG.half],
  [-CONFIG.half, -CONFIG.half],
]];

const PLACE_SPECS = {
  svoboda: { name: 'nám. Svobody', id: 'way/4934858', match: /náměstí svobody/i, fallback: [16.6084335, 49.1947292] },
  zelnyTrh: { name: 'Zelný trh', id: 'way/8153695', match: /zelný trh/i, fallback: [16.6080, 49.19275] },
  radnice: { name: 'Stará radnice', id: 'way/50002035', match: /stará radnice/i, fallback: [16.60727, 49.19305] },
  petrov: { name: 'Petrov', id: 'relation/196180', match: /(katedrála.*petra.*pavla|petrov)/i, fallback: [16.60702, 49.19102] },
  spilberk: { name: 'Špilberk', id: 'relation/115794', match: /špilberk/i, fallback: [16.59925, 49.19448] },
  moravske: { name: 'Moravské nám.', id: 'relation/18387460', match: /moravské náměstí/i, fallback: [16.60732, 49.19837] },
  janacek: { name: 'Janáčkovo divadlo', id: 'way/16371579', match: /janáčkovo divadlo/i, fallback: [16.61312, 49.19823] },
  mahen: { name: 'Mahenovo divadlo', id: 'way/16371581', match: /mahenovo divadlo/i, fallback: [16.61205, 49.19672] },
  nadrazi: { name: 'Hlavní nádraží', id: 'way/27705873', match: /(brno hlavní nádraží|hlavní nádraží)/i, fallback: [16.61273, 49.19073] },
  ceska: { name: 'Česká', id: 'way/147777659', match: /^česká$/i, fallback: [16.60555, 49.19716] },
  column: { name: 'Mariánský sloup', id: 'way/249113470', match: /(mariánský|morový).*(sloup)|sloup.*(mariánský|morový)/i, fallback: [16.60831, 49.19524] },
  orloj: { name: 'Brněnský orloj', id: 'node/1052733045', match: /brněnský orloj/i, fallback: [16.6085914, 49.1947998] },
};

export function parseArgs(argv) {
  const out = {
    date: PINNED_SOURCE_DATE, osmFile: null, noTerrain: false, compactExisting: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-terrain') out.noTerrain = true;
    else if (arg === '--compact-existing') {
      out.compactExisting = true;
      out.noTerrain = true;
    }
    else if (arg.startsWith('--date=')) out.date = arg.slice(7);
    else if (arg === '--date') out.date = argv[++i];
    else if (arg.startsWith('--osm-file=')) out.osmFile = arg.slice(11);
    else if (arg === '--osm-file') out.osmFile = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.date && !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(out.date)) {
    throw new Error('--date must be YYYY-MM-DD or an ISO UTC timestamp');
  }
  if (out.date && out.date.length === 10) out.date += 'T23:59:59Z';
  return out;
}

function localPoint(lonLat) {
  const [e, n] = proj4('EPSG:4326', 'EPSG:25833', lonLat);
  return [e - ORIGIN_UTM[0], ORIGIN_UTM[1] - n];
}

export function quantize(value) {
  return Math.round(value * 10);
}

function cleanRing(ring) {
  const out = [];
  for (const p of ring) {
    const q = [quantize(p[0]), quantize(p[1])];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== q[0] || prev[1] !== q[1]) out.push(q);
  }
  if (out.length > 2) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([...a]);
  }
  return out.length >= 4 ? out : null;
}

function localPolygons(geometry) {
  if (!geometry || !/Polygon$/.test(geometry.type)) return [];
  const source = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const projected = source.map((poly) => poly.map((ring) => ring.map(localPoint)));
  let clipped;
  try {
    clipped = polygonClipping.intersection(projected, CLIP_POLYGON);
  } catch {
    return [];
  }
  return (clipped || []).map((poly) => poly.map(cleanRing).filter(Boolean)).filter((poly) => poly.length);
}

function outCode(x, z) {
  let code = 0;
  if (x < -CONFIG.half) code |= 1;
  else if (x > CONFIG.half) code |= 2;
  if (z < -CONFIG.half) code |= 4;
  else if (z > CONFIG.half) code |= 8;
  return code;
}

function clipSegment(a, b) {
  let [x0, z0] = a;
  let [x1, z1] = b;
  let c0 = outCode(x0, z0);
  let c1 = outCode(x1, z1);
  for (let guard = 0; guard < 10; guard++) {
    if (!(c0 | c1)) return [[x0, z0], [x1, z1]];
    if (c0 & c1) return null;
    const c = c0 || c1;
    let x;
    let z;
    if (c & 4) {
      z = -CONFIG.half;
      x = x0 + (x1 - x0) * ((z - z0) / (z1 - z0));
    } else if (c & 8) {
      z = CONFIG.half;
      x = x0 + (x1 - x0) * ((z - z0) / (z1 - z0));
    } else if (c & 2) {
      x = CONFIG.half;
      z = z0 + (z1 - z0) * ((x - x0) / (x1 - x0));
    } else {
      x = -CONFIG.half;
      z = z0 + (z1 - z0) * ((x - x0) / (x1 - x0));
    }
    if (c === c0) {
      x0 = x; z0 = z; c0 = outCode(x0, z0);
    } else {
      x1 = x; z1 = z; c1 = outCode(x1, z1);
    }
  }
  return null;
}

function localLines(geometry) {
  if (!geometry || !/LineString$/.test(geometry.type)) return [];
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  const result = [];
  for (const source of lines) {
    const points = source.map(localPoint);
    let current = [];
    for (let i = 1; i < points.length; i++) {
      const clipped = clipSegment(points[i - 1], points[i]);
      if (!clipped) {
        if (current.length > 1) result.push(current);
        current = [];
        continue;
      }
      const qa = clipped[0].map(quantize);
      const qb = clipped[1].map(quantize);
      const last = current[current.length - 1];
      if (!last || last[0] !== qa[0] || last[1] !== qa[1]) {
        if (current.length > 1) result.push(current);
        current = [qa];
      }
      current.push(qb);
    }
    if (current.length > 1) result.push(current);
  }
  return result;
}

function featureTags(feature) {
  return feature.properties?.tags || feature.properties || {};
}

function osmId(feature) {
  return String(feature.id || `${feature.properties?.type || 'feature'}/${feature.properties?.id || 0}`);
}

function numeric(value) {
  if (value === undefined || value === null) return null;
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function finiteTag(tags, key, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const value = numeric(tags[key]);
  if (value === null || value < min || value > max) return null;
  return integer ? Math.round(value) : Math.round(value * 10) / 10;
}

function textTag(tags, key) {
  const value = tags[key];
  return value === undefined || value === null || value === '' ? null : String(value);
}

function normalizedRoof(tags) {
  const supported = new Set(['flat', 'gabled', 'hipped', 'mansard', 'skillion', 'pyramidal']);
  const tagged = textTag(tags, 'roof:shape');
  const shape = supported.has(tagged) ? tagged : null;
  return {
    shape,
    height: finiteTag(tags, 'roof:height', { min: 0.2, max: 40 }),
    direction: finiteTag(tags, 'roof:direction', { min: 0, max: 360 }),
    angle: finiteTag(tags, 'roof:angle', { min: 5, max: 85 }),
    material: textTag(tags, 'roof:material'),
    colour: textTag(tags, 'roof:colour') || textTag(tags, 'roof:color'),
  };
}

export function buildingHeight(tags, id) {
  const explicit = numeric(tags.height);
  if (explicit !== null && explicit >= 2 && explicit <= 200) return Math.round(explicit * 10) / 10;
  const levels = numeric(tags['building:levels']);
  if (levels !== null && levels >= 1 && levels <= 50) return Math.round(levels * 32) / 10;
  let hash = 2166136261;
  for (const c of String(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const kind = tags.building || tags['building:part'] || 'yes';
  const base = /church|cathedral|castle|civic|public/.test(kind) ? 18 : /industrial|warehouse/.test(kind) ? 9 : 12;
  return base + (Math.abs(hash) % 6);
}

function roadWidth(tags) {
  const explicit = numeric(tags.width);
  if (explicit !== null && explicit > 0.5 && explicit < 80) return explicit;
  return {
    motorway: 18, trunk: 15, primary: 12, secondary: 10, tertiary: 9,
    residential: 7, living_street: 6, service: 5, pedestrian: 8,
    footway: 2.2, cycleway: 2.4, path: 1.5, steps: 2.4,
  }[tags.highway] || 5;
}

function polygonCentre(polygons) {
  const ring = polygons[0]?.[0];
  if (!ring?.length) return null;
  let sx = 0;
  let sz = 0;
  for (const p of ring) { sx += p[0]; sz += p[1]; }
  return [sx / ring.length, sz / ring.length];
}

function geometryCentre(feature) {
  const g = feature.geometry;
  if (!g) return null;
  if (g.type === 'Point') return localPoint(g.coordinates);
  if (/Polygon$/.test(g.type)) {
    const polys = localPolygons(g);
    const c = polygonCentre(polys);
    return c ? c.map((v) => v / 10) : null;
  }
  if (/LineString$/.test(g.type)) {
    const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    const line = lines[0];
    return line?.length ? localPoint(line[Math.floor(line.length / 2)]) : null;
  }
  return null;
}

function pointInRing(point, ring) {
  const x = point[0] * 10;
  const z = point[1] * 10;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const cross = ((a[1] > z) !== (b[1] > z))
      && x < ((b[0] - a[0]) * (z - a[1])) / ((b[1] - a[1]) || 1e-9) + a[0];
    if (cross) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  return pointInRing(point, polygon[0])
    && !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function segmentDistanceMetres(point, a, b) {
  const px = point[0] * 10;
  const pz = point[1] * 10;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / lengthSq)) : 0;
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz) / 10;
}

function lineDistance(point, features) {
  let best = Infinity;
  for (const feature of features) {
    const points = feature.points;
    for (let i = 1; i < points.length; i++) {
      best = Math.min(best, segmentDistanceMetres(point, points[i - 1], points[i]));
    }
  }
  return best;
}

export function chooseStart(areas, buildings, trams, places) {
  const square = areas.find((area) => area.id === `way/${CONFIG.origin.osmWay}`);
  const candidates = [];
  for (let z = -70; z <= 70; z++) {
    for (let x = -70; x <= 70; x++) candidates.push([x, z]);
  }
  candidates.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || a[1] - b[1] || a[0] - b[0]);
  for (const point of candidates) {
    const inStartArea = square
      ? square.polygons.some((polygon) => pointInPolygon(point, polygon))
      : Math.hypot(point[0] - places.svoboda.x, point[1] - places.svoboda.z) <= 30;
    if (!inStartArea) continue;
    if (lineDistance(point, trams) < 2.2) continue;
    if (Math.hypot(point[0] - places.column.x, point[1] - places.column.z) < 2.2) continue;
    if (Math.hypot(point[0] - places.orloj.x, point[1] - places.orloj.z) < 2.2) continue;
    if (buildings.some((building) => building.polygons.some((polygon) => pointInPolygon(point, polygon)))) continue;
    return { x: point[0], z: point[1], face: 'column', clearance: 2.2 };
  }
  throw new Error('Could not find a collision- and rail-safe start on Náměstí Svobody');
}

function normalizedBuilding(feature, tags) {
  const polygons = localPolygons(feature.geometry);
  if (!polygons.length) return null;
  const id = osmId(feature);
  const named = tags.name || '';
  const landmark = Object.entries(PLACE_SPECS)
    .find(([key, spec]) => key !== 'svoboda' && key !== 'column'
      && (spec.id === id || spec.match.test(named)))?.[0] || null;
  return {
    id,
    polygons,
    height: buildingHeight(tags, id),
    minHeight: Math.max(0, numeric(tags.min_height) || 0),
    levels: finiteTag(tags, 'building:levels', { min: 1, max: 50, integer: true }),
    use: textTag(tags, 'building') || textTag(tags, 'building:part') || 'yes',
    material: textTag(tags, 'building:material'),
    colour: textTag(tags, 'building:colour') || textTag(tags, 'building:color'),
    roof: normalizedRoof(tags),
    name: textTag(tags, 'name'),
    address: textTag(tags, 'addr:housenumber'),
    part: Boolean(tags['building:part']),
    parentId: null,
    landmark,
  };
}

function cleanQuantizedPolygons(polygons) {
  return (polygons || []).map((polygon) => polygon.map((ring) => {
    const out = [];
    for (const point of ring) {
      const q = [Math.round(point[0]), Math.round(point[1])];
      const previous = out[out.length - 1];
      if (!previous || previous[0] !== q[0] || previous[1] !== q[1]) out.push(q);
    }
    if (out.length > 2) {
      const first = out[0]; const last = out[out.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) out.push([...first]);
    }
    return out;
  }).filter((ring) => ring.length >= 4)).filter((polygon) => polygon.length);
}

/** Keep building parts and only remove their actual area from the parent shell. */
export function resolveBuildingParts(buildings) {
  const parents = buildings.filter((building) => !building.part);
  const parts = buildings.filter((building) => building.part);
  const byParent = new Map();
  for (const part of parts) {
    const centre = polygonCentre(part.polygons);
    if (!centre) continue;
    let owner = null;
    let ownerArea = Infinity;
    for (const parent of parents) {
      const outer = parent.polygons[0]?.[0];
      if (!outer || !pointInRing([centre[0] / 10, centre[1] / 10], outer)) continue;
      let area = 0;
      for (let i = 1; i < outer.length; i++) {
        area += outer[i - 1][0] * outer[i][1] - outer[i][0] * outer[i - 1][1];
      }
      area = Math.abs(area);
      if (area < ownerArea) { owner = parent; ownerArea = area; }
    }
    if (!owner) continue;
    part.parentId = owner.id;
    if (!byParent.has(owner.id)) byParent.set(owner.id, []);
    byParent.get(owner.id).push(part);
  }

  const resolved = [...parts];
  for (const parent of parents) {
    const children = byParent.get(parent.id) || [];
    if (!children.length) {
      resolved.push(parent);
      continue;
    }
    let remainder;
    try {
      remainder = polygonClipping.difference(parent.polygons, ...children.map((part) => part.polygons));
    } catch {
      remainder = parent.polygons;
    }
    const polygons = cleanQuantizedPolygons(remainder);
    if (polygons.length) resolved.push({ ...parent, polygons, remainder: true });
  }
  return resolved;
}

function areaKind(tags) {
  if (tags.natural === 'water' || tags.water || tags.waterway === 'riverbank') return 'water';
  if (tags.highway === 'pedestrian' || tags.place === 'square') return 'plaza';
  if (['park', 'garden', 'playground'].includes(tags.leisure)
      || ['grass', 'forest', 'recreation_ground', 'meadow'].includes(tags.landuse)
      || ['wood', 'grassland'].includes(tags.natural)) return 'park';
  return null;
}

export function normalizeOsm(osm, sourceDate = null) {
  const geojson = osmtogeojson(osm);
  const buildings = [];
  const roads = [];
  const trams = [];
  const tramStops = [];
  const areas = [];
  const candidates = [];

  for (const feature of geojson.features) {
    if (feature.properties?.tainted) continue;
    const tags = featureTags(feature);
    const name = tags.name || '';
    if (name) candidates.push({ feature, tags, name, position: geometryCentre(feature) });

    if ((tags.building || tags['building:part']) && /Polygon$/.test(feature.geometry?.type)) {
      const building = normalizedBuilding(feature, tags);
      if (building) buildings.push(building);
    }
    if (tags.highway && /LineString$/.test(feature.geometry?.type)) {
      for (const points of localLines(feature.geometry)) {
        roads.push({
          id: osmId(feature),
          points,
          kind: tags.highway,
          name: name || null,
          width: roadWidth(tags),
          surface: textTag(tags, 'surface'),
          lanes: finiteTag(tags, 'lanes', { min: 1, max: 20, integer: true }),
          sidewalk: textTag(tags, 'sidewalk'),
          bridge: textTag(tags, 'bridge'),
          tunnel: textTag(tags, 'tunnel'),
        });
      }
    }
    if (tags.railway === 'tram' && /LineString$/.test(feature.geometry?.type)) {
      for (const points of localLines(feature.geometry)) {
        trams.push({ id: osmId(feature), points, name: name || null });
      }
    }
    if (feature.geometry?.type === 'Point'
        && (tags.railway === 'tram_stop' || tags.tram === 'yes'
          || (tags.public_transport === 'platform' && tags.bus !== 'yes'))) {
      const position = geometryCentre(feature);
      if (position) tramStops.push({
        id: osmId(feature), name: name || null,
        x: Math.round(position[0] * 10) / 10,
        z: Math.round(position[1] * 10) / 10,
      });
    }
    const kind = areaKind(tags);
    if (kind && /Polygon$/.test(feature.geometry?.type)) {
      const polygons = localPolygons(feature.geometry);
      if (polygons.length) areas.push({
        id: osmId(feature), kind, name: name || null,
        surface: textTag(tags, 'surface'), polygons,
      });
    }
  }

  const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const stable = (a, b) => compareStrings(a.id, b.id)
    || compareStrings(JSON.stringify(a.points || a.polygons), JSON.stringify(b.points || b.polygons));
  const filteredBuildings = resolveBuildingParts(buildings).sort(stable);
  roads.sort(stable);
  trams.sort(stable);
  tramStops.sort((a, b) => compareStrings(a.id, b.id));
  areas.sort(stable);
  candidates.sort((a, b) => compareStrings(osmId(a.feature), osmId(b.feature)));
  const places = {};
  for (const [key, spec] of Object.entries(PLACE_SPECS)) {
    const match = candidates.find((c) => osmId(c.feature) === spec.id && c.position)
      || candidates.find((c) => spec.match.test(c.name) && c.position);
    const p = match?.position || localPoint(spec.fallback);
    places[key] = {
      name: spec.name,
      x: Math.round(p[0] * 10) / 10,
      z: Math.round(p[1] * 10) / 10,
      osmId: match ? osmId(match.feature) : null,
      fallback: !match,
    };
  }

  const start = chooseStart(areas, filteredBuildings, trams, places);
  return {
    schema: 2,
    metadata: {
      name: 'Central Brno',
      generatedAt: sourceDate || osm.osm3s?.timestamp_osm_base || null,
      sourceDate: sourceDate || osm.osm3s?.timestamp_osm_base || null,
      origin: { ...CONFIG.origin, easting: ORIGIN_UTM[0], northing: ORIGIN_UTM[1] },
      bounds: { minX: -CONFIG.half, minZ: -CONFIG.half, maxX: CONFIG.half, maxZ: CONFIG.half },
      size: CONFIG.size,
      gridResolution: 2,
      coordinates: '+x east, +z south, +y up; metres',
      attribution: {
        text: 'Map data © OpenStreetMap contributors, ODbL 1.0',
        url: 'https://www.openstreetmap.org/copyright',
        license: 'ODbL-1.0',
      },
    },
    start,
    places,
    roads,
    trams,
    tramStops,
    areas,
    buildings: filteredBuildings,
  };
}

function bboxDegrees() {
  const nw = proj4('EPSG:25833', 'EPSG:4326', [ORIGIN_UTM[0] - CONFIG.half, ORIGIN_UTM[1] + CONFIG.half]);
  const se = proj4('EPSG:25833', 'EPSG:4326', [ORIGIN_UTM[0] + CONFIG.half, ORIGIN_UTM[1] - CONFIG.half]);
  return { south: se[1], west: nw[0], north: nw[1], east: se[0] };
}

function overpassQuery(date) {
  const b = bboxDegrees();
  const when = date ? `[date:"${date}"]` : '';
  return `[out:json][timeout:180]${when}[bbox:${b.south},${b.west},${b.north},${b.east}];
(
  nwr["building"];
  nwr["building:part"];
  way["highway"];
  way["railway"="tram"];
  nwr["landuse"];
  nwr["leisure"];
  nwr["natural"];
  nwr["water"];
  nwr["waterway"];
  nwr["place"];
  nwr["historic"];
  nwr["tourism"];
  nwr["amenity"];
  nwr["public_transport"];
);
out geom;`;
}

async function fetchWithRetry(url, options = {}, attempts = 4) {
  let error;
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'drak-brnensky-map-import/1.0',
          ...(options.headers || {}),
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      return response;
    } catch (e) {
      error = e;
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
    }
  }
  throw error;
}

async function fetchOsm(date) {
  const body = new URLSearchParams({ data: overpassQuery(date) });
  const response = await fetchWithRetry('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body,
  });
  return response.json();
}

async function fetchTerrain() {
  const width = CONFIG.size / CONFIG.grid + 1;
  const bbox = [
    ORIGIN_UTM[0] - CONFIG.half,
    ORIGIN_UTM[1] - CONFIG.half,
    ORIGIN_UTM[0] + CONFIG.half,
    ORIGIN_UTM[1] + CONFIG.half,
  ].join(',');
  const params = new URLSearchParams({
    f: 'json',
    bbox,
    bboxSR: '25833',
    imageSR: '25833',
    size: `${width},${width}`,
    format: 'lerc',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
  });
  const endpoint = 'https://ags.cuzk.gov.cz/arcgis/rest/services/3D/dmr5g_wm/ImageServer/exportImage';
  const info = await fetchWithRetry(`${endpoint}?${params}`).then((r) => r.json());
  if (!info.href) throw new Error(`ČÚZK export failed: ${JSON.stringify(info)}`);
  const encoded = await fetchWithRetry(info.href).then((r) => r.arrayBuffer());
  await Lerc.load();
  const decoded = Lerc.decode(encoded);
  const pixels = decoded.pixels[0];
  if (decoded.width !== width || decoded.height !== width) {
    throw new Error(`Terrain dimensions ${decoded.width}x${decoded.height}, expected ${width}x${width}`);
  }
  const centre = Math.floor(width / 2) * width + Math.floor(width / 2);
  const datum = pixels[centre];
  if (!Number.isFinite(datum)) throw new Error('Terrain datum is invalid');

  const header = 32;
  const buffer = Buffer.alloc(header + pixels.length * 2);
  buffer.write('BRNOHT1\0', 0, 'ascii');
  buffer.writeUInt16LE(width, 8);
  buffer.writeUInt16LE(width, 10);
  buffer.writeFloatLE(CONFIG.grid, 12);
  buffer.writeFloatLE(-CONFIG.half, 16);
  buffer.writeFloatLE(-CONFIG.half, 20);
  buffer.writeFloatLE(datum, 24);
  buffer.writeFloatLE(CONFIG.terrainScale, 28);
  for (let i = 0; i < pixels.length; i++) {
    const value = Number.isFinite(pixels[i]) ? pixels[i] : datum;
    const q = Math.max(-32768, Math.min(32767, Math.round((value - datum) / CONFIG.terrainScale)));
    buffer.writeInt16LE(q, header + i * 2);
  }
  return {
    buffer,
    metadata: {
      schema: 1,
      width,
      height: width,
      cellSize: CONFIG.grid,
      sampleScale: CONFIG.terrainScale,
      verticalDatum: datum,
      sourceResolution: 2,
      source: 'ČÚZK DMR 5G',
      attribution: {
        text: 'Terrain derived from DMR 5G © ČÚZK, CC BY 4.0',
        url: 'https://geoportal.cuzk.gov.cz/',
        license: 'CC-BY-4.0',
      },
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let existingMap = null;
  let previousTerrain = null;
  if (args.noTerrain) {
    try {
      existingMap = JSON.parse(await fs.readFile(MAP_PATH, 'utf8'));
      previousTerrain = existingMap.terrain || null;
    } catch {
      // First import has nothing to preserve; the validation below is explicit.
    }
  }
  let map;
  if (args.compactExisting) {
    if (!existingMap) throw new Error('--compact-existing requires an existing map artifact');
    if (existingMap.schema !== 2) {
      throw new Error('--compact-existing requires a schema 2 map; run a normal import first');
    }
    map = existingMap;
  } else {
    const osm = args.osmFile
      ? JSON.parse(await fs.readFile(path.resolve(args.osmFile), 'utf8'))
      : await fetchOsm(args.date);
    map = normalizeOsm(osm, args.date);
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!args.noTerrain) {
    const terrain = await fetchTerrain();
    map.terrain = terrain.metadata;
    await fs.writeFile(TERRAIN_PATH, terrain.buffer);
  } else if (previousTerrain) {
    map.terrain = previousTerrain;
  } else {
    throw new Error('--no-terrain requires an existing map artifact with terrain metadata');
  }
  const mapSource = `${JSON.stringify(map)}\n`;
  await fs.writeFile(MAP_PATH, mapSource);
  const layoutSource = `// Generated by scripts/import-brno-map.mjs. Do not edit by hand.
export const BRNO_MAP_SIZE = ${CONFIG.size};
export const BRNO_ORIGIN = ${JSON.stringify(map.metadata.origin)};
export const BRNO_PLACES = ${JSON.stringify(map.places, null, 2)};
export const BRNO_START = ${JSON.stringify(map.start)};
`;
  await fs.writeFile(LAYOUT_PATH, layoutSource);
  const terrainBuffer = await fs.readFile(TERRAIN_PATH);
  const sha256 = (value) => createHash('sha256').update(value).digest('hex');
  await fs.writeFile(CHECKSUM_PATH, `${JSON.stringify({
    schema: 1,
    sourceDate: map.metadata.sourceDate,
    sha256: {
      'brno-map.json': sha256(mapSource),
      'brno-terrain.bin': sha256(terrainBuffer),
    },
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    map: path.relative(ROOT, MAP_PATH),
    terrain: args.noTerrain ? 'unchanged' : path.relative(ROOT, TERRAIN_PATH),
    sourceDate: map.metadata.sourceDate,
    buildings: map.buildings.length,
    roads: map.roads.length,
    trams: map.trams.length,
    areas: map.areas.length,
    places: map.places,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
