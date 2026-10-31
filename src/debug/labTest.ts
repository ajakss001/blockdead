import type { ItemId } from '../data/items';
import { buildChunk } from '../world/gen/buildChunk';
import { CHUNK, WorldLayout } from '../world/gen/layout';
import { nearestPoi, type PoiSite } from '../world/gen/poi';

/**
 * npm run test:lab — НИИ «Гелиос» (POI stage 3): on a few seeds the lab exists, its doors carry the four
 * locks, and the chain of puzzles can be walked from the front door to the isolation ward with only what
 * lies in rooms already open (cards, three fuses, the four parts of the code); the serum waits at the end.
 */
type Zone = 'front' | 'lab' | 'server' | 'generator' | 'ward';

/** World → the site's local frame (inverse of siteToWorld). */
function local(s: PoiSite, x: number, z: number): [number, number] {
  const dx = x - (s.i * CHUNK + CHUNK / 2);
  const dz = z - (s.j * CHUNK + CHUNK / 2);
  switch (s.r) {
    case 0:
      return [dx, dz];
    case 1:
      return [-dz, dx];
    case 2:
      return [-dx, -dz];
    default:
      return [dz, -dx];
  }
}

function zoneOf(lx: number, lz: number): Zone | null {
  if (lz > 0 && lz < 8) return 'front';
  if (lz < -12 && lz > -22) return 'ward';
  if (lz < -3 && lz > -12) return lx < -4 ? 'lab' : lx < 6 ? 'server' : 'generator';
  return null;
}

export function main(): number {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };
  for (const seed of [1993, 7, 424242]) {
    const layout = new WorldLayout(seed);
    const site = nearestPoi(layout, 'lab', 0, 0, 60);
    check(!!site, `seed ${seed}: a lab within 60 blocks${site ? ` (block ${site.i}, ${site.j})` : ''}`);
    if (!site) continue;
    const data = buildChunk(layout, site.i, site.j);
    const locks = new Map<string, Zone | null>();
    for (const d of data.doors) if (d.lock) locks.set(d.lock, zoneOf(...local(site, d.hx, d.hz)));
    check(['labGreen', 'labBlue', 'labPower', 'labIsolation'].every((l) => locks.has(l)), `seed ${seed}: the four locks are on the doors (${[...locks.keys()].join(', ')})`);
    // What lies in which zone (the fixed finds).
    const finds = new Map<Zone, ItemId[]>();
    let boxes = 0;
    for (const c of data.containers) {
      const z = zoneOf(...local(site, c.x, c.z));
      if (c.box) boxes++;
      if (!z || !c.fixed) continue;
      finds.set(z, [...(finds.get(z) ?? []), ...c.fixed]);
    }
    // Walk it: open zones give their finds; a door opens when its need is met.
    const have = new Map<ItemId, number>();
    const open = new Set<Zone>(['front']);
    let power = false;
    const take = (z: Zone) => {
      for (const id of finds.get(z) ?? []) have.set(id, (have.get(id) ?? 0) + 1);
    };
    take('front');
    const steps: string[] = ['front'];
    for (let guard = 0; guard < 10; guard++) {
      const before = open.size + (power ? 1 : 0);
      const enter = (z: Zone, ok: boolean) => {
        if (ok && !open.has(z)) {
          open.add(z);
          take(z);
          steps.push(z);
        }
      };
      enter('lab', (have.get('keycardGreen') ?? 0) > 0);
      enter('generator', (have.get('keycardBlue') ?? 0) > 0);
      if (!power && open.has('generator') && (have.get('fuse') ?? 0) >= 3) {
        power = true;
        steps.push('power');
      }
      enter('server', power);
      enter('ward', power && (['labNote1', 'labNote2', 'labNote3', 'labNote4'] as ItemId[]).every((n) => (have.get(n) ?? 0) > 0));
      if (open.size + (power ? 1 : 0) === before) break;
    }
    check(open.has('ward') && (have.get('serumG7') ?? 0) > 0, `seed ${seed}: solvable from the front door: ${steps.join(' → ')}; the serum in the ward`);
    check((have.get('fuse') ?? 0) === 3 && ['labJournal1', 'labJournal2', 'labJournal3'].every((j) => have.has(j as ItemId)), `seed ${seed}: three fuses and the three journals on the way`);
    check(boxes === data.containers.length, `seed ${seed}: every container has a fitted search zone (${boxes}/${data.containers.length})`);
  }
  console.log(fails.length ? `\ntest:lab FAILED (${fails.length})` : '\ntest:lab passed');
  return fails.length ? 1 : 0;
}
