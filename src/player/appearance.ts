/**
 * How the survivor looks (chosen in the character editor, stored in the save). Affects the 3D figure
 * in the inventory and the first-person hands and legs (skin tone).
 */
export type Build = 'slim' | 'average' | 'heavy';
export type HairStyle = 'short' | 'buzz' | 'long' | 'ponytail' | 'curly' | 'bald';
export type Beard = 'none' | 'stubble' | 'full';

export interface Appearance {
  name: string;
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
export const HAIR_COLORS = [0x1e1a16, 0x3a2a1e, 0x5e3e22, 0x8a6a3c, 0xb89a62, 0x7a7670, 0x6a2e1e] as const;
export const HAIR_STYLES: readonly HairStyle[] = ['short', 'buzz', 'long', 'ponytail', 'curly', 'bald'];
export const BUILDS: readonly Build[] = ['slim', 'average', 'heavy'];
export const BEARDS: readonly Beard[] = ['none', 'stubble', 'full'];
export const FACES = 4;
export const HEIGHT_RANGE = [158, 196] as const;

export const BUILD_LABEL: Record<Build, string> = { slim: 'Худощавое', average: 'Среднее', heavy: 'Крупное' };
export const HAIR_LABEL: Record<HairStyle, string> = { short: 'Короткая', buzz: 'Под машинку', long: 'Длинная', ponytail: 'Хвост', curly: 'Кудри', bald: 'Лысый' };
export const BEARD_LABEL: Record<Beard, string> = { none: 'Нет', stubble: 'Щетина', full: 'Борода' };

/** Old saves and quick starts: an average survivor (the look the game had before the editor). */
export const DEFAULT_APPEARANCE: Readonly<Appearance> = {
  name: 'Выживший',
  build: 'average',
  height: 176,
  skin: 0xc8946c,
  face: 0,
  hair: 'short',
  hairColor: 0x2e241c,
  beard: 'none',
};

const NAMES = ['Алекс', 'Саша', 'Женя', 'Макс', 'Ника', 'Дана', 'Кирилл', 'Вера', 'Лёша', 'Тома', 'Олег', 'Ира'];

export function randomAppearance(rand: () => number = Math.random): Appearance {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  return {
    name: pick(NAMES),
    build: pick(BUILDS),
    height: Math.round(HEIGHT_RANGE[0] + rand() * (HEIGHT_RANGE[1] - HEIGHT_RANGE[0])),
    skin: pick(SKIN_TONES),
    face: Math.floor(rand() * FACES),
    hair: pick(HAIR_STYLES),
    hairColor: pick(HAIR_COLORS),
    beard: rand() < 0.5 ? 'none' : pick(BEARDS),
  };
}

/** Accepts anything from a save; fills what is missing with defaults. */
export function sanitizeAppearance(a: Partial<Appearance> | undefined): Appearance {
  const d = DEFAULT_APPEARANCE;
  return {
    name: typeof a?.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 20) : d.name,
    build: a?.build && BUILDS.includes(a.build) ? a.build : d.build,
    height: typeof a?.height === 'number' ? Math.min(HEIGHT_RANGE[1], Math.max(HEIGHT_RANGE[0], a.height)) : d.height,
    skin: typeof a?.skin === 'number' ? a.skin : d.skin,
    face: typeof a?.face === 'number' ? Math.abs(Math.floor(a.face)) % FACES : d.face,
    hair: a?.hair && HAIR_STYLES.includes(a.hair) ? a.hair : d.hair,
    hairColor: typeof a?.hairColor === 'number' ? a.hairColor : d.hairColor,
    beard: a?.beard && BEARDS.includes(a.beard) ? a.beard : d.beard,
  };
}
