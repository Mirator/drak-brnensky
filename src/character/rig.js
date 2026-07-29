import * as THREE from 'three';

/* ==================================================================
   Skeleton definition + the analytic two-bone IK used by the arms and
   the legs.

   Conventions, and they matter everywhere else in src/character/:
     - local -Z is forward (matches Player.facing / object.rotation.y)
     - local +X is the character's right
     - every *rotating* limb bone extends along its own local -Y, so a
       positive rotation.x swings the limb forward. Lateral offsets
       live in the parent (clavicle / hips) so the IK maths stays exact.
     - the rig is authored in metres with the feet at y = 0.
   ================================================================== */

export const HEIGHT = 1.78;

/** [name, parent, parent-relative offset] */
const SPEC = [
  ['hips', null, [0, 0.945, 0]],
  ['spine1', 'hips', [0, 0.110, -0.004]],
  ['spine2', 'spine1', [0, 0.120, -0.002]],
  ['chest', 'spine2', [0, 0.125, 0.004]],

  ['neck', 'chest', [0, 0.150, -0.010]],
  ['head', 'neck', [0, 0.092, 0.006]],

  ['clavL', 'chest', [-0.048, 0.108, 0]],
  ['armLU', 'clavL', [-0.137, 0.027, 0]],
  ['armLL', 'armLU', [0, -0.295, 0]],
  ['handL', 'armLL', [0, -0.255, 0]],

  ['clavR', 'chest', [0.048, 0.108, 0]],
  ['armRU', 'clavR', [0.137, 0.027, 0]],
  ['armRL', 'armRU', [0, -0.295, 0]],
  ['handR', 'armRL', [0, -0.255, 0]],

  ['legLU', 'hips', [-0.093, -0.020, 0]],
  ['legLL', 'legLU', [0, -0.445, 0]],
  ['footL', 'legLL', [0, -0.398, 0]],
  ['toeL', 'footL', [0, -0.040, -0.128]],

  ['legRU', 'hips', [0.093, -0.020, 0]],
  ['legRL', 'legRU', [0, -0.445, 0]],
  ['footR', 'legRL', [0, -0.398, 0]],
  ['toeR', 'footR', [0, -0.040, -0.128]],
];

/**
 * Builds the bone hierarchy plus a lookup of world-space rest positions
 * (used by mesh.js to author geometry directly in bind space).
 */
export function buildSkeleton() {
  const byName = {};
  const bones = [];
  for (const [name, parent, p] of SPEC) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(p[0], p[1], p[2]);
    byName[name] = b;
    if (parent) byName[parent].add(b);
    bones.push(b);
  }
  const root = byName.hips;
  root.updateMatrixWorld(true);

  const rest = {};
  for (const b of bones) rest[b.name] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);

  const index = {};
  bones.forEach((b, i) => { index[b.name] = i; });

  const len = (a, b) => rest[a].distanceTo(rest[b]);
  const dims = {
    upperArm: len('armLU', 'armLL'),
    lowerArm: len('armLL', 'handL'),
    thigh: len('legLU', 'legLL'),
    shin: len('legLL', 'footL'),
    hipY: rest.legLU.y,
    ankleY: rest.footL.y,
    hipX: Math.abs(rest.legLU.x),
    shoulderY: rest.armLU.y,
  };
  dims.legLength = dims.thigh + dims.shin;
  dims.armLength = dims.upperArm + dims.lowerArm;

  return { root, bones, byName, index, rest, dims };
}

/* ------------------------------------------------------------------ */
/* two-bone IK                                                         */
/* ------------------------------------------------------------------ */

const _P = new THREE.Vector3();
const _V = new THREE.Vector3();
const _D = new THREE.Vector3();
const _PL = new THREE.Vector3();
const _U = new THREE.Vector3();
const _S1 = new THREE.Vector3();
const _AX = new THREE.Vector3();
const _AY = new THREE.Vector3();
const _AZ = new THREE.Vector3();
const _t = new THREE.Vector3();
const _s = new THREE.Vector3();
const _qp = new THREE.Quaternion();
const _qw = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _mb = new THREE.Matrix4();
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _IDENT = new THREE.Matrix4();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Analytic 2-bone IK. `root` and `mid` must be a chain along local -Y
 * (mid.position = (0,-l1,0), end offset = (0,-l2,0)).
 *
 * Requires the ancestors' matrixWorld to be current; only writes local
 * quaternions, so a ragdoll can later overwrite the same fields.
 *
 * @param {THREE.Bone} root
 * @param {THREE.Bone} mid
 * @param {number} l1 upper length
 * @param {number} l2 lower length
 * @param {THREE.Vector3} target world position the chain end should reach
 * @param {THREE.Vector3} pole world direction the mid joint bulges towards
 * @param {{end?:THREE.Vector3, midQuat?:THREE.Quaternion, reach?:number}} [out]
 */
export function solveTwoBone(root, mid, l1, l2, target, pole, out) {
  _P.setFromMatrixPosition(root.matrixWorld);
  _m4.copy(root.parent ? root.parent.matrixWorld : _IDENT);
  _m4.decompose(_t, _qp, _s);

  _V.copy(target).sub(_P);
  let d = _V.length();
  const maxD = (l1 + l2) * 0.998;
  const minD = Math.abs(l1 - l2) + 0.035;
  if (!(d > 1e-5) || !Number.isFinite(d)) {
    _V.set(0, -1, 0);
    d = (l1 + l2) * 0.8;
  }
  const reach = d;
  d = clamp(d, minD, maxD);
  _D.copy(_V).normalize();

  // component of the pole hint perpendicular to the chain axis
  _PL.copy(pole).addScaledVector(_D, -pole.dot(_D));
  if (_PL.lengthSq() < 1e-9) {
    _PL.set(-_D.y, _D.x, 0);
    if (_PL.lengthSq() < 1e-9) _PL.set(1, 0, 0);
  }
  _PL.normalize();

  const A = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const bend = Math.PI - Math.acos(clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));

  // upper-bone direction and the in-plane perpendicular the mid bone bends into
  _U.copy(_D).multiplyScalar(Math.cos(A)).addScaledVector(_PL, Math.sin(A));
  _S1.copy(_D).multiplyScalar(-Math.sin(A)).addScaledVector(_PL, Math.cos(A));

  _AY.copy(_U).negate();
  _AZ.copy(_S1);
  _AX.crossVectors(_AY, _AZ).normalize();
  _AZ.crossVectors(_AX, _AY).normalize();
  _mb.makeBasis(_AX, _AY, _AZ);
  _qw.setFromRotationMatrix(_mb);

  root.quaternion.copy(_qp).invert().multiply(_qw);
  mid.quaternion.setFromAxisAngle(_XAXIS, bend);

  if (out) {
    if (out.midQuat) out.midQuat.copy(_qw).multiply(_qb.setFromAxisAngle(_XAXIS, bend));
    if (out.joint) out.joint.copy(_P).addScaledVector(_U, l1);
    out.reach = reach;
    out.clamped = reach > maxD;
  }
}

/** Damping that produces the same result at 30 Hz and 144 Hz. */
export function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Shortest signed angular difference, wrapped to (-PI, PI]. */
export function angleDelta(target, current) {
  return ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/**
 * Critically-tuned spring integrated at a fixed 120 Hz so the response is
 * identical at every render rate. Mutates and returns `s` = {x, v}.
 */
export function springStep(s, target, stiffness, damping, dt) {
  const H = 1 / 120;
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-6) {
    const h = Math.min(H, remaining);
    remaining -= h;
    s.v += (-stiffness * (s.x - target) - damping * s.v) * h;
    s.x += s.v * h;
  }
  return s;
}
