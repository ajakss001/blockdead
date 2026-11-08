import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameLoop } from '../core/GameLoop';
import { type SampleGroup, Samples } from './samples';

/*
 * Game sound, synthesized with WebAudio, and a few recorded sounds over it (src/audio/samples: the melee
 * swing and metal hits, the RPG's blast, the dry click, the action's rattle, cases and magazines on the floor,
 * a bullet on metal, zombie screams, breaths, lunges and deaths — loaded lazily after the first gesture, ≈ 0.5
 * MB; until they come, or without them, the synthesis plays). One AudioContext for the whole game:
 *
 *   world bus ─┬─────────────────────────────► master ─► speakers
 *              └─► reverb send ─► convolver ─┘
 *   ui bus ────────────────────────────────► master
 *
 * - world: footsteps, hits, doors, containers, ambience. Muted on any pause (menus, inventory, ads).
 * - ui: inventory, items, drag and drop — heard while the inventory pauses the world.
 * - master: the volume slider; silent and the context suspended while the tab is hidden or an ad
 *   plays (Yandex Games / VK requirement).
 * World sounds are positional (PannerNode, equal-power, inverse distance) around the camera; at most
 * MAX_VOICES play at once, extra ones are dropped. Groups keep a crowd from piling up: a few zombie
 * voices at a time, starts spaced apart, one "I'm hit" per moment; blows (ours and theirs) have slots of
 * their own past the cap, so a choir of moans never swallows them. The reverb send follows where you are (rooms and
 * alleys ring, open streets don't).
 */

export type StepSurface = 'asphalt' | 'concrete' | 'tile' | 'wood' | 'metal' | 'glass' | 'grass' | 'water';
/** Continuous sounds of the buildings, played by the nearest few spots (see `loops`). */
export type LoopKind = 'fridge' | 'tv' | 'flies' | 'fire' | 'hiss' | 'rainTin' | 'siren' | 'speaker' | 'bell' | 'music' | 'sparks';
/** Loud loops carry far (and draw the zombies, see Street). */
export const LOUD_LOOPS: readonly LoopKind[] = ['siren', 'speaker', 'bell', 'music'];
export type Gait = 'walk' | 'run' | 'crouch';
export type HitMaterial = 'wood' | 'metal' | 'concrete' | 'glass' | 'soft';
export type ContainerSound = 'woodDoor' | 'drawer' | 'locker' | 'fridge' | 'trunk' | 'bag' | 'box' | 'trash' | 'crate' | 'shelf';
export type ItemSound = 'click' | 'pick' | 'move' | 'cloth' | 'weapon' | 'eat' | 'drink' | 'bandage' | 'invOpen' | 'invClose' | 'drag' | 'drop';
export type SwingKind = 'heavy' | 'blade' | 'fist';
/** What a blow on a body sounds like: a club, a metal tool, an axe, a blade's point, a fist. */
export type FleshBlow = 'blunt' | 'metal' | 'chop' | 'stab' | 'fist';
/** Guns by how they sound: the report, its crack and boom. */
export type GunSound = 'pistol' | 'pistol45' | 'rifle' | 'ak' | 'shotgun' | 'hunting' | 'rpg';
/** The gun's mechanics in the hands. */
export type GunMech = 'magOut' | 'magIn' | 'rack' | 'slideLock' | 'boltCatch' | 'pump' | 'bolt' | 'shell' | 'rocket' | 'mode' | 'dry' | 'jam' | 'draw' | 'holster' | 'lastRounds';
/** Where the shot rings: indoors (short, dense), a street (one late slap), an alley (fluttering). */
export type EchoPlace = 'indoor' | 'street' | 'alley';
/** What a bullet hits. */
export type BulletHit = 'concrete' | 'metal' | 'wood' | 'glass' | 'car' | 'flesh' | 'soft';
/** A zombie's blow on the survivor: stopped by the clothes, a scratch, a bite. */
export type Attacked = 'blocked' | 'scratch' | 'bite';

export interface Pos {
  x: number;
  y: number;
  z: number;
}

const MAX_VOICES = 22;
/** Blows get this many voices past MAX_VOICES. */
const PRIORITY_VOICES = 6;
/** Continuous building sounds playing at once (the nearest). */
const LOOP_SLOTS = 4;

interface LoopSlot {
  key: number;
  kind: LoopKind;
  gain: GainNode;
  panner: PannerNode;
  sources: AudioScheduledSourceNode[];
  /** Flies: the buzz's pitch, wandering. */
  buzz?: OscillatorNode;
}
/**
 * Sound groups: at most `max` playing at once, starts at least `gap` s apart (in a crowd one more snarl
 * on top of five is noise, not a sound).
 */
const GROUPS = {
  zVoice: { max: 4, gap: 0.07 },
  zLunge: { max: 2, gap: 0.15 },
  zHurt: { max: 2, gap: 0.05 },
  zStep: { max: 4, gap: 0.04 },
  zBang: { max: 2, gap: 0.12 },
  strike: { max: 2, gap: 0.06 },
  attacked: { max: 1, gap: 0.22 },
  drip: { max: 3, gap: 0.05 },
  house: { max: 2, gap: 0.3 },
  street: { max: 3, gap: 0.12 },
  ouch: { max: 1, gap: 0.35 },
} as const;
type Group = keyof typeof GROUPS;
/** Soft clipping for throats (growls): tanh-like. */
const DISTORT = (() => {
  const n = 1024;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * 3.2);
  }
  return c;
})();
const VOLUME_KEY = 'blockdead.volume';

/** Container type (data/loot) → the sound of opening it and of rummaging inside. */
export const CONTAINER_SOUND: Record<string, ContainerSound> = {
  fridge: 'fridge',
  cooler: 'fridge',
  counter: 'woodDoor',
  wardrobe: 'woodDoor',
  tvstand: 'woodDoor',
  bookcase: 'woodDoor',
  nightstand: 'drawer',
  desk: 'drawer',
  reception: 'drawer',
  shopCounter: 'drawer',
  cafe: 'drawer',
  cabinet: 'locker',
  mailboxes: 'locker',
  laundry: 'locker',
  trunk: 'trunk',
  gasShelf: 'shelf',
  gasCounter: 'drawer',
  garage: 'drawer',
  policeLocker: 'locker',
  policeDesk: 'drawer',
  armory: 'locker',
  superShelf: 'shelf',
  clothesRack: 'woodDoor',
  warehouse: 'crate',
  plantStore: 'locker',
  militaryCrate: 'crate',
  baseArmory: 'crate',
  bodyZombie: 'bag',
  labLocker: 'locker',
  labBench: 'drawer',
  labFridge: 'fridge',
  labDesk: 'drawer',
  serverRack: 'locker',
  labTools: 'locker',
  isolation: 'locker',
  generator: 'locker',
  checkin: 'drawer',
  planeCabin: 'trunk',
  cargoHold: 'crate',
  militaryLocker: 'locker',
  canteen: 'drawer',
  vehicleCabin: 'trunk',
  campStash: 'crate',
  stash: 'crate',
  suitcase: 'bag',
  bodyMilitary: 'bag',
  bodyPolice: 'bag',
  bodyMedic: 'bag',
  bodyFire: 'bag',
  boxes: 'box',
  trash: 'trash',
  crate: 'crate',
  shelf: 'shelf',
  pharmacy: 'shelf',
};

type Out = AudioNode;

class Sound {
  ac: AudioContext | null = null;
  private master: GainNode | null = null;
  world: GainNode | null = null;
  private ui: GainNode | null = null;
  /** The world bus's low-pass (dying: everything goes dull and far). */
  private muffle: BiquadFilterNode | null = null;
  private samples: Samples | null = null;
  private send: GainNode | null = null;
  noise: AudioBuffer | null = null;
  private voices = 0;
  /** Per group: when its playing sounds end (context time). */
  private readonly groupEnds = new Map<Group, number[]>();
  private readonly groupLast = new Map<Group, number>();
  private volume = Number(localStorage.getItem(VOLUME_KEY) ?? 0.8);
  private hardMute = false;
  private worldMute = false;
  private search: { kind: ContainerSound; pos: Pos; t: number } | null = null;
  private readonly loopSlots: LoopSlot[] = [];

  /** Wire to the game: unlock on the first gesture, mute with the pause reasons. */
  attach(events: EventBus<GameEvents>, loop: GameLoop): void {
    const unlock = () => {
      this.ensure();
      if (!this.hardMute) void this.ac?.resume();
    };
    for (const e of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(e, unlock);
    const sync = () => {
      const reasons = (loop as unknown as { reasons: Set<string> }).reasons;
      this.hardMute = reasons.has('hidden') || reasons.has('ad');
      this.worldMute = loop.paused;
      this.apply();
    };
    events.on('loop:pause', sync);
    events.on('loop:resume', sync);
  }

  get level(): number {
    return this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    localStorage.setItem(VOLUME_KEY, String(this.volume));
    this.apply();
  }

  /** 0 clear … 1 the world heard as if from far under water (dying). */
  setMuffle(k: number): void {
    if (!this.ac || !this.muffle) return;
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(0.012, k), this.ac.currentTime, 0.1);
  }

  /** Reverb amount for where the listener is: 0 open field … 0.4 a bare room. */
  setRoom(wet: number): void {
    if (this.ac && this.send) this.send.gain.setTargetAtTime(wet, this.ac.currentTime, 0.4);
  }

  /** Listener at the camera (call every frame). */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const l = this.ac?.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ac!.currentTime;
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // ── Game sounds ────────────────────────────────────────────────────────────

  step(surface: StepSurface, gait: Gait, pos: Pos, loud = 1): void {
    const v = this.voice(pos, 0.25);
    if (!v) return;
    const [out, t] = v;
    const g = (gait === 'run' ? 1 : gait === 'walk' ? 0.55 : 0.22) * loud;
    const soft = gait === 'crouch' ? 0.6 : 1;
    const j = 0.85 + Math.random() * 0.3;
    switch (surface) {
      case 'asphalt':
        this.noiseHit(out, t, { type: 'lowpass', f: 1100 * soft * j, dur: 0.09, peak: 0.5 * g });
        this.noiseHit(out, t, { type: 'bandpass', f: 3200 * j, q: 1, dur: 0.025, peak: 0.12 * g });
        break;
      case 'concrete':
        this.noiseHit(out, t, { type: 'bandpass', f: 1500 * soft * j, q: 0.9, dur: 0.07, peak: 0.55 * g });
        this.noiseHit(out, t, { type: 'highpass', f: 5000, dur: 0.015, peak: 0.1 * g });
        break;
      case 'tile':
        this.noiseHit(out, t, { type: 'bandpass', f: 2400 * soft * j, q: 1.2, dur: 0.05, peak: 0.5 * g });
        this.tone(out, t, { f: 1700 * j, dur: 0.03, peak: 0.05 * g });
        break;
      case 'wood':
        this.noiseHit(out, t, { type: 'bandpass', f: 600 * j, q: 1.4, dur: 0.09, peak: 0.6 * g });
        this.tone(out, t, { f: 150 * j, f2: 110, dur: 0.12, peak: 0.35 * g });
        if (Math.random() < 0.15) this.tone(out, t + 0.05, { f: 310, f2: 345, dur: 0.22, peak: 0.04 * g, type: 'sawtooth', lp: 900 });
        break;
      case 'metal':
        this.noiseHit(out, t, { type: 'bandpass', f: 2000 * j, q: 1, dur: 0.05, peak: 0.4 * g });
        for (const f of [540, 870, 1310]) this.tone(out, t, { f: f * j, dur: 0.3, peak: 0.07 * g });
        break;
      case 'glass':
        this.noiseHit(out, t, { type: 'lowpass', f: 900, dur: 0.07, peak: 0.3 * g });
        for (let i = 0; i < 5; i++) this.noiseHit(out, t + Math.random() * 0.07, { type: 'highpass', f: 4500 + Math.random() * 2500, dur: 0.012, peak: 0.25 * g });
        break;
      case 'grass':
        this.noiseHit(out, t, { type: 'lowpass', f: 650 * j, dur: 0.14, peak: 0.45 * g, attack: 0.02 });
        this.noiseHit(out, t + 0.02, { type: 'highpass', f: 3500, dur: 0.1, peak: 0.06 * g, attack: 0.02 });
        break;
      case 'water':
        // A foot in a puddle: a slap, a splash, a few drops falling back.
        this.noiseHit(out, t, { type: 'lowpass', f: 500 * j, dur: 0.08, peak: 0.35 * g });
        this.noiseHit(out, t + 0.01, { type: 'bandpass', f: 1400 * j, f2: 700, q: 1.2, dur: 0.16, peak: 0.35 * g, attack: 0.01 });
        for (let i = 0; i < 3; i++) this.tone(out, t + 0.08 + Math.random() * 0.12, { f: 1200 + Math.random() * 900, f2: 2200, dur: 0.035, peak: 0.04 * g });
        break;
    }
  }

  // ── The buildings ──────────────────────────────────────────────────────────

  /** A drop hitting a puddle (or, `tap`, a steel sink): a short rising plink, the room rings with it. */
  drip(pos: Pos, tap = false): void {
    if (!this.claim('drip', 0.3)) return;
    const v = this.voice(pos, 0.3, 1.2);
    if (!v) return;
    const [out, t] = v;
    const f = (tap ? 1500 : 850) * (0.85 + Math.random() * 0.3);
    this.tone(out, t, { f, f2: f * (tap ? 1.4 : 2.1), dur: tap ? 0.05 : 0.07, peak: tap ? 0.07 : 0.1 });
    this.noiseHit(out, t, { type: 'bandpass', f: tap ? 4000 : 2500, q: 3, dur: 0.02, peak: 0.05 });
  }

  /**
   * The building's own noises (one at a time): a pipe knocking or groaning in the wall, a floor
   * creaking, someone's steps on the floor above — muffled, a few slow paces, then nothing.
   */
  house(kind: 'pipe' | 'creak' | 'above', pos: Pos): void {
    if (!this.claim('house', kind === 'above' ? 4 : 1.6)) return;
    const v = this.voice(pos, kind === 'above' ? 4 : 1.8, 2.5);
    if (!v) return;
    const [out, t] = v;
    const r = Math.random();
    if (kind === 'pipe') {
      if (r < 0.5) {
        // Knocks: water hammer, ringing dull metal, dying away.
        const n = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const at = t + i * (0.11 + Math.random() * 0.07);
          const k = 1 - i / (n + 1);
          this.noiseHit(out, at, { type: 'lowpass', f: 380, dur: 0.06, peak: 0.25 * k });
          this.tone(out, at, { f: 210 + r * 80, dur: 0.18, peak: 0.07 * k, type: 'triangle' });
        }
      } else {
        // A groan: the pipe moaning as the pressure shifts.
        this.tone(out, t, { f: 70 + r * 30, f2: 55 + r * 25, dur: 1.4, peak: 0.08, type: 'sawtooth', lp: 260, vibrato: 7 });
        this.noiseHit(out, t + 0.2, { type: 'lowpass', f: 300, f2: 120, dur: 1.0, peak: 0.05, attack: 0.3 });
      }
    } else if (kind === 'creak') {
      this.creak(out, t, 0.5 + r * 0.6, 0.6 + r * 0.3);
    } else {
      // Paces upstairs: heavy, slow, muffled by the floor between.
      const n = 4 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const at = t + i * (0.55 + Math.random() * 0.1);
        this.noiseHit(out, at, { type: 'lowpass', f: 170, dur: 0.12, peak: 0.45 });
        this.tone(out, at, { f: 62, dur: 0.1, peak: 0.25 });
      }
      if (r < 0.4) this.creak(out, t + n * 0.6, 0.6, 0.5);
    }
  }

  /** A door swung shut by a draught: slow, creaking all the way if it creaks, a soft latch at the end. */
  draftDoor(pos: Pos, dur: number, creaky: boolean, pitch: number): void {
    const v = this.voice(pos, dur + 0.5);
    if (!v) return;
    const [out, t] = v;
    if (creaky) this.creak(out, t + 0.1, dur * 0.9, pitch * 0.85);
    else this.noiseHit(out, t + 0.1, { type: 'bandpass', f: 500, q: 0.8, dur: dur * 0.8, peak: 0.02, attack: dur * 0.4 });
    this.noiseHit(out, t + dur, { type: 'lowpass', f: 400 * pitch, dur: 0.08, peak: 0.35 });
    this.tone(out, t + dur, { f: 120 * pitch, f2: 90, dur: 0.08, peak: 0.12 });
  }

  /** Crows: `n` caws from a flock (one when idle, a racket when they take off). */
  crow(pos: Pos, n: number): void {
    if (!this.claim('street', n > 1 ? 1.5 : 0.5)) return;
    const v = this.voice(pos, 0.4 + n * 0.28, 3);
    if (!v) return;
    const [out, t] = v;
    for (let i = 0; i < n; i++) {
      const at = t + i * (0.18 + Math.random() * 0.15);
      const f = 520 + Math.random() * 180;
      // A harsh, nasal "kraa": a buzzy voice through a high resonance, dropping.
      this.growl(out, at, { f, f2: f * 0.8, dur: 0.22 + Math.random() * 0.08, peak: 0.16, flutter: 70 + Math.random() * 30, form: 1300 + Math.random() * 300, form2: 1000, breath: 0.4, attack: 0.01 });
    }
    // Wings beating as they lift.
    if (n > 1) for (let i = 0; i < 6; i++) this.noiseHit(out, t + i * 0.07, { type: 'bandpass', f: 700, q: 0.8, dur: 0.05, peak: 0.08 });
  }

  /** A car alarm right here: whoops or two-tone for `dur` s, honking, loud — it carries. */
  carAlarm(pos: Pos, dur: number): void {
    const v = this.voice(pos, dur + 0.5, 7);
    if (!v) return;
    const [out, t] = v;
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = 'square';
    const gate = ac.createGain();
    const pattern = Math.floor(Math.random() * 3);
    for (let k = 0; k * 0.3 < dur; k++) {
      const at = t + k * 0.3;
      if (pattern === 0) osc.frequency.setValueAtTime(k % 2 ? 640 : 880, at);
      else if (pattern === 1) {
        osc.frequency.setValueAtTime(480, at);
        osc.frequency.linearRampToValueAtTime(1050, at + 0.28);
      } else {
        osc.frequency.setValueAtTime(420, at);
        gate.gain.setValueAtTime(k % 2 ? 0 : 1, at);
      }
    }
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    env.gain.setValueAtTime(0.12, t + dur - 0.2);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gate).connect(lp).connect(env).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Small street noises: a rat's squeak, a cart's wheel, loose sheet metal rattling, a sign creaking. */
  street(kind: 'squeak' | 'cart' | 'rattle' | 'sign', pos: Pos): void {
    if (!this.claim('street', 0.6)) return;
    const v = this.voice(pos, kind === 'sign' ? 1.4 : 0.7, kind === 'rattle' ? 3 : 1.5);
    if (!v) return;
    const [out, t] = v;
    const r = Math.random();
    if (kind === 'squeak') {
      for (let i = 0; i < 2 + Math.floor(r * 3); i++) this.tone(out, t + i * 0.09, { f: 3200 + Math.random() * 1200, f2: 4200, dur: 0.05, peak: 0.05 });
    } else if (kind === 'cart') {
      this.tone(out, t, { f: 1700 + r * 500, f2: 2100, dur: 0.12, peak: 0.03, type: 'sawtooth', lp: 3000 });
      this.noiseHit(out, t, { type: 'bandpass', f: 2500, q: 2, dur: 0.06, peak: 0.05 });
    } else if (kind === 'rattle') {
      // Sheet metal flapping in the wind: a run of tinny bangs.
      for (let i = 0; i < 3 + Math.floor(r * 5); i++) {
        const at = t + i * (0.05 + Math.random() * 0.09);
        this.noiseHit(out, at, { type: 'bandpass', f: 1800 + Math.random() * 800, q: 3, dur: 0.06, peak: 0.12 });
        this.tone(out, at, { f: 600 + Math.random() * 400, dur: 0.12, peak: 0.03, type: 'triangle' });
      }
    } else this.creak(out, t, 0.9 + r * 0.4, 0.45 + r * 0.2);
  }

  /** One ring of an old phone: a bell trilling twice. */
  phoneRing(pos: Pos): void {
    const v = this.voice(pos, 2.2, 2);
    if (!v) return;
    const [out, t] = v;
    for (const at of [0, 0.5]) {
      for (let k = 0; k < 16; k++) {
        const bt = t + at + k * 0.025;
        this.tone(out, bt, { f: 1180, dur: 0.05, peak: 0.05 });
        this.tone(out, bt, { f: 1650, dur: 0.05, peak: 0.035 });
      }
    }
  }

  /**
   * Continuous sounds — a fridge humming, a TV hissing static, flies over the trash: the nearest
   * LOOP_SLOTS of `list` (sorted, nearest first) play from where they are, the rest are quiet; voices fade
   * in and out as you move. Call every frame (an empty list fades everything).
   */
  loops(list: readonly { key: number; kind: LoopKind; x: number; y: number; z: number }[]): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.world || !this.noise) return;
    const now = ac.currentTime;
    const want = list.slice(0, LOOP_SLOTS);
    for (let i = this.loopSlots.length - 1; i >= 0; i--) {
      const slot = this.loopSlots[i];
      if (want.some((w) => w.key === slot.key)) continue;
      slot.gain.gain.setTargetAtTime(0, now, 0.25);
      for (const n of slot.sources) n.stop(now + 1.2);
      window.setTimeout(() => slot.panner.disconnect(), 1400);
      this.loopSlots.splice(i, 1);
    }
    for (const w of want) {
      let slot = this.loopSlots.find((l) => l.key === w.key);
      if (!slot) {
        slot = this.loopSlot(ac, w.key, w.kind);
        this.loopSlots.push(slot);
        if (slot.panner.positionX) {
          slot.panner.positionX.value = w.x;
          slot.panner.positionY.value = w.y;
          slot.panner.positionZ.value = w.z;
        } else slot.panner.setPosition(w.x, w.y, w.z);
      }
      if (slot.buzz && Math.random() < 0.06) slot.buzz.frequency.setTargetAtTime(170 + Math.random() * 90, now, 0.08);
    }
  }

  private loopSlot(ac: AudioContext, key: number, kind: LoopKind): LoopSlot {
    const panner = ac.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    const loud = LOUD_LOOPS.includes(kind);
    panner.maxDistance = loud ? 90 : 20;
    panner.rolloffFactor = loud ? 0.9 : 1.6;
    panner.refDistance = loud ? 4 : 1;
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(panner).connect(this.world!);
    const sources: AudioScheduledSourceNode[] = [];
    let buzz: OscillatorNode | undefined;
    const now = ac.currentTime;
    if (kind === 'fridge') {
      // Mains hum and the compressor's low drone.
      for (const [f, a] of [
        [50, 0.5],
        [100, 0.35],
        [150, 0.12],
      ] as const) {
        const o = ac.createOscillator();
        o.frequency.value = f * (0.99 + Math.random() * 0.02);
        const g = ac.createGain();
        g.gain.value = a;
        o.connect(g).connect(gain);
        sources.push(o);
      }
      gain.gain.setTargetAtTime(0.05, now, 0.5);
    } else if (kind === 'tv') {
      // Static: hiss, a buzz of the frame rate under it.
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 700;
      src.connect(hp).connect(gain);
      sources.push(src);
      const hum = ac.createOscillator();
      hum.type = 'square';
      hum.frequency.value = 50;
      const hg = ac.createGain();
      hg.gain.value = 0.08;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 400;
      hum.connect(lp).connect(hg).connect(gain);
      sources.push(hum);
      gain.gain.setTargetAtTime(0.045, now, 0.3);
    } else if (kind === 'siren') {
      // An air-raid siren: one tone sweeping up and down, slow.
      const o = ac.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 520;
      const sweep = ac.createOscillator();
      sweep.frequency.value = 0.12;
      const depth = ac.createGain();
      depth.gain.value = 260;
      sweep.connect(depth).connect(o.frequency);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      o.connect(lp).connect(gain);
      sources.push(o, sweep);
      gain.gain.setTargetAtTime(0.06, now, 0.6);
    } else if (kind === 'bell') {
      // An alarm bell: a bright tone hammered twenty times a second.
      const o = ac.createOscillator();
      o.type = 'square';
      o.frequency.value = 1180;
      const trem = ac.createOscillator();
      trem.type = 'square';
      trem.frequency.value = 19;
      const tg = ac.createGain();
      tg.gain.value = 0.5;
      const amp = ac.createGain();
      amp.gain.value = 0.5;
      trem.connect(tg).connect(amp.gain);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2300;
      bp.Q.value = 2;
      o.connect(amp).connect(bp).connect(gain);
      sources.push(o, trem);
      gain.gain.setTargetAtTime(0.05, now, 0.3);
    } else if (kind === 'speaker' || kind === 'music') {
      // Through a tinny horn: speaker — a voice-like murmur in bursts (the message, no words make out)
      // over static; music — a short tune stuck on a loop, a skip in it.
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300;
      bp.Q.value = 0.9;
      bp.connect(gain);
      const hiss = ac.createBufferSource();
      hiss.buffer = this.noise;
      hiss.loop = true;
      const hg = ac.createGain();
      hg.gain.value = kind === 'speaker' ? 0.25 : 0.08;
      hiss.connect(hg).connect(bp);
      sources.push(hiss);
      const o = ac.createOscillator();
      o.type = kind === 'speaker' ? 'sawtooth' : 'triangle';
      const og = ac.createGain();
      og.gain.value = 0;
      o.connect(og).connect(bp);
      sources.push(o);
      const notes = kind === 'speaker' ? [190, 210, 175, 230, 200, 0, 185, 220, 195, 0, 0, 0] : [523, 659, 784, 659, 587, 523, 587, 0, 523, 659, 784, 784];
      const step = kind === 'speaker' ? 0.22 : 0.3;
      const cycle = notes.length * step + (kind === 'speaker' ? 2.5 : 0.15);
      for (let r = 0; r < 60; r++) {
        notes.forEach((f, k) => {
          const t = now + r * cycle + k * step;
          if (f) {
            o.frequency.setValueAtTime(f, t);
            og.gain.setValueAtTime(kind === 'speaker' ? 0.45 : 0.6, t);
            og.gain.setTargetAtTime(0.0, t + step * 0.7, 0.04);
          }
        });
      }
      gain.gain.setTargetAtTime(kind === 'speaker' ? 0.07 : 0.05, now, 0.4);
    } else if (kind === 'sparks') {
      // A torn cable: crackle in bursts, a buzz.
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const hp = ac.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const amp = ac.createGain();
      amp.gain.value = 0;
      const burst = ac.createBufferSource();
      burst.buffer = this.noise;
      burst.loop = true;
      burst.playbackRate.value = 0.03;
      const bd = ac.createGain();
      bd.gain.value = 1.4;
      burst.connect(bd).connect(amp.gain);
      src.connect(hp).connect(amp).connect(gain);
      const buzz = ac.createOscillator();
      buzz.type = 'square';
      buzz.frequency.value = 100;
      const bg = ac.createGain();
      bg.gain.value = 0.05;
      buzz.connect(bg).connect(gain);
      sources.push(src, burst, buzz);
      gain.gain.setTargetAtTime(0.07, now, 0.2);
    } else if (kind === 'fire' || kind === 'hiss' || kind === 'rainTin') {
      // Fire: a low roar with crackles; a hydrant: water rushing; rain drumming on a car's roof.
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ac.createBiquadFilter();
      f.type = kind === 'fire' ? 'lowpass' : 'bandpass';
      f.frequency.value = kind === 'fire' ? 500 : kind === 'hiss' ? 1800 : 3200;
      f.Q.value = kind === 'fire' ? 0.7 : 0.9;
      const mod = ac.createGain();
      mod.gain.value = kind === 'hiss' ? 1 : 0.6;
      src.connect(f).connect(mod).connect(gain);
      sources.push(src);
      if (kind !== 'hiss') {
        // Crackle / patter: the level jumping about.
        const crackle = ac.createBufferSource();
        crackle.buffer = this.noise;
        crackle.loop = true;
        crackle.playbackRate.value = kind === 'fire' ? 0.02 : 0.05;
        const depth = ac.createGain();
        depth.gain.value = 0.5;
        crackle.connect(depth).connect(mod.gain);
        sources.push(crackle);
      }
      gain.gain.setTargetAtTime(kind === 'fire' ? 0.08 : kind === 'hiss' ? 0.07 : 0.05, now, 0.4);
    } else {
      // Flies: a few wings at slightly different pitches, swelling as they circle.
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 600;
      bp.Q.value = 1.2;
      bp.connect(gain);
      for (let i = 0; i < 3; i++) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 180 + i * 37 + Math.random() * 20;
        const vib = ac.createOscillator();
        vib.frequency.value = 3 + Math.random() * 4;
        const vg = ac.createGain();
        vg.gain.value = 12;
        vib.connect(vg).connect(o.frequency);
        const amp = ac.createGain();
        amp.gain.value = 0.3;
        const swell = ac.createOscillator();
        swell.frequency.value = 0.3 + Math.random() * 0.5;
        const sg = ac.createGain();
        sg.gain.value = 0.25;
        swell.connect(sg).connect(amp.gain);
        o.connect(amp).connect(bp);
        sources.push(o, vib, swell);
        if (i === 0) buzz = o;
      }
      gain.gain.setTargetAtTime(0.06, now, 0.4);
    }
    for (const n of sources) n.start(now);
    return { key, kind, gain, panner, sources, buzz };
  }

  jump(pos: Pos): void {
    const v = this.voice(pos, 0.3);
    if (!v) return;
    const [out, t] = v;
    this.noiseHit(out, t, { type: 'bandpass', f: 700, f2: 1500, q: 0.8, dur: 0.18, peak: 0.12, attack: 0.04 });
  }

  land(surface: StepSurface, pos: Pos, speed: number): void {
    const k = Math.min(1.6, speed / 3);
    this.step(surface, 'run', pos, 0.9 + k * 0.5);
    const v = this.voice(pos, 0.25);
    if (!v) return;
    const [out, t] = v;
    this.tone(out, t, { f: 75, f2: 45, dur: 0.14, peak: 0.45 * k });
    this.noiseHit(out, t + 0.01, { type: 'bandpass', f: 900, q: 0.7, dur: 0.12, peak: 0.08 * k });
  }

  swing(kind: SwingKind, dur: number, pos: Pos): void {
    const v = this.voice(pos, 0.5);
    if (!v) return;
    const [out, t] = v;
    // The recorded whoosh for the axe, the bat and the crowbar (slower with a slower, tired swing), a blade's a
    // little higher and lighter.
    if (kind !== 'fist' && this.sample(out, t, 'swing', { rate: Math.min(1.3, Math.max(0.75, 0.32 / Math.max(0.1, dur))) * (kind === 'blade' ? 1.2 : 1), vary: 0.08, gain: kind === 'blade' ? 0.35 : 0.5 })) return;
    if (kind === 'heavy') this.noiseHit(out, t, { type: 'bandpass', f: 280, f2: 1300, q: 1.6, dur: dur * 1.6, peak: 0.32, attack: dur * 0.9 });
    else if (kind === 'blade') this.noiseHit(out, t, { type: 'bandpass', f: 900, f2: 3200, q: 2, dur: dur * 1.5, peak: 0.2, attack: dur * 0.8 });
    else this.noiseHit(out, t, { type: 'bandpass', f: 400, f2: 900, q: 1, dur: dur * 1.4, peak: 0.12, attack: dur * 0.7 });
  }

  /**
   * A shot: the crack of the report, its low boom and the mechanism; suppressed — a dull thud and the action
   * loud in its own right. The place answers: indoors a dense short ring, a street one late slap off the
   * far fronts, an alley a flutter between its walls. `self`: ours (no distance falloff, at the ear).
   */
  gunShot(kind: GunSound, pos: Pos | null, suppressed: boolean, place: EchoPlace): void {
    const v = this.voice(pos, 1.6, 6, true);
    if (!v) return;
    const [out, t] = v;
    const big = kind === 'rpg' ? 1.6 : kind === 'shotgun' || kind === 'hunting' ? 1.25 : kind === 'rifle' || kind === 'ak' ? 1.1 : kind === 'pistol45' ? 0.95 : 0.85;
    const low = kind === 'pistol' ? 170 : kind === 'pistol45' ? 130 : kind === 'shotgun' ? 95 : kind === 'rpg' ? 60 : kind === 'ak' ? 115 : 125;
    if (suppressed) {
      this.noiseHit(out, t, { type: 'lowpass', f: 900, f2: 300, dur: 0.09, peak: 0.45 * big });
      this.noiseHit(out, t, { type: 'bandpass', f: 2200, q: 1.5, dur: 0.03, peak: 0.12 });
      this.tone(out, t, { f: low * 1.4, f2: low * 0.8, dur: 0.08, peak: 0.12 });
    } else if (kind === 'rpg') {
      this.noiseHit(out, t, { type: 'lowpass', f: 1800, f2: 200, dur: 0.6, peak: 0.95, attack: 0.01 });
      this.noiseHit(out, t + 0.02, { type: 'bandpass', f: 600, f2: 2400, q: 0.8, dur: 1.1, peak: 0.35, attack: 0.08 });
      this.tone(out, t, { f: 70, f2: 38, dur: 0.5, peak: 0.6 });
    } else {
      // The crack (supersonic, the muzzle blast), the boom, a tail.
      this.noiseHit(out, t, { type: 'highpass', f: 1800, dur: 0.025, peak: 0.9 * big });
      this.noiseHit(out, t, { type: 'lowpass', f: 2600, f2: 350, dur: 0.16 * big, peak: 0.85 * big });
      this.tone(out, t, { f: low * 1.6, f2: low * 0.6, dur: 0.18 * big, peak: 0.55 * big });
      this.noiseHit(out, t + 0.03, { type: 'bandpass', f: 700, q: 0.7, dur: 0.35 * big, peak: 0.18 * big, attack: 0.02 });
    }
    // The echo by place.
    const e = suppressed ? 0.25 : 1;
    if (place === 'indoor') {
      for (let i = 0; i < 5; i++) this.noiseHit(out, t + 0.012 + i * 0.017, { type: 'lowpass', f: 2200 - i * 300, dur: 0.08, peak: (0.32 - i * 0.05) * big * e });
    } else if (place === 'alley') {
      for (let i = 0; i < 6; i++) this.noiseHit(out, t + 0.06 + i * 0.075, { type: 'bandpass', f: 1300 - i * 120, q: 0.9, dur: 0.07, peak: (0.24 - i * 0.035) * big * e });
    } else {
      this.noiseHit(out, t + 0.32 + Math.random() * 0.15, { type: 'lowpass', f: 900, dur: 0.5, peak: 0.2 * big * e, attack: 0.04 });
      this.noiseHit(out, t + 0.75 + Math.random() * 0.3, { type: 'lowpass', f: 600, dur: 0.7, peak: 0.1 * big * e, attack: 0.06 });
    }
  }

  /** The gun's own noises in the hands (magazine, slide, bolt, pump, the dry click…), at the ear. */
  gunMech(kind: GunMech, pitch = 1): void {
    const v = this.voice(null, 0.6);
    if (!v) return;
    const [out, t] = v;
    const k = (f: number) => f * pitch;
    // Recorded: the dry click on an empty chamber; the action's rattle (the bolt, the slide, the latch).
    if (kind === 'dry' && this.sample(out, t, 'dry', { rate: pitch, gain: 0.55 })) return;
    if ((kind === 'rack' || kind === 'bolt' || kind === 'pump' || kind === 'boltCatch' || kind === 'slideLock') && this.sample(out, t + (kind === 'pump' ? 0.1 : 0.06), 'rattle', { rate: pitch * (kind === 'pump' ? 0.8 : kind === 'boltCatch' || kind === 'slideLock' ? 1.15 : 1), gain: 0.5 })) {
      this.noiseHit(out, t, { type: 'bandpass', f: k(kind === 'pump' ? 900 : 1500), q: 2, dur: 0.06, peak: 0.2 });
      return;
    }
    switch (kind) {
      case 'magOut':
        this.noiseHit(out, t, { type: 'bandpass', f: k(1800), q: 3, dur: 0.03, peak: 0.25 });
        this.noiseHit(out, t + 0.04, { type: 'bandpass', f: k(900), q: 1.5, dur: 0.12, peak: 0.12, attack: 0.03 });
        break;
      case 'magIn':
        this.noiseHit(out, t, { type: 'bandpass', f: k(1300), q: 2, dur: 0.05, peak: 0.2 });
        this.noiseHit(out, t + 0.06, { type: 'bandpass', f: k(2600), q: 4, dur: 0.025, peak: 0.35 });
        this.tone(out, t + 0.06, { f: k(1900), dur: 0.05, peak: 0.06 });
        break;
      case 'rack':
      case 'pump':
      case 'bolt':
        this.noiseHit(out, t, { type: 'bandpass', f: k(kind === 'pump' ? 900 : 1500), q: 2, dur: 0.06, peak: 0.28 });
        this.noiseHit(out, t + (kind === 'pump' ? 0.16 : 0.12), { type: 'bandpass', f: k(2200), q: 3, dur: 0.04, peak: 0.38 });
        this.tone(out, t + 0.12, { f: k(2600), dur: 0.04, peak: 0.07 });
        break;
      case 'slideLock':
      case 'boltCatch':
        this.noiseHit(out, t, { type: 'bandpass', f: k(3000), q: 5, dur: 0.02, peak: 0.35 });
        this.noiseHit(out, t + 0.01, { type: 'bandpass', f: k(1700), q: 2, dur: 0.06, peak: 0.25 });
        break;
      case 'shell':
        this.noiseHit(out, t, { type: 'bandpass', f: k(1100), q: 2, dur: 0.05, peak: 0.2 });
        this.tone(out, t + 0.03, { f: k(1500), dur: 0.04, peak: 0.05 });
        break;
      case 'rocket':
        this.noiseHit(out, t, { type: 'lowpass', f: 700, dur: 0.25, peak: 0.25, attack: 0.08 });
        this.noiseHit(out, t + 0.3, { type: 'bandpass', f: 1200, q: 2, dur: 0.05, peak: 0.3 });
        break;
      case 'mode':
        this.noiseHit(out, t, { type: 'bandpass', f: k(3400), q: 6, dur: 0.015, peak: 0.3 });
        break;
      case 'dry':
      case 'jam':
        this.noiseHit(out, t, { type: 'bandpass', f: k(kind === 'jam' ? 1200 : 2400), q: 5, dur: 0.02, peak: 0.3 });
        break;
      case 'lastRounds':
        // The M4's brighter ping on the last rounds: the spring nearly bare.
        this.tone(out, t, { f: k(3200), dur: 0.09, peak: 0.08 });
        this.tone(out, t, { f: k(4700), dur: 0.06, peak: 0.04 });
        break;
      case 'draw':
      case 'holster':
        this.noiseHit(out, t, { type: 'bandpass', f: kind === 'draw' ? 700 : 500, q: 0.8, dur: 0.18, peak: 0.1, attack: 0.05 });
        this.noiseHit(out, t + 0.16, { type: 'bandpass', f: 1600, q: 2, dur: 0.03, peak: 0.12 });
        break;
    }
  }

  /** A spent case on the floor: a few bright tinkles (a shotgun's hull: a dull plastic tap). */
  casing(pos: Pos, shell: boolean, soft: boolean): void {
    const v = this.voice(pos, 0.6, 1.5);
    if (!v) return;
    const [out, t] = v;
    if (shell || soft) {
      this.noiseHit(out, t, { type: 'bandpass', f: soft ? 500 : 900, q: 1.2, dur: 0.05, peak: soft ? 0.08 : 0.15 });
      return;
    }
    if (this.sample(out, t, 'casing', { rate: 1.05, vary: 0.12, gain: 0.3 })) return;
    for (let i = 0; i < 3; i++) {
      const dt = i * (0.07 + Math.random() * 0.05);
      this.tone(out, t + dt, { f: 4200 + Math.random() * 2200, dur: 0.06, peak: 0.07 / (i + 1) });
      this.noiseHit(out, t + dt, { type: 'highpass', f: 5000, dur: 0.012, peak: 0.06 / (i + 1) });
    }
  }

  /** A magazine dropped on the floor. */
  magDrop(pos: Pos): void {
    const v = this.voice(pos, 0.9, 1.5);
    if (!v) return;
    const [out, t] = v;
    // The light clatter played lower: a heavier, hollow magazine.
    if (this.sample(out, t, 'magDrop', { rate: 0.72, vary: 0.06, gain: 0.55 })) return;
    this.noiseHit(out, t, { type: 'bandpass', f: 800, q: 1.2, dur: 0.08, peak: 0.3 });
    this.noiseHit(out, t + 0.12, { type: 'bandpass', f: 1100, q: 2, dur: 0.04, peak: 0.12 });
  }

  /** A bullet hits: dust off concrete, a ricochet off metal, wood, glass breaking, a car's tin; a body. */
  bulletHit(kind: BulletHit, pos: Pos): void {
    const v = this.voice(pos, 0.9, 2, true);
    if (!v) return;
    const [out, t] = v;
    if ((kind === 'metal' || kind === 'car') && this.sample(out, t, 'bulletMetal', { rate: kind === 'car' ? 0.75 : 1, vary: 0.1, gain: 0.6 })) {
      // The ricochet's whine over it now and then.
      if (kind === 'metal' && Math.random() < 0.35) this.tone(out, t + 0.01, { f: 3800 + Math.random() * 1500, f2: 1400, dur: 0.35, peak: 0.05, type: 'triangle' });
      return;
    }
    switch (kind) {
      case 'metal':
        this.noiseHit(out, t, { type: 'highpass', f: 3000, dur: 0.03, peak: 0.4 });
        // The ricochet's whine.
        if (Math.random() < 0.6) this.tone(out, t + 0.01, { f: 3800 + Math.random() * 1500, f2: 1400, dur: 0.35, peak: 0.08, type: 'triangle' });
        else this.tone(out, t, { f: 1250, dur: 0.25, peak: 0.08 });
        break;
      case 'car':
        this.noiseHit(out, t, { type: 'bandpass', f: 1400, q: 1, dur: 0.06, peak: 0.4 });
        this.tone(out, t, { f: 520, f2: 380, dur: 0.22, peak: 0.12 });
        break;
      case 'wood':
        this.noiseHit(out, t, { type: 'bandpass', f: 900, q: 1.2, dur: 0.07, peak: 0.45 });
        this.tone(out, t, { f: 260, f2: 170, dur: 0.1, peak: 0.2 });
        break;
      case 'glass':
        this.hit('glass', pos, 1);
        break;
      case 'flesh':
        this.noiseHit(out, t, { type: 'lowpass', f: 450, dur: 0.08, peak: 0.5 });
        break;
      case 'soft':
        this.noiseHit(out, t, { type: 'lowpass', f: 700, dur: 0.06, peak: 0.25 });
        break;
      default:
        this.noiseHit(out, t, { type: 'bandpass', f: 1600, q: 0.9, dur: 0.05, peak: 0.45 });
        for (let i = 0; i < 4; i++) this.noiseHit(out, t + 0.03 + Math.random() * 0.15, { type: 'highpass', f: 3000, dur: 0.012, peak: 0.07 });
    }
  }

  /** The hitmarker's tick (ui): a headshot rings higher and doubled. */
  hitMarker(head: boolean): void {
    const v = this.voice(null, 0.3);
    if (!v) return;
    const [out, t] = v;
    this.tone(out, t, { f: head ? 2100 : 1500, dur: 0.05, peak: 0.07, type: 'triangle' });
    if (head) this.tone(out, t + 0.045, { f: 2800, dur: 0.06, peak: 0.06, type: 'triangle' });
  }

  /** An explosion: the blast, its rumble rolling away, debris falling. */
  explosion(pos: Pos): void {
    const v = this.voice(pos, 4.5, 12, true);
    if (!v) return;
    const [out, t] = v;
    if (this.sample(out, t, 'explosion', { vary: 0.06, gain: 1 })) {
      // The chest's thump under the recording.
      this.tone(out, t, { f: 55, f2: 28, dur: 1.2, peak: 0.4 });
      return;
    }
    this.noiseHit(out, t, { type: 'lowpass', f: 3000, f2: 120, dur: 1.4, peak: 1, attack: 0.005 });
    this.tone(out, t, { f: 55, f2: 28, dur: 1.6, peak: 0.8 });
    this.noiseHit(out, t + 0.25, { type: 'lowpass', f: 400, dur: 2.2, peak: 0.35, attack: 0.3 });
    for (let i = 0; i < 10; i++) this.noiseHit(out, t + 0.5 + Math.random() * 1.2, { type: 'bandpass', f: 1500 + Math.random() * 2500, q: 2, dur: 0.03, peak: 0.06 });
  }

  hit(material: HitMaterial, pos: Pos, heavy = 1): void {
    const v = this.voice(pos, 0.8);
    if (!v) return;
    const [out, t] = v;
    const g = 0.5 + heavy * 0.5;
    switch (material) {
      case 'wood':
        this.tone(out, t, { f: 230, f2: 150, dur: 0.16, peak: 0.5 * g });
        this.noiseHit(out, t, { type: 'bandpass', f: 750, q: 1.2, dur: 0.14, peak: 0.6 * g });
        break;
      case 'metal':
        // A car, a container, a locker: the recorded hit with its ring (a light blow higher and quieter).
        if (this.sample(out, t, 'hitMetal', { rate: 1.15 - heavy * 0.15, vary: 0.08, gain: 0.35 + 0.35 * heavy })) break;
        for (const f of [410, 735, 1120, 1690]) this.tone(out, t, { f: f * (0.95 + Math.random() * 0.1), dur: 0.6, peak: 0.09 * g });
        this.noiseHit(out, t, { type: 'highpass', f: 2500, dur: 0.05, peak: 0.4 * g });
        break;
      case 'concrete':
        this.noiseHit(out, t, { type: 'lowpass', f: 600, dur: 0.11, peak: 0.7 * g });
        this.noiseHit(out, t, { type: 'highpass', f: 4000, dur: 0.03, peak: 0.2 * g });
        for (let i = 0; i < 3; i++) this.noiseHit(out, t + 0.05 + Math.random() * 0.2, { type: 'bandpass', f: 2500, q: 2, dur: 0.02, peak: 0.08 * g });
        break;
      case 'glass':
        this.noiseHit(out, t, { type: 'highpass', f: 2500, dur: 0.12, peak: 0.5 * g });
        for (let i = 0; i < 14; i++) {
          const dt = Math.random() * 0.45;
          this.noiseHit(out, t + dt, { type: 'highpass', f: 3500 + Math.random() * 5000, dur: 0.015, peak: (0.25 - dt * 0.4) * g });
          if (i % 3 === 0) this.tone(out, t + dt, { f: 2500 + Math.random() * 3000, dur: 0.08, peak: 0.04 * g });
        }
        break;
      default:
        this.noiseHit(out, t, { type: 'lowpass', f: 320, dur: 0.12, peak: 0.6 * g });
    }
  }

  /**
   * A door: a dull latch clunk and a soft brush of air and wood; a creaky door (fixed per door) moans
   * low and slow all the way open. `pitch` — this door's own ±10%.
   */
  door(style: 'wood' | 'glass', open: boolean, pos: Pos, creaky = false, pitch = 1): void {
    const v = this.voice(pos, creaky && open ? 1.2 : 0.7);
    if (!v) return;
    const [out, t] = v;
    // Latch: a muffled clunk, no click.
    this.noiseHit(out, t, { type: 'lowpass', f: 900 * pitch, dur: 0.035, peak: 0.3 });
    this.tone(out, t, { f: 150 * pitch, dur: 0.05, peak: 0.12 });
    if (open) {
      // The leaf swinging: a quiet rustle.
      this.noiseHit(out, t + 0.05, { type: 'bandpass', f: (style === 'wood' ? 900 : 1500) * pitch, q: 0.8, dur: 0.45, peak: 0.035, attack: 0.15 });
      if (creaky && style === 'wood') this.creak(out, t + 0.08, 0.85, pitch);
    } else {
      // Shut: the leaf meets the frame.
      this.noiseHit(out, t + 0.02, { type: 'lowpass', f: (style === 'wood' ? 260 : 700) * pitch, dur: 0.12, peak: 0.5 });
      this.tone(out, t + 0.02, { f: (style === 'wood' ? 85 : 170) * pitch, dur: 0.12, peak: 0.22 });
    }
  }

  /**
   * Wooden creak: a hinge's stick-slip — a slow, uneven train of pulses (40–70 a second) rung through the
   * door's wooden body (a narrow band around 380 Hz), swelling and fading over the swing.
   */
  private creak(out: Out, t: number, dur: number, pitch: number): void {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    const steps = 12;
    const rate = new Float32Array(steps);
    for (let i = 0; i < steps; i++) rate[i] = (42 + 26 * Math.sin((i / steps) * Math.PI) + (Math.random() - 0.5) * 12) * pitch;
    osc.frequency.setValueCurveAtTime(rate, t, dur);
    const body = ac.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 380 * pitch;
    body.Q.value = 5;
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 1200;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.12);
    g.gain.setValueAtTime(0.22, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(body).connect(low).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /**
   * Zombie sounds, 3D, each in a few variants with the zombie's own pitch (men low, women higher, teens
   * highest): moans, rasps, chattering teeth, shuffling steps, the alarm, blows on a door (heavy, heard
   * far: a thud, wood groaning, a crack when it gives), being hit, falling, a lunge.
   */
  zombie(kind: 'moan' | 'rasp' | 'teeth' | 'step' | 'alarm' | 'bang' | 'crack' | 'hit' | 'die' | 'swing', pos: Pos, pitch = 1): void {
    const far = kind === 'bang' || kind === 'crack';
    const group: Group = far ? 'zBang' : kind === 'step' ? 'zStep' : kind === 'swing' ? 'zLunge' : kind === 'hit' || kind === 'die' ? 'zHurt' : 'zVoice';
    if (!this.claim(group, kind === 'moan' || kind === 'alarm' ? 1.4 : kind === 'step' ? 0.25 : 0.6)) return;
    const v = this.voice(pos, far ? 1.4 : 1.6, far ? 7 : kind === 'step' ? 1 : 2, kind === 'swing' || kind === 'hit' || kind === 'die');
    if (!v) return;
    const [out, t] = v;
    const r = Math.random();
    const f = (hz: number) => hz * pitch * (0.93 + Math.random() * 0.14);
    // Recorded voices among the synthesized ones (not every time: a crowd of one voice is a loop), ±10% pitch.
    const rec: SampleGroup | null = kind === 'alarm' ? 'zScream' : kind === 'swing' ? 'zAttack' : kind === 'rasp' ? 'zBreath' : kind === 'die' ? 'zDeath' : null;
    const share = kind === 'die' ? 0.6 : kind === 'rasp' ? 0.35 : 0.45;
    if (rec && Math.random() < share && this.sample(out, t, rec, { rate: pitch, vary: 0.1, gain: kind === 'rasp' ? 0.5 : 0.7 })) {
      // The body still hits the ground.
      if (kind === 'die') {
        this.noiseHit(out, t + 0.45, { type: 'lowpass', f: 220, dur: 0.3, peak: 0.7 });
        this.tone(out, t + 0.45, { f: 60, dur: 0.2, peak: 0.35 });
      }
      return;
    }
    switch (kind) {
      case 'moan': {
        // A hungry growl, low in the chest: three shapes — a long rolling growl, a rise into a snarl, two
        // short grunting growls.
        const g = f(70);
        if (r < 0.34) this.growl(out, t, { f: g, f2: g * 0.8, dur: 1.4, peak: 0.34, flutter: 26 + r * 10, form: f(420), form2: f(330) });
        else if (r < 0.67) {
          this.growl(out, t, { f: g, f2: g * 1.25, dur: 0.6, peak: 0.3, flutter: 30, form: f(380), form2: f(520) });
          this.growl(out, t + 0.55, { f: g * 1.25, f2: g * 0.85, dur: 0.75, peak: 0.34, flutter: 38, form: f(560), form2: f(380), breath: 0.9 });
        } else {
          for (let i = 0; i < 2; i++) this.growl(out, t + i * 0.42, { f: g * (1.05 - i * 0.1), f2: g * 0.8, dur: 0.38, peak: 0.32, flutter: 34, form: f(400), attack: 0.03 });
        }
        break;
      }
      case 'alarm':
        // It has seen you: a rising roar into a shriek.
        this.growl(out, t, { f: f(80), f2: f(170), dur: 1.3, peak: 0.5, flutter: 42, form: f(500), form2: f(1100), breath: 1, attack: 0.04 });
        this.growl(out, t + 0.05, { f: f(160), f2: f(320), dur: 1.0, peak: 0.16, flutter: 55, form: f(1300), breath: 0.4 });
        break;
      case 'rasp':
        // Following you: a wet snarl through bared teeth, a snap of the jaw.
        this.growl(out, t, { f: f(95), f2: f(120), dur: 0.7 + r * 0.4, peak: 0.36, flutter: 48 + r * 12, form: f(800), form2: f(650), breath: 1.2, attack: 0.03 });
        this.noiseHit(out, t + 0.6 + r * 0.3, { type: 'bandpass', f: f(2200), q: 4, dur: 0.03, peak: 0.16 });
        break;
      case 'teeth':
        // Snapping jaws: hard clacks over a low growl.
        this.growl(out, t, { f: f(75), f2: f(70), dur: 0.6, peak: 0.2, flutter: 30, form: f(380) });
        for (let i = 0, n = 5 + Math.floor(r * 5); i < n; i++) this.noiseHit(out, t + i * (0.055 + Math.random() * 0.02), { type: 'bandpass', f: f(2400), q: 5, dur: 0.02, peak: 0.14 });
        break;
      case 'step':
        // A dragged, shuffling foot.
        this.noiseHit(out, t, { type: 'lowpass', f: 380 * (0.8 + r * 0.4), dur: 0.09, peak: 0.16 });
        this.noiseHit(out, t + 0.05, { type: 'bandpass', f: 900, q: 0.8, dur: 0.22, peak: 0.035, attack: 0.05 });
        break;
      case 'bang':
        // A body thrown against a door: a deep boom, the leaf groaning in its frame, a moan behind it.
        this.noiseHit(out, t, { type: 'lowpass', f: 160, dur: 0.35, peak: 0.9 });
        this.tone(out, t, { f: 55 + r * 15, dur: 0.3, peak: 0.6 });
        this.noiseHit(out, t + 0.03, { type: 'bandpass', f: 420, q: 4, dur: 0.25, peak: 0.12 });
        if (r < 0.5) this.tone(out, t + 0.15, { f: f(90), f2: f(70), dur: 0.9, peak: 0.12, type: 'sawtooth', lp: 400, vibrato: 6 });
        break;
      case 'crack':
        // It gives: a crack of splitting wood, the boom, splinters.
        this.noiseHit(out, t, { type: 'highpass', f: 1500, dur: 0.12, peak: 0.6 });
        this.noiseHit(out, t + 0.02, { type: 'lowpass', f: 200, dur: 0.5, peak: 0.9 });
        for (let i = 0; i < 6; i++) this.noiseHit(out, t + 0.08 + i * 0.05 * Math.random(), { type: 'bandpass', f: 2000 + Math.random() * 1500, q: 4, dur: 0.04, peak: 0.12 });
        break;
      case 'hit':
        // Hurt: a choked, angry grunt.
        this.growl(out, t + 0.04, { f: f(120), f2: f(85), dur: 0.32, peak: 0.3, flutter: 40, form: f(650), form2: f(450), breath: 1, attack: 0.015 });
        break;
      case 'die':
        // Dropping: a last breath, the body hitting the ground.
        this.noiseHit(out, t, { type: 'bandpass', f: f(600), f2: f(300), q: 1.5, dur: 0.6, peak: 0.08, attack: 0.05 });
        this.noiseHit(out, t + 0.45, { type: 'lowpass', f: 220, dur: 0.3, peak: 0.7 });
        this.tone(out, t + 0.45, { f: 60, dur: 0.2, peak: 0.35 });
        break;
      case 'swing':
        // The lunge: a short barking snarl, the jaws snapping shut.
        this.growl(out, t, { f: f(110), f2: f(150), dur: 0.4, peak: 0.42, flutter: 50, form: f(900), form2: f(700), breath: 1.1, attack: 0.02 });
        this.noiseHit(out, t + 0.35, { type: 'bandpass', f: f(2500), q: 5, dur: 0.025, peak: 0.2 });
        break;
    }
  }

  /**
   * Our blow landing on a zombie: the weapon's own impact — a club's dull thud and slap of flesh, a metal
   * tool's thud with a short ring, the axe's wet chop, the knife going in, a fist's slap. On the head, bone
   * cracks; a killing blow lands heavier.
   */
  strike(kind: FleshBlow, pos: Pos, head: boolean, kill: boolean): void {
    if (!this.claim('strike', 0.4)) return;
    const v = this.voice(pos, 0.6, 2, true);
    if (!v) return;
    const [out, t] = v;
    const k = kill ? 1.25 : 1;
    const j = () => 0.9 + Math.random() * 0.2;
    switch (kind) {
      case 'blunt':
      case 'metal':
        // The recorded heavy thud (a bat, a crowbar, a hammer on a body); a crowbar's ring over it.
        if (this.sample(out, t, 'heavyHit', { vary: 0.08, gain: 0.8 * k })) {
          if (kind === 'metal') for (const f of [880, 1460]) this.tone(out, t, { f: f * j(), dur: 0.22, peak: 0.04 });
          break;
        }
        this.noiseHit(out, t, { type: 'lowpass', f: 260 * j(), dur: 0.16, peak: 0.85 * k });
        this.tone(out, t, { f: 78 * j(), f2: 46, dur: 0.14, peak: 0.55 * k });
        this.noiseHit(out, t + 0.004, { type: 'bandpass', f: 1300 * j(), q: 0.9, dur: 0.06, peak: 0.35 * k });
        if (kind === 'metal') for (const f of [880, 1460]) this.tone(out, t, { f: f * j(), dur: 0.22, peak: 0.05 });
        break;
      case 'chop':
        this.tone(out, t, { f: 120 * j(), f2: 60, dur: 0.12, peak: 0.5 * k });
        this.noiseHit(out, t, { type: 'lowpass', f: 420, dur: 0.12, peak: 0.6 * k });
        this.noiseHit(out, t + 0.01, { type: 'bandpass', f: 1900 * j(), f2: 650, q: 3, dur: 0.18, peak: 0.3 * k });
        break;
      case 'stab':
        this.noiseHit(out, t, { type: 'bandpass', f: 950 * j(), f2: 380, q: 2.2, dur: 0.14, peak: 0.45 * k });
        this.noiseHit(out, t + 0.03, { type: 'bandpass', f: 2600 * j(), f2: 1300, q: 6, dur: 0.09, peak: 0.12 * k });
        this.noiseHit(out, t, { type: 'lowpass', f: 220, dur: 0.07, peak: 0.3 * k });
        break;
      case 'fist':
        this.noiseHit(out, t, { type: 'bandpass', f: 1500 * j(), q: 0.8, dur: 0.05, peak: 0.45 });
        this.noiseHit(out, t, { type: 'lowpass', f: 300, dur: 0.1, peak: 0.5 });
        break;
    }
    if (head && kind !== 'fist') {
      this.noiseHit(out, t + 0.008, { type: 'highpass', f: 2200, dur: 0.03, peak: 0.35 });
      this.noiseHit(out, t + 0.02, { type: 'bandpass', f: 3400 * j(), q: 3, dur: 0.04, peak: 0.18 });
    }
  }

  /**
   * A zombie's blow on us, right at the ear (not in 3D): the clothes taking it (a thump and fabric), a
   * scratch tearing skin, a bite crunching in. Several at once in a crowd play as one, a little louder.
   */
  attacked(kind: Attacked, many = 1): void {
    if (!this.claim('attacked', 0.4)) return;
    const v = this.voice(null, 0.5, 1, true);
    if (!v) return;
    const [out, t] = v;
    const k = Math.min(1.4, 1 + (many - 1) * 0.15);
    this.noiseHit(out, t, { type: 'lowpass', f: 280, dur: 0.12, peak: 0.55 * k });
    if (kind === 'blocked') this.noiseHit(out, t + 0.01, { type: 'bandpass', f: 3200, q: 1.2, dur: 0.1, peak: 0.12 * k });
    else if (kind === 'scratch') this.noiseHit(out, t + 0.02, { type: 'bandpass', f: 3400, f2: 1500, q: 2.5, dur: 0.2, peak: 0.22 * k, attack: 0.02 });
    else {
      for (let i = 0; i < 4; i++) this.noiseHit(out, t + i * 0.025 + Math.random() * 0.01, { type: 'bandpass', f: 1800 + Math.random() * 1400, q: 4, dur: 0.025, peak: 0.22 * k });
      this.noiseHit(out, t + 0.06, { type: 'bandpass', f: 800, f2: 420, q: 3, dur: 0.22, peak: 0.25 * k });
    }
  }

  /** The survivor hurt: a short pained grunt, one at a time (a bite, a fall). */
  ouch(hard: number): void {
    if (!this.claim('ouch', 0.5)) return;
    const v = this.voice(null, 0.5, 1, true);
    if (!v) return;
    const [out, t] = v;
    const f = 150 * (0.92 + Math.random() * 0.16);
    const k = 0.6 + Math.min(1, hard) * 0.4;
    this.tone(out, t + 0.03, { f, f2: f * 0.72, dur: 0.24, peak: 0.16 * k, type: 'sawtooth', lp: 900 });
    this.noiseHit(out, t + 0.02, { type: 'bandpass', f: 1100, q: 1.2, dur: 0.2, peak: 0.07 * k, attack: 0.02 });
  }

  /** A door that won't give: thumps against the boards, a rattle. */
  /** A zombie groans: a low, wavering moan through the nose; `alarm` — it has seen you (louder, rising). */
  groan(pos: Pos, alarm: boolean): void {
    const v = this.voice(pos, alarm ? 1.6 : 1.3);
    if (!v) return;
    const [out, t] = v;
    const f = 85 + Math.random() * 35;
    const dur = alarm ? 1.3 : 1.0 + Math.random() * 0.4;
    this.tone(out, t, { f, f2: alarm ? f * 1.35 : f * 0.8, dur, peak: alarm ? 0.32 : 0.2, type: 'sawtooth', lp: 520, vibrato: 7 });
    this.tone(out, t + 0.02, { f: f * 1.5, f2: f * 1.2, dur: dur * 0.8, peak: 0.08, type: 'triangle', lp: 900, vibrato: 5 });
    this.noiseHit(out, t, { type: 'bandpass', f: 700, q: 1.2, dur: dur * 0.9, peak: 0.06, attack: 0.15 });
  }

  doorStuck(pos: Pos): void {
    const v = this.voice(pos, 0.7);
    if (!v) return;
    const [out, t] = v;
    for (let i = 0; i < 3; i++) {
      this.noiseHit(out, t + i * 0.13, { type: 'lowpass', f: 300, dur: 0.1, peak: 0.55 - i * 0.12 });
      this.noiseHit(out, t + i * 0.13 + 0.02, { type: 'bandpass', f: 1400, q: 2, dur: 0.06, peak: 0.08 });
    }
  }

  containerOpen(kind: ContainerSound, pos: Pos): void {
    const v = this.voice(pos, 0.6);
    if (!v) return;
    const [out, t] = v;
    switch (kind) {
      case 'woodDoor':
        this.tone(out, t, { f: 230, f2: 300, dur: 0.3, peak: 0.05, type: 'sawtooth', lp: 1200, vibrato: 12 });
        this.noiseHit(out, t, { type: 'bandpass', f: 1800, q: 3, dur: 0.02, peak: 0.2 });
        break;
      case 'drawer':
        this.noiseHit(out, t, { type: 'bandpass', f: 800, f2: 1200, q: 1.5, dur: 0.28, peak: 0.25, attack: 0.08 });
        this.noiseHit(out, t + 0.28, { type: 'lowpass', f: 400, dur: 0.06, peak: 0.3 });
        break;
      case 'locker':
        this.tone(out, t, { f: 900, f2: 760, dur: 0.18, peak: 0.04, type: 'sawtooth', lp: 2500 });
        for (const f of [620, 950, 1480]) this.tone(out, t + 0.15, { f, dur: 0.35, peak: 0.06 });
        break;
      case 'fridge':
        this.noiseHit(out, t, { type: 'lowpass', f: 450, dur: 0.1, peak: 0.45, attack: 0.03 });
        this.tone(out, t + 0.02, { f: 120, dur: 0.08, peak: 0.2 });
        for (let i = 0; i < 4; i++) this.tone(out, t + 0.12 + Math.random() * 0.2, { f: 1800 + Math.random() * 1600, dur: 0.12, peak: 0.03 });
        break;
      case 'trunk':
        this.noiseHit(out, t, { type: 'bandpass', f: 2200, q: 4, dur: 0.03, peak: 0.25 });
        this.tone(out, t + 0.03, { f: 140, f2: 110, dur: 0.18, peak: 0.35 });
        this.tone(out, t + 0.1, { f: 950, f2: 700, dur: 0.4, peak: 0.02, type: 'triangle' });
        break;
      case 'bag':
        this.zip(out, t, 0.4, true);
        break;
      case 'box':
        this.noiseHit(out, t, { type: 'lowpass', f: 520, dur: 0.12, peak: 0.35 });
        this.noiseHit(out, t + 0.14, { type: 'lowpass', f: 560, dur: 0.12, peak: 0.3 });
        break;
      case 'trash':
        this.noiseHit(out, t, { type: 'bandpass', f: 1300, q: 1, dur: 0.1, peak: 0.35 });
        this.tone(out, t, { f: 300, f2: 260, dur: 0.12, peak: 0.2 });
        break;
      case 'crate':
        this.tone(out, t, { f: 150, dur: 0.12, peak: 0.3 });
        this.noiseHit(out, t, { type: 'bandpass', f: 650, q: 1.2, dur: 0.14, peak: 0.35 });
        this.tone(out, t + 0.1, { f: 260, f2: 330, dur: 0.3, peak: 0.04, type: 'sawtooth', lp: 900, vibrato: 10 });
        break;
      case 'shelf':
        this.noiseHit(out, t, { type: 'bandpass', f: 2500, q: 1, dur: 0.06, peak: 0.12 });
        break;
    }
  }

  containerClose(kind: ContainerSound, pos: Pos): void {
    const v = this.voice(pos, 0.6);
    if (!v) return;
    const [out, t] = v;
    if (kind === 'bag') this.zip(out, t, 0.35, false);
    else if (kind === 'locker' || kind === 'trunk') {
      this.tone(out, t, { f: kind === 'trunk' ? 120 : 320, f2: kind === 'trunk' ? 90 : 280, dur: 0.2, peak: 0.4 });
      for (const f of [700, 1100]) this.tone(out, t, { f, dur: 0.25, peak: 0.04 });
    } else if (kind === 'fridge') this.noiseHit(out, t, { type: 'lowpass', f: 350, dur: 0.12, peak: 0.45 });
    else if (kind !== 'shelf') {
      this.noiseHit(out, t, { type: 'lowpass', f: 420, dur: 0.08, peak: 0.45 });
      this.tone(out, t, { f: 130, dur: 0.08, peak: 0.2 });
    }
  }

  /** Rummaging sound while a search runs (call update() every frame); null stops it. */
  searching(kind: ContainerSound | null, pos?: Pos): void {
    this.search = kind && pos ? { kind, pos, t: 0 } : null;
  }

  item(kind: ItemSound): void {
    const v = this.voice(null, 0.4);
    if (!v) return;
    const [out, t] = v;
    switch (kind) {
      case 'click':
        // The flashlight's rubber button: a soft tick and the spring under it.
        this.noiseHit(out, t, { type: 'bandpass', f: 3200, q: 2, dur: 0.018, peak: 0.22 });
        this.tone(out, t + 0.004, { f: 1650, dur: 0.025, peak: 0.04 });
        this.noiseHit(out, t + 0.05, { type: 'bandpass', f: 2400, q: 2, dur: 0.015, peak: 0.1 });
        break;
      case 'pick':
        this.noiseHit(out, t, { type: 'lowpass', f: 900, dur: 0.06, peak: 0.25 });
        this.noiseHit(out, t + 0.03, { type: 'bandpass', f: 2200, q: 1, dur: 0.08, peak: 0.06 });
        break;
      case 'move':
      case 'drop':
        this.noiseHit(out, t, { type: 'lowpass', f: kind === 'drop' ? 500 : 800, dur: 0.06, peak: 0.22 });
        break;
      case 'drag':
        this.tone(out, t, { f: 1200, dur: 0.02, peak: 0.03 });
        break;
      case 'cloth':
        for (let i = 0; i < 3; i++) this.noiseHit(out, t + i * 0.12, { type: 'bandpass', f: 1400 + i * 300, q: 0.7, dur: 0.22, peak: 0.12, attack: 0.08 });
        break;
      case 'weapon':
        this.tone(out, t, { f: 380, dur: 0.06, peak: 0.2 });
        this.tone(out, t + 0.02, { f: 2600, dur: 0.18, peak: 0.03 });
        this.noiseHit(out, t, { type: 'bandpass', f: 600, f2: 1400, q: 1, dur: 0.2, peak: 0.08, attack: 0.1 });
        break;
      case 'eat':
        for (let i = 0; i < 4; i++) {
          this.noiseHit(out, t + i * 0.18, { type: 'bandpass', f: 1800 + Math.random() * 800, q: 1.5, dur: 0.07, peak: 0.25 });
          this.noiseHit(out, t + i * 0.18 + 0.03, { type: 'highpass', f: 4000, dur: 0.03, peak: 0.08 });
        }
        break;
      case 'drink':
        for (let i = 0; i < 3; i++) this.tone(out, t + i * 0.32, { f: 260, f2: 120, dur: 0.14, peak: 0.25, lp: 700 });
        break;
      case 'bandage':
        this.noiseHit(out, t, { type: 'bandpass', f: 1800, f2: 4200, q: 1.2, dur: 0.35, peak: 0.18, attack: 0.05 });
        this.noiseHit(out, t + 0.4, { type: 'bandpass', f: 1200, q: 0.7, dur: 0.4, peak: 0.08, attack: 0.15 });
        break;
      case 'invOpen':
        this.zip(out, t, 0.22, true);
        break;
      case 'invClose':
        this.zip(out, t, 0.2, false);
        break;
    }
  }

  /** Per frame: rummaging bursts while searching. */
  update(dt: number): void {
    const s = this.search;
    if (!s) return;
    s.t -= dt;
    if (s.t > 0) return;
    s.t = 0.06 + Math.random() * 0.16;
    const v = this.voice(s.pos, 0.2);
    if (!v) return;
    const [out, t] = v;
    switch (s.kind) {
      case 'drawer':
      case 'shelf':
      case 'box':
        // Paper and small things.
        this.noiseHit(out, t, { type: 'bandpass', f: 2500 + Math.random() * 2000, q: 0.8, dur: 0.05 + Math.random() * 0.1, peak: 0.12 });
        if (Math.random() < 0.25) this.noiseHit(out, t, { type: 'lowpass', f: 500, dur: 0.05, peak: 0.12 });
        break;
      case 'locker':
      case 'trunk':
        this.tone(out, t, { f: 1200 + Math.random() * 2400, dur: 0.09, peak: 0.04 });
        this.noiseHit(out, t, { type: 'bandpass', f: 1800, q: 2, dur: 0.04, peak: 0.08 });
        break;
      case 'bag':
      case 'woodDoor':
        // Fabric.
        this.noiseHit(out, t, { type: 'bandpass', f: 1200 + Math.random() * 800, q: 0.6, dur: 0.18 + Math.random() * 0.2, peak: 0.07, attack: 0.06 });
        break;
      case 'fridge':
        this.tone(out, t, { f: 1800 + Math.random() * 1600, dur: 0.12, peak: 0.04 });
        break;
      case 'crate':
        this.tone(out, t, { f: 200 + Math.random() * 150, dur: 0.07, peak: 0.12 });
        this.noiseHit(out, t, { type: 'bandpass', f: 900, q: 1, dur: 0.08, peak: 0.08 });
        break;
      case 'trash':
        this.noiseHit(out, t, { type: 'highpass', f: 2500 + Math.random() * 2500, dur: 0.04 + Math.random() * 0.06, peak: 0.1 });
        break;
    }
  }

  // ── Building blocks ───────────────────────────────────────────────────────

  /** Create the context (call from a user gesture). */
  start(): void {
    this.ensure();
    if (!this.hardMute) void this.ac?.resume();
  }

  private ensure(): void {
    if (this.ac) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ac = new Ctor();
    this.ac = ac;
    this.master = ac.createGain();
    this.master.connect(ac.destination);
    this.world = ac.createGain();
    this.muffle = ac.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.world.connect(this.muffle).connect(this.master);
    this.ui = ac.createGain();
    this.ui.connect(this.master);
    const len = ac.sampleRate;
    this.noise = ac.createBuffer(1, len, ac.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    // Reverb: 1.4 s of decaying stereo noise.
    const ir = ac.createBuffer(2, Math.floor(ac.sampleRate * 1.4), ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
    }
    const conv = ac.createConvolver();
    conv.buffer = ir;
    this.send = ac.createGain();
    this.send.gain.value = 0.1;
    this.world.connect(this.send).connect(conv).connect(this.master);
    this.samples = new Samples(ac);
    this.samples.load();
    this.apply();
  }

  /**
   * A recorded sound of the group into `out` at `t`: `rate` its speed (and pitch), `vary` a random ± on it
   * (0.1: ±10%), `gain` its level. False when the group has not loaded (the caller synthesizes instead).
   */
  private sample(out: Out, t: number, g: SampleGroup, o: { rate?: number; vary?: number; gain?: number } = {}): boolean {
    const buf = this.samples?.pick(g);
    if (!buf || !this.ac) return false;
    const src = this.ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.vary ?? 0.05));
    const gn = this.ac.createGain();
    gn.gain.value = o.gain ?? 1;
    src.connect(gn).connect(out);
    src.start(t);
    return true;
  }

  private apply(): void {
    const ac = this.ac;
    if (!ac || !this.master || !this.world) return;
    const t = ac.currentTime;
    this.master.gain.setTargetAtTime(this.hardMute ? 0 : this.volume, t, 0.03);
    this.world.gain.setTargetAtTime(this.worldMute ? 0 : 1, t, 0.05);
    if (this.hardMute) void ac.suspend();
    else void ac.resume();
  }

  /** Room in a group for one more sound lasting `life` s (see GROUPS); false = skip it. */
  private claim(group: Group, life: number): boolean {
    const ac = this.ac;
    if (!ac) return false;
    const now = ac.currentTime;
    const { max, gap } = GROUPS[group];
    const ends = (this.groupEnds.get(group) ?? []).filter((e) => e > now);
    if (ends.length >= max || now - (this.groupLast.get(group) ?? -1) < gap) {
      this.groupEnds.set(group, ends);
      return false;
    }
    ends.push(now + life);
    this.groupEnds.set(group, ends);
    this.groupLast.set(group, now);
    return true;
  }

  /**
   * A voice: its own gain into the world bus (through a panner if positioned) or the UI bus. Returns
   * the node to play into and the start time, or null when muted / over the voice limit.
   */
  private voice(pos: Pos | null, life: number, ref = 1.5, priority = false): [Out, number] | null {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || this.hardMute || !this.world || !this.ui) return null;
    if (pos && this.worldMute) return null;
    if (this.voices >= MAX_VOICES + (priority ? PRIORITY_VOICES : 0)) return null;
    this.voices++;
    window.setTimeout(() => this.voices--, (life + 0.6) * 1000);
    const g = ac.createGain();
    if (pos) {
      const p = ac.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.maxDistance = 60;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(this.world);
    } else g.connect(this.ui);
    return [g, ac.currentTime + 0.005];
  }

  /** Filtered noise burst with an exponential tail; optional filter sweep f → f2. */
  /**
   * An animal throat: a buzzing voice (sawtooth) and torn breath (noise) through two vocal-tract
   * resonances, chopped by a fast flutter (the rattle of a growl), driven into distortion. `f` → `f2`
   * the voice's pitch, `form` the first resonance (low = a growl, high = a snarl or a shriek).
   */
  private growl(out: Out, t: number, o: { f: number; f2: number; dur: number; peak: number; flutter: number; form: number; form2?: number; breath?: number; attack?: number }): void {
    const ac = this.ac!;
    const end = t + o.dur;
    const voice = ac.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(o.f, t);
    voice.frequency.exponentialRampToValueAtTime(o.f2, end);
    // Pitch wobble: an unsteady, strained throat.
    const wob = ac.createOscillator();
    wob.frequency.value = 5 + Math.random() * 4;
    const wobG = ac.createGain();
    wobG.gain.value = o.f * 0.06;
    wob.connect(wobG).connect(voice.frequency);
    const breath = ac.createBufferSource();
    breath.buffer = this.noise;
    breath.loop = true;
    const breathG = ac.createGain();
    breathG.gain.value = o.breath ?? 0.6;
    const mix = ac.createGain();
    voice.connect(mix);
    breath.connect(breathG).connect(mix);
    // Flutter: amplitude chopped 20–60 times a second — what makes it a growl, not a moan.
    const chop = ac.createGain();
    chop.gain.value = 0.55;
    const flutter = ac.createOscillator();
    flutter.type = 'square';
    flutter.frequency.value = o.flutter;
    const depth = ac.createGain();
    depth.gain.value = 0.45;
    flutter.connect(depth).connect(chop.gain);
    // Throat: two resonances, the first sliding a little (the mouth opening).
    const f1 = ac.createBiquadFilter();
    f1.type = 'bandpass';
    f1.Q.value = 3;
    f1.frequency.setValueAtTime(o.form, t);
    f1.frequency.exponentialRampToValueAtTime(o.form2 ?? o.form * 0.8, end);
    const f2 = ac.createBiquadFilter();
    f2.type = 'bandpass';
    f2.Q.value = 5;
    f2.frequency.value = o.form * 2.6;
    const body = ac.createGain();
    // Rough: soft clipping.
    const shaper = ac.createWaveShaper();
    shaper.curve = DISTORT;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.peak, t + (o.attack ?? 0.06));
    g.gain.setValueAtTime(o.peak, t + o.dur * 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    mix.connect(chop);
    chop.connect(f1).connect(body);
    chop.connect(f2).connect(body);
    body.connect(shaper).connect(g).connect(out);
    for (const n of [voice, wob, breath, flutter]) {
      n.start(t);
      n.stop(end + 0.03);
    }
  }

  private noiseHit(out: Out, t: number, o: { type: BiquadFilterType; f: number; f2?: number; q?: number; dur: number; peak: number; attack?: number }): void {
    const ac = this.ac!;
    if (o.peak <= 0.001) return;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const flt = ac.createBiquadFilter();
    flt.type = o.type;
    flt.frequency.setValueAtTime(o.f, t);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    flt.Q.value = o.q ?? 0.7;
    const g = ac.createGain();
    const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + o.dur);
    src.connect(flt).connect(g).connect(out);
    src.start(t, Math.random() * 0.8);
    src.stop(t + a + o.dur + 0.02);
  }

  /** Decaying tone (sine unless given), optional glide f → f2, low-pass, vibrato (Hz). */
  private tone(out: Out, t: number, o: { f: number; f2?: number; dur: number; peak: number; type?: OscillatorType; lp?: number; vibrato?: number }): void {
    const ac = this.ac!;
    if (o.peak <= 0.001) return;
    const osc = ac.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    let node: AudioNode = osc;
    if (o.lp) {
      const flt = ac.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = o.lp;
      node = node.connect(flt);
    }
    if (o.vibrato) {
      const lfo = ac.createOscillator();
      lfo.frequency.value = o.vibrato;
      const depth = ac.createGain();
      depth.gain.value = o.f * 0.04;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + o.dur + 0.02);
    }
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + o.dur + 0.02);
  }

  /** Zipper: a run of tiny clicks, speeding up (open) or slowing down (close). */
  private zip(out: Out, t: number, dur: number, up: boolean): void {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      const at = t + dur * (up ? k * k : Math.sqrt(k));
      this.noiseHit(out, at, { type: 'bandpass', f: 3200 + (up ? k : 1 - k) * 1800, q: 3, dur: 0.012, peak: 0.12 });
    }
  }
}

/** The one sound system. */
export const sfx = new Sound();
