/**
 * The dragon's breath.
 *
 * A jet of quads emitted continuously along the breath axis. Each one is
 * advected in the vertex shader by a curl-noise field plus buoyancy, so the
 * volume spreads, tumbles and rises instead of holding a cone shape; when a
 * blob reaches the ground it flattens and runs outward, which is what makes
 * a flamethrower look like it is *pooling* rather than passing through the
 * cobbles.
 *
 * The fragment shader ramps each blob from white-hot at the nozzle through
 * orange to a sooty, *occluding* tail, so the far end of the jet reads as
 * black smoke rather than as more fire.
 */
import * as THREE from 'three';
import {
  GLSL_NOISE, GLSL_SHARED_UNIFORMS, GLSL_SOFT, GLSL_FIRE, GLSL_ATLAS,
} from './shaders.js';
import { makeQuadLayer, PREMULTIPLIED, RingPool } from './instanced.js';

const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec4 aA;   // birth, life, size0, size1
attribute vec4 aB;   // seed, spread, buoyancy, ground

varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying float vViewZ;
varying float vPool;

${GLSL_SHARED_UNIFORMS}
${GLSL_NOISE}

void main() {
  float t = uTime - aA.x;
  float life = max(aA.y, 0.0001);
  float k = t / life;
  if (t < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  // the jet decelerates hard — flame does not keep its muzzle speed
  float d = 2.6;
  vec3 p = aStart + aVel * ((1.0 - exp(-d * t)) / d);
  // buoyancy, and turbulent advection that grows with age
  p.y += aB.z * t * t * 1.35;
  vec3 curl = vfxCurl(aStart * 0.22 + vec3(aB.x * 9.0), t * 0.9 + aB.x * 4.0);
  p += curl * aB.y * t * (0.45 + k);

  // pool along the ground instead of sinking through it
  float pool = 0.0;
  float over = aB.w - p.y;
  if (over > 0.0) {
    pool = clamp(over * 0.7, 0.0, 1.0);
    p.y = aB.w + over * 0.12;
    vec2 outward = aVel.xz;
    float ol = length(outward);
    if (ol > 0.001) p.xz += (outward / ol) * over * 1.5;
  }

  float size = mix(aA.z, aA.w, 1.0 - pow(1.0 - k, 1.6));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ang = aB.x * 6.28318 + t * (aB.x - 0.5) * 1.4;
  float s = sin(ang), c = cos(ang);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  mv.xy += q * size * 2.0;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vAge = k;
  vSeed = aB.x;
  vViewZ = -mv.z;
  vPool = pool;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAge;
varying float vSeed;
varying float vViewZ;
varying float vPool;
uniform float uSoftDist;
uniform float uHeat;
${GLSL_SHARED_UNIFORMS}
${GLSL_NOISE}
${GLSL_FIRE}
${GLSL_ATLAS}
${GLSL_SOFT}

void main() {
  vec2 d = vUv * 2.0 - 1.0;
  float r = length(d);
  if (r > 1.0) discard;
  vec3 np = vec3(d * 2.1, vSeed * 31.0 + vAge * 2.2 - uTime * 0.6);
  float n = vfxFbm3(np);
  float ridge = vfxRidge3(np * 0.9 + 3.0);
  float torn = 0.40 + n * 0.78;
  float cov = 1.0 - smoothstep(torn * 0.5, torn, r);
  if (cov <= 0.003) discard;

  // hot at the nozzle, cooling fast, sooty at the tail
  float heat = clamp((1.0 - vAge * 1.55) * uHeat + (n - 0.5) * 0.8 - r * 0.4 + ridge * 0.3, 0.0, 1.0);
  heat = mix(heat, min(1.0, heat + 0.25), vPool);   // pooled fire stays hot
  vec3 col = vfxFireRamp(heat);

  float soot = smoothstep(0.42, 1.0, vAge) * (1.0 - vPool * 0.7);
  float alpha = cov * soot * 0.85;
  float glow = cov * (1.0 - smoothstep(0.55, 1.0, vAge));
  float soft = vfxSoftFade(vViewZ, uSoftDist);
  alpha *= soft;
  gl_FragColor = vec4(col * glow * soft * 1.2, clamp(alpha, 0.0, 0.92));
}
`;

export class FlameSystem {
  constructor(scene, shared, atlas, { cap = 260 } = {}) {
    this.shared = shared;
    this.pool = new RingPool(cap);
    this.layer = makeQuadLayer(scene, shared, {
      cap,
      attrs: { aStart: 3, aVel: 3, aA: 4, aB: 4 },
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSoftDist: { value: 1.1 },
        uHeat: { value: 1.15 },
        uAtlas: { value: atlas },
      },
      blend: PREMULTIPLIED,
      renderOrder: 12,
    });
  }

  blob(x, y, z, vx, vy, vz, life, size0, size1, spread, buoyancy, ground, seed) {
    const now = this.shared.time;
    const i = this.pool.alloc(now, life);
    const a = this.layer.arrays;
    const i3 = i * 3;
    const i4 = i * 4;
    a.aStart[i3] = x; a.aStart[i3 + 1] = y; a.aStart[i3 + 2] = z;
    a.aVel[i3] = vx; a.aVel[i3 + 1] = vy; a.aVel[i3 + 2] = vz;
    a.aA[i4] = now; a.aA[i4 + 1] = life; a.aA[i4 + 2] = size0; a.aA[i4 + 3] = size1;
    a.aB[i4] = seed; a.aB[i4 + 1] = spread; a.aB[i4 + 2] = buoyancy; a.aB[i4 + 3] = ground;
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
