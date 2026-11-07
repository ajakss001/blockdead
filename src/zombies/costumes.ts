import type { CostumeId } from '../characters/assets';
import type { ModelKind } from './stats';

/**
 * What a zombie wears: a class costume, mostly by its kind — and the kind comes from the place
 * (world/zombieKinds: the police station's are police, the base's soldiers, the fire crews' firefighters, the
 * lab's medics) — or now and then any costume (people fled in what they had). Men only for now: a woman's
 * kind stays in the female base body, except the medics, half of whom are male doctors. Fixed by the id.
 */

/** Per kind: [costume, share]; the rest of that kind in its everyday clothes. */
const BY_KIND: Partial<Record<ModelKind, [CostumeId, number][]>> = {
  police: [['police', 0.75], ['swat', 0.2]],
  soldier: [['military', 0.9]],
  firefighter: [['firefighter', 0.9]],
  medic: [['doctor', 0.5]],
  worker: [['mechanic', 0.6]],
  builder: [['builder', 0.85]],
};

const ANY: readonly CostumeId[] = ['police', 'military', 'firefighter', 'doctor', 'mechanic', 'builder', 'swat'];
/** Any other man: this share in a random costume. */
const STRAY = 0.08;

function hash(id: number, salt: number): number {
  let h = (Math.imul(id ^ salt, 2654435761) ^ (id >>> 13)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The costume of a zombie (`own`: set by the world, e.g. a dead survivor's twin in their costume; null: none). */
export function zombieCostume(id: number, kind: ModelKind, female: boolean, own?: CostumeId | null): CostumeId | null {
  if (own !== undefined) return own;
  const r = hash(id, 0x51ed);
  let acc = 0;
  for (const [c, share] of BY_KIND[kind] ?? []) {
    acc += share;
    if (r < acc) return c;
  }
  if (female || BY_KIND[kind]) return null;
  return r < STRAY ? ANY[Math.floor(hash(id, 0x2b) * ANY.length)] : null;
}
