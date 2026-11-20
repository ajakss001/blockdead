import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3 } from 'three';
import { worldMaterials } from './look/worldMaterials';
import type { CellRange, SurfaceBuffers } from './StaticBatch';

/**
 * Whether a chunk's 2x2 sub-cells become separate meshes (tight frustum and shadow culling) or one mesh
 * per bucket (fewer draw calls, chunk-granular culling).
 *
 * Weak GPUs - every mobile one - are draw-call bound long before they are geometry bound: a 64 m block cut
 * into 4 cells x 3 buckets is up to 12 calls per chunk, and Mali/Adreno charge far more per call than they
 * save by skipping a quadrant occasionally. Set from the quality preset (WorldScene.applyQuality).
 */
let subCellMeshes = true;

export function setSubCellSplit(on: boolean): void {
  subCellMeshes = on;
}

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
    if (!cells || !subCellMeshes) {
      // One mesh for the whole bucket; when the worker split it into sub-cells, span all of them.
      const span = cells ? mergeCells(cells) : null;
      const g = new BufferGeometry();
      g.setAttribute('position', pos);
      g.setAttribute('normal', nrm);
      g.setAttribute('color', col);
      g.setAttribute('aSurfUv', surfUv);
      g.setAttribute('aLayer', layer);
      g.setAttribute('aPbr', pbr);
      g.setIndex(idxAttr);
      if (lod1Base > 0) g.setDrawRange(0, b.index.length);
      if (span) g.boundingSphere = new Sphere(new Vector3(span.sphere[0], span.sphere[1], span.sphere[2]), span.sphere[3]);
      else g.computeBoundingSphere();
      const mesh = new Mesh(g, materials[b.bucket]);
      mesh.name = `${name}:${b.bucket}`;
      mesh.userData.bucket = b.bucket;
      if (span) mesh.userData.cellBoundsXZ = span.boundsXZ;
      if (span && lod1Base > 0 && span.lod1Start !== undefined && span.lod1Count !== undefined) {
        mesh.userData.lod0 = [span.start, span.count] as [number, number];
        mesh.userData.lod1 = [lod1Base + span.lod1Start, span.lod1Count] as [number, number];
        mesh.userData.lodLevel = 0;
      }
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

/** Union of a bucket's sub-cells: one draw range, one bounding sphere, one XZ box. */
function mergeCells(cells: readonly CellRange[]): CellRange {
  const first = cells[0];
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of cells) {
    const [cx, cy, cz, r] = c.sphere;
    if (cx - r < minX) minX = cx - r;
    if (cx + r > maxX) maxX = cx + r;
    if (cy - r < minY) minY = cy - r;
    if (cy + r > maxY) maxY = cy + r;
    if (cz - r < minZ) minZ = cz - r;
    if (cz + r > maxZ) maxZ = cz + r;
  }
  const sx = (minX + maxX) * 0.5;
  const sy = (minY + maxY) * 0.5;
  const sz = (minZ + maxZ) * 0.5;
  let r2 = 0;
  for (const c of cells) {
    const [cx, cy, cz, r] = c.sphere;
    const dx = cx - sx, dy = cy - sy, dz = cz - sz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + r;
    if (d > r2) r2 = d;
  }
  let count = 0;
  let lod1Count = 0;
  let hasLod1 = false;
  for (const c of cells) {
    count += c.count;
    if (c.lod1Count !== undefined) {
      lod1Count += c.lod1Count;
      hasLod1 = true;
    }
  }
  const out: CellRange = {
    start: first.start,
    count,
    sphere: [sx, sy, sz, r2],
    boundsXZ: [
      Math.min(...cells.map((c) => c.boundsXZ[0])),
      Math.min(...cells.map((c) => c.boundsXZ[1])),
      Math.max(...cells.map((c) => c.boundsXZ[2])),
      Math.max(...cells.map((c) => c.boundsXZ[3])),
    ],
  };
  if (hasLod1) {
    out.lod1Start = Math.min(...cells.map((c) => c.lod1Start ?? 0));
    out.lod1Count = lod1Count;
  }
  return out;
}
