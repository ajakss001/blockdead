import { mulberry32 } from '../core/random';

/*
 * The hundreds you don't see (Zomboid): beyond the zombies walking about near the player (ZombieSim), the
 * map holds groups — a point, a head count, where they drift. They cost nothing: no models, no thinking,
 * a few numbers each. They wander slowly; a loud noise (an alarm, a siren, hammering, a fight, running)
 * carries far further to them than to a single zombie, and every group that hears it turns towards it.
 * A group that comes near spills out into the real crowd — its zombies appear at the edge of the fog,
 * already walking where the group was going — and is gone from the map; new groups gather far away.
 */

export interface Horde {
  x: number;
  z: number;
  n: number;
  /** Where it drifts. */
  tx: number;
  tz: number;
  /** m/s: slow wandering, faster after a noise. */
  speed: number;
  /** Seconds until it picks a new place to wander to (a noise resets it). */
  timer: number;
  /** It heard something: its zombies come out looking. */
  drawn: boolean;
}

export const HORDE = {
  /** Groups kept round the player. */
  groups: 14,
  /** Where new ones gather, m from the player. */
  bornMin: 160,
  bornMax: 420,
  /** Further than this they are dropped (and gather again elsewhere). */
  forget: 700,
  /** Head count. */
  minN: 5,
  maxN: 18,
  wander: 0.35,
  drawn: 1.1,
  /** A noise reaches groups this many times further than single zombies. */
  carry: 5,
  /** Nearer than this a group spills into the crowd (beyond where zombies are spawned, inside the despawn). */
  spill: 80,
  /** A group (what is left of it) comes no nearer than this. */
  hold: 55,
} as const;

/** Where a group spills: a zombie appears here, walking to (tx, tz) (drawn: looking). */
export type SpillFn = (x: number, z: number, tx: number, tz: number, drawn: boolean) => boolean;

export class Hordes {
  readonly list: Horde[] = [];
  private readonly rnd: () => number;
  /** The last noise heard (debug). */
  lastNoise = { x: 0, z: 0, r: 0, t: -1 };
  private time = 0;

  constructor(seed: number) {
    this.rnd = mulberry32(seed ^ 0x40d3);
  }

  /** Zombies in all the groups (debug, the HUD line). */
  get total(): number {
    return this.list.reduce((n, h) => n + h.n, 0);
  }

  /** A noise at (x, z) single zombies hear within `radius`: groups hear it `carry` times further. */
  hear(x: number, z: number, radius: number): void {
    const R = radius * HORDE.carry;
    const r = this.rnd;
    this.lastNoise = { x, z, r: R, t: this.time };
    for (const h of this.list) {
      const d = Math.hypot(h.x - x, h.z - z);
      if (d > R) continue;
      const err = 6 + (d / R) * 20;
      h.tx = x + (r() - 0.5) * err;
      h.tz = z + (r() - 0.5) * err;
      h.speed = HORDE.drawn;
      h.timer = 90 + r() * 60;
      h.drawn = true;
    }
  }

  /**
   * One step: keep the groups round the player, move them, and spill those that came near. `room`: how
   * many zombies the crowd can still take (the quality preset's limit); a group spills only what fits and
   * waits with the rest.
   */
  update(dt: number, px: number, pz: number, room: number, spill: SpillFn): void {
    this.time += dt;
    const r = this.rnd;
    for (let i = this.list.length - 1; i >= 0; i--) if (Math.hypot(this.list[i].x - px, this.list[i].z - pz) > HORDE.forget) this.list.splice(i, 1);
    while (this.list.length < HORDE.groups) this.list.push(this.born(px, pz));
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      h.timer -= dt;
      const dx = h.tx - h.x;
      const dz = h.tz - h.z;
      const d = Math.hypot(dx, dz);
      // What is left of a group that has spilled waits out in the fog, never closer (nothing appears in view).
      const held = Math.hypot(h.x - px, h.z - pz) < HORDE.hold;
      if (d > 1 && !held) {
        const step = Math.min(d, h.speed * dt);
        h.x += (dx / d) * step;
        h.z += (dz / d) * step;
      }
      if (h.timer <= 0 || (d <= 1 && !h.drawn)) {
        // Somewhere else to drift to, not far.
        const a = r() * Math.PI * 2;
        const w = 40 + r() * 80;
        h.tx = h.x + Math.cos(a) * w;
        h.tz = h.z + Math.sin(a) * w;
        h.speed = HORDE.wander;
        h.timer = 60 + r() * 90;
        h.drawn = false;
      }
      if (Math.hypot(h.x - px, h.z - pz) > HORDE.spill || room <= 0) continue;
      // Near: out into the crowd, as many as fit, spread round the group's point.
      while (h.n > 0 && room > 0) {
        const a = r() * Math.PI * 2;
        const s = 2 + r() * 7;
        const x = h.x + Math.cos(a) * s;
        const z = h.z + Math.sin(a) * s;
        if (Math.hypot(x - px, z - pz) < HORDE.hold - 5) break;
        if (!spill(x, z, h.tx + (r() - 0.5) * 6, h.tz + (r() - 0.5) * 6, h.drawn)) break;
        h.n--;
        room--;
      }
      if (h.n <= 0) this.list.splice(i, 1);
    }
  }

  private born(px: number, pz: number): Horde {
    const r = this.rnd;
    const a = r() * Math.PI * 2;
    const d = HORDE.bornMin + r() * (HORDE.bornMax - HORDE.bornMin);
    const x = px + Math.cos(a) * d;
    const z = pz + Math.sin(a) * d;
    return { x, z, n: HORDE.minN + Math.floor(r() * (HORDE.maxN - HORDE.minN + 1)), tx: x, tz: z, speed: HORDE.wander, timer: r() * 30, drawn: false };
  }
}
