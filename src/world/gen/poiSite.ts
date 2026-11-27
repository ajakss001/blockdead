import type { ItemId } from '../../data/items';
import type { ContainerType } from '../../data/loot';
import type { Surface } from '../../render/look/surfaces';
import { buildCar, CAR_PAINTS } from '../props/car';
import { Place, type Quarter } from './furniture';
import { CHUNK } from './layout';
import { LIFE, spotHash } from './lifeKinds';
import { type Builder, type DoorOptions, pick, type Rand } from './pieces';
import { type PoiSite, siteToWorld } from './poi';
import type { Picked, SceneState } from './scenarios';

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
  /** Half the lot across the front (local X) and deep (local Z), m, inside its edge strip. */
  readonly lotX: number;
  readonly lotZ: number;
  /** Spans several chunks: long pieces are cut so each chunk gets its own. */
  readonly big: boolean;
  /** What happened here (scenarios.ts): the templates look at it too (blown pumps, a breached fence). */
  picked: Picked[] = [];
  readonly scenes = new Map<string, SceneState>();
  constructor(
    readonly b: Builder,
    readonly s: PoiSite,
  ) {
    const [cx, cz] = siteToWorld(s, 0, 0);
    this.p = new Place(b, cx, 0, cz, s.r as Quarter);
    const bw = s.bw ?? 1;
    const bd = s.bd ?? 1;
    this.big = bw > 1 || bd > 1;
    this.lotX = ((s.r & 1 ? bd : bw) * CHUNK) / 2 - 5.8;
    this.lotZ = ((s.r & 1 ? bw : bd) * CHUNK) / 2 - 5.8;
  }

  /** This place got a scenario. */
  has(id: string): boolean {
    return this.scenes.has(id);
  }

  /** In this chunk's part (big places): a local point. */
  here(lx: number, lz: number): boolean {
    const [x, z] = this.p.pt(lx, lz);
    return this.b.inClip(x, z);
  }

  /**
   * A flat slab over a local rectangle (runways, aprons, yards), cut in squares of at most `cell` m so every
   * chunk of a big place gets its own pieces.
   */
  slab(color: number, x0: number, z0: number, x1: number, z1: number, y: number, h: number, surface: Surface = 'asphalt', cell = 16): void {
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell));
    const nz = Math.max(1, Math.ceil((z1 - z0) / cell));
    const sx = (x1 - x0) / nx;
    const sz = (z1 - z0) / nz;
    for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) this.p.box(color, x0 + (a + 0.5) * sx, y, z0 + (c + 0.5) * sz, sx, h, sz, surface);
  }

  /** A wall along local X at z, from x0 to x1, h high, with holes. */
  wallX(color: number, x0: number, x1: number, z: number, h: number, holes: Hole[] = [], surface: Surface = 'plaster'): void {
    this.wall(x0, x1, h, holes, this.cut((a, b, y0, y1) => this.p.box(color, (a + b) / 2, y0, z, b - a, y1 - y0, WALL, surface, true)));
  }

  /** A wall along local Z at x, from z0 to z1. */
  wallZ(color: number, z0: number, z1: number, x: number, h: number, holes: Hole[] = [], surface: Surface = 'plaster'): void {
    this.wall(z0, z1, h, holes, this.cut((a, b, y0, y1) => this.p.box(color, x, y0, (a + b) / 2, WALL, y1 - y0, b - a, surface, true)));
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

  /** Wall pieces of a big place no longer than 16 m (each lands in the chunk of its middle). */
  private cut(seg: (a: number, b: number, y0: number, y1: number) => void): (a: number, b: number, y0: number, y1: number) => void {
    if (!this.big) return seg;
    return (a, b, y0, y1) => {
      const n = Math.max(1, Math.ceil((b - a) / 16));
      for (let k = 0; k < n; k++) seg(a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n, y0, y1);
    };
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
    if (this.big) {
      this.slab(floor, x0, z0, x1, z1, 0, 0.04, 'tile');
      this.slab(ceiling, x0, z0, x1, z1, h - 0.05, 0.05, 'plaster');
      this.slab(roofColor, x0 - 0.2, z0 - 0.2, x1 + 0.2, z1 + 0.2, h, 0.25, 'roof');
    } else {
      this.p.box(floor, (x0 + x1) / 2, 0, (z0 + z1) / 2, w, 0.04, d, 'tile');
      this.p.box(ceiling, (x0 + x1) / 2, h - 0.05, (z0 + z1) / 2, w, 0.05, d, 'plaster');
      this.p.box(roofColor, (x0 + x1) / 2, h, (z0 + z1) / 2, w + 0.4, 0.25, d + 0.4, 'roof');
    }
    const [ax, az] = this.p.pt(x0, z0);
    const [bx, bz] = this.p.pt(x1, z1);
    this.b.shelter(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), h);
  }

  /** A searchable container at a local point (y: the floor it stands on), of a type, maybe with things always in it. */
  container(type: ContainerType, lx: number, lz: number, fixed?: ItemId[], y = 0): void {
    const [x, z] = this.p.pt(lx, lz);
    this.b.container(type, x, z, y);
    const spot = this.b.lastContainer;
    if (!spot) return;
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
    const c = this.b.lastContainer;
    if (!c) return;
    c.type = type;
    if (fixed) c.fixed = fixed;
  }

  /** A car parked at a local point, nose along local yaw (0 = local +X). */
  car(lx: number, lz: number, yaw: number, rand: Rand, kind?: string, paint?: number): void {
    const [x, z] = this.p.pt(lx, lz);
    // (Rolled even when not ours: every chunk of a big place draws the same random numbers.)
    if (!this.b.inClip(x, z)) {
      for (let k = paint === undefined ? 4 : 3; k > 0; k--) rand();
      return;
    }
    const wyaw = yaw + (this.p.r * Math.PI) / 2;
    if (buildCar(this.b.batch, this.b.colliders, { x, z, yaw: wyaw, paint: paint ?? pick(rand, Object.values(CAR_PAINTS)), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.3, smashed: rand() < 0.3 ? 0.3 : 0, kind }, this.b.containers)) {
      this.b.life(LIFE.car, x, 0, z, Math.sin(wyaw), Math.cos(wyaw), 4.3, 1.8, spotHash(x, z, 41));
    }
  }
}
