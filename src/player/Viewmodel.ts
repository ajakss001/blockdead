import {
  BoxGeometry,
  ConeGeometry,
  AmbientLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  type BufferGeometry,
  type Material,
} from 'three';
import { clamp, damp, easeInOutSine, easeInQuad, easeOutQuad, lerp } from '../core/math';
import { limbForward } from '../render/lowpoly';
import { bladeMaterial, characterMaterial } from '../render/look/materials';
import { cuffColor, SKIN } from './outfit';
import { SPEED_WALK } from './PlayerController';

export type RightItem = 'fists' | 'knife' | 'axe' | 'bat' | 'crowbar' | 'hammer';

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

// Right arm. Elbows sit below the screen edge; only forearm + hand enter the frame.
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

/** Attack timeline, seconds. The hit is registered at the start of `strike`. */
const ATTACKS: Record<RightItem, { windup: number; strike: number; recover: number; noise: number }> = {
  knife: { windup: 0.13, strike: 0.09, recover: 0.26, noise: 0.2 },
  fists: { windup: 0.1, strike: 0.07, recover: 0.2, noise: 0.25 },
  // Stage 4 gives the long weapons their own swing arcs; for now they share the knife's poses.
  axe: { windup: 0.3, strike: 0.12, recover: 0.45, noise: 0.5 },
  bat: { windup: 0.24, strike: 0.11, recover: 0.38, noise: 0.45 },
  crowbar: { windup: 0.26, strike: 0.11, recover: 0.4, noise: 0.5 },
  hammer: { windup: 0.16, strike: 0.09, recover: 0.3, noise: 0.4 },
};

const FOREARM = 0.32;

export interface ViewmodelFrame {
  lookX: number;
  lookY: number;
  stepPhase: number;
  speed: number;
  sprinting: boolean;
  flashlightOn: boolean;
}

/**
 * First-person arms, drawn in a second pass with their own camera and FOV after clearing depth:
 * they never clip into walls and their framing doesn't change with the world FOV.
 * Everything is procedural — keyframe poses blended with easing, plus bob, sway and breathing.
 */
export class Viewmodel {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(60, 1, 0.01, 5);

  private readonly root = new Group();
  private readonly armR = new Group();
  private readonly armL = new Group();
  private readonly knife = new Group();
  private readonly held = new Map<RightItem, Group>();
  private readonly sleeves: Mesh[] = [];
  private readonly cuffs: Mesh[] = [];
  private readonly lens: MeshBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly bounce = new PointLight(0xfffaed, 0, 1.5, 2);

  private item: RightItem = 'knife';
  private pendingItem: RightItem | null = null;
  /** -1 = idle, otherwise seconds since the attack started. */
  private attackT = -1;
  private strikeFired = false;
  private strikePending = false;

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
    this.scene.add(new AmbientLight(0x050510, 0.15));
    const moon = new DirectionalLight(0x5a6c90, 0.12);
    moon.position.set(-0.5, 1, 0.4);
    this.scene.add(moon, this.bounce);
    this.bounce.position.set(-0.12, -0.12, -0.35);

    const skin = characterMaterial('skin', SKIN);
    this.buildArm(this.armR, 1, skin);
    this.buildArm(this.armL, -1, skin);
    this.setSleeves(0x3d4a5c);

    // Kitchen knife in the right fist, blade forward-up.
    const handle = new Mesh(this.geo(new BoxGeometry(0.024, 0.03, 0.1)), characterMaterial('handle', 0x3b2a1e));
    const bladeGeo = this.geo(new ConeGeometry(0.03, 0.15, 4));
    bladeGeo.scale(0.22, 1, 1);
    bladeGeo.rotateX(-Math.PI / 2);
    bladeGeo.translate(0, 0, -0.125);
    // Dark rusty steel with notches (bump) — catches the flashlight only in thin highlights.
    const blade = new Mesh(bladeGeo, bladeMaterial());
    this.knife.add(handle, blade);
    this.knife.position.set(-0.012, 0.015, -0.075);
    // Tilt forward-up and roll so the flat of the blade faces the camera instead of its edge.
    this.knife.rotation.set(0.45, 0, 1.1);
    (this.armR.userData.hand as Group).add(this.knife);
    this.held.set('knife', this.knife);
    this.buildHeldTools();

    // Flashlight in the left fist, pointing forward.
    const torch = new Group();
    const body = new Mesh(this.geo(limbForward(0.018, 0.018, 0.15, 8)), characterMaterial('torch', 0x2d2f31));
    body.position.z = 0.05;
    const head = new Mesh(this.geo(limbForward(0.022, 0.028, 0.045, 8)), characterMaterial('torch', 0x3a3d40));
    head.position.z = -0.1;
    this.lens = this.mat(new MeshBasicMaterial({ color: 0x3a3a34 })) as MeshBasicMaterial;
    const lens = new Mesh(this.geo(limbForward(0.026, 0.026, 0.004, 8)), this.lens);
    lens.position.z = -0.145;
    torch.add(body, head, lens);
    torch.position.set(0.012, 0.012, -0.07);
    (this.armL.userData.hand as Group).add(torch);

    this.root.add(this.armR, this.armL);
    this.scene.add(this.root);
  }

  get currentItem(): RightItem {
    return this.item;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jacket sleeves in the worn color, or bare forearms (null). */
  setSleeves(color: number | null): void {
    const skin = characterMaterial('skin', SKIN);
    const sleeve = color === null ? skin : characterMaterial('jacket', color);
    const cuff = color === null ? skin : characterMaterial('cuff', cuffColor(color));
    for (const m of this.sleeves) m.material = sleeve;
    for (const m of this.cuffs) {
      m.material = cuff;
      m.visible = color !== null;
    }
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
      }
      return;
    }
    const a = ATTACKS[this.item];
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
    return ATTACKS[this.item].noise;
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
    this.lens.color.setHex(f.flashlightOn ? 0xfff2c4 : 0x3a3a34);
    this.bounce.intensity = f.flashlightOn ? 0.08 : 0;

    // Right arm: idle/sprint base → lowered for switching → attack overlay.
    lerpPose(this.base, R_IDLE, R_SPRINT, this.sprintT);
    // Arms pump in step with the legs while sprinting.
    const pump = Math.sin(f.stepPhase) * this.sprintT;
    this.base.rx += pump * 0.22;
    this.base.py += pump * 0.03;
    lerpPose(this.base, this.base, R_LOWERED, this.rightDown);
    applyPose(this.armR, this.attackPose(this.base));

    lerpPose(this.tmp, L_IDLE, L_SPRINT, this.sprintT);
    this.tmp.rx -= pump * 0.22;
    this.tmp.py -= pump * 0.03;
    lerpPose(this.tmp, L_LOWERED, this.tmp, this.leftUp);
    applyPose(this.armL, this.tmp);

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

  private attackPose(base: Pose): Pose {
    if (this.attackT < 0) return base;
    const a = ATTACKS[this.item];
    const windup = this.item === 'fists' ? R_FIST_WINDUP : R_KNIFE_WINDUP;
    const strike = this.item === 'fists' ? R_FIST_STRIKE : R_KNIFE_STRIKE;
    const t = this.attackT;
    if (t < a.windup) return lerpPose(this.tmp, base, windup, easeOutQuad(t / a.windup));
    if (t < a.windup + a.strike) return lerpPose(this.tmp, windup, strike, easeInQuad((t - a.windup) / a.strike));
    const r = Math.min(1, (t - a.windup - a.strike) / a.recover);
    return lerpPose(this.tmp, strike, base, easeInOutSine(r));
  }

  /** side: +1 right, -1 left. Root = elbow; forearm extends along -Z to the hand. */
  private buildArm(arm: Group, side: number, skin: Material): void {
    const sleeve = new Mesh(this.geo(limbForward(0.052, 0.043, FOREARM)), skin);
    const cuffMesh = new Mesh(this.geo(limbForward(0.046, 0.046, 0.03)), skin);
    cuffMesh.position.z = -FOREARM + 0.02;
    arm.add(sleeve, cuffMesh);
    this.sleeves.push(sleeve);
    this.cuffs.push(cuffMesh);

    const hand = new Group();
    hand.position.z = -FOREARM - 0.01;
    const palm = new Mesh(this.geo(new BoxGeometry(0.036, 0.075, 0.085)), skin);
    palm.position.z = -0.04;
    // Curled fingers form the fist around a vertical grip on the inner side of the palm.
    const fingers = new Mesh(this.geo(new BoxGeometry(0.05, 0.072, 0.034)), skin);
    fingers.position.set(-side * 0.014, -0.004, -0.088);
    const thumb = new Mesh(this.geo(new BoxGeometry(0.022, 0.022, 0.05)), skin);
    thumb.position.set(-side * 0.03, 0.03, -0.06);
    thumb.rotation.y = side * 0.4;
    hand.add(palm, fingers, thumb);
    arm.add(hand);
    arm.userData.hand = hand;
  }

  /**
   * Long tools in the right fist: shafts run forward-up out of the grip, heads at the far end.
   * All share the grungy character materials (wood, dark steel, the knife's rusty blade).
   */
  private buildHeldTools(): void {
    const wood = characterMaterial('handle', 0x6e5034);
    const steel = characterMaterial('torch', 0x3c4044);
    const hand = this.armR.userData.hand as Group;
    const make = (id: RightItem, build: (g: Group) => void) => {
      const g = new Group();
      build(g);
      g.position.set(-0.012, 0.012, -0.075);
      // Shaft forward and slightly inward, so the head stays in frame on a phone screen.
      g.rotation.set(0.2, 0.3, 0);
      g.visible = false;
      hand.add(g);
      this.held.set(id, g);
    };
    make('axe', (g) => {
      const shaft = new Mesh(this.geo(limbForward(0.015, 0.013, 0.5, 6)), characterMaterial('handle', 0x8a3a24));
      shaft.position.z = 0.1;
      const head = new Mesh(this.geo(new BoxGeometry(0.014, 0.13, 0.06)), bladeMaterial());
      head.position.set(0, 0.03, -0.37);
      const spike = new Mesh(this.geo(new ConeGeometry(0.012, 0.06, 4)), steel);
      spike.position.set(0, -0.06, -0.37);
      spike.rotation.x = Math.PI;
      g.add(shaft, head, spike);
    });
    make('bat', (g) => {
      const body = new Mesh(this.geo(limbForward(0.017, 0.036, 0.62, 8)), wood);
      body.position.z = 0.08;
      const knob = new Mesh(this.geo(limbForward(0.024, 0.024, 0.015, 8)), wood);
      knob.position.z = 0.09;
      g.add(body, knob);
    });
    make('crowbar', (g) => {
      const bar = new Mesh(this.geo(limbForward(0.011, 0.011, 0.55, 6)), steel);
      bar.position.z = 0.1;
      const hook = new Mesh(this.geo(limbForward(0.011, 0.008, 0.08, 6)), steel);
      hook.position.set(0, 0, -0.45);
      hook.rotation.x = 1.1;
      g.add(bar, hook);
    });
    make('hammer', (g) => {
      const shaft = new Mesh(this.geo(limbForward(0.013, 0.012, 0.3, 6)), wood);
      shaft.position.z = 0.06;
      const head = new Mesh(this.geo(new BoxGeometry(0.028, 0.11, 0.03)), steel);
      head.position.set(0, 0.02, -0.235);
      g.add(shaft, head);
    });
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
