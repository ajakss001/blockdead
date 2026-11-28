import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  DirectionalLight,
  CylinderGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { GUNS, type GunId, isGun, type ModId } from '../weapons/guns';
import type { GunAction } from '../weapons/gunState';
import { GunModel, loadWeaponPart, weaponPartMaterial } from '../weapons/gunModel';
import { grim } from '../style/palette';
import { gunRigData, type GunPoseInput, type GunPoseOut, newGunPoseOut, poseGun } from './gunPose';
import { clamp, damp } from '../core/math';
import { FLASHLIGHT } from '../items/config';
import { setLensGlow } from '../items/flashlight';
import type { BodyId } from '../characters/assets';
import { type ArmPose, HAND_OFFSET, HandsRig, hitTime, type ItemState, swingTime } from './armRig';
import { FpArms } from './fpArms';
import { gripHands } from './grips';
import { GRIP_X, GRIP_Z } from './hand';
import { buildHeldModel, FISTS, HELD, type HeldConfig, type HeldId } from './held';
import { SPEED_WALK } from './PlayerController';

export type RightItem = 'fists' | Exclude<HeldId, 'torch'>;
/** What the right hand can hold: a melee item (or nothing) or a gun. */
export type HandItem = RightItem | GunId;

/** The gun's state for its animation, set by the scene (systems/Firearms) every frame. */
export interface GunView {
  action: GunAction;
  t: number;
  duration: number;
  open: boolean;
  /** Wants the sights / how close a wall is in front 0..1 (eased by the viewmodel). */
  ads: boolean;
  wall: number;
  /** How far the wall straight ahead is, m (99: none): the muzzle never goes past it. */
  wallDist: number;
  /** The rocket is in the tube. */
  chamber: boolean;
  /** Rounds remaining inside the magazine / internal clip (optional, defaults to capacity). */
  mag?: number;
  capacity?: number;
  mods: readonly ModId[];
}

export interface ViewmodelFrame {
  lookX: number;
  lookY: number;
  stepPhase: number;
  speed: number;
  sprinting: boolean;
  flashlightOn: boolean;
  /** How bright the flashlight shines now, 0..1 (battery, flicker): the lens glow and the bounce. */
  light?: number;
  /** 0..1 crouched. */
  crouch?: number;
}

const _axisY = new Vector3(0, 1, 0);
/** The beam's main direction (eye space): ahead, a touch down. */
const _fwd = new Vector3(0, -0.08, -1).normalize();
const _hand = new Vector3();
const _m4 = new Matrix4();
const _m4b = new Matrix4();
const _gq = new Quaternion();
const _gp = new Vector3();
const _one = new Vector3(1, 1, 1);
/** Seconds in the sights before the aim starts to waver (the arms tire). */
const STEADY = 4;

/**
 * First-person arms, drawn in a second pass with their own camera and FOV after clearing depth:
 * they never clip into walls and their framing doesn't change with the world FOV.
 *
 * Every item is posed by its key poses and both arms are solved to it (`armRig`): the item is a child of
 * the right hand (grip_main); the left hand holds the off socket of a two-handed weapon — the flashlight
 * then moves to the head (`headlamp`) — or the flashlight, itself an item posed the same way.
 * The arms drawn are the character model's own (fpArms), skinned to the solve's frames.
 */
const _wallM = new Vector3();
const _wallR = new Vector3();
const _wallT = new Vector3();
const _wallQ = new Quaternion();
const _wallX = new Vector3(1, 0, 0);
/** Most a gun tips down about its grip at a wall (rad); the rest of the way it is pulled back. */
const WALL_TIP = 1.1;

export class Viewmodel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 5);
  /** Arm solve of the last frame (read by ?animdebug and test:anim). */
  readonly rig = new HandsRig();

  private readonly root = new Group();
  private readonly armsGroup = new Group();
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
  private readonly rim = new DirectionalLight(0x9aa6b8, 0.35);
  private readonly itemState: ItemState = { attackT: -1, sprint: 0, pump: 0, lower: 0 };
  private readonly torchState: ItemState = { attackT: -1, sprint: 0, pump: 0, lower: 0 };

  private item: HandItem = 'knife';
  private pendingItem: HandItem | null = null;
  /** Guns: each in a holder in the right hand (the grip_main frame undone), made on first use. */
  private readonly guns = new Map<GunId, { holder: Group; model: GunModel; base: Matrix4 }>();
  /** The shell (pump gun) and 5-round .308 cartridge pack (hunting rifle) in the left hand while loading. */
  private readonly shell: Group;
  private readonly rifleClip = new Group();
  /** Set by the scene each frame while a gun is in hand. */
  readonly gunView: GunView = { action: 'idle', t: 0, duration: 1, open: false, ads: false, wall: 0, wallDist: 99, chamber: true, mag: 99, capacity: 99, mods: [] };
  /** The pose of the gun this frame (read by test:anim, ?animdebug and the scene for the muzzle). */
  readonly gunPose: GunPoseOut = newGunPoseOut();
  private readonly gunIn: GunPoseInput = { ads: 0, sprint: 0, crouch: 0, wall: 0, lower: 0, pump: 0, action: 'idle', t: 0, duration: 1, sinceShot: -1, open: false, chamber: true, kickBack: 0, kickUp: 0, kickSide: 0, kickRoll: 0 };
  /** In the sights 0..1 (eased), and for how long (the aim wavers after STEADY s). */
  ads = 0;
  private adsTime = 0;
  private wallT = 0;
  /** Recoil springs: value and velocity of back (m), up, side, roll (rad). */
  private readonly kick = [0, 0, 0, 0];
  private readonly kickV = [0, 0, 0, 0];
  private sinceShot = -1;
  /** -1 = idle, otherwise seconds since the attack started. */
  private attackT = -1;
  private strikeFired = false;
  /** Seconds until the next blow may start (the weapon's interval). */
  private cooldown = 0;
  /** Recoil of a blow that met something, 1 → 0. */
  private blowKick = 0;
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
    this.rim.position.set(0.55, 0.75, 0.65);
    this.scene.add(moon, this.rim, this.bounce);
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
    this.shell = new Group();
    this.shell.position.set(0.03, 0, -0.05);
    this.shell.visible = false;
    const shellGeo = new CylinderGeometry(0.0105, 0.0105, 0.07, 8).rotateX(Math.PI / 2);
    this.geometries.push(shellGeo);
    const shellMat = new MeshLambertMaterial({ color: grim(0x4a5a44) });
    this.materials.push(shellMat);
    this.shell.add(new Mesh(shellGeo, shellMat));
    void loadWeaponPart('shell_12g').then((part) => {
      if (!part) return;
      this.shell.clear();
      this.shell.add(new Mesh(part.geo, weaponPartMaterial(`shell_12g:${part.map ? 't' : 'c'}`, grim(0x7c2a24), part.map)));
    });
    this.handL.add(this.shell);
    this.rifleClip.name = 'rifleClip';
    this.rifleClip.position.set(0.022, 0.016, -0.072);
    this.rifleClip.rotation.set(0.25, 0.35, -0.2);
    this.rifleClip.visible = false;
    const clipSpineGeo = new BoxGeometry(0.048, 0.008, 0.012);
    const caseGeo = new CylinderGeometry(0.0044, 0.0046, 0.036, 8).rotateX(Math.PI / 2);
    const tipGeo = new CylinderGeometry(0.0008, 0.0042, 0.018, 8).rotateX(-Math.PI / 2);
    this.geometries.push(clipSpineGeo, caseGeo, tipGeo);
    const clipMat = new MeshLambertMaterial({ color: grim(0x282a2d) });
    const brassMat = new MeshLambertMaterial({ color: 0xe6be53, emissive: 0x3b2d0a });
    const copperMat = new MeshLambertMaterial({ color: 0xd4743b, emissive: 0x331608 });
    this.materials.push(clipMat, brassMat, copperMat);
    const spine = new Mesh(clipSpineGeo, clipMat);
    spine.position.set(0, -0.004, 0.02);
    this.rifleClip.add(spine);
    for (let i = 0; i < 5; i++) {
      const rx = (i - 2) * 0.0092;
      const c = new Mesh(caseGeo, brassMat);
      c.position.set(rx, 0, 0);
      const t = new Mesh(tipGeo, copperMat);
      t.position.set(rx, 0, -0.027);
      this.rifleClip.add(c, t);
    }
    void loadWeaponPart('clip_308').then((part) => {
      if (!part) return;
      this.rifleClip.clear();
      this.rifleClip.add(new Mesh(part.geo, weaponPartMaterial(`clip_308:${part.map ? 't' : 'c'}`, grim(0xb8963c), part.map)));
    });
    this.handL.add(this.rifleClip);

    this.root.add(this.armR, this.armL, ...this.uppers);
    this.scene.add(this.root, this.armsGroup);
  }

  /** Show/hide the first-person arms & held items without hiding sibling scene groups (e.g. Mi-8 cockpit). */
  setArmsVisible(visible: boolean): void {
    this.root.visible = visible;
    this.armsGroup.visible = visible;
  }

  /** Swing timing of what is in hand. */
  get swing(): HeldConfig {
    return this.config(this.item);
  }

  get currentItem(): HandItem {
    return this.item;
  }

  /** The gun in hand (switched to), or null. */
  get gun(): GunId | null {
    return isGun(this.item) ? this.item : null;
  }

  /** The model of the gun in hand. */
  get gunModel(): GunModel | null {
    return isGun(this.item) ? (this.guns.get(this.item)?.model ?? null) : null;
  }

  /** A switch is under way (the old item going down or the new one not up yet). */
  get switching(): boolean {
    return this.pendingItem !== null || this.rightDown > 0.05;
  }

  /** Camera pitch the swing or firearm weapon animation asks for this frame (rad, + up). */
  get cameraPitch(): number {
    return this.rig.pitch + (isGun(this.item) ? this.gunPose.camPitch : 0);
  }

  /** Subtle first-person camera roll impulse during mechanical weapon handling (rad). */
  get cameraRoll(): number {
    return isGun(this.item) ? this.gunPose.camRoll : 0;
  }

  /** The current weapon needs both hands: the flashlight is worn on the head. */
  get headlamp(): boolean {
    return this.twoHands && !this.underLight;
  }

  /** Both hands on what is in the right one (every gun is held with both). */
  get twoHands(): boolean {
    return isGun(this.item) || this.config(this.item).twoHanded;
  }

  /** A gun without the underbarrel flashlight: both hands on it, no flashlight shines. */
  get lightBlocked(): boolean {
    return isGun(this.item) && !this.underLight;
  }

  /** The gun in hand carries the underbarrel flashlight: the beam comes from it. */
  get underLight(): boolean {
    return isGun(this.item) && this.gunView.mods.includes('mod_flashlight');
  }

  /** Day / night for the arms (they are drawn in their own scene). */
  /** The arms' own light follows the world's (style/stage): a grey overcast day, a dark night. */
  setDaylight(k: number): void {
    this.ambient.color.setRGB(0.02 + 0.4 * k, 0.02 + 0.43 * k, 0.06 + 0.42 * k);
    this.ambient.intensity = 0.24 + 0.52 * k;
    this.moon.color.setRGB(0.35 + 0.37 * k, 0.42 + 0.32 * k, 0.56 + 0.19 * k);
    this.moon.intensity = 0.24 + 0.42 * k;
    this.rim.intensity = 0.26 + 0.34 * k;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** The arms of the survivor's model (a man, a woman, the SWAT officer), `scale` their height's. */
  setBody(body: BodyId, scale: number): void {
    this.arms.setBody(body, scale, this.armsGroup);
  }

  equip(item: HandItem): void {
    if (isGun(item)) this.gunHolder(item);
    if (item !== this.item || this.pendingItem) this.pendingItem = item === this.item ? null : item;
  }

  /** Attack state machine at the simulation rate. */
  fixedUpdate(dt: number, wantsAttack: boolean): void {
    if (this.scrubT !== null) {
      this.attackT = this.scrubT;
      return;
    }
    if (isGun(this.item)) {
      this.attackT = -1;
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
    const gm = this.gunModel;
    if (gm && this.underLight) {
      gm.root.updateWorldMatrix(true, false);
      pos.set(...gm.sockets.light).applyMatrix4(gm.root.matrixWorld);
      dir.set(0, 0, -1).transformDirection(gm.root.matrixWorld);
      return;
    }
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
    this.blowKick = 1;
  }

  /**
   * A shot: the gun kicks back, the muzzle up and a random bit aside (less in the sights); on auto the
   * burst's climb adds up. Also the slide / bolt travel.
   */
  fire(up: number, side: number, back: number): void {
    const k = 1 - 0.45 * this.ads;
    this.kickV[0] += back * 22 * k;
    this.kickV[1] += up * 18 * k;
    this.kickV[2] += side * (Math.random() * 2 - 1) * 18 * k;
    this.kickV[3] += (Math.random() * 2 - 1) * up * 6 * k;
    this.sinceShot = 0;
  }

  update(dt: number, f: ViewmodelFrame): void {
    this.time += dt;
    this.blowKick = Math.max(0, this.blowKick - dt * 7);
    this.sprintT = damp(this.sprintT, f.sprinting ? 1 : 0, 10, dt);
    // The flashlight is always in the left hand (raised from below when it comes back from a two-handed grip).
    this.leftUp = this.headlamp ? 0 : damp(this.leftUp, 1, 7, dt);
    this.clickT = Math.max(0, this.clickT - dt * 6);

    // Weapon switch: lower, swap at the bottom, raise (a gun in its own draw / holster time).
    const goingDown = !!this.pendingItem;
    if (isGun(this.item)) {
      const tm = goingDown ? GUNS[this.item].times.holster : GUNS[this.item].times.draw;
      this.rightDown = goingDown ? Math.min(1, this.rightDown + dt / tm) : Math.max(0, this.rightDown - dt / tm);
    } else this.rightDown = damp(this.rightDown, goingDown ? 1 : 0, 12, dt);
    if (this.pendingItem && this.rightDown > (isGun(this.item) ? 0.999 : 0.95)) {
      this.item = this.pendingItem;
      this.pendingItem = null;
      for (const [id, g] of this.held) g.visible = id === this.item;
      for (const [id, g] of this.guns) g.holder.visible = id === this.item;
      if (isGun(this.item)) this.rightDown = 1;
      // Clear stale wall-tip / ADS smoothing from the previous weapon so swapped guns don't dip into the floor.
      this.wallT = 0;
      this.ads = 0;
      this.adsTime = 0;
      this.gunView.wall = 0;
      this.gunView.wallDist = 99;
      this.gunView.ads = false;
      this.rig.reset();
    }
    const twoHanded = this.twoHands;
    this.torch.visible = !twoHanded;
    this.shell.visible = false;
    this.rifleClip.visible = false;
    const light = f.light ?? (f.flashlightOn ? 1 : 0);
    setLensGlow(this.lens, light);
    // The light spills on the hands from the left fist (on the handle when both hands are on a weapon).
    this.bounce.position.set(twoHanded ? 0 : -0.12, -0.12, -0.35);
    if (isGun(this.item)) {
      this.updateGun(dt, f);
      return;
    }
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
    if (model) {
      model.position.y = -this.rig.mainAlong;
      // The hand's turn about the handle (the grip editor may change it).
      model.quaternion.setFromAxisAngle(_axisY, -this.config(this.item).main.roll);
    }
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
    const kick = this.blowKick * this.blowKick;
    this.root.position.set(bobX + this.swayX, bobY + this.swayY + breathe + kick * 0.012, kick * 0.035);
    this.root.rotation.set(this.swayY * 1.2 + kick * 0.06, this.swayX * 2, this.swayX * 1.5);
    this.root.updateMatrixWorld(true);
    // The fingers: the item's hand poses (data/grips.json); the left hand's closed grip on the flashlight when one-handed.
    const hp = gripHands(this.item, false, twoHanded);
    this.arms.setPose(0, hp.R, dt);
    this.arms.setPose(1, twoHanded ? hp.L : 'grip_torch', dt);
    this.arms.update(0, this.uppers[0], this.rig.right.pose.upperLen, this.armR, this.handR);
    this.arms.update(1, this.uppers[1], this.rig.left.pose.upperLen, this.armL, this.handL);
    this.handL.getWorldPosition(_hand);
    this.restL.x = damp(this.restL.x, _hand.x, 3, dt);
    this.restL.y = damp(this.restL.y, _hand.y, 3, dt);
  }

  /**
   * Where a hand should be on what it holds this frame (world = the arms' scene): the right on the gun's
   * grip, the left on its socket, on the magazine in its hand, or (reaching for the pouch) where it was sent.
   * test:anim measures the hands against these.
   */
  gunSocket(k: 0 | 1, outGrip: Vector3, outQ: Quaternion): void {
    const gm = this.gunModel!;
    const d = gunRigData(gm.id);
    const root = gm.root;
    root.updateWorldMatrix(true, false);
    const out = this.gunPose;
    let h = d.main;
    let obj = root;
    let dz = 0;
    if (k === 1) {
      if (out.left === 'gun') {
        h = d.off;
        dz = out.pump;
      } else if (out.left === 'mag') {
        h = d.magHold;
        obj = gm.parts.mag;
        obj.updateWorldMatrix(true, false);
      } else {
        this.root.updateWorldMatrix(true, false);
        outGrip.copy(out.leftGrip).applyMatrix4(this.root.matrixWorld);
        this.root.getWorldQuaternion(outQ).multiply(out.leftQ);
        return;
      }
    }
    outGrip.copy(h.at);
    outGrip.z += dz;
    outGrip.applyMatrix4(obj.matrixWorld);
    obj.getWorldQuaternion(outQ).multiply(h.q);
    // The hand's extra turn about the grip in the sights is part of its hold.
    const roll = k === 0 ? out.rollR : out.left === 'gun' ? out.rollL : 0;
    if (roll) outQ.multiply(_gq.setFromAxisAngle(_gp.set(0, 1, 0), roll));
  }

  /** The holder of a gun in the right hand: the gun frame placed so its grip_main frame sits in the fist. */
  private gunHolder(id: GunId): Group {
    let g = this.guns.get(id);
    if (!g) {
      const model = new GunModel(id);
      const holder = new Group();
      // hand ← gun: the fist's grip point and the hand frame on the gun, undone.
      const d = gunRigData(id);
      _m4.compose(_gp.set(GRIP_X, 0, GRIP_Z), _gq.identity(), _one);
      _m4b.compose(d.main.at, d.main.q, _one).invert();
      const base = _m4b.clone();
      _m4.multiply(_m4b);
      _m4.decompose(holder.position, holder.quaternion, holder.scale);
      holder.add(model.root);
      holder.visible = false;
      this.handR.add(holder);
      g = { holder, model, base };
      this.guns.set(id, g);
    }
    return g.holder;
  }

  /** The gun in hand: its pose (gunPose), both arms to its sockets, the moving parts, the sway. */
  private updateGun(dt: number, f: ViewmodelFrame): void {
    const id = this.item as GunId;
    const gv = this.gunView;
    const { holder, model } = this.guns.get(id)!;
    holder.visible = true;
    model.setMods(gv.mods);
    // Sights, wall: eased; the aim wavers after a while in the sights.
    const aimT = GUNS[id].times.aim;
    const noAdsAction =
      gv.action === 'checkMag' ||
      gv.action === 'checkChamber' ||
      gv.action === 'inspect' ||
      gv.action === 'reload' ||
      gv.action === 'reloadEmpty' ||
      gv.action === 'loadStart' ||
      gv.action === 'loadOne' ||
      gv.action === 'loadEnd' ||
      gv.action === 'unjam';
    const wantAds = gv.ads && !noAdsAction && this.sprintT < 0.3 && this.rightDown < 0.05 && gv.wall < 0.3;
    this.ads = clamp(this.ads + (wantAds ? dt : -dt) / aimT, 0, 1);
    this.adsTime = this.ads > 0.9 ? this.adsTime + dt : 0;
    this.wallT = damp(this.wallT, gv.wall, 16, dt);
    // Recoil springs (stiff, well damped).
    for (let i = 0; i < 4; i++) {
      this.kickV[i] += (-this.kick[i] * 260 - this.kickV[i] * 26) * dt;
      this.kick[i] += this.kickV[i] * dt;
    }
    if (this.sinceShot >= 0) this.sinceShot += dt;
    const inp = this.gunIn;
    inp.ads = this.ads;
    inp.sprint = this.sprintT;
    inp.crouch = f.crouch ?? 0;
    inp.wall = this.wallT;
    // A wall right in front: no room for the gun at all — it goes down out of the way.
    const wallLow = isGun(this.item) && GUNS[this.item].cls === 'pistol' ? 0.3 : 0.6;
    inp.lower = Math.max(this.rightDown, clamp((wallLow - this.gunView.wallDist) / 0.2, 0, 1));
    inp.pump = Math.sin(f.stepPhase) * this.sprintT;
    inp.action = gv.action;
    inp.t = gv.t;
    inp.duration = gv.duration;
    inp.sinceShot = this.sinceShot;
    inp.open = gv.open;
    inp.chamber = gv.chamber;
    inp.kickBack = this.kick[0];
    inp.kickUp = this.kick[1];
    inp.kickSide = this.kick[2];
    inp.kickRoll = this.kick[3];
    const out = this.gunPose;
    poseGun(id, inp, out);
    // Never through a wall: whatever the pose, the muzzle (the suppressor's end) stays this side of it.
    const gmw = this.gunModel;
    if (gmw && gv.wallDist < 5) {
      _wallM.set(...gmw.sockets.muzzle);
      if (gv.mods.includes('mod_suppressor')) _wallM.z -= 0.16;
      const room = gv.wallDist - 0.1;
      // A long barrel first tips down about the grip (the arm cannot fold far enough to pull it all back), then
      // what is left is pulled back.
      _wallR.copy(_wallM).applyQuaternion(out.q);
      if (-(out.pos.z + _wallR.z) > room) {
        let lo = 0, hi = WALL_TIP;
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          _wallQ.setFromAxisAngle(_wallX, -mid);
          if (-(out.pos.z + _wallT.copy(_wallR).applyQuaternion(_wallQ).z) > room) lo = mid;
          else hi = mid;
        }
        const tip = hi;
        if (tip > 1e-4) {
          _wallQ.setFromAxisAngle(_wallX, -tip);
          out.q.premultiply(_wallQ);
          out.rightQ.premultiply(_wallQ);
          out.leftQ.premultiply(_wallQ);
          out.magQ.premultiply(_wallQ);
          for (const p of [out.rightGrip, out.leftGrip, out.magPos]) p.sub(out.pos).applyQuaternion(_wallQ).add(out.pos);
        }
      }
      _wallM.applyQuaternion(out.q).add(out.pos);
      const over = -_wallM.z - room;
      if (over > 0) {
        out.pos.z += over;
        out.rightGrip.z += over;
        out.leftGrip.z += over;
        out.magPos.z += over;
      }
    }
    const rig = this.rig;
    rig.right.shoulder.copy(rig.right.rest).add(out.shoulderR);
    rig.left.shoulder.copy(rig.left.rest).add(out.shoulderL);
    rig.item.pos.copy(out.pos);
    rig.item.q.copy(out.q);
    rig.targetR.q.copy(out.rightQ);
    rig.targetR.grip.copy(out.rightGrip);
    rig.targetL.q.copy(out.leftQ);
    rig.targetL.grip.copy(out.leftGrip);
    rig.pitch = 0;
    rig.phase = 'rest';
    // The fist turned about the grip (the sights): the gun stays where the pose has it.
    {
      const g = this.guns.get(id)!;
      // hand ← gun from the rig's hand frame now (the grip editor may have moved it).
      const dm = gunRigData(id).main;
      g.base.compose(dm.at, dm.q, _one).invert();
      _m4.makeTranslation(GRIP_X, 0, GRIP_Z).multiply(_m4b.makeRotationY(-out.rollR)).multiply(g.base);
      _m4.decompose(g.holder.position, g.holder.quaternion, g.holder.scale);
    }
    rig.right.solve(out.rightQ, out.rightGrip);
    rig.left.solve(out.leftQ, out.leftGrip);
    this.applyArm(this.armR, this.handR, this.uppers[0], rig.right.pose);
    this.applyArm(this.armL, this.handL, this.uppers[1], rig.left.pose);
    // Moving parts, in the gun frame.
    const p = model.parts;
    p.slide.position.z = out.slide;
    p.pump.position.z = out.pump;
    model.setBoltLift(out.boltLift);
    p.mag.visible = out.magShown;
    if (out.magOnGun) {
      p.mag.position.set(...model.sockets.mag);
      p.mag.quaternion.identity();
    } else {
      // gun⁻¹ × magazine (both in the arms' space).
      _m4.compose(out.pos, out.q, _one).invert();
      _m4b.compose(out.magPos, out.magQ, _one);
      _m4.multiply(_m4b);
      _m4.decompose(p.mag.position, p.mag.quaternion, _gp);
    }
    p.rocket.visible = out.rocket || out.left === 'rocket';
    if (out.left === 'rocket') {
      // The rocket rides in the left hand until it is in the tube.
      _gp.copy(out.leftGrip).sub(out.pos).applyQuaternion(_gq.copy(out.q).invert());
      p.rocket.position.set(_gp.x - model.sockets.load[0], _gp.y - model.sockets.load[1], _gp.z - model.sockets.load[2]);
    } else p.rocket.position.set(0, 0, 0);
    const isBolt = id === 'rifle_hunting';
    model.setMagFill(gv.mag ?? GUNS[id].capacity, gv.capacity ?? GUNS[id].capacity);
    model.setBreechOpen(isBolt && (out.boltLift > 0.3 || out.slide > 0.015));
    this.shell.visible = out.left === 'shell' && !isBolt;
    this.rifleClip.visible = out.left === 'shell' && isBolt;
    // Sway and bob, much less in the sights (but growing after STEADY s there); breathing.
    const still = 1 - 0.85 * this.ads;
    const tired = this.ads * clamp((this.adsTime - STEADY) / 6, 0, 1);
    const inv = 1 / Math.max(dt, 1e-3);
    this.swayX = damp(this.swayX, clamp(-f.lookX * inv * 0.012, -0.05, 0.05) * still, 12, dt);
    this.swayY = damp(this.swayY, clamp(f.lookY * inv * 0.012, -0.05, 0.05) * still, 12, dt);
    const amp = clamp(f.speed / SPEED_WALK, 0, 1.6) * still;
    const bobX = Math.sin(f.stepPhase) * 0.01 * amp;
    const bobY = -Math.abs(Math.sin(f.stepPhase)) * 0.012 * amp;
    const breathe = Math.sin(this.time * 1.6) * 0.0035 * (1 - 0.9 * this.ads);
    const waver = tired * 0.004;
    this.root.position.set(bobX + this.swayX + Math.sin(this.time * 0.9) * waver, bobY + this.swayY + breathe + Math.sin(this.time * 1.3 + 1) * waver, 0);
    this.root.rotation.set(this.swayY * 1.2, this.swayX * 2, this.swayX * 1.5);
    this.root.updateMatrixWorld(true);
    const hp = gripHands(id, true, true);
    this.arms.setPose(0, hp.R, dt);
    this.arms.setPose(1, out.leftPose ?? (out.onBolt ? hp.bolt : out.left === 'gun' ? hp.L : out.left === 'none' ? 'relaxed' : 'mag_pinch'), dt);
    this.arms.update(0, this.uppers[0], rig.right.pose.upperLen, this.armR, this.handR);
    this.arms.update(1, this.uppers[1], rig.left.pose.upperLen, this.armL, this.handL);
  }

  /** Shared grunge materials are owned by look/materials; only the lens is ours. */
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.arms.dispose();
  }

  private config(item: HandItem): HeldConfig {
    return item === 'fists' || isGun(item) ? FISTS : HELD[item];
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
