import { BufferAttribute, BufferGeometry, Matrix4, type Object3D, Quaternion, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { type BodyId, bodyAsset, type RigAsset } from '../characters/assets';
import { type HandFrame, handFrame, type HandPose } from '../characters/hands';
import { characterMaterial } from '../characters/material';
import { createBones } from '../characters/rig';
import { GRIP_X, GRIP_Z } from './hand';

/**
 * The first-person arms are the character model's own: its arms cut out of the body (every triangle
 * mostly on an arm's bones; the rest of their weight folded onto the upper arm), skinned to bones the arm
 * solve places (armRig → Viewmodel's frames): the upper arm from the shoulder to the elbow, the forearm
 * to the wrist, the hand where its closed fist holds the grip of player/hand.ts. Bones are stretched along
 * their length to the solve's, so the hand always meets the end of the sleeve; the wrist's twist is the
 * forearm's (from the hand back).
 */

type Side = 'L' | 'R';
interface Arm {
  side: Side;
  s: number;
  arm: number;
  fore: number;
  hand: number;
  /** Bind: forearm in the upper arm's frame, the hand in the forearm's; the bones' lengths. */
  lua: Quaternion;
  lfh: Quaternion;
  upperLen: number;
  foreLen: number;
  hf: HandFrame;
}

const geos = new Map<BodyId, BufferGeometry>();

/** The arms out of the body: triangles mostly on the arm chains, other weights onto the upper arm. */
function armsGeometry(body: BodyId, rig: RigAsset): BufferGeometry {
  let g = geos.get(body);
  if (g) return g;
  const src = rig.geometry;
  const si = src.getAttribute('skinIndex');
  const sw = src.getAttribute('skinWeight');
  const sideOf = rig.names.map((n) => (/^Right(Arm|ForeArm|Hand)/.test(n) ? 'R' : /^Left(Arm|ForeArm|Hand)/.test(n) ? 'L' : null));
  const armOf = { R: rig.index.get('RightArm')!, L: rig.index.get('LeftArm')! };
  const n = si.count;
  const share = { R: new Float32Array(n), L: new Float32Array(n) };
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 4; k++) {
      const s = sideOf[si.getComponent(v, k)];
      if (s) share[s][v] += sw.getComponent(v, k);
    }
  const idx = src.index!;
  const keep: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    for (const s of ['R', 'L'] as const) if (share[s][a] >= 0.5 && share[s][b] >= 0.5 && share[s][c] >= 0.5) keep.push(a, b, c);
  }
  const ji = new Uint16Array(n * 4);
  const jw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const side: Side = share.R[v] >= share.L[v] ? 'R' : 'L';
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(v, k);
      ji[v * 4 + k] = sideOf[j] === side ? j : armOf[side];
      jw[v * 4 + k] = sw.getComponent(v, k);
    }
  }
  g = new BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) if (src.getAttribute(name)) g.setAttribute(name, src.getAttribute(name));
  g.setAttribute('skinIndex', new BufferAttribute(ji, 4));
  g.setAttribute('skinWeight', new BufferAttribute(jw, 4));
  g.setIndex(keep);
  g.boundingBox = src.boundingBox ?? (src.computeBoundingBox(), src.boundingBox);
  geos.set(body, g);
  return g;
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _v = new Vector3();
const _e = new Vector3();
const _sh = new Vector3();
const _w = new Vector3();
const _gs = new Vector3();
const _y = new Vector3(0, 1, 0);
const _rg = new Quaternion();
const _sc = new Vector3();
const _m = new Matrix4();

/** The rotation `r` swung (shortest way) so that its +Y points along `dir`. */
function aim(r: Quaternion, dir: Vector3): Quaternion {
  _v.copy(_y).applyQuaternion(r);
  return r.premultiply(_q2.setFromUnitVectors(_v, dir));
}

export class FpArms {
  mesh: SkinnedMesh | null = null;
  private arms: Arm[] = [];
  private body: BodyId | null = null;
  private scale = 1;
  /** Where each wrist ended (the hand bone) and where its forearm bone ends: the same point (test:anim). */
  readonly wrist = [new Vector3(), new Vector3()];
  readonly cuff = [new Vector3(), new Vector3()];
  private posed: (HandPose | null)[] = [null, null];

  /** The fingers of hand `k` (0 right, 1 left) in a pose (hands.ts), set or smoothly blended over `dt` (s). */
  setPose(k: 0 | 1, pose: HandPose, dt = 0): void {
    const a = this.arms[k];
    if (!a || !this.mesh) return;
    if (dt <= 0 && this.posed[k] === pose) return;
    const snap = dt <= 0 || this.posed[k] === null;
    this.posed[k] = pose;
    const bones = this.mesh.skeleton.bones;
    const target = a.hf.poses[pose];
    if (snap) {
      for (const [i, q] of target) bones[i].quaternion.copy(q);
      return;
    }
    const alpha = Math.min(1, dt * 18);
    for (const [i, q] of target) bones[i].quaternion.slerp(q, alpha);
  }

  /** The body's hands have finger bones (else they stay open: the model needs rigging again with fingers). */
  get fingers(): boolean {
    return !!this.arms[0]?.hf.fingers;
  }

  /** The arms of a body (a man, a woman, the SWAT officer), `scale` its height's. */
  setBody(body: BodyId, scale: number, parent: Object3D): void {
    this.scale = scale;
    if (body === this.body) return;
    if (this.mesh) {
      parent.remove(this.mesh);
      this.mesh.skeleton.dispose();
      (this.mesh.material as { dispose(): void }).dispose();
    }
    this.body = body;
    this.posed = [null, null];
    const asset = bodyAsset(body);
    const rig = asset.lod0;
    const bones = createBones(rig);
    const mesh = new SkinnedMesh(armsGeometry(body, rig), characterMaterial(asset, rig));
    mesh.name = 'fp-arms';
    mesh.frustumCulled = false;
    mesh.add(bones[0]);
    mesh.bind(new Skeleton(bones, rig.inverses.map((m) => m.clone())), new Matrix4());
    parent.add(mesh);
    this.mesh = mesh;
    const rot = (i: number) => new Quaternion().setFromRotationMatrix(rig.bind[i]);
    const at = (i: number) => new Vector3().setFromMatrixPosition(rig.bind[i]);
    this.arms = (['R', 'L'] as const).map((side) => {
      const S = side === 'R' ? 'Right' : 'Left';
      const arm = rig.index.get(`${S}Arm`)!;
      const fore = rig.index.get(`${S}ForeArm`)!;
      const hand = rig.index.get(`${S}Hand`)!;
      const hf = handFrame(rig, side)!;
      // The fist closed for good, the arm bones placed by hand every frame.
      for (const [i, q] of hf.fist) bones[i].quaternion.copy(q);
      for (const i of [arm, fore, hand]) {
        bones[i].matrixAutoUpdate = false;
        bones[i].matrixWorldAutoUpdate = false;
      }
      return {
        side,
        s: side === 'R' ? 1 : -1,
        arm,
        fore,
        hand,
        lua: rot(arm).invert().multiply(rot(fore)),
        lfh: rot(fore).invert().multiply(rot(hand)),
        upperLen: at(fore).distanceTo(at(arm)),
        foreLen: at(hand).distanceTo(at(fore)),
        hf,
      };
    });
  }

  /**
   * Bones to the solve: `upper` at the shoulder (its −Z down the upper arm, `upperLen` long), `elbow` the
   * forearm's frame at the elbow, `hand` the grip frame (hand.ts) — all with their world matrices current.
   */
  update(k: 0 | 1, upper: Object3D, upperLen: number, elbow: Object3D, hand: Object3D): void {
    const a = this.arms[k];
    const mesh = this.mesh;
    if (!a || !mesh) return;
    const bones = mesh.skeleton.bones;
    const s = this.scale;
    // The hand: the grip frame turned into the bone's, placed so the fist closes on the grip point.
    hand.matrixWorld.decompose(_w, _rg, _sc);
    const handQ = _rg.clone().multiply(_q.copy(a.hf.q).invert());
    _gs.set(GRIP_X * a.s, 0, GRIP_Z).applyMatrix4(hand.matrixWorld);
    const wrist = _w.copy(_gs).sub(_v.copy(a.hf.grip).multiplyScalar(s).applyQuaternion(handQ));
    bones[a.hand].matrixWorld.compose(wrist, handQ, _sc.setScalar(s));
    // The forearm from the elbow to that wrist, its twist the hand's.
    elbow.getWorldPosition(_e);
    const foreQ = aim(handQ.clone().multiply(_q.copy(a.lfh).invert()), _v.subVectors(wrist, _e).normalize().clone());
    const foreLen = wrist.distanceTo(_e);
    bones[a.fore].matrixWorld.compose(_e, foreQ, _sc.set(s, foreLen / a.foreLen, s));
    // The upper arm from the shoulder to the elbow.
    upper.getWorldPosition(_sh);
    _m.copy(upper.matrixWorld);
    void upperLen;
    const upQ = aim(foreQ.clone().multiply(_q.copy(a.lua).invert()), _v.subVectors(_e, _sh).normalize().clone());
    bones[a.arm].matrixWorld.compose(_sh, upQ, _sc.set(s, _e.distanceTo(_sh) / a.upperLen, s));
    // The fingers follow the hand.
    for (const c of bones[a.hand].children) c.updateMatrixWorld(true);
    this.wrist[k].copy(wrist);
    this.cuff[k].set(0, a.foreLen, 0).applyMatrix4(bones[a.fore].matrixWorld);
  }

  dispose(): void {
    if (!this.mesh) return;
    this.mesh.skeleton.dispose();
    (this.mesh.material as { dispose(): void }).dispose();
  }
}
