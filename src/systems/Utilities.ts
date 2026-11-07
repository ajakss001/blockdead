import { mulberry32 } from '../core/random';

/*
 * The world runs down (Zomboid): the city still has power and water at first — tubes buzzing in the
 * corridors, TVs on, fridges humming, taps dripping — and then one day the power is cut everywhere, and a
 * day or two later the water. When is fixed by the world's seed and counted on its clock, so it is the
 * same after a reload and after a death (the next survivor arrives into the darker city).
 * Only someone's generator or candles stay lit (window/room mode 0), and the labs on their own generators.
 */

const DAY = 24 * 60;

export interface GridSchedule {
  /** In-game minute the power goes out (from the first midnight). */
  powerOff: number;
  waterOff: number;
}

/** Power out on day 3–6 at any hour, water 1–3 days after. `?grid=off|on` for checking. */
export function gridSchedule(seed: number): GridSchedule {
  const q = new URLSearchParams(location.search).get('grid');
  if (q === 'off') return { powerOff: 0, waterOff: 0 };
  if (q === 'on') return { powerOff: Infinity, waterOff: Infinity };
  const rand = mulberry32(seed ^ 0x9e1d);
  const powerOff = (3 + rand() * 3) * DAY;
  return { powerOff, waterOff: powerOff + (1 + rand() * 2) * DAY };
}

/** Water from a tap, thirst (the bottle gives 0.5). */
export const TAP_DRINK = 0.35;
