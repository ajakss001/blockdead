import { Color, CylinderGeometry, Float32BufferAttribute, Matrix4, PlaneGeometry, Quaternion, Vector3, Euler } from 'three';
import { mulberry32 } from '../../core/random';
import { StaticBatch, type SurfaceBuffers } from '../../render/StaticBatch';
import { PackedColliders } from '../CollisionWorld';
import { buildCar, CAR_PAINTS } from '../props/car';
import { curbParking, downtownBlock } from './cityFill';
import { type BuildingDesc, buildHighriseInterior, groundDecal, windowPanes } from './highrise';
import { BAND, CHUNK, DOWNTOWN_RADIUS, PAVE, ROAD_HALF, type WorldLayout, type Zone } from './layout';
import { hash3 } from './noise';
import { carIntoPole, checkpoint, crashSite, trafficJam } from './storytelling';
import { Builder, type ContainerSpot, type DoorSpot, bush, buildHouse, buildShop, fence, lampPost, mailbox, PAL, pick, pine, type Rand, trashBins, tree } from './pieces';

export interface ChunkData {
  i: number;
  j: number;
  zone: Zone;
  surfaces: SurfaceBuffers[];
  /** Packed [minX, minZ, maxX, maxZ, minY, maxY] per collider. */
  colliders: Float32Array;
  /** Searchable containers; ids are unique world-wide and stable per seed. */
  containers: (ContainerSpot & { id: number })[];
  /** High-rises of this block (their interiors are streamed separately). */
  buildings: BuildingDesc[];
  /** Roofed footprints for the climate: [minX, minZ, maxX, maxZ, roofY] each. */
  shelters: Float32Array;
  /** Generation time in the worker, ms. */
  ms: number;
}

/** A streamed high-rise interior. */
export interface InteriorData {
  buildingId: number;
  surfaces: SurfaceBuffers[];
  colliders: Float32Array;
  containers: (ContainerSpot & { id: number })[];
  doors: DoorSpot[];
  ms: number;
}

/** Interior container ids live above every chunk container id. */
const INTERIOR_ID_BASE = 1e14;

const GROUND_COLORS: Record<Zone, [number, number]> = {
  downtown: [0x4a4a46, 0x55524a],
  suburb: [PAL.grass, PAL.dirt],
  town: [0x4f5244, 0x5a5444],
  forest: [0x3c4232, 0x4a4030],
  field: [0x66603f, 0x5a5238],
};

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();

/**
 * Builds one 64 × 64 m block: ground, its share of the road grid (west and south edges plus the
 * south-west intersection) and the zone's content. Runs in the chunk worker; deterministic per
 * (seed, i, j).
 */
export function buildChunk(layout: WorldLayout, i: number, j: number): ChunkData {
  const t0 = performance.now();
  const rand = mulberry32(hash3(layout.seed, i, j));
  const batch = new StaticBatch();
  const colliders = new PackedColliders();
  const b = new Builder(batch, colliders);
  const zone = layout.zone(i, j);

  ground(batch, layout, i, j, zone, rand);
  roads(b, layout, i, j, rand);
  const X0 = i * CHUNK + BAND;
  const Z0 = j * CHUNK + BAND;
  const X1 = (i + 1) * CHUNK - BAND;
  const Z1 = (j + 1) * CHUNK - BAND;
  let buildings: BuildingDesc[] = [];
  if (zone === 'downtown') buildings = downtownBlock(b, i, j, X0, Z0, X1, Z1, rand);
  else if (zone === 'suburb') suburb(b, X0, Z0, X1, Z1, rand);
  else if (zone === 'town') town(b, X0, Z0, X1, Z1, rand);
  else if (zone === 'forest') forest(b, layout, X0, Z0, X1, Z1, rand);
  else field(b, layout, X0, Z0, X1, Z1, rand);

  b.dispose();
  const chunkKey = (i + 32768) * 65536 + (j + 32768);
  return {
    i,
    j,
    zone,
    containers: b.containers.map((c, n) => ({ ...c, id: chunkKey * 512 + n })),
    buildings,
    surfaces: batch.buildBuffers(),
    colliders: new Float32Array(colliders.data),
    shelters: new Float32Array(b.shelters),
    ms: performance.now() - t0,
  };
}

function ground(batch: StaticBatch, layout: WorldLayout, i: number, j: number, zone: Zone, rand: Rand): void {
  const wild = zone === 'forest' || zone === 'field';
  const n = wild ? 32 : 8;
  const g = new PlaneGeometry(CHUNK, CHUNK, n, n);
  g.rotateX(-Math.PI / 2);
  g.translate(i * CHUNK + CHUNK / 2, 0, j * CHUNK + CHUNK / 2);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const [a, c2] = GROUND_COLORS[zone];
  const ca = new Color(a);
  const cb = new Color(c2);
  const c = new Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const z = pos.getZ(k);
    pos.setY(k, layout.heightAt(x, z) - 0.01);
    c.copy(ca).lerp(cb, rand() * rand());
    c.multiplyScalar(0.88 + rand() * 0.18);
    colors[k * 3] = c.r;
    colors[k * 3 + 1] = c.g;
    colors[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  batch.add(g, null, undefined, 'ground');
  g.dispose();
}

function roads(b: Builder, layout: WorldLayout, i: number, j: number, rand: Rand): void {
  const x = i * CHUNK;
  const z = j * CHUNK;
  const SIDEWALK_H = PAVE.sidewalk;
  // Road along x = X (runs north-south), between this chunk's intersections.
  if (layout.roadX(i, j)) {
    const za = z + BAND;
    const len = CHUNK - 2 * BAND;
    b.block(PAL.asphalt, x - ROAD_HALF, 0, za, ROAD_HALF * 2, 0.02, len, 'asphalt');
    for (let d = za + 1; d < za + len - 2; d += 3.2) b.block(PAL.dash, x - 0.07, 0, d, 0.14, 0.025, 1.6, 'asphalt');
    if (layout.urbanX(i, j)) {
      for (const side of [-1, 1]) {
        const sx = side < 0 ? x - BAND : x + ROAD_HALF;
        b.block(PAL.sidewalk, sx, 0, za, BAND - ROAD_HALF, SIDEWALK_H, len, 'asphalt');
        b.block(PAL.curb, side < 0 ? x - ROAD_HALF - 0.12 : x + ROAD_HALF, 0, za, 0.12, SIDEWALK_H + 0.03, len, 'asphalt');
      }
      for (const t of [0.25, 0.75]) lampPost(b, x + ROAD_HALF + 1.2, z + CHUNK * t, -1, 0);
    }
    // Downtown: the queue that never got out; elsewhere cars sit where people left them.
    const jam = (layout.isDowntown(i, j) || layout.isDowntown(i - 1, j)) && rand() < 0.8 ? trafficJam(b, x, 0, false, za, za + len, rand) : 0;
    const pole = layout.urbanX(i, j) && rand() < 0.12;
    if (pole) carIntoPole(b, x + ROAD_HALF + 1.2, z + CHUNK * 0.25, 0, rand);
    if (layout.urbanX(i, j)) {
      for (const side of [-1, 1]) {
        if (Math.sign(jam) !== side) curbParking(b, false, x + side * CURB_LANE, side, za + 5, za + len - 5, rand, side > 0 && pole ? z + CHUNK * 0.25 : undefined);
      }
    } else if (rand() < 0.2) {
      shoulderCar(b, false, x, za + 6 + rand() * (len - 12), rand);
    }
    if (layout.urbanX(i, j)) for (let n = 0; n < 2; n++) if (rand() < 0.6) groundDecal(b, 'decalLitter', x + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 1), SIDEWALK_H, za + rand() * len, 1.8, rand);
  }
  // Road along z = Z (runs east-west).
  if (layout.roadZ(i, j)) {
    const xa = x + BAND;
    const len = CHUNK - 2 * BAND;
    b.block(PAL.asphalt, xa, 0, z - ROAD_HALF, len, 0.02, ROAD_HALF * 2, 'asphalt');
    for (let d = xa + 1; d < xa + len - 2; d += 3.2) b.block(PAL.dash, d, 0, z - 0.07, 1.6, 0.025, 0.14, 'asphalt');
    if (layout.urbanZ(i, j)) {
      for (const side of [-1, 1]) {
        const sz = side < 0 ? z - BAND : z + ROAD_HALF;
        b.block(PAL.sidewalk, xa, 0, sz, len, SIDEWALK_H, BAND - ROAD_HALF, 'asphalt');
        b.block(PAL.curb, xa, 0, side < 0 ? z - ROAD_HALF - 0.12 : z + ROAD_HALF, len, SIDEWALK_H + 0.03, 0.12, 'asphalt');
      }
      for (const t of [0.25, 0.75]) lampPost(b, x + CHUNK * t, z + ROAD_HALF + 1.2, 0, -1);
    }
    const jam = (layout.isDowntown(i, j) || layout.isDowntown(i, j - 1)) && rand() < 0.8 ? trafficJam(b, 0, z, true, xa, xa + len, rand) : 0;
    if (layout.urbanZ(i, j)) {
      for (const side of [-1, 1]) if (Math.sign(jam) !== side) curbParking(b, true, z + side * CURB_LANE, side, xa + 5, xa + len - 5, rand);
    } else if (rand() < 0.2) {
      shoulderCar(b, true, xa + 6 + rand() * (len - 12), z, rand);
    }
    if (layout.urbanZ(i, j)) for (let n = 0; n < 2; n++) if (rand() < 0.6) groundDecal(b, 'decalLitter', xa + rand() * len, SIDEWALK_H, z + (rand() < 0.5 ? -1 : 1) * (ROAD_HALF + 1), 1.8, rand);
  }
  // South-west intersection.
  const any = layout.roadX(i, j) || layout.roadZ(i, j) || layout.roadX(i, j - 1) || layout.roadZ(i - 1, j);
  if (any) {
    b.block(PAL.asphalt, x - BAND, 0, z - BAND, BAND * 2, 0.02, BAND * 2, 'asphalt');
    const urban = layout.isUrban(i, j) || layout.isUrban(i - 1, j) || layout.isUrban(i, j - 1) || layout.isUrban(i - 1, j - 1);
    if (urban) {
      const v = BAND - ROAD_HALF;
      for (const [cx, cz] of [
        [x - BAND, z - BAND],
        [x + ROAD_HALF, z - BAND],
        [x - BAND, z + ROAD_HALF],
        [x + ROAD_HALF, z + ROAD_HALF],
      ] as const) {
        b.block(PAL.sidewalk, cx, 0, cz, v, SIDEWALK_H, v, 'asphalt');
      }
      // The intersection remembers the day: a pile-up, or the checkpoint that did not hold.
      const core = Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS + 1;
      const roll = rand();
      if (roll < (core ? 0.4 : 0.2)) crashSite(b, x, z, rand);
      else if (roll < (core ? 0.55 : 0.25)) checkpoint(b, x, z, rand);
    }
  }
}

/** Parked cars hug the curb: lane center this far from the road's center line. */
const CURB_LANE = ROAD_HALF - 1.05;

/** Out in the country: a car that pulled over onto the shoulder and was left there. */
function shoulderCar(b: Builder, alongX: boolean, x: number, z: number, rand: Rand): void {
  const side = rand() < 0.5 ? -1 : 1;
  const off = side * (ROAD_HALF + 0.3);
  const yaw = (alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 0.15;
  buildCar(
    b.batch,
    b.colliders,
    { x: alongX ? x : x + off, z: alongX ? z + off : z, yaw, paint: pick(rand, Object.values(CAR_PAINTS)), seed: Math.floor(rand() * 1e6), flatTire: rand() < 0.4, smashed: rand() < 0.3 ? 0.4 : 0 },
    b.containers,
  );
}

/** Interior of one high-rise (worker side, on demand). */
export function buildInterior(desc: BuildingDesc): InteriorData {
  const t0 = performance.now();
  const rand = mulberry32(desc.seed);
  const batch = new StaticBatch();
  const colliders = new PackedColliders();
  const b = new Builder(batch, colliders);
  buildHighriseInterior(b, desc, rand);
  windowPanes(b, desc);
  b.dispose();
  return {
    buildingId: desc.id,
    surfaces: batch.buildBuffers(),
    colliders: new Float32Array(colliders.data),
    containers: b.containers.map((c, n) => ({ ...c, id: INTERIOR_ID_BASE + desc.id * 512 + n })),
    doors: b.doors,
    ms: performance.now() - t0,
  };
}

/** Two rows of four lots, back to back; houses face the road on their side. */
function suburb(b: Builder, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): void {
  const lots = 4;
  const lw = (X1 - X0) / lots;
  const zMid = (Z0 + Z1) / 2;
  for (const south of [true, false]) {
    const frontLine = south ? Z0 + 0.6 : Z1 - 0.6;
    for (let k = 0; k < lots; k++) {
      const lx0 = X0 + k * lw;
      const lx1 = lx0 + lw;
      if (k > 0) fence(b, lx0, frontLine + (south ? 3 : -3), lx0, zMid, undefined, 1.4, 'board', rand);
      if (rand() < 0.1) {
        // Vacant lot: overgrown, a burnt-out car or a pile of crates.
        for (let n = 0; n < 4; n++) bush(b, lx0 + 1 + rand() * (lw - 2), 0, frontLine + (south ? 1 : -1) * (2 + rand() * 8), 0.9 + rand() * 0.6, rand);
        fence(b, lx0 + 0.1, frontLine, lx1 - 0.1, frontLine);
        continue;
      }
      const w = Math.min(10.5, Math.max(7.6, lw - 2.4 - rand() * 1.4));
      const d = 7 + rand() * 1.6;
      const setback = 4 + rand() * 2.5;
      const hx0 = lx0 + (lw - w) / 2 + (rand() - 0.5) * 0.6;
      const hz0 = south ? Z0 + setback : Z1 - setback - d;
      const res = buildHouse(b, { x0: hx0, z0: hz0, w, d, frontPlusZ: !south, rand });
      fence(b, lx0 + 0.1, frontLine, lx1 - 0.1, frontLine, res.doorX, 1.4, 'picket', rand);
      // Path from the gate to the door.
      const pz0 = Math.min(frontLine, res.frontZ);
      b.block(PAL.path, res.doorX - 0.6, 0, pz0, 1.2, 0.035, Math.abs(res.frontZ - frontLine), 'asphalt');
      if (rand() < 0.7) mailbox(b, res.doorX + 1.1, frontLine + (south ? 0.4 : -0.4));
      if (rand() < 0.6) trashBins(b, hx0 + w + 0.5, hz0 + d * 0.3);
      for (let n = 0; n < 2; n++) if (rand() < 0.6) bush(b, hx0 + rand() * w, 0, south ? hz0 - 0.8 : hz0 + d + 0.8, 0.7 + rand() * 0.4, rand);
      // Backyard tree, only if the yard is deep enough.
      const yard = south ? zMid - (hz0 + d) - 3 : hz0 - zMid - 3;
      if (yard > 1 && rand() < 0.55) {
        const ty = south ? hz0 + d + 2 + rand() * yard : zMid + 1 + rand() * yard;
        tree(b, lx0 + 1.5 + rand() * (lw - 3), 0, ty, 0.9 + rand() * 0.4, rand);
      }
    }
  }
  fence(b, X0 + 0.1, zMid, X1 - 0.1, zMid, undefined, 1.4, 'board', rand);
}

/** Two rows of three shops facing the street, an alley between them with dumpsters. */
function town(b: Builder, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): void {
  const lots = 3;
  const lw = (X1 - X0) / lots;
  for (const south of [true, false]) {
    for (let k = 0; k < lots; k++) {
      const lx0 = X0 + k * lw;
      const w = lw - 1.6;
      const d = 11 + rand() * 4;
      const hz0 = south ? Z0 + 1 : Z1 - 1 - d;
      if (rand() < 0.75) buildShop(b, { x0: lx0 + 0.8, z0: hz0, w, d, frontPlusZ: !south, rand });
      else buildHouse(b, { x0: lx0 + (lw - 10) / 2, z0: south ? Z0 + 2 : Z1 - 2 - 8, w: 10, d: 8, frontPlusZ: !south, rand });
    }
  }
  const zMid = (Z0 + Z1) / 2;
  for (let n = 0; n < 3; n++) {
    const dx = X0 + 3 + rand() * (X1 - X0 - 6);
    b.block(0x3a4a3a, dx, 0, zMid - 0.8, 1.8, 1.3, 1.1, 'metal', true);
  }
}

function forest(b: Builder, layout: WorldLayout, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): void {
  const step = 5.5;
  for (let x = X0; x < X1 - 1; x += step) {
    for (let z = Z0; z < Z1 - 1; z += step) {
      if (rand() > 0.8) continue;
      const tx = x + rand() * step;
      const tz = z + rand() * step;
      const y = layout.heightAt(tx, tz);
      if (rand() < 0.6) pine(b, tx, y, tz, 0.8 + rand() * 0.5, rand);
      else tree(b, tx, y, tz, 0.9 + rand() * 0.4, rand);
    }
  }
  for (let n = 0; n < 26; n++) {
    const x = X0 + rand() * (X1 - X0);
    const z = Z0 + rand() * (Z1 - Z0);
    bush(b, x, layout.heightAt(x, z), z, 0.8 + rand() * 0.7, rand);
  }
}

function field(b: Builder, layout: WorldLayout, X0: number, Z0: number, X1: number, Z1: number, rand: Rand): void {
  for (let n = 0; n < 4; n++) {
    const x = X0 + rand() * (X1 - X0);
    const z = Z0 + rand() * (Z1 - Z0);
    tree(b, x, layout.heightAt(x, z), z, 1 + rand() * 0.4, rand);
  }
  for (let n = 0; n < 14; n++) {
    const x = X0 + rand() * (X1 - X0);
    const z = Z0 + rand() * (Z1 - Z0);
    bush(b, x, layout.heightAt(x, z), z, 0.6 + rand() * 0.6, rand);
  }
  // Rotting hay bales.
  const bale = new CylinderGeometry(0.75, 0.75, 1.2, 10);
  for (let n = 0; n < 3; n++) {
    const x = X0 + 4 + rand() * (X1 - X0 - 8);
    const z = Z0 + 4 + rand() * (Z1 - Z0 - 8);
    const y = layout.heightAt(x, z);
    _q.setFromEuler(new Euler(Math.PI / 2, rand() * 3, 0, 'YXZ'));
    b.batch.add(bale, 0x7a6a42, _m.compose(_p.set(x, y + 0.7, z), _q, _s.set(1, 1, 1)), 'wood');
    b.colliders.addBox(x - 0.8, z - 0.8, x + 0.8, z + 0.8);
  }
  bale.dispose();
}
