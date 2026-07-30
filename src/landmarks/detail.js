import * as THREE from 'three';
import { mergeAll, gableRoof } from '../geometry.js';
import { getMaterial, TILE_METRES } from '../materials.js';

/**
 * Shared machinery for the hand-modelled landmarks: the geometry Builder,
 * the landmark material palette, and a library of reusable gothic/baroque
 * parts (pinnacles, crockets, tracery, balusters, statuary, iron trusses).
 *
 * Two rules govern everything in here:
 *
 * 1. **Parts are built once and stamped.** `b.p(name, ...args)` memoises a
 *    part geometry; `b.place()` clones it, transforms the clone and drops it
 *    into a per-material bucket. One `LatheGeometry` baluster serves the
 *    three hundred balusters on Petrov's parapets.
 * 2. **Everything merges per material.** `b.finish()` produces one mesh per
 *    material for the structural tier plus one mesh per LOD cluster for the
 *    ornament tier, which is why several hundred thousand triangles of
 *    ornament still costs a couple of dozen draw calls.
 */

/** The collision system steps capsules up onto anything within their step
 * height (0.7 m). Every terraced rise must stay under it or the terrain
 * becomes an unclimbable wall — see README "Collision". */
export const STEP_RISE = 0.55;

/**
 * Palette key -> `TILE_METRES` key, for every material whose texture must tile
 * at a fixed real-world size rather than once per surface. `finish()` re-projects
 * these meshes' UVs into world space (see `worldSpaceUV`), which is what makes
 * `makeStoneMaterial` finally scale gracefully from a 2.9 m buttress to an
 * 84 m spire off ONE cached material.
 */
const WORLD_TILED = {
  stone: 'stone',
  stonePale: 'stone',
  darkStone: 'stone',
  sandstone: 'stone',
  grass: 'grass',
};

/**
 * Re-project a geometry's UVs into world space so one texture tile always
 * covers `tileMetres` of real surface, whatever the size of the thing it is on.
 *
 * WHY THIS EXISTS. `BoxGeometry` UVs span 0..1 per face regardless of the face's
 * world size, so texel density was decoupled from reality: Petrov's 40 m tower
 * shaft and its 2.9 m buttress got the same eight ashlar courses, i.e. 5.0 m and
 * 0.36 m course heights off one material. `makeStoneMaterial`'s `scale` cannot
 * fix that at the call site, because the correct value differs per surface
 * (`heightMetres / 3.2`) while a merged-per-material mesh can only carry one —
 * deriving it per surface would mean one material, and one draw call, per
 * distinct wall height.
 *
 * Projecting instead makes the tile size right everywhere for free. Courses now
 * run at a true 0.40 m on every masonry surface in the landmarks, and they line
 * up across a buttress and the wall behind it because both read the same world
 * y. `scale` keeps its documented meaning and becomes purely a texel-density
 * knob (canvas pixels per tile), which is the only thing left for it to mean.
 *
 * Projection is triplanar off the vertex normal: the dominant axis picks whether
 * a face reads its UVs from xz (roofs, floors, ledges), zy or xy (walls). Using
 * the vertex normal rather than the triangle normal means this is safe on
 * indexed and non-indexed geometry alike, before or after merging.
 */
export function worldSpaceUV(geo, tileMetres) {
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  if (!pos || !uv) return geo;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const T = tileMetres > 0 ? tileMetres : 1;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / T, z / T);
    else if (ax >= az) uv.setXY(i, z / T, y / T);
    else uv.setXY(i, x / T, y / T);
  }
  uv.needsUpdate = true;
  return geo;
}

/* ==================================================================
   materials
   ================================================================== */

/**
 * The landmark palette. Deliberately small (one mesh per entry, per the
 * merge strategy) and pulled from the shared PBR registry so the normal /
 * roughness / AO maps are the real ones and the texture cache is hit.
 * `stoneMat` / `roofMat` from city.js are honoured where they fit so the
 * landmarks share the city's clay tile and its generic ashlar.
 */
export function palette({ stoneMat, roofMat } = {}) {
  const M = {
    /* masonry -------------------------------------------------------- */
    // city.js hands us its own gothic ashlar; reuse it so the landmarks and
    // the townhouses share one texture, and fall back if it is not passed.
    // Every ashlar here is world-projected (see WORLD_TILED / worldSpaceUV), so
    // one texture repeat always covers TILE_METRES.stone = 3.2 m = 8 x 0.40 m
    // courses, on a 2.9 m buttress and on an 84 m spire alike. That leaves
    // `scale` meaning only "canvas pixels per tile": scale 2 bakes 512px over
    // 3.2 m (160 px/m) which is the generator's cap, scale 1 bakes 256px (80).
    // So the hero surfaces get 2 and the broad or distant ones get 1.
    stone: stoneMat || getMaterial('stone', { base: '#9a9285', mortar: '#7a7367', scale: 2 }),
    // stonePale is every carved thing — tracery, mouldings, statuary, balusters
    // — and the ONLY material the ornament LOD tier accepts, which is what keeps
    // the LOD to one draw call per cluster. It gets the density.
    stonePale: getMaterial('stone', { base: '#cfc7b4', mortar: '#aca395', scale: 2 }),
    darkStone: getMaterial('stone', { base: '#6e695f', mortar: '#585449', scale: 1 }),
    sandstone: getMaterial('stone', { base: '#b6a184', mortar: '#96836a', scale: 1 }),


    /* roofs ---------------------------------------------------------- */
    roof: roofMat || getMaterial('roof'),
    slate: getMaterial('roofSlate'),
    copper: getMaterial('roofCopper'),

    /* metal ---------------------------------------------------------- */
    gold: getMaterial('gilded'),
    bronze: getMaterial('bronze'),
    metal: new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.48, metalness: 0.8 }),
    granite: new THREE.MeshStandardMaterial({ color: 0x13151a, roughness: 0.14, metalness: 0.32 }),

    /* glazing -------------------------------------------------------- */
    glass: getMaterial('paneGlass', { panesX: 2, panesY: 3 }),
    litGlass: new THREE.MeshStandardMaterial({
      color: 0x2a1d0e, emissive: 0xffab52, emissiveIntensity: 0.9, roughness: 0.55,
    }),
    shelterGlass: new THREE.MeshStandardMaterial({
      color: 0x2a3a44, roughness: 0.14, metalness: 0.45, transparent: true, opacity: 0.55,
      emissive: 0x0e1c26, emissiveIntensity: 1,
    }),
    doorway: new THREE.MeshStandardMaterial({
      color: 0x33200f, roughness: 0.85, emissive: 0x2a1204, emissiveIntensity: 1.1,
    }),

    /* landscape and dressing ---------------------------------------- */
    grass: getMaterial('grass', {}),
    water: new THREE.MeshStandardMaterial({
      color: 0x2a6070, roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.8,
      emissive: 0x0d2a33, emissiveIntensity: 1,
    }),
    canvasRed: getMaterial('paintedMetal', { color: '#a8342e' }),
    wood: getMaterial('wood', {}),
    dragonSkin: new THREE.MeshStandardMaterial({
      color: 0x66753f, roughness: 0.75, flatShading: true,
      emissive: 0x24290f, emissiveIntensity: 0.9,
    }),
    ember: new THREE.MeshStandardMaterial({
      color: 0xff3b1f, emissive: 0xff2a10, emissiveIntensity: 3, roughness: 0.4,
    }),
  };
  for (const [k, v] of Object.entries(M)) if (v && !v.name) v.name = k;
  return M;
}

/* ==================================================================
   low level geometry helpers
   ================================================================== */

/** Closed rectangular path for sweepProfile(), centred on the origin. */
export function rectPath(w, d) {
  const a = w / 2, b = d / 2;
  return [[-a, -b], [a, -b], [a, b], [-a, b]];
}

/** Open straight path for sweepProfile — a single wall run, not a ring. */
export function linePath(len) {
  return [[-len / 2, 0], [len / 2, 0]];
}

/** Closed regular polygon path, `n` sides, circumradius `r`. */
export function polyPath(n, r, rot = 0) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    p.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return p;
}

/** Closed star path — Parnas's six-pointed basin, and nothing else. */
export function starPath(points, rOuter, rInner, rot = 0) {
  const p = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 ? rInner : rOuter;
    p.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return p;
}

/**
 * Sweep a **convex closed** 2D profile along a path in the xz plane.
 * The profile is a list of `[outward, up]` pairs; `outward` is measured from
 * the path, away from its interior, so the same profile serves as a plinth,
 * a string course, a cornice, a parapet cap or a battered rampart depending
 * only on the numbers. Corners are mitred. Face windings are resolved
 * against the profile centroid, so the caller never has to think about
 * path direction.
 *
 * This is the workhorse behind every moulding in the landmarks.
 */
export function sweepProfile(profile, path, opts = {}) {
  const { closed = true, y = 0, uScale = 3, vScale = 1.2, mitreLimit = 3, flip = false } = opts;
  const n = path.length;
  const m = profile.length;
  if (n < 2 || m < 3) return new THREE.BufferGeometry();

  // Path winding decides which way "outward" points. For an open path (zero
  // signed area) it falls out of the point order — pass `flip` to swap sides.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = path[i], b = path[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const wind = (area >= 0 ? 1 : -1) * (flip ? -1 : 1);

  let mo = 0, my = 0;
  for (const [o, py] of profile) { mo += o; my += py; }
  mo /= m; my /= m;

  const rings = [], cores = [];
  for (let i = 0; i < n; i++) {
    const cur = path[i];
    const prev = path[(i - 1 + n) % n];
    const next = path[(i + 1) % n];
    const norms = [];
    const edge = (ax, az) => {
      const l = Math.hypot(ax, az) || 1;
      norms.push([(az / l) * wind, (-ax / l) * wind]);
    };
    if (closed || i > 0) edge(cur[0] - prev[0], cur[1] - prev[1]);
    if (closed || i < n - 1) edge(next[0] - cur[0], next[1] - cur[1]);
    let nx = 0, nz = 0;
    for (const q of norms) { nx += q[0]; nz += q[1]; }
    let l = Math.hypot(nx, nz);
    if (l < 1e-6) { nx = norms[0][0]; nz = norms[0][1]; l = 1; }
    nx /= l; nz /= l;
    let sc = 1;
    const dot = norms[0][0] * nx + norms[0][1] * nz;
    if (Math.abs(dot) > 1 / mitreLimit) sc = 1 / dot;
    cores.push([cur[0] + nx * mo * sc, y + my, cur[1] + nz * mo * sc]);
    rings.push(profile.map(([o, py]) => [cur[0] + nx * o * sc, y + py, cur[1] + nz * o * sc]));
  }

  const pos = [], uv = [];
  const tri = (a, b, c, ua, ub, uc, ref) => {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const mx = (a[0] + b[0] + c[0]) / 3 - ref[0];
    const myy = (a[1] + b[1] + c[1]) / 3 - ref[1];
    const mz = (a[2] + b[2] + c[2]) / 3 - ref[2];
    if (fx * mx + fy * myy + fz * mz >= 0) { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); }
    else { pos.push(...a, ...c, ...b); uv.push(...ua, ...uc, ...ub); }
  };

  // profile arc length for v
  const vs = [0];
  for (let j = 1; j < m; j++) {
    vs.push(vs[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  }
  const vClose = vs[m - 1] + Math.hypot(profile[0][0] - profile[m - 1][0], profile[0][1] - profile[m - 1][1]);

  let u = 0;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const i2 = (i + 1) % n;
    const seg = Math.hypot(path[i2][0] - path[i][0], path[i2][1] - path[i][1]);
    const u0 = u / uScale, u1 = (u + seg) / uScale;
    u += seg;
    const ref = [(cores[i][0] + cores[i2][0]) / 2, (cores[i][1] + cores[i2][1]) / 2, (cores[i][2] + cores[i2][2]) / 2];
    for (let j = 0; j < m; j++) {
      const j2 = (j + 1) % m;
      const v0 = (j === m - 1 ? vs[j] : vs[j]) / vScale;
      const v1 = (j === m - 1 ? vClose : vs[j2]) / vScale;
      const A = rings[i][j], B = rings[i2][j], C = rings[i2][j2], D = rings[i][j2];
      tri(A, B, C, [u0, v0], [u1, v0], [u1, v1], ref);
      tri(A, C, D, [u0, v0], [u1, v1], [u0, v1], ref);
    }
  }
  if (!closed) {
    // end caps: the reference point sits one path step *into* the solid, so
    // the cap normals come out pointing along the path, away from the body.
    for (const [idx, refIdx] of [[0, 1], [n - 1, n - 2]]) {
      const r = rings[idx];
      const ref = cores[refIdx];
      for (let j = 1; j < m - 1; j++) tri(r[0], r[j], r[j + 1], [0, 0], [1, 0], [1, 1], ref);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Stock moulding cross-sections for `sweepProfile` / `Builder.mould`, given as
 * `[outward, up]` pairs. Each one must stay **convex and closed** — the sweep
 * resolves face windings against the profile centroid, so a re-entrant profile
 * (a two-step cornice, say) has to be built as two stacked sweeps, which is
 * also how it is cut in stone.
 */
export const PROFILE = {
  /** Main cornice: 0.6 m projection, the period-typical 0.4-0.8 m range. */
  cornice: [[0, 0], [0.5, 0.2], [0.58, 0.42], [0.26, 0.58], [0, 0.62]],
  /** Slender floor-line string course. */
  string: [[0, 0], [0.2, 0.07], [0.2, 0.19], [0, 0.25]],
  /** Chamfered plinth / water table at the foot of a wall. */
  plinth: [[0, 0], [0.44, 0], [0.44, 0.5], [0.15, 0.78], [0, 0.8]],
  /** Parapet or balustrade cap. */
  cap: [[0, 0], [0.3, 0.1], [0.24, 0.28], [0, 0.32]],
  /** Buttress set-back weathering (a steep sloped offset). */
  setback: [[0, 0], [0.7, 0], [0.7, 0.16], [0, 0.72]],
  /** Battered (sloping-faced) rampart body, `t` thick at the top. */
  batter: (t, h, batter = 0.7) => [
    [-(t / 2 + batter), 0], [t / 2 + batter, 0], [t / 2, h], [-(t / 2), h],
  ],
  /** Coping that caps a battered wall. */
  coping: (t, over = 0.26, h = 0.34) => [
    [-(t / 2 + over), 0], [t / 2 + over, 0], [t / 2 + over * 0.7, h], [-(t / 2 + over * 0.7), h],
  ],
};

/**
 * Outline of a two-centred pointed (gothic) arch, `w` wide, `h` to the apex,
 * springing at `spring * h`. Returned CCW from the bottom-left corner, ready
 * to hand to `THREE.Shape`. `spring >= 1` degenerates to a plain rectangle,
 * `h - spring*h === w/2` gives a semicircular (romanesque) head.
 */
export function pointedArchPoints(w, h, opts = {}) {
  const { spring = 0.55, steps = 7 } = opts;
  const hw = w / 2;
  const sy = Math.min(h * spring, h - hw * 0.2);
  const rise = h - sy;
  const c = (rise * rise - hw * hw) / (2 * hw);
  const R = c + hw;
  const a0 = Math.PI;
  const a1 = Math.atan2(rise, -c);
  const pts = [new THREE.Vector2(-hw, 0), new THREE.Vector2(-hw, sy)];
  for (let i = 1; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push(new THREE.Vector2(c + Math.cos(a) * R, sy + Math.sin(a) * R));
  }
  for (let i = steps - 1; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push(new THREE.Vector2(-(c + Math.cos(a) * R), sy + Math.sin(a) * R));
  }
  pts.push(new THREE.Vector2(hw, 0));
  return pts;
}

/**
 * Multifoil outline (trefoil, quatrefoil, sexfoil …) of radius `r`: `lobes`
 * tangent circular lobes with a real cusp between each pair. This is what
 * makes the rose window and the tracery heads read as gothic rather than as
 * a wheel of holes.
 */
export function foilPoints(r, lobes, opts = {}) {
  const { steps = 4, rot = -Math.PI / 2 } = opts;
  const s = Math.sin(Math.PI / lobes);
  const rc = r / (1 + s);
  const lr = rc * s;
  const cen = (k) => {
    const a = rot + (k / lobes) * Math.PI * 2;
    return [Math.cos(a) * rc, Math.sin(a) * rc, a];
  };
  const pts = [];
  const TAU = Math.PI * 2;
  for (let k = 0; k < lobes; k++) {
    const [cxp, cyp, a] = cen(k);
    const [px, py] = cen(k - 1 < 0 ? lobes - 1 : k - 1);
    const [nxp, nyp] = cen((k + 1) % lobes);
    const t0 = [(cxp + px) / 2 - cxp, (cyp + py) / 2 - cyp];
    const t1 = [(cxp + nxp) / 2 - cxp, (cyp + nyp) / 2 - cyp];
    let f0 = Math.atan2(t0[1], t0[0]);
    let f1 = Math.atan2(t1[1], t1[0]);
    let d = f1 - f0;
    while (d <= 0) d += TAU;
    let da = a - f0;
    while (da < 0) da += TAU;
    while (da >= TAU) da -= TAU;
    if (da > d) d -= TAU; // take the arc that passes through the lobe's crest
    for (let i = 0; i <= steps; i++) {
      const f = f0 + d * (i / steps);
      pts.push(new THREE.Vector2(cxp + Math.cos(f) * lr, cyp + Math.sin(f) * lr));
    }
  }
  return pts;
}

function shapeOf(points, holes = []) {
  const s = new THREE.Shape(points);
  for (const h of holes) s.holes.push(new THREE.Path(h));
  return s;
}

function extrude(shape, depth, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: 4,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, bevelOffset: 0,
  });
  g.computeVertexNormals();
  return g;
}

/* ==================================================================
   the reusable part library
   ================================================================== */

/** Arch-shaped stone bar of thickness `t` — mullion heads, window rings,
 * blind arcading, the archivolts of a portal. Front face at z = 0.
 * `bevel` costs roughly double the triangles, so it is off by default and
 * reserved for the pieces you actually walk up to. */
export function archRing(w, h, t, depth = 0.3, spring = 0.55, opts = {}) {
  const { steps = 5, bevel = 0 } = opts;
  const outer = pointedArchPoints(w, h, { spring, steps });
  const inner = pointedArchPoints(w - t * 2, h - t * 1.7, { spring, steps })
    .map((p) => new THREE.Vector2(p.x, p.y + t));
  return extrude(shapeOf(outer, [inner]), depth, bevel);
}

/** Round-arched ring — baroque and renaissance openings. */
export function roundArchRing(w, h, t, depth = 0.3, opts = {}) {
  return archRing(w, h, t, depth, 1 - (w / 2) / h, opts);
}

/** Circular stone ring, optionally with a foiled (cusped) inner edge. */
export function circleRing(r, t, depth = 0.3, foils = 0, opts = {}) {
  const { seg = 10, bevel = 0, steps = 3 } = opts;
  const outer = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    outer.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const ri = r - t;
  const inner = foils >= 3 ? foilPoints(ri, foils, { steps }) : (() => {
    const p = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      p.push(new THREE.Vector2(Math.cos(a) * ri, Math.sin(a) * ri));
    }
    return p;
  })();
  return extrude(shapeOf(outer, [inner]), depth, bevel);
}

/**
 * A real rose window: a moulded outer rim, `spokes` radiating tracery bars,
 * cusped lights between them and a foiled hub. Built as one extruded Shape
 * with one hole per light, so every bar and every cusp is geometry that
 * catches light — no painted disc.
 */
export function roseWindow(R, opts = {}) {
  const { spokes = 12, depth = 0.7, rim = 0.14, hubR = 0.19, bar = 0.055, lobes = 3 } = opts;
  const outer = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    outer.push(new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R));
  }
  const holes = [];
  const rOut = R * (1 - rim);
  const rIn = R * (hubR + 0.13);
  const half = bar * Math.PI; // angular half-width of a bar, in radians
  for (let k = 0; k < spokes; k++) {
    const c = (k / spokes) * Math.PI * 2;
    const step = Math.PI * 2 / spokes;
    const a0 = c - step / 2 + half, a1 = c + step / 2 - half;
    const p = [];
    // inner edge, then out along the bar, cusped outer edge, back in
    p.push(new THREE.Vector2(Math.cos(a0) * rIn, Math.sin(a0) * rIn));
    const seg = 3;
    for (let i = 0; i <= seg * lobes; i++) {
      const t = i / (seg * lobes);
      const a = a0 + (a1 - a0) * t;
      // cusped outer edge: `lobes` inward scallops
      const lobe = Math.abs(Math.sin(t * Math.PI * lobes));
      const rr = rIn + (rOut - rIn) * (0.55 + 0.45 * lobe);
      p.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
    }
    p.push(new THREE.Vector2(Math.cos(a1) * rIn, Math.sin(a1) * rIn));
    p.reverse();
    holes.push(p);
  }
  const hub = foilPoints(R * hubR, 6);
  hub.reverse();
  holes.push(hub);
  return extrude(shapeOf(outer, holes), depth, depth * 0.1);
}

/**
 * Gothic window: a moulded arched surround, `lights` cusped lights split by
 * real mullions, a tracery head above them, and a glazing plane behind.
 * Returns `{ stone, glass }` so the caller can drop each into its own
 * material bucket. `y = 0` is the sill, front face at `z = 0`.
 */
export function traceryWindow(w, h, opts = {}) {
  const {
    lights = 2, depth = 0.42, bar = 0.17, sur = 0.34, lobes = 3, head = true,
  } = opts;
  const stone = [];
  // moulded surround — the one piece that gets a bevel, because it is the
  // silhouette you read at ten metres
  stone.push(archRing(w + sur * 2, h + sur * 1.5, sur, depth * 1.25, 0.55, { steps: 6, bevel: depth * 0.1 })
    .translate(0, -sur * 0.2, -depth * 0.25));
  // sill
  stone.push(new THREE.BoxGeometry(w + sur * 2.6, sur * 0.8, depth * 1.5)
    .translate(0, -sur * 0.5, depth * 0.35));

  const lw = (w - bar * (lights + 1)) / lights;
  const lh = h * 0.62;
  const lightHead = archRing(lw + bar, lh + lw * 0.55, bar * 0.85, depth * 0.7, 0.55, { steps: 4 });
  const cusp = lobes >= 3 ? circleRing(lw * 0.3, lw * 0.09, depth * 0.5, lobes) : null;
  for (let i = 0; i < lights; i++) {
    const lx = -w / 2 + bar * (i + 1) + lw * (i + 0.5);
    // mullion
    stone.push(new THREE.BoxGeometry(bar, lh + lw * 0.5, depth * 0.85)
      .translate(lx - lw / 2 - bar / 2, (lh + lw * 0.5) / 2, depth * 0.45));
    // cusped head of the light
    stone.push(lightHead.clone().translate(lx, 0, depth * 0.5));
    // the cusps themselves: small foils tucked into the head
    if (cusp) stone.push(cusp.clone().translate(lx, lh + lw * 0.14, depth * 0.55));
  }
  lightHead.dispose();
  if (cusp) cusp.dispose();
  stone.push(new THREE.BoxGeometry(w + bar, bar, depth * 0.85)
    .translate(0, lh + lw * 0.55, depth * 0.45)); // transom under the head
  for (const s of [-1, 1]) {
    stone.push(new THREE.BoxGeometry(bar, h - lh - lw * 0.55, depth * 0.85)
      .translate(s * (w / 2 - bar / 2), lh + lw * 0.55, depth * 0.45));
  }
  if (head) {
    const hr = Math.min(w * 0.3, (h - lh - lw * 0.55) * 0.44);
    stone.push(circleRing(hr, bar * 0.8, depth * 0.7, 4)
      .translate(0, lh + lw * 0.6 + hr * 1.1, depth * 0.45));
    for (const s of [-1, 1]) {
      stone.push(new THREE.BoxGeometry(bar * 0.9, hr * 0.9, depth * 0.6)
        .rotateZ(s * 0.5).translate(s * hr * 0.95, lh + lw * 0.55 + hr * 0.5, depth * 0.45));
    }
  }
  // the glazing is a single flat face turned to meet the viewer: at 480-odd
  // openings across the landmarks, an extruded slab here costs 20k triangles
  // for a pane nobody can see the edge of
  const glass = new THREE.ShapeGeometry(shapeOf(pointedArchPoints(w - bar * 0.4, h - bar * 0.4, { steps: 4 })));
  glass.rotateY(Math.PI);
  glass.translate(0, bar * 0.2, depth * 0.62);
  return { stone: mergeAll(stone), glass };
}

/** Round-headed baroque window with a keystone and moulded architrave. */
export function baroqueWindow(w, h, opts = {}) {
  const { depth = 0.4, sur = 0.3 } = opts;
  const stone = [];
  stone.push(roundArchRing(w + sur * 2, h + sur, sur, depth * 1.2, { steps: 4 })
    .translate(0, -sur * 0.4, -depth * 0.2));
  // keystone
  const key = new THREE.CylinderGeometry(0.16, 0.24, sur * 2.3, 4);
  key.rotateY(Math.PI / 4);
  key.rotateX(Math.PI / 2);
  key.scale(1, 1, 0.55);
  stone.push(key.translate(0, h + sur * 0.1, depth * 0.2));
  // sill on brackets
  stone.push(new THREE.BoxGeometry(w + sur * 3, sur * 0.7, depth * 1.6).translate(0, -sur * 0.75, depth * 0.4));
  for (const s of [-1, 1]) {
    stone.push(new THREE.BoxGeometry(sur * 0.7, sur * 1.3, depth).translate(s * (w / 2 - sur * 0.2), -sur * 1.7, depth * 0.35));
  }
  const glass = new THREE.ShapeGeometry(shapeOf(pointedArchPoints(w, h, { spring: 1 - (w / 2) / h, steps: 4 })));
  glass.rotateY(Math.PI);
  glass.translate(0, 0, depth * 0.55);
  return { stone: mergeAll(stone), glass };
}

/** A crocket — the leafy hook that climbs a gothic spire edge. Unit size,
 * pointing +z, ~0.5 tall; scale it at the call site. */
export function crocket() {
  const g = [];
  const stem = new THREE.BoxGeometry(0.14, 0.42, 0.16);
  stem.rotateX(-0.5);
  g.push(stem.translate(0, 0.2, 0.1));
  const leaf = new THREE.ConeGeometry(0.22, 0.42, 3);
  leaf.rotateX(Math.PI * 0.62);
  g.push(leaf.translate(0, 0.4, 0.3));
  const curl = new THREE.ConeGeometry(0.13, 0.24, 3);
  curl.rotateX(Math.PI * 0.5);
  g.push(curl.translate(0, 0.46, 0.44));
  return mergeAll(g);
}

/**
 * A pinnacle: moulded base, tapering shaft, crocketed spirelet, finial.
 * `h` is the total height, `w` the base width. Used a couple of hundred
 * times across Petrov, Špilberk and the radnice portal, always from this
 * one cached geometry.
 */
export function pinnacle(h = 6, w = 1.1, opts = {}) {
  const { crockets = 2, faces = 4 } = opts;
  const g = [];
  const baseH = h * 0.12;
  g.push(sweepProfile(
    [[0, 0], [w * 0.22, baseH * 0.35], [w * 0.24, baseH * 0.7], [0, baseH]],
    polyPath(faces, w * 0.5, Math.PI / faces), { closed: true },
  ));
  const shaftH = h * 0.34;
  g.push(new THREE.CylinderGeometry(w * 0.38, w * 0.44, shaftH, faces)
    .translate(0, baseH + shaftH / 2, 0));
  // capping cornice
  g.push(sweepProfile(
    [[0, 0], [w * 0.16, h * 0.02], [w * 0.16, h * 0.045], [0, h * 0.06]],
    polyPath(faces, w * 0.42, Math.PI / faces), { closed: true, y: baseH + shaftH },
  ));
  const spireY = baseH + shaftH + h * 0.06;
  const spireH = h - spireY - h * 0.08;
  g.push(new THREE.ConeGeometry(w * 0.42, spireH, faces).translate(0, spireY + spireH / 2, 0));
  const cr = crocket();
  for (let i = 0; i < faces; i++) {
    const a = (i / faces) * Math.PI * 2 + Math.PI / faces;
    for (let k = 0; k < crockets; k++) {
      const t = 0.24 + (k / crockets) * 0.62;
      const c = cr.clone();
      c.scale(w * 0.5, w * 0.5, w * 0.5);
      c.rotateY(a);
      c.translate(Math.cos(a) * w * 0.42 * (1 - t), spireY + spireH * t, Math.sin(a) * w * 0.42 * (1 - t));
      g.push(c);
    }
  }
  cr.dispose();
  // finial
  g.push(new THREE.SphereGeometry(w * 0.15, 5, 4).translate(0, h - h * 0.07, 0));
  g.push(new THREE.ConeGeometry(w * 0.1, h * 0.1, 4).translate(0, h - h * 0.02, 0));
  return mergeAll(g);
}

/** Crenellation merlon with a chamfered cap. */
export function merlon(w = 2.2, h = 1.5, d = 0.9) {
  const g = [new THREE.BoxGeometry(w, h * 0.8, d).translate(0, h * 0.4, 0)];
  g.push(sweepProfile([[0, 0], [0.14, h * 0.06], [0.1, h * 0.16], [-0.05, h * 0.2]],
    rectPath(w, d), { closed: true, y: h * 0.8 }));
  return mergeAll(g);
}

/**
 * Turned baluster — parapets, terrace balustrades, theatre attics.
 *
 * This part is stamped roughly three hundred times across the landmarks, so its
 * profile is deliberately the shortest one that still reads as turned stone:
 * a swelling foot, a waisted neck and a square cap. Every point added here
 * costs ~600 triangles across the map.
 */
export function baluster(h = 1.0, r = 0.14) {
  const pts = [
    [r * 1.5, 0], [r * 1.5, h * 0.07], [r * 0.66, h * 0.2],
    [r * 1.0, h * 0.4], [r * 0.52, h * 0.66], [r * 0.5, h * 0.86],
    [r * 1.5, h * 0.94], [r * 1.5, h],
  ].map(([x, y]) => new THREE.Vector2(Math.max(0.02, x), y));
  return new THREE.LatheGeometry(pts, 6);
}

/** Pierced quatrefoil parapet panel — the gothic alternative to balusters. */
export function quatrefoilPanel(w = 2.6, h = 1.3, t = 0.28) {
  const outer = [
    new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0),
    new THREE.Vector2(w / 2, h), new THREE.Vector2(-w / 2, h),
  ];
  const r = Math.min(w * 0.5, h * 0.5) - t * 0.7;
  const hole = foilPoints(r, 4, { rot: Math.PI / 4 }).map((p) => new THREE.Vector2(p.x, p.y + h / 2));
  hole.reverse();
  return extrude(shapeOf(outer, [hole]), t, t * 0.15);
}

/** Column with a moulded base, entasis and a capital. `order` picks the
 * capital: 0 doric, 1 ionic-ish, 2 corinthian-ish (a bell of leaves). */
export function column(h = 10, r = 0.5, order = 1) {
  const g = [];
  const bh = h * 0.06;
  g.push(new THREE.CylinderGeometry(r * 1.05, r * 1.3, bh, 12).translate(0, bh / 2, 0));
  const sh = h * 0.82;
  const prof = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    // entasis: slight swell a third of the way up
    prof.push(new THREE.Vector2(r * (1 - t * 0.18 + Math.sin(t * Math.PI) * 0.035), bh + sh * t));
  }
  prof.unshift(new THREE.Vector2(0.02, bh));
  prof.push(new THREE.Vector2(0.02, bh + sh));
  g.push(new THREE.LatheGeometry(prof, 12));
  const cy = bh + sh;
  const ch = h - cy;
  if (order === 0) {
    g.push(new THREE.CylinderGeometry(r * 1.15, r * 0.86, ch * 0.55, 12).translate(0, cy + ch * 0.28, 0));
    g.push(new THREE.BoxGeometry(r * 2.5, ch * 0.45, r * 2.5).translate(0, cy + ch * 0.78, 0));
  } else if (order === 1) {
    g.push(new THREE.CylinderGeometry(r * 1.0, r * 0.86, ch * 0.4, 12).translate(0, cy + ch * 0.2, 0));
    for (const s of [-1, 1]) {
      g.push(new THREE.TorusGeometry(r * 0.42, r * 0.2, 4, 8)
        .rotateY(Math.PI / 2).translate(s * r * 0.9, cy + ch * 0.5, 0));
    }
    g.push(new THREE.BoxGeometry(r * 2.6, ch * 0.28, r * 2.2).translate(0, cy + ch * 0.86, 0));
  } else {
    g.push(new THREE.CylinderGeometry(r * 1.35, r * 0.86, ch * 0.68, 12).translate(0, cy + ch * 0.34, 0));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const leaf = new THREE.ConeGeometry(r * 0.28, ch * 0.5, 4);
      leaf.rotateX(0.5);
      leaf.rotateY(a);
      leaf.translate(Math.cos(a) * r * 1.05, cy + ch * 0.34, Math.sin(a) * r * 1.05);
      g.push(leaf);
    }
    g.push(new THREE.BoxGeometry(r * 2.8, ch * 0.3, r * 2.4).translate(0, cy + ch * 0.85, 0));
  }
  return mergeAll(g);
}

/** Baroque volute — the S-scroll that flanks a gable or buttresses a dome. */
export function volute(len = 3, t = 0.5, d = 0.6) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const s = i / 12;
    pts.push(new THREE.Vector2(len * s, len * 0.5 * Math.sin(s * Math.PI * 0.9) - len * 0.1 * s));
  }
  for (let i = 12; i >= 0; i--) {
    const s = i / 12;
    pts.push(new THREE.Vector2(len * s, len * 0.5 * Math.sin(s * Math.PI * 0.9) - len * 0.1 * s - t));
  }
  return extrude(shapeOf(pts), d, d * 0.1);
}

/** Baroque urn / flaming vase for attic parapets. */
export function urn(h = 1.8) {
  const r = h * 0.28;
  const pts = [
    [r * 0.9, 0], [r * 0.9, h * 0.06], [r * 0.5, h * 0.12], [r * 0.62, h * 0.2],
    [r * 0.95, h * 0.34], [r, h * 0.5], [r * 0.78, h * 0.66], [r * 0.5, h * 0.74],
    [r * 0.72, h * 0.8], [r * 0.62, h * 0.86], [r * 0.2, h * 0.92], [r * 0.28, h],
  ].map(([x, y]) => new THREE.Vector2(Math.max(0.02, x), y));
  return new THREE.LatheGeometry(pts, 9);
}

/**
 * A carved figure, one metre tall, feet at y = 0, facing -z. `kind` picks the
 * pose; `v` is a deterministic variation index so a row of saints is not a
 * row of clones. Roughly 250-450 triangles, and every statue in the game is
 * a transformed clone of one of these.
 */
export function figure(kind = 'standing', v = 0) {
  const h = (n) => {
    const x = Math.sin((v + 1) * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  const g = [];
  const box = (w, hh, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const b = new THREE.BoxGeometry(w, hh, d);
    if (rz) b.rotateZ(rz);
    if (rx) b.rotateX(rx);
    if (ry) b.rotateY(ry);
    b.translate(x, y, z);
    g.push(b);
  };
  const lean = (h(1) - 0.5) * 0.18;
  const twist = (h(2) - 0.5) * 0.5;

  if (kind === 'seated') {
    // thighs forward, shins down — the Parnas allegories
    box(0.13, 0.3, 0.15, -0.09, 0.44, -0.12, Math.PI / 2 - 0.15);
    box(0.13, 0.3, 0.15, 0.09, 0.44, -0.12, Math.PI / 2 - 0.15);
    box(0.12, 0.42, 0.13, -0.09, 0.2, -0.26);
    box(0.12, 0.42, 0.13, 0.1, 0.22, -0.24, 0.2);
    box(0.34, 0.34, 0.24, 0, 0.62, 0.0, -0.12, twist * 0.5);
    // drapery over the knees
    const dr = new THREE.ConeGeometry(0.3, 0.3, 7, 1, true);
    dr.rotateX(Math.PI / 2 + 0.3);
    g.push(dr.translate(0, 0.46, -0.16));
    box(0.11, 0.34, 0.11, -0.24, 0.66, -0.06, 0.5 + h(3) * 0.5, 0, 0.4);
    box(0.11, 0.34, 0.11, 0.24, 0.66, -0.06, -0.2 - h(4) * 0.6, 0, -0.3);
    box(0.12, 0.09, 0.12, 0, 0.82, 0);
    g.push(new THREE.SphereGeometry(0.1, 7, 5).translate(twist * 0.06, 0.92, -0.02));
    return mergeAll(g);
  }

  // upright variants -------------------------------------------------
  const robe = kind === 'saint' || kind === 'virgin';
  if (robe) {
    const skirt = new THREE.CylinderGeometry(0.16, 0.29, 0.56, 9, 1);
    g.push(skirt.translate(0, 0.28, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.push(new THREE.BoxGeometry(0.05, 0.5, 0.05)
        .translate(Math.cos(a) * 0.24, 0.28, Math.sin(a) * 0.24)); // drapery folds
    }
  } else {
    box(0.13, 0.46, 0.15, -0.09 - lean * 0.4, 0.23, 0.01, 0, 0, lean * 0.5);
    box(0.13, 0.46, 0.15, 0.1 + lean * 0.4, 0.23, -0.03, 0.1, 0, -lean * 0.5);
  }
  const chest = kind === 'atlas' || kind === 'hercules' ? 0.42 : 0.32;
  box(chest, 0.3, 0.21, lean * 0.1, 0.66, 0, 0, twist * 0.4, lean * 0.3);
  box(chest * 1.06, 0.09, 0.2, lean * 0.12, 0.8, 0, 0, twist * 0.4);

  if (kind === 'atlas') {
    // both arms up, taking the entablature — the mamlasi
    for (const s of [-1, 1]) {
      box(0.12, 0.3, 0.12, s * 0.21, 0.9, 0.0, 0, 0, s * 0.22);
      box(0.11, 0.28, 0.11, s * 0.28, 1.14, 0.0, 0, 0, s * -0.05);
    }
    g.push(new THREE.SphereGeometry(0.1, 7, 5).translate(0, 0.92, -0.03));
    box(0.2, 0.06, 0.16, 0, 0.98, -0.02); // bowed head / shoulders
    return mergeAll(g);
  }
  if (kind === 'hercules') {
    box(0.12, 0.34, 0.12, -0.24, 0.68, -0.04, 0.4, 0, 0.3);
    box(0.12, 0.34, 0.12, 0.24, 0.66, 0.02, -0.5, 0, -0.25);
    // club
    const club = new THREE.CylinderGeometry(0.035, 0.07, 0.5, 6);
    club.rotateZ(0.5);
    g.push(club.translate(-0.34, 0.5, -0.06));
    // lion skin over the shoulders
    const skin = new THREE.SphereGeometry(0.15, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    g.push(skin.translate(0, 0.8, 0.03));
    box(0.12, 0.1, 0.12, 0, 0.86, -0.06);
    g.push(new THREE.SphereGeometry(0.1, 7, 5).translate(0, 0.94, -0.02));
    return mergeAll(g);
  }
  // saint / standing / virgin
  const armA = 0.3 + h(5) * 0.9;
  const armB = -0.3 - h(6) * 0.7;
  box(0.1, 0.32, 0.1, -0.21, 0.68, -0.02, armA, 0, 0.25);
  box(0.1, 0.32, 0.1, 0.21, 0.68, -0.02, armB, 0, -0.25);
  box(0.1, 0.08, 0.1, lean * 0.14, 0.86, 0);
  g.push(new THREE.SphereGeometry(0.1, 7, 5).translate(twist * 0.05, 0.94, -0.02));
  if (kind === 'virgin') {
    // the Child on the left arm
    box(0.13, 0.2, 0.11, -0.16, 0.74, -0.1, 0, 0, 0.5);
    g.push(new THREE.SphereGeometry(0.065, 6, 5).translate(-0.24, 0.86, -0.12));
    // veil
    const veil = new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
    g.push(veil.translate(0, 0.92, 0));
  } else if (kind === 'saint') {
    // a staff / palm — reads as an attribute at 10 m
    const staff = new THREE.CylinderGeometry(0.022, 0.022, 0.62, 5);
    staff.rotateZ(0.12);
    g.push(staff.translate(0.26, 0.62, -0.06));
  }
  return mergeAll(g);
}

/** A four-legged beast, one metre long, for the Parnas menagerie and the
 * chained dragon. `kind`: 'dragon' | 'lion' | 'bear' | 'cerberus'. */
export function beast(kind = 'dragon') {
  const g = [];
  const body = new THREE.BoxGeometry(0.3, 0.28, 0.62);
  g.push(body.translate(0, 0.3, 0));
  for (const [sx, sz] of [[-1, 0.22], [1, 0.22], [-1, -0.22], [1, -0.22]]) {
    g.push(new THREE.BoxGeometry(0.09, 0.3, 0.1).translate(sx * 0.14, 0.15, sz));
  }
  const neck = new THREE.BoxGeometry(0.16, 0.3, 0.16);
  neck.rotateX(-0.6);
  g.push(neck.translate(0, 0.44, -0.32));
  if (kind === 'cerberus') {
    for (const s of [-1, 0, 1]) {
      g.push(new THREE.BoxGeometry(0.13, 0.12, 0.26).translate(s * 0.11, 0.56, -0.44));
      g.push(new THREE.ConeGeometry(0.045, 0.1, 4).translate(s * 0.11, 0.64, -0.4));
    }
  } else {
    const head = new THREE.BoxGeometry(0.17, 0.15, 0.3);
    g.push(head.translate(0, 0.56, -0.46));
    if (kind === 'dragon') {
      const jaw = new THREE.BoxGeometry(0.14, 0.06, 0.26);
      g.push(jaw.translate(0, 0.47, -0.48));
      for (let i = 0; i < 4; i++) g.push(new THREE.ConeGeometry(0.022, 0.06, 4).rotateX(Math.PI).translate(-0.05 + (i % 2) * 0.1, 0.5, -0.42 - Math.floor(i / 2) * 0.09));
    }
  }
  // tail
  for (let i = 0; i < 4; i++) {
    const t = i / 4;
    g.push(new THREE.BoxGeometry(0.12 - t * 0.07, 0.12 - t * 0.07, 0.16)
      .translate(t * 0.06, 0.3 - t * 0.05, 0.34 + i * 0.15));
  }
  if (kind === 'dragon') {
    for (const s of [-1, 1]) {
      const wing = new THREE.BoxGeometry(0.44, 0.05, 0.36);
      wing.rotateZ(s * 0.6);
      wing.rotateY(s * 0.3);
      g.push(wing.translate(s * 0.3, 0.5, 0.02));
      for (let i = 0; i < 3; i++) {
        g.push(new THREE.BoxGeometry(0.4, 0.03, 0.03).rotateZ(s * 0.6).rotateY(s * (0.15 + i * 0.2))
          .translate(s * 0.3, 0.5, 0.02));
      }
    }
    for (let i = 0; i < 5; i++) {
      g.push(new THREE.ConeGeometry(0.04, 0.1, 4).translate(0, 0.46 - i * 0.01, -0.2 + i * 0.16));
    }
  }
  if (kind === 'lion') {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.push(new THREE.BoxGeometry(0.07, 0.07, 0.07).translate(Math.cos(a) * 0.14, 0.56 + Math.sin(a) * 0.13, -0.34));
    }
    for (const s of [-1, 1]) {
      const wing = new THREE.BoxGeometry(0.4, 0.05, 0.3);
      wing.rotateZ(s * 0.55);
      g.push(wing.translate(s * 0.28, 0.48, 0.02));
    }
  }
  if (kind === 'bear') {
    g.push(new THREE.SphereGeometry(0.11, 7, 5).translate(0, 0.57, -0.46));
    for (const s of [-1, 1]) g.push(new THREE.SphereGeometry(0.04, 5, 4).translate(s * 0.08, 0.66, -0.42));
  }
  return mergeAll(g);
}

/**
 * One bay of a cast-iron platform canopy truss: a slender column, the
 * bracket capital, and a warren-braced beam of `span` metres. Front face
 * along x, the roof pitches away in z.
 */
export function trussBay(span = 11, depth = 0.9, bays = 6, member = 0.11) {
  const g = [];
  const top = new THREE.BoxGeometry(span, member * 1.3, member * 1.6).translate(0, depth, 0);
  g.push(top);
  g.push(new THREE.BoxGeometry(span, member * 1.3, member * 1.6).translate(0, 0, 0));
  for (let i = 0; i < bays; i++) {
    const x0 = -span / 2 + (i / bays) * span;
    const x1 = -span / 2 + ((i + 1) / bays) * span;
    const len = Math.hypot(x1 - x0, depth);
    const d = new THREE.BoxGeometry(member * 0.8, len, member);
    d.rotateZ(Math.atan2(x1 - x0, depth) * (i % 2 ? -1 : 1));
    g.push(d.translate((x0 + x1) / 2, depth / 2, 0));
    if (i % 2 === 0) g.push(new THREE.BoxGeometry(member * 0.9, depth, member).translate(x0, depth / 2, 0));
  }
  return mergeAll(g);
}

/** Cast-iron column with a foliate bracket capital. */
export function ironColumn(h = 5.4, r = 0.14) {
  const g = [];
  g.push(new THREE.CylinderGeometry(r * 1.6, r * 2.2, h * 0.06, 8).translate(0, h * 0.03, 0));
  g.push(new THREE.CylinderGeometry(r * 0.82, r, h * 0.88, 8).translate(0, h * 0.5, 0));
  g.push(new THREE.CylinderGeometry(r * 1.9, r * 0.9, h * 0.07, 8).translate(0, h * 0.95, 0));
  // spandrel brackets
  for (const s of [-1, 1]) {
    const br = new THREE.BoxGeometry(r * 7, r * 0.5, r * 0.6);
    br.rotateZ(s * 0.45);
    g.push(br.translate(s * r * 3.2, h * 0.86, 0));
  }
  return mergeAll(g);
}

/** Ironwork railing panel: two rails and vertical bars. */
export function railing(w = 3, h = 1.1, bars = 7, t = 0.05) {
  const g = [
    new THREE.BoxGeometry(w, t * 1.6, t * 2).translate(0, h, 0),
    new THREE.BoxGeometry(w, t * 1.2, t * 1.6).translate(0, h * 0.45, 0),
  ];
  for (let i = 0; i < bars; i++) {
    const x = -w / 2 + (w / (bars - 1)) * i;
    g.push(new THREE.BoxGeometry(t, h, t).translate(x, h / 2, 0));
  }
  return mergeAll(g);
}

/** Solid pointed-arch panel — tympana, blind panels, glazing planes.
 * Front face at z = 0, sill at y = 0. */
export function archPanel(w, h, depth = 0.3, spring = 0.55) {
  return extrude(shapeOf(pointedArchPoints(w, h, { spring })), depth);
}

/** Rectangular wall panel with a circular opening — rose window reveals,
 * oculi, the clock stage of a tower. */
export function circleWall(w, h, d, r, cy) {
  const outer = [
    new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0),
    new THREE.Vector2(w / 2, h), new THREE.Vector2(-w / 2, h),
  ];
  const hole = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    hole.push(new THREE.Vector2(Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return extrude(shapeOf(outer, [hole]), d);
}

/** A wall panel with a real opening punched through it — gate arches,
 * casemate mouths, arcades, the radnice passage. Front face at z = 0. */
export function archedWall(w, h, d, openW, openH, opts = {}) {
  const { spring = 0.55, sillY = 0 } = opts;
  const outer = [
    new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0),
    new THREE.Vector2(w / 2, h), new THREE.Vector2(-w / 2, h),
  ];
  const hole = pointedArchPoints(openW, openH, { spring }).map((p) => new THREE.Vector2(p.x, p.y + sillY));
  hole.reverse();
  return extrude(shapeOf(outer, [hole]), d);
}

/* ==================================================================
   the Builder
   ================================================================== */

const PARTS = {
  pinnacle, crocket, merlon, baluster, quatrefoilPanel, column, volute, urn,
  figure, beast, trussBay, ironColumn, railing, archedWall, archRing,
  roundArchRing, circleRing, roseWindow, traceryWindow, baroqueWindow,
  archPanel, circleWall,
};

/**
 * Collects geometry into per-material buckets and merges them at the end.
 *
 * Two tiers:
 * - **tier 0 (structural)** merges globally, one mesh per material. Silhouette,
 *   walls, roofs, openings — everything you must see from 200 m.
 * - **tier 1 (ornament)** merges per LOD cluster and is restricted to the
 *   `stonePale` material, so the entire distance LOD costs at most one extra
 *   draw call per cluster. Anything pushed at tier 1 in another material
 *   silently falls back to tier 0.
 */
const EMPTY_TRANSFORM = { x: 0, y: 0, z: 0 };

export class Builder {
  constructor(collision, M, { transforms = {} } = {}) {
    this.realCollision = collision;
    this.transforms = transforms;
    // Keep collision and geometry under the same per-landmark translation.
    this.collision = {
      add: (x, z, w, d, y, h, tag, surface) => {
        const tr = this.transforms[this._cluster] || EMPTY_TRANSFORM;
        return collision.add(x + tr.x, z + tr.z, w, d, y + tr.y, h, tag, surface);
      },
    };
    this.M = M;
    this.base = new Map();
    this.orn = new Map();
    this.cache = new Map();
    this._tier = 0;
    this._cluster = 'core';
    this.ornamentMats = new Set([M.stonePale]);
    // material instance -> TILE_METRES key, resolved once
    this.tiled = new Map();
    for (const [key, kind] of Object.entries(WORLD_TILED)) {
      if (M[key]) this.tiled.set(M[key], kind);
    }
  }

  /**
   * World metres spanned by 1.0 UV unit for a world-tiled material, or 0 if the
   * material is not world-tiled. Reads the material's ACTUAL texture repeat, so
   * this stays correct for a material handed in by city.js at any `scale`
   * (its ashlar arrives at scale 2, i.e. two repeats per UV unit).
   */
  _tileMetres(mat) {
    const kind = this.tiled.get(mat);
    if (!kind) return 0;
    const base = TILE_METRES[kind];
    if (!base) return 0;
    const rep = (mat.map && mat.map.repeat && mat.map.repeat.x) || 1;
    return base * rep;
  }

  cluster(name) { this._cluster = name; this._tier = 0; return this; }
  /** 0 = structural (always drawn), 1 = ornament (LOD'd out at distance). */
  tier(n) { this._tier = n; return this; }

  _push(mat, geo) {
    if (!geo) return geo;
    const tr = this.transforms[this._cluster];
    if (tr) geo.translate(tr.x || 0, tr.y || 0, tr.z || 0);
    if (this._tier === 1 && this.ornamentMats.has(mat)) {
      let byMat = this.orn.get(this._cluster);
      if (!byMat) this.orn.set(this._cluster, (byMat = new Map()));
      let arr = byMat.get(mat);
      if (!arr) byMat.set(mat, (arr = []));
      arr.push(geo);
      return geo;
    }
    let arr = this.base.get(mat);
    if (!arr) this.base.set(mat, (arr = []));
    arr.push(geo);
    return geo;
  }

  /* ---- primitives (y is always the BOTTOM of the shape) ---- */
  box(mat, x, y, z, w, h, d, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (opts.solid !== false) {
      const rot = opts.rotY || 0;
      const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      this.collision.add(x, z, w * c + d * s, w * s + d * c, y, h, opts.tag || 'landmark');
    }
    return g;
  }
  cyl(mat, x, y, z, rTop, rBot, h, seg = 12, opts = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!opts.open);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (opts.solid) this.collision.add(x, z, rBot * 2, rBot * 2, y, h, opts.tag || 'landmark');
    return g;
  }
  cone(mat, x, y, z, r, h, seg = 8, opts = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (opts.solid) this.collision.add(x, z, r * 1.7, r * 1.7, y, h, opts.tag || 'landmark');
    return g;
  }
  sphere(mat, x, y, z, r, opts = {}) {
    const g = new THREE.SphereGeometry(r, opts.seg || 10, opts.seg2 || 7, 0, Math.PI * 2, 0, opts.phi || Math.PI);
    if (opts.sy) g.scale(1, opts.sy, 1);
    g.translate(x, y, z);
    this._push(mat, g);
    return g;
  }
  raw(mat, geo) { return this._push(mat, geo); }
  /** Collision box with no geometry — invisible blockers and floors. */
  solid(x, z, w, d, y, h, tag = 'landmark') { this.collision.add(x, z, w, d, y, h, tag); }

  /** Disc facing along ±Z (clock faces, oculi). */
  discZ(mat, x, y, z, r, thick = 0.35, seg = 20) {
    const g = new THREE.CylinderGeometry(r, r, thick, seg);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    return this._push(mat, g);
  }

  /** Positioned gable roof; `y` is the eaves height. */
  gable(mat, x, y, z, w, d, h, opts = {}) {
    const g = gableRoof(w, d, h);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y, z);
    return this._push(mat, g);
  }

  /** Hipped / mansard roof: a truncated pyramid over a w x d footprint. */
  hip(mat, x, y, z, w, d, h, topScale = 0.25) {
    const body = new THREE.CylinderGeometry(0.5, 0.5, h, 4, 1);
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) + h / 2) / h;
      const sc = 1 - (1 - topScale) * t;
      p.setX(i, p.getX(i) * w * sc);
      p.setZ(i, p.getZ(i) * d * sc);
    }
    body.computeVertexNormals();
    body.translate(x, y + h / 2, z);
    return this._push(mat, body);
  }

  /* ---- shared parts ---- */
  /** Memoised part geometry. Never mutate what this returns; `place()` clones. */
  p(name, ...args) {
    const key = name + '|' + args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : a)).join(',');
    let g = this.cache.get(key);
    if (g === undefined) {
      const f = PARTS[name];
      if (!f) throw new Error(`landmarks/detail.js: unknown part "${name}"`);
      g = f(...args);
      this.cache.set(key, g);
    }
    return g;
  }
  /** Clone a shared part, place it, bucket it. */
  place(mat, geo, x, y, z, o = {}) {
    const g = geo.clone();
    const s = o.scale ?? 1;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rotX || 0, o.rotY || 0, o.rotZ || 0, 'YXZ')),
      new THREE.Vector3(o.sx ?? s, o.sy ?? s, o.sz ?? s),
    );
    g.applyMatrix4(m);
    return this._push(mat, g);
  }

  /**
   * Gothic window with real tracery plus its glazing, in one call.
   * The stone goes to the ornament tier, the glass to the structural tier so
   * the lit openings still read once the tracery has been LOD'd away.
   */
  window(x, y, z, w, h, o = {}) {
    const { rotY = 0, lights = 2, kind = 'gothic', glass = this.M.litGlass, stone = this.M.stonePale } = o;
    const parts = kind === 'baroque'
      ? this.p('baroqueWindow', w, h, { depth: o.depth ?? 0.4 })
      : this.p('traceryWindow', w, h, { lights, depth: o.depth ?? 0.42, lobes: o.lobes ?? 3, head: o.head !== false });
    const t = this._tier;
    this.tier(1).place(stone, parts.stone, x, y, z, { rotY });
    this.tier(0).place(glass, parts.glass, x, y, z, { rotY });
    this._tier = t;
  }

  /**
   * Moulding sweep around a plan. `y` is the bottom of the profile, so
   * `mould(M.stone, x, eaves, z, w, d, PROFILE.cornice)` caps a wall.
   * Pass `o.path` for anything that is not a rectangle.
   */
  mould(mat, x, y, z, w, d, profile, o = {}) {
    const g = sweepProfile(profile, o.path || rectPath(w, d), {
      closed: o.closed !== false, y, uScale: o.uScale ?? 3, vScale: o.vScale ?? 1.2,
    });
    if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, 0, z);
    return this._push(mat, g);
  }

  /** Balustrade: capped rail on turned balusters, plus a matching plinth. */
  balustrade(x, y, z, len, o = {}) {
    const { rotY = 0, h = 1.1, mat = this.M.stonePale, spacing = 0.82, solid = false } = o;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const t = this._tier;
    const band = (prof, w, d, yy) => {
      const g = sweepProfile(prof, rectPath(w, d), { closed: true, y: yy });
      if (rotY) g.rotateY(rotY);
      g.translate(x, 0, z);
      this.raw(mat, g);
    };
    this.tier(0);
    band([[0, 0], [0.19, 0.06], [0.19, 0.2], [0, 0.26]], len, 0.42, y);
    band([[0, 0], [0.24, 0.07], [0.2, 0.19], [0, 0.24]], len, 0.36, y + h - 0.24);
    this.tier(1);
    const bal = this.p('baluster', h - 0.5, 0.15);
    const n = Math.max(2, Math.floor(len / spacing));
    for (let i = 0; i < n; i++) {
      const u = -len / 2 + (len / (n - 1)) * i;
      this.place(mat, bal, x + cos * u, y + 0.26, z + sin * u, {});
    }
    this._tier = t;
    if (solid) this.collision.add(x, z, Math.abs(cos) * len + 0.5, Math.abs(sin) * len + 0.5, y, h, 'landmark');
  }

  /**
   * Crenellated wall cap: merlons with embrasures between them. `rotY` is the
   * direction the wall runs, read as `(cos rotY, sin rotY)` in the xz plane —
   * the merlons are counter-rotated to match, because a `rotY` rotation maps a
   * part's local +x to `(cos, -sin)`.
   */
  crenellate(x, y, z, len, o = {}) {
    const { rotY = 0, mat = this.M.stone, w = 2.0, h = 1.5, d = 1.0, gap = 1.3 } = o;
    const cos = Math.cos(rotY), sin = Math.sin(rotY);
    const step = w + gap;
    const n = Math.max(1, Math.floor(len / step));
    const m = this.p('merlon', w, h, d);
    const start = -((n - 1) * step) / 2;
    for (let i = 0; i < n; i++) {
      const u = start + i * step;
      this.place(mat, m, x + cos * u, y, z + sin * u, { rotY: -rotY });
    }
  }

  /**
   * Collision-only ring: a round basin should stop you walking into the water
   * without turning the whole square into one solid block.
   */
  collisionRing(x, z, radius, thickness, y, h, seg = 10) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = x + Math.cos(a) * radius;
      const cz = z + Math.sin(a) * radius;
      const w = Math.max(thickness, (Math.PI * 2 * radius) / seg * 0.62);
      this.collision.add(cx, cz, Math.abs(Math.cos(a)) * thickness + Math.abs(Math.sin(a)) * w,
        Math.abs(Math.sin(a)) * thickness + Math.abs(Math.cos(a)) * w, y, h, 'prop');
    }
  }

  /**
   * Terraced mound. Each ring rises by `rise`, which must stay under the
   * player's step height (0.7 m) so the whole hill is walkable from any side.
   */
  mound(matLow, matHigh, cx, cz, sizeOuter, sizeInner, height, rise = STEP_RISE) {
    const rings = Math.max(2, Math.round(height / rise));
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const size = sizeOuter + (sizeInner - sizeOuter) * t;
      const y = i * (height / rings);
      this.box(t > 0.62 ? matHigh : matLow, cx, y, cz, size, height / rings + 0.04, size, { tag: 'terrain' });
    }
  }

  /** Steps you can walk up: n treads of `rise` height. */
  stairs(mat, x, y, z, w, dirX, dirZ, n, rise = 0.42, run = 0.55) {
    for (let i = 0; i < n; i++) {
      const px = x + dirX * i * run;
      const pz = z + dirZ * i * run;
      const h = y + (i + 1) * rise;
      const bw = dirX ? run + 0.02 : w;
      const bd = dirX ? w : run + 0.02;
      this.box(mat, px, 0, pz, bw, h, bd, { tag: 'stairs' });
    }
  }

  /**
   * Merge every bucket into meshes. Returns the LOD clusters so the caller can
   * wire a distance switch. One mesh per material for the structural tier, one
   * per (cluster, ornament material) for the ornament tier.
   */
  finish(group, opts = {}) {
    const lods = [];
    for (const [mat, geos] of this.base) {
      const merged = mergeAll(geos);
      if (!merged) continue;
      const tile = this._tileMetres(mat);
      if (tile) worldSpaceUV(merged, tile);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `landmark-${mat.name || 'mat'}`;
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    for (const [name, byMat] of this.orn) {
      const g = new THREE.Group();
      g.name = `ornament-${name}`;
      g.matrixAutoUpdate = false;
      const box = new THREE.Box3();
      for (const [mat, geos] of byMat) {
        const merged = mergeAll(geos);
        if (!merged) continue;
        const tile = this._tileMetres(mat);
        if (tile) worldSpaceUV(merged, tile);
        merged.computeBoundingBox();
        box.union(merged.boundingBox);
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `ornament-${name}-${mat.name || 'mat'}`;
        /* Ornament is deliberately excluded from the shadow casters. A crocket
           casts a shadow a few pixels wide, but every shadow cascade re-renders
           it, so ornament in the shadow pass costs its triangle count several
           times over for detail nobody can see. The wall, roof and spire it sits
           on are structural-tier and do cast, so the silhouette shadow is
           unchanged. It still RECEIVES shadow, which is what makes carving read. */
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        g.add(mesh);
      }
      if (!g.children.length) continue;
      group.add(g);
      const centre = box.getCenter(new THREE.Vector3());
      lods.push({ name, group: g, centre, radius: box.getSize(new THREE.Vector3()).length() * 0.5 });
    }
    this.base.clear();
    this.orn.clear();
    for (const g of this.cache.values()) {
      if (g && g.dispose) g.dispose();
      else if (g) for (const k of Object.keys(g)) g[k] && g[k].dispose && g[k].dispose();
    }
    this.cache.clear();
    return lods;
  }
}

export { gableRoof };
