import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { type ItemId, ITEMS, type WearSlot } from '../data/items';
import { ellipseLoft, type LoftRing } from '../render/lowpoly';
import { characterMaterial } from '../render/look/materials';
import type { Worn } from '../systems/Inventory';
import { type Appearance, DEFAULT_APPEARANCE } from './appearance';
import { BodyModel } from './BodyModel';
import { GRIP_X, GRIP_Z, handGeometry } from './hand';
import { buildHeldModel, HELD, type HeldId } from './held';
import { outfitFrom } from './outfit';

/** Joint heights of the 176 cm figure (scaled by height). */
const HIP_Y = 0.92;
const SHOULDER_Y = 1.41;
const SHOULDER_X = 0.19;
const UPPER_ARM = 0.29;
const FOREARM = 0.25;
const UNDERSHIRT = 0x8a8a82;

// prettier-ignore
const TORSO: LoftRing[] = [
  { y: 0.1, rx: 0.158, rz: 0.106 }, { y: 0.22, rx: 0.164, rz: 0.11, oz: -0.006 },
  { y: 0.34, rx: 0.172, rz: 0.11 }, { y: 0.43, rx: 0.182, rz: 0.106, oz: 0.004 },
  { y: 0.49, rx: 0.186, rz: 0.1, oz: 0.01 }, { y: 0.53, rx: 0.15, rz: 0.085, oz: 0.012 },
  { y: 0.56, rx: 0.065, rz: 0.058, oz: 0.014 },
];
// prettier-ignore
const UPPER_RINGS: LoftRing[] = [
  { y: 0.02, rx: 0.05, rz: 0.05 }, { y: -0.06, rx: 0.052, rz: 0.05 },
  { y: -0.2, rx: 0.045, rz: 0.043 }, { y: -UPPER_ARM, rx: 0.039, rz: 0.037 },
];
// prettier-ignore
const FORE_RINGS: LoftRing[] = [
  { y: 0.02, rx: 0.041, rz: 0.039 }, { y: -0.08, rx: 0.044, rz: 0.041 }, { y: -FOREARM, rx: 0.031, rz: 0.027 },
];

const Y_DOWN = new Vector3(0, -1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _m = new Matrix4();

interface Arm {
  side: number;
  upper: Mesh;
  fore: Mesh;
  hand: Group;
  fist: Mesh;
}

/**
 * The survivor as a whole: the first-person legs and shoes (BodyModel) under a lofted torso, arms with
 * a two-bone IK so the hands grip what is held exactly as in first person, a head with face variants,
 * hair, beard and headwear. Used by the inventory figure and the character editor; ~3k triangles.
 */
export class CharacterFigure {
  readonly root = new Group();
  private readonly body = new BodyModel(0);
  private readonly geometries: BufferGeometry[] = [];
  private readonly torso: Mesh;
  private readonly arms: Arm[] = [];
  private readonly head = new Group();
  private readonly held = new Map<HeldId, Group>();
  private readonly hats = new Map<ItemId, Group>();
  private look: Appearance = { ...DEFAULT_APPEARANCE };
  private lookKey = '';
  private holding: ItemId | null = null;

  constructor() {
    this.body.update(0, 0, 0, 0, 0, 0, 0, 0);
    this.body.torsoVisible = false;
    this.root.add(this.body.root);
    this.torso = new Mesh(this.geo(ellipseLoft(TORSO, 12)));
    this.torso.position.y = HIP_Y;
    this.root.add(this.torso);

    const upperGeo = this.geo(ellipseLoft(UPPER_RINGS, 8));
    const foreGeo = this.geo(ellipseLoft(FORE_RINGS, 8));
    for (const side of [1, -1]) {
      const fist = new Mesh(this.geo(handGeometry(side)));
      const hand = new Group();
      hand.add(fist);
      const arm: Arm = { side, upper: new Mesh(upperGeo), fore: new Mesh(foreGeo), hand, fist };
      this.root.add(arm.upper, arm.fore, hand);
      this.arms.push(arm);
    }
    for (const id of Object.keys(HELD) as HeldId[]) {
      if (id === 'torch') continue;
      const g = buildHeldModel(id, this.geometries);
      g.visible = false;
      this.root.add(g);
      this.held.set(id, g);
    }
    this.root.add(this.head);
    this.buildHats();
    this.setAppearance(DEFAULT_APPEARANCE);
  }

  /** Rebuilds the head (face, hair, beard) and proportions only when they changed. */
  setAppearance(a: Appearance): void {
    this.look = { ...a };
    const key = JSON.stringify([a.face, a.hair, a.hairColor, a.beard, a.skin, a.build]);
    if (key !== this.lookKey) {
      this.lookKey = key;
      this.buildHead();
    }
    const w = a.build === 'slim' ? 0.9 : a.build === 'heavy' ? 1.14 : 1;
    this.torso.scale.set(w, 1, a.build === 'heavy' ? 1.2 : w);
    this.body.root.scale.set(a.build === 'heavy' ? 1.08 : a.build === 'slim' ? 0.94 : 1, 1, 1);
    const s = a.height / 176;
    this.root.scale.setScalar(s);
  }

  /** Clothes, shoes and what is in the hand; re-poses the arms. */
  setOutfit(worn: Worn, hand: ItemId | null, dirt?: Record<WearSlot, number>, tint?: Partial<Record<WearSlot, number>>): void {
    const o = outfitFrom(worn, this.look.skin, dirt, tint);
    this.body.setOutfit(o);
    const skin = characterMaterial('skin', this.look.skin);
    const top = characterMaterial('jacket', o.top ?? UNDERSHIRT, false, 0, o.top !== null ? o.dirt.torso : 0);
    this.torso.material = top;
    for (const arm of this.arms) {
      arm.upper.material = o.top !== null ? top : skin;
      arm.fore.material = o.sleeves !== null ? characterMaterial('jacket', o.sleeves, false, 0, o.dirt.torso) : skin;
      arm.fist.material = skin;
    }
    for (const [id, g] of this.hats) g.visible = worn.head === id;
    this.holding = hand;
    for (const [id, g] of this.held) g.visible = hand === id;
    this.pose();
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.body.dispose();
  }

  /** Arms: hanging, carrying a one-handed item, or holding a two-handed weapon across the body. */
  private pose(): void {
    const id = this.holding && this.holding in HELD ? (this.holding as HeldId) : null;
    const cfg = id ? HELD[id] : null;
    const R = this.arms[0];
    const L = this.arms[1];
    if (cfg?.twoHanded && id) {
      // Diagonally across the body (as in first person): butt at the left hip, head by the right
      // shoulder, edge out; the right hand up the handle, the left at its end.
      const axis = new Vector3(0.55, 0.8, -0.05).normalize();
      const butt = new Vector3(-0.2, 0.86, -0.24);
      const q = basis(axis, new Vector3(0.6, 0, -1));
      const g = this.held.get(id)!;
      g.position.copy(butt);
      g.quaternion.copy(q);
      this.gripArm(R, butt.clone().addScaledVector(axis, cfg.main.along), axis, new Vector3(0.7, -0.3, 0.5));
      this.gripArm(L, butt.clone().addScaledVector(axis, (cfg.off ?? cfg.main).along), axis, new Vector3(-0.7, -0.2, 0.5));
      return;
    }
    if (cfg && id) {
      // One-handed: carried in the right hand, pointing forward and down.
      const axis = new Vector3(0, -0.45, -1).normalize();
      const gripPoint = new Vector3(0.25, 0.84, -0.12);
      const g = this.held.get(id)!;
      g.quaternion.copy(basis(axis, new Vector3(0, -1, 0)));
      g.position.copy(gripPoint).addScaledVector(axis, -cfg.main.along);
      this.gripArm(R, gripPoint, axis, new Vector3(0.15, 1, 0.3));
    } else {
      this.gripArm(R, new Vector3(0.245, 0.8, 0.0), new Vector3(0, 0, -1), new Vector3(0.1, 1, 0.1));
    }
    this.gripArm(L, new Vector3(-0.245, 0.8, 0.0), new Vector3(0, 0, 1), new Vector3(-0.1, 1, 0.1));
  }

  /**
   * Place a fist on a grip point with its grip axis along `axis`, then bend the arm to reach it:
   * the hand is turned so the forearm runs towards `elbowSide`; the elbow comes from a two-bone IK.
   */
  private gripArm(arm: Arm, grip: Vector3, axis: Vector3, elbowSide: Vector3): void {
    const y = axis.clone().normalize();
    const z = elbowSide.clone().addScaledVector(y, -elbowSide.dot(y)).normalize();
    const x = new Vector3().crossVectors(y, z);
    const q = new Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
    const wrist = grip.clone().sub(new Vector3(GRIP_X * arm.side, 0, GRIP_Z).applyQuaternion(q));
    arm.hand.position.copy(wrist);
    arm.hand.quaternion.copy(q);
    // Two-bone IK: shoulder → elbow → wrist, the elbow bent away from the body.
    const shoulder = new Vector3(SHOULDER_X * arm.side, SHOULDER_Y, 0.01);
    const toWrist = _a.copy(wrist).sub(shoulder);
    const d = Math.min(toWrist.length(), UPPER_ARM + FOREARM - 1e-3);
    const dir = toWrist.normalize().clone();
    const along = (UPPER_ARM * UPPER_ARM - FOREARM * FOREARM + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, UPPER_ARM * UPPER_ARM - along * along));
    const pole = _b.set(arm.side * 0.6, -0.2, 0.7).addScaledVector(dir, -_b.set(arm.side * 0.6, -0.2, 0.7).dot(dir)).normalize();
    const elbow = shoulder.clone().addScaledVector(dir, along).addScaledVector(pole, h);
    orientLimb(arm.upper, shoulder, elbow);
    orientLimb(arm.fore, elbow, wrist);
  }

  private buildHead(): void {
    for (const c of [...this.head.children]) {
      this.head.remove(c);
      (c as Mesh).geometry?.dispose();
    }
    const a = this.look;
    const skin = characterMaterial('skin', a.skin);
    const hairMat = characterMaterial('jeans', a.hairColor);
    // Face variants: jaw width, chin, nose size, brow height.
    const v = [
      { jaw: 1, chin: 1, nose: 1, brow: 0 },
      { jaw: 1.12, chin: 1.15, nose: 1.15, brow: 0.004 },
      { jaw: 0.9, chin: 0.85, nose: 0.85, brow: -0.003 },
      { jaw: 1.05, chin: 0.95, nose: 1.3, brow: 0.006 },
    ][a.face % 4];
    const y0 = SHOULDER_Y + 0.23;
    // prettier-ignore
    const headRings: LoftRing[] = [
      { y: -0.13, rx: 0.04 * v.chin, rz: 0.045, oz: -0.012 }, { y: -0.1, rx: 0.062 * v.jaw, rz: 0.075, oz: -0.008 },
      { y: -0.05, rx: 0.078 * v.jaw, rz: 0.092 }, { y: 0.0, rx: 0.084, rz: 0.1 },
      { y: 0.05, rx: 0.085, rz: 0.1 }, { y: 0.095, rx: 0.074, rz: 0.088 },
      { y: 0.125, rx: 0.045, rz: 0.055 }, { y: 0.136, rx: 0.01, rz: 0.012 },
    ];
    const add = (g: BufferGeometry, m: Material, x = 0, y = 0, z = 0) => {
      const mesh = new Mesh(g, m);
      mesh.position.set(x, y0 + y, z);
      this.head.add(mesh);
      return mesh;
    };
    add(ellipseLoft(headRings, 12), skin);
    add(new CylinderGeometry(0.052, 0.058, 0.12, 8), skin, 0, -0.17, 0.005);
    // Features (front is −Z): brows, eyes, nose, mouth, ears.
    const dark = characterMaterial('cuff', 0x241c18);
    for (const s of [-1, 1]) {
      add(new BoxGeometry(0.03, 0.008, 0.01), hairMat, s * 0.032, 0.035 + v.brow, -0.096);
      add(new BoxGeometry(0.016, 0.01, 0.006), dark, s * 0.031, 0.018, -0.099);
      add(new BoxGeometry(0.012, 0.03, 0.02), skin, s * 0.086, 0.005, 0.005);
    }
    add(new BoxGeometry(0.02 * v.nose, 0.04 * v.nose, 0.03 * v.nose).translate(0, 0, -0.008), skin, 0, -0.012, -0.1);
    add(new BoxGeometry(0.034, 0.006, 0.006), dark, 0, -0.062, -0.093);
    // Beard: a jaw shell in hair color (stubble: thin and mixed with the skin).
    if (a.beard !== 'none') {
      const k = a.beard === 'full' ? 1.08 : 1.02;
      // prettier-ignore
      const beardRings: LoftRing[] = [
        { y: -0.145, rx: 0.045 * v.chin * k, rz: 0.05 * k, oz: -0.016 }, { y: -0.1, rx: 0.065 * v.jaw * k, rz: 0.08 * k, oz: -0.01 },
        { y: -0.05, rx: 0.08 * v.jaw * k, rz: 0.094 * k }, { y: -0.035, rx: 0.08 * v.jaw * k, rz: 0.094 * k },
      ];
      const color = a.beard === 'full' ? a.hairColor : mix(a.hairColor, a.skin, 0.55);
      add(ellipseLoft(beardRings, 12), characterMaterial('jeans', color));
    }
    // Hair styles.
    const cap = (scale: number, back = 0.012) =>
      // prettier-ignore
      ellipseLoft([
        { y: 0.035, rx: 0.088 * scale, rz: 0.103 * scale, oz: back }, { y: 0.09, rx: 0.08 * scale, rz: 0.095 * scale, oz: back * 0.6 },
        { y: 0.13, rx: 0.052 * scale, rz: 0.062 * scale }, { y: 0.145, rx: 0.012, rz: 0.014 },
      ], 12);
    switch (a.hair) {
      case 'short':
        add(cap(1.04), hairMat);
        break;
      case 'buzz':
        add(cap(1.012, 0.004), characterMaterial('jeans', mix(a.hairColor, a.skin, 0.4)));
        break;
      case 'curly':
        add(cap(1.14, 0.006), hairMat);
        break;
      case 'long':
        add(cap(1.05), hairMat);
        add(new BoxGeometry(0.17, 0.24, 0.05), hairMat, 0, -0.06, 0.085);
        break;
      case 'ponytail':
        add(cap(1.04), hairMat);
        add(new CylinderGeometry(0.022, 0.012, 0.16, 6).rotateX(0.35), hairMat, 0, -0.02, 0.12);
        break;
      case 'bald':
        break;
    }
  }

  /** Headwear placeholders sized to the head. */
  private buildHats(): void {
    const y = SHOULDER_Y + 0.23 + 0.04;
    const dome = this.geo(new SphereGeometry(0.105, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const make = (id: ItemId, parts: [BufferGeometry, number, number, number][], scale: [number, number, number]) => {
      const g = new Group();
      const m = characterMaterial('cuff', ITEMS[id].wear!.color);
      for (const [geo, px, py, pz] of parts) {
        const mesh = new Mesh(geo, m);
        mesh.position.set(px, py, pz);
        mesh.scale.set(...scale);
        g.add(mesh);
      }
      g.position.y = y;
      g.visible = false;
      this.root.add(g);
      this.hats.set(id, g);
    };
    const brim = this.geo(new BoxGeometry(0.16, 0.012, 0.1));
    const fold = this.geo(new CylinderGeometry(0.108, 0.108, 0.04, 12));
    const rim = this.geo(new CylinderGeometry(0.155, 0.155, 0.014, 14));
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      if (ITEMS[id].wear?.slot !== 'head') continue;
      if (id === 'cap' || id === 'policeCap') make(id, [[dome, 0, 0, 0], [brim, 0, 0.005, -0.12]], [1, 0.9, 1.05]);
      else if (id === 'beanie') make(id, [[dome, 0, 0, 0], [fold, 0, 0.01, 0]], [1.02, 1.25, 1.05]);
      else make(id, [[dome, 0, 0, 0], [rim, 0, 0.004, -0.01]], id === 'hardhat' || id === 'fireHelmet' ? [1.1, 1.08, 1.12] : [1.08, 1.12, 1.1]);
    }
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}

/** Lofted limbs hang along −Y from their origin: aim one from `from` to `to`. */
function orientLimb(mesh: Mesh, from: Vector3, to: Vector3): void {
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(Y_DOWN, to.clone().sub(from).normalize());
}

/** Rotation with +Y along `axis` and −Z leaning towards `edge` (held items' convention). */
function basis(axis: Vector3, edge: Vector3): Quaternion {
  const y = axis.clone().normalize();
  const f = edge.clone().addScaledVector(y, -edge.dot(y)).normalize();
  const z = f.negate();
  const x = new Vector3().crossVectors(y, z);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
