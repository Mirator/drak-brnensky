import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * mergeGeometries() refuses to mix indexed and non-indexed inputs, and our
 * hand-built roof prisms are non-indexed while every primitive is indexed.
 * Normalising first (and keeping only the attributes we actually shade with)
 * makes every merge in the project safe.
 */
export function mergeAll(geos, dispose = true) {
  if (!geos || !geos.length) return null;
  const prepared = geos.map((g) => {
    let out = g.index ? g.toNonIndexed() : g;
    // keep the attribute set uniform: position / normal / uv
    if (!out.attributes.normal) out.computeVertexNormals();
    if (!out.attributes.uv) {
      const n = out.attributes.position.count;
      out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    for (const name of Object.keys(out.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
    }
    if (out !== g && dispose) g.dispose();
    return out;
  });
  const merged = mergeGeometries(prepared, false);
  if (dispose) prepared.forEach((g) => g.dispose());
  return merged;
}

/**
 * Gable ("pitched") roof prism: a ridge over a w x d footprint, `h` tall.
 * Windings are chosen automatically so every normal faces outwards, and UVs
 * are in metres/3 so a roof-tile texture tiles at a believable scale.
 *
 * The origin is the centre of the eaves plane.
 */
export function gableRoof(w, d, h) {
  const hw = w / 2, hd = d / 2;
  const alongX = w >= d;
  const pos = [];
  const uv = [];
  const centre = [0, h * 0.35, 0];

  const tri = (a, b, c, ua, ub, uc) => {
    // outward winding: flip if the face normal points back at the centre
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const mid = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    const outward = n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0;
    if (outward) {
      pos.push(...a, ...b, ...c);
      uv.push(...ua, ...ub, ...uc);
    } else {
      pos.push(...a, ...c, ...b);
      uv.push(...ua, ...uc, ...ub);
    }
  };
  const quad = (a, b, c, dd, su, sv) => {
    // a-b along u, b-c along v
    tri(a, b, c, [0, 0], [su, 0], [su, sv]);
    tri(a, c, dd, [0, 0], [su, sv], [0, sv]);
  };

  const A = [-hw, 0, -hd], B = [hw, 0, -hd], C = [hw, 0, hd], D = [-hw, 0, hd];
  const S = 3; // metres per texture tile

  if (alongX) {
    const R1 = [-hw, h, 0], R2 = [hw, h, 0];
    const slope = Math.hypot(hd, h) / S;
    quad(A, B, R2, R1, w / S, slope); // north pitch
    quad(C, D, R1, R2, w / S, slope); // south pitch
    tri(B, C, R2, [0, 0], [d / S, 0], [d / S / 2, h / S]); // east gable
    tri(D, A, R1, [0, 0], [d / S, 0], [d / S / 2, h / S]); // west gable
  } else {
    const R1 = [0, h, -hd], R2 = [0, h, hd];
    const slope = Math.hypot(hw, h) / S;
    quad(B, C, R2, R1, d / S, slope); // east pitch
    quad(D, A, R1, R2, d / S, slope); // west pitch
    tri(A, B, R1, [0, 0], [w / S, 0], [w / S / 2, h / S]); // north gable
    tri(C, D, R2, [0, 0], [w / S, 0], [w / S / 2, h / S]); // south gable
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
