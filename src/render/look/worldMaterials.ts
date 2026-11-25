import {
  DataArrayTexture,
  DoubleSide,
  Vector4,
  LinearFilter,
  LinearMipmapLinearFilter,
  type Material,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { onLangChange } from '../../core/i18n';
import { generateDecalCanvas } from './decals';
import { generateGrungeCanvas } from './grunge';
import { type Bucket, MODEL_LAYER_BASE, PBR_LAYERS, pbrMappingForSurface, SURFACE_LIST, SURFACES } from './surfaces';

export type LightingModel = 'standard' | 'lambert';

const SIZE = 128;

/**
 * World materials: uSurfaces (decals, foliage, glass, facade window masks), modelAtlas (baked props),
 * and seamless 1024x1024 PBR array textures (uPbrAlbedo + uPbrNrmRough) with world-space tiling
 * and 8x anisotropic filtering.
 */
let materials: (Record<Bucket, Material> & { castCut: Material }) | null = null;
let texture: DataArrayTexture | null = null;
/** Atlas of the third-party models (one layer each); a 1-texel placeholder until it loads. */
const modelAtlas = { value: placeholderAtlas() };
/** 1024x1024 seamless PBR albedo (SRGB) and packed tangent-space NormalGL.xyz + Roughness.a (linear). */
const pbrAlbedo = { value: placeholderPbrArray(PBR_LAYERS.length, [200, 200, 200, 255], SRGBColorSpace) };
const pbrNrmRough = { value: placeholderPbrArray(PBR_LAYERS.length, [128, 128, 255, 220], NoColorSpace) };
const pbrReady = { value: 0 };

function placeholderAtlas(): DataArrayTexture {
  const t = new DataArrayTexture(new Uint8Array([200, 200, 200, 255]), 1, 1, 1);
  t.needsUpdate = true;
  return t;
}

function placeholderPbrArray(layers: number, rgba: [number, number, number, number], colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): DataArrayTexture {
  const data = new Uint8Array(layers * 4);
  for (let l = 0; l < layers; l++) {
    data[l * 4] = rgba[0];
    data[l * 4 + 1] = rgba[1];
    data[l * 4 + 2] = rgba[2];
    data[l * 4 + 3] = rgba[3];
  }
  const t = new DataArrayTexture(data, 1, 1, layers);
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}

export function pbrTexturesReady(): boolean {
  return pbrReady.value > 0.5;
}

/**
 * The model atlas (public/models/atlas.jpg: layers tiled left-to-right, top-to-bottom). Loaded
 * before the world streams; false if the library is not installed.
 */
export async function loadModelAtlas(url: string, layerSize: number, anisotropy: number): Promise<boolean> {
  try {
    const img = await createImageBitmap(await (await fetch(url)).blob());
    const cols = Math.max(1, Math.floor(img.width / layerSize));
    const rows = Math.max(1, Math.floor(img.height / layerSize));
    const layers = cols * rows;
    const canvas = new OffscreenCanvas(layerSize, layerSize);
    const ctx = canvas.getContext('2d')!;
    const row = layerSize * 4;
    const data = new Uint8Array(layerSize * row * layers);
    for (let l = 0; l < layers; l++) {
      const cx = (l % cols) * layerSize;
      const cy = Math.floor(l / cols) * layerSize;
      ctx.drawImage(img, cx, cy, layerSize, layerSize, 0, 0, layerSize, layerSize);
      const px = ctx.getImageData(0, 0, layerSize, layerSize).data;
      // Each layer's rows flipped to GL order (the UVs were made for that).
      const base = l * layerSize * row;
      for (let y = 0; y < layerSize; y++) data.set(px.subarray(y * row, (y + 1) * row), base + (layerSize - 1 - y) * row);
    }
    img.close();
    const tex = new DataArrayTexture(data, layerSize, layerSize, layers);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, anisotropy);
    tex.needsUpdate = true;
    modelAtlas.value = tex;
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads seamless 1024x1024 PBR material sets (albedo + NormalGL + roughness) from `baseUrl`
 * into two GPU DataArrayTextures with 8x anisotropic filtering.
 */
export async function loadPbrTextures(baseUrl: string, size: number, anisotropy: number): Promise<boolean> {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false;
    const fetchImg = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
      return createImageBitmap(await res.blob());
    };
    const loaded = await Promise.all(
      PBR_LAYERS.map((name) =>
        Promise.all([
          fetchImg(`${baseUrl}${name}_albedo.jpg`),
          fetchImg(`${baseUrl}${name}_normal.jpg`),
          fetchImg(`${baseUrl}${name}_rough.jpg`),
        ]),
      ),
    );

    const layers = PBR_LAYERS.length;
    const row = size * 4;
    const albedoData = new Uint8Array(size * row * layers);
    const nrmRoughData = new Uint8Array(size * row * layers);
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    for (let l = 0; l < layers; l++) {
      const [albBmp, nrmBmp, rghBmp] = loaded[l];
      const base = l * size * row;

      ctx.drawImage(albBmp, 0, 0, size, size);
      albBmp.close();
      const albPx = ctx.getImageData(0, 0, size, size).data;

      ctx.drawImage(nrmBmp, 0, 0, size, size);
      nrmBmp.close();
      const nrmPx = ctx.getImageData(0, 0, size, size).data;

      ctx.drawImage(rghBmp, 0, 0, size, size);
      rghBmp.close();
      const rghPx = ctx.getImageData(0, 0, size, size).data;

      for (let y = 0; y < size; y++) {
        const srcRow = y * row;
        const dstRow = base + (size - 1 - y) * row;
        for (let x = 0; x < size; x++) {
          const si = srcRow + x * 4;
          const di = dstRow + x * 4;
          albedoData[di] = albPx[si];
          albedoData[di + 1] = albPx[si + 1];
          albedoData[di + 2] = albPx[si + 2];
          albedoData[di + 3] = 255;

          nrmRoughData[di] = nrmPx[si];
          nrmRoughData[di + 1] = nrmPx[si + 1];
          nrmRoughData[di + 2] = nrmPx[si + 2];
          nrmRoughData[di + 3] = rghPx[si];
        }
      }
    }

    const aniso = Math.max(1, Math.min(8, anisotropy));
    const albTex = new DataArrayTexture(albedoData, size, size, layers);
    albTex.colorSpace = SRGBColorSpace;
    albTex.wrapS = albTex.wrapT = RepeatWrapping;
    albTex.magFilter = LinearFilter;
    albTex.minFilter = LinearMipmapLinearFilter;
    albTex.generateMipmaps = true;
    albTex.anisotropy = aniso;
    albTex.needsUpdate = true;

    const nrTex = new DataArrayTexture(nrmRoughData, size, size, layers);
    nrTex.colorSpace = NoColorSpace;
    nrTex.wrapS = nrTex.wrapT = RepeatWrapping;
    nrTex.magFilter = LinearFilter;
    nrTex.minFilter = LinearMipmapLinearFilter;
    nrTex.generateMipmaps = true;
    nrTex.anisotropy = aniso;
    nrTex.needsUpdate = true;

    pbrAlbedo.value = albTex;
    pbrNrmRough.value = nrTex;
    pbrReady.value = 1;
    return true;
  } catch (err) {
    console.warn('PBR world texture load failed, using procedural surface fallback:', err);
    return false;
  }
}

/** Up to six loaded high-rises whose intact windows are cut open (see setWindowCutouts). */
const MAX_CUTOUTS = 6;
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

export function surfaceTextureAnisotropy(): number {
  return texture?.anisotropy ?? 1;
}

/** Grunge textures, decals, window cutouts and non-PBR layers as one sampler2DArray (rows flipped to GL order). */
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
  tex.anisotropy = Math.max(1, Math.min(8, anisotropy));
  tex.needsUpdate = true;
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

function buildPbrDispatchGlsl(): string {
  const branches: string[] = [];
  SURFACE_LIST.forEach((surface, idx) => {
    const map = pbrMappingForSurface(surface);
    if (!map) return;
    let maskCond = '';
    if (map.facadeMask === 'apartment') {
      maskCond = ' && !(cellUv.x > 0.125 && cellUv.x < 0.875 && cellUv.y > 0.203 && cellUv.y < 0.859)';
    } else if (map.facadeMask === 'office') {
      maskCond = ' && !(cellUv.x > 0.0468 && cellUv.x < 0.9532 && cellUv.y > 0.109 && cellUv.y < 0.922)';
    }
    const prefix = branches.length === 0 ? 'if' : 'else if';
    branches.push(
      `${prefix} (li == ${idx}${maskCond}) { pbrActive = 1.0; pbrLayer = ${map.layer}.0; pbrUv = vSurfUv * vec2(${map.uvScaleU.toFixed(4)}, ${map.uvScaleV.toFixed(4)}); pbrNScale = ${map.normalScale.toFixed(2)}; }`,
    );
  });
  return branches.join('\n  ');
}

function patch(m: Material, tex: DataArrayTexture, standard: boolean, cutWindows: boolean, isGlass: boolean): void {
  const pbrDispatch = buildPbrDispatchGlsl();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSurfaces = { value: tex };
    shader.uniforms.uModels = modelAtlas;
    shader.uniforms.uPbrAlbedo = pbrAlbedo;
    shader.uniforms.uPbrNrmRough = pbrNrmRough;
    shader.uniforms.uPbrReady = pbrReady;
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
${!isGlass ? 'varying float vSnowBase;' : ''}
${cutWindows ? 'varying vec3 vCutPos;' : ''}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSurfUv = aSurfUv;
vLayer = aLayer;
vPbr = aPbr;
${!isGlass || cutWindows ? 'vec4 worldPos4 = modelMatrix * vec4(transformed, 1.0);' : ''}
${!isGlass ? `float snowUp = smoothstep(0.45, 0.78, normalize(mat3(modelMatrix) * objectNormal).y);
float snowNoise = 0.76 + 0.24 * sin(worldPos4.x * 0.27 + worldPos4.z * 0.19) * cos(worldPos4.z * 0.23 - worldPos4.x * 0.11);
vSnowBase = snowUp * snowNoise;` : ''}
${cutWindows ? 'vCutPos = worldPos4.xyz;' : ''}`,
      );

    let frag = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform mediump sampler2DArray uSurfaces;
uniform mediump sampler2DArray uModels;
uniform mediump sampler2DArray uPbrAlbedo;
uniform mediump sampler2DArray uPbrNrmRough;
uniform float uPbrReady;
varying vec2 vSurfUv;
flat varying float vLayer;
varying vec2 vPbr;
${!isGlass ? 'uniform float uSnow;\nvarying float vSnowBase;' : ''}
${cutWindows ? `varying vec3 vCutPos;
uniform vec4 uCutXZ[${MAX_CUTOUTS}];
uniform float uCutTop[${MAX_CUTOUTS}];` : ''}
mat3 pbrTangentFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
  vec3 q0 = dFdx(eye_pos.xyz);
  vec3 q1 = dFdy(eye_pos.xyz);
  vec2 st0 = dFdx(uv.st);
  vec2 st1 = dFdy(uv.st);
  vec3 N = surf_norm;
  vec3 q1perp = cross(q1, N);
  vec3 q0perp = cross(N, q0);
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max(dot(T, T), dot(B, B));
  float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
  return mat3(T * scale, B * scale, N);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 texel = vLayer > ${MODEL_LAYER_BASE - 0.5} ? texture(uModels, vec3(vSurfUv, vLayer - ${MODEL_LAYER_BASE}.0)) : texture(uSurfaces, vec3(vSurfUv, vLayer));
${cutWindows ? `// Cut out windows only when the building's interior is loaded (uCutXZ), so distant buildings don't look hollow.
if (texel.a < 0.6) {
  for (int i = 0; i < ${MAX_CUTOUTS}; i++) {
    vec4 b = uCutXZ[i];
    if (vCutPos.x > b.x && vCutPos.x < b.z && vCutPos.z > b.y && vCutPos.z < b.w && vCutPos.y < uCutTop[i]) discard;
  }
}` : ''}
float pbrActive = 0.0;
float pbrLayer = 0.0;
vec2 pbrUv = vSurfUv;
float pbrNScale = 1.0;
vec4 pbrNrmRough = vec4(0.5, 0.5, 1.0, 0.85);
float snowCov = 0.0;
if (vLayer < ${MODEL_LAYER_BASE - 0.5} && uPbrReady > 0.5 && texel.a > 0.65) {
  int li = int(vLayer + 0.5);
  vec2 cellUv = fract(vSurfUv * 2.0);
  ${pbrDispatch}
}
if (pbrActive > 0.5) {
  vec4 pbrAlb = texture(uPbrAlbedo, vec3(pbrUv, pbrLayer));
  pbrNrmRough = texture(uPbrNrmRough, vec3(pbrUv, pbrLayer));
  float vLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 vTint = diffuseColor.rgb / max(vLum, 0.001);
  if (pbrLayer > 4.5 && vLum > 0.14) {
    // Sidewalks, curbs and road dashes keep bright paint/concrete luminance with 1K asphalt/aggregate relief
    float grit = clamp(dot(pbrAlb.rgb, vec3(0.299, 0.587, 0.114)) / 0.085, 0.68, 1.42);
    diffuseColor.rgb *= grit;
  } else {
    float targetGain = mix(0.64, 1.18, smoothstep(0.03, 0.55, vLum));
    diffuseColor.rgb = pbrAlb.rgb * mix(vec3(1.0), vTint * targetGain, 0.48);
  }
} else {
  diffuseColor *= texel;
}
${!isGlass ? `if (uSnow > 0.01 && vSnowBase > 0.001) {
  snowCov = clamp(vSnowBase * uSnow, 0.0, 0.9);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.84, 0.89, 0.95), snowCov);
}` : ''}`,
      );

    if (standard) {
      frag = frag
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = pbrActive > 0.5 ? clamp(mix(vPbr.x, pbrNrmRough.a, 0.88), 0.08, 1.0) : vPbr.x;
roughnessFactor = mix(roughnessFactor, 0.85, snowCov);`,
        )
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
if (pbrActive > 0.5) {
  vec3 mapN = pbrNrmRough.xyz * 2.0 - 1.0;
  mapN.xy *= pbrNScale * (1.0 - snowCov * 0.85);
  normal = normalize(pbrTangentFrame(-vViewPosition, normal, pbrUv) * mapN);
}`,
        );
    }
    shader.fragmentShader = frag;
  };
  m.customProgramCacheKey = () => `world-surfaces-pbr1k-${standard ? 'pbr' : 'lambert'}${cutWindows ? '-cut' : ''}${isGlass ? '-glass' : '-snow'}`;
}
