/**
 * Explosion layers: turbulent fireballs and ground shockwave rings.
 *
 * A fireball is not an expanding sphere. Each blast spawns several
 * overlapping puffs with their own seed, drift and phase; each puff is a
 * domain-warped noise field that cools along the fire ramp from white
 * through orange into dark smoke, and switches from *adding* light to
 * *occluding* the world as it cools — that transition is what makes the
 * smoke read as matter rather than as a grey sprite.
 */
import * as THREE from 'three';
import {
  GLSL_NOISE, GLSL_SHARED_UNIFORMS, GLSL_SOFT, GLSL_FIRE, GLSL_ATLAS,
} from './shaders.js';
import { makeQuadLayer, PREMULTIPLIED, RingPool } from './instanced.js';

/* ------------------------------------------------------------------ */
/* fireballs                                                           */
/* ------------------------------------------------------------------ */
const FIRE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute vec4 aA;    // birth, life, radius0, radius1
attribute vec4 aB;    // seed, heat, soot, spin
attribute vec3 aTint;

varying vec2 vUv;
varying vec3 vTint;
varying float vAge;
varying float vSeed;
varying float vHeat;
varying float vSoot;
varying float vViewZ;
varying float vRadius;

${GLSL_SHARED_UNIFORMS}

void main() {
  float t = uTime - aA.x;
  float life = max(aA.y, 0.0001);
  float k = t / life;
  if (t < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // fast expansion that eases hard into its final size
  float e = 1.0 - pow(1.0 - k, 2.6);
  float radius = mix(aA.z, aA.w, e);
  vec3 p = aPos + aVel * (1.0 - exp(-1.9 * t)) / 1.9;
  p.y += k * k * aB.z * 1.2;          // the smoke half keeps rising
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ang = aB.w * t + aB.x * 6.28318;
  float s = sin(ang), c = cos(ang);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mv.xy += q * radius * 2.0;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vTint = aTint;
  vAge = k;
  vSeed = aB.x;
  vHeat = aB.y;
  vSoot = aB.z;
  vViewZ = -mv.z;
  vRadius = radius;
}
`;

const FIRE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vTint;
varying float vAge;
varying float vSeed;
varying float vHeat;
varying float vSoot;
varying float vViewZ;
varying float vRadius;
uniform float uSoftDist;
${GLSL_SHARED_UNIFORMS}
${GLSL_NOISE}
${GLSL_FIRE}
${GLSL_SOFT}

void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  if (r > 1.0) discard;
  vec3 np = vec3(d * 1.9, vSeed * 23.0 + vAge * 1.35);
  // domain warp: the boiling, cauliflower silhouette of a real fireball.
  // One warp field, rotated for the second axis — half the noise cost of
  // sampling two independent fields and visually indistinguishable.
  float wn = vfxFbm3(np * 1.3 + 11.0) - 0.5;
  vec3 warp = vec3(wn, wn * 0.7 - 0.18, 0.0);
  float n = vfxFbm(np + warp * 1.5);
  float ridge = vfxRidge3(np * 0.8 + 5.0);

  float torn = 0.42 + n * 0.72;
  float cov = 1.0 - smoothstep(torn * 0.55, torn, r);
  if (cov <= 0.002) discard;

  // heat: hot in the core, hot early, broken up by the noise
  float heat = clamp((1.0 - vAge * 1.25) * vHeat + (n - 0.5) * 0.85 - r * 0.55 + ridge * 0.25, 0.0, 1.0);
  vec3 col = vfxFireRamp(heat) * vTint;

  // coverage rises as it cools: fire adds light, smoke blocks it
  float smoke = smoothstep(0.30, 0.95, vAge) * vSoot;
  float alpha = cov * smoke * (1.0 - smoothstep(0.85, 1.0, vAge));
  float glow = cov * (1.0 - smoothstep(0.55, 1.0, vAge));
  float soft = vfxSoftFade(vViewZ, uSoftDist * max(1.0, vRadius * 0.35));
  alpha *= soft;
  gl_FragColor = vec4(col * glow * soft * 1.15, clamp(alpha, 0.0, 0.97));
}
`;

const _c = new THREE.Color();

export class FireballSystem {
  constructor(scene, shared, { cap = 96 } = {}) {
    this.shared = shared;
    this.pool = new RingPool(cap);
    this.layer = makeQuadLayer(scene, shared, {
      cap,
      attrs: { aPos: 3, aVel: 3, aA: 4, aB: 4, aTint: 3 },
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      uniforms: { uSoftDist: { value: 1.6 } },
      blend: PREMULTIPLIED,
      renderOrder: 11,
    });
  }

  /**
   * One puff. Several of these make one explosion.
   * @param {number} heat  1 = white-hot core puff, ~0.5 = outer fire
   * @param {number} soot  how opaque it gets as it cools (0 = pure fire)
   */
  puff(x, y, z, vx, vy, vz, r0, r1, life, tint, heat, soot, seed, spin) {
    const now = this.shared.time;
    const i = this.pool.alloc(now, life);
    const a = this.layer.arrays;
    const i3 = i * 3;
    const i4 = i * 4;
    a.aPos[i3] = x; a.aPos[i3 + 1] = y; a.aPos[i3 + 2] = z;
    a.aVel[i3] = vx; a.aVel[i3 + 1] = vy; a.aVel[i3 + 2] = vz;
    a.aA[i4] = now; a.aA[i4 + 1] = life; a.aA[i4 + 2] = r0; a.aA[i4 + 3] = r1;
    a.aB[i4] = seed; a.aB[i4 + 1] = heat; a.aB[i4 + 2] = soot; a.aB[i4 + 3] = spin;
    _c.set(tint);
    a.aTint[i3] = _c.r; a.aTint[i3 + 1] = _c.g; a.aTint[i3 + 2] = _c.b;
  }

  update() {
    const live = this.pool.sweep(this.shared.time);
    this.layer.flush(live > 0 ? this.pool.count : 0, this.pool.lo, this.pool.hi);
    this.pool.clearRange();
  }

  dispose() {
    this.layer.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* ground shockwave                                                    */
/* ------------------------------------------------------------------ */
const WAVE_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec4 aA;   // birth, life, r0, r1
attribute vec4 aB;   // seed, thickness, lift, dust
attribute vec3 aTint;

varying vec2 vUv;
varying vec3 vTint;
varying float vAge;
varying float vSeed;
varying float vDust;
varying float vViewZ;

${GLSL_SHARED_UNIFORMS}

void main() {
  float t = uTime - aA.x;
  float life = max(aA.y, 0.0001);
  float k = t / life;
  if (t < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float e = 1.0 - pow(1.0 - k, 2.2);
  float radius = mix(aA.z, aA.w, e);
  // flat on the ground, lifting slightly as the dust rolls up
  vec3 world = aPos + vec3(position.x * radius * 2.0, k * aB.z, position.y * radius * 2.0);
  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vTint = aTint;
  vAge = k;
  vSeed = aB.x;
  vDust = aB.w;
  vViewZ = -mv.z;
}
`;

const WAVE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vTint;
varying float vAge;
varying float vSeed;
varying float vDust;
varying float vViewZ;
uniform float uSoftDist;
${GLSL_SHARED_UNIFORMS}
${GLSL_NOISE}
${GLSL_ATLAS}
${GLSL_SOFT}

void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  if (r > 1.0) discard;
  float ang = atan(d.y, d.x);
  float wob = vfxFbm3(vec3(cos(ang) * 2.4, sin(ang) * 2.4, vSeed * 12.0)) - 0.5;
  // thin ring that thickens and softens as it travels
  float w = mix(0.055, 0.30, vAge) + wob * 0.10;
  float band = exp(-pow((r - (0.80 + wob * 0.06)) / max(0.02, w), 2.0));
  float fade = pow(1.0 - vAge, 1.7);
  float dust = band * fade * vDust;
  float hot = band * pow(1.0 - vAge, 5.0);
  vec3 col = vTint * (0.35 + hot * 6.0);
  float a = clamp(dust * 0.85, 0.0, 0.9) * vfxSoftFade(vViewZ, uSoftDist);
  gl_FragColor = vec4(col * a + vTint * hot * 1.6 * a, a);
}
`;

export class ShockwaveSystem {
  constructor(scene, shared, atlas, { cap = 16 } = {}) {
    this.shared = shared;
    this.pool = new RingPool(cap);
    this.layer = makeQuadLayer(scene, shared, {
      cap,
      attrs: { aPos: 3, aA: 4, aB: 4, aTint: 3 },
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
      uniforms: { uSoftDist: { value: 0.5 }, uAtlas: { value: atlas } },
      blend: PREMULTIPLIED,
      renderOrder: 8,
    });
  }

  ring(x, y, z, r0, r1, life, tint, dust, lift, seed) {
    const now = this.shared.time;
    const i = this.pool.alloc(now, life);
    const a = this.layer.arrays;
    const i3 = i * 3;
    const i4 = i * 4;
    a.aPos[i3] = x; a.aPos[i3 + 1] = y; a.aPos[i3 + 2] = z;
    a.aA[i4] = now; a.aA[i4 + 1] = life; a.aA[i4 + 2] = r0; a.aA[i4 + 3] = r1;
    a.aB[i4] = seed; a.aB[i4 + 1] = 0; a.aB[i4 + 2] = lift; a.aB[i4 + 3] = dust;
    _c.set(tint);
    a.aTint[i3] = _c.r; a.aTint[i3 + 1] = _c.g; a.aTint[i3 + 2] = _c.b;
  }

  update() {
    const live = this.pool.sweep(this.shared.time);
    this.layer.flush(live > 0 ? this.pool.count : 0, this.pool.lo, this.pool.hi);
    this.pool.clearRange();
  }

  dispose() {
    this.layer.dispose();
  }
}
