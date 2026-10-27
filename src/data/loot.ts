import { mulberry32 } from '../core/random';
import type { Zone } from '../world/gen/layout';
import { hash3 } from '../world/gen/noise';
import { type ItemId, ITEMS, type ItemStack } from './items';

export type ContainerType =
  | 'fridge'
  | 'counter'
  | 'wardrobe'
  | 'tvstand'
  | 'shelf'
  | 'shopCounter'
  | 'crate'
  | 'trunk'
  | 'trash'
  | 'desk'
  | 'cabinet'
  | 'reception';

interface LootTable {
  name: string;
  /** Chance the container is already empty (someone was here first). */
  empty: number;
  rolls: [number, number];
  items: [ItemId, number][];
}

/** Where things are: kitchens feed you, bathrooms/bedrooms heal you, trunks and storerooms equip you. */
export const LOOT: Readonly<Record<ContainerType, LootTable>> = {
  fridge: { name: 'Холодильник', empty: 0.35, rolls: [1, 3], items: [['soda', 4], ['juice', 4], ['water', 3], ['apple', 3], ['soup', 1]] },
  counter: {
    name: 'Кухонный шкаф',
    empty: 0.25,
    rolls: [1, 3],
    items: [['beans', 5], ['soup', 4], ['crackers', 4], ['chips', 3], ['knife', 1], ['matches', 2], ['batteries', 2], ['rag', 2]],
  },
  wardrobe: {
    name: 'Шкаф',
    empty: 0.3,
    rolls: [1, 2],
    items: [
      ['rag', 4], ['bandage', 3], ['painkillers', 2], ['batteries', 1], ['rope', 1], ['bat', 1], ['antibiotics', 0.3],
      ['hoodie', 1.5], ['leatherJacket', 0.6], ['jeans', 1.5], ['cargoPants', 1], ['sneakers', 1.2], ['boots', 0.6], ['cap', 1], ['beanie', 1],
    ],
  },
  tvstand: { name: 'Тумба', empty: 0.4, rolls: [1, 2], items: [['batteries', 4], ['lighter', 2], ['tape', 2], ['chocolate', 2], ['junk', 3]] },
  shelf: {
    name: 'Стеллаж',
    empty: 0.2,
    rolls: [2, 4],
    items: [['beans', 4], ['soup', 4], ['chips', 4], ['chocolate', 3], ['crackers', 3], ['water', 3], ['soda', 3], ['batteries', 2], ['bandage', 1], ['painkillers', 1]],
  },
  shopCounter: { name: 'Прилавок', empty: 0.3, rolls: [1, 3], items: [['chocolate', 4], ['batteries', 3], ['lighter', 3], ['painkillers', 1], ['tape', 1], ['antibiotics', 0.4]] },
  crate: { name: 'Ящик', empty: 0.25, rolls: [1, 3], items: [['planks', 3], ['nails', 4], ['hammer', 1], ['rope', 2], ['tape', 2], ['water', 2], ['crowbar', 0.6], ['hardhat', 0.8], ['workJacket', 0.6], ['boots', 0.5]] },
  trunk: { name: 'Багажник', empty: 0.4, rolls: [1, 3], items: [['water', 3], ['crowbar', 1], ['rope', 2], ['tape', 2], ['batteries', 2], ['bandage', 1], ['junk', 3], ['axe', 0.4], ['workJacket', 0.5], ['boots', 0.4]] },
  trash: { name: 'Мусорный бак', empty: 0.55, rolls: [1, 2], items: [['junk', 6], ['chips', 1], ['soda', 1], ['rag', 1]] },
  desk: { name: 'Стол', empty: 0.35, rolls: [1, 2], items: [['batteries', 3], ['chocolate', 3], ['painkillers', 2], ['tape', 2], ['lighter', 2], ['junk', 3]] },
  cabinet: { name: 'Шкаф для бумаг', empty: 0.5, rolls: [1, 2], items: [['junk', 4], ['tape', 2], ['bandage', 1], ['batteries', 1], ['rope', 1]] },
  reception: { name: 'Стойка охраны', empty: 0.2, rolls: [1, 3], items: [['batteries', 4], ['bat', 1], ['bandage', 2], ['painkillers', 2], ['soda', 2], ['crowbar', 0.6], ['axe', 0.5], ['hardhat', 0.5], ['cap', 1]] },
};

/** Towns were looted less (people fled first) and have more to begin with. */
const ZONE_BONUS: Record<Zone, number> = { downtown: 1, town: 1, suburb: 0, forest: 0, field: 0 };

/**
 * Deterministic contents of a container on first search: same seed + same container → same loot,
 * so only containers the player has touched need saving.
 */
export function rollLoot(seed: number, containerId: number, type: ContainerType, zone: Zone): ItemStack[] {
  const rand = mulberry32(hash3(seed, containerId, 7919));
  const table = LOOT[type];
  if (rand() < table.empty) return [];
  const [min, max] = table.rolls;
  const rolls = min + Math.floor(rand() * (max - min + 1)) + ZONE_BONUS[zone];
  const total = table.items.reduce((s, [, w]) => s + w, 0);
  const out: ItemStack[] = [];
  for (let r = 0; r < rolls; r++) {
    let pick = rand() * total;
    let id: ItemId = table.items[0][0];
    for (const [item, w] of table.items) {
      pick -= w;
      if (pick <= 0) {
        id = item;
        break;
      }
    }
    const def = ITEMS[id];
    const count = def.stack > 1 && def.weight < 0.2 ? 1 + Math.floor(rand() * Math.min(3, def.stack)) : 1;
    const existing = out.find((s) => s.id === id);
    if (existing && existing.count + count <= def.stack) existing.count += count;
    else out.push({ id, count });
  }
  return out;
}
