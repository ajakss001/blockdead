import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import type { QualityLevel } from '../core/types';
import { bodyParts, type BodyShape, PART, type PartPose, type Ragdoll } from '../physics/ragdoll';
import type { Zombie, ZombieState } from '../systems/zombies';
import { ZombieAnimator } from '../zombies/animations';
import { createZombie, setZombieOutline, type ZombieInstance, type ZombieType } from '../zombies/buildZombie';
import { BONES, type BoneName, PARENT, boneIndex, ragdollShape, restWorld } from '../zombies/skeleton';
import { WORKER } from '../zombies/types';

/**
 * The procedural zombie models in the game (src/zombies): the nearest few zombies of a modelled kind (the
 * one-armed worker) are drawn as their own SkinnedMesh — one draw call each, outline included — and leave
 * the instanced crowd, which keeps drawing the rest (the far workers in his colours, one-armed).
 * Phones: 3 near models, no outline; better devices 6 / 10 with the outline.
 *
 * Clips: Idle / Walk / Run blended by speed (walk and run timed by the simulation's step phase, so the feet
 * keep pace), Attack when it lunges (the grab lands with the bite), HitReaction when staggered. Death is the
 * ragdoll's: it starts from the model's own pose, and a dead worker's corpse is the same model with its
 * bones driven by the ragdoll's bodies (a few at once; older ones go to the corpse batch).
 */

const TYPE_OF: Partial<Record<Zombie['kind'], ZombieType>> = { worker: WORKER };
/** Drawn as a model within this distance (m). */
const NEAR = 32;

const LIMITS: Record<QualityLevel, { live: number; dead: number; outline: boolean }> = {
  low: { live: 3, dead: 2, outline: false },
  medium: { live: 6, dead: 3, outline: true },
  high: { live: 10, dead: 4, outline: true },
};

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

interface Live {
  inst: ZombieInstance;
  anim: ZombieAnimator;
  id: number;
  last: ZombieState | null;
}

interface Corpse {
  inst: ZombieInstance;
  id: number;
  rd: Ragdoll;
  /** Per bone: the fixed offset from its ragdoll body (driven) or its local transform frozen at death. */
  rel: Matrix4[];
  done: boolean;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();
const _s = new Vector3();
const _rot = new Matrix4().makeRotationY(Math.PI);

export class ZombieModels {
  readonly group = new Group();
  /** Ids drawn here (the crowd skips them). */
  readonly shown = new Set<number>();
  private readonly live: Live[] = [];
  private readonly free: ZombieInstance[] = [];
  private readonly corpses: Corpse[] = [];
  private limits = LIMITS.low;

  constructor(level: QualityLevel) {
    this.group.name = 'zombie-models';
    this.configure(level);
  }

  configure(level: QualityLevel): void {
    this.limits = LIMITS[level];
    setZombieOutline(this.limits.outline);
  }

  get drawn(): number {
    return this.live.filter((l) => l.id >= 0).length + this.corpses.length;
  }

  /** Pick the nearest modelled zombies and pose them. */
  update(list: readonly Zombie[], eye: Vector3, dt: number): void {
    const want: { z: Zombie; d: number }[] = [];
    for (const z of list) {
      if (z.state === 'dead' || !TYPE_OF[z.kind]) continue;
      const d = (z.pos.x - eye.x) ** 2 + (z.pos.z - eye.z) ** 2;
      if (d < NEAR * NEAR && Math.abs(z.pos.y - eye.y) < 12) want.push({ z, d });
    }
    want.sort((a, b) => a.d - b.d);
    want.length = Math.min(want.length, this.limits.live);
    const ids = new Set(want.map((w) => w.z.id));
    // Slots whose zombie went away (dead, far, crowded out) are freed; the newly near get one.
    for (const l of this.live) {
      if (l.id >= 0 && !ids.has(l.id)) {
        this.shown.delete(l.id);
        l.id = -1;
        l.inst.mesh.visible = false;
      }
    }
    for (const { z } of want) {
      let l = this.live.find((x) => x.id === z.id);
      if (!l) {
        l = this.live.find((x) => x.id < 0) ?? this.newLive(TYPE_OF[z.kind]!);
        l.id = z.id;
        l.last = null;
        l.inst.mesh.visible = true;
        this.shown.add(z.id);
      }
      this.pose(l, z, dt);
    }
    // Corpses still falling.
    for (const c of this.corpses) if (!c.done) this.writeCorpse(c);
  }

  private newLive(type: ZombieType): Live {
    const inst = createZombie(type);
    this.group.add(inst.mesh);
    const anim = new ZombieAnimator(inst.mesh, type.animSpeed);
    for (const n of ['Idle', 'Walk', 'Run'] as const) anim.actions[n].play();
    anim.actions.Walk.timeScale = 0;
    anim.actions.Run.timeScale = 0;
    // The grab of the attack (0.55 s, ATTACK_HIT) lands with the simulation's bite (windup 0.55 s).
    anim.actions.Attack.timeScale = 1;
    const l: Live = { inst, anim, id: -1, last: null };
    this.live.push(l);
    return l;
  }

  private pose(l: Live, z: Zombie, dt: number): void {
    const m = l.inst.mesh;
    m.position.copy(z.pos);
    if (z.shake > 0) (m.position.x += (Math.random() - 0.5) * 0.24 * z.shake), (m.position.z += (Math.random() - 0.5) * 0.24 * z.shake);
    m.rotation.y = z.yaw + Math.PI;
    const a = l.anim.actions;
    const move = Math.min(1, z.speed / 0.25);
    const run = Math.min(1, Math.max(0, (z.speed - 0.8) / 0.4));
    const cyc = (((z.phase / (Math.PI * 2)) % 1) + 1) % 1;
    a.Walk.time = cyc * a.Walk.getClip().duration;
    a.Run.time = cyc * a.Run.getClip().duration;
    a.Idle.setEffectiveWeight(1 - move);
    a.Walk.setEffectiveWeight(move * (1 - run));
    a.Run.setEffectiveWeight(move * run);
    const s = z.state;
    if ((s === 'attack' && l.last !== 'attack') || (s === 'bang' && !a.Attack.isRunning())) a.Attack.reset().setEffectiveWeight(1).play();
    if (s === 'stagger' && l.last !== 'stagger') a.HitReaction.reset().setEffectiveWeight(1).play();
    l.last = s;
    l.anim.update(dt);
  }

  /**
   * A modelled zombie dies: where each ragdoll body starts (from the model's own animated bones) and the
   * build the ragdoll needs. Null if it was not drawn as a model (the crowd's pose is used then).
   */
  deathStart(z: Zombie, scale: number): { parts: PartPose[]; shape: BodyShape } | null {
    const l = this.live.find((x) => x.id === z.id);
    if (!l) return null;
    l.inst.mesh.updateMatrixWorld(true);
    const { shape, keys } = this.keys(l.inst, scale);
    const parts = keys.map((k, p) => {
      const w = l.inst.bones[PART_BONE.get(p)!].matrixWorld;
      _m.copy(w).multiply(k.inv);
      _m.decompose(_v, _q, _s);
      return { p: _v.clone(), q: _q.clone() };
    });
    return { parts, shape };
  }

  /** Per ragdoll body: P0⁻¹·M0·B′ (its rest frame from the bone's unstooped rest) and its inverse. */
  private keys(inst: ZombieInstance, scale: number): { shape: BodyShape; keys: { k: Matrix4; inv: Matrix4 }[] } {
    const dims = inst.built.dims;
    const shape = ragdollShape(dims);
    const straight = restWorld(dims, false);
    const m0 = _rot.clone().scale(_s.set(scale, scale, scale));
    const keys = bodyParts(shape).map((d, p) => {
      const b = PART_BONE.get(p)!;
      const k = new Matrix4().makeTranslation(-d.c[0] * scale, -d.c[1] * scale, -d.c[2] * scale).multiply(m0).multiply(straight[b]);
      return { k, inv: k.clone().invert() };
    });
    return { shape, keys };
  }

  /**
   * The dead model stays, its bones driven by the ragdoll. False when it was not drawn as a model. Over the
   * limit the oldest corpse leaves the models: returned so the scene can lay it in the corpse batch.
   */
  addCorpse(z: Zombie, rd: Ragdoll, scale: number): { ok: boolean; evicted: { id: number; rd: Ragdoll } | null } {
    const l = this.live.find((x) => x.id === z.id);
    if (!l) return { ok: false, evicted: null };
    let evicted: { id: number; rd: Ragdoll } | null = null;
    if (this.corpses.length >= this.limits.dead) {
      const old = this.corpses.shift()!;
      evicted = { id: old.id, rd: old.rd };
      this.releaseCorpse(old);
    }
    l.inst.mesh.updateMatrixWorld(true);
    const inst = this.free.pop() ?? createZombie(l.inst.built.type);
    const { keys } = this.keys(inst, scale);
    const rel = BONES.map((n, i) => {
      const p = DRIVEN[n];
      return p !== undefined ? keys[p].k.clone() : l.inst.bones[i].matrix.clone();
    });
    inst.mesh.position.set(0, 0, 0);
    inst.mesh.rotation.set(0, 0, 0);
    inst.mesh.frustumCulled = false;
    inst.mesh.visible = true;
    for (const b of inst.bones) (b.matrixAutoUpdate = false), (b.matrixWorldAutoUpdate = false);
    this.group.add(inst.mesh);
    const c: Corpse = { inst, id: z.id, rd, rel, done: false };
    this.corpses.push(c);
    this.writeCorpse(c);
    return { ok: true, evicted };
  }

  removeCorpse(id: number): void {
    const i = this.corpses.findIndex((c) => c.id === id);
    if (i >= 0) this.releaseCorpse(this.corpses.splice(i, 1)[0]);
  }

  /** The bones of a zombie drawn here: its corpse's if it has one, else its living model's (tests). */
  bones(id: number): ZombieInstance['bones'] | null {
    return (this.corpses.find((c) => c.id === id) ?? this.live.find((l) => l.id === id))?.inst.bones ?? null;
  }

  hasCorpse(id: number): boolean {
    return this.corpses.some((c) => c.id === id);
  }

  private releaseCorpse(c: Corpse): void {
    c.inst.mesh.visible = false;
    this.group.remove(c.inst.mesh);
    this.free.push(c.inst);
  }

  private writeCorpse(c: Corpse): void {
    const bones = c.inst.bones;
    BONES.forEach((n, i) => {
      const p = DRIVEN[n];
      const w = bones[i].matrixWorld;
      if (p !== undefined) c.rd.matrix(p, w).multiply(c.rel[i]);
      else w.multiplyMatrices(bones[boneIndex(PARENT[n]!)].matrixWorld, c.rel[i]);
    });
    if (c.rd.asleep) c.done = true;
  }

  dispose(): void {
    for (const l of this.live) l.anim.mixer.stopAllAction();
    this.group.clear();
  }
}
