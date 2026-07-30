/**
 * GPU particle layers.
 *
 * One InstancedBufferGeometry per blend mode. A particle's whole trajectory
 * is a launch state (position, velocity, drag, gravity, local ground height)
 * that is uploaded once at spawn and evaluated analytically in the vertex
 * shader at time t — the CPU never touches a live particle, so a 2000-ember
 * firefight costs one integer sweep for expiry and nothing else.
 *
 * Pooling discipline is inherited from the original vfx.js and must not
 * regress: free slots are only reused when they are genuinely dead *and*
 * below the high-water mark, and the tail is compacted so `instanceCount`
 * shrinks back down when the fight stops. A dead slot needs no upload at
 * all — the vertex shader collapses any instance whose age exceeds its
 * lifetime off-screen, so death is pure CPU bookkeeping.
 */
import * as THREE from 'three';
import {
  GLSL_NOISE, GLSL_SHARED_UNIFORMS, GLSL_SOFT, GLSL_ATLAS,
  GLSL_BILLBOARD, GLSL_BALLISTIC,
} from './shaders.js';
import { withShared, attachDriver } from './shared.js';

/**
 * Reusable spawn descriptor. Filled in by the caller and consumed
 * immediately, so the hot loop never allocates. Call `beginSpawn()` first
 * to get documented defaults back.
 */
export const S = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  r: 1, g: 1, b: 1,
  life: 0.6,
  size: 0.3,
  size1: -1,      // < 0 → same as size (no growth)
  drag: 2.2,
  grav: 0,        // × 9 m/s², matching the legacy vfx.js scaling
  stretch: 0,     // metres of motion blur per m/s of screen velocity
  ground: 0.03,
  tile: 0,
  alpha: 1,
  spin: 0,
};

export function beginSpawn() {
  S.x = 0; S.y = 0; S.z = 0;
  S.vx = 0; S.vy = 0; S.vz = 0;
  S.r = 1; S.g = 1; S.b = 1;
  S.life = 0.6;
  S.size = 0.3;
  S.size1 = -1;
  S.drag = 2.2;
  S.grav = 0;
  S.stretch = 0;
  S.ground = 0.03;
  S.tile = 0;
  S.alpha = 1;
  S.spin = 0;
  return S;
}

const VERT = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
attribute vec3 aCol;
attribute vec4 aA;   // birth, life, size0, size1
attribute vec4 aB;   // drag, grav, stretch, groundY
attribute vec4 aC;   // seed, tile, alpha, spin

uniform float uFadeIn;
uniform float uFadeOut;
uniform float uGroundFade;

varying vec2 vUv;
varying vec3 vCol;
varying float vTile;
varying float vAlpha;
varying float vAge;
varying float vSeed;
varying float vViewZ;
varying float vContact;

${GLSL_SHARED_UNIFORMS}
${GLSL_BILLBOARD}
${GLSL_BALLISTIC}

void main() {
  float t = uTime - aA.x;
  float life = max(aA.y, 0.0001);
  float k = t / life;
  if (t < 0.0 || k >= 1.0) {
    // dead slot: collapse outside the frustum, no CPU upload needed
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  VfxState st = vfxIntegrate(aStart, aVel, aB.x, aB.y, aB.w, t);
  vec4 mv = modelViewMatrix * vec4(st.pos, 1.0);
  vec3 viewVel = (modelViewMatrix * vec4(st.vel, 0.0)).xyz;

  float size = mix(aA.z, aA.w, k);
  float angle = aC.x * 6.28318 + aC.w * t;
  vec3 vp = vfxBillboard(mv.xyz, position.xy, size, angle, viewVel, aB.z);

  gl_Position = projectionMatrix * vec4(vp, 1.0);
  vUv = uv;
  vCol = aCol;
  vTile = aC.y;
  vSeed = aC.x;
  vAge = k;
  vAlpha = aC.z * smoothstep(0.0, uFadeIn, k) * pow(1.0 - k, uFadeOut);
  vViewZ = -vp.z;

  /* Ground contact fade. A depth-buffer soft fade is better and takes over
     as soon as a depth texture is bound, but the dominant case by far is a
     smoke puff cutting a hard line across the paving — and that we can fix
     with no depth buffer at all. The view-space quad offset is rotated back
     into world space with the second row of the view rotation, giving the
     true world height of this corner above the particle's ground plane. */
  vec3 viewUpInWorld = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float cornerWorldY = st.pos.y + dot(vp - mv.xyz, viewUpInWorld);
  vContact = mix(1.0, clamp((cornerWorldY - aB.w) / 0.7, 0.0, 1.0), uGroundFade);
}
`;

function fragment(mode) {
  const common = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vCol;
    varying float vTile;
    varying float vAlpha;
    varying float vAge;
    varying float vSeed;
    varying float vViewZ;
    varying float vContact;
    uniform float uSoftDist;
    uniform float uIntensity;
    ${GLSL_SHARED_UNIFORMS}
    ${GLSL_ATLAS}
    ${GLSL_SOFT}
    ${GLSL_NOISE}
  `;

  if (mode === 'additive') {
    return /* glsl */ `
      ${common}
      void main() {
        vec4 tx = texture2D(uAtlas, vfxTileUv(vUv, vTile));
        float a = tx.a * vAlpha * vContact;
        if (a < 0.003) discard;
        // embers flicker: a cheap per-particle temporal wobble
        float flick = 0.82 + 0.18 * sin(uTime * (22.0 + vSeed * 30.0) + vSeed * 40.0);
        a *= vfxSoftFade(vViewZ, uSoftDist);
        gl_FragColor = vec4(vCol * uIntensity * flick, a);
      }
    `;
  }

  if (mode === 'smoke') {
    // Premultiplied "over": lets one pass both darken (thick smoke) and add
    // (hot lit edges), which is what makes smoke read as volume instead of
    // as a grey decal.
    return /* glsl */ `
      ${common}
      uniform vec3 uEmberCol;
      void main() {
        vec4 tx = texture2D(uAtlas, vfxTileUv(vUv, vTile));
        float a = tx.a * vAlpha * vContact;
        if (a < 0.004) discard;
        // fake a spherical normal across the billboard so the sun shapes it
        vec2 d = vUv * 2.0 - 1.0;
        float r2 = dot(d, d);
        vec3 n = vec3(d, sqrt(max(0.0, 1.0 - r2)));
        vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float diff = max(dot(n, L), 0.0);
        float wrap = max(dot(n, L) * 0.5 + 0.5, 0.0);
        vec3 lit = vCol * (uAmbCol * (0.55 + 0.45 * wrap) + uSunCol * diff * 0.85);
        // young smoke still carries heat from the fire that made it
        lit += uEmberCol * pow(1.0 - vAge, 3.5) * 1.6;
        // thicker in the middle: cheap self-shadowing
        lit *= mix(1.0, 0.62, smoothstep(0.75, 0.0, r2) * 0.9);
        a *= vfxSoftFade(vViewZ, uSoftDist);
        gl_FragColor = vec4(lit * uIntensity * a, a);
      }
    `;
  }

  if (mode === 'debris') {
    return /* glsl */ `
      ${common}
      void main() {
        vec4 tx = texture2D(uAtlas, vfxTileUv(vUv, vTile));
        float a = tx.a * vAlpha;
        if (a < 0.25) discard;
        vec2 d = vUv * 2.0 - 1.0;
        vec3 n = normalize(vec3(d * 0.7, 0.72));
        vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
        float diff = max(dot(n, L), 0.0);
        // flat spinning chips catch the sun on one side only
        vec3 lit = vCol * (uAmbCol * 0.9 + uSunCol * diff);
        gl_FragColor = vec4(lit * uIntensity * a, a);
      }
    `;
  }

  // haze — a low-amplitude warm carrier for heat shimmer. Genuine
  // refraction needs the scene colour buffer (see the wiring request);
  // until that exists this keeps a visible, cheap wobble over flame.
  return /* glsl */ `
    ${common}
    void main() {
      vec4 tx = texture2D(uAtlas, vfxTileUv(vUv, vTile));
      float a = tx.a * vAlpha * vContact;
      if (a < 0.004) discard;
      float w = vfxFbm3(vec3(vUv * 5.0, uTime * 1.6 + vSeed * 20.0));
      a *= 0.35 + w * 0.9;
      a *= vfxSoftFade(vViewZ, uSoftDist);
      gl_FragColor = vec4(vCol * uIntensity * (0.6 + w * 0.8), a * 0.55);
    }
  `;
}

const BLEND = {
  additive: { blending: THREE.AdditiveBlending },
  debris: { blending: THREE.NormalBlending },
  haze: { blending: THREE.AdditiveBlending },
  smoke: {
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  },
};

export class ParticleLayer {
  constructor(scene, shared, atlas, opts = {}) {
    const cap = this.cap = opts.cap ?? 512;
    this.shared = shared;
    this.mode = opts.mode ?? 'additive';

    this.aStart = new Float32Array(cap * 3);
    this.aVel = new Float32Array(cap * 3);
    this.aCol = new Float32Array(cap * 3);
    this.aA = new Float32Array(cap * 4);
    this.aB = new Float32Array(cap * 4);
    this.aC = new Float32Array(cap * 4);
    this.death = new Float32Array(cap);

    this.count = 0;         // high-water mark == instanceCount
    this.free = [];         // dead slots below the high-water mark
    this._recycle = -1;     // fair round-robin when every slot is live
    this._lo = cap;         // dirty range for this frame
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
    this._attrs = [
      geo.setAttribute('aStart', attr(this.aStart, 3)).getAttribute('aStart'),
      geo.setAttribute('aVel', attr(this.aVel, 3)).getAttribute('aVel'),
      geo.setAttribute('aCol', attr(this.aCol, 3)).getAttribute('aCol'),
      geo.setAttribute('aA', attr(this.aA, 4)).getAttribute('aA'),
      geo.setAttribute('aB', attr(this.aB, 4)).getAttribute('aB'),
      geo.setAttribute('aC', attr(this.aC, 4)).getAttribute('aC'),
    ];
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.ShaderMaterial({
      uniforms: withShared(shared, {
        uAtlas: { value: atlas },
        uSoftDist: { value: opts.soft ?? 1.4 },
        uIntensity: { value: opts.intensity ?? 1 },
        uFadeIn: { value: opts.fadeIn ?? 0.08 },
        uFadeOut: { value: opts.fadeOut ?? 1.5 },
        uGroundFade: { value: opts.groundFade ?? 0 },
        uEmberCol: { value: new THREE.Color(opts.ember ?? 0x000000) },
      }),
      vertexShader: VERT,
      fragmentShader: fragment(this.mode),
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...BLEND[this.mode],
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = opts.renderOrder ?? 10;
    attachDriver(this.mesh, shared);
    scene.add(this.mesh);
    this.geo = geo;
    this.mat = mat;
  }

  /** Allocate a slot, honouring the free-list/high-water/round-robin rules. */
  _alloc() {
    let i;
    while (this.free.length > 0) {
      const c = this.free.pop();
      // A slot the tail compaction has already reclaimed is not ours to reuse.
      if (c < this.count && this.death[c] <= 0) { i = c; break; }
    }
    if (i === undefined) {
      if (this.count < this.cap) i = this.count++;
      else i = this._recycle = (this._recycle + 1) % this.cap;
    }
    return i;
  }

  /** Spawn from the shared descriptor `S`. Allocation-free. */
  spawn(s = S) {
    const i = this._alloc();
    const i3 = i * 3;
    const i4 = i * 4;
    this.aStart[i3] = s.x; this.aStart[i3 + 1] = s.y; this.aStart[i3 + 2] = s.z;
    this.aVel[i3] = s.vx; this.aVel[i3 + 1] = s.vy; this.aVel[i3 + 2] = s.vz;
    this.aCol[i3] = s.r; this.aCol[i3 + 1] = s.g; this.aCol[i3 + 2] = s.b;
    const now = this.shared.time;
    this.aA[i4] = now;
    this.aA[i4 + 1] = s.life;
    this.aA[i4 + 2] = s.size;
    this.aA[i4 + 3] = s.size1 < 0 ? s.size : s.size1;
    this.aB[i4] = s.drag;
    this.aB[i4 + 1] = s.grav;
    this.aB[i4 + 2] = s.stretch;
    this.aB[i4 + 3] = s.ground;
    this.aC[i4] = _seedCounter = (_seedCounter * 0.6180339887 + 0.317) % 1;
    this.aC[i4 + 1] = s.tile;
    this.aC[i4 + 2] = s.alpha;
    this.aC[i4 + 3] = s.spin;
    this.death[i] = now + s.life;
    if (i < this._lo) this._lo = i;
    if (i > this._hi) this._hi = i;
    return i;
  }

  update() {
    const now = this.shared.time;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const d = this.death[i];
      if (d <= 0) continue;
      if (d <= now) {
        this.death[i] = 0;
        this.free.push(i);
      }
    }
    // compact the tail so idle frames cost nothing
    while (this.count > 0 && this.death[this.count - 1] <= 0) this.count--;
    this.geo.instanceCount = this.count;
    this.mesh.visible = this.count > 0;

    if (this._hi >= this._lo) {
      const lo = this._lo;
      const n2 = this._hi - lo + 1;
      for (const a of this._attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(lo * a.itemSize, n2 * a.itemSize);
        a.needsUpdate = true;
      }
      this._lo = this.cap;
      this._hi = -1;
    }
  }

  get alive() {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.death[i] > 0) n++;
    return n;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

/* Deterministic per-particle seed sequence (golden-ratio low-discrepancy).
 * Cosmetic only, but it keeps Math.random() out of the hot loop entirely. */
let _seedCounter = 0.37;
