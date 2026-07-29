/**
 * Boilerplate for "one instanced quad layer = one draw call" systems.
 * Every VFX system in this directory is that shape; this keeps the
 * geometry/attribute/upload plumbing in one place.
 */
import * as THREE from 'three';
import { withShared, attachDriver } from './shared.js';

/** Premultiplied "over": one pass can both add light and occlude behind it. */
export const PREMULTIPLIED = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

/**
 * @param {object} spec
 *   cap            max instances
 *   attrs          { name: itemSize }
 *   vertexShader / fragmentShader
 *   uniforms       own uniforms (merged over the shared block)
 *   blend          extra material props (blending etc.)
 *   renderOrder
 */
export function makeQuadLayer(scene, shared, spec) {
  const cap = spec.cap;
  const plane = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.attributes.position);
  geo.setAttribute('uv', plane.attributes.uv);
  plane.dispose();

  const arrays = {};
  const attrList = [];
  for (const name of Object.keys(spec.attrs)) {
    const size = spec.attrs[name];
    const arr = new Float32Array(cap * size);
    const a = new THREE.InstancedBufferAttribute(arr, size);
    a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(name, a);
    arrays[name] = arr;
    attrList.push(a);
  }
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.ShaderMaterial({
    uniforms: withShared(shared, spec.uniforms || {}),
    vertexShader: spec.vertexShader,
    fragmentShader: spec.fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...(spec.blend || {}),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = spec.renderOrder ?? 10;
  attachDriver(mesh, shared);
  scene.add(mesh);

  return {
    cap, geo, mat, mesh, arrays, attrList,
    /** Upload the [lo, hi] instance range and set the instance count. */
    flush(count, lo, hi) {
      geo.instanceCount = count;
      mesh.visible = count > 0;
      if (hi < lo) return;
      const n = hi - lo + 1;
      for (const a of attrList) {
        a.clearUpdateRanges();
        a.addUpdateRange(lo * a.itemSize, n * a.itemSize);
        a.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      if (mesh.parent) mesh.parent.remove(mesh);
    },
  };
}

/**
 * Ring allocator with a high-water mark, shared by the layers whose
 * instances are written once at spawn and then evaluated in the shader.
 * Mirrors the particle pool rules: never hand out a slot that is still
 * alive, and let the tail compact back down when the effect is over.
 */
export class RingPool {
  constructor(cap) {
    this.cap = cap;
    this.death = new Float32Array(cap);
    this.count = 0;
    this.next = 0;
    this.lo = cap;
    this.hi = -1;
  }

  alloc(now, life) {
    let i = -1;
    for (let tries = 0; tries < this.cap; tries++) {
      const c = this.next;
      this.next = (this.next + 1) % this.cap;
      if (this.death[c] <= now) { i = c; break; }
    }
    if (i < 0) { i = this.next; this.next = (this.next + 1) % this.cap; }
    if (i >= this.count) this.count = i + 1;
    this.death[i] = now + life;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    return i;
  }

  /** @returns {number} live instance count */
  sweep(now) {
    let live = 0;
    for (let i = 0; i < this.count; i++) if (this.death[i] > now) live++;
    while (this.count > 0 && this.death[this.count - 1] <= now) this.count--;
    return live;
  }

  clearRange() {
    this.lo = this.cap;
    this.hi = -1;
  }
}
