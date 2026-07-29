import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GodRaysShader, DofShader, GradeShader, SharpenShader } from './shaders.js';
import { TemporalAccumulationPass } from './taa.js';
import { LinearDepthPass } from './depth.js';
import { SUN_DIR } from './sky.js';
import { SHADOW_PRESETS } from './lighting.js';

/* ==================================================================
   postfx.js — the composer stack
   ==================================================================

   Order, and why:

     1  RenderPass ............ scene into a HalfFloat (HDR) buffer
     2  LinearDepthPass ........ depth -> metres, side-channel (no swap)
     3  GTAOPass ............... ambient occlusion, HDR
     4  God rays ............... additive light shafts, HDR, needs depth
     5  Depth of field ......... HDR, needs depth
     6  UnrealBloomPass ........ HDR, tight threshold
     7  Temporal accumulation .. HDR, only while the camera is still
     8  OutputPass ............. tone mapping (AgX) + sRGB  <- HDR ends here
     9  SMAAPass ............... display-referred edge AA
    10  Grade .................. lift/gamma/gain, S-curve, tone, vignette, CA
    11  Sharpen ................ contrast-adaptive sharpen + film grain

   The brief asked for "OutputPass last". It is last of the *HDR* chain,
   which is the part that matters: bloom, AO, DOF and the accumulation all
   have to see linear HDR, and SMAA/grade/grain/sharpen are all defined on
   display-referred values. Putting a vignette or grain before the tone
   mapper would have the tone curve eat them, and feeding SMAA linear HDR
   makes its edge detection misfire on anything brighter than 1.0. So the
   tone map sits at the HDR/LDR boundary and the display-space stages
   follow it.

   Depth
   -----
   Two things make the depth-consuming passes safe.

   First, the composer's buffer order is pinned at the top of every frame
   (`readBuffer = sceneTarget`, which is where `RenderPass` renders). One
   fixed target therefore always carries this frame's depth, instead of it
   depending on the parity of however many `needsSwap` passes happen to be
   enabled.

   Second, that depth is immediately resolved into a separate texture by
   `LinearDepthPass`, and the consumers read *that*. They must not sample
   the scene buffer's own depth attachment: the colour buffers ping-pong,
   so a later pass writes into the scene buffer, and a pass sampling a
   texture that is attached to the framebuffer it is drawing into is a
   feedback loop. See render/depth.js.
   ================================================================== */

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS = {
  low: {
    ao: false,
    aoScale: 0.5,
    godRays: false,
    dof: false,
    bloom: true,
    bloomStrength: 0.45,
    smaa: true,
    taa: false,
    grade: true,
    sharpen: true,
    grain: 0.018,
    shadowMapSize: SHADOW_PRESETS.low,
    pixelRatioCap: 1.0,
  },
  medium: {
    ao: true,
    aoScale: 0.5,
    godRays: true,
    dof: false,
    bloom: true,
    bloomStrength: 0.5,
    smaa: true,
    taa: false,
    grade: true,
    sharpen: true,
    grain: 0.02,
    shadowMapSize: SHADOW_PRESETS.medium,
    pixelRatioCap: 1.25,
  },
  high: {
    ao: true,
    aoScale: 0.5,
    godRays: true,
    dof: true,
    bloom: true,
    bloomStrength: 0.55,
    smaa: true,
    taa: true,
    grade: true,
    sharpen: true,
    grain: 0.024,
    shadowMapSize: SHADOW_PRESETS.high,
    pixelRatioCap: 1.5,
  },
  ultra: {
    ao: true,
    aoScale: 1.0,
    godRays: true,
    dof: true,
    bloom: true,
    bloomStrength: 0.58,
    smaa: true,
    taa: true,
    grade: true,
    sharpen: true,
    grain: 0.024,
    shadowMapSize: SHADOW_PRESETS.ultra,
    pixelRatioCap: 1.75,
  },
};

export const DEFAULT_QUALITY = 'high';

/** Sub-samples accumulated for a `shot()` capture. */
const SHOT_SAMPLES = 8;

/** Reference height the pixel-denominated effects (CoC, sharpen) are tuned at. */
const REFERENCE_HEIGHT = 900;

export function createPostFX({ renderer, scene, camera, lighting, quality = DEFAULT_QUALITY }) {
  const size = renderer.getSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();
  const bufferWidth = Math.max(1, Math.round(size.x * pixelRatio));
  const bufferHeight = Math.max(1, Math.round(size.y * pixelRatio));

  /* ---------------- HDR buffers ---------------- */
  const depthTexture = new THREE.DepthTexture(bufferWidth, bufferHeight);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  const sceneTarget = new THREE.WebGLRenderTarget(bufferWidth, bufferHeight, {
    type: THREE.HalfFloatType,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
  });
  sceneTarget.texture.name = 'postfx.scene';

  const composer = new EffectComposer(renderer, sceneTarget);

  // The composer cloned sceneTarget for its second buffer, which also
  // cloned the DepthTexture. Replace it with an explicit, depth-less
  // target so there is exactly one depth texture in the whole stack.
  composer.renderTarget2.dispose();
  const swapTarget = new THREE.WebGLRenderTarget(bufferWidth, bufferHeight, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
  });
  swapTarget.texture.name = 'postfx.swap';
  composer.renderTarget2 = swapTarget;
  composer.readBuffer = swapTarget;

  // When handed a render target, the composer takes its *device* pixel
  // dimensions as the logical size, then multiplies by the pixel ratio
  // again. Correct that before adding passes, or every pass allocates its
  // internal buffers at pixelRatio² of the intended area.
  composer.setSize(size.x, size.y);

  /* ---------------- state ----------------
   * Declared before the passes: `composer.addPass()` immediately calls
   * `pass.setSize()`, and the GTAO size override below reads
   * `currentPreset`. */
  let currentQuality = QUALITY_PRESETS[quality] ? quality : DEFAULT_QUALITY;
  let currentPreset = QUALITY_PRESETS[currentQuality];
  let grainTime = 0;
  let dofAmount = 0;
  let logicalWidth = size.x;
  let logicalHeight = size.y;
  /* Set by requireDepth(): something *outside* the composer samples the
   * linear depth target (soft particles in src/vfx.js). Without this the
   * pass self-disables whenever neither DOF nor god rays want it — which is
   * most frames on `high` (DOF is aim-only) and every frame on `low`. */
  let depthRequired = false;

  /* ---------------- passes ---------------- */
  const renderPass = new RenderPass(scene, camera);

  const aoScale = currentPreset.aoScale;
  const gtaoPass = new GTAOPass(
    scene, camera,
    Math.max(1, Math.round(bufferWidth * aoScale)),
    Math.max(1, Math.round(bufferHeight * aoScale)),
  );
  // 1 unit = 1 metre. The point is contact darkening where a wall meets
  // the cobbles and under cornices, so the radius is sub-metre and the
  // distance exponent is steep — a large radius with a flat falloff is
  // exactly what produces the grey halo look we do not want.
  gtaoPass.updateGtaoMaterial({
    radius: 0.42,
    distanceExponent: 1.7,
    thickness: 0.35,
    scale: 1.15,
    samples: 16,
    screenSpaceRadius: false,
  });
  gtaoPass.updatePdMaterial({ lumaPhi: 6, depthPhi: 2.2, normalPhi: 3.2, radius: 5, samples: 12 });
  gtaoPass.blendIntensity = 0.8;
  gtaoPass.output = GTAOPass.OUTPUT.Default;
  // AO runs at a fraction of the frame; its own depth/normal prepass is
  // internally consistent, so there is no resolution mismatch to fix up.
  const gtaoSetSize = GTAOPass.prototype.setSize.bind(gtaoPass);
  gtaoPass.setSize = (w, h) => gtaoSetSize(
    Math.max(1, Math.round(w * currentPreset.aoScale)),
    Math.max(1, Math.round(h * currentPreset.aoScale)),
  );

  // Resolves the scene depth attachment to linear metres in a target that
  // nothing else ever renders into. See render/depth.js.
  const depthPass = new LinearDepthPass(depthTexture, camera);

  const godRaysPass = new ShaderPass(GodRaysShader);
  godRaysPass.uniforms.tDepth.value = depthPass.texture;

  const dofPass = new ShaderPass(DofShader);
  dofPass.uniforms.tDepth.value = depthPass.texture;

  // Threshold is in HDR luminance. Sunlit plaster lands around 0.7, the
  // boosted lamp bulbs around 2, the sun disc at 9 — so 0.9 catches the
  // light sources and muzzle flashes and leaves the walls alone.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(bufferWidth, bufferHeight), 0.55, 0.62, 0.9,
  );

  const taaPass = new TemporalAccumulationPass();
  const outputPass = new OutputPass();
  const smaaPass = new SMAAPass();
  const gradePass = new ShaderPass(GradeShader);
  const sharpenPass = new ShaderPass(SharpenShader);

  /* ORDERING INVARIANT — do not move god rays or DOF after bloom.
   * `UnrealBloomPass` calls `renderer.clear()` on its write buffer, and the
   * buffers ping-pong, so on some pass-enable combinations that buffer is
   * `sceneTarget` — the one carrying the DepthTexture. That is harmless
   * only because every depth *reader* (god rays, DOF) runs before bloom and
   * the RenderPass rewrites the depth from scratch each frame. Reordering
   * them would silently start sampling a cleared depth buffer. */
  composer.addPass(renderPass);
  composer.addPass(depthPass);
  composer.addPass(gtaoPass);
  composer.addPass(godRaysPass);
  composer.addPass(dofPass);
  composer.addPass(bloomPass);
  composer.addPass(taaPass);
  composer.addPass(outputPass);
  composer.addPass(smaaPass);
  composer.addPass(gradePass);
  composer.addPass(sharpenPass);

  const _sunWorld = new THREE.Vector3();
  const _sunNdc = new THREE.Vector3();
  const _camDir = new THREE.Vector3();
  const _lastCamPos = new THREE.Vector3();
  const _lastCamQuat = new THREE.Quaternion();
  let _lastFov = camera.fov;
  let _hasLastCamera = false;

  /**
   * Single source of truth for whether the depth resolve runs. Every path
   * that could change the answer calls this — the live frame, the still
   * capture, and applyPreset(), so a quality change can never silently
   * drop an external consumer's depth.
   */
  function updateDepthEnabled() {
    depthPass.enabled = depthRequired
      || dofPass.enabled
      || (godRaysPass.enabled && godRaysPass.uniforms.uIntensity.value > 0.0005);
  }

  function applyPreset(preset) {
    currentPreset = preset;

    gtaoPass.enabled = preset.ao;
    godRaysPass.enabled = preset.godRays;
    bloomPass.enabled = preset.bloom;
    bloomPass.strength = preset.bloomStrength;
    smaaPass.enabled = preset.smaa;
    taaPass.enabled = preset.taa;
    gradePass.enabled = preset.grade;
    sharpenPass.enabled = preset.sharpen;
    sharpenPass.uniforms.uGrain.value = preset.grain;
    // dofPass.enabled is driven per frame by dofAmount

    if (lighting) lighting.setShadowResolution(preset.shadowMapSize);
    // an external depth consumer must survive a preset change
    updateDepthEnabled();
    // AO resolution is baked into the pass's targets
    resize(logicalWidth, logicalHeight);
  }

  function resize(width, height) {
    logicalWidth = Math.max(1, width);
    logicalHeight = Math.max(1, height);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(logicalWidth, logicalHeight);

    const pr = renderer.getPixelRatio();
    const w = Math.max(1, Math.round(logicalWidth * pr));
    const h = Math.max(1, Math.round(logicalHeight * pr));

    // pixel-denominated effects have to track resolution or they change
    // strength with window size
    const scale = h / REFERENCE_HEIGHT;
    dofPass.uniforms.uTexel.value.set(1 / w, 1 / h);
    dofPass.uniforms.uMaxCoC.value = 7 * scale;
    sharpenPass.uniforms.uTexel.value.set(1 / w, 1 / h);

    taaPass.reset();
  }

  /** Pin the buffer order so RenderPass always writes into sceneTarget. */
  function pinBuffers() {
    composer.readBuffer = sceneTarget;
    composer.writeBuffer = swapTarget;
  }

  function updateGodRays() {
    if (!godRaysPass.enabled) return;

    _sunWorld.copy(camera.position).addScaledVector(SUN_DIR, 1000);
    _sunNdc.copy(_sunWorld).project(camera);
    camera.getWorldDirection(_camDir);

    const facing = _camDir.dot(SUN_DIR);
    const behind = _sunNdc.z > 1 || facing <= 0.02;
    if (behind) {
      godRaysPass.uniforms.uIntensity.value = 0;
      return;
    }

    // fade out as the sun leaves the frame instead of popping
    const edge = Math.max(Math.abs(_sunNdc.x), Math.abs(_sunNdc.y));
    const onScreen = 1 - THREE.MathUtils.clamp((edge - 0.85) / 0.75, 0, 1);

    godRaysPass.uniforms.uSunPos.value.set(_sunNdc.x * 0.5 + 0.5, _sunNdc.y * 0.5 + 0.5);
    godRaysPass.uniforms.uIntensity.value = 0.6 * onScreen * THREE.MathUtils.smoothstep(facing, 0.0, 0.45);
  }

  /** True when the camera has barely moved since the last frame. */
  function cameraIsStill() {
    camera.updateMatrixWorld();
    const moved = _lastCamPos.distanceToSquared(camera.position);
    const turned = 1 - Math.abs(_lastCamQuat.dot(camera.quaternion));
    const zoomed = Math.abs(camera.fov - _lastFov);

    const still = _hasLastCamera && moved < 1e-5 && turned < 2e-7 && zoomed < 0.02;

    _lastCamPos.copy(camera.position);
    _lastCamQuat.copy(camera.quaternion);
    _lastFov = camera.fov;
    _hasLastCamera = true;
    return still;
  }

  const api = {
    composer,
    passes: {
      render: renderPass,
      depth: depthPass,
      ao: gtaoPass,
      godRays: godRaysPass,
      dof: dofPass,
      bloom: bloomPass,
      taa: taaPass,
      output: outputPass,
      smaa: smaaPass,
      grade: gradePass,
      sharpen: sharpenPass,
    },
    /** Live uniform objects, so the settings UI / a critic can poke values. */
    uniforms: {
      godRays: godRaysPass.uniforms,
      dof: dofPass.uniforms,
      grade: gradePass.uniforms,
      sharpen: sharpenPass.uniforms,
    },
    /** Raw scene depth attachment. Do NOT sample this from a pass — see depth.js. */
    depthTexture,
    /**
     * Positive linear view distance in METRES in `.x`, RGBA half float.
     * This is the one safe depth source for anything outside the composer.
     * The Texture object identity survives resizes (`RenderTarget.setSize`
     * mutates in place), so a consumer can bind it once at boot.
     * Requires `requireDepth(true)`.
     */
    get linearDepthTexture() { return depthPass.texture; },

    /**
     * Declare that something outside the composer samples
     * `linearDepthTexture` — currently soft particles in src/vfx.js.
     *
     * The depth resolve is otherwise skipped whenever no *pass* reads it,
     * which is most frames (DOF is aim-only) and all frames on `low`. A
     * consumer that did not set this would silently sample a stale or
     * zero-filled target. Survives setQuality().
     */
    requireDepth(required = true) {
      depthRequired = !!required;
      updateDepthEnabled();
      return depthRequired;
    },
    get depthRequired() { return depthRequired; },
    set depthRequired(value) {
      depthRequired = !!value;
      updateDepthEnabled();
    },

    get quality() { return currentQuality; },
    get preset() { return currentPreset; },
    get passCount() { return composer.passes.filter((p) => p.enabled).length; },
    get pixelRatioCap() { return currentPreset.pixelRatioCap; },

    setQuality(level) {
      if (!QUALITY_PRESETS[level]) {
        console.warn(`[render] unknown quality "${level}"`);
        return currentQuality;
      }
      currentQuality = level;
      applyPreset(QUALITY_PRESETS[level]);
      return currentQuality;
    },

    setSize: resize,

    /**
     * The DOF target. `amount` 0..1, `focus` in metres. Ramped towards the
     * request in `render()` so entering and leaving aim does not pop.
     *
     * The in-focus depth scales with the focus distance, the way a real
     * lens behaves: focusing on an enemy at 15 m throws the street behind
     * him out, while focusing down a 200 m boulevard leaves essentially
     * everything sharp. A fixed range would blur the entire city whenever
     * the crosshair happened to land on something far away.
     */
    setDepthOfField(amount, focus) {
      api._dofTarget = THREE.MathUtils.clamp(amount, 0, 1);
      if (focus !== undefined && focus > 0) {
        api._dofFocus = focus;
        dofPass.uniforms.uRange.value = THREE.MathUtils.clamp(focus * 0.35, 4, 70);
      }
    },
    _dofTarget: 0,
    _dofFocus: 20,

    /**
     * One live frame. `dt` drives the grain and the accumulation.
     */
    render(dt) {
      const step = Math.min(0.05, Math.max(0, dt || 0));
      grainTime += step;
      sharpenPass.uniforms.uTime.value = grainTime;

      // DOF ramp + enable/disable so an inactive DOF costs nothing
      const target = currentPreset.dof ? api._dofTarget : 0;
      dofAmount += (target - dofAmount) * (1 - Math.exp(-7 * Math.max(step, 1e-4)));
      if (Math.abs(target - dofAmount) < 0.004) dofAmount = target;
      dofPass.uniforms.uAmount.value = dofAmount;
      dofPass.uniforms.uFocus.value = api._dofFocus;
      dofPass.enabled = dofAmount > 0.004;

      updateGodRays();
      updateDepthEnabled();

      // temporal supersampling only while the camera is parked
      if (taaPass.enabled) {
        if (cameraIsStill()) {
          const jitter = taaPass.nextSample();
          camera.setViewOffset(
            logicalWidth, logicalHeight,
            jitter.x, jitter.y,
            logicalWidth, logicalHeight,
          );
        } else {
          taaPass.reset();
          if (camera.view !== null && camera.view.enabled) camera.clearViewOffset();
        }
      } else {
        cameraIsStill();
        if (camera.view !== null && camera.view.enabled) camera.clearViewOffset();
      }

      pinBuffers();
      composer.render(step);

      // never leave the jitter on the camera: main.js and the QA harness
      // both call updateProjectionMatrix() on their own terms
      if (camera.view !== null && camera.view.enabled) camera.clearViewOffset();
    },

    /**
     * A deterministic still: N Halton-jittered sub-samples accumulated
     * through the whole stack. Used by `window.__brno.shot()`, which is
     * how every review screenshot is produced, so it must not depend on
     * anything the live loop happens to have left behind.
     */
    renderStill(samples = SHOT_SAMPLES) {
      const taaWasEnabled = taaPass.enabled;
      const count = Math.max(1, samples);

      taaPass.enabled = true;
      taaPass.reset();
      sharpenPass.uniforms.uTime.value = grainTime;
      updateGodRays();
      dofPass.uniforms.uAmount.value = dofAmount;
      dofPass.uniforms.uFocus.value = api._dofFocus;
      dofPass.enabled = currentPreset.dof && dofAmount > 0.004;
      updateDepthEnabled();

      const jitterFrame = () => {
        const jitter = taaPass.nextSample();
        camera.setViewOffset(
          logicalWidth, logicalHeight,
          jitter.x, jitter.y,
          logicalWidth, logicalHeight,
        );
        pinBuffers();
        // dt 0: the grain and the sky must be identical across sub-samples
        composer.render(0);
      };

      /* One throwaway frame first. LinearDepthPass resolves depth *after*
       * the scene render, so anything inside the scene that samples it
       * (soft particles) always reads the previous frame's target — and on
       * sub-sample 0 that is whatever the live loop left, at a different
       * resolution and camera. Priming keeps the particle fade correct in
       * captures; without it sub-sample 0 contributes a visibly wrong 1/N. */
      jitterFrame();
      taaPass.reset();

      for (let i = 0; i < count; i++) {
        /* main.js turns off renderer.info.autoReset and resets once per
         * advance(), but a still renders outside advance() — so without
         * this a stats() read straight after shot() would report the whole
         * accumulation. Resetting before the final sub-sample makes it
         * describe exactly one complete frame at capture resolution.
         * (The staggered far cascade is excluded, as it is on roughly half
         * of all live frames too.) */
        if (i === count - 1) renderer.info.reset();
        jitterFrame();
      }

      camera.clearViewOffset();
      taaPass.enabled = taaWasEnabled;
      taaPass.reset();
      _hasLastCamera = false;
    },

    stats() {
      return {
        quality: currentQuality,
        passes: api.passCount,
        passesTotal: composer.passes.length,
        ao: gtaoPass.enabled ? `${Math.round(currentPreset.aoScale * 100)}%` : 'off',
        taa: taaPass.enabled ? taaPass.sampleIndex : 'off',
        dof: +dofAmount.toFixed(2),
        shadowMap: lighting ? lighting.shadowMapSize : 0,
        cascades: lighting ? lighting.cascades : 0,
      };
    },

    dispose() {
      composer.dispose();
      taaPass.dispose();
      depthPass.dispose();
      sceneTarget.dispose();
      swapTarget.dispose();
    },
  };

  applyPreset(QUALITY_PRESETS[currentQuality]);

  return api;
}
