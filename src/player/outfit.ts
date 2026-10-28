import { ITEMS, type WearSlot } from '../data/items';
import type { Worn } from '../systems/Inventory';
import type { ShoeStyle } from './shoe';

export const SKIN = 0xc8946c;

/** What the first-person body shows for the clothes worn; null = bare skin. */
export interface Outfit {
  /** Shirt / jacket body color (also short-sleeved tops); null = bare chest. */
  top: number | null;
  sleeves: number | null;
  pants: number | null;
  shoes: ShoeStyle;
  skin: number;
  /** Dirt of each worn piece, 0..1. */
  dirt: Record<WearSlot, number>;
}

const darker = (c: number, k: number) =>
  (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);

const CLEAN: Record<WearSlot, number> = { head: 0, torso: 0, legs: 0, feet: 0 };

export function outfitFrom(worn: Worn, skin = SKIN, dirt: Record<WearSlot, number> = CLEAN, tint: Partial<Record<WearSlot, number>> = {}): Outfit {
  const tinted = (slot: WearSlot) => {
    const id = worn[slot];
    if (!id) return null;
    const w = ITEMS[id].wear!;
    return tint[slot] !== undefined ? { ...w, color: tint[slot]! } : w;
  };
  const torso = tinted('torso');
  const legs = tinted('legs');
  const feet = tinted('feet');
  let shoes: ShoeStyle;
  if (feet?.shoe === 'boots') {
    shoes = { kind: 'boots', upper: feet.color, sole: 0x1f1b17, laces: 0x2a2018, collar: darker(feet.color, 0.7) };
  } else if (feet) {
    shoes = { kind: 'sneakers', upper: feet.color, sole: 0xcfc6b2, laces: 0xd6cfbf, collar: darker(feet.color, 0.55) };
  } else {
    shoes = { kind: 'barefoot', upper: skin, sole: darker(skin, 0.75), laces: skin, collar: skin };
  }
  return { top: torso?.color ?? null, sleeves: torso && torso.sleeves !== false ? torso.color : null, pants: legs?.color ?? null, shoes, skin, dirt: { ...dirt } };
}

export function cuffColor(sleeves: number): number {
  return darker(sleeves, 0.72);
}
