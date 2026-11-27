#!/usr/bin/env node
/**
 * Manual-only one-shot generator for the 5 missing post-apocalyptic catastrophe GLB assets via Meshy API v2.
 *
 * Security & quota safety:
 *  - Reads `MESHY_API_KEY` (or fallback `MESH_API_KEY`) strictly from local `.env` (never logged or bundled).
 *  - Never runs automatically during builds or tests; run manually via `npm run gen:catastrophe`.
 *  - Generates strictly the 5 listed assets and SKIPS any asset whose target `.glb` already exists (> 0 bytes)
 *    in `public/models/catastrophe/` to prevent duplicate API credit usage.
 *  - Post-processes every downloaded GLB through `gltf-transform` (`weld`, `MeshoptSimplifier`, `1024px` WebP,
 *    `dedup`, `prune`, `quantize`, `meshopt`) enforcing <= 1.5 MB per file (compatible with `GlbPropPool`
 *    `MeshoptDecoder` without shipping extra Draco WASM decoders in the client bundle).
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, dequantize, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT_DIR = resolve('.');
const ENV_PATH = join(ROOT_DIR, '.env');
const OUT_DIR = join(ROOT_DIR, 'public/models/catastrophe');
const MAX_BYTES = 1.5 * 1024 * 1024;
const MESHY_ENDPOINT = 'https://api.meshy.ai/openapi/v2/text-to-3d';

const ASSETS = [
  {
    file: 'crashed_boeing_fuselage.glb',
    polycount: 18000,
    prompt:
      'Broken burned passenger airliner fuselage wreck, snapped in half, ripped jagged charred aluminum edges, dark soot and scorch marks, NO landing gear, post-apocalyptic crash site, gritty realistic PBR game asset',
  },
  {
    file: 'crashed_plane_wing.glb',
    polycount: 10000,
    prompt:
      'Detached broken airplane wing with damaged jet engine, scorched metal, torn wiring, realistic post-apocalyptic debris, PBR game asset',
  },
  {
    file: 'concrete_rubble_mound.glb',
    polycount: 10000,
    prompt:
      'Large pile of collapsed Soviet building concrete rubble, broken slabs, red bricks, bent exposed steel rebar, dust and ash, realistic PBR game asset',
  },
  {
    file: 'building_breach_frame.glb',
    polycount: 10000,
    prompt:
      'Jagged destroyed concrete and brick wall hole breach with twisted exposed rebar and scorched edges, modular architectural destruction piece, PBR game asset',
  },
  {
    file: 'giant_trash_mound.glb',
    polycount: 10000,
    prompt:
      'Huge post-apocalyptic urban garbage mound, torn black trash bags, broken wooden crates, scrap metal, cardboard, rusted cans, gritty realistic PBR game asset',
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
  const res = await fetch(MESHY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Meshy POST ${res.status} ${res.statusText}: ${errText}`);
  }
  const data = await res.json();
  if (!data?.result) throw new Error('Meshy POST missing task result id');
  return data.result;
}

async function meshyPoll(apiKey, taskId, label) {
  const start = Date.now();
  while (Date.now() - start < 15 * 60 * 1000) {
    const res = await fetch(`${MESHY_ENDPOINT}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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
    await sleep(5000);
  }
  throw new Error(`Meshy task ${label} timed out after 15 minutes`);
}

function countTris(doc) {
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      if (!pos) continue;
      tris += Math.round((idx ? idx.getCount() : pos.getCount()) / 3);
    }
  }
  return tris;
}

async function convertTexturesWebP(doc, maxDim, quality) {
  doc.createExtension(EXTTextureWebP).setRequired(false);
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const meta = await sharp(img).metadata();
    let pipe = sharp(img);
    if ((meta.width ?? maxDim) > maxDim || (meta.height ?? maxDim) > maxDim) {
      pipe = pipe.resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });
    }
    const out = await pipe.webp({ quality, effort: 5 }).toBuffer();
    tex.setImage(out);
    tex.setMimeType('image/webp');
  }
}

function simplifyDocToBudget(doc, targetTris) {
  const curTris = countTris(doc);
  if (curTris <= targetTris || curTris <= 24) return;
  const ratio = Math.max(0.15, Math.min(1.0, targetTris / curTris));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;
      let idxAcc = prim.getIndices();
      if (!idxAcc) {
        const count = posAcc.getCount();
        const arr = new Uint32Array(count);
        for (let k = 0; k < count; k++) arr[k] = k;
        idxAcc = doc.createAccessor().setType('SCALAR').setArray(arr);
        prim.setIndices(idxAcc);
      }
      const posArr = new Float32Array(posAcc.getArray());
      const srcIdx = new Uint32Array(idxAcc.getArray());
      const wantIdx = Math.max(36, Math.floor((srcIdx.length * ratio) / 3) * 3);
      if (wantIdx >= srcIdx.length) continue;
      const [dstIdx] = MeshoptSimplifier.simplify(srcIdx, posArr, 3, wantIdx, 0.04, ['Permissive', 'Prune']);
      if (dstIdx.length >= 12 && dstIdx.length < srcIdx.length) {
        idxAcc.setArray(dstIdx);
        compactPrimitive(prim);
        if (posAcc.getCount() <= 65534) {
          idxAcc.setArray(new Uint16Array(idxAcc.getArray()));
        }
      }
    }
  }
}

async function optimizeGlb(io, rawBytes, targetTris, texDim = 1024, webpQuality = 80) {
  const doc = await io.readBinary(new Uint8Array(rawBytes));
  await doc.transform(dequantize(), dedup(), weld({ tolerance: 1e-4, overwrite: true }));
  simplifyDocToBudget(doc, targetTris);
  await convertTexturesWebP(doc, texDim, webpQuality);
  await doc.transform(prune(), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  return io.writeBinary(doc);
}

async function main() {
  const apiKey = loadMeshyKey();
  if (!apiKey) {
    console.error('Error: MESHY_API_KEY is missing or empty in local .env (nothing generated).');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  });

  for (const spec of ASSETS) {
    const outPath = join(OUT_DIR, spec.file);
    if (existsSync(outPath) && statSync(outPath).size > 0) {
      const kb = (statSync(outPath).size / 1024).toFixed(1);
      console.log(`[skip] ${spec.file} already exists (${kb} KB)`);
      continue;
    }

    console.log(`[generate] ${spec.file} (preview -> refine, PBR, target=${spec.polycount})...`);
    const previewId = await meshyPost(apiKey, {
      mode: 'preview',
      ai_model: 'latest',
      prompt: spec.prompt,
      should_remesh: true,
      topology: 'triangle',
      target_polycount: spec.polycount,
    });
    await meshyPoll(apiKey, previewId, `${spec.file}:preview`);
    console.log(`\n  preview complete (${previewId}), starting PBR refine...`);

    const refineId = await meshyPost(apiKey, {
      mode: 'refine',
      preview_task_id: previewId,
      enable_pbr: true,
    });
    const refineData = await meshyPoll(apiKey, refineId, `${spec.file}:refine`);
    const glbUrl = refineData?.model_urls?.glb;
    if (!glbUrl) throw new Error(`Meshy refine succeeded without model_urls.glb for ${spec.file}`);

    console.log(`\n  downloading & optimizing via gltf-transform + 1024px WebP...`);
    const dl = await fetch(glbUrl);
    if (!dl.ok) throw new Error(`Failed downloading GLB (${dl.status}) for ${spec.file}`);
    const rawBuf = Buffer.from(await dl.arrayBuffer());

    let packed = await optimizeGlb(io, rawBuf, spec.polycount, 1024, 80);
    if (packed.byteLength > MAX_BYTES) {
      packed = await optimizeGlb(io, rawBuf, Math.round(spec.polycount * 0.65), 768, 68);
    }
    if (packed.byteLength > MAX_BYTES) {
      packed = await optimizeGlb(io, rawBuf, Math.round(spec.polycount * 0.45), 512, 62);
    }

    writeFileSync(outPath, packed);
    const verifyDoc = await io.readBinary(packed);
    console.log(
      `[done] ${spec.file}: ${countTris(verifyDoc)} tris, ${(packed.byteLength / 1024).toFixed(1)} KB`,
    );
  }
}

await main();
