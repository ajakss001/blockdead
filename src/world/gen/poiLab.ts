import * as F from './furniture';
import { spotHash } from './lifeKinds';
import type { Rand } from './pieces';
import type { PoiSite } from './poi';
import { LOT, type Site } from './poiSite';

/**
 * НИИ «Гелиос» — a research lab out in the fields (POI stage 3). One storey, dark inside, and locked up in
 * levels; the way in is a chain of small puzzles, all found in its own rooms:
 *
 *   lobby, security, offices (open) → the lab hall (green card, in a security locker)
 *   → the generator room (blue card, in the lab's sample fridge)
 *   → three fuses (offices, lab hall, generator room) start the generator: the lights come on and the
 *     server room's electronic lock lets go
 *   → the isolation ward: an electronic lock (power) with a code, one digit in each of four notes
 *     (security, lab hall, offices, the server room's printout).
 *
 * The story is in the notes and journals; nothing gory. Medicine and the rare serum in the ward.
 * Local frame as every POI: +Z faces the road, the lot spans ±LOT.
 */
export const LAB_H = 3.4;
const X0 = -20;
const X1 = 20;
const Z0 = -22;
const Z1 = 8;

/** Where the lights hang (local x, z), room by room: the scene lights them once the power is on. */
export const LAB_LIGHTS: [number, number][] = [
  [0, 4],
  [-13, 4],
  [13, 4],
  [-10, -1.5],
  [10, -1.5],
  [-12, -7.5],
  [1, -7.5],
  [13, -7.5],
  [-10, -18],
  [10, -18],
];

/** The isolation cells whose glass is broken (their centres x), by the site (scenario glassBroken). */
export function labBrokenCells(s: PoiSite): number[] {
  const cells = [-15, -5, 5, 15];
  const n = 1 + Math.floor(spotHash(s.i, s.j, 41) * 2);
  const first = Math.floor(spotHash(s.j, s.i, 42) * 4);
  return Array.from({ length: n }, (_, k) => cells[(first + k * 2) % 4]);
}

/** Once the generator runs: red emergency lights turning (local x, y, z) and the torn cables sparking. */
export const LAB_EMERGENCY: [number, number, number][] = [
  [0, LAB_H - 0.2, -1.5],
  [-12, LAB_H - 0.2, -1.5],
  [12, LAB_H - 0.2, -1.5],
  [-15, LAB_H - 0.2, -14],
  [0, LAB_H - 0.2, -14],
  [15, LAB_H - 0.2, -14],
];
export const LAB_SPARKS: [number, number, number][] = [
  [-4.5, 1.6, -0.5],
  [9.5, 1.6, -5],
  [12, 1.6, -12.5],
];

export function lab(S: Site, rand: Rand): void {
  const p = S.p;
  const H = LAB_H;
  const inner = 0xc8ccc8;
  const shell = 0x8a8e8a;

  // Yard: a concrete wall round the lot with the gate to the road, a guard booth, a few cars.
  const fence = 0x7a7a74;
  S.wallX(fence, -LOT, LOT, -LOT, 2.0, [], 'concrete');
  S.wallZ(fence, -LOT, LOT, -LOT, 2.0, [], 'concrete');
  S.wallZ(fence, -LOT, LOT, LOT, 2.0, [], 'concrete');
  S.wallX(fence, -LOT, LOT, LOT, 2.0, [{ at: 0, w: 7, h: 2.1 }], 'concrete');
  p.box(0x9a2a22, 0, 1.0, LOT, 6.6, 0.12, 0.12, 'metal');
  if (p.model('guardBooth', rand, 5.5, 0, LOT - 2.4, 0, 1, 0.72, 0.25)) {
    p.solid(5.5, LOT - 2.4, 2.5, 2.4, 2.4);
  }
  for (let x = -16; x <= 16; x += 3) p.box(0xd8d4c8, x, 0.03, 16, 0.1, 0.005, 4.5, 'asphalt');
  S.car(-14, 16, Math.PI / 2, rand);
  if (rand() < 0.6) S.car(-8, 16, -Math.PI / 2, rand, 'van');
  if (rand() < 0.5) S.car(11, 16, Math.PI / 2, rand);
  // Radio mast behind the building: seen from far off (the landmark).
  p.box(0x5a5e60, 15, 0, -24, 0.5, 22, 0.5, 'metal', true);
  p.box(0x5a5e60, 15, 21, -24, 2.2, 0.3, 2.2, 'metal');
  p.box(0xb03028, 15, 22, -24, 0.3, 0.3, 0.3, 'lamp');

  // Shell: the front with the entrance and windows; the rest blank.
  const windows = [-15, -9, 9, 15];
  S.wallX(shell, X0, X1, Z1, H, [{ at: 0, w: 2.0, h: 2.3 }, ...windows.map((at) => ({ at, w: 3, h: 2.4, sill: 0.9 }))]);
  for (const x of windows) S.paneX(x, Z1, 3, 0.9, 2.4);
  S.doorX(0, Z1, { width: 2.0, style: 'glass' });
  S.wallX(shell, X0, X1, Z0, H);
  S.wallZ(shell, Z0, Z1, X0, H);
  S.wallZ(shell, Z0, Z1, X1, H);
  S.roof(X0, Z0, X1, Z1, H, 0xb8bcb8, 0xd0d4d0, 0x4a4c4e);
  // Sign band: teal with a white stripe (no words, no emblems).
  p.box(0x1e4a4e, 0, H - 1.0, Z1 + 0.12, 9, 0.8, 0.06, 'plaster');
  p.box(0xe0dcd0, 0, H - 0.7, Z1 + 0.16, 8.6, 0.12, 0.02, 'plaster');

  // Front rooms (z 0…8): lobby in the middle, security on the left, offices on the right.
  S.wallZ(inner, 0, Z1, -6, H, [{ at: 4, w: 1.0, h: 2.1 }]);
  S.doorZ(-6, 4);
  S.wallZ(inner, 0, Z1, 6, H, [{ at: 4, w: 1.0, h: 2.1 }]);
  S.doorZ(6, 4);
  S.wallX(inner, X0, X1, 0, H, [{ at: 0, w: 1.8, h: 2.3 }]);
  // Lobby: the reception desk (the institute's booklet on it).
  p.model('receptionDesk', rand, 0, 0, 2.2, 0, 1.3, 0.78, 0.15, true);
  S.container('reception', 0, 1.6, ['labJournal1']);
  // Security: monitors on a desk, staff lockers — one with the green card and the guard's log.
  F.desk(p.at(-15, 6.6, 2), rand, false, true);
  S.retype('labDesk');
  F.officeChair(p.at(-15, 5.7), rand, true);
  const cardLocker = Math.floor(spotHash(S.s.i, S.s.j, 81) * 4);
  for (let k = 0; k < 4; k++) {
    const x = -19 + k * 1.1;
    if (p.model('locker', rand, x, 0, 0.45, 0, 1, 0.55, 0.45)) {
      p.solid(x, 0.45, 0.6, 0.5, 2.0);
    }
    S.container('labLocker', x, 1.1, k === cardLocker ? ['keycardGreen', 'labNote1'] : undefined);
  }
  // Offices: desks and filing cabinets; one desk keeps a fuse and the third digit.
  const desks: [number, number][] = [
    [9, 6.4],
    [13, 6.4],
    [17, 6.4],
    [11, 2.2],
    [16, 2.2],
  ];
  const fuseDesk = Math.floor(spotHash(S.s.j, S.s.i, 82) * desks.length);
  desks.forEach(([x, z], k) => {
    F.desk(p.at(x, z, 2), rand, rand() < 0.4, rand() < 0.4);
    S.retype('labDesk', k === fuseDesk ? ['fuse', 'labNote3'] : undefined);
    F.officeChair(p.at(x, z - 0.9), rand, rand() < 0.4);
  });
  F.filingCabinet(p.at(19.4, 4, 3), rand);

  // Back corridor (z −3…0) and its three doors: the lab hall (green card), the server room (power),
  // the generator room (blue card).
  S.wallX(inner, X0, X1, -3, H, [
    { at: -12, w: 1.0, h: 2.1 },
    { at: 1, w: 1.0, h: 2.1 },
    { at: 13, w: 1.0, h: 2.1 },
  ]);
  S.doorX(-12, -3, { lock: 'labGreen' });
  S.doorX(1, -3, { lock: 'labPower' });
  S.doorX(13, -3, { lock: 'labBlue' });
  S.wallZ(inner, -12, -3, -4, H);
  S.wallZ(inner, -12, -3, 6, H);
  // The ward behind, its door in the server room: power and the code.
  S.wallX(inner, X0, X1, -12, H, [{ at: 1, w: 1.0, h: 2.1 }]);
  S.doorX(1, -12, { lock: 'labIsolation' });

  // Lab hall (x −20…−4, z −12…−3): two benches with glassware, fume hoods, the sample fridge.
  // The fuse, the second digit and the lab journal lie on one of the two benches.
  const keyBench = spotHash(S.s.i, S.s.j, 84) < 0.5 ? 0 : 1;
  [-5.5, -9].forEach((z, k) => {
    let placed = false;
    for (const bx of [-15.2, -13.1, -11.0, -8.9]) {
      placed = p.model('labTable', rand, bx, 0, z, 0, 1, 0.55, 0.45) || placed;
    }
    if (placed) {
      p.solid(-12, z, 9, 1.2, 0.9);
    }
    S.container('labBench', -12, z + 0.9, k === keyBench ? ['fuse', 'labNote2', 'labJournal2'] : undefined);
  });
  for (const x of [-18, -14.5]) {
    p.box(0x9a9e9c, x, 0, -11.5, 2.6, 0.95, 0.8, 'metal', true);
    p.box(0x8a8e8c, x, 0.95, -11.75, 2.6, 1.2, 0.3, 'metal');
    p.box(0x4a5a62, x, 1.0, -11.38, 2.4, 0.9, 0.02, 'glass');
    p.box(0x9a9e9c, x, 2.15, -11.5, 2.6, 0.5, 0.8, 'metal');
  }
  F.fridge(p.at(-19.6, -6.5, 1), rand);
  S.retype('labFridge', ['keycardBlue']);

  // Server room (x −4…6): rows of racks with their LEDs, a terminal; a printout in one rack.
  const racks: number[] = [-3, -1.6, -0.2];
  const printRack = Math.floor(spotHash(S.s.i, S.s.j, 83) * 6);
  let r = 0;
  for (const z of [-6, -9.5]) {
    for (const x of racks) {
      p.box(0x1e2022, x, 0, z, 0.8, 2.1, 1.0, 'metal', true);
      for (let y = 0.4; y < 2; y += 0.35) p.box(rand() < 0.5 ? 0x3a6a3a : 0x6a5a2a, x - 0.25, y, z + 0.51, 0.06, 0.03, 0.01, 'lamp');
      S.container('serverRack', x, z + 0.9, r === printRack ? ['labNote4'] : undefined);
      r++;
    }
  }
  F.desk(p.at(4.5, -5, 3), rand, false, true);
  S.retype('labDesk');

  // Generator room (x 6…20): the generator on its plinth, cable runs, the engineer's cabinet (a fuse).
  p.box(0x3a3c3e, 13, 0, -9, 4.6, 0.25, 2.4, 'concrete', true);
  p.box(0x4a5a4a, 12.4, 0.25, -9, 3.2, 1.5, 1.8, 'metal', true);
  p.box(0x2a2c2e, 14.6, 0.25, -9, 1.0, 1.7, 1.6, 'metal', true);
  p.box(0x8a8a2a, 14.6, 1.2, -8.19, 0.7, 0.5, 0.02, 'metal');
  p.cyl(0x3a3a3a, 11.2, 2.2, -9, 0.15, 1.6, 'metal');
  S.container('generator', 13, -8.4);
  p.box(0x2a2c2e, 8, 2.9, -9, 0.1, 0.1, 6, 'metal');
  p.model('locker', rand, 19.4, 0, -5, Math.PI * 1.5, 1, 0.55, 0.45, true);
  S.container('labTools', 18.6, -5, ['fuse']);

  // Isolation ward (z −22…−12): a corridor along the door, four cells behind glass, beds; the
  // medicine cabinets at the ends — the serum and the last record in one.
  for (const x of [-10, 0, 10]) S.wallZ(inner, Z0, -16, x, H);
  const broken = S.has('glassBroken') ? labBrokenCells(S.s) : [];
  for (const cx of [-15, -5, 5, 15]) {
    // Glass front with a doorway.
    p.box(0x8a9298, cx - 2.6, 0, -16, 4.8, 0.9, 0.12, 'metal', true);
    if (!broken.includes(cx)) p.box(0x6a7a84, cx - 2.6, 0.9, -16, 4.8, 1.4, 0.03, 'windowGlass', true);
    p.box(0x8a9298, cx - 2.6, 2.3, -16, 4.8, H - 2.3, 0.12, 'metal');
    p.box(0x8a9298, cx + 3.3, 2.1, -16, 3.4, H - 2.1, 0.12, 'metal');
    F.bed(p.at(cx - 2, -21.8, 0), rand, 1.0, rand() < 0.6);
  }
  p.model('pharmacyShelf', rand, X0 + 0.6, 0, -13.5, Math.PI / 2, 1.1, 0.65, 0.35, true);
  S.container('isolation', X0 + 1.4, -13.5);
  p.model('pharmacyShelf', rand, X1 - 0.6, 0, -13.5, -Math.PI / 2, 1.1, 0.65, 0.35, true);
  S.container('isolation', X1 - 1.4, -13.5, ['serumG7', 'labJournal3']);
  // Torn cables hanging from the ceiling (they spark once the power is back), the emergency lamps' housings.
  for (const [x, y, z] of LAB_SPARKS) {
    p.rbox(0x1a1a1a, x, (H + y) / 2, z, 0.035, H - y, 0.035, 0, 0.12, 0.08, 'rubber');
    p.box(0x8a5a2a, x, y - 0.04, z, 0.05, 0.06, 0.05, 'metal');
  }
  for (const [x, y, z] of LAB_EMERGENCY) p.box(0x5a1e1a, x, y + 0.05, z, 0.22, 0.15, 0.22, 'lamp');
}
