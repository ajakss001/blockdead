import {
  Box3,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  type BufferGeometry,
  type Material,
  type Scene,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Particles } from '../render/Particles';
import { GLB_WORLD_SPECS, type GlbModelId, type GlbPlacement } from './worldModels';

interface ExtractedPart {
  geo: BufferGeometry;
  mat: Material | Material[];
  local: Matrix4;
  castShadow: boolean;
  receiveShadow: boolean;
}

interface AssetEntry {
  status: 'loading' | 'ready' | 'error';
  parts: ExtractedPart[];
  meshes: (InstancedMesh | null)[];
  capacities: number[];
}

interface BushSphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');
const _instMat = new Matrix4();
const _partMat = new Matrix4();

const nextCap = (need: number) => {
  let c = 8;
  while (c < need) c *= 2;
  return c;
};

/**
 * Streams and renders all 40 compressed world GLBs via shared-geometry `InstancedMesh` batches,
 * grounded (`Box3.min.y = 0`), distance-culled (`lodDist`), with bush LOS occlusion & prop FX.
 */
export class GlbPropPool {
  private readonly chunks = new Map<number, GlbPlacement[]>();
  private readonly assets = new Map<GlbModelId, AssetEntry>();
  private readonly bushes: BushSphere[] = [];
  private readonly lightTowers: { x: number; y: number; z: number }[] = [];
  private readonly burnBarrels: { x: number; y: number; z: number }[] = [];
  private readonly heliWrecks: { x: number; y: number; z: number }[] = [];

  private readonly barrelLights: PointLight[] = [];
  private readonly towerLights: PointLight[] = [];

  private dirty = false;
  private indexesDirty = false;
  private lastRebuildX = 1e9;
  private lastRebuildZ = 1e9;
  private time = 0;
  private fxTimer = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly particles?: Particles | null,
  ) {
    for (let i = 0; i < 4; i++) {
      const l = new PointLight(0xff7728, 0, 12, 1.8);
      l.castShadow = false;
      this.scene.add(l);
      this.barrelLights.push(l);
    }
    for (let i = 0; i < 2; i++) {
      const l = new PointLight(0xfff0cc, 0, 26, 1.5);
      l.castShadow = false;
      this.scene.add(l);
      this.towerLights.push(l);
    }
  }

  get placementCount(): number {
    let n = 0;
    for (const list of this.chunks.values()) n += list.length;
    return n;
  }

  addChunk(key: number, placements: GlbPlacement[]): void {
    this.chunks.set(key, placements);
    for (let i = 0; i < placements.length; i++) {
      this.ensureModel(placements[i].id);
    }
    this.dirty = true;
    this.indexesDirty = true;
  }

  removeChunk(key: number): void {
    if (!this.chunks.delete(key)) return;
    this.dirty = true;
    this.indexesDirty = true;
  }

  /** Fast line-of-sight check against active `Urban_Bush_2500` foliage spheres. */
  bushOccludes(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    if (this.indexesDirty) this.rebuildSpatialLists();
    const vx = tx - ox;
    const vy = ty - oy;
    const vz = tz - oz;
    const len2 = vx * vx + vy * vy + vz * vz;
    if (len2 < 1e-4) return false;
    for (let i = 0; i < this.bushes.length; i++) {
      const b = this.bushes[i];
      const wx = b.x - ox;
      const wy = b.y - oy;
      const wz = b.z - oz;
      let t = (wx * vx + wy * vy + wz * vz) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = ox + vx * t - b.x;
      const dy = oy + vy * t - b.y;
      const dz = oz + vz * t - b.z;
      if (dx * dx + dy * dy + dz * dz <= b.r * b.r) return true;
    }
    return false;
  }

  update(dt: number, camPos: Vector3, paused: boolean): void {
    if (this.disposed) return;
    if (this.indexesDirty) this.rebuildSpatialLists();

    const moved = Math.hypot(camPos.x - this.lastRebuildX, camPos.z - this.lastRebuildZ);
    if (this.dirty || moved > 4.5) {
      this.rebuildInstances(camPos.x, camPos.z);
    }

    if (!paused) {
      this.time += dt;
      this.fxTimer += dt;
    }
    this.updateEffects(camPos, paused);
  }

  private ensureModel(id: GlbModelId): void {
    if (this.assets.has(id) || this.disposed) return;
    const spec = GLB_WORLD_SPECS[id];
    if (!spec) return;
    if (typeof fetch !== 'function' || typeof window === 'undefined') return;

    const entry: AssetEntry = { status: 'loading', parts: [], meshes: [], capacities: [] };
    this.assets.set(id, entry);

    const baseUrl = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    void loader
      .loadAsync(`${baseUrl}models/world/${spec.file}`)
      .then((gltf) => {
        if (this.disposed) return;
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const box = new Box3().setFromObject(root);
        const minYOffset = Number.isFinite(box.min.y) ? -box.min.y : 0;
        const baseMat = new Matrix4().makeTranslation(0, minYOffset, 0);
        let assetMat = baseMat;

        let extraGeo: BufferGeometry | null = null;
        let extraMat: Material | null = null;
        let extraLocal: Matrix4 | null = null;

        if (id === 'street_lamp_2000') {
          // Shift pole center (+1.035 X in GLB) to local origin so the arm points along -X.
          assetMat = new Matrix4().makeTranslation(-1.035, 0, 0).multiply(baseMat);
        } else if (spec.category === 'sign') {
          const s = 0.68 / spec.size[0];
          const lift = Math.max(0, 2.72 - spec.size[1] * s);
          assetMat = new Matrix4()
            .makeTranslation(0, lift, 0)
            .multiply(new Matrix4().makeScale(s, s, s))
            .multiply(baseMat);
          const poleH = lift + 0.18;
          extraGeo = new CylinderGeometry(0.032, 0.032, poleH, 8);
          extraMat = new MeshStandardMaterial({ color: 0x5c6066, roughness: 0.78, metalness: 0.35 });
          extraLocal = new Matrix4().makeTranslation(0, poleH * 0.5, 0);
        } else if (id === 'traffic_light_2500') {
          const s = 0.56;
          const lift = 0.95;
          assetMat = new Matrix4()
            .makeTranslation(0, lift, 0)
            .multiply(new Matrix4().makeScale(s, s, s))
            .multiply(baseMat);
          const poleH = lift + 0.2;
          extraGeo = new CylinderGeometry(0.06, 0.075, poleH, 8);
          extraMat = new MeshStandardMaterial({ color: 0x4c5056, roughness: 0.75, metalness: 0.4 });
          extraLocal = new Matrix4().makeTranslation(0, poleH * 0.5, 0);
        } else if (id === 'Sport_Sedan_22k') {
          extraGeo = new BoxGeometry(spec.size[0] * 0.76, spec.size[1] * 0.60, spec.size[2] * 0.78);
          extraMat = new MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.96, metalness: 0.05 });
          extraLocal = new Matrix4().makeTranslation(0, spec.size[1] * 0.44, 0);
        }

        root.traverse((obj) => {
          const m = obj as Mesh;
          if (!m.isMesh || !m.geometry) return;
          if (spec.category === 'vehicle') {
            if (Array.isArray(m.material)) {
              for (const mm of m.material) mm.side = DoubleSide;
            } else if (m.material) {
              m.material.side = DoubleSide;
            }
          }
          const local = assetMat.clone().multiply(m.matrixWorld);
          entry.parts.push({
            geo: m.geometry,
            mat: m.material,
            local,
            castShadow: spec.castShadow,
            receiveShadow: true,
          });
          entry.meshes.push(null);
          entry.capacities.push(0);
        });
        if (extraGeo && extraMat && extraLocal) {
          entry.parts.push({
            geo: extraGeo,
            mat: extraMat,
            local: extraLocal,
            castShadow: spec.castShadow,
            receiveShadow: true,
          });
          entry.meshes.push(null);
          entry.capacities.push(0);
        }
        entry.status = 'ready';
        this.dirty = true;
      })
      .catch((err) => {
        entry.status = 'error';
        console.warn(`[GlbPropPool] failed to load ${spec.file}:`, err);
      });
  }

  private rebuildSpatialLists(): void {
    this.indexesDirty = false;
    this.bushes.length = 0;
    this.lightTowers.length = 0;
    this.burnBarrels.length = 0;
    this.heliWrecks.length = 0;

    for (const list of this.chunks.values()) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        switch (p.id) {
          case 'Urban_Bush_2500': {
            const sc = p.scale ?? Math.max(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
            this.bushes.push({ x: p.x, y: p.y + 0.72 * sc, z: p.z, r: 1.05 * sc });
            break;
          }
          case 'generator_light_tower':
            this.lightTowers.push({ x: p.x, y: p.y, z: p.z });
            break;
          case 'burn_barrel':
            this.burnBarrels.push({ x: p.x, y: p.y, z: p.z });
            break;
          case 'mi8_wreck_remesh':
            this.heliWrecks.push({ x: p.x, y: p.y, z: p.z });
            break;
        }
      }
    }
  }

  private rebuildInstances(cx: number, cz: number): void {
    this.dirty = false;
    this.lastRebuildX = cx;
    this.lastRebuildZ = cz;

    const grouped = new Map<GlbModelId, GlbPlacement[]>();
    for (const list of this.chunks.values()) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const spec = GLB_WORLD_SPECS[p.id];
        if (!spec) continue;
        const maxD = spec.lodDist;
        const dx = p.x - cx;
        const dz = p.z - cz;
        if (dx * dx + dz * dz > maxD * maxD) continue;
        let bucket = grouped.get(p.id);
        if (!bucket) {
          bucket = [];
          grouped.set(p.id, bucket);
        }
        bucket.push(p);
      }
    }

    for (const [id, entry] of this.assets) {
      if (entry.status !== 'ready' || entry.parts.length === 0) continue;
      const list = grouped.get(id);
      const count = list ? list.length : 0;

      for (let pi = 0; pi < entry.parts.length; pi++) {
        const part = entry.parts[pi];
        let im = entry.meshes[pi];
        if (count === 0) {
          if (im) im.count = 0;
          continue;
        }
        if (!im || count > entry.capacities[pi]) {
          const cap = nextCap(count);
          if (im) {
            this.scene.remove(im);
            im.dispose();
          }
          im = new InstancedMesh(part.geo, part.mat, cap);
          im.instanceMatrix.setUsage(DynamicDrawUsage);
          im.frustumCulled = false;
          im.castShadow = part.castShadow;
          im.receiveShadow = part.receiveShadow;
          this.scene.add(im);
          entry.meshes[pi] = im;
          entry.capacities[pi] = cap;
        }
        for (let k = 0; k < count; k++) {
          const p = list![k];
          const s = p.scale ?? 1;
          _pos.set(p.x, p.y, p.z);
          _euler.set(p.pitch ?? 0, p.yaw, p.roll ?? 0, 'YXZ');
          _quat.setFromEuler(_euler);
          _scale.set(p.sx ?? s, p.sy ?? s, p.sz ?? s);
          _instMat.compose(_pos, _quat, _scale);
          _partMat.multiplyMatrices(_instMat, part.local);
          im.setMatrixAt(k, _partMat);
        }
        im.count = count;
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  private updateEffects(camPos: Vector3, paused: boolean): void {
    // 1. Burn barrel flickering point lights + sparks/smoke
    let bi = 0;
    for (let i = 0; i < this.burnBarrels.length && bi < this.barrelLights.length; i++) {
      const b = this.burnBarrels[i];
      if ((b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2 > 42 * 42) continue;
      const l = this.barrelLights[bi++];
      l.position.set(b.x, b.y + 1.15, b.z);
      l.intensity = 2.6 + Math.sin(this.time * 17.3 + i * 2.1) * 0.7 + Math.cos(this.time * 29.1 + i) * 0.35;
      if (!paused && this.particles && this.fxTimer >= 0.16 && Math.random() < 0.45) {
        this.particles.sparks(b.x, b.y + 0.98, b.z, 1);
      }
    }
    for (; bi < this.barrelLights.length; bi++) this.barrelLights[bi].intensity = 0;

    // 2. Generator light tower warm floodlight glow
    let ti = 0;
    for (let i = 0; i < this.lightTowers.length && ti < this.towerLights.length; i++) {
      const t = this.lightTowers[i];
      if ((t.x - camPos.x) ** 2 + (t.z - camPos.z) ** 2 > 55 * 55) continue;
      const l = this.towerLights[ti++];
      l.position.set(t.x, t.y + 3.9, t.z);
      l.intensity = 3.2;
    }
    for (; ti < this.towerLights.length; ti++) this.towerLights[ti].intensity = 0;

    if (this.fxTimer >= 0.16) {
      this.fxTimer = 0;
      if (!paused && this.particles) {
        for (let i = 0; i < this.heliWrecks.length; i++) {
          const w = this.heliWrecks[i];
          if ((w.x - camPos.x) ** 2 + (w.z - camPos.z) ** 2 > 80 * 80) continue;
          if (Math.random() < 0.5) {
            this.particles.smoke(w.x, w.y + 1.4, w.z);
          }
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.barrelLights) l.removeFromParent();
    for (const l of this.towerLights) l.removeFromParent();
    for (const entry of this.assets.values()) {
      for (const im of entry.meshes) {
        if (im) {
          im.removeFromParent();
          im.dispose();
        }
      }
      for (const part of entry.parts) {
        part.geo.dispose();
        if (Array.isArray(part.mat)) part.mat.forEach((mm) => mm.dispose());
        else part.mat.dispose();
      }
    }
    this.assets.clear();
    this.chunks.clear();
  }
}
