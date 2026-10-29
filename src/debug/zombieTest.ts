import { Vector3 } from 'three';
import { type PlayerSense, type ZombieWorld, ZombieSim } from '../systems/zombies';

/**
 * npm run test:zombies — perception and behaviour on a flat test ground with one wall (x 4..5, z −20..20).
 */
const wall = { minX: 4, maxX: 5, minZ: -20, maxZ: 20 };
const world: ZombieWorld = {
  groundY: () => 0,
  resolveCircle(p, r) {
    if (p.z < wall.minZ || p.z > wall.maxZ) return;
    if (p.x > wall.minX - r && p.x < wall.maxX + r) p.x = p.x < (wall.minX + wall.maxX) / 2 ? wall.minX - r : wall.maxX + r;
  },
  rayHit(ox, _oy, oz, dx, _dy, dz, max) {
    // Only the wall's x slab matters on this ground.
    if (Math.abs(dx) < 1e-9) return -1;
    for (const x of [wall.minX, wall.maxX]) {
      const t = (x - ox) / dx;
      if (t > 0 && t < max) {
        const z = oz + dz * t;
        if (z >= wall.minZ && z <= wall.maxZ) return t;
      }
    }
    return -1;
  },
};

function player(x: number, z: number, o: Partial<PlayerSense> = {}): PlayerSense {
  return { pos: new Vector3(x, 0, z), eye: 1.6, noise: 0, crouched: false, lit: 0, daylight: 1, ...o };
}

function run(sim: ZombieSim, p: PlayerSense, seconds: number): void {
  for (let i = 0; i < seconds * 60; i++) sim.update(1 / 60, p);
}

export function main(): number {
  const fails: string[] = [];
  const check = (ok: boolean, what: string) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
    if (!ok) fails.push(what);
  };

  // 1. Seen by day in front at 10 m → follows within 2 s.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0; // looking +Z
    const p = player(0, 10);
    let t = 0;
    while (z.state !== 'chase' && t < 3) {
      sim.update(1 / 60, p);
      t += 1 / 60;
    }
    check(z.state === 'chase' && t < 2, `seen by day at 10 m → follows (${t.toFixed(2)} s)`);
    run(sim, p, 3);
    check(Math.hypot(z.pos.x - p.pos.x, z.pos.z - p.pos.z) < 7, 'follows: closes in on the player');
  }
  // 2. Behind its back, quiet → not noticed.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0;
    z.timer = 99;
    run(sim, player(0, -8, { noise: 0.05 }), 4);
    check(z.state !== 'chase' && z.state !== 'investigate', 'quiet behind its back → not noticed');
  }
  // 3. Night, 20 m, no light → not seen; with the flashlight → seen.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0;
    z.timer = 99;
    run(sim, player(0, 20, { daylight: 0 }), 4);
    check(z.state !== 'chase', 'night, 20 m, dark → not seen');
    run(sim, player(0, 20, { daylight: 0, lit: 1 }), 4);
    check(z.state === 'chase', 'night, 20 m, flashlight on → seen');
  }
  // 4. Crouching shortens sight: night 9 m crouched, dark → not seen.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0;
    z.timer = 99;
    run(sim, player(0, 9, { daylight: 0, crouched: true }), 4);
    check(z.state !== 'chase', 'night, 9 m, crouched → not seen');
  }
  // 5. A wall between → not seen even by day.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = Math.PI / 2; // looking +X, through the wall
    z.timer = 99;
    run(sim, player(10, 0), 3);
    check(z.state !== 'chase' && !z.sees, 'wall between → not seen');
  }
  // 6. Sprinting 15 m behind it → hears, comes to look (not straight onto the player).
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0;
    run(sim, player(0, -15, { noise: 0.8 }), 0.5);
    check(z.state === 'investigate', 'sprint 15 m away → investigates');
    run(sim, player(0, -15, { noise: 0 }), 12);
    check(Math.hypot(z.pos.x, z.pos.z + 15) < 6, 'walks to where the noise was');
  }
  // 7. Walking 15 m away → too quiet to hear.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0;
    z.timer = 99;
    run(sim, player(0, -15, { noise: 0.3 }), 2);
    check(z.state !== 'investigate', 'walking 15 m away → not heard');
  }
  // 8. Losing sight → goes to the last place, looks, gives up.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = 0;
    run(sim, player(0, 8), 2);
    const sawChase = z.state === 'chase';
    // The player steps behind the wall far away.
    run(sim, player(12, 30, { daylight: 0 }), 30);
    check(sawChase && z.state !== 'chase', 'lost sight → stops following');
  }
  // 9. A groan of alarm draws the ones near it.
  {
    const sim = new ZombieSim(world, 0);
    const a = sim.spawnAt(0, 0);
    const b = sim.spawnAt(-4, -4);
    a.yaw = 0;
    b.yaw = Math.PI; // looking away
    b.timer = 99;
    run(sim, player(0, 9), 2);
    check(a.state === 'chase' && (b.state === 'investigate' || b.state === 'chase'), 'alarm groan → the one nearby comes too');
  }
  // 10. Population: reaches the target, never pops in in front of the player, drops the far ones.
  {
    const sim = new ZombieSim(world, 20);
    const view = new Vector3(0, 0, 1);
    const p = player(0, 60);
    let front = 0;
    for (let i = 0; i < 60 * 20; i++) {
      const before = sim.list.length;
      sim.update(1 / 60, p, view);
      if (sim.list.length > before) {
        const z = sim.list[sim.list.length - 1];
        const dx = z.pos.x - p.pos.x;
        const dz = z.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 56 && dz / d > 0.35) front++;
      }
    }
    check(sim.list.length === 20, `population reaches 20 (${sim.list.length})`);
    check(front === 0, 'no spawns in view nearby');
    run(sim, player(0, 400), 1);
    check(sim.list.length <= 20 && sim.list.every((z) => Math.hypot(z.pos.x, z.pos.z - 400) <= 95 || z.state === 'chase'), 'far ones dropped');
  }
  console.log(fails.length ? `\ntest:zombies FAILED (${fails.length})` : '\ntest:zombies passed');
  return fails.length ? 1 : 0;
}
