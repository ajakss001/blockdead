import type { ZombieType } from '../buildZombie';
import { Body, check, dome, kindNumbers, shade, splotch, STITCH } from './common';

/**
 * Builder (refs/zombie_builder.jpg): strong, broad shoulders, thick arms. A cracked yellow hard hat; an
 * orange high-visibility vest with silver bands over a check shirt with the sleeves rolled up; a leather
 * tool belt with pouches; jeans and work boots.
 */
const HAT = 0xe2c22e;
const VEST = 0xf07a1e;
const REFLECT = 0xc9ccc4;
const SHIRT_A = 0x4a6a8a;
const SHIRT_B = 0x8a6a3a;
const LEATHER = 0x8a5e32;
const JEANS = 0x4e6a8e;
const BOOT = 0x5a503a;

export const BUILDER: ZombieType = {
  id: 'builder',
  name: 'Строитель',
  proportions: { height: 1.85, shoulders: 1.12, arms: 1.05, girth: 1.2, stoop: 0.35, neck: 0.9, head: 0.91, jawOpen: 0.08 },
  missing: [],
  ...kindNumbers('builder'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const plaid = check(SHIRT_A, SHIRT_B, 0.045);
    const t = b.torso({ top: SHIRT_A, topPaint: plaid, seat: JEANS });
    // The vest: open at the front, two silver bands round the body, braces over the shoulders.
    const vrx = t.w + 0.016;
    const vrz = t.dz + 0.018;
    b.skirt('Chest', VEST, { y0: t.h - 0.02, y1: -(d.chestY - d.hipsY) + 0.07, rx: vrx, rz: vrz, flare: 0.97, open: 0.32, paint: splotch([shade(VEST, 0.75)], 9, 0.15) });
    for (const y of [0.15, -0.1]) b.add('Chest', REFLECT, k.shell(vrx * (1 - (0.03 * (t.h - y)) / t.h) + 0.004, vrz + 0.004, 0.035, Math.PI + 0.36, Math.PI * 2 - 0.72, [0, y, 0], 10), false);
    for (const s of [-1, 1]) {
      b.add('Chest', VEST, k.strap([0.07 * s, t.h * 0.55, -vrz], [0.085 * s, t.h + 0.03, -0.0], 0.06, 0.012, [0, 0.4, -1]));
      b.add('Chest', VEST, k.strap([0.085 * s, t.h + 0.03, 0.0], [0.08 * s, t.h * 0.55, vrz], 0.06, 0.012, [0, 0.4, 1]));
      b.add('Chest', REFLECT, k.strap([0.07 * s, t.h * 0.55, -vrz - 0.008], [0.085 * s, t.h + 0.04, -0.0], 0.022, 0.006, [0, 0.4, -1]), false);
    }
    b.add('Chest', SHIRT_A, k.barrel(0.075, 0.07, 0.04, 1.15, [0, t.h + 0.005, 0.01], [0, 0, 0], 8), true, 0, plaid);
    // Tool belt: the belt, a buckle, pouches on both hips, a hammer loop.
    const br = t.hipRx + 0.012;
    const bz = t.hipRz + 0.012;
    b.add('Hips', LEATHER, k.barrel(br, bz, 0.05, 1, [0, 0.04, 0], [0, 0, 0], 10));
    b.add('Hips', 0x9aa0a6, k.box(0.045, 0.035, 0.01, [0, 0.04, -bz - 0.004]), false);
    for (const s of [-1, 1]) {
      b.add('Hips', LEATHER, k.box(0.09, 0.12, 0.045, [br * 0.8 * s, -0.04, -bz * 0.62], [0, 0.6 * s, 0]));
      b.add('Hips', shade(LEATHER, 0.8), k.box(0.06, 0.08, 0.035, [br * 1.0 * s, -0.03, 0.0], [0, 0, 0]));
    }
    b.neck(0.05);
    b.head({ mouth: 'open', stitches: ['cheekL', 'brow'], jaw: 1.02 });
    // The hard hat: a dome, a front peak and a short brim; a crack.
    b.add('Head', HAT, dome([0.122, 0.12, 0.134], [0, 0.11, 0.008], [0, 0, 0], 0.5, 9, 4), true, 0, splotch([shade(HAT, 0.75)], 12, 0.12));
    b.add('Head', HAT, k.barrel(0.13, 0.142, 0.012, 1, [0, 0.112, 0.004], [0, 0, 0], 10));
    b.add('Head', HAT, k.ball([0.1, 0.01, 0.06], [0, 0.118, -0.13], [0.15, 0, 0], 8, 4));
    b.add('Head', STITCH, k.rod([0.04, 0.226, -0.06], [0.07, 0.19, -0.03], 0.003, 0.003, 3), false);
    b.add('Head', STITCH, k.rod([0.07, 0.19, -0.03], [0.1, 0.16, -0.04], 0.003, 0.003, 3), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'rolled', cloth: SHIRT_A, clothPaint: plaid, cuff: 0xb9b4a0, r: 0.05, sleeveR: 0.08 });
    b.legs({ pants: JEANS, pantsPaint: splotch([shade(JEANS, 0.75), 0x6e6a4a], 10, 0.2), r: 0.085 });
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'boot', color: BOOT, sole: 0x2e2a22, accent: 0x3a3428 });
    return b.out;
  },
};
