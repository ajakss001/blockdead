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
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
    size: [0.017, 0.088, 0.026],
    tris: 700,
    prompt:
      'Vertical straight black polymer 9mm pistol magazine for Glock 17 with steel feed lips and one brass 9mm cartridge loaded on top, black polymer baseplate at bottom, standalone game weapon part, realistic PBR',
  },
  {
    id: 'mag_pistol_m1911',
    kind: 'mag',
    size: [0.014, 0.098, 0.025],
    tris: 700,
    prompt:
      'Vertical blued steel single-stack .45 ACP pistol magazine for M1911 with witness holes on side, steel floorplate at bottom, and one brass .45 cartridge visible at top feed lips, standalone weapon part, realistic PBR',
  },
  {
    id: 'mod_ext_mag_g17',
    kind: 'mag',
    size: [0.017, 0.16, 0.026],
    tris: 750,
    prompt:
      'Long vertical black polymer 33-round extended 9mm stick magazine for Glock pistol with thick extended floorplate at bottom and brass cartridge at top feed lips, standalone game weapon attachment, realistic PBR',
  },
  {
    id: 'mag_m4',
    kind: 'mag',
    size: [0.024, 0.172, 0.064],
    tris: 900,
    prompt:
      'Matte black steel 30-round 5.56mm AR-15 M4A1 magazine with brass cartridge at top feed lips, standalone game weapon part, realistic PBR',
  },
  {
    id: 'mag_ak',
    kind: 'mag',
    size: [0.026, 0.19, 0.09],
    tris: 900,
    prompt:
      'Curved dark stamped steel 30-round 7.62x39mm AK-47 magazine with reinforcing ribs and brass cartridge visible at top feed lips, standalone game weapon part, realistic PBR',
  },
  {
    id: 'mod_ext_mag_m4',
    kind: 'mag',
    size: [0.025, 0.27, 0.068],
    tris: 950,
    prompt:
      'Extended matte black polymer 40-round 5.56mm AR-15 magazine with brass cartridge at top feed lips, standalone game weapon attachment, realistic PBR',
  },
  {
    id: 'mod_ext_mag_ak',
    kind: 'mag',
    size: [0.028, 0.275, 0.105],
    tris: 950,
    prompt:
      'Long curved dark steel/bakelite 40-round 7.62x39mm extended AK magazine with brass cartridge visible at top feed lips, standalone game weapon attachment, realistic PBR',
  },
  {
    id: 'clip_308',
    kind: 'clip',
    size: [0.06, 0.016, 0.071],
    tris: 1100,
    prompt:
      'Five 7.62x51mm .308 brass rifle cartridges with copper pointed bullets held side-by-side in a dark blued steel stripper clip charger, standalone game ammunition prop, realistic PBR',
  },
  {
    id: 'bolt_ak',
    kind: 'bolt',
    size: [0.028, 0.022, 0.088],
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
    size: [0.021, 0.021, 0.068],
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
  let [best] = MeshoptSimplifier.simplifyWithAttributes(g.index, g.pos, 3, g.uv, 2, [1.5, 1.5], null, want, 1, ['LockBorder']);
  if (best.length / 3 <= target) return compact({ ...g, index: best });
  for (const [factor, err] of [
    [0.95, 0.05],
    [0.88, 0.08],
    [0.78, 0.12],
    [0.65, 0.2],
  ]) {
    const aim = Math.max(36, Math.floor(target * factor) * 3);
    const [cand] = MeshoptSimplifier.simplify(g.index, g.pos, 3, aim, err, ['Permissive']);
    if (cand.length >= 36 && cand.length < best.length) best = cand;
    if (best.length / 3 <= target) break;
  }
  return compact({ ...g, index: best });
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

function sampleBrassWarmth(rawTex, u, v) {
  if (!rawTex) return false;
  const uu = ((u % 1) + 1) % 1;
  const vv = ((v % 1) + 1) % 1;
  const x = Math.min(rawTex.width - 1, Math.floor(uu * rawTex.width));
  const y = Math.min(rawTex.height - 1, Math.floor(vv * rawTex.height));
  const idx = (y * rawTex.width + x) * 4;
  const r = rawTex.data[idx];
  const g = rawTex.data[idx + 1];
  const b = rawTex.data[idx + 2];
  return r > b + 20 && r > 85 && g > 55 && r >= g * 0.85;
}

/**
 * Normalize axis orientation & metric scale deterministically regardless of Meshy's raw pose:
 *  - `mag`   : longest -> Y (feed lips at y=0 facing +Y, brass bullet tips facing -Z, body hanging -Y).
 *  - `clip`  : longest -> Z (cartridge length, bullet tips strictly along -Z), middle -> X, thinnest -> Y, centered.
 *  - `bolt`  : longest -> Z (barrel axis), middle -> X (handle sticking out +X), thinnest -> Y, centered.
 *  - `shell` : longest -> Z (cartridge length), cross-section X/Y symmetric, centered.
 */
function alignAndScale(g, spec, rawTex, opts = {}) {
  const b0 = bounds(g.pos);
  const order = [0, 1, 2].sort((a, b) => b0.ext[b] - b0.ext[a]); // [longest, middle, thinnest]
  let srcForX;
  let srcForY;
  let srcForZ;
  if (spec.kind === 'mag') {
    srcForY = order[0]; // tallest = vertical mag length
    srcForZ = order[1]; // front-to-back mag depth
    srcForX = order[2]; // thinnest = left-right thickness
  } else if (spec.kind === 'bolt' || spec.kind === 'clip') {
    srcForZ = order[0]; // longest = cartridge/barrel Z
    srcForX = order[1]; // middle = handle protrusion or 5-round clip X width
    srcForY = order[2]; // thinnest height Y
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
  mapCol(srcForX, new Vector3(1, 0, 0));
  mapCol(srcForY, new Vector3(0, 1, 0));
  mapCol(srcForZ, new Vector3(0, 0, 1));
  const det = new Vector3().crossVectors(cols[0], cols[1]).dot(cols[2]);
  if (det < 0) cols[srcForX].negate();
  perm.makeBasis(cols[0], cols[1], cols[2]);
  let out = transform(g, perm);

  const nVerts = out.pos.length / 3;
  if (spec.kind === 'mag') {
    // 1. Ensure feed lips / brass round end is at +Y (top), baseplate at -Y (bottom).
    const by = bounds(out.pos);
    const yTopCut = by.hi[1] - 0.18 * by.ext[1];
    const yBotCut = by.lo[1] + 0.18 * by.ext[1];
    let topBrass = 0;
    let botBrass = 0;
    for (let i = 0; i < nVerts; i++) {
      const y = out.pos[i * 3 + 1];
      if (y >= yTopCut && sampleBrassWarmth(rawTex, out.uv[i * 2], out.uv[i * 2 + 1])) topBrass++;
      else if (y <= yBotCut && sampleBrassWarmth(rawTex, out.uv[i * 2], out.uv[i * 2 + 1])) botBrass++;
    }
    if (botBrass > topBrass * 1.15) {
      out = transform(out, new Matrix4().makeRotationX(Math.PI));
    }

    // 2. Ensure cartridge nose / AK forward curve points along -Z.
    const bz = bounds(out.pos);
    if (spec.id.includes('ak')) {
      const topZCut = bz.hi[1] - 0.3 * bz.ext[1];
      const botZCut = bz.lo[1] + 0.3 * bz.ext[1];
      let sumTopZ = 0, cntTop = 0, sumBotZ = 0, cntBot = 0;
      for (let i = 0; i < nVerts; i++) {
        const y = out.pos[i * 3 + 1];
        const z = out.pos[i * 3 + 2];
        if (y >= topZCut) { sumTopZ += z; cntTop++; }
        else if (y <= botZCut) { sumBotZ += z; cntBot++; }
      }
      const meanTopZ = sumTopZ / Math.max(1, cntTop);
      const meanBotZ = sumBotZ / Math.max(1, cntBot);
      if (meanBotZ > meanTopZ) out = transform(out, new Matrix4().makeRotationY(Math.PI));
    } else {
      const yLipCut = bz.hi[1] - 0.12 * bz.ext[1];
      const zMid = (bz.lo[2] + bz.hi[2]) * 0.5;
      let absXFront = 0, cntFront = 0, absXBack = 0, cntBack = 0;
      for (let i = 0; i < nVerts; i++) {
        if (out.pos[i * 3 + 1] < yLipCut) continue;
        const ax = Math.abs(out.pos[i * 3]);
        if (out.pos[i * 3 + 2] < zMid) { absXFront += ax; cntFront++; }
        else { absXBack += ax; cntBack++; }
      }
      if (cntFront > 0 && cntBack > 0 && absXFront / cntFront > absXBack / cntBack * 1.05) {
        out = transform(out, new Matrix4().makeRotationY(Math.PI));
      }
    }
  } else if (spec.kind === 'clip') {
    // Pointed bullet tips have narrower Y cross-section & taper in -Z compared to flat rim / clip spine in +Z.
    const bc = bounds(out.pos);
    const midY = (bc.lo[1] + bc.hi[1]) * 0.5;
    const zFrontCut = bc.lo[2] + 0.2 * bc.ext[2];
    const zBackCut = bc.hi[2] - 0.2 * bc.ext[2];
    let fAbsY = 0, fCnt = 0, bAbsY = 0, bCnt = 0;
    for (let i = 0; i < nVerts; i++) {
      const z = out.pos[i * 3 + 2];
      const dy = Math.abs(out.pos[i * 3 + 1] - midY);
      if (z <= zFrontCut) { fAbsY += dy; fCnt++; }
      else if (z >= zBackCut) { bAbsY += dy; bCnt++; }
    }
    if (fCnt > 0 && bCnt > 0 && fAbsY / fCnt > bAbsY / bCnt) {
      out = transform(out, new Matrix4().makeRotationY(Math.PI));
    }
  } else if (spec.kind === 'bolt') {
    const bb = bounds(out.pos);
    let meanX = 0;
    for (let i = 0; i < nVerts; i++) meanX += out.pos[i * 3];
    meanX /= Math.max(1, nVerts);
    const midX = (bb.lo[0] + bb.hi[0]) * 0.5;
    if (meanX - bb.lo[0] > bb.hi[0] - meanX && Math.abs(midX - meanX) > 1e-4) {
      out = transform(out, new Matrix4().makeRotationZ(Math.PI));
    }
  }

  if (opts.flipY) out = transform(out, new Matrix4().makeRotationX(Math.PI));
  if (opts.flipZ) out = transform(out, new Matrix4().makeRotationY(Math.PI));

  // Scale from primary dimension, capped per-axis by spec.size.
  const b1 = bounds(out.pos);
  const primaryScale =
    spec.kind === 'mag' ? spec.size[1] / b1.ext[1] : spec.size[2] / b1.ext[2];
  const sx = Math.min(primaryScale, spec.size[0] / b1.ext[0]);
  const sy = spec.kind === 'mag' ? primaryScale : Math.min(primaryScale, spec.size[1] / b1.ext[1]);
  const sz = spec.kind === 'bolt' || spec.kind === 'shell' || spec.kind === 'clip' ? primaryScale : Math.min(primaryScale, spec.size[2] / b1.ext[2]);

  let anchorX = (b1.lo[0] + b1.hi[0]) * 0.5;
  let anchorY = (b1.lo[1] + b1.hi[1]) * 0.5;
  let anchorZ = (b1.lo[2] + b1.hi[2]) * 0.5;

  if (spec.kind === 'mag') {
    // Anchor mag pivot at the center of the top 20% slice so curved AK mags seat flush in magwell at (0,0,0).
    const ySlice = b1.hi[1] - 0.2 * b1.ext[1];
    let sxSum = 0, szSum = 0, sCnt = 0;
    for (let i = 0; i < nVerts; i++) {
      if (out.pos[i * 3 + 1] >= ySlice) {
        sxSum += out.pos[i * 3];
        szSum += out.pos[i * 3 + 2];
        sCnt++;
      }
    }
    if (sCnt > 0) {
      anchorX = sxSum / sCnt;
      anchorZ = szSum / sCnt;
    }
    anchorY = b1.hi[1];
  }

  const m = new Matrix4()
    .makeScale(sx, sy, sz)
    .multiply(new Matrix4().makeTranslation(-anchorX, -anchorY, -anchorZ));
  return transform(out, m);
}

const gcache = new Map();
function grimPixel(r, g, b) {
  const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let c = gcache.get(k);
  if (c === undefined) gcache.set(k, (c = grim((r << 16) | (g << 8) | b)));
  return c;
}

async function decodeRawTexture(img) {
  if (!img) return null;
  const res = await sharp(Buffer.from(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: res.info.width, height: res.info.height, data: res.data };
}

async function writeTextures(id, rawTex) {
  let rawBuf;
  let width;
  let height;
  if (rawTex) {
    width = rawTex.width;
    height = rawTex.height;
    rawBuf = Buffer.alloc(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const c = grimPixel(rawTex.data[i * 4], rawTex.data[i * 4 + 1], rawTex.data[i * 4 + 2]);
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

async function processRawBuffer(io, manifest, spec, rawBuf, opts = {}) {
  const raw = await readCombined(io, rawBuf);
  const rawTris = raw.index.length / 3;
  const decodedTex = await decodeRawTexture(raw.tex);
  const simplified = simplify(raw, spec.tris);
  const aligned = alignAndScale(simplified, spec, decodedTex, opts);
  const finalTris = aligned.index.length / 3;
  const bytes = await writePartGlb(io, spec.id, aligned);
  await writeTextures(spec.id, decodedTex);

  const bb = bounds(aligned.pos);
  manifest[spec.id] = { parts: ['body'], tris: finalTris };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
  console.log(
    `[done] ${spec.id}: ${rawTris} -> ${finalTris} tris (budget <= ${spec.tris}), ${(bytes / 1024).toFixed(1)} KB, ext=${bb.ext.map((v) => v.toFixed(3)).join('x')}m, y=[${bb.lo[1].toFixed(3)},${bb.hi[1].toFixed(3)}]`,
  );
}

function walkGlbs(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkGlbs(p, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.glb')) out.push(p);
  }
  return out;
}

function findGlbForSpec(files, id) {
  const exact = new RegExp(`(^|[\\\\/])${id}\\.glb$`, 'i');
  const meshy = new RegExp(`meshy_ai_${id}_\\d+p`, 'i');
  return files.find((f) => exact.test(f)) ?? files.find((f) => meshy.test(f)) ?? null;
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

function parseFlags(argv) {
  let fromDir = '';
  const flipY = new Set();
  const flipZ = new Set();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from' && argv[i + 1]) fromDir = resolve(argv[++i]);
    else if (a.startsWith('--from=')) fromDir = resolve(a.slice(7));
    else if (a.startsWith('--flip-y=')) {
      for (const id of a.slice(9).split(',')) if (id) flipY.add(id.trim());
    } else if (a.startsWith('--flip-z=')) {
      for (const id of a.slice(9).split(',')) if (id) flipZ.add(id.trim());
    }
  }
  return { fromDir, flipY, flipZ };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const { fromDir, flipY, flipZ } = parseFlags(process.argv.slice(2));
  const manifest = existsSync(MANIFEST_PATH) ? JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) : {};

  if (fromDir) {
    const files = walkGlbs(fromDir);
    const io = createIo();
    let count = 0;
    for (const spec of SPECS) {
      const srcFile = findGlbForSpec(files, spec.id);
      if (!srcFile) continue;
      count++;
      console.log(`[import] ${spec.id} <- ${srcFile}`);
      const rawBuf = readFileSync(srcFile);
      await processRawBuffer(io, manifest, spec, rawBuf, {
        flipY: flipY.has(spec.id),
        flipZ: flipZ.has(spec.id),
      });
    }
    if (count === 0) {
      console.warn(`No matching weapon part GLBs found under ${fromDir}`);
    }
    writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
    return;
  }

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
      await processRawBuffer(io, manifest, spec, rawBuf, {
        flipY: flipY.has(spec.id),
        flipZ: flipZ.has(spec.id),
      });
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1));
}

await main();
