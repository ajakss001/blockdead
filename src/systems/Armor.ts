import type { WearSlot } from '../data/items';
import type { Worn } from './Inventory';

export type HitZone = 'head' | 'torso' | 'limbs';

export interface ArmorHitResult {
  damage: number;
  reduction: number;
  hitSlot: 'head' | 'vest' | null;
  armored: boolean;
}

/**
 * Unified ballistic zonal armor calculation shared by both player and bandit bots.
 * Head hits are mitigated solely by worn helmets; torso hits solely by body armor vests; limb hits are unarmored.
 */
export function applyZonalArmor(
  rawDamage: number,
  zone: HitZone,
  worn: Readonly<Partial<Worn>>,
  wornDirt?: Readonly<Partial<Record<WearSlot, number>>>,
): ArmorHitResult {
  let base = 0;
  let slot: 'head' | 'vest' | null = null;
  if (zone === 'head') {
    const h = worn.head;
    if (h === 'helmetSwat') base = 0.35;
    else if (h === 'helmetMilitary') base = 0.32;
    else if (h === 'helmetFire') base = 0.28;
    else if (h === 'helmetConstruction') base = 0.2;
    if (base > 0) slot = 'head';
  } else if (zone === 'torso' && worn.vest) {
    const v = worn.vest;
    base = v === 'vestSwat' ? 0.4 : v === 'vestMilitary' ? 0.34 : 0.3;
    slot = 'vest';
  }

  if (!slot || base <= 0) {
    return { damage: rawDamage, reduction: 0, hitSlot: null, armored: false };
  }

  const wear = Math.min(1, Math.max(0, wornDirt?.[slot] ?? 0));
  const reduction = base * (1 - wear * 0.25);
  return {
    damage: rawDamage * (1 - reduction),
    reduction,
    hitSlot: slot,
    armored: reduction > 0,
  };
}
