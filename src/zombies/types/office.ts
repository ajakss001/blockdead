import type { ZombieType } from '../buildZombie';
import { Body, kindNumbers, shade, splotch } from './common';

/**
 * Office worker (refs/zombie_office.jpg): thin, narrow shoulders, a slight stoop. A comb-over on a bald
 * head, broken glasses; a grimy white shirt with long sleeves and a pocket, the red tie thrown back over
 * his left shoulder, a bag's harness on his back; grey trousers, one shoe, a grey sock on the other foot.
 */
const SHIRT = 0xe4e2d6;
const GRIME = 0xa39e7a;
const TIE = 0xa8322e;
const PANTS = 0x5e6455;
const HAIR = 0x6b5034;
const BLACK = 0x2b2b2b;
const FRAME = 0x1e1e1e;
const LENS = 0xcfd8d6;

export const OFFICE: ZombieType = {
  id: 'office',
  name: 'Офисный работник',
  proportions: { height: 1.75, shoulders: 0.84, arms: 1.05, girth: 0.78, stoop: 0.45, neck: 1.15, head: 0.86, jawOpen: 0.22, jawSide: 0.05 },
  missing: [],
  ...kindNumbers('office'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const shirt = splotch([GRIME, shade(GRIME, 1.15)], 10, 0.22);
    const t = b.torso({ top: SHIRT, topPaint: shirt, seat: PANTS });
    // Shirt: collar, buttons, pocket, the tail out over the belt on one side; the belt.
    b.add('Chest', SHIRT, k.barrel(0.07, 0.066, 0.04, 1.15, [0, t.h + 0.005, 0.01], [0, 0, 0], 8));
    for (const s of [-1, 1]) b.add('Chest', SHIRT, k.box(0.045, 0.012, 0.05, [0.03 * s, t.h + 0.012, -0.055], [0.5, 0.4 * s, -0.4 * s]), false);
    b.add('Chest', shade(SHIRT, 0.9), k.box(0.06, 0.065, 0.008, [-0.075, t.h * 0.5, -t.dz - 0.006], [0.1, 0, 0]), false);
    b.add('Hips', BLACK, k.barrel(t.hipRx + 0.006, t.hipRz + 0.006, 0.03, 1, [0, 0.05, 0], [0, 0, 0], 10));
    b.add('Hips', SHIRT, k.box(0.12, 0.09, 0.014, [0.06, 0.0, -t.hipRz - 0.012], [0.1, -0.15, 0.05]), true, 0, shirt);
    // The tie: knot at the collar, over the left shoulder and down the back.
    const fz = -t.dz - 0.014;
    b.add('Chest', TIE, k.box(0.034, 0.032, 0.022, [0, t.h - 0.012, fz + 0.004]));
    b.add('Chest', TIE, k.strap([0, t.h - 0.025, fz], [0.012, t.h * 0.35, fz - 0.004], 0.04, 0.006, [0, 0, -1]));
    b.add('Chest', TIE, k.strap([0, t.h - 0.01, fz], [-0.09, t.h + 0.05, -0.03], 0.055, 0.008, [0, 1, -0.5]));
    b.add('Chest', TIE, k.strap([-0.09, t.h + 0.05, -0.03], [-0.115, t.h + 0.04, 0.05], 0.06, 0.008, [0, 1, 0]));
    b.add('Chest', TIE, k.strap([-0.115, t.h + 0.04, 0.05], [-0.1, t.h * 0.45, t.dz + 0.014], 0.065, 0.008, [-0.1, 0.2, 1]));
    // A bag's harness on the back: two straps over the shoulders and a cross strap.
    for (const s of [-1, 1]) {
      b.add('Chest', BLACK, k.strap([0.07 * s, t.h * 0.1, t.dz + 0.006], [0.075 * s, t.h + 0.02, 0.02], 0.026, 0.008, [0, 0.4, 1]), false);
      b.add('Chest', BLACK, k.strap([0.075 * s, t.h + 0.02, 0.02], [0.08 * s, t.h * 0.55, -t.dz - 0.008], 0.026, 0.008, [0, 0.4, -1]), false);
    }
    b.add('Chest', BLACK, k.box(0.16, 0.025, 0.01, [0, t.h * 0.42, t.dz + 0.01]), false);
    b.neck(0.036);
    b.head({ mouth: 'open', stitches: [], jaw: 0.85 });
    // Comb-over: a thin cap of hair on the back and sides, strands across the bald top.
    b.add('Head', HAIR, k.ball([0.104, 0.1, 0.11], [0, 0.095, 0.03], [-0.5, 0, 0], 9, 5));
    for (const i of [-1, 0, 1]) b.add('Head', HAIR, k.rod(b.onSkull([0.85, 0.55, i * 0.25], 1.03), b.onSkull([-0.55, 0.85, i * 0.3 - 0.1], 1.04), 0.007, 0.004, 3), false);
    // Glasses, the left lens cracked.
    for (const s of [-1, 1]) {
      b.add('Head', FRAME, k.box(0.055, 0.04, 0.008, [0.041 * s, 0.084, -0.122]));
      b.add('Head', LENS, k.box(0.044, 0.03, 0.004, [0.041 * s, 0.084, -0.127]), false, 0.25);
      b.add('Head', FRAME, k.rod([0.068 * s, 0.09, -0.118], [0.1 * s, 0.085, -0.02], 0.004, 0.004, 3), false);
    }
    b.add('Head', FRAME, k.rod([-0.06, 0.098, -0.131], [-0.028, 0.072, -0.131], 0.0022, 0.0022, 3), false);
    b.add('Head', FRAME, k.rod([-0.05, 0.072, -0.131], [-0.03, 0.095, -0.131], 0.0022, 0.0022, 3), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'long', cloth: SHIRT, clothPaint: shirt, cuff: shade(SHIRT, 0.95), sleeveR: 0.06 });
    b.legs({ pants: PANTS, pantsPaint: splotch([shade(PANTS, 0.8)], 10, 0.2), r: 0.07, flare: 1.08 });
    b.foot('R', { kind: 'shoe', color: 0x2a2522, sock: 0x9a9a92 });
    b.foot('L', { kind: 'sock', color: 0x9a9a92, sock: 0x9a9a92 });
    return b.out;
  },
};
