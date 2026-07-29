/**
 * One uniform object shared by every VFX material.
 *
 * Two things every system needs and none of them owns: the current effect
 * clock, and the camera/framebuffer state needed for the soft-particle
 * depth fade. Rather than requiring main.js to push those in (main.js is
 * owned by someone else), each VFX mesh refreshes them from
 * `onBeforeRender`, which three.js calls with the live renderer and camera.
 * Any visible VFX mesh keeps the block fresh for all the others, and if
 * nothing is visible then nothing needs it.
 */
import * as THREE from 'three';
import { makeDummyDepth } from './atlas.js';

export function makeShared() {
  const uniforms = {
    uTime: { value: 0 },
    uInvRes: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
    uNear: { value: 0.12 },
    uDepth: { value: makeDummyDepth() },
    uSoft: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.55, 0.34, -0.76).normalize() },
    uSunCol: { value: new THREE.Color(0xffc98a).multiplyScalar(1.15) },
    uAmbCol: { value: new THREE.Color(0x6a7690).multiplyScalar(0.55) },
  };
  return {
    uniforms,
    /** monotonic effect clock, advanced by dt so pausing really pauses */
    time: 0,
    _size: new THREE.Vector2(),
    advance(dt) {
      this.time += dt;
      uniforms.uTime.value = this.time;
    },
    /**
     * Called from every VFX mesh's onBeforeRender. Cheap and idempotent.
     *
     * The soft-particle depth lookup is `gl_FragCoord.xy * uInvRes`, and
     * gl_FragCoord is in the resolution of the target currently bound — the
     * composer's HDR buffer, not the canvas — so the size has to come from
     * the bound render target when there is one. Reading the drawing-buffer
     * size instead would silently skew the lookup on any frame where the
     * post stack renders at a different resolution than the canvas.
     */
    sync(renderer, camera) {
      const rt = renderer.getRenderTarget();
      let w;
      let h;
      if (rt) {
        w = rt.width;
        h = rt.height;
      } else {
        renderer.getDrawingBufferSize(this._size);
        w = this._size.x;
        h = this._size.y;
      }
      if (w > 0 && h > 0) uniforms.uInvRes.value.set(1 / w, 1 / h);
      if (camera.isPerspectiveCamera) uniforms.uNear.value = camera.near;
    },
  };
}

/** Attach the shared-uniform refresh to a mesh. */
export function attachDriver(mesh, shared) {
  mesh.onBeforeRender = (renderer, scene, camera) => shared.sync(renderer, camera);
}

/** Build the uniform map for a material: shared block + own uniforms. */
export function withShared(shared, own) {
  return Object.assign({}, shared.uniforms, own);
}
