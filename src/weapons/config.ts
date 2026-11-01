import type { ItemId } from '../data/items';

/** Melee weapons with their own procedural models (buildWeapon) and stats; the held poses are in player/held. */
export type WeaponId = 'fireAxe' | 'tacticalKnife' | 'crowbar' | 'hammer';

export interface WeaponConfig {
  /** The inventory item (and held item) it is. */
  item: ItemId & ('axe' | 'knife' | 'crowbar' | 'hammer');
  name: string;
  /** Overall length, m (butt to tip). */
  length: number;
  /** The grip point (model origin) from the butt along the handle, m: the hand's place (the lower hand of a two-handed one). */
  grip: number;
  /** Blows to kill a worker zombie (health 1.0); tougher kinds take more by their health. */
  hits: number;
  /** Least time between the starts of two blows, s. */
  interval: number;
  /** How far a blow reaches from the eye, m. */
  reach: number;
  /** Blows (that land on something) before it breaks. */
  durability: number;
  /** Strikes sparks off walls (steel); the knife doesn't. */
  sparks: boolean;
  /** Colours (hex) of the parts. */
  colors: Record<string, number>;
}

/** Health of a worker zombie in damage points (systems/zombies: hp 100 × its kind's factor 1.0). */
export const WORKER_HP = 100;

export const WEAPONS: Readonly<Record<WeaponId, WeaponConfig>> = {
  fireAxe: {
    item: 'axe',
    name: 'Пожарный топор',
    length: 0.9,
    grip: 0.06,
    hits: 2,
    interval: 1.1,
    reach: 1.6,
    durability: 200,
    sparks: true,
    colors: { head: 0xb8312f, edge: 0xc9ced3, handle: 0xe0b43a, grip: 0x2a2a2a },
  },
  crowbar: {
    item: 'crowbar',
    name: 'Лом',
    length: 0.75,
    grip: 0.05,
    hits: 3,
    interval: 0.8,
    reach: 1.5,
    durability: 300,
    sparks: true,
    colors: { paint: 0xa8322b, steel: 0x9aa0a6 },
  },
  hammer: {
    item: 'hammer',
    name: 'Молоток-гвоздодёр',
    length: 0.33,
    grip: 0.07,
    hits: 3,
    interval: 0.6,
    reach: 1.2,
    durability: 150,
    sparks: true,
    colors: { head: 0x8e959c, handle: 0xb07a45, grip: 0x2a2a2a },
  },
  tacticalKnife: {
    item: 'knife',
    name: 'Тактический нож',
    length: 0.28,
    grip: 0.05,
    hits: 4,
    interval: 0.4,
    reach: 1.0,
    durability: 120,
    sparks: false,
    colors: { blade: 0x4a4f55, edge: 0xa9afb5, handle: 0x222222, guard: 0x3a3e43, cord: 0xb59a6a },
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** The weapon an item is, if it is one of these. */
export function weaponOf(item: string | null | undefined): WeaponConfig | null {
  if (!item) return null;
  for (const id of WEAPON_IDS) if (WEAPONS[id].item === item) return WEAPONS[id];
  return null;
}

/** Damage of one blow (before the class's strength and the head's ×2): a worker falls in `hits` blows. */
export function weaponDamage(w: WeaponConfig): number {
  // A hair over, so float rounding never asks for one more blow.
  return (WORKER_HP / w.hits) * 1.001;
}
