import { BoxGeometry, Group, Mesh, type BufferGeometry } from 'three';
import { clamp } from '../core/math';
import { limbDown } from '../render/lowpoly';
import { characterMaterial } from '../render/look/materials';
import { SPEED_SPRINT, SPEED_WALK } from './PlayerController';

const HIP_HEIGHT = 0.92;
/** Hip drop at full crouch; with the crouch leg angles below this keeps the shoes on the ground. */
const CROUCH_DROP = 0.37;
const THIGH = 0.45;
const SHIN = 0.44;
/**
 * Hips sit behind the eyes, so the shoes appear at the bottom of the screen when looking down.
 * There is deliberately no torso or pelvis: from the eyes they would only ever be seen as a
 * close-up block hiding the legs.
 */
const BACK_OFFSET = 0.18;
/** Relaxed stance: feet slightly ahead of the hips, so they are visible when looking down. */
const STANCE = 0.22;

export const BODY_COLORS = {
  jacket: 0x3d4a5c,
  jeans: 0x2f3b52,
  shoes: 0x4a3c30,
} as const;

/**
 * The player's own lower body as seen from first person: legs and shoes.
 * No head and no arms — arms live in the viewmodel pass. Legs are animated procedurally
 * from the controller's distance-driven step phase, so feet never slide.
 */
export class BodyModel {
  readonly root = new Group();
  private readonly hips = new Group();
  private readonly thighL = new Group();
  private readonly thighR = new Group();
  private readonly shinL = new Group();
  private readonly shinR = new Group();
  private readonly geometries: BufferGeometry[] = [];

  constructor() {
    const jeans = characterMaterial('jeans', BODY_COLORS.jeans);
    const shoes = characterMaterial('shoes', BODY_COLORS.shoes);

    this.hips.position.y = HIP_HEIGHT;
    this.root.add(this.hips);


    const thighGeo = this.geo(limbDown(0.085, 0.065, THIGH));
    const shinGeo = this.geo(limbDown(0.062, 0.048, SHIN));
    const shoeGeo = this.geo(new BoxGeometry(0.11, 0.075, 0.27));
    for (const [thigh, shin, side] of [
      [this.thighL, this.shinL, -1],
      [this.thighR, this.shinR, 1],
    ] as const) {
      thigh.position.x = side * 0.095;
      thigh.add(new Mesh(thighGeo, jeans));
      shin.position.y = -THIGH;
      shin.add(new Mesh(shinGeo, jeans));
      const shoe = new Mesh(shoeGeo, shoes);
      shoe.position.set(0, -SHIN - 0.035, -0.06);
      shin.add(shoe);
      thigh.add(shin);
      this.hips.add(thigh);
    }
  }

  /**
   * @param stepPhase radians; 2π = left + right step
   * @param speed ground speed, m/s
   * @param crouchT 0 standing … 1 crouched
   */
  update(x: number, y: number, z: number, yaw: number, stepPhase: number, speed: number, crouchT: number): void {
    this.root.position.set(x + Math.sin(yaw) * BACK_OFFSET, y, z + Math.cos(yaw) * BACK_OFFSET);
    this.root.rotation.y = yaw;

    const swing = 0.42 * clamp(speed / SPEED_WALK, 0, 1) + 0.25 * clamp((speed - SPEED_WALK) / (SPEED_SPRINT - SPEED_WALK), 0, 1);
    const knee = swing * 1.5;
    const p = stepPhase;
    // Positive X rotation swings a hanging limb forward (-Z); knees bend backward (negative).
    this.thighL.rotation.x = STANCE + Math.sin(p) * swing + crouchT * 1.1;
    this.shinL.rotation.x = -STANCE * 0.5 - Math.max(0, Math.sin(p + 1.3)) * knee - crouchT * 1.9;
    this.thighR.rotation.x = STANCE + Math.sin(p + Math.PI) * swing + crouchT * 1.1;
    this.shinR.rotation.x = -STANCE * 0.5 - Math.max(0, Math.sin(p + Math.PI + 1.3)) * knee - crouchT * 1.9;
    this.hips.position.y = HIP_HEIGHT - crouchT * CROUCH_DROP - Math.abs(Math.sin(p)) * 0.03 * (swing / 0.42);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

}
