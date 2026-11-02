import type { ZombieType } from '../buildZombie';
import { Body, dome, kindNumbers, shade, splotch } from './common';

/**
 * Courier (refs/zombie_courier.jpg): an ordinary build leaning well forward. A yellow cap turned backwards
 * with hair sticking out; a quilted yellow jacket with torn cuffs and a badge on a lanyard; a big square
 * delivery box on his back with a reflective band; jeans torn at the right knee, worn canvas shoes.
 */
const YELLOW = 0xe8c82e;
const DIRT = 0x8a8a3a;
const BOX = 0xe2c52e;
const BAND = 0x9a9c98;
const STRAP = 0x2b2b2b;
const JEANS = 0x4a6a96;
const HAIR = 0x3a3a32;

export const COURIER: ZombieType = {
  id: 'courier',
  name: 'Курьер',
  proportions: { height: 1.78, shoulders: 0.95, arms: 1.03, girth: 0.92, stoop: 0.75, neck: 1.1, head: 0.88, jawOpen: 0.15 },
  missing: [],
  ...kindNumbers('courier'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const dirt = splotch([DIRT, shade(DIRT, 0.8)], 10, 0.2);
    const w = b.chestW + 0.022;
    const t = b.torso({ top: YELLOW, topPaint: dirt, seat: JEANS, w, dz: b.chestDz + 0.022 });
    // Quilted jacket: seams round the body, a zip, a puffed collar, the hem over the hips.
    for (const y of [0.25, 0.6]) b.add('Chest', shade(YELLOW, 0.82), k.shell(t.w * (0.96 - y * 0.1) + 0.004, t.dz + 0.004, 0.012, 0, Math.PI * 2, [0, t.h * y, 0], 10), false);
    b.add('Chest', 0x6a6a5a, k.box(0.008, t.h + 0.03, 0.008, [0, t.h * 0.45, -t.dz - 0.004]), false);
    b.add('Chest', YELLOW, k.barrel(0.082, 0.078, 0.055, 1.12, [0, t.h + 0.012, 0.012], [0, 0, 0], 8), true, 0, dirt);
    b.skirt('Hips', YELLOW, { y0: 0.07, y1: -0.06, rx: t.hipRx + 0.022, rz: t.hipRz + 0.022, flare: 1.04, paint: dirt });
    // Lanyard and badge.
    b.add('Chest', 0x2a3a6a, k.rod([-0.05, t.h + 0.01, -0.05], [-0.06, t.h * 0.5, -t.dz - 0.012], 0.003, 0.003, 3), false);
    b.add('Chest', 0x2a3a6a, k.rod([0.05, t.h + 0.01, -0.05], [-0.06, t.h * 0.5, -t.dz - 0.012], 0.003, 0.003, 3), false);
    b.add('Chest', 0xf2f2ec, k.box(0.036, 0.05, 0.005, [-0.06, t.h * 0.42, -t.dz - 0.014]), false);
    // The delivery box on its straps.
    const bz = t.dz + 0.17;
    b.add('Chest', BOX, k.box(0.4, 0.4, 0.3, [0, t.h * 0.35, bz]), true, 0, splotch([DIRT], 9, 0.12));
    b.add('Chest', BAND, k.box(0.404, 0.04, 0.304, [0, t.h * 0.35 - 0.06, bz]), false);
    b.add('Chest', 0xf2f2ec, k.box(0.09, 0.06, 0.004, [0.09, t.h * 0.35 + 0.1, bz + 0.152]), false);
    b.add('Chest', shade(BOX, 0.85), k.box(0.36, 0.012, 0.004, [0, t.h * 0.35 + 0.17, bz - 0.152]), false);
    for (const s of [-1, 1]) {
      b.add('Chest', STRAP, k.strap([0.085 * s, t.h * 0.0, -t.dz - 0.01], [0.09 * s, t.h + 0.03, -0.01], 0.035, 0.01, [0, 0.4, -1]), false);
      b.add('Chest', STRAP, k.strap([0.09 * s, t.h + 0.03, -0.01], [0.09 * s, t.h * 0.6, t.dz + 0.02], 0.035, 0.01, [0, 0.4, 1]), false);
    }
    b.neck(0.04);
    b.head({ mouth: 'open', stitches: ['cheekR'], jaw: 0.9 });
    // The cap, peak to the back; hair sticking out at the sides and front.
    b.hair(HAIR, { front: -0.2, puff: 1.04 });
    b.add('Head', YELLOW, dome([0.112, 0.085, 0.124], [0, 0.145, 0.012], [0.1, 0, 0], 0.52, 9, 4), true, 0, splotch([DIRT], 12, 0.15));
    b.add('Head', YELLOW, k.ball([0.085, 0.008, 0.07], [0, 0.15, 0.14], [-0.2, 0, 0], 8, 4));
    b.add('Head', shade(YELLOW, 0.8), k.dot([0.012, 0.008, 0.012], [0, 0.232, 0.012]), false);
    for (const [x, z] of [[-0.06, -0.09], [0.0, -0.11], [0.07, -0.085]]) b.add('Head', HAIR, k.cone(0.014, 0.04, [x, 0.17, z], [-1.1, 0, x * 3], 3), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'long', cloth: YELLOW, clothPaint: dirt, cuff: shade(YELLOW, 0.85), sleeveR: 0.07, jag: true });
    b.legs({ pants: JEANS, pantsPaint: splotch([shade(JEANS, 0.75), 0x6e6a4a], 10, 0.18), r: 0.078 });
    // The torn knee: skin through a hole, frayed edges; a patch on the left thigh.
    b.add('LowerLeg_R', b.skin, k.ball([0.05, 0.05, 0.02], [0, -0.02, -0.06], [0, 0, 0], 6, 4), false);
    for (const x of [-0.04, 0, 0.04]) b.add('LowerLeg_R', 0xb8c4d8, k.cone(0.01, 0.025, [x, 0.03, -0.068], [Math.PI, 0, 0], 3), false);
    b.add('UpperLeg_L', shade(JEANS, 1.25), k.box(0.06, 0.06, 0.008, [0.0, -0.2, -0.078]), false);
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'sneaker', color: 0x8e8a78, sole: 0xd9d6c8, sock: 0xd9d6c8 });
    return b.out;
  },
};
