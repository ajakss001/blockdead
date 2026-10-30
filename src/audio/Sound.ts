import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameLoop } from '../core/GameLoop';

/*
 * Game sound, synthesized with WebAudio (no files to download: nothing to stream on a weak phone,
 * nothing to license). One AudioContext for the whole game:
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
export type LoopKind = 'fridge' | 'tv' | 'flies';
export type Gait = 'walk' | 'run' | 'crouch';
export type HitMaterial = 'wood' | 'metal' | 'concrete' | 'glass' | 'soft';
export type ContainerSound = 'woodDoor' | 'drawer' | 'locker' | 'fridge' | 'trunk' | 'bag' | 'box' | 'trash' | 'crate' | 'shelf';
export type ItemSound = 'pick' | 'move' | 'cloth' | 'weapon' | 'eat' | 'drink' | 'bandage' | 'invOpen' | 'invClose' | 'drag' | 'drop';
export type SwingKind = 'heavy' | 'blade' | 'fist';
/** What a blow on a body sounds like: a club, a metal tool, an axe, a blade's point, a fist. */
export type FleshBlow = 'blunt' | 'metal' | 'chop' | 'stab' | 'fist';
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
const LOOP_SLOTS = 3;

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
    panner.maxDistance = 20;
    panner.rolloffFactor = 1.6;
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
    if (kind === 'heavy') this.noiseHit(out, t, { type: 'bandpass', f: 280, f2: 1300, q: 1.6, dur: dur * 1.6, peak: 0.32, attack: dur * 0.9 });
    else if (kind === 'blade') this.noiseHit(out, t, { type: 'bandpass', f: 900, f2: 3200, q: 2, dur: dur * 1.5, peak: 0.2, attack: dur * 0.8 });
    else this.noiseHit(out, t, { type: 'bandpass', f: 400, f2: 900, q: 1, dur: dur * 1.4, peak: 0.12, attack: dur * 0.7 });
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
    this.world.connect(this.master);
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
    this.apply();
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
