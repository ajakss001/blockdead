import { type AmmoId, capacityOf, type FireMode, GUNS, type GunConfig, type GunId, type ModId } from './guns';

/**
 * One gun's logic, no meshes (the scene fires it, the viewmodel animates it, test:guns checks it).
 *
 * The rounds: `mag` in the magazine / tube / internal magazine, `chamber` the one ready to fire. A shot
 * empties the chamber; a self-loader chambers the next from the magazine by itself, the pump and the bolt
 * after their stroke (`cycle`). A pistol fired dry stays open (`open`: the slide back).
 * Reloading takes rounds from the inventory (`AmmoSource`):
 *  - tactical (a round in the chamber): the new magazine full, the chamber kept — capacity + 1;
 *  - from empty: slower; the old magazine falls to the floor, a spare one from the inventory goes in (none: the
 *    same one refilled, slower still), then the action is worked — capacity, no more;
 *  - tube / internal magazine: a round at a time; a pull of the trigger stops it after the round in hand;
 *  - the RPG: one rocket at the muzzle.
 * Worn past 70%, it jams now and then: the trigger only clicks until the jam is cleared (R: slap, rack).
 */

export interface GunInst {
  mag: number;
  chamber: boolean;
  mods: ModId[];
  mode: FireMode;
  jammed: boolean;
  /** Worn 0..1 (shots over durability). */
  wear: number;
}

export function newInst(id: GunId, loaded = 0): GunInst {
  const g = GUNS[id];
  const n = Math.min(loaded, g.capacity + (g.feed === 'mag' ? 1 : 0));
  const chamber = n > 0;
  return { mag: Math.max(0, n - 1), chamber, mods: [], mode: g.modes[0], jammed: false, wear: 0 };
}

export interface AmmoSource {
  count(id: AmmoId): number;
  /** Takes up to n; returns how many it took. */
  take(id: AmmoId, n: number): number;
  give(id: AmmoId, n: number): void;
  /** Spare magazines of the gun's kind: the inventory's count, taking one. */
  spareMags(): number;
  takeMag(): boolean;
}

export type GunAction = 'idle' | 'draw' | 'holster' | 'cycle' | 'reload' | 'reloadEmpty' | 'loadStart' | 'loadOne' | 'loadEnd' | 'unjam' | 'inspect' | 'mode' | 'bash';

/** What happened this step (sounds, effects, the hands). */
export type GunEvent =
  | { kind: 'shot'; burst: number }
  | { kind: 'dry' }
  | { kind: 'jam' }
  | { kind: 'cycle' }
  | { kind: 'casing' }
  | { kind: 'magOut'; drop: boolean }
  | { kind: 'magIn' }
  | { kind: 'rack' }
  | { kind: 'shellIn' }
  | { kind: 'rocketIn' }
  | { kind: 'mode'; mode: FireMode }
  | { kind: 'unjammed' }
  | { kind: 'bash' }
  | { kind: 'start'; action: GunAction; duration: number };

export interface GunInput {
  /** The trigger held / pulled this step. */
  trigger: boolean;
  pulled: boolean;
  reload: boolean;
  mode: boolean;
  inspect: boolean;
  bash: boolean;
  /** Not sprinting, not against a wall, not busy. */
  canFire: boolean;
}

/** Of a reload action, when (share of its time) the magazine leaves, the new one is in, the action is worked. */
export const RELOAD_MARKS = { out: 0.28, in: 0.62, rack: 0.85 };

export class GunState {
  readonly cfg: GunConfig;
  action: GunAction = 'draw';
  /** Seconds into the action and its length. */
  t = 0;
  duration: number;
  /** Seconds until the next shot may go. */
  private cooldown = 0;
  /** Shots in this pull of the trigger (auto: the climb). */
  burst = 0;
  /** The pump / bolt is due after this shot (starts a beat after it). */
  private cycleDue = -1;
  /** One at a time: a pull of the trigger stops the loading after the round in hand. */
  private stopLoading = false;
  /** That pull fires as soon as the loading is done (the shell in hand goes in first). */
  private queued = false;
  /** The marks of the current action already passed. */
  private marks = 0;
  /** From empty with no spare magazine: the same one refilled. */
  private refill = false;
  /** Times: the class's handling (×1 / faster). */
  speed = 1;

  constructor(
    readonly id: GunId,
    readonly inst: GunInst,
    private readonly ammo: AmmoSource,
  ) {
    this.cfg = GUNS[id];
    this.duration = this.cfg.times.draw;
  }

  get capacity(): number {
    return capacityOf(this.id, this.inst.mods);
  }

  /** Rounds ready: magazine + chamber. */
  get loaded(): number {
    return this.inst.mag + (this.inst.chamber ? 1 : 0);
  }

  /** The pistol's slide stays back: fired dry. */
  get open(): boolean {
    return this.cfg.cls === 'pistol' && !this.inst.chamber && this.action !== 'reloadEmpty';
  }

  get busy(): boolean {
    return this.action !== 'idle';
  }

  /** Put it away: the holster animation, then the scene swaps. */
  holster(): void {
    this.start('holster', this.cfg.times.holster);
  }

  get done(): boolean {
    return this.action === 'holster' && this.t >= this.duration;
  }

  update(dt: number, inp: GunInput): GunEvent[] {
    const ev: GunEvent[] = [];
    const g = this.cfg;
    this.cooldown -= dt;
    if (!inp.trigger) this.burst = 0;
    if (this.action !== 'idle') {
      this.t += dt * this.speed;
      this.runMarks(ev);
      if (this.t >= this.duration && this.action !== 'holster') this.finish(ev);
    }
    // A pull of the trigger while loading one at a time: stop after this round.
    if (inp.pulled && (this.action === 'loadOne' || this.action === 'loadStart')) {
      this.stopLoading = true;
      this.queued = true;
    }
    if (this.cycleDue >= 0) {
      this.cycleDue -= dt;
      if (this.cycleDue < 0 && this.action === 'idle') this.start('cycle', g.times.cycle ?? 0.5, ev);
    }
    if (this.action !== 'idle') return ev;

    if (inp.reload) {
      if (this.inst.jammed) this.start('unjam', g.times.unjam, ev);
      else this.startReload(ev);
      return ev;
    }
    if (inp.mode && g.modes.length > 1) {
      const i = g.modes.indexOf(this.inst.mode);
      this.inst.mode = g.modes[(i + 1) % g.modes.length];
      this.start('mode', g.times.mode, ev);
      ev.push({ kind: 'mode', mode: this.inst.mode });
      return ev;
    }
    if (inp.inspect) {
      this.start('inspect', g.times.inspect, ev);
      return ev;
    }
    if (inp.bash) {
      this.start('bash', 0.55, ev);
      return ev;
    }
    const wants = this.inst.mode === 'auto' ? inp.trigger : inp.pulled || this.queued;
    if (wants && inp.canFire && this.cooldown <= 0) {
      this.queued = false;
      this.fire(ev);
    }
    return ev;
  }

  private fire(ev: GunEvent[]): void {
    const g = this.cfg;
    const inst = this.inst;
    this.cooldown = 60 / g.rpm;
    if (!inst.chamber || inst.jammed) {
      // Dry: one click a pull.
      if (this.burst === 0) ev.push({ kind: inst.jammed ? 'jam' : 'dry' });
      this.burst = 1;
      this.cooldown = 0.25;
      return;
    }
    inst.chamber = false;
    this.burst++;
    inst.wear = Math.min(1, inst.wear + 1 / g.durability);
    ev.push({ kind: 'shot', burst: this.burst });
    if (g.action === 'auto') {
      ev.push({ kind: 'casing' });
      if (inst.mag > 0) {
        inst.mag--;
        inst.chamber = true;
        // Worn: the next one may not feed.
        if (Math.random() < jamChance(inst.wear)) {
          inst.jammed = true;
        }
      }
    } else if (g.action === 'pump' || g.action === 'bolt') this.cycleDue = 0.12;
  }

  private startReload(ev: GunEvent[]): void {
    const g = this.cfg;
    const inst = this.inst;
    const have = this.ammo.count(g.caliber);
    if (g.feed === 'rocket') {
      if (!inst.chamber && have > 0) this.start('reload', g.times.reload, ev);
      return;
    }
    if (g.feed === 'tube' || g.feed === 'internal') {
      if (inst.mag >= this.capacity || have <= 0) {
        // Full (or nothing to load): a pump / bolt with an empty chamber still chambers one.
        if (!inst.chamber && inst.mag > 0) this.start('cycle', g.times.cycle ?? 0.5, ev);
        return;
      }
      this.stopLoading = false;
      this.start('loadStart', g.times.loadStart ?? 0.3, ev);
      return;
    }
    // Detachable magazine.
    if (inst.mag >= this.capacity && inst.chamber) return;
    if (have <= 0 && inst.mag === 0) return;
    if (inst.chamber) this.start('reload', g.times.reload, ev);
    else {
      this.refill = this.ammo.spareMags() <= 0;
      this.start('reloadEmpty', g.times.reloadEmpty * (this.refill ? 1.3 : 1), ev);
    }
  }

  private start(a: GunAction, d: number, ev?: GunEvent[]): void {
    this.action = a;
    this.t = 0;
    this.duration = d;
    this.marks = 0;
    ev?.push({ kind: 'start', action: a, duration: d / this.speed });
  }

  /** The magazine out / in / the action worked at their moments of a reload. */
  private runMarks(ev: GunEvent[]): void {
    const a = this.action;
    const k = this.t / this.duration;
    if (a === 'bash' && this.marks === 0 && k >= GunState.BASH_HIT) {
      this.marks = 1;
      ev.push({ kind: 'bash' });
    }
    if (a !== 'reload' && a !== 'reloadEmpty' && a !== 'unjam') return;
    const marks = a === 'unjam' ? [0.3, 1.1, 0.7] : [RELOAD_MARKS.out, RELOAD_MARKS.in, a === 'reloadEmpty' ? RELOAD_MARKS.rack : 2];
    if (this.cfg.feed === 'rocket') {
      if (this.marks === 0 && k >= RELOAD_MARKS.in) {
        this.marks = 3;
        ev.push({ kind: 'rocketIn' });
      }
      return;
    }
    if (this.marks === 0 && k >= marks[0]) {
      this.marks = 1;
      if (a === 'unjam') ev.push({ kind: 'magIn' });
      else ev.push({ kind: 'magOut', drop: a === 'reloadEmpty' && !this.refill });
    }
    if (this.marks === 1 && a !== 'unjam' && k >= marks[1]) {
      this.marks = 2;
      ev.push({ kind: 'magIn' });
    }
    if (this.marks < 3 && k >= marks[2]) {
      this.marks = 3;
      ev.push({ kind: 'rack' });
    }
  }

  private finish(ev: GunEvent[]): void {
    const g = this.cfg;
    const inst = this.inst;
    const a = this.action;
    this.action = 'idle';
    switch (a) {
      case 'cycle':
        ev.push({ kind: 'cycle' }, { kind: 'casing' });
        if (inst.mag > 0) {
          inst.mag--;
          inst.chamber = true;
        }
        break;
      case 'reload': {
        if (g.feed === 'rocket') {
          if (this.ammo.take(g.caliber, 1) > 0) inst.chamber = true;
          break;
        }
        // The rounds left in the old magazine go back to the pouch; a full one in, the chamber kept.
        this.ammo.give(g.caliber, inst.mag);
        inst.mag = this.ammo.take(g.caliber, this.capacity);
        break;
      }
      case 'reloadEmpty': {
        this.ammo.give(g.caliber, inst.mag);
        if (!this.refill) this.ammo.takeMag();
        inst.mag = this.ammo.take(g.caliber, this.capacity);
        // The action worked: one from the magazine into the chamber.
        if (inst.mag > 0) {
          inst.mag--;
          inst.chamber = true;
        }
        break;
      }
      case 'loadStart':
      case 'loadOne':
        if (a === 'loadOne' && this.ammo.take(g.caliber, 1) > 0) {
          inst.mag++;
          ev.push({ kind: 'shellIn' });
        }
        if (!this.stopLoading && inst.mag < this.capacity && this.ammo.count(g.caliber) > 0) this.start('loadOne', g.times.loadOne ?? 0.5, ev);
        else this.start('loadEnd', g.times.loadEnd ?? 0.3, ev);
        break;
      case 'loadEnd':
        // An empty chamber: the pump / bolt chambers one.
        if (!inst.chamber && inst.mag > 0) this.start('cycle', g.times.cycle ?? 0.5, ev);
        break;
      case 'unjam':
        inst.jammed = false;
        ev.push({ kind: 'unjammed' });
        // The round that would not feed is thrown out with the rack.
        if (inst.chamber) {
          inst.chamber = false;
          if (inst.mag > 0) {
            inst.mag--;
            inst.chamber = true;
          }
        }
        break;
      case 'bash':
        break;
      default:
        break;
    }
  }

  /** The butt strike lands at this share of its time. */
  static readonly BASH_HIT = 0.35;
}

/** A worn gun jams: nothing to 70% wear, then up to one in ten at the end. */
export function jamChance(wear: number): number {
  return wear < 0.7 ? 0 : ((wear - 0.7) / 0.3) * 0.1;
}
