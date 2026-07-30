import { BRNO_MAP_SIZE, BRNO_PLACES } from '../data/brno-layout.js';

/**
 * Map layout constants and the painter/flag-grid mechanism.
 *
 * The whole city plan is painted once into a 4096² canvas that becomes the
 * ground texture, and the *same* drawing calls paint a 420² "flag map" that
 * is read back as a grid. That grid drives building placement, spawn
 * validity and the minimap, so it is load-bearing and must stay
 * deterministic: `FlagGrid` only ever writes exact FLAG values (never a
 * blended pixel), which is what `test/city.test.js` pins down.
 */
export const MAP_SIZE = BRNO_MAP_SIZE;
export const HALF = MAP_SIZE / 2;
export const GRID_RES = 2;
export const GN = MAP_SIZE / GRID_RES; // 420
export const TEX_SIZE = 4096;
export const MINI_SIZE = 512;

export const FLAG = { FREE: 0, ROAD: 30, PLAZA: 60, PARK: 90, RESERVED: 120, TRACK: 150 };

/** Named places — used for objectives, the compass and the minimap. */
export const PLACES = Object.fromEntries(
  Object.entries(BRNO_PLACES).map(([key, value]) => [key, { ...value }]),
);

/**
 * Main streets.
 *
 * `tram` marks the routes that get rails, overhead wire and running trams.
 * `paving`: 'sett' for the granite-sett streets of the historic core,
 * 'asphalt' for the through-roads of the ring and the outer districts.
 * `shops` marks the commercial frontages that get ground-floor shopfronts;
 * `shabby` marks the side streets that get graffiti and roller shutters.
 * The point lists are unchanged — the tram routes below reference them.
 */
export const ROADS = [
  { name: 'Masarykova', w: 16, tram: true, paving: 'sett', shops: 1, pts: [[8, 246], [4, 180], [2, 110], [0, 46]] },
  { name: 'Husova', w: 20, tram: false, paving: 'asphalt', pts: [[-186, 150], [-176, 60], [-168, -30], [-150, -104]] },
  { name: 'Joštova', w: 18, tram: true, paving: 'asphalt', shops: 0.5, pts: [[-150, -104], [-96, -108], [-40, -112], [10, -120]] },
  { name: 'Rooseveltova', w: 18, tram: true, paving: 'asphalt', pts: [[10, -120], [70, -114], [116, -100], [140, -60]] },
  { name: 'Koliště', w: 20, tram: false, paving: 'asphalt', pts: [[140, -60], [156, 20], [150, 110], [110, 190]] },
  { name: 'Nádražní', w: 20, tram: true, paving: 'asphalt', shops: 0.6, pts: [[110, 190], [40, 244], [-40, 250], [-120, 240]] },
  { name: 'Nové sady', w: 18, tram: false, paving: 'asphalt', pts: [[-120, 240], [-170, 216], [-186, 150]] },
  { name: 'Česká', w: 13, tram: true, paving: 'sett', shops: 1, pts: [[-24, -64], [-52, -88], [-72, -104]] },
  { name: 'Rašínova', w: 11, tram: false, paving: 'sett', shops: 0.8, pts: [[6, -44], [8, -96], [12, -120]] },
  { name: 'Kobližná', w: 12, tram: false, paving: 'sett', shops: 0.9, pts: [[26, -22], [70, -26], [112, -34]] },
  { name: 'Orlí', w: 11, tram: false, paving: 'sett', shops: 0.7, shabby: 0.3, pts: [[20, 26], [70, 22], [118, 16]] },
  { name: 'Masná', w: 11, tram: false, paving: 'sett', shops: 0.5, shabby: 0.45, pts: [[-30, 24], [-30, 70], [-34, 120]] },
  { name: 'Petrská', w: 10, tram: false, paving: 'sett', shops: 0.3, pts: [[-52, 100], [-80, 134], [-100, 156]] },
  { name: 'Pekařská', w: 14, tram: true, paving: 'sett', shops: 0.7, shabby: 0.35, pts: [[-72, 122], [-124, 112], [-176, 100]] },
  { name: 'Údolní', w: 13, tram: false, paving: 'asphalt', shops: 0.3, pts: [[-176, 40], [-224, 28], [-262, 8]] },
  { name: 'Pellicova', w: 10, tram: false, paving: 'sett', pts: [[-262, 8], [-268, 70], [-240, 124]] },
  { name: 'Veveří', w: 14, tram: false, paving: 'asphalt', shops: 0.4, pts: [[-150, -104], [-206, -128], [-262, -140]] },
  { name: 'Lidická', w: 16, tram: true, paving: 'asphalt', shops: 0.5, pts: [[18, -132], [26, -200], [30, -280]] },
  { name: 'Milady Horákové', w: 14, tram: false, paving: 'asphalt', pts: [[26, -200], [110, -196], [190, -186]] },
  { name: 'Cejl', w: 14, tram: false, paving: 'asphalt', shops: 0.4, shabby: 0.7, pts: [[156, 20], [230, 10], [300, 4]] },
  { name: 'Vídeňská', w: 16, tram: false, paving: 'asphalt', shabby: 0.4, pts: [[-40, 250], [-46, 320], [-50, 380]] },
  { name: 'Křenová', w: 14, tram: false, paving: 'asphalt', shops: 0.35, shabby: 0.75, pts: [[110, 190], [190, 214], [270, 230]] },
  { name: 'Hybešova', w: 13, tram: false, paving: 'asphalt', shabby: 0.5, pts: [[-120, 240], [-190, 268], [-260, 286]] },
  { name: 'Kounicova', w: 14, tram: false, paving: 'asphalt', pts: [[-96, -108], [-104, -180], [-108, -250]] },
  { name: 'Bratislavská', w: 12, tram: false, paving: 'asphalt', shabby: 0.8, pts: [[190, -186], [214, -120], [230, 10]] },
  { name: 'Zvonařka', w: 12, tram: false, paving: 'asphalt', shabby: 0.6, pts: [[190, 214], [212, 290], [220, 360]] },
  { name: 'Vinohrady', w: 12, tram: false, paving: 'asphalt', pts: [[-262, -140], [-320, -170], [-370, -186]] },
  { name: 'Kamenná', w: 12, tram: false, paving: 'asphalt', shabby: 0.5, pts: [[-240, 124], [-268, 200], [-290, 280]] },
];

/**
 * Open spaces. Rect = [cx, cz, w, d].
 *
 * The `PARK` entries along the eastern and southern edge of the core trace
 * the green ring that replaced the demolished medieval walls (Koliště,
 * Denisovy sady, Moravské náměstí's park) — per the dossier this is a
 * continuous belt, not isolated pockets, so the ring strips overlap the
 * ring road corridor and the roads are painted over them afterwards.
 */
export const PLAZAS = [
  { r: [0, -18, 74, 108], type: FLAG.PLAZA, name: 'svoboda', paving: 'fan' },
  { r: [-52, 78, 62, 54], type: FLAG.PLAZA, name: 'zelny', paving: 'fan', market: true },
  { r: [-108, 170, 90, 66], type: FLAG.PLAZA, name: 'petrov', paving: 'fan' },
  { r: [18, -136, 96, 74], type: FLAG.PARK, name: 'moravske' },
  { r: [112, -168, 86, 62], type: FLAG.PLAZA, name: 'janacek', paving: 'slab' },
  { r: [104, -64, 54, 42], type: FLAG.PLAZA, name: 'mahen', paving: 'fan' },
  { r: [22, 262, 130, 56], type: FLAG.PLAZA, name: 'nadrazi', paving: 'slab' },
  { r: [-268, 44, 132, 132], type: FLAG.PARK, name: 'spilberk' },
  { r: [-18, 46, 34, 26], type: FLAG.PLAZA, name: 'radnice', paving: 'fan' },
  { r: [-150, -104, 44, 44], type: FLAG.PLAZA, name: 'komenskeho', paving: 'fan' },
  { r: [200, 120, 150, 108], type: FLAG.PARK, name: 'luzanky' },
  { r: [-330, 300, 130, 110], type: FLAG.PARK, name: 'les-jih' },
  { r: [300, -300, 150, 130], type: FLAG.PARK, name: 'les-sever' },
  /* --- the green ring on the line of the demolished walls --- */
  { r: [-186, 208, 74, 52], type: FLAG.PARK, name: 'denisovy' },
  { r: [149, 26, 30, 176], type: FLAG.PARK, name: 'koliste-vychod' },
  { r: [130, 150, 46, 90], type: FLAG.PARK, name: 'koliste-jih' },
  { r: [-46, -132, 52, 34], type: FLAG.PARK, name: 'obilni-trh' },
  { r: [-176, -74, 40, 62], type: FLAG.PARK, name: 'zluty-kopec' },
];

/** Tram routes the trams drive along. */
export const TRAM_ROUTES = [
  [[8, 246], [4, 180], [2, 110], [0, 46], [6, -44], [8, -96], [12, -120], [18, -132], [26, -200], [30, -280]],
  [[-150, -104], [-96, -108], [-40, -112], [10, -120], [70, -114], [116, -100], [140, -60]],
  [[-176, 100], [-124, 112], [-72, 122], [-52, 100]],
];

/** Tram stops, roughly where the dossier puts the central spine's calls. */
export const TRAM_STOPS = [
  { name: 'Česká', x: -30, z: -70, rot: 0.72 },
  { name: 'nám. Svobody', x: 4, z: 24, rot: 0.03 },
  { name: 'Zelný trh', x: 3, z: 96, rot: 0.03 },
  { name: 'Hlavní nádraží', x: 30, z: 250, rot: -0.66 },
  { name: 'Joštova', x: -60, z: -110, rot: 0.07 },
  { name: 'Malinovského nám.', x: 92, z: -108, rot: -0.24 },
  { name: 'Pekařská', x: -108, z: 115, rot: -0.21 },
];

/**
 * Fallback ground reservations, used only when `src/landmarks.js` does not
 * (yet) export LANDMARK_FOOTPRINTS. These are the rects the city shipped
 * with — the true terrace/platform footprints the landmark engineer is
 * rebuilding supersede them.
 */
export const FALLBACK_FOOTPRINTS = [
  { key: 'petrov', rects: [[-108, 176, 110, 110]] },
  { key: 'spilberk', rects: [[-268, 44, 158, 158]] },
  { key: 'radnice', rects: [[-18, 44, 26, 20]] },
  { key: 'janacek', rects: [[112, -172, 62, 40]] },
  { key: 'mahen', rects: [[104, -66, 40, 26]] },
  { key: 'nadrazi', rects: [[22, 319, 140, 86]] },
  { key: 'orloj', rects: [[0, -52, 16, 16]] },
];

/* ==================================================================
   flag grid
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

/* ==================================================================
   painter — pretty 4096² plan + the flag map, in lockstep
   ================================================================== */
export class Painter {
  constructor() {
    this.pretty = document.createElement('canvas');
    this.pretty.width = this.pretty.height = TEX_SIZE;
    this.pc = this.pretty.getContext('2d');
    this.flags = new FlagGrid();
    this.sP = TEX_SIZE / MAP_SIZE;
  }

  /** world -> canvas */
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
   small geometry helpers shared across the city modules
   ================================================================== */

/** Offset a polyline sideways by `off` metres (positive = left of travel). */
export function offsetPolyline(pts, off) {
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

/** Iterate a road as straight segments with their unit tangent and normal. */
export function segments(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / len, tz = (bz - az) / len;
    out.push({ ax, az, bx, bz, len, tx, tz, nx: -tz, nz: tx, rot: Math.atan2(-tz, tx) });
  }
  return out;
}

/** Rough historic centre: inside the ring road. */
export function inCore(x, z) {
  return Math.hypot(x * 0.85, (z - 40) * 0.75) < 150;
}

/**
 * Add a Y-rotated box to the AABB collision world. Rotated footprints have
 * to be approximated: near-axis-aligned boxes get one collider, diagonal
 * ones are sliced along their long axis so the bounding volume stays tight
 * enough not to swallow the street next to them.
 */
export function addRotatedBox(collision, cx, cz, w, d, rot, y0, h, tag, surface = null) {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const boxes = [];
  if (s < 0.09 || c < 0.09) {
    const ww = w * c + d * s;
    const dd = w * s + d * c;
    boxes.push(collision.add(cx, cz, ww, dd, y0, h, tag, surface));
    return boxes;
  }
  // slice along the longer local axis
  const alongW = w >= d;
  const long = alongW ? w : d;
  const short = alongW ? d : w;
  const n = Math.max(2, Math.min(8, Math.ceil(long / 5)));
  const step = long / n;
  const ux = alongW ? Math.cos(rot) : Math.sin(rot);
  const uz = alongW ? -Math.sin(rot) : Math.cos(rot);
  const sc = Math.abs(alongW ? Math.cos(rot) : Math.sin(rot));
  const ss = Math.abs(alongW ? Math.sin(rot) : Math.cos(rot));
  const sw = step * sc + short * ss;
  const sd = step * ss + short * sc;
  for (let i = 0; i < n; i++) {
    const t = -long / 2 + step * (i + 0.5);
    boxes.push(collision.add(cx + ux * t, cz + uz * t, sw, sd, y0, h, tag, surface));
  }
  return boxes;
}
