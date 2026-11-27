import { Color, Float32BufferAttribute, PlaneGeometry } from 'three';
import { mulberry32 } from '../../core/random';
import { StaticBatch, type SurfaceBuffers } from '../../render/StaticBatch';
import { PackedColliders } from '../CollisionWorld';
import { buildCar, CAR_PAINTS } from '../props/car';
import type { WindowPaneSpot } from '../WindowPanes';
import { GLB_WORLD_SPECS, type GlbPlacement, pickRoadSign } from '../worldModels';
import { curbParking, downtownBlock, trashMound } from './cityFill';
import { glbObb, isGlbClear, obbOverlap } from './footprint';
import { type BuildingDesc, windowPanes } from './highrise';
import { buildHighriseInterior } from './highriseInterior';
import { BAND, CHUNK, DOWNTOWN_RADIUS, PAVE, ROAD_HALF, type WorldLayout, type Zone } from './layout';
import { LIFE, spotHash, TREE } from './lifeKinds';
import { hash3 } from './noise';
import { buildPoi } from './poiBuild';
import { type BodyMode, chaosScene, sceneAt } from './chaos';
import { carIntoPole, checkpoint, crashSite, exitTrafficJam, trafficJam } from './storytelling';
import { Builder, type ContainerSpot, type DoorSpot, bush, buildHouse, buildShop, fence, hedge, lampPost, mailbox, PAL, pick, pine, plantTree, type Rand, trashBins, tree } from './pieces';

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
  /** Entrance doors of the block's buildings (houses, shops, high-rise lobbies). */
  doors: DoorSpot[];
  /** Destructible building window panes (2-stage crack -> shatter via WindowPanes). */
  windows: WindowPaneSpot[];
  /** World-life spots (lit windows, curtains…), see world/WorldLife. */
  ambient: Float32Array;
  /** Streamed instanced world GLB placements (vehicles, trees, bushes, signs, street props). */
  glbs: GlbPlacement[];
  /** Generation time in the worker, ms. */
  ms: number;
}

/** A streamed high-rise interior. */
export interface InteriorData {
  buildingId: number;
  /** Storey the furnishing is centered on. */
  focus: number;
  surfaces: SurfaceBuffers[];
  colliders: Float32Array;
  containers: (ContainerSpot & { id: number })[];
  doors: DoorSpot[];
  windows: WindowPaneSpot[];
  ambient: Float32Array;
  glbs: GlbPlacement[];
  ms: number;
}

/**
 * Interior container ids live above every chunk container id, 128 per storey so they stay the same
 * whichever storeys are furnished (the range before per-storey furnishing was 1e14…; unused now).
 */
const INTERIOR_ID_BASE = 2e14;

const GROUND_COLORS: Record<Zone, [number, number]> = {
  downtown: [0x4a4a46, 0x55524a],
  suburb: [PAL.grass, PAL.dirt],
  town: [0x4f5244, 0x5a5444],
  forest: [0x3c4232, 0x4a4030],
  field: [0x66603f, 0x5a5238],
};

/**
 * Builds one 64 × 64 m block: ground, its share of the road grid (west and south edges plus the
 * south-west intersection) and the zone's content. Runs in the chunk worker; deterministic per
 * (seed, i, j).
 */
export function buildChunk(layout: WorldLayout, i: number, j: number, bodies: BodyMode = 'mixed'): ChunkData {
  const t0 = performance.now();
  const rand = mulberry32(hash3(layout.seed, i, j));
  const batch = new StaticBatch([(i + 0.5) * CHUNK, (j + 0.5) * CHUNK]);
  const colliders = new PackedColliders();
  const b = new Builder(batch, colliders);
  const zone = layout.zone(i, j);

  ground(batch, layout, i, j, zone, rand);
  roads(b, layout, i, j, rand, bodies);
  const X0 = i * CHUNK + BAND;
  const Z0 = j * CHUNK + BAND;
  const X1 = (i + 1) * CHUNK - BAND;
  const Z1 = (j + 1) * CHUNK - BAND;
  let buildings: BuildingDesc[] = [];
  const poi = layout.poi(i, j);
  if (poi && ((poi.bw ?? 1) > 1 || (poi.bd ?? 1) > 1)) {
    // A big place: every chunk of it runs the whole plan with the same random numbers, keeping its part.
    b.clip = [i * CHUNK, j * CHUNK, (i + 1) * CHUNK, (j + 1) * CHUNK];
    buildPoi(b, poi, mulberry32(hash3(layout.seed, poi.i * 7919 + 13, poi.j * 104729 + 7)), layout.seed);
    b.clip = null;
  } else if (poi) buildPoi(b, poi, rand, layout.seed);
  else if (zone === 'downtown') buildings = downtownBlock(b, i, j, X0, Z0, X1, Z1, rand);
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
    doors: b.doors,
    windows: b.windows,
    ambient: new Float32Array(b.ambient),
    glbs: batch.glbs,
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
    c.copy(ca).lerp(cb, rand() * 0.65);
    c.multiplyScalar(0.94 + rand() * 0.10);
    colors[k * 3] = c.r;
    colors[k * 3 + 1] = c.g;
    colors[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  batch.add(g, null, undefined, 'ground');
  g.dispose();
}

function roads(b: Builder, layout: WorldLayout, i: number, j: number, rand: Rand, bodies: BodyMode): void {
  const x = i * CHUNK;
  const z = j * CHUNK;
  const SIDEWALK_H = PAVE.sidewalk;
  const obstacles: [number, number][] = [];
  const placedTrees: [number, number][] = [];
  // Road along x = X (runs north-south), between this chunk's intersections.
  if (layout.roadX(i, j)) {
    const za = z + BAND;
    const len = CHUNK - 2 * BAND;
    b.block(PAL.asphalt, x - ROAD_HALF, 0, za, ROAD_HALF * 2, 0.02, len, 'asphalt');
    for (let d = za + 1; d < za + len - 2; d += 3.2) b.block(PAL.dash, x - 0.07, 0.02, d, 0.14, 0.018, 1.6, 'asphalt');
    if (layout.urbanX(i, j)) {
      for (const side of [-1, 1]) {
        const sx = side < 0 ? x - BAND : x + ROAD_HALF;
        b.block(PAL.sidewalk, sx, 0, za, BAND - ROAD_HALF, SIDEWALK_H, len, 'asphalt');
        b.block(PAL.curb, side < 0 ? x - ROAD_HALF - 0.12 : x + ROAD_HALF, 0, za, 0.12, SIDEWALK_H + 0.03, len, 'asphalt');
      }
      for (const t of [0.25, 0.75]) {
        const lx = x + ROAD_HALF + 1.2;
        const lz = z + CHUNK * t;
        lampPost(b, lx, lz, -1, 0, SIDEWALK_H);
        obstacles.push([lx, lz]);
      }
      const signX = x + ROAD_HALF + 1.0;
      const signZ = z + BAND + 2.5;
      const signXId = pickRoadSign(rand());
      b.glb(signXId, signX, SIDEWALK_H, signZ, 0);
      obstacles.push([signX, signZ]);
      let busStopZ: number | null = null;
      if (spotHash(i, j, 71) < 0.28) {
        const bsz = z + CHUNK * 0.52;
        busStopZ = bsz;
        const bsx = x + ROAD_HALF + 2.0;
        b.glb('Soviet_Bus_Stop_Shelt', bsx, SIDEWALK_H, bsz, -Math.PI / 2);
        b.glb('Sign_Bus_Stop_1500', x + ROAD_HALF + 1.0, SIDEWALK_H, bsz - 4.75, 0);
        obstacles.push([bsx, bsz], [x + ROAD_HALF + 1.0, bsz - 4.75]);
        b.solid(bsx - 1.1, bsz - 2.1, bsx + 1.1, bsz + 2.1, SIDEWALK_H, SIDEWALK_H + 2.8);
        if (spotHash(i, j, 78) < 0.55) {
          buildCar(b.batch, b.colliders, { x: x + CURB_LANE, z: bsz + 0.6, yaw: Math.PI / 2 + (rand() - 0.5) * 0.15, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'bus' }, b.containers);
        }
      }
      // Downtown: the queue that never got out (plus dense rim-exit gridlocks); elsewhere curb parking.
      const rimX = Math.max(Math.abs(i), Math.abs(j));
      const useExitJamX = (rimX === 2 || rimX === 3) && (Math.abs(i) === 2 || Math.abs(j) === 2) && spotHash(i, j, 319) < 0.65;
      const jam = useExitJamX
        ? exitTrafficJam(b, x, 0, false, za, za + len, rand)
        : (layout.isDowntown(i, j) || layout.isDowntown(i - 1, j)) && rand() < 0.8
          ? trafficJam(b, x, 0, false, za, za + len, rand)
          : 0;
      const pole = layout.urbanX(i, j) && !useExitJamX && rand() < 0.12;
      if (pole) carIntoPole(b, x + ROAD_HALF + 1.2, z + CHUNK * 0.25, 0, rand);
      for (const side of [-1, 1]) {
        if (jam !== 2 && Math.sign(jam) !== side) curbParking(b, false, x + side * CURB_LANE, side, za + 5, za + len - 5, rand, side > 0 && pole ? z + CHUNK * 0.25 : undefined);
      }
      // Speed bumps INSIDE the city (downtown + town): anchored on asphalt, perpendicular to road axis,
      // at crosswalk signs, bus stops, city POIs, and mid-block crossings/exits.
      if (signXId === 'crosswalk_sign_1500') trySpeedBump(b, x, signZ + 2.4, 0);
      if (busStopZ !== null) trySpeedBump(b, x, busStopZ - 8.2, 0);
      if (roadHasPoiApproach(layout, i, j, 'x') || spotHash(i, j, 72) < 0.34) {
        trySpeedBump(b, x, z + CHUNK * 0.5, 0);
      }
    } else {
      const jam = (layout.isDowntown(i, j) || layout.isDowntown(i - 1, j)) && rand() < 0.8 ? trafficJam(b, x, 0, false, za, za + len, rand) : 0;
      if (jam === 0 && rand() < 0.2) {
        shoulderCar(b, false, x, za + 6 + rand() * (len - 12), rand);
      }
    }
  }
  // Road along z = Z (runs east-west).
  if (layout.roadZ(i, j)) {
    const xa = x + BAND;
    const len = CHUNK - 2 * BAND;
    b.block(PAL.asphalt, xa, 0, z - ROAD_HALF, len, 0.02, ROAD_HALF * 2, 'asphalt');
    for (let d = xa + 1; d < xa + len - 2; d += 3.2) b.block(PAL.dash, d, 0.02, z - 0.07, 1.6, 0.018, 0.14, 'asphalt');
    if (layout.urbanZ(i, j)) {
      for (const side of [-1, 1]) {
        const sz = side < 0 ? z - BAND : z + ROAD_HALF;
        b.block(PAL.sidewalk, xa, 0, sz, len, SIDEWALK_H, BAND - ROAD_HALF, 'asphalt');
        b.block(PAL.curb, xa, 0, side < 0 ? z - ROAD_HALF - 0.12 : z + ROAD_HALF, len, SIDEWALK_H + 0.03, 0.12, 'asphalt');
      }
      for (const t of [0.25, 0.75]) {
        const lx = x + CHUNK * t;
        const lz = z + ROAD_HALF + 1.2;
        lampPost(b, lx, lz, 0, -1, SIDEWALK_H);
        obstacles.push([lx, lz]);
      }
      const signX = x + BAND + 2.5;
      const signZ = z + ROAD_HALF + 1.0;
      const signZId = pickRoadSign(rand());
      b.glb(signZId, signX, SIDEWALK_H, signZ, Math.PI / 2);
      obstacles.push([signX, signZ]);
      if (spotHash(i, j, 73) < 0.16) {
        const dx = x + CHUNK * 0.65;
        const dz = z + (spotHash(i, j, 74) < 0.5 ? -2.2 : 2.2);
        const dyaw = spotHash(i, j, 75) * Math.PI * 2;
        if (isGlbClear(b.batch, 'Road_Debris_Cluster_2', dx, dz, dyaw, 1.0)) {
          b.glb('Road_Debris_Cluster_2', dx, 0.01, dz, dyaw);
        }
      }
      const rimZ = Math.max(Math.abs(i), Math.abs(j));
      const useExitJamZ = (rimZ === 2 || rimZ === 3) && (Math.abs(i) === 2 || Math.abs(j) === 2) && spotHash(i, j, 323) < 0.65;
      const jam = useExitJamZ
        ? exitTrafficJam(b, 0, z, true, xa, xa + len, rand)
        : (layout.isDowntown(i, j) || layout.isDowntown(i, j - 1)) && rand() < 0.8
          ? trafficJam(b, 0, z, true, xa, xa + len, rand)
          : 0;
      for (const side of [-1, 1]) if (jam !== 2 && Math.sign(jam) !== side) curbParking(b, true, z + side * CURB_LANE, side, xa + 5, xa + len - 5, rand);
      if (signZId === 'crosswalk_sign_1500') trySpeedBump(b, signX + 2.4, z, Math.PI / 2);
      if (roadHasPoiApproach(layout, i, j, 'z') || spotHash(i, j, 77) < 0.32) {
        trySpeedBump(b, x + CHUNK * 0.5, z, Math.PI / 2);
      }
    } else {
      const jam = (layout.isDowntown(i, j) || layout.isDowntown(i, j - 1)) && rand() < 0.8 ? trafficJam(b, 0, z, true, xa, xa + len, rand) : 0;
      if (jam === 0 && rand() < 0.2) {
        shoulderCar(b, true, xa + 6 + rand() * (len - 12), z, rand);
      }
    }
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
      if (spotHash(i, j, 76) < 0.75) {
        const tl1x = x + ROAD_HALF + 1.0;
        const tl1z = z + ROAD_HALF + 1.0;
        const tl2x = x - ROAD_HALF - 1.0;
        const tl2z = z - ROAD_HALF - 1.0;
        b.glb('traffic_light_2500', tl1x, SIDEWALK_H, tl1z, 0);
        b.glb('traffic_light_2500', tl2x, SIDEWALK_H, tl2z, Math.PI);
        obstacles.push([tl1x, tl1z], [tl2x, tl2z]);
        b.solid(tl1x - 0.16, tl1z - 0.16, tl1x + 0.16, tl1z + 0.16, SIDEWALK_H, SIDEWALK_H + 4.1);
        b.solid(tl2x - 0.16, tl2z - 0.16, tl2x + 0.16, tl2z + 0.16, SIDEWALK_H, SIDEWALK_H + 4.1);
      }
      // The intersection remembers the day: a pile-up, or the checkpoint that did not hold.
      const core = Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS + 1;
      const ring = Math.max(Math.abs(i), Math.abs(j));
      const roll = rand();
      // A big scene (cordon, police line, evacuation, crashed helicopter) on some; otherwise guaranteed special/small scenes.
      const big = sceneAt(layout.seed, i, j, urban, core);
      if (big) chaosScene(b, big.kind, x, z, big.rand, bodies);
      else if (ring >= 3 && ring <= 5) {
        checkpoint(b, x, z, rand);
      } else if (ring <= 3 && ((i + j) & 3) === 0) {
        buildCar(b.batch, b.colliders, { x: x - 2.8, z: z + 2.6, yaw: 0.4, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'police' }, b.containers);
        buildCar(b.batch, b.colliders, { x: x + 3.2, z: z - 2.6, yaw: Math.PI * 0.65, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'swat' }, b.containers);
        if (isGlbClear(b.batch, 'checkpoint_barricade', x, z + 5.2, 0, 0.6)) {
          b.glb('checkpoint_barricade', x, 0, z + 5.2, 0);
          b.solid(x - 1.7, z + 4.4, x + 1.7, z + 6.0, 0, 1.4);
        }
      } else if (ring <= 3 && ((i + j) & 3) === 2) {
        buildCar(b.batch, b.colliders, { x: x + 3.4, z: z + 2.8, yaw: -0.45, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'ambulance' }, b.containers);
        buildCar(b.batch, b.colliders, { x: x - 4.0, z: z - 2.6, yaw: 0.35, paint: 0xffffff, seed: Math.floor(rand() * 1e6), kind: 'fireTruck' }, b.containers);
      } else if (roll < (core ? 0.58 : 0.36)) crashSite(b, x, z, rand);
      else if (roll < (core ? 0.72 : 0.42)) checkpoint(b, x, z, rand);
    }
  }
  // Sparse street greenery placed AFTER obstacles & traffic lights so nothing grows through signs or lamps.
  if (layout.roadX(i, j) && layout.urbanX(i, j)) {
    const downtown = layout.isDowntown(i, j);
    for (let k = 0; k < 2; k++) {
      const side = ((i + j + k) & 1) === 0 ? 1 : -1;
      const tx = x + side * (ROAD_HALF + 1.05);
      const tz = z + CHUNK * (k === 0 ? 0.38 : 0.76);
      tryStreetGreenery(b, tx, tz, SIDEWALK_H, downtown, obstacles, placedTrees, rand);
    }
  }
  if (layout.roadZ(i, j) && layout.urbanZ(i, j)) {
    const downtown = layout.isDowntown(i, j);
    for (let k = 0; k < 2; k++) {
      const side = ((i + j + k) & 1) === 1 ? 1 : -1;
      const tx = x + CHUNK * (k === 0 ? 0.40 : 0.78);
      const tz = z + side * (ROAD_HALF + 1.05);
      tryStreetGreenery(b, tx, tz, SIDEWALK_H, downtown, obstacles, placedTrees, rand);
    }
  }
}

/** Sparse street trees & bushes with >= 3.8 m clearance from signs/lamps/lights and >= 22 m spacing. */
function tryStreetGreenery(
  b: Builder,
  x: number,
  z: number,
  y: number,
  downtown: boolean,
  obstacles: readonly [number, number][],
  placedTrees: [number, number][],
  rand: Rand,
): void {
  if (spotHash(x, z, 45) > (downtown ? 0.42 : 0.58)) return;
  for (const [ox, oz] of obstacles) {
    if (Math.hypot(x - ox, z - oz) < 3.8) return;
  }
  for (const [tx, tz] of placedTrees) {
    if (Math.hypot(x - tx, z - tz) < 22.0) return;
  }
  const kindPick = spotHash(x, z, 46);
  const yaw = spotHash(z, x, 49) * Math.PI * 2;
  if (kindPick < 0.30) {
    const sc = 0.75 + spotHash(x, z, 48) * 0.35;
    b.life(LIFE.bush, x, y, z, Math.sin(yaw), Math.cos(yaw), sc, 0, spotHash(x, z, 41));
    b.glb('Urban_Bush_2500', x, y - 0.04, z, yaw, { scale: sc });
  } else {
    const species = kindPick < 0.65 ? TREE.spruce : TREE.dead;
    const sc = 0.72 + spotHash(x, z, 48) * 0.28;
    plantTree(b, x, y, z, sc, yaw, species);
    placedTrees.push([x, z]);
  }
  void rand;
}

/** Places a speed bump flush onto city asphalt if no vehicle/debris/other speed bump occupies the strip. */
function trySpeedBump(b: Builder, x: number, z: number, yaw: number): void {
  const hx = GLB_WORLD_SPECS.speed_bump_1000.size[0] * 0.5;
  const hz = GLB_WORLD_SPECS.speed_bump_1000.size[2] * 0.5;
  for (let k = 0; k < b.batch.glbs.length; k++) {
    const g = b.batch.glbs[k];
    const cat = GLB_WORLD_SPECS[g.id].category;
    if (cat !== 'vehicle' && g.id !== 'Road_Debris_Cluster_2' && g.id !== 'speed_bump_1000' && g.id !== 'checkpoint_barricade') continue;
    const pad = g.id === 'speed_bump_1000' ? 2.5 : 0.4;
    const ob = glbObb(g);
    if (obbOverlap(x, z, hx, hz + pad, yaw, ob.x, ob.z, ob.hx, ob.hz, ob.yaw)) return;
  }
  b.glb('speed_bump_1000', x, PAVE.asphalt + 0.005, z, yaw);
}

function roadHasPoiApproach(layout: WorldLayout, i: number, j: number, axis: 'x' | 'z'): boolean {
  if (axis === 'x') {
    const a = layout.poi(i, j);
    const b = layout.poi(i - 1, j);
    return (a !== null && a.r === 3) || (b !== null && b.r === 1);
  }
  const a = layout.poi(i, j);
  const b = layout.poi(i, j - 1);
  return (a !== null && a.r === 2) || (b !== null && b.r === 0);
}

/** Parked cars hug the curb: lane center this far from the road's center line. */
const CURB_LANE = ROAD_HALF - 1.05;

/** Out in the country: a car pulled onto the shoulder, or an overturned highway crash wreck. */
function shoulderCar(b: Builder, alongX: boolean, x: number, z: number, rand: Rand): void {
  const side = rand() < 0.5 ? -1 : 1;
  const off = side * (ROAD_HALF + 0.3);
  const yaw = (alongX ? (side > 0 ? Math.PI : 0) : side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 0.25;
  const cx = alongX ? x : x + off;
  const cz = alongX ? z + off : z;
  const h = spotHash(cx, cz, 89);
  const isWreck = h < 0.22;
  const flipped = isWreck && h < 0.14 ? 'roof' : undefined;
  if (
    buildCar(
      b.batch,
      b.colliders,
      {
        x: cx,
        z: cz,
        yaw,
        paint: pick(rand, Object.values(CAR_PAINTS)),
        seed: Math.floor(rand() * 1e6),
        flatTire: rand() < 0.4 || isWreck,
        smashed: isWreck ? 0.9 : rand() < 0.3 ? 0.4 : 0,
        kind: flipped ? 'wreck' : undefined,
        flipped,
      },
      b.containers,
    )
  ) {
    b.life(LIFE.car, cx, 0, cz, Math.sin(yaw), Math.cos(yaw), 4.3, 1.8, spotHash(cx, cz, 41));
    if (isWreck) {
      if (isGlbClear(b.batch, 'Road_Debris_Cluster_2', cx + 1.8, cz - 1.2, yaw, 0.35, { keepClearGap: 1.2 })) {
        b.glb('Road_Debris_Cluster_2', cx + 1.8, 0.01, cz - 1.2, yaw);
      }
      b.life(LIFE.smoke, cx, 1.0, cz, 0, 0, 0, 0, h);
    }
  }
}

/** Interior of one high-rise (worker side, on demand), furnished around storey `focus`. */
export function buildInterior(desc: BuildingDesc, focus: number): InteriorData {
  const t0 = performance.now();
  const batch = new StaticBatch();
  const colliders = new PackedColliders();
  const b = new Builder(batch, colliders);
  buildHighriseInterior(b, desc, focus, (k) => INTERIOR_ID_BASE + desc.id * 4096 + k * 128);
  windowPanes(b, desc);
  b.dispose();
  return {
    buildingId: desc.id,
    focus,
    surfaces: batch.buildBuffers(),
    colliders: new Float32Array(colliders.data),
    containers: b.containers.map((c, n) => ({ ...c, id: c.id ?? INTERIOR_ID_BASE + desc.id * 4096 + 4000 + n })),
    doors: b.doors,
    windows: b.windows,
    ambient: new Float32Array(b.ambient),
    glbs: batch.glbs,
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
      // An overgrown hedge inside some fences, a gap at the gate.
      if (spotHash(lx0, frontLine, 44) < 0.4) hedge(b, lx0 + 0.7, frontLine + (south ? 0.9 : -0.9), lx1 - 0.7, frontLine + (south ? 0.9 : -0.9), res.doorX, 2);
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
  if (spotHash(X0, Z0, 96) < 0.35) {
    // Someone kept warm here: a rusty barrel, still burning.
    const bx = X0 + 2 + spotHash(X0, Z0, 97) * (X1 - X0 - 4);
    b.glb('burn_barrel', bx, 0, zMid + 0.9, 0);
    b.solid(bx - 0.34, zMid + 0.56, bx + 0.34, zMid + 1.24, 0, 0.95);
    b.life(LIFE.fire, bx, 0.92, zMid + 0.9, 0, 0, 0.55, 0, spotHash(X0, Z0, 98));
  }
  const seg = (X1 - X0 - 6) / 3;
  for (let n = 0; n < 3; n++) {
    const dx = X0 + 2 + n * seg + rand() * Math.max(0.1, seg - 2.4);
    b.glb('Soviet_Dumpster_3000', dx + 0.9, 0, zMid - 0.25, 0, { sx: 0.9, sy: 0.72, sz: 0.58 });
    b.solid(dx, zMid - 0.8, dx + 1.8, zMid + 0.3, 0.12, 1.35);
    trashMound(b, dx + 2.3, zMid - 0.25, 220 + n * 5, 0);
    if (spotHash(dx, zMid, 53) < 0.5) b.life(LIFE.flies, dx + 0.9, 1.5, zMid - 0.25, 0, 0, 0, 0, spotHash(dx, zMid, 54));
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
}
