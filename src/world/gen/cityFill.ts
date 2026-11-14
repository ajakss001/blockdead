import { Matrix4, Quaternion, Vector3 } from 'three';
import { pickModel } from '../models';
import { buildCar, CAR_PAINTS, modelLibrary, placeModel } from '../props/car';
import { Place } from './furniture';
import { type BuildingDesc, buildHighriseShell, FLOOR_H, type FacadeSurface, groundDecal } from './highrise';
import { DOWNTOWN_RADIUS, PAVE } from './layout';
import { LIFE, spotHash } from './lifeKinds';
import { type Builder, PAL, pick, type Rand } from './pieces';

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
const SHEET = 0x5a5c58;
const BRICK = 0x6a4e40;
const DUMPSTER = 0x3a4a3a;
const ESCAPE = 0x2c2a28;

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
  const out: BuildingDesc[] = [];
  const chunkKey = (i + 32768) * 65536 + (j + 32768);
  const centrality = 1 - Math.max(Math.abs(i), Math.abs(j)) / (DOWNTOWN_RADIUS + 1);
  const parkingLot = !(i === 0 && j === 0) && rand() < 0.25 ? Math.floor(rand() * 4) : -1;
  const rows: Row[] = [];
  let n = 0;
  // Fire escapes are placed last, only where they clear every building volume of the block.
  const escapes: EscapeSpec[] = [];

  for (const south of [true, false]) {
    const d = pick(rand, [18, 21, 24]);
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
      const floors = Math.max(5, Math.min(25, 5 + Math.floor(rand() * (6 + 15 * centrality))));
      const facade = pick(rand, FACADES);
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
      };
      buildHighriseShell(b, desc, rand);
      out.push(desc);
    });
    sideAlley(b, xa + wW, xb, row, rand, built[1], escapes);
    eastGap(b, xb + wE, X1, row, rand);
  }
  backCourtyard(b, X0, X1, rows[0].z1, rows[1].z0, rand);
  for (const e of escapes) if (escapeClear(e, out)) fireEscape(b, e.axis, e.wall, e.outward, e.u0, e.storeys);
  return out;
}

/** 3 m slot between two towers: a dumpster, litter, maybe a gate at the street, maybe walled off at the back. */
function sideAlley(b: Builder, xL: number, xR: number, row: Row, rand: Rand, escape: boolean, escapes: EscapeSpec[]): void {
  const streetZ = row.south ? row.z0 : row.z1;
  const courtZ = row.south ? row.z1 : row.z0;
  const inward = row.south ? 1 : -1;
  const mid = (row.z0 + row.z1) / 2;
  // Dumpster against one wall, leaving a 1.8 m way past it.
  const dz = mid + (rand() - 0.5) * 4;
  const wallX = rand() < 0.5 ? xL + 0.05 : xR - 1.15;
  dumpster(b, wallX, dz - 0.9, 'z');
  if (rand() < 0.6) crates(b, rand() < 0.5 ? xL + 0.1 : xR - 1.1, mid + inward * 5, rand);
  groundDecal(b, 'decalLitter', (xL + xR) / 2, PAVE.plaza, mid + (rand() - 0.5) * 6, 1.8, rand);
  if (rand() < 0.4) sheetFence(b, xL, streetZ + inward * 0.3, xR, streetZ + inward * 0.3, rand() < 0.6 ? (xL + xR) / 2 : undefined, 1.2);
  // Dead end: walled off at the courtyard.
  if (rand() < 0.3) brickWall(b, xL, courtZ - inward * 0.3, xR, courtZ - inward * 0.3);
  if (escape && rand() < 0.6) escapes.push({ axis: 'x', wall: xR, outward: -1, u0: row.z0 + 3, storeys: 4 });
}

/** The strip left at the east end of a row: a service gap behind a gate. */
function eastGap(b: Builder, x0: number, x1: number, row: Row, rand: Rand): void {
  if (x1 - x0 < 1.2) return;
  const streetZ = row.south ? row.z0 : row.z1;
  const inward = row.south ? 1 : -1;
  sheetFence(b, x0, streetZ + inward * 0.4, x1, streetZ + inward * 0.4, rand() < 0.5 ? (x0 + x1) / 2 : undefined, 1.0);
  if (x1 - x0 > 2.2) crates(b, x0 + 0.2, (row.z0 + row.z1) / 2, rand);
}

/** The back courtyard between the rows. */
function backCourtyard(b: Builder, X0: number, X1: number, zS: number, zN: number, rand: Rand): void {
  const width = zN - zS;
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
    dumpster(b, x, southWall ? zS + 0.1 : zN - 1.2, 'x');
    b.container('trash', x + 0.9, southWall ? zS + 1.6 : zN - 1.7);
  }
  for (let k = 0; k < 2; k++) crates(b, clear(X0 + 2 + rand() * (X1 - X0 - 6), 0.5), rand() < 0.5 ? zS + 0.2 : zN - 1.2, rand);
  for (let k = 0; k < 4; k++) groundDecal(b, rand() < 0.7 ? 'decalLitter' : 'decalOil', X0 + rand() * (X1 - X0), PAVE.plaza, zMid + (rand() - 0.5) * (width - 2), 2, rand);
  // Wide enough for the residents' cars: parked along the north wall.
  if (width >= 7.5) {
    const lanes = rand() < 0.5 ? 1 : 0;
    for (let k = 0; k < lanes; k++) {
      // One car per half, never across the dividing fence.
      const lo = k === 0 ? X0 + 3.5 : split + 3.2;
      const hi = k === 0 ? split - 3.2 : X1 - 3.5;
      if (hi - lo < 0.5) continue;
      parkedCar(b, lo + rand() * (hi - lo), zN - 1.25, rand() < 0.5 ? 0 : Math.PI, rand);
    }
  }
}

/** Parked, not crashed: straight, rarely smashed. */
function parkedCar(b: Builder, x: number, z: number, yaw: number, rand: Rand): void {
  b.life(LIFE.car, x, 0, z, Math.sin(yaw), Math.cos(yaw), 4.3, 1.8, spotHash(x, z, 41));
  buildCar(
    b.batch,
    b.colliders,
    { x, z, yaw: yaw + (rand() - 0.5) * 0.06, paint: pick(rand, paints), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.2, smashed: rand() < 0.15 ? 0.3 : 0 },
    b.containers,
  );
}

/**
 * Parallel parking along a curb: slots every 6.5 m between `from` and `to`, about one in five taken.
 * `alongX`: the road runs along X; `curb` is the curb lane's fixed coordinate; side ±1 picks the heading;
 * no car within 7 m of `keepClear` (along the road).
 */
export function curbParking(b: Builder, alongX: boolean, curb: number, side: number, from: number, to: number, rand: Rand, keepClear?: number): void {
  for (let t = from + 3.2; t < to - 3.2; t += 6.5) {
    if (rand() > 0.2) continue;
    // Something else already happened here (a car wrapped round the lamp post).
    if (keepClear !== undefined && Math.abs(t - keepClear) < 7) continue;
    const yaw = alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
    parkedCar(b, alongX ? t : curb, alongX ? curb : t, yaw, rand);
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
      b.block(0xa8a490, x - 0.05, 0, rowZ, 0.1, PAVE.plaza + 0.02, STALL_D, 'asphalt');
      if (rand() < 0.35) parkedCar(b, x + STALL_W / 2, rowZ + STALL_D / 2, nose < 0 ? Math.PI / 2 : -Math.PI / 2, rand);
    }
  }
  // Pay booth by the entrance (street side).
  const bz = south ? z0 + STALL_D + 1.2 : z1 - STALL_D - 2.6;
  const booth = new Place(b, x0 + 1.3, 0, bz + 0.7, south ? 0 : 2);
  if (booth.model('guardBooth', rand, 0, 0, 0, 0, 0.72, 0.72, 0.25)) {
    b.solid(x0 + 0.4, bz - 0.1, x0 + 2.2, bz + 1.6, 0, 2.3);
  } else {
    b.block(0x6a6e66, x0 + 0.6, 0, bz, 1.4, 2.3, 1.4, 'metal', true);
    b.block(PAL.window, x0 + 0.55, 1.1, bz + 0.3, 1.5, 0.8, 0.8, 'glass');
  }
}

/** Wheeled steel dumpster; `along` is the long axis. */
function dumpster(b: Builder, x: number, z: number, along: 'x' | 'z'): void {
  const sx = along === 'x' ? 1.8 : 1.1;
  const sz = along === 'x' ? 1.1 : 1.8;
  const dp = new Place(b, x + sx / 2, 0, z + sz / 2, along === 'x' ? 0 : 1);
  if (dp.model('dumpster', 0, 0, 0, 0, 0, 1, 0.72, 0.35)) {
    b.solid(x, z, x + sx, z + sz, 0.12, 1.3);
  } else {
    b.block(DUMPSTER, x, 0.12, z, sx, 1.18, sz, 'metal', true);
    b.block(0x2a3a2a, x - 0.04, 1.3, z - 0.04, sx + 0.08, 0.06, sz + 0.08, 'metal');
  }
  b.batch.addShadow(_m.makeTranslation(x + sx / 2, PAVE.plaza, z + sz / 2), sx * 1.25, sz * 1.25, 0.025);
}

/** A pallet with a stack of crates on it (sometimes searchable). */
function crates(b: Builder, x: number, z: number, rand: Rand): void {
  const cp = new Place(b, x + 0.5, 0, z + 0.5, Math.floor(rand() * 4) as 0 | 1 | 2 | 3);
  if (cp.model(rand() < 0.5 ? 'palletCrates' : 'woodenCrate', rand, 0, 0, 0, 0, 1, 0.82, 0.08)) {
    b.solid(x, z, x + 1.0, z + 1.0, 0, 0.9);
  } else {
    b.block(0x6a5a40, x, 0, z, 1.0, 0.14, 1.0, 'wood', true);
    const h = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < h; k++) b.block(PAL.crate, x + 0.08 + (rand() - 0.5) * 0.1, 0.14 + k * 0.62, z + 0.08, 0.84, 0.6, 0.84, 'wood');
  }
  b.batch.addShadow(_m.makeTranslation(x + 0.5, PAVE.plaza, z + 0.5), 1.35, 1.35, 0.025);
  if (rand() < 0.35) b.container('crate', x + 0.5, z + 0.5);
}

/** Corrugated sheet fence, 2.2 m, along X or Z, with an optional gap. */
function sheetFence(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt?: number, gapW = 1.2): void {
  wallLine(b, ax, az, bx, bz, gapAt, gapW, 2.2, 0.05, SHEET, 'metal', 2.4);
}

/** Brick wall, 2.4 m, with an optional gate gap. */
function brickWall(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt?: number, gapW = 1.4): void {
  wallLine(b, ax, az, bx, bz, gapAt, gapW, 2.4, 0.25, BRICK, 'concrete', 0);
}

function wallLine(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt: number | undefined, gapW: number, h: number, thick: number, color: number, surface: 'metal' | 'concrete', ribEvery: number): void {
  const alongX = Math.abs(bz - az) < 1e-6;
  const a = alongX ? Math.min(ax, bx) : Math.min(az, bz);
  const c = alongX ? Math.max(ax, bx) : Math.max(az, bz);
  const fixed = alongX ? az : ax;
  const spans: [number, number][] = gapAt === undefined ? [[a, c]] : [
    [a, gapAt - gapW / 2],
    [gapAt + gapW / 2, c],
  ];
  const barrier = pickModel(modelLibrary(), 'wallBarrier', 0);
  for (const [s0, s1] of spans) {
    const spanLen = s1 - s0;
    if (spanLen < 0.2) continue;
    if (barrier) {
      const count = Math.max(1, Math.round(spanLen / barrier.size[0]));
      const segLen = spanLen / count;
      const sx = segLen / barrier.size[0];
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
      continue;
    }
    if (alongX) b.block(color, s0, 0, fixed - thick / 2, spanLen, h, thick, surface, true);
    else b.block(color, fixed - thick / 2, 0, s0, thick, h, spanLen, surface, true);
    // Posts / ribs every few meters break up the flat sheet.
    if (ribEvery > 0) {
      for (let t = s0; t <= s1; t += ribEvery) {
        if (alongX) b.block(0x3a3c3a, t - 0.04, 0, fixed - 0.06, 0.08, h + 0.05, 0.12, 'metal');
        else b.block(0x3a3c3a, fixed - 0.06, 0, t - 0.04, 0.12, h + 0.05, 0.08, 'metal');
      }
    }
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
const ESCAPE_GAP = 0.12;

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
  const L = 3;
  const D = 1.2;
  const box = (u: number, v: number, y: number, du: number, dv: number, dy: number) => {
    // (u along the wall, v away from it) → world, min corner and size.
    const v0 = outward > 0 ? wall + ESCAPE_GAP + v : wall - ESCAPE_GAP - v - dv;
    if (axis === 'z') b.block(ESCAPE, u, y, v0, du, dy, dv, 'metal');
    else b.block(ESCAPE, v0, y, u, dv, dy, du, 'metal');
  };
  for (let k = 1; k <= storeys; k++) {
    const y = k * FLOOR_H - 0.05;
    box(u0, 0, y, L, D, 0.06);
    // Railing: a solid-looking guard on the open edge (top rail + a slatted panel read as one), rails at the ends.
    box(u0, D - 0.04, y + 0.3, L, 0.04, 0.74);
    box(u0, 0, y + 1.0, 0.04, D, 0.04);
    box(u0 + L - 0.04, 0, y + 1.0, 0.04, D, 0.04);
    if (k < storeys) flight(b, axis, wall, outward, k % 2 ? u0 + 0.3 : u0 + L - 0.3, k % 2 ? 1 : -1, y + 0.06, D * 0.5);
  }
  // Raised ladder under the first landing.
  box(u0 + 0.3, D - 0.25, FLOOR_H - 1.6, 0.5, 0.04, 1.55);
}

/** One sloping flight between landings: a plank rising half a landing's length per storey. */
function flight(b: Builder, axis: 'x' | 'z', wall: number, outward: number, uStart: number, dir: number, y: number, v: number): void {
  const run = 2.4;
  const len = Math.hypot(run, FLOOR_H);
  const angle = Math.atan2(FLOOR_H, run) * dir;
  const uc = uStart + (dir * run) / 2;
  const vc = wall + outward * (ESCAPE_GAP + v);
  // Rotate about the wall normal, tilt along u.
  if (axis === 'z') {
    _p.set(uc, y + FLOOR_H / 2, vc);
    _q.setFromAxisAngle(_axis.set(0, 0, 1), angle);
    _s.set(len, 0.06, 0.6);
  } else {
    _p.set(vc, y + FLOOR_H / 2, uc);
    _q.setFromAxisAngle(_axis.set(1, 0, 0), -angle);
    _s.set(0.6, 0.06, len);
  }
  b.batch.add(b.box, ESCAPE, _m.compose(_p, _q, _s), 'metal');
}
