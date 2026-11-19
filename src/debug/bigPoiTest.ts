import { buildChunk } from '../world/gen/buildChunk';
import { CHUNK, WorldLayout } from '../world/gen/layout';
import { nearestPoi, type PoiKind } from '../world/gen/poi';

/**
 * npm run test:bigpoi — the airport and the military base (POI stage 4) span several chunks: every chunk
 * of the lot names the same site, builds only its own part (each container, door and collider lands in
 * the chunk it stands in, none twice), builds the same thing every time, and the lot has what it should:
 * check-in, cabins and holds to search at the airport; lockers, the canteen, crates and vehicle cabins at
 * the base.
 */
const WANT: Record<string, string[]> = {
  airport: ['checkin', 'suitcase', 'planeCabin', 'cargoHold', 'garage'],
  base: ['militaryLocker', 'canteen', 'militaryCrate', 'baseArmory', 'vehicleCabin', 'cargoHold'],
};

export function main(): number {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };
  for (const seed of [1993, 7]) {
    const layout = new WorldLayout(seed);
    for (const kind of ['airport', 'base'] as PoiKind[]) {
      const site = nearestPoi(layout, kind, 0, 0, 120);
      check(!!site, `seed ${seed}: ${kind} found${site ? ` (blocks ${site.i}, ${site.j}, ${site.bw}×${site.bd})` : ''}`);
      if (!site) continue;
      const bw = site.bw ?? 1;
      const bd = site.bd ?? 1;
      let same = true;
      let inOwn = true;
      let empty = 0;
      let tris = 0;
      const seen = new Map<string, number>();
      const types = new Set<string>();
      for (let i = site.i; i < site.i + bw; i++) {
        for (let j = site.j; j < site.j + bd; j++) {
          const s = layout.poi(i, j);
          if (!s || s.i !== site.i || s.j !== site.j) same = false;
          const a = buildChunk(layout, i, j);
          const b = buildChunk(layout, i, j);
          const n = a.surfaces.reduce((k, x) => k + x.index.length / 3, 0);
          const m = b.surfaces.reduce((k, x) => k + x.index.length / 3, 0);
          if (n !== m || a.containers.length !== b.containers.length) same = false;
          if (n < 200) (empty++, console.log(`     empty chunk ${i}, ${j}`));
          tris += n;
          // Only what is the place's own (the lot inside its road strips): roadside scenes belong to the roads.
          const lot = (x: number, z: number) => x > site.i * CHUNK + 5.8 && x < (site.i + bw) * CHUNK - 5.8 && z > site.j * CHUNK + 5.8 && z < (site.j + bd) * CHUNK - 5.8;
          const inside = (x: number, z: number) => !lot(x, z) || (x >= i * CHUNK && x < (i + 1) * CHUNK && z >= j * CHUNK && z < (j + 1) * CHUNK);
          for (const c of a.containers) {
            if (!inside(c.x, c.z)) (inOwn = false), console.log(`     outside: ${c.type} at ${c.x.toFixed(1)}, ${c.z.toFixed(1)} in ${i}, ${j}`);
            types.add(c.type);
            const key = `${c.type}@${c.x.toFixed(2)},${c.z.toFixed(2)}`;
            seen.set(key, (seen.get(key) ?? 0) + 1);
          }
          for (const d of a.doors) if (!inside(d.hx, d.hz)) (inOwn = false), console.log(`     outside: door at ${d.hx.toFixed(1)}, ${d.hz.toFixed(1)}`);
          for (let k = 0; k < a.colliders.length; k += 8) if (!inside(a.colliders[k], a.colliders[k + 1]) && Math.max(a.colliders[k + 2], a.colliders[k + 3]) < 20) (inOwn = false), console.log(`     outside: collider at ${a.colliders[k].toFixed(1)}, ${a.colliders[k + 1].toFixed(1)} size ${a.colliders[k + 2].toFixed(1)}×${a.colliders[k + 3].toFixed(1)}`);
        }
      }
      const dup = [...seen.values()].filter((v) => v > 1).length;
      check(same, `seed ${seed}: ${kind}: every block names the same site and builds the same each time`);
      check(inOwn && dup === 0 && empty === 0, `seed ${seed}: ${kind}: each chunk its own part (${bw * bd} chunks, ${(tris / 1000).toFixed(0)}k triangles, ${seen.size} containers, ${dup} twice)`);
      const missing = WANT[kind].filter((t) => !types.has(t));
      check(missing.length === 0, `seed ${seed}: ${kind}: has ${WANT[kind].join(', ')}${missing.length ? ` — missing ${missing.join(', ')}` : ''}`);
    }
  }
  console.log(fails.length ? `\ntest:bigpoi FAILED (${fails.length})` : '\ntest:bigpoi passed');
  return fails.length ? 1 : 0;
}
