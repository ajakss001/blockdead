import type { PerspectiveCamera, Scene } from 'three';
import type { GameContext } from '../GameContext';

export interface IScene {
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  init(ctx: GameContext): void;
  /** Fixed-rate simulation step. */
  fixedUpdate(dt: number): void;
  /** Per-frame visual update (interpolation, camera look). Drawing itself is done by the caller. */
  render(alpha: number, frameDt: number): void;
  dispose(): void;
}
