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
  'debug:stress': { instances: number; meshes: number };
}
