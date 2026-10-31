import { Box3, type BufferGeometry, Group, Matrix4, type Object3D, Quaternion, type Scene, Vector3 } from 'three';
import type { WearSlot } from '../data/items';
import { bodyParts, FIGURE_SHAPE, PART, type PartPose, type Ragdoll, type StaticBox } from '../physics/ragdoll';
import { playerRagdoll } from './deathBody';
import type { Worn } from '../systems/Inventory';
import type { Appearance } from './appearance';
import { CharacterFigure } from './CharacterFigure';
import { DeathCamera, type DeathSurroundings } from './DeathCamera';
import { buildHeldModel, HELD, type HeldId } from './held';

export interface DeathStart {
  look: Appearance;
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

const FIG_TO_BODY = new Matrix4().makeRotationY(Math.PI);

/**
 * The player's death: the first-person arms are gone; the whole survivor (the inventory figure, in what
 * they wore) becomes a ragdoll — the same physics as the zombies' — knocked away from what killed them,
 * the weapon falling free. The camera (DeathCamera) leaves the head and rises over the body.
 */
export class PlayerDeath {
  readonly ragdoll: Ragdoll;
  readonly camera: DeathCamera;
  readonly group = new Group();
  private readonly figure = new CharacterFigure();
  private readonly pieces: { obj: Object3D; part: number; offset: Matrix4 }[] = [];
  private weapon: { obj: Object3D; pose: PartPose; centre: Vector3 } | null = null;
  private readonly geos: BufferGeometry[] = [];

  constructor(
    private readonly scene: Scene,
    s: DeathStart,
  ) {
    const fig = this.figure;
    fig.setAppearance(s.look);
    fig.setOutfit(s.worn, null, s.dirt, s.tint);
    const pieces = fig.ragdollPieces();
    fig.root.position.set(0, 0, 0);
    fig.root.rotation.set(0, 0, 0);
    fig.root.updateMatrixWorld(true);
    const k = s.look.height / 176;
    const parts = bodyParts(FIGURE_SHAPE);
    // Each piece rides one part: its offset from that part's rest frame (figure turned to face +Z).
    for (const { obj, part } of pieces) {
      const rest = FIG_TO_BODY.clone().multiply(obj.matrixWorld);
      const x = _v.setFromMatrixPosition(rest).x;
      const L = x < 0;
      const idx =
        part === 'pelvis' ? PART.pelvis
        : part === 'chest' ? PART.chest
        : part === 'head' ? PART.head
        : part === 'upperArm' ? (L ? PART.upperArmL : PART.upperArmR)
        : part === 'foreArm' ? (L ? PART.foreArmL : PART.foreArmR)
        : part === 'thigh' ? (L ? PART.thighL : PART.thighR)
        : L ? PART.shinL : PART.shinR;
      const c = parts[idx].c;
      const offset = new Matrix4().makeTranslation(-c[0] * k, -c[1] * k, -c[2] * k).multiply(rest);
      this.pieces.push({ obj, part: idx, offset });
    }
    for (const p of this.pieces) {
      p.obj.removeFromParent();
      p.obj.matrixAutoUpdate = false;
      this.group.add(p.obj);
    }
    // Where it stood, facing where it looked; knocked away from the killer, never the same fall twice.
    this.ragdoll = playerRagdoll(s.feet, s.yaw, k, s.velocity, s.killer, s.boxes);
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

  /** The pieces where their bodies are (the ragdoll is stepped by the scene's Ragdolls). */
  place(): void {
    for (const p of this.pieces) {
      this.ragdoll.matrix(p.part, p.obj.matrix).multiply(p.offset);
      p.obj.matrixWorldNeedsUpdate = true;
    }
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
const _v = new Vector3();
const _f = new Vector3();
const _s = new Vector3();
const _m = new Matrix4();
