import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ==================================================================
   Creature kit — the shared machinery every archetype in src/creatures
   is built on.

   Conventions (they matter in every archetype file):
     - local -Z is forward, +X is the creature's right, +Y up.
       This matches EnemyManager: object.rotation.y = e.facing and
       facing = atan2(-toX, -toZ), so -Z points at the player.
     - every creature is authored in BIND SPACE: metres, feet at y = 0,
       exactly the pose the bone rest offsets describe. Part geometry is
       generated directly in that space and then skinned, so a bone's
       rest world matrix is its bind matrix and nothing needs baking.
     - one skinned mesh per material key. Geometry is built once per
       archetype and shared by every instance; only the bones and the
       material clone are per-instance. That is what keeps 14 enemies
       plus a boss inside the draw-call budget.
     - all damping goes through damp()/dampAngle() so 30 Hz and 144 Hz
       produce identical motion.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* frame-rate independent maths                                        */
/* ------------------------------------------------------------------ */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Exponential approach that lands in the same place at any frame rate. */
export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Shortest signed angular difference, wrapped to (-PI, PI]. */
export function angleDelta(target, current) {
  return ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

export function dampAngle(current, target, rate, dt) {
  return current + angleDelta(target, current) * (1 - Math.exp(-rate * dt));
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0 || 1e-6));
  return t * t * (3 - 2 * t);
}

export const easeOut = (t) => 1 - (1 - clamp01(t)) * (1 - clamp01(t));
export const easeIn = (t) => clamp01(t) * clamp01(t);
export const easeInOut = (t) => {
  const k = clamp01(t);
  return k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
};
/** 0 → 1 → 0 across [0,1]. */
export const hump = (t) => Math.sin(clamp01(t) * Math.PI);
/** Fast rise, slow fall — impact curves. */
export const snap = (t) => {
  const k = clamp01(t);
  return k < 0.22 ? easeOut(k / 0.22) : 1 - easeIn((k - 0.22) / 0.78);
};

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _va = new THREE.Vector3();
const _vb = new THREE.Vector3();

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Piecewise-linear curve from [t, value] stops — radius profiles etc. */
export function ramp(stops) {
  return (t) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, v0] = stops[i - 1];
        const [t1, v1] = stops[i];
        return lerp(v0, v1, (t - t0) / (t1 - t0 || 1));
      }
    }
    return stops[stops.length - 1][1];
  };
}

const _euler = new THREE.Euler();
const _mat4 = new THREE.Matrix4();

/** Rotate (XYZ Euler) then translate a geometry into bind space. */
export function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) {
    _euler.set(rx, ry, rz);
    _mat4.makeRotationFromEuler(_euler);
    geo.applyMatrix4(_mat4);
  }
  geo.translate(x, y, z);
  return geo;
}

/** Offset from a rest position — keeps archetype files readable. */
export function off(p, dx, dy, dz) {
  return new THREE.Vector3(p.x + dx, p.y + dy, p.z + dz);
}

/** Rotate a +Y-authored geometry so +Y runs a→b, then move it onto `a`. */
export function orientY(geo, a, b) {
  _dir.copy(b).sub(a);
  const len = _dir.length();
  if (len > 1e-7) {
    _dir.divideScalar(len);
    _q.setFromUnitVectors(_up, _dir);
    geo.applyQuaternion(_q);
  }
  geo.translate(a.x, a.y, a.z);
  return geo;
}

/**
 * A tapered limb segment: a LatheGeometry solid of revolution spun around
 * the a→b axis, with optional rounded ends. This is the workhorse for every
 * arm, leg, finger and horn — organic taper for a handful of triangles.
 */
export function boneSegment(a, b, r0, r1, opts = {}) {
  const { radial = 7, rings = 2, cap0 = 0.0, cap1 = 0.0, bulge = 0, flat = 1 } = opts;
  const len = _va.copy(b).sub(a).length() || 0.01;
  const pts = [];
  if (cap0 > 0) {
    pts.push(new THREE.Vector2(0.0008, -r0 * cap0));
    pts.push(new THREE.Vector2(r0 * 0.70, -r0 * cap0 * 0.42));
  } else {
    pts.push(new THREE.Vector2(0.0008, 0));
  }
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const r = lerp(r0, r1, t) * (1 + bulge * Math.sin(t * Math.PI));
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * len));
  }
  if (cap1 > 0) {
    pts.push(new THREE.Vector2(r1 * 0.70, len + r1 * cap1 * 0.42));
    pts.push(new THREE.Vector2(0.0008, len + r1 * cap1));
  } else {
    pts.push(new THREE.Vector2(0.0008, len));
  }
  const geo = new THREE.LatheGeometry(pts, radial);
  if (flat !== 1) geo.scale(1, 1, flat);
  return orientY(geo, a, b);
}

/**
 * Splined tapered tube — necks, tails, torsos, wing membrane spars. The
 * centreline is a Catmull-Rom spline through `points`; `radius(t)` and
 * `squash(t)` shape an elliptical cross-section whose "up" is stabilised
 * against a reference axis rather than a Frenet frame, so a tail does not
 * twist as the spline curves.
 */
export function loft(points, opts = {}) {
  const asFn = (v, d) => (typeof v === 'function' ? v : typeof v === 'number' ? () => v : () => d);
  const {
    tubular = 14, radial = 8, up = [0, 1, 0], capStart = true, capEnd = true,
  } = opts;
  const radius = asFn(opts.radius, 0.2);
  const squash = asFn(opts.squash, 1);
  const offsetY = asFn(opts.offsetY, 0);
  const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  const upRef = new THREE.Vector3(up[0], up[1], up[2]).normalize();

  const position = [];
  const normal = [];
  const uv = [];
  const index = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const R = new THREE.Vector3();
  const U = new THREE.Vector3();
  const N = new THREE.Vector3();
  const fallback = new THREE.Vector3();

  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T).normalize();
    R.crossVectors(upRef, T);
    if (R.lengthSq() < 1e-6) {
      fallback.set(upRef.z, upRef.x, upRef.y);
      R.crossVectors(fallback, T);
    }
    R.normalize();
    U.crossVectors(T, R).normalize();
    const r = radius(t);
    const sq = squash(t);
    P.addScaledVector(U, offsetY(t));
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // outward normal of an ellipse with semi-axes (r, r*sq)
      N.set(0, 0, 0).addScaledVector(R, ca * sq).addScaledVector(U, sa).normalize();
      position.push(
        P.x + R.x * ca * r + U.x * sa * r * sq,
        P.y + R.y * ca * r + U.y * sa * r * sq,
        P.z + R.z * ca * r + U.z * sa * r * sq,
      );
      normal.push(N.x, N.y, N.z);
      uv.push(j / radial, t);
    }
  }
  const stride = radial + 1;
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = a + stride;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  // end caps: a fan to the exact spline endpoint
  const addCap = (ringStart, t, flip) => {
    curve.getPointAt(t, P);
    curve.getTangentAt(t, T).normalize();
    const c = position.length / 3;
    position.push(P.x, P.y, P.z);
    normal.push(flip ? -T.x : T.x, flip ? -T.y : T.y, flip ? -T.z : T.z);
    uv.push(0.5, t);
    for (let j = 0; j < radial; j++) {
      const a = ringStart + j;
      const b = ringStart + j + 1;
      if (flip) index.push(c, b, a);
      else index.push(c, a, b);
    }
  };
  if (capStart) addCap(0, 0, true);
  if (capEnd) addCap(tubular * stride, 1, false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}

/** Constant-radius strut along a spline — wing bones, cables, ribs. */
export function tube(points, radius, tubular = 8, radial = 5) {
  const pts = points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
}

/** Rounded mass — heads, chests, hips, throat sacs. */
export function blob(r, len, opts = {}) {
  const { cap = 3, radial = 8, sx = 1, sy = 1, sz = 1 } = opts;
  const geo = new THREE.CapsuleGeometry(r, len, cap, radial);
  if (sx !== 1 || sy !== 1 || sz !== 1) geo.scale(sx, sy, sz);
  return geo;
}

/** A masonry block / armour plate. Deliberately hard-edged. */
export function block(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/** Cone-ish spike, horn, tooth or claw with a taper curve. */
export function spike(r, h, opts = {}) {
  const { radial = 5, curve = 0, rings = 3 } = opts;
  const pts = [new THREE.Vector2(0.0008, 0)];
  for (let i = 1; i <= rings; i++) {
    const t = i / rings;
    pts.push(new THREE.Vector2(Math.max(0.0015, r * (1 - t) ** 1.25), t * h));
  }
  const geo = new THREE.LatheGeometry(pts, radial);
  if (curve) {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      pos.setZ(i, pos.getZ(i) + curve * (y / h) ** 2 * h);
    }
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * A membrane panel: a quad grid spanning a leading edge (`lead`, one point
 * per spar root→tip) and a trailing edge (`trail`). Vertices are laid out so
 * `skinMembrane()` can weight them to the wing bones, which is what makes a
 * wing actually fold instead of scaling.
 */
export function membranePanel(lead, trail, cols, rows) {
  const position = [];
  const uv = [];
  const index = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const P = new THREE.Vector3();
  const sample = (arr, t) => {
    const k = clamp01(t) * (arr.length - 1);
    const i = Math.min(arr.length - 2, Math.floor(k));
    const f = k - i;
    return P.set(
      lerp(arr[i][0], arr[i + 1][0], f),
      lerp(arr[i][1], arr[i + 1][1], f),
      lerp(arr[i][2], arr[i + 1][2], f),
    );
  };
  for (let c = 0; c <= cols; c++) {
    const u = c / cols;
    A.copy(sample(lead, u));
    B.copy(sample(trail, u));
    for (let r = 0; r <= rows; r++) {
      const v = r / rows;
      // slack: the membrane bellies away from the straight chord
      const sag = Math.sin(v * Math.PI) * 0.06 * Math.sin(u * Math.PI);
      position.push(
        lerp(A.x, B.x, v),
        lerp(A.y, B.y, v) - sag,
        lerp(A.z, B.z, v) + sag * 0.35,
      );
      uv.push(u, v);
    }
  }
  const stride = rows + 1;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = c * stride + r;
      const b = a + stride;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** Remap a geometry's UVs into a sub-rect of the archetype's skin sheet. */
export function region(geo, u0, v0, u1, v1) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + clamp01(uv.getX(i)) * (u1 - u0), v0 + clamp01(uv.getY(i)) * (v1 - v0));
  }
  uv.needsUpdate = true;
  return geo;
}

/** Swatches down the right-hand column of every skin sheet. Glowing details
 * all point at the same ember patch, so eyes / cores / throat sacs light up
 * through one emissiveMap and the creature still draws in one call; the pale
 * and bone swatches give bellies, jaws, teeth and claws their own colour
 * without a second material. Body parts must stay left of u = 0.87. */
export const GLOW_UV = [0.895, 0.895, 0.995, 0.995];
export const PALE_UV = [0.895, 0.760, 0.995, 0.860];
export const BONE_UV = [0.895, 0.625, 0.995, 0.725];
export const BODY_U_MAX = 0.87;
const swatch = (uv) => (geo) => region(geo, uv[0], uv[1], uv[2], uv[3]);
export const glowRegion = swatch(GLOW_UV);
export const paleRegion = swatch(PALE_UV);
export const boneRegion = swatch(BONE_UV);

/* ------------------------------------------------------------------ */
/* attack beats                                                        */
/* ------------------------------------------------------------------ */
/**
 * Every attack in this directory is a three-beat action: anticipation the
 * player can read and react to, a short commit, and a recovery that leaves
 * the creature exposed. `beat()` turns the raw timer into the current beat
 * plus its normalised progress. The returned object is shared scratch —
 * read it, don't keep it.
 */
const _beat = { id: null, phase: 'none', k: 0, t: 0, anticipation: 0 };
export function beat(act) {
  if (!act) {
    _beat.id = null; _beat.phase = 'none'; _beat.k = 0; _beat.t = 0; _beat.anticipation = 0;
    return _beat;
  }
  _beat.id = act.id;
  _beat.t = act.t;
  _beat.anticipation = act.ant;
  if (act.t < act.ant) {
    _beat.phase = 'ant';
    _beat.k = clamp01(act.t / Math.max(1e-4, act.ant));
  } else if (act.t < act.ant + act.com) {
    _beat.phase = 'com';
    _beat.k = clamp01((act.t - act.ant) / Math.max(1e-4, act.com));
  } else {
    _beat.phase = 'rec';
    _beat.k = clamp01((act.t - act.ant - act.com) / Math.max(1e-4, act.rec));
  }
  return _beat;
}

/** Total length of an action, used by the manager's state watchdog. */
export const actLength = (act) => act.ant + act.com + act.rec;

/* ------------------------------------------------------------------ */
/* rig                                                                 */
/* ------------------------------------------------------------------ */

/**
 * A rig template: bone order, parent links, rest offsets, rest world
 * positions and the shared bind inverses. Built once per archetype and
 * reused by every instance, so spawning costs 40-odd Bone allocations and
 * nothing else.
 */
export function rigTemplate(spec) {
  const order = spec.map((s) => s[0]);
  const parents = spec.map((s) => s[1]);
  const offsets = spec.map((s) => new THREE.Vector3(s[2], s[3], s[4]));
  const index = {};
  order.forEach((n, i) => { index[n] = i; });

  // rest world positions, resolved by walking the parent chain
  const rest = {};
  order.forEach((name, i) => {
    const p = parents[i];
    const base = p ? rest[p] : null;
    rest[name] = base ? base.clone().add(offsets[i]) : offsets[i].clone();
  });

  // bind inverses: bones sit at their rest offsets with identity rotation,
  // so the bind matrix of a bone is just a translation by its rest position.
  const inverses = order.map((name) => new THREE.Matrix4().makeTranslation(
    -rest[name].x, -rest[name].y, -rest[name].z,
  ));

  return { order, parents, offsets, index, rest, inverses };
}

/** Instantiate the bones of a template. Returns the root bone + lookups. */
export function instantiateRig(tpl) {
  const bones = [];
  const byName = {};
  for (let i = 0; i < tpl.order.length; i++) {
    const b = new THREE.Bone();
    b.name = tpl.order[i];
    b.position.copy(tpl.offsets[i]);
    bones.push(b);
    byName[b.name] = b;
    const p = tpl.parents[i];
    if (p) byName[p].add(b);
  }
  const skeleton = new THREE.Skeleton(bones, tpl.inverses);
  return { root: bones[0], bones, byName, skeleton };
}

/* ------------------------------------------------------------------ */
/* skinning + merging                                                  */
/* ------------------------------------------------------------------ */

/**
 * Collects part geometry, attaches skin weights and merges everything into
 * one buffer per material key. The result is cached per archetype.
 */
export class PartBuilder {
  constructor(tpl) {
    this.tpl = tpl;
    this.groups = new Map();
  }

  /**
   * @param {THREE.BufferGeometry} geo authored in bind space
   * @param {string|string[]|Function} bind bone name (rigid), a chain of
   *   bone names (blended along the chain), or fn(x,y,z) → [[name, w], ...]
   * @param {string} matKey which skinned mesh this part belongs to
   */
  add(geo, bind, matKey = 'body') {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    }
    this._skin(g, bind);
    let list = this.groups.get(matKey);
    if (!list) { list = []; this.groups.set(matKey, list); }
    list.push(g);
    return this;
  }

  _skin(g, bind) {
    const { index, rest } = this.tpl;
    const pos = g.attributes.position;
    const n = pos.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);

    if (typeof bind === 'string') {
      const bi = index[bind];
      if (bi === undefined) throw new Error(`creatures: unknown bone "${bind}"`);
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
    } else if (Array.isArray(bind)) {
      // blend along a joint polyline; the chain is extrapolated one segment
      // past its last bone so the tip of a tail still resolves cleanly
      const joints = bind.map((b) => {
        if (index[b] === undefined) throw new Error(`creatures: unknown bone "${b}"`);
        return rest[b];
      });
      const tail = joints[joints.length - 1].clone()
        .multiplyScalar(2).sub(joints[Math.max(0, joints.length - 2)]);
      const pts = [...joints, tail];
      for (let i = 0; i < n; i++) {
        _va.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        let bestSeg = 0;
        let bestF = 0;
        let bestD = Infinity;
        for (let s = 0; s < pts.length - 1; s++) {
          _vb.copy(pts[s + 1]).sub(pts[s]);
          const l2 = _vb.lengthSq() || 1e-6;
          let f = ((_va.x - pts[s].x) * _vb.x + (_va.y - pts[s].y) * _vb.y + (_va.z - pts[s].z) * _vb.z) / l2;
          f = clamp01(f);
          const dx = _va.x - (pts[s].x + _vb.x * f);
          const dy = _va.y - (pts[s].y + _vb.y * f);
          const dz = _va.z - (pts[s].z + _vb.z * f);
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestD) { bestD = d; bestSeg = s; bestF = f; }
        }
        const a = Math.min(bind.length - 1, bestSeg);
        const b = Math.min(bind.length - 1, bestSeg + 1);
        si[i * 4] = index[bind[a]];
        si[i * 4 + 1] = index[bind[b]];
        sw[i * 4] = a === b ? 1 : 1 - bestF;
        sw[i * 4 + 1] = a === b ? 0 : bestF;
      }
    } else {
      for (let i = 0; i < n; i++) {
        const list = bind(pos.getX(i), pos.getY(i), pos.getZ(i));
        let total = 0;
        for (let k = 0; k < list.length && k < 4; k++) total += list[k][1];
        total = total || 1;
        for (let k = 0; k < list.length && k < 4; k++) {
          const bi = index[list[k][0]];
          if (bi === undefined) throw new Error(`creatures: unknown bone "${list[k][0]}"`);
          si[i * 4 + k] = bi;
          sw[i * 4 + k] = list[k][1] / total;
        }
      }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }

  /** Merge each material group into one shared geometry. */
  build(boundingRadius) {
    const out = {};
    for (const [key, list] of this.groups) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) list.forEach((g) => g.dispose());
      merged.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, boundingRadius * 0.45, 0), boundingRadius);
      merged.computeBoundingBox();
      out[key] = merged;
    }
    return out;
  }
}

export function triangleCount(geoMap) {
  let tris = 0;
  for (const key of Object.keys(geoMap)) {
    const g = geoMap[key];
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  return Math.round(tris);
}

/* ------------------------------------------------------------------ */
/* material registry bridge                                            */
/* ------------------------------------------------------------------ */
/**
 * Prefer the shared PBR registry in src/materials.js when it is present and
 * knows the name we want; fall back to the archetype's own canvas-built
 * material otherwise. The registry is pulled in asynchronously so this file
 * keeps working if the module (or the creature entries in it) never lands.
 */
let registry = null;
let registryReady = null;

export function primeMaterialRegistry() {
  if (registryReady) return registryReady;
  registryReady = import('../materials.js')
    .then((mod) => {
      if (mod && typeof mod.getMaterial === 'function') registry = mod;
      return registry;
    })
    .catch(() => null);
  return registryReady;
}
primeMaterialRegistry();

/** Named materials this file would like from the registry, in preference
 * order per archetype. Anything missing falls back silently. */
export function registryMaterial(name, opts = {}) {
  if (!registry) return null;
  try {
    const mat = registry.getMaterial(name, opts);
    return mat && mat.isMaterial ? mat : null;
  } catch {
    return null; // unknown name — the registry throws, that's our signal
  }
}

/**
 * Resolve a creature material: registry first, local canvas build second.
 * The returned material is a shared template; instances clone it (textures
 * stay shared) so hit flashes and glow pulses are independent.
 */
export function creatureMaterial(name, build, opts) {
  return registryMaterial(name, opts) || build();
}

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */
const geoCache = new Map();
const matCache = new Map();
const tplCache = new Map();

export function archetypeTemplate(def) {
  let tpl = tplCache.get(def.id);
  if (!tpl) { tpl = rigTemplate(def.bones); tplCache.set(def.id, tpl); }
  return tpl;
}

export function archetypeGeometry(def) {
  let geos = geoCache.get(def.id);
  if (!geos) {
    const tpl = archetypeTemplate(def);
    const pb = new PartBuilder(tpl);
    def.build(pb, tpl);
    geos = pb.build(def.boundingRadius ?? 2);
    geoCache.set(def.id, geos);
  }
  return geos;
}

function archetypeMaterials(def) {
  let mats = matCache.get(def.id);
  if (!mats) { mats = def.materials(); matCache.set(def.id, mats); }
  return mats;
}

/**
 * Build one live instance: shared geometry, fresh bones, cloned materials.
 * `meshes` is keyed the same way as the material map, and `bones` is what
 * the animators (and, later, an external ragdoll solver) drive.
 *
 * The bones and the skinned meshes are both children of `root`, and `root`
 * carries the creature's world transform (position / facing / scale). With
 * the default attached bind mode three cancels the mesh's own world matrix
 * against `bindMatrixInverse` every frame, so bone inverses expressed
 * relative to `root` (what rigTemplate() produces) are exactly right and
 * frustum culling still uses the moving root transform.
 */
export function buildCreature(def) {
  const tpl = archetypeTemplate(def);
  const geos = archetypeGeometry(def);
  const templates = archetypeMaterials(def);
  const rig = instantiateRig(tpl);

  const root = new THREE.Group();
  root.add(rig.root);

  const model = { root, rig, bones: rig.byName, skeleton: rig.skeleton, meshes: {}, mats: [], def, tpl };
  const meshes = model.meshes;
  const mats = model.mats;
  for (const key of Object.keys(geos)) {
    const mat = (templates[key] || templates.body).clone();
    mats.push(mat);
    const mesh = new THREE.SkinnedMesh(geos[key], mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.bind(rig.skeleton, _identity);
    root.add(mesh);
    meshes[key] = mesh;
  }

  if (def.attach) def.attach(model);
  return model;
}

const _identity = new THREE.Matrix4();

/* ------------------------------------------------------------------ */
/* pose scratchpad                                                     */
/* ------------------------------------------------------------------ */
/**
 * Animators call `pose(bones)` once per frame and then write rotations
 * through the returned helper. Every bone's rotation is reset to rest first,
 * so a layer that stops writing simply stops contributing — no residue.
 */
/** Per-instance animation scratch. Every key an animator damps towards must
 * exist up front, or the first damp() would produce NaN and poison the pose. */
export function newPoseState() {
  return {
    crouch: 0, pounce: 0, recover: 0, headYaw: 0, headPitch: 0, jaw: 0, frill: 0,
    sac: 1, rear: 0, fold: 1, flare: 0, shield: 0, kneel: 0, pitch: 0, sink: 0,
    twist: 0, coil: 0, thrust: 0, drop: 0, spread: 0, down: 0,
  };
}

export function resetPose(model) {
  const { bones, tpl } = model;
  const order = tpl.order;
  for (let i = 0; i < order.length; i++) {
    const b = bones[order[i]];
    b.rotation.set(0, 0, 0);
    b.position.copy(tpl.offsets[i]);
    if (b.scale.x !== 1) b.scale.setScalar(1);
  }
}
