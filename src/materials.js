/**
 * Cached PBR material registry. `getMaterial(name, opts)` builds a
 * material the first time it's asked for and returns the same instance
 * (and the same GPU textures) on every later call with an equal `opts` —
 * materials are shared aggressively on purpose, because the city merges
 * geometry per material (one mesh per facade style / lighting variant,
 * one per landmark material — see README, ~150-400 draw calls total).
 * Requesting a new *variant* is fine (a new cache entry, a few more draw
 * calls); requesting a fresh material per *instance* is not — don't call
 * getMaterial() per-building or per-prop with an ever-changing seed.
 *
 * `disposeAll()` disposes every cached material and its textures — call it
 * before rebuilding the world (e.g. after `setResolutionTier()` changes,
 * or on a full restart) so old GPU textures don't leak.
 */
import { setResolutionTier, getResolutionTier } from './textures/core.js';
import {
  FACADE_STYLES, BAY_W, FLOOR_H, CZECH_SIGNS,
  paintFacadeBay, facadeBayMaterial,
} from './textures/facades.js';
import { makeRoofMaterial, makeSlateCopperMaterial, makeMetalSeamRoofMaterial } from './textures/roofs.js';
import { makeStoneMaterial } from './textures/stone.js';
import {
  makeCobbleMaterial, makeAsphaltMaterial, makeKerbMaterial, makeTactilePavingMaterial,
  makeDrainCoverMaterial, makePavementSlabMaterial, makeGravelMaterial, makeGrassMaterial,
  makePuddleMaterial,
} from './textures/ground.js';
import {
  glassMaterial, makePaneGlassMaterial, makeTramRailMaterial, makePaintedMetalMaterial,
  makeWoodMaterial, makeTramLiveryMaterial, makeConcreteMaterial, makeGraffitiPlasterMaterial,
  makeBronzeMaterial, makeGildedMaterial,
  makeScorchDecal, makeImpactDecal, makeCrackDecal, makeStainDecal, makeScuffDecal,
} from './textures/misc.js';

/* ------------------------------------------------------------------ */
/* registry                                                             */
/* ------------------------------------------------------------------ */
const cache = new Map();

function cacheKey(name, opts) {
  return `${name}::${getResolutionTier()}::${JSON.stringify(opts)}`;
}

const BUILDERS = {
  /** Whole-building repeating facade tile, per Brno plaster style (0..5)
   * and bay archetype. `style` indexes FACADE_STYLES (0..5); `bay` is one
   * of 'plain' | 'shopfront' | 'pianoNobile' | 'attic'. `signText`, when
   * `bay: 'shopfront'`, draws a Czech sign into the awning band (pick from
   * the exported CZECH_SIGNS, or pass your own string). */
  facade: (opts = {}) => {
    const styleIndex = ((opts.style ?? 0) % FACADE_STYLES.length + FACADE_STYLES.length) % FACADE_STYLES.length;
    const style = FACADE_STYLES[styleIndex];
    const seed = opts.seed ?? (11 + styleIndex * 7 + (opts.bay ? hashStr(opts.bay) : 0));
    return facadeBayMaterial(paintFacadeBay(style, { seed, kind: opts.bay || 'plain', signText: opts.signText || null }));
  },

  roof: () => makeRoofMaterial(),
  roofSlate: (opts = {}) => makeSlateCopperMaterial(opts.seed ?? 202, { copper: false }),
  roofCopper: (opts = {}) => makeSlateCopperMaterial(opts.seed ?? 202, { copper: true }),
  roofMetalSeam: (opts = {}) => makeMetalSeamRoofMaterial(opts.seed),

  /** Gothic ashlar. `scale` controls UV repeat exactly as the legacy
   * makeStoneMaterial(base, mortar, scale) does — pass a bigger scale for
   * a broad wall, smaller for a slender buttress. */
  stone: (opts = {}) => makeStoneMaterial(opts.base, opts.mortar, opts.scale),

  cobbleRunning: (opts = {}) => makeCobbleMaterial({ ...opts, pattern: 'running' }),
  cobbleFan: (opts = {}) => makeCobbleMaterial({ ...opts, pattern: 'fan' }),
  cobbleTramTrack: (opts = {}) => makeCobbleMaterial({ ...opts, pattern: 'running', trackGrooves: true }),
  asphalt: (opts = {}) => makeAsphaltMaterial(opts),
  kerb: (opts = {}) => makeKerbMaterial(opts),
  tactilePaving: (opts = {}) => makeTactilePavingMaterial(opts),
  drainCover: (opts = {}) => makeDrainCoverMaterial(opts),
  pavementSlab: (opts = {}) => makePavementSlabMaterial(opts),
  gravel: (opts = {}) => makeGravelMaterial(opts),
  grass: (opts = {}) => makeGrassMaterial(opts),
  /** Wet-look decal material — layer as a thin plane/decal slightly above
   * cobbles/asphalt at puddle spots, much lower roughness + faint ripple
   * normal. Not a replacement ground material by itself. */
  puddle: (opts = {}) => makePuddleMaterial(opts),

  glass: () => glassMaterial(),
  paneGlass: (opts = {}) => makePaneGlassMaterial(opts),

  tramRail: (opts = {}) => makeTramRailMaterial(opts),
  paintedMetal: (opts = {}) => makePaintedMetalMaterial(opts),
  wood: (opts = {}) => makeWoodMaterial(opts),
  tramLivery: (opts = {}) => makeTramLiveryMaterial(opts),
  concrete: (opts = {}) => makeConcreteMaterial(opts),
  graffitiPlaster: (opts = {}) => makeGraffitiPlasterMaterial(opts),
  bronze: (opts = {}) => makeBronzeMaterial({ ...opts, verdigris: opts.verdigris ?? true }),
  gilded: (opts = {}) => makeGildedMaterial(opts),

  decalScorch: (opts = {}) => makeScorchDecal(opts),
  decalImpact: (opts = {}) => makeImpactDecal(opts),
  decalCrack: (opts = {}) => makeCrackDecal(opts),
  decalStain: (opts = {}) => makeStainDecal(opts),
  decalScuff: (opts = {}) => makeScuffDecal(opts),
};

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 97;
}

/** Get (building on first use) a cached, shared material. `opts` is part
 * of the cache key — the same name+opts always returns the same instance,
 * a different seed/variant creates (and caches) a new one. */
export function getMaterial(name, opts = {}) {
  const k = cacheKey(name, opts);
  let mat = cache.get(k);
  if (mat) return mat;
  const build = BUILDERS[name];
  if (!build) throw new Error(`materials.js: unknown material "${name}" (known: ${Object.keys(BUILDERS).join(', ')})`);
  mat = build(opts);
  cache.set(k, mat);
  return mat;
}

/** List of material names getMaterial() accepts. */
export function listMaterials() {
  return Object.keys(BUILDERS);
}

function disposeOne(mat) {
  for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
    const t = mat[slot];
    if (t && t.dispose) t.dispose();
  }
  mat.dispose();
}

/** Dispose every cached material and its textures, and clear the cache.
 * Call this before rebuilding the world after setResolutionTier() changes
 * quality tier, or the old GPU textures leak. */
export function disposeAll() {
  for (const mat of cache.values()) disposeOne(mat);
  cache.clear();
}

export { setResolutionTier, getResolutionTier, BAY_W, FLOOR_H, FACADE_STYLES, CZECH_SIGNS };
