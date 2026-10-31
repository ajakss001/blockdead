import type { ItemId, ItemStack } from '../data/items';
import { type ContainerType, LOOT, rollLoot } from '../data/loot';
import type { Zone } from '../world/gen/layout';

export interface ContainerRef {
  id: number;
  type: ContainerType;
  x: number;
  z: number;
  /** Floor height (high-rise storeys). */
  y: number;
  zone: Zone;
  /** Always in it on the first search (a key, a note). */
  fixed?: ItemId[];
}

/**
 * Searchable containers of the loaded chunks, plus the contents of every container the player has
 * opened. Untouched containers cost nothing: their loot is rolled deterministically on first search,
 * so only `opened` needs saving.
 */
export class Containers {
  private readonly byChunk = new Map<number, ContainerRef[]>();
  private readonly opened = new Map<number, ItemStack[]>();
  /** Containers that are not part of any chunk (a fallen twin's body), with their contents. */
  private readonly loose: ContainerRef[] = [];

  constructor(readonly seed: number) {}

  addChunk(key: number, zone: Zone, list: { id: number; type: ContainerType; x: number; z: number; y?: number; fixed?: ItemId[] }[]): void {
    this.byChunk.set(key, list.map((c) => ({ ...c, y: c.y ?? 0, zone })));
  }

  removeChunk(key: number): void {
    this.byChunk.delete(key);
  }

  get loadedCount(): number {
    let n = 0;
    for (const l of this.byChunk.values()) n += l.length;
    return n;
  }

  get openedCount(): number {
    return this.opened.size;
  }

  /** Closest container within reach, on the player's storey, that the player is roughly facing. */
  target(x: number, z: number, dirX: number, dirZ: number, y = 0, reach = 1.9): ContainerRef | null {
    let best: ContainerRef | null = null;
    let bestScore = Infinity;
    for (const list of [...this.byChunk.values(), this.loose]) {
      for (const c of list) {
        if (Math.abs(c.y - y) > 1.4) continue;
        const dx = c.x - x;
        const dz = c.z - z;
        const d = Math.hypot(dx, dz);
        if (d > reach) continue;
        const facing = d > 0.01 ? (dx * dirX + dz * dirZ) / d : 1;
        if (facing < 0.35) continue;
        const score = d - facing * 0.6;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    return best;
  }

  /** A container of its own (a body) with these contents; its id must not clash with the chunks' (≥ 2e9). */
  addLoose(ref: ContainerRef, items: ItemStack[]): void {
    if (this.loose.some((c) => c.id === ref.id)) return;
    this.loose.push(ref);
    if (!this.opened.has(ref.id)) this.opened.set(ref.id, items);
  }

  /** Take a loose container away (a body cleared out of sight). */
  removeLoose(id: number): void {
    const i = this.loose.findIndex((c) => c.id === id);
    if (i >= 0) this.loose.splice(i, 1);
  }

  get looseRefs(): readonly ContainerRef[] {
    return this.loose;
  }

  name(ref: ContainerRef): string {
    return LOOT[ref.type].name;
  }

  isOpened(ref: ContainerRef): boolean {
    return this.opened.has(ref.id);
  }

  /** Contents (rolled and remembered on first access). Mutate via take/put. */
  contents(ref: ContainerRef): ItemStack[] {
    let items = this.opened.get(ref.id);
    if (!items) {
      items = rollLoot(this.seed, ref.id, ref.type, ref.zone);
      for (const id of ref.fixed ?? []) items.push({ id, count: 1 });
      this.opened.set(ref.id, items);
    }
    return items;
  }

  /** Dirt of the piece `take(ref, id, 1)` would take, 0 if none. */
  peekDirt(ref: ContainerRef, id: ItemId): number {
    return this.contents(ref).find((x) => x.id === id)?.dirt ?? 0;
  }

  peekTint(ref: ContainerRef, id: ItemId): number | undefined {
    return this.contents(ref).find((x) => x.id === id)?.tint;
  }

  take(ref: ContainerRef, id: ItemId, count: number): void {
    const items = this.contents(ref);
    const s = items.find((x) => x.id === id);
    if (!s) return;
    s.count -= count;
    if (s.count <= 0) items.splice(items.indexOf(s), 1);
  }

  put(ref: ContainerRef, id: ItemId, count: number, dirt?: number, tint?: number): void {
    const items = this.contents(ref);
    // Clothing stays one piece per stack, with its own dirt.
    if (dirt !== undefined) {
      for (let n = 0; n < count; n++) items.push(tint !== undefined ? { id, count: 1, dirt, tint } : { id, count: 1, dirt });
      return;
    }
    const s = items.find((x) => x.id === id);
    if (s) s.count += count;
    else items.push({ id, count });
  }

  serialize(): [number, [ItemId, number, number?, number?][]][] {
    return [...this.opened].map(([id, items]) => [
      id,
      items.map((s) => (s.tint !== undefined ? [s.id, s.count, s.dirt ?? 0, s.tint] : s.dirt !== undefined ? [s.id, s.count, s.dirt] : [s.id, s.count]) as [ItemId, number, number?, number?]),
    ]);
  }

  restore(data: [number, [ItemId, number, number?, number?][]][]): void {
    this.opened.clear();
    for (const [id, items] of data) {
      this.opened.set(id, items.map(([item, count, dirt, tint]) => ({ id: item, count, ...(dirt !== undefined ? { dirt } : {}), ...(tint !== undefined ? { tint } : {}) })));
    }
  }
}
