import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/* ==================================================================
   taa.js — temporal jitter accumulation
   ==================================================================

   Not full TAA: there is no motion-vector reprojection, so this only
   accumulates while the camera is *nearly static*. Any real camera
   motion resets the history, which means it can never ghost — the cost
   of that is simply that it does nothing while you are moving, where
   SMAA is carrying the anti-aliasing on its own.

   Where it earns its keep:

   - standing still / aiming, which is a large share of actual play time
   - the menu orbit and the pause screen
   - `window.__brno.shot()`, which drives it explicitly: a still frame is
     accumulated over N Halton-jittered sub-samples, so the QA captures
     come out properly supersampled instead of merely SMAA'd. That is
     what takes the jaggies off the roof lines in the review shots.

   The jitter itself is applied by postfx.js through
   `camera.setViewOffset()`, which survives the `updateProjectionMatrix()`
   calls the chase camera makes every frame.
   ================================================================== */

/** Halton(2,3), centred on zero — the standard TAA sample pattern. */
export const JITTER = buildHalton(8);

function halton(index, base) {
  let result = 0;
  let f = 1 / base;
  let i = index;
  while (i > 0) {
    result += f * (i % base);
    i = Math.floor(i / base);
    f /= base;
  }
  return result;
}

function buildHalton(count) {
  const out = [];
  for (let i = 1; i <= count; i++) {
    out.push(new THREE.Vector2(halton(i, 2) - 0.5, halton(i, 3) - 0.5));
  }
  return out;
}

const BLEND_SHADER = {
  uniforms: {
    tNew: { value: null },
    tHistory: { value: null },
    uMix: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tNew;
    uniform sampler2D tHistory;
    uniform float uMix;
    varying vec2 vUv;
    void main() {
      vec4 n = texture2D( tNew, vUv );
      vec4 h = texture2D( tHistory, vUv );
      gl_FragColor = mix( h, n, uMix );
    }`,
};

const COPY_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: BLEND_SHADER.vertexShader,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D( tDiffuse, vUv );
    }`,
};

export class TemporalAccumulationPass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;

    /** Weight of the incoming frame. 1 = discard history. */
    this.blend = 1;
    /** Number of jitter samples before the history stops refining. */
    this.maxSamples = JITTER.length;
    this.sampleIndex = 0;

    const options = {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    };
    this._historyRead = new THREE.WebGLRenderTarget(1, 1, options);
    this._historyWrite = new THREE.WebGLRenderTarget(1, 1, options);

    this._blendMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BLEND_SHADER.uniforms),
      vertexShader: BLEND_SHADER.vertexShader,
      fragmentShader: BLEND_SHADER.fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this._copyMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(COPY_SHADER.uniforms),
      vertexShader: COPY_SHADER.vertexShader,
      fragmentShader: COPY_SHADER.fragmentShader,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });

    this._quad = new FullScreenQuad(this._copyMaterial);
  }

  /** Throw the history away — call on any camera movement or resize. */
  reset() {
    this.sampleIndex = 0;
    this.blend = 1;
  }

  /**
   * Advances one sub-sample. Returns the jitter offset in pixels for the
   * frame that is about to be rendered.
   */
  nextSample() {
    const jitter = JITTER[this.sampleIndex % JITTER.length];
    this.blend = 1 / (Math.min(this.sampleIndex, this.maxSamples) + 1);
    this.sampleIndex++;
    return jitter;
  }

  render(renderer, writeBuffer, readBuffer) {
    // blend the incoming frame into the history (ping-pong: a render
    // target cannot be sampled and written in the same draw)
    this._blendMaterial.uniforms.tNew.value = readBuffer.texture;
    this._blendMaterial.uniforms.tHistory.value = this._historyRead.texture;
    this._blendMaterial.uniforms.uMix.value = this.blend;
    this._quad.material = this._blendMaterial;
    renderer.setRenderTarget(this._historyWrite);
    this._quad.render(renderer);

    const swap = this._historyRead;
    this._historyRead = this._historyWrite;
    this._historyWrite = swap;

    // and hand the accumulated result down the chain
    this._copyMaterial.uniforms.tDiffuse.value = this._historyRead.texture;
    this._quad.material = this._copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._quad.render(renderer);
  }

  setSize(width, height) {
    this._historyRead.setSize(width, height);
    this._historyWrite.setSize(width, height);
    this.reset();
  }

  dispose() {
    this._historyRead.dispose();
    this._historyWrite.dispose();
    this._blendMaterial.dispose();
    this._copyMaterial.dispose();
    // NOTE: FullScreenQuad.dispose() frees the *shared* static geometry
    // every pass in the app uses, so it must not be called here.
  }
}
