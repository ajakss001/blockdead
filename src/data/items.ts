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
  | 'tshirt'
  | 'soap'
  | 'militaryHelmet'
  | 'militaryJacket'
  | 'militaryPants'
  | 'combatBoots'
  | 'swatHelmet'
  | 'swatVest'
  | 'swatPants'
  | 'policeCap'
  | 'policeShirt'
  | 'policePants'
  | 'fireHelmet'
  | 'fireCoat'
  | 'firePants'
  | 'scrubsTop'
  | 'scrubsPants'
  | 'officeShirt'
  | 'slacks'
  | 'dressShoes'
  // Equipment slots (vest, gloves, back) and uniforms that use them.
  | 'swatShirt'
  | 'gorkaJacket'
  | 'gorkaPants'
  | 'policeVest'
  | 'tacticalRig'
  | 'workGloves'
  | 'fireGloves'
  | 'tacticalGloves'
  | 'medGloves'
  | 'schoolBackpack'
  | 'sportsBag'
  | 'hikingBackpack'
  | 'armyBackpack'
  | 'medBag'
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
  | 'ration';

export type ItemKind = 'food' | 'drink' | 'medical' | 'tool' | 'weapon' | 'material' | 'junk' | 'clothing';

/** Body slots for clothing; the weapon goes to the hand. */
export type WearSlot = 'head' | 'torso' | 'vest' | 'hands' | 'legs' | 'feet' | 'back';
export const WEAR_SLOTS: readonly WearSlot[] = ['head', 'torso', 'vest', 'hands', 'legs', 'feet', 'back'];

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
  /** Back only: a bag — how much it holds (kg) and how much lighter it makes what is in it (0..1). */
  pack?: { capacity: number; reduce: number };
  /** Head only: placeholder shape on the figure. */
  hat?: 'cap' | 'beanie' | 'helmet' | 'hardhat';
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
  /** One line for the item card. */
  note?: string;
}

/** What you carry with no bag at all (pockets, hands), kg; bags (`back` slot) and vests add to it. */
export const BACKPACK_CAPACITY = 8;

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
  antibiotics: { name: 'Антибиотики', kind: 'medical', weight: 0.05, stack: 5, health: 0.15, cures: true, note: 'Останавливают заражение, если принять рано.' },
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
  soap: { name: 'Мыло', kind: 'tool', weight: 0.1, stack: 5, note: 'Для стирки одежды (скоро)' },
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
  // Uniforms (class starting outfits; also found in the world).
  militaryHelmet: { name: 'Армейская каска', kind: 'clothing', weight: 1.2, stack: 1, wear: { slot: 'head', color: 0x3e4630, stats: { bite: 0.45, warmth: 2 } } },
  militaryJacket: { name: 'Армейский китель', kind: 'clothing', weight: 1.3, stack: 1, wear: { slot: 'torso', color: 0x4a5236, stats: { bite: 0.35, warmth: 8 } } },
  militaryPants: { name: 'Армейские брюки', kind: 'clothing', weight: 0.9, stack: 1, wear: { slot: 'legs', color: 0x4a5236, stats: { bite: 0.2, warmth: 5 } } },
  combatBoots: { name: 'Берцы', kind: 'clothing', weight: 1.5, stack: 1, wear: { slot: 'feet', color: 0x26231f, stats: { bite: 0.35, warmth: 5 }, shoe: 'boots' } },
  swatHelmet: { name: 'Шлем SWAT', kind: 'clothing', weight: 1.4, stack: 1, wear: { slot: 'head', color: 0x1c1e22, stats: { bite: 0.5, warmth: 2 } } },
  swatVest: { name: 'Бронежилет SWAT', kind: 'clothing', weight: 3.5, stack: 1, wear: { slot: 'vest', color: 0x1e2226, stats: { bite: 0.5, warmth: 3 } } },
  swatShirt: { name: 'Тактическая куртка', kind: 'clothing', weight: 0.9, stack: 1, wear: { slot: 'torso', color: 0x262a30, stats: { bite: 0.2, warmth: 6 } } },
  swatPants: { name: 'Тактические брюки', kind: 'clothing', weight: 1.0, stack: 1, wear: { slot: 'legs', color: 0x23262a, stats: { bite: 0.25, warmth: 5 } } },
  policeCap: { name: 'Полицейская фуражка', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'head', color: 0x1f2533, stats: { bite: 0.02, warmth: 1 } } },
  policeShirt: { name: 'Полицейская рубашка', kind: 'clothing', weight: 0.4, stack: 1, wear: { slot: 'torso', color: 0x2c3a5a, stats: { bite: 0.1, warmth: 4 } } },
  policePants: { name: 'Полицейские брюки', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'legs', color: 0x1f2533, stats: { bite: 0.12, warmth: 4 } } },
  fireHelmet: { name: 'Пожарный шлем', kind: 'clothing', weight: 1.0, stack: 1, wear: { slot: 'head', color: 0xb89a32, stats: { bite: 0.4, warmth: 3 } } },
  fireCoat: { name: 'Боёвка пожарного', kind: 'clothing', weight: 2.2, stack: 1, wear: { slot: 'torso', color: 0x8a7038, stats: { bite: 0.4, warmth: 12 } } },
  firePants: { name: 'Пожарные брюки', kind: 'clothing', weight: 1.6, stack: 1, wear: { slot: 'legs', color: 0x8a7038, stats: { bite: 0.3, warmth: 8 } } },
  gorkaJacket: { name: 'Куртка «Горка»', kind: 'clothing', weight: 1.3, stack: 1, wear: { slot: 'torso', color: 0x5b5a3e, stats: { bite: 0.35, warmth: 9 } } },
  gorkaPants: { name: 'Брюки «Горка»', kind: 'clothing', weight: 0.9, stack: 1, wear: { slot: 'legs', color: 0x5b5a3e, stats: { bite: 0.22, warmth: 5 } } },
  policeVest: { name: 'Полицейский жилет', kind: 'clothing', weight: 2.0, stack: 1, wear: { slot: 'vest', color: 0x1f2533, stats: { bite: 0.35, warmth: 2 } } },
  tacticalRig: { name: 'Разгрузка', kind: 'clothing', weight: 1.2, stack: 1, wear: { slot: 'vest', color: 0x4a4f36, stats: { bite: 0.15, warmth: 1 }, pack: { capacity: 3, reduce: 0 } }, note: 'Подсумки: +3 кг к переноске.' },
  workGloves: { name: 'Рабочие перчатки', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'hands', color: 0x8a7650, stats: { bite: 0.15, warmth: 2 } } },
  fireGloves: { name: 'Перчатки пожарного', kind: 'clothing', weight: 0.4, stack: 1, wear: { slot: 'hands', color: 0x6b5a32, stats: { bite: 0.3, warmth: 4 } } },
  tacticalGloves: { name: 'Тактические перчатки', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'hands', color: 0x1c1d20, stats: { bite: 0.25, warmth: 2 } } },
  medGloves: { name: 'Медицинские перчатки', kind: 'clothing', weight: 0.05, stack: 1, wear: { slot: 'hands', color: 0x8fb6c8, stats: { bite: 0.02, warmth: 0 } } },
  schoolBackpack: { name: 'Школьный рюкзак', kind: 'clothing', weight: 0.5, stack: 1, wear: { slot: 'back', color: 0x3b4d6b, stats: { bite: 0.05, warmth: 1 }, pack: { capacity: 7, reduce: 0 } }, note: 'Вмещает +7 кг.' },
  sportsBag: { name: 'Спортивная сумка', kind: 'clothing', weight: 0.7, stack: 1, wear: { slot: 'back', color: 0x2a2c30, stats: { bite: 0, warmth: 0 }, pack: { capacity: 10, reduce: 0 } }, note: 'Вмещает +10 кг.' },
  hikingBackpack: { name: 'Туристический рюкзак', kind: 'clothing', weight: 1.4, stack: 1, wear: { slot: 'back', color: 0x7a3a2a, stats: { bite: 0.05, warmth: 2 }, pack: { capacity: 14, reduce: 0.2 } }, note: 'Вмещает +14 кг, вещи в нём легче на 20%.' },
  armyBackpack: { name: 'Армейский рюкзак', kind: 'clothing', weight: 1.8, stack: 1, wear: { slot: 'back', color: 0x4a4f36, stats: { bite: 0.1, warmth: 2 }, pack: { capacity: 16, reduce: 0.25 } }, note: 'Вмещает +16 кг, вещи в нём легче на 25%.' },
  medBag: { name: 'Медицинская сумка', kind: 'clothing', weight: 0.6, stack: 1, wear: { slot: 'back', color: 0x8a2a2a, stats: { bite: 0, warmth: 0 }, pack: { capacity: 6, reduce: 0.1 } }, note: 'Вмещает +6 кг, вещи в нём легче на 10%.' },
  map: { name: 'Карта района', kind: 'tool', weight: 0.05, stack: 1, note: 'Отмечены заправки, участок, большие магазины. Кто-то обвёл выезды из города.' },
  walkie: { name: 'Рация', kind: 'tool', weight: 0.4, stack: 1, note: 'Только шипение на всех каналах.' },
  armoryKey: { name: 'Ключ от оружейной', kind: 'tool', weight: 0.02, stack: 1, note: 'Тяжёлый ключ с биркой «Оружейная». Открывает дверь в участке.' },
  armoryNote: { name: 'Записка с кодом', kind: 'tool', weight: 0.01, stack: 1, note: '«Код оружейной сменили: 4-7-1-9. Не записывать!» — записали.' },
  keycardGreen: { name: 'Пропуск «Гелиос», уровень 1', kind: 'tool', weight: 0.01, stack: 1, note: 'Зелёная карта с полоской. Открывает лабораторный зал.' },
  keycardBlue: { name: 'Пропуск «Гелиос», уровень 2', kind: 'tool', weight: 0.01, stack: 1, note: 'Синяя карта инженера. Открывает генераторную.' },
  fuse: { name: 'Предохранитель', kind: 'tool', weight: 0.1, stack: 5, note: 'Керамический, на 60 ампер. Генератору нужно три.' },
  labNote1: { name: 'Журнал охраны', kind: 'tool', weight: 0.05, stack: 1, note: '«Код изолятора меняют по понедельникам. Первая цифра — 3, остальное знает старшая смена. Пропуск лаборантов — в шкафчике.»' },
  labNote2: { name: 'Записка лаборанта', kind: 'tool', weight: 0.01, stack: 1, note: '«Вторая цифра — 8. Синюю карту инженера оставила в холодильнике с пробами, не ругайтесь.»' },
  labNote3: { name: 'Служебная записка', kind: 'tool', weight: 0.01, stack: 1, note: '«Генератор отключён по приказу. Предохранители раздали по отделам. Третья цифра кода — 1.»' },
  labNote4: { name: 'Распечатка с сервера', kind: 'tool', weight: 0.02, stack: 1, note: '«…журнал доступа: изолятор, код 3-8-1-?, последняя смена: 5. Связь потеряна в 04:12.»' },
  labJournal1: { name: 'Буклет НИИ «Гелиос»', kind: 'tool', weight: 0.05, stack: 1, note: '«НИИ „Гелиос“: изучаем северные грибковые штаммы ради медицины будущего.» На обороте кто-то написал: «будущего не будет».' },
  labJournal2: { name: 'Лабораторный журнал', kind: 'tool', weight: 0.2, stack: 1, note: 'День 12: штамм Г-7 растёт в темноте и тянется к теплу. День 19: у двоих сотрудников жар и бессонница, их перевели в изолятор. День 23: они больше не узнают нас.' },
  labJournal3: { name: 'Последняя запись', kind: 'tool', weight: 0.05, stack: 1, note: '«Изолятор полон. Генератор отключили, чтобы двери держали. Препарат Г-7 не лечит, но останавливает. Если вы это читаете — уходите на север.»' },
  ration: { name: 'Сухпаёк', kind: 'food', weight: 0.6, stack: 4, hunger: -0.5, thirst: 0.05, fatigue: -0.05, note: 'Армейский рацион на сутки: галеты, тушёнка, шоколад.' },
  serumG7: { name: 'Препарат Г-7', kind: 'medical', weight: 0.05, stack: 3, health: 0.3, cures: true, note: 'Экспериментальный. Останавливает заражение даже поздно.' },
  scrubsTop: { name: 'Медицинская рубашка', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'torso', color: 0x5a8a86, stats: { bite: 0.02, warmth: 1 }, sleeves: false } },
  scrubsPants: { name: 'Медицинские брюки', kind: 'clothing', weight: 0.2, stack: 1, wear: { slot: 'legs', color: 0x5a8a86, stats: { bite: 0.02, warmth: 1 } } },
  officeShirt: { name: 'Офисная рубашка', kind: 'clothing', weight: 0.3, stack: 1, wear: { slot: 'torso', color: 0xb8bcc2, stats: { bite: 0.03, warmth: 3 } } },
  slacks: { name: 'Брюки', kind: 'clothing', weight: 0.5, stack: 1, wear: { slot: 'legs', color: 0x2a2a30, stats: { bite: 0.08, warmth: 3 } } },
  dressShoes: { name: 'Туфли', kind: 'clothing', weight: 0.7, stack: 1, wear: { slot: 'feet', color: 0x1e1a18, stats: { bite: 0.08, warmth: 2 }, shoe: 'sneakers' } },
};

/**
 * Washing (not in the game yet, data only): what it takes to clean one piece of clothing and how
 * much dirt it removes. The inventory will offer "Постирать" when both are in the backpack.
 */
export const WASHING = { needs: [['water', 1], ['soap', 1]] as [ItemId, number][], removes: 1 } as const;

/** Display: how dirty a piece of clothing looks, in words. */
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
  /** Clothing only (one per stack): how dirty, 0..1. */
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
