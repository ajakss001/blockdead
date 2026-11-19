import { BufferAttribute, BufferGeometry } from 'three';

/*
 * Third-party models prepared by tools/prep-models.mjs (public/models): quantized geometry in one
 * binary, one atlas layer each. Worker-safe (no DOM): the chunk worker merges them into the chunk
 * batch, the main thread uploads the atlas (render/look/worldMaterials) and shows the credits.
 */

export interface ModelInfo {
  name: string;
  /** What the generators ask for: car, van, police, ambulance, wreck, tank, apc, truck, heli, prop kinds. */
  group: string;
  /** The game may repaint it (multiply the texture by a paint color). */
  tint: boolean;
  /** Layer in the model atlas. */
  layer: number;
  /** Bounding box min corner and size, m (nose along +X, standing on y = 0, centered). */
  min: [number, number, number];
  size: [number, number, number];
  vertices: number;
  indices: number;
  /** The last this many indices are glass panes (drawn as translucent car glass). */
  glass?: number;
  vOffset: number;
  iOffset: number;
  lod1Offset?: number;
  lod1Indices?: number;
  normals: boolean;
  title: string;
  author: string;
  license: string;
  url: string;
}

export interface ModelLibrary {
  stride: number;
  atlas: number;
  atlasCols?: number;
  models: ModelInfo[];
  byName: Map<string, ModelInfo>;
  byGroup: Map<string, ModelInfo[]>;
  bin: ArrayBuffer;
  cache: Map<string, BufferGeometry>;
  lodCache?: Map<string, Uint16Array | null>;
}

/** Fetch the library (null if it is not installed or fails — the game falls back to procedural props). */
export async function loadModelLibrary(base: string): Promise<ModelLibrary | null> {
  try {
    const [json, bin] = await Promise.all([fetch(`${base}models.json`).then((r) => (r.ok ? r.json() : null)), fetch(`${base}models.bin`).then((r) => (r.ok ? r.arrayBuffer() : null))]);
    if (!json || !bin) return null;
    const lib: ModelLibrary = { ...json, bin, byName: new Map(), byGroup: new Map(), cache: new Map(), lodCache: new Map() };
    for (const m of lib.models) {
      lib.byName.set(m.name, m);
      const list = lib.byGroup.get(m.group);
      if (list) list.push(m);
      else lib.byGroup.set(m.group, [m]);
    }
    return lib;
  } catch {
    return null;
  }
}

/** Decoded geometry of a model without its glass (cached): position, normal, uv (atlas layer space), color. */
export function modelGeometry(lib: ModelLibrary, m: ModelInfo): BufferGeometry {
  const hit = lib.cache.get(m.name);
  if (hit) return hit;
  const g = decode(lib, m, 0, m.indices - (m.glass ?? 0));
  lib.cache.set(m.name, g);
  return g;
}

/** Simplified LOD1 opaque index buffer for distant vehicles (cached), or null if none baked. */
export function modelLod1Indices(lib: ModelLibrary, m: ModelInfo): Uint16Array | null {
  if (!m.lod1Offset || !m.lod1Indices) return null;
  const cache = (lib.lodCache ??= new Map());
  if (cache.has(m.name)) return cache.get(m.name)!;
  const idx = new Uint16Array(lib.bin, m.lod1Offset, m.lod1Indices).slice();
  cache.set(m.name, idx);
  return idx;
}

/** A model's glass panes (cached), or null if it has none. */
export function modelGlass(lib: ModelLibrary, m: ModelInfo): BufferGeometry | null {
  if (!m.glass) return null;
  const key = `${m.name}#glass`;
  const hit = lib.cache.get(key);
  if (hit) return hit;
  const g = decode(lib, m, m.indices - m.glass, m.glass);
  lib.cache.set(key, g);
  return g;
}

function decode(lib: ModelLibrary, m: ModelInfo, first: number, count: number): BufferGeometry {
  const view = new DataView(lib.bin, m.vOffset, m.vertices * lib.stride);
  const n = m.vertices;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * lib.stride;
    for (let a = 0; a < 3; a++) {
      pos[i * 3 + a] = m.min[a] + (view.getUint16(o + a * 2, true) / 65535) * m.size[a];
      nrm[i * 3 + a] = view.getInt8(o + 8 + a) / 127;
      col[i * 3 + a] = view.getUint8(o + 16 + a) / 255;
    }
    uv[i * 2] = view.getUint16(o + 12, true) / 65535;
    uv[i * 2 + 1] = view.getUint16(o + 14, true) / 65535;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setIndex(new BufferAttribute(new Uint16Array(lib.bin, m.iOffset + first * 2, count).slice(), 1));
  if (!m.normals) g.computeVertexNormals();
  return g;
}

/** A model of a group, picked by a 0..1 roll (null if the group is empty or the library absent). */
export function pickModel(lib: ModelLibrary | null, group: string, roll: number): ModelInfo | null {
  const list = lib?.byGroup.get(group);
  if (!list || list.length === 0) return null;
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}
