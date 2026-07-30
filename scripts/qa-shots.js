/* ------------------------------------------------------------------ *
 * Dev-only visual QA harness.
 *
 * Loaded on demand from the browser console (or an automated client):
 *
 *   const qa = await import('/scripts/qa-shots.js');
 *   await qa.captureAll('base');        // writes shots/base-<view>.png
 *   await qa.capture('base', ['petrov-front', 'combat']);
 *
 * Every view is a fixed, repeatable framing so two runs of the same view are
 * directly comparable — that is the whole point: the visual critic looks at
 * before/after pairs of the *same* camera, not at whatever the game happened
 * to be showing.
 * ------------------------------------------------------------------ */

const g = () => {
  const b = window.__brno;
  if (!b) throw new Error('window.__brno is not ready yet');
  return b;
};

/* ---------------- framing helpers ---------------- */

/** Free camera: explicit eye + target, used for architecture views. */
const free = (name, eye, target, fov = 58) => ({ name, kind: 'free', eye, target, fov });

/** Third-person: teleport the player, let the chase camera settle. */
const follow = (name, at, yaw, opts = {}) => ({ name, kind: 'follow', at, yaw, ...opts });

export const VIEWS = [
  /* --- landmarks: the things that have to read as Brno --- */
  free('petrov-front', [-104, 30, 262], [-108, 46, 172]),
  free('petrov-close', [-108, 6, 212], [-108, 34, 178], 64),
  free('petrov-skyline', [40, 78, 300], [-108, 50, 170], 46),
  free('spilberk-far', [-140, 46, 130], [-268, 52, 44], 50),
  free('spilberk-walls', [-268, 26, 116], [-268, 24, 62], 62),
  free('radnice-tower', [-18, 18, 104], [-18, 28, 46], 58),
  free('radnice-portal', [-20, 4, 62], [-18, 10, 47], 66),
  free('svoboda-wide', [14, 14, 62], [0, 10, -12], 58),
  free('zelny-parnas', [-52, 8, 116], [-52, 7, 78], 60),
  free('nadrazi', [22, 16, 330], [22, 12, 268], 58),
  free('moravske', [18, 13, -72], [18, 9, -134], 58),
  free('janacek', [112, 14, -108], [112, 12, -170], 58),
  free('rooftops', [30, 110, 150], [-70, 24, 60], 44),

  /* --- gameplay: what the player actually stares at for an hour --- */
  follow('street-masarykova', [4, 0, 180], Math.PI),
  follow('street-ceska', [-66, 0, -96], Math.PI * 0.5),
  follow('svoboda-ground', [0, 0, 10], Math.PI),
  follow('petrov-approach', [-108, 0, 206], Math.PI),
  follow('combat', [0, 0, 10], Math.PI, { enemies: ['whelp', 'whelp', 'spitter', 'golem'] }),
  follow('combat-fire', [0, 0, 10], Math.PI, { enemies: ['whelp', 'whelp', 'spitter'], fire: true }),
  follow('boss', [0, 0, 30], Math.PI, { wave: 5 }),
];

/* ---------------- state control ---------------- */

function ensurePlaying() {
  const b = g();
  if (b.state.mode !== 'playing') b.startGame();
  b.state.mode = 'playing';
}

function settle(frames = 24, dt = 1 / 60) {
  const b = g();
  for (let i = 0; i < frames; i++) {
    b.state.mode = 'playing';
    b.advance(dt);
  }
}

function placePlayer(at, yaw) {
  const b = g();
  b.player.pos.set(at[0], at[1] + 2, at[2]);
  b.player.vel.set(0, 0, 0);
  b.player.health = b.player.maxHealth;
  b.player.alive = true;
  b.chase.yaw = yaw;
  b.chase.pitch = -0.08;
  b.chase._first = true;
}

async function applyView(view) {
  const b = g();
  ensurePlaying();

  if (view.kind === 'follow') {
    if (view.wave) {
      b.startWave(view.wave);
      placePlayer(view.at, view.yaw);
      settle(40);
      // the boss spawns wherever its wave definition says; find it and stand
      // off from it so it is actually in frame rather than behind the camera
      const bossEnemy = b.enemies.list.find((e) => e.typeId === 'boss' && e.hp > 0);
      if (bossEnemy) {
        const standoff = view.standoff || 26;
        placePlayer([bossEnemy.pos.x, 0, bossEnemy.pos.z + standoff], Math.PI);
        settle(30);
      }
    } else {
      placePlayer(view.at, view.yaw);
      settle(40);
      /* Spawn into the camera's forward arc, not around the full circle.
       * Spawning uniformly in a ring put most of the creatures behind the
       * camera, so combat captures came back with an empty street and the
       * enemy work went unreviewed. Angles are fixed rather than random so two
       * runs of the same view are comparable. */
      const fwd = new b.THREE.Vector3();
      b.camera.getWorldDirection(fwd);
      const base = Math.atan2(fwd.x, fwd.z);
      const spread = [-0.42, 0.28, -0.14, 0.5, 0.05, -0.6];
      const radii = [11, 16, 13, 19, 9, 15];
      (view.enemies || []).forEach((type, i) => {
        const a = base + spread[i % spread.length];
        const r = radii[i % radii.length];
        b.spawnEnemy(type, b.player.pos.x + Math.sin(a) * r, b.player.pos.z + Math.cos(a) * r);
      });
      if (view.enemies) settle(50);
      if (view.fire) {
        b.input.mouse.left = true;
        settle(10);
        b.input.mouse.left = false;
        settle(2);
      }
    }
    return;
  }

  // free camera — placed after a settle so the world (trams, animation) is live
  settle(8);
  b.camera.fov = view.fov;
  placeFreeCamera(view);
  b.camera.updateProjectionMatrix();
}

/**
 * Put the eye where it can actually see the target.
 *
 * The hardcoded eye positions were authored against the original city. Once the
 * landmarks and the building stock were rebuilt, several of them ended up
 * *inside* a wall, and the captures came back as a black frame with a sliver of
 * sky — which reads exactly like a render bug and is not one.
 *
 * So: march from the target towards the requested eye and stop short of the
 * first solid, then lift the eye clear of the ground. The framing degrades
 * gracefully as the city changes instead of silently ending up indoors.
 */
function placeFreeCamera(view) {
  const b = g();
  const T = b.THREE;
  const target = new T.Vector3(...view.target);
  const eye = new T.Vector3(...view.eye);
  const toEye = new T.Vector3().subVectors(eye, target);
  const want = toEye.length();
  if (want < 0.001) {
    b.camera.position.copy(eye);
    b.camera.lookAt(target);
    return;
  }
  toEye.divideScalar(want);

  let dist = want;
  const collision = b.collision || null;
  const hit = collision && collision.raycastHit
    ? collision.raycastHit(target, toEye, want)
    : null;
  if (hit && hit.hit) {
    // stop short of whatever is in the way, and never end up on top of it
    dist = Math.max(6, hit.t * 0.85);
  }

  eye.copy(target).addScaledVector(toEye, dist);
  if (collision && collision.groundHeight) {
    const ground = collision.groundHeight(eye.x, eye.z, 40, 2) || 0;
    if (eye.y < ground + 2.5) eye.y = ground + 2.5;
  }
  b.camera.position.copy(eye);
  b.camera.lookAt(target);
}

/* ---------------- capture ---------------- */

async function post(name, data) {
  const res = await fetch('/__shot', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, data }),
  });
  const json = await res.json().catch(() => ({ ok: false }));
  if (!json.ok) throw new Error(`shot ${name} failed: ${res.status}`);
  return json.file;
}

export async function capture(prefix, names = null, size = null) {
  const b = g();
  /* Default to the live canvas size. Asking `shot()` for a different size makes
   * it resize the composer, which corrupts it — the first capture of a run
   * comes out correct and every later one is black. See docs/known-issues.md. */
  if (!size) {
    const live = b.renderer.getSize(new b.THREE.Vector2());
    size = [live.x, live.y];
  }
  const wanted = names ? VIEWS.filter((v) => names.includes(v.name)) : VIEWS;
  const written = [];
  const fellBack = [];
  for (const view of wanted) {
    await applyView(view);
    const url = b.shot(size[0], size[1]);
    if (b.lastShot && b.lastShot.fellBack) fellBack.push(view.name);
    written.push(await post(`${prefix}-${view.name}`, url));
    // free-cam views leave the camera detached; hand it back to the chase rig
    if (view.kind === 'free') b.chase._first = true;
  }
  return { written, fellBack, stats: b.stats() };
}

export const captureAll = (prefix, size) => capture(prefix, null, size);

export function names() {
  return VIEWS.map((v) => v.name);
}

if (typeof window !== 'undefined') {
  window.__qa = { VIEWS, capture, captureAll, names };
}
