import type { Group, Scene } from 'three';
import { disposeBatchGroup, meshesFromBuffers } from '../render/batchMeshes';
import type { CollisionWorld } from './CollisionWorld';
import type { ChunkData, InteriorData } from './gen/buildChunk';
import type { WorkerRequest, WorkerResponse } from './gen/chunkWorker';
import type { BuildingDesc } from './gen/highrise';
import { CHUNK, type WorldLayout, type Zone } from './gen/layout';

interface LoadedChunk {
  group: Group;
  zone: Zone;
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
  private readonly pending = new Set<number>();
  private readonly ready: WorkerResponse[] = [];
  private readonly workers: Worker[] = [];
  private readonly inFlight: number[] = [];
  private readonly waiters: { i: number; j: number; r: number; resolve: () => void }[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    readonly layout: WorldLayout,
    radius: number,
  ) {
    this.radius = radius;
    const count = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
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
      this.post({ type: 'chunk', seed: this.layout.seed, i, j });
      this.pending.add(key(i, j));
    }
  }

  /** Ask a worker for a high-rise interior; it arrives through onInterior. */
  requestInterior(building: BuildingDesc): void {
    this.post({ type: 'interior', seed: this.layout.seed, building });
  }

  private post(msg: WorkerRequest): void {
    let best = 0;
    for (let w = 1; w < this.workers.length; w++) if (this.inFlight[w] < this.inFlight[best]) best = w;
    this.workers[best].postMessage(msg);
    this.inFlight[best]++;
  }

  private apply(data: ChunkData): void {
    const k = key(data.i, data.j);
    this.pending.delete(k);
    if (this.loaded.has(k)) return;
    const group = meshesFromBuffers(data.surfaces, `chunk ${data.i},${data.j}`);
    this.scene.add(group);
    this.world.addPacked(k, data.colliders);
    this.loaded.set(k, { group, zone: data.zone });
    this.lastGenMs = data.ms;
    this.onChunkLoaded?.(k, data);
  }

  private allLoaded(ci: number, cj: number, r: number): boolean {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) if (!this.loaded.has(key(ci + di, cj + dj))) return false;
    return true;
  }
}
