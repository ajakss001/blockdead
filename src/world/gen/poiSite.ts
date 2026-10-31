import type { ItemId } from '../../data/items';
import type { ContainerType } from '../../data/loot';
import type { Surface } from '../../render/look/surfaces';
import { buildCar, CAR_PAINTS } from '../props/car';
import { Place, type Quarter } from './furniture';
import { CHUNK } from './layout';
import { LIFE, spotHash } from './lifeKinds';
import { type Builder, type DoorOptions, pick, type Rand } from './pieces';
import type { PoiSite } from './poi';

/**
 * POI templates. Each builds its block in a frame turned to face its road: local +Z points at the road,
 * the lot spans x, z ∈ [−LOT, LOT] around the block's centre. Walls are solid boxes with holes for doors
 * and windows; every building registers its roof (shelter) so inside counts as indoors.
 */
export const LOT = CHUNK / 2 - 5.8;
const WALL = 0.2;

interface Hole {
  /** Centre along the wall, width, top; a window also has a sill. */
  at: number;
  w: number;
  h: number;
  sill?: number;
  glass?: boolean;
}

export class Site {
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

  /** A searchable container at a local point (y: the floor it stands on), of a type, maybe with things always in it. */
  container(type: ContainerType, lx: number, lz: number, fixed?: ItemId[], y = 0): void {
    const [x, z] = this.p.pt(lx, lz);
    this.b.container(type, x, z, y);
    const spot = this.b.containers[this.b.containers.length - 1];
    if (!y) delete spot.y;
    if (fixed) spot.fixed = fixed;
  }

  /** A collider over a local rectangle from y0 to y1 (on an upper floor). */
  solid(lx: number, lz: number, w: number, d: number, y0: number, y1: number): void {
    const [ax, az] = this.p.pt(lx - w / 2, lz - d / 2);
    const [bx, bz] = this.p.pt(lx + w / 2, lz + d / 2);
    this.b.solid(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), y0, y1);
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
