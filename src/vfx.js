import * as THREE from 'three';
import { makeGradientSprite } from './textures.js';
// The material registry owns the *look* of decals; we borrow its generated
// canvases and pack them into one atlas so the whole decal system stays a
// single draw call. Guarded at the call site: if the registry has no decal
// entries we draw our own.
import { getMaterial } from './materials.js';
import { Rng } from './rng.js';
import { makeShared } from './vfx/shared.js';
import { makeParticleAtlas, makeDecalAtlas, TILE, DECAL, SURFACE_DECALS } from './vfx/atlas.js';
import { ParticleLayer, beginSpawn, S } from './vfx/particles.js';
import { DecalSystem } from './vfx/decals.js';
import { TracerSystem } from './vfx/beams.js';
import { FireballSystem, ShockwaveSystem } from './vfx/explosions.js';
import { FlameSystem } from './vfx/flame.js';
import { createRift, warmRiftProgram } from './vfx/rift.js';

/* ==================================================================
   VFX — projectiles, particles, decals, explosions, flame, rifts.

   Layout (one draw call each, all pooled, nothing allocated per frame):

     embers    additive particles — sparks, embers, flashes, muzzle flare
     smoke     alpha-lit, soft-depth-faded smoke and dust
     debris    lit opaque chips and splinters
     haze      heat shimmer carrier
     tracers   velocity-aligned plasma ribbons
     decals    projected surface marks (scorch, craters, cracks, ichor)
     fireballs turbulent explosion puffs (fire → occluding smoke)
     shocks    ground shockwave rings
     flames    the dragon's breath and the fires it leaves behind
     rift × n  one shader pass per rift

   Author for HDR: emissive values deliberately exceed 1.0 so the bloom
   pass has something to work with. Nothing here relies on washing a
   sprite out to white.

   Two external hooks worth knowing about:
     - setDepthTexture() turns on soft particles (see the report).
     - `screen` carries screen-space effect intensities for the post stack.
   ================================================================== */

const VFX_SEED = 20250729;

/* Scratch vectors. Ownership matters here: `_hp`/`_fr` belong to the
 * projectile loop and `_wd*` to _wallDust, because main.js keeps using
 * `hit.point` *after* the hit callback has run an explosion through this
 * file — sharing one temp between the two would corrupt the splash maths. */
const _v1 = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _hp = new THREE.Vector3();
const _fr = new THREE.Vector3();
const _wd1 = new THREE.Vector3();
const _wd2 = new THREE.Vector3();
const _wd3 = new THREE.Vector3();
const _ex1 = new THREE.Vector3();
const _fl1 = new THREE.Vector3();
const _fl2 = new THREE.Vector3();
const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _mat4 = new THREE.Matrix4();
const UP = { x: 0, y: 1, z: 0 };

/** Per-colour instance cap for pickup crates. */
const PICKUP_CAP = 24;

const SURFACE_FALLBACK = { id: 'stone', colour: 0x8d8779, hardness: 0.95 };

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.rng = new Rng(VFX_SEED);
    this.shared = makeShared();
    this.glowTex = makeGradientSprite('#ffffff', 'rgba(255,255,255,0)');
    this.atlas = makeParticleAtlas(128);
    this.decalAtlas = makeDecalAtlas(getMaterial, 256);

    /* ---------------- particle layers ---------------- */
    this.embers = new ParticleLayer(scene, this.shared, this.atlas, {
      cap: 1500, mode: 'additive', soft: 0.9, intensity: 1.0,
      fadeIn: 0.05, fadeOut: 1.4, renderOrder: 15,
    });
    // Smoke is the expensive layer (big on-screen quads); it is capped
    // tighter than the ember count on purpose.
    this.smoke = new ParticleLayer(scene, this.shared, this.atlas, {
      cap: 460, mode: 'smoke', soft: 2.6, intensity: 1.0,
      fadeIn: 0.14, fadeOut: 1.1, ember: 0x2a0e05, renderOrder: 9, groundFade: 1,
    });
    this.debris = new ParticleLayer(scene, this.shared, this.atlas, {
      cap: 340, mode: 'debris', soft: 0.3, intensity: 1.0,
      fadeIn: 0.02, fadeOut: 0.5, renderOrder: 10,
    });
    this.haze = new ParticleLayer(scene, this.shared, this.atlas, {
      cap: 140, mode: 'haze', soft: 1.6, intensity: 0.9,
      fadeIn: 0.2, fadeOut: 1.6, renderOrder: 16, groundFade: 1,
    });

    /* ---------------- other systems ---------------- */
    this.tracers = new TracerSystem(scene, this.shared, { cap: 72 });
    this.decals = new DecalSystem(scene, this.shared, this.decalAtlas, { cap: 168 });
    this.fireballs = new FireballSystem(scene, this.shared, { cap: 110 });
    this.shocks = new ShockwaveSystem(scene, this.shared, this.atlas, { cap: 18 });
    this.flames = new FlameSystem(scene, this.shared, this.atlas, { cap: 340 });

    /* ---------------- dynamic light pools ----------------
     * Fixed-size and always in the scene at zero intensity: three.js
     * recompiles every material when the visible light count changes, and
     * doing that mid-fight is a multi-frame stall. The pools are sized once
     * here, in the VFX constructor, which main.js runs before the city is
     * built — so every material compiles exactly once, already knowing
     * about them. Never add or remove a light after this point. */
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 24, 2);
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, power: 0 });
    }
    this.riftLights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xff5522, 0, 30, 2);
      scene.add(l);
      this.riftLights.push({ light: l, busy: false });
    }
    // two more: one rides the muzzle, one rides whatever is currently burning
    this.muzzleLight = new THREE.PointLight(0x9fe8ff, 0, 18, 2);
    scene.add(this.muzzleLight);
    this.flameLight = new THREE.PointLight(0xff7a2a, 0, 30, 2);
    scene.add(this.flameLight);
    this._muzzleGlow = 0;
    this._flameGlow = 0;

    /* ---------------- projectiles ---------------- */
    this.projectiles = [];
    this.projPool = [];

    /* ---------------- state ---------------- */
    this.pickupAssets = new Map();
    this.pickupList = [];
    // Built here, not on first pickup: main.js runs renderer.compile() at the
    // end of boot, and a material created later would compile mid-fight.
    this._pickupKit(0x7ddf64);   // health
    this._pickupKit(0x7de3ff);   // ammo
    // Same reasoning, one system further out: a rift's material cannot be
    // built until the rift exists, so this parks its program in the scene for
    // the boot prewarm to find. See warmRiftProgram().
    this._riftWarm = warmRiftProgram(scene, this.shared);
    this.rifts = [];
    this.dying = [];        // rift meshes mid-collapse
    this.patches = [];        // lingering burning ground
    this.barrelHeat = 0;
    this._ctx = null;
    this._depthIsLive = null;   // set by setLinearDepthTexture()
    this._hidden = false;      // setVisible(false) for artefact triage
    this._pending = { valid: false, type: '', x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, surface: null };
    this._seed = 0;

    /**
     * Screen-space effect state for the post stack. Nothing in this file
     * can composite a full-screen pass (the render engineer owns that), so
     * the intensities are published here instead — see the report.
     *   heat   0..1  heat-haze strength, driven by nearby flame
     *   pulse  0..1  radial distortion pulse from the last blast
     *   flash  0..1  additive screen flash
     */
    this.screen = {
      heat: 0, pulse: 0, flash: 0,
      pulseAt: new THREE.Vector3(), pulseRadius: 0,
      flashColor: new THREE.Color(0xffffff),
    };
  }

  /* ================================================================
     wiring hooks
     ================================================================ */

  /**
   * Turn soft particles on. Every smoke, dust, fire, shockwave, rift and
   * decal fragment then fades out as it approaches geometry instead of
   * slicing a hard line through it.
   *
   * UNITS ARE NOT NEGOTIABLE: `texture` must hold **positive linear view
   * distance in METRES** in its `.x`/`.r` channel — i.e. exactly what
   * `src/render/depth.js` (LinearDepthPass) resolves, and what
   * `render.passes.depth.texture` is. This consumer does no un-projection
   * and has no far plane, so raw [0,1] hardware depth will not work; with
   * near 0.12 / far 2400 it would also be crushed into the top 0.1% of the
   * range and useless in half float anyway. The `encoding` option exists
   * purely so a future caller cannot miswire this quietly.
   *
   * @param {THREE.Texture} texture
   * @param {object} opts
   *   encoding  must be 'linear-metres' (default); anything else throws
   *   isLive    optional `() => boolean`, sampled once per frame. Pass
   *             `() => render.passes.depth.enabled`: that pass self-disables
   *             when neither DOF nor god rays want it, and its target then
   *             holds a stale or blank buffer. While it reads false we fall
   *             back to the ground-contact fade rather than fading against
   *             depth that no longer describes this frame.
   */
  setLinearDepthTexture(texture, { encoding = 'linear-metres', isLive = null } = {}) {
    if (encoding !== 'linear-metres') {
      throw new Error(
        `VFX.setLinearDepthTexture: encoding must be 'linear-metres' (positive linear `
        + `view distance in metres in .x, as produced by LinearDepthPass in `
        + `src/render/depth.js) but got '${encoding}'. Raw [0,1] hardware depth is not `
        + 'supported — this consumer does no un-projection.',
      );
    }
    if (!texture) throw new Error('VFX.setLinearDepthTexture: no texture given.');
    this.shared.uniforms.uDepth.value = texture;
    this._depthIsLive = typeof isLive === 'function' ? isLive : null;
    // On by default from here: with no isLive gate we trust the texture, and
    // the shader still treats a zero/NaN sample as "no depth information".
    this.shared.uniforms.uSoft.value = 1;
  }

  /**
   * @deprecated Renamed so the units cannot be guessed wrong at the call
   * site. Throws rather than silently mis-fading everything.
   */
  setDepthTexture() {
    throw new Error(
      'VFX.setDepthTexture() has been renamed to setLinearDepthTexture(texture, '
      + "{ encoding: 'linear-metres' }) because it consumes linear view distance in "
      + 'metres (render.passes.depth.texture), not raw hardware depth.',
    );
  }

  /** Optional — target size is auto-detected per frame; this just overrides it. */
  setSize(width, height) {
    if (width > 0 && height > 0) this.shared.uniforms.uInvRes.value.set(1 / width, 1 / height);
  }

  /** Keep lit smoke/dust/decals consistent with the scene's key light. */
  setLighting({ sunDir, sunColor, ambient, sunIntensity = 1, ambientIntensity = 1 } = {}) {
    const u = this.shared.uniforms;
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();
    if (sunColor !== undefined) u.uSunCol.value.set(sunColor).multiplyScalar(sunIntensity);
    if (ambient !== undefined) u.uAmbCol.value.set(ambient).multiplyScalar(ambientIntensity);
  }

  /* ================================================================
     particles — public emitters
     ================================================================ */

  /**
   * Legacy single-particle emitter, unchanged signature (enemies.js drives
   * the dragon's breath sparks through it). Routes into the additive layer.
   */
  emit(x, y, z, vx, vy, vz, color, size, life, drag = 2.2, grav = 0) {
    const s = beginSpawn();
    s.x = x; s.y = y; s.z = z;
    s.vx = vx; s.vy = vy; s.vz = vz;
    s.r = color.r; s.g = color.g; s.b = color.b;
    s.size = size;
    s.size1 = size * 0.35;
    s.life = life;
    s.drag = drag;
    s.grav = grav;
    s.tile = TILE.GLOW;
    s.stretch = 0.012;
    s.ground = 0.04;
    this.embers.spawn(s);
  }

  /**
   * Radial burst. Same signature as before; now throws stretched sparks,
   * a couple of lit smoke puffs and a few debris flecks so a death or a
   * spawn pop reads as force rather than as confetti.
   */
  burst(pos, color, count, speed, opts = {}) {
    const rng = this.rng;
    const c = _c1.set(color);
    const size = opts.size ?? 0.28;
    const life = opts.life ?? 0.55;
    const up = opts.up ?? 0;
    const grav = opts.grav ?? 0;
    const drag = opts.drag ?? 3.0;
    const ground = this._groundAt(pos.x, pos.z, pos.y);
    const s = beginSpawn();
    for (let i = 0; i < count; i++) {
      const dx = rng.float(-1, 1);
      const dy = rng.float(-1, 1);
      const dz = rng.float(-1, 1);
      const len = Math.hypot(dx, dy, dz) || 1;
      const sp = speed * rng.float(0.35, 1.25);
      s.x = pos.x + (dx / len) * 0.15;
      s.y = pos.y + (dy / len) * 0.15;
      s.z = pos.z + (dz / len) * 0.15;
      s.vx = (dx / len) * sp;
      s.vy = (dy / len) * sp + up;
      s.vz = (dz / len) * sp;
      s.r = c.r; s.g = c.g; s.b = c.b;
      s.size = size * rng.float(0.5, 1.3);
      s.size1 = s.size * 0.25;
      s.life = life * rng.float(0.6, 1.4);
      s.drag = drag;
      s.grav = grav;
      s.ground = ground;
      s.tile = rng.chance(0.35) ? TILE.SPARK : TILE.GLOW;
      s.stretch = rng.chance(0.45) ? 0.03 : 0.008;
      s.alpha = 1;
      this.embers.spawn(s);
    }
    // a little body behind the sparks
    const puffs = Math.max(1, Math.round(count * 0.16));
    for (let i = 0; i < puffs; i++) {
      s.x = pos.x + rng.float(-0.4, 0.4);
      s.y = pos.y + rng.float(-0.2, 0.5);
      s.z = pos.z + rng.float(-0.4, 0.4);
      s.vx = rng.float(-1, 1) * speed * 0.12;
      s.vy = rng.float(0.4, 1.6);
      s.vz = rng.float(-1, 1) * speed * 0.12;
      _c2.set(color).lerp(_c1.set(0x101010), 0.72);
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      s.size = size * rng.float(2.4, 4.0);
      s.size1 = s.size * rng.float(2.0, 3.2);
      s.life = life * rng.float(2.0, 3.6);
      s.drag = 1.5;
      s.grav = -0.05;
      s.ground = ground;
      s.tile = rng.chance(0.5) ? TILE.SMOKE_A : TILE.SMOKE_B;
      s.alpha = 0.5;
      s.spin = rng.float(-0.7, 0.7);
      s.stretch = 0;
      this.smoke.spawn(s);
    }
  }

  /** Embers that drift, cool and die. */
  embersOut(x, y, z, count, speed, colour = 0xff8a3a, opts = {}) {
    const rng = this.rng;
    const c = _c1.set(colour);
    const ground = opts.ground ?? this._groundAt(x, z, y);
    const s = beginSpawn();
    for (let i = 0; i < count; i++) {
      const a = rng.float(0, Math.PI * 2);
      const el = rng.float(-0.3, 1.0);
      const sp = speed * rng.float(0.3, 1.3);
      s.x = x; s.y = y; s.z = z;
      s.vx = Math.cos(a) * sp;
      s.vy = el * sp + (opts.up ?? 1.2);
      s.vz = Math.sin(a) * sp;
      s.r = c.r * rng.float(0.8, 1.5);
      s.g = c.g * rng.float(0.6, 1.1);
      s.b = c.b * rng.float(0.4, 1.0);
      s.size = (opts.size ?? 0.1) * rng.float(0.6, 1.6);
      s.size1 = s.size * 0.2;
      s.life = (opts.life ?? 1.4) * rng.float(0.5, 1.7);
      s.drag = opts.drag ?? 1.1;
      s.grav = opts.grav ?? -0.16;
      s.ground = ground;
      s.tile = TILE.SPARK;
      s.stretch = 0.02;
      this.embers.spawn(s);
    }
  }

  /** Lit smoke puff. `colour` is albedo, not emission. */
  smokePuff(x, y, z, size, life, colour = 0x6a6058, opts = {}) {
    const rng = this.rng;
    const c = _c1.set(colour);
    const s = beginSpawn();
    s.x = x + rng.float(-0.2, 0.2);
    s.y = y;
    s.z = z + rng.float(-0.2, 0.2);
    s.vx = opts.vx ?? rng.float(-0.5, 0.5);
    s.vy = opts.vy ?? rng.float(0.5, 1.6);
    s.vz = opts.vz ?? rng.float(-0.5, 0.5);
    s.r = c.r; s.g = c.g; s.b = c.b;
    s.size = size;
    s.size1 = size * (opts.grow ?? 2.2);
    s.life = life;
    s.drag = opts.drag ?? 0.9;
    s.grav = opts.grav ?? -0.03;
    s.ground = opts.ground ?? 0.05;
    s.tile = rng.chance(0.5) ? TILE.SMOKE_A : TILE.SMOKE_B;
    s.alpha = opts.alpha ?? 0.55;
    s.spin = rng.float(-0.5, 0.5);
    this.smoke.spawn(s);
  }

  /** Dust knocked loose — surface coloured, settles quickly. */
  dust(x, y, z, count, size, colour, spread = 1.4, ground = 0.04) {
    const rng = this.rng;
    const c = _c1.set(colour);
    const s = beginSpawn();
    for (let i = 0; i < count; i++) {
      s.x = x + rng.float(-0.25, 0.25);
      s.y = y + rng.float(-0.1, 0.3);
      s.z = z + rng.float(-0.25, 0.25);
      s.vx = rng.float(-spread, spread);
      s.vy = rng.float(0.2, spread);
      s.vz = rng.float(-spread, spread);
      s.r = c.r; s.g = c.g; s.b = c.b;
      s.size = size * rng.float(0.6, 1.5);
      s.size1 = s.size * rng.float(1.8, 3.0);
      s.life = rng.float(0.7, 1.8);
      s.drag = 2.4;
      s.grav = -0.12;
      s.ground = ground;
      s.tile = TILE.DUST;
      s.alpha = 0.45;
      s.spin = rng.float(-0.8, 0.8);
      this.smoke.spawn(s);
    }
  }

  /** Solid flecks: chipped stone, splinters, armour plate. */
  debrisOut(x, y, z, count, speed, colour, ground = 0.03, sizeScale = 1) {
    const rng = this.rng;
    const c = _c1.set(colour);
    const s = beginSpawn();
    for (let i = 0; i < count; i++) {
      const a = rng.float(0, Math.PI * 2);
      const el = rng.float(0.1, 1.1);
      const sp = speed * rng.float(0.4, 1.4);
      s.x = x; s.y = y + 0.05; s.z = z;
      s.vx = Math.cos(a) * sp;
      s.vy = el * sp;
      s.vz = Math.sin(a) * sp;
      s.r = c.r; s.g = c.g; s.b = c.b;
      s.size = rng.float(0.05, 0.14) * sizeScale;
      s.size1 = s.size;
      s.life = rng.float(0.9, 2.2);
      s.drag = 0.5;
      s.grav = -1.5;
      s.ground = ground;
      s.tile = rng.chance(0.5) ? TILE.FLECK : TILE.SHARD;
      s.alpha = 1;
      s.spin = rng.float(-9, 9);
      this.debris.spawn(s);
    }
  }

  /** Shaped flash — a star, a crescent and a barrel streak, never a disc. */
  shapedFlash(x, y, z, dx, dy, dz, size, colour, life = 0.06, intensity = 1) {
    const rng = this.rng;
    const c = _c1.set(colour);
    const s = beginSpawn();
    s.x = x; s.y = y; s.z = z;
    s.r = c.r * (2.6 * intensity); s.g = c.g * (2.4 * intensity); s.b = c.b * (2.2 * intensity);
    s.life = life;
    s.drag = 40;
    s.ground = -1e4;
    s.tile = TILE.STAR;
    s.size = size;
    s.size1 = size * 1.5;
    s.spin = rng.float(-4, 4);
    this.embers.spawn(s);
    // second lobe, off-axis, so consecutive shots never look identical
    s.tile = TILE.CRESCENT;
    s.size = size * rng.float(0.6, 1.0);
    s.size1 = s.size * 1.8;
    s.life = life * 1.5;
    s.spin = rng.float(-3, 3);
    s.r *= 0.7; s.g *= 0.7; s.b *= 0.7;
    this.embers.spawn(s);
    // a stretched streak down the barrel axis
    s.tile = TILE.STREAK;
    s.vx = dx * 9; s.vy = dy * 9; s.vz = dz * 9;
    s.size = size * 0.55;
    s.size1 = size * 0.2;
    s.life = life * 1.2;
    s.stretch = 0.09;
    s.spin = 0;
    this.embers.spawn(s);
  }

  /* ================================================================
     projectiles
     ================================================================ */
  spawnProjectile(origin, dir, opts = {}) {
    let p = this.projPool.pop();
    if (!p) {
      p = {
        pos: new THREE.Vector3(), dir: new THREE.Vector3(), colour: new THREE.Color(),
        speed: 150, damage: 30, owner: 'player', life: 2.2, radius: 0.35,
        splash: 0, scale: 1, trail: 3.2, travelled: 0, seed: 0, acc: 0,
      };
    }
    p.pos.copy(origin);
    p.dir.copy(dir).normalize();
    p.colour.set(opts.color ?? 0x7fe4ff);
    p.speed = opts.speed ?? 150;
    p.damage = opts.damage ?? 30;
    p.owner = opts.owner ?? 'player';
    p.life = opts.life ?? 2.2;
    p.radius = opts.radius ?? 0.35;
    p.splash = opts.splash ?? 0;
    p.scale = opts.scale ?? 1;
    p.trail = (opts.trail ?? 3.2) * p.scale;
    p.travelled = 0;
    p.acc = 0;
    p.seed = this._nextSeed();
    this.projectiles.push(p);

    /* ---- muzzle flash: shaped flash, sparks, a puff, and a light ---- */
    const player = p.owner === 'player';
    const size = player ? 0.85 * p.scale : 1.15 * p.scale;
    this.shapedFlash(
      origin.x + p.dir.x * 0.15, origin.y + p.dir.y * 0.15, origin.z + p.dir.z * 0.15,
      p.dir.x, p.dir.y, p.dir.z,
      size, opts.color ?? 0x7fe4ff, player ? 0.055 : 0.085, player ? 1 : 0.85,
    );
    const rng = this.rng;
    const s = beginSpawn();
    for (let i = 0; i < (player ? 7 : 10); i++) {
      const sp = rng.float(4, 16) * p.scale;
      s.x = origin.x; s.y = origin.y; s.z = origin.z;
      s.vx = p.dir.x * sp + rng.float(-2.2, 2.2);
      s.vy = p.dir.y * sp + rng.float(-2.2, 2.2);
      s.vz = p.dir.z * sp + rng.float(-2.2, 2.2);
      _c2.set(opts.color ?? 0x7fe4ff).multiplyScalar(rng.float(1.1, 2.2));
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      s.size = rng.float(0.05, 0.13) * p.scale;
      s.size1 = s.size * 0.2;
      s.life = rng.float(0.08, 0.28);
      s.drag = 7;
      s.grav = -0.2;
      s.ground = -1e4;
      s.tile = TILE.SPARK;
      s.stretch = 0.05;
      this.embers.spawn(s);
    }
    if (player) {
      this.barrelHeat = Math.min(1.35, this.barrelHeat + 0.17);
      this._muzzleGlow = 1;
      this.muzzleLight.color.copy(p.colour);
      this.muzzleLight.position.copy(origin);
      this.haze.spawn(this._hazeAt(origin.x, origin.y, origin.z, 0.5, 0.22, 0xffb070));
    } else {
      this.smokePuff(origin.x, origin.y, origin.z, 0.35 * p.scale, 0.5, 0x40342c,
        { vy: 0.8, alpha: 0.35, grow: 2.6 });
      this.flash(origin, opts.color ?? 0xff8a3a, 5 * p.scale, 0.07);
    }
    return p;
  }

  /* ================================================================
     impacts
     ================================================================ */

  /**
   * Surface-aware impact. `impactSpark()` funnels into this; call it
   * directly when you already know the normal and the surface.
   *
   * @param {THREE.Vector3} point
   * @param {{x,y,z}} normal        surface normal (defaults to up)
   * @param {object} opts
   *   surface  SURFACES id string: 'stone'|'asphalt'|'cobble'|'wood'|
   *            'metal'|'glass'|'grass' (default 'stone')
   *   colour   bolt colour, for the flash and the sparks
   *   power    0..1, scales everything
   *   decal    place a mark (default true)
   */
  impact(point, normal = UP, opts = {}) {
    const rng = this.rng;
    const surfId = opts.surface || 'stone';
    const spec = SURFACE_DECALS[surfId] || SURFACE_DECALS.stone;
    const power = opts.power ?? 0.5;
    const colour = opts.colour ?? 0xffd08a;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    const px = point.x + nx * 0.04;
    const py = point.y + ny * 0.04;
    const pz = point.z + nz * 0.04;
    const ground = ny > 0.6 ? point.y + 0.02 : this._groundAt(point.x, point.z, point.y);

    // flash, oriented out of the surface
    this.shapedFlash(px, py, pz, nx, ny, nz, 0.5 + power * 0.9, colour, 0.06, 0.8 + power);

    /* sparks: hot, stretched, bouncing off the surface */
    const sparks = Math.round(6 + power * 16);
    const s = beginSpawn();
    for (let i = 0; i < sparks; i++) {
      const sp = rng.float(3, 11) * (0.6 + power);
      const jx = rng.float(-1, 1);
      const jy = rng.float(-1, 1);
      const jz = rng.float(-1, 1);
      s.x = px; s.y = py; s.z = pz;
      s.vx = (nx + jx * 0.85) * sp;
      s.vy = (ny + jy * 0.85) * sp + 1.2;
      s.vz = (nz + jz * 0.85) * sp;
      _c2.set(colour).multiplyScalar(rng.float(1.2, 2.6));
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      s.size = rng.float(0.04, 0.12);
      s.size1 = s.size * 0.15;
      s.life = rng.float(0.18, 0.7);
      s.drag = 1.6;
      s.grav = -1.1;
      s.ground = ground;
      s.tile = TILE.SPARK;
      s.stretch = 0.055;
      s.alpha = 1;
      this.embers.spawn(s);
    }

    /* a puff of the surface's own colour, plus chips */
    this.dust(px + nx * 0.1, py + ny * 0.1, pz + nz * 0.1,
      2 + Math.round(power * 4), 0.22 + power * 0.3, spec.dust, 1.2 + power * 2.2, ground);
    this.debrisOut(px, py, pz, 2 + Math.round(power * 6), 3 + power * 6, spec.dust, ground,
      0.7 + power);
    if (surfId === 'glass') {
      this.debrisOut(px, py, pz, 8, 5 + power * 6, 0xd8f4ff, ground, 0.8);
    }
    if (surfId === 'wood' || surfId === 'grass') {
      this.smokePuff(px, py + 0.1, pz, 0.3, 0.9, 0x2e2620, { alpha: 0.4, vy: 1.1 });
    }

    /* the mark it leaves */
    if (opts.decal !== false) {
      const size = 0.55 + power * 1.5;
      this.decals.add(point, normal, size, spec.impact, 0xffffff,
        0.75 + power * 0.25, 46, rng.next());
      if (power > 0.45 || rng.chance(0.35)) {
        this.decals.add(point, normal, size * rng.float(1.3, 2.1), DECAL.SCORCH,
          0x8a7a6a, 0.32 + power * 0.35, 40, rng.next());
      }
      if (power > 0.6 && (surfId === 'stone' || surfId === 'cobble' || surfId === 'asphalt')) {
        this.decals.add(point, normal, size * 2.0, spec.crack, 0xffffff, 0.45, 55, rng.next());
      }
    }

    /* impacts on a wall shake dust off the wall itself */
    if (Math.abs(ny) < 0.7) {
      this.dust(px, py + 0.4 + power, pz, 2 + Math.round(power * 3), 0.3, spec.dust, 0.5, ground);
    }
    if (power > 0.5) this.flash(point, colour, 6 + power * 14, 0.1 + power * 0.1);
    this.haze.spawn(this._hazeAt(px, py, pz, 0.6 + power, 0.3, 0xff9a60));
  }

  /**
   * Original entry point. main.js and enemies.js call this without a normal,
   * so we recover one from the projectile hit we just resolved (see
   * `_pending`), and fall back to "flat ground, stone" when there is none —
   * which is what a melee hit or a script-driven spark gets.
   */
  impactSpark(point, color = 0xffd08a, big = false) {
    const pend = this._pending;
    let normal = UP;
    let surface = 'stone';
    let type = '';
    if (pend.valid
      && Math.abs(pend.x - point.x) < 0.75
      && Math.abs(pend.y - point.y) < 0.75
      && Math.abs(pend.z - point.z) < 0.75) {
      type = pend.type;
      _n1.set(pend.nx, pend.ny, pend.nz);
      normal = _n1;
      surface = (pend.surface && pend.surface.id) || 'stone';
    }

    if (type === 'enemy') {
      this.creatureHit(point, color, big);
      return;
    }
    if (type === 'player') {
      // the player's own armour: sparks and scorch, no creature ichor
      this.embersOut(point.x, point.y, point.z, big ? 16 : 9, big ? 7 : 4.5, color,
        { size: 0.1, life: 0.4, up: 1.4 });
      this.shapedFlash(point.x, point.y, point.z, 0, 1, 0, big ? 1.0 : 0.6, color, 0.06, 1.1);
      this.smokePuff(point.x, point.y, point.z, 0.3, 0.8, 0x241d18,
        { alpha: 0.35, vy: 1.4, ground: -1e4 });
      return;
    }

    // A rift being shot: main.js resolves that as a world hit near a rift.
    const rift = this._riftNear(point, 4.2);
    if (rift) {
      rift.flinch(big ? 0.9 : 0.45);
      this.embersOut(point.x, point.y, point.z, big ? 16 : 9, 6, 0xff7a30,
        { size: 0.12, life: 0.7, up: 2.2 });
      this.shapedFlash(point.x, point.y, point.z, 0, 1, 0, big ? 1.6 : 1.0, 0xffb070, 0.07, 1.2);
      this.flash(point, 0xff7a30, big ? 18 : 9, 0.12);
      return;
    }

    // No resolved surface (a melee swing, a scripted spark) means we do not
    // know what we hit — only mark something if the point is basically on the
    // deck, otherwise we would hang a stone chip in mid-air.
    let decal = true;
    if (!pend.valid) {
      decal = point.y - this._groundAt(point.x, point.z, point.y) < 0.45;
    }
    this.impact(point, normal, {
      surface, colour: color, power: big ? 0.85 : 0.4, decal,
    });
  }

  /** Creature hit: a dark ichor mist, no blood red anywhere. */
  creatureHit(point, colour = 0xbfffd0, big = false) {
    const rng = this.rng;
    const n = big ? 18 : 10;
    const ground = this._groundAt(point.x, point.z, point.y);
    const s = beginSpawn();
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, Math.PI * 2);
      const sp = rng.float(1.5, big ? 7 : 4.5);
      s.x = point.x; s.y = point.y; s.z = point.z;
      s.vx = Math.cos(a) * sp;
      s.vy = rng.float(-0.4, 1.6) * sp * 0.4 + 1.0;
      s.vz = Math.sin(a) * sp;
      _c2.set(0x121a14).lerp(_c1.set(colour), rng.float(0.02, 0.16));
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      s.size = rng.float(0.1, 0.3) * (big ? 1.6 : 1);
      s.size1 = s.size * rng.float(1.6, 2.6);
      s.life = rng.float(0.35, 1.1);
      s.drag = 3.2;
      s.grav = -0.5;
      s.ground = ground;
      s.tile = rng.chance(0.4) ? TILE.ICHOR : TILE.SMOKE_B;
      s.alpha = 0.7;
      s.spin = rng.float(-1.5, 1.5);
      this.smoke.spawn(s);
    }
    // the hit itself still sparks — energy weapon on chitin
    this.embersOut(point.x, point.y, point.z, big ? 12 : 6, big ? 7 : 4.5, colour,
      { size: 0.09, life: 0.35, up: 1.2, ground });
    this.shapedFlash(point.x, point.y, point.z, 0, 1, 0, big ? 0.9 : 0.55, colour, 0.05, 0.9);
    if (this.rng.chance(big ? 0.7 : 0.28)) {
      _v1.set(point.x, ground + 0.01, point.z);
      this.decals.add(_v1, UP, this.rng.float(0.8, 1.6), DECAL.ICHOR_SPLAT, 0xffffff,
        0.6, 26, this.rng.next());
    }
  }

  /* ================================================================
     explosions
     ================================================================ */

  /**
   * Layered explosion. Small blasts are sharp and spark-heavy; big ones get
   * more puffs, a slower cook, a real smoke column, more debris and a
   * longer light. They are not the same effect resized.
   */
  explosion(pos, radius, color = 0xffa04a, opts = {}) {
    const rng = this.rng;
    const r = Math.max(0.8, radius);
    const big = r >= 9;
    const mid = r >= 4;
    const ground = this._groundAt(pos.x, pos.z, pos.y);
    const tint = color;

    /* mark any rift we just landed on, so its dispose() plays a collapse */
    const rift = this._riftNear(pos, 7);
    if (rift) rift._collapsing = 1;

    /* 1. core flash — small, white-hot, gone in three frames */
    this.fireballs.puff(pos.x, pos.y, pos.z, 0, 0, 0,
      r * 0.12, r * 0.5, 0.14, 0xffffff, 1.6, 0.02, this._nextSeed(), 0);
    this.shapedFlash(pos.x, pos.y, pos.z, 0, 1, 0, r * 0.55, 0xfff0d0, 0.09, 1.6);

    /* 2. fireball — overlapping turbulent puffs */
    const puffs = big ? 11 : mid ? 7 : 4;
    for (let i = 0; i < puffs; i++) {
      const a = rng.float(0, Math.PI * 2);
      const el = rng.float(-0.35, 0.95);
      const off = rng.float(0, r * 0.32);
      this.fireballs.puff(
        pos.x + Math.cos(a) * off, pos.y + el * off * 0.8, pos.z + Math.sin(a) * off,
        Math.cos(a) * r * rng.float(0.3, 0.9), rng.float(0.2, 1.1) * r * 0.35, Math.sin(a) * r * rng.float(0.3, 0.9),
        r * 0.16, r * rng.float(0.35, 0.62),
        (big ? 0.95 : mid ? 0.72 : 0.5) * rng.float(0.8, 1.3),
        tint,
        rng.float(0.85, 1.25),
        rng.float(0.45, 0.85),
        this._nextSeed(), rng.float(-1.4, 1.4),
      );
    }

    /* 3. ground shockwave — dust ring racing outward */
    this.shocks.ring(pos.x, ground + 0.05, pos.z, r * 0.25, r * (big ? 2.4 : 1.9),
      big ? 0.85 : 0.55, tint, big ? 0.85 : 0.6, big ? 1.2 : 0.5, this._nextSeed());
    if (big) {
      this.shocks.ring(pos.x, ground + 0.04, pos.z, r * 0.4, r * 3.4, 1.35, 0xb8a894, 0.5, 2.2,
        this._nextSeed());
    }
    _ex1.set(pos.x, ground + 0.01, pos.z);
    this.decals.add(_ex1, UP, r * 1.5, DECAL.SCORCH, 0xffffff, big ? 0.85 : 0.6, big ? 110 : 70,
      rng.next());
    if (mid) {
      this.decals.add(_ex1, UP, r * 2.6, DECAL.DUST_RING, 0xffffff, 0.4, 55, rng.next());
    }

    /* 4. debris and embers thrown outward */
    this.debrisOut(pos.x, pos.y, pos.z, big ? 34 : mid ? 20 : 10, r * 1.4, 0x6b6258, ground,
      big ? 1.6 : 1);
    this.embersOut(pos.x, pos.y, pos.z, big ? 46 : mid ? 28 : 16, r * 1.9, tint,
      { size: 0.13, life: big ? 2.1 : 1.2, up: r * 0.25, ground, drag: 0.9, grav: -0.35 });

    /* 5. lingering smoke column that rises and disperses */
    const columns = big ? 9 : mid ? 5 : 2;
    for (let i = 0; i < columns; i++) {
      const t = i / columns;
      this.smokePuff(
        pos.x + rng.float(-r * 0.2, r * 0.2),
        pos.y + t * r * 0.45,
        pos.z + rng.float(-r * 0.2, r * 0.2),
        r * rng.float(0.18, 0.34), (big ? 4.2 : mid ? 2.8 : 1.7) * rng.float(0.8, 1.3),
        i === 0 ? 0x3a2c22 : 0x2a2420,
        {
          vy: rng.float(1.4, 3.4) * (1 - t * 0.4), grow: rng.float(2.4, 4.0),
          drag: 0.55, grav: 0.02, alpha: 0.62, ground,
        },
      );
    }
    for (let i = 0; i < (big ? 5 : 2); i++) {
      this.haze.spawn(this._hazeAt(
        pos.x + rng.float(-r * 0.3, r * 0.3), pos.y + rng.float(0, r * 0.4),
        pos.z + rng.float(-r * 0.3, r * 0.3), r * 0.5, 0.6, 0xff9a5a,
      ));
    }

    /* 6. dust blasted off nearby walls */
    this._wallDust(pos, r);

    /* 7. light and screen */
    this.flash(pos, tint, r * (big ? 9 : 7), big ? 0.55 : 0.34);
    this.screen.pulse = Math.min(1, this.screen.pulse + (big ? 1 : 0.55));
    this.screen.pulseAt.copy(pos);
    this.screen.pulseRadius = r;
    this.screen.flash = Math.min(1, this.screen.flash + (big ? 0.5 : 0.22));
    this.screen.flashColor.set(tint);
    void opts;
  }

  flash(pos, color, power, life) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.life <= 0) { best = l; break; }
    best.light.color.set(color);
    best.light.position.copy(pos);
    best.power = power;
    best.life = life;
    best.max = life;
  }

  /* ================================================================
     flame — the dragon's breath and the fires it leaves
     ================================================================ */

  /**
   * One tick of a flamethrower. `dt`-rate driven, so the jet has the same
   * density at any frame rate.
   *
   * @param {THREE.Vector3} origin  nozzle
   * @param {THREE.Vector3} dir     normalised jet direction
   * @param {number} dt
   * @param {object} opts  { power=1, range=20, ground }
   */
  flameBreath(origin, dir, dt, opts = {}) {
    const rng = this.rng;
    const power = opts.power ?? 1;
    const range = opts.range ?? 20;
    const ground = opts.ground ?? this._groundAt(origin.x, origin.z, origin.y);

    this._flameAcc = (this._flameAcc ?? 0) + dt * 105 * power;
    while (this._flameAcc >= 1) {
      this._flameAcc -= 1;
      const sp = rng.float(15, 30) * power;
      const jx = rng.float(-0.13, 0.13);
      const jy = rng.float(-0.10, 0.16);
      const jz = rng.float(-0.13, 0.13);
      this.flames.blob(
        origin.x + dir.x * 1.4, origin.y + dir.y * 1.4, origin.z + dir.z * 1.4,
        (dir.x + jx) * sp, (dir.y + jy) * sp, (dir.z + jz) * sp,
        rng.float(0.65, 1.15),
        rng.float(0.5, 0.9) * power,
        rng.float(2.4, 4.2) * power,
        rng.float(0.8, 2.0),
        rng.float(1.4, 3.2),
        ground,
        this._nextSeed(),
      );
    }
    // sooty tail and embers riding the jet
    this._flameSmokeAcc = (this._flameSmokeAcc ?? 0) + dt * 22 * power;
    while (this._flameSmokeAcc >= 1) {
      this._flameSmokeAcc -= 1;
      const d = rng.float(3, range * 0.7);
      this.smokePuff(
        origin.x + dir.x * d, origin.y + dir.y * d + rng.float(0.2, 1.6), origin.z + dir.z * d,
        rng.float(0.8, 1.6) * power, rng.float(1.6, 3.2), 0x1c1712,
        { vy: rng.float(1.6, 3.6), vx: dir.x * 3, vz: dir.z * 3, grow: 3.2, alpha: 0.6, ground },
      );
      this.embersOut(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d,
        2, 3.5, 0xff9a3a, { size: 0.11, life: 1.6, up: 2.6, ground, drag: 0.8, grav: -0.2 });
      this.haze.spawn(this._hazeAt(
        origin.x + dir.x * d, origin.y + dir.y * d + 0.6, origin.z + dir.z * d,
        1.8 * power, 0.7, 0xff8a4a,
      ));
    }

    // the jet lights the world it is sweeping across
    this._flameGlow = Math.max(this._flameGlow, power);
    this.flameLight.position.set(
      origin.x + dir.x * 5.5, origin.y + dir.y * 5.5 + 0.6, origin.z + dir.z * 5.5,
    );

    // where it lands: scorch the ground, and leave it burning
    this._scorchAcc = (this._scorchAcc ?? 0) + dt;
    if (this._scorchAcc > 0.12 && this._ctx && this._ctx.collision) {
      this._scorchAcc = 0;
      const hit = this._ctx.collision.raycastHit(origin, dir, range);
      if (hit.hit) {
        _fl1.set(hit.px, hit.py, hit.pz);
        _fl2.set(hit.nx, hit.ny, hit.nz);
        this.scorch(_fl1, _fl2, rng.float(2.4, 4.4) * power, 0.6, 90);
        this.addBurningPatch(_fl1.x, _fl1.y, _fl1.z, rng.float(1.6, 2.8) * power,
          rng.float(2.5, 4.5));
        this.dust(_fl1.x + _fl2.x * 0.2, _fl1.y + _fl2.y * 0.2, _fl1.z + _fl2.z * 0.2,
          2, 0.5, 0x30281f, 2.0, _fl1.y);
      }
    }
    this.screen.heat = Math.min(1, this.screen.heat + dt * 2.4 * power);
  }

  /** A patch of ground that keeps burning after the flame has swept past. */
  addBurningPatch(x, y, z, radius, life) {
    if (this.patches.length >= 14) this.patches.shift();
    // merge into an existing patch rather than stacking fire on fire
    for (const p of this.patches) {
      if (Math.abs(p.x - x) < radius && Math.abs(p.z - z) < radius) {
        p.life = Math.max(p.life, life);
        p.radius = Math.max(p.radius, radius);
        return p;
      }
    }
    const patch = { x, y, z, radius, life, max: life, acc: 0, sacc: 0 };
    this.patches.push(patch);
    _v1.set(x, y + 0.01, z);
    this.decals.add(_v1, UP, radius * 2.6, DECAL.BURN_RING, 0xffffff, 0.8, 60, this.rng.next());
    return patch;
  }

  /** Scorch a surface (used by flame, rifts and explosions). */
  scorch(point, normal, size, alpha = 0.6, life = 80) {
    this.decals.add(point, normal, size, DECAL.SCORCH_SOFT, 0xffffff, alpha, life,
      this.rng.next());
  }

  /* ================================================================
     rifts
     ================================================================ */
  makeRift(pos, scale = 1) {
    return createRift(this, this.scene, this.shared, pos, scale);
  }

  acquireRiftLight() {
    const slot = this.riftLights.find((l) => !l.busy) ?? null;
    if (slot) slot.busy = true;
    return slot;
  }

  rememberRift(rift) {
    this.rifts.push(rift);
  }

  /** Takes ownership of a killed rift's mesh for the length of its collapse. */
  adoptDyingRift(mesh, geo, mat, dur = 0.34) {
    this.dying.push({ mesh, geo, mat, t: 0, dur });
  }

  _updateDying(dt) {
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      d.mat.uniforms.uCollapse.value = k;
      d.mat.uniforms.uPulse.value = 1;
      if (k >= 1) {
        this.scene.remove(d.mesh);
        d.geo.dispose();
        d.mat.dispose();
        this.dying.splice(i, 1);
      }
    }
  }

  forgetRift(rift) {
    const i = this.rifts.indexOf(rift);
    if (i >= 0) this.rifts.splice(i, 1);
  }

  /** Reality tearing open: a hard shove of dust, debris and light. */
  riftOpen(pos, scale) {
    const rng = this.rng;
    const ground = this._groundAt(pos.x, pos.z, pos.y);
    this.shocks.ring(pos.x, ground + 0.05, pos.z, 1.5 * scale, 16 * scale, 0.8, 0xff7a3a, 0.9,
      1.4, this._nextSeed());
    this.shocks.ring(pos.x, ground + 0.04, pos.z, 2.5 * scale, 26 * scale, 1.5, 0xb0a090, 0.55,
      2.6, this._nextSeed());
    this.debrisOut(pos.x, pos.y + 0.3, pos.z, 26, 9 * scale, 0x6b6258, ground, 1.3);
    this.dust(pos.x, pos.y + 0.4, pos.z, 12, 1.2 * scale, 0x8e867a, 5 * scale, ground);
    this.embersOut(pos.x, pos.y + 0.8, pos.z, 40, 9 * scale, 0xff6a2a,
      { size: 0.16, life: 2.0, up: 4, ground, drag: 0.8, grav: -0.25 });
    for (let i = 0; i < 5; i++) {
      this.fireballs.puff(
        pos.x + rng.float(-2, 2) * scale, pos.y + rng.float(0.5, 3) * scale,
        pos.z + rng.float(-2, 2) * scale,
        rng.float(-3, 3), rng.float(1, 4), rng.float(-3, 3),
        0.6 * scale, 3.2 * scale, 0.9, 0xff5a22, 0.8, 0.7, this._nextSeed(),
        rng.float(-1, 1),
      );
    }
    this.flash(_v1.set(pos.x, pos.y + 2, pos.z), 0xff7a30, 90 * scale, 0.7);
    this.screen.pulse = Math.min(1, this.screen.pulse + 0.8);
    this.screen.pulseAt.copy(pos);
    this.screen.pulseRadius = 8 * scale;
  }

  /** Ambient inflow — grit and embers dragged in towards the tear. */
  riftInflow(pos, scale, t) {
    const rng = this.rng;
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(5, 13) * scale;
    const x = pos.x + Math.cos(a) * r;
    const z = pos.z + Math.sin(a) * r;
    const y = pos.y + rng.float(0.05, 4.5) * scale;
    // aim inward with a tangential kick: the trajectory curves into the tear
    const inx = -Math.cos(a);
    const inz = -Math.sin(a);
    const tang = rng.float(-1, 1) * 0.55;
    const sp = rng.float(2.5, 6.5) * scale;
    const s = beginSpawn();
    s.x = x; s.y = y; s.z = z;
    s.vx = (inx - inz * tang) * sp;
    s.vy = rng.float(0.2, 2.4);
    s.vz = (inz + inx * tang) * sp;
    _c2.set(0xff6a2a).multiplyScalar(rng.float(0.9, 2.1));
    s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
    s.size = rng.float(0.06, 0.17) * scale;
    s.size1 = s.size * 0.2;
    s.life = rng.float(0.9, 1.9);
    s.drag = 0.55;
    s.grav = 0.02;
    s.ground = -1e4;
    s.tile = TILE.SPARK;
    s.stretch = 0.03;
    this.embers.spawn(s);
    if (rng.chance(0.22)) {
      s.tile = rng.chance(0.5) ? TILE.FLECK : TILE.ASH;
      s.size = rng.float(0.05, 0.12) * scale;
      s.size1 = s.size;
      s.spin = rng.float(-8, 8);
      _c2.set(0x4a423a);
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      this.debris.spawn(s);
    }
    void t;
  }

  /** Wisps of hot air peeling off the rim. */
  riftWisp(pos, scale) {
    const rng = this.rng;
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(0.6, 3.4) * scale;
    this.smokePuff(
      pos.x + Math.cos(a) * r, pos.y + rng.float(0.4, 4.0) * scale, pos.z + Math.sin(a) * r,
      rng.float(0.4, 1.0) * scale, rng.float(1.6, 3.4), 0x30231c,
      { vy: rng.float(1.2, 3.0), grow: 3.0, alpha: 0.30, drag: 0.5, ground: pos.y },
    );
    if (rng.chance(0.5)) {
      this.haze.spawn(this._hazeAt(
        pos.x + Math.cos(a) * r, pos.y + rng.float(0.5, 5) * scale, pos.z + Math.sin(a) * r,
        1.6 * scale, 1.1, 0xff8a4a,
      ));
    }
  }

  /** The tear failing: implosion, then everything sprays back out. */
  riftCollapse(pos, scale) {
    const rng = this.rng;
    const ground = this._groundAt(pos.x, pos.z, pos.y);
    // implosion — everything rushes in
    for (let i = 0; i < 60; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(6, 20) * scale;
      const s = beginSpawn();
      s.x = pos.x + Math.cos(a) * r;
      s.y = pos.y + rng.float(0.2, 8) * scale;
      s.z = pos.z + Math.sin(a) * r;
      const sp = r * rng.float(1.6, 2.6);
      s.vx = -Math.cos(a) * sp;
      s.vy = rng.float(-1, 3);
      s.vz = -Math.sin(a) * sp;
      _c2.set(0xffb070).multiplyScalar(rng.float(1.2, 2.6));
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      s.size = rng.float(0.08, 0.22) * scale;
      s.size1 = s.size * 0.1;
      s.life = rng.float(0.25, 0.5);
      s.drag = 0.2;
      s.ground = -1e4;
      s.tile = TILE.STREAK;
      s.stretch = 0.11;
      this.embers.spawn(s);
    }
    this.shocks.ring(pos.x, ground + 0.06, pos.z, 0.5 * scale, 30 * scale, 1.1, 0xffd0a0, 1.0,
      1.8, this._nextSeed());
    this.shocks.ring(pos.x, ground + 0.05, pos.z, 1.0 * scale, 44 * scale, 2.0, 0x9a8e80, 0.6,
      3.4, this._nextSeed());
    for (let i = 0; i < 9; i++) {
      const a = rng.float(0, Math.PI * 2);
      this.fireballs.puff(
        pos.x + rng.float(-1, 1) * scale, pos.y + rng.float(1, 5) * scale,
        pos.z + rng.float(-1, 1) * scale,
        Math.cos(a) * rng.float(3, 12), rng.float(2, 8), Math.sin(a) * rng.float(3, 12),
        1.0 * scale, rng.float(4, 8) * scale, rng.float(1.1, 1.9), 0xff6a28,
        rng.float(0.9, 1.3), rng.float(0.6, 0.95), this._nextSeed(), rng.float(-1.5, 1.5),
      );
    }
    this.debrisOut(pos.x, pos.y + 1, pos.z, 40, 16 * scale, 0x6b6258, ground, 1.7);
    this.embersOut(pos.x, pos.y + 1, pos.z, 70, 16 * scale, 0xff8a3a,
      { size: 0.16, life: 2.6, up: 6, ground, drag: 0.7, grav: -0.3 });
    for (let i = 0; i < 8; i++) {
      this.smokePuff(pos.x + rng.float(-3, 3) * scale, pos.y + rng.float(0.5, 6) * scale,
        pos.z + rng.float(-3, 3) * scale, rng.float(1.2, 2.6) * scale, rng.float(3.5, 6),
        0x241d18, { vy: rng.float(1.5, 4), grow: 3.4, alpha: 0.7, drag: 0.4, ground });
    }
    _v1.set(pos.x, ground + 0.01, pos.z);
    this.decals.add(_v1, UP, 16 * scale, DECAL.SCORCH, 0xffffff, 0.9, 200, rng.next());
    this.decals.add(_v1, UP, 26 * scale, DECAL.DUST_RING, 0xffffff, 0.5, 140, rng.next());
    this.flash(_v1.set(pos.x, pos.y + 2, pos.z), 0xffd0a0, 220 * scale, 0.9);
    this.screen.pulse = 1;
    this.screen.pulseAt.copy(pos);
    this.screen.pulseRadius = 14 * scale;
    this.screen.flash = Math.min(1, this.screen.flash + 0.7);
    this.screen.flashColor.set(0xffd0a0);
    this._wallDust(pos, 14 * scale);
  }

  /* ---------------- pickup beacon ----------------
   * Was three draw calls per pickup (a lit box, an additive sprite halo and
   * an open cylinder for the shaft). Now: the boxes of all pickups sharing a
   * colour are one InstancedMesh — so two draw calls for the whole game, no
   * matter how many crates are on the square — and the halo and the light
   * shaft are re-emitted every frame into the shared additive particle
   * layer, which costs no draw call at all and picks up the bloom.
   *
   * `box` is now a transform carrier rather than a Mesh: main.js writes
   * `box.rotation` and `group.position` exactly as before, and we read the
   * resulting world matrix back into the instance each frame. `group` is
   * still the Object3D main.js adds to and removes from the scene, and
   * removing it is how we learn the pickup is gone. */
  makePickupVisual(color = 0x7ddf64) {
    const kit = this._pickupKit(color);
    const group = new THREE.Group();
    const box = new THREE.Object3D();
    box.position.y = 0.8;
    group.add(box);
    const rec = {
      group, box, kit, colour: color, slot: kit.alloc(), t: this.rng.float(0, 6), acc: 0,
    };
    this.pickupList.push(rec);
    // `halo` was in the old return value; keep a live Object3D there so any
    // caller that still pokes it cannot crash, but nothing reads it today.
    return { group, box, halo: new THREE.Object3D() };
  }

  /** One InstancedMesh (and one material) per pickup colour, pooled. */
  _pickupKit(colour) {
    let kit = this.pickupAssets.get(colour);
    if (kit) return kit;
    const geometry = new THREE.BoxGeometry(0.42, 0.42, 0.42);
    const material = new THREE.MeshStandardMaterial({
      color: colour, emissive: colour, emissiveIntensity: 1.6, roughness: 0.4,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, PICKUP_CAP);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(mesh);
    kit = {
      mesh,
      geometry,
      material,
      used: new Uint8Array(PICKUP_CAP),
      high: 0,
      dirty: false,
      alloc() {
        for (let i = 0; i < PICKUP_CAP; i++) {
          if (kit.used[i]) continue;
          kit.used[i] = 1;
          if (i + 1 > kit.high) kit.high = i + 1;
          kit.mesh.count = kit.high;
          return i;
        }
        return -1;   // over the cap: the pickup still works, it just has no crate
      },
      free(slot) {
        if (slot < 0) return;
        kit.used[slot] = 0;
        _mat4.makeScale(0, 0, 0);
        kit.mesh.setMatrixAt(slot, _mat4);
        kit.dirty = true;
        while (kit.high > 0 && !kit.used[kit.high - 1]) kit.high--;
        kit.mesh.count = kit.high;
      },
    };
    this.pickupAssets.set(colour, kit);
    return kit;
  }

  /**
   * Push each live pickup's transform into its instance and re-emit its
   * marker. main.js owns the lifetime and simply removes the group from the
   * scene, so a null parent is how a freed pickup is detected — no extra
   * call needed on their side.
   */
  _updatePickups(dt) {
    if (this.pickupList.length === 0) return;
    for (let i = this.pickupList.length - 1; i >= 0; i--) {
      const rec = this.pickupList[i];
      if (!rec.group.parent) {
        rec.kit.free(rec.slot);
        this.pickupList.splice(i, 1);
        continue;
      }
      if (rec.slot >= 0) {
        rec.box.updateWorldMatrix(true, false);
        rec.kit.mesh.setMatrixAt(rec.slot, rec.box.matrixWorld);
        rec.kit.dirty = true;
      }
      rec.t += dt;
      _v1.setFromMatrixPosition(rec.box.matrixWorld);
      _c1.set(rec.colour);

      // A marker, not a flare: the old halo was a 0.3-opacity sprite and the
      // shaft a 0.07-opacity cylinder, so keep it at that weight.
      const s = beginSpawn();
      s.x = _v1.x; s.y = _v1.y; s.z = _v1.z;
      s.r = _c1.r * 1.3; s.g = _c1.g * 1.3; s.b = _c1.b * 1.3;
      s.size = 0.62 + Math.sin(rec.t * 2.4) * 0.06;
      s.size1 = s.size;
      s.life = 0.05;
      s.drag = 30;
      s.ground = -1e4;
      s.tile = TILE.GLOW;
      s.alpha = 0.34;
      this.embers.spawn(s);
      // the shaft: one vertically stretched streak, so it leans with the camera
      s.vy = 7;
      s.size = 0.26;
      s.size1 = 0.26;
      s.life = 0.06;
      s.stretch = 0.16;
      s.tile = TILE.STREAK;
      s.alpha = 0.16;
      this.embers.spawn(s);
      // and the occasional mote drifting up out of it, to catch the eye
      rec.acc += dt * 3.5;
      while (rec.acc >= 1) {
        rec.acc -= 1;
        this.embersOut(_v1.x, _v1.y - 0.3, _v1.z, 1, 0.5, rec.colour,
          { size: 0.05, life: 1.5, up: 1.1, drag: 0.8, grav: -0.02, ground: -1e4 });
      }
    }
    for (const kit of this.pickupAssets.values()) {
      if (!kit.dirty) continue;
      kit.mesh.instanceMatrix.needsUpdate = true;
      kit.dirty = false;
    }
  }

  /* ================================================================
     per-frame
     ================================================================ */
  update(dt, ctx = {}) {
    this._ctx = ctx;
    this.shared.advance(dt);

    // The linear-depth pass self-disables when nothing else reads it, and a
    // disabled pass leaves a stale (or never-written, zero-filled) target.
    // Sampling that would fade smoke against geometry from some earlier
    // frame, so soft particles switch off for exactly as long as the pass is
    // off and the ground-contact fade carries the frame instead.
    if (this._depthIsLive) this.shared.uniforms.uSoft.value = this._depthIsLive() ? 1 : 0;

    this._updateProjectiles(dt, ctx);
    this._updateMuzzle(dt, ctx);
    this._updatePickups(dt);
    this._updateDying(dt);
    this._updatePatches(dt);
    this._updateLights(dt);

    this.embers.update();
    this.smoke.update();
    this.debris.update();
    this.haze.update();
    this.decals.update();
    this.fireballs.update();
    this.shocks.update();
    this.flames.update();

    // every layer sets its own visibility from its live count above, so a
    // triage hide has to be re-applied after them
    if (this._hidden) this.setVisible(false);

    // screen-space intensities decay on effect time, like the camera shake
    const k = Math.exp(-dt * 3.4);
    this.screen.pulse *= k;
    this.screen.flash *= Math.exp(-dt * 6.5);
    this.screen.heat *= Math.exp(-dt * 1.6);
  }

  _updateProjectiles(dt, ctx) {
    this.tracers.begin();
    const pend = this._pending;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = p.speed * dt;
      const from = _fr.copy(p.pos);
      p.pos.addScaledVector(p.dir, step);
      p.travelled += step;
      p.life -= dt;

      let hit = null;
      let hitDist = Infinity;
      pend.valid = false;

      if (p.owner === 'player') {
        if (ctx.enemies) {
          const e = ctx.enemies.raySegmentHit(from, p.dir, step + p.radius, p.radius);
          if (e) {
            hit = { type: 'enemy', enemy: e.enemy, point: e.point };
            hitDist = e.dist;
            pend.type = 'enemy';
            pend.nx = -p.dir.x; pend.ny = -p.dir.y; pend.nz = -p.dir.z;
            pend.surface = null;
            pend.x = e.point.x; pend.y = e.point.y; pend.z = e.point.z;
            pend.valid = true;
          }
        }
      } else if (ctx.player && ctx.player.alive) {
        const pc = ctx.player.centre;
        const d = distancePointSegment(pc, from, p.pos);
        if (d < p.radius + 0.55) {
          hit = { type: 'player', point: _hp.copy(pc) };
          hitDist = 0;
          pend.type = 'player';
          pend.nx = -p.dir.x; pend.ny = -p.dir.y; pend.nz = -p.dir.z;
          pend.surface = null;
          pend.x = pc.x; pend.y = pc.y; pend.z = pc.z;
          pend.valid = true;
        }
      }

      // world — raycastHit also gives us the normal and the surface, which is
      // what makes the impact effect surface-aware.
      if (ctx.collision) {
        const wh = ctx.collision.raycastHit(from, p.dir, step + 0.1);
        if (wh.hit && wh.t < hitDist) {
          hit = { type: 'world', point: _hp.set(wh.px, wh.py, wh.pz) };
          pend.type = 'world';
          pend.x = wh.px; pend.y = wh.py; pend.z = wh.pz;
          pend.nx = wh.nx; pend.ny = wh.ny; pend.nz = wh.nz;
          pend.surface = wh.surface || SURFACE_FALLBACK;
          pend.valid = true;
        }
      }

      /* trail: the tracer ribbon plus what it sheds */
      const tail = Math.min(p.trail, p.travelled);
      this.tracers.push(
        p.pos.x - p.dir.x * tail, p.pos.y - p.dir.y * tail, p.pos.z - p.dir.z * tail,
        p.pos.x, p.pos.y, p.pos.z,
        0.075 * p.scale + (p.splash > 0 ? 0.05 : 0), p.colour, p.seed,
        0.25, p.owner === 'player' ? 1.0 : 0.85,
      );
      p.acc += dt;
      const emitEvery = p.splash > 0 ? 0.016 : 0.03;
      while (p.acc >= emitEvery) {
        p.acc -= emitEvery;
        this._projectileTrail(p);
      }

      if (hit) {
        if (ctx.onProjectileHit) ctx.onProjectileHit(p, hit);
        pend.valid = false;
        this._despawn(p, i);
        continue;
      }
      if (p.life <= 0 || p.pos.y < -4) this._despawn(p, i);
    }
    this.tracers.end();
    pend.valid = false;
  }

  _projectileTrail(p) {
    const rng = this.rng;
    const back = rng.float(0, 0.9) * p.scale;
    const x = p.pos.x - p.dir.x * back;
    const y = p.pos.y - p.dir.y * back;
    const z = p.pos.z - p.dir.z * back;
    if (p.splash > 0) {
      // a burning shell: flame, soot and embers
      this.flames.blob(x, y, z,
        p.dir.x * rng.float(-2, 2), rng.float(0.5, 2.5), p.dir.z * rng.float(-2, 2),
        rng.float(0.28, 0.5), 0.35 * p.scale, 1.1 * p.scale,
        0.5, 1.2, -1e4, this._nextSeed());
      if (rng.chance(0.35)) {
        this.smokePuff(x, y, z, 0.28 * p.scale, 0.9, 0x241d18,
          { vy: 1.2, grow: 3.0, alpha: 0.4, ground: -1e4 });
      }
    } else {
      const s = beginSpawn();
      s.x = x; s.y = y; s.z = z;
      s.vx = rng.float(-0.9, 0.9);
      s.vy = rng.float(-0.4, 1.0);
      s.vz = rng.float(-0.9, 0.9);
      _c2.copy(p.colour).multiplyScalar(rng.float(1.1, 2.4));
      s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
      s.size = rng.float(0.05, 0.12) * p.scale;
      s.size1 = s.size * 0.1;
      s.life = rng.float(0.1, 0.3);
      s.drag = 4.0;
      s.grav = 0;
      s.ground = -1e4;
      s.tile = TILE.SPARK;
      s.stretch = 0.03;
      this.embers.spawn(s);
    }
    if (rng.chance(0.12)) {
      this.haze.spawn(this._hazeAt(x, y, z, 0.4 * p.scale, 0.28, 0xffc090));
    }
  }

  /**
   * Muzzle: the flash itself is fired from spawnProjectile, but the barrel
   * keeps glowing after sustained fire. The muzzle transform is read
   * straight off the player rig (player.js already refreshes it every
   * frame), so this needs no extra wiring.
   */
  _updateMuzzle(dt, ctx) {
    this.barrelHeat = Math.max(0, this.barrelHeat * Math.exp(-dt * 0.85) - dt * 0.05);
    this._muzzleGlow *= Math.exp(-dt * 14);
    this.muzzleLight.intensity = this._muzzleGlow * 34 + this.barrelHeat * 5;

    const rig = ctx.player && ctx.player.fig;
    const muzzle = rig && rig.muzzle;
    if (!muzzle) return;
    _v1.setFromMatrixPosition(muzzle.matrixWorld);
    this.muzzleLight.position.copy(_v1);
    if (this.barrelHeat < 0.06) return;

    const h = Math.min(1, this.barrelHeat / 1.35);
    const rng = this.rng;
    const s = beginSpawn();
    s.x = _v1.x; s.y = _v1.y; s.z = _v1.z;
    s.vx = 0; s.vy = 0.2; s.vz = 0;
    _c2.setRGB(1.6 * h, 0.5 * h * h, 0.16 * h * h * h);
    s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
    s.size = 0.10 + h * 0.13;
    s.size1 = s.size;
    s.life = 0.05;
    s.drag = 20;
    s.ground = -1e4;
    s.tile = TILE.GLOW;
    this.embers.spawn(s);
    // heat shimmer and the odd wisp of smoke off a hot barrel
    this._barrelAcc = (this._barrelAcc ?? 0) + dt * h * 26;
    while (this._barrelAcc >= 1) {
      this._barrelAcc -= 1;
      this.haze.spawn(this._hazeAt(_v1.x, _v1.y + 0.08, _v1.z, 0.32, 0.4, 0xffb080));
      if (rng.chance(0.25)) {
        this.smokePuff(_v1.x, _v1.y + 0.05, _v1.z, 0.09, 0.8, 0x585048,
          { vy: 0.9, grow: 3.4, alpha: 0.20 * h, ground: -1e4 });
      }
    }
  }

  /* The boss breath used to be driven from here, by reading `e.breath` off
   * ctx.enemies.list — a stopgap so the jet could be rebuilt without editing
   * a file this engineer does not own. enemies.js now calls flameBreath()
   * itself from bossBreathTick() with a properly aimed direction, so that
   * method is gone: its continued existence was what kept their call
   * suppressed (they test `typeof vfx._updateBreath !== 'function'`).
   * Do not reintroduce a method by that name. */

  _updatePatches(dt) {
    const rng = this.rng;
    let glow = 0;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.patches.splice(i, 1);
        continue;
      }
      const k = Math.min(1, p.life / Math.max(0.001, p.max));
      p.acc += dt * 22 * p.radius * k;
      while (p.acc >= 1) {
        p.acc -= 1;
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(0, p.radius);
        this.flames.blob(
          p.x + Math.cos(a) * r, p.y + 0.1, p.z + Math.sin(a) * r,
          rng.float(-0.6, 0.6), rng.float(2.0, 4.5), rng.float(-0.6, 0.6),
          rng.float(0.5, 0.95), rng.float(0.28, 0.5), rng.float(0.9, 1.7),
          0.5, 2.4, p.y, this._nextSeed(),
        );
      }
      p.sacc += dt * 5 * p.radius;
      while (p.sacc >= 1) {
        p.sacc -= 1;
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(0, p.radius);
        this.smokePuff(p.x + Math.cos(a) * r, p.y + 0.6, p.z + Math.sin(a) * r,
          rng.float(0.4, 0.9), rng.float(1.8, 3.4), 0x1e1813,
          { vy: rng.float(1.6, 3.2), grow: 3.2, alpha: 0.45 * k, ground: p.y });
        this.embersOut(p.x + Math.cos(a) * r, p.y + 0.3, p.z + Math.sin(a) * r, 2, 1.6,
          0xff9a40, { size: 0.09, life: 1.8, up: 3.0, ground: p.y, drag: 0.7, grav: -0.12 });
        this.haze.spawn(this._hazeAt(p.x, p.y + 1.0, p.z, p.radius * 1.2, 0.9, 0xff8a4a));
      }
      if (k * p.radius > glow) {
        glow = k * p.radius;
        gx = p.x; gy = p.y; gz = p.z;
      }
    }
    if (glow > 0 && this._flameGlow < 0.5) {
      this._flameGlow = Math.max(this._flameGlow, Math.min(0.8, glow * 0.35));
      this.flameLight.position.set(gx, gy + 1.2, gz);
    }
  }

  _updateLights(dt) {
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.light.intensity = 0; continue; }
      const k = l.life / l.max;
      l.light.intensity = l.power * k * k;
    }
    this._flameGlow *= Math.exp(-dt * 3.2);
    this.flameLight.intensity = this._flameGlow * 42;
  }

  _despawn(p, index) {
    this.projectiles.splice(index, 1);
    this.projPool.push(p);
  }

  /* ================================================================
     helpers
     ================================================================ */

  /** Ground height under a point, for particle bounce planes. */
  _groundAt(x, z, fromY = 1e6) {
    const c = this._ctx && this._ctx.collision;
    if (!c) return 0.03;
    return c.groundHeight(x, z, fromY + 0.6, 0.3) + 0.03;
  }

  _riftNear(point, maxDist) {
    for (const r of this.rifts) {
      if (Math.abs(point.x - r.pos.x) > maxDist) continue;
      if (Math.abs(point.z - r.pos.z) > maxDist) continue;
      if (point.y > r.pos.y + 6 * r.scale) continue;
      return r;
    }
    return null;
  }

  /** Fill the shared spawn descriptor for one heat-shimmer blob. */
  _hazeAt(x, y, z, size, life, colour) {
    const s = beginSpawn();
    s.x = x; s.y = y; s.z = z;
    s.vy = 1.4;
    _c2.set(colour).multiplyScalar(0.16);
    s.r = _c2.r; s.g = _c2.g; s.b = _c2.b;
    s.size = size;
    s.size1 = size * 2.4;
    s.life = life;
    s.drag = 1.1;
    s.grav = 0.03;
    s.ground = -1e4;
    s.tile = TILE.HAZE;
    s.alpha = 0.5;
    s.spin = this.rng.float(-0.6, 0.6);
    return s;
  }

  /** Blast dust off any wall within reach of a blast. */
  _wallDust(pos, radius) {
    const c = this._ctx && this._ctx.collision;
    if (!c || radius < 3) return;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + this.rng.float(-0.3, 0.3);
      _wd1.set(Math.cos(a), 0.06, Math.sin(a)).normalize();
      const hit = c.raycastHit(pos, _wd1, radius * 1.2, undefined, true);
      if (!hit.hit) continue;
      const surf = hit.surface || SURFACE_FALLBACK;
      const spec = SURFACE_DECALS[surf.id] || SURFACE_DECALS.stone;
      const hx = hit.px;
      const hy = hit.py;
      const hz = hit.pz;
      const nx = hit.nx;
      const ny = hit.ny;
      const nz = hit.nz;
      this.dust(hx, hy, hz, 3, 0.45, spec.dust, 1.8, this._groundAt(hx, hz, hy));
      if (this.rng.chance(0.5)) {
        _wd2.set(hx, hy, hz);
        _wd3.set(nx, ny, nz);
        this.decals.add(_wd2, _wd3, radius * 0.35, DECAL.SCORCH, 0x9a8a7a, 0.3, 45, this.rng.next());
      }
    }
  }

  _nextSeed() {
    this._seed = (this._seed + 0.6180339887) % 1;
    return this._seed;
  }

  /** Wipe every world-persistent effect — call on a level restart. */
  clearWorldFx() {
    this.decals.clear();
    this.patches.length = 0;
    for (let i = this.projectiles.length - 1; i >= 0; i--) this._despawn(this.projectiles[i], i);
  }

  /**
   * Hide (or show) every mesh this file owns, in one call. Exists for
   * triage: when a rendering artefact might or might not be VFX, this
   * answers it in one frame without touching anyone else's code.
   * `vfx.setVisible(false)` leaves gameplay untouched — projectiles still
   * fly and hit, they just stop drawing.
   */
  setVisible(visible) {
    for (const l of [this.embers, this.smoke, this.debris, this.haze]) {
      l.mesh.visible = visible && l.count > 0;
    }
    this.tracers.mesh.visible = visible && this.tracers.written > 0;
    this.decals.mesh.visible = visible && this.decals.count > 0;
    for (const sys of [this.fireballs, this.shocks, this.flames]) {
      sys.layer.mesh.visible = visible && sys.pool.count > 0;
    }
    for (const r of this.rifts) r.mesh.visible = visible;
    for (const d of this.dying) d.mesh.visible = visible;
    for (const kit of this.pickupAssets.values()) kit.mesh.visible = visible;
    this._hidden = !visible;
    return this;
  }

  dispose() {
    for (const kit of this.pickupAssets.values()) {
      this.scene.remove(kit.mesh);
      kit.geometry.dispose();
      kit.material.dispose();
    }
    this.pickupAssets.clear();
    this.pickupList.length = 0;
    this.embers.dispose();
    this.smoke.dispose();
    this.debris.dispose();
    this.haze.dispose();
    this.tracers.dispose();
    this.decals.dispose();
    this.fireballs.dispose();
    this.shocks.dispose();
    this.flames.dispose();
    this.atlas.dispose();
    this.decalAtlas.dispose();
    this.glowTex.dispose();
    if (this._riftWarm) {
      this.scene.remove(this._riftWarm);
      this._riftWarm.geometry.dispose();
      this._riftWarm.material.dispose();
      this._riftWarm = null;
    }
  }
}

/* ------------------------------------------------------------------ */
function distancePointSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export { TILE, DECAL, S as SPAWN };
