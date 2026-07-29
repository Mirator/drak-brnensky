import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CollisionWorld } from '../src/physics.js';

test('raycast detects thin geometry without tunnelling', () => {
  const world = new CollisionWorld();
  world.add(5, 0, 0.1, 4, 0, 3);

  const distance = world.raycast(
    new THREE.Vector3(0, 1.5, 0),
    new THREE.Vector3(1, 0, 0),
    10,
  );

  assert.ok(Math.abs(distance - 4.95) < 1e-9);
});

test('line of sight distinguishes blocked and clear paths', () => {
  const world = new CollisionWorld();
  world.add(5, 0, 1, 4, 0, 3);

  assert.equal(
    world.hasLineOfSight(
      new THREE.Vector3(0, 1.5, 0),
      new THREE.Vector3(10, 1.5, 0),
    ),
    false,
  );
  assert.equal(
    world.hasLineOfSight(
      new THREE.Vector3(0, 4, 0),
      new THREE.Vector3(10, 4, 0),
    ),
    true,
  );
});

test('ground height returns the highest reachable surface', () => {
  const world = new CollisionWorld();
  world.add(0, 0, 4, 4, 0, 1);
  world.add(0, 0, 2, 2, 1, 2);

  assert.equal(world.groundHeight(0, 0, 3), 3);
  assert.equal(world.groundHeight(0, 0, 1.5), 1);
});

test('remove clears a collider from the world and every occupied grid cell', () => {
  const world = new CollisionWorld();
  const box = world.add(24, 24, 30, 30, 0, 4);

  assert.equal(world.raycast(
    new THREE.Vector3(0, 2, 24),
    new THREE.Vector3(1, 0, 0),
    50,
  ), 9);
  assert.equal(world.remove(box), true);
  assert.equal(world.boxes.includes(box), false);
  assert.equal(world.query(0, 0, 50, 50).includes(box), false);
  assert.equal(world.raycast(
    new THREE.Vector3(0, 2, 24),
    new THREE.Vector3(1, 0, 0),
    50,
  ), Infinity);
  assert.equal(world.remove(box), false);
});
