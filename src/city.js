import * as THREE from 'three';
import { mergeAll, gableRoof } from './geometry.js';
import { Rng } from './rng.js';
import {
  makeFacadeMaterials,
  makeRoofMaterial,
  makeStoneMaterial,
  makeCobbleTexture,
  makeTexture,
  BAY_W,
  FLOOR_H,
} from './textures.js';
import { buildLandmarks } from './landmarks.js';

/* ==================================================================
   MAP LAYOUT — a compressed, playable interpretation of central Brno.
   +x = east, +z = south.  1 unit = 1 metre.
   ================================================================== */
export const MAP_SIZE = 840;
export const HALF = MAP_SIZE / 2;
const GRID_RES = 2;
const GN = MAP_SIZE / GRID_RES; // 420
const TEX_SIZE = 4096;
const MINI_SIZE = 512;

export const FLAG = { FREE: 0, ROAD: 30, PLAZA: 60, PARK: 90, RESERVED: 120, TRACK: 150 };

/** Named places — used for objectives, the compass and the minimap. */
export const PLACES = {
  svoboda: { name: 'nám. Svobody', x: 0, z: -10 },
  zelnyTrh: { name: 'Zelný trh', x: -52, z: 78 },
  radnice: { name: 'Stará radnice', x: -18, z: 44 },
  petrov: { name: 'Petrov', x: -108, z: 168 },
  spilberk: { name: 'Špilberk', x: -268, z: 42 },
  moravske: { name: 'Moravské nám.', x: 18, z: -132 },
  janacek: { name: 'Janáčkovo divadlo', x: 112, z: -170 },
  mahen: { name: 'Mahenovo divadlo', x: 104, z: -66 },
  nadrazi: { name: 'Hlavní nádraží', x: 22, z: 268 },
  ceska: { name: 'Česká', x: -66, z: -96 },
};

/* Main streets. Tram lines are marked so we can draw rails and run trams. */
const ROADS = [
  { name: 'Masarykova', w: 16, tram: true, pts: [[8, 246], [4, 180], [2, 110], [0, 46]] },
  { name: 'Husova', w: 20, tram: false, pts: [[-186, 150], [-176, 60], [-168, -30], [-150, -104]] },
  { name: 'Joštova', w: 18, tram: true, pts: [[-150, -104], [-96, -108], [-40, -112], [10, -120]] },
  { name: 'Rooseveltova', w: 18, tram: true, pts: [[10, -120], [70, -114], [116, -100], [140, -60]] },
  { name: 'Koliště', w: 20, tram: false, pts: [[140, -60], [156, 20], [150, 110], [110, 190]] },
  { name: 'Nádražní', w: 20, tram: true, pts: [[110, 190], [40, 244], [-40, 250], [-120, 240]] },
  { name: 'Nové sady', w: 18, tram: false, pts: [[-120, 240], [-170, 216], [-186, 150]] },
  { name: 'Česká', w: 13, tram: true, pts: [[-24, -64], [-52, -88], [-72, -104]] },
  { name: 'Rašínova', w: 11, tram: false, pts: [[6, -44], [8, -96], [12, -120]] },
  { name: 'Kobližná', w: 12, tram: false, pts: [[26, -22], [70, -26], [112, -34]] },
  { name: 'Orlí', w: 11, tram: false, pts: [[20, 26], [70, 22], [118, 16]] },
  { name: 'Masná', w: 11, tram: false, pts: [[-30, 24], [-30, 70], [-34, 120]] },
  { name: 'Petrská', w: 10, tram: false, pts: [[-52, 100], [-80, 134], [-100, 156]] },
  { name: 'Pekařská', w: 14, tram: true, pts: [[-72, 122], [-124, 112], [-176, 100]] },
  { name: 'Údolní', w: 13, tram: false, pts: [[-176, 40], [-224, 28], [-262, 8]] },
  { name: 'Pellicova', w: 10, tram: false, pts: [[-262, 8], [-268, 70], [-240, 124]] },
  { name: 'Veveří', w: 14, tram: false, pts: [[-150, -104], [-206, -128], [-262, -140]] },
  { name: 'Lidická', w: 16, tram: true, pts: [[18, -132], [26, -200], [30, -280]] },
  { name: 'Milady Horákové', w: 14, tram: false, pts: [[26, -200], [110, -196], [190, -186]] },
  { name: 'Cejl', w: 14, tram: false, pts: [[156, 20], [230, 10], [300, 4]] },
  { name: 'Vídeňská', w: 16, tram: false, pts: [[-40, 250], [-46, 320], [-50, 380]] },
  { name: 'Křenová', w: 14, tram: false, pts: [[110, 190], [190, 214], [270, 230]] },
  { name: 'Hybešova', w: 13, tram: false, pts: [[-120, 240], [-190, 268], [-260, 286]] },
  { name: 'Kounicova', w: 14, tram: false, pts: [[-96, -108], [-104, -180], [-108, -250]] },
  { name: 'Bratislavská', w: 12, tram: false, pts: [[190, -186], [214, -120], [230, 10]] },
  { name: 'Zvonařka', w: 12, tram: false, pts: [[190, 214], [212, 290], [220, 360]] },
  { name: 'Vinohrady', w: 12, tram: false, pts: [[-262, -140], [-320, -170], [-370, -186]] },
  { name: 'Kamenná', w: 12, tram: false, pts: [[-240, 124], [-268, 200], [-290, 280]] },
];

/* Open spaces. Rect = [cx, cz, w, d] */
const PLAZAS = [
  { r: [0, -18, 74, 108], type: FLAG.PLAZA, name: 'svoboda' },
  { r: [-52, 78, 62, 54], type: FLAG.PLAZA, name: 'zelny' },
  { r: [-108, 170, 90, 66], type: FLAG.PLAZA, name: 'petrov' },
  { r: [18, -136, 96, 74], type: FLAG.PARK, name: 'moravske' },
  { r: [112, -168, 86, 62], type: FLAG.PLAZA, name: 'janacek' },
  { r: [104, -64, 54, 42], type: FLAG.PLAZA, name: 'mahen' },
  { r: [22, 262, 130, 56], type: FLAG.PLAZA, name: 'nadrazi' },
  { r: [-268, 44, 132, 132], type: FLAG.PARK, name: 'spilberk' },
  { r: [-18, 46, 34, 26], type: FLAG.PLAZA, name: 'radnice' },
  { r: [-150, -104, 44, 44], type: FLAG.PLAZA, name: 'komenskeho' },
  { r: [200, 120, 96, 80], type: FLAG.PARK, name: 'luzanky' },
  { r: [-330, 300, 130, 110], type: FLAG.PARK, name: 'les-jih' },
  { r: [300, -300, 150, 130], type: FLAG.PARK, name: 'les-sever' },
];

/* Tram routes the little yellow-red trams drive along. */
const TRAM_ROUTES = [
  [[8, 246], [4, 180], [2, 110], [0, 46], [6, -44], [8, -96], [12, -120], [18, -132], [26, -200], [30, -280]],
  [[-150, -104], [-96, -108], [-40, -112], [10, -120], [70, -114], [116, -100], [140, -60]],
  [[-176, 100], [-124, 112], [-72, 122], [-52, 100]],
];

/* ==================================================================
   Painter — draws the city plan into (a) a big pretty ground texture
   and (b) a small flag map we read back as a walkability/build grid.
   ================================================================== */
export class FlagGrid {
  constructor() {
    this.data = new Uint8Array(GN * GN);
  }

  fill(flag) {
    this.data.fill(flag);
  }

  paintBounds(minX, minZ, maxX, maxZ, flag, contains) {
    const x0 = Math.max(0, Math.floor((minX + HALF) / GRID_RES));
    const z0 = Math.max(0, Math.floor((minZ + HALF) / GRID_RES));
    const x1 = Math.min(GN - 1, Math.floor((maxX + HALF) / GRID_RES));
    const z1 = Math.min(GN - 1, Math.floor((maxZ + HALF) / GRID_RES));
    for (let z = z0; z <= z1; z++) {
      const wz = z * GRID_RES - HALF + GRID_RES / 2;
      for (let x = x0; x <= x1; x++) {
        const wx = x * GRID_RES - HALF + GRID_RES / 2;
        if (contains(wx, wz)) this.data[z * GN + x] = flag;
      }
    }
  }

  rect(cx, cz, w, d, flag) {
    const hw = w / 2;
    const hd = d / 2;
    this.paintBounds(cx - hw, cz - hd, cx + hw, cz + hd, flag,
      (x, z) => Math.abs(x - cx) <= hw && Math.abs(z - cz) <= hd);
  }

  line(points, width, flag) {
    const radius = width / 2;
    const radiusSq = radius * radius;
    for (let i = 1; i < points.length; i++) {
      const [ax, az] = points[i - 1];
      const [bx, bz] = points[i];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSq = dx * dx + dz * dz;
      this.paintBounds(
        Math.min(ax, bx) - radius, Math.min(az, bz) - radius,
        Math.max(ax, bx) + radius, Math.max(az, bz) + radius,
        flag,
        (x, z) => {
          const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq));
          const px = ax + t * dx;
          const pz = az + t * dz;
          return (x - px) ** 2 + (z - pz) ** 2 <= radiusSq;
        },
      );
    }
  }

  circle(x, z, radius, flag) {
    const radiusSq = radius * radius;
    this.paintBounds(x - radius, z - radius, x + radius, z + radius, flag,
      (px, pz) => (px - x) ** 2 + (pz - z) ** 2 <= radiusSq);
  }

  copy() {
    return this.data.slice();
  }
}

class Painter {
  constructor() {
    this.pretty = document.createElement('canvas');
    this.pretty.width = this.pretty.height = TEX_SIZE;
    this.pc = this.pretty.getContext('2d');
    this.flags = new FlagGrid();
    this.sP = TEX_SIZE / MAP_SIZE;
  }
  // world -> canvas
  px(x) { return (x + HALF) * this.sP; }

  fill(colour, flag) {
    this.pc.fillStyle = colour;
    this.pc.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    this.flags.fill(flag);
  }

  rect(cx, cz, w, d, colour, flag) {
    this.pc.fillStyle = colour;
    this.pc.fillRect(this.px(cx - w / 2), this.px(cz - d / 2), w * this.sP, d * this.sP);
    if (flag !== undefined) this.flags.rect(cx, cz, w, d, flag);
  }

  line(pts, width, colour, flag, dash = null, cap = 'round') {
    const ctx = this.pc;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width * this.sP;
    ctx.lineJoin = 'round';
    ctx.lineCap = cap;
    if (dash) ctx.setLineDash(dash.map((v) => v * this.sP));
    ctx.beginPath();
    const p0 = pts[0];
    ctx.moveTo(this.px(p0[0]), this.px(p0[1]));
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      ctx.lineTo(this.px(p[0]), this.px(p[1]));
    }
    ctx.stroke();
    ctx.restore();
    if (flag !== undefined) this.flags.line(pts, width, flag);
  }

  circle(x, z, r, colour, flag) {
    this.pc.fillStyle = colour;
    this.pc.beginPath();
    this.pc.arc(this.px(x), this.px(z), r * this.sP, 0, Math.PI * 2);
    this.pc.fill();
    if (flag !== undefined) this.flags.circle(x, z, r, flag);
  }

  readFlags() {
    return this.flags.copy();
  }
}

/* ==================================================================
   buildCity
   ================================================================== */
export function buildCity(scene, collision, rngSeed = 20250726) {
  const rng = new Rng(rngSeed);
  const painter = new Painter();

  /* ---------- 1. paint the ground plan ---------- */
  const pc = painter.pc;
  painter.fill('#3b3a35', FLAG.FREE);

  // organic base grain over the whole city
  for (let i = 0; i < 26000; i++) {
    pc.globalAlpha = rng.float(0.05, 0.14);
    pc.fillStyle = rng.chance(0.5) ? '#2b2a26' : '#4b4941';
    const s = rng.float(6, 40);
    pc.fillRect(rng.float(0, TEX_SIZE), rng.float(0, TEX_SIZE), s, s);
  }
  pc.globalAlpha = 1;

  // ---- parks & plazas
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    if (p.type === FLAG.PARK) {
      painter.rect(cx, cz, w, d, '#3c5a33', FLAG.PARK);
      // meadow mottling + gravel paths
      for (let i = 0; i < 900; i++) {
        pc.globalAlpha = rng.float(0.1, 0.26);
        pc.fillStyle = rng.chance(0.5) ? '#2f4a29' : '#4d6d3c';
        pc.fillRect(
          painter.px(cx - w / 2 + rng.float(0, w)),
          painter.px(cz - d / 2 + rng.float(0, d)),
          rng.float(8, 34),
          rng.float(8, 34),
        );
      }
      pc.globalAlpha = 1;
      painter.line(
        [[cx - w / 2, cz - d / 6], [cx, cz + d / 8], [cx + w / 2, cz - d / 5]],
        3.5, '#8a7f66',
      );
    } else {
      painter.rect(cx, cz, w, d, '#6d665b', FLAG.PLAZA);
      // paving pattern
      pc.save();
      pc.globalAlpha = 0.5;
      pc.strokeStyle = '#585248';
      pc.lineWidth = 1.6;
      const step = 4.5 * painter.sP;
      for (let x = painter.px(cx - w / 2); x < painter.px(cx + w / 2); x += step) {
        pc.beginPath();
        pc.moveTo(x, painter.px(cz - d / 2));
        pc.lineTo(x, painter.px(cz + d / 2));
        pc.stroke();
      }
      for (let z = painter.px(cz - d / 2); z < painter.px(cz + d / 2); z += step) {
        pc.beginPath();
        pc.moveTo(painter.px(cx - w / 2), z);
        pc.lineTo(painter.px(cx + w / 2), z);
        pc.stroke();
      }
      pc.restore();
    }
  }

  // ---- roads
  for (const r of ROADS) {
    painter.line(r.pts, r.w + 5, '#514c44', FLAG.ROAD); // pavement
    painter.line(r.pts, r.w, '#31322f', FLAG.ROAD); // asphalt
    painter.line(r.pts, 0.5, 'rgba(230,225,200,0.55)', undefined, [5, 6]); // centre line
    if (r.tram) {
      // two rails either side of the centre line
      for (const off of [-1.4, 1.4]) {
        const pts = offsetPolyline(r.pts, off);
        painter.line(pts, 0.85, 'rgba(190,196,205,0.65)', undefined, null, 'butt');
        painter.line(pts, 2.6, 'rgba(0,0,0,0.18)', undefined, null, 'butt');
      }
    }
  }

  // ---- crossings at junctions
  for (const r of ROADS) {
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
      pc.save();
      pc.globalAlpha = 0.35;
      pc.fillStyle = '#e8e2cf';
      for (let i = -3; i <= 3; i++) {
        pc.fillRect(painter.px(p[0] + i * 1.6) - 2, painter.px(p[1]) - 12, 4, 24);
      }
      pc.restore();
    }
  }

  /* ---------- 2. reserve landmark footprints ---------- */
  const reserve = [
    [-108, 176, 110, 110], // Petrov cathedral and terraced mound
    [-268, 44, 158, 158], // Špilberk hill
    [-18, 44, 26, 20], // Old town hall
    [112, -172, 62, 40], // Janáček theatre
    [104, -66, 40, 26], // Mahen theatre
    [22, 319, 140, 86], // station hall, platforms, canopies and rails
    [0, -52, 16, 16], // astronomical clock area
  ];
  for (const [x, z, w, d] of reserve) painter.rect(x, z, w, d, 'rgba(0,0,0,0)', FLAG.RESERVED);

  const flags = painter.readFlags();
  const flagAt = (x, z) => {
    const gx = Math.floor((x + HALF) / GRID_RES);
    const gz = Math.floor((z + HALF) / GRID_RES);
    if (gx < 0 || gz < 0 || gx >= GN || gz >= GN) return FLAG.RESERVED;
    return flags[gz * GN + gx];
  };

  /* ---------- 3. place buildings ---------- */
  const occupied = new Uint8Array(GN * GN);
  const buildings = [];

  const stamp = (x0, z0, x1, z1) => {
    const gx0 = Math.max(0, Math.floor((x0 + HALF) / GRID_RES));
    const gx1 = Math.min(GN - 1, Math.ceil((x1 + HALF) / GRID_RES));
    const gz0 = Math.max(0, Math.floor((z0 + HALF) / GRID_RES));
    const gz1 = Math.min(GN - 1, Math.ceil((z1 + HALF) / GRID_RES));
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) occupied[gz * GN + gx] = 1;
  };

  const areaFree = (x0, z0, x1, z1) => {
    const gx0 = Math.floor((x0 + HALF) / GRID_RES);
    const gx1 = Math.ceil((x1 + HALF) / GRID_RES);
    const gz0 = Math.floor((z0 + HALF) / GRID_RES);
    const gz1 = Math.ceil((z1 + HALF) / GRID_RES);
    if (gx0 < 1 || gz0 < 1 || gx1 >= GN - 1 || gz1 >= GN - 1) return false;
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gz * GN + gx;
        if (occupied[i]) return false;
        if (flags[i] !== FLAG.FREE) return false;
      }
    }
    return true;
  };

  const inCore = (x, z) => {
    // rough historic centre: inside the ring road
    return Math.hypot(x * 0.85, (z - 40) * 0.75) < 150;
  };

  // Buildings hug the streets: candidates are sampled along road edges first,
  // then the leftover block interiors get courtyard wings.
  const candidates = [];
  for (const r of ROADS) {
    const step = 9;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i];
      const [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      const n = Math.floor(len / step);
      for (let k = 0; k <= n; k++) {
        const t = k / Math.max(1, n);
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        for (const side of [-1, 1]) {
          const off = r.w / 2 + 5.5;
          candidates.push({ x: x + nx * off * side, z: z + nz * off * side, along: [nx * side, nz * side] });
        }
      }
    }
  }
  // plus a scatter to fill block interiors and the outskirts
  for (let i = 0; i < 5200; i++) {
    candidates.push({ x: rng.float(-HALF + 20, HALF - 20), z: rng.float(-HALF + 20, HALF - 20), along: null });
  }

  for (const cand of candidates) {
    const core = inCore(cand.x, cand.z);
    const rim = Math.max(Math.abs(cand.x), Math.abs(cand.z)) > 330;
    let w = core ? rng.float(11, 21) : rng.float(14, 30);
    let d = core ? rng.float(11, 19) : rng.float(13, 26);
    if (rng.chance(0.3)) { const t = w; w = d; d = t; }
    const x0 = cand.x - w / 2 - 1.2, x1 = cand.x + w / 2 + 1.2;
    const z0 = cand.z - d / 2 - 1.2, z1 = cand.z + d / 2 + 1.2;
    if (!areaFree(x0, z0, x1, z1)) continue;
    stamp(x0, z0, x1, z1);

    let floors;
    if (core) floors = rng.int(3, 6);
    else if (rim) floors = rng.int(6, 13);
    else floors = rng.int(4, 8);
    const h = floors * FLOOR_H;

    buildings.push({
      x: cand.x, z: cand.z, w, d, h,
      style: rng.int(0, 5),
      lit: rng.chance(0.42),
      pitched: core && rng.chance(0.72),
      tower: !core && rng.chance(0.05),
    });
    if (buildings.length > 1400) break;
  }

  /* ---------- 4. build geometry ---------- */
  const facadeMats = makeFacadeMaterials();
  const facadeMatsDark = facadeMats.map((m) => {
    const c = m.clone();
    c.emissiveIntensity = 0.05;
    return c;
  });
  const roofMat = makeRoofMaterial();
  const stoneMat = makeStoneMaterial('#8d8577', '#6e675c', 2);
  const corniceMat = new THREE.MeshStandardMaterial({ color: 0x9c948a, roughness: 0.9 });

  const bucketsLit = facadeMats.map(() => []);
  const bucketsDark = facadeMats.map(() => []);
  const roofGeos = [];
  const corniceGeos = [];

  for (const b of buildings) {
    const g = boxWithTiledUV(b.w, b.h, b.d, rng);
    g.translate(b.x, b.h / 2, b.z);
    (b.lit ? bucketsLit : bucketsDark)[b.style].push(g);

    // cornice ring just under the roof
    const cg = new THREE.BoxGeometry(b.w + 0.9, 0.75, b.d + 0.9);
    cg.translate(b.x, b.h - 0.3, b.z);
    corniceGeos.push(cg);

    if (b.pitched) {
      const rg = gableRoof(b.w + 1.0, b.d + 1.0, Math.min(6.5, Math.max(3.2, Math.min(b.w, b.d) * 0.38)));
      rg.translate(b.x, b.h + 0.1, b.z);
      roofGeos.push(rg);
      collision.add(b.x, b.z, b.w, b.d, 0, b.h + 1.4, 'building');
    } else {
      const fg = new THREE.BoxGeometry(b.w + 1.0, 0.5, b.d + 1.0);
      fg.translate(b.x, b.h + 0.25, b.z);
      roofGeos.push(fg);
      // roof parapet so rooftops feel like real places
      for (const [ox, oz, pw, pd] of [
        [0, -b.d / 2, b.w + 1, 0.6], [0, b.d / 2, b.w + 1, 0.6],
        [-b.w / 2, 0, 0.6, b.d + 1], [b.w / 2, 0, 0.6, b.d + 1],
      ]) {
        const pg = new THREE.BoxGeometry(pw, 1.0, pd);
        pg.translate(b.x + ox, b.h + 1.0, b.z + oz);
        corniceGeos.push(pg);
      }
      collision.add(b.x, b.z, b.w, b.d, 0, b.h + 0.5, 'building');
      if (b.tower) {
        const tw = b.w * 0.35, td = b.d * 0.35, th = rng.float(6, 16);
        const tg = boxWithTiledUV(tw, th, td, rng);
        tg.translate(b.x, b.h + th / 2, b.z);
        bucketsDark[b.style].push(tg);
        collision.add(b.x, b.z, tw, td, b.h, th, 'building');
      }
    }
  }

  const cityGroup = new THREE.Group();
  cityGroup.name = 'city';

  const pushMerged = (geos, mat, castShadow = true) => {
    const merged = mergeAll(geos);
    if (!merged) return null;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    cityGroup.add(mesh);
    return mesh;
  };

  bucketsLit.forEach((geos, i) => pushMerged(geos, facadeMats[i]));
  bucketsDark.forEach((geos, i) => pushMerged(geos, facadeMatsDark[i]));
  pushMerged(roofGeos, roofMat);
  pushMerged(corniceGeos, corniceMat);

  /* ---------- 5. ground ---------- */
  const groundTex = makeTexture(painter.pretty, 1, 1);
  groundTex.wrapS = groundTex.wrapT = THREE.ClampToEdgeWrapping;
  groundTex.anisotropy = 8;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  cityGroup.add(ground);

  // High-detail cobble on the squares the player actually walks across.
  const cobbleTex = makeTexture(makeCobbleTexture(512), 1, 1);
  const cobbleMat = new THREE.MeshStandardMaterial({ map: cobbleTex, roughness: 0.92 });
  for (const p of PLAZAS) {
    if (p.type !== FLAG.PLAZA) continue;
    const [cx, cz, w, d] = p.r;
    const t = cobbleTex.clone();
    t.needsUpdate = true;
    t.repeat.set(w / 12, d / 12);
    const m = cobbleMat.clone();
    m.map = t;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(cx, 0.02, cz);
    plane.receiveShadow = true;
    plane.matrixAutoUpdate = false;
    plane.updateMatrix();
    cityGroup.add(plane);
  }

  /* ---------- 6. landmarks & props ---------- */
  const landmarkInfo = buildLandmarks(cityGroup, collision, { stoneMat, roofMat, rng });

  const props = buildProps(cityGroup, collision, { rng, flagAt, painter });

  /* ---------- 7. trams ---------- */
  const trams = buildTrams(cityGroup, collision);

  /* ---------- 8. world bounds: forest ring + invisible walls ---------- */
  const edge = HALF - 26;
  collision.bounds = { x0: -edge, z0: -edge, x1: edge, z1: edge };

  scene.add(cityGroup);

  // Minimap plan (downscaled copy of the pretty plan).
  const mini = document.createElement('canvas');
  mini.width = mini.height = MINI_SIZE;
  const mctx = mini.getContext('2d');
  mctx.drawImage(painter.pretty, 0, 0, MINI_SIZE, MINI_SIZE);
  // overlay building footprints so the minimap reads like a street map
  mctx.fillStyle = 'rgba(20,22,26,0.92)';
  const ms = MINI_SIZE / MAP_SIZE;
  for (const b of buildings) {
    mctx.fillRect((b.x - b.w / 2 + HALF) * ms, (b.z - b.d / 2 + HALF) * ms, b.w * ms, b.d * ms);
  }

  return {
    group: cityGroup,
    buildings,
    places: PLACES,
    landmarks: landmarkInfo,
    props,
    trams,
    minimap: mini,
    flagAt,
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
            const a = (k / 8) * Math.PI * 2;
            const ox = k === 8 ? 0 : Math.cos(a) * clearance;
            const oz = k === 8 ? 0 : Math.sin(a) * clearance;
            if (collision.isSolidAt(x + ox, 1.3, z + oz)) clear = false;
          }
          if (clear) return new THREE.Vector3(x, collision.groundHeight(x, z, 8, 0.5), z);
        }
      }
      return null;
    },
    update(dt, t) {
      for (const tr of trams) tr.update(dt);
      if (props.update) props.update(dt, t);
    },
  };
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

/** Box whose UVs are scaled so a facade "bay" texture tiles at world scale. */
function boxWithTiledUV(w, h, d, rng) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const su = rng ? rng.int(0, 5) : 0;
  const sv = rng ? rng.int(0, 3) : 0;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const spans = [
    [d / BAY_W, h / FLOOR_H],
    [d / BAY_W, h / FLOOR_H],
    [w / BAY_W, d / BAY_W],
    [w / BAY_W, d / BAY_W],
    [w / BAY_W, h / FLOOR_H],
    [w / BAY_W, h / FLOOR_H],
  ];
  for (let f = 0; f < 6; f++) {
    const [su2, sv2] = spans[f];
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * su2 + su, uv.getY(idx) * sv2 + sv);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function offsetPolyline(pts, off) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    out.push([pts[i][0] - (dz / l) * off, pts[i][1] + (dx / l) * off]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* props: trees, lamps, benches, kiosks, tram poles                    */
/* ------------------------------------------------------------------ */
function buildProps(group, collision, { rng, flagAt }) {
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 6);
  trunkGeo.translate(0, 1.6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1 });
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x37592f, roughness: 0.95, flatShading: true });

  const treePos = [];
  // parks
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    const n = p.type === FLAG.PARK ? Math.floor((w * d) / 210) : 0;
    for (let i = 0; i < n; i++) {
      const x = cx + rng.float(-w / 2 + 4, w / 2 - 4);
      const z = cz + rng.float(-d / 2 + 4, d / 2 - 4);
      if (!collision.isSolidAt(x, 2, z)) treePos.push([x, z, rng.float(2.6, 5.4)]);
    }
  }
  // avenue trees along wide streets
  for (const r of ROADS) {
    if (r.w < 14) continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let t = 12; t < len - 8; t += rng.float(16, 26)) {
        const u = t / len;
        for (const side of [-1, 1]) {
          const off = r.w / 2 + 2.4;
          const x = ax + (bx - ax) * u + nx * off * side;
          const z = az + (bz - az) * u + nz * off * side;
          if (!collision.isSolidAt(x, 2, z)) treePos.push([x, z, rng.float(3.2, 5)]);
        }
      }
    }
  }
  // forest ring at the map edge
  for (let i = 0; i < 1500; i++) {
    const side = rng.int(0, 3);
    const along = rng.float(-HALF, HALF);
    const depth = rng.float(HALF - 24, HALF - 2);
    const x = side === 0 ? -depth : side === 1 ? depth : along;
    const z = side === 2 ? -depth : side === 3 ? depth : along;
    treePos.push([x, z, rng.float(4, 8)]);
  }

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treePos.length);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, treePos.length * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  let li = 0;
  treePos.forEach(([x, z, size], i) => {
    const sc = size / 4;
    m.compose(pos.set(x, 0, z), q.identity(), s.set(sc, sc * rng.float(0.9, 1.3), sc));
    trunks.setMatrixAt(i, m);
    for (let k = 0; k < 2; k++) {
      const r = size * (k === 0 ? 0.42 : 0.3);
      q.setFromEuler(new THREE.Euler(rng.float(0, 3), rng.float(0, 3), rng.float(0, 3)));
      m.compose(
        pos.set(x + rng.float(-0.6, 0.6), size * (k === 0 ? 0.62 : 0.9) + 1.4, z + rng.float(-0.6, 0.6)),
        q, s.set(r, r * 0.85, r),
      );
      leaves.setMatrixAt(li++, m);
    }
    collision.add(x, z, 0.7, 0.7, 0, 3, 'tree');
  });
  trunks.castShadow = leaves.castShadow = true;
  trunks.receiveShadow = leaves.receiveShadow = true;
  group.add(trunks, leaves);

  /* ---- street lamps ---- */
  const lampPositions = [];
  for (const r of ROADS) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let t = 8; t < len; t += 30) {
        const u = t / len;
        const side = rng.sign();
        const off = r.w / 2 + 1.6;
        lampPositions.push([ax + (bx - ax) * u + nx * off * side, az + (bz - az) * u + nz * off * side]);
      }
    }
  }
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    for (let i = 0; i < 6; i++) {
      lampPositions.push([cx + rng.float(-w / 2 + 3, w / 2 - 3), cz + rng.float(-d / 2 + 3, d / 2 - 3)]);
    }
  }

  const poleGeo = new THREE.CylinderGeometry(0.11, 0.15, 7, 6);
  poleGeo.translate(0, 3.5, 0);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x22262b, roughness: 0.6, metalness: 0.5 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampPositions.length);
  const headGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffe9c0, emissive: 0xffbe72, emissiveIntensity: 1.5, roughness: 0.4,
  });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampPositions.length);
  lampPositions.forEach(([x, z], i) => {
    m.compose(pos.set(x, 0, z), q.identity(), s.set(1, 1, 1));
    poles.setMatrixAt(i, m);
    m.compose(pos.set(x, 7.1, z), q.identity(), s.set(1, 1, 1));
    heads.setMatrixAt(i, m);
  });
  poles.castShadow = true;
  group.add(poles, heads);

  /* ---- benches & kiosks on the squares ---- */
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });
  const benchGeos = [];
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    const n = p.type === FLAG.PARK ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const x = cx + rng.float(-w / 2 + 4, w / 2 - 4);
      const z = cz + rng.float(-d / 2 + 4, d / 2 - 4);
      if (collision.isSolidAt(x, 1, z)) continue;
      const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
      const seat = new THREE.BoxGeometry(2.2, 0.16, 0.62);
      const back = new THREE.BoxGeometry(2.2, 0.5, 0.14);
      seat.translate(0, 0.46, 0);
      back.translate(0, 0.78, -0.26);
      const legs = new THREE.BoxGeometry(0.16, 0.46, 0.6);
      const l1 = legs.clone(); l1.translate(-0.9, 0.23, 0);
      const l2 = legs.clone(); l2.translate(0.9, 0.23, 0);
      const merged = mergeAll([seat, back, l1, l2]);
      merged.rotateY(rot);
      merged.translate(x, 0, z);
      benchGeos.push(merged);
      collision.add(x, z, rot ? 0.7 : 2.3, rot ? 2.3 : 0.7, 0, 0.9, 'prop');
    }
  }
  if (benchGeos.length) {
    const bench = new THREE.Mesh(mergeAll(benchGeos), woodMat);
    bench.castShadow = bench.receiveShadow = true;
    group.add(bench);
  }

  return { treeCount: treePos.length, lampCount: lampPositions.length };
}

/* ------------------------------------------------------------------ */
/* trams                                                              */
/* ------------------------------------------------------------------ */
function buildTrams(group, collision) {
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc4222a, roughness: 0.42, metalness: 0.2 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 });
  const skirtMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.7, metalness: 0.3 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x16222c, roughness: 0.12, metalness: 0.55, emissive: 0x2b4b60, emissiveIntensity: 0.9,
  });
  const litMat = new THREE.MeshStandardMaterial({
    color: 0x2a2416, emissive: 0xffd08a, emissiveIntensity: 1.4, roughness: 0.6,
  });

  /** One articulated car, 12 m long, centred on z = 0. */
  const buildCar = () => {
    const car = new THREE.Group();
    const L = 11.6, W = 2.5;
    // dark skirt + red body + cream band + roof
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(W, 0.7, L), skirtMat);
    skirt.position.y = 0.7;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, 1.15, L), bodyMat);
    body.position.y = 1.62;
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.03, 1.0, L), creamMat);
    band.position.y = 2.42;
    const upper = new THREE.Mesh(new THREE.BoxGeometry(W, 0.35, L), bodyMat);
    upper.position.y = 3.1;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W - 0.18, 0.18, L - 0.3), skirtMat);
    roof.position.y = 3.32;
    car.add(skirt, body, band, upper, roof);
    // window band: glass slabs just outside the cream band
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 2.3), glassMat);
        win.position.set(side * (W / 2 + 0.02), 2.44, -4.1 + i * 2.75);
        car.add(win);
      }
      // doors
      for (const dz of [-2.6, 2.6]) {
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 1.15), skirtMat);
        door.position.set(side * (W / 2 + 0.03), 1.85, dz);
        car.add(door);
      }
    }
    // ends: cab window + headlights
    for (const [ez, sign] of [[-L / 2 - 0.02, -1], [L / 2 + 0.02, 1]]) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(W - 0.35, 0.9, 0.06), glassMat);
      cab.position.set(0, 2.5, ez);
      car.add(cab);
      for (const sx of [-0.75, 0.75]) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.06), litMat);
        lamp.position.set(sx, 1.35, ez);
        car.add(lamp);
      }
    }
    // pantograph
    const pan = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 0.1), skirtMat);
    pan.position.set(0, 3.85, -1.2);
    pan.rotation.x = 0.5;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 0.08), skirtMat);
    bar.position.set(0, 4.28, -0.9);
    car.add(pan, bar);
    car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return car;
  };

  const trams = [];
  TRAM_ROUTES.forEach((route, ri) => {
    const curve = new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    curve.curveType = 'catmullrom';
    curve.tension = 0.2;
    const len = curve.getLength();
    const count = ri === 0 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const tram = new THREE.Group();
      for (let seg = 0; seg < 2; seg++) {
        const car = buildCar();
        car.position.z = seg * 12.2 - 6.1;
        tram.add(car);
      }
      group.add(tram);

      const speed = 9 + ri * 1.5;
      let t = (i / count + ri * 0.13) % 1;
      const dir = { fwd: true };
      const pos = new THREE.Vector3();
      const look = new THREE.Vector3();
      // Trams are not registered with the static collision grid (they move);
      // they simply rumble past. Getting clipped by one is on you.
      const obj = {
        mesh: tram,
        update(dt) {
          t += ((dir.fwd ? 1 : -1) * speed * dt) / len;
          if (t > 1) { t = 1; dir.fwd = false; }
          if (t < 0) { t = 0; dir.fwd = true; }
          curve.getPointAt(Math.max(0, Math.min(1, t)), pos);
          const t2 = Math.max(0, Math.min(1, t + (dir.fwd ? 0.01 : -0.01)));
          curve.getPointAt(t2, look);
          tram.position.copy(pos);
          tram.position.y = 0;
          tram.lookAt(look.x, 0, look.z);
        },
      };
      obj.update(0);
      trams.push(obj);
    }
  });
  return trams;
}
