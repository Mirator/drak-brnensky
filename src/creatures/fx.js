import * as THREE from 'three';

/* ==================================================================
   Telegraph and impact effects. Everything here is deterministic — the
   caller passes the manager's dedicated vfx Rng, never Math.random.
   ================================================================== */

const _c = new THREE.Color();

/**
 * A ring of embers on the ground. This is the readable "something is about
 * to land here" marker: it grows through the anticipation of a slam, a
 * buffet or a landing, so the player can simply walk out of it.
 */
export function ring(vfx, rng, x, y, z, radius, colour, count = 14, opts = {}) {
  if (!vfx) return;
  _c.set(colour);
  const inward = opts.inward ? -1 : 1;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng.float(-0.12, 0.12);
    const r = radius * rng.float(0.92, 1.08);
    vfx.emit(
      x + Math.cos(a) * r, y + rng.float(0.02, 0.25), z + Math.sin(a) * r,
      Math.cos(a) * (opts.speed ?? 1.2) * inward,
      rng.float(opts.up ?? 1.2, (opts.up ?? 1.2) + 2.2),
      Math.sin(a) * (opts.speed ?? 1.2) * inward,
      _c, opts.size ?? 0.28, opts.life ?? 0.5, opts.drag ?? 3.2, opts.grav ?? -0.5,
    );
  }
}

/** Dust and grit thrown up by something heavy hitting the ground. */
export function impactDust(vfx, rng, x, y, z, power, colour = 0x8a7a5c) {
  if (!vfx) return;
  _c.set(colour);
  const n = Math.round(8 + power * 6);
  for (let i = 0; i < n; i++) {
    const a = rng.float(0, Math.PI * 2);
    const sp = rng.float(2, 5) * power;
    vfx.emit(
      x + Math.cos(a) * 0.3 * power, y + 0.1, z + Math.sin(a) * 0.3 * power,
      Math.cos(a) * sp, rng.float(0.5, 3.4) * power, Math.sin(a) * sp,
      _c, rng.float(0.25, 0.6) * power, rng.float(0.5, 1.1), 2.6, -1.6,
    );
  }
}

/** Stone chips / scale shards flying off a hit or an armour break. */
export function shards(vfx, rng, x, y, z, count, colour, speed = 6) {
  if (!vfx) return;
  _c.set(colour);
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, Math.PI * 2);
    const el = rng.float(0.1, 1.1);
    vfx.emit(
      x, y, z,
      Math.cos(a) * speed * Math.cos(el), Math.sin(el) * speed, Math.sin(a) * speed * Math.cos(el),
      _c, rng.float(0.14, 0.34), rng.float(0.6, 1.3), 1.6, -3.2,
    );
  }
}

/** Embers being sucked into a mouth or a core as it charges. */
export function intake(vfx, rng, x, y, z, radius, colour = 0xff7a2a, count = 4) {
  if (!vfx) return;
  _c.set(colour);
  for (let i = 0; i < count; i++) {
    const a = rng.float(0, Math.PI * 2);
    const el = rng.float(-0.4, 0.9);
    const px = x + Math.cos(a) * radius * Math.cos(el);
    const py = y + Math.sin(el) * radius;
    const pz = z + Math.sin(a) * radius * Math.cos(el);
    const pull = rng.float(3.5, 7);
    vfx.emit(
      px, py, pz,
      (x - px) * pull * 0.5, (y - py) * pull * 0.5, (z - pz) * pull * 0.5,
      _c, rng.float(0.1, 0.24), rng.float(0.18, 0.34), 0.4, 0,
    );
  }
}

/** A visible arc on the ground for a sweep — tail, backhand, wing. */
export function arc(vfx, rng, x, y, z, radius, from, to, colour, count = 16) {
  if (!vfx) return;
  _c.set(colour);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const a = from + (to - from) * t;
    const r = radius * rng.float(0.85, 1.0);
    vfx.emit(
      x + Math.sin(a) * r, y + rng.float(0.05, 0.4), z + Math.cos(a) * r,
      Math.sin(a) * 2.5, rng.float(1, 3), Math.cos(a) * 2.5,
      _c, rng.float(0.22, 0.45), rng.float(0.3, 0.55), 3, -1,
    );
  }
}
