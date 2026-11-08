import { type Group, Quaternion, Vector3 } from 'three';
import { FOREARM_ROLL, hitTime, swingTime, WRIST_DEV, WRIST_FLEX, WRIST_TWIST } from '../player/armRig';
import { GRIP_X, GRIP_Z } from '../player/hand';
import { FISTS, HELD, type HeldConfig } from '../player/held';
import type { HandItem, RightItem, Viewmodel, ViewmodelFrame } from '../player/Viewmodel';
import { GUN_IDS, GUNS, type GunId, isGun } from '../weapons/guns';
import { type AmmoSource, type GunInput, GunState, newInst } from '../weapons/gunState';

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

const cfgOf = (item: HandItem): HeldConfig => (item === 'fists' || isGun(item) ? FISTS : HELD[item]);

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
  private lastItem: HandItem | null = null;
  constructor(private readonly vm: Viewmodel) {}

  restart(): void {
    this.first = true;
  }

  hand(k: 0 | 1, item: HandItem, checkFrame: boolean): HandRow {
    const vm = this.vm;
    const v = vm as unknown as VmInternals;
    const pose = k === 0 ? vm.rig.right.pose : vm.rig.left.pose;
    const hand = k === 0 ? v.handR : v.handL;
    const side = k === 0 ? 1 : -1;
    if (isGun(item)) return this.gunHand(k, hand, side, checkFrame);
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

  /** A hand on a gun: against the socket the viewmodel says it holds (grip, handguard, magazine, bolt). */
  private gunHand(k: 0 | 1, hand: Group, side: number, checkFrame: boolean): HandRow {
    const vm = this.vm;
    const pose = k === 0 ? vm.rig.right.pose : vm.rig.left.pose;
    const gripW = _a.set(GRIP_X * side, 0, GRIP_Z).applyMatrix4(hand.matrixWorld);
    const socketW = new Vector3();
    vm.gunSocket(k, socketW, _qb);
    const socketGap = gripW.distanceTo(socketW);
    const inFrame = !checkFrame || inView(vm, gripW);
    hand.getWorldQuaternion(_qa);
    const socketTurn = quatAngle(_qa, _qb);
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

  /** A frame with a gun in hand: the hands, and the muzzle (its head) on screen. */
  gunRow(frame: number, phase: string, item: GunId, checkFrame: boolean): FrameRow {
    const vm = this.vm;
    vm.scene.updateMatrixWorld(true);
    // Long guns and the launcher: the hand on the grip sits low at the hip, below the frame (as in any shooter); the left hand and the muzzle stay in it.
    const R = this.hand(0, item, checkFrame && GUNS[item].cls === 'pistol');
    // The launcher on the shoulder: the left hand on the rear grip is behind the right one, below the frame too.
    const L = this.hand(1, item, checkFrame && GUNS[item].cls !== 'launcher');
    this.first = false;
    const gm = vm.gunModel!;
    const muzzle = gm.muzzle(new Vector3()).applyMatrix4(gm.root.matrixWorld);
    const headInFrame = !checkFrame || inView(vm, muzzle);
    const cam = vm.camera;
    const prev = cam.aspect;
    cam.aspect = 16 / 9;
    cam.updateProjectionMatrix();
    const pm = muzzle.clone().project(cam);
    cam.aspect = prev;
    cam.updateProjectionMatrix();
    const swap = this.lastItem !== null && this.lastItem !== item;
    this.lastItem = item;
    return { frame, phase, R, L, headInFrame, checkFrame, swap, headX: pm.x, headY: pm.y, butX: 0, butY: 0, contact: false };
  }

  row(frame: number, phase: string, item: HandItem, checkFrame: boolean, leftActive: boolean): FrameRow {
    if (isGun(item)) return this.gunRow(frame, phase, item, checkFrame);
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
function settle(vm: Viewmodel, item: HandItem, f: ViewmodelFrame): void {
  const v = vm as unknown as VmInternals;
  vm.equip(item);
  for (let i = 0; i < 90 && (v.item !== item || i < 40); i++) {
    vm.fixedUpdate(1 / 60, false);
    vm.update(1 / 60, f);
  }
}

/** The swing of `item` as 60 frames at 60 Hz: a few frames at rest, the whole swing, rest again. */
export function swingFrames(vm: Viewmodel, item: HandItem): FrameRow[] {
  if (isGun(item)) return gunAnimations(vm, item).fire;
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
export function allAnimations(vm: Viewmodel, item: HandItem): Record<string, FrameRow[]> {
  if (isGun(item)) return gunAnimations(vm, item);
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
  const path = !isGun(item) && !!cfgOf(item as RightItem).keys.swing;
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
    if (r.checkFrame && !r.headInFrame && !(path && r.phase === 'windup')) add(r.frame, isGun(item) ? 'muzzle out of the frame' : 'weapon head out of the frame');
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

export const ITEMS: HandItem[] = ['axe', 'bat', 'crowbar', 'knife', 'hammer', 'fists', ...GUN_IDS];

/** Unlimited rounds and magazines for the checks. */
const plenty = (): AmmoSource => ({ count: () => 999, take: (_id, n) => n, give: () => {}, spareMags: () => 9, takeMag: () => true });

/**
 * Every animation of a gun, on the real gun logic (GunState) at 60 Hz: idle (breathing), walk, sprint and
 * back, crouch, into the sights and out, fire (single shots, a burst on auto, in the sights), every reload
 * (tactical, from empty, one at a time with a shot cutting it short), the pump / bolt, a jam cleared, inspect,
 * the fire-mode switch, the butt strike, a wall in front, switching away and back (holster / draw).
 */
export function gunAnimations(vm: Viewmodel, id: GunId): Record<string, FrameRow[]> {
  const g = GUNS[id];
  const dt = 1 / 60;
  const out: Record<string, FrameRow[]> = {};
  const inst = newInst(id, g.capacity + 1);
  const gs = new GunState(id, inst, plenty());
  const gv = vm.gunView;
  gv.mods = [];
  const s = new Sampler(vm);
  const none: GunInput = { trigger: false, pulled: false, reload: false, mode: false, inspect: false, bash: false, canFire: true };
  /** One frame: the gun logic, then the arms; check: the hands and the muzzle in the frame. */
  const tick = (rows: FrameRow[], phase: string, inp: Partial<GunInput>, f: Partial<ViewmodelFrame>, check: boolean) => {
    for (const e of gs.update(dt, { ...none, ...inp })) if (e.kind === 'shot') vm.fire(g.recoil.up, g.recoil.side, g.recoil.back);
    gv.action = gs.action;
    gv.t = gs.t;
    gv.duration = gs.duration;
    gv.open = gs.open;
    gv.chamber = inst.chamber;
    vm.fixedUpdate(dt, false);
    vm.update(dt, frameOf({ flashlightOn: false, ...f }));
    rows.push(s.gunRow(rows.length, gs.action === 'idle' ? phase : gs.action, id, check && gs.action === 'idle'));
  };
  const run = (name: string, n: number, inp: (i: number) => Partial<GunInput>, f: (i: number) => Partial<ViewmodelFrame> = () => ({}), check = true) => {
    s.restart();
    const rows: FrameRow[] = (out[name] = []);
    for (let i = 0; i < n; i++) tick(rows, name, inp(i), f(i), check);
  };
  const until = (name: string, max: number, inp: (i: number) => Partial<GunInput>, check = false) => {
    // What the last one left going (the bolt after a shot) finishes first, off the record.
    for (let k = 0; k < 600 && (gs.busy || k < 20); k++) {
      gs.update(dt, none);
      gv.action = gs.action;
      gv.t = gs.t;
      gv.duration = gs.duration;
      vm.fixedUpdate(dt, false);
      vm.update(dt, frameOf({ flashlightOn: false }));
    }
    s.restart();
    const rows: FrameRow[] = (out[name] = []);
    let i = 0;
    do tick(rows, name, inp(i), {}, check);
    while (++i < max && (gs.busy || i < 3));
    // A few frames of rest after it.
    for (let k = 0; k < 6; k++) tick(rows, name, {}, {}, check);
  };
  gv.ads = false;
  gv.wall = 0;
  settle(vm, id, frameOf({ flashlightOn: false }));
  // The draw from the switch: let it finish.
  for (let i = 0; i < 60; i++) {
    gs.update(dt, none);
    vm.update(dt, frameOf({ flashlightOn: false }));
  }
  run('idle', 60, () => ({}));
  let phase = 0;
  run('walk', 90, () => ({}), () => ((phase += (Math.PI * 1.8) / 60), { stepPhase: phase, speed: 1.6 }));
  run('sprint', 100, () => ({}), (i) => ((phase += (Math.PI * 2.6) / 60), { sprinting: i < 70, stepPhase: phase, speed: i < 70 ? 5 : 1 }), false);
  run('crouch', 50, () => ({}), (i) => ({ crouch: Math.min(1, i / 20) }));
  gv.ads = true;
  run('ads', 40, () => ({}), () => ({}), false);
  run('adsFire', 50, (i) => ({ pulled: i % 12 === 0, trigger: i % 12 < 2 }), () => ({}), false);
  gv.ads = false;
  run('adsOut', 30, () => ({}));
  if (g.modes.includes('auto')) {
    inst.mode = 'auto';
    run('auto', 60, (i) => ({ trigger: i < 40, pulled: i === 0 }));
    inst.mode = g.modes[0];
  }
  run('fire', 60, (i) => ({ pulled: i % 20 === 0, trigger: i % 20 < 2 }));
  if (g.feed === 'mag') {
    until('reload', 400, (i) => ({ reload: i === 0 }));
    inst.mag = 0;
    inst.chamber = false;
    until('reloadEmpty', 400, (i) => ({ reload: i === 0 }));
  } else if (g.feed === 'rocket') {
    inst.chamber = false;
    until('reload', 400, (i) => ({ reload: i === 0 }));
  } else {
    inst.mag = 0;
    inst.chamber = false;
    // One at a time, cut short by the trigger after a few rounds.
    until('load', 600, (i) => ({ reload: i === 0, pulled: i === 100, trigger: i === 100 }));
  }
  if (g.action === 'pump' || g.action === 'bolt') {
    inst.chamber = true;
    inst.mag = Math.max(inst.mag, 2);
    until('cycle', 200, (i) => ({ pulled: i === 0, trigger: i < 2 }));
  }
  if (g.feed !== 'rocket') {
    inst.jammed = true;
    inst.chamber = true;
    inst.mag = Math.max(1, inst.mag);
    until('unjam', 400, (i) => ({ reload: i === 0 }));
  }
  until('inspect', 400, (i) => ({ inspect: i === 0 }), true);
  if (g.modes.length > 1) until('mode', 100, (i) => ({ mode: i === 0 }), true);
  until('bash', 100, (i) => ({ bash: i === 0 }), false);
  // A wall comes close and goes (gunView.wall from its distance: muzzle up and back).
  out.wall = [];
  s.restart();
  for (let i = 0; i < 70; i++) {
    gv.wall = i < 35 ? Math.min(1, i / 15) : Math.max(0, 1 - (i - 35) / 15);
    tick(out.wall, 'wall', {}, {}, false);
  }
  gv.wall = 0;
  // Switching away (holster) and back (draw).
  s.restart();
  out.switch = [];
  vm.equip('fists');
  for (let i = 0; i < 60; i++) {
    vm.fixedUpdate(dt, false);
    vm.update(dt, frameOf({ flashlightOn: false }));
    if (!vm.gun) break;
    out.switch.push(s.gunRow(out.switch.length, 'holster', id, false));
  }
  for (let i = 0; i < 20; i++) vm.update(dt, frameOf({ flashlightOn: false }));
  vm.equip(id);
  for (let i = 0; i < 90; i++) {
    vm.fixedUpdate(dt, false);
    vm.update(dt, frameOf({ flashlightOn: false }));
    if (vm.gun) out.switch.push(s.gunRow(out.switch.length, 'draw', id, false));
  }
  return out;
}
