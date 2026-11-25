#!/usr/bin/env node
/**
 * Compresses the 3 modular skyscraper GLBs and 3 lobby prop GLBs from C:\Users\pmoro\Downloads
 * into assets/models/*.glb for fast WebGL delivery:
 * - Resizes baseColor & normal maps to <= 1024x1024 and metallicRoughness to <= 512x512 (JPEG).
 * - Runs dedup, weld, prune, quantize, and high-level Meshopt compression.
 *
 * Usage: node tools/optimize-skyscraper.mjs
 */
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import jpeg from 'jpeg-js';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { PNG } from 'pngjs';

const DOWNLOADS = 'C:/Users/pmoro/Downloads';
const OUT_DIR = join(process.cwd(), 'assets', 'models');

const ASSETS = [
  { src: 'Meshy_AI_skyscraper_base_cubic_20261124_texture.glb', dst: 'skyscraper_base.glb', baseMax: 1024, mrMax: 512 },
  { src: 'Meshy_AI_skyscraper_mid_2f_cubic_20261124_texture.glb', dst: 'skyscraper_mid_2f.glb', baseMax: 1024, mrMax: 512 },
  { src: 'Meshy_AI_skyscraper_roof_cubic_20261124_texture.glb', dst: 'skyscraper_roof.glb', baseMax: 1024, mrMax: 512 },
  { src: 'elevator_wall_14k.glb', dst: 'elevator_wall_14k.glb', baseMax: 1024, mrMax: 512 },
  { src: 'tripod_turnstile_14k.glb', dst: 'tripod_turnstile_14k.glb', baseMax: 1024, mrMax: 512 },
  { src: 'reception_desk_14k.glb', dst: 'reception_desk_14k.glb', baseMax: 1024, mrMax: 512 },
];

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

function decodeRgba(bytes, mime) {
  if (mime === 'image/png') {
    const p = PNG.sync.read(Buffer.from(bytes));
    return { width: p.width, height: p.height, data: new Uint8Array(p.data) };
  }
  const j = jpeg.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true });
  return { width: j.width, height: j.height, data: new Uint8Array(j.data) };
}

/** Area-averaged RGBA downsample so 4096/2048 -> 1024/512 stays crisp without aliasing. */
function resizeRgba(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const dst = new Uint8Array(dw * dh * 4);
  const scaleX = sw / dw;
  const scaleY = sh / dh;
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * scaleY);
    const sy1 = Math.max(sy0 + 1, Math.min(sh, Math.ceil((y + 1) * scaleY)));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * scaleX);
      const sx1 = Math.max(sx0 + 1, Math.min(sw, Math.ceil((x + 1) * scaleX)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * sw + sx) * 4;
          r += src[i];
          g += src[i + 1];
          b += src[i + 2];
          a += src[i + 3];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      dst[o] = Math.round(r / n);
      dst[o + 1] = Math.round(g / n);
      dst[o + 2] = Math.round(b / n);
      dst[o + 3] = Math.round(a / n);
    }
  }
  return dst;
}

function countTris(doc) {
  let tris = 0;
  for (const m of doc.getRoot().listMeshes()) {
    for (const p of m.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      if (pos) tris += (idx ? idx.getCount() : pos.getCount()) / 3;
    }
  }
  return Math.round(tris);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const item of ASSETS) {
  const srcPath = join(DOWNLOADS, item.src);
  if (!existsSync(srcPath)) {
    throw new Error(`Missing source GLB: ${srcPath}`);
  }
  const srcBytes = statSync(srcPath).size;
  const doc = await io.read(srcPath);

  const mrTexSet = new Set();
  for (const mat of doc.getRoot().listMaterials()) {
    const mr = mat.getMetallicRoughnessTexture();
    if (mr) mrTexSet.add(mr);
  }

  for (const tex of doc.getRoot().listTextures()) {
    const raw = tex.getImage();
    if (!raw) continue;
    const isMR = mrTexSet.has(tex) || /metallic|roughness/i.test(tex.getName());
    const maxDim = isMR ? item.mrMax : item.baseMax;
    const decoded = decodeRgba(raw, tex.getMimeType());
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
    const tw = Math.max(1, Math.round(decoded.width * scale));
    const th = Math.max(1, Math.round(decoded.height * scale));
    const resized = resizeRgba(decoded.data, decoded.width, decoded.height, tw, th);
    const enc = jpeg.encode({ data: resized, width: tw, height: th }, isMR ? 80 : 84);
    tex.setImage(new Uint8Array(enc.data));
    tex.setMimeType('image/jpeg');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|webp)$/i, '.jpg'));
  }

  await doc.transform(
    dedup(),
    weld(),
    prune(),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  const dstPath = join(OUT_DIR, item.dst);
  await io.write(dstPath, doc);
  const dstBytes = statSync(dstPath).size;
  const texSummary = doc.getRoot().listTextures().map((t) => `${t.getSize()?.join('x') ?? '?'} (${Math.round((t.getImage()?.byteLength ?? 0) / 1024)}KB)`).join(', ');
  console.log(
    `${item.dst}: ${(srcBytes / 1048576).toFixed(2)} MB -> ${(dstBytes / 1048576).toFixed(2)} MB | ${countTris(doc)} tris | [${texSummary}]`,
  );
  if (dstBytes > 1.6 * 1048576) {
    throw new Error(`${item.dst} exceeded 1.6 MB target (${(dstBytes / 1048576).toFixed(2)} MB)`);
  }
}
