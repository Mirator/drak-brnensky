import * as THREE from 'three';

/**
 * Very light-weight collision world: everything solid in Brno is an axis-aligned
 * box. Enough for a fast arcade action game, and it lets us stand on rooftops,
 * castle terraces and market stalls for free.
 *
 * Boxes live in a uniform grid so lookups stay cheap even with ~3000 of them.
 */
const CELL = 24;

export class CollisionWorld {
  constructor() {
    /** @type {{x0:number,z0:number,x1:number,z1:number,top:number,bottom:number,tag:string}[]} */
    this.boxes = [];
    this.grid = new Map();
    this.bounds = { x0: -Infinity, z0: -Infinity, x1: Infinity, z1: Infinity };
  }

  key(cx, cz) {
    return cx * 100000 + cz;
  }

  /** Add a solid box. x/z are centre, w/d full extents, y0 bottom, h height. */
  add(x, z, w, d, y0, h, tag = 'solid') {
    const box = {
      x0: x - w / 2,
      x1: x + w / 2,
      z0: z - d / 2,
      z1: z + d / 2,
      bottom: y0,
      top: y0 + h,
      tag,
    };
    this.boxes.push(box);
    const cx0 = Math.floor(box.x0 / CELL);
    const cx1 = Math.floor(box.x1 / CELL);
    const cz0 = Math.floor(box.z0 / CELL);
    const cz1 = Math.floor(box.z1 / CELL);
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
    const boxes = this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, _tmpB);
    let hit = false;
    const headY = pos.y + height;
    for (let iter = 0; iter < 3; iter++) {
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
   * Ray-march against the boxes. Cheap, robust, and accurate enough for
   * bullets and line-of-sight checks. Returns hit distance or Infinity.
   */
  raycast(origin, dir, maxDist, stepSize = 0.6) {
    const p = _rayP.copy(origin);
    let t = 0;
    while (t < maxDist) {
      const s = Math.min(stepSize, maxDist - t);
      p.addScaledVector(dir, s);
      t += s;
      if (p.y < 0) return t;
      if (this.isSolidAt(p.x, p.y, p.z)) return t;
    }
    return Infinity;
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
const _rayP = new THREE.Vector3();
const _rayD = new THREE.Vector3();
