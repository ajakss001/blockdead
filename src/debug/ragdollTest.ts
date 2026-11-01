import { Quaternion, Vector3 } from 'three';
import { bodyParts, FIGURE_SHAPE, PARTS, type Ragdoll, Ragdolls, type StaticBox, ZOMBIE_SHAPE } from '../physics/ragdoll';
import { playerRagdoll } from '../player/deathBody';
import { DeathCamera, deathSurroundings } from '../player/DeathCamera';
import { FISTS, HELD } from '../player/held';
import { zombieRagdoll } from '../render/zombieBody';
import { ZombieModels } from '../render/ZombieModels';
import { BONES, PARENT, restLocals, skeletonDims } from '../zombies/skeleton';
import { WORKER } from '../zombies/types';
import { type PlayerSense, type ZombieWorld, ZombieSim } from '../systems/zombies';
import { CollisionWorld } from '../world/CollisionWorld';

/**
 * npm run test:ragdoll — the dead: zombie ragdolls (never a bind pose, asleep within 3 s and frozen after,
 * a different body every time, nothing under the floor or in a wall) and the player's death camera (never
 * inside anything in a corridor, by a wall, on stairs, under a tree, in an open street).
 */
type Scene = { world: CollisionWorld; boxes: { minX: number; maxX: number; minZ: number; maxZ: number; minY: number; maxY: number; obb?: StaticBox['obb'] }[]; crowns: number[] };

function scene(): Scene {
  const world = new CollisionWorld();
  return { world, boxes: [], crowns: [] };
}
function box(s: Scene, minX: number, minZ: number, maxX: number, maxZ: number, minY = -50, maxY = 50): void {
  s.world.addBox(minX, minZ, maxX, maxZ, minY, maxY);
  s.boxes.push({ minX, minZ, maxX, maxZ, minY, maxY });
}
function car(s: Scene, cx: number, cz: number, yaw: number): void {
  s.world.addOrientedBox(cx, cz, 0.9, 2.2, yaw, 0, 1.4);
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  s.boxes.push({ minX: -1e9, minZ: -1e9, maxX: 1e9, maxZ: 1e9, minY: 0, maxY: 1.4, obb: { cx, cz, hx: 0.9, hz: 2.2, c, s: sn } });
}
function near(s: Scene, x: number, z: number): StaticBox[] {
  const out: StaticBox[] = [];
  s.world.boxesNear(x, z, 4, (b) => out.push(b));
  return out;
}

/** How deep a point is inside a box (m, > 0 inside). */
function depth(b: Scene['boxes'][number], p: Vector3): number {
  if (p.y < b.minY || p.y > b.maxY) return -1;
  if (b.obb) {
    const o = b.obb;
    const wx = p.x - o.cx;
    const wz = p.z - o.cz;
    return Math.min(o.hx - Math.abs(wx * o.c - wz * o.s), o.hz - Math.abs(wx * o.s + wz * o.c), p.y - b.minY, b.maxY - p.y);
  }
  return Math.min(p.x - b.minX, b.maxX - p.x, p.z - b.minZ, b.maxZ - p.z, p.y - b.minY, b.maxY - p.y);
}

/** Every corner of every part box (scaled by k) through a visitor. */
function corners(rd: Ragdoll, shape = ZOMBIE_SHAPE, k = 1, visit: (p: Vector3) => void): void {
  const parts = bodyParts(shape);
  for (let i = 0; i < PARTS; i++) {
    const h = parts[i].h;
    const pose = rd.poses[i];
    for (let c = 0; c < 8; c++) {
      _c.set(c & 1 ? h[0] : -h[0], c & 2 ? h[1] : -h[1], c & 4 ? h[2] : -h[2]).multiplyScalar(k).applyQuaternion(pose.q).add(pose.p);
      visit(_c);
    }
  }
}
const _c = new Vector3();

/** The pose relative to the pelvis: each part's turn from it (rad), and the pelvis's own tilt. */
function signature(rd: Ragdoll): number[] {
  const inv = rd.poses[0].q.clone().invert();
  const out: number[] = [];
  for (let i = 1; i < PARTS; i++) {
    const q = inv.clone().multiply(rd.poses[i].q);
    out.push(q.x, q.y, q.z, q.w * Math.sign(q.w || 1));
  }
  const up = new Vector3(0, 1, 0).applyQuaternion(rd.poses[0].q);
  out.push(up.y * 2);
  return out;
}

/** A repeatable random (each run its own fall). */
function seeded(seed: number): () => number {
  let a = seed * 2654435761;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const flat: ZombieWorld = {
  groundY: () => 0,
  resolveCircle: () => {},
  rayHit: () => -1,
  indoors: () => false,
};
const sense = (x: number, z: number): PlayerSense => ({ pos: new Vector3(x, 0, z), eye: 1.6, noise: 1, crouched: false, lit: 0, daylight: 1 });

export function main(args: string[] = []): number {
  const RUNS = Number(args[0]) || 3;
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };

  // --- Zombies: ten deaths from all sides, with every weapon, by a wall, by a car, in the open. ---
  {
    const s = scene();
    box(s, 4, -30, 5, 30, 0, 3);
    car(s, -6, 4, 0.4);
    const sim = new ZombieSim(flat, 0);
    const weapons = [FISTS, HELD.knife, HELD.hammer, HELD.bat, HELD.crowbar, HELD.axe];
    const spots: [number, number][] = [
      [3.4, -8],
      [3.5, 0],
      [3.3, 8],
      [-4.6, 3.2],
      [-7.6, 5],
      [-12, -12],
      [-16, -10],
      [-12, 14],
      [0, 20],
      [-20, 0],
    ];
    const ragdolls = new Ragdolls();
    ragdolls.limit = 10;
    let bind = 0;
    let slept = 0;
    let slowest = 0;
    let low = Infinity;
    let inside = 0;
    let deep = 0;
    const sigs: number[][] = [];
    const bodies: { rd: Ragdoll; z: ReturnType<ZombieSim['spawnAt']> }[] = [];
    spots.forEach(([x, z], k) => {
      const zb = sim.spawnAt(x, z, 'chase');
      zb.yaw = (k * 2.39) % (Math.PI * 2);
      zb.phase = k * 1.7;
      zb.gait = 0.3 + ((k * 0.37) % 0.7);
      zb.speed = 0.4 + (k % 3) * 0.3;
      const a = k * 0.63 + (k % 2 ? Math.PI : 0);
      const head = k % 3 === 0;
      const w = weapons[k % weapons.length];
      const point = zb.pos.clone().add(new Vector3(0, head ? 1.6 : 0.9 + (k % 4) * 0.12, 0));
      zb.hp = 0.5;
      sim.hit(zb, (head ? 2 : 1) * w.damage[1], x + Math.sin(a) * 1.5, z + Math.cos(a) * 1.5, head, point);
      const rd = zombieRagdoll(zb, ZombieSim.scale(zb), k * 0.71, near(s, x, z));
      ragdolls.add(rd);
      bodies.push({ rd, z: zb });
    });
    // Until all sleep (3 s at most), every frame: not the bind pose, nothing under the floor or in a wall.
    for (let f = 0; f < 200; f++) {
      ragdolls.update(1 / 60);
      for (const { rd } of bodies) {
        if (rd.asleep) continue;
        let turn = 0;
        for (let i = 1; i < PARTS; i++) turn = Math.max(turn, rd.poses[0].q.angleTo(rd.poses[i].q));
        if (turn < 0.08) bind++;
        corners(rd, ZOMBIE_SHAPE, 1, (p) => {
          low = Math.min(low, p.y);
          for (const b of s.boxes) {
            const d = depth(b, p);
            deep = Math.max(deep, d);
            if (d > 0.04) inside++;
          }
        });
      }
      for (const { rd } of bodies) if (rd.asleep && !(rd as unknown as { counted?: boolean }).counted) ((rd as unknown as { counted?: boolean }).counted = true), slept++, (slowest = Math.max(slowest, f + 1));
    }
    check(bind === 0, `no frame after death has the bind pose (${bind} frames)`);
    check(slept === bodies.length && slowest <= 180, `all ${bodies.length} asleep within 3 s (slowest ${(slowest / 60).toFixed(2)} s)`);
    check(low >= -0.03, `no part below the floor (lowest corner ${low.toFixed(3)} m)`);
    check(inside === 0, `no part inside the wall or the car (${inside} corners, deepest ${(deep * 100).toFixed(1)} cm)`);
    for (const { rd } of bodies) sigs.push(signature(rd));
    let minDiff = Infinity;
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) minDiff = Math.min(minDiff, Math.hypot(...sigs[i].map((v, n) => v - sigs[j][n])));
    }
    check(minDiff > 0.3, `10 deaths, 10 different bodies (closest pair differs by ${minDiff.toFixed(2)})`);
    // Asleep: 300 frames with ten living zombies crowding round each body — nothing moves.
    const before = bodies.map(({ rd, z }) => [...rd.snapshot(), z.pos.x, z.pos.y, z.pos.z, z.yaw].join('|'));
    for (const { z } of bodies) for (let k = 0; k < 10; k++) sim.spawnAt(z.pos.x + Math.cos(k) * 0.8, z.pos.z + Math.sin(k) * 0.8, 'chase');
    let changed = 0;
    for (let f = 0; f < 300; f++) {
      sim.update(1 / 60, sense(spots[0][0], spots[0][1]));
      ragdolls.update(1 / 60);
      bodies.forEach(({ rd, z }, i) => {
        if ([...rd.snapshot(), z.pos.x, z.pos.y, z.pos.z, z.yaw].join('|') !== before[i]) changed++;
      });
    }
    check(changed === 0, `asleep: 300 frames unchanged with 10 zombies round each body (${changed} changes)`);
    // The cost: four ragdolls awake at once.
    const four: Ragdoll[] = [];
    const t0 = performance.now();
    let steps = 0;
    for (let k = 0; k < 4; k++) {
      const zb = sim.spawnAt(30 + k * 3, 30, 'chase');
      zb.hp = 0.5;
      sim.hit(zb, 40, 30 + k * 3, 28);
      four.push(zombieRagdoll(zb, 1, 0, []));
    }
    while (four.some((r) => !r.asleep) && steps < 180) {
      for (const r of four) r.step();
      steps++;
    }
    const ms = (performance.now() - t0) / Math.max(1, steps);
    console.log(`     four awake ragdolls: ${ms.toFixed(2)} ms per 60 Hz step (${steps} steps)`);
  }

  // --- The one-armed worker drawn as a model: its ragdoll starts from the model's own pose, then drives its bones. ---
  {
    const flat: ZombieWorld = { groundY: () => 0, resolveCircle: () => {}, rayHit: () => -1 };
    const sim = new ZombieSim(flat, 0);
    const models = new ZombieModels('high');
    const eye = new Vector3(0, 0, 0);
    const rest = restLocals(skeletonDims(WORKER.proportions));
    let jump = 0;
    let gap = 0;
    let under = 0;
    let hips = 0;
    let asleep = 0;
    const runs = 6;
    for (let k = 0; k < runs; k++) {
      const zb = sim.spawnAt(2 + k * 4, 3, 'chase', 'worker');
      zb.yaw = k * 1.3;
      for (let f = 0; f < 20; f++) {
        zb.speed = k % 2 ? 1.1 : 0.5;
        zb.phase += 0.12;
        models.update([zb], eye, 1 / 60);
      }
      zb.hp = 1;
      sim.hit(zb, 50, zb.pos.x + Math.sin(k) * 2, zb.pos.z + Math.cos(k) * 2, k % 3 === 0, zb.pos.clone().setY(1.2));
      const start = models.deathStart(zb, 1);
      const live = models.bones(zb.id)!.map((b) => new Vector3().setFromMatrixPosition(b.matrixWorld));
      const rd = zombieRagdoll(zb, 1, 0, [], start ?? undefined);
      models.addCorpse(zb, rd, 1);
      const dead = models.bones(zb.id)!;
      dead.forEach((b, i) => (jump = Math.max(jump, new Vector3().setFromMatrixPosition(b.matrixWorld).distanceTo(live[i]))));
      let steps = 0;
      while (!rd.asleep && steps < 240) {
        rd.step();
        models.update([], eye, 1 / 60);
        steps++;
      }
      models.update([], eye, 1 / 60);
      if (rd.asleep) asleep++;
      // Every joint where its parent bone says it is (no limb torn off the body), nothing under the floor.
      BONES.forEach((n, i) => {
        const p = PARENT[n];
        const at = new Vector3().setFromMatrixPosition(dead[i].matrixWorld);
        under = Math.min(under, at.y);
        if (!p) return;
        const want = rest[i].pos.clone().applyMatrix4(dead[BONES.indexOf(p)].matrixWorld);
        gap = Math.max(gap, want.distanceTo(at));
      });
      hips = Math.max(hips, new Vector3().setFromMatrixPosition(dead[0].matrixWorld).y);
    }
    check(jump < 0.03, `worker model → ragdoll: no jump at the moment of death (${(jump * 100).toFixed(1)} cm)`);
    check(gap < 0.06 && asleep === runs, `worker corpse driven by its ragdoll: joints hold together (worst ${(gap * 100).toFixed(1)} cm), ${asleep}/${runs} asleep`);
    check(hips < 0.45 && under > -0.05, `worker corpse lies on the floor (hips at most ${hips.toFixed(2)} m, lowest joint ${under.toFixed(3)} m)`);
  }

  // --- The player's death: the camera never inside anything. ---
  const deaths: { name: string; build: (s: Scene) => { feet: Vector3; yaw: number; killer: Vector3 | null; ceiling: number | null } }[] = [
    {
      name: 'narrow corridor',
      build: (s) => {
        box(s, -1.2, -20, -0.6, 20);
        box(s, 0.6, -20, 1.2, 20);
        return { feet: new Vector3(0, 0, 0), yaw: 0, killer: new Vector3(0, 0, -0.9), ceiling: 2.7 };
      },
    },
    {
      name: 'by a wall',
      build: (s) => {
        box(s, -10, 0.45, 10, 1.2);
        return { feet: new Vector3(0, 0, 0), yaw: 0, killer: new Vector3(0, 0, -0.9), ceiling: null };
      },
    },
    {
      name: 'on stairs',
      build: (s) => {
        // A flight up along −Z between walls, the player on the 6th step; the storey's ceiling above.
        for (let i = 0; i < 16; i++) box(s, -0.6, -(i + 1) * 0.3, 0.6, -i * 0.3, -1, (i + 1) * 0.18);
        box(s, -1.3, -6, -0.6, 2);
        box(s, 0.6, -6, 1.3, 2);
        const y = 6 * 0.18;
        return { feet: new Vector3(0, y, -6 * 0.3 + 0.15), yaw: Math.PI, killer: new Vector3(0, y, -6 * 0.3 + 1.0), ceiling: 3.0 };
      },
    },
    {
      name: 'under a tree',
      build: (s) => {
        box(s, 1.2, -0.2, 1.6, 0.2, 0, 3.5);
        // A maple: trunk 2.6 m, crown 2.8 m round (as Vegetation.crownsNear gives it).
        s.crowns.push(1.4, 2.6 + 2.8, 0, 2.8);
        car(s, -2.4, -1, 0.2);
        return { feet: new Vector3(0, 0, 0), yaw: Math.PI / 2, killer: new Vector3(-0.9, 0, 0), ceiling: null };
      },
    },
    {
      name: 'open street',
      build: (s) => {
        car(s, 4, 2, 0);
        return { feet: new Vector3(0, 0, 0), yaw: 0.7, killer: new Vector3(0.6, 0, -0.6), ceiling: null };
      },
    },
  ];
  for (const d of deaths) {
    for (let run = 0; run < RUNS; run++) {
      const s = scene();
      const { feet, yaw, killer, ceiling } = d.build(s);
      const rd = playerRagdoll(feet, yaw, 1, new Vector3(), killer, near(s, feet.x, feet.z), seeded(run * 31 + d.name.length));
      const ragdolls = new Ragdolls();
      ragdolls.add(rd, true);
      const eye = feet.clone().add(new Vector3(0, 1.6, 0));
      const eyeQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
      const cam = new DeathCamera(deathSurroundings(s.world, feet.y, ceiling, s.crowns), eye, eyeQ, yaw, rd.poses[1].p);
      let bad = 0;
      let jump = 0;
      let lowPart = Infinity;
      let inWall = 0;
      const prev = cam.position.clone();
      let frames = 0;
      while (!cam.done && frames < 660) {
        ragdolls.update(1 / 60);
        cam.update(1 / 60, rd.poses[1].p);
        frames++;
        const p = cam.position;
        let inside = p.y < feet.y + 0.1 || (ceiling !== null && p.y > ceiling - 0.08);
        for (const b of s.boxes) if (depth(b, p) > -0.08) inside = true;
        for (let i = 0; i < s.crowns.length; i += 4) if (Math.hypot(p.x - s.crowns[i], p.y - s.crowns[i + 1], p.z - s.crowns[i + 2]) < s.crowns[i + 3]) inside = true;
        if (inside) bad++;
        jump = Math.max(jump, p.distanceTo(prev));
        prev.copy(p);
        corners(rd, FIGURE_SHAPE, 1, (c) => {
          lowPart = Math.min(lowPart, c.y - feet.y);
          for (const b of s.boxes) if (b.maxY < feet.y + 0.2 ? false : depth(b, c) > 0.04) inWall++;
        });
      }
      if (run === 0 || bad || inWall) {
        check(bad === 0 && cam.done && frames <= 600 && jump < 0.2, `player dies ${d.name} (#${run + 1}): camera never inside anything (${bad} frames), black after ${(frames / 60).toFixed(1)} s, top ${cam.position.y.toFixed(1)} m, biggest step ${(jump * 100).toFixed(0)} cm`);
        check(lowPart >= -0.03 && inWall === 0, `  …body not under the floor (${lowPart.toFixed(3)} m) nor in a wall (${inWall} corners)`);
      }
    }
  }

  console.log(fails.length ? `\ntest:ragdoll FAILED (${fails.length})` : '\ntest:ragdoll passed');
  return fails.length ? 1 : 0;
}
