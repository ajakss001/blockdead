/**
 * How the survivor looks (chosen in the character editor, stored in the save). Affects the 3D figure
 * in the inventory and the editor, the body on death, the twin that rises, and the first-person hands
 * (skin tone, a lighter hand for a woman).
 *
 * Two bases (refs: the male and female survivor sheets): a man — lean and athletic, short dark messy hair,
 * stubble; a woman — slim, a dirty-blond low ponytail, narrower shoulders, wider hips, lighter hands.
 * Everything else (height, build, skin, face, hair) is set on top of the base; a beard only for the man.
 */
export type Sex = 'male' | 'female';
export type Build = 'slim' | 'average' | 'heavy';
export type HairStyle = 'short' | 'buzz' | 'long' | 'ponytail' | 'curly' | 'bald';
export type Beard = 'none' | 'stubble' | 'full';

export interface Appearance {
  name: string;
  sex: Sex;
  build: Build;
  /** cm */
  height: number;
  skin: number;
  /** Face variant index (jaw, nose, brows). */
  face: number;
  hair: HairStyle;
  hairColor: number;
  beard: Beard;
}

export const SKIN_TONES = [0xe8c4a8, 0xd9a882, 0xc8946c, 0xa87452, 0x8a5a3c, 0x5e3c28] as const;
export const HAIR_COLORS = [0x1e1a16, 0x3a2a1e, 0x5e3e22, 0x8a6a3c, 0xd0b47a, 0xb89a62, 0x7a7670, 0x6a2e1e] as const;
export const HAIR_STYLES: readonly HairStyle[] = ['short', 'buzz', 'long', 'ponytail', 'curly', 'bald'];
export const SEXES: readonly Sex[] = ['male', 'female'];
export const BUILDS: readonly Build[] = ['slim', 'average', 'heavy'];
export const BEARDS: readonly Beard[] = ['none', 'stubble', 'full'];
export const FACES = 4;
export const HEIGHT_RANGE = [158, 196] as const;

export const SEX_LABEL: Record<Sex, string> = { male: 'Мужчина', female: 'Женщина' };
export const BUILD_LABEL: Record<Build, string> = { slim: 'Худощавое', average: 'Среднее', heavy: 'Крупное' };
export const HAIR_LABEL: Record<HairStyle, string> = { short: 'Короткая', buzz: 'Под машинку', long: 'Длинная', ponytail: 'Хвост', curly: 'Кудри', bald: 'Лысый' };
export const BEARD_LABEL: Record<Beard, string> = { none: 'Нет', stubble: 'Щетина', full: 'Борода' };

/** The reference sheets' clothes (the editor's «Повседневная»: tee, jeans, sneakers; colours before grim). */
export const REF_CLOTHES: Record<Sex, { tee: number; jeans: number; shoes: number }> = {
  male: { tee: 0xdcddd8, jeans: 0x8a8e88, shoes: 0xc8c0ae },
  female: { tee: 0xe2e2de, jeans: 0x9ca286, shoes: 0xccc4b2 },
};

/** The two bases as on the reference sheets. */
export const BASE_LOOK: Readonly<Record<Sex, Readonly<Appearance>>> = {
  male: { name: 'Выживший', sex: 'male', build: 'average', height: 178, skin: 0xd9a882, face: 0, hair: 'short', hairColor: 0x5e3e22, beard: 'stubble' },
  female: { name: 'Выжившая', sex: 'female', build: 'slim', height: 166, skin: 0xe8c4a8, face: 2, hair: 'ponytail', hairColor: 0xd0b47a, beard: 'none' },
};

/** Old saves and quick starts: the male base. */
export const DEFAULT_APPEARANCE: Readonly<Appearance> = BASE_LOOK.male;

/** A base's look (the reference's), keeping a name if given. */
export function baseLook(sex: Sex, name?: string): Appearance {
  return { ...BASE_LOOK[sex], ...(name ? { name } : {}) };
}

/** The first-person hand: a woman's is lighter (narrower, a little shorter). */
export function handScale(a: Pick<Appearance, 'sex'>): number {
  return a.sex === 'female' ? 0.86 : 1;
}

const NAMES: Record<Sex, string[]> = {
  male: ['Алекс', 'Саша', 'Женя', 'Макс', 'Кирилл', 'Лёша', 'Олег'],
  female: ['Саша', 'Женя', 'Ника', 'Дана', 'Вера', 'Тома', 'Ира'],
};

export function randomAppearance(rand: () => number = Math.random): Appearance {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const sex: Sex = rand() < 0.5 ? 'male' : 'female';
  const [lo, hi] = sex === 'male' ? [166, HEIGHT_RANGE[1]] : [HEIGHT_RANGE[0], 182];
  return {
    name: pick(NAMES[sex]),
    sex,
    build: pick(BUILDS),
    height: Math.round(lo + rand() * (hi - lo)),
    skin: pick(SKIN_TONES),
    face: Math.floor(rand() * FACES),
    hair: sex === 'male' ? pick(HAIR_STYLES) : pick(HAIR_STYLES.filter((h) => h !== 'bald' && h !== 'buzz')),
    hairColor: pick(HAIR_COLORS),
    beard: sex === 'female' || rand() < 0.4 ? 'none' : pick(BEARDS),
  };
}

/** Accepts anything from a save; fills what is missing with defaults (old saves: the male base). */
export function sanitizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const sex: Sex = a?.sex && SEXES.includes(a.sex) ? a.sex : 'male';
  const d = BASE_LOOK[sex];
  return {
    name: typeof a?.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 20) : d.name,
    sex,
    build: a?.build && BUILDS.includes(a.build) ? a.build : d.build,
    height: typeof a?.height === 'number' ? Math.min(HEIGHT_RANGE[1], Math.max(HEIGHT_RANGE[0], a.height)) : d.height,
    skin: typeof a?.skin === 'number' ? a.skin : d.skin,
    face: typeof a?.face === 'number' ? Math.abs(Math.floor(a.face)) % FACES : d.face,
    hair: a?.hair && HAIR_STYLES.includes(a.hair) ? a.hair : d.hair,
    hairColor: typeof a?.hairColor === 'number' ? a.hairColor : d.hairColor,
    beard: sex === 'female' ? 'none' : a?.beard && BEARDS.includes(a.beard) ? a.beard : d.beard,
  };
}
