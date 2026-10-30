import { BoxGeometry, Color, DynamicDrawUsage, type Fog, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, type Scene, Vector3 } from 'three';
import { CHUNK, type WorldLayout } from '../world/gen/layout';
import { POI_LANDMARKS, siteToWorld } from '../world/gen/poi';

const CAP = 64;
/** Landmarks show from this far (blocks round the player) … */
const REACH = 8;
const MAX_DIST = 520;

interface Shape {
  /** The site's centre (scale and haze go by it, so a shape keeps its proportions). */
  sx: number;
  sz: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();
const _fog = new Color();

/**
 * Distant silhouettes of the big places — a hypermarket's sign on its pylon, a mall's tower, a water
 * tower, a watchtower — so the player sees them over the roofs and wants to go there. The world beyond
 * the fog isn't loaded, so each landmark is drawn as a scaled-down copy just inside the fog (same angle
 * on screen, hidden behind anything nearer), darker than the haze and fading with distance. One draw call.
 */
export class Landmarks {
  readonly mesh: InstancedMesh;
  private shapes: Shape[] = [];
  private scanT = 0;
  private lastI = 1e9;
  private lastJ = 1e9;

  constructor(
    scene: Scene,
    private readonly layout: WorldLayout,
  ) {
    const mat = new MeshBasicMaterial({ fog: false });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, CAP);
    this.mesh.name = 'landmarks';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0));
    scene.add(this.mesh);
  }

  update(dt: number, eye: Vector3, fog: Fog): void {
    const ci = Math.floor(eye.x / CHUNK);
    const cj = Math.floor(eye.z / CHUNK);
    this.scanT -= dt;
    if (this.scanT <= 0 || Math.abs(ci - this.lastI) + Math.abs(cj - this.lastJ) > 1) this.scan(ci, cj);
    const near = fog.far * 0.92;
    const at = fog.far * 0.88;
    _fog.copy(fog.color);
    let n = 0;
    for (const s of this.shapes) {
      if (n >= CAP) break;
      const dx = s.sx - eye.x;
      const dz = s.sz - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist < near || dist > MAX_DIST) continue;
      const k = at / dist;
      _p.set(eye.x + (s.x - eye.x) * k, eye.y + (s.y - eye.y) * k, eye.z + (s.z - eye.z) * k);
      _m.compose(_p, _q.identity(), _s.set(s.w * k, s.h * k, s.d * k));
      this.mesh.setMatrixAt(n, _m);
      // Darker than the haze, fading into it with distance.
      const haze = 0.2 + 0.6 * (dist / MAX_DIST);
      _c.copy(_fog).multiplyScalar(0.55).lerp(_fog, haze);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    if (n) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** The landmark boxes of every place within reach (world space). */
  private scan(ci: number, cj: number): void {
    this.scanT = 2;
    this.lastI = ci;
    this.lastJ = cj;
    this.shapes = [];
    for (let i = ci - REACH; i <= ci + REACH; i++) {
      for (let j = cj - REACH; j <= cj + REACH; j++) {
        const site = this.layout.poi(i, j);
        const list = site && POI_LANDMARKS[site.kind];
        if (!site || !list) continue;
        const [sx, sz] = siteToWorld(site, 0, 0);
        const odd = site.r & 1;
        for (const [lx, ly, lz, w, h, d] of list) {
          const [x, z] = siteToWorld(site, lx, lz);
          this.shapes.push({ sx, sz, x, y: ly, z, w: odd ? d : w, h, d: odd ? w : d });
        }
      }
    }
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
