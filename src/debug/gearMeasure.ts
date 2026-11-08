import { type BufferGeometry, type SkinnedMesh, Vector3 } from 'three';

/**
 * The gear checks of test:gear (debug/gearTest.ts) as functions, for the gear editor's readout: how much of
 * the body comes through a piece in the pose it stands in (the body's drawn vertices near the piece with the
 * piece just inside the skin and nothing of it outside; a helmet: outside its dome), and the share of its
 * faces turned inside out.
 */

class Grid {
  private readonly map = new Map<string, number[]>();
  constructor(
    readonly pos: Float32Array,
    readonly cell: number,
  ) {
    for (let i = 0; i < pos.length / 3; i++) {
      const k = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let l = this.map.get(k);
      if (!l) this.map.set(k, (l = []));
      l.push(i);
    }
  }
  key(x: number, y: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  near(p: Vector3, r: number, out: number[] = []): number[] {
    out.length = 0;
    const n = Math.ceil(r / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    for (let x = cx - n; x <= cx + n; x++)
      for (let y = cy - n; y <= cy + n; y++)
        for (let z = cz - n; z <= cz + n; z++) {
          const l = this.map.get(`${x},${y},${z}`);
          if (l) for (const i of l) out.push(i);
        }
    return out;
  }
}

const A = new Vector3(), B = new Vector3(), C = new Vector3(), T = new Vector3();
function rayTri(o: Vector3, d: Vector3, a: Vector3, b: Vector3, c: Vector3): number {
  const e1 = B.subVectors(b, a), e2 = C.subVectors(c, a);
  const p = new Vector3().crossVectors(d, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-12) return -1;
  const t = T.subVectors(o, a);
  const u = t.dot(p) / det;
  if (u < 0 || u > 1) return -1;
  const q = new Vector3().crossVectors(t, e1);
  const v = d.dot(q) / det;
  if (v < 0 || u + v > 1) return -1;
  const h = e2.dot(q) / det;
  return h > 0 ? h : -1;
}

export interface Posed {
  pos: Float32Array;
  nor: Float32Array;
  index: ArrayLike<number>;
  tris: Grid;
  verts: Grid;
}
const V = (a: Float32Array, i: number, o = new Vector3()) => o.set(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);

/** A skinned mesh's vertices as posed now (its skeleton's matrices up to date), normals from the faces. */
export function posed(mesh: SkinnedMesh, geo: BufferGeometry = mesh.geometry): Posed {
  const P = geo.getAttribute('position');
  const pos = new Float32Array(P.count * 3);
  const v = new Vector3();
  mesh.skeleton.update();
  for (let i = 0; i < P.count; i++) mesh.applyBoneTransform(i, v.fromBufferAttribute(P, i)).toArray(pos, i * 3);
  const index = geo.index!.array;
  const nor = new Float32Array(pos.length);
  const cen = new Float32Array(index.length);
  const n = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < index.length; t += 3) {
    V(pos, index[t], A);
    V(pos, index[t + 1], b).sub(A);
    V(pos, index[t + 2], c).sub(A);
    n.crossVectors(b, c);
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) nor[index[t + k] * 3 + a] += n.getComponent(a);
    V(pos, index[t]).add(V(pos, index[t + 1])).add(V(pos, index[t + 2])).multiplyScalar(1 / 3).toArray(cen, t);
  }
  for (let i = 0; i < P.count; i++) {
    const l = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]) || 1;
    for (let a = 0; a < 3; a++) nor[i * 3 + a] /= l;
  }
  return { pos, nor, index, tris: new Grid(cen, 0.05), verts: new Grid(pos, 0.03) };
}

function shellTris(pos: Float32Array, index: ArrayLike<number>): Grid {
  const cen = new Float32Array(index.length);
  for (let t = 0; t < index.length; t += 3) V(pos, index[t]).add(V(pos, index[t + 1])).add(V(pos, index[t + 2])).multiplyScalar(1 / 3).toArray(cen, t);
  return new Grid(cen, 0.05);
}

const _l: number[] = [];
function cast(m: Posed, o: Vector3, d: Vector3, max: number): number {
  let best = -1;
  const mid = o.clone().addScaledVector(d, max / 2);
  for (const c of m.tris.near(mid, max / 2 + 0.08, _l)) {
    const t = c * 3;
    const h = rayTri(o, d, V(m.pos, m.index[t]), V(m.pos, m.index[t + 1]), V(m.pos, m.index[t + 2]));
    if (h > 0 && h <= max && (best < 0 || h < best)) best = h;
  }
  return best;
}

/**
 * The body through a piece (test:gear's rule): `out` of the `near` drawn body vertices come out through it.
 * `bits`: the cover bits of everything worn (the body under all of it hidden); `bodyGeo`'s `aCover` decides.
 */
export function throughPiece(kind: string, body: Posed, bodyGeo: BufferGeometry, piece: Posed, pieceGeo: BufferGeometry, bits: number): { out: number; near: number } {
  if (kind !== 'vest' && kind !== 'helmet' && kind !== 'glasses' && kind !== 'mask') return { out: 0, near: 0 };
  const cover = bodyGeo.getAttribute('aCover');
  const hidden = (v: number) => !!cover && (cover.getX(v) & bits) !== 0;
  const drawn = new Uint8Array(body.pos.length / 3);
  for (let t = 0; t < body.index.length; t += 3) {
    const a = body.index[t], b = body.index[t + 1], c = body.index[t + 2];
    if (!(hidden(a) && hidden(b) && hidden(c))) drawn[a] = drawn[b] = drawn[c] = 1;
  }
  let gp = piece;
  let rimY = -Infinity;
  const dome = new Vector3();
  if (kind === 'helmet') {
    const gb = pieceGeo.getAttribute('position');
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < gb.count; i++) (lo = Math.min(lo, gb.getY(i))), (hi = Math.max(hi, gb.getY(i)));
    rimY = lo + (hi - lo) * 0.45;
    const idx = pieceGeo.index!.array, keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) if ([0, 1, 2].every((k) => gb.getY(idx[t + k]) >= rimY)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
    gp = { ...gp, index: keep, tris: shellTris(gp.pos, keep) };
    const dlo = new Vector3(Infinity, Infinity, Infinity), dhi = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const i of new Set(keep)) dlo.min(V(gp.pos, i)), dhi.max(V(gp.pos, i));
    dome.copy(dlo).add(dhi).multiplyScalar(0.5);
  }
  const bindY = bodyGeo.getAttribute('position');
  let near = 0, out = 0;
  const n = new Vector3(), q = new Vector3();
  for (let v = 0; v < drawn.length; v++) {
    if (!drawn[v] || bindY.getY(v) < rimY) continue;
    V(body.pos, v, q);
    if (!gp.verts.near(q, 0.05, _l).length) continue;
    near++;
    V(body.nor, v, n);
    if (kind === 'helmet') {
      const d = dome.clone().sub(q);
      const L = d.length();
      d.normalize();
      if (cast(gp, q, d, L) > 0 && cast(piece, q, d.clone().negate(), 0.3) < 0 && cast(piece, q, new Vector3(0, 1, 0), 0.3) < 0) out++;
      continue;
    }
    if (cast(gp, q, n.clone().negate(), 0.02) < 0) continue;
    if (cast(gp, q, n, 0.04) < 0) out++;
  }
  return { out, near };
}

/** The share of a geometry's area whose winding disagrees with its vertex normals (test:gear: ≤ 5%). */
export function inwardShare(geo: BufferGeometry): number {
  const P = geo.getAttribute('position'), N = geo.getAttribute('normal');
  if (!N) return 0;
  const idx = geo.index;
  const n = idx ? idx.count : P.count;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), fn = new Vector3(), vn = new Vector3(), t = new Vector3();
  let all = 0, bad = 0;
  for (let i = 0; i < n; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(P, ia);
    b.fromBufferAttribute(P, ib);
    c.fromBufferAttribute(P, ic);
    fn.crossVectors(b.sub(a), c.sub(a));
    const area = fn.length() / 2;
    if (area < 1e-12) continue;
    vn.fromBufferAttribute(N, ia).add(t.fromBufferAttribute(N, ib)).add(t.fromBufferAttribute(N, ic));
    all += area;
    if (fn.dot(vn) < 0) bad += area;
  }
  return all ? bad / all : 0;
}
