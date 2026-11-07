import { type AnimationAction, AnimationMixer, Bone, type BufferGeometry, Group, Matrix4, Quaternion, Skeleton, SkinnedMesh, Sphere, Vector3 } from 'three';
import { type BodyShape, bodyParts, PART, type PartPose, type Ragdoll } from '../physics/ragdoll';
import { type BodyId, bodyAsset, boneName, clipFor, type ClipId, type RigAsset } from './assets';
import { type CharacterLook, characterMaterial } from './material';

/**
 * A character on the Mixamo skeleton: its own bones (from the body's rig at bind), the shared geometry and
 * a mixer. Faces +Z, feet at the origin once a clip plays (the clips carry the hips' height).
 * Sockets: what is held on RightHand, a bag on Spine2, a hat on Head, what hangs at the belt on Hips.
 */

export type SocketId = 'hand' | 'back' | 'head' | 'hips';
export const SOCKET_BONE: Record<SocketId, string> = { hand: 'RightHand', back: 'Spine2', head: 'Head', hips: 'Hips' };

export function createBones(rig: RigAsset): Bone[] {
  const bones = rig.names.map((n, i) => {
    const b = new Bone();
    b.name = boneName(n);
    b.position.copy(rig.restPos[i]);
    b.quaternion.copy(rig.restRot[i]);
    return b;
  });
  rig.parents.forEach((p, i) => p >= 0 && bones[p].add(bones[i]));
  return bones;
}

export class CharacterRig {
  readonly root = new Group();
  readonly mesh: SkinnedMesh;
  readonly bones: Bone[];
  readonly mixer: AnimationMixer;
  readonly rig: RigAsset;
  private readonly actions = new Map<ClipId, AnimationAction>();

  constructor(
    readonly body: BodyId,
    readonly lod: 0 | 1 = 0,
    look: CharacterLook = {},
    /** A part of the body's geometry instead of all of it (the first-person body: no head, no arms). */
    geometry?: BufferGeometry,
  ) {
    const asset = bodyAsset(body);
    this.rig = lod ? asset.lod1 : asset.lod0;
    this.bones = createBones(this.rig);
    this.mesh = new SkinnedMesh(geometry ?? this.rig.geometry, characterMaterial(asset, this.rig, look));
    this.mesh.name = `character-${body}`;
    this.mesh.add(this.bones[0]);
    this.mesh.bind(new Skeleton(this.bones, this.rig.inverses.map((m) => m.clone())), new Matrix4());
    // Generous bounds round the body in any pose (no per-frame bone bounds).
    this.mesh.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.4);
    this.mesh.frustumCulled = false;
    this.root.add(this.mesh);
    this.mixer = new AnimationMixer(this.mesh);
  }

  bone(name: string): Bone {
    return this.bones[this.rig.index.get(name) ?? 0];
  }

  socket(id: SocketId): Bone {
    return this.bone(SOCKET_BONE[id]);
  }

  action(name: ClipId): AnimationAction {
    let a = this.actions.get(name);
    if (!a) {
      a = this.mixer.clipAction(clipFor(this.body, this.lod, name));
      this.actions.set(name, a);
    }
    return a;
  }

  /** Back to the bind pose (before a mixer writes a new one). */
  restPose(): void {
    this.bones.forEach((b, i) => {
      b.position.copy(this.rig.restPos[i]);
      b.quaternion.copy(this.rig.restRot[i]);
      b.scale.set(1, 1, 1);
    });
  }

  /** Holds one frame of a clip (the editor, the inventory). */
  hold(name: ClipId, time = 0): void {
    this.mixer.stopAllAction();
    const a = this.action(name);
    a.reset().play();
    a.time = time;
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mesh);
    this.mesh.skeleton.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
  }
}

// ── Ragdoll on the Mixamo bones ────────────────────────────────────────────────────────────────────────

/**
 * Which ragdoll body moves a bone. The ragdoll and the model both face +Z; the ragdoll's "L" parts are at
 * −X, the model's right side: its LeftArm is the ragdoll's upperArmR. Bones not here keep their pose
 * against their parent, frozen at death (hands, feet, fingers, the head on the neck).
 */
export const DRIVEN: Record<string, number> = {
  Hips: PART.pelvis,
  Spine1: PART.chest,
  Neck: PART.head,
  LeftArm: PART.upperArmR,
  LeftForeArm: PART.foreArmR,
  RightArm: PART.upperArmL,
  RightForeArm: PART.foreArmL,
  LeftUpLeg: PART.thighR,
  LeftLeg: PART.shinR,
  RightUpLeg: PART.thighL,
  RightLeg: PART.shinL,
};
const PART_BONE: string[] = [];
for (const [b, p] of Object.entries(DRIVEN)) PART_BONE[p] = b;

const _m = new Matrix4();
const _v = new Vector3();
const _ts = new Vector3();

interface Stand {
  world: Matrix4[];
  shape: BodyShape;
  keys: { k: Matrix4; inv: Matrix4 }[];
}
const stands = new Map<string, Stand>();

/** The body standing at ease (the first frame of `idle`): its bones (model frame), its ragdoll build. */
export function stand(body: BodyId, lod: 0 | 1): Stand {
  const key = `${body}:${lod}`;
  let s = stands.get(key);
  if (s) return s;
  const r = new CharacterRig(body, lod);
  r.hold('idle', 0);
  const world = r.bones.map((b) => b.matrixWorld.clone());
  const at = (n: string) => _v.setFromMatrixPosition(world[r.rig.index.get(n)!]).clone();
  const mid = (a: string, b: string, f: (v: Vector3) => number) => (f(at(a)) + f(at(b))) / 2;
  const absX = (v: Vector3) => Math.abs(v.x);
  const y = (v: Vector3) => v.y;
  const hipY = mid('LeftUpLeg', 'RightUpLeg', y);
  const neckY = at('Neck').y;
  const k = bodyAsset(body).height / 1.8;
  const shape: BodyShape = {
    shoulderX: mid('LeftArm', 'RightArm', absX),
    shoulderY: mid('LeftArm', 'RightArm', y),
    elbowY: mid('LeftForeArm', 'RightForeArm', y),
    wristY: mid('LeftHand', 'RightHand', y),
    hipX: mid('LeftUpLeg', 'RightUpLeg', absX),
    hipY,
    kneeY: mid('LeftLeg', 'RightLeg', y),
    waistY: hipY + (neckY - hipY) * 0.48,
    neckY,
    pelvisW: 0.15 * k,
    thighW: 0.065 * k,
    foreW: 0.042 * k,
  };
  const keys = bodyParts(shape).map((d, p) => {
    const kk = new Matrix4().makeTranslation(-d.c[0], -d.c[1], -d.c[2]).multiply(world[r.rig.index.get(PART_BONE[p])!]);
    return { k: kk, inv: kk.clone().invert() };
  });
  r.dispose();
  s = { world, shape, keys };
  stands.set(key, s);
  return s;
}

/** Where each ragdoll body starts, from the bones as drawn (world). */
export function ragdollStart(body: BodyId, lod: 0 | 1, rig: RigAsset, world: readonly Matrix4[]): { parts: PartPose[]; shape: BodyShape } {
  const s = stand(body, lod);
  const parts = s.keys.map((k, p) => {
    _m.copy(world[rig.index.get(PART_BONE[p])!]).multiply(k.inv);
    const pos = new Vector3();
    const q = new Quaternion();
    _m.decompose(pos, q, _ts);
    return { p: pos, q };
  });
  return { parts, shape: s.shape };
}

/** A body driven by its ragdoll: per bone the fixed offset from its body, or its pose on its parent. */
const _rp = new Vector3();
const _rt = new Vector3();
const _ra = new Vector3();
const _rm = new Matrix4();
const _rq = new Quaternion();
const UP = new Vector3(0, 1, 0);

export class RagdollPose {
  readonly world: Matrix4[];
  private readonly rel: Matrix4[];
  /** Each bone's offset from its parent at the start (the bone lengths kept: no joint pulled apart). */
  private readonly local: Vector3[];
  /** The feet and their toes (bone indices): the ankle gives so the toes stay on the floor. */
  private readonly feet: [number, number][];

  constructor(
    body: BodyId,
    lod: 0 | 1,
    private readonly rig: RigAsset,
    world: readonly Matrix4[],
    readonly rd: Ragdoll,
    scale = 1,
  ) {
    const s = stand(body, lod);
    this.world = world.map((m) => m.clone());
    this.local = rig.parents.map((parent, i) => new Vector3().setFromMatrixPosition(parent >= 0 ? world[parent].clone().invert().multiply(world[i]) : world[i]));
    this.feet = (['Left', 'Right'] as const).map((s) => [rig.index.get(`${s}Foot`) ?? -1, rig.index.get(`${s}ToeBase`) ?? -1] as [number, number]).filter(([f, t]) => f >= 0 && t >= 0);
    this.rel = rig.names.map((n, i) => {
      const p = DRIVEN[n];
      if (p !== undefined) return new Matrix4().makeScale(scale, scale, scale).multiply(s.keys[p].k);
      const parent = rig.parents[i];
      return parent >= 0 ? world[parent].clone().invert().multiply(world[i]) : world[i].clone();
    });
  }

  /** The bones' world matrices from the ragdoll now (parents come first in the rig's order). */
  update(): Matrix4[] {
    this.rig.names.forEach((n, i) => {
      const p = DRIVEN[n];
      const w = this.world[i];
      const parent = this.rig.parents[i];
      if (p !== undefined) {
        // The part's turn; where the joint is, its parent's (the hips: the pelvis's own place).
        this.rd.matrix(p, w).multiply(this.rel[i]);
        if (parent >= 0) w.setPosition(_rp.copy(this.local[i]).applyMatrix4(this.world[parent]));
      } else if (this.rig.parents[i] >= 0) w.multiplyMatrices(this.world[this.rig.parents[i]], this.rel[i]);
      for (const [f, t] of this.feet) if (f === i) this.ankle(w, t);
    });
    return this.world;
  }

  /** A foot whose toes would go under the floor turns at the ankle until they rest on it. */
  private ankle(foot: Matrix4, toe: number): void {
    const floor = this.rd.floorY - 0.02;
    _rp.setFromMatrixPosition(foot);
    _rt.setFromMatrixPosition(_rm.multiplyMatrices(foot, this.rel[toe]));
    if (_rt.y >= floor) return;
    _rt.sub(_rp);
    const len = _rt.length();
    _ra.crossVectors(_rt, UP);
    if (len < 1e-4 || _ra.lengthSq() < 1e-8) return;
    const want = Math.asin(Math.max(-1, Math.min(1, (floor - _rp.y) / len)));
    const turn = want - Math.asin(Math.max(-1, Math.min(1, _rt.y / len)));
    _rq.setFromAxisAngle(_ra.normalize(), turn);
    _rm.makeRotationFromQuaternion(_rq);
    const at = _rp.clone();
    foot.setPosition(0, 0, 0).premultiply(_rm).setPosition(at);
  }
}
