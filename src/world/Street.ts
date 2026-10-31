import { type Scene, Vector3 } from 'three';
import { sfx } from '../audio/Sound';
import { CRITTER, Critters } from '../render/Critters';
import type { Particles } from '../render/Particles';
import { ATMO, between } from './atmoConfig';
import type { CollisionWorld } from './CollisionWorld';
import { spotHash } from './gen/lifeKinds';

const S = ATMO.street;
/** Crows are kept (shown, flushed) on perches within this distance, m. */
const CROW_RANGE = 40;
/** Fires smoke, hydrants spout within this distance, m (the nearest few). */
const FIRE_RANGE = 35;
const HYDRANT_RANGE = 30;

interface Crow {
  /** Along the perch, −w/2…w/2; where it faces. */
  t: number;
  yaw: number;
  phase: number;
  /** Flying off: position, velocity, seconds in the air. */
  fly: Vector3 | null;
  vel: Vector3;
  air: number;
}

interface Perch {
  x: number;
  y: number;
  z: number;
  dx: number;
  dz: number;
  w: number;
  crows: Crow[];
  /** Empty until this time (after a flush). */
  until: number;
  cawT: number;
}

interface Rat {
  x: number;
  z: number;
  dx: number;
  dz: number;
  left: number;
  delay: number;
  phase: number;
}

export interface StreetSpots {
  /** x, y, z, dir x, dir z, length per perch. */
  perches: number[];
  /** x, z, heading x, heading z per car. */
  cars: number[];
  /** x, y, z, size per fire. */
  fires: number[];
  /** x, y (top), z per broken hydrant. */
  hydrants: number[];
  /** x, y, z per sparking cable / steam leak; x, y, z, dir x, dir z per burst pipe. */
  sparks?: number[];
  steams?: number[];
  jets?: number[];
  /** x, y, z, radius per loud thing (sirens, alarms, loudspeakers): every few seconds the zombies hear it. */
  loud?: number[];
}

const _v = new Vector3();

/**
 * Life in the streets: crows on the ridges and lamp arms that burst up cawing when you come close (and
 * the racket brings the nearest zombies), car alarms set off by a blow or by running into a car, a rat
 * along a wall, a shopping cart the wind pushes about, sheet metal rattling and signs creaking in the
 * gusts, smoke over burning cars and barrels, water spouting from broken hydrants. Rates: atmoConfig.
 */
export class Street {
  readonly critters: Critters;
  private perches: Perch[] = [];
  private cars: number[] = [];
  private fires: number[] = [];
  private hydrants: number[] = [];
  /** Cars whose alarm has gone off (or was tried by a bump): never again. */
  private readonly alarmed = new Set<number>();
  private readonly alarms: { x: number; z: number; end: number; noiseT: number }[] = [];
  private rats: Rat[] = [];
  private ratT = between(S.rats);
  private cart: { pos: Vector3; vel: Vector3; yaw: number; squeakT: number } | null = null;
  private cartT = between(S.cart);
  private rattleT = between(S.rattle);
  private smokeT = 0;
  private sprayT = 0;
  private time = 0;

  constructor(
    scene: Scene,
    private readonly particles: Particles,
    private readonly world: CollisionWorld,
    private readonly noise: (x: number, y: number, z: number, radius: number) => void,
    private readonly groundY: (x: number, z: number) => number,
  ) {
    this.critters = new Critters(scene);
  }

  /** New spots (chunks streamed): perches keep their crows by position. */
  setSpots(s: StreetSpots): void {
    const old = this.perches;
    this.perches = [];
    for (let i = 0; i + 5 < s.perches.length; i += 6) {
      const [x, y, z, dx, dz, w] = s.perches.slice(i, i + 6);
      const kept = old.find((p) => p.x === x && p.y === y && p.z === z);
      if (kept) {
        this.perches.push(kept);
        continue;
      }
      const p: Perch = { x, y, z, dx, dz, w, crows: [], until: 0, cawT: between(S.crowCaw) };
      if (spotHash(x, z, 7) < S.crowPerch) this.seat(p);
      this.perches.push(p);
    }
    this.cars = s.cars;
    this.fires = s.fires;
    this.hydrants = s.hydrants;
    this.sparks = s.sparks ?? [];
    this.steams = s.steams ?? [];
    this.jets = s.jets ?? [];
    this.loud = s.loud ?? [];
  }

  private sparks: number[] = [];
  private steams: number[] = [];
  private jets: number[] = [];
  private loud: number[] = [];
  private fxT = 0;
  private loudT = 0;

  /** Burning things and live cables near a point: the nearest within reach, and how far (fire hurts close up). */
  hazard(x: number, y: number, z: number): { kind: 'fire' | 'shock'; d: number; r: number } | null {
    let best: { kind: 'fire' | 'shock'; d: number; r: number } | null = null;
    for (let i = 0; i + 3 < this.fires.length; i += 4) {
      const w = this.fires[i + 3];
      if (w <= 0 || Math.abs(this.fires[i + 1] - y) > 3) continue;
      const d = Math.hypot(this.fires[i] - x, this.fires[i + 2] - z);
      const r = w * 0.9 + 0.7;
      if (d < r && (!best || d - r < best.d - best.r)) best = { kind: 'fire', d, r };
    }
    for (let i = 0; i + 2 < this.sparks.length; i += 3) {
      if (Math.abs(this.sparks[i + 1] - y - 0.8) > 1.6) continue;
      const d = Math.hypot(this.sparks[i] - x, this.sparks[i + 2] - z);
      if (d < 1.1 && (!best || d - 1.1 < best.d - best.r)) best = { kind: 'shock', d, r: 1.1 };
    }
    return best;
  }

  /** Crows settle on a perch: two to five, spread along it. */
  private seat(p: Perch): void {
    const n = 2 + Math.floor(Math.random() * 4);
    p.crows = Array.from({ length: n }, () => ({ t: (Math.random() - 0.5) * Math.max(0.3, p.w - 0.2), yaw: Math.atan2(p.dx, p.dz) + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2) + (Math.random() - 0.5) * 0.8, phase: Math.random() * 6, fly: null, vel: new Vector3(), air: 0 }));
  }

  /** A blow landed at (x, y, z): on a car, its alarm goes off. */
  strikeAt(x: number, y: number, z: number): void {
    const i = this.carAt(x, z, 0.4);
    if (i >= 0 && y < 1.9) this.alarm(i);
  }

  /** Index of the car whose footprint (grown by `pad`) holds (x, z), or −1. */
  private carAt(x: number, z: number, pad: number): number {
    const c = this.cars;
    for (let i = 0; i + 3 < c.length; i += 4) {
      const dx = x - c[i];
      const dz = z - c[i + 1];
      // The spot's normal is the car's local Z (across it); its length runs along local X = (nz, −nx).
      const along = dx * c[i + 3] - dz * c[i + 2];
      const across = dx * c[i + 2] + dz * c[i + 3];
      if (Math.abs(along) < 2.2 + pad && Math.abs(across) < 0.95 + pad) return i;
    }
    return -1;
  }

  private alarm(i: number): void {
    const key = Math.round(this.cars[i] * 10) * 100003 + Math.round(this.cars[i + 1] * 10);
    if (this.alarmed.has(key)) return;
    this.alarmed.add(key);
    const dur = between(S.alarmTime);
    const x = this.cars[i];
    const z = this.cars[i + 1];
    sfx.carAlarm({ x, y: 0.9, z }, dur);
    this.alarms.push({ x, z, end: this.time + dur, noiseT: 0 });
  }

  update(dt: number, player: Vector3, speed: number, crouched: boolean, outdoors: boolean, urban: boolean, gust: number, windDir: number): void {
    this.time += dt;
    const px = player.x;
    const pz = player.z;
    this.critters.begin(this.time);

    // Crows.
    for (const p of this.perches) {
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d > CROW_RANGE) continue;
      if (p.crows.length === 0 && p.until > 0 && this.time > p.until) {
        p.until = 0;
        if (Math.random() < S.crowPerch * 2) this.seat(p);
      }
      const sitting = p.crows.some((c) => !c.fly);
      if (sitting && d < S.crowFlush[crouched && speed < 1.5 ? 1 : 0] && Math.abs(p.y - player.y) < 12) this.flush(p, px, pz);
      else if (sitting && d < 30) {
        p.cawT -= dt;
        if (p.cawT <= 0) {
          p.cawT = between(S.crowCaw);
          sfx.crow(p, 1);
        }
      }
      for (let k = p.crows.length - 1; k >= 0; k--) {
        const c = p.crows[k];
        if (c.fly) {
          c.air += dt;
          c.vel.y += dt * 0.8;
          c.fly.addScaledVector(c.vel, dt);
          if (c.air > 7) {
            p.crows.splice(k, 1);
            continue;
          }
          this.critters.add(CRITTER.crow, c.fly.x, c.fly.y, c.fly.z, Math.atan2(c.vel.x, c.vel.z), -0.25, 1, c.phase);
        } else {
          // Now and then a crow turns its head (the whole bird: they are small).
          if (Math.random() < dt * 0.3) c.yaw += (Math.random() - 0.5) * 1.2;
          this.critters.add(CRITTER.crow, p.x + p.dx * c.t, p.y, p.z + p.dz * c.t, c.yaw, 0, 0, c.phase);
        }
      }
    }

    // Car alarms: wailing, and every few seconds the zombies round about hear it again.
    for (let i = this.alarms.length - 1; i >= 0; i--) {
      const a = this.alarms[i];
      if (this.time > a.end) {
        this.alarms.splice(i, 1);
        continue;
      }
      a.noiseT -= dt;
      if (a.noiseT <= 0) {
        a.noiseT = S.alarmNoiseEvery;
        this.noise(a.x, 0, a.z, S.alarmNoise);
      }
    }
    // Running into a car: a chance its alarm goes off (one roll per car).
    if (speed >= S.alarmBump) {
      const i = this.carAt(px, pz, 0.45);
      if (i >= 0) {
        const key = Math.round(this.cars[i] * 10) * 100003 + Math.round(this.cars[i + 1] * 10);
        if (!this.alarmed.has(key)) {
          if (Math.random() < S.alarmBumpChance) this.alarm(i);
          else this.alarmed.add(key);
        }
      }
    }

    // A rat along a wall, in town.
    this.ratT -= dt;
    if (this.ratT <= 0) {
      this.ratT = between(S.rats);
      if (outdoors && urban) this.spawnRats(player);
    }
    for (let i = this.rats.length - 1; i >= 0; i--) {
      const r = this.rats[i];
      if (r.delay > 0) {
        r.delay -= dt;
        continue;
      }
      const step = Math.min(r.left, 3.2 * dt);
      r.x += r.dx * step;
      r.z += r.dz * step;
      r.left -= step;
      if (r.left <= 0) {
        this.rats.splice(i, 1);
        continue;
      }
      this.critters.add(CRITTER.rat, r.x, this.groundY(r.x, r.z), r.z, Math.atan2(r.dx, r.dz), 0, 1, r.phase);
    }

    // A shopping cart rolling in the wind.
    this.updateCart(dt, player, outdoors && urban, gust, windDir);

    // Gusts: sheet metal rattling, a sign creaking.
    this.rattleT -= dt;
    if (this.rattleT <= 0) {
      this.rattleT = between(S.rattle);
      if (outdoors && urban && gust > 0.55) {
        const a = Math.random() * Math.PI * 2;
        const r = 6 + Math.random() * 8;
        sfx.street(Math.random() < 0.55 ? 'rattle' : 'sign', { x: px + Math.cos(a) * r, y: player.y + 2 + Math.random() * 3, z: pz + Math.sin(a) * r });
      }
    }

    // Fires smoke, hydrants spout (the nearest few); burnt-out things only smoulder.
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.28;
      let n = 0;
      for (let i = 0; i + 3 < this.fires.length && n < 4; i += 4) {
        if (Math.hypot(this.fires[i] - px, this.fires[i + 2] - pz) > FIRE_RANGE) continue;
        if (this.fires[i + 3] > 0) this.particles.smoke(this.fires[i], this.fires[i + 1] + this.fires[i + 3], this.fires[i + 2]);
        else if (Math.random() < 0.5) this.particles.steam(this.fires[i], this.fires[i + 1] + 0.3, this.fires[i + 2], 0.22);
        n++;
      }
    }
    // Cables spark, pipes steam and spout (the nearest few).
    this.fxT -= dt;
    if (this.fxT <= 0) {
      this.fxT = 0.12;
      for (let i = 0; i + 2 < this.sparks.length; i += 3) if (Math.hypot(this.sparks[i] - px, this.sparks[i + 2] - pz) < 25 && Math.random() < 0.35) this.particles.sparks(this.sparks[i], this.sparks[i + 1], this.sparks[i + 2], 3 + Math.floor(Math.random() * 6));
      for (let i = 0; i + 2 < this.steams.length; i += 3) if (Math.hypot(this.steams[i] - px, this.steams[i + 2] - pz) < 30) this.particles.steam(this.steams[i], this.steams[i + 1], this.steams[i + 2], 0.78);
      for (let i = 0; i + 4 < this.jets.length; i += 5) {
        const jx = this.jets[i];
        const jz = this.jets[i + 2];
        if (Math.hypot(jx - px, jz - pz) > 30) continue;
        for (let k = 0; k < 4; k++) this.particles.drop(jx, this.jets[i + 1], jz, this.groundY(jx, jz), this.jets[i + 3] * (3 + Math.random()), 0.6 + Math.random() * 0.8, this.jets[i + 4] * (3 + Math.random()), 0.045);
      }
    }
    // Sirens, alarms, loudspeakers: every few seconds the zombies round about hear them again.
    this.loudT -= dt;
    if (this.loudT <= 0) {
      this.loudT = 5;
      for (let i = 0; i + 3 < this.loud.length; i += 4) if (Math.hypot(this.loud[i] - px, this.loud[i + 2] - pz) < 120) this.noise(this.loud[i], this.loud[i + 1], this.loud[i + 2], this.loud[i + 3]);
    }
    this.sprayT -= dt;
    while (this.sprayT <= 0) {
      this.sprayT += 0.025;
      let n = 0;
      for (let i = 0; i + 2 < this.hydrants.length && n < 2; i += 3) {
        const hx = this.hydrants[i];
        const hz = this.hydrants[i + 2];
        if (Math.hypot(hx - px, hz - pz) > HYDRANT_RANGE) continue;
        const a = Math.random() * Math.PI * 2;
        const sp = 0.25 + Math.random() * 0.45;
        this.particles.drop(hx, this.hydrants[i + 1], hz, this.groundY(hx, hz), Math.cos(a) * sp, 2.6 + Math.random() * 1.4, Math.sin(a) * sp, 0.05);
        n++;
      }
    }
    this.critters.end();
  }

  /** The crows burst up cawing and fly off away from the player; the racket carries to the zombies. */
  private flush(p: Perch, px: number, pz: number): void {
    const away = Math.atan2(p.x - px, p.z - pz);
    for (const c of p.crows) {
      if (c.fly) continue;
      c.fly = new Vector3(p.x + p.dx * c.t, p.y, p.z + p.dz * c.t);
      const a = away + (Math.random() - 0.5) * 1.6;
      const sp = 3 + Math.random() * 2.5;
      c.vel.set(Math.sin(a) * sp, 2.2 + Math.random() * 1.8, Math.cos(a) * sp);
      c.air = Math.random() * 0.3;
    }
    sfx.crow(p, 3 + Math.floor(Math.random() * 3));
    this.noise(p.x, p.y, p.z, S.crowNoise);
    p.until = this.time + between(S.crowRespawn);
  }

  /** Find a wall a few metres off and send a rat or two scurrying along it. */
  private spawnRats(player: Vector3): void {
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const dist = this.world.rayHit(player.x, player.y + 0.3, player.z, dx, 0, dz, 8);
      if (dist < 2.5) continue;
      // Along the wall (its tangent), starting a few metres to one side.
      const side = Math.random() < 0.5 ? 1 : -1;
      const tx = -dz * side;
      const tz = dx * side;
      const wx = player.x + dx * (dist - 0.18);
      const wz = player.z + dz * (dist - 0.18);
      const n = Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < n; i++) this.rats.push({ x: wx - tx * 3.5, z: wz - tz * 3.5, dx: tx, dz: tz, left: 7, delay: i * 0.4, phase: Math.random() * 6 });
      sfx.street('squeak', { x: wx, y: player.y + 0.1, z: wz });
      return;
    }
  }

  private updateCart(dt: number, player: Vector3, allowed: boolean, gust: number, windDir: number): void {
    if (!this.cart) {
      this.cartT -= dt;
      if (this.cartT > 0 || !allowed) return;
      this.cartT = between(S.cart);
      // Upwind of the player, somewhere clear.
      const a = windDir + Math.PI + (Math.random() - 0.5) * 1.2;
      const r = 10 + Math.random() * 6;
      const pos = new Vector3(player.x + Math.cos(a) * r, 0, player.z + Math.sin(a) * r);
      pos.y = this.groundY(pos.x, pos.z);
      _v.copy(pos);
      this.world.resolveCircle(_v, 0.5, 1);
      if (_v.distanceTo(pos) > 0.01) return;
      this.cart = { pos, vel: new Vector3(), yaw: Math.random() * 6.28, squeakT: 0 };
      return;
    }
    const c = this.cart;
    if (Math.hypot(c.pos.x - player.x, c.pos.z - player.z) > 45) {
      this.cart = null;
      return;
    }
    // The wind pushes it along in the gusts; friction stops it.
    const push = Math.max(0, gust - 0.4) * 1.5;
    c.vel.x += Math.cos(windDir) * push * dt;
    c.vel.z += Math.sin(windDir) * push * dt;
    // The player bumps it.
    const pd = Math.hypot(c.pos.x - player.x, c.pos.z - player.z);
    if (pd < 0.8) {
      c.vel.x += ((c.pos.x - player.x) / (pd || 1)) * 3 * dt;
      c.vel.z += ((c.pos.z - player.z) / (pd || 1)) * 3 * dt;
    }
    c.vel.multiplyScalar(1 - Math.min(1, dt * 0.7));
    const sp = Math.hypot(c.vel.x, c.vel.z);
    if (sp > 1.8) c.vel.multiplyScalar(1.8 / sp);
    _v.copy(c.pos).addScaledVector(c.vel, dt);
    const fx = _v.x;
    const fz = _v.z;
    this.world.resolveCircle(_v, 0.45, 1);
    if (Math.abs(_v.x - fx) + Math.abs(_v.z - fz) > 1e-4) c.vel.multiplyScalar(-0.3);
    c.pos.set(_v.x, this.groundY(_v.x, _v.z), _v.z);
    if (sp > 0.1) {
      const want = Math.atan2(c.vel.x, c.vel.z);
      let d = want - c.yaw;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      c.yaw += d * Math.min(1, dt * 1.5);
    }
    c.squeakT -= dt;
    if (sp > 0.25 && c.squeakT <= 0) {
      c.squeakT = 0.35 + Math.random() * 0.35;
      sfx.street('cart', { x: c.pos.x, y: c.pos.y + 0.2, z: c.pos.z });
    }
    this.critters.add(CRITTER.cart, c.pos.x, c.pos.y, c.pos.z, c.yaw, 0, 0, 0);
  }

  dispose(): void {
    this.critters.dispose();
  }
}
