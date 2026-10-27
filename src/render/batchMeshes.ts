import { BufferAttribute, BufferGeometry, Group, Mesh } from 'three';
import { surfaceMaterial } from './look/materials';
import { SURFACES } from './look/surfaces';
import type { SurfaceBuffers } from './StaticBatch';

/** Main thread: turn merged surface buffers into meshes with the shared grunge materials. */
export function meshesFromBuffers(buffers: SurfaceBuffers[], name = 'batch'): Group {
  const group = new Group();
  group.name = name;
  for (const b of buffers) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(b.position, 3));
    g.setAttribute('normal', new BufferAttribute(b.normal, 3));
    g.setAttribute('color', new BufferAttribute(b.color, 3));
    g.setAttribute('uv', new BufferAttribute(b.uv, 2));
    g.computeBoundingSphere();
    const mesh = new Mesh(g, surfaceMaterial(b.surface));
    mesh.name = `${name}:${b.surface}`;
    mesh.castShadow = SURFACES[b.surface].castShadow;
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
