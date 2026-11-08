import { Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { buildCar, CAR_PAINTS } from '../props/car';
import { groundDecal } from './highrise';
import { LIFE, spotHash } from './lifeKinds';
import { type Builder, PAL, pick, type Rand } from './pieces';

/**
 * Environmental storytelling: the street remembers the day it fell. Traffic jams of people who
 * tried to leave, pile-ups at intersections with skid marks and leaked oil, a car wrapped round a pole,
 * army checkpoints that did not hold, litter everywhere. Pure placement on top of the batch: decals
 * and existing props, no new draw calls.
 */

const paints = Object.values(CAR_PAINTS);
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

/** Long decal (skid marks) along a yaw (same convention as cars: yaw 0 = +X). */
export function stripDecal(b: Builder, x: number, z: number, yaw: number, length: number, width: number, surface: 'decalSkid'): void {
  const g = new PlaneGeometry(length, width);
  g.rotateX(-Math.PI / 2);
  b.geo(g, 0xffffff, _m.compose(_p.set(x, 0.035, z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1)), surface);
  g.dispose();
}

function car(b: Builder, x: number, z: number, yaw: number, rand: Rand, smashed = 0.25): void {
  b.life(LIFE.car, x, 0, z, Math.sin(yaw), Math.cos(yaw), 4.3, 1.8, spotHash(x, z, 41));
  if (smashed >= 0.7 && spotHash(x, z, 94) < 0.3) b.life(LIFE.fire, x, 0.95, z, 0, 0, 1.1, 0, spotHash(x, z, 95));
  buildCar(
    b.batch,
    b.colliders,
    { x, z, yaw, paint: pick(rand, paints), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.3, smashed: rand() < 0.5 ? smashed : 0 },
    b.containers,
  );
}

/**
 * Cars that queued to leave the city and were abandoned bumper to bumper, along a road segment.
 * `alongX`: the road runs along X. Lane offsets are ±1.8 m from the road center line. Returns the lane used.
 */
export function trafficJam(b: Builder, cx: number, cz: number, alongX: boolean, from: number, to: number, rand: Rand): number {
  const lane = rand() < 0.5 ? -1.8 : 1.8;
  const heading = alongX ? (lane > 0 ? 0 : Math.PI) : lane > 0 ? Math.PI / 2 : -Math.PI / 2;
  let t = from + 2.5 + rand() * 3;
  let n = 0;
  while (t < to - 2.5 && n < 5) {
    const askew = rand() < 0.25 ? (rand() - 0.5) * 0.9 : (rand() - 0.5) * 0.12;
    const x = alongX ? t : cx + lane + (rand() - 0.5) * 0.4;
    const z = alongX ? cz + lane + (rand() - 0.5) * 0.4 : t;
    car(b, x, z, heading + askew, rand);
    // Leaking engine.
    if (rand() < 0.2) groundDecal(b, 'decalOil', x + (rand() - 0.5) * 3, 0, z + (rand() - 0.5) * 3, 1.2, rand);
    t += 4.9 + rand() * 1.6;
    n++;
  }
  return lane;
}

/** Pile-up in an intersection: cars slewed across lanes, skid marks leading in, glass and oil. */
export function crashSite(b: Builder, cx: number, cz: number, rand: Rand): void {
  const yaw0 = rand() * Math.PI * 2;
  car(b, cx + (rand() - 0.5) * 2, cz + (rand() - 0.5) * 2, yaw0, rand, 0.7);
  // Second car T-boned into the first one's side.
  const a = yaw0 + Math.PI / 2 + (rand() - 0.5) * 0.5;
  const x2 = cx + Math.cos(a) * 3.1;
  const z2 = cz - Math.sin(a) * 3.1;
  car(b, x2, z2, a + Math.PI, rand, 0.7);
  stripDecal(b, x2 + Math.cos(a) * 7, z2 - Math.sin(a) * 7, a, 9, 2.4, 'decalSkid');
  if (rand() < 0.6) {
    const a3 = yaw0 + Math.PI + (rand() - 0.5) * 0.8;
    car(b, cx + Math.cos(yaw0) * 4.6, cz - Math.sin(yaw0) * 4.6, a3, rand, 0.5);
  }
  groundDecal(b, 'decalShards', cx, 0, cz, 3.2, rand, 1.3);
  groundDecal(b, 'decalOil', cx + (rand() - 0.5) * 4, 0, cz + (rand() - 0.5) * 4, 2.2, rand, 1.4);
  // One of them caught fire.
  groundDecal(b, 'decalSoot', cx + (rand() - 0.5) * 3, 0, cz + (rand() - 0.5) * 3, 3.4, rand, 1.2);
}

/** A car that left the road and wrapped itself round a street lamp. */
export function carIntoPole(b: Builder, px: number, pz: number, toward: number, rand: Rand): void {
  // Nose (car local +X) just short of the pole.
  const cx = px - Math.cos(toward) * 2.5;
  const cz = pz + Math.sin(toward) * 2.5;
  car(b, cx, cz, toward + (rand() - 0.5) * 0.3, rand, 0.9);
  stripDecal(b, cx - Math.cos(toward) * 6, cz + Math.sin(toward) * 6, toward, 8, 2.2, 'decalSkid');
  groundDecal(b, 'decalShards', px - Math.cos(toward) * 0.6, 0, pz + Math.sin(toward) * 0.6, 2, rand);
}

/**
 * Army checkpoint that did not hold: sandbag walls, striped barriers, ammo crates, the street around it
 * covered in litter and the scorch marks of burn barrels.
 */
export function checkpoint(b: Builder, cx: number, cz: number, rand: Rand): void {
  const sand = 0x7a6e56;
  for (const [dx, dz, w, d] of [
    [-3.5, -1.2, 2.6, 0.7],
    [1.2, -1.4, 2.4, 0.7],
    [-3.6, 1.0, 0.7, 2.0],
  ] as const) {
    b.block(sand, cx + dx, 0, cz + dz, w, 0.45, d, 'rubber', true);
    b.block(sand, cx + dx + 0.1, 0.45, cz + dz + 0.05, w - 0.2, 0.4, d - 0.1, 'rubber');
  }
  // Striped barriers (two half-blocked lanes).
  for (const dx of [-1.2, 2.6]) {
    b.block(0xb0aa98, cx + dx, 0.75, cz + 2.2, 2.0, 0.22, 0.1, 'metal');
    for (let s = 0; s < 4; s++) b.block(0x7a2a22, cx + dx + 0.1 + s * 0.5, 0.75, cz + 2.19, 0.22, 0.22, 0.12, 'metal');
    b.block(PAL.metal, cx + dx, 0, cz + 2.2, 0.08, 0.95, 0.08, 'metal', true);
    b.block(PAL.metal, cx + dx + 1.92, 0, cz + 2.2, 0.08, 0.95, 0.08, 'metal', true);
  }
  b.block(0x3e4a34, cx - 0.6, 0, cz - 2.6, 1.0, 0.5, 0.6, 'wood', true);
  // The checkpoint's own box: army kit (the glasses and shemaghs of the men who held it).
  b.container('militaryCrate', cx - 0.1, cz - 1.9);
  for (let i = 0; i < 3; i++) groundDecal(b, 'decalLitter', cx + (rand() - 0.5) * 8, 0, cz + (rand() - 0.5) * 8, 2.4, rand);
  for (let i = 0; i < 2; i++) groundDecal(b, 'decalSoot', cx + (rand() - 0.5) * 7, 0, cz + (rand() - 0.5) * 7, 2, rand, 1.3);
}
