import { Matrix4 } from 'three';
import type { ZombieType } from '../buildZombie';
import { Body, check, flowers, kindNumbers, shade } from './common';

/**
 * Grandma (refs/zombie_grandma.jpg): small, badly hunched, short legs. Hair in coloured curlers, thick
 * round glasses (one lens cracked); a pink flowered housecoat to below the knee with a collar, buttons, a
 * patch and a torn hem; fluffy slippers; a string bag with a loaf in her right hand.
 */
const ROBE = 0xc98289;
const PETAL = 0xf2e2c8;
const HEART = 0xe7c25a;
const COLLAR = 0xe3a5aa;
const HAIR = 0x6b5a44;
const CURLERS = [0xd8607e, 0x5ba3a8, 0xe2cf5a, 0x8e6ab0];
const FRAME = 0x3a3a3a;
const LENS = 0xcfd8d6;
const SLIPPER = 0xc98aa0;
const NET = 0xd9cfae;
const BREAD = 0xd7a050;

/** The flower print. */
const print = flowers(PETAL, HEART, 13, 0.55);

export const GRANDMA: ZombieType = {
  id: 'grandma',
  name: 'Бабушка',
  proportions: { height: 1.5, shoulders: 0.85, arms: 1.0, girth: 0.9, stoop: 1.05, neck: 1.0, head: 0.8, legs: 0.85, jawOpen: 0.12 },
  missing: [],
  ...kindNumbers('grandma'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const t = b.torso({ top: ROBE, topPaint: print, seat: ROBE, seatPaint: print, bust: true });
    // The housecoat's skirt to below the knee, torn; collar, buttons, a patch.
    b.skirt('Hips', ROBE, { y0: 0.06, y1: d.kneeY - d.hipsY - 0.07, rx: t.hipRx + 0.03, rz: t.hipRz + 0.035, flare: 1.32, jag: true, paint: print });
    for (const s of [-1, 1]) b.add('Chest', COLLAR, k.strap([0.02 * s, t.h - 0.02, -t.dz - 0.01], [0.08 * s, t.h + 0.03, -0.02], 0.05, 0.008, [0, 0.4, -1]));
    b.add('Chest', COLLAR, k.barrel(0.074, 0.07, 0.03, 1.15, [0, t.h + 0.01, 0.014], [0, 0, 0], 8), false);
    for (let i = 0; i < 3; i++) b.add('Chest', PETAL, k.dot([0.008, 0.008, 0.004], [0.004, t.h * (0.62 - i * 0.26), -t.dz - 0.012]), false);
    b.add('Hips', shade(ROBE, 0.8), k.box(0.07, 0.07, 0.008, [-(t.hipRx + 0.03) * 0.75, -0.12, -(t.hipRz + 0.04) * 0.85], [0, 0.6, 0.1]), false);
    b.neck(0.034);
    b.head({ mouth: 'open', stitches: ['brow'], jaw: 0.8 });
    // Hair and curlers: rows over the top and back of the head.
    b.hair(HAIR, { front: -0.3, puff: 1.12 });
    const rows: [number, number, number][] = [
      [0, 1, -0.35], [0, 1, 0.25], [0.6, 0.75, -0.3], [-0.6, 0.75, -0.3], [0.6, 0.75, 0.3], [-0.6, 0.75, 0.3],
      [0.9, 0.3, 0.1], [-0.9, 0.3, 0.1], [0.45, 0.5, 0.8], [-0.45, 0.5, 0.8], [0, 0.65, 0.8], [0.3, 0.05, 0.95], [-0.3, 0.05, 0.95],
    ];
    rows.forEach((dir, i) => b.add('Head', CURLERS[i % 4], k.barrel(0.026, 0.026, 0.05, 1, b.onSkull(dir, 1.17), [0, 0, Math.PI / 2], 5), false));
    // Thick round glasses, the right lens cracked.
    for (const s of [-1, 1]) {
      b.add('Head', FRAME, k.frame(k.shell(0.028, 0.028, 0.012, 0, Math.PI * 2, [0, 0, 0], 8), new Matrix4().makeRotationX(Math.PI / 2).setPosition(0.041 * s, 0.084, -0.126)));
      b.add('Head', LENS, k.barrel(0.024, 0.024, 0.006, 1, [0.041 * s, 0.084, -0.13], [Math.PI / 2, 0, 0], 8), false, 0.25);
      b.add('Head', FRAME, k.rod([0.068 * s, 0.09, -0.12], [0.1 * s, 0.085, -0.02], 0.004, 0.004, 3), false);
    }
    b.add('Head', FRAME, k.rod([0.03, 0.1, -0.134], [0.052, 0.07, -0.134], 0.002, 0.002, 3), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'elbow', cloth: ROBE, clothPaint: print, jag: s === 'R', r: 0.034, sleeveR: 0.058 });
    // The string bag with a loaf, hanging from her right hand.
    b.add('Hand_R', NET, k.rod([0, -0.16, -0.02], [0, -0.26, 0.0], 0.004, 0.004, 3), false);
    b.add('Hand_R', NET, k.ball([0.08, 0.1, 0.07], [0, -0.34, 0.0], [0, 0, 0], 6, 4), true, 0, check(NET, 0x8c8470, 0.035));
    b.add('Hand_R', BREAD, k.capsule(0.032, 0.16, [0.01, -0.33, 0.0], [0.4, 0, 0.3], 5));
    b.legs({ pants: 0x8c9a84, shorts: true, r: 0.06 });
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'slipper', color: SLIPPER, sole: shade(SLIPPER, 0.8) });
    return b.out;
  },
};
