import { buildChunk } from '../world/gen/buildChunk';
import { WorldLayout } from '../world/gen/layout';
import { LIFE } from '../world/gen/lifeKinds';
import { nearestPoi, type PoiKind } from '../world/gen/poi';
import { hasTemplate } from '../world/gen/poiScenes';
import { burningSpots, labCode, pickScenarios, SCENARIOS } from '../world/gen/scenarios';

/**
 * npm run test:scenes — what happened at the places (scenarios.ts / poiScenes.ts): every scenario has its
 * template; a site draws 2–4 of its pool, at most one burning now; three seeds give three different sets
 * for each type; the chunks build with them; a burning site has flames and a far column, a burnt one only
 * smoke; a camp leaves a stash with a note; the lab's code changes with the seed.
 */
const KINDS: PoiKind[] = ['airport', 'gas', 'police', 'hyper', 'mall', 'plant', 'checkpoint', 'base', 'lab'];
const SEEDS = [1993, 7, 424242, 31337, 2024, 555];

export function main(): number {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };
  for (const kind of KINDS) for (const d of SCENARIOS[kind]) if (!hasTemplate(kind, d.id)) check(false, `${kind}: ${d.id} has no template`);
  const codes = new Set<string>();
  let burningSites = 0;
  for (const kind of KINDS) {
    const sets: string[] = [];
    for (const seed of SEEDS) {
      const layout = new WorldLayout(seed);
      const site = nearestPoi(layout, kind, 0, 0, 120);
      if (!site) continue;
      const picked = pickScenarios(seed, site);
      const ids = picked.map((p) => `${p.def.id}${p.state === 'burning' ? '*' : p.state ? '°' : ''}`);
      sets.push(ids.slice().sort().join(' '));
      const burning = picked.filter((p) => p.state === 'burning').length;
      check(picked.length >= 2 && picked.length <= 4 && burning <= 1, `seed ${seed}: ${kind} at ${site.i}, ${site.j}: ${ids.join(', ')}`);
      if (kind === 'lab') codes.add(labCode(seed, site));
      // Build the lot with them: flames where it burns, smoke where it burnt, the camp's stash.
      let fires = 0;
      let smoke = 0;
      let stash = 0;
      let notes = 0;
      for (let i = site.i; i < site.i + (site.bw ?? 1); i++) {
        for (let j = site.j; j < site.j + (site.bd ?? 1); j++) {
          const c = buildChunk(layout, i, j);
          for (let k = 0; k < c.ambient.length; k += 10) {
            if (c.ambient[k] === LIFE.fire) fires++;
            if (c.ambient[k] === LIFE.smoke) smoke++;
          }
          for (const s of c.containers) {
            if (s.type !== 'campStash') continue;
            stash++;
            if (s.fixed?.some((f) => f.startsWith('campNote'))) notes++;
          }
        }
      }
      const fireDefs = picked.filter((p) => p.def.fire);
      if (burning) burningSites++;
      if (fireDefs.length) check(burning ? fires > 0 && burningSpots(seed, site).length > 0 : smoke > 0, `     ${kind}: ${burning ? `burning: ${fires} flames, far column` : `burnt out: ${smoke} smouldering`}`);
      if (picked.some((p) => p.def.id === 'camp')) check(stash >= 2 && notes >= 2, `     ${kind}: the camp's stash (${stash}, ${notes} with notes)`);
    }
    check(new Set(sets).size >= Math.min(3, sets.length) && sets.length >= 3, `${kind}: ${new Set(sets).size} different sets over ${sets.length} seeds`);
  }
  check(codes.size >= 3, `lab codes by seed: ${[...codes].join(', ')}`);
  check(burningSites > 0, `${burningSites} sites burning now over all seeds`);
  console.log(fails.length ? `\ntest:scenes FAILED (${fails.length})` : '\ntest:scenes passed');
  return fails.length ? 1 : 0;
}
