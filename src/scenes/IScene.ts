import type { Camera, PerspectiveCamera, Scene } from 'three';
import type { GameContext } from '../GameContext';

export interface SaveSummary {
  hasSave: boolean;
  day: number;
  time: string;
  kills: number;
  health: number;
}

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
  /** Prewarm only: the headlights' shadow-casting program, compiled once at boot. */
  setHeadShadow?(on: boolean | null): void;
  /** Prewarm only: force the flashlight shadow state across quality levels at boot. */
  setFlashlightShadow?(on: boolean | null): void;
  /** Optional: a new game asks who the survivor is (character editor) before play starts. */
  createCharacter?(): Promise<void>;
  /** True when starting a new game needs a hard world/seed/session reset. */
  needsFreshReset?(): boolean;
  /** Wipe save, rotate seed, and reload into character creation for a clean session. */
  startFreshGame?(): Promise<void>;
  /** Retire / restart with a new character cleanly. */
  newCharacter?(): Promise<void>;
  /** Summary of current save state for Main Menu Continue / New Game flow. */
  saveSummary?(): SaveSummary;
  /** Persist current progress immediately (e.g. before returning to Main Menu). */
  saveNow?(): Promise<void>;
  /** Wipe current world save before starting a clean New Game. */
  resetSave?(): Promise<void>;
  /** Fixed-rate simulation step. */
  fixedUpdate(dt: number): void;
  /**
   * Per-frame visual update (interpolation, camera look). Drawing itself is done by the caller. gameDt: the
   * world's time this frame (0 while paused, GameLoop) — what belongs to the world moves by it.
   */
  render(alpha: number, frameDt: number, gameDt: number): void;
  dispose(): void;
}
