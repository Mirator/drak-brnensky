import * as THREE from 'three';
import { CollisionWorld } from './physics.js';
import { buildCity, PLACES } from './city.js';
import { Player, WEAPON } from './player.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { VFX } from './vfx.js';
import { EnemyManager, ENEMY_TYPES } from './enemies.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Rng } from './rng.js';

/* ==================================================================
   DRAK BRNĚNSKÝ — third-person action, central Brno
   ================================================================== */

let lastTime = performance.now();
const rng = new Rng(90210);

const state = {
  mode: 'loading', // loading | menu | playing | paused | dead
  score: 0,
  wave: 0,
  waveState: 'idle', // idle | active | cleared
  waveTimer: 0,
  kills: 0,
  time: 0,
  started: 0,
  objective: 'Připrav se',
  objectiveDist: '—',
  aimingAtEnemy: false,
};

/* ---------------- renderer & scene ---------------- */
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2b2c38, 0.0021);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.12, 2400);
camera.position.set(0, 12, 40);

/* ---------------- dusk sky ---------------- */
const SUN_DIR = new THREE.Vector3(-0.55, 0.34, -0.76).normalize();
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1200, 40, 24),
  new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: SUN_DIR },
      uTop: { value: new THREE.Color(0x121c33) },
      uMid: { value: new THREE.Color(0x4a4a63) },
      uHorizon: { value: new THREE.Color(0xd08a4a) },
      uSunCol: { value: new THREE.Color(0xffd9a0) },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uTop, uMid, uHorizon, uSunCol;
      uniform float uTime;
      varying vec3 vDir;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -1.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.02, 0.30, h));
        col = mix(col, uTop, smoothstep(0.22, 0.85, h));
        // sun disc + bloom
        float sd = max(dot(d, normalize(uSun)), 0.0);
        col += uSunCol * pow(sd, 42.0) * 1.5;
        col += uSunCol * pow(sd, 6.0) * 0.30;
        col += vec3(0.9,0.45,0.2) * pow(sd, 2.0) * 0.10;
        // ground haze below the horizon
        col = mix(col, vec3(0.10,0.10,0.13), smoothstep(0.0, -0.20, h));
        // faint stars up high
        float s = step(0.9985, hash(floor(d * 620.0)));
        col += vec3(0.8,0.85,1.0) * s * smoothstep(0.15, 0.8, h) * 0.7;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  }),
);
sky.frustumCulled = false;
scene.add(sky);

/* ---------------- lights ---------------- */
const hemi = new THREE.HemisphereLight(0x9fb4d8, 0x3a3128, 0.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffc98a, 2.5);
sun.position.copy(SUN_DIR).multiplyScalar(120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 340;
const SH = 78;
sun.shadow.camera.left = -SH;
sun.shadow.camera.right = SH;
sun.shadow.camera.top = SH;
sun.shadow.camera.bottom = -SH;
sun.shadow.bias = -0.0007;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);

const fillLight = new THREE.DirectionalLight(0x6a86c8, 0.35);
fillLight.position.set(0.6, 0.5, 0.8);
scene.add(fillLight);

/* ---------------- systems ---------------- */
const collision = new CollisionWorld();
const input = new Input(canvas);
const audio = new Audio();
let world = null;
let vfx = null;
let player = null;
let chase = null;
let enemies = null;
let hud = null;

/* ---------------- rifts & pickups ---------------- */
const rifts = [];
const pickups = [];

function spawnRift(x, z, hp, scale = 1) {
  const y = collision.groundHeight(x, z, 6, 2) || 0;
  const visual = vfx.makeRift(new THREE.Vector3(x, y + 0.05, z), scale);
  const collider = collision.add(x, z, 3.0 * scale, 3.0 * scale, y, 3.6 * scale, 'nostand');
  const rift = {
    visual, collider, pos: visual.pos, hp, maxHp: hp,
    spawnTimer: 1.2, y, alive: true,
  };
  rifts.push(rift);
  return rift;
}

function damageRift(rift, amount) {
  if (!rift.alive) return;
  rift.hp -= amount;
  vfx.impactSpark(_tmp1.copy(rift.pos).setY(rift.pos.y + 1.4), 0xff8a4a, false);
  if (rift.hp <= 0) {
    rift.alive = false;
    vfx.explosion(_tmp1.copy(rift.pos).setY(rift.pos.y + 1.6), 11, 0xff5a2a);
    audio.explosion(1);
    chase.addShake(0.9);
    state.score += 500;
    hud.toast('TRHLINA UZAVŘENA', 'good');
    rift.visual.dispose();
    // the collider stays in the grid; make it harmless
    rift.collider.top = rift.collider.bottom;
    const i = rifts.indexOf(rift);
    if (i >= 0) rifts.splice(i, 1);
  }
}

function riftNear(point, maxDist = 3.6) {
  for (const r of rifts) {
    if (Math.abs(point.x - r.pos.x) > maxDist) continue;
    if (Math.abs(point.z - r.pos.z) > maxDist) continue;
    if (point.y > r.pos.y + 4.2) continue;
    return r;
  }
  return null;
}

function spawnPickup(kind, x, y, z) {
  const colour = kind === 'health' ? 0x7ddf64 : 0x7de3ff;
  const v = vfx.makePickupVisual(colour);
  v.group.position.set(x, y, z);
  scene.add(v.group);
  pickups.push({ kind, visual: v, pos: v.group.position, t: Math.random() * 6, life: 42 });
}

function collectPickup(p, index) {
  if (p.kind === 'health') {
    player.heal(38);
    hud.toast('+38 ZDRAVÍ', 'good');
  } else {
    player.ammo = WEAPON.mag;
    player.reloading = 0;
    hud.toast('MUNICE DOPLNĚNA', 'good');
  }
  audio.pickup();
  vfx.burst(p.pos, p.kind === 'health' ? 0x7ddf64 : 0x7de3ff, 14, 5, { size: 0.28, life: 0.5 });
  scene.remove(p.visual.group);
  pickups.splice(index, 1);
}

/* ==================================================================
   Wave director
   ================================================================== */
const WAVES = [
  { places: ['zelnyTrh'], types: ['whelp'], cap: 6, interval: 2.6, hp: 800,
    intro: 'Trhlina na Zelném trhu!', hint: 'Znič trhlinu — stačí do ní pálit.' },
  { places: ['svoboda', 'ceska'], types: ['whelp', 'whelp', 'spitter'], cap: 9, interval: 2.3, hp: 950,
    intro: 'Dvě trhliny v centru!', hint: 'Chrliči útočí z dálky — kryj se za domy.' },
  { places: ['petrov', 'zelnyTrh'], types: ['whelp', 'spitter', 'golem'], cap: 11, interval: 2.1, hp: 1100,
    intro: 'Petrov se otevřel!', hint: 'Golem je pomalý, ale drtí. Uhýbej (CTRL).' },
  { places: ['spilberk', 'moravske', 'mahen'], types: ['whelp', 'spitter', 'spitter', 'golem'], cap: 13,
    interval: 2.0, hp: 1250, intro: 'Špilberk hoří!', hint: 'Tři trhliny. Vyber si pořadí.' },
  { places: ['janacek', 'nadrazi'], types: ['whelp', 'spitter', 'golem'], cap: 12, interval: 2.2, hp: 1400,
    boss: 'svoboda', intro: 'DRAK BRNĚNSKÝ SE PROBUDIL', hint: 'Ulov ho na náměstí Svobody.' },
];
const ENDLESS_WAVE = {
  places: ['svoboda', 'petrov', 'spilberk'],
  types: ['whelp', 'spitter', 'spitter', 'golem'],
  cap: 14,
  interval: 1.9,
  hp: 1300,
  intro: 'TRHLINY SE ZNOVU OTEVÍRAJÍ',
  hint: 'Nekonečné vlny sílí. Drž centrum co nejdéle.',
};

let boss = null;

/* Cosmetic delayed toasts, ticked from the game loop so pausing holds them. */
const pendingToasts = [];
function queueToast(text, cls, delay) {
  pendingToasts.push({ text, cls, t: delay });
}
function updateToasts(dt) {
  for (let i = pendingToasts.length - 1; i >= 0; i--) {
    const q = pendingToasts[i];
    q.t -= dt;
    if (q.t <= 0) {
      hud.toast(q.text, q.cls);
      pendingToasts.splice(i, 1);
    }
  }
}

function startWave(n) {
  state.wave = n;
  state.waveState = 'active';
  const def = n <= WAVES.length ? WAVES[n - 1] : ENDLESS_WAVE;
  state.waveDef = def;
  const scale = 1 + Math.max(0, n - WAVES.length) * 0.35;

  for (const key of def.places) {
    const place = PLACES[key];
    // rifts need room around them: the player has to be able to circle one
    const p = world.randomOpenPoint(place.x, place.z, 24, rng, 5)
      || world.randomOpenPoint(place.x, place.z, 34, rng, 3)
      || new THREE.Vector3(place.x, 0, place.z);
    spawnRift(p.x, p.z, def.hp * scale);
  }

  if (def.boss) {
    const place = PLACES[def.boss];
    boss = enemies.spawn('boss', new THREE.Vector3(place.x, 0, place.z + 18), { hpScale: scale });
    hud.setBoss(ENEMY_TYPES.boss.name, 1, 'FÁZE I');
    audio.roar(true);
    chase.addShake(1.4);
  }

  hud.toast(`VLNA ${n}`, 'big');
  queueToast(def.intro, 'warn', 0.9);
  queueToast(def.hint, 'sub', 2.1);
  audio.waveHorn();
  audio.setMusicIntensity(Math.min(1, 0.3 + n * 0.16));
}

function waveCleared() {
  state.waveState = 'cleared';
  state.waveTimer = 6;
  state.score += 1000 * state.wave;
  player.ammo = WEAPON.mag;
  player.reloading = 0;
  player.heal(45);
  hud.toast(`VLNA ${state.wave} ZLIKVIDOVÁNA`, 'big');
  hud.toast('+munice, +zdraví', 'sub');
  audio.waveHorn();
  // a couple of care packages by the player
  for (let i = 0; i < 2; i++) {
    const p = world.randomOpenPoint(player.pos.x, player.pos.z, 14, rng);
    if (p) spawnPickup(i === 0 ? 'health' : 'ammo', p.x, p.y, p.z);
  }
}

function updateWaves(dt) {
  if (state.waveState === 'idle') return;

  // 'intro' and 'cleared' are both just countdowns to the next wave; running
  // them off simulation time means pausing really pauses them.
  if (state.waveState === 'intro' || state.waveState === 'cleared') {
    state.waveTimer -= dt;
    state.objective = state.waveState === 'intro' ? 'Zaujmi pozici' : 'Chvíle klidu';
    state.objectiveDist = `${Math.max(0, state.waveTimer).toFixed(0)} s`;
    if (state.waveTimer <= 0) startWave(state.wave + 1);
    return;
  }

  const def = state.waveDef;

  // rifts keep spitting out dragon spawn
  for (const rift of rifts) {
    rift.spawnTimer -= dt;
    if (rift.spawnTimer > 0) continue;
    rift.spawnTimer = def.interval * (0.8 + Math.random() * 0.5);
    if (enemies.aliveCount >= def.cap) continue;
    const typeId = def.types[Math.floor(Math.random() * def.types.length)];
    const p = world.randomOpenPoint(rift.pos.x, rift.pos.z, 9, rng)
      || new THREE.Vector3(rift.pos.x + 4, 0, rift.pos.z);
    const e = enemies.spawn(typeId, p, {
      hpScale: 1 + Math.max(0, state.wave - WAVES.length) * 0.3,
      dmgScale: 1 + Math.max(0, state.wave - WAVES.length) * 0.2,
    });
    vfx.burst(_tmp1.copy(p).setY(p.y + 0.6), 0xff5a2a, 12, 6, { size: 0.35, life: 0.5, up: 2 });
  }

  const bossAlive = boss && boss.hp > 0;
  if (!rifts.length && enemies.aliveCount === 0 && !bossAlive) waveCleared();

  // objective text
  if (bossAlive) {
    const d = Math.round(Math.hypot(boss.pos.x - player.pos.x, boss.pos.z - player.pos.z));
    state.objective = 'Ulov Draka brněnského';
    state.objectiveDist = `${d} m · ${Math.ceil((boss.hp / boss.maxHp) * 100)} %`;
    hud.setBoss(ENEMY_TYPES.boss.name, boss.hp / boss.maxHp, boss.phase2 ? 'FÁZE II — ZUŘIVOST' : 'FÁZE I');
  } else if (rifts.length) {
    const total = def.places.length;
    let nearest = null;
    let nd = Infinity;
    for (const r of rifts) {
      const d = Math.hypot(r.pos.x - player.pos.x, r.pos.z - player.pos.z);
      if (d < nd) { nd = d; nearest = r; }
    }
    state.objective = `Uzavři trhliny (${total - rifts.length}/${total})`;
    state.objectiveDist = `${Math.round(nd)} m · ${Math.ceil((nearest.hp / nearest.maxHp) * 100)} %`;
    if (boss) hud.hideBoss();
  } else {
    state.objective = 'Dobij zbytek dračího potomstva';
    state.objectiveDist = `${enemies.aliveCount} zbývá`;
  }
}

/* ==================================================================
   Boot
   ================================================================== */
const loadEl = document.getElementById('loading');
const loadFill = document.getElementById('load-fill');
const loadStep = document.getElementById('load-step');

// A timer-based yield (not rAF) so loading also completes in a background tab.
const yieldFrame = () => new Promise((r) => setTimeout(r, 16));
async function step(pct, label) {
  loadFill.style.width = `${pct}%`;
  loadStep.textContent = label;
  await yieldFrame();
  await yieldFrame();
}

async function boot() {
  await step(8, 'kolize a fyzika');
  vfx = new VFX(scene);

  await step(20, 'ulice, tramvaje, fasády');
  world = buildCity(scene, collision);

  await step(62, 'Petrov, Špilberk, radnice');
  player = new Player(scene, collision, { x: 16, z: -4 });
  chase = new ChaseCamera(camera, collision);
  enemies = new EnemyManager(scene, collision, vfx);

  await step(78, 'dračí potomstvo');
  hud = new Hud(world.minimap);
  wireGameplay();

  await step(92, 'osvětlení a stíny');
  // prime the shadow camera and compile shaders
  sun.target.position.copy(player.pos);
  renderer.compile(scene, camera);

  await step(100, 'hotovo');
  loadEl.classList.add('done');
  setTimeout(() => loadEl.remove(), 600);
  state.mode = 'menu';
  lastTime = performance.now();
  renderer.setAnimationLoop(tick);
}

/* ==================================================================
   Gameplay wiring
   ================================================================== */
function wireGameplay() {
  enemies.onDeath = (e) => {
    state.kills++;
    state.score += e.type.score;
    audio.kill();
    if (e.typeId === 'boss') {
      boss = null;
      hud.hideBoss();
      hud.toast('DRAK PADL — VLNY POKRAČUJÍ', 'big');
      queueToast('Brno vydrželo. Jak dlouho vydržíš ty?', 'sub', 1.2);
      return;
    }
    const roll = Math.random();
    if (roll < 0.20) spawnPickup('health', e.pos.x, e.pos.y, e.pos.z);
    else if (roll < 0.42) spawnPickup('ammo', e.pos.x, e.pos.y, e.pos.z);
  };

  enemies.onPlayerHit = (e, dmg, dir, continuous = false, effectDt = 0) => {
    if (player.damage(dmg, dir, continuous)) {
      if (!continuous) audio.hurt();
      chase.addShake(continuous ? 0.9 * effectDt : 0.55);
      if (!player.alive) onDeath();
    }
  };

  enemies.onShoot = (e, origin, dir, opts) => {
    vfx.spawnProjectile(origin, dir, { ...opts, owner: 'enemy' });
    audio.shoot(0.35);
  };

  enemies.onBossRoar = () => {
    audio.roar(true);
    audio.flame();
    chase.addShake(0.7);
    hud.toast('DRAK CHRLÍ OHEŇ — UHNI!', 'warn');
  };

  enemies.onBossPhase = () => {
    hud.toast('DRAK ZUŘÍ', 'big');
    audio.roar(true);
    chase.addShake(1.2);
  };
}

function onProjectileHit(p, hit) {
  if (hit.type === 'enemy') {
    const killed = enemies.damage(hit.enemy, p.damage, p.dir);
    vfx.impactSpark(hit.point, 0xbfffd0, false);
    if (p.owner === 'player') {
      hud.hit();
      audio.hit(0.5);
    }
    if (p.splash > 0) splash(hit.point, p.splash, p.damage * 0.5, p.owner);
    void killed;
  } else if (hit.type === 'player') {
    if (player.damage(p.damage, p.dir)) {
      audio.hurt();
      chase.addShake(0.6);
      if (!player.alive) onDeath();
    }
    vfx.impactSpark(hit.point, 0xff8a4a, true);
    if (p.splash > 0) splash(hit.point, p.splash, p.damage * 0.4, p.owner);
  } else {
    // world hit — check if we clipped a rift
    if (p.owner === 'player') {
      const rift = riftNear(hit.point, 3.4);
      if (rift) {
        damageRift(rift, p.damage);
        hud.hit();
        audio.hit(0.35);
        return;
      }
    }
    vfx.impactSpark(hit.point, p.owner === 'player' ? 0xa8e8ff : 0xffa04a, p.splash > 0);
    if (p.splash > 0) {
      splash(hit.point, p.splash, p.damage * 0.6, p.owner);
    }
  }
}

function splash(point, radius, damage, owner) {
  vfx.explosion(point, radius * 1.4, 0xff8a3a);
  audio.explosion(0.55);
  if (owner === 'enemy') {
    const d = player.centre.distanceTo(point);
    if (d < radius) {
      const dir = _tmp1.copy(player.centre).sub(point).setY(0).normalize();
      if (player.damage(damage * (1 - d / radius), dir)) {
        audio.hurt();
        chase.addShake(0.5);
        if (!player.alive) onDeath();
      }
    }
  } else {
    for (const e of enemies.list) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.pos.x - point.x, e.pos.z - point.z);
      if (d < radius) enemies.damage(e, damage * (1 - d / radius), null);
    }
  }
  if (player.centre.distanceTo(point) < 26) chase.addShake(0.35);
}

/* ==================================================================
   State transitions
   ================================================================== */
const menuEl = document.getElementById('menu');
const pauseEl = document.getElementById('pause');
const goEl = document.getElementById('gameover');

function startGame() {
  audio.init();
  audio.resume();
  // reset
  enemies.clear();
  for (const r of [...rifts]) {
    r.visual.dispose();
    r.collider.top = r.collider.bottom;
  }
  rifts.length = 0;
  for (const p of pickups) scene.remove(p.visual.group);
  pickups.length = 0;
  boss = null;
  pendingToasts.length = 0;
  hud.hideBoss();

  player.pos.set(16, 0, -4);
  player.vel.set(0, 0, 0);
  player.health = player.maxHealth;
  player.stamina = player.maxStamina;
  player.ammo = WEAPON.mag;
  player.reloading = 0;
  player.alive = true;
  player.object.rotation.set(0, Math.PI, 0);
  player.object.scale.setScalar(1);
  chase.yaw = Math.PI;
  chase.pitch = -0.1;
  chase._first = true;

  state.score = 0;
  state.kills = 0;
  state.wave = 0;
  state.time = 0;
  state.waveState = 'intro';
  state.waveTimer = 2.6;
  state.objective = 'Zaujmi pozici';
  state.objectiveDist = '—';
  state.mode = 'playing';

  menuEl.classList.add('hidden');
  goEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  hud.show();
  input.requestLock();

  hud.toast('BRNO POD ÚTOKEM', 'big');
  hud.toast('Trhliny se otevírají — braň město', 'sub');
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  input.releaseLock();
  document.getElementById('pause-stats').innerHTML = statsHtml();
  pauseEl.classList.remove('hidden');
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  pauseEl.classList.add('hidden');
  input.requestLock();
  audio.resume();
}

function statsHtml() {
  const mins = Math.floor(state.time / 60);
  const secs = Math.floor(state.time % 60).toString().padStart(2, '0');
  return `
    SKÓRE <b>${state.score.toLocaleString('cs-CZ')}</b><br>
    VLNA <b>${state.wave}</b><br>
    ULOVENO <b>${state.kills}</b><br>
    ČAS <b>${mins}:${secs}</b>`;
}

function onDeath() {
  if (state.mode !== 'playing') return;
  state.mode = 'dead';
  input.releaseLock();
  audio.setMusicIntensity(0);
  chase.addShake(1.2);
  document.getElementById('go-title').textContent = 'PADL JSI';
  document.getElementById('go-stats').innerHTML = statsHtml();
  setTimeout(() => goEl.classList.remove('hidden'), 1200);
}

document.getElementById('btn-play').addEventListener('click', startGame);
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-restart').addEventListener('click', startGame);
document.getElementById('btn-again').addEventListener('click', startGame);

input.onUnlock = () => {
  if (state.mode === 'playing') pauseGame();
};

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (state.mode === 'playing') pauseGame();
    else if (state.mode === 'paused') resumeGame();
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

canvas.addEventListener('click', () => {
  if (state.mode === 'playing' && !input.locked) input.requestLock();
});

/* ==================================================================
   Main loop
   ================================================================== */
const _tmp1 = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tmp3 = new THREE.Vector3();
let smoothFps = 60;

function tick() {
  const now = performance.now();
  const raw = Math.max(0.0005, (now - lastTime) / 1000);
  lastTime = now;
  advance(Math.min(0.05, raw));
  smoothFps += (1 / raw - smoothFps) * 0.05;
}

function advance(dt) {
  if (state.mode === 'playing') {
    state.time += dt;
    stepGame(dt);
  } else if (state.mode === 'menu') {
    // slow orbit over the city for the menu backdrop
    const t = performance.now() * 0.00006;
    camera.position.set(Math.cos(t) * 190 - 30, 96, Math.sin(t) * 190 + 40);
    camera.lookAt(-30, 24, 20);
    if (world) world.update(dt, state.time);
  } else if (state.mode === 'dead') {
    // keep the world alive behind the overlay
    stepGame(dt, true);
  }

  renderer.render(scene, camera);
  input.endFrame();
}

function stepGame(dt, frozen = false) {
  const cmd = input.sample();

  // look
  if (input.locked && !frozen) {
    chase.look(input.mouse.dx, input.mouse.dy * (input.invertY ? -1 : 1), input.sensitivity);
    if (input.mouse.wheel) chase.zoom(input.mouse.wheel);
  }

  const aiming = cmd.aim || cmd.fire;

  /* ---- where is the crosshair really pointing? ----
   * The camera sits over the shoulder, so a shot fired from the muzzle towards
   * the raw camera ray sails under small enemies. We resolve the crosshair to a
   * soft target first (classic third-person aim assist) and only fall back to
   * the geometry hit point the camera ray found last frame. */
  const camFwd = chase.forward(_tmp2);
  const softTarget = enemies.aimTarget(camera.position, camFwd, 220, 1.35);
  state.aimingAtEnemy = !!softTarget;
  const aimPoint = _tmp3.copy(chase.aimPoint);
  if (softTarget) {
    aimPoint.set(
      softTarget.pos.x,
      softTarget.pos.y + softTarget.type.height * 0.55,
      softTarget.pos.z,
    );
  }

  if (!frozen) {
    cmd.aimPoint = aimPoint;
    player.update(dt, cmd, chase.yaw, chase.pitch, {
      onShoot: (origin, dir) => {
        vfx.spawnProjectile(origin, dir, {
          speed: WEAPON.speed, damage: WEAPON.damage, owner: 'player',
          color: 0x8ff0ff, radius: 0.4, trail: 4.5,
        });
        audio.shoot(0.55);
        chase.addShake(0.13);
      },
      onDryFire: () => audio.dryFire(),
      onMelee: () => {
        const dir = chase.forward(_tmp2).setY(0).normalize();
        const hits = enemies.meleeSweep(player.centre, dir, 3.6, 0.45, 70);
        audio.hit(hits ? 0.8 : 0.25);
        if (hits) {
          hud.hit();
          chase.addShake(0.3);
        }
        // knock nearby rifts too
        const rift = riftNear(_tmp1.copy(player.pos).addScaledVector(dir, 2.4), 3.2);
        if (rift) damageRift(rift, 60);
      },
      onJump: () => audio.jump(),
      onDash: () => { audio.dash(); chase.addShake(0.18); },
      onStep: (i) => audio.step(i),
      onLand: (v) => { audio.step(1); chase.addShake(Math.min(0.5, v * 0.02)); },
    });
    if (player.reloading > 0 && !player._reloadSfx) {
      player._reloadSfx = true;
      audio.reload();
    } else if (player.reloading <= 0) {
      player._reloadSfx = false;
    }
  }

  chase.update(dt, player, aiming);

  // sun & sky follow the player so shadows stay crisp where it matters
  const px = Math.round(player.pos.x / 4) * 4;
  const pz = Math.round(player.pos.z / 4) * 4;
  sun.target.position.set(px, 0, pz);
  sun.position.set(px + SUN_DIR.x * 150, SUN_DIR.y * 150 + 20, pz + SUN_DIR.z * 150);
  sky.position.set(camera.position.x, 0, camera.position.z);

  if (!frozen) {
    updateToasts(dt);
    enemies.update(dt, {
      player,
      camera,
      findOpenPointNear: (x, z, r) => world.randomOpenPoint(x, z, r, rng),
    });
    updateWaves(dt);
  }

  for (const r of rifts) r.visual.update(dt);
  world.update(dt, state.time);
  if (world.landmarks.update) world.landmarks.update(dt, state.time);

  // pickups
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    p.life -= dt;
    p.visual.box.rotation.y += dt * 1.6;
    p.visual.box.rotation.x = Math.sin(p.t * 1.7) * 0.2;
    p.visual.group.position.y = (p.visual.group.userData.baseY ??= p.pos.y) + Math.sin(p.t * 2.2) * 0.16;
    const d = Math.hypot(p.pos.x - player.pos.x, p.pos.z - player.pos.z);
    if (!frozen && player.alive && (d < 1.9 || (cmd.use && d < 5))) collectPickup(p, i);
    else if (p.life <= 0) {
      scene.remove(p.visual.group);
      pickups.splice(i, 1);
    }
  }

  vfx.update(dt, {
    collision, enemies, player,
    onProjectileHit,
  });

  // hud
  hud.update({
    health: player.health, maxHealth: player.maxHealth,
    stamina: player.stamina, maxStamina: player.maxStamina,
    score: state.score, wave: Math.max(1, state.wave), enemies: enemies.aliveCount,
    ammo: player.ammo, ammoMax: WEAPON.mag, reloading: player.reloading > 0,
    objective: state.objective, objectiveDist: state.objectiveDist,
    aimingAtEnemy: state.aimingAtEnemy,
    sprinting: cmd.sprint && Math.hypot(player.vel.x, player.vel.z) > 7,
    hurt: player.hurtFlash,
    camYaw: chase.yaw,
  });
  hud.drawMinimap(player, chase.yaw, enemies.list, [], rifts);
}

boot();

/* ------------------------------------------------------------------ *
 * Debug handle. `advance` lets an automated harness step the whole
 * simulation deterministically (rAF is paused in background tabs).
 * ------------------------------------------------------------------ */
window.__brno = {
  THREE,
  state,
  scene,
  renderer,
  camera,
  advance,
  get player() { return player; },
  get world() { return world; },
  get enemies() { return enemies; },
  get rifts() { return rifts; },
  get chase() { return chase; },
  get hud() { return hud; },
  input,
  audio,
  startGame,
  startWave,
  spawnEnemy: (type, x, z) => enemies.spawn(type, new THREE.Vector3(x, 0, z)),
  stats: () => ({
    mode: state.mode,
    fps: Math.round(smoothFps),
    calls: renderer.info.render.calls,
    tris: renderer.info.render.triangles,
    programs: renderer.info.programs.length,
    solids: collision.boxes.length,
    enemies: enemies ? enemies.aliveCount : 0,
    rifts: rifts.length,
    hp: player ? Math.round(player.health) : 0,
    pos: player ? [player.pos.x.toFixed(1), player.pos.y.toFixed(1), player.pos.z.toFixed(1)] : null,
  }),
  /** Render one frame and return a PNG data URL (for visual checks). */
  shot(w = 1280, h = 720) {
    const oldSize = renderer.getSize(new THREE.Vector2());
    const oldAspect = camera.aspect;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    renderer.setSize(oldSize.x, oldSize.y, false);
    camera.aspect = oldAspect;
    camera.updateProjectionMatrix();
    return url;
  },
};
