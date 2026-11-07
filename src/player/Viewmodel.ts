import {
  AmbientLight,
  type BufferGeometry,
  DirectionalLight,
  Group,
  type Material,
  type Mesh,
  type MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import { clamp, damp } from '../core/math';
import { FLASHLIGHT } from '../items/config';
import { setLensGlow } from '../items/flashlight';
import type { BodyId } from '../characters/assets';
import { type ArmPose, HAND_OFFSET, HandsRig, hitTime, type ItemState, swingTime } from './armRig';
import { FpArms } from './fpArms';
import { GRIP_X, GRIP_Z } from './hand';
import { buildHeldModel, FISTS, HELD, type HeldConfig, type HeldId } from './held';
import { SPEED_WALK } from './PlayerController';

export type RightItem = 'fists' | Exclude<HeldId, 'torch'>;

export interface ViewmodelFrame {
  lookX: number;
  lookY: number;
  stepPhase: number;
  speed: number;
  sprinting: boolean;
  flashlightOn: boolean;
  /** How bright the flashlight shines now, 0..1 (battery, flicker): the lens glow and the bounce. */
  light?: number;
}

const _axisY = new Vector3(0, 1, 0);
/** The beam's main direction (eye space): ahead, a touch down. */
const _fwd = new Vector3(0, -0.08, -1).normalize();
const _hand = new Vector3();

/**
 * First-person arms, drawn in a second pass with their own camera and FOV after clearing depth:
 * they never clip into walls and their framing doesn't change with the world FOV.
 *
 * Every item is posed by its key poses and both arms are solved to it (`armRig`): the item is a child of
 * the right hand (grip_main); the left hand holds the off socket of a two-handed weapon — the flashlight
 * then moves to the head (`headlamp`) — or the flashlight, itself an item posed the same way.
 * The arms drawn are the character model's own (fpArms), skinned to the solve's frames.
 */
export class Viewmodel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 5);
  /** Arm solve of the last frame (read by ?animdebug and test:anim). */
  readonly rig = new HandsRig();

  private readonly root = new Group();
  private readonly armR = new Group();
  private readonly armL = new Group();
  private readonly handR = new Group();
  private readonly handL = new Group();
  private readonly held = new Map<RightItem, Group>();
  private readonly torch: Group;
  /** Upper arms' frames (shoulder, −Z to the elbow); [right, left]. */
  private readonly uppers: Group[] = [];
  /** The model's arms on the frames. */
  readonly arms = new FpArms();
  private readonly lens: MeshStandardMaterial;
  /** The flashlight in its held frame (the lens at FLASHLIGHT.length on +Y). */
  private readonly torchModel: Group;
  /** Thumb on the button: 1 → 0. */
  private clickT = 0;
  /** Where the left hand rests, slowly following it: a swing throws the hand (and the beam) away from it. */
  private readonly restL = new Vector3(-0.2, -0.3, -0.4);
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly bounce = new PointLight(0xfffaed, 0, 1.5, 2);
  private readonly ambient = new AmbientLight(0x050510, 0.15);
  private readonly moon = new DirectionalLight(0x5a6c90, 0.12);
  private readonly itemState: ItemState = { attackT: -1, sprint: 0, pump: 0, lower: 0 };
  private readonly torchState: ItemState = { attackT: -1, sprint: 0, pump: 0, lower: 0 };

  private item: RightItem = 'knife';
  private pendingItem: RightItem | null = null;
  /** -1 = idle, otherwise seconds since the attack started. */
  private attackT = -1;
  private strikeFired = false;
  /** Seconds until the next blow may start (the weapon's interval). */
  private cooldown = 0;
  /** Recoil of a blow that met something, 1 → 0. */
  private kick = 0;
  private strikePending = false;
  /** Set when a swing starts (sound); the caller clears it. */
  swingStarted = false;
  /** Debug: hold the swing at this time (s) instead of running it (?animdebug). */
  scrubT: number | null = null;
  /** Swing speed: below 1 when tired (set by the scene). */
  swingRate = 1;

  private sprintT = 0;
  private rightDown = 0;
  private leftUp = 0;
  private swayX = 0;
  private swayY = 0;
  private time = 0;

  constructor() {
    // Same darkness as the world: near-black ambient, a cold sliver of moonlight, and a warm
    // bounce near the hands that exists only while the flashlight is on.
    this.scene.add(this.ambient);
    const moon = this.moon;
    moon.position.set(-0.5, 1, 0.4);
    this.scene.add(moon, this.bounce);
    this.bounce.position.set(-0.12, -0.12, -0.35);

    this.buildArm(this.armR, this.handR);
    this.buildArm(this.armL, this.handL);

    // Every item is a child of the right hand, at its main socket.
    for (const id of ['knife', 'hammer', 'axe', 'bat', 'crowbar'] as const) {
      const g = this.inFist(buildHeldModel(id, this.geometries), HELD[id], 1);
      g.visible = id === this.item;
      this.handR.add(g);
      this.held.set(id, g);
    }

    // Flashlight in the left fist, lens forward.
    this.torch = this.inFist(buildHeldModel('torch', this.geometries), HELD.torch, -1);
    this.torchModel = this.torch.children[0] as Group;
    this.lens = ((this.torchModel.children[0] as Mesh).material as Material[])[1] as MeshStandardMaterial;
    this.materials.push(this.lens);
    this.handL.add(this.torch);

    this.root.add(this.armR, this.armL, ...this.uppers);
    this.scene.add(this.root);
  }

  /** Swing timing of what is in hand. */
  get swing(): HeldConfig {
    return this.config(this.item);
  }

  get currentItem(): RightItem {
    return this.item;
  }

  /** Camera pitch the swing asks for this frame (rad, + up): leaning back in the windup. */
  get cameraPitch(): number {
    return this.rig.pitch;
  }

  /** The current weapon needs both hands: the flashlight is worn on the head. */
  get headlamp(): boolean {
    return this.config(this.item).twoHanded;
  }

  /** Day / night for the arms (they are drawn in their own scene). */
  /** The arms' own light follows the world's (style/stage): a grey overcast day, a dark night. */
  setDaylight(k: number): void {
    this.ambient.color.setRGB(0.02 + 0.4 * k, 0.02 + 0.43 * k, 0.06 + 0.42 * k);
    this.ambient.intensity = 0.15 + 0.6 * k;
    this.moon.color.setRGB(0.35 + 0.37 * k, 0.42 + 0.32 * k, 0.56 + 0.19 * k);
    this.moon.intensity = 0.12 + 0.42 * k;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The arms of the survivor's model (a man, a woman, the SWAT officer), `scale` their height's. */
  setBody(body: BodyId, scale: number): void {
    this.arms.setBody(body, scale, this.scene);
  }

  equip(item: RightItem): void {
    if (item !== this.item || this.pendingItem) this.pendingItem = item === this.item ? null : item;
  }

  /** Attack state machine at the simulation rate. */
  fixedUpdate(dt: number, wantsAttack: boolean): void {
    if (this.scrubT !== null) {
      this.attackT = this.scrubT;
      return;
    }
    this.cooldown -= dt * this.swingRate;
    const canAttack = this.pendingItem === null && this.rightDown < 0.2 && this.cooldown <= 0;
    if (this.attackT < 0) {
      if (wantsAttack && canAttack) {
        this.attackT = 0;
        this.cooldown = this.config(this.item).interval ?? 0;
        this.strikeFired = false;
        this.swingStarted = true;
      }
      return;
    }
    const a = this.config(this.item);
    this.attackT += dt * this.swingRate;
    if (!this.strikeFired && this.attackT >= hitTime(a)) {
      this.strikeFired = true;
      this.strikePending = true;
    }
    if (this.attackT >= swingTime(a)) this.attackT = -1;
  }

  /**
   * True once per swing, at the moment the blow lands. Stage 4 does the hit check here.
   * Returns the noise of the swing (0 if no strike this step).
   */
  consumeStrike(): number {
    if (!this.strikePending) return 0;
    this.strikePending = false;
    return this.config(this.item).noise;
  }

  /** The thumb clicks the flashlight's button: the hand gives a little. */
  click(): void {
    this.clickT = 1;
  }

  /**
   * Where the flashlight shines from and where to, viewmodel-camera space (= the eye's): from the lens
   * along the flashlight, pulled mostly forward so the beam stays useful. Both hands on a weapon: from
   * the left hand on the handle, thrown about as the hand swings away from where it rests.
   */
  lightFrame(pos: Vector3, dir: Vector3): void {
    if (this.torch.visible) {
      this.torchModel.updateWorldMatrix(true, false);
      pos.set(0, FLASHLIGHT.length, 0);
      this.torchModel.localToWorld(pos);
      dir.set(0, 1, 0).transformDirection(this.torchModel.matrixWorld);
      dir.multiplyScalar(0.15).add(_fwd).normalize();
      return;
    }
    this.handL.getWorldPosition(pos);
    dir.subVectors(pos, this.restL).multiplyScalar(2.2);
    dir.z = 0;
    dir.add(_fwd).normalize();
  }

  /** The blow met a zombie or a wall: the arms jolt back. */
  recoil(): void {
    this.kick = 1;
  }

  update(dt: number, f: ViewmodelFrame): void {
    this.time += dt;
    this.kick = Math.max(0, this.kick - dt * 7);
    this.sprintT = damp(this.sprintT, f.sprinting ? 1 : 0, 10, dt);
    // The flashlight is always in the left hand (raised from below when it comes back from a two-handed grip).
    this.leftUp = this.headlamp ? 0 : damp(this.leftUp, 1, 7, dt);
    this.clickT = Math.max(0, this.clickT - dt * 6);

    // Weapon switch: lower, swap at the bottom, raise.
    this.rightDown = damp(this.rightDown, this.pendingItem ? 1 : 0, 12, dt);
    if (this.pendingItem && this.rightDown > 0.95) {
      this.item = this.pendingItem;
      this.pendingItem = null;
      for (const [id, g] of this.held) g.visible = id === this.item;
      this.rig.reset();
    }
    const twoHanded = this.headlamp;
    this.torch.visible = !twoHanded;
    const light = f.light ?? (f.flashlightOn ? 1 : 0);
    setLensGlow(this.lens, light);
    // The light spills on the hands from the left fist (on the handle when both hands are on a weapon).
    this.bounce.position.set(twoHanded ? 0 : -0.12, -0.12, -0.35);
    this.bounce.intensity = (twoHanded ? 0.1 : 0.08) * light;

    // Arms pump in step with the legs while sprinting (the left one in counter-phase).
    const pump = Math.sin(f.stepPhase) * this.sprintT;
    const st = this.itemState;
    st.attackT = this.attackT;
    st.sprint = this.sprintT;
    st.pump = pump;
    st.lower = this.rightDown;
    const ts = this.torchState;
    ts.sprint = this.sprintT;
    ts.pump = -pump;
    ts.lower = 1 - this.leftUp;
    this.rig.update(this.config(this.item), st, HELD.torch, ts);
    // The item rides in the right hand; it slides through the fist when the swing slides the grip.
    const model = this.held.get(this.item)?.children[0];
    if (model) model.position.y = -this.rig.mainAlong;
    this.applyArm(this.armR, this.handR, this.uppers[0], this.rig.right.pose);
    this.applyArm(this.armL, this.handL, this.uppers[1], this.rig.left.pose);
    // The thumb presses the button: the fist (and the flashlight in it) dips and tilts a hair.
    if (this.clickT > 0) {
      const k = Math.sin(this.clickT * Math.PI);
      this.armL.position.y -= 0.006 * k;
      this.armL.rotateX(-0.05 * k);
    }

    // Sway: arms lag behind camera rotation; bob follows the step phase; idle breathing.
    const inv = 1 / Math.max(dt, 1e-3);
    this.swayX = damp(this.swayX, clamp(-f.lookX * inv * 0.012, -0.05, 0.05), 12, dt);
    this.swayY = damp(this.swayY, clamp(f.lookY * inv * 0.012, -0.05, 0.05), 12, dt);
    const amp = clamp(f.speed / SPEED_WALK, 0, 1.6);
    const bobX = Math.sin(f.stepPhase) * 0.01 * amp;
    const bobY = -Math.abs(Math.sin(f.stepPhase)) * 0.012 * amp;
    const breathe = Math.sin(this.time * 1.6) * 0.0035;
    const kick = this.kick * this.kick;
    this.root.position.set(bobX + this.swayX, bobY + this.swayY + breathe + kick * 0.012, kick * 0.035);
    this.root.rotation.set(this.swayY * 1.2 + kick * 0.06, this.swayX * 2, this.swayX * 1.5);
    this.root.updateMatrixWorld(true);
    this.arms.update(0, this.uppers[0], this.rig.right.pose.upperLen, this.armR, this.handR);
    this.arms.update(1, this.uppers[1], this.rig.left.pose.upperLen, this.armL, this.handL);
    this.handL.getWorldPosition(_hand);
    this.restL.x = damp(this.restL.x, _hand.x, 3, dt);
    this.restL.y = damp(this.restL.y, _hand.y, 3, dt);
  }

  /** Shared grunge materials are owned by look/materials; only the lens is ours. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.arms.dispose();
  }

  private config(item: RightItem): HeldConfig {
    return item === 'fists' ? FISTS : HELD[item];
  }

  /** Solved arm → meshes: the forearm at the elbow, the hand at its tip (on the end of the sleeve), the upper arm. */
  private applyArm(arm: Group, hand: Group, upper: Group, p: ArmPose): void {
    arm.position.copy(p.elbow);
    arm.quaternion.copy(p.forearm);
    hand.position.set(0, 0, -HAND_OFFSET);
    hand.quaternion.copy(p.hand);
    upper.position.copy(p.shoulder);
    upper.quaternion.copy(p.upper);
  }

  /** Item model in a fist at its main socket: the socket point on the fist's grip axis, turned by the socket's roll. */
  private inFist(model: Group, cfg: HeldConfig, side: number): Group {
    const g = new Group();
    model.position.set(GRIP_X * side, -cfg.main.along, GRIP_Z);
    model.quaternion.setFromAxisAngle(_axisY, -cfg.main.roll);
    g.add(model);
    return g;
  }

  /** The frames of an arm: root = elbow (the forearm along −Z to the hand), the hand at its tip, the upper arm. */
  private buildArm(arm: Group, hand: Group): void {
    this.uppers.push(new Group());
    hand.position.z = -HAND_OFFSET;
    arm.add(hand);
  }


}
