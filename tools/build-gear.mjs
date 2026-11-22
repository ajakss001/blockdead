#!/usr/bin/env node
/**
 * Gear: assets/incoming/gear/<id>.glb (Meshy) → public/models/gear, fitted to every character body
 * (public/models/characters, built first by npm run characters). Usage: npm run gear
 *
 *   <id>.glb               the piece at real size, ≤ 2500 triangles (helmets ≤ 1500), borders locked
 *   <id>_2048.webp / _1024 / _512  its texture through the grim palette (WebP q90)
 *   fit_<body>.glb         per body: the vests shrink-wrapped onto its torso (1.5 cm off the skin, weights
 *                          taken from the body), the straps of the packs and the medic bag laid over its
 *                          shoulders and chest (skinned to the spine, shoulders and collarbones)
 *   gear.json              per body: each rigid piece's place (helmet on Head scaled to the head, pack body on
 *                          Spine2, bag on Hips, toolbox in the hand / on the hip), and which of the body's
 *                          vertices each piece covers (hidden under it: no skin through a vest, no hair
 *                          through a helmet), for LOD0 and LOD1
 */
import { mkdirSync, readFileSync, statSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';
import sharp from 'sharp';
import { grim } from '../src/style/palette.ts';

const ROOT = process.cwd();
const IN = join(ROOT, 'assets', 'incoming', 'gear');
const CHAR = join(ROOT, 'public', 'models', 'characters');
const OUT = join(ROOT, 'public', 'models', 'gear');
mkdirSync(OUT, { recursive: true });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

/**
 * kind: helmet (rigid on Head), vest (shrink-wrapped, skinned), pack (body rigid on Spine2 + straps),
 * bag (body rigid on Hips + a strap across), box (rigid: in the right hand or on the hip).
 * size: the real size of the largest side (m); helmets and vests take the body's own.
 */
export const GEAR = {
  // Budgets (CLAUDE.md): a vest ≤ 5000 triangles, a helmet, glasses, a mask ≤ 2000 — a model within its budget
  // goes as it comes (Meshy's are), only one over it is simplified (its borders and UV seams kept).
  // Helmets: fitted low and close to each head (fitHelmet), skinned on Head in the body's fit.
  helmet_military: { kind: 'helmet', tris: 2000 },
  // The raised visor is thin: at 2000 faces it breaks into shards (the source's own count kept; measured and
  // placed as at 2000, so the fit on the head and the hand fixes over it stay as they were).
  helmet_swat: { kind: 'helmet', tris: 4800, measureTris: 2000 },
  helmet_firefighter: { kind: 'helmet', tris: 2000 },
  helmet_construction: { kind: 'helmet', tris: 2000 },
  // Vests as they come (≤ 5000): Meshy's baked vests have a UV island per triangle, and a simplifier with
  // the borders locked can only tear them (the SWAT vest fell apart into dark triangles).
  vest_military: { kind: 'vest', tris: 5000 },
  vest_swat: { kind: 'vest', tris: 5000 },
  backpack_military: { kind: 'pack', tris: 2500, height: 0.64 },
  backpack_school: { kind: 'pack', tris: 2500, height: 0.44 },
  backpack_hiking: { kind: 'pack', tris: 2500, height: 0.8 },
  bag_medic: { kind: 'bag', tris: 2500, width: 0.38 },
  toolbox_mechanic: { kind: 'box', tris: 2500, width: 0.44 },
  // The face slot: glasses (lenses apart: their own dark see-through material in the game) and masks.
  goggles_tactical: { kind: 'glasses', tris: 2000, lens: { by: 'window', inset: 0.1 } },
  balaclava: { kind: 'mask', tris: 2000, mask: 'head', cut: { light: 90 } },
  shemagh: { kind: 'mask', tris: 2000, mask: 'neck', standIn: shemaghStandIn },
  mask_half: { kind: 'mask', tris: 2000, mask: 'mouth' },
};
const IDS = Object.keys(GEAR);
const TAU = Math.PI * 2;
const report = [];

// ── Small vector helpers on flat arrays ────────────────────────────────────────────────────────────
const V = (a, i) => new Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
const setV = (a, i, v) => ((a[i * 3] = v.x), (a[i * 3 + 1] = v.y), (a[i * 3 + 2] = v.z));
function percentile(values, p) {
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}
/** Vertices at one position (UV seams split them): each one's group, and each group's members. */
function positionGroups(pos) {
  const key = new Map();
  const group = new Int32Array(pos.length / 3);
  const members = [];
  for (let i = 0; i < group.length; i++) {
    const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    let gi = key.get(k);
    if (gi === undefined) key.set(k, (gi = members.push([]) - 1));
    group[i] = gi;
    members[gi].push(i);
  }
  return { group, members };
}
/** Vertex normals with the copies of a corner sharing one (area-weighted over all their triangles). */
function weldedNormals(pos, index, group, members) {
  const gn = new Float32Array(members.length * 3);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const [i, j, k] = [index[t], index[t + 1], index[t + 2]];
    a.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    b.set(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]).sub(a);
    c.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).sub(a);
    b.cross(c);
    for (const v of [i, j, k]) (gn[group[v] * 3] += b.x), (gn[group[v] * 3 + 1] += b.y), (gn[group[v] * 3 + 2] += b.z);
  }
  const n = new Float32Array(pos.length);
  for (let v = 0; v < group.length; v++) {
    const g = group[v];
    const l = Math.hypot(gn[g * 3], gn[g * 3 + 1], gn[g * 3 + 2]) || 1;
    n[v * 3] = gn[g * 3] / l;
    n[v * 3 + 1] = gn[g * 3 + 1] / l;
    n[v * 3 + 2] = gn[g * 3 + 2] / l;
  }
  return n;
}
/**
 * Smooth normals across the welded corners, but not over a crease (> 60°): a thin flap's two faces, a pouch's
 * lid and side keep their own — averaged together they turn sideways, off the triangles' own facing, and the
 * one-sided material draws them dark.
 */
function creaseNormals(pos, index, group) {
  const nt = index.length / 3;
  const fn = new Float32Array(nt * 3);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < nt; t++) {
    const [i, j, k] = [index[t * 3], index[t * 3 + 1], index[t * 3 + 2]];
    a.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    b.set(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]).sub(a);
    c.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).sub(a);
    b.cross(c);
    fn.set([b.x, b.y, b.z], t * 3);
  }
  // Each welded place's triangles; each vertex's own.
  const byGroup = new Map(), own = new Map();
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      const gk = group[v];
      if (!byGroup.has(gk)) byGroup.set(gk, []);
      byGroup.get(gk).push(t);
      if (!own.has(v)) own.set(v, []);
      own.get(v).push(t);
    }
  const n = new Float32Array(pos.length);
  const o = new Vector3(), sum = new Vector3(), f = new Vector3();
  for (let v = 0; v < pos.length / 3; v++) {
    const mine = own.get(v);
    if (!mine) continue;
    o.set(0, 0, 0);
    for (const t of mine) o.add(f.fromArray(fn, t * 3));
    if (o.lengthSq() < 1e-20) o.fromArray(fn, mine[0] * 3);
    o.normalize();
    sum.set(0, 0, 0);
    for (const t of byGroup.get(group[v])) {
      f.fromArray(fn, t * 3);
      const l = f.length();
      if (l > 1e-12 && f.dot(o) / l > 0.5) sum.add(f);
    }
    if (sum.lengthSq() < 1e-20) sum.copy(o);
    sum.normalize();
    n.set([sum.x, sum.y, sum.z], v * 3);
  }
  return n;
}
function vertexNormals(pos, index) {
  const n = new Float32Array(pos.length);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const [i, j, k] = [index[t], index[t + 1], index[t + 2]];
    a.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    b.set(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]).sub(a);
    c.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]).sub(a);
    b.cross(c);
    for (const v of [i, j, k]) (n[v * 3] += b.x), (n[v * 3 + 1] += b.y), (n[v * 3 + 2] += b.z);
  }
  for (let v = 0; v < n.length / 3; v++) {
    const l = Math.hypot(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]) || 1;
    n[v * 3] /= l;
    n[v * 3 + 1] /= l;
    n[v * 3 + 2] /= l;
  }
  return n;
}
/** Uniform grid over points for nearest queries. */
class Grid {
  constructor(pos, cell = 0.03, filter = null) {
    this.pos = pos;
    this.cell = cell;
    this.map = new Map();
    for (let i = 0; i < pos.length / 3; i++) {
      if (filter && !filter(i)) continue;
      const k = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      let l = this.map.get(k);
      if (!l) this.map.set(k, (l = []));
      l.push(i);
    }
  }
  key(x, y, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  /** Nearest point index within `max` (or -1). */
  nearest(p, max = 0.3) {
    let best = -1, bd = max * max;
    const r = Math.ceil(max / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    for (let ring = 0; ring <= r; ring++) {
      for (let x = cx - ring; x <= cx + ring; x++)
        for (let y = cy - ring; y <= cy + ring; y++)
          for (let z = cz - ring; z <= cz + ring; z++) {
            if (Math.max(Math.abs(x - cx), Math.abs(y - cy), Math.abs(z - cz)) !== ring) continue;
            const l = this.map.get(`${x},${y},${z}`);
            if (!l) continue;
            for (const i of l) {
              const d = (this.pos[i * 3] - p.x) ** 2 + (this.pos[i * 3 + 1] - p.y) ** 2 + (this.pos[i * 3 + 2] - p.z) ** 2;
              if (d < bd) (bd = d), (best = i);
            }
          }
      // Anything closer than the next ring's inner edge is final.
      if (best >= 0 && Math.sqrt(bd) <= ring * this.cell) break;
    }
    return best;
  }
  within(p, max) {
    const out = [];
    const r = Math.ceil(max / this.cell);
    const cx = Math.floor(p.x / this.cell), cy = Math.floor(p.y / this.cell), cz = Math.floor(p.z / this.cell);
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (let z = cz - r; z <= cz + r; z++) {
          const l = this.map.get(`${x},${y},${z}`);
          if (!l) continue;
          for (const i of l) {
            const d = Math.hypot(this.pos[i * 3] - p.x, this.pos[i * 3 + 1] - p.y, this.pos[i * 3 + 2] - p.z);
            if (d <= max) out.push([i, d]);
          }
        }
    return out;
  }
}
/** Closest point on triangle (a, b, c) to p. */
function closestOnTri(p, a, b, c, out) {
  const ab = b.clone().sub(a), ac = c.clone().sub(a), ap = p.clone().sub(a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  const bp = p.clone().sub(b), d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(ab, d1 / (d1 - d3));
  const cp = p.clone().sub(c), d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return out.copy(b).addScaledVector(c.clone().sub(b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
  const denom = 1 / (va + vb + vc);
  return out.copy(a).addScaledVector(ab, vb * denom).addScaledVector(ac, vc * denom);
}

// ── Bodies (built by build-characters) ─────────────────────────────────────────────────────────────
async function readBody(file) {
  const doc = await io.read(join(CHAR, file));
  const root = doc.getRoot();
  const node = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  const prim = node.getMesh().listPrimitives()[0];
  const skin = node.getSkin();
  const names = skin.listJoints().map((j) => j.getName().replace(/^mixamorig:?/, ''));
  const ibm = skin.getInverseBindMatrices().getArray();
  const bind = names.map((_, i) => new Matrix4().fromArray(ibm, i * 16).invert());
  const parents = skin.listJoints().map((j) => skin.listJoints().indexOf(j.getParentNode()));
  const pos = Float32Array.from(prim.getAttribute('POSITION').getArray());
  const index = Uint32Array.from(prim.getIndices().getArray());
  const nor = vertexNormals(pos, index);
  const ji = prim.getAttribute('JOINTS_0').getArray();
  const jw = prim.getAttribute('WEIGHTS_0').getArray();
  const ix = new Map(names.map((n, i) => [n, i]));
  const joint = (n) => new Vector3().setFromMatrixPosition(bind[ix.get(n)]);
  /** Weight of a vertex on the bones matching `test`. */
  const share = (v, test) => {
    let s = 0;
    for (let k = 0; k < 4; k++) if (jw[v * 4 + k] > 0 && test(names[ji[v * 4 + k]])) s += jw[v * 4 + k];
    return s;
  };
  // Triangles round each vertex (closest-point queries).
  const vt = Array.from({ length: pos.length / 3 }, () => []);
  for (let t = 0; t < index.length; t += 3) for (let k = 0; k < 3; k++) vt[index[t + k]].push(t);
  const grid = new Grid(pos, 0.03);
  return { pos, nor, index, ji, jw, names, bind, parents, ix, joint, share, vt, grid, count: pos.length / 3 };
}
/** The body's surface nearest p: the point, its normal, the nearest vertex. */
function surface(body, p, max = 0.4) {
  const v = body.grid.nearest(p, max);
  if (v < 0) return null;
  const best = new Vector3(), tmp = new Vector3();
  let bd = Infinity, bt = -1;
  // The triangles of the nearest vertex and its neighbours'.
  const tris = new Set(body.vt[v]);
  for (const t of body.vt[v]) for (let k = 0; k < 3; k++) for (const t2 of body.vt[body.index[t + k]]) tris.add(t2);
  for (const t of tris) {
    const a = V(body.pos, body.index[t]), b = V(body.pos, body.index[t + 1]), c = V(body.pos, body.index[t + 2]);
    closestOnTri(p, a, b, c, tmp);
    const d = tmp.distanceToSquared(p);
    if (d < bd) (bd = d), best.copy(tmp), (bt = t);
  }
  const a = V(body.pos, body.index[bt]), b = V(body.pos, body.index[bt + 1]), c = V(body.pos, body.index[bt + 2]);
  const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  // Face normal, turned to agree with the vertex normals (outwards).
  if (n.dot(V(body.nor, v)) < 0) n.negate();
  return { p: best, n, v, d: Math.sqrt(bd) };
}
/** Signed distance from the body's surface (outside > 0). */
function signed(body, p) {
  const s = surface(body, p);
  if (!s) return { d: 1, s: null };
  return { d: p.clone().sub(s.p).dot(s.n) >= 0 ? s.d : -s.d, s };
}

// ── Gear sources ───────────────────────────────────────────────────────────────────────────────────
async function readGear(id) {
  const doc = await io.read(join(IN, `${id}.glb`));
  const root = doc.getRoot();
  const P = [], N = [], U = [], I = [];
  let base = 0, tex = null;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    const nm = new Matrix4().extractRotation(m);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').getArray();
      const nor = prim.getAttribute('NORMAL')?.getArray();
      const uv = prim.getAttribute('TEXCOORD_0').getArray();
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const v = new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
        P.push(v.x, v.y, v.z);
        const w = nor ? new Vector3(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix4(nm).normalize() : new Vector3(0, 1, 0);
        N.push(w.x, w.y, w.z);
        U.push(uv[i * 2], uv[i * 2 + 1]);
      }
      const idx = prim.getIndices().getArray();
      for (const k of idx) I.push(k + base);
      base += n;
      tex ??= prim.getMaterial()?.getBaseColorTexture()?.getImage();
    }
  }
  return { pos: Float32Array.from(P), nor: Float32Array.from(N), uv: Float32Array.from(U), index: Uint32Array.from(I), tex };
}
/** Welded (UV seams kept), simplified with the UVs weighed, borders locked. */
function weld(g) {
  const map = new Map(), remap = new Uint32Array(g.pos.length / 3);
  const P = [], N = [], U = [];
  for (let i = 0; i < remap.length; i++) {
    const k = [0, 1, 2].map((a) => Math.round(g.pos[i * 3 + a] * 1e5)).join(',') + '|' + Math.round(g.uv[i * 2] * 1e5) + ',' + Math.round(g.uv[i * 2 + 1] * 1e5);
    let j = map.get(k);
    if (j === undefined) {
      map.set(k, (j = P.length / 3));
      P.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      N.push(g.nor[i * 3], g.nor[i * 3 + 1], g.nor[i * 3 + 2]);
      U.push(g.uv[i * 2], g.uv[i * 2 + 1]);
    }
    remap[i] = j;
  }
  return { ...g, pos: Float32Array.from(P), nor: Float32Array.from(N), uv: Float32Array.from(U), index: g.index.map((i) => remap[i]) };
}
function simplifyGear(g, target) {
  g = weld(g);
  if (g.index.length <= target * 3) return g;
  const want = Math.min(g.index.length, target * 3);
  const [index] = MeshoptSimplifier.simplifyWithAttributes(g.index, g.pos, 3, g.uv, 2, [1.5, 1.5], null, want, 1, ['LockBorder']);
  // Compact: only the vertices still used.
  const used = new Int32Array(g.pos.length / 3).fill(-1);
  let n = 0;
  for (const i of index) if (used[i] < 0) used[i] = n++;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  used.forEach((j, i) => {
    if (j < 0) return;
    pos.set(g.pos.subarray(i * 3, i * 3 + 3), j * 3);
    nor.set(g.nor.subarray(i * 3, i * 3 + 3), j * 3);
    uv.set(g.uv.subarray(i * 2, i * 2 + 2), j * 2);
  });
  return { pos, nor, uv, index: index.map((i) => used[i]), tex: g.tex };
}
function bounds(pos, lo = 0.02, hi = 0.98) {
  const axes = [0, 1, 2].map((a) => Array.from({ length: pos.length / 3 }, (_, i) => pos[i * 3 + a]));
  return { min: axes.map((v) => percentile(v, lo)), max: axes.map((v) => percentile(v, hi)), full: { min: axes.map((v) => Math.min(...v)), max: axes.map((v) => Math.max(...v)) } };
}
/** A matrix applied to the geometry (positions and normals). */
function transform(g, m) {
  const nm = new Matrix4().extractRotation(m);
  const pos = new Float32Array(g.pos.length), nor = new Float32Array(g.nor.length);
  for (let i = 0; i < g.pos.length / 3; i++) {
    setV(pos, i, V(g.pos, i).applyMatrix4(m));
    setV(nor, i, V(g.nor, i).applyMatrix4(nm).normalize());
  }
  return { ...g, pos, nor };
}

const gcache = new Map();
function grimPixel(r, g, b) {
  const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let c = gcache.get(k);
  if (c === undefined) gcache.set(k, (c = grim((r << 16) | (g << 8) | b)));
  return c;
}
/**
 * The texels the triangles use (rasterised from the UVs) and the rest filled from them outwards: a baked
 * texture's islands sit on a bare background, and a smaller copy (or a mip level) mixes it into the
 * edges — the SWAT vest's light and dark triangle borders.
 */
function dilate(rgba, w, h, g, passes = 24) {
  const used = new Uint8Array(w * h);
  const U = g.uv, I = g.index;
  for (let t = 0; t < I.length; t += 3) {
    const p = [0, 1, 2].map((k) => [U[I[t + k] * 2] * w - 0.5, U[I[t + k] * 2 + 1] * h - 0.5]);
    const x0 = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0])) - 1), x1 = Math.min(w - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1])) - 1), y1 = Math.min(h - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])) + 1);
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const a = ((p[1][0] - x) * (p[2][1] - y) - (p[2][0] - x) * (p[1][1] - y)) / area;
        const b = ((p[2][0] - x) * (p[0][1] - y) - (p[0][0] - x) * (p[2][1] - y)) / area;
        const c = 1 - a - b;
        if (a >= -0.02 && b >= -0.02 && c >= -0.02) used[y * w + x] = 1;
      }
  }
  for (let pass = 0; pass < passes; pass++) {
    const add = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (used[i]) continue;
        let r = 0, gg = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || !used[yy * w + xx]) continue;
          const j = (yy * w + xx) * 4;
          (r += rgba[j]), (gg += rgba[j + 1]), (b += rgba[j + 2]), n++;
        }
        if (n) add.push([i, r / n, gg / n, b / n]);
      }
    if (!add.length) break;
    for (const [i, r, gg, b] of add) ((rgba[i * 4] = r), (rgba[i * 4 + 1] = gg), (rgba[i * 4 + 2] = b), (used[i] = 1));
  }
}
/** 2048: the player, the menu and the inventory (seen up close); 1024: zombies and LOD; 512: low. WebP q90. */
const TEX_SIZES = [2048, 1024, 512];
async function texture(id, png, g, maxLum = 255) {
  const { data, info } = png.raw ? { data: png.raw.data, info: { width: png.raw.w, height: png.raw.h } } : await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const c = grimPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    let r = (c >> 16) & 255, gg = (c >> 8) & 255, b = c & 255;
    // A cap on brightness (glasses: the frame dark polymer, no painted reflections of the old lens on it).
    const l = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    if (l > maxLum) { const k = (maxLum + (l - maxLum) * 0.15) / l; r *= k; gg *= k; b *= k; }
    out[i * 4] = r;
    out[i * 4 + 1] = gg;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  // At the largest size, the gutters filled, then every size from that.
  const S = TEX_SIZES[0];
  const big = await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(S, S, { kernel: 'lanczos3' }).raw().toBuffer();
  if (g) dilate(big, S, S, g);
  for (const size of TEX_SIZES) {
    const f = join(OUT, `${id}_${size}.webp`);
    await sharp(big, { raw: { width: S, height: S, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: 90 }).toFile(f);
    report.push(`${id}_${size}.webp ${(statSync(f).size / 1024).toFixed(0)} KB`);
  }
}
async function save(doc, file) {
  await doc.transform(reorder({ encoder: MeshoptEncoder }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(join(OUT, file), doc);
  report.push(`${file} ${(statSync(join(OUT, file)).size / 1024).toFixed(0)} KB`);
}
function addMesh(doc, buf, parent, name, g, extra = {}) {
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', g.pos)).setAttribute('NORMAL', acc('VEC3', g.nor)).setAttribute('TEXCOORD_0', acc('VEC2', g.uv));
  if (g.ji) prim.setAttribute('JOINTS_0', acc('VEC4', g.ji)).setAttribute('WEIGHTS_0', acc('VEC4', g.jw));
  prim.setIndices(acc('SCALAR', g.pos.length / 3 > 65535 ? Uint32Array.from(g.index) : Uint16Array.from(g.index)));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  const node = doc.createNode(name).setMesh(mesh).setExtras(extra);
  parent.addChild(node);
}

// ── Canonical pieces: real size, simplified, front +Z (the way the bodies face) ───────────────────────
const pieces = {};
for (const id of IDS) {
  const cfg = GEAR[id];
  let g;
  if (existsSync(join(IN, `${id}.glb`))) g = simplifyGear(await readGear(id), cfg.tris);
  else if (cfg.standIn) {
    // No model yet: the stand-in (the same fit makes the model when it comes).
    const si = cfg.standIn();
    g = { ...si, tex: { raw: si.raw } };
    console.log(`нет gear/${id}.glb — заглушка`);
  } else {
    console.log(`нет gear/${id}.glb — пропуск`);
    continue;
  }
  // Packs come with their straps' side on −Z: turned to face the back they sit on.
  if (cfg.kind === 'pack') g = transform(g, new Matrix4().makeRotationY(Math.PI));
  const b = bounds(g.pos);
  const size = b.max.map((v, i) => v - b.min[i]);
  const real = cfg.kind === 'pack' ? cfg.height / size[1] : cfg.kind === 'bag' || cfg.kind === 'box' ? cfg.width / size[0] : 1;
  // Centred on its box, at real size (helmets and vests: unit, sized per body below).
  let c = b.min.map((v, i) => (v + b.max[i]) / 2);
  // Measured on a coarser copy (`measureTris`): its box centres both, its inner profile places the piece.
  const lo = cfg.measureTris && existsSync(join(IN, `${id}.glb`)) ? simplifyGear(await readGear(id), cfg.measureTris) : null;
  if (lo) {
    const bl = bounds(lo.pos);
    c = bl.min.map((v, i) => (v + bl.max[i]) / 2);
  }
  const centre = new Matrix4().makeScale(real, real, real).multiply(new Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
  g = transform(g, centre);
  if (lo) g.prof = innerProfile(transform(lo, centre));
  if (cfg.lens) g.lens = await findLens(g, cfg.lens);
  // Light-textured faces cut out (the balaclava's pale eye band: the eyes show through the opening).
  if (cfg.cut) {
    const cut = await lightTris(g, cfg.cut.light);
    g = splitTris(g, cut)[0];
    report.push(`${id}: вырезано ${cut.reduce((a, x) => a + x, 0)} светлых граней`);
  }
  pieces[id] = g;
  await texture(id, g.tex, g, cfg.kind === 'glasses' ? 62 : 140);
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(id);
  if (g.lens) {
    const [frame, lens] = splitTris(g, g.lens);
    addMesh(doc, buf, scene, id, frame);
    addMesh(doc, buf, scene, `${id}_lens`, smoothNormals(lens));
  } else addMesh(doc, buf, scene, id, g);
  await save(doc, `${id}.glb`);
  report.push(`${id}: ${g.index.length / 3} tris${g.lens ? `, линза ${g.lens.reduce((a, x) => a + x, 0)}` : ''}`);
}

// ── Fitting per body ───────────────────────────────────────────────────────────────────────────────
const OFFSET = 0.015;
const SPINE = (n) => /^Spine/.test(n);
const HEADB = (n) => n === 'Head' || n.startsWith('HeadTop');

/** Torso box at bind: the spine's vertices (no arms), waist to the neck. */
function torso(body) {
  const lo = body.joint('Spine').y, hi = body.joint('Neck').y;
  const xs = [], zs = [], ys = [];
  for (let v = 0; v < body.count; v++) {
    const y = body.pos[v * 3 + 1];
    if (y < lo || y > hi || body.share(v, SPINE) < 0.6) continue;
    xs.push(body.pos[v * 3]);
    zs.push(body.pos[v * 3 + 2]);
    ys.push(y);
  }
  const min = [percentile(xs, 0.01), lo, percentile(zs, 0.01)];
  const max = [percentile(xs, 0.99), hi, percentile(zs, 0.99)];
  return { min, max, c: min.map((v, i) => (v + max[i]) / 2), size: max.map((v, i) => v - min[i]) };
}

/** A body vertex's weights kept to `allowed` bones (renormalized; none left → `fallback`). */
function weightsOf(body, v, allowed, fallback) {
  const list = [];
  for (let k = 0; k < 4; k++) {
    const w = body.jw[v * 4 + k];
    const j = body.ji[v * 4 + k];
    if (w > 0 && (!allowed || allowed(body.names[j]))) list.push([j, w]);
  }
  if (!list.length) list.push([body.ix.get(fallback), 1]);
  const sum = list.reduce((s, x) => s + x[1], 0);
  return list.slice(0, 4).map(([j, w]) => [j, w / sum]);
}
function skinFrom(body, pos, allowed, fallback) {
  const n = pos.length / 3;
  const ji = new Uint16Array(n * 4), jw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = surface(body, V(pos, i), 0.5);
    weightsOf(body, s ? s.v : 0, allowed, fallback).forEach(([j, w], k) => ((ji[i * 4 + k] = j), (jw[i * 4 + k] = w)));
  }
  return { ji, jw };
}
/** Open-edge vertices of a mesh. */
function borderOf(index, n) {
  const edges = new Map();
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k], b = index[t + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  const out = new Uint8Array(n);
  for (const [k, c] of edges) if (c === 1) for (const v of k.split(',')) out[+v] = 1;
  return out;
}

/** The vest on this body: scaled to the torso, its inner side pulled to OFFSET off the skin, smoothly. */
function fitVest(body, src) {
  const t = torso(body);
  const b = bounds(src.pos);
  const size = b.max.map((v, i) => v - b.min[i]);
  // Wide and deep enough to go round the torso (the wrap then brings it in), from the waist to the collarbones.
  const sx = (t.size[0] + 0.07) / size[0], sz = (t.size[2] + 0.07) / size[2], sy = (t.size[1] * 0.92) / size[1];
  let g = transform(src, new Matrix4().makeTranslation(t.c[0], t.min[1] + t.size[1] * 0.48, t.c[2]).multiply(new Matrix4().makeScale(sx, sy, sz)));
  const n = g.pos.length / 3;
  // The copies of one corner (split at UV seams; a baked vest has every triangle on its own island) move
  // as one, or the vest cracks along every seam.
  const { group, members } = positionGroups(g.pos);
  const together = (pos) => {
    for (const m of members) {
      if (m.length < 2) continue;
      const c = new Vector3();
      for (const i of m) c.add(V(pos, i));
      c.multiplyScalar(1 / m.length);
      for (const i of m) setV(pos, i, c);
    }
  };
  // Smooth normals over the welded corners (not one per triangle: no faceted, dark patches).
  g = { ...g, nor: creaseNormals(g.pos, g.index, group) };
  // Inner side: the vertices facing the torso's axis.
  const disp = [];
  const inner = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = V(g.pos, i);
    const toAxis = new Vector3(t.c[0] - p.x, 0, t.c[2] - p.z);
    if (V(g.nor, i).dot(toAxis) <= 0) continue;
    const s = surface(body, p, 0.3);
    if (!s) continue;
    inner[i] = 1;
    disp.push([p, s.p.clone().addScaledVector(s.n, OFFSET).sub(p)]);
  }
  // The pull spread over the whole vest (outer side follows its inner side: pouches keep their depth).
  const igrid = new Grid(Float32Array.from(disp.flatMap(([p]) => [p.x, p.y, p.z])), 0.04);
  const pos = new Float32Array(g.pos);
  for (let i = 0; i < n; i++) {
    const p = V(g.pos, i);
    const near = igrid.within(p, 0.07);
    if (!near.length) continue;
    const acc = new Vector3();
    let ws = 0;
    for (const [k, d] of near) {
      const w = Math.exp(-((d / 0.035) ** 2));
      acc.addScaledVector(disp[k][1], w);
      ws += w;
    }
    setV(pos, i, p.add(acc.multiplyScalar(1 / ws)));
  }
  together(pos);
  // Nothing of the vest under the skin (nor nearer than half the offset).
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const p = V(pos, i);
      const { d, s } = signed(body, p);
      if (s && d < OFFSET * 0.6) setV(pos, i, s.p.clone().addScaledVector(s.n, OFFSET * 0.6));
    }
  together(pos);
  // The skin between the vest's vertices: wherever it comes through (or nearer than the offset), the vest
  // round there is pushed out along the skin's normal, smoothly.
  for (let pass = 0; pass < 6; pass++) {
    const tg = triGrid({ pos, index: g.index });
    const vg = new Grid(pos, 0.03);
    const push = new Float32Array(pos.length), wsum = new Float32Array(n);
    let pushed = 0;
    for (let v = 0; v < body.count; v++) {
      if (body.share(v, ARM) > 0.3) continue;
      const p = V(body.pos, v);
      if (vg.nearest(p, 0.05) < 0) continue;
      const nn = V(body.nor, v);
      const h = cast(tg, p.clone().addScaledVector(nn, -0.03), nn, 0.03 + OFFSET);
      if (h < 0) continue;
      const need = 0.03 + OFFSET * 0.8 - h;
      if (need <= 0) continue;
      pushed++;
      for (const [k, d] of vg.within(p, 0.04)) {
        const w = Math.exp(-((d / 0.02) ** 2));
        push[k * 3] += nn.x * need * w;
        push[k * 3 + 1] += nn.y * need * w;
        push[k * 3 + 2] += nn.z * need * w;
        wsum[k] += w;
      }
    }
    for (let k = 0; k < n; k++) if (wsum[k] > 0) for (let a = 0; a < 3; a++) pos[k * 3 + a] += push[k * 3 + a] / Math.max(1, wsum[k]);
    together(pos);
    if (!pushed) break;
  }
  g = { ...g, pos, nor: creaseNormals(pos, g.index, group), inner };
  const { ji, jw } = skinFrom(body, pos, null, 'Spine2');
  return { ...g, ji, jw };
}

/** Möller–Trumbore: distance along the ray to triangle (a, b, c), or -1. */
function rayTri(o, d, a, b, c) {
  const e1x = b.x - a.x, e1y = b.y - a.y, e1z = b.z - a.z, e2x = c.x - a.x, e2y = c.y - a.y, e2z = c.z - a.z;
  const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det, tx = o.x - a.x, ty = o.y - a.y, tz = o.z - a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 0 ? t : -1;
}
/** Triangles of a mesh by their centres, for ray queries near a point. */
function triGrid(g) {
  const n = g.index.length / 3, c = new Float32Array(n * 3);
  let r = 0;
  const tri = (t) => [V(g.pos, g.index[t * 3]), V(g.pos, g.index[t * 3 + 1]), V(g.pos, g.index[t * 3 + 2])];
  for (let t = 0; t < n; t++) {
    const [a, b, cc] = tri(t);
    const m = a.clone().add(b).add(cc).multiplyScalar(1 / 3);
    setV(c, t, m);
    r = Math.max(r, m.distanceTo(a), m.distanceTo(b), m.distanceTo(cc));
  }
  return { grid: new Grid(c, 0.04), tri, r };
}
/** Nearest hit of a ray within `max`, or -1. */
function cast(tg, o, d, max) {
  let best = -1;
  const mid = o.clone().addScaledVector(d, max / 2);
  for (const [t] of tg.grid.within(mid, max / 2 + tg.r)) {
    const [a, b, c] = tg.tri(t);
    const h = rayTri(o, d, a, b, c);
    if (h > 0 && h <= max && (best < 0 || h < best)) best = h;
  }
  return best;
}
const ARM = (n) => /(Arm|Hand)/.test(n);

/**
 * Where the skin still comes out through a piece (the piece just under it, nothing of it over it): those
 * vertices and the ring round them (`keep`: which may go) are hidden too, so no triangle of skin shows there.
 */
function pokeCover(body, piece, keep) {
  const tg = triGrid(piece);
  const pg = new Grid(piece.pos, 0.03);
  const out = new Set();
  const n = new Vector3();
  for (let v = 0; v < body.count; v++) {
    if (!keep(v)) continue;
    const p = V(body.pos, v);
    if (pg.nearest(p, 0.05) < 0) continue;
    n.copy(V(body.nor, v));
    if (cast(tg, p, n.clone().negate(), 0.025) < 0) continue;
    if (cast(tg, p, n, 0.04) >= 0) continue;
    out.add(v);
  }
  return ringOf(body, out, keep);
}
/**
 * A helmet's dome: the head's vertices outside it (a ray from one to the dome's middle crosses it: hair through
 * the shell) and the triangles they are in, hidden whole (keep: which may go).
 */
function pokeShell(body, shell, keep, whole) {
  const tg = triGrid(shell);
  const wg = triGrid(whole);
  // The dome's middle: the middle of its box (its vertices' mean sits up under the crown).
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const i of new Set(shell.index)) (lo.min(V(shell.pos, i)), hi.max(V(shell.pos, i)));
  const c = lo.clone().add(hi).multiplyScalar(0.5);
  const out = new Set();
  for (let v = 0; v < body.count; v++) {
    if (!keep(v)) continue;
    const p = V(body.pos, v);
    const d = c.clone().sub(p);
    const L = d.length();
    // Through it and out: the dome between it and the middle, nothing of it further out (under the shell's
    // own thickness, or under it, is not out).
    d.normalize();
    if (cast(tg, p, d, L) > 0 && cast(wg, p, d.clone().negate(), 0.3) < 0) out.add(v);
  }
  return ringOf(body, out, (v) => body.share(v, HEADB) >= 0.1);
}
/** Vertices at the very same place (the body is cut along its UV seams): each one's list. */
function twinsOf(body) {
  if (body.twins) return body.twins;
  const at = new Map();
  for (let v = 0; v < body.count; v++) {
    const k = `${body.pos[v * 3].toFixed(5)},${body.pos[v * 3 + 1].toFixed(5)},${body.pos[v * 3 + 2].toFixed(5)}`;
    let l = at.get(k);
    if (!l) at.set(k, (l = []));
    l.push(v);
  }
  const tw = new Array(body.count);
  for (const l of at.values()) for (const v of l) tw[v] = l;
  return (body.twins = tw);
}
/** The set, its twins, and one ring of triangles round it (over the seams too). */
function ringOf(body, out, keep) {
  const tw = twinsOf(body);
  const core = new Set();
  for (const v of out) for (const w of tw[v]) core.add(w);
  const res = new Set(core);
  for (const v of core) for (const t of body.vt[v]) for (let k = 0; k < 3; k++) for (const w of tw[body.index[t + k]]) if (keep(w)) res.add(w);
  return [...res];
}
/** A body's triangles without its arms (rays to the hips and the back go past a hanging arm). */
function trunkTris(body) {
  if (body.trunk) return body.trunk;
  const idx = [];
  for (let t = 0; t < body.index.length; t += 3) if ([0, 1, 2].every((k) => body.share(body.index[t + k], ARM) < 0.5)) idx.push(body.index[t], body.index[t + 1], body.index[t + 2]);
  return (body.trunk = triGrid({ pos: body.pos, index: Uint32Array.from(idx) }));
}
/** How far the piece (placed) is from the trunk along `dir`: from its side facing the body (`side`). */
function gapAlong(body, src, place, dir, side) {
  const b = bounds(src.pos);
  const H = b.max[1] - b.min[1], Wd = b.max[0] - b.min[0];
  const tg = trunkTris(body);
  const gaps = [];
  for (let i = 0; i < src.pos.length / 3; i++) {
    const q = V(src.pos, i);
    if (!side(q, b) || Math.abs(q.x) > Wd * 0.3 || q.y < b.min[1] + H * 0.2 || q.y > b.max[1] - H * 0.2) continue;
    const h = cast(tg, q.applyMatrix4(place), dir, 0.5);
    if (h > 0) gaps.push(h);
  }
  return gaps.length ? percentile(gaps, 0.03) : Infinity;
}

/** Body vertices under a vest: the vest straight out along the skin's normal there and round it (no edge shows a hole). */
function coveredByVest(body, vest) {
  const tg = triGrid(vest);
  const vgrid = new Grid(vest.pos, 0.03);
  const out = [];
  const n = new Vector3(), t1 = new Vector3(), t2 = new Vector3();
  for (let v = 0; v < body.count; v++) {
    if (body.share(v, ARM) > 0.3) continue;
    const p = V(body.pos, v);
    if (vgrid.nearest(p, 0.08) < 0) continue;
    n.copy(V(body.nor, v));
    t1.set(n.y, -n.x, 0);
    if (t1.lengthSq() < 1e-4) t1.set(0, n.z, -n.y);
    t1.normalize();
    t2.crossVectors(n, t1);
    let ok = true;
    for (const [a, b] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // From 3 cm under the skin: a vest the skin pokes through counts as over it.
      const o = p.clone().addScaledVector(t1, a * 0.02).addScaledVector(t2, b * 0.02).addScaledVector(n, -0.03);
      if (cast(tg, o, n, 0.075) < 0) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(v);
  }
  return out;
}

// ── Head: helmets, glasses, masks ──────────────────────────────────────────────────────────────────
const NECKB = (n) => n === 'Neck';
const HEAD_OR_NECK = (n) => HEADB(n) || NECKB(n);
const HELMET_GAP = 0.0075;


/**
 * The head at bind: its vertices, the skull as an ellipse round its middle at the temples (width and depth
 * from the hair-thin forehead and temples), the top, the brows, the eyes, the chin, the bridge of the nose.
 */
function headFrame(body) {
  if (body.headFrame) return body.headFrame;
  const head = [];
  for (let v = 0; v < body.count; v++) if (body.share(v, HEADB) >= 0.5) head.push(v);
  const X = (v) => body.pos[v * 3], Y = (v) => body.pos[v * 3 + 1], Z = (v) => body.pos[v * 3 + 2];
  const top0 = Math.max(...head.map(Y));
  const zf0 = percentile(head.map(Z), 0.98);
  const cx = (percentile(head.map(X), 0.02) + percentile(head.map(X), 0.98)) / 2;
  const cz0 = (percentile(head.map(Z), 0.02) + percentile(head.map(Z), 0.98)) / 2;
  const face = head.filter((v) => Z(v) > cz0 + 0.03 && body.share(v, HEADB) > 0.95).map(Y);
  const chin = percentile(face, 0.01);
  // The eyes halfway between the chin and the top (the midline of these meshes is too sparse to find the bridge
  // of the nose in profile); the brows 1.2 cm over them.
  const nasion = chin + 0.47 * (top0 - chin);
  const brow = nasion + 0.012;
  const slab = head.filter((v) => Y(v) > brow + 0.015 && Y(v) < brow + 0.05);
  const ax = (percentile(slab.map(X), 0.97) - percentile(slab.map(X), 0.03)) / 2;
  const mid = slab.filter((v) => Math.abs(X(v) - cx) < 0.03);
  const zf = percentile(mid.map(Z), 0.97), zb = percentile(mid.map(Z), 0.03);
  const az = Math.min((zf - zb) / 2, ax * 1.3);
  const cz = zf - az;
  const crown = head.filter((v) => Math.abs(X(v) - cx) < 0.04 && Math.abs(Z(v) - cz) < 0.05);
  const top = percentile(crown.map(Y), 0.99);
  const eyeY = nasion;
  const bz = head.filter((v) => Math.abs(X(v) - cx) < 0.022 && Math.abs(Y(v) - eyeY) < 0.015 && Z(v) > cz0).map(Z);
  const bridgeZ = bz.length ? Math.max(...bz) : zf0 - 0.01;
  const eyeSlab = head.filter((v) => Math.abs(Y(v) - eyeY) < 0.01);
  const faceW = percentile(eyeSlab.map(X), 0.985) - percentile(eyeSlab.map(X), 0.015);
  return (body.headFrame = { head, cx, cz, ax, az, top, brow, chin, eyeY, bridgeZ, faceW, zf, zb });
}

/** A piece's inner surface round its own vertical axis: radius by angle and height, the rim by angle. */
function innerProfile(src) {
  const b = bounds(src.pos, 0, 1).full;
  const H = b.max[1] - b.min[1];
  const dome = [];
  for (let i = 0; i < src.pos.length / 3; i++) if (src.pos[i * 3 + 1] > b.min[1] + H * 0.6) dome.push(i);
  const lcx = (Math.min(...dome.map((i) => src.pos[i * 3])) + Math.max(...dome.map((i) => src.pos[i * 3]))) / 2;
  const lcz = (Math.min(...dome.map((i) => src.pos[i * 3 + 2])) + Math.max(...dome.map((i) => src.pos[i * 3 + 2]))) / 2;
  const tg = triGrid(src);
  const reach = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
  const yMid = b.min[1] + H * 0.55;
  const upHit = cast(tg, new Vector3(lcx, yMid, lcz), new Vector3(0, 1, 0), H);
  const top = upHit > 0 ? yMid + upHit : b.max[1];
  const NA = 36, NY = 48;
  const y0 = b.min[1], dy = (top - y0) / NY;
  const r = new Float32Array((NA + 1) * (NY + 1)).fill(0);
  for (let a = 0; a <= NA; a++) {
    const th = (a / NA) * TAU;
    const d = new Vector3(Math.cos(th), 0, Math.sin(th));
    for (let j = 0; j <= NY; j++) {
      const h = cast(tg, new Vector3(lcx, y0 + j * dy, lcz), d, reach);
      r[a * (NY + 1) + j] = h > 0 ? h : 0;
    }
  }
  // Rim by angle: going down from under the crown, the first height with nothing round the head that way.
  const rim = new Float32Array(NA + 1);
  for (let a = 0; a <= NA; a++) {
    let j = Math.floor(NY * 0.85);
    while (j > 0 && r[a * (NY + 1) + j] > 0 && r[a * (NY + 1) + j] < reach * 0.75) j--;
    rim[a] = y0 + (j + 1) * dy;
  }
  const at = (th, y) => {
    const fa = (((th % TAU) + TAU) % TAU) / TAU * NA, fy = (y - y0) / dy;
    if (fy < 0 || fy > NY) return 0;
    const a0 = Math.floor(fa), j0 = Math.min(NY - 1, Math.floor(fy));
    const ta = fa - a0, ty = fy - j0;
    const v = (a, j) => r[Math.min(NA, a) * (NY + 1) + j];
    const c = [v(a0, j0), v(a0 + 1, j0), v(a0, j0 + 1), v(a0 + 1, j0 + 1)];
    if (c.some((x) => x <= 0)) {
      // At the rim (open below): the corners that hit, averaged.
      const hit = c.filter((x) => x > 0);
      return hit.length ? hit.reduce((s, x) => s + x, 0) / hit.length : 0;
    }
    return (c[0] * (1 - ta) + c[1] * ta) * (1 - ty) + (c[2] * (1 - ta) + c[3] * ta) * ty;
  };
  const rimAt = (th) => {
    const fa = (((th % TAU) + TAU) % TAU) / TAU * NA, a0 = Math.floor(fa), t = fa - a0;
    return rim[a0] * (1 - t) + rim[Math.min(NA, a0 + 1)] * t;
  };
  return { lcx, lcz, top, at, rimAt, rimMin: Math.min(...rim), y0 };
}

/** Normals through the inverse transpose (a scale that is not the same on every axis). */
function transformN(g, m) {
  const nm = new Matrix3().getNormalMatrix(m);
  const pos = new Float32Array(g.pos.length), nor = new Float32Array(g.nor.length);
  for (let i = 0; i < g.pos.length / 3; i++) {
    setV(pos, i, V(g.pos, i).applyMatrix4(m));
    setV(nor, i, V(g.nor, i).applyMatrix3(nm).normalize());
  }
  return { ...g, pos, nor };
}

/**
 * The piece's vertices that `pick` takes laid onto the body (`offset` off the skin), the rest following them
 * smoothly; nothing left under the skin (nor nearer than `floor`). `region`: the body vertices it may lie on.
 */
function wrapOnto(body, g, { pick = () => true, offset = 0.004, floor = offset * 0.6, centre, sigma = 0.012, region = null, stay = () => false }) {
  const n = g.pos.length / 3;
  const { group, members } = positionGroups(g.pos);
  const together = (pos) => {
    for (const m of members) {
      if (m.length < 2) continue;
      const c = new Vector3();
      for (const i of m) c.add(V(pos, i));
      c.multiplyScalar(1 / m.length);
      for (const i of m) setV(pos, i, c);
    }
  };
  const nor = weldedNormals(g.pos, g.index, group, members);
  const near = region ? (p, max) => surfaceIn(body, p, max, region) : (p, max) => surface(body, p, max);
  const disp = [];
  for (let i = 0; i < n; i++) {
    if (!pick(i)) continue;
    const p = V(g.pos, i);
    // Its inner side: the vertices facing the middle of what it wraps.
    const toC = centre(p).sub(p);
    if (V(nor, i).dot(toC) <= 0) continue;
    const s = near(p, 0.12);
    if (!s) continue;
    disp.push([p, s.p.clone().addScaledVector(s.n, offset).sub(p)]);
  }
  const pos = new Float32Array(g.pos);
  if (disp.length) {
    const ig = new Grid(Float32Array.from(disp.flatMap(([p]) => [p.x, p.y, p.z])), 0.03);
    for (let i = 0; i < n; i++) {
      if (!pick(i)) continue;
      const p = V(g.pos, i);
      const nb = ig.within(p, sigma * 3);
      if (!nb.length) continue;
      const acc = new Vector3();
      let ws = 0;
      for (const [k, d] of nb) {
        const w = Math.exp(-((d / sigma) ** 2));
        acc.addScaledVector(disp[k][1], w);
        ws += w;
      }
      setV(pos, i, p.add(acc.multiplyScalar(1 / ws)));
    }
  }
  together(pos);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      if (stay(i)) continue;
      const p = V(pos, i);
      const { d, s } = signed(body, p);
      if (s && d < floor && s.d < 0.06) setV(pos, i, s.p.clone().addScaledVector(s.n, floor));
    }
    together(pos);
  }
  return { ...g, pos, nor: creaseNormals(pos, g.index, group) };
}
/** The nearest body surface among `region`'s vertices (a mask on the face, not on the shoulder). */
function surfaceIn(body, p, max, region) {
  body.regionGrids ??= new Map();
  let grid = body.regionGrids.get(region);
  if (!grid) body.regionGrids.set(region, (grid = new Grid(body.pos, 0.03, (v) => body.share(v, region) >= 0.3)));
  const v = grid.nearest(p, max);
  if (v < 0) return null;
  const tris = new Set(body.vt[v]);
  for (const t of body.vt[v]) for (let k = 0; k < 3; k++) for (const t2 of body.vt[body.index[t + k]]) tris.add(t2);
  const best = new Vector3(), tmp = new Vector3();
  let bd = Infinity, bt = -1;
  for (const t of tris) {
    closestOnTri(p, V(body.pos, body.index[t]), V(body.pos, body.index[t + 1]), V(body.pos, body.index[t + 2]), tmp);
    const d = tmp.distanceToSquared(p);
    if (d < bd) (bd = d), best.copy(tmp), (bt = t);
  }
  const a = V(body.pos, body.index[bt]), b = V(body.pos, body.index[bt + 1]), c = V(body.pos, body.index[bt + 2]);
  const nn = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  if (nn.dot(V(body.nor, v)) < 0) nn.negate();
  return { p: best, n: nn, v, d: Math.sqrt(bd) };
}
const allTo = (body, n, bone) => {
  const ji = new Uint16Array(n * 4), jw = new Float32Array(n * 4);
  const j = body.ix.get(bone);
  for (let i = 0; i < n; i++) (ji[i * 4] = j), (jw[i * 4] = 1);
  return { ji, jw };
};

/**
 * A helmet low and close (CLAUDE.md: as a real one is worn): its inside 7.5 mm over the crown, its front rim
 * 1.5 cm over the brows; as wide and deep as it takes to keep its inside ≥ 5 mm off the skull all round (width
 * and height scaled apart, its middle moved front-to-back for the least size). The chin straps laid under the
 * chin, the whole of it on Head. Hidden under it: the scalp and the hair above its rim.
 */
function fitHelmet(body, src, cfg = {}) {
  const hf = headFrame(body);
  const prof = (src.prof ??= innerProfile(src));
  const rimFront = prof.rimAt(Math.PI / 2);
  if (process.env.DEBUG_HEAD) console.log(body.id, JSON.stringify(Object.fromEntries(Object.entries(hf).filter(([k]) => k !== 'head').map(([k, v]) => [k, +v.toFixed(3)]))));
  if (process.env.DEBUG_HELMET && !src.printed) {
    src.printed = 1;
    const deg = [0, 45, 90, 135, 180, 225, 270, 315];
    console.log('prof y0', prof.y0.toFixed(3), 'top', prof.top.toFixed(3), 'rim', deg.map((d) => prof.rimAt((d * Math.PI) / 180).toFixed(3)).join(' '));
    for (let y = prof.top; y > prof.y0; y -= (prof.top - prof.y0) / 14) console.log(y.toFixed(3), deg.map((d) => prof.at((d * Math.PI) / 180, y).toFixed(3)).join(' '));
  }
  const ellR = (th) => 1 / Math.sqrt((Math.cos(th) / hf.ax) ** 2 + (Math.sin(th) / hf.az) ** 2);
  const eqY = hf.brow + 0.03, ay = Math.max(0.03, hf.top - eqY);
  const samples = [];
  for (let k = 0; k < 36; k++) {
    const th = (k / 36) * TAU;
    for (let j = 0; j <= 6; j++) {
      const y = hf.brow + 0.01 + ((hf.top - 0.012 - hf.brow - 0.01) * j) / 6;
      const f = y <= eqY ? 1 : Math.sqrt(Math.max(0, 1 - ((y - eqY) / ay) ** 2));
      const r = ellR(th) * f;
      samples.push(new Vector3(hf.cx + r * Math.cos(th), y, hf.cz + r * Math.sin(th)));
    }
  }
  const innerTop = prof.top;
  // Scales: across (sx), front to back (sz), up (sy); the middle moved front-to-back by dz.
  let sx = (2 * hf.ax + 0.015) / (2 * Math.max(0.01, prof.at(0, (innerTop + prof.rimMin) / 2))), sz = sx, sy = sx, ty = 0, dz = 0, clear = [];
  const gapsFor = (sx, sz, z) => {
    const out = [];
    for (const p of samples) {
      const qx = (p.x - hf.cx) / sx, qz = (p.z - hf.cz - z) / sz, yl = (p.y - ty) / sy;
      const th = Math.atan2(qz, qx);
      if (yl < prof.rimAt(th) + 0.005) continue;
      const r = prof.at(th, yl);
      if (!r) continue;
      const rl = Math.hypot(qx, qz);
      // Local clearance to metres along that way.
      out.push((r - rl) * Math.hypot(sx * Math.cos(th), sz * Math.sin(th)));
    }
    return out.sort((a, b) => a - b);
  };
  for (let it = 0; it < 4; it++) {
    // Height: the inside over the crown, the front rim over the brows (kept near the other scales).
    const sm = (sx + sz) / 2;
    sy = (hf.top + HELMET_GAP - (hf.brow + 0.015)) / Math.max(1e-3, innerTop - rimFront);
    sy = Math.min(sm * 1.3, Math.max(sm * 0.75, sy));
    // The front rim first (the eyes stay clear): the crown's gap is what is left.
    ty = hf.brow + 0.015 - sy * rimFront;
    // Across and deep: 92% of the skull ≥ 5 mm inside (pads and the harness may touch), the middle gap the least.
    let best = null;
    for (let x = sx * 0.6; x < sx * 1.8; x *= 1.012)
      for (let k = 0.8; k <= 1.25; k += 0.025)
        for (let z = -0.02; z <= 0.0201; z += 0.004) {
          const g = gapsFor(x, x * k, z);
          if (g.length < samples.length * 0.3) continue;
          if (g[Math.floor(g.length * 0.08)] < 0.005) continue;
          const med = g[g.length >> 1];
          const cost = Math.abs(med - HELMET_GAP) + x * 0.01;
          if (!best || cost < best.cost) best = { cost, x, k, z, g };
        }
    if (!best) break;
    sx = best.x;
    sz = best.x * best.k;
    dz = best.z;
    clear = best.g;
  }
  const s = (sx + sz) / 2;
  const place = new Matrix4().makeTranslation(hf.cx, ty, hf.cz + dz).multiply(new Matrix4().makeScale(sx, sy, sz)).multiply(new Matrix4().makeTranslation(-prof.lcx, 0, -prof.lcz));
  const inv = place.clone().invert();
  // The model's own chin straps hang loose (as it lay): cut off, a strap laid under the chin instead.
  const strapY = prof.rimMin - 0.02;
  // A visor hanging in front is not a strap: in front (±60°) and out at the shell's own reach or beyond.
  // Out: past the inside of the shell by 8% at its height, or (below the shell) at the front rim's reach.
  const frontR = prof.at(Math.PI / 2, rimFront) || 0.3;
  const out = (i, k) => {
    const x = src.pos[i * 3] - prof.lcx, y = src.pos[i * 3 + 1], z = src.pos[i * 3 + 2] - prof.lcz;
    const th = Math.atan2(z, x);
    if (Math.abs(th - Math.PI / 2) > (Math.PI * 7) / 18) return false;
    const a = prof.at(th, y), r = Math.hypot(x, z);
    return a > 0 ? r > a * k : r > 0.9 * frontR;
  };
  // …and what joins it along its faces out to the shell's inside (its inner edge, its hinges).
  const isVisor = new Uint8Array(src.pos.length / 3);
  for (let i = 0; i < isVisor.length; i++) isVisor[i] = out(i, 1.08) ? 1 : 0;
  for (let pass = 0; pass < 3; pass++) {
    const add = [];
    for (let t = 0; t < src.index.length; t += 3) {
      const tri = [src.index[t], src.index[t + 1], src.index[t + 2]];
      if (tri.some((i) => isVisor[i])) for (const i of tri) if (!isVisor[i] && out(i, 1.0)) add.push(i);
    }
    for (const i of add) isVisor[i] = 1;
  }
  const visor = (i) => isVisor[i] === 1;
  const low = (i) => src.pos[i * 3 + 1] < strapY && !visor(i);
  const shellIdx = [], strapV = [];
  for (let t = 0; t < src.index.length; t += 3) {
    const tri = [src.index[t], src.index[t + 1], src.index[t + 2]];
    if (tri.some(low)) strapV.push(...tri);
    else shellIdx.push(...tri);
  }
  let g = transformN({ ...src, index: Uint32Array.from(shellIdx) }, place);
  const placed = g.pos;
  // The visor rigid as modelled (not its points snapped out of the brow one by one: spikes) — moved as a whole
  // by the mean shift of the shell's front round it.
  g = wrapOnto(body, g, { pick: () => false, floor: 0.003, centre: () => new Vector3(hf.cx, hf.top - 0.08, hf.cz), stay: visor });
  {
    const shift = new Vector3();
    let k = 0;
    for (let i = 0; i < src.pos.length / 3; i++) {
      if (visor(i)) continue;
      const th = Math.atan2(src.pos[i * 3 + 2] - prof.lcz, src.pos[i * 3] - prof.lcx);
      if (Math.abs(th - Math.PI / 2) > (Math.PI * 7) / 18 || src.pos[i * 3 + 1] < rimFront) continue;
      shift.add(V(g.pos, i).sub(V(placed, i)));
      k++;
    }
    if (k) {
      shift.multiplyScalar(1 / k);
      const pos = new Float32Array(g.pos);
      for (let i = 0; i < src.pos.length / 3; i++) if (visor(i)) setV(pos, i, V(placed, i).add(shift));
      g = { ...g, pos };
    }
  }
  g = { ...g, ...allTo(body, g.pos.length / 3, 'Head') };
  if (strapV.length > 30) {
    const at = (th, dy = 0) => {
      const y = prof.rimAt(th) + 0.02;
      const r = prof.at(th, y + 0.02) || 0.3;
      return new Vector3(prof.lcx + Math.cos(th) * r * 0.97, y + dy, prof.lcz + Math.sin(th) * r * 0.97).applyMatrix4(place);
    };
    const strapUv = [src.uv[strapV[0] * 2], src.uv[strapV[0] * 2 + 1]];
    const path = [
      at(Math.PI * 0.12),
      new Vector3(hf.cx + hf.ax * 0.85, (hf.eyeY + hf.chin) / 2, hf.cz + hf.az * 0.35),
      new Vector3(hf.cx + hf.ax * 0.55, hf.chin - 0.005, hf.cz + hf.az * 0.45),
      new Vector3(hf.cx, hf.chin - 0.025, hf.cz + hf.az * 0.5),
      new Vector3(hf.cx - hf.ax * 0.55, hf.chin - 0.005, hf.cz + hf.az * 0.45),
      new Vector3(hf.cx - hf.ax * 0.85, (hf.eyeY + hf.chin) / 2, hf.cz + hf.az * 0.35),
      at(Math.PI * 0.88),
    ];
    const r = ribbon(body, path, { width: 0.018, thick: 0.003, lift: 0.004, uv: strapUv, allowed: HEADB, fallback: 'Head', flat: true });
    g = merge(g, { ...r, ...allTo(body, r.pos.length / 3, 'Head') });
  }
  const { ji, jw } = g;
  // Hidden: the head above the rim (the scalp and the hair under the shell), and anything poking out of it.
  const cover = [];
  const aboveRim = new Set();
  const shellTg = triGrid(g);
  const q = new Vector3();
  for (const v of hf.head) {
    q.copy(V(body.pos, v)).applyMatrix4(inv);
    const th = Math.atan2(q.z - prof.lcz, q.x - prof.lcx);
    const above = q.y - prof.rimAt(th);
    if (above <= 0) continue;
    aboveRim.add(v);
    // Deep under the shell, or out through it (hair): hidden; just under the rim the skin shows (it would be a hole).
    const r = prof.at(th, q.y);
    if (!(above > 0.06 || (r && Math.hypot(q.x - prof.lcx, q.z - prof.lcz) > r - 0.01))) continue;
    // And only where the shell is in front of it — straight out from the head and along the skin's normal: an
    // open helmet (a hard hat on its suspension, a high-cut back) shows the head under its edge.
    const p = V(body.pos, v);
    const out = new Vector3(p.x - hf.cx, 0, p.z - hf.cz);
    if (out.lengthSq() > 1e-8 && cast(shellTg, p, out.normalize(), 0.15) < 0) continue;
    if (cast(shellTg, p, V(body.nor, v), 0.15) < 0) continue;
    cover.push(v);
  }
  // Hair out through the shell: the piece between it and the dome's middle — above the rim only (below it the
  // line to the middle crosses the chin straps and the harness, and hiding the cheeks there leaves holes; hair
  // under a brim or a neck guard is under the helmet, not through it).
  const extra = pokeShell(body, g, (v) => aboveRim.has(v) && body.share(v, HEADB) >= 0.1, g);
  // Report: the clearance, the front rim over the brows, the side rim against the brows (the ears' top).
  const rimW = (th) => new Vector3(prof.lcx + Math.cos(th) * 0.3, prof.rimAt(th), prof.lcz + Math.sin(th) * 0.3).applyMatrix4(place).y;
  return {
    g: { ...g, ji, jw },
    cover: ringOf(body, new Set([...cover, ...extra]), (v) => body.share(v, HEADB) >= 0.1),
    info: {
      scale: [+sx.toFixed(3), +sy.toFixed(3), +sz.toFixed(3)],
      gap8: +(clear[Math.floor(clear.length * 0.08)] ?? 0).toFixed(4),
      gapMed: +(clear[clear.length >> 1] ?? 0).toFixed(4),
      frontOverBrow: +(rimW(Math.PI / 2) - hf.brow).toFixed(4),
      sideUnderBrow: +(hf.brow - Math.min(rimW(0), rimW(Math.PI))).toFixed(4),
      backUnderBrow: +(hf.brow - rimW(-Math.PI / 2)).toFixed(4),
    },
  };
}

/**
 * Glasses on the bridge of the nose: the front of the frame the face's width, its nose pads on the bridge, the
 * lenses at the eyes (≥ 6 mm in front of them); the arms or the strap laid along the head (3 mm off: under a
 * helmet, whose inside stands 5 mm off). All on Head. The lens triangles go apart (their own material).
 */
function fitGlasses(body, src) {
  const hf = headFrame(body);
  const b = bounds(src.pos, 0, 1).full;
  const D = b.max[2] - b.min[2];
  const front = (i) => src.pos[i * 3 + 2] > b.max[2] - D * 0.22;
  const fx = [], fy = [];
  for (let i = 0; i < src.pos.length / 3; i++) if (front(i)) fx.push(src.pos[i * 3]), fy.push(src.pos[i * 3 + 1]);
  const frameW = Math.max(...fx) - Math.min(...fx);
  const s = (hf.faceW * 0.98) / frameW;
  // The lenses' middle height (their triangles), else the frame's.
  const ly = [];
  if (src.lens) for (let t = 0; t < src.index.length; t += 3) if (src.lens[t / 3]) for (let k = 0; k < 3; k++) ly.push(src.pos[src.index[t + k] * 3 + 1]);
  const lensY = ly.length ? (Math.min(...ly) + Math.max(...ly)) / 2 : (Math.min(...fy) + Math.max(...fy)) / 2;
  // The nose pads: the frame's back at the middle (the bridge), nearest the face.
  let bridge = -Infinity;
  for (let i = 0; i < src.pos.length / 3; i++) if (front(i) && Math.abs(src.pos[i * 3]) < 0.04 * D * 4 && src.pos[i * 3 + 1] > lensY - 0.15) bridge = Math.max(bridge, -src.pos[i * 3 + 2]);
  let zBack = Infinity;
  for (let i = 0; i < src.pos.length / 3; i++) if (front(i) && Math.abs(src.pos[i * 3]) < frameW * 0.08) zBack = Math.min(zBack, src.pos[i * 3 + 2]);
  let place = new Matrix4().makeTranslation(hf.cx, hf.eyeY - lensY * s, hf.bridgeZ + 0.004 - zBack * s).multiply(new Matrix4().makeScale(s, s, s));
  // The eyes ≥ 6 mm behind the lenses: moved forward until so.
  const eyes = hf.head.filter((v) => Math.abs(body.pos[v * 3 + 1] - hf.eyeY) < 0.008 && Math.abs(Math.abs(body.pos[v * 3] - hf.cx) - 0.032) < 0.012 && body.pos[v * 3 + 2] > hf.cz);
  const eyeZ = eyes.length ? Math.max(...eyes.map((v) => body.pos[v * 3 + 2])) : hf.bridgeZ - 0.01;
  let lensBack = Infinity;
  if (src.lens) for (let t = 0; t < src.index.length; t += 3) if (src.lens[t / 3]) for (let k = 0; k < 3; k++) { const i = src.index[t + k]; if (Math.abs(Math.abs(src.pos[i * 3]) * s - 0.032) < 0.015) lensBack = Math.min(lensBack, src.pos[i * 3 + 2]); }
  if (Number.isFinite(lensBack)) {
    const lz = new Vector3(0, 0, lensBack).applyMatrix4(place).z;
    if (lz < eyeZ + 0.006) place = new Matrix4().makeTranslation(0, 0, eyeZ + 0.006 - lz).multiply(place);
  }
  let g = transform(src, place);
  // Arms / strap: behind the front, along the head.
  const back = (i) => !front(i);
  g = wrapOnto(body, g, { pick: back, offset: 0.003, floor: 0.002, centre: () => new Vector3(hf.cx, hf.eyeY, hf.cz), region: HEADB, sigma: 0.01 });
  const { ji, jw } = allTo(body, g.pos.length / 3, 'Head');
  return { g: { ...g, ji, jw, lens: src.lens }, cover: pokeCover(body, g, (v) => body.share(v, HEADB) >= 0.3), info: { scale: +s.toFixed(3), eyeGap: Number.isFinite(lensBack) ? +(new Vector3(0, 0, lensBack).applyMatrix4(place).z - eyeZ).toFixed(4) : null } };
}

/**
 * A mask (balaclava, shemagh, half mask) round the face and neck: its box set on the head by `cfg.mask`
 * (what it covers), then laid on the skin 4 mm off with the body's weights (Head, Neck, the top of the spine).
 * Hidden under it: what it covers (its inside along the skin's normal) and anything poking out.
 */
function fitMask(body, src, cfg) {
  const hf = headFrame(body);
  const b = bounds(src.pos, 0, 1).full;
  const size = b.max.map((v, i) => v - b.min[i]);
  const neck = body.joint('Neck');
  const headW = hf.ax * 2, headD = hf.az * 2;
  let lo, hi, w, d, zc = hf.cz;
  if (cfg.mask === 'head') {
    // Crown to the base of the neck.
    (hi = hf.top + 0.006), (lo = neck.y - 0.05), (w = headW + 0.03), (d = headD + 0.03);
  } else if (cfg.mask === 'mouth') {
    // The bridge of the nose to under the chin; the loops back over the ears.
    (hi = hf.eyeY - 0.012), (lo = hf.chin - 0.035), (w = hf.faceW * 1.05), (d = (hf.zf - hf.cz) * 2.1), (zc = hf.cz + 0.01);
  } else {
    // Round the neck up over the chin.
    (hi = hf.chin + 0.03), (lo = neck.y - 0.08), (w = headW + 0.04), (d = headD + 0.02);
  }
  const place = new Matrix4()
    .makeTranslation(hf.cx, (lo + hi) / 2, zc)
    .multiply(new Matrix4().makeScale(w / size[0], (hi - lo) / size[1], d / size[2]))
    .multiply(new Matrix4().makeTranslation(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -(b.min[2] + b.max[2]) / 2));
  let g = transformN(src, place);
  const axisAt = (p) => new Vector3(hf.cx, Math.min(Math.max(p.y, neck.y - 0.06), hf.top - 0.06), hf.cz - 0.01);
  g = wrapOnto(body, g, { offset: 0.004, floor: 0.003, centre: axisAt, region: (n) => HEAD_OR_NECK(n) || n === 'Spine2', sigma: 0.014 });
  const { ji, jw } = skinFrom(body, g.pos, (n) => HEAD_OR_NECK(n) || /^Spine2$/.test(n), 'Head');
  const keep = (v) => body.share(v, (n) => HEAD_OR_NECK(n) || n === 'Spine2') >= 0.3;
  const under = coveredBy(body, g, keep);
  // A balaclava covers the head whole: hair at the nape that would come out through it, hidden too.
  const shell = cfg.mask === 'head' ? [...pokeShell(body, g, keep, g)] : [];
  // A balaclava covers all but the eyes: the back of the head, the ears, the neck all round and the face under
  // the eye slit — hair on Head and the fabric on the neck too part a little in motion, so all of it hidden,
  // down to 2 cm above the hem; at the front above that only what the fabric is over.
  if (cfg.mask === 'head') {
    const nape = new Set();
    for (let v = 0; v < body.count; v++)
      if (keep(v) && body.pos[v * 3 + 1] >= lo + 0.02 && body.pos[v * 3 + 1] <= hi && body.pos[v * 3 + 2] <= hf.cz + 0.02) nape.add(v);
    shell.push(...ringOf(body, nape, (v) => body.share(v, HEADB) >= 0.1));
  }
  return { g: { ...g, ji, jw }, cover: [...new Set([...under, ...pokeCover(body, g, keep), ...shell])], info: { tris: g.index.length / 3 } };
}
/** Body vertices with the piece straight out along the skin's normal over them (within 2.5 cm). */
function coveredBy(body, piece, keep) {
  const tg = triGrid(piece);
  const pg = new Grid(piece.pos, 0.03);
  const out = [];
  for (let v = 0; v < body.count; v++) {
    if (!keep(v)) continue;
    const p = V(body.pos, v);
    if (pg.nearest(p, 0.04) < 0) continue;
    const n = V(body.nor, v);
    if (cast(tg, p.clone().addScaledVector(n, -0.01), n, 0.035) >= 0) out.push(v);
  }
  return out;
}

/**
 * The lens triangles of a pair of glasses: by colour (tinted lenses in the texture) or, where the lens is the
 * frame's own colour, by place — the frontmost surface inside the frame's outline, `inset` in from it.
 */
/** Triangles whose texture is light (mean of 4 samples' brightness ≥ `min`, 0–255). */
async function lightTris(g, min) {
  const n = g.index.length / 3;
  const out = new Uint8Array(n);
  const { data, info } = await sharp(Buffer.from(g.tex)).raw().toBuffer({ resolveWithObject: true });
  for (let t = 0; t < n; t++) {
    let l = 0;
    for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k++) (u += w[k] * g.uv[g.index[t * 3 + k] * 2]), (v += w[k] * g.uv[g.index[t * 3 + k] * 2 + 1]);
      const o = (Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height))) * info.width + Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width)))) * info.channels;
      l += (data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11) / 4;
    }
    out[t] = l >= min ? 1 : 0;
  }
  return out;
}

async function findLens(g, how) {
  const n = g.index.length / 3;
  const lens = new Uint8Array(n);
  const P = (i) => V(g.pos, i);
  const nrm = (t) => P(g.index[t * 3 + 1]).sub(P(g.index[t * 3])).cross(P(g.index[t * 3 + 2]).sub(P(g.index[t * 3]))).normalize();
  if (how.by === 'color') {
    const { data, info } = await sharp(Buffer.from(g.tex)).raw().toBuffer({ resolveWithObject: true });
    for (let t = 0; t < n; t++) {
      const c = [0, 0, 0];
      for (const w of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        let u = 0, v = 0;
        for (let k = 0; k < 3; k++) (u += w[k] * g.uv[g.index[t * 3 + k] * 2]), (v += w[k] * g.uv[g.index[t * 3 + k] * 2 + 1]);
        const o = (Math.min(info.height - 1, Math.max(0, Math.floor(v * info.height))) * info.width + Math.min(info.width - 1, Math.max(0, Math.floor(u * info.width)))) * info.channels;
        for (let k = 0; k < 3; k++) c[k] += data[o + k] / 4;
      }
      lens[t] = Math.max(...c) - Math.min(...c) >= how.sat && c[0] > c[1] * 1.15 && c[0] > c[2] * 1.3 ? 1 : 0;
    }
  } else {
    // The outline from the front (rasterised), each pixel's distance in from it; the frontmost triangle per pixel.
    const b = bounds(g.pos, 0, 1).full;
    const R = 256, span = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) * 1.04;
    const ox = (b.min[0] + b.max[0]) / 2 - span / 2, oy = (b.min[1] + b.max[1]) / 2 - span / 2;
    const zb = new Float32Array(R * R).fill(-Infinity), owner = new Int32Array(R * R).fill(-1);
    for (let t = 0; t < n; t++) {
      const p = [0, 1, 2].map((k) => P(g.index[t * 3 + k]));
      const q = p.map((v) => [((v.x - ox) / span) * R, ((v.y - oy) / span) * R, v.z]);
      const x0 = Math.max(0, Math.floor(Math.min(...q.map((v) => v[0])))), x1 = Math.min(R - 1, Math.ceil(Math.max(...q.map((v) => v[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...q.map((v) => v[1])))), y1 = Math.min(R - 1, Math.ceil(Math.max(...q.map((v) => v[1]))));
      const area = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]);
      if (Math.abs(area) < 1e-9) continue;
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const a = ((q[1][0] - x) * (q[2][1] - y) - (q[2][0] - x) * (q[1][1] - y)) / area;
          const bb = ((q[2][0] - x) * (q[0][1] - y) - (q[0][0] - x) * (q[2][1] - y)) / area;
          const c = 1 - a - bb;
          if (a < 0 || bb < 0 || c < 0) continue;
          const z = a * q[0][2] + bb * q[1][2] + c * q[2][2];
          if (z > zb[y * R + x]) (zb[y * R + x] = z), (owner[y * R + x] = t);
        }
    }
    // Distance in from the outline (city-block passes).
    const dist = new Float32Array(R * R).fill(1e9);
    for (let i = 0; i < R * R; i++) if (owner[i] < 0) dist[i] = 0;
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) { const i = y * R + x; if (x) dist[i] = Math.min(dist[i], dist[i - 1] + 1); if (y) dist[i] = Math.min(dist[i], dist[i - R] + 1); }
    for (let y = R - 1; y >= 0; y--) for (let x = R - 1; x >= 0; x--) { const i = y * R + x; if (x < R - 1) dist[i] = Math.min(dist[i], dist[i + 1] + 1); if (y < R - 1) dist[i] = Math.min(dist[i], dist[i + R] + 1); }
    const inset = (how.inset * (b.max[0] - b.min[0]) * R) / span;
    const votes = new Map();
    for (let i = 0; i < R * R; i++) if (owner[i] >= 0) {
      const v = votes.get(owner[i]) ?? [0, 0];
      v[dist[i] > inset ? 0 : 1]++;
      votes.set(owner[i], v);
    }
    for (const [t, [inn, out]] of votes) if (inn > out && nrm(t).z > 0.2) lens[t] = 1;
    // The lens's other layers (its inside, a second pane): every triangle wholly within the window too.
    const dAt = (v) => {
      const x = Math.round(((v.x - ox) / span) * R), y = Math.round(((v.y - oy) / span) * R);
      return x < 0 || y < 0 || x >= R || y >= R ? 0 : dist[y * R + x];
    };
    for (let t = 0; t < n; t++) if (Math.min(...[0, 1, 2].map((k) => dAt(P(g.index[t * 3 + k])))) > inset * 1.3) lens[t] = 1;
  }
  // Tidy: a triangle goes with most of its neighbours (by shared corner positions).
  const at = new Map();
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) { const kk = P(g.index[t * 3 + k]).toArray().map((x) => Math.round(x * 1e4)).join(','); let l = at.get(kk); if (!l) at.set(kk, (l = [])); l.push(t); }
  for (let pass = 0; pass < 2; pass++) {
    const nx = Uint8Array.from(lens);
    for (let t = 0; t < n; t++) {
      const nb = new Set();
      for (let k = 0; k < 3; k++) for (const u of at.get(P(g.index[t * 3 + k]).toArray().map((x) => Math.round(x * 1e4)).join(','))) if (u !== t) nb.add(u);
      let on = 0;
      for (const u of nb) on += lens[u];
      if (nb.size >= 3) nx[t] = on * 2 > nb.size ? 1 : on * 4 < nb.size ? 0 : lens[t];
    }
    lens.set(nx);
  }
  return lens;
}

/** Split a geometry by a per-triangle flag: [the rest, the flagged]. */
/**
 * A lens's normals made a smooth curved shell (front +Z): from a centre 10 cm behind the lens's middle, the
 * height bent half as much — smooth shading, not a sparkle off every simplified facet. All outward (the
 * source's own normals are noisy; the inside is a back face, flipped by the double-sided material). A copy:
 * the frame keeps its normals.
 */
function smoothNormals(g) {
  const used = [...new Set(g.index)];
  const c = [0, 0, 0];
  for (const i of used) for (let k = 0; k < 3; k++) c[k] += g.pos[i * 3 + k] / used.length;
  c[2] -= 0.1;
  const nor = Float32Array.from(g.nor);
  for (const i of used) {
    const n = [g.pos[i * 3] - c[0], (g.pos[i * 3 + 1] - c[1]) * 0.5, g.pos[i * 3 + 2] - c[2]];
    const l = Math.hypot(...n) || 1;
    for (let k = 0; k < 3; k++) nor[i * 3 + k] = n[k] / l;
  }
  return { ...g, nor };
}

function splitTris(g, flag) {
  const pick = (want) => {
    const idx = [];
    for (let t = 0; t < g.index.length; t += 3) if (!!flag[t / 3] === want) idx.push(g.index[t], g.index[t + 1], g.index[t + 2]);
    return { ...g, index: Uint32Array.from(idx) };
  };
  return [pick(false), pick(true)];
}

/**
 * A stand-in shemagh until its model comes (assets/incoming/gear/shemagh.glb): a scarf wound round the neck in
 * loose folds, the knot's tails down the chest; its texture a faded sand-and-olive weave (grim palette).
 */
function shemaghStandIn() {
  const P = [], N = [], U = [], I = [];
  const SEG = 40, ROWS = 10;
  for (let r = 0; r <= ROWS; r++) {
    const v = r / ROWS;
    for (let s = 0; s <= SEG; s++) {
      const th = (s / SEG) * TAU;
      const fold = 1 + 0.06 * Math.sin(th * 7 + v * 5) * Math.sin(v * Math.PI);
      const R = (0.5 + 0.12 * Math.sin(v * Math.PI)) * fold;
      const x = Math.cos(th) * R, z = Math.sin(th) * R * 0.92, y = v - 0.5 - (Math.sin(th) > 0 ? 0.12 * Math.sin(th) * (1 - v) : 0);
      P.push(x, y, z);
      N.push(Math.cos(th), 0, Math.sin(th));
      U.push(s / SEG, v);
    }
  }
  for (let r = 0; r < ROWS; r++)
    for (let s = 0; s < SEG; s++) {
      const a = r * (SEG + 1) + s, b = a + 1, c = a + SEG + 1, d = c + 1;
      I.push(a, c, b, b, c, d);
    }
  // The tails of the knot, hanging down the front.
  const base = P.length / 3;
  for (let r = 0; r <= 6; r++)
    for (let s = 0; s <= 4; s++) {
      const v = r / 6, u = s / 4;
      P.push((u - 0.5) * 0.4 * (1 - v * 0.5), -0.55 - v * 0.55, 0.55 + 0.02 * Math.sin(u * 9));
      N.push(0, 0, 1);
      U.push(u, 1 - v);
    }
  for (let r = 0; r < 6; r++)
    for (let s = 0; s < 4; s++) {
      const a = base + r * 5 + s, b = a + 1, c = a + 5, d = c + 1;
      I.push(a, b, c, b, d, c);
    }
  const W = 256, img = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      // Plain worn cloth (a stand-in: no pattern — a check at this size reads as broken triangles): olive
      // and sand mixed in soft blotches, a fine weave, faded folds.
      const thread = ((x >> 1) + (y >> 1)) & 1;
      const blot = 0.5 + 0.25 * Math.sin(x * 0.045 + Math.sin(y * 0.031) * 2) + 0.25 * Math.sin(y * 0.052 + Math.cos(x * 0.027) * 2);
      const sand = [0x7c, 0x75, 0x60], olive = [0x5b, 0x5a, 0x44];
      const cc = sand.map((v, i) => olive[i] + (v - olive[i]) * blot);
      const c = (cc[0] << 16) | (cc[1] << 8) | cc[2];
      const k = 0.94 + 0.04 * thread + 0.03 * Math.sin(x * 0.7 + y * 0.3);
      const o = (y * W + x) * 4;
      img[o] = ((c >> 16) & 255) * k;
      img[o + 1] = ((c >> 8) & 255) * k;
      img[o + 2] = (c & 255) * k;
      img[o + 3] = 255;
    }
  return { pos: Float32Array.from(P), nor: Float32Array.from(N), uv: Float32Array.from(U), index: Uint32Array.from(I), raw: { data: img, w: W, h: W } };
}


/** A ribbon laid on the body along a path (bind space): `width` wide, `thick` thick, `lift` off the skin. */
function ribbon(body, path, { width = 0.045, thick = 0.006, lift = 0.005, uv, allowed, fallback, flat = false, clear = 0.004, edgesOnSkin = true }) {
  // Dense, smooth path, each point on the skin.
  const pts = [];
  for (let k = 0; k < path.length - 1; k++) {
    const p0 = path[Math.max(0, k - 1)], p1 = path[k], p2 = path[k + 1], p3 = path[Math.min(path.length - 1, k + 2)];
    for (let s = 0; s < 8; s++) {
      const t = s / 8, t2 = t * t, t3 = t2 * t;
      pts.push(
        new Vector3()
          .addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t)
          .addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1)
          .addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t)
          .addScaledVector(p3, 0.5 * t3 - 0.5 * t2),
      );
    }
  }
  pts.push(path[path.length - 1].clone());
  const onSkin = pts.map((p) => {
    const s = surface(body, p, 0.4);
    return s ? { p: s.p.clone().addScaledVector(s.n, lift), n: s.n } : { p, n: new Vector3(0, 0, 1) };
  });
  // Smooth the laid path a little (no kinks between faces).
  for (let it = 0; it < 3; it++)
    for (let i = 1; i < onSkin.length - 1; i++) onSkin[i].p.lerpVectors(onSkin[i - 1].p, onSkin[i + 1].p, 0.5).lerp(onSkin[i].p, 0.5);
  // Back onto the skin (smoothing lifts it off the hollows).
  for (const q of onSkin) {
    const s = surface(body, q.p, 0.1);
    if (s) q.p.copy(s.p).addScaledVector(s.n, lift), q.n.copy(s.n);
  }
  // The normals along it smoothed and kept on one side: a strap is a flat band, it does not twist (loose
  // cloth under it turns the skin's normal every few centimetres: the band went zigzag).
  if (flat) for (let i = 1; i < onSkin.length; i++) if (onSkin[i].n.dot(onSkin[i - 1].n) < 0) onSkin[i].n.negate();
  for (let it = 0; flat && it < 12; it++) {
    const sm = onSkin.map((q, i) => q.n.clone().multiplyScalar(2).add(onSkin[Math.max(0, i - 1)].n).add(onSkin[Math.min(onSkin.length - 1, i + 1)].n).normalize());
    sm.forEach((n, i) => onSkin[i].n.copy(n));
  }
  // Nowhere under the cloth (loose scrubs fold over the skin the path was laid on).
  if (flat) for (const q of onSkin) {
    const f = signed(body, q.p);
    if (f.s && f.d < lift) q.p.addScaledVector(q.n, Math.min(clear, lift - f.d));
  }
  // One across-direction for the whole band, carried along it (parallel transport): no flips between samples.
  const sides = [];
  onSkin.forEach((q, i) => {
    const tan = onSkin[Math.min(onSkin.length - 1, i + 1)].p.clone().sub(onSkin[Math.max(0, i - 1)].p).normalize();
    const sd = new Vector3().crossVectors(tan, q.n).normalize();
    if (i && sd.dot(sides[i - 1]) < 0) sd.negate();
    sides.push(sd);
  });
  const P = [], N = [], U = [], I = [];
  onSkin.forEach((q, i) => {
    const side = sides[i].clone().multiplyScalar(width / 2);
    // Cross-section: bottom-left, bottom-right, top-right, top-left. An edge that would sink into the skin
    // is lifted along the band's normal (the band stays flat, its edges just clear the body).
    const edge = [-1, 1].map((a) => {
      const e = q.p.clone().addScaledVector(side, a);
      // On the body's curve (a shoulder): the edge laid on the skin near it, not lifted off along the flat band
      // (not under loose cloth: the skin it would find is under the scrubs).
      if (!flat) {
        // A pack's strap bends over the shoulder with the skin under its edges.
        const f = surface(body, e, 0.03);
        return f ? { p: f.p.clone().addScaledVector(f.n, lift), n: f.n.clone().add(q.n).normalize() } : { p: e, n: q.n };
      }
      const sk = surface(body, e, 0.03);
      if (sk && edgesOnSkin) e.copy(sk.p).addScaledVector(sk.n.dot(q.n) < 0 ? sk.n.clone().negate() : sk.n, lift);
      const f = signed(body, e);
      if (f.s && f.d < lift) e.addScaledVector(q.n, Math.min(clear, lift - f.d));
      return { p: e, n: q.n };
    });
    for (const [a, b] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      const e = edge[a < 0 ? 0 : 1];
      const v = e.p.clone().addScaledVector(e.n, thick * b);
      P.push(v.x, v.y, v.z);
      N.push(e.n.x, e.n.y, e.n.z);
      U.push(uv[0], uv[1]);
    }
    if (i === 0) return;
    const a0 = (i - 1) * 4, b0 = i * 4;
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      I.push(a0 + k, b0 + k, b0 + k2, a0 + k, b0 + k2, a0 + k2);
    }
  });
  const pos = Float32Array.from(P);
  const g = { pos, nor: vertexNormals(pos, I), uv: Float32Array.from(U), index: Uint32Array.from(I) };
  return { ...g, ...skinFrom(body, pos, allowed, fallback) };
}
function merge(a, b) {
  const n = a.pos.length / 3;
  const cat = (x, y, T) => {
    const o = new T(x.length + y.length);
    o.set(x);
    o.set(y, x.length);
    return o;
  };
  return {
    pos: cat(a.pos, b.pos, Float32Array),
    nor: cat(a.nor, b.nor, Float32Array),
    uv: cat(a.uv, b.uv, Float32Array),
    index: cat(a.index, b.index.map((i) => i + n), Uint32Array),
    ji: cat(a.ji, b.ji, Uint16Array),
    jw: cat(a.jw, b.jw, Float32Array),
  };
}
/** The UV of the piece's vertex nearest a point (a texel of its own webbing for the straps). */
function uvNear(g, p) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < g.pos.length / 3; i++) {
    const d = V(g.pos, i).distanceToSquared(p);
    if (d < bd) (bd = d), (best = i);
  }
  return [g.uv[best * 2], g.uv[best * 2 + 1]];
}
const STRAP_BONES = (n) => /^Spine[12]?$/.test(n) || /(Shoulder|Arm)$/.test(n) || n === 'Neck';
const BAG_BONES = (n) => STRAP_BONES(n) || n === 'Hips';

/** The pack on Spine2: its strap side 1 cm off the back; straps over the shoulders to under the arms. */
function fitPack(body, src) {
  const t = torso(body);
  const b = bounds(src.pos);
  const neck = body.joint('Neck'), spine2 = body.joint('Spine2'), spine1 = body.joint('Spine1');
  // Top of the frame at the shoulders' height (a bedroll may stand above), centred on the spine.
  const topY = neck.y - 0.03;
  let place = new Matrix4().makeTranslation(t.c[0], topY - b.max[1], t.min[2] - b.max[2] - 0.02);
  // Slide it in until its nearest part is 1 cm off the back.
  let gap = Infinity;
  // Its back panel (the middle of its strap side, not its own straps nor the bedroll on top) brought up to
  // the back: straight forward from each of its points to the skin, the nearest 1 cm off.
  const H = b.max[1] - b.min[1], Wd = b.max[0] - b.min[0];
  const btg = body.tris ??= triGrid(body);
  const fwd = new Vector3(0, 0, 1);
  const gapsOf = (lo, hi) => {
    const gaps = [], ys = [];
    for (let i = 0; i < src.pos.length / 3; i++) {
      const q = V(src.pos, i);
      if (q.z < b.max[2] - 0.12 || Math.abs(q.x) > Wd * 0.3 || q.y < b.min[1] + H * lo || q.y > b.min[1] + H * hi) continue;
      const w = q.applyMatrix4(place);
      const h = cast(btg, w, fwd, 0.5);
      if (h > 0) gaps.push(h), ys.push(w.y);
    }
    return { gap: gaps.length ? percentile(gaps, 0.03) : Infinity, y: ys.length ? ys.reduce((x, y) => x + y, 0) / ys.length : 0 };
  };
  // Leaned on the back along its length: where the back falls away above the hips (a woman's, a big pack),
  // its top tilts in to the shoulder blades instead of standing off them.
  const up = gapsOf(0.5, 0.8), low = gapsOf(0.25, 0.5);
  if (Number.isFinite(up.gap) && Number.isFinite(low.gap) && up.gap > low.gap && up.y > low.y) {
    const tilt = Math.min(0.35, Math.atan((up.gap - low.gap) / (up.y - low.y)));
    const z = t.min[2];
    place = new Matrix4().makeTranslation(0, low.y, z).multiply(new Matrix4().makeRotationX(tilt)).multiply(new Matrix4().makeTranslation(0, -low.y, -z)).multiply(place);
  }
  gap = gapsOf(0.25, 0.8).gap;
  if (Number.isFinite(gap)) place = new Matrix4().makeTranslation(0, 0, gap + 0.006).multiply(place);
  const packAt = (x, y, z) => new Vector3(x, y, z).applyMatrix4(place);
  const back = t.min[2], front = t.max[2], half = t.size[0] / 2;
  const uv = uvNear(transform(src, place), packAt(b.min[0] * 0.4, b.max[1] * 0.6, b.max[2]));
  let straps = null;
  for (const s of [1, -1]) {
    const x = t.c[0] + s * 0.08;
    const path = [
      packAt(s * 0.06, b.max[1] - 0.06, b.max[2]),
      new Vector3(x, neck.y + 0.03, back + 0.02),
      new Vector3(x + s * 0.02, neck.y + 0.03, (back + front) / 2),
      new Vector3(x + s * 0.03, spine2.y + 0.04, front),
      new Vector3(x + s * 0.06, spine1.y, front),
      new Vector3(t.c[0] + s * (half + 0.01), spine1.y - 0.03, (back + front) / 2),
      packAt(s * (b.max[0] - 0.03), b.min[1] + 0.1, b.max[2]),
    ];
    const r = ribbon(body, path, { uv, allowed: STRAP_BONES, fallback: 'Spine2' });
    // Where a strap meets the pack it moves with the pack (Spine2), blending into the body's weights.
    const placed = transform(src, place);
    const pg = new Grid(placed.pos, 0.03);
    const s2 = body.ix.get('Spine2');
    for (let i = 0; i < r.pos.length / 3; i++) {
      const k = pg.nearest(V(r.pos, i), 0.12);
      if (k < 0) continue;
      const d = V(placed.pos, k).distanceTo(V(r.pos, i));
      const t = Math.min(1, Math.max(0, (0.12 - d) / 0.06));
      const w = [];
      for (let c = 0; c < 4; c++) if (r.jw[i * 4 + c] > 0) w.push([r.ji[i * 4 + c], r.jw[i * 4 + c] * (1 - t)]);
      const own = w.find((x) => x[0] === s2);
      if (own) own[1] += t;
      else w.push([s2, t]);
      w.sort((x, y) => y[1] - x[1]);
      const top = w.slice(0, 4), sum = top.reduce((a, x) => a + x[1], 0);
      for (let c = 0; c < 4; c++) ((r.ji[i * 4 + c] = top[c]?.[0] ?? 0), (r.jw[i * 4 + c] = top[c] ? top[c][1] / sum : 0));
    }
    straps = straps ? merge(straps, r) : r;
  }
  return { place, bone: 'Spine2', straps };
}

/** Costumes in loose cloth (scrubs): a strap kept clear of their folds, or it sinks under them. */
const LOOSE = new Set(['doctor_m']);

/** The medic bag on the left hip (Hips), its strap from the right shoulder across the chest and the back. */
function fitBag(body, src) {
  const t = torso(body);
  const b = bounds(src.pos);
  const hips = body.joint('Hips'), neck = body.joint('Neck'), spine1 = body.joint('Spine1');
  // Its wide side out to the left (+X), hanging by the hip.
  const turn = new Matrix4().makeRotationY(Math.PI / 2);
  const depth = b.max[2] - b.min[2];
  let place = new Matrix4().makeTranslation(t.max[0] + depth / 2 + 0.03, hips.y - 0.02, t.c[2] + 0.02).multiply(turn);
  // In until 1 cm off the hip.
  // In until 1 cm off the hip (its side to the body: its back, local −Z).
  const gap = gapAlong(body, src, place, new Vector3(-1, 0, 0), (q, bb) => q.z < bb.min[2] + 0.05);
  if (Number.isFinite(gap)) place = new Matrix4().makeTranslation(-(gap - 0.01), 0, 0).multiply(place);
  const at = (x, y, z) => new Vector3(x, y, z).applyMatrix4(place);
  const uv = uvNear(transform(src, place), at(b.min[0] * 0.9, b.max[1] * 0.9, 0));
  const back = t.min[2], front = t.max[2], half = t.size[0] / 2, sx = -0.09;
  const path = [
    at(b.min[0] + 0.02, b.max[1], b.min[2] * 0.3),
    new Vector3(t.c[0] + half * 0.5, spine1.y, front),
    new Vector3(t.c[0] + sx * 0.3, (spine1.y + neck.y) / 2, front),
    new Vector3(t.c[0] + sx, neck.y - 0.01, front - 0.02),
    new Vector3(t.c[0] + sx - 0.01, neck.y + 0.03, (back + front) / 2),
    new Vector3(t.c[0] + sx, neck.y - 0.01, back + 0.02),
    new Vector3(t.c[0] + sx * 0.3, (spine1.y + neck.y) / 2, back),
    new Vector3(t.c[0] + half * 0.5, spine1.y, back),
    at(b.max[0] - 0.02, b.max[1], b.min[2] * 0.3),
  ];
  const strap = ribbon(body, path, { width: 0.04, uv, allowed: BAG_BONES, fallback: 'Spine1', flat: true, ...(LOOSE.has(body.id) ? { lift: 0.01, clear: 0.012, edgesOnSkin: false } : {}) });
  return { place, bone: 'Hips', straps: strap };
}

/** The toolbox on the right hip (Hips), its front out to the right (−X). */
function fitBoxHip(body, src) {
  const t = torso(body);
  const b = bounds(src.pos);
  const hips = body.joint('Hips');
  const depth = b.max[2] - b.min[2];
  let place = new Matrix4().makeTranslation(t.min[0] - depth / 2 - 0.03, hips.y + 0.06, t.c[2]).multiply(new Matrix4().makeRotationY(-Math.PI / 2));
  const gap = gapAlong(body, src, place, new Vector3(1, 0, 0), (q, bb) => q.z < bb.min[2] + 0.05);
  if (Number.isFinite(gap)) place = new Matrix4().makeTranslation(gap - 0.01, 0, 0).multiply(place);
  return { place, bone: 'Hips' };
}

/** LOD1's vertices are a re-ordered subset: each mapped to its LOD0 twin by position. */
function lodMap(b0, b1) {
  return Array.from({ length: b1.count }, (_, v) => b0.grid.nearest(V(b1.pos, v), 0.01));
}
const pack16 = (bits) => Buffer.from(new Uint16Array(bits).buffer).toString('base64');

const only = process.argv.slice(2);
const bodies = readdirSync(CHAR).filter((f) => f.endsWith('.glb') && !f.includes('_lod1') && f !== 'anims.glb').map((f) => f.replace('.glb', '')).filter((b) => !only.length || only.includes(b));
const fitInfo = {};
const meta = { gear: Object.fromEntries(IDS.filter((id) => pieces[id]).map((id, i) => [id, { kind: GEAR[id].kind, bit: i, tris: pieces[id].index.length / 3 }])), bodies: {} };
for (const id of bodies) {
  const body = await readBody(`${id}.glb`);
  body.id = id;
  const lod1 = await readBody(`${id}_lod1.glb`);
  const map = lodMap(body, lod1);
  const cover = new Uint16Array(body.count);
  const rigid = {};
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(`fit_${id}`);
  const line = [];
  for (const gid of IDS) {
    const src = pieces[gid];
    if (!src) continue;
    const kind = GEAR[gid].kind;
    const bit = 1 << meta.gear[gid].bit;
    if (kind === 'vest') {
      const v = fitVest(body, src);
      addMesh(doc, buf, scene, gid, v);
      const c = [...new Set([...coveredByVest(body, v), ...pokeCover(body, v, (k) => body.share(k, ARM) < 0.75)])];
      for (const k of c) cover[k] |= bit;
      line.push(`${gid} cover ${c.length}`);
    } else if (kind === 'helmet' || kind === 'glasses' || kind === 'mask') {
      const h = kind === 'helmet' ? fitHelmet(body, src, GEAR[gid]) : kind === 'glasses' ? fitGlasses(body, src) : fitMask(body, src, GEAR[gid]);
      if (h.g.lens) {
        const [frame, lens] = splitTris(h.g, h.g.lens);
        addMesh(doc, buf, scene, gid, frame);
        addMesh(doc, buf, scene, `${gid}_lens`, smoothNormals(lens));
      } else addMesh(doc, buf, scene, gid, h.g);
      for (const k of h.cover) cover[k] |= bit;
      fitInfo[id] ??= {};
      fitInfo[id][gid] = h.info;
      line.push(`${gid} ${JSON.stringify(h.info)} hide ${h.cover.length}`);
    } else if (kind === 'pack' || kind === 'bag') {
      const f = kind === 'pack' ? fitPack(body, src) : fitBag(body, src);
      rigid[gid] = { bone: f.bone, place: f.place.toArray().map((x) => +x.toFixed(5)) };
      addMesh(doc, buf, scene, gid, f.straps);
    } else if (kind === 'box') {
      const f = fitBoxHip(body, src);
      rigid[gid] = { bone: f.bone, place: f.place.toArray().map((x) => +x.toFixed(5)) };
    }
  }
  // A seam's two sides alike.
  {
    const tw = twinsOf(body);
    for (let v = 0; v < body.count; v++) for (const w of tw[v]) cover[v] |= cover[w];
  }
  const cover1 = new Uint16Array(lod1.count);
  map.forEach((v0, v1) => (cover1[v1] = v0 >= 0 ? cover[v0] : 0));
  meta.bodies[id] = { rigid, cover: pack16(cover), cover1: pack16(cover1) };
  await save(doc, `fit_${id}.glb`);
  report.push(`${id}: ${line.join(', ')}`);
}
// Only some bodies refitted: the others' fits kept.
if (only.length && existsSync(join(OUT, 'gear.json'))) meta.bodies = { ...JSON.parse(readFileSync(join(OUT, 'gear.json'), 'utf8')).bodies, ...meta.bodies };
writeFileSync(join(OUT, 'gear.json'), JSON.stringify(meta));
// The fit of every head piece on every body (clearances, rims): read by test:gear and the reports.
{
  const f = join(OUT, 'fit-report.json');
  const old = only.length && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  writeFileSync(f, JSON.stringify({ ...old, ...fitInfo }, null, 1));
}
console.log(report.join('\n'));
