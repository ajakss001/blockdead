import { Matrix4 } from 'three';
import type { ZombieType } from '../buildZombie';
import { Body, check, kindNumbers, shade, splotch } from './common';

/**
 * Chef (refs/zombie_chef.jpg): very fat with a big belly and short legs (he waddles). A tall toque slipped
 * to one side, a stitched brow; a double-breasted white jacket with dark buttons and cuffs, a stained
 * apron with a ladle in its pocket; check trousers, dark clogs.
 */
const JACKET = 0xe6e2d4;
const APRON = 0xcfc6a0;
const STAIN = 0x9c9468;
const HAT = 0xeeece4;
const BUTTON = 0x2b2b2b;
const STEEL = 0x9aa0a6;

export const CHEF: ZombieType = {
  id: 'chef',
  name: 'Повар',
  proportions: { height: 1.75, shoulders: 1.05, arms: 0.98, girth: 1.6, stoop: 0.35, neck: 0.75, head: 0.86, legs: 0.86, jawOpen: 0.1 },
  missing: [],
  ...kindNumbers('chef'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const jacket = splotch([shade(STAIN, 1.2), shade(JACKET, 0.88)], 10, 0.14);
    const stain = splotch([STAIN, shade(STAIN, 0.85)], 11, 0.3);
    const t = b.torso({ top: JACKET, topPaint: jacket, seat: 0x8e918e, belly: 1 });
    // Double-breasted: two rows of buttons; the collar.
    for (const s of [-1, 1])
      for (let i = 0; i < 3; i++) b.add('Chest', BUTTON, k.dot([0.009, 0.009, 0.005], [0.045 * s - 0.02, t.h * (0.82 - i * 0.18), -t.dz - 0.012 - (i === 2 ? 0.035 : 0)]), false);
    b.add('Chest', JACKET, k.barrel(0.085, 0.08, 0.045, 1.15, [0, t.h + 0.008, 0.012], [0, 0, 0], 8));
    // The apron: a bib on the belly, a skirt in front to the knee, a strap round the neck, a pocket and ladle.
    const bz = t.dz + 0.115;
    b.add('Spine', APRON, k.shell(t.w * 0.9 + 0.06, t.dz + 0.17, t.len + 0.04, Math.PI * 0.62, Math.PI * 0.76, [0, t.len / 2, 0], 6), true, 0, stain);
    b.add('Chest', APRON, k.shell(t.w * 0.95, t.dz + 0.115, t.h * 0.55, Math.PI * 0.7, Math.PI * 0.6, [0, t.h * 0.25, 0], 5), true, 0, stain);
    b.add('Hips', APRON, k.shell(t.hipRx + 0.05, t.hipRz + 0.06, 0.06 - (d.kneeY - d.hipsY), Math.PI * 0.58, Math.PI * 0.84, [0, (0.06 + d.kneeY - d.hipsY) / 2 + 0.01, 0], 7), false, 0, stain);
    for (const s of [-1, 1]) b.add('Chest', APRON, k.rod([0.06 * s, t.h * 0.52, -bz + 0.01], [0.055 * s, t.h + 0.03, -0.02], 0.007, 0.007, 3), false);
    b.add('Hips', APRON, k.barrel(t.hipRx + 0.012, t.hipRz + 0.016, 0.025, 1, [0, 0.06, 0], [0, 0, 0], 10), false);
    const pz = -(t.hipRz + 0.07);
    b.add('Hips', shade(APRON, 0.9), k.box(0.12, 0.1, 0.012, [0.05, -0.12, pz], [0.12, 0, 0]), false);
    b.add('Hips', STEEL, k.rod([0.08, -0.08, pz + 0.01], [0.09, 0.05, pz - 0.01], 0.006, 0.006, 4), false);
    b.add('Hips', STEEL, k.ball([0.024, 0.016, 0.024], [0.092, 0.06, pz - 0.012], [0.3, 0, 0], 6, 4), false);
    b.neck(0.05);
    b.head({ mouth: 'grim', stitches: ['brow', 'cheekR'], jaw: 1 });
    // The toque: a band and a puffed crown, slipped over to his left.
    const tilt = new Matrix4().makeRotationZ(0.22).setPosition(-0.025, -0.005, 0);
    const hat = (g: ReturnType<typeof k.box>, line = true) => b.add('Head', HAT, k.frame(g, tilt), line);
    hat(k.barrel(0.106, 0.12, 0.09, 1, [0, 0.2, 0.012], [0, 0, 0], 10));
    hat(k.ball([0.135, 0.075, 0.14], [0.0, 0.27, 0.01], [0, 0, 0], 9, 6));
    for (const a of [0.6, 2.2, 3.8, 5.2]) b.add('Head', shade(HAT, 0.88), k.frame(k.ball([0.05, 0.045, 0.05], [0.08 * Math.sin(a), 0.285, 0.01 + 0.085 * Math.cos(a)], [0, 0, 0], 6, 4), tilt), false);
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'long', cloth: JACKET, clothPaint: jacket, cuff: shade(JACKET, 0.92), sleeveR: 0.072, r: 0.05 });
    b.legs({ pants: 0x8e918e, pantsPaint: check(0x6e7270, 0xb8bab6, 0.05), r: 0.1, flare: 0.95 });
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'clog', color: 0x2a2e2e, sole: 0x1a1c1c, sock: 0x6e7270 });
    return b.out;
  },
};
