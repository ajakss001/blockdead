import type { Scene, Vector3 } from 'three';
import { type LoopKind, sfx } from '../audio/Sound';
import { Foliage, type Ground } from '../render/Foliage';
import type { Particles } from '../render/Particles';
import { WetDecals } from '../render/WetDecals';
import type { Doors } from './Doors';
import { LIFE } from './gen/lifeKinds';
import { LIFE_STRIDE } from './WorldLife';

/** Leaks drip (seen and heard) within this distance, m; taps, loops, phones — their own. */
const DRIP_RANGE = 14;
const TAP_RANGE = 9;
const PHONE_RANGE = 26;
const LOOP_RANGE: Record<LoopKind, number> = { fridge: 7, tv: 12, flies: 9 };
/** Falling leaves: trees within this distance shed them, at most this many a second in all. */
const LEAF_RANGE = 18;
const LEAF_RATE = 4;

interface Leak {
  x: number;
  y: number;
  z: number;
  floor: number;
  r: number;
  base: number;
  next: number;
}

interface Phone {
  x: number;
  y: number;
  z: number;
  /** Seconds to the next call; rings left in this one. */
  next: number;
  rings: number;
}

interface Landing {
  t: number;
  x: number;
  y: number;
  z: number;
}

/**
 * The world's small life, outside and in: grass, weeds, ivy and fallen leaves (Foliage), leaves torn off by
 * the gusts, leaks dripping from ceilings into puddles you can step in (WetDecals, the particle pool), and
 * what you hear in the buildings — pipes, creaking floors, steps upstairs when nobody is there, a door a
 * draught swings shut, a dripping tap, a fridge or a TV still on, a phone ringing, flies. Spots come from
 * the generators (Builder.life) with the chunks and the streamed interiors; sounds go through the shared
 * 3D voices (Sound), loops through its few slots.
 */
export class Atmosphere {
  private readonly sets = new Map<number, Float32Array>();
  private dirty = false;
  readonly foliage: Foliage;
  private readonly wet: WetDecals;
  private trees: number[] = [];
  private leaks: Leak[] = [];
  private taps: { x: number; y: number; z: number; next: number }[] = [];
  private phones: Phone[] = [];
  private loopSpots: { key: number; kind: LoopKind; x: number; y: number; z: number }[] = [];
  private readonly landings: Landing[] = [];
  private time = 0;
  private leafDebt = 0;
  private pipeT = 15 + Math.random() * 20;
  private creakT = 8 + Math.random() * 12;
  private aboveT = 60 + Math.random() * 60;
  private draftT = 25 + Math.random() * 30;
  private readonly near: { key: number; kind: LoopKind; x: number; y: number; z: number; d: number }[] = [];

  constructor(
    scene: Scene,
    private readonly particles: Particles,
    private readonly doors: () => Doors | null,
    ground: (x: number, z: number) => Ground,
    private readonly groundY: (x: number, z: number) => number,
    /** Is there a storey over the player's head (a high-rise)? */
    private readonly upstairs: () => boolean,
  ) {
    this.foliage = new Foliage(scene, ground, groundY);
    this.wet = new WetDecals(scene);
  }

  /** Quality preset: grass reach, density, cap. */
  configure(radius: number, cell: number, cap: number): void {
    this.foliage.configure(radius, cell, cap);
  }

  add(key: number, spots: Float32Array): void {
    if (spots.length === 0 && !this.sets.has(key)) return;
    this.sets.set(key, spots);
    this.dirty = true;
  }

  remove(key: number): void {
    if (this.sets.delete(key)) this.dirty = true;
  }

  /** Standing in a puddle (feet at y). */
  puddleAt(x: number, z: number, y: number): boolean {
    for (const l of this.leaks) if (Math.abs(l.floor - y) < 0.4 && Math.hypot(l.x - x, l.z - z) < l.r) return true;
    return false;
  }

  /** A ring on the water where a foot came down. */
  ripple(x: number, y: number, z: number): void {
    for (const l of this.leaks) {
      if (Math.abs(l.floor - y) < 0.4 && Math.hypot(l.x - x, l.z - z) < l.r) {
        this.wet.addRipple(x, l.floor, z, 0.9);
        return;
      }
    }
  }

  update(dt: number, player: Vector3, indoors: boolean, windDir: number, gust: number): void {
    if (this.dirty) this.rebuild();
    this.time += dt;
    const px = player.x;
    const py = player.y;
    const pz = player.z;
    this.foliage.update(this.time, gust, px, pz);
    this.wet.update(dt);
    const wind = 0.3 + gust * 2.4;
    this.particles.windX = Math.cos(windDir) * wind;
    this.particles.windZ = Math.sin(windDir) * wind;

    // Leaves let go in the gusts.
    if (!indoors) {
      this.leafDebt += dt * LEAF_RATE * Math.max(0, gust - 0.35) * 1.6;
      while (this.leafDebt >= 1) {
        this.leafDebt -= 1;
        const near: number[] = [];
        for (let i = 0; i < this.trees.length; i += 5) if (!this.trees[i + 4] && Math.hypot(this.trees[i] - px, this.trees[i + 2] - pz) < LEAF_RANGE) near.push(i);
        if (near.length === 0) break;
        const i = near[Math.floor(Math.random() * near.length)];
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * this.trees[i + 3] * 0.8;
        const x = this.trees[i] + Math.cos(a) * r;
        const z = this.trees[i + 2] + Math.sin(a) * r;
        this.particles.leaf(x, this.trees[i + 1] + this.trees[i + 3] * 1.6, z, this.groundY(x, z));
      }
    }

    // Leaks: a drop at its own uneven rhythm; it lands, rings and splashes.
    for (const l of this.leaks) {
      if (Math.abs(l.y - py) > 4 || Math.hypot(l.x - px, l.z - pz) > DRIP_RANGE) continue;
      l.next -= dt;
      if (l.next > 0) continue;
      l.next = Math.random() < 0.15 ? 0.12 + Math.random() * 0.1 : l.base * (0.6 + Math.random() * 0.8);
      this.particles.drop(l.x, l.y - 0.02, l.z, l.floor);
      this.landings.push({ t: Math.sqrt((2 * (l.y - l.floor)) / 9.8), x: l.x, y: l.floor, z: l.z });
    }
    for (let i = this.landings.length - 1; i >= 0; i--) {
      const d = this.landings[i];
      d.t -= dt;
      if (d.t > 0) continue;
      this.wet.addRipple(d.x, d.y, d.z, 0.45);
      sfx.drip(d);
      this.landings.splice(i, 1);
    }
    // Taps.
    for (const t of this.taps) {
      if (Math.abs(t.y - py - 1) > 2 || Math.hypot(t.x - px, t.z - pz) > TAP_RANGE) continue;
      t.next -= dt;
      if (t.next > 0) continue;
      t.next = 1.4 + Math.random() * 2.1;
      sfx.drip(t, true);
    }
    // Phones: now and then a call, a few rings, then quiet again.
    for (const ph of this.phones) {
      if (Math.hypot(ph.x - px, ph.z - pz) > PHONE_RANGE) continue;
      ph.next -= dt;
      if (ph.next > 0) continue;
      if (ph.rings <= 0) ph.rings = 4 + Math.floor(Math.random() * 6);
      sfx.phoneRing(ph);
      ph.rings--;
      ph.next = ph.rings > 0 ? 4 : 60 + Math.random() * 120;
    }
    // Continuous sounds: the nearest few on this storey.
    this.near.length = 0;
    for (const s of this.loopSpots) {
      const d = Math.hypot(s.x - px, s.z - pz);
      if (d < LOOP_RANGE[s.kind] && Math.abs(s.y - py - 1) < 2.2) this.near.push({ ...s, d });
    }
    this.near.sort((a, b) => a.d - b.d);
    sfx.loops(this.near);

    // The building's own noises, only inside.
    if (!indoors) return;
    const around = (r0: number, r1: number, dy: number) => {
      const a = Math.random() * Math.PI * 2;
      const r = r0 + Math.random() * (r1 - r0);
      return { x: px + Math.cos(a) * r, y: py + dy, z: pz + Math.sin(a) * r };
    };
    this.pipeT -= dt;
    if (this.pipeT <= 0) {
      this.pipeT = 20 + Math.random() * 30;
      sfx.house('pipe', around(3, 7, Math.random() < 0.5 ? 2.4 : 1.1));
    }
    this.creakT -= dt;
    if (this.creakT <= 0) {
      this.creakT = 12 + Math.random() * 18;
      sfx.house('creak', around(2, 6, Math.random() < 0.6 ? 0.1 : 2.6));
    }
    this.aboveT -= dt;
    if (this.aboveT <= 0) {
      this.aboveT = 70 + Math.random() * 90;
      if (this.upstairs()) sfx.house('above', around(1.5, 5, 3.4));
    }
    this.draftT -= dt;
    if (this.draftT <= 0) {
      this.draftT = 35 + Math.random() * 55;
      const at = this.doors()?.draftClose(px, py, pz, 3, 12);
      if (at) sfx.draftDoor(at, at.dur, at.creaky, at.pitch);
    }
  }

  private rebuild(): void {
    this.dirty = false;
    const trees: number[] = [];
    const cars: number[] = [];
    const ivy: number[] = [];
    const leaks: number[] = [];
    const oldLeaks = this.leaks;
    this.leaks = [];
    this.taps = [];
    const oldPhones = this.phones;
    this.phones = [];
    this.loopSpots = [];
    for (const spots of this.sets.values()) {
      for (let i = 0; i + LIFE_STRIDE <= spots.length; i += LIFE_STRIDE) {
        const kind = spots[i];
        const x = spots[i + 1];
        const y = spots[i + 2];
        const z = spots[i + 3];
        const seed = spots[i + 8];
        switch (kind) {
          case LIFE.tree:
            trees.push(x, y, z, spots[i + 6], spots[i + 9]);
            break;
          case LIFE.car:
            cars.push(x, z, spots[i + 4], spots[i + 5]);
            break;
          case LIFE.ivy:
            ivy.push(x, y, z, spots[i + 4], spots[i + 5], spots[i + 6], spots[i + 7], seed);
            break;
          case LIFE.drip: {
            const floor = y - spots[i + 7];
            leaks.push(x, y, z, floor, seed);
            const kept = oldLeaks.find((l) => l.x === x && l.y === y && l.z === z);
            this.leaks.push(kept ?? { x, y, z, floor, r: ((0.7 + seed * 0.8) / 2) * 0.85, base: 0.8 + seed * 2.2, next: Math.random() * 2 });
            break;
          }
          case LIFE.tap:
            this.taps.push({ x, y, z, next: Math.random() * 3 });
            break;
          case LIFE.phone:
            this.phones.push(oldPhones.find((p) => p.x === x && p.y === y && p.z === z) ?? { x, y, z, next: 20 + seed * 90, rings: 0 });
            break;
          case LIFE.tv:
          case LIFE.fridge:
          case LIFE.flies:
            this.loopSpots.push({ key: Math.round(x * 8) * 92821 + Math.round(y * 8) * 68917 + Math.round(z * 8) * 31, kind: kind === LIFE.tv ? 'tv' : kind === LIFE.fridge ? 'fridge' : 'flies', x, y, z });
            break;
        }
      }
    }
    this.trees = trees;
    this.foliage.setSources({ trees, cars, ivy });
    this.wet.setLeaks(leaks);
  }

  /** Programs compile during the loading-screen prewarm. */
  prewarm(): () => void {
    this.foliage.mesh.count = Math.max(1, this.foliage.mesh.count);
    this.wet.mesh.count = Math.max(1, this.wet.mesh.count);
    return () => {
      this.dirty = true;
    };
  }

  dispose(): void {
    sfx.loops([]);
    this.foliage.dispose();
    this.wet.dispose();
  }
}
