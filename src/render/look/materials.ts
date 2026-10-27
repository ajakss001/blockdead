import { type ColorRepresentation, MeshStandardMaterial, type Texture } from 'three';
import { generateBumpTexture, generateGrungeTexture, type GrungeKind } from './grunge';
export type { Surface } from './surfaces';
export { SURFACES } from './surfaces';

let anisotropy = 1;
const textures: Texture[] = [];
const charCache = new Map<string, MeshStandardMaterial>();

/** Call once with renderer.capabilities.getMaxAnisotropy() (character and item textures). */
export function setMaterialAnisotropy(value: number): void {
  anisotropy = Math.min(4, value);
}

function track<T extends Texture>(t: T): T {
  t.anisotropy = anisotropy;
  textures.push(t);
  return t;
}

export type CharacterPart = 'jacket' | 'jeans' | 'shoes' | 'skin' | 'cuff' | 'handle' | 'torch';

/** Light grime base for parts colored per vertex (shoes: upper, sole, laces in one draw call). */
export const VERTEX_COLORED = 0xd6d6d6;

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
export function characterMaterial(part: CharacterPart, color: ColorRepresentation, vertexColors = false): MeshStandardMaterial {
  const key = `${part}:${String(color)}:${vertexColors}`;
  const cached = charCache.get(key);
  if (cached) return cached;
  const spec = CHAR_KIND[part];
  const mat = new MeshStandardMaterial({
    map: track(generateGrungeTexture(color, spec.noise ?? 0.4, { kind: spec.kind, seed: charCache.size * 31 + 5, blood: spec.blood, size: 64 })),
    roughness: spec.roughness,
    metalness: spec.metalness,
    vertexColors,
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
  for (const m of charCache.values()) m.dispose();
  for (const t of textures) t.dispose();
  charCache.clear();
  textures.length = 0;
}
