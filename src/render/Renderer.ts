import { type Camera, PCFShadowMap, type Scene, ShaderChunk, WebGLRenderer } from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';

let lightChunksPatched = false;

/**
 * Skip extinguished (`color == 0`) or out-of-cone lights in Three.js's unrolled fragment loops.
 * Because lights stay permanently attached in the scene to avoid shader recompiles, disabled point/spot
 * lights would otherwise execute spotLightMap texture reads, shadow lookups, and PBR BRDF on every pixel.
 */
function patchLightShaderChunks(): void {
  if (lightChunksPatched) return;
  lightChunksPatched = true;

  const pars0 = ShaderChunk.lights_pars_begin;
  const pars1 = pars0
    .replace(
      'void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {',
      'void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {\n\t\tif ( pointLight.color == vec3( 0.0 ) ) { light.color = vec3( 0.0 ); light.visible = false; return; }',
    )
    .replace(
      'void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {',
      'void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {\n\t\tif ( spotLight.color == vec3( 0.0 ) ) { light.color = vec3( 0.0 ); light.visible = false; return; }',
    );
  if (pars1 === pars0) console.warn('[Renderer] failed to patch lights_pars_begin');
  else ShaderChunk.lights_pars_begin = pars1;

  const frag0 = ShaderChunk.lights_fragment_begin;
  const frag1 = frag0
    .replace(
      'getPointLightInfo( pointLight, geometryPosition, directLight );',
      'getPointLightInfo( pointLight, geometryPosition, directLight );\n\t\tif ( directLight.visible ) {',
    )
    .replace(
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_SPOT_LIGHTS > 0 )',
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t\t}\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_SPOT_LIGHTS > 0 )',
    )
    .replace(
      'getSpotLightInfo( spotLight, geometryPosition, directLight );',
      'getSpotLightInfo( spotLight, geometryPosition, directLight );\n\t\tif ( directLight.visible ) {',
    )
    .replace(
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_SUN_LIGHTS > 0 )',
      'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n\t\t}\n\t}\n\t#pragma unroll_loop_end\n#endif\n#if ( NUM_SUN_LIGHTS > 0 )',
    );
  if (frag1 === frag0 || frag1.split('if ( directLight.visible ) {').length !== 3) {
    console.warn('[Renderer] failed to patch lights_fragment_begin');
  } else {
    ShaderChunk.lights_fragment_begin = frag1;
  }
}

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  bufferWidth: number;
  bufferHeight: number;
  pixelRatio: number;
}

/**
 * Owns the WebGL context and the drawing-buffer size.
 * Effective pixel ratio = min(devicePixelRatio, preset cap) × dynamic resolution scale.
 * info.autoReset is off so multi-pass frames (world + viewmodel, stage 1) report totals.
 */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly gpuName: string;
  width = 0;
  height = 0;

  private pixelRatioCap = 1;
  private resolutionScale = 1;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: EventBus<GameEvents>,
    antialias: boolean,
  ) {
    patchLightShaderChunks();
    this.gl = new WebGLRenderer({
      antialias,
      alpha: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.gl.info.autoReset = false;
    this.gpuName = readGpuName(this.gl);

    const canvas = this.gl.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.events.emit('gl:contextlost', {});
    });
    canvas.addEventListener('webglcontextrestored', () => this.events.emit('gl:contextrestored', {}));
    container.append(canvas);

    new ResizeObserver(() => this.applySize()).observe(container);
    this.applySize();
  }

  /** PCF filtering (three r186 dropped PCFSoftShadowMap; its PCF is already soft-edged). */
  setShadows(enabled: boolean): void {
    const sm = this.gl.shadowMap;
    sm.enabled = enabled;
    sm.type = PCFShadowMap;
  }

  setPixelRatioCap(cap: number): void {
    this.pixelRatioCap = cap;
    this.applySize();
  }

  setResolutionScale(scale: number): void {
    if (Math.abs(scale - this.resolutionScale) < 1e-3) return;
    this.resolutionScale = scale;
    this.applySize();
  }

  get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, this.pixelRatioCap) * this.resolutionScale;
  }

  beginFrame(): void {
    this.gl.info.reset();
  }

  render(scene: Scene, camera: Camera): void {
    this.gl.render(scene, camera);
  }


  stats(out: RenderStats): RenderStats {
    const info = this.gl.info;
    out.drawCalls = info.render.calls;
    out.triangles = info.render.triangles;
    out.geometries = info.memory.geometries;
    out.textures = info.memory.textures;
    out.bufferWidth = this.gl.domElement.width;
    out.bufferHeight = this.gl.domElement.height;
    out.pixelRatio = this.pixelRatio;
    return out;
  }

  private applySize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.gl.setPixelRatio(this.pixelRatio);
    // updateStyle=false: CSS keeps the canvas at 100%, only the drawing buffer changes.
    this.gl.setSize(w, h, false);
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.events.emit('viewport:resize', { width: w, height: h });
    }
  }
}

function readGpuName(renderer: WebGLRenderer): string {
  const ctx = renderer.getContext();
  const ext = ctx.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER);
  return typeof name === 'string' ? name : 'unknown';
}
