import type { Camera, PerspectiveCamera, Scene } from 'three';
import type { GameContext } from '../GameContext';

export interface IScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Optional second pass drawn on top after clearing depth (first-person arms). */
  readonly overlay?: { scene: Scene; camera: Camera };
  init(ctx: GameContext): void;
  /** Optional async preparation after init (e.g. first chunks); the loading screen stays up until it resolves. */
  load?(): Promise<void>;
  /** Fixed-rate simulation step. */
  fixedUpdate(dt: number): void;
  /** Per-frame visual update (interpolation, camera look). Drawing itself is done by the caller. */
  render(alpha: number, frameDt: number): void;
  dispose(): void;
}
