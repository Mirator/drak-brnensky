import * as THREE from 'three';

const CHUNK_CELLS = 32;

export function buildTerrain(group, terrain) {
  const material = new THREE.MeshStandardMaterial({
    name: 'brno-terrain',
    color: 0x626459,
    roughness: 0.98,
    metalness: 0,
  });
  const meshes = [];
  const cellsX = terrain.width - 1;
  const cellsZ = terrain.height - 1;
  const normal = new THREE.Vector3();

  for (let z0 = 0; z0 < cellsZ; z0 += CHUNK_CELLS) {
    for (let x0 = 0; x0 < cellsX; x0 += CHUNK_CELLS) {
      const nx = Math.min(CHUNK_CELLS, cellsX - x0);
      const nz = Math.min(CHUNK_CELLS, cellsZ - z0);
      const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
      const normals = new Float32Array(positions.length);
      const uvs = new Float32Array((nx + 1) * (nz + 1) * 2);
      let p = 0;
      let t = 0;
      for (let z = 0; z <= nz; z++) {
        for (let x = 0; x <= nx; x++) {
          const wx = terrain.minX + (x0 + x) * terrain.cellSize;
          const wz = terrain.minZ + (z0 + z) * terrain.cellSize;
          positions[p] = wx;
          positions[p + 1] = terrain.heightAt(wx, wz);
          positions[p + 2] = wz;
          terrain.normalAt(wx, wz, normal);
          normals[p] = normal.x;
          normals[p + 1] = normal.y;
          normals[p + 2] = normal.z;
          p += 3;
          uvs[t++] = wx / 24;
          uvs[t++] = wz / 24;
        }
      }
      const indices = new Uint32Array(nx * nz * 6);
      let k = 0;
      const row = nx + 1;
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const a = z * row + x;
          const b = a + 1;
          const c = a + row + 1;
          const d = a + row;
          indices[k++] = a; indices[k++] = d; indices[k++] = b;
          indices[k++] = b; indices[k++] = d; indices[k++] = c;
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'terrain:dmr5g';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      meshes.push(mesh);
    }
  }
  return { meshes, material };
}
