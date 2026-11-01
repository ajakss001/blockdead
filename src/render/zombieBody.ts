import { BoxGeometry, type BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BODY_PARTS, type BodyShape, PART, type PartPose, Ragdoll, type StaticBox } from '../physics/ragdoll';
import type { Zombie } from '../systems/zombies';

/**
 * The zombie body — shared by the renderer (ZombieCrowd's vertex shader animates the living; CorpseBatch
 * draws the dead from their ragdolls) and the death code (the animated pose the ragdoll starts from).
 *
 * Joints (vertex attribute aJoint): 0 torso, 1/2 left/right thigh, 6/7 left/right shin (+ shoe),
 * 3/4 left/right upper arm, 8/9 left/right forearm (+ hand), 5 head. Model faces +Z, feet at y = 0.
 */
export const HIP_Y = 0.9;
export const KNEE_Y = 0.5;
export const SHOULDER_Y = 1.42;
export const ELBOW_Y = 1.08;
export const NECK_Y = 1.46;
export const HIP_X = 0.1;
export const SHOULDER_X = 0.25;
/** Torso vertices below this belong to the pelvis, above to the chest. */
const WAIST_Y = 1.165;

// Parts (vertex attribute aPart): what colour.
const SKIN = 0;
const SHIRT = 1;
const PANTS = 2;
const SHOES = 3;

function part(geo: BufferGeometry, color: number, joint: number): BufferGeometry {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('aPart', new Float32BufferAttribute(new Array(n).fill(color), 1));
  geo.setAttribute('aJoint', new Float32BufferAttribute(new Array(n).fill(joint), 1));
  return geo;
}

/** The low-poly body (~170 triangles), thighs and shins, upper arms and forearms apart. */
export function bodyGeometry(): BufferGeometry {
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => new BoxGeometry(sx, sy, sz).translate(x, y, z);
  const parts: BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const L = s < 0;
    parts.push(part(box(0.15, HIP_Y - KNEE_Y, 0.17, HIP_X * s, (HIP_Y + KNEE_Y) / 2, 0), PANTS, L ? 1 : 2));
    parts.push(part(box(0.14, KNEE_Y - 0.08, 0.16, HIP_X * s, (KNEE_Y + 0.08) / 2, 0), PANTS, L ? 6 : 7));
    parts.push(part(box(0.14, 0.1, 0.26, HIP_X * s, 0.05, 0.04), SHOES, L ? 6 : 7));
    parts.push(part(box(0.11, SHOULDER_Y - ELBOW_Y, 0.12, SHOULDER_X * s, (SHOULDER_Y + ELBOW_Y) / 2, 0), SHIRT, L ? 3 : 4));
    parts.push(part(box(0.09, 0.3, 0.1, SHOULDER_X * s, ELBOW_Y - 0.15, 0.01), SKIN, L ? 8 : 9));
    parts.push(part(box(0.09, 0.09, 0.07, SHOULDER_X * s, ELBOW_Y - 0.34, 0.02), SKIN, L ? 8 : 9));
  }
  parts.push(part(box(0.38, 0.28, 0.22, 0, 1.03, 0), SHIRT, 0));
  parts.push(part(box(0.42, 0.28, 0.24, 0, 1.3, 0), SHIRT, 0));
  parts.push(part(box(0.1, 0.08, 0.1, 0, 1.48, 0.01), SKIN, 5));
  parts.push(part(box(0.2, 0.23, 0.22, 0, 1.63, 0.02), SKIN, 5));
  const merged = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** Which ragdoll part a vertex of a joint belongs to. */
export function vertexPart(joint: number, y: number): number {
  switch (joint) {
    case 0:
      return y < WAIST_Y ? PART.pelvis : PART.chest;
    case 5:
      return PART.head;
    case 3:
      return PART.upperArmL;
    case 4:
      return PART.upperArmR;
    case 8:
      return PART.foreArmL;
    case 9:
      return PART.foreArmR;
    case 1:
      return PART.thighL;
    case 2:
      return PART.thighR;
    case 6:
      return PART.shinL;
    default:
      return PART.shinR;
  }
}

/** The joint whose animated transform moves a ragdoll part. */
const PART_JOINT = [0, 0, 5, 3, 4, 8, 9, 1, 2, 6, 7];

const _a = new Matrix4();
const _b = new Matrix4();
const _t = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3();
const UP = new Vector3(0, 1, 0);

function about(rot: Matrix4, px: number, py: number, pz: number, out: Matrix4): Matrix4 {
  return out.makeTranslation(px, py, pz).multiply(rot).multiply(_t.makeTranslation(-px, -py, -pz));
}
const rotZX = (z: number, x: number, out: Matrix4) => out.makeRotationZ(z).multiply(_b.makeRotationX(x));

/**
 * A joint's transform in the model frame for a living zombie — exactly the vertex shader's shamble
 * (walk phase, how much it walks, its look 0..1, the crowd's clock).
 */
export function aliveJoint(joint: number, phase: number, gait: number, look: number, time: number, out: Matrix4): Matrix4 {
  const g = Math.max(0, gait);
  const sw = Math.sin(phase) * g;
  const v = look;
  const torso = about(rotZX(0.06 * Math.sin(phase) * g, 0.22 + 0.08 * g, new Matrix4()), 0, HIP_Y, 0, new Matrix4());
  if (joint === 1 || joint === 2 || joint === 6 || joint === 7) {
    const s = joint === 1 || joint === 6 ? -1 : 1;
    const swing = (joint === 1 || joint === 6 ? sw : -sw) * 0.45;
    return about(_a.makeRotationX(swing), HIP_X * s, HIP_Y, 0, out);
  }
  if (joint === 3 || joint === 4 || joint === 8 || joint === 9) {
    const s = joint === 3 || joint === 8 ? -1 : 1;
    const lift = -0.55 - 0.25 * v - (s < 0 ? 0 : 0.25) + 0.12 * Math.sin(time * 1.3 + v * 6);
    const alive = lift + (joint === 3 || joint === 8 ? -sw : sw) * 0.18;
    about(_a.makeRotationX(alive), SHOULDER_X * s, SHOULDER_Y, 0, out);
    return out.premultiply(torso);
  }
  if (joint === 5) {
    const tilt = 0.25 * (v - 0.5) + 0.06 * Math.sin(time * 0.9 + v * 9);
    about(rotZX(tilt, 0.2, _a), 0, NECK_Y, 0, out);
    return out.premultiply(torso);
  }
  return out.copy(torso);
}

/**
 * Where each ragdoll part is at the moment of death: the living body's animated pose (never a bind / T
 * pose), placed in the world at its feet, heading and scale. A part's frame is its joint's frame, centred
 * on the part's rest centre.
 */
export function deathPoses(pos: Vector3, yaw: number, scale: number, phase: number, gait: number, look: number, time: number): PartPose[] {
  const inst = new Matrix4().compose(pos, _q.setFromAxisAngle(UP, yaw), _s.set(scale, scale, scale));
  return BODY_PARTS.map((d, i) => {
    const m = aliveJoint(PART_JOINT[i], phase, gait, look, time, new Matrix4());
    const c = new Vector3(...d.c).applyMatrix4(m).applyMatrix4(inst);
    const q = new Quaternion().setFromAxisAngle(UP, yaw).multiply(new Quaternion().setFromRotationMatrix(new Matrix4().extractRotation(m)));
    return { p: c, q };
  });
}

/**
 * A dead zombie's ragdoll: from the very pose it had (walking, arms up; the crowd's clock), moving as it
 * moved, hit where the blow landed — harder for a heavier weapon, the head snapping back on a head hit —
 * on its floor among the level's boxes round it.
 */
export function zombieRagdoll(z: Zombie, scale: number, clock: number, boxes: StaticBox[], start?: { parts: PartPose[]; shape: BodyShape }): Ragdoll {
  const d = z.death!;
  // A near procedural model (render/ZombieModels) gives its own pose and build.
  const parts = start?.parts ?? deathPoses(z.pos, z.yaw, scale, d.phase, d.gait, (z.look % 97) / 97, clock);
  const at = d.point ?? parts[PART.chest].p;
  let part: number = PART.head;
  if (!d.head) {
    let best = Infinity;
    parts.forEach((pp, i) => {
      const dd = pp.p.distanceToSquared(at);
      if (dd < best) (best = dd), (part = i);
    });
  }
  const dir = new Vector3(z.pos.x - d.fromX, 0, z.pos.z - d.fromZ);
  if (dir.lengthSq() < 1e-6) dir.set(-Math.sin(z.yaw), 0, -Math.cos(z.yaw));
  dir.normalize();
  dir.y = -0.15;
  return new Ragdoll({
    parts,
    scale,
    velocity: new Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw)).multiplyScalar(d.speed),
    impulse: { part, at, dir, strength: 30 + Math.min(d.damage, 90) * 1.6 },
    floorY: z.pos.y,
    boxes,
    shape: start?.shape,
  });
}

/** Per vertex of the (unindexed) body: its part, its offset from that part's rest centre, normal, uv, colour kind. */
export function bodyBinding(): { part: Uint8Array; offset: Float32Array; normal: Float32Array; uv: Float32Array; kind: Float32Array } {
  const g = bodyGeometry().toNonIndexed();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const joint = g.getAttribute('aJoint');
  const kindA = g.getAttribute('aPart');
  const uvA = g.getAttribute('uv');
  const n = pos.count;
  const part = new Uint8Array(n);
  const offset = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    const p = vertexPart(joint.getX(i), y);
    part[i] = p;
    const c = BODY_PARTS[p].c;
    offset.set([pos.getX(i) - c[0], y - c[1], pos.getZ(i) - c[2]], i * 3);
    normal.set([nor.getX(i), nor.getY(i), nor.getZ(i)], i * 3);
    kind[i] = kindA.getX(i);
    uv[i * 2] = uvA.getX(i);
    uv[i * 2 + 1] = uvA.getY(i);
  }
  g.dispose();
  return { part, offset, normal, uv, kind };
}
