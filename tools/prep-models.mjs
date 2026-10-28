#!/usr/bin/env node
/**
 * Downloaded models (assets/incoming/<code>/model.glb, listed in tools/models.config.mjs) → the game's
 * model library in public/models:
 *
 *   models.json  index: name, group, sizes, offsets, triangle count, author / license / link (credits)
 *   models.bin   all geometry, quantized (20 bytes a vertex, 16-bit indices)
 *   atlas.jpg    one 256×256 texture layer per model, stacked vertically
 *
 * Per model: the node tree flattened into world space; turned so its length runs along +X (nose +X,
 * as the game's cars), standing on y = 0, centered, scaled to its real size; every material baked
 * into the model's single atlas layer (textures into cells, plain colors into small swatches);
 * simplified to its triangle budget (meshoptimizer, material borders kept).
 *
 * The game draws these merged into its chunk meshes with the world material (no extra draw calls).
 * Usage: npm run prep-models
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import jpeg from 'jpeg-js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { PNG } from 'pngjs';
import { mat4 } from './mat.mjs';
import { MODELS } from './models.config.mjs';

const ROOT = process.cwd();
const IN = join(ROOT, 'assets', 'incoming');
const OUT = join(ROOT, 'public', 'models');
const ATLAS = 256;
const SWATCH = 16;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

// ── Geometry ────────────────────────────────────────────────────────────────

/** Inverse-transpose of the upper 3×3 (for normals), column-major. */
function normalMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  // Rows of the inverse = columns of its transpose.
  return {
    det,
    n: [A * inv, B * inv, C * inv, -(b * i - c * h) * inv, (a * i - c * g) * inv, -(a * h - b * g) * inv, (b * f - c * e) * inv, -(a * f - c * d) * inv, (a * e - b * d) * inv],
  };
}

/** Triangle primitives under the scene (or one named node), in world space. */
function collect(doc, only) {
  const parts = [];
  const walk = (node, parent, inside) => {
    const m = mat4.mul(parent, node.getMatrix());
    const take = inside || !only || node.getName() === only;
    const mesh = node.getMesh();
    if (take && mesh) {
      const { det, n } = normalMatrix(m);
      for (const p of mesh.listPrimitives()) {
        if (p.getMode() !== 4) continue;
        const P = p.getAttribute('POSITION');
        const N = p.getAttribute('NORMAL');
        const T = p.getAttribute('TEXCOORD_0');
        const C = p.getAttribute('COLOR_0');
        const count = P.getCount();
        const pos = new Float32Array(count * 3);
        const nrm = new Float32Array(count * 3);
        const uv = new Float32Array(count * 2);
        const col = new Float32Array(count * 3).fill(1);
        const v = [0, 0, 0, 0];
        for (let k = 0; k < count; k++) {
          P.getElement(k, v);
          pos[k * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          pos[k * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          pos[k * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
          if (N) {
            N.getElement(k, v);
            const x = n[0] * v[0] + n[1] * v[1] + n[2] * v[2];
            const y = n[3] * v[0] + n[4] * v[1] + n[5] * v[2];
            const z = n[6] * v[0] + n[7] * v[1] + n[8] * v[2];
            const l = Math.hypot(x, y, z) || 1;
            nrm.set([x / l, y / l, z / l], k * 3);
          }
          if (T) {
            T.getElement(k, v);
            uv[k * 2] = v[0];
            uv[k * 2 + 1] = v[1];
          }
          if (C) {
            C.getElement(k, v);
            col.set([v[0], v[1], v[2]], k * 3);
          }
        }
        const I = p.getIndices();
        let idx = I ? Uint32Array.from(I.getArray()) : Uint32Array.from({ length: count }, (_, k) => k);
        // A mirrored node turns triangles inside out.
        if (det < 0) for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
        parts.push({ pos, nrm, uv, col, idx, mat: p.getMaterial(), hasNormals: !!N });
      }
    }
    for (const c of node.listChildren()) walk(c, m, take && (inside || !!only));
  };
  for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) walk(n, mat4.id(), false);
  return parts;
}

function bounds(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let k = 0; k < p.pos.length; k += 3) for (let a = 0; a < 3; a++) {
    min[a] = Math.min(min[a], p.pos[k + a]);
    max[a] = Math.max(max[a], p.pos[k + a]);
  }
  return { min, max };
}

/** Length along +X, flip if asked, real size, standing on y = 0, centered. */
function normalize(parts, cfg) {
  let b = bounds(parts);
  const turn = b.max[2] - b.min[2] > b.max[0] - b.min[0];
  const rot = (arr) => {
    for (let k = 0; k < arr.length; k += 3) {
      let x = arr[k];
      let z = arr[k + 2];
      if (turn) [x, z] = [z, -x];
      if (cfg.flip) [x, z] = [-x, -z];
      arr[k] = x;
      arr[k + 2] = z;
    }
  };
  for (const p of parts) {
    rot(p.pos);
    rot(p.nrm);
  }
  b = bounds(parts);
  const s = cfg.length ? cfg.length / (b.max[0] - b.min[0]) : 1;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  for (const p of parts) for (let k = 0; k < p.pos.length; k += 3) {
    p.pos[k] = (p.pos[k] - cx) * s;
    p.pos[k + 1] = (p.pos[k + 1] - b.min[1]) * s;
    p.pos[k + 2] = (p.pos[k + 2] - cz) * s;
  }
  return bounds(parts);
}

/** Simplify every material part by the same ratio to fit the budget (borders between parts stay). */
function simplify(parts, budget) {
  const total = parts.reduce((s, p) => s + p.idx.length / 3, 0);
  if (total <= budget) return;
  const ratio = budget / total;
  for (const p of parts) {
    const target = Math.max(3, Math.floor((p.idx.length * ratio) / 3) * 3);
    if (target >= p.idx.length) continue;
    // Keep the borders between materials if that reaches the target; otherwise let them move.
    let [idx] = MeshoptSimplifier.simplify(p.idx, p.pos, 3, target, 0.5, ['LockBorder']);
    if (idx.length > target * 1.3) [idx] = MeshoptSimplifier.simplify(p.idx, p.pos, 3, target, 0.5);
    if (idx.length >= 3) p.idx = idx;
  }
}

// ── Textures ────────────────────────────────────────────────────────────────

function decode(texture) {
  if (!texture) return null;
  const data = texture.getImage();
  const mime = texture.getMimeType();
  try {
    if (mime === 'image/png') {
      const png = PNG.sync.read(Buffer.from(data));
      return { w: png.width, h: png.height, px: png.data };
    }
    if (mime === 'image/jpeg') {
      const j = jpeg.decode(Buffer.from(data), { useTArray: true, formatAsRGBA: true });
      return { w: j.width, h: j.height, px: j.data };
    }
  } catch (e) {
    console.warn(`  texture (${mime}) not decoded: ${e.message}`);
  }
  return null;
}

/** Bilinear sample, wrapping, 0..1 coordinates (v down, image space). */
function sample(img, u, v, out) {
  const x = (((u % 1) + 1) % 1) * img.w - 0.5;
  const y = (((v % 1) + 1) % 1) * img.h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  for (let c = 0; c < 4; c++) {
    const at = (xx, yy) => img.px[(((yy + img.h) % img.h) * img.w + ((xx + img.w) % img.w)) * 4 + c];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    out[c] = a + (b - a) * fy;
  }
  return out;
}

/** Bake the model's materials into one ATLAS×ATLAS RGBA layer; remap the parts' UVs into it. */
function bakeAtlas(parts) {
  const atlas = new Uint8Array(ATLAS * ATLAS * 4).fill(255);
  const mats = [...new Set(parts.map((p) => p.mat))];
  const info = mats.map((mat) => {
    const factor = mat ? mat.getBaseColorFactor() : [0.8, 0.8, 0.8, 1];
    const img = mat ? decode(mat.getBaseColorTexture()) : null;
    let minU = Infinity;
    let minV = Infinity;
    let maxU = -Infinity;
    let maxV = -Infinity;
    for (const p of parts) if (p.mat === mat) for (let k = 0; k < p.uv.length; k += 2) {
      minU = Math.min(minU, p.uv[k]);
      maxU = Math.max(maxU, p.uv[k]);
      minV = Math.min(minV, p.uv[k + 1]);
      maxV = Math.max(maxV, p.uv[k + 1]);
    }
    // A texture that tiles more than once cannot live in one cell: its average color instead.
    const fits = img && maxU - Math.floor(minU) <= 1.02 && maxV - Math.floor(minV) <= 1.02;
    let avg = [factor[0] * 255, factor[1] * 255, factor[2] * 255];
    if (img) {
      const s = [0, 0, 0];
      const step = Math.max(1, Math.floor((img.w * img.h) / 4096));
      let n = 0;
      for (let i = 0; i < img.w * img.h; i += step, n++) for (let c = 0; c < 3; c++) s[c] += img.px[i * 4 + c];
      avg = avg.map((v, c) => (v * s[c]) / n / 255);
    }
    return { mat, factor, img: fits ? img : null, avg, offU: Math.floor(minU), offV: Math.floor(minV) };
  });
  const textured = info.filter((m) => m.img);
  const flats = info.filter((m) => !m.img);
  const perRow = ATLAS / SWATCH;
  const flatH = Math.ceil(flats.length / perRow) * SWATCH;
  const g = Math.max(1, Math.ceil(Math.sqrt(textured.length)));
  const cw = Math.floor(ATLAS / g);
  const ch = Math.floor((ATLAS - flatH) / g);
  const px = [0, 0, 0, 0];
  textured.forEach((m, i) => {
    m.cell = { x: (i % g) * cw, y: Math.floor(i / g) * ch, w: cw, h: ch };
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      sample(m.img, (x + 0.5) / cw, (y + 0.5) / ch, px);
      const o = ((m.cell.y + y) * ATLAS + m.cell.x + x) * 4;
      atlas[o] = Math.min(255, px[0] * m.factor[0]);
      atlas[o + 1] = Math.min(255, px[1] * m.factor[1]);
      atlas[o + 2] = Math.min(255, px[2] * m.factor[2]);
      atlas[o + 3] = 255;
    }
  });
  flats.forEach((m, i) => {
    m.cell = { x: (i % perRow) * SWATCH, y: ATLAS - flatH + Math.floor(i / perRow) * SWATCH, w: SWATCH, h: SWATCH, flat: true };
    for (let y = 0; y < SWATCH; y++) for (let x = 0; x < SWATCH; x++) {
      const o = ((m.cell.y + y) * ATLAS + m.cell.x + x) * 4;
      atlas.set([m.avg[0], m.avg[1], m.avg[2], 255], o);
    }
  });
  // UVs into the cells (GL v: 0 at the bottom of the layer).
  for (const p of parts) {
    const m = info.find((i) => i.mat === p.mat);
    const c = m.cell;
    for (let k = 0; k < p.uv.length; k += 2) {
      let x;
      let y;
      if (c.flat) {
        x = c.x + SWATCH / 2;
        y = c.y + SWATCH / 2;
      } else {
        const fu = Math.min(1, Math.max(0, p.uv[k] - m.offU));
        const fv = Math.min(1, Math.max(0, p.uv[k + 1] - m.offV));
        x = c.x + 0.5 + fu * (c.w - 1);
        y = c.y + 0.5 + fv * (c.h - 1);
      }
      p.uv[k] = x / ATLAS;
      p.uv[k + 1] = 1 - y / ATLAS;
    }
  }
  return { atlas, textured: textured.length, flats: flats.length };
}

// ── Output ──────────────────────────────────────────────────────────────────

const STRIDE = 20;
const chunks = [];
let offset = 0;
const index = [];
const layers = [];
const docs = new Map();

for (const cfg of MODELS) {
  const file = join(IN, cfg.src, 'model.glb');
  let doc = docs.get(file);
  if (!doc) {
    doc = await io.read(file);
    docs.set(file, doc);
  }
  const meta = doc.getRoot().getAsset().extras ?? {};
  const parts = collect(doc, cfg.node);
  if (parts.length === 0) {
    console.warn(`${cfg.name}: nothing under ${cfg.node ?? 'the scene'}, skipped`);
    continue;
  }
  const b = normalize(parts, cfg);
  simplify(parts, cfg.budget);
  const { atlas, textured, flats } = bakeAtlas(parts);
  if (cfg.recolor) {
    // Strong reds (red-cross emblems, red splashes) into the given color, keeping their shading.
    for (let o = 0; o < atlas.length; o += 4) {
      const [r, g, bl] = [atlas[o], atlas[o + 1], atlas[o + 2]];
      if (r > 120 && g < r * 0.55 && bl < r * 0.55) {
        const k = 0.55 + r / 255;
        for (let c = 0; c < 3; c++) atlas[o + c] = Math.min(255, cfg.recolor[c] * k);
      }
    }
  }
  // Merge parts, drop unused vertices.
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    const used = new Int32Array(p.pos.length / 3).fill(-1);
    let n = 0;
    for (const i of p.idx) if (used[i] < 0) used[i] = n++;
    p.remap = used;
    p.used = n;
    vCount += n;
    iCount += p.idx.length;
  }
  if (vCount > 65535) throw new Error(`${cfg.name}: ${vCount} vertices > 65535`);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const vbuf = Buffer.alloc(vCount * STRIDE);
  const ibuf = Buffer.alloc(iCount * 2 + (iCount % 2 ? 2 : 0));
  let vBase = 0;
  let ii = 0;
  for (const p of parts) {
    for (let k = 0; k < p.remap.length; k++) {
      const r = p.remap[k];
      if (r < 0) continue;
      const o = (vBase + r) * STRIDE;
      for (let a = 0; a < 3; a++) vbuf.writeUInt16LE(Math.round(((p.pos[k * 3 + a] - b.min[a]) / (size[a] || 1)) * 65535), o + a * 2);
      for (let a = 0; a < 3; a++) vbuf.writeInt8(Math.round(Math.max(-1, Math.min(1, p.nrm[k * 3 + a])) * 127), o + 8 + a);
      vbuf.writeUInt16LE(Math.round(Math.min(1, Math.max(0, p.uv[k * 2])) * 65535), o + 12);
      vbuf.writeUInt16LE(Math.round(Math.min(1, Math.max(0, p.uv[k * 2 + 1])) * 65535), o + 14);
      for (let a = 0; a < 3; a++) vbuf.writeUInt8(Math.round(Math.min(1, Math.max(0, p.col[k * 3 + a])) * 255), o + 16 + a);
    }
    for (const i of p.idx) ibuf.writeUInt16LE(vBase + p.remap[i], (ii++) * 2);
    vBase += p.used;
  }
  const vOffset = offset;
  chunks.push(vbuf);
  offset += vbuf.length;
  const iOffset = offset;
  chunks.push(ibuf);
  offset += ibuf.length;
  layers.push(atlas);
  const tris = iCount / 3;
  index.push({
    name: cfg.name,
    group: cfg.group,
    tint: !!cfg.tint,
    layer: layers.length - 1,
    min: b.min.map((v) => +v.toFixed(4)),
    size: size.map((v) => +v.toFixed(4)),
    vertices: vCount,
    indices: iCount,
    vOffset,
    iOffset,
    normals: parts.every((p) => p.hasNormals),
    title: meta.title ?? cfg.src,
    author: (meta.author ?? '').replace(/\s*\(.*\)$/, ''),
    license: (meta.license ?? '').replace(/\s*\(.*\)$/, ''),
    url: meta.source ?? '',
  });
  console.log(`${cfg.name.padEnd(18)} ${String(Math.round(tris)).padStart(5)} tris  ${size.map((v) => v.toFixed(2)).join(' × ')} m  textures ${textured}, colors ${flats}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'models.bin'), Buffer.concat(chunks));
writeFileSync(join(OUT, 'models.json'), JSON.stringify({ stride: STRIDE, atlas: ATLAS, models: index }, null, 1));
// Atlas layers stacked top to bottom in one JPEG.
const strip = Buffer.concat(layers.map((l) => Buffer.from(l)));
writeFileSync(join(OUT, 'atlas.jpg'), jpeg.encode({ data: strip, width: ATLAS, height: ATLAS * layers.length }, 88).data);
console.log(`\n${index.length} models, geometry ${(offset / 1024).toFixed(0)} KB → public/models/`);
