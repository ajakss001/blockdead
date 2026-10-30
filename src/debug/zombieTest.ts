import { Vector3 } from 'three';
import { blowDamage, type PlayerSense, type ZombieWorld, ZombieSim } from '../systems/zombies';
import { CollisionWorld } from '../world/CollisionWorld';
import { InputManager } from '../input/InputManager';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { PlayerController } from '../player/PlayerController';
import { Survival } from '../systems/Survival';
import { ITEMS } from '../data/items';

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
  // 11. Behind a wall, noisy → comes to look, never follows (no sight through the wall).
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0);
    z.yaw = Math.PI / 2;
    run(sim, player(10, 0, { noise: 0.6 }), 6);
    check(z.state !== 'chase' && z.state !== 'attack', 'noise behind a wall → searches, does not follow');
  }
  // 12. Out of sight: after ~5 s off to the last place, searches 10–15 s, then gives up.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0, 'idle', 'man');
    z.yaw = 0;
    run(sim, player(0, 8), 2);
    const chased = z.state === 'chase';
    // The player is suddenly far behind the wall, in the dark (never seen again).
    let tSearch = -1;
    let tIdle = -1;
    for (let i = 0; i < 60 * 40; i++) {
      sim.update(1 / 60, player(30, 30, { daylight: 0 }));
      if (tSearch < 0 && z.state === 'search') tSearch = i / 60;
      if (tSearch >= 0 && tIdle < 0 && (z.state === 'idle' || z.state === 'wander')) tIdle = i / 60;
    }
    check(chased && tSearch >= 0 && tSearch <= 6.5, `out of sight → searches after ${tSearch.toFixed(1)} s (≤ ~5 s + walk)`);
    check(tIdle >= 0 && tIdle - tSearch >= 9.5 && tIdle - tSearch <= 15.5, `searches ${(tIdle - tSearch).toFixed(1)} s, then loses interest`);
  }
  // 13. Slower than the player's run (4.6 m/s): even a teen.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0, 'chase', 'teen');
    z.yaw = 0;
    z.awareness = 2;
    let max = 0;
    for (let i = 0; i < 300; i++) {
      sim.update(1 / 60, player(0, 10 + i * 0.05));
      max = Math.max(max, z.speed);
    }
    check(max > 1.5 && max < 4.6 * 0.6, `a teen follows at ${max.toFixed(2)} m/s: quicker than the others, slower than the run`);
  }
  // 14. Head ×2, and the hit test finds the head.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, -1.5, 'idle', 'man');
    const head = sim.hitTest(new Vector3(0, 1.63, 0), new Vector3(0, 0, -1), 2);
    const body = sim.hitTest(new Vector3(0, 1.0, 0), new Vector3(0, 0, -1), 2);
    check(head?.zombie === z && head.head && body?.zombie === z && !body.head, 'hit test: head at the top, body below');
    check(blowDamage([20, 20], 1, true, 0) === 2 * blowDamage([20, 20], 1, false, 0), 'blow to the head = ×2');
    sim.hit(z, blowDamage([35, 45], 1, true, 1), 0, 0);
    const after = z.hp;
    z.state = 'idle';
    sim.hit(z, blowDamage([35, 45], 1, false, 0), 0, 0);
    check(after === 10 && (z.state as string) === 'dead', `axe to the head: 100 → ${after} HP, the next blow kills`);
  }
  // 15. Bites: close and seen → it attacks, the blow reaches the player.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(0, 0, 'idle', 'man');
    z.yaw = 0;
    let bites = 0;
    for (let i = 0; i < 60 * 4; i++) {
      sim.update(1 / 60, player(0, 0.9));
      bites += sim.attacks.length;
    }
    check(bites >= 1, `close → bites (${bites} in 4 s)`);
  }
  // 16. Jumping at a wall and under a lintel: no passing through, the head stops under it.
  {
    const cw = new CollisionWorld();
    cw.addBox(1, -3, 1.3, 3, 0, 3); // a wall at x 1..1.3
    cw.addBox(-3, 3, 3, 3.3, 2.1, 3); // a lintel over a doorway along x at z 3..3.3, from 2.1 m up
    const input = new InputManager('kbm', new EventBus<GameEvents>());
    const c = new PlayerController(new Vector3(0, 0, 0), -Math.PI / 2); // facing +X
    const ground = () => 0;
    let maxX = 0;
    for (let i = 0; i < 120; i++) {
      input.setMove(0, 1);
      if (i % 30 === 0) input.press('jump');
      c.fixedUpdate(1 / 60, input, cw, ground);
      input.release('jump');
      maxX = Math.max(maxX, c.position.x);
    }
    check(maxX < 1 - 0.29, `jumping at a wall: stays in front of it (x ${maxX.toFixed(2)})`);
    const d = new PlayerController(new Vector3(0, 0, 3.15), 0);
    let headTop = 0;
    for (let i = 0; i < 60; i++) {
      input.setMove(0, 0);
      if (i === 0) input.press('jump');
      d.fixedUpdate(1 / 60, input, cw, ground);
      input.release('jump');
      headTop = Math.max(headTop, d.position.y + 1.78);
    }
    check(headTop <= 2.1 + 1e-3 || d.position.z < 3 - 0.29 || d.position.z > 3.3 + 0.29, `jumping under a lintel: the head stops under it (top ${headTop.toFixed(2)})`);
  }
  // 17. Bites: clothes can stop them; a bite always infects; early antibiotics cure, late ones only slow;
  //     left alone the infection kills in about an hour of real time.
  {
    const env = { felt: 20, dark: false, batteryDead: false };
    const a = new Survival();
    check(a.bitten('arms', 0.9, 0.5, 0.2) === 'blocked' && a.wounds.length === 0 && a.infection === 0, 'thick sleeves: the teeth do not get through');
    const b = new Survival();
    check(b.bitten('legs', 0, 0.5, 0.2) === 'bite' && b.wounded && b.infection > 0, 'a bite: a bleeding wound and the infection');
    b.consume(ITEMS.bandage);
    check(!b.wounded, 'a bandage stops the bleeding');
    b.consume(ITEMS.antibiotics);
    check(b.infection === 0, 'antibiotics early: cured');
    const c = new Survival();
    c.bitten('torso', 0, 0.5, 0.2);
    c.infection = 0.5;
    c.consume(ITEMS.antibiotics);
    check(c.infection > 0 && c.infection < 0.5, `antibiotics late: only slowed (${c.infection.toFixed(2)})`);
    const d = new Survival();
    d.bitten('head', 0, 0.5, 0.2);
    d.wounds.length = 0;
    let t = 0;
    while (d.health > 0 && t < 7200) {
      d.hunger = 0.1;
      d.thirst = 0.1;
      d.update(1, 0, false, env);
      t += 1;
    }
    check(d.health <= 0 && t > 2700 && t < 3700, `untreated infection (~2 in-game days): dead after ${(t / 60).toFixed(0)} min`);
  }
  // 18. A noise in the world (crows taking off, a car alarm): zombies in range go and look, others don't.
  {
    const sim = new ZombieSim(world, 0);
    const near = sim.spawnAt(-8, 0);
    const far = sim.spawnAt(-60, 0);
    const p = player(-8, -30);
    sim.noiseAt(-2, 0, 6, 24);
    check(near.state === 'investigate' && far.state !== 'investigate', 'a crow racket: the zombie 10 m off goes to look, the one 58 m off does not');
    const d0 = Math.hypot(near.pos.x + 2, near.pos.z - 6);
    run(sim, p, 12);
    const d1 = Math.hypot(near.pos.x + 2, near.pos.z - 6);
    check(d1 < Math.min(4, d0 - 4), `it walks to where the noise was (${d0.toFixed(1)} → ${d1.toFixed(1)} m)`);
  }
  // 19. Killed with a wall right behind it: the body falls the clear way, never through the wall; with
  //     the wall close on every side it would slump — out in the open it falls flat.
  {
    const sim = new ZombieSim(world, 0);
    const z = sim.spawnAt(3.2, 0);
    sim.hit(z, 500, 1.5, 0);
    const dx = -Math.sin(z.yaw);
    const reach = z.pos.x + dx * 1.75;
    run(sim, player(-20, -30), 3);
    check(z.state === 'dead' && reach < 4 && z.fall > 0.95, `wall behind: falls away from it (head ends at x ${reach.toFixed(2)} < 4, fallen ${z.fall.toFixed(2)})`);
    const o = sim.spawnAt(-10, 10);
    sim.hit(o, 500, -11, 10);
    run(sim, player(-20, -30), 3);
    check(o.fallMax === 1 && o.fall > 0.95, 'in the open: falls flat, straight away from the blow');
  }
  console.log(fails.length ? `\ntest:zombies FAILED (${fails.length})` : '\ntest:zombies passed');
  return fails.length ? 1 : 0;
}
