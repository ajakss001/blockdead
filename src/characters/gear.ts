import { BufferAttribute, BufferGeometry, LinearMipmapLinearFilter, Matrix4, type Mesh, SRGBColorSpace, type Texture, TextureLoader, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { type GearId, ITEMS, type ItemId, WEAR_SLOTS, type WearSlot } from '../data/items';
import { type BodyId, bodyAsset, hasBody, type RigAsset } from './assets';

/**
 * Worn gear (helmets, vests, packs, the medic's bag, the mechanic's toolbox): models built and fitted to every
 * body by tools/build-gear.mjs (public/models/gear). Per body: a vest shrink-wrapped onto its torso and the
 * straps of the packs and the bag laid over its shoulders (skinned from the body's own weights); the rigid
 * pieces' places (a helmet on Head scaled to the head, a pack on Spine2, the bag and the box on Hips); and
 * which of the body's vertices each piece covers (`aCover`, a bit per piece) — those are not drawn under it.
 *
 * Here: a piece as skinned geometry in its body's bind space for either LOD (the LOD1 rig has the 22 main
 * bones: a weight on another bone goes to its nearest main ancestor), its texture, the body's cover bits.
 * Loaded lazily per piece and body; until then nothing is drawn (the figure gets it a moment later).
 */

type Kind = 'helmet' | 'vest' | 'pack' | 'bag' | 'box' | 'glasses' | 'mask';
/** Worn on the head and face: never drawn in first person (it is round the eyes). */
export const HEAD_KINDS: readonly Kind[] = ['helmet', 'glasses', 'mask'];
interface Meta {
  gear: Record<GearId, { kind: Kind; bit: number; tris: number }>;
  bodies: Record<string, { rigid: Partial<Record<GearId, { bone: string; place: number[] }>>; cover: string; cover1: string }>;
}
interface Piece {
  geometry: BufferGeometry;
  texture: Texture | null;
}
type Read = (file: string) => Promise<ArrayBuffer>;

let read: Read = (f) => fetch(`${import.meta.env?.BASE_URL ?? '/'}models/gear/${f}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${f}: ${r.status}`))));
let texSize: 0 | 512 | 1024 = 1024;
let meta: Meta | null = null;
let metaP: Promise<Meta | null> | null = null;
const pieces = new Map<GearId, Piece>();
const piecesP = new Map<GearId, Promise<void>>();
const fits = new Map<string, Map<string, BufferGeometry>>();
const fitsP = new Map<string, Promise<void>>();
const geos = new Map<string, BufferGeometry>();

const loader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Where the files come from (Node tests: the disk, no textures) and the texture size (512 on low). */
export function setGearSource(size: 0 | 512 | 1024, r?: Read): void {
  texSize = size;
  if (r) read = r;
}

/** The catalogue (sizes, bits, every body's places and cover); everything else waits for it. */
export function loadGearMeta(): Promise<Meta | null> {
  metaP ??= read('gear.json')
    .then((b) => (meta = JSON.parse(new TextDecoder().decode(b)) as Meta))
    .catch((e) => {
      console.warn('gear', e);
      return null;
    });
  return metaP;
}

export function gearKind(g: GearId): Kind | null {
  return meta?.gear[g]?.kind ?? null;
}

/** The pieces worn (in slot order), from a worn set. */
export function wornGear(worn: Partial<Record<WearSlot, ItemId | null>>): GearId[] {
  const out: GearId[] = [];
  for (const s of WEAR_SLOTS) {
    const id = worn[s];
    const g = id ? ITEMS[id]?.wear?.gear : undefined;
    if (g) out.push(g);
  }
  return out;
}

/** The cover bits of the pieces worn (a body's `hide`). */
export function hideBits(gear: readonly GearId[]): number {
  let b = 0;
  if (meta) for (const g of gear) if (meta.gear[g]) b |= 1 << meta.gear[g].bit;
  return b;
}

function loadPiece(g: GearId): Promise<void> {
  let p = piecesP.get(g);
  if (p) return p;
  p = (async () => {
    const [gl, texture] = await Promise.all([
      read(`${g}.glb`).then((b) => loader().parseAsync(b, '')),
      texSize
        ? new TextureLoader().loadAsync(`${import.meta.env?.BASE_URL ?? '/'}models/gear/${g}_${texSize}.webp`).then((t) => {
            t.colorSpace = SRGBColorSpace;
            t.flipY = false;
            t.minFilter = LinearMipmapLinearFilter;
            t.anisotropy = 4;
            return t;
          })
        : Promise.resolve(null),
    ]);
    let mesh: Mesh | null = null;
    gl.scene.traverse((o) => (mesh ??= (o as Mesh).isMesh ? (o as Mesh) : null));
    pieces.set(g, { geometry: mesh!.geometry, texture });
  })().catch((e) => console.warn('gear', g, e));
  piecesP.set(g, p);
  return p;
}

function loadFit(body: BodyId): Promise<void> {
  let p = fitsP.get(body);
  if (p) return p;
  p = (async () => {
    const gl = await loader().parseAsync(await read(`fit_${body}.glb`), '');
    const m = new Map<string, BufferGeometry>();
    gl.scene.traverse((o) => {
      if ((o as Mesh).isMesh) m.set(o.name || o.parent!.name, (o as Mesh).geometry);
    });
    fits.set(body, m);
  })().catch((e) => console.warn('gear fit', body, e));
  fitsP.set(body, p);
  return p;
}

/** Loads what a body needs to wear these (resolves when `gearReady` says so). */
export async function loadGear(body: BodyId, gear: readonly GearId[]): Promise<void> {
  if (!(await loadGearMeta())) return;
  await Promise.all([loadFit(body), ...gear.map(loadPiece)]);
}

export function gearReady(body: BodyId, g: GearId): boolean {
  return !!meta?.bodies[body] && pieces.has(g) && fits.has(body);
}

export function gearTexture(g: GearId): Texture | null {
  return pieces.get(g)?.texture ?? null;
}

/** LOD0 joint index → the rig's (LOD1: the nearest main ancestor by name). */
function jointMap(body: BodyId, rig: RigAsset): number[] {
  const l0 = bodyAsset(body).lod0;
  return l0.names.map((_, i) => {
    let j = i;
    while (j >= 0 && !rig.index.has(l0.names[j])) j = l0.parents[j];
    return rig.index.get(l0.names[Math.max(0, j)]) ?? 0;
  });
}

/**
 * A piece on a body, skinned, in the body's bind space (`lod` 1: for the zombies' rig); the toolbox here is
 * the one on the hip (in the hand it is a plain mesh: `boxInHand`). Cached; null until loaded.
 */
export function gearGeometry(body: BodyId, g: GearId, lod: 0 | 1, part: 'main' | 'lens' = 'main'): BufferGeometry | null {
  if (!gearReady(body, g) || !hasBody(body)) return null;
  if (part === 'lens' && !fits.get(body)!.get(`${g}_lens`)) return null;
  const key = `${body}:${g}:${lod}:${part}`;
  let out = geos.get(key);
  if (out) return out;
  const asset = bodyAsset(body);
  const rig = lod ? asset.lod1 : asset.lod0;
  const map = jointMap(body, rig);
  const parts: { pos: ArrayLike<number>; nor: ArrayLike<number>; uv: ArrayLike<number>; index: ArrayLike<number>; ji: ArrayLike<number>; jw: ArrayLike<number> }[] = [];
  const rigid = part === 'lens' ? undefined : meta!.bodies[body].rigid[g];
  if (rigid) {
    const src = pieces.get(g)!.geometry;
    const m = new Matrix4().fromArray(rigid.place);
    const nm = new Matrix4().extractRotation(m);
    const P = src.getAttribute('position'), N = src.getAttribute('normal');
    const n = P.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
    const v = new Vector3();
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m).toArray(pos, i * 3);
      v.fromBufferAttribute(N, i).applyMatrix4(nm).normalize().toArray(nor, i * 3);
    }
    const bone = rig.index.get(rigid.bone) ?? 0;
    const ji = new Uint16Array(n * 4), jw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) (ji[i * 4] = bone), (jw[i * 4] = 1);
    parts.push({ pos, nor, uv: src.getAttribute('uv').array, index: src.index!.array, ji, jw });
  }
  const fit = fits.get(body)!.get(part === 'lens' ? `${g}_lens` : g);
  if (fit) {
    const J = fit.getAttribute('skinIndex'), W = fit.getAttribute('skinWeight');
    const ji = new Uint16Array(J.count * 4);
    for (let i = 0; i < J.count * 4; i++) ji[i] = map[J.array[i]];
    parts.push({ pos: fit.getAttribute('position').array, nor: fit.getAttribute('normal').array, uv: fit.getAttribute('uv').array, index: fit.index!.array, ji, jw: W.array });
  }
  out = new BufferGeometry();
  const cat = <T extends Float32Array | Uint16Array | Uint32Array>(T: new (n: number) => T, k: keyof (typeof parts)[0], off = false) => {
    const o = new T(parts.reduce((s, p) => s + p[k].length, 0));
    let at = 0, base = 0;
    for (const p of parts) {
      const a = p[k];
      for (let i = 0; i < a.length; i++) o[at + i] = off ? a[i] + base : a[i];
      at += a.length;
      base += p.pos.length / 3;
    }
    return o;
  };
  out.setAttribute('position', new BufferAttribute(cat(Float32Array, 'pos'), 3));
  out.setAttribute('normal', new BufferAttribute(cat(Float32Array, 'nor'), 3));
  out.setAttribute('uv', new BufferAttribute(cat(Float32Array, 'uv'), 2));
  out.setAttribute('skinIndex', new BufferAttribute(cat(Uint16Array, 'ji'), 4));
  out.setAttribute('skinWeight', new BufferAttribute(cat(Float32Array, 'jw'), 4));
  out.setIndex(new BufferAttribute(cat(Uint32Array, 'index', true), 1));
  // The rigid piece's vertices come first (tests: the straps after them).
  out.userData.rigid = rigid ? parts[0].pos.length / 3 : 0;
  out.computeBoundingSphere();
  geos.set(key, out);
  return out;
}

/**
 * The toolbox carried by its handle: the plain piece and the height of its handle's top over its middle
 * (the handle runs along its X, over the middle).
 */
export function boxInHand(g: GearId): { geometry: BufferGeometry; top: number } | null {
  const p = pieces.get(g);
  if (!p) return null;
  const P = p.geometry.getAttribute('position');
  let top = -Infinity;
  for (let i = 0; i < P.count; i++) if (Math.abs(P.getZ(i)) < 0.03 && Math.abs(P.getX(i)) < 0.06) top = Math.max(top, P.getY(i));
  return { geometry: p.geometry, top };
}

/** The body's per-vertex cover bits (`aCover`) on both its LODs' geometry (once its catalogue is in). */
export function coverBody(body: BodyId): boolean {
  if (!meta?.bodies[body] || !hasBody(body)) return false;
  const a = bodyAsset(body);
  for (const [rig, data] of [
    [a.lod0, meta.bodies[body].cover],
    [a.lod1, meta.bodies[body].cover1],
  ] as const) {
    if (rig.geometry.getAttribute('aCover')) continue;
    const bin = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const bits = new Uint16Array(bin.buffer);
    const n = rig.geometry.getAttribute('position').count;
    const f = new Float32Array(n);
    for (let i = 0; i < Math.min(n, bits.length); i++) f[i] = bits[i];
    rig.geometry.setAttribute('aCover', new BufferAttribute(f, 1));
  }
  return true;
}

/** A piece by itself (its icon): loads it; null until then. */
export function gearPiece(g: GearId): Piece | null {
  const p = pieces.get(g);
  if (!p) void loadGearMeta().then((m) => m && loadPiece(g));
  return p ?? null;
}

/** Resolves when the piece by itself is in. */
export async function loadGearPiece(g: GearId): Promise<void> {
  if (await loadGearMeta()) await loadPiece(g);
}
