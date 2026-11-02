import { type Bone, Euler, Quaternion, Vector3 } from 'three';
import { type BoneName, boneIndex } from './skeleton';

/**
 * What makes a zombie move like a dead thing (CLAUDE.md «Визуальный стиль»), on top of its gait (the limp
 * is in the clips, zombies/gait): twitches — every 2–4 s the head jerks aside or a shoulder hitches and
 * snaps back, now and then a hand clenches or flicks, under a constant fine tremor of the head. Laid over
 * the clips, so the clips and the skeleton stay as they are. (The step itself stays even: a warped cycle
 * would make the planted feet skid.)
 *
 * Never piled up: each frame a bone's turn is the clip's pose × the layer's offset worked out afresh. The
 * mixer only writes a bone when its clip value changed since the last frame (three's PropertyMixer) — on
 * pause, or with a walk cycle standing still, it leaves the bone as it was, twitch and all — so `reset`
 * puts the clip's pose back before the mixer runs. The result is kept in each joint's human range
 * (LIMITS, about the bone's rest pose: twist about the bone, then the swing; quaternions only).
 */

const HEAD = boneIndex('Head');
const NECK = boneIndex('Neck');
const HANDS = [boneIndex('Hand_L'), boneIndex('Hand_R')];
const SHOULDERS = [boneIndex('UpperArm_L'), boneIndex('UpperArm_R')];
const deg = Math.PI / 180;

/** Turn limits about the rest pose (rad): twist about the bone's own axis (Y), bend forward/back (X), sideways (Z). */
const LIMITS: Partial<Record<BoneName, [twist: number, bend: number, side: number]>> = {
  Head: [70 * deg, 40 * deg, 20 * deg],
  Neck: [45 * deg, 30 * deg, 20 * deg],
  UpperArm_L: [60 * deg, 150 * deg, 90 * deg],
  UpperArm_R: [60 * deg, 150 * deg, 90 * deg],
  Hand_L: [80 * deg, 70 * deg, 30 * deg],
  Hand_R: [80 * deg, 70 * deg, 30 * deg],
};
const LIMIT_BY_INDEX = new Map(Object.entries(LIMITS).map(([b, l]) => [boneIndex(b as BoneName), l]));

const _q = new Quaternion();
const _d = new Quaternion();
const _tw = new Quaternion();
const _sw = new Quaternion();
const _ri = new Quaternion();
const _e = new Euler();
const _ax = new Vector3();
const _IDENT = new Quaternion();

/** Keep a bone's local turn `q` within `lim` of its rest turn `rest` (in place). */
export function limitTurn(q: Quaternion, rest: Quaternion, lim: readonly [number, number, number]): void {
  _ri.copy(rest).invert();
  _d.copy(_ri).multiply(q); // the turn from rest
  if (_d.w < 0) _d.set(-_d.x, -_d.y, -_d.z, -_d.w); // the short way round
  // Twist about the bone's axis (Y), and the swing that is left.
  const tl = Math.hypot(_d.y, _d.w);
  if (tl < 1e-9) _tw.identity();
  else _tw.set(0, _d.y / tl, 0, _d.w / tl);
  _sw.copy(_d).multiply(_q.copy(_tw).invert());
  let twist = 2 * Math.atan2(_tw.y, _tw.w);
  const sl = Math.hypot(_sw.x, _sw.z);
  const sa = 2 * Math.atan2(sl, _sw.w);
  let bx = sl > 1e-9 ? (sa * _sw.x) / sl : 0;
  let bz = sl > 1e-9 ? (sa * _sw.z) / sl : 0;
  const c = (v: number, m: number) => Math.max(-m, Math.min(m, v));
  if (Math.abs(twist) <= lim[0] && Math.abs(bx) <= lim[1] && Math.abs(bz) <= lim[2]) return;
  twist = c(twist, lim[0]);
  bx = c(bx, lim[1]);
  bz = c(bz, lim[2]);
  const a = Math.hypot(bx, bz);
  if (a < 1e-9) _sw.identity();
  else _sw.setFromAxisAngle(_ax.set(bx / a, 0, bz / a), a);
  _tw.set(0, Math.sin(twist / 2), 0, Math.cos(twist / 2));
  q.copy(rest).multiply(_sw.multiply(_tw));
}

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
  /** The clip's pose of each bone it turned last frame (put back by `reset`). */
  private readonly base = new Map<number, Quaternion>();
  /** This frame's offset per bone. */
  private readonly offset = new Map<number, Quaternion>();

  /** `rest`: the type's rest turns (BONES order) the limits are measured from; none: identity. */
  constructor(
    seed: number,
    private readonly rest: readonly Quaternion[] = [],
  ) {
    this.state = (seed * 2654435761) >>> 0 || 1;
    this.next = 0.5 + this.rnd() * 3;
    this.nextHand = 0.5 + this.rnd() * 3;
  }

  private rnd(): number {
    this.state ^= this.state << 13;
    this.state ^= this.state >>> 17;
    this.state ^= this.state << 5;
    return ((this.state >>> 0) % 100000) / 100000;
  }

  /** Before the mixer: the bones it turned back to the clip's pose. */
  reset(bones: readonly Bone[]): void {
    for (const [i, q] of this.base) bones[i].quaternion.copy(q);
    this.base.clear();
  }

  private add(bone: number, x: number, y: number, z: number): void {
    let o = this.offset.get(bone);
    if (!o) this.offset.set(bone, (o = new Quaternion()));
    o.multiply(_q.setFromEuler(_e.set(x, y, z)));
  }

  /** Advance by dt (0: paused — the same pose again) and lay the twitches on the bones (after the mixer). */
  apply(bones: readonly Bone[], dt: number): void {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.time += step;
    const r = () => this.rnd() * 2 - 1;
    if (this.time >= this.next) {
      // Every 2–4 s: the head (or neck) jerks aside, or a shoulder hitches up and forward.
      this.next = this.time + 2 + this.rnd() * 2;
      const w = this.rnd();
      if (w < 0.6) this.jerks.push({ bone: w < 0.45 ? HEAD : NECK, to: [r() * 0.28, r() * 0.42, r() * 0.34], t: 0 });
      else {
        const s = this.rnd() < 0.5 ? 0 : 1;
        this.jerks.push({ bone: SHOULDERS[s], to: [0.15 + 0.15 * this.rnd(), r() * 0.1, (s ? 1 : -1) * (0.12 + 0.12 * this.rnd())], t: 0 });
      }
    }
    if (this.time >= this.nextHand) {
      this.nextHand = this.time + 1.5 + this.rnd() * 2.5;
      this.jerks.push({ bone: HANDS[this.rnd() < 0.5 ? 0 : 1], to: [r() * 0.6, r() * 0.25, r() * 0.5], t: 0 });
    }
    for (const o of this.offset.values()) o.identity();
    for (let i = this.jerks.length - 1; i >= 0; i--) {
      const j = this.jerks[i];
      j.t += step;
      if (j.t > 0.42) {
        this.jerks.splice(i, 1);
        continue;
      }
      const k = envelope(j.t);
      this.add(j.bone, j.to[0] * k, j.to[1] * k, j.to[2] * k);
    }
    // A fine tremor of the head.
    const s = this.time * 23;
    this.add(HEAD, Math.sin(s) * 0.012, Math.sin(s * 1.37 + 1) * 0.015, Math.sin(s * 0.83 + 2) * 0.01);
    // The clip's pose × the offset, from scratch; kept in the joint's range.
    for (const [i, o] of this.offset) {
      const q = bones[i].quaternion;
      let b = this.base.get(i);
      if (!b) this.base.set(i, (b = new Quaternion()));
      b.copy(q);
      q.multiply(o);
      const lim = LIMIT_BY_INDEX.get(i);
      if (lim) limitTurn(q, this.rest[i] ?? _IDENT, lim);
    }
  }
}
