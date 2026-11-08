/**
 * Third-party assets shown on the "Авторы" screen (mirror of assets/CREDITS.md).
 * Only CC0 and CC BY are allowed; CC BY needs the author and a link, and "изменено" if we changed it.
 */
export interface Credit {
  /** What it is in the game. */
  what: string;
  /** Original title. */
  title: string;
  author: string;
  license: 'CC0' | 'CC BY 4.0' | 'MIT' | 'Sonniss GDC 2026';
  url: string;
  /** Changes made for the game (optimized, retextured, …). */
  changes?: string;
}

export const MODEL_CREDITS: readonly Credit[] = [];

/** Recorded sounds (tools/build-sounds.mjs: cut, trimmed, normalised, mono MP3). */
export const SOUND_CREDITS: readonly Credit[] = [
  { what: 'Звуки', title: 'Effective Trailer Booms Vol. 2 — взрыв РПГ', author: 'Federico Soler', license: 'Sonniss GDC 2026', url: 'https://sonniss.com/gameaudiogdc', changes: 'обрезан хвост до 4.5 с с затуханием, моно' },
  { what: 'Звуки', title: 'Melee Weapons Sound Effects Pack 2 — замах, удар по металлу, тяжёлые удары', author: 'David Dumais Audio', license: 'Sonniss GDC 2026', url: 'https://sonniss.com/gameaudiogdc', changes: 'нарезка, нормализация, моно' },
  { what: 'Звуки', title: 'HD Lock And Mechanism Sound Design Kit — щелчок пустого магазина, затвор, гильзы и магазины', author: 'Epic Stock Media', license: 'Sonniss GDC 2026', url: 'https://sonniss.com/gameaudiogdc', changes: 'нарезка, нормализация, моно' },
  { what: 'Звуки', title: 'HD Game Materials — пуля по металлу', author: 'Epic Stock Media', license: 'Sonniss GDC 2026', url: 'https://sonniss.com/gameaudiogdc', changes: 'нормализация, моно' },
  { what: 'Звуки', title: 'Humanoid Creatures Vol 4 — голоса зомби', author: 'Epic Stock Media', license: 'Sonniss GDC 2026', url: 'https://sonniss.com/gameaudiogdc', changes: 'нормализация, моно, высота ±10% в игре' },
];

export const LIBRARY_CREDITS: readonly Credit[] = [{ what: 'Движок', title: 'three.js', author: 'three.js authors', license: 'MIT', url: 'https://threejs.org' }];
