import {
  type AnimationClip,
  type Bone,
  type BufferGeometry,
  LinearMipmapLinearFilter,
  Matrix4,
  type Quaternion,
  type SkinnedMesh,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  type Vector3,
  VectorKeyframeTrack,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * The character models (tools/build-characters.mjs → public/models/characters): a man and a woman in their
 * everyday clothes, and the class costumes (a whole model each, the same skeleton and clips), each as the
 * player's model (~10k triangles, every skinned bone) and LOD1 (~3k, the main 22 bones) for zombies and far
 * figures; one texture per body (alpha: the skin mask); the Mixamo clips on one skeleton (the hips' height in
 * leg lengths). The two base bodies and the clips load at boot; a costume when it is first worn or seen
 * (`loadBody`) — until then whoever wears it is drawn in the base body.
 */

export type BaseBody = 'male' | 'female';
export type CostumeId = 'swat' | 'military' | 'police' | 'firefighter' | 'doctor' | 'mechanic' | 'builder';
export const COSTUMES: readonly CostumeId[] = ['swat', 'military', 'police', 'firefighter', 'doctor', 'mechanic', 'builder'];
/** A costume on a body: '<costume>_m' (the women's costumes are to come: '<costume>_f'). */
export type CostumeBody = `${CostumeId}_m`;
export type BodyId = BaseBody | CostumeBody;
export const BASE_BODIES: readonly BaseBody[] = ['male', 'female'];
export const BODY_IDS: readonly BodyId[] = [...BASE_BODIES, ...COSTUMES.map((c) => `${c}_m` as CostumeBody)];

/** The body a costume puts on a man or a woman: none yet for women (their base body, the class's gear on top). */
export function costumeBody(costume: CostumeId | null | undefined, sex: BaseBody): BodyId {
  return costume && sex === 'male' ? `${costume}_m` : sex;
}

/** The base body under a costume (the sex), for clips and fallbacks. */
export function baseOf(body: BodyId): BaseBody {
  return body === 'female' || body.endsWith('_f') ? 'female' : 'male';
}
export type ClipId =
  | 'idle'
  | 'walking'
  | 'walking_female'
  | 'running'
  | 'crouched_walking'
  | 'jump'
  | 'zombie_idle'
  | 'zombie_walk'
  | 'zombie_running'
  | 'zombie_attack'
  | 'zombie_attack_2'
  | 'zombie_scream';

/** One skinned model: the geometry and its skeleton at bind (bare bone names: 'Hips', 'LeftArm'…). */
export interface RigAsset {
  geometry: BufferGeometry;
  names: string[];
  parents: number[];
  restPos: Vector3[];
  restRot: Quaternion[];
  /** Bind world matrices (model frame) and their inverses. */
  bind: Matrix4[];
  inverses: Matrix4[];
  index: Map<string, number>;
}

export interface BodyAsset {
  id: BodyId;
  /** Hips-to-ankle at bind (m): the clips' hips height is in these. */
  leg: number;
  height: number;
  lod0: RigAsset;
  lod1: RigAsset;
  /** The texture seen up close (the player, the menu, the inventory): 2048, 512 on low. */
  texture: Texture | null;
  /** The zombies' (LOD) texture: 1024 (512 on low), loaded on first use (`lodTexture`). */
  textureLod?: Texture | null;
}

/** Texture sizes: up close (the player, the menu) and for the crowd (zombies, LOD). */
export type TexSize = 0 | 512 | 1024 | 2048;
/** The zombies' texture of a body: the smaller file, loaded the first time it is asked for. */
export function lodTexture(asset: BodyAsset): Texture | null {
  if (asset.textureLod !== undefined) return asset.textureLod;
  const size = lodSize(source?.texSize ?? 0);
  if (!source || !size || size === source.texSize) return (asset.textureLod = asset.texture);
  const t = new TextureLoader().load(`${source.base}${asset.id}_${size}.webp`);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4;
  if (asset.texture) t.flipY = asset.texture.flipY;
  return (asset.textureLod = t);
}
/** The crowd's size for an up-close size: 2048 → 1024; low stays 512. */
export const lodSize = (s: TexSize): TexSize => (s === 2048 ? 1024 : s);

const PREFIX = 'mixamorig';
export const bare = (name: string) => (name.startsWith(PREFIX) ? name.slice(PREFIX.length).replace(/^:/, '') : name);
export const boneName = (b: string) => `${PREFIX}${b}`;

const bodies = new Map<BodyId, BodyAsset>();
const clips = new Map<string, AnimationClip>();
const bodyClips = new Map<string, AnimationClip>();
let ready: Promise<void> | null = null;

type Read = (file: string) => Promise<ArrayBuffer>;

function rigOf(mesh: SkinnedMesh): RigAsset {
  const bones = mesh.skeleton.bones;
  const names = bones.map((b) => bare(b.name));
  const parents = bones.map((b) => bones.indexOf(b.parent as Bone));
  mesh.updateWorldMatrix(true, true);
  const inverses = mesh.skeleton.boneInverses.map((m) => m.clone());
  const bind = inverses.map((m) => m.clone().invert());
  const geometry = mesh.geometry;
  geometry.computeBoundingSphere();
  return {
    geometry,
    names,
    parents,
    restPos: bones.map((b) => b.position.clone()),
    restRot: bones.map((b) => b.quaternion.clone()),
    bind,
    inverses,
    index: new Map(names.map((n, i) => [n, i])),
  };
}

async function parse(loader: GLTFLoader, read: Read, file: string) {
  const buf = await read(file);
  return loader.parseAsync(buf, '');
}

let source: { get: Read; base: string; texSize: TexSize; meta: Record<string, { leg: number; height: number }> } | null = null;
const pending = new Map<BodyId, Promise<BodyAsset | null>>();

/** One body's two models and texture (null if the build has none of it). */
function fetchBody(id: BodyId): Promise<BodyAsset | null> {
  let p = pending.get(id);
  if (p) return p;
  p = (async () => {
    const src = source;
    if (!src || !src.meta[id]) return null;
    const { get, base, texSize } = src;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const texLoader = new TextureLoader();
    {
      const [g0, g1, texture] = await Promise.all([
        parse(loader, get, `${id}.glb`),
        parse(loader, get, `${id}_lod1.glb`),
        texSize
          ? texLoader.loadAsync(`${base}${id}_${texSize}.webp`).then((t) => {
              t.colorSpace = SRGBColorSpace;
              t.minFilter = LinearMipmapLinearFilter;
              t.anisotropy = 4;
              return t;
            })
          : Promise.resolve(null),
      ]);
      const mesh = (g: { scene: { getObjectByProperty(k: string, v: unknown): unknown } }) => g.scene.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh;
      const asset: BodyAsset = { id, leg: src.meta[id].leg, height: src.meta[id].height, lod0: rigOf(mesh(g0)), lod1: rigOf(mesh(g1)), texture };
      bodies.set(id, asset);
      return asset;
    }
  })().catch((e) => {
    console.warn('character', id, e);
    return null;
  });
  pending.set(id, p);
  return p;
}

/** Starts loading a costume (or any body); resolves when it can be used synchronously (null: none in the build). */
export function loadBody(id: BodyId): Promise<BodyAsset | null> {
  return fetchBody(id);
}

/** Loaded and usable now. */
export function hasBody(id: BodyId): boolean {
  return bodies.has(id);
}

/** The body to draw now: the wanted one if loaded (its loading started otherwise), else its base body. */
export function bodyNow(id: BodyId): BodyId {
  if (bodies.has(id)) return id;
  void fetchBody(id);
  return baseOf(id);
}

/** Loads the base bodies and the clips (`texSize` 512 on low, 2048 otherwise; 0: no textures, as in Node tests). */
export function loadCharacters(texSize: TexSize, read?: Read): Promise<void> {
  ready ??= (async () => {
    const base = `${import.meta.env?.BASE_URL ?? '/'}models/characters/`;
    const get: Read = read ?? ((f) => fetch(base + f).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${f}: ${r.status}`)))));
    const meta = JSON.parse(new TextDecoder().decode(await get('characters.json'))) as { bodies: Record<BodyId, { leg: number; height: number }> };
    source = { get, base, texSize, meta: meta.bodies };
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const tasks: Promise<unknown>[] = BASE_BODIES.map((id) => fetchBody(id));
    tasks.push(
      parse(loader, get, 'anims.glb').then((g) => {
        for (const c of g.animations) clips.set(c.name, c);
      }),
    );
    await Promise.all(tasks);
  })();
  return ready;
}

export function charactersReady(): boolean {
  return BASE_BODIES.every((b) => bodies.has(b));
}

export function bodyAsset(id: BodyId): BodyAsset {
  const b = bodies.get(id);
  if (!b) throw new Error(`character ${id} not loaded`);
  return b;
}

/**
 * A clip for a body's rig: only the tracks of its bones, the hips' height in its own leg lengths. Cached.
 */
export function clipFor(body: BodyId, lod: 0 | 1, name: ClipId): AnimationClip {
  const key = `${body}:${lod}:${name}`;
  let c = bodyClips.get(key);
  if (c) return c;
  const src = clips.get(name);
  if (!src) throw new Error(`clip ${name} not loaded`);
  const b = bodyAsset(body);
  const rig = lod ? b.lod1 : b.lod0;
  c = src.clone();
  c.name = name;
  c.tracks = c.tracks.filter((t) => rig.index.has(bare(t.name.split('.')[0])));
  for (const t of c.tracks) {
    if (!(t instanceof VectorKeyframeTrack) || !t.name.endsWith('.position')) continue;
    const v = t.values;
    for (let i = 0; i < v.length; i++) v[i] *= b.leg;
  }
  bodyClips.set(key, c);
  return c;
}

