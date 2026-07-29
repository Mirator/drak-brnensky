import * as THREE from 'three';

/**
 * Very light-weight collision world: everything solid in Brno is an axis-aligned
 * box. Enough for a fast arcade action game, and it lets us stand on rooftops,
 * castle terraces and market stalls for free.
 *
 * Boxes live in a uniform grid so lookups stay cheap even with ~3000 of them.
 */
const CELL = 24;

/* ==================================================================
   Surface materials.

   Every collider carries one. The rigid body solver reads friction and
   restitution off it, the audio engineer picks a footstep/impact sound from
   `id`, and the VFX engineer picks a decal and particle colour from `id` /
   `colour`. Colliders added without an explicit surface get one inferred from
   their tag, so every existing `add()` call keeps working unchanged.
   ================================================================== */
export const SURFACES = {
  stone:   { id: 'stone',   friction: 0.72, restitution: 0.16, hardness: 0.95, colour: 0x8d8779 },
  asphalt: { id: 'asphalt', friction: 0.88, restitution: 0.06, hardness: 0.70, colour: 0x3a3a3d },
  cobble:  { id: 'cobble',  friction: 0.80, restitution: 0.20, hardness: 0.85, colour: 0x6f6a60 },
  wood:    { id: 'wood',    friction: 0.62, restitution: 0.26, hardness: 0.40, colour: 0x7a5a34 },
  metal:   { id: 'metal',   friction: 0.42, restitution: 0.34, hardness: 0.90, colour: 0x9aa0a6 },
  glass:   { id: 'glass',   friction: 0.26, restitution: 0.10, hardness: 0.15, colour: 0xbfe6ef },
  grass:   { id: 'grass',   friction: 0.94, restitution: 0.04, hardness: 0.25, colour: 0x53703a },
};

/** Fallback for colliders whose tag we do not recognise. */
export const DEFAULT_SURFACE = SURFACES.stone;

/** Tag → surface, so the thousands of existing `add()` calls get sane values. */
const TAG_SURFACE = {
  solid: 'stone',
  building: 'stone',
  landmark: 'stone',
  nostand: 'stone',
  terrace: 'cobble',
  street: 'asphalt',
  park: 'grass',
  tree: 'wood',
  prop: 'wood',
  stall: 'wood',
  tram: 'metal',
  fence: 'metal',
  window: 'glass',
};

/** Accepts a surface object, a SURFACES key, or nothing (infer from tag). */
export function resolveSurface(surface, tag = 'solid') {
  if (surface) {
    if (typeof surface === 'string') return SURFACES[surface] || DEFAULT_SURFACE;
    if (typeof surface.friction === 'number') return surface;
  }
  return SURFACES[TAG_SURFACE[tag]] || DEFAULT_SURFACE;
}

export class CollisionWorld {
  constructor() {
    /** @type {{x0:number,z0:number,x1:number,z1:number,top:number,bottom:number,tag:string}[]} */
    this.boxes = [];
    this.grid = new Map();
    this.bounds = { x0: -Infinity, z0: -Infinity, x1: Infinity, z1: Infinity };
    /** Surface of the implicit street plane at y = 0. */
    this.groundSurface = SURFACES.cobble;
  }

  key(cx, cz) {
    return cx * 100000 + cz;
  }

  /**
   * Add a solid box. x/z are centre, w/d full extents, y0 bottom, h height.
   * `surface` is optional (a SURFACES key or object); it is inferred from the
   * tag when omitted.
   */
  add(x, z, w, d, y0, h, tag = 'solid', surface = null) {
    const box = {
      x0: x - w / 2,
      x1: x + w / 2,
      z0: z - d / 2,
      z1: z + d / 2,
      bottom: y0,
      top: y0 + h,
      tag,
      surface: resolveSurface(surface, tag),
    };
    this.boxes.push(box);
    const cx0 = Math.floor(box.x0 / CELL);
    const cx1 = Math.floor(box.x1 / CELL);
    const cz0 = Math.floor(box.z0 / CELL);
    const cz1 = Math.floor(box.z1 / CELL);
    // Remember the occupied cell range: `remove()` must clear exactly the cells
    // `add()` wrote to, even if a caller has since nudged the box extents.
    box._cx0 = cx0; box._cx1 = cx1; box._cz0 = cz0; box._cz1 = cz1;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = this.key(cx, cz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(box);
      }
    }
    return box;
  }

  /** Remove a previously-added box from both the master list and spatial grid. */
  remove(box) {
    if (!box) return false;
    const index = this.boxes.indexOf(box);
    if (index < 0) return false;
    this.boxes.splice(index, 1);

    const cx0 = box._cx0 !== undefined ? box._cx0 : Math.floor(box.x0 / CELL);
    const cx1 = box._cx1 !== undefined ? box._cx1 : Math.floor(box.x1 / CELL);
    const cz0 = box._cz0 !== undefined ? box._cz0 : Math.floor(box.z0 / CELL);
    const cz1 = box._cz1 !== undefined ? box._cz1 : Math.floor(box.z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const key = this.key(cx, cz);
        const list = this.grid.get(key);
        if (!list) continue;
        // A box is only ever pushed once per cell, but splice defensively in a
        // loop so a double-add can never leave a ghost collider behind.
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i] === box) list.splice(i, 1);
        }
        if (list.length === 0) this.grid.delete(key);
      }
    }
    return true;
  }

  /** Remove a batch of colliders (a broken prop owns several). Returns the count removed. */
  removeAll(boxes) {
    let n = 0;
    if (!boxes) return 0;
    for (let i = 0; i < boxes.length; i++) if (this.remove(boxes[i])) n++;
    return n;
  }

  /** All boxes potentially overlapping the given world-space rect. */
  query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    const cx0 = Math.floor(x0 / CELL);
    const cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL);
    const cz1 = Math.floor(z1 / CELL);
    const seen = _seen;
    seen.clear();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (seen.has(b)) continue;
          seen.add(b);
          if (b.x1 < x0 || b.x0 > x1 || b.z1 < z0 || b.z0 > z1) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  /**
   * Highest surface at (x,z) that is at or below `fromY` (+ a small step
   * tolerance). Returns 0 (street level) when nothing is found.
   */
  groundHeight(x, z, fromY = 1e6, radius = 0.35, step = 0.65) {
    const boxes = this.query(x - radius, z - radius, x + radius, z + radius, _tmpA);
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.tag === 'nostand') continue;
      if (b.top <= fromY + step && b.top > best) best = b.top;
    }
    return best;
  }

  /** Is the point inside any solid box? */
  isSolidAt(x, y, z) {
    const boxes = this.query(x, z, x, z, _tmpA);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (y > b.bottom + 0.01 && y < b.top - 0.01) return true;
    }
    return false;
  }

  /**
   * Push a vertical capsule (circle in plan) out of every box it intersects.
   * `feetY` is the bottom of the capsule, `height` its height.
   * Mutates `pos` (a THREE.Vector3) and returns true when something was hit.
   */
  resolve(pos, radius, height, stepUp = 0.7) {
    let hit = false;
    const headY = pos.y + height;
    for (let iter = 0; iter < 3; iter++) {
      // A push from the previous pass can move the capsule into a box that was
      // outside its old query rectangle, so refresh candidates every pass.
      const boxes = this.query(
        pos.x - radius, pos.z - radius,
        pos.x + radius, pos.z + radius,
        _tmpB,
      );
      let moved = false;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        // Vertical overlap? Ignore boxes we can simply step onto.
        if (b.top <= pos.y + stepUp) continue;
        if (b.bottom >= headY) continue;
        const cx = Math.max(b.x0, Math.min(pos.x, b.x1));
        const cz = Math.max(b.z0, Math.min(pos.z, b.z1));
        let dx = pos.x - cx;
        let dz = pos.z - cz;
        let d2 = dx * dx + dz * dz;
        if (d2 > radius * radius) continue;
        if (d2 < 1e-8) {
          // Centre inside the box: eject along the shortest axis.
          const toL = pos.x - b.x0, toR = b.x1 - pos.x;
          const toT = pos.z - b.z0, toB = b.z1 - pos.z;
          const m = Math.min(toL, toR, toT, toB);
          if (m === toL) pos.x = b.x0 - radius;
          else if (m === toR) pos.x = b.x1 + radius;
          else if (m === toT) pos.z = b.z0 - radius;
          else pos.z = b.z1 + radius;
        } else {
          const d = Math.sqrt(d2);
          const push = (radius - d) / d;
          pos.x += dx * push;
          pos.z += dz * push;
        }
        hit = true;
        moved = true;
      }
      if (!moved) break;
    }
    // Keep everyone inside the playable area.
    const bb = this.bounds;
    pos.x = Math.max(bb.x0, Math.min(bb.x1, pos.x));
    pos.z = Math.max(bb.z0, Math.min(bb.z1, pos.z));
    return hit;
  }

  /**
   * Raycast against candidate AABBs with an exact slab intersection. Returns
   * hit distance or Infinity. `stepSize` is retained for caller compatibility.
   */
  raycast(origin, dir, maxDist, stepSize = 0.6) {
    void stepSize;
    let nearest = Infinity;

    if (origin.y < 0) return 0;
    if (dir.y < -1e-9) {
      const groundT = -origin.y / dir.y;
      if (groundT <= maxDist) nearest = groundT;
    }

    const endX = origin.x + dir.x * maxDist;
    const endZ = origin.z + dir.z * maxDist;
    const boxes = this.query(
      Math.min(origin.x, endX), Math.min(origin.z, endZ),
      Math.max(origin.x, endX), Math.max(origin.z, endZ),
      _rayBoxes,
    );
    for (let i = 0; i < boxes.length; i++) {
      const t = rayBoxDistance(origin, dir, boxes[i], Math.min(maxDist, nearest));
      if (t < nearest) nearest = t;
    }
    return nearest;
  }

  /* ================================================================
     Surfaces and richer casts. All additive — nothing above changed.
     ================================================================ */

  /** Surface descriptor of a collider (or the street plane for `null`). */
  surfaceOf(box) {
    if (!box) return this.groundSurface;
    return box.surface || DEFAULT_SURFACE;
  }

  /**
   * Surface at a world point: the collider containing it, else the collider
   * whose top the point is resting on, else the street plane. Used by audio for
   * footsteps and by VFX for decals/particle colour.
   */
  surfaceAt(x, y, z, tolerance = 0.12) {
    const boxes = this.query(x, z, x, z, _tmpA);
    let best = null;
    let bestTop = -Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (y > b.bottom - tolerance && y < b.top + tolerance && b.top > bestTop) {
        bestTop = b.top;
        best = b;
      }
    }
    return this.surfaceOf(best);
  }

  /**
   * Like `raycast()` but reports the hit normal, collider and surface. Returns
   * the shared `out` record; check `out.hit`. `ignoreGround` skips the implicit
   * street plane at y = 0, which is what explosion occlusion wants (otherwise
   * the ground itself shadows debris lying on it).
   */
  raycastHit(origin, dir, maxDist, out = _hit, ignoreGround = false) {
    out.hit = false;
    out.t = Infinity;
    out.box = null;
    out.surface = null;
    out.nx = 0; out.ny = 1; out.nz = 0;
    out.px = origin.x; out.py = origin.y; out.pz = origin.z;

    let nearest = Infinity;
    let axis = -1;
    let sign = 1;
    let hitBox = null;
    let ground = false;

    if (!ignoreGround) {
      if (origin.y < 0) {
        out.hit = true;
        out.t = 0;
        out.surface = this.groundSurface;
        out.py = 0;
        return out;
      }
      if (dir.y < -1e-9) {
        const t = -origin.y / dir.y;
        if (t <= maxDist) { nearest = t; ground = true; }
      }
    }

    const endX = origin.x + dir.x * maxDist;
    const endZ = origin.z + dir.z * maxDist;
    const boxes = this.query(
      Math.min(origin.x, endX), Math.min(origin.z, endZ),
      Math.max(origin.x, endX), Math.max(origin.z, endZ),
      _rayBoxes,
    );
    for (let i = 0; i < boxes.length; i++) {
      if (!slabHit(origin, dir, boxes[i], Math.min(maxDist, nearest), 0, _slab)) continue;
      if (_slab.t >= nearest) continue;
      nearest = _slab.t;
      axis = _slab.axis;
      sign = _slab.sign;
      hitBox = boxes[i];
      ground = false;
    }

    if (nearest === Infinity) return out;
    out.hit = true;
    out.t = nearest;
    out.px = origin.x + dir.x * nearest;
    out.py = origin.y + dir.y * nearest;
    out.pz = origin.z + dir.z * nearest;
    if (ground) {
      out.ny = 1;
      out.surface = this.groundSurface;
      return out;
    }
    out.box = hitBox;
    out.surface = this.surfaceOf(hitBox);
    out.nx = 0; out.ny = 0; out.nz = 0;
    if (axis === 0) out.nx = sign;
    else if (axis === 1) out.ny = sign;
    else if (axis === 2) out.nz = sign;
    else { // started inside the collider — face straight back along the ray
      out.nx = -dir.x; out.ny = -dir.y; out.nz = -dir.z;
    }
    return out;
  }

  /**
   * Swept sphere against the collider grid. Analytic (colliders are inflated by
   * `radius` and slab-tested), so it cannot tunnel however fast the sphere is
   * travelling — the fix for the thin-wall case the ray march used to miss.
   * Corners are treated as square rather than rounded, so a graze within
   * `radius` of an edge can report slightly early; for projectiles and
   * continuous-collision clamping that is the safe direction to be wrong in.
   */
  sweepSphere(origin, dir, maxDist, radius, out = _hit) {
    out.hit = false;
    out.t = Infinity;
    out.box = null;
    out.surface = null;
    out.nx = 0; out.ny = 1; out.nz = 0;
    out.px = origin.x; out.py = origin.y; out.pz = origin.z;

    let nearest = Infinity;
    let axis = -1;
    let sign = 1;
    let hitBox = null;
    let ground = false;

    if (origin.y <= radius) {
      nearest = 0;
      ground = true;
    } else if (dir.y < -1e-9) {
      const t = (radius - origin.y) / dir.y;
      if (t >= 0 && t <= maxDist) { nearest = t; ground = true; }
    }

    const endX = origin.x + dir.x * maxDist;
    const endZ = origin.z + dir.z * maxDist;
    const boxes = this.query(
      Math.min(origin.x, endX) - radius, Math.min(origin.z, endZ) - radius,
      Math.max(origin.x, endX) + radius, Math.max(origin.z, endZ) + radius,
      _sweepBoxes,
    );
    for (let i = 0; i < boxes.length; i++) {
      if (!slabHit(origin, dir, boxes[i], Math.min(maxDist, nearest), radius, _slab)) continue;
      if (_slab.t >= nearest) continue;
      nearest = _slab.t;
      axis = _slab.axis;
      sign = _slab.sign;
      hitBox = boxes[i];
      ground = false;
    }

    if (nearest === Infinity) return out;
    out.hit = true;
    out.t = nearest;
    out.px = origin.x + dir.x * nearest;
    out.py = origin.y + dir.y * nearest;
    out.pz = origin.z + dir.z * nearest;
    if (ground) {
      out.ny = 1;
      out.surface = this.groundSurface;
      return out;
    }
    out.box = hitBox;
    out.surface = this.surfaceOf(hitBox);
    out.nx = 0; out.ny = 0; out.nz = 0;
    if (axis === 0) out.nx = sign;
    else if (axis === 1) out.ny = sign;
    else if (axis === 2) out.nz = sign;
    else { out.nx = -dir.x; out.ny = -dir.y; out.nz = -dir.z; }
    return out;
  }

  hasLineOfSight(a, b, maxDist = 200) {
    const dir = _rayD.subVectors(b, a);
    const dist = dir.length();
    if (dist > maxDist) return false;
    dir.divideScalar(dist);
    return this.raycast(a, dir, dist - 0.5, 1.0) === Infinity;
  }
}

const _seen = new Set();
const _tmpA = [];
const _tmpB = [];
const _rayBoxes = [];
const _sweepBoxes = [];
const _rayD = new THREE.Vector3();
const _slab = { t: 0, axis: -1, sign: 1 };
const _hit = {
  hit: false, t: Infinity, px: 0, py: 0, pz: 0,
  nx: 0, ny: 1, nz: 0, box: null, surface: null,
};
const _lo = [0, 0, 0];
const _hi = [0, 0, 0];
const _org = [0, 0, 0];
const _dir = [0, 0, 0];

/**
 * Ray/AABB slab test that also reports which face was entered. `expand`
 * inflates the box (Minkowski sum with a sphere) so the same routine serves the
 * swept-sphere test. Writes into `out`; returns false on a miss.
 */
function slabHit(origin, dir, box, maxDist, expand, out) {
  if (maxDist < 0) return false;
  _org[0] = origin.x; _org[1] = origin.y; _org[2] = origin.z;
  _dir[0] = dir.x; _dir[1] = dir.y; _dir[2] = dir.z;
  _lo[0] = box.x0 - expand; _lo[1] = box.bottom - expand; _lo[2] = box.z0 - expand;
  _hi[0] = box.x1 + expand; _hi[1] = box.top + expand; _hi[2] = box.z1 + expand;

  let tMin = 0;
  let tMax = maxDist;
  let axis = -1;
  let sign = 1;
  for (let a = 0; a < 3; a++) {
    const d = _dir[a];
    if (d > -1e-9 && d < 1e-9) {
      if (_org[a] < _lo[a] || _org[a] > _hi[a]) return false;
      continue;
    }
    const inv = 1 / d;
    let t1 = (_lo[a] - _org[a]) * inv;
    let t2 = (_hi[a] - _org[a]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tMin) { tMin = t1; axis = a; sign = s; }
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return false;
  }
  if (tMin > maxDist || tMax < 0) return false;
  out.t = tMin > 0 ? tMin : 0;
  out.axis = axis;
  out.sign = sign;
  return true;
}

function rayBoxDistance(origin, dir, box, maxDist) {
  let tMin = 0;
  let tMax = maxDist;

  if (Math.abs(dir.x) < 1e-9) {
    if (origin.x < box.x0 || origin.x > box.x1) return Infinity;
  } else {
    let a = (box.x0 - origin.x) / dir.x;
    let b = (box.x1 - origin.x) / dir.x;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return Infinity;
  }

  if (Math.abs(dir.y) < 1e-9) {
    if (origin.y < box.bottom || origin.y > box.top) return Infinity;
  } else {
    let a = (box.bottom - origin.y) / dir.y;
    let b = (box.top - origin.y) / dir.y;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return Infinity;
  }

  if (Math.abs(dir.z) < 1e-9) {
    if (origin.z < box.z0 || origin.z > box.z1) return Infinity;
  } else {
    let a = (box.z0 - origin.z) / dir.z;
    let b = (box.z1 - origin.z) / dir.z;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    if (tMin > tMax) return Infinity;
  }

  return tMin <= maxDist && tMax >= 0 ? Math.max(0, tMin) : Infinity;
}
