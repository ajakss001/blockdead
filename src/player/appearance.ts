import { getLang, registerDataLocalizer } from '../core/i18n';

/**
 * The survivor's looks: a name, a man or a woman (the character model: src/characters), the height (the
 * model scaled to it). Shown in the inventory and the editor, the body on death, the twin that rises, and
 * the first-person body and arms.
 */
export type Sex = 'male' | 'female';

export interface Appearance {
  name: string;
  sex: Sex;
  /** cm */
  height: number;
}

export const SEXES: readonly Sex[] = ['male', 'female'];
export const HEIGHT_RANGE = [158, 196] as const;

export const SEX_LABEL: Record<Sex, string> = { male: 'Мужчина', female: 'Женщина' };

/** The everyday clothes' colours (the editor's T-shirt tint, the twin's). */
export const REF_CLOTHES: Record<Sex, { tee: number; jeans: number; shoes: number }> = {
  male: { tee: 0xdcddd8, jeans: 0x8a8e88, shoes: 0xc8c0ae },
  female: { tee: 0xe2e2de, jeans: 0x9ca286, shoes: 0xccc4b2 },
};

export const BASE_LOOK: Readonly<Record<Sex, Appearance>> = {
  male: { name: 'Выживший', sex: 'male', height: 180 },
  female: { name: 'Выжившая', sex: 'female', height: 170 },
};

export const DEFAULT_APPEARANCE: Readonly<Appearance> = BASE_LOOK.male;

export function baseLook(sex: Sex, name?: string): Appearance {
  return { ...BASE_LOOK[sex], ...(name ? { name } : {}) };
}

const NAMES_RU: Record<Sex, string[]> = {
  male: ['Алекс', 'Саша', 'Женя', 'Макс', 'Кирилл', 'Лёша', 'Олег'],
  female: ['Саша', 'Женя', 'Ника', 'Дана', 'Вера', 'Тома', 'Ира'],
};

const NAMES_EN: Record<Sex, string[]> = {
  male: ['Alex', 'Sam', 'Jack', 'Max', 'Carl', 'Leo', 'Owen'],
  female: ['Sam', 'Jean', 'Nika', 'Dana', 'Vera', 'Toma', 'Ira'],
};

export function translateDefaultName(name: string, sex: Sex): string {
  const isEn = getLang() === 'en';
  if (name === 'Выживший' || name === 'Выжившая' || name === 'Survivor') {
    return BASE_LOOK[sex].name;
  }
  const from = isEn ? NAMES_RU[sex] : NAMES_EN[sex];
  const to = isEn ? NAMES_EN[sex] : NAMES_RU[sex];
  const idx = from.indexOf(name);
  if (idx >= 0) return to[idx];
  return name;
}

registerDataLocalizer((lang) => {
  const isEn = lang === 'en';
  SEX_LABEL.male = isEn ? 'Male' : 'Мужчина';
  SEX_LABEL.female = isEn ? 'Female' : 'Женщина';
  BASE_LOOK.male.name = isEn ? 'Survivor' : 'Выживший';
  BASE_LOOK.female.name = isEn ? 'Survivor' : 'Выжившая';
});

export function randomAppearance(rand: () => number = Math.random): Appearance {
  const sex: Sex = rand() < 0.5 ? 'male' : 'female';
  // The height is not chosen (no setting in the editor): the model's own.
  const names = (getLang() === 'en' ? NAMES_EN : NAMES_RU)[sex];
  return { name: names[Math.floor(rand() * names.length)], sex, height: BASE_LOOK[sex].height };
}

/** A saved look made safe (old saves' build, skin, hair… are dropped). */
export function sanitizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const sex: Sex = a?.sex && SEXES.includes(a.sex) ? a.sex : 'male';
  const d = BASE_LOOK[sex];
  return {
    name: typeof a?.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 20) : d.name,
    sex,
    // No height setting any more: old saves' chosen height goes back to the model's own.
    height: d.height,
  };
}
