import type { Vector3 } from 'three';

const CELL = 4;
const MAX_ITERATIONS = 3;

interface Box {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Static XZ collision: axis-aligned boxes in a uniform grid; movers are vertical cylinders
 * (circles in XZ). The world is flat for now — vertical physics arrives with terrain in stage 2.
 */
export class CollisionWorld {
  private readonly boxes: Box[] = [];
  private readonly grid = new Map<number, number[]>();
  private readonly candidates: number[] = [];
  /** Per-box query stamp, de-duplicates boxes that span several cells without allocating. */
  private readonly stamps: number[] = [];
  private stamp = 0;

  get boxCount(): number {
    return this.boxes.length;
  }

  addBox(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const id = this.boxes.length;
    this.boxes.push({ minX, minZ, maxX, maxZ });
    this.stamps.push(0);
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const key = cellKey(ix, iz);
        const list = this.grid.get(key);
        if (list) list.push(id);
        else this.grid.set(key, [id]);
      }
    }
  }

  /** Box given by center and size. */
  addBoxCentered(cx: number, cz: number, sizeX: number, sizeZ: number): void {
    this.addBox(cx - sizeX / 2, cz - sizeZ / 2, cx + sizeX / 2, cz + sizeZ / 2);
  }

  /** Push a circle out of all boxes (mutates pos.x / pos.z). Sliding along walls falls out of this. */
  resolveCircle(pos: Vector3, radius: number): void {
    this.query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius);
    const r2 = radius * radius;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      let pushed = false;
      for (let i = 0; i < this.candidates.length; i++) {
        const b = this.boxes[this.candidates[i]];
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
    for (let ix = Math.floor(minX / CELL); ix <= Math.floor(maxX / CELL); ix++) {
      for (let iz = Math.floor(minZ / CELL); iz <= Math.floor(maxZ / CELL); iz++) {
        const list = this.grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const id = list[i];
          if (this.stamps[id] === stamp) continue;
          this.stamps[id] = stamp;
          this.candidates.push(id);
        }
      }
    }
  }
}

function cellKey(ix: number, iz: number): number {
  return (ix + 32768) * 65536 + (iz + 32768);
}
