import {
  type AnimationAction,
  AdditiveAnimationBlendMode,
  AnimationClip,
  AnimationMixer,
  Euler,
  LoopOnce,
  LoopRepeat,
  NormalAnimationBlendMode,
  type Object3D,
  Quaternion,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { BONES, type BoneName, restLocals, type SkeletonDims } from './skeleton';

/**
 * The zombies' shared clips, by bone name — one set for every type. They are ADDITIVE: each key is a turn
 * (and for the hips a shift) on top of the type's own rest pose, so a hunched, tall or one-armed zombie
 * plays them as well as a straight one. Sampled from functions of time at 30 keys a second.
 *
 * Bone frames (skeleton.ts): +X about the bone bends a limb forward (towards −Z) and a spine bone back;
 * the jaw opens with −X. Each type plays them at its own speed (`ZombieType.animSpeed`).
 */
export type ClipName = 'Idle' | 'Walk' | 'Run' | 'Attack' | 'HitReaction' | 'Death';
export const CLIP_NAMES: ClipName[] = ['Idle', 'Walk', 'Run', 'Attack', 'HitReaction', 'Death'];

type R = [number, number, number];
interface Pose {
  r: Partial<Record<BoneName, R>>;
  hips?: R;
}

const TAU = Math.PI * 2;
const { sin, cos, max, exp } = Math;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
/** A short jerk centred on `at` (s). */
const jerk = (t: number, at: number, w: number) => exp(-(((t - at) / w) ** 2));

function bake(name: ClipName, duration: number, f: (t: number) => Pose): AnimationClip {
  const n = Math.max(2, Math.round(duration * 30) + 1);
  const times = Array.from({ length: n }, (_, i) => (i / (n - 1)) * duration);
  const poses = times.map(f);
  const used = BONES.filter((b) => poses.some((p) => p.r[b]));
  const q = new Quaternion();
  const e = new Euler();
  const tracks = used.map((b) => {
    const v: number[] = [];
    for (const p of poses) {
      const r = p.r[b] ?? [0, 0, 0];
      q.setFromEuler(e.set(r[0], r[1], r[2])).toArray(v, v.length);
    }
    return new QuaternionKeyframeTrack(`${b}.quaternion`, times, v);
  });
  const hips = poses.some((p) => p.hips) ? new VectorKeyframeTrack('Hips.position', times, poses.flatMap((p) => p.hips ?? [0, 0, 0])) : null;
  const clip = new AnimationClip(name, duration, hips ? [...tracks, hips] : tracks, AdditiveAnimationBlendMode);
  return clip;
}

/** Idle: swaying on the spot, the jaw working, the head jerking now and then. */
function idle(t: number): Pose {
  const p = (TAU * t) / 3;
  return {
    hips: [0.01 * sin(p), -0.012 + 0.006 * sin(2 * p), 0],
    r: {
      Hips: [0, 0.03 * sin(p), 0.025 * sin(p)],
      Spine: [0.02 * sin(p + 1), 0, 0.02 * sin(p)],
      Chest: [-0.03 + 0.025 * sin(2 * p), 0.04 * sin(p + 0.5), -0.02 * sin(p)],
      Neck: [0.05 * sin(p), 0.25 * jerk(t, 1.1, 0.06), 0.06 * sin(p + 2) + 0.35 * jerk(t, 1.13, 0.05)],
      Head: [0.04 * sin(p + 1) - 0.25 * jerk(t, 2.2, 0.05), 0.08 * sin(p), 0.1 * sin(p + 0.3) - 0.2 * jerk(t, 2.25, 0.06)],
      Jaw: [-0.06 - 0.06 * sin(2 * p + 1), 0, 0.02 * sin(p)],
      UpperArm_L: [0.06 * sin(p + 0.4), 0, -0.04],
      LowerArm_L: [0.15 + 0.05 * sin(p + 0.9), 0, 0],
      Hand_L: [0.1 * sin(p + 1.4), 0, 0],
      UpperArm_R: [0.06 * sin(p), 0, 0.04],
      LowerArm_R: [0.15 + 0.05 * sin(p + 0.5), 0, 0],
      Hand_R: [0.1 * sin(p + 1), 0, 0],
      UpperLeg_L: [0.08, 0, -0.02],
      LowerLeg_L: [-0.16, 0, 0],
      Foot_L: [0.08, 0, 0],
      UpperLeg_R: [0.12, 0, 0.02],
      LowerLeg_R: [-0.22, 0, 0],
      Foot_R: [0.1, 0, 0],
    },
  };
}

/** Walk: one stride per cycle, shuffling, the right leg dragged (a limp), the body lurching onto it. */
function walk(t: number): Pose {
  const p = (TAU * t) / 1.4;
  const s = sin(p);
  return {
    hips: [0.025 * s, -0.03 + 0.015 * cos(2 * p) - 0.03 * max(0, -s), 0],
    r: {
      Hips: [0, 0.08 * s, 0.07 * s],
      Spine: [0, -0.08 * s, -0.05 * s],
      Chest: [-0.06, -0.06 * s, 0.06 * s],
      Neck: [0.06 * sin(2 * p), 0, -0.08 * s],
      Head: [-0.04 * sin(2 * p + 0.6), 0.05 * s, 0.1 * sin(p + 0.8)],
      Jaw: [-0.05 - 0.05 * sin(2 * p), 0, 0],
      UpperLeg_L: [0.1 + 0.38 * s, 0, 0],
      LowerLeg_L: [-(0.1 + 0.55 * max(0, cos(p + 0.4))), 0, 0],
      Foot_L: [-0.1 * s + 0.15 * max(0, cos(p + 0.4)), 0, 0],
      UpperLeg_R: [0.05 - 0.22 * s, 0, 0.02],
      LowerLeg_R: [-(0.06 + 0.15 * max(0, -cos(p + 0.4))), 0, 0],
      Foot_R: [-0.25 + 0.05 * s, 0.15, 0],
      UpperArm_R: [0.25 + 0.3 * sin(p - 0.6), 0, 0.06 + 0.04 * s],
      LowerArm_R: [0.25 + 0.15 * sin(p - 1.2), 0, 0],
      Hand_R: [0.15 * sin(p - 1.6), 0, 0],
      UpperArm_L: [0.15 - 0.3 * sin(p - 0.6), 0, -0.06 + 0.04 * s],
      LowerArm_L: [0.25 - 0.15 * sin(p - 1.2), 0, 0],
      Hand_L: [-0.15 * sin(p - 1.6), 0, 0],
    },
  };
}

/** Run: a lurching, headlong lope, leaning in, arms out in front, jaw snapping. Still limping. */
function run(t: number): Pose {
  const p = (TAU * t) / 0.85;
  const s = sin(p);
  return {
    hips: [0.03 * s, -0.05 + 0.04 * cos(2 * p), 0],
    r: {
      Hips: [0, 0.12 * s, 0.08 * s],
      Spine: [-0.12, -0.1 * s, -0.04 * s],
      Chest: [-0.15 + 0.04 * cos(2 * p), -0.12 * s, 0.06 * s],
      Neck: [0.2 + 0.05 * sin(2 * p), 0, -0.06 * s],
      Head: [0.1, 0.06 * s, 0.08 * sin(p + 0.8)],
      Jaw: [-0.2 - 0.08 * sin(2 * p), 0, 0],
      UpperLeg_L: [0.15 + 0.6 * s, 0, 0],
      LowerLeg_L: [-(0.25 + 0.85 * max(0, cos(p + 0.3))), 0, 0],
      Foot_L: [0.2 * s, 0, 0],
      UpperLeg_R: [0.12 - 0.42 * s, 0, 0.02],
      LowerLeg_R: [-(0.2 + 0.5 * max(0, -cos(p + 0.3))), 0, 0],
      Foot_R: [-0.15 - 0.15 * s, 0.12, 0],
      UpperArm_R: [1.0 + 0.25 * s, 0, 0.1],
      LowerArm_R: [0.3 + 0.1 * sin(p + 1), 0, 0],
      Hand_R: [-0.2, 0, 0],
      UpperArm_L: [0.9 - 0.25 * s, 0, -0.1],
      LowerArm_L: [0.3 - 0.1 * sin(p + 1), 0, 0],
      Hand_L: [-0.2, 0, 0],
    },
  };
}

/** Attack: reaches out (both arms, one a beat behind), lunges, grabs at 0.55 s and pulls in, biting. */
function attack(t: number): Pose {
  const reach = (d: number) => ss(0.05 + d, 0.45 + d, t) * (1 - ss(0.75, 1.1, t));
  const lunge = ss(0.25, 0.55, t) * (1 - ss(0.75, 1.05, t));
  const grab = ss(0.5, 0.62, t) * (1 - ss(0.85, 1.05, t));
  const pull = ss(0.6, 0.8, t) * (1 - ss(0.85, 1.1, t));
  const bite = ss(0.4, 0.58, t) * (1 - ss(0.8, 1.0, t));
  const arm = (d: number, side: number): R[] => {
    const r = reach(d);
    return [
      [1.45 * r - 0.35 * pull, 0, -0.15 * r * side],
      [0.5 * r * (1 - lunge) + 0.6 * pull, 0, 0],
      [-0.4 * r + 0.9 * grab, 0, 0],
    ];
  };
  const [uR, lR, hR] = arm(0, 1);
  const [uL, lL, hL] = arm(0.08, -1);
  return {
    hips: [0, -0.04 * lunge, -0.12 * lunge],
    r: {
      Spine: [-0.1 * lunge, 0, 0],
      Chest: [-0.25 * lunge + 0.1 * pull, 0.08 * lunge, 0],
      Neck: [0.15 * lunge, 0, 0],
      Head: [0.1 * lunge, 0, 0],
      Jaw: [-0.45 * bite + 0.06 * grab, 0, 0],
      UpperArm_R: uR,
      LowerArm_R: lR,
      Hand_R: hR,
      UpperArm_L: uL,
      LowerArm_L: lL,
      Hand_L: hL,
      UpperLeg_L: [0.35 * lunge, 0, 0],
      LowerLeg_L: [-0.35 * lunge, 0, 0],
      UpperLeg_R: [-0.2 * lunge, 0, 0],
      LowerLeg_R: [-0.2 * lunge, 0, 0],
      Foot_R: [0.2 * lunge, 0, 0],
    },
  };
}

/** Hit: the body snaps back from the blow, the head a moment later, arms flung out, knees giving. */
function hitReaction(t: number): Pose {
  const h = (u: number) => (u <= 0 ? 0 : u < 0.08 ? u / 0.08 : exp(-(u - 0.08) * 7)) * (1 - ss(0.45, 0.55, u));
  const a = h(t);
  const b = h(t - 0.05);
  return {
    hips: [0, -0.03 * a, 0.08 * a],
    r: {
      Spine: [0.15 * a, 0, 0],
      Chest: [0.35 * a, 0, 0.05 * a],
      Neck: [0.45 * b, 0, 0],
      Head: [0.25 * b, 0, -0.15 * b],
      Jaw: [-0.25 * b, 0, 0],
      UpperArm_R: [-0.2 * a, 0, 0.45 * a],
      LowerArm_R: [0.3 * b, 0, 0],
      UpperArm_L: [-0.2 * a, 0, -0.45 * a],
      LowerArm_L: [0.3 * b, 0, 0],
      UpperLeg_L: [0.1 * a, 0, 0],
      LowerLeg_L: [-0.2 * a, 0, 0],
      UpperLeg_R: [0.1 * a, 0, 0],
      LowerLeg_R: [-0.2 * a, 0, 0],
    },
  };
}

/** Death: the knees give, it topples backwards onto its back, straightens out, arms flung wide, head rolls. */
function death(t: number): Pose {
  const buckle = ss(0, 0.35, t);
  const u = clamp01((t - 0.25) / 0.9);
  const fall = u * u;
  const hit = t > 1.15 ? exp(-(t - 1.15) * 8) * sin((t - 1.15) * 20) : 0;
  const a = 1.42 * fall - 0.06 * hit;
  const flat = ss(0.6, 1.3, t);
  return {
    hips: [0, -(0.96 - 0.13) * fall - 0.08 * buckle * (1 - fall) + 0.02 * hit, 0.35 * fall],
    r: {
      Hips: [a, 0, 0.05 * fall],
      Spine: [0.15 * flat, 0, 0],
      Chest: [0.3 * flat, 0, 0],
      Neck: [0.5 * flat, 0, 0],
      Head: [0.2 * flat, 0.2 * ss(1.1, 1.5, t), 0.4 * ss(1.1, 1.5, t)],
      Jaw: [-0.3 * fall, 0, 0.1 * fall],
      UpperArm_R: [-0.8 * fall + 0.4 * buckle * (1 - fall), 0, 0.7 * fall],
      LowerArm_R: [0.4 * fall, 0, 0],
      Hand_R: [0.3 * fall, 0, 0],
      UpperArm_L: [-0.7 * fall + 0.3 * buckle * (1 - fall), 0, -0.8 * fall],
      LowerArm_L: [0.5 * fall, 0, 0],
      UpperLeg_L: [0.5 * buckle * (1 - fall) - 0.08 * fall, 0, -0.08 * fall],
      LowerLeg_L: [-0.9 * buckle * (1 - fall) - 0.15 * fall, 0, 0],
      UpperLeg_R: [0.5 * buckle * (1 - fall) + 0.3 * fall, 0, 0.1 * fall],
      LowerLeg_R: [-0.9 * buckle * (1 - fall) - 0.55 * fall, 0, 0],
      Foot_L: [0.3 * fall, 0, 0],
      Foot_R: [0.2 * fall, 0, 0],
    },
  };
}

let clips: Record<ClipName, AnimationClip> | null = null;

/** The shared clips (built once). */
export function zombieClips(): Record<ClipName, AnimationClip> {
  clips ??= {
    Idle: bake('Idle', 3, idle),
    Walk: bake('Walk', 1.4, walk),
    Run: bake('Run', 0.85, run),
    Attack: bake('Attack', 1.1, attack),
    HitReaction: bake('HitReaction', 0.55, hitReaction),
    Death: bake('Death', 1.7, death),
  };
  return clips;
}

/** When the grab of Attack lands (s at speed 1): the game's bite comes then. */
export const ATTACK_HIT = 0.55;

/** A clip baked onto one type's rest pose (normal blending): for export, where nothing is additive. */
export function absoluteClip(clip: AnimationClip, dims: SkeletonDims): AnimationClip {
  const rest = restLocals(dims);
  const q = new Quaternion();
  const tracks = clip.tracks.map((tr) => {
    const [bone, prop] = tr.name.split('.') as [BoneName, string];
    const r = rest[BONES.indexOf(bone)];
    const v = Float32Array.from(tr.values);
    if (prop === 'quaternion') {
      for (let i = 0; i < v.length; i += 4) q.fromArray(v, i).premultiply(r.rot).toArray(v, i);
      return new QuaternionKeyframeTrack(tr.name, Array.from(tr.times), Array.from(v));
    }
    for (let i = 0; i < v.length; i += 3) (v[i] += r.pos.x), (v[i + 1] += r.pos.y), (v[i + 2] += r.pos.z);
    return new VectorKeyframeTrack(tr.name, Array.from(tr.times), Array.from(v));
  });
  return new AnimationClip(clip.name, clip.duration, tracks, NormalAnimationBlendMode);
}

/** A zombie's mixer with every shared clip ready: loops for Idle / Walk / Run, one-shots for the rest. */
export class ZombieAnimator {
  readonly mixer: AnimationMixer;
  readonly actions: Record<ClipName, AnimationAction>;
  current: ClipName | null = null;

  constructor(root: Object3D, readonly speed = 1) {
    this.mixer = new AnimationMixer(root);
    const c = zombieClips();
    this.actions = Object.fromEntries(
      CLIP_NAMES.map((n) => {
        const a = this.mixer.clipAction(c[n]);
        const once = n === 'Attack' || n === 'HitReaction' || n === 'Death';
        a.setLoop(once ? LoopOnce : LoopRepeat, Infinity);
        a.clampWhenFinished = n === 'Death';
        a.timeScale = speed;
        return [n, a];
      }),
    ) as Record<ClipName, AnimationAction>;
  }

  /** Cross-fade to a clip (a one-shot over a loop: the loop fades back in when it ends). */
  play(name: ClipName, fade = 0.2): void {
    const next = this.actions[name];
    for (const n of CLIP_NAMES) if (n !== name && this.actions[n].isRunning()) this.actions[n].fadeOut(fade);
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    this.current = name;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}

