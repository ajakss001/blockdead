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
 * MAX_VOICES play at once, extra ones are dropped. The reverb send follows where you are (rooms and
 * alleys ring, open streets don't).
 */

export type StepSurface = 'asphalt' | 'concrete' | 'tile' | 'wood' | 'metal' | 'glass' | 'grass';
export type Gait = 'walk' | 'run' | 'crouch';
export type HitMaterial = 'wood' | 'metal' | 'concrete' | 'glass' | 'soft';
export type ContainerSound = 'woodDoor' | 'drawer' | 'locker' | 'fridge' | 'trunk' | 'bag' | 'box' | 'trash' | 'crate' | 'shelf';
export type ItemSound = 'pick' | 'move' | 'cloth' | 'weapon' | 'eat' | 'drink' | 'bandage' | 'invOpen' | 'invClose' | 'drag' | 'drop';
export type SwingKind = 'heavy' | 'blade' | 'fist';

export interface Pos {
  x: number;
  y: number;
  z: number;
}

const MAX_VOICES = 22;
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
  private volume = Number(localStorage.getItem(VOLUME_KEY) ?? 0.8);
  private hardMute = false;
  private worldMute = false;
  private search: { kind: ContainerSound; pos: Pos; t: number } | null = null;

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
    }
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

  door(style: 'wood' | 'glass', open: boolean, pos: Pos): void {
    const v = this.voice(pos, 0.7);
    if (!v) return;
    const [out, t] = v;
    // Latch click.
    this.noiseHit(out, t, { type: 'bandpass', f: 3000, q: 3, dur: 0.02, peak: 0.25 });
    this.tone(out, t, { f: 1900, dur: 0.03, peak: 0.05 });
    if (open) {
      if (style === 'wood') this.tone(out, t + 0.06, { f: 170 + Math.random() * 30, f2: 260, dur: 0.55, peak: 0.06, type: 'sawtooth', lp: 1100, vibrato: 9 });
      else for (let i = 0; i < 3; i++) this.tone(out, t + 0.05 + i * 0.04, { f: 3000 + i * 400, dur: 0.05, peak: 0.03 });
    } else {
      this.noiseHit(out, t + 0.02, { type: 'lowpass', f: style === 'wood' ? 260 : 700, dur: 0.12, peak: 0.6 });
      this.tone(out, t + 0.02, { f: style === 'wood' ? 95 : 180, dur: 0.12, peak: 0.25 });
    }
  }

  /** A door that won't give: thumps against the boards, a rattle. */
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

  /**
   * A voice: its own gain into the world bus (through a panner if positioned) or the UI bus. Returns
   * the node to play into and the start time, or null when muted / over the voice limit.
   */
  private voice(pos: Pos | null, life: number): [Out, number] | null {
    const ac = this.ac;
    if (!ac || ac.state !== 'running' || this.hardMute || !this.world || !this.ui) return null;
    if (pos && this.worldMute) return null;
    if (this.voices >= MAX_VOICES) return null;
    this.voices++;
    window.setTimeout(() => this.voices--, (life + 0.6) * 1000);
    const g = ac.createGain();
    if (pos) {
      const p = ac.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 1.5;
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
