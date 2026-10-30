import { mulberry32 } from '../core/random';
import type { Zone } from '../world/gen/layout';
import { hash3 } from '../world/gen/noise';
import { type ItemId, ITEMS, type ItemStack } from './items';

export type ContainerType =
  | 'fridge'
  // A dead survivor of yours, killed again: what they wore and carried (filled by the scene, never rolled).
  | 'bodyTwin'
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
  | 'reception'
  | 'nightstand'
  | 'bookcase'
  | 'boxes'
  | 'suitcase'
  | 'mailboxes'
  | 'pharmacy'
  | 'cooler'
  | 'cafe'
  | 'laundry'
  | 'bodyMilitary'
  | 'bodyPolice'
  | 'bodyMedic'
  | 'bodyFire'
  // POI.
  | 'gasShelf'
  | 'gasCounter'
  | 'garage'
  | 'policeLocker'
  | 'policeDesk'
  | 'armory';

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
      ['soap', 1], ['tshirt', 2], ['hoodie', 1.5], ['leatherJacket', 0.6], ['jeans', 1.5], ['cargoPants', 1], ['sneakers', 1.2], ['boots', 0.6], ['cap', 1], ['beanie', 1], ['schoolBackpack', 0.5], ['sportsBag', 0.4], ['hikingBackpack', 0.2], ['workGloves', 0.6],
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
  nightstand: { name: 'Тумбочка', empty: 0.35, rolls: [1, 2], items: [['painkillers', 2], ['batteries', 2], ['lighter', 2], ['matches', 2], ['bandage', 1], ['chocolate', 1], ['junk', 3]] },
  bookcase: { name: 'Книжный шкаф', empty: 0.55, rolls: [1, 1], items: [['junk', 5], ['matches', 1], ['batteries', 1], ['tape', 1]] },
  boxes: { name: 'Коробки', empty: 0.4, rolls: [1, 2], items: [['junk', 4], ['tshirt', 1.5], ['hoodie', 1], ['jeans', 1], ['rag', 2], ['tape', 1.5], ['rope', 1], ['soap', 0.6], ['schoolBackpack', 0.4], ['workGloves', 0.6]] },
  // Packed in a hurry and left by the door: clothes, a bit of food, the medicine cabinet.
  suitcase: {
    name: 'Чемодан',
    empty: 0.25,
    rolls: [1, 3],
    items: [['tshirt', 2], ['hoodie', 1.5], ['jeans', 1.5], ['sneakers', 0.8], ['beanie', 0.8], ['soap', 1], ['water', 1.5], ['crackers', 1.5], ['bandage', 1], ['painkillers', 1]],
  },
  mailboxes: { name: 'Почтовые ящики', empty: 0.7, rolls: [1, 1], items: [['junk', 6], ['batteries', 0.5]] },
  pharmacy: {
    name: 'Аптечная полка',
    empty: 0.35,
    rolls: [1, 3],
    items: [['bandage', 4], ['painkillers', 4], ['antibiotics', 1.5], ['rag', 1], ['soap', 1.5], ['water', 1]],
  },
  cooler: { name: 'Витрина с напитками', empty: 0.35, rolls: [1, 3], items: [['water', 4], ['soda', 4], ['juice', 3]] },
  cafe: { name: 'Стойка кафе', empty: 0.35, rolls: [1, 3], items: [['crackers', 3], ['chocolate', 3], ['juice', 2], ['water', 2], ['soda', 2], ['knife', 0.5], ['rag', 1]] },
  // Clothes left in the drum: clean (see rollLoot).
  laundry: {
    name: 'Стиральная машина',
    empty: 0.45,
    rolls: [1, 2],
    items: [['tshirt', 3], ['hoodie', 2], ['jeans', 2], ['cargoPants', 1], ['beanie', 1], ['rag', 2], ['soap', 1.5], ['sportsBag', 0.6], ['hikingBackpack', 0.3]],
  },
  // Fallen in uniform: their gear (no firearms — stage 4+ decides on those).
  bodyMilitary: { name: 'Погибший военный', empty: 0.2, rolls: [1, 3], items: [['militaryHelmet', 1], ['militaryJacket', 0.8], ['combatBoots', 0.6], ['bandage', 2], ['water', 2], ['crackers', 2], ['batteries', 1.5], ['rope', 1], ['knife', 0.6], ['gorkaJacket', 0.4], ['gorkaPants', 0.4], ['tacticalRig', 0.5], ['armyBackpack', 0.4]] },
  bodyPolice: { name: 'Погибший полицейский', empty: 0.25, rolls: [1, 3], items: [['policeCap', 1], ['swatHelmet', 0.4], ['swatVest', 0.3], ['batteries', 2], ['bandage', 1.5], ['tape', 1], ['bat', 0.6], ['water', 1], ['policeVest', 0.5], ['swatShirt', 0.3], ['tacticalGloves', 0.4]] },
  bodyMedic: { name: 'Погибший медик', empty: 0.2, rolls: [1, 3], items: [['bandage', 3], ['painkillers', 2.5], ['antibiotics', 1.5], ['scrubsTop', 0.6], ['soap', 1], ['water', 1], ['medGloves', 1], ['medBag', 0.5]] },
  bodyTwin: { name: 'Ваш прошлый выживший', empty: 1, rolls: [0, 0], items: [] },
  bodyFire: { name: 'Погибший пожарный', empty: 0.25, rolls: [1, 3], items: [['fireHelmet', 1], ['fireCoat', 0.5], ['axe', 0.4], ['rope', 1.5], ['water', 1.5], ['bandage', 1], ['fireGloves', 0.6]] },
  gasShelf: { name: 'Стеллаж', empty: 0.3, rolls: [1, 3], items: [['chips', 4], ['chocolate', 3], ['crackers', 3], ['beans', 2], ['water', 3], ['soda', 3], ['map', 1], ['tape', 1], ['batteries', 1.5], ['lighter', 1.5]] },
  gasCounter: { name: 'Касса', empty: 0.25, rolls: [1, 2], items: [['map', 3], ['lighter', 3], ['batteries', 2], ['chocolate', 2], ['painkillers', 1], ['junk', 2]] },
  garage: { name: 'Верстак', empty: 0.25, rolls: [1, 3], items: [['hammer', 1.5], ['crowbar', 1], ['tape', 3], ['nails', 3], ['rope', 2], ['workGloves', 1], ['planks', 1.5], ['rag', 2], ['workJacket', 0.5]] },
  policeLocker: { name: 'Шкафчик', empty: 0.3, rolls: [1, 3], items: [['policeShirt', 2], ['policePants', 2], ['policeCap', 1.5], ['policeVest', 1], ['batteries', 2], ['walkie', 1.5], ['tacticalGloves', 1], ['boots', 1], ['soap', 1]] },
  policeDesk: { name: 'Стол', empty: 0.3, rolls: [1, 2], items: [['batteries', 3], ['walkie', 1.5], ['painkillers', 1.5], ['junk', 3], ['tape', 1], ['chocolate', 1.5], ['map', 0.6]] },
  armory: { name: 'Стойка оружейной', empty: 0.1, rolls: [2, 3], items: [['swatHelmet', 1.5], ['swatVest', 1.5], ['swatShirt', 1], ['swatPants', 1], ['tacticalGloves', 1.5], ['tacticalRig', 1], ['bat', 1], ['crowbar', 0.8], ['batteries', 2], ['walkie', 1.5]] },
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
    if (def.wear) {
      // Clothing: one piece per stack, each with its own dirt.
      const r = rand();
      const dirt = type === 'laundry' ? rand() * 0.03 : r < 0.55 ? rand() * 0.08 : r < 0.9 ? 0.08 + rand() * 0.27 : 0.5 + rand() * 0.35;
      out.push({ id, count: 1, dirt: Math.round(dirt * 100) / 100 });
      continue;
    }
    const existing = out.find((s) => s.id === id);
    if (existing && existing.count + count <= def.stack) existing.count += count;
    else out.push({ id, count });
  }
  return out;
}
