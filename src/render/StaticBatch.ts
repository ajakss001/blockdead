import { BufferAttribute, type BufferGeometry, Color, type ColorRepresentation, type Matrix4, Mesh, MeshLambertMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects static geometry with baked vertex colors and merges it into ONE mesh / ONE draw call.
 * This is the building block for world chunks (stage 2): a chunk = one StaticBatch.
 */
export class StaticBatch {
  private readonly parts: BufferGeometry[] = [];
  private readonly color = new Color();

  /**
   * Template geometry is cloned (non-indexed, for flat shading), transformed and colored.
   * Pass color = null to keep the geometry's own `color` attribute (per-vertex variation).
   */
  add(template: BufferGeometry, color: ColorRepresentation | null, matrix?: Matrix4): void {
    const g = template.index ? template.toNonIndexed() : template.clone();
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    if (matrix) g.applyMatrix4(matrix);
    if (color !== null || !g.getAttribute('color')) {
      this.color.set(color ?? 0xffffff);
      const n = g.getAttribute('position').count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        arr[i * 3] = this.color.r;
        arr[i * 3 + 1] = this.color.g;
        arr[i * 3 + 2] = this.color.b;
      }
      g.setAttribute('color', new BufferAttribute(arr, 3));
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    this.parts.push(g);
  }

  get partCount(): number {
    return this.parts.length;
  }

  build(): Mesh {
    const merged = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error('StaticBatch: incompatible geometry attributes');
    merged.computeBoundingSphere();
    return new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  }
}
