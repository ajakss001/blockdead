import { WEAR_SLOTS, type WearSlot } from '../data/items';
import type { Inventory } from './Inventory';

/**
 * How fast worn clothes get dirty, per second of play (dirt is 0..1).
 * Walking around town: ~0.4 % a minute; running ×4; crawling and creeping soil the legs and shoes;
 * rummaging through containers soils the jacket and trousers. `weather` multiplies everything
 * outdoors (rain and mud later; 1 for now).
 */
const RATE = {
  idle: 0.0000065,
  moving: 0.000067,
  sprintFactor: 4,
  crouchFactor: 3,
  searching: 0.0012,
} as const;

/** Where dirt lands: feet first, the head last. */
const SLOT_WEIGHT: Record<WearSlot, number> = { head: 0.4, torso: 0.9, vest: 0.8, hands: 1.2, legs: 1.4, feet: 2.2, back: 0.6 };

export interface Activity {
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  searching: boolean;
  /** Weather multiplier (rain, mud): 1 = dry. */
  weather: number;
}

export function soilClothes(inv: Inventory, dt: number, a: Activity): void {
  let base = a.moving ? RATE.moving : RATE.idle;
  if (a.sprinting) base *= RATE.sprintFactor;
  base *= a.weather;
  for (const slot of WEAR_SLOTS) {
    if (!inv.worn[slot]) continue;
    let d = base * SLOT_WEIGHT[slot];
    if (a.crouching && (slot === 'legs' || slot === 'feet')) d *= RATE.crouchFactor;
    if (a.searching && (slot === 'torso' || slot === 'legs')) d += RATE.searching;
    inv.wornDirt[slot] = Math.min(1, inv.wornDirt[slot] + d * dt);
  }
}

/** The visible dirt steps (as in characterMaterial) of the worn clothes, as a compact key. */
export function dirtSteps(dirt: Record<WearSlot, number>): string {
  return WEAR_SLOTS.map((s) => Math.round(dirt[s] * 4)).join('');
}
