import type { GrungeKind } from './grunge';

/*
 * Pure data (no DOM, no GPU objects): imported by the chunk worker as well as the main thread.
 */

/** World surface categories. StaticBatch makes one mesh (one draw call) per surface. */
export type Surface =
  | 'ground'
  | 'asphalt'
  | 'plaster'
  | 'roof'
  | 'wood'
  | 'metal'
  | 'foliage'
  | 'glass'
  | 'carPaint'
  | 'rubber'
  | 'carGlass'
  | 'trim'
  | 'lamp';

export interface SurfaceSpec {
  kind: GrungeKind;
  /** Light neutral base: the albedo comes from vertex colors, the map adds dirt and detail. */
  detail: number;
  noise: number;
  roughness: number;
  metalness: number;
  /** Meters covered by one texture tile (world-aligned UVs). */
  tile: number;
  blood?: number;
  bump?: number;
  /** < 1 makes the surface translucent (car glass). */
  opacity?: number;
  castShadow: boolean;
}

export const SURFACES: Readonly<Record<Surface, SurfaceSpec>> = {
  ground: { kind: 'ground', detail: 0xd6d6cc, noise: 0.55, roughness: 1, metalness: 0, tile: 4, castShadow: false },
  asphalt: { kind: 'asphalt', detail: 0xd0d0cc, noise: 0.5, roughness: 0.95, metalness: 0, tile: 3, castShadow: false },
  plaster: { kind: 'plaster', detail: 0xdcd8cf, noise: 0.35, roughness: 0.92, metalness: 0.05, tile: 2, bump: 0.6, castShadow: true },
  roof: { kind: 'wood', detail: 0xc8c4bc, noise: 0.5, roughness: 0.95, metalness: 0, tile: 1.2, castShadow: true },
  wood: { kind: 'wood', detail: 0xdad2c4, noise: 0.4, roughness: 0.88, metalness: 0, tile: 1, castShadow: true },
  metal: { kind: 'metal', detail: 0xd4d0cc, noise: 0.3, roughness: 0.7, metalness: 0.35, tile: 1.5, castShadow: true },
  foliage: { kind: 'foliage', detail: 0xd0d8c8, noise: 0.6, roughness: 1, metalness: 0, tile: 2, castShadow: true },
  // Dirty glass keeps some gloss: the flashlight leaves a cold highlight in dark windows.
  glass: { kind: 'grime', detail: 0xbfc4c8, noise: 0.3, roughness: 0.3, metalness: 0.1, tile: 1, castShadow: false },
  // Abandoned cars. Paint: matte, faded, rust blooms and drips; mud/dust come from vertex tints.
  carPaint: { kind: 'carpaint', detail: 0xdad6ce, noise: 0.3, roughness: 0.78, metalness: 0.25, tile: 1.2, bump: 0.4, castShadow: true },
  rubber: { kind: 'grime', detail: 0x9c9a96, noise: 0.5, roughness: 1, metalness: 0, tile: 0.6, castShadow: true },
  // Murky, dusty, cracked; tile is large so a pane shows one crack, not a repeating pattern.
  carGlass: { kind: 'glass', detail: 0xc4c8cc, noise: 0.35, roughness: 0.9, metalness: 0.1, tile: 2.2, opacity: 0.82, castShadow: false },
  // Old chrome and plastic: bumpers, hubcaps, grille.
  trim: { kind: 'metal', detail: 0xd2cec8, noise: 0.35, roughness: 0.5, metalness: 0.55, tile: 0.8, castShadow: true },
  lamp: { kind: 'grime', detail: 0xd8d8d4, noise: 0.25, roughness: 0.35, metalness: 0, tile: 0.4, castShadow: false },
};

export const SURFACE_LIST = Object.keys(SURFACES) as Surface[];

/**
 * Draw buckets: every chunk becomes at most three meshes regardless of how many surfaces it uses.
 * 'cast' = opaque shadow casters, 'flat' = opaque receivers only (ground, roads, glass, lamps),
 * 'glass' = translucent car windows.
 */
export type Bucket = 'cast' | 'flat' | 'glass';
export const BUCKETS: readonly Bucket[] = ['cast', 'flat', 'glass'];

export function bucketOf(surface: Surface): Bucket {
  const s = SURFACES[surface];
  if (s.opacity !== undefined) return 'glass';
  return s.castShadow ? 'cast' : 'flat';
}

/** Layer of the surface in the world texture array. */
export const surfaceLayer = (surface: Surface): number => SURFACE_LIST.indexOf(surface);
