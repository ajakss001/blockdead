#!/usr/bin/env node
/**
 * Generates simplified LOD1 meshes in `public/models/world/lod/<id>.glb` + `manifest.json`
 * for high-triangle world GLBs in `public/models/world/manifest.json`.
 * Keeps baseColor/normal/MR material structure intact (resized to 256/128px JPEG) so LOD1 shares
 * shaders cleanly while dropping triangle count by ~80-85% and keeping bundle size <= 6 MB.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, dequantize, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const WORLD_DIR = 'public/models/world';
const LOD_DIR = join(WORLD_DIR, 'lod');
const SRC_MANIFEST = join(WORLD_DIR, 'manifest.json');

const ALWAYS_INCLUDE = new Set(['street_lamp_2000', 'Urban_Bush_2500']);

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

async function downscaleTextures(doc) {
  const roles = new Map();
  for (const mat of doc.getRoot().listMaterials()) {
    const bc = mat.getBaseColorTexture();
    const nm = mat.getNormalTexture();
    const mr = mat.getMetallicRoughnessTexture();
    if (bc) roles.set(bc, 'baseColor');
    if (nm) roles.set(nm, 'normal');
    if (mr) roles.set(mr, 'mr');
  }
  for (const tex of doc.getRoot().listTextures()) {
    const img = tex.getImage();
    if (!img) continue;
    const role = roles.get(tex) ?? 'other';
    const dim = role === 'baseColor' ? 256 : 128;
    const quality = role === 'baseColor' ? 72 : 68;
    const meta = await sharp(img).metadata();
    let pipe = sharp(img);
    if ((meta.width ?? 1024) > dim || (meta.height ?? 1024) > dim) {
      pipe = pipe.resize(dim, dim, { fit: 'inside', withoutEnlargement: true });
    }
    const out = await pipe
      .jpeg({ quality, chromaSubsampling: role === 'normal' ? '4:4:4' : '4:2:0', mozjpeg: true })
      .toBuffer();
    tex.setImage(out);
    tex.setMimeType('image/jpeg');
  }
}

function simplifyDocPrimitives(doc, ratio = 0.15, targetError = 0.08) {
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
      const minTargetTris = srcIdx.length >= 90 ? 12 : Math.floor(srcIdx.length / 3);
      const targetIdxCount = Math.max(minTargetTris * 3, Math.floor((srcIdx.length * ratio) / 3) * 3);
      if (targetIdxCount >= srcIdx.length) continue;

      let [dstIdx] = MeshoptSimplifier.simplify(srcIdx, posArr, 3, targetIdxCount, targetError, ['Permissive', 'Prune']);
      if (dstIdx.length < 12 && srcIdx.length >= 12) {
        [dstIdx] = MeshoptSimplifier.simplify(srcIdx, posArr, 3, Math.max(12, targetIdxCount), 0.16, ['Permissive']);
      }
      if (dstIdx.length >= 3 && dstIdx.length < srcIdx.length) {
        idxAcc.setArray(dstIdx);
        compactPrimitive(prim);
        if (posAcc.getCount() <= 65534) {
          idxAcc.setArray(new Uint16Array(idxAcc.getArray()));
        }
      }
    }
  }
}

async function main() {
  if (!existsSync(SRC_MANIFEST)) throw new Error(`Missing ${SRC_MANIFEST}`);
  const srcManifest = JSON.parse(readFileSync(SRC_MANIFEST, 'utf8'));

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });

  mkdirSync(LOD_DIR, { recursive: true });

  const entries = [];
  let totalBytes = 0;
  let totalSrcTris = 0;
  let totalLodTris = 0;

  for (const item of srcManifest.models) {
    const id = item.file.replace(/\.glb$/i, '');
    if (item.tris < 2000 && !ALWAYS_INCLUDE.has(id)) continue;

    const srcPath = join(WORLD_DIR, item.file);
    const outPath = join(LOD_DIR, `${id}.glb`);
    const doc = await io.read(srcPath);
    const srcTris = countTris(doc);

    await downscaleTextures(doc);

    for (const m of doc.getRoot().listMeshes()) {
      for (const p of m.listPrimitives()) {
        for (const sem of p.listSemantics()) {
          if (sem !== 'POSITION' && sem !== 'NORMAL' && sem !== 'TEXCOORD_0') {
            p.setAttribute(sem, null);
          }
        }
      }
    }

    await doc.transform(
      dequantize(),
      dedup(),
      weld({ tolerance: 1e-4, overwrite: true }),
    );

    simplifyDocPrimitives(doc, 0.15, 0.08);
    let lodTris = countTris(doc);

    if (lodTris < 8) {
      throw new Error(`LOD1 over-simplified for ${id}: ${lodTris} tris`);
    }

    await doc.transform(
      prune(),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'high' }),
    );

    await io.write(outPath, doc);
    const bytes = statSync(outPath).size;
    totalBytes += bytes;
    totalSrcTris += srcTris;
    totalLodTris += lodTris;
    const pct = ((1 - lodTris / Math.max(1, srcTris)) * 100).toFixed(1);

    entries.push({
      id,
      file: `${id}.glb`,
      srcTriangles: srcTris,
      triangles: lodTris,
      bytes,
    });

    console.log(
      `${id.padEnd(26)} ${String(srcTris).padStart(6)} -> ${String(lodTris).padStart(5)} tris (-${pct.padStart(5)}%)  ${(bytes / 1024).toFixed(1).padStart(6)} KB`,
    );
  }

  writeFileSync(
    join(LOD_DIR, 'manifest.json'),
    JSON.stringify({ models: entries, totalBytes, totalSrcTris, totalLodTris }, null, 2),
  );
  const totalPct = ((1 - totalLodTris / Math.max(1, totalSrcTris)) * 100).toFixed(1);
  console.log(
    `\nGenerated ${entries.length} LOD1 GLBs -> ${(totalBytes / 1048576).toFixed(2)} MB total | tris ${totalSrcTris} -> ${totalLodTris} (-${totalPct}%)`,
  );
}

await main();
