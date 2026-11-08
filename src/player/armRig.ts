import { Matrix4, Quaternion, Vector3 } from 'three';
import { clamp, easeInOutSine, easeInQuad, easeOutQuad } from '../core/math';
import { GRIP_X, GRIP_Z } from './hand';
import type { HeldConfig, Key, KeySet, Socket, SwingPoint } from './held';

/**
 * First-person arm rig (pure math, no meshes — the viewmodel applies it, test:anim checks it).
 *
 * 1. An item is animated by key poses in viewmodel-camera space (`poseItem`): slerp along the shortest
 *    arc with easing between Idle → Windup → Strike → Recover → Idle; Recover is its own waypoint.
 * 2. Each hand is rigid with its socket on the item (grip_main / grip_off): hand = item × socket.
 * 3. Each arm is a two-bone chain shoulder → elbow → wrist solved to that hand (`ArmRig.solve`); the elbow
 *    starts at the pole (down and out) and swivels about the shoulder–wrist line only when the wrist would
 *    leave its range — the elbow and forearm move first, the hand never leaves the socket.
 * 4. Twist about the forearm is shared: half the forearm (roll), half the wrist, wrist ±40° at most.
 * 5. The hand sits on the end of the sleeve: the wrist is at the forearm's tip by construction.
 */

export const UPPER = 0.34;
export const FOREARM = 0.32;
/** Elbow → wrist (the hand's origin): the sleeve plus the cuff. */
export const HAND_OFFSET = FOREARM + 0.01;

const DEG = Math.PI / 180;
/**
 * Wrist range. Bend (сгиб): the handle tipping towards or away from the forearm, in the plane of the thumb
 * (the hammering motion, about the hand's X). Sideways (вбок): towards the palm or the back of the hand
 * (about the hand's Y, the handle axis). Twist: about the forearm.
 */
export const WRIST_FLEX = 60 * DEG;
export const WRIST_DEV = 25 * DEG;
export const WRIST_TWIST = 40 * DEG;
/** Forearm roll (pronation / supination from the handshake position). */
export const FOREARM_ROLL = 85 * DEG;
/** Elbows never closer to the eye than this. */
const ELBOW_CLEAR = 0.3;

/** Shoulders below and just behind the eyes; poles: the elbows bent down and out. */
export const SHOULDER_R = new Vector3(0.19, -0.25, -0.05);
export const SHOULDER_L = new Vector3(-0.19, -0.25, -0.05);
export const POLE_R = new Vector3(0.7, -0.6, 0.25).normalize();
export const POLE_L = new Vector3(-0.8, -0.2, 0.55).normalize();

/** Result of one arm solve, in viewmodel-camera space; angles in radians. */
export interface ArmPose {
  shoulder: Vector3;
  elbow: Vector3;
  /** Forearm (elbow) frame: −Z from the elbow to the wrist. */
  forearm: Quaternion;
  /** Hand relative to the forearm (the wrist joint). */
  hand: Quaternion;
  /** Upper arm: −Z from the shoulder to the elbow. */
  upper: Quaternion;
  upperLen: number;
  flex: number;
  dev: number;
  twist: number;
  roll: number;
  swivel: number;
  /** How far the wrist falls short of the socket (out of reach), m. */
  reachErr: number;
  /** Shoulder–wrist distance over the arm length (1 = straight). */
  extension: number;
}

const _m = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _d = new Vector3();
const _n = new Vector3();
const _p0 = new Vector3();
const _q0 = new Vector3();
const _e = new Vector3();
const _w = new Vector3();
const _h = new Vector3();
const _hy = new Vector3();
const _u = new Vector3();
const _t = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _qs = new Quaternion();
const _qr = new Quaternion();
const AXIS_Z = new Vector3(0, 0, 1);
const FWD = new Vector3(0, 0, -1);

const over = (v: number, lim: number) => Math.max(0, Math.abs(v) - lim);
const wrapPi = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
/** How far the elbow may swivel off its pole. */
const SWIVEL_MAX = 100 * DEG;
/** Most the elbow swivels in one frame. */
const SWIVEL_STEP = 14 * DEG;
/** The elbow keeps the wrist this far inside its range when it can. */
const MARGIN = 1.5 * DEG;
/** The twist kept off its limit too, by less (the hold under a handguard sits on it). */
const TWIST_MARGIN = 0.5 * DEG;

interface Eval {
  cost: number;
  flex: number;
  dev: number;
  twist: number;
  roll: number;
}
const _ev: Eval = { cost: 0, flex: 0, dev: 0, twist: 0, roll: 0 };

export class ArmRig {
  readonly pose: ArmPose = {
    shoulder: new Vector3(),
    elbow: new Vector3(),
    forearm: new Quaternion(),
    hand: new Quaternion(),
    upper: new Quaternion(),
    upperLen: UPPER,
    flex: 0,
    dev: 0,
    twist: 0,
    roll: 0,
    swivel: 0,
    reachErr: 0,
    extension: 0,
  };
  /** Swivel of the last solve: the next one stays close to it (no elbow flips between frames). */
  private swivel = 0;
  /** Total twist of the last solve: the next one is unwrapped next to it (never flips through ±180°). */
  private tau = 0;
  private fresh = true;
  private readonly grip: Vector3;
  private readonly wrist = new Vector3();
  private readonly handQ = new Quaternion();

  /** Where the shoulder is this frame (the rest position turned with the body). */
  readonly shoulder = new Vector3();

  constructor(
    readonly side: 1 | -1,
    readonly rest: Vector3,
    readonly pole: Vector3,
  ) {
    this.grip = new Vector3(GRIP_X * side, 0, GRIP_Z);
    this.shoulder.copy(rest);
  }

  /** Forget the elbow history (item switched, teleported pose). */
  reset(): void {
    this.fresh = true;
  }

  /** Place the hand rigidly at `handQ` with its grip point on `gripPoint`, and bend the arm to it. */
  solve(handQ: Quaternion, gripPoint: Vector3): ArmPose {
    const s = this.shoulder;
    this.pose.shoulder.copy(s);
    this.handQ.copy(handQ);
    // The wrist (hand origin) from the grip point back along the hand.
    this.wrist.copy(this.grip).applyQuaternion(handQ);
    this.wrist.subVectors(gripPoint, this.wrist);
    _n.subVectors(this.wrist, s);
    const dist = _n.length();
    const a = UPPER;
    const b = HAND_OFFSET;
    const len = clamp(dist, Math.abs(a - b) + 1e-4, a + b - 1e-4);
    this.pose.reachErr = Math.max(0, dist - len);
    this.pose.extension = dist / (a + b);
    _n.divideScalar(dist || 1);
    // Wrist actually reached (short of the socket only when out of reach).
    _w.copy(s).addScaledVector(_n, len);
    const along = (a * a - b * b + len * len) / (2 * len);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    _p0.copy(this.pole).addScaledVector(_n, -this.pole.dot(_n)).normalize();
    _q0.crossVectors(_n, _p0);

    // Swivel: a scan, then finer steps around the best. On a fresh start the whole range; after that
    // only next to the last frame's elbow, so it cannot flip to another solution between frames.
    let best = 0;
    let bestCost = Infinity;
    const prev = this.fresh ? 0 : this.swivel;
    // Fresh: the whole range. After that the elbow moves at most SWIVEL_STEP a frame (no visible jumps).
    const lo = this.fresh ? -SWIVEL_MAX : Math.max(-SWIVEL_MAX, prev - SWIVEL_STEP);
    const hi = this.fresh ? SWIVEL_MAX : Math.min(SWIVEL_MAX, prev + SWIVEL_STEP);
    const n = this.fresh ? 10 : 4;
    const step0 = this.fresh ? 10 * DEG : SWIVEL_STEP / n;
    for (let i = -n; i <= n; i++) {
      const phi = clamp(prev + i * step0, lo, hi);
      const c = this.evaluate(phi, along, h, prev).cost;
      if (c < bestCost) {
        bestCost = c;
        best = phi;
      }
    }
    for (let step = step0 * 0.5; step > 0.2 * DEG; step *= 0.5) {
      for (const phi of [clamp(best - step, lo, hi), clamp(best + step, lo, hi)]) {
        const c = this.evaluate(phi, along, h, prev).cost;
        if (c < bestCost) {
          bestCost = c;
          best = phi;
        }
      }
    }
    const ev = this.evaluate(best, along, h, prev, true);
    this.swivel = best;
    this.tau = ev.twist + ev.roll;
    this.fresh = false;
    const p = this.pose;
    p.flex = ev.flex;
    p.dev = ev.dev;
    p.twist = ev.twist;
    p.roll = ev.roll;
    p.swivel = best;
    // Upper arm, its roll from the same elbow plane as the forearm.
    _z.subVectors(s, p.elbow);
    p.upperLen = _z.length();
    _z.normalize();
    _y.subVectors(_w, p.elbow);
    _y.addScaledVector(_z, -_y.dot(_z));
    if (_y.lengthSq() < 1e-8) _y.copy(_p0);
    _y.normalize();
    _x.crossVectors(_y, _z);
    p.upper.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
    return p;
  }

  /**
   * Arm with the elbow swivelled by `phi`: forearm frame, the twist split, wrist angles, cost.
   * With `commit`, the elbow, forearm and hand rotations are written to the pose.
   */
  private evaluate(phi: number, along: number, h: number, prev: number, commit = false): Eval {
    const s = this.shoulder;
    _e.copy(s).addScaledVector(_n, along).addScaledVector(_p0, h * Math.cos(phi)).addScaledVector(_q0, h * Math.sin(phi));
    // Elbow-plane frame of the forearm, at the handshake position: Z from the wrist to the elbow,
    // Y the thumb-up direction (away from the upper arm across the forearm), X = Y × Z.
    _d.subVectors(_w, _e).normalize();
    _z.copy(_d).negate();
    _y.subVectors(s, _e);
    _y.addScaledVector(_z, -_y.dot(_z));
    if (_y.lengthSq() < 1e-8) _y.copy(_p0).negate();
    _y.normalize();
    _x.crossVectors(_y, _z);
    // Hand turned the shortest way until its reach lies along the forearm: what is left is pure twist.
    _h.copy(FWD).applyQuaternion(this.handQ);
    _qs.setFromUnitVectors(_h, _d);
    _hy.set(0, 1, 0).applyQuaternion(this.handQ).applyQuaternion(_qs);
    let tau = Math.atan2(-_hy.dot(_x), _hy.dot(_y));
    if (!this.fresh) tau = this.tau + wrapPi(tau - this.tau);
    // Half to the forearm, half to the wrist; past the wrist's range the forearm takes the rest.
    let wristTw = clamp(tau * 0.5, -WRIST_TWIST, WRIST_TWIST);
    let roll = tau - wristTw;
    if (Math.abs(roll) > FOREARM_ROLL) {
      roll = Math.sign(roll) * FOREARM_ROLL;
      wristTw = tau - roll;
    }
    // Forearm = elbow plane × roll; wrist = forearm⁻¹ × hand.
    _qa.setFromRotationMatrix(_m.makeBasis(_x, _y, _z)).multiply(_qr.setFromAxisAngle(AXIS_Z, roll));
    _qb.copy(_qa).invert().multiply(this.handQ);
    // The forearm's direction seen from the hand: the bend tips the handle (about the hand's X), the
    // sideways bend turns the hand towards the palm or its back (about its Y).
    _u.copy(FWD).applyQuaternion(_qs.copy(_qb).invert());
    const flex = Math.atan2(_u.y, -_u.z);
    const dev = Math.atan2(_u.x, -_u.z);
    const ev = _ev;
    ev.flex = flex;
    ev.dev = dev;
    ev.twist = wristTw;
    ev.roll = roll;
    const elbowNear = Math.max(0, ELBOW_CLEAR - _e.length());
    ev.cost =
      10 * (over(flex, WRIST_FLEX - MARGIN) ** 2 + over(dev, WRIST_DEV - MARGIN) ** 2 + over(wristTw, WRIST_TWIST - TWIST_MARGIN) ** 2 + over(roll, FOREARM_ROLL) ** 2) +
      0.01 * ((flex / WRIST_FLEX) ** 2 + (dev / WRIST_DEV) ** 2 + (tau / (2 * WRIST_TWIST)) ** 2) +
      0.05 * phi * phi +
      0.05 * (phi - prev) ** 2 +
      100 * elbowNear * elbowNear;
    if (commit) {
      this.pose.elbow.copy(_e);
      this.pose.forearm.copy(_qa);
      this.pose.hand.copy(_qb);
    }
    return ev;
  }
}

/** Swing / stance state of an item being posed. */
export interface ItemState {
  /** Seconds since the swing started, or −1. */
  attackT: number;
  /** 0..1 towards the sprint pose. */
  sprint: number;
  /** −1..1, the arm pumping in step while sprinting. */
  pump: number;
  /** 0..1 towards the lowered pose (switching, flashlight off). */
  lower: number;
}

interface CompiledKey {
  at: Vector3;
  q: Quaternion;
  /** Turn of the shoulders (torso) about the chest. */
  body: Quaternion;
  slide: number;
}
type CompiledSet = Record<'idle' | 'sprint' | 'lowered' | 'windup' | 'strike' | 'recover', CompiledKey>;
const compiled = new Map<KeySet, CompiledSet>();

/** Rotation whose +Y is `axis` and whose −Z leans towards `edge`. */
export function basisQuat(axis: Vector3, edge: Vector3, out = new Quaternion()): Quaternion {
  const y = axis.clone().normalize();
  const z = edge.clone().addScaledVector(y, -edge.dot(y)).normalize().negate();
  const x = new Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

function compileKey(k: Key): CompiledKey {
  const b = new Vector3(...(k.body ?? [0, 0, 0]));
  const ang = b.length();
  return {
    at: new Vector3(...k.at),
    q: basisQuat(new Vector3(...k.axis), new Vector3(...k.edge)),
    body: ang > 1e-9 ? new Quaternion().setFromAxisAngle(b.divideScalar(ang), ang) : new Quaternion(),
    slide: k.slide ?? 0,
  };
}

function keysOf(set: KeySet): CompiledSet {
  let c = compiled.get(set);
  if (!c) {
    const idle = compileKey(set.idle);
    c = {
      idle,
      sprint: compileKey(set.sprint),
      lowered: compileKey(set.lowered),
      windup: set.windup ? compileKey(set.windup) : idle,
      strike: set.strike ? compileKey(set.strike) : idle,
      recover: set.recover ? compileKey(set.recover) : idle,
    };
    compiled.set(set, c);
  }
  return c;
}

const _rest: CompiledKey = { at: new Vector3(), q: new Quaternion(), body: new Quaternion(), slide: 0 };
const _pump = new Quaternion();
const AXIS_X = new Vector3(1, 0, 0);

/** Phase of the swing and camera pitch of the last poseItem call. */
export const swingOut = { pitch: 0, phase: 'rest' as 'rest' | 'windup' | 'strike' | 'follow' | 'recover' };

/** Whole swing, s. */
export const swingTime = (cfg: HeldConfig): number => cfg.windup + cfg.strike + (cfg.follow ?? 0) + cfg.recover;
/** When the blow lands (hit check, sound), s from the start: path swings at contact, keyed ones at the end of the windup. */
export const hitTime = (cfg: HeldConfig): number => (cfg.keys.swing ? cfg.windup + cfg.strike : cfg.windup);

// Path scratch: 8 points (rest, the 6 waypoints, rest), their tangents, chord directions.
const _P = Array.from({ length: 8 }, () => new Vector3());
const _H = Array.from({ length: 8 }, () => new Vector3());
const _MP = Array.from({ length: 8 }, () => new Vector3());
const _MH = Array.from({ length: 8 }, () => new Vector3());
const _D = Array.from({ length: 8 }, () => new Vector3());
const _hd = new Vector3();
const _hn = new Vector3();
const _vel = new Vector3();
const _ax = new Vector3();
const _ed = new Vector3();
const _qb2 = new Quaternion();
const _bodyA = new Quaternion();
const _bodyB = new Quaternion();
/** Where the head turns back (zero tangent): rest, the top of the windup, the end of the follow-through. */
const TURN = [true, false, true, false, false, true, false, true];
/** +1 where the head moves the way of the blow (strike, follow-through), −1 where it moves back. */
const SENSE = [-1, -1, 1, 1, 1, -1, -1];

function hermite(p0: Vector3, m0: Vector3, p1: Vector3, m1: Vector3, s: number, out: Vector3): Vector3 {
  const s2 = s * s;
  const s3 = s2 * s;
  return out
    .copy(p0)
    .multiplyScalar(2 * s3 - 3 * s2 + 1)
    .addScaledVector(m0, s3 - 2 * s2 + s)
    .addScaledVector(p1, -2 * s3 + 3 * s2)
    .addScaledVector(m1, s3 - s2);
}

function hermiteD(p0: Vector3, m0: Vector3, p1: Vector3, m1: Vector3, s: number, out: Vector3): Vector3 {
  const s2 = s * s;
  return out
    .copy(p0)
    .multiplyScalar(6 * s2 - 6 * s)
    .addScaledVector(m0, 3 * s2 - 4 * s + 1)
    .addScaledVector(p1, -6 * s2 + 6 * s)
    .addScaledVector(m1, 3 * s2 - 2 * s);
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/**
 * Path swing (KeySet.swing): the head and the anchor hand run through rest → waypoints → rest on cubic
 * Bézier (Hermite) segments; the handle runs from the hand to the head, the edge faces along the arc in
 * the direction of the blow (blended to the chord directions where the head stops and turns back),
 * turned by the waypoints' roll. Easing: slow out of rest into the windup, accelerating strike, braking
 * follow-through, smooth recover. Writes the anchor socket point (as keys do); returns the slide.
 */
function pathPose(cfg: HeldConfig, t: number, rest: CompiledKey, outPos: Vector3, outQ: Quaternion, outBody: Quaternion): number {
  const pts = cfg.keys.swing!;
  const anchor = cfg.keys.anchor === 'off' && cfg.off ? cfg.off : cfg.main;
  // Rest: the live rest pose's head and anchor hand.
  _hd.set(0, anchor.along, 0).applyQuaternion(rest.q);
  _P[0].set(0, cfg.head[1], 0).applyQuaternion(rest.q).add(rest.at).sub(_hd);
  _H[0].copy(rest.at);
  for (let i = 0; i < 6; i++) {
    _P[i + 1].set(...pts[i].head);
    _H[i + 1].set(...pts[i].hand);
  }
  _P[7].copy(_P[0]);
  _H[7].copy(_H[0]);
  for (let i = 0; i < 8; i++) {
    if (TURN[i]) {
      _MP[i].set(0, 0, 0);
      _MH[i].set(0, 0, 0);
    } else {
      _MP[i].subVectors(_P[i + 1], _P[i - 1]).multiplyScalar(0.5);
      _MH[i].subVectors(_H[i + 1], _H[i - 1]).multiplyScalar(0.5);
    }
  }
  // Edge directions to fall back on where the head is slow: the blow-wise chords around each waypoint;
  // at rest, the rest pose's own edge.
  const restEdge = _ed.set(0, 0, -1).applyQuaternion(rest.q);
  for (let i = 1; i < 7; i++) {
    _D[i].subVectors(_P[i], _P[i - 1]).normalize().multiplyScalar(SENSE[i - 1]);
    _hn.subVectors(_P[i + 1], _P[i]).normalize().multiplyScalar(SENSE[i]);
    _D[i].add(_hn).normalize();
  }
  _D[0].copy(restEdge);
  if (cfg.keys.stab) for (let j = 1; j < 7; j++) _D[j].set(0, -1, 0);
  // Out of rest the edge stays half with the rest pose (no quick turn of the blade about the handle).
  _D[1].add(restEdge).normalize();
  _D[7].copy(restEdge);

  // Time → path parameter u (segment index + fraction), with the easing of each phase.
  const w = cfg.windup;
  const s = cfg.strike;
  const f = cfg.follow ?? 0;
  const r = cfg.recover;
  let u: number;
  if (t < w) {
    u = 2 * easeInOutSine(t / w);
    swingOut.phase = 'windup';
  } else if (t < w + s) {
    // Linear in the path: the zero tangent at the top already eases it in; the speed peaks at contact.
    u = 2 + 2 * ((t - w) / s);
    swingOut.phase = 'strike';
  } else if (t < w + s + f) {
    u = 4 + easeOutQuad((t - w - s) / f);
    swingOut.phase = 'follow';
  } else {
    u = 5 + 2 * easeInOutSine(Math.min(1, (t - w - s - f) / r));
    swingOut.phase = 'recover';
  }
  const i = Math.min(6, Math.floor(u));
  const a = u - i;
  const head = hermite(_P[i], _MP[i], _P[i + 1], _MP[i + 1], a, _hn);
  const hand = hermite(_H[i], _MH[i], _H[i + 1], _MH[i + 1], a, outPos);
  hermiteD(_P[i], _MP[i], _P[i + 1], _MP[i + 1], a, _vel).multiplyScalar(SENSE[i]);
  // Handle from the hand to the head; edge: along the arc, faded to the chord directions when slow.
  _ax.subVectors(head, hand).normalize();
  // A stab does not follow the arc: the edge turns from the rest pose to down and back (the knife turns only as the hand does).
  const k = cfg.keys.stab ? 0 : smooth(Math.min(1, _vel.length() / 0.35));
  _ed.copy(_D[i]).lerp(_D[i + 1], smooth(a)).multiplyScalar(1 - k);
  if (k > 0) _ed.addScaledVector(_vel.normalize(), k);
  basisQuat(_ax, _ed, outQ);
  const p0 = i === 0 ? null : pts[i - 1];
  const p1 = i + 1 === 7 ? null : pts[i];
  const sa = smooth(a);
  const roll = (p0?.roll ?? 0) + ((p1?.roll ?? 0) - (p0?.roll ?? 0)) * sa;
  if (roll) outQ.multiply(_qb2.setFromAxisAngle(AXIS_Y, roll));
  // Item placed by its head; the anchor socket point is what the caller expects.
  _hd.set(0, cfg.head[1], 0).applyQuaternion(outQ);
  outPos.copy(head).sub(_hd).addScaledVector(_t.set(0, 1, 0).applyQuaternion(outQ), anchor.along);
  // Shoulders, slide, camera pitch: per waypoint, smoothly between them.
  const bodyOf = (p: SwingPoint | null, q: Quaternion) => {
    if (!p?.body) return q.copy(rest.body);
    _hd.set(...p.body);
    const ang = _hd.length();
    return ang > 1e-9 ? q.setFromAxisAngle(_hd.divideScalar(ang), ang) : q.identity();
  };
  outBody.copy(bodyOf(p0, _bodyA)).slerp(bodyOf(p1, _bodyB), sa);
  swingOut.pitch = (p0?.pitch ?? 0) + ((p1?.pitch ?? 0) - (p0?.pitch ?? 0)) * sa;
  return (p0 ? (p0.slide ?? 0) : rest.slide) + ((p1 ? (p1.slide ?? 0) : rest.slide) - (p0 ? (p0.slide ?? 0) : rest.slide)) * sa;
}

/**
 * Pose of an item (butt position + rotation, viewmodel space) for a swing state: rest/sprint blend with
 * the sprint pump, the swing over it, then lowered. Shortest-arc slerp everywhere, never Euler angles.
 * Returns where the main hand is along the handle (it slides in some swings).
 */
export function poseItem(cfg: HeldConfig, st: ItemState, outPos: Vector3, outQ: Quaternion, outBody: Quaternion): number {
  const k = keysOf(cfg.keys);
  const rest = _rest;
  rest.at.copy(k.idle.at).lerp(k.sprint.at, st.sprint);
  rest.q.copy(k.idle.q).slerp(k.sprint.q, st.sprint);
  rest.body.copy(k.idle.body).slerp(k.sprint.body, st.sprint);
  rest.at.y += st.pump * 0.03;
  rest.q.premultiply(_pump.setFromAxisAngle(AXIS_X, st.pump * 0.12));
  outPos.copy(rest.at);
  outQ.copy(rest.q);
  outBody.copy(rest.body);
  let slide = k.idle.slide + (k.sprint.slide - k.idle.slide) * st.sprint;
  swingOut.pitch = 0;
  swingOut.phase = 'rest';
  if (st.attackT >= 0 && cfg.keys.swing) {
    slide = pathPose(cfg, st.attackT, rest, outPos, outQ, outBody);
  } else if (st.attackT >= 0) {
    swingOut.phase = st.attackT < cfg.windup ? 'windup' : st.attackT < cfg.windup + cfg.strike ? 'strike' : 'recover';
    const t = st.attackT;
    let from: CompiledKey = rest;
    let to: CompiledKey;
    let e: number;
    if (t < cfg.windup) {
      to = k.windup;
      e = easeOutQuad(t / cfg.windup);
    } else if (t < cfg.windup + cfg.strike) {
      from = k.windup;
      to = k.strike;
      e = easeInQuad((t - cfg.windup) / cfg.strike);
    } else {
      const r = Math.min(1, (t - cfg.windup - cfg.strike) / cfg.recover);
      if (r < 0.4) {
        from = k.strike;
        to = k.recover;
        e = easeInOutSine(r / 0.4);
      } else {
        from = k.recover;
        to = rest;
        e = easeOutQuad((r - 0.4) / 0.6);
      }
    }
    outPos.copy(from.at).lerp(to.at, e);
    outQ.copy(from.q).slerp(to.q, e);
    outBody.copy(from.body).slerp(to.body, e);
    slide = from.slide + (to.slide - from.slide) * e;
  }
  if (st.lower > 0) {
    outPos.lerp(k.lowered.at, st.lower);
    outQ.slerp(k.lowered.q, st.lower);
    outBody.slerp(k.lowered.body, st.lower);
    slide += (k.lowered.slide - slide) * st.lower;
  }
  // Keys give the anchor socket; the item's origin is its butt.
  const anchor = cfg.keys.anchor === 'off' && cfg.off ? cfg.off : cfg.main;
  const mainAlong = cfg.main.along + ((cfg.main.slide ?? cfg.main.along) - cfg.main.along) * slide;
  outPos.addScaledVector(_t.set(0, 1, 0).applyQuaternion(outQ), -(anchor === cfg.main ? mainAlong : anchor.along));
  return mainAlong;
}

const _ry = new Quaternion();
const AXIS_Y = new Vector3(0, 1, 0);

/** Hand frame and grip point of a socket on an item posed at (pos, q). */
export function socketFrame(pos: Vector3, q: Quaternion, socket: Socket, outQ: Quaternion, outGrip: Vector3, along = socket.along): void {
  outQ.copy(q).multiply(_ry.setFromAxisAngle(AXIS_Y, socket.roll));
  outGrip.set(0, along, 0).applyQuaternion(q).add(pos);
}

/** Both arms for what is in the hands: the item in the right, the other hand on its off socket or on the flashlight. */
export class HandsRig {
  readonly right = new ArmRig(1, SHOULDER_R, POLE_R);
  readonly left = new ArmRig(-1, SHOULDER_L, POLE_L);
  /** Item pose (butt + rotation) and the flashlight's, viewmodel space. */
  readonly item = { pos: new Vector3(), q: new Quaternion(), body: new Quaternion() };
  readonly torch = { pos: new Vector3(), q: new Quaternion(), body: new Quaternion() };
  /** Where each hand is asked to be: grip point and hand rotation (the sockets). */
  readonly targetR = { grip: new Vector3(), q: new Quaternion() };
  readonly targetL = { grip: new Vector3(), q: new Quaternion() };
  /** Where the main hand holds the item this frame, along the handle from the butt. */
  mainAlong = 0;
  /** Camera pitch the swing asks for (rad) and its phase, this frame. */
  pitch = 0;
  phase: (typeof swingOut)['phase'] = 'rest';

  reset(): void {
    this.right.reset();
    this.left.reset();
  }

  update(cfg: HeldConfig, st: ItemState, torchCfg: HeldConfig, torchSt: ItemState): void {
    const it = this.item;
    this.mainAlong = poseItem(cfg, st, it.pos, it.q, it.body);
    this.pitch = swingOut.pitch;
    this.phase = swingOut.phase;
    socketFrame(it.pos, it.q, cfg.main, this.targetR.q, this.targetR.grip, this.mainAlong);
    turnShoulder(this.right, it.body);
    this.right.solve(this.targetR.q, this.targetR.grip);
    if (cfg.twoHanded && cfg.off) {
      socketFrame(it.pos, it.q, cfg.off, this.targetL.q, this.targetL.grip);
      turnShoulder(this.left, it.body);
    } else {
      const t = this.torch;
      poseItem(torchCfg, torchSt, t.pos, t.q, t.body);
      socketFrame(t.pos, t.q, torchCfg.main, this.targetL.q, this.targetL.grip);
      turnShoulder(this.left, t.body);
    }
    this.left.solve(this.targetL.q, this.targetL.grip);
  }
}

/** Middle of the chest: the shoulders turn about it with the torso. */
const CHEST = new Vector3(0, -0.42, 0.1);

function turnShoulder(arm: ArmRig, body: Quaternion): void {
  arm.shoulder.subVectors(arm.rest, CHEST).applyQuaternion(body).add(CHEST);
}
