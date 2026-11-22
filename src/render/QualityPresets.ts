import type { QualityLevel } from '../core/types';
import type { LightingModel } from './look/worldMaterials';

export interface QualityPreset {
  level: QualityLevel;
  /** World streaming radius in chunks (64 m blocks): 1 → 3×3 blocks around the player. */
  chunkRadius: number;
  /** Dynamic-resolution range, multiplied on top of the capped devicePixelRatio. */
  resolutionScaleMin: number;
  resolutionScaleMax: number;
  maxPixelRatio: number;
  zombiesActive: number;
  zombiesVisible: number;
  farAiHz: number;
  /** Flashlight shadow map size; 0 disables shadows. */
  shadowMapSize: number;
  /** MSAA samples of the post-processing target (fixed at boot). */
  msaa: number;
  /** Shadow reach of the flashlight, m: fewer casters in the shadow pass on weak GPUs. */
  shadowDistance: number;
  /** World lighting model (fixed at boot): Lambert is far cheaper per pixel on weak phones. */
  lighting: LightingModel;
  /** Fog end distance, m. Hides the streaming edge. */
  fogFar: number;
  /** High-rise interiors kept loaded at once (each: ~5 draw calls, 13–20k triangles, see-through windows). */
  interiors: number;
  /** Curtains blowing out of windows and paper in the street (one draw call); off on weak phones. */
  lifeCloth: boolean;
  /** Real point lights for lit rooms nearby (0: the warm glow alone fakes them). */
  roomLights: number;
  /** Real lights for the nearest fires (the rest only glow). */
  fireLights: number;
  /**
   * Grass, weeds, ivy and fallen leaves (one draw call): drawn within `radius` m of the player, one roll per
   * `cell` m, at most `cap` quads. Beyond — the ground's own tone.
   */
  foliage: { radius: number; cell: number; cap: number };
  /**
   * Trees and bushes: full crowns nearer than `near` m, fewer cards to `mid`, impostors beyond; the share of
   * cards kept; variants per species.
   */
  vegetation: { near: number; mid: number; fullKeep: number; midKeep: number; variants: number };
}

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    level: 'low',
    foliage: { radius: 10, cell: 1.15, cap: 750 },
    vegetation: { near: 10, mid: 24, fullKeep: 0.7, midKeep: 0.45, variants: 1 },
    chunkRadius: 1,
    resolutionScaleMin: 0.55,
    resolutionScaleMax: 0.75,
    maxPixelRatio: 1,
    zombiesActive: 14,
    zombiesVisible: 22,
    farAiHz: 3,
    shadowMapSize: 0,
    msaa: 0,
    shadowDistance: 0,
    lighting: 'lambert',
    fogFar: 42,
    interiors: 2,
    lifeCloth: false,
    roomLights: 0,
    fireLights: 1,
  },
  medium: {
    level: 'medium',
    foliage: { radius: 20, cell: 0.75, cap: 3600 },
    vegetation: { near: 18, mid: 45, fullKeep: 0.95, midKeep: 0.6, variants: 2 },
    chunkRadius: 1,
    resolutionScaleMin: 0.7,
    resolutionScaleMax: 1,
    maxPixelRatio: 1.5,
    zombiesActive: 35,
    zombiesVisible: 50,
    farAiHz: 6,
    shadowMapSize: 1024,
    msaa: 0,
    shadowDistance: 22,
    lighting: 'standard',
    fogFar: 66,
    interiors: 4,
    lifeCloth: true,
    roomLights: 1,
    fireLights: 3,
  },
  high: {
    level: 'high',
    foliage: { radius: 30, cell: 0.6, cap: 7000 },
    vegetation: { near: 26, mid: 70, fullKeep: 1, midKeep: 0.65, variants: 4 },
    chunkRadius: 2,
    resolutionScaleMin: 0.85,
    resolutionScaleMax: 1,
    maxPixelRatio: 2,
    zombiesActive: 60,
    zombiesVisible: 100,
    farAiHz: 10,
    shadowMapSize: 2048,
    msaa: 4,
    shadowDistance: 32,
    lighting: 'standard',
    fogFar: 115,
    interiors: 6,
    lifeCloth: true,
    roomLights: 2,
    fireLights: 4,
  },
};
