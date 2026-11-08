import { Matrix4, Quaternion, Vector3 } from 'three';
import { bodyAsset, type RigAsset } from './assets';

/**
 * A Mixamo hand as the game holds things: the grip frame of player/hand.ts (wrist at the origin, the hand
 * reaching −Z, the handle through the fist along +Y on the thumb side, the back of the hand +X·side) in the
 * hand bone's own frame, where the handle runs through the closed fist, and the finger bones' turns
 * that close it. Measured off the bind pose, so any Mixamo body fits.
 */

/**
 * What the fingers do: grip_fist round a handle; grip_trigger the same with the index finger straight along
 * the trigger guard; grip_support the other hand under a handguard (fingers wrapped a little looser, thumb
 * along); relaxed a free hand, fingers a little bent; grip_torch the flashlight's closed grip — the fingers
 * round its body, the thumb laid over the top towards the lens.
 */
export type HandPose = 'grip_fist' | 'grip_trigger' | 'grip_support' | 'relaxed' | 'grip_torch';
export const HAND_POSES: readonly HandPose[] = ['grip_fist', 'grip_trigger', 'grip_support', 'relaxed', 'grip_torch'];

/** Curl of each finger's three joints (rad), the thumb's two, per pose; the index finger may differ. */
const POSE_CURL: Record<HandPose, { fingers: readonly number[]; index: readonly number[]; thumb: readonly number[] }> = {
  grip_fist: { fingers: [1.25, 1.45, 1.1], index: [1.25, 1.45, 1.1], thumb: [0.35, 0.5] },
  grip_trigger: { fingers: [1.25, 1.45, 1.1], index: [0.35, 0.2, 0.1], thumb: [0.35, 0.5] },
  grip_support: { fingers: [1.1, 1.25, 1.05], index: [1.06, 1.15, 1.05], thumb: [0.6, 0.7] },
  relaxed: { fingers: [0.35, 0.45, 0.3], index: [0.25, 0.35, 0.25], thumb: [0.1, 0.15] },
  grip_torch: { fingers: [1.2, 1.4, 1.05], index: [1.15, 1.35, 1.0], thumb: [0.45, 0.6] },
};
/**
 * The poses whose thumb turns mirrored for the left hand. The thumb's axis below (−f + 0.4·axis) is the right
 * hand's for both: on the left its f part should change sign (the curl axis already does), so the older poses
 * turn the left thumb into the handle. Only the poses here have it right; the rest keep the weapons' holds
 * as they were tuned (changing them moves every left hand on a weapon).
 */
const THUMB_MIRRORED: ReadonlySet<HandPose> = new Set(['grip_torch']);

export interface HandFrame {
  /** The grip frame in the hand bone's frame. */
  q: Quaternion;
  /** The handle's centre in the fist, in the hand bone's frame (m, unscaled). */
  grip: Vector3;
  /** Finger bone index → its local rotation in a fist. */
  fist: Map<number, Quaternion>;
  /** The same for every hand pose (grip_fist is `fist`). */
  poses: Record<HandPose, Map<number, Quaternion>>;
  /** The model has finger bones (else it needs rigging again with fingers). */
  fingers: boolean;
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
const cache = new WeakMap<RigAsset, Record<'L' | 'R', HandFrame | null>>();
const pos = (rig: RigAsset, n: string) => {
  const i = rig.index.get(n);
  return i === undefined ? null : new Vector3().setFromMatrixPosition(rig.bind[i]);
};

export function handFrame(rig: RigAsset, side: 'L' | 'R'): HandFrame | null {
  let c = cache.get(rig);
  if (!c) cache.set(rig, (c = { L: build(rig, 'L') ?? fingerless(rig, 'L'), R: build(rig, 'R') ?? fingerless(rig, 'R') }));
  return c[side];
}

/** A model rigged without finger bones (some costumes): the man's grip in the hand bone's frame, the hand left open. */
function fingerless(rig: RigAsset, side: 'L' | 'R'): HandFrame | null {
  const male = bodyAsset('male').lod0;
  if (male === rig || !rig.index.has(side === 'R' ? 'RightHand' : 'LeftHand')) return null;
  const m = handFrame(male, side);
  if (!m) return null;
  const none = () => new Map<number, Quaternion>();
  return { q: m.q.clone(), grip: m.grip.clone(), fist: none(), poses: { grip_fist: none(), grip_trigger: none(), grip_support: none(), relaxed: none(), grip_torch: none() }, fingers: false };
}

function build(rig: RigAsset, side: 'L' | 'R'): HandFrame | null {
  const S = side === 'R' ? 'Right' : 'Left';
  const hi = rig.index.get(`${S}Hand`);
  const wrist = pos(rig, `${S}Hand`);
  const index = pos(rig, `${S}HandIndex1`);
  // Some costumes are rigged without a little finger (or a ring finger): the outermost one there is.
  const pinky = pos(rig, `${S}HandPinky1`) ?? pos(rig, `${S}HandRing1`);
  const middle = pos(rig, `${S}HandMiddle1`);
  if (hi === undefined || !wrist || !index || !pinky || !middle) return null;
  const f = middle.clone().sub(wrist);
  const palmLen = f.length();
  f.normalize();
  const across = index.clone().sub(pinky);
  across.addScaledVector(f, -across.dot(f)).normalize();
  // The palm faces down from the arm at bind (T / A pose): of ±(across × f) the one pointing down.
  const palm = new Vector3().crossVectors(across, f);
  if (palm.y > 0) palm.negate();
  // Grip frame (world at bind): +Y along the handle (thumb side), −Z the reach, +X the back of the hand on the right.
  const y = across.clone();
  const z = f.clone().negate();
  const x = new Vector3().crossVectors(y, z);
  const back = palm.clone().negate();
  const s = side === 'R' ? 1 : -1;
  if (x.dot(back) * s < 0) {
    y.negate();
    x.negate();
  }
  const handQ = new Quaternion().setFromRotationMatrix(rig.bind[hi]);
  const inv = handQ.clone().invert();
  const q = inv.clone().multiply(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)));
  const gripWorld = wrist.clone().addScaledVector(f, palmLen * 0.62).addScaledVector(palm, 0.026);
  const grip = gripWorld.sub(wrist).applyQuaternion(inv);
  const axis = new Vector3().crossVectors(f, palm).normalize();
  const curlOf = (pose: HandPose): Map<number, Quaternion> => {
    const c = POSE_CURL[pose];
    const out = new Map<number, Quaternion>();
    const world = new Map<number, Quaternion>();
    const worldQ = (i: number) => world.get(i) ?? new Quaternion().setFromRotationMatrix(rig.bind[i]);
    for (const F of [...FINGERS, 'Thumb'] as const) {
      for (let n = 1; n <= 3; n++) {
        const i = rig.index.get(`${S}Hand${F}${n}`);
        if (i === undefined) continue;
        const p = rig.parents[i];
        const a = F === 'Thumb' ? (c.thumb[n === 1 ? 0 : 1] ?? 0) : (F === 'Index' ? c.index : c.fingers)[n - 1];
        const ax = F === 'Thumb' ? f.clone().multiplyScalar(THUMB_MIRRORED.has(pose) ? -s : -1).addScaledVector(axis, 0.4).normalize() : axis;
        const turn = new Quaternion().setFromAxisAngle(ax, a);
        // The world turn of this joint, on top of its parent's already curled one.
        const parentNow = worldQ(p);
        const parentBind = new Quaternion().setFromRotationMatrix(rig.bind[p]);
        const bindQ = new Quaternion().setFromRotationMatrix(rig.bind[i]);
        const now = parentNow.clone().multiply(parentBind.clone().invert()).multiply(turn).multiply(bindQ);
        world.set(i, now);
        out.set(i, parentNow.clone().invert().multiply(now));
      }
    }
    return out;
  };
  const poses = { grip_fist: curlOf('grip_fist'), grip_trigger: curlOf('grip_trigger'), grip_support: curlOf('grip_support'), relaxed: curlOf('relaxed'), grip_torch: curlOf('grip_torch') };
  const fingers = rig.index.has(`${S}HandMiddle1`) && rig.index.has(`${S}HandThumb1`);
  return { q, grip, fist: poses.grip_fist, poses, fingers };

}
