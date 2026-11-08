import { ITEMS, type ItemId } from '../data/items';
import type { Inventory } from '../systems/Inventory';
import { capacityOf, GUNS, isGun, isMod, MOD_FITS } from './guns';

/**
 * `?give=rifle_m4a1,mod_suppressor,…` (checking guns): a gun comes loaded, with two magazines' worth of
 * rounds and a spare magazine, and goes into the hand; a mod goes onto the given gun that fits it;
 * anything else into the bag. Weight is not a limit here.
 */
export function giveLoadout(inv: Inventory, list: string): void {
  const ids = list.split(',').map((s) => s.trim()).filter((s): s is ItemId => s in ITEMS);
  if (ids.length === 0) return;
  inv.capacity += 200;
  let hand: ItemId | null = null;
  for (const id of ids) {
    if (isGun(id)) {
      const g = GUNS[id];
      if (!inv.has(id)) inv.add(id, 1);
      const inst = inv.gun(id);
      inv.add(g.caliber, capacityOf(id, inst.mods) * 2 + (g.feed === 'rocket' ? 1 : 0));
      if (g.mag) inv.add(g.mag, 1);
      hand ??= id;
      continue;
    }
    if (isMod(id)) {
      const gun = ids.find((g) => isGun(g) && MOD_FITS[id].includes(g as never));
      inv.add(id, 1);
      if (gun && isGun(gun)) inv.attachMod(gun, id);
      continue;
    }
    inv.add(id, ITEMS[id].stack > 1 ? ITEMS[id].stack : 1);
  }
  // Loaded after the mods are on (an extended magazine holds more).
  for (const id of ids) {
    if (!isGun(id)) continue;
    const inst = inv.gun(id);
    inst.mag = GUNS[id].feed === 'rocket' ? 0 : capacityOf(id, inst.mods);
    inst.chamber = true;
    inst.jammed = false;
  }
  if (hand && inv.hand !== hand) inv.equip(hand);
  inv.capacity -= 200;
  inv.version++;
}
