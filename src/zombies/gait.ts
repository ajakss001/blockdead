import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { BoneName, SkeletonDims } from './skeleton';

/**
 * Walk and Run of the zombies: a human gait underneath, the zombie a light layer on top.
 *
 * The legs are solved, not keyed by angle: each ankle follows a path relative to the body — in stance the
 * foot stays put on the ground (it slides back under the body at one even rate: heel strike, the foot
 * rolling flat, the heel peeling off, the push from the ball of the foot), in swing it lifts and carries
 * forward — and a two-bone IK (knee to the front) turns the path into hip, knee and ankle turns. So a foot
 * on the ground never skids however the body bobs, and the angles come out as a person's (see WALK, RUN).
 *
 * The cycle is in fractions (u: 0 the left heel strikes, the right leg half a cycle behind). The body covers
 * `stride` leg lengths per cycle with a foot planted: the renderer advances u by distance / (stride × leg
 * length) (render/ZombieModels), so the feet don't slide at any speed.
 *
 * Model frame: the zombie faces −Z, its right is +X; bone frames as skeleton.ts (+X about a limb bends it
 * forward, a foot toe-up, a spine bone back). Solved for a build's own legs (GaitBuild: thigh and shin differ
 * between types), the lengths of the gait (× leg length) and its sway and bob scaled with them.
 */

type R = [number, number, number];
export interface GaitPose {
  hips: R;
  r: Partial<Record<BoneName, R>>;
  q: Partial<Record<BoneName, Quaternion>>;
}

const TAU = Math.PI * 2;
const { sin, cos, PI } = Math;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const deg = PI / 180;

/** The legs a gait is solved for (m, model frame at rest; `foot`: the shoe's size, × the average). */
export interface GaitBuild {
  hipsY: number;
  hipY: number;
  hipX: number;
  thigh: number;
  shin: number;
  ankle: number;
  foot: number;
}
/** The average build (skeleton.skeletonDims at 1.8 m). */
export const REF_BUILD: GaitBuild = { hipsY: 0.96, hipY: 0.91, hipX: 0.092, thigh: 0.41, shin: 0.415, ankle: 0.085, foot: 1 };
/** A type's legs. */
export function gaitBuild(d: SkeletonDims): GaitBuild {
  return { hipsY: d.hipsY, hipY: d.hipJointY, hipX: d.hipX, thigh: d.hipJointY - d.kneeY, shin: d.kneeY - d.ankleY, ankle: d.ankleY, foot: d.k };
}
/** The average leg length, hip joint to ankle: the unit of stride. */
export const LEG = REF_BUILD.thigh + REF_BUILD.shin;
/** Ankle to the back of the heel and to the toe of the shoe, along the sole (the shoes' soles, types/common). */
const HEEL = 0.08;
const TIP = 0.165;

export interface GaitSpec {
  /** Cycle length at natural speed, s (the clip's duration). */
  cycle: number;
  /** Share of the cycle a foot is on the ground (walk > 0.5: double support; run < 0.5: flight). */
  stance: number;
  /** When in stance the heel lifts (share of stance). */
  heelOff: number;
  /** Ankle ahead of the hip joint at heel strike (× leg length). */
  reach: number;
  /** Ground the body covers per cycle (× leg length): the foot slides back under it this fast in stance. */
  stride: number;
  /** Hips: lowered (m), up-and-down range (m, twice a cycle), lowest at this share of the cycle (walk: the
   * double support just after the strike, run: mid-stance). */
  crouch: number;
  bob: number;
  lowAt: number;
  /** Ankle lift in swing (× leg length), where it peaks (share of swing). */
  lift: number;
  liftAt: number;
  /** How early in swing the foot carries forward over the ground (1 even, < 1 sooner; still at both ends). */
  carry: number;
  /** Foot pitch to the ground: toe up at contact, toe down at toe-off; in swing the ankle's own turn, toe up (rad). */
  toeUpContact: number;
  toeDownOff: number;
  toeUpSwing: number;
  /** Feet apart (m, centre to centre) and the side sway of the hips (m). */
  width: number;
  sway: number;
  /** Pelvis: drop on the swing side and turn (rad); the chest turns back against it. */
  drop: number;
  turn: number;
  /** The limp: the right leg's step this much shorter, its swing this much lower (scuffing the toe). */
  limp: number;
  scuff: number;
  /** Upper body (rad): lean forward of spine and chest, arm swing (shoulder, ±), arms forward, elbow. */
  lean: number;
  armSwing: number;
  armFwd: number;
  elbow: number;
  elbowSwing: number;
  /** Arms trail the legs by this share of a cycle. */
  armLag: number;
  /** Head: down, to one side (rad); how much of the body's turn and roll it takes out. */
  headDown: number;
  headSide: number;
  steady: number;
}

/** A person's walk with the zombie on top, 1.3 s: hip +22° at contact, ~30° late in swing, −4° behind (the limping leg −16°); knee 11° at contact, 22° loading, 4° mid-stance, ~50° at toe-off, 55–57° through swing, near straight before contact; 0.8 m/s at 1.8 m. */
export const WALK: GaitSpec = {
  cycle: 1.3,
  stance: 0.6,
  heelOff: 0.72,
  reach: 0.29,
  stride: 1.25,
  crouch: 0,
  bob: 0.034,
  lowAt: 0.06,
  lift: 0.04,
  liftAt: 0.35,
  carry: 1,
  toeUpContact: 5 * deg,
  toeDownOff: 50 * deg,
  toeUpSwing: 8 * deg,
  width: 0.1,
  sway: 0.018,
  drop: 4 * deg,
  turn: 5 * deg,
  limp: 0.15,
  scuff: 0.55,
  lean: 12 * deg,
  armSwing: 6 * deg,
  armFwd: 8 * deg,
  elbow: 14 * deg,
  elbowSwing: 6 * deg,
  armLag: 0.06,
  headDown: 8 * deg,
  headSide: 7 * deg,
  steady: 0.85,
};

/** Run: the same with flight between the steps, the knee 20–40° in stance and ~80° in swing, lower and leaning in; 1.6 m/s at 1.8 m. */
export const RUN: GaitSpec = {
  cycle: 0.74,
  stance: 0.36,
  heelOff: 0.4,
  reach: 0.12,
  stride: 1.45,
  crouch: 0.01,
  bob: 0.045,
  lowAt: 0.18,
  lift: 0.16,
  liftAt: 0.42,
  carry: 1.2,
  toeUpContact: 0,
  toeDownOff: 34 * deg,
  toeUpSwing: 10 * deg,
  width: 0.08,
  sway: 0.012,
  drop: 4 * deg,
  turn: 8 * deg,
  limp: 0.12,
  scuff: 0.75,
  lean: 22 * deg,
  armSwing: 14 * deg,
  armFwd: 30 * deg,
  elbow: 70 * deg,
  elbowSwing: 12 * deg,
  armLag: 0.05,
  headDown: 0,
  headSide: 5 * deg,
  steady: 0.8,
};

const _hip = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _k = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();
const _e = new Euler();
const FORWARD = new Vector3(0, 0, -1);

/** A bone's world turn from its down-axis (−Y) along `dir` and its hinge (X) along `hinge`. */
function frame(dir: Vector3, hinge: Vector3, out: Quaternion): Quaternion {
  _y.copy(dir).negate();
  _x.copy(hinge);
  _z.crossVectors(_x, _y);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
}

interface Foot {
  /** Ankle, model frame relative to the ground under the hips at rest. */
  ankle: Vector3;
  /** Foot pitch to the ground (toe up +). */
  pitch: number;
  /** In swing: how much the foot follows the shin instead (0..1), at this ankle turn (toe up +). */
  mix: number;
  local: number;
}

/** Where a foot is at u (0: its heel strikes), `back` (m) further back for the limping leg. */
function footAt(g: GaitSpec, b: GaitBuild, u: number, back: number, low: number, out: Foot): Foot {
  const leg = b.thigh + b.shin;
  const ank = b.ankle;
  const heel = HEEL * b.foot;
  const tip = TIP * b.foot;
  const st = g.stance;
  const v = g.stride * leg; // ground per cycle
  const zc = -g.reach * leg + back; // ankle at heel strike
  const zo = zc + v * st; // where the flat foot's ankle would be at toe-off
  if (u < st) {
    // Stance: every point of the sole on the ground drifts back at v; the foot rolls heel → flat → ball.
    const drift = v * u;
    const load = st * 0.17;
    const off = st * g.heelOff;
    if (u < load) {
      // Rolling down onto the sole about the heel.
      const pitch = g.toeUpContact * (1 - ease(u / load));
      const heelZ = zc + heel + drift;
      out.ankle.set(0, ank * cos(pitch) + heel * sin(pitch), heelZ - heel * cos(pitch) + ank * sin(pitch));
      out.pitch = pitch;
    } else if (u < off) {
      out.ankle.set(0, ank, zc + drift);
      out.pitch = 0;
    } else {
      // The heel peels off: turning about the toe (the shoe is one piece; no toe goes into the ground).
      const t = (u - off) / (st - off);
      const pitch = -g.toeDownOff * t * t * (2 - t);
      const tipZ = zc + drift - tip;
      out.ankle.set(0, ank * cos(pitch) - tip * sin(pitch), tipZ + tip * cos(pitch) + ank * sin(pitch));
      out.pitch = pitch;
    }
    return out;
  }
  // Swing: from toe-off to the next heel strike, carried forward, lifted, the toe kept up.
  const s = (u - st) / (1 - st);
  const pOff = -g.toeDownOff;
  const yOff = ank * cos(pOff) - tip * sin(pOff);
  const zOff = zo - tip + tip * cos(pOff) + ank * sin(pOff);
  const yOn = ank * cos(g.toeUpContact) + heel * sin(g.toeUpContact);
  const zOn = zc + heel - heel * cos(g.toeUpContact) + ank * sin(g.toeUpContact);
  // Over the ground: from where the foot left to where it lands, still at both ends — the heel comes down
  // without skidding (in the body's frame it is already swinging back at the walk's pace when it strikes).
  const f = ease(clamp01(s) ** g.carry);
  const z = zOff + v * (u - st) - (v * (1 - st) + zOff - zOn) * f;
  const rise = s < g.liftAt ? sin(((PI / 2) * s) / g.liftAt) : cos((PI / 2) * clamp01((s - g.liftAt) / (1 - g.liftAt)));
  const y = lerp(yOff, yOn, ease(s)) + g.lift * leg * low * rise;
  out.ankle.set(0, y, z);
  // Toe: off the ground the ankle comes up to a little toe-up against the shin for clearance (the scuffing
  // leg's toe hangs), and turns to the strike's toe-up before the heel lands.
  out.pitch = lerp(pOff, g.toeUpContact, ease(s));
  out.mix = ease(s / 0.3) * ease((1 - s) / 0.3);
  out.local = g.toeUpSwing * low - (1 - low) * 15 * deg;
  return out;
}

/** The leg's three local turns (thigh in the pelvis, shin in the thigh, foot in the shin). */
function solveLeg(b: GaitBuild, hip: Vector3, foot: Foot, pelvis: Quaternion, out: [Quaternion, Quaternion, Quaternion]): void {
  const { ankle } = foot;
  const { thigh, shin } = b;
  _d.subVectors(ankle, hip);
  let D = _d.length();
  _d.divideScalar(D);
  D = Math.min(D, (thigh + shin) * 0.9995);
  // The knee bends forward: the pole is ahead of the leg.
  _p.copy(FORWARD).addScaledVector(_d, -FORWARD.dot(_d)).normalize();
  const ca = (thigh * thigh + D * D - shin * shin) / (2 * thigh * D);
  const a = Math.acos(Math.max(-1, Math.min(1, ca)));
  _k.copy(_d).multiplyScalar(cos(a)).addScaledVector(_p, sin(a)); // thigh direction
  const hinge = new Vector3().crossVectors(_k, _p).normalize();
  const thighW = frame(_k, hinge, new Quaternion());
  const kneePos = hip.clone().addScaledVector(_k, thigh);
  const shinDir = new Vector3().subVectors(hip.clone().addScaledVector(_d, D), kneePos).normalize();
  const shinW = frame(shinDir, hinge, new Quaternion());
  const footW = new Quaternion().setFromAxisAngle(_x.set(1, 0, 0), foot.pitch);
  if (foot.mix > 0) footW.slerp(shinW.clone().multiply(new Quaternion().setFromAxisAngle(_x.set(1, 0, 0), foot.local)), foot.mix);
  out[0].copy(pelvis).invert().multiply(thighW);
  out[1].copy(thighW).invert().multiply(shinW);
  out[2].copy(shinW).invert().multiply(footW);
}

/** Angles for checks and the viewer: hip flexion, knee flexion, ankle (toe up +), deg. */
export function legAngles(q: [Quaternion, Quaternion, Quaternion]): [number, number, number] {
  const a = (qq: Quaternion) => _e.setFromQuaternion(qq, 'XYZ').x / deg;
  return [a(q[0]), -a(q[1]), a(q[2])];
}

/** The gait pose at u (0..1, the left heel strikes at 0) for build `b`. */
export function gaitPose(
  g: GaitSpec,
  u: number,
  b = REF_BUILD,
): GaitPose & { legs: Record<'L' | 'R', [Quaternion, Quaternion, Quaternion]>; feet: Record<'L' | 'R', Foot> } {
  const leg = b.thigh + b.shin;
  const m = leg / LEG;
  const uL = ((u % 1) + 1) % 1;
  const uR = (uL + 0.5) % 1;
  const w = TAU * uL;
  // Hips: down twice a cycle, swaying over the foot on the ground, the swing side dropping, turning with
  // the leg that swings forward.
  const bobU = 2 * (w - TAU * g.lowAt);
  const dy = (-g.crouch - (g.bob * (1 + cos(bobU))) / 2) * m;
  const dx = -g.sway * m * sin(w);
  const roll = -g.drop * sin(w);
  const yaw = -g.turn * cos(w);
  const pelvis = new Quaternion().setFromEuler(_e.set(0, yaw, roll));
  const hipsPos = new Vector3(dx, b.hipsY + dy, 0);
  const legs = { L: [new Quaternion(), new Quaternion(), new Quaternion()], R: [new Quaternion(), new Quaternion(), new Quaternion()] } as Record<
    'L' | 'R',
    [Quaternion, Quaternion, Quaternion]
  >;
  const feet = {} as Record<'L' | 'R', Foot>;
  // The limp: the right foot lands and leaves a little further back (a shorter step on it), swings low.
  // (Steps alternate half a cycle apart: a step is half the stride; moving one foot's marks back by δ makes
  // its step δ shorter and the other's δ longer.)
  const step = (g.stride * leg) / 2;
  const back = (g.limp * step) / (2 - g.limp);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? -1 : 1;
    const f = footAt(g, b, side === 'L' ? uL : uR, side === 'R' ? back : 0, side === 'R' ? g.scuff : 1, { ankle: new Vector3(), pitch: 0, mix: 0, local: 0 });
    f.ankle.x = (sx * g.width * m) / 2;
    feet[side] = f;
    _hip.set(sx * b.hipX, b.hipY - b.hipsY, 0).applyQuaternion(pelvis).add(hipsPos);
    solveLeg(b, _hip.clone(), f, pelvis, legs[side]);
  }
  // Arms against the legs (the left leg forward: the right arm forward), trailing a little.
  const wa = TAU * (uL - g.armLag);
  const fwdR = cos(wa);
  const armR: R = [g.armFwd + g.armSwing * fwdR, 0, 0.04];
  const armL: R = [g.armFwd - g.armSwing * fwdR, 0, -0.04];
  const elR: R = [g.elbow + g.elbowSwing * Math.max(0, fwdR), 0, 0];
  const elL: R = [g.elbow + g.elbowSwing * Math.max(0, -fwdR), 0, 0];
  // The torso: back upright over the tilted pelvis, the chest turning against it; leaning forward.
  const k = g.steady;
  return {
    hips: [dx, dy, 0],
    q: {
      Hips: pelvis,
      UpperLeg_L: legs.L[0],
      LowerLeg_L: legs.L[1],
      Foot_L: legs.L[2],
      UpperLeg_R: legs.R[0],
      LowerLeg_R: legs.R[1],
      Foot_R: legs.R[2],
    },
    r: {
      Spine: [-g.lean * 0.45, -yaw, -roll * 0.8],
      Chest: [-g.lean * 0.55, -yaw, -roll * 0.1],
      // The head takes out most of the chest's turn and the bob's nod: it stays nearly still.
      Neck: [0.25 * g.lean, yaw * k * 0.5, roll * 0.2],
      Head: [-g.headDown + 0.2 * g.lean, yaw * k * 0.5, g.headSide - roll * 0.3],
      UpperArm_R: armR,
      LowerArm_R: elR,
      Hand_R: [0.1 + 0.05 * fwdR, 0, 0],
      UpperArm_L: armL,
      LowerArm_L: elL,
      Hand_L: [0.1 - 0.05 * fwdR, 0, 0],
    },
    legs,
    feet,
  };
}
