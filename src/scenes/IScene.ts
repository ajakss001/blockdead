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
  /**
   * Optional: make every material, shadow and pass appear in the next frames so their shaders
   * compile behind the loading screen. Returns a cleanup to call afterwards.
   */
  prewarm?(): () => void;
  /** Optional: a new game asks who the survivor is (character editor) before play starts. */
  createCharacter?(): Promise<void>;
  /** Fixed-rate simulation step. */
  fixedUpdate(dt: number): void;
  /**
   * Per-frame visual update (interpolation, camera look). Drawing itself is done by the caller. gameDt: the
   * world's time this frame (0 while paused, GameLoop) — what belongs to the world moves by it.
   */
  render(alpha: number, frameDt: number, gameDt: number): void;
  dispose(): void;
}
