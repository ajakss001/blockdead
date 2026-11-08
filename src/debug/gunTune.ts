import './domStub';
import { Viewmodel } from '../player/Viewmodel';
import { failures, type FrameRow, gunAnimations, LIMITS } from './animCheck';
import { loadCharactersNode } from './nodeCharacters';
import { GUN_POSES, type GunPoses, resetGunRig } from '../player/gunPose';
import { GUN_TUNED } from '../player/gunTuned';
import { GUN_IDS, type GunId, GUNS } from '../weapons/guns';

/**
 * Where the gun may sit at the hip and how far from the eye in the sights, by class (a pose outside costs):
 * the tuner must not push the gun out of the picture to keep the wrists in their limits.
 */
const LOOKS = {
  pistol: { lo: [0.04, -0.18, -0.5], hi: [0.16, -0.06, -0.25], relief: [0.3, 0.55] },
  long: { lo: [0.06, -0.19, -0.4], hi: [0.2, -0.08, -0.16], relief: [0.14, 0.34] },
  launcher: { lo: [0.02, -0.16, -0.25], hi: [0.12, -0.05, -0.05], relief: [0.1, 0.3] },
} as const;

function looksCost(id: GunId): number {
  const P = GUN_POSES[id];
  const L = LOOKS[GUNS[id].cls];
  let c = 0;
  for (let i = 0; i < 3; i++) c += (Math.max(0, L.lo[i] - P.hip[i]) + Math.max(0, P.hip[i] - L.hi[i])) * 40000;
  c += (Math.max(0, L.relief[0] - P.relief) + Math.max(0, P.relief - L.relief[1])) * 40000;
  for (const k of ['shoulderR', 'shoulderL', 'adsShoulderR', 'adsShoulderL'] as const) for (const v of P[k]) c += Math.max(0, Math.abs(v) - 0.1) * 40000;
  return c;
}

/**
 * Gun pose tuner (dev tool): nudges the poses of a gun (player/gunPose GUN_POSES: the hand rolls about the
 * grip axes, the hip, sprint, wall, reload, inspect, butt-strike, put-away keys, the pouch) as little as it
 * must until every frame of all its animations (animCheck.gunAnimations) keeps the wrists and forearms in
 * range, the hands on their sockets and in the frame. --write saves the result to player/gunTuned.ts.
 *   node tools/vite-run.mjs src/debug/gunTune.ts <gun|all> [rounds] [--write]
 */

const over = (v: number, lim: number) => Math.max(0, Math.abs(v) - lim);

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
      }
      if (r.checkFrame && !r.headInFrame) c += 12;
    }
    per[name] = c;
    cost += c;
  }
  cost += looksCost(id);
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
  const pos = args.filter((a) => !a.startsWith('--'));
  const ids = !pos[0] || pos[0] === 'all' ? GUN_IDS : (pos[0].split(',') as GunId[]);
  const rounds = Number(pos[1] ?? 3);
  for (const id of ids) {
    const P = GUN_POSES[id];
    const t0 = Date.now();
    let best = gunCost(vm, id);
    if (!args.includes('--no-scan')) scanRolls(vm, id, P);
    console.log(`${id}: start cost ${best.cost.toFixed(0)} (${best.fails} fails; ${best.worst}) ${Date.now() - t0} ms/eval`);
    for (let r = 0; r < rounds && best.fails > 0; r++) {
      const scale = 1 / (1 + r);
      for (const { path, step } of PARAMS) {
        const only = animsOf(path);
        let base = only ? gunCost(vm, id, only).cost : best.cost;
        for (const dir of [1, -1, 2, -2]) {
          const old = get(P, path);
          set(P, path, old + dir * step * scale);
          const c = gunCost(vm, id, only);
          if (c.cost < base - 0.5) {
            base = c.cost;
          } else set(P, path, old);
        }
        if (only) best = gunCost(vm, id);
        else best = gunCost(vm, id);
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
  }
  vm.dispose();
  return 0;
}
