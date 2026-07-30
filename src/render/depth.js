import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ==================================================================
   depth.js — linear depth resolve
   ==================================================================

   Why this pass exists at all:

   The scene's DepthTexture is the depth *attachment* of the composer's
   scene buffer. The composer ping-pongs its two colour buffers, so on
   most pass-enable combinations the scene buffer ends up being the write
   target for a later pass — and a pass that sampled the scene depth
   while rendering into that buffer would be a framebuffer feedback loop
   (the same texture bound as a sampler and as an attachment). That is
   undefined behaviour in WebGL2; drivers either return garbage or drop
   the draw.

   So the depth is resolved once, immediately after the scene render,
   into a target that is never anything else's render target. God rays
   and DOF sample that instead and are structurally safe no matter how
   the buffers rotate or which passes are toggled.

   It also stores **linear view distance in metres** rather than raw
   depth, which is worth doing on its own account:

   - With near = 0.12 and far = 2400 every raw depth value in the scene
     is crammed into the top ~0.1% of the [0,1] range, so a half-float
     copy would be worthless. Metres survive half-float fine (~0.1 m at
     200 m).
   - The consumers do 17+ depth taps each; doing the reciprocal once here
     instead of per tap is strictly cheaper.

   RGBA/half-float rather than R16F purely for renderability: an RGBA
   half-float colour target is available everywhere three runs.
   ================================================================== */

const RESOLVE_SHADER = {
  uniforms: {
    tDepth: { value: null },
    uNear: { value: 0.12 },
    uFar: { value: 2400 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDepth;
    uniform float uNear;
    uniform float uFar;
    varying vec2 vUv;
    void main() {
      float d = texture2D( tDepth, vUv ).x;
      // perspectiveDepthToViewZ, negated to a positive distance
      float dist = - ( ( uNear * uFar ) / ( ( uFar - uNear ) * d - uFar ) );
      gl_FragColor = vec4( dist, 0.0, 0.0, 1.0 );
    }`,
};

export class LinearDepthPass extends Pass {
  /**
   * @param {DepthTexture} depthTexture - the scene buffer's depth attachment
   * @param {Camera} camera
   */
  constructor(depthTexture, camera) {
    super();
    // purely a side-channel: it must not disturb the colour chain
    this.needsSwap = false;

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.target.texture.name = 'postfx.linearDepth';

    this._material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(RESOLVE_SHADER.uniforms),
      vertexShader: RESOLVE_SHADER.vertexShader,
      fragmentShader: RESOLVE_SHADER.fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this._material.uniforms.tDepth.value = depthTexture;
    this._material.uniforms.uNear.value = camera.near;
    this._material.uniforms.uFar.value = camera.far;

    this._quad = new FullScreenQuad(this._material);
  }

  /** The linear-distance texture, in metres. */
  get texture() {
    return this.target.texture;
  }

  render(renderer) {
    renderer.setRenderTarget(this.target);
    this._quad.render(renderer);
  }

  setSize(width, height) {
    this.target.setSize(width, height);
  }

  dispose() {
    this.target.dispose();
    this._material.dispose();
    // FullScreenQuad.dispose() would free the shared static geometry.
  }
}
