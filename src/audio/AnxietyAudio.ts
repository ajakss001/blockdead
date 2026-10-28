import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameLoop } from '../core/GameLoop';

/** Below this anxiety nothing is heard. */
const HEART_FROM = 0.15;
const BREATH_FROM = 0.3;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * Anxiety you can hear: a heartbeat that quickens and heavy breathing, synthesized with WebAudio
 * (no audio files: a decaying low sine for "lub-dub", band-passed noise for breath). The beat
 * timeline also drives the pulsing screen edges. Silent while the game is paused for any reason
 * (menus, inventory, ads, hidden tab). The AudioContext starts on the first user gesture.
 */
export class AnxietyAudio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beatPhase = 0;
  private breathPhase = 0;
  private sinceBeat = 10;
  private muted = false;

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
    // Breath cycle from a slow 4.5 s to a panicked 1.4 s.
    const period = 4.5 - 3.1 * anxiety;
    this.breathPhase += dt / period;
    if (this.breathPhase >= 1) {
      this.breathPhase -= 1;
      if (anxiety > BREATH_FROM) this.breath(smooth(BREATH_FROM, 1, anxiety), period);
    }
  }

  private ensure(): void {
    if (this.ac) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ac = new Ctor();
    this.master = this.ac.createGain();
    this.master.connect(this.ac.destination);
    const len = this.ac.sampleRate;
    this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
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

  /** One breath: a brighter inhale, a duller exhale. */
  private breath(volume: number, period: number): void {
    if (!this.ac || !this.master || !this.noise || this.muted || this.ac.state !== 'running') return;
    const ac = this.ac;
    const t = ac.currentTime + 0.02;
    const phases: [number, number, number, number][] = [
      // start, length, band center, loudness
      [0, period * 0.38, 1300, 0.16],
      [period * 0.45, period * 0.45, 650, 0.22],
    ];
    for (const [start, len, freq, loud] of phases) {
      const src = ac.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = 0.7;
      const g = ac.createGain();
      const t0 = t + start;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(loud * volume, t0 + len * 0.4);
      g.gain.linearRampToValueAtTime(0, t0 + len);
      src.connect(band).connect(g).connect(this.master);
      src.start(t0, Math.random() * 0.5);
      src.stop(t0 + len + 0.05);
    }
  }
}
