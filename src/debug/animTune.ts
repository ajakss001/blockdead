import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { damp } from '../core/math';
import { type ArmPose, basisQuat, FOREARM_ROLL, HandsRig, type ItemState, WRIST_DEV, WRIST_FLEX, WRIST_TWIST } from '../player/armRig';
import { FISTS, HELD, type HeldConfig, type Key, type KeySet } from '../player/held';

/**
 * Key-pose tuner (dev tool): nudges the key poses (and two-handed socket rolls) of a key set as little
 * as possible until every frame of its animations keeps the wrists in range, the hands on the grips and
 * the weapon head and hands in the frame. Prints the tuned key set for held.ts.
 *   node tools/vite-run.mjs src/debug/animTune.ts twoHanded|knife|hammer|fists|torch [iterations]
 */

type KeyName = 'idle' | 'sprint' | 'lowered' | 'windup' | 'strike' | 'recover';
const KEY_NAMES: KeyName[] = ['idle', 'sprint', 'lowered', 'windup', 'strike', 'recover'];
const DEG = Math.PI / 180;
const AXIS_W = Number((globalThis as { process?: { env: Record<string, string> } }).process?.env.AXIS_W ?? 0.3);
const over = (v: number, lim: number) => Math.max(0, Math.abs(v) - lim);

const cam = new PerspectiveCamera(60, 16 / 9, 0.01, 5);
cam.updateMatrixWorld();
const cams = [16 / 9, 4 / 3].map((a) => {
  const c = cam.clone();
  c.aspect = a;
  c.updateProjectionMatrix();
  return c;
});
const _p = new Vector3();
/** Out-of-frame cost of a point; `margin` is how far inside the edge (NDC) it should stay. */
function frameCost(p: Vector3, margin = 0.95): number {
  let c = 0;
  for (const k of cams) {
    _p.copy(p).project(k);
    c += over(_p.x, margin) ** 2 + over(_p.y, margin) ** 2 + (p.z > -0.05 ? 1 : 0);
  }
  return c;
}

interface Frame {
  st: ItemState;
  ts: ItemState;
  check: boolean;
  first: boolean;
  /** Viewmodel bob of the frame (root offset), m. */
  bob: Vector3;
}

/** The frames of every animation, with the viewmodel's own smoothing and bob. */
function frames(cfg: HeldConfig): Frame[] {
  const out: Frame[] = [];
  const rest = (): ItemState => ({ attackT: -1, sprint: 0, pump: 0, lower: 0 });
  const total = cfg.windup + cfg.strike + cfg.recover;
  const still = new Vector3();
  for (let i = 0; i <= Math.ceil(total * 60) + 1; i++) out.push({ st: { ...rest(), attackT: i / 60 > total ? -1 : i / 60 }, ts: rest(), check: true, first: i === 0, bob: still });
  let s = 0;
  let phase = 0;
  for (let i = 0; i < 60; i++) {
    s = damp(s, 1, 10, 1 / 60);
    phase += (Math.PI * 2.6) / 60;
    const pump = Math.sin(phase) * s;
    // Viewmodel.update: bob at the sprint speed (amp 1.6).
    const bob = new Vector3(Math.sin(phase) * 0.016, -Math.abs(Math.sin(phase)) * 0.0192, 0);
    out.push({ st: { ...rest(), sprint: s, pump }, ts: { ...rest(), sprint: s, pump: -pump }, check: true, first: i === 0, bob });
  }
  // Stopping: the sprint pose fades while the steps still bob.
  for (let i = 0; i < 20; i++) {
    s = damp(s, 0, 10, 1 / 60);
    phase += (Math.PI * 2.6) / 60;
    const pump = Math.sin(phase) * s;
    const bob = new Vector3(Math.sin(phase) * 0.016, -Math.abs(Math.sin(phase)) * 0.0192, 0);
    out.push({ st: { ...rest(), sprint: s, pump }, ts: { ...rest(), sprint: s, pump: -pump }, check: true, first: false, bob });
  }
  // Lowering and raising again (switching, the flashlight off and on).
  let d = 0;
  for (let i = 0; i < 70; i++) {
    d = damp(d, i < 35 ? 1 : 0, 12, 1 / 60);
    out.push({ st: { ...rest(), lower: d }, ts: { ...rest(), lower: d }, check: false, first: i === 0, bob: still });
  }
  return out;
}

const rig = new HandsRig();
const _h = new Vector3();
const _g = new Vector3();
const _q = new Quaternion();
const _prevW = [new Quaternion(), new Quaternion()];
const _prevS = [0, 0];
const _prevR = [0, 0];
const JUMP_W = 20;

/** Arm cost of one solved pose: wrist range (with a little margin), reach, a straight (locked) arm. */
function armCost(p: ArmPose, margin: number): number {
  const ex = over(p.flex, WRIST_FLEX - 2 * margin) ** 2 + over(p.dev, WRIST_DEV - 2 * margin) ** 2 + over(p.twist, WRIST_TWIST - 2 * margin) ** 2 + over(p.roll, FOREARM_ROLL - 3 * margin) ** 2;
  return 10 * ex + 2000 * p.reachErr ** 2 + 50 * over(p.extension, 0.9) ** 2;
}

/** Cost of a config over all its frames; `report` counts limit breaks instead. */
export const tally: Record<string, number> = {};
function cost(cfgs: HeldConfig[], torch: HeldConfig, arms: number[], report = false): number {
  let c = 0;
  let breaks = 0;
  for (const cfg of cfgs) {
    for (const f of frames(cfg)) {
      if (f.first) rig.reset();
      rig.update(cfg, f.st, torch, f.ts);
      const poses = [rig.right.pose, rig.left.pose];
      for (const k of arms) {
        const p = poses[k];
        c += armCost(p, DEG) + 0.002 * ((p.flex / WRIST_FLEX) ** 2 + (p.dev / WRIST_DEV) ** 2);
        if (!f.first) {
          const dw = 2 * Math.acos(Math.min(1, Math.abs(p.hand.dot(_prevW[k]))));
          c += JUMP_W * (over(dw, 11 * DEG) ** 2 + over(Math.abs(p.swivel - _prevS[k]), 11 * DEG) ** 2 + over(Math.abs(p.roll - _prevR[k]), 11 * DEG) ** 2);
          if (dw > 15 * DEG || Math.abs(p.roll - _prevR[k]) > 15 * DEG || Math.abs(p.swivel - _prevS[k]) > 15 * DEG) {
            breaks++;
            if (report) tally.jump = (tally.jump ?? 0) + 1;
          }
        }
        _prevW[k].copy(p.hand);
        _prevS[k] = p.swivel;
        _prevR[k] = p.roll;
        const lim = over(p.flex, WRIST_FLEX) + over(p.dev, WRIST_DEV) + over(p.twist, WRIST_TWIST) + over(p.roll, FOREARM_ROLL);
        if (lim > 0 || p.reachErr > 0.01) breaks++;
        if (report) {
          const tag = (n: string, v: boolean) => v && (tally[`${k ? 'L' : 'R'} ${n}`] = (tally[`${k ? 'L' : 'R'} ${n}`] ?? 0) + 1);
          tag('flex', over(p.flex, WRIST_FLEX) > 0);
          tag('dev', over(p.dev, WRIST_DEV) > 0);
          tag('twist', over(p.twist, WRIST_TWIST) > 0);
          tag('roll', over(p.roll, FOREARM_ROLL) > 0);
          tag('reach', p.reachErr > 0.01);
          tag('straight', p.extension > 0.95);
        }
      }
      if (f.check) {
        const it = rig.item;
        const head = _h.set(...cfg.head).applyQuaternion(it.q).add(it.pos).add(f.bob);
        const fc =
          (arms.includes(0) ? frameCost(head, HEAD_MARGIN) + frameCost(_g.copy(rig.targetR.grip).add(f.bob)) : 0) + (arms.includes(1) ? frameCost(_g.copy(rig.targetL.grip).add(f.bob)) : 0);
        c += 30 * fc + 30 * Math.max(0, NEAR - head.length()) ** 2;
        if (report && head.length() < NEAR) tally.near = (tally.near ?? 0) + 1;
        if (fc > 0) breaks++;
        if (report && fc > 0) tally.frame = (tally.frame ?? 0) + 1;
        // Two-handed: the return runs low (its own path), not back over the top the way the chop came.
        const t = f.st.attackT;
        if (cfg.twoHanded && t >= cfg.windup + cfg.strike && t < cfg.windup + cfg.strike + 0.5 * cfg.recover) {
          const y = _p.copy(head).project(cams[0]).y;
          c += 20 * Math.max(0, y - 0.05) ** 2;
          if (report && y > 0.05) tally.overTop = (tally.overTop ?? 0) + 1;
        }
      }
    }
  }
  return report ? breaks : c;
}

const v3 = (a: readonly number[]) => new Vector3(a[0], a[1], a[2]);
const fmt = (x: number) => Number(x.toFixed(3));
const arr = (v: Vector3) => `[${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}]`;

/** Key rotated by the rotation vector r (rad) and moved by p. */
function moved(k: Key, r: Vector3, p: Vector3, body: Vector3): Key {
  const ang = r.length();
  _q.setFromAxisAngle(ang > 1e-9 ? r.clone().divideScalar(ang) : new Vector3(1, 0, 0), ang);
  const axis = v3(k.axis).normalize().applyQuaternion(_q);
  const edge = v3(k.edge).applyQuaternion(_q);
  const at = v3(k.at).add(p);
  const b = v3(k.body ?? [0, 0, 0]).add(body);
  return { at: [at.x, at.y, at.z], axis: [axis.x, axis.y, axis.z], edge: [edge.x, edge.y, edge.z], body: [b.x, b.y, b.z], slide: k.slide };
}

/** Screen (16:9 NDC) points of a static key: the anchor hand, the main hand, the head; plus their nearness. */
function screen(cfg: HeldConfig, k: Key): Vector3[] {
  const q = basisQuat(v3(k.axis), v3(k.edge));
  const anchor = cfg.keys.anchor === 'off' && cfg.off ? cfg.off.along : cfg.main.along;
  const butt = v3(k.at).addScaledVector(new Vector3(0, 1, 0).applyQuaternion(q), -anchor);
  const along = cfg.main.along + ((cfg.main.slide ?? cfg.main.along) - cfg.main.along) * (k.slide ?? 0);
  const pts = [v3(k.at), new Vector3(0, along, 0).applyQuaternion(q).add(butt), v3(cfg.head).applyQuaternion(q).add(butt)];
  return pts.map((p) => {
    const d = p.length();
    const v = p.clone().project(cams[0]);
    // Depth only as a soft term: closer than 0.3 m to the eye looks wrong.
    v.z = Math.max(0, 0.3 - d) * 5;
    return v;
  });
}

type XY = [number, number] | null;
/** Direction the head travels in the chop: down, to the left, a little forward. */
const CHOP = new Vector3(-0.6, -0.7, -0.3).normalize();
const OUT = new Vector3(0.6, 0, -0.8);
/** The weapon head (its middle) stays this far inside the frame, so the whole blade shows. */
const HEAD_MARGIN = 0.8;
/** The weapon head never comes closer to the eye than this (m). */
const NEAR = 0.42;
/**
 * Where things should be on screen (16:9 NDC) in each key: [anchor hand, main hand, head]; null = as in the
 * old key. The old keys had the head over the edge in the windup and the hands under it in the sprint.
 */
const TARGETS: Record<string, Partial<Record<KeyName, [XY, XY, XY]>>> = {
  twoHanded: {
    idle: [[-0.25, -0.8], null, [0.55, 0.4]],
    sprint: [[-0.2, -0.85], null, [0.75, 0.1]],
    windup: [[0.15, -0.6], [0.4, 0.05], [0.55, 0.45]],
    strike: [[0.05, -0.72], null, [-0.25, -0.55]],
    recover: [[-0.1, -0.8], null, [0.3, -0.4]],
  },
  knife: { sprint: [[0.15, -0.88], null, [-0.08, -0.45]], strike: [[-0.02, -0.62], null, [-0.22, -0.3]], recover: [[0.08, -0.85], null, [-0.05, -0.45]] },
  hammer: { sprint: [[0.15, -0.88], null, [-0.1, -0.4]], strike: [[-0.02, -0.62], null, [-0.22, -0.28]], recover: [[0.08, -0.85], null, [-0.05, -0.4]] },
  fists: { sprint: [[0.1, -0.85], null, null], windup: [[0.3, -0.85], null, null], recover: [[0.14, -0.8], null, null] },
  torch: { idle: [[-0.25, -0.85], null, [-0.16, -0.55]], sprint: [[-0.2, -0.88], null, [-0.03, -0.62]] },
};
for (const set of Object.values(TARGETS)) for (const t of Object.values(set)) if (t && !t[1] && t[0]) t[1] = null;

/** The rest key dropped out of view: hands 40 cm lower and a little closer, tipped forward and down about the anchor. */
function lowerOf(k: Key): Key {
  const tip = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.7);
  const axis = v3(k.axis).applyQuaternion(tip);
  const edge = v3(k.edge).applyQuaternion(tip);
  return { ...k, at: [k.at[0], k.at[1] - 0.4, k.at[2] + 0.15], axis: [axis.x, axis.y, axis.z], edge: [edge.x, edge.y, edge.z] };
}

/** A key between a and b: position and slide lerped, rotations slerped. */
function blendKey(a: Key, b: Key, t: number): Key {
  const qa = basisQuat(v3(a.axis), v3(a.edge));
  const qb = basisQuat(v3(b.axis), v3(b.edge));
  const q = qa.slerp(qb, t);
  const axis = new Vector3(0, 1, 0).applyQuaternion(q);
  const edge = new Vector3(0, 0, -1).applyQuaternion(q);
  const at = v3(a.at).lerp(v3(b.at), t);
  const body = v3(a.body ?? [0, 0, 0]).lerp(v3(b.body ?? [0, 0, 0]), t);
  return { at: [at.x, at.y, at.z], axis: [axis.x, axis.y, axis.z], edge: [edge.x, edge.y, edge.z], body: [body.x, body.y, body.z], slide: (a.slide ?? 0) + ((b.slide ?? 0) - (a.slide ?? 0)) * t };
}

/** Wrist / reach / frame cost of one static pose (every key of the set the same). */
function staticCost(cfgs: HeldConfig[], torch: HeldConfig, arms: number[], frame: boolean, low = false): number {
  const st: ItemState = { attackT: -1, sprint: 0, pump: 0, lower: 0 };
  let c = 0;
  for (const cfg of cfgs) {
    rig.reset();
    rig.update(cfg, st, torch, st);
    const poses = [rig.right.pose, rig.left.pose];
    for (const k of arms) {
      const p = poses[k];
      c += armCost(p, 1.5 * DEG);
    }
    if (frame) {
      const it = rig.item;
      const head = _h.set(...cfg.head).applyQuaternion(it.q).add(it.pos);
      c += 5 * ((arms.includes(0) ? frameCost(head, HEAD_MARGIN) + frameCost(rig.targetR.grip) : 0) + (arms.includes(1) ? frameCost(rig.targetL.grip) : 0));
      // On a low path (the return after the chop) the head stays in the lower part of the frame.
      if (low) c += 20 * Math.max(0, _p.copy(head).project(cams[0]).y - 0.05) ** 2;
      c += 30 * Math.max(0, NEAR - head.length()) ** 2;
    }
  }
  return c;
}

function gauss(): number {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

export function main(args: string[]): number {
  const which = args[0] ?? 'twoHanded';
  const iters = Number(args[1] ?? 2500);
  const base: Record<string, HeldConfig[]> = {
    twoHanded: [HELD.axe, HELD.bat, HELD.crowbar],
    knife: [HELD.knife],
    hammer: [HELD.hammer],
    fists: [FISTS],
    torch: [FISTS],
  };
  const cfgs0 = base[which];
  const tuneTorch = which === 'torch';
  const set0: KeySet = tuneTorch ? HELD.torch.keys : cfgs0[0].keys;
  const names = KEY_NAMES.filter((n) => set0[n]);
  const twoHanded = cfgs0[0].twoHanded;
  const arms = tuneTorch ? [1] : twoHanded ? [0, 1] : [0];
  // Parameters: per key a rotation vector and an offset; two-handed: the two socket rolls.
  const P = 9;
  const dims = names.length * P + (twoHanded ? 2 : 0);
  const ref = tuneTorch ? HELD.torch : cfgs0[0];
  const lookOf = (n: KeyName, k: Key) => {
    const s0 = screen(ref, set0[n]!);
    const t = TARGETS[which]?.[n];
    if (t) t.forEach((xy, i) => xy && s0[i].set(xy[0], xy[1], 0));
    const s1 = screen(ref, k);
    const w = n === 'lowered' ? 0.3 : n === 'windup' || n === 'strike' || n === 'idle' ? 3 * AXIS_W : AXIS_W;
    let look = 0;
    for (let i = 0; i < 3; i++) {
      const d = Math.hypot(s0[i].x - s1[i].x, s0[i].y - s1[i].y);
      look += w * (10 * Math.max(0, d - 0.12) ** 2 + 0.1 * d * d) + 2 * s1[i].z;
    }
    // Hands about as far out as before (not reaching out with straight arms).
    const d0 = v3(set0[n]!.at).length();
    look += 3 * (v3(k.at).length() - d0) ** 2;
    // The axe's edge leads: in the windup and the strike it faces the way the head travels (down-left).
    if (twoHanded && (n === 'windup' || n === 'strike')) {
      const e = new Vector3(0, 0, -1).applyQuaternion(basisQuat(v3(k.axis), v3(k.edge)));
      look += 3 * Math.max(0, 0.5 - e.dot(CHOP)) ** 2;
    }
    // The flashlight shines forward, away from the eye.
    if (tuneTorch && n !== 'lowered') look += 50 * Math.max(0, 0.85 + v3(k.axis).normalize().z) ** 2;
    // At rest the edge faces out and forward, away from the body.
    if (twoHanded && (n === 'idle' || n === 'sprint' || n === 'recover')) {
      const e = new Vector3(0, 0, -1).applyQuaternion(basisQuat(v3(k.axis), v3(k.edge)));
      look += 3 * Math.max(0, 0.4 - e.dot(OUT)) ** 2;
    }
    return look + 0.05 * v3(k.body ?? [0, 0, 0]).lengthSq();
  };
  // Seed: each key on its own by random search near its old place on screen, for socket rolls on a 30° grid.
  let seedSet: KeySet = set0;
  let rolls = [0, 0];
  if (!args.includes('--no-seed')) {
    const B = twoHanded ? 12 : 1;
    const table = names.map(() => Array.from({ length: B * B }, () => ({ c: Infinity, k: null as Key | null, r: [0, 0] })));
    const samples = Number(args[2] ?? 30000);
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    names.forEach((n, ni) => {
      const k0 = set0[n]!;
      for (let i = 0; i < samples; i++) {
        const k: Key = {
          at: [k0.at[0] + rnd(-0.2, 0.2), k0.at[1] + rnd(-0.2, 0.2), k0.at[2] + rnd(-0.25, 0.15)],
          axis: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)],
          edge: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)],
          body: [rnd(-0.4, 0.4), rnd(-0.5, 0.5), rnd(-0.4, 0.4)],
          slide: k0.slide,
        };
        const r = twoHanded ? [rnd(-Math.PI, Math.PI), rnd(-Math.PI, Math.PI)] : [0, 0];
        const one: KeySet = { anchor: set0.anchor, idle: k, sprint: k, lowered: k };
        const cfgs = cfgs0.map((c) => ({ ...c, keys: tuneTorch ? c.keys : one, main: { ...c.main, roll: c.main.roll + r[0] }, off: c.off ? { ...c.off, roll: c.off.roll + r[1] } : undefined }));
        const torch = tuneTorch ? { ...HELD.torch, keys: one } : HELD.torch;
        const c = staticCost(cfgs, torch, arms, n !== 'lowered') + lookOf(n, k);
        const bi = twoHanded ? (Math.floor(((r[0] + Math.PI) / (2 * Math.PI)) * B) % B) * B + (Math.floor(((r[1] + Math.PI) / (2 * Math.PI)) * B) % B) : 0;
        const cell = table[ni][bi];
        if (c < cell.c) {
          cell.c = c;
          cell.k = k;
          cell.r = r;
        }
      }
    });
    let bestB = 0;
    let bestC = Infinity;
    for (let bi = 0; bi < B * B; bi++) {
      const c = table.reduce((sum, t) => sum + t[bi].c, 0);
      if (c < bestC) {
        bestC = c;
        bestB = bi;
      }
    }
    seedSet = { ...set0 };
    names.forEach((n, ni) => (seedSet[n] = table[ni][bestB].k!));
    if (twoHanded) rolls = table[names.indexOf('idle')][bestB].r;
    // Then key by key in the order of the swing, each new key also judged by the frames on the way
    // to it from the one before (and on to the next), so the transitions stay within the wrists' range.
    const r = rolls;
    const withRolls = (one: KeySet) => {
      const cfgs = cfgs0.map((c) => ({ ...c, keys: tuneTorch ? c.keys : one, main: { ...c.main, roll: c.main.roll + r[0] }, off: c.off ? { ...c.off, roll: c.off.roll + r[1] } : undefined }));
      return { cfgs, torch: tuneTorch ? { ...HELD.torch, keys: one } : HELD.torch };
    };
    const pathCost = (a: Key, b: Key, low = false) => {
      let c = 0;
      for (const t of [0.2, 0.4, 0.6, 0.8]) {
        const m = blendKey(a, b, t);
        const w = withRolls({ anchor: set0.anchor, idle: m, sprint: m, lowered: m });
        c += staticCost(w.cfgs, w.torch, arms, true, low);
      }
      return c;
    };
    const order: [KeyName, KeyName | null, KeyName | null][] = [
      ['idle', null, null],
      ['sprint', 'idle', null],
      ['lowered', 'idle', null],
      ['windup', 'idle', null],
      ['strike', 'windup', null],
      ['recover', 'strike', 'idle'],
    ];
    for (const [n, from, to] of order) {
      if (!set0[n]) continue;
      const k0 = set0[n]!;
      let best: Key = seedSet[n]!;
      const score = (k: Key) => {
        const w = withRolls({ anchor: set0.anchor, idle: k, sprint: k, lowered: k });
        let c = staticCost(w.cfgs, w.torch, arms, n !== 'lowered') + lookOf(n, k);
        if (from && seedSet[from]) c += pathCost(seedSet[from]!, k, twoHanded && n === 'recover');
        if (to && seedSet[to]) c += pathCost(k, seedSet[to]!);
        return c;
      };
      let bestC = score(best);
      for (let i = 0; i < samples / 6; i++) {
        // Half the samples near the current best, half anywhere near the old key.
        const near = i % 2 === 0;
        const src = near ? best : k0;
        const sp = near ? 0.05 : 0.2;
        const k: Key = near
          ? moved(best, new Vector3(rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(-0.4, 0.4)), new Vector3(rnd(-sp, sp), rnd(-sp, sp), rnd(-sp, sp)), new Vector3(rnd(-0.1, 0.1), rnd(-0.1, 0.1), rnd(-0.1, 0.1)))
          : { at: [src.at[0] + rnd(-sp, sp), src.at[1] + rnd(-sp, sp), src.at[2] + rnd(-0.25, 0.15)], axis: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)], edge: [rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)], body: [rnd(-0.4, 0.4), rnd(-0.5, 0.5), rnd(-0.4, 0.4)], slide: k0.slide };
        k.slide = k0.slide;
        const c = score(k);
        if (c < bestC) {
          bestC = c;
          best = k;
        }
      }
      seedSet[n] = n === 'lowered' && seedSet.idle ? lowerOf(seedSet.idle) : best;
      console.log(`  seed ${n}: ${bestC.toFixed(3)}`);
    }
    console.log(`seed: static cost ${bestC.toFixed(3)} per key ${names.map((n, ni) => `${n} ${table[ni][bestB].c.toFixed(3)}`).join(', ')}${twoHanded ? ` rolls +${(rolls[0] / DEG).toFixed(0)}° / +${(rolls[1] / DEG).toFixed(0)}°` : ''}`);
  }
  const build = (x: number[]) => {
    const set: KeySet = { ...set0 };
    names.forEach((n, i) => {
      const o = i * P;
      set[n] = moved(seedSet[n]!, new Vector3(x[o], x[o + 1], x[o + 2]), new Vector3(x[o + 3], x[o + 4], x[o + 5]).multiplyScalar(0.2), new Vector3(x[o + 6], x[o + 7], x[o + 8]).multiplyScalar(0.5));
    });
    // Lowered: the rest grip dropped out of view, not a pose of its own.
    set.lowered = lowerOf(set.idle);
    const r = twoHanded ? [rolls[0] + x[dims - 2], rolls[1] + x[dims - 1]] : [0, 0];
    const cfgs = cfgs0.map((c) => ({
      ...c,
      keys: tuneTorch ? c.keys : set,
      main: { ...c.main, roll: c.main.roll + r[0] },
      off: c.off ? { ...c.off, roll: c.off.roll + r[1] } : undefined,
    }));
    const torch = tuneTorch ? { ...HELD.torch, keys: set } : HELD.torch;
    return { set, cfgs, torch };
  };
  const total = (x: number[], rollPenalty = true) => {
    const b = build(x);
    // Keep the picture: where the weapon head, the hands and the handle are on screen. Depth and the
    // turn about the handle are free (the old 3D poses were out of the wrists' reach).
    let look = 0;
    for (const n of names) look += lookOf(n, b.set[n]!);
    if (twoHanded && rollPenalty) look += 0.002 * (x[dims - 2] ** 2 + x[dims - 1] ** 2);
    return cost(b.cfgs, b.torch, arms) + look;
  };
  let x = new Array(dims).fill(0);
  if (twoHanded && args.includes('--grid')) {
    // Socket rolls first, on a grid (the turn of the hands about the handle decides the forearm twist).
    let best = Infinity;
    for (let r = -180; r < 180; r += 15)
      for (let l = -180; l < 180; l += 15) {
        const y = x.slice();
        y[dims - 2] = r * DEG;
        y[dims - 1] = l * DEG;
        const c = total(y, false);
        if (c < best) {
          best = c;
          x = y;
        }
      }
    console.log(`rolls grid: R +${(x[dims - 2] / DEG).toFixed(0)}°, L +${(x[dims - 1] / DEG).toFixed(0)}°, cost ${best.toFixed(3)}`);
  }
  let fx = total(x);
  const b0 = build(x);
  console.log(`start: cost ${fx.toFixed(4)}, limit breaks ${cost(b0.cfgs, b0.torch, arms, true)}`, JSON.stringify(tally));
  for (const k in tally) delete tally[k];
  let sigma = 0.08;
  for (let it = 0; it < iters; it++) {
    const y = x.map((v) => v + sigma * gauss());
    const fy = total(y);
    if (fy < fx) {
      x = y;
      fx = fy;
      sigma = Math.min(0.3, sigma * 1.25);
    } else sigma = Math.max(0.002, sigma * 0.97);
    if (it % 500 === 0) console.log(`  ${it}: cost ${fx.toFixed(4)} sigma ${sigma.toFixed(3)}`);
  }
  const b = build(x);
  console.log(`end: cost ${fx.toFixed(4)}, limit breaks ${cost(b.cfgs, b.torch, arms, true)}`, JSON.stringify(tally));
  const lines = names.map((n) => {
    const k = b.set[n]!;
    const axis = v3(k.axis).normalize();
    const edge = v3(k.edge);
    edge.addScaledVector(axis, -edge.dot(axis)).normalize();
    const body = v3(k.body ?? [0, 0, 0]);
    const sl = k.slide ? `, ${body.lengthSq() > 1e-6 ? '' : 'undefined, '}${k.slide}` : '';
    return `  ${n}: key(${arr(v3(k.at))}, ${arr(axis)}, ${arr(edge)}${body.lengthSq() > 1e-6 ? `, ${arr(body)}` : ''}${sl}),`;
  });
  console.log(lines.join('\n'));
  if (twoHanded) console.log(`rolls: R ${(b.cfgs[0].main.roll / DEG).toFixed(1)}°, L ${(b.cfgs[0].off!.roll / DEG).toFixed(1)}°`);
  if (args.includes('--write')) {
    // Replace the key lines of this set in held.ts (comments stay), and the two-handed rolls.
    type Fs = { readFileSync(p: string, e: string): string; writeFileSync(p: string, d: string): void };
    const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): Fs } }).process.getBuiltinModule('node:fs');
    const file = 'src/player/held.ts';
    let src = fs.readFileSync(file, 'utf8');
    const constName = ({ twoHanded: 'TWO_HANDED', knife: 'KNIFE', hammer: 'HAMMER', fists: 'FIST', torch: 'TORCH' } as Record<string, string>)[which];
    const start = src.indexOf(`const ${constName}: KeySet = {`);
    const end = src.indexOf('\n};', start);
    let block = src.slice(start, end);
    names.forEach((n, i) => {
      block = block.replace(new RegExp(`\\n  ${n}: key\\(.*\\),`), '\n' + lines[i]);
    });
    src = src.slice(0, start) + block + src.slice(end);
    if (twoHanded) {
      src = src.replace(/const ROLL_R = .*;/, `const ROLL_R = ${(b.cfgs[0].main.roll / DEG).toFixed(1)} * DEG;`);
      src = src.replace(/const ROLL_L = .*;/, `const ROLL_L = ${(b.cfgs[0].off!.roll / DEG).toFixed(1)} * DEG;`);
    }
    fs.writeFileSync(file, src);
    console.log(`written to ${file}`);
  }
  return 0;
}
