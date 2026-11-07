import { Matrix4, Quaternion, Vector3 } from 'three';
import { bodyAsset, type RigAsset } from './assets';

/**
 * A Mixamo hand as the game holds things: the grip frame of player/hand.ts (wrist at the origin, the hand
 * reaching −Z, the handle through the fist along +Y on the thumb side, the back of the hand +X·side) in the
 * hand bone's own frame, where the handle runs through the closed fist, and the finger bones' turns
 * that close it. Measured off the bind pose, so any Mixamo body fits.
 */

export interface HandFrame {
  /** The grip frame in the hand bone's frame. */
  q: Quaternion;
  /** The handle's centre in the fist, in the hand bone's frame (m, unscaled). */
  grip: Vector3;
  /** Finger bone index → its local rotation in a fist. */
  fist: Map<number, Quaternion>;
}

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
const CURL = [1.25, 1.45, 1.1];
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
  return m ? { q: m.q.clone(), grip: m.grip.clone(), fist: new Map() } : null;
}

function build(rig: RigAsset, side: 'L' | 'R'): HandFrame | null {
  const S = side === 'R' ? 'Right' : 'Left';
  const hi = rig.index.get(`${S}Hand`);
  const wrist = pos(rig, `${S}Hand`);
  const index = pos(rig, `${S}HandIndex1`);
  const pinky = pos(rig, `${S}HandPinky1`);
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
  // The fist: each finger joint turned about the palm's width axis, towards the palm.
  const fist = new Map<number, Quaternion>();
  const axis = new Vector3().crossVectors(f, palm).normalize();
  const world = new Map<number, Quaternion>();
  const worldQ = (i: number) => world.get(i) ?? new Quaternion().setFromRotationMatrix(rig.bind[i]);
  for (const F of [...FINGERS, 'Thumb'] as const) {
    for (let n = 1; n <= 3; n++) {
      const i = rig.index.get(`${S}Hand${F}${n}`);
      if (i === undefined) continue;
      const p = rig.parents[i];
      const a = F === 'Thumb' ? (n === 1 ? 0.35 : 0.5) : CURL[n - 1];
      const ax = F === 'Thumb' ? f.clone().negate().addScaledVector(axis, 0.4).normalize() : axis;
      const turn = new Quaternion().setFromAxisAngle(ax, a);
      // The world turn of this joint, on top of its parent's already curled one.
      const parentNow = worldQ(p);
      const parentBind = new Quaternion().setFromRotationMatrix(rig.bind[p]);
      const bindQ = new Quaternion().setFromRotationMatrix(rig.bind[i]);
      const now = parentNow.clone().multiply(parentBind.clone().invert()).multiply(turn).multiply(bindQ);
      world.set(i, now);
      fist.set(i, parentNow.clone().invert().multiply(now));
    }
  }
  return { q, grip, fist };
}
