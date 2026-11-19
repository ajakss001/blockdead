#!/usr/bin/env node
/**
 * Post-processes the baked public/models library without needing original source GLBs:
 * 1. Repacks atlas.jpg from a 1×84 vertical strip (256×21504, exceeding mobile 16384 px GPU/canvas
 *    limits) into a 10-column 2D grid (2560×2304, within 4096 px on every phone), recording `atlasCols`.
 * 2. Bakes simplified `lod1` index buffers (≤ 1% error via MeshoptSimplifier) into models.bin for
 *    heavy vehicle models (reusing the exact same vertex buffer, zero extra vertices).
 *
 * Idempotent: safe to re-run at any time.
 * Usage: node tools/optimize-baked-models.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = process.cwd();
const OUT = join(ROOT, 'public', 'models');
const JSON_PATH = join(OUT, 'models.json');
const BIN_PATH = join(OUT, 'models.bin');
const ATLAS_PATH = join(OUT, 'atlas.jpg');
const ATLAS_COLS = 10;
const LOD_GROUPS = new Set(['car', 'van', 'police', 'ambulance', 'wreck', 'truck', 'tank', 'apc', 'heli', 'heliMil']);

await MeshoptSimplifier.ready;

const meta = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
const bin = readFileSync(BIN_PATH);
const stride = meta.stride ?? 20;
const tile = meta.atlas ?? 256;
const nModels = meta.models.length;

// ── 1. Repack atlas.jpg into a 2D grid ──────────────────────────────────────────────────────────────────
if (meta.atlasCols !== ATLAS_COLS) {
  const srcImg = jpeg.decode(readFileSync(ATLAS_PATH), { useTArray: true, formatAsRGBA: true });
  const srcCols = meta.atlasCols ?? Math.max(1, Math.round(srcImg.width / tile));
  const dstCols = ATLAS_COLS;
  const dstRows = Math.ceil(nModels / dstCols);
  const dstW = dstCols * tile;
  const dstH = dstRows * tile;
  const dstPx = new Uint8Array(dstW * dstH * 4).fill(255);

  for (const m of meta.models) {
    const l = m.layer;
    const sc = l % srcCols;
    const sr = Math.floor(l / srcCols);
    const dc = l % dstCols;
    const dr = Math.floor(l / dstCols);
    for (let y = 0; y < tile; y++) {
      const srcOff = ((sr * tile + y) * srcImg.width + sc * tile) * 4;
      const dstOff = ((dr * tile + y) * dstW + dc * tile) * 4;
      dstPx.set(srcImg.data.subarray(srcOff, srcOff + tile * 4), dstOff);
    }
  }

  writeFileSync(ATLAS_PATH, jpeg.encode({ data: dstPx, width: dstW, height: dstH }, 88).data);
  meta.atlasCols = dstCols;
  console.log(`atlas.jpg repacked: ${srcImg.width}×${srcImg.height} → ${dstW}×${dstH} (${dstCols}×${dstRows} tiles)`);
} else {
  console.log(`atlas.jpg already packed with atlasCols=${ATLAS_COLS}`);
}

// ── 2. Rebuild models.bin cleanly and generate vehicle LOD1 indices ─────────────────────────────────────
const chunks = [];
let offset = 0;
let lodCount = 0;
let totalOpaqueTris = 0;
let totalLodTris = 0;

function decodeModel(m, vOffset, iOffset) {
  const vCount = m.vertices;
  const view = new DataView(bin.buffer, bin.byteOffset + vOffset, vCount * stride);
  const pos = new Float32Array(vCount * 3);
  const attrs = new Float32Array(vCount * 5);
  for (let i = 0; i < vCount; i++) {
    const o = i * stride;
    pos[i * 3] = m.min[0] + (view.getUint16(o, true) / 65535) * m.size[0];
    pos[i * 3 + 1] = m.min[1] + (view.getUint16(o + 2, true) / 65535) * m.size[1];
    pos[i * 3 + 2] = m.min[2] + (view.getUint16(o + 4, true) / 65535) * m.size[2];
    attrs[i * 5] = view.getInt8(o + 8) / 127;
    attrs[i * 5 + 1] = view.getInt8(o + 9) / 127;
    attrs[i * 5 + 2] = view.getInt8(o + 10) / 127;
    attrs[i * 5 + 3] = view.getUint16(o + 12, true) / 65535;
    attrs[i * 5 + 4] = view.getUint16(o + 14, true) / 65535;
  }
  const opaqueCount = m.indices - (m.glass ?? 0);
  const idxView = new Uint16Array(bin.buffer, bin.byteOffset + iOffset, opaqueCount);
  return { pos, attrs, opaqueIdx: Uint32Array.from(idxView), opaqueCount };
}

for (const m of meta.models) {
  const origVOffset = m.vOffset;
  const origIOffset = m.iOffset;
  const vLen = m.vertices * stride;
  const iLen = m.indices * 2 + (m.indices % 2 ? 2 : 0);
  const vbuf = bin.subarray(origVOffset, origVOffset + vLen);
  const ibuf = bin.subarray(origIOffset, origIOffset + iLen);

  const vOffset = offset;
  chunks.push(vbuf);
  offset += vbuf.length;

  const iOffset = offset;
  chunks.push(ibuf);
  offset += ibuf.length;

  m.vOffset = vOffset;
  m.iOffset = iOffset;
  delete m.lod1Offset;
  delete m.lod1Indices;

  const opaqueTris = (m.indices - (m.glass ?? 0)) / 3;
  if (LOD_GROUPS.has(m.group) && opaqueTris >= 600) {
    totalOpaqueTris += opaqueTris;
    const { pos, attrs, opaqueIdx, opaqueCount } = decodeModel(m, origVOffset, origIOffset);
    const target = Math.max(300, Math.floor(opaqueTris * 0.45)) * 3;
    const [lodIdx, err] = MeshoptSimplifier.simplifyWithAttributes(
      opaqueIdx,
      pos,
      3,
      attrs,
      5,
      [0.5, 0.5, 0.5, 0.2, 0.2],
      null,
      target,
      0.01,
      ['LockBorder'],
    );
    if (lodIdx.length >= 3 && lodIdx.length <= opaqueCount * 0.85) {
      const lodLen = lodIdx.length * 2 + (lodIdx.length % 2 ? 2 : 0);
      const lbuf = Buffer.alloc(lodLen);
      for (let k = 0; k < lodIdx.length; k++) lbuf.writeUInt16LE(lodIdx[k], k * 2);
      m.lod1Offset = offset;
      m.lod1Indices = lodIdx.length;
      chunks.push(lbuf);
      offset += lbuf.length;
      lodCount++;
      const lodTris = lodIdx.length / 3;
      totalLodTris += lodTris;
      const pct = Math.round((1 - lodTris / opaqueTris) * 100);
      console.log(`  LOD1 ${m.name.padEnd(20)} ${String(opaqueTris).padStart(5)} → ${String(lodTris).padStart(5)} tris (-${pct}%, err ${(err * 100).toFixed(2)}%)`);
    } else {
      totalLodTris += opaqueTris;
      console.log(`  skip ${m.name.padEnd(20)} ${String(opaqueTris).padStart(5)} tris (locked/UV-seamed: ${lodIdx.length / 3} tris)`);
    }
  }
}

writeFileSync(BIN_PATH, Buffer.concat(chunks));
writeFileSync(JSON_PATH, JSON.stringify(meta, null, 1));
console.log(`\nmodels.bin: ${(bin.length / 1024).toFixed(0)} KB → ${(offset / 1024).toFixed(0)} KB, LOD1 built for ${lodCount} vehicles (opaque vehicle tris ${totalOpaqueTris} → ${totalLodTris})`);
