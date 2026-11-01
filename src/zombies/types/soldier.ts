import type { ZombieType } from '../buildZombie';
import { Body, check, dome, kindNumbers, shade, splotch } from './common';

/**
 * Soldier (refs/zombie_soldier.jpg): tall, broad, muscular, nearly upright, a heavy square jaw. A netted
 * helmet with goggles on it; camouflage shirt and trousers, the right sleeve rolled up; a plate carrier with
 * pouches and a patch, dog tags on a chain, thigh pockets, tall laced boots.
 */
const CAMO = 0x5b6b3a;
const CAMO_DARK = 0x3c4a28;
const CAMO_LIGHT = 0x7d8a4e;
const HELMET = 0x56653a;
const NET = 0x3a4526;
const VEST = 0x3e4a2e;
const POUCH = 0x46532f;
const STRAP = 0x2a2e22;
const BOOT = 0x24221f;
const BLACK = 0x2b2b2b;

export const SOLDIER: ZombieType = {
  id: 'soldier',
  name: 'Военный',
  proportions: { height: 1.9, shoulders: 1.15, arms: 1.05, girth: 1.15, stoop: 0.15, neck: 0.85, head: 1.25, jawOpen: 0.03 },
  missing: [],
  ...kindNumbers('soldier'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 1.2);
    const camo = splotch([CAMO_DARK, CAMO_LIGHT], 15, 0.6);
    const t = b.torso({ top: CAMO, topPaint: camo, seat: CAMO, seatPaint: camo });
    // Plate carrier: front and back plates over the chest and belly, pouches, a patch, a belt.
    const vz = t.dz + 0.028;
    b.add('Chest', VEST, k.barrel(t.w + 0.022, vz, t.h - 0.04, 0.96, [0, (t.h - 0.04) / 2 - 0.03, 0], [0, 0, 0], 8));
    b.add('Spine', VEST, k.barrel(t.w * 0.9 + 0.024, vz - 0.004, t.len * 0.8, 1, [0, t.len * 0.55, 0], [0, 0, 0], 8));
    for (const s of [-1, 1]) {
      b.add('Chest', VEST, k.box(0.05, 0.03, 0.12, [t.w * 0.55 * s, t.h - 0.01, 0]));
      for (const x of [0.05, 0.135]) b.add('Chest', POUCH, k.box(0.07, 0.085, 0.04, [x * s, 0.04, -vz - 0.016]));
    }
    b.add('Chest', 0x8a8f95, k.box(0.07, 0.045, 0.006, [-0.1, t.h * 0.62, -vz - 0.004]), false);
    b.add('Chest', POUCH, k.box(0.2, 0.05, 0.012, [0, t.h * 0.66, vz + 0.006]), false);
    b.add('Chest', POUCH, k.box(0.18, 0.03, 0.012, [0, t.h * 0.35, vz + 0.006]), false);
    b.add('Hips', STRAP, k.barrel(t.hipRx + 0.01, t.hipRz + 0.01, 0.04, 1, [0, 0.05, 0], [0, 0, 0], 10));
    // Collar and dog tags.
    b.add('Chest', CAMO, k.barrel(0.075, 0.07, 0.04, 1.15, [0, t.h + 0.005, 0.01], [0, 0, 0], 8), true, 0, camo);
    for (const s of [-1, 1]) b.add('Chest', 0x9aa0a6, k.rod([0.05 * s, t.h + 0.0, -0.05], [0.006 * s, t.h * 0.66, -vz - 0.008], 0.0025, 0.0025, 3), false);
    b.add('Chest', 0xb8bec4, k.box(0.024, 0.036, 0.004, [0.008, t.h * 0.6, -vz - 0.012], [0, 0, 0.15]), false);
    b.add('Chest', 0xb8bec4, k.box(0.024, 0.036, 0.004, [-0.01, t.h * 0.58, -vz - 0.016], [0, 0, -0.1]), false);
    b.neck(0.05);
    b.head({ mouth: 'grim', stitches: ['cheekR'], jaw: 1.05 });
    // The helmet: a netted dome with a rim, goggles on its strap.
    b.add('Head', HELMET, dome([0.118, 0.11, 0.132], [0, 0.104, 0.008], [0, 0, 0], 0.5, 9, 4), true, 0, check(NET, HELMET, 0.035));
    b.add('Head', HELMET, k.barrel(0.124, 0.138, 0.016, 1.03, [0, 0.104, 0.008], [0, 0, 0], 10));
    b.add('Head', BLACK, k.barrel(0.12, 0.134, 0.02, 1, [0, 0.142, 0.014], [0.06, 0, 0], 10), false);
    for (const s of [-1, 1]) {
      b.add('Head', BLACK, k.box(0.05, 0.036, 0.024, [0.03 * s, 0.15, -0.112], [-0.35, 0.25 * s, 0]));
      b.add('Head', 0x6e7b5a, k.box(0.038, 0.024, 0.008, [0.031 * s, 0.152, -0.126], [-0.35, 0.25 * s, 0]), false);
    }
    b.arm('R', { sleeve: 'rolled', cloth: CAMO, clothPaint: camo, cuff: 0xc8be96, r: 0.046 });
    b.arm('L', { sleeve: 'long', cloth: CAMO, clothPaint: camo, cuff: CAMO_DARK, r: 0.046, sleeveR: 0.072 });
    b.legs({ pants: CAMO, pantsPaint: camo, r: 0.082 });
    const thigh = d.hipJointY - d.kneeY;
    for (const [bone, s] of [['UpperLeg_L', -1], ['UpperLeg_R', 1]] as const)
      b.add(bone, shade(CAMO, 0.9), k.box(0.03, 0.11, 0.1, [0.088 * s, -thigh * 0.55, 0]), true, 0, camo);
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'tall', color: BOOT, sole: 0x161512, accent: 0x4a4740 });
    return b.out;
  },
};
