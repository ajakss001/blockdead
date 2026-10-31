import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import { worldMaterials } from './look/worldMaterials';
import type { SurfaceBuffers } from './StaticBatch';

/** Main thread: turn merged bucket buffers into (at most three) meshes with the shared world materials. */
export function meshesFromBuffers(buffers: SurfaceBuffers[], name = 'batch'): Group {
  const group = new Group();
  group.name = name;
  const materials = worldMaterials();
  for (const b of buffers) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(b.position, 3));
    g.setAttribute('normal', new BufferAttribute(b.normal, 3));
    g.setAttribute('color', new BufferAttribute(b.color, 3));
    g.setAttribute('aSurfUv', new BufferAttribute(b.surfUv, 2));
    g.setAttribute('aLayer', new BufferAttribute(b.layer, 1));
    g.setAttribute('aPbr', new BufferAttribute(b.pbr, 2));
    g.computeBoundingSphere();
    const mesh = new Mesh(g, materials[b.bucket]);
    mesh.name = `${name}:${b.bucket}`;
    mesh.castShadow = b.bucket === 'cast';
    // Translucent glass and decals after everything opaque, always in the same order (no flicker).
    if (b.bucket === 'glass') mesh.renderOrder = 2;
    mesh.receiveShadow = true;
    // Static: skip per-frame matrix recomputation.
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }
  return group;
}

export function disposeBatchGroup(group: Group): void {
  group.traverse((o) => (o as Mesh).geometry?.dispose());
  group.removeFromParent();
}
