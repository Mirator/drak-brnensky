import * as THREE from 'three';
import { C } from './materials.js';
import { SkinBuilder, place, box } from './mesh.js';

/* ==================================================================
   PLAZMOVÝ VRHAČ — the plasma thrower.

   Local frame: -Z is the muzzle direction, +Y up, +X the shooter's
   right. Built to read in silhouette from behind: a deep stock, a
   fat vented shroud, three emitter coils and a glowing cell that
   sits high on the receiver where the over-the-shoulder camera can
   always see it.

   Hierarchy:
     root        placed relative to the chest bone by the aim layer
       recoil    short-lived kick (translation + pitch)
         metal / glow meshes, coils, muzzle, grip frames
       (mag)     child of recoil, detached during a reload
   ================================================================== */

/** Grip frames: -Y runs down the grip, so a hand bone can copy them. */
export function buildWeapon(materials) {
  const M = new SkinBuilder(null); // metal parts
  const G = new SkinBuilder(null); // emissive parts
  const K = new SkinBuilder(null); // the magazine / plasma cell

  const NW = null; // unskinned

  /* ---- receiver ---- */
  box(M, 0.078, 0.118, 0.300, place(0, 0, 0.020), C.metal, NW);
  box(M, 0.086, 0.030, 0.250, place(0, 0.070, 0.010), C.metalDark, NW);
  box(M, 0.038, 0.022, 0.210, place(0, 0.090, 0.010), C.metalLight, NW); // top rail
  box(M, 0.092, 0.052, 0.070, place(0, -0.012, -0.148), C.metalLight, NW); // shroud collar
  // ejection / vent block on the right
  box(M, 0.020, 0.052, 0.110, place(0.048, 0.020, 0.040), C.metalDark, NW);
  // charging handle
  box(M, 0.026, 0.020, 0.070, place(-0.050, 0.046, 0.076), C.metalLight, NW);

  /* ---- barrel shroud ---- */
  M.chain([
    { p: [0, -0.004, -0.140], r: [0.042, 0.044], w: NW },
    { p: [0, -0.004, -0.230], r: [0.040, 0.042], w: NW },
    { p: [0, -0.002, -0.330], r: [0.037, 0.039], w: NW },
    { p: [0, 0.000, -0.420], r: [0.033, 0.035], w: NW },
    { p: [0, 0.002, -0.452], r: [0.030, 0.031], w: NW },
  ], { radial: 10, power: 0.72, color: C.metal, up: [0, 1, 0] });
  // vent slots
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      box(M, 0.014, 0.026, 0.040, place(s * 0.036, 0.012, -0.190 - i * 0.058), C.metalDark, NW);
    }
  }
  // inner barrel + emitter cone
  M.addGeometry(new THREE.CylinderGeometry(0.019, 0.016, 0.330, 8, 1),
    place(0, 0, -0.300, Math.PI / 2), C.metalDark, NW);
  M.addGeometry(new THREE.CylinderGeometry(0.034, 0.024, 0.046, 10, 1),
    place(0, 0.002, -0.474, Math.PI / 2), C.metalLight, NW);

  /* ---- emitter coils (glow) ---- */
  for (let i = 0; i < 3; i++) {
    G.addGeometry(new THREE.TorusGeometry(0.046 - i * 0.003, 0.011, 5, 12),
      place(0, -0.002, -0.208 - i * 0.078, Math.PI / 2), C.glow, NW);
  }
  // muzzle iris
  G.addGeometry(new THREE.CylinderGeometry(0.020, 0.020, 0.012, 10, 1),
    place(0, 0.002, -0.492, Math.PI / 2), C.glow, NW);
  // cell window high on the receiver — visible over the shoulder
  box(G, 0.050, 0.026, 0.140, place(0, 0.058, 0.086), C.glow, NW);
  box(M, 0.070, 0.014, 0.160, place(0, 0.074, 0.086), C.metalDark, NW);

  /* ---- optic ---- */
  box(M, 0.044, 0.046, 0.086, place(0, 0.124, -0.030), C.metalDark, NW);
  box(M, 0.052, 0.012, 0.020, place(0, 0.150, -0.030), C.metalLight, NW);
  G.addGeometry(new THREE.CylinderGeometry(0.015, 0.015, 0.008, 8, 1),
    place(0, 0.124, -0.074, Math.PI / 2), C.glowWarm, NW);

  /* ---- magazine well ---- */
  box(M, 0.070, 0.070, 0.092, place(0, -0.082, 0.026, 0.06), C.metalDark, NW);

  /* ---- pistol grip ---- */
  M.chain([
    { p: [0, -0.052, 0.106], r: [0.026, 0.030], w: NW },
    { p: [0, -0.108, 0.128], r: [0.024, 0.034], w: NW },
    { p: [0, -0.166, 0.152], r: [0.022, 0.030], w: NW },
    { p: [0, -0.196, 0.164], r: [0.019, 0.024], w: NW },
  ], { radial: 10, power: 0.7, color: C.rubber, up: [0, 0, -1], domeEnd: true });
  box(M, 0.030, 0.050, 0.026, place(0, -0.062, 0.076, -0.5), C.metalDark, NW); // trigger guard
  box(M, 0.012, 0.030, 0.012, place(0, -0.058, 0.070, -0.3), C.metalLight, NW); // trigger

  /* ---- fore-grip: close to the receiver, because a 0.55 m arm cannot
     reach a fore-end 0.45 m in front of the shoulder ---- */
  M.chain([
    { p: [0, -0.056, -0.078], r: [0.024, 0.026], w: NW },
    { p: [0, -0.114, -0.086], r: [0.026, 0.028], w: NW },
    { p: [0, -0.170, -0.094], r: [0.022, 0.024], w: NW },
  ], { radial: 10, power: 0.75, color: C.rubber, up: [0, 0, -1], domeEnd: true });
  box(M, 0.052, 0.022, 0.052, place(0, -0.046, -0.082), C.metalDark, NW);
  // hand-stop / rail section further forward keeps the fore-end reading long
  box(M, 0.062, 0.018, 0.140, place(0, -0.048, -0.212), C.metalDark, NW);

  /* ---- stock ---- */
  box(M, 0.062, 0.100, 0.070, place(0, -0.006, 0.200), C.metal, NW);
  box(M, 0.036, 0.028, 0.150, place(0, 0.026, 0.288), C.metalDark, NW);
  box(M, 0.036, 0.028, 0.150, place(0, -0.038, 0.288), C.metalDark, NW);
  box(M, 0.070, 0.126, 0.036, place(0, -0.006, 0.372, -0.10), C.rubber, NW);
  box(M, 0.058, 0.030, 0.090, place(0, 0.058, 0.286, 0.06), C.rubber, NW); // cheek rest
  // sling loop
  M.addGeometry(new THREE.TorusGeometry(0.018, 0.005, 4, 8),
    place(-0.036, -0.030, 0.176, 0, Math.PI / 2, 0), C.metalLight, NW);

  /* ---- magazine: a glowing plasma canister ---- */
  K.chain([
    { p: [0, 0.052, 0], r: [0.028, 0.036], w: NW, c: C.metalDark },
    { p: [0, 0.020, 0], r: [0.030, 0.038], w: NW, c: 0x7fe8ff },
    { p: [0, -0.040, 0], r: [0.030, 0.038], w: NW, c: 0x9cf6ff },
    { p: [0, -0.078, 0], r: [0.026, 0.032], w: NW, c: 0x3f9fc0 },
  ], { radial: 10, power: 0.7, color: C.glow, up: [0, 0, -1], domeEnd: true });
  box(K, 0.062, 0.016, 0.078, place(0, 0.046, 0), C.metalDark, NW);
  box(K, 0.062, 0.012, 0.078, place(0, -0.026, 0), C.metalDark, NW);

  /* ---- assembly ---- */
  const root = new THREE.Group();
  root.name = 'weaponRoot';
  const recoil = new THREE.Group();
  recoil.name = 'weaponRecoil';
  root.add(recoil);

  const metalMesh = new THREE.Mesh(M.build(), materials.metal);
  const glowMesh = new THREE.Mesh(G.build(), materials.glow);
  recoil.add(metalMesh, glowMesh);

  const magMat = materials.glow.clone();
  magMat.emissiveIntensity = 2.2;
  const mag = new THREE.Mesh(K.build(), magMat);
  const magHome = new THREE.Object3D();
  magHome.position.set(0, -0.112, 0.028);
  magHome.rotation.x = 0.06;
  recoil.add(magHome);
  magHome.add(mag);

  /* ---- frames the animation layer reads ---- */
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.002, -0.502);
  recoil.add(muzzle);

  const gripR = new THREE.Object3D();
  gripR.position.set(0, -0.076, 0.116);
  gripR.rotation.x = -0.36;
  recoil.add(gripR);
  const wristR = new THREE.Object3D();
  wristR.position.set(0, 0.084, 0.006);
  gripR.add(wristR);

  const gripL = new THREE.Object3D();
  gripL.position.set(0, -0.084, -0.082);
  gripL.rotation.x = 0.14;
  recoil.add(gripL);
  const wristL = new THREE.Object3D();
  wristL.position.set(0, 0.090, -0.004);
  gripL.add(wristL);

  const magPort = new THREE.Object3D();
  magPort.position.set(0, -0.128, 0.028);
  recoil.add(magPort);

  const charge = new THREE.Object3D();
  charge.position.set(-0.072, 0.046, 0.080);
  recoil.add(charge);

  for (const m of [metalMesh, glowMesh, mag]) {
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
  }

  return {
    root, recoil, muzzle, gripR, gripL, wristR, wristL, magPort, charge,
    mag, magHome, magMat,
    meshes: [metalMesh, glowMesh, mag],
    glowMat: materials.glow,
    tris: M.triangles + G.triangles + K.triangles,
  };
}
