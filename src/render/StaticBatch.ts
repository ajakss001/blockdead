import { BufferAttribute, type BufferGeometry, Color, type ColorRepresentation, type Matrix4 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Bucket, bucketOf, type Surface, SURFACES, surfaceLayer } from './look/surfaces';

/**
 * Per-vertex color modifier, called with world position and the triangle normal.
 * Used to put dirt where it belongs (mud low near wheels, dust on upward faces) without textures.
 */
export type VertexTint = (color: Color, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;

/** Merged vertex data of one draw bucket — plain typed arrays, transferable from a Web Worker. */
export interface SurfaceBuffers {
  bucket: Bucket;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** World-projected texture coordinates (meters / tile size). */
  surfUv: Float32Array;
  /** Texture-array layer of the surface, one float per vertex. */
  layer: Float32Array;
  /** Roughness, metalness per vertex. */
  pbr: Float32Array;
}

/**
 * Collects static geometry with baked vertex colors, world-aligned UVs and per-vertex surface data
 * (texture-array layer, roughness, metalness) and merges it into at most three draw buckets.
 * Contains no materials or GPU objects, so it runs inside the chunk worker; meshes are made
 * on the main thread by `meshesFromBuffers`.
 */
export class StaticBatch {
  private readonly parts = new Map<Bucket, BufferGeometry[]>();
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
    const spec = SURFACES[surface];
    const n = g.getAttribute('position').count;
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    g.setAttribute('aSurfUv', worldUVs(g, spec.tile));
    g.setAttribute('aLayer', new BufferAttribute(new Float32Array(n).fill(surfaceLayer(surface)), 1));
    const pbr = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pbr[i * 2] = spec.roughness;
      pbr[i * 2 + 1] = spec.metalness;
    }
    g.setAttribute('aPbr', new BufferAttribute(pbr, 2));
    const bucket = bucketOf(surface);
    const list = this.parts.get(bucket);
    if (list) list.push(g);
    else this.parts.set(bucket, [g]);
  }

  get partCount(): number {
    let n = 0;
    for (const list of this.parts.values()) n += list.length;
    return n;
  }

  /** Merge everything per bucket and hand out the raw arrays. Clears the batch. */
  buildBuffers(): SurfaceBuffers[] {
    const out: SurfaceBuffers[] = [];
    for (const [bucket, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      for (const p of list) p.dispose();
      if (!merged) throw new Error(`StaticBatch: incompatible geometry attributes (${bucket})`);
      const arr = (name: string) => merged.getAttribute(name).array as Float32Array;
      out.push({
        bucket,
        position: arr('position'),
        normal: arr('normal'),
        color: arr('color'),
        surfUv: arr('aSurfUv'),
        layer: arr('aLayer'),
        pbr: arr('aPbr'),
      });
    }
    this.parts.clear();
    return out;
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
