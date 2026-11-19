import { Color, DataTexture, DoubleSide, FrontSide, LinearFilter, MeshLambertMaterial, RepeatWrapping, RGBAFormat, type Texture } from 'three';
import { SKIN } from '../style/palette';
import { glslColor } from '../style/look';
import { type BodyAsset, lodTexture, type RigAsset } from './assets';

/**
 * The material of every character (CLAUDE.md «Визуальный стиль»): Lambert, the body's texture (already
 * through the grim palette; alpha = skin), grime in the shader by the bind-pose position — noise ±10%,
 * darker towards the ground (dust from below, the shoes darkest).
 *
 * Zombies (`zombie`): the skin turns the palette's dead SKIN (pale, as dark or light as it was), the
 * clothes take the kind's tints (top above the hips, bottom below), faded and stained with dirt, soot and
 * oil; no blood. Batched (`skin`): an instanced mesh skinned from a texture, a row of bone matrices per
 * instance (4 texels each), 4 weights per vertex; the tints per instance (aTint, aTint2).
 */

export interface CharacterLook {
  zombie?: boolean;
  /** The instanced batch's skin rows. */
  skin?: DataTexture;
  /** A single zombie's clothes (linear): top, bottom (a batch has them per instance). */
  tint?: [Color, Color];
  /** How much the clothes take the tint (0.6 everyday clothes; a costume keeps its colours). */
  tintMix?: number;
  /**
   * The body under worn gear: its vertices' `aCover` (bit per gear piece over them) against the gear worn —
   * `hide` (one figure's uniform) or, batched, the instance's `aHide`; a triangle with all three corners
   * under it is not drawn (no skin through a vest, no hair through a helmet).
   */
  cover?: boolean;
  hide?: { value: number };
  /** A gear batch: the skin row from the instance's `aRow` (it rides on its body's rows), not its index. */
  row?: boolean;
  /** Nothing nearer the eye than this (m): first-person gear never covers the camera. */
  near?: number;
  /** A texture instead of the body's (gear: its own; alpha 1, no skin). */
  map?: Texture | null;
  /**
   * A lens (glasses): no texture, this dark tint, nearly opaque (the eyes do not show through), a sharp
   * mirror-like glint that moves as the head turns.
   */
  lens?: number;
  /** Thin cloth (the shemagh, the masks): both faces drawn; everything else one-sided. */
  doubleSide?: boolean;
}

function bounds(rig: RigAsset): { minY: number; height: number; hips: number } {
  const g = rig.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const minY = g.boundingBox!.min.y;
  const height = g.boundingBox!.max.y - minY;
  const hips = rig.bind[rig.index.get('Hips') ?? 0].elements[13];
  return { minY, height, hips };
}

function hash2(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function periodicNoise(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

let _noiseTex: DataTexture | null = null;
function noiseTexture(): DataTexture {
  if (_noiseTex) return _noiseTex;
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const r = periodicNoise(u, v, 4, 1) * 0.6 + periodicNoise(u, v, 8, 2) * 0.4;
      const g = periodicNoise(u, v, 8, 3) * 0.6 + periodicNoise(u, v, 16, 4) * 0.4;
      const b = periodicNoise(u, v, 4, 5) * 0.5 + periodicNoise(u, v, 8, 6) * 0.35 + periodicNoise(u, v, 16, 7) * 0.15;
      const a = periodicNoise(u, v, 16, 8) * 0.65 + periodicNoise(u, v, 32, 9) * 0.35;
      const i = (y * size + x) * 4;
      data[i] = (r * 255) | 0;
      data[i + 1] = (g * 255) | 0;
      data[i + 2] = (b * 255) | 0;
      data[i + 3] = (a * 255) | 0;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _noiseTex = t;
  return t;
}

const LUM = 'vec3(0.2126, 0.7152, 0.0722)';
/** Lenses: dark sunglasses, the eyes behind them not seen. */
export const LENS_OPACITY = 0.85;
/** Lens tints by piece (already dark: through the grim palette's spirit, nothing bright). */
export const LENS_TINT: Partial<Record<string, number>> = { goggles_tactical: 0x1b1d1f, glasses_ballistic: 0x261a12 };

export function characterMaterial(body: BodyAsset, rig: RigAsset, o: CharacterLook = {}): MeshLambertMaterial {
  const lens = o.lens !== undefined;
  // Zombies: the crowd's smaller texture (the player and the menu: the big one).
  const tex = lens ? null : o.map !== undefined ? o.map : o.zombie ? lodTexture(body) : body.texture;
  const mat = new MeshLambertMaterial({ map: tex ?? null, side: o.doubleSide ? DoubleSide : FrontSide });
  if (!tex) mat.color.setHex(lens ? o.lens! : 0x6d6a60);
  if (lens) {
    mat.transparent = true;
    mat.opacity = LENS_OPACITY;
    mat.depthWrite = true;
  }
  const cover = !!o.cover, row = !!o.row, near = o.near ?? 0;
  const hide = o.hide ?? { value: 0 };
  const b = bounds(rig);
  const zombie = !!o.zombie;
  const batched = !!o.skin;
  mat.name = `character-${body.id}${zombie ? '-zombie' : ''}${batched ? '-batch' : ''}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMinY = { value: b.minY };
    sh.uniforms.uHeight = { value: b.height };
    sh.uniforms.uHips = { value: b.hips };
    sh.uniforms.uNoiseTex = { value: noiseTexture() };
    if (o.skin) sh.uniforms.uSkin = { value: o.skin };
    if (cover && !batched) sh.uniforms.uHide = hide;
    sh.uniforms.uTint = { value: o.tint?.[0] ?? new Color(1, 1, 1) };
    sh.uniforms.uTint2 = { value: o.tint?.[1] ?? new Color(1, 1, 1) };
    const skinDecl = batched
      ? `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 aTint;
attribute vec3 aTint2;
uniform highp sampler2D uSkin;
${row ? 'attribute float aRow;' : ''}
mat4 zBone(float i) {
  int b = int(i + 0.5) * 4;
  int r = ${row ? 'int(aRow + 0.5)' : 'gl_InstanceID'};
  return mat4(texelFetch(uSkin, ivec2(b, r), 0), texelFetch(uSkin, ivec2(b + 1, r), 0),
              texelFetch(uSkin, ivec2(b + 2, r), 0), texelFetch(uSkin, ivec2(b + 3, r), 0));
}
mat4 zSkinM;`
      : '';
    const coverDecl = cover ? `\nattribute float aCover;\n${batched ? 'attribute float aHide;' : 'uniform int uHide;'}\nvarying float vCover;` : '';
    const coverMain = cover ? `\nvCover = (int(aCover + 0.5) & ${batched ? 'int(aHide + 0.5)' : 'uHide'}) != 0 ? 1.0 : 0.0;` : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBindPos;\nvarying vec3 vTint;\nvarying vec3 vTint2;\nuniform vec3 uTint;\nuniform vec3 uTint2;${skinDecl}${coverDecl}`)
      .replace(
        '#include <beginnormal_vertex>',
        batched
          ? `#include <beginnormal_vertex>
zSkinM = zBone(skinIndex.x) * skinWeight.x + zBone(skinIndex.y) * skinWeight.y + zBone(skinIndex.z) * skinWeight.z + zBone(skinIndex.w) * skinWeight.w;
objectNormal = mat3(zSkinM) * objectNormal;
vTint = aTint;
vTint2 = aTint2;`
          : '#include <beginnormal_vertex>\nvTint = uTint;\nvTint2 = uTint2;',
      )
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBindPos = position;${coverMain}${batched ? '\ntransformed = (zSkinM * vec4(transformed, 1.0)).xyz;' : ''}`);
    const zombieGlsl = zombie
      ? `
  float zl = dot(diffuseColor.rgb, ${LUM});
  vec3 zt = vBindPos.y > uHips ? vTint : vTint2;
  vec3 zcloth = mix(diffuseColor.rgb, zl * zt / max(dot(zt, ${LUM}), 0.03), ${(o.tintMix ?? 0.6).toFixed(3)});
  vec4 zn2 = texture2D(uNoiseTex, vBindPos.zy * 0.52 + vec2(vBindPos.x * 0.39, 0.61));
  zcloth = mix(zcloth, vec3(dot(zcloth, ${LUM})) * vec3(0.97, 1.0, 0.95), 0.15 + 0.35 * zn2.r);
  float zDirt = smoothstep(0.52, 0.76, zn2.b * 0.65 + zn1.a * 0.35);
  zcloth = mix(zcloth, zcloth * vec3(0.45, 0.42, 0.37), zDirt * 0.62);
  vec3 zdead = ${glslColor(SKIN)} * clamp(zl / 0.17, 0.6, 1.2);
  diffuseColor.rgb = mix(zcloth, zdead, zSkin);`
      : '';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBindPos;\nvarying vec3 vTint;\nvarying vec3 vTint2;\nuniform float uMinY;\nuniform float uHeight;\nuniform float uHips;\nuniform mediump sampler2D uNoiseTex;\n${cover ? 'varying float vCover;\n' : ''}`)
      .replace(
        '#include <opaque_fragment>',
        lens
          ? `{
  // The glint: a soft diagonal streak of the sky across the lens (in its own bind space, so the simplified
  // facets do not sparkle), sliding a little as the view turns; a faint rim at grazing angles.
  vec3 lv = normalize(-vViewPosition);
  float lb = fract((vBindPos.x * 0.55 + vBindPos.y) / 0.075 + lv.x * 0.8 + lv.y * 0.4);
  float lg = smoothstep(0.0, 0.06, lb) * (1.0 - smoothstep(0.06, 0.2, lb)) * 0.5;
  float lf = pow(1.0 - abs(dot(lv, normalize(normal))), 3.0);
  outgoingLight += vec3(0.34, 0.35, 0.36) * lg + vec3(0.05) * lf;
  diffuseColor.a = mix(diffuseColor.a, 1.0, lg);
}
#include <opaque_fragment>`
          : '#include <opaque_fragment>',
      )
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>${cover ? '\nif (vCover > 0.999) discard;' : ''}${near ? `\nif (length(vViewPosition) < ${near.toFixed(3)}) discard;` : ''}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float zSkin = ${tex && o.map === undefined ? 'clamp((1.0 - diffuseColor.a) * 2.0, 0.0, 1.0)' : '0.0'};
  diffuseColor.a = 1.0;
  vec4 zn1 = texture2D(uNoiseTex, vBindPos.xy * 1.1 + vec2(vBindPos.z * 0.8, 0.23));${zombieGlsl}
  float zh = clamp((vBindPos.y - uMinY) / uHeight, 0.0, 1.0);
  diffuseColor.rgb *= (0.9 + 0.2 * zn1.g) * mix(0.7 + 0.3 * smoothstep(0.0, 0.42, zh), 1.0, zSkin * 0.6);
}`,
      );
  };
  mat.customProgramCacheKey = () => `character-${lens}-${zombie}-${batched}-${!!tex}-${o.map !== undefined}-${o.tintMix ?? 0.6}-${cover}-${row}-${near}`;
  return mat;
}
