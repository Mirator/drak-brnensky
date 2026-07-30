import * as THREE from 'three';
import { Rng } from './rng.js';
import { getMaterial } from './materials.js';
import * as landmarksModule from './landmarks.js';

import {
  MAP_SIZE, HALF, GRID_RES, GN, MINI_SIZE, FLAG, PLACES, PLAZAS, ROADS,
  FlagGrid, Painter, FALLBACK_FOOTPRINTS,
} from './city/layout.js';
import { paintPlan, buildGround } from './city/plan.js';
import { Chunks, trackCamera } from './city/chunks.js';
import { generatePlots } from './city/blocks.js';
import { buildHouses } from './city/buildings.js';
import { buildProps } from './city/props.js';
import { buildVegetation } from './city/vegetation.js';
import { buildTrams } from './city/trams.js';
import { createBreakables } from './city/breakables.js';

/* ==================================================================
   DRAK BRNĚNSKÝ — the city.

   A compressed, playable interpretation of central Brno: 840 x 840 m,
   1 unit = 1 metre, +x = east, +z = south. Everything is generated at
   runtime from primitives and canvas textures.

   Layout, painting, plots, houses, props, vegetation and trams live in
   src/city/*; this file is the orchestrator and the public contract.
   ================================================================== */

export { MAP_SIZE, HALF, FLAG, PLACES, FlagGrid };

/**
 * Landmark ground reservations.
 *
 * `src/landmarks.js` is owned by another engineer and is being rebuilt to
 * export LANDMARK_FOOTPRINTS — the true ground footprint of every landmark
 * including terraces, platforms, steps and walls. A namespace import is used
 * deliberately: a named import of an export that does not exist yet is a
 * hard link-time error in ESM, so this way the city builds correctly
 * whichever side lands first, and falls back to the rects it shipped with.
 */
function landmarkFootprints() {
  const fromLandmarks = landmarksModule.LANDMARK_FOOTPRINTS;
  if (Array.isArray(fromLandmarks) && fromLandmarks.length) {
    // tolerate either {key, rects} or a bare rect list
    return fromLandmarks.map((entry) => (Array.isArray(entry)
      ? { key: 'landmark', rects: [entry] }
      : { key: entry.key ?? 'landmark', rects: entry.rects ?? [] }))
      .filter((f) => f.rects.length);
  }
  return FALLBACK_FOOTPRINTS;
}

export function buildCity(scene, collision, rngSeed = 20250726) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const rng = new Rng(rngSeed);
  const painter = new Painter();
  const breakables = createBreakables();

  const cityGroup = new THREE.Group();
  cityGroup.name = 'city';

  /* Spatial chunk grid. Everything heavier than the facade walls is merged
   * per material *per chunk* so frustum culling works at all, and the fine
   * tier is additionally distance-culled and excluded from the shadow
   * cascades — see src/city/chunks.js for why that is the biggest lever
   * available from this file. */
  const chunks = new Chunks({ cells: 6, detailRadius: 150 });

  /* ---------- 1. paint the ground plan ---------- */
  const { puddles } = paintPlan(painter, rng);

  /* ---------- 2. reserve the landmark footprints ---------- */
  const footprints = landmarkFootprints();
  for (const fp of footprints) {
    for (const [x, z, w, d] of fp.rects) {
      // one grid cell of padding, so quantisation can never let a plot
      // creep onto a terrace edge
      painter.rect(x, z, w + GRID_RES, d + GRID_RES, 'rgba(0,0,0,0)', FLAG.RESERVED);
    }
  }

  const flags = painter.readFlags();
  const flagAt = (x, z) => {
    const gx = Math.floor((x + HALF) / GRID_RES);
    const gz = Math.floor((z + HALF) / GRID_RES);
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return FLAG.RESERVED;
    return flags[gz * GN + gx];
  };

  /* ---------- 3. blocks -> plots ---------- */
  const { plots, buildings, reserved, debug: plotDebug } = generatePlots(rng, { flags, footprints });

  /* ---------- 4. ground relief ---------- */
  const ground = buildGround(cityGroup, collision, painter, rng, { puddles });
  const cameraAt = trackCamera(ground.plane);

  /* ---------- 5. houses, roofscape, shopfronts ---------- */
  const houses = buildHouses(cityGroup, collision, plots, rng, {
    breakables, seed: rngSeed, chunks,
  });

  /* ---------- 6. landmarks ---------- */
  const stoneMat = getMaterial('stone', { base: '#8d8577', mortar: '#6e675c', scale: 2 });
  const roofMat = getMaterial('roof');
  const landmarkInfo = landmarksModule.buildLandmarks(cityGroup, collision, { stoneMat, roofMat, rng });

  /* ---------- 7. vegetation and street life ---------- */
  const vegetation = buildVegetation(cityGroup, collision, { rng, chunks });
  const props = buildProps(cityGroup, collision, {
    rng, flagAt, plots, seed: rngSeed, breakables, chunks,
  });

  /* ---------- 8. trams ---------- */
  const tramInfo = buildTrams(cityGroup);
  const trams = tramInfo.trams;

  /* ---------- 8b. flush the chunked geometry ---------- */
  const chunkMeshes = chunks.finish(cityGroup);
  chunks.update(0, 0);

  /* ---------- 9. world bounds ---------- */
  const edge = HALF - 26;
  collision.bounds = { x0: -edge, z0: -edge, x1: edge, z1: edge };

  scene.add(cityGroup);

  /* ---------- 10. minimap ---------- */
  const mini = document.createElement('canvas');
  mini.width = mini.height = MINI_SIZE;
  const mctx = mini.getContext('2d');
  mctx.drawImage(painter.pretty, 0, 0, MINI_SIZE, MINI_SIZE);
  mctx.fillStyle = 'rgba(20,22,26,0.92)';
  const ms = MINI_SIZE / MAP_SIZE;
  for (const b of buildings) {
    if (b.rot) {
      mctx.save();
      mctx.translate((b.x + HALF) * ms, (b.z + HALF) * ms);
      mctx.rotate(-b.rot);
      mctx.fillRect((-b.w / 2) * ms, (-b.d / 2) * ms, b.w * ms, b.d * ms);
      mctx.restore();
    } else {
      mctx.fillRect((b.x - b.w / 2 + HALF) * ms, (b.z - b.d / 2 + HALF) * ms, b.w * ms, b.d * ms);
    }
  }

  /* ---------- 11. hand the breakables over if physics is already up ---------- */
  const rigidCandidate = collision.rigid || collision.rigidBody || collision.physics || null;
  const registeredNow = breakables.register(rigidCandidate);

  /* Triangle accounting, split the way the cost actually lands: with three
   * shadow cascades a caster triangle is submitted four times a frame and a
   * non-caster once, so `shadowTriangles` is the number that matters. */
  let sceneTriangles = 0;
  let shadowTriangles = 0;
  let meshCount = 0;
  cityGroup.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const n = per * (o.isInstancedMesh ? o.count : 1);
    sceneTriangles += n;
    if (o.castShadow) shadowTriangles += n;
    meshCount++;
  });

  const stats = {
    buildings: buildings.length,
    plots: plots.length,
    plotDebug,
    shops: houses.shops,
    chimneys: houses.chimneys,
    dormers: houses.dormers,
    facadeVariants: houses.facadeVariants,
    trees: vegetation.trees,
    vegetation,
    chunkCells: chunks.cells * chunks.cells,
    detailRadius: chunks.detailRadius,
    chunkMeshes,
    detailMeshes: chunks.detailMeshes.length,
    meshes: meshCount,
    sceneTriangles: Math.round(sceneTriangles),
    shadowTriangles: Math.round(shadowTriangles),
    drawCalls: meshCount,
    colliders: collision.boxes.length,
    breakables: breakables.count,
    breakablesIntact: breakables.intact,
    breakableKinds: breakables.summary(),
    props: props.counts,
    generationMs: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0,
  };

  return {
    group: cityGroup,
    buildings,
    places: PLACES,
    landmarks: landmarkInfo,
    props,
    trams,
    minimap: mini,
    flagAt,
    /** Reserved landmark footprint rects actually used, for tests/tools. */
    reserved,
    stats,
    /**
     * Register every intact breakable prop with a rigid-body world. Safe to
     * call with nothing, or with an object that has no such API — see
     * src/city/breakables.js. Returns how many were registered.
     */
    registerBreakables(rigidWorld, opts) {
      return breakables.register(rigidWorld, opts);
    },
    /**
     * Start a run from a pristine city: put every broken prop back — collider
     * re-added, instance shown, `broken` cleared — then hand the whole set to
     * the rigid-body world again. This is the one to call from `startGame()`;
     * without it the world degrades run over run, because the city itself is
     * only built once.
     *
     * @returns {{restored: number, registered: number}}
     */
    restoreBreakables(rigidWorld) {
      const restored = breakables.restore();
      return { restored, registered: breakables.register(rigidWorld, { force: true }) };
    },
    /**
     * Re-register after a rigid-body world has been cleared.
     *
     * `PhysicsWorld.clear()` empties its own breakables list, so the
     * registration made at boot is thrown away the first time `startGame()`
     * runs and nothing in the city could ever break again. Call this
     * immediately after `physics.clear()`. Props that are already debris are
     * skipped, so a restart cannot resurrect them.
     */
    reregisterBreakables(rigidWorld) {
      return breakables.reregister(rigidWorld);
    },
    breakablesRegisteredAtBuild: registeredNow,
    /** A random walkable point near (x,z) — used for enemy spawning. */
    randomOpenPoint(cx, cz, radius, rngRef = rng, clearance = 2) {
      for (let i = 0; i < 90; i++) {
        const a = rngRef.float(0, Math.PI * 2);
        const r = radius * Math.sqrt(rngRef.float(0.15, 1));
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (Math.abs(x) > edge - 6 || Math.abs(z) > edge - 6) continue;
        const f = flagAt(x, z);
        if (f === FLAG.ROAD || f === FLAG.PLAZA || f === FLAG.PARK) {
          // needs real elbow room, or things spawn wedged against a wall
          let clear = true;
          for (let k = 0; k < 9 && clear; k++) {
            const ang = (k / 8) * Math.PI * 2;
            const ox = k === 8 ? 0 : Math.cos(ang) * clearance;
            const oz = k === 8 ? 0 : Math.sin(ang) * clearance;
            if (collision.isSolidAt(x + ox, 1.3, z + oz)) clear = false;
          }
          if (clear) return new THREE.Vector3(x, collision.groundHeight(x, z, 8, 0.5), z);
        }
      }
      return null;
    },
    /** Live LOD counters, for the performance engineer's overlay. */
    lodStats() {
      let visible = 0;
      for (const d of chunks.detailMeshes) if (d.mesh.visible) visible++;
      return {
        detailMeshes: chunks.detailMeshes.length,
        detailVisible: visible,
        cameraTracked: cameraAt.seen,
        cameraAt: [Math.round(cameraAt.x), Math.round(cameraAt.z)],
      };
    },
    update(dt, t) {
      for (const tr of trams) tr.update(dt);
      if (props.update) props.update(dt, t);
      // one frame of latency by design: the camera is sampled during render
      chunks.update(cameraAt.x, cameraAt.z);
    },
  };
}

export { PLAZAS, ROADS };
