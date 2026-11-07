import { Vector3 } from 'three';
import { ellipseLoft, type LoftRing } from '../../render/lowpoly';
import type { Kit, PartSpec, ZombieType } from '../buildZombie';
import type { Proportions, SkeletonDims } from '../skeleton';
import { REF_CLOTHES } from '../../player/appearance';
import { type ModelKind, ZOMBIE_STATS } from '../stats';
import { Body, check, shade, type Side, splotch, type V3, ZSKIN } from './common';

/**
 * The survivors (refs: the male and female survivor sheets) on the zombies' skeleton and builder — the
 * player's figure in the editor and the inventory, their body on death, and the twin that rises in their
 * clothes. A living build: upright, normal warm skin muted by the grim rule, clear eyes, a closed mouth,
 * brows, tired dark circles; hands lighter than a zombie's (a fist round the handle when holding).
 *
 * Man: lean and athletic, short dark messy hair, stubble. A faded grey T-shirt torn on the chest and the
 * side, grey tape round the left sleeve and at the hem; charcoal straight jeans with a burlap patch on the
 * right knee and a small one on the left thigh, dusty to the knees; worn grey-beige sneakers.
 * Woman: slim, narrower shoulders, wider hips, a dirty-blond low ponytail with loose strands. A light-grey
 * tee with tape on the left shoulder, a ragged left sleeve, small holes; olive-grey jeans with burlap and
 * faded denim patches on the knees and the thigh, dusty from below; worn sneakers.
 *
 * Other clothes (from the inventory) are drawn in their colours on the same body: long sleeves, boots,
 * gloves, bare skin; the tee / jeans / sneakers details belong to those items.
 */

export type SurvivorSex = 'male' | 'female';
export interface SurvivorSpec {
  sex: SurvivorSex;
  build: 'slim' | 'average' | 'heavy';
  /** cm */
  height: number;
  skin: number;
  face: number;
  hair: 'short' | 'buzz' | 'long' | 'ponytail' | 'curly' | 'bald';
  hairColor: number;
  beard: 'none' | 'stubble' | 'full';
  /** Item ids worn (tshirt, jeans, sneakers get the reference details). */
  worn: { torso?: string | null; legs?: string | null; feet?: string | null };
  /** Colours: top (null bare chest), sleeves (null bare arms), pants (null bare legs), shoes, gloves. */
  top: number | null;
  sleeves: number | null;
  pants: number | null;
  shoes: { kind: 'sneakers' | 'boots' | 'barefoot'; upper: number };
  gloves: number | null;
  /** 0..1 */
  dirt: { torso: number; legs: number; feet: number };
  /** Fists round a handle: the right hand, or both. */
  grip?: 'none' | 'right' | 'both';
  /** The risen twin: zombie skin, face and stoop, the same clothes more torn. */
  zombie?: boolean;
}

const TAPE_GREY = 0xc4c4bc;
const BURLAP = 0xb09a6c;
const BURLAP_DARK = 0x8a7852;
const DENIM_FADED = 0x8aa0b8;
const THREAD = 0x3a3630;
const DUST = 0xa89070;
const DUST_DARK = 0x8a7a5c;
const SCLERA = 0xb4afa4;
const IRIS = 0x3e3a32;

/** The hand's grip (a fist): the handle's axis runs along the hand's Z through this point (hand frame, before the hand's scale). */
export const FIST_GRIP: V3 = [-0.028, -0.098, 0];

/** The build's proportions (height in m, a woman's narrower shoulders and wider hips). */
export function survivorProportions(s: Pick<SurvivorSpec, 'sex' | 'build' | 'height' | 'zombie'>): Proportions {
  const h = s.height / 100;
  const f = s.sex === 'female';
  const girth = { slim: f ? 0.7 : 0.8, average: f ? 0.78 : 0.9, heavy: f ? 0.94 : 1.08 }[s.build];
  return {
    height: h,
    shoulders: f ? 0.86 : 1.02,
    arms: f ? 0.97 : 1,
    girth,
    stoop: s.zombie ? 0.35 : 0,
    neck: f ? 0.96 : 1,
    head: h / (f ? 1.93 : 1.98),
    legs: f ? 1.02 : 1,
    hips: f ? 1.14 : 1,
    jawOpen: s.zombie ? 0.12 : 0,
  };
}

/** The hand's scale: a man's lighter than the zombies' big hands, a woman's lighter still. */
export const survivorHand = (sex: SurvivorSex) => (sex === 'female' ? 0.74 : 0.84);

/** A survivor as a type the zombie builder builds (cached by its id: the spec). */
export function survivorType(s: SurvivorSpec, id = `survivor:${JSON.stringify(s)}`, kind?: ModelKind): ZombieType {
  const st = kind ? ZOMBIE_STATS[kind] : null;
  return {
    id,
    name: s.sex === 'female' ? 'Выжившая' : 'Выживший',
    proportions: survivorProportions(s),
    missing: [],
    walk: 0.5 * (st?.speed ?? 1),
    run: 1.1 * (st?.speed ?? 1),
    animSpeed: 0.85 * Math.sqrt(st?.speed ?? 1),
    hp: Math.round(100 * (st?.hp ?? 1)),
    living: !s.zombie,
    parts: (d, k) => survivorParts(s, d, k),
  };
}

type Ring = LoftRing;
/** A ring at height y between the rings (linear). */
function at(rings: Ring[], y: number): Ring {
  if (y <= rings[0].y) return { ...rings[0], y };
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i];
    const c = rings[i + 1];
    if (y <= c.y) {
      const t = (y - a.y) / (c.y - a.y);
      return { y, rx: a.rx + (c.rx - a.rx) * t, rz: a.rz + (c.rz - a.rz) * t, oz: (a.oz ?? 0) + ((c.oz ?? 0) - (a.oz ?? 0)) * t };
    }
  }
  return { ...rings[rings.length - 1], y };
}
/** The rings between y0 and y1, cut there. */
function cut(rings: Ring[], y0: number, y1: number): Ring[] {
  return [at(rings, y0), ...rings.filter((r) => r.y > y0 + 1e-4 && r.y < y1 - 1e-4), at(rings, y1)];
}

function survivorParts(s: SurvivorSpec, d: SkeletonDims, k: Kit): PartSpec[] {
  const female = s.sex === 'female';
  const zombie = s.zombie === true;
  const skin = zombie ? ZSKIN : s.skin;
  const hs = survivorHand(s.sex);
  const b = new Body(d, k, skin, hs);
  const skins = new Set<number>([skin]);
  const sk = (f: number) => {
    const c = shade(skin, f);
    skins.add(c);
    return c;
  };
  const tee = s.worn.torso === 'tshirt';
  const jeans = s.worn.legs === 'jeans';

  const pants = s.pants ?? skin;
  const dust = s.dirt.legs;
  const upPaint = s.pants !== null ? splotch([shade(pants, 0.85), DUST], 9, 0.05 + 0.1 * dust) : undefined;

  // ── Trunk: lofted through rings (model frame, unstooped) — the jeans' seat up to the belt, the top
  // above it; his chest broad, her waist narrow and hips wide, a soft bust. ──
  const top = s.top ?? skin;
  const topPaint = s.top !== null ? splotch([shade(top, 0.8), DUST], 10, 0.06 + 0.16 * s.dirt.torso) : undefined;
  const seat = s.pants ?? shade(skin, 0.5);
  const gf = d.p.girth / (female ? 0.78 : 0.9);
  const wk = 0.75 + 0.25 * gf;
  const dk = 0.7 + 0.3 * gf;
  const S = d.shoulderX;
  const hipW = d.hipX + (female ? 0.085 : 0.072);
  const R = (y: number, rx: number, rz: number, oz = 0): Ring => ({ y, rx: rx * wk, rz: rz * dk, oz });
  const belt = d.hipsY + 0.035;
  const pelvis: Ring[] = [R(d.hipJointY - 0.06, hipW * 0.8, 0.068, 0.006), R(d.hipJointY + 0.015, hipW, 0.088, 0.006), R(belt + 0.01, hipW * (female ? 0.9 : 0.96), 0.09)];
  const trunk: Ring[] = female
    ? [R(belt - 0.012, hipW * 0.93, 0.097), R(d.spineY + 0.05, 0.118, 0.08), R(d.chestY - 0.01, 0.124, 0.084, -0.004), R(d.chestY + 0.045, 0.13, 0.094, -0.012), R(d.chestY + 0.105, 0.134, 0.1, -0.018), R(d.shoulderY - 0.06, S * 0.9, 0.086, -0.008), R(d.shoulderY + 0.02, S * 0.8, 0.07), R(d.shoulderY + 0.045, 0.07, 0.058), R(d.neckY + 0.005, 0.048, 0.046)]
    : [R(belt - 0.012, hipW * 0.99, 0.097), R(d.spineY + 0.05, 0.142, 0.088), R(d.chestY - 0.01, 0.152, 0.094, -0.002), R(d.chestY + 0.08, S * 0.86, 0.104, -0.006), R(d.shoulderY - 0.06, S * 0.92, 0.1, -0.004), R(d.shoulderY + 0.02, S * 0.82, 0.075), R(d.shoulderY + 0.048, 0.08, 0.062), R(d.neckY + 0.005, 0.054, 0.05)];
  const loft = (bone: 'Hips' | 'Spine' | 'Chest', color: number, rings: Ring[], y0: number, y1: number, paint?: ReturnType<typeof splotch>) => {
    const boneY = bone === 'Hips' ? d.hipsY : bone === 'Spine' ? d.spineY : d.chestY;
    const part = cut(rings, y0, y1).map((r) => ({ y: r.y - boneY, rx: r.rx, rz: r.rz, oz: r.oz }));
    b.add(bone, color, ellipseLoft(part, 12), true, 0, paint);
  };
  loft('Hips', seat, pelvis, pelvis[0].y, pelvis[2].y, upPaint);
  loft('Spine', top, trunk, trunk[0].y, d.chestY + 0.006, topPaint);
  loft('Chest', top, trunk, d.chestY - 0.006, trunk[trunk.length - 1].y, topPaint);
  if (s.top === null) skins.add(top);
  const boneY = { Hips: d.hipsY, Spine: d.spineY, Chest: d.chestY } as const;
  /** A flat piece on the trunk's surface at height y (model frame), angle th (from the back, +Z, towards the right, +X). */
  const decal = (bone: keyof typeof boneY, color: number, th: number, y: number, w: number, h: number, slant = 0, lift = 0.003) => {
    const r = at(trunk, y);
    const x = (r.rx + lift) * Math.sin(th);
    const z = (r.rz + lift) * Math.cos(th) + (r.oz ?? 0);
    const face = Math.atan2(Math.sin(th) / r.rx, Math.cos(th) / r.rz);
    b.add(bone, color, k.box(w, h, 0.004, [x, y - boneY[bone], z], [0, face, slant]), false);
  };
  /** A tear: a dark frayed edge with skin showing through. */
  const rip = (bone: keyof typeof boneY, th: number, y: number, len: number, slant: number) => {
    decal(bone, shade(top, 0.55), th, y, len * 1.15, 0.016, slant, 0.002);
    decal(bone, sk(0.92), th, y, len, 0.0065, slant, 0.0035);
  };
  /** A small hole. */
  const hole = (bone: keyof typeof boneY, th: number, y: number, size: number) => {
    const r = at(trunk, y);
    const x = (r.rx + 0.002) * Math.sin(th);
    const z = (r.rz + 0.002) * Math.cos(th) + (r.oz ?? 0);
    b.add(bone, shade(top, 0.42), k.dot([size, size * 0.8, 0.004], [x, y - boneY[bone], z], [0, Math.atan2(Math.sin(th) / r.rx, Math.cos(th) / r.rz), 0]), false);
  };
  if (tee && s.top !== null) {
    if (!female) {
      // A slash high on the left chest, another low on the right side; grey tape at the left hem.
      rip('Chest', Math.PI + 0.42, d.chestY + 0.14, 0.05, 0.35);
      rip('Spine', Math.PI * 0.5 + 0.35, d.spineY + 0.08, 0.045, -0.5);
      decal('Spine', TAPE_GREY, Math.PI + 0.75, belt + 0.012, 0.05, 0.032, 0.08);
      decal('Spine', shade(TAPE_GREY, 0.9), Math.PI + 0.6, belt + 0.008, 0.045, 0.03, -0.12, 0.005);
      hole('Chest', Math.PI - 0.5, d.chestY + 0.05, 0.007);
    } else {
      // Small holes over the front, the sides and the back.
      hole('Chest', Math.PI + 0.55, d.chestY + 0.13, 0.007);
      hole('Chest', Math.PI - 0.35, d.chestY + 0.01, 0.006);
      hole('Spine', Math.PI + 0.2, d.spineY + 0.06, 0.006);
      hole('Spine', Math.PI * 0.5 + 0.2, d.spineY + 0.1, 0.007);
      hole('Chest', 0.6, d.chestY + 0.08, 0.007);
      // Tape over the top of the left shoulder: two strips across it.
      const sx = -S * 0.62;
      for (const [dx, ry] of [[0, 0.35], [-0.014, -0.3]] as const) b.add('Chest', TAPE_GREY, k.box(0.05, 0.004, 0.07, [sx + dx, d.shoulderY + 0.034 - d.chestY, -0.002], [0, ry, 0.43]), false);
    }
  }
  if (zombie && s.top !== null) {
    rip('Chest', Math.PI - 0.2, d.chestY + 0.06, 0.06, -0.3);
    rip('Spine', 0.4, d.spineY + 0.07, 0.06, 0.4);
    // The hem torn into points.
    const r = at(trunk, belt);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      b.add('Spine', top, k.cone(0.022, 0.04, [r.rx * 1.02 * Math.sin(a), belt - 0.03 - d.spineY, r.rz * 1.02 * Math.cos(a)], [Math.PI, 0, 0], 3), false);
    }
  }

  // ── Neck and head. ──
  b.neck(female ? 0.036 : 0.043, skin);
  if (zombie) b.head({ mouth: 'open', jaw: female ? 0.85 : 0.95, skull: female ? [0.088, 0.112, 0.104] : [0.092, 0.116, 0.108] });
  else livingHead(b, k, s, sk);
  hair(b, k, s, female);

  // ── Arms: a T-shirt's short sleeves, long ones, or bare; hands (fists when holding). ──
  for (const side of ['L', 'R'] as const) {
    const fist = s.grip === 'both' || (s.grip === 'right' && side === 'R');
    arm(b, k, side, {
      female,
      sleeve: s.top === null ? 'none' : s.sleeves !== null ? 'long' : 'short',
      cloth: s.sleeves ?? top,
      paint: topPaint,
      glove: s.gloves,
      fist,
      jag: (female && side === 'L' && tee) || zombie,
      tape: tee && !female && side === 'L',
      sk,
    });
  }

  // ── Legs: jeans (patched as on the refs), other trousers, or bare. ──
  const thigh = d.hipJointY - d.kneeY;
  const shin = d.kneeY - d.ankleY;
  const r = 0.064 + 0.012 * d.p.girth + (female ? 0.004 : 0);
  const loPaint = s.pants !== null ? splotch([DUST, DUST_DARK], 8, 0.2 + 0.25 * dust) : undefined;
  for (const side of ['L', 'R'] as const) {
    const up = `UpperLeg_${side}` as const;
    const lo = `LowerLeg_${side}` as const;
    b.add(up, pants, k.rod([0, 0.05, 0], [0, -thigh, 0], r, r * 0.88, 8), true, 0, upPaint);
    b.add(lo, pants, k.rod([0, 0.02, 0], [0, -shin + 0.022, 0], r * 0.86, r * 0.86, 8), true, 0, loPaint);
    if (s.pants === null) skins.add(pants);
  }
  if (jeans && s.pants !== null) {
    const rUp = (y: number) => r + (r * 0.88 - r) * ((0.05 - y) / (thigh + 0.05)) + 0.004;
    const rLo = r * 0.86 + 0.004;
    const front = Math.PI;
    /** A patch sewn on: cloth on the leg's surface, its seams in a darker thread. */
    const patch = (bone: Parameters<Body['add']>[0], color: number, paint: ReturnType<typeof check> | undefined, rad: number, th: number, y: number, h: number, w: number) => {
      b.add(bone, color, k.shell(rad, rad, h, th - w / 2, w, [0, y, 0], 5), true, 0, paint);
      const e = rad + 0.0015;
      for (const yy of [y + h / 2 - 0.003, y - h / 2 + 0.003]) b.add(bone, THREAD, k.shell(e, e, 0.004, th - w / 2, w, [0, yy, 0], 5), false);
      for (const tt of [th - w / 2 + 0.03, th + w / 2 - 0.03]) b.add(bone, THREAD, k.shell(e, e, h, tt - 0.025, 0.05, [0, y, 0], 1), false);
    };
    const burlap = check(BURLAP, BURLAP_DARK, 0.011);
    const out = (side: Side) => (side === 'R' ? -1 : 1);
    if (!female) {
      patch('LowerLeg_R', BURLAP, burlap, rLo, front + 0.12 * out('R'), -0.06, 0.13, 1.5);
      patch('UpperLeg_L', shade(pants, 1.18), undefined, rUp(-thigh * 0.5), front + 0.5 * out('L'), -thigh * 0.5, 0.06, 0.75);
    } else {
      patch('LowerLeg_R', BURLAP, burlap, rLo, front + 0.1 * out('R'), -0.06, 0.12, 1.45);
      patch('LowerLeg_L', DENIM_FADED, splotch([shade(DENIM_FADED, 0.85)], 14, 0.3), rLo, front, -0.055, 0.11, 1.35);
      patch('UpperLeg_L', BURLAP, burlap, rUp(-thigh * 0.45), front + 0.55 * out('L'), -thigh * 0.45, 0.06, 0.7);
      patch('UpperLeg_R', shade(pants, 1.15), undefined, rUp(-0.02), front + 0.95 * out('R'), -0.02, 0.08, 0.6);
      patch('UpperLeg_L', BURLAP, burlap, rUp(-thigh * 0.7), 0.35, -thigh * 0.7, 0.09, 0.7);
    }
  }

  // ── Feet. ──
  const sh = s.shoes;
  for (const side of ['L', 'R'] as const) {
    if (sh.kind === 'boots') b.foot(side, { kind: 'boot', color: sh.upper, sole: shade(sh.upper, 0.45) });
    else if (sh.kind === 'sneakers') b.foot(side, { kind: 'sneaker', color: sh.upper, sole: 0x9a9486, accent: shade(sh.upper, 0.85), sock: 0x6e6c66 });
    else {
      b.foot(side, { kind: 'sock', color: skin, sock: skin });
    }
  }

  // The skin parts (their warm colour is the person's own, not the zombies' palette).
  for (const p of b.out) if (skins.has(p.color)) p.skin = true;
  return b.out;
}

interface ArmSpec {
  female: boolean;
  sleeve: 'none' | 'short' | 'long';
  cloth: number;
  paint?: ReturnType<typeof splotch>;
  glove: number | null;
  fist: boolean;
  jag: boolean;
  tape: boolean;
  sk: (f: number) => number;
}

function arm(b: Body, k: Kit, side: Side, o: ArmSpec): void {
  const { d } = b;
  const s = side === 'R' ? 1 : -1;
  const up = `UpperArm_${side}` as const;
  const lo = `LowerArm_${side}` as const;
  const hb = `Hand_${side}` as const;
  const skin = b.skin;
  const r = o.female ? 0.031 + 0.006 * (d.p.girth - 0.7) : 0.038 + 0.008 * (d.p.girth - 0.8);
  const sr = r + (o.female ? 0.011 : 0.013);
  const len = o.female ? 0.11 : 0.13;
  if (o.sleeve !== 'long') b.add(up, skin, k.rod([0, 0, 0], [0, -d.upperArm, 0], r, r * 0.84, 7));
  if (o.sleeve === 'short') {
    b.add(up, o.cloth, k.barrel(sr, sr, len + 0.02, 1.05, [0, 0.02 - (len + 0.02) / 2, 0], [0, 0, 0], 8), true, 0, o.paint);
    b.add(up, o.cloth, k.ball([sr, sr * 0.75, sr], [0, 0.0, 0], [0, 0, 0], 8, 5), true, 0, o.paint);
    if (o.jag)
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * 2 * (i / 6 + 0.07);
        b.add(up, o.cloth, k.cone(0.012, 0.022 + 0.008 * (i % 2), [sr * 1.04 * Math.sin(a), -len - 0.006, sr * 1.04 * Math.cos(a)], [Math.PI, 0, 0], 3), false);
      }
    if (o.tape) {
      // Grey tape wound round the sleeve on the outside, a strip across it.
      b.add(up, TAPE_GREY, k.shell(sr * 1.07, sr * 1.07, 0.032, Math.PI * 0.5 * s + Math.PI - 1.0, 2.0, [0, -len * 0.55, 0], 6), false);
      b.add(up, shade(TAPE_GREY, 0.92), k.box(0.004, 0.06, 0.028, [(sr + 0.004) * s, -len * 0.5, 0], [0, 0, 0.25 * s]), false);
    }
  }
  const long = o.sleeve === 'long';
  b.add(up, long ? o.cloth : skin, k.ball([r * 0.92, r * 0.92, r * 0.92], [0, -d.upperArm, 0.003], [0, 0, 0], 6, 4), true, 0, long ? o.paint : undefined);
  if (long) {
    b.add(up, o.cloth, k.rod([0, 0.035, 0], [0, -d.upperArm, 0], sr, sr * 0.9, 8), true, 0, o.paint);
    b.add(lo, o.cloth, k.rod([0, 0.02, 0], [0, -d.foreArm + 0.02, 0], sr * 0.85, sr * 0.72, 8), true, 0, o.paint);
    b.add(lo, shade(o.cloth, 0.8), k.barrel(sr * 0.76, sr * 0.76, 0.035, 1, [0, -d.foreArm + 0.025, 0], [0, 0, 0], 8));
  } else b.add(lo, skin, k.rod([0, 0, 0], [0, -d.foreArm, 0], r * 0.86, r * 0.6, 7));
  b.add(lo, skin, k.ball([r * 0.62, r * 0.55, r * 0.66], [0, -d.foreArm, 0], [0, 0, 0], 6, 4));
  // The hand (scaled by the body's hand size): a palm, four fingers, a thumb — relaxed and a little
  // curled towards the palm, or closed round a handle along the hand's Z (FIST_GRIP).
  const col = o.glove ?? skin;
  const th = o.glove !== null ? 1.25 : 1;
  if (o.glove !== null) b.add(lo, col, k.barrel(r * 1.25, r * 1.25, 0.06, 0.85, [0, -d.foreArm + 0.015, 0], [0, 0, 0], 8));
  b.add(hb, col, k.box(0.024 * th, 0.088, 0.072 * (o.glove !== null ? 1.1 : 1), [0, -0.048, 0]));
  const zs = [-0.026, -0.009, 0.009, 0.026];
  zs.forEach((z, i) => {
    const f = [0.95, 1, 0.96, 0.8][i];
    const k0: V3 = [-0.002 * s, -0.09, z];
    let k1: V3;
    let k2: V3;
    if (o.fist) {
      k1 = [-0.012 * s, -0.122 * f, z * 1.02];
      k2 = [-0.046 * s, -0.122 * f, z * 1.02];
    } else {
      k1 = [-0.01 * s, -0.09 - 0.045 * f, z * 1.05];
      k2 = [-0.026 * s, -0.09 - 0.078 * f, z * 1.08];
    }
    b.add(hb, col, k.rod(k0, k1, 0.0085 * th, 0.0075 * th, 4));
    b.add(hb, col, k.rod(k1, k2, 0.0075 * th, 0.006 * th, 4));
  });
  if (o.fist) b.add(hb, col, k.rod([-0.01 * s, -0.03, -0.036], [-0.044 * s, -0.078, -0.044], 0.0095 * th, 0.007 * th, 5));
  else b.add(hb, col, k.rod([-0.01 * s, -0.03, -0.036], [-0.026 * s, -0.082, -0.05], 0.0095 * th, 0.007 * th, 5));
  if (o.glove === null) o.sk(1);
}

/** A living face: brows, clear eyes, the nose, a closed mouth, ears; stubble or a beard on a man. */
function livingHead(b: Body, k: Kit, s: SurvivorSpec, sk: (f: number) => number): void {
  const female = s.sex === 'female';
  b.skull = female ? [0.086, 0.108, 0.1] : [0.09, 0.112, 0.104];
  const R = b.skull;
  const c = b.crown;
  const skin = b.skin;
  const v = [
    { jaw: 1, chin: 1, nose: 1, brow: 0 },
    { jaw: 1.1, chin: 1.12, nose: 1.12, brow: 0.003 },
    { jaw: 0.9, chin: 0.88, nose: 0.88, brow: -0.002 },
    { jaw: 1.04, chin: 0.96, nose: 1.25, brow: 0.004 },
  ][Math.abs(s.face) % 4];
  const jw = v.jaw * (female ? 0.9 : 1);
  b.add('Head', skin, k.ball(R, [c.x, c.y, c.z], [0, 0, 0], 10, 7));
  // Mid-face and cheekbones, the brow ridge over the eyes.
  b.add('Head', skin, k.ball([0.068 * jw, 0.055, 0.062], [0, 0.045, -0.03], [0, 0, 0], 8, 6));
  b.add('Head', sk(0.97), k.ball([0.06, 0.011, 0.013], [0, 0.103 + v.brow, -0.081], [0, 0, 0], 8, 4), false);
  // Eyes set in under the brow: a pale white, a dark iris, the lids over them; brows; ears.
  for (const x of [-1, 1]) {
    b.add('Head', SCLERA, k.ball([0.012, 0.0072, 0.007], [0.034 * x, 0.088, -0.081], [0, 0, 0], 6, 4), false);
    b.add('Head', IRIS, k.dot([0.005, 0.005, 0.002], [0.034 * x, 0.0878, -0.0874]), false);
    b.add('Head', sk(0.9), k.ball([0.0145, 0.0045, 0.0085], [0.034 * x, 0.0942, -0.082], [0, 0, 0.08 * x], 6, 3), false);
    b.add('Head', s.hairColor, k.box(female ? 0.028 : 0.032, female ? 0.004 : 0.006, 0.006, [0.035 * x, 0.103 + v.brow, -0.095], [0, 0.3 * x, -0.12 * x]), false);
    b.add('Head', sk(0.92), k.ball([0.011, 0.025, 0.017], [0.086 * x, 0.075, 0.014], [0, 0, 0.12 * x], 6, 4));
  }
  // The nose.
  const n = v.nose * (female ? 0.88 : 1);
  b.add('Head', skin, k.box(0.016 * n, 0.038 * n, 0.018 * n, [0, 0.07, -0.093], [-0.3, 0, 0]), false);
  b.add('Head', skin, k.ball([0.011 * n, 0.009 * n, 0.011 * n], [0, 0.05, -0.102]), false);
  for (const x of [-1, 1]) b.add('Head', sk(0.92), k.ball([0.0065 * n, 0.0055, 0.0075], [0.009 * x * n, 0.049, -0.097]), false);
  // A closed mouth: the lips' line, a fuller lower lip on her.
  b.add('Head', sk(0.68), k.box(female ? 0.034 : 0.036, 0.0035, 0.006, [0, 0.019, -0.086]), false);
  b.add('Head', sk(female ? 0.82 : 0.88), k.ball([female ? 0.016 : 0.015, female ? 0.0055 : 0.0042, 0.005], [0, 0.0135, -0.085], [0, 0, 0], 6, 3), false);
  // Jaw and chin (the jaw's frame sits 3.5 cm forward and up of the head's).
  b.add('Jaw', skin, k.ball([0.057 * jw, 0.032, 0.05], [0, -0.03, 0], [0, 0, 0], 9, 6));
  b.add('Jaw', skin, k.ball([0.023 * v.chin, 0.018, 0.017], [0, -0.04, -0.041], [0, 0, 0], 7, 5), false);
  if (!female && s.beard !== 'none') {
    const full = s.beard === 'full';
    const col = full ? s.hairColor : mix(s.hairColor, skin, 0.62);
    const paint = splotch([mix(s.hairColor, skin, full ? 0.15 : 0.75), mix(s.hairColor, skin, full ? 0 : 0.4)], full ? 40 : 70, 0.35);
    const g = full ? 1.14 : 1.03;
    b.add('Jaw', col, k.ball([0.057 * jw * g, 0.032 * g, 0.05 * g], [0, -0.031, -0.002 - (g - 1) * 0.03], [0, 0, 0], 9, 6), false, 0, paint);
    b.add('Jaw', col, k.ball([0.023 * v.chin * g, 0.018 * g, 0.017 * g], [0, -0.041, -0.042 - (g - 1) * 0.02], [0, 0, 0], 7, 5), false, 0, paint);
    // Over the upper lip and up the cheeks.
    b.add('Head', col, k.box(0.036, 0.007, 0.005, [0, 0.027, -0.088]), false, 0, paint);
    for (const x of [-1, 1]) b.add('Head', col, k.ball([0.012, 0.028, 0.034], [0.058 * x * jw, 0.03, -0.04], [0, 0, 0], 6, 4), false, 0, paint);
  }
}

function hair(b: Body, k: Kit, s: SurvivorSpec, female: boolean): void {
  const col = s.hairColor;
  const R = b.skull;
  const strand = (a: V3, c: V3, r0 = 0.006, r1 = 0.0015) => b.add('Head', col, k.rod(a, c, r0, r1, 3), false);
  const tuft = (n: V3, out: V3, len: number, r = 0.012) => {
    const a = b.onSkull(n, 1.02);
    const dir = new Vector3(...out).normalize().multiplyScalar(len);
    b.add('Head', col, k.rod(a, [a[0] + dir.x, a[1] + dir.y, a[2] + dir.z], r, 0.002, 4), false);
  };
  switch (s.hair) {
    case 'short':
      b.hair(col, { front: -0.5, puff: 1.07 });
      // Messy: tufts on top and a fringe falling over the forehead.
      tuft([0, 1, -0.2], [0.15, 0.25, -1], 0.032, 0.014);
      tuft([0.4, 0.88, -0.3], [0.7, 0.15, -1], 0.028, 0.013);
      tuft([-0.4, 0.88, -0.25], [-0.6, 0.2, -1], 0.028, 0.013);
      tuft([0.12, 0.8, -0.58], [0.15, -0.7, -1], 0.03, 0.012);
      tuft([-0.18, 0.76, -0.62], [-0.25, -0.75, -1], 0.026, 0.011);
      tuft([0.55, 0.9, 0.15], [1, 0.3, 0.3], 0.024, 0.012);
      tuft([-0.35, 0.95, 0.35], [-0.5, 0.3, 1], 0.024, 0.012);
      tuft([0.05, 0.75, 0.7], [0, -0.2, 1], 0.022, 0.012);
      break;
    case 'buzz':
      b.add('Head', mix(col, b.skin, 0.35), k.ball([R[0] * 1.02, R[1] * 0.98, R[2] * 1.02], [0, b.crown.y + 0.006, b.crown.z + 0.004], [-0.2, 0, 0], 10, 7), false);
      break;
    case 'curly':
      b.hair(col, { front: -0.4, puff: 1.14 });
      for (const n of [[0.5, 0.8, -0.4], [-0.5, 0.8, -0.4], [0, 1, -0.2], [0.6, 0.6, 0.4], [-0.6, 0.6, 0.4], [0, 0.6, 0.8]] as V3[]) b.add('Head', col, k.ball([0.034, 0.03, 0.034], b.onSkull(n, 1.08), [0, 0, 0], 6, 4));
      break;
    case 'long':
      b.hair(col, { front: -0.45, puff: 1.07 });
      b.skirt('Head', col, { y0: b.crown.y, y1: -0.13, rx: R[0] * 1.08, rz: R[2] * 1.05, flare: 1.12, open: 1.25, jag: true, z: 0.012 });
      break;
    case 'ponytail': {
      // Pulled back to a low ponytail; parted bangs to the sides, loose strands at the temples.
      b.hair(col, { front: -0.55, puff: 1.05 });
      const tie = b.onSkull([0, -0.1, 1], 1.05);
      b.add('Head', shade(col, 0.6), k.barrel(0.019, 0.019, 0.014, 1, tie, [0.5, 0, 0], 7), false);
      const p1: V3 = [0, tie[1] - 0.06, tie[2] + 0.025];
      const p2: V3 = [0.006, tie[1] - 0.15, tie[2] + 0.01];
      const p3: V3 = [0.012, tie[1] - 0.22, tie[2] - 0.012];
      b.add('Head', col, k.rod(tie, p1, 0.022, 0.024, 6));
      b.add('Head', col, k.rod(p1, p2, 0.024, 0.016, 6));
      b.add('Head', col, k.rod(p2, p3, 0.016, 0.004, 5));
      for (const x of [-1, 1]) {
        const a = b.onSkull([0.85 * x, 0.15, -0.45], 1.03);
        strand(a, [0.08 * x, 0.03, -0.055], 0.0035, 0.0012);
      }
      break;
    }
    case 'bald':
      break;
  }
  if (female && s.hair === 'short') tuft([0.7, 0.3, -0.3], [0.2, -1, -0.2], 0.05);
}

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The base looks in the reference clothes (the twins and the viewer). */
export function refSurvivor(sex: SurvivorSex, zombie = false): SurvivorSpec {
  const c = REF_CLOTHES[sex];
  const f = sex === 'female';
  return {
    sex,
    build: f ? 'slim' : 'average',
    height: f ? 166 : 178,
    skin: f ? 0xe8c4a8 : 0xd9a882,
    face: f ? 2 : 0,
    hair: f ? 'ponytail' : 'short',
    hairColor: f ? 0xd0b47a : 0x5e3e22,
    beard: f ? 'none' : 'stubble',
    worn: { torso: 'tshirt', legs: 'jeans', feet: 'sneakers' },
    top: c.tee,
    sleeves: null,
    pants: c.jeans,
    shoes: { kind: 'sneakers', upper: c.shoes },
    gloves: null,
    dirt: { torso: 0.35, legs: 0.5, feet: 0.6 },
    zombie,
  };
}

/** The risen survivors in the reference clothes: a dead player's twin (by sex). */
export const SURVIVOR_M: ZombieType = survivorType(refSurvivor('male', true), 'survivorM', 'survivorM');
export const SURVIVOR_F: ZombieType = survivorType(refSurvivor('female', true), 'survivorF', 'survivorF');
SURVIVOR_M.name = 'Выживший (зомби)';
SURVIVOR_F.name = 'Выжившая (зомби)';
