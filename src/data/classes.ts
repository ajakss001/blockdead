import type { ItemId, WearSlot } from './items';

/**
 * Who the survivor was before. A class is pure data: stat modifiers (1 = normal), readable pros
 * and cons, a uniform and a starting kit. Adding a class = adding an entry here.
 */
export type ClassId = 'military' | 'swat' | 'police' | 'firefighter' | 'medic' | 'mechanic' | 'builder' | 'office' | 'unemployed';

export interface ClassMods {
  /** Fatigue gain multiplier (lower = more endurance). */
  stamina: number;
  /** Extra backpack capacity, kg. */
  carry: number;
  /** Search time multiplier (lower = faster). */
  searchSpeed: number;
  /** Extra search time multiplier for car trunks. */
  carSearch: number;
  /** Noise multiplier when moving (lower = stealthier). */
  stealth: number;
  /** Anxiety gain multiplier. */
  anxiety: number;
  /** Body cooling multiplier in the cold. */
  cold: number;
  /** Hunger and thirst multiplier. */
  hunger: number;
  /** Health restored by bandages and medicine, multiplier. */
  healing: number;
  /** Strength of painkillers, multiplier. */
  medicine: number;
  // ── Stored for later stages, not applied yet ──
  /** Melee damage (stage 4). */
  strength: number;
  /** Barricading speed (stage 5). */
  barricade: number;
  /** Firearms handling (stage 4: no firearms at start). */
  firearms: number;
  /** Map / orientation (stage 5). */
  orientation: number;
  /** Points for the future trait system. */
  traitPoints: number;
}

export const BASE_MODS: Readonly<ClassMods> = {
  stamina: 1,
  carry: 0,
  searchSpeed: 1,
  carSearch: 1,
  stealth: 1,
  anxiety: 1,
  cold: 1,
  hunger: 1,
  healing: 1,
  medicine: 1,
  strength: 1,
  barricade: 1,
  firearms: 1,
  orientation: 1,
  traitPoints: 0,
};

export interface ClassDef {
  id: ClassId;
  name: string;
  /** One line: who they were. */
  about: string;
  pros: string[];
  cons: string[];
  mods: Partial<ClassMods>;
  /** The uniform (worn at start when "Форма класса" is chosen). */
  uniform: Partial<Record<WearSlot, ItemId>>;
  /** Starting backpack and hand. */
  items: [ItemId, number][];
  hand: ItemId | null;
}

export const CLASSES: readonly ClassDef[] = [
  {
    id: 'military',
    name: 'Военный',
    about: 'Служил в армии, знает тактику и умеет держать себя в руках.',
    pros: ['Выносливость +20%', 'Тревога растёт на 30% медленнее', 'Рюкзак +4 кг', 'Американская полевая форма, разгрузка и армейский рюкзак'],
    cons: ['Голод и жажда +15%: привык к пайку'],
    mods: { stamina: 0.8, anxiety: 0.7, carry: 4, hunger: 1.15, firearms: 1.3 },
    uniform: { outfit: 'outfitMilitary', head: 'militaryHelmet', vest: 'tacticalRig', back: 'armyBackpack' },
    items: [['water', 2], ['beans', 1], ['bandage', 2]],
    hand: 'knife',
  },
  {
    id: 'swat',
    name: 'Спецназ (SWAT)',
    about: 'Штурмовая группа полиции. Тяжёлая броня, железные нервы.',
    pros: ['Бронежилет: защита от укуса 55%', 'Тревога растёт вдвое медленнее', 'Монтировка для штурма'],
    cons: ['Тяжёлое снаряжение: усталость +25%', 'Громче двигается'],
    mods: { anxiety: 0.5, stamina: 1.25, stealth: 1.2, firearms: 1.5 },
    uniform: { outfit: 'outfitSwat', head: 'swatHelmet', vest: 'swatVest', hands: 'tacticalGloves' },
    items: [['water', 1], ['bandage', 2]],
    hand: 'crowbar',
  },
  {
    id: 'police',
    name: 'Полицейский',
    about: 'Патрульный. Знает город и где люди прячут ценное.',
    pros: ['Обыск на 25% быстрее', 'Багажники — ещё быстрее', 'Карта открывается на 30% шире'],
    cons: ['Лёгкая форма: мёрзнет на 15% быстрее'],
    mods: { searchSpeed: 0.75, carSearch: 0.85, orientation: 1.3, cold: 1.15, firearms: 1.2 },
    uniform: { outfit: 'outfitPolice', head: 'policeCap', vest: 'policeVest' },
    items: [['batteries', 2], ['bandage', 1], ['water', 1]],
    hand: 'knife',
  },
  {
    id: 'firefighter',
    name: 'Пожарный',
    about: 'Ходил в огонь и выносил людей на руках.',
    pros: ['Удар +30%', 'Холод почти не берёт: −35% к остыванию', 'Рюкзак +2 кг', 'Пожарный топор'],
    cons: ['Голод +10%'],
    mods: { strength: 1.3, cold: 0.65, carry: 2, hunger: 1.1 },
    uniform: { outfit: 'outfitFirefighter', head: 'fireHelmet', hands: 'fireGloves' },
    items: [['water', 2]],
    hand: 'axe',
  },
  {
    id: 'medic',
    name: 'Врач',
    about: 'Работал в приёмном покое. Знает, как лечить, и чем.',
    pros: ['Бинты и лекарства лечат на 50% лучше', 'Обезболивающее действует сильнее', 'Аптечка с собой'],
    cons: ['Удар −20%', 'Медицинская форма почти не греет'],
    mods: { healing: 1.5, medicine: 1.5, strength: 0.8 },
    uniform: { outfit: 'outfitDoctor', hands: 'medGloves', back: 'medBag' },
    items: [['bandage', 3], ['painkillers', 2], ['antibiotics', 1], ['water', 1]],
    hand: 'knife',
  },
  {
    id: 'mechanic',
    name: 'Механик',
    about: 'Чинил машины. Знает, где в них что лежит.',
    pros: ['Багажники вдвое быстрее', 'Обыск на 10% быстрее', 'Молоток и скотч'],
    cons: ['Тревога +10%'],
    mods: { carSearch: 0.5, searchSpeed: 0.9, anxiety: 1.1 },
    uniform: { outfit: 'outfitMechanic', hands: 'workGloves', back: 'sportsBag' },
    items: [['tape', 2], ['water', 1]],
    hand: 'hammer',
  },
  {
    id: 'builder',
    name: 'Строитель',
    about: 'Стройка с утра до ночи. Руки сильные, голос громкий.',
    pros: ['Удар +20%', 'Заколачивает в 1,5 раза быстрее', 'Рюкзак +2 кг', 'Гвозди и доски'],
    cons: ['Шумный: +20% к шуму шагов'],
    mods: { strength: 1.2, barricade: 1.5, carry: 2, stealth: 1.2 },
    uniform: { outfit: 'outfitBuilder', head: 'hardhat', hands: 'workGloves', back: 'sportsBag' },
    items: [['nails', 20], ['planks', 1], ['water', 1]],
    hand: 'hammer',
  },
  {
    id: 'office',
    name: 'Офисный работник',
    about: 'Отчёты, кофе, дедлайны. Никаких особых навыков.',
    pros: ['Ест меньше: голод и жажда −15%', '+4 очка черт'],
    cons: ['Устаёт на 15% быстрее'],
    mods: { hunger: 0.85, traitPoints: 4, stamina: 1.15 },
    uniform: { torso: 'officeShirt', legs: 'slacks', feet: 'dressShoes' },
    items: [['chocolate', 2], ['soda', 1]],
    hand: 'knife',
  },
  {
    id: 'unemployed',
    name: 'Безработный',
    about: 'Без работы и без бонусов — зато ко всему привык.',
    pros: ['Голод и жажда −10%', 'Тревога −10%', '+8 очков черт'],
    cons: ['Рюкзак −1 кг'],
    mods: { hunger: 0.9, anxiety: 0.9, traitPoints: 8, carry: -1 },
    uniform: { torso: 'hoodie', legs: 'jeans', feet: 'sneakers' },
    items: [['water', 1], ['chocolate', 1]],
    hand: 'knife',
  },
];

/** Old saves and quick starts. */
export const DEFAULT_CLASS: ClassId = 'unemployed';

export function classDef(id: ClassId | string | undefined): ClassDef {
  return CLASSES.find((c) => c.id === id) ?? CLASSES.find((c) => c.id === DEFAULT_CLASS)!;
}

export function classMods(id: ClassId | string | undefined): ClassMods {
  return { ...BASE_MODS, ...classDef(id).mods };
}

/**
 * Starting outfits offered in the editor besides the class uniform; `tint` recolors the top.
 */
export const STARTER_OUTFITS: readonly { id: string; name: string; worn: Partial<Record<WearSlot, ItemId>> }[] = [
  // The reference sheets' clothes: a T-shirt, jeans, sneakers (their colours: CharacterEditor.choiceTint).
  { id: 'casual', name: 'Повседневная', worn: { torso: 'tshirt', legs: 'jeans', feet: 'sneakers' } },
  { id: 'warm', name: 'Тёплая', worn: { head: 'beanie', torso: 'workJacket', hands: 'workGloves', legs: 'cargoPants', feet: 'boots', back: 'hikingBackpack' } },
  { id: 'light', name: 'Лёгкая', worn: { torso: 'tshirt', legs: 'jeans', feet: 'sneakers', back: 'sportsBag' } },
  { id: 'leather', name: 'Кожанка', worn: { head: 'cap', torso: 'leatherJacket', legs: 'jeans', feet: 'boots' } },
];

/** Colors offered for the top of a starting outfit. */
export const OUTFIT_TINTS = [0xdcddd8, 0xe2e2de, 0x3d4a5c, 0x4a5a3a, 0x5c3a34, 0x5a5a5e, 0x2a2a2e, 0x7a6a4a] as const;
