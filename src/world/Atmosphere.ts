import { type Camera, type Color, Matrix4, type Scene, type Vector3 } from 'three';
import { LOUD_LOOPS, type LoopKind, sfx } from '../audio/Sound';
import { Foliage, Ground } from '../render/Foliage';
import type { Particles } from '../render/Particles';
import { WetDecals } from '../render/WetDecals';
import { ATMO } from './atmoConfig';
import type { CollisionWorld } from './CollisionWorld';
import type { Doors } from './Doors';
import { LEAFY, LIFE, spotHash } from './gen/lifeKinds';
import { type Plant, Vegetation } from '../render/Vegetation';
import type { Species } from '../render/vegetation/models';
import { Street } from './Street';
import { LIFE_STRIDE } from './WorldLife';

/** Tree spot tag → species (lifeKinds TREE). */
const TREE_SPECIES: Species[] = ['maple', 'oak', 'elm', 'spruce', 'pine', 'dead'];
const _ident = new Matrix4();

/** Leaks drip (seen and heard) within this distance, m; taps, loops, phones — their own. */
const DRIP_RANGE = 14;
const TAP_RANGE = 9;
const PHONE_RANGE = 26;
const LOOP_RANGE: Record<LoopKind, number> = { fridge: 7, tv: 12, flies: 9, fire: 16, hiss: 14, rainTin: 6, siren: 90, speaker: 60, bell: 55, music: 35, sparks: 10 };
/** Falling leaves: trees within this distance shed them, at most this many a second in all. */
const LEAF_RANGE = 18;
const LEAF_RATE = 4;
/** Rain puddles: on paving within this distance, one chance per cell (m). */
const PUDDLE_RANGE = 22;
const PUDDLE_CELL = 3;
/** Moth groups: the nearest lamps, and one for the flashlight's beam. */
const LAMP_MOTHS = 3;
const BEAM_GROUP = 3;

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

/** What the atmosphere needs to know about the player and the hour this frame. */
export interface AtmoFrame {
  /** Camera position and look direction. */
  eye: Vector3;
  look: Vector3;
  flashlight: boolean;
  /** 0 night … 1 day. */
  daylight: number;
  /** Felt temperature, °C. */
  felt: number;
  speed: number;
  sprinting: boolean;
  crouched: boolean;
  /** In town (rats, rattles, a cart). */
  urban: boolean;
  rain: number;
  /** For the trees: the camera, the sun (direction to it, colour × strength), the fog's reach. */
  camera: Camera;
  sunDir: Vector3;
  sunColor: Color;
  fogFar: number;
}

/**
 * The world's small life, outside and in: grass, weeds, ivy and fallen leaves (Foliage), leaves torn off by
 * the gusts, leaks dripping from ceilings into puddles you can step in (WetDecals, the particle pool), and
 * what you hear in the buildings — pipes, creaking floors, steps upstairs when nobody is there, a door a
 * draught swings shut, a dripping tap, a fridge or a TV still on, a phone ringing, flies. The street (crows,
 * alarms, rats, a cart, fires, hydrants) is Street's. At night: moths round the lamps and the beam, dust
 * in the beam indoors, your breath in the cold. In the rain: puddles on the paving, rain drumming on cars.
 * Spots come from the generators (Builder.life) with the chunks and the streamed interiors; sounds go
 * through the shared 3D voices (Sound), loops through its few slots. Rates: atmoConfig.
 */
export class Atmosphere {
  private readonly sets = new Map<number, Float32Array>();
  private dirty = false;
  readonly foliage: Foliage;
  readonly street: Street;
  readonly vegetation: Vegetation;
  private readonly wet: WetDecals;
  private trees: number[] = [];
  private cars: number[] = [];
  private lamps: number[] = [];
  private leaks: Leak[] = [];
  private leakList: number[] = [];
  /** Puddles that are not under a leak: [x, y, z, size, strength]… (hydrants; rain ones are added). */
  private pools: number[] = [];
  private rainPools: number[] = [];
  private wetness = 0;
  private poolsAt = { x: 1e9, z: 1e9, wet: -1 };
  private taps: { x: number; y: number; z: number; next: number }[] = [];
  private phones: Phone[] = [];
  private loopSpots: { key: number; kind: LoopKind; x: number; y: number; z: number }[] = [];
  private readonly landings: Landing[] = [];
  private time = 0;
  private leafDebt = 0;
  private mothT = 0;
  /** The beam moths' centre, lagging behind the beam. */
  private readonly beamAt = [0, -1000, 0];
  private moteDebt = 0;
  private breathT = 1;
  private pipeT = 15 + Math.random() * 20;
  private creakT = 8 + Math.random() * 12;
  private aboveT = 60 + Math.random() * 60;
  private draftT = 25 + Math.random() * 30;
  private loopT = 0;
  private readonly nearPool: { key: number; kind: LoopKind; x: number; y: number; z: number; d: number }[] = [];
  private readonly near: { key: number; kind: LoopKind; x: number; y: number; z: number; d: number }[] = [];

  constructor(
    scene: Scene,
    private readonly particles: Particles,
    private readonly doors: () => Doors | null,
    private readonly ground: (x: number, z: number) => Ground,
    private readonly groundY: (x: number, z: number) => number,
    /** Is there a storey over the player's head (a high-rise)? */
    private readonly upstairs: () => boolean,
    world: CollisionWorld,
    /** A noise in the world zombies may hear. */
    noise: (x: number, y: number, z: number, radius: number) => void,
    foliageCap = 7000,
    vegAniso = 4,
  ) {
    this.foliage = new Foliage(scene, ground, groundY, foliageCap);
    this.wet = new WetDecals(scene);
    this.street = new Street(scene, particles, world, noise, groundY);
    this.vegetation = new Vegetation(scene, vegAniso);
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

  /** Standing in a puddle (feet at y): under a leak, by a hydrant, in the rain. */
  puddleAt(x: number, z: number, y: number): boolean {
    return this.puddle(x, z, y) !== null;
  }

  private puddle(x: number, z: number, y: number): number | null {
    for (const l of this.leaks) if (Math.abs(l.floor - y) < 0.4 && Math.hypot(l.x - x, l.z - z) < l.r) return l.floor;
    for (const list of [this.pools, this.rainPools]) {
      for (let i = 0; i + 4 < list.length; i += 5) {
        if (list[i + 4] > 0.3 && Math.abs(list[i + 1] - y) < 0.4 && Math.hypot(list[i] - x, list[i + 2] - z) < list[i + 3] * 0.4) return list[i + 1];
      }
    }
    return null;
  }

  /** A ring on the water where a foot came down. */
  ripple(x: number, y: number, z: number): void {
    const at = this.puddle(x, z, y);
    if (at !== null) this.wet.addRipple(x, at, z, 0.9);
  }

  /** Fire or a live cable close to (x, y, z), if any. */
  hazard(x: number, y: number, z: number): ReturnType<Street['hazard']> {
    return this.street.hazard(x, y, z);
  }

  /** Cars near a point (Street). */
  carsNear(x: number, z: number, r: number): { x: number; z: number }[] {
    return this.street.carsNear(x, z, r);
  }

  /** A blow / a bullet on a car: its alarm. */
  carHit(x: number, y: number, z: number): void {
    this.street.strikeAt(x, y, z);
  }

  /** The city's power and water (systems/Utilities): fridges, TVs, phones; taps and broken hydrants. */
  setUtilities(power: boolean, water: boolean): void {
    if (power === this.power && water === this.water) return;
    this.power = power;
    this.water = water;
    this.dirty = true;
  }

  private power = true;
  private water = true;

  /** The kitchen tap in reach in front of the eye (within 1.5 m, roughly where you look), or null. */
  tapNear(eye: Vector3, dir: Vector3): { x: number; y: number; z: number } | null {
    return this.spotNear(this.tapSpots, eye, dir, 1.5);
  }

  /** A bed in reach in front of the eye (within 2.2 m), or null. */
  bedNear(eye: Vector3, dir: Vector3): { x: number; y: number; z: number } | null {
    return this.spotNear(this.bedSpots, eye, dir, 2.2);
  }

  private spotNear(list: readonly { x: number; y: number; z: number }[], eye: Vector3, dir: Vector3, reach: number): { x: number; y: number; z: number } | null {
    if (this.dirty) this.rebuild();
    let best: { x: number; y: number; z: number } | null = null;
    let bd = reach;
    for (const t of list) {
      const dx = t.x - eye.x;
      const dy = t.y - eye.y;
      const dz = t.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < bd && (dx * dir.x + dy * dir.y + dz * dir.z) / Math.max(d, 1e-3) > 0.6) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** Every tap here, running or dry (the dripping ones are `taps`). */
  private tapSpots: { x: number; y: number; z: number }[] = [];
  private bedSpots: { x: number; y: number; z: number }[] = [];

  /** A blow landed on the world at (x, y, z) (a car's alarm may go off). */
  strikeAt(x: number, y: number, z: number): void {
    this.street.strikeAt(x, y, z);
  }

  update(dt: number, player: Vector3, indoors: boolean, windDir: number, gust: number, f: AtmoFrame): void {
    if (this.dirty) {
      this.rebuild();
      this.loopT = 0;
    }
    this.time += dt;
    const px = player.x;
    const py = player.y;
    const pz = player.z;
    this.foliage.update(this.time, gust, px, pz, f.look.x, f.look.z);
    this.wet.update(dt);
    const wind = 0.3 + gust * 2.4;
    this.particles.windX = Math.cos(windDir) * wind;
    this.particles.windZ = Math.sin(windDir) * wind;
    this.street.update(dt, player, f.speed, f.crouched, !indoors, f.urban, gust, windDir);
    this.vegetation.update(this.time, gust, f.camera, f.eye, f.sunDir, f.sunColor, f.fogFar);

    // Leaves let go in the gusts.
    if (!indoors) {
      this.leafDebt += dt * LEAF_RATE * Math.max(0, gust - 0.35) * 1.6;
      while (this.leafDebt >= 1) {
        this.leafDebt -= 1;
        const near: number[] = [];
        for (let i = 0; i < this.trees.length; i += 5) if (this.trees[i + 4] <= LEAFY && Math.hypot(this.trees[i] - px, this.trees[i + 2] - pz) < LEAF_RANGE) near.push(i);
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

    this.updateRain(dt, px, py, pz, indoors, f.rain);
    this.updateNight(dt, indoors, f);

    // Continuous sounds: the nearest few on this storey (and rain on the nearest car's roof), updated at 10 Hz.
    this.loopT -= dt;
    if (this.loopT <= 0) {
      this.loopT = 0.1;
      let nearN = 0;
      const pushNear = (key: number, kind: LoopKind, x: number, y: number, z: number, d: number) => {
        let slot = this.nearPool[nearN];
        if (!slot) this.nearPool[nearN] = slot = { key, kind, x, y, z, d };
        else {
          slot.key = key;
          slot.kind = kind;
          slot.x = x;
          slot.y = y;
          slot.z = z;
          slot.d = d;
        }
        this.near[nearN++] = slot;
      };
      for (let i = 0; i < this.loopSpots.length; i++) {
        const s = this.loopSpots[i];
        const d = Math.hypot(s.x - px, s.z - pz);
        // Loud ones carry over storeys and roofs; a quiet one only on this storey. Loud ones count nearer.
        const loud = LOUD_LOOPS.includes(s.kind);
        if (d < LOOP_RANGE[s.kind] && (loud || Math.abs(s.y - py - 1) < 2.2)) pushNear(s.key, s.kind, s.x, s.y, s.z, loud ? d * 0.4 : d);
      }
      if (f.rain > 0.2 && !indoors) {
        for (let i = 0; i + 3 < this.cars.length; i += 4) {
          const d = Math.hypot(this.cars[i] - px, this.cars[i + 1] - pz);
          if (d < LOOP_RANGE.rainTin) pushNear(-1 - i, 'rainTin', this.cars[i], 1.4, this.cars[i + 1], d);
        }
      }
      this.near.length = nearN;
      if (nearN > 1) this.near.sort((a, b) => a.d - b.d);
      sfx.loops(this.near);
    }

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
      this.creakT = 15 + Math.random() * 15;
      if (Math.random() < 0.1) sfx.house('creak', around(2, 6, Math.random() < 0.6 ? 0.1 : 2.6));
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

  /** The rain wets the paving (puddles fade in, dry out slowly) and rings their water. */
  private updateRain(dt: number, px: number, py: number, pz: number, indoors: boolean, rain: number): void {
    this.wetness = Math.max(0, Math.min(1, this.wetness + (rain > 0.15 ? rain * dt / 60 : -dt / 240)));
    const moved = Math.hypot(px - this.poolsAt.x, pz - this.poolsAt.z) > 4;
    if (moved || Math.abs(this.wetness - this.poolsAt.wet) > 0.08) {
      this.poolsAt = { x: px, z: pz, wet: this.wetness };
      this.rainPools = [];
      if (this.wetness > 0.02) {
        const c0x = Math.floor((px - PUDDLE_RANGE) / PUDDLE_CELL);
        const c0z = Math.floor((pz - PUDDLE_RANGE) / PUDDLE_CELL);
        const n = Math.ceil((PUDDLE_RANGE * 2) / PUDDLE_CELL);
        for (let i = 0; i <= n; i++) {
          for (let j = 0; j <= n; j++) {
            const cx = (c0x + i) * PUDDLE_CELL;
            const cz = (c0z + j) * PUDDLE_CELL;
            if (spotHash(cx, cz, 61) > 0.14) continue;
            const x = cx + spotHash(cx, cz, 62) * PUDDLE_CELL;
            const z = cz + spotHash(cx, cz, 63) * PUDDLE_CELL;
            if (Math.hypot(x - px, z - pz) > PUDDLE_RANGE || this.ground(x, z) !== Ground.Paved) continue;
            this.rainPools.push(x, this.groundY(x, z), z, 0.8 + spotHash(cx, cz, 64) * 1.4, this.wetness);
          }
        }
      }
      this.wet.setLeaks(this.leakList, this.rainPools.length ? this.pools.concat(this.rainPools) : this.pools);
    }
    // Drops ringing the puddles near you.
    if (rain > 0.1 && !indoors && this.rainPools.length && Math.random() < dt * 14 * rain) {
      const i = Math.floor(Math.random() * (this.rainPools.length / 5)) * 5;
      const r = this.rainPools[i + 3] * 0.35;
      if (Math.abs(this.rainPools[i + 1] - py) < 3) this.wet.addRipple(this.rainPools[i] + (Math.random() - 0.5) * r, this.rainPools[i + 1], this.rainPools[i + 2] + (Math.random() - 0.5) * r, 0.25 + Math.random() * 0.2);
    }
  }

  /** Moths round the lamps and the beam at night, dust in the beam indoors, breath in the cold. */
  private updateNight(dt: number, indoors: boolean, f: AtmoFrame): void {
    const N = ATMO.night;
    const night = f.daylight < 0.3;
    // Moths: the nearest lit lamps, and the beam out of doors.
    this.mothT -= dt;
    if (night && this.mothT <= 0) {
      // One moth a lamp each tick: about N.moths round each at a time (they live ~5.5 s).
      this.mothT = 5.5 / N.moths;
      const near: [number, number][] = [];
      for (let i = 0; i < this.lamps.length; i += 3) {
        const d = Math.hypot(this.lamps[i] - f.eye.x, (this.lamps[i + 1] - f.eye.y) * 2, this.lamps[i + 2] - f.eye.z);
        if (d < 14) near.push([d, i]);
      }
      near.sort((a, b) => a[0] - b[0]);
      near.slice(0, LAMP_MOTHS).forEach(([, i], g) => {
        this.particles.mothCenter(g, this.lamps[i], this.lamps[i + 1] - 0.15, this.lamps[i + 2]);
        this.particles.moth(g);
      });
      // The beam draws one now and then, never a swarm.
      if (f.flashlight && !indoors && Math.random() < N.beamMoths) this.particles.moth(BEAM_GROUP);
    }
    // Where the beam's moths circle: a point out in the beam that trails behind it (they fly, the beam
    // sweeps — they must not stick to the screen).
    if (f.flashlight) {
      const tx = f.eye.x + f.look.x * 2.2;
      const ty = f.eye.y + f.look.y * 2.2;
      const tz = f.eye.z + f.look.z * 2.2;
      const b = this.beamAt;
      if (Math.hypot(tx - b[0], ty - b[1], tz - b[2]) > 6) b.splice(0, 3, tx, ty, tz);
      else {
        const k = Math.min(1, dt * 0.7);
        b[0] += (tx - b[0]) * k;
        b[1] += (ty - b[1]) * k;
        b[2] += (tz - b[2]) * k;
      }
      this.particles.mothCenter(BEAM_GROUP, b[0], b[1], b[2]);
    }
    // Dust hanging in the beam, indoors.
    if (f.flashlight && indoors) {
      this.moteDebt += dt * N.motes;
      while (this.moteDebt >= 1) {
        this.moteDebt -= 1;
        const d = 0.6 + Math.random() * 2.6;
        const spread = d * 0.22;
        this.particles.mote(f.eye.x + f.look.x * d + (Math.random() - 0.5) * spread, f.eye.y + f.look.y * d + (Math.random() - 0.5) * spread, f.eye.z + f.look.z * d + (Math.random() - 0.5) * spread);
      }
    }
    // Breath in the cold: out-breaths quicken as you run.
    this.breathT -= dt;
    if (this.breathT <= 0) {
      this.breathT = N.breathEvery * (f.sprinting ? 0.5 : 1) * (0.85 + Math.random() * 0.3);
      if (f.felt < N.breathBelow) {
        const len = Math.hypot(f.look.x, f.look.z) || 1;
        this.particles.breath(f.eye.x + (f.look.x / len) * 0.22, f.eye.y - 0.1, f.eye.z + (f.look.z / len) * 0.22, f.look.x / len, f.look.z / len);
      }
    }
  }

  private rebuild(): void {
    this.dirty = false;
    const trees: number[] = [];
    const cars: number[] = [];
    const ivy: number[] = [];
    const leaks: number[] = [];
    const perches: number[] = [];
    const fires: number[] = [];
    const hydrants: number[] = [];
    const sparks: number[] = [];
    const steams: number[] = [];
    const jets: number[] = [];
    const loud: number[] = [];
    const pools: number[] = [];
    const lamps: number[] = [];
    const plants: Plant[] = [];
    const oldLeaks = this.leaks;
    this.leaks = [];
    this.taps = [];
    this.tapSpots = [];
    this.bedSpots = [];
    const oldPhones = this.phones;
    this.phones = [];
    this.loopSpots = [];
    const loop = (kind: LoopKind, x: number, y: number, z: number) => this.loopSpots.push({ key: Math.round(x * 8) * 92821 + Math.round(y * 8) * 68917 + Math.round(z * 8) * 31, kind, x, y, z });
    for (const spots of this.sets.values()) {
      for (let i = 0; i + LIFE_STRIDE <= spots.length; i += LIFE_STRIDE) {
        const kind = spots[i];
        const x = spots[i + 1];
        const y = spots[i + 2];
        const z = spots[i + 3];
        const seed = spots[i + 8];
        switch (kind) {
          case LIFE.lamp:
          case LIFE.room:
            lamps.push(x, y, z);
            break;
          case LIFE.tree:
            trees.push(x, y, z, spots[i + 6], spots[i + 9]);
            plants.push({ species: TREE_SPECIES[spots[i + 9]] ?? 'maple', pick: seed, x, y, z, yaw: Math.atan2(spots[i + 4], spots[i + 5]), scale: spots[i + 7] || 1 });
            break;
          case LIFE.bush:
            plants.push({ species: spots[i + 7] ? 'bushSpread' : 'bushRound', pick: seed, x, y, z, yaw: Math.atan2(spots[i + 4], spots[i + 5]), scale: spots[i + 6] || 1 });
            break;
          case LIFE.hedge:
            plants.push({ species: 'hedge', pick: seed, x, y, z, yaw: Math.atan2(spots[i + 5], spots[i + 4]), scale: spots[i + 6] || 1 });
            break;
          case LIFE.car:
            cars.push(x, z, spots[i + 4], spots[i + 5]);
            break;
          case LIFE.ivy:
            ivy.push(x, y, z, spots[i + 4], spots[i + 5], spots[i + 6], spots[i + 7], seed);
            break;
          case LIFE.perch:
            perches.push(x, y, z, spots[i + 4], spots[i + 5], spots[i + 6]);
            break;
          case LIFE.fire:
            fires.push(x, y, z, spots[i + 6]);
            loop('fire', x, y, z);
            break;
          case LIFE.smoke:
            fires.push(x, y, z, 0);
            break;
          case LIFE.siren:
            loop('siren', x, y, z);
            loud.push(x, y, z, 70);
            break;
          case LIFE.speaker:
            loop('speaker', x, y, z);
            loud.push(x, y, z, 50);
            break;
          case LIFE.bell:
            loop('bell', x, y, z);
            loud.push(x, y, z, 45);
            break;
          case LIFE.music:
            loop('music', x, y, z);
            loud.push(x, y, z, 30);
            break;
          case LIFE.sparks:
            sparks.push(x, y, z);
            loop('sparks', x, y, z);
            break;
          case LIFE.steam:
            steams.push(x, y, z);
            loop('hiss', x, y, z);
            break;
          case LIFE.jet:
            jets.push(x, y, z, spots[i + 4], spots[i + 5]);
            loop('hiss', x, y, z);
            break;
          case LIFE.hydrant: {
            if (!this.water) break;
            hydrants.push(x, y, z);
            const gy = this.groundY(x, z);
            pools.push(x + 0.4, gy, z + 0.2, 2.2 + seed, 1);
            loop('hiss', x, gy + 0.5, z);
            break;
          }
          case LIFE.drip: {
            const floor = y - spots[i + 7];
            leaks.push(x, y, z, floor, seed);
            const kept = oldLeaks.find((l) => l.x === x && l.y === y && l.z === z);
            this.leaks.push(kept ?? { x, y, z, floor, r: ((0.7 + seed * 0.8) / 2) * 0.85, base: 0.8 + seed * 2.2, next: Math.random() * 2 });
            break;
          }
          case LIFE.bed:
            this.bedSpots.push({ x, y, z });
            break;
          case LIFE.tap:
            this.tapSpots.push({ x, y, z });
            if (this.water && spots[i + 9] !== 1) this.taps.push({ x, y, z, next: Math.random() * 3 });
            break;
          case LIFE.phone:
            if (!this.power) break;
            this.phones.push(oldPhones.find((p) => p.x === x && p.y === y && p.z === z) ?? { x, y, z, next: 20 + seed * 90, rings: 0 });
            break;
          case LIFE.tv:
            if (this.power) loop('tv', x, y, z);
            break;
          case LIFE.fridge:
            if (this.power) loop('fridge', x, y, z);
            break;
          case LIFE.flies:
            loop('flies', x, y, z);
            break;
        }
      }
    }
    this.trees = trees;
    this.cars = cars;
    this.lamps = lamps;
    this.leakList = leaks;
    this.pools = pools;
    this.foliage.setSources({ trees, cars, ivy });
    this.vegetation.setPlants(plants);
    this.street.setSpots({ perches, cars, fires, hydrants, sparks, steams, jets, loud });
    this.wet.setLeaks(leaks, this.rainPools.length ? pools.concat(this.rainPools) : pools);
  }

  /** Programs compile during the loading-screen prewarm. */
  prewarm(): () => void {
    this.keepPrewarmVisible();
    return () => {
      this.dirty = true;
    };
  }

  /** Keep atmosphere instanced meshes visible through scene.render() during boot prewarm. */
  keepPrewarmVisible(): void {
    for (const mesh of [this.foliage.mesh, this.wet.mesh, this.street.critters.mesh]) {
      if (mesh.count === 0) {
        mesh.setMatrixAt(0, _ident);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.count = 1;
      }
      mesh.visible = true;
    }
    this.vegetation.prewarm();
  }

  dispose(): void {
    sfx.loops([]);
    this.foliage.dispose();
    this.wet.dispose();
    this.street.dispose();
    this.vegetation.dispose();
  }
}
