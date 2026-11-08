import { Quaternion, Vector3 } from 'three';
import { clamp, easeInOutSine } from '../core/math';
import { gunSockets, type GunSockets, type HandFrame, type V3 } from '../weapons/gunFrame';
import { GUNS, type GunClass, type GunId } from '../weapons/guns';
import type { GunAction } from '../weapons/gunState';
import { RELOAD_MARKS } from '../weapons/gunState';
import { basisQuat } from './armRig';
import { GUN_TUNED } from './gunTuned';
import { GRIPS, onGripsChanged, quat, vec } from './grips';

/**
 * Firearms in first person (pure math, no meshes: the viewmodel applies it, test:anim checks it).
 *
 * The gun is posed by key poses in viewmodel-camera space — hip, sights (ADS: the rear and front sights on
 * the line through the eye, so the front sight sits in the middle of the screen), sprint (a long gun lowered
 * across the body, a pistol at the chest), crouch, against a wall (muzzle up and back, it can't fire), drawn /
 * put away — blended by shortest-arc slerp, never Euler angles; the recoil and the sway on top.
 * The right hand holds the grip (grip_main: the gun is its child), the left the handguard / the pump / its
 * own hand round the right on a pistol (grip_off); both rigid with their frames on the gun (`HandFrame`:
 * the grip axis and the reach of the fist). A reload is a path of the left hand: from its socket to the
 * magazine, out, down to the pouch, a new one up and in, to the bolt (from empty) and back; one at a time
 * for the pump gun and the bolt rifle, the rocket into the RPG's muzzle.
 */

export interface GunPoseInput {
  /** 0..1 into the sights, sprinting, crouched, against a wall, put away (switching). */
  ads: number;
  sprint: number;
  crouch: number;
  wall: number;
  lower: number;
  /** The arms pumping in step while sprinting −1..1. */
  pump: number;
  /** The current action of the gun and how far into it (s of its duration). */
  action: GunAction;
  t: number;
  duration: number;
  /** Seconds since the last shot (slide / bolt travel), and the slide locked back (a pistol fired dry). */
  sinceShot: number;
  open: boolean;
  /** A round / the rocket is in the chamber (GunInst.chamber: the one loaded state; the RPG's rocket shows by it). */
  chamber: boolean;
  /** Recoil now: back (m), up (rad), sideways (rad), roll (rad). */
  kickBack: number;
  kickUp: number;
  kickSide: number;
  kickRoll: number;
}

/** What the left hand holds this frame. */
export type LeftHold = 'gun' | 'mag' | 'none' | 'shell' | 'rocket';

export interface GunPoseOut {
  /** The gun (its grip point, the frame's origin) and rotation, camera space. */
  pos: Vector3;
  q: Quaternion;
  /** The right hand: its rotation and grip point. */
  rightQ: Quaternion;
  rightGrip: Vector3;
  leftQ: Quaternion;
  leftGrip: Vector3;
  left: LeftHold;
  /** The magazine (or the shell / the rocket in the left hand): seated on the gun, or where the hand has it. */
  magOnGun: boolean;
  /** The magazine shows at all (not between dropping the old one and taking the new). */
  magShown: boolean;
  magPos: Vector3;
  magQ: Quaternion;
  /** The moving parts, m back along the gun: the slide / bolt, the pump. */
  slide: number;
  pump: number;
  /** The rocket shows in the tube (loaded). */
  rocket: boolean;
  /** The shoulders off their rest (the stock pulled in, the arms pushed out in the sights), camera space. */
  shoulderR: Vector3;
  shoulderL: Vector3;
  /** The hands' extra turn about the grip this frame (the sights), rad. */
  rollR: number;
  rollL: number;
}

/** A hand's rigid frame on the gun: the grip point and the hand's rotation, gun frame. */
export interface HandOnGun {
  at: Vector3;
  q: Quaternion;
}

const v = (a: V3) => new Vector3(a[0], a[1], a[2]);
const AXIS_Y = new Vector3(0, 1, 0);

function handFrame(f: HandFrame, roll: number): HandOnGun {
  const q = basisQuat(v(f.axis), v(f.reach));
  if (roll) q.multiply(new Quaternion().setFromAxisAngle(AXIS_Y, roll));
  return { at: v(f.at), q };
}

/** A key pose: where the grip is, the gun's rotation (as an axis-angle turn of the hip pose's). */
export interface PoseKey {
  at: V3;
  turn: V3;
  /** The gun's rotation outright (camera space, a quaternion), instead of `turn` (set in the grip editor). */
  q?: readonly [number, number, number, number];
}

/**
 * The poses of a gun (camera space) and the rolls of the hands about the grip axes: the class's defaults
 * (CLASS) with what the tuner found for the gun (gunTuned.ts, `gunTune.ts … --write`).
 */
export interface GunPoses {
  hip: V3;
  /** The hip aim converges with the crosshair this far ahead, m. */
  converge: number;
  /** Rear sight this far from the eye in the sights, m; the eye this far over the sight line (the cheek on the stock). */
  relief: number;
  adsDrop: number;
  sprint: PoseKey;
  wall: PoseKey;
  reload: PoseKey;
  lowered: PoseKey;
  inspectA: PoseKey;
  inspectB: PoseKey;
  bash: PoseKey;
  crouch: number;
  /** The pouch the left hand reaches for (camera space): new magazines, shells, the rocket. */
  pouch: V3;
  /** Hand rolls about their grip axes: right on the grip, left on its socket, on the magazine, the bolt, the port. */
  mainRoll: number;
  offRoll: number;
  magRoll: number;
  boltRoll: number;
  loadRoll: number;
  /** The left hand moved off its socket point a little (where it holds the handguard) and tilted about its reach. */
  offShift: V3;
  offTilt: number;
  /** The shoulders off their rest at the hip and in the sights (right, left). */
  shoulderR: V3;
  shoulderL: V3;
  adsShoulderR: V3;
  adsShoulderL: V3;
  /** The hands turn a little more about the grip in the sights (the elbows up). */
  adsMainRoll: number;
  adsOffRoll: number;
}

const CLASS: Record<GunClass, GunPoses> = {
  pistol: {
    hip: [0.1, -0.14, -0.4],
    converge: 8,
    relief: 0.4,
    adsDrop: 0,
    sprint: { at: [0.05, -0.22, -0.28], turn: [-0.6, 0.15, 0] },
    wall: { at: [0.08, -0.12, -0.22], turn: [0.9, 0, 0] },
    reload: { at: [0.05, -0.17, -0.34], turn: [0.3, 0.2, -0.3] },
    lowered: { at: [0.12, -0.45, -0.28], turn: [-1.0, 0, 0] },
    inspectA: { at: [0.05, -0.12, -0.36], turn: [0.15, -0.5, 0.35] },
    inspectB: { at: [0.06, -0.1, -0.36], turn: [0.35, 0.3, -0.35] },
    bash: { at: [0.06, -0.12, -0.5], turn: [0.2, -0.35, 0.2] },
    crouch: -0.015,
    pouch: [-0.12, -0.5, -0.15],
    mainRoll: 0,
    offRoll: 0,
    magRoll: 0,
    boltRoll: 0,
    loadRoll: 0,
    offShift: [0, 0, 0],
    offTilt: 0,
    shoulderR: [0, 0, 0],
    shoulderL: [0, 0, 0],
    adsShoulderR: [-0.04, 0.05, -0.06],
    adsShoulderL: [0.04, 0.05, -0.06],
    adsMainRoll: 0,
    adsOffRoll: 0,
  },
  long: {
    hip: [0.12, -0.14, -0.28],
    converge: 12,
    relief: 0.2,
    adsDrop: 0.02,
    sprint: { at: [0.08, -0.26, -0.22], turn: [-0.4, 0.5, -0.25] },
    wall: { at: [0.11, -0.16, -0.1], turn: [0.85, 0.1, 0] },
    reload: { at: [0.08, -0.2, -0.22], turn: [0.2, 0.15, -0.35] },
    lowered: { at: [0.15, -0.45, -0.18], turn: [-0.9, 0.3, 0] },
    inspectA: { at: [0.08, -0.15, -0.18], turn: [0.15, -0.4, 0.35] },
    inspectB: { at: [0.09, -0.13, -0.18], turn: [0.3, 0.25, -0.35] },
    bash: { at: [0.08, -0.15, -0.32], turn: [0.15, -0.35, 0.2] },
    crouch: -0.02,
    pouch: [-0.12, -0.5, -0.12],
    mainRoll: 0,
    offRoll: 0,
    magRoll: 0,
    boltRoll: 0,
    loadRoll: 0,
    offShift: [0, 0, 0],
    offTilt: 0,
    shoulderR: [-0.02, 0.02, -0.02],
    shoulderL: [0, 0, 0],
    adsShoulderR: [-0.07, 0.06, -0.03],
    adsShoulderL: [0.03, 0.04, -0.05],
    adsMainRoll: 0,
    adsOffRoll: 0,
  },
  launcher: {
    hip: [0.06, -0.12, -0.12],
    converge: 20,
    relief: 0.16,
    adsDrop: 0,
    sprint: { at: [0.06, -0.22, -0.1], turn: [-0.35, 0.25, 0] },
    wall: { at: [0.06, -0.12, 0.02], turn: [0.5, 0, 0] },
    reload: { at: [0.06, -0.2, -0.08], turn: [-0.2, 0.2, 0] },
    lowered: { at: [0.12, -0.45, -0.08], turn: [-0.8, 0.2, 0] },
    inspectA: { at: [0.05, -0.12, -0.1], turn: [0.1, -0.3, 0.25] },
    inspectB: { at: [0.06, -0.1, -0.1], turn: [0.2, 0.2, -0.25] },
    bash: { at: [0.06, -0.12, -0.22], turn: [0.1, -0.2, 0.1] },
    crouch: -0.02,
    pouch: [-0.12, -0.5, -0.08],
    mainRoll: 0,
    offRoll: 0,
    magRoll: 0,
    boltRoll: 0,
    loadRoll: 0,
    offShift: [0, 0, 0],
    offTilt: 0,
    shoulderR: [-0.02, 0.02, 0],
    shoulderL: [0, 0, 0],
    adsShoulderR: [-0.05, 0.07, -0.02],
    adsShoulderL: [0.02, 0.04, -0.04],
    adsMainRoll: 0,
    adsOffRoll: 0,
  },
};

/** The poses of a gun now (the tuner edits these in place, then calls resetGunRig). */
export const GUN_POSES: Record<GunId, GunPoses> = Object.fromEntries(
  (Object.keys(GUNS) as GunId[]).map((id) => [id, { ...structuredClone(CLASS[GUNS[id].cls]), ...structuredClone(GUN_TUNED[id] ?? {}) }]),
) as Record<GunId, GunPoses>;

/** Compiled per gun: the hand frames, the sights pose, the magazine hold. */
export interface GunRigData {
  id: GunId;
  s: GunSockets;
  cls: GunPoses;
  main: HandOnGun;
  off: HandOnGun;
  /** The left hand on the magazine: in the magazine's frame (its top at the origin, the gun's axes). */
  magHold: HandOnGun;
  /** On the bolt / charging handle / slide / the loading port / the muzzle (RPG), gun frame. */
  bolt: HandOnGun;
  load: HandOnGun;
  /** Hip and sights rotations, positions (camera space). */
  hipQ: Quaternion;
  hipAt: Vector3;
  adsQ: Quaternion;
  adsAt: Vector3;
  /** How far the magazine slides out before it leaves the well, m. */
  magPull: number;
}

const rigs = new Map<GunId, GunRigData>();
onGripsChanged(() => rigs.clear());

/** Forget the compiled rig of a gun (its poses changed). */
export function resetGunRig(id: GunId): void {
  rigs.delete(id);
}

const rolled = (q: Quaternion, roll: number) => (roll ? q.multiply(new Quaternion().setFromAxisAngle(AXIS_Y, roll)) : q);

export function gunRigData(id: GunId): GunRigData {
  let r = rigs.get(id);
  if (r) return r;
  const s = gunSockets(id);
  const g = GUNS[id];
  // The class / tuned poses with what the grip editor saved (data/grips.json) on top.
  const G = GRIPS[id] ?? {};
  const cls: GunPoses = { ...GUN_POSES[id] };
  if (G.ads?.relief !== undefined) cls.relief = G.ads.relief;
  if (G.ads?.drop !== undefined) cls.adsDrop = G.ads.drop;
  if (G.sprint) cls.sprint = { at: G.sprint.at, turn: [0, 0, 0], q: G.sprint.q };
  if (G.reload) cls.reload = { at: G.reload.at, turn: [0, 0, 0], q: G.reload.q };
  const main = G.main ? { at: vec(G.main.at), q: quat(G.main.q) } : handFrame(s.main, cls.mainRoll);
  let off: HandOnGun;
  if (G.off) off = { at: vec(G.off.at), q: quat(G.off.q) };
  else {
    off = handFrame(s.off, cls.offRoll);
    off.at.add(v(cls.offShift));
    if (cls.offTilt) off.q.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), cls.offTilt));
  }
  // Hip: the barrel to where the crosshair is `converge` ahead.
  const hipAt = G.stance ? vec(G.stance.at) : v(cls.hip);
  const aimDir = new Vector3(0, 0, -cls.converge).sub(hipAt).normalize();
  const hipQ = G.stance ? quat(G.stance.q) : new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), aimDir);
  // Sights: the line from the eye (`adsDrop` over the rear sight) through the front sight onto the view
  // axis, the rear sight `relief` ahead: the front sight in the middle of the screen.
  const eye = v(s.sightR).add(new Vector3(0, cls.adsDrop, 0));
  const sightF = v(s.sightF);
  const line = sightF.clone().sub(eye).normalize();
  const adsQ = new Quaternion().setFromUnitVectors(line, new Vector3(0, 0, -1));
  const adsAt = new Vector3(0, 0, -cls.relief).sub(eye.applyQuaternion(adsQ));
  // The magazine in the left fist: the fist round its lower half, thumb up along it, knuckles forward.
  const out = v(s.magOut);
  const magHold: HandOnGun = {
    at: out.clone().multiplyScalar(g.cls === 'pistol' ? 0.085 : 0.11),
    q: rolled(basisQuat(out.clone().negate(), new Vector3(0.45, 0, -1)), cls.magRoll),
  };
  // The bolt: a pistol's slide gripped from above at its back, thumb back; a rifle's handle from the side.
  const bolt: HandOnGun =
    g.cls === 'pistol'
      ? { at: v(s.sightR).add(new Vector3(0, -0.012, 0.01)), q: rolled(basisQuat(new Vector3(0, 0, 1), new Vector3(1, 0, 0)), cls.boltRoll) }
      : { at: v(s.bolt), q: rolled(basisQuat(new Vector3(0, 0, -1), new Vector3(0.3, 0.85, 0)), cls.boltRoll) };
  const load: HandOnGun = { at: v(s.load), q: rolled(basisQuat(new Vector3(0, 0, -1), new Vector3(0.2, 1, 0)), cls.loadRoll) };
  r = { id, s, cls, main, off, magHold, bolt, load, hipQ, hipAt, adsQ, adsAt, magPull: g.cls === 'pistol' ? 0.1 : 0.13 };
  rigs.set(id, r);
  return r;
}

// Scratch.
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _p2 = new Vector3();
const _a = new Vector3();
const _pose = { at: new Vector3(), q: new Quaternion() };

/** The gun's rotation of a key: the hip rotation turned by the key's axis-angle (camera axes). */
export function keyQ(d: GunRigData, k: PoseKey, out: Quaternion): Quaternion {
  if (k.q) return out.set(k.q[0], k.q[1], k.q[2], k.q[3]).normalize();
  _a.set(...k.turn);
  const ang = _a.length();
  out.copy(d.hipQ);
  if (ang > 1e-9) out.premultiply(_q2.setFromAxisAngle(_a.divideScalar(ang), ang));
  return out;
}

function blendKey(d: GunRigData, k: PoseKey, w: number, at: Vector3, q: Quaternion): void {
  if (w <= 0) return;
  at.lerp(_p.set(...k.at), w);
  q.slerp(keyQ(d, k, _q), w);
}

const seg = (k: number, a: number, b: number) => easeInOutSine(clamp((k - a) / (b - a), 0, 1));

/** Camera-space transform of a gun-frame hand frame on a gun posed at (pos, q). */
function onGun(pos: Vector3, q: Quaternion, h: HandOnGun, outGrip: Vector3, outQ: Quaternion, dz = 0): void {
  outGrip.copy(h.at);
  outGrip.z += dz;
  outGrip.applyQuaternion(q).add(pos);
  outQ.copy(q).multiply(h.q);
}

const _sh = new Vector3();

/** Pose of a gun this frame (see the module comment). */
export function poseGun(id: GunId, inp: GunPoseInput, out: GunPoseOut): void {
  const d = gunRigData(id);
  const g = GUNS[id];
  const at = out.pos.copy(d.hipAt);
  const q = out.q.copy(d.hipQ);
  // Sights.
  const ads = easeInOutSine(clamp(inp.ads, 0, 1));
  const P = d.cls;
  out.shoulderR.set(...P.shoulderR).lerp(_sh.set(...P.adsShoulderR), ads);
  out.shoulderL.set(...P.shoulderL).lerp(_sh.set(...P.adsShoulderL), ads);
  at.lerp(d.adsAt, ads);
  q.slerp(d.adsQ, ads);
  at.y += d.cls.crouch * inp.crouch * (1 - ads);
  // Sprint, with the arms' pump.
  blendKey(d, d.cls.sprint, inp.sprint, at, q);
  at.y += inp.pump * 0.02 * inp.sprint;
  // The action's own pose (reload, inspect, butt strike, the fire-mode thumb).
  const k = inp.duration > 0 ? clamp(inp.t / inp.duration, 0, 1) : 1;
  const a = inp.action;
  const reloading = a === 'reload' || a === 'reloadEmpty' || a === 'unjam' || a === 'loadStart' || a === 'loadOne' || a === 'loadEnd';
  let rw = 0;
  if (a === 'reload' || a === 'reloadEmpty' || a === 'unjam') rw = seg(k, 0, 0.14) * (1 - seg(k, 0.86, 1));
  else if (a === 'loadStart') rw = seg(k, 0, 1);
  else if (a === 'loadOne') rw = 1;
  else if (a === 'loadEnd') rw = 1 - seg(k, 0, 1);
  blendKey(d, d.cls.reload, rw, at, q);
  if (a === 'inspect') {
    // Turned to look at its left side, then up at its right, back.
    const w1 = seg(k, 0, 0.25) * (1 - seg(k, 0.45, 0.6));
    const w2 = seg(k, 0.5, 0.7) * (1 - seg(k, 0.85, 1));
    blendKey(d, d.cls.inspectA, w1, at, q);
    blendKey(d, d.cls.inspectB, w2, at, q);
  } else if (a === 'bash') {
    // The butt (a pistol's frame) driven forward and to the left, then back.
    const w = seg(k, 0, 0.3) * (1 - seg(k, 0.45, 1));
    blendKey(d, d.cls.bash, w, at, q);
  } else if (a === 'mode') {
    const w = Math.sin(Math.PI * k);
    q.multiply(_q.setFromAxisAngle(_a.set(0, 0, 1), -0.08 * w));
  }
  // Against a wall: muzzle up, the gun pulled back.
  blendKey(d, d.cls.wall, easeInOutSine(clamp(inp.wall, 0, 1)), at, q);
  // Recoil: back along the view, the muzzle up and aside (about the grip), a roll.
  at.z += inp.kickBack;
  at.y += inp.kickUp * 0.06;
  _q.setFromAxisAngle(_a.set(1, 0, 0), inp.kickUp);
  q.premultiply(_q);
  q.premultiply(_q.setFromAxisAngle(_a.set(0, 1, 0), inp.kickSide));
  q.multiply(_q.setFromAxisAngle(_a.set(0, 0, 1), inp.kickRoll));
  // Put away / drawn: down out of the frame.
  blendKey(d, d.cls.lowered, easeInOutSine(clamp(inp.lower, 0, 1)), at, q);

  // Right hand: always on the grip.
  onGun(at, q, d.main, out.rightGrip, out.rightQ);
  out.rollR = P.adsMainRoll * ads;
  if (out.rollR) out.rightQ.multiply(_q.setFromAxisAngle(_a.set(0, 1, 0), out.rollR));

  // Moving parts.
  out.slide = 0;
  out.pump = 0;
  const sinceShot = inp.sinceShot;
  const blow = sinceShot >= 0 && sinceShot < 0.09 ? Math.sin((Math.PI * sinceShot) / 0.09) : 0;
  if (g.cls === 'pistol') out.slide = inp.open ? 0.028 : 0.028 * blow;
  else if (g.action === 'auto') out.slide = 0.045 * blow;
  out.rocket = inp.chamber;
  out.magOnGun = true;
  out.magShown = true;
  out.left = 'gun';
  // Left hand on its socket (the pump moves under it).
  if (a === 'cycle' && g.action === 'pump') out.pump = 0.085 * Math.sin(Math.PI * seg(k, 0, 1));
  onGun(at, q, d.off, out.leftGrip, out.leftQ, out.pump);
  out.rollL = P.adsOffRoll * ads;
  if (out.rollL) out.leftQ.multiply(_q.setFromAxisAngle(_a.set(0, 1, 0), out.rollL));
  magSeated(d, at, q, out);
  if (!reloading && !(a === 'cycle' && g.action === 'bolt')) return;
  leftPath(d, g.feed, a, k, at, q, out);
}

function magSeated(d: GunRigData, at: Vector3, q: Quaternion, out: GunPoseOut): void {
  out.magPos.set(...d.s.mag).applyQuaternion(q).add(at);
  out.magQ.copy(q);
}

/** Where the left hand is between two of its frames: positions eased, rotations slerped. */
function between(aGrip: Vector3, aQ: Quaternion, bGrip: Vector3, bQ: Quaternion, w: number, out: GunPoseOut): void {
  out.leftGrip.copy(aGrip).lerp(bGrip, w);
  out.leftQ.copy(aQ).slerp(bQ, w);
}

const _offG = new Vector3();
const _offQ = new Quaternion();
const _hG = new Vector3();
const _hQ = new Quaternion();
const _mA = { pos: new Vector3(), q: new Quaternion() };
const _mB = { pos: new Vector3(), q: new Quaternion() };
const _mP = { pos: new Vector3(), q: new Quaternion() };
const _mt = { pos: new Vector3(), q: new Quaternion() };

/** The hand holding the magazine at (pos, q): hand = magazine × hold. */
function holdMag(d: GunRigData, m: { pos: Vector3; q: Quaternion }, outGrip: Vector3, outQ: Quaternion): void {
  outGrip.copy(d.magHold.at).applyQuaternion(m.q).add(m.pos);
  outQ.copy(m.q).multiply(d.magHold.q);
}

function lerpM(a: { pos: Vector3; q: Quaternion }, b: { pos: Vector3; q: Quaternion }, w: number, out: { pos: Vector3; q: Quaternion }) {
  out.pos.copy(a.pos).lerp(b.pos, w);
  out.q.copy(a.q).slerp(b.q, w);
  return out;
}

/**
 * The left hand's path through a reload (k = share of the action's time), the magazine with it.
 * Marks (gunState RELOAD_MARKS): out 0.28 — the magazine leaves the well; in 0.62 — the new one seated;
 * rack 0.85 — the action worked (from empty).
 */
function leftPath(d: GunRigData, feed: string, a: GunAction, k: number, at: Vector3, q: Quaternion, out: GunPoseOut): void {
  _offG.copy(out.leftGrip);
  _offQ.copy(out.leftQ);
  // Magazine frames: A seated, B pulled out down the well, P at the pouch (turned as at B).
  _mA.pos.copy(out.magPos);
  _mA.q.copy(out.magQ);
  _mB.pos.set(...d.s.magOut).multiplyScalar(d.magPull).add(_p2.set(...d.s.mag)).applyQuaternion(q).add(at);
  _mB.q.copy(q);
  _mP.pos.set(...d.cls.pouch);
  _mP.q.copy(q).premultiply(_q.setFromAxisAngle(_a.set(1, 0, 0), -0.5));
  const M = RELOAD_MARKS;
  if (feed === 'mag' && (a === 'reload' || a === 'reloadEmpty')) {
    const empty = a === 'reloadEmpty';
    let m: { pos: Vector3; q: Quaternion } | null = null;
    if (k < 0.14) {
      holdMag(d, _mA, _hG, _hQ);
      between(_offG, _offQ, _hG, _hQ, seg(k, 0, 0.14), out);
      out.left = 'none';
    } else if (k < M.out) m = lerpM(_mA, _mB, seg(k, 0.14, M.out), _mt);
    else if (k < 0.46) {
      // Tactical: the old one to the pouch; from empty: dropped, the hand goes for a new one.
      m = lerpM(_mB, _mP, seg(k, M.out, 0.46), _mt);
      if (empty) {
        out.magShown = false;
        holdMag(d, m, out.leftGrip, out.leftQ);
        out.left = 'none';
        m = null;
      }
    } else if (k < 0.56) m = lerpM(_mP, _mB, seg(k, 0.46, 0.56), _mt);
    else if (k < M.in) m = lerpM(_mB, _mA, seg(k, 0.56, M.in), _mt);
    else {
      // Let go of the seated magazine: back to the handguard (round the right hand), or to the bolt first.
      holdMag(d, _mA, _hG, _hQ);
      if (empty) boltPath(d, k, at, q, _hG, _hQ, out, 0.66, 0.76, M.rack, 0.97);
      else between(_hG, _hQ, _offG, _offQ, seg(k, 0.66, 0.95), out);
      out.left = 'none';
    }
    if (m) {
      out.magOnGun = false;
      out.magPos.copy(m.pos);
      out.magQ.copy(m.q);
      holdMag(d, m, out.leftGrip, out.leftQ);
      out.left = 'mag';
    }
    return;
  }
  if (a === 'unjam') {
    // Slap the magazine's floor, rack the action, back.
    holdMag(d, _mA, _hG, _hQ);
    if (k < 0.3) {
      const w = seg(k, 0, 0.22);
      between(_offG, _offQ, _hG, _hQ, w, out);
      out.leftGrip.addScaledVector(_p.set(...d.s.magOut).applyQuaternion(q), 0.03 * (1 - w));
    } else boltPath(d, k, at, q, _hG, _hQ, out, 0.3, 0.5, 0.7, 0.97);
    out.left = 'none';
    return;
  }
  if (a === 'cycle') {
    // The bolt rifle: the left hand from the stock to the bolt, up-back-forward-down, back.
    boltPath(d, k, at, q, _offG, _offQ, out, 0, 0.25, 0.55, 1);
    out.left = 'none';
    return;
  }
  // One at a time (the pump gun, the bolt rifle) and the rocket.
  const pouchG = _p.set(...d.cls.pouch);
  onGun(at, q, d.load, _hG, _hQ);
  // At the pouch the hand is turned as at the loading port, a little down.
  const pouchQ = _q2.copy(_hQ).premultiply(_q.setFromAxisAngle(_a.set(1, 0, 0), -0.4));
  if (feed === 'rocket') {
    if (k < 0.3) {
      between(_offG, _offQ, pouchG, pouchQ, seg(k, 0, 0.3), out);
      out.left = 'none';
    } else if (k < M.in) {
      between(pouchG, pouchQ, _hG, _hQ, seg(k, 0.3, M.in), out);
      // Pushed into the muzzle along the tube.
      out.leftGrip.addScaledVector(_p2.set(0, 0, -1).applyQuaternion(q), 0.1 * (1 - seg(k, 0.5, M.in)));
      out.left = 'rocket';
    } else {
      between(_hG, _hQ, _offG, _offQ, seg(k, 0.7, 1), out);
      out.left = 'none';
    }
    return;
  }
  if (a === 'loadStart') {
    between(_offG, _offQ, pouchG, pouchQ, seg(k, 0, 1), out);
    out.left = 'none';
  } else if (a === 'loadOne') {
    // Up to the port with a round (pressed in at 0.5), back down for the next.
    if (k < 0.5) between(pouchG, pouchQ, _hG, _hQ, seg(k, 0, 0.5), out);
    else between(_hG, _hQ, pouchG, pouchQ, seg(k, 0.55, 1), out);
    out.left = k < 0.5 ? 'shell' : 'none';
  } else {
    between(pouchG, pouchQ, _offG, _offQ, seg(k, 0, 1), out);
    out.left = 'none';
  }
}

/**
 * From `from` to the bolt (a → b), worked at `rack` (pulled back and let go), back to the left socket by `end`.
 * The slide / bolt goes back with the hand.
 */
function boltPath(d: GunRigData, k: number, at: Vector3, q: Quaternion, fromG: Vector3, fromQ: Quaternion, out: GunPoseOut, a: number, b: number, rack: number, end: number): void {
  onGun(at, q, d.bolt, _pose.at, _pose.q);
  const back = 0.05 * Math.sin(Math.PI * clamp((k - (rack - 0.12)) / 0.16, 0, 1));
  const backV = _p2.set(0, 0, 1).applyQuaternion(q).multiplyScalar(back);
  if (k < b) between(fromG, fromQ, _pose.at, _pose.q, seg(k, a, b), out);
  else if (k < rack + 0.05) {
    out.leftGrip.copy(_pose.at).add(backV);
    out.leftQ.copy(_pose.q);
    out.slide = back;
  } else {
    onGun(at, q, d.off, _offG, _offQ, 0);
    between(_pose.at, _pose.q, _offG, _offQ, seg(k, rack + 0.05, end), out);
  }
  if (k >= b && k < rack + 0.05) out.slide = back;
}

export function newGunPoseOut(): GunPoseOut {
  return {
    pos: new Vector3(),
    q: new Quaternion(),
    rightQ: new Quaternion(),
    rightGrip: new Vector3(),
    leftQ: new Quaternion(),
    leftGrip: new Vector3(),
    left: 'gun',
    magOnGun: true,
    magShown: true,
    magPos: new Vector3(),
    magQ: new Quaternion(),
    slide: 0,
    pump: 0,
    rocket: true,
    shoulderR: new Vector3(),
    shoulderL: new Vector3(),
    rollR: 0,
    rollL: 0,
  };
}
