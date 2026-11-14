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
import { onLangChange } from '../../core/i18n';
import { generateDecalCanvas } from './decals';
import { generateGrungeCanvas } from './grunge';
import { type Bucket, MODEL_LAYER_BASE, SURFACE_LIST, SURFACES } from './surfaces';

export type LightingModel = 'standard' | 'lambert';

const SIZE = 128;

/**
 * World materials: one texture array holds every surface's grunge texture, and each vertex carries
 * its layer and roughness/metalness. A whole chunk then draws with 1–3 calls instead of one per
 * surface — on phones the number of draw calls, not triangles, is what eats the frame.
 */
let materials: (Record<Bucket, Material> & { castCut: Material }) | null = null;
let texture: DataArrayTexture | null = null;
/** Atlas of the third-party models (one layer each); a 1-texel placeholder until it loads. */
const modelAtlas = { value: placeholderAtlas() };

function placeholderAtlas(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array([200, 200, 200, 255]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

/**
 * The model atlas (public/models/atlas.jpg: layers stacked top to bottom). Loaded before the world
 * streams; false if the library is not installed (the game then keeps its procedural props).
 */
export async function loadModelAtlas(url: string, layerSize: number, anisotropy: number): Promise<boolean> {
  try {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    const layers = Math.floor(img.height / layerSize);
    const row = layerSize * 4;
    const data = new Uint8Array(layerSize * row * layers);
    // Each layer's rows flipped to GL order (the UVs were made for that).
    for (let l = 0; l < layers; l++) for (let y = 0; y < layerSize; y++) data.set(px.subarray((l * layerSize + y) * row, (l * layerSize + y + 1) * row), (l * layerSize + layerSize - 1 - y) * row);
    const tex = new DataArrayTexture(data, layerSize, layerSize, layers);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, anisotropy);
    tex.needsUpdate = true;
    modelAtlas.value = tex;
    return true;
  } catch {
    return false;
  }
}

/** Up to two loaded high-rises whose intact windows are cut open (see setWindowCutouts). */
const MAX_CUTOUTS = 2;
const cutUniforms = {
  /** minX, minZ, maxX, maxZ per building (empty = an impossible box). */
  uCutXZ: { value: Array.from({ length: MAX_CUTOUTS }, () => new Vector4(1, 1, 0, 0)) },
  /** Roof height per building: the parapet above keeps its painted texture. */
  uCutTop: { value: new Array<number>(MAX_CUTOUTS).fill(0) },
};

const snowUniform = {
  uSnow: { value: 0.35 },
};

/** 0..1 snow accumulation on upward-facing outdoor world surfaces (ground, roofs, cars). */
export function setSnowCover(v: number): void {
  snowUniform.uSnow.value = Math.max(0, Math.min(1, v));
}

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
    patch(m, texture!, model === 'standard', cutWindows, kind === 'glass');
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
  const customTextures: Partial<Record<(typeof SURFACE_LIST)[number], string>> = {
    asphalt: 'asphalt.jpg',
    plaster: 'plaster.jpg',
    wood: 'wood.jpg',
    concrete: 'concrete.jpg',
  };
  for (let layer = 0; layer < SURFACE_LIST.length; layer++) {
    const file = customTextures[SURFACE_LIST[layer]];
    if (!file) continue;
    const targetLayer = layer;
    void fetch(`${import.meta.env.BASE_URL}textures/${file}`)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => (blob ? createImageBitmap(blob) : null))
      .then((bmp) => {
        if (!bmp) return;
        const c = new OffscreenCanvas(SIZE, SIZE);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
        const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
        let sum = 0;
        const count = SIZE * SIZE;
        for (let i = 0; i < px.length; i += 4) sum += (px[i] + px[i + 1] + px[i + 2]) / 3;
        const mean = Math.max(40, sum / count);
        const base = targetLayer * SIZE * row;
        for (let y = 0; y < SIZE; y++) {
          const srcOff = y * row;
          const dstOff = base + (SIZE - 1 - y) * row;
          for (let x = 0; x < SIZE; x++) {
            const si = srcOff + x * 4;
            const di = dstOff + x * 4;
            const lum = (px[si] * 0.3 + px[si + 1] * 0.59 + px[si + 2] * 0.11) / mean;
            const detail = Math.max(0.72, Math.min(1.25, 0.55 + 0.45 * lum));
            data[di] = Math.max(0, Math.min(255, Math.round(data[di] * detail)));
            data[di + 1] = Math.max(0, Math.min(255, Math.round(data[di + 1] * detail)));
            data[di + 2] = Math.max(0, Math.min(255, Math.round(data[di + 2] * detail)));
            data[di + 3] = 255;
          }
        }
        tex.needsUpdate = true;
      })
      .catch(() => {});
  }
  onLangChange(() => {
    SURFACE_LIST.forEach((surface, layer) => {
      const s = SURFACES[surface];
      if (!s.decal) return;
      const canvas = generateDecalCanvas(s.decal, SIZE, layer * 31 + 7);
      const px = canvas.getContext('2d')!.getImageData(0, 0, SIZE, SIZE).data;
      if (s.alpha !== undefined) for (let i = 3; i < px.length; i += 4) px[i] = Math.round(px[i] * s.alpha);
      const base = layer * SIZE * row;
      for (let y = 0; y < SIZE; y++) data.set(px.subarray(y * row, (y + 1) * row), base + (SIZE - 1 - y) * row);
    });
    tex.needsUpdate = true;
  });
  return tex;
}

function patch(m: Material, tex: DataArrayTexture, standard: boolean, cutWindows: boolean, isGlass: boolean): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfaces = { value: tex };
    shader.uniforms.uModels = modelAtlas;
    if (!isGlass) Object.assign(shader.uniforms, snowUniform);
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
${!isGlass ? 'varying vec3 vSnowWorld;\nvarying vec3 vSnowNorm;' : ''}
${cutWindows ? 'varying vec3 vCutPos;' : ''}`,
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vSurfUv = aSurfUv;
vLayer = aLayer;
vPbr = aPbr;
${!isGlass ? 'vSnowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSnowNorm = normalize(mat3(modelMatrix) * objectNormal);' : ''}
${cutWindows ? 'vCutPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' : ''}`);
    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform mediump sampler2DArray uSurfaces;
uniform mediump sampler2DArray uModels;
varying vec2 vSurfUv;
flat varying float vLayer;
varying vec2 vPbr;
${!isGlass ? 'uniform float uSnow;\nvarying vec3 vSnowWorld;\nvarying vec3 vSnowNorm;' : ''}
${cutWindows ? `varying vec3 vCutPos;
uniform vec4 uCutXZ[${MAX_CUTOUTS}];
uniform float uCutTop[${MAX_CUTOUTS}];` : ''}`,
      )
      .replace(
        '#include <map_fragment>',
        (cutWindows
            ? `vec4 texel = vLayer > ${MODEL_LAYER_BASE - 0.5} ? texture(uModels, vec3(vSurfUv, vLayer - ${MODEL_LAYER_BASE}.0)) : texture(uSurfaces, vec3(vSurfUv, vLayer));
// Intact window glass (alpha-marked) of a loaded building: a hole into the rooms behind.
if (texel.a < 0.6) {
  for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
    vec4 b = uCutXZ[i];
    if (vCutPos.x > b.x && vCutPos.x < b.z && vCutPos.z > b.y && vCutPos.z < b.w && vCutPos.y < uCutTop[i]) discard;
  }
}
diffuseColor.rgb *= texel.rgb;`
            : `diffuseColor *= vLayer > ${MODEL_LAYER_BASE - 0.5} ? texture(uModels, vec3(vSurfUv, vLayer - ${MODEL_LAYER_BASE}.0)) : texture(uSurfaces, vec3(vSurfUv, vLayer));`) +
          (!isGlass
            ? `
if (uSnow > 0.01) {
  float snowUp = smoothstep(0.45, 0.78, normalize(vSnowNorm).y);
  float snowNoise = 0.76 + 0.24 * sin(vSnowWorld.x * 0.27 + vSnowWorld.z * 0.19) * cos(vSnowWorld.z * 0.23 - vSnowWorld.x * 0.11);
  float snowMask = clamp(snowUp * uSnow * snowNoise, 0.0, 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.89, 0.95), snowMask);
}`
            : ''),
      );
    if (standard) {
      frag = frag
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;');
    }
    shader.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `world-surfaces-${standard ? 'pbr' : 'lambert'}${cutWindows ? '-cut' : ''}${isGlass ? '-glass' : '-snow'}`;
}
