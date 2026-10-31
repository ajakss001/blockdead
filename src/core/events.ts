import type { AdKind, AdResult, PauseReason, QualityLevel } from './types';

/**
 * Global event map. Events here are rare (UI, platform, settings).
 * Anything emitted every frame must reuse a preallocated payload object.
 */
export interface GameEvents {
  'viewport:resize': { width: number; height: number };
  'quality:changed': { level: QualityLevel; resolutionScale: number; source: 'init' | 'auto' | 'user' };
  'loop:pause': { reason: PauseReason };
  'loop:resume': { reason: PauseReason };
  'ad:start': { kind: AdKind };
  'ad:end': { kind: AdKind; result: AdResult };
  'gl:contextlost': Record<string, never>;
  'gl:contextrestored': Record<string, never>;
  'input:active': { active: boolean };
  /** A full-screen UI (inventory) took over input; on PC the pointer lock is released for it. */
  'ui:modal': { open: boolean };
  /** A game action that holds the mouse (a search): losing the lock now is not "leave the game". */
  'ui:busy': { busy: boolean };
  'debug:stress': { instances: number; meshes: number };
  /** The crosshair is (not) on something to use: a container's search zone or a door (touch shows its button). */
  'ui:target': { target: boolean };
}
