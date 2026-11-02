import type { BoneName } from '../skeleton';
import type { ZombieType } from '../buildZombie';
import { Body, dome, kindNumbers, shade, splotch } from './common';

/**
 * Firefighter (refs/zombie_firefighter.jpg): tall and massive in a thick turnout coat, a short neck. A red
 * helmet with a dent, a front shield and a brim longer at the back; sooty tan coat and trousers with
 * yellow-and-silver reflective bands; an air cylinder on his back on straps; big gauntlets; rubber boots.
 */
const TAN = 0xb39a5a;
const SOOT = 0x6e6449;
const YELLOW = 0xe8e84a;
const SILVER = 0xc9ccc4;
const RED = 0xb3302b;
const TANK = 0x9a9c98;
const STRAP = 0x2b2b2b;
const GLOVE = 0x6f6e3e;
const BOOT = 0x4e4a2e;

export const FIREFIGHTER: ZombieType = {
  id: 'firefighter',
  name: 'Пожарный',
  proportions: { height: 1.9, shoulders: 1.15, arms: 1.0, girth: 1.35, stoop: 0.25, neck: 0.6, head: 0.94, jawOpen: 0.12 },
  missing: [],
  ...kindNumbers('firefighter'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const soot = splotch([SOOT, shade(TAN, 0.85)], 9, 0.22);
    const w = b.chestW + 0.03;
    const t = b.torso({ top: TAN, topPaint: soot, seat: TAN, seatPaint: soot, w, dz: b.chestDz + 0.03 });
    // Reflective band: yellow with a silver middle, round a bone at height y.
    const band = (bone: BoneName, y: number, rx: number, rz: number, wide = 0.042) => {
      b.add(bone, YELLOW, k.shell(rx, rz, wide, 0, Math.PI * 2, [0, y, 0], 9), false);
      b.add(bone, SILVER, k.shell(rx + 0.003, rz + 0.003, wide * 0.36, 0, Math.PI * 2, [0, y, 0], 9), false);
    };
    band('Chest', t.h * 0.3, t.w * 0.96 + 0.006, t.dz + 0.006);
    // The coat's skirt below the waist, its band, the high collar, a pocket.
    b.skirt('Hips', TAN, { y0: 0.08, y1: -0.2, rx: t.hipRx + 0.02, rz: t.hipRz + 0.02, flare: 1.08, paint: soot });
    band('Hips', -0.15, (t.hipRx + 0.02) * 1.065 + 0.004, (t.hipRz + 0.02) * 1.065 + 0.004);
    b.add('Chest', TAN, k.barrel(0.09, 0.088, 0.085, 1.12, [0, t.h + 0.02, 0.012], [0, 0, 0], 9), true, 0, soot);
    b.add('Chest', shade(TAN, 0.92), k.box(0.08, 0.09, 0.02, [-0.09, t.h * 0.55, -t.dz - 0.008]));
    b.add('Chest', 0x8a7a48, k.box(0.012, t.h + 0.12, 0.01, [0.01, t.h * 0.45 - 0.08, -t.dz - 0.006]), false);
    // Air cylinder on the back, its valve, straps over the shoulders.
    b.add('Chest', TANK, k.capsule(0.07, 0.3, [0, t.h * 0.3, t.dz + 0.085], [0, 0, 0], 8));
    b.add('Chest', 0x6a6c68, k.rod([0, t.h * 0.3 - 0.21, t.dz + 0.085], [0.0, t.h * 0.3 - 0.26, t.dz + 0.085], 0.02, 0.02, 5), false);
    for (const s of [-1, 1]) {
      b.add('Chest', STRAP, k.strap([0.08 * s, t.h * 0.05, -t.dz - 0.012], [0.09 * s, t.h + 0.025, -0.02], 0.04, 0.012, [0, 0.4, -1]), false);
      b.add('Chest', STRAP, k.strap([0.09 * s, t.h + 0.025, -0.02], [0.08 * s, t.h * 0.55, t.dz + 0.02], 0.04, 0.012, [0, 0.4, 1]), false);
    }
    b.neck(0.055);
    b.head({ mouth: 'open', stitches: ['cheekL'], jaw: 0.95 });
    // Helmet: a red dome with a dent, a brim reaching further back, the front shield and a chin strap.
    b.add('Head', RED, dome([0.122, 0.12, 0.134], [0, 0.11, 0.01], [0, 0, 0], 0.5, 9, 4));
    b.add('Head', shade(RED, 0.75), k.dot([0.03, 0.02, 0.012], [0.07, 0.19, -0.04], [0.4, 0.8, 0]), false);
    b.add('Head', RED, k.barrel(0.16, 0.19, 0.012, 1, [0, 0.112, 0.045], [-0.06, 0, 0], 12));
    b.add('Head', 0x8e8e88, k.ball([0.05, 0.065, 0.012], [0, 0.165, -0.124], [0.3, 0, 0], 4, 2));
    b.add('Head', 0x5e5e58, k.dot([0.022, 0.018, 0.004], [0, 0.155, -0.142], [0.3, 0, 0]), false);
    for (const s of [-1, 1]) b.add('Head', STRAP, k.rod([0.1 * s, 0.11, 0.0], [0.04 * s, -0.04, -0.05], 0.004, 0.004, 3), false);
    for (const s of ['L', 'R'] as const) {
      b.arm(s, { sleeve: 'long', cloth: TAN, clothPaint: soot, cuff: shade(TAN, 0.8), sleeveR: 0.085, glove: GLOVE, r: 0.046 });
      band(`LowerArm_${s}`, -d.foreArm * 0.45, 0.085 * 0.8, 0.085 * 0.8, 0.036);
    }
    const shin = d.kneeY - d.ankleY;
    b.legs({ pants: TAN, pantsPaint: soot, r: 0.095, flare: 1.08 });
    for (const s of ['L', 'R'] as const) {
      band(`LowerLeg_${s}`, -shin * 0.62, 0.095 * 0.86 * 1.05 + 0.006, 0.095 * 0.86 * 1.05 + 0.006, 0.036);
      b.add(`LowerLeg_${s}`, 0x6b6440, k.ball([0.06, 0.07, 0.03], [0, -0.03, -0.075], [0, 0, 0], 6, 4));
      b.foot(s, { kind: 'tall', color: BOOT, sole: 0x2b2a1e });
      b.add(`Foot_${s}`, 0xd6c24a, k.ball([0.064, 0.046, 0.05], [0, -d.ankleY + 0.052, -0.15], [0, 0, 0], 7, 4));
    }
    return b.out;
  },
};
