/**
 * npm run import:assets — the firearms and their modules from assets/incoming/weapons (Meshy GLBs, kept out
 * of git) into public/models/weapons:
 *
 *   <id>.glb            the model in the gun frame (src/weapons/gunFrame: the grip at the origin, the barrel
 *                       along −Z, real size), cut into parts that move on their own: body, mag (rifles),
 *                       slide (pistols), pump (shotgun), rocket (RPG); ≤ 4000 triangles (modules ≤ 800),
 *                       simplified with the borders locked (no holes along the cuts)
 *   <id>_1024.webp / _512.webp   its texture through the grim palette
 *   weapons.json        what is there: parts and triangles per id
 *
 * Missing files are skipped (the game draws a low-poly stand-in from the same hints: src/weapons/gunModel),
 * and with no input folder at all it changes nothing — the build never needs it.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { Matrix4, Vector3 } from 'three';
import sharp from 'sharp';
import { grim } from '../src/style/palette.ts';
import { HINTS, MOD_HINTS } from '../src/weapons/gunHints.ts';
/** As src/weapons/gunFrame: the model spans 0.96 along X. */
const scaleOf = (h) => h.length / 0.96;

const ROOT = process.cwd();
const IN = process.env.WEAPONS_IN ?? join(ROOT, 'assets', 'incoming', 'weapons');
const OUT = process.env.WEAPONS_OUT ?? join(ROOT, 'public', 'models', 'weapons');
const GUN_TRIS = 4000;
const MOD_TRIS = 800;

if (!existsSync(IN)) {
  console.log(`import:assets: нет ${IN} — модели не меняются (игра рисует заглушки)`);
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const report = [];
const manifestFile = join(OUT, 'weapons.json');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};

/** Every primitive of the file, in its world place, as one indexed mesh (+ its base colour image). */
async function read(file) {
  const doc = await io.read(file);
  const P = [], N = [], U = [], I = [];
  let base = 0, tex = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    const nm = new Matrix4().extractRotation(m);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION').getArray();
      const nor = prim.getAttribute('NORMAL')?.getArray();
      const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
      const n = pos.length / 3;
      for (let i = 0; i < n; i++) {
        const v = new Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
        P.push(v.x, v.y, v.z);
        const w = nor ? new Vector3(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix4(nm).normalize() : new Vector3(0, 1, 0);
        N.push(w.x, w.y, w.z);
        U.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
      }
      const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: n }, (_, k) => k);
      for (const k of idx) I.push(k + base);
      base += n;
      tex ??= prim.getMaterial()?.getBaseColorTexture()?.getImage();
    }
  }
  return weld({ pos: Float32Array.from(P), nor: Float32Array.from(N), uv: Float32Array.from(U), index: Uint32Array.from(I), tex });
}

/** One vertex per (position, uv): the simplifier then sees the surface as connected. */
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

/** The triangles `keep(t)` picks, compacted. */
function subset(g, keep) {
  const I = [];
  for (let t = 0; t < g.index.length; t += 3) if (keep(t)) I.push(g.index[t], g.index[t + 1], g.index[t + 2]);
  return compact({ ...g, index: Uint32Array.from(I) });
}
function compact(g) {
  const used = new Int32Array(g.pos.length / 3).fill(-1);
  let n = 0;
  for (const i of g.index) if (used[i] < 0) used[i] = n++;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  used.forEach((j, i) => {
    if (j < 0) return;
    pos.set(g.pos.subarray(i * 3, i * 3 + 3), j * 3);
    nor.set(g.nor.subarray(i * 3, i * 3 + 3), j * 3);
    uv.set(g.uv.subarray(i * 2, i * 2 + 2), j * 2);
  });
  return { ...g, pos, nor, uv, index: g.index.map((i) => used[i]) };
}
/** Down to `target` triangles, the UVs weighed, the borders (the cuts between parts) locked: no holes. */
function simplify(g, target) {
  if (g.index.length / 3 <= target) return g;
  const [index] = MeshoptSimplifier.simplifyWithAttributes(g.index, g.pos, 3, g.uv, 2, [1.5, 1.5], null, Math.min(g.index.length, target * 3), 1, ['LockBorder']);
  return compact({ ...g, index });
}
/** A matrix on positions and normals. */
function transform(g, m) {
  const nm = new Matrix4().extractRotation(m);
  const pos = new Float32Array(g.pos.length), nor = new Float32Array(g.nor.length);
  const v = new Vector3();
  for (let i = 0; i < g.pos.length / 3; i++) {
    v.fromArray(g.pos, i * 3).applyMatrix4(m).toArray(pos, i * 3);
    v.fromArray(g.nor, i * 3).applyMatrix4(nm).normalize().toArray(nor, i * 3);
  }
  return { ...g, pos, nor };
}
function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) (lo[i % 3] = Math.min(lo[i % 3], pos[i])), (hi[i % 3] = Math.max(hi[i % 3], pos[i]));
  return { lo, hi };
}

const gcache = new Map();
function grimPixel(r, g, b) {
  const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let c = gcache.get(k);
  if (c === undefined) gcache.set(k, (c = grim((r << 16) | (g << 8) | b)));
  return c;
}
/** The texture through grim, 1024 and 512, WebP. */
async function texture(id, img) {
  if (!img) return;
  const { data, info } = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
async function write(id, parts) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(id);
  for (const [name, g] of Object.entries(parts)) {
    const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute('POSITION', acc('VEC3', g.pos)).setAttribute('NORMAL', acc('VEC3', g.nor)).setAttribute('TEXCOORD_0', acc('VEC2', g.uv));
    prim.setIndices(acc('SCALAR', g.pos.length / 3 > 65535 ? Uint32Array.from(g.index) : Uint16Array.from(g.index)));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  await doc.transform(reorder({ encoder: MeshoptEncoder }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const f = join(OUT, `${id}.glb`);
  await io.write(f, doc);
  report.push(`${id}.glb ${(statSync(f).size / 1024).toFixed(0)} KB`);
}

const tris = (g) => g.index.length / 3;
const centroid = (g, t) => [0, 1, 2].map((a) => (g.pos[g.index[t] * 3 + a] + g.pos[g.index[t + 1] * 3 + a] + g.pos[g.index[t + 2] * 3 + a]) / 3);
const inBox = (c, b) => c[0] >= b.x[0] && c[0] <= b.x[1] && c[1] >= b.y[0] && c[1] <= b.y[1];

// ── Guns ──────────────────────────────────────────────────────────────────────────────────────────
for (const [id, h] of Object.entries(HINTS)) {
  const file = join(IN, `${id}.glb`);
  if (!existsSync(file)) {
    console.log(`нет weapons/${id}.glb — заглушка в игре`);
    continue;
  }
  const src = await read(file);
  // Cut in model units (the hints are in them): the magazine and the moving parts, the rest is the body.
  const boxes = { ...(h.mag ? { mag: h.mag } : {}), ...(h.parts ?? {}) };
  const owner = new Int8Array(src.index.length / 3).fill(-1);
  const names = Object.keys(boxes);
  for (let t = 0; t < src.index.length; t += 3) {
    const c = centroid(src, t);
    owner[t / 3] = names.findIndex((n) => inBox(c, boxes[n]));
  }
  // Model → gun frame: the grip point to the origin, the model's −X (muzzle) to −Z, real size.
  const s = scaleOf(h);
  const gp = [h.grip[0][0] + (h.grip[1][0] - h.grip[0][0]) * h.main, h.grip[0][1] + (h.grip[1][1] - h.grip[0][1]) * h.main];
  const m = new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeRotationY(-Math.PI / 2)).multiply(new Matrix4().makeTranslation(-gp[0], -gp[1], 0));
  const total = tris(src);
  const parts = {};
  for (const [k, name] of [[-1, 'body'], ...names.map((n, i) => [i, n])]) {
    const g = subset(src, (t) => owner[t / 3] === k);
    if (!tris(g)) continue;
    // Each part keeps its share of the budget.
    parts[name] = transform(simplify(g, Math.floor((GUN_TRIS * tris(g)) / Math.max(total, GUN_TRIS))), m);
  }
  await write(id, parts);
  await texture(id, src.tex);
  manifest[id] = { parts: Object.keys(parts), tris: Object.values(parts).reduce((a, g) => a + tris(g), 0) };
}

// ── Modules: the suppressor's back end at the origin along −Z; magazines' tops at the origin, hanging −Y ──
for (const [id, h] of Object.entries(MOD_HINTS)) {
  const file = join(IN, `${id}.glb`);
  if (!existsSync(file)) {
    console.log(`нет weapons/${id}.glb — заглушка в игре`);
    continue;
  }
  let g = simplify(await read(file), MOD_TRIS);
  const b = bounds(g.pos);
  const ext = b.hi.map((v, i) => v - b.lo[i]);
  const s = h.length / Math.max(...ext);
  const c = b.lo.map((v, i) => (v + b.hi[i]) / 2);
  let m;
  if (id === 'mod_suppressor') {
    // Along X in the file (the threaded end at +X): the threads to the origin, the rest forward (−Z).
    m = new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeRotationY(-Math.PI / 2)).multiply(new Matrix4().makeTranslation(-b.hi[0], -c[1], -c[2]));
  } else if (id.startsWith('mod_ext_mag')) {
    // Upright in the file, its curve to −X (forward, as on the gun): the top to the origin.
    m = new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeRotationY(-Math.PI / 2)).multiply(new Matrix4().makeTranslation(-c[0], -b.hi[1], -c[2]));
  } else m = new Matrix4().makeScale(s, s, s).multiply(new Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
  g = transform(g, m);
  await write(id, { body: g });
  await texture(id, g.tex);
  manifest[id] = { parts: ['body'], tris: tris(g) };
}

writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
for (const l of report) console.log(l);
for (const [id, e] of Object.entries(manifest)) console.log(`${id}: ${e.tris} треугольников, части: ${e.parts.join(', ')}`);
