import * as THREE from 'three';
import { C } from './materials.js';

/* ==================================================================
   Procedural skinned body.

   Everything is authored directly in bind space (feet at y = 0, the
   rest pose from rig.js) and accumulated into one indexed buffer with
   per-vertex colour + skin weights, so the entire figure — coat,
   trousers, boots, harness, head, gloves — is a single draw call.

   Limbs are built by `chain()`: a tapered superellipse tube swept along
   a polyline, with the skin weights blended across the joint rings so
   elbows and knees crease instead of tearing.
   ================================================================== */

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3();
const _col = new THREE.Color();

/** weights helper: w(['chest', 1]) or w(['armLU', 0.5], ['armLL', 0.5]) */
export function w(...pairs) {
  return pairs;
}

export class SkinBuilder {
  /** @param {Record<string,number>|null} boneIndex null builds an unskinned mesh */
  constructor(boneIndex) {
    this.boneIndex = boneIndex;
    this.skinned = !!boneIndex;
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.si = [];
    this.sw = [];
    this.idx = [];
    this.count = 0;
  }

  _pushWeights(pairs) {
    if (!this.skinned) return;
    const ix = [0, 0, 0, 0];
    const wt = [0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < pairs.length && i < 4; i++) {
      const bi = this.boneIndex[pairs[i][0]];
      if (bi === undefined) continue;
      ix[i] = bi;
      wt[i] = pairs[i][1];
      total += pairs[i][1];
    }
    if (total <= 0) { wt[0] = 1; total = 1; }
    for (let i = 0; i < 4; i++) wt[i] /= total;
    this.si.push(ix[0], ix[1], ix[2], ix[3]);
    this.sw.push(wt[0], wt[1], wt[2], wt[3]);
  }

  _pushColor(hex) {
    _col.set(hex);
    this.col.push(_col.r, _col.g, _col.b);
  }

  /**
   * Bake an arbitrary geometry into the skin with one colour and one
   * weight set. `matrix` places it in bind space.
   */
  addGeometry(geo, matrix, color, weights) {
    const g = geo;
    const p = g.attributes.position;
    let nAttr = g.attributes.normal;
    if (!nAttr) { g.computeVertexNormals(); nAttr = g.attributes.normal; }
    const uvAttr = g.attributes.uv;
    _m3.getNormalMatrix(matrix);
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(nAttr, i).applyMatrix3(_m3).normalize();
      this.nrm.push(_n.x, _n.y, _n.z);
      if (uvAttr) this.uv.push(uvAttr.getX(i), uvAttr.getY(i));
      else this.uv.push(0.5, 0.5);
      this._pushColor(color);
      this._pushWeights(weights);
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) this.idx.push(base + ia[i]);
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    this.count += p.count;
    geo.dispose();
    return this;
  }

  /**
   * Swept tube. `points` is an array of
   *   { p:[x,y,z], r:number|[rx,rz], w:[[bone,weight]...], c?:hex, power?:n }
   * Ends can be closed with a rounded dome.
   */
  chain(points, opts = {}) {
    const radial = opts.radial ?? 12;
    const power = opts.power ?? 1;
    const color = opts.color ?? C.coat;
    const upRef = opts.up ? _v.set(opts.up[0], opts.up[1], opts.up[2]).clone() : new THREE.Vector3(0, 0, -1);
    const uRep = opts.uRepeat ?? 1;
    const vScale = opts.vScale ?? 1.6;

    // expand the polyline with dome rings so the ends read as rounded
    const list = points.map((q) => ({
      p: new THREE.Vector3(q.p[0], q.p[1], q.p[2]),
      rx: Array.isArray(q.r) ? q.r[0] : q.r,
      rz: Array.isArray(q.r) ? q.r[1] : q.r,
      w: q.w,
      c: q.c ?? color,
      power: q.power ?? power,
    }));

    if (opts.domeStart) {
      const a = list[0];
      const dir = _t.copy(a.p).sub(list[1].p).normalize();
      const rr = Math.max(a.rx, a.rz);
      list.unshift(
        { p: a.p.clone().addScaledVector(dir, rr * 0.62), rx: a.rx * 0.5, rz: a.rz * 0.5, w: a.w, c: a.c, power: a.power },
        { p: a.p.clone().addScaledVector(dir, rr * 0.34), rx: a.rx * 0.85, rz: a.rz * 0.85, w: a.w, c: a.c, power: a.power },
      );
    }
    if (opts.domeEnd) {
      const a = list[list.length - 1];
      const dir = _t.copy(a.p).sub(list[list.length - 2].p).normalize();
      const rr = Math.max(a.rx, a.rz);
      list.push(
        { p: a.p.clone().addScaledVector(dir, rr * 0.34), rx: a.rx * 0.85, rz: a.rz * 0.85, w: a.w, c: a.c, power: a.power },
        { p: a.p.clone().addScaledVector(dir, rr * 0.62), rx: a.rx * 0.5, rz: a.rz * 0.5, w: a.w, c: a.c, power: a.power },
      );
    }

    const base = this.count;
    const n = list.length;
    let vLen = 0;
    for (let i = 0; i < n; i++) {
      const cur = list[i];
      // tangent
      if (i === 0) _t.copy(list[1].p).sub(cur.p);
      else if (i === n - 1) _t.copy(cur.p).sub(list[i - 1].p);
      else _t.copy(list[i + 1].p).sub(list[i - 1].p);
      if (_t.lengthSq() < 1e-12) _t.set(0, -1, 0);
      _t.normalize();
      if (i > 0) vLen += cur.p.distanceTo(list[i - 1].p);

      // stable ring frame
      let up = upRef;
      if (Math.abs(up.dot(_t)) > 0.94) up = Math.abs(_t.y) > 0.9 ? _UP_Z : _UP_Y;
      _x.crossVectors(up, _t).normalize();
      _z.crossVectors(_t, _x).normalize();

      const dR = i < n - 1 ? (Math.max(list[i + 1].rx, list[i + 1].rz) - Math.max(cur.rx, cur.rz))
        / Math.max(1e-5, cur.p.distanceTo(list[i + 1].p)) : 0;

      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2;
        let cs = Math.cos(a), sn = Math.sin(a);
        if (cur.power !== 1) {
          cs = Math.sign(cs) * Math.pow(Math.abs(cs), cur.power);
          sn = Math.sign(sn) * Math.pow(Math.abs(sn), cur.power);
        }
        _v.copy(cur.p).addScaledVector(_x, cs * cur.rx).addScaledVector(_z, sn * cur.rz);
        this.pos.push(_v.x, _v.y, _v.z);
        // outward normal, tilted by the taper slope
        _n.set(0, 0, 0).addScaledVector(_x, cs * cur.rz).addScaledVector(_z, sn * cur.rx);
        if (_n.lengthSq() < 1e-12) _n.copy(_x);
        _n.normalize().addScaledVector(_t, -dR).normalize();
        this.nrm.push(_n.x, _n.y, _n.z);
        this.uv.push((j / radial) * uRep, vLen * vScale);
        this._pushColor(cur.c);
        this._pushWeights(cur.w);
      }
    }

    const stride = radial + 1;
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * stride + j;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        this.idx.push(a, c, b, b, c, d);
      }
    }
    this.count += n * stride;
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.skinned) {
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    }
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    // the pose moves well outside the bind-pose bounds
    if (g.boundingSphere) g.boundingSphere.radius *= 1.9;
    return g;
  }

  get triangles() {
    return this.idx.length / 3;
  }
}

const _UP_Y = new THREE.Vector3(0, 1, 0);
const _UP_Z = new THREE.Vector3(0, 0, -1);

/* ------------------------------------------------------------------ */
/* helpers for the blocky bits                                         */
/* ------------------------------------------------------------------ */
export function place(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

export function box(b, wd, ht, dp, m, color, weights, seg = 1) {
  b.addGeometry(new THREE.BoxGeometry(wd, ht, dp, seg, seg, seg), m, color, weights);
}

/* ------------------------------------------------------------------ */
/* the figure                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {ReturnType<import('./rig.js').buildSkeleton>} rig
 * @param {import('../rng.js').Rng} rng deterministic costume variation
 * @returns {{body:THREE.BufferGeometry, glow:THREE.BufferGeometry, tris:number}}
 */
export function buildBody(rig, rng) {
  const B = new SkinBuilder(rig.index);
  const G = new SkinBuilder(rig.index);
  const wear = rng.float(-0.006, 0.006); // per-run costume slack

  /* ---- torso: the coat body ---- */
  B.chain([
    { p: [0, 0.870, 0.004], r: [0.158, 0.121], w: w(['hips', 1]) },
    { p: [0, 0.945, 0], r: [0.166, 0.124], w: w(['hips', 1]) },
    { p: [0, 1.010, -0.002], r: [0.157, 0.118], w: w(['hips', 0.45], ['spine1', 0.55]) },
    { p: [0, 1.070, -0.004], r: [0.150, 0.113], w: w(['spine1', 1]) },
    { p: [0, 1.140, -0.004], r: [0.164, 0.117], w: w(['spine1', 0.4], ['spine2', 0.6]) },
    { p: [0, 1.210, -0.002], r: [0.181, 0.124], w: w(['spine2', 1]) },
    { p: [0, 1.285, 0.002], r: [0.196, 0.130], w: w(['spine2', 0.35], ['chest', 0.65]) },
    { p: [0, 1.360, 0.004], r: [0.194, 0.126], w: w(['chest', 1]) },
    { p: [0, 1.418, 0.002], r: [0.168, 0.112], w: w(['chest', 1]) },
    { p: [0, 1.452, 0], r: [0.116, 0.086], w: w(['chest', 1]) },
  ], { radial: 16, power: 0.86, color: C.coat, up: [0, 0, -1], uRepeat: 2, vScale: 1.4 });

  // coat front panel: a slightly raised plate so the silhouette has a break
  box(B, 0.20, 0.50, 0.03, place(0, 1.14, -0.122, -0.03), C.coatPanel, w(['spine1', 0.4], ['spine2', 0.4], ['chest', 0.2]));
  // shoulder yoke, reads clearly from behind
  box(B, 0.36, 0.13, 0.035, place(0, 1.372, 0.116, 0.10), C.coatDark, w(['chest', 1]));

  /* ---- stand-up collar ---- */
  B.chain([
    { p: [0, 1.430, -0.006], r: [0.104, 0.092], w: w(['chest', 0.5], ['neck', 0.5]) },
    { p: [0, 1.492, -0.010], r: [0.100, 0.090], w: w(['neck', 1]) },
    { p: [0, 1.536, -0.012], r: [0.090, 0.082], w: w(['neck', 1]) },
  ], { radial: 14, power: 0.9, color: C.collar, up: [0, 0, -1] });

  /* ---- neck + scarf wrap (the wrap is static; the tails are cloth) ---- */
  B.chain([
    { p: [0, 1.400, -0.010], r: 0.058, w: w(['chest', 0.4], ['neck', 0.6]) },
    { p: [0, 1.470, -0.012], r: 0.054, w: w(['neck', 1]) },
    { p: [0, 1.540, -0.008], r: 0.058, w: w(['neck', 0.5], ['head', 0.5]) },
  ], { radial: 10, color: C.skinShade });

  B.chain([
    { p: [0, 1.452, -0.012], r: [0.088, 0.082], w: w(['neck', 1]) },
    { p: [0, 1.505, -0.016], r: [0.093, 0.088], w: w(['neck', 0.8], ['head', 0.2]) },
    { p: [0, 1.548, -0.020], r: [0.086, 0.080], w: w(['neck', 0.4], ['head', 0.6]) },
  ], { radial: 12, power: 0.85, color: C.scarf, uRepeat: 3 });
  // knot on the right shoulder side
  box(B, 0.075, 0.06, 0.07, place(0.072, 1.500, -0.036, 0.2, 0.4, 0.3), C.scarfDark, w(['neck', 1]));

  /* ---- head ---- */
  B.chain([
    { p: [0, 1.548, 0.002], r: [0.062, 0.064], w: w(['neck', 0.35], ['head', 0.65]) },
    { p: [0, 1.586, -0.002], r: [0.078, 0.085], w: w(['head', 1]) },
    { p: [0, 1.632, -0.004], r: [0.090, 0.099], w: w(['head', 1]) },
    { p: [0, 1.690, -0.002], r: [0.093, 0.101], w: w(['head', 1]) },
    { p: [0, 1.742, 0.002], r: [0.083, 0.090], w: w(['head', 1]) },
    { p: [0, 1.778, 0.006], r: [0.052, 0.056], w: w(['head', 1]) },
  ], { radial: 16, power: 0.95, color: C.skin, up: [0, 0, -1], domeEnd: true });

  // brow + nose so the profile is not a bald egg
  box(B, 0.108, 0.026, 0.028, place(0, 1.658, -0.084, 0.18), C.skinShade, w(['head', 1]));
  box(B, 0.026, 0.040, 0.032, place(0, 1.636, -0.096, 0.35), C.skin, w(['head', 1]));

  // hair: a cap over the skull with a longer back
  B.chain([
    { p: [0, 1.628, 0.024], r: [0.094, 0.086], w: w(['head', 1]) },
    { p: [0, 1.690, 0.010], r: [0.099, 0.106], w: w(['head', 1]) },
    { p: [0, 1.744, 0.012], r: [0.089, 0.096], w: w(['head', 1]) },
    { p: [0, 1.782, 0.014], r: [0.050, 0.054], w: w(['head', 1]) },
  ], { radial: 14, power: 0.95, color: C.hair, up: [0, 0, -1], domeEnd: true });
  box(B, 0.115, 0.085, 0.045, place(0, 1.598, 0.070, -0.22), C.hair, w(['head', 1]));

  // goggle strap round the back of the head — the angle we always see
  B.addGeometry(
    new THREE.TorusGeometry(0.098, 0.014, 5, 14),
    place(0, 1.664, -0.004, Math.PI / 2, 0, 0, 1, 1, 1.06),
    C.harnessDark, w(['head', 1]),
  );
  box(B, 0.176, 0.046, 0.030, place(0, 1.664, -0.082, 0.05), C.harnessDark, w(['head', 1]));
  // lenses (glow mesh)
  for (const s of [-1, 1]) {
    box(G, 0.058, 0.032, 0.014, place(s * 0.045, 1.664, -0.096, 0.05), C.glowWarm, w(['head', 1]));
  }

  /* ---- shoulders / pauldrons ---- */
  for (const [side, clav, armU] of [[-1, 'clavL', 'armLU'], [1, 'clavR', 'armRU']]) {
    // deltoid cap blending the sleeve into the coat
    B.chain([
      { p: [side * 0.088, 1.428, 0], r: [0.070, 0.086], w: w([clav, 0.8], [armU, 0.2]) },
      { p: [side * 0.152, 1.442, 0], r: [0.074, 0.088], w: w([clav, 0.45], [armU, 0.55]) },
      { p: [side * 0.192, 1.418, 0], r: [0.070, 0.082], w: w([armU, 1]) },
    ], { radial: 12, power: 0.9, color: C.coat, up: [0, 1, 0], domeStart: true, domeEnd: true });

    if (side > 0) {
      // hard pauldron on the weapon shoulder, three overlapping plates
      for (let i = 0; i < 3; i++) {
        box(B, 0.115 - i * 0.012, 0.030, 0.152 - i * 0.014,
          place(0.176 + i * 0.010, 1.452 - i * 0.046, 0, 0, 0, -0.30 - i * 0.10),
          i === 0 ? C.coatDark : C.harnessDark, w([clav, 0.35 - i * 0.1], [armU, 0.65 + i * 0.1]));
      }
    } else {
      box(B, 0.096, 0.026, 0.130, place(-0.170, 1.444, 0, 0, 0, 0.26), C.coatDark, w([clav, 0.4], [armU, 0.6]));
    }
  }

  /* ---- arms: coat sleeves + gloves ---- */
  for (const [side, armU, armL, hand] of [[-1, 'armLU', 'armLL', 'handL'], [1, 'armRU', 'armRL', 'handR']]) {
    const X = side * 0.185;
    B.chain([
      { p: [X, 1.430, 0], r: 0.066, w: w([armU, 1]) },
      { p: [X, 1.330, 0], r: 0.062, w: w([armU, 1]) },
      { p: [X, 1.215, 0], r: 0.054, w: w([armU, 1]) },
      { p: [X, 1.164, 0], r: 0.050, w: w([armU, 0.72], [armL, 0.28]) },
      { p: [X, 1.140, 0], r: 0.049, w: w([armU, 0.5], [armL, 0.5]) },
      { p: [X, 1.112, 0], r: 0.049, w: w([armU, 0.22], [armL, 0.78]) },
      { p: [X, 1.020, 0], r: 0.045, w: w([armL, 1]) },
      { p: [X, 0.948, 0], r: 0.040, w: w([armL, 1]) },
      { p: [X, 0.918, 0], r: [0.047, 0.044], w: w([armL, 0.7], [hand, 0.3]) },
    ], { radial: 12, power: 0.95, color: C.coat, up: [0, 0, -1], domeStart: true, uRepeat: 1, vScale: 2.2 });

    // sleeve cuff
    B.addGeometry(new THREE.CylinderGeometry(0.049, 0.045, 0.034, 12, 1, true),
      place(X, 0.902, 0), C.coatDark, w([armL, 0.55], [hand, 0.45]));

    // glove: palm + thumb
    B.chain([
      { p: [X, 0.886, 0], r: [0.043, 0.032], w: w([hand, 1]) },
      { p: [X, 0.832, -0.004], r: [0.046, 0.034], w: w([hand, 1]) },
      { p: [X, 0.788, -0.008], r: [0.043, 0.031], w: w([hand, 1]) },
      { p: [X, 0.762, -0.010], r: [0.034, 0.026], w: w([hand, 1]) },
    ], { radial: 10, power: 0.72, color: C.glove, up: [0, 0, -1], domeEnd: true });
    B.chain([
      { p: [X - side * 0.030, 0.856, -0.012], r: 0.019, w: w([hand, 1]) },
      { p: [X - side * 0.034, 0.822, -0.030], r: 0.017, w: w([hand, 1]) },
    ], { radial: 8, color: C.glove, up: [0, 1, 0], domeStart: true, domeEnd: true });
    box(B, 0.050, 0.028, 0.040, place(X, 0.812, -0.024, 0.2), C.gloveGrip, w([hand, 1]));
  }

  /* ---- harness ---- */
  for (const s of [-1, 1]) {
    box(B, 0.052, 0.34, 0.024, place(s * 0.070, 1.230, -0.126, 0.03, 0, s * 0.16), C.harness, w(['spine2', 0.5], ['chest', 0.5]));
    box(B, 0.052, 0.30, 0.024, place(s * 0.076, 1.250, 0.120, -0.04, 0, -s * 0.20), C.harness, w(['chest', 1]));
  }
  box(B, 0.084, 0.062, 0.030, place(0, 1.286, -0.132), C.buckle, w(['chest', 1]));
  box(G, 0.026, 0.014, 0.010, place(0, 1.304, -0.148), C.glow, w(['chest', 1]));

  // belt
  B.addGeometry(new THREE.TorusGeometry(0.152, 0.023, 5, 18),
    place(0, 1.028, -0.004, Math.PI / 2, 0, 0, 1, 1, 0.75), C.harnessDark, w(['hips', 0.5], ['spine1', 0.5]));
  box(B, 0.070, 0.058, 0.026, place(0, 1.028, -0.126), C.buckle, w(['spine1', 1]));
  // magazine pouches on the left hip — the reload target
  for (let i = 0; i < 2; i++) {
    box(B, 0.058, 0.096, 0.046, place(-0.108 - i * 0.008, 0.972 - i * 0.006, -0.062 + i * 0.058, 0.05, -0.25 + i * 0.1, 0.06),
      C.harness, w(['hips', 1]));
  }
  box(B, 0.066, 0.070, 0.052, place(0.126, 0.964, 0.030, 0, 0.3, -0.05), C.harness, w(['hips', 1]));

  /* ---- back-mounted plasma cell pack (the view we always get) ---- */
  box(B, 0.216, 0.240, 0.084, place(0, 1.238, 0.152, 0.05), C.pack, w(['spine2', 0.35], ['chest', 0.65]));
  box(B, 0.238, 0.036, 0.096, place(0, 1.126, 0.150, 0.05), C.packTrim, w(['spine2', 1]));
  for (const s of [-1, 1]) {
    B.addGeometry(new THREE.CylinderGeometry(0.030, 0.030, 0.190, 8, 1),
      place(s * 0.074, 1.246, 0.208, 0.05), C.metal, w(['chest', 1]));
    G.addGeometry(new THREE.CylinderGeometry(0.024, 0.024, 0.058, 8, 1),
      place(s * 0.074, 1.246, 0.208, 0.05), C.glow, w(['chest', 1]));
  }
  B.addGeometry(new THREE.TorusGeometry(0.052, 0.014, 5, 12),
    place(0, 1.322, 0.200, Math.PI / 2, 0, 0), C.metalDark, w(['chest', 1]));

  /* ---- legs: trousers ---- */
  for (const [side, legU, legL, foot, toe] of [
    [-1, 'legLU', 'legLL', 'footL', 'toeL'],
    [1, 'legRU', 'legRL', 'footR', 'toeR'],
  ]) {
    const X = side * 0.093;
    B.chain([
      { p: [X, 0.948, 0], r: [0.100, 0.104], w: w(['hips', 0.35], [legU, 0.65]) },
      { p: [X, 0.860, 0], r: [0.098, 0.101], w: w([legU, 1]) },
      { p: [X, 0.700, 0], r: [0.084, 0.088], w: w([legU, 1]) },
      { p: [X, 0.545, 0], r: [0.070, 0.074], w: w([legU, 1]) },
      { p: [X, 0.505, 0], r: [0.066, 0.070], w: w([legU, 0.7], [legL, 0.3]) },
      { p: [X, 0.480, 0], r: [0.065, 0.069], w: w([legU, 0.5], [legL, 0.5]) },
      { p: [X, 0.452, 0], r: [0.066, 0.070], w: w([legU, 0.2], [legL, 0.8]) },
      { p: [X, 0.360, 0], r: [0.062, 0.065], w: w([legL, 1]) },
      { p: [X, 0.250, 0], r: [0.058, 0.060], w: w([legL, 1]) },
      { p: [X, 0.190, 0], r: [0.064, 0.066], w: w([legL, 1]) },
    ], { radial: 12, power: 0.94, color: C.trousers, up: [0, 0, -1], uRepeat: 1, vScale: 2.0 });

    // knee pad
    box(B, 0.086, 0.090, 0.028, place(X, 0.498, -0.062, 0.06), C.kneePad, w([legU, 0.45], [legL, 0.55]));

    // boot shaft
    B.chain([
      { p: [X, 0.230, 0], r: [0.072, 0.076], w: w([legL, 1]) },
      { p: [X, 0.150, 0], r: [0.066, 0.070], w: w([legL, 1]) },
      { p: [X, 0.100, 0.004], r: [0.060, 0.062], w: w([legL, 0.7], [foot, 0.3]) },
    ], { radial: 12, power: 0.78, color: C.boot, up: [0, 0, -1] });
    box(B, 0.076, 0.030, 0.066, place(X, 0.234, 0.002), C.bootCuff, w([legL, 1]));

    // boot foot, swept forward from the heel over the toe
    B.chain([
      { p: [X, 0.072, 0.072], r: [0.052, 0.050], w: w([foot, 1]) },
      { p: [X, 0.058, 0.010], r: [0.058, 0.056], w: w([foot, 1]) },
      { p: [X, 0.052, -0.058], r: [0.056, 0.052], w: w([foot, 0.7], [toe, 0.3]) },
      { p: [X, 0.046, -0.118], r: [0.050, 0.046], w: w([foot, 0.25], [toe, 0.75]) },
      { p: [X, 0.042, -0.158], r: [0.038, 0.034], w: w([toe, 1]) },
    ], { radial: 12, power: 0.6, color: C.boot, up: [0, 1, 0], domeStart: true, domeEnd: true });
    box(B, 0.104, 0.024, 0.130, place(X, 0.016, 0.026), C.sole, w([foot, 1]));
    box(B, 0.092, 0.020, 0.096, place(X, 0.016, -0.104), C.sole, w([toe, 1]));
    box(B, 0.098, 0.030, 0.026, place(X, 0.036, 0.086), C.sole, w([foot, 1]));
    // strap over the instep
    box(B, 0.112 + wear, 0.020, 0.034, place(X, 0.078, -0.030, 0.1), C.harnessDark, w([foot, 1]));
  }

  return { body: B.build(), glow: G.build(), tris: B.triangles + G.triangles };
}
