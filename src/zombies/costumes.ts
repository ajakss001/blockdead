import type { CostumeId } from '../characters/assets';
import type { GearId } from '../data/items';
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

/** Per costume, then per kind: [piece, share] — what a zombie of it still wears over its clothes. */
const GEAR_BY_COSTUME: Partial<Record<CostumeId, [GearId, number][]>> = {
  military: [['helmet_military', 0.8], ['vest_military', 0.7], ['backpack_military', 0.3], ['glasses_ballistic', 0.3], ['shemagh', 0.35]],
  swat: [['helmet_swat', 0.85], ['vest_swat', 0.9], ['goggles_tactical', 0.35], ['balaclava', 0.5]],
  firefighter: [['helmet_firefighter', 0.75]],
  builder: [['helmet_construction', 0.8], ['mask_half', 0.3]],
  mechanic: [['toolbox_mechanic', 0.3]],
  doctor: [['bag_medic', 0.4]],
};
const GEAR_BY_KIND: Partial<Record<ModelKind, [GearId, number][]>> = {
  soldier: [['helmet_military', 0.5], ['vest_military', 0.3], ['shemagh', 0.2], ['glasses_ballistic', 0.15]],
  firefighter: [['helmet_firefighter', 0.5]],
  builder: [['helmet_construction', 0.6], ['mask_half', 0.25]],
  medic: [['bag_medic', 0.25]],
  tourist: [['backpack_hiking', 0.5]],
  jogger: [['backpack_school', 0.3]],
  courier: [['backpack_school', 0.35]],
  survivorM: [['backpack_school', 0.35], ['backpack_hiking', 0.15]],
  survivorF: [['backpack_school', 0.35], ['backpack_hiking', 0.15]],
};

/** A zombie's gear (each piece by its own share; one per slot), fixed by the id. */
export function zombieGear(id: number, kind: ModelKind, _female: boolean, costume: CostumeId | null): GearId[] {
  const list = (costume && GEAR_BY_COSTUME[costume]) || GEAR_BY_KIND[kind] || [];
  const out: GearId[] = [];
  const slot = (g: GearId) => g.split('_')[0];
  list.forEach(([g, share], i) => {
    if (hash(id, 0x6e + i * 7) < share && !out.some((o) => slot(o) === slot(g))) out.push(g);
  });
  return out;
}
