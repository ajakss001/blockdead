#!/usr/bin/env node
/**
 * Manual / build-time generator for missing movable firearm sub-parts via Meshy API v2:
 *  - mag_pistol_g17      (9mm double-stack pistol magazine, top at origin along -Y)
 *  - mag_pistol_m1911    (.45 ACP single-stack pistol magazine, top at origin along -Y)
 *  - mod_ext_mag_g17     (33-round extended 9mm stick magazine, top at origin along -Y)
 *  - bolt_ak             (AK bolt carrier & curved right charging handle, centered along Z)
 *  - bolt_m4a1           (M4/AR charging handle & bolt assembly, centered along Z)
 *  - bolt_hunting        (bolt-action rifle bolt body with bent handle & knob, centered along Z)
 *  - shell_12g           (12-gauge shotgun shell with brass base, centered along Z)
 *
 * Security & quota safety:
 *  - Reads MESHY_API_KEY (or MESH_API_KEY) strictly from local `.env` (never logged or bundled).
 *  - Skips any asset whose `<id>.glb`, `<id>_1024.webp`, `<id>_512.webp`, and `weapons.json` entry already exist.
 *  - Simplifies meshes (`<= 800` tris) and exports `EXTMeshoptCompression` + `grim`-palette WebP textures matching
 *    `tools/import-assets.mjs` and `src/weapons/gunModel.ts`.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Matrix4, Vector3 } from 'three';
import { grim } from '../src/style/palette.ts';

const ROOT_DIR = resolve('.');
const ENV_PATH = join(ROOT_DIR, '.env');
const OUT_DIR = join(ROOT_DIR, 'public/models/weapons');
const MANIFEST_PATH = join(OUT_DIR, 'weapons.json');
const MESHY_ENDPOINT = 'https://api.meshy.ai/openapi/v2/text-to-3d';

const SPECS = [
  {
    id: 'mag_pistol_g17',
    kind: 'mag',
    size: [0.017, 0.076, 0.024], // [maxX thickness, exactY height along -Y, maxZ depth]
    tris: 700,
    prompt:
      'Vertical straight black polymer 9mm pistol magazine for Glock 17 with steel feed lips and one brass 9mm cartridge loaded on top, black polymer baseplate at bottom, standalone game weapon part, realistic PBR',
  },
  {
    id: 'mag_pistol_m1911',
    kind: 'mag',
    size: [0.014, 0.094, 0.023],
    tris: 700,
    prompt:
      'Vertical blued steel single-stack .45 ACP pistol magazine for M1911 with witness holes on side, steel floorplate at bottom, and one brass .45 cartridge visible at top feed lips, standalone weapon part, realistic PBR',
  },
  {
    id: 'mod_ext_mag_g17',
    kind: 'mag',
    size: [0.017, 0.16, 0.025],
    tris: 750,
    prompt:
      'Long vertical black polymer 33-round extended 9mm stick magazine for Glock pistol with thick extended floorplate at bottom and brass cartridge at top feed lips, standalone game weapon attachment, realistic PBR',
  },
  {
    id: 'bolt_ak',
    kind: 'bolt',
    size: [0.028, 0.022, 0.088], // centered at origin, length along Z, handle protruding +X
    tris: 700,
    prompt:
      'Isolated dark blued steel AK-47 rifle bolt carrier group with curved charging handle knob sticking out to one side, mechanical firearm internal part, realistic gritty PBR metal',
  },
  {
    id: 'bolt_m4a1',
    kind: 'bolt',
    size: [0.044, 0.02, 0.085],
    tris: 700,
    prompt:
      'Isolated matte black steel AR-15 M4A1 T-shaped charging handle and cylindrical bolt carrier assembly, mechanical firearm part, realistic gritty PBR metal',
  },
  {
    id: 'shell_12g',
    kind: 'shell',
    size: [0.021, 0.021, 0.068], // cylindrical along Z
    tris: 380,
    prompt:
      'Single realistic 12-gauge shotgun shell cartridge with crimped ribbed dark red plastic hull and ribbed brass base rim with primer, isolated game ammunition prop, PBR',
  },
];

function loadMeshyKey() {
  if (!existsSync(ENV_PATH)) return '';
  const raw = readFileSync(ENV_PATH, 'utf8');
  const vars = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    vars.set(k, v);
  }
  return (vars.get('MESHY_API_KEY') || vars.get('MESH_API_KEY') || '').trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function meshyPost(apiKey, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(MESHY_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 4) {
      const waitMs = 3000 * (attempt + 1);
      await sleep(waitMs);
      continue;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Meshy POST ${res.status} ${res.statusText}: ${errText}`);
    }
    const data = await res.json();
    if (!data?.result) throw new Error('Meshy POST missing task result id');
    return data.result;
  }
  throw new Error('Meshy POST failed after rate-limit retries');
}

async function meshyPoll(apiKey, taskId, label) {
  const start = Date.now();
  while (Date.now() - start < 15 * 60 * 1000) {
    const res = await fetch(`${MESHY_ENDPOINT}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 429) {
      await sleep(5000);
      continue;
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Meshy GET ${res.status} ${res.statusText}: ${errText}`);
    }
    const data = await res.json();
    if (data.status === 'SUCCEEDED') return data;
    if (data.status === 'FAILED' || data.status === 'EXPIRED') {
      throw new Error(`Meshy task ${label} (${taskId}) ${data.status}: ${data.task_error?.message ?? 'unknown error'}`);
    }
    process.stdout.write(`  [${label}] ${data.status ?? 'PENDING'} (${data.progress ?? 0}%)...\r`);
    await sleep(4000);
  }
  throw new Error(`Meshy task ${label} timed out after 15 minutes`);
}

function createIo() {
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });
}

async function readCombined(io, rawBytes) {
  const doc = await io.readBinary(new Uint8Array(rawBytes));
  const P = [];
  const N = [];
  const U = [];
  const I = [];
  let base = 0;
  let tex = null;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    const nm = new Matrix4().extractRotation(m);
    for (const prim of mesh.listPrimitives()) {
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;
      const pos = posAcc.getArray();
      const nor = prim.getAttribute('NORMAL')?.getArray();
      const uv = prim.getAttribute('TEXCOORD_0')?.getArray();
      const n = pos.length / 3;
      const v = new Vector3();
      for (let i = 0; i < n; i++) {
        v.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(m);
        P.push(v.x, v.y, v.z);
        if (nor) v.set(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]).applyMatrix4(nm).normalize();
        else v.set(0, 1, 0);
        N.push(v.x, v.y, v.z);
        U.push(uv ? uv[i * 2] : 0, uv ? uv[i * 2 + 1] : 0);
      }
      const idx = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: n }, (_, k) => k);
      for (const k of idx) I.push(k + base);
      base += n;
      tex ??= prim.getMaterial()?.getBaseColorTexture()?.getImage() ?? null;
    }
  }
  return weld({
    pos: Float32Array.from(P),
    nor: Float32Array.from(N),
    uv: Float32Array.from(U),
    index: Uint32Array.from(I),
    tex,
  });
}

function weld(g) {
  const map = new Map();
  const remap = new Uint32Array(g.pos.length / 3);
  const P = [];
  const N = [];
  const U = [];
  for (let i = 0; i < remap.length; i++) {
    const k =
      [0, 1, 2].map((a) => Math.round(g.pos[i * 3 + a] * 1e5)).join(',') +
      '|' +
      Math.round(g.uv[i * 2] * 1e5) +
      ',' +
      Math.round(g.uv[i * 2 + 1] * 1e5);
    let j = map.get(k);
    if (j === undefined) {
      j = P.length / 3;
      map.set(k, j);
      P.push(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]);
      N.push(g.nor[i * 3], g.nor[i * 3 + 1], g.nor[i * 3 + 2]);
      U.push(g.uv[i * 2], g.uv[i * 2 + 1]);
    }
    remap[i] = j;
  }
  return {
    ...g,
    pos: Float32Array.from(P),
    nor: Float32Array.from(N),
    uv: Float32Array.from(U),
    index: g.index.map((i) => remap[i]),
  };
}

function compact(g) {
  const used = new Int32Array(g.pos.length / 3).fill(-1);
  let n = 0;
  for (const i of g.index) if (used[i] < 0) used[i] = n++;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  used.forEach((j, i) => {
    if (j < 0) return;
    pos.set(g.pos.subarray(i * 3, i * 3 + 3), j * 3);
    nor.set(g.nor.subarray(i * 3, i * 3 + 3), j * 3);
    uv.set(g.uv.subarray(i * 2, i * 2 + 2), j * 2);
  });
  return { ...g, pos, nor, uv, index: g.index.map((i) => used[i]) };
}

function simplify(g, target) {
  if (g.index.length / 3 <= target) return g;
  const want = Math.max(36, Math.floor(target) * 3);
  let [index] = MeshoptSimplifier.simplifyWithAttributes(g.index, g.pos, 3, g.uv, 2, [1.5, 1.5], null, want, 1, ['LockBorder']);
  if (index.length / 3 > target * 1.15) {
    const [relaxed] = MeshoptSimplifier.simplify(g.index, g.pos, 3, want, 0.04, ['Permissive']);
    if (relaxed.length >= 36 && relaxed.length < index.length) index = relaxed;
  }
  return compact({ ...g, index });
}

function bounds(pos) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i++) {
    const a = i % 3;
    lo[a] = Math.min(lo[a], pos[i]);
    hi[a] = Math.max(hi[a], pos[i]);
  }
  return { lo, hi, ext: hi.map((v, i) => Math.max(1e-5, v - lo[i])) };
}

function transform(g, m) {
  const nm = new Matrix4().extractRotation(m);
  const pos = new Float32Array(g.pos.length);
  const nor = new Float32Array(g.nor.length);
  const v = new Vector3();
  for (let i = 0; i < g.pos.length / 3; i++) {
    v.fromArray(g.pos, i * 3).applyMatrix4(m).toArray(pos, i * 3);
    v.fromArray(g.nor, i * 3).applyMatrix4(nm).normalize().toArray(nor, i * 3);
  }
  return { ...g, pos, nor };
}

/**
 * Normalize axis orientation & metric scale deterministically regardless of Meshy's raw pose:
 *  - `mag`   : longest axis -> Y (top at y=0, hanging -Y), thinnest -> X, middle -> Z; scaled cleanly into `spec.size`.
 *  - `bolt`  : longest axis -> Z (barrel axis), middle -> X (handle sticking out +X), thinnest -> Y.
 *  - `shell` : longest axis -> Z (cartridge length), cross-section X/Y symmetric.
 */
function alignAndScale(g, spec) {
  const b0 = bounds(g.pos);
  const order = [0, 1, 2].sort((a, b) => b0.ext[b] - b0.ext[a]); // [longest, middle, thinnest]
  // Basis mapping: assign source axes to target [X, Y, Z].
  let srcForX;
  let srcForY;
  let srcForZ;
  if (spec.kind === 'mag') {
    srcForY = order[0]; // tallest = vertical mag length
    srcForZ = order[1]; // front-to-back mag depth
    srcForX = order[2]; // thinnest = left-right thickness
  } else if (spec.kind === 'bolt') {
    srcForZ = order[0]; // longest = along barrel Z
    srcForX = order[1]; // middle = handle protrusion X
    srcForY = order[2]; // height
  } else {
    srcForZ = order[0];
    srcForX = order[1];
    srcForY = order[2];
  }

  const perm = new Matrix4();
  const cols = [new Vector3(), new Vector3(), new Vector3()];
  const mapCol = (srcAxis, targetVec) => {
    cols[srcAxis].copy(targetVec);
  };
  const xVec = new Vector3(1, 0, 0);
  const yVec = new Vector3(0, 1, 0);
  const zVec = new Vector3(0, 0, 1);
  mapCol(srcForX, xVec);
  mapCol(srcForY, yVec);
  mapCol(srcForZ, zVec);
  // Ensure right-handed basis (det > 0) to preserve triangle winding.
  const det = new Vector3().crossVectors(cols[0], cols[1]).dot(cols[2]);
  if (det < 0) cols[srcForX].negate();
  perm.makeBasis(cols[0], cols[1], cols[2]);
  let out = transform(g, perm);

  // For bolts, ensure any protruding handle extends toward +X rather than -X (centroid skewed vs midpoint or |hi.x| > |lo.x|).
  if (spec.kind === 'bolt') {
    const bb = bounds(out.pos);
    let meanX = 0;
    const n = out.pos.length / 3;
    for (let i = 0; i < n; i++) meanX += out.pos[i * 3];
    meanX /= Math.max(1, n);
    const midX = (bb.lo[0] + bb.hi[0]) * 0.5;
    // Handle side extends farther from centroid on +X; flip 180 deg about Z if skewed the other way.
    if (meanX - bb.lo[0] > bb.hi[0] - meanX && Math.abs(midX - meanX) > 1e-4) {
      out = transform(out, new Matrix4().makeRotationZ(Math.PI));
    }
  }

  // Uniform scale from primary dimension, capped per-axis by spec.size so parts never poke outside receivers/grips.
  const b1 = bounds(out.pos);
  const primaryScale =
    spec.kind === 'mag' ? spec.size[1] / b1.ext[1] : spec.size[2] / b1.ext[2];
  const sx = Math.min(primaryScale, spec.size[0] / b1.ext[0]);
  const sy = spec.kind === 'mag' ? primaryScale : Math.min(primaryScale, spec.size[1] / b1.ext[1]);
  const sz = spec.kind === 'bolt' || spec.kind === 'shell' ? primaryScale : Math.min(primaryScale, spec.size[2] / b1.ext[2]);

  const cx = (b1.lo[0] + b1.hi[0]) * 0.5;
  const cy = (b1.lo[1] + b1.hi[1]) * 0.5;
  const cz = (b1.lo[2] + b1.hi[2]) * 0.5;

  const anchorY = spec.kind === 'mag' ? -b1.hi[1] : -cy;
  const m = new Matrix4()
    .makeScale(sx, sy, sz)
    .multiply(new Matrix4().makeTranslation(-cx, anchorY, -cz));
  return transform(out, m);
}

const gcache = new Map();
function grimPixel(r, g, b) {
  const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let c = gcache.get(k);
  if (c === undefined) gcache.set(k, (c = grim((r << 16) | (g << 8) | b)));
  return c;
}

async function writeTextures(id, img) {
  let rawBuf;
  let width;
  let height;
  if (img) {
    const res = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    width = res.info.width;
    height = res.info.height;
    rawBuf = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const c = grimPixel(res.data[i * 4], res.data[i * 4 + 1], res.data[i * 4 + 2]);
      rawBuf[i * 4] = (c >> 16) & 255;
      rawBuf[i * 4 + 1] = (c >> 8) & 255;
      rawBuf[i * 4 + 2] = c & 255;
      rawBuf[i * 4 + 3] = 255;
    }
  } else {
    width = 64;
    height = 64;
    rawBuf = Buffer.alloc(width * height * 4);
    const fallback = grim(0x3a3b3d);
    for (let i = 0; i < width * height; i++) {
      rawBuf[i * 4] = (fallback >> 16) & 255;
      rawBuf[i * 4 + 1] = (fallback >> 8) & 255;
      rawBuf[i * 4 + 2] = fallback & 255;
      rawBuf[i * 4 + 3] = 255;
    }
  }
  for (const size of [1024, 512]) {
    const f = join(OUT_DIR, `${id}_${size}.webp`);
    await sharp(rawBuf, { raw: { width, height, channels: 4 } })
      .resize(size, size, { kernel: 'lanczos3' })
      .removeAlpha()
      .webp({ quality: 82 })
      .toFile(f);
  }
}

async function writePartGlb(io, id, g) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene(id);
  const acc = (type, arr) => doc.createAccessor().setType(type).setArray(arr).setBuffer(buf);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', g.pos))
    .setAttribute('NORMAL', acc('VEC3', g.nor))
    .setAttribute('TEXCOORD_0', acc('VEC2', g.uv));
  prim.setIndices(acc('SCALAR', g.pos.length / 3 > 65535 ? Uint32Array.from(g.index) : Uint16Array.from(g.index)));
  scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prim)));
  await doc.transform(reorder({ encoder: MeshoptEncoder }));
  doc
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  const outPath = join(OUT_DIR, `${id}.glb`);
  await io.write(outPath, doc);
  return statSync(outPath).size;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : {};
  const pending = [];

  for (const spec of SPECS) {
    const glbOk = existsSync(join(OUT_DIR, `${spec.id}.glb`)) && statSync(join(OUT_DIR, `${spec.id}.glb`)).size > 0;
    const t1024Ok = existsSync(join(OUT_DIR, `${spec.id}_1024.webp`)) && statSync(join(OUT_DIR, `${spec.id}_1024.webp`)).size > 0;
    const t512Ok = existsSync(join(OUT_DIR, `${spec.id}_512.webp`)) && statSync(join(OUT_DIR, `${spec.id}_512.webp`)).size > 0;
    if (glbOk && t1024Ok && t512Ok && manifest[spec.id]) {
      console.log(`[skip] ${spec.id} already exists (${manifest[spec.id].tris} tris)`);
      continue;
    }
    pending.push(spec);
  }

  if (pending.length === 0) return;

  const apiKey = loadMeshyKey();
  if (!apiKey) {
    console.error(`Error: MESHY_API_KEY is missing in .env (cannot generate ${pending.map((s) => s.id).join(', ')}).`);
    process.exit(1);
  }

  const CONCURRENCY = 2;
  let nextIdx = 0;

  const worker = async () => {
    const io = createIo();
    while (nextIdx < pending.length) {
      const spec = pending[nextIdx++];
      console.log(`[generate] ${spec.id} (preview -> refine, PBR)...`);
      const previewId = await meshyPost(apiKey, {
        mode: 'preview',
        ai_model: 'meshy-6-lite',
        prompt: spec.prompt,
        should_remesh: true,
        topology: 'triangle',
        target_polycount: 2500,
      });
      await meshyPoll(apiKey, previewId, `${spec.id}:preview`);
      console.log(`\n  [${spec.id}] preview complete, refining with PBR...`);

      const refineId = await meshyPost(apiKey, {
        mode: 'refine',
        preview_task_id: previewId,
        enable_pbr: true,
      });
      const refineData = await meshyPoll(apiKey, refineId, `${spec.id}:refine`);
      const glbUrl = refineData?.model_urls?.glb;
      if (!glbUrl) throw new Error(`Meshy refine succeeded without model_urls.glb for ${spec.id}`);

      const dl = await fetch(glbUrl);
      if (!dl.ok) throw new Error(`Failed downloading ${spec.id}.glb (${dl.status})`);
      const rawBuf = Buffer.from(await dl.arrayBuffer());

      const raw = await readCombined(io, rawBuf);
      const rawTris = raw.index.length / 3;
      const simplified = simplify(raw, spec.tris);
      const aligned = alignAndScale(simplified, spec);
      const finalTris = aligned.index.length / 3;
      const bytes = await writePartGlb(io, spec.id, aligned);
      await writeTextures(spec.id, aligned.tex);

      const bb = bounds(aligned.pos);
      manifest[spec.id] = { parts: ['body'], tris: finalTris };
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
      console.log(
        `\n[done] ${spec.id}: ${rawTris} -> ${finalTris} tris, ${(bytes / 1024).toFixed(1)} KB, size=${bb.ext.map((v) => v.toFixed(3)).join('x')}m`,
      );
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
}

await main();
