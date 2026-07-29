import * as THREE from 'three';
/* NOTE: render/sky.js must be imported before anything that builds
 * materials (city.js -> materials.js -> textures/*). Evaluating it
 * patches three's fog shader chunks and adds the aerial-perspective
 * uniforms to UniformsLib.fog, and three bakes that uniform set into
 * every material at construction time. Keep this import first. */
import { createSky, SUN_DIR } from './render/sky.js';
import { buildEnvironment, applyEnvironment } from './render/env.js';
import { createLighting } from './render/lighting.js';
import { createPostFX, DEFAULT_QUALITY, QUALITY_LEVELS } from './render/postfx.js';
import { CollisionWorld } from './physics.js';
import { PhysicsWorld, playerRagdollBones } from './rigidbody.js';
import { getMaterial } from './materials.js';
import { buildCity, PLACES } from './city.js';
import { Player, WEAPON } from './player.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { VFX } from './vfx.js';
import { EnemyManager, ENEMY_TYPES } from './enemies.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';
import { Rng } from './rng.js';
import { bindSettings } from './settings.js';

/* ==================================================================
   DRAK BRNĚNSKÝ — third-person action, central Brno
   ================================================================== */

let lastTime = performance.now();
const GAMEPLAY_SEED = 90210;
let gameplayRng = new Rng(GAMEPLAY_SEED);

const state = {
  mode: 'loading', // loading | menu | playing | paused | dead | error
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
  /** RMB / firing — drives the depth-of-field ramp in advance(). */
  aiming: false,
  /** World position of the current objective, for the HUD's world marker. */
  objectivePos: null,
  /** Direction the last damage came FROM, for the HUD's damage arcs. */
  hurtDir: null,
};

/**
 * Remember where damage came from. `dir` as passed around this file is the
 * direction the hit was travelling, so the incoming bearing is its opposite.
 * Every damage path funnels through here so the HUD never has to guess.
 */
function noteHurt(dir) {
  if (!dir) { state.hurtDir = null; return; }
  const len = Math.hypot(dir.x, dir.z);
  state.hurtDir = len > 0.001 ? { x: -dir.x / len, z: -dir.z / len } : null;
}

/* ---------------- renderer & scene ---------------- */
const canvas = document.getElementById('game');
let renderer = null;
/** Post-processing stack. Created in boot(), once the renderer exists. */
let render = null;
let env = null;
/** Set by verifyPostStack(); false routes rendering around the composer. */
let postStackOk = true;
/** Evidence behind that verdict, for the console and the QA harness. */
let postStackProbe = null;
/** Whether the last shot() went through the post stack, and whether it fell back. */
let lastShotUsedPostStack = false;
let lastShotFellBack = false;

const scene = new THREE.Scene();
/* Height-attenuated, sun-aware aerial perspective. The density and colour
 * live on the fog object (the renderer uploads them every frame); the
 * height falloff and sun tint come from AERIAL in render/sky.js. */
scene.fog = new THREE.FogExp2(0x2e3242, 0.0034);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.12, 2400);
camera.position.set(0, 12, 40);

/* ---------------- dusk sky, lighting, IBL ----------------
 * All of this now lives in src/render/. The sky dome renders into the
 * composer's HDR buffer (so the sun disc is a real HDR value the tone
 * mapper shapes, instead of a clipped white blob), it is captured into a
 * PMREM environment map at boot for image-based lighting, and the sun is
 * a 3-cascade shadow rig instead of one swimming 78 m box. */
const sky = createSky(scene);
/** Cascaded sun + dusk fill/bounce + the street-lamp light pool. */
let lighting = null;

/* ---------------- systems ---------------- */
const collision = new CollisionWorld();
/** Dynamic layer: debris, ragdolls, breakable props, ballistics. */
const physics = new PhysicsWorld(collision);
const input = new Input(canvas);
const audio = new Audio();
let world = null;
let vfx = null;
let player = null;
let chase = null;
let enemies = null;
let hud = null;

/* ---------------- debris rendering ----------------
 * `PhysicsWorld` deliberately owns no scene graph — it simulates and lets the
 * caller decide how bodies are drawn. Without this, every chunk of a smashed
 * market stall would be simulated perfectly and be completely invisible.
 *
 * One InstancedMesh per surface family, so the whole debris field is a handful
 * of draw calls no matter how much is in flight. Bodies are pooled and reused
 * upstream, so we key the instance slot off `body.serial` (which changes on
 * respawn) rather than off the body object itself. */
const DEBRIS_CAP = 220;
const debrisLayers = new Map();
const _debrisMat = new THREE.Matrix4();
const _debrisScale = new THREE.Vector3();

function debrisLayer(surface) {
  let layer = debrisLayers.get(surface);
  if (layer) return layer;
  const material = getMaterial(surface === 'wood' ? 'wood'
    : surface === 'metal' ? 'paintedMetal'
      : surface === 'glass' ? 'paneGlass'
        : 'concrete');
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, DEBRIS_CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  scene.add(mesh);
  layer = { mesh, n: 0 };
  debrisLayers.set(surface, layer);
  return layer;
}

/** Push every live rigid body into its instanced layer. One pass, no allocation. */
function updateDebrisVisuals() {
  for (const layer of debrisLayers.values()) layer.n = 0;
  for (const body of physics.bodies) {
    if (!body || !body.active || body.fade <= 0) continue;
    /* Ragdoll bones are bodies in this same array, but the character and
     * creature rigs draw themselves from the bone transforms. Rendering them
     * here too would stack a floating crate on every corpse. */
    if (body.kind === 'ragdoll' || body._ragdoll) continue;
    const layer = debrisLayer(body.surface && body.surface.id ? body.surface.id : 'stone');
    if (layer.n >= DEBRIS_CAP) continue;
    // `half` is half-extents and the shared geometry is a unit cube.
    _debrisScale.set(body.half.x * 2, body.half.y * 2, body.half.z * 2);
    _debrisMat.compose(body.position, body.quaternion, _debrisScale);
    layer.mesh.setMatrixAt(layer.n++, _debrisMat);
  }
  for (const layer of debrisLayers.values()) {
    if (layer.mesh.count !== layer.n) layer.mesh.count = layer.n;
    layer.mesh.visible = layer.n > 0;
    if (layer.n > 0) layer.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ---------------- rifts & pickups ---------------- */
const rifts = [];
const pickups = [];

function spawnRift(x, z, hp, scale = 1) {
  const y = collision.groundHeight(x, z, 6, 2) || 0;
  const visual = vfx.makeRift(new THREE.Vector3(x, y + 0.05, z), scale);
  /* The rebuilt rift wound reads about 4.4 m wide by 5.2 m tall. The collider
   * was still the old 3.0 × 3.6 visual's size, so bolts aimed at the edges of
   * what the player can see would sail straight through. */
  const collider = collision.add(x, z, 4.0 * scale, 4.0 * scale, y, 4.6 * scale, 'nostand');
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
    collision.remove(rift.collider);
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
  pickups.push({ kind, visual: v, pos: v.group.position, t: gameplayRng.float(0, 6), life: 42 });
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
/** Live ragdoll handle for the player's corpse, or null. */
let playerRagdoll = null;

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
    const p = world.randomOpenPoint(place.x, place.z, 24, gameplayRng, 5)
      || world.randomOpenPoint(place.x, place.z, 34, gameplayRng, 3)
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
    const p = world.randomOpenPoint(player.pos.x, player.pos.z, 14, gameplayRng);
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
    rift.spawnTimer = def.interval * gameplayRng.float(0.8, 1.3);
    if (enemies.aliveCount >= def.cap) continue;
    const typeId = gameplayRng.pick(def.types);
    const p = world.randomOpenPoint(rift.pos.x, rift.pos.z, 9, gameplayRng)
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
    state.objectivePos = boss.pos;
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
    state.objectivePos = nearest.pos;
    if (boss) hud.hideBoss();
  } else {
    state.objective = 'Dobij zbytek dračího potomstva';
    state.objectiveDist = `${enemies.aliveCount} zbývá`;
    state.objectivePos = null;
  }
}

/* ==================================================================
   Boot
   ================================================================== */
const loadEl = document.getElementById('loading');
const loadFill = document.getElementById('load-fill');
const loadStep = document.getElementById('load-step');
const loadError = document.getElementById('load-error');

function createRenderer() {
  const instance = new THREE.WebGLRenderer({
    canvas,
    // MSAA is pointless now: the composer renders into its own HDR target,
    // so the canvas' own multisampling never sees any geometry. SMAA (plus
    // the still-frame accumulation) does the edge work instead.
    antialias: false,
    powerPreference: 'high-performance',
  });
  instance.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  instance.setSize(innerWidth, innerHeight);
  /* renderer.info resets at the start of every render() call, and the composer
   * issues one per pass — so with autoReset left on, stats() only ever reported
   * the final fullscreen quad (1 call, 2 triangles) instead of the scene. Reset
   * manually once per frame so the draw-call and triangle numbers the
   * performance work is tuned against are the real totals. */
  instance.info.autoReset = false;
  instance.shadowMap.enabled = true;
  instance.shadowMap.type = THREE.PCFSoftShadowMap;
  /* AgX rolls highlights off far more gracefully than ACES and holds the
   * hue of a sodium lamp instead of bleaching it, at the cost of looking
   * flatter — the grade pass puts the contrast and saturation back.
   * Applied by the composer's OutputPass; three automatically skips
   * in-material tone mapping when rendering to a render target, so there
   * is no double transform. */
  instance.toneMapping = THREE.AgXToneMapping !== undefined
    ? THREE.AgXToneMapping
    : THREE.ACESFilmicToneMapping;
  instance.toneMappingExposure = instance.toneMapping === THREE.AgXToneMapping ? 1.30 : 1.08;
  return instance;
}

/**
 * Boot-time smoke test for the post-processing chain.
 *
 * KNOWN ISSUE (see docs/known-issues.md): the composer currently resolves to a
 * black frame even though the scene itself renders correctly into both plain
 * and half-float render targets. Rather than ship a black screen, render one
 * frame through the stack, read it back, and fall back to rendering the scene
 * straight to the canvas if it comes out empty.
 *
 * This is deliberately loud, not silent — it warns, and records the verdict on
 * `window.__brno.postStackOk` — because a quietly-bypassed post stack is worse
 * than a visibly broken one: everything would look flat and nobody would know
 * eleven passes had stopped running.
 */
function verifyPostStack() {
  if (!render) return;
  const savedPos = camera.position.clone();
  const savedQuat = camera.quaternion.clone();
  try {
    /* Same camera for both renders, aimed down a street where there is
     * guaranteed to be lit geometry — comparing two different views would
     * prove nothing. */
    camera.position.set(4, 3, 190);
    camera.lookAt(2, 4, 120);
    camera.updateMatrixWorld();

    const S = 96;
    const half = Math.floor(S / 2);
    const lit = (buf) => {
      let n = 0;
      for (let i = 0; i < buf.length; i += 4) {
        if (Math.max(buf[i], buf[i + 1], buf[i + 2]) > 6) n++;
      }
      return n;
    };

    const target = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType });
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);
    const direct = new Uint8Array(S * S * 4);
    renderer.readRenderTargetPixels(target, 0, 0, S, S, direct);
    renderer.setRenderTarget(null);
    target.dispose();
    const directLit = lit(direct);

    render.render(1 / 60);
    const gl = renderer.getContext();
    const px = new Uint8Array(S * S * 4);
    gl.readPixels(
      Math.max(0, (gl.drawingBufferWidth >> 1) - half),
      Math.max(0, (gl.drawingBufferHeight >> 1) - half),
      S, S, gl.RGBA, gl.UNSIGNED_BYTE, px,
    );
    const composedLit = lit(px);

    /* Only a verdict if the direct render actually produced an image. If the
     * scene itself is empty here, this test knows nothing and must not claim
     * the stack is fine — nor blame it. */
    const conclusive = directLit > S * S * 0.15;
    postStackOk = !conclusive || composedLit > 0;
    postStackProbe = { directLit, composedLit, samples: S * S, conclusive };
    if (!postStackOk) {
      console.warn(
        `[render] The post-processing chain resolved to an empty frame (${composedLit}`
        + ` lit of ${S * S}) while a direct render of the same view produced`
        + ` ${directLit}. Falling back to direct rendering — no AO, bloom, god rays,`
        + ' grade, SMAA or sharpening. See docs/known-issues.md.',
      );
    } else if (!conclusive) {
      console.warn('[render] Post stack smoke test was inconclusive; leaving the stack on.');
    }
  } catch (error) {
    postStackOk = false;
    console.warn('[render] Post stack smoke test threw; falling back to direct rendering.', error);
  } finally {
    camera.position.copy(savedPos);
    camera.quaternion.copy(savedQuat);
    camera.updateMatrixWorld();
  }
}

/**
 * Grab the rendered frame as a PNG data URL.
 *
 * Deliberately NOT `renderer.domElement.toDataURL()`. The context is created
 * without `preserveDrawingBuffer`, so the drawing buffer is invalid by the time
 * the canvas compositing path that `toDataURL` uses gets to it — it returns a
 * fully black image while `gl.readPixels` on the very same framebuffer returns
 * the real frame. That mismatch silently produced black screenshots and made
 * every visual review impossible. `readPixels` is the reliable path; the only
 * cost is flipping the rows, because GL's origin is bottom-left.
 */
/** Is the frame currently on the canvas essentially empty? Cheap centre sample. */
function frameIsBlank() {
  const gl = renderer.getContext();
  const S = 48;
  const x = Math.max(0, (gl.drawingBufferWidth >> 1) - (S >> 1));
  const y = Math.max(0, (gl.drawingBufferHeight >> 1) - (S >> 1));
  const px = new Uint8Array(S * S * 4);
  gl.readPixels(x, y, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 0; i < px.length; i += 4) {
    if (Math.max(px[i], px[i + 1], px[i + 2]) > 6) return false;
  }
  return true;
}

function readCanvasPng() {
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const pixels = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  const image = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * row;
    image.data.set(pixels.subarray(src, src + row), y * row);
  }
  ctx.putImageData(image, 0, 0);
  return out.toDataURL('image/png');
}

function showBootError(error) {
  console.error('Game initialization failed', error);
  state.mode = 'error';
  loadEl.classList.add('error');
  loadEl.classList.remove('done');
  loadError.classList.remove('hidden');
  document.getElementById('btn-reload').onclick = () => location.reload();
}

addEventListener('unhandledrejection', (event) => {
  if (state.mode !== 'loading') return;
  event.preventDefault();
  showBootError(event.reason);
});

// A timer-based yield (not rAF) so loading also completes in a background tab.
const yieldFrame = () => new Promise((r) => setTimeout(r, 16));
async function step(pct, label) {
  loadFill.style.width = `${pct}%`;
  loadStep.textContent = label;
  await yieldFrame();
  await yieldFrame();
}

async function boot() {
  try {
    bindSettings(document, input, audio);
    renderer = createRenderer();
    await step(8, 'kolize a fyzika');
    vfx = new VFX(scene);

    await step(20, 'ulice, tramvaje, fasády');
    world = buildCity(scene, collision);

    await step(62, 'Petrov, Špilberk, radnice');
    /* The character rig looks materials up through a `.get(name)` shim rather
     * than importing the registry, so it stays testable in isolation. */
    player = new Player(scene, collision, {
      x: 16,
      z: -4,
      rng: gameplayRng,
      materials: { get: (name) => getMaterial(name) },
    });
    chase = new ChaseCamera(camera, collision);
    enemies = new EnemyManager(scene, collision, vfx, gameplayRng);

    await step(78, 'dračí potomstvo');
    hud = new Hud(world.minimap);
    wireGameplay();

    await step(88, 'osvětlení a stíny');
    /* Image-based lighting first: putting a texture on scene.environment
     * flips USE_ENVMAP on every standard material, so it has to happen
     * before the compile below or the first gameplay frame stalls on a
     * full shader rebuild. */
    env = buildEnvironment(renderer, sky, { resolution: 256, intensity: 0.9 });
    applyEnvironment(scene, env);

    lighting = createLighting(scene, camera, {
      shadowMapSize: 2048,
      sunIntensity: 2.9,
    });
    lighting.registerMaterials();
    lighting.updateFrustums();
    lighting.update(0, player.pos);

    await step(95, 'post-processing');
    render = createPostFX({ renderer, scene, camera, lighting, quality: DEFAULT_QUALITY });

    /* Soft particles. The linear-depth resolve skips itself when no pass
     * wants it (DOF is aim-only, and both readers are off on `low`), so an
     * external consumer has to say so explicitly or it would sample a stale
     * target. `isLive` is belt-and-braces: if the flag is ever cleared, vfx
     * falls back to its ground-contact fade instead of fading against depth
     * that no longer describes this frame. */
    render.requireDepth(true);
    vfx.setLinearDepthTexture(render.linearDepthTexture, {
      encoding: 'linear-metres',
      isLive: () => render.passes.depth.enabled,
    });

    /* Lit smoke, dust and decals shade themselves analytically rather than
     * through the scene's lights, so they need to be told what the sun is
     * doing or a plume will be lit for a different time of day than the city
     * it is standing in. */
    if (vfx.setLighting && lighting) {
      const sunLight = lighting.sun || (lighting.csm && lighting.csm.lights[0]);
      vfx.setLighting({
        sunDir: SUN_DIR,
        sunColor: sunLight ? sunLight.color : 0xffb570,
        sunIntensity: sunLight ? sunLight.intensity : 2.9,
        ambient: lighting.hemi ? lighting.hemi.color : 0x9fb4d8,
        ambientIntensity: lighting.hemi ? lighting.hemi.intensity : 0.55,
      });
    }

    resizeRenderer();
    renderer.compile(scene, camera);
    verifyPostStack();

    await step(100, 'hotovo');
    loadEl.classList.add('done');
    setTimeout(() => loadEl.remove(), 600);
    state.mode = 'menu';
    lastTime = performance.now();
    renderer.setAnimationLoop(tick);
  } catch (error) {
    showBootError(error);
  }
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
    const roll = gameplayRng.next();
    if (roll < 0.20) spawnPickup('health', e.pos.x, e.pos.y, e.pos.z);
    else if (roll < 0.42) spawnPickup('ammo', e.pos.x, e.pos.y, e.pos.z);
  };

  enemies.onPlayerHit = (e, dmg, dir, continuous = false, effectDt = 0) => {
    if (player.damage(dmg, dir, continuous)) {
      if (!continuous) audio.hurt();
      noteHurt(dir);
      chase.addShake(continuous ? 0.9 * effectDt : 0.55);
      if (!player.alive) onDeath();
    }
  };

  enemies.onShoot = (e, origin, dir, opts) => {
    vfx.spawnProjectile(origin, dir, { ...opts, owner: 'enemy' });
    audio.shoot(0.35, { pos: origin });
  };

  /* Creature voices. Only the boss ever spoke before, which made a pack of
   * whelps closing in completely silent. */
  enemies.onAggro = (e) => {
    if (!e || e.typeId === 'boss') return;
    audio.roar(false, e.typeId, { pos: e.pos });
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
    // `killed` used to be discarded here; the HUD has a distinct kill marker.
    if (p.owner === 'player' && killed) hud.hit(true);
  } else if (hit.type === 'player') {
    if (player.damage(p.damage, p.dir)) {
      audio.hurt();
      noteHurt(p.dir);
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
    // A world hit shoves loose debris and chips away at breakable props.
    physics.reportImpact(hit.point, p.damage * 2, p.dir);
    if (p.splash > 0) {
      splash(hit.point, p.splash, p.damage * 0.6, p.owner);
    }
  }
}

function splash(point, radius, damage, owner) {
  vfx.explosion(point, radius * 1.4, 0xff8a3a);
  audio.explosion(0.55, { pos: point });
  // Throws loose debris and breaks props, with distance falloff and LOS.
  physics.applyExplosion(point, radius, radius * 40);
  if (owner === 'enemy') {
    const d = player.centre.distanceTo(point);
    if (d < radius) {
      const dir = _tmp1.copy(player.centre).sub(point).setY(0).normalize();
      if (player.damage(damage * (1 - d / radius), dir)) {
        audio.hurt();
        noteHurt(dir);
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
const resumeHintEl = document.getElementById('resume-hint');

function startGame() {
  gameplayRng.reset(GAMEPLAY_SEED);
  audio.init();
  audio.resume();
  // reset
  enemies.clear();
  for (const r of [...rifts]) {
    r.visual.dispose();
    collision.remove(r.collider);
  }
  rifts.length = 0;
  for (const p of pickups) scene.remove(p.visual.group);
  pickups.length = 0;
  boss = null;
  pendingToasts.length = 0;
  hud.hideBoss();
  /* Decals, scorch marks and burning patches persist for a minute or two by
   * design; without this they survive into the next run. Debris and ragdolls
   * go the same way. */
  if (vfx.clearWorldFx) vfx.clearWorldFx();
  physics.clear();
  playerRagdoll = null;
  player.ragdollControlled = false;
  state.hurtDir = null;
  state.objectivePos = null;

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
  resumeHintEl.textContent = '';
  document.getElementById('pause-stats').innerHTML = statsHtml();
  pauseEl.classList.remove('hidden');
}

async function resumeGame() {
  if (state.mode !== 'paused') return;
  const locked = await input.requestLock();
  if (!locked || state.mode !== 'paused') {
    resumeHintEl.textContent = 'Klikni na POKRAČOVAT pro opětovné uzamčení myši.';
    return;
  }
  state.mode = 'playing';
  pauseEl.classList.add('hidden');
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
  /* Hand the rig over to the ragdoll solver. It blends out of the pose that
   * was on screen rather than snapping, and the animator stops writing bone
   * transforms while keeping the coat and scarf simulating over the corpse. */
  if (player.rig && physics.spawnRagdoll) {
    const bones = playerRagdollBones(player.rig.byName);
    if (bones && bones.length) {
      const away = state.hurtDir
        ? new THREE.Vector3(-state.hurtDir.x, 0.35, -state.hurtDir.z).normalize()
        : new THREE.Vector3(0, 0.4, 1).normalize();
      playerRagdoll = physics.spawnRagdoll(bones, {
        impulse: away.multiplyScalar(90),
        hitBone: 'chest',
        velocity: player.vel,
      });
      if (playerRagdoll) player.ragdollControlled = true;
    }
  }
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

function resizeRenderer() {
  if (!renderer) return;
  const cap = render ? render.pixelRatioCap : 1.75;
  renderer.setPixelRatio(Math.min(devicePixelRatio, cap));
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  // the composer owns its own HDR targets and every pass has its own
  // internal buffers, so all of them have to be resized too
  if (render) render.setSize(innerWidth, innerHeight);
  // cascade extents are fitted to the camera frustum, which just changed
  if (lighting) lighting.updateFrustums();
}

function watchPixelRatio() {
  const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
  const onChange = () => {
    if (query.removeEventListener) query.removeEventListener('change', onChange);
    else query.removeListener(onChange);
    resizeRenderer();
    watchPixelRatio();
  };
  if (query.addEventListener) query.addEventListener('change', onChange, { once: true });
  else query.addListener(onChange);
}

addEventListener('resize', resizeRenderer);
watchPixelRatio();

canvas.addEventListener('click', () => {
  if (state.mode === 'playing' && !input.locked) input.requestLock();
});

/* ==================================================================
   Main loop
   ================================================================== */
const _tmp1 = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _tmp3 = new THREE.Vector3();
/** What the menu backdrop camera orbits around, and what it focuses on. */
const MENU_LOOK = new THREE.Vector3(-30, 24, 20);
let smoothFps = 60;

function tick() {
  const now = performance.now();
  const raw = Math.max(0.0005, (now - lastTime) / 1000);
  lastTime = now;
  advance(Math.min(0.05, raw));
  smoothFps += (1 / raw - smoothFps) * 0.05;
}

function advance(dt) {
  if (!renderer) return;
  renderer.info.reset();
  if (state.mode === 'playing') {
    state.time += dt;
    stepGame(dt);
  } else if (state.mode === 'menu') {
    // slow orbit over the city for the menu backdrop
    const t = performance.now() * 0.00006;
    camera.position.set(Math.cos(t) * 190 - 30, 96, Math.sin(t) * 190 + 40);
    camera.lookAt(MENU_LOOK);
    if (world) world.update(dt, state.time);
    sky.update(dt, camera);
    if (lighting) lighting.update(dt, camera.position);
  } else if (state.mode === 'dead') {
    // keep the world alive behind the overlay
    stepGame(dt, true);
  }

  /* Depth of field: on while aiming down the sights, and on the menu /
   * pause / death screens so the overlay text has something soft behind
   * it. Focus tracks whatever the crosshair resolved to, so the target
   * stays sharp and the street behind it goes. */
  if (render && postStackOk) {
    if (state.mode === 'playing' && state.aiming) {
      render.setDepthOfField(0.85, camera.position.distanceTo(chase.aimPoint));
    } else if (state.mode === 'menu') {
      render.setDepthOfField(0.6, camera.position.distanceTo(MENU_LOOK));
    } else if (state.mode === 'paused' || state.mode === 'dead') {
      render.setDepthOfField(0.75, 6.5);
    } else {
      render.setDepthOfField(0);
    }
    render.render(dt);
  } else {
    renderer.render(scene, camera);
  }
  input.endFrame();
}

/** No-op hook set for ticking the player rig while dead. */
const FROZEN_HOOKS = Object.freeze({});

/**
 * Drive the character's bones from the ragdoll solver while a corpse is live.
 * The solver blends out of the animated pose over its blend window, so this
 * takes over without a snap. Hands control back when the handle dies.
 */
function applyPlayerRagdoll() {
  if (!playerRagdoll) return;
  if (!playerRagdoll.alive) {
    playerRagdoll = null;
    player.ragdollControlled = false;
    return;
  }
  const byName = player.rig && player.rig.byName;
  if (!byName) return;
  for (const bone of playerRagdoll.bones) {
    const target = byName[bone.name];
    if (!target) continue;
    target.position.copy(bone.out.position);
    target.quaternion.copy(bone.out.quaternion);
  }
}

/** What the player is standing on, for footstep and impact timbre. */
function groundSurfaceUnderPlayer() {
  const s = collision.surfaceAt(player.pos.x, player.pos.y + 0.1, player.pos.z);
  return s && s.id ? s.id : 'cobble';
}

/* Reverb zones. The centre squares are open and bright, the side streets are
 * narrow and flatter, and the two enclosed spaces get their own character.
 * Checked against squared distance so this can run every frame for free. */
const ZONES = [
  { zone: 'cathedral', x: PLACES.petrov.x, z: PLACES.petrov.z, r2: 34 * 34 },
  { zone: 'gatehouse', x: PLACES.spilberk.x, z: PLACES.spilberk.z, r2: 48 * 48 },
  { zone: 'square', x: PLACES.svoboda.x, z: PLACES.svoboda.z, r2: 52 * 52 },
  { zone: 'square', x: PLACES.zelnyTrh.x, z: PLACES.zelnyTrh.z, r2: 38 * 38 },
  { zone: 'square', x: PLACES.moravske.x, z: PLACES.moravske.z, r2: 50 * 50 },
  { zone: 'square', x: PLACES.nadrazi.x, z: PLACES.nadrazi.z, r2: 60 * 60 },
];
let currentZone = 'street';

function updateAudioSpace() {
  let zone = 'street';
  for (const z of ZONES) {
    const dx = player.pos.x - z.x;
    const dz = player.pos.z - z.z;
    if (dx * dx + dz * dz < z.r2) { zone = z.zone; break; }
  }
  if (zone !== currentZone) {
    currentZone = zone;
    audio.setZone(zone);
  }
  audio.updateListener(camera.position, chase.forward(_tmp2));
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

  cmd.aimPoint = aimPoint;
  if (frozen) {
    /* Dead, but the world is still running behind the game-over card. The
     * character rig needs ticking so the death collapse actually plays —
     * without this the last living pose freezes for 1.2 s. It fires no
     * callbacks in this state, so passing empty hooks is safe. */
    player.update(dt, cmd, chase.yaw, chase.pitch, FROZEN_HOOKS);
  }
  if (!frozen) {
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
      /* Footsteps and landings take their timbre from what the player is
       * actually standing on — cobble on the squares, asphalt on the through
       * roads, grass in the parks, stone on the Špilberk terraces. */
      onStep: (i) => audio.step(i, {
        surface: groundSurfaceUnderPlayer(),
        speed: Math.hypot(player.vel.x, player.vel.z),
      }),
      onLand: (v) => {
        audio.step(1, { surface: groundSurfaceUnderPlayer(), speed: v });
        chase.addShake(Math.min(0.5, v * 0.02));
      },
    });
    if (player.reloading > 0 && !player._reloadSfx) {
      player._reloadSfx = true;
      audio.reload();
    } else if (player.reloading <= 0) {
      player._reloadSfx = false;
    }
  }

  chase.update(dt, player, aiming);
  /* DOF follows RMB only, not `aiming` — `aiming` is aim-or-fire, and
   * racking the depth of field every time the player pulls the trigger
   * would be both distracting and a pass we pay for through most of a
   * firefight. */
  state.aiming = !!cmd.aim;

  /* Shadows and sky follow the view. The cascades fit themselves to the
   * camera frustum and texel-snap their own centres, so there is nothing
   * to round to a 4 m grid here any more — that rounding is exactly what
   * made the old single shadow box visibly jump as you walked. */
  sky.update(dt, camera);
  if (lighting) lighting.update(dt, player.pos);

  if (!frozen) {
    updateToasts(dt);
    enemies.update(dt, {
      player,
      camera,
      findOpenPointNear: (x, z, r) => world.randomOpenPoint(x, z, r, gameplayRng),
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

  if (!frozen) physics.step(dt);
  applyPlayerRagdoll();
  updateDebrisVisuals();
  updateAudioSpace();

  /* Direction to the current objective, for the HUD's world marker. Unit
   * vector in world space; the HUD turns it into a bearing against camYaw. */
  let objectiveDir = null;
  if (state.objectivePos) {
    const dx = state.objectivePos.x - player.pos.x;
    const dz = state.objectivePos.z - player.pos.z;
    const len = Math.hypot(dx, dz);
    if (len > 0.001) objectiveDir = { x: dx / len, z: dz / len };
  }

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
    /* Aims the directional damage arcs at whatever actually hit the player,
     * instead of the HUD guessing an angle. */
    hurtDir: state.hurtDir,
    objectiveDir,
    /* Real reload progress, so the ring tracks the timer instead of a
     * hardcoded 1.05 s guess. */
    reloadFrac: player.reloading > 0 && WEAPON.reloadTime
      ? 1 - Math.max(0, Math.min(1, player.reloading / WEAPON.reloadTime))
      : 0,
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
  collision,
  physics,
  get postStackOk() { return postStackOk; },
  get postStackProbe() { return postStackProbe; },
  get lastShot() { return { postStack: lastShotUsedPostStack, fellBack: lastShotFellBack }; },
  get playerRagdoll() { return playerRagdoll; },
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
    // composer cost: enabled pass count, AO scale, shadow cascades
    render: render ? render.stats() : null,
  }),

  /** The render pipeline, for the performance engineer and the settings UI. */
  get render() { return render; },
  get lighting() { return lighting; },
  /** `__brno.setQuality('medium')` — 'low' | 'medium' | 'high' | 'ultra'. */
  setQuality: (level) => {
    if (!render) return null;
    const applied = render.setQuality(level);
    resizeRenderer();
    return applied;
  },
  qualityLevels: QUALITY_LEVELS,

  /**
   * Render one frame at (w, h) through the full composer stack and return
   * a PNG data URL. This is what scripts/qa-shots.js drives for every
   * review screenshot, so the contract is unchanged: resize, render,
   * read, restore — no simulation is stepped and nothing is left mutated.
   *
   * The frame is accumulated over 8 Halton-jittered sub-samples (fixed
   * offsets, static camera, dt = 0), which is deterministic and gives the
   * captures proper supersampling on top of SMAA.
   */
  shot(w = 1280, h = 720) {
    const oldSize = renderer.getSize(new THREE.Vector2());
    const oldAspect = camera.aspect;
    /* Resizing the composer per capture corrupts it — the first shot of a run
     * comes out correct and every later one is black (docs/known-issues.md).
     * Capturing at the live size avoids the resize path entirely, so callers
     * that ask for the current size get a reliable frame. */
    const resize = w !== oldSize.x || h !== oldSize.y;
    if (resize) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    /* Re-fit the shadow cascades and the sky dome to wherever the camera
     * actually is. qa-shots.js settles the chase camera and *then* teleports
     * it for the free-camera views, so without this the cascades are still
     * fitted to the player's old frustum and the architecture shots come out
     * with no sun shadows at all. Only light/dome transforms move, and the
     * next advance() recomputes them regardless. */
    if (lighting) {
      lighting.update(0, camera.position);
      lighting.forceShadowUpdate();
    }
    sky.update(0, camera);
    let viaPostStack = false;
    if (render && postStackOk) {
      if (resize) render.setSize(w, h);
      /* `render.renderStill()` also resolves black here while `render.render()`
       * on the identical camera does not (docs/known-issues.md), so drive the
       * live path. Twice, so any pass blending against its own history has a
       * valid previous frame rather than the one from before the teleport. */
      render.render(1 / 60);
      render.render(1 / 60);
      viaPostStack = true;
    } else {
      renderer.render(scene, camera);
    }

    /* Per-frame guard for the camera-dependent post-stack failure: at some
     * camera positions the composer resolves to black while a direct render of
     * the identical view is correct. Verified, not hypothetical. Detect it here
     * and re-render without the stack, so a capture is never silently a black
     * rectangle — otherwise every visual review is reviewing nothing. */
    if (viaPostStack && frameIsBlank()) {
      renderer.render(scene, camera);
      viaPostStack = false;
      lastShotUsedPostStack = false;
      lastShotFellBack = true;
    } else {
      lastShotUsedPostStack = viaPostStack;
      lastShotFellBack = false;
    }
    const url = readCanvasPng();
    if (resize) {
      renderer.setSize(oldSize.x, oldSize.y, false);
      camera.aspect = oldAspect;
      camera.updateProjectionMatrix();
      if (render) render.setSize(oldSize.x, oldSize.y);
    }
    return url;
  },
};
