import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  type ColorRepresentation,
  Group,
  type Matrix4,
  Mesh,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Surface, SURFACES, surfaceMaterial } from './look/materials';

/**
 * Per-vertex color modifier, called with world position and the triangle normal.
 * Used to put dirt where it belongs (mud low near wheels, dust on upward faces) without textures.
 */
export type VertexTint = (color: Color, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;

/**
 * Collects static geometry with baked vertex colors and world-aligned UVs, and merges it into
 * one mesh per surface type (≈ 8 draw calls for a whole chunk, regardless of object count).
 * This is the building block for world chunks (stage 2).
 */
export class StaticBatch {
  private readonly parts = new Map<Surface, BufferGeometry[]>();
  private readonly color = new Color();

  /**
   * Template geometry is cloned (non-indexed), transformed, colored and UV-mapped in world space.
   * Pass color = null to keep the geometry's own `color` attribute (per-vertex variation).
   */
  add(
    template: BufferGeometry,
    color: ColorRepresentation | null,
    matrix?: Matrix4,
    surface: Surface = 'plaster',
    tint?: VertexTint,
  ): void {
    const g = template.index ? template.toNonIndexed() : template.clone();
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
    if (tint) applyTint(g, tint, this.color);
    g.setAttribute('uv', worldUVs(g, SURFACES[surface].tile));
    const list = this.parts.get(surface);
    if (list) list.push(g);
    else this.parts.set(surface, [g]);
  }

  get partCount(): number {
    let n = 0;
    for (const list of this.parts.values()) n += list.length;
    return n;
  }

  build(): Group {
    const group = new Group();
    for (const [surface, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const p of list) p.dispose();
      if (!merged) throw new Error(`StaticBatch: incompatible geometry attributes (${surface})`);
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, surfaceMaterial(surface));
      mesh.name = `batch:${surface}`;
      mesh.castShadow = SURFACES[surface].castShadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}

/**
 * Box-projected UVs from world position: each triangle uses the plane its normal faces most.
 * Textures keep a constant texel density on every wall, floor and prop, with zero runtime cost.
 */
function worldUVs(g: BufferGeometry, tile: number): BufferAttribute {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const inv = 1 / tile;
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ax = pos.getX(i);
    const ay = pos.getY(i);
    const az = pos.getZ(i);
    const ux = pos.getX(i + 1) - ax;
    const uy = pos.getY(i + 1) - ay;
    const uz = pos.getZ(i + 1) - az;
    const vx = pos.getX(i + 2) - ax;
    const vy = pos.getY(i + 2) - ay;
    const vz = pos.getZ(i + 2) - az;
    const nx = Math.abs(uy * vz - uz * vy);
    const ny = Math.abs(uz * vx - ux * vz);
    const nz = Math.abs(ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k);
      const y = pos.getY(i + k);
      const z = pos.getZ(i + k);
      let u: number;
      let v: number;
      if (ny >= nx && ny >= nz) {
        u = x;
        v = z;
      } else if (nx >= nz) {
        u = z;
        v = y;
      } else {
        u = x;
        v = y;
      }
      uv[(i + k) * 2] = u * inv;
      uv[(i + k) * 2 + 1] = v * inv;
    }
  }
  return new BufferAttribute(uv, 2);
}

function applyTint(g: BufferGeometry, tint: VertexTint, tmp: Color): void {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  for (let i = 0; i + 2 < pos.count; i += 3) {
    const ux = pos.getX(i + 1) - pos.getX(i);
    const uy = pos.getY(i + 1) - pos.getY(i);
    const uz = pos.getZ(i + 1) - pos.getZ(i);
    const vx = pos.getX(i + 2) - pos.getX(i);
    const vy = pos.getY(i + 2) - pos.getY(i);
    const vz = pos.getZ(i + 2) - pos.getZ(i);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    for (let k = i; k < i + 3; k++) {
      tmp.setRGB(col.getX(k), col.getY(k), col.getZ(k));
      tint(tmp, pos.getX(k), pos.getY(k), pos.getZ(k), nx, ny, nz);
      col.setXYZ(k, tmp.r, tmp.g, tmp.b);
    }
  }
}
