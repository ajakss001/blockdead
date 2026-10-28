import { Color, type ColorRepresentation, MeshStandardMaterial, type Texture } from 'three';
import { generateBumpTexture, generateGrungeTexture, type GrungeKind } from './grunge';
export type { Surface } from './surfaces';
export { SURFACES } from './surfaces';

let anisotropy = 1;
const textures: Texture[] = [];
const charCache = new Map<string, MeshStandardMaterial>();
/** Visible dirt levels of clothing (0, 25, 50, 75, 100 %). */
const DIRT_STEPS = 5;
/** What clothes get dirty with: dried mud and street grime. */
const MUD = new Color(0x4a3e30);

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

const CHAR_KIND: Record<CharacterPart, { kind: GrungeKind; noise?: number; grime?: number; roughness: number; metalness: number }> = {
  jacket: { kind: 'fabric', roughness: 0.95, metalness: 0 },
  jeans: { kind: 'fabric', roughness: 0.95, metalness: 0 },
  shoes: { kind: 'grime', roughness: 0.85, metalness: 0 },
  skin: { kind: 'skin', noise: 0.1, grime: 0.3, roughness: 0.75, metalness: 0 },
  cuff: { kind: 'fabric', roughness: 0.95, metalness: 0 },
  handle: { kind: 'wood', roughness: 0.8, metalness: 0 },
  torch: { kind: 'metal', roughness: 0.55, metalness: 0.6 },
};

/**
 * Grungy material for the player's own body, hands and held items.
 * `selfLit` (0..1): a faint glow of the material's own color — the player's legs stay readable as
 * cloth and skin in the near-black night instead of turning into black shapes.
 * `dirt` (0..1, clothing): clean cloth at 0, grime and a mud tint growing in 5 steps (each step is one
 * cached material, so wearing clothes dirtier doesn't create a material per frame).
 */
export function characterMaterial(part: CharacterPart, color: ColorRepresentation, vertexColors = false, selfLit = 0, dirt?: number): MeshStandardMaterial {
  const step = dirt === undefined ? -1 : Math.round(Math.min(1, Math.max(0, dirt)) * (DIRT_STEPS - 1)) / (DIRT_STEPS - 1);
  const key = `${part}:${String(color)}:${vertexColors}:${selfLit}:${step}`;
  const cached = charCache.get(key);
  if (cached) return cached;
  const spec = CHAR_KIND[part];
  let base = new Color(color);
  let noise = spec.noise ?? 0.4;
  let grime = spec.grime ?? 1;
  if (step >= 0) {
    base = base.lerp(MUD, step * 0.25);
    noise = 0.1 + step * 0.35;
    grime = step * 1.5;
  }
  const mat = new MeshStandardMaterial({
    map: track(generateGrungeTexture(base, noise, { kind: spec.kind, seed: charCache.size * 31 + 5, size: 64, grime })),
    roughness: spec.roughness,
    metalness: spec.metalness,
    vertexColors,
  });
  if (selfLit > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * ${selfLit.toFixed(3)};`,
      ).replace(
        '#include <opaque_fragment>',
        // The flashlight sits a hand's width from the body: cap the body's own brightness so the
        // belly and legs never blow out to white right under the light.
        `outgoingLight = min(outgoingLight, diffuseColor.rgb * 0.9 + 0.04);
#include <opaque_fragment>`,
      );
    };
    mat.customProgramCacheKey = () => `self-lit-${selfLit}`;
  }
  charCache.set(key, mat);
  return mat;
}

/** Dark, worn kitchen-knife steel: rust blooms, scratches and bumped notches on the edge. */
export function bladeMaterial(): MeshStandardMaterial {
  const cached = charCache.get('blade');
  if (cached) return cached;
  const mat = new MeshStandardMaterial({
    map: track(generateGrungeTexture(0x6f7376, 0.45, { kind: 'rust', seed: 404, size: 64 })),
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
