import type { ZombieType } from '../buildZombie';
import { Body, kindNumbers, shade, splotch, type V3 } from './common';

/**
 * Medic (refs/zombie_medic.jpg): a thin woman, slightly hunched. Dark hair pulled back into a bun, a stitched
 * brow and cheek; a surgical mask hanging from her right ear, a stethoscope round her neck. Knee-length white
 * coat, open and torn at the hem, over teal scrubs; an ID badge; white clogs.
 */
const SKIN = 0x8fa088;
const HAIR = 0x2f3328;
const COAT = 0xe6e4dc;
const GRIME = 0xa9a27a;
const SCRUBS = 0x2e8b84;
const MASK = 0xa7d8cf;
const TUBE = 0x2a2e33;
const STEEL = 0xb8bec4;
const CLOG = 0xe8e8e4;

export const MEDIC: ZombieType = {
  id: 'medic',
  name: 'Медик',
  proportions: { height: 1.68, shoulders: 0.82, arms: 1.05, girth: 0.72, stoop: 0.4, neck: 0.9, head: 0.83, jawOpen: 0.06 },
  missing: [],
  ...kindNumbers('medic'),
  parts(d, k) {
    const b = new Body(d, k, SKIN, 0.95);
    const coat = splotch([GRIME, shade(GRIME, 1.15)], 11, 0.22);
    const t = b.torso({ top: SCRUBS, seat: SCRUBS, bust: true });
    b.add('Chest', SKIN, k.cone(0.03, 0.07, [0, t.h - 0.06, -t.dz - 0.002], [Math.PI, 0, 0], 3), false);
    // The coat: open in front, a collar, lapels, a torn hem to the knee, pockets and a badge.
    b.skirt('Chest', COAT, { y0: t.h - 0.01, y1: -(d.chestY - d.hipsY) + 0.05, rx: t.w * 0.9 + 0.012, rz: t.dz + 0.018, flare: 1.12, open: 0.4, paint: coat });
    b.add('Chest', COAT, k.barrel(0.068, 0.062, 0.045, 1.12, [0, t.h + 0.005, 0.012], [0, 0, 0], 8));
    for (const s of [-1, 1]) {
      b.add('Chest', shade(COAT, 0.92), k.strap([t.w * 0.34 * s, t.h - 0.01, -t.dz - 0.012], [t.w * 0.22 * s, t.h * 0.3, -t.dz - 0.018], 0.042, 0.008, [0, 0, -1]), false);
      b.add('Hips', shade(COAT, 0.95), k.box(0.075, 0.07, 0.01, [(t.hipRx + 0.02) * 0.62 * s, -0.17, -(t.hipRz + 0.05)], [0, -0.45 * s, 0]), false);
    }
    b.skirt('Hips', COAT, { y0: 0.07, y1: d.kneeY - d.hipsY + 0.02, rx: t.hipRx + 0.028, rz: t.hipRz + 0.03, flare: 1.3, open: 0.3, jag: true, paint: coat });
    b.add('Chest', 0xf2f2f0, k.box(0.036, 0.048, 0.006, [-t.w * 0.55, t.h * 0.6, -t.dz - 0.024]), false);
    b.add('Chest', 0x5a7aa0, k.box(0.026, 0.014, 0.004, [-t.w * 0.55, t.h * 0.58, -t.dz - 0.028]), false);
    // Stethoscope: round the back of the neck, both ends down the front, the chest piece on the left.
    const y = t.h - 0.005;
    const path: V3[] = [
      [-0.045, t.h * 0.42, -t.dz - 0.03],
      [-0.06, y - 0.04, -t.dz - 0.02],
      [-0.072, y, 0.0],
      [-0.045, y + 0.012, 0.055],
      [0.045, y + 0.012, 0.055],
      [0.072, y, 0.0],
      [0.06, y - 0.04, -t.dz - 0.02],
      [0.04, t.h * 0.52, -t.dz - 0.028],
    ];
    for (let i = 0; i + 1 < path.length; i++) b.add('Chest', TUBE, k.rod(path[i], path[i + 1], 0.007, 0.007, 4), false);
    b.add('Chest', STEEL, k.dot([0.02, 0.02, 0.008], [-0.045, t.h * 0.42 - 0.015, -t.dz - 0.034]), false);
    b.neck(0.036);
    b.head({ mouth: 'grim', stitches: ['brow', 'cheekR'], jaw: 0.85 });
    b.hair(HAIR, { front: -0.45, puff: 1.05 });
    b.add('Head', HAIR, k.ball([0.05, 0.046, 0.048], b.onSkull([0, 0.5, 0.86], 1.12), [0, 0, 0], 7, 5));
    b.add('Head', HAIR, k.rod(b.onSkull([0.55, 0.55, -0.62], 1.02), [0.088, 0.0, -0.06], 0.005, 0.002, 3), false);
    b.add('Head', HAIR, k.rod(b.onSkull([-0.2, 0.9, 0.3], 1.04), b.onSkull([-0.35, 1.0, 0.1], 1.2), 0.004, 0.002, 3), false);
    // The mask hanging off the right ear.
    b.add('Head', MASK, k.box(0.014, 0.05, 0.075, [0.108, -0.012, -0.025], [0.15, 0.25, 0.12]));
    b.add('Head', shade(MASK, 0.85), k.rod([0.1, 0.085, 0.015], [0.11, 0.012, -0.004], 0.003, 0.003, 3), false);
    b.add('Head', shade(MASK, 0.85), k.rod([0.1, 0.06, 0.02], [0.112, -0.03, 0.006], 0.003, 0.003, 3), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'long', cloth: COAT, clothPaint: coat, cuff: SCRUBS, sleeveR: 0.06 });
    b.legs({ pants: SCRUBS, flare: 1.05 });
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'clog', color: CLOG, sole: 0xd6d6d0, sock: SCRUBS });
    return b.out;
  },
};
