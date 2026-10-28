import {
  DataArrayTexture,
  DoubleSide,
  Vector4,
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
let materials: (Record<Bucket, Material> & { castCut: Material }) | null = null;
let texture: DataArrayTexture | null = null;

/** Up to two loaded high-rises whose intact windows are cut open (see setWindowCutouts). */
const MAX_CUTOUTS = 2;
const cutUniforms = {
  /** minX, minZ, maxX, maxZ per building (empty = an impossible box). */
  uCutXZ: { value: Array.from({ length: MAX_CUTOUTS }, () => new Vector4(1, 1, 0, 0)) },
  /** Roof height per building: the parapet above keeps its painted texture. */
  uCutTop: { value: new Array<number>(MAX_CUTOUTS).fill(0) },
};

/**
 * Footprints of the buildings whose interiors are loaded: their intact windows become holes
 * (and the interior's glass panes show). Only chunk meshes switched to the castCut material pay
 * for the discard; everything else keeps early-Z.
 */
export function setWindowCutouts(boxes: { minX: number; minZ: number; maxX: number; maxZ: number; top: number }[]): void {
  for (let i = 0; i < MAX_CUTOUTS; i++) {
    const b = boxes[i];
    if (b) cutUniforms.uCutXZ.value[i].set(b.minX, b.minZ, b.maxX, b.maxZ);
    else cutUniforms.uCutXZ.value[i].set(1, 1, 0, 0);
    cutUniforms.uCutTop.value[i] = b ? b.top : 0;
  }
}

export function initWorldMaterials(model: LightingModel, anisotropy: number): void {
  if (materials) return;
  texture = buildSurfaceArray(anisotropy);
  const make = (kind: 'opaque' | 'glass', cutWindows = false): Material => {
    const m =
      model === 'standard'
        ? new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 })
        : new MeshLambertMaterial({ vertexColors: true });
    if (kind === 'glass') {
      // Alpha comes per surface from the texture (glass tint, decal shapes).
      m.transparent = true;
      // Panes overlap each other and the interior; skipping depth writes avoids sorting holes.
      m.depthWrite = false;
      // Window panes are seen from the street and from the rooms.
      m.side = DoubleSide;
    }
    patch(m, texture!, model === 'standard', cutWindows);
    return m;
  };
  materials = { cast: make('opaque'), flat: make('opaque'), glass: make('glass'), castCut: make('opaque', true) };
}

export function worldMaterials(): Record<Bucket, Material> & { castCut: Material } {
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
      : generateGrungeCanvas(s.detail, s.noise, { kind: s.kind, seed: layer * 101 + 13, size: SIZE });
    const px = canvas.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
    if (s.alpha !== undefined) for (let i = 3; i < px.length; i += 4) px[i] = Math.round(px[i] * s.alpha);
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

function patch(m: Material, tex: DataArrayTexture, standard: boolean, cutWindows: boolean): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfaces = { value: tex };
    if (cutWindows) Object.assign(shader.uniforms, cutUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aSurfUv;
attribute float aLayer;
attribute vec2 aPbr;
varying vec2 vSurfUv;
flat varying float vLayer;
varying vec2 vPbr;
${cutWindows ? 'varying vec3 vCutPos;' : ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurfUv = aSurfUv;
vLayer = aLayer;
vPbr = aPbr;
${cutWindows ? 'vCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' : ''}`);
    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform mediump sampler2DArray uSurfaces;
varying vec2 vSurfUv;
flat varying float vLayer;
varying vec2 vPbr;
${cutWindows ? `varying vec3 vCutPos;
uniform vec4 uCutXZ[${MAX_CUTOUTS}];
uniform float uCutTop[${MAX_CUTOUTS}];` : ''}`,
      )
      .replace(
        '#include <map_fragment>',
        cutWindows
            ? `vec4 texel = texture(uSurfaces, vec3(vSurfUv, vLayer));
// Intact window glass (alpha-marked) of a loaded building: a hole into the rooms behind.
if (texel.a < 0.6) {
  for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
    vec4 b = uCutXZ[i];
    if (vCutPos.x > b.x && vCutPos.x < b.z && vCutPos.z > b.y && vCutPos.z < b.w && vCutPos.y < uCutTop[i]) discard;
  }
}
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
  m.customProgramCacheKey = () => `world-surfaces-${standard ? 'pbr' : 'lambert'}${cutWindows ? '-cut' : ''}`;
}
