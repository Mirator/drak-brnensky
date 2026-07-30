import * as THREE from 'three';
import { Rng } from './rng.js';
import { DEFAULT_SURFACE, resolveSurface } from './physics.js';

/* ==================================================================
   DRAK BRNĚNSKÝ — dynamic physics layer.

   Not a general purpose rigid body engine: a purpose-built one for physics
   dressing. Debris that tumbles and settles, props that shatter, corpses that
   ragdoll, explosions that shove things, projectiles that arc.

   Design notes worth knowing before you touch this file:

   - Dynamic bodies collide against the *existing* static AABB grid in
     `CollisionWorld`. There is no second spatial structure.
   - Fixed timestep accumulator (default 60 Hz, 2 substeps → 120 Hz integration)
     so 30 Hz and 144 Hz produce the same simulation.
   - Sequential impulses with a Baumgarte positional bias. Penetration is bled
     off over a few steps, never teleported away, so nothing jitters.
   - Sleeping is what makes the budget work: a settled chunk costs one velocity
     comparison per step and nothing else.
   - Everything is pooled. The per-frame path allocates nothing; only spawn
     events (a break, a ragdoll) build small arrays.
   - All randomness comes from the project's `Rng`. Never `Math.random()`.
   ================================================================== */

export const DEFAULTS = {
  gravity: -24,             // matches player.js GRAVITY, so debris feels the same
  fixedDt: 1 / 60,
  substeps: 2,
  maxStepsPerFrame: 4,      // a stall drops time rather than spiralling
  maxBodies: 128,
  maxRagdolls: 3,
  maxProjectiles: 48,
  contactIterations: 4,
  jointIterations: 6,
  bodyVsBody: true,
  bodyVsBodyLimit: 96,      // above this many active bodies, world-only collision
  baumgarte: 0.22,          // penetration bias factor
  slop: 0.008,              // allowed penetration (m); stops resting jitter
  maxCorrection: 2.5,       // m/s cap on the bias term
  restitutionCutoff: 0.8,   // below this approach speed, no bounce at all
  maxLinearSpeed: 90,
  maxAngularSpeed: 24,
  sleepLinear: 0.16,
  sleepAngular: 0.55,
  sleepTime: 0.45,
  killBelowY: -6,           // fell out of the world
  debrisLifetime: 16,       // seconds settled before fading
  debrisFade: 1.4,
  // Drains the last of a corpse's energy once it is already slow (< ~1 m/s), so
  // it visibly comes to rest instead of creeping. A jointed chain solved with
  // Gauss-Seidel leaks a little energy back in every step; this out-runs it.
  ragdollSettleDamping: 12,
  ragdollSettleTimeout: 4,
  ragdollMaxLifetime: 22,
  ragdollFade: 1.6,
  ragdollBlendTime: 0.18,
  seed: 0x5eed1a,
};

const EPS = 1e-9;
/** Allowed overshoot on cone/twist limits, radians (~1.7°). */
const ANGULAR_SLOP = 0.03;
/** Allowed slack in a ragdoll joint, metres. */
const JOINT_SLOP = 0.004;
/** How far along an occlusion ray to start, metres. See `_visible`. */
const OCCLUSION_SKIN = 0.15;

/* ------------------------------------------------------------------ *
 * Small maths helpers. Everything writes into preallocated scratch.
 * ------------------------------------------------------------------ */
const _s1 = { x: 0, y: 0, z: 0 };
const _s2 = { x: 0, y: 0, z: 0 };
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

/** Row-major 3x3 rotation matrix from a quaternion, into a Float64Array(9). */
function quatToMat3(q, m) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  m[0] = 1 - (yy + zz); m[1] = xy - wz;       m[2] = xz + wy;
  m[3] = xy + wz;       m[4] = 1 - (xx + zz); m[5] = yz - wx;
  m[6] = xz - wy;       m[7] = yz + wx;       m[8] = 1 - (xx + yy);
}

/** out = M v */
function mat3Apply(m, vx, vy, vz, out) {
  out.x = m[0] * vx + m[1] * vy + m[2] * vz;
  out.y = m[3] * vx + m[4] * vy + m[5] * vz;
  out.z = m[6] * vx + m[7] * vy + m[8] * vz;
  return out;
}

/** out = Mᵀ v */
function mat3ApplyT(m, vx, vy, vz, out) {
  out.x = m[0] * vx + m[3] * vy + m[6] * vz;
  out.y = m[1] * vx + m[4] * vy + m[7] * vz;
  out.z = m[2] * vx + m[5] * vy + m[8] * vz;
  return out;
}

/** out = I⁻¹_world v, with the body's diagonal local inverse inertia. */
function applyInvInertia(body, vx, vy, vz, out) {
  const m = body._rot;
  const lx = m[0] * vx + m[3] * vy + m[6] * vz;
  const ly = m[1] * vx + m[4] * vy + m[7] * vz;
  const lz = m[2] * vx + m[5] * vy + m[8] * vz;
  const px = lx * body.invInertia.x;
  const py = ly * body.invInertia.y;
  const pz = lz * body.invInertia.z;
  out.x = m[0] * px + m[1] * py + m[2] * pz;
  out.y = m[3] * px + m[4] * py + m[5] * pz;
  out.z = m[6] * px + m[7] * py + m[8] * pz;
  return out;
}

/** invMass + n · ((I⁻¹(r×n)) × r) — the scalar effective mass term. */
function effMassTerm(body, rx, ry, rz, nx, ny, nz) {
  const cx = ry * nz - rz * ny;
  const cy = rz * nx - rx * nz;
  const cz = rx * ny - ry * nx;
  applyInvInertia(body, cx, cy, cz, _s1);
  const dx = _s1.y * rz - _s1.z * ry;
  const dy = _s1.z * rx - _s1.x * rz;
  const dz = _s1.x * ry - _s1.y * rx;
  return body.invMass + dx * nx + dy * ny + dz * nz;
}

function clampMag(v, max) {
  const l2 = v.x * v.x + v.y * v.y + v.z * v.z;
  if (l2 > max * max) {
    const s = max / Math.sqrt(l2);
    v.x *= s; v.y *= s; v.z *= s;
  }
}

function finite3(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/* ------------------------------------------------------------------ *
 * Body
 * ------------------------------------------------------------------ */
export class Body {
  constructor(id) {
    this.id = id;
    this.index = -1;            // slot inside PhysicsWorld#bodies
    this.serial = 0;            // spawn order — the eviction key
    this.active = false;
    this.sleeping = false;

    this.shape = 'box';         // 'box' | 'sphere' | 'capsule'
    this.half = new THREE.Vector3(0.2, 0.2, 0.2);
    this.radius = 0.2;
    this.length = 0.4;          // capsule segment length (caps excluded)
    this.boundRadius = 0.35;

    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();

    this.mass = 1;
    this.invMass = 1;
    this.invInertia = new THREE.Vector3(1, 1, 1);
    this.restitution = 0.2;
    this.friction = 0.7;
    this.linearDamping = 0.05;
    this.angularDamping = 0.14;

    this.surface = DEFAULT_SURFACE;
    this.kind = 'debris';       // 'debris' | 'chunk' | 'ragdoll' | custom
    this.group = 0;             // bodies sharing a non-zero group never collide
    this.userData = null;
    this.evictable = true;
    this.collideBodies = true;

    this.age = 0;
    this.settledTime = 0;
    this.sleepTimer = 0;
    this.lifetime = Infinity;   // seconds settled before the fade starts
    this.fadeTime = 1.4;
    this.fade = 1;              // 1 visible → 0 gone (render side reads this)
    this.contacts = 0;          // contacts generated last step
    this.lastImpactSpeed = 0;

    this._rot = new Float64Array(9);
    this._aabb = new Float64Array(6);
    this._ragdoll = null;
    this._bone = -1;
    // Split-impulse pseudo velocities. Penetration and joint error are corrected
    // through these, not through the real velocities, so pushing a body out of a
    // wall never adds kinetic energy. They are integrated into the position and
    // then thrown away every substep.
    this._pv = new THREE.Vector3();
    this._pw = new THREE.Vector3();
    // Reference pose for the sleep test. Sleep is decided on how far a body has
    // actually travelled, not on its instantaneous velocity: a resting body
    // carries a little penetration-correction velocity every step that produces
    // no net motion, and testing velocity would keep it awake forever.
    this._refPos = new THREE.Vector3();
    this._refQuat = new THREE.Quaternion();
  }

  /** World-space impulse (N·s). `point` is optional; omit for a pure push. */
  applyImpulse(impulse, point = null) {
    if (point) {
      this._impulse(
        impulse.x, impulse.y, impulse.z,
        point.x - this.position.x, point.y - this.position.y, point.z - this.position.z,
      );
    } else {
      this._impulse(impulse.x, impulse.y, impulse.z, 0, 0, 0);
    }
    return this;
  }

  _impulse(ix, iy, iz, rx, ry, rz) {
    this.velocity.x += ix * this.invMass;
    this.velocity.y += iy * this.invMass;
    this.velocity.z += iz * this.invMass;
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      const tx = ry * iz - rz * iy;
      const ty = rz * ix - rx * iz;
      const tz = rx * iy - ry * ix;
      applyInvInertia(this, tx, ty, tz, _s2);
      this.angularVelocity.x += _s2.x;
      this.angularVelocity.y += _s2.y;
      this.angularVelocity.z += _s2.z;
    }
    this.sleeping = false;
    this.sleepTimer = 0;
    if (this._ragdoll) {
      // A shove to one bone wakes the whole corpse, or the joint solver would be
      // pushing bodies that are not integrating.
      const bones = this._ragdoll.bones;
      for (let i = 0; i < bones.length; i++) {
        bones[i].body.sleeping = false;
        bones[i].body.sleepTimer = 0;
      }
      this._ragdoll.sleepTimer = 0;
    }
  }

  /** Copy the transform onto anything with .position/.quaternion (a Mesh). */
  writeTo(object3D) {
    object3D.position.copy(this.position);
    object3D.quaternion.copy(this.quaternion);
    return object3D;
  }
}

function setInertia(body) {
  if (body.invMass === 0) {
    body.invInertia.set(0, 0, 0);
    return;
  }
  const m = body.mass;
  if (body.shape === 'sphere') {
    const i = 0.4 * m * body.radius * body.radius;
    body.invInertia.set(1 / i, 1 / i, 1 / i);
    return;
  }
  let hx, hy, hz;
  if (body.shape === 'capsule') {
    hx = body.radius;
    hy = body.radius + body.length * 0.5;
    hz = body.radius;
  } else {
    hx = body.half.x; hy = body.half.y; hz = body.half.z;
  }
  const k = m / 3; // (1/12) m (a² + b²) with a = 2h
  const ix = k * (hy * hy + hz * hz);
  const iy = k * (hx * hx + hz * hz);
  const iz = k * (hx * hx + hy * hy);
  body.invInertia.set(
    ix > EPS ? 1 / ix : 0,
    iy > EPS ? 1 / iy : 0,
    iz > EPS ? 1 / iz : 0,
  );
}

/* ------------------------------------------------------------------ *
 * Contact record
 * ------------------------------------------------------------------ */
class Contact {
  constructor() {
    this.a = null;
    this.b = null;          // null → static world
    this.nx = 0; this.ny = 1; this.nz = 0;
    this.px = 0; this.py = 0; this.pz = 0;
    this.rax = 0; this.ray = 0; this.raz = 0;
    this.rbx = 0; this.rby = 0; this.rbz = 0;
    this.depth = 0;
    this.friction = 0.7;
    this.restitution = 0.1;
    this.bias = 0;      // Baumgarte term, solved into the pseudo velocities
    this.bounce = 0;    // restitution term, solved into the real velocities
    this.massN = 0;
    this.jn = 0;
    this.jp = 0;
    this.jt = 0;
    this.tx = 0; this.ty = 0; this.tz = 0;
    this.massT = 0;
    this.surface = null;
    this.box = null;
  }
}

/* ==================================================================
   Ragdoll templates.

   A fallback rig for anything that does not hand us real bones. Offsets and
   directions are in the creature's local space (+Y up, -Z forward, matching the
   models in enemies.js), metres, before `scale`.
   ================================================================== */
export const RAGDOLL_TEMPLATES = {
  humanoid: {
    boneAxis: 'y',
    bones: [
      { name: 'pelvis', parent: null, offset: [0, 0.98, 0], dir: [0, 1, 0], length: 0.18, radius: 0.15, mass: 11 },
      { name: 'spine', parent: 'pelvis', offset: [0, 0.18, 0], dir: [0, 1, 0], length: 0.24, radius: 0.15, mass: 9, cone: 0.45, twist: 0.5 },
      { name: 'chest', parent: 'spine', offset: [0, 0.24, 0], dir: [0, 1, 0], length: 0.22, radius: 0.16, mass: 12, cone: 0.4, twist: 0.4 },
      { name: 'head', parent: 'chest', offset: [0, 0.22, 0], dir: [0, 1, 0], length: 0.22, radius: 0.12, mass: 4.5, cone: 0.75, twist: 0.7 },
      { name: 'upperArmL', parent: 'chest', offset: [-0.19, 0.18, 0], dir: [-0.35, -0.94, 0], length: 0.27, radius: 0.07, mass: 2.2, cone: 1.5, twist: 1.0 },
      { name: 'lowerArmL', parent: 'upperArmL', offset: [-0.09, -0.25, 0], dir: [-0.2, -0.98, 0], length: 0.26, radius: 0.06, mass: 1.5, cone: 1.3, twist: 0.5 },
      { name: 'upperArmR', parent: 'chest', offset: [0.19, 0.18, 0], dir: [0.35, -0.94, 0], length: 0.27, radius: 0.07, mass: 2.2, cone: 1.5, twist: 1.0 },
      { name: 'lowerArmR', parent: 'upperArmR', offset: [0.09, -0.25, 0], dir: [0.2, -0.98, 0], length: 0.26, radius: 0.06, mass: 1.5, cone: 1.3, twist: 0.5 },
      { name: 'thighL', parent: 'pelvis', offset: [-0.11, 0, 0], dir: [-0.05, -1, 0], length: 0.42, radius: 0.09, mass: 6.5, cone: 1.1, twist: 0.5 },
      { name: 'shinL', parent: 'thighL', offset: [-0.02, -0.42, 0], dir: [0, -1, 0], length: 0.42, radius: 0.075, mass: 4, cone: 1.2, twist: 0.25 },
      { name: 'thighR', parent: 'pelvis', offset: [0.11, 0, 0], dir: [0.05, -1, 0], length: 0.42, radius: 0.09, mass: 6.5, cone: 1.1, twist: 0.5 },
      { name: 'shinR', parent: 'thighR', offset: [0.02, -0.42, 0], dir: [0, -1, 0], length: 0.42, radius: 0.075, mass: 4, cone: 1.2, twist: 0.25 },
    ],
  },
  /** Ještěrka — fast quadruped whelp. */
  whelp: {
    boneAxis: 'y',
    bones: [
      { name: 'torso', parent: null, offset: [0, 0.62, 0], dir: [0, 0, -1], length: 0.6, radius: 0.3, mass: 12 },
      { name: 'neck', parent: 'torso', offset: [0, 0.1, -0.55], dir: [0, 0, -1], length: 0.3, radius: 0.17, mass: 3, cone: 0.7, twist: 0.5 },
      { name: 'head', parent: 'neck', offset: [0, 0, -0.3], dir: [0, 0, -1], length: 0.3, radius: 0.19, mass: 3.5, cone: 0.6, twist: 0.5 },
      { name: 'tail1', parent: 'torso', offset: [0, 0.05, 0.05], dir: [0, 0, 1], length: 0.34, radius: 0.11, mass: 1.6, cone: 0.8, twist: 0.6 },
      { name: 'tail2', parent: 'tail1', offset: [0, 0, 0.34], dir: [0, 0, 1], length: 0.34, radius: 0.08, mass: 1.1, cone: 0.9, twist: 0.6 },
      { name: 'legFL', parent: 'torso', offset: [-0.26, -0.06, -0.34], dir: [0, -1, 0], length: 0.5, radius: 0.07, mass: 1.8, cone: 1.1, twist: 0.4 },
      { name: 'legFR', parent: 'torso', offset: [0.26, -0.06, -0.34], dir: [0, -1, 0], length: 0.5, radius: 0.07, mass: 1.8, cone: 1.1, twist: 0.4 },
      { name: 'legBL', parent: 'torso', offset: [-0.26, -0.06, 0.3], dir: [0, -1, 0], length: 0.5, radius: 0.075, mass: 2.1, cone: 1.1, twist: 0.4 },
      { name: 'legBR', parent: 'torso', offset: [0.26, -0.06, 0.3], dir: [0, -1, 0], length: 0.5, radius: 0.075, mass: 2.1, cone: 1.1, twist: 0.4 },
    ],
  },
  /** Chrlič — winged spitter, upright. */
  spitter: {
    boneAxis: 'y',
    bones: [
      { name: 'pelvis', parent: null, offset: [0, 0.85, 0], dir: [0, 1, 0], length: 0.22, radius: 0.2, mass: 10 },
      { name: 'chest', parent: 'pelvis', offset: [0, 0.22, 0], dir: [0, 1, 0], length: 0.36, radius: 0.24, mass: 13, cone: 0.4, twist: 0.4 },
      { name: 'head', parent: 'chest', offset: [0, 0.36, 0], dir: [0, 0.5, -0.86], length: 0.3, radius: 0.16, mass: 4, cone: 0.7, twist: 0.6 },
      { name: 'wingL', parent: 'chest', offset: [-0.24, 0.24, 0.06], dir: [-0.92, 0.2, 0.34], length: 0.72, radius: 0.09, mass: 3.2, cone: 1.4, twist: 0.8 },
      { name: 'wingR', parent: 'chest', offset: [0.24, 0.24, 0.06], dir: [0.92, 0.2, 0.34], length: 0.72, radius: 0.09, mass: 3.2, cone: 1.4, twist: 0.8 },
      { name: 'tail', parent: 'pelvis', offset: [0, 0.02, 0.16], dir: [0, -0.3, 1], length: 0.52, radius: 0.1, mass: 2.4, cone: 0.9, twist: 0.6 },
      { name: 'legL', parent: 'pelvis', offset: [-0.14, 0, 0], dir: [-0.08, -1, 0], length: 0.46, radius: 0.09, mass: 4, cone: 1.1, twist: 0.4 },
      { name: 'legR', parent: 'pelvis', offset: [0.14, 0, 0], dir: [0.08, -1, 0], length: 0.46, radius: 0.09, mass: 4, cone: 1.1, twist: 0.4 },
    ],
  },
  /** Kamenný golem — heavy, short limbs, stiff joints. */
  golem: {
    boneAxis: 'y',
    bones: [
      { name: 'pelvis', parent: null, offset: [0, 1.35, 0], dir: [0, 1, 0], length: 0.4, radius: 0.42, mass: 90 },
      { name: 'chest', parent: 'pelvis', offset: [0, 0.4, 0], dir: [0, 1, 0], length: 0.62, radius: 0.5, mass: 140, cone: 0.25, twist: 0.25 },
      { name: 'head', parent: 'chest', offset: [0, 0.62, 0], dir: [0, 1, 0], length: 0.34, radius: 0.26, mass: 26, cone: 0.4, twist: 0.35 },
      { name: 'armL', parent: 'chest', offset: [-0.5, 0.4, 0], dir: [-0.3, -0.95, 0], length: 0.72, radius: 0.19, mass: 40, cone: 1.1, twist: 0.5 },
      { name: 'armR', parent: 'chest', offset: [0.5, 0.4, 0], dir: [0.3, -0.95, 0], length: 0.72, radius: 0.19, mass: 40, cone: 1.1, twist: 0.5 },
      { name: 'legL', parent: 'pelvis', offset: [-0.26, 0, 0], dir: [-0.05, -1, 0], length: 0.9, radius: 0.22, mass: 55, cone: 0.7, twist: 0.3 },
      { name: 'legR', parent: 'pelvis', offset: [0.26, 0, 0], dir: [0.05, -1, 0], length: 0.9, radius: 0.22, mass: 55, cone: 0.7, twist: 0.3 },
    ],
  },
  /** Drak brněnský — the boss. Big quadruped, wings and a long tail. */
  boss: {
    boneAxis: 'y',
    bones: [
      { name: 'torso', parent: null, offset: [0, 3.2, 0], dir: [0, 0, -1], length: 2.6, radius: 1.3, mass: 900 },
      { name: 'neck1', parent: 'torso', offset: [0, 0.5, -2.5], dir: [0, 0.35, -0.94], length: 1.2, radius: 0.6, mass: 130, cone: 0.6, twist: 0.5 },
      { name: 'neck2', parent: 'neck1', offset: [0, 0.42, -1.13], dir: [0, 0.2, -0.98], length: 1.1, radius: 0.5, mass: 100, cone: 0.6, twist: 0.5 },
      { name: 'head', parent: 'neck2', offset: [0, 0.22, -1.08], dir: [0, 0, -1], length: 1.3, radius: 0.6, mass: 150, cone: 0.5, twist: 0.4 },
      { name: 'tail1', parent: 'torso', offset: [0, 0.2, 0.2], dir: [0, -0.1, 1], length: 1.5, radius: 0.5, mass: 120, cone: 0.7, twist: 0.5 },
      { name: 'tail2', parent: 'tail1', offset: [0, -0.15, 1.49], dir: [0, -0.2, 0.98], length: 1.5, radius: 0.36, mass: 80, cone: 0.8, twist: 0.5 },
      { name: 'tail3', parent: 'tail2', offset: [0, -0.3, 1.47], dir: [0, -0.3, 0.95], length: 1.4, radius: 0.24, mass: 45, cone: 0.9, twist: 0.5 },
      { name: 'wingL', parent: 'torso', offset: [-1.0, 1.0, -0.6], dir: [-0.86, 0.35, 0.36], length: 3.0, radius: 0.3, mass: 90, cone: 1.3, twist: 0.8 },
      { name: 'wingR', parent: 'torso', offset: [1.0, 1.0, -0.6], dir: [0.86, 0.35, 0.36], length: 3.0, radius: 0.3, mass: 90, cone: 1.3, twist: 0.8 },
      { name: 'legFL', parent: 'torso', offset: [-1.0, -0.4, -1.5], dir: [-0.1, -1, 0], length: 1.9, radius: 0.32, mass: 110, cone: 0.9, twist: 0.4 },
      { name: 'legFR', parent: 'torso', offset: [1.0, -0.4, -1.5], dir: [0.1, -1, 0], length: 1.9, radius: 0.32, mass: 110, cone: 0.9, twist: 0.4 },
      { name: 'legBL', parent: 'torso', offset: [-1.1, -0.4, 1.3], dir: [-0.1, -1, 0], length: 2.1, radius: 0.36, mass: 130, cone: 0.9, twist: 0.4 },
      { name: 'legBR', parent: 'torso', offset: [1.1, -0.4, 1.3], dir: [0.1, -1, 0], length: 2.1, radius: 0.36, mass: 130, cone: 0.9, twist: 0.4 },
    ],
  },
};

/**
 * Which way a bone points in its own local space. Negative axes are supported
 * because that is what real rigs do — the player rig in src/character/rig.js
 * runs every limb down local -Y.
 */
const AXIS_VECTORS = {
  x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1],
  '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1],
};
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Turn a template into the `boneList` that `spawnRagdoll()` eats. Use this when
 * you do not have a real skeleton to hand (creatures); hand real bone
 * transforms straight to `spawnRagdoll()` when you do (the player rig).
 *
 * `position` is the creature's feet/root position, `quaternion` its facing.
 */
export function buildRagdollBones(template, position, quaternion = null, scale = 1) {
  const tpl = typeof template === 'string' ? RAGDOLL_TEMPLATES[template] : template;
  if (!tpl) throw new Error(`unknown ragdoll template: ${template}`);
  const axis = AXIS_VECTORS[tpl.boneAxis || 'y'];
  const rootQ = quaternion ? _q1.copy(quaternion) : _q1.identity();
  const localOrigins = new Map();
  const out = [];
  const up = _v3.set(axis[0], axis[1], axis[2]);

  for (const spec of tpl.bones) {
    const parentOrigin = spec.parent ? localOrigins.get(spec.parent) : null;
    const ox = (parentOrigin ? parentOrigin.x : 0) + spec.offset[0] * scale;
    const oy = (parentOrigin ? parentOrigin.y : 0) + spec.offset[1] * scale;
    const oz = (parentOrigin ? parentOrigin.z : 0) + spec.offset[2] * scale;
    localOrigins.set(spec.name, { x: ox, y: oy, z: oz });

    const dir = spec.dir || [0, 1, 0];
    _v1.set(dir[0], dir[1], dir[2]).normalize();
    _q2.setFromUnitVectors(up, _v1);
    _q3.copy(rootQ).multiply(_q2);

    _v2.set(ox, oy, oz).applyQuaternion(rootQ).add(position);
    out.push({
      name: spec.name,
      parent: spec.parent || null,
      position: { x: _v2.x, y: _v2.y, z: _v2.z },
      quaternion: { x: _q3.x, y: _q3.y, z: _q3.z, w: _q3.w },
      length: spec.length * scale,
      radius: spec.radius * scale,
      mass: (spec.mass ?? 4) * scale * scale * scale,
      cone: spec.cone,
      twist: spec.twist,
      boneAxis: tpl.boneAxis || 'y',
    });
  }
  return out;
}

/**
 * Bone list built from a LIVE skeleton (an array of THREE.Bone / Object3D), so
 * the ragdoll starts in exactly the pose that was on screen and nothing snaps.
 * This is the handoff for the player rig and for any creature with real bones.
 *
 * `entries` is an array of:
 *   {
 *     name,          // ragdoll bone name (usually the THREE.Bone's name)
 *     parent,        // parent ragdoll bone name, or null for the root
 *     object,        // Object3D whose world transform is the joint origin
 *     tip,           // optional Object3D at the far end; gives the bone length
 *     length,        // used when `tip` is absent
 *     radius, mass,  // collision capsule radius and mass in kg
 *     cone, twist,   // joint limits in radians (defaults 0.9 / 0.6)
 *   }
 *
 * `opts.boneAxis` says which local axis the bones run down ('-y' for the player
 * rig). `opts.scale` multiplies radius and length.
 */
export function ragdollBonesFromObjects(entries, opts = {}) {
  const axisKey = opts.boneAxis || 'y';
  const av = AXIS_VECTORS[axisKey] || AXIS_VECTORS.y;
  const scale = opts.scale ?? 1;
  const out = [];
  for (const e of entries) {
    const obj = e.object;
    if (!obj) throw new Error(`ragdollBonesFromObjects: entry ${e.name} has no object`);
    obj.updateWorldMatrix(true, false);
    _v1.setFromMatrixPosition(obj.matrixWorld);
    obj.matrixWorld.decompose(_v2, _q1, _v3);
    let length = (e.length ?? 0.22) * scale;
    if (e.tip) {
      e.tip.updateWorldMatrix(true, false);
      _v2.setFromMatrixPosition(e.tip.matrixWorld);
      const d = _v1.distanceTo(_v2);
      if (d > 1e-4) length = d;
    }
    out.push({
      name: e.name || obj.name,
      parent: e.parent || null,
      position: { x: _v1.x, y: _v1.y, z: _v1.z },
      quaternion: { x: _q1.x, y: _q1.y, z: _q1.z, w: _q1.w },
      length,
      radius: (e.radius ?? Math.max(0.04, length * 0.28)) * scale,
      mass: (e.mass ?? 4) * scale * scale * scale,
      cone: e.cone,
      twist: e.twist,
      surface: e.surface,
      boneAxis: axisKey,
    });
  }
  return out;
}

/**
 * A ready-made mapping for the player rig in src/character/rig.js. Pass it
 * `rig.byName` and it produces the bone list; every name here is a bone in that
 * rig's SPEC, and the axis is '-y' to match its convention.
 *
 *   spawnRagdoll(playerRagdollBones(rig.byName), { impulse, hitBone: 'chest' })
 */
export const PLAYER_RAGDOLL_SPEC = [
  { name: 'hips', parent: null, bone: 'hips', tip: 'spine1', radius: 0.15, mass: 11 },
  { name: 'spine1', parent: 'hips', bone: 'spine1', tip: 'spine2', radius: 0.14, mass: 7, cone: 0.4, twist: 0.45 },
  { name: 'spine2', parent: 'spine1', bone: 'spine2', tip: 'chest', radius: 0.15, mass: 7, cone: 0.35, twist: 0.4 },
  { name: 'chest', parent: 'spine2', bone: 'chest', tip: 'neck', radius: 0.16, mass: 12, cone: 0.3, twist: 0.35 },
  { name: 'neck', parent: 'chest', bone: 'neck', tip: 'head', radius: 0.07, mass: 1.6, cone: 0.5, twist: 0.5 },
  { name: 'head', parent: 'neck', bone: 'head', length: 0.22, radius: 0.12, mass: 4.5, cone: 0.6, twist: 0.6 },
  { name: 'armLU', parent: 'chest', bone: 'armLU', tip: 'armLL', radius: 0.07, mass: 2.2, cone: 1.5, twist: 1.0 },
  { name: 'armLL', parent: 'armLU', bone: 'armLL', tip: 'handL', radius: 0.06, mass: 1.5, cone: 1.3, twist: 0.5 },
  { name: 'armRU', parent: 'chest', bone: 'armRU', tip: 'armRL', radius: 0.07, mass: 2.2, cone: 1.5, twist: 1.0 },
  { name: 'armRL', parent: 'armRU', bone: 'armRL', tip: 'handR', radius: 0.06, mass: 1.5, cone: 1.3, twist: 0.5 },
  { name: 'legLU', parent: 'hips', bone: 'legLU', tip: 'legLL', radius: 0.09, mass: 6.5, cone: 1.1, twist: 0.4 },
  { name: 'legLL', parent: 'legLU', bone: 'legLL', tip: 'footL', radius: 0.075, mass: 4, cone: 1.2, twist: 0.25 },
  { name: 'legRU', parent: 'hips', bone: 'legRU', tip: 'legRL', radius: 0.09, mass: 6.5, cone: 1.1, twist: 0.4 },
  { name: 'legRL', parent: 'legRU', bone: 'legRL', tip: 'footR', radius: 0.075, mass: 4, cone: 1.2, twist: 0.25 },
];

/**
 * Turn a `{boneName: THREE.Bone}` lookup into a ragdoll bone list, using
 * PLAYER_RAGDOLL_SPEC (or any spec of the same shape). Bones the rig does not
 * have are skipped, and so is anything whose parent got skipped.
 */
export function playerRagdollBones(byName, spec = PLAYER_RAGDOLL_SPEC, opts = {}) {
  const entries = [];
  const present = new Set();
  for (const s of spec) {
    const object = byName[s.bone] || byName[s.name];
    if (!object) continue;
    if (s.parent && !present.has(s.parent)) continue;
    present.add(s.name);
    entries.push({
      name: s.name,
      parent: s.parent,
      object,
      tip: s.tip ? byName[s.tip] : null,
      length: s.length,
      radius: s.radius,
      mass: s.mass,
      cone: s.cone,
      twist: s.twist,
    });
  }
  return ragdollBonesFromObjects(entries, { boneAxis: '-y', ...opts });
}

/* ------------------------------------------------------------------ *
 * Ragdoll handle
 * ------------------------------------------------------------------ */
class Ragdoll {
  constructor(system, id) {
    this.system = system;
    this.id = id;
    this.alive = false;
    /**
     * Bones in the order they were handed in, parents first. Each entry carries
     * `.name`, `.body` and `.out` — the output transform, so a per-frame loop
     * over this array needs no lookups.
     * @type {{name:string, body:Body, out:object, parent:number}[]}
     */
    this.bones = [];
    /** Bone name → output transform. Mutated in place, never reallocated. */
    this.output = new Map();
    this.joints = [];
    this.blend = 0;
    this.blendTime = 0.18;
    this.fade = 1;
    this.settled = false;
    this.settleTimer = 0;
    this.age = 0;
    this.userData = null;
  }

  /** Output world transform of one bone (joint origin + orientation). */
  transform(name) {
    return this.output.get(name) || null;
  }

  /** Feed the still-animated pose during the blend-in window, if you have it. */
  setAnimatedPose(name, position, quaternion) {
    const o = this.output.get(name);
    if (!o) return false;
    o.animPosition.copy(position);
    o.animQuaternion.copy(quaternion);
    return true;
  }

  applyImpulse(boneName, impulse, point = null) {
    const o = this.output.get(boneName);
    if (!o) return false;
    o.body.applyImpulse(impulse, point);
    return true;
  }

  /** Push every bone (an explosion, or a generic shove). */
  applyImpulseAll(impulse) {
    for (let i = 0; i < this.bones.length; i++) this.bones[i].body.applyImpulse(impulse);
  }

  remove() {
    this.system.removeRagdoll(this);
  }
}

/* ==================================================================
   PhysicsWorld
   ================================================================== */
export class PhysicsWorld {
  /**
   * @param {import('./physics.js').CollisionWorld} collision static world
   * @param {object} options see DEFAULTS
   */
  constructor(collision, options = {}) {
    if (!collision) throw new Error('PhysicsWorld needs a CollisionWorld');
    this.collision = collision;
    this.opt = Object.assign({}, DEFAULTS, options);
    // A private stream by default: consuming numbers from the gameplay Rng would
    // shift every other seeded system.
    this.rng = options.rng instanceof Rng ? options.rng : new Rng(this.opt.seed);

    /** Live bodies, dense. Read `position`/`quaternion` from these to render. */
    this.bodies = [];
    /** Live ragdoll handles. */
    this.ragdolls = [];
    /** Registered breakable props. */
    this.breakables = [];
    /** Live ballistic projectiles. */
    this.projectiles = [];

    this._pool = [];
    this._serial = 0;
    for (let i = 0; i < this.opt.maxBodies; i++) this._pool.push(new Body(i));

    this._contacts = [];
    this._contactCount = 0;
    this._maxContacts = this.opt.maxBodies * 8 + 128;
    for (let i = 0; i < this._maxContacts; i++) this._contacts.push(new Contact());

    this._projPool = [];
    this._ragdollSerial = 0;

    // Sleep budget expressed as displacement: how far the sleep speed would
    // carry a body across one sleep window.
    this._quietLin2 = (this.opt.sleepLinear * this.opt.sleepTime) ** 2;
    this._quietAng = 1 - Math.cos(this.opt.sleepAngular * this.opt.sleepTime * 0.5);

    this._accum = 0;
    this._steps = 0;
    this._lastStepMs = 0;
    this._queryOut = [];
    // A separate array: a spawn triggered from inside an onImpact hook would
    // otherwise clobber the candidate list the contact loop is walking.
    this._unstickOut = [];
    this._pts = new Float64Array(9 * 4); // x,y,z,radius per sample point
    this._ptCount = 0;
    this._hit = {
      hit: false, t: Infinity, px: 0, py: 0, pz: 0,
      nx: 0, ny: 1, nz: 0, box: null, surface: null,
    };
    this._sweepDir = new THREE.Vector3();
    this._sweepFrom = new THREE.Vector3();

    /* -------- hooks the other systems attach to (all optional) -------- */
    /** (body) => void — a body entered the world; attach a mesh. */
    this.onBodySpawn = null;
    /** (body) => void — a body left the world; return the mesh to your pool. */
    this.onBodyRemove = null;
    /** (body, px,py,pz, nx,ny,nz, speed, surface) => void — audio/VFX impact. */
    this.onImpact = null;
    /** (prop, chunkBodies) => void — a prop broke; hide the intact mesh. */
    this.onPropBreak = null;
    /** (ragdoll) => void */
    this.onRagdollSpawn = null;
    /** (ragdoll) => void */
    this.onRagdollRemove = null;
    /** (projectile, hit) => void — hit is {px,py,pz,nx,ny,nz,surface,box}. */
    this.onProjectileHit = null;

    /** Impact speed above which onImpact fires (m/s). */
    this.impactThreshold = 2.2;
  }

  /* ================================================================
     Stepping
     ================================================================ */

  /**
   * Advance the simulation by a wall-clock delta. Internally fixed-step, so the
   * result after one second of game time is identical at 30 Hz and at 144 Hz.
   * Returns the number of fixed steps run.
   */
  step(dt) {
    if (!(dt > 0)) return 0;
    const t0 = now();
    const h = this.opt.fixedDt;
    this._accum += dt < 0.25 ? dt : 0.25;
    let steps = 0;
    while (this._accum >= h - 1e-9 && steps < this.opt.maxStepsPerFrame) {
      this._fixedStep(h);
      this._accum -= h;
      steps++;
    }
    if (steps >= this.opt.maxStepsPerFrame && this._accum > h) this._accum = 0;
    this._steps += steps;
    this._lastStepMs = now() - t0;
    return steps;
  }

  _fixedStep(h) {
    const sub = this.opt.substeps > 0 ? this.opt.substeps : 1;
    const sh = h / sub;
    for (let s = 0; s < sub; s++) {
      this._integrateVelocities(sh);
      this._buildContacts(sh);
      this._solve(sh);
      this._integratePositions(sh);
    }
    this._stepProjectiles(h);
    this._postStep(h);
  }

  _integrateVelocities(h) {
    const g = this.opt.gravity;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.sleeping) continue;
      b._pv.set(0, 0, 0);
      b._pw.set(0, 0, 0);
      if (b.invMass > 0) b.velocity.y += g * h;
      const ld = Math.exp(-b.linearDamping * h);
      b.velocity.x *= ld; b.velocity.y *= ld; b.velocity.z *= ld;
      const ad = Math.exp(-b.angularDamping * h);
      b.angularVelocity.x *= ad; b.angularVelocity.y *= ad; b.angularVelocity.z *= ad;
      clampMag(b.velocity, this.opt.maxLinearSpeed);
      clampMag(b.angularVelocity, this.opt.maxAngularSpeed);
      quatToMat3(b.quaternion, b._rot);
      this._updateAabb(b);
    }
  }

  _updateAabb(b) {
    const a = b._aabb;
    let ex, ey, ez;
    if (b.shape === 'sphere') {
      ex = ey = ez = b.radius;
    } else if (b.shape === 'capsule') {
      const m = b._rot;
      const hl = b.length * 0.5;
      ex = Math.abs(m[1]) * hl + b.radius;
      ey = Math.abs(m[4]) * hl + b.radius;
      ez = Math.abs(m[7]) * hl + b.radius;
    } else {
      const m = b._rot;
      const hx = b.half.x, hy = b.half.y, hz = b.half.z;
      ex = Math.abs(m[0]) * hx + Math.abs(m[1]) * hy + Math.abs(m[2]) * hz;
      ey = Math.abs(m[3]) * hx + Math.abs(m[4]) * hy + Math.abs(m[5]) * hz;
      ez = Math.abs(m[6]) * hx + Math.abs(m[7]) * hy + Math.abs(m[8]) * hz;
    }
    a[0] = b.position.x - ex; a[1] = b.position.y - ey; a[2] = b.position.z - ez;
    a[3] = b.position.x + ex; a[4] = b.position.y + ey; a[5] = b.position.z + ez;
  }

  /* ---------------- contact generation ---------------- */

  _nextContact() {
    if (this._contactCount >= this._maxContacts) return null;
    let c = this._contacts[this._contactCount];
    if (!c) {
      // Only ever happens while the pool warms up, never in a steady frame.
      c = new Contact();
      this._contacts.push(c);
    }
    this._contactCount++;
    return c;
  }

  _buildContacts(h) {
    this._contactCount = 0;
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      b.contacts = 0;
      if (b.sleeping) continue;
      this._collideStatic(b, h);
    }
    if (this.opt.bodyVsBody && bodies.length <= this.opt.bodyVsBodyLimit) {
      this._collideBodies(h);
    }
  }

  /** Sample points for a body, into `_pts` as (x,y,z,radius) quadruples. */
  _samplePoints(b) {
    const p = this._pts;
    const pos = b.position;
    let n = 0;
    if (b.shape === 'sphere') {
      p[0] = pos.x; p[1] = pos.y; p[2] = pos.z; p[3] = b.radius;
      n = 1;
    } else if (b.shape === 'capsule') {
      const m = b._rot;
      const hl = b.length * 0.5;
      const ax = m[1] * hl, ay = m[4] * hl, az = m[7] * hl;
      p[0] = pos.x - ax; p[1] = pos.y - ay; p[2] = pos.z - az; p[3] = b.radius;
      p[4] = pos.x; p[5] = pos.y; p[6] = pos.z; p[7] = b.radius;
      p[8] = pos.x + ax; p[9] = pos.y + ay; p[10] = pos.z + az; p[11] = b.radius;
      n = 3;
    } else {
      const m = b._rot;
      const hx = b.half.x, hy = b.half.y, hz = b.half.z;
      for (let sx = -1; sx <= 1; sx += 2) {
        for (let sy = -1; sy <= 1; sy += 2) {
          for (let sz = -1; sz <= 1; sz += 2) {
            const lx = sx * hx, ly = sy * hy, lz = sz * hz;
            const i4 = n * 4;
            p[i4] = pos.x + m[0] * lx + m[1] * ly + m[2] * lz;
            p[i4 + 1] = pos.y + m[3] * lx + m[4] * ly + m[5] * lz;
            p[i4 + 2] = pos.z + m[6] * lx + m[7] * ly + m[8] * lz;
            p[i4 + 3] = 0;
            n++;
          }
        }
      }
      // Centre sampled as a sphere of the smallest half extent. Catches the
      // "resting on something narrower than me" and "inside a thin wall" cases
      // that corner-only sampling would miss.
      const i4 = n * 4;
      p[i4] = pos.x; p[i4 + 1] = pos.y; p[i4 + 2] = pos.z;
      p[i4 + 3] = Math.min(hx, hy, hz);
      n++;
    }
    this._ptCount = n;
    return n;
  }

  _collideStatic(b, h) {
    const n = this._samplePoints(b);
    const p = this._pts;
    const a = b._aabb;

    /* the implicit street plane at y = 0 */
    for (let i = 0; i < n; i++) {
      const i4 = i * 4;
      const py = p[i4 + 1];
      const r = p[i4 + 3];
      const depth = r - py;
      if (depth <= 0) continue;
      this._pushContact(b, null, p[i4], 0, p[i4 + 2], 0, 1, 0, depth,
        this.collision.groundSurface, null, h);
    }

    if (a[4] < -0.001) return; // fully below the street; ground handled it
    const boxes = this.collision.query(a[0], a[2], a[3], a[5], this._queryOut);
    for (let k = 0; k < boxes.length; k++) {
      const box = boxes[k];
      if (a[1] > box.top || a[4] < box.bottom) continue;
      for (let i = 0; i < n; i++) {
        const i4 = i * 4;
        this._pointVsBox(b, p[i4], p[i4 + 1], p[i4 + 2], p[i4 + 3], box, h);
      }
    }
  }

  _pointVsBox(b, px, py, pz, r, box, h) {
    const cx = px < box.x0 ? box.x0 : (px > box.x1 ? box.x1 : px);
    const cy = py < box.bottom ? box.bottom : (py > box.top ? box.top : py);
    const cz = pz < box.z0 ? box.z0 : (pz > box.z1 ? box.z1 : pz);
    const dx = px - cx, dy = py - cy, dz = pz - cz;
    const d2 = dx * dx + dy * dy + dz * dz;

    if (d2 > 1e-12) {
      if (d2 >= r * r) return;
      const d = Math.sqrt(d2);
      const inv = 1 / d;
      this._pushContact(b, null, cx, cy, cz, dx * inv, dy * inv, dz * inv, r - d,
        box.surface, box, h);
      return;
    }

    // Inside the collider: eject along the least-penetrating face. Downward
    // ejection is penalised so a chunk that ends up inside geometry comes out on
    // top or through a wall rather than dropping through the world.
    const toX0 = px - box.x0, toX1 = box.x1 - px;
    const toY0 = (py - box.bottom) * 3, toY1 = box.top - py;
    const toZ0 = pz - box.z0, toZ1 = box.z1 - pz;
    let best = toX0, ax = -1, ay = 0, az = 0, hx = box.x0, hy = py, hz = pz;
    if (toX1 < best) { best = toX1; ax = 1; ay = 0; az = 0; hx = box.x1; hy = py; hz = pz; }
    if (toY0 < best) { best = toY0; ax = 0; ay = -1; az = 0; hx = px; hy = box.bottom; hz = pz; }
    if (toY1 < best) { best = toY1; ax = 0; ay = 1; az = 0; hx = px; hy = box.top; hz = pz; }
    if (toZ0 < best) { best = toZ0; ax = 0; ay = 0; az = -1; hx = px; hy = py; hz = box.z0; }
    if (toZ1 < best) { best = toZ1; ax = 0; ay = 0; az = 1; hx = px; hy = py; hz = box.z1; }
    const depth = (ay === -1 ? best / 3 : best) + r;
    this._pushContact(b, null, hx, hy, hz, ax, ay, az, depth, box.surface, box, h);
  }

  _pushContact(a, bBody, px, py, pz, nx, ny, nz, depth, surface, box, h) {
    const c = this._nextContact();
    if (!c) return null;
    c.a = a;
    c.b = bBody;
    c.px = px; c.py = py; c.pz = pz;
    c.nx = nx; c.ny = ny; c.nz = nz;
    c.depth = depth;
    c.box = box;
    c.surface = surface || DEFAULT_SURFACE;
    const sf = c.surface.friction ?? 0.7;
    const sr = c.surface.restitution ?? 0.1;
    if (bBody) {
      c.friction = Math.sqrt(a.friction * bBody.friction);
      c.restitution = (a.restitution + bBody.restitution) * 0.5;
    } else {
      c.friction = Math.sqrt(a.friction * sf);
      c.restitution = (a.restitution + sr) * 0.5;
    }
    c.jn = 0;
    c.jp = 0;
    c.jt = 0;
    a.contacts++;
    if (bBody) bBody.contacts++;
    this._prestep(c, h);
    return c;
  }

  _prestep(c, h) {
    const a = c.a, b = c.b;
    c.rax = c.px - a.position.x;
    c.ray = c.py - a.position.y;
    c.raz = c.pz - a.position.z;
    let k = effMassTerm(a, c.rax, c.ray, c.raz, c.nx, c.ny, c.nz);
    if (b) {
      c.rbx = c.px - b.position.x;
      c.rby = c.py - b.position.y;
      c.rbz = c.pz - b.position.z;
      k += effMassTerm(b, c.rbx, c.rby, c.rbz, c.nx, c.ny, c.nz);
    }
    c.massN = k > EPS ? 1 / k : 0;

    // Approach speed along the normal, for restitution. This is the only thing
    // allowed to add energy to the real velocities.
    const vn = this._relativeNormalVelocity(c);
    c.bounce = vn < -this.opt.restitutionCutoff ? -c.restitution * vn : 0;

    // Penetration allowance scales with the body: a 2 cm sink is invisible on a
    // 9 m dragon's thigh but would look wrong on a 20 cm chunk.
    const pen = c.depth - this.opt.slop * (1 + c.a.boundRadius);
    let bias = 0;
    if (pen > 0) {
      bias = (this.opt.baumgarte / h) * pen;
      if (bias > this.opt.maxCorrection) bias = this.opt.maxCorrection;
    }
    c.bias = bias;

    // Tangent from the current sliding direction.
    this._relativeVelocity(c, _s1);
    const dot = _s1.x * c.nx + _s1.y * c.ny + _s1.z * c.nz;
    let tx = _s1.x - c.nx * dot;
    let ty = _s1.y - c.ny * dot;
    let tz = _s1.z - c.nz * dot;
    const tl2 = tx * tx + ty * ty + tz * tz;
    if (tl2 > 1e-10) {
      const inv = 1 / Math.sqrt(tl2);
      tx *= inv; ty *= inv; tz *= inv;
    } else {
      // No sliding: pick any tangent so static friction still has a basis.
      if (Math.abs(c.ny) < 0.9) { tx = -c.nz; ty = 0; tz = c.nx; } else { tx = 1; ty = 0; tz = 0; }
      const inv = 1 / Math.max(EPS, Math.hypot(tx, ty, tz));
      tx *= inv; ty *= inv; tz *= inv;
    }
    c.tx = tx; c.ty = ty; c.tz = tz;
    let kt = effMassTerm(a, c.rax, c.ray, c.raz, tx, ty, tz);
    if (b) kt += effMassTerm(b, c.rbx, c.rby, c.rbz, tx, ty, tz);
    c.massT = kt > EPS ? 1 / kt : 0;

    if (this.onImpact && -vn > this.impactThreshold) {
      a.lastImpactSpeed = -vn;
      this.onImpact(a, c.px, c.py, c.pz, c.nx, c.ny, c.nz, -vn, c.surface);
    }
  }

  _relativeVelocity(c, out) {
    const a = c.a;
    const wa = a.angularVelocity;
    out.x = a.velocity.x + wa.y * c.raz - wa.z * c.ray;
    out.y = a.velocity.y + wa.z * c.rax - wa.x * c.raz;
    out.z = a.velocity.z + wa.x * c.ray - wa.y * c.rax;
    const b = c.b;
    if (b) {
      const wb = b.angularVelocity;
      out.x -= b.velocity.x + wb.y * c.rbz - wb.z * c.rby;
      out.y -= b.velocity.y + wb.z * c.rbx - wb.x * c.rbz;
      out.z -= b.velocity.z + wb.x * c.rby - wb.y * c.rbx;
    }
    return out;
  }

  _relativeNormalVelocity(c) {
    this._relativeVelocity(c, _s2);
    return _s2.x * c.nx + _s2.y * c.ny + _s2.z * c.nz;
  }

  /** Relative pseudo velocity at the contact, along the normal. */
  _relativePseudoNormal(c) {
    const a = c.a;
    const wa = a._pw;
    let x = a._pv.x + wa.y * c.raz - wa.z * c.ray;
    let y = a._pv.y + wa.z * c.rax - wa.x * c.raz;
    let z = a._pv.z + wa.x * c.ray - wa.y * c.rax;
    const b = c.b;
    if (b) {
      const wb = b._pw;
      x -= b._pv.x + wb.y * c.rbz - wb.z * c.rby;
      y -= b._pv.y + wb.z * c.rbx - wb.x * c.rbz;
      z -= b._pv.z + wb.x * c.rby - wb.y * c.rbx;
    }
    return x * c.nx + y * c.ny + z * c.nz;
  }

  /* ---------------- dynamic pairs ---------------- */
  _collideBodies(h) {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      if (!a.collideBodies) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        if (!b.collideBodies) continue;
        if (a.sleeping && b.sleeping) continue;
        if (a.group !== 0 && a.group === b.group) continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const dz = b.position.z - a.position.z;
        const rr = a.boundRadius + b.boundRadius;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-10) continue;
        const d = Math.sqrt(d2);
        const inv = 1 / d;
        const nx = -dx * inv, ny = -dy * inv, nz = -dz * inv; // points at a
        const mid = (a.boundRadius - (rr - d) * 0.5) * inv;
        this._pushContact(
          a, b,
          a.position.x + dx * mid, a.position.y + dy * mid, a.position.z + dz * mid,
          nx, ny, nz, rr - d, null, null, h,
        );
        if (a.sleeping) this.wake(a);
        if (b.sleeping) this.wake(b);
      }
    }
  }

  /* ---------------- solve ---------------- */
  _solve(h) {
    const cIters = this.opt.contactIterations;
    const jIters = this.ragdolls.length > 0 ? this.opt.jointIterations : 0;
    const iters = cIters > jIters ? cIters : jIters;
    for (let it = 0; it < iters; it++) {
      if (it < cIters) {
        const n = this._contactCount;
        for (let i = 0; i < n; i++) this._solveContact(this._contacts[i]);
      }
      if (it < jIters) {
        for (let r = 0; r < this.ragdolls.length; r++) this._solveRagdoll(this.ragdolls[r], h);
      }
    }
  }

  _solveContact(c) {
    const a = c.a, b = c.b;
    /* normal — real velocities, restitution only */
    const vn = this._relativeNormalVelocity(c);
    let dJn = (-vn + c.bounce) * c.massN;
    let jn = c.jn + dJn;
    if (jn < 0) jn = 0;
    dJn = jn - c.jn;
    c.jn = jn;
    if (dJn !== 0) {
      a._impulseNoWake(c.nx * dJn, c.ny * dJn, c.nz * dJn, c.rax, c.ray, c.raz);
      if (b) b._impulseNoWake(-c.nx * dJn, -c.ny * dJn, -c.nz * dJn, c.rbx, c.rby, c.rbz);
    }

    /* penetration — pseudo velocities, so pushing out never adds energy */
    if (c.bias > 0) {
      const vnp = this._relativePseudoNormal(c);
      let dJp = (-vnp + c.bias) * c.massN;
      let jp = c.jp + dJp;
      if (jp < 0) jp = 0;
      dJp = jp - c.jp;
      c.jp = jp;
      if (dJp !== 0) {
        a._impulsePseudo(c.nx * dJp, c.ny * dJp, c.nz * dJp, c.rax, c.ray, c.raz);
        if (b) b._impulsePseudo(-c.nx * dJp, -c.ny * dJp, -c.nz * dJp, c.rbx, c.rby, c.rbz);
      }
    }

    /* friction (Coulomb, clamped against the accumulated normal impulse) */
    this._relativeVelocity(c, _s2);
    const vt = _s2.x * c.tx + _s2.y * c.ty + _s2.z * c.tz;
    let dJt = -vt * c.massT;
    const max = c.friction * c.jn;
    let jt = c.jt + dJt;
    if (jt > max) jt = max;
    else if (jt < -max) jt = -max;
    dJt = jt - c.jt;
    c.jt = jt;
    if (dJt !== 0) {
      a._impulseNoWake(c.tx * dJt, c.ty * dJt, c.tz * dJt, c.rax, c.ray, c.raz);
      if (b) b._impulseNoWake(-c.tx * dJt, -c.ty * dJt, -c.tz * dJt, c.rbx, c.rby, c.rbz);
    }
  }

  /* ---------------- integrate positions ---------------- */
  _integratePositions(h) {
    const bodies = this.bodies;
    const bounds = this.collision.bounds;
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      if (b.sleeping) continue;

      if (!finite3(b.velocity) || !finite3(b.angularVelocity) || !finite3(b.position)) {
        // Defensive: never let a bad number spread through the pool.
        b.velocity.set(0, 0, 0);
        b.angularVelocity.set(0, 0, 0);
        if (!finite3(b.position)) { this.removeBody(b); continue; }
        this._sleep(b);
        continue;
      }

      // Positions move on velocity + pseudo velocity; the pseudo part is the
      // accumulated penetration/joint correction, discarded next substep.
      clampMag(b._pv, this.opt.maxCorrection * 2);
      clampMag(b._pw, this.opt.maxAngularSpeed);
      let vx = b.velocity.x + b._pv.x;
      let vy = b.velocity.y + b._pv.y;
      let vz = b.velocity.z + b._pv.z;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let travel = speed * h;
      /* Continuous collision for anything moving further than its own inscribed
       * sphere in one substep — the sweep is analytic and cannot tunnel, so this
       * is the thin-wall guarantee. The hit distance must be clear of zero: a
       * body already resting against a surface reports t = 0 and has to be left
       * to the contact solver, or a fast slide along the ground would freeze. */
      const probe = Math.max(0.04, b.radius * 0.9);
      if (travel > probe && speed > EPS) {
        const inv = 1 / speed;
        this._sweepDir.set(vx * inv, vy * inv, vz * inv);
        this._sweepFrom.copy(b.position);
        const hit = this.collision.sweepSphere(
          this._sweepFrom, this._sweepDir, travel, probe, this._hit,
        );
        if (hit.hit && hit.t > 0.01) {
          travel = hit.t - 0.005;
          if (travel < 0) travel = 0;
          const vnn = vx * hit.nx + vy * hit.ny + vz * hit.nz;
          if (vnn < 0) {
            const bounce = 1 + b.restitution * 0.5;
            b.velocity.x -= hit.nx * vnn * bounce;
            b.velocity.y -= hit.ny * vnn * bounce;
            b.velocity.z -= hit.nz * vnn * bounce;
          }
          if (this.onImpact && -vnn > this.impactThreshold) {
            b.lastImpactSpeed = -vnn;
            this.onImpact(b, hit.px, hit.py, hit.pz, hit.nx, hit.ny, hit.nz, -vnn,
              hit.surface || this.collision.groundSurface);
          }
        }
        const s = travel / speed;
        b.position.x += vx * s;
        b.position.y += vy * s;
        b.position.z += vz * s;
      } else {
        b.position.x += vx * h;
        b.position.y += vy * h;
        b.position.z += vz * h;
      }

      /* orientation: q += 0.5 (ω ⊗ q) h */
      const q = b.quaternion;
      const w = b.angularVelocity;
      const wx = w.x + b._pw.x, wy = w.y + b._pw.y, wz = w.z + b._pw.z;
      const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
      const dx = (wx * qw + wy * qz - wz * qy) * 0.5;
      const dy = (wy * qw + wz * qx - wx * qz) * 0.5;
      const dz = (wz * qw + wx * qy - wy * qx) * 0.5;
      const dw = (-wx * qx - wy * qy - wz * qz) * 0.5;
      q.x = qx + dx * h; q.y = qy + dy * h; q.z = qz + dz * h; q.w = qw + dw * h;
      const nl = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
      if (nl > EPS) { const s = 1 / nl; q.x *= s; q.y *= s; q.z *= s; q.w *= s; }
      else q.set(0, 0, 0, 1);

      /* nothing escapes the world */
      if (b.position.x < bounds.x0) { b.position.x = bounds.x0; if (b.velocity.x < 0) b.velocity.x = 0; }
      else if (b.position.x > bounds.x1) { b.position.x = bounds.x1; if (b.velocity.x > 0) b.velocity.x = 0; }
      if (b.position.z < bounds.z0) { b.position.z = bounds.z0; if (b.velocity.z < 0) b.velocity.z = 0; }
      else if (b.position.z > bounds.z1) { b.position.z = bounds.z1; if (b.velocity.z > 0) b.velocity.z = 0; }
      if (b.position.y < this.opt.killBelowY) this.removeBody(b);
    }
  }

  /* ---------------- bookkeeping ---------------- */
  /**
   * Has this body stayed put since its reference pose? Resets the reference (and
   * returns false) as soon as it has travelled or turned more than the sleep
   * speed sustained over the sleep window would allow.
   */
  _displaced(b) {
    const dx = b.position.x - b._refPos.x;
    const dy = b.position.y - b._refPos.y;
    const dz = b.position.z - b._refPos.z;
    if (dx * dx + dy * dy + dz * dz > this._quietLin2) return true;
    const q = b.quaternion, r = b._refQuat;
    return 1 - Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w) > this._quietAng;
  }

  _resetRef(b) {
    b._refPos.copy(b.position);
    b._refQuat.copy(b.quaternion);
  }

  _quiet(b) {
    if (this._displaced(b)) {
      this._resetRef(b);
      return false;
    }
    return true;
  }

  _postStep(h) {
    const bodies = this.bodies;

    // Ragdolls sleep as one island. Letting individual bones drop out would let
    // the joint solver keep pushing bodies that no longer integrate, and the
    // corpse would twitch forever instead of settling.
    for (let r = 0; r < this.ragdolls.length; r++) {
      this._ragdollSleep(this.ragdolls[r], h);
    }

    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i];
      b.age += h;
      if (b._ragdoll) continue; // handled by the island pass above
      if (!b.sleeping) {
        if (this._quiet(b)) {
          b.sleepTimer += h;
          if (b.sleepTimer >= this.opt.sleepTime) this._sleep(b);
        } else {
          b.sleepTimer = 0;
          b.settledTime = 0;
        }
      }
      if (b.sleeping) {
        b.settledTime += h;
        if (b.lifetime !== Infinity && b.settledTime > b.lifetime) {
          b.fade -= h / Math.max(0.05, b.fadeTime);
          if (b.fade <= 0) { this.removeBody(b); continue; }
        }
      }
    }

    for (let i = this.ragdolls.length - 1; i >= 0; i--) {
      this._updateRagdoll(this.ragdolls[i], h);
    }
  }

  /** All bones of a ragdoll go quiet together, or none of them do. */
  _ragdollSleep(rag, h) {
    const bones = rag.bones;
    if (bones.length === 0) return;
    let anyAwake = false;
    let maxLin = 0;
    let maxAng = 0;
    let quiet = true;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i].body;
      if (!b.sleeping) anyAwake = true;
      const v = b.velocity, w = b.angularVelocity;
      const lin = v.x * v.x + v.y * v.y + v.z * v.z;
      const ang = w.x * w.x + w.y * w.y + w.z * w.z;
      if (lin > maxLin) maxLin = lin;
      if (ang > maxAng) maxAng = ang;
      // Tested, not reset, per bone: the whole island shares one reference
      // instant, otherwise twelve independently-resetting bones would reset the
      // island timer twelve times as often and a heavy corpse could never sleep.
      if (this._displaced(b)) quiet = false;
    }
    if (!anyAwake) { rag.sleepTimer = 0; return; }

    // Settle assist. A jointed chain with a heavy root (the boss torso is 900 kg
    // against a 45 kg tail tip) never quite converges on its own, so once the
    // whole body is already slow we actively drain the residual energy. Without
    // this a corpse keeps creeping instead of visibly coming to rest.
    const k = this.opt.ragdollSettleDamping;
    const sl2 = this.opt.sleepLinear * this.opt.sleepLinear;
    const sa2 = this.opt.sleepAngular * this.opt.sleepAngular;
    if (k > 0 && maxLin < sl2 * 36 && maxAng < sa2 * 36) {
      const damp = Math.exp(-k * h);
      for (let i = 0; i < bones.length; i++) {
        const b = bones[i].body;
        b.velocity.multiplyScalar(damp);
        b.angularVelocity.multiplyScalar(damp);
      }
    }

    if (quiet) {
      rag.sleepTimer += h;
      if (rag.sleepTimer >= this.opt.sleepTime) {
        for (let i = 0; i < bones.length; i++) this._sleep(bones[i].body);
        rag.sleepTimer = 0;
      }
    } else {
      rag.sleepTimer = 0;
      // One bone still moving means the whole body is still moving.
      for (let i = 0; i < bones.length; i++) {
        const b = bones[i].body;
        b.sleeping = false;
        b.sleepTimer = 0;
        this._resetRef(b);
      }
    }
  }

  _sleep(b) {
    b.sleeping = true;
    b.sleepTimer = 0;
    b.velocity.set(0, 0, 0);
    b.angularVelocity.set(0, 0, 0);
  }

  /** Wake a body (an explosion, a shove, a neighbour landing on it). */
  wake(b) {
    if (!b || !b.active) return;
    if (b._ragdoll) {
      const bones = b._ragdoll.bones;
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i].body;
        bone.sleeping = false;
        bone.sleepTimer = 0;
        bone.settledTime = 0;
        bone._refPos.copy(bone.position);
        bone._refQuat.copy(bone.quaternion);
      }
      b._ragdoll.sleepTimer = 0;
      return;
    }
    b.sleeping = false;
    b.sleepTimer = 0;
    b.settledTime = 0;
    b._refPos.copy(b.position);
    b._refQuat.copy(b.quaternion);
  }

  wakeAll() {
    for (let i = 0; i < this.bodies.length; i++) this.wake(this.bodies[i]);
  }

  /* ================================================================
     Body lifecycle
     ================================================================ */

  /**
   * Spawn a rigid body. Returns the Body, or null when the pool is full and
   * nothing could be evicted.
   *
   * desc: { shape, position, quaternion, size|half, radius, length, mass,
   *         velocity, angularVelocity, restitution, friction, surface,
   *         linearDamping, angularDamping, lifetime, fadeTime, kind, group,
   *         userData, evictable, collideBodies }
   */
  spawnBody(desc = {}) {
    let b = this._pool.pop();
    if (!b) b = this._evict();
    if (!b) return null;

    b.active = true;
    b.sleeping = false;
    b.shape = desc.shape || 'box';
    b.serial = ++this._serial;

    if (b.shape === 'sphere') {
      b.radius = desc.radius ?? 0.2;
      b.half.set(b.radius, b.radius, b.radius);
      b.boundRadius = b.radius;
    } else if (b.shape === 'capsule') {
      b.radius = desc.radius ?? 0.12;
      b.length = desc.length ?? 0.4;
      b.half.set(b.radius, b.radius + b.length * 0.5, b.radius);
      b.boundRadius = b.radius + b.length * 0.5;
    } else {
      if (desc.half) b.half.set(desc.half.x, desc.half.y, desc.half.z);
      else if (desc.size) b.half.set(desc.size.x * 0.5, desc.size.y * 0.5, desc.size.z * 0.5);
      else b.half.set(0.2, 0.2, 0.2);
      b.radius = Math.min(b.half.x, b.half.y, b.half.z);
      b.boundRadius = b.half.length();
    }

    if (desc.position) b.position.copy(desc.position); else b.position.set(0, 0, 0);
    if (desc.quaternion) b.quaternion.copy(desc.quaternion); else b.quaternion.set(0, 0, 0, 1);
    if (desc.velocity) b.velocity.copy(desc.velocity); else b.velocity.set(0, 0, 0);
    if (desc.angularVelocity) b.angularVelocity.copy(desc.angularVelocity);
    else b.angularVelocity.set(0, 0, 0);

    b.mass = desc.mass ?? 8;
    b.invMass = b.mass > 0 ? 1 / b.mass : 0;
    setInertia(b);

    b.surface = resolveSurface(desc.surface, 'prop');
    b.restitution = desc.restitution ?? b.surface.restitution;
    b.friction = desc.friction ?? b.surface.friction;
    b.linearDamping = desc.linearDamping ?? 0.05;
    b.angularDamping = desc.angularDamping ?? 0.14;

    b.kind = desc.kind || 'debris';
    b.group = desc.group || 0;
    b.userData = desc.userData ?? null;
    b.evictable = desc.evictable !== false;
    b.collideBodies = desc.collideBodies !== false;
    b.lifetime = desc.lifetime ?? this.opt.debrisLifetime;
    b.fadeTime = desc.fadeTime ?? this.opt.debrisFade;
    b.fade = 1;
    b.age = 0;
    b.settledTime = 0;
    b.sleepTimer = 0;
    b.contacts = 0;
    b.lastImpactSpeed = 0;
    b._ragdoll = null;
    b._bone = -1;

    quatToMat3(b.quaternion, b._rot);
    this._updateAabb(b);
    if (desc.unstick !== false) this._unstick(b);
    b._refPos.copy(b.position);
    b._refQuat.copy(b.quaternion);

    b.index = this.bodies.length;
    this.bodies.push(b);
    if (this.onBodySpawn) this.onBodySpawn(b);
    return b;
  }

  /**
   * One-shot push out of any collider a body was spawned inside. Done at spawn
   * only — the per-frame path never does this kind of search.
   */
  _unstick(b) {
    const a = b._aabb;
    if (b.position.y < b.boundRadius) b.position.y = b.boundRadius;
    const boxes = this.collision.query(a[0], a[2], a[3], a[5], this._unstickOut);
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let k = 0; k < boxes.length; k++) {
        const box = boxes[k];
        const px = b.position.x, py = b.position.y, pz = b.position.z;
        const r = b.radius;
        if (px < box.x0 - r || px > box.x1 + r) continue;
        if (pz < box.z0 - r || pz > box.z1 + r) continue;
        if (py < box.bottom - r || py > box.top + r) continue;
        const toX0 = px - box.x0 + r, toX1 = box.x1 - px + r;
        const toY1 = box.top - py + r;
        const toZ0 = pz - box.z0 + r, toZ1 = box.z1 - pz + r;
        let best = toY1, axis = 1, sign = 1;
        if (toX0 < best) { best = toX0; axis = 0; sign = -1; }
        if (toX1 < best) { best = toX1; axis = 0; sign = 1; }
        if (toZ0 < best) { best = toZ0; axis = 2; sign = -1; }
        if (toZ1 < best) { best = toZ1; axis = 2; sign = 1; }
        if (axis === 0) b.position.x += sign * best;
        else if (axis === 1) b.position.y += best;
        else b.position.z += sign * best;
        moved = true;
      }
      if (!moved) break;
      this._updateAabb(b);
    }
  }

  /** Oldest sleeping body dies first, then the oldest body overall. */
  _evict() {
    const bodies = this.bodies;
    let victim = null;
    let bestSerial = Infinity;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.evictable) continue;
      if (!b.sleeping) continue;
      if (b.serial < bestSerial) { bestSerial = b.serial; victim = b; }
    }
    if (!victim) {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (!b.evictable) continue;
        if (b.serial < bestSerial) { bestSerial = b.serial; victim = b; }
      }
    }
    if (!victim) return null;
    this.removeBody(victim);
    return this._pool.pop() || null;
  }

  removeBody(b) {
    if (!b || !b.active) return false;
    if (b._ragdoll) {
      // A ragdoll bone cannot leave on its own; take the whole handle down.
      const rag = b._ragdoll;
      b._ragdoll = null;
      this.removeRagdoll(rag);
      if (!b.active) return true;
    }
    b.active = false;
    b.sleeping = false;
    const last = this.bodies.pop();
    if (last !== b) {
      this.bodies[b.index] = last;
      last.index = b.index;
    }
    b.index = -1;
    if (this.onBodyRemove) this.onBodyRemove(b);
    b.userData = null;
    this._pool.push(b);
    return true;
  }

  /** Drop every body, ragdoll, projectile and prop registration. */
  clear() {
    for (let i = this.ragdolls.length - 1; i >= 0; i--) this.removeRagdoll(this.ragdolls[i]);
    for (let i = this.bodies.length - 1; i >= 0; i--) this.removeBody(this.bodies[i]);
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._despawnProjectile(i);
    this.breakables.length = 0;
    this._accum = 0;
  }

  /* ================================================================
     Debris helper
     ================================================================ */

  /**
   * Scatter `count` chunks from a point. Sizes and velocities come from the
   * seeded Rng, so the same hit always throws the same debris.
   */
  spawnDebris(point, count = 6, opts = {}) {
    const rng = this.rng;
    const out = [];
    const speed = opts.speed ?? 5;
    const size = opts.size ?? 0.18;
    const dir = opts.direction || null;
    for (let i = 0; i < count; i++) {
      const sx = size * rng.float(0.55, 1.5);
      const sy = size * rng.float(0.55, 1.5);
      const sz = size * rng.float(0.55, 1.5);
      const a = rng.float(0, Math.PI * 2);
      const up = rng.float(0.2, 1.1);
      const s = speed * rng.float(0.4, 1.3);
      const b = this.spawnBody({
        shape: opts.shape || 'box',
        half: { x: sx, y: sy, z: sz },
        radius: Math.max(sx, sy, sz),
        position: {
          x: point.x + Math.cos(a) * size * 2,
          y: point.y + rng.float(0, size * 3),
          z: point.z + Math.sin(a) * size * 2,
        },
        quaternion: randomQuat(rng, _q1),
        velocity: {
          x: Math.cos(a) * s + (dir ? dir.x * speed * 0.6 : 0),
          y: up * s + (dir ? dir.y * speed * 0.6 : 0),
          z: Math.sin(a) * s + (dir ? dir.z * speed * 0.6 : 0),
        },
        angularVelocity: {
          x: rng.float(-9, 9), y: rng.float(-9, 9), z: rng.float(-9, 9),
        },
        mass: opts.mass ?? Math.max(0.4, sx * sy * sz * 600),
        surface: opts.surface,
        kind: opts.kind || 'debris',
        lifetime: opts.lifetime ?? this.opt.debrisLifetime,
        fadeTime: opts.fadeTime ?? this.opt.debrisFade,
        userData: opts.userData ?? null,
      });
      if (b) out.push(b);
    }
    return out;
  }

  /* ================================================================
     Breakable props
     ================================================================ */

  /**
   * Register a prop as breakable. Chunks are pre-fractured HERE, at build time —
   * breaking later only takes bodies out of the pool.
   *
   * opts: {
   *   colliders | collider   static CollisionWorld boxes to remove on break
   *   center {x,y,z}         defaults to the collider bounds centre
   *   size {x,y,z}           defaults to the collider bounds size
   *   chunks                 chunk count (default 6) or an explicit descriptor list
   *   threshold              impulse (N·s) needed to break it (default 55)
   *   mass                   total mass, split across chunks (default 40)
   *   surface                'wood' | 'glass' | ... (default from the collider)
   *   seed                   integer; determines the fracture pattern
   *   onBreak(prop, bodies)  called once, after the chunk bodies exist
   *   userData               anything (the mesh, usually)
   * }
   */
  registerBreakable(opts = {}) {
    const colliders = opts.colliders
      ? opts.colliders.slice()
      : (opts.collider ? [opts.collider] : []);

    let center = opts.center;
    let size = opts.size;
    if ((!center || !size) && colliders.length > 0) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      let y0 = Infinity, y1 = -Infinity;
      for (const c of colliders) {
        if (c.x0 < x0) x0 = c.x0;
        if (c.x1 > x1) x1 = c.x1;
        if (c.z0 < z0) z0 = c.z0;
        if (c.z1 > z1) z1 = c.z1;
        if (c.bottom < y0) y0 = c.bottom;
        if (c.top > y1) y1 = c.top;
      }
      center = center || { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 };
      size = size || { x: x1 - x0, y: y1 - y0, z: z1 - z0 };
    }
    if (!center || !size) throw new Error('registerBreakable needs colliders or center+size');

    const surface = resolveSurface(
      opts.surface || (colliders[0] ? colliders[0].surface : null), 'prop',
    );
    const seed = opts.seed ?? (0x9e37 ^ Math.round(center.x * 73 + center.z * 131 + center.y * 17));
    const chunkCount = Array.isArray(opts.chunks) ? opts.chunks.length : (opts.chunks ?? 6);
    const totalMass = opts.mass ?? 40;

    const prop = {
      id: this.breakables.length,
      alive: true,
      broken: false,
      colliders,
      center: { x: center.x, y: center.y, z: center.z },
      size: { x: size.x, y: size.y, z: size.z },
      threshold: opts.threshold ?? 55,
      mass: totalMass,
      surface,
      chunks: Array.isArray(opts.chunks) ? opts.chunks : fracture(size, chunkCount, new Rng(seed)),
      seed,
      onBreak: opts.onBreak || null,
      userData: opts.userData ?? null,
      radius: Math.hypot(size.x, size.y, size.z) * 0.5,
      damage: 0,
      hp: opts.hp ?? 0,
    };
    // Chunk masses are proportional to volume so a big slab lands heavy.
    let vol = 0;
    for (const c of prop.chunks) vol += c.hx * c.hy * c.hz;
    for (const c of prop.chunks) c.mass = Math.max(0.4, totalMass * (c.hx * c.hy * c.hz) / Math.max(EPS, vol));

    this.breakables.push(prop);
    return prop;
  }

  unregisterBreakable(prop) {
    const i = this.breakables.indexOf(prop);
    if (i < 0) return false;
    this.breakables.splice(i, 1);
    prop.alive = false;
    return true;
  }

  /**
   * Break a prop now. Removes its static colliders from the grid (every cell
   * they occupy) and spawns the pre-fractured chunks.
   * Returns the array of chunk bodies (possibly short, if the pool was full).
   */
  breakProp(prop, impulse = null, point = null) {
    if (!prop || prop.broken) return [];
    prop.broken = true;
    prop.alive = false;

    // The static collider must stop existing the moment the prop does.
    this.collision.removeAll(prop.colliders);
    prop.colliders.length = 0;

    const rng = new Rng(prop.seed ^ 0x1234);
    const bodies = [];
    const ix = impulse ? impulse.x : 0;
    const iy = impulse ? impulse.y : 0;
    const iz = impulse ? impulse.z : 0;
    const impMag = Math.hypot(ix, iy, iz);

    for (let i = 0; i < prop.chunks.length; i++) {
      const c = prop.chunks[i];
      const cx = prop.center.x + c.ox;
      const cy = prop.center.y + c.oy;
      const cz = prop.center.z + c.oz;
      // Blow outwards from the impact point, or from the prop centre.
      let dx = cx - (point ? point.x : prop.center.x);
      let dy = cy - (point ? point.y : prop.center.y - prop.size.y * 0.4);
      let dz = cz - (point ? point.z : prop.center.z);
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const push = Math.min(9, 1.5 + impMag / Math.max(1, prop.mass) * 3);
      const b = this.spawnBody({
        shape: 'box',
        half: { x: c.hx, y: c.hy, z: c.hz },
        position: { x: cx, y: cy, z: cz },
        velocity: {
          x: dx * push + ix / Math.max(1, prop.mass) + rng.float(-0.6, 0.6),
          y: dy * push + iy / Math.max(1, prop.mass) + rng.float(0.4, 2.2),
          z: dz * push + iz / Math.max(1, prop.mass) + rng.float(-0.6, 0.6),
        },
        angularVelocity: { x: rng.float(-7, 7), y: rng.float(-7, 7), z: rng.float(-7, 7) },
        mass: c.mass,
        surface: prop.surface,
        kind: 'chunk',
        lifetime: this.opt.debrisLifetime,
        userData: prop.userData,
        unstick: false,
      });
      if (b) bodies.push(b);
    }

    this.unregisterBreakable(prop);
    if (prop.onBreak) prop.onBreak(prop, bodies);
    if (this.onPropBreak) this.onPropBreak(prop, bodies);
    return bodies;
  }

  /**
   * Report an impact (a bullet, a punch, a body slamming into something). Breaks
   * any registered prop within `radius` whose threshold the impulse exceeds.
   * Returns the number of props broken.
   */
  reportImpact(point, impulse, direction = null, radius = 0.6) {
    let broken = 0;
    for (let i = this.breakables.length - 1; i >= 0; i--) {
      const prop = this.breakables[i];
      if (prop.broken) continue;
      const reach = prop.radius + radius;
      if (Math.abs(point.x - prop.center.x) > reach) continue;
      if (Math.abs(point.y - prop.center.y) > reach) continue;
      if (Math.abs(point.z - prop.center.z) > reach) continue;
      if (impulse < prop.threshold) {
        prop.damage += impulse;
        if (prop.damage < prop.threshold) continue;
      }
      _v1.set(
        (direction ? direction.x : 0) * impulse,
        (direction ? direction.y : 0) * impulse,
        (direction ? direction.z : 0) * impulse,
      );
      this.breakProp(prop, _v1, point);
      broken++;
    }
    return broken;
  }

  /** Nearest registered breakable to a point within `radius`, or null. */
  breakableNear(point, radius = 1.2) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < this.breakables.length; i++) {
      const p = this.breakables[i];
      if (p.broken) continue;
      const d = Math.hypot(point.x - p.center.x, point.y - p.center.y, point.z - p.center.z);
      if (d < radius + p.radius && d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /* ================================================================
     Explosions
     ================================================================ */

  /**
   * Impart impulses to every body, ragdoll bone and breakable prop within
   * `radius`, with quadratic distance falloff and line-of-sight occlusion
   * against the static world (so a blast round a corner does not throw a bin
   * through a wall). `force` is the impulse magnitude at the epicentre, N·s.
   *
   * opts: { up = 0.35, occlusion = true, occludedScale = 0, breakScale = 1 }
   */
  applyExplosion(point, radius, force, opts = {}) {
    const up = opts.up ?? 0.35;
    const occlude = opts.occlusion !== false;
    const occludedScale = opts.occludedScale ?? 0;
    const breakScale = opts.breakScale ?? 1;
    let hitBodies = 0;
    let brokenProps = 0;

    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      let dx = b.position.x - point.x;
      let dy = b.position.y - point.y;
      let dz = b.position.z - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) continue;
      let scale = 1 - d / radius;
      scale *= scale;
      if (occlude && d > 0.4) {
        const vis = this._visible(point, b.position, d);
        if (!vis) {
          if (occludedScale <= 0) continue;
          scale *= occludedScale;
        }
      }
      if (d < 1e-4) { dx = 0; dy = 1; dz = 0; } else { dx /= d; dy /= d; dz /= d; }
      dy += up;
      const inv = 1 / Math.max(EPS, Math.hypot(dx, dy, dz));
      const j = force * scale;
      this.wake(b);
      // Off-centre by a fraction of the body so the blast also spins it.
      b._impulse(
        dx * inv * j, dy * inv * j, dz * inv * j,
        -dx * b.boundRadius * 0.4, -dy * b.boundRadius * 0.4, -dz * b.boundRadius * 0.4,
      );
      hitBodies++;
    }

    for (let i = this.breakables.length - 1; i >= 0; i--) {
      const prop = this.breakables[i];
      if (prop.broken) continue;
      const dx = prop.center.x - point.x;
      const dy = prop.center.y - point.y;
      const dz = prop.center.z - point.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius + prop.radius) continue;
      let scale = 1 - Math.min(1, d / radius);
      scale *= scale;
      // A blast going off inside or against the prop cannot be occluded by the
      // prop itself, which is exactly where a grenade at the foot of a stall ends
      // up. Only test line of sight once we are clear of it.
      const touching = d <= prop.radius + 0.5;
      if (occlude && !touching && !this._visible(point, prop.center, d)) continue;
      const j = force * scale * breakScale;
      if (j < prop.threshold) {
        prop.damage += j;
        if (prop.damage < prop.threshold) continue;
      }
      const dl = Math.max(EPS, d);
      _v1.set(dx / dl * j, (dy / dl + up) * j, dz / dl * j);
      this.breakProp(prop, _v1, point);
      brokenProps++;
    }

    return { bodies: hitBodies, props: brokenProps };
  }

  /**
   * Static-world visibility between two points, ignoring the street plane (a
   * body lying on the ground must not be shadowed by the ground it rests on).
   */
  _visible(from, to, dist) {
    const d = dist ?? Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (d < OCCLUSION_SKIN * 3) return true;
    this._sweepDir.set((to.x - from.x) / d, (to.y - from.y) / d, (to.z - from.z) / d);
    // Start a little way along the ray. An explosion almost always goes off
    // touching a surface, and a ray that starts exactly on a wall face reports a
    // hit at t = 0 — which would make the whole world invisible from every
    // impact point. Stepping in first still lands us inside the wall when the
    // target really is on the far side, so occlusion keeps working.
    this._sweepFrom.set(
      from.x + this._sweepDir.x * OCCLUSION_SKIN,
      from.y + this._sweepDir.y * OCCLUSION_SKIN,
      from.z + this._sweepDir.z * OCCLUSION_SKIN,
    );
    const hit = this.collision.raycastHit(
      this._sweepFrom, this._sweepDir, d - OCCLUSION_SKIN * 2, this._hit, true,
    );
    return !hit.hit;
  }

  /* ================================================================
     Ballistics
     ================================================================ */

  /**
   * A ballistic projectile: gravity, quadratic-ish drag, and a swept-sphere
   * world test that is substepped so a 300 m/s round cannot skip a 10 cm wall.
   *
   * opts: { radius, gravity, drag, mass, damage, owner, life, restitution,
   *         bounces, impactImpulse, userData }
   */
  spawnProjectile(origin, velocity, opts = {}) {
    let p = this._projPool.pop();
    if (!p) {
      if (this.projectiles.length >= this.opt.maxProjectiles) return null;
      p = {
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        prev: new THREE.Vector3(),
        radius: 0.08, gravity: -24, drag: 0.02, mass: 0.05,
        damage: 0, owner: 'player', life: 4, alive: false,
        restitution: 0, bounces: 0, impactImpulse: 0, userData: null,
        distance: 0,
      };
    }
    p.position.copy(origin);
    p.prev.copy(origin);
    p.velocity.copy(velocity);
    p.radius = opts.radius ?? 0.08;
    p.gravity = opts.gravity ?? this.opt.gravity;
    p.drag = opts.drag ?? 0.02;
    p.mass = opts.mass ?? 0.05;
    p.damage = opts.damage ?? 0;
    p.owner = opts.owner ?? 'player';
    p.life = opts.life ?? 4;
    p.restitution = opts.restitution ?? 0;
    p.bounces = opts.bounces ?? 0;
    p.impactImpulse = opts.impactImpulse ?? 0;
    p.userData = opts.userData ?? null;
    p.distance = 0;
    p.alive = true;
    this.projectiles.push(p);
    return p;
  }

  _despawnProjectile(index) {
    const p = this.projectiles[index];
    p.alive = false;
    p.userData = null;
    const last = this.projectiles.pop();
    if (last !== p) this.projectiles[index] = last;
    this._projPool.push(p);
  }

  _stepProjectiles(h) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= h;
      if (p.life <= 0) { this._despawnProjectile(i); continue; }

      p.velocity.y += p.gravity * h;
      const dragK = Math.exp(-p.drag * h * p.velocity.length());
      p.velocity.multiplyScalar(dragK);
      p.prev.copy(p.position);

      // Split the step so the arc stays accurate over long flights. Tunnelling is
      // not the reason for substepping — the swept sphere below is analytic and
      // cannot miss a wall however thin — so a handful of slices is plenty.
      const frameTravel = p.velocity.length() * h;
      const maxAdvance = Math.max(4, p.radius * 40);
      const subCount = Math.max(1, Math.min(12, Math.ceil(frameTravel / maxAdvance)));
      let remaining = h;
      let dead = false;
      let guard = 0;
      while (remaining > 1e-6 && guard++ <= subCount + 2) {
        const speed = p.velocity.length();
        if (speed < EPS) break;
        const sh = Math.min(remaining, h / subCount);
        const travel = speed * sh;
        this._sweepDir.copy(p.velocity).multiplyScalar(1 / speed);
        const hit = this.collision.sweepSphere(p.position, this._sweepDir, travel, p.radius, this._hit);
        if (hit.hit) {
          // Copy everything we still need out of the shared hit record: the
          // callbacks below are free to run their own casts.
          const hnx = hit.nx, hny = hit.ny, hnz = hit.nz;
          const dirx = this._sweepDir.x, diry = this._sweepDir.y, dirz = this._sweepDir.z;
          p.position.set(hit.px, hit.py, hit.pz);
          p.distance += hit.t;
          if (p.impactImpulse > 0) {
            _v1.set(dirx, diry, dirz).multiplyScalar(p.impactImpulse);
            _v2.copy(p.position);
            _v3.set(dirx, diry, dirz);
            this.reportImpact(_v2, p.impactImpulse, _v3, p.radius + 0.3);
            this._pushBodiesAt(_v2, p.radius + 0.35, _v1);
          }
          if (this.onProjectileHit) this.onProjectileHit(p, hit);
          if (p.bounces > 0) {
            p.bounces--;
            _v3.set(hnx, hny, hnz);
            const vn = p.velocity.dot(_v3);
            p.velocity.addScaledVector(_v3, -vn * (1 + p.restitution));
            p.position.addScaledVector(_v3, 0.01);
            this._sweepDir.set(dirx, diry, dirz);
            remaining -= sh;
            continue;
          }
          dead = true;
          break;
        }
        p.position.addScaledVector(this._sweepDir, travel);
        p.distance += travel;
        remaining -= sh;
      }
      if (dead) this._despawnProjectile(i);
    }
  }

  /** Shove any dynamic bodies near a point (a projectile impact). */
  _pushBodiesAt(point, radius, impulse) {
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i];
      const dx = b.position.x - point.x;
      const dy = b.position.y - point.y;
      const dz = b.position.z - point.z;
      const reach = radius + b.boundRadius;
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
      this.wake(b);
      b.applyImpulse(impulse, point);
    }
    return this;
  }

  /**
   * Public form of the above: hand a hit point and an impulse vector and every
   * nearby body, ragdoll bone and breakable reacts.
   */
  applyPointImpulse(point, impulse, radius = 0.5) {
    const mag = Math.hypot(impulse.x, impulse.y, impulse.z);
    this._pushBodiesAt(point, radius, impulse);
    if (mag > 0) {
      _v2.set(impulse.x / mag, impulse.y / mag, impulse.z / mag);
      this.reportImpact(point, mag, _v2, radius);
    }
    return this;
  }

  /* ================================================================
     Ragdolls
     ================================================================ */

  /**
   * Build a ragdoll from a bone list. See the module docs / report for the exact
   * bone record shape. `opts`:
   *   { impulse, hitBone, blendTime, settleTimeout, maxLifetime, fadeTime,
   *     velocity, boneAxis, userData }
   * Returns a handle, or null if no ragdoll slot / body budget was available.
   */
  spawnRagdoll(boneList, opts = {}) {
    if (!boneList || boneList.length === 0) return null;
    while (this.ragdolls.length >= this.opt.maxRagdolls) {
      this.removeRagdoll(this.ragdolls[0]);
    }
    // Handles are never pooled: a caller may hold on to a dead one, and reviving
    // the object underneath it would silently hand them somebody else's corpse.
    const rag = new Ragdoll(this, ++this._ragdollSerial);
    rag.alive = true;
    rag.bones.length = 0;
    rag.joints.length = 0;
    rag.output.clear();
    rag.blend = 0;
    rag.blendTime = opts.blendTime ?? this.opt.ragdollBlendTime;
    rag.fade = 1;
    rag.settled = false;
    rag.settleTimer = 0;
    rag.age = 0;
    rag.settleTimeout = opts.settleTimeout ?? this.opt.ragdollSettleTimeout;
    rag.maxLifetime = opts.maxLifetime ?? this.opt.ragdollMaxLifetime;
    rag.fadeTime = opts.fadeTime ?? this.opt.ragdollFade;
    rag.userData = opts.userData ?? null;

    const group = 0x40000 + rag.id;
    const byName = new Map();

    for (let i = 0; i < boneList.length; i++) {
      const spec = boneList[i];
      const axisKey = spec.boneAxis || opts.boneAxis || 'y';
      const av = AXIS_VECTORS[axisKey] || AXIS_VECTORS.y;
      const length = spec.length ?? 0.25;
      const radius = spec.radius ?? Math.max(0.04, length * 0.28);
      _q1.set(spec.quaternion.x, spec.quaternion.y, spec.quaternion.z, spec.quaternion.w);
      // Bodies are always capsules along their own local +Y. If the incoming rig
      // runs bones down +X or +Z we fold that into a fixed offset rotation and
      // undo it on the way out, so the collision shape always matches the bone.
      const fix = new THREE.Quaternion();
      if (axisKey !== 'y') fix.setFromUnitVectors(_UP, _v1.set(av[0], av[1], av[2]));
      _q2.copy(_q1).multiply(fix);            // body orientation
      // The bone transform we are handed is the joint (proximal) end; the body
      // centre sits half a bone length along the bone axis.
      _v1.set(0, 1, 0).applyQuaternion(_q2);
      const body = this.spawnBody({
        shape: 'capsule',
        radius,
        length,
        position: {
          x: spec.position.x + _v1.x * length * 0.5,
          y: spec.position.y + _v1.y * length * 0.5,
          z: spec.position.z + _v1.z * length * 0.5,
        },
        quaternion: _q2,
        velocity: opts.velocity || null,
        mass: spec.mass ?? 4,
        surface: spec.surface || 'wood',
        friction: spec.friction ?? 0.85,
        restitution: spec.restitution ?? 0.05,
        linearDamping: 0.14,
        angularDamping: 0.35,
        kind: 'ragdoll',
        group,
        evictable: false,
        lifetime: Infinity,
        unstick: false,
      });
      if (!body) { // budget exhausted mid-build: unwind cleanly
        this._teardownRagdoll(rag);
        return null;
      }
      body._ragdoll = rag;
      body._bone = i;

      const bone = {
        name: spec.name || `bone${i}`,
        body,
        parent: -1,
        axis: new THREE.Vector3(0, 1, 0),   // body-local bone axis, always +Y
        fix,
        invFix: fix.clone().invert(),
        length,
        cone: spec.cone ?? 0.9,
        twist: spec.twist ?? 0.6,
      };
      rag.bones.push(bone);
      byName.set(bone.name, rag.bones.length - 1);

      const out = {
        name: bone.name,
        body,
        position: new THREE.Vector3(spec.position.x, spec.position.y, spec.position.z),
        quaternion: new THREE.Quaternion(_q1.x, _q1.y, _q1.z, _q1.w),
        animPosition: new THREE.Vector3(spec.position.x, spec.position.y, spec.position.z),
        animQuaternion: new THREE.Quaternion(_q1.x, _q1.y, _q1.z, _q1.w),
        simPosition: new THREE.Vector3(spec.position.x, spec.position.y, spec.position.z),
        simQuaternion: new THREE.Quaternion(_q1.x, _q1.y, _q1.z, _q1.w),
      };
      rag.output.set(bone.name, out);
      // Also hung off the bone record, so a per-frame loop over `rag.bones` needs
      // no Map lookup and no allocation.
      bone.out = out;
    }

    /* joints */
    for (let i = 0; i < boneList.length; i++) {
      const spec = boneList[i];
      if (!spec.parent) continue;
      const pi = byName.get(spec.parent);
      if (pi === undefined) continue;
      const bone = rag.bones[i];
      bone.parent = pi;
      const parent = rag.bones[pi];
      const childBody = bone.body;
      const parentBody = parent.body;

      // World anchor = the child's proximal end.
      _v1.copy(bone.axis).applyQuaternion(childBody.quaternion).multiplyScalar(-bone.length * 0.5);
      _v2.copy(childBody.position).add(_v1);

      const anchorChild = new THREE.Vector3().copy(_v1).applyQuaternion(
        _q2.copy(childBody.quaternion).invert(),
      );
      const anchorParent = new THREE.Vector3().subVectors(_v2, parentBody.position).applyQuaternion(
        _q3.copy(parentBody.quaternion).invert(),
      );
      // The child's rest direction, expressed in the parent's frame: the cone
      // limit is measured from this, so elbows and knees keep their rest pose.
      const restDir = new THREE.Vector3().copy(bone.axis)
        .applyQuaternion(childBody.quaternion)
        .applyQuaternion(_q2.copy(parentBody.quaternion).invert());
      const restRel = new THREE.Quaternion()
        .copy(parentBody.quaternion).invert().multiply(childBody.quaternion);

      rag.joints.push({
        a: parentBody, b: childBody,
        anchorA: anchorParent, anchorB: anchorChild,
        restDir, restRel,
        axisB: bone.axis,
        cone: bone.cone,
        twist: bone.twist,
      });
    }

    this.ragdolls.push(rag);

    if (opts.impulse) {
      const target = opts.hitBone && rag.output.has(opts.hitBone)
        ? rag.output.get(opts.hitBone).body
        : rag.bones[0].body;
      target.applyImpulse(opts.impulse);
    }
    this._writeRagdollOutput(rag);
    if (this.onRagdollSpawn) this.onRagdollSpawn(rag);
    return rag;
  }

  removeRagdoll(rag) {
    if (!rag || !rag.alive) return false;
    const i = this.ragdolls.indexOf(rag);
    if (i >= 0) this.ragdolls.splice(i, 1);
    rag.alive = false;
    if (this.onRagdollRemove) this.onRagdollRemove(rag);
    this._teardownRagdoll(rag);
    return true;
  }

  _teardownRagdoll(rag) {
    for (let i = 0; i < rag.bones.length; i++) {
      const body = rag.bones[i].body;
      body._ragdoll = null;
      body.evictable = true;
      this.removeBody(body);
    }
    rag.bones.length = 0;
    rag.joints.length = 0;
    rag.output.clear();
    rag.alive = false;
    rag.userData = null;
    const j = this.ragdolls.indexOf(rag);
    if (j >= 0) this.ragdolls.splice(j, 1);
  }

  /* ---- joint solve: ball socket + cone + twist, Gauss-Seidel ---- */
  _solveRagdoll(rag, h) {
    const joints = rag.joints;
    if (joints.length === 0 || rag.bones[0].body.sleeping) return; // island asleep
    for (let i = 0; i < joints.length; i++) {
      this._solveBallSocket(joints[i], h);
      if (joints[i].cone > 0) this._solveCone(joints[i], h);
      if (joints[i].twist > 0) this._solveTwist(joints[i], h);
    }
  }

  _solveBallSocket(j, h) {
    const a = j.a, b = j.b;
    // Anchor offsets are held in locals: effMassTerm and _impulseNoWake both use
    // the shared scratch, so nothing may survive a call inside the module ones.
    mat3Apply(a._rot, j.anchorA.x, j.anchorA.y, j.anchorA.z, _s1);
    const rax = _s1.x, ray = _s1.y, raz = _s1.z;
    mat3Apply(b._rot, j.anchorB.x, j.anchorB.y, j.anchorB.z, _s1);
    const rbx = _s1.x, rby = _s1.y, rbz = _s1.z;
    const ex = (b.position.x + rbx) - (a.position.x + rax);
    const ey = (b.position.y + rby) - (a.position.y + ray);
    const ez = (b.position.z + rbz) - (a.position.z + raz);

    // Three sequential scalar solves along the world axes. Cheap, and with a
    // handful of iterations it converges fine for near-equal bone masses.
    for (let axis = 0; axis < 3; axis++) {
      const nx = axis === 0 ? 1 : 0;
      const ny = axis === 1 ? 1 : 0;
      const nz = axis === 2 ? 1 : 0;
      const err = axis === 0 ? ex : (axis === 1 ? ey : ez);
      const wa = a.angularVelocity, wb = b.angularVelocity;
      const vax = a.velocity.x + wa.y * raz - wa.z * ray;
      const vay = a.velocity.y + wa.z * rax - wa.x * raz;
      const vaz = a.velocity.z + wa.x * ray - wa.y * rax;
      const vbx = b.velocity.x + wb.y * rbz - wb.z * rby;
      const vby = b.velocity.y + wb.z * rbx - wb.x * rbz;
      const vbz = b.velocity.z + wb.x * rby - wb.y * rbx;
      const rel = (vbx - vax) * nx + (vby - vay) * ny + (vbz - vaz) * nz;
      let k = effMassTerm(a, rax, ray, raz, nx, ny, nz);
      k += effMassTerm(b, rbx, rby, rbz, nx, ny, nz);
      if (k < EPS) continue;

      /* velocity part: hold the anchors together, no positional term */
      const lambda = -rel / k;
      b._impulseNoWake(nx * lambda, ny * lambda, nz * lambda, rbx, rby, rbz);
      a._impulseNoWake(-nx * lambda, -ny * lambda, -nz * lambda, rax, ray, raz);

      /* positional part: pseudo velocities only. A 900 kg torso against a
       * 130 kg leg cannot satisfy the joint exactly, and correcting the residual
       * through the real velocities is what makes a corpse walk itself across
       * the square instead of settling. */
      let bias = 0;
      if (err > JOINT_SLOP) bias = (0.35 / h) * (err - JOINT_SLOP);
      else if (err < -JOINT_SLOP) bias = (0.35 / h) * (err + JOINT_SLOP);
      if (bias === 0) continue;
      if (bias > 4) bias = 4; else if (bias < -4) bias = -4;
      const pa = a._pv, pb = b._pv, qa = a._pw, qb = b._pw;
      const pax2 = pa.x + qa.y * raz - qa.z * ray;
      const pay2 = pa.y + qa.z * rax - qa.x * raz;
      const paz2 = pa.z + qa.x * ray - qa.y * rax;
      const pbx2 = pb.x + qb.y * rbz - qb.z * rby;
      const pby2 = pb.y + qb.z * rbx - qb.x * rbz;
      const pbz2 = pb.z + qb.x * rby - qb.y * rbx;
      const relP = (pbx2 - pax2) * nx + (pby2 - pay2) * ny + (pbz2 - paz2) * nz;
      const lambdaP = -(relP + bias) / k;
      b._impulsePseudo(nx * lambdaP, ny * lambdaP, nz * lambdaP, rbx, rby, rbz);
      a._impulsePseudo(-nx * lambdaP, -ny * lambdaP, -nz * lambdaP, rax, ray, raz);
    }
  }

  _solveCone(j, h) {
    const a = j.a, b = j.b;
    mat3Apply(a._rot, j.restDir.x, j.restDir.y, j.restDir.z, _s1);   // rest dir, world
    mat3Apply(b._rot, j.axisB.x, j.axisB.y, j.axisB.z, _s2);         // current dir, world
    let dot = _s1.x * _s2.x + _s1.y * _s2.y + _s1.z * _s2.z;
    if (dot > 1) dot = 1; else if (dot < -1) dot = -1;
    const angle = Math.acos(dot);
    const C = angle - j.cone;
    if (C <= 0) return;
    // Rotating the child about n = normalize(rest × current) increases the angle.
    let nx = _s1.y * _s2.z - _s1.z * _s2.y;
    let ny = _s1.z * _s2.x - _s1.x * _s2.z;
    let nz = _s1.x * _s2.y - _s1.y * _s2.x;
    let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-6) {
      // Folded back on itself: any perpendicular axis will do.
      nx = Math.abs(_s1.y) < 0.9 ? -_s1.z : 1;
      ny = 0;
      nz = Math.abs(_s1.y) < 0.9 ? _s1.x : 0;
      nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (nl < 1e-6) return;
    }
    const inv = 1 / nl;
    nx *= inv; ny *= inv; nz *= inv;
    this._angularLimit(a, b, nx, ny, nz, C, h);
  }

  _solveTwist(j, h) {
    const a = j.a, b = j.b;
    _q1.copy(a.quaternion).invert().multiply(b.quaternion);   // current relative
    _q2.copy(j.restRel).invert().multiply(_q1);               // deviation from rest
    const ax = j.axisB.x, ay = j.axisB.y, az = j.axisB.z;
    const proj = _q2.x * ax + _q2.y * ay + _q2.z * az;
    const twist = 2 * Math.atan2(proj, _q2.w);
    const over = Math.abs(twist) - j.twist;
    if (over <= 0) return;
    mat3Apply(b._rot, ax, ay, az, _s2);
    const s = twist > 0 ? 1 : -1;
    this._angularLimit(a, b, _s2.x * s, _s2.y * s, _s2.z * s, over, h);
  }

  /**
   * One-sided angular constraint: keep (ωB − ωA)·n from growing C past zero.
   * The positional part gets an angular slop, exactly like contacts do: a joint
   * parked a hair past its limit must stop generating correction velocity, or the
   * corpse never gets quiet enough to sleep.
   */
  _angularLimit(a, b, nx, ny, nz, C, h) {
    applyInvInertia(a, nx, ny, nz, _s1);
    let k = _s1.x * nx + _s1.y * ny + _s1.z * nz;
    applyInvInertia(b, nx, ny, nz, _s1);
    k += _s1.x * nx + _s1.y * ny + _s1.z * nz;
    if (k < EPS) return;

    /* velocity part: stop the joint bending any further past the limit */
    const wa = a.angularVelocity, wb = b.angularVelocity;
    const rel = (wb.x - wa.x) * nx + (wb.y - wa.y) * ny + (wb.z - wa.z) * nz;
    const lambda = -rel / k;
    if (lambda < 0) {
      applyInvInertia(b, nx * lambda, ny * lambda, nz * lambda, _s1);
      wb.x += _s1.x; wb.y += _s1.y; wb.z += _s1.z;
      applyInvInertia(a, -nx * lambda, -ny * lambda, -nz * lambda, _s1);
      wa.x += _s1.x; wa.y += _s1.y; wa.z += _s1.z;
    }

    /* positional part: ease it back inside, through the pseudo velocities. A
     * limb held past its limit by the ground would otherwise be a permanent
     * energy source, and the corpse would propel itself along. */
    const over = C - ANGULAR_SLOP;
    if (over <= 0) return;
    let bias = (0.25 / h) * over;
    if (bias > 4) bias = 4;
    const pa = a._pw, pb = b._pw;
    const relP = (pb.x - pa.x) * nx + (pb.y - pa.y) * ny + (pb.z - pa.z) * nz;
    const lambdaP = -(relP + bias) / k;
    if (lambdaP > 0) return;
    applyInvInertia(b, nx * lambdaP, ny * lambdaP, nz * lambdaP, _s1);
    pb.x += _s1.x; pb.y += _s1.y; pb.z += _s1.z;
    applyInvInertia(a, -nx * lambdaP, -ny * lambdaP, -nz * lambdaP, _s1);
    pa.x += _s1.x; pa.y += _s1.y; pa.z += _s1.z;
  }

  _updateRagdoll(rag, h) {
    rag.age += h;
    if (rag.blend < 1) {
      rag.blend += h / Math.max(1e-3, rag.blendTime);
      if (rag.blend > 1) rag.blend = 1;
    }
    const asleep = rag.bones.length > 0 && rag.bones[0].body.sleeping;
    rag.settled = asleep;
    if (asleep) rag.settleTimer += h; else rag.settleTimer = 0;

    this._writeRagdollOutput(rag);

    if (rag.settleTimer > rag.settleTimeout || rag.age > rag.maxLifetime) {
      rag.fade -= h / Math.max(0.05, rag.fadeTime);
      if (rag.fade <= 0) { this.removeRagdoll(rag); return; }
    }
  }

  _writeRagdollOutput(rag) {
    // Simulated pose → joint-origin transforms, blended out of the animated
    // pose we were handed so the body never snaps on death.
    const w = rag.blend < 1 ? smoothstep(rag.blend) : 1;
    for (let i = 0; i < rag.bones.length; i++) {
      const bone = rag.bones[i];
      const body = bone.body;
      const out = rag.output.get(bone.name);
      _v1.copy(bone.axis).applyQuaternion(body.quaternion).multiplyScalar(-bone.length * 0.5);
      out.simPosition.copy(body.position).add(_v1);
      out.simQuaternion.copy(body.quaternion).multiply(bone.invFix);
      if (w >= 1) {
        out.position.copy(out.simPosition);
        out.quaternion.copy(out.simQuaternion);
      } else {
        out.position.copy(out.animPosition).lerp(out.simPosition, w);
        out.quaternion.copy(out.animQuaternion).slerp(out.simQuaternion, w);
      }
    }
  }

  /* ================================================================
     Debug / instrumentation
     ================================================================ */
  stats() {
    let awake = 0;
    for (let i = 0; i < this.bodies.length; i++) if (!this.bodies[i].sleeping) awake++;
    return {
      bodies: this.bodies.length,
      awake,
      sleeping: this.bodies.length - awake,
      capacity: this.opt.maxBodies,
      ragdolls: this.ragdolls.length,
      breakables: this.breakables.length,
      projectiles: this.projectiles.length,
      contacts: this._contactCount,
      fixedSteps: this._steps,
      lastStepMs: Math.round(this._lastStepMs * 1000) / 1000,
    };
  }
}

/** Alias — the lead may prefer this name in main.js. */
export const RigidBodySystem = PhysicsWorld;

/* ------------------------------------------------------------------ *
 * Impulse application that does not wake a body: the solver calls this
 * thousands of times and must not fight the sleep bookkeeping.
 * ------------------------------------------------------------------ */
Body.prototype._impulseNoWake = function (ix, iy, iz, rx, ry, rz) {
  this.velocity.x += ix * this.invMass;
  this.velocity.y += iy * this.invMass;
  this.velocity.z += iz * this.invMass;
  const tx = ry * iz - rz * iy;
  const ty = rz * ix - rx * iz;
  const tz = rx * iy - ry * ix;
  applyInvInertia(this, tx, ty, tz, _s2);
  this.angularVelocity.x += _s2.x;
  this.angularVelocity.y += _s2.y;
  this.angularVelocity.z += _s2.z;
};

/** The same, into the pseudo velocities: position correction only, no energy. */
Body.prototype._impulsePseudo = function (ix, iy, iz, rx, ry, rz) {
  this._pv.x += ix * this.invMass;
  this._pv.y += iy * this.invMass;
  this._pv.z += iz * this.invMass;
  const tx = ry * iz - rz * iy;
  const ty = rz * ix - rx * iz;
  const tz = rx * iy - ry * ix;
  applyInvInertia(this, tx, ty, tz, _s2);
  this._pw.x += _s2.x;
  this._pw.y += _s2.y;
  this._pw.z += _s2.z;
};

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function smoothstep(t) {
  const x = t < 0 ? 0 : (t > 1 ? 1 : t);
  return x * x * (3 - 2 * x);
}

function randomQuat(rng, q) {
  // Shoemake's uniform random quaternion, off the project Rng.
  const u1 = rng.next(), u2 = rng.next(), u3 = rng.next();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  q.set(
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3),
  );
  return q;
}

/**
 * Pre-fracture a box into `count` chunks by repeatedly splitting the largest
 * piece along its longest axis. Deterministic for a given Rng, and cheap — but
 * it only ever runs at registration time, never when something breaks.
 * Returns [{ ox, oy, oz, hx, hy, hz }] offsets relative to the prop centre.
 */
export function fracture(size, count, rng) {
  const pieces = [{
    ox: 0, oy: 0, oz: 0,
    hx: Math.max(0.02, size.x * 0.5),
    hy: Math.max(0.02, size.y * 0.5),
    hz: Math.max(0.02, size.z * 0.5),
  }];
  const target = Math.max(1, Math.min(24, count | 0));
  while (pieces.length < target) {
    // Split the biggest piece: keeps chunk sizes even.
    let bi = 0;
    let bv = -1;
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const v = p.hx * p.hy * p.hz;
      if (v > bv) { bv = v; bi = i; }
    }
    const p = pieces[bi];
    const axis = p.hx >= p.hy && p.hx >= p.hz ? 0 : (p.hy >= p.hz ? 1 : 2);
    const full = axis === 0 ? p.hx * 2 : (axis === 1 ? p.hy * 2 : p.hz * 2);
    const cut = full * rng.float(0.35, 0.65);
    const loHalf = cut * 0.5;
    const hiHalf = (full - cut) * 0.5;
    const lo = { ox: p.ox, oy: p.oy, oz: p.oz, hx: p.hx, hy: p.hy, hz: p.hz };
    const hi = { ox: p.ox, oy: p.oy, oz: p.oz, hx: p.hx, hy: p.hy, hz: p.hz };
    if (axis === 0) {
      lo.hx = loHalf; hi.hx = hiHalf;
      lo.ox = p.ox - p.hx + loHalf; hi.ox = p.ox + p.hx - hiHalf;
    } else if (axis === 1) {
      lo.hy = loHalf; hi.hy = hiHalf;
      lo.oy = p.oy - p.hy + loHalf; hi.oy = p.oy + p.hy - hiHalf;
    } else {
      lo.hz = loHalf; hi.hz = hiHalf;
      lo.oz = p.oz - p.hz + loHalf; hi.oz = p.oz + p.hz - hiHalf;
    }
    pieces[bi] = lo;
    pieces.push(hi);
  }
  return pieces;
}

const _perf = typeof performance !== 'undefined' && performance.now
  ? performance
  : { now: () => Date.now() };
function now() {
  return _perf.now();
}
