import { type ColorRepresentation, MeshStandardMaterial, type Texture } from 'three';
import { generateBumpTexture, generateGrungeTexture, type GrungeKind } from './grunge';

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

interface SurfaceSpec {
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
  asphalt: { kind: 'asphalt', detail: 0xd0d0cc, noise: 0.5, roughness: 0.95, metalness: 0, tile: 3, blood: 1, castShadow: false },
  plaster: { kind: 'plaster', detail: 0xdcd8cf, noise: 0.35, roughness: 0.92, metalness: 0.05, tile: 2, blood: 1, bump: 0.6, castShadow: true },
  roof: { kind: 'wood', detail: 0xc8c4bc, noise: 0.5, roughness: 0.95, metalness: 0, tile: 1.2, castShadow: true },
  wood: { kind: 'wood', detail: 0xdad2c4, noise: 0.4, roughness: 0.88, metalness: 0, tile: 1, blood: 1, castShadow: true },
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

let anisotropy = 1;
const textures: Texture[] = [];
const surfaceCache = new Map<Surface, MeshStandardMaterial>();
const charCache = new Map<string, MeshStandardMaterial>();

/** Call once with renderer.capabilities.getMaxAnisotropy() — sharper ground/road at grazing angles. */
export function setMaterialAnisotropy(value: number): void {
  anisotropy = Math.min(4, value);
}

function track<T extends Texture>(t: T): T {
  t.anisotropy = anisotropy;
  textures.push(t);
  return t;
}

/** Matte world material for a surface: vertex color × grunge map, roughness 0.9-ish, no plastic sheen. */
export function surfaceMaterial(surface: Surface): MeshStandardMaterial {
  const cached = surfaceCache.get(surface);
  if (cached) return cached;
  const s = SURFACES[surface];
  const seed = Object.keys(SURFACES).indexOf(surface) * 101 + 13;
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    map: track(generateGrungeTexture(s.detail, s.noise, { kind: s.kind, seed, blood: s.blood })),
    roughness: s.roughness,
    metalness: s.metalness,
  });
  if (s.bump) {
    mat.bumpMap = track(generateBumpTexture({ seed: seed + 1 }));
    mat.bumpScale = s.bump;
  }
  if (s.opacity !== undefined) {
    mat.transparent = true;
    mat.opacity = s.opacity;
    // Panes overlap each other and the interior; skipping depth writes avoids sorting holes.
    mat.depthWrite = false;
  }
  surfaceCache.set(surface, mat);
  return mat;
}

export type CharacterPart = 'jacket' | 'jeans' | 'shoes' | 'skin' | 'cuff' | 'handle' | 'torch';

const CHAR_KIND: Record<CharacterPart, { kind: GrungeKind; blood?: number; noise?: number; roughness: number; metalness: number }> = {
  jacket: { kind: 'fabric', blood: 1, roughness: 0.95, metalness: 0 },
  jeans: { kind: 'fabric', roughness: 0.95, metalness: 0 },
  shoes: { kind: 'grime', roughness: 0.85, metalness: 0 },
  skin: { kind: 'skin', blood: 1, noise: 0.18, roughness: 0.75, metalness: 0 },
  cuff: { kind: 'fabric', roughness: 0.95, metalness: 0 },
  handle: { kind: 'wood', roughness: 0.8, metalness: 0 },
  torch: { kind: 'metal', roughness: 0.55, metalness: 0.6 },
};

/** Grungy material for the player's own body, hands and held items. */
export function characterMaterial(part: CharacterPart, color: ColorRepresentation): MeshStandardMaterial {
  const key = `${part}:${String(color)}`;
  const cached = charCache.get(key);
  if (cached) return cached;
  const spec = CHAR_KIND[part];
  const mat = new MeshStandardMaterial({
    map: track(generateGrungeTexture(color, spec.noise ?? 0.4, { kind: spec.kind, seed: charCache.size * 31 + 5, blood: spec.blood, size: 64 })),
    roughness: spec.roughness,
    metalness: spec.metalness,
  });
  charCache.set(key, mat);
  return mat;
}

/** Dark, worn kitchen-knife steel: rust blooms, scratches, dried blood and bumped notches on the edge. */
export function bladeMaterial(): MeshStandardMaterial {
  const cached = charCache.get('blade');
  if (cached) return cached;
  const mat = new MeshStandardMaterial({
    map: track(generateGrungeTexture(0x6f7376, 0.45, { kind: 'rust', seed: 404, blood: 2, size: 64 })),
    bumpMap: track(generateBumpTexture({ seed: 405, notches: 6, size: 64 })),
    bumpScale: 1.5,
    roughness: 0.4,
    metalness: 0.8,
  });
  charCache.set('blade', mat);
  return mat;
}

export function disposeLookMaterials(): void {
  for (const m of surfaceCache.values()) m.dispose();
  for (const m of charCache.values()) m.dispose();
  for (const t of textures) t.dispose();
  surfaceCache.clear();
  charCache.clear();
  textures.length = 0;
}
