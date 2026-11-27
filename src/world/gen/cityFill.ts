import { Matrix4, Quaternion, Vector3 } from 'three';
import { pickModel } from '../models';
import { buildCar, CAR_PAINTS, modelLibrary, placeModel } from '../props/car';
import type { GlbModelId } from '../worldModels';
import { isGlbClear } from './footprint';
import { Place } from './furniture';
import { type BuildingDesc, buildHighriseShell, FLOOR_H, type FacadeSurface, groundDecal, wallDecalZ } from './highrise';
import { DOWNTOWN_RADIUS, PAVE } from './layout';
import { LIFE, spotHash } from './lifeKinds';
import { type Builder, pick, type Rand } from './pieces';

/*
 * The fabric between the landmarks: a tight American downtown block (buildings shoulder to shoulder,
 * narrow side alleys, a cluttered back courtyard with dead ends, fire escapes overhead) and cars
 * where people actually leave them — at the curb, in marked parking stalls, in the back lot.
 */

const FACADES: FacadeSurface[] = ['facadeConcrete', 'facadeBrick', 'facadeOffice'];
/** Facade textures tile every 3 m: building edges sit on that grid so windows never straddle a corner. */
const up3 = (v: number) => Math.ceil(v / 3) * 3;
const down3 = (v: number) => Math.floor(v / 3) * 3;
const SIDE_ALLEY = 3;

const paints = Object.values(CAR_PAINTS);
const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _axis = new Vector3();

interface Row {
  south: boolean;
  z0: number;
  z1: number;
}

/**
 * Downtown block: two rows of high-rises back to back. In each row two buildings stand 3 m apart
 * (a side alley), the leftover strip at the east end is a gated service gap. Between the rows a back
 * courtyard: dumpsters, pallets, sheet-metal fences splitting it into dead ends, a brick wall at one end,
 * fire escapes overhead, a car or two. Sometimes one lot is a parking lot instead of a tower.
 */
export function downtownBlock(b: Builder, i: number, j: number, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): BuildingDesc[] {
  b.block(0x5e5c56, X0, 0, Z0, X1 - X0, PAVE.plaza, Z1 - Z0, 'asphalt');
  if (i === 1 && j === -1) {
    return airlinerCrashBlock(b, i, j, X0, Z0, X1, Z1, rand);
  }
  const out: BuildingDesc[] = [];
  const chunkKey = (i + 32768) * 65536 + (j + 32768);
  const centrality = 1 - Math.max(Math.abs(i), Math.abs(j)) / (DOWNTOWN_RADIUS + 1);
  let parkingLot = !(i === 0 && j === 0) && rand() < 0.25 ? Math.floor(rand() * 4) : -1;
  if (i === 1 && j === 0 && parkingLot === 0) parkingLot = 1;
  const rows: Row[] = [];
  let n = 0;
  // Fire escapes are placed last, only where they clear every building volume of the block.
  const escapes: EscapeSpec[] = [];

  const span = down3(Z1 - 0.3) - up3(Z0 + 0.3);
  for (const south of [true, false]) {
    let d: number;
    if (south) {
      d = pick(rand, span >= 48 ? [18, 21, 24] : [18, 21]);
    } else {
      const maxD = span - (rows[0].z1 - rows[0].z0) - 6;
      const pool = [15, 18, 21, 24].filter((v) => v <= maxD);
      d = pool.length ? pick(rand, pool) : 15;
    }
    const z0 = south ? up3(Z0 + 0.3) : down3(Z1 - 0.3) - d;
    const row: Row = { south, z0, z1: z0 + d };
    rows.push(row);
    const xa = up3(X0 + 0.3);
    const wW = pick(rand, [15, 18, 21, 24]);
    const xb = xa + wW + SIDE_ALLEY;
    const wE = Math.min(24, down3(X1 - 0.3) - xb);
    const lots: [number, number][] = [
      [xa, wW],
      [xb, wE],
    ];
    const built = [false, false];
    lots.forEach(([x0, w], k) => {
      if (parkingLot === (south ? 0 : 2) + k) {
        surfaceParking(b, x0, row.z0, x0 + w, row.z1, south, rand);
        return;
      }
      built[k] = true;
      let floors = Math.max(5, Math.min(25, 5 + Math.floor(rand() * (6 + 15 * centrality))));
      let facade = pick(rand, FACADES);
      const isHeliImpactBuilding = i === 1 && j === 0 && south && k === 0;
      const hxOff = Math.max(-w * 0.5 + 3.6, -3.6);
      if (isHeliImpactBuilding) {
        floors = Math.max(7, floors);
        facade = 'facadeConcrete';
      }
      const desc: BuildingDesc = {
        id: chunkKey * 16 + n++,
        cx: x0 + w / 2,
        cz: z0 + d / 2,
        w,
        d,
        floors,
        facade,
        flip: !south,
        kind: facade === 'facadeOffice' ? 'offices' : 'apartments',
        seed: Math.floor(rand() * 1e9),
        ...(isHeliImpactBuilding
          ? { breach: { x: x0 + w / 2 + hxOff, y: 3 * FLOOR_H, w: 6.4, h: 2 * FLOOR_H } }
          : {}),
      };
      buildHighriseShell(b, desc, rand);
      if (isHeliImpactBuilding) mi8HighriseImpact(b, desc, hxOff);
      out.push(desc);
    });
    sideAlley(b, xa + wW, xb, row, rand, built[1], escapes);
    eastGap(b, xb + wE, X1, row, rand);
  }
  backCourtyard(b, X0, X1, rows[0].z1, rows[1].z0, rand);
  for (const e of escapes) if (escapeClear(e, out)) fireEscape(b, e.axis, e.wall, e.outward, e.u0, e.storeys);
  return out;
}

/** Monumental downtown catastrophe block: Boeing airliner crashed into a partially collapsed high-rise. */
function airlinerCrashBlock(
  b: Builder,
  i: number,
  j: number,
  X0: number,
  Z0: number,
  X1: number,
  Z1: number,
  rand: Rand,
): BuildingDesc[] {
  const out: BuildingDesc[] = [];
  const chunkKey = (i + 32768) * 65536 + (j + 32768);
  // Intact standing background tower in the NW corner
  const standing: BuildingDesc = {
    id: chunkKey * 16,
    cx: up3(X0 + 0.3) + 9,
    cz: down3(Z1 - 0.3) - 9,
    w: 18,
    d: 18,
    floors: 7,
    facade: 'facadeConcrete',
    flip: true,
    kind: 'offices',
    seed: Math.floor(rand() * 1e9),
  };
  buildHighriseShell(b, standing, rand);
  out.push(standing);

  // Partially collapsed concrete high-rise ruin in the NE/SE crash impact zone
  const rx0 = X0 + 27;
  const rx1 = X1 - 2.5;
  const rz0 = Z0 + 24;
  const rz1 = Z1 - 5.5;
  const rw = rx1 - rx0;
  const rd = rz1 - rz0;
  for (let fl = 0; fl < 4; fl++) {
    const sy = fl * FLOOR_H;
    const stepW = fl < 2 ? rw : rw * (1 - fl * 0.14);
    const stepD = fl < 2 ? rd : rd * (1 - fl * 0.12);
    // Floor slab + jagged remaining concrete walls leaving the SW corner sheared open for the plane nose
    b.block(0x6d6a64, rx0 + (rw - stepW) * 0.35, sy, rz0 + (rd - stepD) * 0.25, stepW, 0.24, stepD, 'concrete', true);
    if (fl < 3) {
      b.block(0x7c7870, rx1 - 0.4, sy, rz0, 0.4, FLOOR_H, stepD, 'facadeConcrete', true);
      b.block(0x74706a, rx0 + 3.5, sy, rz1 - 0.4, stepW - 3.5, FLOOR_H, 0.4, 'facadeConcrete', true);
      if (fl === 0) b.block(0x6a6760, rx0, sy, rz0, 0.35, FLOOR_H * 0.65, 6.5, 'concrete', true);
    }
  }
  // Exposed ruined girders & concrete rubble chunks inside & in front of the breach
  b.block(0x3a3c3e, rx0 + 4, 3.2, rz0 + 4, 0.28, 7.2, 0.28, 'metal', true);
  b.block(0x3a3c3e, rx0 + 12, 3.2, rz0 + 8, 0.28, 8.8, 0.28, 'metal', true);
  for (let k = 0; k < 4; k++) {
    b.block(0x64625c, X0 + 24 + k * 5.2, PAVE.plaza, Z0 + 17 + (k % 2) * 3.5, 2.2, 0.75 + (k % 2) * 0.45, 1.8, 'concrete', true);
  }

  // 15 x 40 m dark scorched impact trench & asphalt skid scar running diagonally into the collapsed tower.
  const ax = X0 + 22.0;
  const az = Z0 + 20.5;
  const ayaw = -Math.PI * 0.72;
  const physYaw = ayaw + Math.PI / 2;
  _m.compose(_p.set(ax - 3.5, PAVE.plaza + 0.012, az - 4.0), _q.setFromAxisAngle(_axis.set(0, 1, 0), ayaw), _s.set(15.0, 0.018, 40.0));
  b.geo(b.box, 0x161514, _m, 'asphalt');
  for (let sIdx = 0; sIdx < 4; sIdx++) {
    const sx = ax - 10 + sIdx * 5.0;
    const sz = az - 12 + sIdx * 5.5;
    groundDecal(b, 'decalSoot', sx, PAVE.plaza + 0.015, sz, 9.5, rand, 1.6);
  }

  // Torn, charred airliner fuselage (NO landing gear) buried nose-first into massive concrete rubble inside the breach.
  b.glb('crashed_boeing_fuselage', ax, PAVE.plaza - 0.08, az, ayaw, { pitch: 0.05, roll: 0.16 });
  b.colliders.addOrientedBox(ax, az, 11.2, 2.9, physYaw, -0.5, 4.8);
  b.glb('building_breach_frame', rx0 + 1.2, 0.15, rz0 + 1.1, -Math.PI * 0.25, { scale: 1.38 });

  // Massive collapsed concrete rubble mounds piled around fuselage & sheared building corner.
  const rubbleSpots: [number, number, number, number][] = [
    [rx0 - 0.5, rz0 + 0.5, 0.4, 1.35],
    [rx0 + 4.8, rz0 + 1.2, 1.7, 1.25],
    [ax + 5.2, az + 4.5, -0.9, 1.15],
    [ax - 3.2, az + 3.0, 2.4, 0.95],
  ];
  for (const [rx, rz, ryaw, rsc] of rubbleSpots) {
    b.glb('concrete_rubble_mound', rx, PAVE.plaza, rz, ryaw, { scale: rsc });
    b.solid(rx - 2.1 * rsc, rz - 2.0 * rsc, rx + 2.1 * rsc, rz + 2.0 * rsc, PAVE.plaza, PAVE.plaza + 1.75 * rsc);
  }

  // Detached broken airliner wing + damaged jet engine ~13.5 m away on the scorched plaza.
  const wx = ax - 11.2;
  const wz = az - 7.8;
  const wyaw = ayaw + 1.9;
  b.glb('crashed_plane_wing', wx, PAVE.plaza - 0.04, wz, wyaw, { pitch: -0.06, roll: 0.14 });
  b.colliders.addOrientedBox(wx, wz, 6.0, 2.4, wyaw, -0.5, 2.4);
  groundDecal(b, 'decalSoot', wx, PAVE.plaza + 0.015, wz, 6.2, rand, 1.3);
  groundDecal(b, 'decalOil', wx + 1.2, PAVE.plaza + 0.016, wz - 0.8, 4.0, rand, 1.3);

  // Burning cars, scattered luggage, debris piles, scorch & fires around the impact site.
  const carSpots: [number, number, number, 'roof' | undefined][] = [
    [X0 + 11.0, Z0 + 8.8, 0.55, 'roof'],
    [X0 + 38.5, Z0 + 9.2, -0.8, undefined],
  ];
  for (let k = 0; k < carSpots.length; k++) {
    const [cx, cz, cyaw, flp] = carSpots[k];
    if (
      buildCar(
        b.batch,
        b.colliders,
        { x: cx, z: cz, yaw: cyaw, paint: CAR_PAINTS.slate, seed: 700 + k, kind: 'wreck', smashed: 0.95, flipped: flp },
        b.containers,
      )
    ) {
      b.life(LIFE.fire, cx, 0.95, cz, 0, 0, 1.2, 0, 0.3 + k * 0.4);
    }
  }
  const debrisOffsets: [number, number, GlbModelId, number][] = [
    [X0 + 15, Z0 + 13, 'Road_Debris_Cluster_2', 1.35],
    [X0 + 28, Z0 + 13, 'Road_Debris_Cluster_2', 1.4],
    [X0 + 10, Z0 + 22, 'abandoned_luggage_pil', 1.3],
    [X0 + 14, Z0 + 27, 'abandoned_luggage_pil', 1.25],
    [X0 + 18.5, Z0 + 8.5, 'giant_trash_mound', 0.95],
  ];
  for (let k = 0; k < debrisOffsets.length; k++) {
    const [dx, dz, id, sc] = debrisOffsets[k];
    if (isGlbClear(b.batch, id, dx, dz, k * 1.1, 0.25, { keepClearGap: 1.5, scale: sc })) {
      b.glb(id, dx, PAVE.plaza, dz, k * 1.1, { scale: sc });
    }
  }
  groundDecal(b, 'decalSoot', ax, PAVE.plaza + 0.015, az, 9.0, rand, 1.6);
  groundDecal(b, 'decalSoot', rx0 + 4, PAVE.plaza + 0.015, rz0 + 4, 7.5, rand, 1.4);
  groundDecal(b, 'decalShards', ax - 4, PAVE.plaza + 0.015, az - 5, 4.5, rand, 1.4);
  groundDecal(b, 'decalOil', ax + 3, PAVE.plaza + 0.016, az - 4, 3.6, rand, 1.3);
  b.life(LIFE.fire, ax + 5.5, 2.2, az + 5.5, 0, 0, 2.4, 0, 0.42);
  b.life(LIFE.fire, rx0 + 3.2, 3.4, rz0 + 3.5, 0, 0, 2.2, 0, 0.87);
  b.life(LIFE.fire, wx + 1.5, 1.2, wz + 0.8, 0, 0, 1.7, 0, 0.19);
  b.life(LIFE.smoke, ax - 1.5, 2.6, az + 1.0, 0, 0, 0, 0, 0.31);
  b.life(LIFE.smoke, rx0 + 5.0, 7.2, rz0 + 4.5, 0, 0, 0, 0, 0.63);
  b.life(LIFE.smoke, wx, 1.8, wz, 0, 0, 0, 0, 0.51);
  return out;
}

/** Crashed Mi-8 with nose buried deep inside a real breached 4th-floor cavity, fire/PointLight, and rubble + wrecks below. */
function mi8HighriseImpact(b: Builder, desc: BuildingDesc, hxOff: number): void {
  const yImpact = 3.25 * FLOOR_H;
  const zFace = desc.cz - desc.d / 2;
  const hx = desc.cx + hxOff;
  wallDecalZ(b, 'decalSoot', hx, yImpact + 1.6, zFace - 0.04, 6.8, -1);

  // Ragged structural breach collar framing the open cavity + Mi-8 cockpit plunged ~30 deg inside.
  b.glb('building_breach_frame', hx, yImpact - 1.0, zFace - 0.12, 0, { scale: 1.1 });
  b.glb('mi8_wreck_remesh', hx, yImpact + 0.45, zFace + 1.35, Math.PI + 0.14, { pitch: -0.52, roll: 0.24 });

  // Live fire (drives WorldLife's flickering warm PointLight) + rising smoke directly inside the breach.
  b.life(LIFE.fire, hx + 0.3, yImpact + 0.3, zFace + 1.2, 0, 0, 2.4, 0, 0.55);
  b.life(LIFE.fire, hx - 0.6, yImpact + 1.1, zFace + 0.5, 0, 0, 1.8, 0, 0.28);
  b.life(LIFE.smoke, hx - 0.4, yImpact + 1.8, zFace - 0.4, 0, 0, 0, 0, 0.77);

  // Falling debris, concrete rubble mounds, glass shards & 1-2 crushed vehicles on the sidewalk/plaza underneath.
  const sidewalkZ = zFace - 1.25;
  groundDecal(b, 'decalSoot', hx, PAVE.plaza + 0.015, sidewalkZ, 5.2, () => 0.4, 1.5);
  groundDecal(b, 'decalShards', hx + 1.2, PAVE.plaza + 0.015, sidewalkZ - 0.4, 4.2, () => 0.6, 1.3);
  const sideRubble: [number, number, number, number][] = [
    [hx - 1.6, zFace - 1.5, 0.5, 0.74],
    [hx + 1.1, zFace - 1.9, -1.2, 0.68],
    [hx - 0.2, zFace - 2.9, 2.1, 0.62],
  ];
  const rubbleIgnore: ReadonlySet<GlbModelId> = new Set(['mi8_wreck_remesh', 'building_breach_frame', 'concrete_rubble_mound']);
  for (const [rx, rz, ryaw, rsc] of sideRubble) {
    if (isGlbClear(b.batch, 'concrete_rubble_mound', rx, rz, ryaw, 0.1, { keepClearGap: 1.0, scale: rsc, ignoreIds: rubbleIgnore })) {
      b.glb('concrete_rubble_mound', rx, PAVE.plaza, rz, ryaw, { scale: rsc });
      b.solid(rx - 1.6 * rsc, rz - 1.5 * rsc, rx + 1.6 * rsc, rz + 1.5 * rsc, PAVE.plaza, PAVE.plaza + 1.3 * rsc);
    }
  }
  const crushedCars: [number, number, number][] = [
    [hx - 4.5, zFace - 1.45, 0.18],
    [hx + 5.2, zFace - 1.42, -0.24],
    [hx + 0.3, zFace - 4.2, 0.12],
  ];
  for (let k = 0; k < crushedCars.length; k++) {
    const [cx, cz, cyaw] = crushedCars[k];
    buildCar(
      b.batch,
      b.colliders,
      { x: cx, z: cz, yaw: cyaw, paint: CAR_PAINTS.slate, seed: 840 + k, kind: 'wreck', flatTire: true, smashed: 0.95 },
      b.containers,
    );
  }
}

const TRASH_PROPS: readonly GlbModelId[] = ['garbage_cluster_1500', 'Road_Debris_Cluster_2', 'abandoned_luggage_pil'];

/** Layered instanced post-apoc garbage mountain using giant_trash_mound + smaller debris along blind walls & alleys. */
export function trashMound(b: Builder, x: number, z: number, seed: number, baseY: number = PAVE.plaza): void {
  let placed = 0;
  const hMain = spotHash(x, z, seed);
  const mainYaw = hMain * Math.PI * 2;
  for (const candScale of [0.85 + hMain * 0.25, 0.62]) {
    if (isGlbClear(b.batch, 'giant_trash_mound', x, z, mainYaw, 0.15, { keepClearGap: 2.0, scale: candScale })) {
      b.glb('giant_trash_mound', x, baseY, z, mainYaw, { scale: candScale });
      b.solid(x - 1.2 * candScale, z - 1.0 * candScale, x + 1.2 * candScale, z + 1.0 * candScale, baseY, baseY + 1.15 * candScale);
      placed++;
      break;
    }
  }
  const count = 2 + Math.floor(hMain * 2);
  for (let k = 0; k < count; k++) {
    const h1 = spotHash(x + k * 1.7, z, seed + 1);
    const h2 = spotHash(x, z + k * 2.3, seed + 2);
    const h3 = spotHash(x + k, z + k, seed + 3);
    const id = TRASH_PROPS[Math.floor(h1 * TRASH_PROPS.length)];
    const px = x + (h2 - 0.5) * 2.1;
    const pz = z + (h3 - 0.5) * 1.8;
    const yaw = h1 * Math.PI * 2;
    const sc = 0.95 + h2 * 0.5;
    if (!isGlbClear(b.batch, id, px, pz, yaw, 0.15, { keepClearGap: 2.0, scale: sc })) continue;
    b.glb(id, px, baseY, pz, yaw, { scale: sc });
    placed++;
  }
  if (placed > 0 && spotHash(x, z, seed + 7) < 0.45) {
    b.life(LIFE.flies, x, baseY + 1.2, z, 0, 0, 0, 0, spotHash(x, z, seed + 8));
  }
}

/** 3 m slot between two towers: a dumpster, litter, maybe a gate at the street, maybe walled off at the back. */
function sideAlley(b: Builder, xL: number, xR: number, row: Row, rand: Rand, escape: boolean, _escapes: EscapeSpec[]): void {
  const streetZ = row.south ? row.z0 : row.z1;
  const courtZ = row.south ? row.z1 : row.z0;
  const inward = row.south ? 1 : -1;
  const mid = (row.z0 + row.z1) / 2;
  // Dumpster against one wall, leaving a 1.8 m way past it.
  const dz = mid + (rand() - 0.5) * 4;
  const wallX = rand() < 0.5 ? xL + 0.05 : xR - 1.15;
  dumpster(b, wallX, dz - 0.9, 'z');
  trashMound(b, (xL + xR) * 0.5, mid - inward * 4.2, 201);
  if (rand() < 0.6) crates(b, rand() < 0.5 ? xL + 0.1 : xR - 1.1, mid + inward * 5, rand);
  if (rand() < 0.4) sheetFence(b, xL, streetZ + inward * 0.3, xR, streetZ + inward * 0.3, rand() < 0.6 ? (xL + xR) / 2 : undefined, 1.2);
  // Dead end: walled off at the courtyard.
  if (rand() < 0.3) brickWall(b, xL, courtZ - inward * 0.3, xR, courtZ - inward * 0.3);
  // Decorative side-alley fire escapes removed (crooked rusty grates over 1st-floor alleys); the roll is kept so the
  // rest of the block stays as it was. Highrises keep their climbable back-wall fire escape (highrise.ts).
  if (escape) rand();
}

/** The strip left at the east end of a row: a service gap behind a gate. */
function eastGap(b: Builder, x0: number, x1: number, row: Row, rand: Rand): void {
  if (x1 - x0 < 1.2) return;
  const streetZ = row.south ? row.z0 : row.z1;
  const inward = row.south ? 1 : -1;
  sheetFence(b, x0, streetZ + inward * 0.4, x1, streetZ + inward * 0.4, rand() < 0.5 ? (x0 + x1) / 2 : undefined, 1.0);
  if (x1 - x0 > 2.2) {
    crates(b, x0 + 0.2, (row.z0 + row.z1) / 2, rand);
    trashMound(b, (x0 + x1) * 0.5, (row.z0 + row.z1) * 0.5 + inward * 3.5, 205);
  }
}

/** The back courtyard between the rows. */
function backCourtyard(b: Builder, X0: number, X1: number, zS: number, zN: number, rand: Rand): void {
  const width = zN - zS;
  if (width < 4) return;
  const zMid = (zS + zN) / 2;
  // Ends: a brick wall at the west street (with a gate most of the time), a sheet fence at the east.
  brickWall(b, X0 + 0.3, zS, X0 + 0.3, zN, rand() < 0.7 ? zMid : undefined);
  sheetFence(b, X1 - 0.3, zS, X1 - 0.3, zN, zMid + (rand() - 0.5) * Math.max(0, width - 3), 1.4);
  // A fence across the courtyard turns each half into a dead end (a gap in it half of the time).
  const split = X0 + (X1 - X0) * (0.35 + rand() * 0.3);
  sheetFence(b, split, zS, split, zN, rand() < 0.5 ? zMid : undefined, 1.2);
  // Dumpsters along the back walls, pallets and crates.
  // Keep clutter and cars clear of the dividing fence.
  const clear = (x: number, half: number) => (Math.abs(x + half - split) < half + 0.6 ? x + 2 * half + 1.4 : x);
  for (let k = 0; k < 3; k++) {
    const x = clear(X0 + 2 + rand() * (X1 - X0 - 7), 0.9);
    const southWall = rand() < 0.5;
    if (dumpster(b, x, southWall ? zS + 0.1 : zN - 1.2, 'x')) {
      b.container('trash', x + 0.9, southWall ? zS + 1.6 : zN - 1.7);
    }
    trashMound(b, x + 2.1, southWall ? zS + 0.95 : zN - 0.95, 210 + k * 7);
  }
  for (let k = 0; k < 2; k++) crates(b, clear(X0 + 2 + rand() * (X1 - X0 - 6), 0.5), rand() < 0.5 ? zS + 0.2 : zN - 1.2, rand);
  for (let k = 0; k < 4; k++) if (rand() >= 0.7) groundDecal(b, 'decalOil', X0 + rand() * (X1 - X0), PAVE.plaza, zMid + (rand() - 0.5) * (width - 2), 2, rand);
  // Wide enough for the residents' cars: parked along the north wall (clear of fire escapes & dumpsters).
  if (width >= 7.5) {
    const lanes = rand() < 0.5 ? 1 : 0;
    for (let k = 0; k < lanes; k++) {
      // One car per half, never across the dividing fence.
      const lo = k === 0 ? X0 + 3.5 : split + 3.2;
      const hi = k === 0 ? split - 3.2 : X1 - 3.5;
      if (hi - lo < 0.5) continue;
      parkedCar(b, lo + rand() * (hi - lo), zN - 2.0, rand() < 0.5 ? 0 : Math.PI, rand, 5.2);
    }
  }
}

/** Parked, not crashed: straight, rarely smashed. Returns true when placed without overlapping. */
function parkedCar(b: Builder, x: number, z: number, yaw: number, rand: Rand, maxLen?: number): boolean {
  const placed = buildCar(
    b.batch,
    b.colliders,
    { x, z, yaw: yaw + (rand() - 0.5) * 0.06, paint: pick(rand, paints), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.2, smashed: rand() < 0.15 ? 0.3 : 0, maxLen },
    b.containers,
  );
  if (placed) b.life(LIFE.car, x, 0, z, Math.sin(yaw), Math.cos(yaw), 4.3, 1.8, spotHash(x, z, 41));
  return placed;
}

/**
 * Parallel parking along a curb: slots every 6.5 m between `from` and `to`, about one in five taken.
 * `alongX`: the road runs along X; `curb` is the curb lane's fixed coordinate; side ±1 picks the heading;
 * no car within 7 m of `keepClear` (along the road).
 */
export function curbParking(b: Builder, alongX: boolean, curb: number, side: number, from: number, to: number, rand: Rand, keepClear?: number): void {
  for (let t = from + 3.5; t < to - 3.5; t += 11.5) {
    if (rand() > 0.24) continue;
    if (keepClear !== undefined && Math.abs(t - keepClear) < 7) continue;
    const baseYaw = alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const tilt = rand() < 0.4 ? (rand() < 0.5 ? 1 : -1) * (0.2 + rand() * 0.28) : (rand() - 0.5) * 0.08;
    parkedCar(b, alongX ? t : curb, alongX ? curb : t, baseYaw + tilt, rand);
  }
}

/** Surface lot: painted stalls in two rows facing an aisle, a pay booth, cars in about a third of the stalls. */
function surfaceParking(b: Builder, x0: number, z0: number, x1: number, z1: number, south: boolean, rand: Rand): void {
  b.block(0x3e4042, x0, 0, z0, x1 - x0, PAVE.plaza + 0.01, z1 - z0, 'asphalt');
  const STALL_W = 2.7;
  const STALL_D = 5.4;
  for (const edge of [z0, z1]) {
    const nose = edge === z0 ? -1 : 1;
    const rowZ = edge === z0 ? z0 + 0.3 : z1 - 0.3 - STALL_D;
    for (let x = x0 + 0.5; x + STALL_W <= x1 - 0.5; x += STALL_W) {
      b.block(0xa8a490, x - 0.05, 0, rowZ, 0.1, PAVE.plaza + 0.032, STALL_D, 'asphalt');
      if (rand() < 0.35) parkedCar(b, x + STALL_W / 2, rowZ + STALL_D / 2, nose < 0 ? Math.PI / 2 : -Math.PI / 2, rand, 5.0);
    }
  }
  // Pay booth by the entrance (street side).
  const bz = south ? z0 + STALL_D + 1.2 : z1 - STALL_D - 2.6;
  const booth = new Place(b, x0 + 1.3, 0, bz + 0.7, south ? 0 : 2);
  if (booth.model('guardBooth', rand, 0, 0, 0, 0, 0.72, 0.72, 0.25)) {
    b.solid(x0 + 0.4, bz - 0.1, x0 + 2.2, bz + 1.6, 0, 2.3);
  }
}

/** Wheeled steel dumpster (GLB Soviet_Dumpster_3000); `along` is the long axis. */
function dumpster(b: Builder, x: number, z: number, along: 'x' | 'z'): boolean {
  const sx = along === 'x' ? 1.8 : 1.1;
  const sz = along === 'x' ? 1.1 : 1.8;
  const cx = x + sx / 2;
  const cz = z + sz / 2;
  const yaw = along === 'x' ? 0 : Math.PI / 2;
  const optSx = sx / 2.0;
  const optSz = sz / 1.896;
  if (!isGlbClear(b.batch, 'Soviet_Dumpster_3000', cx, cz, yaw, 0.6, { keepClearGap: 1.2, sx: optSx, sz: optSz })) {
    return false;
  }
  b.glb('Soviet_Dumpster_3000', cx, 0, cz, yaw, {
    sx: optSx,
    sy: 0.72,
    sz: optSz,
  });
  b.solid(x, z, x + sx, z + sz, 0.12, 1.35);
  return true;
}

/** A pallet with crates on it (3D model, sometimes searchable). */
function crates(b: Builder, x: number, z: number, rand: Rand): void {
  const rot = Math.floor(rand() * 4) as 0 | 1 | 2 | 3;
  const rModel = rand();
  const isSearch = rand() < 0.35;
  if (!isGlbClear(b.batch, 'abandoned_luggage_pil', x + 0.5, z + 0.5, 0, 0.5, { keepClearGap: 1.0 })) return;
  const cp = new Place(b, x + 0.5, 0, z + 0.5, rot);
  if (cp.model(rModel < 0.5 ? 'palletCrates' : 'woodenCrate', rand, 0, 0, 0, 0, 1, 0.82, 0.08)) {
    b.solid(x, z, x + 1.0, z + 1.0, 0, 0.9);
  }
  if (isSearch) b.container('crate', x + 0.5, z + 0.5);
}

/** Corrugated sheet fence, 2.2 m, along X or Z, with an optional gap. */
function sheetFence(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt?: number, gapW = 1.2): void {
  wallLine(b, ax, az, bx, bz, gapAt, gapW, 2.2);
}

/** Brick wall, 2.4 m, with an optional gate gap. */
function brickWall(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt?: number, gapW = 1.4): void {
  wallLine(b, ax, az, bx, bz, gapAt, gapW, 2.4);
}

function wallLine(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt: number | undefined, gapW: number, h: number): void {
  const alongX = Math.abs(bz - az) < 1e-6;
  const a = alongX ? Math.min(ax, bx) : Math.min(az, bz);
  const c = alongX ? Math.max(ax, bx) : Math.max(az, bz);
  const fixed = alongX ? az : ax;
  const spans: [number, number][] = gapAt === undefined ? [[a, c]] : [
    [a, gapAt - gapW / 2],
    [gapAt + gapW / 2, c],
  ];
  const barrier = pickModel(modelLibrary(), 'wallBarrier', 0);
  if (!barrier) return;
  for (const [s0, s1] of spans) {
    const spanLen = s1 - s0;
    if (spanLen < 0.2) continue;
    const count = Math.max(1, Math.round(spanLen / barrier.size[0]));
    const segLen = spanLen / count;
    const sx = (segLen / barrier.size[0]) * 1.045;
    const sy = Math.min(1.65, h / barrier.size[1]);
    const sz = 1.0;
    const halfT = (barrier.size[2] * sz) / 2;
    const topY = barrier.size[1] * sy;
    _q.setFromAxisAngle(_axis.set(0, 1, 0), alongX ? 0 : Math.PI / 2);
    _s.set(sx, sy, sz);
    for (let i = 0; i < count; i++) {
      const u = s0 + (i + 0.5) * segLen;
      _p.set(alongX ? u : fixed, 0, alongX ? fixed : u);
      placeModel(b.batch, barrier, _m.compose(_p, _q, _s), null);
    }
    if (alongX) b.solid(s0, fixed - halfT, s1, fixed + halfT, 0, topY);
    else b.solid(fixed - halfT, s0, fixed + halfT, s1, 0, topY);
  }
}

/**
 * Zig-zag fire escape on a facade: a landing per storey from the first floor up, railings, flights
 * between the landings, the bottom ladder pulled up out of reach. Purely visual (all above 2 m).
 * `axis` is the wall's normal axis; `outward` its sign; `u0` the start along the wall.
 */
interface EscapeSpec {
  axis: 'x' | 'z';
  wall: number;
  outward: 1 | -1;
  u0: number;
  storeys: number;
}

/** Gap between a fire escape and its wall. */
const ESCAPE_GAP = 0.02;

/**
 * A fire escape only outside: its whole box (landings, flights, ladder) must not enter any building of the
 * block (footprints, i.e. the rooms and stairwells inside), touching the wall it hangs on excepted.
 */
function escapeClear(e: EscapeSpec, buildings: readonly BuildingDesc[]): boolean {
  const v0 = e.outward > 0 ? e.wall + 0.02 : e.wall - ESCAPE_GAP - 1.2 - 0.05;
  const v1 = e.outward > 0 ? e.wall + ESCAPE_GAP + 1.2 + 0.05 : e.wall - 0.02;
  const [minX, maxX, minZ, maxZ] = e.axis === 'z' ? [e.u0 - 0.05, e.u0 + 3.05, v0, v1] : [v0, v1, e.u0 - 0.05, e.u0 + 3.05];
  return buildings.every((d) => maxX <= d.cx - d.w / 2 || minX >= d.cx + d.w / 2 || maxZ <= d.cz - d.d / 2 || minZ >= d.cz + d.d / 2);
}

export function fireEscape(b: Builder, axis: 'x' | 'z', wall: number, outward: 1 | -1, u0: number, storeys: number): void {
  const D = 1.25;
  const wx = axis === 'z' ? u0 + 1.5 : wall + outward * (ESCAPE_GAP + D * 0.5);
  const wz = axis === 'z' ? wall + outward * (ESCAPE_GAP + D * 0.5) : u0 + 1.5;
  // Local +Z of fire_escape_smart_top.glb holds its wall brackets; orient +Z flush against the wall.
  const yaw = axis === 'z' ? (outward > 0 ? Math.PI : 0) : outward > 0 ? -Math.PI / 2 : Math.PI / 2;
  for (let k = 1; k <= storeys; k++) {
    const y = k * FLOOR_H - 0.05;
    b.glb('fire_escape_smart_top', wx, y, wz, yaw, {
      sx: 3.0 / 3.179,
      sy: 1,
      sz: D / 1.509,
    });
  }
}
