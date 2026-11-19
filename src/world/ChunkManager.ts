import type { Group, Mesh, Scene } from 'three';
import { getLang } from '../core/i18n';
import { disposeBatchGroup, meshesFromBuffers } from '../render/batchMeshes';
import { worldMaterials } from '../render/look/worldMaterials';
import type { CollisionWorld } from './CollisionWorld';
import type { ChunkData, InteriorData } from './gen/buildChunk';
import type { BodyMode } from './gen/chaos';
import type { WorkerRequest, WorkerResponse } from './gen/chunkWorker';
import type { BuildingDesc } from './gen/highrise';
import { CHUNK, type WorldLayout, type Zone } from './gen/layout';

interface LoadedChunk {
  group: Group;
  zone: Zone;
}

export interface CutBox {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Max chunks turned into GPU meshes per frame: buffer upload is the main-thread cost. */
const APPLY_PER_FRAME = 1;
/** Requests in flight per worker. */
const QUEUE_PER_WORKER = 2;

const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/**
 * Streams the world around the player: requests missing chunks from a small worker pool
 * (nearest first, biased towards where the camera looks), uploads at most one finished chunk
 * per frame, unloads chunks beyond radius + 1 (hysteresis, so walking along an edge doesn't thrash).
 * Manages per-subcell shadow casting reach, car LOD1 switching, and window cutouts.
 */
export class ChunkManager {
  radius: number;
  lastGenMs = 0;
  /** Gameplay hooks: containers etc. come and go with their chunk. */
  onChunkLoaded?: (key: number, data: ChunkData) => void;
  onChunkUnloaded?: (key: number) => void;
  /** A streamed high-rise interior arrived (see Interiors). */
  onInterior?: (data: InteriorData) => void;

  private readonly loaded = new Map<number, LoadedChunk>();
  /** Chunks whose opaque mesh uses the window-cutting material, with a count of buildings asking. */
  private readonly cutRefs = new Map<number, number>();
  private cutBoxes: CutBox[] = [];
  private readonly pending = new Set<number>();
  private readonly ready: WorkerResponse[] = [];
  private readonly workers: Worker[] = [];
  private readonly inFlight: number[] = [];
  private readonly waiters: { i: number; j: number; r: number; resolve: () => void }[] = [];

  private detailX = 0;
  private detailZ = 0;
  private lastShadowDist = -1;
  private lastCarLodDist = -1;
  private detailDirty = false;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    readonly layout: WorldLayout,
    radius: number,
    maxWorkers = 2,
  ) {
    this.radius = radius;
    const count = Math.max(1, Math.min(maxWorkers, (navigator.hardwareConcurrency || 2) - 1));
    for (let n = 0; n < count; n++) {
      const w = new Worker(new URL('./gen/chunkWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        this.inFlight[n]--;
        this.ready.push(e.data);
      };
      w.onerror = (e) => console.error('[chunks] worker error', e.message);
      this.workers.push(w);
      this.inFlight.push(0);
    }
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  zoneAt(x: number, z: number): Zone {
    return this.layout.zone(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
  }

  /** Resolves once every chunk within `r` of (x, z) is loaded. Drive update() meanwhile. */
  whenLoaded(x: number, z: number, r = 1): Promise<void> {
    return new Promise((resolve) => this.waiters.push({ i: Math.floor(x / CHUNK), j: Math.floor(z / CHUNK), r, resolve }));
  }

  /** Call once per frame with the camera position and horizontal look direction. */
  update(x: number, z: number, dirX: number, dirZ: number): void {
    const ci = Math.floor(x / CHUNK);
    const cj = Math.floor(z / CHUNK);
    this.request(ci, cj, x, z, dirX, dirZ);

    for (let n = 0; n < APPLY_PER_FRAME && this.ready.length > 0; n++) {
      const msg = this.ready.shift()!;
      if (msg.type === 'chunk') this.apply(msg);
      else this.onInterior?.(msg);
    }

    const keep = this.radius + 1;
    for (const [k, chunk] of this.loaded) {
      const i = Math.floor(k / 65536) - 32768;
      const j = (k % 65536) - 32768;
      if (Math.abs(i - ci) > keep || Math.abs(j - cj) > keep) {
        disposeBatchGroup(chunk.group);
        this.world.removeOwner(k);
        this.loaded.delete(k);
        this.onChunkUnloaded?.(k);
      }
    }

    for (let w = this.waiters.length - 1; w >= 0; w--) {
      const q = this.waiters[w];
      if (this.allLoaded(q.i, q.j, q.r)) {
        this.waiters.splice(w, 1);
        q.resolve();
      }
    }
  }

  /**
   * Update per-subcell shadow casting reach (`shadowDist`) and distant vehicle LOD (`carLodDist`).
   * Runs only when the player moves >= 2 m, quality changes, or a new chunk streams in.
   */
  updateDetail(x: number, z: number, shadowDist: number, carLodDist: number): void {
    const moved = Math.hypot(x - this.detailX, z - this.detailZ) >= 2;
    const changed = shadowDist !== this.lastShadowDist || carLodDist !== this.lastCarLodDist;
    if (!moved && !changed && !this.detailDirty) return;
    this.detailX = x;
    this.detailZ = z;
    this.lastShadowDist = shadowDist;
    this.lastCarLodDist = carLodDist;
    this.detailDirty = false;
    for (const chunk of this.loaded.values()) {
      this.applyGroupDetail(chunk.group, x, z, shadowDist, carLodDist);
    }
  }

  private applyGroupDetail(group: Group, x: number, z: number, shadowDist: number, carLodDist: number): void {
    for (const child of group.children) {
      const ud = child.userData;
      if (ud.bucket !== 'cast') continue;
      const bounds = ud.cellBoundsXZ as [number, number, number, number] | undefined;
      if (!bounds) continue;
      const dx = x < bounds[0] ? bounds[0] - x : x > bounds[2] ? x - bounds[2] : 0;
      const dz = z < bounds[1] ? bounds[1] - z : z > bounds[3] ? z - bounds[3] : 0;
      const dXZ = Math.hypot(dx, dz);

      child.castShadow = shadowDist > 0 && dXZ <= shadowDist + 2;

      if (ud.lod1) {
        const wantLod: 0 | 1 = ud.lodLevel === 1 ? (dXZ < carLodDist - 2 ? 0 : 1) : dXZ > carLodDist + 2 ? 1 : 0;
        if (wantLod !== ud.lodLevel) {
          ud.lodLevel = wantLod;
          const [start, count] = (wantLod === 1 ? ud.lod1 : ud.lod0) as [number, number];
          (child as Mesh).geometry.setDrawRange(start, count);
        }
      }
    }
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const [k, chunk] of this.loaded) {
      disposeBatchGroup(chunk.group);
      this.world.removeOwner(k);
    }
    this.loaded.clear();
  }

  private request(ci: number, cj: number, x: number, z: number, dirX: number, dirZ: number): void {
    const capacity = this.workers.length * QUEUE_PER_WORKER - this.pending.size;
    if (capacity <= 0) return;
    const wanted: { i: number; j: number; score: number }[] = [];
    const r = this.radius;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const i = ci + di;
        const j = cj + dj;
        const k = key(i, j);
        if (this.loaded.has(k) || this.pending.has(k)) continue;
        // Distance from the player to the chunk center, minus a bonus for chunks ahead of the camera.
        const cx = (i + 0.5) * CHUNK - x;
        const cz = (j + 0.5) * CHUNK - z;
        const dist = Math.hypot(cx, cz);
        const ahead = dist > 0 ? (cx * dirX + cz * dirZ) / dist : 1;
        wanted.push({ i, j, score: dist - ahead * 24 });
      }
    }
    wanted.sort((a, b) => a.score - b.score);
    for (let n = 0; n < Math.min(capacity, wanted.length); n++) {
      const { i, j } = wanted[n];
      this.post({ type: 'chunk', seed: this.layout.seed, i, j, bodies: this.bodies });
      this.pending.add(key(i, j));
    }
  }

  /**
   * Bodies in the chaos scenes: 'mixed' (some visible, whole and clean; some under sheets, in bags) or
   * 'covered' (all under sheets / in bags, for the age rating). ?bodies=covered or localStorage
   * blockdead.bodies=covered.
   */
  readonly bodies: BodyMode = (new URLSearchParams(location.search).get('bodies') ?? localStorage.getItem('blockdead.bodies')) === 'covered' ? 'covered' : 'mixed';

  /** Ask a worker for a high-rise interior furnished around storey `focus`; it arrives through onInterior. */
  requestInterior(building: BuildingDesc, focus: number): void {
    this.post({ type: 'interior', seed: this.layout.seed, building, focus });
  }

  private post(msg: WorkerRequest): void {
    msg.lang = getLang();
    let best = 0;
    for (let w = 1; w < this.workers.length; w++) if (this.inFlight[w] < this.inFlight[best]) best = w;
    this.workers[best].postMessage(msg);
    this.inFlight[best]++;
  }

  /**
   * Switch only overlapping sub-cells' opaque mesh to the window-cutting material while one of the
   * chunk's high-rises has its interior loaded (non-overlapping quadrants keep fast opaque early-Z).
   */
  setWindowCut(chunkKey: number, on: boolean, boxes?: CutBox[]): void {
    const n = (this.cutRefs.get(chunkKey) ?? 0) + (on ? 1 : -1);
    if (n <= 0) this.cutRefs.delete(chunkKey);
    else this.cutRefs.set(chunkKey, n);
    if (boxes) this.cutBoxes = boxes;
    this.applyCut(chunkKey);
    for (const k of this.cutRefs.keys()) if (k !== chunkKey) this.applyCut(k);
  }

  private applyCut(chunkKey: number): void {
    const chunk = this.loaded.get(chunkKey);
    if (!chunk) return;
    const mats = worldMaterials();
    const cut = (this.cutRefs.get(chunkKey) ?? 0) > 0;
    for (const child of chunk.group.children) {
      if (child.userData.bucket !== 'cast') continue;
      if (!cut) {
        (child as Mesh).material = mats.cast;
        continue;
      }
      const b = child.userData.cellBoundsXZ as [number, number, number, number] | undefined;
      if (b && this.cutBoxes.length > 0) {
        const overlaps = this.cutBoxes.some((box) => b[2] >= box.minX && b[0] <= box.maxX && b[3] >= box.minZ && b[1] <= box.maxZ);
        (child as Mesh).material = overlaps ? mats.castCut : mats.cast;
      } else {
        (child as Mesh).material = mats.castCut;
      }
    }
  }

  private apply(data: ChunkData): void {
    const k = key(data.i, data.j);
    this.pending.delete(k);
    if (this.loaded.has(k)) return;
    const group = meshesFromBuffers(data.surfaces, `chunk ${data.i},${data.j}`);
    this.scene.add(group);
    this.world.addPacked(k, data.colliders);
    this.loaded.set(k, { group, zone: data.zone });
    this.applyCut(k);
    if (this.lastShadowDist >= 0) {
      this.applyGroupDetail(group, this.detailX, this.detailZ, this.lastShadowDist, this.lastCarLodDist);
    } else {
      this.detailDirty = true;
    }
    this.lastGenMs = data.ms;
    this.onChunkLoaded?.(k, data);
  }

  private allLoaded(ci: number, cj: number, r: number): boolean {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (!this.loaded.has(key(ci + di, cj + dj))) return false;
    return true;
  }
}
