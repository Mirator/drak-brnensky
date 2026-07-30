/**
 * Canvas-generated PBR textures — facades, roofs, stone, cobbles, and the
 * misc sprite/decal helpers used by vfx.js. Every export below existed
 * before the materials overhaul and keeps its exact name, signature and
 * return type; city.js and landmarks.js call these unmodified. The actual
 * generation logic now lives in src/textures/*, split by category, and
 * builds on a shared procedural-PBR toolkit (tileable noise, height→normal,
 * cavity AO, packed ORM) — see src/materials.js for the new material
 * registry other engineers should reach for on anything not listed here.
 */
import * as THREE from 'three';
import { canvas, tex } from './textures/core.js';
import { BAY_W, FLOOR_H, FACADE_STYLES, makeFacadeMaterials } from './textures/facades.js';
import { makeRoofMaterial } from './textures/roofs.js';
import { makeStoneMaterial } from './textures/stone.js';
import { makeCobbleTexture } from './textures/ground.js';
import { glassMaterial } from './textures/misc.js';

export { BAY_W, FLOOR_H, FACADE_STYLES, makeFacadeMaterials };
export { makeRoofMaterial };
export { makeStoneMaterial };
export { makeCobbleTexture };
export { glassMaterial };

/* ------------------------------------------------------------------ */
/* misc simple sprites — unchanged behaviour, still plain canvases       */
/* ------------------------------------------------------------------ */
export function makeGradientSprite(inner = '#ffd08a', outer = 'rgba(255,140,40,0)') {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeSmokeTexture() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { canvas as makeCanvas, tex as makeTexture };
