const MAP_URL = new URL('../data/brno-map.json', import.meta.url);
const TERRAIN_URL = new URL('../data/brno-terrain.bin', import.meta.url);

let cached = null;

export class Heightfield {
  constructor({ width, height, cellSize, minX, minZ, verticalDatum, scale, samples }) {
    this.width = width;
    this.height = height;
    this.cellSize = cellSize;
    this.minX = minX;
    this.minZ = minZ;
    this.maxX = minX + (width - 1) * cellSize;
    this.maxZ = minZ + (height - 1) * cellSize;
    this.verticalDatum = verticalDatum;
    this.scale = scale;
    this.samples = samples;
    let minSample = Infinity;
    let maxSample = -Infinity;
    for (let i = 0; i < samples.length; i++) {
      minSample = Math.min(minSample, samples[i]);
      maxSample = Math.max(maxSample, samples[i]);
    }
    this.minHeight = minSample * scale;
    this.maxHeight = maxSample * scale;
  }

  contains(x, z) {
    return x >= this.minX && z >= this.minZ && x <= this.maxX && z <= this.maxZ;
  }

  sampleIndex(ix, iz) {
    const x = Math.max(0, Math.min(this.width - 1, ix));
    const z = Math.max(0, Math.min(this.height - 1, iz));
    return this.samples[z * this.width + x] * this.scale;
  }

  heightAt(x, z) {
    const gx = Math.max(0, Math.min(this.width - 1, (x - this.minX) / this.cellSize));
    const gz = Math.max(0, Math.min(this.height - 1, (z - this.minZ) / this.cellSize));
    const x0 = Math.min(this.width - 2, Math.floor(gx));
    const z0 = Math.min(this.height - 2, Math.floor(gz));
    const tx = gx - x0;
    const tz = gz - z0;
    const a = this.sampleIndex(x0, z0);
    const b = this.sampleIndex(x0 + 1, z0);
    const c = this.sampleIndex(x0, z0 + 1);
    const d = this.sampleIndex(x0 + 1, z0 + 1);
    const ab = a + (b - a) * tx;
    const cd = c + (d - c) * tx;
    return ab + (cd - ab) * tz;
  }

  absoluteHeightAt(x, z) {
    return this.verticalDatum + this.heightAt(x, z);
  }

  slopeAt(x, z) {
    const s = this.cellSize;
    const dx = (this.heightAt(x + s, z) - this.heightAt(x - s, z)) / (s * 2);
    const dz = (this.heightAt(x, z + s) - this.heightAt(x, z - s)) / (s * 2);
    return Math.atan(Math.hypot(dx, dz));
  }

  normalAt(x, z, out) {
    const s = this.cellSize;
    const dx = this.heightAt(x + s, z) - this.heightAt(x - s, z);
    const dz = this.heightAt(x, z + s) - this.heightAt(x, z - s);
    const nx = -dx; const ny = s * 2; const nz = -dz;
    if (out) return out.set(nx, ny, nz).normalize();
    const length = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / length, y: ny / length, z: nz / length };
  }
}

export function decodeTerrain(buffer) {
  const view = new DataView(buffer);
  let magic = '';
  for (let i = 0; i < 7; i++) magic += String.fromCharCode(view.getUint8(i));
  if (magic !== 'BRNOHT1') throw new Error(`Unsupported terrain data: ${magic}`);
  const width = view.getUint16(8, true);
  const height = view.getUint16(10, true);
  const cellSize = view.getFloat32(12, true);
  const minX = view.getFloat32(16, true);
  const minZ = view.getFloat32(20, true);
  const verticalDatum = view.getFloat32(24, true);
  const scale = view.getFloat32(28, true);
  const expected = 32 + width * height * 2;
  if (buffer.byteLength !== expected) {
    throw new Error(`Terrain byte length ${buffer.byteLength}, expected ${expected}`);
  }
  const samples = new Int16Array(width * height);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(32 + i * 2, true);
  return new Heightfield({ width, height, cellSize, minX, minZ, verticalDatum, scale, samples });
}

async function checked(response, label) {
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${response.statusText}`);
  return response;
}

export async function loadBrnoData() {
  if (!cached) {
    cached = Promise.all([
      fetch(MAP_URL).then((r) => checked(r, 'Brno map')).then((r) => r.json()),
      fetch(TERRAIN_URL).then((r) => checked(r, 'Brno terrain')).then((r) => r.arrayBuffer()),
    ])
      .then(([map, terrain]) => ({ map, terrain: decodeTerrain(terrain) }))
      .catch((error) => {
        cached = null;
        throw error;
      });
  }
  return cached;
}

export function worldToGeo(map, x, z) {
  const { lat, lon } = map.metadata.origin;
  return {
    lat: lat - z / 111132,
    lon: lon + x / (111320 * Math.cos((lat * Math.PI) / 180)),
  };
}

export function geoToWorld(map, lon, lat) {
  const origin = map.metadata.origin;
  return {
    x: (lon - origin.lon) * 111320 * Math.cos((origin.lat * Math.PI) / 180),
    z: (origin.lat - lat) * 111132,
  };
}
