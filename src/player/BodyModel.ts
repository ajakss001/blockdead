import { Group, Mesh, type BufferGeometry, type Object3D } from 'three';
import { clamp } from '../core/math';
import { ellipseLoft } from '../render/lowpoly';
import { characterMaterial, VERTEX_COLORED } from '../render/look/materials';
import type { Outfit } from './outfit';
import { SPEED_SPRINT, SPEED_WALK } from './PlayerController';
import { buildShoeGeometry, type ShoeStyle } from './shoe';

const HIP_HEIGHT = 0.92;
/** Hip drop at full crouch; with the crouch leg angles below this keeps the shoes on the ground. */
const CROUCH_DROP = 0.37;
const THIGH = 0.45;
const SHIN = 0.44;
/** The body's center sits a little behind the eyes (the head is forward of the hips). */
const BACK_OFFSET = 0.1;
/** Relaxed stance: feet a touch ahead of the hips. */
const STANCE = 0.13;
/**
 * Ground under the sole, measured from the ankle (end of the shin). In the relaxed stance the
 * ankle is ~3 cm above the hip height minus the leg; the sole lands on the ground there.
 */
const SOLE_GROUND = -0.035;
/** Underwear on a bare pelvis, an undershirt on a bare chest. */
const BOXERS = 0x4e4e5a;
const UNDERSHIRT = 0x8a8a82;
/**
 * Faint glow of the clothes' own color: in the near-black night the legs read as jeans and skin,
 * not as black shapes (the arms get the same from the viewmodel's own lights).
 */
const SELF_LIT = 0.2;

// Shapes, as elliptical sections (y, half-width, half-depth, forward shift): hips and belly, a chest
// narrowing into the neck, thighs tapering to the knee, a knee bump, a calf bulging behind the shin.
// prettier-ignore
const PELVIS = [
  { y: -0.11, rx: 0.085, rz: 0.07 }, { y: -0.06, rx: 0.17, rz: 0.115 },
  { y: 0.04, rx: 0.172, rz: 0.115 }, { y: 0.13, rx: 0.16, rz: 0.108 },
];
// Only the belly: seen from the eyes the chest would be a wall right under the chin. Its top is a
// dome, so looking down shows a body curving away, never a cut edge.
// prettier-ignore
const TORSO = [
  { y: 0.12, rx: 0.156, rz: 0.098, oz: 0.008 }, { y: 0.2, rx: 0.16, rz: 0.098, oz: 0.008 },
  { y: 0.26, rx: 0.146, rz: 0.088, oz: 0.01 }, { y: 0.3, rx: 0.1, rz: 0.06, oz: 0.012 },
  { y: 0.315, rx: 0.035, rz: 0.025, oz: 0.012 },
];
// prettier-ignore
const THIGH_RINGS = [
  { y: 0.05, rx: 0.086, rz: 0.09 }, { y: -0.06, rx: 0.088, rz: 0.093 },
  { y: -0.2, rx: 0.078, rz: 0.082, oz: -0.005 }, { y: -0.36, rx: 0.064, rz: 0.066 },
  { y: -0.43, rx: 0.057, rz: 0.06, oz: -0.01 }, { y: -0.47, rx: 0.054, rz: 0.057 },
];
// prettier-ignore
const SHIN_RINGS = [
  { y: 0.02, rx: 0.056, rz: 0.06, oz: -0.012 }, { y: -0.05, rx: 0.058, rz: 0.064, oz: 0.004 },
  { y: -0.14, rx: 0.06, rz: 0.068, oz: 0.016 }, { y: -0.26, rx: 0.05, rz: 0.056, oz: 0.01 },
  { y: -0.38, rx: 0.042, rz: 0.045 }, { y: -0.44, rx: 0.04, rz: 0.042 },
];

/**
 * The player's own body as seen from first person: pelvis and torso (so the legs come out of a body,
 * not out of nowhere), legs with knees and calves, anatomical shoes — dressed in whatever is worn.
 * No head and no arms: arms live in the viewmodel pass. Legs are animated procedurally from the
 * controller's distance-driven step phase, so feet never slide.
 */
export class BodyModel {
  readonly root = new Group();
  private readonly hips = new Group();
  private readonly thighL = new Group();
  private readonly thighR = new Group();
  private readonly shinL = new Group();
  private readonly shinR = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly pelvis: Mesh;
  private readonly torso: Mesh;
  private readonly thighs: Mesh[] = [];
  private readonly shins: Mesh[] = [];
  private readonly shoes: Mesh[] = [];
  private shoeKey = '';

  /** `selfLit`: the first-person body glows faintly; the inventory figure has real lights instead. */
  constructor(private readonly selfLit = SELF_LIT) {
    this.hips.position.y = HIP_HEIGHT;
    this.root.add(this.hips);
    this.pelvis = new Mesh(this.geo(ellipseLoft(PELVIS, 12)));
    this.torso = new Mesh(this.geo(ellipseLoft(TORSO, 12)));
    this.hips.add(this.pelvis, this.torso);

    const thighGeo = this.geo(ellipseLoft(THIGH_RINGS, 10));
    const shinGeo = this.geo(ellipseLoft(SHIN_RINGS, 10));
    const shoeMat = characterMaterial('shoes', VERTEX_COLORED, true, this.selfLit);
    for (const [thigh, shin, side] of [
      [this.thighL, this.shinL, -1],
      [this.thighR, this.shinR, 1],
    ] as const) {
      thigh.position.x = side * 0.092;
      const t = new Mesh(thighGeo);
      const s = new Mesh(shinGeo);
      // Shoe geometry arrives with the first outfit; both feet share it.
      const shoe = new Mesh(undefined, shoeMat);
      shoe.position.y = -SHIN;
      thigh.add(t);
      shin.position.y = -THIGH;
      shin.add(s, shoe);
      thigh.add(shin);
      this.hips.add(thigh);
      this.thighs.push(t);
      this.shins.push(s);
      this.shoes.push(shoe);
    }
  }

  /** Trousers (or bare legs), top, shoe model. Same-type materials: no shader recompiles. */
  setOutfit(o: Outfit): void {
    const lit = this.selfLit;
    const pants = o.pants !== null ? characterMaterial('jeans', o.pants, false, lit, o.dirt.legs) : null;
    const skin = characterMaterial('skin', o.skin, false, lit);
    this.pelvis.material = pants ?? characterMaterial('cuff', BOXERS, false, lit, 0);
    this.torso.material = characterMaterial('jacket', o.top ?? UNDERSHIRT, false, lit, o.top !== null ? o.dirt.torso : 0);
    for (const m of this.shoes) m.material = characterMaterial('shoes', VERTEX_COLORED, true, lit, o.shoes.kind === 'barefoot' ? 0 : o.dirt.feet);
    for (const m of this.thighs) m.material = pants ?? skin;
    for (const m of this.shins) m.material = pants ?? skin;
    this.setShoes(o.shoes);
  }

  /** Hide the torso (the inventory figure builds its own upper body). */
  set torsoVisible(v: boolean) {
    this.torso.visible = v;
  }

  private setShoes(style: ShoeStyle): void {
    const key = JSON.stringify(style);
    if (key === this.shoeKey) return;
    this.shoeKey = key;
    const old = this.shoes[0].geometry;
    const g = buildShoeGeometry(style, SOLE_GROUND);
    for (const m of this.shoes) m.geometry = g;
    if (this.geometries.includes(old)) {
      this.geometries.splice(this.geometries.indexOf(old), 1);
      old.dispose();
    }
    this.geometries.push(g);
  }

  /**
   * @param stepPhase radians; 2π = left + right step
   * @param speed ground speed, m/s
   * @param crouchT 0 standing … 1 crouched
   * @param stance relaxed forward lean of the legs (0 = standing straight, for the inventory figure)
   */
  update(x: number, y: number, z: number, yaw: number, stepPhase: number, speed: number, crouchT: number, stance = STANCE): void {
    const back = stance === STANCE ? BACK_OFFSET : 0;
    this.root.position.set(x + Math.sin(yaw) * back, y, z + Math.cos(yaw) * back);
    this.root.rotation.y = yaw;

    const swing = 0.42 * clamp(speed / SPEED_WALK, 0, 1) + 0.25 * clamp((speed - SPEED_WALK) / (SPEED_SPRINT - SPEED_WALK), 0, 1);
    const knee = swing * 1.5;
    const p = stepPhase;
    // Positive X rotation swings a hanging limb forward (-Z); knees bend backward (negative).
    this.thighL.rotation.x = stance + Math.sin(p) * swing + crouchT * 1.15;
    this.shinL.rotation.x = -stance * 0.5 - Math.max(0, Math.sin(p + 1.3)) * knee - crouchT * 1.95;
    this.thighR.rotation.x = stance + Math.sin(p + Math.PI) * swing + crouchT * 1.15;
    this.shinR.rotation.x = -stance * 0.5 - Math.max(0, Math.sin(p + Math.PI + 1.3)) * knee - crouchT * 1.95;
    this.hips.position.y = HIP_HEIGHT - crouchT * CROUCH_DROP - Math.abs(Math.sin(p)) * 0.03 * (swing / 0.42);
  }

  /**
   * Legs set directly (a body lying down): per leg (left, right) the thigh's and the shin's rotation —
   * x forward-positive like the walk, z outward — applied about Z after X.
   */
  poseLegs(thigh: [number, number][], shin: [number, number][]): void {
    this.hips.position.y = HIP_HEIGHT;
    [this.thighL, this.thighR].forEach((t, k) => t.rotation.set(thigh[k][0], 0, thigh[k][1], 'ZYX'));
    [this.shinL, this.shinR].forEach((t, k) => t.rotation.set(shin[k][0], 0, shin[k][1], 'ZYX'));
  }

  /** The pieces a ragdoll moves: pelvis, thighs, shins with the shoes. */
  ragdollPieces(): { obj: Object3D; part: 'pelvis' | 'thigh' | 'shin' }[] {
    return [{ obj: this.pelvis, part: 'pelvis' }, ...this.thighs.map((obj) => ({ obj, part: 'thigh' as const })), { obj: this.shinL, part: 'shin' }, { obj: this.shinR, part: 'shin' }];
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}
