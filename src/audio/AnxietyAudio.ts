import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { GameLoop } from '../core/GameLoop';
import { sfx } from './Sound';

/**
 * Anxiety pulse state for the visual heartbeat vignette and shared context host for AmbientAudio.
 * Synthesized oscillator heartbeat/hum has been removed (real heartbeat.wav runs in Sound.ts).
 */
export class AnxietyAudio {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private beatPhase = 0;
  private sinceBeat = 10;

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

  /** Advance visual beat phase with the simulation (stops when paused). */
  update(dt: number, anxiety: number): void {
    const bpm = 64 + 86 * anxiety;
    this.beatPhase += (dt * bpm) / 60;
    this.sinceBeat += dt;
    if (this.beatPhase >= 1) {
      this.beatPhase -= 1;
      this.sinceBeat = 0;
    }
  }

  /** Dying camera transition hook (no procedural oscillator hum). */
  dying(_t: number, _fade: number): void {}

  /** Reset dying state on respawn. */
  stopDying(): void {}

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
    const muted = this.loop.paused;
    if (!this.ac || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ac.currentTime, 0.05);
  }
}
