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
  license: 'CC0' | 'CC BY 4.0' | 'MIT';
  url: string;
  /** Changes made for the game (optimized, retextured, …). */
  changes?: string;
}

export const MODEL_CREDITS: readonly Credit[] = [];

export const LIBRARY_CREDITS: readonly Credit[] = [{ what: 'Движок', title: 'three.js', author: 'three.js authors', license: 'MIT', url: 'https://threejs.org' }];
