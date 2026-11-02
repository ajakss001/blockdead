import type { ZombieType } from '../buildZombie';
import { Body, kindNumbers, shade, splotch } from './common';

/**
 * Jogger (refs/zombie_jogger.jpg): lean, long legs, nearly upright. A sweatband on a balding head,
 * headphones round the neck; an open teal track jacket with yellow chevrons and cuffs over a vest; teal
 * shorts with a white stripe, white socks, worn trainers.
 */
const TEAL = 0x2fb3a0;
const YELLOW = 0xd9e04a;
const SHORTS = 0x2e9a8c;
const VEST = 0xc9c7b8;
const BAND = 0xe6e2d2;
const GRIME = 0x6e6a3e;
const PHONES = 0x2a2a2a;

export const JOGGER: ZombieType = {
  id: 'jogger',
  name: 'Бегун',
  proportions: { height: 1.8, shoulders: 0.9, arms: 1.0, girth: 0.72, stoop: 0.2, neck: 1.0, head: 0.89, legs: 1.08, jawOpen: 0.2 },
  missing: [],
  ...kindNumbers('jogger'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const jacket = splotch([GRIME, shade(TEAL, 0.8)], 10, 0.2);
    const t = b.torso({ top: VEST, seat: SHORTS });
    // The open jacket over the vest, its chevrons front and back, the zip edges, a collar.
    b.skirt('Chest', TEAL, { y0: t.h, y1: -(d.chestY - d.hipsY) + 0.04, rx: t.w + 0.012, rz: t.dz + 0.016, flare: 0.98, open: 0.55, paint: jacket });
    b.add('Chest', TEAL, k.barrel(0.075, 0.07, 0.05, 1.12, [0, t.h + 0.01, 0.012], [0, 0, 0], 8), true, 0, jacket);
    for (const s of [-1, 1]) {
      b.add('Chest', YELLOW, k.strap([0.07 * s, t.h * 0.75, -t.dz - 0.02], [t.w * 1.02 * s, t.h * 0.95, -t.dz * 0.3], 0.04, 0.006, [0, 0, -1]), false);
      b.add('Chest', YELLOW, k.strap([0, t.h * 0.15, t.dz + 0.018], [t.w * 0.9 * s, t.h * 0.85, t.dz + 0.006], 0.05, 0.006, [0, 0, 1]), false);
      b.add('Chest', 0xe6e6e0, k.box(0.008, t.h * 1.5, 0.008, [0.057 * s, t.h * 0.15, -t.dz - 0.014], [0, 0, 0]), false);
    }
    // Headphones: a band round the back of the neck, a cup each side.
    b.add('Neck', PHONES, k.shell(0.065, 0.06, 0.016, Math.PI * 0.5, Math.PI, [0, 0.0, 0.006], 7), false);
    for (const s of [-1, 1]) {
      b.add('Neck', PHONES, k.barrel(0.032, 0.032, 0.024, 1, [0.064 * s, -0.01, -0.03], [0, 0, Math.PI / 2], 8));
      b.add('Neck', s < 0 ? 0xb04a9a : 0x4ab0c0, k.barrel(0.022, 0.022, 0.006, 1, [0.078 * s, -0.01, -0.03], [0, 0, Math.PI / 2], 7), false);
    }
    b.neck(0.036);
    b.head({ mouth: 'open', stitches: [], cracks: true, jaw: 0.85 });
    // The sweatband round the brow, a teal stripe; a few hairs left.
    b.add('Head', BAND, k.shell(0.106, 0.122, 0.04, 0, Math.PI * 2, [0, 0.15, 0.012], 10));
    b.add('Head', 0x3ab0a6, k.shell(0.108, 0.124, 0.012, 0, Math.PI * 2, [0, 0.15, 0.012], 10), false);
    for (const x of [-0.03, 0.02]) b.add('Head', 0x4a4a3e, k.rod(b.onSkull([x, 1, 0.1], 0.98), b.onSkull([x * 2, 1, 0.3], 1.15), 0.003, 0.0015, 3), false);
    for (const s of ['L', 'R'] as const) {
      b.arm(s, { sleeve: 'long', cloth: TEAL, clothPaint: jacket, cuff: YELLOW, sleeveR: 0.058, jag: s === 'L' });
      b.add(`UpperArm_${s}`, YELLOW, k.box(0.012, 0.11, 0.03, [(s === 'R' ? 1 : -1) * 0.058, -0.12, 0], [0, 0, 0]), false);
    }
    b.legs({ pants: SHORTS, shorts: true, r: 0.066 });
    const thigh = d.hipJointY - d.kneeY;
    for (const [bone, s] of [['UpperLeg_L', -1], ['UpperLeg_R', 1]] as const) b.add(bone, 0xe6e6e0, k.box(0.008, thigh * 0.62, 0.03, [0.073 * s, -thigh * 0.27, 0]), false);
    const shin = d.kneeY - d.ankleY;
    for (const s of ['L', 'R'] as const) {
      b.add(`LowerLeg_${s}`, 0xe6e2d6, k.barrel(0.044, 0.046, 0.1, 1, [0, -shin + 0.06, 0], [0, 0, 0], 7));
      b.foot(s, { kind: 'sneaker', color: 0xc9c6b8, sole: 0xe6e2d6, accent: s === 'L' ? 0xb0403a : 0x3a8a5a, sock: 0xe6e2d6 });
    }
    return b.out;
  },
};
