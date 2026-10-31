import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameLoop } from '../core/GameLoop';
import { sfx } from './Sound';

/** Below this anxiety nothing is heard. */
const HEART_FROM = 0.45;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Anxiety you can hear: a heartbeat that quickens (from 45% anxiety), synthesized with WebAudio
 * (no audio files: a decaying low sine for "lub-dub"; no breathing — the world's sounds matter more). The beat
 * timeline also drives the pulsing screen edges. Silent while the game is paused for any reason
 * (menus, inventory, ads, hidden tab). The AudioContext starts on the first user gesture.
 */
export class AnxietyAudio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beatPhase = 0;
  private sinceBeat = 10;
  private muted = false;
  /** Dying: when the next slowing beat comes (s since death), the low hum. */
  private nextBeat = 0;
  private hum: { gain: GainNode; oscs: OscillatorNode[] } | null = null;

  constructor(
    events: EventBus<GameEvents>,
    private readonly loop: GameLoop,
  ) {
    const unlock = () => {
      this.ensure();
      void this.ac?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    events.on('loop:pause', () => this.syncMute());
    events.on('loop:resume', () => this.syncMute());
  }

  /** Shared with the ambient sounds (null until the first user gesture). */
  get context(): AudioContext | null {
    return this.ac;
  }

  /** Output muted while the game is paused. */
  get output(): GainNode | null {
    return this.master;
  }

  /** One second of white noise. */
  get noiseBuffer(): AudioBuffer | null {
    return this.noise;
  }

  /** Heartbeat envelope 0..1 (1 at the beat), for the screen pulse. */
  get pulse(): number {
    return Math.exp(-this.sinceBeat * 7);
  }

  /** Advance with the simulation (stops when paused). */
  update(dt: number, anxiety: number): void {
    const bpm = 64 + 86 * anxiety;
    this.beatPhase += (dt * bpm) / 60;
    this.sinceBeat += dt;
    if (this.beatPhase >= 1) {
      this.beatPhase -= 1;
      this.sinceBeat = 0;
      if (anxiety > HEART_FROM) this.heartbeat(smooth(HEART_FROM, 0.9, anxiety), 60 / bpm);
    }
    // No breathing sounds: the heartbeat only, and only when it is really bad.
  }

  /**
   * Dying, `t` s in: the heart slows and stops (by ~6.5 s), a low hum swells under everything; `fade` 0..1
   * takes the hum away with the picture. No stingers.
   */
  dying(t: number, fade: number): void {
    if (!this.ac || !this.master || this.ac.state !== 'running') return;
    if (t >= this.nextBeat && t < 6.5) {
      const interval = 0.75 + t * 0.24;
      this.nextBeat = t + interval;
      this.heartbeat(Math.max(0.15, 1 - t / 7), interval);
    }
    if (!this.hum) {
      const gain = this.ac.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      const oscs = [41, 61.5, 82].map((f, k) => {
        const o = this.ac!.createOscillator();
        o.frequency.value = f;
        const g = this.ac!.createGain();
        g.gain.value = [1, 0.45, 0.18][k];
        o.connect(g).connect(gain);
        o.start();
        return o;
      });
      this.hum = { gain, oscs };
    }
    this.hum.gain.gain.setTargetAtTime(0.05 * Math.min(1, t / 3) * (1 - fade), this.ac.currentTime, 0.3);
  }

  /** The hum off (a new life). */
  stopDying(): void {
    if (!this.hum || !this.ac) return;
    const hum = this.hum;
    this.hum = null;
    this.nextBeat = 0;
    hum.gain.gain.setTargetAtTime(0, this.ac.currentTime, 0.2);
    for (const o of hum.oscs) o.stop(this.ac.currentTime + 1.5);
  }

  /** On the game's one AudioContext (audio/Sound), into its world bus. */
  private ensure(): void {
    if (this.ac) return;
    sfx.start();
    if (!sfx.ac || !sfx.world || !sfx.noise) return;
    this.ac = sfx.ac;
    this.master = this.ac.createGain();
    this.master.connect(sfx.world);
    this.noise = sfx.noise;
    this.syncMute();
  }

  private syncMute(): void {
    this.muted = this.loop.paused;
    if (!this.ac || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ac.currentTime, 0.05);
  }

  /** "Lub-dub": two low thumps, the second softer. */
  private heartbeat(volume: number, interval: number): void {
    if (!this.ac || !this.master || this.muted || this.ac.state !== 'running') return;
    const t = this.ac.currentTime + 0.02;
    this.thump(t, 0.85 * volume);
    this.thump(t + Math.min(0.24, interval * 0.32), 0.55 * volume);
  }

  private thump(t: number, peak: number): void {
    const ac = this.ac!;
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.exponentialRampToValueAtTime(36, t + 0.12);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.2);
  }

}
