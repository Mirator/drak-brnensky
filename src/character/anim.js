import * as THREE from 'three';
import { solveTwoBone, damp, angleDelta, springStep } from './rig.js';

/* ==================================================================
   Procedural animation.

   Layers, applied in this order every frame:
     1. locomotion clock       gait phase from real horizontal speed
     2. foot placement         world-locked plants, swing arcs, ground
                               sampling under each foot (no skating)
     3. pelvis / root          bob, sway, counter-rotation, lean springs
     4. spine + aim layer      upper body aims at cmd.aimPoint
                               independently of the legs
     5. leg IK                 analytic 2-bone to the planted ankles
     6. weapon                 placed relative to the chest, pointed at
                               the aim point, recoil spring
     7. arm IK                 both hands solved to the weapon grips,
                               overridden by reload / melee scripts
     8. head                   stabilised against the bob, looks along
                               the aim
     9. cloth                  verlet skirt + scarf

   Everything writes only local position/quaternion on bones, so a
   ragdoll layer can take the same transforms over later.
   ================================================================== */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const SPRINT_SPEED = 9.8;
/** How far a planted foot may sweep along the ground. Bounded by the leg. */
const MAX_SWEEP = 0.85;

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _e = new THREE.Euler();
const _mb = new THREE.Matrix4();
const _ax = new THREE.Vector3();
const _ay = new THREE.Vector3();
const _az = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _sc = new THREE.Vector3();
const _outL = { midQuat: new THREE.Quaternion() };
const _outR = { midQuat: new THREE.Quaternion() };
const _outLegL = { midQuat: new THREE.Quaternion() };
const _outLegR = { midQuat: new THREE.Quaternion() };

function makeFoot(side) {
  return {
    side,
    pos: new THREE.Vector3(),
    from: new THREE.Vector3(),
    to: new THREE.Vector3(),
    ankle: new THREE.Vector3(),
    stance: true,
    pitch: 0,
    yaw: 0,
    lift: 0,
    load: 1,
  };
}

export class CharacterAnimator {
  constructor(rig, weapon, cloth, opts = {}) {
    this.rig = rig;
    this.B = rig.byName;
    this.dims = rig.dims;
    this.weapon = weapon;
    this.cloth = cloth;
    this.collision = opts.collision || null;
    this.object = opts.object;
    this.sprintSpeed = opts.sprintSpeed || SPRINT_SPEED;

    this.gait = 0;
    this.standBlend = 1;
    this.airBlend = 0;
    this.feet = [makeFoot(-1), makeFoot(1)];
    this.stepEvents = [];
    this._initFeet = false;

    this.speedS = 0;
    this.runS = 0;
    this.fwdS = 0;
    this.strafeS = 0;
    this.accS = new THREE.Vector3();
    this.leanF = { x: 0, v: 0 };
    this.leanS = { x: 0, v: 0 };
    this.bankS = { x: 0, v: 0 };
    this.pelvisLocalY = this.dims.hipY + 0.02;
    this.pelvisSway = 0;
    this.landDip = { x: 0, v: 0 };
    this.rise = { x: 0, v: 0 };
    this.kick = { x: 0, v: 0 };

    this.aimYaw = 0;
    this.aimPitch = 0;
    this.headYaw = 0;
    this.headPitch = 0;
    this.hipYaw = 0;

    this.flinch = 0;
    this.flinchX = 0;
    this.flinchZ = 0;
    this.stagger = 0;

    this.leftHand = new THREE.Vector3();     // chest space
    this.leftHandWorld = new THREE.Vector3();
    this.leftHandInit = false;
    this.deadT = 0;
    this.deathTilt = 0;

    this.restHead = this.B.head.position.clone();
    this.restNeck = this.B.neck.position.clone();
  }

  /* ---------------------------------------------------------------- */
  /** Directional flinch impulse. `dirLocal` = (right, forward) in the
   *  character's own frame, magnitude 0..1. */
  hit(dirLocal, heavy) {
    this.flinch = 1;
    this.flinchX = dirLocal.x;
    this.flinchZ = dirLocal.y;
    if (heavy) this.stagger = 1;
  }

  /** A shot went off: kick the shoulder and raise the muzzle. */
  fired() {
    this.rise.v += 6.4;
    this.kick.v += 9.0;
  }

  /** Drop every plant to a clean stance under the body (spawn / land). */
  resetStance(pos, facing) {
    const cs = Math.cos(facing), sn = Math.sin(facing);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const lx = f.side * this.dims.hipX * 1.15;
      const lz = f.side < 0 ? 0.06 : -0.06;
      const x = pos.x + cs * lx + sn * lz;
      const z = pos.z - sn * lx + cs * lz;
      f.pos.set(x, this.collision ? this.ground(x, z, pos.y) : pos.y, z);
      f.from.copy(f.pos);
      f.to.copy(f.pos);
      f.stance = true;
      f.pitch = 0;
      f.lift = 0;
      f.load = 1;
      f.yaw = facing + f.side * 0.075;
      f.ankle.set(f.pos.x, f.pos.y + this.dims.ankleY, f.pos.z);
    }
    this.gait = 0;
    this._initFeet = true;
  }

  /**
   * Full state reset. Used for a new run and for a respawn — never on a
   * landing. The caller must have the rig on its bind pose and the object's
   * world matrices already updated at the new position, because the cloth
   * re-settles against the bone world matrices.
   */
  reset(pos, facing) {
    this.resetStance(pos, facing);
    this.stepEvents.length = 0;
    this.deadT = 0;
    this.deathTilt = 0;
    this.rise.x = this.rise.v = 0;
    this.kick.x = this.kick.v = 0;
    this.landDip.x = this.landDip.v = 0;
    this.leanF.x = this.leanF.v = 0;
    this.leanS.x = this.leanS.v = 0;
    this.bankS.x = this.bankS.v = 0;
    this.flinch = 0;
    this.flinchX = 0;
    this.flinchZ = 0;
    this.stagger = 0;
    this.speedS = this.runS = this.fwdS = this.strafeS = 0;
    this.speed = 0;
    this.stepLen = 0.7;
    this.accS.set(0, 0, 0);
    this.standBlend = 1;
    this.airBlend = 0;
    this.aimYaw = this.aimPitch = 0;
    this.headYaw = this.headPitch = 0;
    this.hipYaw = 0;
    this.pelvisLocalY = this.dims.hipY + 0.02;
    this.pelvisSway = 0;
    this.leftHand.set(0, 0, 0);
    this.leftHandWorld.set(0, 0, 0);
    this.leftHandInit = false;
    this.B.head.position.copy(this.restHead);
    this.B.neck.position.copy(this.restNeck);

    // weapon back to a seated magazine and no recoil offset
    const W = this.weapon;
    if (W) {
      W.recoil.position.set(0, 0, 0);
      W.recoil.quaternion.identity();
      W.magHome.position.set(0, -0.112, 0.028);
      W.magHome.rotation.set(0.06, 0, 0);
      W.mag.scale.setScalar(1);
    }

    if (this.cloth) this.cloth.reset();
  }

  /* ---------------------------------------------------------------- */
  update(dt, s) {
    dt = Math.min(dt, 1 / 15);
    this.stepEvents.length = 0;
    const cs = Math.cos(s.facing);
    const sn = Math.sin(s.facing);
    if (!this._initFeet) this.resetStance(s.pos, s.facing);

    this.flinch = Math.max(0, this.flinch - dt * 3.2);
    this.stagger = Math.max(0, this.stagger - dt * 1.9);
    springStep(this.rise, 0, 150, 17, dt);
    springStep(this.kick, 0, 320, 26, dt);

    /* A ragdoll layer owns the bone transforms: we stop posing entirely but
     * keep simulating the coat and scarf over whatever it produces. */
    if (s.ragdoll) {
      this.object.updateMatrixWorld(true);
      this.updateCloth(dt, s);
      return;
    }

    if (!s.alive) {
      this.deadT += dt;
      this.poseDeath(dt, s);
      this.updateCloth(dt, s);
      return;
    }

    this.drivers(dt, s, cs, sn);
    this.locomotion(dt, s, cs, sn);
    this.poseRoot(dt, s, cs, sn);
    this.poseSpine(dt, s);
    this.object.updateMatrixWorld(true);
    this.poseLegs(dt, s, cs, sn);
    this.poseWeapon(dt, s, cs, sn);
    this.poseArms(dt, s, cs, sn);
    this.poseHead(dt, s);
    this.object.updateMatrixWorld(true);
    this.updateCloth(dt, s);
  }

  /* ---- 1. drivers ------------------------------------------------ */
  drivers(dt, s, cs, sn) {
    const speed = Math.hypot(s.vel.x, s.vel.z);
    this.speed = speed;
    this.speedS = damp(this.speedS, speed, 13, dt);
    this.runS = damp(this.runS, clamp01(speed / this.sprintSpeed), 8, dt);

    /* The lean is driven by (wanted velocity - actual velocity), which is
     * the same signal the controller accelerates along. A finite-difference
     * acceleration would NOT be frame-rate invariant — (v(t)-v(t-h))/h of an
     * exponential approach is off by (1-e^-kh)/kh, a 25% error between 30 Hz
     * and 144 Hz — and that error would show up directly as a different lean. */
    _p.set(s.wishX - s.vel.x, 0, s.wishZ - s.vel.z);
    this.accS.lerp(_p, 1 - Math.exp(-11 * dt));

    // local frame components (forward is -Z)
    const lvx = cs * s.vel.x - sn * s.vel.z;
    const lvz = sn * s.vel.x + cs * s.vel.z;
    this.fwdS = damp(this.fwdS, -lvz, 10, dt);
    this.strafeS = damp(this.strafeS, lvx, 10, dt);

    const lax = cs * this.accS.x - sn * this.accS.z;
    const laz = sn * this.accS.x + cs * this.accS.z;

    // running leans in, a backpedal leans back out of it
    const runLean = this.runS * 0.16 + clamp(-laz, -6, 12) * 0.020
      + clamp(this.fwdS, -6, 0) * 0.016;
    springStep(this.leanF, clamp(runLean, -0.22, 0.34), 110, 15, dt);
    springStep(this.leanS, clamp(lax * -0.022 + this.strafeS * -0.010, -0.24, 0.24), 110, 15, dt);
    // bank into a curving sprint
    springStep(this.bankS, clamp(s.turnRate * this.speedS * -0.030, -0.30, 0.30), 90, 14, dt);

    springStep(this.landDip, 0, 150, 19, dt);
    if (s.landImpact > 0) this.landDip.v += clamp(s.landImpact * 0.28, 0.6, 12);
  }

  /* ---- 2. locomotion clock + foot placement ---------------------- */
  locomotion(dt, s, cs, sn) {
    const speed = this.speed;
    const run = this.runS;

    /* Gait model. Cadence rises slowly with speed and stride length does
     * the rest, the way human locomotion actually works. The duty factor
     * (fraction of the cycle a foot is planted) is then pinned by how far
     * a 0.84 m leg can actually sweep while it stays on the ground — which
     * is what forces a real sprint down to ~20% ground contact. */
    const cadence = clamp(1.6 + 0.30 * speed, 1.3, 4.6); // steps / second
    const stepLen = speed > 0.4 ? speed / cadence : 0.7;
    const cyc = speed > 0.40 ? cadence * 0.5 : 0;        // stride cycles / second
    const travel = Math.min(2 * lerp(0.60, 0.30, run) * stepLen, MAX_SWEEP);
    const duty = clamp(travel / (2 * stepLen), 0.18, 0.62);
    // how far in front of the hip the ankle lands
    const lead = lerp(0.30, 0.14, run);
    this.stepLen = stepLen;
    const wasStanding = this.standBlend > 0.85;
    this.standBlend = damp(this.standBlend, cyc > 0 ? 0 : 1, 8, dt);

    // teleport / hard collision push: a plant this far away can never be
    // reached, so drop back to a clean stance instead of folding the pelvis
    const far = this.dims.legLength * 1.7;
    for (const f of this.feet) {
      if (Math.hypot(f.pos.x - s.pos.x, f.pos.z - s.pos.z) > far) {
        this.resetStance(s.pos, s.facing);
        break;
      }
    }

    const airTarget = s.onGround ? 0 : 1;
    const wasAir = this.airBlend > 0.5;
    this.airBlend = damp(this.airBlend, airTarget, s.onGround ? 16 : 11, dt);
    if (wasAir && s.onGround) this.resetStance(s.pos, s.facing);

    if (cyc > 0) {
      if (wasStanding) this.gait = duty * 0.998;
      this.gait = (this.gait + dt * cyc) % 1;
    }

    const swingTime = cyc > 0 ? (1 - duty) / cyc : 0.3;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const ph = (this.gait + 0.5 * i) % 1;
      const stance = cyc <= 0 ? true : ph < duty;

      if (f.stance && !stance) {
        // lift off
        f.from.copy(f.pos);
        this.stepTarget(f, s, cs, sn, swingTime, lead, _tgt);
        f.to.copy(_tgt);
      } else if (!f.stance && stance) {
        f.pos.copy(f.to);
        if (s.onGround) this.stepEvents.push(clamp01(speed / this.sprintSpeed));
      }
      f.stance = stance;

      if (stance) {
        if (cyc <= 0) {
          // relaxed idle stance, one foot slightly back
          const lx = f.side * this.dims.hipX * 1.16;
          const lz = f.side < 0 ? 0.055 : -0.045;
          _tgt.set(s.pos.x + cs * lx + sn * lz, 0, s.pos.z - sn * lx + cs * lz);
          _tgt.y = this.ground(_tgt.x, _tgt.z, s.pos.y);
          f.pos.lerp(_tgt, 1 - Math.exp(-9 * dt));
        }
        // heel strike -> flat -> toe off across the stance phase
        const u = duty > 1e-4 ? clamp01(ph / duty) : 0;
        let pitch = 0;
        if (u < 0.18) pitch = lerp(0.20 + run * 0.16, 0, smooth(u / 0.18));
        else if (u > 0.60) pitch = -smooth((u - 0.60) / 0.40) * (0.30 + run * 0.34);
        f.pitch = damp(f.pitch, pitch * (1 - this.standBlend), 22, dt);
        // the heel comes off the ground: the ankle rises while the toe stays
        // planted, which is what stops the pelvis being dragged down at the
        // end of a long stride.
        const heel = u > 0.55 ? smooth((u - 0.55) / 0.45) * (0.025 + 0.085 * run) : 0;
        f.lift = heel * (1 - this.standBlend);
        // Load ramps in and out smoothly at both ends of the stance. That
        // keeps the pelvis constraint continuous, which is what lets the
        // pelvis height be fully analytic (see poseRoot) instead of filtered
        // — a filter on a 9 Hz bob aliases differently at 30 Hz and 144 Hz.
        f.load = u < 0.12 ? smooth(u / 0.12)
          : (u > 0.50 ? 1 - smooth((u - 0.50) / 0.50) : 1);
      } else {
        const sw = clamp01((ph - duty) / (1 - duty));
        const es = smooth(sw);
        f.load = 0;
        /* Re-aim the landing point every frame using the *remaining* swing
         * time. Predicting it once at lift-off leaves the foot up to a
         * frame-quantisation of body travel behind (0.2 m at 30 Hz), which is
         * exactly the kind of thing that makes 30 Hz and 144 Hz differ. As
         * the remaining time goes to zero the target becomes a fixed world
         * point, so this converges regardless of frame rate. */
        const remain = cyc > 0 ? (1 - ph) / cyc : 0;
        this.stepTarget(f, s, cs, sn, remain, lead, _tgt);
        f.to.lerp(_tgt, 1 - Math.exp(-16 * dt));
        f.pos.lerpVectors(f.from, f.to, es);
        const rise = Math.max(0, f.to.y - f.from.y);
        f.lift = Math.sin(Math.PI * sw) * (0.055 + 0.13 * run + rise * 0.35);
        // toe stays down leaving the ground, comes up for clearance, levels to land
        const pitch = sw < 0.30
          ? lerp(-(0.28 + run * 0.30), 0.16, smooth(sw / 0.30))
          : lerp(0.16, 0.14 + run * 0.10, smooth((sw - 0.30) / 0.70));
        f.pitch = damp(f.pitch, pitch, 20, dt);
      }
      // feet point where the body is going, with a little toe-out
      const travel = this.speedS > 0.6 ? Math.atan2(-s.vel.x, -s.vel.z) : s.facing;
      const yawT = s.facing + clamp(angleDelta(travel, s.facing), -0.55, 0.55) * 0.55
        + f.side * 0.075;
      f.yaw += angleDelta(yawT, f.yaw) * (1 - Math.exp(-(f.stance ? 6 : 15) * dt));
    }
  }

  stepTarget(f, s, cs, sn, swingTime, lead, out) {
    const hipX = this.dims.hipX;
    const t = Math.min(swingTime, 0.60);
    // Where the hip will be when this foot lands. Everything else is an
    // offset *from that* point, in the character's own frame — clamping the
    // offset against the current position instead would leave the foot
    // metres behind the body at sprint speed.
    const hx = s.pos.x + s.vel.x * t;
    const hz = s.pos.z + s.vel.z * t;
    const speed = this.speed;
    let lx = f.side * hipX;
    let lz = 0;
    if (speed > 0.3) {
      const dx = s.vel.x / speed;
      const dz = s.vel.z / speed;
      lx += (cs * dx - sn * dz) * lead;
      lz += (sn * dx + cs * dz) * lead;
    }
    // keep each foot on its own side of the midline: no crossed legs strafing
    const lo = hipX * 0.55;
    const hi = hipX + 0.34;
    lx = f.side < 0 ? clamp(lx, -hi, -lo) : clamp(lx, lo, hi);
    const maxR = this.dims.legLength * 0.66;
    const d = Math.hypot(lx, lz);
    if (d > maxR) { lx *= maxR / d; lz *= maxR / d; }

    const x = hx + cs * lx + sn * lz;
    const z = hz - sn * lx + cs * lz;
    out.set(x, this.ground(x, z, s.pos.y), z);
  }

  ground(x, z, fromY) {
    if (!this.collision) return 0;
    return this.collision.groundHeight(x, z, fromY + 0.65, 0.16, 0.85);
  }

  /* ---- 3. pelvis ------------------------------------------------- */
  poseRoot(dt, s, cs, sn) {
    const hips = this.B.hips;
    const run = this.runS;
    const active = 1 - this.standBlend;
    const g2 = this.gait * Math.PI * 2;

    const bobAmp = (0.010 + 0.030 * run) * active;
    const bob = -Math.cos((this.gait - 0.08) * Math.PI * 4) * bobAmp;
    const sway = Math.sin(g2) * (0.010 + 0.020 * run) * active;
    // breathing / idle weight shift when standing
    const idle = this.standBlend * (1 - this.airBlend);
    const breath = Math.sin(s.time * 1.35) * 0.005 * idle;
    const shift = Math.sin(s.time * 0.42) * 0.016 * idle;

    this.hipYaw = -Math.sin(g2) * (0.05 + 0.13 * run) * active;
    const hipRoll = Math.sin(g2) * (0.03 + 0.055 * run) * active;

    let py = this.dims.hipY + 0.020 + bob + breath
      - this.landDip.x * 0.42
      - this.airBlend * 0.035
      - this.stagger * 0.055;

    /* Never let a *loaded* leg over-extend: drop the pelvis instead. A foot
     * in the last third of its stance is deliberately exempt — there the IK
     * clamp is allowed to lift the heel off the plant, which is exactly what
     * a real toe-off looks like and keeps the pelvis from being dragged
     * down by the trailing leg. */
    const maxLeg = this.dims.legLength * 0.985;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (!(f.load > 0.02) || this.airBlend > 0.5) continue;
      const lx = f.side * this.dims.hipX;
      const hx = s.pos.x + cs * (sway + lx);
      const hz = s.pos.z - sn * (sway + lx);
      const ankleY = f.pos.y + f.lift + this.dims.ankleY;
      const horiz = Math.hypot(hx - f.pos.x, hz - f.pos.z);
      const allowed = horiz < maxLeg ? Math.sqrt(maxLeg * maxLeg - horiz * horiz) : 0.05;
      const cap = (ankleY + allowed) - s.pos.y + 0.020;
      if (cap < py) py = lerp(py, cap, f.load);
    }
    // No filter here on purpose: everything feeding `py` is either analytic
    // in the gait phase or a C1-continuous leg constraint, so the pelvis
    // height is identical at every frame rate.
    this.pelvisLocalY = Math.max(py, this.dims.hipY * 0.60);
    this.pelvisSway = sway;

    hips.position.set(
      sway + shift + this.flinch * this.flinchX * 0.035,
      this.pelvisLocalY,
      this.leanF.x * -0.045 + this.flinch * this.flinchZ * 0.030,
    );
    _e.set(
      this.leanF.x * 0.34 + this.airBlend * -0.10 + this.landDip.x * 0.22,
      this.hipYaw,
      hipRoll + this.leanS.x * 0.5 + this.bankS.x,
      'YXZ',
    );
    hips.quaternion.setFromEuler(_e);
  }

  /* ---- 4. spine + aim layer ------------------------------------- */
  poseSpine(dt, s) {
    const B = this.B;
    // approximate chest world height for the aim solve
    const chestY = s.pos.y + this.pelvisLocalY + (this.rig.rest.chest.y - this.rig.rest.hips.y);
    const dx = s.aimPoint.x - s.pos.x;
    const dz = s.aimPoint.z - s.pos.z;
    const dy = s.aimPoint.y - chestY;
    const horiz = Math.hypot(dx, dz);
    const wantYaw = horiz > 0.05 ? angleDelta(Math.atan2(-dx, -dz), s.facing) : 0;
    const wantPitch = horiz > 0.05 ? Math.atan2(dy, horiz) : 0;
    const rate = s.aimBlend > 0.3 ? 20 : 11;
    this.aimYaw = damp(this.aimYaw, clamp(wantYaw, -1.15, 1.15), rate, dt);
    this.aimPitch = damp(this.aimPitch, clamp(wantPitch, -0.85, 0.95), rate, dt);

    const aim = s.aimBlend;
    const twist = this.aimYaw * (0.34 + 0.42 * aim);
    // shoulders counter-rotate against the hips while running
    const counter = -this.hipYaw * 1.55;
    /* Shooting stance: the support shoulder squares forward and the firing
     * shoulder rolls back. Without this the left arm simply cannot reach a
     * fore-grip that is 0.45 m in front of a 0.55 m arm. */
    const stance = -(0.10 + 0.16 * aim);
    const pitch = this.aimPitch * (0.16 + 0.34 * aim) - this.rise.x * 0.030;
    const lean = this.leanF.x;
    const side = this.leanS.x * 0.55 + this.bankS.x * 0.5;
    const fl = this.flinch * this.flinch;

    const set = (bone, x, y, z) => {
      _e.set(x, y, z, 'YXZ');
      bone.quaternion.setFromEuler(_e);
    };

    set(B.spine1,
      lean * 0.30 + pitch * 0.16 + this.landDip.x * 0.16 - fl * this.flinchZ * 0.22,
      twist * 0.16 + counter * 0.22,
      side * 0.32 - fl * this.flinchX * 0.16);
    set(B.spine2,
      lean * 0.26 + pitch * 0.24 - fl * this.flinchZ * 0.26 + this.stagger * -0.10,
      twist * 0.30 + counter * 0.34 + stance * 0.30,
      side * 0.34 - fl * this.flinchX * 0.20);
    set(B.chest,
      lean * 0.16 + pitch * 0.34 + Math.sin(s.time * 1.35) * 0.014 * this.standBlend
      - fl * this.flinchZ * 0.30 + this.stagger * -0.12,
      twist * 0.54 + counter * 0.44 + stance * 0.70,
      side * 0.30 - fl * this.flinchX * 0.24);

    // clavicles: support shoulder forward, firing shoulder back and shrugged
    const shrug = this.kick.x * 0.012 + fl * 0.10;
    set(B.clavR, -this.kick.x * 0.020, stance * 0.70, -0.06 * aim - shrug);
    set(B.clavL, 0, stance * 1.35, 0.05 * aim + shrug * 0.6);
  }

  /* ---- 5. legs --------------------------------------------------- */
  poseLegs(dt, s, cs, sn) {
    const chains = [
      ['legLU', 'legLL', 'footL', 'toeL', 0, _outLegL],
      ['legRU', 'legRL', 'footR', 'toeR', 1, _outLegR],
    ];
    const air = this.airBlend;
    const fall = clamp01(-s.vel.y / 6);

    for (const [uName, lName, fName, tName, i, out] of chains) {
      const f = this.feet[i];
      const U = this.B[uName];
      const L = this.B[lName];

      // planted target
      _tgt.set(f.pos.x, f.pos.y + f.lift + this.dims.ankleY, f.pos.z);

      if (air > 0.001) {
        // airborne: tuck on the way up, reach on the way down
        _p.setFromMatrixPosition(U.matrixWorld);
        const ly = lerp(-0.50, -0.76, fall);
        const lz = lerp(-0.20, 0.02, fall) + (i ? -0.05 : 0.05);
        const lx = f.side * 0.03;
        _q.set(
          _p.x + cs * lx + sn * lz,
          _p.y + ly,
          _p.z - sn * lx + cs * lz,
        );
        _tgt.lerp(_q, air);
      }
      f.ankle.copy(_tgt);

      // the knee bulges forward and slightly out
      this.dirToWorld(f.side * 0.20, 0.22, -1, _pole, cs, sn);
      solveTwoBone(U, L, this.dims.thigh, this.dims.shin, _tgt, _pole, out);

      // foot orientation: flat on the surface, yawed along travel
      const airPitch = lerp(-0.35, 0.30, fall);
      const pitch = lerp(f.pitch, airPitch, air);
      _e.set(pitch, f.yaw, 0, 'YXZ');
      _qa.setFromEuler(_e);
      this.B[fName].quaternion.copy(out.midQuat).invert().multiply(_qa);
      // toes extend as the heel leaves the ground
      const toe = clamp(-f.pitch * 0.8, 0, 0.55) * (1 - air);
      _e.set(toe, 0, 0, 'YXZ');
      this.B[tName].quaternion.setFromEuler(_e);
    }
  }

  dirToWorld(lx, ly, lz, out, cs, sn) {
    out.set(cs * lx + sn * lz, ly, -sn * lx + cs * lz).normalize();
    return out;
  }

  /* ---- 6. weapon -------------------------------------------------- */
  poseWeapon(dt, s, cs, sn) {
    const W = this.weapon;
    const chest = this.B.chest;
    const aim = s.aimBlend;
    const sprint = clamp01(this.runS * 1.35 - 0.45) * (1 - aim);

    // Hold offsets in chest space. Kept far enough forward that the firing
    // elbow stays inside a human range of flexion — see the elbow readout in
    // the headless rig check.
    const ox = lerp(lerp(0.126, 0.168, sprint), 0.068, aim);
    const oy = lerp(lerp(-0.030, -0.086, sprint), 0.166, aim);
    const oz = lerp(lerp(-0.262, -0.212, sprint), -0.372, aim);
    W.root.position.set(ox, oy, oz);

    // the point the muzzle should look at: blend a hip-ready point into
    // the real crosshair target
    _p.copy(W.root.position).applyMatrix4(chest.matrixWorld);
    this.dirToWorld(0, 0, -1, _q, cs, sn);
    _tgt.copy(_p)
      .addScaledVector(_q, 6)
      .add(_ax.set(0, lerp(-2.1, -3.4, sprint), 0));
    _tgt.lerp(s.aimPoint, aim);

    /* Never let the muzzle swing back through the character. A crosshair
     * resolved onto a wall right beside the shoulder can put the aim point
     * behind the weapon; the shot direction already guards against that, and
     * the pose has to as well. */
    _az.copy(_tgt).sub(_p);
    if (_az.lengthSq() < 1e-8) _az.copy(_q);
    _az.normalize();
    const front = _az.dot(_q);
    if (front < 0.26) {
      _az.lerp(_q, clamp01((0.26 - front) / Math.max(0.05, 1 - front) * 1.25));
      if (_az.lengthSq() < 1e-8) _az.copy(_q);
      _az.normalize();
    }
    _az.negate();                        // +Z points back down the weapon
    _ax.crossVectors(_up, _az);
    if (_ax.lengthSq() < 1e-8) _ax.set(1, 0, 0);
    _ax.normalize();
    _ay.crossVectors(_az, _ax).normalize();
    _mb.makeBasis(_ax, _ay, _az);
    _qa.setFromRotationMatrix(_mb);
    // cant the weapon slightly and roll with the body lean
    _e.set(0, 0, lerp(-0.10, -0.05, aim) + this.bankS.x * 0.4, 'YXZ');
    _qa.multiply(_qb.setFromEuler(_e));

    _m.copy(chest.matrixWorld).decompose(_p, _qb, _sc);
    W.root.quaternion.copy(_qb).invert().multiply(_qa);

    // recoil: back into the shoulder, muzzle rises
    W.recoil.position.set(0, 0, this.kick.x * 0.0125);
    _e.set(this.rise.x * 0.028, this.kick.x * -0.004, this.kick.x * 0.006, 'YXZ');
    W.recoil.quaternion.setFromEuler(_e);

    // the energy cell tracks remaining ammo, and flares on a shot
    const charge = s.reloadT >= 0 ? s.reloadT : s.ammoFrac;
    W.glowMat.emissiveIntensity = 0.7 + charge * 2.6 + this.kick.x * 0.55;
    W.magMat.emissiveIntensity = 0.5 + charge * 2.4;

    this.reloadRig(dt, s, W);
    W.root.updateWorldMatrix(false, true);

    /* Reach guard. Rather than let the support arm snap straight when the
     * fore-grip drifts out of range (aiming steeply up, a hard lean), pull
     * the whole weapon back along its own axis until both hands can hold it.
     * This is the weapon-space compensation a hand-authored rig would use. */
    const lim = this.dims.armLength * 0.90;
    for (let pass = 0; pass < 2; pass++) {
      let excess = 0;
      _p.setFromMatrixPosition(this.B.armLU.matrixWorld);
      excess = Math.max(excess, _q.setFromMatrixPosition(W.wristL.matrixWorld).distanceTo(_p) - lim);
      _p.setFromMatrixPosition(this.B.armRU.matrixWorld);
      excess = Math.max(excess, _q.setFromMatrixPosition(W.wristR.matrixWorld).distanceTo(_p) - lim);
      if (excess <= 0.002) break;
      W.root.position.z += Math.min(excess, 0.14);
      W.root.updateWorldMatrix(false, true);
    }
  }

  /** Magazine handling; the left-hand path is done in poseArms. */
  reloadRig(dt, s, W) {
    const t = s.reloadT;
    const home = W.magHome;
    if (t < 0) {
      home.position.set(0, -0.112, 0.028);
      home.rotation.set(0.06, 0, 0);
      W.mag.scale.setScalar(1);
      return;
    }
    if (t < 0.20) {
      home.position.set(0, -0.112 - smooth(t / 0.20) * 0.030, 0.028);
      home.rotation.set(0.06, 0, 0);
      W.mag.scale.setScalar(1);
    } else if (t < 0.46) {
      const u = (t - 0.20) / 0.26;
      home.position.set(0, -0.142 - u * 0.34, 0.028 + u * 0.10);
      home.rotation.set(0.06 + u * 1.5, u * 0.9, u * 0.7);
      W.mag.scale.setScalar(Math.max(0.001, 1 - smooth(clamp01((u - 0.5) / 0.5))));
    } else if (t < 0.80) {
      // the fresh cell is carried up by the left hand
      const u = smooth(clamp01((t - 0.46) / 0.34));
      W.mag.scale.setScalar(clamp01((t - 0.46) / 0.08));
      _p.copy(this.leftHandWorld);
      _m.copy(home.parent.matrixWorld).invert();
      _p.applyMatrix4(_m);
      home.position.set(
        lerp(_p.x, 0, u * u),
        lerp(_p.y, -0.112, u * u),
        lerp(_p.z, 0.028, u * u),
      );
      home.rotation.set(lerp(-0.5, 0.06, u), 0, lerp(0.4, 0, u));
    } else {
      const u = clamp01((t - 0.80) / 0.08);
      home.position.set(0, -0.112 + (1 - u) * 0.016, 0.028);
      home.rotation.set(0.06, 0, 0);
      W.mag.scale.setScalar(1);
    }
  }

  /* ---- 7. arms ---------------------------------------------------- */
  poseArms(dt, s, cs, sn) {
    const B = this.B;
    const W = this.weapon;
    const D = this.dims;
    _m.copy(B.chest.matrixWorld).decompose(_p, _qc, _sc); // chest world quat in _qc

    /* right hand always drives the weapon */
    _tgt.setFromMatrixPosition(W.wristR.matrixWorld);
    _pole.set(0.62, -0.86, 0.55).applyQuaternion(_qc).normalize();
    solveTwoBone(B.armRU, B.armRL, D.upperArm, D.lowerArm, _tgt, _pole, _outR);
    _m.copy(W.gripR.matrixWorld).decompose(_p, _qa, _sc);
    _e.set(0.10, 0, -0.20, 'YXZ');
    _qa.multiply(_qb.setFromEuler(_e));
    B.handR.quaternion.copy(_outR.midQuat).invert().multiply(_qa);

    /* left hand: fore-grip, unless a reload or a punch owns it */
    _tgt.setFromMatrixPosition(W.wristL.matrixWorld);
    _m.copy(W.gripL.matrixWorld).decompose(_p, _qa, _sc);
    let handQuat = _qa;
    let free = 0;

    if (s.reloadT >= 0) {
      free = 1;
      this.reloadHandTarget(s, _tgt);
      _e.set(-0.5, 0, 0.3, 'YXZ');
      _qa.setFromEuler(_e).premultiply(_qc);
    } else if (s.meleeT >= 0) {
      free = 1;
      this.meleeHandTarget(s, _tgt, cs, sn);
      _e.set(-0.15, 0, 0, 'YXZ');
      _qa.setFromEuler(_e).premultiply(_qc);
    } else {
      _e.set(0.05, 0, 0.24, 'YXZ');
      _qa.multiply(_qb.setFromEuler(_e));
    }

    /* Momentum: the support hand eases between poses instead of snapping.
     * Smoothed in CHEST space, not world space — a first-order world-space
     * lag would sit v/rate behind the grip, i.e. half a metre at sprint. */
    _m.copy(B.chest.matrixWorld).invert();
    _p.copy(_tgt).applyMatrix4(_m);
    if (!this.leftHandInit) { this.leftHand.copy(_p); this.leftHandInit = true; }
    this.leftHand.lerp(_p, 1 - Math.exp(-(free ? 24 : 18) * dt));
    this.leftHandWorld.copy(this.leftHand).applyMatrix4(B.chest.matrixWorld);
    _pole.set(-0.34, -1.0, 0.24 - free * 0.5).applyQuaternion(_qc).normalize();
    solveTwoBone(B.armLU, B.armLL, D.upperArm, D.lowerArm, this.leftHandWorld, _pole, _outL);
    B.handL.quaternion.copy(_outL.midQuat).invert().multiply(handQuat);
  }

  reloadHandTarget(s, out) {
    const t = s.reloadT;
    const W = this.weapon;
    const well = _p.setFromMatrixPosition(W.magPort.matrixWorld);
    // hip pouch, from the pelvis
    _q.set(-0.150, 0.010, -0.060).applyMatrix4(this.B.hips.matrixWorld);
    const pouch = _q;
    const charge = _ax.setFromMatrixPosition(W.charge.matrixWorld);
    const fore = _ay.setFromMatrixPosition(W.wristL.matrixWorld);

    if (t < 0.20) out.lerpVectors(fore, well, smooth(t / 0.20));
    else if (t < 0.46) out.lerpVectors(well, pouch, smooth((t - 0.20) / 0.26));
    else if (t < 0.80) out.lerpVectors(pouch, well, smooth((t - 0.46) / 0.34));
    else if (t < 0.88) out.copy(well);
    else if (t < 0.95) out.lerpVectors(well, charge, smooth((t - 0.88) / 0.07));
    else out.lerpVectors(charge, fore, smooth((t - 0.95) / 0.05));
  }

  meleeHandTarget(s, out, cs, sn) {
    const t = s.meleeT;
    const fore = _p.setFromMatrixPosition(this.weapon.wristL.matrixWorld);
    _m.copy(this.B.chest.matrixWorld).decompose(_q, _qb, _sc);
    const chest = _q;
    this.dirToWorld(-0.10, -0.05, -1, _ax, cs, sn);
    let reach;
    if (t < 0.30) reach = lerp(0.14, -0.14, smooth(t / 0.30));       // wind up
    else if (t < 0.52) reach = lerp(-0.14, 0.74, smooth((t - 0.30) / 0.22)); // commit
    else reach = lerp(0.74, 0.14, smooth((t - 0.52) / 0.48));         // recover
    _ay.copy(chest).addScaledVector(_ax, reach);
    _ay.y = chest.y + lerp(-0.10, 0.02, clamp01(t * 2));
    out.copy(_ay).lerp(fore, t < 0.85 ? 0 : smooth((t - 0.85) / 0.15));
  }

  /* ---- 8. head ---------------------------------------------------- */
  poseHead(dt, s) {
    const B = this.B;
    // stabilise: undo the spine's accumulated tilt, then look along the aim
    const spinePitch = this.leanF.x * 0.72 + this.aimPitch * (0.16 + 0.34 * s.aimBlend) * 0.74;
    const spineYaw = this.aimYaw * (0.34 + 0.42 * s.aimBlend);
    const wantYaw = this.aimYaw - spineYaw * 0.86;
    const wantPitch = -spinePitch * 0.80 + this.aimPitch * (0.30 + 0.30 * s.aimBlend);
    this.headYaw = damp(this.headYaw, clamp(wantYaw, -0.85, 0.85), 13, dt);
    this.headPitch = damp(this.headPitch, clamp(wantPitch, -0.7, 0.6), 13, dt);

    const fl = this.flinch * this.flinch;
    _e.set(
      this.headPitch + fl * this.flinchZ * -0.30,
      this.headYaw + fl * this.flinchX * -0.22,
      -this.leanS.x * 0.35 + fl * this.flinchX * -0.25,
      'YXZ',
    );
    B.head.quaternion.setFromEuler(_e);
    _e.set(this.headPitch * 0.35, this.headYaw * 0.42, 0, 'YXZ');
    B.neck.quaternion.setFromEuler(_e);

    // counter the pelvis bob so the head rides level
    const bobNow = this.pelvisLocalY - (this.dims.hipY + 0.020);
    B.head.position.y = this.restHead.y - clamp(bobNow * 0.40, -0.020, 0.020);
    B.neck.position.y = this.restNeck.y - clamp(bobNow * 0.18, -0.010, 0.010);
  }

  /* ---- death ------------------------------------------------------ */
  poseDeath(dt, s) {
    const B = this.B;
    const t = this.deadT;
    const k1 = clamp01(t / 0.22);
    const k2 = clamp01((t - 0.16) / 0.55);
    const k3 = clamp01((t - 0.45) / 0.9);
    const e1 = smooth(k1), e2 = smooth(k2), e3 = smooth(k3);

    // knees buckle, pelvis sinks, spine folds
    const py = lerp(this.dims.hipY + 0.02, 0.30, e2) - e3 * 0.16;
    this.pelvisLocalY = damp(this.pelvisLocalY, py, 7, dt);
    B.hips.position.set(e1 * 0.03, this.pelvisLocalY, e2 * 0.10);
    _e.set(e1 * -0.25 + e3 * 0.55, e2 * 0.30, e2 * 0.42, 'YXZ');
    B.hips.quaternion.setFromEuler(_e);

    const fold = (b, x, y, z) => { _e.set(x, y, z, 'YXZ'); b.quaternion.setFromEuler(_e); };
    fold(B.spine1, e1 * -0.22 + e3 * 0.34, e2 * 0.10, e2 * 0.16);
    fold(B.spine2, e1 * -0.28 + e3 * 0.40, e2 * 0.14, e2 * 0.20);
    fold(B.chest, e1 * -0.32 + e3 * 0.46, e2 * 0.18, e2 * 0.22);
    fold(B.neck, e1 * -0.40 + e3 * 0.30, 0, e2 * 0.18);
    fold(B.head, e1 * 0.50 + e3 * 0.30, e2 * -0.24, e2 * 0.26);
    fold(B.clavL, 0, 0, e2 * 0.30);
    fold(B.clavR, 0, 0, e2 * -0.30);

    // limbs go slack
    fold(B.armLU, e2 * 0.55, e2 * 0.20, e2 * 0.55);
    fold(B.armLL, e2 * 0.85, 0, 0);
    fold(B.armRU, e2 * 0.35, e2 * -0.24, e2 * -0.75);
    fold(B.armRL, e2 * 1.05, 0, 0);
    fold(B.legLU, e2 * 0.62, 0, e2 * 0.22);
    fold(B.legLL, e2 * -1.25, 0, 0);
    fold(B.footL, e2 * 0.45, 0, 0);
    fold(B.legRU, e2 * 0.38, 0, e2 * -0.16);
    fold(B.legRL, e2 * -0.95, 0, 0);
    fold(B.footR, e2 * 0.35, 0, 0);
    fold(B.toeL, 0, 0, 0);
    fold(B.toeR, 0, 0, 0);

    this.deathTilt = damp(this.deathTilt, 1, 3.2, dt);
    this.object.rotation.x = this.deathTilt * 0.30;
    this.object.rotation.z = this.deathTilt * 0.16;
    this.object.updateMatrixWorld(true);
    this.weapon.root.updateWorldMatrix(false, true);
  }

  /* ---- 9. cloth ---------------------------------------------------- */
  updateCloth(dt, s) {
    if (!this.cloth) return;
    this.cloth.update(dt, {
      pos: s.pos,
      yaw: s.facing,
      vel: s.vel,
      groundY: s.groundY,
      time: s.time,
    });
  }
}
