import { CylinderGeometry, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { Surface } from '../../render/look/surfaces';
import { type Builder, PAL, pick, type Rand } from './pieces';

/**
 * Downtown high-rises (5–25 storeys), authored in a local frame with the entrance on the −Z side
 * and the stair core in the back-left corner; buildings facing +Z are rotated 180° about their center.
 *
 * Two halves:
 * - the shell (facades, roof, head-house, storefront, rooftop clutter) is part of the chunk, always;
 * - the interior (slabs, stair core, corridors, units, doors, furniture, containers) is streamed in by
 *   the worker only when the player approaches, and dropped when they leave.
 * The walkable surface (floors, flights, landings, roof) is analytic, so the player can stand on it
 * whether or not the interior meshes have arrived yet.
 */

export const FLOOR_H = 3.2;
const WALL = 0.3;
const CORE_W = 3.2;
const CORE_D = 5.4;
/** Floor-level landing at the corridor side of the core. */
const NEAR = 1.1;
/** Horizontal run of one flight (10 steps × 0.3 m), rising half a storey. */
const RUN = 3.0;
const FLIGHT_W = 1.4;
const STEPS = 10;
const CORRIDOR = 1.8;
const DOOR_W = 1.0;
const ENTRANCE_W = 2.2;
const ENTRANCE_H = 2.6;

export type FacadeSurface = 'facadeConcrete' | 'facadeBrick' | 'facadeOffice';

export interface BuildingDesc {
  /** Unique world-wide (chunk key × 16 + n). */
  id: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  floors: number;
  facade: FacadeSurface;
  /** true → entrance faces +Z (rotated 180°). */
  flip: boolean;
  kind: 'apartments' | 'offices';
  seed: number;
}

interface Local {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  ix0: number;
  iz0: number;
  ix1: number;
  iz1: number;
  /** Stair core. */
  cx0: number;
  cz0: number;
  cx1: number;
  cz1: number;
  /** Corridor z-range (front edge, back edge = core near side). */
  czA: number;
  doorX: number;
}

function local(b: BuildingDesc): Local {
  const x0 = b.cx - b.w / 2;
  const z0 = b.cz - b.d / 2;
  const x1 = x0 + b.w;
  const z1 = z0 + b.d;
  const ix0 = x0 + WALL;
  const iz0 = z0 + WALL;
  const ix1 = x1 - WALL;
  const iz1 = z1 - WALL;
  const cz0 = iz1 - CORE_D;
  return { x0, z0, x1, z1, ix0, iz0, ix1, iz1, cx0: ix0, cz0, cx1: ix0 + CORE_W, cz1: iz1, czA: cz0 - CORRIDOR, doorX: b.cx + b.w * 0.15 };
}

/** World → building-local (undo the 180° rotation). */
function toLocal(b: BuildingDesc, x: number, z: number): [number, number] {
  return b.flip ? [2 * b.cx - x, 2 * b.cz - z] : [x, z];
}

export function insideFootprint(b: BuildingDesc, x: number, z: number, margin = 0): boolean {
  return Math.abs(x - b.cx) <= b.w / 2 + margin && Math.abs(z - b.cz) <= b.d / 2 + margin;
}

/**
 * Height of the surface the player stands on: the highest floor, landing or flight point that is
 * at most a step above their feet. Storeys are FLOOR_H apart; the roof is level `floors`.
 */
export function highriseSurfaceY(b: BuildingDesc, wx: number, wz: number, y: number): number {
  const [x, z] = toLocal(b, wx, wz);
  const L = local(b);
  const reach = y + 0.55;
  const kc = Math.max(0, Math.min(b.floors, Math.round(y / FLOOR_H)));
  let best = -Infinity;
  let lowest = Infinity;
  const consider = (h: number) => {
    lowest = Math.min(lowest, h);
    if (h <= reach && h > best) best = h;
  };
  const inCore = x >= L.cx0 && x <= L.cx1 && z >= L.cz0 && z <= L.cz1;
  for (let k = Math.max(0, kc - 1); k <= Math.min(b.floors, kc + 1); k++) {
    const yk = k * FLOOR_H;
    if (!inCore) {
      consider(yk);
      continue;
    }
    const zf0 = L.cz0 + NEAR;
    if (z < zf0) {
      consider(yk);
      continue;
    }
    if (k >= b.floors) continue; // no flights above the roof
    if (z >= zf0 + RUN) {
      consider(yk + FLOOR_H / 2);
    } else if (x < L.cx0 + FLIGHT_W) {
      consider(yk + ((z - zf0) / RUN) * (FLOOR_H / 2));
    } else if (x > L.cx1 - FLIGHT_W) {
      consider(yk + FLOOR_H / 2 + ((zf0 + RUN - z) / RUN) * (FLOOR_H / 2));
    }
  }
  return best > -Infinity ? best : lowest === Infinity ? 0 : lowest;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

/** Decal quad lying on the ground (or a slab), random rotation. */
export function groundDecal(b: Builder, surface: Surface, x: number, y: number, z: number, size: number, rand: Rand, stretch = 1): void {
  const g = new PlaneGeometry(size * stretch, size);
  g.rotateX(-Math.PI / 2);
  g.rotateY(rand() * Math.PI * 2);
  b.geo(g, 0xffffff, _m.compose(_p.set(x, y + 0.03, z), _q.identity(), _s.set(1, 1, 1)), surface);
  g.dispose();
}

/** Decal on a wall facing −Z (in the current frame), e.g. bullet holes, blood. */
export function wallDecalZ(b: Builder, surface: Surface, x: number, y: number, z: number, size: number, facing: 1 | -1): void {
  const g = new PlaneGeometry(size, size);
  if (facing < 0) g.rotateY(Math.PI);
  b.geo(g, 0xffffff, _m.compose(_p.set(x, y, z + facing * 0.02), _q.identity(), _s.set(1, 1, 1)), surface);
  g.dispose();
}

/** Shell: facades, roof with parapet and stair head-house, storefront at street level, rooftop clutter. */
export function buildHighriseShell(b: Builder, desc: BuildingDesc, rand: Rand): void {
  if (desc.flip) b.beginFlip(desc.cx, desc.cz);
  const L = local(desc);
  const H = desc.floors * FLOOR_H;
  const top = H + 1.1; // parapet
  const f = desc.facade;
  const tint = pick(rand, [0xd0ccc4, 0xc4c0b6, 0xbab4aa, 0xd4d0ca]);

  // Facades. Entrance wall split around the doorway; the lintel above blocks only above head height.
  const d0 = L.doorX - ENTRANCE_W / 2;
  const d1 = L.doorX + ENTRANCE_W / 2;
  b.block(tint, L.x0, 0, L.z0, d0 - L.x0, top, WALL, f, true);
  b.block(tint, d1, 0, L.z0, L.x1 - d1, top, WALL, f, true);
  b.blockY(tint, d0, ENTRANCE_H, L.z0, ENTRANCE_W, top - ENTRANCE_H, WALL, f);
  b.block(tint, L.x0, 0, L.z1 - WALL, L.x1 - L.x0, top, WALL, f, true);
  b.block(tint, L.x0, 0, L.z0 + WALL, WALL, top, L.z1 - L.z0 - 2 * WALL, f, true);
  b.block(tint, L.x1 - WALL, 0, L.z0 + WALL, WALL, top, L.z1 - L.z0 - 2 * WALL, f, true);

  // Roof slab with the stair opening, and the head-house over the core.
  const roofY = H - 0.2;
  b.block(0x6a6862, L.ix0, roofY, L.iz0, L.ix1 - L.ix0, 0.2, L.cz0 + NEAR - L.iz0, 'concrete');
  b.block(0x6a6862, L.cx1, roofY, L.cz0 + NEAR, L.ix1 - L.cx1, 0.2, L.iz1 - L.cz0 - NEAR, 'concrete');
  const hh = 2.6;
  b.blockY(0x77756e, L.cx1, H, L.cz0, 0.15, hh, L.cz1 - L.cz0, 'concrete');
  b.blockY(0x77756e, L.cx0, H, L.cz0 - 0.15, 0.6, hh, 0.15, 'concrete');
  b.blockY(0x77756e, L.cx0 + 1.6, H, L.cz0 - 0.15, L.cx1 - L.cx0 - 1.45, hh, 0.15, 'concrete');
  // The facades stop at the parapet; close the head-house on the outer sides up to its roof.
  b.blockY(0x77756e, L.x0, top, L.cz0, WALL, H + hh - top, L.z1 - L.cz0, 'concrete');
  b.blockY(0x77756e, L.x0, top, L.z1 - WALL, L.cx1 - L.x0 + 0.15, H + hh - top, WALL, 'concrete');
  b.block(0x5a5852, L.cx0 - 0.1, H + hh, L.cz0 - 0.2, L.cx1 - L.cx0 + 0.35, 0.15, L.cz1 - L.cz0 + 0.25, 'concrete');
  // Rooftop clutter: AC units, a water tank.
  for (let n = 0; n < 3; n++) {
    const ax = L.cx1 + 2 + rand() * Math.max(1, L.ix1 - L.cx1 - 5);
    const az = L.iz0 + 1 + rand() * Math.max(1, L.cz0 - L.iz0 - 4);
    b.block(0x6a6e70, ax, H, az, 1.4, 1.0, 1.0, 'metal');
    b.solid(ax, az, ax + 1.4, az + 1.0, H, H + 1.0);
  }
  if (rand() < 0.6) {
    const tank = new CylinderGeometry(1.1, 1.1, 2.2, 10);
    const tx = L.x0 + desc.w * 0.7;
    const tz = L.z0 + desc.d * 0.3;
    b.geo(tank, 0x5a4a3a, _m.compose(_p.set(tx, H + 1.1, tz), _q.identity(), _s.set(1, 1, 1)), 'metal');
    b.solid(tx - 1.1, tz - 1.1, tx + 1.1, tz + 1.1, H, H + 2.2);
    tank.dispose();
  }

  // Street level: storefront glass in front of the ground-floor facade, entrance frame and canopy.
  for (const [a, c] of [
    [L.x0 + 0.6, d0 - 0.4],
    [d1 + 0.4, L.x1 - 0.6],
  ] as const) {
    for (let x = a; x < c - 1; x += 3) {
      const pw = Math.min(2.8, c - x);
      const broken = rand() < 0.45;
      b.block(PAL.trim, x - 0.08, 0.35, L.z0 - 0.06, pw + 0.16, 2.55, 0.06, 'metal');
      if (broken) {
        b.block(0x050505, x, 0.45, L.z0 - 0.07, pw, 2.35, 0.03, 'glass');
        shardTeeth(b, x, 0.45, L.z0 - 0.09, pw, 2.35, rand);
        groundDecal(b, 'decalShards', x + pw / 2, 0, L.z0 - 1.0, 1.8, rand, 1.4);
      } else {
        b.block(PAL.window, x, 0.45, L.z0 - 0.08, pw, 2.35, 0.03, 'glass');
      }
    }
  }
  b.block(PAL.trim, d0 - 0.12, 0, L.z0 - 0.08, 0.12, ENTRANCE_H + 0.12, 0.08, 'metal');
  b.block(PAL.trim, d1, 0, L.z0 - 0.08, 0.12, ENTRANCE_H + 0.12, 0.08, 'metal');
  b.block(0x2a2c2e, d0 - 0.8, ENTRANCE_H + 0.3, L.z0 - 1.4, ENTRANCE_W + 1.6, 0.12, 1.4, 'metal');
  b.block(0x1c1e20, L.x0 + 1, 3.0, L.z0 - 0.1, desc.w - 2, 0.6, 0.08, 'metal');
  if (rand() < 0.5) wallDecalZ(b, 'decalBullets', L.x0 + 2 + rand() * (desc.w - 4), 1.2 + rand() * 1.4, L.z0, 1.4, -1);
  if (rand() < 0.35) groundDecal(b, 'decalBlood', L.doorX + (rand() - 0.5) * 3, 0, L.z0 - 1.5 - rand() * 2, 1.6, rand);
  b.endFrame();
}

/** Jagged teeth of glass left in a smashed frame (front face at z). */
function shardTeeth(b: Builder, x: number, y: number, z: number, w: number, h: number, rand: Rand): void {
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const tw = 0.15 + rand() * 0.35;
    const th = 0.2 + rand() * 0.6;
    const tx = x + rand() * (w - tw);
    const fromTop = rand() < 0.5;
    b.block(0x5a6a72, tx, fromTop ? y + h - th : y, z, tw, th, 0.02, 'glass');
  }
}

/**
 * Interior of every storey: slab with the stair opening, the switchback stair core, a corridor,
 * apartments or offices with doors, furniture and containers; a lobby with a security desk at
 * street level. Colliders are limited to their storey so each floor has its own layout.
 */
export function buildHighriseInterior(b: Builder, desc: BuildingDesc, rand: Rand): void {
  if (desc.flip) b.beginFlip(desc.cx, desc.cz);
  const L = local(desc);
  const paperA = pick(rand, PAL.wallpapers);
  const paperB = pick(rand, PAL.wallpapers);
  const office = desc.kind === 'offices';
  const rise = FLOOR_H / 2 / STEPS;
  const step = RUN / STEPS;

  for (let k = 0; k < desc.floors; k++) {
    const y = k * FLOOR_H;
    const h = FLOOR_H - 0.2;
    // Slab (top at y) around the stair opening; the near landing is part of it.
    const slabT = k === 0 ? 0.05 : 0.2;
    const sy = k === 0 ? 0 : y - 0.2;
    const floorS: Surface = k === 0 ? 'tile' : office ? 'tile' : 'wood';
    const floorC = k === 0 ? 0x8a867c : office ? 0x7a7a74 : PAL.floor;
    b.block(floorC, L.ix0, sy, L.iz0, L.ix1 - L.ix0, slabT, L.cz0 + NEAR - L.iz0, floorS);
    b.block(floorC, L.cx1, sy, L.cz0 + NEAR, L.ix1 - L.cx1, slabT, L.iz1 - L.cz0 - NEAR, floorS);

    // Stair core: flight A up the left side, landing at the back, flight B back down to the next floor.
    const zf0 = L.cz0 + NEAR;
    for (let i = 0; i < STEPS; i++) {
      b.block(0x6a6862, L.cx0, y + i * rise, zf0 + i * step, FLIGHT_W, rise, step, 'concrete');
      b.block(0x6a6862, L.cx1 - FLIGHT_W, y + FLOOR_H / 2 + i * rise, zf0 + RUN - (i + 1) * step, FLIGHT_W, rise, step, 'concrete');
    }
    b.block(0x6a6862, L.cx0, y + FLOOR_H / 2 - 0.2, zf0 + RUN, CORE_W, 0.2, L.cz1 - zf0 - RUN, 'concrete');
    // Well divider / railing between the flights (blocks crossing), core side wall towards the units.
    b.blockY(0x3a3c3e, L.cx0 + FLIGHT_W, y, zf0, CORE_W - 2 * FLIGHT_W, FLOOR_H, RUN, 'metal');
    // Full-depth side wall: the landing opens only onto the corridor, never straight into a unit.
    b.blockY(paperA, L.cx1, y, L.cz0, 0.15, h, L.cz1 - L.cz0, 'plaster');
    // Painted storey number by the landing.
    b.block(0xb0aa98, L.cx1 + 0.16, y + 1.4, L.cz0 + NEAR + 0.2, 0.02, 0.4, 0.3, 'plaster');

    if (k === 0) {
      lobby(b, L, desc, rand);
    } else {
      corridorStorey(b, L, desc, y, h, paperA, paperB, office, rand);
    }
  }
  b.endFrame();
}

function lobby(b: Builder, L: Local, desc: BuildingDesc, rand: Rand): void {
  // Security desk, mailboxes, dead elevator doors, an overturned bench, blood on the floor.
  const dx = L.doorX + 2.5;
  b.block(PAL.counter, dx, 0, L.iz0 + 3, 2.4, 1.05, 0.7, 'wood', true);
  b.container('reception', dx + 1.2, L.iz0 + 2.7);
  b.block(0x5a5e60, L.ix1 - 0.3, 0.9, L.iz0 + 1.5, 0.25, 1.4, 3.2, 'metal');
  b.block(0x6a6e70, L.cx1 + 0.4, 0, L.cz0 - 0.1, 2.2, 2.4, 0.1, 'metal');
  b.block(0x1a1c1e, L.cx1 + 1.45, 0, L.cz0 - 0.12, 0.1, 2.4, 0.02, 'metal');
  b.block(0x4a3b38, L.ix0 + 1.5, 0, L.iz0 + 4.5, 0.6, 0.45, 2.2, 'rubber', true);
  if (rand() < 0.7) groundDecal(b, 'decalBlood', L.doorX + (rand() - 0.5) * 4, 0.05, L.iz0 + 2 + rand() * 4, 2.2, rand, 1.3);
  groundDecal(b, 'decalLitter', L.doorX - 2 + rand() * 4, 0.05, L.iz0 + 1.5 + rand() * 5, 2.0, rand);
  // Back units at street level: storage rooms off the corridor line.
  backUnits(b, L, desc, 0, FLOOR_H - 0.2, PAL.wallpapers[0], false, rand);
}

function corridorStorey(b: Builder, L: Local, desc: BuildingDesc, y: number, h: number, paperA: number, paperB: number, office: boolean, rand: Rand): void {
  // Front units between the facade and the corridor.
  const width = L.ix1 - L.ix0;
  const n = Math.max(2, Math.floor(width / 6.5));
  const uw = width / n;
  for (let u = 0; u < n; u++) {
    const ux0 = L.ix0 + u * uw;
    const ux1 = ux0 + uw;
    if (u > 0) b.blockY(paperA, ux0 - 0.06, y, L.iz0, 0.12, h, L.czA - L.iz0, 'plaster');
    // Corridor wall with this unit's doorway.
    const gx = ux0 + uw / 2 - DOOR_W / 2;
    b.blockY(paperB, ux0, y, L.czA - 0.12, gx - ux0, h, 0.12, 'plaster');
    b.blockY(paperB, gx + DOOR_W, y, L.czA - 0.12, ux1 - gx - DOOR_W, h, 0.12, 'plaster');
    b.block(paperB, gx, y + 2.1, L.czA - 0.12, DOOR_W, h - 2.1, 0.12, 'plaster');
    const barricaded = rand() < 0.12;
    b.door(gx, L.czA - 0.06, y, 0, 1, barricaded);
    if (barricaded) {
      for (let p = 0; p < 3; p++) b.block(0x6a5a42, gx - 0.15, y + 0.5 + p * 0.6, L.czA + 0.02, DOOR_W + 0.3, 0.14, 0.04, 'wood');
    }
    furnishUnit(b, ux0 + 0.1, L.iz0, ux1 - 0.1, L.czA - 0.12, y, office, true, rand);
  }
  backUnits(b, L, desc, y, h, paperB, office, rand);
  // Corridor clutter and storytelling.
  if (rand() < 0.35) groundDecal(b, 'decalBlood', L.ix0 + 2 + rand() * (width - 4), y, L.czA + CORRIDOR / 2, 1.5, rand, 1.8);
  if (rand() < 0.5) groundDecal(b, 'decalLitter', L.ix0 + 2 + rand() * (width - 4), y, L.czA + CORRIDOR / 2, 1.6, rand);
  if (rand() < 0.2) wallDecalZ(b, 'decalBullets', L.ix0 + 2 + rand() * (width - 4), y + 1.3, L.czA, 1.2, 1);
}

function backUnits(b: Builder, L: Local, desc: BuildingDesc, y: number, h: number, paper: number, office: boolean, rand: Rand): void {
  const x0 = L.cx1 + 0.15;
  const width = L.ix1 - x0;
  if (width < 4) return;
  const n = Math.max(1, Math.floor(width / 6.5));
  const uw = width / n;
  for (let u = 0; u < n; u++) {
    const ux0 = x0 + u * uw;
    const ux1 = ux0 + uw;
    if (u > 0) b.blockY(paper, ux0 - 0.06, y, L.cz0, 0.12, h, L.iz1 - L.cz0, 'plaster');
    const gx = ux0 + uw / 2 - DOOR_W / 2;
    b.blockY(paper, ux0, y, L.cz0, gx - ux0, h, 0.12, 'plaster');
    b.blockY(paper, gx + DOOR_W, y, L.cz0, ux1 - gx - DOOR_W, h, 0.12, 'plaster');
    b.block(paper, gx, y + 2.1, L.cz0, DOOR_W, h - 2.1, 0.12, 'plaster');
    b.door(gx, L.cz0 + 0.06, y, 0, -1, rand() < 0.08);
    furnishUnit(b, ux0 + 0.1, L.cz0 + 0.12, ux1 - 0.1, L.iz1, y, office || desc.kind === 'offices', false, rand);
  }
}

/** Furniture and containers of one apartment or office. `front`: the unit's door is on its +Z side. */
function furnishUnit(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, office: boolean, front: boolean, rand: Rand): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const doorSideZ = front ? z1 : z0;
  const farZ = front ? z0 : z1;
  const inward = front ? 1 : -1; // from the far wall towards the door
  const farEdge = front ? farZ + 0.1 : farZ - 0.1;
  if (rand() < 0.15) {
    // Ransacked and empty, a stain on the floor.
    groundDecal(b, 'decalBlood', x0 + w / 2, y, (z0 + z1) / 2, 1.8, rand, 1.2);
    return;
  }
  if (office) {
    for (let n = 0; n < 2; n++) {
      const dx = x0 + 0.6 + n * (w / 2);
      const dz = farEdge + inward * (1.0 + rand() * 0.6) - (front ? 0 : 0.8);
      b.blockY(PAL.counter, dx, y, dz, 1.4, 0.75, 0.8, 'wood');
      b.block(0x1a1a1a, dx + 0.4, y + 0.75, dz + 0.2, 0.5, 0.35, 0.05, 'metal');
      b.container('desk', dx + 0.7, dz + (front ? 0.95 : -0.15), y);
    }
    const cx = x1 - 0.7;
    b.blockY(0x5a5e60, cx, y, front ? farEdge : farEdge - 0.5, 0.6, 1.3, 0.5, 'metal');
    b.container('cabinet', cx + 0.3, front ? farEdge + 0.75 : farEdge - 0.75, y);
    if (rand() < 0.4) groundDecal(b, 'decalLitter', x0 + w / 2, y, (z0 + z1) / 2, 2, rand);
    return;
  }
  // Apartment: bed by the far wall, wardrobe, kitchen corner by the door side.
  const bedZ = front ? farEdge : farEdge - 2.0;
  b.blockY(PAL.counter, x0 + 0.2, y, bedZ, 1.5, 0.45, 2.0, 'wood');
  b.block(pick(rand, PAL.fabric), x0 + 0.25, y + 0.45, bedZ + 0.05, 1.4, 0.15, 1.9, 'rubber');
  const wz = front ? farEdge : farEdge - 0.6;
  b.blockY(PAL.counter, x1 - 1.3, y, wz, 1.2, 2.0, 0.6, 'wood');
  b.container('wardrobe', x1 - 0.7, wz + (front ? 0.75 : -0.15), y);
  const kz = front ? doorSideZ - 0.75 : doorSideZ + 0.15;
  if (w > 4.5) {
    b.blockY(PAL.counter, x0 + 0.2, y, kz, 1.8, 0.88, 0.6, 'wood');
    b.container('counter', x0 + 1.1, kz + (front ? -0.15 : 0.75), y);
    b.blockY(PAL.appliance, x0 + 2.1, y, kz, 0.7, 1.8, 0.65, 'metal');
    b.container('fridge', x0 + 2.45, kz + (front ? -0.15 : 0.8), y);
  }
  if (rand() < 0.3) groundDecal(b, 'decalBlood', x0 + w * (0.3 + rand() * 0.4), y, z0 + d * (0.3 + rand() * 0.4), 1.3, rand);
}
