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
  | 'cap'
  | 'beanie'
  | 'hardhat'
  | 'hoodie'
  | 'leatherJacket'
  | 'workJacket'
  | 'jeans'
  | 'cargoPants'
  | 'sneakers'
  | 'boots'
  | 'tshirt';

export type ItemKind = 'food' | 'drink' | 'medical' | 'tool' | 'weapon' | 'material' | 'junk' | 'clothing';

/** Body slots for clothing; the weapon goes to the hand. */
export type WearSlot = 'head' | 'torso' | 'legs' | 'feet';
export const WEAR_SLOTS: readonly WearSlot[] = ['head', 'torso', 'legs', 'feet'];

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
  /** Main color on the body (sleeves, trousers, shoe upper, paper doll). */
  color: number;
  stats: WearStats;
  /** Torso: false = short sleeves, forearms stay bare. */
  sleeves?: boolean;
  /** Feet only: which shoe model the legs get. */
  shoe?: 'sneakers' | 'boots';
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
  /** Restores the flashlight battery (0..1). */
  battery?: number;
  /** Can be held in the hand (melee arrives with zombies in stage 4). */
  equip?: boolean;
  /** Clothing: where and how it is worn. */
  wear?: WearDef;
  /** One line for the item card. */
  note?: string;
}

export const BACKPACK_CAPACITY = 15;

export const ITEMS: Readonly<Record<ItemId, ItemDef>> = {
  beans: { name: 'Консервы: фасоль', kind: 'food', weight: 0.45, stack: 6, hunger: -0.35, thirst: 0.04 },
  soup: { name: 'Консервы: суп', kind: 'food', weight: 0.45, stack: 6, hunger: -0.3, thirst: -0.08 },
  chips: { name: 'Чипсы', kind: 'food', weight: 0.15, stack: 6, hunger: -0.12, thirst: 0.06 },
  chocolate: { name: 'Шоколадка', kind: 'food', weight: 0.1, stack: 8, hunger: -0.1, fatigue: -0.08 },
  apple: { name: 'Яблоко (мягкое)', kind: 'food', weight: 0.2, stack: 6, hunger: -0.1, thirst: -0.05 },
  crackers: { name: 'Крекеры', kind: 'food', weight: 0.2, stack: 6, hunger: -0.15, thirst: 0.05 },
  water: { name: 'Бутылка воды', kind: 'drink', weight: 1.0, stack: 4, thirst: -0.5 },
  soda: { name: 'Газировка', kind: 'drink', weight: 0.35, stack: 6, thirst: -0.25, fatigue: -0.04 },
  juice: { name: 'Сок в коробке', kind: 'drink', weight: 0.25, stack: 6, thirst: -0.2, hunger: -0.04 },
  bandage: { name: 'Бинт', kind: 'medical', weight: 0.05, stack: 10, dressesWound: true, health: 0.05 },
  rag: { name: 'Чистая тряпка', kind: 'medical', weight: 0.1, stack: 10, dressesWound: true },
  painkillers: { name: 'Обезболивающее', kind: 'medical', weight: 0.05, stack: 10, pain: -0.5, health: 0.05 },
  antibiotics: { name: 'Антибиотики', kind: 'medical', weight: 0.05, stack: 5, health: 0.15 },
  batteries: { name: 'Батарейки', kind: 'tool', weight: 0.1, stack: 8, battery: 1 },
  knife: { name: 'Кухонный нож', kind: 'weapon', weight: 0.3, stack: 1, equip: true, note: 'Быстрый, тихий, недалеко бьёт' },
  bat: { name: 'Бейсбольная бита', kind: 'weapon', weight: 1.0, stack: 1, equip: true, note: 'Длинная, сбивает с ног' },
  hammer: { name: 'Молоток', kind: 'tool', weight: 0.8, stack: 1, equip: true, note: 'Инструмент и оружие' },
  crowbar: { name: 'Монтировка', kind: 'weapon', weight: 1.4, stack: 1, equip: true, note: 'Тяжёлая, вскрывает двери' },
  axe: { name: 'Пожарный топор', kind: 'weapon', weight: 1.8, stack: 1, equip: true, note: 'Медленный, но смертельный' },
  nails: { name: 'Гвозди', kind: 'material', weight: 0.02, stack: 50 },
  planks: { name: 'Доска', kind: 'material', weight: 1.8, stack: 4 },
  rope: { name: 'Верёвка', kind: 'material', weight: 0.5, stack: 3 },
  tape: { name: 'Скотч', kind: 'material', weight: 0.15, stack: 4 },
  lighter: { name: 'Зажигалка', kind: 'tool', weight: 0.05, stack: 3 },
  matches: { name: 'Спички', kind: 'tool', weight: 0.05, stack: 5 },
  junk: { name: 'Хлам', kind: 'junk', weight: 0.3, stack: 10 },
  // Clothing. Warmth in °C of felt temperature: jackets and boots warm the most, a T-shirt and sneakers the least.
  cap: { name: 'Кепка', kind: 'clothing', weight: 0.1, stack: 1, wear: { slot: 'head', color: 0x2e3a30, stats: { bite: 0.02, warmth: 1 } } },
  beanie: { name: 'Вязаная шапка', kind: 'clothing', weight: 0.1, stack: 1, wear: { slot: 'head', color: 0x5a2a26, stats: { bite: 0.04, warmth: 4 } } },
  hardhat: { name: 'Строительная каска', kind: 'clothing', weight: 0.4, stack: 1, wear: { slot: 'head', color: 0xc89a2a, stats: { bite: 0.35, warmth: 1 } } },
  tshirt: { name: 'Футболка', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'torso', color: 0x8a8a7e, stats: { bite: 0.02, warmth: 1 }, sleeves: false } },
  hoodie: { name: 'Толстовка', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'torso', color: 0x3d4a5c, stats: { bite: 0.08, warmth: 6 } } },
  leatherJacket: { name: 'Кожаная куртка', kind: 'clothing', weight: 1.4, stack: 1, wear: { slot: 'torso', color: 0x2b2420, stats: { bite: 0.3, warmth: 9 } } },
  workJacket: { name: 'Рабочая куртка', kind: 'clothing', weight: 1.1, stack: 1, wear: { slot: 'torso', color: 0x5c5236, stats: { bite: 0.2, warmth: 10 } } },
  jeans: { name: 'Джинсы', kind: 'clothing', weight: 0.7, stack: 1, wear: { slot: 'legs', color: 0x2f3b52, stats: { bite: 0.12, warmth: 4 } } },
  cargoPants: { name: 'Штаны карго', kind: 'clothing', weight: 0.8, stack: 1, wear: { slot: 'legs', color: 0x4a4a36, stats: { bite: 0.15, warmth: 5 } } },
  sneakers: { name: 'Кроссовки', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'feet', color: 0x5e6266, stats: { bite: 0.05, warmth: 1 }, shoe: 'sneakers' } },
  boots: { name: 'Рабочие ботинки', kind: 'clothing', weight: 1.4, stack: 1, wear: { slot: 'feet', color: 0x4a3626, stats: { bite: 0.3, warmth: 4 }, shoe: 'boots' } },
};

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
