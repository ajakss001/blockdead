import type { AnxietyAudio } from './AnxietyAudio';

/** What the city sounds like this frame. */
export interface AmbientState {
  /** Wind gust strength 0..1 (the same wind that moves curtains and paper). */
  gust: number;
  outdoors: boolean;
  /** Height above the street, m: the wind is stronger up high. */
  height: number;
  /** Nearest radio still playing: distance (m, a storey apart counts as far) and stereo pan −1..1. */
  radio: { dist: number; pan: number } | null;
}

/**
 * The empty city, synthesized with WebAudio on the anxiety audio's context (no files): wind in gusts
 * (filtered noise, muffled indoors, stronger up high), a car alarm somewhere far away every minute
 * or so, and radios left on in a few apartments — static and a garbled broadcast, panned by where
 * the set is; now and then the emergency alert's two-tone signal and a few flat words of a bulletin. Silent while the game is paused (the shared output is muted).
 */
export class AmbientAudio {
  private wind: { filter: BiquadFilterNode; gain: GainNode } | null = null;
  private radio: { crackle: GainNode; voice: GainNode; voiceOsc: OscillatorNode; gain: GainNode; pan: StereoPannerNode } | null = null;
  private alarmT = 20 + Math.random() * 30;
  private syllableT = 0;
  /** Next emergency alert on the radio, s; seconds left of the bulletin after it. */
  private alertT = 10 + Math.random() * 20;
  private bulletin = 0;

  constructor(private readonly host: AnxietyAudio) {}

  update(dt: number, s: AmbientState): void {
    const ac = this.host.context;
    const out = this.host.output;
    const noise = this.host.noiseBuffer;
    if (!ac || !out || !noise || ac.state !== 'running') return;
    const now = ac.currentTime;

    // Wind.
    if (!this.wind) {
      const src = ac.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 0.4;
      const gain = ac.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(out);
      src.start();
      this.wind = { filter, gain };
    }
    const up = 1 + Math.min(1, s.height / 30) * 0.6;
    const level = (s.outdoors ? 0.04 + 0.1 * s.gust : 0.01 + 0.018 * s.gust) * up;
    this.wind.gain.gain.setTargetAtTime(level, now, 0.4);
    this.wind.filter.frequency.setTargetAtTime((s.outdoors ? 360 : 200) + 650 * s.gust, now, 0.5);

    // A car alarm far off.
    this.alarmT -= dt;
    if (this.alarmT <= 0) {
      this.alarmT = 45 + Math.random() * 75;
      this.carAlarm(ac, out, now);
    }

    // The nearest radio.
    const r = s.radio && s.radio.dist < 16 ? s.radio : null;
    if (r && !this.radio) this.radio = this.radioChain(ac, out, noise);
    if (this.radio) {
      const vol = r ? 0.11 / (1 + (r.dist * r.dist) / 5) : 0;
      this.radio.gain.gain.setTargetAtTime(vol, now, 0.3);
      if (r) this.radio.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, r.pan)), now, 0.1);
      // Static pops.
      if (Math.random() < dt * 9) {
        this.radio.crackle.gain.setValueAtTime(0.9 + Math.random() * 0.8, now);
        this.radio.crackle.gain.setTargetAtTime(0.25, now + 0.015, 0.03);
      }
      // The emergency alert: the two-tone attention signal, then a bulletin read in a flat voice.
      this.alertT -= dt;
      if (this.alertT <= 0 && r) {
        this.alertT = 35 + Math.random() * 45;
        this.alert(ac, this.radio.gain, now);
        this.bulletin = 2.2 + 4 + Math.random() * 3;
      }
      this.bulletin = Math.max(0, this.bulletin - dt);
      // Syllables of a broadcast you can't make out.
      this.syllableT -= dt;
      if (this.syllableT <= 0) {
        const reading = this.bulletin > 0 && this.bulletin < 7;
        this.syllableT = reading ? 0.13 + Math.random() * 0.08 : 0.09 + Math.random() * 0.22;
        const talk = this.bulletin >= 7 ? 0 : Math.random() < (reading ? 0.92 : 0.8) ? 0.15 + Math.random() * 0.35 : 0;
        this.radio.voice.gain.setTargetAtTime(talk, now, 0.02);
        this.radio.voiceOsc.frequency.setTargetAtTime(reading ? 105 + Math.random() * 25 : 120 + Math.random() * 110, now, 0.03);
      }
    }
  }

  private radioChain(ac: AudioContext, out: AudioNode, noise: AudioBuffer): NonNullable<AmbientAudio['radio']> {
    const gain = ac.createGain();
    gain.gain.value = 0;
    const pan = ac.createStereoPanner();
    gain.connect(pan).connect(out);
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2200;
    band.Q.value = 0.6;
    const crackle = ac.createGain();
    crackle.gain.value = 0.25;
    src.connect(band).connect(crackle).connect(gain);
    src.start();
    const voiceOsc = ac.createOscillator();
    voiceOsc.type = 'sawtooth';
    voiceOsc.frequency.value = 160;
    const formant = ac.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.value = 950;
    formant.Q.value = 2.2;
    const voice = ac.createGain();
    voice.gain.value = 0;
    voiceOsc.connect(formant).connect(voice).connect(gain);
    voiceOsc.start();
    return { crackle, voice, voiceOsc, gain, pan };
  }

  /** The alert's attention signal: 853 + 960 Hz together for two seconds, through the set's speaker. */
  private alert(ac: AudioContext, out: AudioNode, now: number): void {
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
    env.gain.setValueAtTime(0.35, now + 1.9);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1000;
    band.Q.value = 0.7;
    env.connect(band).connect(out);
    for (const f of [853, 960]) {
      const o = ac.createOscillator();
      o.frequency.value = f;
      o.connect(env);
      o.start(now);
      o.stop(now + 2.05);
    }
  }

  /** Two-tone, whoop or chirp pattern, low-passed and echoing between the buildings. */
  private carAlarm(ac: AudioContext, out: AudioNode, now: number): void {
    const t0 = now + 0.05;
    const dur = 5 + Math.random() * 5;
    const osc = ac.createOscillator();
    osc.type = 'square';
    const pattern = Math.floor(Math.random() * 3);
    const gate = ac.createGain();
    gate.gain.value = 1;
    for (let t = 0; t < dur; t += 0.3) {
      if (pattern === 0) osc.frequency.setValueAtTime(Math.round(t / 0.3) % 2 ? 640 : 880, t0 + t);
      else if (pattern === 1) {
        osc.frequency.setValueAtTime(480, t0 + t);
        osc.frequency.linearRampToValueAtTime(1050, t0 + t + 0.28);
      } else {
        osc.frequency.setValueAtTime(1000, t0 + t);
        gate.gain.setValueAtTime(Math.round(t / 0.3) % 2 ? 0 : 1, t0 + t);
      }
    }
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 900 + Math.random() * 400;
    const env = ac.createGain();
    const peak = 0.012 + Math.random() * 0.016;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.3);
    env.gain.setValueAtTime(peak, t0 + dur - 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const pan = ac.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.85;
    // Slap-back from the facades.
    const delay = ac.createDelay(1);
    delay.delayTime.value = 0.18 + Math.random() * 0.15;
    const fb = ac.createGain();
    fb.gain.value = 0.35;
    osc.connect(gate).connect(low).connect(env).connect(pan).connect(out);
    env.connect(delay).connect(fb).connect(delay);
    fb.connect(pan);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    // Tear the echo loop down once it has died out.
    window.setTimeout(() => {
      fb.disconnect();
      delay.disconnect();
    }, (dur + 3) * 1000);
  }
}
