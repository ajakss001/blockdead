import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
  Float32BufferAttribute,
} from 'three';
import { mulberry32 } from '../../core/random';
import { gableRoof } from '../../render/lowpoly';
import type { StaticBatch } from '../../render/StaticBatch';
import type { CollisionWorld } from '../../world/CollisionWorld';

/** Muted dusk palette — 90s suburb after the end of the world. */
const C = {
  grass: 0x4d5641,
  dirt: 0x5a5240,
  asphalt: 0x3a3c3e,
  dash: 0xa89b66,
  sidewalk: 0x74736c,
  curb: 0x85847c,
  path: 0x6c6a62,
  trim: 0xb9b4a4,
  window: 0x1f252a,
  roof: 0x4a3f3a,
  wallpaper: 0x7d7360,
  floor: 0x5e4c39,
  ceiling: 0x3b3730,
  counter: 0x6d6250,
  counterTop: 0x9a9483,
  fence: 0x6e6352,
  trunk: 0x4a3b2e,
  leaves: [0x3f5236, 0x4a5a3a, 0x56603f],
  carBody: 0x6f3d34,
  glass: 0x262c31,
  tire: 0x1c1d1e,
  metal: 0x3a3c3e,
  bin: 0x3d4f3d,
  crate: 0x7a6646,
} as const;

const WALL_H = 2.7;
const WALL_T = 0.2;
const DOOR_W = 1.0;
const DOOR_H = 2.1;

export const PLAYGROUND_SPAWN = new Vector3(0, 0, 5.2);
/** Facing north (-Z), towards the first house. */
export const PLAYGROUND_YAW = 0;

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();

class Builder {
  readonly box = new BoxGeometry(1, 1, 1);
  readonly cyl8 = new CylinderGeometry(1, 1, 1, 8);
  readonly cyl5 = new CylinderGeometry(0.75, 1, 1, 5);
  readonly ico = new IcosahedronGeometry(1, 0);

  constructor(
    readonly batch: StaticBatch,
    readonly world: CollisionWorld,
  ) {}

  /** Axis-aligned box by min corner (x, y, z) and size. */
  block(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, solid = false): void {
    _p.set(x + sx / 2, y + sy / 2, z + sz / 2);
    _s.set(sx, sy, sz);
    this.batch.add(this.box, color, _m.compose(_p, _q.identity(), _s));
    if (solid) this.world.addBox(x, z, x + sx, z + sz);
  }

  shape(template: typeof this.box | typeof this.cyl8, color: number, pos: Vector3, scale: Vector3, rot?: Euler): void {
    this.batch.add(template, color, _m.compose(pos, rot ? _q.setFromEuler(rot) : _q.identity(), scale));
  }

  dispose(): void {
    this.box.dispose();
    this.cyl8.dispose();
    this.cyl5.dispose();
    this.ico.dispose();
  }
}

/**
 * Hand-placed test yard for stage 1: street, two enterable houses with interiors, fences, a car,
 * trees and props. Everything static goes into one batch; colliders into the CollisionWorld.
 * Stage 2 replaces this with procedural chunks built from the same pieces.
 */
export function buildPlayground(batch: StaticBatch, world: CollisionWorld): void {
  const b = new Builder(batch, world);
  const rand = mulberry32(2024);

  ground(batch, rand);

  // Street running east-west: sidewalk (north) z ∈ [-0.4, 1.8], road z ∈ [1.8, 9.2], sidewalk south.
  b.block(C.sidewalk, -80, 0, -0.4, 160, 0.03, 2.2);
  b.block(C.curb, -80, 0, 1.72, 160, 0.09, 0.12);
  b.block(C.asphalt, -80, 0, 1.84, 160, 0.02, 7.3);
  b.block(C.curb, -80, 0, 9.14, 160, 0.09, 0.12);
  b.block(C.sidewalk, -80, 0, 9.26, 160, 0.03, 2);
  for (let x = -78; x < 78; x += 3.2) b.block(C.dash, x, 0, 5.43, 1.6, 0.025, 0.14);

  // North houses with front paths and picket fences.
  house(b, -5, -12, 10, 8, 0, 'south', 0x7d8a86, 0x4a3f3a);
  b.block(C.path, -0.6, 0, -4, 1.2, 0.035, 3.6);
  house(b, 11, -13, 8, 8, 15, 'south', 0x8f7f6a, 0x3d4146);
  b.block(C.path, 14.4, 0, -5, 1.2, 0.035, 4.6);
  fence(b, -16, -1, -1.2);
  fence(b, 1, 14, -1.2);
  fence(b, 16, 24, -1.2);

  // South side: a third house facing the street.
  house(b, -12, 13, 9, 7, -7.5, 'north', 0x857a6c, 0x463b36);
  b.block(C.path, -8.1, 0, 11.2, 1.2, 0.035, 1.9);

  // Abandoned car on the north lane.
  car(b, 5.5, 3.1);

  // Lamp posts, bins, crates, mailbox.
  for (const x of [-11, 9]) lampPost(b, x, 1.2);
  b.shape(b.cyl8, C.bin, _p.set(6.2, 0.45, -3.2), _s.set(0.3, 0.9, 0.3));
  b.shape(b.cyl8, C.bin, _p.set(6.9, 0.45, -3.1), _s.set(0.3, 0.9, 0.3));
  world.addBox(5.85, -3.55, 7.25, -2.75);
  b.block(C.crate, -7.2, 0, -4.9, 0.8, 0.8, 0.8, true);
  b.block(C.crate, -7.0, 0.8, -4.7, 0.6, 0.6, 0.6);
  b.block(C.metal, 1.6, 0, -0.9, 0.08, 1.1, 0.08, true);
  b.block(0x5a6a7a, 1.45, 1.1, -1.05, 0.38, 0.24, 0.5);

  // Trees outside the street corridor and away from the houses.
  for (let i = 0; i < 46; i++) {
    const x = (rand() - 0.5) * 120;
    const z = rand() < 0.5 ? -16 - rand() * 40 : 22 + rand() * 40;
    tree(b, x, z, 0.8 + rand() * 0.5, rand);
  }
  for (const [x, z] of [
    [-14, -6],
    [8, -7],
    [22, -9],
    [2, 15],
    [9, 17],
  ] as const) {
    tree(b, x, z, 1 + rand() * 0.3, rand);
  }

  b.dispose();
}

function ground(batch: StaticBatch, rand: () => number): void {
  const size = 160;
  const g = new PlaneGeometry(size, size, 48, 48);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const grass = new Color(C.grass);
  const dirt = new Color(C.dirt);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Gentle low-poly bumps away from the street and houses (no vertical physics until stage 2).
    const nearStreet = Math.abs(x) < 30 && z > -16 && z < 22;
    pos.setY(i, nearStreet ? -0.01 : (rand() - 0.5) * 0.25);
    c.copy(grass).lerp(dirt, rand() * rand());
    c.multiplyScalar(0.9 + rand() * 0.15);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  batch.add(g, null);
  g.dispose();
}

/**
 * Enterable house: outer siding + inner wallpaper layers, a door gap, dark windows, floor,
 * ceiling, gable roof and a little furniture. (x0, z0) is the min corner of the footprint.
 */
function house(
  b: Builder,
  x0: number,
  z0: number,
  w: number,
  d: number,
  doorX: number,
  doorSide: 'north' | 'south',
  siding: number,
  roof: number,
): void {
  const x1 = x0 + w;
  const z1 = z0 + d;
  const half = WALL_T / 2;
  const frontZ = doorSide === 'south' ? z1 - WALL_T : z0;
  const backZ = doorSide === 'south' ? z0 : z1 - WALL_T;
  const outerFront = doorSide === 'south' ? half : 0;
  const outerBack = doorSide === 'south' ? 0 : half;

  // Wall = outer siding half + inner wallpaper half; one collider for the full thickness.
  const wallZ = (xa: number, xb: number, z: number, outerOffset: number, y = 0, h = WALL_H, solid = true) => {
    b.block(siding, xa, y, z + outerOffset, xb - xa, h, half);
    b.block(C.wallpaper, xa, y, z + (half - outerOffset), xb - xa, h, half);
    if (solid) b.world.addBox(xa, z, xb, z + WALL_T);
  };
  const wallX = (x: number, za: number, zb: number, outerOffset: number) => {
    b.block(siding, x + outerOffset, 0, za, half, WALL_H, zb - za);
    b.block(C.wallpaper, x + (half - outerOffset), 0, za, half, WALL_H, zb - za);
    b.world.addBox(x, za, x + WALL_T, zb);
  };

  // Front wall with door gap and lintel.
  wallZ(x0, doorX - DOOR_W / 2, frontZ, outerFront);
  wallZ(doorX + DOOR_W / 2, x1, frontZ, outerFront);
  wallZ(doorX - DOOR_W / 2, doorX + DOOR_W / 2, frontZ, outerFront, DOOR_H, WALL_H - DOOR_H, false);
  wallZ(x0, x1, backZ, outerBack);
  wallX(x0, z0 + WALL_T, z1 - WALL_T, 0);
  wallX(x1 - WALL_T, z0 + WALL_T, z1 - WALL_T, half);

  // Windows on the street side (dark glass with a light trim).
  // Glass sticks out further than the trim, so it is never hidden behind it.
  const trimZ = doorSide === 'south' ? z1 : z0 - 0.02;
  const glassZ = doorSide === 'south' ? z1 : z0 - 0.03;
  for (const wx of [x0 + w * 0.22, x1 - w * 0.22]) {
    if (Math.abs(wx - doorX) < 1.6) continue;
    b.block(C.trim, wx - 0.68, 0.92, trimZ, 1.36, 1.16, 0.02);
    b.block(C.window, wx - 0.6, 1.0, glassZ, 1.2, 1.0, 0.03);
  }

  // Interior: floor, ceiling, kitchen counter along the back wall, a table.
  b.block(C.floor, x0 + WALL_T, 0, z0 + WALL_T, w - 2 * WALL_T, 0.04, d - 2 * WALL_T);
  b.block(C.ceiling, x0, WALL_H - 0.05, z0, w, 0.05, d);
  const counterZ = doorSide === 'south' ? z0 + WALL_T : z1 - WALL_T - 0.6;
  b.block(C.counter, x0 + WALL_T + 0.2, 0, counterZ, w * 0.4, 0.86, 0.6, true);
  b.block(C.counterTop, x0 + WALL_T + 0.18, 0.86, counterZ - 0.02, w * 0.4 + 0.04, 0.05, 0.64);
  const tx = x0 + w * 0.3;
  const tz = z0 + d * 0.5;
  b.block(C.counter, tx - 0.6, 0.7, tz - 0.4, 1.2, 0.06, 0.8);
  for (const [lx, lz] of [
    [-0.55, -0.35],
    [0.5, -0.35],
    [-0.55, 0.3],
    [0.5, 0.3],
  ] as const) {
    b.block(C.counter, tx + lx, 0, tz + lz, 0.05, 0.7, 0.05);
  }
  b.world.addBox(tx - 0.6, tz - 0.4, tx + 0.6, tz + 0.4);

  // Gable roof with overhang, ridge along X.
  const roofGeo = gableRoof(w + 0.5, d + 0.7, 1.6);
  b.batch.add(roofGeo, roof, _m.compose(_p.set(x0 + w / 2, WALL_H, z0 + d / 2), _q.identity(), _s.set(1, 1, 1)));
  roofGeo.dispose();
}

function fence(b: Builder, xa: number, xb: number, z: number): void {
  for (let x = xa; x <= xb + 1e-6; x += 2) b.block(C.fence, x - 0.05, 0, z - 0.05, 0.1, 1.0, 0.1);
  b.block(C.fence, xa, 0.35, z - 0.03, xb - xa, 0.07, 0.04);
  b.block(C.fence, xa, 0.75, z - 0.03, xb - xa, 0.07, 0.04);
  for (let x = xa + 0.25; x < xb; x += 0.25) b.block(C.fence, x - 0.035, 0.1, z + 0.01, 0.07, 0.85, 0.02);
  b.world.addBox(xa - 0.05, z - 0.08, xb + 0.05, z + 0.08);
}

function car(b: Builder, cx: number, cz: number): void {
  const L = 4.2;
  const W = 1.8;
  b.block(C.carBody, cx - L / 2, 0.3, cz - W / 2, L, 0.6, W);
  b.block(C.glass, cx - 1.05, 0.9, cz - W / 2 + 0.08, 2.1, 0.5, W - 0.16);
  b.block(C.carBody, cx - 0.95, 1.4, cz - W / 2 + 0.12, 1.9, 0.07, W - 0.24);
  b.block(0xd8c48a, cx + L / 2 - 0.02, 0.62, cz - W / 2 + 0.2, 0.04, 0.12, 0.3);
  b.block(0xd8c48a, cx + L / 2 - 0.02, 0.62, cz + W / 2 - 0.5, 0.04, 0.12, 0.3);
  for (const [dx, dz] of [
    [-1.35, -0.85],
    [1.35, -0.85],
    [-1.35, 0.85],
    [1.35, 0.85],
  ] as const) {
    b.shape(b.cyl8, C.tire, _p.set(cx + dx, 0.34, cz + dz), _s.set(0.34, 0.24, 0.34), _e.set(Math.PI / 2, 0, 0));
  }
  b.world.addBox(cx - L / 2, cz - W / 2, cx + L / 2, cz + W / 2);
}

function lampPost(b: Builder, x: number, z: number): void {
  b.shape(b.cyl8, C.metal, _p.set(x, 2.1, z), _s.set(0.07, 4.2, 0.07));
  b.block(C.metal, x - 0.04, 4.1, z, 0.08, 0.06, 1.1);
  b.block(0x55585a, x - 0.15, 3.98, z + 0.9, 0.3, 0.12, 0.4);
  b.world.addBoxCentered(x, z, 0.25, 0.25);
}

function tree(b: Builder, x: number, z: number, scale: number, rand: () => number): void {
  const h = 2.2 * scale;
  b.batch.add(b.cyl5, C.trunk, _m.compose(_p.set(x, h / 2, z), _q.identity(), _s.set(0.16 * scale, h, 0.16 * scale)));
  const leaves = C.leaves[Math.floor(rand() * C.leaves.length)];
  _e.set(rand() * 3, rand() * 3, rand() * 3);
  b.batch.add(b.ico, leaves, _m.compose(_p.set(x, h + 0.5 * scale, z), _q.setFromEuler(_e), _s.setScalar(1.4 * scale)));
  _e.set(rand() * 3, rand() * 3, rand() * 3);
  b.batch.add(
    b.ico,
    leaves,
    _m.compose(_p.set(x + 0.3 * scale, h + 1.4 * scale, z - 0.2 * scale), _q.setFromEuler(_e), _s.setScalar(0.95 * scale)),
  );
  b.world.addBoxCentered(x, z, 0.35 * scale, 0.35 * scale);
}
