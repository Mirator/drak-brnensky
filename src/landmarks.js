import * as THREE from 'three';
import { mergeAll, gableRoof } from './geometry.js';

/**
 * Hand-modelled Brno landmarks, built from primitives and merged per material.
 * Everything solid is mirrored into the collision world so you can climb the
 * Špilberk terraces or take cover behind Petrov's buttresses.
 */

class Builder {
  constructor(collision) {
    this.collision = collision;
    this.buckets = new Map();
  }
  _push(mat, geo) {
    let arr = this.buckets.get(mat);
    if (!arr) this.buckets.set(mat, (arr = []));
    arr.push(geo);
  }
  /** Axis-aligned box. y is the BOTTOM. */
  box(mat, x, y, z, w, h, d, opts = {}) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (opts.solid !== false) {
      const rot = opts.rotY || 0;
      const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
      this.collision.add(x, z, w * c + d * s, w * s + d * c, y, h, opts.tag || 'landmark');
    }
    return g;
  }
  cyl(mat, x, y, z, rTop, rBot, h, seg = 12, opts = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (opts.solid) this.collision.add(x, z, rBot * 2, rBot * 2, y, h, opts.tag || 'landmark');
    return g;
  }
  cone(mat, x, y, z, r, h, seg = 8, opts = {}) {
    const g = new THREE.ConeGeometry(r, h, seg);
    if (opts.rotY) g.rotateY(opts.rotY);
    g.translate(x, y + h / 2, z);
    this._push(mat, g);
    if (opts.solid) this.collision.add(x, z, r * 1.7, r * 1.7, y, h, opts.tag || 'landmark');
    return g;
  }
  sphere(mat, x, y, z, r, opts = {}) {
    const g = new THREE.SphereGeometry(r, opts.seg || 12, opts.seg2 || 8, 0, Math.PI * 2, 0, opts.phi || Math.PI);
    g.translate(x, y, z);
    this._push(mat, g);
    return g;
  }
  raw(mat, geo) { this._push(mat, geo); }
  /**
   * Collision-only ring: a round basin should stop you walking into the water
   * without turning the whole square into one solid block (which also traps
   * anything trying to walk past it).
   */
  collisionRing(x, z, radius, thickness, y, h, seg = 10) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = x + Math.cos(a) * radius;
      const cz = z + Math.sin(a) * radius;
      const w = Math.max(thickness, (Math.PI * 2 * radius) / seg * 0.62);
      this.collision.add(cx, cz, Math.abs(Math.cos(a)) * thickness + Math.abs(Math.sin(a)) * w,
        Math.abs(Math.sin(a)) * thickness + Math.abs(Math.cos(a)) * w, y, h, 'prop');
    }
  }
  /** Disc facing along ±Z (rose windows, clock faces). */
  discZ(mat, x, y, z, r, thick = 0.35, seg = 20) {
    const g = new THREE.CylinderGeometry(r, r, thick, seg);
    g.rotateX(Math.PI / 2);
    g.translate(x, y, z);
    this._push(mat, g);
    return g;
  }
  /**
   * Terraced mound. Each ring rises by `rise`, which must stay under the
   * player's step height (0.7 m) so the whole hill is walkable from any side —
   * far more robust than a single stair flight you can miss.
   */
  mound(matLow, matHigh, cx, cz, sizeOuter, sizeInner, height, rise = 0.55) {
    const rings = Math.max(2, Math.round(height / rise));
    for (let i = 0; i < rings; i++) {
      const t = i / (rings - 1);
      const size = sizeOuter + (sizeInner - sizeOuter) * t;
      const y = i * (height / rings);
      this.box(t > 0.62 ? matHigh : matLow, cx, y, cz, size, height / rings + 0.04, size, { tag: 'terrain' });
    }
  }
  /** Steps you can walk up: n treads of `rise` height. */
  stairs(mat, x, y, z, w, dirX, dirZ, n, rise = 0.42, run = 0.55) {
    for (let i = 0; i < n; i++) {
      const px = x + dirX * i * run;
      const pz = z + dirZ * i * run;
      const h = y + (i + 1) * rise;
      const bw = dirX ? run + 0.02 : w;
      const bd = dirX ? w : run + 0.02;
      this.box(mat, px, 0, pz, bw, h, bd, { tag: 'stairs' });
    }
  }
  finish(group, opts = {}) {
    for (const [mat, geos] of this.buckets) {
      if (!geos.length) continue;
      const merged = mergeAll(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
    this.buckets.clear();
  }
}

export function buildLandmarks(group, collision, { stoneMat, roofMat, rng }) {
  const M = {
    stone: stoneMat,
    darkStone: new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.92 }),
    sandstone: new THREE.MeshStandardMaterial({ color: 0xa89678, roughness: 0.9 }),
    roof: roofMat,
    slate: new THREE.MeshStandardMaterial({ color: 0x2f3338, roughness: 0.7, metalness: 0.15 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x4e8f7a, roughness: 0.55, metalness: 0.5 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd9a828, roughness: 0.28, metalness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x1a2b38, roughness: 0.08, metalness: 0.7, emissive: 0x24445c, emissiveIntensity: 1.1,
    }),
    litGlass: new THREE.MeshStandardMaterial({
      color: 0x2a1d0e, emissive: 0xffab52, emissiveIntensity: 0.9, roughness: 0.55,
    }),
    metal: new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.5, metalness: 0.75 }),
    granite: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.16, metalness: 0.35 }),
    doorway: new THREE.MeshStandardMaterial({
      color: 0x3a2418, roughness: 0.85, emissive: 0x2a1204, emissiveIntensity: 1.2,
    }),
    marble: new THREE.MeshStandardMaterial({ color: 0xdcd6c8, roughness: 0.5 }),
    shelterGlass: new THREE.MeshStandardMaterial({
      color: 0x2a3a44, roughness: 0.14, metalness: 0.45, transparent: true, opacity: 0.55,
      emissive: 0x0e1c26, emissiveIntensity: 1,
    }),
    grass: new THREE.MeshStandardMaterial({ color: 0x3e5c33, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({
      color: 0x2a6070, roughness: 0.05, metalness: 0.35, transparent: true, opacity: 0.8,
      emissive: 0x0d2a33, emissiveIntensity: 1,
    }),
    brick: new THREE.MeshStandardMaterial({ color: 0x7a4a3a, roughness: 0.95 }),
    canvasRed: new THREE.MeshStandardMaterial({ color: 0xa8342e, roughness: 0.85 }),
    canvasGreen: new THREE.MeshStandardMaterial({ color: 0x2f6b48, roughness: 0.85 }),
    dragonSkin: new THREE.MeshStandardMaterial({
      color: 0x66753f, roughness: 0.75, flatShading: true,
      emissive: 0x24290f, emissiveIntensity: 0.9,
    }),
  };

  const b = new Builder(collision);
  const info = {};
  const animated = [];

  /* ================= PETROV — Cathedral of St Peter & Paul ============== */
  {
    const cx = -108, cz = 172;
    // the hill: shallow terraces you can walk up from any side
    b.mound(M.grass, M.darkStone, cx, cz + 4, 110, 76, 6.6, 0.55);
    // balustrade along the terrace edge
    for (let i = -34; i <= 34; i += 4) {
      b.box(M.stone, cx + i, 6.6, cz - 25, 3.4, 1.1, 0.6, { solid: i % 8 === 0 });
    }

    const baseY = 6.6;
    // nave
    b.box(M.stone, cx, baseY, cz + 6, 22, 21, 44);
    // side aisles
    b.box(M.stone, cx - 13.5, baseY, cz + 6, 6, 13, 40);
    b.box(M.stone, cx + 13.5, baseY, cz + 6, 6, 13, 40);
    // apse
    b.cyl(M.stone, cx, baseY, cz + 29, 8, 8, 17, 10, { solid: true });
    b.cone(M.roof, cx, baseY + 17, cz + 29, 8.6, 7, 10);
    // nave roof
    b.raw(M.roof, gable(22.6, 44.6, 8, cx, baseY + 21, cz + 6));
    b.raw(M.roof, gable(6.4, 40.4, 2.6, cx - 13.5, baseY + 13, cz + 6));
    b.raw(M.roof, gable(6.4, 40.4, 2.6, cx + 13.5, baseY + 13, cz + 6));
    // buttresses
    for (let i = -16; i <= 16; i += 8) {
      for (const s of [-1, 1]) {
        b.box(M.stone, cx + s * 17.4, baseY, cz + 6 + i, 2.6, 12, 2.2);
        b.cone(M.slate, cx + s * 17.4, baseY + 12, cz + 6 + i, 1.8, 2.4, 4);
      }
    }
    // gothic windows (glowing at dusk)
    for (let i = -14; i <= 14; i += 7) {
      for (const s of [-1, 1]) {
        b.box(M.litGlass, cx + s * 16.65, baseY + 3.5, cz + 6 + i, 0.3, 6.4, 1.3, { solid: false });
      }
    }
    // west front: two towers with the famous 84 m neo-gothic spires
    for (const s of [-1, 1]) {
      const tx = cx + s * 7.5, tz = cz - 18;
      b.box(M.stone, tx, baseY, tz, 11, 40, 11);
      b.box(M.darkStone, tx, baseY + 40, tz, 12, 1.4, 12);
      // octagonal belfry
      b.cyl(M.stone, tx, baseY + 41.4, tz, 4.4, 5.0, 9, 8, { solid: true });
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.box(M.litGlass, tx + Math.cos(a) * 4.4, baseY + 43.5, tz + Math.sin(a) * 4.4, 1.1, 3.4, 1.1,
          { solid: false, rotY: -a });
      }
      // spire
      b.cone(M.slate, tx, baseY + 50.4, tz, 5.1, 26, 8);
      b.cyl(M.gold, tx, baseY + 76, tz, 0.12, 0.12, 3, 6);
      b.sphere(M.gold, tx, baseY + 79.4, tz, 0.5);
      // pinnacles
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        b.cone(M.slate, tx + ox * 5.2, baseY + 41.4, tz + oz * 5.2, 1.1, 6.5, 4);
      }
      // window bands up the tower
      for (let f = 0; f < 5; f++) {
        b.box(M.litGlass, tx, baseY + 6 + f * 7, tz - 5.6, 1.3, 3.6, 0.3, { solid: false });
      }
    }
    // rose window over the portal, with radial stone tracery
    b.discZ(M.darkStone, cx, baseY + 24, cz - 24.1, 3.3, 0.4, 20);
    b.discZ(M.litGlass, cx, baseY + 24, cz - 24.45, 2.7, 0.3, 20);
    for (let k = 0; k < 6; k++) {
      const spoke = new THREE.BoxGeometry(5.4, 0.26, 0.3);
      spoke.rotateZ((k / 6) * Math.PI);
      spoke.translate(cx, baseY + 24, cz - 24.62);
      b.raw(M.darkStone, spoke);
    }
    b.discZ(M.darkStone, cx, baseY + 24, cz - 24.7, 0.75, 0.3, 12);
    // portal
    b.box(M.darkStone, cx, baseY, cz - 24.6, 7, 9, 1.6, { solid: false });
    b.box(M.doorway, cx, baseY, cz - 25.2, 5, 7.6, 0.8, { solid: false });

    info.petrov = { name: 'Katedrála na Petrově', pos: new THREE.Vector3(cx, baseY, cz - 16), radius: 34, top: baseY + 80 };
  }

  /* ================= ŠPILBERK — castle on the hill ===================== */
  {
    const cx = -268, cz = 44;
    // the castle hill: 15 m of shallow terraces, walkable from every side
    b.mound(M.grass, M.darkStone, cx, cz, 158, 76, 15, 0.55);

    // bastion walls with crenellations — the east wall is split to leave a
    // gateway you can actually walk through
    const wallY = 15.0;
    for (const [dx, dz, w, d] of [
      [0, -36, 74, 3], [0, 36, 74, 3], [-36, 0, 3, 74],
      [36, -18.25, 3, 36.5], [36, 22.25, 3, 28.5],
    ]) {
      b.box(M.darkStone, cx + dx, wallY, cz + dz, w, 6.5, d);
      const along = w > d;
      for (let i = -(along ? w : d) / 2 + 2; i < (along ? w : d) / 2; i += 4) {
        b.box(M.stone, cx + dx + (along ? i : 0), wallY + 6.5, cz + dz + (along ? 0 : i),
          along ? 2.2 : w + 0.4, 1.4, along ? d + 0.4 : 2.2, { solid: false });
      }
    }
    // corner bastions
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.cyl(M.darkStone, cx + sx * 36, wallY - 1, cz + sz * 36, 6.5, 7.5, 9, 8, { solid: true });
      b.cyl(M.stone, cx + sx * 36, wallY + 8, cz + sz * 36, 7.0, 7.0, 1.2, 8, { solid: false });
    }
    // gatehouse: two piers with a lintel high enough to walk under
    for (const dz of [-0.6, 8.6]) {
      b.box(M.darkStone, cx + 36.5, wallY, cz + dz, 6, 11, 3.4);
      b.cone(M.slate, cx + 36.5, wallY + 11, cz + dz, 2.4, 3, 4);
    }
    b.box(M.darkStone, cx + 36.5, wallY + 4.6, cz + 4, 6, 6.4, 6.4);
    b.box(M.doorway, cx + 33.4, wallY, cz + 4, 0.5, 4.6, 5.6, { solid: false });

    // four wings around a courtyard
    const cyy = 15.0;
    for (const [dx, dz, w, d] of [[0, -24, 60, 14], [0, 24, 60, 14], [-24, 0, 14, 36], [24, 0, 14, 36]]) {
      b.box(M.sandstone, cx + dx, cyy, cz + dz, w, 15, d);
      b.raw(M.roof, gable(w + 1, d + 1, 4.5, cx + dx, cyy + 15, cz + dz));
      // windows
      const along = w > d;
      for (let i = -(along ? w : d) / 2 + 5; i < (along ? w : d) / 2 - 3; i += 5) {
        for (let f = 0; f < 3; f++) {
          const wx = cx + dx + (along ? i : (dx > 0 ? w / 2 + 0.2 : -w / 2 - 0.2));
          const wz = cz + dz + (along ? (dz > 0 ? d / 2 + 0.2 : -d / 2 - 0.2) : i);
          b.box(M.litGlass, wx, cyy + 2.4 + f * 4.4, wz, along ? 1.1 : 0.3, 2.0, along ? 0.3 : 1.1, { solid: false });
        }
      }
    }
    // watchtower
    b.box(M.sandstone, cx - 24, cyy + 15, cz - 24, 13, 14, 13);
    b.box(M.darkStone, cx - 24, cyy + 29, cz - 24, 14.4, 1.2, 14.4);
    b.cyl(M.copper, cx - 24, cyy + 30.2, cz - 24, 3.6, 5.2, 4.2, 8, {});
    b.cone(M.copper, cx - 24, cyy + 34.4, cz - 24, 5.4, 9, 8);
    b.cyl(M.gold, cx - 24, cyy + 43.4, cz - 24, 0.1, 0.1, 2.4, 6);
    // clock face
    b.discZ(M.marble, cx - 24, cyy + 22, cz - 31.2, 2.0, 0.3, 16);
    b.box(M.granite, cx - 24, cyy + 21.9, cz - 31.4, 0.16, 1.4, 0.1, { solid: false });

    info.spilberk = { name: 'Hrad Špilberk', pos: new THREE.Vector3(cx, 15, cz), radius: 46, top: 60 };
  }

  /* ================= STARÁ RADNICE — old town hall + the Dragon ========= */
  {
    const cx = -18, cz = 44;
    b.box(M.sandstone, cx, 0, cz, 26, 16, 18);
    b.raw(M.roof, gable(27, 19, 6, cx, 16, cz));
    // tower
    b.box(M.sandstone, cx + 7, 0, cz - 3, 9.5, 34, 9.5);
    b.box(M.darkStone, cx + 7, 34, cz - 3, 11, 1.6, 11);
    b.cyl(M.copper, cx + 7, 35.6, cz - 3, 3.2, 4.6, 5, 8, {});
    b.cone(M.copper, cx + 7, 40.6, cz - 3, 4.8, 20, 8);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.cone(M.copper, cx + 7 + ox * 4.6, 35.6, cz - 3 + oz * 4.6, 1.2, 6, 6);
    }
    b.cyl(M.gold, cx + 7, 60.6, cz - 3, 0.1, 0.1, 3, 6);
    for (let f = 0; f < 6; f++) {
      b.box(M.litGlass, cx + 7, 4 + f * 5, cz - 7.9, 1.2, 2.2, 0.3, { solid: false });
    }
    // gothic portal (Pilgram's)
    b.box(M.darkStone, cx - 6, 0, cz - 9.4, 8, 11, 1.4, { solid: false });
    b.box(M.doorway, cx - 6, 0, cz - 10.1, 4.6, 8, 0.7, { solid: false });
    for (let i = 0; i < 5; i++) {
      b.cone(M.darkStone, cx - 10.5 + i * 2.25, 11, cz - 9.6, 0.55, 3.2 + (i === 2 ? 2 : 0), 4);
    }

    // THE BRNO DRAGON — the stuffed crocodile hanging in the passage
    const dragon = new THREE.Group();
    const dm = M.dragonSkin;
    const segs = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const r = 0.55 * (1 - t * 0.75) + 0.12;
      const g = new THREE.BoxGeometry(r * 2, r * 1.5, 0.75);
      g.translate(0, 0, i * 0.72);
      segs.push(g);
      // spine ridge
      const sp = new THREE.ConeGeometry(0.16, 0.4, 4);
      sp.translate(0, r * 0.9, i * 0.72);
      segs.push(sp);
    }
    // head
    const head = new THREE.BoxGeometry(1.15, 0.62, 1.9);
    head.translate(0, 0.05, -1.1);
    segs.push(head);
    const jaw = new THREE.BoxGeometry(1.0, 0.3, 1.7);
    jaw.translate(0, -0.42, -1.2);
    segs.push(jaw);
    for (let i = 0; i < 6; i++) {
      const th = new THREE.ConeGeometry(0.08, 0.3, 4);
      th.rotateX(Math.PI);
      th.translate(-0.35 + (i % 3) * 0.35, -0.18, -0.5 - Math.floor(i / 3) * 0.6);
      segs.push(th);
    }
    // legs
    for (const [sx, sz] of [[-1, 0.9], [1, 0.9], [-1, 4.1], [1, 4.1]]) {
      const leg = new THREE.BoxGeometry(0.28, 0.9, 0.32);
      leg.translate(sx * 0.62, -0.45, sz);
      segs.push(leg);
    }
    const dragonMesh = new THREE.Mesh(mergeAll(segs), dm);
    dragonMesh.castShadow = true;
    dragon.add(dragonMesh);
    // eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3b1f, emissive: 0xff2a10, emissiveIntensity: 3 });
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), eyeMat);
      eye.position.set(s * 0.36, 0.24, -1.75);
      dragon.add(eye);
    }
    // chains
    const chainMat = M.metal;
    for (const z of [0.5, 4.2]) {
      const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5), chainMat);
      ch.position.set(0, 1.9, z);
      dragon.add(ch);
    }
    dragon.position.set(cx - 6, 5.6, cz - 10.6);
    dragon.rotation.y = Math.PI / 2 + 0.12; // hangs broadside, like the real one
    dragon.scale.setScalar(1.35);
    // iron bracket it hangs from
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.3, 0.3), M.metal);
    bracket.position.set(cx - 6, 7.9, cz - 10.6);
    group.add(bracket);
    group.add(dragon);
    animated.push({ obj: dragon, kind: 'sway', base: dragon.position.y });

    // the Brno Wheel leaning against the wall
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.14, 6, 20), M.brick);
    wheel.add(rim);
    for (let i = 0; i < 10; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), M.brick);
      sp.rotation.z = (i / 10) * Math.PI;
      wheel.add(sp);
    }
    wheel.position.set(cx + 13.6, 1.6, cz - 8.6);
    wheel.rotation.set(0.22, 0.1, 0.1);
    group.add(wheel);

    info.radnice = { name: 'Stará radnice', pos: new THREE.Vector3(cx, 0, cz - 12), radius: 22, top: 61 };
  }

  /* ================= NÁM. SVOBODY — clock, column, tram stop =========== */
  {
    // The "Brno astronomical clock" — a 6 m black granite bullet.
    const clockPts = [];
    for (let i = 0; i <= 22; i++) {
      const t = i / 22;
      const y = t * 6;
      const r = 0.95 * Math.sin(Math.PI * (0.12 + t * 0.83)) * (1 - t * 0.28) + 0.06;
      clockPts.push(new THREE.Vector2(Math.max(0.05, r), y));
    }
    const lathe = new THREE.LatheGeometry(clockPts, 24);
    lathe.translate(0, 0.4, -52);
    b.raw(M.granite, lathe);
    b.cyl(M.granite, 0, 0, -52, 1.6, 1.9, 0.4, 24, { solid: true });
    collision.add(0, -52, 2.0, 2.0, 0, 6.4, 'landmark');
    // the marble ball slot
    b.sphere(M.marble, 0.6, 4.0, -52.6, 0.14);

    // Marian plague column
    b.box(M.stone, 0, 0, 22, 5.4, 1.2, 5.4);
    b.box(M.stone, 0, 1.2, 22, 3.8, 1.6, 3.8);
    b.cyl(M.marble, 0, 2.8, 22, 0.58, 0.74, 7.2, 14, { solid: true });
    b.cyl(M.marble, 0, 10.0, 22, 0.95, 0.72, 0.6, 14, {});
    b.cyl(M.marble, 0, 10.6, 22, 0.5, 0.9, 0.5, 14, {});
    b.cyl(M.gold, 0, 11.1, 22, 0.3, 0.42, 2.0, 8, {});
    b.sphere(M.gold, 0, 13.5, 22, 0.46);
    // corner statues
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.cyl(M.marble, sx * 2.1, 1.2, 22 + sz * 2.1, 0.35, 0.5, 2.6, 8, {});
      b.sphere(M.marble, sx * 2.1, 4.1, 22 + sz * 2.1, 0.34);
    }

    // tram shelters: glazed panels with mullions, not one big blue slab
    for (const [sx, sz] of [[-22, -30], [20, 8]]) {
      b.box(M.metal, sx, 0, sz, 9, 0.22, 3.4, { solid: false });
      for (let i = -1; i <= 1; i++) {
        b.box(M.shelterGlass, sx + i * 2.9, 0.3, sz - 1.6, 2.55, 2.3, 0.08, { solid: false });
        b.box(M.metal, sx + i * 2.9 + 1.45, 0.3, sz - 1.6, 0.12, 2.5, 0.16, { solid: false });
      }
      collision.add(sx, sz - 1.6, 9, 0.45, 0, 2.6, 'prop'); // the back wall is solid
      b.box(M.metal, sx, 2.6, sz, 9.6, 0.26, 4, { solid: false });
      for (const c of [-4.3, 4.3]) b.cyl(M.metal, sx + c, 0, sz + 1.5, 0.1, 0.1, 2.7, 6, {});
      b.box(M.litGlass, sx + 3.2, 0.8, sz - 1.5, 1.4, 1.0, 0.1, { solid: false });
    }

    info.svoboda = { name: 'Náměstí Svobody', pos: new THREE.Vector3(0, 0, -20), radius: 40, top: 6 };
  }

  /* ================= ZELNÝ TRH — Parnas fountain + market =============== */
  {
    const cx = -52, cz = 78;
    // basin
    b.cyl(M.darkStone, cx, 0, cz, 7.4, 7.8, 0.9, 20, {});
    b.collisionRing(cx, cz, 7.4, 1.4, 0, 1.0, 12);
    b.cyl(M.water, cx, 0.6, cz, 6.8, 6.8, 0.35, 20, {});
    // rocky grotto
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = 2.6 + rng.float(-0.6, 0.9);
      const g = new THREE.IcosahedronGeometry(rng.float(1.1, 2.1), 0);
      g.translate(cx + Math.cos(a) * r, rng.float(1.2, 2.4), cz + Math.sin(a) * r);
      b.raw(M.darkStone, g);
    }
    const grotto = new THREE.IcosahedronGeometry(3.4, 1);
    grotto.scale(1, 0.85, 1);
    grotto.translate(cx, 2.6, cz);
    b.raw(M.darkStone, grotto);
    collision.add(cx, cz, 6.4, 6.4, 0, 3.2, 'landmark');
    // allegory of Europe on top
    b.cyl(M.marble, cx, 4.6, cz, 0.5, 0.7, 2.6, 8, {});
    b.sphere(M.marble, cx, 7.5, cz, 0.45);
    b.cyl(M.gold, cx + 0.6, 6.2, cz, 0.07, 0.07, 1.8, 6, { rotY: 0.3 });

    // market stalls
    for (let i = 0; i < 14; i++) {
      const sx = cx + rng.float(-24, 24);
      const sz = cz + rng.float(-19, 19);
      if (Math.hypot(sx - cx, sz - cz) < 11) continue;
      const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
      b.box(M.metal, sx, 0, sz, 3.2, 0.9, 2.2, { rotY: rot });
      b.box(rng.chance(0.5) ? M.canvasRed : M.canvasGreen, sx, 2.1, sz, 3.8, 0.3, 2.8, { rotY: rot, solid: false });
      for (const [ox, oz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) {
        const px = rot ? oz : ox, pz = rot ? ox : oz;
        b.cyl(M.metal, sx + px, 0.9, sz + pz, 0.05, 0.05, 1.2, 5, {});
      }
      // produce crates
      for (let k = 0; k < 3; k++) {
        b.box(M.brick, sx + rng.float(-1.2, 1.2), 0.9, sz + rng.float(-0.7, 0.7), 0.7, 0.4, 0.5, { solid: false });
      }
    }

    info.zelnyTrh = { name: 'Zelný trh', pos: new THREE.Vector3(cx, 0, cz), radius: 30, top: 8 };
  }

  /* ================= MORAVSKÉ NÁM. — park + Jošt statue ================ */
  {
    const cx = 18, cz = -136;
    // pedestal
    b.box(M.granite, cx, 0, cz, 7, 2.2, 5);
    b.box(M.granite, cx, 2.2, cz, 5.4, 1.0, 3.6);
    // horse (very stylised)
    const horse = [];
    const body = new THREE.BoxGeometry(1.5, 1.8, 4.4);
    body.translate(0, 3.2, 0);
    horse.push(body);
    const neck = new THREE.BoxGeometry(1.0, 2.0, 1.2);
    neck.rotateX(-0.4);
    neck.translate(0, 4.4, -1.9);
    horse.push(neck);
    const hhead = new THREE.BoxGeometry(0.8, 0.8, 1.8);
    hhead.rotateX(0.5);
    hhead.translate(0, 5.3, -2.7);
    horse.push(hhead);
    for (const [sx, sz, lean] of [[-1, 1.6, 0.2], [1, 1.6, 0.2], [-1, -1.5, -0.5], [1, -1.5, -0.5]]) {
      const leg = new THREE.BoxGeometry(0.42, 2.6, 0.5);
      leg.rotateX(lean);
      leg.translate(sx * 0.55, 1.6, sz);
      horse.push(leg);
    }
    // rider
    const torso = new THREE.BoxGeometry(1.0, 1.6, 0.8);
    torso.translate(0, 5.0, 0.1);
    horse.push(torso);
    const rhead = new THREE.SphereGeometry(0.42, 10, 8);
    rhead.translate(0, 6.1, 0.1);
    horse.push(rhead);
    const lance = new THREE.CylinderGeometry(0.07, 0.07, 6, 6);
    lance.rotateX(0.5);
    lance.translate(0.6, 6.4, 0.6);
    horse.push(lance);
    const g = mergeAll(horse);
    g.translate(cx, 3.2, cz);
    b.raw(M.copper, g);
    collision.add(cx, cz, 7, 5, 0, 4, 'landmark');
    info.moravske = { name: 'Moravské náměstí', pos: new THREE.Vector3(cx, 0, cz), radius: 34, top: 10 };
  }

  /* ================= JANÁČKOVO DIVADLO — modernist glass box =========== */
  {
    const cx = 112, cz = -172;
    b.box(M.marble, cx, 0, cz, 62, 1.2, 40, { tag: 'terrain' });
    b.box(M.glass, cx, 1.2, cz, 52, 17, 30);
    // vertical fins
    for (let i = -25; i <= 25; i += 2.6) {
      b.box(M.marble, cx + i, 1.2, cz - 15.2, 0.5, 17, 0.7, { solid: false });
    }
    b.box(M.marble, cx, 18.2, cz, 54, 2.2, 32);
    b.box(M.slate, cx, 20.4, cz, 40, 9, 22);
    // fly tower
    b.box(M.marble, cx, 29.4, cz + 2, 30, 3, 16);
    // fountain plaza in front
    b.cyl(M.darkStone, cx, 0, cz - 26, 8.6, 9, 0.8, 24, {});
    b.collisionRing(cx, cz - 26, 8.6, 1.4, 0, 0.9, 12);
    b.cyl(M.water, cx, 0.5, cz - 26, 8.1, 8.1, 0.4, 24, {});
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      b.cyl(M.water, cx + Math.cos(a) * 5.5, 0.9, cz - 26 + Math.sin(a) * 5.5, 0.1, 0.16, 2.6, 6, {});
    }
    info.janacek = { name: 'Janáčkovo divadlo', pos: new THREE.Vector3(cx, 0, cz - 22), radius: 34, top: 32 };
  }

  /* ================= MAHENOVO DIVADLO — neo-baroque ==================== */
  {
    const cx = 104, cz = -66;
    b.box(M.marble, cx, 0, cz, 38, 1.0, 24, { tag: 'terrain' });
    b.box(M.sandstone, cx, 1.0, cz, 30, 16, 18);
    b.box(M.sandstone, cx, 1.0, cz - 10.5, 20, 13, 4);
    // portico columns
    for (let i = -4; i <= 4; i++) {
      b.cyl(M.marble, cx + i * 2.3, 1.0, cz - 13.2, 0.5, 0.58, 11, 10, { solid: i % 2 === 0 });
      b.box(M.marble, cx + i * 2.3, 12.0, cz - 13.2, 1.5, 0.5, 1.5, { solid: false });
    }
    b.box(M.marble, cx, 12.5, cz - 13.2, 22, 1.6, 4.2, { solid: false });
    b.raw(M.roof, gable(31, 19, 5, cx, 17, cz));
    // dome
    b.cyl(M.copper, cx, 17, cz, 5.4, 6.2, 3, 16, {});
    b.sphere(M.copper, cx, 20, cz, 5.6, { phi: Math.PI / 2, seg: 20, seg2: 12 });
    b.cyl(M.gold, cx, 25.4, cz, 0.09, 0.09, 2.6, 6);
    // statues on the parapet
    for (const ox of [-9, 0, 9]) {
      b.cyl(M.marble, cx + ox, 14.1, cz - 13.2, 0.32, 0.42, 2.2, 8, {});
      b.sphere(M.marble, cx + ox, 16.5, cz - 13.2, 0.3);
    }
    for (let f = 0; f < 3; f++) {
      for (let i = -3; i <= 3; i++) {
        b.box(M.litGlass, cx + i * 4, 3 + f * 4.6, cz + 9.2, 1.3, 2.4, 0.3, { solid: false });
      }
    }
    info.mahen = { name: 'Mahenovo divadlo', pos: new THREE.Vector3(cx, 0, cz - 16), radius: 24, top: 26 };
  }

  /* ================= HLAVNÍ NÁDRAŽÍ — main station ===================== */
  {
    const cx = 22, cz = 292;
    b.box(M.sandstone, cx, 0, cz, 130, 18, 26);
    b.raw(M.roof, gable(131, 27, 6, cx, 18, cz));
    // clock tower over the entrance
    b.box(M.sandstone, cx, 0, cz - 15, 18, 24, 10);
    b.cyl(M.copper, cx, 24, cz - 15, 4.4, 6.2, 3.4, 8, {});
    b.cone(M.copper, cx, 27.4, cz - 15, 6.4, 10, 8);
    b.discZ(M.marble, cx, 17, cz - 20.2, 2.6, 0.4, 20);
    // arcade
    for (let i = -6; i <= 6; i++) {
      b.box(M.darkStone, cx + i * 9, 0, cz - 13.4, 5, 9, 1.2, { solid: i % 2 === 0 });
      b.box(M.litGlass, cx + i * 9, 0.5, cz - 14.1, 2.6, 6.4, 0.4, { solid: false });
    }
    // platform canopies (behind the hall)
    for (let p = 0; p < 4; p++) {
      const pz = cz + 20 + p * 13;
      b.box(M.metal, cx, 5.4, pz, 120, 0.5, 9, { solid: false });
      for (let i = -55; i <= 55; i += 11) b.cyl(M.metal, cx + i, 0, pz, 0.16, 0.2, 5.4, 6, { solid: true });
      b.box(M.darkStone, cx, 0, pz, 120, 0.6, 8, { tag: 'terrain' });
      // rails
      b.box(M.metal, cx, 0, pz + 6.5, 122, 0.2, 0.16, { solid: false });
      b.box(M.metal, cx, 0, pz + 8.0, 122, 0.2, 0.16, { solid: false });
    }
    info.nadrazi = { name: 'Hlavní nádraží', pos: new THREE.Vector3(cx, 0, cz - 24), radius: 44, top: 38 };
  }

  /* ================= ČESKÁ — a couple of arcade blocks ================= */
  {
    const cx = -66, cz = -96;
    b.box(M.sandstone, cx - 14, 0, cz + 6, 18, 22, 16);
    b.raw(M.roof, gable(19, 17, 6, cx - 14, 22, cz + 6));
    b.box(M.sandstone, cx + 12, 0, cz - 4, 16, 26, 14);
    b.raw(M.roof, gable(17, 15, 7, cx + 12, 26, cz - 4));
    info.ceska = { name: 'Česká', pos: new THREE.Vector3(cx, 0, cz), radius: 20, top: 26 };
  }

  b.finish(group);

  return {
    info,
    animated,
    update(dt, t) {
      for (const a of animated) {
        if (a.kind === 'sway') {
          a.obj.rotation.z = Math.sin(t * 0.7) * 0.05;
          a.obj.position.y = a.base + Math.sin(t * 0.9) * 0.06;
        }
      }
    },
  };
}

/** Positioned gable roof; `y` is the eaves height. */
function gable(w, d, h, x, y, z) {
  const g = gableRoof(w, d, h);
  g.translate(x, y, z);
  return g;
}
