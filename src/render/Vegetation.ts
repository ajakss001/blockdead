import {
  type Camera,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paintAtlas } from './vegetation/atlas';
import { buildModels, type PlantModel, type Species, SPECIES, VARIANTS } from './vegetation/models';

/** One plant in the world. */
export interface Plant {
  species: Species;
  /** Any number: the variant is picked from it (fewer variants on weak phones). */
  pick: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

/** Level-of-detail distances (m) and how many cards stay (share 0..1), how many variants a species shows. */
export interface VegetationLod {
  /** Full crown nearer than this; fewer cards up to `mid`; an impostor up to the fog. */
  near: number;
  mid: number;
  fullKeep: number;
  midKeep: number;
  variants: number;
}

const IMP_GRID = 8;
const IMP_SIZE = 1024;
const IMP_CAP = 1024;
const CAP = 400;

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

/**
 * Trees, bushes and hedges: real foliage from cards of leaf sprigs round the branches, bark tubes, one
 * atlas and one material (alpha-tested, double-sided, alpha-to-coverage with MSAA). Each species variant is
 * an InstancedMesh (built once at load, never per plant); in the distance a plant drops cards (the shader
 * collapses those ranked above its level), far off it is an impostor — two crossed cards with the plant
 * baked into a texture at load (one InstancedMesh for all). Wind in the vertex shader: the trunk barely
 * moves, the branches sway slowly, the leaves flutter; the crown is lit by spherical normals and glows a
 * little when the sun is behind it.
 */
export class Vegetation {
  private readonly models: PlantModel[];
  private readonly meshes: InstancedMesh[] = [];
  private readonly lodAttrs: InstancedBufferAttribute[] = [];
  private readonly impostor: InstancedMesh;
  private readonly impTile: InstancedBufferAttribute;
  private readonly material: MeshLambertMaterial;
  private readonly impMaterial: MeshLambertMaterial;
  private readonly rt: WebGLRenderTarget;
  private readonly uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.3 },
    uSunView: { value: new Vector3(0, 1, 0) },
    uSunColor: { value: new Color(0, 0, 0) },
  };
  private plants: Plant[] = [];
  private lod: VegetationLod = { near: 12, mid: 30, fullKeep: 0.8, midKeep: 0.38, variants: 2 };
  private last = new Vector3(1e9, 0, 1e9);
  private dirty = true;
  private far = 50;
  private baked = false;
  /** First model index of each species. */
  private readonly first = new Map<Species, number>();

  constructor(private readonly scene: Scene) {
    this.models = buildModels();
    const tex = new CanvasTexture(paintAtlas());
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 4;
    this.material = new MeshLambertMaterial({ map: tex, alphaTest: 0.45, side: DoubleSide, vertexColors: true });
    this.material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aWind;\nattribute float aKeep;\nattribute float aLod;\nuniform float uTime;\nuniform float uWind;\nvarying float vLeaf;')
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
vLeaf = aWind.y;
if (aKeep > aLod) transformed = vec3(0.0);
else {
  // Trunk still, branches sway slowly, leaves flutter fast and small.
  float ph = aWind.z + instanceMatrix[3].x * 0.13 + instanceMatrix[3].z * 0.17;
  float w = 0.03 + 0.17 * uWind;
  transformed.x += sin(uTime * 0.8 + ph) * w * aWind.x;
  transformed.z += sin(uTime * 0.63 + ph * 1.3) * w * 0.7 * aWind.x;
  transformed += objectNormal * sin(uTime * 8.0 + ph * 11.0 + position.y * 4.0) * (0.01 + 0.035 * uWind) * aWind.y;
}`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSunView;\nuniform vec3 uSunColor;\nvarying float vLeaf;')
        .replace(
          '#include <opaque_fragment>',
          `// Light through the leaves when the sun is behind them.
outgoingLight += diffuseColor.rgb * uSunColor * vLeaf * 0.45 * pow(max(0.0, dot(normalize(-vViewPosition), uSunView)), 3.0);
#include <opaque_fragment>`,
        );
    };
    this.material.customProgramCacheKey = () => 'vegetation';
    SPECIES.forEach((sp) => this.first.set(sp, this.models.findIndex((m) => m.species === sp)));
    for (const m of this.models) {
      const lodAttr = new InstancedBufferAttribute(new Float32Array(CAP), 1);
      lodAttr.setUsage(DynamicDrawUsage);
      m.geometry.setAttribute('aLod', lodAttr);
      const mesh = new InstancedMesh(m.geometry, this.material, CAP);
      mesh.name = `veg:${m.species}${m.variant}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      scene.add(mesh);
      this.meshes.push(mesh);
      this.lodAttrs.push(lodAttr);
    }
    // Impostors: two crossed cards, the bottom at the root, UVs into the baked atlas tile.
    this.rt = new WebGLRenderTarget(IMP_SIZE, IMP_SIZE, { generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    this.rt.texture.colorSpace = SRGBColorSpace;
    const a = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const cross = mergeGeometries([a, b])!;
    for (let i = 0; i < cross.getAttribute('normal').count; i++) cross.getAttribute('normal').setXYZ(i, 0, 1, 0);
    this.impTile = new InstancedBufferAttribute(new Float32Array(IMP_CAP), 1);
    this.impTile.setUsage(DynamicDrawUsage);
    cross.setAttribute('aTile', this.impTile);
    this.impMaterial = new MeshLambertMaterial({ map: this.rt.texture, alphaTest: 0.5, side: DoubleSide });
    this.impMaterial.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nattribute float aTile;\nuniform float uTime;\nuniform float uWind;`)
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
vMapUv = (vec2(mod(aTile, ${IMP_GRID}.0), floor(aTile / ${IMP_GRID}.0)) + uv) / ${IMP_GRID}.0;`,
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(uTime * 0.8 + instanceMatrix[3].x * 0.13) * (0.02 + 0.06 * uWind) * position.y * position.y;');
    };
    this.impMaterial.customProgramCacheKey = () => 'vegetation-impostor';
    this.impostor = new InstancedMesh(cross, this.impMaterial, IMP_CAP);
    this.impostor.name = 'veg:impostors';
    this.impostor.count = 0;
    this.impostor.frustumCulled = false;
    this.impostor.instanceMatrix.setUsage(DynamicDrawUsage);
    scene.add(this.impostor);
    a.dispose();
    b.dispose();
  }

  /** Quality preset: distances, cards kept, variants per species; alpha-to-coverage with MSAA. */
  configure(lod: VegetationLod, msaa: boolean): void {
    this.lod = lod;
    this.material.alphaToCoverage = msaa;
    this.impMaterial.alphaToCoverage = msaa;
    this.material.needsUpdate = true;
    this.impMaterial.needsUpdate = true;
    this.dirty = true;
  }

  setPlants(list: Plant[]): void {
    this.plants = list;
    this.dirty = true;
  }

  /**
   * Bake every model into its impostor tile: an orthographic front view, albedo with soft top light, the
   * background transparent. Once, at load.
   */
  bake(renderer: WebGLRenderer): void {
    if (this.baked) return;
    this.baked = true;
    const bakeScene = new Scene();
    const mat = new ShaderMaterial({
      uniforms: { map: { value: this.material.map } },
      vertexShader: /* glsl */ `
attribute float aKeep;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vN;
void main() {
  vUv = uv;
  vColor = color;
  vN = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vN;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  float shade = 0.62 + 0.38 * clamp(vN.y * 0.6 + vN.z * 0.4, 0.0, 1.0);
  gl_FragColor = vec4(t.rgb * vColor * shade, 1.0);
  #include <colorspace_fragment>
}`,
      vertexColors: true,
      side: DoubleSide,
    });
    const cam = new OrthographicCamera(-1, 1, 1, 0, 0.1, 100);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0x000000, 0);
    this.rt.scissorTest = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    const cell = IMP_SIZE / IMP_GRID;
    this.models.forEach((m, k) => {
      const mesh = new Mesh(m.geometry, mat);
      bakeScene.add(mesh);
      cam.left = -m.radius;
      cam.right = m.radius;
      cam.top = m.height;
      cam.bottom = 0;
      cam.position.set(0, 0, 40);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      const x = (k % IMP_GRID) * cell;
      const y = Math.floor(k / IMP_GRID) * cell;
      // The target's own viewport and scissor: one tile.
      this.rt.viewport.set(x, y, cell, cell);
      this.rt.scissor.set(x, y, cell, cell);
      this.rt.scissorTest = true;
      renderer.setRenderTarget(this.rt);
      renderer.render(bakeScene, cam);
      bakeScene.remove(mesh);
    });
    this.rt.viewport.set(0, 0, IMP_SIZE, IMP_SIZE);
    this.rt.scissorTest = false;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    mat.dispose();
  }

  /** Frame update: wind, the sun for the glow through leaves, which plant gets which level of detail. */
  update(time: number, gust: number, camera: Camera, eye: Vector3, sunDir: Vector3, sunColor: Color, fogFar: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uWind.value = gust;
    this.uniforms.uSunView.value.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    this.uniforms.uSunColor.value.copy(sunColor);
    if (fogFar !== this.far) {
      this.far = fogFar;
      this.dirty = true;
    }
    if (!this.dirty && Math.hypot(eye.x - this.last.x, eye.z - this.last.z) < 2) return;
    this.dirty = false;
    this.last.copy(eye);
    const counts = new Array(this.meshes.length).fill(0);
    let imp = 0;
    const L = this.lod;
    for (const p of this.plants) {
      const d = Math.hypot(p.x - eye.x, p.z - eye.z);
      if (d > this.far + 6) continue;
      const nv = Math.min(L.variants, VARIANTS[p.species]);
      const k = this.first.get(p.species)! + (Math.floor(Math.abs(p.pick) * 1000) % nv);
      const model = this.models[k];
      _q.setFromEuler(_e.set(0, p.yaw, 0));
      if (d > L.mid) {
        if (imp >= IMP_CAP) continue;
        // The impostor faces nothing in particular (crossed); its size from the model's box.
        _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(model.radius * 2 * p.scale, model.height * p.scale, model.radius * 2 * p.scale));
        this.impostor.setMatrixAt(imp, _m);
        this.impTile.setX(imp, k);
        imp++;
        continue;
      }
      const n = counts[k];
      if (n >= CAP) continue;
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.setScalar(p.scale));
      this.meshes[k].setMatrixAt(n, _m);
      this.lodAttrs[k].setX(n, d < L.near ? L.fullKeep : L.midKeep);
      counts[k] = n + 1;
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      if (counts[k]) {
        mesh.instanceMatrix.needsUpdate = true;
        this.lodAttrs[k].needsUpdate = true;
      }
    });
    this.impostor.count = imp;
    if (imp) {
      this.impostor.instanceMatrix.needsUpdate = true;
      this.impTile.needsUpdate = true;
    }
  }

  /** Programs compile during the loading-screen prewarm. */
  prewarm(): void {
    for (const m of this.meshes) m.count = Math.max(1, m.count);
    this.impostor.count = Math.max(1, this.impostor.count);
    this.dirty = true;
  }

  dispose(): void {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.scene.remove(this.impostor);
    this.impostor.geometry.dispose();
    this.material.map?.dispose();
    this.material.dispose();
    this.impMaterial.dispose();
    this.rt.dispose();
  }
}
