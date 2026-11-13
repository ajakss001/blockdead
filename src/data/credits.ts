import { registerDataLocalizer } from '../core/i18n';

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

const SOUND_TEXT: readonly { what: [string, string]; title: [string, string]; changes: [string, string] }[] = [
  {
    what: ['Звуки', 'Sounds'],
    title: ['Effective Trailer Booms Vol. 2 — взрыв РПГ', 'Effective Trailer Booms Vol. 2 — RPG explosion'],
    changes: ['обрезан хвост до 4.5 с с затуханием, моно', 'tail trimmed to 4.5 s with fade-out, mono'],
  },
  {
    what: ['Звуки', 'Sounds'],
    title: ['Melee Weapons Sound Effects Pack 2 — замах, удар по металлу, тяжёлые удары', 'Melee Weapons Sound Effects Pack 2 — swing, metal hit, heavy blows'],
    changes: ['нарезка, нормализация, моно', 'sliced, normalized, mono'],
  },
  {
    what: ['Звуки', 'Sounds'],
    title: ['HD Lock And Mechanism Sound Design Kit — щелчок пустого магазина, затвор, гильзы и магазины', 'HD Lock And Mechanism Sound Design Kit — empty click, bolt, casings and magazines'],
    changes: ['нарезка, нормализация, моно', 'sliced, normalized, mono'],
  },
  {
    what: ['Звуки', 'Sounds'],
    title: ['HD Game Materials — пуля по металлу', 'HD Game Materials — bullet impact on metal'],
    changes: ['нормализация, моно', 'normalized, mono'],
  },
  {
    what: ['Звуки', 'Sounds'],
    title: ['Humanoid Creatures Vol 4 — голоса зомби', 'Humanoid Creatures Vol 4 — zombie vocals'],
    changes: ['нормализация, моно, высота ±10% в игре', 'normalized, mono, pitch ±10% in-game'],
  },
];

registerDataLocalizer((lang) => {
  const idx = lang === 'en' ? 1 : 0;
  for (let i = 0; i < SOUND_CREDITS.length; i++) {
    SOUND_CREDITS[i].what = SOUND_TEXT[i].what[idx];
    SOUND_CREDITS[i].title = SOUND_TEXT[i].title[idx];
    SOUND_CREDITS[i].changes = SOUND_TEXT[i].changes[idx];
  }
  LIBRARY_CREDITS[0].what = idx ? 'Engine' : 'Движок';
});
