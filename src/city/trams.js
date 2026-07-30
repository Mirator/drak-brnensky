import * as THREE from 'three';
import { getMaterial } from '../materials.js';
import { Batch, label } from './mesh.js';
import { TRAM_ROUTES } from './layout.js';
import { GROUND_Y } from './plan.js';


/**
 * Trams.
 *
 * The old build made about thirty separate meshes per car, so seven trams
 * cost roughly four hundred draw calls all by themselves — most of the
 * frame budget. Now one articulated car is built once as four merged
 * geometries (DPMB cream-and-red livery, dark skirt/roof, glazing, lit
 * glass) and every car in the city is an *instance*, so the entire fleet is
 * four draw calls no matter how many trams run.
 */

const CAR_L = 11.6;
const CAR_W = 2.5;
const CAR_GAP = 12.2;
const RAIL_Y = GROUND_Y.rail;

function carGeometries() {
  const livery = new Batch();
  const dark = new Batch();
  const glass = new Batch();
  const lit = new Batch();
  const L = CAR_L, W = CAR_W;
  const boxUV = (m) => (face, fw, fh) => [fw / m, fh / m, 0, 0];

  // skirt, body, cream band, upper band, roof
  dark.box(0, 0.35, 0, W, 0.7, L, 0, boxUV(2));
  // livery UVs pick the band out of the DPMB texture: red sits at v 0.08-0.38,
  // cream above it, so the lower body reads red and the window band cream
  livery.box(0, 1.05, 0, W, 1.15, L, 0, (face, fw) => [fw / 3, 0.3, 0, 0.08]);
  livery.box(0, 2.2, 0, W + 0.03, 1.0, L, 0, (face, fw) => [fw / 3, 0.3, 0, 0.55]);
  livery.box(0, 3.2, 0, W, 0.35, L, 0, (face, fw) => [fw / 3, 0.12, 0, 0.12]);
  dark.box(0, 3.55, 0, W - 0.18, 0.18, L - 0.3, 0, boxUV(2));

  // window band and doors
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      glass.box(side * (W / 2 + 0.02), 2.33, -4.1 + i * 2.75, 0.06, 0.84, 2.3, 0, boxUV(1.4));
      // warm interior showing through the glazing at dusk
      lit.box(side * (W / 2 - 0.06), 2.4, -4.1 + i * 2.75, 0.05, 0.7, 2.1, 0, boxUV(1.4));
    }
    for (const dz of [-2.6, 2.6]) {
      dark.box(side * (W / 2 + 0.03), 0.85, dz, 0.08, 2.0, 1.15, 0, boxUV(1.4));
    }
  }

  // cab glazing and headlights at both ends
  for (const ez of [-L / 2 - 0.02, L / 2 + 0.02]) {
    glass.box(0, 2.32, ez, W - 0.35, 0.88, 0.06, 0, boxUV(1.6));
    for (const sx of [-0.75, 0.75]) {
      lit.box(sx, 1.24, ez, 0.28, 0.22, 0.06, 0, boxUV(0.5));
    }
  }

  // pantograph reaching up to the 5.75 m contact wire
  dark.box(0, 3.73, -1.2, 0.12, 1.85, 0.12, 0, boxUV(1));
  dark.box(0, 5.55, -0.95, 1.75, 0.07, 0.09, 0, boxUV(1));
  dark.box(0, 4.4, -1.05, 0.09, 1.2, 0.09, 0, boxUV(1));

  return {
    livery: livery.geometry(),
    dark: dark.geometry(),
    glass: glass.geometry(),
    lit: lit.geometry(),
  };
}

export function buildTrams(group, heightAt = null) {
  const geos = carGeometries();
  const mats = {
    livery: getMaterial('tramLivery', { seed: 1901 }),
    dark: getMaterial('paintedMetal', { seed: 1902, color: '#22242a' }),
    glass: getMaterial('paneGlass', { seed: 1903, panesX: 1, panesY: 1 }),
    lit: new THREE.MeshStandardMaterial({
      color: 0x2a2416, emissive: 0xffd08a, emissiveIntensity: 1.5, roughness: 0.6,
    }),
  };

  label({ tramLivery: mats.livery, tramDark: mats.dark, tramGlass: mats.glass, tramLit: mats.lit });

  /* how many cars the whole fleet needs, so the instance count is exact */
  const fleet = [];
  TRAM_ROUTES.forEach((route, ri) => {
    const count = ri === 0 ? 3 : 2;
    for (let i = 0; i < count; i++) fleet.push({ ri, i, count });
  });
  const carCount = fleet.length * 2;

  const meshes = {};
  for (const key of ['livery', 'dark', 'glass', 'lit']) {
    if (!geos[key]) continue;
    const m = new THREE.InstancedMesh(geos[key], mats[key], carCount);
    m.castShadow = key !== 'lit' && key !== 'glass';
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    meshes[key] = m;
  }

  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const look = new THREE.Vector3();

  const trams = [];
  let carSlot = 0;
  fleet.forEach(({ ri, i, count }) => {
    const route = TRAM_ROUTES[ri];
    const curve = new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    curve.curveType = 'catmullrom';
    curve.tension = 0.2;
    const len = curve.getLength();
    const slots = [carSlot, carSlot + 1];
    carSlot += 2;

    const speed = 9 + ri * 1.5;
    let t = (i / count + ri * 0.13) % 1;
    const dir = { fwd: true };
    const obj = {
      /** Legacy shape kept: `mesh` is now the instance slot pair. */
      slots,
      update(dt) {
        t += ((dir.fwd ? 1 : -1) * speed * dt) / len;
        if (t > 1) { t = 1; dir.fwd = false; }
        if (t < 0) { t = 0; dir.fwd = true; }
        const tc = Math.max(0, Math.min(1, t));
        curve.getPointAt(tc, pos);
        curve.getPointAt(Math.max(0, Math.min(1, tc + (dir.fwd ? 0.01 : -0.01))), look);
        const heading = Math.atan2(pos.x - look.x, pos.z - look.z) + Math.PI;
        euler.set(0, heading, 0);
        quat.setFromEuler(euler);
        const fx = Math.sin(heading), fz = Math.cos(heading);
        for (let s = 0; s < 2; s++) {
          const off = s * CAR_GAP - CAR_GAP / 2;
          mat4.compose(
            _tmp.set(
              pos.x + fx * off,
              RAIL_Y + (heightAt ? heightAt(pos.x + fx * off, pos.z + fz * off) : 0),
              pos.z + fz * off,
            ),
            quat, one,
          );
          for (const key of Object.keys(meshes)) meshes[key].setMatrixAt(slots[s], mat4);
        }
        for (const key of Object.keys(meshes)) meshes[key].instanceMatrix.needsUpdate = true;
      },
    };
    obj.update(0);
    trams.push(obj);
  });

  return { trams, meshes: Object.keys(meshes).length, cars: carCount };
}

const _tmp = new THREE.Vector3();
