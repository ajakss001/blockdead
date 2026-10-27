import { ITEMS } from '../data/items';
import type { Worn } from '../systems/Inventory';
import type { ShoeStyle } from './shoe';

export const SKIN = 0xc8946c;

/** What the first-person body shows for the clothes worn; null = bare skin. */
export interface Outfit {
  sleeves: number | null;
  pants: number | null;
  shoes: ShoeStyle;
}

const darker = (c: number, k: number) =>
  (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

export function outfitFrom(worn: Worn): Outfit {
  const torso = worn.torso ? ITEMS[worn.torso].wear! : null;
  const legs = worn.legs ? ITEMS[worn.legs].wear! : null;
  const feet = worn.feet ? ITEMS[worn.feet].wear! : null;
  let shoes: ShoeStyle;
  if (feet?.shoe === 'boots') {
    shoes = { kind: 'boots', upper: feet.color, sole: 0x1f1b17, laces: 0x2a2018, collar: darker(feet.color, 0.7) };
  } else if (feet) {
    shoes = { kind: 'sneakers', upper: feet.color, sole: 0xcfc6b2, laces: 0xd6cfbf, collar: darker(feet.color, 0.55) };
  } else {
    shoes = { kind: 'barefoot', upper: SKIN, sole: darker(SKIN, 0.75), laces: SKIN, collar: SKIN };
  }
  return { sleeves: torso?.color ?? null, pants: legs?.color ?? null, shoes };
}

export function cuffColor(sleeves: number): number {
  return darker(sleeves, 0.72);
}
