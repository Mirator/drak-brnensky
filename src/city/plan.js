import * as THREE from 'three';
import { getMaterial } from '../materials.js';
/* Real-world tile sizes for the ground generators. A namespace import so a
 * change to that module's export set can never break the city build. */
import * as groundTiles from '../textures/ground.js';
import { makeTexture } from '../textures.js';
import { Batches, label } from './mesh.js';
import {
  MAP_SIZE, HALF, TEX_SIZE, FLAG, ROADS, PLAZAS, offsetPolyline, inCore,
} from './layout.js';

/**
 * The ground plan: (a) the painted 4096² plan that becomes the base ground
 * texture and the minimap, and (b) real normal-mapped relief laid on top of
 * it — granite setts in fan pattern on the squares and running bond in the
 * streets, asphalt on the through-roads, kerbs with a genuine height step,
 * tactile paving at the crossings, drain covers, tram grooves and puddles.
 *
 * Both halves read the same road/plaza tables, so the paint and the relief
 * always agree, and both are driven by the injected seeded Rng so two
 * reloads paint an identical plan and an identical minimap.
 */

const PAVE = 3.2;         // pavement width either side of the carriageway
const KERB_H = 0.11;      // real kerb step
const GAUGE = 1.435;      // standard tram gauge, per the dossier
const TRACK_W = 3.0;      // paved strip per tram track

/**
 * Metres of world per texture tile, per surface.
 *
 * These are not free parameters. Each generator lays a fixed number of units
 * across its tile, so the tile size is what sets the real-world size of a
 * sett, a slab or a tactile blister — get it wrong and correct-looking fan
 * bond reads as shopping-centre floor tiling.
 *
 * `src/textures/ground.js` publishes the authoritative figure for every
 * generator it owns (`SETT_TILE_M`, `FAN_SETT_TILE_M`, ...), derived from a
 * 0.10 m granite sett module, so those are consumed rather than guessed
 * here. Asphalt and grass are noise rather than units and keep a large tile
 * precisely so the repeat does not read.
 */
const tileM = (name, fallback) => (typeof groundTiles[name] === 'number'
  ? groundTiles[name] : fallback);

const TILE = {
  fan: tileM('FAN_SETT_TILE_M', 3.1),
  sett: tileM('SETT_TILE_M', 2.0),
  track: tileM('SETT_TILE_M', 2.0),
  slab: tileM('SLAB_TILE_M', 1.6),
  kerb: tileM('KERB_TILE_M', 1.0),
  tactile: tileM('TACTILE_TILE_M', 0.4),
  drain: tileM('DRAIN_TILE_M', 0.6),
  gravelPath: tileM('GRAVEL_TILE_M', 1.7),
  dirtPath: tileM('GRAVEL_TILE_M', 1.7) * 0.7,
  asphalt: 6,
  grass: 6,
  rail: 0.6,
};

/* layered heights, spaced far enough apart not to z-fight at range */
const Y = {
  grass: 0.012,
  plaza: 0.020,
  gravel: 0.026,
  road: 0.032,
  track: 0.044,
  puddle: 0.052,
  drain: 0.060,
  rail: 0.070,
  pavement: KERB_H,
  tactile: KERB_H + 0.02,
};

/** Pavement width for a road. Painted plan and plot frontages MUST agree on
 * this: if the painted ROAD band is wider than the frontage offset, every
 * plot on that street fails its free-ground test and the street wall never
 * gets built. */
export function paveWidth(road) {
  return road.w >= 14 ? PAVE : PAVE * 0.75;
}

/** Track centre offsets for a road: one track on narrow streets, two on wide. */
export function trackOffsets(road) {
  return road.w >= 14 ? [-1.55, 1.55] : [0];
}

/* ================================================================== */
/* 1. paint the plan                                                   */
/* ================================================================== */
export function paintPlan(painter, rng) {
  const pc = painter.pc;
  const S = painter.sP;
  painter.fill('#3b3a35', FLAG.FREE);

  // organic base grain over the whole city (block interiors, courtyards)
  for (let i = 0; i < 26000; i++) {
    pc.globalAlpha = rng.float(0.05, 0.14);
    pc.fillStyle = rng.chance(0.5) ? '#2b2a26' : '#4b4941';
    const s = rng.float(6, 40);
    pc.fillRect(rng.float(0, TEX_SIZE), rng.float(0, TEX_SIZE), s, s);
  }
  pc.globalAlpha = 1;

  /* ---- parks & squares ---- */
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    if (p.type === FLAG.PARK) {
      painter.rect(cx, cz, w, d, '#3c5a33', FLAG.PARK);
      for (let i = 0; i < 900; i++) {
        pc.globalAlpha = rng.float(0.1, 0.26);
        pc.fillStyle = rng.chance(0.5) ? '#2f4a29' : '#4d6d3c';
        pc.fillRect(
          painter.px(cx - w / 2 + rng.float(0, w)),
          painter.px(cz - d / 2 + rng.float(0, d)),
          rng.float(8, 34), rng.float(8, 34),
        );
      }
      pc.globalAlpha = 1;
      // gravel paths plus the worn desire-paths that cut the corners
      const paths = parkPaths(p, rng);
      for (const path of paths) painter.line(path.pts, path.w, path.dirt ? '#6b5f49' : '#8a7f66');
    } else {
      painter.rect(cx, cz, w, d, p.paving === 'slab' ? '#7b766c' : '#6d665b', FLAG.PLAZA);
      pc.save();
      pc.globalAlpha = 0.42;
      if (p.paving === 'fan') {
        // concentric arcs, the plan-scale read of a granite fan pattern
        pc.strokeStyle = '#585248';
        pc.lineWidth = 1.4;
        const cxp = painter.px(cx), czp = painter.px(cz);
        const rmax = Math.hypot(w, d) * 0.55 * S;
        for (let r = 3 * S; r < rmax; r += 2.4 * S) {
          pc.beginPath();
          pc.arc(cxp, czp, r, 0, Math.PI * 2);
          pc.stroke();
        }
      } else {
        pc.strokeStyle = '#5f5a51';
        pc.lineWidth = 1.6;
        const step = 4.5 * S;
        for (let x = painter.px(cx - w / 2); x < painter.px(cx + w / 2); x += step) {
          pc.beginPath();
          pc.moveTo(x, painter.px(cz - d / 2));
          pc.lineTo(x, painter.px(cz + d / 2));
          pc.stroke();
        }
        for (let z = painter.px(cz - d / 2); z < painter.px(cz + d / 2); z += step) {
          pc.beginPath();
          pc.moveTo(painter.px(cx - w / 2), z);
          pc.lineTo(painter.px(cx + w / 2), z);
          pc.stroke();
        }
      }
      pc.restore();
    }
  }

  /* ---- roads: pavement, kerb line, carriageway, markings, rails ---- */
  for (const r of ROADS) {
    const asphalt = r.paving === 'asphalt';
    painter.line(r.pts, r.w + paveWidth(r) * 2, '#8a8478', FLAG.ROAD); // pavement slabs
    painter.line(r.pts, r.w + 1.0, '#6a655c', undefined);           // kerb line
    painter.line(r.pts, r.w, asphalt ? '#2e2f2d' : '#4a453d', FLAG.ROAD);
    if (asphalt) {
      // patched repairs + worn centre line
      for (let i = 0; i < 5; i++) {
        const k = rng.int(0, r.pts.length - 2);
        const seg = r.pts[k];
        const nxt = r.pts[k + 1];
        const t = rng.float(0.1, 0.9);
        const px = seg[0] + (nxt[0] - seg[0]) * t;
        const pz = seg[1] + (nxt[1] - seg[1]) * t;
        pc.globalAlpha = 0.5;
        pc.fillStyle = '#38393a';
        pc.fillRect(painter.px(px - 2.5), painter.px(pz - 2), 5 * S, 4 * S);
        pc.globalAlpha = 1;
      }
      painter.line(r.pts, 0.42, 'rgba(230,225,200,0.42)', undefined, [5, 6]);
    } else {
      painter.line(r.pts, 0.5, 'rgba(120,114,102,0.5)', undefined, [1.2, 1.2]);
    }
    if (r.tram) {
      for (const off of trackOffsets(r)) {
        const centre = off === 0 ? r.pts : offsetPolyline(r.pts, off);
        painter.line(centre, TRACK_W, 'rgba(58,54,48,0.75)', undefined, null, 'butt');
        for (const g of [-GAUGE / 2, GAUGE / 2]) {
          const pts = offsetPolyline(centre, g);
          painter.line(pts, 0.9, 'rgba(24,22,20,0.55)', undefined, null, 'butt'); // groove
          painter.line(pts, 0.34, 'rgba(196,200,206,0.8)', undefined, null, 'butt'); // railhead
        }
      }
    }
  }

  /* ---- zebra crossings at the junctions ---- */
  for (const r of ROADS) {
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
      pc.save();
      pc.globalAlpha = 0.38;
      pc.fillStyle = '#e8e2cf';
      for (let i = -3; i <= 3; i++) {
        pc.fillRect(painter.px(p[0] + i * 1.6) - 2, painter.px(p[1]) - 12, 4, 24);
      }
      pc.restore();
    }
  }

  /* ---- puddles, in the gutters where water actually stands ---- */
  const puddles = puddleSpots(rng);
  pc.save();
  for (const [x, z, r] of puddles) {
    pc.globalAlpha = 0.32;
    pc.fillStyle = '#1d2530';
    pc.beginPath();
    pc.ellipse(painter.px(x), painter.px(z), r * S, r * 0.72 * S, 0, 0, Math.PI * 2);
    pc.fill();
  }
  pc.restore();
  pc.globalAlpha = 1;
  return { puddles };
}

/** Park paths: two gravel spines plus a worn dirt short-cut. */
export function parkPaths(plaza, rng) {
  const [cx, cz, w, d] = plaza.r;
  const hw = w / 2, hd = d / 2;
  const out = [
    {
      w: 3.2,
      pts: [
        [cx - hw, cz - hd / 3 + rng.float(-4, 4)],
        [cx + rng.float(-6, 6), cz + hd / 8],
        [cx + hw, cz - hd / 5 + rng.float(-4, 4)],
      ],
    },
    {
      w: 2.4,
      pts: [
        [cx + rng.float(-hw * 0.3, hw * 0.3), cz - hd],
        [cx + rng.float(-8, 8), cz + rng.float(-6, 6)],
        [cx + rng.float(-hw * 0.3, hw * 0.3), cz + hd],
      ],
    },
    {
      w: 1.1, dirt: true,
      pts: [
        [cx - hw * 0.9, cz + hd * 0.85],
        [cx + rng.float(-10, 10), cz + rng.float(-6, 6)],
        [cx + hw * 0.85, cz - hd * 0.8],
      ],
    },
  ];
  return out;
}

/** Deterministic puddle spots: gutter positions along the roads. */
function puddleSpots(rng) {
  const out = [];
  for (const r of ROADS) {
    const n = Math.max(1, Math.round(r.pts.length * 0.9));
    for (let i = 0; i < n; i++) {
      if (!rng.chance(0.55)) continue;
      const k = rng.int(0, r.pts.length - 2);
      const a = r.pts[k], b = r.pts[k + 1];
      const t = rng.float(0.15, 0.85);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      const side = rng.sign();
      const off = (r.w / 2 - rng.float(0.4, 1.4)) * side;
      out.push([
        a[0] + (b[0] - a[0]) * t + nx * off,
        a[1] + (b[1] - a[1]) * t + nz * off,
        rng.float(1.1, 2.8),
      ]);
    }
  }
  return out;
}

/* ================================================================== */
/* 2. relief: real materials laid over the painted plan                */
/* ================================================================== */

/** Ribbon along a polyline: one continuous strip, no overlap, no gaps. */
function ribbon(batch, pts, halfWidth, y, metres, vTile = null) {
  const left = offsetPolyline(pts, halfWidth);
  const right = offsetPolyline(pts, -halfWidth);
  const across = vTile === null ? (halfWidth * 2) / metres : vTile;
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const seg = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    const u0 = run / metres;
    const u1 = (run + seg) / metres;
    run += seg;
    const a = [right[i][0], y, right[i][1]];
    const b = [left[i][0], y, left[i][1]];
    const c = [left[i + 1][0], y, left[i + 1][1]];
    const d = [right[i + 1][0], y, right[i + 1][1]];
    batch.quad4(a, b, c, d, [u0, 0], [u0, across], [u1, across], [u1, 0]);
  }
}

/** Vertical strip along a polyline — kerb faces, low walls. */
function upstand(batch, pts, y0, h, metres, outward = 1) {
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1];
    const bx = pts[i + 1][0], bz = pts[i + 1][1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const su = len / metres;
    const sv = h / metres;
    if (outward > 0) {
      batch.quad(ax, y0, az, bx - ax, 0, bz - az, 0, h, 0, su, sv);
    } else {
      batch.quad(bx, y0, bz, ax - bx, 0, az - bz, 0, h, 0, su, sv);
    }
  }
}

function flatRect(batch, cx, cz, w, d, y, metres, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hx = w / 2, hz = d / 2;
  const P = (lx, lz) => [cx + lx * c + lz * s, y, cz - lx * s + lz * c];
  batch.quad4(
    P(-hx, -hz), P(-hx, hz), P(hx, hz), P(hx, -hz),
    [0, 0], [0, d / metres], [w / metres, d / metres], [w / metres, 0],
  );
}

/**
 * Build the ground: the painted base plane, then the relief overlays.
 * Every overlay is merged into exactly one mesh per material with UVs baked
 * in metres, so the whole street surface costs about a dozen draw calls.
 */
export function buildGround(group, collision, painter, rng, { puddles }) {
  /* ---- base painted plan ---- */
  const groundTex = makeTexture(painter.pretty, 1, 1);
  groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
  groundTex.anisotropy = 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  group.add(ground);

  /* ---- shared materials (cached: one instance each, city-wide) ---- */
  const M = {
    fan: getMaterial('cobbleFan', { seed: 1301, size: 512 }),
    sett: getMaterial('cobbleRunning', { seed: 1302, size: 512 }),
    track: getMaterial('cobbleTramTrack', { seed: 1303, size: 512 }),
    asphalt: getMaterial('asphalt', { seed: 1304, size: 256 }),
    slab: getMaterial('pavementSlab', { seed: 1305, size: 512 }),
    kerb: getMaterial('kerb', { seed: 1306, size: 256 }),
    tactile: getMaterial('tactilePaving', { seed: 1307, size: 256 }),
    drain: getMaterial('drainCover', { seed: 1308, size: 256 }),
    // gravel and grass are the two most expensive generators in the
    // registry (per-pixel worley / per-3px patch loops), so they run at 256
    // — they are low-frequency surfaces and it costs ~1.8 s of boot to go up
    gravel: getMaterial('gravel', { seed: 1309, size: 256 }),
    grass: getMaterial('grass', { seed: 1310, size: 256 }),
    puddle: getMaterial('puddle', { seed: 1311, size: 256 }),
    rail: getMaterial('tramRail', { seed: 1312, size: 256 }),
  };
  label(M);
  M.puddle.transparent = true;
  M.puddle.depthWrite = false;
  M.puddle.polygonOffset = true;
  M.puddle.polygonOffsetFactor = -2;

  const batches = new Batches();
  const B = (m) => batches.get(m);

  /* ---- parks: grass, gravel paths, dirt desire-paths ---- */
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    if (p.type !== FLAG.PARK) continue;
    flatRect(B(M.grass), cx, cz, w, d, Y.grass, TILE.grass);
    for (const path of parkPaths(p, rng)) {
      ribbon(B(M.gravel), path.pts, path.w / 2, Y.gravel,
        path.dirt ? TILE.dirtPath : TILE.gravelPath);
    }
  }

  /* ---- squares: fan-pattern setts, slab paving on the modern ones ---- */
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    if (p.type !== FLAG.PLAZA) continue;
    const slabbed = p.paving === 'slab';
    flatRect(B(slabbed ? M.slab : M.fan), cx, cz, w, d, Y.plaza,
      slabbed ? TILE.slab : TILE.fan);
  }

  /* ---- streets ---- */
  const drains = [];
  for (const r of ROADS) {
    const carriage = r.paving === 'asphalt' ? M.asphalt : M.sett;
    const pave = paveWidth(r);
    ribbon(B(carriage), r.pts, r.w / 2, Y.road,
      r.paving === 'asphalt' ? TILE.asphalt : TILE.sett);

    for (const side of [-1, 1]) {
      const centre = offsetPolyline(r.pts, side * (r.w / 2 + pave / 2));
      ribbon(B(M.slab), centre, pave / 2, Y.pavement, TILE.slab);
      // kerb: a real vertical step facing the carriageway
      const inner = offsetPolyline(r.pts, side * (r.w / 2 + 0.02));
      upstand(B(M.kerb), inner, 0, KERB_H, TILE.kerb, side > 0 ? 1 : -1);
      // pavement colliders so footsteps and standing height are right
      const segs = centre;
      for (let i = 0; i < segs.length - 1; i++) {
        const ax = segs[i][0], az = segs[i][1], bx = segs[i + 1][0], bz = segs[i + 1][1];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        collision.add(mx, mz, Math.abs(bx - ax) + pave, Math.abs(bz - az) + pave,
          0, KERB_H, 'pavement', 'stone');
      }
    }

    // tram track strips, rails and drain covers
    if (r.tram) {
      for (const off of trackOffsets(r)) {
        const centre = off === 0 ? r.pts : offsetPolyline(r.pts, off);
        ribbon(B(M.track), centre, TRACK_W / 2, Y.track, TILE.track);
        for (const g of [-GAUGE / 2, GAUGE / 2]) {
          const rail = offsetPolyline(centre, g);
          ribbon(B(M.rail), rail, 0.036, Y.rail, TILE.rail, 1);
          upstand(B(M.rail), rail, Y.road, Y.rail - Y.road, 0.5, 1);
          upstand(B(M.rail), rail, Y.road, Y.rail - Y.road, 0.5, -1);
        }
      }
    }

    // tactile paving at each end of the road, on both pavements
    for (const end of [0, r.pts.length - 1]) {
      const p = r.pts[end];
      const near = r.pts[end === 0 ? 1 : r.pts.length - 2];
      const rot = Math.atan2(-(near[1] - p[1]), near[0] - p[0]);
      for (const side of [-1, 1]) {
        const len = Math.hypot(near[0] - p[0], near[1] - p[1]) || 1;
        const nx = -(near[1] - p[1]) / len, nz = (near[0] - p[0]) / len;
        const off = side * (r.w / 2 + pave / 2);
        flatRect(B(M.tactile), p[0] + nx * off, p[1] + nz * off,
          2.0, pave * 0.8, Y.tactile, TILE.tactile, rot);
      }
    }

    // drains in the gutter
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      for (let t = 14; t < len; t += rng.float(26, 46)) {
        const u = t / len;
        const side = rng.sign();
        const off = side * (r.w / 2 - 0.55);
        drains.push([a[0] + (b[0] - a[0]) * u + nx * off, a[1] + (b[1] - a[1]) * u + nz * off]);
      }
    }
  }
  for (const [x, z] of drains) {
    flatRect(B(M.drain), x, z, TILE.drain, TILE.drain, Y.drain, TILE.drain);
  }

  /* ---- puddles ---- */
  for (const [x, z, rad] of puddles) {
    flatRect(B(M.puddle), x, z, rad * 2, rad * 1.5, Y.puddle, rad * 2);
  }

  const meshes = batches.finish(group, { castShadow: false, receiveShadow: true });
  // `plane` is handed back so the LOD can hang its camera probe on the one
  // mesh in the city that is guaranteed to be submitted every frame
  return { meshes: meshes + 1, drains: drains.length, plane: ground };
}

/**
 * The strip of pavement a shopfront, bin or bollard should sit on for a
 * given road: the frontage offset from the centre line.
 */
export function frontageOffset(road) {
  return road.w / 2 + paveWidth(road);
}

export { PAVE, KERB_H, GAUGE, TRACK_W, Y as GROUND_Y };

/** Roads worth putting shopfronts and clutter on, in draw order. */
export function commercialRoads() {
  return ROADS.filter((r) => (r.shops || 0) > 0 || inCore(r.pts[0][0], r.pts[0][1]));
}

/** Straight-line helper reused by props: sample a polyline at distance t. */
export function samplePolyline(pts, t) {
  let run = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (run + len >= t) {
      const u = (t - run) / len;
      return {
        x: a[0] + (b[0] - a[0]) * u,
        z: a[1] + (b[1] - a[1]) * u,
        tx: (b[0] - a[0]) / len,
        tz: (b[1] - a[1]) / len,
      };
    }
    run += len;
  }
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { x: b[0], z: b[1], tx: (b[0] - a[0]) / len, tz: (b[1] - a[1]) / len };
}

/** Total length of a polyline. */
export function polylineLength(pts) {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    n += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  }
  return n;
}
