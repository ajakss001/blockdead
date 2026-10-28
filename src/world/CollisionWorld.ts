import type { Vector3 } from 'three';

const CELL = 4;
const MAX_ITERATIONS = 3;

/** Unbounded vertical extent: street-level props and outer walls block at every height. */
export const ANY_Y_MIN = -1e4;
export const ANY_Y_MAX = 1e4;
/** Obstacles whose top is within this of the feet are stepped over (stairs, kerbs, low clutter). */
const STEP_UP = 0.4;
/** Only boxes up to this tall can be stood on (see supportAt). */
const SUPPORT_MAX_HEIGHT = 1.2;
/** Packed collider stride: centerX, centerZ, halfX, halfZ, minY, maxY, cos(yaw), sin(yaw). */
export const COLLIDER_STRIDE = 8;

/** Anything that can receive static boxes: the live CollisionWorld or the worker's collector. */
export interface ColliderSink {
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY?: number, maxY?: number): void;
  /** Box rotated about Y (cars): half sizes along its own X (length) and Z (width). Same yaw as three's rotation.y. */
  addOrientedBox(cx: number, cz: number, halfX: number, halfZ: number, yaw: number, minY?: number, maxY?: number): void;
}

interface Box {
  /** Broad-phase bounds (the rotated footprint's AABB). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  minY: number;
  maxY: number;
  owner: number;
  /** Oriented boxes only: center, half extents and rotation. */
  obb: { cx: number; cz: number; hx: number; hz: number; c: number; s: number } | null;
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
    this.insert({ minX, minZ, maxX, maxZ, minY, maxY, owner: this.owner, obb: null });
  }

  addOrientedBox(cx: number, cz: number, hx: number, hz: number, yaw: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Nearly axis-aligned: a plain box is exact and cheaper.
    if (Math.abs(s) < 1e-3 || Math.abs(c) < 1e-3) {
      const ax = Math.abs(c) > 0.5 ? hx : hz;
      const az = Math.abs(c) > 0.5 ? hz : hx;
      this.addBox(cx - ax, cz - az, cx + ax, cz + az, minY, maxY);
      return;
    }
    const ex = hx * Math.abs(c) + hz * Math.abs(s);
    const ez = hx * Math.abs(s) + hz * Math.abs(c);
    this.insert({ minX: cx - ex, minZ: cz - ez, maxX: cx + ex, maxZ: cz + ez, minY, maxY, owner: this.owner, obb: { cx, cz, hx, hz, c, s } });
  }

  private insert(box: Box): void {
    const { minX, minZ, maxX, maxZ } = box;
    const id = this.nextId++;
    this.boxes.set(id, box);
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

  /** Add a flat [cx, cz, hx, hz, minY, maxY, cos, sin, …] array under one owner. */
  addPacked(owner: number, packed: Float32Array): void {
    const prev = this.owner;
    this.owner = owner;
    for (let i = 0; i + COLLIDER_STRIDE - 1 < packed.length; i += COLLIDER_STRIDE) {
      const cx = packed[i];
      const cz = packed[i + 1];
      const hx = packed[i + 2];
      const hz = packed[i + 3];
      if (packed[i + 7] === 0) this.addBox(cx - hx, cz - hz, cx + hx, cz + hz, packed[i + 4], packed[i + 5]);
      else this.addOrientedBox(cx, cz, hx, hz, Math.atan2(packed[i + 7], packed[i + 6]), packed[i + 4], packed[i + 5]);
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
        if (b.obb) {
          if (this.pushOutOfObb(pos, b.obb, radius)) pushed = true;
          continue;
        }
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

  /** Distance along a ray to the first box it enters (marching in 8 cm steps), or −1 within maxDist. */
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number {
    for (let d = 0.1; d <= maxDist; d += 0.08) {
      const x = ox + dx * d;
      const y = oy + dy * d;
      const z = oz + dz * d;
      this.query(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
      for (let i = 0; i < this.candidates.length; i++) {
        const b = this.boxes.get(this.candidates[i])!;
        if (y < b.minY || y > b.maxY) continue;
        if (b.obb) {
          const o = b.obb;
          const wx = x - o.cx;
          const wz = z - o.cz;
          if (Math.abs(wx * o.c - wz * o.s) > o.hx || Math.abs(wx * o.s + wz * o.c) > o.hz) continue;
        } else if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        return d;
      }
    }
    return -1;
  }

  /**
   * Standing on things: the top of the highest low box (≤ 1.2 m tall: crates, sandbags, tables, beds)
   * under a circle, whose top is at most `maxTop`; −∞ if none. Walls, cars and other full-height
   * colliders never count.
   */
  supportAt(x: number, z: number, radius: number, maxTop: number): number {
    this.query(x - radius, z - radius, x + radius, z + radius);
    let best = -Infinity;
    for (let i = 0; i < this.candidates.length; i++) {
      const b = this.boxes.get(this.candidates[i])!;
      if (b.maxY > maxTop || b.maxY <= best || b.maxY - b.minY > SUPPORT_MAX_HEIGHT) continue;
      if (b.obb) {
        const o = b.obb;
        const wx = x - o.cx;
        const wz = z - o.cz;
        if (Math.abs(wx * o.c - wz * o.s) > o.hx + radius || Math.abs(wx * o.s + wz * o.c) > o.hz + radius) continue;
      } else if (x + radius <= b.minX || x - radius >= b.maxX || z + radius <= b.minZ || z - radius >= b.maxZ) continue;
      best = b.maxY;
    }
    return best;
  }

  /** Circle vs rotated box: solve in the box's frame, push back in world space. */
  private pushOutOfObb(pos: Vector3, o: NonNullable<Box['obb']>, radius: number): boolean {
    const wx = pos.x - o.cx;
    const wz = pos.z - o.cz;
    // World → local is the inverse of three's rotation.y: x' = x·c − z·s, z' = x·s + z·c.
    const lx = wx * o.c - wz * o.s;
    const lz = wx * o.s + wz * o.c;
    const qx = lx < -o.hx ? -o.hx : lx > o.hx ? o.hx : lx;
    const qz = lz < -o.hz ? -o.hz : lz > o.hz ? o.hz : lz;
    let dx = lx - qx;
    let dz = lz - qz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) return false;
    let nx: number;
    let nz: number;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2);
      nx = qx + (dx / d) * radius;
      nz = qz + (dz / d) * radius;
    } else {
      // Center inside: leave through the nearest face.
      const px = o.hx - Math.abs(lx);
      const pz = o.hz - Math.abs(lz);
      if (px < pz) {
        nx = Math.sign(lx || 1) * (o.hx + radius);
        nz = lz;
      } else {
        nx = lx;
        nz = Math.sign(lz || 1) * (o.hz + radius);
      }
    }
    dx = nx * o.c + nz * o.s;
    dz = -nx * o.s + nz * o.c;
    pos.x = o.cx + dx;
    pos.z = o.cz + dz;
    return true;
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
    this.data.push((minX + maxX) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2, minY, maxY, 1, 0);
  }

  addOrientedBox(cx: number, cz: number, hx: number, hz: number, yaw: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX): void {
    // sin 0 marks an axis-aligned box on unpacking: nudge exact multiples of π/2 into a true OBB-less box.
    const s = Math.sin(yaw);
    if (Math.abs(s) < 1e-3 || Math.abs(Math.cos(yaw)) < 1e-3) {
      const ax = Math.abs(Math.cos(yaw)) > 0.5 ? hx : hz;
      const az = Math.abs(Math.cos(yaw)) > 0.5 ? hz : hx;
      this.addBox(cx - ax, cz - az, cx + ax, cz + az, minY, maxY);
      return;
    }
    this.data.push(cx, cz, hx, hz, minY, maxY, Math.cos(yaw), s);
  }
}

function cellKey(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768);
}
