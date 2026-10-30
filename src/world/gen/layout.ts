import { createSimplex2D } from './noise';
import { type PoiSite, poiAt } from './poi';

/** Chunk = one city block, meters. Roads run along chunk edges. */
export const CHUNK = 64;
/** Half-width of the asphalt. */
export const ROAD_HALF = 3.6;
/** Sidewalk (urban) or grass shoulder (country) beyond the asphalt. */
export const VERGE = 2;
/** Half-width of the whole road corridor; nothing is built inside it. */
export const BAND = ROAD_HALF + VERGE;
/** Slab tops laid over flat ground by the generator, m. */
export const PAVE = { asphalt: 0.02, sidewalk: 0.06, plaza: 0.04 } as const;
/** Country roads keep the grid connected through forests and fields. */
const COUNTRY_EVERY = 4;

export type Zone = 'downtown' | 'town' | 'suburb' | 'forest' | 'field';

/** Blocks within this Chebyshev radius of the origin are the high-rise downtown. */
export const DOWNTOWN_RADIUS = 2;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The deterministic shape of the world: which block is town/suburb/forest/field, where roads run
 * and how high the ground is. Pure functions of the seed — shared by the chunk worker (to build)
 * and the main thread (to stand on the ground, to pick a spawn).
 */
export class WorldLayout {
  private readonly urbanNoise: (x: number, y: number) => number;
  private readonly wildNoise: (x: number, y: number) => number;
  private readonly hillNoise: (x: number, y: number) => number;
  private readonly zones = new Map<number, Zone>();
  private readonly pois = new Map<number, PoiSite | null>();

  constructor(readonly seed: number) {
    this.urbanNoise = createSimplex2D(seed);
    this.wildNoise = createSimplex2D(seed + 1);
    this.hillNoise = createSimplex2D(seed + 2);
  }

  zone(i: number, j: number): Zone {
    const key = (i + 32768) * 65536 + (j + 32768);
    const cached = this.zones.get(key);
    if (cached) return cached;
    // Urban density: noise plus a settlement around the origin, where the player starts.
    const u = this.urbanNoise(i * 0.23, j * 0.23) * 0.55 + 0.6 * Math.exp(-(i * i + j * j) / 10);
    let z: Zone;
    // The city: a high-rise downtown at the center, a ring of low town around it, suburbs, then wilds.
    if (Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS) z = 'downtown';
    else if (u > 0.48) z = 'town';
    else if (u > 0.12) z = 'suburb';
    else z = this.wildNoise(i * 0.4 + 31, j * 0.4) > -0.15 ? 'forest' : 'field';
    this.zones.set(key, z);
    return z;
  }

  /** The unique place on block (i, j), if any (see poi.ts). */
  poi(i: number, j: number): PoiSite | null {
    const key = (i + 32768) * 65536 + (j + 32768);
    let s = this.pois.get(key);
    if (s === undefined) {
      s = poiAt(this, i, j);
      this.pois.set(key, s);
    }
    return s;
  }

  isUrban(i: number, j: number): boolean {
    const z = this.zone(i, j);
    return z === 'downtown' || z === 'town' || z === 'suburb';
  }

  isDowntown(i: number, j: number): boolean {
    return this.zone(i, j) === 'downtown';
  }

  /** Road along the line x = i·CHUNK, for the stretch beside block row j. */
  roadX(i: number, j: number): boolean {
    return this.isUrban(i - 1, j) || this.isUrban(i, j) || i % COUNTRY_EVERY === 0;
  }

  /** Road along the line z = j·CHUNK, for the stretch beside block column i. */
  roadZ(i: number, j: number): boolean {
    return this.isUrban(i, j - 1) || this.isUrban(i, j) || j % COUNTRY_EVERY === 0;
  }

  /** Sidewalks where either side of the road is built up. */
  urbanX(i: number, j: number): boolean {
    return this.isUrban(i - 1, j) || this.isUrban(i, j);
  }

  urbanZ(i: number, j: number): boolean {
    return this.isUrban(i, j - 1) || this.isUrban(i, j);
  }

  /**
   * Top of what the player walks on outside buildings: asphalt (+2 cm), sidewalks and curbside
   * corners (+6 cm), the paved downtown blocks (+4 cm), the terrain everywhere else.
   * Mirrors the slabs laid by buildChunk.roads() / downtown().
   */
  walkHeightAt(x: number, z: number): number {
    const ground = this.heightAt(x, z);
    const li = Math.round(x / CHUNK);
    const lj = Math.round(z / CHUNK);
    const dx = Math.abs(x - li * CHUNK);
    const dz = Math.abs(z - lj * CHUNK);
    const bi = Math.floor(x / CHUNK);
    const bj = Math.floor(z / CHUNK);
    if (dx <= BAND && dz <= BAND) {
      // Intersection square around (li, lj).
      if (!(this.roadX(li, lj) || this.roadZ(li, lj) || this.roadX(li, lj - 1) || this.roadZ(li - 1, lj))) return ground;
      if (dx <= ROAD_HALF || dz <= ROAD_HALF) return PAVE.asphalt;
      const urban = this.isUrban(li, lj) || this.isUrban(li - 1, lj) || this.isUrban(li, lj - 1) || this.isUrban(li - 1, lj - 1);
      return urban ? PAVE.sidewalk : PAVE.asphalt;
    }
    if (dx <= BAND && this.roadX(li, bj)) return dx <= ROAD_HALF ? PAVE.asphalt : this.urbanX(li, bj) ? PAVE.sidewalk : ground;
    if (dz <= BAND && this.roadZ(bi, lj)) return dz <= ROAD_HALF ? PAVE.asphalt : this.urbanZ(bi, lj) ? PAVE.sidewalk : ground;
    return this.isDowntown(bi, bj) ? PAVE.plaza : ground;
  }

  /**
   * Ground height. Towns, POI lots and road corridors are flat (y = 0); forests and fields roll gently,
   * fading back to flat towards their block edges so every road stays level.
   */
  heightAt(x: number, z: number): number {
    const i = Math.floor(x / CHUNK);
    const j = Math.floor(z / CHUNK);
    if (this.isUrban(i, j) || this.poi(i, j)) return 0;
    const lx = x - i * CHUNK;
    const lz = z - j * CHUNK;
    const edge = Math.min(lx, CHUNK - lx, lz, CHUNK - lz);
    const w = smooth(BAND + 1, BAND + 14, edge);
    if (w === 0) return 0;
    const h = this.hillNoise(x * 0.018, z * 0.018) * 1.8 + this.hillNoise(x * 0.07 + 5, z * 0.07) * 0.35 + 0.6;
    return h * w;
  }
}
