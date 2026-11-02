import { type ColorRepresentation, FogExp2 } from 'three';

/**
 * The world's fog (CLAUDE.md «Визуальный стиль»): exponential-squared — near things clear, the distance
 * dissolving into grey — but still steered by `far` like a linear fog: everything that keys off it (the
 * draw distance of the zombies, the landmarks and far smoke on the horizon, the linear fog of the custom
 * shaders — particles, wet decals, lit windows) keeps working. `far` is where it is ~97% thick:
 * density = FAR_K / far, ≈ 0.037 at the low preset's 50 m.
 */
export const FAR_K = 1.85;

export class GrimFog extends FogExp2 {
  /** Kept for the linear-fog shaders (their fog starts here). */
  near: number;
  private farM = 50;

  constructor(color: ColorRepresentation, near: number, far: number) {
    super(color, FAR_K / far);
    this.near = near;
    this.far = far;
  }

  get far(): number {
    return this.farM;
  }

  set far(v: number) {
    this.farM = v;
    this.density = FAR_K / Math.max(1, v);
  }

  override clone(): this {
    return new GrimFog(this.color, this.near, this.farM) as this;
  }
}
