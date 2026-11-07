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
 * The character models (tools/build-characters.mjs → public/models/characters): a man, a woman and the SWAT
 * officer (Ch35), each as the player's model (~10k triangles, every skinned bone) and LOD1 (~3k, the main
 * 22 bones) for zombies and far figures; one texture per body (alpha: the skin mask); the Mixamo clips on
 * one skeleton (the hips' height in leg lengths). Loaded once at boot, then used synchronously.
 */

export type BodyId = 'male' | 'female' | 'swat';
export const BODY_IDS: readonly BodyId[] = ['male', 'female', 'swat'];
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
  texture: Texture | null;
}

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

/** Loads every body and clip (`texSize` 512 on low, 1024 otherwise; 0: no textures, as in Node tests). */
export function loadCharacters(texSize: 0 | 512 | 1024, read?: Read): Promise<void> {
  ready ??= (async () => {
    const base = `${import.meta.env?.BASE_URL ?? '/'}models/characters/`;
    const get: Read = read ?? ((f) => fetch(base + f).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${f}: ${r.status}`)))));
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const meta = JSON.parse(new TextDecoder().decode(await get('characters.json'))) as { bodies: Record<BodyId, { leg: number; height: number }> };
    const texLoader = new TextureLoader();
    const tasks: Promise<void>[] = BODY_IDS.map(async (id) => {
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
      bodies.set(id, { id, leg: meta.bodies[id].leg, height: meta.bodies[id].height, lod0: rigOf(mesh(g0)), lod1: rigOf(mesh(g1)), texture });
    });
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
  return bodies.size === BODY_IDS.length;
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

