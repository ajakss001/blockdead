import { Quaternion, Vector3 } from 'three';
import { basisQuat } from '../player/armRig';
import { type Grip, frameOf, type GripFrame, quat } from '../player/grips';
import { HELD, type HeldId } from '../player/held';
import { gunSockets } from '../weapons/gunFrame';
import { GUNS, type GunId } from '../weapons/guns';
import { GUN_POSES } from '../player/gunPose';

/**
 * The reference holds (the grip editor's «Эталон», and what grips.json started from):
 *  - rifles and the hunting rifle: the right hand on the pistol grip (trigger), the left under the
 *    handguard (support), the stock to the shoulder, the gun low on the right, the barrel to the middle;
 *  - the pump gun: the same, the left hand on the pump;
 *  - pistols: both hands, the left round the right from below, low in the middle, arms out;
 *  - the RPG: on the right shoulder along the view, the right hand on its grip, the left on the front grip;
 *  - hand weapons: their rest poses as they are, fists on the handle (the knife and the hammer one-handed).
 */

const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);
const Z = new Vector3(0, 0, 1);
const turn = (axis: Vector3, a: number) => new Quaternion().setFromAxisAngle(axis, a);
const v = (a: readonly number[]) => new Vector3(a[0], a[1], a[2]);

/** The gun at `at` aimed at the crosshair `converge` m ahead, then turned by `r` (camera axes). */
function aimed(at: Vector3, converge: number, r = new Quaternion()): GripFrame {
  const d = new Vector3(0, 0, -converge).sub(at).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), d).premultiply(r);
  return frameOf(at, q);
}

export function gunReference(id: GunId): Grip {
  const g = GUNS[id];
  const s = gunSockets(id);
  const hand = (f: { at: readonly number[]; axis: readonly number[]; reach: readonly number[] }) => frameOf(v(f.at), basisQuat(v(f.axis), v(f.reach)));
  const main = hand(s.main);
  const off = hand(s.off);
  const P = GUN_POSES[id];
  const ads = { relief: P.relief, drop: P.adsDrop };
  if (g.cls === 'pistol') {
    const at = new Vector3(0.025, -0.15, -0.44);
    return {
      hands: { R: 'grip_trigger', L: 'grip_fist' },
      main,
      off,
      stance: aimed(at, 8),
      sprint: aimed(new Vector3(0.07, -0.26, -0.3), 8, turn(X, -0.9)),
      reload: aimed(new Vector3(0.02, -0.12, -0.36), 8, turn(X, 0.3).multiply(turn(Z, 0.35))),
      ads,
    };
  }
  if (g.cls === 'launcher') {
    const at = new Vector3(0.16, -0.19, -0.22);
    const under = frameOf(new Vector3(0, s.sightR[1] * 0.25, -0.24), basisQuat(new Vector3(0, 0, -1), new Vector3(-1, 0, 0)));
    return {
      hands: { R: 'grip_trigger', L: 'grip_support' },
      main,
      off: under,
      stance: frameOf(at, new Quaternion()),
      sprint: frameOf(at.clone().add(new Vector3(0, -0.04, 0.03)), turn(X, -0.15)),
      reload: frameOf(new Vector3(0.12, -0.22, -0.3), turn(Y, 0.9).multiply(turn(X, -0.3))),
      ads,
    };
  }
  const at = new Vector3(0.12, -0.2, -0.4);
  // The left hand at most 25 cm ahead of the right: the arm reaches it with the stock in the shoulder.
  // Palm up under the handguard (the socket's frame turned over about its grip axis).
  const reachOff = frameOf(v(s.off.at).setZ(Math.max(s.off.at[2], -0.25)), quat(off.q).multiply(turn(Y, Math.PI)));
  return {
    hands: { R: 'grip_trigger', L: 'grip_support' },
    main,
    off: reachOff,
    stance: aimed(at, 1.5),
    sprint: aimed(at.clone().add(new Vector3(-0.05, -0.08, 0.05)), 1.5, turn(Y, 0.8).multiply(turn(X, -0.4))),
    reload: aimed(new Vector3(0.08, -0.13, -0.36), 1.5, turn(Y, 0.25).multiply(turn(X, 0.15)).multiply(turn(Z, 0.5))),
    ads,
  };
}

export function meleeReference(id: HeldId): Grip {
  const c = HELD[id];
  const two = c.twoHanded;
  return {
    hands: { R: 'grip_fist', L: two ? 'grip_fist' : 'relaxed' },
    socketR: { along: c.main.along, roll: c.main.roll },
    ...(c.off ? { socketL: { along: c.off.along, roll: c.off.roll } } : {}),
  };
}
