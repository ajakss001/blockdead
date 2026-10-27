import type { QualityLevel } from '../core/types';

export interface QualityPreset {
  level: QualityLevel;
  /** World streaming radius in chunks (16 m each) — consumed by ChunkManager in stage 2. */
  chunkRadius: number;
  /** Dynamic-resolution range, multiplied on top of the capped devicePixelRatio. */
  resolutionScaleMin: number;
  resolutionScaleMax: number;
  maxPixelRatio: number;
  zombiesActive: number;
  zombiesVisible: number;
  farAiHz: number;
  shadowMaps: boolean;
  /** MSAA is fixed at context creation; changing preset at runtime does not toggle it. */
  antialias: boolean;
  /** Fog end distance, m. Hides the streaming edge. */
  fogFar: number;
}

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high'];

export const QUALITY_PRESETS: Readonly<Record<QualityLevel, QualityPreset>> = {
  low: {
    level: 'low',
    chunkRadius: 3,
    resolutionScaleMin: 0.6,
    resolutionScaleMax: 0.85,
    maxPixelRatio: 1,
    zombiesActive: 20,
    zombiesVisible: 30,
    farAiHz: 4,
    shadowMaps: false,
    antialias: false,
    fogFar: 50,
  },
  medium: {
    level: 'medium',
    chunkRadius: 4,
    resolutionScaleMin: 0.7,
    resolutionScaleMax: 1,
    maxPixelRatio: 1.5,
    zombiesActive: 35,
    zombiesVisible: 50,
    farAiHz: 6,
    shadowMaps: false,
    antialias: false,
    fogFar: 66,
  },
  high: {
    level: 'high',
    chunkRadius: 7,
    resolutionScaleMin: 0.85,
    resolutionScaleMax: 1,
    maxPixelRatio: 2,
    zombiesActive: 60,
    zombiesVisible: 100,
    farAiHz: 10,
    shadowMaps: true,
    antialias: true,
    fogFar: 115,
  },
};
