import { DOWNTOWN_RADIUS, WorldLayout } from '../world/gen/layout';
import { nearestPoi, POI, type PoiKind } from '../world/gen/poi';

/**
 * npm run test:poi — unique places: the same seed gives the same places; downtown has its police station;
 * no two of a kind closer than minDist; each stands in an allowed zone and faces a road (gas stations a
 * through road); a few seeds.
 */
export function main(): number {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };
  const R = 48;
  for (const seed of [1993, 7, 424242]) {
    const a = new WorldLayout(seed);
    const b = new WorldLayout(seed);
    const sites = Object.fromEntries(Object.keys(POI).map((k) => [k, [] as [number, number][]])) as Record<PoiKind, [number, number][]>;
    let same = true;
    let zonesOk = true;
    let roadsOk = true;
    for (let i = -R; i <= R; i++) {
      for (let j = -R; j <= R; j++) {
        const s = a.poi(i, j);
        const t = b.poi(i, j);
        if (JSON.stringify(s) !== JSON.stringify(t)) same = false;
        if (!s) continue;
        if (s.i === i && s.j === j) sites[s.kind].push([i, j]);
        const zone = a.zone(i, j);
        if (!(POI[s.kind].zones as readonly string[]).includes(zone) && !(zone === 'downtown' && POI[s.kind].downtown)) zonesOk = false;
        const bw = s.bw ?? 1;
        const bd = s.bd ?? 1;
        if (bw > 1 || bd > 1) {
          // A big place: its whole front edge on a major road, no road through it.
          if (s.i !== i || s.j !== j) continue;
          for (let k = 0; k < (s.r & 1 ? bd : bw); k++) {
            const front = s.r === 0 ? a.roadZ(i + k, j + bd) : s.r === 2 ? a.roadZ(i + k, j) : s.r === 1 ? a.roadX(i + bw, j + k) : a.roadX(i, j + k);
            if (!front) roadsOk = false;
          }
          for (let x = i; x < i + bw; x++) for (let z = j; z < j + bd; z++) if ((x > i && a.roadX(x, z)) || (z > j && a.roadZ(x, z))) roadsOk = false;
          continue;
        }
        const facing = [a.roadZ(i, j), a.roadX(i + 1, j), a.roadZ(i, j + 1), a.roadX(i, j)][[2, 1, 0, 3].indexOf(s.r)];
        if (!facing) roadsOk = false;
      }
    }
    check(same, `seed ${seed}: two layouts from one seed agree on every place`);
    check(zonesOk, `seed ${seed}: every place in an allowed zone`);
    check(roadsOk, `seed ${seed}: every place faces a road`);
    const downtownPolice = sites.police.filter(([i, j]) => Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS).length;
    check(downtownPolice >= 1, `seed ${seed}: a police station downtown (${downtownPolice})`);
    for (const kind of Object.keys(POI) as PoiKind[]) {
      let minD = Infinity;
      const list = sites[kind];
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) minD = Math.min(minD, Math.hypot(list[x][0] - list[y][0], list[x][1] - list[y][1]));
      // The big ones are very rare: one within 120 blocks is enough.
      const big = 'blocks' in POI[kind];
      const far = big ? nearestPoi(a, kind, 0, 0, 120) : null;
      check((list.length > 0 || !!far) && minD >= POI[kind].minDist, `seed ${seed}: ${kind} ×${list.length} within ${R} blocks${big ? ` (nearest at ${far ? `${far.i}, ${far.j}` : 'none'})` : ''}, nearest two ${minD.toFixed(1)} ≥ ${POI[kind].minDist}`);
    }
  }
  console.log(fails.length ? `\ntest:poi FAILED (${fails.length})` : '\ntest:poi passed');
  return fails.length ? 1 : 0;
}
