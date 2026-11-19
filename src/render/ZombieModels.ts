import {
  type AnimationAction,
  AnimationMixer,
  type Bone,
  BufferGeometry,
  type Camera,
  Color,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LoopOnce,
  type Material,
  Matrix4,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  Sphere,
  Vector3,
} from 'three';
import { BASE_BODIES, type BaseBody, type BodyId, bodyAsset, bodyNow, clipFor, type ClipId, costumeBody, type RigAsset } from '../characters/assets';
import { coverBody, gearGeometry, gearKind, gearReady, gearTexture, hideBits, loadGear } from '../characters/gear';
import { characterMaterial, LENS_TINT } from '../characters/material';
import type { GearId } from '../data/items';
import { createBones, RagdollPose, ragdollStart } from '../characters/rig';
import type { QualityLevel } from '../core/types';
import type { BodyShape, PartPose, Ragdoll } from '../physics/ragdoll';
import { grim } from '../style/palette';
import { PHASE_M, type Zombie, type ZombieState } from '../systems/zombies';
import { ZOMBIE_STATS } from '../zombies/stats';
import { Twitch } from '../zombies/twitch';
import { zombieCostume, zombieGear } from '../zombies/costumes';
import { ZOMBIE_TYPES, type ZombieType } from '../zombies/types';

/** What a zombie wears over its clothes (by kind and costume, or its own: a twin's), cached by id. */
const gearCache = new Map<number, readonly GearId[]>();
function gearOf(z: Zombie, type: ZombieType): readonly GearId[] {
  if (z.gear) return z.gear;
  let g = gearCache.get(z.id);
  if (!g) {
    if (gearCache.size > 4096) gearCache.clear();
    const female = !!ZOMBIE_STATS[type.id].female;
    gearCache.set(z.id, (g = zombieGear(z.id, type.id, female, zombieCostume(z.id, type.id, female, z.costume))));
  }
  return g;
}

/** A kind as one zombie wears it: its costume's body once that is loaded (until then the base), scaled to the kind. */
const dressed = new Map<string, ZombieType>();
function dressOf(z: Zombie): ZombieType | undefined {
  const type = ZOMBIE_TYPES[z.kind];
  if (!type) return undefined;
  const female = !!ZOMBIE_STATS[type.id].female;
  const costume = zombieCostume(z.id, type.id, female, z.costume);
  // The costumes are men's: a woman's kind in one (a medic as a doctor) is a man of the kind's height.
  const sex: BaseBody = costume ? 'male' : type.body === 'female' ? 'female' : 'male';
  const want = costumeBody(costume, sex);
  const body = bodyNow(want) === want ? want : type.body;
  if (body === type.body) return type;
  const key = `${type.id}:${body}`;
  let t = dressed.get(key);
  if (!t) dressed.set(key, (t = { ...type, body, scale: ZOMBIE_STATS[type.id].height / bodyAsset(body).height }));
  return t;
}

/**
 * Every zombie is one of the character models at LOD1 (~3k triangles, 22 bones): per body (man, woman) one
 * instanced mesh skinned from a texture (a row of 22 bone matrices per instance), the kind's clothes as
 * per-instance tints — two draw calls whatever the crowd.
 *
 * Walk and Run are timed by the ground covered, not the clock: the step cycle moves on by distance / stride
 * (the clip's own stride, measured off its planted foot, × the kind's scale × the zombie's own ±10%), its
 * cycle offset by its own share, so a planted foot doesn't skid and a crowd doesn't step in time.
 *
 * Near (DETAIL): a real mixer each — zombie_idle / zombie_walk / zombie_running blended by speed, an attack
 * when it lunges (the grab lands with the bite), the scream when staggered, twitches of the head and hands
 * on top (zombies/twitch). Far: the body's baked loops by speed, copied, no mixer; past FAR_STEP m at half
 * the frame rate. Out of the camera's view or past the fog: not drawn.
 *
 * Death is the ragdoll's: it starts from the zombie's own pose, and the corpse is the same model with its
 * bones driven by the ragdoll's bodies (characters/rig RagdollPose), in the same batches.
 */

const DETAIL: Record<QualityLevel, { near: number; count: number; corpses: number }> = {
  low: { near: 14, count: 3, corpses: 24 },
  medium: { near: 22, count: 6, corpses: 32 },
  high: { near: 32, count: 10, corpses: 48 },
};
const FAR_STEP = 24;
const BAKE_FPS = 20;
/** The zombie's own stride against its clip's (±10%). */
const STRIDES = [0.9, 1, 1.1] as const;
/** The sim's windup: the grab of an attack lands this long after it starts. */
const ATTACK_HIT = 0.55;
type Gait = 'zombie_idle' | 'zombie_walk' | 'zombie_running';
const GAITS: Gait[] = ['zombie_idle', 'zombie_walk', 'zombie_running'];

/** What is known of a body for the crowd: its rig, baked loops, strides, its attacks' grab time. */
interface Kit {
  body: BodyId;
  rig: RigAsset;
  nb: number;
  floats: number;
  baked: Record<Gait, { frames: number; data: Float32Array }>;
  stride: Record<Gait, number>;
  hit: Record<'zombie_attack' | 'zombie_attack_2', number>;
  /** One arm gone (the one-armed worker): the left arm's bones. */
  arm: number[];
  shoulder: number;
}

const kits = new Map<BodyId, Kit>();

function kit(body: BodyId): Kit {
  let k = kits.get(body);
  if (k) return k;
  const rig = bodyAsset(body).lod1;
  const nb = rig.names.length;
  const floats = nb * 16;
  const root = new Group();
  const bones = createBones(rig);
  root.add(bones[0]);
  const mixer = new AnimationMixer(root);
  const m = new Matrix4();
  const toe = [rig.index.get('LeftToeBase')!, rig.index.get('RightToeBase')!];
  const hand = rig.index.get('RightHand')!;
  const sample = (name: ClipId, t: number) => {
    mixer.stopAllAction();
    const a = mixer.clipAction(clipFor(body, 1, name));
    a.reset().play();
    a.time = t;
    mixer.update(0);
    root.updateMatrixWorld(true);
  };
  const baked = {} as Kit['baked'];
  const stride = {} as Kit['stride'];
  for (const g of GAITS) {
    const dur = clipFor(body, 1, g).duration;
    const frames = Math.max(2, Math.round(dur * BAKE_FPS));
    const data = new Float32Array(frames * floats);
    const feet: { y: number; z: number }[][] = [[], []];
    for (let f = 0; f < frames; f++) {
      sample(g, (f / frames) * dur);
      bones.forEach((b, i) => m.multiplyMatrices(b.matrixWorld, rig.inverses[i]).toArray(data, f * floats + i * 16));
      toe.forEach((ti, s) => feet[s].push({ y: bones[ti].matrixWorld.elements[13], z: bones[ti].matrixWorld.elements[14] }));
    }
    baked[g] = { frames, data };
    // The stride: the planted foot slides back at the walking speed (the clip is in place).
    const speeds: number[] = [];
    for (let f = 0; f < frames; f++) {
      const s = feet[0][f].y < feet[1][f].y ? 0 : 1;
      const minY = Math.min(...feet[s].map((p) => p.y));
      if (feet[s][f].y > minY + 0.02) continue;
      const n = (f + 1) % frames;
      speeds.push(((feet[s][f].z - feet[s][n].z) * frames) / dur);
    }
    speeds.sort((a, b) => a - b);
    const v = speeds.length ? speeds[speeds.length >> 1] : 0;
    stride[g] = g === 'zombie_idle' ? 1 : Math.max(g === 'zombie_walk' ? 0.5 : 1, v * dur);
  }
  // When the grab lands: the right hand at its fastest in the first two seconds.
  const hit = {} as Kit['hit'];
  for (const a of ['zombie_attack', 'zombie_attack_2'] as const) {
    let best = 0.5;
    let top = 0;
    const prev = new Vector3();
    const cur = new Vector3();
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.min(2, clipFor(body, 1, a).duration);
      sample(a, t);
      cur.setFromMatrixPosition(bones[hand].matrixWorld);
      if (i > 0 && cur.distanceTo(prev) > top) (top = cur.distanceTo(prev)), (best = t);
      prev.copy(cur);
    }
    hit[a] = best;
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  const arm = ['LeftArm', 'LeftForeArm', 'LeftHand'].map((n) => rig.index.get(n)!);
  k = { body, rig, nb, floats, baked, stride, hit, arm, shoulder: rig.index.get('LeftArm')! };
  kits.set(body, k);
  return k;
}

/** One piece of gear over a body's layer: instances that ride on the body's skin rows (`aRow`). */
class GearLayer {
  mesh: InstancedMesh;
  rows: Float32Array;
  n = 0;

  constructor(
    readonly geometry: BufferGeometry,
    readonly material: Material,
    readonly cap: number,
    group: Group,
    name: string,
  ) {
    this.rows = new Float32Array(cap);
    const g = new BufferGeometry();
    for (const [k, a] of Object.entries(geometry.attributes)) g.setAttribute(k, a);
    g.setIndex(geometry.index);
    g.setAttribute('aRow', new InstancedBufferAttribute(this.rows, 1).setUsage(DynamicDrawUsage));
    g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.4);
    this.mesh = new InstancedMesh(g, material, cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    group.add(this.mesh);
  }

  push(m: Matrix4, row: number): void {
    this.mesh.setMatrixAt(this.n, m);
    this.rows[this.n++] = row;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.n * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    const a = this.mesh.geometry.getAttribute('aRow') as InstancedBufferAttribute;
    a.clearUpdateRanges();
    a.addUpdateRange(0, this.n);
    a.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * One instanced mesh of a body and its skin texture (a row per instance), and the gear worn over it: a mesh
 * per piece on the same rows; each instance's `aHide` keeps the body under its pieces from being drawn.
 */
class Layer {
  mesh!: InstancedMesh;
  tex!: DataTexture;
  data!: Float32Array;
  tints!: Float32Array;
  tints2!: Float32Array;
  hides!: Float32Array;
  cap = 0;
  count = 0;
  private readonly gear = new Map<string, GearLayer>();
  private readonly asked = new Set<GearId>();
  private readonly prevStatic: number[] = [];
  private readonly curStatic: number[] = [];
  private staticOk = true;
  private staticCount = 0;

  constructor(
    private readonly k: Kit,
    private readonly group: Group,
    cap: number,
  ) {
    this.make(cap);
  }

  private make(cap: number): void {
    const old = this.mesh ? { mesh: this.mesh, tex: this.tex, data: this.data, t: this.tints, t2: this.tints2, h: this.hides } : null;
    this.cap = cap;
    this.data = new Float32Array(cap * this.k.floats);
    this.tints = new Float32Array(cap * 3);
    this.tints2 = new Float32Array(cap * 3);
    this.hides = new Float32Array(cap);
    // The gear's meshes read the old skin texture: made again on the new one when next worn.
    for (const gl of this.gear.values()) gl.dispose();
    this.gear.clear();
    this.prevStatic.length = 0;
    coverBody(this.k.body);
    this.tex = new DataTexture(this.data, this.k.nb * 4, cap, RGBAFormat, FloatType);
    this.tex.minFilter = this.tex.magFilter = NearestFilter;
    this.tex.needsUpdate = true;
    const src = this.k.rig.geometry;
    const g = new BufferGeometry();
    for (const [name, a] of Object.entries(src.attributes)) g.setAttribute(name, a);
    g.setIndex(src.index);
    g.setAttribute('aTint', new InstancedBufferAttribute(this.tints, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aTint2', new InstancedBufferAttribute(this.tints2, 3).setUsage(DynamicDrawUsage));
    g.setAttribute('aHide', new InstancedBufferAttribute(this.hides, 1).setUsage(DynamicDrawUsage));
    g.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.4);
    // A costume keeps its own colours (only a little of the kind's tint); everyday clothes take the kind's.
    const costume = !BASE_BODIES.includes(this.k.body as BaseBody);
    this.mesh = new InstancedMesh(g, characterMaterial(bodyAsset(this.k.body), this.k.rig, { zombie: true, skin: this.tex, tintMix: costume ? 0.18 : 0.6, cover: true }), cap);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.name = `zombies-${this.k.body}`;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    if (old) {
      this.data.set(old.data);
      this.tints.set(old.t);
      this.tints2.set(old.t2);
      this.hides.set(old.h);
      (this.mesh.instanceMatrix.array as Float32Array).set(old.mesh.instanceMatrix.array as Float32Array);
      this.release(old.mesh, old.tex);
    }
  }

  begin(): void {
    this.count = 0;
    this.staticOk = true;
    this.staticCount = 0;
    for (const gl of this.gear.values()) gl.n = 0;
  }

  /** The next instance at `m` in the kind's clothes and `gear`: its skin row to fill. */
  push(m: Matrix4, tint: Color, tint2: Color, gear: readonly GearId[] = [], staticId = -1): Float32Array {
    if (this.count >= this.cap) this.make(this.cap * 2);
    if (staticId < 0) {
      this.staticOk = false;
    } else {
      if (this.staticOk && (this.staticCount >= this.prevStatic.length || this.prevStatic[this.staticCount] !== staticId)) {
        this.staticOk = false;
      }
      this.curStatic[this.staticCount++] = staticId;
    }
    this.mesh.setMatrixAt(this.count, m);
    tint.toArray(this.tints, this.count * 3);
    tint2.toArray(this.tints2, this.count * 3);
    let shown = 0;
    for (const g of gear) {
      const gl = this.gearLayer(g);
      if (!gl) continue;
      gl.push(m, this.count);
      this.gearLayer(g, true)?.push(m, this.count);
      shown |= hideBits([g]);
    }
    this.hides[this.count] = shown;
    return this.data.subarray(this.count * this.k.floats, ++this.count * this.k.floats);
  }

  /** A piece's mesh over this layer (null while it loads). */
  private gearLayer(g: GearId, lens = false): GearLayer | null {
    const key = lens ? `${g}:lens` : g;
    let gl = this.gear.get(key);
    if (gl && gl.n < gl.cap) return gl;
    const body = this.k.body;
    if (!gearReady(body, g)) {
      if (!this.asked.has(g)) {
        this.asked.add(g);
        void loadGear(body, [g]);
      }
      return null;
    }
    const geo = gearGeometry(body, g, 1, lens ? 'lens' : 'main');
    if (!geo) return null;
    const old = gl;
    const look = lens ? { skin: this.tex, row: true, lens: LENS_TINT[g] ?? 0x1e1f1d } : { skin: this.tex, row: true, map: gearTexture(g, true), doubleSide: gearKind(g) === 'mask' };
    gl = new GearLayer(geo, characterMaterial(bodyAsset(body), this.k.rig, look), Math.max(8, this.cap, (old?.cap ?? 0) * 2), this.group, `zombie-gear-${body}-${key}`);
    if (old) {
      // Grown: the instances so far carried over.
      (gl.mesh.instanceMatrix.array as Float32Array).set((old.mesh.instanceMatrix.array as Float32Array).subarray(0, old.n * 16));
      gl.rows.set(old.rows.subarray(0, old.n));
      gl.n = old.n;
      old.dispose();
    }
    this.gear.set(key, gl);
    return gl;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    for (const gl of this.gear.values()) gl.end();
    if (!this.count) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const n of ['aTint', 'aTint2', 'aHide']) {
      const a = this.mesh.geometry.getAttribute(n) as InstancedBufferAttribute;
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
    const texDirty = !this.staticOk || this.staticCount !== this.prevStatic.length;
    if (texDirty) {
      this.prevStatic.length = this.staticOk ? this.staticCount : 0;
      if (this.staticOk) {
        for (let i = 0; i < this.staticCount; i++) this.prevStatic[i] = this.curStatic[i];
      }
      this.tex.needsUpdate = true;
    }
  }

  private release(mesh: InstancedMesh, tex: DataTexture): void {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
    tex.dispose();
  }

  dispose(): void {
    for (const gl of this.gear.values()) gl.dispose();
    this.release(this.mesh, this.tex);
  }
}

/** A near zombie's own skeleton and mixer (pooled per body). */
interface Rig {
  k: Kit;
  root: Group;
  bones: Bone[];
  mixer: AnimationMixer;
  gait: Record<Gait, AnimationAction>;
  attack: AnimationAction;
  attackHit: number;
  scream: AnimationAction;
  /** Seconds left of the scream (staggered). */
  screamLeft: number;
  twitch: Twitch;
  id: number;
  last: ZombieState | null;
}

interface Corpse {
  id: number;
  type: ZombieType;
  pose: RagdollPose;
  skin: Float32Array;
  done: boolean;
  gear: readonly GearId[];
}

const _m = new Matrix4();
const _m2 = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _ident = new Matrix4();

const hash = (id: number, salt: number) => {
  const s = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const strideIx = (id: number) => Math.floor(hash(id, 3.3) * STRIDES.length) % STRIDES.length;
const _sphere = new Sphere();
const _frustum = new Frustum();

/** The kinds' clothes as linear tints (through grim), a little different per zombie. */
const tintCache = new Map<number, Color>();
function tintOf(hex: number): Color {
  let c = tintCache.get(hex);
  if (!c) tintCache.set(hex, (c = new Color().setHex(grim(hex))));
  return c;
}
const _t1 = new Color();
const _t2 = new Color();
function tints(z: { id: number }, type: ZombieType): [Color, Color] {
  const f = 0.85 + 0.3 * hash(z.id, 5.5);
  return [_t1.copy(tintOf(type.tint)).multiplyScalar(f), _t2.copy(tintOf(type.tint2)).multiplyScalar(0.9 + 0.2 * hash(z.id, 6.1))];
}

export class ZombieModels {
  readonly group = new Group();
  private readonly layers = new Map<BodyId, Layer>();
  private readonly rigs: Rig[] = [];
  private readonly corpses: Corpse[] = [];
  private readonly nearPool: { z: Zombie; d: number }[] = [];
  private readonly nearScratch: { z: Zombie; d: number }[] = [];
  private readonly liveSet = new Set<number>();
  private readonly corpseIds = new WeakMap<object, number>();
  private nextCorpseId = 1;
  /** Ids posed by a mixer this frame (the near ones). */
  readonly detailed = new Set<number>();
  private detail = DETAIL.low;
  private time = 0;
  private readonly steps = new Map<number, { c: number; phase: number }>();

  constructor(level: QualityLevel) {
    this.group.name = 'zombie-models';
    this.configure(level);
  }

  configure(level: QualityLevel): void {
    this.detail = DETAIL[level];
  }

  /** Instances drawn this frame (living and dead). */
  get drawn(): number {
    let n = 0;
    for (const l of this.layers.values()) n += l.count;
    return n;
  }

  private layer(body: BodyId): Layer {
    let l = this.layers.get(body);
    if (!l) {
      l = new Layer(kit(body), this.group, 8);
      this.layers.set(body, l);
    }
    return l;
  }

  update(list: readonly Zombie[], eye: Vector3, dt: number, camera?: Camera, far = 200): void {
    this.time += dt;
    if (camera) {
      camera.updateMatrixWorld();
      _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    const seen = (p: Vector3, r: number) => !camera || _frustum.intersectsSphere(_sphere.set(p, r));
    for (const l of this.layers.values()) l.begin();
    let nearN = 0;
    const r2 = this.detail.near * this.detail.near;
    for (const z of list) {
      if (z.state === 'dead' || !dressOf(z)) continue;
      const d = (z.pos.x - eye.x) ** 2 + (z.pos.z - eye.z) ** 2;
      if (d < r2 && Math.abs(z.pos.y - eye.y) < 12) {
        let slot = this.nearPool[nearN];
        if (!slot) this.nearPool[nearN] = slot = { z, d };
        else {
          slot.z = z;
          slot.d = d;
        }
        this.nearScratch[nearN++] = slot;
      }
    }
    this.nearScratch.length = nearN;
    if (nearN > 1) this.nearScratch.sort((a, b) => a.d - b.d);
    if (nearN > this.detail.count) this.nearScratch.length = this.detail.count;
    this.detailed.clear();
    for (let i = 0; i < this.nearScratch.length; i++) this.detailed.add(this.nearScratch[i].z.id);
    for (const r of this.rigs) if (r.id >= 0 && !this.detailed.has(r.id)) r.id = -1;
    const far2 = far * far;
    for (const z of list) {
      const type = dressOf(z);
      if (z.state === 'dead' || !type) continue;
      const d2 = (z.pos.x - eye.x) ** 2 + (z.pos.z - eye.z) ** 2;
      if (d2 > far2) continue;
      const l = this.layer(type.body);
      _v.set(z.pos.x, z.pos.y + 0.9, z.pos.z);
      const inView = seen(_v, 1.3);
      const [t1, t2] = tints(z, type);
      if (this.detailed.has(z.id)) {
        const rig = this.rig(z, type);
        this.pose(rig, z, type, dt);
        if (inView) this.writeRig(rig, type, l.push(this.placement(z, type, _m), t1, t2, gearOf(z, type)));
      } else if (inView) {
        const row = l.push(this.placement(z, type, _m), t1, t2, gearOf(z, type));
        row.set(this.bakedFrame(kit(type.body), type, z, d2 > FAR_STEP * FAR_STEP));
        if (ZOMBIE_STATS[type.id].oneArm) this.dropArm(kit(type.body), row, row);
      }
    }
    for (let ci = 0; ci < this.corpses.length; ci++) {
      const c = this.corpses[ci];
      if (!c.done) this.writeCorpse(c);
      _v.setFromMatrixPosition(c.pose.world[0]);
      const d2 = (_v.x - eye.x) ** 2 + (_v.z - eye.z) ** 2;
      if (d2 > far2 || !seen(_v, 1.4)) continue;
      let sid = -1;
      if (c.done) {
        sid = this.corpseIds.get(c) ?? 0;
        if (!sid) {
          sid = this.nextCorpseId++;
          this.corpseIds.set(c, sid);
        }
      }
      const [t1, t2] = tints(c, c.type);
      this.layer(c.type.body).push(_ident, t1, t2, c.gear, sid).set(c.skin);
    }
    for (const l of this.layers.values()) l.end();
    if (this.steps.size > list.length + 64) {
      this.liveSet.clear();
      for (let i = 0; i < list.length; i++) this.liveSet.add(list[i].id);
      for (const id of this.steps.keys()) if (!this.liveSet.has(id)) this.steps.delete(id);
    }
  }

  /** Where a zombie is in its Walk / Run cycle (0..1): moved on by the ground covered over its stride. */
  private cycle(z: Zombie, type: ZombieType, run: number): number {
    let s = this.steps.get(z.id);
    if (!s) {
      s = { c: hash(z.id, 7.1), phase: z.phase };
      this.steps.set(z.id, s);
    }
    const k = kit(type.body);
    const stride = (k.stride.zombie_walk + (k.stride.zombie_running - k.stride.zombie_walk) * run) * type.scale * STRIDES[strideIx(z.id)];
    s.c = (((s.c + ((z.phase - s.phase) / (Math.PI * 2)) * (PHASE_M / stride)) % 1) + 1) % 1;
    s.phase = z.phase;
    return s.c;
  }

  /** Where a zombie stands: the model faces +Z, turned by its yaw, scaled to its kind. */
  private placement(z: Zombie, type: ZombieType, out: Matrix4): Matrix4 {
    _v.copy(z.pos);
    if (z.shake > 0) (_v.x += (Math.random() - 0.5) * 0.24 * z.shake), (_v.z += (Math.random() - 0.5) * 0.24 * z.shake);
    return out.compose(_v, _q.setFromAxisAngle(_up, z.yaw), _s.setScalar(type.scale));
  }

  private bakedFrame(k: Kit, type: ZombieType, z: Zombie, half: boolean): Float32Array {
    const idle = z.speed < 0.15;
    const running = z.speed >= 0.9;
    const g: Gait = idle ? 'zombie_idle' : running ? 'zombie_running' : 'zombie_walk';
    const clip = k.baked[g];
    const cyc = idle ? (this.time * type.animSpeed) / (clip.frames / BAKE_FPS) + (z.id % 17) / 17 : this.cycle(z, type, running ? 1 : 0);
    let f = Math.floor((((cyc % 1) + 1) % 1) * clip.frames) % clip.frames;
    if (half) f -= f & 1;
    return clip.data.subarray(f * k.floats, (f + 1) * k.floats);
  }

  /** The one-armed: the left arm's bones folded into its shoulder joint (no geometry shows). */
  private dropArm(k: Kit, row: Float32Array, src: Float32Array): void {
    // Shoulder joint now = skin(shoulder) applied to its bind position.
    const bind = k.rig.bind[k.shoulder];
    _m.fromArray(src, k.shoulder * 16).multiply(bind);
    _m2.makeScale(0, 0, 0).setPosition(_v.setFromMatrixPosition(_m));
    for (const i of k.arm) _m2.toArray(row, i * 16);
  }

  private rig(z: Zombie, type: ZombieType): Rig {
    const k = kit(type.body);
    let r = this.rigs.find((x) => x.id === z.id);
    if (r && r.k === k) return r;
    // Its costume has just loaded: another body's rig.
    if (r) r.id = -1;
    r = this.rigs.find((x) => x.id < 0 && x.k === k);
    if (!r) {
      const bones = createBones(k.rig);
      const root = new Group();
      root.add(bones[0]);
      const mixer = new AnimationMixer(root);
      const act = (n: ClipId) => mixer.clipAction(clipFor(k.body, 1, n));
      const gait = { zombie_idle: act('zombie_idle'), zombie_walk: act('zombie_walk'), zombie_running: act('zombie_running') };
      for (const a of Object.values(gait)) a.play();
      gait.zombie_walk.timeScale = gait.zombie_running.timeScale = 0;
      const which = this.rigs.length % 2 ? 'zombie_attack_2' : 'zombie_attack';
      const attack = act(which).setLoop(LoopOnce, 1);
      const scream = act('zombie_scream').setLoop(LoopOnce, 1);
      const idx = (n: string) => k.rig.index.get(n)!;
      const twitch = new Twitch(this.rigs.length + 1, k.rig.restRot, {
        head: idx('Head'),
        neck: idx('Neck'),
        hands: [idx('LeftHand'), idx('RightHand')],
        shoulders: [idx('LeftArm'), idx('RightArm')],
      });
      r = { k, root, bones, mixer, gait, attack, attackHit: k.hit[which], scream, screamLeft: 0, twitch, id: -1, last: null };
      this.rigs.push(r);
    }
    r.id = z.id;
    r.last = null;
    return r;
  }

  private pose(r: Rig, z: Zombie, type: ZombieType, dt: number): void {
    const a = r.gait;
    const move = Math.min(1, z.speed / 0.25);
    const run = Math.min(1, Math.max(0, (z.speed - 0.8) / 0.4));
    const cyc = this.cycle(z, type, run);
    a.zombie_walk.time = cyc * a.zombie_walk.getClip().duration;
    a.zombie_running.time = cyc * a.zombie_running.getClip().duration;
    a.zombie_idle.timeScale = type.animSpeed;
    let over = 0;
    const s = z.state;
    if ((s === 'attack' && r.last !== 'attack') || (s === 'bang' && !r.attack.isRunning())) {
      r.attack.reset().play();
      r.attack.time = Math.max(0, r.attackHit - ATTACK_HIT);
    }
    if (r.attack.isRunning()) {
      const left = r.attack.time - r.attackHit;
      over = Math.min(1, (r.attack.time - Math.max(0, r.attackHit - ATTACK_HIT)) / 0.12) * (left > 0.45 ? Math.max(0, 1 - (left - 0.45) / 0.3) : 1);
      if (left > 0.75) r.attack.stop();
    }
    if (s === 'stagger' && r.last !== 'stagger') {
      r.scream.reset().play();
      r.scream.time = 0.2;
      r.screamLeft = 0.9;
    }
    let scream = 0;
    if (r.screamLeft > 0) {
      r.screamLeft -= dt;
      scream = Math.min(1, r.screamLeft / 0.25, (0.9 - r.screamLeft) / 0.1 + 0.2);
      if (r.screamLeft <= 0) r.scream.stop();
    }
    r.attack.setEffectiveWeight(over);
    r.scream.setEffectiveWeight(scream);
    const rest = Math.max(0, 1 - over - scream);
    a.zombie_idle.setEffectiveWeight((1 - move) * rest);
    a.zombie_walk.setEffectiveWeight(move * (1 - run) * rest);
    a.zombie_running.setEffectiveWeight(move * run * rest);
    r.last = s;
    r.twitch.reset(r.bones);
    if (z.snap) {
      z.snap = false;
      r.twitch.snapHead();
    }
    r.mixer.update(dt);
    r.twitch.apply(r.bones, dt);
    r.root.updateMatrixWorld(true);
  }

  private writeRig(r: Rig, type: ZombieType, out: Float32Array): void {
    const inv = r.k.rig.inverses;
    r.bones.forEach((b, i) => _m2.multiplyMatrices(b.matrixWorld, inv[i]).toArray(out, i * 16));
    if (ZOMBIE_STATS[type.id].oneArm) this.dropArm(r.k, out, out);
  }

  /** A zombie's bones now (world): its mixer's if near, else its baked frame's. */
  private boneWorld(z: Zombie, type: ZombieType): Matrix4[] {
    const k = kit(type.body);
    const place = this.placement(z, type, new Matrix4());
    const rig = this.rigs.find((x) => x.id === z.id);
    if (rig) return rig.bones.map((b) => place.clone().multiply(b.matrixWorld));
    const skin = this.bakedFrame(k, type, z, false);
    return k.rig.bind.map((bind, i) => place.clone().multiply(_m2.fromArray(skin, i * 16)).multiply(bind));
  }

  /** A zombie dies: where each ragdoll body starts (from its bones as drawn), the build, its scale. */
  deathStart(z: Zombie): { parts: PartPose[]; shape: BodyShape; scale: number } | null {
    const type = dressOf(z);
    if (!type) return null;
    const k = kit(type.body);
    return { ...ragdollStart(type.body, 1, k.rig, this.boneWorld(z, type)), scale: type.scale };
  }

  addCorpse(z: Zombie, rd: Ragdoll): { ok: boolean; evicted: number | null } {
    const type = dressOf(z);
    if (!type) return { ok: false, evicted: null };
    const evicted = this.corpses.length >= this.detail.corpses ? this.corpses.shift()!.id : null;
    const k = kit(type.body);
    const c: Corpse = { id: z.id, type, pose: new RagdollPose(type.body, 1, k.rig, this.boneWorld(z, type), rd, type.scale), skin: new Float32Array(k.floats), done: false, gear: gearOf(z, type) };
    this.corpses.push(c);
    this.writeCorpse(c);
    return { ok: true, evicted };
  }

  removeCorpse(id: number): void {
    const i = this.corpses.findIndex((c) => c.id === id);
    if (i >= 0) this.corpses.splice(i, 1);
  }

  hasCorpse(id: number): boolean {
    return this.corpses.some((c) => c.id === id);
  }

  /** The bones' world matrices: a corpse's by id, or a living zombie's as drawn (tests). */
  bones(z: Zombie | number): Matrix4[] | null {
    if (typeof z === 'number') return this.corpses.find((c) => c.id === z)?.pose.world ?? null;
    const type = dressOf(z);
    return type ? this.boneWorld(z, type) : null;
  }

  /** The rig of the corpses' and zombies' bones (names, parents: tests). */
  rigOf(z: Zombie): RigAsset | null {
    const type = dressOf(z);
    return type ? kit(type.body).rig : null;
  }

  private writeCorpse(c: Corpse): void {
    const k = kit(c.type.body);
    const world = c.pose.update();
    world.forEach((w, i) => _m2.multiplyMatrices(w, k.rig.inverses[i]).toArray(c.skin, i * 16));
    if (ZOMBIE_STATS[c.type.id].oneArm) this.dropArm(k, c.skin, c.skin);
    if (c.pose.rd.asleep) c.done = true;
  }

  dispose(): void {
    for (const r of this.rigs) r.mixer.stopAllAction();
    for (const l of this.layers.values()) l.dispose();
    this.layers.clear();
    this.group.clear();
  }
}
