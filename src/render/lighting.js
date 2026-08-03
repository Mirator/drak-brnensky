import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { CSMShader } from 'three/addons/csm/CSMShader.js';
import { SUN_DIR } from './sky.js';

/* ==================================================================
   lighting.js — cascaded sun, dusk light ratio, street-lamp pools
   ==================================================================

   Shadows
   -------
   `three/addons/csm/CSM.js` is present in this build, so the sun is a
   3-cascade CSM rig over ~220 m. CSM already texel-snaps each cascade's
   centre and only recomputes the ortho *extents* in `updateFrustums()`
   (not per frame) — which together is exactly what kills the shadow
   swimming the single 78 m box had.

   Two things about the addon needed working around:

   1. `CSM._injectInclude()` replaces three's `lights_fragment_begin`
      chunk wholesale with a **stale copy** (r185's CSMShader.js is
      behind core: it is missing the iridescence dielectric/metallic
      split and the `SHADOWMAP_TYPE_PCF` guard on point-light shadows).
      Because the replacement is global it would degrade *every*
      material, CSM or not. So we snapshot the pristine chunks first and
      re-patch surgically afterwards: keep core's code verbatim and only
      prepend CSM's cascade-selecting directional block, guarding core's
      own directional block with `!defined( USE_CSM )`. If the anchor
      cannot be found we fall back to a single snapped directional light
      rather than shipping a broken shader.

   2. `CSM.setupMaterial()` *assigns* `material.onBeforeCompile`, which
      would silently clobber anything src/materials.js does with it. Our
      own `setupMaterial` chains instead.

   Every lit material has to be registered with CSM, and materials keep
   appearing after boot (pooled VFX, rift visuals, whatever materials.js
   grows into). Rather than hoping one boot-time walk catches everything,
   `update()` re-walks the scene at ~1 Hz; a WeakSet makes repeat visits
   free and only genuinely new materials trigger a recompile.
   ================================================================== */

export const SHADOW_PRESETS = {
  low: 1024,
  medium: 1536,
  high: 2048,
  ultra: 3072,
};

/* Cascade splits as a fraction of the shadow range. Fixed rather than
 * CSM's 'practical' mode so the cascade extents — and therefore the
 * texel size we snap to — are predictable. */
const SPLITS = [0.10, 0.32, 1.0];
const SHADOW_RANGE = 220;

/* How many lamps get a real point light. Fixed forever: see the pool note
 * in the README — changing the visible light count recompiles materials.
 * Kept at 4 deliberately: the scene already carries 14 point lights (4 hit
 * + 8 rift in vfx.js, 2 on the player) and every one of them is a per-
 * fragment loop iteration in a forward renderer. Lamps sit ~30 m apart, so
 * 4 covers everything within useful range of the player anyway. */
const LAMP_LIGHT_COUNT = 4;
const LAMP_LIGHT_RANGE = 26;

export function createLighting(scene, camera, {
  shadowMapSize = SHADOW_PRESETS.high,
  sunIntensity = 2.9,
  /* The IBL level. Owned here rather than at the call site because it is
   * part of the light ratio, not a property of the bake — and because
   * three only honours scene.environmentIntensity for materials whose
   * `envMap === null` (WebGLRenderer ~2696), which makes it the *only*
   * usable IBL knob: it overwrites each material's own envMapIntensity. */
  envIntensity = 2.2,
} = {}) {
  /* ---------------- dusk light ratio ----------------
   * Measured, not guessed. `render.envDiagnostics()` on the shipped build
   * reported a shaded-facade patch at 0.0638 HDR luminance of which IBL was
   * only 0.0078 — about 12% — with the rest coming from analytic fill. The
   * cause was the sky dome's Rayleigh exponent (see sky.js): the bake was a
   * thin bright ring at the horizon with a near-black dome above it, so
   * there was almost no sky irradiance for the IBL to deliver and the
   * hemisphere and skyFill lights were faking it with flat grey.
   *
   * With the dome fixed, the analytic fills come down and the environment
   * does that work instead — which is the whole point, because a shadowed
   * wall should be lit by a *directional gradient* of sky, not by a
   * constant. hemi and skyFill are now closer to a nudge than a light
   * source; the bounce stays because nothing in an env map captured from
   * the sky knows about warm light coming back off the cobbles. */

  const hemi = new THREE.HemisphereLight(0x6f8dc4, 0x2a2118, 0.17);
  scene.add(hemi);

  // cool sky fill, from the opposite azimuth and higher up
  const skyFill = new THREE.DirectionalLight(0x6d8ecb, 0.28);
  skyFill.position.set(-SUN_DIR.x * 0.7, 0.85, -SUN_DIR.z * 0.7).normalize().multiplyScalar(100);
  scene.add(skyFill);

  // warm ground bounce, almost horizontal, from the sun side
  const bounce = new THREE.DirectionalLight(0xffa066, 0.16);
  bounce.position.set(SUN_DIR.x * 0.9, -0.35, SUN_DIR.z * 0.9).normalize().multiplyScalar(100);
  scene.add(bounce);

  /* main.js sets this from the bake's own default; override it here so the
   * whole ratio lives in one place. */
  scene.environmentIntensity = envIntensity;

  /* ---------------- sun: cascades or a single snapped light ---------------- */
  const sunColor = new THREE.Color(0xffb570);
  const lightDirection = SUN_DIR.clone().negate(); // CSM wants "direction of travel"

  const pristine = {
    lights_fragment_begin: THREE.ShaderChunk.lights_fragment_begin,
    lights_pars_begin: THREE.ShaderChunk.lights_pars_begin,
  };

  let csm = null;
  let sun = null;
  const csmPatch = buildCsmChunks(pristine);

  if (csmPatch) {
    csm = new CSM({
      camera,
      parent: scene,
      cascades: SPLITS.length,
      maxFar: SHADOW_RANGE,
      mode: 'custom',
      customSplitsCallback: (cascades, near, far, target) => {
        target.length = 0;
        for (const s of SPLITS) target.push(s);
      },
      shadowMapSize,
      shadowBias: -0.00035,
      lightDirection,
      lightIntensity: sunIntensity,
      lightNear: 1,
      lightFar: 900,
      lightMargin: 220,
    });
    // undo CSM's stale global chunk replacement with the surgical version
    THREE.ShaderChunk.lights_fragment_begin = csmPatch.lights_fragment_begin;
    THREE.ShaderChunk.lights_pars_begin = csmPatch.lights_pars_begin;

    for (const light of csm.lights) {
      light.color.copy(sunColor);
      light.shadow.normalBias = 0.035;
      light.shadow.camera.near = 1;
    }
    // tighter filtering on the near cascade, softer far out
    if (csm.lights[0]) csm.lights[0].shadow.radius = 1.4;
    if (csm.lights[1]) csm.lights[1].shadow.radius = 2.2;
    if (csm.lights[2]) csm.lights[2].shadow.radius = 3.0;
    sun = csm.lights[0];
  } else {
    // Fallback: one directional light, but frustum-sized and texel-snapped
    // (the baseline snapped its *target* to a 4 m grid, which is what made
    // the shadows visibly jump).
    console.warn('[render] CSM shader anchor not found — falling back to a single snapped shadow light.');
    sun = new THREE.DirectionalLight(sunColor, sunIntensity);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 600;
    const half = 90;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 1.8;
    scene.add(sun, sun.target);
  }

  /* ---------------- street-lamp point lights ----------------
   * city.js places the lamp heads as one emissive InstancedMesh but does
   * not hand back the positions, and city.js is not ours to edit — so we
   * recover them from the instance matrices. The light count is fixed
   * forever (the README's pool rule): unused slots sit at zero intensity
   * instead of being removed. */
  const lampLights = [];
  for (let i = 0; i < LAMP_LIGHT_COUNT; i++) {
    const l = new THREE.PointLight(0xffb765, 0, LAMP_LIGHT_RANGE, 2);
    l.position.set(0, -1000, 0);
    scene.add(l);
    lampLights.push(l);
  }
  let lampPositions = null;

  /* ---------------- material registration ---------------- */
  const registered = new WeakSet();
  const boosted = new WeakSet();
  let registerTimer = 0;
  let frame = 0;

  function setupMaterial(material) {
    if (!csm || registered.has(material)) return;
    registered.add(material);

    material.defines = material.defines || {};
    material.defines.USE_CSM = 1;
    material.defines.CSM_CASCADES = csm.cascades;

    const breaks = [];
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderer) {
      if (previous) previous.call(this, shader, renderer);
      const far = Math.min(csm.camera.far, csm.maxFar);
      extendBreaks(csm, breaks);
      shader.uniforms.CSM_cascades = { value: breaks };
      shader.uniforms.cameraNear = { value: csm.camera.near };
      shader.uniforms.shadowFar = { value: far };
      csm.shaders.set(material, shader);
    };
    csm.shaders.set(material, null);
    material.needsUpdate = true;
  }

  /** Lit materials only — CSM patches `lights_fragment_begin`. */
  function isLit(m) {
    return !!(m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial
      || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial));
  }

  /**
   * Registers every lit material under `root` with CSM and lifts the
   * emissive materials so lamps/windows clear the bloom threshold.
   */
  function registerMaterials(root = scene) {
    root.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (!isLit(m)) continue;
        setupMaterial(m);
        boostEmissive(m, o);
      }
    });
  }

  /* Emissive lift. We cannot touch city.js/materials.js, but we can scale
   * the material instances they produced: bloom needs the lamp bulbs and
   * lit windows above the highpass threshold while sunlit plaster stays
   * below it. The WeakSet makes this strictly once-per-material — it is
   * multiplicative, so running it twice would run away. */
  function boostEmissive(m, owner) {
    if (boosted.has(m) || !m.emissive) return;
    boosted.add(m);
    const e = m.emissive;
    if (e.r + e.g + e.b < 0.001) return;
    const intensity = m.emissiveIntensity === undefined ? 1 : m.emissiveIntensity;
    // small self-lit props (lamp bulbs, tram marker lights) read as actual
    // light sources and get pushed well over the threshold; big mapped
    // surfaces (window sheets on facades) only get a nudge
    const isBulb = owner && owner.isInstancedMesh && !m.emissiveMap;
    m.emissiveIntensity = intensity * (isBulb ? 2.6 : 1.9);
  }

  function findLampPositions() {
    let best = null;
    scene.traverse((o) => {
      if (!o.isInstancedMesh || o.count < 20) return;
      const m = o.material;
      if (!m || !m.emissive || m.emissive.r + m.emissive.g + m.emissive.b < 0.05) return;
      if (m.emissiveMap) return;
      if (!best || o.count > best.count) best = o;
    });
    if (!best) return null;
    const out = [];
    const mat = new THREE.Matrix4();
    for (let i = 0; i < best.count; i++) {
      best.getMatrixAt(i, mat);
      out.push(new THREE.Vector3(mat.elements[12], mat.elements[13], mat.elements[14]));
    }
    return out;
  }

  /* ---------------- per-frame ---------------- */
  const _center = new THREE.Vector3();
  const _slots = [];

  function updateLampLights(focus) {
    if (lampPositions === null) {
      lampPositions = findLampPositions() || [];
    }
    if (!lampPositions.length) return;

    // nearest N lamps to the focus point, cheap partial selection
    _slots.length = 0;
    const maxD2 = (LAMP_LIGHT_RANGE * 1.6) ** 2;
    for (const p of lampPositions) {
      const dx = p.x - focus.x;
      const dz = p.z - focus.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > maxD2) continue;
      if (_slots.length < LAMP_LIGHT_COUNT) {
        _slots.push({ p, d2 });
        _slots.sort((a, b) => a.d2 - b.d2);
      } else if (d2 < _slots[LAMP_LIGHT_COUNT - 1].d2) {
        _slots[LAMP_LIGHT_COUNT - 1] = { p, d2 };
        _slots.sort((a, b) => a.d2 - b.d2);
      }
    }

    for (let i = 0; i < lampLights.length; i++) {
      const light = lampLights[i];
      const slot = _slots[i];
      if (!slot) {
        light.intensity = 0;
        continue;
      }
      // lamp heads sit at y = 7.1; put the light just under the bulb
      light.position.set(slot.p.x, 6.7, slot.p.z);
      // fade the outermost slot in/out so a lamp entering range does not pop
      const t = 1 - THREE.MathUtils.clamp(
        (Math.sqrt(slot.d2) - LAMP_LIGHT_RANGE * 0.9) / (LAMP_LIGHT_RANGE * 0.7), 0, 1,
      );
      light.intensity = 18 * t;
    }
  }

  /* Cascades cost one full scene depth pass each, and the outermost one
   * covers ~220 m so it redraws most of the visible city. Refreshing it on
   * alternate frames roughly halves that.
   *
   * This is only safe because three skips `shadow.updateMatrices()` along
   * with the render when `needsUpdate` is false, so the stale shadow map
   * and the stale `shadow.matrix` still agree with each other — the band
   * from 70 m out is simply one frame behind, which is sub-pixel. */
  function staggerFarCascade() {
    if (api.shadowStagger < 2) return;
    const last = csm.lights[csm.lights.length - 1];
    if (!last || csm.lights.length < 2) return;
    last.shadow.autoUpdate = false;
    /* `shadow.map === null` has to force the render. three allocates the
     * shadow map *inside* the loop it skips for a light with
     * autoUpdate = false and needsUpdate = false, so on any frame where this
     * cascade is skipped before it has ever rendered — frame 1, and again
     * after setShadowResolution() nulls the map — there is no depth texture
     * for the shader to sample. three then binds its 1x1 `emptyShadowTexture`
     * to a `sampler2DShadow`, and because the array-uniform path does not set
     * a compareFunction on it (unlike the single-texture path), every shadowed
     * draw in that frame is a texture-complete-but-not-comparable sample: the
     * far band silently loses its shadows, and the browser reports it as
     * "TEXTURE_2D at unit N is not a depth texture with TEXTURE_COMPARE_MODE"
     * once per draw call until it caps the warning. */
    last.shadow.needsUpdate = last.shadow.map === null
      || (frame % api.shadowStagger) === 0;
  }

  function snapSingleShadow(focus) {
    // texel-snap both the light and its target so the shadow map samples
    // land on the same world positions frame to frame
    const cam = sun.shadow.camera;
    const texel = (cam.right - cam.left) / sun.shadow.mapSize.width;
    const x = Math.round(focus.x / texel) * texel;
    const z = Math.round(focus.z / texel) * texel;
    sun.target.position.set(x, 0, z);
    sun.position.set(x + SUN_DIR.x * 200, SUN_DIR.y * 200 + 30, z + SUN_DIR.z * 200);
  }

  const api = {
    hemi,
    skyFill,
    bounce,
    csm,
    sun,
    lampLights,
    get shadowMapSize() { return shadowMapSize; },
    get cascades() { return csm ? csm.cascades : 1; },
    /** Refresh the outermost cascade every Nth frame. 1 = every frame. */
    shadowStagger: 2,

    /**
     * The IBL level. This is the only knob that works: three overwrites each
     * material's `envMapIntensity` with `scene.environmentIntensity` for any
     * material with `envMap === null`, so per-material values are ignored.
     */
    get envIntensity() { return scene.environmentIntensity; },
    setEnvIntensity(value) {
      scene.environmentIntensity = Math.max(0, value);
      return scene.environmentIntensity;
    },

    registerMaterials,

    /**
     * Force every cascade to re-render its shadow map on the next render.
     * Needed before a still capture: the outermost cascade is normally
     * staggered, so a one-off `update()` after teleporting the camera would
     * otherwise leave the far band showing the previous frustum's shadows.
     */
    forceShadowUpdate() {
      const lights = csm ? csm.lights : [sun];
      for (const light of lights) light.shadow.needsUpdate = true;
    },

    /**
     * Call after a camera aspect/fov change. CSM sizes its cascade boxes
     * from the camera frustum at this moment and then leaves them alone,
     * which is what keeps the shadows stable — so it must NOT be called
     * per frame. We temporarily widen the fov so the boxes cover the
     * whole 62°–80° range the chase camera breathes through.
     */
    updateFrustums() {
      if (!csm) return;
      const fov = camera.fov;
      camera.fov = 82;
      camera.updateProjectionMatrix();
      csm.updateFrustums();
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },

    setShadowResolution(size) {
      if (size === shadowMapSize) return;
      shadowMapSize = size;
      const lights = csm ? csm.lights : [sun];
      for (const light of lights) {
        light.shadow.mapSize.set(size, size);
        if (light.shadow.map) {
          light.shadow.map.dispose();
          light.shadow.map = null;
        }
      }
      if (csm) {
        csm.shadowMapSize = size;
        api.updateFrustums();
      }
    },

    /** Focus point for the lamp pool and the fallback shadow box. */
    update(dt, focus) {
      // CSM fits its cascades from camera.matrixWorld, and the chase camera
      // has only just written position/rotation — without this the cascades
      // lag a frame and the shadow bands pop while turning.
      camera.updateMatrixWorld();
      frame++;
      if (csm) {
        csm.update();
        staggerFarCascade();
      } else {
        snapSingleShadow(focus);
      }

      updateLampLights(focus);

      registerTimer -= dt;
      if (registerTimer <= 0) {
        registerTimer = 1;
        registerMaterials();
      }
    },

    dispose() {
      if (csm) {
        csm.remove();
        csm.dispose();
      }
    },
  };

  return api;
}

/* ------------------------------------------------------------------ */
/* CSM chunk surgery                                                  */
/* ------------------------------------------------------------------ */

const CORE_DIR_ANCHOR = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const CSM_DIR_ANCHOR = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM ) && defined( CSM_CASCADES )';
const CSM_DIR_END = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM ) && !defined( CSM_CASCADES )';

/**
 * Builds CSM-capable chunks from the *live* core chunks rather than from
 * CSMShader's stale full-file copies. Returns null if either anchor is
 * missing, in which case the caller must not enable CSM.
 *
 * Exported so it can be checked without a GL context — it is pure string
 * surgery over shader source, and it is the one piece here that silently
 * breaks if a future three release renames a chunk anchor.
 */
export function buildCsmChunks(pristine) {
  const core = pristine.lights_fragment_begin;
  const csmSrc = CSMShader.lights_fragment_begin;

  const from = csmSrc.indexOf(CSM_DIR_ANCHOR);
  const to = csmSrc.indexOf(CSM_DIR_END);
  if (from < 0 || to <= from) return null;
  const csmBlock = csmSrc.slice(from, to);

  // core's directional block: from the anchor through its terminating
  // `#endif`. It is the only top-level `#if` with that exact condition.
  const at = core.indexOf(CORE_DIR_ANCHOR);
  if (at < 0) return null;
  // the RectArea block is the next top-level `#if` — everything before it
  // belongs to the directional block
  const nextTop = core.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )', at);
  if (nextTop < 0) return null;

  const head = core.slice(0, at);
  const dirBlock = core.slice(at, nextTop);
  const tail = core.slice(nextTop);

  // guard core's own directional block so exactly one of the two runs
  const guarded = `${CORE_DIR_ANCHOR} && !defined( USE_CSM )${dirBlock.slice(CORE_DIR_ANCHOR.length)}`;

  return {
    lights_fragment_begin: `${head}${csmBlock}\n${guarded}${tail}`,
    lights_pars_begin: /* glsl */`
#if defined( USE_CSM ) && defined( CSM_CASCADES )
uniform vec2 CSM_cascades[ CSM_CASCADES ];
uniform float cameraNear;
uniform float shadowFar;
#endif
${pristine.lights_pars_begin}`,
  };
}

/** CSM's own `_getExtendedBreaks`, reimplemented off the public `breaks`. */
function extendBreaks(csm, target) {
  while (target.length < csm.breaks.length) target.push(new THREE.Vector2());
  target.length = csm.breaks.length;
  for (let i = 0; i < csm.cascades; i++) {
    target[i].x = csm.breaks[i - 1] || 0;
    target[i].y = csm.breaks[i];
  }
}
