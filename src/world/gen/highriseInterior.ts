import { mulberry32 } from '../../core/random';
import { FACADE_WINDOW } from '../../render/look/surfaces';
import * as F from './furniture';
import { Place, type Quarter, type ShopKind } from './furniture';
import {
  type BuildingDesc,
  CORE_W,
  CORRIDOR,
  DOOR_W,
  ENTRANCE_W,
  FLIGHT_W,
  FLOOR_H,
  groundDecal,
  groundShop,
  type Local,
  type LitUnit,
  litUnits,
  local,
  NEAR,
  RUN,
  STEPS,
  wallDecalZ,
  windowXs,
} from './highrise';
import { hash3 } from './noise';
import { type Builder, PAL, pick, type Rand } from './pieces';

/**
 * Interior of a high-rise, streamed in by the worker when the player comes near: slabs and the
 * switchback stair core on every storey, corridors, apartments or offices with their walls and doors,
 * a lobby, a shop at street level.
 *
 * Only the storeys around `focus` (the player's floor ±1; the street level when outside) get
 * furniture, containers, corridor lamps and radios; the rest are empty shells you can't see into
 * from where you stand. When the player changes floor the interior is rebuilt around the new one.
 * Each storey has its own random streams (structure, furnishing), and its containers their own id
 * range, so a floor looks and loots the same whichever floors happen to be furnished.
 */

type UnitState = 'lived' | 'fled' | 'ransacked' | 'barricaded' | 'burnt';
type UnitMode = 'apartment' | 'office' | 'storage';

function unitState(r: Rand): UnitState {
  const x = r();
  return x < 0.3 ? 'lived' : x < 0.62 ? 'fled' : x < 0.82 ? 'ransacked' : x < 0.9 ? 'barricaded' : 'burnt';
}

export function buildHighriseInterior(b: Builder, desc: BuildingDesc, focus: number, idBase: (floor: number) => number): void {
  if (desc.flip) b.beginFlip(desc.cx, desc.cz);
  const L = local(desc);
  const r0 = mulberry32(hash3(desc.seed, 0, 99));
  const paperA = pick(r0, PAL.wallpapers);
  const paperB = pick(r0, PAL.wallpapers);
  // A generator somewhere in the basement still feeds a few corridor lamps.
  const powered = r0() < 0.3;
  const office = desc.kind === 'offices';
  const wins = windowXs(desc);
  const lit = litUnits(desc);
  const rise = FLOOR_H / 2 / STEPS;
  const step = RUN / STEPS;

  for (let k = 0; k < desc.floors; k++) {
    const rs = mulberry32(hash3(desc.seed, k, 101));
    const rf = Math.abs(k - focus) <= 1 ? mulberry32(hash3(desc.seed, k, 202)) : null;
    b.setIdBase(idBase(k));
    const y = k * FLOOR_H;
    const h = FLOOR_H - 0.2;
    // Slab (top at y) around the stair opening; the near landing is part of it.
    const slabT = k === 0 ? 0.05 : 0.2;
    const sy = k === 0 ? 0 : y - 0.2;
    const floorS = k === 0 || office ? 'tile' : 'wood';
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

    if (k === 0) lobby(b, L, desc, h, rs, rf, paperA, wins);
    else corridorStorey(b, L, y, h, paperA, paperB, office ? 'office' : 'apartment', rs, rf, wins, powered, lit.filter((l) => l.k === k));
  }
  b.setIdBase(null);
  b.endFrame();
}

function lobby(b: Builder, L: Local, desc: BuildingDesc, h: number, rs: Rand, rf: Rand | null, paper: number, wins: number[]): void {
  const shop = groundShop(desc);
  if (shop) {
    // Shop walls: along Z at its edge (a door into the lobby), along X on the corridor line.
    const sx = shop.x1;
    const gz = (L.iz0 + L.czA) / 2 - DOOR_W / 2;
    b.blockY(paper, sx, 0, L.iz0, 0.12, h, gz - L.iz0, 'plaster');
    b.blockY(paper, sx, 0, gz + DOOR_W, 0.12, h, L.czA - gz - DOOR_W, 'plaster');
    b.block(paper, sx, 2.1, gz, 0.12, h - 2.1, DOOR_W, 'plaster');
    b.door(sx + 0.06, gz, 0, -Math.PI / 2, 1, false, { open: rs() < 0.5 });
    b.blockY(paper, L.ix0, 0, L.czA - 0.12, sx - L.ix0 + 0.12, h, 0.12, 'plaster');
    if (rf) shopInterior(b, L.ix0, L.iz0, sx, L.czA - 0.12, shop.kind, rf);
  }
  // Back units at street level: storerooms off the corridor.
  backUnits(b, L, 0, h, PAL.wallpapers[0], 'storage', rs, rf, wins, []);
  if (!rf) return;

  // Concierge desk facing the doors, mailboxes on the side wall, the dead elevator by the stairs.
  F.concierge(new Place(b, Math.min(L.doorX + 3.7, L.ix1 - 1.5), 0, L.iz0 + 3.7, 2), rf);
  F.mailboxes(new Place(b, L.ix1, 0, L.iz0 + 1.8, 3), rf);
  F.elevator(new Place(b, L.cx1 + 1.5, 0, L.cz0, 2), rf);
  F.notes(new Place(b, L.cx1 + 3.1, 0, L.cz0, 2), rf, 3);
  // Potted plants either side of the entrance, a bench along the wall.
  for (const side of [-1, 1]) F.plant(new Place(b, L.doorX + side * (ENTRANCE_W / 2 + 0.5), 0, L.iz0 + 0.45), rf, rf() < 0.3);
  F.bench(new Place(b, shop ? shop.x1 + 0.12 : L.ix0, 0, L.iz0 + 1.6, 1), rf, rf() < 0.3);
  // Residents who never made it out of the lobby with their luggage.
  const bags = Math.floor(rf() * 3);
  for (let n = 0; n < bags; n++) F.suitcase(new Place(b, L.doorX + (rf() - 0.5) * 3, 0, L.iz0 + 4.5 + rf() * 1.5, Math.floor(rf() * 4) as Quarter), rf, rf() < 0.4);
  F.papers(new Place(b, L.doorX, 0, L.iz0), rf, -3, 1, 3, 6, 10);
  if (rf() < 0.7) groundDecal(b, 'decalSoot', L.doorX + (rf() - 0.5) * 4, 0.05, L.iz0 + 2 + rf() * 4, 2.2, rf, 1.3);
  groundDecal(b, 'decalLitter', L.doorX - 2 + rf() * 4, 0.05, L.iz0 + 1.5 + rf() * 5, 2.0, rf);
}

function corridorStorey(b: Builder, L: Local, y: number, h: number, paperA: number, paperB: number, mode: UnitMode, rs: Rand, rf: Rand | null, wins: number[], powered: boolean, lit: LitUnit[]): void {
  // Front units between the facade and the corridor.
  const width = L.ix1 - L.ix0;
  const n = Math.max(2, Math.floor(width / 6.5));
  const uw = width / n;
  for (let u = 0; u < n; u++) {
    const ux0 = L.ix0 + u * uw;
    const ux1 = ux0 + uw;
    if (u > 0) b.blockY(paperA, ux0 - 0.06, y, L.iz0, 0.12, h, L.czA - L.iz0, 'plaster');
    // Someone still lives in a lit unit (the random stream advances either way).
    const light = lit.find((l) => !l.back && l.u === u);
    const st0 = unitState(rs);
    const st = light ? 'lived' : st0;
    // Corridor wall with this unit's doorway.
    const gx = ux0 + uw / 2 - DOOR_W / 2;
    b.blockY(paperB, ux0, y, L.czA - 0.12, gx - ux0, h, 0.12, 'plaster');
    b.blockY(paperB, gx + DOOR_W, y, L.czA - 0.12, ux1 - gx - DOOR_W, h, 0.12, 'plaster');
    b.block(paperB, gx, y + 2.1, L.czA - 0.12, DOOR_W, h - 2.1, 0.12, 'plaster');
    unitDoor(b, gx, L.czA - 0.06, y, 1, L.czA + 0.02, st, rs);
    if (rf) {
      furnishUnit(b, ux0 + 0.1, L.iz0, ux1 - 0.1, L.czA - 0.12, y, h, mode, true, st, rf, wins, paperA, light);
      // Notes left on the door for whoever comes looking.
      if (st === 'fled' && rf() < 0.5) F.notes(new Place(b, gx - 0.5, y, L.czA, 0), rf, 1 + Math.floor(rf() * 2));
    }
  }
  backUnits(b, L, y, h, paperB, mode, rs, rf, wins, lit);
  if (!rf) return;
  // Corridor: ceiling lamps (a few flicker on the generator), litter, a lost bag, bullet holes.
  const cz = L.czA + CORRIDOR / 2;
  for (let x = L.ix0 + 2.5; x < L.ix1 - 1; x += 5) {
    b.block(0xd8d8d0, x - 0.6, y + h - 0.06, cz - 0.06, 1.2, 0.05, 0.12, 'lamp');
    if (powered && rf() < 0.5) b.life(1, x, y + h - 0.07, cz, 0, 0, 1.2, h - 0.07, rf());
  }
  if (rf() < 0.35) groundDecal(b, 'decalLitter', L.ix0 + 2 + rf() * (width - 4), y, cz, 1.5, rf, 1.8);
  if (rf() < 0.5) groundDecal(b, 'decalLitter', L.ix0 + 2 + rf() * (width - 4), y, cz, 1.6, rf);
  if (rf() < 0.2) wallDecalZ(b, 'decalBullets', L.ix0 + 2 + rf() * (width - 4), y + 1.3, L.czA, 1.2, 1);
  F.papers(new Place(b, L.ix0, y, L.czA), rf, 1, 0.2, width - 1, CORRIDOR - 0.2, 2 + Math.floor(rf() * 5));
  if (rf() < 0.25) F.suitcase(new Place(b, L.ix0 + 4 + rf() * (width - 8), y, cz - 0.3, Math.floor(rf() * 4) as Quarter), rf, rf() < 0.5);
}

/**
 * Unit door. Planked shut from outside (no way in), or barricaded from inside: then it swings out
 * into the corridor and opens onto the furniture piled behind it.
 */
function unitDoor(b: Builder, gx: number, hz: number, y: number, swing: number, plankZ: number, st: UnitState, rs: Rand): void {
  const planked = st !== 'barricaded' && rs() < 0.1;
  const open = !planked && (st === 'fled' ? rs() < 0.45 : st === 'ransacked' ? rs() < 0.6 : false);
  b.door(gx, hz, y, 0, st === 'barricaded' ? -swing : swing, planked, { open });
  if (planked) {
    for (let p = 0; p < 3; p++) b.block(0x6a5a42, gx - 0.15, y + 0.5 + p * 0.6, plankZ, DOOR_W + 0.3, 0.14, 0.04, 'wood');
  }
}

function backUnits(b: Builder, L: Local, y: number, h: number, paper: number, mode: UnitMode, rs: Rand, rf: Rand | null, wins: number[], lit: LitUnit[]): void {
  const x0 = L.cx1 + 0.15;
  const width = L.ix1 - x0;
  if (width < 4) return;
  const n = Math.max(1, Math.floor(width / 6.5));
  const uw = width / n;
  for (let u = 0; u < n; u++) {
    const ux0 = x0 + u * uw;
    const ux1 = ux0 + uw;
    if (u > 0) b.blockY(paper, ux0 - 0.06, y, L.cz0, 0.12, h, L.iz1 - L.cz0, 'plaster');
    const light = lit.find((l) => l.back && l.u === u);
    const st0 = mode === 'storage' ? 'lived' : unitState(rs);
    const st = light ? 'lived' : st0;
    const gx = ux0 + uw / 2 - DOOR_W / 2;
    b.blockY(paper, ux0, y, L.cz0, gx - ux0, h, 0.12, 'plaster');
    b.blockY(paper, gx + DOOR_W, y, L.cz0, ux1 - gx - DOOR_W, h, 0.12, 'plaster');
    b.block(paper, gx, y + 2.1, L.cz0, DOOR_W, h - 2.1, 0.12, 'plaster');
    unitDoor(b, gx, L.cz0 + 0.06, y, -1, L.cz0 - 0.06, st, rs);
    if (rf) furnishUnit(b, ux0 + 0.1, L.cz0 + 0.12, ux1 - 0.1, L.iz1, y, h, mode, false, st, rf, wins, paper, light);
  }
}

/**
 * One apartment, office or storeroom. Authored in a unit frame: the far wall (facade, windows) at
 * z = 0, the door in the middle of the wall at z = d, x across the unit.
 */
function furnishUnit(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, mode: UnitMode, front: boolean, st: UnitState, rf: Rand, wins: number[], paper: number, light?: LitUnit): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const U = new Place(b, cx, y, front ? z0 : z1, front ? 0 : 2);
  const lwin = wins.map((x) => (front ? x - cx : cx - x)).filter((x) => Math.abs(x) < w / 2 - 0.6);
  if (st === 'burnt') {
    // Burnt out: soot, a charred heap where the furniture was burnt for warmth.
    U.decal('decalSoot', (rf() - 0.5) * w * 0.4, d * 0.5, 2.2, rf, 1.3);
    U.decal('decalSoot', (rf() - 0.5) * w * 0.6, d * 0.3, 1.6, rf);
    for (let i = 0; i < 4; i++) U.rbox(0x1e1a16, (rf() - 0.5) * 0.8, 0.05, d * 0.5 + (rf() - 0.5) * 0.8, 0.9, 0.06, 0.1, rf() * 3, 0, 0.2, 'wood');
    return;
  }
  if (light) {
    // The lamp that is still on: a shade under the ceiling over the open part of the unit.
    const lz = d * (d >= 7 ? 0.62 : 0.5);
    U.box(0x2a2a2a, 0, h - 0.35, lz, 0.02, 0.35, 0.02, 'metal');
    U.cone(0xf0dcb0, 0, h - 0.42, lz, 0.28, 0.2, 'lamp');
    // The tag ties the room to its windows on the facade (they hide while the room itself is here).
    U.life(5, 0, h - 0.5, lz, w, h - 0.5, light.mode, light.tag);
  }
  if (mode === 'office') officeUnit(U, w, d, st, rf);
  else if (mode === 'storage') storageUnit(U, w, d, rf);
  else apartment(U, w, d, h, st, rf, lwin, paper);
  if (st === 'barricaded') F.barricade(U.at(0, d, 2), rf);
}

function apartment(U: Place, w: number, d: number, h: number, st: UnitState, rf: Rand, lwin: number[], paper: number): void {
  const messy = st === 'ransacked';
  const fled = st === 'fled';
  const open = () => messy || (fled && rf() < 0.6);
  const s = rf() < 0.5 ? -1 : 1;
  const face = (side: number): Quarter => (side > 0 ? 1 : 3);
  const radio = (st === 'lived' || fled) && rf() < 0.15;
  const spec = FACADE_WINDOW.apartments;
  for (const lx of lwin) if (rf() < 0.75) F.curtains(U.at(lx, 0), rf, spec.width, spec.sill, spec.head);

  if (d >= 7) {
    // Bedroom (side s) behind a partition, living room (side −s), kitchen towards the door.
    const dz = Math.min(5.2, Math.max(3.6, d * 0.5));
    U.box(paper, 0, 0, dz / 2, 0.12, h, dz, 'plaster', true);
    const ret = w / 2 - 1.06;
    U.box(paper, s * (0.06 + ret / 2), 0, dz, ret, h, 0.12, 'plaster', true);
    U.box(paper, s * (w / 2 - 0.5), 2.1, dz, 1.0, h - 2.1, 0.12, 'plaster');

    // Bedroom.
    const bx = s * (w / 4 + 0.1);
    F.bed(U.at(bx, 0), rf, 1.5, messy);
    F.nightstand(U.at(s * (w / 4 + 1.15), 0), rf, open());
    F.wardrobe(U.at(s * 0.06, dz - 1.0, face(s)), rf, open());
    F.painting(U.at(s * w / 2, Math.min(dz - 0.5, 2.8), face(-s)), rf, 1.5, messy && rf() < 0.5);
    if (fled || messy) F.suitcase(U.at(bx, 2.55), rf, rf() < 0.6);
    else F.rug(U.at(bx, 2.2), rf, 0.4, 1.4, 0.8);

    // Living room.
    const sofaP = U.at(-s * w / 2, dz * 0.5, face(s));
    F.sofa(sofaP, rf, 2.0, messy);
    F.rug(sofaP, rf, 1.35, 1.9, 1.3);
    F.coffeeTable(sofaP.at(0, 1.05), rf, messy && rf() < 0.6);
    F.painting(sofaP, rf, 1.55, messy && rf() < 0.4);
    F.tvStand(U.at(-s * 0.06, dz * 0.5, face(-s)), rf, messy && rf() < 0.6);
    F.bookcase(U.at(-s * (w / 2 - 0.55), 0), rf, messy);
    F.floorLamp(sofaP.at(1.25, 0.3), rf, messy && rf() < 0.6);
    F.plant(U.at(-s * (w / 2 - 0.35), dz - 0.45), rf, messy && rf() < 0.5);

    // Kitchen.
    const kz = dz + 0.12;
    const kd = d - kz;
    const len = Math.min(2.6, kd - 1.4);
    if (len >= 1.4) {
      F.kitchenRun(U.at(-s * w / 2, kz + 0.1 + len / 2, face(s)), rf, len, messy, radio);
      if (kz + len + 1.0 < d - 0.6) F.fridge(U.at(-s * w / 2, kz + 0.1 + len + 0.4, face(s)), rf, open());
    }
    if (kd >= 3) F.diningTable(U.at(s * (w / 4), kz + kd / 2), rf, 4, messy);
    else F.chair(U.at(s * (w / 4), kz + kd / 2, Math.floor(rf() * 4) as Quarter), rf);
  } else {
    // Studio: bed by the window, wardrobe, kitchenette by the door, a small table.
    F.bed(U.at(s * (w / 2 - 0.85), 0), rf, 1.4, messy);
    F.nightstand(U.at(s * (w / 2 - 1.85), 0), rf, open());
    F.wardrobe(U.at(-s * (w / 2 - 0.7), 0), rf, open());
    const len = Math.min(2.2, d - 2.4);
    if (len >= 1.2) F.kitchenRun(U.at(-s * w / 2, d - 0.3 - len / 2, face(s)), rf, len, messy, radio);
    F.diningTable(U.at(s * 0.9, d * 0.62), rf, 2, messy);
    F.painting(U.at(s * w / 2, 2.6, face(-s)), rf, 1.5, messy && rf() < 0.5);
  }

  // By the door: notes, luggage that never left, moving boxes.
  if (fled || rf() < 0.2) F.notes(U.at(s * 1.0, d, 2), rf, 1 + Math.floor(rf() * 3));
  if (fled && rf() < 0.7) F.suitcase(U.at(-s * 1.1, d - 0.75, Math.floor(rf() * 4) as Quarter), rf, rf() < 0.4);
  if (rf() < (fled ? 0.4 : 0.2)) F.boxes(U.at(s * 2.1, d, 2), rf, 2 + Math.floor(rf() * 2));
  if (messy) {
    F.clothesPile(U, rf, (rf() - 0.5) * w * 0.6, d * 0.5, 4);
    F.papers(U, rf, -w / 2 + 0.4, 0.4, w / 2 - 0.4, d - 0.4, 8);
    U.decal('decalLitter', (rf() - 0.5) * w * 0.5, d * 0.6, 1.6, rf);
  } else if (rf() < 0.3) {
    U.decal('decalLitter', (rf() - 0.5) * w * 0.5, d * (0.3 + rf() * 0.4), 1.3, rf);
  }
}

function officeUnit(U: Place, w: number, d: number, st: UnitState, rf: Rand): void {
  const messy = st === 'ransacked';
  const open = messy || st === 'fled';
  if (d >= 7) {
    // Two columns of cubicles facing the door, a partition down the middle.
    let rows = 0;
    for (const side of [-1, 1]) {
      const lx = side * (w / 4);
      rows = 0;
      for (let zz = 1.1; zz + 2.0 < d - 1.0; zz += 2.3) {
        F.partition(U.at(lx, zz - 0.05), w / 2 - 0.5);
        F.desk(U.at(lx, zz), rf, open && rf() < 0.6, messy && rf() < 0.5);
        F.officeChair(U.at(lx - 0.15, zz + 1.15, 2), rf, messy && rf() < 0.5);
        rows++;
      }
    }
    if (rows > 0) F.partition(U.at(0, 1.05 + (rows * 2.3) / 2, 1), rows * 2.3 - 0.4);
    F.filingCabinet(U.at(-w / 2 + 0.35, 0), rf, open && rf() < 0.5);
    F.filingCabinet(U.at(w / 2 - 0.35, 0), rf, open && rf() < 0.5);
    F.printer(U.at(-w / 2, d - 1.2, 1), rf);
    F.waterCooler(U.at(w / 2, d - 1.0, 3), rf);
    F.plant(U.at(w / 2 - 0.35, d - 1.9), rf, messy && rf() < 0.5);
  } else if (rf() < 0.6) {
    // Meeting room: a table, chairs, a whiteboard with a plan nobody followed.
    F.diningTable(U.at(0, d / 2), rf, 4, messy);
    const wb = U.at(-w / 2, d / 2, 1);
    wb.box(0xd8d8d0, 0, 0.9, 0.02, 1.6, 1.0, 0.03, 'plaster');
    F.notes(wb, rf, 2);
    F.filingCabinet(U.at(w / 2 - 0.35, 0), rf, open);
  } else {
    storageUnit(U, w, d, rf);
  }
  F.papers(U, rf, -w / 2 + 0.3, 0.3, w / 2 - 0.3, d - 0.3, messy ? 22 : 5);
  if (messy || rf() < 0.4) U.decal('decalLitter', (rf() - 0.5) * w * 0.5, d * 0.5, 2, rf);
}

function storageUnit(U: Place, w: number, d: number, rf: Rand): void {
  F.boxes(U.at(-w / 4, 0), rf, 3);
  F.boxes(U.at(w / 4, 0), rf, 2);
  F.shopShelf(U.at(-w / 2, d / 2, 1), rf, Math.min(2.4, d - 1.4), 'grocery', true);
  const cx = w / 2 - 0.6;
  U.box(PAL.crate, cx, 0, d / 2, 0.8, 0.7, 0.8, 'wood', true);
  U.container('crate', cx - 0.7, d / 2);
  F.papers(U, rf, -w / 2 + 0.5, 0.5, w / 2 - 0.5, d - 0.5, 3);
}

/** Street-level shop: x0..x1 along the facade, z0 (shop windows) .. z1 (back wall). */
function shopInterior(b: Builder, x0: number, z0: number, x1: number, z1: number, kind: ShopKind, rf: Rand): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const messy = rf() < 0.55;
  // Shop frame: back wall at z = 0, the street towards +Z.
  const S = new Place(b, (x0 + x1) / 2, 0, z1, 2);
  F.shopCounter(S.at(0, 0), rf, kind);
  const left = (z: number) => new Place(b, x0, 0, z, 1);
  if (kind === 'grocery') {
    for (let lz = 2.2; lz < d - 1.4; lz += 2.0) {
      F.shopShelf(S.at(0, lz), rf, w - 2.8, kind, messy);
      F.shopShelf(S.at(0, lz, 2), rf, w - 2.8, kind, messy);
    }
    F.cooler(left(z0 + d * 0.55), rf);
  } else if (kind === 'pharmacy') {
    for (let z = z0 + 1.4; z + 1.1 < z1 - 1.0; z += 2.2) F.shopShelf(left(z), rf, 2.0, kind, messy);
    if (d > 6) F.shopShelf(S.at(0.6, d * 0.5, 0), rf, Math.min(2.4, w - 3), kind, messy);
  } else if (kind === 'cafe') {
    for (let lz = 2.2; lz < d - 1.0; lz += 1.9) for (const lx of [-w / 4, w / 4]) F.cafeTable(S.at(lx, lz), rf, messy);
    F.cooler(left(z1 - 1.4), rf);
  } else {
    for (let z = z0 + 0.9; z < z1 - 1.0; z += 0.7) F.washer(left(z), rf, rf() < 0.3);
    const T = S.at(0.6, d * 0.55);
    T.box(0x8a8070, 0, 0.8, 0, 1.6, 0.04, 0.7);
    T.box(0x3a3a3a, -0.7, 0, 0, 0.05, 0.8, 0.6, 'metal');
    T.box(0x3a3a3a, 0.7, 0, 0, 0.05, 0.8, 0.6, 'metal');
    T.solid(0, 0, 1.6, 0.7, 0.85);
    F.clothesPile(T, rf, 0, 0.7, 3);
  }
  F.papers(S, rf, -w / 2 + 0.4, 0.9, w / 2 - 0.4, d - 0.4, messy ? 10 : 3);
  if (messy) S.decal('decalLitter', (rf() - 0.5) * w * 0.4, d * 0.5, 2.2, rf, 1.3);
}
