import * as THREE from 'three';

/**
 * Triangle-soup batchers.
 *
 * The city builds tens of thousands of small pieces (per-storey facade
 * slabs, cornices, chimneys, kerbs, wires...). Allocating a BufferGeometry
 * for each and handing the pile to mergeGeometries() costs hundreds of
 * milliseconds and a lot of garbage, so bulk city geometry is written
 * straight into growing arrays instead and uploaded once per material.
 *
 * Face normals are emitted analytically (flat shading, which is what boxes
 * and roof prisms want anyway) and UVs are given in *tile* units so a
 * repeating material lands at world scale without per-mesh texture repeats
 * — that is what lets every plot share one merged mesh per material.
 */
export class Batch {
  constructor() {
    this.p = [];
    this.n = [];
    this.t = [];
  }

  get empty() {
    return this.p.length === 0;
  }

  get triangles() {
    return this.p.length / 9;
  }

  /** Triangle with explicit UVs. Winding as given; normal from the cross product. */
  tri(a, b, c, ua, ub, uc) {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) this.n.push(nx, ny, nz);
    this.t.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
  }

  /**
   * Planar quad from a corner `o` and the two full edge vectors `du` (the
   * U axis) and `dv` (the V axis). The outward normal is cross(du, dv), so
   * pick the edge order to face the quad where you want it.
   */
  quad(ox, oy, oz, dux, duy, duz, dvx, dvy, dvz, su = 1, sv = 1, ou = 0, ov = 0) {
    let nx = duy * dvz - duz * dvy;
    let ny = duz * dvx - dux * dvz;
    let nz = dux * dvy - duy * dvx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const bx = ox + dux, by = oy + duy, bz = oz + duz;
    const cx = bx + dvx, cy = by + dvy, cz = bz + dvz;
    const dx = ox + dvx, dy = oy + dvy, dz = oz + dvz;
    this.p.push(ox, oy, oz, bx, by, bz, cx, cy, cz, ox, oy, oz, cx, cy, cz, dx, dy, dz);
    for (let i = 0; i < 6; i++) this.n.push(nx, ny, nz);
    this.t.push(
      ou, ov, ou + su, ov, ou + su, ov + sv,
      ou, ov, ou + su, ov + sv, ou, ov + sv,
    );
  }

  /** General (possibly non-parallelogram) quad a-b-c-d with explicit UVs. */
  quad4(a, b, c, d, ua, ub, uc, ud) {
    this.tri(a, b, c, ua, ub, uc);
    this.tri(a, c, d, ua, uc, ud);
  }

  /**
   * Y-rotated box. `y0` is the bottom, `rot` the rotation about Y.
   * `uv(face, fw, fh)` returns [su, sv, ou, ov] for each emitted face;
   * faces are 0:+X 1:-X 2:+Z 3:-Z 4:+Y 5:-Y with fw/fh in metres.
   * `skip` is an optional 6-entry truthy array of faces to leave out.
   */
  box(cx, y0, cz, w, h, d, rot = 0, uv = null, skip = null) {
    const c = Math.cos(rot), s = Math.sin(rot);
    // local axes after rotateY: +x -> (c,0,-s), +z -> (s,0,c)
    const xx = c * w / 2, xz = -s * w / 2;
    const zx = s * d / 2, zz = c * d / 2;
    const my = y0 + h / 2;
    const hy = h / 2;
    const at = (sx, sy, sz) => [cx + xx * sx + zx * sz, my + hy * sy, cz + xz * sx + zz * sz];
    const f = uv || defaultUV;
    const emit = (face, o, du, dv, fw, fh) => {
      if (skip && skip[face]) return;
      const [su, sv, ou, ov] = f(face, fw, fh);
      this.quad(o[0], o[1], o[2], du[0], du[1], du[2], dv[0], dv[1], dv[2], su, sv, ou, ov);
    };
    const up = [0, h, 0];
    const negZ = [-2 * zx, 0, -2 * zz];
    const posZ = [2 * zx, 0, 2 * zz];
    const negX = [-2 * xx, 0, -2 * xz];
    const posX = [2 * xx, 0, 2 * xz];
    emit(0, at(1, -1, 1), negZ, up, d, h);
    emit(1, at(-1, -1, -1), posZ, up, d, h);
    emit(2, at(-1, -1, 1), posX, up, w, h);
    emit(3, at(1, -1, -1), negX, up, w, h);
    emit(4, at(-1, 1, -1), posZ, posX, d, w);
    emit(5, at(-1, -1, -1), posX, posZ, w, d);
  }

  /**
   * Gable roof prism over a w x d footprint, `h` to the ridge. The ridge
   * runs along the local X axis, then the whole prism is rotated by `rot`.
   * `metres` is metres per texture tile.
   */
  gable(cx, y0, cz, w, d, h, rot = 0, metres = 3) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [cx + lx * c + lz * s, y0 + ly, cz + -lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const A = P(-hw, 0, -hd), B = P(hw, 0, -hd), C = P(hw, 0, hd), D = P(-hw, 0, hd);
    const R1 = P(-hw, h, 0), R2 = P(hw, h, 0);
    const slope = Math.hypot(hd, h) / metres;
    const along = w / metres;
    // north pitch: o=A, u up the slope to R1, v along the ridge to B
    this.quad(A[0], A[1], A[2], R1[0] - A[0], R1[1] - A[1], R1[2] - A[2],
      B[0] - A[0], B[1] - A[1], B[2] - A[2], slope, along);
    // south pitch: o=C, u up the slope to R2, v along the ridge to D
    this.quad(C[0], C[1], C[2], R2[0] - C[0], R2[1] - C[1], R2[2] - C[2],
      D[0] - C[0], D[1] - C[1], D[2] - C[2], slope, along);
    // gable ends
    const gu = d / metres, gh = h / metres;
    this.tri(B, C, R2, [0, 0], [gu, 0], [gu / 2, gh]);
    this.tri(D, A, R1, [0, 0], [gu, 0], [gu / 2, gh]);
  }

  /** Append an existing geometry, optionally transformed. */
  add(geo, matrix = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const uv = g.attributes.uv;
    const v = _v, n = _n;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (matrix) v.applyMatrix4(matrix);
      this.p.push(v.x, v.y, v.z);
      if (nor) {
        n.fromBufferAttribute(nor, i);
        if (matrix) n.transformDirection(matrix);
        this.n.push(n.x, n.y, n.z);
      } else {
        this.n.push(0, 1, 0);
      }
      if (uv) this.t.push(uv.getX(i), uv.getY(i));
      else this.t.push(0, 0);
    }
    if (g !== geo) g.dispose();
  }

  geometry() {
    if (this.empty) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.t), 2));
    g.computeBoundingSphere();
    this.p.length = this.n.length = this.t.length = 0;
    return g;
  }
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const defaultUV = (face, fw, fh) => [fw, fh, 0, 0];

/** One Batch per material, flushed into one Mesh per material. */
export class Batches {
  constructor() {
    this.map = new Map();
  }

  get(material) {
    let b = this.map.get(material);
    if (!b) this.map.set(material, (b = new Batch()));
    return b;
  }

  get triangles() {
    let n = 0;
    for (const b of this.map.values()) n += b.triangles;
    return n;
  }

  /** Build the meshes and add them to `group`. Returns the mesh count. */
  finish(group, { castShadow = true, receiveShadow = true, renderOrder = 0 } = {}) {
    let n = 0;
    for (const [material, batch] of this.map) {
      const geo = batch.geometry();
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `city:${material.name || material.type}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.renderOrder = renderOrder;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      n++;
    }
    this.map.clear();
    return n;
  }
}

/**
 * Collects transforms for one repeated prop and emits a single
 * InstancedMesh. `colour()` per instance is optional (uses instanceColor).
 */
export class InstanceSet {
  constructor(geometry, material, { colour = false, castShadow = true, receiveShadow = true } = {}) {
    this.geometry = geometry;
    this.material = material;
    this.rows = [];
    this.colours = colour ? [] : null;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
  }

  /** position + Y rotation + non-uniform scale. */
  push(x, y, z, rot = 0, sx = 1, sy = sx, sz = sx, colour = null) {
    this.rows.push(x, y, z, rot, sx, sy, sz);
    if (this.colours) this.colours.push(colour === null ? 0xffffff : colour);
  }

  get count() {
    return this.rows.length / 7;
  }

  finish(group) {
    const n = this.count;
    if (!n) return null;
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    const m = _m4;
    const q = _q;
    const e = _e;
    const p = _v;
    const s = _s;
    const col = _c;
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      e.set(0, this.rows[o + 3], 0);
      q.setFromEuler(e);
      p.set(this.rows[o], this.rows[o + 1], this.rows[o + 2]);
      s.set(this.rows[o + 4], this.rows[o + 5], this.rows[o + 6]);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (this.colours) {
        col.setHex(this.colours[i]);
        mesh.setColorAt(i, col);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    mesh.frustumCulled = false;
    mesh.name = `inst:${this.material.name || this.material.type}`;
    group.add(mesh);
    this.rows.length = 0;
    return mesh;
  }
}

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/**
 * Give every material in a `{ key: material }` palette a name, so merged
 * meshes and instanced props are identifiable in a scene dump. Existing
 * names win — registry materials are shared with the landmarks.
 */
export function label(palette) {
  for (const key of Object.keys(palette)) {
    const m = palette[key];
    if (m && typeof m === 'object' && 'name' in m && !m.name) m.name = key;
  }
  return palette;
}

/** Build one geometry out of several primitives, in local space. */
export function partsGeometry(parts) {
  const b = new Batch();
  const m = new THREE.Matrix4();
  for (const { geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } of parts) {
    m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
    m.setPosition(x, y, z);
    b.add(geo, m);
    geo.dispose();
  }
  return b.geometry();
}
