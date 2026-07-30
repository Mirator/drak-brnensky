import * as THREE from 'three';

/* ==================================================================
   env.js — image-based lighting from the sky shader
   ==================================================================

   The sky dome is rendered once into a cube render target at boot and
   run through PMREMGenerator; the result becomes `scene.environment`.

   This is the single highest-leverage change for material readability:
   without it a MeshStandardMaterial has no specular source at all, so
   stone and plaster resolve to flat coloured plastic. With it, roughness
   actually means something and the shadowed sides of buildings pick up
   sky colour instead of dying at the hemisphere light's floor.

   Cheap: one 6-face render of a single shader sphere plus the PMREM
   convolution, all at boot, then everything is freed except the final
   PMREM texture.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* readback instrumentation                                           */
/* ------------------------------------------------------------------ */

/**
 * IEEE 754 half → float. Needed because every buffer in this pipeline is
 * HalfFloatType, and `readRenderTargetPixels` hands those back as raw
 * Uint16 that mean nothing until decoded.
 */
export function decodeHalf(h) {
  const sign = (h & 0x8000) ? -1 : 1;
  const exponent = (h & 0x7c00) >> 10;
  const fraction = h & 0x03ff;
  if (exponent === 0) return sign * 6.103515625e-5 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * (2 ** (exponent - 15)) * (1 + fraction / 1024);
}

/**
 * Reads a patch out of a render target and returns luminance statistics.
 *
 * This exists because the pipeline is unobservable from here: the only way
 * to answer "is this buffer actually black" without a browser is to make
 * the renderer tell us. Reports `nan` separately from `mean` on purpose —
 * a NaN-filled buffer and a black buffer look identical to a "non-zero"
 * test, which is exactly how the fog bug hid.
 *
 * Causes a GPU sync stall, so this is boot-time and on-demand only.
 */
export function probeRenderTarget(renderer, target, options = {}) {
  if (!renderer || !target) return { ok: false, error: 'no renderer or target' };

  const size = Math.max(1, Math.min(options.size || 16, target.width, target.height));
  const x = options.x !== undefined ? options.x : Math.max(0, Math.floor((target.width - size) / 2));
  const y = options.y !== undefined ? options.y : Math.max(0, Math.floor((target.height - size) / 2));
  const count = size * size;

  const type = target.texture.type;
  const isHalf = type === THREE.HalfFloatType;
  const isFloat = type === THREE.FloatType;
  let buffer;
  if (isHalf) buffer = new Uint16Array(count * 4);
  else if (isFloat) buffer = new Float32Array(count * 4);
  else buffer = new Uint8Array(count * 4);
  const scale = buffer instanceof Uint8Array ? 1 / 255 : 1;

  try {
    renderer.readRenderTargetPixels(target, x, y, size, size, buffer, options.face);
  } catch (error) {
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }

  let sum = 0;
  let max = 0;
  let nan = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const r = isHalf ? decodeHalf(buffer[o]) : buffer[o] * scale;
    const g = isHalf ? decodeHalf(buffer[o + 1]) : buffer[o + 1] * scale;
    const b = isHalf ? decodeHalf(buffer[o + 2]) : buffer[o + 2] * scale;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (!Number.isFinite(lum)) { nan++; continue; }
    sum += lum;
    if (lum > max) max = lum;
  }
  const finite = count - nan;
  return {
    ok: true,
    mean: finite ? sum / finite : 0,
    max,
    nan,
    samples: count,
  };
}

const fmtProbe = (p) => (p.ok
  ? `mean ${p.mean.toFixed(4)} max ${p.max.toFixed(3)}${p.nan ? ` NaN ${p.nan}/${p.samples}` : ''}`
  : `FAILED (${p.error})`);

export function buildEnvironment(renderer, sky, { resolution = 256, intensity = 0.9 } = {}) {
  const cubeRT = new THREE.WebGLCubeRenderTarget(resolution, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  // A dedicated tiny dome: the real one has radius 1200, which would sit
  // outside any sane cube-camera far plane.
  const captureScene = new THREE.Scene();
  const captureMesh = sky.makeCaptureMesh();
  captureScene.add(captureMesh);

  const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRT);

  const oldTarget = renderer.getRenderTarget();
  const oldToneMapping = renderer.toneMapping;
  // the env map must stay linear HDR — tone mapping is a display transform
  renderer.toneMapping = THREE.NoToneMapping;
  cubeCamera.update(renderer, captureScene);
  renderer.toneMapping = oldToneMapping;
  renderer.setRenderTarget(oldTarget);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  const envRT = pmrem.fromCubemap(cubeRT.texture);

  /* Verify the bake before throwing the source away. "scene.environment is a
   * Texture with the right mapping" is not evidence that it contains
   * anything — a correctly-configured but black env map contributes exactly
   * zero and is indistinguishable from IBL being switched off. Measure it. */
  /* All six faces, because the *distribution* is the thing that matters:
   * a bright horizon ring with a black dome above it gives rim light and no
   * ambient fill, and reading two faces cannot tell you that.
   * Cube face order is +X, -X, +Y, -Y, +Z, -Z. */
  const FACES = ['+X', '-X', '+Y(up)', '-Y(down)', '+Z', '-Z'];
  /* Whole faces, not centre patches: the centre of a horizon face points
   * exactly at the brightest band, so a centre-patch average reads ~5x high
   * on those faces and is not a spherical mean at all. */
  const faces = FACES.map((_, i) => probeRenderTarget(renderer, cubeRT, { size: cubeRT.width, face: i }));
  const usable = faces.filter((f) => f.ok);
  const sphereMean = usable.length
    ? usable.reduce((a, f) => a + f.mean, 0) / usable.length
    : 0;

  const probe = {
    faces: Object.fromEntries(FACES.map((n, i) => [n, faces[i]])),
    /** Mean of the six faces — a fair stand-in for whole-sphere irradiance. */
    sphereMean,
    /* NOTE: the PMREM output is a mip *atlas*, so a centre patch of it is an
     * arbitrary region and NOT a spherical average — an earlier version of
     * this log reported it as though it were, and it read ~6x low. Kept only
     * as a "did PMREM write anything at all" liveness check. */
    pmremAtlasPatch: probeRenderTarget(renderer, envRT, { size: 16 }),
  };
  const faceSummary = FACES.map((n, i) => `${n} ${faces[i].ok ? faces[i].mean.toFixed(4) : 'FAIL'}`).join('  ');
  const summary = `sphereMean ${sphereMean.toFixed(4)} | ${faceSummary} | atlas ${fmtProbe(probe.pmremAtlasPatch)}`;
  if (!probe.pmrem.ok || probe.pmrem.nan > 0 || probe.pmrem.mean < 1e-4) {
    console.error(`[render] IBL bake looks EMPTY or invalid — ${summary}`);
  } else {
    console.info(`[render] IBL bake ok — ${summary}`);
  }

  pmrem.dispose();
  cubeRT.dispose();
  captureMesh.geometry.dispose();
  captureScene.clear();

  return {
    texture: envRT.texture,
    renderTarget: envRT,
    /** Baseline intensity, so the quality/settings layer can scale it. */
    intensity,
    /** Measured bake statistics — see the console line logged at boot. */
    probe,
    dispose() {
      envRT.dispose();
    },
  };
}

/**
 * Installs the env map. Changing `scene.environment` from null to a
 * texture toggles USE_ENVMAP on every standard material, so this has to
 * happen before the boot-time `renderer.compile()` — otherwise the first
 * gameplay frame pays for a full shader recompile.
 */
export function applyEnvironment(scene, env, intensity = env.intensity) {
  scene.environment = env.texture;
  scene.environmentIntensity = intensity;
}

/**
 * Per-material `envMapIntensity` override. `scene.environmentIntensity`
 * is the global knob and should normally be preferred; this exists for
 * the cases where a specific material family needs pulling back.
 */
export function setEnvMapIntensity(root, value, predicate = null) {
  const seen = new Set();
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      if (m.envMapIntensity === undefined) continue;
      if (predicate && !predicate(m, o)) continue;
      m.envMapIntensity = value;
    }
  });
}
