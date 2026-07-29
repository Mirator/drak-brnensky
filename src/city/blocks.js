import {
  HALF, GRID_RES, GN, FLAG, ROADS, PLAZAS, segments, inCore,
} from './layout.js';
import { frontageOffset } from './plan.js';

/**
 * Block and plot subdivision.
 *
 * The old core did not grow as free-standing boxes on a street line: it grew
 * as blocks cut into medieval plots of 8–14 m frontage, each plot carrying
 * one house that shares party walls with its neighbours. That is what this
 * module produces — contiguous runs of narrow houses along every frontage,
 * each with its own eaves height (neighbours differ by 0.5–2 m), storey
 * count, plaster colour, roof ridge direction and rear courtyard wing.
 *
 * Everything is seeded from the injected Rng: the same seed always yields
 * the same plots in the same order.
 */

/** Grid occupancy over the rotated footprint of a house — exact, not an AABB. */
function forRotRect(cx, cz, w, d, rot, margin, fn) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = w / 2 + margin, hd = d / 2 + margin;
  const ex = Math.abs(c) * hw + Math.abs(s) * hd;
  const ez = Math.abs(s) * hw + Math.abs(c) * hd;
  const gx0 = Math.floor((cx - ex + HALF) / GRID_RES);
  const gx1 = Math.ceil((cx + ex + HALF) / GRID_RES);
  const gz0 = Math.floor((cz - ez + HALF) / GRID_RES);
  const gz1 = Math.ceil((cz + ez + HALF) / GRID_RES);
  if (gx0 < 1 || gz0 < 1 || gx1 >= GN - 1 || gz1 >= GN - 1) return false;
  for (let gz = gz0; gz <= gz1; gz++) {
    const wz = gz * GRID_RES - HALF + GRID_RES / 2;
    for (let gx = gx0; gx <= gx1; gx++) {
      const wx = gx * GRID_RES - HALF + GRID_RES / 2;
      const dx = wx - cx, dz = wz - cz;
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
      if (fn(gz * GN + gx) === false) return false;
    }
  }
  return true;
}

/**
 * SAT test: a Y-rotated rect against an axis-aligned rect, with the rotated
 * one inflated by `margin`. Used to keep every house clear of the landmark
 * reservations analytically rather than trusting grid quantisation — that
 * overlap has regressed once already.
 */
export function rotRectHitsRect(cx, cz, w, d, rot, rx, rz, rw, rd, margin = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const u = [c, -s];
  const v = [s, c];
  const hw = w / 2 + margin, hd = d / 2 + margin;
  const rhw = rw / 2, rhd = rd / 2;
  const dx = rx - cx, dz = rz - cz;
  for (const n of [u, v, AXIS_X, AXIS_Z]) {
    const rA = hw * Math.abs(n[0] * u[0] + n[1] * u[1]) + hd * Math.abs(n[0] * v[0] + n[1] * v[1]);
    const rB = rhw * Math.abs(n[0]) + rhd * Math.abs(n[1]);
    if (Math.abs(dx * n[0] + dz * n[1]) > rA + rB) return false;
  }
  return true;
}

const AXIS_X = [1, 0];
const AXIS_Z = [0, 1];

const SHRINKS = [1, 0.78, 0.58];

const CORE_EAVES = [11.5, 21];
const OUTER_EAVES = [12, 30];
const RIM_EAVES = [22, 46];

/** One house's vertical rhythm — taller parter, piano nobile, diminishing uppers. */
function storeyStack(rng, floors, { commercial }) {
  const out = [];
  out.push(commercial
    ? { kind: 'shopfront', h: rng.float(3.8, 4.5) }
    : { kind: 'plain', h: rng.float(3.5, 4.0) });
  if (floors >= 5 && rng.chance(0.3)) out.push({ kind: 'plain', h: rng.float(2.4, 2.8) });
  if (out.length < floors) out.push({ kind: 'pianoNobile', h: rng.float(3.4, 4.0) });
  let h = rng.float(3.1, 3.4);
  while (out.length < floors - 1) {
    out.push({ kind: 'plain', h });
    h = Math.max(2.85, h - rng.float(0.04, 0.18));
  }
  if (out.length < floors) out.push({ kind: 'attic', h: rng.float(2.6, 3.0) });
  return out;
}

function makeHouse(rng, { eaves, commercial, core, shabbyChance, shopChance }) {
  const floors = Math.max(2, Math.min(9, Math.round(eaves / (core ? 3.55 : 3.5))));
  const stack = storeyStack(rng, floors, { commercial });
  let sum = 0;
  for (const s of stack) sum += s.h;
  const scale = eaves / sum;
  for (const s of stack) s.h *= scale;
  return {
    storeys: stack,
    eaves,
    style: 0,
    shabby: rng.chance(shabbyChance),
    shop: commercial && rng.chance(shopChance),
    signIndex: rng.int(0, 999),
    roofKind: core
      ? (rng.chance(0.76) ? 'clay' : (rng.chance(0.6) ? 'slate' : 'copper'))
      : (rng.chance(0.42) ? 'clay' : (rng.chance(0.5) ? 'slate' : 'seam')),
    pitched: true,
    ridgeAlongStreet: rng.chance(0.79),
    pitch: rng.float(0.72, 0.95), // tan of the roof angle (36-44 deg)
    corniceRich: rng.chance(0.55),
    dormers: rng.int(0, 3),
    chimneys: rng.int(1, 3),
  };
}


/**
 * Every frontage line in the city, as a straight segment plus which side of
 * it the houses stand on.
 *
 * Streets contribute both sides. The paved squares contribute their four
 * edges, with the houses outside facing in — without that the squares are
 * just holes in the plan, and nam. Svobody in particular needs a real
 * enclosing street wall.
 */
function frontageLines() {
  const out = [];
  for (const road of ROADS) {
    const front = frontageOffset(road) + 0.4;
    for (const seg of segments(road.pts)) {
      for (const side of [1, -1]) {
        out.push({
          seg, side, front, road,
          shopChance: road.shops ?? 0.15,
          shabbyChance: road.shabby ?? 0.08,
        });
      }
    }
  }
  for (const p of PLAZAS) {
    if (p.type !== FLAG.PLAZA) continue;
    const [cx, cz, w, d] = p.r;
    const hw = w / 2, hd = d / 2;
    // tangent chosen so the left normal (-tz, tx) points out of the square
    const edges = [
      [cx + hw, cz - hd, -1, 0, w],   // north edge, walk -x
      [cx - hw, cz + hd, 1, 0, w],    // south edge, walk +x
      [cx - hw, cz - hd, 0, 1, d],    // west edge, walk +z
      [cx + hw, cz + hd, 0, -1, d],   // east edge, walk -z
    ];
    for (const [ax, az, tx, tz, len] of edges) {
      out.push({
        seg: {
          ax, az, bx: ax + tx * len, bz: az + tz * len, len,
          tx, tz, nx: -tz, nz: tx, rot: Math.atan2(-tz, tx),
        },
        side: 1,
        front: 1.4,
        road: { name: p.name, w: 0, shops: 0.85, shabby: 0.05 },
        shopChance: 0.85,
        shabbyChance: 0.05,
      });
    }
  }
  return out;
}

/**
 * Generate every plot in the city.
 *
 * @returns {{plots: object[], buildings: object[]}}
 */
export function generatePlots(rng, { flags, footprints }) {
  const occupied = new Uint8Array(GN * GN);
  const reserved = [];
  for (const fp of footprints) for (const r of fp.rects) reserved.push(r);

  const free = (cx, cz, w, d, rot) => {
    let ok = true;
    const inside = forRotRect(cx, cz, w, d, rot, 0, (i) => {
      if (occupied[i] || flags[i] !== FLAG.FREE) { ok = false; return false; }
      return true;
    });
    if (!inside || !ok) return false;
    for (const [rx, rz, rw, rd] of reserved) {
      if (rotRectHitsRect(cx, cz, w, d, rot, rx, rz, rw, rd, 1.5)) return false;
    }
    return true;
  };
  const claim = (cx, cz, w, d, rot) => {
    forRotRect(cx, cz, w, d, rot, 0, (i) => { occupied[i] = 1; return true; });
  };

  const plots = [];
  const debug = { lines: 0, tries: 0, rejected: 0, frontage: 0, wings: 0, scatter: 0 };

  /* ---------- 1. frontages, subdivided into plots ---------- */
  for (const line of frontageLines()) {
    const { seg, side, front, shopChance, shabbyChance, road } = line;
    debug.lines++;
    const rot = seg.rot + (side < 0 ? Math.PI : 0);
    let eaves = null;
    let prevStyle = -1;
    let prevIndex = -1;
    let gapBefore = true;
    let t = rng.float(0.5, 3.5);
    let guard = 0;
    while (t < seg.len - 5 && guard++ < 400) {
      const core = inCore(
        seg.ax + seg.tx * t + seg.nx * side * front,
        seg.az + seg.tz * t + seg.nz * side * front,
      );
      const rim = Math.max(
        Math.abs(seg.ax + seg.tx * t), Math.abs(seg.az + seg.tz * t),
      ) > 300;
      const fullWidth = core ? rng.float(8, 14) : rng.float(10, 18);
      const depth = core ? rng.float(15, 27) : rng.float(16, 31);
      const fullDepth = Math.min(depth, core ? rng.float(11, 16) : rng.float(12, 19));
      const range = rim ? RIM_EAVES : core ? CORE_EAVES : OUTER_EAVES;
      if (eaves === null) eaves = rng.float(range[0] + 1, range[1] - 2);
      // neighbouring eaves differ by 0.5-2 m — the single loudest cue
      // that a street wall is real rather than extruded in one go
      eaves = Math.max(range[0], Math.min(range[1],
        eaves + rng.sign() * rng.float(0.6, 2.0)));

      /* Brno's streets run close together and cross constantly, so a full
       * 14 x 16 m plot often will not fit. Rather than leave a hole in the
       * street wall, try progressively shallower and narrower plots — a
       * 9 x 8 m house closing the gap beats a gap. */
      debug.tries++;
      let fw = 0;
      let frontDepth = 0;
      let cx = 0;
      let cz = 0;
      let fits = false;
      for (const shrink of SHRINKS) {
        fw = fullWidth * (shrink === 1 ? 1 : 0.86);
        frontDepth = Math.max(7, fullDepth * shrink);
        cx = seg.ax + seg.tx * (t + fw / 2) + seg.nx * side * (front + frontDepth / 2);
        cz = seg.az + seg.tz * (t + fw / 2) + seg.nz * side * (front + frontDepth / 2);
        if (free(cx, cz, fw, frontDepth, rot)) { fits = true; break; }
      }
      if (!fits) {
        debug.rejected++;
        t += 2.5;
        gapBefore = true;
        continue;
      }
      claim(cx, cz, fw, frontDepth, rot);

      const house = makeHouse(rng, {
        eaves, commercial: core || (road.shops ?? 0) > 0.3, core,
        shabbyChance, shopChance,
      });
      let style = rng.int(0, 5);
      if (style === prevStyle) style = (style + 1 + rng.int(0, 3)) % 6;
      prevStyle = style;
      house.style = style;
      const plot = {
        ...house,
        x: cx, z: cz, w: fw, d: frontDepth, rot,
        road, side, frontage: true,
        neighbourLeft: false, neighbourRight: false,
        wing: null,
      };

      /* rear courtyard wing: narrower, lower, leaves a real courtyard */
      const rest = depth - frontDepth;
      if (rest > 8 && rng.chance(0.58)) {
        const ww = fw * rng.float(0.5, 0.78);
        const wd = Math.min(rest - 2, rng.float(8, 18));
        const lateral = (fw - ww) / 2 * rng.sign() * rng.float(0.4, 1);
        const wx = cx + seg.tx * side * lateral + seg.nx * side * (frontDepth / 2 + wd / 2);
        const wz = cz + seg.tz * side * lateral + seg.nz * side * (frontDepth / 2 + wd / 2);
        if (free(wx, wz, ww, wd, rot)) {
          claim(wx, wz, ww, wd, rot);
          const wingEaves = Math.max(6.5, eaves - rng.float(2.5, 7));
          debug.wings++;
          plot.wing = {
            x: wx, z: wz, w: ww, d: wd, rot,
            ...makeHouse(rng, {
              eaves: wingEaves, commercial: false, core,
              shabbyChance: shabbyChance + 0.25, shopChance: 0,
            }),
            style,
          };
        }
      }

      plots.push(plot);
      debug.frontage++;
      if (prevIndex >= 0 && !gapBefore) {
        // party wall shared with the house next door
        plots[prevIndex].neighbourRight = true;
        plot.neighbourLeft = true;
      }
      // most plots abut; occasionally a side alley opens up
      const alley = rng.chance(0.07);
      t += fw + (alley ? rng.float(3, 5.5) : 0);
      prevIndex = plots.length - 1;
      gapBefore = alley;
    }
  }

  /* ---------- 2. block interiors and the outer districts ---------- */
  const frontageCount = plots.length;
  for (let i = 0; i < 5600; i++) {
    const x = rng.float(-HALF + 22, HALF - 22);
    const z = rng.float(-HALF + 22, HALF - 22);
    const core = inCore(x, z);
    const rim = Math.max(Math.abs(x), Math.abs(z)) > 300;
    const w = core ? rng.float(9, 16) : rng.float(13, 26);
    const d = core ? rng.float(9, 15) : rng.float(12, 22);
    const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
    if (!free(x, z, w, d, rot)) continue;
    claim(x, z, w, d, rot);
    const range = rim ? RIM_EAVES : core ? CORE_EAVES : OUTER_EAVES;
    const eaves = rng.float(range[0], range[1]);
    const house = makeHouse(rng, {
      eaves, commercial: false, core,
      shabbyChance: core ? 0.3 : 0.18, shopChance: 0,
    });
    house.style = rng.int(0, 5);
    if (rim && rng.chance(0.35)) house.pitched = false;
    plots.push({
      ...house, x, z, w, d, rot, road: null, side: 0, frontage: false,
      neighbourLeft: false, neighbourRight: false, wing: null,
    });
    debug.scatter++;
    if (plots.length > frontageCount + 700) break;
  }

  /* ---------- 3. flatten to the `buildings` contract array ---------- */
  const buildings = [];
  for (const p of plots) {
    buildings.push({
      x: p.x, z: p.z, w: p.w, d: p.d, h: p.eaves, rot: p.rot,
      style: p.style, floors: p.storeys.length, pitched: p.pitched,
      shop: !!p.shop, frontage: p.frontage,
    });
    if (p.wing) {
      buildings.push({
        x: p.wing.x, z: p.wing.z, w: p.wing.w, d: p.wing.d, h: p.wing.eaves,
        rot: p.wing.rot, style: p.wing.style, floors: p.wing.storeys.length,
        pitched: p.wing.pitched, shop: false, frontage: false,
      });
    }
  }

  return { plots, buildings, reserved, debug };
}
