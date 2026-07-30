import * as THREE from 'three';
import { Rng } from '../rng.js';
import { getMaterial } from '../materials.js';
import { InstanceSet, partsGeometry, label } from './mesh.js';
import { TIER } from './chunks.js';
import {
  FLAG, ROADS, PLAZAS, PLACES, TRAM_STOPS, segments, offsetPolyline, inCore,
} from './layout.js';
import { frontageOffset, trackOffsets, samplePolyline, polylineLength } from './plan.js';

/**
 * Street furniture, traffic and people.
 *
 * The rule here is that nothing gets its own mesh: repeated props are
 * instanced (bollards, bins, benches, cycle stands, planters, cars,
 * pedestrians, lamp standards, catenary masts), one-off assemblies are
 * merged per material (shelters, kiosks, stalls, overhead wire), and every
 * plate of signage in the city shares one atlas texture.
 *
 * Colliders: anything the player can walk into gets one, tagged with its
 * real surface so footsteps, impact decals and break-up sounds are right.
 * Small clutter (bollards, plates, wires, café chairs) deliberately gets
 * none — 5000 colliders would cost far more than they are worth.
 *
 * Shadows: only things that read as a mass cast — lamp standards, catenary
 * masts, benches, market stalls, kiosks, shelters, parked cars, pedestrians.
 * Bollards, bins, planters, chairs, tables, cycle stands, newspaper boxes,
 * enamel plates and the overhead wire are all excluded, because we run three
 * shadow cascades and a bollard's shadow is a pixel at three times the price.
 */

/* ------------------------------------------------------------------ */
/* enamel plate atlas: street names + house numbers                    */
/* ------------------------------------------------------------------ */
const PLATE_COLS = 8;
const PLATE_ROWS = 8;

function plateAtlas(rng) {
  const S = 1024;
  const cw = S / PLATE_COLS;
  const ch = S / PLATE_ROWS;
  const col = document.createElement('canvas');
  col.width = col.height = S;
  const ctx = col.getContext('2d');
  ctx.fillStyle = '#0d1220';
  ctx.fillRect(0, 0, S, S);
  const cell = (i, bg, fg, text, bold) => {
    const x = (i % PLATE_COLS) * cw;
    const y = Math.floor(i / PLATE_COLS) * ch;
    ctx.fillStyle = bg;
    ctx.fillRect(x + 2, y + 2, cw - 4, ch - 4);
    ctx.strokeStyle = fg;
    ctx.lineWidth = cw * 0.035;
    ctx.strokeRect(x + cw * 0.07, y + ch * 0.13, cw * 0.86, ch * 0.74);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = ch * (bold ? 0.46 : 0.3);
    ctx.font = `bold ${size}px sans-serif`;
    while (ctx.measureText(text).width > cw * 0.76 && size > 5) {
      size -= 1;
      ctx.font = `bold ${size}px sans-serif`;
    }
    ctx.fillStyle = fg;
    ctx.fillText(text, x + cw / 2, y + ch / 2);
    ctx.restore();
    // enamel chips
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(230,225,210,0.5)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.arc(x + rng.float(4, cw - 4), y + rng.float(4, ch - 4), rng.float(0.8, 2.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  // Brno-standard street plates: dark blue ground, white legend and border
  ROADS.forEach((r, i) => {
    if (i < PLATE_COLS * 4) cell(i, '#16305e', '#f2f4f8', r.name.toUpperCase(), false);
  });
  // red descriptive house numbers fill the rest of the atlas
  for (let i = ROADS.length; i < PLATE_COLS * PLATE_ROWS; i++) {
    cell(i, '#8d1d1d', '#f6efe4', String(1 + ((i * 37) % 89)), true);
  }
  const map = new THREE.CanvasTexture(col);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return {
    // real Brno plates are double-sided enamelled steel
    material: new THREE.MeshStandardMaterial({
      map, roughness: 0.32, metalness: 0.15, side: THREE.DoubleSide,
    }),
    streetCell: (i) => i % (PLATE_COLS * 4),
    numberCell: (i) => ROADS.length + (i % (PLATE_COLS * PLATE_ROWS - ROADS.length)),
    uv: (i) => [(i % PLATE_COLS) / PLATE_COLS, 1 - (Math.floor(i / PLATE_COLS) + 1) / PLATE_ROWS],
    su: 1 / PLATE_COLS,
    sv: 1 / PLATE_ROWS,
  };
}

/* ------------------------------------------------------------------ */
/* prop geometry factories — built once, instanced everywhere           */
/* ------------------------------------------------------------------ */
function lampGeometry() {
  const base = new THREE.CylinderGeometry(0.2, 0.28, 0.55, 8);
  const shaft = new THREE.CylinderGeometry(0.075, 0.13, 4.3, 8);
  const collar = new THREE.CylinderGeometry(0.15, 0.15, 0.18, 8);
  const arm = new THREE.BoxGeometry(0.09, 0.09, 0.85);
  const hood = new THREE.ConeGeometry(0.3, 0.34, 6);
  const lantern = new THREE.CylinderGeometry(0.19, 0.13, 0.55, 6);
  return partsGeometry([
    { geo: base, y: 0.275 },
    { geo: shaft, y: 2.7 },
    { geo: collar, y: 4.9 },
    { geo: arm, y: 5.0, z: 0.42 },
    { geo: lantern, y: 4.72, z: 0.82 },
    { geo: hood, y: 5.08, z: 0.82 },
  ]);
}

function lampGlowGeometry() {
  const g = new THREE.CylinderGeometry(0.16, 0.11, 0.42, 6);
  g.translate(0, 4.72, 0.82);
  return g;
}

function bollardGeometry() {
  // 6-sided and cap-less: there are a couple of hundred of these and a
  // sphere cap alone cost more triangles than the whole post
  const post = new THREE.CylinderGeometry(0.085, 0.105, 0.98, 6);
  const ring = new THREE.CylinderGeometry(0.115, 0.115, 0.07, 6);
  return partsGeometry([
    { geo: post, y: 0.49 },
    { geo: ring, y: 0.7 },
  ]);
}

function binGeometry() {
  const body = new THREE.CylinderGeometry(0.26, 0.22, 0.78, 8);
  const rim = new THREE.CylinderGeometry(0.29, 0.29, 0.07, 8);
  const post = new THREE.BoxGeometry(0.08, 1.1, 0.08);
  return partsGeometry([
    { geo: body, y: 0.62 },
    { geo: rim, y: 1.02 },
    { geo: post, y: 0.55, z: -0.3 },
  ]);
}

function benchGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    parts.push({ geo: new THREE.BoxGeometry(2.0, 0.06, 0.11), y: 0.44, z: -0.24 + i * 0.12 });
  }
  for (let i = 0; i < 3; i++) {
    const g = new THREE.BoxGeometry(2.0, 0.1, 0.05);
    parts.push({ geo: g, y: 0.62 + i * 0.16, z: -0.3, rx: -0.18 });
  }
  for (const sx of [-0.85, 0.85]) {
    parts.push({ geo: new THREE.BoxGeometry(0.08, 0.44, 0.5), x: sx, y: 0.22 });
    parts.push({ geo: new THREE.BoxGeometry(0.07, 0.62, 0.07), x: sx, y: 0.68, z: -0.3 });
  }
  return partsGeometry(parts);
}

function cycleStandGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const hoop = new THREE.TorusGeometry(0.34, 0.028, 4, 8, Math.PI);
    parts.push({ geo: hoop, x: -0.6 + i * 0.6, y: 0.36, ry: Math.PI / 2 });
  }
  parts.push({ geo: new THREE.BoxGeometry(1.7, 0.05, 0.05), y: 0.06 });
  return partsGeometry(parts);
}

function planterGeometry() {
  const tub = new THREE.CylinderGeometry(0.55, 0.44, 0.62, 8);
  const rim = new THREE.CylinderGeometry(0.58, 0.58, 0.08, 8);
  const soil = new THREE.CylinderGeometry(0.48, 0.48, 0.06, 8);
  return partsGeometry([
    { geo: tub, y: 0.31 },
    { geo: rim, y: 0.62 },
    { geo: soil, y: 0.64 },
  ]);
}

function newsBoxGeometry() {
  return partsGeometry([
    { geo: new THREE.BoxGeometry(0.52, 0.85, 0.36), y: 0.68 },
    { geo: new THREE.BoxGeometry(0.1, 0.28, 0.1), x: -0.16, y: 0.14 },
    { geo: new THREE.BoxGeometry(0.1, 0.28, 0.1), x: 0.16, y: 0.14 },
  ]);
}

function tableGeometry() {
  return partsGeometry([
    { geo: new THREE.CylinderGeometry(0.36, 0.36, 0.05, 10), y: 0.72 },
    { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), y: 0.35 },
    { geo: new THREE.CylinderGeometry(0.24, 0.24, 0.03, 8), y: 0.02 },
  ]);
}

function chairGeometry() {
  const parts = [
    { geo: new THREE.BoxGeometry(0.4, 0.04, 0.4), y: 0.44 },
    { geo: new THREE.BoxGeometry(0.4, 0.42, 0.04), y: 0.66, z: -0.18 },
  ];
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    parts.push({ geo: new THREE.BoxGeometry(0.035, 0.44, 0.035), x: sx, y: 0.22, z: sz });
  }
  return partsGeometry(parts);
}

function mastGeometry() {
  return partsGeometry([
    { geo: new THREE.CylinderGeometry(0.11, 0.17, 7.2, 8), y: 3.6 },
    { geo: new THREE.CylinderGeometry(0.22, 0.26, 0.35, 8), y: 0.17 },
    { geo: new THREE.BoxGeometry(0.07, 0.07, 1.5), y: 6.4, z: 0.75 },
    { geo: new THREE.BoxGeometry(0.05, 0.5, 0.05), y: 6.1, z: 1.42 },
  ]);
}

function carGeometry() {
  const lower = new THREE.BoxGeometry(1.78, 0.62, 4.2);
  const cabin = new THREE.BoxGeometry(1.66, 0.56, 2.15);
  const bonnet = new THREE.BoxGeometry(1.7, 0.22, 1.1);
  return partsGeometry([
    { geo: lower, y: 0.62 },
    { geo: cabin, y: 1.2, z: -0.15 },
    { geo: bonnet, y: 0.99, z: 1.5 },
  ]);
}

function carGlassGeometry() {
  return partsGeometry([
    { geo: new THREE.BoxGeometry(1.5, 0.44, 0.05), y: 1.22, z: 0.9, rx: 0.35 },
    { geo: new THREE.BoxGeometry(1.6, 0.36, 1.72), y: 1.24, z: -0.15 },
  ]);
}

function carWheelsGeometry() {
  const parts = [];
  for (const [sx, sz] of [[-0.86, 1.32], [0.86, 1.32], [-0.86, -1.32], [0.86, -1.32]]) {
    // 6-sided: four 8-sided wheels per car was the largest single triangle
    // line item in the entire city
    parts.push({ geo: new THREE.CylinderGeometry(0.31, 0.31, 0.2, 6), x: sx, y: 0.31, z: sz, rz: Math.PI / 2 });
  }
  return partsGeometry(parts);
}

function torsoGeometry() {
  return partsGeometry([
    { geo: new THREE.BoxGeometry(0.42, 0.62, 0.26), y: 1.16 },
    { geo: new THREE.BoxGeometry(0.13, 0.5, 0.13), x: -0.27, y: 1.12 },
    { geo: new THREE.BoxGeometry(0.13, 0.5, 0.13), x: 0.27, y: 1.12 },
  ]);
}

function headGeometry() {
  return partsGeometry([
    { geo: new THREE.IcosahedronGeometry(0.13, 0), y: 1.62 },
    { geo: new THREE.BoxGeometry(0.1, 0.12, 0.1), y: 1.48 },
  ]);
}

function legGeometry() {
  // pivot at the hip so a single Y+X rotation swings the leg
  const g = new THREE.BoxGeometry(0.14, 0.92, 0.16);
  g.translate(0, -0.46, 0);
  return g;
}

const CAR_COLOURS = [
  0x24282e, 0x8c9096, 0xb8bcc0, 0x5e2a26, 0x1f3a56,
  0x2c4030, 0x6f6a5a, 0xa8a49c, 0x3b2f3d, 0xd8d4cc,
];
const COAT_COLOURS = [
  0x2a2f38, 0x3d3229, 0x1f2b22, 0x4a2c2c, 0x2f3f4e,
  0x565045, 0x6b5b4a, 0x30343c, 0x503a44, 0x24303a,
];
const SKIN_COLOURS = [0xc79a76, 0xa87452, 0xe0b892, 0x8a5c3c, 0xd0a882];

/* ------------------------------------------------------------------ */
export function buildProps(group, collision, { rng, flagAt, plots, seed, breakables, chunks }) {
  const art = new Rng(seed ^ 0x2f19b3);
  const plates = plateAtlas(art);

  const M = {
    // two painted-metal variants serve the whole city: heritage dark for the
    // cast-iron kit, galvanised grey for everything modern
    iron: getMaterial('paintedMetal', { seed: 1405, color: '#2b2f34' }),
    steel: getMaterial('paintedMetal', { seed: 1702, color: '#63676c' }),
    wood: getMaterial('wood', { seed: 1703, color: '#54402c' }),
    stone: getMaterial('stone', { base: '#8f887b', mortar: '#726c62', scale: 1.1 }),
    glass: getMaterial('paneGlass', { seed: 1501, panesX: 2, panesY: 3 }),
    canvasCloth: new THREE.MeshStandardMaterial({ color: 0xbcb098, roughness: 0.92 }),
    plate: plates.material,
    lampGlow: new THREE.MeshStandardMaterial({
      color: 0xffe6bc, emissive: 0xffbe72, emissiveIntensity: 2.4, roughness: 0.35,
    }),
    carPaint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.36, metalness: 0.42 }),
    carGlass: new THREE.MeshStandardMaterial({
      color: 0x1b2530, roughness: 0.12, metalness: 0.6, emissive: 0x0a1018, emissiveIntensity: 1,
    }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.9 }),
    coat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
    trouser: new THREE.MeshStandardMaterial({ color: 0x2b2e35, roughness: 0.85 }),
  };

  label(M);
  /* merged one-offs (shelters, kiosks, stalls, plates, wire) go through the
   * chunk grid: `S` for anything with real mass, `D` for trim that stops
   * mattering past the LOD radius */
  const S = (m, x, z) => chunks.get(m, x, z, TIER.SILHOUETTE);
  const D = (m, x, z) => chunks.get(m, x, z, TIER.DETAIL);

  const sets = {
    lamp: new InstanceSet(lampGeometry(), M.iron),
    lampGlow: new InstanceSet(lampGlowGeometry(), M.lampGlow, { castShadow: false }),
    bollard: new InstanceSet(bollardGeometry(), M.iron, { castShadow: false }),
    bin: new InstanceSet(binGeometry(), M.steel, { castShadow: false }),
    bench: new InstanceSet(benchGeometry(), M.wood),
    stand: new InstanceSet(cycleStandGeometry(), M.steel, { castShadow: false }),
    planter: new InstanceSet(planterGeometry(), M.stone, { castShadow: false }),
    news: new InstanceSet(newsBoxGeometry(), M.steel, { castShadow: false }),
    table: new InstanceSet(tableGeometry(), M.steel, { castShadow: false }),
    chair: new InstanceSet(chairGeometry(), M.steel, { castShadow: false }),
    mast: new InstanceSet(mastGeometry(), M.steel),
    carBody: new InstanceSet(carGeometry(), M.carPaint, { colour: true }),
    carGlass: new InstanceSet(carGlassGeometry(), M.carGlass, { castShadow: false }),
    carWheels: new InstanceSet(carWheelsGeometry(), M.tyre, { castShadow: false }),
    torso: new InstanceSet(torsoGeometry(), M.coat, { colour: true }),
    head: new InstanceSet(headGeometry(), M.skin, { colour: true }),
    leg: new InstanceSet(legGeometry(), M.trouser, { castShadow: false }),
  };

  let lamps = 0;
  const clear = (x, z, r = 0.8) => !collision.isSolidAt(x, 1.2, z)
    && !collision.isSolidAt(x + r, 1.2, z) && !collision.isSolidAt(x - r, 1.2, z)
    && !collision.isSolidAt(x, 1.2, z + r) && !collision.isSolidAt(x, 1.2, z - r);

  /* ============ 1. lamp standards, bollards, bins along the kerbs ======= */
  let bollards = 0;
  let bins = 0;
  for (const road of ROADS) {
    const off = frontageOffset(road) - 1.1;
    for (const seg of segments(road.pts)) {
      const spacing = road.w >= 14 ? 26 : 21;
      for (let t = 6; t < seg.len - 3; t += spacing) {
        const side = rng.sign();
        const x = seg.ax + seg.tx * t + seg.nx * off * side;
        const z = seg.az + seg.tz * t + seg.nz * off * side;
        if (!clear(x, z, 0.5)) continue;
        const rot = seg.rot + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        sets.lamp.push(x, 0.11, z, rot, 1, rng.float(0.92, 1.08), 1);
        sets.lampGlow.push(x, 0.11, z, rot);
        lamps++;
      }
      // bollards guarding the pavement edge on the sett streets
      if (road.paving === 'sett') {
        for (let t = 3; t < seg.len - 2; t += rng.float(4.6, 7.4)) {
          for (const side of [-1, 1]) {
            const x = seg.ax + seg.tx * t + seg.nx * (off + 0.5) * side;
            const z = seg.az + seg.tz * t + seg.nz * (off + 0.5) * side;
            if (!clear(x, z, 0.4)) continue;
            sets.bollard.push(x, 0.11, z, 0, 1, rng.float(0.9, 1.1), 1);
            bollards++;
          }
        }
      }
      // bins and news boxes
      for (let t = 12; t < seg.len - 6; t += rng.float(38, 70)) {
        const side = rng.sign();
        const x = seg.ax + seg.tx * t + seg.nx * off * side;
        const z = seg.az + seg.tz * t + seg.nz * off * side;
        if (!clear(x, z, 0.6)) continue;
        const rot = seg.rot + rng.float(-0.3, 0.3);
        sets.bin.push(x, 0.11, z, rot);
        bins++;
        const box = collision.add(x, z, 0.62, 0.62, 0, 1.1, 'prop', 'metal');
        breakables.add({
          colliders: [box], chunks: 5, threshold: 24, mass: 14, surface: 'metal',
          seed: 0x81a2 ^ Math.round(x * 41 + z * 13), label: 'litter bin',
        });
        if (rng.chance(0.22)) {
          const nx = x + seg.tx * 1.5, nz = z + seg.tz * 1.5;
          if (clear(nx, nz, 0.5)) {
            sets.news.push(nx, 0.11, nz, rot);
            const nb = collision.add(nx, nz, 0.6, 0.5, 0, 0.95, 'prop', 'metal');
            breakables.add({
              colliders: [nb], chunks: 4, threshold: 20, mass: 11, surface: 'metal',
              seed: 0x9b41 ^ Math.round(nx * 29 + nz * 19), label: 'newspaper box',
            });
          }
        }
      }
      // cycle stands on the commercial streets
      if ((road.shops ?? 0) > 0.4) {
        for (let t = 20; t < seg.len - 10; t += rng.float(70, 130)) {
          const side = rng.sign();
          const x = seg.ax + seg.tx * t + seg.nx * off * side;
          const z = seg.az + seg.tz * t + seg.nz * off * side;
          if (!clear(x, z, 1.2)) continue;
          sets.stand.push(x, 0.11, z, seg.rot);
        }
      }
    }
  }

  /* ============ 2. overhead tram wire: masts, spans, contact wire ======= */
  const WIRE_Y = 5.75;
  let masts = 0;
  for (const road of ROADS) {
    if (!road.tram) continue;
    const offs = trackOffsets(road);
    const mastOff = road.w / 2 + 0.8;
    for (const seg of segments(road.pts)) {
      // masts alternate sides; on double track they pair up and carry a span
      const spacing = 30;
      for (let t = 8; t < seg.len - 4; t += spacing) {
        const paired = offs.length > 1;
        const sides = paired ? [-1, 1] : [rng.sign()];
        const tops = [];
        for (const side of sides) {
          const x = seg.ax + seg.tx * t + seg.nx * mastOff * side;
          const z = seg.az + seg.tz * t + seg.nz * mastOff * side;
          const rot = seg.rot + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
          sets.mast.push(x, 0, z, rot, 1, rng.float(0.97, 1.03), 1);
          collision.add(x, z, 0.45, 0.45, 0, 7.2, 'prop', 'metal');
          masts++;
          tops.push([x, z]);
        }
        if (paired && tops.length === 2) {
          // cross-span between the pair, per the dossier's multi-track note
          const [a, b] = tops;
          const dx = b[0] - a[0], dz = b[1] - a[1];
          const len = Math.hypot(dx, dz) || 1;
          D(M.steel, a[0], a[1]).box((a[0] + b[0]) / 2, WIRE_Y + 0.55, (a[1] + b[1]) / 2,
            len, 0.05, 0.05, Math.atan2(-dz, dx), () => [len, 0.2, 0, 0]);
        }
      }
    }
    // the contact wire itself, one per track
    for (const off of offs) {
      const centre = off === 0 ? road.pts : offsetPolyline(road.pts, off);
      for (const seg of segments(centre)) {
        D(M.steel, seg.ax, seg.az).box((seg.ax + seg.bx) / 2, WIRE_Y, (seg.az + seg.bz) / 2,
          seg.len, 0.045, 0.045, seg.rot, () => [seg.len, 0.2, 0, 0]);
      }
    }
  }

  /* ============ 3. tram stops: shelter, flag, bench ======= */
  let shelters = 0;
  for (const stop of TRAM_STOPS) {
    const { x, z, rot } = stop;
    if (!clear(x, z, 2.4)) continue;
    const c = Math.cos(rot), s = Math.sin(rot);
    // platform kerb
    S(M.stone, x, z).box(x, 0, z, 9.5, 0.16, 2.6, rot, (f) => [(f === 0 || f === 1 ? 2.6 : 9.5) / 2, 0.5, 0, 0]);
    // shelter: glazed back and side panels under a shallow roof
    S(M.glass, x, z).box(x - s * 1.15, 0.16, z - c * 1.15, 6.2, 2.35, 0.07, rot, () => [3, 2, 0, 0]);
    for (const sgn of [-1, 1]) {
      S(M.glass, x, z).box(x + c * sgn * 3.05, 0.16, z - s * sgn * 3.05, 0.07, 2.35, 2.2, rot,
        () => [1.2, 2, 0, 0]);
    }
    S(M.steel, x, z).box(x, 2.51, z, 6.6, 0.12, 2.6, rot, (f) => [(f === 0 || f === 1 ? 2.6 : 6.6) / 2, 0.4, 0, 0]);
    for (const sgn of [-1, 1]) {
      S(M.steel, x, z).box(x + c * sgn * 3.1, 0.16, z - s * sgn * 3.1, 0.12, 2.35, 0.12, rot, () => [0.4, 4, 0, 0]);
    }
    // stop flag with the name plate
    const fx = x + c * 4.6, fz = z - s * 4.6;
    D(M.steel, x, z).box(fx, 0.16, fz, 0.1, 3.1, 0.1, rot, () => [0.4, 6, 0, 0]);
    const pi = plates.streetCell(shelters * 3 + 1);
    const [pu, pv] = plates.uv(pi);
    D(M.plate, x, z).quad(fx + c * 0.55, 2.5, fz - s * 0.55, -c * 1.1, 0, s * 1.1, 0, 0.34, 0,
      plates.su, plates.sv, pu, pv);
    collision.add(x - s * 1.15, z - c * 1.15,
      Math.abs(c) * 6.2 + Math.abs(s) * 0.4, Math.abs(s) * 6.2 + Math.abs(c) * 0.4,
      0, 2.6, 'prop', 'glass');
    sets.bench.push(x - s * 0.55, 0.16, z - c * 0.55, rot + Math.PI);
    shelters++;
  }

  /* ============ 4. squares: benches, planters, café sets, kiosks ======= */
  let kiosks = 0;
  let stalls = 0;
  let tables = 0;
  for (const p of PLAZAS) {
    const [cx, cz, w, d] = p.r;
    const park = p.type === FLAG.PARK;
    const n = park ? Math.round((w * d) / 900) : Math.round((w * d) / 700);
    for (let i = 0; i < n; i++) {
      const x = cx + rng.float(-w / 2 + 3, w / 2 - 3);
      const z = cz + rng.float(-d / 2 + 3, d / 2 - 3);
      if (!clear(x, z, 1.4)) continue;
      const rot = rng.chance(0.5) ? rng.float(-0.2, 0.2) : Math.PI / 2 + rng.float(-0.2, 0.2);
      sets.bench.push(x, park ? 0 : 0.02, z, rot);
      const box = collision.add(x, z,
        Math.abs(Math.cos(rot)) * 2.2 + 0.6, Math.abs(Math.sin(rot)) * 2.2 + 0.6,
        0, 0.95, 'prop', 'wood');
      breakables.add({
        colliders: [box], chunks: 6, threshold: 32, mass: 26, surface: 'wood',
        seed: 0x33c1 ^ Math.round(x * 53 + z * 7), label: 'bench',
      });
    }
    if (park) {
      for (let i = 0; i < Math.round((w * d) / 2600); i++) {
        const x = cx + rng.float(-w / 2 + 4, w / 2 - 4);
        const z = cz + rng.float(-d / 2 + 4, d / 2 - 4);
        if (!clear(x, z, 1.2)) continue;
        sets.stand.push(x, 0, z, rng.float(0, 3.1));
      }
      continue;
    }
    // planters marking the edges of the paved squares
    for (let i = 0; i < Math.round((w + d) / 22); i++) {
      const edge = rng.int(0, 3);
      const x = cx + (edge === 0 ? -w / 2 + 2.2 : edge === 1 ? w / 2 - 2.2 : rng.float(-w / 2 + 3, w / 2 - 3));
      const z = cz + (edge === 2 ? -d / 2 + 2.2 : edge === 3 ? d / 2 - 2.2 : rng.float(-d / 2 + 3, d / 2 - 3));
      if (!clear(x, z, 1)) continue;
      sets.planter.push(x, 0.02, z, rng.float(0, 3.1));
      const box = collision.add(x, z, 1.2, 1.2, 0, 0.75, 'prop', 'stone');
      breakables.add({
        colliders: [box], chunks: 7, threshold: 70, mass: 120, surface: 'stone',
        seed: 0x71d4 ^ Math.round(x * 17 + z * 61), label: 'planter',
      });
    }
    // café terraces spilling onto the square
    const terraces = Math.round((w * d) / 1400);
    for (let i = 0; i < terraces; i++) {
      const x = cx + rng.float(-w / 2 + 4, w / 2 - 4);
      const z = cz + rng.float(-d / 2 + 4, d / 2 - 4);
      if (!clear(x, z, 1.6)) continue;
      sets.table.push(x, 0.02, z, rng.float(0, 3.1));
      tables++;
      const chairs = rng.int(2, 4);
      for (let k = 0; k < chairs; k++) {
        const a = (k / chairs) * Math.PI * 2 + rng.float(-0.3, 0.3);
        sets.chair.push(x + Math.cos(a) * 0.72, 0.02, z + Math.sin(a) * 0.72,
          -a + Math.PI / 2 + rng.float(-0.2, 0.2));
      }
      const box = collision.add(x, z, 0.9, 0.9, 0, 0.8, 'prop', 'metal');
      breakables.add({
        colliders: [box], chunks: 4, threshold: 14, mass: 9, surface: 'metal',
        seed: 0xc0fe ^ Math.round(x * 23 + z * 37), label: 'café table',
      });
    }
    // a kiosk or two, and market stalls on the smaller squares
    const kioskTries = w * d > 2600 ? 6 : 3;
    for (let k = 0; k < kioskTries; k++) {
      const x = cx + rng.float(-w / 2 + 4, w / 2 - 4);
      const z = cz + rng.float(-d / 2 + 4, d / 2 - 4);
      if (clear(x, z, 2.2)) {
        const rot = rng.float(0, Math.PI);
        const c = Math.cos(rot), s = Math.sin(rot);
        S(M.wood, x, z).box(x, 0.02, z, 3.1, 2.5, 2.2, rot,
          (f) => [(f === 0 || f === 1 ? 2.2 : 3.1) / 0.8, 2.5 / 0.8, 0, 0]);
        D(M.steel, x, z).box(x, 2.52, z, 3.6, 0.16, 2.7, rot, () => [4, 0.4, 0, 0]);
        D(M.glass, x, z).box(x - s * 1.14, 0.9, z - c * 1.14, 2.3, 1.2, 0.06, rot, () => [1.6, 1, 0, 0]);
        const ki = plates.numberCell(kiosks * 5);
        const [ku, kv] = plates.uv(ki);
        D(M.plate, x, z).quad(x + c * 1.1 - s * 1.17, 2.1, z - s * 1.1 - c * 1.17,
          -c * 2.2, 0, s * 2.2, 0, 0.36, 0, plates.su, plates.sv, ku, kv);
        const boxes = [collision.add(x, z,
          Math.abs(c) * 3.1 + Math.abs(s) * 2.2, Math.abs(s) * 3.1 + Math.abs(c) * 2.2,
          0, 2.7, 'prop', 'wood')];
        breakables.add({
          colliders: boxes, chunks: 9, threshold: 90, mass: 180, surface: 'wood',
          seed: 0x5ee7 ^ Math.round(x * 11 + z * 71), label: 'kiosk',
        });
        kiosks++;
        if (kiosks % 2 === 0) break;
      }
    }
    if (p.market || (w * d < 2200 && rng.chance(0.6))) {
      const rows = rng.int(2, 5);
      for (let i = 0; i < rows; i++) {
        const x = cx + rng.float(-w / 2 + 3.5, w / 2 - 3.5);
        const z = cz + rng.float(-d / 2 + 3, d / 2 - 3);
        if (!clear(x, z, 2)) continue;
        const rot = rng.chance(0.5) ? 0 : Math.PI / 2;
        const c = Math.cos(rot), s = Math.sin(rot);
        S(M.wood, x, z).box(x, 0.02, z, 2.4, 0.86, 1.1, rot, () => [3, 1, 0, 0]);
        for (const sgn of [-1, 1]) {
          D(M.wood, x, z).box(x + c * sgn * 1.1, 0.86, z - s * sgn * 1.1, 0.08, 1.25, 0.08, rot,
            () => [0.3, 2, 0, 0]);
        }
        S(M.canvasCloth, x, z).box(x, 2.1, z, 2.7, 0.1, 1.5, rot, () => [3.4, 0.3, 0, 0]);
        const boxes = [collision.add(x, z,
          Math.abs(c) * 2.4 + Math.abs(s) * 1.1, Math.abs(s) * 2.4 + Math.abs(c) * 1.1,
          0, 1, 'stall', 'wood')];
        breakables.add({
          colliders: boxes, chunks: 8, threshold: 26, mass: 40, surface: 'wood',
          seed: 0x2b8d ^ Math.round(x * 43 + z * 5), label: 'market stall',
        });
        stalls++;
      }
    }
  }

  /* ============ 5. parked cars along the kerbs ======= */
  let cars = 0;
  for (const road of ROADS) {
    if (road.paving === 'sett' && inCore(road.pts[0][0], road.pts[0][1])) continue; // pedestrianised core
    for (const seg of segments(road.pts)) {
      for (const side of [-1, 1]) {
        const off = road.w / 2 - 1.25;
        let t = rng.float(6, 14);
        while (t < seg.len - 8) {
          if (rng.chance(0.34)) {
            const x = seg.ax + seg.tx * t + seg.nx * off * side;
            const z = seg.az + seg.tz * t + seg.nz * off * side;
            if (flagAt(x, z) === FLAG.ROAD && clear(x, z, 1.1)) {
              const rot = seg.rot + (side > 0 ? Math.PI : 0) + rng.float(-0.05, 0.05);
              const colour = CAR_COLOURS[rng.int(0, CAR_COLOURS.length - 1)];
              sets.carBody.push(x, 0, z, rot, 1, 1, rng.float(0.94, 1.08), colour);
              sets.carGlass.push(x, 0, z, rot);
              sets.carWheels.push(x, 0, z, rot);
              collision.add(x, z,
                Math.abs(Math.cos(rot)) * 1.9 + Math.abs(Math.sin(rot)) * 4.3,
                Math.abs(Math.sin(rot)) * 1.9 + Math.abs(Math.cos(rot)) * 4.3,
                0, 1.5, 'prop', 'metal');
              cars++;
            }
          }
          t += rng.float(7.5, 14.0);
        }
      }
    }
  }

  /* ============ 6. enamel plates on the corners and by the doors ======= */
  let plateCount = 0;
  ROADS.forEach((road, ri) => {
    for (const end of [0, road.pts.length - 1]) {
      const p = road.pts[end];
      const near = road.pts[end === 0 ? 1 : road.pts.length - 2];
      const len = Math.hypot(near[0] - p[0], near[1] - p[1]) || 1;
      const tx = (near[0] - p[0]) / len, tz = (near[1] - p[1]) / len;
      const nx = -tz, nz = tx;
      for (const side of [-1, 1]) {
        const off = frontageOffset(road) + 0.15;
        const x = p[0] + nx * off * side + tx * 5;
        const z = p[1] + nz * off * side + tz * 5;
        // only where there is actually a wall to screw it to
        if (!collision.isSolidAt(x - nx * side * 0.6, 3.1, z - nz * side * 0.6)) continue;
        const [pu, pv] = plates.uv(plates.streetCell(ri));
        const ax = tx, az = tz;
        D(M.plate, x, z).quad(x - ax * 0.75, 3.0, z - az * 0.75, ax * 1.5, 0, az * 1.5,
          0, 0.4, 0, plates.su, plates.sv, pu, pv);
        plateCount++;
      }
    }
  });
  for (const plot of plots) {
    if (!plot.frontage || !rng.chance(0.4)) continue;
    const c = Math.cos(plot.rot), s = Math.sin(plot.rot);
    const ox = -s, oz = -c;
    const ax = c, az = -s;
    const x = plot.x + ox * (plot.d / 2 + 0.09) + ax * plot.w * 0.3;
    const z = plot.z + oz * (plot.d / 2 + 0.09) + az * plot.w * 0.3;
    const [pu, pv] = plates.uv(plates.numberCell(plateCount * 7 + 3));
    D(M.plate, x, z).quad(x + ax * 0.19, 2.45, z + az * 0.19, -ax * 0.38, 0, -az * 0.38,
      0, 0.26, 0, plates.su, plates.sv, pu, pv);
    plateCount++;
  }

  /* ============ 7. pedestrians ======= */
  const crowd = buildCrowd(rng, sets, { flagAt });

  /* ---- flush ---- */
  let meshes = 0;
  const live = {};
  for (const [name, set] of Object.entries(sets)) {
    const mesh = set.finish(group);
    if (mesh) {
      meshes++;
      live[name] = mesh;
    }
  }
  crowd.bind(live);

  return {
    meshes,
    counts: {
      lamps, bollards, bins, masts, shelters, kiosks, stalls,
      tables, cars, plates: plateCount, pedestrians: crowd.count,
    },
    lampCount: lamps,
    pedestrianCount: crowd.count,
    scatter: crowd.scatter,
    update: crowd.update,
  };
}

/* ------------------------------------------------------------------ */
/* pedestrians                                                         */
/* ------------------------------------------------------------------ */
function buildCrowd(rng, sets, { flagAt }) {
  /* Combat spaces the wave director uses. Pedestrians keep clear of them —
   * an empty city centre reads as wrong, but so does a crowd standing in a
   * boss arena. `scatter()` is exposed for whoever wants them to bolt. */
  const ARENAS = Object.values(PLACES).map((p) => [p.x, p.z, p.name === 'nám. Svobody' ? 62 : 30]);
  const insideArena = (x, z) => ARENAS.some(([ax, az, r]) => (x - ax) ** 2 + (z - az) ** 2 < r * r);

  const people = [];
  const target = 90;
  let guard = 0;
  while (people.length < target && guard++ < 4000) {
    const road = ROADS[rng.int(0, ROADS.length - 1)];
    const total = polylineLength(road.pts);
    if (total < 40) continue;
    const walkOff = (frontageOffset(road) - 1.6) * rng.sign();
    const s = rng.float(6, total - 6);
    const span = rng.float(18, 46);
    const s0 = Math.max(2, s - span / 2);
    const s1 = Math.min(total - 2, s + span / 2);
    if (s1 - s0 < 14) continue;
    // reject if any part of the beat sits in a combat space or off the street
    let ok = true;
    for (let q = 0; q <= 6 && ok; q++) {
      const p = samplePolyline(road.pts, s0 + ((s1 - s0) * q) / 6);
      const px = p.x - p.tz * walkOff;
      const pz = p.z + p.tx * walkOff;
      if (insideArena(px, pz) || flagAt(px, pz) !== FLAG.ROAD) ok = false;
    }
    if (!ok) continue;
    people.push({
      road, walkOff, s0, s1,
      s: rng.float(s0, s1),
      dir: rng.sign(),
      speed: rng.float(0.9, 1.65),
      phase: rng.float(0, Math.PI * 2),
      lean: rng.float(-0.05, 0.05),
    });
    sets.torso.push(0, -50, 0, 0, 1, 1, 1, COAT_COLOURS[rng.int(0, COAT_COLOURS.length - 1)]);
    sets.head.push(0, -50, 0, 0, 1, 1, 1, SKIN_COLOURS[rng.int(0, SKIN_COLOURS.length - 1)]);
    sets.leg.push(0, -50, 0);
    sets.leg.push(0, -50, 0);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let meshes = null;

  const write = (mesh, i, x, y, z, ry, rx = 0) => {
    e.set(rx, ry, 0);
    q.setFromEuler(e);
    m.compose(v.set(x, y, z), q, one);
    mesh.setMatrixAt(i, m);
  };

  return {
    count: people.length,
    bind(live) {
      meshes = live;
    },
    scatter(x, z, radius) {
      // send anyone nearby off in the other direction along their beat
      for (const p of people) {
        const s = samplePolyline(p.road.pts, p.s);
        const px = s.x - s.tz * p.walkOff;
        const pz = s.z + s.tx * p.walkOff;
        if ((px - x) ** 2 + (pz - z) ** 2 > radius * radius) continue;
        const away = (px - x) * s.tx + (pz - z) * s.tz;
        p.dir = away >= 0 ? 1 : -1;
        p.speed = Math.max(p.speed, 3.2);
      }
    },
    update(dt, time) {
      if (!meshes || !meshes.torso) return;
      for (let i = 0; i < people.length; i++) {
        const p = people[i];
        p.s += p.dir * p.speed * dt;
        if (p.s > p.s1) { p.s = p.s1; p.dir = -1; }
        if (p.s < p.s0) { p.s = p.s0; p.dir = 1; }
        const s = samplePolyline(p.road.pts, p.s);
        const x = s.x - s.tz * p.walkOff;
        const z = s.z + s.tx * p.walkOff;
        const heading = Math.atan2(-s.tz * p.dir, s.tx * p.dir);
        const stride = time * p.speed * 3.4 + p.phase;
        const bob = Math.abs(Math.sin(stride)) * 0.045;
        write(meshes.torso, i, x, 0.11 + bob, z, heading, p.lean);
        write(meshes.head, i, x, 0.11 + bob, z, heading + Math.sin(stride * 0.5) * 0.12);
        if (meshes.leg) {
          const hip = 0.92 + 0.11;
          write(meshes.leg, i * 2, x, hip + bob, z, heading, Math.sin(stride) * 0.62);
          write(meshes.leg, i * 2 + 1, x, hip + bob, z, heading, -Math.sin(stride) * 0.62);
        }
      }
      meshes.torso.instanceMatrix.needsUpdate = true;
      meshes.head.instanceMatrix.needsUpdate = true;
      if (meshes.leg) meshes.leg.instanceMatrix.needsUpdate = true;
    },
  };
}

