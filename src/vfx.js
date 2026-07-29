import * as THREE from 'three';
import { makeGradientSprite, makeSmokeTexture } from './textures.js';

/* ==================================================================
   Projectiles, particles, explosions and the dragon rifts.
   Everything is pooled — no allocation during play.
   ================================================================== */

const MAX_PARTICLES = 1400;

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.glowTex = makeGradientSprite('#ffffff', 'rgba(255,255,255,0)');
    this.smokeTex = makeSmokeTexture();

    /* ---- particles (single Points cloud) ---- */
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.pSize, 1));
    geo.setDrawRange(0, 0);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    this.pMax = new Float32Array(MAX_PARTICLES);
    this.pDrag = new Float32Array(MAX_PARTICLES);
    this.pGrav = new Float32Array(MAX_PARTICLES);
    this.pBase = new Float32Array(MAX_PARTICLES);
    this.pCount = 0;
    this.pFree = [];

    const pMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: this.glowTex } },
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        varying float vAlive;
        void main() {
          vColor = color;
          vAlive = step(0.0001, size);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * 320.0 / max(1.0, -mv.z);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec3 vColor;
        varying float vAlive;
        void main() {
          if (vAlive < 0.5) discard;
          vec4 t = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor, 1.0) * t.a;
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, pMat);
    this.points.frustumCulled = false;
    scene.add(this.points);

    /* ---- projectiles ---- */
    this.projectiles = [];
    this.projPool = [];
    const bulletGeo = new THREE.SphereGeometry(0.12, 8, 6);
    const trailGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 6, 1, true);
    trailGeo.rotateX(Math.PI / 2);
    trailGeo.translate(0, 0, -0.5);
    this._bulletGeo = bulletGeo;
    this._trailGeo = trailGeo;

    /* ---- explosion shells ---- */
    this.shells = [];
    this.shellPool = [];
    this._shellGeo = new THREE.SphereGeometry(1, 16, 12);

    /* ---- pooled lights for big hits ---- */
    // Fixed light pools: three.js recompiles materials when the visible light
    // count changes, so these stay in the scene forever at zero intensity.
    this.lights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 24, 2);
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, power: 0 });
    }
    this.riftLights = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff5522, 0, 30, 2);
      scene.add(l);
      this.riftLights.push({ light: l, busy: false });
    }
    this.pickupAssets = new Map();
  }

  /* ---------------- particles ---------------- */
  emit(x, y, z, vx, vy, vz, color, size, life, drag = 2.2, grav = 0) {
    let i;
    while (this.pFree.length > 0) {
      const candidate = this.pFree.pop();
      if (candidate < this.pCount && this.pLife[candidate] <= 0) {
        i = candidate;
        break;
      }
    }
    if (i === undefined) {
      if (this.pCount < MAX_PARTICLES) {
        i = this.pCount++;
      } else {
        // Every slot is live: replace the particle closest to expiry.
        i = 0;
        for (let j = 1; j < MAX_PARTICLES; j++) {
          if (this.pLife[j] < this.pLife[i]) i = j;
        }
      }
    }
    const i3 = i * 3;
    this.pPos[i3] = x; this.pPos[i3 + 1] = y; this.pPos[i3 + 2] = z;
    this.pVel[i3] = vx; this.pVel[i3 + 1] = vy; this.pVel[i3 + 2] = vz;
    this.pCol[i3] = color.r; this.pCol[i3 + 1] = color.g; this.pCol[i3 + 2] = color.b;
    this.pSize[i] = size;
    this.pBase[i] = size;
    this.pLife[i] = life;
    this.pMax[i] = life;
    this.pDrag[i] = drag;
    this.pGrav[i] = grav;
  }

  burst(pos, color, count, speed, opts = {}) {
    const c = _c1.set(color);
    const size = opts.size ?? 0.28;
    const life = opts.life ?? 0.55;
    const up = opts.up ?? 0;
    for (let i = 0; i < count; i++) {
      const dir = _v1.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const s = speed * (0.35 + Math.random() * 0.9);
      this.emit(
        pos.x + dir.x * 0.15, pos.y + dir.y * 0.15, pos.z + dir.z * 0.15,
        dir.x * s, dir.y * s + up, dir.z * s,
        c, size * (0.6 + Math.random() * 0.9), life * (0.6 + Math.random() * 0.8),
        opts.drag ?? 3.0, opts.grav ?? 0,
      );
    }
  }

  /* ---------------- projectiles ---------------- */
  spawnProjectile(origin, dir, opts = {}) {
    let p = this.projPool.pop();
    if (!p) {
      const colour = new THREE.Color(0x7fe4ff);
      const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, blending: THREE.AdditiveBlending });
      const core = new THREE.Mesh(this._bulletGeo, mat);
      const trail = new THREE.Mesh(this._trailGeo, mat.clone());
      trail.material.opacity = 0.5;
      core.add(trail);
      const light = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: colour, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }));
      light.scale.set(0.95, 0.95, 0.95);
      core.add(light);
      p = { mesh: core, trail, halo: light, mat, dir: new THREE.Vector3(), vel: new THREE.Vector3() };
      this.scene.add(core);
    }
    const colour = opts.color ?? 0x7fe4ff;
    p.mat.color.set(colour);
    p.trail.material.color.set(colour);
    p.halo.material.color.set(colour);
    p.mesh.visible = true;
    p.mesh.position.copy(origin);
    p.dir.copy(dir).normalize();
    p.speed = opts.speed ?? 150;
    p.damage = opts.damage ?? 30;
    p.owner = opts.owner ?? 'player';
    p.life = opts.life ?? 2.2;
    p.radius = opts.radius ?? 0.35;
    p.splash = opts.splash ?? 0;
    p.scale = opts.scale ?? 1;
    p.mesh.scale.setScalar(p.scale);
    p.trail.scale.set(1, 1, (opts.trail ?? 3.2) / p.scale);
    p.mesh.lookAt(_v1.copy(origin).add(p.dir));
    this.projectiles.push(p);
    return p;
  }

  /* ---------------- explosions ---------------- */
  explosion(pos, radius, color = 0xffa04a, opts = {}) {
    let s = this.shellPool.pop();
    if (!s) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._shellGeo, mat);
      this.scene.add(mesh);
      s = { mesh, mat };
    }
    s.mat.color.set(color);
    s.mesh.visible = true;
    s.mesh.position.copy(pos);
    s.mesh.scale.setScalar(0.4);
    s.life = 0;
    s.max = opts.duration ?? 0.42;
    s.radius = radius;
    this.shells.push(s);

    this.burst(pos, color, 26, radius * 4.5, { size: 0.55, life: 0.7, grav: -4, drag: 2.4 });
    this.burst(pos, 0x503428, 14, radius * 1.6, { size: 1.4, life: 1.5, grav: -0.6, drag: 1.4 });
    this.flash(pos, color, radius * 7, 0.32);
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

  /* ---------------- rifts (enemy spawn portals) ---------------- */
  makeRift(pos, scale = 1) {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff4d2a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2 * scale, 0.22 * scale, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.4;
    g.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.1 * scale, 0.1 * scale, 6, 32), ringMat.clone());
    ring2.material.color.set(0xffb04a);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.25;
    g.add(ring2);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x2a0a06, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(2.15 * scale, 24), coreMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.42;
    g.add(disc);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9 * scale, 2.4 * scale, 26, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff5a2a, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    beam.position.y = 13;
    g.add(beam);
    const slot = this.riftLights.find((l) => !l.busy) ?? null;
    const light = slot?.light ?? null;
    if (slot) {
      slot.busy = true;
      light.position.set(pos.x, pos.y + 1.6, pos.z);
      light.distance = 30 * scale;
    }
    g.position.copy(pos);
    this.scene.add(g);

    const rift = {
      group: g, ring, ring2, disc, beam, light, pos: g.position, scale,
      t: Math.random() * 10,
      update: (dt) => {
        rift.t += dt;
        ring.rotation.z += dt * 0.9;
        ring2.rotation.z -= dt * 1.4;
        const pulse = 1 + Math.sin(rift.t * 3.1) * 0.06;
        ring.scale.setScalar(pulse);
        ring2.scale.setScalar(2 - pulse);
        if (light) light.intensity = (11 + Math.sin(rift.t * 5.5) * 4) * scale;
        beam.material.opacity = 0.08 + Math.abs(Math.sin(rift.t * 1.3)) * 0.07;
        if (Math.random() < dt * 26) {
          this.emit(
            g.position.x + (Math.random() - 0.5) * 4 * scale,
            g.position.y + 0.4,
            g.position.z + (Math.random() - 0.5) * 4 * scale,
            (Math.random() - 0.5) * 0.6, 1.6 + Math.random() * 3.2, (Math.random() - 0.5) * 0.6,
            _c1.set(0xff6a2a), 0.4 * scale, 1.5, 0.6, 0.4,
          );
        }
      },
      dispose: () => {
        if (slot) {
          light.intensity = 0;
          slot.busy = false;
        }
        this.scene.remove(g);
        g.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        });
      },
    };
    return rift;
  }

  /* ---------------- pickup beacon ---------------- */
  makePickupVisual(color = 0x7ddf64) {
    let assets = this.pickupAssets.get(color);
    if (!assets) {
      assets = {
        boxGeometry: new THREE.BoxGeometry(0.42, 0.42, 0.42),
        boxMaterial: new THREE.MeshStandardMaterial({
          color, emissive: color, emissiveIntensity: 1.1, roughness: 0.4,
        }),
        haloMaterial: new THREE.SpriteMaterial({
          map: this.glowTex, color, blending: THREE.AdditiveBlending,
          transparent: true, depthWrite: false, opacity: 0.3,
        }),
        beamGeometry: new THREE.CylinderGeometry(0.16, 0.2, 3.4, 8, 1, true),
        beamMaterial: new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide,
        }),
      };
      this.pickupAssets.set(color, assets);
    }

    const g = new THREE.Group();
    const box = new THREE.Mesh(assets.boxGeometry, assets.boxMaterial);
    box.position.y = 0.8;
    box.castShadow = true;
    g.add(box);
    // A marker, not a flare: additive sprites this size read as screen artefacts.
    const halo = new THREE.Sprite(assets.haloMaterial);
    halo.scale.set(0.95, 0.95, 1);
    halo.position.y = 0.8;
    g.add(halo);
    const beam = new THREE.Mesh(assets.beamGeometry, assets.beamMaterial);
    beam.position.y = 1.9;
    g.add(beam);
    return { group: g, box, halo };
  }

  /* ---------------- per-frame ---------------- */
  update(dt, ctx) {
    /* projectiles */
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = p.speed * dt;
      const from = _v2.copy(p.mesh.position);
      p.mesh.position.addScaledVector(p.dir, step);
      p.life -= dt;

      let hit = null;
      let hitDist = Infinity;

      // targets
      if (p.owner === 'player') {
        const e = ctx.enemies.raySegmentHit(from, p.dir, step + p.radius, p.radius);
        if (e) { hit = { type: 'enemy', enemy: e.enemy, point: e.point }; hitDist = e.dist; }
      } else if (ctx.player.alive) {
        const pc = ctx.player.centre;
        const d = distancePointSegment(pc, from, p.mesh.position);
        if (d < p.radius + 0.55) {
          hit = { type: 'player', point: _v3.copy(pc) };
          hitDist = 0;
        }
      }

      // world
      const worldT = ctx.collision.raycast(from, p.dir, step + 0.1, 0.5);
      if (worldT !== Infinity && worldT < hitDist) {
        hit = { type: 'world', point: _v3.copy(from).addScaledVector(p.dir, worldT) };
      }

      if (hit) {
        ctx.onProjectileHit && ctx.onProjectileHit(p, hit);
        this._despawn(p, i);
        continue;
      }
      if (p.life <= 0 || p.mesh.position.y < -4) {
        this._despawn(p, i);
      }
    }

    /* shells */
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life += dt;
      const t = s.life / s.max;
      if (t >= 1) {
        s.mesh.visible = false;
        this.shells.splice(i, 1);
        this.shellPool.push(s);
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      s.mesh.scale.setScalar(0.4 + e * s.radius);
      s.mat.opacity = 0.85 * (1 - t) * (1 - t);
    }

    /* lights */
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.light.intensity = 0; continue; }
      const k = l.life / l.max;
      l.light.intensity = l.power * k * k;
    }

    /* particles */
    const n = this.pCount;
    for (let i = 0; i < n; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pLife[i] = 0;
        this.pSize[i] = 0;
        this.pFree.push(i);
        continue;
      }
      const i3 = i * 3;
      const drag = Math.exp(-this.pDrag[i] * dt);
      this.pVel[i3] *= drag;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * drag + this.pGrav[i] * dt * 9;
      this.pVel[i3 + 2] *= drag;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      if (this.pPos[i3 + 1] < 0.05) {
        this.pPos[i3 + 1] = 0.05;
        this.pVel[i3 + 1] *= -0.25;
      }
      const k = Math.max(0, this.pLife[i] / this.pMax[i]);
      this.pSize[i] = this.pBase[i] * (0.25 + k * 0.9);
    }
    while (this.pCount > 0 && this.pLife[this.pCount - 1] <= 0) this.pCount--;
    const geo = this.points.geometry;
    geo.setDrawRange(0, this.pCount);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  }

  _despawn(p, index) {
    p.mesh.visible = false;
    this.projectiles.splice(index, 1);
    this.projPool.push(p);
  }

  impactSpark(point, color = 0xffd08a, big = false) {
    this.burst(point, color, big ? 18 : 9, big ? 8 : 5.5, {
      size: big ? 0.34 : 0.2, life: big ? 0.5 : 0.3, drag: 5, grav: -1.5,
    });
    if (big) this.flash(point, color, 12, 0.14);
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

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c1 = new THREE.Color();
