import { Matrix4, type Mesh, Quaternion, Vector3 } from 'three';
import type { Viewmodel } from '../player/Viewmodel';
import { gunSockets } from '../weapons/gunFrame';
import type { GunId } from '../weapons/guns';

/**
 * How a gun sits in first person (test:guns, and the poses' tuning): measured on what is drawn — the gun
 * model's root and the skinned arms — not on the pose's targets.
 *
 *  - roll: the gun's turn about its barrel against the vertical (0: its top straight up), °;
 *  - yaw / pitch of the barrel off the view axis, °;
 *  - handPx: pixels of the hands (the triangles wholly on the hand and finger bones) seen inside the circle
 *    round the screen's middle — its diameter 15% of the screen's height, at 1920×1080; a hand behind the
 *    gun (under its handguard, its pump) is not seen;
 *  - palmBelow: the left palm (between the wrist and the middle finger's root) under the bore axis, m (gun
 *    frame, + = below); handTop: the highest point of the left hand under the bore, m.
 *  - screen: where the grip and the muzzle are on the screen (−1..1, x right, y up);
 *  - nearCut: the arms' triangles the near plane cuts inside the frame (a sleeve or a shoulder through the
 *    camera: its inside on the screen) — 0; nearest: the nearest arm point in the frame, m.
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
  nearCut: number;
  nearest: number;
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
  const dep = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    if (!onHand[v]) continue;
    mesh.applyBoneTransform(v, _v.fromBufferAttribute(P, v)).applyMatrix4(mesh.matrixWorld);
    _v.toArray(world, v * 3);
    const c = _v.clone().applyMatrix4(vm.camera.matrixWorldInverse);
    const p = _v.project(vm.camera);
    scr[v * 3] = ((p.x + 1) / 2) * W;
    scr[v * 3 + 1] = ((1 - p.y) / 2) * H;
    scr[v * 3 + 2] = c.z < -0.01 ? 1 : 0;
    dep[v] = -c.z;
  }
  const near = nearOf(vm, mesh);
  // Hand pixels in the circle: the hand's triangles rasterised over the circle's box.
  const R = HAND_CIRCLE, cx = W / 2, cy = H / 2;
  const x0 = Math.floor(cx - R), x1 = Math.ceil(cx + R), y0 = Math.floor(cy - R), y1 = Math.ceil(cy + R);
  const bw = x1 - x0 + 1;
  const mask = new Uint8Array(bw * (y1 - y0 + 1));
  const maskL = new Uint8Array(mask.length);
  // The gun's depth over the box (its own triangles, drawn as they are).
  const gunZ = new Float32Array(mask.length).fill(Infinity);
  const ga = new Vector3(), gb = new Vector3(), gc = new Vector3();
  const toScr = (p: Vector3, m: Matrix4) => {
    p.applyMatrix4(m).applyMatrix4(vm.camera.matrixWorldInverse);
    const d = -p.z;
    p.applyMatrix4(vm.camera.projectionMatrix);
    return [((p.x + 1) / 2) * W, ((1 - p.y) / 2) * H, d] as const;
  };
  gm.root.traverseVisible((o) => {
    const gmesh = o as Mesh;
    if (!gmesh.isMesh) return;
    const gp = gmesh.geometry.getAttribute('position');
    const gi = gmesh.geometry.index;
    const cnt = gi ? gi.count : gp.count;
    for (let t = 0; t < cnt; t += 3) {
      const ia = gi ? gi.getX(t) : t, ib = gi ? gi.getX(t + 1) : t + 1, ic = gi ? gi.getX(t + 2) : t + 2;
      const A = toScr(ga.fromBufferAttribute(gp, ia), gmesh.matrixWorld), B = toScr(gb.fromBufferAttribute(gp, ib), gmesh.matrixWorld), C = toScr(gc.fromBufferAttribute(gp, ic), gmesh.matrixWorld);
      if (A[2] < 0.01 || B[2] < 0.01 || C[2] < 0.01) continue;
      raster(A, B, C, (i, d) => {
        if (d < gunZ[i]) gunZ[i] = d;
      });
    }
  });
  function raster(A: readonly number[], B: readonly number[], C: readonly number[], put: (i: number, d: number) => void): void {
    const lx = Math.max(x0, Math.floor(Math.min(A[0], B[0], C[0]))), hx = Math.min(x1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const ly = Math.max(y0, Math.floor(Math.min(A[1], B[1], C[1]))), hy = Math.min(y1, Math.ceil(Math.max(A[1], B[1], C[1])));
    if (lx > hx || ly > hy) return;
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = ly; y <= hy; y++)
      for (let x = lx; x <= hx; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B[0] - px) * (C[1] - py) - (C[0] - px) * (B[1] - py)) / area;
        const w1 = ((C[0] - px) * (A[1] - py) - (A[0] - px) * (C[1] - py)) / area;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        if ((px - cx) ** 2 + (py - cy) ** 2 > R * R) continue;
        // Depth: perspective-correct (1/z interpolated).
        const iz = w0 / A[2] + w1 / B[2] + (1 - w0 - w1) / C[2];
        put((y - y0) * bw + (x - x0), 1 / iz);
      }
  }
  const idx = geo.index!;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    if (!onHand[a] || !onHand[b] || !onHand[c] || !scr[a * 3 + 2] || !scr[b * 3 + 2] || !scr[c * 3 + 2]) continue;
    const isL = left[a];
    raster([scr[a * 3], scr[a * 3 + 1], dep[a]], [scr[b * 3], scr[b * 3 + 1], dep[b]], [scr[c * 3], scr[c * 3 + 1], dep[c]], (i, d) => {
      if (d >= gunZ[i]) return;
      mask[i] = 1;
      if (isL) maskL[i] = 1;
    });
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
    ...near,
  };
}

/** The arms against the near plane: triangles cut by it inside the frame, and the nearest point in the frame. */
export function nearOf(vm: Viewmodel, mesh: NonNullable<Viewmodel['arms']['mesh']>): { nearCut: number; nearest: number } {
  const cam = vm.camera;
  const geo = mesh.geometry;
  const P = geo.getAttribute('position');
  const n = P.count;
  const c = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    mesh.applyBoneTransform(v, _v.fromBufferAttribute(P, v)).applyMatrix4(mesh.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
    _v.toArray(c, v * 3);
  }
  const ty = Math.tan((cam.fov * Math.PI) / 360), tx = ty * Math.max(cam.aspect, 16 / 9);
  const inFrame = (x: number, y: number, d: number) => Math.abs(x) <= d * tx && Math.abs(y) <= d * ty;
  let nearest = Infinity;
  for (let v = 0; v < n; v++) {
    const d = -c[v * 3 + 2];
    if (d > 0 && inFrame(c[v * 3], c[v * 3 + 1], d)) nearest = Math.min(nearest, d);
  }
  const N = cam.near;
  const idx = geo.index!;
  let nearCut = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const tri = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const da = -c[a * 3 + 2] - N, db = -c[b * 3 + 2] - N;
      if (da * db >= 0) continue;
      const k = da / (da - db);
      const x = c[a * 3] + (c[b * 3] - c[a * 3]) * k, y = c[a * 3 + 1] + (c[b * 3 + 1] - c[a * 3 + 1]) * k;
      if (inFrame(x, y, N)) {
        nearCut++;
        break;
      }
    }
  }
  return { nearCut, nearest: +nearest.toFixed(3) };
}
