import { registerDataLocalizer } from '../core/i18n';
import { mulberry32 } from '../core/random';
import type { Zone } from '../world/gen/layout';
import { hash3 } from '../world/gen/noise';
import { type ItemId, ITEMS, type ItemStack } from './items';

export type ContainerType =
  | 'fridge'
  // A dead survivor of yours, killed again: what they wore and carried (filled by the scene, never rolled).
  | 'bodyTwin'
  | 'bodyBandit'
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
  | 'armory'
  | 'superShelf'
  | 'clothesRack'
  | 'warehouse'
  | 'plantStore'
  | 'militaryCrate'
  // The military base's armoury crates (the only RPGs).
  | 'baseArmory'
  | 'bodyZombie'
  // The laboratory.
  | 'labLocker'
  | 'labBench'
  | 'labFridge'
  | 'labDesk'
  | 'serverRack'
  | 'labTools'
  | 'isolation'
  | 'generator'
  // The airport and the military base.
  | 'checkin'
  | 'planeCabin'
  | 'cargoHold'
  | 'militaryLocker'
  | 'canteen'
  | 'vehicleCabin'
  // Survivors' camps: the better stash.
  | 'campStash'
  // The survivor's own chest (Base): never rolled, keeps what is put in.
  | 'stash';

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
      ['rag', 4], ['bandage', 3], ['painkillers', 2], ['batteries', 1], ['rope', 1], ['bat', 1], ['antibiotics', 0.3], ['maskHalf', 0.8],
      ['soap', 1], ['tshirt', 2], ['hoodie', 1.5], ['leatherJacket', 0.6], ['jeans', 1.5], ['cargoPants', 1], ['sneakers', 1.2], ['boots', 0.6], ['backpackSchool', 0.5], ['backpackHiking', 0.2], ['workGloves', 0.6],
      ['shotgun_pump', 0.04], ['rifle_hunting', 0.05], ['ammo_12', 0.12], ['ammo_308', 0.1],
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
  crate: { name: 'Ящик', empty: 0.25, rolls: [1, 3], items: [['planks', 3], ['nails', 4], ['hammer', 1], ['rope', 2], ['tape', 2], ['water', 2], ['crowbar', 0.6], ['helmetConstruction', 0.8], ['workJacket', 0.6], ['boots', 0.5], ['maskHalf', 0.8], ['wrench', 0.8], ['engineParts', 0.9], ['jerrycan', 0.6]] },
  trunk: { name: 'Багажник', empty: 0.4, rolls: [1, 3], items: [['water', 3], ['crowbar', 1], ['rope', 2], ['tape', 2], ['batteries', 2], ['bandage', 1], ['junk', 3], ['axe', 0.4], ['workJacket', 0.5], ['boots', 0.4], ['jerrycan', 1.8], ['carTire', 1.4], ['wrench', 1.2], ['carBattery', 0.9], ['engineParts', 1.1], ['carKey', 0.8]] },
  trash: { name: 'Мусорный бак', empty: 0.55, rolls: [1, 2], items: [['junk', 6], ['chips', 1], ['soda', 1], ['rag', 1], ['emptyBottle', 2]] },
  stash: { name: 'Сундук', empty: 1, rolls: [0, 0], items: [] },
  desk: { name: 'Стол', empty: 0.35, rolls: [1, 2], items: [['batteries', 3], ['chocolate', 3], ['painkillers', 2], ['tape', 2], ['lighter', 2], ['junk', 3]] },
  cabinet: { name: 'Шкаф для бумаг', empty: 0.5, rolls: [1, 2], items: [['junk', 4], ['tape', 2], ['bandage', 1], ['batteries', 1], ['rope', 1]] },
  nightstand: { name: 'Тумбочка', empty: 0.35, rolls: [1, 2], items: [['painkillers', 2], ['batteries', 2], ['lighter', 2], ['matches', 2], ['bandage', 1], ['chocolate', 1], ['junk', 3], ['pistol_m1911', 0.06], ['pistol_g17', 0.04], ['ammo_45', 0.15], ['ammo_9mm', 0.15]] },
  bookcase: { name: 'Книжный шкаф', empty: 0.55, rolls: [1, 1], items: [['junk', 5], ['matches', 1], ['batteries', 1], ['tape', 1]] },
  boxes: { name: 'Коробки', empty: 0.4, rolls: [1, 2], items: [['junk', 4], ['tshirt', 1.5], ['hoodie', 1], ['jeans', 1], ['rag', 2], ['tape', 1.5], ['rope', 1], ['soap', 0.6], ['backpackSchool', 0.4], ['workGloves', 0.6]] },
  // Packed in a hurry and left by the door: clothes, a bit of food, the medicine cabinet.
  suitcase: {
    name: 'Чемодан',
    empty: 0.25,
    rolls: [1, 3],
    items: [['tshirt', 2], ['hoodie', 1.5], ['jeans', 1.5], ['sneakers', 0.8], ['soap', 1], ['water', 1.5], ['crackers', 1.5], ['bandage', 1], ['painkillers', 1]],
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
    items: [['tshirt', 3], ['hoodie', 2], ['jeans', 2], ['cargoPants', 1], ['rag', 2], ['soap', 1.5], ['backpackHiking', 0.3]],
  },
  // Fallen in uniform: their gear and a few rounds (their weapon was taken).
  bodyMilitary: { name: 'Погибший военный', empty: 0.2, rolls: [1, 3], items: [['helmetMilitary', 1], ['militaryJacket', 0.8], ['combatBoots', 0.6], ['bandage', 2], ['water', 2], ['crackers', 2], ['batteries', 1.5], ['rope', 1], ['knife', 0.6], ['gorkaJacket', 0.4], ['gorkaPants', 0.4], ['vestMilitary', 0.5], ['backpackMilitary', 0.4], ['outfitMilitary', 0.35], ['ammo_556', 0.5], ['ammo_762', 0.4], ['mag_m4', 0.2], ['glassesBallistic', 0.3], ['shemagh', 0.35]] },
  bodyPolice: { name: 'Погибший полицейский', empty: 0.25, rolls: [1, 3], items: [['helmetSwat', 0.4], ['vestSwat', 0.3], ['batteries', 2], ['bandage', 1.5], ['tape', 1], ['bat', 0.6], ['water', 1], ['swatShirt', 0.3], ['tacticalGloves', 0.4], ['outfitPolice', 0.25], ['ammo_9mm', 0.5], ['mag_g17', 0.2], ['balaclava', 0.3]] },
  bodyMedic: { name: 'Погибший медик', empty: 0.2, rolls: [1, 3], items: [['bandage', 3], ['painkillers', 2.5], ['antibiotics', 1.5], ['scrubsTop', 0.6], ['soap', 1], ['water', 1], ['medGloves', 1], ['bagMedic', 0.5], ['outfitDoctor', 0.3]] },
  bodyTwin: { name: 'Ваш прошлый выживший', empty: 1, rolls: [0, 0], items: [] },
  bodyBandit: { name: 'Труп бандита', empty: 1, rolls: [0, 0], items: [] },
  bodyFire: { name: 'Погибший пожарный', empty: 0.25, rolls: [1, 3], items: [['helmetFire', 1], ['fireCoat', 0.5], ['axe', 0.4], ['rope', 1.5], ['water', 1.5], ['bandage', 1], ['fireGloves', 0.6], ['outfitFirefighter', 0.35]] },
  gasShelf: { name: 'Стеллаж', empty: 0.3, rolls: [1, 3], items: [['chips', 4], ['chocolate', 3], ['crackers', 3], ['beans', 2], ['water', 3], ['soda', 3], ['map', 1], ['tape', 1], ['batteries', 1.5], ['lighter', 1.5], ['jerrycan', 2.2], ['carBattery', 1.2], ['engineParts', 1.5]] },
  gasCounter: { name: 'Касса', empty: 0.25, rolls: [1, 2], items: [['map', 3], ['lighter', 3], ['batteries', 2], ['chocolate', 2], ['painkillers', 1], ['junk', 2], ['carKey', 1.5]] },
  garage: { name: 'Верстак', empty: 0.25, rolls: [1, 3], items: [['toolboxMechanic', 0.5], ['hammer', 1.5], ['crowbar', 1], ['tape', 3], ['nails', 3], ['rope', 2], ['workGloves', 1], ['planks', 1.5], ['rag', 2], ['workJacket', 0.5], ['outfitMechanic', 0.6], ['wrench', 2.5], ['jerrycan', 2.2], ['carBattery', 1.8], ['engineParts', 2.5], ['carTire', 2.0], ['carKey', 1.2]] },
  policeLocker: { name: 'Шкафчик', empty: 0.3, rolls: [1, 3], items: [['policeShirt', 2], ['policePants', 2], ['vestSwat', 0.4], ['batteries', 2], ['walkie', 1.5], ['tacticalGloves', 1], ['boots', 1], ['soap', 1], ['outfitPolice', 1.2], ['pistol_g17', 0.15], ['ammo_9mm', 0.6], ['ammo_12', 0.3], ['balaclava', 0.8]] },
  policeDesk: { name: 'Стол', empty: 0.3, rolls: [1, 2], items: [['batteries', 3], ['walkie', 1.5], ['painkillers', 1.5], ['junk', 3], ['tape', 1], ['chocolate', 1.5], ['map', 0.6]] },
  armory: { name: 'Стойка оружейной', empty: 0.1, rolls: [2, 3], items: [['helmetSwat', 1.5], ['vestSwat', 1.5], ['swatShirt', 1], ['swatPants', 1], ['tacticalGloves', 1.5], ['vestMilitary', 1], ['bat', 1], ['crowbar', 0.8], ['batteries', 2], ['walkie', 1.5], ['outfitSwat', 1], ['pistol_g17', 1.2], ['shotgun_pump', 0.8], ['rifle_m4a1', 0.4], ['ammo_9mm', 1.5], ['ammo_12', 1.2], ['ammo_556', 0.6], ['mag_g17', 0.8], ['mag_m4', 0.4], ['mod_flashlight', 0.5], ['mod_ext_mag_g17', 0.3], ['balaclava', 1.2], ['gogglesTactical', 0.5]] },
  superShelf: { name: 'Стеллаж', empty: 0.35, rolls: [1, 3], items: [['beans', 3], ['soup', 3], ['crackers', 3], ['chips', 3], ['chocolate', 2], ['water', 3], ['juice', 2], ['soda', 2], ['batteries', 1], ['tape', 1], ['soap', 1], ['rope', 0.6], ['lighter', 1]] },
  clothesRack: { name: 'Вешалка с одеждой', empty: 0.3, rolls: [1, 3], items: [['tshirt', 3], ['hoodie', 3], ['jeans', 3], ['cargoPants', 2], ['leatherJacket', 1], ['sneakers', 2], ['boots', 1], ['backpackSchool', 1.5], ['backpackHiking', 0.6]] },
  warehouse: { name: 'Паллета', empty: 0.25, rolls: [2, 4], items: [['beans', 3], ['soup', 3], ['water', 4], ['crackers', 2], ['juice', 2], ['tape', 1], ['rope', 1], ['planks', 1], ['batteries', 1]] },
  plantStore: { name: 'Шкаф с инструментом', empty: 0.25, rolls: [1, 3], items: [['water', 4], ['hammer', 1], ['crowbar', 1], ['tape', 2], ['rope', 2], ['workGloves', 1.5], ['helmetConstruction', 1], ['workJacket', 0.8], ['boots', 0.6], ['nails', 1], ['outfitBuilder', 0.7], ['maskHalf', 1.2]] },
  labLocker: { name: 'Шкафчик персонала', empty: 0.3, rolls: [1, 2], items: [['scrubsTop', 2], ['scrubsPants', 2], ['medGloves', 2], ['batteries', 1.5], ['chocolate', 1.5], ['painkillers', 1]] },
  labBench: { name: 'Лабораторный стол', empty: 0.25, rolls: [1, 2], items: [['medGloves', 2], ['bandage', 2], ['painkillers', 1.5], ['antibiotics', 0.8], ['tape', 1], ['lighter', 1]] },
  labFridge: { name: 'Холодильник с пробами', empty: 0.35, rolls: [1, 2], items: [['antibiotics', 1], ['painkillers', 1], ['water', 1.5], ['juice', 1]] },
  labDesk: { name: 'Стол', empty: 0.3, rolls: [1, 2], items: [['batteries', 2], ['painkillers', 1], ['chocolate', 1.5], ['map', 0.5], ['junk', 2]] },
  serverRack: { name: 'Серверная стойка', empty: 0.5, rolls: [1, 1], items: [['batteries', 2], ['tape', 1.5], ['junk', 2]] },
  labTools: { name: 'Шкаф инженера', empty: 0.2, rolls: [1, 3], items: [['tape', 2], ['batteries', 2], ['workGloves', 1.5], ['hammer', 0.8], ['crowbar', 0.6], ['rope', 1]] },
  isolation: { name: 'Медицинский шкаф изолятора', empty: 0.1, rolls: [2, 3], items: [['antibiotics', 2], ['painkillers', 2], ['bandage', 2], ['medGloves', 1], ['bagMedic', 0.6], ['serumG7', 0.5], ['outfitDoctor', 0.8]] },
  checkin: { name: 'Стойка регистрации', empty: 0.35, rolls: [1, 2], items: [['map', 1], ['batteries', 1.5], ['junk', 2], ['chocolate', 1], ['soda', 1], ['walkie', 0.5]] },
  planeCabin: { name: 'Салон самолёта', empty: 0.25, rolls: [1, 3], items: [['water', 2], ['juice', 2], ['crackers', 2], ['chocolate', 2], ['painkillers', 1], ['bandage', 1], ['backpackSchool', 0.6], ['hoodie', 1], ['jeans', 0.8]] },
  cargoHold: { name: 'Грузовой отсек', empty: 0.2, rolls: [2, 3], items: [['water', 3], ['beans', 2], ['soup', 2], ['rope', 1.5], ['tape', 1.5], ['batteries', 1.5], ['backpackHiking', 0.6], ['ration', 1]] },
  militaryLocker: { name: 'Армейский шкафчик', empty: 0.2, rolls: [1, 3], items: [['militaryJacket', 1.5], ['gorkaJacket', 1], ['gorkaPants', 1], ['combatBoots', 1.2], ['helmetMilitary', 1], ['vestMilitary', 1], ['backpackMilitary', 0.8], ['ration', 1.5], ['bandage', 1.5], ['outfitMilitary', 1.2], ['pistol_m1911', 0.25], ['ammo_45', 0.5], ['ammo_556', 0.5], ['ammo_762', 0.4], ['mag_m4', 0.3], ['glassesBallistic', 0.8], ['shemagh', 1]] },
  canteen: { name: 'Кухня столовой', empty: 0.25, rolls: [1, 3], items: [['ration', 3], ['beans', 2], ['soup', 2], ['crackers', 2], ['water', 2], ['knife', 0.5]] },
  vehicleCabin: { name: 'Кабина', empty: 0.3, rolls: [1, 2], items: [['ration', 2], ['water', 1.5], ['bandage', 1.5], ['map', 0.8], ['walkie', 0.8], ['batteries', 1], ['vestMilitary', 0.4], ['rope', 0.8]] },
  campStash: { name: 'Запасы лагеря', empty: 0.05, rolls: [2, 4], items: [['water', 3], ['beans', 2], ['soup', 2], ['ration', 1.5], ['bandage', 2], ['antibiotics', 0.8], ['painkillers', 1.5], ['batteries', 2], ['lighter', 1], ['rope', 1], ['tape', 1], ['backpackHiking', 0.4], ['map', 0.8]] },
  // Never rolled: the generator is started, not searched.
  generator: { name: 'Генератор', empty: 1, rolls: [0, 0], items: [] },
  militaryCrate: { name: 'Армейский ящик', empty: 0.3, rolls: [1, 3], items: [['crackers', 3], ['water', 3], ['bandage', 2], ['batteries', 2], ['helmetMilitary', 0.6], ['militaryJacket', 0.4], ['vestMilitary', 0.3], ['rope', 1], ['map', 1], ['outfitMilitary', 0.4], ['rifle_ak', 0.25], ['rifle_m4a1', 0.2], ['ammo_556', 0.8], ['ammo_762', 0.8], ['mag_ak', 0.4], ['mag_m4', 0.4], ['mod_suppressor', 0.15], ['mod_ext_mag_ak', 0.15], ['glassesBallistic', 0.5], ['shemagh', 0.6]] },
  baseArmory: {
    name: 'Оружейный ящик',
    empty: 0.35,
    rolls: [1, 2],
    items: [['rifle_m4a1', 1], ['rifle_ak', 1], ['launcher_rpg', 0.35], ['rocket_rpg', 0.5], ['ammo_556', 2], ['ammo_762', 2], ['mag_m4', 1], ['mag_ak', 1], ['mod_suppressor', 0.5], ['mod_ext_mag_m4', 0.4], ['mod_ext_mag_ak', 0.4], ['mod_flashlight', 0.4]],
  },
  bodyZombie: { name: 'Тело', empty: 0.5, rolls: [1, 2], items: [['junk', 4], ['batteries', 1.2], ['lighter', 1], ['chocolate', 1], ['bandage', 0.8], ['painkillers', 0.6], ['tshirt', 0.5], ['hoodie', 0.4], ['knife', 0.15], ['map', 0.3]] },
  reception: { name: 'Стойка охраны', empty: 0.2, rolls: [1, 3], items: [['batteries', 4], ['bat', 1], ['bandage', 2], ['painkillers', 2], ['soda', 2], ['crowbar', 0.6], ['axe', 0.5], ['helmetConstruction', 0.5], ['outfitBuilder', 0.15]] },
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
    // Rounds come a handful at a time (they are rare: a magazine's worth at most).
    const count = def.kind === 'ammo' && def.stack > 12 ? 4 + Math.floor(rand() * Math.min(11, def.stack / 3)) : def.stack > 1 && def.weight < 0.2 ? 1 + Math.floor(rand() * Math.min(3, def.stack)) : 1;
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

const LOOT_NAMES: Readonly<Record<ContainerType, [string, string]>> = {
  fridge: ['Холодильник', 'Fridge'],
  counter: ['Кухонный шкаф', 'Kitchen cabinet'],
  wardrobe: ['Шкаф', 'Wardrobe'],
  tvstand: ['Тумба', 'TV stand'],
  shelf: ['Стеллаж', 'Shelving unit'],
  shopCounter: ['Прилавок', 'Shop counter'],
  crate: ['Ящик', 'Crate'],
  trunk: ['Багажник', 'Car trunk'],
  trash: ['Мусорный бак', 'Trash bin'],
  stash: ['Сундук', 'Storage chest'],
  desk: ['Стол', 'Desk'],
  cabinet: ['Шкаф для бумаг', 'Filing cabinet'],
  nightstand: ['Тумбочка', 'Nightstand'],
  bookcase: ['Книжный шкаф', 'Bookcase'],
  boxes: ['Коробки', 'Boxes'],
  suitcase: ['Чемодан', 'Suitcase'],
  mailboxes: ['Почтовые ящики', 'Mailboxes'],
  pharmacy: ['Аптечная полка', 'Pharmacy shelf'],
  cooler: ['Витрина с напитками', 'Drink cooler'],
  cafe: ['Стойка кафе', 'Cafe counter'],
  laundry: ['Стиральная машина', 'Washing machine'],
  bodyMilitary: ['Погибший военный', 'Fallen soldier'],
  bodyPolice: ['Погибший полицейский', 'Fallen police officer'],
  bodyMedic: ['Погибший медик', 'Fallen medic'],
  bodyTwin: ['Ваш прошлый выживший', 'Your past survivor'],
  bodyBandit: ['Труп бандита', 'Bandit corpse'],
  bodyFire: ['Погибший пожарный', 'Fallen firefighter'],
  gasShelf: ['Стеллаж', 'Store shelf'],
  gasCounter: ['Касса', 'Cash register'],
  garage: ['Верстак', 'Workbench'],
  policeLocker: ['Шкафчик', 'Locker'],
  policeDesk: ['Стол', 'Desk'],
  armory: ['Стойка оружейной', 'Armory rack'],
  superShelf: ['Стеллаж', 'Supermarket shelf'],
  clothesRack: ['Вешалка с одеждой', 'Clothing rack'],
  warehouse: ['Паллета', 'Pallet'],
  plantStore: ['Шкаф с инструментом', 'Tool cabinet'],
  labLocker: ['Шкафчик персонала', 'Staff locker'],
  labBench: ['Лабораторный стол', 'Lab bench'],
  labFridge: ['Холодильник с пробами', 'Sample fridge'],
  labDesk: ['Стол', 'Desk'],
  serverRack: ['Серверная стойка', 'Server rack'],
  labTools: ['Шкаф инженера', 'Engineer cabinet'],
  isolation: ['Медицинский шкаф изолятора', 'Containment med cabinet'],
  checkin: ['Стойка регистрации', 'Check-in counter'],
  planeCabin: ['Салон самолёта', 'Plane cabin'],
  cargoHold: ['Грузовой отсек', 'Cargo hold'],
  militaryLocker: ['Армейский шкафчик', 'Army locker'],
  canteen: ['Кухня столовой', 'Mess hall kitchen'],
  vehicleCabin: ['Кабина', 'Vehicle cab'],
  campStash: ['Запасы лагеря', 'Camp stash'],
  generator: ['Генератор', 'Generator'],
  militaryCrate: ['Армейский ящик', 'Military crate'],
  baseArmory: ['Оружейный ящик', 'Weapons crate'],
  bodyZombie: ['Тело', 'Corpse'],
  reception: ['Стойка охраны', 'Security desk'],
};

registerDataLocalizer((lang) => {
  const idx = lang === 'en' ? 1 : 0;
  for (const [k, names] of Object.entries(LOOT_NAMES) as [ContainerType, [string, string]][]) {
    LOOT[k].name = names[idx];
  }
});
