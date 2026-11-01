import { ConeGeometry, CylinderGeometry, Euler, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import type { Kit, PartSpec, Pattern, ZombieType } from '../buildZombie';
import type { BoneName, SkeletonDims } from '../skeleton';
import { type ModelKind, ZOMBIE_STATS } from '../stats';

/** A type's game numbers from its kind's factors on the worker (walk 0.5, run 1.1 m/s, 100 HP). */
export function kindNumbers(kind: ModelKind): Pick<ZombieType, 'walk' | 'run' | 'animSpeed' | 'hp'> {
  const s = ZOMBIE_STATS[kind];
  return { walk: 0.5 * s.speed, run: 1.1 * s.speed, animSpeed: 0.85 * Math.sqrt(s.speed), hp: Math.round(100 * s.hp) };
}

/**
 * Shared pieces of the procedural zombie types: a body (`Body`) that knows the skeleton's sizes and builds
 * a trunk, arms with sleeves and hands, legs, footwear, a zombie head with its face — each in the frame of
 * its bone. A type sets the build and colours and adds its own gear (hats, vests, bags…).
 * Head and jaw parts are scaled about the skull's base by the head size; hands by the hand size.
 */
export type V3 = [number, number, number];
export type Geo = PartSpec['geo'];
export type Paint = Pattern;
export type Side = 'L' | 'R';

export const ZSKIN = 0x8c9a84;
export const STITCH = 0x2b2b2b;
export const MOUTH = 0x3a2a2a;
export const TEETH = 0xd6d0b0;
export const SOCKET = 0x4d5547;
export const EYE = 0xeae3a0;

/** A colour darker (f < 1) or lighter (f > 1). */
export function shade(hex: number, f: number): number {
  const c = (s: number) => Math.min(255, Math.round(((hex >> s) & 255) * f));
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Blotches over the part's colour (camouflage, grime): one or two colours, `share` of the area. */
export function splotch(spots: number[], scale = 9, share = 0.45): Paint {
  return { kind: 'spots', a: spots[0], b: spots[1] ?? spots[0], scale, share };
}

/** A check: two colours by square cells (size m) in the bone frame. */
export function check(a: number, b: number, size = 0.05): Paint {
  return { kind: 'check', a, b, scale: 1 / size, share: 0 };
}

/** Blossoms (colour a, heart b) scattered over the part, about one in 1/share cells (size 1/scale m). */
export function flowers(a: number, b: number, scale = 14, share = 0.5): Paint {
  return { kind: 'flowers', a, b, scale, share };
}

/** Round blobs of a or b (a print). */
export function print(a: number, b: number, scale = 12, share = 0.6): Paint {
  return { kind: 'print', a, b, scale, share };
}

/** The top of an ellipsoid (a helmet, a cap): `cut` of its height from the top (0.5 a half), open below. */
export function dome(r: V3, at: V3, rot: V3 = [0, 0, 0], cut = 0.5, ws = 9, hs = 4): Geo {
  const g = new SphereGeometry(1, ws, hs, 0, Math.PI * 2, 0, Math.PI * cut);
  return g.applyMatrix4(new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(new Euler(...rot)), new Vector3(...r)));
}

export interface TorsoOpts {
  top: number;
  topPaint?: Paint;
  /** Chest half width / depth (m). */
  w?: number;
  dz?: number;
  /** 0 flat … 1 a big round belly. */
  belly?: number;
  /** Belly (Spine) and seat (Hips) colours. */
  mid?: number;
  midPaint?: Paint;
  seat: number;
  seatPaint?: Paint;
  bust?: boolean;
}

export interface ArmOpts {
  sleeve: 'none' | 'short' | 'rolled' | 'elbow' | 'long';
  cloth?: number;
  clothPaint?: Paint;
  /** The roll of a rolled sleeve / the cuff of a long one. */
  cuff?: number;
  r?: number;
  sleeveR?: number;
  jag?: boolean;
  /** Gloved hand (colour). */
  glove?: number;
}

export interface LegOpts {
  pants: number;
  pantsPaint?: Paint;
  shorts?: boolean;
  r?: number;
  /** Bottom of the leg wider (1 straight). */
  flare?: number;
  cuff?: number;
}

export type FootKind = 'boot' | 'tall' | 'sneaker' | 'clog' | 'slipper' | 'sock' | 'sandal' | 'shoe';
export interface FootOpts {
  kind: FootKind;
  color: number;
  sole?: number;
  accent?: number;
  sock?: number;
}

export interface HeadOpts {
  skull?: V3;
  eyes?: { color?: number; glow?: number; left?: 'glow' | 'swollen' };
  mouth?: 'open' | 'grim';
  stitches?: ('cheekR' | 'cheekL' | 'brow' | 'chin')[];
  /** A heavy square jaw (1) … narrow (0.8). */
  jaw?: number;
  cracks?: boolean;
  ears?: boolean;
}

export class Body {
  readonly out: PartSpec[] = [];
  private readonly big: Matrix4;
  private readonly bigHand: Matrix4;
  readonly crown = new Vector3(0, 0.1, 0.012);
  skull: V3 = [0.098, 0.122, 0.112];

  constructor(
    readonly d: SkeletonDims,
    readonly k: Kit,
    readonly skin = ZSKIN,
    hand = 1,
  ) {
    const h = d.p.head ?? 1;
    this.big = new Matrix4().makeScale(h, h, h);
    this.bigHand = new Matrix4().makeScale(hand, hand, hand);
  }

  add(bone: BoneName, color: number, geo: Geo, outline = true, glow = 0, paint?: Paint): void {
    const g = bone === 'Head' || bone === 'Jaw' ? this.k.frame(geo, this.big) : bone.startsWith('Hand') ? this.k.frame(geo, this.bigHand) : geo;
    this.out.push({ bone, color, geo: g, outline, glow, paint });
  }

  /** A point on the skull in a direction (lift > 1 just above it). */
  onSkull(n: V3, lift = 1): V3 {
    const v = new Vector3(...n).normalize();
    const R = this.skull;
    return [this.crown.x + R[0] * v.x * lift, this.crown.y + R[1] * v.y * lift, this.crown.z + R[2] * v.z * lift];
  }

  get chestH(): number {
    return this.d.shoulderY - this.d.chestY + 0.06;
  }

  /** Default chest half width / depth for the build. */
  get chestW(): number {
    return this.d.shoulderX * 0.86;
  }
  get chestDz(): number {
    return 0.065 + 0.026 * this.d.p.girth;
  }

  torso(o: TorsoOpts): { w: number; dz: number; h: number; hipRx: number; hipRz: number; len: number } {
    const { d, k } = this;
    const w = o.w ?? this.chestW;
    const dz = o.dz ?? this.chestDz;
    const b = o.belly ?? 0;
    const h = this.chestH;
    this.add('Chest', o.top, k.barrel(w, dz, h, 0.86 + b * 0.3, [0, h / 2 - 0.02, 0], [0, 0, 0], 10), true, 0, o.topPaint);
    this.add('Chest', o.top, k.ball([w, 0.055, dz], [0, h - 0.02, 0], [0, 0, 0], 10, 5), true, 0, o.topPaint);
    if (b > 0) this.add('Chest', o.top, k.ball([w * 0.92, h * 0.38, dz + 0.07 * b], [0, h * 0.22, -0.035 * b], [0, 0, 0], 9, 6), true, 0, o.topPaint);
    if (o.bust) for (const s of [-1, 1]) this.add('Chest', o.top, k.ball([0.045, 0.04, 0.035], [w * 0.42 * s, h * 0.5, -dz * 0.8], [0, 0, 0], 6, 4), false, 0, o.topPaint);
    const len = d.chestY - d.spineY;
    const mid = o.mid ?? o.top;
    const midPaint = o.mid === undefined ? o.topPaint : o.midPaint;
    this.add('Spine', mid, k.barrel(w * 0.9 + 0.04 * b, dz + 0.05 * b, len + 0.05, 1, [0, len / 2, 0], [0, 0, 0], 10), true, 0, midPaint);
    if (b > 0) this.add('Spine', mid, k.ball([w * 0.86 + 0.04 * b, len * 0.75, dz + 0.11 * b], [0, len * 0.45, -0.045 * b], [0, 0, 0], 9, 6), true, 0, midPaint);
    const rx = Math.max(w * 0.92, d.hipX + 0.07) + b * 0.03;
    const rz = dz * 1.04 + 0.02 * b;
    this.add('Hips', o.seat, k.barrel(rx, rz, 0.17, 0.92, [0, -0.02, 0], [0, 0, 0], 10), true, 0, o.seatPaint);
    this.add('Hips', o.seat, k.ball([rx * 0.55, 0.04, rz * 0.8], [0, -0.1, 0]), true, 0, o.seatPaint);
    return { w, dz, h, hipRx: rx, hipRz: rz, len };
  }

  neck(r = 0.042, color = this.skin): void {
    this.add('Neck', color, this.k.rod([0, -0.05, 0], [0, this.d.headY - this.d.neckY + 0.04, 0], r, r * 0.86, 7));
  }

  arm(side: Side, o: ArmOpts): void {
    const { d, k } = this;
    const s = side === 'R' ? 1 : -1;
    const up = `UpperArm_${side}` as BoneName;
    const lo = `LowerArm_${side}` as BoneName;
    const hb = `Hand_${side}` as BoneName;
    const r = o.r ?? 0.036 + 0.008 * (d.p.girth - 0.8);
    const sr = o.sleeveR ?? r + 0.03;
    const cloth = o.cloth ?? this.skin;
    const len = { none: 0, short: 0.14, elbow: d.upperArm * 0.85, rolled: d.upperArm * 0.72, long: d.upperArm + 0.02 }[o.sleeve];
    if (o.sleeve !== 'long') this.add(up, this.skin, k.rod([0, 0, 0], [0, -d.upperArm, 0], r, r * 0.87, 6));
    if (len > 0) {
      this.add(up, cloth, k.barrel(sr, sr, len + 0.035, 1.05, [0, 0.035 - (len + 0.035) / 2, 0], [0, 0, 0], 8), true, 0, o.clothPaint);
      if (o.sleeve === 'rolled') this.add(up, o.cuff ?? shade(cloth, 1.15), k.barrel(sr * 1.12, sr * 1.12, 0.045, 1, [0, -len, 0], [0, 0, 0], 8));
      if (o.jag)
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * 2 * (i / 5 + 0.1);
          this.add(up, cloth, k.cone(0.015, 0.03, [sr * 1.05 * Math.sin(a), -len - 0.01, sr * 1.05 * Math.cos(a)], [Math.PI, 0, 0], 3), false);
        }
    }
    const longArm = o.sleeve === 'long';
    this.add(up, longArm ? cloth : this.skin, k.ball([r * 0.95, r * 0.95, r * 0.95], [0, -d.upperArm, 0.004], [0, 0, 0], 6, 4), true, 0, longArm ? o.clothPaint : undefined);
    if (longArm) {
      this.add(lo, cloth, k.rod([0, 0.02, 0], [0, -d.foreArm + 0.02, 0], sr * 0.85, sr * 0.72, 8), true, 0, o.clothPaint);
      this.add(lo, o.cuff ?? cloth, k.barrel(sr * 0.76, sr * 0.76, 0.04, 1, [0, -d.foreArm + 0.025, 0], [0, 0, 0], 8));
    } else this.add(lo, this.skin, k.rod([0, 0, 0], [0, -d.foreArm, 0], r * 0.87, r * 0.67, 6));
    this.add(lo, this.skin, k.ball([r * 0.75, r * 0.67, r * 0.75], [0, -d.foreArm, 0], [0, 0, 0], 6, 4));
    // The hand: palm inward, three long fingers and a thumb curling in; a glove is chunkier.
    const g = o.glove;
    const col = g ?? this.skin;
    const th = g ? 1.35 : 1;
    if (g) this.add(lo, g, k.barrel(r * 1.5, r * 1.5, 0.09, 0.85, [0, -d.foreArm + 0.02, 0], [0, 0, 0], 8));
    this.add(hb, col, k.box(0.032 * th, 0.1, 0.085 * (g ? 1.12 : 1), [0, -0.055, 0]));
    [-0.028, 0, 0.028].forEach((z, i) => {
      const f = i === 2 ? 0.88 : 1;
      const k0: V3 = [0.002 * s, -0.105, z];
      const k1: V3 = [-0.018 * s, -0.105 - 0.07 * f, z * 1.1];
      const k2: V3 = [-0.04 * s, -0.105 - 0.12 * f, z * 1.15];
      this.add(hb, col, k.rod(k0, k1, 0.011 * th, 0.009 * th, 5));
      this.add(hb, col, k.rod(k1, k2, 0.009 * th, 0.006 * th, 5));
    });
    this.add(hb, col, k.rod([-0.012 * s, -0.03, -0.04], [-0.03 * s, -0.085, -0.066], 0.011 * th, 0.008 * th, 5));
  }

  legs(o: LegOpts): void {
    const { d, k } = this;
    const thigh = d.hipJointY - d.kneeY;
    const shin = d.kneeY - d.ankleY;
    const r = o.r ?? 0.064 + 0.012 * d.p.girth;
    const fl = o.flare ?? 1;
    for (const side of ['L', 'R'] as const) {
      const up = `UpperLeg_${side}` as BoneName;
      const lo = `LowerLeg_${side}` as BoneName;
      if (o.shorts) {
        this.add(up, o.pants, k.rod([0, 0.05, 0], [0, -thigh * 0.62, 0], r * 1.08, r * 1.14, 8), true, 0, o.pantsPaint);
        this.add(up, this.skin, k.rod([0, -thigh * 0.5, 0], [0, -thigh, 0], r * 0.64, r * 0.58, 6));
        this.add(lo, this.skin, k.ball([r * 0.6, r * 0.6, r * 0.6], [0, 0, 0], [0, 0, 0], 6, 4));
        this.add(lo, this.skin, k.rod([0, 0, 0], [0, -shin + 0.03, 0], r * 0.58, r * 0.42, 6));
      } else {
        this.add(up, o.pants, k.rod([0, 0.05, 0], [0, -thigh, 0], r, r * 0.88, 8), true, 0, o.pantsPaint);
        this.add(lo, o.pants, k.rod([0, 0.02, 0], [0, -shin + 0.06, 0], r * 0.86, r * 0.86 * fl, 8), true, 0, o.pantsPaint);
        if (o.cuff !== undefined) this.add(lo, o.cuff, k.rod([0, -shin + 0.12, 0], [0, -shin + 0.06, 0], r * 0.9 * fl, r * 0.92 * fl, 8));
      }
    }
  }

  foot(side: Side, o: FootOpts): void {
    const { k } = this;
    const a = this.d.ankleY;
    const ft = `Foot_${side}` as BoneName;
    const add = (c: number, g: Geo, line = true) => this.add(ft, c, g, line);
    const sole = o.sole ?? shade(o.color, 0.6);
    const sock = o.sock ?? 0xd6d3c8;
    switch (o.kind) {
      case 'boot':
      case 'tall': {
        const tall = o.kind === 'tall';
        add(o.color, k.barrel(0.068, 0.072, tall ? 0.24 : 0.12, 1.04, [0, tall ? 0.09 : 0.03, -0.004], [0, 0, 0], 8));
        add(o.color, k.box(0.122, 0.082, 0.22, [0, -a + 0.052, -0.035]));
        add(o.color, k.ball([0.062, 0.045, 0.06], [0, -a + 0.05, -0.145], [0, 0, 0], 8, 5));
        add(sole, k.box(0.136, 0.022, 0.28, [0, -a + 0.011, -0.05]));
        if (o.accent !== undefined) for (let i = 0; i < 3; i++) add(o.accent, k.box(0.05, 0.006, 0.012, [0, 0.06 - i * 0.03, -0.074], [0.3, 0, 0]), false);
        break;
      }
      case 'sneaker':
      case 'shoe': {
        const sn = o.kind === 'sneaker';
        add(sock, k.barrel(0.048, 0.05, 0.08, 1, [0, 0.02, 0], [0, 0, 0], 7));
        add(o.color, k.box(sn ? 0.11 : 0.1, sn ? 0.07 : 0.06, 0.2, [0, -a + 0.048, -0.04]));
        add(o.color, k.ball([sn ? 0.055 : 0.05, sn ? 0.04 : 0.034, 0.06], [0, -a + 0.04, -0.13], [0, 0, 0], 8, 5));
        add(sole, k.box(sn ? 0.12 : 0.105, sn ? 0.024 : 0.016, 0.26, [0, -a + (sn ? 0.012 : 0.008), -0.045]));
        if (o.accent !== undefined) for (const t of [-1, 1]) add(o.accent, k.box(0.004, 0.014, 0.1, [0.056 * t, -a + 0.055, -0.04], [0.35, 0, 0]), false);
        break;
      }
      case 'clog': {
        add(sock, k.barrel(0.046, 0.05, 0.06, 1, [0, 0.01, 0], [0, 0, 0], 7));
        add(o.color, k.ball([0.068, 0.055, 0.135], [0, -a + 0.045, -0.055], [0, 0, 0], 8, 5));
        add(sole, k.box(0.13, 0.02, 0.27, [0, -a + 0.01, -0.05]));
        for (let i = 0; i < 2; i++) add(shade(o.color, 0.75), k.dot([0.01, 0.004, 0.01], [(i % 2 ? 0.022 : -0.022), -a + 0.093, -0.09 + i * 0.035]), false);
        add(o.color, k.rod([-0.06, -a + 0.05, 0.02], [0.06, -a + 0.05, 0.02], 0.008, 0.008, 4), false);
        break;
      }
      case 'slipper': {
        add(this.skin, k.rod([0, 0.04, 0], [0, -a + 0.03, -0.01], 0.04, 0.042, 6));
        add(o.color, k.ball([0.078, 0.048, 0.14], [0, -a + 0.04, -0.05], [0, 0, 0], 8, 5));
        add(sole, k.box(0.12, 0.016, 0.25, [0, -a + 0.008, -0.05]));
        break;
      }
      case 'sock':
      case 'sandal': {
        add(sock, k.barrel(0.046, 0.046, 0.14, 1, [0, 0.03, 0], [0, 0, 0], 7));
        add(shade(sock, 0.9), k.barrel(0.052, 0.052, 0.03, 1, [0, 0.09, 0], [0, 0, 0], 7));
        add(sock, k.ball([0.052, 0.04, 0.125], [0, -a + 0.04, -0.05], [0, 0, 0], 7, 5));
        if (o.kind === 'sandal') {
          add(o.color, k.box(0.115, 0.022, 0.26, [0, -a + 0.011, -0.05]));
          for (const z of [-0.09, -0.02]) add(o.color, k.box(0.112, 0.022, 0.03, [0, -a + 0.065 + z * 0.15, z]), false);
        }
        break;
      }
    }
  }

  /** The zombie head: long skull, glowing eyes in dark sockets, sunken cheeks, nose, mouth, jaw, ears. */
  head(o: HeadOpts = {}): void {
    const { k } = this;
    if (o.skull) this.skull = o.skull;
    const R = this.skull;
    const skin = this.skin;
    const dark = shade(skin, 0.85);
    this.add('Head', skin, k.ball(R, this.crown.toArray() as V3, [0, 0, 0], 10, 8));
    this.add('Head', skin, k.ball([0.07, 0.055, 0.07], [0, 0.04, -0.045]));
    this.add('Head', dark, k.ball([0.078, 0.017, 0.026], [0, 0.113, -0.088]), false);
    this.add('Head', skin, k.cone(0.016, 0.034, [0, 0.055, -0.116], [-1.9, 0, 0], 4), false);
    const eye = o.eyes?.color ?? EYE;
    const glow = o.eyes?.glow ?? 1.1;
    for (const s of [-1, 1]) {
      this.add('Head', shade(skin, 0.78), k.dot([0.012, 0.03, 0.026], [0.066 * s, 0.022, -0.062], [0, 0.5 * s, 0]));
      this.add('Head', SOCKET, k.dot([0.026, 0.022, 0.012], [0.04 * s, 0.085, -0.103]), false);
      if (s < 0 && o.eyes?.left === 'swollen') {
        this.add('Head', 0xa8928c, k.ball([0.028, 0.022, 0.018], [-0.041, 0.083, -0.105]), false);
        this.add('Head', STITCH, k.box(0.034, 0.004, 0.004, [-0.041, 0.082, -0.123], [0, 0, 0.12]), false);
      } else {
        this.add('Head', eye, k.ball([0.018, 0.015, 0.012], [0.04 * s, 0.084, -0.108], [0, 0, 0], 6, 4), false, glow);
        this.add('Head', STITCH, k.dot([0.005, 0.005, 0.003], [0.041 * s, 0.083, -0.12]), false);
      }
      if (o.ears !== false) this.add('Head', dark, k.ball([0.012, 0.03, 0.02], [0.098 * s, 0.07, 0.012], [0, 0, 0.15 * s], 6, 4));
    }
    // Mouth: open — dark with crooked teeth over a dropped jaw; grim — a tight dark line, a tooth showing.
    const jw = o.jaw ?? 0.9;
    if (o.mouth === 'grim') {
      this.add('Head', MOUTH, k.box(0.06, 0.008, 0.02, [0, 0.008, -0.103]), false);
      this.add('Head', TEETH, k.box(0.01, 0.01, 0.006, [0.012, 0.004, -0.112]), false);
    } else {
      this.add('Head', MOUTH, k.box(0.066, 0.04, 0.045, [0.004, -0.002, -0.083]), false);
      this.add('Head', TEETH, k.box(0.012, 0.016, 0.008, [-0.014, -0.011, -0.106], [0, 0, 0.1]), false);
      this.add('Head', TEETH, k.box(0.011, 0.014, 0.008, [0.017, -0.012, -0.104], [0, 0, -0.15]), false);
      this.add('Jaw', MOUTH, k.box(0.062, 0.006, 0.066, [0, -0.027, -0.05]), false);
      this.add('Jaw', TEETH, k.box(0.012, 0.014, 0.008, [-0.016, -0.02, -0.083], [0, 0, -0.1]), false);
    }
    this.add('Jaw', skin, k.ball([0.052 * jw, 0.026, 0.054], [0, -0.04, -0.048]));
    this.add('Jaw', skin, k.ball([0.032 * jw, 0.02, 0.024], [0, -0.05, -0.088]), false);
    for (const st of o.stitches ?? []) this.stitch(st);
    if (o.cracks) {
      const crack = (a: V3, b: V3) => this.add('Head', STITCH, k.rod(this.onSkull(a, 1.02), this.onSkull(b, 1.025), 0.003, 0.002, 3), false);
      crack([0.3, 0.92, 0.22], [0.6, 0.7, 0.3]);
      crack([-0.25, 0.62, -0.75], [-0.08, 0.5, -0.86]);
    }
  }

  private stitch(where: 'cheekR' | 'cheekL' | 'brow' | 'chin'): void {
    const { k } = this;
    let a: Vector3;
    let b: Vector3;
    if (where === 'brow') {
      a = new Vector3(...this.onSkull([-0.45, 0.45, -0.77], 1.01));
      b = new Vector3(...this.onSkull([-0.05, 0.62, -0.78], 1.01));
    } else if (where === 'chin') {
      a = new Vector3(0.02, 0.03, -0.11);
      b = new Vector3(0.045, 0.0, -0.1);
    } else {
      const s = where === 'cheekR' ? 1 : -1;
      a = new Vector3(0.05 * s, 0.066, -0.095);
      b = new Vector3(0.056 * s, 0.012, -0.088);
    }
    this.add('Head', STITCH, k.rod(a.toArray() as V3, b.toArray() as V3, 0.003, 0.003, 3), false);
    const along = b.clone().sub(a);
    const across = new Vector3().crossVectors(along, new Vector3(0, 0, -1)).normalize().multiplyScalar(0.011);
    if (across.lengthSq() < 1e-8) across.set(0.011, 0, 0);
    for (let i = 0; i < 4; i++) {
      const p = a.clone().lerp(b, (i + 0.5) / 4);
      this.add('Head', STITCH, k.rod(p.clone().sub(across).toArray() as V3, p.clone().add(across).toArray() as V3, 0.0025, 0.0025, 3), false);
    }
  }

  /**
   * A hanging tube of cloth on a bone — a coat's skirt, a robe, an apron round the body — from y0 down to y1
   * (bone frame), radii at the top, wider at the hem by `flare`; `open` leaves a gap at the front (rad each
   * side of −Z), `jag` tears the hem into points.
   */
  skirt(bone: BoneName, color: number, o: { y0: number; y1: number; rx: number; rz: number; flare?: number; open?: number; jag?: boolean; paint?: Paint; z?: number }): void {
    const h = o.y0 - o.y1;
    const fl = o.flare ?? 1.1;
    const open = o.open ?? 0;
    const g = new CylinderGeometry(1, fl, h, 12, 1, true, open ? -Math.PI + open : 0, open ? Math.PI * 2 - 2 * open : Math.PI * 2);
    g.applyMatrix4(new Matrix4().makeScale(o.rx, 1, o.rz).setPosition(0, o.y0 - h / 2, o.z ?? 0));
    this.add(bone, color, g, true, 0, o.paint);
    if (!o.jag) return;
    for (let i = 0; i < 9; i++) {
      const a = open ? -Math.PI + open + 0.15 + (i / 8) * (Math.PI * 2 - 2 * open - 0.3) : (i / 9) * Math.PI * 2;
      const c = new ConeGeometry(0.028, 0.05 + 0.03 * ((i * 5) % 3) / 2, 3).rotateX(Math.PI);
      c.translate(o.rx * fl * Math.sin(a), o.y1 - 0.025, (o.z ?? 0) + o.rz * fl * Math.cos(a));
      this.add(bone, color, c, false, 0, o.paint);
    }
  }

  /** Hair over the top and back of the skull (front edge at `front`: -1 down to the brow … 0 the crown). */
  hair(color: number, o: { front?: number; puff?: number; paint?: Paint } = {}): void {
    const R = this.skull;
    const p = o.puff ?? 1.06;
    const f = o.front ?? -0.35;
    this.add('Head', color, this.k.ball([R[0] * p, R[1] * p * 0.92, R[2] * p * 0.95], [0, this.crown.y + 0.012 - f * 0.02, this.crown.z + 0.03 + f * 0.012], [-0.25, 0, 0], 10, 7), true, 0, o.paint);
  }
}
