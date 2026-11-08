#!/usr/bin/env node
/**
 * Gear: assets/incoming/gear/<id>.glb (Meshy) → public/models/gear, fitted to every character body
 * (public/models/characters, built first by npm run characters). Usage: npm run gear
 *
 *   <id>.glb               the piece at real size, ≤ 2500 triangles (helmets ≤ 1500), borders locked
 *   <id>_1024.webp / _512  its texture through the grim palette
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
import { Matrix4, Quaternion, Vector3 } from 'three';
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
  helmet_military: { kind: 'helmet', tris: 1500, shell: 1.2, rim: 0.42 },
  helmet_swat: { kind: 'helmet', tris: 1500, shell: 1.2, rim: 0.42 },
  helmet_firefighter: { kind: 'helmet', tris: 1500, shell: 1.18, rim: 0.4 },
  helmet_construction: { kind: 'helmet', tris: 1500, shell: 1.16, rim: 0.45 },
  vest_military: { kind: 'vest', tris: 2500 },
  vest_swat: { kind: 'vest', tris: 2500 },
  backpack_military: { kind: 'pack', tris: 2500, height: 0.64 },
  backpack_school: { kind: 'pack', tris: 2500, height: 0.44 },
  backpack_hiking: { kind: 'pack', tris: 2500, height: 0.8 },
  bag_medic: { kind: 'bag', tris: 2500, width: 0.38 },
  toolbox_mechanic: { kind: 'box', tris: 2500, width: 0.44 },
};
const IDS = Object.keys(GEAR);
const report = [];

// ── Small vector helpers on flat arrays ────────────────────────────────────────────────────────────
const V = (a, i) => new Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]);
const setV = (a, i, v) => ((a[i * 3] = v.x), (a[i * 3 + 1] = v.y), (a[i * 3 + 2] = v.z));
function percentile(values, p) {
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
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
  const want = Math.min(g.index.length, target * 3);
  const [index] = MeshoptSimplifier.simplifyWithAttributes(g.index, g.pos, 3, g.uv, 2, [1.5, 1.5], null, want, 1, ['LockBorder', 'Permissive']);
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
async function texture(id, png) {
  const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < info.width * info.height; i++) {
    const c = grimPixel(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    out[i * 4] = (c >> 16) & 255;
    out[i * 4 + 1] = (c >> 8) & 255;
    out[i * 4 + 2] = c & 255;
    out[i * 4 + 3] = 255;
  }
  for (const size of [1024, 512]) {
    const f = join(OUT, `${id}_${size}.webp`);
    await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().webp({ quality: 82 }).toFile(f);
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
  if (!existsSync(join(IN, `${id}.glb`))) {
    console.log(`нет gear/${id}.glb — пропуск`);
    continue;
  }
  const cfg = GEAR[id];
  let g = simplifyGear(await readGear(id), cfg.tris);
  // Packs come with their straps' side on −Z: turned to face the back they sit on.
  if (cfg.kind === 'pack') g = transform(g, new Matrix4().makeRotationY(Math.PI));
  const b = bounds(g.pos);
  const size = b.max.map((v, i) => v - b.min[i]);
  const real = cfg.kind === 'pack' ? cfg.height / size[1] : cfg.kind === 'bag' || cfg.kind === 'box' ? cfg.width / size[0] : 1;
  // Centred on its box, at real size (helmets and vests: unit, sized per body below).
  const c = b.min.map((v, i) => (v + b.max[i]) / 2);
  g = transform(g, new Matrix4().makeScale(real, real, real).multiply(new Matrix4().makeTranslation(-c[0], -c[1], -c[2])));
  pieces[id] = g;
  await texture(id, g.tex);
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(id);
  addMesh(doc, buf, scene, id, g);
  await save(doc, `${id}.glb`);
  report.push(`${id}: ${g.index.length / 3} tris`);
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
  // Nothing of the vest under the skin (nor nearer than half the offset).
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < n; i++) {
      const p = V(pos, i);
      const { d, s } = signed(body, p);
      if (s && d < OFFSET * 0.6) setV(pos, i, s.p.clone().addScaledVector(s.n, OFFSET * 0.6));
    }
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
    if (!pushed) break;
  }
  g = { ...g, pos, nor: vertexNormals(pos, g.index), inner };
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

/**
 * Inside a helmet's shell (its frame), on a voxel grid: the shell straight above and out to the side (the
 * horizontal axis nearest outwards from its middle), the distance to the nearer of the two (0: not under it).
 */
function shellField(g) {
  const b = bounds(g.pos, 0, 1).full;
  const N = 40, cell = Math.max(...b.max.map((v, i) => v - b.min[i])) / N;
  const tris = g.index.length / 3;
  const P = (t, k) => V(g.pos, g.index[t * 3 + k]);
  // Triangles bucketed by the two other axes, per ray axis.
  const buckets = [0, 1, 2].map((ax) => {
    const [u, w] = [0, 1, 2].filter((a) => a !== ax);
    const m = new Map();
    for (let t = 0; t < tris; t++) {
      const ps = [P(t, 0), P(t, 1), P(t, 2)].map((p) => p.toArray());
      const lo = [u, w].map((a) => Math.floor((Math.min(...ps.map((p) => p[a])) - b.min[a]) / cell));
      const hi = [u, w].map((a) => Math.floor((Math.max(...ps.map((p) => p[a])) - b.min[a]) / cell));
      for (let i = lo[0]; i <= hi[0]; i++)
        for (let j = lo[1]; j <= hi[1]; j++) {
          const k = i * 1000 + j;
          let l = m.get(k);
          if (!l) m.set(k, (l = []));
          l.push(t);
        }
    }
    return { u, w, m };
  });
  const ray = (o, ax, sign) => {
    const B = buckets[ax];
    const oa = o.toArray();
    const l = B.m.get(Math.floor((oa[B.u] - b.min[B.u]) / cell) * 1000 + Math.floor((oa[B.w] - b.min[B.w]) / cell));
    if (!l) return -1;
    const d = new Vector3().setComponent(ax, sign);
    let best = -1;
    for (const t of l) {
      const h = rayTri(o, d, P(t, 0), P(t, 1), P(t, 2));
      if (h > 0 && (best < 0 || h < best)) best = h;
    }
    return best;
  };
  const dims = b.max.map((v, i) => Math.ceil((v - b.min[i]) / cell) + 1);
  const field = new Float32Array(dims[0] * dims[1] * dims[2]);
  const o = new Vector3();
  for (let i = 0; i < dims[0]; i++)
    for (let j = 0; j < dims[1]; j++)
      for (let k = 0; k < dims[2]; k++) {
        o.set(b.min[0] + i * cell, b.min[1] + j * cell, b.min[2] + k * cell);
        const up = ray(o, 1, 1);
        if (up < 0) continue;
        const side = Math.abs(o.x) > Math.abs(o.z) ? ray(o, 0, Math.sign(o.x) || 1) : ray(o, 2, Math.sign(o.z) || 1);
        if (side < 0) continue;
        field[(i * dims[1] + j) * dims[2] + k] = Math.min(up, side);
      }
  const at = (p) => {
    const i = Math.round((p.x - b.min[0]) / cell), j = Math.round((p.y - b.min[1]) / cell), k = Math.round((p.z - b.min[2]) / cell);
    if (i < 0 || j < 0 || k < 0 || i >= dims[0] || j >= dims[1] || k >= dims[2]) return 0;
    return field[(i * dims[1] + j) * dims[2] + k];
  };
  return { at, top: b.max[1] };
}

/**
 * The helmet on this body's head: the smallest scale (its top over the head's, a little forward or back)
 * at which the head above the brow is inside the shell 4 mm clear; within a point of the best any scale
 * gives (hair that sticks out anyway is hidden). Hair and scalp under it are hidden.
 */
function fitHelmet(body, src) {
  const head = [];
  for (let v = 0; v < body.count; v++) if (body.share(v, HEADB) >= 0.5) head.push(v);
  const hx = head.map((v) => body.pos[v * 3]), hz = head.map((v) => body.pos[v * 3 + 2]);
  const top = Math.max(...head.map((v) => body.pos[v * 3 + 1]));
  const cx = (percentile(hx, 0.02) + percentile(hx, 0.98)) / 2, cz = (percentile(hz, 0.02) + percentile(hz, 0.98)) / 2;
  const face = head.filter((v) => body.pos[v * 3 + 2] > cz + 0.03 && body.share(v, HEADB) > 0.95).map((v) => body.pos[v * 3 + 1]);
  const chin = percentile(face, 0.01);
  const brow = top - 0.4 * (top - chin);
  // Above the brow in front, a little lower behind (the back of the head under the shell).
  const cap = head.filter((v) => {
    const y = body.pos[v * 3 + 1], z = body.pos[v * 3 + 2];
    return y > brow + 0.005 - Math.min(1, Math.max(0, (cz - z) / 0.1)) * 0.03;
  });
  // The eyes stay clear of the rim.
  const eyes = head.filter((v) => {
    const y = body.pos[v * 3 + 1];
    return y < brow - 0.012 && y > brow - 0.04 && body.pos[v * 3 + 2] > cz + 0.04;
  });
  const field = shellField(src);
  const b = bounds(src.pos);
  const width = b.max[0] - b.min[0];
  const headW = percentile(hx, 0.98) - percentile(hx, 0.02);
  const rel = new Vector3();
  const tries = [];
  for (let s = (headW * 0.9) / width; s < (headW * 2.2) / width; s *= 1.015) {
    let pick = null;
    for (let gap = 0.004; gap <= 0.05; gap += 0.004)
      for (const dz of [0, -0.01, 0.01, -0.02, 0.02, -0.03, 0.03]) {
        const at = new Vector3(cx, top + gap - field.top * s, cz + dz);
        let inside = 0;
        for (const v of cap) {
          rel.copy(V(body.pos, v)).sub(at).multiplyScalar(1 / s);
          if (field.at(rel) > 0.004 / s) inside++;
        }
        let blind = 0;
        for (const v of eyes) {
          rel.copy(V(body.pos, v)).sub(at).multiplyScalar(1 / s);
          if (field.at(rel) > 0) blind++;
        }
        if (blind > eyes.length * 0.1) continue;
        if (!pick || inside > pick.inside) pick = { s, at, inside };
      }
    if (pick) tries.push(pick);
  }
  const top1 = Math.max(...tries.map((t) => t.inside)) / cap.length;
  const best = tries.find((t) => t.inside / cap.length >= Math.min(0.99, top1 - 0.025));
  const place = new Matrix4().makeTranslation(best.at.x, best.at.y, best.at.z).multiply(new Matrix4().makeScale(best.s, best.s, best.s));
  // Hidden: the head under the shell (inside it, or poking out of it: hair) above the brow.
  const cover = head.filter((v) => {
    if (body.pos[v * 3 + 1] < brow - 0.01) return false;
    rel.copy(V(body.pos, v)).sub(best.at).multiplyScalar(1 / best.s);
    return field.at(rel) > 0 || cap.includes(v);
  });
  const placed = transform(src, place);
  const rim = b.full.min[1] + (b.full.max[1] - b.full.min[1]) * 0.45;
  const shellIdx = [];
  for (let t = 0; t < src.index.length; t += 3) if ([0, 1, 2].every((k) => src.pos[src.index[t + k] * 3 + 1] >= rim)) shellIdx.push(src.index[t], src.index[t + 1], src.index[t + 2]);
  // The rim at bind: the lowest of the dome as placed (behind, it comes lower than the brow).
  let rimAt = Infinity;
  for (const i of shellIdx) rimAt = Math.min(rimAt, placed.pos[i * 3 + 1]);
  const extra = pokeShell(body, { pos: placed.pos, index: Uint32Array.from(shellIdx) }, (v) => body.share(v, HEADB) >= 0.3 && body.pos[v * 3 + 1] > rimAt - 0.04, placed);
  return { place, cover: [...new Set([...cover, ...extra])], scale: best.s, fit: best.inside / cap.length, found: top1 > 0.9 };
}

/** A ribbon laid on the body along a path (bind space): `width` wide, `thick` thick, `lift` off the skin. */
function ribbon(body, path, { width = 0.045, thick = 0.006, lift = 0.005, uv, allowed, fallback }) {
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
  const P = [], N = [], U = [], I = [];
  onSkin.forEach((q, i) => {
    const tan = onSkin[Math.min(onSkin.length - 1, i + 1)].p.clone().sub(onSkin[Math.max(0, i - 1)].p).normalize();
    const side = new Vector3().crossVectors(tan, q.n).normalize().multiplyScalar(width / 2);
    const up = q.n.clone().multiplyScalar(thick);
    // Cross-section: bottom-left, bottom-right, top-right, top-left.
    // Its edges laid on the skin too (a strap bends over a shoulder, it does not stand off it).
    const edge = [-1, 1].map((a) => {
      const e = q.p.clone().addScaledVector(side, a);
      const f = surface(body, e, 0.03);
      return f ? { p: f.p.clone().addScaledVector(f.n, lift), n: f.n.clone().add(q.n).normalize() } : { p: e, n: q.n };
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
  const strap = ribbon(body, path, { width: 0.04, uv, allowed: BAG_BONES, fallback: 'Spine1' });
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
const meta = { gear: Object.fromEntries(IDS.filter((id) => pieces[id]).map((id, i) => [id, { kind: GEAR[id].kind, bit: i, tris: pieces[id].index.length / 3 }])), bodies: {} };
for (const id of bodies) {
  const body = await readBody(`${id}.glb`);
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
    } else if (kind === 'helmet') {
      const h = fitHelmet(body, src);
      rigid[gid] = { bone: 'Head', place: h.place.toArray().map((x) => +x.toFixed(5)) };
      for (const k of h.cover) cover[k] |= bit;
      line.push(`${gid} ×${h.scale.toFixed(3)}${h.found ? '' : ' NOT FITTED'} hide ${h.cover.length}`);
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
console.log(report.join('\n'));
