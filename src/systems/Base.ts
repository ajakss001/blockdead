/*
 * The survivor's base: what they built and set down (Crafting) — a fire, a rain collector, a chest, a
 * tripwire with cans. A few numbers each, saved with the game; the scene draws them (world/BaseProps), feeds
 * the fire to the world's flames and sound, and asks here how warm it is and what a zombie just walked into.
 * Time here is game minutes (the clock), not real seconds.
 */

export type PlacedKind = 'fire' | 'barrel' | 'stash' | 'trap';

export interface Placed {
  id: number;
  kind: PlacedKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Fire: game minutes of burning left (0: ashes). */
  fuel: number;
  /** Rain collector: portions of water in it. */
  water: number;
  /** Tripwire: set (rings once, then has to be set again). */
  armed: boolean;
}

export const BASE = {
  /** A new fire burns this long, game minutes; a plank adds `plank`. */
  fire: 240,
  plank: 180,
  /** Felt °C next to a fire, fading to nothing at `warmReach` m. */
  warm: 16,
  warmReach: 4.5,
  /** A fire lights the dark this far, m (no fear in its light). */
  lightReach: 5,
  /** Rain collector: holds this many portions; fills this many per game minute in full rain. */
  barrelMax: 12,
  rainFill: 0.025,
  /** A zombie this near a set tripwire rings it, m; the noise carries this far. */
  trapReach: 1.4,
  trapNoise: 38,
  /** Stash container ids start here (clear of the chunks' and the bodies'). */
  stashIds: 1_900_000_000,
} as const;

export const PLACED_NAME: Record<PlacedKind, string> = {
  fire: 'Костёр',
  barrel: 'Сборник дождевой воды',
  stash: 'Сундук',
  trap: 'Растяжка с банками',
};

export class Base {
  readonly list: Placed[] = [];
  /** Bumped on every change the drawing or the world's flames follow. */
  version = 0;
  private nextId = 1;

  add(kind: PlacedKind, x: number, y: number, z: number, yaw: number): Placed {
    const p: Placed = { id: this.nextId++, kind, x, y, z, yaw, fuel: kind === 'fire' ? BASE.fire : 0, water: 0, armed: kind === 'trap' };
    this.list.push(p);
    this.version++;
    return p;
  }

  remove(p: Placed): void {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.version++;
  }

  /** The nearest thing within `r` m (same floor), of a kind if given. */
  near(x: number, y: number, z: number, r: number, kind?: PlacedKind): Placed | null {
    let best: Placed | null = null;
    let bd = r;
    for (const p of this.list) {
      if ((kind && p.kind !== kind) || Math.abs(p.y - y) > 1.8) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** A burning fire within `r` m. */
  fireNear(x: number, y: number, z: number, r: number): Placed | null {
    let best: Placed | null = null;
    for (const p of this.list) if (p.kind === 'fire' && p.fuel > 0 && Math.abs(p.y - y) < 1.8 && Math.hypot(p.x - x, p.z - z) < r) best = p;
    return best;
  }

  /** Felt °C the fires add at a point. */
  warmth(x: number, y: number, z: number): number {
    let w = 0;
    for (const p of this.list) {
      if (p.kind !== 'fire' || p.fuel <= 0 || Math.abs(p.y - y) > 1.8) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < BASE.warmReach) w = Math.max(w, BASE.warm * (1 - d / BASE.warmReach));
    }
    return w;
  }

  /**
   * `minutes` of game time: fires burn down, collectors under the sky fill with the rain, zombies walking into
   * a set tripwire ring it (`ring` gets the trap: the scene makes the noise).
   */
  update(minutes: number, rain: number, sky: (x: number, z: number) => boolean, zombies: readonly { x: number; z: number }[], ring: (p: Placed) => void): void {
    for (const p of this.list) {
      if (p.kind === 'fire' && p.fuel > 0) {
        p.fuel = Math.max(0, p.fuel - minutes);
        if (p.fuel === 0) this.version++;
      } else if (p.kind === 'barrel' && rain > 0.05 && sky(p.x, p.z)) {
        p.water = Math.min(BASE.barrelMax, p.water + BASE.rainFill * rain * minutes);
      } else if (p.kind === 'trap' && p.armed) {
        for (const z of zombies) {
          if (Math.hypot(z.x - p.x, z.z - p.z) > BASE.trapReach) continue;
          p.armed = false;
          this.version++;
          ring(p);
          break;
        }
      }
    }
  }

  serialize(): Placed[] {
    return this.list.map((p) => ({ ...p }));
  }

  restore(list: Placed[] | undefined): void {
    this.list.length = 0;
    for (const p of list ?? []) if (PLACED_NAME[p.kind]) this.list.push({ ...p });
    this.nextId = this.list.reduce((m, p) => Math.max(m, p.id + 1), 1);
    this.version++;
  }
}
