/**
 * Projected decal system — scorch marks, craters, chips, cracks, scuffs and
 * creature ichor.
 *
 * One InstancedBufferGeometry of quads sharing a single generated atlas, so
 * the whole persistent record of a firefight costs one draw call. Each
 * instance is oriented to the surface normal it was placed against, pushed
 * a couple of centimetres off it and drawn with polygonOffset so it never
 * z-fights the cobbles.
 *
 * Hard cap with oldest-first eviction: the allocator is a ring, so the
 * oldest mark is always the one that gets overwritten.
 */
import * as THREE from 'three';
import { GLSL_SHARED_UNIFORMS, GLSL_ATLAS, GLSL_SOFT } from './shaders.js';
import { withShared, attachDriver } from './shared.js';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aRight;
attribute vec3 aUp;
attribute vec4 aParam;   // birth, life, alpha, tile
attribute vec3 aTint;

varying vec2 vUv;
varying vec3 vTint;
varying float vTile;
varying float vAlpha;
varying vec3 vNormal;
varying float vViewZ;

${GLSL_SHARED_UNIFORMS}

void main() {
  float t = uTime - aParam.x;
  if (aParam.y <= 0.0 || t < 0.0 || t > aParam.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float k = t / aParam.y;
  vec3 world = aPos + aRight * position.x + aUp * position.y;
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vTint = aTint;
  vTile = aParam.w;
  // snap in fast, hold, then weather away over the last third
  vAlpha = aParam.z * smoothstep(0.0, 0.05, k) * (1.0 - smoothstep(0.68, 1.0, k));
  vNormal = normalize(cross(aRight, aUp));
  vViewZ = -mv.z;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vTint;
varying float vTile;
varying float vAlpha;
varying vec3 vNormal;
varying float vViewZ;
uniform float uSoftDist;
${GLSL_SHARED_UNIFORMS}
${GLSL_ATLAS}
${GLSL_SOFT}

void main() {
  vec4 tx = texture2D(uAtlas, vfxTileUv(vUv, vTile));
  float a = tx.a * vAlpha;
  if (a < 0.004) discard;
  float ndl = max(dot(normalize(vNormal), uSunDir), 0.0);
  vec3 lit = tx.rgb * vTint * (uAmbCol + uSunCol * ndl * 0.9);
  // distance fade so the far half of a square is not littered with quads
  a *= 1.0 - smoothstep(90.0, 150.0, vViewZ);
  a *= vfxSoftFade(vViewZ, uSoftDist);
  gl_FragColor = vec4(lit, a);
}
`;

const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _ref = new THREE.Vector3();
const _col = new THREE.Color();

export class DecalSystem {
  constructor(scene, shared, atlas, { cap = 168 } = {}) {
    this.cap = cap;
    this.shared = shared;
    this.aPos = new Float32Array(cap * 3);
    this.aRight = new Float32Array(cap * 3);
    this.aUp = new Float32Array(cap * 3);
    this.aParam = new Float32Array(cap * 4);
    this.aTint = new Float32Array(cap * 3);
    this.death = new Float32Array(cap);
    this.count = 0;
    this.next = 0;      // ring cursor == oldest slot
    this._lo = cap;
    this._hi = -1;

    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.attributes.position);
    geo.setAttribute('uv', plane.attributes.uv);
    plane.dispose();
    const attr = (arr, size) => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    geo.setAttribute('aPos', attr(this.aPos, 3));
    geo.setAttribute('aRight', attr(this.aRight, 3));
    geo.setAttribute('aUp', attr(this.aUp, 3));
    geo.setAttribute('aParam', attr(this.aParam, 4));
    geo.setAttribute('aTint', attr(this.aTint, 3));
    this._attrs = ['aPos', 'aRight', 'aUp', 'aParam', 'aTint'].map((k) => geo.getAttribute(k));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      uniforms: withShared(shared, {
        uAtlas: { value: atlas },
        uSoftDist: { value: 0.25 },
      }),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -8,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;   // under every additive effect
    attachDriver(this.mesh, shared);
    scene.add(this.mesh);
    this.geo = geo;
    this.mat = mat;
  }

  /**
   * Place a decal.
   *
   * @param {THREE.Vector3|{x,y,z}} point  world hit point
   * @param {{x,y,z}} normal               surface normal at the hit
   * @param {number} size                  quad edge length in metres
   * @param {number} tile                  DECAL.* atlas index
   * @param {number} tint                  hex multiplier (dark for soot)
   * @param {number} alpha                 opacity
   * @param {number} life                  seconds before it has weathered away
   * @param {number} roll                  0..1 rotation around the normal
   */
  add(point, normal, size, tile, tint = 0xffffff, alpha = 1, life = 48, roll = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (i >= this.count) this.count = i + 1;

    _n.set(normal.x, normal.y, normal.z);
    if (_n.lengthSq() < 1e-6) _n.set(0, 1, 0);
    _n.normalize();
    _ref.set(0, 1, 0);
    if (Math.abs(_n.y) > 0.93) _ref.set(1, 0, 0);
    _r.crossVectors(_ref, _n).normalize();
    _u.crossVectors(_n, _r).normalize();
    // roll around the normal so repeated marks never tile visibly
    const a = roll * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const rx = _r.x * ca + _u.x * sa;
    const ry = _r.y * ca + _u.y * sa;
    const rz = _r.z * ca + _u.z * sa;
    const ux = _u.x * ca - _r.x * sa;
    const uy = _u.y * ca - _r.y * sa;
    const uz = _u.z * ca - _r.z * sa;

    const i3 = i * 3;
    const i4 = i * 4;
    const lift = 0.022 + size * 0.004;
    this.aPos[i3] = point.x + _n.x * lift;
    this.aPos[i3 + 1] = point.y + _n.y * lift;
    this.aPos[i3 + 2] = point.z + _n.z * lift;
    this.aRight[i3] = rx * size; this.aRight[i3 + 1] = ry * size; this.aRight[i3 + 2] = rz * size;
    this.aUp[i3] = ux * size; this.aUp[i3 + 1] = uy * size; this.aUp[i3 + 2] = uz * size;
    _col.set(tint);
    this.aTint[i3] = _col.r; this.aTint[i3 + 1] = _col.g; this.aTint[i3 + 2] = _col.b;
    this.aParam[i4] = this.shared.time;
    this.aParam[i4 + 1] = life;
    this.aParam[i4 + 2] = alpha;
    this.aParam[i4 + 3] = tile;
    this.death[i] = this.shared.time + life;
    if (i < this._lo) this._lo = i;
    if (i > this._hi) this._hi = i;
  }

  update() {
    const now = this.shared.time;
    let live = 0;
    for (let i = 0; i < this.count; i++) if (this.death[i] > now) live++;
    while (this.count > 0 && this.death[this.count - 1] <= now) this.count--;
    this.geo.instanceCount = this.count;
    this.mesh.visible = live > 0;
    if (this._hi >= this._lo) {
      const lo = this._lo;
      const n = this._hi - lo + 1;
      for (const a of this._attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(lo * a.itemSize, n * a.itemSize);
        a.needsUpdate = true;
      }
      this._lo = this.cap;
      this._hi = -1;
    }
  }

  clear() {
    this.death.fill(0);
    this.aParam.fill(0);
    this.count = 0;
    this.next = 0;
    this._lo = 0;
    this._hi = this.cap - 1;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
