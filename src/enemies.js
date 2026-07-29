import * as THREE from 'three';
import { Rng } from './rng.js';
import { ARCHETYPES } from './creatures/index.js';
import {
  buildCreature, archetypeGeometry, triangleCount, newPoseState,
  beat, actLength, damp, clamp01, primeMaterialRegistry,
} from './creatures/kit.js';
import { BRAINS, updatePack, telegraph } from './creatures/brains.js';
import { bossBrain, bossActCommit, bossActTick, initBoss } from './creatures/bossfight.js';
import { impactDust, shards, ring } from './creatures/fx.js';

/* ==================================================================
   Dračí potomstvo — the things crawling out of the rifts.

   This file is the manager and the contract with main.js. The creatures
   themselves — rigs, geometry, skin sheets, gaits, attack poses — live in
   src/creatures/. Everything here that carries a "kept verbatim" comment
   was fixed in an earlier pass (endless waves and enemy recovery, spitter
   projectile lead, combat collision and line of sight) and must not drift.
   ================================================================== */

const ENEMY_VFX_SEED = 0xd4a6;

export const ENEMY_TYPES = {
  whelp: {
    id: 'whelp', name: 'Ještěrka', hp: 46, speed: 6.4, radius: 0.55, height: 1.1,
    damage: 8, attackRange: 2.3, attackCd: 1.45, score: 100, ranged: false, mass: 1,
  },
  spitter: {
    id: 'spitter', name: 'Chrlič', hp: 72, speed: 3.5, radius: 0.6, height: 1.9,
    damage: 13, attackRange: 34, attackCd: 2.6, score: 180, ranged: true, mass: 1.4,
    keepDistance: 17,
  },
  golem: {
    id: 'golem', name: 'Kamenný golem', hp: 240, speed: 2.9, radius: 1.05, height: 2.9,
    damage: 25, attackRange: 3.4, attackCd: 1.9, score: 400, ranged: false, mass: 4,
  },
  boss: {
    id: 'boss', name: 'DRAK BRNĚNSKÝ', hp: 7600, speed: 5.4, radius: 3.8, height: 9.0,
    damage: 42, attackRange: 9.5, attackCd: 2.2, score: 5000, ranged: true, mass: 20,
    scale: 1.45,
  },
};

/** How long a body stays on the ground before the pool takes it back. */
const CORPSE_LIFE = { whelp: 2.8, spitter: 3.0, golem: 3.6, boss: 6.5 };
/** Extra personal space, so a pack spreads out instead of merging. */
const SPACING = { whelp: 1.45, spitter: 1.5, golem: 1.15, boss: 1 };
/** Armour thresholds: each one throws a golem plate off and opens the core. */
const GOLEM_PLATES = [0.8, 0.65, 0.5, 0.35, 0.2];
/** Fraction of max health a single blow has to beat to rock something back.
 * A golem shrugs off single plasma bolts (34) and only staggers to melee or
 * a splash, which is what keeps it feeling heavy instead of stun-locked. */
const STAGGER_FRAC = { whelp: 0.34, spitter: 0.3, golem: 0.18, boss: 0.09 };
/** No creature can be staggered again inside this window. */
const STAGGER_LOCKOUT = 1.4;
/** States an action returns to when it finishes, instead of falling back to
 * 'chase' — a Chrlič that spits from a ledge stays on the ledge. */
const RESUME_STATES = new Set(['perch', 'fly']);

/* ------------------------------------------------------------------ */
/* floating health bar — one mesh, one draw call                        */
/* ------------------------------------------------------------------ */
const BAR_GEO = new THREE.PlaneGeometry(1, 1);
const BAR_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const BAR_FRAG = /* glsl */`
  uniform float uFrac;
  uniform vec3 uFg;
  uniform vec3 uBg;
  varying vec2 vUv;
  void main() {
    float inner = step(0.02, vUv.x) * step(vUv.x, 0.98) * step(0.2, vUv.y) * step(vUv.y, 0.8);
    float fill = step(vUv.x, mix(0.02, 0.98, uFrac)) * inner;
    vec3 c = mix(uBg, uFg, fill);
    gl_FragColor = vec4(c, mix(0.70, 0.98, fill));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

function makeHealthBar(width) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uFrac: { value: 1 },
      uFg: { value: new THREE.Color(0xff5a3c) },
      uBg: { value: new THREE.Color(0x0b0d10) },
    },
    vertexShader: BAR_VERT,
    fragmentShader: BAR_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(BAR_GEO, mat);
  mesh.scale.set(width, 0.26, 1);
  mesh.visible = false;
  mesh.renderOrder = 4;
  return { group: mesh, mat, width };
}

/* ==================================================================
   Enemy manager
   ================================================================== */
export class EnemyManager {
  constructor(scene, collision, vfx, rng) {
    this.scene = scene;
    this.collision = collision;
    this.vfx = vfx;
    this.rng = rng;
    this.vfxRng = new Rng(ENEMY_VFX_SEED);
    this.list = [];
    this.pools = { whelp: [], spitter: [], golem: [], boss: [] };
    this.onDeath = null;
    this.onPlayerHit = null;
    this.onShoot = null;
    this.onBossRoar = null;
    this.onBossPhase = null;
    /** Fired once when a creature acquires the player (main.js gives it a
     * voice through audio.roar). Re-arms if it loses him again. */
    this.onAggro = null;

    /**
     * Optional: the shared `PhysicsWorld` from src/rigidbody.js. Set it and
     * every corpse is handed to the ragdoll solver instead of playing the
     * procedural collapse:
     *
     *     enemies.physics = physics;      // one line in main.js
     *
     * Left null, deaths fall back to the bone-driven collapse, so this file
     * never depends on the solver existing.
     */
    this.physics = null;

    this.scratch = new THREE.Vector3();
    this.serial = 0;
    this.pack = { t: 0, members: [] };
    this._boxes = [];
    this._info = {
      player: null, pp: new THREE.Vector3(), pc: new THREE.Vector3(),
      dt: 0, ctx: null, distFlat: 0, distFull: 0, toX: 0, toZ: 1,
    };

    primeMaterialRegistry();
    // Build one of each archetype up front: the skin sheets and the merged
    // geometry are generated here, on the loading screen, instead of
    // hitching the first time a rift spits something out. They go straight
    // into the pool, and they are in the scene before main.js calls
    // renderer.compile(), so the shaders are warm too.
    for (const typeId of Object.keys(this.pools)) {
      try {
        this.pools[typeId].push(this._create(typeId));
      } catch (err) {
        console.warn(`enemies: could not prewarm ${typeId}`, err);
      }
    }
  }

  get aliveCount() {
    let n = 0;
    for (const e of this.list) if (e.hp > 0) n++;
    return n;
  }

  /** Triangles and draw calls per archetype — for the perf budget. */
  static geometryStats() {
    const out = {};
    for (const [id, def] of Object.entries(ARCHETYPES)) {
      const geos = archetypeGeometry(def);
      out[id] = { triangles: triangleCount(geos), drawCalls: Object.keys(geos).length, bones: def.bones.length };
    }
    return out;
  }

  /* ---------------------------------------------------------------- */
  _create(typeId) {
    const model = buildCreature(ARCHETYPES[typeId]);
    model.root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        /* Skinned bounds are computed in bind space, so a spread wing or a
         * whipping tail would poke outside a tight sphere and pop. Each
         * archetype therefore publishes a deliberately generous
         * `boundingRadius` (see PartBuilder#build) that already covers its
         * widest pose, and culling stays on — worth having in a scene that
         * is fighting for draw calls. */
        o.frustumCulled = true;
      }
    });
    const e = {
      model,
      object: model.root,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      flashMats: model.mats,
      look: { yaw: 0, pitch: 0 },
      a: newPoseState(),
    };
    e.bar = makeHealthBar(typeId === 'golem' ? 1.8 : 1.45);
    model.root.add(e.bar.group);
    model.root.visible = false;
    this.scene.add(model.root);
    return e;
  }

  spawn(typeId, pos, opts = {}) {
    const type = ENEMY_TYPES[typeId];
    let e = this.pools[typeId].pop();
    if (!e) e = this._create(typeId);

    e.type = type;
    e.typeId = typeId;
    e.hp = type.hp * (opts.hpScale ?? 1);
    e.maxHp = e.hp;
    e.speed = type.speed * (opts.speedScale ?? 1);
    e.damage = type.damage * (opts.dmgScale ?? 1);
    e.pos.copy(pos);
    e.pos.y = this.collision.groundHeight(pos.x, pos.z, pos.y + 4, type.radius) || 0;
    e.vel.set(0, 0, 0);
    e.facing = this.rng.float(0, Math.PI * 2);
    e.state = 'spawn';
    e.stateT = 0;
    e.attackCd = this.rng.float(0.6, 1.2);
    e.animPhase = this.rng.float(0, 10);
    e.hurt = 0;
    e.flinch = 0;
    e.flinchX = 0;
    e.flinchZ = 0;
    e.stagger = 0;
    e.burstDmg = 0;
    e.staggerCd = 0;
    e.recentHit = 0;
    e.onGround = true;
    e.avoidSide = this.rng.chance(0.5) ? 1 : -1;
    e.repathT = 0;
    e.strafe = this.rng.chance(0.5) ? 1 : -1;
    e.attackWindup = 0;
    e.stuckT = 0;
    e.progressT = 0;
    e.progressX = undefined;
    e.progressZ = undefined;
    e.progressTargetX = undefined;
    e.progressTargetZ = undefined;
    e.avoidT = 0;
    e.avoidX = 0;
    e.avoidZ = 0;
    e.breath = 0;
    e.breathCd = 6;
    e.attackDidHit = false;
    e.scale = type.scale ?? 1;
    e.phase2 = false;
    /* --- overhaul state --- */
    e.serial = this.serial++;
    e.act = null;
    e.gait = this.rng.float(0, Math.PI * 2);
    e.run = 0;
    e.glow = 0;
    e.climb = 0;
    e.soar = 0;
    e.flying = false;
    e.shield = 0;
    e.sweepSide = this.rng.chance(0.5) ? 1 : -1;
    e.deathSide = this.rng.chance(0.5) ? 1 : -1;
    e.brokenPlates = 0;
    e.plateAge = [0, 0, 0, 0, 0];
    e.corpseOnGround = false;
    e.landedT = 0;
    e.role = 'press';
    e.pressT = 0;
    e.packAngle = e.facing;
    e.packRadius = 6;
    e.packDist = 0;
    e.perchCd = this.rng.float(1.5, 5);
    e.perchScan = this.rng.float(0, 1.5);
    e.perchT = 0;
    e.perchBlind = 0;
    e.perched = false;
    e.aggroed = false;
    e.aggroT = 0;
    e.aggroNext = this.rng.float(9, 16);
    e.aggroScan = this.rng.float(0, 0.4);
    e.ragdoll = null;
    e.lastHitX = 0;
    e.lastHitZ = 1;
    e.flyTarget = e.flyTarget || new THREE.Vector3();
    e.flyMode = 'hover';
    e.vulnerable = 0;
    e.look.yaw = 0;
    e.look.pitch = 0;
    Object.assign(e.a, newPoseState());

    if (typeId === 'boss') {
      initBoss(e);
      // the dragon does not walk in: it comes down out of the sky
      e.pos.y += 24;
      e.flying = true;
      e.soar = 1;
    }

    e.object.visible = true;
    e.object.scale.setScalar(0.01);
    e.object.position.copy(e.pos);
    e.object.rotation.set(0, e.facing, 0);
    e.bar.group.visible = false;
    this.list.push(e);
    return e;
  }

  /* ---------------------------------------------------------------- */
  /* damage, flinch, stagger, armour                                   */
  /* ---------------------------------------------------------------- */
  damage(e, amount, dir, isCrit = false) {
    if (e.hp <= 0) return 0;
    let dmg = amount;

    // a golem behind its guard eats far less from the front
    if (e.typeId === 'golem' && e.shield > 0.45 && dir) {
      const fwdX = -Math.sin(e.facing);
      const fwdZ = -Math.cos(e.facing);
      if (dir.x * fwdX + dir.z * fwdZ < -0.2) {
        dmg *= 0.5;
        if (this.vfx) {
          shards(this.vfx, this.vfxRng,
            e.pos.x + fwdX * 0.9, e.pos.y + 1.9, e.pos.z + fwdZ * 0.9, 4, 0xbfae86, 5);
        }
      }
    }
    // the dragon's vulnerable window is where the fight is actually won
    if (e.vulnerable > 0) {
      dmg *= 1.8;
      if (this.vfx && this.vfxRng.chance(0.5)) {
        this.vfx.impactSpark(this.scratch.set(
          e.pos.x, e.pos.y + e.type.height * 0.4, e.pos.z), 0xffe08a, false);
      }
    }

    e.hp -= dmg;
    e.hurt = 1;
    e.flinch = Math.min(0.28, dmg / 120);
    if (dir) {
      // hit direction in the creature's own space, so the flinch leans away
      const c = Math.cos(e.facing);
      const s = Math.sin(e.facing);
      const len = Math.hypot(dir.x, dir.z) || 1;
      e.flinchX = (dir.x * c - dir.z * s) / len;
      e.flinchZ = (dir.x * s + dir.z * c) / len;
      // kept in world space too: it is the impulse a ragdoll gets thrown by
      e.lastHitX = dir.x / len;
      e.lastHitZ = dir.z / len;
    }
    if (dir && e.typeId !== 'boss' && e.typeId !== 'golem') {
      e.vel.addScaledVector(dir, Math.min(6, dmg / (e.type.mass * 4)));
    }
    e.recentHit = 1.4;

    // burst damage: a leaky bucket, so it takes a real spike of damage to
    // put something down rather than steady chip damage adding up forever
    e.burstDmg += dmg;

    if (e.hp <= 0) {
      this._die(e);
      return 1;
    }

    // golem armour comes off in pieces as its health falls
    if (e.typeId === 'golem') {
      const frac = e.hp / e.maxHp;
      while (e.brokenPlates < GOLEM_PLATES.length && frac <= GOLEM_PLATES[e.brokenPlates]) {
        this._breakPlate(e, e.brokenPlates);
        e.brokenPlates++;
      }
    }

    const frac = STAGGER_FRAC[e.typeId] ?? 0.2;
    const heavy = (dmg > e.maxHp * frac || (isCrit && dmg > e.maxHp * frac * 0.6))
      && e.staggerCd <= 0;
    if (e.state !== 'dead' && e.state !== 'downed') {
      if (heavy) e.staggerCd = STAGGER_LOCKOUT;
      if (e.typeId === 'golem') {
        if (e.burstDmg > e.maxHp * 0.26) {
          e.burstDmg = 0;
          this._enterState(e, 'downed');
          e.downT = 1.8;
          e.act = null;
          if (this.vfx) impactDust(this.vfx, this.vfxRng, e.pos.x, e.pos.y, e.pos.z, 1.6);
        } else if (heavy && e.state === 'chase') {
          e.stagger = 0.55;
        }
      } else if (e.typeId !== 'boss') {
        if (e.burstDmg > e.maxHp * 0.85) {
          e.burstDmg = 0;
          this._enterState(e, 'downed');
          e.downT = 1.1;
          e.act = null;
        } else if (heavy) {
          // interrupt: a solid hit beats an attack that has not committed
          if (e.act && beat(e.act).phase === 'ant') e.act = null;
          e.stagger = 0.5;
          if (e.state === 'attack' || e.state === 'chase') this._enterState(e, 'stagger');
        }
      } else if (heavy) {
        e.stagger = Math.max(e.stagger, 0.35);
      }
    }
    return 0;
  }

  _breakPlate(e, index) {
    e.plateAge[index] = 0;
    if (!this.vfx) return;
    const y = e.pos.y + (index === 2 ? 1.2 : 2.1);
    shards(this.vfx, this.vfxRng, e.pos.x, y, e.pos.z, 12, 0xa8946f, 7);
    this.vfx.burst(this.scratch.set(e.pos.x, y, e.pos.z), 0xff8a3a, 10, 4,
      { size: 0.3, life: 0.5, drag: 3 });
  }

  _enterState(e, state) {
    e.state = state;
    e.stateT = 0;
  }

  /* ---------------------------------------------------------------- */
  /* actions: anticipation → commit → recovery                         */
  /* ---------------------------------------------------------------- */
  startAct(e, id, extra = null) {
    const spec = e.model.def.acts[id];
    if (!spec) return null;
    e.act = {
      id,
      ant: spec.ant,
      com: spec.com,
      rec: spec.rec,
      t: 0,
      fired: false,
      hit: false,
      after: RESUME_STATES.has(e.state) ? e.state : 'chase',
    };
    if (extra) Object.assign(e.act, extra);
    e.attackWindup = spec.ant;
    e.attackDidHit = false;
    this._enterState(e, 'attack');
    return e.act;
  }

  _tickAct(e, dt, info) {
    const act = e.act;
    act.t += dt;
    const bt = beat(act);
    telegraph(this, e, bt, info);
    if (e.typeId === 'boss') bossActTick(this, e, info, act, bt);

    if (!act.fired && act.t >= act.ant) {
      act.fired = true;
      e.attackDidHit = true;
      this._commitAct(e, info, act);
    }
    // melee follow-through: the creature actually travels on the commit
    if (bt.phase === 'com') {
      if (act.id === 'lunge') {
        e.moveX = info.toX;
        e.moveZ = info.toZ;
        e.moveSpeed = e.speed * 2.6;
        // the bite lands anywhere along the pounce, so it can be dodged
        if (!act.hit && info.distFlat < e.type.attackRange + 1.4
          && Math.abs(info.pp.y - e.pos.y) < 3.2) {
          act.hit = true;
          this.hitPlayer(e, e.damage, info.toX, info.toZ, 1.2);
        }
      } else if (act.id === 'slam' || act.id === 'sweep') {
        e.moveX = info.toX;
        e.moveZ = info.toZ;
        e.moveSpeed = e.speed * 1.6;
      }
    }

    if (act.t >= actLength(act)) {
      e.act = null;
      const after = act.after || 'chase';
      if (after === 'exhausted') {
        this._enterState(e, 'exhausted');
        e.exhaustT = act.exhaust ?? 2.2;
        e.vulnerable = 1;
      } else {
        this._enterState(e, after);
      }
    }
  }

  _commitAct(e, info, act) {
    if (e.typeId === 'boss') {
      bossActCommit(this, e, info, act);
      return;
    }
    switch (act.id) {
      case 'spit':
        this.rangedAttack(e, info.player);
        break;
      case 'swipe':
        if (info.distFlat < e.type.attackRange + 1.2 && Math.abs(info.pp.y - e.pos.y) < 3.2) {
          this.hitPlayer(e, e.damage * 0.7, info.toX, info.toZ, 1.2);
        }
        break;
      case 'slam': {
        // a wide, heavy landing: the fists come down in front of it
        const reach = e.type.attackRange + 1.6;
        const fx = e.pos.x - Math.sin(e.facing) * 2.2;
        const fz = e.pos.z - Math.cos(e.facing) * 2.2;
        if (this.vfx) {
          this.vfx.explosion(this.scratch.set(fx, e.pos.y + 0.4, fz), 3.4, 0xffa050);
          impactDust(this.vfx, this.vfxRng, fx, e.pos.y, fz, 1.8);
          ring(this.vfx, this.vfxRng, fx, e.pos.y, fz, 3.2, 0xffb060, 18,
            { size: 0.4, life: 0.7, up: 2.2, speed: 7 });
        }
        const d = Math.hypot(info.pp.x - fx, info.pp.z - fz);
        if (d < reach && Math.abs(info.pp.y - e.pos.y) < 3.4) {
          this.hitPlayer(e, e.damage, info.toX, info.toZ, 2.2);
        }
        break;
      }
      case 'sweep': {
        const reach = e.type.attackRange + 2.4;
        if (info.distFlat < reach && Math.abs(info.pp.y - e.pos.y) < 3.4) {
          this.hitPlayer(e, e.damage * 0.75, info.toX, info.toZ, 2.6);
        }
        if (this.vfx) {
          const base = e.facing - e.sweepSide * 1.3;
          ring(this.vfx, this.vfxRng,
            e.pos.x - Math.sin(base) * 2.4, e.pos.y, e.pos.z - Math.cos(base) * 2.4,
            1.8, 0xffa040, 10, { size: 0.3, life: 0.4, up: 1.4, speed: 4 });
        }
        break;
      }
      case 'feint':
        // no damage: the point is to make the player burn a dodge
        break;
      default:
        break;
    }
  }

  /** Fire the player-hit callback with a knockback-scaled direction. */
  hitPlayer(e, dmg, dirX, dirZ, knock = 1) {
    if (!this.onPlayerHit) return;
    this.onPlayerHit(e, dmg, _v1.set(dirX * knock, 0, dirZ * knock));
  }

  /* ---------------------------------------------------------------- */
  /* projectiles — the lead maths here is deliberate, keep it verbatim  */
  /* ---------------------------------------------------------------- */
  rangedAttack(e, player) {
    const t = e.type;
    // fireballs leave the mouth, not the top of the hitbox
    const origin = e.typeId === 'boss'
      ? _v1.set(e.pos.x, e.pos.y + 4.7 * e.scale, e.pos.z)
      : _v1.set(e.pos.x, e.pos.y + t.height * 0.82, e.pos.z);
    if (e.typeId === 'boss') {
      // fan of fireballs — five of them once it is enraged
      const spread = e.phase2 ? 2 : 1;
      for (let k = -spread; k <= spread; k++) {
        const dir = _v2.copy(player.centre).sub(origin).normalize();
        const a = k * 0.11;
        const nx = dir.x * Math.cos(a) - dir.z * Math.sin(a);
        const nz = dir.x * Math.sin(a) + dir.z * Math.cos(a);
        this.onShoot && this.onShoot(e, origin, _v3.set(nx, dir.y, nz).normalize(), {
          color: 0xff7a2a, speed: 48, damage: e.damage, radius: 0.85, scale: 2.4, splash: 4.5, trail: 5,
        });
      }
    } else {
      const dir = _v2.copy(player.centre).sub(origin);
      const projectileSpeed = 42;
      const flightTime = Math.min(dir.length() / projectileSpeed, 0.45);
      dir.x += player.vel.x * flightTime;
      dir.z += player.vel.z * flightTime;
      dir.normalize();
      this.onShoot && this.onShoot(e, origin, dir, {
        color: 0xff8a3a, speed: projectileSpeed, damage: e.damage, radius: 0.5, scale: 1.5, splash: 2.2, trail: 4,
      });
    }
    this.vfx.burst(origin, 0xff7a2a, 10, 5, { size: 0.3, life: 0.35, drag: 4 });
  }

  /** The breath cone: the flame jet, the sweep and the continuous damage
   * test. Damage geometry kept verbatim from the line-of-sight fix. */
  bossBreathTick(e, dt, info) {
    const player = info.player;
    e.breath -= dt;
    const origin = _v1.set(e.pos.x, e.pos.y + 4.6 * e.scale, e.pos.z);
    const fwd = _v2.set(-Math.sin(e.facing), 0, -Math.cos(e.facing));
    const sweep = Math.sin(e.breath * 5.2) * 0.35;
    const dir = _v3.set(
      fwd.x * Math.cos(sweep) - fwd.z * Math.sin(sweep),
      -0.12,
      fwd.x * Math.sin(sweep) + fwd.z * Math.cos(sweep),
    ).normalize();
    /* The jet itself. `dir` above is the damage axis: horizontal, at chest
     * height, ±30° and out to 22 m. The visual is aimed down at the cobbles
     * ~13 m ahead so the fire pools and runs along the ground, which lands
     * inside the same horizontal cone — the two agree in plan view, which is
     * the view the player dodges in.
     *
     * vfx.js still drives this same jet off `e.breath` in its own
     * `_updateBreath()`. While that method exists we let it, or the jet is
     * emitted twice; once the VFX owner removes it this call takes over. */
    if (this.vfx.flameBreath && typeof this.vfx._updateBreath !== 'function') {
      const ahead = 13 * Math.max(1, e.scale * 0.5);
      const landY = (this.collision.groundHeight(
        e.pos.x + dir.x * ahead, e.pos.z + dir.z * ahead, e.pos.y + 2, 1.5) || 0);
      _v5.set(dir.x * ahead, landY + 0.5 - origin.y, dir.z * ahead).normalize();
      this.vfx.flameBreath(origin, _v5, dt, {
        power: e.phase2 ? 1.25 : 1,
        range: ahead * 1.8,
        ground: landY + 0.05,
      });
    }
    // cone damage
    const target = _v4.copy(info.pc);
    const pd = _v2.set(target.x - e.pos.x, 0, target.z - e.pos.z);
    const pdist = pd.length();
    const sameLevel = Math.abs(player.pos.y - e.pos.y) < 5;
    if (pdist < 22 && sameLevel) {
      pd.normalize();
      const horizontalDot = pd.x * dir.x + pd.z * dir.z;
      if (horizontalDot > 0.86 && this.collision.hasLineOfSight(origin, target, 22.5)) {
        this.onPlayerHit && this.onPlayerHit(e, 22 * dt * 6, pd, true, dt);
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /* ragdoll handoff                                                   */
  /* ---------------------------------------------------------------- */
  /* ragdoll handoff                                                   */
  /* ---------------------------------------------------------------- */
  /**
   * Solver-ready bone records for one creature, straight from its live pose:
   * the shape `PhysicsWorld#spawnRagdoll()` in src/rigidbody.js eats, with
   * `position`/`quaternion` at the joint (proximal) end in world space and
   * parents ahead of children.
   *
   * These rigs are authored in bind space with identity rest rotations, so a
   * bone's direction lives in its child's offset, not in its own quaternion.
   * That is why the quaternion handed over is `boneWorldRotation * fix`,
   * where `fix` maps +Y onto the bone's rest direction — so the capsules line
   * up with the geometry and `boneAxis: 'y'` is honest. The same `fix` is
   * undone on the way back in `_driveRagdoll()`.
   */
  ragdollBones(e) {
    const plan = ragdollPlan(e.model.def, e.model.tpl);
    if (!plan.length) return null;
    e.object.updateMatrixWorld(true);
    const s = e.scale;
    const out = [];
    for (const p of plan) {
      const bone = e.model.bones[p.name];
      if (!bone) continue;
      bone.matrixWorld.decompose(_rp, _rq, _rs);
      _rq2.copy(_rq).multiply(p.fix);
      out.push({
        name: p.name,
        parent: p.parent,
        position: { x: _rp.x, y: _rp.y, z: _rp.z },
        quaternion: { x: _rq2.x, y: _rq2.y, z: _rq2.z, w: _rq2.w },
        length: p.length * s,
        radius: p.radius * s,
        mass: p.mass * s * s * s,
        cone: p.cone,
        twist: p.twist,
        boneAxis: 'y',
        surface: e.typeId === 'golem' ? 'stone' : 'flesh',
      });
    }
    return out;
  }

  /**
   * Hand a corpse to the ragdoll solver. Returns false if there is no solver
   * or no free ragdoll slot, in which case the procedural collapse plays
   * instead — this file works either way.
   */
  _handOffToRagdoll(e, dirX, dirZ) {
    const phys = this.physics;
    if (!phys || typeof phys.spawnRagdoll !== 'function') return false;
    /* The solver keeps only a handful of ragdoll slots and evicts the oldest,
     * and the player's own corpse needs one of them. A wave can kill six
     * whelps in two seconds, so the light archetypes only get a real ragdoll
     * when there is clearly room; the heavy deaths that carry the moment —
     * a golem toppling, the dragon coming down — always do. */
    const heavy = e.typeId === 'golem' || e.typeId === 'boss';
    const slots = phys.opt && phys.opt.maxRagdolls;
    const used = phys.ragdolls ? phys.ragdolls.length : 0;
    if (!heavy && slots && used >= slots - 1) return false;
    const bones = this.ragdollBones(e);
    if (!bones || !bones.length) return false;
    const push = 22 * e.type.mass + 26;
    const rag = phys.spawnRagdoll(bones, {
      impulse: _v1.set(dirX * push, push * 0.32, dirZ * push),
      hitBone: bones[0].name,        // the torso: bone 0 is always the root
      velocity: e.vel,
      blendTime: 0.1,
      settleTimeout: 3.5,
      maxLifetime: (CORPSE_LIFE[e.typeId] ?? 3) * 2.4,
      fadeTime: 1.2,
      userData: e,
    });
    if (!rag) return false;
    e.ragdoll = rag;
    e.ragdollFix = ragdollFixMap(e.model.def, e.model.tpl);
    return true;
  }

  /**
   * Copy the solver's world bone transforms back onto the rig, converted into
   * each bone's parent frame so the root group's own position, facing and
   * per-type scale stay untouched. Bones the solver does not drive keep the
   * pose the animator left them in, which is what makes a 23-body ragdoll
   * enough for a 47-bone dragon.
   */
  _driveRagdoll(e, sink) {
    const rag = e.ragdoll;
    const bones = e.model.bones;
    const fixes = e.ragdollFix;
    for (let i = 0; i < rag.bones.length; i++) {
      const rb = rag.bones[i];
      const bone = bones[rb.name];
      if (!bone || !rb.out || !bone.parent) continue;
      const fixInv = fixes.get(rb.name);
      if (!fixInv) continue;
      const parent = bone.parent;
      parent.updateWorldMatrix(true, false);
      parent.matrixWorld.decompose(_rp, _rq, _rs);
      _rqi.copy(_rq).invert();
      const s = _rs.x || 1;
      _rv.copy(rb.out.position);
      if (sink) _rv.y -= sink;
      bone.position.copy(_rv.sub(_rp).applyQuaternion(_rqi).divideScalar(s));
      _rq2.copy(rb.out.quaternion).multiply(fixInv);
      bone.quaternion.copy(_rqi).multiply(_rq2);
      bone.updateMatrix();
      bone.matrixWorldNeedsUpdate = true;
    }
  }

  /* ---------------------------------------------------------------- */
  /* flight helpers                                                    */
  /* ---------------------------------------------------------------- */
  groundAt(e) {
    return this.collision.groundHeight(e.pos.x, e.pos.z, e.pos.y + 4, e.type.radius, 1.2) || 0;
  }

  los(e, info, maxDist) {
    return this.collision.hasLineOfSight(
      _v5.set(e.pos.x, e.pos.y + e.type.height * 0.8, e.pos.z), info.pc, maxDist);
  }

  /**
   * A ledge for a Chrlič: high enough to matter, wide enough to stand on,
   * in spitting range and with a clear line down to the player.
   *
   * The spot is on the parapet facing the player, not the middle of the
   * roof — from the centre of a wide building its own edge blocks the shot,
   * which is exactly where a real gargoyle sits anyway.
   */
  findPerch(e, info) {
    const pp = info.pp;
    const boxes = this.collision.query(pp.x - 44, pp.z - 44, pp.x + 44, pp.z + 44, this._boxes);
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.tag === 'nostand') continue;
      const top = b.top;
      if (top < 5.5 || top > 26) continue;
      const halfX = (b.x1 - b.x0) * 0.5 - 0.9;
      const halfZ = (b.z1 - b.z0) * 0.5 - 0.9;
      if (halfX < 0.35 || halfZ < 0.35) continue;
      const cx = (b.x0 + b.x1) * 0.5;
      const cz = (b.z0 + b.z1) * 0.5;
      let dirX = pp.x - cx;
      let dirZ = pp.z - cz;
      const len = Math.hypot(dirX, dirZ);
      if (len < 1e-3) continue;
      dirX /= len;
      dirZ /= len;
      // step out to the edge on the player's side
      const t = Math.min(
        halfX / Math.max(1e-4, Math.abs(dirX)),
        halfZ / Math.max(1e-4, Math.abs(dirZ)),
      );
      const px = cx + dirX * t;
      const pz = cz + dirZ * t;
      const d = Math.hypot(px - pp.x, pz - pp.z);
      if (d < 12 || d > 40) continue;
      const dEnemy = Math.hypot(px - e.pos.x, pz - e.pos.z);
      if (dEnemy > 70) continue;
      const score = Math.abs(d - 22) + dEnemy * 0.25 + this.rng.float(0, 5);
      if (score >= bestScore) continue;
      _v5.set(px, top + 1.4, pz);
      if (!this.collision.hasLineOfSight(_v5, info.pc, 60)) continue;
      bestScore = score;
      best = best || { x: 0, y: 0, z: 0 };
      best.x = px;
      best.y = top;
      best.z = pz;
    }
    return best;
  }

  spitterTakeOff(e, info, perch) {
    const target = perch || this.findPerch(e, info);
    e.flying = true;
    e.perched = false;
    this._enterState(e, 'fly');
    e.vel.y = 6;
    e.perchCd = this.rng.float(4, 8);
    if (target) {
      e.flyMode = 'perch';
      e.flyTarget.set(target.x, target.y + 0.05, target.z);
    } else {
      // no ledge worth having: hover instead, still above the fray.
      // Altitude is measured from the player's ground, never from whatever
      // roof it happens to be standing on, or each hop would climb higher.
      e.flyMode = 'hover';
      const a = this.rng.float(0, Math.PI * 2);
      e.flyTarget.set(
        info.pp.x + Math.sin(a) * 20,
        info.pp.y + this.rng.float(9, 14),
        info.pp.z + Math.cos(a) * 20,
      );
    }
    if (this.vfx) {
      impactDust(this.vfx, this.vfxRng, e.pos.x, e.pos.y, e.pos.z, 0.8, 0x6b6055);
    }
  }

  spitterLand(e) {
    e.flying = false;
    e.perched = false;
    e.flyMode = 'hover';
    this._enterState(e, 'chase');
    e.progressX = undefined;
    e.perchCd = this.rng.float(3, 7);
  }

  /* ---------------------------------------------------------------- */
  /* queries used by the player and the VFX system                     */
  /* ---------------------------------------------------------------- */
  /**
   * Nearest enemy hit by the segment from `from` along `dir` for `len`.
   * Each enemy is a vertical capsule (its full body height), so shots connect
   * whether you are aiming at a golem's chest or a whelp's snout.
   */
  raySegmentHit(from, dir, len, radius) {
    let best = null;
    let bestT = Infinity;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const r = e.type.radius + radius;
      const t = closestOnSegments(
        from.x, from.y, from.z,
        dir.x * len, dir.y * len, dir.z * len,
        e.pos.x, e.pos.y + r * 0.35, e.pos.z,
        0, Math.max(0.1, e.type.height - r * 0.35), 0,
      );
      if (t.dist > r) continue;
      const hitT = t.s * len;
      if (hitT < bestT) {
        bestT = hitT;
        best = e;
      }
    }
    if (!best) return null;
    return {
      enemy: best,
      dist: bestT,
      point: _v2.copy(from).addScaledVector(dir, bestT),
    };
  }

  /**
   * The enemy the crosshair is effectively pointing at: the one closest to the
   * camera ray inside a generous cylinder. Drives both the hostile reticle and
   * the aim assist that keeps a shoulder-camera third-person shooter playable.
   */
  aimTarget(origin, dir, maxDist, assistRadius = 1.35) {
    let best = null;
    let bestScore = Infinity;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const r = e.type.radius + assistRadius;
      const t = closestOnSegments(
        origin.x, origin.y, origin.z,
        dir.x * maxDist, dir.y * maxDist, dir.z * maxDist,
        e.pos.x, e.pos.y + 0.2, e.pos.z,
        0, Math.max(0.1, e.type.height - 0.2), 0,
      );
      if (t.dist > r) continue;
      _v3.set(e.pos.x, e.pos.y + e.type.height * 0.55, e.pos.z);
      if (!this.collision.hasLineOfSight(origin, _v3, maxDist)) continue;
      // prefer the nearest along the ray, tie-broken by how centred it is
      const score = t.s * maxDist + t.dist * 4;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  /** Cone sweep used by the player's melee. */
  meleeSweep(origin, dir, range, arcCos, damage) {
    let hits = 0;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const dx = e.pos.x - origin.x;
      const dz = e.pos.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.type.radius) continue;
      if (Math.abs(e.pos.y - origin.y) > 3.2) continue;
      const dot = (dx / (d || 1)) * dir.x + (dz / (d || 1)) * dir.z;
      if (dot < arcCos) continue;
      this.damage(e, damage, _v1.set(dx / (d || 1), 0, dz / (d || 1)).multiplyScalar(1.6));
      this.vfx.impactSpark(_v2.set(e.pos.x, e.pos.y + e.type.height * 0.6, e.pos.z), 0xffe08a, true);
      hits++;
    }
    return hits;
  }

  nearest(pos, maxDist = Infinity) {
    let best = null;
    let bd = maxDist * maxDist;
    for (const e of this.list) {
      if (e.hp <= 0) continue;
      const d2 = (e.pos.x - pos.x) ** 2 + (e.pos.z - pos.z) ** 2;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }

  clear() {
    for (const e of this.list) {
      if (e.ragdoll) {
        // never leave a solver driving a body we just handed back to the pool
        if (e.ragdoll.alive) e.ragdoll.remove();
        e.ragdoll = null;
      }
      e.object.visible = false;
      this.pools[e.typeId].push(e);
    }
    this.list.length = 0;
    this.pack.members.length = 0;
    this.vfxRng.reset(ENEMY_VFX_SEED);
  }

  /* ================================================================ */
  /* update                                                            */
  /* ================================================================ */
  update(dt, ctx) {
    const player = ctx.player;
    const pp = this._info.pp.copy(player.pos);
    const info = this._info;
    info.player = player;
    info.pc.copy(player.centre);
    info.dt = dt;
    info.ctx = ctx;

    updatePack(this, dt, info);

    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      const t = e.type;
      e.stateT += dt;
      e.hurt = Math.max(0, e.hurt - dt * 3.4);
      e.flinch = Math.max(0, e.flinch - dt);
      e.stagger = Math.max(0, e.stagger - dt);
      e.staggerCd = Math.max(0, e.staggerCd - dt);
      e.burstDmg = Math.max(0, e.burstDmg - dt * e.maxHp * 0.9);
      for (let p = 0; p < e.brokenPlates; p++) e.plateAge[p] += dt;

      /* --- death: a real collapse, then the body sinks away --- */
      if (e.state === 'dead') {
        this._updateCorpse(e, dt, ctx, i);
        continue;
      }

      /* --- spawn pop-in --- */
      if (e.state === 'spawn') {
        const k = Math.min(1, e.stateT / 0.55);
        e.object.scale.setScalar(e.scale * (0.15 + k * 0.85 * (1 + Math.sin(k * Math.PI) * 0.12)));
        if (e.stateT >= 0.55) {
          e.object.scale.setScalar(e.scale);
          this._enterState(e, e.typeId === 'boss' ? 'entrance' : 'chase');
        }
      }

      const dx = pp.x - e.pos.x;
      const dz = pp.z - e.pos.z;
      const distFlat = Math.hypot(dx, dz) || 0.001;
      const distFull = Math.hypot(dx, pp.y - e.pos.y, dz);
      const toX = dx / distFlat;
      const toZ = dz / distFlat;
      info.distFlat = distFlat;
      info.distFull = distFull;
      info.toX = toX;
      info.toZ = toZ;

      /* --- aggro: the moment it picks the player out ---
       * One call per acquisition, re-armed if it loses him, plus an
       * occasional re-issue so a long fight does not go quiet. The line of
       * sight test is throttled — this runs for up to fifteen creatures. */
      if (this.onAggro && e.typeId !== 'boss' && e.state !== 'spawn') {
        e.aggroScan -= dt;
        if (e.aggroed) {
          e.aggroT += dt;
          if (distFlat > 62) {
            e.aggroed = false;
            e.aggroT = 0;
          } else if (e.aggroT > e.aggroNext && distFlat < 40) {
            e.aggroT = 0;
            e.aggroNext = this.rng.float(11, 19);
            this.onAggro(e);
          }
        } else if (e.aggroScan <= 0) {
          e.aggroScan = 0.4;
          if (distFlat < 34 && this.los(e, info, 42)) {
            e.aggroed = true;
            e.aggroT = 0;
            e.aggroNext = this.rng.float(9, 16);
            this.onAggro(e);
          }
        }
      }

      /* --- AI --- */
      e.moveX = 0;
      e.moveZ = 0;
      e.moveSpeed = e.speed;
      e.faceX = undefined;
      e.faceZ = undefined;

      if (e.state === 'stagger') {
        // rocked back: no steering, and it cannot attack out of it
        if (e.stagger <= 0) this._enterState(e, 'chase');
      } else if (e.state === 'downed') {
        e.downT -= dt;
        if (e.downT <= 0) this._enterState(e, 'chase');
      } else if (e.typeId === 'boss') {
        bossBrain(this, e, info);
      } else if (BRAINS[e.typeId]) {
        BRAINS[e.typeId](this, e, info);
      }

      if (e.act) this._tickAct(e, dt, info);

      /* --- state watchdog ---
       * The wave director waits on aliveCount, and the stuck recovery below
       * only runs while chasing, so nothing may sit in another state
       * indefinitely. This is the backstop for that guarantee. */
      if (e.state !== 'chase' && e.stateT > 26) {
        e.act = null;
        e.flying = false;
        e.vulnerable = 0;
        this._enterState(e, e.typeId === 'boss' ? 'ground' : 'chase');
      }

      let moveX = e.moveX;
      let moveZ = e.moveZ;
      let speed = e.moveSpeed;

      /* --- obstacle avoidance: probe ahead, veer if blocked (verbatim) --- */
      if (e.state === 'chase' || e.state === 'fly') {
        e.repathT -= dt;
        if (e.repathT <= 0) {
          e.repathT = 0.22;
          const probe = _v1.set(moveX, 0, moveZ);
          if (probe.lengthSq() > 1e-6) {
            probe.normalize();
            const eye = _v2.set(e.pos.x, e.pos.y + t.height * 0.5, e.pos.z);
            const blocked = this.collision.raycast(eye, probe, t.radius + 2.6, 0.5) !== Infinity;
            if (blocked) {
              e.avoidT = 0.5;
              // try both sides, keep the one that is open
              const a = Math.PI / 2.4 * e.avoidSide;
              const sx = probe.x * Math.cos(a) - probe.z * Math.sin(a);
              const sz = probe.x * Math.sin(a) + probe.z * Math.cos(a);
              const alt = _v3.set(sx, 0, sz).normalize();
              if (this.collision.raycast(eye, alt, t.radius + 2.6, 0.5) !== Infinity) e.avoidSide *= -1;
              e.avoidX = sx; e.avoidZ = sz;
            } else {
              e.avoidT = 0;
            }
          } else {
            e.avoidT = 0;
          }
        }
        if (e.avoidT > 0) {
          e.avoidT -= dt;
          moveX = moveX * 0.35 + e.avoidX * 0.9;
          moveZ = moveZ * 0.35 + e.avoidZ * 0.9;
        }
      }

      /* --- stuck recovery (verbatim) ---
       * These things steer, they don't path-find. A whelp wedged behind a
       * fountain would stall the whole wave, so if one stops making progress
       * for long enough it burrows and re-emerges near the player. */
      if (e.state === 'chase') {
        // Measure movement toward the player's previous position. Distance to
        // the current player is not enough: a freely moving enemy can lose
        // ground when the player is faster, which must not count as "stuck".
        if (e.progressX === undefined) {
          e.progressX = e.pos.x;
          e.progressZ = e.pos.z;
          e.progressTargetX = pp.x;
          e.progressTargetZ = pp.z;
        }
        e.progressT += dt;
        if (e.progressT >= 0.75) {
          const targetX = e.progressTargetX - e.progressX;
          const targetZ = e.progressTargetZ - e.progressZ;
          const targetLen = Math.hypot(targetX, targetZ) || 1;
          const movedTowardTarget = (
            (e.pos.x - e.progressX) * targetX
            + (e.pos.z - e.progressZ) * targetZ
          ) / targetLen;
          const minProgress = Math.max(0.25, e.speed * e.progressT * 0.12);
          if (movedTowardTarget > minProgress || distFlat <= e.type.attackRange + 2) {
            e.stuckT = 0;
          } else {
            e.stuckT += e.progressT;
          }
          e.progressT = 0;
          e.progressX = e.pos.x;
          e.progressZ = e.pos.z;
          e.progressTargetX = pp.x;
          e.progressTargetZ = pp.z;
        }
        if (e.stuckT > 1.2 && e.stuckT < 4.5) {
          // try harder to slide around whatever is in the way
          e.avoidT = 0.4;
        }
        if (e.stuckT >= 4.5) {
          e.stuckT = 0;
          e.progressT = 0;
          const relocated = ctx.findOpenPointNear && ctx.findOpenPointNear(pp.x, pp.z, 22);
          if (relocated) {
            this.vfx.burst(_v1.copy(e.pos).setY(e.pos.y + 0.5), 0x8a6a3a, 14, 5, { size: 0.4, life: 0.6 });
            e.pos.copy(relocated);
            e.vel.set(0, 0, 0);
            e.progressX = undefined;
            this.vfx.burst(_v1.copy(e.pos).setY(e.pos.y + 0.5), 0xff6a2a, 18, 6, { size: 0.45, life: 0.7, up: 3 });
          }
        }
      } else {
        e.progressT = 0;
        e.progressX = undefined;
        e.stuckT = 0;
      }

      /* --- motion --- */
      const mLen = Math.hypot(moveX, moveZ);
      if (mLen > 0.001 && e.flinch <= 0 && e.stagger <= 0 && e.state !== 'downed') {
        moveX /= mLen; moveZ /= mLen;
        const accel = 12;
        e.vel.x += (moveX * speed - e.vel.x) * Math.min(1, accel * dt);
        e.vel.z += (moveZ * speed - e.vel.z) * Math.min(1, accel * dt);
      } else {
        const f = Math.exp(-6 * dt);
        e.vel.x *= f;
        e.vel.z *= f;
      }

      // don't climb inside the player
      {
        const rr = e.type.radius + 0.75;
        if (distFlat < rr) {
          const push = ((rr - distFlat) / rr) * 540 * dt;
          e.vel.x -= toX * push;
          e.vel.z -= toZ * push;
        }
      }

      // separation so packs don't stack up — spread wider than the hitboxes
      // so a group reads as a group instead of one pile
      for (let j = 0; j < this.list.length; j++) {
        const o = this.list[j];
        if (o === e || o.hp <= 0) continue;
        const ox = e.pos.x - o.pos.x;
        const oz = e.pos.z - o.pos.z;
        const rr = (e.type.radius + o.type.radius) * (SPACING[e.typeId] ?? 1);
        const d2 = ox * ox + oz * oz;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = ((rr - d) / d) * 156 * dt / e.type.mass;
          e.vel.x += ox * push;
          e.vel.z += oz * push;
        }
      }

      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      this.collision.resolve(e.pos, e.type.radius, e.type.height, 1.15);

      if (e.flying) {
        // altitude is flown, not fallen: gravity is off and the brain steers
        // by moving flyTarget.y. Horizontal collision still applies above,
        // so nothing flies through a facade.
        const gy = this.groundAt(e);
        const wantY = Math.max(e.flyTarget.y, gy + 1.2);
        e.pos.y = damp(e.pos.y, wantY, e.typeId === 'boss' ? 2.2 : 2.6, dt);
        e.vel.y = 0;
        e.onGround = false;
      } else {
        e.vel.y -= 22 * dt;
        e.pos.y += e.vel.y * dt;
        const gy = this.collision.groundHeight(e.pos.x, e.pos.z, e.pos.y, e.type.radius, 1.2);
        if (e.pos.y <= gy) {
          e.pos.y = gy;
          e.vel.y = 0;
          e.onGround = true;
        } else e.onGround = false;
      }

      /* --- facing + animation --- */
      const toPlayerFacing = Math.atan2(-toX, -toZ);
      const targetFacing = (e.faceX !== undefined && Math.hypot(e.faceX, e.faceZ) > 0.001)
        ? Math.atan2(-e.faceX, -e.faceZ)
        : toPlayerFacing;
      const diff = ((targetFacing - e.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const turnRate = e.state === 'attack' ? 9 : e.state === 'exhausted' ? 1.5 : 5.5;
      e.facing += diff * Math.min(1, dt * turnRate);
      e.object.position.copy(e.pos);
      e.object.rotation.y = e.facing;

      // Head aim in the creature's own space. Always measured against the
      // player, never against the direction of travel, so a flanking whelp
      // keeps its eyes on him while its body runs sideways.
      const eyeY = e.pos.y + t.height * 0.75;
      e.look.yaw = ((toPlayerFacing - e.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      e.look.pitch = Math.atan2(info.pc.y - eyeY, Math.max(1, distFlat));

      const planar = Math.hypot(e.vel.x, e.vel.z);
      e.run = clamp01(planar / Math.max(1, e.speed));
      e.model.def.animate(e, dt, this._animCtx(ctx));
      this._shade(e);
      this._updateBar(e, ctx.camera);
    }
  }

  _animCtx(ctx) {
    this._actx = this._actx || { vfx: null, rng: null, scratch: new THREE.Vector3(), camera: null };
    this._actx.vfx = this.vfx;
    this._actx.rng = this.vfxRng;
    this._actx.camera = ctx.camera;
    return this._actx;
  }

  /* ---------------------------------------------------------------- */
  _die(e) {
    e.hp = 0;
    e.act = null;
    e.vulnerable = 0;
    e.shield = 0;
    e.run = 0;          // a corpse must not keep running on the spot
    e.stagger = 0;
    this._enterState(e, 'dead');
    e.corpseOnGround = e.onGround && !e.flying;
    e.landedT = 0;
    if (e.flying) {
      // shot out of the sky: let it fall, keeping its momentum
      e.flying = false;
      e.vel.y = Math.min(e.vel.y, 0);
    }
    const c = e.typeId === 'golem' ? 0xffa040 : e.typeId === 'boss' ? 0xff5522 : 0x9aff6a;
    this.vfx.burst(_v1.copy(e.pos).setY(e.pos.y + e.type.height * 0.5), c, e.typeId === 'boss' ? 90 : 24,
      e.typeId === 'boss' ? 18 : 7, { size: e.typeId === 'boss' ? 0.9 : 0.35, life: 1.1, grav: -3, drag: 2.2 });
    if (e.typeId === 'golem' || e.typeId === 'boss') {
      this.vfx.explosion(_v1.copy(e.pos).setY(e.pos.y + 1.4), e.typeId === 'boss' ? 14 : 5, 0xff8a3a);
    }
    /* Hand the skeleton to the ragdoll solver if one was injected. It blends
     * out of the pose that was on screen, so there is no snap; the animators
     * stop writing bones for as long as `e.ragdoll` is set. Without a solver
     * the procedural collapse in the animators plays instead. */
    this._handOffToRagdoll(e, e.lastHitX ?? 0, e.lastHitZ ?? 1);
    this.onDeath && this.onDeath(e);
  }

  /**
   * A corpse keeps its weight: it finishes falling, hits the ground with a
   * thud of dust, lies there through the collapse animation and only then
   * sinks away and returns to the pool.
   */
  _updateCorpse(e, dt, ctx, index) {
    e.bar.group.visible = false;

    /* --- solver-driven corpse --- */
    if (e.ragdoll) {
      if (e.ragdoll.alive) {
        const life = (CORPSE_LIFE[e.typeId] ?? 2.8) * 2.4;
        // the solver fades once it has settled; ride that into the ground
        const fade = e.ragdoll.fade ?? 1;
        const sink = (1 - fade) * (e.typeId === 'boss' ? 2.6 : 0.9);
        this._driveRagdoll(e, sink);
        e.glow = -0.75 * (1 - fade);     // the light goes out of it
        this._shade(e);
        if (e.stateT > life) {
          e.ragdoll.remove();
          e.ragdoll = null;
        }
        return;
      }
      /* The handle died — settled and faded out, or evicted by a newer
       * ragdoll. If it faded on schedule the body is gone and the slot goes
       * back to the pool; if it was cut short, fall back to the procedural
       * corpse so nothing pops out of the world in front of the player. */
      e.ragdoll = null;
      const life = CORPSE_LIFE[e.typeId] ?? 2.8;
      if (e.stateT < life * 0.6) {
        e.corpseOnGround = true;
        e.landedT = Math.max(e.landedT, 0.4);
      } else {
        e.object.visible = false;
        this.pools[e.typeId].push(e);
        this.list.splice(index, 1);
        return;
      }
    }

    if (!e.corpseOnGround) {
      e.vel.y -= 22 * dt;
      const f = Math.exp(-1.1 * dt);
      e.vel.x *= f;
      e.vel.z *= f;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
      this.collision.resolve(e.pos, e.type.radius, e.type.height, 1.15);
      e.pos.y += e.vel.y * dt;
      const gy = this.collision.groundHeight(e.pos.x, e.pos.z, e.pos.y, e.type.radius, 1.2);
      if (e.pos.y <= gy) {
        e.pos.y = gy;
        e.corpseOnGround = true;
        e.landedT = 0;
        const power = Math.min(2.4, 0.6 + Math.abs(e.vel.y) * 0.08) * (e.typeId === 'boss' ? 2.4 : 1);
        if (this.vfx) {
          impactDust(this.vfx, this.vfxRng, e.pos.x, e.pos.y, e.pos.z, power);
          shards(this.vfx, this.vfxRng, e.pos.x, e.pos.y + 0.3, e.pos.z, 6, 0x6b5a44, 4);
        }
        e.vel.set(0, 0, 0);
      }
    } else {
      e.landedT += dt;
      const f = Math.exp(-9 * dt);
      e.vel.x *= f;
      e.vel.z *= f;
      e.pos.x += e.vel.x * dt;
      e.pos.z += e.vel.z * dt;
    }

    const life = CORPSE_LIFE[e.typeId] ?? 2.8;
    const sinkT = Math.max(0, e.stateT - (life - 0.6)) / 0.6;
    e.object.position.set(e.pos.x, e.pos.y - sinkT * (e.typeId === 'boss' ? 2.2 : 0.7), e.pos.z);
    e.object.rotation.y = e.facing;
    e.model.def.animate(e, dt, this._animCtx(ctx));
    this._shade(e);

    if (e.stateT > life) {
      e.object.visible = false;
      this.pools[e.typeId].push(e);
      this.list.splice(index, 1);
    }
  }

  /** Billboard the bar and show it only for wounded, non-boss enemies. */
  _updateBar(e, camera) {
    const bar = e.bar;
    if (!bar) return;
    const frac = e.hp / e.maxHp;
    if (!camera || e.typeId === 'boss' || e.hp <= 0 || frac >= 0.999) {
      bar.group.visible = false;
      return;
    }
    bar.group.visible = true;
    // local space: undo the parent's yaw and per-type scale
    const h = e.type.height / e.scale + 0.55;
    bar.group.position.set(0, h, 0);
    bar.group.rotation.set(0, -e.facing + Math.atan2(
      camera.position.x - e.pos.x, camera.position.z - e.pos.z), 0);
    bar.mat.uniforms.uFrac.value = Math.max(0, frac);
    bar.mat.uniforms.uFg.value.setRGB(1 - frac * 0.35, 0.25 + frac * 0.5, 0.2);
  }

  /**
   * Emissive drive and hit flash. Every glowing detail on a creature shares
   * one ember patch in its skin sheet, so a single emissiveIntensity per
   * instance pulses eyes, throat sacs, cores and vents — and the hit flash
   * rides the albedo multiplier instead, which reads on the whole body
   * without blowing out under ACES.
   */
  _shade(e) {
    const f = e.hurt;
    const base = e.model.def.emissiveBase ?? 2.2;
    const glow = Math.max(0.05, 1 + (e.glow ?? 0));
    const r = 1 + f * 1.5;
    const g = 1 - f * 0.42;
    const b = 1 - f * 0.55;
    for (const mt of e.flashMats) {
      mt.emissiveIntensity = base * glow;
      if (!mt.userData.baseColor) mt.userData.baseColor = mt.color.clone();
      const c = mt.userData.baseColor;
      if (f > 0.001) mt.color.setRGB(c.r * r, c.g * g, c.b * b);
      else if (mt.color.r !== c.r || mt.color.g !== c.g) mt.color.copy(c);
    }
  }
}

/* ------------------------------------------------------------------ */
/* ragdoll plans, cached per archetype                                 */
/* ------------------------------------------------------------------ */
const _ragPlans = new Map();
const _ragFixes = new Map();
const _UPY = new THREE.Vector3(0, 1, 0);

/**
 * Static half of the ragdoll handoff: for each driver bone, the rest-space
 * direction it runs in, the quaternion that maps +Y onto it, its length and
 * its collision/mass properties. Computed once per archetype from the rig's
 * rest pose, because none of it changes at runtime.
 */
function ragdollPlan(def, tpl) {
  let plan = _ragPlans.get(def.id);
  if (plan) return plan;
  plan = [];
  const rest = tpl.rest;
  for (const s of def.ragdoll || []) {
    const from = rest[s.name];
    if (!from) continue;
    const dir = new THREE.Vector3();
    let length = s.length ?? 0.25;
    if (s.tip && rest[s.tip]) {
      dir.copy(rest[s.tip]).sub(from);
      const d = dir.length();
      if (d > 1e-4) length = d;
    } else {
      // no tip: the bone runs the way it was placed relative to its rig parent
      const rigParent = tpl.parents[tpl.index[s.name]];
      if (rigParent && rest[rigParent]) dir.copy(from).sub(rest[rigParent]);
    }
    if (dir.lengthSq() < 1e-8) dir.copy(_UPY);
    dir.normalize();
    const fix = new THREE.Quaternion().setFromUnitVectors(_UPY, dir);
    plan.push({
      name: s.name,
      parent: s.parent || null,
      fix,
      fixInv: fix.clone().invert(),
      length,
      radius: s.radius,
      mass: s.mass,
      cone: s.cone ?? 0.9,
      twist: s.twist ?? 0.5,
    });
  }
  _ragPlans.set(def.id, plan);
  return plan;
}

/** name → inverse fix quaternion, for the per-frame write-back. */
function ragdollFixMap(def, tpl) {
  let map = _ragFixes.get(def.id);
  if (map) return map;
  map = new Map();
  for (const p of ragdollPlan(def, tpl)) map.set(p.name, p.fixInv);
  _ragFixes.set(def.id, map);
  return map;
}

/**
 * Closest approach between segment P(s) = p + s*u and segment Q(t) = q + t*v,
 * with s and t clamped to [0,1]. Returns { s, t, dist }.
 */
const _res = { s: 0, t: 0, dist: 0 };
function closestOnSegments(px, py, pz, ux, uy, uz, qx, qy, qz, vx, vy, vz) {
  const wx = px - qx, wy = py - qy, wz = pz - qz;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const denom = a * c - b * b;
  let s, t;
  if (denom < 1e-9) {
    s = 0;
    t = c > 1e-9 ? e / c : 0;
  } else {
    s = (b * e - c * d) / denom;
    t = (a * e - b * d) / denom;
  }
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  // re-solve t for the clamped s, then clamp and re-solve s: one pass is plenty here
  t = c > 1e-9 ? (e + b * s) / c : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  s = a > 1e-9 ? (b * t - d) / a : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const dx = wx + ux * s - vx * t;
  const dy = wy + uy * s - vy * t;
  const dz = wz + uz * s - vz * t;
  _res.s = s;
  _res.t = t;
  _res.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return _res;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
/* ragdoll handoff scratch — decompose targets and quaternion working space */
const _rp = new THREE.Vector3();
const _rs = new THREE.Vector3();
const _rv = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _rq2 = new THREE.Quaternion();
const _rqi = new THREE.Quaternion();
