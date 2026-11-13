import { sfx } from './Sound';
import { clamp } from '../core/math';

/**
 * Procedural WebAudio synthesizer for drivable vehicles:
 * - Continuous engine rumble with simulated 4-speed gear shifts & damaged-engine sputter
 * - Tire screech / braking skid noise
 * - Starter cranking ("chik-chik-chik")
 * - Dual-tone 1990s car horn
 * - Heavy car door clunk
 */
export class VehicleAudio {
  private ac: AudioContext | null = null;
  private out: GainNode | null = null;

  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;

  private skidSrc: AudioBufferSourceNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;

  private ensure(): boolean {
    if (!sfx.ac || !sfx.world || !sfx.noise) return false;
    if (this.ac === sfx.ac && this.out) return true;

    this.disposeNodes();
    const ac = sfx.ac;
    this.ac = ac;
    this.out = sfx.world;

    // 1. Engine synth: dual oscillators -> lowpass -> gain -> world bus
    const engGain = ac.createGain();
    engGain.gain.value = 0;
    const engFilter = ac.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 160;
    engFilter.Q.value = 2.2;

    const osc1 = ac.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 34;

    const osc2 = ac.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = 68;

    const subGain = ac.createGain();
    subGain.gain.value = 0.55;

    osc1.connect(engFilter);
    osc2.connect(subGain).connect(engFilter);
    engFilter.connect(engGain).connect(this.out);

    osc1.start();
    osc2.start();

    this.engOsc1 = osc1;
    this.engOsc2 = osc2;
    this.engFilter = engFilter;
    this.engGain = engGain;

    // 2. Tire skid/screech synth: looped white noise -> high-Q bandpass -> gain
    const skidGain = ac.createGain();
    skidGain.gain.value = 0;
    const skidFilter = ac.createBiquadFilter();
    skidFilter.type = 'bandpass';
    skidFilter.frequency.value = 980;
    skidFilter.Q.value = 4.2;

    const skidSrc = ac.createBufferSource();
    skidSrc.buffer = sfx.noise;
    skidSrc.loop = true;
    skidSrc.connect(skidFilter).connect(skidGain).connect(this.out);
    skidSrc.start();

    this.skidSrc = skidSrc;
    this.skidFilter = skidFilter;
    this.skidGain = skidGain;

    return true;
  }

  /** Update continuous engine & tire screech audio every fixed step. */
  update(opts: {
    active: boolean;
    engineOn: boolean;
    speed: number;
    maxSpeed: number;
    throttle: number;
    steer: number;
    braking: boolean;
    engineHealth: number;
    isSuv: boolean;
    onRoad: boolean;
  }): void {
    if (!this.ensure()) return;
    const ac = this.ac!;
    const now = ac.currentTime;

    if (!opts.active || !opts.engineOn) {
      this.engGain!.gain.setTargetAtTime(0, now, 0.08);
    } else {
      const speedNorm = clamp(Math.abs(opts.speed) / Math.max(opts.maxSpeed, 1), 0, 1);
      // Simulated 4-speed gearbox sawtooth RPM curve
      const gearFloat = speedNorm * 3.6;
      const gearFrac = gearFloat - Math.floor(gearFloat);
      const rpm = clamp(0.18 + gearFrac * 0.58 + Math.abs(opts.throttle) * 0.24 + speedNorm * 0.15, 0.15, 1.0);

      const baseHz = opts.isSuv ? 26 : 33;
      const freq = baseHz + rpm * (opts.isSuv ? 44 : 56);
      // Damaged engine sputters unevenly
      const sputter =
        opts.engineHealth < 0.35
          ? 1 + Math.sin(now * 23) * (0.35 - opts.engineHealth) * 0.65
          : 1;

      this.engOsc1!.frequency.setTargetAtTime(freq * sputter, now, 0.05);
      this.engOsc2!.frequency.setTargetAtTime(freq * 2.02 * sputter, now, 0.05);
      this.engFilter!.frequency.setTargetAtTime(140 + rpm * 420 + Math.abs(opts.throttle) * 140, now, 0.06);

      const vol = (0.065 + rpm * 0.075 + Math.abs(opts.throttle) * 0.03) * (opts.isSuv ? 1.15 : 1.0);
      this.engGain!.gain.setTargetAtTime(vol, now, 0.06);
    }

    // Tire screech when braking hard, handbraking, or cornering hard on asphalt
    const absSpeed = Math.abs(opts.speed);
    const brakeSkid = opts.braking && absSpeed > 4.2 ? clamp((absSpeed - 4) / 10, 0, 1) : 0;
    const turnSkid = Math.abs(opts.steer) > 0.6 && absSpeed > 10.5 ? clamp((absSpeed - 10) / 8, 0, 0.75) : 0;
    const skid = opts.active ? Math.max(brakeSkid, turnSkid) : 0;

    if (skid > 0.02) {
      const pitch = opts.onRoad ? 940 + skid * 260 : 420 + skid * 140; // gravel/grass vs asphalt screech
      this.skidFilter!.frequency.setTargetAtTime(pitch, now, 0.04);
      this.skidFilter!.Q.setTargetAtTime(opts.onRoad ? 4.8 : 1.4, now, 0.04);
      this.skidGain!.gain.setTargetAtTime(skid * (opts.onRoad ? 0.14 : 0.11), now, 0.03);
    } else {
      this.skidGain!.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  /** Play realistic starter crank pulses when turning the key. */
  playStarter(success: boolean): void {
    if (!this.ensure()) return;
    const ac = this.ac!;
    const out = this.out!;
    const t0 = ac.currentTime;
    const cranks = success ? 3 : 4;

    for (let i = 0; i < cranks; i++) {
      const t = t0 + i * 0.13;
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(115, t);
      osc.frequency.exponentialRampToValueAtTime(155, t + 0.07);
      const flt = ac.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 480;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);
      osc.connect(flt).connect(g).connect(out);
      osc.start(t);
      osc.stop(t + 0.11);
    }

    if (success) {
      // Engine catch roar
      const tCatch = t0 + cranks * 0.12;
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(85, tCatch);
      osc.frequency.exponentialRampToValueAtTime(42, tCatch + 0.35);
      const flt = ac.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 340;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, tCatch);
      g.gain.exponentialRampToValueAtTime(0.16, tCatch + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, tCatch + 0.42);
      osc.connect(flt).connect(g).connect(out);
      osc.start(tCatch);
      osc.stop(tCatch + 0.45);
    }
  }

  /** Play a dual-tone 1990s car horn. */
  playHorn(isSuv: boolean): void {
    if (!this.ensure()) return;
    const ac = this.ac!;
    const out = this.out!;
    const t = ac.currentTime;
    const freqs = isSuv ? [329.6, 415.3] : [392.0, 493.9];

    const flt = ac.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = 1650;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.098, t + 0.015);
    g.gain.setValueAtTime(0.098, t + 0.28);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.36);
    flt.connect(g).connect(out);

    for (const f of freqs) {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, t);
      osc.connect(flt);
      osc.start(t);
      osc.stop(t + 0.38);
    }
  }

  /** Play a heavy car door shut/open clunk. */
  playDoor(): void {
    if (!this.ensure()) return;
    const ac = this.ac!;
    const out = this.out!;
    const t = ac.currentTime;

    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.24, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.14);

    // Metallic latch click
    const src = ac.createBufferSource();
    src.buffer = sfx.noise!;
    const flt = ac.createBiquadFilter();
    flt.type = 'bandpass';
    flt.frequency.value = 2200;
    flt.Q.value = 2.0;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.0001, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.12, t + 0.024);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(flt).connect(ng).connect(out);
    src.start(t + 0.02);
    src.stop(t + 0.08);
  }

  private disposeNodes(): void {
    try {
      this.engOsc1?.stop();
      this.engOsc2?.stop();
      this.skidSrc?.stop();
    } catch {
      /* ignore */
    }
    this.engOsc1 = null;
    this.engOsc2 = null;
    this.engFilter = null;
    this.engGain = null;
    this.skidSrc = null;
    this.skidFilter = null;
    this.skidGain = null;
  }

  dispose(): void {
    this.disposeNodes();
    this.ac = null;
    this.out = null;
  }
}
