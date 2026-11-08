import { Quaternion, Vector3 } from 'three';
import type { HandPose } from '../characters/hands';
import RAW from '../data/grips.json';

/**
 * How each item is held, as the grip editor (?gripedit=<id>, debug/gripEditor.ts) saved it to
 * src/data/grips.json — data, no code: the hands' poses (hands.ts), for a gun the hands on it (gun frame)
 * and the gun in camera space at the hip / sprint / reload plus the sights' eye relief; for a hand weapon
 * the hands' places on the handle and its rest and sprint poses. Whatever is not in the file keeps the
 * defaults of gunPose.ts / held.ts.
 */

export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];
/** A frame: a position and a rotation (quaternion x, y, z, w). */
export interface GripFrame {
  at: V3;
  q: Q4;
}
export interface GripHands {
  R?: HandPose;
  L?: HandPose;
}
export interface GunGrip {
  hands?: GripHands;
  /** The right / left hand on the gun (gun frame: the grip at the origin, the barrel −Z). */
  main?: GripFrame;
  off?: GripFrame;
  /** The gun's grip in camera space at the hip, sprinting, reloading. */
  stance?: GripFrame;
  sprint?: GripFrame;
  reload?: GripFrame;
  /** In the sights: the rear sight this far from the eye, the eye this far over it (m). */
  ads?: { relief?: number; drop?: number };
}
export interface MeleeGrip {
  hands?: GripHands;
  /** The hands on the handle: along it from the butt, the turn about it. */
  socketR?: { along: number; roll: number };
  socketL?: { along: number; roll: number };
  /** The anchor hand's socket in camera space, the handle +Y and the edge −Z by `q`. */
  stance?: GripFrame;
  sprint?: GripFrame;
}
export type Grip = GunGrip & MeleeGrip;

export const GRIPS: Record<string, Grip> = structuredClone(RAW) as unknown as Record<string, Grip>;

export const vec = (a: readonly number[]) => new Vector3(a[0], a[1], a[2]);
// The file rounds to 1e-4: normalised again, or a hand is off its socket by a degree.
export const quat = (a: readonly number[]) => new Quaternion(a[0], a[1], a[2], a[3]).normalize();
export const frameOf = (at: Vector3, q: Quaternion): GripFrame => ({ at: [at.x, at.y, at.z], q: [q.x, q.y, q.z, q.w] });

/** The hand poses of an item (the defaults: a gun trigger + support, a hand weapon fists, the free hand relaxed). */
export function gripHands(id: string | null, gun: boolean, twoHanded: boolean): Required<GripHands> {
  const h = (id && GRIPS[id]?.hands) || {};
  return {
    R: h.R ?? (gun ? 'grip_trigger' : 'grip_fist'),
    L: h.L ?? (gun ? 'grip_support' : twoHanded ? 'grip_fist' : 'relaxed'),
  };
}

const listeners: (() => void)[] = [];
/** Called after the grips change (the editor): compiled rigs are dropped. */
export function onGripsChanged(f: () => void): void {
  listeners.push(f);
}
export function gripsChanged(): void {
  for (const f of listeners) f();
}
