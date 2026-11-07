/*
 * What the survivor has seen of the world, for the map: 16 m cells around every place they walked (the
 * radius grows with orientation — police, the Турист trait), and their own marks. Saved compactly: the
 * sorted cell keys as deltas. A new survivor starts with a blank map.
 */

/** Cell size, m. */
export const MAP_CELL = 16;
/** How far round the player the map opens, m (times orientation). */
export const MAP_SEEN = 44;
/** Most marks kept. */
const MAX_MARKS = 40;

export interface MapSave {
  cells: number[];
  marks: [number, number][];
}

const key = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);

export class MapMemory {
  private readonly cells = new Set<number>();
  readonly marks: [number, number][] = [];
  /** Bumped on every change (the map redraws). */
  version = 0;

  has(ci: number, cj: number): boolean {
    return this.cells.has(key(ci, cj));
  }

  get size(): number {
    return this.cells.size;
  }

  /** Opens the cells within `radius` of (x, z). */
  explore(x: number, z: number, radius: number): void {
    const r = Math.ceil(radius / MAP_CELL);
    const ci0 = Math.floor(x / MAP_CELL);
    const cj0 = Math.floor(z / MAP_CELL);
    let added = false;
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const ci = ci0 + di;
        const cj = cj0 + dj;
        const k = key(ci, cj);
        if (this.cells.has(k)) continue;
        // Nearest point of the cell to the player.
        const nx = Math.max(ci * MAP_CELL, Math.min(x, (ci + 1) * MAP_CELL));
        const nz = Math.max(cj * MAP_CELL, Math.min(z, (cj + 1) * MAP_CELL));
        if (Math.hypot(nx - x, nz - z) > radius) continue;
        this.cells.add(k);
        added = true;
      }
    }
    if (added) this.version++;
  }

  /** A mark at (x, z), or removes the one within `near` m of it. */
  toggleMark(x: number, z: number, near: number): void {
    const i = this.marks.findIndex(([mx, mz]) => Math.hypot(mx - x, mz - z) <= near);
    if (i >= 0) this.marks.splice(i, 1);
    else {
      this.marks.push([Math.round(x), Math.round(z)]);
      if (this.marks.length > MAX_MARKS) this.marks.shift();
    }
    this.version++;
  }

  clear(): void {
    this.cells.clear();
    this.marks.length = 0;
    this.version++;
  }

  serialize(): MapSave {
    const sorted = [...this.cells].sort((a, b) => a - b);
    const cells: number[] = [];
    let prev = 0;
    for (const k of sorted) {
      cells.push(k - prev);
      prev = k;
    }
    return { cells, marks: this.marks.map(([x, z]) => [x, z]) };
  }

  restore(s: MapSave | undefined): void {
    this.clear();
    if (!s) return;
    let k = 0;
    for (const d of s.cells ?? []) {
      k += d;
      this.cells.add(k);
    }
    for (const m of s.marks ?? []) if (Array.isArray(m) && m.length === 2) this.marks.push([Number(m[0]) || 0, Number(m[1]) || 0]);
    this.version++;
  }
}
