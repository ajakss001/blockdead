import { Frustum, type Group, Matrix4, type Mesh, type Scene, Sphere } from 'three';
import { disposeBatchGroup, meshesFromBuffers } from '../render/batchMeshes';
import { setWindowCutouts } from '../render/look/worldMaterials';
import type { Containers } from '../systems/Containers';
import type { GlbPlacement } from './worldModels';
import type { WindowPaneSpot } from './WindowPanes';
import type { ChunkManager } from './ChunkManager';
import type { CollisionWorld } from './CollisionWorld';
import type { Doors } from './Doors';
import type { InteriorData } from './gen/buildChunk';
import { type BuildingDesc, FLOOR_H, highriseSurfaceY, inFireEscape, insideFootprint } from './gen/highrise';
import { CHUNK } from './gen/layout';

const bCellKey = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);
const _frustum = new Frustum();
const _projScreen = new Matrix4();
const _sphere = new Sphere();

/** Start streaming a building's interior within this distance of its footprint, m. */
const LOAD_MARGIN = 34;
/** Drop it beyond this one (hysteresis). */
const UNLOAD_MARGIN = 50;
/** Cull loaded interior mesh visibility beyond this footprint distance, m. */
const VISIBLE_MARGIN = 45;
/** Upper bound (shader cut-out slots); the quality preset may allow fewer. */
const MAX_LOADED = 6;
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
  private readonly cellBuildings = new Map<number, BuildingDesc[]>();
  private readonly byChunk = new Map<number, number[]>();
  private readonly loaded = new Map<number, Group>();
  private readonly pending = new Set<number>();
  private readonly readyQueue: InteriorData[] = [];
  /** Storey each loaded interior is furnished around. */
  private readonly focus = new Map<number, number>();
  private lastKeep = new Set<number>();
  private t = 0;
  /** Interiors kept at once (quality preset). */
  maxLoaded = MAX_LOADED;
  /** World-life spots of an interior arrived / left (radios, corridor lamps). */
  onAmbient?: (owner: number, spots: Float32Array | null) => void;
  /** Destructible window panes inside a streamed interior. */
  onWindows?: (owner: number, spots: WindowPaneSpot[] | null) => void;
  /** Streamed interior GLB props (sniper nests, clutter). */
  onGlbs?: (owner: number, glbs: GlbPlacement[] | null) => void;

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

  isLoaded(buildingId: number): boolean {
    return this.loaded.has(buildingId);
  }

  addChunk(key: number, list: BuildingDesc[]): void {
    if (list.length === 0) return;
    this.byChunk.set(key, list.map((b) => b.id));
    for (const b of list) {
      this.buildings.set(b.id, b);
      const i0 = Math.floor((b.cx - b.w / 2 - 2) / CHUNK);
      const i1 = Math.floor((b.cx + b.w / 2 + 2) / CHUNK);
      const j0 = Math.floor((b.cz - b.d / 2 - 2) / CHUNK);
      const j1 = Math.floor((b.cz + b.d / 2 + 2) / CHUNK);
      for (let ci = i0; ci <= i1; ci++) {
        for (let cj = j0; cj <= j1; cj++) {
          const ck = bCellKey(ci, cj);
          const arr = this.cellBuildings.get(ck);
          if (arr) arr.push(b);
          else this.cellBuildings.set(ck, [b]);
        }
      }
    }
  }

  removeChunk(key: number): void {
    for (const id of this.byChunk.get(key) ?? []) {
      this.unload(id);
      const b = this.buildings.get(id);
      if (b) {
        const i0 = Math.floor((b.cx - b.w / 2 - 2) / CHUNK);
        const i1 = Math.floor((b.cx + b.w / 2 + 2) / CHUNK);
        const j0 = Math.floor((b.cz - b.d / 2 - 2) / CHUNK);
        const j1 = Math.floor((b.cz + b.d / 2 + 2) / CHUNK);
        for (let ci = i0; ci <= i1; ci++) {
          for (let cj = j0; cj <= j1; cj++) {
            const ck = bCellKey(ci, cj);
            const arr = this.cellBuildings.get(ck);
            if (!arr) continue;
            const idx = arr.indexOf(b);
            if (idx >= 0) arr.splice(idx, 1);
            if (arr.length === 0) this.cellBuildings.delete(ck);
          }
        }
        this.buildings.delete(id);
      }
    }
    this.byChunk.delete(key);
  }

  buildingAt(x: number, z: number): BuildingDesc | null {
    const list = this.cellBuildings.get(bCellKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!list) return null;
    for (let i = 0; i < list.length; i++) if (insideFootprint(list[i], x, z)) return list[i];
    return null;
  }

  /** True when (x, z) stands on any high-rise fire escape staircase, landing, or roof threshold. */
  isOnFireEscape(x: number, z: number): boolean {
    const list = this.cellBuildings.get(bCellKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      if (insideFootprint(list[i], x, z, 2.5) && inFireEscape(list[i], x, z)) return true;
    }
    return false;
  }

  buildingsNear(x: number, z: number, radius: number): BuildingDesc[] {
    const r2 = radius * radius;
    const out: BuildingDesc[] = [];
    for (const b of this.buildings.values()) {
      const dx = b.cx - x;
      const dz = b.cz - z;
      if (dx * dx + dz * dz <= r2) out.push(b);
    }
    return out;
  }

  /** Walkable height inside a high-rise or on its exterior fire escape, or null outside. */
  surfaceY(x: number, z: number, y: number): number | null {
    const list = this.cellBuildings.get(bCellKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!list) return null;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (insideFootprint(d, x, z)) {
        const sy = highriseSurfaceY(d, x, z, y);
        if (sy !== null) return sy;
      }
    }
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (insideFootprint(d, x, z, 2.2)) {
        const sy = highriseSurfaceY(d, x, z, y);
        if (sy !== null && sy > 0.05) return sy;
      }
    }
    return null;
  }

  update(
    dt: number,
    x: number,
    z: number,
    y = 0,
    dirX = 0,
    dirZ = 0,
    camera?: { updateMatrixWorld: () => void; projectionMatrix: Matrix4; matrixWorldInverse: Matrix4 },
  ): void {
    // Apply at most one streamed interior per frame to avoid micro-freezes when approaching buildings.
    const next = this.readyQueue.shift();
    if (next) this.applyInterior(next);

    // Per-frame distance + frustum visibility culling for all loaded interior groups.
    if (this.loaded.size > 0) {
      let hasFrustum = false;
      if (camera) {
        camera.updateMatrixWorld();
        _projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        _frustum.setFromProjectionMatrix(_projScreen);
        hasFrustum = true;
      }
      for (const [id, group] of this.loaded) {
        const b = this.buildings.get(id);
        if (!b) continue;
        const d = Math.max(Math.abs(x - b.cx) - b.w / 2, Math.abs(z - b.cz) - b.d / 2, 0);
        let vis = d <= VISIBLE_MARGIN;
        if (vis && hasFrustum && d > 10) {
          const halfH = b.floors * FLOOR_H * 0.5;
          _sphere.center.set(b.cx, halfH, b.cz);
          _sphere.radius = Math.hypot(b.w * 0.5, halfH, b.d * 0.5) + 4;
          if (!_frustum.intersectsSphere(_sphere)) vis = false;
        }
        group.visible = vis;
        const allowShadows = vis && d <= 22;
        for (let i = 0; i < group.children.length; i++) {
          const m = group.children[i] as Mesh;
          if (m.userData?.bucket === 'cast') m.castShadow = allowShadows;
        }
      }
    }

    this.t -= dt;
    if (this.t > 0) return;
    this.t = CHECK_INTERVAL;
    const len = Math.hypot(dirX, dirZ);
    const nx = len > 1e-4 ? dirX / len : 0;
    const nz = len > 1e-4 ? dirZ / len : 0;
    const candidates: { b: BuildingDesc; d: number; score: number }[] = [];
    for (const b of this.buildings.values()) {
      const d = Math.max(Math.abs(x - b.cx) - b.w / 2, Math.abs(z - b.cz) - b.d / 2, 0);
      if (d > UNLOAD_MARGIN) {
        this.unload(b.id);
        continue;
      }
      if (d > LOAD_MARGIN && !this.loaded.has(b.id)) continue;
      let score: number;
      if (d === 0) {
        score = -1000;
      } else {
        score = d;
        if (len > 1e-4) {
          const toX = b.cx - x;
          const toZ = b.cz - z;
          const dist = Math.hypot(toX, toZ);
          if (dist > 1e-4) {
            const dot = (toX * nx + toZ * nz) / dist;
            if (dot > 0) score -= dot * 12;
          }
        }
        if (this.loaded.has(b.id)) score -= 4;
      }
      candidates.push({ b, d, score });
    }
    candidates.sort((a, c) => a.score - c.score);
    const max = Math.min(this.maxLoaded, MAX_LOADED);
    const top = candidates.slice(0, max);
    this.lastKeep = new Set(top.map((c) => c.b.id));
    for (const { b, d } of top) {
      if (d > LOAD_MARGIN) continue;
      // Furnished around the player's storey inside, around the street level outside.
      const want = insideFootprint(b, x, z, 0.5) ? Math.max(0, Math.min(b.floors - 1, Math.round(y / FLOOR_H))) : 0;
      if (this.pending.has(b.id) || (this.loaded.has(b.id) && this.focus.get(b.id) === want)) continue;
      this.pending.add(b.id);
      this.chunks.requestInterior(b, want);
    }
    // Keep at most `max`: drop the farthest extras.
    if (this.loaded.size > max) {
      for (const id of [...this.loaded.keys()]) if (!this.lastKeep.has(id)) this.unload(id);
    }
  }

  private onInterior(data: InteriorData): void {
    const id = data.buildingId;
    this.pending.delete(id);
    if (!this.buildings.has(id)) return;
    const idx = this.readyQueue.findIndex((q) => q.buildingId === id);
    if (idx >= 0) this.readyQueue[idx] = data;
    else this.readyQueue.push(data);
  }

  private applyInterior(data: InteriorData): void {
    const id = data.buildingId;
    if (!this.buildings.has(id)) return;
    // A rebuild around another storey replaces the old one in place; doors keep their state.
    const rebuild = this.loaded.has(id);
    const keep = rebuild ? this.doors.openStates(id) : null;
    if (rebuild) {
      this.release(id);
    } else {
      const max = Math.min(this.maxLoaded, MAX_LOADED);
      while (this.loaded.size >= max) {
        let victim: number | null = null;
        for (const loadedId of this.loaded.keys()) {
          if (!this.lastKeep.has(loadedId)) {
            victim = loadedId;
            break;
          }
          victim ??= loadedId;
        }
        if (victim === null) break;
        this.unload(victim);
      }
    }
    const owner = INTERIOR_OWNER_BASE + id;
    const group = meshesFromBuffers(data.surfaces, `interior ${id}`);
    this.scene.add(group);
    this.world.addPacked(owner, data.colliders);
    this.containers.addChunk(owner, 'downtown', data.containers);
    this.doors.add(id, data.doors, keep);
    this.onWindows?.(owner, data.windows);
    this.onGlbs?.(owner, data.glbs);
    this.onAmbient?.(owner, data.ambient);
    this.loaded.set(id, group);
    this.focus.set(id, data.focus);
    if (!rebuild) this.syncWindows(id, true);
  }

  /** Cut the loaded buildings' intact windows open (and only their overlapping sub-cells pay for it). */
  private syncWindows(id: number, on: boolean): void {
    const key = this.chunkOf(id);
    const boxes = [...this.loaded.keys()].map((bid) => {
      const b = this.buildings.get(bid)!;
      return { minX: b.cx - b.w / 2 - 0.05, minZ: b.cz - b.d / 2 - 0.05, maxX: b.cx + b.w / 2 + 0.05, maxZ: b.cz + b.d / 2 + 0.05, top: b.floors * FLOOR_H - 0.05 };
    });
    if (key !== null) this.chunks.setWindowCut(key, on, boxes);
    setWindowCutouts(boxes);
  }

  private chunkOf(id: number): number | null {
    for (const [key, ids] of this.byChunk) if (ids.includes(id)) return key;
    return null;
  }

  private unload(id: number): void {
    if (!this.loaded.has(id)) return;
    this.release(id);
    this.syncWindows(id, false);
  }

  /** Drop an interior's meshes, colliders, containers, doors and life spots. */
  private release(id: number): void {
    const group = this.loaded.get(id);
    if (!group) return;
    const owner = INTERIOR_OWNER_BASE + id;
    disposeBatchGroup(group);
    this.world.removeOwner(owner);
    this.containers.removeChunk(owner);
    this.doors.remove(id);
    this.onWindows?.(owner, null);
    this.onGlbs?.(owner, null);
    this.onAmbient?.(owner, null);
    this.loaded.delete(id);
    this.focus.delete(id);
  }
}
