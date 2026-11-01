import {
  type Camera,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  Frustum,
  Group,
  InstancedMesh,
  Matrix4,
  NearestFilter,
  Quaternion,
  RGBAFormat,
  Sphere,
  Vector3,
} from 'three';
import type { QualityLevel } from '../core/types';
import { bodyParts, type BodyShape, PART, type PartPose, type Ragdoll } from '../physics/ragdoll';
import type { Zombie, ZombieState } from '../systems/zombies';
import { ZombieAnimator } from '../zombies/animations';
import { BAKE_FPS, type Baked, bakeType, SKIN_FLOATS } from '../zombies/bake';
import { type BuiltZombie, buildZombie, setZombieOutline, zombieBatchMaterial, zombieGeometryView, type ZombieType } from '../zombies/buildZombie';
import { BONES, type BoneName, PARENT, boneIndex, createBones, ragdollShape, restWorld } from '../zombies/skeleton';
import { ZOMBIE_TYPES } from '../zombies/types';

/**
 * Every zombie is one of the procedural models (src/zombies), drawn up to the fog's edge. Per type two
 * instanced meshes skinned from a texture (a row of 18 skin matrices per instance): one draw call for the
 * near ones (with the outline), one for the far ones (without) — at most 2 × the types in view, whatever
 * the crowd.
 *
 * Near (DETAIL: 14 / 22 / 32 m, the nearest 3 / 6 / 10): a real mixer each — Idle / Walk / Run blended by
 * speed (walk and run timed by the simulation's step phase), Attack when it lunges (the grab lands with the
 * bite), HitReaction when staggered. Far: the type's baked loops (zombies/bake.ts) by speed, copied, no
 * mixer; past FAR_STEP m at half the frame rate. Out of the camera's view or past the fog: not drawn.
 *
 * Death is the ragdoll's: it starts from the zombie's own pose (its mixer's or its baked frame), and the
 * corpse is the same model with its bones driven by the ragdoll's bodies, in the same batches (the oldest
 * leave past the limit; the scene is told).
 */

const DETAIL: Record<QualityLevel, { near: number; count: number; outline: boolean; corpses: number }> = {
  low: { near: 14, count: 3, outline: false, corpses: 24 },
  medium: { near: 22, count: 6, outline: true, corpses: 32 },
  high: { near: 32, count: 10, outline: true, corpses: 48 },
};
/** Far zombies past this (m) step their baked loop at half the rate. */
const FAR_STEP = 24;

/** Which ragdoll body moves a bone (the ragdoll faces +Z, the model −Z: its left is the ragdoll's "R"). */
const DRIVEN: Partial<Record<BoneName, number>> = {
  Hips: PART.pelvis,
  Chest: PART.chest,
  Neck: PART.head,
  UpperArm_L: PART.upperArmR,
  LowerArm_L: PART.foreArmR,
  UpperArm_R: PART.upperArmL,
  LowerArm_R: PART.foreArmL,
  UpperLeg_L: PART.thighR,
  LowerLeg_L: PART.shinR,
  UpperLeg_R: PART.thighL,
  LowerLeg_R: PART.shinL,
};
const PART_BONE = new Map(Object.entries(DRIVEN).map(([b, p]) => [p, boneIndex(b as BoneName)]));
const NB = BONES.length;

/** One instanced mesh of a type and its skin texture (a row per instance). */
class Layer {
  mesh!: InstancedMesh;
  tex!: DataTexture;
  data!: Float32Array;
  cap = 0;
  count = 0;

  constructor(
    private readonly built: BuiltZombie,
    private readonly group: Group,
    private outline: boolean,
    cap: number,
  ) {
    [this.mesh, this.tex, this.data] = this.make(cap);
  }

  private make(cap: number): [InstancedMesh, DataTexture, Float32Array] {
    this.cap = cap;
    const data = new Float32Array(cap * SKIN_FLOATS);
    const tex = new DataTexture(data, NB * 4, cap, RGBAFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.needsUpdate = true;
    const mesh = new InstancedMesh(zombieGeometryView(this.built, this.outline), zombieBatchMaterial(tex), cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.name = `zombies-${this.built.type.id}${this.outline ? '-near' : ''}`;
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.visible = false;
    this.group.add(mesh);
    return [mesh, tex, data];
  }

  setOutline(on: boolean): void {
    if (on === this.outline) return;
    this.outline = on;
    this.mesh.geometry.setDrawRange(0, (on ? this.built.triangles + this.built.outlineTriangles : this.built.triangles) * 3);
  }

  /** The next instance at `m`: its skin row to fill. */
  push(m: Matrix4): Float32Array {
    if (this.count >= this.cap) this.grow();
    this.mesh.setMatrixAt(this.count, m);
    return this.data.subarray(this.count * SKIN_FLOATS, ++this.count * SKIN_FLOATS);
  }

  private grow(): void {
    const old = { mesh: this.mesh, tex: this.tex, data: this.data };
    [this.mesh, this.tex, this.data] = this.make(this.cap * 2);
    this.data.set(old.data);
    (this.mesh.instanceMatrix.array as Float32Array).set(old.mesh.instanceMatrix.array as Float32Array);
    this.release(old.mesh, old.tex);
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    if (!this.count) return;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tex.needsUpdate = true;
  }

  private release(mesh: InstancedMesh, tex: DataTexture): void {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as { dispose(): void }).dispose();
    tex.dispose();
  }

  dispose(): void {
    this.release(this.mesh, this.tex);
  }
}

interface Batch {
  built: BuiltZombie;
  baked: Baked;
  near: Layer;
  far: Layer;
}

/** A near zombie's own skeleton and mixer (pooled per type). */
interface Rig {
  type: ZombieType;
  root: Group;
  bones: ReturnType<typeof createBones>;
  anim: ZombieAnimator;
  id: number;
  last: ZombieState | null;
}

interface Corpse {
  id: number;
  type: ZombieType;
  rd: Ragdoll;
  /** Per bone: the fixed offset from its ragdoll body (driven) or its local transform frozen at death. */
  rel: Matrix4[];
  /** The bones' world matrices now, and the skin row they make. */
  world: Matrix4[];
  skin: Float32Array;
  done: boolean;
}

const _m = new Matrix4();
const _m2 = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);
const _one = new Vector3(1, 1, 1);
const _rot = new Matrix4().makeRotationY(Math.PI);
const _ident = new Matrix4();
const _sphere = new Sphere();
const _frustum = new Frustum();

export class ZombieModels {
  readonly group = new Group();
  private readonly batches = new Map<string, Batch>();
  private readonly rigs: Rig[] = [];
  private readonly corpses: Corpse[] = [];
  /** Ids posed by a mixer this frame (the near ones). */
  readonly detailed = new Set<number>();
  private detail = DETAIL.low;
  private time = 0;

  constructor(level: QualityLevel) {
    this.group.name = 'zombie-models';
    this.configure(level);
  }

  configure(level: QualityLevel): void {
    this.detail = DETAIL[level];
    setZombieOutline(this.detail.outline);
    for (const b of this.batches.values()) b.near.setOutline(this.detail.outline);
  }

  /** Instances drawn this frame (living and dead). */
  get drawn(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.near.count + b.far.count;
    return n;
  }

  private batch(type: ZombieType): Batch {
    let b = this.batches.get(type.id);
    if (!b) {
      const built = buildZombie(type);
      b = { built, baked: bakeType(type), near: new Layer(built, this.group, this.detail.outline, 4), far: new Layer(built, this.group, false, 8) };
      this.batches.set(type.id, b);
    }
    return b;
  }

  /**
   * Draw the zombies — the living in `list` and the corpses: the nearest with their mixers, the rest from
   * the baked loops, up to `far` m from the eye and inside the camera's view.
   */
  update(list: readonly Zombie[], eye: Vector3, dt: number, camera?: Camera, far = 200): void {
    this.time += dt;
    if (camera) {
      camera.updateMatrixWorld();
      _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    const seen = (p: Vector3, r: number) => !camera || _frustum.intersectsSphere(_sphere.set(p, r));
    for (const b of this.batches.values()) b.near.count = b.far.count = 0;
    // The nearest few get a mixer.
    const near: { z: Zombie; d: number }[] = [];
    const r2 = this.detail.near * this.detail.near;
    for (const z of list) {
      if (z.state === 'dead' || !ZOMBIE_TYPES[z.kind]) continue;
      const d = (z.pos.x - eye.x) ** 2 + (z.pos.z - eye.z) ** 2;
      if (d < r2 && Math.abs(z.pos.y - eye.y) < 12) near.push({ z, d });
    }
    near.sort((a, b) => a.d - b.d);
    near.length = Math.min(near.length, this.detail.count);
    this.detailed.clear();
    for (const w of near) this.detailed.add(w.z.id);
    for (const r of this.rigs) if (r.id >= 0 && !this.detailed.has(r.id)) r.id = -1;
    const far2 = far * far;
    for (const z of list) {
      const type = ZOMBIE_TYPES[z.kind];
      if (z.state === 'dead' || !type) continue;
      const d2 = (z.pos.x - eye.x) ** 2 + (z.pos.z - eye.z) ** 2;
      if (d2 > far2) continue;
      const b = this.batch(type);
      _v.set(z.pos.x, z.pos.y + 0.9, z.pos.z);
      const inView = seen(_v, 1.3);
      if (this.detailed.has(z.id)) {
        // Posed even when out of view: it turns into view mid-step and its death starts from this pose.
        const rig = this.rig(z, type);
        this.pose(rig, z, dt);
        if (inView) this.writeRig(rig, b.near.push(this.placement(z, _m)));
      } else if (inView) {
        b.far.push(this.placement(z, _m)).set(this.bakedFrame(b.baked, type, z, d2 > FAR_STEP * FAR_STEP));
      }
    }
    // Corpses (still falling ones follow their ragdolls).
    for (const c of this.corpses) {
      if (!c.done) this.writeCorpse(c);
      _v.setFromMatrixPosition(c.world[0]);
      const d2 = (_v.x - eye.x) ** 2 + (_v.z - eye.z) ** 2;
      if (d2 > far2 || !seen(_v, 1.4)) continue;
      const b = this.batch(c.type);
      (d2 < r2 ? b.near : b.far).push(_ident).set(c.skin);
    }
    for (const b of this.batches.values()) b.near.end(), b.far.end();
  }

  /** Where a zombie stands (its model faces −Z: turned by π). */
  private placement(z: Zombie, out: Matrix4): Matrix4 {
    _v.copy(z.pos);
    if (z.shake > 0) (_v.x += (Math.random() - 0.5) * 0.24 * z.shake), (_v.z += (Math.random() - 0.5) * 0.24 * z.shake);
    return out.compose(_v, _q.setFromAxisAngle(_up, z.yaw + Math.PI), _one);
  }

  /** The baked loop for a zombie's speed now (by its step phase when walking or running). */
  private bakedFrame(baked: Baked, type: ZombieType, z: Zombie, half: boolean): Float32Array {
    const idle = z.speed < 0.15;
    const clip = idle ? baked.clips.Idle : z.speed < 0.9 ? baked.clips.Walk : baked.clips.Run;
    const cyc = idle ? (this.time * type.animSpeed) / (clip.frames / BAKE_FPS) + (z.id % 17) / 17 : z.phase / (Math.PI * 2);
    let f = Math.floor((((cyc % 1) + 1) % 1) * clip.frames) % clip.frames;
    if (half) f -= f & 1;
    return clip.data.subarray(f * SKIN_FLOATS, (f + 1) * SKIN_FLOATS);
  }

  private rig(z: Zombie, type: ZombieType): Rig {
    let r = this.rigs.find((x) => x.id === z.id);
    if (r) return r;
    r = this.rigs.find((x) => x.id < 0 && x.type === type);
    if (!r) {
      const bones = createBones(buildZombie(type).dims);
      const root = new Group();
      root.add(bones[0]);
      const anim = new ZombieAnimator(root, type.animSpeed);
      for (const n of ['Idle', 'Walk', 'Run'] as const) anim.actions[n].play();
      anim.actions.Walk.timeScale = 0;
      anim.actions.Run.timeScale = 0;
      // The grab of the attack (0.55 s, ATTACK_HIT) lands with the simulation's bite (windup 0.55 s).
      anim.actions.Attack.timeScale = 1;
      r = { type, root, bones, anim, id: -1, last: null };
      this.rigs.push(r);
    }
    r.id = z.id;
    r.last = null;
    return r;
  }

  private pose(r: Rig, z: Zombie, dt: number): void {
    const a = r.anim.actions;
    const move = Math.min(1, z.speed / 0.25);
    const run = Math.min(1, Math.max(0, (z.speed - 0.8) / 0.4));
    const cyc = (((z.phase / (Math.PI * 2)) % 1) + 1) % 1;
    a.Walk.time = cyc * a.Walk.getClip().duration;
    a.Run.time = cyc * a.Run.getClip().duration;
    a.Idle.setEffectiveWeight(1 - move);
    a.Walk.setEffectiveWeight(move * (1 - run));
    a.Run.setEffectiveWeight(move * run);
    const s = z.state;
    if ((s === 'attack' && r.last !== 'attack') || (s === 'bang' && !a.Attack.isRunning())) a.Attack.reset().setEffectiveWeight(1).play();
    if (s === 'stagger' && r.last !== 'stagger') a.HitReaction.reset().setEffectiveWeight(1).play();
    r.last = s;
    r.anim.update(dt);
    r.root.updateMatrixWorld(true);
  }

  private writeRig(r: Rig, out: Float32Array): void {
    const inv = buildZombie(r.type).inverses;
    r.bones.forEach((b, i) => _m2.multiplyMatrices(b.matrixWorld, inv[i]).toArray(out, i * 16));
  }

  /** A zombie's bones now (world): its mixer's if near, else its baked frame's. */
  private boneWorld(z: Zombie, type: ZombieType): Matrix4[] {
    const place = this.placement(z, new Matrix4());
    const rig = this.rigs.find((x) => x.id === z.id);
    if (rig) return rig.bones.map((b) => place.clone().multiply(b.matrixWorld));
    const skin = this.bakedFrame(this.batch(type).baked, type, z, false);
    return buildZombie(type).rest.map((rest, i) => place.clone().multiply(_m2.fromArray(skin, i * 16)).multiply(rest));
  }

  /**
   * A zombie dies: where each ragdoll body starts (from its own bones as drawn) and the build the ragdoll
   * needs (the model is built at its own height: no scale).
   */
  deathStart(z: Zombie): { parts: PartPose[]; shape: BodyShape } | null {
    const type = ZOMBIE_TYPES[z.kind];
    if (!type) return null;
    const world = this.boneWorld(z, type);
    const { shape, keys } = this.keys(buildZombie(type));
    const parts = keys.map((k, p) => {
      _m.copy(world[PART_BONE.get(p)!]).multiply(k.inv);
      _m.decompose(_v, _q, _s);
      return { p: _v.clone(), q: _q.clone() };
    });
    return { parts, shape };
  }

  /** Per ragdoll body: P0⁻¹·M0·B′ (its rest frame from the bone's unstooped rest) and its inverse. */
  private keys(built: BuiltZombie): { shape: BodyShape; keys: { k: Matrix4; inv: Matrix4 }[] } {
    const shape = ragdollShape(built.dims);
    const straight = restWorld(built.dims, false);
    const keys = bodyParts(shape).map((d, p) => {
      const b = PART_BONE.get(p)!;
      const k = new Matrix4().makeTranslation(-d.c[0], -d.c[1], -d.c[2]).multiply(_rot).multiply(straight[b]);
      return { k, inv: k.clone().invert() };
    });
    return { shape, keys };
  }

  /**
   * The dead zombie stays as its model, its bones driven by the ragdoll. Over the limit the oldest corpse
   * goes: its id is returned so the scene can let its ragdoll and loot go.
   */
  addCorpse(z: Zombie, rd: Ragdoll): { ok: boolean; evicted: number | null } {
    const type = ZOMBIE_TYPES[z.kind];
    if (!type) return { ok: false, evicted: null };
    const evicted = this.corpses.length >= this.detail.corpses ? this.corpses.shift()!.id : null;
    const world = this.boneWorld(z, type);
    const { keys } = this.keys(buildZombie(type));
    const rel = BONES.map((n, i) => {
      const p = DRIVEN[n];
      if (p !== undefined) return keys[p].k.clone();
      return world[boneIndex(PARENT[n]!)].clone().invert().multiply(world[i]);
    });
    const c: Corpse = { id: z.id, type, rd, rel, world, skin: new Float32Array(SKIN_FLOATS), done: false };
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
    if (typeof z === 'number') return this.corpses.find((c) => c.id === z)?.world ?? null;
    const type = ZOMBIE_TYPES[z.kind];
    return type ? this.boneWorld(z, type) : null;
  }

  private writeCorpse(c: Corpse): void {
    const inv = buildZombie(c.type).inverses;
    BONES.forEach((n, i) => {
      const p = DRIVEN[n];
      const w = c.world[i];
      if (p !== undefined) c.rd.matrix(p, w).multiply(c.rel[i]);
      else w.multiplyMatrices(c.world[boneIndex(PARENT[n]!)], c.rel[i]);
      _m2.multiplyMatrices(w, inv[i]).toArray(c.skin, i * 16);
    });
    if (c.rd.asleep) c.done = true;
  }

  dispose(): void {
    for (const r of this.rigs) r.anim.mixer.stopAllAction();
    for (const b of this.batches.values()) b.near.dispose(), b.far.dispose();
    this.batches.clear();
    this.group.clear();
  }
}
