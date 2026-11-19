import { SURFACE_LIST, MODEL_LAYER_BASE } from '../render/look/surfaces';
import type { SurfaceBuffers } from '../render/StaticBatch';
import { buildChunk, buildInterior } from '../world/gen/buildChunk';
import { sceneAt } from '../world/gen/chaos';
import { DOWNTOWN_RADIUS, WorldLayout } from '../world/gen/layout';
import { nearestPoi, POI, type PoiKind } from '../world/gen/poi';
import type { ModelLibrary } from '../world/models';
import { setModelLibrary } from '../world/props/car';

/**
 * npm run test:zfight — flicker hunt over generated chunks (downtown, town, every POI type, big street
 * scenes with cars, buses and models) and high-rise interiors: two surfaces facing the same way that lie
 * within 3 mm of each other and overlap fight for the same pixels (worse on phones' depth buffers).
 * Translucent glass is drawn from both sides, so for it the facing does not matter. Not counted: faces
 * buried against another solid (a coplanar opaque face turned the other way covers them: a shelf on a
 * floor, a wall into a wall), and translucent against translucent (no depth writes, they just blend).
 */
const PLANE_EPS = 0.003;
const SHRINK = 0.002;

interface Tri {
  n: [number, number, number];
  d: number;
  p: number[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  layer: number;
  glass: boolean;
  buried?: boolean;
}

function layerName(l: number): string {
  return l >= MODEL_LAYER_BASE - 0.5 ? `model#${Math.round(l - MODEL_LAYER_BASE)}` : SURFACE_LIST[Math.round(l)] ?? `layer${l}`;
}

export function __tris(surfaces: SurfaceBuffers[]): Tri[] {
  const out: Tri[] = [];
  for (const s of surfaces) {
    const P = s.position;
    const I = s.index;
    for (let t = 0; t + 2 < I.length; t += 3) {
      const i0 = I[t];
      const i1 = I[t + 1];
      const i2 = I[t + 2];
      const p0 = i0 * 3;
      const p1 = i1 * 3;
      const p2 = i2 * 3;
      const e1 = [P[p1] - P[p0], P[p1 + 1] - P[p0 + 1], P[p1 + 2] - P[p0 + 2]];
      const e2 = [P[p2] - P[p0], P[p2 + 1] - P[p0 + 1], P[p2 + 2] - P[p0 + 2]];
      let n: [number, number, number] = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const len = Math.hypot(...n);
      // Slivers (under 1 cm², or thinner than 1 cm) cannot show a fight, and their normals are noise.
      if (len < 2e-4) continue;
      const longest = Math.max(Math.hypot(e1[0], e1[1], e1[2]), Math.hypot(e2[0], e2[1], e2[2]), Math.hypot(e2[0] - e1[0], e2[1] - e1[1], e2[2] - e1[2]));
      if (len / longest < 0.01) continue;
      n = [n[0] / len, n[1] / len, n[2] / len];
      const x0 = P[p0], y0 = P[p0 + 1], z0 = P[p0 + 2];
      const x1 = P[p1], y1 = P[p1 + 1], z1 = P[p1 + 2];
      const x2 = P[p2], y2 = P[p2 + 1], z2 = P[p2 + 2];
      out.push({
        n,
        d: n[0] * x0 + n[1] * y0 + n[2] * z0,
        p: [x0, y0, z0, x1, y1, z1, x2, y2, z2],
        minX: Math.min(x0, x1, x2),
        maxX: Math.max(x0, x1, x2),
        minY: Math.min(y0, y1, y2),
        maxY: Math.max(y0, y1, y2),
        minZ: Math.min(z0, z1, z2),
        maxZ: Math.max(z0, z1, z2),
        layer: s.layer[i0],
        glass: s.bucket === 'glass',
      });
    }
  }
  return out;
}

/** Every corner of each within PLANE_EPS of the other's plane (nearly parallel planes far from the origin can share an offset and still be apart). */
function near(a: Tri, b: Tri): boolean {
  for (const [x, y] of [[a, b], [b, a]]) {
    for (let k = 0; k < 3; k++) {
      if (Math.abs(y.n[0] * x.p[k * 3] + y.n[1] * x.p[k * 3 + 1] + y.n[2] * x.p[k * 3 + 2] - y.d) > PLANE_EPS) return false;
    }
  }
  return true;
}

/** 2D overlap with positive area (triangles shrunk a little toward their middles: touching is fine). */
function overlap(a: Tri, b: Tri): boolean {
  const n = a.n;
  const ax = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
  const ul = Math.hypot(...u);
  const U = u.map((v) => v / ul);
  const V = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
  const flat = (t: Tri) => {
    const pts = [0, 1, 2].map((k) => [t.p[k * 3] * U[0] + t.p[k * 3 + 1] * U[1] + t.p[k * 3 + 2] * U[2], t.p[k * 3] * V[0] + t.p[k * 3 + 1] * V[1] + t.p[k * 3 + 2] * V[2]]);
    const c = [(pts[0][0] + pts[1][0] + pts[2][0]) / 3, (pts[0][1] + pts[1][1] + pts[2][1]) / 3];
    return pts.map(([x, y]) => {
      const dx = x - c[0];
      const dy = y - c[1];
      const l = Math.hypot(dx, dy) || 1;
      const k = Math.max(0, l - SHRINK) / l;
      return [c[0] + dx * k, c[1] + dy * k];
    });
  };
  const A = flat(a);
  const B = flat(b);
  for (const poly of [A, B]) {
    for (let k = 0; k < 3; k++) {
      const p = poly[k];
      const q = poly[(k + 1) % 3];
      const ax2 = [q[1] - p[1], p[0] - q[0]];
      const proj = (pts: number[][]) => pts.map((v) => v[0] * ax2[0] + v[1] * ax2[1]);
      const pa = proj(A);
      const pb = proj(B);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  }
  return true;
}

export function __fights(list: Tri[]): Map<string, { count: number; at: number[] }> {
  const bins = new Map<string, Tri[]>();
  const keyOf = (t: Tri, dd: number, flip: boolean) => {
    const s = flip ? -1 : 1;
    // By plane offset only (direction bins would split nearly equal normals at their edges).
    return `${Math.round((t.d * s) / PLANE_EPS) + dd}`;
  };
  for (const t of list) {
    const k = keyOf(t, 0, false);
    const bin = bins.get(k);
    if (bin) bin.push(t);
    else bins.set(k, [t]);
  }
  // Buried: an opaque face with an opaque coplanar face turned the other way over it.
  for (const t of list) {
    if (t.glass) continue;
    for (const dd of [-1, 0, 1]) {
      const bin = bins.get(keyOf(t, dd, true));
      if (!bin) continue;
      for (const o of bin) {
        if (o.glass || o === t) continue;
        if (
          t.maxX + PLANE_EPS < o.minX || o.maxX + PLANE_EPS < t.minX ||
          t.maxY + PLANE_EPS < o.minY || o.maxY + PLANE_EPS < t.minY ||
          t.maxZ + PLANE_EPS < o.minZ || o.maxZ + PLANE_EPS < t.minZ
        ) continue;
        if (t.n[0] * o.n[0] + t.n[1] * o.n[1] + t.n[2] * o.n[2] > -0.999 || !near(t, o)) continue;
        if (overlap(t, o)) {
          t.buried = true;
          break;
        }
      }
      if (t.buried) break;
    }
  }
  const found = new Map<string, { count: number; at: number[] }>();
  const seen = new Set<string>();
  for (const t of list) {
    if (t.buried) continue;
    for (const flip of t.glass ? [false, true] : [false]) {
      for (const dd of [-1, 0, 1]) {
        const bin = bins.get(keyOf(t, dd, flip));
        if (!bin) continue;
        for (const o of bin) {
          if (o === t || o.buried || (t.glass && o.glass)) continue;
          if (flip && !o.glass) continue;
          if (
            t.maxX + PLANE_EPS < o.minX || o.maxX + PLANE_EPS < t.minX ||
            t.maxY + PLANE_EPS < o.minY || o.maxY + PLANE_EPS < t.minY ||
            t.maxZ + PLANE_EPS < o.minZ || o.maxZ + PLANE_EPS < t.minZ
          ) continue;
          const dot = t.n[0] * o.n[0] + t.n[1] * o.n[1] + t.n[2] * o.n[2];
          if ((flip ? -dot : dot) < 0.999) continue;
          if (!near(t, o)) continue;
          if (!overlap(t, o)) continue;
          const pair = t.p[0] < o.p[0] ? `${t.p.join()}|${o.p.join()}` : `${o.p.join()}|${t.p.join()}`;
          if (seen.has(pair)) continue;
          seen.add(pair);
          const name = [layerName(t.layer), layerName(o.layer)].sort().join(' × ');
          const f = found.get(name) ?? { count: 0, at: t.p.slice(0, 3).map((v) => +v.toFixed(2)) };
          if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.ZF_SHOW === name) console.log('   ', name, t.p.map((v) => +v.toFixed(3)).join(' '), '|', o.p.map((v) => +v.toFixed(3)).join(' '));
          f.count++;
          found.set(name, f);
        }
      }
    }
  }
  return found;
}

export async function main(args: string[] = []): Promise<number> {
  // The model library from disk (the worker fetches it in the game).
  const fsName = 'node:fs';
  const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync(path: string, enc?: string): string & Uint8Array };
  const json = JSON.parse(readFileSync('public/models/models.json', 'utf8'));
  const bin = readFileSync('public/models/models.bin') as Uint8Array;
  const lib: ModelLibrary = { ...json, bin: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, byName: new Map(), byGroup: new Map(), cache: new Map(), lodCache: new Map() };
  for (const m of lib.models) {
    lib.byName.set(m.name, m);
    lib.byGroup.set(m.group, [...(lib.byGroup.get(m.group) ?? []), m]);
  }
  setModelLibrary(lib);
  const seed = Number(args[0]) || 1993;
  const quick = args.includes('quick');
  const layout = new WorldLayout(seed);
  const chunks = new Set<string>();
  const R = quick ? 0 : DOWNTOWN_RADIUS + 2;
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) chunks.add(`${i},${j}`);
  for (const kind of Object.keys(POI) as PoiKind[]) {
    const site = nearestPoi(layout, kind, 0, 0);
    if (site) chunks.add(`${site.i},${site.j}`);
  }
  // Big street scenes (evacuation with buses, cordons, police lines, the helicopter).
  const kinds = new Set<string>();
  for (let r = 0; r < 14 && kinds.size < 4; r++) {
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        const urban = layout.isUrban(i, j) || layout.isUrban(i - 1, j) || layout.isUrban(i, j - 1) || layout.isUrban(i - 1, j - 1);
        const s = sceneAt(seed, i, j, urban, Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS + 1);
        if (s && !kinds.has(s.kind)) {
          kinds.add(s.kind);
          chunks.add(`${i},${j}`);
        }
      }
    }
  }
  const total = new Map<string, { count: number; at: number[] }>();
  let triangles = 0;
  let interiors = 0;
  for (const c of chunks) {
    const [i, j] = c.split(',').map(Number);
    const data = buildChunk(layout, i, j);
    const list = __tris(data.surfaces);
    triangles += list.length;
    const add = (found: Map<string, { count: number; at: number[] }>) => {
      for (const [k, v] of found) {
        const t = total.get(k);
        if (t) t.count += v.count;
        else total.set(k, v);
      }
    };
    add(__fights(list));
    for (const b of data.buildings.slice(0, 2)) {
      if (interiors >= 12) break;
      interiors++;
      const inside = __tris(buildInterior(b, 0).surfaces);
      triangles += inside.length;
      add(__fights(inside));
    }
  }
  const rows = [...total.entries()].sort((a, b) => b[1].count - a[1].count);
  console.log(`${chunks.size} chunks (+${interiors} interiors), ${(triangles / 1e6).toFixed(2)} M triangles, seed ${seed}`);
  // What must not flicker: vehicles (models, the bus, procedural cars) and windows / shop glass.
  const watched = (k: string) => /model#|carPaint|carGlass|busPaint|windowGlass|(^| )glass( |$)/.test(k);
  const shown = rows.filter(([k]) => watched(k));
  for (const [k, v] of shown) console.log(`  ${String(v.count).padStart(6)}  ${k}  e.g. at ${v.at.join(', ')}`);
  const other = rows.filter(([k]) => !watched(k)).reduce((n, [, v]) => n + v.count, 0);
  console.log(`  (elsewhere: ${other} pairs, mostly hidden joins of walls and furniture — not checked)`);
  const bad = shown.reduce((n, [, v]) => n + v.count, 0);
  console.log(bad ? `\ntest:zfight FAILED (${bad} overlapping coplanar pairs)` : '\ntest:zfight passed');
  return bad ? 1 : 0;
}
