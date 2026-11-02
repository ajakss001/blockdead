import { Matrix4, Quaternion, Vector3 } from 'three';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { GameLoop, MAX_FRAME_DT } from '../core/GameLoop';
import type { Profiler } from '../core/Profiler';
import { ZombieModels } from '../render/ZombieModels';
import { PHASE_M, type ZombieWorld, ZombieSim } from '../systems/zombies';
import { type BoneName, boneIndex } from '../zombies/skeleton';
import { limitTurn } from '../zombies/twitch';

/**
 * Pause and long frames (part of npm run test:zombies): the loop gives the world no time while paused and
 * no more than MAX_FRAME_DT a frame (a hidden tab, a stall, 15 fps); the zombies' heads and arms hold still on
 * pause — however long, whatever the frame time the renderer is given — and go on from where they were.
 */

/** Joints watched: a bone's turn in its parent's (or the chest's) frame. */
const JOINTS: [BoneName, BoneName][] = [
  ['Head', 'Chest'],
  ['UpperArm_L', 'Chest'],
  ['UpperArm_R', 'Chest'],
  ['Hand_L', 'LowerArm_L'],
  ['Hand_R', 'LowerArm_R'],
];
const _a = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const angle = (a: Quaternion, b: Quaternion) => (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI;

export function pauseChecks(check: (ok: boolean, what: string) => void): void {
  // --- The loop: one place that says how much world time a frame has. ---
  {
    let now = 0;
    let raf: ((t: number) => void) | null = null;
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, now: performance.now };
    g.requestAnimationFrame = (cb: (t: number) => void) => ((raf = cb), 1);
    g.cancelAnimationFrame = () => (raf = null);
    Object.defineProperty(performance, 'now', { value: () => now, configurable: true });
    const frames: { frameDt: number; gameDt: number; steps: number }[] = [];
    let steps = 0;
    const loop = new GameLoop(
      {
        fixedUpdate: () => steps++,
        render: (_alpha, frameDt, gameDt) => {
          frames.push({ frameDt, gameDt, steps });
          steps = 0;
        },
      },
      { reset() {}, record() {} } as unknown as Profiler,
      { emit() {} } as unknown as EventBus<GameEvents>,
    );
    loop.targetFps = 0;
    const run = (seconds: number, fps: number) => {
      frames.length = 0;
      for (let t = 0; t < seconds; t += 1 / fps) {
        now += 1000 / fps;
        raf?.(now);
      }
      return frames.slice();
    };
    loop.start();
    run(1, 60);
    loop.pause('menu');
    const menu = run(10, 60);
    check(menu.every((f) => f.gameDt === 0 && f.steps === 0 && f.frameDt > 0), 'pause 10 s: frames go on, the world gets no time (0 steps, game dt 0)');
    loop.resume('menu');
    const back = run(0.5, 60);
    check(back.every((f) => f.gameDt > 0 && f.gameDt <= MAX_FRAME_DT && f.steps <= 2), `after the pause: no catch-up (first frame ${(back[0].gameDt * 1000).toFixed(1)} ms)`);
    loop.pause('hidden');
    now += 30_000; // the tab hidden 30 s: no frames at all
    const hidden = raf === null;
    loop.resume('hidden');
    const tab = run(0.5, 60);
    check(hidden && tab.every((f) => f.gameDt <= MAX_FRAME_DT && f.steps <= 2), `hidden tab 30 s: no frames, then ${(tab[0].gameDt * 1000).toFixed(1)} ms and ${tab[0].steps} step(s)`);
    now += 30_000; // a stall with the loop running (debugger, pointer lock dialog)
    const stall = run(1 / 60, 60)[0];
    check(stall.frameDt <= MAX_FRAME_DT && stall.gameDt <= MAX_FRAME_DT && stall.steps <= 5, `a 30 s stall: frame dt ${stall.frameDt} s, ${stall.steps} steps`);
    for (let k = 0; k < 4; k++) {
      loop.pause('menu');
      run(0.2, 60);
      loop.resume('menu');
      run(0.2, 60);
    }
    const slow = run(2, 15);
    const simSec = slow.reduce((n, f) => n + f.steps, 0) / 60;
    check(slow.every((f) => f.frameDt <= MAX_FRAME_DT + 1e-9 && f.frameDt > 0), `15 fps: frame dt ≤ ${MAX_FRAME_DT} s; the world keeps real time (${simSec.toFixed(2)} s in 2 s)`);
    loop.stop();
    g.requestAnimationFrame = saved.raf;
    g.cancelAnimationFrame = saved.caf;
    Object.defineProperty(performance, 'now', { value: saved.now, configurable: true });
  }

  // --- The zombies on it: walking, standing, running, near (mixer + twitches) and far (baked). ---
  const flat: ZombieWorld = { groundY: () => 0, resolveCircle: () => {}, rayHit: () => -1 };
  const sim = new ZombieSim(flat, 0);
  const models = new ZombieModels('low');
  const eye = new Vector3(0, 1.6, 0);
  const list = [sim.spawnAt(1, -3, 'chase', 'office'), sim.spawnAt(-1.5, -4, 'idle', 'police'), sim.spawnAt(0.5, -5, 'chase', 'worker'), sim.spawnAt(3, -40, 'chase', 'chef')];
  const speeds = [0.6, 0, 1.3, 0.6];
  const turns = () =>
    list.flatMap((z) => {
      const w = models.bones(z)!;
      return JOINTS.map(([b, p]) => new Quaternion().setFromRotationMatrix(_a.copy(w[boneIndex(p)]).invert().multiply(w[boneIndex(b)])).normalize());
    });
  const frame = (dt: number, world: number) => {
    list.forEach((z, i) => {
      z.speed = speeds[i];
      z.phase += ((speeds[i] * world) / PHASE_M) * Math.PI * 2;
    });
    models.update(list, eye, dt);
  };
  /**
   * Frames of `dt` (the world moving by `world` s each): the largest turn of any joint in a frame, and from
   * the start; `settle`: the least of the frames' largest turns from the start over the last 4 s (between
   * twitches the pose is back where it was — unless turns pile up).
   */
  const span = (n: number, dt: number, world: number) => {
    const t0 = turns();
    let last = t0;
    let jump = 0;
    let drift = 0;
    let settle = Infinity;
    for (let f = 0; f < n; f++) {
      frame(dt, world);
      const t = turns();
      let d = 0;
      t.forEach((q, i) => {
        jump = Math.max(jump, angle(q, last[i]));
        d = Math.max(d, angle(q, t0[i]));
      });
      drift = Math.max(drift, d);
      if (f >= n - 240) settle = Math.min(settle, d);
      last = t;
    }
    return { jump, drift, settle };
  };
  span(120, 1 / 60, 1 / 60);
  const walk = span(240, 1 / 60, 1 / 60);
  // The renderer still ticking with the world stopped (how a menu used to pause): twitches play, no pile-up.
  const menu = span(3600, 1 / 60, 0);
  check(menu.settle < 3 && menu.drift < 70, `world stopped 60 s, frames ticking: twitches come and go (≤ ${menu.drift.toFixed(1)}°), the pose comes back (${menu.settle.toFixed(1)}°): no pile-up`);
  const pause = span(600, 0, 0);
  check(pause.drift < 0.01, `paused 10 s (dt 0): not a twitch (${pause.drift.toFixed(4)}°)`);
  const resume = span(120, 1 / 60, 1 / 60);
  check(resume.jump <= Math.max(15, walk.jump + 1), `resumed: goes on smoothly (most ${resume.jump.toFixed(1)}° a frame; walking ${walk.jump.toFixed(1)}°)`);
  const slow = span(120, MAX_FRAME_DT, 1 / 15);
  check(slow.jump < 35, `15 fps: most ${slow.jump.toFixed(1)}° a frame (a twitch's snap included)`);
  // The joint limits (head: twist 70°, bend 40°, side 20°), the short way round, no flip past 180°.
  {
    const rest = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.3);
    const lim = [(70 * Math.PI) / 180, (40 * Math.PI) / 180, (20 * Math.PI) / 180] as const;
    const turnAbout = (x: number, y: number, z: number, a: number) => rest.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), a));
    const off = (q: Quaternion) => angle(q, rest);
    const yaw = turnAbout(0, 1, 0, 3);
    limitTurn(yaw, rest, lim);
    const bend = turnAbout(1, 0, 0, -1.4);
    limitTurn(bend, rest, lim);
    const flip = turnAbout(0, 1, 0, 3.3); // past 180°: the short way is −171°
    limitTurn(flip, rest, lim);
    const small = turnAbout(0.3, 1, 0.2, 0.3);
    const before = small.clone();
    limitTurn(small, rest, lim);
    check(
      Math.abs(off(yaw) - 70) < 0.5 && Math.abs(off(bend) - 40) < 0.5 && Math.abs(off(flip) - 70) < 0.5 && angle(small, before) < 1e-3,
      `head limits: 172° → ${off(yaw).toFixed(1)}°, bend 80° → ${off(bend).toFixed(1)}°, 189° → ${off(flip).toFixed(1)}° (the short way), within: untouched`,
    );
  }
  // Placement sanity: the zombies are where the world put them.
  const w = models.bones(list[0])!;
  w[0].decompose(_p, new Quaternion(), _s);
  check(Math.abs(_s.x - 1) < 1e-3 && Number.isFinite(_p.x), 'bones finite, unscaled');
}
