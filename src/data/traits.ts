import { registerDataLocalizer } from '../core/i18n';
import { type ClassId, classDef, type ClassMods } from './classes';

/**
 * Traits (Zomboid): picked in the editor on top of the class. A good one costs points, a bad one gives
 * them; the class brings some to start with (`traitPoints`). Their effects are multipliers on the same
 * mods the class sets (carry and traitPoints add), plus how fast skills are learnt. Opposites exclude
 * each other. Adding a trait = adding an entry here.
 */
export type TraitId =
  | 'athletic'
  | 'strong'
  | 'quiet'
  | 'fastLearner'
  | 'keenEye'
  | 'calm'
  | 'outdoorsman'
  | 'smallEater'
  | 'packMule'
  | 'fastHealer'
  | 'unfit'
  | 'weak'
  | 'clumsy'
  | 'slowLearner'
  | 'anxious'
  | 'coldProne'
  | 'glutton'
  | 'shortSighted'
  | 'slowHealer'
  | 'lost';

export interface TraitDef {
  id: TraitId;
  name: string;
  /** What it does, one line. */
  about: string;
  /** Points: > 0 a good trait costs them, < 0 a bad one gives them. */
  cost: number;
  mods: Partial<ClassMods>;
  /** Skill learning speed, multiplier. */
  learn?: number;
  /** Can't be taken together with this one. */
  not?: TraitId;
}

export const TRAITS: readonly TraitDef[] = [
  { id: 'athletic', name: 'Атлет', about: 'Устаёт на 20% медленнее', cost: 4, mods: { stamina: 0.8 }, not: 'unfit' },
  { id: 'strong', name: 'Сильный', about: 'Удар +15%', cost: 4, mods: { strength: 1.15 }, not: 'weak' },
  { id: 'quiet', name: 'Тихий шаг', about: 'Шумит на 20% меньше', cost: 3, mods: { stealth: 0.8 }, not: 'clumsy' },
  { id: 'fastLearner', name: 'Быстро учится', about: 'Навыки растут на 25% быстрее', cost: 3, mods: {}, learn: 1.25, not: 'slowLearner' },
  { id: 'keenEye', name: 'Зоркий', about: 'Обыск на 15% быстрее', cost: 3, mods: { searchSpeed: 0.85 }, not: 'shortSighted' },
  { id: 'calm', name: 'Хладнокровный', about: 'Тревога растёт на 25% медленнее', cost: 2, mods: { anxiety: 0.75 }, not: 'anxious' },
  { id: 'outdoorsman', name: 'Турист', about: 'Мёрзнет на 20% медленнее, карта открывается шире', cost: 2, mods: { cold: 0.8, orientation: 1.25 }, not: 'coldProne' },
  { id: 'smallEater', name: 'Малоежка', about: 'Голод и жажда −15%', cost: 2, mods: { hunger: 0.85 }, not: 'glutton' },
  { id: 'packMule', name: 'Выносливая спина', about: 'Рюкзак +3 кг', cost: 3, mods: { carry: 3 }, not: 'weak' },
  { id: 'fastHealer', name: 'Быстро заживает', about: 'Бинты и лекарства лечат на 25% лучше', cost: 2, mods: { healing: 1.25 }, not: 'slowHealer' },
  { id: 'unfit', name: 'Не в форме', about: 'Устаёт на 25% быстрее', cost: -3, mods: { stamina: 1.25 }, not: 'athletic' },
  { id: 'weak', name: 'Слабый', about: 'Удар −15%, рюкзак −2 кг', cost: -3, mods: { strength: 0.85, carry: -2 }, not: 'strong' },
  { id: 'clumsy', name: 'Неуклюжий', about: 'Шумит на 25% больше', cost: -2, mods: { stealth: 1.25 }, not: 'quiet' },
  { id: 'slowLearner', name: 'Тугодум', about: 'Навыки растут на 25% медленнее', cost: -3, mods: {}, learn: 0.75, not: 'fastLearner' },
  { id: 'anxious', name: 'Пугливый', about: 'Тревога растёт на 30% быстрее', cost: -2, mods: { anxiety: 1.3 }, not: 'calm' },
  { id: 'coldProne', name: 'Мерзляк', about: 'Мёрзнет на 25% быстрее', cost: -2, mods: { cold: 1.25 }, not: 'outdoorsman' },
  { id: 'glutton', name: 'Обжора', about: 'Голод и жажда +20%', cost: -2, mods: { hunger: 1.2 }, not: 'smallEater' },
  { id: 'shortSighted', name: 'Близорукий', about: 'Обыск на 15% медленнее, карта открывается уже', cost: -2, mods: { searchSpeed: 1.15, orientation: 0.75 }, not: 'keenEye' },
  { id: 'slowHealer', name: 'Плохо заживает', about: 'Лечение на 25% слабее', cost: -2, mods: { healing: 0.75 }, not: 'fastHealer' },
  { id: 'lost', name: 'Топографический кретин', about: 'Карта открывается вдвое уже', cost: -2, mods: { orientation: 0.5 }, not: 'outdoorsman' },
];

export function traitDef(id: string): TraitDef | undefined {
  return TRAITS.find((t) => t.id === id);
}

/** Only known traits, no opposites (old or edited saves). */
export function sanitizeTraits(ids: unknown): TraitId[] {
  if (!Array.isArray(ids)) return [];
  const out: TraitId[] = [];
  for (const id of ids) {
    const t = traitDef(String(id));
    if (t && !out.includes(t.id) && !out.some((o) => traitDef(o)?.not === t.id || t.not === o)) out.push(t.id);
  }
  return out;
}

/** Points left: the class's own, plus what the bad traits give, minus what the good ones cost. */
export function traitPointsLeft(classId: ClassId, ids: readonly TraitId[]): number {
  let n = classDef(classId).mods.traitPoints ?? 0;
  for (const id of ids) n -= traitDef(id)?.cost ?? 0;
  return n;
}

/** The class mods with the traits on top: multipliers multiply, carry adds. */
export function withTraits(m: ClassMods, ids: readonly TraitId[]): ClassMods {
  const out = { ...m };
  for (const id of ids) {
    const t = traitDef(id);
    if (!t) continue;
    for (const [k, v] of Object.entries(t.mods) as [keyof ClassMods, number][]) {
      if (k === 'carry' || k === 'traitPoints') out[k] += v;
      else out[k] *= v;
    }
  }
  return out;
}

/** Skill learning speed from the traits. */
export function traitLearn(ids: readonly TraitId[]): number {
  return ids.reduce((k, id) => k * (traitDef(id)?.learn ?? 1), 1);
}

const TRAIT_TEXT: Readonly<Record<TraitId, { name: [string, string]; about: [string, string] }>> = {
  athletic: { name: ['Атлет', 'Athletic'], about: ['Устаёт на 20% медленнее', 'Tires 20% slower'] },
  strong: { name: ['Сильный', 'Strong'], about: ['Удар +15%', 'Melee damage +15%'] },
  quiet: { name: ['Тихий шаг', 'Light-footed'], about: ['Шумит на 20% меньше', 'Makes 20% less noise'] },
  fastLearner: { name: ['Быстро учится', 'Fast learner'], about: ['Навыки растут на 25% быстрее', 'Skills grow 25% faster'] },
  keenEye: { name: ['Зоркий', 'Keen-eyed'], about: ['Обыск на 15% быстрее', 'Search 15% faster'] },
  calm: { name: ['Хладнокровный', 'Calm'], about: ['Тревога растёт на 25% медленнее', 'Anxiety grows 25% slower'] },
  outdoorsman: { name: ['Турист', 'Outdoorsman'], about: ['Мёрзнет на 20% медленнее, карта открывается шире', 'Gets cold 20% slower, map reveals wider'] },
  smallEater: { name: ['Малоежка', 'Light eater'], about: ['Голод и жажда −15%', 'Hunger & thirst −15%'] },
  packMule: { name: ['Выносливая спина', 'Sturdy back'], about: ['Рюкзак +3 кг', 'Backpack +3 kg'] },
  fastHealer: { name: ['Быстро заживает', 'Fast healer'], about: ['Бинты и лекарства лечат на 25% лучше', 'Bandages & medicine heal 25% more'] },
  unfit: { name: ['Не в форме', 'Out of shape'], about: ['Устаёт на 25% быстрее', 'Tires 25% faster'] },
  weak: { name: ['Слабый', 'Weak'], about: ['Удар −15%, рюкзак −2 кг', 'Melee damage −15%, backpack −2 kg'] },
  clumsy: { name: ['Неуклюжий', 'Clumsy'], about: ['Шумит на 25% больше', 'Makes 25% more noise'] },
  slowLearner: { name: ['Тугодум', 'Slow learner'], about: ['Навыки растут на 25% медленнее', 'Skills grow 25% slower'] },
  anxious: { name: ['Пугливый', 'Anxious'], about: ['Тревога растёт на 30% быстрее', 'Anxiety grows 30% faster'] },
  coldProne: { name: ['Мерзляк', 'Chilly'], about: ['Мёрзнет на 25% быстрее', 'Gets cold 25% faster'] },
  glutton: { name: ['Обжора', 'High appetite'], about: ['Голод и жажда +20%', 'Hunger & thirst +20%'] },
  shortSighted: { name: ['Близорукий', 'Short-sighted'], about: ['Обыск на 15% медленнее, карта открывается уже', 'Search 15% slower, map reveals narrower'] },
  slowHealer: { name: ['Плохо заживает', 'Slow healer'], about: ['Лечение на 25% слабее', 'Healing 25% weaker'] },
  lost: { name: ['Топографический кретин', 'Poor sense of direction'], about: ['Карта открывается вдвое уже', 'Map reveals half as wide'] },
};

registerDataLocalizer((lang) => {
  const idx = lang === 'en' ? 1 : 0;
  for (const t of TRAITS) {
    const text = TRAIT_TEXT[t.id];
    t.name = text.name[idx];
    t.about = text.about[idx];
  }
});
