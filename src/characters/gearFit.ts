import { Matrix4, Quaternion, Vector3 } from 'three';
import { registerDataLocalizer } from '../core/i18n';
import RAW from '../data/gearFit.json';
import type { GearId } from '../data/items';
import type { BodyId, RigAsset } from './assets';

/**
 * Hand fixes of the fitted gear (the gear editor, ?gearedit=<id>, debug/gearEditor.ts → src/data/gearFit.json),
 * on top of what tools/build-gear.mjs fitted: per piece and body, data only —
 *  - `pos` / `rot` / `scale`: a move, a turn and a uniform scale in the frame of the piece's bone at bind
 *    (`bone`, else Head for the head and face, Spine2 for vests and packs, Hips for the bag and the box), the
 *    turn and the scale about `pivot` (the nose bridge for glasses and masks; else the middle of the piece);
 *  - `push`: the surface moved out from the body along its normals (cm; < 0 in);
 *  - `bone`: the whole piece rigid on that bone (glasses and masks on Head) instead of the fitted weights;
 *  - `pivot` / `earL` / `earR`: the nose bridge and the ears of the body (bind space, m) — the editor's
 *    «Посадить по опорам» puts the glasses' bridge and temples on them;
 *  - `show`: body regions the piece does not hide (its cover bit cleared there).
 * Applied in characters/gear (`gearGeometry`, `coverBody`): the player, the menu and the zombies alike.
 */

export type V3 = [number, number, number];
export const REGIONS = ['head', 'neck', 'torso', 'arms', 'hands', 'hips', 'legs', 'feet'] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_NAMES: Record<Region, string> = { head: 'голова', neck: 'шея', torso: 'торс', arms: 'руки', hands: 'кисти', hips: 'таз', legs: 'ноги', feet: 'ступни' };

const REGION_TEXT: Readonly<Record<Region, [string, string]>> = {
  head: ['голова', 'head'],
  neck: ['шея', 'neck'],
  torso: ['торс', 'torso'],
  arms: ['руки', 'arms'],
  hands: ['кисти', 'hands'],
  hips: ['таз', 'hips'],
  legs: ['ноги', 'legs'],
  feet: ['ступни', 'feet'],
};

registerDataLocalizer((lang) => {
  const idx = lang === 'en' ? 1 : 0;
  for (const r of REGIONS) REGION_NAMES[r] = REGION_TEXT[r][idx];
});

export interface PieceFit {
  pos?: V3;
  rot?: [number, number, number, number];
  scale?: number;
  push?: number;
  bone?: string;
  pivot?: V3;
  earL?: V3;
  earR?: V3;
  show?: Region[];
}
export type GearFit = Partial<Record<GearId, Partial<Record<BodyId, PieceFit>>>>;

/** The fits in use (the editor changes them in place, then calls gear's `gearFitChanged`). */
export const GEAR_FIT: GearFit = RAW as GearFit;

export function fitOf(g: GearId, body: BodyId): PieceFit | undefined {
  return GEAR_FIT[g]?.[body];
}

/** The bone a piece's offset is in when the fit names none. */
export function frameBone(kind: string | null, fit?: PieceFit, rigidBone?: string): string {
  if (fit?.bone) return fit.bone;
  if (rigidBone) return rigidBone;
  if (kind === 'helmet' || kind === 'glasses' || kind === 'mask') return 'Head';
  if (kind === 'bag' || kind === 'box') return 'Hips';
  return 'Spine2';
}

/** A body vertex's region by its bone. */
export function regionOf(bone: string): Region {
  if (/Head|Eye/.test(bone)) return 'head';
  if (/Neck/.test(bone)) return 'neck';
  if (/Hand|Thumb|Index|Middle|Ring|Pinky/.test(bone)) return 'hands';
  if (/ForeArm|Arm/.test(bone)) return 'arms';
  if (/Foot|Toe/.test(bone)) return 'feet';
  if (/UpLeg|Leg/.test(bone)) return 'legs';
  if (/Hips/.test(bone)) return 'hips';
  return 'torso';
}

/** Whether a fit moves the geometry at all. */
export function fitMoves(f: PieceFit | undefined): boolean {
  return !!f && (!!f.pos || !!f.rot || (f.scale !== undefined && f.scale !== 1) || !!f.push || !!f.bone);
}

/**
 * The fit's bind-space matrix: bone · T(pivotL + pos) · R · S · T(−pivotL) · bone⁻¹ (pivotL the pivot in the
 * bone's frame).
 */
export function fitMatrix(f: PieceFit, bind: Matrix4, pivot: Vector3, out = new Matrix4()): Matrix4 {
  const inv = bind.clone().invert();
  const pl = pivot.clone().applyMatrix4(inv);
  const t = pl.clone().add(new Vector3(...(f.pos ?? [0, 0, 0])));
  const q = f.rot ? new Quaternion(...f.rot).normalize() : new Quaternion();
  const s = f.scale ?? 1;
  out.compose(t, q, new Vector3(s, s, s)).multiply(new Matrix4().makeTranslation(-pl.x, -pl.y, -pl.z));
  return out.premultiply(bind).multiply(inv);
}

/** The pivot a fit turns about: its own, else the piece's middle at bind. */
export function fitPivot(f: PieceFit | undefined, middle: Vector3): Vector3 {
  return f?.pivot ? new Vector3(...f.pivot) : middle.clone();
}

/** The bone's bind matrix on a rig (Head if it has no such bone). */
export function boneBind(rig: RigAsset, bone: string): Matrix4 {
  return rig.bind[rig.index.get(bone) ?? rig.index.get('Head') ?? 0];
}

/** Moves positions and normals (flat xyz arrays) by a fit, in place. */
export function applyFit(pos: Float32Array, nor: Float32Array, f: PieceFit, m: Matrix4): void {
  const nm = new Matrix4().extractRotation(m);
  const v = new Vector3(), n = new Vector3();
  const push = (f.push ?? 0) / 100;
  for (let i = 0; i < pos.length; i += 3) {
    n.fromArray(nor, i).applyMatrix4(nm).normalize();
    v.fromArray(pos, i).applyMatrix4(m).addScaledVector(n, push);
    v.toArray(pos, i);
    n.toArray(nor, i);
  }
}
