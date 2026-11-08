import { HINTS, type GunHint } from './gunHints';

/**
 * The gun frame every firearm lives in (the import writes its models in it, the game poses them in it):
 * the origin at the right hand's grip point (grip_main), the barrel along −Z, up +Y, the gun's right +X,
 * real size in metres. A hint point [x, y] in the Meshy model's units goes to (0, s·(y − gy), s·(x − gx)):
 * the model's −X (the muzzle) becomes −Z.
 */

export type V3 = [number, number, number];

/** A hand's frame on the gun: where the grip passes through the fist, the grip axis (thumb side), the reach (wrist → knuckles). */
export interface HandFrame {
  at: V3;
  axis: V3;
  reach: V3;
}

export interface GunSockets {
  /** Model units → metres. */
  scale: number;
  /** The grip point in model units (the frame's origin). */
  origin: [number, number];
  main: HandFrame;
  /** Pistols: the left hand round the right (no socket of its own on the gun). */
  off: HandFrame;
  muzzle: V3;
  sightF: V3;
  sightR: V3;
  eject: V3;
  light: V3;
  bolt: V3;
  load: V3;
  /** The magazine's top (where it seats) and the way it comes out (down the well). */
  mag: V3;
  magOut: V3;
  /** Butt (the back end) and the front end, z. */
  back: number;
  front: number;
}

const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** A model point (x, y, z in model units) in the gun frame. */
export function toGun(h: GunHint, x: number, y: number, z = 0): V3 {
  const s = scaleOf(h);
  const [gx, gy] = gripPoint(h);
  return [-s * z, s * (y - gy), s * (x - gx)];
}

/** Model units to metres: the model spans 0.96 along X. */
export function scaleOf(h: GunHint): number {
  return h.length / 0.96;
}

function gripPoint(h: GunHint): [number, number] {
  const [b, t] = h.grip;
  return [b[0] + (t[0] - b[0]) * h.main, b[1] + (t[1] - b[1]) * h.main];
}

const dir = (_h: GunHint, a: readonly [number, number], b: readonly [number, number]): V3 => norm([0, b[1] - a[1], b[0] - a[0]]);

export function gunSockets(id: string): GunSockets {
  const h = HINTS[id];
  const p = (q: readonly [number, number], dx = 0) => {
    const v = toGun(h, q[0], q[1]);
    v[0] += dx;
    return v;
  };
  const axis = dir(h, h.grip[0], h.grip[1]);
  // Knuckles forward, square to the grip.
  const reach = norm([0, -axis[1] * -axis[2], -1 + axis[2] * axis[2]]);
  const main: HandFrame = { at: [0, 0, 0], axis, reach };
  let off: HandFrame;
  if (h.foreGrip) {
    const a = dir(h, h.foreGrip[0], h.foreGrip[1]);
    off = { at: p(h.fore!), axis: a, reach: norm([0, -a[1] * -a[2], -1 + a[2] * a[2]]) };
  } else if (h.fore) {
    // Under the handguard: the thumb along it to the muzzle, the knuckles across to the right.
    off = { at: p(h.fore), axis: [0, 0, -1], reach: [1, 0, 0] };
  } else {
    // Pistols: the left hand wraps the right, a little lower and to the left, fingers over its fingers.
    off = { at: [-0.028, -0.012, -0.012], axis, reach: norm([0.55, 0, -0.85]) };
  }
  const mag: V3 = h.mag ? p([(h.mag.x[0] + h.mag.x[1]) / 2, h.mag.y[1]]) : h.magWell ? p(h.magWell[1]) : p(h.load ?? h.eject);
  const magOut: V3 = h.magWell ? dir(h, h.magWell[1], h.magWell[0]) : [0, -1, 0];
  return {
    scale: scaleOf(h),
    origin: gripPoint(h),
    main,
    off,
    muzzle: p(h.muzzle),
    sightF: p(h.sightF),
    sightR: p(h.sightR),
    eject: p(h.eject, 0.012),
    light: p(h.light),
    bolt: p(h.bolt, id === 'rifle_m4a1' ? -0.018 : 0.018),
    load: p(h.load ?? h.eject),
    mag,
    magOut,
    back: toGun(h, 0.48, 0)[2],
    front: toGun(h, -0.48, 0)[2],
  };
}
