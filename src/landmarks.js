import * as THREE from 'three';
import { Builder, palette, PROFILE } from './landmarks/detail.js';
import * as petrov from './landmarks/petrov.js';
import * as spilberk from './landmarks/spilberk.js';
import * as radnice from './landmarks/radnice.js';
import * as svoboda from './landmarks/svoboda.js';
import * as parnas from './landmarks/parnas.js';
import * as theatres from './landmarks/theatres.js';
import * as moravske from './landmarks/moravske.js';
import * as nadrazi from './landmarks/nadrazi.js';

/**
 * Hand-modelled Brno landmarks. One module per building under `src/landmarks/`,
 * with the shared gothic/baroque part library and the geometry Builder in
 * `src/landmarks/detail.js`.
 *
 * Everything is generated at runtime from primitives, lathes, swept mouldings
 * and extruded tracery — no model files, no textures on disk. Every solid is
 * mirrored into the collision world so you can climb the Špilberk terraces or
 * take cover behind Petrov's buttresses.
 *
 * PERFORMANCE. Detail is stamped from a small library of shared part
 * geometries (one baluster, one crocket, one merlon, one pinnacle, one figure
 * per pose) and merged per material, so several hundred thousand triangles of
 * ornament still cost a couple of dozen draw calls. Ornament goes to a second
 * tier which merges per LOD cluster and can be switched off wholesale —
 * see `setDetail()` and `setEye()` below.
 *
 * Sources and per-building modelling notes: `docs/brno-reference.md`.
 */

/* ==================================================================
   LANDMARK_FOOTPRINTS — the shared contract with src/city.js
   ================================================================== */

/**
 * The **true** ground footprint of every landmark, including terraces,
 * platforms, steps, retaining walls and forecourts — not just the building box.
 * `src/city.js` reserves these cells so none of its ~1400 procedural houses can
 * land on a landmark; under-reporting a footprint silently reintroduces the
 * overlap bug that "expanding landmark reservations to the true terrace/platform
 * footprints" fixed.
 *
 * Shape: `[{ key: string, rects: [[cx, cz, w, d], ...] }, ...]`, world metres,
 * axis-aligned, `cx`/`cz` the rect centre.
 *
 * This is the single source of truth: every rect below is re-exported from the
 * building module that draws that ground, so the geometry and the reservation
 * cannot drift apart.
 */
export const LANDMARK_FOOTPRINTS = [
  { key: 'petrov', rects: petrov.RECTS },
  { key: 'spilberk', rects: spilberk.RECTS },
  { key: 'radnice', rects: radnice.RECTS },
  { key: 'svoboda', rects: svoboda.RECTS },
  { key: 'zelnyTrh', rects: parnas.RECTS },
  { key: 'mahen', rects: theatres.RECTS_MAHEN },
  { key: 'janacek', rects: theatres.RECTS_JANACEK },
  { key: 'moravske', rects: moravske.RECTS },
  { key: 'nadrazi', rects: nadrazi.RECTS },
  { key: 'ceska', rects: [[-80, -90, 22, 20], [-54, -100, 20, 18]] },
];

/**
 * Distance beyond which a cluster's ornament tier is switched off. At 150 m a
 * crocket is a couple of pixels; the silhouette (walls, roofs, spires,
 * crenellations) all lives in the structural tier and never switches off.
 */
const LOD_DISTANCE = 150;

export function buildLandmarks(group, collision, { stoneMat, roofMat, rng, transforms = {} } = {}) {
  const M = palette({ stoneMat, roofMat });
  const b = new Builder(collision, M, { transforms });
  const info = {};
  const animated = [];
  const ctx = { M, info, animated, group, rng, collision, transforms };

  petrov.build(b, ctx);
  spilberk.build(b, ctx);
  radnice.build(b, ctx);
  svoboda.build(b, ctx);
  parnas.build(b, ctx);
  theatres.buildMahen(b, ctx);
  theatres.buildJanacek(b, ctx);
  moravske.build(b, ctx);
  nadrazi.build(b, ctx);
  buildCeska(b, ctx);

  const transformInfo = {
    petrov: 'petrov', spilberk: 'spilberk', radnice: 'radnice',
    zelnyTrh: 'zelnyTrh', mahen: 'mahen', janacek: 'janacek',
    moravske: 'moravske', stTomas: 'moravske', mistodrzitelsky: 'moravske',
    nadrazi: 'nadrazi', ceska: 'ceska',
  };
  for (const [key, cluster] of Object.entries(transformInfo)) {
    const tr = transforms[cluster];
    if (tr && info[key]?.pos) info[key].pos.add(new THREE.Vector3(tr.x || 0, tr.y || 0, tr.z || 0));
  }

  const lods = b.finish(group);

  /* ---- distance LOD ------------------------------------------------ */
  // Ornament merges per cluster, so switching a cluster off costs nothing and
  // saves its whole draw call. `setEye()` drives it; with no eye set every
  // cluster stays visible, which is the safe default for any caller that
  // does not know about this.
  let eye = null;
  let detail = 1;
  let lodDistance = LOD_DISTANCE;
  const applyLod = () => {
    for (const l of lods) {
      l.group.visible = detail > 0
        && (!eye || eye.distanceTo(l.centre) < lodDistance + l.radius);
    }
  };

  return {
    info,
    animated,
    /** Same array `LANDMARK_FOOTPRINTS` exports, for convenience. */
    footprints: LANDMARK_FOOTPRINTS,
    /** The per-cluster ornament groups, for the performance engineer. */
    lodClusters: lods,
    /** 1 = full detail, 0 = coarse (all ornament hidden). */
    setDetail(level) {
      detail = level > 0 ? 1 : 0;
      applyLod();
      return detail;
    },
    /** Feed the camera position (or any Vector3) to drive the distance LOD. */
    setEye(v) {
      eye = v || null;
      applyLod();
    },
    setLodDistance(d) {
      lodDistance = d;
      applyLod();
    },
    /**
     * `dt`, elapsed `t`, and optionally the camera/eye position — passing the
     * third argument turns the distance LOD on. Existing callers pass two
     * arguments and get every ornament group drawn, exactly as before.
     */
    update(dt, t, viewer) {
      if (viewer) {
        eye = viewer.isVector3 ? viewer : (viewer.position || eye);
        applyLod();
      }
      for (const a of animated) {
        if (a.kind === 'sway') {
          a.obj.rotation.z = Math.sin(t * 0.7) * 0.05;
          a.obj.position.y = a.base + Math.sin(t * 0.9) * 0.06;
        }
      }
    },
  };
}

/**
 * Česká — two arcaded corner blocks that hold the street wall at the junction.
 * Not a monument, just the two buildings the wave director spawns against, so
 * they get a cornice, a shopfront arcade and a proper roofline and no more.
 */
function buildCeska(b, ctx) {
  const { M, info } = ctx;
  const cx = -66, cz = -96;
  b.cluster('ceska').tier(0);
  for (const [hx, hz, w, d, eaves] of [[-80, -90, 20, 18, 21], [-54, -100, 18, 16, 25]]) {
    b.box(M.stone, hx, 0, hz, w, eaves, d);
    b.mould(M.stonePale, hx, 0, hz, w + 0.5, d + 0.5, PROFILE.plinth);
    b.mould(M.stonePale, hx, 4.4, hz, w + 0.3, d + 0.3, PROFILE.string);
    b.mould(M.stonePale, hx, eaves - 0.9, hz, w + 0.45, d + 0.45, PROFILE.cornice);
    b.gable(M.roof, hx, eaves, hz, w + 1, d + 1, 6.5);
    const n = Math.floor(w / 4.2);
    for (let i = 0; i < n; i++) {
      const px = hx - w / 2 + (w / n) * (i + 0.5);
      b.tier(1).place(M.stonePale, b.p('roundArchRing', 3.0, 4.2, 0.4, 0.7, { steps: 5 }),
        px, 0.2, hz - d / 2 - 0.05, {});
      b.tier(0).box(M.litGlass, px, 0.4, hz - d / 2 + 0.5, 2.2, 3.4, 0.3, { solid: false });
      for (let f = 0; f < Math.floor((eaves - 6) / 3.4); f++) {
        b.window(px, 6.0 + f * 3.4, hz - d / 2 - 0.06, 1.4, 2.3, { kind: 'baroque' });
      }
    }
    b.tier(0);
  }
  info.ceska = {
    name: 'Česká',
    pos: new THREE.Vector3(cx, 0, cz),
    radius: 22,
    top: 32,
  };
}
