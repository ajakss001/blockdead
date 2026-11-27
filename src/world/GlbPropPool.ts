import {
  Box3,
  BoxGeometry,
  type Camera,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Frustum,
  InstancedMesh,
  type Intersection,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Raycaster,
  Sphere,
  type BufferGeometry,
  type Material,
  type Scene,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Particles } from '../render/Particles';
import {
  GLB_BASE_SCALE as BASE_SCALE,
  GLB_WORLD_SPECS,
  LOD1_WORLD_MODELS,
  lodSwitchDistOf,
  TRAFFIC_LIGHT_SCALE,
  type GlbModelId,
  type GlbPlacement,
} from './worldModels';

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
  lodReady: boolean;
  lodParts: ExtractedPart[];
  lodMeshes: (InstancedMesh | null)[];
  lodCapacities: number[];
}

interface BushSphere {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface VehicleObb {
  id: GlbModelId;
  x: number;
  y: number;
  z: number;
  cos: number;
  sin: number;
  hw: number;
  H: number;
  hl: number;
  localZ: number;
}

const _pos = new Vector3();
const _quat = new Quaternion();
const _scale = new Vector3();
const _euler = new Euler(0, 0, 0, 'YXZ');
const _instMat = new Matrix4();
const _partMat = new Matrix4();
const _frustum = new Frustum();
const _projScreen = new Matrix4();
const _sphere = new Sphere();
const _camForward = new Vector3();
const _normMat = new Matrix3();
const _raycaster = new Raycaster();
const _hitNormal = new Vector3();
const _hitPoint = new Vector3();
const _rayProbe = new Vector3();
const _rayHits: Intersection[] = [];

const nextCap = (need: number) => {
  let c = 16;
  while (c < need) c *= 2;
  return c;
};

/**
 * Streams and renders all 40 compressed world GLBs via shared-geometry 2-tier (LOD0/LOD1)
 * `InstancedMesh` batches, grounded (`Box3.min.y = 0`), frustum & distance culled,
 * with shadows disabled beyond <=50m, bush LOS occlusion & prop FX.
 */
export class GlbPropPool {
  private readonly chunks = new Map<number, GlbPlacement[]>();
  private readonly assets = new Map<GlbModelId, AssetEntry>();
  private readonly bushes: BushSphere[] = [];
  private readonly vehicles: VehicleObb[] = [];
  private readonly lightTowers: { x: number; y: number; z: number }[] = [];
  private readonly burnBarrels: { x: number; y: number; z: number }[] = [];
  private readonly heliWrecks: { x: number; y: number; z: number }[] = [];
  private readonly fuelBarrels: { key: string; x: number; y: number; z: number; r: number }[] = [];

  private readonly barrelLights: PointLight[] = [];
  private readonly towerLights: PointLight[] = [];

  private dirty = false;
  private indexesDirty = false;
  private lastRebuildX = 1e9;
  private lastRebuildZ = 1e9;
  private readonly lastRebuildDir = new Vector3(0, 0, -1);
  private lastRebuildFog = -1;
  private lastAllowShadows = true;
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
    if (placements.length === 0) {
      this.removeChunk(key);
      return;
    }
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

  /** Locate an explosive `fuel_barrel_cluster` hit by a bullet or explosion point. */
  findFuelBarrelAt(wx: number, wy: number, wz: number, margin = 0.55): { key: string; x: number; y: number; z: number } | null {
    if (this.indexesDirty) this.rebuildSpatialLists();
    let best: { key: string; x: number; y: number; z: number } | null = null;
    let bestD2 = Infinity;
    for (let i = 0; i < this.fuelBarrels.length; i++) {
      const b = this.fuelBarrels[i];
      if (wy < b.y - 0.3 || wy > b.y + 1.55) continue;
      const dx = wx - b.x;
      const dz = wz - b.z;
      const d2 = dx * dx + dz * dz;
      const lim = b.r + margin;
      if (d2 <= lim * lim && d2 < bestD2) {
        bestD2 = d2;
        best = b;
      }
    }
    return best;
  }

  /** Return all `fuel_barrel_cluster` props within `radius` (for cascading chain-reaction blasts). */
  fuelBarrelsNear(wx: number, wz: number, radius: number): { key: string; x: number; y: number; z: number }[] {
    if (this.indexesDirty) this.rebuildSpatialLists();
    const out: { key: string; x: number; y: number; z: number }[] = [];
    const r2 = radius * radius;
    for (let i = 0; i < this.fuelBarrels.length; i++) {
      const b = this.fuelBarrels[i];
      const dx = b.x - wx;
      const dz = b.z - wz;
      if (dx * dx + dz * dz <= r2) out.push(b);
    }
    return out;
  }

  /** Fast local-space OBB lookup for static GLB vehicles at world point (wx, wy, wz). */
  findVehicleAt(wx: number, wy: number, wz: number, margin = 0.25): VehicleObb | null {
    if (this.indexesDirty) this.rebuildSpatialLists();
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (wy < v.y - 0.15 || wy > v.y + v.H + 0.35) continue;
      const dx = wx - v.x;
      const dz = wz - v.z;
      const lx = dx * v.cos - dz * v.sin;
      if (Math.abs(lx) > v.hw + margin) continue;
      const lz = dx * v.sin + dz * v.cos;
      if (Math.abs(lz) > v.hl + margin) continue;
      v.localZ = lz;
      return v;
    }
    return null;
  }

  /** Accurate per-triangle raycast against the real loaded GLB vehicle mesh to fetch exact point & world normal. */
  raycastVehicle(origin: Vector3, dir: Vector3, approxDist: number): { point: Vector3; normal: Vector3; vehicle: VehicleObb } | null {
    if (this.indexesDirty) this.rebuildSpatialLists();
    _rayProbe.copy(origin).addScaledVector(dir, approxDist);
    const v = this.findVehicleAt(_rayProbe.x, _rayProbe.y, _rayProbe.z, 0.45);
    if (!v) return null;
    const entry = this.assets.get(v.id);
    if (!entry || entry.status !== 'ready') return null;

    _raycaster.set(origin, dir);
    _raycaster.near = Math.max(0, approxDist - 0.9);
    _raycaster.far = approxDist + 2.8;

    let bestDist = Infinity;
    let hasBest = false;

    const testMeshes = (list: (InstancedMesh | null)[]) => {
      for (let i = 0; i < list.length; i++) {
        const im = list[i];
        if (!im || im.count <= 0) continue;
        _rayHits.length = 0;
        _raycaster.intersectObject(im, false, _rayHits);
        for (let k = 0; k < _rayHits.length; k++) {
          const h = _rayHits[k];
          if (!h.face || h.instanceId === undefined || h.distance >= bestDist) continue;
          bestDist = h.distance;
          hasBest = true;
          _hitPoint.copy(h.point);
          im.getMatrixAt(h.instanceId, _instMat);
          _normMat.getNormalMatrix(_instMat);
          _hitNormal.copy(h.face.normal).applyMatrix3(_normMat).normalize();
          if (_hitNormal.dot(dir) > 0) _hitNormal.negate();
        }
      }
    };

    testMeshes(entry.meshes);
    if (!hasBest && entry.lodReady) testMeshes(entry.lodMeshes);
    if (!hasBest) return null;
    return { point: _hitPoint.clone(), normal: _hitNormal.clone(), vehicle: v };
  }

  update(dt: number, camPos: Vector3, paused: boolean, camera?: Camera, fogFar = 250, allowShadows = true): void {
    if (this.disposed) return;
    if (this.indexesDirty) this.rebuildSpatialLists();

    let hasFrustum = false;
    let turned = false;
    if (camera) {
      camera.updateMatrixWorld();
      _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projScreen);
      hasFrustum = true;
      camera.getWorldDirection(_camForward);
      if (_camForward.dot(this.lastRebuildDir) < 0.95) {
        turned = true;
      }
    }

    const moved = Math.hypot(camPos.x - this.lastRebuildX, camPos.z - this.lastRebuildZ);
    const envChanged = Math.abs(fogFar - this.lastRebuildFog) > 8 || allowShadows !== this.lastAllowShadows;
    if (this.dirty || moved > 4.5 || turned || envChanged) {
      if (camera) this.lastRebuildDir.copy(_camForward);
      this.rebuildInstances(camPos.x, camPos.z, hasFrustum, fogFar, allowShadows);
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

    const entry: AssetEntry = {
      status: 'loading',
      parts: [],
      meshes: [],
      capacities: [],
      lodReady: false,
      lodParts: [],
      lodMeshes: [],
      lodCapacities: [],
    };
    this.assets.set(id, entry);

    const baseUrl = typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL ? import.meta.env.BASE_URL : '/';
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const subDir = 'dir' in spec && spec.dir ? spec.dir : 'world';
    const isOptional = 'optional' in spec && spec.optional === true;

    void this.loadGltfParts(loader, `${baseUrl}models/${subDir}/${spec.file}`, id, spec, false)
      .then((parts) => {
        if (this.disposed) return;
        entry.parts = parts;
        entry.meshes = new Array(parts.length).fill(null);
        entry.capacities = new Array(parts.length).fill(0);
        entry.status = 'ready';
        this.dirty = true;
      })
      .catch((err) => {
        entry.status = 'error';
        if (!isOptional) console.warn(`[GlbPropPool] failed to load ${spec.file}:`, err);
      });

    if (LOD1_WORLD_MODELS.has(id)) {
      void this.loadGltfParts(loader, `${baseUrl}models/world/lod/${spec.file}`, id, spec, true)
        .then((parts) => {
          if (this.disposed) return;
          entry.lodParts = parts;
          entry.lodMeshes = new Array(parts.length).fill(null);
          entry.lodCapacities = new Array(parts.length).fill(0);
          entry.lodReady = true;
          this.dirty = true;
        })
        .catch(() => {
          // Optional LOD1 failure falls back cleanly to LOD0.
        });
    }
  }

  private async loadGltfParts(
    loader: GLTFLoader,
    url: string,
    id: GlbModelId,
    spec: (typeof GLB_WORLD_SPECS)[GlbModelId],
    isLod: boolean,
  ): Promise<ExtractedPart[]> {
    const gltf = await loader.loadAsync(url);
    if (this.disposed) return [];
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
      const s = TRAFFIC_LIGHT_SCALE;
      assetMat = new Matrix4()
        .makeScale(s, s, s)
        .multiply(new Matrix4().makeTranslation(0, 0, 0.25))
        .multiply(baseMat);
    } else if (BASE_SCALE[id]) {
      const [sx, sy, sz] = BASE_SCALE[id]!;
      assetMat = new Matrix4().makeScale(sx, sy, sz).multiply(baseMat);
    } else if ('dir' in spec && spec.dir === 'catastrophe') {
      // Normalize generated Meshy assets to exact world meter target dimensions, centered in XZ & grounded at y=0.
      const rawSize = box.getSize(_camForward);
      const rawMax = Math.max(0.01, rawSize.x, rawSize.y, rawSize.z);
      const targetMax = Math.max(spec.size[0], spec.size[1], spec.size[2]);
      const uScale = targetMax / rawMax;
      const clampFlat = id === 'crash_skid_trench' || id === 'road_sinkhole_crater' || id === 'collapsed_crane_boom';
      const yScale = clampFlat ? Math.min(uScale, spec.size[1] / Math.max(0.01, rawSize.y)) : uScale;
      const zScale = id === 'collapsed_crane_boom' ? Math.min(uScale, spec.size[2] / Math.max(0.01, rawSize.z)) : uScale;
      const cxOff = -(box.min.x + box.max.x) * 0.5;
      const czOff = -(box.min.z + box.max.z) * 0.5;
      assetMat = new Matrix4()
        .makeScale(uScale, yScale, zScale)
        .multiply(new Matrix4().makeTranslation(cxOff, minYOffset, czOff));
    } else if (!isLod && id === 'Sport_Sedan_22k') {
      extraGeo = new BoxGeometry(spec.size[0] * 0.58, spec.size[1] * 0.30, spec.size[2] * 0.14);
      extraMat = new MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.96, metalness: 0.05 });
      extraLocal = new Matrix4().makeTranslation(0, spec.size[1] * 0.40, spec.size[2] * 0.30);
    }

    const parts: ExtractedPart[] = [];
    let partIdx = 0;
    root.traverse((obj) => {
      const m = obj as Mesh;
      if (!m.isMesh || !m.geometry) return;
      const isolate = (mm: Material): Material => {
        const c = mm.clone();
        c.name = `${spec.file}${isLod ? '#lod1' : ''}::${mm.name || partIdx}`;
        const map = (c as MeshStandardMaterial).map;
        if (map && map.flipY) {
          map.flipY = false;
          map.needsUpdate = true;
        }
        if (spec.category === 'vehicle') c.side = DoubleSide;
        return c;
      };
      const mat = Array.isArray(m.material) ? m.material.map(isolate) : isolate(m.material);
      partIdx++;
      parts.push({
        geo: m.geometry,
        mat,
        local: assetMat.clone().multiply(m.matrixWorld),
        castShadow: !isLod && spec.castShadow,
        receiveShadow: !isLod,
      });
    });

    if (extraGeo && extraMat && extraLocal) {
      parts.push({
        geo: extraGeo,
        mat: extraMat,
        local: extraLocal,
        castShadow: !isLod && spec.castShadow,
        receiveShadow: !isLod,
      });
    }
    return parts;
  }

  private rebuildSpatialLists(): void {
    this.indexesDirty = false;
    this.bushes.length = 0;
    this.vehicles.length = 0;
    this.lightTowers.length = 0;
    this.burnBarrels.length = 0;
    this.heliWrecks.length = 0;
    this.fuelBarrels.length = 0;

    for (const list of this.chunks.values()) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const spec = GLB_WORLD_SPECS[p.id];
        if (spec?.category === 'vehicle') {
          const s = p.scale ?? 1;
          const sx = p.sx ?? s;
          const sy = p.sy ?? s;
          const sz = p.sz ?? s;
          const absRoll = Math.abs(p.roll ?? 0);
          const onSide = absRoll > 0.8 && absRoll < 2.2;
          const upsideDown = absRoll >= 2.2;
          this.vehicles.push({
            id: p.id,
            x: p.x,
            y: onSide || upsideDown ? Math.min(p.y, 0.05) : p.y,
            z: p.z,
            cos: Math.cos(-p.yaw),
            sin: Math.sin(-p.yaw),
            hw: (onSide ? spec.size[1] * sy : spec.size[0] * sx) * 0.5,
            H: onSide ? spec.size[0] * sx : spec.size[1] * sy,
            hl: spec.size[2] * 0.5 * sz,
            localZ: 0,
          });
        }
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
          case 'fuel_barrel_cluster': {
            const sc = p.scale ?? Math.max(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
            this.fuelBarrels.push({
              key: `${Math.round(p.x * 10)},${Math.round(p.z * 10)}`,
              x: p.x,
              y: p.y,
              z: p.z,
              r: 1.15 * sc,
            });
            break;
          }
        }
      }
    }
  }

  private rebuildInstances(cx: number, cz: number, hasFrustum: boolean, fogFar: number, allowShadows: boolean): void {
    this.dirty = false;
    this.lastRebuildX = cx;
    this.lastRebuildZ = cz;
    this.lastRebuildFog = fogFar;
    this.lastAllowShadows = allowShadows;

    const grouped0 = new Map<GlbModelId, GlbPlacement[]>();
    const grouped1 = new Map<GlbModelId, GlbPlacement[]>();

    for (const list of this.chunks.values()) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const spec = GLB_WORLD_SPECS[p.id];
        if (!spec) continue;
        const maxD = Math.min(spec.lodDist, fogFar + 12);
        const dx = p.x - cx;
        const dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 > maxD * maxD) continue;

        const s = p.scale ?? Math.max(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
        // Keep close shadow-casters within 22m even if off-screen, frustum-cull everything farther.
        if (hasFrustum && d2 > 22 * 22) {
          const rad = Math.max(spec.size[0], spec.size[1], spec.size[2]) * 0.75 * s + 7.0;
          _sphere.center.set(p.x, p.y + spec.size[1] * 0.5 * s, p.z);
          _sphere.radius = rad;
          if (!_frustum.intersectsSphere(_sphere)) continue;
        }

        const entry = this.assets.get(p.id);
        const switchD = lodSwitchDistOf(p.id);
        const useLod1 = !!entry?.lodReady && d2 > switchD * switchD;
        const targetMap = useLod1 ? grouped1 : grouped0;
        let bucket = targetMap.get(p.id);
        if (!bucket) {
          bucket = [];
          targetMap.set(p.id, bucket);
        }
        bucket.push(p);
      }
    }

    for (const [id, entry] of this.assets) {
      if (entry.status !== 'ready' || entry.parts.length === 0) continue;
      this.writePartBatch(entry.parts, entry.meshes, entry.capacities, grouped0.get(id), false, allowShadows);
      if (entry.lodReady && entry.lodParts.length > 0) {
        this.writePartBatch(entry.lodParts, entry.lodMeshes, entry.lodCapacities, grouped1.get(id), true, allowShadows);
      }
    }
  }

  private writePartBatch(
    parts: ExtractedPart[],
    meshes: (InstancedMesh | null)[],
    capacities: number[],
    list: GlbPlacement[] | undefined,
    forceNoShadow: boolean,
    allowShadows: boolean,
  ): void {
    const count = list ? list.length : 0;
    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      const wantShadow = allowShadows && !forceNoShadow && part.castShadow;
      let im = meshes[pi];
      if (count === 0) {
        if (im) im.count = 0;
        continue;
      }
      if (!im || count > capacities[pi]) {
        const cap = nextCap(count);
        if (im) {
          this.scene.remove(im);
          im.dispose();
        }
        im = new InstancedMesh(part.geo, part.mat, cap);
        im.instanceMatrix.setUsage(DynamicDrawUsage);
        im.frustumCulled = false;
        im.castShadow = wantShadow;
        im.receiveShadow = part.receiveShadow;
        this.scene.add(im);
        meshes[pi] = im;
        capacities[pi] = cap;
      } else if (im.castShadow !== wantShadow) {
        im.castShadow = wantShadow;
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

  private updateEffects(camPos: Vector3, paused: boolean): void {
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

  private disposeParts(parts: ExtractedPart[], meshes: (InstancedMesh | null)[]): void {
    for (const im of meshes) {
      if (im) {
        im.removeFromParent();
        im.dispose();
      }
    }
    for (const part of parts) {
      part.geo.dispose();
      if (Array.isArray(part.mat)) part.mat.forEach((mm) => mm.dispose());
      else part.mat.dispose();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const l of this.barrelLights) l.removeFromParent();
    for (const l of this.towerLights) l.removeFromParent();
    for (const entry of this.assets.values()) {
      this.disposeParts(entry.parts, entry.meshes);
      this.disposeParts(entry.lodParts, entry.lodMeshes);
    }
    this.assets.clear();
    this.chunks.clear();
  }
}
