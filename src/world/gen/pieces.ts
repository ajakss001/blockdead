import { Box3, BoxGeometry, type BufferGeometry, ConeGeometry, CylinderGeometry, Euler, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { gableRoof } from '../../render/lowpoly';
import type { Surface } from '../../render/look/surfaces';
import type { StaticBatch } from '../../render/StaticBatch';
import type { ItemId } from '../../data/items';
import type { ContainerType } from '../../data/loot';
import type { ColliderSink } from '../CollisionWorld';
import { pickModel } from '../models';
import { modelLibrary, placeModel } from '../props/car';
import type { GlbModelId, GlbPlacement } from '../worldModels';

/** A searchable spot in the world (world XZ of its front face, Y of its floor). */
/**
 * Where a container can be searched: a box fitted to the object (≤ 5 cm over), world space — centre,
 * half sizes, turn about Y. The crosshair's ray must hit it.
 */
export type SearchBox = [cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, yaw: number];

/** The fitted box of an axis-aligned world AABB, padded 3 cm. */
export function aabbBox(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, pad = 0.03): SearchBox {
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2 + pad, (maxY - minY) / 2 + pad, (maxZ - minZ) / 2 + pad, 0];
}

export interface ContainerSpot {
  type: ContainerType;
  x: number;
  z: number;
  y?: number;
  /** The search zone (absent: a default box round the spot). */
  box?: SearchBox;
  /** Explicit id (interior floors: stable whichever floors are furnished). */
  id?: number;
  /** Always in it, on top of the rolled loot (a key, a note). */
  fixed?: ItemId[];
}

/** An interior door: hinge position and closed-leaf yaw in world space (leaf extends along +X when yaw = 0). */
export type DoorStyle = 'wood' | 'glass' | 'lab' | 'barricaded';

export interface DoorSpot {
  hx: number;
  hz: number;
  y: number;
  yaw: number;
  /** +1/−1: which way it swings open. */
  swing: number;
  /** Nailed shut from the other side. */
  barricaded: boolean;
  /** Leaf width = the opening's width, m (default 1.0). */
  width?: number;
  style?: DoorStyle;
  /** Height of the opening the leaf fills, m (default 2.1). */
  height?: number;
  /** Starts open (left ajar by whoever ran). */
  open?: boolean;
  /** Locked (see DoorOptions.lock). */
  lock?: string;
  /** Double doors: offset to the other leaf in the same list; both swing together. */
  pair?: number;
}

export interface DoorOptions {
  width?: number;
  style?: DoorStyle;
  open?: boolean;
  pair?: number;
  /** Height of the opening the leaf fills, m (default 2.1). */
  height?: number;
  /** Locked: which lock (see systems/Interaction LOCKS) — a key or a code opens it. */
  lock?: string;
}

export { PAL, pick, type Rand } from './palette';
import { PAL, pick, type Rand } from './palette';
import * as F from './furniture';
import { LIFE, spotHash, TREE } from './lifeKinds';
import { Place, SHOP_KINDS, SHOP_SIGN } from './furniture';

const WALL_T = 0.2;
const DOOR_W = 1.0;
const DOOR_H = 2.1;

/**
 * Thin layer over StaticBatch + colliders, with an optional 180° placement frame: a house is
 * always authored with its front towards +Z and rotated about its center if it faces the other way.
 * (A rotation keeps boxes axis-aligned and faces correctly wound — a mirror would not.)
 */
export class Builder {
  readonly box = new BoxGeometry(1, 1, 1);
  readonly cyl8 = new CylinderGeometry(1, 1, 1, 8);
  readonly cyl5 = new CylinderGeometry(0.75, 1, 1, 5);
  readonly ico = new IcosahedronGeometry(1, 0);
  readonly cone6 = new ConeGeometry(1, 1, 6);
  readonly containers: ContainerSpot[] = [];
  readonly doors: DoorSpot[] = [];
  /** Roofed footprints in world space: [minX, minZ, maxX, maxZ, roofY, …] (see systems/Climate). */
  readonly shelters: number[] = [];
  /** World-life spots, LIFE_STRIDE each: kind, x, y, z, normal x, normal z, w, h, seed, tag (see world/WorldLife). */
  readonly ambient: number[] = [];
  private idBase: number | null = null;
  private idN = 0;
  private flip: { cx: number; cz: number } | null = null;
  private readonly m = new Matrix4();
  private readonly flipM = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3();

  constructor(
    readonly batch: StaticBatch,
    readonly colliders: ColliderSink,
  ) {}

  /** Author in a frame rotated 180° about (cx, cz) until endFrame(). */
  beginFlip(cx: number, cz: number): void {
    this.flip = { cx, cz };
    this.flipM.makeTranslation(cx, 0, cz).multiply(new Matrix4().makeRotationY(Math.PI)).multiply(new Matrix4().makeTranslation(-cx, 0, -cz));
  }

  endFrame(): void {
    this.flip = null;
  }

  /** Register a roofed footprint (world coordinates): indoors for the climate. */
  shelter(x0: number, z0: number, x1: number, z1: number, roofY: number): void {
    this.shelters.push(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), roofY);
  }

  /**
   * Register a searchable container at a point in the current frame. `box`: its search zone as an AABB in
   * the current frame [minX, minY, minZ, maxX, maxY, maxZ] (a Place passes what it drew).
   */
  container(type: ContainerType, x: number, z: number, y = 0, box?: number[]): void {
    // No box given: what was drawn since the last container, near the spot (the piece just built).
    if (!box) box = this.drawnNear(x, z, y);
    this.logMark = this.log.length;
    this.lastContainer = null;
    if (!this.inClip(this.wx(x), this.wz(z))) return;
    let zone: SearchBox | undefined;
    if (box && box[0] <= box[3]) {
      const [x0, x1] = this.flip ? [2 * this.flip.cx - box[3], 2 * this.flip.cx - box[0]] : [box[0], box[3]];
      const [z0, z1] = this.flip ? [2 * this.flip.cz - box[5], 2 * this.flip.cz - box[2]] : [box[2], box[5]];
      zone = aabbBox(x0, box[1], z0, x1, box[4], z1);
    }
    const spot: ContainerSpot = { type, x: this.wx(x), z: this.wz(z), y, ...(zone ? { box: zone } : {}) };
    if (this.idBase !== null) spot.id = this.idBase + this.idN++;
    this.containers.push(spot);
    this.lastContainer = spot;
  }

  /**
   * A big place spans several chunks and each chunk builds only its part: while set (world x0, z0, x1, z1),
   * anything whose middle falls outside is dropped — geometry, colliders, containers, doors, life spots.
   */
  clip: [number, number, number, number] | null = null;

  inClip(x: number, z: number): boolean {
    const c = this.clip;
    return !c || (x >= c[0] && x < c[2] && z >= c[1] && z < c[3]);
  }

  /** The container registered by the last container() call (null: it fell outside the clip). */
  lastContainer: ContainerSpot | null = null;

  /** Bounds of every block / template added (frame AABBs, 6 numbers each), and where the last container was. */
  private readonly log: number[] = [];
  private logMark = 0;

  private logged(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.log.push(x0, y0, z0, x1, y1, z1);
    this.track?.(x0, y0, z0, x1, y1, z1);
  }

  /** Records a frame AABB in the draw log (used by Place.model so Builder.drawnNear / Site.container fit 3D models). */
  logBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.logged(x0, y0, z0, x1, y1, z1);
  }

  /** Union of what was drawn since the last container whose middle is within 1.8 m of (x, z) and at the floor y. */
  drawnNear(x: number, z: number, y: number): number[] | undefined {
    const out = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    const L = this.log;
    for (let k = this.logMark; k < L.length; k += 6) {
      const cx = (L[k] + L[k + 3]) / 2;
      const cz = (L[k + 2] + L[k + 5]) / 2;
      if (Math.hypot(cx - x, cz - z) > 1.8 || L[k + 4] < y - 0.05 || L[k + 1] > y + 2.6) continue;
      for (let a = 0; a < 3; a++) {
        out[a] = Math.min(out[a], L[k + a]);
        out[a + 3] = Math.max(out[a + 3], L[k + a + 3]);
      }
    }
    return out[0] <= out[3] ? out : undefined;
  }

  /**
   * While set, every block / template added reports its bounds here (in the current frame, before the
   * flip): a Place collects what a piece of furniture drew, for its search box.
   */
  track: ((minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number) => void) | null = null;

  /** Containers from here on get ids base, base + 1, … (null: the caller numbers them). */
  setIdBase(base: number | null): void {
    this.idBase = base;
    this.idN = 0;
  }

  /** World-life spot in the current frame (normal turns with the frame). */
  life(kind: number, x: number, y: number, z: number, nx: number, nz: number, w: number, h: number, seed: number, tag = 0): void {
    const s = this.flip ? -1 : 1;
    if (!this.inClip(this.wx(x), this.wz(z))) return;
    this.ambient.push(kind, this.wx(x), y, this.wz(z), nx * s, nz * s, w, h, seed, tag);
  }

  /** Streamed world GLB placement in the current frame (instanced & distance-culled via GlbPropPool). */
  glb(id: GlbModelId, x: number, y: number, z: number, yaw = 0, opts?: Omit<GlbPlacement, 'id' | 'x' | 'y' | 'z' | 'yaw'>): void {
    const wx = this.wx(x);
    const wz = this.wz(z);
    if (!this.inClip(wx, wz)) return;
    this.batch.glbs.push({
      id,
      x: wx,
      y,
      z: wz,
      yaw: this.flip ? yaw + Math.PI : yaw,
      ...opts,
    });
  }

  /** Register a door by its hinge and closed yaw in the current frame. */
  door(hx: number, hz: number, y: number, yaw: number, swing: number, barricaded = false, opts: DoorOptions = {}): void {
    // The leaf fills the opening: 1 × 2.1 m unless told otherwise (no slits round a closed door).
    if (!this.inClip(this.wx(hx), this.wz(hz))) return;
    this.doors.push({ hx: this.wx(hx), hz: this.wz(hz), y, yaw: this.flip ? yaw + Math.PI : yaw, swing, barricaded, width: 1.0, height: 2.1, ...opts });
  }

  /** Box that only blocks within its own vertical extent (storeys, railings, lintels). */
  blockY(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, surface: Surface = 'plaster'): void {
    this.block(color, x, y, z, sx, sy, sz, surface, false);
    this.solid(x, z, x + sx, z + sz, y, y + sy);
  }

  /** World X of a local X (for door positions etc.). */
  wx(x: number): number {
    return this.flip ? 2 * this.flip.cx - x : x;
  }

  wz(z: number): number {
    return this.flip ? 2 * this.flip.cz - z : z;
  }

  /** Axis-aligned box by min corner and size (in the current frame). */
  block(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, surface: Surface = 'plaster', solid = false): void {
    let x0 = x;
    let z0 = z;
    if (this.flip) {
      x0 = 2 * this.flip.cx - (x + sx);
      z0 = 2 * this.flip.cz - (z + sz);
    }
    if (!this.inClip(x0 + sx / 2, z0 + sz / 2)) return;
    this.logged(x, y, z, x + sx, y + sy, z + sz);
    this.p.set(x0 + sx / 2, y + sy / 2, z0 + sz / 2);
    this.s.set(sx, sy, sz);
    this.batch.add(this.box, color, this.m.compose(this.p, this.q.identity(), this.s), surface);
    // Over the block's own height: low ones (crates, sandbags, tables) can be jumped onto.
    if (solid) this.colliders.addBox(x0, z0, x0 + sx, z0 + sz, y, y + sy, surface === 'windowGlass' || surface === 'glass');
  }

  /** Arbitrary template with a local transform (in the current frame). */
  geo(template: BufferGeometry, color: number, matrix: Matrix4, surface: Surface): void {
    if (!template.boundingBox) template.computeBoundingBox();
    _bb.copy(template.boundingBox!).applyMatrix4(matrix);
    if (!this.inClip(this.wx((_bb.min.x + _bb.max.x) / 2), this.wz((_bb.min.z + _bb.max.z) / 2))) return;
    this.logged(_bb.min.x, _bb.min.y, _bb.min.z, _bb.max.x, _bb.max.y, _bb.max.z);
    if (this.flip) matrix = this.m.copy(this.flipM).multiply(matrix);
    this.batch.add(template, color, matrix, surface);
  }

  /** Transform a frame-local matrix into world space (applies `beginFlip` when active). */
  worldMatrix(matrix: Matrix4, out = this.m): Matrix4 {
    return this.flip ? out.copy(this.flipM).multiply(matrix) : out.copy(matrix);
  }

  /** Collider in the current frame (optionally limited to a vertical range). */
  solid(x0: number, z0: number, x1: number, z1: number, y0?: number, y1?: number): void {
    if (!this.inClip(this.wx((x0 + x1) / 2), this.wz((z0 + z1) / 2))) return;
    if (this.flip) {
      const a = 2 * this.flip.cx - x1;
      const b = 2 * this.flip.cz - z1;
      this.colliders.addBox(a, b, a + (x1 - x0), b + (z1 - z0), y0, y1);
    } else {
      this.colliders.addBox(x0, z0, x1, z1, y0, y1);
    }
  }

  dispose(): void {
    this.box.dispose();
    this.cyl8.dispose();
    this.cyl5.dispose();
    this.ico.dispose();
    this.cone6.dispose();
  }
}

const _m = new Matrix4();
const _bb = new Box3();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

export interface HouseSpec {
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** true: front wall faces +Z; false: faces −Z. */
  frontPlusZ: boolean;
  rand: Rand;
}

export interface HouseResult {
  /** World X of the front door center and world Z of the front wall's outer face. */
  doorX: number;
  frontZ: number;
}

/** Wall segment along X with outer siding and inner wallpaper; `outerAtPlusZ` picks the side. */
function wallAlongX(b: Builder, siding: number, paper: number, xa: number, xb: number, z: number, outerAtPlusZ: boolean, y = 0, h = 2.7, solid = true): void {
  const half = WALL_T / 2;
  b.block(siding, xa, y, z + (outerAtPlusZ ? half : 0), xb - xa, h, half);
  b.block(paper, xa, y, z + (outerAtPlusZ ? 0 : half), xb - xa, h, half);
  // Full height; a strip above an opening (y > 0) is solid only over its own height (a lintel: the head
  // stops under it, the doorway stays open).
  if (solid) b.solid(xa, z, xb, z + WALL_T);
  else if (y > 0) b.solid(xa, z, xb, z + WALL_T, y, y + h);
}

function wallAlongZ(b: Builder, siding: number, paper: number, x: number, za: number, zb: number, outerAtPlusX: boolean, h = 2.7): void {
  const half = WALL_T / 2;
  b.block(siding, x + (outerAtPlusX ? half : 0), 0, za, half, h, zb - za);
  b.block(paper, x + (outerAtPlusX ? 0 : half), 0, za, half, h, zb - za);
  b.solid(x, za, x + WALL_T, zb);
}

/** Interior partition along Z with doorways at the given Z centers (both faces wallpaper). */
function partitionZ(b: Builder, paper: number, x: number, za: number, zb: number, doors: number[], h: number): void {
  let from = za;
  for (const dz of doors) {
    const d0 = dz - 0.45;
    b.block(paper, x, 0, from, 0.12, h, d0 - from, 'plaster', true);
    b.block(paper, x, DOOR_H, d0, 0.12, h - DOOR_H, 0.9, 'plaster', true);
    from = dz + 0.45;
  }
  b.block(paper, x, 0, from, 0.12, h, zb - from, 'plaster', true);
}

function partitionX(b: Builder, paper: number, xa: number, xb: number, z: number, doorX: number, h: number): void {
  const d0 = doorX - 0.45;
  const d1 = doorX + 0.45;
  b.block(paper, xa, 0, z, d0 - xa, h, 0.12, 'plaster', true);
  b.block(paper, d1, 0, z, xb - d1, h, 0.12, 'plaster', true);
  b.block(paper, d0, DOOR_H, z, 0.9, h - DOOR_H, 0.12, 'plaster', true);
}

/** Window on a wall facing ±Z (glass proud of the trim, both slightly outside the siding). */
function windowZ(b: Builder, cx: number, faceZ: number, outward: number, width = 1.2): void {
  const trimZ = outward > 0 ? faceZ : faceZ - 0.02;
  const glassZ = outward > 0 ? faceZ : faceZ - 0.03;
  b.block(PAL.trim, cx - width / 2 - 0.08, 0.92, trimZ, width + 0.16, 1.16, 0.02, 'plaster');
  b.block(PAL.window, cx - width / 2, 1.0, glassZ, width, 1.0, 0.03, 'glass');
}

function windowX(b: Builder, cz: number, faceX: number, outward: number, width = 1.1): void {
  const trimX = outward > 0 ? faceX : faceX - 0.02;
  const glassX = outward > 0 ? faceX : faceX - 0.03;
  b.block(PAL.trim, trimX, 0.92, cz - width / 2 - 0.08, 0.02, 1.16, width + 0.16, 'plaster');
  b.block(PAL.window, glassX, 1.0, cz - width / 2, 0.03, 1.0, width, 'glass');
}

/**
 * Single-storey 90s house with a real floor plan: living room (front door) on the left,
 * kitchen at the back right, bedroom at the front right, doorways between them, furniture
 * with colliders. Authored front-at-+Z, rotated if it faces the other way.
 */
export function buildHouse(b: Builder, s: HouseSpec): HouseResult {
  const { x0, z0, w, d, rand } = s;
  const x1 = x0 + w;
  const z1 = z0 + d;
  const h = 2.7;
  const siding = pick(rand, PAL.sidings);
  const paperA = pick(rand, PAL.wallpapers);
  const paperB = pick(rand, PAL.wallpapers);
  const roof = pick(rand, PAL.roofs);
  b.shelter(x0, z0, x1, z1, h);
  if (!s.frontPlusZ) b.beginFlip(x0 + w / 2, z0 + d / 2);

  const xp = x0 + Math.round(w * 0.5 * 10) / 10;
  const zp = z0 + d * 0.5;
  const doorX = x0 + w * (0.22 + rand() * 0.08);

  // Shell.
  wallAlongX(b, siding, paperA, x0, doorX - DOOR_W / 2, z1 - WALL_T, true);
  wallAlongX(b, siding, paperA, doorX + DOOR_W / 2, x1, z1 - WALL_T, true);
  wallAlongX(b, siding, paperA, doorX - DOOR_W / 2, doorX + DOOR_W / 2, z1 - WALL_T, true, DOOR_H, h - DOOR_H, false);
  wallAlongX(b, siding, paperB, x0, x1, z0, false);
  wallAlongZ(b, siding, paperA, x0, z0 + WALL_T, z1 - WALL_T, false);
  wallAlongZ(b, siding, paperB, x1 - WALL_T, z0 + WALL_T, z1 - WALL_T, true);
  // Ivy climbing the old walls from a corner (the front one away from the door).
  for (const [k, nx, nz] of [
    [0, 0, 1],
    [1, 0, -1],
    [2, -1, 0],
    [3, 1, 0],
  ] as const) {
    if (spotHash(x0 + k, z0, 11) > 0.32) continue;
    const iw = 1.2 + spotHash(x0, z0 + k, 12) * 2.2;
    const ih = 1.0 + spotHash(x0 + k, z0 + k, 13) * 1.5;
    const far = k === 0 || spotHash(x0, z0, 14 + k) < 0.5;
    if (nz) {
      const x = far ? x1 - iw / 2 - 0.05 : x0 + iw / 2 + 0.05;
      b.life(LIFE.ivy, x, 0, nz > 0 ? z1 + 0.02 : z0 - 0.02, 0, nz, iw, ih, spotHash(x, z0, 15));
    } else {
      const z = far ? z1 - iw / 2 - 0.05 : z0 + iw / 2 + 0.05;
      b.life(LIFE.ivy, nx > 0 ? x1 + 0.02 : x0 - 0.02, 0, z, nx, 0, iw, ih, spotHash(x0, z, 15));
    }
  }
  // Door step and frame.
  b.block(PAL.path, doorX - 0.7, 0, z1, 1.4, 0.06, 0.6, 'asphalt');
  b.block(PAL.trim, doorX - DOOR_W / 2 - 0.08, 0, z1, 0.08, DOOR_H + 0.08, 0.03);
  b.block(PAL.trim, doorX + DOOR_W / 2, 0, z1, 0.08, DOOR_H + 0.08, 0.03);
  b.block(PAL.trim, doorX - DOOR_W / 2 - 0.08, DOOR_H, z1, DOOR_W + 0.16, 0.08, 0.03);
  const doorRoll = rand();
  b.door(doorX - DOOR_W / 2, z1 - WALL_T / 2, 0, 0, 1, false, { width: DOOR_W, height: DOOR_H, style: 'wood', open: doorRoll > 0.55 });

  // Rooms.
  // Living room opens into the kitchen (back) and the bedroom (front).
  partitionZ(b, paperA, xp, z0 + WALL_T, z1 - WALL_T, [z0 + d * 0.25, z0 + d * 0.75], h);
  const bedDoorX = xp + 0.12 + 0.9 + rand() * 0.6;
  partitionX(b, paperB, xp + 0.12, x1 - WALL_T, zp, bedDoorX, h);

  // Windows: bedroom front, kitchen back, living room and bedroom sides.
  windowZ(b, x0 + w * 0.76, z1, 1);
  windowZ(b, x0 + w * 0.75, z0, -1);
  windowX(b, z0 + d * 0.55, x0, -1);
  windowX(b, z0 + d * 0.75, x1, 1);

  // Floor, ceiling.
  b.block(PAL.floor, x0 + WALL_T, 0, z0 + WALL_T, w - 2 * WALL_T, 0.04, d - 2 * WALL_T, 'wood');
  b.block(PAL.ceiling, x0, h - 0.05, z0, w, 0.05, d, 'plaster', true);

  // Who lived here and how they left: still at home, fled in a hurry, or the house was ransacked.
  const roll = rand();
  const fled = roll >= 0.4 && roll < 0.75;
  const messy = roll >= 0.75;
  const open = () => messy || (fled && rand() < 0.6);
  // A leak dripping in the living room, the kitchen tap, a phone now and then, flies in an abandoned house.
  if (spotHash(x0, z0, 81) < 0.35) b.life(LIFE.drip, x0 + 1.6 + spotHash(x0, z0, 82) * Math.max(0.1, xp - x0 - 2), h - 0.05, z0 + d * (0.35 + spotHash(x0, z0, 83) * 0.3), 0, 0, 0, h - 0.09, spotHash(x0, z0, 84));
  const sinkX = (xp + 0.4 + x1 - WALL_T - 1.05) / 2;
  // Every sink can be drunk from while the city has water (tag 1: quiet); some drip.
  b.life(LIFE.tap, sinkX, 1.0, z0 + WALL_T + 0.3, 0, 1, 0, 0, 0, 1);
  if (spotHash(x0, z0, 85) < 0.4) b.life(LIFE.tap, sinkX, 1.0, z0 + WALL_T + 0.3, 0, 1, 0, 0, spotHash(x0, z0, 86));
  if (spotHash(x0, z0, 87) < 0.06) b.life(LIFE.phone, x0 + WALL_T + 1.05, 0.5, z0 + d * 0.3 + 1.0, 0, 0, 0, 0, spotHash(x0, z0, 88));
  if ((messy || fled) && spotHash(x0, z0, 89) < 0.3) b.life(LIFE.flies, sinkX, 1.1, z0 + WALL_T + 0.6, 0, 0, 0, 0, spotHash(x0, z0, 90));

  // Living room: sofa against the side wall, coffee table, painting, TV on the back wall.
  const sz = z0 + d * 0.3;
  const sofaP = new Place(b, x0 + WALL_T, 0, sz + 1.0, 1);
  F.sofa(sofaP, rand, 2.0, messy);
  F.coffeeTable(sofaP.at(0, 1.25), rand, messy && rand() < 0.6);
  F.painting(sofaP, rand, 1.55, messy && rand() < 0.4);
  F.bookcase(new Place(b, xp, 0, z0 + d * 0.5, 3), rand, messy);
  // TV on a stand against the back wall (kept clear of the doorways on the partition).
  F.tvStand(new Place(b, x0 + 1.5, 0, z0 + WALL_T, 0), rand, messy);

  // Kitchen: counter along the back wall, fridge in the corner, small table.
  const kLen = Math.max(1.5, x1 - WALL_T - 1.05 - (xp + 0.4));
  F.kitchenRun(new Place(b, xp + 0.4 + kLen / 2, 0, z0 + WALL_T, 0), rand, kLen, messy);
  F.fridge(new Place(b, x1 - WALL_T - 0.45, 0, z0 + WALL_T, 0), rand, open());
  F.diningTable(new Place(b, xp + 1.9, 0, zp - 1.35, 1), rand, 2, messy);
  if (!messy && rand() < 0.1) {
    // A battery radio spot (audio only, no procedural box).
    b.life(3, xp + 0.95, 1.0, z0 + WALL_T + 0.15, 0, 1, 0, 0, rand());
  }

  // Bedroom: bed along the side wall (headboard at the partition), wardrobe against the front wall.
  const bedX = x1 - WALL_T - 0.96;
  F.bed(new Place(b, bedX, 0, zp + 0.08, 0), rand, 1.45, messy);
  F.nightstand(new Place(b, bedX - 1.3, 0, zp + 0.08, 0), rand, open());
  F.wardrobe(new Place(b, xp + 1.8, 0, z1 - WALL_T, 2), rand, open());

  // Leaving: luggage and boxes by the front door.
  const hall = new Place(b, doorX, 0, z1 - WALL_T, 2);
  if (fled) {
    F.suitcase(hall.at(-0.9, 1.0, Math.floor(rand() * 4)), rand, rand() < 0.4);
    if (xp - 0.75 > doorX + 1.25 && rand() < 0.4) F.boxes(new Place(b, xp - 0.75, 0, z1 - WALL_T, 2), rand, 2);
  }

  // Gable roof with overhang, ridge along X.
  const roofGeo = gableRoof(w + 0.5, d + 0.7, 1.4 + d * 0.06);
  b.life(LIFE.perch, x0 + w / 2, h + 1.4 + d * 0.06, z0 + d / 2, 1, 0, w * 0.7, 0, spotHash(x0, z0, 92));
  b.geo(roofGeo, roof, _m.compose(_p.set(x0 + w / 2, h, z0 + d / 2), _q.identity(), _s.set(1, 1, 1)), 'roof');
  roofGeo.dispose();

  const result = { doorX: b.wx(doorX), frontZ: b.wz(z1) };
  b.endFrame();
  return result;
}

/**
 * Town building: corner shop / store with a flat roof, big display windows, shelving aisles,
 * a counter, and a back storeroom.
 */
export function buildShop(b: Builder, s: HouseSpec): HouseResult {
  const { x0, z0, w, d, rand } = s;
  const x1 = x0 + w;
  const z1 = z0 + d;
  const h = 3.4;
  const front = pick(rand, PAL.shopFronts);
  const paper = pick(rand, PAL.wallpapers);
  const kind = SHOP_KINDS[Math.floor(rand() * SHOP_KINDS.length)];
  const messy = rand() < 0.5;
  b.shelter(x0, z0, x1, z1, h);
  if (!s.frontPlusZ) b.beginFlip(x0 + w / 2, z0 + d / 2);
  const doorX = x0 + w * 0.5;

  // Front: low wall + display windows either side of the door, sign band above.
  const wa = doorX - DOOR_W / 2;
  const wb = doorX + DOOR_W / 2;
  for (const [xa, xb] of [
    [x0, wa],
    [wb, x1],
  ] as const) {
    if (rand() < 0.35) {
      // Smashed: a low sill you can step over.
      wallAlongX(b, front, paper, xa, xb, z1 - WALL_T, true, 0, 0.3, false);
      b.solid(xa, z1 - WALL_T, xa + 0.15, z1);
      b.solid(xb - 0.15, z1 - WALL_T, xb, z1);
    } else {
      wallAlongX(b, front, paper, xa, xb, z1 - WALL_T, true, 0, 0.7, true);
      b.block(PAL.window, xa + 0.15, 0.7, z1 - 0.12, xb - xa - 0.3, 1.9, 0.04, 'windowGlass', true);
    }
    b.block(PAL.trim, xa, 0.3, z1 - WALL_T, 0.15, 2.3, WALL_T, 'metal');
    b.block(PAL.trim, xb - 0.15, 0.3, z1 - WALL_T, 0.15, 2.3, WALL_T, 'metal');
  }
  // Glass shop door (sometimes left open), or its open frame.
  if (rand() < 0.75) b.door(wa, z1 - WALL_T / 2, 0, 0, 1, false, { width: DOOR_W, height: 2.6, style: 'glass', open: rand() < 0.3 });
  wallAlongX(b, front, paper, x0, x1, z1 - WALL_T, true, 2.6, h - 2.6, false);
  b.block(SHOP_SIGN[kind], x0 + 0.3, 2.7, z1, w - 0.6, 0.55, 0.06, 'metal');
  wallAlongX(b, front, paper, x0, x1, z0, false, 0, h);
  wallAlongZ(b, front, paper, x0, z0 + WALL_T, z1 - WALL_T, false, h);
  wallAlongZ(b, front, paper, x1 - WALL_T, z0 + WALL_T, z1 - WALL_T, true, h);

  // Storeroom at the back.
  const zs = z0 + d * 0.28;
  partitionX(b, paper, x0 + WALL_T, x1 - WALL_T, zs, x0 + w * 0.8, h);
  // The sales floor by trade, and a counter by the door.
  shopFloor(b, kind, x0 + WALL_T, zs + 0.12, x1 - WALL_T, z1 - WALL_T - 2.4, rand, messy);
  F.shopCounter(new Place(b, Math.min(wb + 1.7, x1 - WALL_T - 1.05), 0, z1 - WALL_T - 2.4, 0), rand, kind);
  // Crates in the storeroom (3D models only), spaced along the back wall clear of the doorway.
  const crateSlots: number[] = [];
  for (let cx = x0 + WALL_T + 0.55; cx <= x1 - WALL_T - 0.55 && crateSlots.length < 4; cx += 1.15) {
    if (Math.abs(cx - (x0 + w * 0.8)) >= 1.2) crateSlots.push(cx);
  }
  const cz = z0 + WALL_T + 0.55;
  crateSlots.forEach((cx, i) => {
    const cp = new Place(b, cx, 0, cz, Math.floor(rand() * 4) as F.Quarter);
    cp.resetBounds();
    cp.model('woodenCrate', rand, 0, 0, 0, 0, 1, 0.8, 0.1, true);
    if (i < 2) cp.container('crate', 0, 0.5);
  });

  b.block(PAL.floor, x0 + WALL_T, 0, z0 + WALL_T, w - 2 * WALL_T, 0.04, d - 2 * WALL_T, 'asphalt');
  b.block(PAL.ceiling, x0, h - 0.05, z0, w, 0.05, d, 'plaster', true);
  // Flat roof with a parapet lip.
  b.block(0x3a3a38, x0 - 0.1, h, z0 - 0.1, w + 0.2, 0.25, d + 0.2, 'roof');
  b.life(LIFE.perch, x0 + w / 2, h + 0.25, z1, 1, 0, w * 0.8, 0, spotHash(x0, z0, 93));

  const result = { doorX: b.wx(doorX), frontZ: b.wz(z1) };
  b.endFrame();
  return result;
}

/** Town shop sales floor between the storeroom wall (za) and the counter line (zb). */
function shopFloor(b: Builder, kind: F.ShopKind, xa: number, za: number, xb: number, zb: number, rand: Rand, messy: boolean): void {
  const w = xb - xa;
  const d = zb - za;
  if (kind === 'grocery' || kind === 'pharmacy') {
    // Aisles back to back, running front to back.
    const len = Math.max(1.4, d - 1.4);
    for (let x = xa + 1.4; x < xb - (kind === 'grocery' ? 1.7 : 1.2); x += 2.4) {
      F.shopShelf(new Place(b, x, 0, za + 0.7 + len / 2, 1), rand, len, kind, messy);
      F.shopShelf(new Place(b, x, 0, za + 0.7 + len / 2, 3), rand, len, kind, messy);
    }
    if (kind === 'grocery') F.cooler(new Place(b, xb, 0, za + d * 0.5, 3), rand);
  } else if (kind === 'cafe') {
    for (let x = xa + 1.95; x < xb - 1.1; x += 2.2) {
      for (let z = za + 1.25; z < zb - 1.25; z += 2.3) F.cafeTable(new Place(b, x, 0, z, 0), rand, messy);
    }
    F.cooler(new Place(b, xa, 0, za + d * 0.5, 1), rand);
  } else {
    for (let z = za + 0.5; z < zb - 0.4; z += 1.5) F.washer(new Place(b, xa, 0, z, 1), rand, rand() < 0.3);
    for (let z = za + 0.5; z < zb - 0.4; z += 1.5) F.washer(new Place(b, xb, 0, z, 3), rand, rand() < 0.3);
    if (w > 4) {
      const T = new Place(b, (xa + xb) / 2, 0, za + d / 2, 0);
      F.diningTable(T, rand, 0, false);
    }
  }
}

/**
 * Jagged teeth of glass left in a smashed frame (in the plane z, facing ±Z). Each tooth in its own
 * plane, 8 mm from the next: overlapping teeth never fight for the same pixels.
 */
export function glassTeeth(b: Builder, x: number, y: number, z: number, w: number, h: number, rand: Rand): void {
  const n = 3 + Math.floor(rand() * 3);
  const plane = (k: number) => z - 0.024 + (k % 7) * 0.008;
  for (let i = 0; i < n; i++) {
    const tw = 0.12 + rand() * 0.3;
    const th = 0.15 + rand() * 0.5;
    const tx = x + rand() * Math.max(0.01, w - tw);
    const fromTop = rand() < 0.5;
    b.block(0x5a6a72, tx, fromTop ? y + h - th : y, plane(i), tw, th, 0.004, 'glass');
  }
  // Teeth along the side posts too.
  [x, x + w - 0.08].forEach((sx, k) => {
    if (rand() < 0.7) b.block(0x5a6a72, sx, y + h * (0.2 + rand() * 0.5), plane(5 + k), 0.08, 0.3 + rand() * 0.4, 0.004, 'glass');
  });
}

/**
 * Fence along X or Z (axis-aligned), with an optional gate gap. 'picket' for street fronts; 'board'
 * (solid privacy panels, ~8× fewer triangles) for the long side and back fences.
 * With `rand`, the fence shows the outbreak: whole 2 m sections kicked in (and passable),
 * pickets missing, boards hanging at an angle. Colliders cover only the standing sections.
 */
export function fence(
  b: Builder,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  gapAt?: number,
  gapW = 1.4,
  style: 'picket' | 'board' = 'picket',
  rand?: Rand,
): void {
  const alongX = Math.abs(bz - az) < 1e-6;
  const a = alongX ? Math.min(ax, bx) : Math.min(az, bz);
  const c = alongX ? Math.max(ax, bx) : Math.max(az, bz);
  const fixed = alongX ? az : ax;
  const spans: [number, number][] = gapAt === undefined ? [[a, c]] : [
    [a, gapAt - gapW / 2],
    [gapAt + gapW / 2, c],
  ];
  const barrier = pickModel(modelLibrary(), 'wallBarrier', 0);
  if (barrier) {
    const sy = style === 'board' ? 1.35 : 0.95;
    const sz = 1.0;
    const halfT = (barrier.size[2] * sz) / 2;
    const topY = barrier.size[1] * sy;
    _q.setFromEuler(_e.set(0, alongX ? 0 : Math.PI / 2, 0));
    for (const [s0, s1] of spans) {
      const spanLen = s1 - s0;
      if (spanLen < 0.3) continue;
      const count = Math.max(1, Math.round(spanLen / barrier.size[0]));
      const segLen = spanLen / count;
      const sx = (segLen / barrier.size[0]) * 1.045;
      _s.set(sx, sy, sz);
      for (let i = 0; i < count; i++) {
        if (rand && rand() < 0.1) continue;
        const segStart = s0 + i * segLen;
        const segEnd = segStart + segLen;
        const u = segStart + segLen * 0.5;
        _p.set(alongX ? u : fixed, 0, alongX ? fixed : u);
        placeModel(b.batch, barrier, _m.compose(_p, _q, _s), null);
        if (alongX) b.colliders.addBox(segStart, fixed - halfT, segEnd, fixed + halfT, 0, topY);
        else b.colliders.addBox(fixed - halfT, segStart, fixed + halfT, segEnd, 0, topY);
        if (spotHash(segStart, fixed, 21) < 0.18) {
          const side = spotHash(fixed, segStart, 22) < 0.5 ? -1 : 1;
          const fh = topY * (0.6 + spotHash(segStart, fixed, 23) * 0.4);
          if (alongX) b.life(LIFE.ivy, u, 0, fixed + side * (halfT + 0.02), 0, side, segLen, fh, spotHash(segStart, fixed, 24));
          else b.life(LIFE.ivy, fixed + side * (halfT + 0.02), 0, u, side, 0, segLen, fh, spotHash(segStart, fixed, 24));
        }
      }
    }
    return;
  }
}

/**
 * A broad-leaved tree: a spot for the Vegetation (species, turn, scale) and a collider round the trunk.
 * Draws seven numbers from `rand` — as many as the old crowns did, so the rest of the block (loot, doors)
 * stays as it was. Some are dead (bare, some snapped), some overgrown; fallen branches lie under a few.
 */
export function tree(b: Builder, x: number, y: number, z: number, scale: number, rand: Rand): void {
  const r = [rand(), rand(), rand(), rand(), rand(), rand(), rand()];
  const species = spotHash(x, z, 32) < 0.14 ? TREE.dead : Math.floor(spotHash(x, z, 33) * 3);
  const s = scale * (spotHash(x, z, 34) < 0.22 ? 1.3 : 1);
  plantTree(b, x, y, z, s, r[0] * Math.PI * 2, species);
}

/** A tree spot of a given species (see lifeKinds TREE), its trunk collider, and its streamed GLB model. */
export function plantTree(b: Builder, x: number, y: number, z: number, s: number, yaw: number, species: number): void {
  const conifer = species === TREE.spruce || species === TREE.pine;
  b.life(LIFE.tree, x, y, z, Math.sin(yaw), Math.cos(yaw), (conifer ? 2.4 : 3) * s, s, spotHash(x, z, 31), species);
  b.glb(conifer ? 'Spruce_Pine_Tree_7000' : 'Dead_Autumn_Tree_6000', x, y, z, yaw, { scale: conifer ? s * 0.82 : s * 0.88 });
  b.batch.addShadow(new Matrix4().makeTranslation(x, y, z), (conifer ? 2.6 : 3.1) * s, (conifer ? 2.6 : 3.1) * s, 0.025);
  const t = (conifer ? 0.16 : 0.2) * s;
  b.colliders.addBox(x - t, z - t, x + t, z + t);
}

/** A spruce or a pine (or a dead one): four draws from `rand`, as before. */
export function pine(b: Builder, x: number, y: number, z: number, scale: number, rand: Rand): void {
  const r = [rand(), rand(), rand(), rand()];
  const species = spotHash(x, z, 32) < 0.08 ? TREE.dead : spotHash(x, z, 33) < 0.5 ? TREE.spruce : TREE.pine;
  plantTree(b, x, y, z, scale * (spotHash(x, z, 34) < 0.2 ? 1.25 : 1), r[0] * Math.PI * 2, species);
}

/** A bush (GLB Urban_Bush_2500): four draws from `rand`, as before. */
export function bush(b: Builder, x: number, y: number, z: number, scale: number, rand: Rand): void {
  const r = [rand(), rand(), rand(), rand()];
  const yaw = r[0] * Math.PI * 2;
  b.life(LIFE.bush, x, y, z, Math.sin(yaw), Math.cos(yaw), scale, spotHash(x, z, 40) < 0.35 ? 1 : 0, spotHash(x, z, 41));
  b.glb('Urban_Bush_2500', x, y, z, yaw, { scale: 0.72 + scale * 0.28 });
}

/**
 * A clipped hedge gone wild, from (ax, az) to (bx, bz) along X or Z, in 3 m stretches (GLB bushes + colliders),
 * with a gap for a gate at `gapAt`.
 */
export function hedge(b: Builder, ax: number, az: number, bx: number, bz: number, gapAt?: number, gapW = 1.8): void {
  const alongX = Math.abs(bz - az) < 1e-6;
  const a = alongX ? Math.min(ax, bx) : Math.min(az, bz);
  const c = alongX ? Math.max(ax, bx) : Math.max(az, bz);
  const fixed = alongX ? az : ax;
  const spans: [number, number][] = gapAt === undefined ? [[a, c]] : [
    [a, gapAt - gapW / 2],
    [gapAt + gapW / 2, c],
  ];
  for (const [s0, s1] of spans) {
    const len = s1 - s0;
    if (len < 1) continue;
    const n = Math.max(1, Math.round(len / 2.2));
    const seg = len / n;
    for (let k = 0; k < n; k++) {
      const m = s0 + seg * (k + 0.5);
      const x = alongX ? m : fixed;
      const z = alongX ? fixed : m;
      const hScale = 0.85 + spotHash(x, z, 42) * 0.25;
      b.life(LIFE.hedge, x, 0, z, alongX ? 1 : 0, alongX ? 0 : 1, seg / 3, hScale, spotHash(x, z, 43));
      b.glb('Urban_Bush_2500', x, 0, z, alongX ? 0 : Math.PI / 2, { sx: (seg / 2.2) * 1.04, sy: hScale, sz: 0.65 });
    }
    if (alongX) b.colliders.addBox(s0, fixed - 0.5, s1, fixed + 0.5);
    else b.colliders.addBox(fixed - 0.5, s0, fixed + 0.5, s1);
  }
}

/** Street lamp GLB; the arm points along +X/-X/+Z/-Z towards the road. */
export function lampPost(b: Builder, x: number, z: number, armX: number, armZ: number): void {
  const yaw = armX === 0 && armZ === 0 ? 0 : Math.atan2(-armZ, armX);
  b.glb('street_lamp_2000', x, 0, z, yaw);
  b.colliders.addBox(x - 0.14, z - 0.14, x + 0.14, z + 0.14);
  const ax = armX * 1.1;
  const az = armZ * 1.1;
  b.life(LIFE.perch, x + ax / 2, 4.14, z + az / 2, armX, armZ, 1.0, 0, spotHash(x, z, 91));
}

export function mailbox(_b: Builder, _x: number, _z: number): void {}

export function trashBins(b: Builder, x: number, z: number): void {
  const cx = x + 0.35;
  b.glb('garbage_cluster_1500', cx, 0, z, spotHash(x, z, 50) * Math.PI * 2, { scale: 0.62 });
  b.solid(cx - 0.62, z - 0.52, cx + 0.62, z + 0.52, 0, 1.05);
  b.container('trash', cx, z, 0, [cx - 0.62, 0, z - 0.52, cx + 0.62, 1.05, z + 0.52]);
  if (spotHash(x, z, 51) < 0.5) b.life(LIFE.flies, cx, 1.0, z, 0, 0, 0, 0, spotHash(x, z, 52));
}
