import { BACKPACK_CAPACITY, type ItemId, ITEMS, type ItemStack, onePiece, WEAR_SLOTS, type WearSlot } from '../data/items';

export type Worn = Record<WearSlot, ItemId | null>;

export interface InventoryData {
  /** [id, count, dirt?, tint?] — dirt and tint only on clothing. */
  stacks: [ItemId, number, number?, number?][];
  hand: ItemId | null;
  /** Wear of the weapon in hand, 0..1. */
  handWear?: number;
  worn?: Partial<Worn>;
  /** Dirt of the worn pieces, 0..1 (older saves: clean). */
  wornDirt?: Partial<Record<WearSlot, number>>;
  /** Colors of worn pieces that differ from the item default. */
  wornTint?: Partial<Record<WearSlot, number>>;
}

/**
 * Stacks of items under a weight limit, the item held in the right hand and the clothes worn.
 * Worn clothes don't count toward the backpack's weight (they are on the body, not in the bag).
 */
export class Inventory {
  readonly stacks: ItemStack[] = [];
  hand: ItemId | null = 'knife';
  /** How worn the weapon in hand is, 0..1 (it breaks at 1). */
  handWear = 0;
  readonly worn: Worn = { head: null, torso: null, vest: null, hands: null, legs: null, feet: null, back: null };
  readonly wornDirt: Record<WearSlot, number> = { head: 0, torso: 0, vest: 0, hands: 0, legs: 0, feet: 0, back: 0 };
  readonly wornTint: Partial<Record<WearSlot, number>> = {};
  /** Bumped on every change, so UI can redraw lazily. */
  version = 0;

  /** Backpack limit, kg (the class can add or take a little). */
  capacity: number;

  constructor(capacity = BACKPACK_CAPACITY) {
    this.capacity = capacity;
  }

  /** What the bag weighs as carried: the contents, made lighter by a good backpack. */
  get weight(): number {
    return this.rawWeight * (1 - this.reduce);
  }

  /** The contents as they are. */
  get rawWeight(): number {
    let w = this.hand ? ITEMS[this.hand].weight : 0;
    for (const s of this.stacks) w += ITEMS[s.id].weight * s.count;
    return w;
  }

  /** Carry limit: pockets and the class (`capacity`) plus the bag on the back and a vest's pouches. */
  get limit(): number {
    let l = this.capacity;
    for (const slot of WEAR_SLOTS) {
      const id = this.worn[slot];
      if (id) l += ITEMS[id].wear?.pack?.capacity ?? 0;
    }
    return l;
  }

  /** How much lighter the bag makes its contents (0..1). */
  get reduce(): number {
    const id = this.worn.back;
    return id ? (ITEMS[id].wear?.pack?.reduce ?? 0) : 0;
  }

  count(id: ItemId): number {
    let n = 0;
    for (const s of this.stacks) if (s.id === id) n += s.count;
    return n;
  }

  /** How many of `id` fit by weight. */
  room(id: ItemId): number {
    return Math.max(0, Math.floor((this.limit - this.weight + 1e-6) / (ITEMS[id].weight * (1 - this.reduce))));
  }

  /** Adds up to `count`; returns how many were actually added. Clothing keeps its `dirt`. */
  add(id: ItemId, count = 1, dirt = 0, tint?: number): number {
    const def = ITEMS[id];
    let left = Math.min(count, this.room(id));
    const added = left;
    for (const s of this.stacks) {
      if (left === 0) break;
      if (s.id !== id || s.count >= def.stack) continue;
      const put = Math.min(left, def.stack - s.count);
      s.count += put;
      left -= put;
    }
    while (left > 0) {
      const put = Math.min(left, def.stack);
      this.stacks.push(onePiece(def) ? { id, count: put, dirt, ...(tint !== undefined ? { tint } : {}) } : { id, count: put });
      left -= put;
    }
    if (added > 0) this.version++;
    return added;
  }

  /** Dirt of the piece `remove(id, 1)` would take (the last stack of it), 0 if none. */
  peekDirt(id: ItemId): number {
    for (let i = this.stacks.length - 1; i >= 0; i--) if (this.stacks[i].id === id) return this.stacks[i].dirt ?? 0;
    return 0;
  }

  /** Tint of the piece `remove(id, 1)` would take, if it has one. */
  peekTint(id: ItemId): number | undefined {
    for (let i = this.stacks.length - 1; i >= 0; i--) if (this.stacks[i].id === id) return this.stacks[i].tint;
    return undefined;
  }

  /** Removes up to `count` of `id`; returns how many were removed. */
  remove(id: ItemId, count = 1): number {
    let left = count;
    for (let i = this.stacks.length - 1; i >= 0 && left > 0; i--) {
      const s = this.stacks[i];
      if (s.id !== id) continue;
      const take = Math.min(left, s.count);
      s.count -= take;
      left -= take;
      if (s.count === 0) this.stacks.splice(i, 1);
    }
    if (left < count) this.version++;
    return count - left;
  }

  /**
   * Puts on clothing from the backpack; what was in that slot goes back into the backpack.
   * Returns false if it isn't clothing, isn't in the bag, or the old piece doesn't fit.
   */
  wear(id: ItemId): boolean {
    const slot = ITEMS[id].wear?.slot;
    if (!slot || this.count(id) === 0) return false;
    const old = this.worn[slot];
    const oldDirt = this.wornDirt[slot];
    const oldTint = this.wornTint[slot];
    const dirt = this.peekDirt(id);
    const tint = this.peekTint(id);
    this.remove(id, 1);
    if (old && this.add(old, 1, oldDirt, oldTint) === 0) {
      this.add(id, 1, dirt, tint);
      return false;
    }
    this.worn[slot] = id;
    this.wornDirt[slot] = dirt;
    if (tint !== undefined) this.wornTint[slot] = tint;
    else delete this.wornTint[slot];
    this.version++;
    return true;
  }

  /** Takes off into the backpack; false if it doesn't fit. */
  takeOff(slot: WearSlot): boolean {
    const id = this.worn[slot];
    if (!id) return false;
    // A bag (or pouches) can come off only if everything still fits without it.
    const pack = ITEMS[id].wear?.pack;
    if (pack) {
      const reduce = slot === 'back' ? 0 : this.reduce;
      if ((this.rawWeight + ITEMS[id].weight) * (1 - reduce) > this.limit - pack.capacity + 1e-6) return false;
    }
    if (this.add(id, 1, this.wornDirt[slot], this.wornTint[slot]) === 0) return false;
    this.worn[slot] = null;
    this.wornDirt[slot] = 0;
    delete this.wornTint[slot];
    this.version++;
    return true;
  }

  /** Takes a hand-held item from the backpack; the previous one goes back in. */
  equip(id: ItemId): boolean {
    if (!ITEMS[id].equip || this.hand === id) return false;
    const wear = this.peekDirt(id);
    if (this.remove(id, 1) === 0) return false;
    const prev = this.hand;
    const prevWear = this.handWear;
    this.hand = id;
    this.handWear = wear;
    if (prev && this.add(prev, 1, prevWear) === 0) {
      this.hand = prev;
      this.handWear = prevWear;
      this.add(id, 1, wear);
      return false;
    }
    this.version++;
    return true;
  }

  /** Hand → backpack; false if it doesn't fit. */
  holster(): boolean {
    if (!this.hand) return false;
    if (this.add(this.hand, 1, this.handWear) === 0) return false;
    this.hand = null;
    this.handWear = 0;
    this.version++;
    return true;
  }

  /** A blow of the weapon in hand landed: it wears by one of its blows. True when it just broke (gone from the hand). */
  wearHand(): boolean {
    const n = this.hand ? ITEMS[this.hand].durability : undefined;
    if (!n) return false;
    this.handWear = Math.min(1, this.handWear + 1 / n);
    if (this.handWear < 1 - 1e-6) return false;
    this.hand = null;
    this.handWear = 0;
    this.version++;
    return true;
  }

  serialize(): InventoryData {
    return {
      stacks: this.stacks.map((s) => (s.tint !== undefined ? [s.id, s.count, s.dirt ?? 0, s.tint] : s.dirt !== undefined ? [s.id, s.count, s.dirt] : [s.id, s.count])),
      hand: this.hand,
      handWear: this.handWear,
      worn: { ...this.worn },
      wornDirt: { ...this.wornDirt },
      wornTint: { ...this.wornTint },
    };
  }

  restore(data: InventoryData): void {
    this.stacks.length = 0;
    for (const [id, count, dirt, tint] of data.stacks) {
      if (!ITEMS[id]) continue;
      this.stacks.push(onePiece(ITEMS[id]) ? { id, count, dirt: dirt ?? 0, ...(tint !== undefined ? { tint } : {}) } : { id, count });
    }
    this.hand = data.hand && ITEMS[data.hand] ? data.hand : null;
    this.handWear = this.hand ? Math.min(1, Math.max(0, data.handWear ?? 0)) : 0;
    // Older saves: a piece that moved to another slot (the SWAT vest) goes there; no bag slot yet → the
    // school backpack everyone had built in.
    const saved: Partial<Worn> = { ...data.worn };
    for (const slot of WEAR_SLOTS) {
      const id = saved[slot];
      const real = id ? ITEMS[id]?.wear?.slot : undefined;
      if (id && real && real !== slot && !saved[real]) {
        saved[real] = id;
        saved[slot] = null;
      }
    }
    if (data.worn && !('back' in data.worn)) saved.back = 'schoolBackpack';
    for (const slot of WEAR_SLOTS) {
      const id = saved[slot] ?? null;
      this.worn[slot] = id && ITEMS[id]?.wear?.slot === slot ? id : null;
      this.wornDirt[slot] = this.worn[slot] ? Math.min(1, Math.max(0, data.wornDirt?.[slot] ?? 0)) : 0;
      const tint = data.wornTint?.[slot];
      if (this.worn[slot] && tint !== undefined) this.wornTint[slot] = tint;
      else delete this.wornTint[slot];
    }
    this.version++;
  }
}
