/**
 * Shared tileable noise primitives, seeded through the project's
 * deterministic Rng so every generated texture is reproducible from a seed
 * (same contract as city generation — see `Rng` in src/rng.js).
 *
 * All samplers are periodic: sample(u, v) tiles seamlessly as u/v cross
 * integer boundaries, which is what lets a 256px canvas repeat across a
 * whole facade without a visible seam.
 */

/** Bilinear-interpolated value noise on an n×n lattice. sample(u, v) wraps
 * modulo n, so pass u/v already scaled to the lattice's frequency. */
export function makeValueNoise(rng, cells = 8) {
  const n = Math.max(2, Math.round(cells));
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = rng.next();
  const at = (x, y) => {
    const xi = ((x % n) + n) % n;
    const yi = ((y % n) + n) % n;
    return grid[yi * n + xi];
  };
  return function sample(u, v) {
    const x0 = Math.floor(u), y0 = Math.floor(v);
    const fx = u - x0, fy = v - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bot * sy;
  };
}

/** Tileable fractal Brownian motion. sample(u, v) with u, v in [0, 1).
 * Returns a value roughly in [0, 1]. */
export function makeFbm(rng, { cells = 4, octaves = 4, lacunarity = 2, gain = 0.5 } = {}) {
  const layers = [];
  let freq = cells;
  for (let o = 0; o < octaves; o++) {
    layers.push({ sample: makeValueNoise(rng, freq), freq });
    freq *= lacunarity;
  }
  return function sample(u, v) {
    let amp = 1, sum = 0, norm = 0;
    for (const layer of layers) {
      sum += layer.sample(u * layer.freq, v * layer.freq) * amp;
      norm += amp;
      amp *= gain;
    }
    return norm > 0 ? sum / norm : 0;
  };
}

/** Tileable Worley / cellular noise on an n×n jittered grid. sample(u, v)
 * with u, v in [0, 1) returns { f1, f2 } — distances in cell units to the
 * nearest and second-nearest feature point. Only the 3×3 neighbourhood of
 * the sample's own cell is checked, so cost is O(1) per sample regardless
 * of grid size. Good for granite setts, stone blotching, crack seeding. */
export function makeWorley(rng, cellsPerSide = 6) {
  const n = Math.max(2, Math.round(cellsPerSide));
  const pts = [];
  for (let gy = 0; gy < n; gy++) {
    const row = [];
    for (let gx = 0; gx < n; gx++) row.push([rng.float(0.15, 0.85), rng.float(0.15, 0.85)]);
    pts.push(row);
  }
  return function sample(u, v) {
    u = ((u % n) + n) % n;
    v = ((v % n) + n) % n;
    const cx = Math.floor(u), cy = Math.floor(v);
    let best = Infinity, second = Infinity, bestCell = [0, 0];
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const gx = ((cx + ox) % n + n) % n;
        const gy = ((cy + oy) % n + n) % n;
        const [jx, jy] = pts[gy][gx];
        const wx = (cx + ox) + jx;
        const wy = (cy + oy) + jy;
        const dx = u - wx, dy = v - wy;
        const d = dx * dx + dy * dy;
        if (d < best) { second = best; best = d; bestCell = [gx, gy]; }
        else if (d < second) second = d;
      }
    }
    return { f1: Math.sqrt(best), f2: Math.sqrt(second), cell: bestCell };
  };
}
