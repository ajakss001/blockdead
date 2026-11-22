import { BufferAttribute, BufferGeometry, type InterleavedBufferAttribute, LinearMipmapLinearFilter, Matrix4, type Mesh, SRGBColorSpace, type Texture, TextureLoader, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { type GearId, ITEMS, type ItemId, WEAR_SLOTS, type WearSlot } from '../data/items';
import { type BodyId, bodyAsset, hasBody, lodSize, type RigAsset, type TexSize } from './assets';
import { applyFit, boneBind, fitMatrix, fitMoves, fitOf, fitPivot, frameBone, GEAR_FIT, regionOf } from './gearFit';

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
  textureLod?: Texture | null;
}
type Read = (file: string) => Promise<ArrayBuffer>;

let read: Read = (f) => fetch(`${import.meta.env?.BASE_URL ?? '/'}models/gear/${f}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${f}: ${r.status}`))));
let texSize: TexSize = 2048;
let gearAnisotropy = 4;
export function setGearAnisotropy(n: number): void {
  gearAnisotropy = Math.max(1, n);
}
let meta: Meta | null = null;
let metaP: Promise<Meta | null> | null = null;
const pieces = new Map<GearId, Piece>();
const piecesP = new Map<GearId, Promise<void>>();
const fits = new Map<string, Map<string, BufferGeometry>>();
const fitsP = new Map<string, Promise<void>>();
const geos = new Map<string, BufferGeometry>();

const loader = () => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);

/** Where the files come from (Node tests: the disk, no textures) and the texture size (2048; 512 on low). */
export function setGearSource(size: TexSize, r?: Read): void {
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
    const base = `${import.meta.env?.BASE_URL ?? '/'}models/gear/`;
    const crowd = lodSize(texSize);
    const tex = (size: TexSize) =>
      new TextureLoader().loadAsync(`${base}${g}_${size}.webp`).then(async (t) => {
        await (t.image as HTMLImageElement | undefined)?.decode?.().catch(() => {});
        t.colorSpace = SRGBColorSpace;
        t.flipY = false;
        t.minFilter = LinearMipmapLinearFilter;
        t.anisotropy = gearAnisotropy;
        return t;
      });
    // The zombies' smaller texture comes with the piece (never drawn while still downloading: empty texels).
    const [gl, texture, textureLod] = await Promise.all([
      read(`${g}.glb`).then((b) => loader().parseAsync(b, '')),
      texSize ? tex(texSize) : Promise.resolve(null),
      texSize && crowd && crowd !== texSize ? tex(crowd).catch(() => null) : Promise.resolve(null),
    ]);
    let mesh: Mesh | null = null;
    gl.scene.traverse((o) => (mesh ??= (o as Mesh).isMesh ? (o as Mesh) : null));
    pieces.set(g, { geometry: mesh!.geometry, texture, textureLod: textureLod ?? texture });
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
  // A hand fix that moves one of these: the body's cover redone now that the piece is in (gearFit).
  if (gear.some((g) => fitMoves(fitOf(g, body)) || gearKind(g) === 'mask' || gearKind(g) === 'helmet')) recover(body);
}

export function gearReady(body: BodyId, g: GearId): boolean {
  return !!meta?.bodies[body] && pieces.has(g) && fits.has(body);
}

/** A piece's texture: up close (the player, the menu) or, `lod`, the zombies' smaller one (loaded on first use). */
export function gearTexture(g: GearId, lod = false): Texture | null {
  const p = pieces.get(g);
  if (!p) return null;
  if (!lod) return p.texture;
  const size = lodSize(texSize);
  if (p.textureLod === undefined) p.textureLod = !size || size === texSize || p.texture ? p.texture : texOf(`${import.meta.env?.BASE_URL ?? '/'}models/gear/${g}_${size}.webp`);
  return p.textureLod;
}
function texOf(url: string): Texture {
  const t = new TextureLoader().load(url);
  t.colorSpace = SRGBColorSpace;
  t.flipY = false;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = gearAnisotropy;
  return t;
}

/**
 * An attribute's values as plain numbers, one after another: the files keep normals as int8 with a 4-byte
 * stride (interleaved and normalized in three) — their raw `.array` is neither the values nor in step.
 */
function plain(a: BufferAttribute | InterleavedBufferAttribute): Float32Array {
  const n = a.count, k = a.itemSize;
  const out = new Float32Array(n * k);
  for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = a.getComponent(i, c);
  return out;
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
export function gearGeometry(body: BodyId, g: GearId, lod: 0 | 1, part: 'main' | 'lens' = 'main', raw = false): BufferGeometry | null {
  if (!gearReady(body, g) || !hasBody(body)) return null;
  if (part === 'lens' && !fits.get(body)!.get(`${g}_lens`)) return null;
  const key = `${body}:${g}:${lod}:${part}`;
  let out = raw ? undefined : geos.get(key);
  if (out) return out;
  const asset = bodyAsset(body);
  const map = jointMap(body, lod ? asset.lod1 : asset.lod0);
  const parts = rawParts(body, g, map, part);
  // The hand fix (data/gearFit.json): moved, turned, scaled about its pivot in its bone's frame, pushed out.
  const fit = fitOf(g, body);
  if (!raw && fit && fitMoves(fit)) {
    const bone = frameBone(gearKind(g), fit, meta!.bodies[body].rigid[g]?.bone);
    const m = fitMatrix(fit, boneBind(asset.lod0, bone), fitPivot(fit, gearMiddle(body, g)));
    for (const p of parts) {
      const pos = Float32Array.from(p.pos), nor = Float32Array.from(p.nor);
      applyFit(pos, nor, fit, m);
      p.pos = pos;
      p.nor = nor;
      if (fit.bone) {
        const j = map[asset.lod0.index.get(fit.bone) ?? 0];
        const ji = new Uint16Array(p.ji.length), jw = new Float32Array(p.jw.length);
        for (let i = 0; i < ji.length; i += 4) (ji[i] = j), (jw[i] = 1);
        p.ji = ji;
        p.jw = jw;
      }
    }
  }
  out = assemble(parts);
  if (!raw) geos.set(key, out);
  return out;
}

/** The bone a piece's hand fix is in on a body (gearFit: its own, else the rigid piece's, else by kind). */
export function gearFitBone(body: BodyId, g: GearId): string {
  return frameBone(gearKind(g), fitOf(g, body), meta?.bodies[body]?.rigid[g]?.bone);
}

type Part = { rigid?: boolean; pos: ArrayLike<number>; nor: ArrayLike<number>; uv: ArrayLike<number>; index: ArrayLike<number>; ji: ArrayLike<number>; jw: ArrayLike<number> };

const middles = new Map<string, Vector3>();
/** A piece's middle on a body at bind, as fitted (the default pivot of its hand fix). */
export function gearMiddle(body: BodyId, g: GearId): Vector3 {
  const key = `${body}:${g}`;
  let m = middles.get(key);
  if (m) return m;
  // Not loaded yet for this body (the editor asks every frame while a new body loads): no middle, nothing cached.
  if (!fits.has(body) || (meta!.bodies[body].rigid[g] && !pieces.has(g))) return new Vector3();
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity), v = new Vector3();
  for (const p of rawParts(body, g, jointMap(body, bodyAsset(body).lod0), 'main'))
    for (let i = 0; i < p.pos.length; i += 3) v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]), lo.min(v), hi.max(v);
  m = lo.x <= hi.x ? lo.add(hi).multiplyScalar(0.5) : new Vector3();
  middles.set(key, m);
  return m;
}

/** The piece as build-gear fitted it: the rigid part placed on its bone first, then the fitted (skinned) part. */
function rawParts(body: BodyId, g: GearId, map: number[], part: 'main' | 'lens'): Part[] {
  const parts: Part[] = [];
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
    const bone = map[bodyAsset(body).lod0.index.get(rigid.bone) ?? 0];
    const ji = new Uint16Array(n * 4), jw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) (ji[i * 4] = bone), (jw[i * 4] = 1);
    parts.push({ rigid: true, pos, nor, uv: plain(src.getAttribute('uv')), index: src.index!.array, ji, jw });
  }
  const fit = fits.get(body)!.get(part === 'lens' ? `${g}_lens` : g);
  if (fit) {
    const J = plain(fit.getAttribute('skinIndex'));
    const ji = new Uint16Array(J.length);
    for (let i = 0; i < J.length; i++) ji[i] = map[J[i]];
    parts.push({ pos: plain(fit.getAttribute('position')), nor: plain(fit.getAttribute('normal')), uv: plain(fit.getAttribute('uv')), index: fit.index!.array, ji, jw: plain(fit.getAttribute('skinWeight')) });
  }
  return parts;
}

function assemble(parts: Part[]): BufferGeometry {
  const out = new BufferGeometry();
  const cat = <T extends Float32Array | Uint16Array | Uint32Array>(T: new (n: number) => T, k: Exclude<keyof Part, 'rigid'>, off = false) => {
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
  out.userData.rigid = parts[0]?.rigid ? parts[0].pos.length / 3 : 0;
  out.computeBoundingSphere();
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
    covered.set(rig, { body, bits });
    rig.geometry.setAttribute('aCover', new BufferAttribute(writeCover(body, rig, bits, new Float32Array(n)), 1));
  }
  return true;
}

/** The bodies' cover bits as built, by rig (the fits' `show` clears them per region). */
const covered = new Map<RigAsset, { body: BodyId; bits: Uint16Array }>();

/** Points in 3 cm cells (numeric keys): the nearest one to a point within 6 cm. */
class PointGrid {
  private readonly map = new Map<number, number[]>();
  constructor(readonly pos: Float32Array) {
    for (let i = 0; i < pos.length; i += 3) {
      const k = PointGrid.key(Math.floor(pos[i] / 0.03), Math.floor(pos[i + 1] / 0.03), Math.floor(pos[i + 2] / 0.03));
      let l = this.map.get(k);
      if (!l) this.map.set(k, (l = []));
      l.push(i);
    }
  }
  static key(x: number, y: number, z: number): number {
    return ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  }
  nearest(x: number, y: number, z: number): number {
    const cx = Math.floor(x / 0.03), cy = Math.floor(y / 0.03), cz = Math.floor(z / 0.03);
    let best = Infinity;
    for (let a = -2; a <= 2; a++)
      for (let b = -2; b <= 2; b++)
        for (let c = -2; c <= 2; c++) {
          const l = this.map.get(PointGrid.key(cx + a, cy + b, cz + c));
          if (l) for (const i of l) best = Math.min(best, (this.pos[i] - x) ** 2 + (this.pos[i + 1] - y) ** 2 + (this.pos[i + 2] - z) ** 2);
        }
    return best <= 0.0036 ? Math.sqrt(best) : Infinity;
  }
}

const TOP_BINS = 36;
const topBin = (dx: number, dz: number) => Math.min(TOP_BINS - 1, Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * TOP_BINS));

/** A piece's points at bind as fitted by build-gear and as moved by its hand fix (cached per fit). */
type Edge = Float32Array & { cx: number; cz: number };
type Moved = { raw: PointGrid; now: PointGrid; most: number; dy: number; top: Edge | null; bot: Edge | null };
const moved = new Map<string, Moved & { fit: string }>();
function movedPiece(body: BodyId, g: GearId): Moved | null {
  if (!gearReady(body, g) || !hasBody(body)) return null;
  const f = fitOf(g, body) ?? {};
  const key = `${body}:${g}`, sig = JSON.stringify(f);
  const c = moved.get(key);
  if (c?.fit === sig) return c;
  const asset = bodyAsset(body);
  const parts = rawParts(body, g, jointMap(body, asset.lod0), 'main');
  const raw = new Float32Array(parts.reduce((s, p) => s + p.pos.length, 0));
  const nor = new Float32Array(raw.length);
  let at = 0;
  for (const p of parts) (raw.set(p.pos, at), nor.set(p.nor, at), (at += p.pos.length));
  const now = raw.slice();
  applyFit(now, nor, f, fitMatrix(f, boneBind(asset.lod0, gearFitBone(body, g)), fitPivot(f, gearMiddle(body, g))));
  let most = 0, dy = 0;
  for (let i = 0; i < raw.length; i += 3) (most = Math.max(most, Math.hypot(now[i] - raw[i], now[i + 1] - raw[i + 1], now[i + 2] - raw[i + 2]))), (dy += now[i + 1] - raw[i + 1]);
  dy /= Math.max(1, raw.length / 3);
  // A mask's upper and lower edges round the head as moved (the highest and the lowest point per 10° about
  // the head's axis).
  // A helmet's rim the same, but past its straps (the lowest tenth of its points per 10° left out).
  let top: Edge | null = null, bot: Edge | null = null;
  const kind = gearKind(g);
  if (kind === 'mask' || kind === 'helmet') {
    const j = asset.lod0.bind[asset.lod0.index.get('Head') ?? 0].elements;
    top = Object.assign(new Float32Array(TOP_BINS).fill(-Infinity), { cx: j[12], cz: j[14] });
    bot = Object.assign(new Float32Array(TOP_BINS).fill(Infinity), { cx: j[12], cz: j[14] });
    const ys: number[][] = Array.from({ length: TOP_BINS }, () => []);
    for (let i = 0; i < now.length; i += 3) ys[topBin(now[i] - j[12], now[i + 2] - j[14])].push(now[i + 1]);
    for (let b = 0; b < TOP_BINS; b++) {
      const l = ys[b].sort((a, c) => a - c);
      if (!l.length) continue;
      top[b] = l[l.length - 1];
      bot[b] = l[kind === 'helmet' ? Math.floor(l.length * 0.1) : 0];
    }
  }
  const out = { fit: sig, raw: new PointGrid(raw), now: new PointGrid(now), most, dy, top, bot };
  moved.set(key, out);
  return out;
}

/**
 * The cover bits with each fit's shown regions cleared, and, for a piece its fit moves, kept only where the
 * moved piece is still over the body (no nearer than 1 cm worse than before): a piece moved off the face does
 * not leave a hole in it. A moving fit whose piece is not in yet hides nothing.
 */
function writeCover(body: BodyId, rig: RigAsset, bits: Uint16Array, f: Float32Array): Float32Array {
  const n = f.length;
  for (let i = 0; i < Math.min(n, bits.length); i++) f[i] = bits[i];
  const P = rig.geometry.getAttribute('position');
  for (const [g, per] of Object.entries(GEAR_FIT)) {
    const fit = per?.[body];
    const bit = meta?.gear[g as GearId]?.bit;
    if (!fit || bit === undefined || !fitMoves(fit)) continue;
    const m = 1 << bit;
    const mp = movedPiece(body, g as GearId);
    for (let i = 0; i < n; i++) {
      if (!(f[i] & m)) continue;
      if (!mp) {
        f[i] = f[i] & ~m;
        continue;
      }
      if (mp.most < 0.002) continue;
      // A helmet: by its rim (below).
      if (gearKind(g as GearId) === 'helmet') continue;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const d0 = mp.raw.nearest(x, y, z), d1 = mp.now.nearest(x, y, z);
      if (d0 === Infinity ? !(d1 < Infinity || mp.most < 0.01) : !(d1 <= d0 + 0.01)) f[i] = f[i] & ~m;
    }
  }
  // A mask or a helmet, fitted or not: the body shows above a mask's upper edge and below its lower one or a
  // helmet's rim (no holes in the cheeks, round the collar or under the back of a helmet where the piece ends
  // short of what it hides). Above the rim a helmet hides all it did as built (no hair through the crown).
  for (const g of Object.keys(meta?.gear ?? {}) as GearId[]) {
    const bit = meta?.gear[g]?.bit;
    const kind = gearKind(g);
    if (bit === undefined || (kind !== 'mask' && kind !== 'helmet')) continue;
    const mp = movedPiece(body, g);
    if (!mp?.top || !mp.bot) continue;
    const m = 1 << bit, t = mp.top, b = mp.bot;
    for (let i = 0; i < n; i++) {
      if (!(f[i] & m)) continue;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      const k = topBin(x - t.cx, z - t.cz);
      if ((kind === 'mask' && y > t[k] - 0.004) || y < b[k] + 0.004) f[i] = f[i] & ~m;
    }
  }
  // A vest, a pack, a bag: its hidden patch one ring of vertices smaller (the triangles at its edge drawn — a
  // strap narrower than the faces under it leaves no hole; a little of the shirt at the edge may show).
  const ring = ringsOf(rig);
  if (ring)
    for (const g of Object.keys(meta?.gear ?? {}) as GearId[]) {
      const bit = meta?.gear[g]?.bit;
      const kind = gearKind(g);
      if (bit === undefined || !(kind === 'vest' || kind === 'pack' || kind === 'bag' || kind === 'box')) continue;
      const m = 1 << bit;
      const edge: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!(f[i] & m)) continue;
        for (let k = ring.start[i]; k < ring.start[i + 1]; k++)
          if (!(f[ring.list[k]] & m)) {
            edge.push(i);
            break;
          }
      }
      for (const i of edge) f[i] = f[i] & ~m;
    }
  let clear: Map<string, number> | null = null;
  for (const [g, per] of Object.entries(GEAR_FIT)) {
    const show = per?.[body]?.show;
    const bit = meta?.gear[g as GearId]?.bit;
    if (!show?.length || bit === undefined) continue;
    clear ??= new Map();
    for (const r of show) clear.set(r, (clear.get(r) ?? 0) | (1 << bit));
  }
  if (!clear) return f;
  const J = rig.geometry.getAttribute('skinIndex'), W = rig.geometry.getAttribute('skinWeight');
  const region = rig.names.map(regionOf);
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (W.getComponent(i, k) > W.getComponent(i, best)) best = k;
    const c = clear.get(region[J.getComponent(i, best)]);
    if (c) f[i] = f[i] & ~c;
  }
  return f;
}

/** Each vertex's neighbours along the body's triangles (CSR: `list[start[i]..start[i+1]]`), cached per rig. */
const rings = new WeakMap<RigAsset, { start: Uint32Array; list: Uint32Array }>();
function ringsOf(rig: RigAsset): { start: Uint32Array; list: Uint32Array } | null {
  const c = rings.get(rig);
  if (c) return c;
  const idx = rig.geometry.getIndex();
  if (!idx) return null;
  const n = rig.geometry.getAttribute('position').count;
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t + 2 < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), d = idx.getX(t + 2);
    sets[a].add(b).add(d);
    sets[b].add(a).add(d);
    sets[d].add(a).add(b);
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + sets[i].size;
  const list = new Uint32Array(start[n]);
  for (let i = 0; i < n; i++) list.set([...sets[i]], start[i]);
  const out = { start, list };
  rings.set(rig, out);
  return out;
}

/**
 * The fits changed (the gear editor): pieces are built again on their next `gearGeometry` (the old ones
 * disposed — only the editor calls this) and the bodies' cover bits redone.
 */
export function gearFitChanged(cover = true): void {
  for (const g of geos.values()) g.dispose();
  geos.clear();
  if (cover) recover();
}

/** The cover bits written again (one body's or all loaded). */
function recover(only?: BodyId): void {
  for (const [rig, { body, bits }] of covered) {
    if (only && body !== only) continue;
    const a = rig.geometry.getAttribute('aCover') as BufferAttribute;
    writeCover(body, rig, bits, a.array as Float32Array);
    a.needsUpdate = true;
  }
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
