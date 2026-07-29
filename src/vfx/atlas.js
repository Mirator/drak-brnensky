/**
 * Procedurally generated VFX atlases.
 *
 * Hard project constraint: nothing is loaded from disk. Both atlases below
 * are drawn once at boot into a canvas — one 4x4 sheet of particle masks and
 * one 4x4 sheet of decal marks — so the whole particle system is a single
 * texture bind and a single draw call per blend mode.
 */
import * as THREE from 'three';
import { Rng } from '../rng.js';

/* ------------------------------------------------------------------ */
/* particle atlas tile indices (must match the drawing order below)    */
/* ------------------------------------------------------------------ */
export const TILE = {
  GLOW: 0,      // soft round falloff — embers, point flashes
  SPARK: 1,     // small hard core with a short tail
  SMOKE_A: 2,   // billowy lit smoke
  SMOKE_B: 3,   // billowy lit smoke, different break-up
  DUST: 4,      // fine, dirty, low contrast
  FLECK: 5,     // irregular opaque chip — debris
  STREAK: 6,    // long thin streak for stretched sparks
  FLAME: 7,     // torn flame lick
  ASH: 8,       // small ragged flake
  STAR: 9,      // shaped muzzle flash: spikes, not a blob
  SHARD: 10,    // angular splinter
  ICHOR: 11,    // droplet cluster for creature hit spray
  RING: 12,     // thin soft ring — shockwaves, rift rims
  SOOT: 13,     // dense dark puff
  CRESCENT: 14, // off-centre lobe, breaks up repeated flashes
  HAZE: 15,     // very soft low-contrast blob for heat shimmer
};

/* ------------------------------------------------------------------ */
/* decal atlas tile indices                                            */
/* ------------------------------------------------------------------ */
export const DECAL = {
  SCORCH: 0,
  SCORCH_SOFT: 1,
  CRATER: 2,
  CHIP: 3,
  CRACK_A: 4,
  CRACK_B: 5,
  SCUFF: 6,
  SPLAT: 7,
  BURN_RING: 8,
  DUST_RING: 9,
  ICHOR_SPLAT: 10,
  GLASS_STAR: 11,
};

/** Per-surface decal choice. Falls back to stone for anything unknown. */
export const SURFACE_DECALS = {
  stone: { impact: DECAL.CHIP, crack: DECAL.CRACK_A, dust: 0xa8a094 },
  cobble: { impact: DECAL.CHIP, crack: DECAL.CRACK_B, dust: 0x8e867a },
  asphalt: { impact: DECAL.CRATER, crack: DECAL.CRACK_B, dust: 0x54545a },
  wood: { impact: DECAL.SCUFF, crack: DECAL.CRACK_A, dust: 0x9a7448 },
  metal: { impact: DECAL.SCUFF, crack: DECAL.SCUFF, dust: 0xc8ced6 },
  glass: { impact: DECAL.GLASS_STAR, crack: DECAL.GLASS_STAR, dust: 0xd8f0f8 },
  grass: { impact: DECAL.SCORCH_SOFT, crack: DECAL.SCORCH_SOFT, dust: 0x6f8a4a },
};

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------------------------------------------ */
/* tiny CPU value-noise, used to break up the generated masks           */
/* ------------------------------------------------------------------ */
function noiseField(rng, size = 32) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const at = (x, y) => g[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) * (1 - u) + at(xi + 1, yi) * u;
    const b = at(xi, yi + 1) * (1 - u) + at(xi + 1, yi + 1) * u;
    return a * (1 - v) + b * v;
  };
}

function fbm(n, x, y, oct = 4) {
  let amp = 0.5;
  let f = 1;
  let s = 0;
  let t = 0;
  for (let i = 0; i < oct; i++) {
    s += amp * n(x * f, y * f);
    t += amp;
    amp *= 0.5;
    f *= 2.07;
  }
  return s / t;
}

/**
 * Write one tile by evaluating `fn(u, v, rng, noise) -> alpha` (and
 * optionally tinting via the returned array). White RGB throughout — every
 * system tints per instance, so the atlas stays a pure mask sheet.
 */
function tileMask(ctx, ox, oy, S, seed, fn) {
  const rng = new Rng(seed);
  const n = noiseField(rng, 32);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = (y + 0.5) / S;
      let a = fn(u, v, n, rng);
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      const i = (y * S + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, ox, oy);
}

const smooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The particle mask sheet. 4x4 tiles, 128 px each by default (512² total —
 * cheap, and particles are small on screen).
 */
export function makeParticleAtlas(tileSize = 128) {
  const S = tileSize;
  const c = cv(S * 4, S * 4);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  const put = (index, seed, fn) => {
    tileMask(ctx, (index % 4) * S, Math.floor(index / 4) * S, S, seed, fn);
  };

  // 0 GLOW — smooth falloff, slight core lift
  put(TILE.GLOW, 11, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.pow(1 - Math.min(1, r), 2.1) * 0.95 + Math.pow(1 - Math.min(1, r), 12) * 0.6;
  });

  // 1 SPARK — tight hot core, faint halo
  put(TILE.SPARK, 12, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.pow(1 - Math.min(1, r), 22) + Math.pow(1 - Math.min(1, r), 3) * 0.22;
  });

  // 2/3 SMOKE — billowy fbm-broken puff
  for (const [idx, seed, scale] of [[TILE.SMOKE_A, 21, 3.1], [TILE.SMOKE_B, 34, 4.4]]) {
    put(idx, seed, (u, v, n) => {
      const r = Math.hypot(u - 0.5, v - 0.5) * 2;
      const f = fbm(n, u * scale, v * scale, 4);
      const edge = 1 - smooth(0.25, 1.0, r);
      const a = edge * (0.35 + f * 1.15) - (1 - edge) * 0.2;
      return Math.pow(Math.max(0, a), 1.25) * 0.95;
    });
  }

  // 4 DUST — fine grained, wide, low contrast
  put(TILE.DUST, 45, (u, v, n) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const f = fbm(n, u * 6.5, v * 6.5, 3);
    return Math.pow(1 - Math.min(1, r), 2.4) * (0.35 + f * 0.9) * 0.8;
  });

  // 5 FLECK — irregular chip with a hard edge
  put(TILE.FLECK, 56, (u, v, n) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    const ang = Math.atan2(dy, dx);
    const wob = 0.6 + fbm(n, Math.cos(ang) * 1.6 + 3, Math.sin(ang) * 1.6 + 3, 2) * 0.7;
    return r < wob ? 1 : 0;
  });

  // 6 STREAK — thin bright line, tapered at both ends
  put(TILE.STREAK, 67, (u, v) => {
    const across = Math.abs(u - 0.5) * 2;
    const along = Math.abs(v - 0.5) * 2;
    const core = Math.pow(1 - Math.min(1, across), 9);
    return core * (1 - Math.pow(along, 2.2));
  });

  // 7 FLAME — torn upward lick
  put(TILE.FLAME, 78, (u, v, n) => {
    const dx = (u - 0.5) * 2;
    const h = 1 - v; // 0 at the top of the tile
    const width = 0.85 * Math.pow(Math.max(0.001, h), 0.42) * (1 - h * 0.15);
    const f = fbm(n, u * 3.4, v * 2.1 + 1.7, 4);
    const edge = 1 - smooth(width * 0.35, width, Math.abs(dx) + (f - 0.5) * 0.35);
    return Math.max(0, edge * (0.45 + f * 0.95) * smooth(0.0, 0.22, h) * smooth(1.05, 0.55, h));
  });

  // 8 ASH — small ragged flake
  put(TILE.ASH, 89, (u, v, n) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const f = fbm(n, u * 7, v * 7, 3);
    return r < 0.55 + (f - 0.5) * 0.5 ? 0.9 : 0;
  });

  // 9 STAR — shaped muzzle flash: a bright centre with uneven spikes
  put(TILE.STAR, 97, (u, v, n) => {
    const dx = u - 0.5;
    const dy = v - 0.5;
    const r = Math.hypot(dx, dy) * 2;
    const ang = Math.atan2(dy, dx);
    let spikes = 0;
    for (let i = 0; i < 7; i++) {
      const a0 = (i / 7) * Math.PI * 2 + fbm(n, i * 3.3, 1.1, 2) * 1.5;
      const len = 0.45 + fbm(n, i * 1.7, 5.5, 2) * 0.55;
      const d = Math.abs(((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      spikes = Math.max(spikes, Math.pow(Math.max(0, 1 - d / 0.30), 2.2) * (1 - Math.min(1, r / len)));
    }
    const core = Math.pow(1 - Math.min(1, r / 0.42), 2.4);
    return Math.min(1, core * 1.1 + spikes * 0.85);
  });

  // 10 SHARD — angular splinter
  put(TILE.SHARD, 103, (u, v) => {
    const x = (u - 0.5) * 2;
    const y = (v - 0.5) * 2;
    const w = 0.42 * (1 - Math.abs(y) * 0.9);
    return Math.abs(x) < w && Math.abs(y) < 0.95 ? 1 : 0;
  });

  // 11 ICHOR — droplet cluster
  put(TILE.ICHOR, 114, (u, v, n) => {
    let a = 0;
    for (let i = 0; i < 5; i++) {
      const cx = 0.5 + (fbm(n, i * 4.1, 0.5, 2) - 0.5) * 0.7;
      const cy = 0.5 + (fbm(n, 0.5, i * 4.1, 2) - 0.5) * 0.7;
      const rr = 0.10 + fbm(n, i * 2.2, i * 3.7, 2) * 0.16;
      a = Math.max(a, Math.pow(1 - Math.min(1, Math.hypot(u - cx, v - cy) / rr), 1.7));
    }
    return a;
  });

  // 12 RING — thin soft annulus
  put(TILE.RING, 125, (u, v, n) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const ang = Math.atan2(v - 0.5, u - 0.5);
    const wob = (fbm(n, Math.cos(ang) * 2.2 + 4, Math.sin(ang) * 2.2 + 4, 3) - 0.5) * 0.13;
    const band = Math.exp(-Math.pow((r - 0.82 + wob) / 0.13, 2.0));
    return band * (1 - smooth(0.94, 1.02, r));
  });

  // 13 SOOT — dense dark puff (tinted near-black by the caller)
  put(TILE.SOOT, 136, (u, v, n) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const f = fbm(n, u * 2.6, v * 2.6, 4);
    return Math.pow(Math.max(0, (1 - smooth(0.15, 1.0, r)) * (0.55 + f * 0.85)), 1.1);
  });

  // 14 CRESCENT — off-centre lobe so repeated flashes never look identical
  put(TILE.CRESCENT, 147, (u, v, n) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    const r2 = Math.hypot(u - 0.62, v - 0.5) * 2;
    const f = fbm(n, u * 3.8, v * 3.8, 3);
    return Math.max(0, (1 - smooth(0.2, 1.0, r)) - (1 - smooth(0.1, 0.75, r2)) * 0.85) * (0.5 + f);
  });

  // 15 HAZE — extremely soft, used only as a distortion carrier
  put(TILE.HAZE, 158, (u, v, n) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.pow(1 - Math.min(1, r), 3.0) * (0.6 + fbm(n, u * 2.2, v * 2.2, 3) * 0.8) * 0.75;
  });

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* decal atlas                                                          */
/* ------------------------------------------------------------------ */

/**
 * Packs the decal marks into one 4x4 sheet.
 *
 * `registry` is `getMaterial` from src/materials.js when it is available.
 * The material registry owns the *look* of decals, so where it has a
 * matching entry we blit its generated canvas into our atlas instead of
 * drawing our own — same art, one draw call instead of one per decal
 * material. Anything the registry does not provide is drawn here.
 */
export function makeDecalAtlas(registry = null, tileSize = 256) {
  const S = tileSize;
  const c = cv(S * 4, S * 4);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);

  const slot = (index) => ({ x: (index % 4) * S, y: Math.floor(index / 4) * S });

  /** Try the shared material registry first; report whether it worked. */
  const fromRegistry = (index, name, opts) => {
    if (!registry) return false;
    try {
      const mat = registry(name, opts);
      const img = mat && mat.map && mat.map.image;
      if (!img || !img.width) return false;
      const { x, y } = slot(index);
      ctx.drawImage(img, x, y, S, S);
      return true;
    } catch {
      return false;
    }
  };

  const draw = (index, fn) => {
    const { x, y } = slot(index);
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.clip();
    fn(ctx, S, new Rng(400 + index * 17));
    ctx.restore();
  };

  const radial = (ctx2, S2, stops, cx = 0.5, cy = 0.5, r = 0.5) => {
    const g = ctx2.createRadialGradient(S2 * cx, S2 * cy, 0, S2 * cx, S2 * cy, S2 * r);
    for (const [p, col] of stops) g.addColorStop(p, col);
    ctx2.fillStyle = g;
    ctx2.fillRect(0, 0, S2, S2);
  };

  // 0 SCORCH — the registry's scorch decal if it exists
  if (!fromRegistry(DECAL.SCORCH, 'decalScorch', { seed: 81 })) {
    draw(DECAL.SCORCH, (x, S2, rng) => {
      radial(x, S2, [[0, 'rgba(8,6,6,0.94)'], [0.45, 'rgba(20,14,10,0.6)'], [1, 'rgba(20,14,10,0)']]);
      for (let i = 0; i < 14; i++) {
        const a = rng.float(0, Math.PI * 2);
        x.strokeStyle = `rgba(0,0,0,${rng.float(0.2, 0.55)})`;
        x.lineWidth = rng.float(2, 7);
        x.beginPath();
        x.moveTo(S2 / 2, S2 / 2);
        x.lineTo(S2 / 2 + Math.cos(a) * S2 * rng.float(0.28, 0.48), S2 / 2 + Math.sin(a) * S2 * rng.float(0.28, 0.48));
        x.stroke();
      }
    });
  }

  // 1 SCORCH_SOFT — wide, faint, no tendrils (flame pooling, grass burn)
  draw(DECAL.SCORCH_SOFT, (x, S2, rng) => {
    for (let i = 0; i < 7; i++) {
      radial(x, S2, [[0, `rgba(14,10,8,${rng.float(0.18, 0.32)})`], [1, 'rgba(14,10,8,0)']],
        rng.float(0.34, 0.66), rng.float(0.34, 0.66), rng.float(0.24, 0.46));
    }
  });

  // 2 CRATER — the registry's impact decal if it exists
  if (!fromRegistry(DECAL.CRATER, 'decalImpact', { seed: 82 })) {
    draw(DECAL.CRATER, (x, S2, rng) => {
      radial(x, S2, [[0, 'rgba(16,14,12,0.9)'], [0.3, 'rgba(30,26,22,0.5)'], [1, 'rgba(30,26,22,0)']], 0.5, 0.5, 0.36);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rng.float(-0.25, 0.25);
        x.strokeStyle = `rgba(18,16,14,${rng.float(0.3, 0.65)})`;
        x.lineWidth = rng.float(1.5, 5);
        x.beginPath();
        x.moveTo(S2 / 2 + Math.cos(a) * S2 * 0.1, S2 / 2 + Math.sin(a) * S2 * 0.1);
        x.lineTo(S2 / 2 + Math.cos(a) * S2 * rng.float(0.18, 0.44), S2 / 2 + Math.sin(a) * S2 * rng.float(0.18, 0.44));
        x.stroke();
      }
    });
  }

  // 3 CHIP — small bright rim around a dark pit: a plasma bolt on stone
  draw(DECAL.CHIP, (x, S2, rng) => {
    radial(x, S2, [[0, 'rgba(232,224,208,0.55)'], [0.55, 'rgba(190,180,164,0.22)'], [1, 'rgba(190,180,164,0)']], 0.5, 0.5, 0.34);
    radial(x, S2, [[0, 'rgba(18,15,13,0.92)'], [0.7, 'rgba(24,20,16,0.35)'], [1, 'rgba(24,20,16,0)']], 0.5, 0.5, 0.17);
    for (let i = 0; i < 9; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r0 = S2 * rng.float(0.16, 0.2);
      const r1 = S2 * rng.float(0.22, 0.36);
      x.strokeStyle = `rgba(210,200,184,${rng.float(0.12, 0.32)})`;
      x.lineWidth = rng.float(1, 3);
      x.beginPath();
      x.moveTo(S2 / 2 + Math.cos(a) * r0, S2 / 2 + Math.sin(a) * r0);
      x.lineTo(S2 / 2 + Math.cos(a) * r1, S2 / 2 + Math.sin(a) * r1);
      x.stroke();
    }
  });

  // 4/5 CRACKS — branching, from the registry where possible
  if (!fromRegistry(DECAL.CRACK_A, 'decalCrack', { seed: 83 })) {
    draw(DECAL.CRACK_A, (x, S2, rng) => branchCracks(x, S2, rng, 5));
  }
  draw(DECAL.CRACK_B, (x, S2, rng) => branchCracks(x, S2, rng, 8));

  // 6 SCUFF — grazing streaks
  if (!fromRegistry(DECAL.SCUFF, 'decalScuff', { seed: 85 })) {
    draw(DECAL.SCUFF, (x, S2, rng) => {
      for (let i = 0; i < 26; i++) {
        x.strokeStyle = `rgba(38,36,32,${rng.float(0.08, 0.3)})`;
        x.lineWidth = rng.float(1, 4);
        const y = rng.float(S2 * 0.28, S2 * 0.72);
        x.beginPath();
        x.moveTo(rng.float(0, S2 * 0.32), y + rng.float(-12, 12));
        x.lineTo(rng.float(S2 * 0.62, S2), y + rng.float(-12, 12));
        x.stroke();
      }
    });
  }

  // 7 SPLAT — irregular wet mark (registry stain if present)
  if (!fromRegistry(DECAL.SPLAT, 'decalStain', { seed: 84 })) {
    draw(DECAL.SPLAT, (x, S2, rng) => {
      for (let i = 0; i < 12; i++) {
        radial(x, S2, [[0, `rgba(24,20,18,${rng.float(0.3, 0.6)})`], [1, 'rgba(24,20,18,0)']],
          rng.float(0.25, 0.75), rng.float(0.25, 0.75), rng.float(0.08, 0.24));
      }
    });
  }

  // 8 BURN_RING — hot ember rim, fades to black centre (fresh flame pool)
  draw(DECAL.BURN_RING, (x, S2, rng) => {
    radial(x, S2, [[0, 'rgba(10,7,6,0.85)'], [0.62, 'rgba(14,9,7,0.7)'], [0.8, 'rgba(150,52,12,0.5)'], [0.92, 'rgba(60,20,6,0.2)'], [1, 'rgba(30,10,4,0)']]);
    for (let i = 0; i < 20; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = S2 * rng.float(0.34, 0.48);
      x.fillStyle = `rgba(255,${Math.round(rng.float(90, 170))},40,${rng.float(0.1, 0.35)})`;
      x.beginPath();
      x.arc(S2 / 2 + Math.cos(a) * r, S2 / 2 + Math.sin(a) * r, rng.float(2, 7), 0, Math.PI * 2);
      x.fill();
    }
  });

  // 9 DUST_RING — pale ring of blown dust, for shockwave ground marks
  draw(DECAL.DUST_RING, (x, S2, rng) => {
    x.strokeStyle = 'rgba(210,200,182,0.30)';
    for (let i = 0; i < 3; i++) {
      x.lineWidth = rng.float(6, 18);
      x.beginPath();
      x.arc(S2 / 2, S2 / 2, S2 * rng.float(0.32, 0.44), 0, Math.PI * 2);
      x.stroke();
    }
    radial(x, S2, [[0, 'rgba(190,182,166,0.14)'], [1, 'rgba(190,182,166,0)']], 0.5, 0.5, 0.42);
  });

  // 10 ICHOR_SPLAT — dark creature blood, no red
  draw(DECAL.ICHOR_SPLAT, (x, S2, rng) => {
    for (let i = 0; i < 16; i++) {
      const cx = rng.float(0.2, 0.8);
      const cy = rng.float(0.2, 0.8);
      radial(x, S2, [[0, `rgba(18,26,20,${rng.float(0.35, 0.7)})`], [1, 'rgba(18,26,20,0)']], cx, cy, rng.float(0.05, 0.2));
    }
  });

  // 11 GLASS_STAR — radiating fracture star
  draw(DECAL.GLASS_STAR, (x, S2, rng) => {
    x.strokeStyle = 'rgba(226,244,250,0.65)';
    for (let i = 0; i < 14; i++) {
      const a = rng.float(0, Math.PI * 2);
      x.lineWidth = rng.float(1, 3);
      x.beginPath();
      x.moveTo(S2 / 2, S2 / 2);
      let px = S2 / 2;
      let py = S2 / 2;
      const steps = 4;
      for (let s = 0; s < steps; s++) {
        px += Math.cos(a + rng.float(-0.35, 0.35)) * S2 * 0.11;
        py += Math.sin(a + rng.float(-0.35, 0.35)) * S2 * 0.11;
        x.lineTo(px, py);
      }
      x.stroke();
    }
    radial(x, S2, [[0, 'rgba(240,252,255,0.5)'], [1, 'rgba(240,252,255,0)']], 0.5, 0.5, 0.12);
  });

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function branchCracks(ctx, S, rng, count) {
  ctx.strokeStyle = 'rgba(10,10,10,0.8)';
  for (let i = 0; i < count; i++) {
    let a = rng.float(0, Math.PI * 2);
    let x = S / 2;
    let y = S / 2;
    ctx.lineWidth = rng.float(1.5, 4);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = rng.int(4, 8);
    for (let s = 0; s < steps; s++) {
      a += rng.float(-0.5, 0.5);
      x += Math.cos(a) * S * rng.float(0.05, 0.11);
      y += Math.sin(a) * S * rng.float(0.05, 0.11);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** 1x1 stand-in bound to the depth sampler until a real depth texture arrives. */
export function makeDummyDepth() {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}
