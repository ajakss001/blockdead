import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Viewmodel } from '../player/Viewmodel';
import { gunSockets } from '../weapons/gunFrame';
import type { GunId } from '../weapons/guns';

/**
 * How a gun sits in first person (test:guns, and the poses' tuning): measured on what is drawn — the gun
 * model's root and the skinned arms — not on the pose's targets.
 *
 *  - roll: the gun's turn about its barrel against the vertical (0: its top straight up), °;
 *  - yaw / pitch of the barrel off the view axis, °;
 *  - handPx: pixels of the hands (the triangles wholly on the hand and finger bones, no occlusion: stricter
 *    than the picture) inside the circle round the screen's middle — its diameter 15% of the screen's
 *    height, at 1920×1080;
 *  - palmBelow: the left palm (between the wrist and the middle finger's root) under the bore axis, m (gun
 *    frame, + = below); handTop: the highest point of the left hand under the bore, m.
 *  - screen: where the grip and the muzzle are on the screen (−1..1, x right, y up).
 */
export interface GunLook {
  roll: number;
  yaw: number;
  pitch: number;
  handPx: number;
  /** The same of the left hand alone. */
  handPxL: number;
  palmBelow: number;
  handTop: number;
  /** The bone the left hand's highest point is on. */
  topBone: string;
  grip: [number, number];
  muzzle: [number, number];
}

const W = 1920;
const H = 1080;
/** The circle's radius, px: 15% of the height across. */
export const HAND_CIRCLE = 0.075 * H;

const _m = new Matrix4();
const _inv = new Matrix4();
const _q = new Quaternion();
const _v = new Vector3();

export function gunLook(vm: Viewmodel, id: GunId): GunLook {
  const gm = vm.gunModel!;
  gm.root.updateWorldMatrix(true, false);
  vm.camera.updateMatrixWorld(true);
  // The gun in camera space.
  _m.copy(vm.camera.matrixWorldInverse).multiply(gm.root.matrixWorld);
  _m.decompose(_v, _q, new Vector3());
  const fwd = new Vector3(0, 0, -1).applyQuaternion(_q);
  const up = new Vector3(0, 1, 0).applyQuaternion(_q);
  const side = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
  const vup = new Vector3().crossVectors(side, fwd).normalize();
  const deg = 180 / Math.PI;
  const roll = Math.atan2(up.dot(side), up.dot(vup)) * deg;
  const yaw = Math.atan2(fwd.x, -fwd.z) * deg;
  const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y))) * deg;
  const s = gunSockets(id);
  const screen = (p: Vector3): [number, number] => {
    const c = p.clone().applyMatrix4(gm.root.matrixWorld).project(vm.camera);
    return [+c.x.toFixed(3), +c.y.toFixed(3)];
  };
  // The arms, skinned on the CPU.
  const mesh = vm.arms.mesh!;
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  const geo = mesh.geometry;
  const P = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const names = mesh.skeleton.bones.map((b) => b.name);
  const handBone = names.map((n) => /(Left|Right)Hand/.test(n));
  const leftBone = names.map((n) => /LeftHand/.test(n));
  const n = P.count;
  const onHand = new Uint8Array(n);
  const left = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    let h = 0, l = 0;
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(v, k), w = sw.getComponent(v, k);
      if (handBone[b]) h += w;
      if (leftBone[b]) l += w;
    }
    onHand[v] = h >= 0.5 ? 1 : 0;
    left[v] = l >= 0.5 ? 1 : 0;
  }
  const world = new Float32Array(n * 3);
  const scr = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    if (!onHand[v]) continue;
    mesh.applyBoneTransform(v, _v.fromBufferAttribute(P, v)).applyMatrix4(mesh.matrixWorld);
    _v.toArray(world, v * 3);
    const c = _v.clone().applyMatrix4(vm.camera.matrixWorldInverse);
    const p = _v.project(vm.camera);
    scr[v * 3] = ((p.x + 1) / 2) * W;
    scr[v * 3 + 1] = ((1 - p.y) / 2) * H;
    scr[v * 3 + 2] = c.z < -0.01 ? 1 : 0;
  }
  // Hand pixels in the circle: the hand's triangles rasterised over the circle's box.
  const R = HAND_CIRCLE, cx = W / 2, cy = H / 2;
  const x0 = Math.floor(cx - R), x1 = Math.ceil(cx + R), y0 = Math.floor(cy - R), y1 = Math.ceil(cy + R);
  const bw = x1 - x0 + 1;
  const mask = new Uint8Array(bw * (y1 - y0 + 1));
  const maskL = new Uint8Array(mask.length);
  const idx = geo.index!;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (!onHand[a] || !onHand[b] || !onHand[c] || !scr[a * 3 + 2] || !scr[b * 3 + 2] || !scr[c * 3 + 2]) continue;
    const ax = scr[a * 3], ay = scr[a * 3 + 1], bx = scr[b * 3], by = scr[b * 3 + 1], qx = scr[c * 3], qy = scr[c * 3 + 1];
    const lx = Math.max(x0, Math.floor(Math.min(ax, bx, qx))), hx = Math.min(x1, Math.ceil(Math.max(ax, bx, qx)));
    const ly = Math.max(y0, Math.floor(Math.min(ay, by, qy))), hy = Math.min(y1, Math.ceil(Math.max(ay, by, qy)));
    if (lx > hx || ly > hy) continue;
    const area = (bx - ax) * (qy - ay) - (qx - ax) * (by - ay);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = ly; y <= hy; y++)
      for (let x = lx; x <= hx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (qy - py) - (qx - px) * (by - py)) / area;
        const w1 = ((qx - px) * (ay - py) - (ax - px) * (qy - py)) / area;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        if ((px - cx) ** 2 + (py - cy) ** 2 <= R * R) {
          mask[(y - y0) * bw + (x - x0)] = 1;
          if (left[a]) maskL[(y - y0) * bw + (x - x0)] = 1;
        }
      }
  }
  let handPx = 0;
  for (const m of mask) handPx += m;
  let handPxL = 0;
  for (const m of maskL) handPxL += m;
  // The left palm and the left hand's top, in the gun frame.
  _inv.copy(gm.root.matrixWorld).invert();
  const bore = s.muzzle[1];
  const bone = (name: string) => {
    const i = names.findIndex((x) => x.endsWith(name));
    return i < 0 ? null : new Vector3().setFromMatrixPosition(mesh.skeleton.bones[i].matrixWorld);
  };
  const wrist = bone('LeftHand'), knuckle = bone('LeftHandMiddle1');
  let palmBelow = NaN;
  if (wrist && knuckle) palmBelow = bore - wrist.add(knuckle).multiplyScalar(0.5).applyMatrix4(_inv).y;
  let top = -Infinity, topV = -1;
  for (let v = 0; v < n; v++)
    if (onHand[v] && left[v]) {
      const y = _v.fromArray(world, v * 3).applyMatrix4(_inv).y;
      if (y > top) (top = y), (topV = v);
    }
  let topBone = '';
  if (topV >= 0) {
    let bw = 0;
    for (let k = 0; k < 4; k++) if (sw.getComponent(topV, k) > bw) (bw = sw.getComponent(topV, k)), (topBone = names[si.getComponent(topV, k)]);
  }
  return {
    roll,
    yaw,
    pitch,
    handPx,
    handPxL,
    palmBelow,
    handTop: bore - top,
    topBone,
    grip: screen(new Vector3(0, 0, 0)),
    muzzle: screen(new Vector3(...s.muzzle)),
  };
}
