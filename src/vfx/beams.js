/**
 * Tracers.
 *
 * A plasma bolt is not a sprite: it is a velocity-aligned ribbon with a
 * blown-out core, a wide falloff shell and a noise-perturbed heat sheath
 * around it, tapered towards the tail so the eye reads direction. All live
 * bolts share one instanced draw call; the CPU only pushes the two
 * endpoints per bolt per frame.
 */
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SHARED_UNIFORMS, GLSL_SOFT } from './shaders.js';
import { withShared, attachDriver } from './shared.js';

const VERT = /* glsl */ `
attribute vec3 aFrom;
attribute vec3 aTo;
attribute vec3 aCol;
attribute vec4 aParam;   // radius, seed, taper, glow

varying vec2 vUv;
varying vec3 vCol;
varying float vSeed;
varying float vGlow;
varying float vViewZ;
varying float vLen;

${GLSL_SHARED_UNIFORMS}

void main() {
  vec3 axis = aTo - aFrom;
  float len = length(axis);
  if (len < 1e-5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec3 dir = axis / len;
  vec3 p = mix(aFrom, aTo, uv.y);
  vec3 toEye = normalize(cameraPosition - p);
  vec3 side = cross(dir, toEye);
  float sl = length(side);
  // Bolt pointing straight at the camera: any perpendicular will do.
  side = sl > 1e-4 ? side / sl : normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-3));
  float width = aParam.x * mix(aParam.z, 1.0, uv.y);
  p += side * (uv.x - 0.5) * 2.0 * width;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vCol = aCol;
  vSeed = aParam.y;
  vGlow = aParam.w;
  vViewZ = -mv.z;
  vLen = len;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vSeed;
varying float vGlow;
varying float vViewZ;
varying float vLen;
uniform float uSoftDist;
${GLSL_SHARED_UNIFORMS}
${GLSL_NOISE}
${GLSL_SOFT}

void main() {
  float across = abs(vUv.x * 2.0 - 1.0);
  // heat sheath: the plasma boils, so the shell edge is never a clean line
  float wob = vfxFbm3(vec3(vUv.y * vLen * 0.9, uTime * 9.0 + vSeed * 30.0, vSeed * 7.0));
  float edge = 1.0 - across * (0.78 + wob * 0.42);
  if (edge <= 0.0) discard;
  float core = pow(clamp(1.0 - across * 1.35, 0.0, 1.0), 7.0);
  float shell = pow(max(edge, 0.0), 2.1);
  // tail fades, head is hottest
  float along = pow(vUv.y, 1.35);
  float a = (core * 1.35 + shell * 0.5) * along * vGlow;
  vec3 col = mix(vCol, vec3(1.0, 0.96, 0.9), core * 0.85) * (1.0 + core * 3.2);
  a *= vfxSoftFade(vViewZ, uSoftDist);
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
}
`;

export class TracerSystem {
  constructor(scene, shared, { cap = 64 } = {}) {
    this.cap = cap;
    this.shared = shared;
    this.aFrom = new Float32Array(cap * 3);
    this.aTo = new Float32Array(cap * 3);
    this.aCol = new Float32Array(cap * 3);
    this.aParam = new Float32Array(cap * 4);
    this.written = 0;

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
    geo.setAttribute('aFrom', attr(this.aFrom, 3));
    geo.setAttribute('aTo', attr(this.aTo, 3));
    geo.setAttribute('aCol', attr(this.aCol, 3));
    geo.setAttribute('aParam', attr(this.aParam, 4));
    this._attrs = ['aFrom', 'aTo', 'aCol', 'aParam'].map((k) => geo.getAttribute(k));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      uniforms: withShared(shared, { uSoftDist: { value: 0.6 } }),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 14;
    attachDriver(this.mesh, shared);
    scene.add(this.mesh);
    this.geo = geo;
    this.mat = mat;
  }

  begin() {
    this.written = 0;
  }

  /** Push one bolt for this frame. `col` is a THREE.Color. */
  push(fx, fy, fz, tx, ty, tz, radius, col, seed, taper = 0.3, glow = 1) {
    if (this.written >= this.cap) return;
    const i = this.written++;
    const i3 = i * 3;
    const i4 = i * 4;
    this.aFrom[i3] = fx; this.aFrom[i3 + 1] = fy; this.aFrom[i3 + 2] = fz;
    this.aTo[i3] = tx; this.aTo[i3 + 1] = ty; this.aTo[i3 + 2] = tz;
    this.aCol[i3] = col.r; this.aCol[i3 + 1] = col.g; this.aCol[i3 + 2] = col.b;
    this.aParam[i4] = radius;
    this.aParam[i4 + 1] = seed;
    this.aParam[i4 + 2] = taper;
    this.aParam[i4 + 3] = glow;
  }

  end() {
    this.geo.instanceCount = this.written;
    this.mesh.visible = this.written > 0;
    if (this.written === 0) return;
    for (const a of this._attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.written * a.itemSize);
      a.needsUpdate = true;
    }
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}
