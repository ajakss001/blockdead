import {
  AmbientLight,
  type BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  SphereGeometry,
  Scene,
  Vector3,
} from 'three';
import { clamp, damp, easeInOutSine, easeInQuad, easeOutQuad, lerp } from '../core/math';
import { limbForward } from '../render/lowpoly';
import { characterMaterial } from '../render/look/materials';
import { GRIP_X, GRIP_Z, handGeometry } from './hand';
import { buildHeldModel, HELD, type HeldConfig, type HeldId } from './held';
import { cuffColor, SKIN } from './outfit';
import { SPEED_WALK } from './PlayerController';

export type RightItem = 'fists' | Exclude<HeldId, 'torch'>;

/** Arm root (≈ elbow) transform in viewmodel-camera space: position + Euler XYZ. */
interface Pose {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
}

const pose = (px: number, py: number, pz: number, rx: number, ry: number, rz: number): Pose => ({ px, py, pz, rx, ry, rz });

// One-handed right arm. Elbows sit below the screen edge; only forearm + hand enter the frame.
const R_IDLE = pose(0.2, -0.29, -0.16, 0.28, 0.2, 0.08);
const R_SPRINT = pose(0.24, -0.27, -0.12, 0.05, 0.5, 0.45);
const R_LOWERED = pose(0.24, -0.62, -0.05, -0.6, 0.3, 0.2);
const R_KNIFE_WINDUP = pose(0.22, -0.22, -0.1, 0.55, 0.05, -0.5);
const R_KNIFE_STRIKE = pose(0.02, -0.3, -0.3, -0.05, 0.65, 0.75);
const R_FIST_WINDUP = pose(0.22, -0.31, -0.06, 0.2, 0.15, 0.1);
const R_FIST_STRIKE = pose(0.09, -0.21, -0.38, 0.18, 0.12, 0.05);
// Left arm: flashlight raised, or lowered out of view.
const L_IDLE = pose(-0.2, -0.3, -0.15, 0.24, -0.16, -0.1);
const L_SPRINT = pose(-0.24, -0.27, -0.12, 0.05, -0.5, -0.45);
const L_LOWERED = pose(-0.26, -0.62, -0.05, -0.6, -0.3, -0.2);

const FISTS: HeldConfig = { twoHanded: false, grips: [0], wrist: 0, windup: 0.1, strike: 0.07, recover: 0.2, noise: 0.25 };

/**
 * Two-handed weapon keyframes in viewmodel-camera space, anchored on the lower (left) hand at the end of
 * the handle: where that hand is, which way the handle points from butt to head, which way the edge
 * faces. Axe, bat and crowbar share the poses: the left forearm always stays low left in the frame, the
 * right hand and the head sit further up the handle by each weapon's own length.
 * Hands are placed on the grips each frame (see placeHand).
 */
interface WeaponKey {
  hand: Vector3;
  q: Quaternion;
}
const key2h = (hand: [number, number, number], axis: [number, number, number], edge: [number, number, number]): WeaponKey => ({
  hand: new Vector3(...hand),
  q: basisQuat(new Vector3(...axis), new Vector3(...edge)),
});
/**
 * Ready stance, diagonally across the body (like holding a fire axe at port arms): the head up by the
 * right shoulder in the top right of the frame, edge out and forward; the handle running down to the
 * left hip, the left hand at its end low left. The crosshair stays clear (the handle passes well below it).
 */
const W_IDLE = key2h([-0.11, -0.25, -0.46], [0.72, 0.66, -0.2], [0.6, 0, -0.8]);
/** Sprinting: lower and flatter across the chest, the head tipped back a little. */
const W_SPRINT = key2h([-0.08, -0.27, -0.42], [0.85, 0.5, -0.1], [0.3, 0, -1]);
/** Wound up: the head lifted back over the right shoulder, the edge leading. */
const W_WINDUP = key2h([0.08, -0.12, -0.5], [0.35, 0.85, 0.4], [0.1, 0.6, -0.8]);
/** End of the chop: hands down at the belly, the head forward and low, mostly below the frame. */
const W_STRIKE = key2h([0.05, -0.19, -0.25], [-0.15, -0.3, -0.94], [0, -1, 0.15]);
/** Elbow directions (from the hand towards the elbow): both elbows bent, down and back, never at the camera. */
/** Two-bone arms for two-handed grips: shoulders below and just behind the eyes, elbows bent down and out. */
const SHOULDER_R = new Vector3(0.19, -0.25, -0.05);
const SHOULDER_L = new Vector3(-0.19, -0.25, -0.05);
const POLE_R = new Vector3(0.7, -0.6, 0.25).normalize();
const POLE_L = new Vector3(-0.7, -0.6, 0.25).normalize();
const UPPER = 0.4;
const FOREARM = 0.32;
const HAND_OFFSET = FOREARM + 0.01;

export interface ViewmodelFrame {
  lookX: number;
  lookY: number;
  stepPhase: number;
  speed: number;
  sprinting: boolean;
  flashlightOn: boolean;
}

const _v = new Vector3();
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/** Two-bone IK: elbow for a shoulder, a wrist target, bone lengths a (upper) and b (fore), bent towards pole. */
function solveElbow(s: Vector3, w: Vector3, a: number, b: number, pole: Vector3, out: Vector3): void {
  const dir = new Vector3().subVectors(w, s);
  const len = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, dir.length()));
  dir.normalize();
  const along = (a * a - b * b + len * len) / (2 * len);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const p = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(s).addScaledVector(dir, along).addScaledVector(p, h);
}

/**
 * First-person arms, drawn in a second pass with their own camera and FOV after clearing depth:
 * they never clip into walls and their framing doesn't change with the world FOV.
 *
 * One-handed items (knife, hammer, fists) ride in the right fist with keyframed arm poses; the
 * flashlight is in the left. Two-handed weapons (axe, bat, crowbar) are posed themselves and both
 * hands are placed on their grips every frame — the flashlight then moves to the head (`headlamp`).
 */
export class Viewmodel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 5);

  private readonly root = new Group();
  private readonly armR = new Group();
  private readonly armL = new Group();
  private readonly handR = new Group();
  private readonly handL = new Group();
  private readonly held = new Map<RightItem, Group>();
  private readonly torch: Group;
  private readonly sleeves: Mesh[] = [];
  private readonly cuffs: Mesh[] = [];
  /** Upper arms (shoulder → elbow) of the two-handed grips; [right, left]. */
  private readonly uppers: Mesh[] = [];
  private readonly hands: Mesh[] = [];
  private readonly lens: MeshBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly bounce = new PointLight(0xfffaed, 0, 1.5, 2);
  private readonly ambient = new AmbientLight(0x050510, 0.15);
  private readonly moon = new DirectionalLight(0x5a6c90, 0.12);
  private readonly weapon = { pos: new Vector3(), q: new Quaternion() };

  private item: RightItem = 'knife';
  private pendingItem: RightItem | null = null;
  /** -1 = idle, otherwise seconds since the attack started. */
  private attackT = -1;
  private strikeFired = false;
  private strikePending = false;
  /** Set when a swing starts (sound); the caller clears it. */
  swingStarted = false;

  private sprintT = 0;
  private rightDown = 0;
  private leftUp = 0;
  private swayX = 0;
  private swayY = 0;
  private time = 0;
  private readonly tmp: Pose = pose(0, 0, 0, 0, 0, 0);
  private readonly base: Pose = pose(0, 0, 0, 0, 0, 0);

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

    // One-handed items sit in the right fist with their grip point on the fist's grip axis.
    for (const id of ['knife', 'hammer'] as const) {
      const g = this.inFist(buildHeldModel(id, this.geometries), HELD[id].grips[0], 1);
      g.visible = id === this.item;
      this.handR.add(g);
      this.held.set(id, g);
    }
    // Two-handed weapons are posed in the viewmodel space, hands follow them.
    for (const id of ['axe', 'bat', 'crowbar'] as const) {
      const g = buildHeldModel(id, this.geometries);
      g.visible = false;
      this.root.add(g);
      this.held.set(id, g);
    }

    // Flashlight in the left fist, lens forward.
    this.torch = this.inFist(buildHeldModel('torch', this.geometries), HELD.torch.grips[0], -1);
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
    }
    const twoHanded = this.headlamp;
    this.torch.visible = !twoHanded;
    for (const u of this.uppers) u.visible = twoHanded;
    this.lens.color.setHex(f.flashlightOn ? 0xfff2c4 : 0x3a3a34);
    // The light comes from the left hand, or from the forehead when both hands are on a weapon.
    if (twoHanded) this.bounce.position.set(0.05, 0.22, -0.05);
    else this.bounce.position.set(-0.12, -0.12, -0.35);
    this.bounce.intensity = f.flashlightOn ? (twoHanded ? 0.16 : 0.08) : 0;
    const pump = Math.sin(f.stepPhase) * this.sprintT;

    if (twoHanded) {
      this.poseWeapon(pump);
    } else {
      // Right arm: idle/sprint base → lowered for switching → attack overlay.
      lerpPose(this.base, R_IDLE, R_SPRINT, this.sprintT);
      // Arms pump in step with the legs while sprinting.
      this.base.rx += pump * 0.22;
      this.base.py += pump * 0.03;
      lerpPose(this.base, this.base, R_LOWERED, this.rightDown);
      applyPose(this.armR, this.attackPose(this.base));
      this.handR.position.set(0, 0, -HAND_OFFSET);
      this.handL.position.set(0, 0, -HAND_OFFSET);
      this.handR.rotation.set(this.config(this.item).wrist, 0, 0);

      lerpPose(this.tmp, L_IDLE, L_SPRINT, this.sprintT);
      this.tmp.rx -= pump * 0.22;
      this.tmp.py -= pump * 0.03;
      lerpPose(this.tmp, L_LOWERED, this.tmp, this.leftUp);
      applyPose(this.armL, this.tmp);
      this.handL.rotation.set(HELD.torch.wrist, 0, 0);
    }

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

  /** Two-handed: blend the weapon keyframes (idle/sprint → swing; lowered while switching), then the hands. */
  private poseWeapon(pump: number): void {
    const a = this.config(this.item);
    const w = this.weapon;
    // w.pos holds the lower hand here; turned into the butt position at the end.
    w.pos.copy(W_IDLE.hand).lerp(W_SPRINT.hand, this.sprintT);
    w.q.copy(W_IDLE.q).slerp(W_SPRINT.q, this.sprintT);
    w.pos.y += pump * 0.025;
    if (this.attackT >= 0) {
      const t = this.attackT;
      let from: WeaponKey;
      let to: WeaponKey;
      let k: number;
      if (t < a.windup) {
        from = { hand: w.pos.clone(), q: w.q.clone() };
        to = W_WINDUP;
        k = easeOutQuad(t / a.windup);
      } else if (t < a.windup + a.strike) {
        from = W_WINDUP;
        to = W_STRIKE;
        k = easeInQuad((t - a.windup) / a.strike);
      } else {
        from = W_STRIKE;
        to = { hand: w.pos.clone(), q: w.q.clone() };
        k = easeInOutSine(Math.min(1, (t - a.windup - a.strike) / a.recover));
      }
      w.pos.copy(from.hand).lerp(to.hand, k);
      w.q.copy(from.q).slerp(to.q, k);
    }
    w.pos.y -= this.rightDown * 0.45;
    // Butt = the lower hand back down the handle by its grip distance.
    w.pos.addScaledVector(_v.set(0, 1, 0).applyQuaternion(w.q), -a.grips[1]);
    const g = this.held.get(this.item)!;
    g.position.copy(w.pos);
    g.quaternion.copy(w.q);
    this.placeHand(this.armR, this.handR, this.uppers[0], a.grips[0], SHOULDER_R, POLE_R, 1);
    this.placeHand(this.armL, this.handL, this.uppers[1], a.grips[1], SHOULDER_L, POLE_L, -1);
  }

  /**
   * A hand on the handle at `grip` from the butt, the arm a two-bone chain to it: shoulder → elbow
   * (upper arm, fixed length) → wrist (forearm), the elbow bent towards `pole` (down and out). The fist
   * wraps the handle (its grip axis along it), turned towards the forearm.
   */
  private placeHand(arm: Group, hand: Group, upper: Mesh, grip: number, shoulder: Vector3, pole: Vector3, side: number): void {
    const w = this.weapon;
    const axis = new Vector3(0, 1, 0).applyQuaternion(w.q);
    const point = new Vector3(0, grip, 0).applyQuaternion(w.q).add(w.pos);
    const toElbow = pole.clone();
    const handQ = new Quaternion();
    const wrist = new Vector3();
    const elbow = new Vector3();
    for (let it = 0; it < 2; it++) {
      // Hand basis: y = handle axis, z = towards the elbow (perpendicular part), x = y × z.
      const z = toElbow.clone().addScaledVector(axis, -toElbow.dot(axis)).normalize();
      handQ.setFromRotationMatrix(_m.makeBasis(new Vector3().crossVectors(axis, z), axis, z));
      wrist.copy(point).sub(new Vector3(GRIP_X * side, 0, GRIP_Z).applyQuaternion(handQ));
      solveElbow(shoulder, wrist, UPPER, HAND_OFFSET, pole, elbow);
      toElbow.subVectors(elbow, wrist).normalize();
    }
    // Forearm: from the elbow along its −Z to the wrist; the hand keeps its own (handle) rotation.
    arm.position.copy(elbow);
    arm.quaternion.setFromRotationMatrix(_m.lookAt(elbow, wrist, axis));
    hand.position.set(0, 0, -elbow.distanceTo(wrist));
    hand.quaternion.copy(arm.quaternion).invert().multiply(handQ);
    // Upper arm: shoulder to elbow.
    upper.position.copy(shoulder);
    upper.quaternion.setFromRotationMatrix(_m.lookAt(shoulder, elbow, _up));
    upper.scale.set(1, 1, shoulder.distanceTo(elbow) / UPPER);
  }

  private attackPose(base: Pose): Pose {
    if (this.attackT < 0) return base;
    const a = this.config(this.item);
    const windup = this.item === 'fists' ? R_FIST_WINDUP : R_KNIFE_WINDUP;
    const strike = this.item === 'fists' ? R_FIST_STRIKE : R_KNIFE_STRIKE;
    const t = this.attackT;
    if (t < a.windup) return lerpPose(this.tmp, base, windup, easeOutQuad(t / a.windup));
    if (t < a.windup + a.strike) return lerpPose(this.tmp, windup, strike, easeInQuad((t - a.windup) / a.strike));
    const r = Math.min(1, (t - a.windup - a.strike) / a.recover);
    return lerpPose(this.tmp, strike, base, easeInOutSine(r));
  }

  /** Item model placed in a fist: its grip point on the fist's grip axis, handle along it. */
  private inFist(model: Group, grip: number, side: number): Group {
    const g = new Group();
    model.position.set(GRIP_X * side, -grip, GRIP_Z);
    g.add(model);
    return g;
  }

  /** side: +1 right, -1 left. Root = elbow; forearm extends along -Z to the hand. */
  private buildArm(arm: Group, hand: Group, side: number, skin: Material): void {
    const sleeve = new Mesh(this.geo(limbForward(0.052, 0.043, FOREARM)), skin);
    const cuffMesh = new Mesh(this.geo(limbForward(0.046, 0.046, 0.03)), skin);
    cuffMesh.position.z = -FOREARM + 0.02;
    // Upper arm (two-handed grips), with a rounded elbow at its end.
    const upper = new Mesh(this.geo(limbForward(0.064, 0.054, UPPER)), skin);
    const joint = new Mesh(this.geo(new SphereGeometry(0.055, 8, 6)), skin);
    joint.position.z = -UPPER;
    upper.add(joint);
    upper.visible = false;
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

/** Rotation whose +Y is `axis` and whose −Z leans towards `edge` (the item's forward / edge side). */
function basisQuat(axis: Vector3, edge: Vector3): Quaternion {
  const y = axis.clone().normalize();
  const f = edge.clone().addScaledVector(y, -edge.dot(y)).normalize();
  const z = f.negate();
  const x = new Vector3().crossVectors(y, z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

function lerpPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  out.px = lerp(a.px, b.px, t);
  out.py = lerp(a.py, b.py, t);
  out.pz = lerp(a.pz, b.pz, t);
  out.rx = lerp(a.rx, b.rx, t);
  out.ry = lerp(a.ry, b.ry, t);
  out.rz = lerp(a.rz, b.rz, t);
  return out;
}

function applyPose(g: Group, p: Pose): void {
  g.position.set(p.px, p.py, p.pz);
  g.rotation.set(p.rx, p.ry, p.rz);
}
