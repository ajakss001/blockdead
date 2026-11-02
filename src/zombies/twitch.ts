import { type Bone, Euler, Quaternion } from 'three';
import { boneIndex } from './skeleton';

/**
 * What makes a zombie move like a dead thing (CLAUDE.md «Визуальный стиль»): an uneven step — the walk and
 * run cycles hitch and lurch instead of flowing — and twitches: now and then the head jerks aside and snaps
 * back, a hand clenches or flicks, under a constant fine tremor. Laid over the clips (additive turns on the
 * bones after the mixer), so the clips and the skeleton stay as they are.
 */

/**
 * The step cycle (0..1) warped into an uneven rhythm: still monotonic (never runs backwards), but it
 * hurries and stalls within a step, differently for each zombie (`seed`).
 */
export function lurch(cyc: number, seed: number): number {
  const a = (seed % 7) * 0.9;
  const t = Math.PI * 2 * cyc;
  return cyc + (0.045 * Math.sin(2 * t + a) + 0.02 * Math.sin(3 * t + a * 1.7)) / (Math.PI * 2);
}

const HEAD = boneIndex('Head');
const NECK = boneIndex('Neck');
const HANDS = [boneIndex('Hand_L'), boneIndex('Hand_R')];
const _q = new Quaternion();
const _e = new Euler();

interface Jerk {
  bone: number;
  /** Peak turn (rad, x y z). */
  to: [number, number, number];
  /** Time since it started, s. */
  t: number;
}

/** Fast in, a short hold, a slower settle back (0..1 of the peak). */
function envelope(t: number): number {
  if (t < 0.06) return t / 0.06;
  if (t < 0.14) return 1;
  return Math.max(0, 1 - (t - 0.14) / 0.28);
}

/** One zombie's twitches (its own random sequence). */
export class Twitch {
  private time = 0;
  private next: number;
  private nextHand: number;
  private readonly jerks: Jerk[] = [];
  private state: number;

  constructor(seed: number) {
    this.state = (seed * 2654435761) >>> 0 || 1;
    this.next = 0.4 + this.rnd() * 2;
    this.nextHand = 0.3 + this.rnd() * 1.5;
  }

  private rnd(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) % 100000) / 100000;
  }

  /** Advance by dt and lay the twitches on the bones (after the mixer, before the world matrices). */
  apply(bones: readonly Bone[], dt: number): void {
    this.time += dt;
    const r = () => this.rnd() * 2 - 1;
    if (this.time >= this.next) {
      this.next = this.time + 0.7 + this.rnd() * 2.6;
      this.jerks.push({ bone: this.rnd() < 0.75 ? HEAD : NECK, to: [r() * 0.28, r() * 0.42, r() * 0.34], t: 0 });
    }
    if (this.time >= this.nextHand) {
      this.nextHand = this.time + 0.4 + this.rnd() * 1.8;
      this.jerks.push({ bone: HANDS[this.rnd() < 0.5 ? 0 : 1], to: [r() * 0.6, r() * 0.25, r() * 0.5], t: 0 });
    }
    for (let i = this.jerks.length - 1; i >= 0; i--) {
      const j = this.jerks[i];
      j.t += dt;
      const k = envelope(j.t);
      if (j.t > 0.42) {
        this.jerks.splice(i, 1);
        continue;
      }
      bones[j.bone].quaternion.multiply(_q.setFromEuler(_e.set(j.to[0] * k, j.to[1] * k, j.to[2] * k)));
    }
    // A fine tremor of the head.
    const s = this.time * 23;
    bones[HEAD].quaternion.multiply(_q.setFromEuler(_e.set(Math.sin(s) * 0.012, Math.sin(s * 1.37 + 1) * 0.015, Math.sin(s * 0.83 + 2) * 0.01)));
  }
}
