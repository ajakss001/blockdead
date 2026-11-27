import { mulberry32 } from '../../core/random';
import { FACADE_BAY, type Surface } from '../../render/look/surfaces';
import * as F from './furniture';
import { Place, type Quarter, type ShopKind } from './furniture';
import {
  type BuildingDesc,
  CORE_W,
  CORRIDOR,
  DOOR_W,
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
} from './highrise';
import { LIFE, spotHash } from './lifeKinds';
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

/**
 * Splits [x0, x1] into `count` bays whose interior walls land on FACADE_BAY piers
 * so no partition wall ever cuts a window in half.
 */
function snapBayBounds(x0: number, x1: number, count: number): number[] {
  const bounds = [x0];
  const width = x1 - x0;
  for (let u = 1; u < count; u++) {
    const raw = x0 + (u * width) / count;
    const snapped = Math.round(raw / FACADE_BAY) * FACADE_BAY;
    const prev = bounds[bounds.length - 1];
    if (snapped - prev >= FACADE_BAY - 0.25 && x1 - snapped >= FACADE_BAY - 0.25) {
      bounds.push(snapped);
    }
  }
  bounds.push(x1);
  return bounds;
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
    const floorS: Surface = k === 0 ? 'tile' : office ? 'linoleum' : 'parquet';
    const floorC = k === 0 ? 0x8a867c : office ? 0x747670 : 0x725e48;
    b.block(floorC, L.ix0, sy, L.iz0, L.ix1 - L.ix0, slabT, L.cz0 + NEAR - L.iz0, floorS, k > 0);
    b.block(floorC, L.cx1, sy, L.cz0 + NEAR, L.ix1 - L.cx1, slabT, L.iz1 - L.cz0 - NEAR, floorS, k > 0);

    // Stair core: flight A up the left side, landing at the back, flight B back down to the next floor.
    const zf0 = L.cz0 + NEAR;
    for (let i = 0; i < STEPS; i++) {
      b.block(0x6a6862, L.cx0, y + i * rise, zf0 + i * step, FLIGHT_W, rise, step, 'concrete', true);
      b.block(0x6a6862, L.cx1 - FLIGHT_W, y + FLOOR_H / 2 + i * rise, zf0 + RUN - (i + 1) * step, FLIGHT_W, rise, step, 'concrete', true);
    }
    b.block(0x6a6862, L.cx0, y + FLOOR_H / 2 - 0.2, zf0 + RUN, CORE_W, 0.2, L.cz1 - zf0 - RUN, 'concrete', true);
    // Well divider / railing between the flights (blocks crossing), core side wall towards the units.
    b.blockY(0x3a3c3e, L.cx0 + FLIGHT_W, y, zf0, CORE_W - 2 * FLIGHT_W, FLOOR_H, RUN, 'metal');
    // Full-depth side wall: the landing opens only onto the corridor, never straight into a unit.
    b.blockY(paperA, L.cx1, y, L.cz0, 0.15, h, L.cz1 - L.cz0, 'plaster');
    // Painted storey number by the landing.
    b.block(0xb0aa98, L.cx1 + 0.16, y + 1.4, L.cz0 + NEAR + 0.2, 0.02, 0.4, 0.3, 'plaster');

    if (k === 0) lobby(b, L, desc, h, rs, rf, paperA);
    else corridorStorey(b, L, desc.seed, k, y, h, paperA, paperB, office ? 'office' : 'apartment', rs, rf, powered, lit.filter((l) => l.k === k));
  }
  b.setIdBase(null);
  b.endFrame();
}

function lobby(b: Builder, L: Local, desc: BuildingDesc, h: number, rs: Rand, rf: Rand | null, paper: number): void {
  const shop = groundShop(desc);
  if (shop) {
    // Shop walls: along Z at its edge (a door into the lobby), along X on the corridor line.
    const sx = shop.x1;
    const gz = (L.iz0 + L.czA) / 2 - DOOR_W / 2;
    b.blockY(paper, sx, 0, L.iz0, 0.12, h, gz - L.iz0, 'plaster');
    b.blockY(paper, sx, 0, gz + DOOR_W, 0.12, h, L.czA - gz - DOOR_W, 'plaster');
    b.blockY(paper, sx, 2.1, gz, 0.12, h - 2.1, DOOR_W, 'plaster');
    b.door(sx + 0.06, gz, 0, -Math.PI / 2, 1, false, { open: rs() < 0.5 });
    b.blockY(paper, L.ix0, 0, L.czA - 0.12, sx - L.ix0 + 0.12, h, 0.12, 'plaster');
    // Linoleum floor accent inside the ground shop so it looks distinct from lobby tiles.
    b.block(0x76746c, L.ix0 + 0.05, 0.048, L.iz0 + 0.05, sx - L.ix0 - 0.1, 0.01, L.czA - L.iz0 - 0.18, 'linoleum');
    if (rf) shopInterior(b, L.ix0, L.iz0, sx, L.czA - 0.12, shop.kind, rf);
  }
  // Back units at street level: storerooms off the corridor.
  backUnits(b, L, desc.seed, 0, 0, h, PAL.wallpapers[0], 'storage', rs, rf, []);
  if (!rf) return;

  // Concierge desk facing the doors (kept clear of elevator & side walls), mailboxes beside the elevator on the solid core wall.
  if (L.czA - L.iz0 >= 5.6) {
    const cx = Math.max(L.doorX + 2.4, L.cx1 + 3.4);
    if (cx <= L.ix1 - 1.2) {
      F.concierge(new Place(b, cx, 0, Math.min(L.czA - 0.5, L.iz0 + 5.2), 2), rf);
    }
  }
  F.elevator(new Place(b, L.cx1 + 1.5, 0, L.cz0, 2), rf);
  F.mailboxes(new Place(b, L.cx1 + 3.55, 0, L.cz0, 2), rf);
  // Residents who never made it out of the lobby with their luggage.
  const bags = Math.floor(rf() * 3);
  for (let n = 0; n < bags; n++) F.suitcase(new Place(b, L.doorX + (rf() - 0.5) * 3, 0, L.iz0 + 3.0 + rf() * 1.2, Math.floor(rf() * 4) as Quarter), rf, rf() < 0.4);
  if (rf() < 0.7) groundDecal(b, 'decalSoot', L.doorX + (rf() - 0.5) * 4, 0.05, L.iz0 + 2 + rf() * 4, 2.2, rf, 1.3);
  if (spotHash(L.doorX, L.cz0, 77) < 0.45) wallDecalZ(b, 'decalCobweb', L.cx1 + 0.45, h - 0.35, L.cz0, 0.7, -1);
}

function corridorStorey(b: Builder, L: Local, buildingSeed: number, floorIdx: number, y: number, h: number, _paperA: number, paperB: number, mode: UnitMode, rs: Rand, rf: Rand | null, powered: boolean, lit: LitUnit[]): void {
  // Windowless interior PBR wall pool only (never exterior facadeBrick/facadeConcrete with painted black windows!).
  const skins: readonly Surface[] = mode === 'office'
    ? ['plaster', 'concrete', 'wood', 'wallpaper']
    : ['wallpaper', 'plaster', 'wood', 'concrete', 'brick'];
  const width = L.ix1 - L.ix0;
  const n = Math.max(2, Math.floor(width / 6.5));
  const bounds = snapBayBounds(L.ix0, L.ix1, n);
  for (let u = 0; u < bounds.length - 1; u++) {
    const ux0 = bounds[u];
    const ux1 = bounds[u + 1];
    const uw = ux1 - ux0;
    const roomSeed = hash3(buildingSeed + floorIdx * 31, u, 409);
    const wallSkinA = skins[Math.abs(roomSeed) % skins.length];
    const wallSkinB = skins[Math.abs(roomSeed >> 3) % skins.length];
    const roomPaper = PAL.wallpapers[Math.abs(roomSeed >> 5) % PAL.wallpapers.length];
    const corrPaper = mode === 'office' ? paperB : roomPaper;

    if (u > 0) b.blockY(roomPaper, ux0 - 0.06, y, L.iz0, 0.12, h, L.czA - 0.12 - L.iz0, wallSkinA);
    // Someone still lives in a lit unit (the random stream advances either way).
    const light = lit.find((l) => !l.back && l.u === u);
    const st0 = unitState(rs);
    const st = light ? 'lived' : st0;
    // Corridor wall with this unit's doorway.
    const gx = ux0 + uw / 2 - DOOR_W / 2;
    b.blockY(corrPaper, ux0, y, L.czA - 0.12, gx - ux0, h, 0.12, wallSkinB);
    b.blockY(corrPaper, gx + DOOR_W, y, L.czA - 0.12, ux1 - gx - DOOR_W, h, 0.12, wallSkinB);
    b.blockY(corrPaper, gx, y + 2.1, L.czA - 0.12, DOOR_W, h - 2.1, 0.12, wallSkinB);
    unitDoor(b, gx, L.czA - 0.06, y, 1, L.czA + 0.02, st, rs);
    if (rf) {
      furnishUnit(b, ux0 + 0.1, L.iz0, ux1 - 0.1, L.czA - 0.12, y, h, mode, true, st, rf, roomPaper, roomSeed, light);
    }
  }
  backUnits(b, L, buildingSeed, floorIdx, y, h, paperB, mode, rs, rf, lit);
  if (!rf) return;
  // Corridor: ceiling lamps (a few flicker on the generator), bullet holes, damp/cracks, a lost bag.
  const cz = L.czA + CORRIDOR / 2;
  for (let x = L.ix0 + 2.5; x < L.ix1 - 1; x += 5) {
    b.block(0xd8d8d0, x - 0.6, y + h - 0.06, cz - 0.06, 1.2, 0.05, 0.12, 'lamp');
    if (powered && rf() < 0.5) b.life(1, x, y + h - 0.07, cz, 0, 0, 1.2, h - 0.07, rf());
  }
  if (rf() < 0.2) wallDecalZ(b, 'decalBullets', L.ix0 + 0.8, y + 1.3, L.czA, 1.1, 1);
  if (spotHash(buildingSeed + floorIdx, L.ix0, 81) < 0.5) wallDecalZ(b, 'decalCrack', L.ix0 + 1.8, y + 1.45, L.czA - 0.12, 1.1, -1);
  if (spotHash(buildingSeed + floorIdx, L.cx1, 82) < 0.45) wallDecalZ(b, 'decalCobweb', L.ix0 + 0.5, y + h - 0.35, L.czA, 0.65, 1);
  if (rf() < 0.25) F.suitcase(new Place(b, L.ix0 + 4 + rf() * (width - 8), y, cz - 0.3, Math.floor(rf() * 4) as Quarter), rf, rf() < 0.5);
}

/**
 * Unit door. Planked shut from outside (no way in), or barricaded from inside: then it swings out
 * into the corridor and opens onto the furniture piled behind it.
 */
function unitDoor(b: Builder, gx: number, hz: number, y: number, swing: number, _plankZ: number, st: UnitState, rs: Rand): void {
  const planked = st !== 'barricaded' && rs() < 0.1;
  const open = !planked && (st === 'fled' ? rs() < 0.45 : st === 'ransacked' ? rs() < 0.6 : false);
  b.door(gx, hz, y, 0, st === 'barricaded' ? -swing : swing, planked, { open });
}

function backUnits(b: Builder, L: Local, buildingSeed: number, floorIdx: number, y: number, h: number, paper: number, mode: UnitMode, rs: Rand, rf: Rand | null, lit: LitUnit[]): void {
  let x0 = L.cx1 + 0.15;
  if (mode === 'storage') {
    // Ground floor: reserve [L.cx1 + 0.15, L.cx1 + 4.35] as a solid alcove wall for the elevator + mailboxes.
    const alcEnd = Math.min(L.ix1, L.cx1 + 4.35);
    if (L.ix1 - alcEnd < 3.6) {
      b.blockY(paper, x0, y, L.cz0, Math.max(0, L.ix1 - x0), h, 0.12, 'plaster');
      return;
    }
    b.blockY(paper, x0, y, L.cz0, alcEnd - x0, h, 0.12, 'plaster');
    b.blockY(paper, alcEnd - 0.06, y, L.cz0 + 0.12, 0.12, h, L.iz1 - L.cz0 - 0.12, 'plaster');
    x0 = alcEnd;
  }
  const width = L.ix1 - x0;
  if (width < 4) return;
  const n = Math.max(1, Math.floor(width / 6.5));
  const bounds = snapBayBounds(x0, L.ix1, n);
  const backSkins: readonly Surface[] = mode === 'office'
    ? ['plaster', 'concrete', 'wood']
    : ['wallpaper', 'plaster', 'wood', 'brick'];
  for (let u = 0; u < bounds.length - 1; u++) {
    const ux0 = bounds[u];
    const ux1 = bounds[u + 1];
    const uw = ux1 - ux0;
    const roomSeed = hash3(buildingSeed + floorIdx * 37, u + 19, 511);
    const skin = backSkins[Math.abs(roomSeed) % backSkins.length];
    const unitPaper = mode === 'storage' ? paper : PAL.wallpapers[Math.abs(roomSeed >> 4) % PAL.wallpapers.length];
    if (u > 0) b.blockY(unitPaper, ux0 - 0.06, y, L.cz0 + 0.12, 0.12, h, L.iz1 - L.cz0 - 0.12, skin);
    const light = lit.find((l) => l.back && l.u === u);
    const st0 = mode === 'storage' ? 'lived' : unitState(rs);
    const st = light ? 'lived' : st0;
    const gx = ux0 + uw / 2 - DOOR_W / 2;
    b.blockY(paper, ux0, y, L.cz0, gx - ux0, h, 0.12, 'plaster');
    b.blockY(paper, gx + DOOR_W, y, L.cz0, ux1 - gx - DOOR_W, h, 0.12, 'plaster');
    b.blockY(paper, gx, y + 2.1, L.cz0, DOOR_W, h - 2.1, 0.12, 'plaster');
    unitDoor(b, gx, L.cz0 + 0.06, y, -1, L.cz0 - 0.06, st, rs);
    if (rf) furnishUnit(b, ux0 + 0.1, L.cz0 + 0.12, ux1 - 0.1, L.iz1, y, h, mode, false, st, rf, unitPaper, roomSeed, light);
  }
}

/**
 * One apartment, office or storeroom. Authored in a unit frame: the far wall (facade, windows) at
 * z = 0, the door in the middle of the wall at z = d, x across the unit.
 */
function furnishUnit(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, h: number, mode: UnitMode, front: boolean, st: UnitState, rf: Rand, paper: number, roomSeed: number, light?: LitUnit): void {
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const U = new Place(b, cx, y, front ? z0 : z1, front ? 0 : 2);
  if (st === 'burnt') {
    // Burnt out: soot patches on the floor.
    U.decal('decalSoot', (rf() - 0.5) * w * 0.4, d * 0.5, 2.2, rf, 1.3);
    U.decal('decalSoot', (rf() - 0.5) * w * 0.6, d * 0.3, 1.6, rf);
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
  else apartment(U, w, d, h, st, rf, paper, cx, front, roomSeed);
  // Subtle abandoned interior cobwebs, ceiling dampness, and wall cracks (room-seeded).
  if (spotHash(cx, z0 + y * 5, 91) < 0.55) {
    U.poster(0xffffff, (spotHash(cx, y, 92) - 0.5) * (w - 0.9), h - 0.34, 0.62, 0.62, 0, 'decalCobweb');
  }
  if (spotHash(cx, z1 + y * 3, 93) < 0.48) {
    U.decal('decalDamp', (spotHash(z0, y, 94) - 0.5) * w * 0.55, d * 0.55, 1.35, () => 0.4);
  }
  if (spotHash(x0, y * 7, 95) < 0.42) {
    U.poster(0xffffff, (spotHash(x1, y, 96) - 0.5) * (w - 1.1), 1.45, 0.95, 0.95, 0, 'decalCrack');
  }
  // A leak: water dripping from the ceiling somewhere in the unit.
  if (U.chance(0, 0, 68) < 0.28) U.life(LIFE.drip, (U.chance(0, 0, 69) - 0.5) * w * 0.6, h, d * (0.25 + U.chance(0, 0, 70) * 0.5), 0, y === 0 ? h - 0.05 : h, U.chance(0, 0, 71));
  if (st === 'barricaded') F.barricade(U.at(0, d, 2).nearDoor(), rf);
}

function apartment(U: Place, w: number, d: number, h: number, st: UnitState, rf: Rand, paper: number, cx: number, front: boolean, roomSeed: number): void {
  const messy = st === 'ransacked';
  const fled = st === 'fled';
  const open = () => messy || (fled && rf() < 0.6);
  const s = rf() < 0.5 ? -1 : 1;
  const face = (side: number): Quarter => (side > 0 ? 1 : 3);
  const radio = (st === 'lived' || fled) && rf() < 0.15;
  // The kitchen: a dripping tap; flies over what was left behind.
  const kitchenLife = (K: Place, len: number) => {
    if (K.chance(0, 0, 64) < 0.35) K.life(LIFE.tap, -len / 2 + 0.5, 1.0, 0.12, 0, 0, K.chance(0, 0, 65));
    if ((messy || fled) && K.chance(0, 0, 66) < 0.3) K.life(LIFE.flies, 0, 1.1, 0.4, 0, 0, K.chance(0, 0, 67));
  };
  // Now and then a phone rings in the empty flat.
  if (U.chance(0, 0, 72) < 0.05) U.life(LIFE.phone, 0, 0.8, d * 0.5, 0, 0, U.chance(0, 0, 73));

  // Find a FACADE_BAY pier inside this apartment so the bedroom/living-room wall never splits a window.
  const basePier = Math.round(cx / FACADE_BAY) * FACADE_BAY;
  let partX: number | null = null;
  for (const offset of [0, -FACADE_BAY, FACADE_BAY]) {
    const cand = ((basePier + offset) - cx) * (front ? 1 : -1);
    if (cand >= -w / 2 + 2.4 && cand <= w / 2 - 2.4) {
      partX = cand;
      break;
    }
  }
  if (d >= 7 && partX !== null) {
    // Bedroom (side s) behind a pier-aligned partition, living room (side −s), kitchen towards the door.
    const dz = Math.min(5.2, Math.max(4.15, d * 0.5));
    const roomWallS: Surface = (Math.abs(roomSeed) & 1) === 0 ? 'wallpaper' : 'plaster';
    const bedTint = PAL.wallpapers[Math.abs(roomSeed >> 2) % PAL.wallpapers.length];
    U.box(bedTint, partX, 0, dz / 2, 0.12, h, dz, roomWallS, true);
    const sideW = w / 2 - s * partX;
    const ret = sideW - 1.06;
    if (ret > 0.08) U.box(bedTint, partX + s * (0.06 + ret / 2), 0, dz, ret, h, 0.12, roomWallS, true);
    U.box(bedTint, s * (w / 2 - 0.5), 2.1, dz, 1.0, h - 2.1, 0.12, roomWallS);
    const [archX, archZ] = U.pt(s * (w / 2 - 0.5), dz);
    U.b.registerDoorClearance(archX, U.y, archZ, 1.5);

    // Kitchen zone flooring (ceramic tile / worn linoleum) vs bedroom/living parquet.
    const kz = dz + 0.12;
    const kd = d - kz;
    const kSurf: Surface = (Math.abs(roomSeed) & 2) === 0 ? 'linoleum' : 'tile';
    U.box(0x88847c, 0, 0.008, kz + kd / 2, w - 0.08, 0.012, kd - 0.08, kSurf);

    // Bedroom.
    const bedW = Math.min(1.5, Math.max(1.1, sideW - 1.2));
    const bedHalf = 0.865 * Math.min(1.15, bedW / 1.5);
    const bedX = sideW >= 2 * bedHalf + 1.0 ? partX + s * (0.14 + bedHalf + 0.08) : (partX + (s * w) / 2) / 2;
    F.bed(U.at(bedX, 0), rf, bedW, messy);
    const nsX = bedX + s * (bedHalf + 0.44);
    if (Math.abs(nsX) <= w / 2 - 0.36 && s * (nsX - partX) >= 0.42) F.nightstand(U.at(nsX, 0), rf, open());
    F.wardrobe(U.at(partX + s * 0.06, dz - 1.0, face(s)), rf, open());
    F.painting(U.at(s * w / 2, Math.min(dz - 0.5, 2.8), face(-s)), rf, 1.5, messy && rf() < 0.5);
    if (fled || messy) F.suitcase(U.at(bedX, 2.55), rf, rf() < 0.6);

    // Living room.
    const sofaP = U.at(-s * w / 2, dz * 0.5, face(s));
    F.sofa(sofaP, rf, 2.0, messy);
    F.coffeeTable(sofaP.at(0, 1.25), rf, messy && rf() < 0.6);
    F.painting(sofaP, rf, 1.55, messy && rf() < 0.4);
    const tvDown = messy && rf() < 0.6;
    const tvP = U.at(partX - s * 0.06, dz * 0.5, face(-s));
    F.tvStand(tvP, rf, tvDown);
    // The power is still on here: the set was left on, showing static.
    if (st === 'lived' && !tvDown && U.chance(0, 0, 61) < 0.6) tvP.life(LIFE.tv, 0, 0.75, 0.49, 0.5, 0.38, U.chance(0, 0, 62));
    F.bookcase(U.at(-s * (w / 2 - 0.9), 0), rf, messy);

    // Kitchen (tiled / backsplash wall strip behind counter).
    const len = Math.min(2.6, kd - 1.4);
    if (len >= 1.4) {
      const K = U.at(-s * w / 2, kz + 0.1 + len / 2, face(s));
      U.box(0xb6b8b0, -s * (w / 2 - 0.03), 0.78, kz + 0.1 + len / 2, 0.04, 0.85, len, 'wallTile');
      F.kitchenRun(K, rf, len, messy, radio);
      kitchenLife(K, len);
      if (kz + len + 1.0 < d - 0.6) {
        const fP = U.at(-s * w / 2, kz + 0.1 + len + 0.4, face(s));
        F.fridge(fP, rf, open());
        if (st === 'lived') fP.life(LIFE.fridge, 0, 1.0, 0.66, 0, 0, U.chance(0, 0, 63));
      }
    }
    if (kd >= 3) F.diningTable(U.at(s * (w / 4), kz + Math.min(kd * 0.45, kd - 2.2)), rf, 4, messy);
    else F.chair(U.at(s * (w / 4), kz + kd / 2, Math.floor(rf() * 4) as Quarter), rf);
  } else {
    // Studio: bed by the window, wardrobe, kitchenette by the door, a small table.
    U.box(0x887864, 0, 0.008, d * 0.5, w - 0.08, 0.012, d - 0.12, (Math.abs(roomSeed) & 1) === 0 ? 'parquet' : 'linoleum');
    void paper;
    F.bed(U.at(s * (w / 2 - 0.92), 0), rf, 1.4, messy);
    if (w >= 5.2) F.nightstand(U.at(s * (w / 2 - 2.22), 0), rf, open());
    F.wardrobe(U.at(-s * (w / 2 - 0.96), 0), rf, open());
    const len = Math.min(2.2, d - 2.4);
    if (len >= 1.2) {
      const K = U.at(-s * w / 2, d - 0.3 - len / 2, face(s));
      F.kitchenRun(K, rf, len, messy, radio);
      kitchenLife(K, len);
    }
    if (d >= 4.9 && w >= 4.6) F.diningTable(U.at(s * Math.min(1.6, w / 2 - 0.85), Math.max(3.6, d - 1.75)), rf, 2, messy);
    F.painting(U.at(s * w / 2, 2.6, face(-s)), rf, 1.5, messy && rf() < 0.5);
  }

  // By the door (only on solid wall away from the doorway): luggage, moving boxes.
  if (fled && w >= 4.2 && rf() < 0.7) F.suitcase(U.at(-s * Math.min(w / 2 - 0.65, 1.55), d - 0.75, Math.floor(rf() * 4) as Quarter), rf, rf() < 0.4);
  if (d >= 7 && w >= 4.6 && rf() < (fled ? 0.4 : 0.2)) F.boxes(U.at(s * Math.min(2.1, w / 2 - 0.7), d, 2), rf, 2 + Math.floor(rf() * 2));
}

function officeUnit(U: Place, w: number, d: number, st: UnitState, rf: Rand): void {
  const messy = st === 'ransacked';
  const open = messy || st === 'fled';
  if (d >= 7) {
    // Two columns of desks facing the door.
    for (const side of [-1, 1]) {
      const lx = side * (w / 4);
      for (let zz = 1.1; zz + 2.1 < d - 1.0; zz += 2.7) {
        F.desk(U.at(lx, zz), rf, open && rf() < 0.6, messy && rf() < 0.5);
        F.officeChair(U.at(lx - 0.15, zz + 1.62, 2), rf, messy && rf() < 0.5);
      }
    }
    F.filingCabinet(U.at(-w / 2 + 0.35, 0), rf, open && rf() < 0.5);
    F.filingCabinet(U.at(w / 2 - 0.35, 0), rf, open && rf() < 0.5);
  } else if (rf() < 0.6) {
    // Meeting room: a table, chairs, cabinet.
    F.diningTable(U.at(0, d / 2), rf, 4, messy);
    F.filingCabinet(U.at(w / 2 - 0.35, 0), rf, open);
  } else {
    storageUnit(U, w, d, rf);
  }
}

function storageUnit(U: Place, w: number, d: number, rf: Rand): void {
  F.boxes(U.at(-w / 4, 0), rf, 3);
  F.boxes(U.at(w / 4, 0), rf, 2);
  F.shopShelf(U.at(-w / 2, d / 2, 1), rf, Math.min(2.4, d - 1.4), 'grocery', true);
  const cx = w / 2 - 0.6;
  U.resetBounds();
  U.model('woodenCrate', rf, cx, 0, d / 2, 0, 1.0, 0.8, 0.1, true);
  U.container('crate', cx - 0.7, d / 2);
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
    for (let lz = 2.6; lz < d - 1.4; lz += 2.2) {
      F.shopShelf(S.at(0, lz), rf, Math.max(1.2, w - 2.8), kind, messy);
      F.shopShelf(S.at(0, lz, 2), rf, Math.max(1.2, w - 2.8), kind, messy);
    }
    F.cooler(left(z0 + d * 0.55), rf);
  } else if (kind === 'pharmacy') {
    for (let z = z0 + 1.4; z + 1.1 < z1 - 1.0; z += 2.2) F.shopShelf(left(z), rf, 2.0, kind, messy);
    if (d > 6) F.shopShelf(S.at(0.6, d * 0.5, 0), rf, Math.min(2.4, w - 3), kind, messy);
  } else if (kind === 'cafe') {
    const cols = w >= 5.6 ? [-w / 4, w / 4] : [w / 4];
    for (let lz = 2.8; lz < d - 1.0; lz += 2.2) for (const lx of cols) F.cafeTable(S.at(lx, lz), rf, messy);
    F.cooler(left(z0 + 1.1), rf);
  } else {
    for (let z = z0 + 0.9; z < z1 - 1.0; z += 1.5) F.washer(left(z), rf, rf() < 0.3);
    const T = S.at(0.6, d * 0.55);
    F.diningTable(T, rf, 0, false);
  }
}
