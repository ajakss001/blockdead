import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameLoop } from '../core/GameLoop';
import { type SampleGroup, Samples } from './samples';

/*
 * Game audio graph backed exclusively by recorded WAV/MP3 sample banks (zero legacy oscillator
 * or procedural noise-generator synthesis):
 *
 *   world bus ─┬─────────────────────────────► glueComp -> makeup -> limiter -> shaper -> master
 *              └─► send (0.02..0.20) ─► conv ┘
 *   ui bus ────────────────────────────────► brickwallLimiter -> ceilingShaper -> master
 */

export type StepSurface = 'asphalt' | 'concrete' | 'tile' | 'wood' | 'metal' | 'glass' | 'grass' | 'water';
/** Continuous building spots (only `tv` has a recorded WAV loop; the rest await recordings). */
export type LoopKind = 'fridge' | 'tv' | 'flies' | 'fire' | 'hiss' | 'rainTin' | 'siren' | 'speaker' | 'bell' | 'music' | 'sparks';
export const LOUD_LOOPS: readonly LoopKind[] = ['siren', 'speaker', 'bell', 'music'];
export type Gait = 'walk' | 'run' | 'crouch';
export type HitMaterial = 'wood' | 'metal' | 'concrete' | 'glass' | 'soft';
export type ContainerSound = 'woodDoor' | 'drawer' | 'locker' | 'fridge' | 'trunk' | 'bag' | 'box' | 'trash' | 'crate' | 'shelf';
export type ItemSound = 'click' | 'pick' | 'move' | 'cloth' | 'weapon' | 'vest' | 'helmet' | 'eat' | 'drink' | 'bandage' | 'invOpen' | 'invClose' | 'drag' | 'drop';
export type SwingKind = 'heavy' | 'blade' | 'fist';
export type FleshBlow = 'blunt' | 'metal' | 'chop' | 'stab' | 'fist';
export type GunSound = 'pistol' | 'pistol45' | 'rifle' | 'ak' | 'shotgun' | 'hunting' | 'rpg';
export type MixBus = 'weapons' | 'footsteps' | 'foley' | 'env' | 'music' | 'ui' | 'world';
export type GunMech =
  | 'magOut'
  | 'magIn'
  | 'rack'
  | 'slideLock'
  | 'boltCatch'
  | 'pump'
  | 'bolt'
  | 'shell'
  | 'rocket'
  | 'mode'
  | 'dry'
  | 'jam'
  | 'draw'
  | 'holster'
  | 'lastRounds'
  | 'magCheck'
  | 'reloadRifle'
  | 'adsPistol';
export type EchoPlace = 'indoor' | 'street' | 'alley';
export type BulletHit = 'concrete' | 'metal' | 'wood' | 'glass' | 'car' | 'flesh' | 'soft';
export type Attacked = 'blocked' | 'scratch' | 'bite';

export interface Pos {
  x: number;
  y: number;
  z: number;
}

/** Game audio events whose legacy Web Audio synthesis was removed and that currently lack a dedicated WAV recording. */
export const MISSING_WAV_EVENTS: readonly string[] = [
  'footstep:water',
  'item:bandage',
  'item:eat',
  'item:drink',
  'door:glass',
  'door:stuck',
  'weapon:jam',
  'weapon:rocketLoad',
  'weapon:lastRounds',
  'env:drip',
  'env:pipe',
  'env:crow',
  'env:carAlarm',
  'env:phoneRing',
  'env:street',
  'loop:fridge',
  'loop:siren',
  'loop:bell',
  'loop:speaker',
  'loop:music',
  'loop:sparks',
  'loop:fire',
  'loop:hiss',
  'loop:rainTin',
  'loop:flies',
  'combat:hitMarker',
  'combat:attacked',
  'combat:ouch',
  'combat:bulletHitSoftWoodConcreteFlesh',
  'melee:chopStabFistWoodConcrete',
  'zombie:moanTeethBangCrackHit',
  'player:dyingHum',
  'ambient:windRainCricketsBirdsRadio',
  'vehicle:engineHornStarterDoor',
];

const MAX_VOICES = 22;
const PRIORITY_VOICES = 6;
const LOOP_SLOTS = 4;

interface LoopSlot {
  key: number;
  kind: LoopKind;
  gain: GainNode;
  panner: PannerNode;
  sources: AudioScheduledSourceNode[];
}

const GROUPS = {
  zVoice: { max: 4, gap: 0.07 },
  zLunge: { max: 2, gap: 0.15 },
  zHurt: { max: 2, gap: 0.05 },
  zStep: { max: 4, gap: 0.04 },
  zBang: { max: 2, gap: 0.12 },
  strike: { max: 2, gap: 0.06 },
  house: { max: 2, gap: 0.3 },
} as const;
type Group = keyof typeof GROUPS;

/** Master brickwall ceiling: -1.0 dBFS (~0.89125) to guarantee zero digital clipping. */
const MASTER_CEILING_DBFS = -1.0;
const MASTER_CEILING = Math.pow(10, MASTER_CEILING_DBFS / 20);
/** Soft-knee maximizer wave-shaper capped strictly at -1.0 dBFS. */
const MAXIMIZER_CURVE = (() => {
  const n = 4096;
  const c = new Float32Array(n);
  const kneeStart = 0.76;
  const head = MASTER_CEILING - kneeStart;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    if (ax <= kneeStart) c[i] = x;
    else c[i] = Math.sign(x) * (kneeStart + head * Math.tanh((ax - kneeStart) / head));
  }
  return c;
})();
const CEILING_MAX_ABS = MAXIMIZER_CURVE.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const VOLUME_KEY = 'blockdead.volume';

function readStoredVolume(): number {
  try {
    return typeof localStorage !== 'undefined' ? Number(localStorage.getItem(VOLUME_KEY) ?? 0.8) : 0.8;
  } catch {
    return 0.8;
  }
}

function writeStoredVolume(v: number): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VOLUME_KEY, String(v));
  } catch {}
}

function scheduleTimeout(fn: () => void, ms: number): void {
  if (typeof window !== 'undefined') window.setTimeout(fn, ms);
  else globalThis.setTimeout(fn, ms);
}

/** Container type (data/loot) → sound category. */
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
  bodyTwin: 'bag',
  bodyBandit: 'bag',
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

export class Sound {
  ac: AudioContext | null = null;
  private master: GainNode | null = null;
  world: GainNode | null = null;
  private ui: GainNode | null = null;
  private weaponsBus: GainNode | null = null;
  private footstepsBus: GainNode | null = null;
  private foleyBus: GainNode | null = null;
  private envBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private glueComp: DynamicsCompressorNode | null = null;
  private makeupGain: GainNode | null = null;
  private brickwallLimiter: DynamicsCompressorNode | null = null;
  private ceilingShaper: WaveShaperNode | null = null;
  private muffle: BiquadFilterNode | null = null;
  private samples: Samples | null = null;
  private send: GainNode | null = null;
  /** Allocated only to keep external AmbientAudio / VehicleAudio init checks intact; never played by Sound. */
  noise: AudioBuffer | null = null;
  private voiceEnds: number[] = [];
  private playerStepsPlayed = 0;
  private nextWoodCreakAt = 0;
  private readonly groupEnds = new Map<Group, number[]>();
  private readonly groupLast = new Map<Group, number>();
  private volume = readStoredVolume();
  private hardMute = false;
  private worldMute = false;
  private readonly loopSlots: LoopSlot[] = [];
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private occlusionCheck: ((lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => boolean) | null = null;
  private breathVoice: { src: AudioBufferSourceNode; gain: GainNode; masked: boolean } | null = null;
  private heartVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private lootVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private worldLootVoice: { src: AudioBufferSourceNode; gain: GainNode; panner: PannerNode } | null = null;
  private activeUiVoice: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantLootLoop = false;

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
    writeStoredVolume(this.volume);
    this.apply();
  }

  getDiagnostics() {
    return {
      ready: !!this.ac,
      buses: {
        master: !!this.master,
        world: !!this.world,
        ui: !!this.ui,
        weapons: !!this.weaponsBus,
        footsteps: !!this.footstepsBus,
        foley: !!this.foleyBus,
        env: !!this.envBus,
        music: !!this.musicBus,
      },
      panningModel: 'HRTF' as const,
      mastering: {
        glueThreshold: this.glueComp?.threshold.value ?? null,
        makeupGain: this.makeupGain?.gain.value ?? null,
        limiterThreshold: this.brickwallLimiter?.threshold.value ?? null,
        limiterRatio: this.brickwallLimiter?.ratio.value ?? null,
        ceilingDbfs: MASTER_CEILING_DBFS,
        ceilingLinear: MASTER_CEILING,
        shaperMaxAbs: CEILING_MAX_ABS,
      },
      activeVoices: this.pruneVoices(),
      playerStepsPlayed: this.playerStepsPlayed,
      loadedSampleGroups: this.samples?.groupCount ?? 0,
    };
  }

  setMuffle(k: number): void {
    if (!this.ac || !this.muffle) return;
    this.muffle.frequency.setTargetAtTime(20000 * Math.pow(0.012, k), this.ac.currentTime, 0.1);
  }

  /** Reverb amount: 0.02 open field, ~0.08 downtown, 0.15–0.20 indoor rooms/stairwells. */
  setRoom(wet: number): void {
    if (this.ac && this.send) this.send.gain.setTargetAtTime(wet, this.ac.currentTime, 0.25);
  }

  setOcclusionCheck(fn: ((lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => boolean) | null): void {
    this.occlusionCheck = fn;
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    this.lx = x;
    this.ly = y;
    this.lz = z;
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

  private maybeWoodCreak(out: Out, t: number, sharp: boolean, baseGain: number): void {
    if (t < this.nextWoodCreakAt || Math.random() >= 0.005) return;
    if (this.sample(out, t + 0.02 + Math.random() * 0.02, sharp ? 'woodCreakSharp' : 'woodCreak', { vary: 0.08, gain: baseGain * 0.65 })) {
      this.nextWoodCreakAt = t + 10.0 + Math.random() * 5.0;
    }
  }

  // ── Game sounds ────────────────────────────────────────────────────────────

  step(surface: StepSurface, gait: Gait, pos: Pos, loud = 1, isPlayer = false, foot?: 0 | 1): void {
    const v = isPlayer ? this.playerStepVoice() : this.voice(pos, 0.45, 1.5, false, 'footsteps');
    if (!v) return;
    if (isPlayer) this.playerStepsPlayed++;
    const [out, t] = v;
    const diffFloor = !isPlayer && Math.abs(pos.y - this.ly) > 2.5;
    const surfBal = surface === 'grass' ? 0.86 : surface === 'metal' ? 0.92 : 1;
    const footWeight = foot === undefined ? 1 : foot === 0 ? 0.96 : 1.04;
    const footPitch = foot === undefined ? 1 : foot === 0 ? 0.985 : 1.015;
    const volRand = 0.9 + Math.random() * 0.1;
    const g = (gait === 'run' ? 0.76 : gait === 'walk' ? 0.56 : 0.34) * loud * surfBal * footWeight * volRand;

    if (diffFloor && this.sample(out, t, 'stepMuffled', { rate: footPitch, vary: 0.06, gain: g * 0.9 })) return;

    let grp: SampleGroup | null = null;
    if (surface === 'glass') {
      grp = gait === 'crouch' ? 'stepGlassCrouch' : gait === 'run' ? 'stepGlassRun' : 'stepGlassWalk';
    } else if (gait === 'crouch') {
      grp = 'stepCrouch';
    } else if (surface === 'asphalt') {
      grp = gait === 'run' ? 'stepAsphaltRun' : 'stepAsphaltWalk';
    } else if (surface === 'grass') {
      grp = gait === 'run' ? 'stepDirtRun' : 'stepDirtWalk';
    } else if (surface === 'wood') {
      grp = gait === 'run' ? 'stepWoodRun' : 'stepWoodWalk';
    } else if (surface === 'metal') {
      grp = gait === 'run' ? 'stepMetalRun' : 'stepMetalWalk';
    } else if (surface === 'concrete' || surface === 'tile') {
      grp = gait === 'run' ? 'stepConcreteRun' : 'stepConcreteWalk';
    }

    if (grp && this.sample(out, t, grp, { rate: footPitch, vary: 0.05, gain: g })) {
      if (surface === 'wood') this.maybeWoodCreak(out, t, false, 0.42 * volRand);
    }
  }

  pivot(surface: StepSurface, pos: Pos, fast = false): void {
    const v = this.voice(pos, 0.55, 1.5, true, 'footsteps');
    if (!v) return;
    const [out, t] = v;
    const gain = 0.68 + Math.random() * 0.16;
    let grp: SampleGroup = 'pivotAsphalt';
    if (fast && (surface === 'asphalt' || surface === 'concrete' || surface === 'tile')) grp = 'pivotAsphaltFast';
    else if (surface === 'wood') grp = 'pivotWood';
    else if (surface === 'concrete' || surface === 'tile' || surface === 'metal') grp = 'pivotConcrete';
    else if (surface === 'grass' || surface === 'water') grp = 'pivotDirt';

    if (this.sample(out, t, grp, { vary: 0.07, gain })) {
      if (surface === 'wood') this.maybeWoodCreak(out, t, true, 0.5);
    }
  }

  crouch(down: boolean, pos: Pos): void {
    const v = this.voice(pos, 0.5, 1.5, true, 'foley');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, down ? 'crouchDown' : 'standUp', { vary: 0.06, gain: 0.68 });
  }

  ads(pistol: boolean): void {
    const v = this.voice(null, 0.4, 1.5, false, 'foley');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, pistol ? 'adsPistol' : 'adsRifle', { vary: 0.05, gain: 0.7 });
  }

  armorHit(): void {
    const v = this.voice(null, 0.55, 1, true, 'weapons');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'armorHit', { vary: 0.06, gain: 0.92 });
  }

  // ── Buildings & environment ────────────────────────────────────────────────

  drip(_pos: Pos, _tap = false): void {}

  house(kind: 'pipe' | 'creak' | 'above', pos: Pos): void {
    if (kind === 'pipe') return;
    if (!this.claim('house', kind === 'above' ? 4 : 1.6)) return;
    const v = this.voice(pos, kind === 'above' ? 4 : 1.8, 2.5, false, kind === 'above' ? 'footsteps' : 'env');
    if (!v) return;
    const [out, t] = v;
    if (kind === 'creak') {
      this.sample(out, t, 'buildingCreak', { vary: 0.08, gain: 0.42 });
    } else {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        this.sample(out, t + i * (0.48 + Math.random() * 0.14), 'stepMuffled', { vary: 0.08, gain: 0.55 });
      }
      if (Math.random() < 0.1) this.sample(out, t + n * 0.55, 'buildingCreak', { vary: 0.07, gain: 0.36 });
    }
  }

  draftDoor(pos: Pos, dur: number, creaky: boolean, pitch: number): void {
    const v = this.voice(pos, dur + 0.5, 1.5, false, 'env');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'doorWood', { rate: pitch, vary: 0.06, gain: creaky ? 0.38 : 0.25 });
  }

  crow(_pos: Pos, _n: number): void {}
  carAlarm(_pos: Pos, _dur: number): void {}
  street(_kind: 'squeak' | 'cart' | 'rattle' | 'sign', _pos: Pos): void {}
  phoneRing(_pos: Pos): void {}

  /** Continuous 3D building ambient loops (currently CRT TV static via recorded tv_static.wav). */
  loops(list: readonly { key: number; kind: LoopKind; x: number; y: number; z: number }[]): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.world || !this.samples) return;
    const now = ac.currentTime;
    const want = list.filter((w) => w.kind === 'tv').slice(0, LOOP_SLOTS);
    for (let i = this.loopSlots.length - 1; i >= 0; i--) {
      const slot = this.loopSlots[i];
      if (want.some((w) => w.key === slot.key)) continue;
      slot.gain.gain.setTargetAtTime(0, now, 0.25);
      for (const n of slot.sources) {
        try { n.stop(now + 1.2); } catch {}
      }
      scheduleTimeout(() => slot.panner.disconnect(), 1400);
      this.loopSlots.splice(i, 1);
    }
    for (const w of want) {
      let slot = this.loopSlots.find((l) => l.key === w.key);
      if (!slot) {
        slot = this.loopSlot(ac, w.key, w.kind) ?? undefined;
        if (!slot) continue;
        this.loopSlots.push(slot);
        if (slot.panner.positionX) {
          slot.panner.positionX.value = w.x;
          slot.panner.positionY.value = w.y;
          slot.panner.positionZ.value = w.z;
        } else slot.panner.setPosition(w.x, w.y, w.z);
      }
    }
  }

  private loopSlot(ac: AudioContext, key: number, kind: LoopKind): LoopSlot | null {
    if (kind !== 'tv') return null;
    const buf = this.samples?.get('tvStatic');
    if (!buf) return null;
    const panner = ac.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 16;
    panner.rolloffFactor = 1.6;
    const gain = ac.createGain();
    gain.gain.value = 0;
    gain.connect(panner).connect(this.envBus ?? this.world!);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    const now = ac.currentTime;
    src.start(now);
    gain.gain.setTargetAtTime(0.24, now, 0.3);
    return { key, kind, gain, panner, sources: [src] };
  }

  jump(pos: Pos): void {
    const v = this.voice(pos, 0.45, 1.5, true, 'foley');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'jumpPush', { vary: 0.06, gain: 0.72 });
  }

  land(surface: StepSurface, pos: Pos, speed: number): void {
    const k = Math.min(1.6, speed / 3);
    const v = this.voice(pos, 0.55, 1.5, true, 'footsteps');
    if (!v) return;
    const [out, t] = v;
    const grp: SampleGroup = surface === 'metal' ? 'landMetal' : 'landHard';
    if (this.sample(out, t, grp, { vary: 0.06, gain: Math.min(1, 0.58 + k * 0.28) })) {
      if (surface === 'wood') this.maybeWoodCreak(out, t, true, 0.52);
      else if (surface === 'glass') this.sample(out, t, 'stepGlassRun', { vary: 0.08, gain: 0.65 });
    }
  }

  swing(kind: SwingKind, dur: number, pos: Pos): void {
    if (kind === 'fist') return;
    const v = this.voice(pos, 0.5, 1.5, true, 'weapons');
    if (!v || !this.ac) return;
    const [out, t] = v;
    const lp = this.ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    lp.Q.value = 0.7;
    lp.connect(out);
    const rate = Math.min(1.04, Math.max(0.86, 0.32 / Math.max(0.18, dur)));
    this.sample(lp, t, 'swing', {
      rate,
      vary: 0.04,
      gain: kind === 'blade' ? 0.34 : 0.48,
    });
  }

  gunShot(kind: GunSound, pos: Pos | null, suppressed: boolean, _place: EchoPlace): void {
    const v = this.voice(pos, 2.1, 6, true, 'weapons');
    if (!v) return;
    const [out, t] = v;
    const shotGrp: SampleGroup = suppressed
      ? kind === 'pistol' || kind === 'pistol45'
        ? 'shotPistolSup'
        : 'shotRifleSup'
      : kind === 'ak'
        ? 'shotAk'
        : kind === 'rifle'
          ? 'shotM4'
          : kind === 'shotgun'
            ? 'shotShotgun'
            : kind === 'hunting'
              ? 'shotHunting'
              : kind === 'rpg'
                ? 'shotRpg'
                : 'shotPistol';
    this.sample(out, t, shotGrp, { vary: 0.035, gain: suppressed ? 0.8 : 0.95 });
  }

  gunMech(kind: GunMech, pitch = 1): void {
    const v = this.voice(null, kind === 'reloadRifle' ? 1.8 : 0.85, 1.5, true, this.worldMute ? 'ui' : 'weapons');
    if (!v) return;
    const [out, t] = v;
    if (kind === 'dry') this.sample(out, t, 'gunDry', { rate: pitch, vary: 0.04, gain: 0.78 });
    else if (kind === 'pump') this.sample(out, t, 'gunPump', { rate: pitch, vary: 0.04, gain: 0.8 });
    else if (kind === 'bolt') this.sample(out, t, 'gunBolt', { rate: pitch, vary: 0.04, gain: 0.8 });
    else if (kind === 'magCheck') this.sample(out, t, 'gunMagCheck', { rate: pitch, vary: 0.04, gain: 0.74 });
    else if (kind === 'reloadRifle') this.sample(out, t, 'gunReloadRifle', { rate: pitch, vary: 0.03, gain: 0.86 });
    else if (kind === 'magOut') this.sample(out, t, 'gunMagOut', { rate: pitch, vary: 0.04, gain: 0.82 });
    else if (kind === 'magIn') this.sample(out, t, 'gunMagIn', { rate: pitch, vary: 0.04, gain: 0.88 });
    else if (kind === 'adsPistol') this.sample(out, t, 'adsPistol', { rate: pitch, vary: 0.04, gain: 0.54 });
    else if (kind === 'rack' || kind === 'boltCatch' || kind === 'slideLock') {
      const boltRate = pitch * (kind === 'rack' ? 1.08 : 1.24);
      this.sample(out, t, 'gunBolt', { rate: boltRate, vary: 0.04, gain: kind === 'slideLock' ? 0.52 : 0.64 });
    } else if (kind === 'draw' || kind === 'holster') {
      this.sample(out, t, 'uiEquipWeapon', { rate: kind === 'draw' ? pitch : pitch * 0.94, vary: 0.05, gain: 0.62 });
    } else if (kind === 'mode') {
      this.sample(out, t, 'uiItemMove', { rate: 1.18 * pitch, vary: 0.04, gain: 1.05 });
    } else if (kind === 'shell') {
      this.sample(out, t, 'uiItemMove', { rate: pitch, vary: 0.05, gain: 0.55 });
    }
  }

  casing(pos: Pos, shell: boolean, surfaceOrSoft: StepSurface | boolean = 'asphalt'): void {
    const v = this.voice(pos, 0.7, 1.8, false, 'weapons');
    if (!v) return;
    const [out, t] = v;
    const grp: SampleGroup = shell
      ? 'casingShotgun'
      : surfaceOrSoft === 'wood'
        ? 'casingWood'
        : surfaceOrSoft === 'grass'
          ? 'casingDirt'
          : surfaceOrSoft === 'metal'
            ? 'casingMetal'
            : 'casingAsphalt';
    this.sample(out, t, grp, { rate: 1.01, vary: 0.11, gain: 0.56 });
  }

  magDrop(pos: Pos): void {
    const v = this.voice(pos, 0.9, 1.5, false, 'weapons');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'magDrop', { rate: 0.72, vary: 0.06, gain: 0.55 });
  }

  bulletHit(kind: BulletHit, pos: Pos): void {
    if (kind === 'glass') {
      this.hit('glass', pos, 1);
      return;
    }
    if (kind !== 'metal' && kind !== 'car') return;
    const v = this.voice(pos, 0.9, 2, true, 'weapons');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'bulletMetal', { rate: kind === 'car' ? 0.75 : 1, vary: 0.1, gain: 0.6 });
  }

  hitMarker(_head: boolean): void {}

  explosion(pos: Pos): void {
    const v = this.voice(pos, 4.5, 12, true, 'weapons');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'rpgExplosion', { vary: 0.05, gain: 1 });
  }

  glassBreak(hitPos: Pos, floorPos: Pos): void {
    const vHit = this.voice(hitPos, 1.6, 1.8, true, 'env');
    if (vHit) {
      const [outHit, tHit] = vHit;
      this.sample(outHit, tHit, 'glassBreak', { vary: 0.06, gain: 0.88 });
    }
    const vFloor = this.voice(floorPos, 1.1, 1.5, false, 'env');
    if (vFloor) {
      const [outFloor, tFloor] = vFloor;
      this.sample(outFloor, tFloor + 0.3, 'glassSettle', { vary: 0.08, gain: 0.72 });
    }
  }

  hit(material: HitMaterial, pos: Pos, heavy = 1): void {
    if (material !== 'metal' && material !== 'glass') return;
    if (material === 'glass') {
      this.glassBreak(pos, { x: pos.x, y: Math.max(0, pos.y - 1.1), z: pos.z });
      return;
    }
    const v = this.voice(pos, 0.9, 1.5, false, 'weapons');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'hitMetal', { rate: 1.15 - heavy * 0.15, vary: 0.08, gain: 0.35 + 0.35 * heavy });
  }

  door(style: 'wood' | 'glass' | 'metal', open: boolean, pos: Pos, _creaky = false, pitch = 1): void {
    if (style === 'glass') return;
    const v = this.voice(pos, 1.1, 1.5, true, 'env');
    if (!v) return;
    const [out, t] = v;
    if (style === 'metal') this.sample(out, t, 'doorMetal', { rate: pitch, vary: 0.05, gain: open ? 0.82 : 0.72 });
    else this.sample(out, t, 'doorWood', { rate: pitch, vary: 0.06, gain: open ? 0.78 : 0.64 });
  }

  groan(_pos: Pos, _alarm: boolean): void {}
  doorStuck(_pos: Pos): void {}

  zombie(kind: 'moan' | 'rasp' | 'teeth' | 'step' | 'alarm' | 'bang' | 'crack' | 'hit' | 'die' | 'swing', pos: Pos, pitch = 1): void {
    const rec: SampleGroup | null =
      kind === 'alarm' ? 'zScream' : kind === 'swing' ? 'zAttack' : kind === 'rasp' ? 'zBreath' : kind === 'die' ? 'zDeath' : kind === 'step' ? 'stepAsphaltWalk' : null;
    if (!rec) return;
    const group: Group = kind === 'step' ? 'zStep' : kind === 'swing' ? 'zLunge' : kind === 'die' ? 'zHurt' : 'zVoice';
    if (!this.claim(group, kind === 'alarm' ? 1.4 : kind === 'step' ? 0.25 : 0.6)) return;
    const v = this.voice(pos, 1.6, kind === 'step' ? 1 : 2, kind === 'swing' || kind === 'die', kind === 'step' ? 'footsteps' : 'env');
    if (!v) return;
    const [out, t] = v;
    if (kind === 'step') {
      if (Math.abs(pos.y - this.ly) > 2.5 && this.sample(out, t, 'stepMuffled', { rate: pitch, vary: 0.08, gain: 0.55 })) return;
      this.sample(out, t, 'stepAsphaltWalk', { rate: pitch * 0.92, vary: 0.08, gain: 0.35 });
      return;
    }
    this.sample(out, t, rec, { rate: pitch, vary: 0.1, gain: kind === 'rasp' ? 0.5 : 0.7 });
  }

  strike(kind: FleshBlow, pos: Pos, _head: boolean, kill: boolean): void {
    if (kind !== 'blunt' && kind !== 'metal') return;
    if (!this.claim('strike', 0.4)) return;
    const v = this.voice(pos, 0.6, 2, true, 'weapons');
    if (!v) return;
    const [out, t] = v;
    this.sample(out, t, 'heavyHit', { vary: 0.08, gain: 0.8 * (kill ? 1.25 : 1) });
  }

  attacked(_kind: Attacked, _many = 1): void {}
  ouch(_hard: number): void {}

  containerOpen(kind: ContainerSound, pos: Pos): void {
    const v = this.voice(pos, 1.6, 1.5, false, 'foley');
    if (!v) return;
    const [out, t] = v;
    switch (kind) {
      case 'crate':
        this.sample(out, t, 'lootCrateWood', { vary: 0.05, gain: 0.78 });
        break;
      case 'woodDoor':
      case 'drawer':
        this.sample(out, t, 'lootDrawer', { vary: 0.05, gain: 0.76 });
        break;
      case 'box':
      case 'trash':
      case 'shelf':
        this.sample(out, t, 'lootBoxCardboard', { vary: 0.05, gain: 0.74 });
        break;
      case 'bag':
        this.sample(out, t, 'lootBagZip', { vary: 0.05, gain: 0.78 });
        break;
      case 'locker':
      case 'fridge':
      case 'trunk':
        this.sample(out, t, 'doorMetal', { rate: 1.15, vary: 0.05, gain: 0.52 });
        break;
    }
  }

  containerClose(kind: ContainerSound, pos: Pos): void {
    const v = this.voice(pos, 1.4, 1.5, false, 'foley');
    if (!v) return;
    const [out, t] = v;
    switch (kind) {
      case 'bag':
        this.sample(out, t, 'lootBagZip', { rate: 1.06, vary: 0.05, gain: 0.62 });
        break;
      case 'woodDoor':
      case 'drawer':
        this.sample(out, t, 'lootDrawer', { rate: 0.92, vary: 0.05, gain: 0.55 });
        break;
      case 'crate':
        this.sample(out, t, 'lootCrateWood', { rate: 0.9, vary: 0.05, gain: 0.55 });
        break;
      case 'box':
      case 'trash':
      case 'shelf':
        this.sample(out, t, 'lootBoxCardboard', { rate: 0.94, vary: 0.05, gain: 0.5 });
        break;
      case 'locker':
      case 'fridge':
      case 'trunk':
        this.sample(out, t, 'doorMetal', { rate: 0.92, vary: 0.05, gain: 0.45 });
        break;
    }
  }

  /** Spatialized rummaging loop using recorded loot_search.wav; null stops it. */
  searching(kind: ContainerSound | null, pos?: Pos): void {
    if (!kind || !pos) {
      this.stopWorldLoot();
      return;
    }
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || this.hardMute || this.worldMute || !this.world || !this.samples) return;
    const buf = this.samples.get('lootSearch');
    if (!buf) return;
    this.stopWorldLoot();
    const panner = ac.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 12;
    panner.rolloffFactor = 1.4;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y;
      panner.positionZ.value = pos.z;
    } else panner.setPosition(pos.x, pos.y, pos.z);
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain).connect(panner).connect(this.foleyBus ?? this.world);
    const now = ac.currentTime;
    src.start(now);
    gain.gain.setTargetAtTime(0.58, now, 0.06);
    this.worldLootVoice = { src, gain, panner };
  }

  private stopWorldLoot(): void {
    const wv = this.worldLootVoice;
    if (!wv) return;
    this.worldLootVoice = null;
    const ac = this.ac;
    const now = ac?.currentTime ?? 0;
    wv.gain.gain.setTargetAtTime(0, now, 0.05);
    scheduleTimeout(() => {
      try { wv.src.stop(); } catch {}
      try { wv.panner.disconnect(); } catch {}
    }, 220);
  }

  private playUiSample(out: Out, t: number, g: SampleGroup, o: { rate?: number; vary?: number; gain?: number } = {}): boolean {
    const ac = this.ac;
    const buf = this.samples?.pick(g);
    if (!buf || !ac) return false;
    const prev = this.activeUiVoice;
    if (prev) {
      try {
        prev.gain.gain.setTargetAtTime(0, ac.currentTime, 0.01);
        prev.src.stop(ac.currentTime + 0.03);
      } catch {}
      this.activeUiVoice = null;
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.vary ?? 0.04));
    const gn = ac.createGain();
    gn.gain.value = o.gain ?? 0.55;
    src.connect(gn).connect(out);
    src.start(t);
    this.activeUiVoice = { src, gain: gn };
    return true;
  }

  item(kind: ItemSound): void {
    const v = this.voice(null, 0.9, 1.5, true, 'ui');
    if (!v) return;
    const [out, t] = v;
    switch (kind) {
      case 'move':
      case 'pick':
      case 'drop':
        this.playUiSample(out, t, 'uiItemMove', { vary: 0.04, gain: 0.56 });
        break;
      case 'drag':
        this.playUiSample(out, t, 'uiItemMove', { vary: 0.04, gain: 0.36 });
        break;
      case 'click':
        this.playUiSample(out, t, 'uiItemMove', { vary: 0.04, gain: 0.45 });
        break;
      case 'weapon':
        this.playUiSample(out, t, 'uiEquipWeapon', { vary: 0.04, gain: 0.62 });
        break;
      case 'vest':
        this.playUiSample(out, t, 'uiEquipVest', { vary: 0.04, gain: 0.62 });
        break;
      case 'cloth':
        this.playUiSample(out, t, 'uiEquipCloth', { vary: 0.04, gain: 0.58 });
        break;
      case 'helmet':
        this.playUiSample(out, t, 'uiEquipHelmet', { vary: 0.04, gain: 0.62 });
        break;
      case 'invOpen':
        this.playUiSample(out, t, 'lootBagZip', { rate: 1.0, vary: 0.04, gain: 0.54 });
        break;
      case 'invClose':
        this.playUiSample(out, t, 'lootBagZip', { rate: 1.06, vary: 0.04, gain: 0.44 });
        break;
      case 'bandage':
      case 'eat':
      case 'drink':
        break;
    }
  }

  update(_dt: number): void {
    if (this.worldMute || this.hardMute) this.stopWorldLoot();
  }

  // ── Building blocks ───────────────────────────────────────────────────────

  start(): void {
    this.ensure();
    if (!this.hardMute) void this.ac?.resume();
  }

  initWithContext(ac: AudioContext, customSamples?: Samples): void {
    if (this.ac === ac) return;
    this.buildGraph(ac, customSamples);
  }

  private ensure(): void {
    if (this.ac || typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.buildGraph(new Ctor());
  }

  private buildGraph(ac: AudioContext, customSamples?: Samples): void {
    this.ac = ac;
    this.master = ac.createGain();
    this.master.connect(ac.destination);

    this.ceilingShaper = ac.createWaveShaper();
    this.ceilingShaper.curve = MAXIMIZER_CURVE;
    this.ceilingShaper.oversample = '2x';
    this.ceilingShaper.connect(this.master);

    this.brickwallLimiter = ac.createDynamicsCompressor();
    this.brickwallLimiter.threshold.value = -1.5;
    this.brickwallLimiter.knee.value = 0;
    this.brickwallLimiter.ratio.value = 20;
    this.brickwallLimiter.attack.value = 0.001;
    this.brickwallLimiter.release.value = 0.045;
    this.brickwallLimiter.connect(this.ceilingShaper);

    this.makeupGain = ac.createGain();
    this.makeupGain.gain.value = 1.4;
    this.makeupGain.connect(this.brickwallLimiter);

    this.glueComp = ac.createDynamicsCompressor();
    this.glueComp.threshold.value = -16;
    this.glueComp.knee.value = 12;
    this.glueComp.ratio.value = 3;
    this.glueComp.attack.value = 0.01;
    this.glueComp.release.value = 0.12;
    this.glueComp.connect(this.makeupGain);

    this.world = ac.createGain();
    this.muffle = ac.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.world.connect(this.muffle).connect(this.glueComp);

    this.weaponsBus = ac.createGain();
    this.weaponsBus.gain.value = 0.96;
    this.weaponsBus.connect(this.world);

    this.footstepsBus = ac.createGain();
    this.footstepsBus.gain.value = 0.68;
    this.footstepsBus.connect(this.world);

    this.foleyBus = ac.createGain();
    this.foleyBus.gain.value = 0.92;
    this.foleyBus.connect(this.world);

    this.envBus = ac.createGain();
    this.envBus.gain.value = 0.82;
    this.envBus.connect(this.world);

    this.musicBus = ac.createGain();
    this.musicBus.gain.value = 0.68;
    this.musicBus.connect(this.world);

    this.ui = ac.createGain();
    this.ui.gain.value = 0.54;
    this.ui.connect(this.brickwallLimiter);

    const len = Math.max(1024, ac.sampleRate || 32000);
    this.noise = ac.createBuffer(1, len, ac.sampleRate || 32000);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

    const irLen = Math.max(256, Math.floor((ac.sampleRate || 32000) * 0.85));
    const ir = ac.createBuffer(2, irLen, ac.sampleRate || 32000);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const tm = i / (ac.sampleRate || 32000);
        const early = tm < 0.07 ? 1.25 : 1;
        d[i] = (Math.random() * 2 - 1) * early * Math.pow(1 - i / d.length, 4.2);
      }
    }
    const conv = ac.createConvolver();
    conv.buffer = ir;
    this.send = ac.createGain();
    this.send.gain.value = 0.02;
    this.world.connect(this.send).connect(conv).connect(this.glueComp);

    this.samples = customSamples ?? new Samples(ac);
    if (!customSamples) this.samples.load();
    this.apply();
  }

  updateStamina(_dt: number, stamina: number, health: number, hasMask: boolean, dead: boolean): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.world || !this.samples) return;
    const now = ac.currentTime;
    const targetBus = this.foleyBus ?? this.world;

    const wantBreath = !dead && !this.worldMute && stamina < 0.2;
    const breathGain = wantBreath ? 0.14 + Math.min(1, (0.2 - stamina) / 0.2) * 0.34 : 0;
    if (wantBreath) {
      const grp: SampleGroup = hasMask ? 'breathMask' : 'breathClear';
      const buf = this.samples.get(grp);
      if (buf && (!this.breathVoice || this.breathVoice.masked !== hasMask)) {
        if (this.breathVoice) {
          this.breathVoice.gain.gain.setTargetAtTime(0, now, 0.08);
          const old = this.breathVoice.src;
          scheduleTimeout(() => { try { old.stop(); } catch {} }, 350);
          this.breathVoice = null;
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = ac.createGain();
        gain.gain.value = 0.0001;
        src.connect(gain).connect(targetBus);
        src.start(now);
        this.breathVoice = { src, gain, masked: hasMask };
      }
      if (this.breathVoice) this.breathVoice.gain.gain.setTargetAtTime(breathGain, now, 0.2);
    } else if (this.breathVoice) {
      this.breathVoice.gain.gain.setTargetAtTime(0, now, 0.15);
    }

    const wantHeart = !dead && !this.worldMute && (stamina < 0.15 || health < 0.25);
    const heartGain = wantHeart ? 0.28 : 0;
    if (wantHeart) {
      const buf = this.samples.get('heartbeat');
      if (buf && !this.heartVoice) {
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = ac.createGain();
        gain.gain.value = 0.0001;
        src.connect(gain).connect(targetBus);
        src.start(now);
        this.heartVoice = { src, gain };
      }
      if (this.heartVoice) this.heartVoice.gain.gain.setTargetAtTime(heartGain, now, 0.2);
    } else if (this.heartVoice) {
      this.heartVoice.gain.gain.setTargetAtTime(0, now, 0.18);
    }
  }

  setLootLoop(active: boolean): void {
    this.wantLootLoop = active;
    this.syncLootLoop();
  }

  private syncLootLoop(): void {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || !this.ui || !this.samples) return;
    const now = ac.currentTime;
    if (this.wantLootLoop && !this.hardMute) {
      const buf = this.samples.get('lootSearch');
      if (buf && !this.lootVoice) {
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = ac.createGain();
        gain.gain.value = 0.0001;
        src.connect(gain).connect(this.ui);
        src.start(now);
        this.lootVoice = { src, gain };
      }
      if (this.lootVoice) this.lootVoice.gain.gain.setTargetAtTime(0.65, now, 0.06);
    } else if (this.lootVoice) {
      const lv = this.lootVoice;
      this.lootVoice = null;
      lv.gain.gain.setTargetAtTime(0, now, 0.06);
      scheduleTimeout(() => { try { lv.src.stop(); } catch {} }, 250);
    }
  }

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
    this.syncLootLoop();
    if (this.worldMute || this.hardMute) this.stopWorldLoot();
    if (this.hardMute) void ac.suspend?.();
    else void ac.resume?.();
  }

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

  private resolveBus(bus: MixBus | undefined, pos: Pos | null): AudioNode | null {
    switch (bus) {
      case 'weapons': return this.weaponsBus ?? this.world;
      case 'footsteps': return this.footstepsBus ?? this.world;
      case 'foley': return this.foleyBus ?? this.world;
      case 'env': return this.envBus ?? this.world;
      case 'music': return this.musicBus ?? this.world;
      case 'ui': return this.ui;
      case 'world': return this.world;
      default: return pos ? this.world : this.ui;
    }
  }

  private playerStepVoice(): [Out, number] | null {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || this.hardMute || this.worldMute || !this.world) return null;
    const target = this.footstepsBus ?? this.world;
    const g = ac.createGain();
    g.connect(target);
    return [g, ac.currentTime + 0.004];
  }

  private pruneVoices(): number {
    const now = this.ac?.currentTime ?? 0;
    let w = 0;
    for (let i = 0; i < this.voiceEnds.length; i++) {
      if (this.voiceEnds[i] > now) this.voiceEnds[w++] = this.voiceEnds[i];
    }
    this.voiceEnds.length = w;
    return w;
  }

  private voice(pos: Pos | null, life: number, ref = 1.5, priority = false, bus?: MixBus): [Out, number] | null {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || this.hardMute || !this.world || !this.ui) return null;
    const target = this.resolveBus(bus, pos);
    if (!target) return null;
    const isWorldRouted = pos !== null || (bus !== undefined && bus !== 'ui');
    if (isWorldRouted && this.worldMute) return null;
    const active = this.pruneVoices();
    if (active >= MAX_VOICES + (priority ? PRIORITY_VOICES : 0)) return null;
    this.voiceEnds.push(ac.currentTime + life + 0.15);
    const g = ac.createGain();
    if (pos) {
      const dist = Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz);
      const diffFloor = dist > 1.6 && Math.abs(pos.y - this.ly) > 2.5;
      const occluded = !diffFloor && dist > 1.6 && !!this.occlusionCheck?.(this.lx, this.ly, this.lz, pos.x, pos.y, pos.z);
      const p = ac.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.maxDistance = 60;
      p.rolloffFactor = 1.1;
      if (p.positionX) {
        p.positionX.value = pos.x;
        p.positionY.value = pos.y;
        p.positionZ.value = pos.z;
      } else p.setPosition(pos.x, pos.y, pos.z);
      if (diffFloor || occluded) {
        g.gain.value = diffFloor ? 0.48 : 0.62;
        const lp = ac.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = diffFloor ? 650 : 750;
        lp.Q.value = 0.7;
        g.connect(lp).connect(p).connect(target);
      } else {
        g.connect(p).connect(target);
      }
    } else g.connect(target);
    return [g, ac.currentTime + 0.005];
  }
}

export const sfx = new Sound();
