import type { ItemId } from '../../data/items';
import type { ContainerType } from '../../data/loot';
import type { Surface } from '../../render/look/surfaces';
import { buildCar, CAR_PAINTS } from '../props/car';
import * as F from './furniture';
import { CHUNK } from './layout';
import { LIFE, spotHash } from './lifeKinds';
import { Place, type Quarter } from './furniture';
import { type Builder, type DoorOptions, pick, type Rand } from './pieces';
import type { PoiSite } from './poi';

/**
 * POI templates. Each builds its block in a frame turned to face its road: local +Z points at the road,
 * the lot spans x, z ∈ [−LOT, LOT] around the block's centre. Walls are solid boxes with holes for doors
 * and windows; every building registers its roof (shelter) so inside counts as indoors.
 */
const LOT = CHUNK / 2 - 5.8;
const WALL = 0.2;

interface Hole {
  /** Centre along the wall, width, top; a window also has a sill. */
  at: number;
  w: number;
  h: number;
  sill?: number;
  glass?: boolean;
}

class Site {
  readonly p: Place;
  constructor(
    readonly b: Builder,
    readonly s: PoiSite,
  ) {
    this.p = new Place(b, s.i * CHUNK + CHUNK / 2, 0, s.j * CHUNK + CHUNK / 2, s.r as Quarter);
  }

  /** A wall along local X at z, from x0 to x1, h high, with holes. */
  wallX(color: number, x0: number, x1: number, z: number, h: number, holes: Hole[] = [], surface: Surface = 'plaster'): void {
    this.wall(x0, x1, h, holes, (a, b, y0, y1) => this.p.box(color, (a + b) / 2, y0, z, b - a, y1 - y0, WALL, surface, true));
  }

  /** A wall along local Z at x, from z0 to z1. */
  wallZ(color: number, z0: number, z1: number, x: number, h: number, holes: Hole[] = [], surface: Surface = 'plaster'): void {
    this.wall(z0, z1, h, holes, (a, b, y0, y1) => this.p.box(color, x, y0, (a + b) / 2, WALL, y1 - y0, b - a, surface, true));
  }

  private wall(a0: number, a1: number, h: number, holes: Hole[], seg: (a: number, b: number, y0: number, y1: number) => void): void {
    const sorted = [...holes].sort((u, v) => u.at - v.at);
    let a = a0;
    for (const o of sorted) {
      const l = o.at - o.w / 2;
      const r = o.at + o.w / 2;
      if (l > a) seg(a, l, 0, h);
      if (o.h < h) seg(l, r, o.h, h);
      if (o.sill) seg(l, r, 0, o.sill);
      a = r;
    }
    if (a1 > a) seg(a, a1, 0, h);
  }

  /** A glass pane in a window hole of a wall along local X (z) or Z (x). */
  paneX(x: number, z: number, w: number, y0: number, y1: number): void {
    this.p.box(0x6a7a84, x, y0, z, w, y1 - y0, 0.04, 'windowGlass', true);
  }

  paneZ(x: number, z: number, w: number, y0: number, y1: number): void {
    this.p.box(0x6a7a84, x, y0, z, 0.04, y1 - y0, w, 'windowGlass', true);
  }

  /** A door in a wall along local X at z, centred at x. */
  doorX(x: number, z: number, opts: DoorOptions = {}): void {
    const w = opts.width ?? 1.0;
    const [hx, hz] = this.p.pt(x - w / 2, z);
    this.b.door(hx, hz, 0, (this.p.r * Math.PI) / 2, 1, false, { width: w, ...opts });
  }

  /** A door in a wall along local Z at x, centred at z. */
  doorZ(x: number, z: number, opts: DoorOptions = {}): void {
    const w = opts.width ?? 1.0;
    const [hx, hz] = this.p.pt(x, z + w / 2);
    this.b.door(hx, hz, 0, ((this.p.r + 1) * Math.PI) / 2, 1, false, { width: w, ...opts });
  }

  /** Floor, ceiling and roof over a local rectangle; registers the shelter. */
  roof(x0: number, z0: number, x1: number, z1: number, h: number, floor: number, ceiling = 0xb8b4a8, roofColor = 0x3a3a38): void {
    const w = x1 - x0;
    const d = z1 - z0;
    this.p.box(floor, (x0 + x1) / 2, 0, (z0 + z1) / 2, w, 0.04, d, 'tile');
    this.p.box(ceiling, (x0 + x1) / 2, h - 0.05, (z0 + z1) / 2, w, 0.05, d, 'plaster');
    this.p.box(roofColor, (x0 + x1) / 2, h, (z0 + z1) / 2, w + 0.4, 0.25, d + 0.4, 'roof');
    const [ax, az] = this.p.pt(x0, z0);
    const [bx, bz] = this.p.pt(x1, z1);
    this.b.shelter(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), h);
  }

  /** A searchable container at a local point, of a type, maybe with things always in it. */
  container(type: ContainerType, lx: number, lz: number, fixed?: ItemId[]): void {
    const [x, z] = this.p.pt(lx, lz);
    this.b.containers.push({ type, x, z, ...(fixed ? { fixed } : {}) });
  }

  /** The last container a furniture piece registered becomes this type (and gets fixed items). */
  retype(type: ContainerType, fixed?: ItemId[]): void {
    const c = this.b.containers[this.b.containers.length - 1];
    c.type = type;
    if (fixed) c.fixed = fixed;
  }

  /** A car parked at a local point, nose along local yaw (0 = local +X). */
  car(lx: number, lz: number, yaw: number, rand: Rand, kind?: string, paint?: number): void {
    const [x, z] = this.p.pt(lx, lz);
    const wyaw = yaw + (this.p.r * Math.PI) / 2;
    buildCar(this.b.batch, this.b.colliders, { x, z, yaw: wyaw, paint: paint ?? pick(rand, Object.values(CAR_PAINTS)), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.3, smashed: rand() < 0.3 ? 0.3 : 0, kind }, this.b.containers);
    this.b.life(LIFE.car, x, 0, z, Math.sin(wyaw), Math.cos(wyaw), 4.3, 1.8, spotHash(x, z, 41));
  }
}

/** Build the POI on its block. */
export function buildPoi(b: Builder, s: PoiSite, rand: Rand): void {
  const site = new Site(b, s);
  if (s.kind === 'gas') gasStation(site, rand);
  else policeStation(site, rand);
}

/**
 * A gas station on the road out of town: a forecourt with two pump islands under a canopy, the shop
 * (shelves, the till, a drinks cooler) and a one-bay workshop with a car on blocks.
 */
function gasStation(S: Site, rand: Rand): void {
  const p = S.p;
  // Forecourt and the drive out to the road.
  p.box(0x4a4a48, 0, 0, 10, LOT * 2, 0.03, 32, 'asphalt');
  for (let x = -16; x <= 16; x += 4) p.box(0xb0aa98, x, 0.03, 23.5, 0.12, 0.005, 2.5, 'asphalt');
  // Canopy on four columns over the pumps.
  const cz = 12;
  for (const [x, z] of [
    [-7, cz - 3.5],
    [7, cz - 3.5],
    [-7, cz + 3.5],
    [7, cz + 3.5],
  ] as const) p.box(0xd8d4c8, x, 0, z, 0.4, 4.6, 0.4, 'metal', true);
  p.box(0xe0dcd0, 0, 4.6, cz, 17, 0.25, 10, 'metal');
  p.box(0xa03a2a, 0, 4.85, cz, 17.2, 0.45, 10.2, 'metal');
  const [ax, az] = p.pt(-8.5, cz - 5);
  const [bx, bz] = p.pt(8.5, cz + 5);
  S.b.shelter(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), 4.6);
  // Pump islands, two pumps each, hoses hanging.
  for (const x of [-3.5, 3.5]) {
    p.box(0x8a8678, x, 0, cz, 1.1, 0.16, 6.5, 'concrete', true);
    for (const z of [cz - 1.8, cz + 1.8]) {
      p.box(0xd8d4c8, x, 0.16, z, 0.7, 1.7, 0.45, 'metal', true);
      p.box(0xa03a2a, x, 1.5, z, 0.72, 0.3, 0.47, 'metal');
      p.box(0x1a1a1a, x, 1.0, z, 0.5, 0.3, 0.47, 'glass');
      if (rand() < 0.4) p.rbox(0x1a1a1a, x + 0.5, 0.2, z + 0.4, 0.04, 0.04, 1.4, rand() * 3, 0, 0, 'rubber');
    }
  }
  // A car left at a pump, another by the shop.
  if (rand() < 0.7) S.car(-1.2, cz + (rand() < 0.5 ? -1.8 : 1.8), 0, rand);
  if (rand() < 0.5) S.car(-17, 0, Math.PI / 2, rand);
  // Price pylon by the road: a landmark from down the road.
  p.box(0x8a8678, 20, 0, 22, 0.35, 6.5, 0.35, 'metal', true);
  p.box(0xa03a2a, 20, 6.5, 22, 2.2, 1.6, 0.35, 'metal');
  p.box(0xe0dcd0, 20, 6.7, 22.2, 1.8, 1.0, 0.02, 'plaster');

  // The shop: x −14…2, z −14…−2, door and big windows to the forecourt.
  const H = 3.4;
  const x0 = -14;
  const x1 = 2;
  const z0 = -14;
  const z1 = -2;
  const brick = 0x8a8478;
  S.wallX(brick, x0, x1, z1, H, [
    { at: -4, w: 1.6, h: 2.2 },
    { at: -9.5, w: 5, h: 2.6, sill: 0.6 },
    { at: -0.8, w: 3, h: 2.6, sill: 0.6 },
  ]);
  S.paneX(-9.5, z1, 5, 0.6, 2.6);
  S.paneX(-0.8, z1, 3, 0.6, 2.6);
  S.doorX(-4, z1, { width: 1.6, style: 'glass' });
  S.wallX(brick, x0, x1, z0, H);
  S.wallZ(brick, z0, z1, x0, H);
  S.wallZ(brick, z0, z1, x1, H);
  S.roof(x0, z0, x1, z1, H, 0x9a968a);
  p.box(0xa03a2a, (x0 + x1) / 2, H - 0.9, z1 + 0.12, x1 - x0, 0.7, 0.05, 'plaster');
  // Shelves, the till by the door, the cooler on the back wall.
  for (const z of [-10.5, -7.5]) {
    F.shopShelf(p.at(-7, z), rand, 6, 'grocery', rand() < 0.5);
    S.retype('gasShelf');
  }
  F.shopCounter(p.at(-1, -4.6, 2), rand, 'grocery');
  S.retype('gasCounter');
  F.cooler(p.at(-12.5, z0 + 0.1), rand);
  F.cooler(p.at(-11.2, z0 + 0.1), rand);
  F.papers(p, rand, x0 + 1, z0 + 1, x1 - 1, z1 - 1, 6);

  // Workshop / car wash bay: x 6…18, z −16…−2, open to the forecourt.
  const wx0 = 6;
  const wx1 = 18;
  const wz0 = -16;
  const wz1 = -2;
  const WH = 4.4;
  S.wallX(0x7a7a74, wx0, wx1, wz1, WH, [{ at: 12, w: 5, h: 3.6 }], 'concrete');
  S.wallX(0x7a7a74, wx0, wx1, wz0, WH, [], 'concrete');
  S.wallZ(0x7a7a74, wz0, wz1, wx0, WH, [], 'concrete');
  S.wallZ(0x7a7a74, wz0, wz1, wx1, WH, [], 'concrete');
  S.roof(wx0, wz0, wx1, wz1, WH, 0x6a6862);
  S.car(12, -9, Math.PI / 2, rand);
  // Workbench with tools, tyres stacked.
  p.box(0x6a5a44, 16.8, 0, -12, 1.2, 0.9, 3, 'wood', true);
  S.container('garage', 16.6, -12);
  for (let k = 0; k < 4; k++) p.cyl(0x1a1a1a, 7.2, 0.12 + k * 0.24, -14.8, 0.35, 0.22, 'rubber');
  S.container('crate', 7.5, -4);
  p.box(0x6a5e4a, 7.5, 0, -4, 1, 0.8, 1, 'wood', true);
}

/**
 * A police station: a parking lot with patrol cars; the lobby and its reception desk, offices, the
 * locker room, a row of cells, the armory behind a locked steel door (its key is in a locker, its code on
 * a note in an office desk), a back room; beside it a garage with patrol cars and the SWAT van.
 */
function policeStation(S: Site, rand: Rand): void {
  const p = S.p;
  // Parking in front.
  p.box(0x4a4a48, 0, 0, 17, LOT * 2, 0.03, 18, 'asphalt');
  for (let x = -20; x <= 20; x += 3) p.box(0xd8d4c8, x, 0.03, 20, 0.1, 0.005, 4.5, 'asphalt');
  S.car(-14, 20, Math.PI / 2, rand, 'police');
  if (rand() < 0.7) S.car(-5, 20, Math.PI / 2, rand, 'police');
  if (rand() < 0.5) S.car(7, 20, -Math.PI / 2, rand);

  const H = 3.6;
  const X0 = -24;
  const X1 = 12;
  const Z0 = -20;
  const Z1 = 6;
  const brick = 0x7a6a5a;
  const inner = 0xb8b4a8;
  // Shell: front with the entrance and windows, the rest blank.
  S.wallX(brick, X0, X1, Z1, H, [
    { at: -2, w: 1.8, h: 2.3 },
    { at: -18, w: 3, h: 2.4, sill: 0.9 },
    { at: -12, w: 3, h: 2.4, sill: 0.9 },
    { at: 8, w: 3, h: 2.4, sill: 0.9 },
  ]);
  for (const x of [-18, -12, 8]) S.paneX(x, Z1, 3, 0.9, 2.4);
  S.doorX(-2, Z1, { width: 1.8, style: 'glass' });
  S.wallX(brick, X0, X1, Z0, H);
  S.wallZ(brick, Z0, Z1, X0, H);
  S.wallZ(brick, Z0, Z1, X1, H);
  S.roof(X0, Z0, X1, Z1, H, 0x8a8a84);
  // Sign band over the door: dark blue with a white stripe (no words, no emblems).
  p.box(0x1e2e4e, -2, H - 1.0, Z1 + 0.12, 7, 0.8, 0.06, 'plaster');
  p.box(0xe0dcd0, -2, H - 0.7, Z1 + 0.16, 6.6, 0.12, 0.02, 'plaster');

  // Lobby (x −8…4, z −2…6): the desk, benches.
  S.wallZ(inner, -2, Z1, -8, H, [{ at: 2, w: 1.0, h: 2.1 }]);
  S.doorZ(-8, 2);
  S.wallZ(inner, -2, Z1, 4, H, [{ at: 2, w: 1.0, h: 2.1 }]);
  S.doorZ(4, 2);
  p.box(0x5a4a3a, -2, 0, 0.4, 5, 1.1, 0.7, 'wood', true);
  p.box(0x8a8678, -2, 1.1, 0.4, 5.2, 0.05, 0.9, 'plaster');
  S.container('reception', -2, 0.2);
  F.bench(p.at(-6.5, 4.5, 2), rand);
  F.bench(p.at(2.5, 4.5, 2), rand);
  F.papers(p, rand, -7, -1, 3, 5, 6);
  // The corridor wall (z −2): way through from the lobby, doors to the offices' and locker room's backs not needed.
  S.wallX(inner, X0, X1, -2, H, [{ at: -2, w: 1.6, h: 2.3 }]);
  // Offices (x −24…−8, z −2…6): desks, filing cabinets; one desk keeps the armory code.
  const desks: [number, number][] = [
    [-21, 3.5],
    [-17, 3.5],
    [-13, 3.5],
    [-21, -0.5],
    [-15, -0.5],
  ];
  const codeDesk = Math.floor(spotHash(S.s.i, S.s.j, 3) * desks.length);
  desks.forEach(([x, z], k) => {
    F.desk(p.at(x, z, 2), rand, rand() < 0.4, rand() < 0.3);
    S.retype('policeDesk', k === codeDesk ? ['armoryNote'] : undefined);
    F.officeChair(p.at(x, z - 0.9), rand, rand() < 0.3);
  });
  F.filingCabinet(p.at(-10, 5.6, 2), rand, rand() < 0.5);
  F.filingCabinet(p.at(-23.6, 1, 1), rand);
  // Locker room (x 4…12, z −2…6): two rows of lockers; one has the armory key.
  const keyLocker = Math.floor(spotHash(S.s.j, S.s.i, 4) * 8);
  for (let k = 0; k < 8; k++) {
    const x = 5 + (k % 4) * 1.8;
    const z = k < 4 ? 5.4 : -1.4;
    p.box(0x5a6a7a, x, 0, z, 1.6, 2.0, 0.5, 'metal', true);
    for (let d = 0; d < 3; d++) p.box(0x4a5a6a, x - 0.53 + d * 0.53, 0.05, z + (k < 4 ? -0.26 : 0.26), 0.5, 1.9, 0.02, 'metal');
    S.container('policeLocker', x, z + (k < 4 ? -0.6 : 0.6), k === keyLocker ? ['armoryKey'] : undefined);
  }
  F.bench(p.at(8, 2, 0), rand);

  // Corridor (z −6…−2) to the back rooms.
  // Cells (x −24…−8, z −20…−6): three, barred fronts with the doors hanging open.
  for (let c = 0; c < 3; c++) {
    const cx0 = X0 + c * (16 / 3);
    const cx1 = cx0 + 16 / 3;
    if (c > 0) S.wallZ(inner, Z0, -6, cx0, H);
    for (let x = cx0 + 0.25; x < cx1 - 0.1; x += 0.22) {
      if (x > cx0 + 2.2 && x < cx0 + 3.2) continue;
      p.box(0x3a3a3a, x, 0, -6, 0.04, H - 0.4, 0.04, 'metal');
    }
    p.box(0x3a3a3a, (cx0 + cx1) / 2, H - 0.45, -6, cx1 - cx0, 0.08, 0.08, 'metal');
    p.solid((cx0 + cx0 + 2.2) / 2, -6, 2.2 - 0.25, 0.1, H);
    p.solid((cx0 + 3.2 + cx1) / 2, -6, cx1 - cx0 - 3.2, 0.1, H);
    // A cot, a bucket.
    p.box(0x5a5a52, cx0 + 1.4, 0, Z0 + 1.2, 2.0, 0.45, 0.8, 'metal', true);
    p.box(0x7a7a6a, cx0 + 1.4, 0.45, Z0 + 1.2, 1.9, 0.08, 0.75, 'rubber');
  }
  // Armory (x −8…2, z −20…−6), behind a locked steel door.
  S.wallZ(inner, Z0, -6, -8, H);
  S.wallZ(inner, Z0, -6, 2, H);
  S.wallX(0x5a5e62, -8, 2, -6, H, [{ at: -3, w: 1.0, h: 2.1 }], 'metal');
  S.doorX(-3, -6, { lock: 'armory' });
  for (const [x, z, r] of [
    [-7.4, -12, 1],
    [1.4, -12, 3],
    [-3, -19.4, 0],
  ] as const) {
    p.at(x, z, r).box(0x3a3e40, 0, 0, 0.3, 3.2, 2.0, 0.6, 'metal', true);
    S.container('armory', x + (r === 1 ? 0.8 : r === 3 ? -0.8 : 0), z + (r === 0 ? 0.8 : 0));
  }
  // Back room (x 2…12, z −20…−6): break room, boxes of files.
  S.wallX(inner, 2, X1, -6, H, [{ at: 7, w: 1.0, h: 2.1 }]);
  S.doorX(7, -6);
  F.fridge(p.at(11.4, -10, 3), rand, rand() < 0.5);
  F.diningTable(p.at(7, -13), rand, 4, rand() < 0.4);
  F.boxes(p.at(4, Z0, 0), rand, 3);
  F.waterCooler(p.at(3, -6.6, 2), rand);
  // Notes on what happened, on the reception desk and in the break room.
  F.notes(p.at(-2, 0.2, 0), rand, 2);
  F.notes(p.at(7, -15, 0), rand, 1);

  // Garage beside it (x 14…25, z −20…2), open to the lot: two patrol cars and the SWAT van.
  const GX0 = 14;
  const GX1 = LOT;
  const GZ0 = -20;
  const GZ1 = 2;
  const GH = 4.6;
  S.wallX(0x6a6a64, GX0, GX1, GZ0, GH, [], 'concrete');
  S.wallZ(0x6a6a64, GZ0, GZ1, GX0, GH, [], 'concrete');
  S.wallZ(0x6a6a64, GZ0, GZ1, GX1, GH, [], 'concrete');
  S.roof(GX0, GZ0, GX1, GZ1, GH, 0x5a5a56);
  S.car((GX0 + GX1) / 2, -4, Math.PI / 2, rand, 'police');
  S.car((GX0 + GX1) / 2 - 2.8, -14, Math.PI / 2, rand, 'van', 0x1e2632);
  if (rand() < 0.6) S.car((GX0 + GX1) / 2 + 2.6, -14, Math.PI / 2, rand, 'police');
  S.container('garage', GX1 - 0.8, -18);
  p.box(0x6a5a44, GX1 - 0.8, 0, -18, 1.2, 0.9, 2.4, 'wood', true);
}
