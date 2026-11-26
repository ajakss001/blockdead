import { type BufferGeometry, Color, type ColorRepresentation, Matrix3, Matrix4, PlaneGeometry } from 'three';
import type { GlbPlacement } from '../world/worldModels';
import { type Bucket, bucketOf, MODEL_LAYER_BASE, type Surface, SURFACES, surfaceLayer } from './look/surfaces';

const _shadowLocal = new Matrix4();
const _shadowWorld = new Matrix4();
let _shadowQuad: PlaneGeometry | null = null;
function shadowQuad(): PlaneGeometry {
  if (!_shadowQuad) _shadowQuad = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return _shadowQuad;
}

/**
 * Per-vertex color modifier, called with world position and the vertex/triangle normal.
 * Used to put dirt where it belongs (mud low near wheels, dust on upward faces) without textures.
 */
export type VertexTint = (color: Color, x: number, y: number, z: number, nx: number, ny: number, nz: number) => void;

/** Sub-cell draw slice sharing the chunk bucket's vertex/index buffers (32×32 m quadrant). */
export interface CellRange {
  start: number;
  count: number;
  lod1Start?: number;
  lod1Count?: number;
  sphere: [number, number, number, number];
  boundsXZ: [number, number, number, number];
}

/**
 * Merged, indexed & quantized vertex data of one draw bucket — plain typed arrays,
 * transferable from a Web Worker.
 * Vertex footprint: 29 B/vert (f32 pos, i8 norm, u8 col, f32 uv, u8 layer, u8 pbr) + shared indices.
 */
export interface SurfaceBuffers {
  bucket: Bucket;
  position: Float32Array;
  /** Quantized signed byte normals [-127..127] (normalized GPU attribute). */
  normal: Int8Array;
  /** Quantized RGB vertex colors [0..255] (normalized GPU attribute). */
  color: Uint8Array;
  /** World-projected texture coordinates (meters / tile size). */
  surfUv: Float32Array;
  /** Texture-array layer of the surface (0..255), non-normalized GPU attribute. */
  layer: Uint8Array;
  /** Roughness, metalness per vertex [0..255] (normalized GPU attribute). */
  pbr: Uint8Array;
  /** Full-detail triangle indices across all sub-cells. */
  index: Uint16Array | Uint32Array;
  /** Optional simplified vehicle LOD1 triangle indices for distant draw calls. */
  indexLod1?: Uint16Array | Uint32Array;
  /** Sub-cell ranges into `index` (and `indexLod1`), each with precomputed bounds. */
  cells?: CellRange[];
}

interface BucketAcc {
  pos: Float32Array;
  nrm: Int8Array;
  col: Uint8Array;
  uv: Float32Array;
  layer: Uint8Array;
  pbr: Uint8Array;
  vCount: number;
  vCap: number;
  idx0: Uint32Array[];
  iCount0: number[];
  idx1: Uint32Array[] | null;
  iCount1: number[] | null;
  hasLod1: boolean;
}

function createAcc(bucket: Bucket, cells: number): BucketAcc {
  const vCap = 512;
  const iCap = 512;
  return {
    pos: new Float32Array(vCap * 3),
    nrm: new Int8Array(vCap * 3),
    col: new Uint8Array(vCap * 3),
    uv: new Float32Array(vCap * 2),
    layer: new Uint8Array(vCap),
    pbr: new Uint8Array(vCap * 2),
    vCount: 0,
    vCap,
    idx0: Array.from({ length: cells }, () => new Uint32Array(iCap)),
    iCount0: new Array<number>(cells).fill(0),
    idx1: bucket === 'cast' ? Array.from({ length: cells }, () => new Uint32Array(iCap)) : null,
    iCount1: bucket === 'cast' ? new Array<number>(cells).fill(0) : null,
    hasLod1: false,
  };
}

function ensureVerts(acc: BucketAcc, extra: number): void {
  const need = acc.vCount + extra;
  if (need <= acc.vCap) return;
  let cap = acc.vCap;
  while (cap < need) cap *= 2;
  const growF32 = (old: Float32Array, k: number) => {
    const n = new Float32Array(cap * k);
    n.set(old.subarray(0, acc.vCount * k));
    return n;
  };
  const growI8 = (old: Int8Array, k: number) => {
    const n = new Int8Array(cap * k);
    n.set(old.subarray(0, acc.vCount * k));
    return n;
  };
  const growU8 = (old: Uint8Array, k: number) => {
    const n = new Uint8Array(cap * k);
    n.set(old.subarray(0, acc.vCount * k));
    return n;
  };
  acc.pos = growF32(acc.pos, 3);
  acc.nrm = growI8(acc.nrm, 3);
  acc.col = growU8(acc.col, 3);
  acc.uv = growF32(acc.uv, 2);
  acc.layer = growU8(acc.layer, 1);
  acc.pbr = growU8(acc.pbr, 2);
  acc.vCap = cap;
}

function pushTri(bufs: Uint32Array[], counts: number[], q: number, a: number, b: number, c: number): void {
  let arr = bufs[q];
  const n = counts[q];
  if (n + 3 > arr.length) {
    const next = new Uint32Array(arr.length * 2);
    next.set(arr.subarray(0, n));
    arr = next;
    bufs[q] = arr;
  }
  arr[n] = a;
  arr[n + 1] = b;
  arr[n + 2] = c;
  counts[q] = n + 3;
}

const qNorm = (v: number) => Math.max(-127, Math.min(127, Math.round(v * 127)));
const qByte = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/**
 * Collects static geometry with baked vertex colors, world-aligned UVs and per-vertex surface data
 * (texture-array layer, roughness, metalness) and merges it directly into indexed, quantized
 * typed-array buckets — optionally split into 2×2 spatial sub-cells (32×32 m) for tight frustum
 * and shadow culling. Runs inside the chunk worker; GPU meshes are created by `meshesFromBuffers`.
 */
export class StaticBatch {
  readonly glbs: GlbPlacement[] = [];
  private readonly accs = new Map<Bucket, BucketAcc>();
  private readonly color = new Color();
  private readonly tmpColor = new Color();
  private readonly nrmMat = new Matrix3();
  private readonly splitX: number;
  private readonly splitZ: number;
  private readonly cellCount: number;
  private parts = 0;

  // Reusable scratch buffers to keep per-chunk worker GC near zero.
  private tPos = new Float32Array(0);
  private tNrm = new Float32Array(0);
  private tCol = new Float32Array(0);
  private remap = new Int32Array(0);

  constructor(splitCenter?: readonly [number, number]) {
    if (splitCenter) {
      this.splitX = splitCenter[0];
      this.splitZ = splitCenter[1];
      this.cellCount = 4;
    } else {
      this.splitX = 0;
      this.splitZ = 0;
      this.cellCount = 1;
    }
  }

  private acc(bucket: Bucket): BucketAcc {
    let a = this.accs.get(bucket);
    if (!a) {
      a = createAcc(bucket, this.cellCount);
      this.accs.set(bucket, a);
    }
    return a;
  }

  private quadrant(x: number, z: number): number {
    if (this.cellCount === 1) return 0;
    return (x >= this.splitX ? 1 : 0) | (z >= this.splitZ ? 2 : 0);
  }

  private ensureScratch(vCount: number, remapSize: number): void {
    if (this.tPos.length < vCount * 3) this.tPos = new Float32Array(vCount * 3);
    if (this.tNrm.length < vCount * 3) this.tNrm = new Float32Array(vCount * 3);
    if (this.tCol.length < vCount * 3) this.tCol = new Float32Array(vCount * 3);
    if (this.remap.length < remapSize) this.remap = new Int32Array(remapSize);
    this.remap.fill(-1, 0, remapSize);
  }

  /**
   * Template geometry is kept indexed, transformed, colored and UV-mapped in world space.
   * Pass color = null to keep the geometry's own `color` attribute (per-vertex variation).
   */
  add(
    template: BufferGeometry,
    color: ColorRepresentation | null,
    matrix?: Matrix4,
    surface: Surface = 'plaster',
    tint?: VertexTint,
  ): void {
    let src = template;
    let tempClone: BufferGeometry | null = null;
    if (!template.getAttribute('normal')) {
      tempClone = template.clone();
      tempClone.computeVertexNormals();
      src = tempClone;
    }
    const posAttr = src.getAttribute('position');
    const nrmAttr = src.getAttribute('normal');
    const svCount = posAttr.count;
    if (svCount === 0) {
      tempClone?.dispose();
      return;
    }

    const ownCol = color === null ? src.getAttribute('color') : undefined;
    const spec = SURFACES[surface];
    const ownUv = spec.decal ? src.getAttribute('uv') : undefined;
    const useOwnUv = !!(spec.decal && ownUv);

    const remapStride = useOwnUv ? 1 : 3;
    this.ensureScratch(svCount, svCount * remapStride);

    if (color !== null || !ownCol) this.color.set(color ?? 0xffffff);

    const e = matrix?.elements;
    let n0 = 1, n1 = 0, n2 = 0, n3 = 0, n4 = 1, n5 = 0, n6 = 0, n7 = 0, n8 = 1;
    if (matrix) {
      this.nrmMat.getNormalMatrix(matrix);
      const ne = this.nrmMat.elements;
      n0 = ne[0]; n1 = ne[1]; n2 = ne[2];
      n3 = ne[3]; n4 = ne[4]; n5 = ne[5];
      n6 = ne[6]; n7 = ne[7]; n8 = ne[8];
    }

    for (let i = 0; i < svCount; i++) {
      const i3 = i * 3;
      const sx = posAttr.getX(i);
      const sy = posAttr.getY(i);
      const sz = posAttr.getZ(i);
      if (e) {
        this.tPos[i3] = e[0] * sx + e[4] * sy + e[8] * sz + e[12];
        this.tPos[i3 + 1] = e[1] * sx + e[5] * sy + e[9] * sz + e[13];
        this.tPos[i3 + 2] = e[2] * sx + e[6] * sy + e[10] * sz + e[14];
      } else {
        this.tPos[i3] = sx;
        this.tPos[i3 + 1] = sy;
        this.tPos[i3 + 2] = sz;
      }

      const snx = nrmAttr.getX(i);
      const sny = nrmAttr.getY(i);
      const snz = nrmAttr.getZ(i);
      if (matrix) {
        let nx = n0 * snx + n3 * sny + n6 * snz;
        let ny = n1 * snx + n4 * sny + n7 * snz;
        let nz = n2 * snx + n5 * sny + n8 * snz;
        const nl = Math.hypot(nx, ny, nz) || 1;
        this.tNrm[i3] = nx / nl;
        this.tNrm[i3 + 1] = ny / nl;
        this.tNrm[i3 + 2] = nz / nl;
      } else {
        this.tNrm[i3] = snx;
        this.tNrm[i3 + 1] = sny;
        this.tNrm[i3 + 2] = snz;
      }

      if (ownCol) {
        this.tCol[i3] = ownCol.getX(i);
        this.tCol[i3 + 1] = ownCol.getY(i);
        this.tCol[i3 + 2] = ownCol.getZ(i);
      } else {
        this.tCol[i3] = this.color.r;
        this.tCol[i3 + 1] = this.color.g;
        this.tCol[i3 + 2] = this.color.b;
      }
    }

    const bucket = bucketOf(surface);
    const acc = this.acc(bucket);
    const layerId = surfaceLayer(surface);
    const pbrR = qByte(spec.roughness);
    const pbrM = qByte(spec.metalness);
    const invU = 1 / spec.tile;
    const invV = 1 / (spec.tileV ?? spec.tile);

    const idxAttr = src.index;
    const iCount = idxAttr ? idxAttr.count : svCount;
    // Upper bound on newly emitted vertices from this template: svCount * remapStride
    ensureVerts(acc, svCount * remapStride);

    const emitVertex = (sv: number, axis: number): number => {
      const rKey = useOwnUv ? sv : sv * 3 + axis;
      const hit = this.remap[rKey];
      if (hit >= 0) return hit;

      const dst = acc.vCount++;
      this.remap[rKey] = dst;
      const s3 = sv * 3;
      const d3 = dst * 3;
      const d2 = dst * 2;
      const x = this.tPos[s3];
      const y = this.tPos[s3 + 1];
      const z = this.tPos[s3 + 2];
      const nx = this.tNrm[s3];
      const ny = this.tNrm[s3 + 1];
      const nz = this.tNrm[s3 + 2];

      acc.pos[d3] = x;
      acc.pos[d3 + 1] = y;
      acc.pos[d3 + 2] = z;
      acc.nrm[d3] = qNorm(nx);
      acc.nrm[d3 + 1] = qNorm(ny);
      acc.nrm[d3 + 2] = qNorm(nz);

      if (tint) {
        this.tmpColor.setRGB(this.tCol[s3], this.tCol[s3 + 1], this.tCol[s3 + 2]);
        tint(this.tmpColor, x, y, z, nx, ny, nz);
        acc.col[d3] = qByte(this.tmpColor.r);
        acc.col[d3 + 1] = qByte(this.tmpColor.g);
        acc.col[d3 + 2] = qByte(this.tmpColor.b);
      } else {
        acc.col[d3] = qByte(this.tCol[s3]);
        acc.col[d3 + 1] = qByte(this.tCol[s3 + 1]);
        acc.col[d3 + 2] = qByte(this.tCol[s3 + 2]);
      }

      if (useOwnUv) {
        acc.uv[d2] = ownUv!.getX(sv);
        acc.uv[d2 + 1] = ownUv!.getY(sv);
      } else if (axis === 0) {
        acc.uv[d2] = x * invU;
        acc.uv[d2 + 1] = z * invU;
      } else if (axis === 1) {
        acc.uv[d2] = z * invU;
        acc.uv[d2 + 1] = y * invV;
      } else {
        acc.uv[d2] = x * invU;
        acc.uv[d2 + 1] = y * invV;
      }

      acc.layer[dst] = layerId;
      acc.pbr[d2] = pbrR;
      acc.pbr[d2 + 1] = pbrM;
      return dst;
    };

    const idxArr = idxAttr ? idxAttr.array : null;
    for (let k = 0; k + 2 < iCount; k += 3) {
      const s0 = idxArr ? idxArr[k] : k;
      const s1 = idxArr ? idxArr[k + 1] : k + 1;
      const s2 = idxArr ? idxArr[k + 2] : k + 2;
      const p0 = s0 * 3;
      const p1 = s1 * 3;
      const p2 = s2 * 3;

      let axis = 0;
      if (!useOwnUv) {
        const ux = this.tPos[p1] - this.tPos[p0];
        const uy = this.tPos[p1 + 1] - this.tPos[p0 + 1];
        const uz = this.tPos[p1 + 2] - this.tPos[p0 + 2];
        const vx = this.tPos[p2] - this.tPos[p0];
        const vy = this.tPos[p2 + 1] - this.tPos[p0 + 1];
        const vz = this.tPos[p2 + 2] - this.tPos[p0 + 2];
        const anx = Math.abs(uy * vz - uz * vy);
        const any = Math.abs(uz * vx - ux * vz);
        const anz = Math.abs(ux * vy - uy * vx);
        axis = any >= anx && any >= anz ? 0 : anx >= anz ? 1 : 2;
      }

      const cx = (this.tPos[p0] + this.tPos[p1] + this.tPos[p2]) / 3;
      const cz = (this.tPos[p0 + 2] + this.tPos[p1 + 2] + this.tPos[p2 + 2]) / 3;
      const q = this.quadrant(cx, cz);

      const d0 = emitVertex(s0, axis);
      const d1 = emitVertex(s1, axis);
      const d2 = emitVertex(s2, axis);
      pushTri(acc.idx0, acc.iCount0, q, d0, d1, d2);
      if (acc.idx1 && acc.iCount1) pushTri(acc.idx1, acc.iCount1, q, d0, d1, d2);
    }

    tempClone?.dispose();
    this.parts++;
  }

  /**
   * A third-party model (world/models): stays indexed with its own UVs into its atlas layer,
   * vertex colors times `paint` (null keeps the livery), dirt by `tint`. Always an opaque shadow caster.
   * When `lod1Indices` is given, LOD0 and LOD1 share the exact same encoded vertices.
   */
  addModel(
    model: BufferGeometry,
    layer: number,
    matrix: Matrix4,
    paint: ColorRepresentation | null,
    roughness: number,
    metalness: number,
    tint?: VertexTint,
    lod1Indices?: Uint16Array | null,
  ): void {
    const posAttr = model.getAttribute('position');
    const nrmAttr = model.getAttribute('normal');
    const uvAttr = model.getAttribute('uv');
    const colAttr = model.getAttribute('color');
    const idxAttr = model.index;
    const svCount = posAttr.count;
    if (svCount === 0) return;

    const acc = this.acc('cast');
    ensureVerts(acc, svCount);
    const vBase = acc.vCount;
    acc.vCount += svCount;

    const e = matrix.elements;
    this.nrmMat.getNormalMatrix(matrix);
    const ne = this.nrmMat.elements;
    const n0 = ne[0], n1 = ne[1], n2 = ne[2];
    const n3 = ne[3], n4 = ne[4], n5 = ne[5];
    const n6 = ne[6], n7 = ne[7], n8 = ne[8];

    let pr = 1, pg = 1, pb = 1;
    if (paint !== null) {
      this.color.set(paint);
      pr = this.color.r;
      pg = this.color.g;
      pb = this.color.b;
    }

    const layerByte = MODEL_LAYER_BASE + layer;
    const pbrR = qByte(roughness);
    const pbrM = qByte(metalness);

    for (let i = 0; i < svCount; i++) {
      const dst = vBase + i;
      const d3 = dst * 3;
      const d2 = dst * 2;
      const sx = posAttr.getX(i);
      const sy = posAttr.getY(i);
      const sz = posAttr.getZ(i);
      const x = e[0] * sx + e[4] * sy + e[8] * sz + e[12];
      const y = e[1] * sx + e[5] * sy + e[9] * sz + e[13];
      const z = e[2] * sx + e[6] * sy + e[10] * sz + e[14];
      acc.pos[d3] = x;
      acc.pos[d3 + 1] = y;
      acc.pos[d3 + 2] = z;

      const snx = nrmAttr.getX(i);
      const sny = nrmAttr.getY(i);
      const snz = nrmAttr.getZ(i);
      let nx = n0 * snx + n3 * sny + n6 * snz;
      let ny = n1 * snx + n4 * sny + n7 * snz;
      let nz = n2 * snx + n5 * sny + n8 * snz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      acc.nrm[d3] = qNorm(nx);
      acc.nrm[d3 + 1] = qNorm(ny);
      acc.nrm[d3 + 2] = qNorm(nz);

      let cr = colAttr.getX(i) * pr;
      let cg = colAttr.getY(i) * pg;
      let cb = colAttr.getZ(i) * pb;
      if (tint) {
        this.tmpColor.setRGB(cr, cg, cb);
        tint(this.tmpColor, x, y, z, nx, ny, nz);
        cr = this.tmpColor.r;
        cg = this.tmpColor.g;
        cb = this.tmpColor.b;
      }
      acc.col[d3] = qByte(cr);
      acc.col[d3 + 1] = qByte(cg);
      acc.col[d3 + 2] = qByte(cb);

      acc.uv[d2] = uvAttr.getX(i);
      acc.uv[d2 + 1] = uvAttr.getY(i);
      acc.layer[dst] = layerByte;
      acc.pbr[d2] = pbrR;
      acc.pbr[d2 + 1] = pbrM;
    }

    // Place the model as one unit into its origin quadrant so LOD0↔LOD1 switches cleanly per car/prop.
    const q = this.quadrant(e[12], e[14]);
    const idxArr = idxAttr ? idxAttr.array : null;
    const iCount = idxAttr ? idxAttr.count : svCount;
    const hasLod = !!(lod1Indices && lod1Indices.length >= 3);
    for (let k = 0; k + 2 < iCount; k += 3) {
      const a = vBase + (idxArr ? idxArr[k] : k);
      const b = vBase + (idxArr ? idxArr[k + 1] : k + 1);
      const c = vBase + (idxArr ? idxArr[k + 2] : k + 2);
      pushTri(acc.idx0, acc.iCount0, q, a, b, c);
      if (!hasLod && acc.idx1 && acc.iCount1) pushTri(acc.idx1, acc.iCount1, q, a, b, c);
    }
    if (hasLod && acc.idx1 && acc.iCount1) {
      acc.hasLod1 = true;
      for (let k = 0; k + 2 < lod1Indices!.length; k += 3) {
        pushTri(acc.idx1, acc.iCount1, q, vBase + lod1Indices![k], vBase + lod1Indices![k + 1], vBase + lod1Indices![k + 2]);
      }
    }
    this.parts++;
  }

  /** Soft ground contact shadow under a static model or prop, merged into the chunk's glass/decal draw call. */
  addShadow(matrix: Matrix4, w: number, l: number, y = 0.025, cx = 0, cz = 0): void {
    _shadowLocal.makeScale(w, 1, l);
    _shadowLocal.setPosition(cx, y, cz);
    _shadowWorld.multiplyMatrices(matrix, _shadowLocal);
    this.add(shadowQuad(), 0xffffff, _shadowWorld, 'decalShadow');
  }

  get partCount(): number {
    return this.parts;
  }

  /** Pack everything per bucket into trimmed transferable typed arrays and clear the batch. */
  buildBuffers(): SurfaceBuffers[] {
    const out: SurfaceBuffers[] = [];
    for (const [bucket, acc] of this.accs) {
      const v = acc.vCount;
      let total0 = 0;
      let total1 = 0;
      for (let q = 0; q < this.cellCount; q++) {
        total0 += acc.iCount0[q];
        if (acc.hasLod1 && acc.iCount1) total1 += acc.iCount1[q];
      }
      if (v === 0 || total0 === 0) continue;

      const makeIdx = v <= 65535 ? (n: number) => new Uint16Array(n) : (n: number) => new Uint32Array(n);
      const index = makeIdx(total0);
      const indexLod1 = acc.hasLod1 ? makeIdx(total1) : undefined;
      const cells: CellRange[] = [];

      let off0 = 0;
      let off1 = 0;
      const pos = acc.pos;
      for (let q = 0; q < this.cellCount; q++) {
        const c0 = acc.iCount0[q];
        if (c0 === 0) continue;
        const src0 = acc.idx0[q];
        index.set(src0.subarray(0, c0), off0);

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let k = 0; k < c0; k++) {
          const p3 = src0[k] * 3;
          const x = pos[p3];
          const y = pos[p3 + 1];
          const z = pos[p3 + 2];
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (z < minZ) minZ = z;
          if (z > maxZ) maxZ = z;
        }
        const cx = (minX + maxX) * 0.5;
        const cy = (minY + maxY) * 0.5;
        const cz = (minZ + maxZ) * 0.5;
        let maxR2 = 0;
        for (let k = 0; k < c0; k++) {
          const p3 = src0[k] * 3;
          const dx = pos[p3] - cx;
          const dy = pos[p3 + 1] - cy;
          const dz = pos[p3 + 2] - cz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > maxR2) maxR2 = d2;
        }

        const cell: CellRange = {
          start: off0,
          count: c0,
          sphere: [cx, cy, cz, Math.sqrt(maxR2)],
          boundsXZ: [minX, minZ, maxX, maxZ],
        };
        if (indexLod1 && acc.iCount1 && acc.idx1) {
          const c1 = acc.iCount1[q];
          indexLod1.set(acc.idx1[q].subarray(0, c1), off1);
          cell.lod1Start = off1;
          cell.lod1Count = c1;
          off1 += c1;
        }
        cells.push(cell);
        off0 += c0;
      }

      const buf: SurfaceBuffers = {
        bucket,
        position: acc.pos.slice(0, v * 3),
        normal: acc.nrm.slice(0, v * 3),
        color: acc.col.slice(0, v * 3),
        surfUv: acc.uv.slice(0, v * 2),
        layer: acc.layer.slice(0, v),
        pbr: acc.pbr.slice(0, v * 2),
        index,
        cells,
      };
      if (indexLod1) buf.indexLod1 = indexLod1;
      out.push(buf);
    }
    this.accs.clear();
    this.parts = 0;
    return out;
  }
}
