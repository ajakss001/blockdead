import { Bone, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { BodyShape } from '../physics/ragdoll';

/**
 * The one skeleton of every procedural zombie: the same bones, names and hierarchy for all types, so the
 * shared animation clips (animations.ts) play on any of them. Faces −Z, feet on y = 0. Height and build are
 * parameters; a type's stoop is part of its rest pose (the clips are additive deltas on top of it).
 *
 * Bone frames at rest are unrotated except for the stoop (spine and chest bend forward, the neck juts out,
 * the head looks up again, the arms hang plumb). Limbs point down their bone's −Y, the spine up its +Y.
 * The character's right is +X.
 */
export const BONES = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'Jaw',
  'UpperArm_L',
  'LowerArm_L',
  'Hand_L',
  'UpperArm_R',
  'LowerArm_R',
  'Hand_R',
  'UpperLeg_L',
  'LowerLeg_L',
  'Foot_L',
  'UpperLeg_R',
  'LowerLeg_R',
  'Foot_R',
] as const;
export type BoneName = (typeof BONES)[number];

export const PARENT: Record<BoneName, BoneName | null> = {
  Hips: null,
  Spine: 'Hips',
  Chest: 'Spine',
  Neck: 'Chest',
  Head: 'Neck',
  Jaw: 'Head',
  UpperArm_L: 'Chest',
  LowerArm_L: 'UpperArm_L',
  Hand_L: 'LowerArm_L',
  UpperArm_R: 'Chest',
  LowerArm_R: 'UpperArm_R',
  Hand_R: 'LowerArm_R',
  UpperLeg_L: 'Hips',
  LowerLeg_L: 'UpperLeg_L',
  Foot_L: 'LowerLeg_L',
  UpperLeg_R: 'Hips',
  LowerLeg_R: 'UpperLeg_R',
  Foot_R: 'LowerLeg_R',
};

export const boneIndex = (name: BoneName): number => BONES.indexOf(name);

/** Build: every number a factor on an average 1.8 m adult except height (m) and stoop (0 straight … 1 hunched). */
export interface Proportions {
  height: number;
  /** Shoulder width. */
  shoulders: number;
  /** Arm length (upper arm, forearm, hand). */
  arms: number;
  /** Fullness: widths of the torso and limbs. */
  girth: number;
  /** 0 upright … 1 badly hunched. */
  stoop: number;
  /** Neck length (a long neck juts further forward when stooped). */
  neck: number;
  /** The jaw at rest: hanging open (rad) and off to one side (+ to the character's right, rad). */
  /** Head size (a cartoon head is drawn bigger: 1.3). */
  head?: number;
  jawOpen?: number;
  jawSide?: number;
}

export const DEFAULT_PROPORTIONS: Proportions = { height: 1.8, shoulders: 1, arms: 1, girth: 1, stoop: 0.3, neck: 1 };

/** The joints of the skeleton (m, model frame, before the stoop) and the lengths the builders need. */
export interface SkeletonDims {
  p: Proportions;
  /** Vertical scale (height / 1.8). */
  k: number;
  hipsY: number;
  spineY: number;
  chestY: number;
  shoulderY: number;
  shoulderX: number;
  neckY: number;
  headY: number;
  hipJointY: number;
  hipX: number;
  kneeY: number;
  ankleY: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  /** Torso half width at the chest and half depth, m. */
  chestW: number;
  chestD: number;
}

export function skeletonDims(p: Proportions): SkeletonDims {
  const k = p.height / 1.8;
  const g = p.girth;
  const neckLen = 0.08 * k * p.neck;
  const chestY = 1.2 * k;
  const shoulderY = 1.45 * k;
  const neckY = 1.5 * k;
  return {
    p,
    k,
    hipsY: 0.96 * k,
    spineY: 1.04 * k,
    chestY,
    shoulderY,
    shoulderX: 0.19 * p.shoulders,
    neckY,
    headY: neckY + neckLen,
    hipJointY: 0.91 * k,
    hipX: 0.092 * g,
    kneeY: 0.5 * k,
    ankleY: 0.085 * k,
    upperArm: 0.3 * k * p.arms,
    foreArm: 0.27 * k * p.arms,
    hand: 0.19 * k * p.arms,
    chestW: 0.17 * p.shoulders * g,
    chestD: 0.1 * g,
  };
}

/** The turn (about X) from the stooped chest's frame back to plumb: the arms hang that way. */
export const chestPlumb = (d: SkeletonDims): number => (0.12 + 0.32) * d.p.stoop;

/** Each bone's rest position (in its parent's frame) and rest rotation, with or without the stoop. */
export function restLocals(d: SkeletonDims, stooped = true): { pos: Vector3; rot: Quaternion }[] {
  const s = stooped ? d.p.stoop : 0;
  const neckOut = 0.55 + 0.25 * (d.p.neck - 1);
  const spine = -0.12 * s;
  const chest = -0.32 * s;
  const neck = -neckOut * s;
  const head = -(spine + chest + neck) * 0.85;
  // The arms hang plumb from a bent chest.
  const arm = stooped ? chestPlumb(d) : 0;
  const jh = d.p.head ?? 1;
  const local: Record<BoneName, [number, number, number, number, number, number]> = {
    Hips: [0, d.hipsY, 0, 0, 0, 0],
    Spine: [0, d.spineY - d.hipsY, 0, spine, 0, 0],
    Chest: [0, d.chestY - d.spineY, 0, chest, 0, 0],
    Neck: [0, d.neckY - d.chestY, 0, neck, 0, 0],
    Head: [0, d.headY - d.neckY, 0, head, 0, 0],
    Jaw: [0.1 * (d.p.jawSide ?? 0) * jh, 0.035 * jh, -0.035 * jh, -(d.p.jawOpen ?? 0), 0.5 * (d.p.jawSide ?? 0), d.p.jawSide ?? 0],
    UpperArm_L: [-d.shoulderX, d.shoulderY - d.chestY, 0, arm, 0, -0.05],
    LowerArm_L: [0, -d.upperArm, 0, 0.08, 0, 0],
    Hand_L: [0, -d.foreArm, 0, 0, 0, 0],
    UpperArm_R: [d.shoulderX, d.shoulderY - d.chestY, 0, arm, 0, 0.05],
    LowerArm_R: [0, -d.upperArm, 0, 0.08, 0, 0],
    Hand_R: [0, -d.foreArm, 0, 0, 0, 0],
    UpperLeg_L: [-d.hipX, d.hipJointY - d.hipsY, 0, 0, 0, 0],
    LowerLeg_L: [0, -(d.hipJointY - d.kneeY), 0, 0, 0, 0],
    Foot_L: [0, -(d.kneeY - d.ankleY), 0, 0, 0, 0],
    UpperLeg_R: [d.hipX, d.hipJointY - d.hipsY, 0, 0, 0, 0],
    LowerLeg_R: [0, -(d.hipJointY - d.kneeY), 0, 0, 0, 0],
    Foot_R: [0, -(d.kneeY - d.ankleY), 0, 0, 0, 0],
  };
  return BONES.map((n) => {
    const [x, y, z, rx, ry, rz] = local[n];
    return { pos: new Vector3(x, y, z), rot: new Quaternion().setFromEuler(new Euler(rx, ry, rz)) };
  });
}

/** Rest world (model frame) matrix of every bone. */
export function restWorld(d: SkeletonDims, stooped = true): Matrix4[] {
  const loc = restLocals(d, stooped);
  const out: Matrix4[] = [];
  BONES.forEach((n, i) => {
    const m = new Matrix4().compose(loc[i].pos, loc[i].rot, new Vector3(1, 1, 1));
    const par = PARENT[n];
    out.push(par ? m.premultiply(out[boneIndex(par)]) : m);
  });
  return out;
}

/** A fresh bone hierarchy in its rest pose: [root, all bones in BONES order]. */
export function createBones(d: SkeletonDims): Bone[] {
  const loc = restLocals(d);
  const bones = BONES.map((n, i) => {
    const b = new Bone();
    b.name = n;
    b.position.copy(loc[i].pos);
    b.quaternion.copy(loc[i].rot);
    return b;
  });
  BONES.forEach((n, i) => {
    const par = PARENT[n];
    if (par) bones[boneIndex(par)].add(bones[i]);
  });
  return bones;
}

/**
 * The body as the ragdoll sees it (its frame faces +Z): the joints of the unstooped skeleton. The stoop is
 * only a pose for the ragdoll, so joints line up with the mesh in any pose.
 */
export function ragdollShape(d: SkeletonDims): BodyShape {
  const g = d.p.girth;
  return {
    shoulderX: d.shoulderX,
    shoulderY: d.shoulderY,
    elbowY: d.shoulderY - d.upperArm,
    wristY: d.shoulderY - d.upperArm - d.foreArm,
    hipX: d.hipX,
    hipY: d.hipJointY,
    kneeY: d.kneeY,
    waistY: d.chestY,
    neckY: d.neckY,
    pelvisW: 0.16 * g,
    thighW: 0.07 * g,
    foreW: 0.04 * g,
  };
}
