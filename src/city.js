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
import { buildTerrain } from './city/terrain.js';
import {
  buildImportedBuildings, buildImportedMinimap, buildImportedPlan, createFlagAt,
  drapeChildren, drapeChunkBatches, drapeCollisionBoxes, installImportedLayout, NavigationField,
} from './city/imported.js';

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

function buildLegacyCity(scene, collision, rngSeed = 20250726) {
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
    update(dt, t, viewPos = null) {
      for (const tr of trams) tr.update(dt);
      if (props.update) props.update(dt, t);
      // Without a camera from the caller this has one frame of latency by
      // design: the view is sampled during render off the ground plane.
      chunks.update(viewPos ? viewPos.x : cameraAt.x, viewPos ? viewPos.z : cameraAt.z);
    },
  };
}

/**
 * Build either the committed geospatial Brno snapshot (normal runtime) or the
 * old procedural fixture (kept for low-level tests and developer comparison).
 */
export function buildCity(scene, collision, dataOrSeed = 20250726, maybeSeed = 20250726) {
  if (dataOrSeed?.map && dataOrSeed?.terrain) {
    return buildGeospatialCity(scene, collision, dataOrSeed, maybeSeed);
  }
  return buildLegacyCity(scene, collision, dataOrSeed);
}

function halfTurn(angle) {
  let value = angle;
  while (value > Math.PI / 2) value -= Math.PI;
  while (value <= -Math.PI / 2) value += Math.PI;
  return value;
}

function landmarkRotation(map, key, legacyAxis) {
  const place = map.places[key];
  const exact = map.buildings.filter((building) => building.id === place?.osmId);
  const candidates = exact.length
    ? exact
    : map.buildings.filter((building) => building.landmark === key);
  let bestLength = 0;
  let bestAngle = null;
  for (const building of candidates) {
    for (const polygon of building.polygons) {
      const ring = polygon[0] || [];
      for (let i = 1; i < ring.length; i++) {
        const dx = ring[i][0] - ring[i - 1][0];
        const dz = ring[i][1] - ring[i - 1][1];
        const length = Math.hypot(dx, dz);
        if (length > bestLength) {
          bestLength = length;
          bestAngle = Math.atan2(dz, dx);
        }
      }
    }
  }
  if (bestAngle === null) return 0;
  return halfTurn((legacyAxis === 'z' ? Math.PI / 2 : 0) - bestAngle);
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
}

function landmarkTransforms(map, terrain, places = PLACES, visualOverrides = null) {
  const anchors = {
    petrov: [-108, 168, 6.6],
    spilberk: [-268, 44, 15],
    radnice: [-18, 44, 0],
    zelnyTrh: [-52, 78, 0],
    mahen: [104, -66, 0],
    janacek: [112, -170, 0],
    moravske: [18, -136, 0],
    nadrazi: [22, 292, 0],
    ceska: [-66, -96, 0],
  };
  const footprintByKey = new Map(landmarksModule.LANDMARK_FOOTPRINTS.map((entry) => [entry.key, entry.rects]));
  const out = {};
  for (const [key, [ox, oz, base]] of Object.entries(anchors)) {
    const place = places[key];
    if (!place) continue;
    const rects = footprintByKey.get(key) || [];
    const largest = rects.reduce((best, rect) => {
      const area = rect[2] * rect[3];
      return !best || area > best.area ? { rect, area } : best;
    }, null);
    const legacyAxis = largest && largest.rect[3] > largest.rect[2] ? 'z' : 'x';
    const radius = Math.max(12, Math.min(60,
      largest ? Math.max(largest.rect[2], largest.rect[3]) * 0.35 : 20));
    const foundation = visualOverrides?.sites?.[key]?.foundation === 'pad'
      ? median([
        terrain.heightAt(place.x, place.z),
        terrain.heightAt(place.x + radius, place.z),
        terrain.heightAt(place.x - radius, place.z),
        terrain.heightAt(place.x, place.z + radius),
        terrain.heightAt(place.x, place.z - radius),
      ])
      : terrain.heightAt(place.x, place.z);
    out[key] = {
      x: place.x - ox,
      z: place.z - oz,
      y: foundation - base,
      originX: ox,
      originZ: oz,
      targetX: place.x,
      targetZ: place.z,
      rotation: landmarkRotation(map, key, legacyAxis),
    };
  }
  out.svoboda = { x: 0, z: 0, y: terrain.heightAt(places.svoboda.x, places.svoboda.z) };
  return out;
}

function countScene(group) {
  let sceneTriangles = 0; let shadowTriangles = 0; let meshes = 0;
  group.traverse((object) => {
    if (!object.isMesh || !object.geometry?.attributes?.position) return;
    const per = object.geometry.index ? object.geometry.index.count / 3 : object.geometry.attributes.position.count / 3;
    const triangles = per * (object.isInstancedMesh ? object.count : 1);
    sceneTriangles += triangles;
    if (object.castShadow) shadowTriangles += triangles;
    meshes++;
  });
  return { sceneTriangles: Math.round(sceneTriangles), shadowTriangles: Math.round(shadowTriangles), meshes };
}

function buildGeospatialCity(scene, collision, { map, terrain, visualOverrides = null }, rngSeed) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const rng = new Rng(rngSeed);
  const breakables = createBreakables();
  const cityGroup = new THREE.Group();
  cityGroup.name = 'city:brno-osm-dmr5g';
  // Match the legacy ~140 m spatial buckets so frustum and detail culling stay
  // effective across the expanded 1.5 km map.
  const chunks = new Chunks({ cells: 11, detailRadius: 180 });
  // Roads and plaza triangles are already sampled against the heightfield at
  // four-metre spans, so their render buckets need not mirror every terrain
  // chunk. A coarser grid keeps plan culling useful without paying hundreds
  // of tiny, same-material draw calls in central views.
  const planChunks = new Chunks({ cells: 5, detailRadius: 180 });
  const buildingChunks = new Chunks({ cells: 3, detailRadius: 180 });

  const importedLayout = installImportedLayout(map, visualOverrides);
  collision.setTerrain(terrain);
  const terrainInfo = buildTerrain(cityGroup, terrain);
  const cameraAt = trackCamera(terrainInfo.meshes[0]);
  const plan = buildImportedPlan(cityGroup, map, terrain, planChunks, visualOverrides);
  const planChunkMeshes = planChunks.finish(cityGroup);
  const flagAt = createFlagAt(plan.flags);
  const navigation = new NavigationField(flagAt, terrain);
  navigation.rebuild(map.start.x, map.start.z);
  const buildingInfo = buildImportedBuildings(
    cityGroup, collision, map, terrain, buildingChunks, visualOverrides,
  );
  const buildingChunkMeshes = buildingChunks.finish(cityGroup);
  buildingChunks.update(map.start.x, map.start.z);

  const stoneMat = getMaterial('stone', { base: '#8d8577', mortar: '#6e675c', scale: 2 });
  const roofMat = getMaterial('roof');
  const landmarkInfo = landmarksModule.buildLandmarks(cityGroup, collision, {
    stoneMat, roofMat, rng,
    transforms: landmarkTransforms(map, terrain, importedLayout.places, visualOverrides),
  });

  // Retain the procedural street life, but project every generated element
  // onto the measured heightfield before its chunk buffers are uploaded.
  const vegetationStart = cityGroup.children.length;
  const vegetationColliderStart = collision.boxes.length;
  const vegetation = buildVegetation(cityGroup, collision, {
    rng, chunks, layout: importedLayout,
  });
  drapeChildren(cityGroup, vegetationStart, terrain);
  drapeCollisionBoxes(collision, vegetationColliderStart, terrain);
  const propsStart = cityGroup.children.length;
  const propsColliderStart = collision.boxes.length;
  const props = buildProps(cityGroup, collision, {
    rng, flagAt, plots: [], seed: rngSeed, breakables, chunks,
    heightAt: (x, z) => terrain.heightAt(x, z),
    layout: importedLayout,
  });
  drapeChildren(cityGroup, propsStart, terrain);
  drapeCollisionBoxes(collision, propsColliderStart, terrain);
  drapeChunkBatches(chunks, terrain);

  const tramInfo = buildTrams(
    cityGroup,
    (x, z) => terrain.heightAt(x, z),
    importedLayout.tramRoutes,
  );
  const trams = tramInfo.trams;
  const chunkMeshes = chunks.finish(cityGroup);
  chunks.update(map.start.x, map.start.z);

  const edge = HALF - 26;
  collision.bounds = { x0: -edge, z0: -edge, x1: edge, z1: edge };
  scene.add(cityGroup);
  const mini = buildImportedMinimap(map);
  const registeredNow = breakables.register(collision.rigid || collision.rigidBody || collision.physics || null);
  const sceneCounts = countScene(cityGroup);

  const stats = {
    source: map.metadata.sourceDate,
    mapSize: MAP_SIZE,
    buildings: buildingInfo.count,
    courtyards: buildingInfo.courtyards,
    pitchedRoofs: buildingInfo.pitchedRoofs,
    detailedBuildings: buildingInfo.detailed,
    terrainChunks: terrainInfo.meshes.length,
    mapMeshes: planChunkMeshes,
    chunkMeshes,
    buildingChunkMeshes,
    detailMeshes: chunks.detailMeshes.length + buildingChunks.detailMeshes.length,
    cityMeshes: sceneCounts.meshes,
    ...sceneCounts,
    colliders: collision.boxes.length,
    breakables: breakables.count,
    breakablesIntact: breakables.intact,
    props: props.counts,
    vegetation,
    generationMs: typeof performance !== 'undefined' ? Math.round(performance.now() - t0) : 0,
  };

  return {
    group: cityGroup,
    buildings: map.buildings,
    places: importedLayout.places,
    landmarks: landmarkInfo,
    props,
    trams,
    minimap: mini,
    flagAt,
    terrain,
    navigation,
    metadata: map.metadata,
    start: {
      x: map.start.x,
      z: map.start.z,
      y: terrain.heightAt(map.start.x, map.start.z),
      yaw: Math.atan2(
        importedLayout.places.column.x - map.start.x,
        importedLayout.places.column.z - map.start.z,
      ),
    },
    reserved: [],
    stats,
    registerBreakables: (rigidWorld, opts) => breakables.register(rigidWorld, opts),
    restoreBreakables(rigidWorld) {
      const restored = breakables.restore();
      return { restored, registered: breakables.register(rigidWorld, { force: true }) };
    },
    reregisterBreakables: (rigidWorld) => breakables.reregister(rigidWorld),
    breakablesRegisteredAtBuild: registeredNow,
    randomOpenPoint(cx, cz, radius, rngRef = rng, clearance = 2) {
      for (let i = 0; i < 150; i++) {
        const a = rngRef.float(0, Math.PI * 2);
        const r = radius * Math.sqrt(rngRef.float(0.08, 1));
        const x = cx + Math.cos(a) * r; const z = cz + Math.sin(a) * r;
        if (Math.abs(x) > edge - 6 || Math.abs(z) > edge - 6) continue;
        const f = flagAt(x, z);
        if (f !== FLAG.ROAD && f !== FLAG.PLAZA && f !== FLAG.PARK && f !== FLAG.TRACK) continue;
        if (terrain.slopeAt(x, z) > 0.55 || !navigation.reachable(x, z)) continue;
        let clear = true;
        const y = terrain.heightAt(x, z);
        for (let k = 0; k < 9 && clear; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const ox = k === 8 ? 0 : Math.cos(ang) * clearance;
          const oz = k === 8 ? 0 : Math.sin(ang) * clearance;
          if (collision.isSolidAt(x + ox, y + 1.3, z + oz)) clear = false;
        }
        if (clear) return new THREE.Vector3(x, y, z);
      }
      return null;
    },
    navigationDirection(x, z, targetX, targetZ) {
      return navigation.directionAt(x, z, targetX, targetZ);
    },
    lodStats() {
      let visible = 0;
      for (const d of chunks.detailMeshes) if (d.mesh.visible) visible++;
      for (const d of buildingChunks.detailMeshes) if (d.mesh.visible) visible++;
      return {
        detailMeshes: chunks.detailMeshes.length + buildingChunks.detailMeshes.length,
        detailVisible: visible,
        cameraTracked: cameraAt.seen,
        cameraAt: [Math.round(cameraAt.x), Math.round(cameraAt.z)],
      };
    },
    /**
     * `viewPos` is the camera. It is optional only because the LOD used to
     * have no way of asking: the fallback samples the view during render off
     * a sentinel mesh, which costs a frame of latency and goes stale the
     * moment that mesh is itself culled. Callers that have the camera to
     * hand should pass it — the detail LOD keys off this point.
     */
    update(dt, t, viewPos = null) {
      for (const tram of trams) tram.update(dt);
      if (props.update) props.update(dt, t);
      chunks.update(viewPos ? viewPos.x : cameraAt.x, viewPos ? viewPos.z : cameraAt.z);
      buildingChunks.update(viewPos ? viewPos.x : cameraAt.x, viewPos ? viewPos.z : cameraAt.z);
      landmarkInfo.update?.(dt, t, viewPos);
    },
  };
}

export { PLAZAS, ROADS };
