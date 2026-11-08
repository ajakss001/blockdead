#!/usr/bin/env node
/**
 * Character models: assets/incoming/characters (Mixamo FBX + Meshy texture) and assets/incoming/anim
 * (Mixamo clips without skin) → public/models/characters:
 *   <body>.glb       the player's model, ~10k triangles, every skinned bone; the costumes (outfit_<class>_male.fbx,
 *                    texture embedded) → <class>_m
 *   <body>_lod1.glb  zombies and far figures: ~3k triangles, borders locked, fingers folded into the hands
 *   <body>_2048.webp, _1024, _512  the texture through the grim palette, alpha = skin mask (WebP q90)
 *   anims.glb        every clip on one skeleton: rotations of the needed bones, the hips' height in leg lengths
 * Bone names: mixamorig:<Name>. Usage: npm run characters
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { reorder, resample } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { resolveObjectURL } from 'node:buffer';
import { loadFbx } from './fbx-node.mjs';
import { headSwap } from './head-swap.mjs';
import { handFingers } from './hand-fingers.mjs';
import { grim } from '../src/style/palette.ts';

const ROOT = process.cwd();
const IN = join(ROOT, 'assets', 'incoming');
const OUT = join(ROOT, 'public', 'models', 'characters');
mkdirSync(OUT, { recursive: true });
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

// Costumes wear the base body's head (tools/head-swap.mjs): outfit_<class>_male → char_male's, _female → char_female's.
const COSTUMES = readdirSync(join(IN, 'characters'))
  .map((f) => /^outfit_(\w+)_(male|female)\.fbx$/.exec(f))
  .filter(Boolean)
  .map(([f, c, sex]) => ({ id: `${c}_${sex[0]}`, fbx: f, png: null, height: sex === 'male' ? 1.8 : 1.7, lod0: 10000, donor: sex }));
const BODIES = [
  { id: 'male', fbx: 'char_male.fbx', png: 'char_male_obj.png', height: 1.8, lod0: 0 },
  { id: 'female', fbx: 'char_female.fbx', png: 'char_female.png', height: 1.7, lod0: 0 },
  ...COSTUMES,
];
/** The base bodies as they come (unwelded geometry, skeleton, texture): the costumes' heads. */
const donors = {};
const LOD1_TRIS = 3000;
const CLIPS = ['idle', 'walking', 'walking_female', 'running', 'crouched_walking', 'jump', 'zombie_idle', 'zombie_walk', 'zombie_running', 'zombie_attack', 'zombie_attack_2', 'zombie_scream'];
/** The bones a zombie / far figure keeps (fingers go to the hand, toes to the foot's toe base). */
const MAIN = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', ...['Left', 'Right'].flatMap((s) => [`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`, `${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}ToeBase`])];

const bare = (n) => n.replace(/^mixamorig:?/, '');
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const report = [];

// ── Texture: grim palette per pixel, skin mask in alpha ───────────────────────────────────────────────
const gcache = new Map();
function grimPixel(r, g, b) {
  const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let v = gcache.get(k);
  if (v === undefined) gcache.set(k, (v = grim(((r & 0xfc) << 16) | ((g & 0xfc) << 8) | (b & 0xfc))));
  return v;
}
/** Skin by colour (warm, moderately saturated, mid-light): the zombie shader turns it dead. */
function skinness(r, g, b) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min || r < g || g < b) return 0;
  const s = (max - min) / (l > 0.5 ? 2 - max - min : max + min);
  const h = ((g - b) / 255 / (max - min)) / 6;
  const hue = 1 - Math.min(1, Math.max(0, (Math.abs(h - 0.06) - 0.035) / 0.03));
  const sat = s > 0.12 && s < 0.75 ? 1 : 0;
  const lit = l > 0.22 && l < 0.88 ? 1 : 0;
  return hue * sat * lit;
}
async function texture(id, rgba, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const c = grimPixel(r, g, b);
    out[i * 4] = (c >> 16) & 255;
    out[i * 4 + 1] = (c >> 8) & 255;
    out[i * 4 + 2] = c & 255;
    // Never fully transparent: lossy WebP drops the colour under alpha 0 (the shader reads skin = (1 − a) · 2).
    out[i * 4 + 3] = 255 - Math.round(skinness(r, g, b) * 127);
  }
  // 2048: the player, the menu and the inventory (seen up close); 1024: zombies and LOD; 512: low. WebP q90.
  for (const size of [2048, 1024, 512]) {
    const f = join(OUT, `${id}_${size}.webp`);
    await sharp(out, { raw: { width: w, height: h, channels: 4 } }).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 90, alphaQuality: 90 }).toFile(f);
    report.push(`${id}_${size}.webp ${(statSync(f).size / 1024).toFixed(0)} KB`);
  }
}
const decodePng = (buf) => {
  const p = PNG.sync.read(buf);
  return { data: p.data, w: p.width, h: p.height };
};
async function blobOf(tex) {
  const b = resolveObjectURL(tex.userData.url);
  return Buffer.from(await b.arrayBuffer());
}

// ── Geometry ───────────────────────────────────────────────────────────────────────────────────────
/** Triangles down to `target` (indexed geometry): open borders locked, so no holes; weights untouched. */
function simplify(index, pos, target, uv) {
  // The UVs weigh in: a collapse across a texture seam or one that drags the texture is costly (no smeared shards).
  const [out, err] = uv
    ? MeshoptSimplifier.simplifyWithAttributes(index, pos, 3, new Float32Array(uv), 2, [1.5, 1.5], null, target * 3, 1, ['LockBorder', 'Permissive'])
    : MeshoptSimplifier.simplify(index, pos, 3, target * 3, 1, ['LockBorder', 'Permissive']);
  return { index: out, err };
}

function weld(geo) {
  const g = mergeVertices(geo, 1e-5);
  return g;
}

/** Fingers and toe ends folded into the bones kept (`keep`: name → new index). */
function remapJoints(skinIndex, skinWeight, bones, keep) {
  const map = bones.map((b) => {
    for (let o = b; o; o = o.parent) if (o.isBone && keep.has(bare(o.name))) return keep.get(bare(o.name));
    return 0;
  });
  const n = skinIndex.count;
  const ji = new Uint8Array(n * 4);
  const jw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const acc = new Map();
    for (let k = 0; k < 4; k++) {
      const w = skinWeight.getComponent(v, k);
      if (w <= 0) continue;
      const j = map[skinIndex.getComponent(v, k)];
      acc.set(j, (acc.get(j) ?? 0) + w);
    }
    const list = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = list.reduce((s, x) => s + x[1], 0) || 1;
    list.forEach(([j, w], k) => ((ji[v * 4 + k] = j), (jw[v * 4 + k] = w / sum)));
  }
  return { ji, jw };
}

function writeSkinned(file, { name, pos, nor, uv, ji: ji0, jw, index, bones, scale, keepNames }) {
  let ji = ji0;
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(name);
  const root = doc.createNode(name);
  scene.addChild(root);
  // The skeleton: bones kept, each under its nearest kept ancestor (rest locals rebuilt from world matrices).
  const src = keepNames ? bones.filter((b) => keepNames.includes(bare(b.name))) : bones;
  // Parents before children (the game walks the skeleton in order); the joints renumbered to match.
  const list = [];
  const visit = (b) => {
    if (list.includes(b)) return;
    for (let o = b.parent; o; o = o.parent) if (src.includes(o)) {
      visit(o);
      break;
    }
    list.push(b);
  };
  src.forEach(visit);
  const renum = src.map((b) => list.indexOf(b));
  ji = ji.map((j) => renum[j]);
  const world = list.map((b) => b.matrixWorld.clone());
  const nodes = list.map((b) => doc.createNode(`mixamorig:${bare(b.name)}`));
  const parentIx = list.map((b) => {
    for (let o = b.parent; o; o = o.parent) {
      const i = list.indexOf(o);
      if (i >= 0) return i;
    }
    return -1;
  });
  const t = new Vector3(), q = new Quaternion(), s = new Vector3(), m = new Matrix4();
  list.forEach((b, i) => {
    const p = parentIx[i];
    m.copy(world[i]);
    if (p >= 0) m.premultiply(world[p].clone().invert());
    m.decompose(t, q, s);
    nodes[i].setTranslation(t.multiplyScalar(scale).toArray()).setRotation(q.normalize().toArray());
    (p >= 0 ? nodes[p] : root).addChild(nodes[i]);
  });
  const ibm = new Float32Array(list.length * 16);
  world.forEach((w, i) => {
    const inv = w.clone().invert();
    inv.elements[12] *= scale;
    inv.elements[13] *= scale;
    inv.elements[14] *= scale;
    ibm.set(inv.elements, i * 16);
  });
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const skin = doc.createSkin(name).setInverseBindMatrices(acc('MAT4', ibm));
  nodes.forEach((n) => skin.addJoint(n));
  skin.setSkeleton(nodes[0]);
  const P = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i++) P[i] = pos[i] * scale;
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', P))
    .setAttribute('NORMAL', acc('VEC3', nor))
    .setAttribute('TEXCOORD_0', acc('VEC2', uv))
    .setAttribute('JOINTS_0', acc('VEC4', ji))
    .setAttribute('WEIGHTS_0', acc('VEC4', jw))
    .setIndices(acc('SCALAR', index.length / 3 > 0 && P.length / 3 > 65535 ? new Uint32Array(index) : new Uint16Array(index)));
  const mesh = doc.createMesh(name).addPrimitive(prim);
  root.addChild(doc.createNode(`${name}-mesh`).setMesh(mesh).setSkin(skin));
  return doc;
}

async function save(doc, file) {
  // Meshopt compression without quantization: the positions stay in the model frame, the inverse bind
  // matrices the bones' own (the game reads the rest pose off them).
  await doc.transform(reorder({ encoder: MeshoptEncoder }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(join(OUT, file), doc);
  const kb = statSync(join(OUT, file)).size / 1024;
  report.push(`${file} ${kb.toFixed(0)} KB`);
  if (kb > 3 * 1024) throw new Error(`${file} больше 3 МБ`);
}

/** Hips-to-ankle height of a skeleton at rest (world), for the clips' hips height in leg lengths. */
function legOf(root) {
  let hips = null, foot = null;
  root.traverse((o) => {
    if (bare(o.name) === 'Hips') hips = o;
    if (bare(o.name) === 'LeftFoot') foot = o;
  });
  root.updateMatrixWorld(true);
  return new Vector3().setFromMatrixPosition(hips.matrixWorld).y - new Vector3().setFromMatrixPosition(foot.matrixWorld).y;
}

let animSkeleton = null;
const meta = { bodies: {}, clips: {} };

for (const body of BODIES) {
  const src = join(IN, 'characters', body.fbx);
  if (!existsSync(src)) {
    console.log(`нет ${body.fbx} — пропуск`);
    continue;
  }
  const fbx = loadFbx(src);
  fbx.updateMatrixWorld(true);
  let mesh = null;
  fbx.traverse((o) => o.isSkinnedMesh && (mesh = o));
  const bones = mesh.skeleton.bones;
  let geo = mesh.geometry.clone();
  geo.deleteAttribute('color');
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) geo.deleteAttribute(k);
  // The texture: a PNG beside the model, or the one embedded in it (one material), or several → a 2×2 atlas.
  let rgba;
  const mats = [].concat(mesh.material);
  if (body.png) {
    rgba = decodePng(readFileSync(join(IN, 'characters', body.png)));
  } else if (mats.length === 1) {
    const img = sharp(await blobOf(mats[0].map)).ensureAlpha();
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    rgba = { data, w: info.width, h: info.height };
    geo.clearGroups();
  } else {
    const SIZE = 2048;
    const atlas = Buffer.alloc(SIZE * SIZE * 4, 255);
    const half = SIZE / 2;
    for (let mi = 0; mi < mats.length; mi++) {
      const img = await sharp(await blobOf(mats[mi].map)).resize(half, half).ensureAlpha().raw().toBuffer();
      const ox = (mi % 2) * half, oy = Math.floor(mi / 2) * half;
      for (let y = 0; y < half; y++) img.copy(atlas, ((oy + y) * SIZE + ox) * 4, y * half * 4, (y + 1) * half * 4);
    }
    rgba = { data: atlas, w: SIZE, h: SIZE };
    const uv = geo.attributes.uv;
    for (const gr of geo.groups) {
      const ox = (gr.materialIndex % 2) * 0.5, oy = Math.floor(gr.materialIndex / 2) * 0.5;
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        const u = uv.getX(i) - Math.floor(uv.getX(i));
        const v = uv.getY(i) - Math.floor(uv.getY(i));
        // three's v is up: the atlas rows go down.
        uv.setXY(i, ox + u * 0.5, 1 - (oy + (1 - v) * 0.5));
      }
    }
    geo.clearGroups();
  }
  if (!body.donor) donors[body.id] = { geo: geo.clone(), bones, img: rgba };
  else if (donors[body.donor]) {
    const sw = headSwap({ geo, bones, img: rgba }, donors[body.donor]);
    geo = sw.geo;
    rgba = sw.img;
    meta.swaps ??= {};
    meta.swaps[body.id] = sw.info;
    report.push(`${body.id}: голова ${body.donor} — ${JSON.stringify(sw.info)}`);
    // Fingers: the donor's finger bones and weights on the costume's own hands (tools/hand-fingers.mjs).
    const hf = handFingers({ geo, bones }, donors[body.donor]);
    geo = hf.geo;
    meta.fingers ??= {};
    meta.fingers[body.id] = hf.info;
    report.push(`${body.id}: пальцы — добавлено ${hf.info.added.length} костей, вершин ${hf.info.moved}, совмещение ${JSON.stringify(hf.info.err)}`);
  } else console.log(`${body.id}: нет ${body.donor} — голова своя`);
  await texture(body.id, rgba.data, rgba.w, rgba.h);
  geo = weld(geo);
  geo.computeBoundingBox();
  const scale = body.height / (geo.boundingBox.max.y - geo.boundingBox.min.y);
  const pos = geo.attributes.position.array;
  const nor = geo.attributes.normal.array;
  const uv = geo.attributes.uv.array;
  let index = geo.index.array;
  if (body.lod0) index = simplify(new Uint32Array(index), new Float32Array(pos), body.lod0, uv).index;
  const full = remapJoints(geo.attributes.skinIndex, geo.attributes.skinWeight, bones, new Map(bones.map((b, i) => [bare(b.name), i])));
  await save(writeSkinned(body.id, { name: body.id, pos, nor, uv, ji: full.ji, jw: full.jw, index, bones, scale }), `${body.id}.glb`);
  // LOD1: main bones only, 3k triangles.
  const main = MAIN.filter((n) => bones.some((b) => bare(b.name) === n));
  const lod1 = remapJoints(geo.attributes.skinIndex, geo.attributes.skinWeight, bones, new Map(main.map((n, i) => [n, i])));
  const { index: i1, err } = simplify(new Uint32Array(index), new Float32Array(pos), LOD1_TRIS, uv);
  const ordered = main.map((n) => bones.find((b) => bare(b.name) === n));
  await save(writeSkinned(`${body.id}_lod1`, { name: body.id, pos, nor, uv, ji: lod1.ji, jw: lod1.jw, index: i1, bones: ordered, scale, keepNames: main }), `${body.id}_lod1.glb`);
  const legBones = legOf(fbx) * scale;
  meta.bodies[body.id] = { leg: +legBones.toFixed(4), height: body.height, tris: index.length / 3, lod1: i1.length / 3, lod1Error: +err.toFixed(4) };
  report.push(`${body.id}: LOD0 ${index.length / 3} tris, LOD1 ${i1.length / 3} tris (err ${err.toFixed(3)}), bones ${bones.length}/${main.length}, leg ${legBones.toFixed(3)} m`);
  if (body.id === 'male') animSkeleton = { bones, scale };
}

// ── Clips ────────────────────────────────────────────────────────────────────────────────────────────
{
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('anims');
  const { bones } = animSkeleton;
  const nodes = new Map();
  for (const b of bones) {
    const n = doc.createNode(`mixamorig:${bare(b.name)}`).setTranslation(b.position.toArray()).setRotation(b.quaternion.toArray());
    nodes.set(bare(b.name), n);
  }
  for (const b of bones) {
    const p = b.parent && b.parent.isBone ? nodes.get(bare(b.parent.name)) : null;
    (p ?? scene).addChild(nodes.get(bare(b.name)));
  }
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  for (const name of CLIPS) {
    const f = join(IN, 'anim', `${name}.fbx`);
    if (!existsSync(f)) {
      console.log(`нет anim/${name}.fbx`);
      continue;
    }
    const src = loadFbx(f);
    const leg = legOf(src);
    const clip = src.animations[0];
    const anim = doc.createAnimation(name);
    for (const track of clip.tracks) {
      const [bone, prop] = track.name.split('.');
      const node = nodes.get(bare(bone));
      if (!node) continue;
      if (prop === 'position' && bare(bone) !== 'Hips') continue;
      if (prop !== 'position' && prop !== 'quaternion') continue;
      const values = new Float32Array(track.values);
      // The hips' place in leg lengths (any body scales it by its own legs).
      if (prop === 'position') for (let i = 0; i < values.length; i++) values[i] /= leg;
      const sampler = doc.createAnimationSampler().setInput(acc('SCALAR', new Float32Array(track.times))).setOutput(acc(prop === 'position' ? 'VEC3' : 'VEC4', values)).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(prop === 'position' ? 'translation' : 'rotation').setSampler(sampler));
    }
    meta.clips[name] = +clip.duration.toFixed(3);
  }
  await doc.transform(resample({ tolerance: 2e-4 }));
  // Tracks left constant: one key.
  await save(doc, 'anims.glb');
}

writeFileSync(join(OUT, 'characters.json'), JSON.stringify(meta, null, 1));
console.log(report.join('\n'));
