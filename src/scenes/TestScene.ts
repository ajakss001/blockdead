import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
} from 'three';
import { mulberry32 } from '../core/random';
import { _m1, _v1, _v2, _q1 } from '../core/scratch';
import type { GameContext } from '../GameContext';
import type { IScene } from './IScene';

const SKY = 0x8a9aa6;
const MAX_INSTANCES = 20000;
const MAX_MESHES = 500;
const ORBIT_RADIUS = 22;
const ORBIT_SPEED = 0.12; // rad/s
const EYE_HEIGHT = 1.7;

/**
 * Stage 0 benchmark scene: blocky "city" of instanced boxes, foggy sky, slow camera orbit.
 * Debug stress controls switch between triangle/fill load (instances, 1 draw call)
 * and CPU draw-call load (separate meshes).
 */
export class TestScene implements IScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.1, 200);

  private ctx!: GameContext;
  private boxes!: InstancedMesh;
  private readonly loose: Mesh[] = [];
  private boxGeo!: BoxGeometry;
  private boxMat!: MeshLambertMaterial;
  private ground!: Mesh;
  private readonly unsubs: (() => void)[] = [];

  private angle = 0;
  private prevAngle = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 10, ctx.quality.preset.fogFar);

    this.scene.add(new HemisphereLight(0xcfd8e0, 0x3a3428, 1.6));
    const sun = new DirectionalLight(0xfff1dd, 1.4);
    sun.position.set(30, 60, 20);
    this.scene.add(sun);

    this.ground = new Mesh(new PlaneGeometry(400, 400), new MeshLambertMaterial({ map: makeCheckerTexture() }));
    this.ground.rotation.x = -Math.PI / 2;
    this.scene.add(this.ground);

    this.boxGeo = new BoxGeometry(1, 1, 1);
    this.boxGeo.translate(0, 0.5, 0); // pivot at the base, so scale.y grows upward
    this.boxMat = new MeshLambertMaterial();
    this.boxes = this.buildInstances();
    this.scene.add(this.boxes);

    this.resize(ctx.renderer.width, ctx.renderer.height);
    this.unsubs.push(
      ctx.events.on('viewport:resize', ({ width, height }) => this.resize(width, height)),
      ctx.events.on('quality:changed', () => this.applyQuality()),
      ctx.events.on('debug:stress', ({ instances, meshes }) => this.setStress(instances, meshes)),
    );
    this.applyQuality();
    this.setStress(400, 0);
  }

  fixedUpdate(dt: number): void {
    this.prevAngle = this.angle;
    this.angle += ORBIT_SPEED * dt;
  }

  render(alpha: number, _frameDt: number): void {
    // Interpolate between fixed steps: smooth motion regardless of display refresh rate.
    const a = this.prevAngle + (this.angle - this.prevAngle) * alpha;
    this.camera.position.set(Math.cos(a) * ORBIT_RADIUS, EYE_HEIGHT, Math.sin(a) * ORBIT_RADIUS);
    // Look along the tangent of the orbit, slightly inward.
    this.camera.lookAt(Math.cos(a + 0.6) * ORBIT_RADIUS * 0.8, EYE_HEIGHT, Math.sin(a + 0.6) * ORBIT_RADIUS * 0.8);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.boxGeo.dispose();
    this.boxMat.dispose();
    this.boxes.dispose();
    this.ground.geometry.dispose();
    const groundMat = this.ground.material as MeshLambertMaterial;
    groundMat.map?.dispose();
    groundMat.dispose();
  }

  private buildInstances(): InstancedMesh {
    const mesh = new InstancedMesh(this.boxGeo, this.boxMat, MAX_INSTANCES);
    const rand = mulberry32(1337);
    const color = new Color();
    for (let i = 0; i < MAX_INSTANCES; i++) {
      // Fill outward in rings, so small counts stay near the camera path.
      const r = 4 + Math.sqrt(i / MAX_INSTANCES) * 140 + rand() * 3;
      const t = rand() * Math.PI * 2;
      const x = Math.round(Math.cos(t) * r);
      const z = Math.round(Math.sin(t) * r);
      const h = 1 + Math.floor(rand() * rand() * 8);
      _v1.set(x, 0, z);
      _v2.set(1, h, 1);
      _q1.identity();
      mesh.setMatrixAt(i, _m1.compose(_v1, _q1, _v2));
      const shade = 0.35 + rand() * 0.35;
      mesh.setColorAt(i, color.setRGB(shade, shade * (0.9 + rand() * 0.15), shade * 0.85, SRGBColorSpace));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    // Instances span the whole map; per-instance culling is not worth it here.
    mesh.frustumCulled = false;
    return mesh;
  }

  private setStress(instances: number, meshes: number): void {
    this.boxes.count = Math.min(instances, MAX_INSTANCES);
    const target = Math.min(meshes, MAX_MESHES);
    const rand = mulberry32(this.loose.length + 7);
    while (this.loose.length < target) {
      const m = new Mesh(this.boxGeo, this.boxMat);
      const t = rand() * Math.PI * 2;
      const r = 6 + rand() * 40;
      m.position.set(Math.cos(t) * r, 0, Math.sin(t) * r);
      m.scale.set(0.5, 0.5 + rand() * 2, 0.5);
      this.loose.push(m);
      this.scene.add(m);
    }
    for (let i = 0; i < this.loose.length; i++) this.loose[i].visible = i < target;
  }

  private applyQuality(): void {
    const far = this.ctx.quality.preset.fogFar;
    (this.scene.fog as Fog).far = far;
    this.camera.far = far + 5;
    this.camera.updateProjectionMatrix();
  }

  private resize(width: number, height: number): void {
    if (height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

function makeCheckerTexture(): CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#4c5a3a';
  g.fillRect(0, 0, size, size);
  g.fillStyle = '#56653f';
  g.fillRect(0, 0, size / 2, size / 2);
  g.fillRect(size / 2, size / 2, size / 2, size / 2);
  const tex = new CanvasTexture(canvas);
  tex.magFilter = NearestFilter;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(200, 200);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
