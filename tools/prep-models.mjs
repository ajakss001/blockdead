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
 * triangles wound the way their normals face (sources are double-sided, the game culls back faces);
 * simplified to its triangle budget with every border locked and a small error (meshoptimizer: no
 * tears, no holes — a model may stay over budget rather than break); wheels are never simplified;
 * glass panes kept apart (drawn as the game's translucent car glass, 1.5 cm off the body).
 *
 * The game draws these merged into its chunk meshes with the world material (no extra draw calls).
 * Usage: npm run prep-models
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const ATLAS_COLS = 10;
const SWATCH = 16;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;

// ── Geometry ────────────────────────────────────────────────────────────────

/** Inverse of the upper 3×3 by rows (applied by columns it is the normal matrix: inverse-transpose). */
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

/** Wheels by node or material name (Turkish "teker" too), never the steering wheel. */
const WHEEL = /wheel|tire|tyre|rim|teker/i;
const GLASS = /glass|window|transp/i;

/** Triangle primitives under the scene (or one named node), in world space. */
function collect(doc, only) {
  const parts = [];
  const walk = (node, parent, inside, wheel) => {
    const m = mat4.mul(parent, node.getMatrix());
    const name = node.getName();
    const isWheel = wheel || (WHEEL.test(name) && !/steer/i.test(name));
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
            // n holds the inverse by rows: its transpose (the normal matrix) is it by columns.
            const x = n[0] * v[0] + n[3] * v[1] + n[6] * v[2];
            const y = n[1] * v[0] + n[4] * v[1] + n[7] * v[2];
            const z = n[2] * v[0] + n[5] * v[1] + n[8] * v[2];
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
        const mat = p.getMaterial();
        // Baked fake shadows (a black quad under the car) are not part of the model.
        if (mat && /shadow/i.test(mat.getName())) continue;
        const glass = !!mat && mat.getAlphaMode() === 'BLEND' && mat.getBaseColorFactor()[3] < 0.9 && GLASS.test(mat.getName());
        parts.push({ pos, nrm, uv, col, idx, mat, hasNormals: !!N, wheel: isWheel || (!!mat && WHEEL.test(mat.getName())), glass });
      }
    }
    for (const c of node.listChildren()) walk(c, m, take && (inside || !!only), isWheel);
  };
  for (const s of doc.getRoot().listScenes()) for (const n of s.listChildren()) walk(n, mat4.id(), false, false);
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

/** Length along +X (or keep orientation with noTurn), real size, standing on y = 0, centered. */
function normalize(parts, cfg) {
  let b = bounds(parts);
  const turn = !cfg.noTurn && b.max[2] - b.min[2] > b.max[0] - b.min[0];
  const rot = (arr) => {
    for (let k = 0; k < arr.length; k += 3) {
      let x = arr[k];
      let y = arr[k + 1];
      let z = arr[k + 2];
      if (cfg.standUp) [x, y, z] = [z, x, y];
      if (cfg.layFlat) [x, y, z] = [x, -z, y];
      if (turn) [x, z] = [z, -x];
      if (cfg.flip) [x, z] = [-x, -z];
      arr[k] = x;
      arr[k + 1] = y;
      arr[k + 2] = z;
    }
  };
  for (const p of parts) {
    rot(p.pos);
    rot(p.nrm);
  }
  b = bounds(parts);
  const s = cfg.length
    ? cfg.length / Math.max(1e-4, b.max[0] - b.min[0])
    : cfg.width
      ? cfg.width / Math.max(1e-4, b.max[0] - b.min[0])
      : cfg.height
        ? cfg.height / Math.max(1e-4, b.max[1] - b.min[1])
        : cfg.depth
          ? cfg.depth / Math.max(1e-4, b.max[2] - b.min[2])
          : 1;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  for (const p of parts) for (let k = 0; k < p.pos.length; k += 3) {
    p.pos[k] = (p.pos[k] - cx) * s;
    p.pos[k + 1] = (p.pos[k + 1] - b.min[1]) * s;
    p.pos[k + 2] = (p.pos[k + 2] - cz) * s;
  }
  return bounds(parts);
}

/**
 * Wind every triangle the way its vertex normals face (the sources are double-sided, so their
 * winding is arbitrary; the game culls back faces — a wrong winding is a hole). Without normals:
 * facing away from the model's middle. Where winding and normals disagree the source cannot be
 * trusted either way (normals turned inwards on some panels): such a face is kept from both sides,
 * each copy with normals along its own facing.
 */
function orient(parts, b) {
  const mid = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  let flipped = 0;
  for (const p of parts) {
    const P = p.pos;
    const extra = [];
    for (let k = 0; k < p.idx.length; k += 3) {
      const [i, j, l] = [p.idx[k], p.idx[k + 1], p.idx[k + 2]];
      const e1 = [P[j * 3] - P[i * 3], P[j * 3 + 1] - P[i * 3 + 1], P[j * 3 + 2] - P[i * 3 + 2]];
      const e2 = [P[l * 3] - P[i * 3], P[l * 3 + 1] - P[i * 3 + 1], P[l * 3 + 2] - P[i * 3 + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let want;
      if (p.hasNormals) want = [0, 1, 2].map((a) => p.nrm[i * 3 + a] + p.nrm[j * 3 + a] + p.nrm[l * 3 + a]);
      else want = [0, 1, 2].map((a) => (P[i * 3 + a] + P[j * 3 + a] + P[l * 3 + a]) / 3 - mid[a]);
      if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
        p.idx[k + 1] = l;
        p.idx[k + 2] = j;
        flipped++;
        if (p.hasNormals) extra.push(i, j, l);
      }
    }
    if (extra.length === 0) continue;
    // The other side: its own vertices, normals reversed.
    const base = p.pos.length / 3;
    const n = extra.length;
    const grow = (arr, w) => {
      const out = new Float32Array(arr.length + n * w);
      out.set(arr);
      extra.forEach((v, e) => {
        for (let a = 0; a < w; a++) out[(base + e) * w + a] = arr[v * w + a];
      });
      return out;
    };
    p.pos = grow(p.pos, 3);
    p.nrm = grow(p.nrm, 3);
    p.uv = grow(p.uv, 2);
    p.col = grow(p.col, 3);
    for (let e = 0; e < n * 3; e++) p.nrm[base * 3 + e] = -p.nrm[base * 3 + e];
    const idx = new Uint32Array(p.idx.length + n);
    idx.set(p.idx);
    for (let e = 0; e < n; e++) idx[p.idx.length + e] = base + e;
    p.idx = idx;
  }
  return flipped;
}

/**
 * Simplify the body parts (not wheels, not glass) by one ratio to fit the budget. Every border locked
 * (material borders, UV seams, open edges: nothing can tear), normals and UVs weighted, the error kept
 * small; if that cannot reach the budget the model stays over it — up to 1.5× — before the error grows
 * a little, never past 2.5 % of its size.
 */
function simplify(parts, budget) {
  const tris = (list) => list.reduce((s, p) => s + p.idx.length / 3, 0);
  const glass = tris(parts.filter((p) => p.glass));
  const wheels = parts.filter((p) => p.wheel && !p.glass);
  const body = parts.filter((p) => !p.wheel && !p.glass);
  if (tris(wheels) + tris(body) + glass <= budget) return 0;
  // Wheels on their own (never merged into the body's pass): at most a quarter of the budget.
  const wheelBudget = Math.min(tris(wheels), budget * 0.25);
  return Math.max(reduce(wheels, wheelBudget / Math.max(1, tris(wheels))), reduce(body, Math.max(0.05, (budget - wheelBudget - glass) / Math.max(1, tris(body)))));
}

/** One ratio over a set of parts; returns the worst error. */
function reduce(list, ratio) {
  let worst = 0;
  if (ratio >= 1) return 0;
  for (const p of list) {
    const target = Math.max(3, Math.floor((p.idx.length * ratio) / 3) * 3);
    if (target >= p.idx.length) continue;
    const n = p.pos.length / 3;
    const attrs = new Float32Array(n * 5);
    for (let k = 0; k < n; k++) attrs.set([p.nrm[k * 3], p.nrm[k * 3 + 1], p.nrm[k * 3 + 2], p.uv[k * 2], p.uv[k * 2 + 1]], k * 5);
    let best = null;
    for (const err of [0.008, 0.015, 0.025]) {
      const [idx, e] = MeshoptSimplifier.simplifyWithAttributes(p.idx, p.pos, 3, attrs, 5, [0.5, 0.5, 0.5, 0.2, 0.2], null, target, err, ['LockBorder']);
      best = { idx, e };
      if (idx.length <= target * 1.5) break;
    }
    if (best && best.idx.length >= 3) {
      p.idx = best.idx;
      worst = Math.max(worst, best.e);
    }
  }
  return worst;
}

/**
 * Coplanar faces that overlap flicker in the game (z-fighting): stickers on a panel, doubled shells.
 * Exact duplicates are dropped; otherwise the face of the smaller part (the sticker), or the smaller
 * face, is lifted 5 mm along its normal on vertices of its own.
 */
function separateCoplanar(parts) {
  const EPS = 0.004;
  const tris = [];
  parts.forEach((p, pi) => {
    if (p.glass) return;
    for (let k = 0; k < p.idx.length; k += 3) {
      const v = [0, 1, 2].map((c) => [p.pos[p.idx[k + c] * 3], p.pos[p.idx[k + c] * 3 + 1], p.pos[p.idx[k + c] * 3 + 2]]);
      const e1 = v[1].map((x, a) => x - v[0][a]);
      const e2 = v[2].map((x, a) => x - v[0][a]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const area = Math.hypot(...n) / 2;
      if (area < 1e-6) continue;
      const u = n.map((x) => x / (area * 2));
      tris.push({ pi, k, v, n: u, d: u[0] * v[0][0] + u[1] * v[0][1] + u[2] * v[0][2], area, size: p.idx.length });
    }
  });
  // By plane offset only (direction bins would split nearly equal normals at their edges).
  const key = (t, dd) => Math.round(t.d / EPS) + dd;
  const bins = new Map();
  for (const t of tris) {
    const k = key(t, 0);
    if (!bins.has(k)) bins.set(k, []);
    bins.get(k).push(t);
  }
  const drop = new Set();
  const lift = new Set();
  for (const t of tris) {
    for (const dd of [-1, 0, 1]) {
      for (const o of bins.get(key(t, dd)) ?? []) {
        if (o === t || drop.has(o) || drop.has(t) || lift.has(o) || lift.has(t)) continue;
        if (t.n[0] * o.n[0] + t.n[1] * o.n[1] + t.n[2] * o.n[2] < 0.999) continue;
        // Each corner close to the other's plane (nearly parallel planes can share an offset and be apart).
        if (![[t, o], [o, t]].every(([x, y]) => x.v.every((q) => Math.abs(y.n[0] * q[0] + y.n[1] * q[1] + y.n[2] * q[2] - y.d) <= EPS))) continue;
        if (!overlap2d(t, o)) continue;
        const same = t.v.every((a) => o.v.some((b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.001));
        if (same) drop.add(o);
        else lift.add(o.size < t.size || (o.size === t.size && o.area < t.area) ? o : t);
      }
    }
  }
  for (const t of drop) parts[t.pi].dead = [...(parts[t.pi].dead ?? []), t.k];
  for (const t of lift) {
    const p = parts[t.pi];
    const base = p.pos.length / 3;
    const pos = new Float32Array(p.pos.length + 9);
    pos.set(p.pos);
    const nrm = new Float32Array(p.nrm.length + 9);
    nrm.set(p.nrm);
    const uv = new Float32Array(p.uv.length + 6);
    uv.set(p.uv);
    const col = new Float32Array(p.col.length + 9);
    col.set(p.col);
    for (let c = 0; c < 3; c++) {
      const src = p.idx[t.k + c];
      for (let a = 0; a < 3; a++) {
        pos[(base + c) * 3 + a] = p.pos[src * 3 + a] + t.n[a] * 0.005;
        nrm[(base + c) * 3 + a] = p.nrm[src * 3 + a];
        col[(base + c) * 3 + a] = p.col[src * 3 + a];
      }
      uv[(base + c) * 2] = p.uv[src * 2];
      uv[(base + c) * 2 + 1] = p.uv[src * 2 + 1];
      p.idx[t.k + c] = base + c;
    }
    Object.assign(p, { pos, nrm, uv, col });
  }
  for (const p of parts) {
    if (!p.dead) continue;
    const dead = new Set(p.dead);
    const keep = [];
    for (let k = 0; k < p.idx.length; k += 3) if (!dead.has(k)) keep.push(p.idx[k], p.idx[k + 1], p.idx[k + 2]);
    p.idx = Uint32Array.from(keep);
    delete p.dead;
  }
  return { dropped: drop.size, lifted: lift.size };
}

/** Two coplanar triangles overlap with some area (shrunk 1 mm: sharing an edge is fine). */
function overlap2d(a, b) {
  const n = a.n;
  const ax = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  let U = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
  const l = Math.hypot(...U);
  U = U.map((x) => x / l);
  const V = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
  const flat = (t) => {
    const pts = t.v.map((p) => [p[0] * U[0] + p[1] * U[1] + p[2] * U[2], p[0] * V[0] + p[1] * V[1] + p[2] * V[2]]);
    const c = [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
    return pts.map(([x, y]) => {
      const L = Math.hypot(x - c[0], y - c[1]) || 1;
      const k = Math.max(0, L - 0.001) / L;
      return [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k];
    });
  };
  const A = flat(a);
  const B = flat(b);
  for (const poly of [A, B]) {
    for (let k = 0; k < 3; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % 3];
      const axis = [q[1] - p[1], p[0] - q[0]];
      const pa = A.map((v) => v[0] * axis[0] + v[1] * axis[1]);
      const pb = B.map((v) => v[0] * axis[0] + v[1] * axis[1]);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

/** Glass 1.5 cm off the body, outwards (away from the model's middle along its normal). */
function liftGlass(parts, b) {
  const mid = [(b.min[0] + b.max[0]) / 2, b.max[1] * 0.45, (b.min[2] + b.max[2]) / 2];
  for (const p of parts) {
    if (!p.glass) continue;
    for (let k = 0; k < p.pos.length; k += 3) {
      const n = [p.nrm[k], p.nrm[k + 1], p.nrm[k + 2]];
      const out = [p.pos[k] - mid[0], p.pos[k + 1] - mid[1], p.pos[k + 2] - mid[2]];
      const sgn = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0 ? -1 : 1;
      for (let a = 0; a < 3; a++) p.pos[k + a] += n[a] * sgn * 0.015;
    }
  }
}

// ── Textures ────────────────────────────────────────────────────────────────

function decode(texture) {
  if (!texture) return null;
  const data = texture.getImage();
  const mime = texture.getMimeType();
  try {
    if (mime === 'image/png') {
      let buf = Buffer.from(data);
      const iend = buf.indexOf(Buffer.from('49454e44ae426082', 'hex'));
      if (iend >= 0) buf = buf.subarray(0, iend + 8);
      const png = PNG.sync.read(buf);
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

let prevBin = null;
let prevAtlas = null;
let prevAtlasCols = 1;
let prevAtlasW = ATLAS;
const prevByName = new Map();
if (existsSync(join(OUT, 'models.json')) && existsSync(join(OUT, 'models.bin')) && existsSync(join(OUT, 'atlas.jpg'))) {
  const prevJson = JSON.parse(readFileSync(join(OUT, 'models.json'), 'utf8'));
  prevBin = readFileSync(join(OUT, 'models.bin'));
  const prevImg = jpeg.decode(readFileSync(join(OUT, 'atlas.jpg')), { useTArray: true, formatAsRGBA: true });
  prevAtlas = prevImg.data;
  prevAtlasW = prevImg.width;
  prevAtlasCols = prevJson.atlasCols ?? Math.max(1, Math.round(prevImg.width / ATLAS));
  for (const m of prevJson.models ?? []) prevByName.set(m.name, m);
}

for (const cfg of MODELS) {
  const file = join(IN, cfg.src, cfg.file ?? 'model.glb');
  if (!existsSync(file)) {
    const prev = prevByName.get(cfg.name);
    if (!prev || !prevBin || !prevAtlas) {
      throw new Error(`Missing source ${file} and no pre-baked entry for ${cfg.name}`);
    }
    const vLen = prev.vertices * STRIDE;
    const iLen = prev.indices * 2 + (prev.indices % 2 ? 2 : 0);
    const vbuf = prevBin.subarray(prev.vOffset, prev.vOffset + vLen);
    const ibuf = prevBin.subarray(prev.iOffset, prev.iOffset + iLen);
    const layer = new Uint8Array(ATLAS * ATLAS * 4);
    const sc = prev.layer % prevAtlasCols;
    const sr = Math.floor(prev.layer / prevAtlasCols);
    for (let y = 0; y < ATLAS; y++) {
      const srcOff = ((sr * ATLAS + y) * prevAtlasW + sc * ATLAS) * 4;
      layer.set(prevAtlas.subarray(srcOff, srcOff + ATLAS * 4), y * ATLAS * 4);
    }
    const vOffset = offset;
    chunks.push(vbuf);
    offset += vbuf.length;
    const iOffset = offset;
    chunks.push(ibuf);
    offset += ibuf.length;
    layers.push(layer);
    index.push({
      ...prev,
      layer: layers.length - 1,
      vOffset,
      iOffset,
    });
    console.log(`${cfg.name.padEnd(18)} preserved from existing public/models/`);
    continue;
  }
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
  const b0 = normalize(parts, cfg);
  const flipped = orient(parts, b0);
  const before = parts.reduce((n, p) => n + p.idx.length / 3, 0);
  const err = simplify(parts, cfg.budget);
  liftGlass(parts, b0);
  // Until nothing overlaps (a lifted sticker may meet another one).
  const sep = { dropped: 0, lifted: 0 };
  for (let pass = 0; pass < 12; pass++) {
    const r = separateCoplanar(parts);
    sep.dropped += r.dropped;
    sep.lifted += r.lifted;
    if (r.dropped + r.lifted === 0) break;
  }
  // Bounds again: lifted glass and stickers may stand a few millimetres proud of the box.
  const b = bounds(parts);
  // Glass last: the game draws the tail of the index buffer as translucent car glass.
  parts.sort((x, y) => Number(x.glass) - Number(y.glass));
  const { atlas, textured, flats } = bakeAtlas(parts);
  if (cfg.postApoc) {
    // Subtle desaturation + darkening so bright AI-generated props blend naturally with the night/fog palette.
    for (let o = 0; o < atlas.length; o += 4) {
      const r = atlas[o], g = atlas[o + 1], bl = atlas[o + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
      atlas[o] = Math.min(255, Math.round((lum + (r - lum) * 0.78) * 0.86));
      atlas[o + 1] = Math.min(255, Math.round((lum + (g - lum) * 0.78) * 0.86));
      atlas[o + 2] = Math.min(255, Math.round((lum + (bl - lum) * 0.78) * 0.86));
    }
  }
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
  let glassIndices = 0;
  for (const p of parts) {
    const used = new Int32Array(p.pos.length / 3).fill(-1);
    let n = 0;
    for (const i of p.idx) if (used[i] < 0) used[i] = n++;
    p.remap = used;
    p.used = n;
    vCount += n;
    iCount += p.idx.length;
    if (p.glass) glassIndices += p.idx.length;
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
    glass: glassIndices,
    vOffset,
    iOffset,
    normals: parts.every((p) => p.hasNormals),
    title: meta.title ?? cfg.src,
    author: (meta.author ?? '').replace(/\s*\(.*\)$/, ''),
    license: (meta.license ?? '').replace(/\s*\(.*\)$/, ''),
    url: meta.source ?? '',
  });
  console.log(`${cfg.name.padEnd(18)} ${String(before).padStart(6)} → ${String(Math.round(tris)).padStart(5)} tris (glass ${glassIndices / 3}, error ${(err * 100).toFixed(1)}%, flipped ${flipped}, coplanar: dropped ${sep.dropped}, lifted ${sep.lifted})  ${size.map((v) => v.toFixed(2)).join(' × ')} m  textures ${textured}, colors ${flats}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'models.bin'), Buffer.concat(chunks));
writeFileSync(join(OUT, 'models.json'), JSON.stringify({ stride: STRIDE, atlas: ATLAS, atlasCols: ATLAS_COLS, models: index }, null, 1));
// Atlas layers packed into a 2D grid (stays well under mobile 4096 px texture limits).
const atlasRows = Math.ceil(layers.length / ATLAS_COLS);
const atlasW = ATLAS_COLS * ATLAS;
const atlasH = atlasRows * ATLAS;
const grid = new Uint8Array(atlasW * atlasH * 4).fill(255);
for (let l = 0; l < layers.length; l++) {
  const dc = l % ATLAS_COLS;
  const dr = Math.floor(l / ATLAS_COLS);
  const src = layers[l];
  for (let y = 0; y < ATLAS; y++) {
    grid.set(src.subarray(y * ATLAS * 4, (y + 1) * ATLAS * 4), ((dr * ATLAS + y) * atlasW + dc * ATLAS) * 4);
  }
}
writeFileSync(join(OUT, 'atlas.jpg'), jpeg.encode({ data: grid, width: atlasW, height: atlasH }, 88).data);
console.log(`\n${index.length} models, geometry ${(offset / 1024).toFixed(0)} KB → public/models/`);
