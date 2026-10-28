import type { Group, Scene } from 'three';
import { disposeBatchGroup, meshesFromBuffers } from '../render/batchMeshes';
import { setWindowCutouts } from '../render/look/worldMaterials';
import type { Containers } from '../systems/Containers';
import type { ChunkManager } from './ChunkManager';
import type { CollisionWorld } from './CollisionWorld';
import type { Doors } from './Doors';
import type { InteriorData } from './gen/buildChunk';
import { type BuildingDesc, FLOOR_H, highriseSurfaceY, insideFootprint } from './gen/highrise';

/** Start streaming a building's interior within this distance of its footprint, m. */
const LOAD_MARGIN = 12;
/** Drop it beyond this one (hysteresis). */
const UNLOAD_MARGIN = 28;
/** Upper bound (shader cut-out slots); the quality preset may allow fewer. */
const MAX_LOADED = 2;
const CHECK_INTERVAL = 0.25;
/** Interior collider/container owners live above chunk keys. */
const INTERIOR_OWNER_BASE = 2e15;

/**
 * High-rise interiors on demand. Buildings are known from their chunk; the one(s) the player
 * approaches get their interior generated in the worker and uploaded here, together with its
 * storey-ranged colliders, containers and doors. Walking away releases all of it.
 */
export class Interiors {
  private readonly buildings = new Map<number, BuildingDesc>();
  private readonly byChunk = new Map<number, number[]>();
  private readonly loaded = new Map<number, Group>();
  private readonly pending = new Set<number>();
  private t = 0;
  /** Interiors kept at once (quality preset). */
  maxLoaded = MAX_LOADED;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly chunks: ChunkManager,
    private readonly containers: Containers,
    private readonly doors: Doors,
  ) {
    chunks.onInterior = (data) => this.onInterior(data);
  }

  get loadedCount(): number {
    return this.loaded.size;
  }

  addChunk(key: number, list: BuildingDesc[]): void {
    if (list.length === 0) return;
    this.byChunk.set(key, list.map((b) => b.id));
    for (const b of list) this.buildings.set(b.id, b);
  }

  removeChunk(key: number): void {
    for (const id of this.byChunk.get(key) ?? []) {
      this.unload(id);
      this.buildings.delete(id);
    }
    this.byChunk.delete(key);
  }

  buildingAt(x: number, z: number): BuildingDesc | null {
    for (const b of this.buildings.values()) if (insideFootprint(b, x, z)) return b;
    return null;
  }

  /** Walkable height inside a high-rise, or null outside every footprint. */
  surfaceY(x: number, z: number, y: number): number | null {
    const b = this.buildingAt(x, z);
    return b ? highriseSurfaceY(b, x, z, y) : null;
  }

  update(dt: number, x: number, z: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = CHECK_INTERVAL;
    const near: { b: BuildingDesc; d: number }[] = [];
    for (const b of this.buildings.values()) {
      const d = Math.max(Math.abs(x - b.cx) - b.w / 2, Math.abs(z - b.cz) - b.d / 2, 0);
      if (d <= LOAD_MARGIN) near.push({ b, d });
      else if (d > UNLOAD_MARGIN) this.unload(b.id);
    }
    near.sort((a, c) => a.d - c.d);
    const max = Math.min(this.maxLoaded, MAX_LOADED);
    for (const { b } of near.slice(0, max)) {
      if (this.loaded.has(b.id) || this.pending.has(b.id)) continue;
      this.pending.add(b.id);
      this.chunks.requestInterior(b);
    }
    // Keep at most `max`: drop the farthest extras.
    if (this.loaded.size > max) {
      const keep = new Set(near.slice(0, max).map((n) => n.b.id));
      for (const id of [...this.loaded.keys()]) if (!keep.has(id)) this.unload(id);
    }
  }

  private onInterior(data: InteriorData): void {
    this.pending.delete(data.buildingId);
    if (!this.buildings.has(data.buildingId) || this.loaded.has(data.buildingId)) return;
    const owner = INTERIOR_OWNER_BASE + data.buildingId;
    const group = meshesFromBuffers(data.surfaces, `interior ${data.buildingId}`);
    this.scene.add(group);
    this.world.addPacked(owner, data.colliders);
    this.containers.addChunk(owner, 'downtown', data.containers);
    this.doors.add(data.buildingId, data.doors);
    this.loaded.set(data.buildingId, group);
    this.syncWindows(data.buildingId, true);
  }

  /** Cut the loaded buildings' intact windows open (and only their chunks pay for it). */
  private syncWindows(id: number, on: boolean): void {
    const key = this.chunkOf(id);
    if (key !== null) this.chunks.setWindowCut(key, on);
    const boxes = [...this.loaded.keys()].map((bid) => {
      const b = this.buildings.get(bid)!;
      return { minX: b.cx - b.w / 2 - 0.05, minZ: b.cz - b.d / 2 - 0.05, maxX: b.cx + b.w / 2 + 0.05, maxZ: b.cz + b.d / 2 + 0.05, top: b.floors * FLOOR_H - 0.05 };
    });
    setWindowCutouts(boxes);
  }

  private chunkOf(id: number): number | null {
    for (const [key, ids] of this.byChunk) if (ids.includes(id)) return key;
    return null;
  }

  private unload(id: number): void {
    const group = this.loaded.get(id);
    if (!group) return;
    const owner = INTERIOR_OWNER_BASE + id;
    disposeBatchGroup(group);
    this.world.removeOwner(owner);
    this.containers.removeChunk(owner);
    this.doors.remove(id);
    this.loaded.delete(id);
    this.syncWindows(id, false);
  }
}
