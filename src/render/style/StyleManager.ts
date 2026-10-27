import {
  BackSide,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Renderer } from '../Renderer';
import { STYLE_FRAGMENT, STYLE_HEADER } from './styleShaders';

export type VisualStyle = 'plain' | 'diary' | 'vhs';
export const VISUAL_STYLES: readonly VisualStyle[] = ['plain', 'diary', 'vhs'];

interface StylePalette {
  /** Clear color + sky dome, sRGB hex. */
  sky: number;
  /** Fog target, sRGB hex. */
  fog: number;
  fogNear: number;
}

const PALETTES: Record<VisualStyle, StylePalette> = {
  plain: { sky: 0x59626b, fog: 0x59626b, fogNear: 6 },
  diary: { sky: 0xe9e1cc, fog: 0xe9e1cc, fogNear: 4 },
  vhs: { sky: 0x5d6670, fog: 0x5d6670, fogNear: 5 },
};

/** Stroke "boil" rate of the diary style, Hz. */
const BOIL_HZ = 8;

function srgb(hex: number): Vector3 {
  return new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/**
 * Visual identity layer. Patches every material's fragment shader (no post-processing pass,
 * so the cost on phones is a few ALU ops per pixel). The style is chosen once at boot (?style=).
 */
export class StyleManager {
  readonly palette: StylePalette;
  private readonly uniforms = {
    uTime: { value: 0 },
    uJitter: { value: new Vector2() },
    uPixelRatio: { value: 1 },
    uResolution: { value: new Vector2(1, 1) },
    uPaper: { value: srgb(0xe9e1cc) },
    uInk: { value: srgb(0x2a2630) },
    uFog: { value: new Vector3() },
  };
  private time = 0;
  private boilStep = -1;

  constructor(readonly style: VisualStyle) {
    this.palette = PALETTES[style];
    this.uniforms.uFog.value.copy(srgb(this.palette.fog));
  }

  get active(): boolean {
    return this.style !== 'plain';
  }

  /** Patch all materials under an object (call after building a scene or spawning meshes). */
  patchObject(root: Object3D): void {
    if (!this.active) return;
    root.traverse((o) => {
      const m = (o as Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) this.patch(mat);
    });
  }

  patch(material: Material): void {
    if (!this.active || material.userData.styled) return;
    material.userData.styled = true;
    const define = `STYLE_${this.style.toUpperCase()}`;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.defines = { ...shader.defines, [define]: '' };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${STYLE_HEADER}`)
        .replace('#include <fog_fragment>', STYLE_FRAGMENT);
    };
    material.customProgramCacheKey = () => define;
    material.needsUpdate = true;
  }

  /** Background sphere that follows the camera, so sky pixels get grain/paper too. */
  createSkyDome(): Mesh | null {
    if (!this.active) return null;
    const mat = new MeshBasicMaterial({ color: this.palette.sky, side: BackSide, fog: false, depthWrite: false });
    const dome = new Mesh(new SphereGeometry(20, 16, 8), mat);
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    this.patch(mat);
    return dome;
  }

  update(dt: number, renderer: Renderer): void {
    if (!this.active) return;
    this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    const step = Math.floor(this.time * BOIL_HZ);
    if (step !== this.boilStep) {
      this.boilStep = step;
      u.uJitter.value.set(((step * 7919) % 13) * 0.9, ((step * 104729) % 11) * 0.9);
    }
    u.uPixelRatio.value = renderer.pixelRatio;
    u.uResolution.value.set(renderer.gl.domElement.width, renderer.gl.domElement.height);
  }
}

export function pickStyle(): VisualStyle {
  const v = new URLSearchParams(location.search).get('style');
  return (VISUAL_STYLES as readonly string[]).includes(v ?? '') ? (v as VisualStyle) : 'plain';
}
