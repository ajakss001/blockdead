import { createSimplex2D } from './noise';

/** Chunk = one city block, meters. Roads run along chunk edges. */
export const CHUNK = 64;
/** Half-width of the asphalt. */
export const ROAD_HALF = 3.6;
/** Sidewalk (urban) or grass shoulder (country) beyond the asphalt. */
export const VERGE = 2;
/** Half-width of the whole road corridor; nothing is built inside it. */
export const BAND = ROAD_HALF + VERGE;
/** Country roads keep the grid connected through forests and fields. */
const COUNTRY_EVERY = 4;

export type Zone = 'town' | 'suburb' | 'forest' | 'field';

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
    if (i === 0 && j === 0) z = 'suburb';
    else if (u > 0.58) z = 'town';
    else if (u > 0.12) z = 'suburb';
    else z = this.wildNoise(i * 0.4 + 31, j * 0.4) > -0.15 ? 'forest' : 'field';
    this.zones.set(key, z);
    return z;
  }

  isUrban(i: number, j: number): boolean {
    const z = this.zone(i, j);
    return z === 'town' || z === 'suburb';
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
   * Ground height. Towns and road corridors are flat (y = 0); forests and fields roll gently,
   * fading back to flat towards their block edges so every road stays level.
   */
  heightAt(x: number, z: number): number {
    const i = Math.floor(x / CHUNK);
    const j = Math.floor(z / CHUNK);
    if (this.isUrban(i, j)) return 0;
    const lx = x - i * CHUNK;
    const lz = z - j * CHUNK;
    const edge = Math.min(lx, CHUNK - lx, lz, CHUNK - lz);
    const w = smooth(BAND + 1, BAND + 14, edge);
    if (w === 0) return 0;
    const h = this.hillNoise(x * 0.018, z * 0.018) * 1.8 + this.hillNoise(x * 0.07 + 5, z * 0.07) * 0.35 + 0.6;
    return h * w;
  }
}
