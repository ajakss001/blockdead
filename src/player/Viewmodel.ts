import {
  AmbientLight,
  type BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  type Material,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  SphereGeometry,
  Scene,
  Vector3,
} from 'three';
import { clamp, damp } from '../core/math';
import { limbForward } from '../render/lowpoly';
import { characterMaterial } from '../render/look/materials';
import { type ArmPose, FOREARM, HAND_OFFSET, HandsRig, type ItemState, UPPER } from './armRig';
import { GRIP_X, GRIP_Z, handGeometry } from './hand';
import { buildHeldModel, FISTS, HELD, type HeldConfig, type HeldId } from './held';
import { cuffColor, SKIN } from './outfit';
import { SPEED_WALK } from './PlayerController';

export type RightItem = 'fists' | Exclude<HeldId, 'torch'>;

export interface ViewmodelFrame {
  lookX: number;
  lookY: number;
  stepPhase: number;
  speed: number;
  sprinting: boolean;
  flashlightOn: boolean;
}

const _axisY = new Vector3(0, 1, 0);

/**
 * First-person arms, drawn in a second pass with their own camera and FOV after clearing depth:
 * they never clip into walls and their framing doesn't change with the world FOV.
 *
 * Every item is posed by its key poses and both arms are solved to it (`armRig`): the item is a child of
 * the right hand (grip_main); the left hand holds the off socket of a two-handed weapon — the flashlight
 * then moves to the head (`headlamp`) — or the flashlight, itself an item posed the same way.
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
  private readonly sleeves: Mesh[] = [];
  private readonly cuffs: Mesh[] = [];
  /** Upper arms (shoulder → elbow); [right, left]. */
  private readonly uppers: Mesh[] = [];
  private readonly hands: Mesh[] = [];
  private readonly lens: MeshBasicMaterial;
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
  private strikePending = false;
  /** Set when a swing starts (sound); the caller clears it. */
  swingStarted = false;
  /** Debug: hold the swing at this time (s) instead of running it (?animdebug). */
  scrubT: number | null = null;

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

    const skin = characterMaterial('skin', SKIN);
    this.buildArm(this.armR, this.handR, 1, skin);
    this.buildArm(this.armL, this.handL, -1, skin);
    this.setSleeves(0x3d4a5c);

    // Every item is a child of the right hand, at its main socket.
    for (const id of ['knife', 'hammer', 'axe', 'bat', 'crowbar'] as const) {
      const g = this.inFist(buildHeldModel(id, this.geometries), HELD[id], 1);
      g.visible = id === this.item;
      this.handR.add(g);
      this.held.set(id, g);
    }

    // Flashlight in the left fist, lens forward.
    this.torch = this.inFist(buildHeldModel('torch', this.geometries), HELD.torch, -1);
    this.lens = this.mat(new MeshBasicMaterial({ color: 0x3a3a34 })) as MeshBasicMaterial;
    const lens = new Mesh(this.geo(new CylinderGeometry(0.026, 0.026, 0.004, 8)), this.lens);
    lens.position.y = 0.197;
    (this.torch.children[0] as Group).add(lens);
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

  /** The current weapon needs both hands: the flashlight is worn on the head. */
  get headlamp(): boolean {
    return this.config(this.item).twoHanded;
  }

  /** Day / night for the arms (they are drawn in their own scene). */
  setDaylight(k: number): void {
    this.ambient.color.setRGB(0.02 + 0.68 * k, 0.02 + 0.7 * k, 0.06 + 0.68 * k);
    this.ambient.intensity = 0.15 + 0.75 * k;
    this.moon.color.setRGB(0.35 + 0.65 * k, 0.42 + 0.53 * k, 0.56 + 0.32 * k);
    this.moon.intensity = 0.12 + 0.6 * k;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jacket sleeves in the worn color, or bare forearms (null). */
  setSleeves(color: number | null, skinColor = SKIN, dirt = 0): void {
    const skin = characterMaterial('skin', skinColor);
    const sleeve = color === null ? skin : characterMaterial('jacket', color, false, 0, dirt);
    const cuff = color === null ? skin : characterMaterial('cuff', cuffColor(color), false, 0, dirt);
    for (const m of this.sleeves) m.material = sleeve;
    for (const m of this.cuffs) {
      m.material = cuff;
      m.visible = color !== null;
    }
    for (const m of this.hands) m.material = skin;
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
    const canAttack = this.pendingItem === null && this.rightDown < 0.2;
    if (this.attackT < 0) {
      if (wantsAttack && canAttack) {
        this.attackT = 0;
        this.strikeFired = false;
        this.swingStarted = true;
      }
      return;
    }
    const a = this.config(this.item);
    this.attackT += dt;
    if (!this.strikeFired && this.attackT >= a.windup) {
      this.strikeFired = true;
      this.strikePending = true;
    }
    if (this.attackT >= a.windup + a.strike + a.recover) this.attackT = -1;
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

  update(dt: number, f: ViewmodelFrame): void {
    this.time += dt;
    this.sprintT = damp(this.sprintT, f.sprinting ? 1 : 0, 10, dt);
    this.leftUp = damp(this.leftUp, f.flashlightOn ? 1 : 0, 10, dt);

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
    this.lens.color.setHex(f.flashlightOn ? 0xfff2c4 : 0x3a3a34);
    // The light comes from the left hand, or from the forehead when both hands are on a weapon.
    if (twoHanded) this.bounce.position.set(0.05, 0.22, -0.05);
    else this.bounce.position.set(-0.12, -0.12, -0.35);
    this.bounce.intensity = f.flashlightOn ? (twoHanded ? 0.16 : 0.08) : 0;

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

    // Sway: arms lag behind camera rotation; bob follows the step phase; idle breathing.
    const inv = 1 / Math.max(dt, 1e-3);
    this.swayX = damp(this.swayX, clamp(-f.lookX * inv * 0.012, -0.05, 0.05), 12, dt);
    this.swayY = damp(this.swayY, clamp(f.lookY * inv * 0.012, -0.05, 0.05), 12, dt);
    const amp = clamp(f.speed / SPEED_WALK, 0, 1.6);
    const bobX = Math.sin(f.stepPhase) * 0.01 * amp;
    const bobY = -Math.abs(Math.sin(f.stepPhase)) * 0.012 * amp;
    const breathe = Math.sin(this.time * 1.6) * 0.0035;
    this.root.position.set(bobX + this.swayX, bobY + this.swayY + breathe, 0);
    this.root.rotation.set(this.swayY * 1.2, this.swayX * 2, this.swayX * 1.5);
  }

  /** Shared grunge materials are owned by look/materials; only the lens is ours. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }

  private config(item: RightItem): HeldConfig {
    return item === 'fists' ? FISTS : HELD[item];
  }

  /** Solved arm → meshes: the forearm at the elbow, the hand at its tip (on the end of the sleeve), the upper arm. */
  private applyArm(arm: Group, hand: Group, upper: Mesh, p: ArmPose): void {
    arm.position.copy(p.elbow);
    arm.quaternion.copy(p.forearm);
    hand.position.set(0, 0, -HAND_OFFSET);
    hand.quaternion.copy(p.hand);
    upper.position.copy(p.shoulder);
    upper.quaternion.copy(p.upper);
    upper.scale.set(1, 1, p.upperLen / UPPER);
  }

  /** Item model in a fist at its main socket: the socket point on the fist's grip axis, turned by the socket's roll. */
  private inFist(model: Group, cfg: HeldConfig, side: number): Group {
    const g = new Group();
    model.position.set(GRIP_X * side, -cfg.main.along, GRIP_Z);
    model.quaternion.setFromAxisAngle(_axisY, -cfg.main.roll);
    g.add(model);
    return g;
  }

  /** side: +1 right, -1 left. Root = elbow; forearm extends along -Z to the hand. */
  private buildArm(arm: Group, hand: Group, side: number, skin: Material): void {
    const sleeve = new Mesh(this.geo(limbForward(0.052, 0.043, FOREARM)), skin);
    const cuffMesh = new Mesh(this.geo(limbForward(0.046, 0.046, 0.03)), skin);
    cuffMesh.position.z = -FOREARM + 0.02;
    // Upper arm, with a rounded elbow at its end.
    const upper = new Mesh(this.geo(limbForward(0.064, 0.054, UPPER)), skin);
    const joint = new Mesh(this.geo(new SphereGeometry(0.055, 8, 6)), skin);
    joint.position.z = -UPPER;
    upper.add(joint);
    this.sleeves.push(joint);
    arm.add(sleeve, cuffMesh);
    this.sleeves.push(sleeve, upper);
    this.uppers.push(upper);
    this.cuffs.push(cuffMesh);
    hand.position.z = -HAND_OFFSET;
    const fist = new Mesh(this.geo(handGeometry(side)), skin);
    hand.add(fist);
    this.hands.push(fist);
    arm.add(hand);
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat(m: Material): Material {
    this.materials.push(m);
    return m;
  }
}
