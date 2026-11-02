import { type Camera, HalfFloatType, type Scene, UnsignedByteType, Vector2, WebGLRenderTarget } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FilmShader } from './look/filmShader';
import type { Renderer } from './Renderer';

/**
 * Post-processing chain: world → first-person arms (depth cleared) → FilmShader to screen.
 * The scene renders into a HalfFloat target, so the near-black horror range keeps its precision
 * before grain and dither; color-space conversion happens once, in the final pass.
 */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly worldPass: RenderPass;
  private readonly armsPass: RenderPass;
  private readonly filmPass: ShaderPass;
  private readonly size = new Vector2();
  private time = 0;

  constructor(
    private readonly renderer: Renderer,
    msaaSamples: number,
  ) {
    const gl = renderer.gl;
    const floatOk = gl.capabilities.isWebGL2 && (gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float'));
    const target = new WebGLRenderTarget(1, 1, {
      type: floatOk ? HalfFloatType : UnsignedByteType,
      samples: msaaSamples,
    });
    this.composer = new EffectComposer(gl, target);

    this.worldPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    this.armsPass = new RenderPass(undefined as unknown as Scene, undefined as unknown as Camera);
    this.armsPass.clear = false;
    this.armsPass.clearDepth = true;
    this.armsPass.enabled = false;
    this.filmPass = new ShaderPass(FilmShader);

    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.armsPass);
    this.composer.addPass(this.filmPass);
    this.syncSize();
  }

  setScene(scene: Scene, camera: Camera, overlay?: { scene: Scene; camera: Camera }): void {
    this.worldPass.scene = scene;
    this.worldPass.camera = camera;
    this.armsPass.enabled = !!overlay;
    if (overlay) {
      this.armsPass.scene = overlay.scene;
      this.armsPass.camera = overlay.camera;
    }
  }

  /** The cold grade, grain and vignette on (medium / high) or off (low: the fog and the palette alone). */
  setGrade(on: boolean): void {
    this.filmPass.uniforms.uGrade.value = on ? 1 : 0;
  }

  /** 0..1 anxiety vignette (see FilmShader.uDread). */
  setDread(amount: number): void {
    this.filmPass.uniforms.uDread.value = Math.min(1, Math.max(0, amount));
  }

  /** Dying: `death` 0..1 drains the colour and closes the edges; `fade` 0..1 goes to black. */
  setDeath(death: number, fade: number): void {
    this.filmPass.uniforms.uDeath.value = death;
    this.filmPass.uniforms.uFade.value = fade;
  }

  render(dt: number): void {
    this.syncSize();
    this.time += dt;
    const u = this.filmPass.uniforms;
    u.uTime.value = this.time;
    this.composer.render(dt);
  }

  /** Follow the renderer's drawing-buffer size (CSS size × dynamic resolution scale). */
  private syncSize(): void {
    const gl = this.renderer.gl;
    gl.getDrawingBufferSize(this.size);
    const u = this.filmPass.uniforms;
    if (u.uResolution.value.equals(this.size)) return;
    u.uResolution.value.copy(this.size);
    this.composer.setPixelRatio(gl.getPixelRatio());
    this.composer.setSize(this.renderer.width, this.renderer.height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
