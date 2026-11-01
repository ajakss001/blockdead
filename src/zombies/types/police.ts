import { Matrix4 } from 'three';
import type { ZombieType } from '../buildZombie';
import { Body, kindNumbers, shade, splotch } from './common';

/**
 * Police officer (refs/zombie_police.jpg): stocky with a round belly, a medium stoop. A peaked cap knocked
 * askew, a radio on the left shoulder, a badge, sunglasses on the pocket; the sleeves rolled up, the shirt
 * out on the left; a duty belt with pouches and an empty holster on the right; black shoes.
 */
const NAVY = 0x232e45;
const GRIME = 0x4a5048;
const PEAK = 0x1a1a1a;
const GOLD = 0xd4a93a;
const BELT = 0x1d1d1d;
const STEEL = 0xb8bec4;

export const POLICE: ZombieType = {
  id: 'police',
  name: 'Полицейский',
  proportions: { height: 1.75, shoulders: 1.02, arms: 1.0, girth: 1.25, stoop: 0.5, neck: 0.9, head: 1.25, jawOpen: 0.03 },
  missing: [],
  ...kindNumbers('police'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 1.15);
    const cloth = splotch([GRIME, shade(NAVY, 0.8)], 10, 0.12);
    const t = b.torso({ top: NAVY, topPaint: cloth, seat: NAVY, belly: 0.75 });
    // Shirt: pockets, a badge on the left, sunglasses hooked on the right pocket, epaulettes, a collar.
    for (const s of [-1, 1]) {
      b.add('Chest', shade(NAVY, 0.88), k.box(0.07, 0.07, 0.012, [0.085 * s, t.h * 0.52, -t.dz - 0.014], [0.12, 0, 0]), false);
      b.add('Chest', shade(NAVY, 1.15), k.box(0.06, 0.012, 0.1, [t.w * 0.72 * s, t.h - 0.005, 0.0]), false);
    }
    b.add('Chest', GOLD, k.cone(0.026, 0.05, [-0.085, t.h * 0.66, -t.dz - 0.026], [Math.PI / 2, 0, 0], 5), false);
    for (const x of [0.07, 0.1]) b.add('Chest', 0x1e1e22, k.dot([0.016, 0.018, 0.005], [x, t.h * 0.4, -t.dz - 0.026]), false);
    b.add('Chest', NAVY, k.barrel(0.076, 0.07, 0.04, 1.15, [0, t.h + 0.005, 0.01], [0, 0, 0], 8));
    // Radio on the left shoulder, its antenna and coiled lead.
    b.add('Chest', 0x1f1f1f, k.box(0.04, 0.07, 0.026, [-t.w * 0.62, t.h - 0.03, -t.dz - 0.01], [0.2, 0, 0]));
    b.add('Chest', 0x1f1f1f, k.rod([-t.w * 0.62 - 0.01, t.h + 0.0, -t.dz - 0.012], [-t.w * 0.62 - 0.012, t.h + 0.07, -t.dz - 0.01], 0.004, 0.003, 3), false);
    b.add('Chest', 0x1f1f1f, k.rod([-t.w * 0.62, t.h - 0.07, -t.dz - 0.01], [-t.w * 0.85, t.h * 0.2, -t.dz * 0.4], 0.005, 0.005, 3), false);
    // Duty belt, buckle, pouches, the empty holster on the right; the shirt hangs out on the left.
    const br = t.hipRx + 0.03;
    const bz = t.hipRz + 0.03;
    b.add('Hips', BELT, k.barrel(br, bz, 0.045, 1, [0, 0.04, 0], [0, 0, 0], 12));
    b.add('Hips', STEEL, k.box(0.04, 0.03, 0.01, [0, 0.04, -bz - 0.004]), false);
    for (const a of [-0.6, -1.0, 0.55, 2.4, 3.1, 3.8]) b.add('Hips', BELT, k.box(0.045, 0.05, 0.03, [br * Math.sin(a + Math.PI), 0.035, bz * Math.cos(a + Math.PI)], [0, a, 0]));
    b.add('Hips', 0x262626, k.box(0.03, 0.15, 0.06, [br + 0.012, -0.03, -0.01]));
    b.add('Hips', NAVY, k.box(0.11, 0.1, 0.012, [-br * 0.55, -0.04, -bz + 0.002], [0.12, 0.35, 0.12]));
    b.neck(0.046);
    b.head({ mouth: 'grim', stitches: ['cheekR', 'cheekL'], jaw: 1 });
    // The peaked cap, knocked over to his right.
    const tilt = new Matrix4().makeRotationZ(-0.17).setPosition(0.012, 0.008, 0);
    const cap = (c: number, g: ReturnType<typeof k.box>, line = true) => b.add('Head', c, k.frame(g, tilt), line);
    cap(NAVY, k.barrel(0.104, 0.118, 0.04, 1, [0, 0.175, 0.008], [0, 0, 0], 10));
    cap(NAVY, k.barrel(0.13, 0.142, 0.045, 0.82, [0, 0.215, 0.0], [-0.08, 0, 0], 10));
    cap(shade(NAVY, 1.1), k.ball([0.13, 0.016, 0.142], [0, 0.238, -0.002], [-0.08, 0, 0], 10, 4), false);
    cap(PEAK, k.ball([0.09, 0.008, 0.06], [0, 0.163, -0.11], [0.3, 0, 0], 8, 4));
    cap(PEAK, k.barrel(0.106, 0.12, 0.008, 1, [0, 0.16, 0.008], [0, 0, 0], 10), false);
    cap(GOLD, k.cone(0.02, 0.04, [0, 0.205, -0.142], [Math.PI / 2 + 0.1, 0, 0], 5), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'rolled', cloth: NAVY, clothPaint: cloth, cuff: shade(NAVY, 1.2), jag: s === 'L', r: 0.042 });
    b.legs({ pants: NAVY, r: 0.085 });
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'shoe', color: 0x1a1a1a, sole: 0x111111, sock: NAVY });
    return b.out;
  },
};
