import * as THREE from 'three';

/* ==================================================================
   The player: a hand-rigged blocky figure with procedural animation,
   plus the movement / weapon state machine.
   ================================================================== */

const WALK = 5.4;
const SPRINT = 9.8;
const ACCEL = 46;
const FRICTION = 12;
const GRAVITY = 24;
const JUMP_V = 8.6;
const DASH_V = 21;
const RADIUS = 0.42;
const HEIGHT = 1.78;

export const WEAPON = {
  name: 'PLAZMOVÝ VRHAČ',
  mag: 14,
  reloadTime: 1.15,
  fireRate: 0.13,
  damage: 34,
  spread: 0.014,
  range: 190,
  speed: 145,
};

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.05, ...opts });
}

function buildFigure() {
  const M = {
    jacket: mat(0x3c5872, { emissive: 0x0c141c, emissiveIntensity: 1 }),
    jacketDark: mat(0x2b3f52),
    jeans: mat(0x3a4557),
    boots: mat(0x26262b),
    skin: mat(0xc9906a, { roughness: 0.85 }),
    hair: mat(0x2b2118),
    scarf: mat(0xc02a2a, { roughness: 0.9 }),
    gun: mat(0x2a2e34, { metalness: 0.7, roughness: 0.35 }),
    glow: new THREE.MeshStandardMaterial({
      color: 0x8ff0ff, emissive: 0x5fd8ff, emissiveIntensity: 3.4, roughness: 0.3,
    }),
  };

  const root = new THREE.Group();

  const body = new THREE.Group();
  body.position.y = 0.94; // hip height
  root.add(body);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.26), M.jeans);
  body.add(hips);

  const torso = new THREE.Group();
  torso.position.y = 0.12;
  body.add(torso);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.56, 0.3), M.jacket);
  chest.position.y = 0.28;
  torso.add(chest);
  const chestTop = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.16, 0.32), M.jacketDark);
  chestTop.position.y = 0.56;
  torso.add(chestTop);
  const scarf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.34), M.scarf);
  scarf.position.y = 0.64;
  torso.add(scarf);
  const scarfTail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.42, 0.07), M.scarf);
  scarfTail.position.set(0.1, 0.44, -0.18);
  torso.add(scarfTail);

  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.28, 0.25), M.skin);
  head.add(skull);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.27), M.hair);
  hair.position.y = 0.11;
  head.add(hair);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.03), M.glow);
  visor.position.set(0, 0.02, -0.13);
  head.add(visor);

  // arms
  const makeArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.31, 0.5, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.16), M.jacket);
    upper.position.y = -0.17;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.position.y = -0.34;
    shoulder.add(elbow);
    const fore = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.13), M.jacketDark);
    fore.position.y = -0.16;
    elbow.add(fore);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.13), M.skin);
    hand.position.y = -0.36;
    elbow.add(hand);
    torso.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // the plasma thrower, parented to the right hand
  const gun = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.46), M.gun);
  gun.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 8), M.gun);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.36);
  gun.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.17, 0.1), M.gun);
  grip.position.set(0, -0.13, 0.08);
  gun.add(grip);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.022, 6, 12), M.glow);
  coil.rotation.y = Math.PI / 2;
  coil.position.set(0, 0.02, -0.16);
  gun.add(coil);
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.12), M.glow);
  cell.position.set(0, -0.02, 0.16);
  gun.add(cell);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.54);
  gun.add(muzzle);
  gun.position.set(0, -0.42, -0.06);
  gun.rotation.x = -Math.PI / 2;
  armR.elbow.add(gun);

  // legs
  const makeLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.13, -0.1, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.19), M.jeans);
    thigh.position.y = -0.21;
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.4, 0.17), M.jeans);
    shin.position.y = -0.2;
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.28), M.boots);
    foot.position.set(0, -0.42, -0.05);
    knee.add(foot);
    body.add(hip);
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });

  return { root, body, torso, head, armL, armR, legL, legR, gun, muzzle, coil, cell, visor, M };
}

export class Player {
  constructor(scene, collision, opts = {}) {
    this.collision = collision;
    this.fig = buildFigure();
    this.object = this.fig.root;
    scene.add(this.object);

    this.pos = new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 30);
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;
    this.onGround = true;
    this.groundY = 0;

    this.maxHealth = 140;
    this.health = this.maxHealth;
    this.maxStamina = 100;
    this.stamina = this.maxStamina;
    this.alive = true;

    this.ammo = WEAPON.mag;
    this.reloading = 0;
    this.fireCd = 0;
    this.meleeCd = 0;
    this.meleeAnim = 0;
    this.dashCd = 0;
    this.dashTime = 0;
    this.invuln = 0;
    this.recoil = 0;
    this.hurtFlash = 0;

    this.animPhase = 0;
    this.speedRatio = 0;
    this.aimBlend = 0;
    this.kills = 0;

    // muzzle light — one dynamic light is affordable and sells every shot
    this.muzzleLight = new THREE.PointLight(0x7fe4ff, 0, 16, 2);
    this.muzzleLight.position.set(0, 1.2, 0);
    scene.add(this.muzzleLight);

    // hero light: keeps the character readable when they are in shadow, which
    // at this time of day is most of the time.
    this.heroLight = new THREE.PointLight(0xffe2c4, 3.6, 8, 2);
    this.heroLight.position.set(0, 3.2, -1.5);
    this.object.add(this.heroLight);
  }

  get eyePos() {
    return _v1.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }

  get centre() {
    return _v2.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  damage(amount, fromDir) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= amount;
    this.hurtFlash = 1;
    this.invuln = 0.25;
    if (fromDir) this.vel.addScaledVector(fromDir, 2.2);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return true;
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  startReload() {
    if (this.reloading > 0 || this.ammo === WEAPON.mag) return false;
    this.reloading = WEAPON.reloadTime;
    return true;
  }

  /**
   * @param {number} dt
   * @param {object} input  {forward, right, jump, sprint, dash, fire, melee, reload}
   * @param {number} camYaw camera yaw the movement is relative to
   * @param {object} hooks  {onShoot(origin, dir), onMelee(), onReload(), onJump(), onStep()}
   */
  update(dt, input, camYaw, camPitch, hooks) {
    if (!this.alive) {
      // ragdoll-lite: slump to the ground
      this.fig.root.rotation.x = Math.min(Math.PI / 2, this.fig.root.rotation.x + dt * 3);
      this.fig.root.position.set(this.pos.x, this.pos.y, this.pos.z);
      return;
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.meleeCd = Math.max(0, this.meleeCd - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.recoil *= Math.exp(-dt * 9);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    if (this.meleeAnim > 0) this.meleeAnim = Math.max(0, this.meleeAnim - dt * 3.4);

    /* ---- desired horizontal move (camera relative) ---- */
    // Camera forward is (-sin yaw, 0, cos yaw); screen-right is (-cos yaw, 0, -sin yaw).
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    let wx = -input.forward * sin - input.right * cos;
    let wz = input.forward * cos - input.right * sin;
    const inLen = Math.hypot(wx, wz);
    if (inLen > 1) { wx /= inLen; wz /= inLen; }
    const moving = inLen > 0.05;

    /* ---- dash ---- */
    if (input.dash && this.dashCd <= 0 && this.stamina > 25) {
      this.dashCd = 0.75;
      this.dashTime = 0.18;
      this.stamina -= 25;
      const dx = moving ? wx : -sin;
      const dz = moving ? wz : cos;
      this.vel.x = dx * DASH_V;
      this.vel.z = dz * DASH_V;
      this.invuln = 0.26;
      hooks.onDash && hooks.onDash();
    }
    this.dashTime = Math.max(0, this.dashTime - dt);

    /* ---- sprint & stamina ---- */
    const wantSprint = input.sprint && moving && this.stamina > 1 && !input.fire;
    if (wantSprint) this.stamina = Math.max(0, this.stamina - dt * 24);
    else this.stamina = Math.min(this.maxStamina, this.stamina + dt * 18);
    const targetSpeed = wantSprint ? SPRINT : WALK;

    /* ---- horizontal acceleration ---- */
    if (this.dashTime <= 0) {
      if (moving) {
        const accelBlend = 1 - Math.exp(-ACCEL * 0.35 * dt);
        this.vel.x += (wx * targetSpeed - this.vel.x) * accelBlend;
        this.vel.z += (wz * targetSpeed - this.vel.z) * accelBlend;
      } else {
        const f = Math.exp(-FRICTION * dt);
        this.vel.x *= f;
        this.vel.z *= f;
      }
    }

    /* ---- jump & gravity ---- */
    if (input.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
      hooks.onJump && hooks.onJump();
    }
    this.vel.y -= GRAVITY * dt;

    /* ---- integrate + collide ---- */
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.collision.resolve(this.pos, RADIUS, HEIGHT);

    this.pos.y += this.vel.y * dt;
    const gy = this.collision.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS + 0.1, 0.75);
    if (this.pos.y <= gy) {
      if (!this.onGround && this.vel.y < -12) hooks.onLand && hooks.onLand(-this.vel.y);
      this.pos.y = gy;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > gy + 0.06) {
      this.onGround = false;
    }
    this.groundY = gy;

    /* ---- weapon ---- */
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo = WEAPON.mag;
      }
    }
    if (input.reload) this.startReload();

    this.aimBlend += ((input.fire || input.aim ? 1 : 0) - this.aimBlend) * (1 - Math.exp(-14 * dt));

    if (input.fire && this.fireCd <= 0 && this.reloading <= 0) {
      if (this.ammo > 0) {
        this.ammo--;
        this.fireCd = WEAPON.fireRate;
        this.recoil = 1;
        const origin = _v3.setFromMatrixPosition(this.fig.muzzle.matrixWorld);
        // Aim at whatever the crosshair is over so the shot and the reticle agree.
        const dir = _v4.copy(input.aimPoint).sub(origin).normalize();
        dir.x += (Math.random() - 0.5) * WEAPON.spread;
        dir.y += (Math.random() - 0.5) * WEAPON.spread;
        dir.z += (Math.random() - 0.5) * WEAPON.spread;
        dir.normalize();
        hooks.onShoot && hooks.onShoot(origin, dir);
        this.muzzleLight.intensity = 26;
        // a little kick backwards
        this.vel.x -= dir.x * 0.7;
        this.vel.z -= dir.z * 0.7;
      } else if (this.fireCd <= 0) {
        this.fireCd = 0.35;
        hooks.onDryFire && hooks.onDryFire();
        this.startReload();
      }
    }
    if (this.ammo === 0 && this.reloading <= 0) this.startReload();

    if (input.melee && this.meleeCd <= 0) {
      this.meleeCd = 0.62;
      this.meleeAnim = 1;
      hooks.onMelee && hooks.onMelee();
    }

    this.muzzleLight.intensity *= Math.exp(-dt * 16);
    this.muzzleLight.position.setFromMatrixPosition(this.fig.muzzle.matrixWorld);

    /* ---- facing ---- */
    const aiming = this.aimBlend > 0.4;
    let targetFacing = this.facing;
    if (aiming) targetFacing = Math.PI - camYaw;
    else if (moving) targetFacing = Math.atan2(-wx, -wz);
    let diff = ((targetFacing - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.facing += diff * (1 - Math.exp(-dt * (aiming ? 18 : 11)));

    /* ---- animation ---- */
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedRatio = hs / SPRINT;
    this.animPhase += dt * (2.4 + hs * 1.55);
    this.animate(dt, hs, camPitch, aiming, moving);

    this.object.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.object.rotation.y = this.facing;

    // footstep events
    this._stepAcc = (this._stepAcc || 0) + hs * dt;
    if (this._stepAcc > 2.1 && this.onGround) {
      this._stepAcc = 0;
      hooks.onStep && hooks.onStep(hs / SPRINT);
    }
  }

  animate(dt, speed, camPitch, aiming, moving) {
    const f = this.fig;
    const p = this.animPhase;
    const run = Math.min(1, speed / SPRINT);
    const swing = moving ? 0.28 + run * 0.72 : 0;
    const air = this.onGround ? 0 : 1;

    // legs
    const legAmp = 0.95 * swing;
    f.legL.hip.rotation.x = Math.sin(p) * legAmp - air * 0.45;
    f.legR.hip.rotation.x = Math.sin(p + Math.PI) * legAmp - air * 0.15;
    f.legL.knee.rotation.x = Math.max(0, -Math.sin(p - 0.6)) * legAmp * 1.15 + air * 0.7;
    f.legR.knee.rotation.x = Math.max(0, -Math.sin(p + Math.PI - 0.6)) * legAmp * 1.15 + air * 0.2;

    // body bob & lean
    const bob = Math.abs(Math.sin(p)) * 0.055 * swing;
    f.body.position.y = 0.94 + bob - (air ? 0.04 : 0);
    f.torso.rotation.z = Math.sin(p) * 0.045 * swing;
    f.torso.rotation.x = 0.06 + run * 0.16 - camPitch * 0.12 * this.aimBlend;
    f.torso.rotation.y = Math.sin(p) * 0.06 * swing;

    // head roughly tracks where you look
    f.head.rotation.x = -camPitch * 0.45 * (0.3 + this.aimBlend);
    f.head.rotation.y = Math.sin(p * 0.5) * 0.05;

    // arms: idle/run swing blended with a two-handed aim pose
    const armSwing = Math.sin(p + Math.PI) * 0.55 * swing;
    const idleL = -armSwing * 0.9;
    const idleR = armSwing * 0.9;

    const aim = this.aimBlend;
    const recoilKick = this.recoil * 0.5;
    const melee = this.meleeAnim;

    // right arm (gun): +PI/2 about X swings the arm out in front of the body
    const aimR = Math.PI / 2 + camPitch * 0.85 + recoilKick;
    f.armR.shoulder.rotation.x = THREE.MathUtils.lerp(idleR * 0.6 + 0.1, aimR, aim);
    f.armR.shoulder.rotation.z = THREE.MathUtils.lerp(-0.12, -0.24, aim);
    f.armR.shoulder.rotation.y = THREE.MathUtils.lerp(0, -0.18, aim);
    f.armR.elbow.rotation.x = THREE.MathUtils.lerp(-0.55 - Math.abs(idleR) * 0.4, -0.46 + recoilKick * 0.7, aim);

    // left arm supports the gun when aiming, punches on melee
    const aimL = Math.PI / 2 + camPitch * 0.85;
    f.armL.shoulder.rotation.x = THREE.MathUtils.lerp(idleL * 0.6 + 0.1, aimL, aim);
    f.armL.shoulder.rotation.z = THREE.MathUtils.lerp(0.12, 0.42, aim);
    f.armL.shoulder.rotation.y = THREE.MathUtils.lerp(0, 0.5, aim);
    f.armL.elbow.rotation.x = THREE.MathUtils.lerp(-0.55 - Math.abs(idleL) * 0.4, -0.8, aim);

    if (melee > 0) {
      // quick straight-arm plasma punch
      const k = Math.sin(melee * Math.PI);
      f.armL.shoulder.rotation.x = Math.PI / 2 + 0.25 + k * 0.5;
      f.armL.elbow.rotation.x = -1.3 + k * 1.2;
      f.torso.rotation.y -= k * 0.45;
    }

    // gun glow pulses with charge
    const charge = this.reloading > 0 ? 1 - this.reloading / WEAPON.reloadTime : this.ammo / WEAPON.mag;
    f.M.glow.emissiveIntensity = 1.4 + charge * 2.4 + this.recoil * 5;
    f.coil.rotation.z += dt * (2 + this.recoil * 40);

    // hurt flash tints the jacket
    // damage tint only — a constant emissive washes the whole figure out
    const hf = this.hurtFlash;
    f.M.jacket.emissive.setRGB(hf * 0.45, hf * 0.04, hf * 0.04);
    f.M.jacket.emissiveIntensity = hf * 0.8;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
