import type { CostumeId } from '../characters/assets';
import type { GearId } from '../data/items';
import { Vector3 } from 'three';
import { clamp } from '../core/math';
import { mulberry32 } from '../core/random';
import { MODEL_KINDS, type ModelKind, ZOMBIE_STATS } from '../zombies/stats';

/**
 * Zombies: perception, wandering, searching, following, fighting, doors (pure simulation, no meshes:
 * the crowd renderer draws `list`, the scene plays `sounds` and applies `attacks`).
 *
 * Sight — only along a clear line (raycast through the colliders: no walls between the eyes and the
 * player), in the view cone and range (shorter at night, longer if the player's light is on, shorter
 * crouching); awareness grows over time, at 1 the zombie follows.
 * Hearing — a noise is heard within `noise × 30` m, through walls too: the zombie goes to where it came
 * from and searches there (turning, short steps), it does not follow.
 * Following — slower than the player's run (joggers a little quicker). Out of sight for ~5 s it goes to
 * where it last saw the player, searches 10–15 s and loses interest.
 * Closed doors in the way are beaten on until they give. Inside high-rises the world routes it along
 * the stairs between storeys (waypoints), outside to the entrance.
 */

/** Every zombie is one of the modelled kinds (src/zombies: the worker, the medic, the soldier…). */
export type ZombieKind = ModelKind;
export type ZombieState = 'idle' | 'wander' | 'investigate' | 'search' | 'chase' | 'attack' | 'bang' | 'stagger' | 'dead';

/** Body of a dead survivor walking: the clothes and what was carried (saved; looted when it falls). */
export interface TwinData {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Colors on the body: top, trousers, skin. */
  colors: [number, number, number];
}

export interface Zombie {
  id: number;
  kind: ZombieKind;
  pos: Vector3;
  /** Facing (rad), 0 looks along +Z (Object3D.rotation.y). */
  yaw: number;
  speed: number;
  state: ZombieState;
  /** Where it is going (the player, a noise, the last place it saw the player, a wander point). */
  target: Vector3;
  /** The next step towards it (stairs, an entrance), from the world's routing. */
  steer: Vector3;
  awareness: number;
  /** Seconds left in the current state. */
  timer: number;
  /** Seconds the player has been out of sight while following. */
  unseen: number;
  /** Ground walked: 2π per PHASE_M metres (the footfall sounds; the models time their steps by it). */
  phase: number;
  gait: number;
  look: number;
  /** Own pace factor (± 15%). */
  pace: number;
  /** Voice pitch factor. */
  pitch: number;
  nextThink: number;
  sees: boolean;
  stuck: number;
  lastDist: number;
  groanCd: number;
  hp: number;
  /**
   * Dead: how it died — the blow (where from, how hard, on the head, where it landed) and how it was moving
   * (walk phase, gait) — for its ragdoll. Null while alive.
   */
  death: { fromX: number; fromZ: number; damage: number; head: boolean; point: Vector3 | null; phase: number; gait: number; speed: number; push?: number } | null;
  /** Shot in the leg: limps (slower) for this many seconds. */
  limp: number;
  /** A shot to the head: the model snaps it back once (ZombieModels takes it). */
  snap: boolean;
  /** Dead and its ragdoll asleep: frozen — nothing moves it or its limbs again. When it died (sim time). */
  rest: boolean;
  diedAt: number;
  shake: number;
  /** Search: the point it looks around and where its eyes are now. */
  lookYaw: number;
  /** Attack windup / door blow cooldown, s. */
  swing: number;
  door: unknown;
  twin?: TwinData;
  /** The costume it wears, when the world says (a twin in the survivor's); undefined: by kind and place. */
  costume?: CostumeId | null;
  /** The gear it wears, when the world says (a twin's own); undefined: by kind and costume. */
  gear?: readonly GearId[];
}

export interface ZombieWorld {
  /** Standing height at (x, z) for something whose feet are at y (floors and stairs inside high-rises). */
  groundY(x: number, z: number, y: number): number;
  resolveCircle(pos: Vector3, radius: number, height?: number): void;
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number;
  indoors?(x: number, z: number): boolean;
  /** The next point to walk to on the way from `from` to `to` (stairs, entrances); false = straight there. */
  route?(from: Vector3, to: Vector3, out: Vector3): boolean;
  /** A closed door within `r` of (x, y, z): a handle and the doorway's middle. */
  doorNear?(x: number, y: number, z: number, r: number): { ref: unknown; x: number; z: number } | null;
  /** Hit a door; true when it gives way. */
  hitDoor?(ref: unknown, damage: number): boolean;
  /** Which modelled kind a zombie spawned here is (by place: police at the station…); `pick` in [0, 1). */
  kindAt?(x: number, z: number, y: number, pick: number): ModelKind;
}

export interface BanditTarget {
  pos: Vector3;
  state: string;
  hit(dmg: number, fromX: number, fromZ: number): void;
}

export interface PlayerSense {
  pos: Vector3;
  eye: number;
  noise: number;
  crouched: boolean;
  lit: number;
  daylight: number;
  fog?: number;
  bandits?: readonly BanditTarget[];
}

export type ZombieSound = 'moan' | 'rasp' | 'teeth' | 'step' | 'alarm' | 'bang' | 'crack' | 'hit' | 'die' | 'swing';

/**
 * Kinds: chase speed, body scale, voice, health factor; `pace` scales its other walking, `headFwd` (m) is
 * how far its head is ahead of its feet (hunched). From their factors on the one-armed worker
 * (src/zombies/stats.ts: following at 1.1 m/s, 100 HP).
 */
type KindNumbers = { chase: number; scale: number; pitch: number; pace: number; headFwd: number; hp: number };
const KIND = Object.fromEntries(
  MODEL_KINDS.map((k) => {
    const s = ZOMBIE_STATS[k];
    const pitch = k === 'worker' ? 0.75 : s.female ? 1.2 : 0.85;
    return [k, { chase: 1.1 * s.speed, scale: s.height / 1.86, pitch, pace: 0.9 * s.speed, headFwd: s.headFwd, hp: s.hp }];
  }),
) as Record<ZombieKind, KindNumbers>;
/** Without a world to ask where (tests): a town's people. */
const ANYWHERE: ModelKind[] = ['courier', 'office', 'jogger', 'grandma', 'tourist', 'builder', 'worker', 'chef', 'police', 'medic'];

export const ZOMBIE_TUNING = {
  radius: 0.32,
  height: 1.75,
  hp: 100,
  hearRange: 30,
  sightDay: 28,
  sightNight: 11,
  fov: (65 * Math.PI) / 180,
  notice: 2.2,
  forget: 0.25,
  wander: 0.55,
  investigate: 0.9,
  /** Out of sight this long while following → off to the last place it saw the player. */
  lose: 5,
  /** Searching after losing the player, s. */
  searchMin: 10,
  searchMax: 15,
  groanRange: 9,
  /** Attack: reach, windup, cooldown, damage to the player (HP of 100). */
  reach: 1.15,
  windup: 0.55,
  cooldown: 1.3,
  damage: [8, 14] as const,
  /** Door blows: every so often, this much. */
  doorEvery: 1.4,
  doorDamage: [8, 14] as const,
  spawnMin: 34,
  spawnMax: 70,
  despawn: 95,
  /** Bodies lie this long before they go. */
  corpse: 90,
  /** Bodies lying about at once (the oldest out of sight go first). */
  maxCorpses: 12,
  farHz: 4,
  nearThink: 20,
};

const T = ZOMBIE_TUNING;
/** Metres of ground per 2π of `Zombie.phase` (a footfall sound every half). */
export const PHASE_M = 1.1;
const _d = new Vector3();
const _p = new Vector3();
const _hit = new Vector3();

export interface HitResult {
  zombie: Zombie;
  head: boolean;
  dist: number;
  point: Vector3;
}

export class ZombieSim {
  readonly list: Zombie[] = [];
  /** This step: sounds to play (who, what) and blows that reached the player (HP). */
  readonly sounds: { z: Zombie; kind: ZombieSound }[] = [];
  readonly attacks: { damage: number; from: Zombie }[] = [];
  /** Twins killed this step (the scene drops their loot). */
  readonly killedTwins: Zombie[] = [];
  /** Zombies killed this step (their bodies can be searched) and bodies taken away (out of sight). */
  readonly died: Zombie[] = [];
  readonly removed: Zombie[] = [];
  /** Kept for back-compat: groaning zombies of this step. */
  readonly groans: Zombie[] = [];
  target: number;
  private time = 0;
  private nextId = 1;
  private readonly rnd: () => number;
  private spawnTimer = 0;
  private popAccum = 0;
  private readonly heardAt = new Vector3();
  private readonly aliveBuf: Zombie[] = [];
  private readonly corpseBuf: Zombie[] = [];

  constructor(
    private readonly world: ZombieWorld,
    target: number,
    seed = 1,
  ) {
    this.target = target;
    this.rnd = mulberry32(seed ^ 0x2b1d);
  }

  get chasing(): number {
    return this.list.reduce((n, z) => n + (z.state === 'chase' || z.state === 'attack' ? 1 : 0), 0);
  }

  get seeing(): number {
    return this.list.reduce((n, z) => n + (z.sees ? 1 : 0), 0);
  }

  /**
   * A noise out in the world (crows taking off, a car alarm): zombies within `radius` that are not already
   * after the player go and look where it came from, as when they hear the player.
   */
  noiseAt(x: number, y: number, z: number, radius: number): void {
    const r = this.rnd;
    for (const zb of this.list) {
      if (zb.state === 'dead' || zb.state === 'chase' || zb.state === 'bang' || zb.state === 'attack' || zb.state === 'stagger') continue;
      const d = Math.hypot(zb.pos.x - x, zb.pos.z - z);
      if (d > radius) continue;
      const err = (d / radius) * 4;
      zb.target.set(x + (r() - 0.5) * err, y, z + (r() - 0.5) * err);
      if (zb.state !== 'investigate' && zb.state !== 'search') this.groan(zb, false);
      this.enter(zb, 'investigate', 20);
      zb.awareness = Math.max(zb.awareness, 0.35);
    }
  }

  /** Living zombies of the crowd (not twins): the quality limit counts these. */
  get alive(): number {
    return this.list.reduce((n, z) => n + (z.state !== 'dead' && !z.twin ? 1 : 0), 0);
  }

  /**
   * A zombie of a horde coming out at (x, z) — where the ground is free and outdoors — walking to (tx, tz):
   * looking (it heard something) or just drifting. False if it can't stand there.
   */
  spawnSpill(x: number, z: number, tx: number, tz: number, drawn: boolean): boolean {
    if (this.world.indoors?.(x, z)) return false;
    _hit.set(x, this.world.groundY(x, z, 0), z);
    this.world.resolveCircle(_hit, T.radius, T.height);
    if (Math.hypot(_hit.x - x, _hit.z - z) > 0.01) return false;
    const zb = this.spawnAt(x, z, drawn ? 'investigate' : 'wander');
    zb.target.set(tx, this.world.groundY(tx, tz, 0), tz);
    if (drawn) {
      this.enter(zb, 'investigate', 30);
      zb.awareness = 0.3;
    }
    return true;
  }

  threat(player: Vector3): number {
    let t = 0;
    for (const z of this.list) {
      if (z.state === 'dead' || (z.state !== 'chase' && z.state !== 'attack' && !z.sees)) continue;
      const d = Math.hypot(z.pos.x - player.x, z.pos.z - player.z);
      t = Math.max(t, clamp(1 - (d - 3) / 25, 0, 1) * (z.state === 'chase' || z.state === 'attack' ? 1 : 0.5));
    }
    return t;
  }

  spawnAt(x: number, z: number, state: ZombieState = 'idle', kind?: ZombieKind, y = 0): Zombie {
    const r = this.rnd;
    const id = this.nextId++;
    // Which kind (not given): the world says by place, picked by id (the random sequence stays).
    const pick = ((Math.imul(id ^ 0x5bd1, 2246822519) >>> 0) % 1000) / 1000;
    const k = kind ?? this.world.kindAt?.(x, z, y, pick) ?? ANYWHERE[Math.floor(pick * ANYWHERE.length)];
    const zb: Zombie = {
      id,
      kind: k,
      pos: new Vector3(x, this.world.groundY(x, z, y), z),
      yaw: r() * Math.PI * 2,
      speed: 0,
      state,
      target: new Vector3(x, y, z),
      steer: new Vector3(x, y, z),
      awareness: 0,
      timer: 1 + r() * 4,
      unseen: 0,
      phase: r() * Math.PI * 2,
      gait: 0,
      look: Math.floor(r() * 1024),
      pace: 0.85 + r() * 0.3,
      pitch: KIND[k].pitch * (0.9 + r() * 0.2),
      nextThink: 0,
      sees: false,
      stuck: 0,
      lastDist: Infinity,
      groanCd: 2 + r() * 8,
      hp: T.hp * KIND[k].hp,
      death: null,
      limp: 0,
      snap: false,
      rest: false,
      diedAt: 0,
      shake: 0,
      lookYaw: 0,
      swing: 0,
      door: null,
    };
    this.list.push(zb);
    return zb;
  }

  /** Body scale of a zombie's kind (renderer). */
  static scale(z: Zombie): number {
    return KIND[z.kind].scale;
  }

  update(dt: number, p: PlayerSense, viewDir?: Vector3): void {
    this.time += dt;
    // What the last step reported is gone; blows struck since (the player's, before this step) stay.
    this.sounds.splice(0, this.reported[0]);
    this.attacks.length = 0;
    this.killedTwins.splice(0, this.reported[1]);
    this.died.splice(0, this.reported[2]);
    this.removed.length = 0;
    this.groans.length = 0;
    this.populate(dt, p, viewDir);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const z = this.list[i];
      if (z.state === 'dead') {
        // Dead is its own state: no thinking, no chasing, no shoving. Its ragdoll (the scene's) moves the
        // body until it sleeps; the simulation never touches it again.
        continue;
      }
      if (z.shake > 0) z.shake -= dt;
      if (z.limp > 0) z.limp -= dt;
      const dist = Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z);
      const nb = this.nearestBandit(z, p, dist);
      if (nb) {
        z.target.copy(nb.b.pos);
        if (z.state !== 'stagger' && z.state !== 'attack' && z.state !== 'bang') z.state = 'chase';
      } else if (this.time >= z.nextThink) {
        const step = dist < T.nearThink ? dt : 1 / T.farHz;
        this.think(z, p, dist, step);
        z.nextThink = this.time + step - 1e-6;
      }
      this.act(z, p, dist, dt, nb);
      this.move(z, dt, nb ? Math.min(dist, nb.dist) : dist);
      if (z.groanCd > 0) z.groanCd -= dt;
      this.ambient(z, dist);
    }
    this.separate();
    this.reported = [this.sounds.length, this.killedTwins.length, this.died.length];
  }

  /** How many sounds, killed twins and deaths the last step reported (cleared by the next one). */
  private reported = [0, 0, 0];

  // ── Perception and decisions ────────────────────────────────────────────────────────────────────

  private think(z: Zombie, p: PlayerSense, dist: number, dt: number): void {
    const r = this.rnd;
    if (z.state === 'stagger' || z.state === 'attack') return;
    z.sees = this.canSee(z, p, dist);
    if (z.sees) {
      const range = this.sightRange(p);
      z.awareness = Math.min(1.5, z.awareness + T.notice * dt * clamp(1.15 - dist / range, 0.1, 1));
    } else z.awareness = Math.max(0, z.awareness - T.forget * dt);

    if (z.sees && z.awareness >= 1) {
      if (z.state !== 'chase' && z.state !== 'bang') this.groan(z, true);
      if (z.state !== 'bang') z.state = 'chase';
      z.target.copy(p.pos);
      z.unseen = 0;
    } else if (z.state === 'chase' || z.state === 'bang') {
      z.unseen += dt;
      // Lost: to the last place it saw the player (target stays there), then search.
      if (z.unseen >= T.lose || (z.state === 'chase' && this.reached(z, 0.9))) this.searchAt(z, z.target);
    }

    // Hearing: go and look, never follow (a wall between is fine — sound goes through).
    if (z.state !== 'chase' && z.state !== 'bang' && p.noise > 0.02) {
      const heard = p.noise * T.hearRange;
      if (dist < heard) {
        const err = (dist / heard) * 4;
        this.heardAt.set(p.pos.x + (r() - 0.5) * err, p.pos.y, p.pos.z + (r() - 0.5) * err);
        if (z.state !== 'investigate' || this.heardAt.distanceTo(z.target) > 3) {
          z.target.copy(this.heardAt);
          if (z.state !== 'investigate' && z.state !== 'search') this.groan(z, false);
          this.enter(z, 'investigate', 20);
        }
        z.awareness = Math.max(z.awareness, 0.35);
      }
    }

    z.timer -= dt;
    switch (z.state) {
      case 'investigate':
        if (this.reached(z, 1.3) || z.timer <= 0) this.searchAt(z, z.target, 6 + r() * 4);
        break;
      case 'search':
        if (z.timer <= 0) this.enter(z, 'idle', 3 + r() * 6);
        else if (this.reached(z, 0.5) && r() < dt * 0.7) {
          // A few steps somewhere near the spot, then look around again.
          const a = r() * Math.PI * 2;
          z.steer.set(z.target.x + Math.cos(a) * 2.5, z.target.y, z.target.z + Math.sin(a) * 2.5);
        }
        break;
      case 'idle':
        if (z.timer <= 0) {
          const a = r() * Math.PI * 2;
          const d = 4 + r() * 10;
          z.target.set(z.pos.x + Math.cos(a) * d, z.pos.y, z.pos.z + Math.sin(a) * d);
          this.enter(z, 'wander', 6 + r() * 8);
        }
        break;
      case 'wander':
        if (z.timer <= 0 || this.reached(z, 0.5)) this.enter(z, 'idle', 2 + r() * 6);
        break;
    }
  }

  /** Lost the player / arrived at a noise: look around this spot for a while. */
  private searchAt(z: Zombie, at: Vector3, seconds = T.searchMin + this.rnd() * (T.searchMax - T.searchMin)): void {
    z.target.copy(at);
    z.steer.copy(at);
    z.lookYaw = z.yaw;
    this.enter(z, 'search', seconds);
    z.awareness = Math.min(z.awareness, 0.6);
  }

  private enter(z: Zombie, s: ZombieState, timer: number): void {
    z.state = s;
    z.timer = timer;
    z.stuck = 0;
    z.lastDist = Infinity;
    z.door = null;
  }

  private reached(z: Zombie, r: number): boolean {
    return Math.hypot(z.target.x - z.pos.x, z.target.z - z.pos.z) < r && Math.abs(z.target.y - z.pos.y) < 1.6;
  }

  sightRange(p: PlayerSense): number {
    const base = T.sightNight + (T.sightDay - T.sightNight) * Math.max(p.daylight, p.lit);
    const fogFactor = 1 - 0.65 * (p.fog ?? 0);
    return base * (p.crouched ? 0.6 : 1) * fogFactor;
  }

  /** In the view cone, in range, and a clear line from the eyes to the player's eyes. */
  canSee(z: Zombie, p: PlayerSense, dist: number): boolean {
    if (dist > this.sightRange(p) || Math.abs(p.pos.y - z.pos.y) > 6) return false;
    const dx = p.pos.x - z.pos.x;
    const dz = p.pos.z - z.pos.z;
    const cos = (dx * Math.sin(z.yaw) + dz * Math.cos(z.yaw)) / Math.max(dist, 1e-3);
    if (dist > 1.5 && cos < Math.cos(T.fov)) return false;
    const ey = z.pos.y + 1.6;
    _d.set(p.pos.x - z.pos.x, p.pos.y + p.eye - ey, p.pos.z - z.pos.z);
    const len = _d.length();
    _d.divideScalar(len);
    const hit = this.world.rayHit(z.pos.x, ey, z.pos.z, _d.x, _d.y, _d.z, len);
    return hit < 0 || hit > len - 0.3;
  }

  private groan(z: Zombie, alarm: boolean): void {
    if (z.groanCd <= 0) {
      z.groanCd = alarm ? 4 : 7;
      this.groans.push(z);
      this.sounds.push({ z, kind: alarm ? 'alarm' : 'moan' });
    }
    if (!alarm) return;
    for (const o of this.list) {
      if (o === z || o.state === 'chase' || o.state === 'dead' || o.state === 'attack') continue;
      if (Math.hypot(o.pos.x - z.pos.x, o.pos.z - z.pos.z) > T.groanRange) continue;
      o.target.copy(z.target);
      this.enter(o, 'investigate', 20);
    }
  }

  /** Idle sounds: moans now and then, rasps while following, teeth when close, shuffling steps. */
  private ambient(z: Zombie, dist: number): void {
    if (dist > 22) return;
    const r = this.rnd;
    const hunting = z.state === 'chase' || z.state === 'bang';
    if (z.groanCd <= 0 && r() < (hunting ? 0.08 : 0.02)) {
      // After you: snarling all the time; otherwise a growl now and then.
      z.groanCd = hunting ? 1.4 + r() * 2 : 4 + r() * 8;
      this.sounds.push({ z, kind: z.state === 'chase' ? 'rasp' : dist < 3.5 ? 'teeth' : 'moan' });
    }
  }

  // ── Actions: attacking, doors, getting hit ──────────────────────────────────────────────────────

  private nearestBandit(z: Zombie, p: PlayerSense, playerDist: number): { b: BanditTarget; dist: number } | null {
    const list = p.bandits;
    if (!list || list.length === 0) return null;
    const range = Math.min(18, this.sightRange(p) + 4);
    let best: BanditTarget | null = null;
    let bestD = range;
    for (const b of list) {
      if (b.state === 'dead' || Math.abs(b.pos.y - z.pos.y) > 2.5) continue;
      const d = Math.hypot(b.pos.x - z.pos.x, b.pos.z - z.pos.z);
      if (d < bestD && d < playerDist + 1.5) {
        bestD = d;
        best = b;
      }
    }
    return best ? { b: best, dist: bestD } : null;
  }

  private act(z: Zombie, p: PlayerSense, dist: number, dt: number, nb: { b: BanditTarget; dist: number } | null): void {
    if (z.swing > 0) z.swing -= dt;
    if (z.state === 'stagger') {
      z.timer -= dt;
      if (z.timer <= 0) z.state = z.awareness >= 1 ? 'chase' : 'investigate';
      return;
    }
    const targetDist = nb ? nb.dist : dist;
    const targetY = nb ? nb.b.pos.y : p.pos.y;
    // Attack: close, sees the target, on the same level.
    if (z.state === 'chase' && targetDist < T.reach && Math.abs(targetY - z.pos.y) < 1 && z.swing <= 0) {
      z.state = 'attack';
      z.timer = T.windup;
      this.sounds.push({ z, kind: 'swing' });
    }
    if (z.state === 'attack') {
      z.timer -= dt;
      if (z.timer <= 0) {
        const dmg = T.damage[0] + this.rnd() * (T.damage[1] - T.damage[0]);
        if (nb && nb.dist < T.reach + 0.25 && Math.abs(nb.b.pos.y - z.pos.y) < 1) {
          nb.b.hit(dmg, z.pos.x, z.pos.z);
        } else if (dist < T.reach + 0.2 && Math.abs(p.pos.y - z.pos.y) < 1) {
          this.attacks.push({ damage: dmg, from: z });
        }
        z.swing = T.cooldown;
        z.state = 'chase';
      }
      return;
    }
    // A closed door in the way (stuck in front of it while going somewhere): beat on it.
    if ((z.state === 'chase' || z.state === 'investigate') && z.stuck > 0.8 && this.world.doorNear) {
      const d = this.world.doorNear(z.pos.x, z.pos.y, z.pos.z, 1.4);
      if (d) {
        z.state = 'bang';
        z.door = d.ref;
        z.yaw = Math.atan2(d.x - z.pos.x, d.z - z.pos.z);
        z.swing = 0.3;
      }
    }
    if (z.state === 'bang') {
      if (z.swing <= 0) {
        z.swing = T.doorEvery * (0.85 + this.rnd() * 0.3);
        const broke = this.world.hitDoor?.(z.door, T.doorDamage[0] + this.rnd() * (T.doorDamage[1] - T.doorDamage[0])) ?? true;
        this.sounds.push({ z, kind: broke ? 'crack' : 'bang' });
        if (broke) {
          z.state = z.awareness >= 1 ? 'chase' : 'investigate';
          z.door = null;
          z.stuck = 0;
        }
      }
    }
  }

/**
   * Death: its AI, chasing, shoving and shudder stop at once; how it died is kept for its ragdoll (the
   * scene turns it into one this step).
   */
  private kill(z: Zombie, fromX: number, fromZ: number, damage: number, head: boolean, point: Vector3 | null, push = 1): void {
    z.death = { fromX, fromZ, damage, head, point: point?.clone() ?? null, phase: z.phase, gait: z.gait, speed: z.speed, push };
    z.state = 'dead';
    z.shake = 0;
    z.speed = 0;
    z.gait = 0;
    z.rest = false;
    z.diedAt = this.time;
    z.timer = T.corpse;
    this.sounds.push({ z, kind: 'die' });
    this.died.push(z);
  }

  /**
   * A blow or a shot from the player. Returns true if it killed. Shots: the head snaps back, a leg hit
   * makes it limp a while; `push` scales the ragdoll's impulse (the blast).
   */
  hit(z: Zombie, damage: number, fromX: number, fromZ: number, head = false, point: Vector3 | null = null, push = 1): boolean {
    if (z.state === 'dead') return false;
    z.hp -= damage;
    z.shake = 0.25;
    if (head) z.snap = true;
    if (point && !head && point.y < z.pos.y + 0.75 * ZombieSim.scale(z)) z.limp = 6;
    // Knocked back a little, away from the blow.
    const dx = z.pos.x - fromX;
    const dz = z.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    z.pos.x += (dx / d) * 0.25;
    z.pos.z += (dz / d) * 0.25;
    this.world.resolveCircle(z.pos, T.radius, T.height);
    z.awareness = 1.2;
    z.target.set(fromX, z.pos.y, fromZ);
    if (z.hp <= 0) {
      this.kill(z, fromX, fromZ, damage, head, point, push);
      if (z.twin) this.killedTwins.push(z);
      return true;
    }
    z.state = 'stagger';
    z.timer = 0.4;
    z.speed = 0;
    this.sounds.push({ z, kind: 'hit' });
    return false;
  }

  /**
   * What a swing from `o` along `dir` meets within `reach`: the nearest living zombie whose head
   * (a sphere) or body (an upright cylinder) the ray passes, a little forgiving (`slack`).
   */
  hitTest(o: Vector3, dir: Vector3, reach: number, slack = 0.12): HitResult | null {
    let best: HitResult | null = null;
    for (const z of this.list) {
      if (z.state === 'dead') continue;
      const s = ZombieSim.scale(z);
      // Head: sphere at the top.
      const f = KIND[z.kind].headFwd;
      const hc = _p.set(z.pos.x + Math.sin(z.yaw) * f, z.pos.y + 1.63 * s, z.pos.z + Math.cos(z.yaw) * f);
      const th = raySphere(o, dir, hc, 0.13 * s + slack * 0.5);
      if (th >= 0 && th <= reach && (!best || th < best.dist)) {
        best = { zombie: z, head: true, dist: th, point: o.clone().addScaledVector(dir, th) };
        continue;
      }
      // Body: vertical cylinder from the feet to the neck.
      const tb = rayCylinder(o, dir, z.pos, T.radius + slack, z.pos.y, z.pos.y + 1.5 * s);
      if (tb >= 0 && tb <= reach && (!best || tb < best.dist)) best = { zombie: z, head: false, dist: tb, point: o.clone().addScaledVector(dir, tb) };
    }
    return best;
  }

  // ── Movement ────────────────────────────────────────────────────────────────────────────────────

  private move(z: Zombie, dt: number, dist: number): void {
    const k = KIND[z.kind];
    let want = 0;
    if (z.state === 'chase') want = k.chase;
    else if (z.state === 'investigate') want = T.investigate * k.pace;
    else if (z.state === 'wander') want = T.wander * k.pace;
    else if (z.state === 'search') want = T.wander * 0.8 * k.pace;
    // Steering point: the world routes along stairs / to entrances; otherwise straight at the target.
    if (z.state !== 'search' || this.reached(z, 0.5)) {
      if (!(this.world.route?.(z.pos, z.target, z.steer) ?? false) && z.state !== 'search') z.steer.copy(z.target);
    }
    const dx = z.steer.x - z.pos.x;
    const dz = z.steer.z - z.pos.z;
    const d = Math.hypot(dx, dz);
    const go = want > 0 && d > (z.state === 'chase' ? 0.8 : 0.4) && !(z.state === 'chase' && dist < 0.9);
    if (z.limp > 0) want *= 0.5;
    z.speed += ((go ? want * z.pace : 0) - z.speed) * Math.min(1, dt * 3);
    if (go) {
      const yaw = Math.atan2(dx, dz);
      let dy = yaw - z.yaw;
      dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2));
      z.yaw += clamp(dy, -2.5 * dt, 2.5 * dt);
      if (d > z.lastDist - 0.02 * dt) z.stuck += dt;
      else z.stuck = Math.max(0, z.stuck - dt);
      z.lastDist = d;
      if (z.stuck > 2.5 && (z.state === 'wander' || z.state === 'search')) {
        const a = z.yaw + (this.rnd() < 0.5 ? 1 : -1) * (1 + this.rnd());
        z.target.set(z.pos.x + Math.sin(a) * 5, z.pos.y, z.pos.z + Math.cos(a) * 5);
        z.stuck = 0;
        z.lastDist = Infinity;
      }
    } else if (z.state === 'search') {
      // Looking around: the head and body turn one way, then the other.
      z.yaw = z.lookYaw + Math.sin(this.time * 0.9 + z.look) * 1.4;
    }
    if (z.speed > 0.01) {
      _p.copy(z.pos);
      z.pos.x += Math.sin(z.yaw) * z.speed * dt;
      z.pos.z += Math.cos(z.yaw) * z.speed * dt;
      this.world.resolveCircle(z.pos, T.radius, T.height);
      const before = z.phase;
      z.phase += (_p.distanceTo(z.pos) / PHASE_M) * Math.PI * 2;
      // A shuffle at every footfall (two per stride).
      if (dist < 15 && Math.floor(before / Math.PI) !== Math.floor(z.phase / Math.PI)) this.sounds.push({ z, kind: 'step' });
    }
    // Floors and stairs: the new height may be up or down at most a step from the old one.
    const gy = this.world.groundY(z.pos.x, z.pos.z, z.pos.y);
    z.pos.y = gy > z.pos.y + 0.6 ? z.pos.y : gy;
    z.gait += (clamp(z.speed / 0.8, 0, 1) - z.gait) * Math.min(1, dt * 4);
  }

  private separate(): void {
    const alive = this.aliveBuf;
    alive.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      const z = this.list[i];
      if (z.state !== 'dead') alive.push(z);
    }
    const min = T.radius * 2;
    const min2 = min * min;
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i].pos;
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j].pos;
        const dx = b.x - a.x;
        if (dx >= min || dx <= -min) continue;
        const dz = b.z - a.z;
        if (dz >= min || dz <= -min) continue;
        if (Math.abs(a.y - b.y) > 1.5) continue;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min2 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
        // Pushed into a wall? The walls win.
        this.world.resolveCircle(a, T.radius, T.height);
        this.world.resolveCircle(b, T.radius, T.height);
      }
    }
  }

  private populate(dt: number, p: PlayerSense, viewDir?: Vector3): void {
    this.popAccum += dt;
    if (this.popAccum >= 0.4) {
      this.popAccum = 0;
      const vLen = viewDir ? Math.max(1e-3, Math.hypot(viewDir.x, viewDir.z)) : 1;
      // Bodies go only where the player can't see it happen: too many of them (oldest first), or old ones.
      const unseen = (z: Zombie) => {
        const dx = z.pos.x - p.pos.x;
        const dz = z.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        return d > 30 || !viewDir || (dx * viewDir.x + dz * viewDir.z) / (d * vLen) < 0.2;
      };
      const bodies = this.corpseBuf;
      bodies.length = 0;
      for (let i = 0; i < this.list.length; i++) {
        const z = this.list[i];
        if (z.state === 'dead' && !z.twin) bodies.push(z);
      }
      if (bodies.length > 1) bodies.sort((a, b) => a.diedAt - b.diedAt);
      let over = bodies.length - T.maxCorpses;
      for (let k = 0; k < bodies.length; k++) {
        const z = bodies[k];
        const old = this.time - z.diedAt > T.corpse;
        if ((over > 0 || old) && unseen(z)) {
          const ix = this.list.indexOf(z);
          if (ix >= 0) this.list.splice(ix, 1);
          this.removed.push(z);
          over--;
        }
      }
      const despawn2 = T.despawn * T.despawn;
      for (let i = this.list.length - 1; i >= 0; i--) {
        const z = this.list[i];
        if (z.twin || z.state === 'chase') continue;
        const dx = z.pos.x - p.pos.x;
        const dz = z.pos.z - p.pos.z;
        if (dx * dx + dz * dz > despawn2) {
          this.list.splice(i, 1);
          if (z.state === 'dead') this.removed.push(z);
        }
      }
    }
    this.spawnTimer -= dt;
    if (this.alive >= this.target || this.spawnTimer > 0) return;
    this.spawnTimer = 0.25;
    const r = this.rnd;
    for (let tries = 0; tries < 6; tries++) {
      const a = r() * Math.PI * 2;
      const d = T.spawnMin + r() * (T.spawnMax - T.spawnMin);
      const x = p.pos.x + Math.cos(a) * d;
      const z = p.pos.z + Math.sin(a) * d;
      if (viewDir && d < T.spawnMax * 0.8) {
        const c = (Math.cos(a) * viewDir.x + Math.sin(a) * viewDir.z) / Math.max(1e-3, Math.hypot(viewDir.x, viewDir.z));
        if (c > 0.3) continue;
      }
      if (this.world.indoors?.(x, z)) continue;
      _hit.set(x, this.world.groundY(x, z, 0), z);
      this.world.resolveCircle(_hit, T.radius, T.height);
      if (Math.hypot(_hit.x - x, _hit.z - z) > 0.01) continue;
      this.spawnAt(x, z, r() < 0.4 ? 'wander' : 'idle');
      return;
    }
  }
}


/** Damage of one blow: the weapon's range (min–max, `roll` 0..1), the class's strength, double on the head. */
export function blowDamage(range: readonly [number, number], strength: number, head: boolean, roll: number): number {
  return (range[0] + roll * (range[1] - range[0])) * strength * (head ? 2 : 1);
}

/** Distance along a ray (unit dir) to a sphere, or −1. */
function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc < 0 ? 0 : -1;
}

/** Distance along a ray to an upright cylinder (axis through `c`, from y0 to y1), or −1. */
function rayCylinder(o: Vector3, d: Vector3, c: Vector3, r: number, y0: number, y1: number): number {
  const ox = o.x - c.x;
  const oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return -1;
  const b = ox * d.x + oz * d.z;
  const cc = ox * ox + oz * oz - r * r;
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  let t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) t = cc < 0 ? 0 : -1;
  if (t < 0) return -1;
  const y = o.y + d.y * t;
  return y >= y0 && y <= y1 ? t : -1;
}
