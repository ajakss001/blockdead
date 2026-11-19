import { type Camera, HalfFloatType, NoToneMapping, ReinhardToneMapping, type Scene, UnsignedByteType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { QualityLevel } from '../core/types';
import { FilmShader } from './look/filmShader';
import type { Renderer } from './Renderer';

/**
 * Post-processing chain: world → first-person arms (depth cleared) → FilmShader to screen.
 * On `medium`/`high` desktop renders into HalfFloat; on `medium` mobile uses 8-bit UnsignedByte (halving
 * tile memory bandwidth); on `low` bypasses the offscreen render target completely and renders directly to
 * screen with lightweight CSS overlays for anxiety/death vignette.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private worldPass: RenderPass | null = null;
  private armsPass: RenderPass | null = null;
  private filmPass: ShaderPass | null = null;
  private worldScene: Scene | null = null;
  private worldCamera: Camera | null = null;
  private armsOverlay?: { scene: Scene; camera: Camera };
  private readonly size = new Vector2();
  private time = 0;
  private bypass: boolean;
  private gradeOn = true;
  private dreadVal = 0;
  private deathVal = 0;
  private fadeVal = 0;
  private cssKey = '';
  private overlayEl: HTMLDivElement | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly msaaSamples: number,
    initialLevel: QualityLevel = 'high',
    private readonly mobile = false,
  ) {
    this.bypass = initialLevel === 'low';
    this.syncToneMapping();
    if (!this.bypass) this.ensureComposer();
  }

  private syncToneMapping(): void {
    const gl = this.renderer.gl;
    if (this.bypass) {
      gl.toneMapping = ReinhardToneMapping;
      gl.toneMappingExposure = 1.12;
    } else {
      gl.toneMapping = NoToneMapping;
      gl.toneMappingExposure = 1;
    }
  }

  private ensureComposer(): void {
    if (this.composer) return;
    const gl = this.renderer.gl;
    const floatOk = gl.capabilities.isWebGL2 && (gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float'));
    const useHalf = !this.mobile && floatOk;
    const target = new WebGLRenderTarget(1, 1, {
      type: useHalf ? HalfFloatType : UnsignedByteType,
      samples: this.msaaSamples,
    });
    this.composer = new EffectComposer(gl, target);

    this.worldPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    this.armsPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    this.armsPass.clear = false;
    this.armsPass.clearDepth = true;
    this.armsPass.enabled = false;
    this.filmPass = new ShaderPass(FilmShader);
    this.filmPass.uniforms.uGrade.value = this.gradeOn ? 1 : 0;
    this.filmPass.uniforms.uDread.value = this.dreadVal;
    this.filmPass.uniforms.uDeath.value = this.deathVal;
    this.filmPass.uniforms.uFade.value = this.fadeVal;

    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.armsPass);
    this.composer.addPass(this.filmPass);
    this.syncPasses();
    this.size.set(0, 0);
    this.syncSize();
  }

  private syncPasses(): void {
    if (!this.worldPass || !this.armsPass || !this.worldScene || !this.worldCamera) return;
    this.worldPass.scene = this.worldScene;
    this.worldPass.camera = this.worldCamera;
    this.armsPass.enabled = !!this.armsOverlay;
    if (this.armsOverlay) {
      this.armsPass.scene = this.armsOverlay.scene;
      this.armsPass.camera = this.armsOverlay.camera;
    }
  }

  setScene(scene: Scene, camera: Camera, overlay?: { scene: Scene; camera: Camera }): void {
    this.worldScene = scene;
    this.worldCamera = camera;
    this.armsOverlay = overlay;
    this.syncPasses();
  }

  /** Direct-render bypass on `low` avoids offscreen FBO bandwidth entirely on weak mobile GPUs. */
  setBypass(on: boolean): void {
    if (on === this.bypass) return;
    this.bypass = on;
    this.syncToneMapping();
    if (!on) {
      if (this.overlayEl) this.overlayEl.style.display = 'none';
      this.cssKey = '';
      this.ensureComposer();
    } else {
      this.syncCssOverlay();
    }
  }

  /** The cold grade, grain and vignette on (medium / high) or off (low: the fog and the palette alone). */
  setGrade(on: boolean): void {
    this.gradeOn = on;
    if (this.filmPass) this.filmPass.uniforms.uGrade.value = on ? 1 : 0;
  }

  /** 0..1 anxiety vignette (see FilmShader.uDread). */
  setDread(amount: number): void {
    this.dreadVal = Math.min(1, Math.max(0, amount));
    if (this.filmPass) this.filmPass.uniforms.uDread.value = this.dreadVal;
    if (this.bypass) this.syncCssOverlay();
  }

  /** Dying: `death` 0..1 drains the colour and closes the edges; `fade` 0..1 goes to black. */
  setDeath(death: number, fade: number): void {
    this.deathVal = death;
    this.fadeVal = fade;
    if (this.filmPass) {
      this.filmPass.uniforms.uDeath.value = death;
      this.filmPass.uniforms.uFade.value = fade;
    }
    if (this.bypass) this.syncCssOverlay();
  }

  private syncCssOverlay(): void {
    const f = Math.min(1, Math.max(0, this.fadeVal));
    const d = Math.min(1, Math.max(0, Math.max(this.dreadVal, this.deathVal)));
    const kf = Math.round(f * 50);
    const kd = Math.round(d * 50);
    const key = `${kf}:${kd}`;
    if (key === this.cssKey) return;
    this.cssKey = key;
    if (kf === 0 && kd === 0) {
      if (this.overlayEl) this.overlayEl.style.display = 'none';
      return;
    }
    if (!this.overlayEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';
      (this.renderer.gl.domElement.parentElement ?? document.body).append(el);
      this.overlayEl = el;
    }
    const edgeA = (kd / 50 * 0.85 + kf / 50).toFixed(2);
    const centerA = (kf / 50).toFixed(2);
    this.overlayEl.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,${centerA}) 38%, rgba(0,0,0,${Math.min(1, Number(edgeA)).toFixed(2)}) 100%)`;
    this.overlayEl.style.display = 'block';
  }

  render(dt: number): void {
    this.time += dt;
    this.syncToneMapping();
    if (this.bypass) {
      if (!this.worldScene || !this.worldCamera) return;
      const gl = this.renderer.gl;
      gl.setRenderTarget(null);
      gl.autoClear = true;
      gl.render(this.worldScene, this.worldCamera);
      if (this.armsOverlay) {
        gl.autoClear = false;
        gl.clearDepth();
        gl.render(this.armsOverlay.scene, this.armsOverlay.camera);
        gl.autoClear = true;
      }
      return;
    }
    this.ensureComposer();
    this.syncSize();
    this.filmPass!.uniforms.uTime.value = this.time;
    this.composer!.render(dt);
  }

  /** Follow the renderer's drawing-buffer size (CSS size × dynamic resolution scale). */
  private syncSize(): void {
    if (!this.composer || !this.filmPass) return;
    const gl = this.renderer.gl;
    gl.getDrawingBufferSize(this.size);
    const u = this.filmPass.uniforms;
    if (u.uResolution.value.equals(this.size)) return;
    u.uResolution.value.copy(this.size);
    this.composer.setPixelRatio(gl.getPixelRatio());
    this.composer.setSize(this.renderer.width, this.renderer.height);
  }

  dispose(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.composer?.dispose();
  }
}
