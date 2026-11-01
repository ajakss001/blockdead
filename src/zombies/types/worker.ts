import { Matrix4, Vector3 } from 'three';
import type { Kit, PartSpec, ZombieType } from '../buildZombie';
import { type BoneName, chestPlumb, type SkeletonDims } from '../skeleton';

/**
 * The one-armed worker (refs/zombie_worker.png): tall, thin, badly hunched, the long neck jutting forward,
 * the right arm long and bony (the hand hangs below mid-thigh). Bald long head with sunken cheeks, a peeled
 * patch on the crown, stitches on the right cheek, a few hairs; the right eye glows, the left is swollen
 * shut; the jaw hangs open and off to one side; one ear torn. Tee with a ragged hem, denim overalls (bib,
 * pocket, straps with buckles, mud on the knees), big heavy boots. NO LEFT ARM: an empty short sleeve
 * knotted at the shoulder. No blood or wounds — cracks, stitches and dirt only.
 */

const SKIN = 0x909a87;
const SKIN_SHADE = 0x838d7a;
const SKIN_HOLLOW = 0x758068;
const SOCKET = 0x4d5547;
const PATCH = 0xc99a86;
const STITCH = 0x2b2b2b;
const EYE = 0xf2e35a;
const SWOLLEN = 0xa8928c;
const MOUTH = 0x3a2a2a;
const TEETH = 0xd6d0b0;
const HAIR = 0x2e2f2a;
const SHIRT = 0xd5d2c1;
const SHIRT_DIRT = 0xb3ae95;
const DENIM = 0x56739a;
const DENIM_DARK = 0x4a6590;
const MUD = 0x44597a;
const BUCKLE = 0x9aa0a6;
const BOOT = 0x6b4a2e;
const SOLE = 0x3a2a1e;
const LACE = 0x8c6d4c;

type V3 = [number, number, number];

function parts(d: SkeletonDims, k: Kit): PartSpec[] {
  const out: PartSpec[] = [];
  // The head is drawn big (a cartoon head): everything on the head and jaw scales about the skull's base.
  const big = new Matrix4().makeScale(d.p.head ?? 1, d.p.head ?? 1, d.p.head ?? 1);
  // A big bony hand, as drawn.
  const bigHand = new Matrix4().makeScale(1.3, 1.25, 1.3);
  const add = (bone: BoneName, color: number, geo: PartSpec['geo'], outline = true, glow = 0) =>
    out.push({ bone, color, geo: bone === 'Head' || bone === 'Jaw' ? k.frame(geo, big) : bone === 'Hand_R' ? k.frame(geo, bigHand) : geo, outline, glow });
  const tau = Math.PI * 2;

  // ── Hips: the overalls' seat, two back pockets ──
  add('Hips', DENIM, k.barrel(0.14, 0.088, 0.17, 0.92, [0, -0.02, 0], [0, 0, 0], 10));
  add('Hips', DENIM, k.ball([0.08, 0.04, 0.07], [0, -0.1, 0]));
  for (const s of [-1, 1]) add('Hips', DENIM_DARK, k.strap([0.055 * s, -0.075, 0.083], [0.055 * s, -0.005, 0.087], 0.07, 0.008, [0, 0, 1]), false);

  // ── Spine: the overalls round the belly ──
  add('Spine', DENIM, k.barrel(0.135, 0.083, 0.2, 0.98, [0, 0.07, 0], [0, 0, 0], 10));
  add('Spine', MUD, k.dot([0.035, 0.028, 0.006], [0.06, 0.07, -0.083]), false);

  // ── Chest: the tee, the bib with its pocket, straps and buckles, the back panel ──
  const top = d.shoulderY - d.chestY;
  add('Chest', SHIRT, k.barrel(0.152, 0.085, 0.31, 0.86, [0, 0.145, 0], [0, 0, 0], 10));
  add('Chest', SHIRT, k.ball([0.152, 0.055, 0.085], [0, 0.3, 0], [0, 0, 0], 10, 5));
  add('Chest', SHIRT, k.barrel(0.058, 0.05, 0.03, 1.1, [0, 0.335, -0.005], [0, 0, 0], 8), false);
  add('Chest', DENIM, k.strap([0, -0.015, -0.081], [0, 0.185, -0.089], 0.19, 0.016, [0, 0, -1]));
  add('Chest', DENIM_DARK, k.strap([0, 0.07, -0.097], [0, 0.14, -0.1], 0.095, 0.008, [0, 0, -1]), false);
  add('Chest', 0x3e5577, k.box(0.095, 0.005, 0.004, [0, 0.13, -0.104]), false);
  add('Chest', MUD, k.dot([0.04, 0.03, 0.006], [-0.05, 0.03, -0.09]), false);
  add('Chest', DENIM, k.strap([0, -0.02, 0.074], [0, 0.115, 0.081], 0.16, 0.016, [0, 0, 1]));
  for (const s of [-1, 1]) {
    add('Chest', BUCKLE, k.box(0.034, 0.03, 0.012, [0.07 * s, 0.172, -0.098]), false);
    add('Chest', DENIM, k.strap([0.07 * s, 0.18, -0.091], [0.085 * s, 0.3, -0.079], 0.03, 0.01, [0, 0, -1]), false);
    add('Chest', DENIM, k.strap([0.085 * s, 0.3, -0.079], [0.085 * s, 0.35, 0], 0.03, 0.01, [0, 1, -0.5]), false);
    add('Chest', DENIM, k.strap([0.085 * s, 0.35, 0], [0.082 * s, 0.3, 0.08], 0.03, 0.01, [0, 1, 0.5]), false);
    add('Chest', DENIM, k.strap([0.082 * s, 0.3, 0.083], [0.02 * s, 0.11, 0.083], 0.03, 0.01, [0, 0, 1]), false);
    // The tee hanging out at the sides, torn into points.
    const from = s > 0 ? Math.PI / 2 - 0.6 : (3 * Math.PI) / 2 - 0.6;
    add('Chest', SHIRT, k.shell(0.137, 0.079, 0.05, from, 1.2, [0, -0.03, 0]), false);
    for (let i = 0; i < 4; i++) {
      const a = from + 0.15 + i * 0.3;
      add('Chest', SHIRT, k.cone(0.02, 0.04 + 0.012 * ((i * 7) % 3), [0.14 * Math.sin(a), -0.072 - 0.006 * (i % 2), 0.08 * Math.cos(a)], [Math.PI, 0, 0], 3), false);
    }
  }
  add('Chest', SHIRT_DIRT, k.dot([0.03, 0.025, 0.006], [-0.118, 0.2, -0.062], [0, -0.7, 0]), false);
  add('Chest', SHIRT_DIRT, k.dot([0.025, 0.02, 0.006], [0.1, 0.06, 0.07], [0, 0.8, 0]), false);

  // The empty left sleeve, knotted, hanging plumb from the shoulder (it rides the chest, not the arm bone).
  const plumb = new Matrix4().makeRotationX(chestPlumb(d)).setPosition(-d.shoulderX, top, 0);
  const sleeve = (g: PartSpec['geo']) => k.frame(g, plumb);
  add('Chest', SHIRT, sleeve(k.barrel(0.07, 0.07, 0.12, 0.88, [-0.006, -0.025, 0], [0, 0, 0], 8)));
  add('Chest', SHIRT_DIRT, sleeve(k.ball([0.036, 0.03, 0.034], [-0.014, -0.095, 0])));
  add('Chest', SHIRT, sleeve(k.rod([-0.02, -0.098, -0.012], [-0.08, -0.13, -0.04], 0.021, 0.007, 4)));
  add('Chest', SHIRT, sleeve(k.rod([-0.02, -0.1, 0.012], [-0.072, -0.155, 0.035], 0.02, 0.007, 4)));
  for (let i = 0; i < 3; i++) {
    const a = tau * (0.55 + i * 0.12);
    add('Chest', SHIRT, sleeve(k.cone(0.014, 0.03, [-0.006 + 0.06 * Math.sin(a), -0.09, 0.06 * Math.cos(a)], [Math.PI, 0, 0], 3)), false);
  }

  // ── Neck: long and thin ──
  add('Neck', SKIN, k.rod([0, -0.05, 0], [0, d.headY - d.neckY + 0.04, 0], 0.042, 0.035, 7));
  add('Neck', SKIN_SHADE, k.dot([0.012, 0.016, 0.012], [0, 0.07, -0.034]), false);

  // ── Head: long bald skull, sunken cheeks, the face ──
  const crown = new Vector3(0, 0.1, 0.012);
  const R: V3 = [0.098, 0.122, 0.112];
  const onSkull = (n: V3, lift = 1): V3 => {
    const v = new Vector3(...n).normalize();
    return [crown.x + R[0] * v.x * lift, crown.y + R[1] * v.y * lift, crown.z + R[2] * v.z * lift];
  };
  add('Head', SKIN, k.ball(R, crown.toArray() as V3, [0, 0, 0], 10, 8));
  add('Head', SKIN, k.ball([0.07, 0.055, 0.07], [0, 0.04, -0.045]));
  add('Head', SKIN_SHADE, k.ball([0.078, 0.017, 0.026], [0, 0.113, -0.088]), false);
  add('Head', SKIN, k.cone(0.017, 0.038, [0, 0.055, -0.118], [-1.9, 0, 0], 4), false);
  for (const s of [-1, 1]) {
    add('Head', SKIN_HOLLOW, k.dot([0.012, 0.03, 0.026], [0.066 * s, 0.022, -0.062], [0, 0.5 * s, 0]), false);
    add('Head', SKIN, k.dot([0.02, 0.016, 0.02], [0.06 * s, 0.062, -0.082]), false);
    add('Head', SOCKET, k.dot([0.026, 0.022, 0.012], [0.04 * s, 0.085, -0.103]), false);
  }
  // Right eye glowing, a pin of a pupil; the left swollen shut.
  add('Head', EYE, k.ball([0.018, 0.018, 0.013], [0.04, 0.084, -0.108], [0, 0, 0], 8, 6), false, 1.4);
  add('Head', STITCH, k.dot([0.006, 0.006, 0.004], [0.042, 0.083, -0.121]), false);
  add('Head', SWOLLEN, k.ball([0.028, 0.022, 0.018], [-0.041, 0.083, -0.105]), false);
  add('Head', STITCH, k.box(0.034, 0.004, 0.004, [-0.041, 0.082, -0.123], [0, 0, 0.12]), false);
  // Mouth: dark inside, two crooked upper teeth.
  add('Head', MOUTH, k.box(0.066, 0.04, 0.045, [0.006, -0.002, -0.083]), false);
  add('Head', TEETH, k.box(0.012, 0.016, 0.008, [-0.014, -0.011, -0.106], [0, 0, 0.1]), false);
  add('Head', TEETH, k.box(0.011, 0.014, 0.008, [0.017, -0.012, -0.104], [0, 0, -0.15]), false);
  // Ears: the right whole, the left torn (half of it, ragged).
  add('Head', SKIN_SHADE, k.ball([0.012, 0.03, 0.02], [0.098, 0.07, 0.012], [0, 0, 0.15]));
  add('Head', SKIN_SHADE, k.ball([0.012, 0.019, 0.019], [-0.098, 0.058, 0.012], [0, 0, -0.1]));
  add('Head', SKIN_SHADE, k.cone(0.008, 0.022, [-0.1, 0.082, 0.02], [0, 0, 0.3], 3), false);
  add('Head', SKIN_SHADE, k.cone(0.007, 0.016, [-0.099, 0.078, 0.0], [0, 0, -0.2], 3), false);
  // The peeled patch on the crown (right, towards the back) with cracks across it and one on the brow.
  const patchN = new Vector3(0.36, 0.9, 0.26).normalize();
  add('Head', PATCH, k.dot([0.05, 0.012, 0.042], onSkull(patchN.toArray() as V3, 0.97), [Math.atan2(patchN.z, patchN.y), 0, -Math.atan2(patchN.x, patchN.y)]), false);
  const crack = (a: V3, b: V3) => add('Head', STITCH, k.rod(onSkull(a, 1.025), onSkull(b, 1.03), 0.003, 0.002, 3), false);
  crack([0.3, 0.92, 0.22], [0.62, 0.72, 0.3]);
  crack([0.36, 0.9, 0.26], [0.2, 0.86, 0.55]);
  crack([0.4, 0.88, 0.2], [0.42, 0.82, -0.1]);
  crack([-0.25, 0.62, -0.75], [-0.08, 0.5, -0.86]);
  // Stitches down the right cheek: a seam and four cross-stitches.
  const s0 = new Vector3(0.05, 0.066, -0.095);
  const s1 = new Vector3(0.056, 0.012, -0.088);
  add('Head', STITCH, k.rod(s0.toArray() as V3, s1.toArray() as V3, 0.003, 0.003, 3), false);
  const across = new Vector3(0.755, 0, 0.655).multiplyScalar(0.012);
  for (let i = 0; i < 4; i++) {
    const p = s0.clone().lerp(s1, (i + 0.5) / 4);
    add('Head', STITCH, k.rod(p.clone().sub(across).toArray() as V3, p.clone().add(across).toArray() as V3, 0.0025, 0.0025, 3), false);
  }
  // A few stray hairs.
  const hairs: V3[] = [
    [0.2, 1, 0.1],
    [-0.3, 0.95, 0.2],
    [0.62, 0.7, -0.1],
    [-0.6, 0.72, 0.12],
    [-0.1, 0.8, 0.6],
    [-0.2, 0.86, -0.4],
    [0.5, 0.6, 0.55],
  ];
  hairs.forEach((n, i) => {
    const v = new Vector3(...n).normalize();
    const a = onSkull(n, 0.98);
    const len = 0.022 + 0.01 * (i % 3);
    add('Head', HAIR, k.rod(a, [a[0] + v.x * len + 0.006, a[1] + v.y * len, a[2] + v.z * len], 0.0024, 0.001, 3), false);
  });

  // ── Jaw: hanging open and askew, a bottom tooth or two ──
  add('Jaw', SKIN, k.ball([0.047, 0.024, 0.052], [0, -0.042, -0.048]));
  add('Jaw', SKIN, k.ball([0.03, 0.02, 0.024], [0, -0.052, -0.088]));
  add('Jaw', MOUTH, k.box(0.062, 0.006, 0.066, [0, -0.027, -0.05]), false);
  add('Jaw', TEETH, k.box(0.012, 0.014, 0.008, [-0.016, -0.02, -0.083], [0, 0, -0.1]), false);
  add('Jaw', TEETH, k.box(0.01, 0.012, 0.008, [0.013, -0.022, -0.085]), false);

  // ── Right arm: torn short sleeve, long thin arm, big bony hand with three long fingers and a thumb ──
  add('UpperArm_R', SHIRT, k.barrel(0.068, 0.068, 0.15, 1.08, [0, -0.04, 0], [0, 0, 0], 8));
  for (let i = 0; i < 5; i++) {
    const a = tau * (i / 5 + 0.1);
    add('UpperArm_R', SHIRT, k.cone(0.016, 0.03 + 0.01 * (i % 2), [0.072 * Math.sin(a), -0.128, 0.072 * Math.cos(a)], [Math.PI, 0, 0], 3), false);
  }
  add('UpperArm_R', SKIN, k.rod([0, 0, 0], [0, -d.upperArm, 0], 0.036, 0.031, 6));
  add('UpperArm_R', SKIN, k.ball([0.034, 0.034, 0.034], [0, -d.upperArm, 0.004], [0, 0, 0], 6, 4));
  add('LowerArm_R', SKIN, k.rod([0, 0, 0], [0, -d.foreArm, 0], 0.031, 0.024, 6));
  add('LowerArm_R', SKIN, k.ball([0.027, 0.024, 0.027], [0, -d.foreArm, 0], [0, 0, 0], 6, 4));
  const h = d.hand / 0.236;
  add('Hand_R', SKIN, k.box(0.032, 0.1 * h, 0.085, [0, -0.055 * h, 0]));
  [-0.028, 0, 0.028].forEach((z, i) => {
    const f = h * (i === 2 ? 0.88 : 1);
    const k0: V3 = [0.002, -0.105 * h, z];
    const k1: V3 = [-0.018, -0.105 * h - 0.075 * f, z * 1.1];
    const k2: V3 = [-0.045, -0.105 * h - 0.13 * f, z * 1.15];
    add('Hand_R', SKIN_SHADE, k.dot([0.014, 0.014, 0.014], k0), false);
    add('Hand_R', SKIN, k.rod(k0, k1, 0.011, 0.009, 5));
    add('Hand_R', SKIN, k.rod(k1, k2, 0.009, 0.006, 5));
  });
  add('Hand_R', SKIN, k.rod([-0.012, -0.03 * h, -0.04], [-0.03, -0.085 * h, -0.066], 0.011, 0.008, 5));
  add('Hand_R', SKIN, k.rod([-0.03, -0.085 * h, -0.066], [-0.046, -0.12 * h, -0.06], 0.008, 0.006, 5));

  // ── Legs: wide denim legs, mud on the knees, big heavy boots ──
  const thigh = d.hipJointY - d.kneeY;
  const shin = d.kneeY - d.ankleY;
  for (const [s, side] of [
    [-1, 'L'],
    [1, 'R'],
  ] as const) {
    const up = `UpperLeg_${side}` as BoneName;
    const lo = `LowerLeg_${side}` as BoneName;
    const ft = `Foot_${side}` as BoneName;
    add(up, DENIM, k.rod([0, 0.05, 0], [0, -thigh, 0], 0.074, 0.064, 8));
    add(lo, DENIM, k.rod([0, 0.02, 0], [0, -shin + 0.06, 0], 0.064, 0.076, 8));
    add(lo, DENIM_DARK, k.rod([0, -shin + 0.13, 0], [0, -shin + 0.06, 0], 0.078, 0.081, 8));
    add(lo, MUD, k.dot([0.046, 0.055, 0.01], [0.005 * s, -0.03, -0.062], [0, 0, 0.3 * s]), false);
    add(ft, BOOT, k.barrel(0.07, 0.074, 0.12, 1.04, [0, 0.03, -0.004], [0, 0, 0], 8));
    add(ft, BOOT, k.box(0.125, 0.085, 0.22, [0, -0.033, -0.035]));
    add(ft, BOOT, k.ball([0.064, 0.046, 0.06], [0, -0.037, -0.15], [0, 0, 0], 8, 5));
    add(ft, SOLE, k.box(0.14, 0.022, 0.29, [0, -0.077, -0.055]));
    for (let i = 0; i < 3; i++) add(ft, LACE, k.box(0.05, 0.006, 0.012, [0, 0.065 - i * 0.03, -0.074 - i * 0.004], [0.3, 0, 0]), false);
    for (const t of [-1, 1]) add(ft, LACE, k.rod([0, 0.075, -0.078], [0.03 * t, 0.055, -0.088], 0.004, 0.003, 3), false);
  }
  add('UpperLeg_R', MUD, k.dot([0.035, 0.05, 0.008], [0, -0.22, -0.068], [0, 0, 0.4]), false);
  return out;
}

export const WORKER: ZombieType = {
  id: 'worker',
  name: 'Однорукий рабочий',
  proportions: { height: 1.86, shoulders: 0.92, arms: 1.2, girth: 0.78, stoop: 1, neck: 1.6, head: 1.3, jawOpen: 0.32, jawSide: 0.1 },
  missing: ['arm_L'],
  walk: 0.5,
  run: 1.1,
  animSpeed: 0.85,
  hp: 100,
  parts,
};
