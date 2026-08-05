/**
 * The rifts — the game's central motif, so this is the hero effect.
 *
 * Not a glowing cylinder: a tear. One mesh per rift, five quads (two
 * crossed vertical planes for the wound itself, two crossed planes for the
 * column of heat above it, one ground skirt), all in a single shader pass
 * using premultiplied blending so the *same* pass can punch a dark hole in
 * the world, ring it with a blown-out torn rim, spill light onto the
 * cobbles and haze the air above — one draw call per rift.
 *
 * The rest of the effect is shared systems: embers and grit dragged inward,
 * ambient wisps, a scorch ring burned into the paving, a shockwave when it
 * opens and a violent implosion when it dies.
 */
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_SHARED_UNIFORMS, GLSL_SOFT } from './shaders.js';
import { withShared, attachDriver } from './shared.js';
import { PREMULTIPLIED } from './instanced.js';

const VERT = /* glsl */ `
attribute float aPart;

varying vec2 vUv;
varying float vPart;
varying float vViewZ;
varying vec3 vWorld;

uniform float uOpen;
uniform float uCollapse;
${GLSL_SHARED_UNIFORMS}

void main() {
  vec3 p = position;
  // the whole tear grows out of nothing, then pinches shut when it dies
  float grow = uOpen * (1.0 - uCollapse * 0.75);
  if (aPart < 0.5) {
    p.x *= mix(0.15, 1.0, grow);
    p.y *= mix(0.25, 1.0, smoothstep(0.0, 0.7, uOpen));
  } else {
    p.xz *= mix(0.3, 1.0, grow);
  }
  vec4 world = modelMatrix * vec4(p, 1.0);
  vec4 mv = viewMatrix * world;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vPart = aPart;
  vViewZ = -mv.z;
  vWorld = world.xyz;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vPart;
varying float vViewZ;
varying vec3 vWorld;

uniform float uSeed;
uniform float uOpen;
uniform float uCollapse;
uniform float uHurt;
uniform float uPulse;
uniform vec3 uCol;
uniform vec3 uRim;
uniform float uSoftDist;
${GLSL_SHARED_UNIFORMS}
${GLSL_NOISE}
${GLSL_SOFT}

void main() {
  vec2 c = vUv * 2.0 - 1.0;
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;
  float t = uTime;

  if (vPart < 0.5) {
    /* ---- the wound ---- */
    float prof = pow(max(0.0, 1.0 - abs(c.y)), 0.62);
    float ridge = vfxRidge(vec3(c.y * 2.4, t * 0.35 + uSeed * 10.0, uSeed * 3.0));
    float ridge2 = vfxRidge(vec3(c.y * 6.1 - t * 0.8, uSeed * 4.0, 2.0));
    float edge = prof * (0.30 + ridge * 0.40 + ridge2 * 0.18) * (0.85 + uPulse * 0.15);
    edge *= 1.0 - uCollapse * 0.9;
    float ax = abs(c.x);
    float inside = 1.0 - smoothstep(edge - 0.03, edge + 0.008, ax);

    /* interior: near-black, with something suggested moving behind it */
    float depth = vfxFbm(vec3(c * 1.6, t * 0.20 + uSeed * 7.0));
    float filaments = pow(vfxRidge(vec3(c.x * 5.0, c.y * 1.4 - t * 0.55, uSeed * 5.0)), 4.0);
    float mote = smoothstep(0.68, 0.99, vfxFbm3(vec3(c * 0.85, t * 0.14 + uSeed * 4.0)));
    vec3 interior = mix(vec3(0.004, 0.002, 0.008), vec3(0.085, 0.018, 0.030), depth);
    interior += uCol * filaments * 1.25;
    interior += uCol * mote * 0.75;
    // a hot throat deep in the middle
    interior += uRim * pow(max(0.0, 1.0 - length(c * vec2(2.6, 1.1))), 3.5) * 0.9;

    /* rim: thin, blown out, torn */
    float rimD = abs(ax - edge);
    float rim = exp(-rimD / (0.030 + 0.02 * ridge2)) * (0.55 + ridge * 0.8);
    /* tendrils of light leaking out past the rim */
    float outside = max(0.0, ax - edge);
    float tend = pow(vfxRidge(vec3(c.y * 7.0 + t * 0.5, uSeed * 11.0, c.x * 2.0)), 5.0);
    float leak = exp(-outside / 0.10) * tend * prof * 2.4;
    /* soft halo around the whole tear */
    float halo = exp(-outside / (0.30 + 0.15 * ridge)) * prof * 0.55;

    float hot = 1.0 + uHurt * 5.0 + uCollapse * 9.0;
    rgb = interior * inside
        + uRim * rim * (3.4 + uPulse * 1.2) * hot
        + uCol * (leak + halo) * hot;
    alpha = inside * 0.97;
  } else if (vPart < 1.5) {
    /* ---- light spilling onto the cobbles ---- */
    float r = length(c);
    float fall = pow(max(0.0, 1.0 - r), 2.3);
    float n = vfxFbm3(vec3(c * 2.1, t * 0.28 + uSeed * 6.0));
    float crack = pow(vfxRidge3(vec3(c * 2.6, uSeed * 2.0)), 5.0) * pow(max(0.0, 1.0 - r), 1.2);
    rgb = uCol * fall * (0.45 + n * 0.85) * (1.6 + uPulse * 0.5) * uOpen;
    rgb += uRim * crack * 1.5 * uOpen;
    rgb *= 1.0 + uCollapse * 5.0;
    alpha = 0.0;
  } else {
    /* ---- the column of superheated air above the tear ---- */
    float ax = abs(c.x);
    float h = vUv.y;
    float taper = 1.0 - h * 0.42;
    float n = vfxFbm3(vec3(c.x * 2.2, h * 3.4 - t * 0.6, uSeed * 9.0));
    float body = (1.0 - smoothstep(0.18 * taper, taper, ax + (n - 0.5) * 0.55));
    body *= pow(1.0 - h, 1.9) * uOpen;
    vec3 cool = mix(uCol, vec3(0.35, 0.10, 0.05), h);
    rgb = cool * body * (0.42 + n * 0.5) * (1.0 + uCollapse * 3.0);
    alpha = 0.0;
  }

  float soft = vfxSoftFade(vViewZ, uSoftDist);
  rgb *= soft;
  alpha *= soft;
  if (alpha < 0.004 && dot(rgb, rgb) < 1e-6) discard;
  gl_FragColor = vec4(rgb, clamp(alpha, 0.0, 0.98));
}
`;

/** Five quads: tear ×2 (crossed), ground skirt, column ×2 (crossed). */
function buildGeometry(scale) {
  const pos = [];
  const uvs = [];
  const part = [];
  const idx = [];

  const quad = (a, b, c, d, partId) => {
    const base = pos.length / 3;
    for (const v of [a, b, c, d]) pos.push(v[0], v[1], v[2]);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    part.push(partId, partId, partId, partId);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Sized to the collider main.js puts around a rift (3.0 × 3.6 × scale) and
  // to riftNear()'s 3.4 m / +4.2 m test, so the bright part of the wound is
  // where bolts actually register.
  const W = 4.4 * scale;
  const H = 5.2 * scale;
  const y0 = 0.1;
  // tear, plane in XY
  quad([-W / 2, y0, 0], [W / 2, y0, 0], [W / 2, y0 + H, 0], [-W / 2, y0 + H, 0], 0);
  // tear, plane in ZY (crossed, so the wound never disappears edge-on)
  quad([0, y0, -W / 2], [0, y0, W / 2], [0, y0 + H, W / 2], [0, y0 + H, -W / 2], 0);

  // ground skirt
  const G = 8.5 * scale;
  quad([-G, 0.06, -G], [G, 0.06, -G], [G, 0.06, G], [-G, 0.06, G], 1);

  // column
  const C = 5.4 * scale;
  const CH = 24 * scale;
  quad([-C / 2, y0 + H * 0.35, 0], [C / 2, y0 + H * 0.35, 0], [C / 2, CH, 0], [-C / 2, CH, 0], 2);
  quad([0, y0 + H * 0.35, -C / 2], [0, y0 + H * 0.35, C / 2], [0, CH, C / 2], [0, CH, -C / 2], 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H * 0.5, 0), CH);
  return geo;
}

const _v = new THREE.Vector3();

/** One material per rift: uSeed, uOpen and uCollapse are all per-instance. */
function riftMaterial(shared, seed) {
  return new THREE.ShaderMaterial({
    uniforms: withShared(shared, {
      uSeed: { value: seed },
      uOpen: { value: 0 },
      uCollapse: { value: 0 },
      uHurt: { value: 0 },
      uPulse: { value: 0 },
      uCol: { value: new THREE.Color(0xff5a22).multiplyScalar(1.0) },
      uRim: { value: new THREE.Color(0xffd08a).multiplyScalar(1.0) },
      uSoftDist: { value: 0.9 },
    }),
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    side: THREE.DoubleSide,
    ...PREMULTIPLIED,
  });
}

/**
 * Park the rift program in three's cache at boot.
 *
 * Every rift needs its own material, but they all share this file's shader
 * source, so three keys them to a single program — and whichever rift is
 * drawn first pays for compiling it. That is always the frame a wave starts
 * on, alongside the first draw of half the particle layers, which is exactly
 * the frame that can least afford ~300 ms. So one hidden mesh goes into the
 * scene before the boot-time prewarm instead. It is never drawn and never
 * disposed: three releases a program when the last material using it is
 * disposed, and rifts are disposed every time one is sealed.
 *
 * Must be constructed through `riftMaterial()` — the program cache key covers
 * material properties like `side`, so a hand-rolled warm-up material could
 * quietly warm a variant no rift ever asks for.
 *
 * @returns {THREE.Mesh} the parked mesh, for the caller to hold on to.
 */
export function warmRiftProgram(scene, shared) {
  const mesh = new THREE.Mesh(buildGeometry(1), riftMaterial(shared, 0));
  mesh.name = 'rift.prewarm';
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

/**
 * @param {object} fx  the VFX facade — the rift borrows its shared particle,
 *                     decal, shockwave and light pools rather than owning any.
 */
export function createRift(fx, scene, shared, pos, scale = 1) {
  const geo = buildGeometry(scale);
  const seed = ((Math.abs(pos.x) * 7.31 + Math.abs(pos.z) * 3.77) % 10) / 10;
  const mat = riftMaterial(shared, seed);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = true;
  mesh.renderOrder = 13;
  mesh.rotation.y = seed * Math.PI * 2;
  mesh.position.copy(pos);
  attachDriver(mesh, shared);
  scene.add(mesh);

  const slot = fx.acquireRiftLight();
  const light = slot ? slot.light : null;
  const lightlessBoost = light ? 1 : 1.5;
  if (light) {
    light.position.set(pos.x, pos.y + 2.2, pos.z);
    light.distance = 34 * scale;
    light.color.setHex(0xff6a30);
  }

  const u = mat.uniforms;
  const rift = {
    group: mesh,
    mesh,
    light,
    pos: mesh.position,
    scale,
    seed,
    t: seed * 10,
    hurt: 0,
    open: 0,
    _collapsing: 0,
    _emberAcc: 0,
    _wispAcc: 0,
    _scorched: false,

    update(dt) {
      rift.t += dt;
      rift.open = Math.min(1, rift.open + dt * 1.6);
      u.uOpen.value = rift.open;
      rift.hurt = Math.max(0, rift.hurt - dt * 3.4);
      u.uHurt.value = rift.hurt;
      const pulse = 0.5 + 0.5 * Math.sin(rift.t * 2.3) * Math.sin(rift.t * 0.71 + 1.3);
      u.uPulse.value = pulse;

      if (light) {
        light.intensity = (10 + pulse * 7 + rift.hurt * 26) * scale * rift.open;
      }

      // burn the paving under it once it is properly open
      if (!rift._scorched && rift.open > 0.6) {
        rift._scorched = true;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + seed * 6;
          const r = 2.2 * scale + fx.rng.float(0, 2.4) * scale;
          _v.set(pos.x + Math.cos(a) * r, pos.y + 0.02, pos.z + Math.sin(a) * r);
          fx.scorch(_v, UP, 5.0 * scale, 0.55, 120);
        }
      }

      /* embers and grit dragged inward, plus wisps rising off the rim */
      rift._emberAcc += dt * (26 + pulse * 16) * scale * lightlessBoost;
      while (rift._emberAcc >= 1) {
        rift._emberAcc -= 1;
        fx.riftInflow(pos, scale, rift.t);
      }
      rift._wispAcc += dt * 7 * scale;
      while (rift._wispAcc >= 1) {
        rift._wispAcc -= 1;
        fx.riftWisp(pos, scale);
      }
    },

    /** main.js damages rifts through vfx.impactSpark; this is the flinch. */
    flinch(amount = 1) {
      rift.hurt = Math.min(1.4, rift.hurt + amount);
    },

    dispose(opts = null) {
      // A rift that was shot dead gets a violent collapse; one torn down by a
      // level reset goes quietly. `_collapsing` is set by VFX.explosion() when
      // a blast lands on top of a live rift, which is exactly what main.js
      // does one line before it disposes a killed rift — but it also survives a
      // near miss the rift walked away from, so a teardown that is definitely
      // not a kill says so with `{quiet: true}`.
      if (slot) {
        slot.light.intensity = 0;
        slot.busy = false;
      }
      fx.forgetRift(rift);
      if (rift._collapsing > 0 && !(opts && opts.quiet)) {
        fx.riftCollapse(pos, scale);
        // main.js disposes a killed rift in the same frame it explodes it, so
        // hand the mesh to VFX for a third of a second: uCollapse pinches the
        // wound shut and blows the rim white on the way out.
        fx.adoptDyingRift(mesh, geo, mat);
        return;
      }
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };

  // opening shockwave + a shove of debris
  fx.riftOpen(pos, scale);
  fx.rememberRift(rift);
  return rift;
}

const UP = { x: 0, y: 1, z: 0 };
