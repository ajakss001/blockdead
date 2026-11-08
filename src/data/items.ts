import { WEAPONS } from '../weapons/config';
import { AMMO, type AmmoId, GUN_IDS, GUNS, type GunId, MAGS, type MagId, MOD_IDS, MODS, type ModId } from '../weapons/guns';
/**
 * Item catalog. Effects are fractions of the 0..1 survival scales (hunger −0.3 = a third of an
 * empty stomach). Weights in kg; the backpack holds BACKPACK_CAPACITY.
 */
export type ItemId =
  | 'beans'
  | 'soup'
  | 'chips'
  | 'chocolate'
  | 'apple'
  | 'crackers'
  | 'water'
  | 'soda'
  | 'juice'
  | 'bandage'
  | 'rag'
  | 'painkillers'
  | 'antibiotics'
  | 'batteries'
  | 'knife'
  | 'bat'
  | 'hammer'
  | 'crowbar'
  | 'nails'
  | 'planks'
  | 'rope'
  | 'tape'
  | 'lighter'
  | 'matches'
  | 'junk'
  | 'axe'
  | 'hoodie'
  | 'leatherJacket'
  | 'workJacket'
  | 'jeans'
  | 'cargoPants'
  | 'sneakers'
  | 'boots'
  | 'tshirt'
  | 'soap'
  | 'militaryJacket'
  | 'militaryPants'
  | 'combatBoots'
  | 'swatPants'
  | 'policeShirt'
  | 'policePants'
  | 'fireCoat'
  | 'firePants'
  | 'scrubsTop'
  | 'scrubsPants'
  | 'officeShirt'
  | 'slacks'
  | 'dressShoes'
  // Equipment slots (vest, gloves, back) and uniforms that use them.
  | 'swatShirt'
  // Costumes (the outfit slot): a whole model of the character in the class's clothes.
  | 'outfitSwat'
  | 'outfitMilitary'
  | 'outfitPolice'
  | 'outfitFirefighter'
  | 'outfitDoctor'
  | 'outfitMechanic'
  | 'outfitBuilder'
  // Gear (models: public/models/gear, fitted to every body by tools/build-gear.mjs).
  | 'helmetMilitary'
  | 'helmetSwat'
  | 'helmetFire'
  | 'helmetConstruction'
  | 'vestMilitary'
  | 'vestSwat'
  | 'backpackMilitary'
  | 'backpackSchool'
  | 'backpackHiking'
  | 'bagMedic'
  | 'toolboxMechanic'
  | 'gorkaJacket'
  | 'gorkaPants'
  | 'workGloves'
  | 'fireGloves'
  | 'tacticalGloves'
  | 'medGloves'
  // POI finds.
  | 'map'
  | 'walkie'
  | 'armoryKey'
  | 'armoryNote'
  // The laboratory (POI stage 3): access cards, fuses, the code in four notes, the story, the serum.
  | 'keycardGreen'
  | 'keycardBlue'
  | 'fuse'
  | 'labNote1'
  | 'labNote2'
  | 'labNote3'
  | 'labNote4'
  | 'labJournal1'
  | 'labJournal2'
  | 'labJournal3'
  | 'serumG7'
  // The military base.
  | 'ration'
  // Survivors' camps (POI scenarios): what they wrote down.
  | 'campNote1'
  | 'campNote2'
  | 'campNote3'
  | 'campNote4'
  // Water at the base (stage 5.15): bottles to fill, rain water to boil.
  | 'emptyBottle'
  | 'dirtyWater'
  // Firearms, their ammunition, spare magazines and modules (weapons/guns).
  | GunId
  | AmmoId
  | MagId
  | ModId;

import type { CostumeId } from '../characters/assets';

export type ItemKind = 'food' | 'drink' | 'medical' | 'tool' | 'weapon' | 'material' | 'junk' | 'clothing' | 'ammo';

/** Body slots for clothing; the weapon goes to the hand. */
export type WearSlot = 'outfit' | 'head' | 'torso' | 'vest' | 'hands' | 'legs' | 'feet' | 'back' | 'bag';
export const WEAR_SLOTS: readonly WearSlot[] = ['outfit', 'head', 'torso', 'vest', 'hands', 'legs', 'feet', 'back', 'bag'];

/** Gear models (public/models/gear/<id>.glb and their fits to each body). */
export type GearId =
  | 'helmet_military'
  | 'helmet_swat'
  | 'helmet_firefighter'
  | 'helmet_construction'
  | 'vest_military'
  | 'vest_swat'
  | 'backpack_military'
  | 'backpack_school'
  | 'backpack_hiking'
  | 'bag_medic'
  | 'toolbox_mechanic';

/** What a piece of clothing does. Every field is summed over the worn set. */
export interface WearStats {
  /** Chance to stop a bite on that body part, 0..1 (stage 4). */
  bite: number;
  /** Insulation: how many °C warmer the air feels. */
  warmth: number;
}

/** How each stat is shown (item card, equipment summary). Order = display order. */
export const WEAR_STATS: readonly { key: keyof WearStats; label: string; format: (v: number) => string }[] = [
  { key: 'bite', label: 'Защита от укуса', format: (v) => `${Math.round(v * 100)}%` },
  { key: 'warmth', label: 'Тепло', format: (v) => `+${v}°` },
];

export interface WearDef {
  slot: WearSlot;
  /** Outfit only: the costume model it puts on (src/characters: the whole figure is that model). */
  costume?: CostumeId;
  /** How fast it gets dirty (1 = as any clothes; a field uniform hides it, white scrubs show everything). */
  soil?: number;
  /** Main color on the body (sleeves, trousers, shoe upper, paper doll). */
  color: number;
  stats: WearStats;
  /** Torso: false = short sleeves, forearms stay bare. */
  sleeves?: boolean;
  /** Feet only: which shoe model the legs get. */
  shoe?: 'sneakers' | 'boots';
  /** Bags (back, bag) and pouches (vest): how much it holds (kg) and how much lighter it makes what is in it (0..1). */
  pack?: { capacity: number; reduce: number };
  /** The gear model it is (head, vest, back, bag). */
  gear?: GearId;
}

export interface ItemDef {
  name: string;
  kind: ItemKind;
  weight: number;
  /** Max per inventory stack. */
  stack: number;
  hunger?: number;
  thirst?: number;
  fatigue?: number;
  health?: number;
  pain?: number;
  /** Dresses an open wound. */
  dressesWound?: boolean;
  /** Stops an early infection (antibiotics). */
  cures?: boolean;
  /** Restores the flashlight battery (0..1). */
  battery?: number;
  /** Can be held in the hand (melee arrives with zombies in stage 4). */
  equip?: boolean;
  /** Clothing: where and how it is worn. */
  wear?: WearDef;
  /** Weapons: blows that land before it breaks (weapons/config); how worn it is rides in the stack's `dirt`. */
  durability?: number;
  /** One line for the item card. */
  note?: string;
  /** Drinking it leaves an empty bottle. */
  bottle?: boolean;
  /** Chance it upsets the stomach (unboiled water). */
  sick?: number;
}

/** What you carry with no bag at all (pockets, hands), kg; bags (`back` slot) and vests add to it. */
export const BACKPACK_CAPACITY = 8;

/** The firearms and what goes with them (weapons/guns): weights, stacks, the card's line. */
const FIREARM_ITEMS = {
  ...Object.fromEntries(GUN_IDS.map((id) => [id, { name: GUNS[id].name, kind: 'weapon', weight: GUNS[id].weight, stack: 1, equip: true, durability: GUNS[id].durability, note: gunNote(id) }])),
  ...Object.fromEntries((Object.keys(AMMO) as AmmoId[]).map((id) => [id, { name: AMMO[id].name, kind: 'ammo', weight: AMMO[id].weight, stack: AMMO[id].stack }])),
  ...Object.fromEntries((Object.keys(MAGS) as MagId[]).map((id) => [id, { name: MAGS[id].name, kind: 'ammo', weight: MAGS[id].weight, stack: 6, note: 'Запасной: с ним перезарядка с пустым магазином быстрее' }])),
  ...Object.fromEntries(MOD_IDS.map((id) => [id, { name: MODS[id].name, kind: 'tool', weight: MODS[id].weight, stack: 1, note: MODS[id].note }])),
} as Record<GunId | AmmoId | MagId | ModId, ItemDef>;

function gunNote(id: GunId): string {
  const g = GUNS[id];
  return `${AMMO[g.caliber].name.replace('Патроны ', '')} · ${g.capacity} · слышно за ${g.noise} м`;
}

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  beans: { name: 'Консервы: фасоль', kind: 'food', weight: 0.45, stack: 6, hunger: -0.35, thirst: 0.04 },
  soup: { name: 'Консервы: суп', kind: 'food', weight: 0.45, stack: 6, hunger: -0.3, thirst: -0.08 },
  chips: { name: 'Чипсы', kind: 'food', weight: 0.15, stack: 6, hunger: -0.12, thirst: 0.06 },
  chocolate: { name: 'Шоколадка', kind: 'food', weight: 0.1, stack: 8, hunger: -0.1, fatigue: -0.08 },
  apple: { name: 'Яблоко (мягкое)', kind: 'food', weight: 0.2, stack: 6, hunger: -0.1, thirst: -0.05 },
  crackers: { name: 'Крекеры', kind: 'food', weight: 0.2, stack: 6, hunger: -0.15, thirst: 0.05 },
  water: { name: 'Бутылка воды', kind: 'drink', weight: 1.0, stack: 4, thirst: -0.5, bottle: true },
  emptyBottle: { name: 'Пустая бутылка', kind: 'tool', weight: 0.05, stack: 6, note: 'Набрать воды: из крана, пока она есть, или из сборника дождевой воды.' },
  dirtyWater: { name: 'Дождевая вода', kind: 'drink', weight: 1.0, stack: 4, thirst: -0.45, bottle: true, sick: 0.35, note: 'Лучше вскипятить на костре: сырая может скрутить живот.' },
  soda: { name: 'Газировка', kind: 'drink', weight: 0.35, stack: 6, thirst: -0.25, fatigue: -0.04 },
  juice: { name: 'Сок в коробке', kind: 'drink', weight: 0.25, stack: 6, thirst: -0.2, hunger: -0.04 },
  bandage: { name: 'Бинт', kind: 'medical', weight: 0.05, stack: 10, dressesWound: true, health: 0.05 },
  rag: { name: 'Чистая тряпка', kind: 'medical', weight: 0.1, stack: 10, dressesWound: true },
  painkillers: { name: 'Обезболивающее', kind: 'medical', weight: 0.05, stack: 10, pain: -0.5, health: 0.05 },
  antibiotics: { name: 'Антибиотики', kind: 'medical', weight: 0.05, stack: 5, health: 0.15, cures: true, note: 'Останавливают заражение, если принять рано.' },
  batteries: { name: 'Батарейки', kind: 'tool', weight: 0.1, stack: 8, battery: 1 },
  knife: { name: WEAPONS.tacticalKnife.name, kind: 'weapon', weight: 0.3, stack: 1, equip: true, durability: WEAPONS.tacticalKnife.durability, note: 'Быстрый, тихий, недалеко бьёт' },
  bat: { name: 'Бейсбольная бита', kind: 'weapon', weight: 1.0, stack: 1, equip: true, note: 'Длинная, сбивает с ног' },
  hammer: { name: WEAPONS.hammer.name, kind: 'tool', weight: 0.8, stack: 1, equip: true, durability: WEAPONS.hammer.durability, note: 'Инструмент и оружие' },
  crowbar: { name: WEAPONS.crowbar.name, kind: 'weapon', weight: 1.4, stack: 1, equip: true, durability: WEAPONS.crowbar.durability, note: 'Тяжёлый, вскрывает двери' },
  axe: { name: WEAPONS.fireAxe.name, kind: 'weapon', weight: 1.8, stack: 1, equip: true, durability: WEAPONS.fireAxe.durability, note: 'Медленный, но смертельный' },
  nails: { name: 'Гвозди', kind: 'material', weight: 0.02, stack: 50 },
  planks: { name: 'Доска', kind: 'material', weight: 1.8, stack: 4 },
  rope: { name: 'Верёвка', kind: 'material', weight: 0.5, stack: 3 },
  tape: { name: 'Скотч', kind: 'material', weight: 0.15, stack: 4 },
  lighter: { name: 'Зажигалка', kind: 'tool', weight: 0.05, stack: 3 },
  matches: { name: 'Спички', kind: 'tool', weight: 0.05, stack: 5 },
  junk: { name: 'Хлам', kind: 'junk', weight: 0.3, stack: 10 },
  soap: { name: 'Мыло', kind: 'tool', weight: 0.1, stack: 5, note: 'Для стирки одежды (скоро)' },
  // Clothing. Warmth in °C of felt temperature: jackets and boots warm the most, a T-shirt and sneakers the least.
  tshirt: { name: 'Футболка', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'torso', color: 0x8a8a7e, stats: { bite: 0.02, warmth: 1 }, sleeves: false } },
  hoodie: { name: 'Толстовка', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'torso', color: 0x3d4a5c, stats: { bite: 0.08, warmth: 6 } } },
  leatherJacket: { name: 'Кожаная куртка', kind: 'clothing', weight: 1.4, stack: 1, wear: { slot: 'torso', color: 0x2b2420, stats: { bite: 0.3, warmth: 9 } } },
  workJacket: { name: 'Рабочая куртка', kind: 'clothing', weight: 1.1, stack: 1, wear: { slot: 'torso', color: 0x5c5236, stats: { bite: 0.2, warmth: 10 } } },
  jeans: { name: 'Джинсы', kind: 'clothing', weight: 0.7, stack: 1, wear: { slot: 'legs', color: 0x2f3b52, stats: { bite: 0.12, warmth: 4 } } },
  cargoPants: { name: 'Штаны карго', kind: 'clothing', weight: 0.8, stack: 1, wear: { slot: 'legs', color: 0x4a4a36, stats: { bite: 0.15, warmth: 5 } } },
  sneakers: { name: 'Кроссовки', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'feet', color: 0x5e6266, stats: { bite: 0.05, warmth: 1 }, shoe: 'sneakers' } },
  boots: { name: 'Рабочие ботинки', kind: 'clothing', weight: 1.4, stack: 1, wear: { slot: 'feet', color: 0x4a3626, stats: { bite: 0.3, warmth: 4 }, shoe: 'boots' } },
  // Uniforms (class starting outfits; also found in the world).
  militaryJacket: { name: 'Армейский китель', kind: 'clothing', weight: 1.3, stack: 1, wear: { slot: 'torso', color: 0x4a5236, stats: { bite: 0.35, warmth: 8 } } },
  militaryPants: { name: 'Армейские брюки', kind: 'clothing', weight: 0.9, stack: 1, wear: { slot: 'legs', color: 0x4a5236, stats: { bite: 0.2, warmth: 5 } } },
  combatBoots: { name: 'Берцы', kind: 'clothing', weight: 1.5, stack: 1, wear: { slot: 'feet', color: 0x26231f, stats: { bite: 0.35, warmth: 5 }, shoe: 'boots' } },
  outfitSwat: { name: 'Форма SWAT', kind: 'clothing', weight: 3.2, stack: 1, note: 'Тактический комбинезон, наколенники, ботинки', wear: { slot: 'outfit', costume: 'swat', color: 0x262a30, soil: 0.8, stats: { bite: 0.35, warmth: 11 } } },
  outfitMilitary: { name: 'Полевая форма армии США', kind: 'clothing', weight: 2.6, stack: 1, note: 'Камуфляж, берцы', wear: { slot: 'outfit', costume: 'military', color: 0x5b5a3e, soil: 0.6, stats: { bite: 0.3, warmth: 12 } } },
  outfitPolice: { name: 'Полицейская форма', kind: 'clothing', weight: 1.8, stack: 1, note: 'Рубашка, брюки, ботинки', wear: { slot: 'outfit', costume: 'police', color: 0x2c3a5a, soil: 1, stats: { bite: 0.15, warmth: 7 } } },
  outfitFirefighter: { name: 'Боёвка пожарного', kind: 'clothing', weight: 6, stack: 1, note: 'Тяжёлая, тёплая, держит укус', wear: { slot: 'outfit', costume: 'firefighter', color: 0x8a7038, soil: 0.7, stats: { bite: 0.55, warmth: 22 } } },
  outfitDoctor: { name: 'Медицинская форма', kind: 'clothing', weight: 0.6, stack: 1, note: 'Почти не греет, грязь видна сразу', wear: { slot: 'outfit', costume: 'doctor', color: 0x5a8a86, soil: 1.6, stats: { bite: 0.04, warmth: 2 } } },
  outfitMechanic: { name: 'Комбинезон механика', kind: 'clothing', weight: 1.6, stack: 1, note: 'Плотный, к грязи привычный', wear: { slot: 'outfit', costume: 'mechanic', color: 0x4a4a36, soil: 0.5, stats: { bite: 0.2, warmth: 9 } } },
  outfitBuilder: { name: 'Рабочая форма строителя', kind: 'clothing', weight: 2.2, stack: 1, note: 'Сигнальный жилет, ботинки', wear: { slot: 'outfit', costume: 'builder', color: 0x5c5236, soil: 0.6, stats: { bite: 0.25, warmth: 10 } } },
  swatShirt: { name: 'Тактическая куртка', kind: 'clothing', weight: 0.9, stack: 1, wear: { slot: 'torso', color: 0x262a30, stats: { bite: 0.2, warmth: 6 } } },
  swatPants: { name: 'Тактические брюки', kind: 'clothing', weight: 1.0, stack: 1, wear: { slot: 'legs', color: 0x23262a, stats: { bite: 0.25, warmth: 5 } } },
  policeShirt: { name: 'Полицейская рубашка', kind: 'clothing', weight: 0.4, stack: 1, wear: { slot: 'torso', color: 0x2c3a5a, stats: { bite: 0.1, warmth: 4 } } },
  policePants: { name: 'Полицейские брюки', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'legs', color: 0x1f2533, stats: { bite: 0.12, warmth: 4 } } },
  fireCoat: { name: 'Боёвка пожарного', kind: 'clothing', weight: 2.2, stack: 1, wear: { slot: 'torso', color: 0x8a7038, stats: { bite: 0.4, warmth: 12 } } },
  firePants: { name: 'Пожарные брюки', kind: 'clothing', weight: 1.6, stack: 1, wear: { slot: 'legs', color: 0x8a7038, stats: { bite: 0.3, warmth: 8 } } },
  gorkaJacket: { name: 'Куртка «Горка»', kind: 'clothing', weight: 1.3, stack: 1, wear: { slot: 'torso', color: 0x5b5a3e, stats: { bite: 0.35, warmth: 9 } } },
  gorkaPants: { name: 'Брюки «Горка»', kind: 'clothing', weight: 0.9, stack: 1, wear: { slot: 'legs', color: 0x5b5a3e, stats: { bite: 0.22, warmth: 5 } } },
  // Gear: helmets, vests, packs, bags — models fitted to every body (tools/build-gear.mjs).
  helmetMilitary: { name: 'Армейский шлем', kind: 'clothing', weight: 1.4, stack: 1, note: 'Кевлар, чехол, крепление под ПНВ', wear: { slot: 'head', gear: 'helmet_military', color: 0x3e4630, soil: 0.6, stats: { bite: 0.5, warmth: 2 } } },
  helmetSwat: { name: 'Шлем SWAT', kind: 'clothing', weight: 1.5, stack: 1, wear: { slot: 'head', gear: 'helmet_swat', color: 0x1e2022, soil: 0.7, stats: { bite: 0.55, warmth: 2 } } },
  helmetFire: { name: 'Пожарный шлем', kind: 'clothing', weight: 1.3, stack: 1, note: 'Поля и назатыльник', wear: { slot: 'head', gear: 'helmet_firefighter', color: 0x26231f, soil: 0.6, stats: { bite: 0.45, warmth: 4 } } },
  helmetConstruction: { name: 'Строительная каска', kind: 'clothing', weight: 0.4, stack: 1, wear: { slot: 'head', gear: 'helmet_construction', color: 0x6e6438, soil: 0.8, stats: { bite: 0.3, warmth: 1 } } },
  vestMilitary: { name: 'Армейская разгрузка', kind: 'clothing', weight: 3.2, stack: 1, note: 'Плиты и подсумки: +3 кг к переноске', wear: { slot: 'vest', gear: 'vest_military', color: 0x3e4232, soil: 0.6, stats: { bite: 0.45, warmth: 3 }, pack: { capacity: 3, reduce: 0 } } },
  vestSwat: { name: 'Бронежилет SWAT', kind: 'clothing', weight: 3.8, stack: 1, note: 'Подсумки: +2 кг к переноске', wear: { slot: 'vest', gear: 'vest_swat', color: 0x1e2022, soil: 0.7, stats: { bite: 0.55, warmth: 3 }, pack: { capacity: 2, reduce: 0 } } },
  backpackMilitary: { name: 'Армейский рюкзак', kind: 'clothing', weight: 1.8, stack: 1, note: 'Вмещает +16 кг, вещи в нём легче на четверть', wear: { slot: 'back', gear: 'backpack_military', color: 0x4a4f36, soil: 0.6, stats: { bite: 0.1, warmth: 2 }, pack: { capacity: 16, reduce: 0.25 } } },
  backpackSchool: { name: 'Школьный рюкзак', kind: 'clothing', weight: 0.5, stack: 1, note: 'Вмещает +7 кг', wear: { slot: 'back', gear: 'backpack_school', color: 0x3b4252, stats: { bite: 0.05, warmth: 1 }, pack: { capacity: 7, reduce: 0 } } },
  backpackHiking: { name: 'Туристический рюкзак', kind: 'clothing', weight: 2.1, stack: 1, note: 'Самый вместительный: +20 кг, вещи в нём легче на пятую часть', wear: { slot: 'back', gear: 'backpack_hiking', color: 0x5a3a2e, stats: { bite: 0.08, warmth: 3 }, pack: { capacity: 20, reduce: 0.2 } } },
  bagMedic: { name: 'Медицинская сумка', kind: 'clothing', weight: 0.7, stack: 1, note: 'Через плечо: +6 кг, вещи в ней легче на десятую часть', wear: { slot: 'bag', gear: 'bag_medic', color: 0x5a3a30, stats: { bite: 0, warmth: 0 }, pack: { capacity: 6, reduce: 0.1 } } },
  toolboxMechanic: { name: 'Ящик с инструментами', kind: 'clothing', weight: 3.5, stack: 1, note: 'В руке, пока руки свободны; с оружием — на бедре. +5 кг', wear: { slot: 'bag', gear: 'toolbox_mechanic', color: 0x5a3328, soil: 0.5, stats: { bite: 0, warmth: 0 }, pack: { capacity: 5, reduce: 0 } } },
  workGloves: { name: 'Рабочие перчатки', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'hands', color: 0x8a7650, stats: { bite: 0.15, warmth: 2 } } },
  fireGloves: { name: 'Перчатки пожарного', kind: 'clothing', weight: 0.4, stack: 1, wear: { slot: 'hands', color: 0x6b5a32, stats: { bite: 0.3, warmth: 4 } } },
  tacticalGloves: { name: 'Тактические перчатки', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'hands', color: 0x1c1d20, stats: { bite: 0.25, warmth: 2 } } },
  medGloves: { name: 'Медицинские перчатки', kind: 'clothing', weight: 0.05, stack: 1, wear: { slot: 'hands', color: 0x8fb6c8, stats: { bite: 0.02, warmth: 0 } } },
  map: { name: 'Карта района', kind: 'tool', weight: 0.05, stack: 1, note: 'Отмечены заправки, участок, большие магазины. Кто-то обвёл выезды из города.' },
  walkie: { name: 'Рация', kind: 'tool', weight: 0.4, stack: 1, note: 'Только шипение на всех каналах.' },
  armoryKey: { name: 'Ключ от оружейной', kind: 'tool', weight: 0.02, stack: 1, note: 'Тяжёлый ключ с биркой «Оружейная». Открывает дверь в участке.' },
  armoryNote: { name: 'Записка с кодом', kind: 'tool', weight: 0.01, stack: 1, note: '«Код оружейной сменили: 4-7-1-9. Не записывать!» — записали.' },
  keycardGreen: { name: 'Пропуск «Гелиос», уровень 1', kind: 'tool', weight: 0.01, stack: 1, note: 'Зелёная карта с полоской. Открывает лабораторный зал.' },
  keycardBlue: { name: 'Пропуск «Гелиос», уровень 2', kind: 'tool', weight: 0.01, stack: 1, note: 'Синяя карта инженера. Открывает генераторную.' },
  fuse: { name: 'Предохранитель', kind: 'tool', weight: 0.1, stack: 5, note: 'Керамический, на 60 ампер. Генератору нужно три.' },
  labNote1: { name: 'Журнал охраны', kind: 'tool', weight: 0.05, stack: 1, note: '«Код изолятора меняют по понедельникам. Первая цифра — {lab1}, остальное знает старшая смена. Пропуск лаборантов — в шкафчике.»' },
  labNote2: { name: 'Записка лаборанта', kind: 'tool', weight: 0.01, stack: 1, note: '«Вторая цифра — {lab2}. Синюю карту инженера оставила в холодильнике с пробами, не ругайтесь.»' },
  labNote3: { name: 'Служебная записка', kind: 'tool', weight: 0.01, stack: 1, note: '«Генератор отключён по приказу. Предохранители раздали по отделам. Третья цифра кода — {lab3}.»' },
  labNote4: { name: 'Распечатка с сервера', kind: 'tool', weight: 0.02, stack: 1, note: '«…журнал доступа: изолятор, код {lab1}-{lab2}-{lab3}-?, последняя смена: {lab4}. Связь потеряна в 04:12.»' },
  labJournal1: { name: 'Буклет НИИ «Гелиос»', kind: 'tool', weight: 0.05, stack: 1, note: '«НИИ „Гелиос“: изучаем северные грибковые штаммы ради медицины будущего.» На обороте кто-то написал: «будущего не будет».' },
  labJournal2: { name: 'Лабораторный журнал', kind: 'tool', weight: 0.2, stack: 1, note: 'День 12: штамм Г-7 растёт в темноте и тянется к теплу. День 19: у двоих сотрудников жар и бессонница, их перевели в изолятор. День 23: они больше не узнают нас.' },
  labJournal3: { name: 'Последняя запись', kind: 'tool', weight: 0.05, stack: 1, note: '«Изолятор полон. Генератор отключили, чтобы двери держали. Препарат Г-7 не лечит, но останавливает. Если вы это читаете — уходите на север.»' },
  campNote1: { name: 'Дневник выживших', kind: 'tool', weight: 0.1, stack: 1, note: 'День 6. Нас девять. Воду берём из бойлера, по ночам не шумим. Вчера Миша не вернулся с вылазки. Если найдёте это — мы ушли на север, к реке.' },
  campNote2: { name: 'Список дежурств', kind: 'tool', weight: 0.02, stack: 1, note: 'Ночь: Оля, Тимур. Утро: я и дед. Фонари только красным. Двери держать на засове. Батарейки — в синем ящике.' },
  campNote3: { name: 'Записка у костра', kind: 'tool', weight: 0.01, stack: 1, note: '«Не стреляйте в тех, кто стучит дважды, это наши. Еду делим поровну. Сирену не трогать — на неё сходятся они».' },
  campNote4: { name: 'Карта с пометками', kind: 'tool', weight: 0.05, stack: 1, note: 'Кружки вокруг аптеки и склада. Крест на заправке: «пусто». Стрелка на север: «эвакуация? проверить».' },
  ration: { name: 'Сухпаёк', kind: 'food', weight: 0.6, stack: 4, hunger: -0.5, thirst: 0.05, fatigue: -0.05, note: 'Армейский рацион на сутки: галеты, тушёнка, шоколад.' },
  serumG7: { name: 'Препарат Г-7', kind: 'medical', weight: 0.05, stack: 3, health: 0.3, cures: true, note: 'Экспериментальный. Останавливает заражение даже поздно.' },
  scrubsTop: { name: 'Медицинская рубашка', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'torso', color: 0x5a8a86, stats: { bite: 0.02, warmth: 1 }, sleeves: false } },
  scrubsPants: { name: 'Медицинские брюки', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'legs', color: 0x5a8a86, stats: { bite: 0.02, warmth: 1 } } },
  officeShirt: { name: 'Офисная рубашка', kind: 'clothing', weight: 0.3, stack: 1, wear: { slot: 'torso', color: 0xb8bcc2, stats: { bite: 0.03, warmth: 3 } } },
  slacks: { name: 'Брюки', kind: 'clothing', weight: 0.5, stack: 1, wear: { slot: 'legs', color: 0x2a2a30, stats: { bite: 0.08, warmth: 3 } } },
  dressShoes: { name: 'Туфли', kind: 'clothing', weight: 0.7, stack: 1, wear: { slot: 'feet', color: 0x1e1a18, stats: { bite: 0.08, warmth: 2 }, shoe: 'sneakers' } },
  ...FIREARM_ITEMS,
};

/**
 * Washing (not in the game yet, data only): what it takes to clean one piece of clothing and how
 * much dirt it removes. The inventory will offer "Постирать" when both are in the backpack.
 */
export const WASHING = { needs: [['water', 1], ['soap', 1]] as [ItemId, number][], removes: 1 } as const;

/** Display: how dirty a piece of clothing looks, in words. */
/**
 * Values some notes quote ({lab1}…{lab4}: the digits of the nearest lab's isolation code, by its seed);
 * the world fills them in as the player moves.
 */
export const NOTE_VARS: Record<string, string> = { lab1: '?', lab2: '?', lab3: '?', lab4: '?' };

/** A note's text with its values filled in. */
export function noteText(note: string): string {
  return note.replace(/\{(\w+)\}/g, (m, k: string) => NOTE_VARS[k] ?? m);
}

export function dirtLabel(dirt: number): string {
  return dirt < 0.08 ? 'чистая' : dirt < 0.3 ? 'слегка грязная' : dirt < 0.6 ? 'грязная' : 'очень грязная';
}

/** Sum of a clothing stat over everything worn. */
export function wornStat(worn: Readonly<Record<WearSlot, ItemId | null>>, key: keyof WearStats): number {
  let sum = 0;
  for (const slot of WEAR_SLOTS) {
    const id = worn[slot];
    if (id) sum += ITEMS[id].wear!.stats[key];
  }
  return sum;
}

export interface ItemStack {
  id: ItemId;
  count: number;
  /** Clothing (one per stack): how dirty, 0..1; a weapon: how worn, 0..1 (1 = broken). */
  dirt?: number;
  /** Clothing only: color of this piece if it differs from the item's default. */
  tint?: number;
}

/** What a use button says for an item, or null if it can't be used directly. */
export function useVerb(def: ItemDef): string | null {
  if (def.kind === 'food') return 'Съесть';
  if (def.kind === 'drink') return 'Выпить';
  if (def.dressesWound) return 'Перевязать';
  if (def.kind === 'medical') return 'Принять';
  if (def.battery) return 'Вставить в фонарь';
  if (def.wear) return 'Надеть';
  return null;
}

/** Kept one piece per stack with its own state (clothing: dirt; weapons: wear). */
export function onePiece(def: ItemDef): boolean {
  return !!def.wear || !!def.durability;
}

/**
 * Items that are no more (the procedural gear before the models), in older saves: each replaced by the new
 * piece of its type, or gone (caps, the beanie: no model).
 */
const RENAMED: Readonly<Record<string, ItemId | null>> = {
  militaryHelmet: 'helmetMilitary',
  swatHelmet: 'helmetSwat',
  fireHelmet: 'helmetFire',
  hardhat: 'helmetConstruction',
  swatVest: 'vestSwat',
  policeVest: 'vestMilitary',
  tacticalRig: 'vestMilitary',
  armyBackpack: 'backpackMilitary',
  schoolBackpack: 'backpackSchool',
  sportsBag: 'backpackSchool',
  hikingBackpack: 'backpackHiking',
  medBag: 'bagMedic',
  cap: null,
  beanie: null,
  policeCap: null,
};
const gone = (x: unknown): boolean => {
  const id = Array.isArray(x) ? x[0] : x && typeof x === 'object' ? (x as { id?: unknown }).id : x;
  return typeof id === 'string' && RENAMED[id] === null;
};

/**
 * An older save brought up to date, in place: every old item id anywhere in it — a stack (`{id}` or
 * `[id, count, …]`), a worn slot, the hand — becomes its replacement; the ones with none are dropped. A worn
 * piece in a slot it no longer belongs to (the medic's bag: back → bag) moves to its own when that is free.
 */
export function migrateItems(data: unknown): void {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v in RENAMED ? RENAMED[v] : v;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        if (gone(v[i])) v.splice(i, 1);
        else v[i] = walk(v[i]);
      }
      return v;
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
      for (const slot of WEAR_SLOTS) {
        const id = o[slot];
        if (typeof id !== 'string' || !(id in ITEMS)) continue;
        const real = ITEMS[id as ItemId].wear?.slot;
        if (real && real !== slot && !o[real]) {
          o[real] = id;
          o[slot] = null;
        }
      }
      return o;
    }
    return v;
  };
  walk(data);
}
