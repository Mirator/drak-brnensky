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

  pmrem.dispose();
  cubeRT.dispose();
  captureMesh.geometry.dispose();
  captureScene.clear();

  return {
    texture: envRT.texture,
    renderTarget: envRT,
    /** Baseline intensity, so the quality/settings layer can scale it. */
    intensity,
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
