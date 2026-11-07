import { type Group, Quaternion, Vector3 } from 'three';
import { FOREARM_ROLL, hitTime, swingTime, WRIST_DEV, WRIST_FLEX, WRIST_TWIST } from '../player/armRig';
import { GRIP_X, GRIP_Z } from '../player/hand';
import { FISTS, HELD, type HeldConfig } from '../player/held';
import type { RightItem, Viewmodel, ViewmodelFrame } from '../player/Viewmodel';

/**
 * Frame-by-frame check of the first-person weapon animations, on the real Viewmodel scene graph
 * (shared by `npm run test:anim` and `?animdebug=1`). Per hand and frame: wrist flexion / deviation /
 * twist, forearm roll, how much the wrist turned since the last frame, hand–sleeve and hand–socket gaps,
 * whether the weapon head and the hands are in the frame.
 */

const DEG = 180 / Math.PI;
/** Limits of the check. */
export const LIMITS = {
  flex: WRIST_FLEX * DEG,
  dev: WRIST_DEV * DEG,
  twist: WRIST_TWIST * DEG,
  roll: FOREARM_ROLL * DEG,
  /** Largest change of the wrist / forearm between two frames (60 Hz), degrees. */
  jump: 15,
  /** Gaps, m. */
  gap: 0.01,
  /** Hand turned against its socket, degrees (should be 0: rigid). */
  socketTurn: 1,
  /** Path swings: the blade at contact within this share of the screen width from the crosshair; the head never in
   * the bottom 20% of the screen (NDC y −0.6); never more than this share of the width in one frame; strike frames. */
  contactOff: 0.1,
  lowest: -0.6,
  headStep: 0.08,
  strikeFrames: 8,
  /** Recover: the handle at least this far (sine) from upright on screen (~25°). */
  uprightSin: 0.42,
};
/** Aspect ratios the frame check runs at: 16:9 phones / PCs, 4:3 tablets. */
const ASPECTS = [16 / 9, 4 / 3];

export interface HandRow {
  flex: number;
  dev: number;
  twist: number;
  roll: number;
  /** Total bend of the wrist: angle between the hand's and the forearm's axes. */
  bend: number;
  /** Turn of the wrist joint since the previous frame. */
  dWrist: number;
  dRoll: number;
  dSwivel: number;
  sleeveGap: number;
  socketGap: number;
  socketTurn: number;
  inFrame: boolean;
}

export interface FrameRow {
  frame: number;
  phase: string;
  R: HandRow;
  L: HandRow | null;
  headInFrame: boolean;
  checkFrame: boolean;
  /** The item was swapped this frame (out of view at the bottom): no jump check. */
  swap: boolean;
  /** Weapon head on a 16:9 screen, NDC. */
  headX: number;
  headY: number;
  /** The butt of the handle on screen, NDC. */
  butX: number;
  butY: number;
  /** The frame the blow lands (hit check). */
  contact: boolean;
}

export interface Failure {
  item: string;
  anim: string;
  frame: number;
  what: string;
}

interface VmInternals {
  armR: Group;
  armL: Group;
  handR: Group;
  handL: Group;
  held: Map<RightItem, Group>;
  torch: Group;
  attackT: number;
  item: RightItem;
}

const _a = new Vector3();
const _b = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _qc = new Quaternion();

const cfgOf = (item: RightItem): HeldConfig => (item === 'fists' ? FISTS : HELD[item]);

function quatAngle(a: Quaternion, b: Quaternion): number {
  return 2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * DEG;
}

function inView(vm: Viewmodel, p: Vector3): boolean {
  const cam = vm.camera;
  const prev = cam.aspect;
  let ok = true;
  for (const aspect of ASPECTS) {
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const v = _b.copy(p).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) ok = false;
  }
  cam.aspect = prev;
  cam.updateProjectionMatrix();
  return ok;
}

class Sampler {
  private prevWrist = [new Quaternion(), new Quaternion()];
  private prevRoll = [0, 0];
  private prevSwivel = [0, 0];
  private first = true;
  private lastItem: RightItem | null = null;
  constructor(private readonly vm: Viewmodel) {}

  restart(): void {
    this.first = true;
  }

  hand(k: 0 | 1, item: RightItem, checkFrame: boolean): HandRow {
    const vm = this.vm;
    const v = vm as unknown as VmInternals;
    const pose = k === 0 ? vm.rig.right.pose : vm.rig.left.pose;
    const hand = k === 0 ? v.handR : v.handL;
    const side = k === 0 ? 1 : -1;
    const cfg = cfgOf(item);
    // The socket this hand holds and the object it is on.
    let socketObj: Group;
    let socket = cfg.main;
    if (k === 0) socketObj = item === 'fists' ? hand : (v.held.get(item)!.children[0] as Group);
    else if (cfg.twoHanded && cfg.off) {
      socketObj = v.held.get(item)!.children[0] as Group;
      socket = cfg.off;
    } else {
      socketObj = v.torch.children[0] as Group;
      socket = HELD.torch.main;
    }
    const gripW = _a.set(GRIP_X * side, 0, GRIP_Z).applyMatrix4(hand.matrixWorld);
    const along = k === 0 ? vm.rig.mainAlong : socket.along;
    const socketW = new Vector3().set(0, along, 0).applyMatrix4(socketObj.matrixWorld);
    if (item === 'fists' && k === 0) socketW.copy(gripW);
    const socketGap = gripW.distanceTo(socketW);
    const inFrame = !checkFrame || inView(vm, gripW);
    // Hand against its socket frame: item rotation × roll should equal the hand rotation.
    hand.getWorldQuaternion(_qa);
    socketObj.getWorldQuaternion(_qb).multiply(_qc.setFromAxisAngle(_b.set(0, 1, 0), socket.roll));
    const socketTurn = item === 'fists' && k === 0 ? 0 : quatAngle(_qa, _qb);
    // The model's hand bone against the end of its forearm bone (the sleeve).
    const sleeveGap = vm.arms.cuff[k].distanceTo(vm.arms.wrist[k]);
    const dWrist = this.first ? 0 : quatAngle(hand.quaternion, this.prevWrist[k]);
    const dRoll = this.first ? 0 : Math.abs(pose.roll - this.prevRoll[k]) * DEG;
    const dSwivel = this.first ? 0 : Math.abs(pose.swivel - this.prevSwivel[k]) * DEG;
    this.prevWrist[k].copy(hand.quaternion);
    this.prevRoll[k] = pose.roll;
    this.prevSwivel[k] = pose.swivel;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(hand.quaternion);
    return {
      flex: pose.flex * DEG,
      dev: pose.dev * DEG,
      twist: pose.twist * DEG,
      roll: pose.roll * DEG,
      bend: Math.acos(Math.min(1, Math.max(-1, -fwd.z))) * DEG,
      dWrist,
      dRoll,
      dSwivel,
      sleeveGap,
      socketGap,
      socketTurn,
      inFrame,
    };
  }

  row(frame: number, phase: string, item: RightItem, checkFrame: boolean, leftActive: boolean): FrameRow {
    const vm = this.vm;
    const v = vm as unknown as VmInternals;
    vm.scene.updateMatrixWorld(true);
    const R = this.hand(0, item, checkFrame);
    const L = leftActive ? this.hand(1, item, checkFrame) : null;
    this.first = false;
    let headInFrame = true;
    if (checkFrame) {
      const cfg = cfgOf(item);
      const obj = item === 'fists' ? v.handR : (v.held.get(item)!.children[0] as Group);
      const head = item === 'fists' ? _a.set(GRIP_X, cfg.head[1], GRIP_Z) : _a.set(...cfg.head);
      headInFrame = inView(vm, head.applyMatrix4(obj.matrixWorld));
    }
    // The head on a 16:9 screen (NDC), for the path-swing checks.
    let hx = 0;
    let hy = 0;
    let bx = 0;
    let by = 0;
    {
      const obj = item === 'fists' ? v.handR : (v.held.get(item)!.children[0] as Group);
      const cam = vm.camera;
      const prev = cam.aspect;
      cam.aspect = 16 / 9;
      cam.updateProjectionMatrix();
      const hp = item === 'fists' ? _a.set(GRIP_X, cfgOf(item).head[1], GRIP_Z) : _a.set(...cfgOf(item).head);
      const p = hp.applyMatrix4(obj.matrixWorld).project(cam);
      hx = p.x;
      hy = p.y;
      const b = (item === 'fists' ? _a.set(GRIP_X, 0, GRIP_Z) : _a.set(0, 0, 0)).applyMatrix4(obj.matrixWorld).project(cam);
      bx = b.x;
      by = b.y;
      cam.aspect = prev;
      cam.updateProjectionMatrix();
    }
    const swap = this.lastItem !== null && this.lastItem !== item;
    this.lastItem = item;
    return { frame, phase, R, L, headInFrame, checkFrame, swap, headX: hx, headY: hy, butX: bx, butY: by, contact: false };
  }
}

const frameOf = (o: Partial<ViewmodelFrame> = {}): ViewmodelFrame => ({ lookX: 0, lookY: 0, stepPhase: 0, speed: 0, sprinting: false, flashlightOn: true, ...o });

/** Put an item in hand and let the switch settle. */
function settle(vm: Viewmodel, item: RightItem, f: ViewmodelFrame): void {
  const v = vm as unknown as VmInternals;
  vm.equip(item);
  for (let i = 0; i < 90 && (v.item !== item || i < 40); i++) {
    vm.fixedUpdate(1 / 60, false);
    vm.update(1 / 60, f);
  }
}

/** The swing of `item` as 60 frames at 60 Hz: a few frames at rest, the whole swing, rest again. */
export function swingFrames(vm: Viewmodel, item: RightItem): FrameRow[] {
  const f = frameOf();
  settle(vm, item, f);
  const cfg = cfgOf(item);
  const total = swingTime(cfg);
  let contactDone = false;
  const s = new Sampler(vm);
  const rows: FrameRow[] = [];
  const lead = 3;
  for (let i = 0; i < 60; i++) {
    const t = (i - lead) / 60;
    const attacking = t >= 0 && t <= total;
    vm.scrubT = attacking ? t : -1;
    vm.fixedUpdate(1 / 60, false);
    vm.update(1 / 60, f);
    const phase = !attacking ? 'rest' : vm.rig.phase;
    const row = s.row(i, phase, item, true, true);
    row.contact = attacking && !contactDone && t >= hitTime(cfg) - 1e-9;
    if (row.contact) contactDone = true;
    rows.push(row);
  }
  vm.scrubT = null;
  return rows;
}

/** Every animation of an item: rest, sprint, swing, flashlight down/up (one-handed), switching away and back. */
export function allAnimations(vm: Viewmodel, item: RightItem): Record<string, FrameRow[]> {
  const out: Record<string, FrameRow[]> = {};
  const cfg = cfgOf(item);
  out.swing = swingFrames(vm, item);
  const s = new Sampler(vm);
  // Sprint: the arms pump with the steps (two steps per 2π of phase, ~2.6 steps/s).
  out.sprint = [];
  let phase = 0;
  for (let i = 0; i < 90; i++) {
    phase += (Math.PI * 2.6) / 60;
    const f = frameOf({ sprinting: i < 70, stepPhase: phase, speed: 5 });
    vm.fixedUpdate(1 / 60, false);
    vm.update(1 / 60, f);
    out.sprint.push(s.row(i, i < 70 ? 'sprint' : 'stop', item, true, true));
  }
  if (!cfg.twoHanded) {
    s.restart();
    out.flashlight = [];
    for (let i = 0; i < 60; i++) {
      const f = frameOf({ flashlightOn: i >= 30 });
      vm.fixedUpdate(1 / 60, false);
      vm.update(1 / 60, f);
      out.flashlight.push(s.row(i, i < 30 ? 'lowering' : 'raising', item, false, true));
    }
  }
  s.restart();
  out.switch = [];
  const other: RightItem = item === 'fists' ? 'knife' : 'fists';
  const f = frameOf();
  vm.equip(other);
  for (let i = 0; i < 120; i++) {
    if (i === 60) vm.equip(item);
    vm.fixedUpdate(1 / 60, false);
    vm.update(1 / 60, f);
    const cur = (vm as unknown as VmInternals).item;
    out.switch.push(s.row(i, i < 60 ? 'away' : 'back', cur, false, true));
  }
  return out;
}

/** Failures of one animation against LIMITS. */
export function failures(item: string, anim: string, rows: FrameRow[]): Failure[] {
  const out: Failure[] = [];
  const add = (frame: number, what: string) => out.push({ item, anim, frame, what });
  const path = !!cfgOf(item as RightItem).keys.swing;
  // The bottom-20% and upright-handle rules are the two-handed chop's.
  const twoH = cfgOf(item as RightItem).twoHanded;
  let prev: FrameRow | null = null;
  for (const r of rows) {
    for (const [name, h] of [['R', r.R], ['L', r.L]] as const) {
      if (!h) continue;
      if (Math.abs(h.flex) > LIMITS.flex + 0.05) add(r.frame, `${name} wrist flexion ${h.flex.toFixed(1)}° > ${LIMITS.flex}°`);
      if (Math.abs(h.dev) > LIMITS.dev + 0.05) add(r.frame, `${name} wrist deviation ${h.dev.toFixed(1)}° > ${LIMITS.dev}°`);
      if (Math.abs(h.twist) > LIMITS.twist + 0.05) add(r.frame, `${name} wrist twist ${h.twist.toFixed(1)}° > ${LIMITS.twist}°`);
      if (Math.abs(h.roll) > LIMITS.roll + 0.05) add(r.frame, `${name} forearm roll ${h.roll.toFixed(1)}° > ${LIMITS.roll}°`);
        if (!r.swap && h.dWrist > LIMITS.jump) add(r.frame, `${name} wrist turned ${h.dWrist.toFixed(1)}° in one frame`);
        if (!r.swap && h.dRoll > LIMITS.jump) add(r.frame, `${name} forearm rolled ${h.dRoll.toFixed(1)}° in one frame`);
        if (!r.swap && h.dSwivel > LIMITS.jump) add(r.frame, `${name} elbow swivelled ${h.dSwivel.toFixed(1)}° in one frame`);
      if (h.sleeveGap > LIMITS.gap) add(r.frame, `${name} hand–sleeve gap ${(h.sleeveGap * 100).toFixed(1)} cm`);
      if (h.socketGap > LIMITS.gap) add(r.frame, `${name} hand off the grip by ${(h.socketGap * 100).toFixed(1)} cm`);
      if (h.socketTurn > LIMITS.socketTurn) add(r.frame, `${name} hand turned ${h.socketTurn.toFixed(1)}° against its socket`);
      if (r.checkFrame && !h.inFrame) add(r.frame, `${name} hand out of the frame`);
    }
    // A path swing may lift the head over the top right edge in the windup.
    if (r.checkFrame && !r.headInFrame && !(path && r.phase === 'windup')) add(r.frame, 'weapon head out of the frame');
    if (!path || !r.checkFrame || r.swap) continue;
    // Path swings (the axe's chop): distances in screen widths, 16:9.
    const dist = (x: number, y: number) => Math.hypot(x, (y * 9) / 16) / 2;
    if (r.contact && dist(r.headX, r.headY) > LIMITS.contactOff) add(r.frame, `contact: blade ${(dist(r.headX, r.headY) * 100).toFixed(1)}% of the width off the crosshair`);
    if (twoH && r.headY < LIMITS.lowest && r.phase !== 'rest') add(r.frame, `head in the bottom 20% of the screen (y ${r.headY.toFixed(2)})`);
    // The return runs low: the handle never stands (near) upright on screen.
    if (twoH && r.phase === 'recover') {
      const dx = r.headX - r.butX;
      const dy = ((r.headY - r.butY) * 9) / 16;
      if (dy > 0 && Math.abs(dx) / Math.hypot(dx, dy) < LIMITS.uprightSin) add(r.frame, `recover: handle upright on screen (${((Math.asin(Math.abs(dx) / Math.hypot(dx, dy)) * 180) / Math.PI).toFixed(0)}° from vertical)`);
    }
    if (prev && !prev.swap) {
      const d = dist(r.headX - prev.headX, r.headY - prev.headY);
      if (d > LIMITS.headStep) add(r.frame, `head jumped ${(d * 100).toFixed(1)}% of the width in one frame`);
    }
    prev = r;
  }
  if (path && anim === 'swing') {
    const strike = rows.filter((r) => r.phase === 'strike').length;
    if (cfgOf(item as RightItem).twoHanded && strike < LIMITS.strikeFrames) add(0, `strike lasts ${strike} frames < ${LIMITS.strikeFrames}`);
    if (!rows.some((r) => r.contact)) add(0, 'no contact frame');
  }
  return out;
}

const n = (v: number, w = 4) => v.toFixed(0).padStart(w);

/** Text table of a run: one line per frame, '!' after values over a limit. */
export function table(rows: FrameRow[]): string {
  const lines = ['  # phase   | R: flex  dev  tw roll bend dWr  | L: flex  dev  tw roll bend dWr  | head'];
  const cell = (h: HandRow | null) => {
    if (!h) return ' '.repeat(33);
    const m = (v: number, lim: number) => n(v) + (Math.abs(v) > lim + 0.05 ? '!' : ' ');
    return `${m(h.flex, LIMITS.flex)}${m(h.dev, LIMITS.dev)}${m(h.twist, LIMITS.twist)}${m(h.roll, LIMITS.roll)}${n(h.bend)} ${m(h.dWrist, LIMITS.jump)}`;
  };
  for (const r of rows) lines.push(`${String(r.frame).padStart(3)} ${r.phase.padEnd(7)} |${cell(r.R)}|${cell(r.L)}| ${r.headInFrame ? 'in' : 'OUT'}`);
  return lines.join('\n');
}

export const ITEMS: RightItem[] = ['axe', 'bat', 'crowbar', 'knife', 'hammer', 'fists'];
