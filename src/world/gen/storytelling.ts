import { Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { buildCar, CAR_PAINTS } from '../props/car';
import { sandbags, stripedBarrier } from './chaos';
import { isGlbClear } from './footprint';
import { Place } from './furniture';
import { groundDecal } from './highrise';
import { LIFE, spotHash } from './lifeKinds';
import { type Builder, pick, type Rand } from './pieces';

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
  b.geo(g, 0xffffff, _m.compose(_p.set(x, 0.045, z), _q.setFromAxisAngle(_up, yaw), _s.set(1, 1, 1)), surface);
  g.dispose();
}

function car(b: Builder, x: number, z: number, yaw: number, rand: Rand, smashed = 0.25, kind?: string, ignoreGlb?: number): boolean {
  const placed = buildCar(
    b.batch,
    b.colliders,
    { x, z, yaw, paint: pick(rand, paints), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.3, smashed: rand() < 0.5 ? smashed : 0, kind, ignoreGlb },
    b.containers,
  );
  if (placed) {
    b.life(LIFE.car, x, 0, z, Math.sin(yaw), Math.cos(yaw), 4.3, 1.8, spotHash(x, z, 41));
    if (smashed >= 0.7 && spotHash(x, z, 94) < 0.3) b.life(LIFE.fire, x, 0.95, z, 0, 0, 1.1, 0, spotHash(x, z, 95));
  }
  return placed;
}

/**
 * Abandoned vehicles blocking a road segment without robotic grid alignment: varied spacing, angled wrecks,
 * occasional semi + cargo trailer pairs.
 */
export function trafficJam(b: Builder, cx: number, cz: number, alongX: boolean, from: number, to: number, rand: Rand): number {
  const lane = rand() < 0.5 ? -1.8 : 1.8;
  const heading = alongX ? (lane > 0 ? 0 : Math.PI) : lane > 0 ? Math.PI / 2 : -Math.PI / 2;
  let t = from + 3.5 + rand() * 5.0;
  let n = 0;
  while (t < to - 4.0 && n < 3) {
    const dir = rand() < 0.5 ? 1 : -1;
    const askew = rand() < 0.55 ? dir * (0.26 + rand() * 0.42) : (rand() - 0.5) * 0.16;
    const x = alongX ? t : cx + lane + (rand() - 0.5) * 1.4;
    const z = alongX ? cz + lane + (rand() - 0.5) * 1.4 : t;
    const trailSign = alongX ? -Math.cos(heading) : Math.sin(heading);
    const rigFits = trailSign < 0 ? t >= from + 13.2 && t <= to - 4.0 : t >= from + 4.0 && t <= to - 13.2;
    if (rand() < 0.24 && rigFits) {
      const yaw = heading + (rand() - 0.5) * 0.14;
      const tractorIdx = b.batch.glbs.length;
      if (car(b, x, z, yaw, rand, 0.2, 'semi')) {
        // Couple trailer 6.75 m behind tractor so trailer nose sits squarely over the fifth-wheel saddle.
        const tx = x - Math.cos(yaw) * 6.75;
        const tz = z + Math.sin(yaw) * 6.75;
        car(b, tx, tz, yaw, rand, 0.1, 'trailer', tractorIdx);
      }
      t += (trailSign > 0 ? 15.5 : 9.5) + rand() * 3.0;
      n += 2;
      continue;
    }
    car(b, x, z, heading + askew, rand, rand() < 0.3 ? 0.7 : 0.2);
    if (rand() < 0.25) groundDecal(b, 'decalOil', x + (rand() - 0.5) * 3, 0, z + (rand() - 0.5) * 3, 1.2, rand);
    t += 9.5 + rand() * 5.5;
    n++;
  }
  return lane;
}

/** Pile-up in an intersection: wrecked cars + emergency response (ambulance / fire truck), skid marks, oil. */
export function crashSite(b: Builder, cx: number, cz: number, rand: Rand): void {
  const yaw0 = rand() * Math.PI * 2;
  car(b, cx - Math.cos(yaw0) * 2.2, cz + Math.sin(yaw0) * 2.2, yaw0, rand, 0.85, 'wreck');
  // Second car stopped near the first, kept inside the 5.8 m intersection strip.
  const a = yaw0 + Math.PI / 2 + (rand() - 0.5) * 0.4;
  const x2 = cx + Math.cos(a) * 3.8;
  const z2 = cz - Math.sin(a) * 3.8;
  car(b, x2, z2, a + Math.PI, rand, 0.7);
  stripDecal(b, x2 + Math.cos(a) * 7, z2 - Math.sin(a) * 7, a, 9, 2.4, 'decalSkid');
  const responder = rand() < 0.5 ? 'fireTruck' : 'ambulance';
  const a3 = yaw0 + Math.PI + (rand() - 0.5) * 0.6;
  car(b, cx + Math.cos(yaw0) * 3.6, cz - Math.sin(yaw0) * 3.6, a3, rand, 0.15, responder);
  groundDecal(b, 'decalShards', cx, 0, cz, 3.2, rand, 1.3);
  groundDecal(b, 'decalOil', cx + (rand() - 0.5) * 4, 0, cz + (rand() - 0.5) * 4, 2.2, rand, 1.4);
  groundDecal(b, 'decalSoot', cx + (rand() - 0.5) * 3, 0, cz + (rand() - 0.5) * 3, 3.4, rand, 1.2);
}

/** A car that left the road and wrapped itself round a street lamp. */
export function carIntoPole(b: Builder, px: number, pz: number, toward: number, rand: Rand): void {
  // Nose (car local +X) just short of the pole.
  const cx = px - Math.cos(toward) * 2.5;
  const cz = pz + Math.sin(toward) * 2.5;
  if (!car(b, cx, cz, toward + (rand() - 0.5) * 0.3, rand, 0.9)) return;
  stripDecal(b, cx - Math.cos(toward) * 6, cz + Math.sin(toward) * 6, toward, 8, 2.2, 'decalSkid');
  groundDecal(b, 'decalShards', px - Math.cos(toward) * 0.6, 0, pz + Math.sin(toward) * 0.6, 2, rand);
}

/**
 * Army checkpoint that did not hold: barricades, military vehicles (Tigr / Kamaz 6x6 / Shilka), crates, fire barrel.
 */
export function checkpoint(b: Builder, cx: number, cz: number, rand: Rand): void {
  const A = new Place(b, cx, 0, cz, 0);
  sandbags(A, -2.2, -1.2, 2.6, rand);
  sandbags(A, 2.4, -1.4, 2.4, rand);
  sandbags(A.at(-3.6, 2.0, 1), 0, 0, 2.0, rand);
  stripedBarrier(A, -0.2, 2.2, 2.0);
  stripedBarrier(A, 3.6, 2.2, 2.0);
  const milRoll = spotHash(cx, cz, 87);
  const milKind = milRoll < 0.34 ? 'apc' : milRoll < 0.68 ? 'truck' : 'tank';
  car(b, cx + 3.4, cz - 4.2, (rand() - 0.5) * 0.3, rand, 0.1, milKind);
  if (spotHash(cx, cz, 89) < 0.45) {
    car(b, cx - 3.2, cz + 4.2, Math.PI + (rand() - 0.5) * 0.2, rand, 0.1, milKind === 'tank' ? 'truck' : 'apc');
  }
  const cp = new Place(b, cx - 0.1, 0, cz - 2.3, 0);
  cp.resetBounds();
  cp.model('supplyCrate', rand, 0, 0, 0, 0, 1, 0.78, 0.15, true);
  cp.container('militaryCrate', 0, 0.55);
  const towYaw = rand() * 0.4 - 0.2;
  if (isGlbClear(b.batch, 'generator_light_tower', cx + 4.8, cz + 0.8, towYaw, 0.8)) {
    b.glb('generator_light_tower', cx + 4.8, 0, cz + 0.8, towYaw);
  }
  if (isGlbClear(b.batch, 'burn_barrel', cx - 3.8, cz - 2.4, 0, 0.5)) {
    b.glb('burn_barrel', cx - 3.8, 0, cz - 2.4, 0);
    b.solid(cx - 4.15, cz - 2.75, cx - 3.45, cz - 2.05, 0, 0.95);
    b.life(LIFE.fire, cx - 3.8, 0.92, cz - 2.4, 0, 0, 0.55, 0, spotHash(cx, cz, 88));
  }
  for (let i = 0; i < 2; i++) groundDecal(b, 'decalSoot', cx + (rand() - 0.5) * 7, 0, cz + (rand() - 0.5) * 7, 2, rand, 1.3);
}
