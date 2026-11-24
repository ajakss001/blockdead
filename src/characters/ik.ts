import { Quaternion, Vector3 } from 'three';
import type { Bone } from 'three';
import type { CharacterRig } from './rig';

const _pA = new Vector3();
const _pB = new Vector3();
const _pC = new Vector3();
const _dir = new Vector3();
const _perp = new Vector3();
const _wantUpper = new Vector3();
const _wantFore = new Vector3();
const _curUpper = new Vector3();
const _curFore = new Vector3();
const _qDelta = new Quaternion();
const _qBlend = new Quaternion();
const _qW = new Quaternion();
const _qPW = new Quaternion();

function aimBoneAlong(bone: Bone, rig: CharacterRig, curDir: Vector3, wantDir: Vector3, blend: number): void {
  if (curDir.lengthSq() < 1e-8 || wantDir.lengthSq() < 1e-8) return;
  _qDelta.setFromUnitVectors(curDir, wantDir);
  _qBlend.identity().slerp(_qDelta, blend);
  const w = bone.getWorldQuaternion(_qW);
  const pw = bone.parent!.getWorldQuaternion(_qPW);
  bone.quaternion.copy(pw.invert().multiply(_qBlend).multiply(w));
  rig.root.updateMatrixWorld(true);
}

/**
 * Analytical 2-bone Law-of-Cosines IK solver for Mixamo arms (upper -> lower -> hand).
 * `poleDirWorld` steers the elbow hinge outward/downward so joints never invert.
 */
export function solveTwoBoneIK(
  rig: CharacterRig,
  upperName: string,
  lowerName: string,
  handName: string,
  targetWorld: Vector3,
  poleDirWorld: Vector3,
  blend = 1,
): void {
  if (blend <= 0.005) return;
  const upper = rig.bone(upperName);
  const lower = rig.bone(lowerName);
  const hand = rig.bone(handName);
  if (!upper.parent || !lower.parent) return;

  rig.root.updateMatrixWorld(true);
  upper.getWorldPosition(_pA);
  lower.getWorldPosition(_pB);
  hand.getWorldPosition(_pC);

  const l1 = _pA.distanceTo(_pB);
  const l2 = _pB.distanceTo(_pC);
  if (l1 < 0.02 || l2 < 0.02) return;

  _dir.copy(targetWorld).sub(_pA);
  const rawD = _dir.length();
  if (rawD < 1e-5) return;
  _dir.divideScalar(rawD);

  const minD = Math.abs(l1 - l2) + 0.015;
  const maxD = (l1 + l2) * 0.992;
  const d = Math.max(minD, Math.min(maxD, rawD));

  // Orthogonal component of pole direction defines the arm plane and elbow side.
  _perp.copy(poleDirWorld).addScaledVector(_dir, -poleDirWorld.dot(_dir));
  if (_perp.lengthSq() < 1e-6) {
    _perp.set(0, -1, 0).addScaledVector(_dir, _dir.y);
  }
  _perp.normalize();

  const cosA = Math.max(-1, Math.min(1, (d * d + l1 * l1 - l2 * l2) / (2 * d * l1)));
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  _wantUpper.copy(_dir).multiplyScalar(cosA).addScaledVector(_perp, sinA).normalize();
  _curUpper.copy(_pB).sub(_pA).normalize();
  aimBoneAlong(upper, rig, _curUpper, _wantUpper, blend);

  // Re-evaluate elbow/hand positions after upper bone rotation, then bend lower arm toward target.
  lower.getWorldPosition(_pB);
  hand.getWorldPosition(_pC);
  _curFore.copy(_pC).sub(_pB).normalize();
  _wantFore.copy(_pA).addScaledVector(_dir, d).sub(_pB).normalize();
  aimBoneAlong(lower, rig, _curFore, _wantFore, blend);
}

/** Smoothly rotate a bone's world orientation toward `wantWorldQ`. */
export function slerpBoneWorld(bone: Bone, rig: CharacterRig, wantWorldQ: Quaternion, blend: number): void {
  if (blend <= 0.005 || !bone.parent) return;
  bone.getWorldQuaternion(_qW);
  _qW.slerp(wantWorldQ, blend);
  bone.parent.getWorldQuaternion(_qPW);
  bone.quaternion.copy(_qPW.invert().multiply(_qW));
  rig.root.updateMatrixWorld(true);
}
