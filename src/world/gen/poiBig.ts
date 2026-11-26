import { Matrix4, Vector3 } from 'three';
import type { ContainerType } from '../../data/loot';
import { GLB_WORLD_SPECS, type GlbModelId, pickWorldVehicle } from '../worldModels';
import { sandbags } from './chaos';
import * as F from './furniture';
import type { Place, Quarter } from './furniture';
import type { Rand } from './pieces';
import type { Site } from './poiSite';

/*
 * POI stage 4: the big places, each spanning several chunks (every chunk runs the whole plan with the same
 * random numbers and keeps its own part — see Builder.clip). Airliners, light planes, fighters, military
 * helicopters, tanks, APCs and trucks are backed strictly by 3D models.
 */

// ── Pieces ───────────────────────────────────────────────────────────────────

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
  const glbId = pickWorldVehicle(group, rand());
  const spec = GLB_WORLD_SPECS[glbId];
  const [x, z] = S.p.pt(lx, lz);
  if (!S.b.inClip(x, z)) return true;
  const wyaw = yaw + (S.p.r * Math.PI) / 2;
  S.b.glb(glbId, x, 0.01, z, wyaw - Math.PI / 2);
  // spec.size = [W, H, L] with L along nose (-Z)
  const W = spec.size[0];
  const H = spec.size[1];
  const L = spec.size[2];
  S.b.colliders.addOrientedBox(x, z, L / 2, W / 2, wyaw, -0.5, H + 0.05);
  const truck = group === 'truck';
  const back = truck ? L * 0.18 : 0;
  const c = Math.cos(wyaw);
  const sn = Math.sin(wyaw);
  S.b.containers.push({
    type: truck ? 'cargoHold' : 'vehicleCabin',
    x: x - c * back,
    z: z + sn * back,
    box: [x - c * back, H / 2, z + sn * back, (truck ? L * 0.32 : L / 2) + 0.03, H / 2 + 0.03, W / 2 + 0.03, wyaw],
  });
  return true;
}

/** What an aircraft model needs: its GLB id, scale, fuselage width (walk under wings) and search zones. */
interface Craft {
  glbId: GlbModelId;
  scale: number;
  body: number;
  /** Zones along the nose axis: type, middle (fraction of the length from the middle, + = nose), half length (fraction), y0, y1 (fractions of the height), half width (m). */
  zones: [ContainerType, number, number, number, number, number][];
}
const CRAFT: Record<'airliner' | 'lightplane' | 'fighter' | 'heliMil', Craft> = {
  airliner: { glbId: 'passenger_airliner_22', scale: 1.0, body: 4.2, zones: [['planeCabin', 0.2, 0.22, 0.17, 0.58, 2.1], ['cargoHold', -0.15, 0.18, 0.12, 0.3, 2.1]] },
  lightplane: { glbId: 'passenger_airliner_22', scale: 0.34, body: 1.4, zones: [['planeCabin', 0.08, 0.16, 0.2, 0.85, 0.75]] },
  fighter: { glbId: 'mi8_wreck_remesh', scale: 0.78, body: 2.6, zones: [['vehicleCabin', 0.18, 0.12, 0.3, 0.8, 0.8]] },
  heliMil: { glbId: 'mi8_wreck_remesh', scale: 1.0, body: 2.6, zones: [['vehicleCabin', 0.12, 0.14, 0.05, 0.75, 1.3]] },
};

/**
 * An installed aircraft GLB model on a place (its nose along the place's local +Z, tipped if the place is),
 * collider over the fuselage, its cabin / hold zones.
 */
export function aircraft(S: Site, kind: keyof typeof CRAFT, q: Place, _rand: Rand, _charred = false): boolean {
  const c = CRAFT[kind];
  const spec = GLB_WORLD_SPECS[c.glbId];
  const M = q.frame(new Matrix4()).multiply(new Matrix4().makeRotationY(-Math.PI / 2)).multiply(new Matrix4().makeTranslation(0, 0.01, 0));
  const at = new Vector3().setFromMatrixPosition(M);
  if (!S.b.inClip(at.x, at.z)) return true;
  const nose = new Vector3(1, 0, 0).transformDirection(M);
  const yaw = Math.atan2(-nose.z, nose.x);
  const L = spec.size[2] * c.scale;
  const H = spec.size[1] * c.scale;
  S.b.glb(c.glbId, at.x, at.y, at.z, yaw - Math.PI / 2, { scale: c.scale });
  S.b.colliders.addOrientedBox(at.x, at.z, L / 2, c.body / 2, yaw, -0.5, at.y + H);
  for (const [type, mid, half, y0, y1, w] of c.zones) {
    const x = at.x + nose.x * mid * L;
    const z = at.z + nose.z * mid * L;
    S.b.containers.push({ type, x, z, box: [x, at.y + ((y0 + y1) / 2) * H, z, half * L, ((y1 - y0) / 2) * H, w, yaw] });
  }
  return true;
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
  for (const h of glassHoles) if (h.at !== -38 || !S.has('terminalCrash')) S.paneX(h.at, tz0, h.w, h.sill!, h.h);
  S.wallX(side, tx0, tx1, tz1, H, [{ at: -28, w: 2.4, h: 2.6 }, ...[-42, -36, -20, -14].map((at) => ({ at, w: 3.6, h: 4.5, sill: 1.0 }))]);
  for (const at of [-42, -36, -20, -14]) S.paneX(at, tz1, 3.6, 1.0, 4.5);
  S.doorX(-28, tz1, { width: 2.4, style: 'glass' });
  S.wallZ(side, tz0, tz1, tx0, H);
  S.wallZ(side, tz0, tz1, tx1, H);
  S.roof(tx0, tz0, tx1, tz1, H, 0xa8aaa6, 0xc8cac6, 0x4a4c4e);
  p.box(0x2a4a6a, -28, H - 1.6, tz1 + 0.12, 14, 1.0, 0.08, 'plaster');
  // Check-in counters.
  for (let k = 0; k < 4; k++) {
    const x = -44 + k * 5;
    p.model('receptionDesk', rand, x, 0, 24, Math.PI, 1.2, 0.75, 0.2, true);
    S.container('checkin', x, 23.2);
  }
  S.slab(0x2a2c2e, -46, 25.4, -26, 26.2, 0.4, 0.3, 'rubber');
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

  // Hangar with light planes and workbench.
  hangar(S, 48, -8, 86, 26, 11, 'z0');
  aircraft(S, 'lightplane', p.at(60, 8, 2), rand);
  aircraft(S, 'lightplane', p.at(75, 12, 2), rand);
  p.model('labTable', rand, 84, 0, 18, Math.PI / 2, 1, 0.65, 0.35, true);
  S.container('garage', 83.4, 18);
  F.boxes(p.at(52, 22), rand, 3);

  // Airliners: one at the gate, one parked on the apron; one broke up on the runway.
  aircraft(S, 'airliner', p.at(-28, -10, 0), rand);
  aircraft(S, 'airliner', p.at(-64, -4, 1), rand);
  const crash = p.at(42, -38).tipped(0.35, 0, 0.22, 0);
  aircraft(S, 'airliner', crash, rand);
  for (const [x, z, s] of [
    [42, -38, 10],
    [58, -40, 7],
    [30, -32, 5],
  ] as const) p.decal('decalSoot', x, z, s, rand);
}

// ── Military base ────────────────────────────────────────────────────────────

export function militaryBase(S: Site, rand: Rand): void {
  const p = S.p;
  const L = Math.min(S.lotX, S.lotZ);
  // Fence with barbed wire, a tower in every corner, the checkpoint at the gate.
  fence(S, -L, -L, L, -L, true);
  if (S.has('breach')) {
    // A truck came through here (poiScenes): a gap in the west fence.
    fence(S, -L, -L, -L, -8, true);
    fence(S, -L, 0, -L, L, true);
  } else fence(S, -L, -L, -L, L, true);
  fence(S, L, -L, L, L, true);
  fence(S, -L, L, -6, L, true);
  fence(S, 6, L, L, L, true);
  for (const [x, z] of [
    [-L + 3, -L + 3],
    [L - 3, -L + 3],
    [-L + 3, L - 3],
    [L - 3, L - 3],
  ]) watchtower(S, x, z);
  p.model('guardBooth', rand, 9, 0, L - 4, 0, 1, 0.72, 0.25, true);
  for (let k = 0; k < 6; k++) p.box(k % 2 ? 0xc8c4b8 : 0x9a2a22, -5 + k * 1.75, 1.0, L + 0.4, 1.75, 0.14, 0.14, 'metal');
  for (const x of [-9, 12]) sandbags(p, x, L - 1.2, 1.6, rand);
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
      p.model('locker', rand, x + 1.6, 0, z0 + 0.35, 0, 1, 0.55, 0.45, true);
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
      p.model('supplyCrate', rand, x, 0, z, 0, 1.35, 0.78, 0.15, true);
      // The front row is the base's armoury: rifles, rounds, the only RPGs.
      S.container(z === -50 ? 'baseArmory' : 'militaryCrate', x, z + 0.9);
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

  // Hangar with two fighters; heavy aircraft on the apron.
  hangar(S, 10, -36, 54, -12, 9, 'z1');
  aircraft(S, 'fighter', p.at(22, -24, 0), rand);
  aircraft(S, 'fighter', p.at(42, -26, 0), rand);
  S.slab(0x4a4c4e, 8, -12, 56, 22, 0, 0.032, 'concrete');
  aircraft(S, 'airliner', p.at(32, 6, 1), rand);

  // Helipad with its H (reserved cleanly for the interactive flyable Mi-8).
  S.slab(0x5a5c5e, 24, 28, 50, 54, 0, 0.034, 'concrete');
  for (const [x, z, w, d] of [
    [33, 41, 0.8, 7],
    [41, 41, 0.8, 7],
    [37, 41, 8, 0.8],
  ]) p.box(0xd8d4c8, x, 0.036, z, w, 0.005, d, 'asphalt');

  // Parade ground with the flagpole.
  S.slab(0x5a5c5e, -48, -8, -16, 8, 0, 0.032, 'concrete');
  p.box(0x8a8e92, -32, 0, 0, 0.15, 10, 0.15, 'metal', true);
  p.box(0x4a5a3a, -31.2, 8.4, 0, 1.4, 0.9, 0.02, 'rubber');
}
