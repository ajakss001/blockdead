/**
 * Hordes, without the game (`node tools/vite-run.mjs src/debug/hordeTest.ts`): groups gather round the
 * player, a loud noise draws the near ones, they spill only what the crowd can take, never in view
 * (nothing appears nearer than the hold distance), and the rest waits out in the fog.
 */
import { HORDE, Hordes } from '../systems/Hordes';

let failed = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failed++;
};

const h = new Hordes(7);
let room = 30;
let spilled = 0;
let nearest = Infinity;
const spill = (x: number, z: number) => {
  spilled++;
  nearest = Math.min(nearest, Math.hypot(x, z));
  return true;
};
h.update(1 / 60, 0, 0, 0, spill);
check(h.list.length === HORDE.groups, `${h.list.length} groups, ${h.total} zombies`);
const far = Math.min(...h.list.map((g) => Math.hypot(g.x, g.z)));
check(far >= HORDE.bornMin - 1, `nearest group ${far.toFixed(0)} m (gathers ≥ ${HORDE.bornMin})`);
h.hear(0, 0, 70);
const drawn = h.list.filter((g) => g.drawn).length;
check(drawn > 0, `${drawn} groups heard a siren (70 m → ${70 * HORDE.carry} m)`);
for (let t = 0; t < 60 * 60 * 8; t++) {
  const before = spilled;
  h.update(1 / 60, 0, 0, room, spill);
  room -= spilled - before;
}
check(spilled > 0 && spilled <= 30, `spilled ${spilled} (the crowd's room: 30)`);
check(nearest >= HORDE.hold - 5, `nothing appeared nearer than ${nearest.toFixed(0)} m`);
// No room, a noise every 30 s: the groups come and wait at the edge.
for (let t = 0; t < 60 * 60 * 6; t++) {
  if (t % 1800 === 0) h.hear(0, 0, 70);
  h.update(1 / 60, 0, 0, 0, spill);
}
const waiting = Math.min(...h.list.map((g) => Math.hypot(g.x, g.z)));
check(waiting >= HORDE.hold - 1, `the rest waits at ${waiting.toFixed(0)} m`);
if (failed) {
  throw new Error(`hordes: ${failed} failed`);
}
console.log('hordes: passed');
