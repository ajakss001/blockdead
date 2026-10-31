import { mulberry32 } from '../../core/random';
import { hash3 } from './noise';
import { type PoiKind, type PoiSite, siteToWorld } from './poi';

/*
 * What happened at a place: each POI type has a pool of scenarios, a site draws 2–4 of them by its seed, so
 * two airports (two gas stations…) tell different stories. A scenario here is data — its id, how often it
 * is drawn, where it burns; how it looks is its template in poiScenes (same id). A new scenario = an entry
 * here + a template there.
 *
 * Fire: a scenario with fire points is either burning now (rare, at most one per site: the flames, a column
 * of smoke seen from afar, the glow at night) or burnt out (more often: charred, still smouldering).
 */

export type SceneState = 'burning' | 'burnt' | null;

/** A fire point: local x, z, flame size (m), height of its base. */
export type FirePoint = [number, number, number, number?];

export interface ScenarioDef {
  id: string;
  /** How often it is drawn (default 1). */
  weight?: number;
  /** Where it burns; the first point is the column's source. */
  fire?: FirePoint[];
  /** Chance to be burning now when drawn (default 0.3); otherwise it burnt out. */
  burns?: number;
  /** Never drawn together with these. */
  not?: string[];
}

export const SCENARIOS: Record<PoiKind, ScenarioDef[]> = {
  airport: [
    { id: 'heliFlip', fire: [[26, 22, 1.6]], burns: 0.2 },
    { id: 'linerFire', weight: 1.4, fire: [[-50, -38, 3.2, 1.2], [-47, -45, 2.2, 1.4], [-53, -31, 2.2, 1.4]], burns: 0.55 },
    { id: 'terminalCrash', fire: [[-38, 6, 2.2]], burns: 0.3 },
    { id: 'slides' },
    { id: 'luggage', weight: 1.2 },
    { id: 'fuelTruck', fire: [[20, -6, 2.4]], burns: 0.3 },
    { id: 'fireCrew' },
    { id: 'camp', weight: 1.2 },
    { id: 'board' },
    { id: 'announce' },
    { id: 'crew' },
  ],
  gas: [
    { id: 'pumpsBlown', weight: 1.3, fire: [[-3.5, 10.2, 1.5], [3.5, 13.8, 1.7]], burns: 0.45 },
    { id: 'canopyDown', fire: [[5, 12, 1.1]], burns: 0.1 },
    { id: 'burntCars', fire: [[-14, 10, 1.4], [-18, 15, 1.2], [13, 5, 1.2]], burns: 0.25 },
    { id: 'queue', weight: 1.2 },
    { id: 'looted' },
    { id: 'noFuel' },
    { id: 'camp', not: ['looted'] },
    { id: 'sheen' },
  ],
  police: [
    { id: 'barricade', weight: 1.3 },
    { id: 'flipped', fire: [[15, 14, 1.2]], burns: 0.2 },
    { id: 'swat' },
    { id: 'sandbags' },
    { id: 'cells' },
    { id: 'lastStand', weight: 1.2 },
    { id: 'radio' },
    { id: 'files' },
  ],
  hyper: [
    { id: 'cartWall', weight: 1.2 },
    { id: 'emptyShelves', weight: 1.3 },
    { id: 'fallen' },
    { id: 'carCrash', fire: [[8, 12.8, 1.2]], burns: 0.25 },
    { id: 'camp' },
    { id: 'flicker' },
    { id: 'alarm' },
  ],
  mall: [
    { id: 'mannequins', weight: 1.3 },
    { id: 'fountain' },
    { id: 'escalators' },
    { id: 'shutters' },
    { id: 'foodCourt' },
    { id: 'music', weight: 1.2 },
  ],
  plant: [
    { id: 'flooded', weight: 1.2 },
    { id: 'burst', weight: 1.2 },
    { id: 'steam' },
    { id: 'alarm' },
    { id: 'evac' },
  ],
  checkpoint: [
    { id: 'burningTank', weight: 1.3, fire: [[-4, -16, 2.6, 1.0]], burns: 0.5 },
    { id: 'breached' },
    { id: 'collapsed' },
    { id: 'flares' },
    { id: 'searchlight' },
    { id: 'megaphone' },
    { id: 'crates' },
  ],
  base: [
    { id: 'heliHangar', fire: [[32, -21, 1.8]], burns: 0.2 },
    { id: 'fuelDepot', weight: 1.3, fire: [[-5, 34, 3.0, 1.5], [-5, 42, 2.4, 1.5], [3, 38, 2.0]], burns: 0.55 },
    { id: 'apcFlip', fire: [[-40, -2, 1.4]], burns: 0.15 },
    { id: 'breach' },
    { id: 'siren' },
    { id: 'radar' },
    { id: 'flags' },
  ],
  lab: [
    { id: 'glassBroken', weight: 1.3 },
    { id: 'shower' },
    { id: 'burnBarrel', fire: [[-17, 11.5, 0.55, 0.9]], burns: 0.6 },
    { id: 'biotape', weight: 1.2 },
    { id: 'quarantine' },
  ],
  park: [],
};

export interface Picked {
  def: ScenarioDef;
  state: SceneState;
}

/** The scenarios a site gets (2–4, at most one burning now): the same for every chunk and every caller. */
export function pickScenarios(seed: number, site: PoiSite): Picked[] {
  const pool = SCENARIOS[site.kind].slice();
  if (!pool.length) return [];
  const rand = mulberry32(hash3(seed ^ 0x5ce7a, site.i * 131 + 17, site.j * 733 + 29));
  const n = Math.min(pool.length, 2 + Math.floor(rand() * 3));
  const out: Picked[] = [];
  let burning = false;
  while (out.length < n && pool.length) {
    let sum = 0;
    for (const d of pool) sum += d.weight ?? 1;
    let r = rand() * sum;
    let k = 0;
    while (k < pool.length - 1 && (r -= pool[k].weight ?? 1) > 0) k++;
    const def = pool.splice(k, 1)[0];
    for (let i = pool.length - 1; i >= 0; i--) if (def.not?.includes(pool[i].id) || pool[i].not?.includes(def.id)) pool.splice(i, 1);
    let state: SceneState = null;
    if (def.fire) {
      state = !burning && rand() < (def.burns ?? 0.3) ? 'burning' : 'burnt';
      if (state === 'burning') burning = true;
    }
    out.push({ def, state });
  }
  return out;
}

/** Where a site burns now (world x, z, flame size): the far smoke column and the glow come from these. */
export function burningSpots(seed: number, site: PoiSite): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const { def, state } of pickScenarios(seed, site)) {
    if (state !== 'burning') continue;
    for (const [lx, lz, w] of def.fire!) {
      const [x, z] = siteToWorld(site, lx, lz);
      out.push([x, z, w]);
    }
  }
  return out;
}

/** The isolation ward's code of a lab (four digits, by its seed). */
export function labCode(seed: number, site: PoiSite): string {
  const rand = mulberry32(hash3(seed ^ 0x1ab, site.i * 977 + 5, site.j * 331 + 11));
  return [0, 1, 2, 3].map(() => 1 + Math.floor(rand() * 9)).join('-');
}
