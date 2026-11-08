import './domStub';
import { Viewmodel } from '../player/Viewmodel';
import { failures, type FrameRow, gunAnimations, LIMITS } from './animCheck';
import { loadCharactersNode } from './nodeCharacters';
import { classPoses, GUN_POSES, type GunPoses, resetGunRig } from '../player/gunPose';
import { gunLook } from './gunChecks';
import { GUN_TUNED } from '../player/gunTuned';
import { GUN_IDS, type GunId, GUNS } from '../weapons/guns';
import { Quaternion, Vector3 } from 'three';
import { type Grip, GRIPS, gripsChanged } from '../player/grips';
import { gunRigData } from '../player/gunPose';

/**
 * Where the gun may sit at the hip and how far the grip is from the eye in the sights, by class (a pose
 * outside costs): the tuner must not push the gun out of the picture to keep the wrists in their limits.
 * Long guns low and to the right with the butt at the shoulder, the grip ~0.2–0.3 m ahead of the eye in the
 * sights (the stock in the shoulder); pistols at arm's length.
 */
const LOOKS = {
  pistol: { lo: [0.06, -0.18, -0.48], hi: [0.17, -0.1, -0.3], eye: [0.28, 0.5] },
  long: { lo: [0.1, -0.23, -0.3], hi: [0.2, -0.14, -0.15], eye: [0.2, 0.32] },
  // On the right shoulder: the tube along the view, right of the middle and just under the eye.
  launcher: { lo: [0.12, -0.19, -0.28], hi: [0.2, -0.12, -0.12], eye: [-0.2, 0.2] },
} as const;

const settle = (vm: Viewmodel, ads: boolean) => {
  vm.gunView.ads = ads;
  vm.gunView.wall = 0;
  vm.gunView.action = 'idle';
  for (let i = 0; i < 50; i++) {
    vm.fixedUpdate(1 / 60, false);
    vm.update(1 / 60, { lookX: 0, lookY: 0, stepPhase: 0, speed: 0, sprinting: false, flashlightOn: false });
  }
};
/**
 * The rules on what is drawn (CLAUDE.md «Огнестрельное оружие», debug/gunChecks): no roll at the hip or in the
 * sights; in the sights no hand in the circle round the middle; the left palm 4–6 cm under the bore (long
 * guns); at the hip the muzzle in the lower right quarter.
 */
function rulesCost(vm: Viewmodel, id: GunId): number {
  if (!vm.gunModel) return 0;
  settle(vm, false);
  const hip = gunLook(vm, id);
  settle(vm, true);
  const ads = gunLook(vm, id);
  settle(vm, false);
  let c = (Math.max(0, Math.abs(hip.roll) - 1) + Math.max(0, Math.abs(ads.roll) - 1)) * 200;
  c += ads.handPx * 200;
  // No sleeve or shoulder through the near plane in the frame.
  c += (hip.nearCut + ads.nearCut) * 500;
  if (GUNS[id].cls === 'long') {
    c += (Math.max(0, 0.04 - hip.palmBelow) + Math.max(0, hip.palmBelow - 0.06)) * 20000;
    c += (Math.max(0, 0.04 - ads.palmBelow) + Math.max(0, ads.palmBelow - 0.06)) * 20000;
  } else if (GUNS[id].cls === 'pistol') c += Math.max(0, 0.02 - ads.palmBelow) * 20000;
  if (GUNS[id].cls !== 'launcher') c += (Math.max(0, 0.03 - hip.muzzle[0]) + Math.max(0, hip.muzzle[1] + 0.03)) * 3000;
  return c;
}
let lookVm: Viewmodel | null = null;

function looksCost(id: GunId): number {
  const P = GUN_POSES[id];
  const L = LOOKS[GUNS[id].cls];
  let c = 0;
  for (let i = 0; i < 3; i++) c += (Math.max(0, L.lo[i] - P.hip[i]) + Math.max(0, P.hip[i] - L.hi[i])) * 40000;
  // The grip's distance ahead of the eye in the sights.
  const eye = -gunRigData(id).adsAt.z;
  c += (Math.max(0, L.eye[0] - eye) + Math.max(0, eye - L.eye[1])) * 40000;
  // The stance as the grip editor / the rules put it (grips.json): its place within the class's range.
  const st = GRIPS[id]?.stance?.at;
  if (st) for (let i = 0; i < 3; i++) c += (Math.max(0, L.lo[i] - st[i]) + Math.max(0, st[i] - L.hi[i])) * 40000;
  if (lookVm) c += rulesCost(lookVm, id);
  // The grips (data/grips.json) kept near where the reference / the editor put them.
  for (let i = 0; i < GP_N; i++) c += Math.max(0, Math.abs(gp[i]) - GP_FREE[i]) * GP_COST[i];
  for (const k of ['shoulderR', 'shoulderL', 'adsShoulderR', 'adsShoulderL'] as const) for (const v of P[k]) c += Math.max(0, Math.abs(v) - 0.1) * 40000;
  return c;
}

/**
 * Gun pose tuner (dev tool): nudges the poses of a gun (player/gunPose GUN_POSES: the hand rolls about the
 * grip axes, the hip, sprint, wall, reload, inspect, butt-strike, put-away keys, the pouch) as little as it
 * must until every frame of all its animations (animCheck.gunAnimations) keeps the wrists and forearms in
 * range, the hands on their sockets and in the frame, and the gun sits by the rules (rulesCost: no roll, no
 * hand in the middle of the sights, the left palm under the bore, the hip low and right). --write saves the
 * result to player/gunTuned.ts (and the grips to data/grips.json); --reset starts from the class's poses;
 * --no-scan skips the coarse scan of the grip rolls; --fine takes steps a fifth the size (the last fractions of
 * a degree past a limit).
 *   node tools/vite-run.mjs src/debug/gunTune.ts <gun|all> [rounds] [--reset] [--no-scan] [--fine] [--write]
 */

const over = (v: number, lim: number) => Math.max(0, Math.abs(v) - lim);

/**
 * The grip parameters tuned on top of data/grips.json as it was: the hands' turn about their grip axis and
 * the tilt of the handle across the palm (right, left), the stance moved, the sprint and reload poses
 * moved and turned (camera axes).
 */
const GP_NAMES = ['mainD', 'mainT', 'offD', 'offT', 'sx', 'sy', 'sz', 'spx', 'spy', 'spz', 'sprx', 'spry', 'rlx', 'rly', 'rlz', 'rlrx', 'rlry', 'rlrz'] as const;
const GP_N = GP_NAMES.length;
const GP_STEP = [0.12, 0.12, 0.12, 0.12, 0.015, 0.015, 0.015, 0.03, 0.03, 0.03, 0.15, 0.15, 0.03, 0.03, 0.03, 0.15, 0.15, 0.15];
/** Free play before it costs, and the cost per unit past it (the stance stays where it looks right). */
const GP_FREE = [0.8, 0.8, 0.8, 0.8, 0.025, 0.025, 0.025, 0.08, 0.08, 0.08, 0.5, 0.5, 0.06, 0.06, 0.06, 0.5, 0.5, 0.5];
const GP_COST = [200, 200, 200, 200, 20000, 20000, 20000, 5000, 5000, 5000, 300, 300, 5000, 5000, 5000, 300, 300, 300];
let gp = new Array<number>(GP_N).fill(0);
let gpBase: Grip = {};

const _q = new Quaternion();
const _ax = (x: number, y: number, z: number, a: number) => new Quaternion().setFromAxisAngle(new Vector3(x, y, z), a);
function applyGrip(id: GunId): void {
  const B = gpBase;
  const G: Grip = structuredClone(B);
  const turn = (q: number[], d: number, t: number) => {
    _q.set(q[0], q[1], q[2], q[3]).multiply(_ax(0, 1, 0, d)).multiply(_ax(1, 0, 0, t));
    return [_q.x, _q.y, _q.z, _q.w] as [number, number, number, number];
  };
  const camTurn = (q: number[], rx: number, ry: number, rz: number) => {
    _q.set(q[0], q[1], q[2], q[3]).premultiply(_ax(0, 0, 1, rz)).premultiply(_ax(1, 0, 0, rx)).premultiply(_ax(0, 1, 0, ry));
    return [_q.x, _q.y, _q.z, _q.w] as [number, number, number, number];
  };
  const add = (a: number[], x: number, y: number, z: number) => [a[0] + x, a[1] + y, a[2] + z] as [number, number, number];
  if (G.main && B.main) G.main.q = turn(B.main.q, gp[0], gp[1]);
  if (G.off && B.off) G.off.q = turn(B.off.q, gp[2], gp[3]);
  if (G.stance && B.stance) G.stance.at = add(B.stance.at, gp[4], gp[5], gp[6]);
  if (G.sprint && B.sprint) {
    G.sprint.at = add(B.sprint.at, gp[7], gp[8], gp[9]);
    G.sprint.q = camTurn(B.sprint.q, gp[10], gp[11], 0);
  }
  if (G.reload && B.reload) {
    G.reload.at = add(B.reload.at, gp[12], gp[13], gp[14]);
    G.reload.q = camTurn(B.reload.q, gp[15], gp[16], gp[17]);
  }
  GRIPS[id] = G;
  gripsChanged();
}

/** How far past the limits the animations go, summed over frames (degrees), and the failure count. */
export function gunCost(vm: Viewmodel, id: GunId, only?: string[]): { cost: number; fails: number; worst: string } {
  resetGunRig(id);
  const anims = gunAnimations(vm, id);
  let cost = 0;
  let fails = 0;
  const per: Record<string, number> = {};
  for (const [name, rows] of Object.entries(anims)) {
    if (only && !only.includes(name)) continue;
    fails += failures(id, name, rows).length;
    let c = 0;
    for (const r of rows as FrameRow[]) {
      for (const h of [r.R, r.L]) {
        if (!h) continue;
        c += over(h.flex, LIMITS.flex - 2) + over(h.dev, LIMITS.dev - 2) + over(h.twist, LIMITS.twist - 2) + over(h.roll, LIMITS.roll - 2);
        c += over(h.dWrist, LIMITS.jump - 2) * 2 + over(h.dRoll, LIMITS.jump - 2) + over(h.dSwivel, LIMITS.jump - 2) + h.socketGap * 400;
        if (r.checkFrame && !h.inFrame) c += 12;
        // An elbow up by the eye: the sleeve fills the view.
        c += Math.max(0, h.elbowY + 0.2) * 100;
      }
      if (r.checkFrame && !r.headInFrame) c += 12;
    }
    per[name] = c;
    cost += c;
  }
  cost += looksCost(id);
  // Frames the test fails come first (as animTune does): the smooth cost only breaks ties.
  cost += fails * 30;
  const worst = Object.entries(per)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, c]) => `${k} ${c.toFixed(0)}`)
    .join(', ');
  return { cost, fails, worst };
}

type Path = [keyof GunPoses] | [keyof GunPoses, number] | [keyof GunPoses, 'at' | 'turn', number];
const KEYS = ['sprint', 'wall', 'reload', 'lowered', 'inspectA', 'inspectB', 'bash'] as const;
const PARAMS: { path: Path; step: number }[] = [
  ...(['mainRoll', 'offRoll', 'magRoll', 'boltRoll', 'loadRoll', 'adsMainRoll', 'adsOffRoll'] as const).map((k) => ({ path: [k] as Path, step: 0.3 })),
  ...[0, 1, 2].map((i) => ({ path: ['hip', i] as Path, step: 0.03 })),
  ...[0, 1, 2].map((i) => ({ path: ['pouch', i] as Path, step: 0.05 })),
  ...[0, 1, 2].map((i) => ({ path: ['offShift', i] as Path, step: 0.015 })),
  { path: ['offTilt'] as Path, step: 0.15 },
  { path: ['relief'] as Path, step: 0.03 },
  ...(['shoulderR', 'shoulderL', 'adsShoulderR', 'adsShoulderL'] as const).flatMap((k) => [0, 1, 2].map((i) => ({ path: [k, i] as Path, step: 0.02 }))),
  ...KEYS.flatMap((k) => [0, 1, 2].flatMap((i) => [{ path: [k, 'at', i] as Path, step: 0.03 }, { path: [k, 'turn', i] as Path, step: 0.15 }])),
];

function get(p: GunPoses, path: Path): number {
  const o = p as unknown as Record<string, unknown>;
  if (path.length === 1) return o[path[0]] as number;
  if (path.length === 2) return (o[path[0]] as number[])[path[1]];
  return ((o[path[0]] as Record<string, number[]>)[path[1]])[path[2]];
}
function set(p: GunPoses, path: Path, v: number): void {
  const o = p as unknown as Record<string, unknown>;
  if (path.length === 1) o[path[0]] = v;
  else if (path.length === 2) (o[path[0]] as number[])[path[1]] = v;
  else (o[path[0]] as Record<string, number[]>)[path[1]][path[2]] = v;
}

/** Which animations a parameter can change (the rest are not re-scored). */
function animsOf(path: Path): string[] | undefined {
  const k = path[0];
  if (k === 'sprint') return ['sprint'];
  if (k === 'wall') return ['wall'];
  if (k === 'lowered') return ['switch'];
  if (k === 'inspectA' || k === 'inspectB') return ['inspect'];
  if (k === 'bash') return ['bash'];
  return undefined;
}

/** Coarse scan of the two grip rolls over the whole turn (the descent alone stays in a local minimum). */
function scanRolls(vm: Viewmodel, id: GunId, P: GunPoses): void {
  const sub = ['idle', 'ads', 'fire', 'walk'];
  for (const k of ['mainRoll', 'offRoll'] as const) {
    let best = Infinity;
    let bestV = P[k];
    for (let a = -180; a < 180; a += 20) {
      P[k] = (a * Math.PI) / 180;
      const c = gunCost(vm, id, sub).cost;
      if (c < best) {
        best = c;
        bestV = P[k];
      }
    }
    P[k] = bestV;
  }
}

export async function main(args: string[]): Promise<number> {
  await loadCharactersNode();
  const vm = new Viewmodel();
  vm.setBody('male', 1);
  vm.setAspect(16 / 9);
  lookVm = vm;
  const pos = args.filter((a) => !a.startsWith('--'));
  const ids = !pos[0] || pos[0] === 'all' ? GUN_IDS : (pos[0].split(',') as GunId[]);
  const rounds = Number(pos[1] ?? 3);
  for (const id of ids) {
    // --reset: from the class's poses (the earlier tuning dropped), the grips as they are.
    if (args.includes('--reset')) {
      GUN_POSES[id] = classPoses(id);
      resetGunRig(id);
    }
    const P = GUN_POSES[id];
    gpBase = structuredClone(GRIPS[id] ?? {});
    vm.equip(id);
    gp = new Array<number>(GP_N).fill(0);
    const t0 = Date.now();
    let best = gunCost(vm, id);
    if (!args.includes('--no-scan')) scanRolls(vm, id, P);
    console.log(`${id}: start cost ${best.cost.toFixed(0)} (${best.fails} fails; ${best.worst}) ${Date.now() - t0} ms/eval`);
    for (let r = 0; r < rounds && (best.fails > 0 || r < 1); r++) {
      const scale = (args.includes('--fine') ? 0.2 : 1) / (1 + r);
      const gain = args.includes('--fine') ? 0.05 : 0.5;
      for (const { path, step } of PARAMS) {
        const only = animsOf(path);
        let base = only ? gunCost(vm, id, only).cost : best.cost;
        for (const dir of [1, -1, 2, -2]) {
          const old = get(P, path);
          set(P, path, old + dir * step * scale);
          const c = gunCost(vm, id, only);
          if (c.cost < base - gain) {
            base = c.cost;
          } else set(P, path, old);
        }
        if (only) best = gunCost(vm, id);
        else best = gunCost(vm, id);
      }
      if (gpBase.stance)
        for (let i = 0; i < GP_N; i++) {
          let base = best.cost;
          for (const dir of [1, -1, 2, -2]) {
            const old = gp[i];
            gp[i] = old + dir * GP_STEP[i] * scale;
            applyGrip(id);
            const c = gunCost(vm, id);
            if (c.cost < base - gain) {
              base = c.cost;
              best = c;
            } else gp[i] = old;
          }
          applyGrip(id);
        }
      console.log(`  round ${r + 1}: cost ${best.cost.toFixed(0)} (${best.fails} fails; ${best.worst})`);
    }
    // What differs from the class defaults goes to gunTuned.ts.
    GUN_TUNED[id] = structuredClone(P);
  }
  if (args.includes('--write')) {
    type Fs = { writeFileSync(p: string, d: string): void };
    const fs = (globalThis as unknown as { process: { getBuiltinModule(m: string): Fs } }).process.getBuiltinModule('node:fs');
    const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
    type FsR = Fs & { readFileSync(p: string, e: string): string };
    const disk = (fs as FsR).readFileSync('src/player/gunTuned.ts', 'utf8');
    const lit = disk.slice(disk.indexOf('= {') + 2, disk.lastIndexOf('}') + 1).replace(/(\w+):/g, '"$1":');
    const now = JSON.parse(lit) as typeof GUN_TUNED;
    const merged = { ...(now ?? {}) } as typeof GUN_TUNED;
    for (const id of ids) merged[id] = GUN_TUNED[id];
    const body = JSON.stringify(merged, round, 2).replace(/"(\w+)":/g, '$1:');
    fs.writeFileSync(
      'src/player/gunTuned.ts',
      `import type { GunId } from '../weapons/guns';\nimport type { GunPoses } from './gunPose';\n\n/** Written by \`node tools/vite-run.mjs src/debug/gunTune.ts <gun|all> [rounds] --write\`: per-gun overrides of the class poses. */\nexport const GUN_TUNED: Partial<Record<GunId, Partial<GunPoses>>> = ${body};\n`,
    );
    console.log('written src/player/gunTuned.ts');
    // The grips: merged into the file as it is on disk (tuners on other guns may have written it).
    const gdisk = JSON.parse((fs as FsR).readFileSync('src/data/grips.json', 'utf8')) as Record<string, Grip>;
    for (const id of ids) if (GRIPS[id]) gdisk[id] = GRIPS[id];
    const r4 = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
    fs.writeFileSync('src/data/grips.json', `${JSON.stringify(gdisk, r4, 2)}
`);
    console.log('written src/data/grips.json');
  }
  vm.dispose();
  return 0;
}
