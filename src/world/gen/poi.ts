import { CHUNK, DOWNTOWN_RADIUS, type WorldLayout, type Zone } from './layout';
import { hash3 } from './noise';

/**
 * Rare unique places (POI) — every type in one table. A new type = a template (poiBuild.ts) + a line here.
 * - `chance`: how likely a placement cell gets one (rarity);
 * - `size`: blocks (chunks) it takes — 1×1 for now;
 * - `minDist`: blocks to the nearest place of the same type, at least;
 * - `zones`: where it may stand; `road`: 'any' — a road on some side of the block, 'major' — a through road
 *   (the country grid, every 4th line: the way out of town);
 * - `risk`: zombies waiting round it and inside (the better the loot, the more of them);
 * - `downtown`: at least one in the high-rise district, always;
 * - `near`: 'urban' — only right at the edge of town (a block next to a built-up one);
 * - `id`: its own salt for the placement hash — fixed forever, so adding types never moves the old ones.
 */
export const POI = {
  gas: { id: 2, name: 'Заправка', chance: 0.8, size: 1, minDist: 5, zones: ['suburb', 'forest', 'field'] as Zone[], road: 'major', risk: 4, downtown: false, near: null },
  police: { id: 1, name: 'Полицейский участок', chance: 0.5, size: 1, minDist: 6, zones: ['town'] as Zone[], road: 'any', risk: 9, downtown: true, near: null },
  hyper: { id: 4, name: 'Гипермаркет ValuMart', chance: 0.6, size: 1, minDist: 12, zones: ['town', 'suburb'] as Zone[], road: 'any', risk: 14, downtown: false, near: null },
  mall: { id: 3, name: 'Торговый центр MegaPlaza', chance: 0.55, size: 1, minDist: 16, zones: ['town', 'suburb'] as Zone[], road: 'any', risk: 16, downtown: false, near: null },
  plant: { id: 5, name: 'Водоочистная станция', chance: 0.5, size: 1, minDist: 18, zones: ['field', 'forest'] as Zone[], road: 'any', risk: 6, downtown: false, near: null },
  park: { id: 7, name: 'Сквер', chance: 0.5, size: 1, minDist: 5, zones: ['town', 'suburb'] as Zone[], road: 'any', risk: 2, downtown: true, near: null },
  checkpoint: { id: 6, name: 'Военный КПП', chance: 0.55, size: 1, minDist: 10, zones: ['field', 'forest'] as Zone[], road: 'major', risk: 5, downtown: false, near: 'urban' },
} as const;

export type PoiKind = keyof typeof POI;
/** Placement order: earlier types win a contested block. */
const ORDER: PoiKind[] = ['police', 'mall', 'hyper', 'plant', 'checkpoint', 'gas', 'park'];
/** The country road grid runs along every 4th chunk line (see layout). */
const MAJOR_EVERY = 4;

export interface PoiSite {
  kind: PoiKind;
  i: number;
  j: number;
  /** Quarter turn of the site's frame: local +Z points at the road it faces (0 +Z, 1 +X, 2 −Z, 3 −X). */
  r: 0 | 1 | 2 | 3;
}

/**
 * Which POI (if any) is on block (i, j). Deterministic from the seed: each type tiles the world with
 * cells of 2·minDist blocks; a cell rolls once for a site, placed inside the cell's inner part so two
 * sites of one type are never closer than minDist. The downtown guarantee picks one block on its rim.
 */
export function poiAt(layout: WorldLayout, i: number, j: number): PoiSite | null {
  for (const kind of ORDER) {
    const site = siteOf(layout, kind, i, j);
    if (site) return site;
  }
  return null;
}

function siteOf(layout: WorldLayout, kind: PoiKind, i: number, j: number): PoiSite | null {
  const def = POI[kind];
  const k = def.id;
  const rank = ORDER.indexOf(kind);
  const zone = layout.zone(i, j);
  // Downtown: exactly the guaranteed one (on the district's rim, never the start block).
  if (zone === 'downtown') {
    if (!def.downtown) return null;
    const rim = downtownRim();
    const [gi, gj] = rim[hash3(layout.seed, 9001, k) % rim.length];
    return gi === i && gj === j ? face(layout, kind, i, j, 'any') : null;
  }
  const C = def.minDist * 2;
  const off = hash3(layout.seed, 7001, k) % C;
  const ci = Math.floor((i + off) / C);
  const cj = Math.floor((j + off) / C);
  const h = hash3(layout.seed ^ (k * 0x9e3779b1), ci, cj);
  if ((h % 1000) / 1000 >= def.chance) return null;
  // A few tries for a block that fits (zone, road); the first one that does is the site.
  const m = Math.ceil(def.minDist / 2);
  const span = C - 2 * m;
  for (let t = 0; t < (def.near ? 10 : 4); t++) {
    const ht = hash3(h, t, 77);
    const si = ci * C - off + m + (ht % span);
    const sj = cj * C - off + m + (Math.floor(ht / span) % span);
    const z = layout.zone(si, sj);
    if (!(def.zones as readonly Zone[]).includes(z)) continue;
    if (def.near === 'urban' && !nearUrban(layout, si, sj)) continue;
    const site = face(layout, kind, si, sj, def.road);
    if (!site) continue;
    // A higher-priority type already took it.
    if (ORDER.slice(0, rank).some((o) => siteOf(layout, o, si, sj))) continue;
    return si === i && sj === j ? site : null;
  }
  return null;
}

/** The side the site faces: a road on that edge of the block (a major one if asked), or null. */
function face(layout: WorldLayout, kind: PoiKind, i: number, j: number, road: 'any' | 'major'): PoiSite | null {
  const edges: [boolean, number, 0 | 1 | 2 | 3][] = [
    [layout.roadZ(i, j), j, 2],
    [layout.roadX(i + 1, j), i + 1, 1],
    [layout.roadZ(i, j + 1), j + 1, 0],
    [layout.roadX(i, j), i, 3],
  ];
  const ok = edges.filter(([has, line]) => has && (road === 'any' || line % MAJOR_EVERY === 0));
  if (ok.length === 0) return null;
  return { kind, i, j, r: ok[hash3(i, j, 31) % ok.length][2] };
}

/** A block next to a built-up one (the edge of town). */
function nearUrban(layout: WorldLayout, i: number, j: number): boolean {
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if ((di || dj) && layout.isUrban(i + di, j + dj)) return true;
  return false;
}

let rim: [number, number][] | null = null;
function downtownRim(): [number, number][] {
  if (!rim) {
    rim = [];
    const R = DOWNTOWN_RADIUS;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) if (Math.max(Math.abs(i), Math.abs(j)) === R) rim.push([i, j]);
  }
  return rim;
}

/** The nearest site of a type to block (i0, j0), searching rings out to `maxR` blocks. */
export function nearestPoi(layout: WorldLayout, kind: PoiKind, i0: number, j0: number, maxR = 40): PoiSite | null {
  for (let r = 0; r <= maxR; r++) {
    for (let i = i0 - r; i <= i0 + r; i++) {
      for (let j = j0 - r; j <= j0 + r; j++) {
        if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r) continue;
        const s = layout.poi(i, j);
        if (s && s.kind === kind) return s;
      }
    }
  }
  return null;
}

/** Local (site frame) → world: the block's centre, turned by r quarters. */
export function siteToWorld(s: PoiSite, lx: number, lz: number): [number, number] {
  const x = s.i * CHUNK + CHUNK / 2;
  const z = s.j * CHUNK + CHUNK / 2;
  switch (s.r) {
    case 0:
      return [x + lx, z + lz];
    case 1:
      return [x + lz, z - lx];
    case 2:
      return [x - lx, z - lz];
    default:
      return [x - lz, z + lx];
  }
}

/**
 * Where a site's zombies wait (local frame): outside on the lot and inside the buildings. More for richer
 * places (POI.risk); the scene spawns them when the player comes near.
 */
export function poiSpawnPoints(kind: PoiKind): { outside: [number, number][]; inside: [number, number][] } {
  const grid = (x0: number, x1: number, z0: number, z1: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, k) => [x0 + ((k * 0.618) % 1) * (x1 - x0), z0 + ((k * 0.382 + 0.5) % 1) * (z1 - z0)]);
  if (kind === 'hyper') return { outside: grid(-20, 20, 14, 24, 5), inside: [...grid(-21, 21, -11, 5.5, 12), ...grid(-20, 10, -20, -14, 4)] };
  if (kind === 'mall') return { outside: grid(-20, 20, 13, 24, 5), inside: [...grid(-7, 7, -9, 1, 5), ...grid(-22, -13, -20, 8, 4), ...grid(10, 20, -16, 4, 5)] };
  if (kind === 'plant') return { outside: grid(-20, 20, -2, 20, 4), inside: [[8, 9], [15, 4], [-14, 8]] };
  if (kind === 'park') return { outside: [[-12, 12], [10, -14]], inside: [] };
  if (kind === 'checkpoint') return { outside: [[-10, 24], [4, 26], [-2, 10], [10, 14], [-16, 12]], inside: [[-14, 6], [-6, 6], [4, -4]] };
  if (kind === 'gas')
    return {
      outside: [
        [-5, 14],
        [5, 9],
        [12, 4],
        [-16, 6],
      ],
      inside: [
        [-6, -9],
        [-11, -5],
        [9, -13],
      ],
    };
  return {
    outside: [
      [-10, 14],
      [4, 17],
      [18, 6],
    ],
    inside: [
      [-2, 3],
      [-15, 1],
      [7, 1],
      [-16, -4],
      [0, -4],
      [-20, -12],
      [-14, -14],
      [-3, -12],
      [6, -12],
      [19, -10],
    ],
  };
}

/**
 * Landmarks: the shapes of a place you see from far away, over the roofs and through the haze (local frame,
 * boxes: x, y bottom, z, w, h, d). Drawn as distant silhouettes when the place itself is out of sight.
 */
export const POI_LANDMARKS: Partial<Record<PoiKind, [number, number, number, number, number, number][]>> = {
  hyper: [
    [20, 0, 23, 0.6, 16, 0.6],
    [20, 14.5, 23, 9, 3.2, 0.5],
    [0, 0, -6, 48, 7, 36],
  ],
  mall: [
    [-21, 0, 22, 2.4, 18, 2.4],
    [-21, 18, 22, 5.4, 2.6, 2.6],
    [0, 0, -6, 48, 10, 32],
  ],
  plant: [
    [-19, 0, -19, 4.8, 18, 0.4],
    [-19, 18, -19, 7.2, 5, 7.2],
    [-19, 23, -19, 4, 1.4, 4],
  ],
  checkpoint: [
    [12, 0, 20, 3, 5.5, 3],
    [12, 5.5, 20, 3.4, 2.2, 3.4],
  ],
};
