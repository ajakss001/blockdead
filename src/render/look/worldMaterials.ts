import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  MeshLambertMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { generateDecalCanvas } from './decals';
import { generateGrungeCanvas } from './grunge';
import { type Bucket, SURFACE_LIST, SURFACES } from './surfaces';

export type LightingModel = 'standard' | 'lambert';

const SIZE = 128;

/**
 * World materials: one texture array holds every surface's grunge texture, and each vertex carries
 * its layer and roughness/metalness. A whole chunk then draws with 1–3 calls instead of one per
 * surface — on phones the number of draw calls, not triangles, is what eats the frame.
 */
let materials: Record<Bucket, Material> | null = null;
let texture: DataArrayTexture | null = null;

export function initWorldMaterials(model: LightingModel, anisotropy: number): void {
  if (materials) return;
  texture = buildSurfaceArray(anisotropy);
  const make = (kind: 'opaque' | 'glass' | 'decal'): Material => {
    const m =
      model === 'standard'
        ? new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
        : new MeshLambertMaterial({ vertexColors: true });
    if (kind === 'glass') {
      m.transparent = true;
      m.opacity = SURFACES.carGlass.opacity ?? 0.82;
      // Panes overlap each other and the interior; skipping depth writes avoids sorting holes.
      m.depthWrite = false;
    }
    if (kind === 'decal') {
      // Alpha-cut overlays lying on walls and roads: pulled towards the camera to win the depth test.
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -4;
    }
    patch(m, texture!, model === 'standard', kind === 'decal');
    return m;
  };
  materials = { cast: make('opaque'), flat: make('opaque'), glass: make('glass'), decal: make('decal') };
}

export function worldMaterials(): Record<Bucket, Material> {
  if (!materials) throw new Error('initWorldMaterials() was not called');
  return materials;
}

/** Grunge textures of all surfaces as layers of one sampler2DArray (rows flipped to GL order). */
function buildSurfaceArray(anisotropy: number): DataArrayTexture {
  const layers = SURFACE_LIST.length;
  const data = new Uint8Array(SIZE * SIZE * 4 * layers);
  const row = SIZE * 4;
  SURFACE_LIST.forEach((surface, layer) => {
    const s = SURFACES[surface];
    const canvas = s.decal
      ? generateDecalCanvas(s.decal, SIZE, layer * 31 + 7)
      : generateGrungeCanvas(s.detail, s.noise, { kind: s.kind, seed: layer * 101 + 13, blood: s.blood, size: SIZE });
    const px = canvas.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
    const base = layer * SIZE * row;
    // Canvas row 0 is the top; GL row 0 is the bottom. Flip so drips run down the walls.
    for (let y = 0; y < SIZE; y++) data.set(px.subarray(y * row, (y + 1) * row), base + (SIZE - 1 - y) * row);
  });
  const tex = new DataArrayTexture(data, SIZE, SIZE, layers);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(4, anisotropy);
  tex.needsUpdate = true;
  return tex;
}

function patch(m: Material, tex: DataArrayTexture, standard: boolean, cutout: boolean): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfaces = { value: tex };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aSurfUv;
attribute float aLayer;
attribute vec2 aPbr;
varying vec2 vSurfUv;
flat varying float vLayer;
varying vec2 vPbr;`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurfUv = aSurfUv;
vLayer = aLayer;
vPbr = aPbr;`);
    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform mediump sampler2DArray uSurfaces;
varying vec2 vSurfUv;
flat varying float vLayer;
varying vec2 vPbr;`,
      )
      .replace(
        '#include <map_fragment>',
        cutout
          ? `vec4 texel = texture(uSurfaces, vec3(vSurfUv, vLayer));
if (texel.a < 0.45) discard;
diffuseColor.rgb *= texel.rgb;`
          : 'diffuseColor *= texture(uSurfaces, vec3(vSurfUv, vLayer));',
      );
    if (standard) {
      frag = frag
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
    }
    shader.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `world-surfaces-${standard ? 'pbr' : 'lambert'}${cutout ? '-decal' : ''}`;
}
