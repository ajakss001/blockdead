import type { Vector3 } from 'three';

const CELL = 4;
const MAX_ITERATIONS = 5;
/** Enforce at least 0.25 m collider thickness on full-height walls/partitions/doors to prevent tunneling. */
const MIN_WALL_THICKNESS = 0.25;

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
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY?: number, maxY?: number, glass?: boolean, bodyOnly?: boolean): void;
  /** Box rotated about Y (cars): half sizes along its own X (length) and Z (width). Same yaw as three's rotation.y. */
  addOrientedBox(cx: number, cz: number, halfX: number, halfZ: number, yaw: number, minY?: number, maxY?: number): void;
}

/** Detailed raycast hit including owner id, flags and outward surface normal. */
export interface RayHitDetail {
  t: number;
  owner: number;
  door: boolean;
  glass: boolean;
  nx: number;
  ny: number;
  nz: number;
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
  /** Transparent window glass: blocks movement, transparent to LOS and breakable by bullets. */
  glass: boolean;
  /** Door collider owned by Doors system (passable in bot A* if unlocked/unbarricaded). */
  door: boolean;
  /** Ray/bullet-only collider (e.g., wide-open/swinging-open door leaf: blocks bullets/LOS without snagging or shoving actors into jambs). */
  rayOnly?: boolean;
  /** Physical body-only doorway seal (cracked < 55 deg door: stops players without blocking bullets/LOS through the crack). */
  bodyOnly?: boolean;
  /** Oriented boxes only: center, half extents and rotation. */
  obb: { cx: number; cz: number; hx: number; hz: number; c: number; s: number } | null;
}

/**
 * Static collision: axis-aligned boxes (XZ grid + a vertical range) against vertical cylinders.
 * A box only blocks if it overlaps the mover's body height, so each storey of a building has its
 * own walls and doorways. Boxes are tagged with an owner (chunk, interior, door) for removal.
 */
export class CollisionWorld implements ColliderSink {
  private readonly boxes: (Box | null)[] = [];
  private readonly freeIds: number[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly byOwner = new Map<number, number[]>();
  private readonly candidates: number[] = [];
  private stamps = new Int32Array(256);
  private liveCount = 0;
  private stamp = 0;
  /** Owner assigned to boxes added through addBox(). */
  owner = 0;

  get boxCount(): number {
    return this.liveCount;
  }

  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX, glass = false, door = false, bodyOnly = false): void {
    let x0 = minX;
    let z0 = minZ;
    let x1 = maxX;
    let z1 = maxZ;
    if (maxY - minY >= 1.5) {
      const sx = x1 - x0;
      const sz = z1 - z0;
      if (sx < MIN_WALL_THICKNESS && sz >= 0.4) {
        const cx = (x0 + x1) * 0.5;
        x0 = cx - MIN_WALL_THICKNESS * 0.5;
        x1 = cx + MIN_WALL_THICKNESS * 0.5;
      } else if (sz < MIN_WALL_THICKNESS && sx >= 0.4) {
        const cz = (z0 + z1) * 0.5;
        z0 = cz - MIN_WALL_THICKNESS * 0.5;
        z1 = cz + MIN_WALL_THICKNESS * 0.5;
      }
    }
    this.insert({ minX: x0, minZ: z0, maxX: x1, maxZ: z1, minY, maxY, owner: this.owner, glass, door, bodyOnly, obb: null });
  }

  addOrientedBox(cx: number, cz: number, hx: number, hz: number, yaw: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX, glass = false, door = false, rayOnly = false, bodyOnly = false): void {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // Nearly axis-aligned: a plain box is exact and cheaper.
    if (Math.abs(s) < 1e-3 || Math.abs(c) < 1e-3) {
      const ax = Math.abs(c) > 0.5 ? hx : hz;
      const az = Math.abs(c) > 0.5 ? hz : hx;
      this.insert({ minX: cx - ax, minZ: cz - az, maxX: cx + ax, maxZ: cz + az, minY, maxY, owner: this.owner, glass, door, rayOnly, bodyOnly, obb: null });
      return;
    }
    const ex = hx * Math.abs(c) + hz * Math.abs(s);
    const ez = hx * Math.abs(s) + hz * Math.abs(c);
    this.insert({ minX: cx - ex, minZ: cz - ez, maxX: cx + ex, maxZ: cz + ez, minY, maxY, owner: this.owner, glass, door, rayOnly, bodyOnly, obb: { cx, cz, hx, hz, c, s } });
  }

  private insert(box: Box): void {
    const { minX, minZ, maxX, maxZ } = box;
    let id: number;
    if (this.freeIds.length > 0) {
      id = this.freeIds.pop()!;
      this.boxes[id] = box;
    } else {
      id = this.boxes.length;
      this.boxes.push(box);
      if (id >= this.stamps.length) {
        const grown = new Int32Array(this.stamps.length * 2);
        grown.set(this.stamps);
        this.stamps = grown;
      }
    }
    this.liveCount++;
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
      if (packed[i + 7] === 0) this.addBox(cx - hx, cz - hz, cx + hx, cz + hz, packed[i + 4], packed[i + 5], packed[i + 6] < 0, false, packed[i + 6] > 1.5);
      else this.addOrientedBox(cx, cz, hx, hz, Math.atan2(packed[i + 7], packed[i + 6]), packed[i + 4], packed[i + 5]);
    }
    this.owner = prev;
  }

  /** Add one box under a specific owner (doors). */
  addOwned(owner: number, minX: number, minZ: number, maxX: number, maxZ: number, minY: number, maxY: number, door = false, glass = false): void {
    const prev = this.owner;
    this.owner = owner;
    this.addBox(minX, minZ, maxX, maxZ, minY, maxY, glass, door);
    this.owner = prev;
  }

  /** Add an oriented box under a specific owner (rotating doors). */
  addOwnedOriented(owner: number, cx: number, cz: number, hx: number, hz: number, yaw: number, minY: number, maxY: number, glass = false, door = false, rayOnly = false, bodyOnly = false): void {
    const prev = this.owner;
    this.owner = owner;
    this.addOrientedBox(cx, cz, hx, hz, yaw, minY, maxY, glass, door, rayOnly, bodyOnly);
    this.owner = prev;
  }

  private removeBoxById(id: number, cleanOwnerList = false): void {
    const b = this.boxes[id];
    if (!b) return;
    this.forCells(b.minX, b.minZ, b.maxX, b.maxZ, (key) => {
      const list = this.grid.get(key);
      if (!list) return;
      const i = list.indexOf(id);
      if (i >= 0) list.splice(i, 1);
      if (list.length === 0) this.grid.delete(key);
    });
    if (cleanOwnerList) {
      const ownerIds = this.byOwner.get(b.owner);
      if (ownerIds) {
        const k = ownerIds.indexOf(id);
        if (k >= 0) ownerIds.splice(k, 1);
      }
    }
    this.boxes[id] = null;
    this.freeIds.push(id);
    this.liveCount--;
  }

  removeOwner(owner: number): void {
    const ids = this.byOwner.get(owner);
    if (!ids) return;
    for (let k = 0; k < ids.length; k++) {
      this.removeBoxById(ids[k], false);
    }
    this.byOwner.delete(owner);
  }

  /** Remove any intact window glass boxes overlapping `[x±r, y±r, z±r]` when shattered (closed glass doors keep their colliders). */
  breakGlassAt(x: number, y: number, z: number, radius = 0.65): boolean {
    this.query(x - radius, z - radius, x + radius, z + radius);
    let broken = false;
    for (let i = 0; i < this.candidates.length; i++) {
      const id = this.candidates[i];
      const b = this.boxes[id];
      if (!b || !b.glass || b.door) continue;
      if (b.maxX < x - radius || b.minX > x + radius) continue;
      if (b.maxZ < z - radius || b.minZ > z + radius) continue;
      if (b.maxY < y - radius || b.minY > y + radius) continue;
      this.removeBoxById(id, true);
      broken = true;
    }
    return broken;
  }

  /**
   * Push a cylinder (feet at pos.y, given height) out of all boxes it overlaps vertically
   * (mutates pos.x / pos.z). Sliding along walls falls out of this.
   */
  resolveCircle(pos: Vector3, radius: number, height = 1.75): void {
    this.query(pos.x - radius - 0.5, pos.z - radius - 0.5, pos.x + radius + 0.5, pos.z + radius + 0.5);
    const r2 = radius * radius;
    const feet = pos.y + STEP_UP;
    const head = pos.y + height;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let pushed = false;
      for (let i = 0; i < this.candidates.length; i++) {
        const b = this.boxes[this.candidates[i]];
        if (!b || b.rayOnly || b.maxY <= feet || b.minY >= head) continue;
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

  /** Distance along a ray to the first box it enters (2D DDA across grid cells + exact slab test), or −1 within maxDist. */
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, ignoreGlass = false, includeBodyOnly = false): number {
    return this.traceRay(ox, oy, oz, dx, dy, dz, maxDist, ignoreGlass, null, includeBodyOnly);
  }

  /** Detailed ray hit returning distance, owner id, door/glass flags, and surface normal, or null. */
  rayHitDetail(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, ignoreGlass = false, includeBodyOnly = false): RayHitDetail | null {
    const out: RayHitDetail = { t: -1, owner: 0, door: false, glass: false, nx: 0, ny: 1, nz: 0 };
    const t = this.traceRay(ox, oy, oz, dx, dy, dz, maxDist, ignoreGlass, out, includeBodyOnly);
    return t >= 0 ? out : null;
  }

  private traceRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    ignoreGlass: boolean,
    detailOut: RayHitDetail | null,
    includeBodyOnly = false,
  ): number {
    const tClip = 0.02;
    if (maxDist < tClip || !Number.isFinite(ox + oy + oz + dx + dy + dz + maxDist)) return -1;

    const stamp = this.nextStamp();
    let bestT = maxDist;
    let hit = -1;

    const invDx = Math.abs(dx) > 1e-9 ? 1 / dx : 0;
    const invDy = Math.abs(dy) > 1e-9 ? 1 / dy : 0;
    const invDz = Math.abs(dz) > 1e-9 ? 1 / dz : 0;

    let ix = Math.floor(ox / CELL);
    let iz = Math.floor(oz / CELL);

    let stepX = 0;
    let tDeltaX = Infinity;
    let tMaxX = Infinity;
    if (invDx > 0) {
      stepX = 1;
      tDeltaX = CELL * invDx;
      tMaxX = ((ix + 1) * CELL - ox) * invDx;
    } else if (invDx < 0) {
      stepX = -1;
      tDeltaX = -CELL * invDx;
      tMaxX = (ix * CELL - ox) * invDx;
    }

    let stepZ = 0;
    let tDeltaZ = Infinity;
    let tMaxZ = Infinity;
    if (invDz > 0) {
      stepZ = 1;
      tDeltaZ = CELL * invDz;
      tMaxZ = ((iz + 1) * CELL - oz) * invDz;
    } else if (invDz < 0) {
      stepZ = -1;
      tDeltaZ = -CELL * invDz;
      tMaxZ = (iz * CELL - oz) * invDz;
    }

    while (true) {
      const list = this.grid.get(cellKey(ix, iz));
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const id = list[i];
          if (this.stamps[id] === stamp) continue;
          this.stamps[id] = stamp;
          const b = this.boxes[id];
          if (!b || (ignoreGlass && b.glass) || (b.bodyOnly && !includeBodyOnly)) continue;

          // Y slab test first (fastest rejection for above/below floor boxes).
          let tMin = 0;
          let tMax = bestT;
          let cnx = -dx;
          let cny = -dy;
          let cnz = -dz;
          if (invDy !== 0) {
            let t1 = (b.minY - oy) * invDy;
            let t2 = (b.maxY - oy) * invDy;
            if (t1 > t2) {
              const tmp = t1;
              t1 = t2;
              t2 = tmp;
            }
            if (t1 > tMin) {
              tMin = t1;
              cnx = 0;
              cny = dy > 0 ? -1 : 1;
              cnz = 0;
            }
            if (t2 < tMax) tMax = t2;
            if (tMin > tMax || tMax < tClip) continue;
          } else if (oy < b.minY || oy > b.maxY) {
            continue;
          }

          const o = b.obb;
          if (o) {
            const wx = ox - o.cx;
            const wz = oz - o.cz;
            const lox = wx * o.c - wz * o.s;
            const loz = wx * o.s + wz * o.c;
            const ldx = dx * o.c - dz * o.s;
            const ldz = dx * o.s + dz * o.c;

            if (Math.abs(ldx) > 1e-9) {
              const inv = 1 / ldx;
              let t1 = (-o.hx - lox) * inv;
              let t2 = (o.hx - lox) * inv;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
              }
              if (t1 > tMin) {
                tMin = t1;
                const lnx = ldx > 0 ? -1 : 1;
                cnx = lnx * o.c;
                cny = 0;
                cnz = -lnx * o.s;
              }
              if (t2 < tMax) tMax = t2;
              if (tMin > tMax || tMax < tClip) continue;
            } else if (lox < -o.hx || lox > o.hx) {
              continue;
            }

            if (Math.abs(ldz) > 1e-9) {
              const inv = 1 / ldz;
              let t1 = (-o.hz - loz) * inv;
              let t2 = (o.hz - loz) * inv;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
              }
              if (t1 > tMin) {
                tMin = t1;
                const lnz = ldz > 0 ? -1 : 1;
                cnx = lnz * o.s;
                cny = 0;
                cnz = lnz * o.c;
              }
              if (t2 < tMax) tMax = t2;
              if (tMin > tMax || tMax < tClip) continue;
            } else if (loz < -o.hz || loz > o.hz) {
              continue;
            }
          } else {
            if (invDx !== 0) {
              let t1 = (b.minX - ox) * invDx;
              let t2 = (b.maxX - ox) * invDx;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
              }
              if (t1 > tMin) {
                tMin = t1;
                cnx = dx > 0 ? -1 : 1;
                cny = 0;
                cnz = 0;
              }
              if (t2 < tMax) tMax = t2;
              if (tMin > tMax || tMax < tClip) continue;
            } else if (ox < b.minX || ox > b.maxX) {
              continue;
            }

            if (invDz !== 0) {
              let t1 = (b.minZ - oz) * invDz;
              let t2 = (b.maxZ - oz) * invDz;
              if (t1 > t2) {
                const tmp = t1;
                t1 = t2;
                t2 = tmp;
              }
              if (t1 > tMin) {
                tMin = t1;
                cnx = 0;
                cny = 0;
                cnz = dz > 0 ? -1 : 1;
              }
              if (t2 < tMax) tMax = t2;
              if (tMin > tMax || tMax < tClip) continue;
            } else if (oz < b.minZ || oz > b.maxZ) {
              continue;
            }
          }

          const ht = tMin > tClip ? tMin : tClip;
          if (ht < bestT || hit < 0) {
            bestT = ht;
            hit = ht;
            if (detailOut) {
              detailOut.t = ht;
              detailOut.owner = b.owner;
              detailOut.door = b.door;
              detailOut.glass = b.glass;
              detailOut.nx = cnx;
              detailOut.ny = cny;
              detailOut.nz = cnz;
            }
          }
        }
      }

      if (tMaxX <= tMaxZ) {
        if (tMaxX > bestT) break;
        ix += stepX;
        tMaxX += tDeltaX;
      } else {
        if (tMaxZ > bestT) break;
        iz += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return hit;
  }

  /**
   * Standing on things: the top of the highest low box (≤ 1.2 m tall: crates, sandbags, tables, beds)
   * under a circle, whose top is at most `maxTop`; −∞ if none. Walls, cars and other full-height
   * colliders never count.
   */
  supportAt(x: number, z: number, radius: number, maxTop: number, standY = -Infinity): number {
    this.query(x - radius, z - radius, x + radius, z + radius);
    let best = -Infinity;
    for (let i = 0; i < this.candidates.length; i++) {
      const b = this.boxes[this.candidates[i]];
      // Low boxes can be stepped onto; anything taller only holds you once you are on top (climbed up).
      if (!b || b.maxY > maxTop || b.maxY <= best || (b.maxY - b.minY > SUPPORT_MAX_HEIGHT && b.maxY > standY + 0.06)) continue;
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

  /** The underside of the lowest box above `fromY` over a circle (a ceiling, a lintel, a beam), or +∞. */
  ceilingAt(x: number, z: number, radius: number, fromY: number): number {
    this.query(x - radius, z - radius, x + radius, z + radius);
    let best = Infinity;
    for (let i = 0; i < this.candidates.length; i++) {
      const b = this.boxes[this.candidates[i]];
      if (!b || b.minY < fromY || b.minY >= best || !this.overlapsCircle(b, x, z, radius)) continue;
      best = b.minY;
    }
    return best;
  }

  /**
   * A ledge to climb onto in front: the top of a box `reach` m ahead whose top is between `minRise` and
   * `maxRise` above the feet, with room to crouch on it (nothing in the 1.2 m above). −1 if none.
   */
  ledgeAhead(x: number, z: number, dirX: number, dirZ: number, feetY: number, minRise: number, maxRise: number, reach = 0.55): number {
    const lx = x + dirX * reach;
    const lz = z + dirZ * reach;
    this.query(lx - 0.15, lz - 0.15, lx + 0.15, lz + 0.15);
    let top = -1;
    for (let i = 0; i < this.candidates.length; i++) {
      const b = this.boxes[this.candidates[i]];
      if (!b || b.maxY < feetY + minRise || b.maxY > feetY + maxRise || b.maxY <= top || !this.overlapsCircle(b, lx, lz, 0.15)) continue;
      top = b.maxY;
    }
    if (top < 0) return -1;
    // Block mantling through intact window panes or solid upper obstructions on the ledge.
    if (
      this.rayHitDetail(x, top + 0.25, z, dirX, 0, dirZ, reach + 0.2, false) ||
      this.rayHitDetail(x, top + 0.95, z, dirX, 0, dirZ, reach + 0.2, false)
    ) {
      return -1;
    }
    return this.ceilingAt(lx, lz, 0.25, top + 0.01) > top + 1.2 ? top : -1;
  }

  private overlapsCircle(b: Box, x: number, z: number, radius: number): boolean {
    if (b.obb) {
      const o = b.obb;
      const wx = x - o.cx;
      const wz = z - o.cz;
      return Math.abs(wx * o.c - wz * o.s) <= o.hx + radius && Math.abs(wx * o.s + wz * o.c) <= o.hz + radius;
    }
    return x + radius > b.minX && x - radius < b.maxX && z + radius > b.minZ && z - radius < b.maxZ;
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

  /** Every box overlapping the square round (x, z) of half-size r: its bounds and, for a turned box, its frame. */
  boxesNear(x: number, z: number, r: number, visit: (b: Readonly<Pick<Box, 'minX' | 'minZ' | 'maxX' | 'maxZ' | 'minY' | 'maxY' | 'glass' | 'door' | 'obb'>>) => void): void {
    this.query(x - r, z - r, x + r, z + r);
    for (const id of [...this.candidates]) {
      const b = this.boxes[id];
      if (b) visit(b);
    }
  }

  private nextStamp(): number {
    if (this.stamp >= 0x70000000) {
      this.stamps.fill(0);
      this.stamp = 0;
    }
    return ++this.stamp;
  }

  private query(minX: number, minZ: number, maxX: number, maxZ: number): void {
    this.candidates.length = 0;
    const stamp = this.nextStamp();
    this.forCells(minX, minZ, maxX, maxZ, (key) => {
      const list = this.grid.get(key);
      if (!list) return;
      for (let i = 0; i < list.length; i++) {
        const id = list[i];
        if (this.stamps[id] === stamp) continue;
        this.stamps[id] = stamp;
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
  addBox(minX: number, minZ: number, maxX: number, maxZ: number, minY = ANY_Y_MIN, maxY = ANY_Y_MAX, glass = false, bodyOnly = false): void {
    this.data.push((minX + maxX) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2, minY, maxY, glass ? -1 : bodyOnly ? 2 : 1, 0);
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
