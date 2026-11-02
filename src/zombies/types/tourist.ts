import type { ZombieType } from '../buildZombie';
import { Body, dome, kindNumbers, print, shade, splotch } from './common';

/**
 * Tourist (refs/zombie_tourist.jpg): a small belly, a medium stoop, sunburnt. A printed bucket hat with a
 * band; an open Hawaiian shirt (palms, flowers, waves) over a white vest; a camera on a strap round the
 * neck; khaki shorts, white socks in sandals.
 */
const SHIRT = 0xe6dab0;
const PALM = 0x4e8a4a;
const FLOWER = 0xd99a6a;
const WAVE = 0x8aa8b0;
const VEST = 0xe8e6dc;
const SHORTS = 0xb5a66a;
const CAMERA = 0x2a2a2a;
const BURN = 0xb07a70;

export const TOURIST: ZombieType = {
  id: 'tourist',
  name: 'Турист',
  proportions: { height: 1.72, shoulders: 0.98, arms: 1.0, girth: 1.08, stoop: 0.5, neck: 0.95, head: 0.85, jawOpen: 0.14 },
  missing: [],
  ...kindNumbers('tourist'),
  parts(d, k) {
    const b = new Body(d, k, undefined, 0.95);
    const shirt = print(PALM, FLOWER, 13, 0.55);
    const t = b.torso({ top: VEST, seat: SHORTS, belly: 0.4 });
    // The open shirt over the vest: a print, a collar, the hem loose over the shorts.
    b.skirt('Chest', SHIRT, { y0: t.h, y1: -0.02, rx: t.w + 0.014, rz: t.dz + 0.016 + 0.03, flare: 1.02, open: 0.5, paint: shirt, z: -0.004 });
    b.skirt('Spine', SHIRT, { y0: t.len + 0.02, y1: -0.07, rx: t.w * 0.9 + 0.03, rz: t.dz + 0.07, flare: 1.04, open: 0.55, jag: true, paint: print(WAVE, PALM, 11, 0.5), z: -0.02 });
    for (const s of [-1, 1]) b.add('Chest', SHIRT, k.strap([0.03 * s, t.h - 0.01, -t.dz - 0.02], [0.09 * s, t.h + 0.035, -0.02], 0.05, 0.008, [0, 0.4, -1]));
    // The camera on its strap.
    const cz = -t.dz - 0.07 - 0.05 * 0.4;
    for (const s of [-1, 1]) b.add('Chest', 0x3a3a3a, k.rod([0.06 * s, t.h + 0.01, -0.03], [0.07 * s, t.h * 0.3, cz + 0.02], 0.004, 0.004, 3), false);
    b.add('Chest', CAMERA, k.box(0.13, 0.08, 0.05, [0, t.h * 0.28, cz]));
    b.add('Chest', 0xb8bec4, k.barrel(0.03, 0.03, 0.04, 1, [0.02, t.h * 0.27, cz - 0.04], [Math.PI / 2, 0, 0], 8));
    b.add('Chest', 0x1a1a1a, k.dot([0.022, 0.022, 0.004], [0.02, t.h * 0.27, cz - 0.061]), false);
    b.add('Chest', 0x5a5a5a, k.box(0.03, 0.016, 0.02, [-0.04, t.h * 0.28 + 0.045, cz]), false);
    b.neck(0.044);
    b.head({ mouth: 'open', stitches: ['cheekR'], jaw: 0.95 });
    // Sunburn on the cheeks and nose.
    for (const s of [-1, 1]) b.add('Head', BURN, k.dot([0.022, 0.014, 0.004], [0.052 * s, 0.05, -0.098], [0, 0.4 * s, 0]), false);
    b.add('Head', BURN, k.dot([0.012, 0.01, 0.004], [0, 0.07, -0.128], [-0.3, 0, 0]), false);
    // The bucket hat: a crown, a band, a sloping brim.
    const hat = print(PALM, WAVE, 30, 0.5);
    b.add('Head', SHIRT, dome([0.112, 0.105, 0.124], [0, 0.155, 0.012], [0, 0, 0], 0.5, 9, 4), true, 0, hat);
    b.add('Head', SHIRT, k.shell(0.112, 0.124, 0.03, 0, Math.PI * 2, [0, 0.14, 0.012], 10), true, 0, hat);
    b.add('Head', 0x6e7a5a, k.shell(0.115, 0.127, 0.02, 0, Math.PI * 2, [0, 0.148, 0.012], 10), false);
    b.skirt('Head', SHIRT, { y0: 0.132, y1: 0.1, rx: 0.114, rz: 0.126, flare: 1.42, z: 0.012, paint: hat });
    for (const s of ['L', 'R'] as const) b.arm(s, { sleeve: 'short', cloth: SHIRT, clothPaint: shirt, sleeveR: 0.07 });
    b.legs({ pants: SHORTS, pantsPaint: splotch([shade(SHORTS, 0.8)], 10, 0.15), shorts: true, r: 0.08 });
    for (const s of ['L', 'R'] as const) b.foot(s, { kind: 'sandal', color: 0x6b4a2e, sock: 0xc9c7bc });
    return b.out;
  },
};
