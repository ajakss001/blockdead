import type { Vector3 } from 'three';

const CELL = 4;
const MAX_ITERATIONS = 3;

/** Unbounded vertical extent: street-level props and outer walls block at every height. */
export const ANY_Y_MIN = -1e4;
export const ANY_Y_MAX = 1e4;
/** Obstacles whose top is within this of the feet are stepped over (stairs, kerbs, low clutter). */
const STEP_UP = 0.4;
/** Packed collider stride: minX, minZ, maxX, maxZ, minY, maxY. */
export const COLLIDER_STRIDE = 6;

/** Anything that can receive static boxes: the live CollisionWorld or the worker's collector. */
export interface ColliderSink {
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY?: number, maxY?: number): void;
}

interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  minY: number;
  maxY: number;
  owner: number;
}

/**
 * Static collision: axis-aligned boxes (XZ grid + a vertical range) against vertical cylinders.
 * A box only blocks if it overlaps the mover's body height, so each storey of a building has its
 * own walls and doorways. Boxes are tagged with an owner (chunk, interior, door) for removal.
 */
export class CollisionWorld implements ColliderSink {
  private readonly boxes = new Map<number, Box>();
  private readonly grid = new Map<number, number[]>();
  private readonly byOwner = new Map<number, number[]>();
  private readonly candidates: number[] = [];
  private readonly stamps = new Map<number, number>();
  private nextId = 0;
  private stamp = 0;
  /** Owner assigned to boxes added through addBox(). */
  owner = 0;

  get boxCount(): number {
    return this.boxes.size;
  }

  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX): void {
    const id = this.nextId++;
    this.boxes.set(id, { minX, minZ, maxX, maxZ, minY, maxY, owner: this.owner });
    const owned = this.byOwner.get(this.owner);
    if (owned) owned.push(id);
    else this.byOwner.set(this.owner, [id]);
    this.forCells(minX, minZ, maxX, maxZ, (key) => {
      const list = this.grid.get(key);
      if (list) list.push(id);
      else this.grid.set(key, [id]);
    });
  }

  /** Box given by center and size. */
  addBoxCentered(cx: number, cz: number, sizeX: number, sizeZ: number): void {
    this.addBox(cx - sizeX / 2, cz - sizeZ / 2, cx + sizeX / 2, cz + sizeZ / 2);
  }

  /** Add a flat [minX, minZ, maxX, maxZ, minY, maxY, …] array under one owner. */
  addPacked(owner: number, packed: Float32Array): void {
    const prev = this.owner;
    this.owner = owner;
    for (let i = 0; i + 5 < packed.length; i += COLLIDER_STRIDE) {
      this.addBox(packed[i], packed[i + 1], packed[i + 2], packed[i + 3], packed[i + 4], packed[i + 5]);
    }
    this.owner = prev;
  }

  /** Add one box under a specific owner (doors). */
  addOwned(owner: number, minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number): void {
    const prev = this.owner;
    this.owner = owner;
    this.addBox(minX, minZ, maxX, maxZ, minY, maxY);
    this.owner = prev;
  }

  removeOwner(owner: number): void {
    const ids = this.byOwner.get(owner);
    if (!ids) return;
    for (const id of ids) {
      const b = this.boxes.get(id)!;
      this.forCells(b.minX, b.minZ, b.maxX, b.maxZ, (key) => {
        const list = this.grid.get(key);
        if (!list) return;
        const i = list.indexOf(id);
        if (i >= 0) list.splice(i, 1);
        if (list.length === 0) this.grid.delete(key);
      });
      this.boxes.delete(id);
      this.stamps.delete(id);
    }
    this.byOwner.delete(owner);
  }

  /**
   * Push a cylinder (feet at pos.y, given height) out of all boxes it overlaps vertically
   * (mutates pos.x / pos.z). Sliding along walls falls out of this.
   */
  resolveCircle(pos: Vector3, radius: number, height = 1.75): void {
    this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
    const r2 = radius * radius;
    const feet = pos.y + STEP_UP;
    const head = pos.y + height;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let pushed = false;
      for (let i = 0; i < this.candidates.length; i++) {
        const b = this.boxes.get(this.candidates[i])!;
        if (b.maxY <= feet || b.minY >= head) continue;
        const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
        const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;
        pushed = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (radius - d);
          pos.z += (dz / d) * (radius - d);
        } else {
          // Center inside the box (tunnelling or spawn overlap): leave through the nearest face.
          const left = pos.x - b.minX;
          const right = b.maxX - pos.x;
          const back = pos.z - b.minZ;
          const front = b.maxZ - pos.z;
          const m = Math.min(left, right, back, front);
          if (m === left) pos.x = b.minX - radius;
          else if (m === right) pos.x = b.maxX + radius;
          else if (m === back) pos.z = b.minZ - radius;
          else pos.z = b.maxZ + radius;
        }
      }
      if (!pushed) break;
    }
  }

  private query(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.candidates.length = 0;
    const stamp = ++this.stamp;
    this.forCells(minX, minZ, maxX, maxZ, (key) => {
      const list = this.grid.get(key);
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (this.stamps.get(id) === stamp) continue;
        this.stamps.set(id, stamp);
        this.candidates.push(id);
      }
    });
  }

  private forCells(minX: number, minZ: number, maxX: number, maxZ: number, fn: (key: number) => void): void {
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) fn(cellKey(ix, iz));
    }
  }
}

/** Collects boxes into a flat array (worker side). */
export class PackedColliders implements ColliderSink {
  readonly data: number[] = [];
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX): void {
    this.data.push(minX, minZ, maxX, maxZ, minY, maxY);
  }
}

function cellKey(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768);
}
