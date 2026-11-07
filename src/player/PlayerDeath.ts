import { type Bone, Box3, type BufferGeometry, Group, Matrix4, type Object3D, Quaternion, type Scene, Vector3 } from 'three';
import { RagdollPose, stand } from '../characters/rig';
import type { WearSlot } from '../data/items';
import { PART, type PartPose, type Ragdoll, type StaticBox } from '../physics/ragdoll';
import { playerRagdoll } from './deathBody';
import type { Worn } from '../systems/Inventory';
import type { Appearance } from './appearance';
import { CharacterFigure, figureScale } from './CharacterFigure';
import { DeathCamera, type DeathSurroundings } from './DeathCamera';
import { buildHeldModel, HELD, type HeldId } from './held';

export interface DeathStart {
  look: Appearance;
  classId?: string;
  worn: Worn;
  dirt: Record<WearSlot, number>;
  tint: Partial<Record<WearSlot, number>>;
  /** What was in the hand (dropped as a thing of its own). */
  hand: string | null;
  /** Feet, heading (yaw: looking along −Z turned by it), how it moved (m/s). */
  feet: Vector3;
  yaw: number;
  velocity: Vector3;
  /** The eye (camera) at that moment. */
  eye: Vector3;
  eyeQ: Quaternion;
  /** What killed: a zombie's position (its blow throws the body away from it), or null (a fall, hunger). */
  killer: Vector3 | null;
  boxes: StaticBox[];
  around: DeathSurroundings;
}

/** Which ragdoll body moves a bone (the ragdoll faces +Z, the model −Z: its left is the ragdoll's "R"). */

/**
 * The player's death: the first-person arms are gone; the whole survivor (the inventory figure — the same
 * skinned model, in what they wore) becomes a ragdoll — the same physics as the zombies', built to its
 * skeleton — its bones driven by the ragdoll's bodies as a zombie corpse's are, knocked away from what
 * killed them, the weapon falling free. The camera (DeathCamera) leaves the head and rises over the body.
 */
export class PlayerDeath {
  readonly ragdoll: Ragdoll;
  readonly camera: DeathCamera;
  readonly group = new Group();
  private readonly figure = new CharacterFigure();
  private readonly bones: Bone[];
  /** Per bone: its offset from its ragdoll body (driven) or from its parent bone (the rest). */
  private readonly pose: RagdollPose;
  private readonly parents: number[];
  private weapon: { obj: Object3D; pose: PartPose; centre: Vector3 } | null = null;
  private readonly geos: BufferGeometry[] = [];

  constructor(
    private readonly scene: Scene,
    s: DeathStart,
  ) {
    const fig = this.figure;
    fig.setAppearance(s.look, s.classId ?? null);
    fig.setOutfit(s.worn, null, s.dirt, s.tint);
    const rig = fig.skinned;
    rig.root.removeFromParent();
    this.group.add(rig.root);
    rig.root.scale.set(1, 1, 1);
    rig.root.updateMatrixWorld(true);
    this.bones = rig.bones;
    this.parents = rig.rig.parents;
    const scale = figureScale(s.look, fig.bodyId);
    const k = scale;
    const st = stand(fig.bodyId, 0);
    // Standing where the player stood, facing where they looked (the model faces +Z, the view −Z).
    const place = new Matrix4().compose(s.feet, new Quaternion().setFromAxisAngle(UP, s.yaw + Math.PI), new Vector3(scale, scale, scale));
    const world = st.world.map((w) => place.clone().multiply(w));
    for (const b of this.bones) b.matrixAutoUpdate = true;
    this.ragdoll = playerRagdoll(s.feet, s.yaw, scale, s.velocity, s.killer, s.boxes, Math.random, st.shape);
    this.pose = new RagdollPose(fig.bodyId, 0, rig.rig, world, this.ragdoll, scale);
    const poses = this.ragdoll.poses;
    const q = new Quaternion().setFromAxisAngle(UP, s.yaw + Math.PI);
    // The weapon slips out of the hand.
    const id = s.hand && s.hand in HELD && s.hand !== 'torch' ? (s.hand as HeldId) : null;
    if (id) {
      const obj = buildHeldModel(id, this.geos);
      const box = new Box3().setFromObject(obj);
      const centre = box.getCenter(new Vector3());
      const half = box.getSize(new Vector3()).multiplyScalar(0.5).max(new Vector3(0.02, 0.02, 0.02));
      const hand = poses[PART.foreArmL].p.clone().add(new Vector3(0, -0.25 * k, 0.12).applyQuaternion(q));
      // The right hand (the body frame faces +Z: its right is −X, the L side). Pointing forward, falling.
      const wq = q.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2 - 0.4));
      const pose: PartPose = { p: hand.add(centre.clone().applyQuaternion(wq)), q: wq };
      const v = s.velocity.clone().add(new Vector3((Math.random() - 0.5) * 1.2, 0.8, 1.2).applyQuaternion(q));
      this.ragdoll.addExtra(pose, half, id === 'axe' ? 1.6 : 0.8, v);
      obj.matrixAutoUpdate = false;
      this.group.add(obj);
      this.weapon = { obj, pose, centre };
    }
    this.camera = new DeathCamera(s.around, s.eye, s.eyeQ, s.yaw, this.focus(new Vector3()));
    this.scene.add(this.group);
    this.place();
  }

  /** Where the camera looks: the chest. */
  focus(out: Vector3): Vector3 {
    return out.copy(this.ragdoll.poses[PART.chest].p);
  }

  update(dt: number): void {
    this.camera.update(dt, this.focus(_f));
  }

  /** The bones where their bodies are (the ragdoll is stepped by the scene's Ragdolls). */
  place(): void {
    const w = this.pose.update();
    w.forEach((m, i) => {
      const p = this.parents[i];
      const local = p < 0 ? _m.copy(m) : _m.copy(w[p]).invert().multiply(m);
      local.decompose(this.bones[i].position, this.bones[i].quaternion, this.bones[i].scale);
    });
    if (this.weapon) {
      const w = this.weapon;
      w.obj.matrix.compose(w.pose.p, w.pose.q, _s.set(1, 1, 1)).multiply(_m.makeTranslation(-w.centre.x, -w.centre.y, -w.centre.z));
      w.obj.matrixWorldNeedsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.figure.dispose();
    for (const g of this.geos) g.dispose();
  }
}

const UP = new Vector3(0, 1, 0);
const _f = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();
