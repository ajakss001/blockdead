import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3 } from 'three';
import { worldMaterials } from './look/worldMaterials';
import type { SurfaceBuffers } from './StaticBatch';

/** Main thread: turn merged bucket buffers into per-cell meshes sharing one set of packed GPU buffers. */
export function meshesFromBuffers(buffers: SurfaceBuffers[], name = 'batch'): Group {
  const group = new Group();
  group.name = name;
  const materials = worldMaterials();
  for (const b of buffers) {
    const pos = new BufferAttribute(b.position, 3);
    const nrm = new BufferAttribute(b.normal, 3, true);
    const col = new BufferAttribute(b.color, 3, true);
    const surfUv = new BufferAttribute(b.surfUv, 2);
    const layer = new BufferAttribute(b.layer, 1, false);
    const pbr = new BufferAttribute(b.pbr, 2, true);
    let idxAttr: BufferAttribute;
    let lod1Base = 0;
    if (b.indexLod1 && b.indexLod1.length > 0) {
      const combined =
        b.index instanceof Uint32Array || b.indexLod1 instanceof Uint32Array
          ? new Uint32Array(b.index.length + b.indexLod1.length)
          : new Uint16Array(b.index.length + b.indexLod1.length);
      combined.set(b.index, 0);
      lod1Base = b.index.length;
      combined.set(b.indexLod1, lod1Base);
      idxAttr = new BufferAttribute(combined, 1);
    } else {
      idxAttr = new BufferAttribute(b.index, 1);
    }

    const cells = b.cells && b.cells.length > 0 ? b.cells : null;
    if (!cells) {
      const g = new BufferGeometry();
      g.setAttribute('position', pos);
      g.setAttribute('normal', nrm);
      g.setAttribute('color', col);
      g.setAttribute('aSurfUv', surfUv);
      g.setAttribute('aLayer', layer);
      g.setAttribute('aPbr', pbr);
      g.setIndex(idxAttr);
      if (lod1Base > 0) g.setDrawRange(0, b.index.length);
      g.computeBoundingSphere();
      const mesh = new Mesh(g, materials[b.bucket]);
      mesh.name = `${name}:${b.bucket}`;
      mesh.userData.bucket = b.bucket;
      mesh.castShadow = b.bucket === 'cast';
      if (b.bucket === 'glass') mesh.renderOrder = 2;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      continue;
    }

    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      const g = new BufferGeometry();
      g.setAttribute('position', pos);
      g.setAttribute('normal', nrm);
      g.setAttribute('color', col);
      g.setAttribute('aSurfUv', surfUv);
      g.setAttribute('aLayer', layer);
      g.setAttribute('aPbr', pbr);
      g.setIndex(idxAttr);
      g.setDrawRange(cell.start, cell.count);
      g.boundingSphere = new Sphere(new Vector3(cell.sphere[0], cell.sphere[1], cell.sphere[2]), cell.sphere[3]);

      const mesh = new Mesh(g, materials[b.bucket]);
      mesh.name = cells.length === 1 ? `${name}:${b.bucket}` : `${name}:${b.bucket}:${ci}`;
      mesh.userData.bucket = b.bucket;
      mesh.userData.cellBoundsXZ = cell.boundsXZ;
      if (lod1Base > 0 && cell.lod1Start !== undefined && cell.lod1Count !== undefined) {
        mesh.userData.lod0 = [cell.start, cell.count] as [number, number];
        mesh.userData.lod1 = [lod1Base + cell.lod1Start, cell.lod1Count] as [number, number];
        mesh.userData.lodLevel = 0;
      }
      mesh.castShadow = b.bucket === 'cast';
      // Translucent glass and decals after everything opaque, always in the same order (no flicker).
      if (b.bucket === 'glass') mesh.renderOrder = 2;
      mesh.receiveShadow = true;
      // Static: skip per-frame matrix recomputation.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
  }
  return group;
}

export function disposeBatchGroup(group: Group): void {
  group.traverse((o) => (o as Mesh).geometry?.dispose());
  group.removeFromParent();
}
