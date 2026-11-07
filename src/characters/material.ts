import { Color, type DataTexture, MeshLambertMaterial } from 'three';
import { SKIN } from '../style/palette';
import { glslColor, NOISE_GLSL, stainGlsl } from '../style/look';
import { type BodyAsset, type RigAsset } from './assets';

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
}

function bounds(rig: RigAsset): { minY: number; height: number; hips: number } {
  const g = rig.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const minY = g.boundingBox!.min.y;
  const height = g.boundingBox!.max.y - minY;
  const hips = rig.bind[rig.index.get('Hips') ?? 0].elements[13];
  return { minY, height, hips };
}

const LUM = 'vec3(0.2126, 0.7152, 0.0722)';

export function characterMaterial(body: BodyAsset, rig: RigAsset, o: CharacterLook = {}): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ map: body.texture ?? null });
  if (!body.texture) mat.color.setHex(0x6d6a60);
  const b = bounds(rig);
  const zombie = !!o.zombie;
  const batched = !!o.skin;
  mat.name = `character-${body.id}${zombie ? '-zombie' : ''}${batched ? '-batch' : ''}`;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMinY = { value: b.minY };
    sh.uniforms.uHeight = { value: b.height };
    sh.uniforms.uHips = { value: b.hips };
    if (o.skin) sh.uniforms.uSkin = { value: o.skin };
    sh.uniforms.uTint = { value: o.tint?.[0] ?? new Color(1, 1, 1) };
    sh.uniforms.uTint2 = { value: o.tint?.[1] ?? new Color(1, 1, 1) };
    const skinDecl = batched
      ? `
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 aTint;
attribute vec3 aTint2;
uniform highp sampler2D uSkin;
mat4 zBone(float i) {
  int b = int(i + 0.5) * 4;
  return mat4(texelFetch(uSkin, ivec2(b, gl_InstanceID), 0), texelFetch(uSkin, ivec2(b + 1, gl_InstanceID), 0),
              texelFetch(uSkin, ivec2(b + 2, gl_InstanceID), 0), texelFetch(uSkin, ivec2(b + 3, gl_InstanceID), 0));
}
mat4 zSkinM;`
      : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBindPos;\nvarying vec3 vTint;\nvarying vec3 vTint2;\nuniform vec3 uTint;\nuniform vec3 uTint2;${skinDecl}`)
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
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvBindPos = position;${batched ? '\ntransformed = (zSkinM * vec4(transformed, 1.0)).xyz;' : ''}`);
    const zombieGlsl = zombie
      ? `
  float zl = dot(diffuseColor.rgb, ${LUM});
  vec3 zt = vBindPos.y > uHips ? vTint : vTint2;
  vec3 zcloth = mix(diffuseColor.rgb, zl * zt / max(dot(zt, ${LUM}), 0.03), 0.6);
  zcloth = mix(zcloth, vec3(dot(zcloth, ${LUM})) * vec3(0.97, 1.0, 0.95), 0.15 + 0.35 * zNoise(vBindPos * 4.0 + 5.0));
  ${stainGlsl('vBindPos', 'zcloth', 1.4)}
  vec3 zdead = ${glslColor(SKIN)} * clamp(zl / 0.17, 0.6, 1.2);
  diffuseColor.rgb = mix(zcloth, zdead, zSkin);`
      : '';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBindPos;\nvarying vec3 vTint;\nvarying vec3 vTint2;\nuniform float uMinY;\nuniform float uHeight;\nuniform float uHips;\n${NOISE_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float zSkin = ${body.texture ? 'clamp((1.0 - diffuseColor.a) * 2.0, 0.0, 1.0)' : '0.0'};
  diffuseColor.a = 1.0;${zombieGlsl}
  float zh = clamp((vBindPos.y - uMinY) / uHeight, 0.0, 1.0);
  diffuseColor.rgb *= (0.9 + 0.2 * zNoise(vBindPos * 9.0 + 11.3)) * mix(0.7 + 0.3 * smoothstep(0.0, 0.42, zh), 1.0, zSkin * 0.6);
}`,
      );
  };
  mat.customProgramCacheKey = () => `character-${zombie}-${batched}-${!!body.texture}`;
  return mat;
}
