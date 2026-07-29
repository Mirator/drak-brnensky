import * as THREE from 'three';
import { Rng } from './rng.js';
import { buildSkeleton } from './character/rig.js';
import { buildBody } from './character/mesh.js';
import { buildWeapon } from './character/weapon.js';
import { CharacterCloth } from './character/cloth.js';
import { CharacterAnimator } from './character/anim.js';
import { characterMaterials } from './character/materials.js';

/* ==================================================================
   The player: movement / weapon state machine plus a fully procedural
   skinned character.

   The figure itself lives in src/character/:
     rig.js        22-bone skeleton, proportions, analytic 2-bone IK
     mesh.js       one skinned draw call for the whole body
     weapon.js     the plasma thrower
     cloth.js      verlet coat skirt + scarf
     anim.js       locomotion, foot planting, aim layer, actions
     materials.js  procedural fabric/metal/glow materials

   The public surface main.js uses is unchanged:
     new Player(scene, collision, {x, z, rng})
     player.update(dt, cmd, yaw, pitch, {onShoot, onDryFire, onMelee,
                   onJump, onDash, onStep, onLand})
     pos vel centre object health maxHealth stamina maxStamina ammo
     reloading alive hurtFlash damage() heal()  + the WEAPON export
   ================================================================== */

const WALK = 5.4;
const SPRINT = 9.8;
const ACCEL = 46;
// Preserve the old 60 Hz acceleration blend while making it frame-rate invariant.
const ACCEL_BLEND_RATE = -60 * Math.log(1 - (ACCEL * 0.35) / 60);
const FRICTION = 12;
const GRAVITY = 24;
const JUMP_V = 8.6;
const DASH_V = 21;
const RADIUS = 0.42;
const HEIGHT = 1.78;
/** Costume / texture randomness gets its own stream so the shared
 *  gameplay Rng keeps producing the same city and rift sequence. */
const COSTUME_SEED = 0x44524b;

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

export class Player {
  constructor(scene, collision, opts = {}) {
    this.collision = collision;
    this.rng = opts.rng || new Rng(COSTUME_SEED);
    const costume = new Rng(opts.costumeSeed ?? COSTUME_SEED);

    this.object = new THREE.Group();
    this.object.name = 'player';
    scene.add(this.object);

    /* ---- rig + meshes ----
     * Textures get their own stream so the cached maps can be shared
     * between instances without shifting the costume stream. */
    const materials = characterMaterials(new Rng(COSTUME_SEED ^ 0x9e37), opts.materials);
    this.materials = materials;
    const rig = buildSkeleton();
    this.rig = rig;
    const { body, glow } = buildBody(rig, costume);

    this.object.add(rig.root);
    this.bodyMesh = new THREE.SkinnedMesh(body, materials.body);
    this.glowMesh = new THREE.SkinnedMesh(glow, materials.bodyGlow);
    this.object.add(this.bodyMesh, this.glowMesh);

    this.weapon = buildWeapon(materials);
    rig.byName.chest.add(this.weapon.root);

    this.cloth = new CharacterCloth(rig, materials.cloth, costume);
    this.object.add(this.cloth.mesh);

    // bind in the rest pose, with the whole rig parented and at the origin
    this.object.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(rig.bones);
    this.skeleton = skeleton;
    this.bodyMesh.bind(skeleton, this.bodyMesh.matrixWorld);
    this.glowMesh.bind(skeleton, this.glowMesh.matrixWorld);
    this.cloth.bindPins();
    this.cloth.reset();

    for (const m of [this.bodyMesh, this.glowMesh]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
    }

    /** Triangles / draw calls, measured, for the perf budget check. */
    let meshes = 0;
    this.object.traverse((o) => { if (o.isMesh) meshes++; });
    this.stats = {
      triangles: body.index.count / 3 + glow.index.count / 3
        + this.weapon.tris + this.cloth.triangles,
      // body, bodyGlow, weapon metal, weapon glow, mag cell, cloth
      drawCalls: meshes,
    };

    /* ---- state ---- */
    this.pos = new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 30);
    this.vel = new THREE.Vector3();
    this.facing = Math.PI;
    this.facingVel = 0;
    this.turnRate = 0;
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
    this.time = 0;
    this._landImpact = 0;
    this._wasAlive = true;
    /* Ragdoll handoff. Set true once src/rigidbody.js owns the bone
     * transforms (its PLAYER_RAGDOLL_SPEC already targets these bone names
     * and the -y axis convention); the animator then stops posing and only
     * keeps the coat and scarf simulating over the physics pose. */
    this.ragdollControlled = false;

    /* ---- animator ---- */
    this.anim = new CharacterAnimator(rig, this.weapon, this.cloth, {
      collision,
      object: this.object,
      sprintSpeed: SPRINT,
    });
    this.object.position.copy(this.pos);
    this.object.rotation.y = this.facing;
    this.object.updateMatrixWorld(true);
    this.anim.reset(this.pos, this.facing);

    // muzzle light — one dynamic light is affordable and sells every shot
    this.muzzleLight = new THREE.PointLight(0x7fe4ff, 0, 16, 2);
    this.muzzleLight.position.set(0, 1.2, 0);
    scene.add(this.muzzleLight);

    // hero light: keeps the character readable when they are in shadow, which
    // at this time of day is most of the time. It sits behind and above the
    // shoulders — the camera side — so the silhouette we actually look at is lit.
    this.heroLight = new THREE.PointLight(0xffe2c4, 3.4, 9, 2);
    this.heroLight.position.set(0.5, 2.6, 2.1);
    this.object.add(this.heroLight);

    /* main.js runs stepGame(dt, frozen = true) once the player is dead, and
     * that path does not call player.update() at all — so the collapse would
     * freeze on the last living frame. Until main.js drives us while dead
     * (see the note in the handover), advance the death pose from the render
     * loop via the mesh's own onBeforeRender. Guarded so it stands down the
     * moment update() starts being called with alive === false. */
    this._updateDrivesDeath = false;
    this._deathFrame = -1;
    this._deathClock = 0;
    this.bodyMesh.onBeforeRender = (renderer) => this._renderTick(renderer);

    this._animState = {
      pos: this.pos,
      vel: this.vel,
      facing: this.facing,
      turnRate: 0,
      onGround: true,
      aimBlend: 0,
      aimPoint: new THREE.Vector3(),
      camPitch: 0,
      ammoFrac: 1,
      reloadT: -1,
      meleeT: -1,
      landImpact: 0,
      alive: true,
      time: 0,
      groundY: 0,
      wishX: 0,
      wishZ: 0,
      ragdoll: false,
    };
  }

  /** Fallback driver for the death collapse. See the constructor. */
  _renderTick(renderer) {
    if (this.alive || this._updateDrivesDeath) { this._deathClock = 0; return; }
    // one tick per render() call, not once per shadow/colour pass
    const frame = renderer && renderer.info ? renderer.info.render.frame : ++this._deathFrame;
    if (frame === this._deathFrame) return;
    this._deathFrame = frame;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    const prev = this._deathClock || now;
    this._deathClock = now;
    const dt = Math.min(1 / 20, now - prev);
    if (!(dt > 0)) return;
    this.time += dt;
    this.pushAnimState(null, 0, 0);
    this._animState.alive = false;
    this.anim.update(dt, this._animState);
  }

  get eyePos() {
    return _v1.set(this.pos.x, this.pos.y + 1.62, this.pos.z);
  }

  get centre() {
    return _v2.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  /** Muzzle position in world space, driven by the rig. */
  get muzzlePos() {
    this.weapon.muzzle.updateWorldMatrix(true, false);
    return _v5.setFromMatrixPosition(this.weapon.muzzle.matrixWorld);
  }

  damage(amount, fromDir, continuous = false) {
    if (!this.alive || this.invuln > 0) return false;
    this.health -= amount;
    this.hurtFlash = 1;
    if (!continuous) {
      this.invuln = 0.25;
      if (fromDir) this.vel.addScaledVector(fromDir, 2.2);
    }
    // directional flinch: fromDir points away from the attacker
    if (fromDir) {
      const cs = Math.cos(this.facing), sn = Math.sin(this.facing);
      const lx = cs * fromDir.x - sn * fromDir.z;
      const lz = sn * fromDir.x + cs * fromDir.z;
      _hit.set(-lx, lz);
      const len = _hit.length();
      if (len > 1e-4) _hit.divideScalar(len);
      this.anim.hit(_hit, amount >= 22 && !continuous);
    } else if (!continuous) {
      _hit.set(0, -1);
      this.anim.hit(_hit, amount >= 22);
    }
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

  /** Puts the rig back into a clean spawn state after a restart. */
  respawn() {
    this.object.rotation.x = 0;
    this.object.rotation.z = 0;
    this.facing = this.object.rotation.y;
    this.facingVel = 0;
    this.turnRate = 0;
    this.aimBlend = 0;
    this.recoil = 0;
    this.hurtFlash = 0;
    this.meleeAnim = 0;
    this.dashTime = 0;
    this.invuln = 0;
    this.onGround = true;
    this._landImpact = 0;
    this.object.position.copy(this.pos);
    this.object.updateMatrixWorld(true);
    this.anim.reset(this.pos, this.facing);
    this._wasAlive = true;
    this._updateDrivesDeath = false;
    this._deathClock = 0;
  }

  /**
   * @param {number} dt
   * @param {object} input  {forward, right, jump, sprint, dash, fire, aim,
   *                         melee, reload, aimPoint}
   * @param {number} camYaw camera yaw the movement is relative to
   * @param {number} camPitch
   * @param {object} hooks  {onShoot(origin, dir), onDryFire, onMelee, onJump,
   *                         onDash, onStep(i), onLand(v)}
   */
  update(dt, input, camYaw, camPitch, hooks) {
    this.time += dt;
    if (!this.alive) {
      if (this._wasAlive) {
        this._wasAlive = false;
        this.anim.deadT = 0;
      }
      this._updateDrivesDeath = true;
      this.object.position.set(this.pos.x, this.pos.y, this.pos.z);
      this.object.rotation.y = this.facing;
      this.pushAnimState(input, camPitch, 0);
      this._animState.alive = false;
      this.anim.update(dt, this._animState);
      return;
    }
    if (!this._wasAlive) this.respawn();

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

    /* ---- horizontal acceleration ----
     * The wanted velocity is handed to the animator: (wish - vel) is the
     * frame-rate-invariant "how hard am I pushing" signal the lean springs
     * need. A finite-difference acceleration would not be. */
    this._animState.wishX = moving ? wx * targetSpeed : 0;
    this._animState.wishZ = moving ? wz * targetSpeed : 0;
    if (this.dashTime <= 0) {
      if (moving) {
        const accelBlend = 1 - Math.exp(-ACCEL_BLEND_RATE * dt);
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

    this._landImpact = 0;
    this.pos.y += this.vel.y * dt;
    const gy = this.collision.groundHeight(this.pos.x, this.pos.z, this.pos.y, RADIUS + 0.1, 0.75);
    if (this.pos.y <= gy) {
      if (!this.onGround && this.vel.y < -12) hooks.onLand && hooks.onLand(-this.vel.y);
      if (!this.onGround) this._landImpact = -this.vel.y;
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

    /* ---- facing: spring-damped so direction changes overshoot and settle ---- */
    const aiming = this.aimBlend > 0.4;
    let targetFacing = this.facing;
    if (aiming) targetFacing = Math.PI - camYaw;
    else if (moving) targetFacing = Math.atan2(-wx, -wz);
    const diff = ((targetFacing - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const prevFacing = this.facing;
    // fixed-step spring keeps 30 Hz and 144 Hz identical
    {
      const k = aiming ? 620 : 300;
      const c = aiming ? 42 : 26;
      const H = 1 / 120;
      let rem = Math.min(dt, 0.25);
      let err = diff;
      while (rem > 1e-6) {
        const h = Math.min(H, rem);
        rem -= h;
        this.facingVel += (k * err - c * this.facingVel) * h;
        const step = this.facingVel * h;
        err -= step;
        this.facing += step;
      }
    }
    this.facing -= Math.PI * 2 * Math.round(this.facing / (Math.PI * 2));
    this.turnRate = dt > 1e-5
      ? (((this.facing - prevFacing + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / dt
      : 0;

    this.object.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.object.rotation.y = this.facing;

    /* ---- animation runs before the shot so the muzzle is where it looks ---- */
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speedRatio = hs / SPRINT;
    this.animPhase += dt * (2.4 + hs * 1.55);
    this.pushAnimState(input, camPitch, this._landImpact);
    this.anim.update(dt, this._animState);

    /* ---- fire ---- */
    if (input.fire && this.fireCd <= 0 && this.reloading <= 0) {
      if (this.ammo > 0) {
        this.ammo--;
        this.fireCd = WEAPON.fireRate;
        this.recoil = 1;
        this.weapon.muzzle.updateWorldMatrix(true, false);
        const origin = _v3.setFromMatrixPosition(this.weapon.muzzle.matrixWorld);
        // Aim at whatever the crosshair is over so the shot and the reticle agree.
        const cp = Math.cos(camPitch);
        const aimForward = _v2.set(-Math.sin(camYaw) * cp, Math.sin(camPitch), Math.cos(camYaw) * cp);
        const dir = _v4.copy(input.aimPoint).sub(origin);
        const aimDistance = dir.length();
        if (aimDistance > 1e-6) dir.divideScalar(aimDistance);
        // A close wall (or a camera ray starting inside geometry) can put the
        // hit point behind the muzzle. Never fire back over the player's shoulder.
        if (aimDistance <= 1e-6 || dir.dot(aimForward) <= 0) dir.copy(aimForward);
        dir.x += this.rng.float(-0.5, 0.5) * WEAPON.spread;
        dir.y += this.rng.float(-0.5, 0.5) * WEAPON.spread;
        dir.z += this.rng.float(-0.5, 0.5) * WEAPON.spread;
        dir.normalize();
        hooks.onShoot && hooks.onShoot(origin, dir);
        this.anim.fired();
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

    /* ---- post ---- */
    this.weapon.muzzle.updateWorldMatrix(true, false);
    this.muzzleLight.intensity *= Math.exp(-dt * 16);
    this.muzzleLight.position.setFromMatrixPosition(this.weapon.muzzle.matrixWorld);

    // footsteps fire on the frame a foot actually plants, which the animator
    // paces at the same ~2.1 m spacing the old distance accumulator used.
    if (hooks.onStep) {
      for (let i = 0; i < this.anim.stepEvents.length; i++) hooks.onStep(this.anim.stepEvents[i]);
    }

    // damage tint only — a constant emissive washes the whole figure out
    const hf = this.hurtFlash;
    for (const m of [this.materials.body, this.materials.cloth]) {
      if (!m || !m.emissive) continue;
      m.emissive.setRGB(hf * 0.5, hf * 0.05, hf * 0.05);
      m.emissiveIntensity = hf * 0.85;
    }
  }

  pushAnimState(input, camPitch, landImpact) {
    const st = this._animState;
    st.facing = this.facing;
    st.turnRate = this.turnRate;
    st.onGround = this.onGround;
    st.aimBlend = this.aimBlend;
    st.camPitch = camPitch;
    st.ammoFrac = this.ammo / WEAPON.mag;
    st.reloadT = this.reloading > 0
      ? Math.min(1, 1 - this.reloading / WEAPON.reloadTime)
      : -1;
    st.meleeT = this.meleeAnim > 0 ? 1 - this.meleeAnim : -1;
    st.landImpact = landImpact;
    st.alive = this.alive;
    st.ragdoll = this.ragdollControlled;
    st.time = this.time;
    st.groundY = this.groundY;
    if (input && input.aimPoint) st.aimPoint.copy(input.aimPoint);
    else {
      // no crosshair resolved yet: look straight ahead
      st.aimPoint.set(
        this.pos.x - Math.sin(this.facing) * 12,
        this.pos.y + 1.5,
        this.pos.z - Math.cos(this.facing) * 12,
      );
    }
    return st;
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _hit = new THREE.Vector2();
