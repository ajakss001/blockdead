import type { ZombieSim } from '../systems/zombies';
import { CHUNK, type WorldLayout } from './gen/layout';
import { POI, type PoiSite, poiSpawnPoints, siteToWorld } from './gen/poi';
import { pickScenarios } from './gen/scenarios';

/** The site's zombies turn up when you come this close (m), and again after you have been this far away. */
const WAKE = 70;
const RESET = 170;

/**
 * The scene's side of the unique places: as the player nears one, its zombies are there waiting — round the
 * lot and inside — as many as the place is worth (POI.risk). They come back after the player has been far
 * away for a while (the dead are not counted twice: it is a new crowd drawn by the place).
 */
export class Pois {
  private readonly woken = new Set<number>();
  private t = 0;

  constructor(
    private readonly layout: WorldLayout,
    private readonly zombies: ZombieSim,
  ) {}

  update(dt: number, x: number, z: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    const ci = Math.floor(x / CHUNK);
    const cj = Math.floor(z / CHUNK);
    for (let i = ci - 3; i <= ci + 3; i++) {
      for (let j = cj - 3; j <= cj + 3; j++) {
        const s = this.layout.poi(i, j);
        if (!s) continue;
        // A big place: once, by its own corner block and its middle.
        if (s.i !== i || s.j !== j) continue;
        const key = (i + 32768) * 65536 + (j + 32768);
        const [mx, mz] = siteToWorld(s, 0, 0);
        const d = Math.hypot(mx - x, mz - z);
        if (this.woken.has(key)) {
          if (d > RESET) this.woken.delete(key);
        } else if (d < WAKE + ((Math.max(s.bw ?? 1, s.bd ?? 1) - 1) * CHUNK) / 2) {
          this.woken.add(key);
          this.wake(s);
        }
      }
    }
    for (const key of this.woken) {
      const i = Math.floor(key / 65536) - 32768;
      const j = (key % 65536) - 32768;
      const s = this.layout.poi(i, j);
      const [mx, mz] = s ? siteToWorld(s, 0, 0) : [(i + 0.5) * CHUNK, (j + 0.5) * CHUNK];
      if (Math.hypot(mx - x, mz - z) > RESET) this.woken.delete(key);
    }
  }

  /** The place's crowd: two thirds inside, the rest about the lot. */
  private wake(s: PoiSite): void {
    const n = POI[s.kind].risk;
    const pts = poiSpawnPoints(s.kind);
    const inside = Math.ceil(n * 0.66);
    // The crew scenario: pilots in white shirts, flight attendants in navy and burgundy.
    const crew = s.kind === 'airport' && pickScenarios(this.layout.seed, s).some((p) => p.def.id === 'crew');
    for (let k = 0; k < n; k++) {
      const list = k < inside ? pts.inside : pts.outside;
      const [lx, lz] = list[k % list.length];
      const [wx, wz] = siteToWorld(s, lx + (Math.random() - 0.5) * 1.2, lz + (Math.random() - 0.5) * 1.2);
      const z = this.zombies.spawnAt(wx, wz, Math.random() < 0.3 ? 'wander' : 'idle');
      // Soldiers at the base (most of them), staff at the airport (some).
      if (s.kind === 'base' && Math.random() < 0.85) z.uniform = { shirt: Math.random() < 0.5 ? 0x4a5236 : 0x5a5a3e, pants: 0x4a4e36, loot: 'bodyMilitary' };
      else if (s.kind === 'airport' && Math.random() < (crew ? 0.85 : 0.4)) {
        const r = Math.random();
        z.uniform = r < 0.35 ? { shirt: 0xe0e0da, pants: 0x1e2434, loot: 'bodyZombie' } : r < 0.7 ? { shirt: 0x2a3248, pants: 0x23252a, loot: 'bodyZombie' } : { shirt: 0x6a2030, pants: 0x2a2428, loot: 'bodyZombie' };
      }
    }
  }
}
