import * as THREE from 'three';
import { C } from './materials.js';

/* ==================================================================
   Verlet cloth for the coat skirt panels and the red scarf tails.

   Both live in ONE dynamic mesh so the whole flapping part of the
   costume is a single draw call. Particle counts are fixed at build
   time and never grow.

   Simulated in world space (so turning the character drags the cloth
   properly) at a fixed 120 Hz with at most 4 substeps per frame, which
   makes 30 Hz and 144 Hz produce identical motion.
   ================================================================== */

const H = 1 / 120;
const MAX_SUB = 4;
const GRAVITY = 11.5;

const SKIRT_COLS = 12;
const SKIRT_ROWS = 4;
const SKIRT_SLIT = 0.62; // radians of open front
const TAIL_LEN = 6;

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _e = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _root = new THREE.Matrix4();

class Particle {
  constructor(x, y, z) {
    this.p = new THREE.Vector3(x, y, z);
    this.prev = new THREE.Vector3(x, y, z);
    this.rest = new THREE.Vector3(x, y, z);
    this.pin = null; // { bone, local } when driven by the skeleton
    this.row = 0;
    this.drag = 0.02;
  }
}

export class CharacterCloth {
  /**
   * @param {ReturnType<import('./rig.js').buildSkeleton>} rig
   * @param {THREE.Material} material vertexColors + DoubleSide
   * @param {import('../rng.js').Rng} rng deterministic per-strip slack
   */
  constructor(rig, material, rng) {
    this.rig = rig;
    this.parts = [];
    this.links = [];
    this.acc = 0;
    this.wind = 0;

    const pos = [];
    const col = [];
    const idx = [];
    let vCount = 0;

    /* ---------------- coat skirt ---------------- */
    const rowY = [0.905, 0.782, 0.652, 0.512];
    const rowR = [0.171, 0.201, 0.222, 0.236];
    const rowMin = [0.168, 0.176, 0.176, 0.170];
    this.skirtMin = rowMin;
    const grid = [];
    for (let r = 0; r < SKIRT_ROWS; r++) {
      const line = [];
      for (let c = 0; c < SKIRT_COLS; c++) {
        const th = SKIRT_SLIT / 2 + (c / (SKIRT_COLS - 1)) * (Math.PI * 2 - SKIRT_SLIT);
        const rad = rowR[r] + rng.float(-0.004, 0.004);
        const x = Math.sin(th) * rad;
        const z = -Math.cos(th) * rad * 0.86;
        const q = new Particle(x, rowY[r], z);
        q.row = r;
        q.drag = 0.03 + r * 0.008;
        if (r === 0) q.pin = { bone: rig.byName.hips, local: new THREE.Vector3() };
        this.parts.push(q);
        line.push(this.parts.length - 1);
      }
      grid.push(line);
    }
    // triangles + colours
    const skirtBase = vCount;
    for (let r = 0; r < SKIRT_ROWS; r++) {
      for (let c = 0; c < SKIRT_COLS; c++) {
        pos.push(0, 0, 0);
        const shade = r === 0 ? C.coat : (c % 2 ? C.coat : C.coatPanel);
        col.push(shade);
        vCount++;
      }
    }
    for (let r = 0; r < SKIRT_ROWS - 1; r++) {
      for (let c = 0; c < SKIRT_COLS - 1; c++) {
        const a = skirtBase + r * SKIRT_COLS + c;
        const b = a + 1;
        const d = a + SKIRT_COLS;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    // constraints
    for (let r = 0; r < SKIRT_ROWS - 1; r++) {
      for (let c = 0; c < SKIRT_COLS; c++) {
        this._link(grid[r][c], grid[r + 1][c], 1);
      }
    }
    for (let r = 1; r < SKIRT_ROWS; r++) {
      for (let c = 0; c < SKIRT_COLS - 1; c++) {
        this._link(grid[r][c], grid[r][c + 1], 0.45);
      }
    }
    // keep the hem from folding under itself
    for (let c = 0; c < SKIRT_COLS; c++) this._link(grid[0][c], grid[2][c], 0.22);
    this.skirt = { grid, base: skirtBase };

    /* ---------------- scarf tails ---------------- */
    this.tails = [];
    const neck = rig.byName.neck;
    const tailSpecs = [
      { x: 0.062, z: 0.030, sway: 1 },
      { x: -0.030, z: 0.058, sway: -1 },
    ];
    for (let t = 0; t < tailSpecs.length; t++) {
      const s = tailSpecs[t];
      const ids = [];
      for (let i = 0; i < TAIL_LEN; i++) {
        const f = i / (TAIL_LEN - 1);
        const q = new Particle(
          s.x + s.sway * f * 0.030 + rng.float(-0.006, 0.006),
          1.505 - f * 0.46,
          s.z + f * 0.075,
        );
        q.drag = 0.055;
        if (i === 0) q.pin = { bone: neck, local: new THREE.Vector3() };
        this.parts.push(q);
        ids.push(this.parts.length - 1);
      }
      for (let i = 0; i < TAIL_LEN - 1; i++) this._link(ids[i], ids[i + 1], 1);
      for (let i = 0; i < TAIL_LEN - 2; i++) this._link(ids[i], ids[i + 2], 0.18);

      // ribbon: two vertices per spine particle
      const base = vCount;
      for (let i = 0; i < TAIL_LEN; i++) {
        pos.push(0, 0, 0, 0, 0, 0);
        const shade = i % 2 ? C.scarf : C.scarfDark;
        col.push(shade, shade);
        vCount += 2;
      }
      for (let i = 0; i < TAIL_LEN - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      this.tails.push({ ids, base, width: 0.042 - t * 0.006 });
    }

    /* ---------------- geometry ---------------- */
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(pos), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    const cArr = new Float32Array(col.length * 3);
    const tmp = new THREE.Color();
    col.forEach((hex, i) => {
      tmp.set(hex);
      cArr[i * 3] = tmp.r; cArr[i * 3 + 1] = tmp.g; cArr[i * 3 + 2] = tmp.b;
    });
    g.setAttribute('color', new THREE.Float32BufferAttribute(cArr, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(vCount * 2), 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(vCount * 3), 3));
    g.setIndex(idx);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);

    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false; // it is authored in parent space every frame
    this.triangles = idx.length / 3;
    this._bound = false;
  }

  _link(i, j, stiffness) {
    const a = this.parts[i].rest;
    const b = this.parts[j].rest;
    this.links.push({ i, j, len: a.distanceTo(b), k: stiffness });
  }

  /**
   * Must run once after the rig is parented and matrices are current:
   * converts each pinned particle's bind position into bone-local space.
   */
  bindPins() {
    for (const q of this.parts) {
      if (!q.pin) continue;
      _inv.copy(q.pin.bone.matrixWorld).invert();
      q.pin.local.copy(q.rest).applyMatrix4(_inv);
    }
    this._bound = true;
  }

  /**
   * Snap everything back to the rest shape (respawn / teleport). Free
   * particles are placed by transforming their BIND-space rest position
   * through the character's current world matrix — resetting them to raw
   * bind space would leave the coat streaking back to the world origin.
   */
  reset() {
    const parent = this.mesh.parent;
    const hasRoot = !!parent;
    if (hasRoot) _root.copy(parent.matrixWorld);
    this.acc = 0; // drop any pending substeps so a restart starts clean
    for (const q of this.parts) {
      if (q.pin && this._bound) {
        q.p.copy(q.pin.local).applyMatrix4(q.pin.bone.matrixWorld);
      } else if (hasRoot) {
        q.p.copy(q.rest).applyMatrix4(_root);
      } else {
        q.p.copy(q.rest);
      }
      q.prev.copy(q.p);
    }
    for (let k = 0; k < 8; k++) this._relax(1);
  }

  /**
   * @param {number} dt
   * @param {{pos:THREE.Vector3, yaw:number, vel:THREE.Vector3, groundY:number, time:number, wind:number}} s
   */
  update(dt, s) {
    if (!this._bound) return;

    // pinned particles ride the skeleton
    let teleported = false;
    for (const q of this.parts) {
      if (!q.pin) continue;
      _v.copy(q.pin.local).applyMatrix4(q.pin.bone.matrixWorld);
      if (q.p.distanceToSquared(_v) > 9) teleported = true;
      q.prev.copy(q.p);
      q.p.copy(_v);
    }
    if (teleported) { this.reset(); this.writeGeometry(); return; }

    // wind: deterministic gust field, plus the character's own draught
    const t = s.time;
    const gust = 0.55 + 0.45 * Math.sin(t * 0.37) * Math.sin(t * 0.11 + 1.3);
    _a.set(
      Math.sin(t * 0.9) * 1.6 * gust - s.vel.x * 0.55,
      Math.sin(t * 1.7) * 0.5 * gust,
      Math.cos(t * 0.8) * 1.6 * gust - s.vel.z * 0.55,
    );
    // never let the draught overpower gravity, or the coat levitates
    const lat = Math.hypot(_a.x, _a.z);
    if (lat > 7.5) { _a.x *= 7.5 / lat; _a.z *= 7.5 / lat; }
    _a.y -= GRAVITY;

    this.acc = Math.min(this.acc + dt, MAX_SUB * H);
    let steps = 0;
    while (this.acc >= H && steps < MAX_SUB) {
      this.acc -= H;
      steps++;
      this._integrate(H, _a);
      this._relax(2);
      this._collide(s);
    }
    this.writeGeometry();
  }

  _integrate(h, acc) {
    const h2 = h * h;
    for (const q of this.parts) {
      if (q.pin) continue;
      _v.copy(q.p).sub(q.prev).multiplyScalar(1 - q.drag);
      q.prev.copy(q.p);
      q.p.add(_v).addScaledVector(acc, h2);
    }
  }

  _relax(iterations) {
    for (let it = 0; it < iterations; it++) {
      for (const L of this.links) {
        const A = this.parts[L.i];
        const B = this.parts[L.j];
        _v.copy(B.p).sub(A.p);
        const d = _v.length();
        if (d < 1e-6) continue;
        const diff = ((d - L.len) / d) * 0.5 * L.k;
        if (!A.pin) A.p.addScaledVector(_v, diff);
        if (!B.pin) B.p.addScaledVector(_v, -diff);
      }
    }
  }

  _collide(s) {
    const cs = Math.cos(s.yaw);
    const sn = Math.sin(s.yaw);
    const floor = s.groundY + 0.02;
    for (const q of this.parts) {
      if (q.pin) continue;
      // keep the skirt outside an ellipse around the legs
      if (q.row > 0) {
        const dx = q.p.x - s.pos.x;
        const dz = q.p.z - s.pos.z;
        const lx = cs * dx - sn * dz;
        const lz = sn * dx + cs * dz;
        const A = this.skirtMin[q.row];
        const Bz = A * 0.78;
        const e = (lx * lx) / (A * A) + (lz * lz) / (Bz * Bz);
        if (e < 1 && e > 1e-6) {
          const f = 1 / Math.sqrt(e);
          const nx = lx * f, nz = lz * f;
          q.p.x = s.pos.x + cs * nx + sn * nz;
          q.p.z = s.pos.z - sn * nx + cs * nz;
        }
      }
      if (q.p.y < floor) q.p.y = floor;
    }
  }

  /** Writes world-space particles into the mesh's parent space. */
  writeGeometry() {
    const parent = this.mesh.parent;
    if (parent) _inv.copy(parent.matrixWorld).invert();
    else _inv.identity();
    const arr = this.posAttr.array;

    const put = (vi, p) => {
      _v.copy(p).applyMatrix4(_inv);
      arr[vi * 3] = _v.x;
      arr[vi * 3 + 1] = _v.y;
      arr[vi * 3 + 2] = _v.z;
    };

    const { grid, base } = this.skirt;
    for (let r = 0; r < SKIRT_ROWS; r++) {
      for (let c = 0; c < SKIRT_COLS; c++) {
        put(base + r * SKIRT_COLS + c, this.parts[grid[r][c]].p);
      }
    }

    for (const tail of this.tails) {
      for (let i = 0; i < TAIL_LEN; i++) {
        const q = this.parts[tail.ids[i]].p;
        const nxt = this.parts[tail.ids[Math.min(i + 1, TAIL_LEN - 1)]].p;
        const prv = this.parts[tail.ids[Math.max(i - 1, 0)]].p;
        _a.copy(nxt).sub(prv);
        if (_a.lengthSq() < 1e-8) _a.set(0, -1, 0);
        _a.normalize();
        _b.set(_a.z, 0, -_a.x);
        if (_b.lengthSq() < 1e-8) _b.set(1, 0, 0);
        _b.normalize().multiplyScalar(tail.width * (1 - i * 0.06));
        _e.copy(q).sub(_b);
        put(tail.base + i * 2, _e);
        _e.copy(q).add(_b);
        put(tail.base + i * 2 + 1, _e);
      }
    }

    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
