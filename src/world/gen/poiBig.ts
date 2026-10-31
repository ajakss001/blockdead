import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { ContainerType } from '../../data/loot';
import { pickModel } from '../models';
import { modelLibrary, placeModel } from '../props/car';
import * as F from './furniture';
import type { Place, Quarter } from './furniture';
import type { Rand } from './pieces';
import type { Site } from './poiSite';

/*
 * POI stage 4: the big places, each spanning several chunks (every chunk runs the whole plan with the same
 * random numbers and keeps its own part — see Builder.clip). Airliners, light planes, fighters and the
 * military helicopter are installed models (the low-poly placeholders below stay as the fallback; the
 * transport plane is one still); tanks, APCs and trucks too. All of it is
 * scenery: the cabins and the holds can be searched, nothing can be driven or flown.
 */

const WHITE = 0xd8d8d2;
const DARK = 0x1a1e22;
const OLIVE = 0x4e5438;
const GREYJET = 0x6a7078;

// ── Pieces ───────────────────────────────────────────────────────────────────

/** A searchable zone over a local rectangle of a place (its frame), y0…y1, in this chunk only. */
function zone(S: Site, q: Place, type: ContainerType, lx0: number, lz0: number, lx1: number, lz1: number, y0: number, y1: number): void {
  const [ax, az] = q.pt(lx0, lz0);
  const [bx, bz] = q.pt(lx1, lz1);
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const z0 = Math.min(az, bz);
  const z1 = Math.max(az, bz);
  S.b.container(type, (x0 + x1) / 2, (z0 + z1) / 2, 0, [x0, y0, z0, x1, y1, z1]);
}

/** A chain-link fence from (x0, z0) to (x1, z1) (local, along X or Z), posts every 6 m; barbed wire on top if asked. */
function fence(S: Site, x0: number, z0: number, x1: number, z1: number, barbed: boolean): void {
  const p = S.p;
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 6));
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  for (let k = 0; k < n; k++) {
    const t0 = k / n;
    const t1 = (k + 1) / n;
    const ax = x0 + (x1 - x0) * t0;
    const az = z0 + (z1 - z0) * t0;
    const mx = x0 + (x1 - x0) * ((t0 + t1) / 2);
    const mz = z0 + (z1 - z0) * ((t0 + t1) / 2);
    const seg = len / n;
    p.box(0x5a5e60, ax, 0, az, 0.12, 2.5, 0.12, 'metal', true);
    for (const y of [0.15, 1.2, 2.3]) p.box(0x6a6e70, mx, y, mz, alongX ? seg : 0.05, 0.05, alongX ? 0.05 : seg, 'metal');
    // The mesh: a see-through grey sheet.
    p.box(0x7a8086, mx, 0.22, mz, alongX ? seg - 0.14 : 0.02, 2.04, alongX ? 0.02 : seg - 0.14, 'windowGlass');
    S.solid(mx, mz, alongX ? seg : 0.15, alongX ? 0.15 : seg, 0, 2.5);
    if (barbed) {
      for (let c = 0; c < 6; c++) {
        const u = (c + 0.5) / 6 - 0.5;
        p.rbox(0x3a3c3e, mx + (alongX ? u * seg : 0), 2.62, mz + (alongX ? 0 : u * seg), alongX ? seg / 6 : 0.04, 0.22, alongX ? 0.04 : seg / 6, 0, c % 2 ? 0.6 : -0.6, 0, 'metal');
      }
    }
  }
}

/** A watchtower: four legs, a cabin with windows, a roof, a ladder. */
function watchtower(S: Site, lx: number, lz: number): void {
  const q = S.p.at(lx, lz);
  for (const [a, b] of [
    [-1.1, -1.1],
    [1.1, -1.1],
    [-1.1, 1.1],
    [1.1, 1.1],
  ]) q.box(0x4a4c40, a, 0, b, 0.2, 6, 0.2, 'wood', true);
  q.box(0x5a5c48, 0, 6, 0, 3, 0.15, 3, 'wood');
  q.box(0x5a5c48, 0, 6.15, -1.45, 3, 1.0, 0.1, 'wood');
  q.box(0x5a5c48, 0, 6.15, 1.45, 3, 1.0, 0.1, 'wood');
  q.box(0x5a5c48, -1.45, 6.15, 0, 0.1, 1.0, 3, 'wood');
  q.box(0x5a5c48, 1.45, 6.15, 0, 0.1, 1.0, 3, 'wood');
  q.box(0x3a3c30, 0, 8.1, 0, 3.6, 0.2, 3.6, 'roof');
  for (const [a, b] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [-1.4, 1.4],
    [1.4, 1.4],
  ]) q.box(0x4a4c40, a, 6.15, b, 0.12, 1.95, 0.12, 'wood');
  for (let y = 0.4; y < 6; y += 0.45) q.box(0x3a3c30, 0, y, 1.7, 0.6, 0.05, 0.05, 'wood');
}

/** A model of a group (tank, apc, truck, heli), nose along local yaw; a searchable cabin over all of it (trucks: the bed). */
function vehicleModel(S: Site, group: string, lx: number, lz: number, yaw: number, rand: Rand): boolean {
  const m = pickModel(modelLibrary(), group, rand());
  if (!m) return false;
  const [x, z] = S.p.pt(lx, lz);
  if (!S.b.inClip(x, z)) return true;
  const wyaw = yaw + (S.p.r * Math.PI) / 2;
  const mat = new Matrix4().compose(new Vector3(x, 0.01, z), new Quaternion().setFromEuler(new Euler(0, wyaw, 0)), new Vector3(1, 1, 1));
  placeModel(S.b.batch, m, mat, null);
  S.b.colliders.addOrientedBox(x, z, m.size[0] / 2, m.size[2] / 2, wyaw, -0.5, m.size[1] + 0.05);
  const truck = group === 'truck';
  const back = truck ? m.size[0] * 0.18 : 0;
  const c = Math.cos(wyaw);
  const sn = Math.sin(wyaw);
  S.b.containers.push({
    type: truck ? 'cargoHold' : 'vehicleCabin',
    x: x - c * back,
    z: z + sn * back,
    box: [x - c * back, m.size[1] / 2, z + sn * back, (truck ? m.size[0] * 0.32 : m.size[0] / 2) + 0.03, m.size[1] / 2 + 0.03, m.size[2] / 2 + 0.03, wyaw],
  });
  return true;
}

/** What an aircraft model needs: its group, the fuselage's width (the collider: one walks under the wings) and its search zones. */
interface Craft {
  group: string;
  body: number;
  /** Zones along the nose axis: type, middle (fraction of the length from the middle, + = nose), half length (fraction), y0, y1 (fractions of the height), half width (m). */
  zones: [ContainerType, number, number, number, number, number][];
}
const CRAFT: Record<'airliner' | 'lightplane' | 'fighter' | 'heliMil', Craft> = {
  airliner: { group: 'airliner', body: 4.2, zones: [['planeCabin', 0.2, 0.22, 0.17, 0.58, 2.1], ['cargoHold', -0.15, 0.18, 0.12, 0.3, 2.1]] },
  lightplane: { group: 'lightplane', body: 1.4, zones: [['planeCabin', 0.08, 0.16, 0.2, 0.85, 0.75]] },
  fighter: { group: 'fighter', body: 2.6, zones: [['vehicleCabin', 0.18, 0.12, 0.3, 0.8, 0.8]] },
  heliMil: { group: 'heliMil', body: 2.6, zones: [['vehicleCabin', 0.12, 0.14, 0.05, 0.75, 1.3]] },
};

/**
 * An installed aircraft model on a place (its nose along the place's local +Z, tipped if the place is),
 * collider over the fuselage, its cabin / hold zones; false if no such model (the placeholder is built).
 */
function aircraft(S: Site, kind: keyof typeof CRAFT, q: Place, rand: Rand): boolean {
  const c = CRAFT[kind];
  const m = pickModel(modelLibrary(), c.group, rand());
  if (!m) return false;
  const M = q.frame(new Matrix4()).multiply(new Matrix4().makeRotationY(-Math.PI / 2)).multiply(new Matrix4().makeTranslation(0, 0.01, 0));
  const at = new Vector3().setFromMatrixPosition(M);
  if (!S.b.inClip(at.x, at.z)) return true;
  placeModel(S.b.batch, m, M, null);
  const nose = new Vector3(1, 0, 0).transformDirection(M);
  const yaw = Math.atan2(-nose.z, nose.x);
  const [L, H] = m.size;
  S.b.colliders.addOrientedBox(at.x, at.z, L / 2, c.body / 2, yaw, -0.5, at.y + H);
  for (const [type, mid, half, y0, y1, w] of c.zones) {
    const x = at.x + nose.x * mid * L;
    const z = at.z + nose.z * mid * L;
    S.b.containers.push({ type, x, z, box: [x, at.y + ((y0 + y1) / 2) * H, z, half * L, ((y1 - y0) / 2) * H, w, yaw] });
  }
  return true;
}

/**
 * Airliner placeholder (nose +Z of its place, 32 m, white with a stripe): fuselage, wings with engines,
 * fin and tailplane, gear. The cabin (front half) and the hold (rear, low) can be searched.
 */
function airliner(S: Site, q: Place, stripe: number): void {
  q.cyl(WHITE, 0, 3.4, 0, 2.0, 26, 'busPaint', Math.PI / 2);
  q.blob(WHITE, 0, 3.2, 13.4, 1.9, 1.85, 2.8, 'busPaint');
  q.blob(WHITE, 0, 3.7, -14, 1.4, 1.3, 3.2, 'busPaint');
  q.box(DARK, 0, 3.75, 14.7, 1.5, 0.4, 0.6, 'rubber');
  for (const s of [-1, 1]) {
    q.box(DARK, s * 2.02, 3.55, 0, 0.04, 0.3, 22, 'rubber');
    q.box(stripe, s * 2.03, 2.85, 0, 0.04, 0.35, 25, 'busPaint');
    q.rbox(WHITE, s * 8.5, 2.3, -1, 13, 0.35, 4.2, -s * 0.28, 0, -s * 0.05, 'busPaint');
    q.cyl(0x8a8e92, s * 6.2, 1.35, 0.8, 0.95, 3.4, 'metal', Math.PI / 2);
    q.rbox(WHITE, s * 3.4, 3.9, -12.8, 5.5, 0.25, 2.0, -s * 0.3, 0, 0, 'busPaint');
    q.box(0x222222, s * 2.6, 0, -1, 0.5, 1.4, 1.0, 'rubber');
    q.solid(s * 6.2, 0.8, 1.9, 3.4, 2.3);
  }
  q.box(WHITE, 0, 4.4, -12.6, 0.35, 4.6, 4.2, 'busPaint');
  q.box(stripe, 0, 6.6, -12.4, 0.38, 2.0, 2.6, 'busPaint');
  q.box(0x222222, 0, 0, 10, 0.4, 1.4, 0.8, 'rubber');
  q.solid(0, 0, 4.2, 30, 5.4);
  zone(S, q, 'planeCabin', -2.05, 1, 2.05, 13, 1.4, 5.4);
  zone(S, q, 'cargoHold', -2.05, -12, 2.05, -1, 1.4, 3.2);
}

/** A light plane (high wing, 8 m) placeholder, nose +Z. */
function lightPlane(S: Site, q: Place, color: number): void {
  q.box(color, 0, 0.7, 0, 1.2, 1.4, 7, 'busPaint');
  q.box(DARK, 0, 1.45, 1.6, 1.22, 0.55, 1.2, 'rubber');
  q.box(color, 0, 2.15, 1.0, 11, 0.14, 1.6, 'busPaint');
  q.box(color, 0, 1.1, -3.6, 0.12, 1.5, 1.0, 'busPaint');
  q.box(color, 0, 1.0, -3.4, 3.4, 0.1, 0.9, 'busPaint');
  q.box(0x2a2a2a, 0, 1.0, 3.6, 0.1, 1.6, 0.1, 'metal');
  for (const s of [-1, 1]) q.box(0x222222, s * 1.0, 0, 0.6, 0.15, 0.7, 0.4, 'rubber');
  q.solid(0, 0, 1.4, 7.4, 2.2);
  zone(S, q, 'planeCabin', -0.62, 0, 0.62, 2.5, 0.7, 2.2);
}

/** A fighter jet placeholder (grey, 15 m, delta wings, twin fins), nose +Z. */
function fighter(S: Site, q: Place): void {
  q.box(GREYJET, 0, 1.3, 0, 1.6, 1.4, 12, 'metal');
  q.blob(GREYJET, 0, 2.0, 6.6, 0.75, 0.7, 2.4, 'metal');
  q.blob(0x22303a, 0, 2.75, 3.4, 0.55, 0.45, 1.6, 'rubber');
  for (const s of [-1, 1]) {
    q.rbox(GREYJET, s * 2.6, 1.6, -1.6, 4.4, 0.16, 5.2, s * 0.35, 0, 0, 'metal');
    q.rbox(GREYJET, s * 0.7, 3.4, -5.0, 0.12, 2.2, 2.4, 0, 0, s * 0.25, 'metal');
    q.box(0x3a3e42, s * 0.95, 1.1, 1.8, 0.6, 0.9, 2.4, 'metal');
    q.box(0x222222, s * 1.2, 0, -1.2, 0.25, 1.3, 0.4, 'rubber');
  }
  q.cyl(0x2a2c2e, 0, 1.9, -6.4, 0.55, 0.8, 'metal', Math.PI / 2);
  q.solid(0, 0, 2.0, 15, 3.3);
  zone(S, q, 'vehicleCabin', -0.8, 2.5, 0.8, 4.6, 1.2, 3.3);
}

/** A four-engine transport plane placeholder (olive, 26 m, high wing, rear ramp down), nose +Z. */
function transport(S: Site, q: Place): void {
  const c = 0x5a604a;
  q.cyl(c, 0, 3.4, 0, 2.3, 22, 'metal', Math.PI / 2);
  q.blob(c, 0, 3.4, 11.4, 2.2, 2.1, 2.6, 'metal');
  q.box(DARK, 0, 4.2, 12.6, 1.8, 0.5, 0.6, 'rubber');
  q.rbox(c, 0, 4.2, -12.4, 3.0, 2.4, 4.0, 0, 0.25, 0, 'metal');
  q.box(c, 0, 5.6, 0.6, 30, 0.5, 4.0, 'metal');
  for (const x of [-10, -5, 5, 10]) q.cyl(0x4a4e3e, x, 5.0, 2.4, 0.7, 3.4, 'metal', Math.PI / 2);
  q.box(c, 0, 5.2, -14.2, 0.45, 6.4, 4.4, 'metal');
  q.box(c, 0, 6.0, -14.4, 11, 0.3, 2.6, 'metal');
  // The ramp down at the back, the hold open.
  q.rbox(0x3a3e30, 0, 0.75, -13.4, 3.4, 0.2, 4.2, 0, -0.42, 0, 'metal');
  for (const s of [-1, 1]) q.box(0x2a2c26, s * 2.1, 0, 0.5, 1.0, 1.6, 5.0, 'metal');
  q.solid(0, 0, 4.8, 24, 5.8);
  zone(S, q, 'cargoHold', -2.3, -11.5, 2.3, 4, 1.2, 5.6);
  zone(S, q, 'vehicleCabin', -2.0, 9, 2.0, 12.5, 2.6, 5.4);
}

/** A military helicopter placeholder (olive, 14 m with the boom), nose +Z. */
function helicopter(S: Site, q: Place): void {
  q.box(OLIVE, 0, 0.6, 0, 2.2, 2.2, 6.4, 'metal');
  q.blob(OLIVE, 0, 1.6, 3.4, 1.05, 1.0, 1.4, 'metal');
  q.box(DARK, 0, 1.7, 3.6, 1.6, 0.8, 1.0, 'rubber');
  q.box(OLIVE, 0, 1.6, -6.4, 0.5, 0.6, 7, 'metal');
  q.box(OLIVE, 0, 2.0, -9.6, 0.2, 1.8, 1.0, 'metal');
  q.box(0x2a2c26, 0, 2.8, 0, 0.5, 0.5, 0.5, 'metal');
  for (let k = 0; k < 4; k++) q.rbox(0x2a2c26, 0, 3.12, 0, 15, 0.06, 0.45, (k * Math.PI) / 4 + 0.3, 0, 0, 'metal');
  for (const s of [-1, 1]) q.box(0x2a2c26, s * 1.1, 0, 0.3, 0.12, 0.12, 5.0, 'metal');
  q.solid(0, 0, 2.4, 8.4, 2.9);
  zone(S, q, 'vehicleCabin', -1.13, -2.5, 1.13, 4.2, 0.6, 2.85);
}

/** A big shed: three walls, roof, open front toward local −Z of the shed (its door side faces `face`). */
function hangar(S: Site, x0: number, z0: number, x1: number, z1: number, h: number, openSide: 'z0' | 'z1'): void {
  const wall = 0x7a7e78;
  S.wallX(wall, x0, x1, openSide === 'z0' ? z1 : z0, h, [], 'metal');
  S.wallZ(wall, z0, z1, x0, h, [], 'metal');
  S.wallZ(wall, z0, z1, x1, h, [], 'metal');
  // Over the open side: a header beam.
  const zo = openSide === 'z0' ? z0 : z1;
  for (let x = x0; x < x1 - 0.1; x += 8) {
    const w = Math.min(8, x1 - x);
    S.p.box(wall, x + w / 2, h - 1.5, zo, w, 1.5, 0.3, 'metal');
  }
  S.roof(x0, z0, x1, z1, h, 0x5a5c5e, 0x6a6e70, 0x4a4e52);
}

// ── Airport ──────────────────────────────────────────────────────────────────

export function airport(S: Site, rand: Rand): void {
  const p = S.p;
  const LX = S.lotX;
  const LZ = S.lotZ;
  // Fence round it, the gate to the parking.
  fence(S, -LX, -LZ, LX, -LZ, false);
  fence(S, -LX, -LZ, -LX, LZ, false);
  fence(S, LX, -LZ, LX, LZ, false);
  fence(S, -LX, LZ, -40, LZ, false);
  fence(S, -12, LZ, LX, LZ, false);
  // Runway with its markings; the taxiway; the apron.
  S.slab(0x2e3032, -LX + 4, -48, LX - 4, -28, 0, 0.03, 'asphalt');
  for (let x = -LX + 16; x < LX - 16; x += 12) p.box(0xd8d4c8, x, 0.03, -38, 5, 0.006, 0.5, 'asphalt');
  for (const e of [-1, 1]) {
    for (let k = 0; k < 6; k++) p.box(0xd8d4c8, e * (LX - 12), 0.03, -46 + k * 3.2 + 0.8, 8, 0.006, 1.4, 'asphalt');
  }
  S.slab(0xd8d4c8, -LX + 4, -47.4, LX - 4, -47.0, 0.03, 0.006, 'asphalt');
  S.slab(0xd8d4c8, -LX + 4, -29.0, LX - 4, -28.6, 0.03, 0.006, 'asphalt');
  S.slab(0x34363a, -7, -28, 7, -14, 0, 0.03, 'asphalt');
  S.slab(0x5a5c5e, -72, -14, 40, 6, 0, 0.035, 'concrete');
  // Parking in front of the terminal, cars.
  S.slab(0x3a3c3e, -70, 34, -12, 52, 0, 0.03, 'asphalt');
  for (let x = -68; x <= -14; x += 3) p.box(0xd8d4c8, x, 0.035, 43, 0.1, 0.005, 4.5, 'asphalt');
  for (const x of [-64, -55, -46, -33, -21]) if (rand() < 0.75) S.car(x, 43, rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2, rand);

  // Terminal (x −48…−8, z 8…30): glass facade to the apron, the entrance from the parking.
  const H = 6.5;
  const tx0 = -48;
  const tx1 = -8;
  const tz0 = 8;
  const tz1 = 30;
  const side = 0x8a8e8a;
  const glassHoles = [-44, -38, -32, -26, -20, -14].map((at) => ({ at, w: 4.6, h: 5.4, sill: 0.6 }));
  S.wallX(side, tx0, tx1, tz0, H, glassHoles);
  for (const h of glassHoles) S.paneX(h.at, tz0, h.w, h.sill!, h.h);
  S.wallX(side, tx0, tx1, tz1, H, [{ at: -28, w: 2.4, h: 2.6 }, ...[-42, -36, -20, -14].map((at) => ({ at, w: 3.6, h: 4.5, sill: 1.0 }))]);
  for (const at of [-42, -36, -20, -14]) S.paneX(at, tz1, 3.6, 1.0, 4.5);
  S.doorX(-28, tz1, { width: 2.4, style: 'glass' });
  S.wallZ(side, tz0, tz1, tx0, H);
  S.wallZ(side, tz0, tz1, tx1, H);
  S.roof(tx0, tz0, tx1, tz1, H, 0xa8aaa6, 0xc8cac6, 0x4a4c4e);
  p.box(0x2a4a6a, -28, H - 1.6, tz1 + 0.12, 14, 1.0, 0.08, 'plaster');
  // Check-in: counters with the belt behind them.
  for (let k = 0; k < 4; k++) {
    const x = -44 + k * 5;
    p.box(0x5a5e62, x, 0, 24, 3.2, 1.1, 0.8, 'metal', true);
    p.box(0x8a8e92, x, 1.1, 24, 3.3, 0.05, 0.9, 'plaster');
    S.container('checkin', x, 23.2);
  }
  S.slab(0x2a2c2e, -46, 25.4, -26, 26.2, 0.4, 0.3, 'rubber');
  // Waiting hall: rows of seats toward the apron windows.
  for (const z of [12, 15, 18]) for (const x of [-44, -38, -32]) F.bench(p.at(x, z, 2), rand);
  // Baggage claim: a belt loop with suitcases left on it and round it.
  const bx0 = -24;
  const bx1 = -12;
  for (const [x, z, w, d] of [
    [(bx0 + bx1) / 2, 14, bx1 - bx0, 0.9],
    [(bx0 + bx1) / 2, 20, bx1 - bx0, 0.9],
    [bx0, 17, 0.9, 6.9],
    [bx1, 17, 0.9, 6.9],
  ] as const) p.box(0x3a3c3e, x, 0, z, w, 0.5, d, 'rubber', true);
  for (const [x, z, r] of [
    [-21, 12.6, 0],
    [-15, 21.4, 2],
    [-25.4, 18, 1],
    [-10.6, 15, 3],
    [-18, 12.4, 0],
  ] as const) F.suitcase(p.at(x, z, r as Quarter), rand, rand() < 0.3);

  // Control tower.
  p.box(0xa8a8a2, 12, 0, 14, 4, 20, 4, 'concrete', true);
  p.box(0x8a8a84, 12, 20, 14, 7, 0.4, 7, 'concrete');
  p.box(0x2a3036, 12, 20.4, 14, 6.6, 2.6, 6.6, 'glass');
  p.box(0x5a5c5e, 12, 23, 14, 7.6, 0.4, 7.6, 'roof');
  p.box(0x3a3c3e, 12, 23.4, 14, 0.2, 2.5, 0.2, 'metal');

  // Hangar with a light plane and tools.
  hangar(S, 48, -8, 86, 26, 11, 'z0');
  if (!aircraft(S, 'lightplane', p.at(60, 8, 2), rand)) lightPlane(S, p.at(60, 8, 2), 0xb8b0a0);
  if (!aircraft(S, 'lightplane', p.at(75, 12, 2), rand)) lightPlane(S, p.at(75, 12, 2), 0x8a3a2a);
  p.box(0x5a4a3a, 84, 0, 18, 1.2, 0.9, 3, 'wood', true);
  S.container('garage', 83.4, 18);
  F.boxes(p.at(52, 22), rand, 3);

  // Airliners: one at the gate, one parked on the apron; one broke up on the runway.
  if (!aircraft(S, 'airliner', p.at(-28, -10, 0), rand)) airliner(S, p.at(-28, -10, 0), 0x2a4a8a);
  if (!aircraft(S, 'airliner', p.at(-64, -4, 1), rand)) airliner(S, p.at(-64, -4, 1), 0x8a2a2a);
  const crash = p.at(42, -38).tipped(0.35, 0, 0.22, 0);
  if (!aircraft(S, 'airliner', crash, rand)) airliner(S, crash, 0x2a6a4a);
  const tail = p.at(70, -42).tipped(1.4, 0, -0.5, 0);
  tail.cyl(WHITE, 0, 1.6, 0, 1.9, 9, 'busPaint', Math.PI / 2);
  tail.box(WHITE, 0, 2.6, -3, 0.35, 4.2, 3.6, 'busPaint');
  p.at(28, -30).tipped(-0.6, 0, 0, 0).rbox(WHITE, 0, 0.3, 0, 12, 0.35, 4, 0, 0, 0.08, 'busPaint');
  for (const [x, z, s] of [
    [42, -38, 10],
    [58, -40, 7],
    [30, -32, 5],
  ] as const) p.decal('decalSoot', x, z, s, rand);
  for (let k = 0; k < 10; k++) p.rbox(0x8a8e92, 30 + rand() * 40, 0.08, -46 + rand() * 16, 0.4 + rand() * 1.2, 0.08, 0.3 + rand() * 0.8, rand() * 6, 0, 0, 'metal');
}

// ── Military base ────────────────────────────────────────────────────────────

export function militaryBase(S: Site, rand: Rand): void {
  const p = S.p;
  const L = Math.min(S.lotX, S.lotZ);
  // Fence with barbed wire, a tower in every corner, the checkpoint at the gate.
  fence(S, -L, -L, L, -L, true);
  fence(S, -L, -L, -L, L, true);
  fence(S, L, -L, L, L, true);
  fence(S, -L, L, -6, L, true);
  fence(S, 6, L, L, L, true);
  for (const [x, z] of [
    [-L + 3, -L + 3],
    [L - 3, -L + 3],
    [-L + 3, L - 3],
    [L - 3, L - 3],
  ]) watchtower(S, x, z);
  p.box(0x8a8a7a, 9, 0, L - 4, 2.4, 2.6, 2.4, 'plaster', true);
  p.box(0x2a3036, 9, 1.2, L - 2.78, 1.8, 0.9, 0.02, 'glass');
  p.box(0x4a4c40, 9, 2.6, L - 4, 2.8, 0.15, 2.8, 'roof');
  for (let k = 0; k < 6; k++) p.box(k % 2 ? 0xc8c4b8 : 0x9a2a22, -5 + k * 1.75, 1.0, L + 0.4, 1.75, 0.14, 0.14, 'metal');
  for (const x of [-9, 12]) for (let k = 0; k < 4; k++) p.box(0x8a7a5a, x + (k % 2) * 0.8, Math.floor(k / 2) * 0.35, L - 1.2, 0.75, 0.35, 0.45, 'rubber', true);
  // Roads inside: from the gate to the hangar apron.
  S.slab(0x4a4c4e, -4, -6, 4, L, 0, 0.03, 'concrete');
  S.slab(0x4a4c4e, -56, -6, 56, 2, 0, 0.03, 'concrete');

  // Barracks: bunks and lockers.
  const brick = 0x7a7462;
  for (const [z0, z1] of [
    [30, 42],
    [12, 24],
  ]) {
    S.wallX(brick, -52, -12, z1, 3.2, [{ at: -32, w: 1.2, h: 2.2 }, ...[-46, -40, -24, -18].map((at) => ({ at, w: 2, h: 2.2, sill: 1.0 }))]);
    for (const at of [-46, -40, -24, -18]) S.paneX(at, z1, 2, 1.0, 2.2);
    S.doorX(-32, z1, { width: 1.2 });
    S.wallX(brick, -52, -12, z0, 3.2);
    S.wallZ(brick, z0, z1, -52, 3.2);
    S.wallZ(brick, z0, z1, -12, 3.2);
    S.roof(-52, z0, -12, z1, 3.2, 0x8a8678, 0xb8b4a8, 0x3a3c32);
    for (let k = 0; k < 6; k++) {
      const x = -49 + k * 6.2;
      if (Math.abs(x + 32) < 2) continue;
      F.bed(p.at(x, z0 + 0.3, 0), rand, 0.9, rand() < 0.5);
      p.box(0x4a4e3e, x, 1.0, z0 + 1.3, 0.95, 0.08, 2.0, 'metal');
      p.box(0x6a6e5a, x, 1.08, z0 + 1.3, 0.9, 0.12, 1.9, 'rubber');
      p.box(0x5a5e4a, x + 1.6, 0, z0 + 0.35, 0.8, 1.9, 0.5, 'metal', true);
      S.container('militaryLocker', x + 1.6, z0 + 1.0);
    }
  }

  // Canteen: tables, the kitchen.
  S.wallX(brick, -52, -22, -12, 3.4, [{ at: -37, w: 1.2, h: 2.2 }, ...[-48, -28].map((at) => ({ at, w: 2.4, h: 2.3, sill: 1.0 }))]);
  for (const at of [-48, -28]) S.paneX(at, -12, 2.4, 1.0, 2.3);
  S.doorX(-37, -12, { width: 1.2 });
  S.wallX(brick, -52, -22, -40, 3.4);
  S.wallZ(brick, -40, -12, -52, 3.4);
  S.wallZ(brick, -40, -12, -22, 3.4);
  S.roof(-52, -40, -22, -12, 3.4, 0x8a8678, 0xb8b4a8, 0x3a3c32);
  for (const z of [-17, -22, -27]) for (const x of [-46, -38, -30]) F.diningTable(p.at(x, z), rand, 4, rand() < 0.4);
  F.kitchenRun(p.at(-44, -39.6, 0), rand, 8);
  S.retype('canteen');
  F.kitchenRun(p.at(-32, -39.6, 0), rand, 8);
  S.retype('canteen');

  // Warehouse: shelves of army crates.
  S.wallX(0x6a6e64, -20, -6, -24, 5, [{ at: -13, w: 3, h: 3.2 }], 'metal');
  S.wallX(0x6a6e64, -20, -6, -54, 5, [], 'metal');
  S.wallZ(0x6a6e64, -54, -24, -20, 5, [], 'metal');
  S.wallZ(0x6a6e64, -54, -24, -6, 5, [], 'metal');
  S.roof(-20, -54, -6, -24, 5, 0x6a6c66, 0x8a8c86, 0x4a4c46);
  for (const z of [-50, -44, -38, -32]) {
    for (const x of [-17, -9]) {
      p.box(0x4a4e3e, x, 0, z, 2.6, 0.12, 1.2, 'wood', true);
      for (let k = 0; k < 2; k++) p.box(0x4e5438, x, 0.12 + k * 0.6, z, 2.2, 0.55, 1.0, 'wood');
      S.container('militaryCrate', x, z + 0.9);
    }
  }

  // Garages: open bays with the armour in front.
  hangar(S, 8, -56, 52, -40, 5.5, 'z1');
  for (const x of [19, 30, 41]) S.p.box(0x7a7e78, x, 0, -48, 0.2, 5.5, 16, 'metal', true);
  vehicleModel(S, 'tank', 14, -47, Math.PI / 2, rand);
  vehicleModel(S, 'apc', 25, -47, Math.PI / 2, rand);
  vehicleModel(S, 'truck', 36, -47, Math.PI / 2, rand);
  vehicleModel(S, 'truck', 47, -47, Math.PI / 2, rand);
  vehicleModel(S, 'tank', -30, -50, 0.1, rand);
  vehicleModel(S, 'apc', 18, 46, -Math.PI / 2 + 0.2, rand);

  // Hangar with two fighters; the transport plane on its apron.
  hangar(S, 10, -36, 54, -12, 9, 'z1');
  if (!aircraft(S, 'fighter', p.at(22, -24, 0), rand)) fighter(S, p.at(22, -24, 0));
  if (!aircraft(S, 'fighter', p.at(42, -26, 0), rand)) fighter(S, p.at(42, -26, 0));
  S.slab(0x4a4c4e, 8, -12, 56, 22, 0, 0.032, 'concrete');
  transport(S, p.at(32, 6, 1));

  // Helipad with its H, two helicopters.
  S.slab(0x5a5c5e, 24, 28, 50, 54, 0, 0.034, 'concrete');
  for (const [x, z, w, d] of [
    [33, 41, 0.8, 7],
    [41, 41, 0.8, 7],
    [37, 41, 8, 0.8],
  ]) p.box(0xd8d4c8, x, 0.036, z, w, 0.005, d, 'asphalt');
  if (!aircraft(S, 'heliMil', p.at(30, 35, 0).tipped(0.4), rand)) helicopter(S, p.at(30, 35, 0).tipped(0.4));
  if (!aircraft(S, 'heliMil', p.at(45, 49, 1), rand)) helicopter(S, p.at(45, 49, 1));

  // Parade ground with the flagpole.
  S.slab(0x5a5c5e, -48, -8, -16, 8, 0, 0.032, 'concrete');
  p.box(0x8a8e92, -32, 0, 0, 0.15, 10, 0.15, 'metal', true);
  p.box(0x4a5a3a, -31.2, 8.4, 0, 1.4, 0.9, 0.02, 'rubber');
}
