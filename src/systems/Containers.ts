import { ensureStackUid, type ItemId, type ItemStack } from '../data/items';
import { type ContainerType, LOOT, rollLoot } from '../data/loot';
import type { Zone } from '../world/gen/layout';
import type { SearchBox } from '../world/gen/pieces';

export type CorpseSlotKey = 'hand' | 'head' | 'vest' | 'outfit' | 'back' | 'face' | 'mask' | 'torso' | 'hands' | 'legs' | 'feet';
export type CorpseZone = 'pockets' | 'rig' | 'backpack';

export interface CorpseData {
  name: string;
  tierLabel: string;
  tier: 'regular' | 'elite';
  slots: Partial<Record<CorpseSlotKey, ItemStack>>;
  pockets: ItemStack[];
  rig: ItemStack[];
  backpack: ItemStack[];
  searchedPockets: boolean;
  searchedRig: boolean;
  searchedBackpack: boolean;
}

export interface ContainerRef {
  id: number;
  type: ContainerType;
  x: number;
  z: number;
  /** Floor height (high-rise storeys). */
  y: number;
  zone: Zone;
  /** Search zone fitted to the object: centre, half sizes, turn about Y (absent: a default box at the spot). */
  box?: SearchBox;
  /** Always in it on the first search (a key, a note). */
  fixed?: ItemId[];
}

/** A container's search zone; old saves' bodies and the like without one get a box at the spot. */
export function searchBox(c: ContainerRef): SearchBox {
  return c.box ?? [c.x, c.y + 0.5, c.z, 0.45, 0.5, 0.45, 0];
}

/** Distance along a ray (unit direction) to where it enters a turned box, or −1 (inside counts as 0). */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: SearchBox): number {
  const [cx, cy, cz, hx, hy, hz, yaw] = b;
  // Into the box's frame: undo its turn about Y.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const px = ox - cx;
  const pz = oz - cz;
  const lo = [px * c - pz * s, oy - cy, px * s + pz * c];
  const ld = [dx * c - dz * s, dy, dx * s + dz * c];
  const h = [hx, hy, hz];
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(ld[a]) < 1e-9) {
      if (Math.abs(lo[a]) > h[a]) return -1;
      continue;
    }
    let ta = (-h[a] - lo[a]) / ld[a];
    let tb = (h[a] - lo[a]) / ld[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  if (t1 < 0) return -1;
  return Math.max(0, t0);
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
  private readonly corpses = new Map<number, CorpseData>();

  /** A chunk's containers came (the list) or went (null): weapons lying by them follow (weapons/GroundWeapons). */
  onChunk: ((key: number, list: readonly ContainerRef[] | null) => void) | null = null;

  constructor(readonly seed: number) {}

  addChunk(key: number, zone: Zone, list: { id: number; type: ContainerType; x: number; z: number; y?: number; fixed?: ItemId[]; box?: SearchBox }[]): void {
    const refs = list.map((c) => ({ ...c, y: c.y ?? 0, zone }));
    this.byChunk.set(key, refs);
    this.onChunk?.(key, refs);
  }

  removeChunk(key: number): void {
    this.byChunk.delete(key);
    this.onChunk?.(key, null);
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
  /**
   * The container whose search zone the ray (eye, unit direction) hits first within `reach`; `clear`
   * says whether nothing (a wall, another object) stands in front of that hit. Null if none, or blocked.
   */
  targetRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number, clear: (t: number) => boolean): ContainerRef | null {
    let best: ContainerRef | null = null;
    let bestT = reach;
    for (const list of [...this.byChunk.values(), this.loose]) {
      for (const c of list) {
        if (Math.abs(c.x - ox) > reach + 3 || Math.abs(c.z - oz) > reach + 3) continue;
        const t = rayBox(ox, oy, oz, dx, dy, dz, searchBox(c));
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = c;
        }
      }
    }
    return best && clear(bestT) ? best : null;
  }

  /** Every search zone near a point (debug drawing). */
  boxesNear(x: number, z: number, r: number): SearchBox[] {
    const out: SearchBox[] = [];
    for (const list of [...this.byChunk.values(), this.loose]) for (const c of list) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r) out.push(searchBox(c));
    return out;
  }

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
  addLoose(ref: ContainerRef, items: ItemStack[], corpse?: CorpseData): void {
    if (this.loose.some((c) => c.id === ref.id)) return;
    for (const s of items) ensureStackUid(s);
    this.loose.push(ref);
    if (!this.opened.has(ref.id)) this.opened.set(ref.id, items);
    if (corpse) {
      for (const st of Object.values(corpse.slots)) if (st) ensureStackUid(st);
      for (const s of [...corpse.pockets, ...corpse.rig, ...corpse.backpack]) ensureStackUid(s);
      this.corpses.set(ref.id, corpse);
    }
  }

  /** Take a loose container away (a body cleared out of sight). */
  removeLoose(id: number): void {
    const i = this.loose.findIndex((c) => c.id === id);
    if (i >= 0) this.loose.splice(i, 1);
    this.corpses.delete(id);
  }

  corpseOf(ref: ContainerRef): CorpseData | null {
    return this.corpses.get(ref.id) ?? null;
  }

  searchCorpseZone(ref: ContainerRef, zone: CorpseZone): void {
    const c = this.corpses.get(ref.id);
    if (!c) return;
    if (zone === 'pockets') c.searchedPockets = true;
    else if (zone === 'rig') c.searchedRig = true;
    else c.searchedBackpack = true;
  }

  takeCorpseSlot(ref: ContainerRef, slot: CorpseSlotKey): ItemStack | null {
    const c = this.corpses.get(ref.id);
    const s = c?.slots[slot];
    if (!c || !s) return null;
    delete c.slots[slot];
    return s;
  }

  takeCorpseItem(ref: ContainerRef, zone: CorpseZone, uid: string, count: number): ItemStack | null {
    const c = this.corpses.get(ref.id);
    if (!c) return null;
    const list = zone === 'pockets' ? c.pockets : zone === 'rig' ? c.rig : c.backpack;
    const idx = list.findIndex((x) => ensureStackUid(x) === uid);
    if (idx < 0) return null;
    const s = list[idx];
    const take = Math.min(count, s.count);
    const out: ItemStack = { ...s, count: take };
    ensureStackUid(out);
    s.count -= take;
    if (s.count <= 0) list.splice(idx, 1);
    return out;
  }

  putCorpseItem(ref: ContainerRef, zone: CorpseZone, item: ItemStack): void {
    const c = this.corpses.get(ref.id);
    if (!c) return;
    ensureStackUid(item);
    const list = zone === 'pockets' ? c.pockets : zone === 'rig' ? c.rig : c.backpack;
    list.push(item);
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
      for (const s of items) ensureStackUid(s);
      this.opened.set(ref.id, items);
    } else {
      for (const s of items) ensureStackUid(s);
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

  takeByUid(ref: ContainerRef, uid: string, count: number): ItemStack | null {
    const items = this.contents(ref);
    const idx = items.findIndex((x) => ensureStackUid(x) === uid);
    if (idx < 0) return null;
    const s = items[idx];
    const take = Math.min(count, s.count);
    const out: ItemStack = { ...s, count: take };
    ensureStackUid(out);
    s.count -= take;
    if (s.count <= 0) items.splice(idx, 1);
    return out;
  }

  put(ref: ContainerRef, id: ItemId, count: number, dirt?: number, tint?: number): void {
    const items = this.contents(ref);
    // Clothing stays one piece per stack, with its own dirt.
    if (dirt !== undefined) {
      for (let n = 0; n < count; n++) {
        const st: ItemStack = tint !== undefined ? { id, count: 1, dirt, tint } : { id, count: 1, dirt };
        ensureStackUid(st);
        items.push(st);
      }
      return;
    }
    const s = items.find((x) => x.id === id);
    if (s) s.count += count;
    else {
      const st: ItemStack = { id, count };
      ensureStackUid(st);
      items.push(st);
    }
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
