import { Vector3 } from 'three';
import { clamp } from '../core/math';
import { mulberry32 } from '../core/random';

/**
 * Zombies, stage 4.1: perception (hearing, sight), wandering, investigating, following the player.
 * No attacks yet. Pure simulation (no meshes): the crowd renderer draws `list`.
 *
 * Hearing — the player's noise (steps, sprint, landing, blows, doors) is heard within `noise × HEAR_RANGE` m;
 * a zombie that hears goes to look where the sound came from (a few metres off), and groans, which draws
 * those near it. Sight — within the view cone and range (shorter at night, longer if the player's light
 * is on, shorter crouching), with a clear line (no walls between): awareness grows over time, faster the
 * closer; at 1 the zombie follows. Losing sight it walks to the last place it saw the player, looks around,
 * then wanders off. Zombies stay on the ground: a player up a high-rise draws them to its foot.
 */

export type ZombieState = 'idle' | 'wander' | 'investigate' | 'chase';

export interface Zombie {
  id: number;
  pos: Vector3;
  /** Facing (rad, 0 = +Z… as Object3D.rotation.y). */
  yaw: number;
  speed: number;
  state: ZombieState;
  target: Vector3;
  /** 0..1 how sure it is the player is there (sight). */
  awareness: number;
  /** Seconds left in the current state / pause. */
  timer: number;
  /** Walk cycle phase (rad) and how much it walks (0 standing … 1 shambling). */
  phase: number;
  gait: number;
  /** Looks: clothes and skin variant, walk style. */
  look: number;
  /** Shamble speed of this one, m/s. */
  pace: number;
  /** Next perception update (time-sliced far away). */
  nextThink: number;
  sees: boolean;
  /** Time spent not getting closer to the target (unsticking). */
  stuck: number;
  lastDist: number;
  /** Seconds until it may groan again. */
  groanCd: number;
}

/** What the zombies need from the world. */
export interface ZombieWorld {
  /** Ground height. */
  groundY(x: number, z: number): number;
  /** Pushes a circle out of the static colliders (in place). */
  resolveCircle(pos: Vector3, radius: number, height?: number): void;
  /** Distance to the first wall along the ray, or −1. */
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
  /** The point is indoors (inside a building's interior). */
  indoors?(x: number, z: number): boolean;
}

/** Player as the zombies perceive it. */
export interface PlayerSense {
  pos: Vector3;
  /** Eye height above pos. */
  eye: number;
  /** 0..1 loudness this step. */
  noise: number;
  crouched: boolean;
  /** Light on the player's side: 0 dark night … 1 day / flashlight. */
  lit: number;
  /** Daylight 0..1. */
  daylight: number;
}

export const ZOMBIE_TUNING = {
  radius: 0.32,
  height: 1.75,
  /** Hearing: noise 1 is heard this far (m). */
  hearRange: 30,
  /** Sight range by day / by night (m); a lit player is seen at the day range. */
  sightDay: 28,
  sightNight: 11,
  /** Half view angle. */
  fov: (65 * Math.PI) / 180,
  /** Awareness per second at point blank (falls off with distance). */
  notice: 2.2,
  /** Awareness lost per second out of sight. */
  forget: 0.25,
  /** Speeds, m/s: wandering, investigating, following (each zombie ± 15%). */
  wander: 0.55,
  investigate: 0.9,
  chase: 1.35,
  /** Groan: how far other zombies hear it (m). */
  groanRange: 9,
  /** Spawn / despawn rings around the player (m). */
  spawnMin: 34,
  spawnMax: 70,
  despawn: 95,
  /** Perception rate far away (Hz); within `nearThink` m every step. */
  farHz: 4,
  nearThink: 20,
};

const T = ZOMBIE_TUNING;
const _d = new Vector3();
const _p = new Vector3();

export class ZombieSim {
  readonly list: Zombie[] = [];
  /** Events of this step for sound: zombies that groaned. */
  readonly groans: Zombie[] = [];
  /** How many want to be around the player (quality preset; 0 = none). */
  target: number;
  private time = 0;
  private nextId = 1;
  private readonly rnd: () => number;
  private spawnTimer = 0;

  constructor(
    private readonly world: ZombieWorld,
    target: number,
    seed = 1,
  ) {
    this.target = target;
    this.rnd = mulberry32(seed ^ 0x2b1d);
  }

  /** Zombies following the player / seeing it now. */
  get chasing(): number {
    return this.list.reduce((n, z) => n + (z.state === 'chase' ? 1 : 0), 0);
  }

  get seeing(): number {
    return this.list.reduce((n, z) => n + (z.sees ? 1 : 0), 0);
  }

  /** 0..1: how threatening it is right now (the nearest zombie that follows the player). */
  threat(player: Vector3): number {
    let t = 0;
    for (const z of this.list) {
      if (z.state !== 'chase' && !z.sees) continue;
      const d = Math.hypot(z.pos.x - player.x, z.pos.z - player.z);
      t = Math.max(t, clamp(1 - (d - 3) / 25, 0, 1) * (z.state === 'chase' ? 1 : 0.5));
    }
    return t;
  }

  /** Place one zombie (tests, debug). */
  spawnAt(x: number, z: number, state: ZombieState = 'idle'): Zombie {
    const r = this.rnd;
    const zb: Zombie = {
      id: this.nextId++,
      pos: new Vector3(x, this.world.groundY(x, z), z),
      yaw: r() * Math.PI * 2,
      speed: 0,
      state,
      target: new Vector3(x, 0, z),
      awareness: 0,
      timer: 1 + r() * 4,
      phase: r() * Math.PI * 2,
      gait: 0,
      look: Math.floor(r() * 1024),
      pace: 0.85 + r() * 0.3,
      nextThink: 0,
      sees: false,
      stuck: 0,
      lastDist: Infinity,
      groanCd: 2 + r() * 6,
    };
    this.list.push(zb);
    return zb;
  }

  update(dt: number, p: PlayerSense, viewDir?: Vector3): void {
    this.time += dt;
    this.groans.length = 0;
    this.populate(dt, p, viewDir);
    for (const z of this.list) {
      const dist = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
      if (this.time >= z.nextThink) {
        const step = dist < T.nearThink ? dt : 1 / T.farHz;
        this.think(z, p, dist, step);
        z.nextThink = this.time + step - 1e-6;
      }
      this.move(z, dt);
      if (z.groanCd > 0) z.groanCd -= dt;
    }
    this.separate();
  }

  /** Perception and state changes (`dt` = time since this zombie last thought). */
  private think(z: Zombie, p: PlayerSense, dist: number, dt: number): void {
    const r = this.rnd;
    // Sight.
    z.sees = this.canSee(z, p, dist);
    if (z.sees) {
      const range = this.sightRange(p);
      z.awareness = Math.min(1.5, z.awareness + T.notice * dt * clamp(1.15 - dist / range, 0.1, 1));
    } else z.awareness = Math.max(0, z.awareness - T.forget * dt);

    if (z.sees && z.awareness >= 1) {
      if (z.state !== 'chase') this.groan(z, true);
      z.state = 'chase';
      z.target.copy(p.pos);
      z.timer = 6;
    } else if (z.state === 'chase') {
      // Lost it: on to where it was last seen, then look around.
      z.timer -= dt;
      if (z.timer <= 0 || this.reached(z, 0.8)) this.enter(z, 'investigate', 4 + r() * 4);
    }

    // Hearing (not while following: it already knows where to go).
    if (z.state !== 'chase' && p.noise > 0.02) {
      const heard = p.noise * T.hearRange;
      if (dist < heard) {
        const err = (dist / heard) * 4;
        z.target.set(p.pos.x + (r() - 0.5) * err, 0, p.pos.z + (r() - 0.5) * err);
        if (z.state !== 'investigate') this.groan(z, false);
        this.enter(z, 'investigate', 8 + r() * 6);
        z.awareness = Math.max(z.awareness, 0.35);
      }
    }

    // Idle ↔ wander, investigate → idle.
    if (z.state === 'idle' || z.state === 'wander' || z.state === 'investigate') {
      z.timer -= dt;
      if (z.state === 'investigate' && this.reached(z, 1.2)) z.timer = Math.min(z.timer, 2.5);
      if (z.timer <= 0) {
        if (z.state === 'wander' || z.state === 'investigate') this.enter(z, 'idle', 2 + r() * 6);
        else {
          const a = r() * Math.PI * 2;
          const d = 4 + r() * 10;
          z.target.set(z.pos.x + Math.cos(a) * d, 0, z.pos.z + Math.sin(a) * d);
          this.enter(z, 'wander', 6 + r() * 8);
        }
      }
    }
  }

  private enter(z: Zombie, s: ZombieState, timer: number): void {
    z.state = s;
    z.timer = timer;
    z.stuck = 0;
    z.lastDist = Infinity;
  }

  private reached(z: Zombie, r: number): boolean {
    return Math.hypot(z.target.x - z.pos.x, z.target.z - z.pos.z) < r;
  }

  sightRange(p: PlayerSense): number {
    const base = T.sightNight + (T.sightDay - T.sightNight) * Math.max(p.daylight, p.lit);
    return base * (p.crouched ? 0.6 : 1);
  }

  /** In the view cone, in range, nothing solid between the eyes and the player. */
  canSee(z: Zombie, p: PlayerSense, dist: number): boolean {
    const range = this.sightRange(p);
    if (dist > range) return false;
    const dx = p.pos.x - z.pos.x;
    const dz = p.pos.z - z.pos.z;
    // Facing: yaw 0 looks along +Z.
    const fx = Math.sin(z.yaw);
    const fz = Math.cos(z.yaw);
    const cos = (dx * fx + dz * fz) / Math.max(dist, 1e-3);
    // Right next to it, it notices whatever the facing.
    if (dist > 2 && cos < Math.cos(T.fov)) return false;
    const ex = z.pos.x;
    const ey = z.pos.y + 1.6;
    const ez = z.pos.z;
    _d.set(p.pos.x - ex, p.pos.y + p.eye - ey, p.pos.z - ez);
    const len = _d.length();
    _d.divideScalar(len);
    const hit = this.world.rayHit(ex, ey, ez, _d.x, _d.y, _d.z, len);
    return hit < 0 || hit > len - 0.3;
  }

  /** A groan: other zombies near hear it and come to look (the herd draws itself in). */
  private groan(z: Zombie, alarm: boolean): void {
    // The sound has a cooldown; the alarm itself always spreads.
    if (z.groanCd <= 0) {
      z.groanCd = alarm ? 4 : 7;
      this.groans.push(z);
    }
    if (!alarm) return;
    for (const o of this.list) {
      if (o === z || o.state === 'chase') continue;
      if (Math.hypot(o.pos.x - z.pos.x, o.pos.z - z.pos.z) > T.groanRange) continue;
      o.target.copy(z.target);
      this.enter(o, 'investigate', 8 + this.rnd() * 6);
    }
  }

  private move(z: Zombie, dt: number): void {
    const want = z.state === 'chase' ? T.chase : z.state === 'investigate' ? T.investigate : z.state === 'wander' ? T.wander : 0;
    const dx = z.target.x - z.pos.x;
    const dz = z.target.z - z.pos.z;
    const d = Math.hypot(dx, dz);
    const go = want > 0 && d > (z.state === 'chase' ? 0.9 : 0.4);
    z.speed += ((go ? want * z.pace : 0) - z.speed) * Math.min(1, dt * 3);
    if (go) {
      // Turn towards the target (shuffling, not snapping).
      const yaw = Math.atan2(dx, dz);
      let dy = yaw - z.yaw;
      dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
      z.yaw += clamp(dy, -2.5 * dt, 2.5 * dt);
      // Unstick: not getting closer for a while → a side step somewhere else.
      if (d > z.lastDist - 0.02 * dt) z.stuck += dt;
      else z.stuck = Math.max(0, z.stuck - dt);
      z.lastDist = d;
      if (z.stuck > 2.5 && z.state !== 'chase') {
        const a = z.yaw + (this.rnd() < 0.5 ? 1 : -1) * (1 + this.rnd());
        z.target.set(z.pos.x + Math.sin(a) * 5, 0, z.pos.z + Math.cos(a) * 5);
        z.stuck = 0;
        z.lastDist = Infinity;
      }
    }
    if (z.speed > 0.01) {
      const fx = Math.sin(z.yaw);
      const fz = Math.cos(z.yaw);
      _p.copy(z.pos);
      z.pos.x += fx * z.speed * dt;
      z.pos.z += fz * z.speed * dt;
      this.world.resolveCircle(z.pos, T.radius, T.height);
      // Walk cycle: one stride per ~1.1 m.
      z.phase += (_p.distanceTo(z.pos) / 1.1) * Math.PI * 2;
    }
    z.pos.y = this.world.groundY(z.pos.x, z.pos.z);
    z.gait += (clamp(z.speed / 0.8, 0, 1) - z.gait) * Math.min(1, dt * 4);
  }

  /** Keep them from walking into each other (few dozen: pairwise is fine). */
  private separate(): void {
    const l = this.list;
    const min = T.radius * 2;
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const a = l[i].pos;
        const b = l[j].pos;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
    }
  }

  /** Keep about `target` around the player: spawn out of sight in a ring, drop the ones left far behind. */
  private populate(dt: number, p: PlayerSense, viewDir?: Vector3): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) > T.despawn && z.state !== 'chase') this.list.splice(i, 1);
    }
    this.spawnTimer -= dt;
    if (this.list.length >= this.target || this.spawnTimer > 0) return;
    this.spawnTimer = 0.25;
    const r = this.rnd;
    for (let tries = 0; tries < 6; tries++) {
      const a = r() * Math.PI * 2;
      const d = T.spawnMin + r() * (T.spawnMax - T.spawnMin);
      const x = p.pos.x + Math.cos(a) * d;
      const z = p.pos.z + Math.sin(a) * d;
      // Not in front of the player within the fog (no popping in), not inside walls or buildings.
      if (viewDir && d < T.spawnMax * 0.8) {
        const c = (Math.cos(a) * viewDir.x + Math.sin(a) * viewDir.z) / Math.max(1e-3, Math.hypot(viewDir.x, viewDir.z));
        if (c > 0.3) continue;
      }
      if (this.world.indoors?.(x, z)) continue;
      _p.set(x, this.world.groundY(x, z), z);
      this.world.resolveCircle(_p, T.radius, T.height);
      if (Math.hypot(_p.x - x, _p.z - z) > 0.01) continue;
      this.spawnAt(x, z, r() < 0.4 ? 'wander' : 'idle');
      return;
    }
  }
}
