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
  | 'windowGlass'
  | 'carPaint'
  | 'busPaint'
  | 'rubber'
  | 'carGlass'
  | 'trim'
  | 'lamp'
  | 'facadeConcrete'
  | 'facadeBrick'
  | 'facadeOffice'
  | 'concrete'
  | 'tile'
  | 'decalSoot'
  | 'decalOil'
  | 'decalSkid'
  | 'decalBullets'
  | 'decalShards'
  | 'decalLitter'
  | 'decalNoFuel'
  | 'decalCancelled'
  | 'decalBiohazard'
  | 'decalSheen'
  | 'decalFoam'
  | 'decalEvacuate'
  | 'decalShadow';

/** Alpha-cut overlays drawn on top of other surfaces. */
export type DecalKind = 'soot' | 'oil' | 'skid' | 'bullets' | 'shards' | 'litter' | 'noFuel' | 'cancelled' | 'biohazard' | 'sheen' | 'foam' | 'evacuate' | 'shadow';

export interface SurfaceSpec {
  kind: GrungeKind;
  /** Light neutral base: the albedo comes from vertex colors, the map adds dirt and detail. */
  detail: number;
  noise: number;
  roughness: number;
  metalness: number;
  /** Meters covered by one texture tile (world-aligned UVs). */
  tile: number;
  /** Vertical tile size on walls, if different (facades: two storeys per tile). */
  tileV?: number;
  /** Decals keep their own 0..1 UVs and are alpha-blended with the glass. */
  decal?: DecalKind;
  bump?: number;
  /** Translucent surface: texture alpha multiplier (car glass, window panes). */
  alpha?: number;
  castShadow: boolean;
}

export const SURFACES: Readonly<Record<Surface, SurfaceSpec>> = {
  ground: { kind: 'ground', detail: 0xd6d6cc, noise: 0.55, roughness: 1, metalness: 0, tile: 4, castShadow: false },
  asphalt: { kind: 'asphalt', detail: 0xd0d0cc, noise: 0.5, roughness: 0.95, metalness: 0, tile: 3, castShadow: false },
  plaster: { kind: 'plaster', detail: 0xd8d3c8, noise: 0.16, roughness: 0.9, metalness: 0.04, tile: 2, bump: 0.5, castShadow: true },
  roof: { kind: 'wood', detail: 0xc8c4bc, noise: 0.5, roughness: 0.95, metalness: 0, tile: 1.2, castShadow: true },
  wood: { kind: 'wood', detail: 0xdad2c4, noise: 0.4, roughness: 0.88, metalness: 0, tile: 1, castShadow: true },
  metal: { kind: 'metal', detail: 0xd4d0cc, noise: 0.3, roughness: 0.7, metalness: 0.35, tile: 1.5, castShadow: true },
  foliage: { kind: 'foliage', detail: 0xd0d8c8, noise: 0.6, roughness: 1, metalness: 0, tile: 2, castShadow: true },
  // Dirty glass keeps some gloss: the flashlight leaves a cold highlight in dark windows.
  glass: { kind: 'grime', detail: 0xbfc4c8, noise: 0.3, roughness: 0.3, metalness: 0.1, tile: 1, castShadow: false },
  // Abandoned cars. Paint: matte, faded, rust blooms and drips; mud/dust come from vertex tints.
  carPaint: { kind: 'carpaint', detail: 0xdad6ce, noise: 0.3, roughness: 0.78, metalness: 0.25, tile: 1.2, bump: 0.4, castShadow: true },
  // Buses: clean-ish painted panels (no rust blooms that could read as stains on a big surface).
  busPaint: { kind: 'paint', detail: 0xd8d4cc, noise: 0.22, roughness: 0.7, metalness: 0.2, tile: 2.5, castShadow: true },
  // Intact windows and shop glass: clear and lightly tinted, a cold sheen from the flashlight.
  windowGlass: { kind: 'glass', detail: 0x6f808c, noise: 0.08, roughness: 0.05, metalness: 0.55, tile: 3, alpha: 0.24, castShadow: false },
  rubber: { kind: 'grime', detail: 0x9c9a96, noise: 0.5, roughness: 1, metalness: 0, tile: 0.6, castShadow: true },
  // Murky, dusty, cracked; tile is large so a pane shows one crack, not a repeating pattern.
  carGlass: { kind: 'glass', detail: 0xc4c8cc, noise: 0.35, roughness: 0.9, metalness: 0.1, tile: 2.2, alpha: 0.82, castShadow: false },
  // Old chrome and plastic: bumpers, hubcaps, grille.
  trim: { kind: 'metal', detail: 0xd2cec8, noise: 0.35, roughness: 0.5, metalness: 0.55, tile: 0.8, castShadow: true },
  lamp: { kind: 'grime', detail: 0xd8d8d4, noise: 0.25, roughness: 0.35, metalness: 0, tile: 0.4, castShadow: false },
  // High-rise facades: one tile = 2 window bays (3 m each) × 2 storeys (3.2 m each); buildings snap to that grid.
  facadeConcrete: { kind: 'facadeConcrete', detail: 0xc8c6c0, noise: 0.3, roughness: 0.9, metalness: 0.05, tile: 6, tileV: 6.4, castShadow: true },
  facadeBrick: { kind: 'facadeBrick', detail: 0xc0a898, noise: 0.3, roughness: 0.92, metalness: 0, tile: 6, tileV: 6.4, castShadow: true },
  facadeOffice: { kind: 'facadeOffice', detail: 0xb8c0c4, noise: 0.2, roughness: 0.5, metalness: 0.3, tile: 6, tileV: 6.4, castShadow: true },
  concrete: { kind: 'concrete', detail: 0xc4c2bc, noise: 0.4, roughness: 0.95, metalness: 0, tile: 2.5, castShadow: true },
  tile: { kind: 'tile', detail: 0xccc8bc, noise: 0.3, roughness: 0.7, metalness: 0, tile: 1.2, castShadow: false },
  decalSoot: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 1, metalness: 0, tile: 1, decal: 'soot', castShadow: false },
  decalOil: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.3, metalness: 0.1, tile: 1, decal: 'oil', castShadow: false },
  decalSkid: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.9, metalness: 0, tile: 1, decal: 'skid', castShadow: false },
  decalBullets: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.9, metalness: 0, tile: 1, decal: 'bullets', castShadow: false },
  decalShards: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.25, metalness: 0.2, tile: 1, decal: 'shards', castShadow: false },
  decalLitter: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.95, metalness: 0, tile: 1, decal: 'litter', castShadow: false },
  // Scenario decals: hand-written signs, a departures board, hazard tape, fuel on the ground, foam.
  decalNoFuel: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.95, metalness: 0, tile: 1, decal: 'noFuel', castShadow: false },
  decalCancelled: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.4, metalness: 0, tile: 1, decal: 'cancelled', castShadow: false },
  decalBiohazard: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.6, metalness: 0, tile: 1, decal: 'biohazard', castShadow: false },
  decalSheen: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.15, metalness: 0.3, tile: 1, decal: 'sheen', castShadow: false },
  decalFoam: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 1, metalness: 0, tile: 1, decal: 'foam', castShadow: false },
  decalEvacuate: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 0.95, metalness: 0, tile: 1, decal: 'evacuate', castShadow: false },
  decalShadow: { kind: 'grime', detail: 0xffffff, noise: 0, roughness: 1, metalness: 0, tile: 1, decal: 'shadow', castShadow: false },
};

export const SURFACE_LIST = Object.keys(SURFACES) as Surface[];

/**
 * Window openings painted into the facade textures: one tile = 2 bays (3 m) × 2 storeys (3.2 m),
 * a window centered in each bay. Offsets in meters from the bay's start / the storey's floor.
 * The interior generator puts real panes exactly there.
 */
export const FACADE_WINDOW = {
  apartments: { inset: (11 / 64) * 3, width: (42 / 64) * 3, sill: (16 / 64) * 3.2, head: (52 / 64) * 3.2 },
  offices: { inset: (3 / 64) * 3, width: (58 / 64) * 3, sill: (7 / 64) * 3.2, head: (59 / 64) * 3.2 },
} as const;
export const FACADE_BAY = 3;

/**
 * Draw buckets: every chunk becomes at most four meshes regardless of how many surfaces it uses.
 * 'cast' = opaque shadow casters, 'flat' = opaque receivers only (ground, roads, glass, lamps),
 * 'glass' = everything alpha-blended: car and window glass, and the decals (soot, oil, skid marks,
 * litter, bullet holes) — they lie 2–3 cm above their surface, so they need no depth offset of their own.
 */
export type Bucket = 'cast' | 'flat' | 'glass';
export const BUCKETS: readonly Bucket[] = ['cast', 'flat', 'glass'];

export function bucketOf(surface: Surface): Bucket {
  const s = SURFACES[surface];
  if (s.decal || s.alpha !== undefined) return 'glass';
  return s.castShadow ? 'cast' : 'flat';
}

/** World-mesh vertices with aLayer ≥ this sample the model atlas (layer − base) instead of a surface. */
export const MODEL_LAYER_BASE = 64;

/** Layer of the surface in the world texture array. */
export const surfaceLayer = (surface: Surface): number => SURFACE_LIST.indexOf(surface);
