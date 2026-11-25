/**
 * Enterable Modular GLB Skyscraper near player spawn:
 * - Aligns base (facing -Z road) -> 5 quarter-turned mid_2f sections -> roof strictly along central (X, Z) shaft
 *   axis at y0 = PAVE.plaza with zero tilt and zero vertical seam gaps.
 * - Programmatically carves out the front canopy doorway, inter-module caps, and roof stair/booth exit in the
 *   GLB geometry and enables DoubleSide on tower facade materials.
 * - Builds an enterable ground-floor lobby (containing the 3 scaled GLB lobby props), 11 upper office/apartment
 *   storeys, a continuous switchback concrete stairwell with smooth analytic ramp + stepped/ramped colliders,
 *   perimeter/partition colliders, searchable loot containers, and walkable roof access beside the beacon.
 */

import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PointLight,
  type Scene,
  SphereGeometry,
  type Texture,
  Vector3,
} from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mulberry32 } from '../core/random';
import { disposeBatchGroup, meshesFromBuffers } from '../render/batchMeshes';
import { StaticBatch } from '../render/StaticBatch';
import type { Shelters } from '../systems/Climate';
import type { Containers } from '../systems/Containers';
import { type CollisionWorld, PackedColliders } from './CollisionWorld';
import { PAVE } from './gen/layout';
import { Builder } from './gen/pieces';
import baseUrl from '../../assets/models/skyscraper_base.glb?url';
import midUrl from '../../assets/models/skyscraper_mid_2f.glb?url';
import roofUrl from '../../assets/models/skyscraper_roof.glb?url';
import elevatorUrl from '../../assets/models/elevator_wall_14k.glb?url';
import turnstileUrl from '../../assets/models/tripod_turnstile_14k.glb?url';
import deskUrl from '../../assets/models/reception_desk_14k.glb?url';

/** Center on reserved lot (0, 0) south row, facing the road (z = 0..5.6) along -Z. */
export const SHOWCASE_TOWER_CENTER = { x: 40, z: 18 } as const;
export const SHOWCASE_TOWER_WIDTH = 18;
export const SHOWCASE_FLOOR_H = 3.8;
export const SHOWCASE_MID_SECTIONS = 5;
export const SHOWCASE_FLOORS = 2 + SHOWCASE_MID_SECTIONS * 2; // 12 walkable interior floors (0..11)
export const SHOWCASE_BASE_H = 2 * SHOWCASE_FLOOR_H; // 7.6 m
export const SHOWCASE_MID_H = 2 * SHOWCASE_FLOOR_H; // 7.6 m
export const SHOWCASE_ROOF_H = 12.0;
export const SHOWCASE_ROOF_DECK_OFFSET = 2.45;
export const SHOWCASE_ROOF_DECK_LOCAL_Y = SHOWCASE_FLOORS * SHOWCASE_FLOOR_H + SHOWCASE_ROOF_DECK_OFFSET; // 48.05 m
export const SHOWCASE_WALL_T = 0.45;
export const SHOWCASE_PART_T = 0.26;
export const SHOWCASE_SLAB_T = 0.22;

/** Local offsets (relative to SHOWCASE_TOWER_CENTER) of the concrete switchback stairwell core. */
export const SHOWCASE_STAIR = {
  dx0: 2.6,
  dz0: 0.8,
  dx1: 6.4,
  dz1: 6.2,
  near: 1.2,
  run: 3.0,
  flightW: 1.6,
} as const;

export const SHOWCASE_OWNER = 4e15;
export const SHOWCASE_PROPS_OWNER = 4e15 + 1;
const SHOWCASE_CONTAINER_BASE = 4_000_000_000;

export const PROP_TARGET_HEIGHTS = {
  desk: 1.1,
  turnstile: 1.05,
  elevator: 2.5,
} as const;

/** Lobby prop transforms inside ground floor (center relative to SHOWCASE_TOWER_CENTER). */
export const LOBBY_PROP_PLACEMENTS = {
  turnstile: { dx: -1.15, dz: -5.5, yaw: 0 },
  desk: { dx: -3.6, dz: -1.2, yaw: 0 },
  elevator: { dx: -3.6, dz: SHOWCASE_TOWER_WIDTH * 0.5 - SHOWCASE_WALL_T - 0.14, yaw: Math.PI },
} as const;

export interface AssembledTower {
  group: Group;
  totalHeight: number;
  size: Vector3;
  shaftSize: Vector3;
  roofDeckY: number;
  beaconPos: Vector3;
}

const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();

/** Shifts direct children of a clean object so its XZ center is at 0 and its bottom rests at y = 0. */
export function normalizeModulePivot(obj: Object3D): Box3 {
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);

  const box = new Box3().setFromObject(obj);
  if (box.isEmpty()) return box;

  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  const minY = box.min.y;
  for (const child of obj.children) {
    child.position.x -= cx;
    child.position.y -= minY;
    child.position.z -= cz;
  }
  obj.updateMatrixWorld(true);
  return new Box3().setFromObject(obj);
}

/**
 * Normalizes a module using its upper shaft vertices (above `shaftMinYFrac` of height) for XZ centering,
 * so protruding canopies on the ground floor do not pull the tower's main shaft off-center. Bottom sits at y = 0.
 */
export function normalizeShaftPivot(obj: Object3D, shaftMinYFrac = 0.72): { fullBox: Box3; shaftSize: Vector3 } {
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  obj.scale.set(1, 1, 1);
  obj.updateMatrixWorld(true);

  const fullBox = new Box3().setFromObject(obj);
  if (fullBox.isEmpty()) return { fullBox, shaftSize: new Vector3() };

  const yCut = fullBox.min.y + (fullBox.max.y - fullBox.min.y) * shaftMinYFrac;
  let sMinX = Infinity;
  let sMaxX = -Infinity;
  let sMinZ = Infinity;
  let sMaxZ = -Infinity;
  const v = new Vector3();

  obj.traverse((child) => {
    if (!(child instanceof Mesh) || !child.geometry) return;
    const pos = child.geometry.getAttribute('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
      if (v.y >= yCut) {
        if (v.x < sMinX) sMinX = v.x;
        if (v.x > sMaxX) sMaxX = v.x;
        if (v.z < sMinZ) sMinZ = v.z;
        if (v.z > sMaxZ) sMaxZ = v.z;
      }
    }
  });

  const cx = Number.isFinite(sMinX) ? (sMinX + sMaxX) * 0.5 : (fullBox.min.x + fullBox.max.x) * 0.5;
  const cz = Number.isFinite(sMinZ) ? (sMinZ + sMaxZ) * 0.5 : (fullBox.min.z + fullBox.max.z) * 0.5;
  const minY = fullBox.min.y;
  for (const child of obj.children) {
    child.position.x -= cx;
    child.position.y -= minY;
    child.position.z -= cz;
  }
  obj.updateMatrixWorld(true);

  const shaftW = Number.isFinite(sMinX) ? sMaxX - sMinX : fullBox.max.x - fullBox.min.x;
  const shaftD = Number.isFinite(sMinZ) ? sMaxZ - sMinZ : fullBox.max.z - fullBox.min.z;
  const outFull = new Box3().setFromObject(obj);
  return {
    fullBox: outFull,
    shaftSize: new Vector3(shaftW, outFull.max.y - outFull.min.y, shaftD),
  };
}

export type TriPredicate = (
  mx: number,
  my: number,
  mz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
) => boolean;

/** Filters out triangles from `mod` whose transformed (parent-space) coordinates satisfy `shouldRemove`. */
export function cutModuleTriangles(mod: Object3D, shouldRemove: TriPredicate): number {
  mod.updateMatrixWorld(true);
  const invParent = mod.parent ? new Matrix4().copy(mod.parent.matrixWorld).invert() : new Matrix4();
  const toTowerLocal = new Matrix4();
  let removed = 0;

  mod.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return;
    const srcGeo: BufferGeometry = obj.geometry;
    const pos = srcGeo.getAttribute('position');
    if (!pos) return;

    toTowerLocal.multiplyMatrices(invParent, obj.matrixWorld);
    const srcIdx = srcGeo.getIndex();
    const triCount = Math.floor((srcIdx ? srcIdx.count : pos.count) / 3);
    const kept: number[] = [];

    for (let t = 0; t < triCount; t++) {
      const i0 = srcIdx ? srcIdx.getX(t * 3) : t * 3;
      const i1 = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;

      _v0.fromBufferAttribute(pos, i0).applyMatrix4(toTowerLocal);
      _v1.fromBufferAttribute(pos, i1).applyMatrix4(toTowerLocal);
      _v2.fromBufferAttribute(pos, i2).applyMatrix4(toTowerLocal);

      const mx = (_v0.x + _v1.x + _v2.x) / 3;
      const my = (_v0.y + _v1.y + _v2.y) / 3;
      const mz = (_v0.z + _v1.z + _v2.z) / 3;
      const minX = Math.min(_v0.x, _v1.x, _v2.x);
      const minY = Math.min(_v0.y, _v1.y, _v2.y);
      const minZ = Math.min(_v0.z, _v1.z, _v2.z);
      const maxX = Math.max(_v0.x, _v1.x, _v2.x);
      const maxY = Math.max(_v0.y, _v1.y, _v2.y);
      const maxZ = Math.max(_v0.z, _v1.z, _v2.z);

      if (shouldRemove(mx, my, mz, minX, minY, minZ, maxX, maxY, maxZ)) {
        removed++;
      } else {
        kept.push(i0, i1, i2);
      }
    }

    if (kept.length < triCount * 3) {
      const cloned = srcGeo.clone();
      const idxArr = pos.count > 65535 ? new Uint32Array(kept) : new Uint16Array(kept);
      cloned.setIndex(new BufferAttribute(idxArr, 1));
      cloned.computeBoundingBox();
      cloned.computeBoundingSphere();
      obj.geometry = cloned;
    }
  });

  return removed;
}

/** Finds the highest antenna/spire tip in `root`'s coordinate space. */
function findHighestTip(root: Object3D): Vector3 {
  root.updateMatrixWorld(true);
  const invRoot = root.matrixWorld.clone().invert();
  const v = new Vector3();
  let maxY = -Infinity;
  const pts: Vector3[] = [];

  root.traverse((obj) => {
    if (!(obj instanceof Mesh) || !obj.geometry) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos) return;
    const toLocal = obj.matrixWorld.clone().premultiply(invRoot);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
      if (v.y > maxY) maxY = v.y;
      pts.push(v.clone());
    }
  });

  if (pts.length === 0 || !Number.isFinite(maxY)) return new Vector3(0, 0, 0);
  const threshold = maxY - 0.15;
  let sx = 0;
  let sz = 0;
  let cnt = 0;
  for (const p of pts) {
    if (p.y >= threshold) {
      sx += p.x;
      sz += p.z;
      cnt++;
    }
  }
  return cnt > 0 ? new Vector3(sx / cnt, maxY, sz / cnt) : new Vector3(0, maxY, 0);
}

/**
 * Assembles base (rotated PI so canopy/entrance faces -Z road) -> mid_2f sections (0/90/180/270 deg) -> roof
 * strictly along central (X, Z) shaft axis with zero tilt, zero vertical gaps, and open doorway/stair cuts.
 */
export function assembleSkyscraper(
  baseScene: Object3D,
  midScene: Object3D,
  roofScene: Object3D,
  opts: { width?: number; midCount?: number; seed?: number } = {},
): AssembledTower {
  const width = opts.width ?? SHOWCASE_TOWER_WIDTH;
  const midCount = Math.max(4, Math.min(6, opts.midCount ?? SHOWCASE_MID_SECTIONS));
  const rand = mulberry32(opts.seed ?? 20261124);
  const group = new Group();
  group.name = 'SkyscraperShowcaseTower';

  let yCursor = 0;
  const innerRim = width * 0.5 - 0.65;

  const placeAligned = (
    src: Object3D,
    targetHeight: number,
    yawRad: number,
    shaftNormalized: boolean,
    cutPred?: TriPredicate,
  ): Object3D => {
    const mod = src.clone(true);
    let sx: number;
    let sy: number;
    let sz: number;
    if (shaftNormalized) {
      const { shaftSize } = normalizeShaftPivot(mod, 0.72);
      sx = shaftSize.x > 1e-4 ? width / shaftSize.x : 1;
      sz = shaftSize.z > 1e-4 ? width / shaftSize.z : 1;
      sy = shaftSize.y > 1e-4 ? targetHeight / shaftSize.y : 1;
    } else {
      const rawBox = normalizeModulePivot(mod);
      const rawSize = rawBox.getSize(new Vector3());
      sx = rawSize.x > 1e-4 ? width / rawSize.x : 1;
      sz = rawSize.z > 1e-4 ? width / rawSize.z : 1;
      sy = rawSize.y > 1e-4 ? targetHeight / rawSize.y : 1;
    }
    mod.scale.set(sx, sy, sz);
    mod.rotation.set(0, yawRad, 0);
    mod.position.set(0, yCursor, 0);
    group.add(mod);
    mod.updateMatrixWorld(true);

    const placedBox = new Box3().setFromObject(mod);
    const nextY = placedBox.max.y;
    if (cutPred) cutModuleTriangles(mod, cutPred);
    yCursor = nextY;
    return mod;
  };

  // 1) Base module: rotated Math.PI so +Z canopy/entry faces -Z road; cut entrance & bottom/top caps
  placeAligned(baseScene, SHOWCASE_BASE_H, Math.PI, true, (mx, my, mz, minX, minY, minZ, maxX, maxY, maxZ) => {
    // Bottom & top floor caps inside outer walls
    if (Math.abs(mx) < innerRim && Math.abs(mz) < innerRim && (maxY < 0.35 || minY > SHOWCASE_BASE_H - 0.35)) return true;
    // Protect canopy roof slab above y >= 3.6
    if (minY >= 3.6) return false;
    // Cut doorway panels/walls under canopy along -Z facade (z in [-9.4, -7.4], |x| <= 2.45, y < 3.45)
    if (Math.abs(mx) <= 2.45 && mz >= -9.4 && mz <= -7.4 && my < 3.45) return true;
    // Also remove any broad triangles overlapping the clear 4m x 2.7m walkthrough opening
    const hitsWalk = maxX > -2.0 && minX < 2.0 && maxZ > -8.9 && minZ < -7.6 && maxY > 0.04 && minY < 2.75 && maxY < 4.2;
    return hitsWalk;
  });

  // 2) mid_2f sections: strictly 0 / 90 / 180 / 270 deg about exact shaft center, open bottom/top caps
  for (let i = 0; i < midCount; i++) {
    const qTurn = Math.floor(rand() * 4);
    const yStart = yCursor;
    const yEnd = yCursor + SHOWCASE_MID_H;
    placeAligned(
      midScene,
      SHOWCASE_MID_H,
      qTurn * (Math.PI / 2),
      false,
      (mx, _my, mz, _minX, minY, _minZ, _maxX, maxY) =>
        Math.abs(mx) < innerRim && Math.abs(mz) < innerRim && (maxY < yStart + 0.35 || minY > yEnd - 0.35),
    );
  }

  // 3) Roof module: rotated Math.PI so booth lands in (+X, +Z) over stairwell and opens -Z onto roof deck
  const roofBaseY = yCursor;
  const deckY = roofBaseY + SHOWCASE_ROOF_DECK_OFFSET;
  placeAligned(
    roofScene,
    SHOWCASE_ROOF_H,
    Math.PI,
    false,
    (mx, my, mz, minX, minY, minZ, maxX, maxY, maxZ) => {
      // Bottom cap inside outer rim
      if (Math.abs(mx) < innerRim && Math.abs(mz) < innerRim && maxY < roofBaseY + 0.35) return true;
      // Stairwell opening through the roof deck (do not touch booth ceiling above deckY + 2.8)
      const inStairShaft =
        maxX > SHOWCASE_STAIR.dx0 - 0.15 &&
        minX < SHOWCASE_STAIR.dx1 + 0.15 &&
        maxZ > SHOWCASE_STAIR.dz0 + SHOWCASE_STAIR.near - 0.15 &&
        minZ < SHOWCASE_STAIR.dz1 + 0.15;
      if (inStairShaft && my < deckY + 0.55 && maxY < deckY + 2.8) return true;
      // Booth -Z exit doorway onto the open roof deck
      const hitsBoothExit =
        maxX > SHOWCASE_STAIR.dx0 + 0.05 &&
        minX < SHOWCASE_STAIR.dx1 - 0.05 &&
        maxZ > SHOWCASE_STAIR.dz0 - 0.9 &&
        minZ < SHOWCASE_STAIR.dz0 + 0.9 &&
        maxY > deckY + 0.05 &&
        minY < deckY + 2.65 &&
        maxY < deckY + 3.4;
      if (hitsBoothExit) return true;
      // Also clear any interior ceiling slab immediately above the booth doorway/landing
      if (
        Math.abs(mx - (SHOWCASE_STAIR.dx0 + SHOWCASE_STAIR.dx1) * 0.5) < 2.1 &&
        mz >= SHOWCASE_STAIR.dz0 - 0.5 &&
        mz <= SHOWCASE_STAIR.dz1 + 0.2 &&
        my >= roofBaseY + 0.2 &&
        my <= deckY + 0.6
      ) {
        return true;
      }
      return false;
    },
  );

  group.updateMatrixWorld(true);
  const fullBox = new Box3().setFromObject(group);
  const size = fullBox.getSize(new Vector3());
  const beaconPos = findHighestTip(group);

  return {
    group,
    totalHeight: size.y,
    size,
    shaftSize: new Vector3(width, size.y, width),
    roofDeckY: SHOWCASE_ROOF_DECK_LOCAL_Y,
    beaconPos,
  };
}

/** Normalizes a prop pivot onto y = 0 (centered X/Z) and uniformly scales it to `targetHeight` meters. */
export function fitLobbyProp(src: Object3D, targetHeight: number): { group: Group; size: Vector3 } {
  const wrap = new Group();
  const prop = src.clone(true);
  const rawBox = normalizeModulePivot(prop);
  const rawH = rawBox.max.y - rawBox.min.y;
  const scale = rawH > 1e-4 ? targetHeight / rawH : 1;
  prop.scale.setScalar(scale);
  wrap.add(prop);
  wrap.updateMatrixWorld(true);
  const finalBox = new Box3().setFromObject(wrap);
  return { group: wrap, size: finalBox.getSize(new Vector3()) };
}

export class SkyscraperShowcase {
  readonly root = new Group();
  private interiorGroup: Group | null = null;
  private beaconMat: MeshBasicMaterial | null = null;
  private beaconLight: PointLight | null = null;
  private readonly geosToDispose: { dispose(): void }[] = [];
  private readonly matsToDispose: { dispose(): void }[] = [];
  private readonly texsToDispose: Texture[] = [];
  private blinkT = 0;
  private disposed = false;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    private readonly anisotropy = 4,
    loadAssets = true,
    private readonly containers?: Containers,
    private readonly shelters?: Shelters,
  ) {
    this.root.name = 'SkyscraperShowcaseRoot';
    this.scene.add(this.root);
    this.buildInterior();
    this.registerFallbackPropColliders();
    if (loadAssets && typeof fetch !== 'undefined') {
      void this.loadAll();
    }
  }

  /** Returns true when `(x, z)` lies within the outer footprint of the skyscraper shaft. */
  containsFootprint(x: number, z: number): boolean {
    const hw = SHOWCASE_TOWER_WIDTH * 0.5;
    return Math.abs(x - SHOWCASE_TOWER_CENTER.x) <= hw && Math.abs(z - SHOWCASE_TOWER_CENTER.z) <= hw;
  }

  /** Exact walkable surface height inside floors/stairs/roof (null outside footprint -> zero mid-air ledges). */
  surfaceY(x: number, z: number, y: number): number | null {
    if (!this.containsFootprint(x, z)) return null;

    const y0 = PAVE.plaza;
    const hw = SHOWCASE_TOWER_WIDTH * 0.5;
    const inInner =
      Math.abs(x - SHOWCASE_TOWER_CENTER.x) <= hw - SHOWCASE_WALL_T + 0.05 &&
      Math.abs(z - SHOWCASE_TOWER_CENTER.z) <= hw - SHOWCASE_WALL_T + 0.05;

    const dx = x - SHOWCASE_TOWER_CENTER.x;
    const dz = z - SHOWCASE_TOWER_CENTER.z;
    const sx0 = SHOWCASE_STAIR.dx0;
    const sx1 = SHOWCASE_STAIR.dx1;
    const sz0 = SHOWCASE_STAIR.dz0;
    const sz1 = SHOWCASE_STAIR.dz1;
    const zf0 = sz0 + SHOWCASE_STAIR.near;
    const inCore = dx >= sx0 && dx <= sx1 && dz >= sz0 && dz <= sz1;
    const inHole = dx >= sx0 && dx <= sx1 && dz >= zf0 && dz <= sz1;

    const localY = y - y0;
    const reach = localY + 0.55;
    const kc = Math.max(0, Math.min(SHOWCASE_FLOORS, Math.round(localY / SHOWCASE_FLOOR_H)));
    let best = -Infinity;
    let lowest = Infinity;

    const consider = (hLocal: number) => {
      if (hLocal < lowest) lowest = hLocal;
      if (hLocal <= reach && hLocal > best) best = hLocal;
    };

    // Roof deck covers entire footprint outside the stair shaft hole
    if (!inHole) consider(SHOWCASE_ROOF_DECK_LOCAL_Y);

    for (let k = Math.max(0, kc - 1); k <= Math.min(SHOWCASE_FLOORS, kc + 1); k++) {
      const yk = k * SHOWCASE_FLOOR_H;
      // Upper interior floor slabs stay strictly inside the exterior perimeter walls
      if (k >= 1 && !inInner) continue;

      if (!inCore) {
        if (k < SHOWCASE_FLOORS) consider(yk);
        continue;
      }

      if (dz < zf0) {
        // Near landing belongs to storeys 0..11 AND to Floor 12 transit landing -> Roof Deck
        consider(yk);
        continue;
      }

      // Inside stair flights/half-landing [zf0 .. sz1]
      const halfH = k === SHOWCASE_FLOORS ? SHOWCASE_ROOF_DECK_OFFSET * 0.5 : SHOWCASE_FLOOR_H * 0.5;
      if (dz >= zf0 + SHOWCASE_STAIR.run) {
        consider(yk + halfH);
      } else if (dx < sx0 + SHOWCASE_STAIR.flightW) {
        consider(yk + ((dz - zf0) / SHOWCASE_STAIR.run) * halfH);
      } else if (dx > sx1 - SHOWCASE_STAIR.flightW) {
        consider(yk + halfH + ((zf0 + SHOWCASE_STAIR.run - dz) / SHOWCASE_STAIR.run) * halfH);
      }
    }

    if (best > -Infinity) return y0 + best;
    return lowest < Infinity ? y0 + lowest : null;
  }

  /** Surface material tag for phase-locked footsteps inside the skyscraper. */
  stepSurface(x: number, z: number, y: number): 'tile' | 'concrete' | 'wood' | null {
    if (!this.containsFootprint(x, z)) return null;
    const y0 = PAVE.plaza;
    const localY = y - y0;
    if (localY >= SHOWCASE_ROOF_DECK_LOCAL_Y - 0.35) return 'concrete';
    const dx = x - SHOWCASE_TOWER_CENTER.x;
    const dz = z - SHOWCASE_TOWER_CENTER.z;
    if (dx >= SHOWCASE_STAIR.dx0 && dx <= SHOWCASE_STAIR.dx1 && dz >= SHOWCASE_STAIR.dz0 + SHOWCASE_STAIR.near && dz <= SHOWCASE_STAIR.dz1) {
      return 'concrete';
    }
    const floorIdx = Math.round(localY / SHOWCASE_FLOOR_H);
    return floorIdx <= 6 ? 'tile' : 'wood';
  }

  /** Synchronously builds walkable floors, stairwell, perimeter/partition colliders, props trim, and containers. */
  private buildInterior(): void {
    const cx = SHOWCASE_TOWER_CENTER.x;
    const cz = SHOWCASE_TOWER_CENTER.z;
    const hw = SHOWCASE_TOWER_WIDTH * 0.5;
    const y0 = PAVE.plaza;
    const x0 = cx - hw;
    const x1 = cx + hw;
    const z0 = cz - hw;
    const z1 = cz + hw;
    const ix0 = x0 + SHOWCASE_WALL_T;
    const ix1 = x1 - SHOWCASE_WALL_T;
    const iz0 = z0 + SHOWCASE_WALL_T;
    const iz1 = z1 - SHOWCASE_WALL_T;

    const sx0 = cx + SHOWCASE_STAIR.dx0;
    const sx1 = cx + SHOWCASE_STAIR.dx1;
    const sz0 = cz + SHOWCASE_STAIR.dz0;
    const sz1 = cz + SHOWCASE_STAIR.dz1;
    const zf0 = sz0 + SHOWCASE_STAIR.near;
    const zf1 = zf0 + SHOWCASE_STAIR.run;

    const batch = new StaticBatch();
    const sink = new PackedColliders();
    const b = new Builder(batch, sink);
    b.setIdBase(SHOWCASE_CONTAINER_BASE);

    // Flat paved entrance apron from sidewalk (z = 5.6) right up to doorway threshold (z = 9.0)
    b.block(0x706e68, cx - 4.5, 0, 5.6, 9.0, y0, z0 - 5.6, 'concrete', false);

    // 1) Perimeter wall colliders (0.45 m thick -> zero tunneling; Ground Floor front leaves open 4.6 m entrance)
    const wallTop = y0 + SHOWCASE_FLOORS * SHOWCASE_FLOOR_H;
    const doorHalfW = 2.3;
    const doorClearH = 3.3;
    // West, East, Back full height
    sink.addBox(x0, z0, x0 + SHOWCASE_WALL_T, z1, y0, wallTop);
    sink.addBox(x1 - SHOWCASE_WALL_T, z0, x1, z1, y0, wallTop);
    sink.addBox(x0, z1 - SHOWCASE_WALL_T, x1, z1, y0, wallTop);
    // Front wall (-Z): left wing, right wing full height + header above entrance up to top floor
    sink.addBox(x0, z0, cx - doorHalfW, z0 + SHOWCASE_WALL_T, y0, wallTop);
    sink.addBox(cx + doorHalfW, z0, x1, z0 + SHOWCASE_WALL_T, y0, wallTop);
    sink.addBox(cx - doorHalfW, z0, cx + doorHalfW, z0 + SHOWCASE_WALL_T, y0 + doorClearH, wallTop);
    // Exterior canopy front pillars flanking entrance approach (z ≈ 7.07, dx = ±4.1)
    sink.addBox(cx - 4.35, z0 - 2.15, cx - 3.85, z0 - 1.65, y0, y0 + 4.4);
    sink.addBox(cx + 3.85, z0 - 2.15, cx + 4.35, z0 - 1.65, y0, y0 + 4.4);

    // 2) Stairwell enclosure walls & center divider (y0 .. floor 12 -> roof deck)
    const stairColTop = y0 + SHOWCASE_ROOF_DECK_LOCAL_Y;
    // West, East, Back concrete walls of stairwell core
    b.blockY(0x6e6c66, sx0 - SHOWCASE_PART_T, y0, sz0, SHOWCASE_PART_T, SHOWCASE_ROOF_DECK_LOCAL_Y, sz1 - sz0, 'concrete');
    b.blockY(0x6e6c66, sx1, y0, sz0, SHOWCASE_PART_T, SHOWCASE_ROOF_DECK_LOCAL_Y, sz1 - sz0, 'concrete');
    b.blockY(0x6e6c66, sx0 - SHOWCASE_PART_T, y0, sz1, sx1 - sx0 + 2 * SHOWCASE_PART_T, SHOWCASE_ROOF_DECK_LOCAL_Y, SHOWCASE_PART_T, 'concrete');
    // Center divider between Flight A (left) and Flight B (right)
    b.blockY(0x4a4c50, sx0 + SHOWCASE_STAIR.flightW, y0, zf0, sx1 - sx0 - 2 * SHOWCASE_STAIR.flightW, SHOWCASE_ROOF_DECK_LOCAL_Y, SHOWCASE_STAIR.run, 'metal');

    // Front stairwell wall (z = sz0): open portal [sx0 + 0.25 .. sx1 - 0.25] on storeys 0..11; solid across floor 12 transit
    const portalW = sx1 - sx0 - 0.5;
    b.blockY(0x6e6c66, sx0 - SHOWCASE_PART_T, y0, sz0 - SHOWCASE_PART_T, SHOWCASE_PART_T + 0.25, SHOWCASE_ROOF_DECK_LOCAL_Y, SHOWCASE_PART_T, 'concrete');
    b.blockY(0x6e6c66, sx1 - 0.25, y0, sz0 - SHOWCASE_PART_T, SHOWCASE_PART_T + 0.25, SHOWCASE_ROOF_DECK_LOCAL_Y, SHOWCASE_PART_T, 'concrete');
    for (let k = 0; k < SHOWCASE_FLOORS; k++) {
      const fy = y0 + k * SHOWCASE_FLOOR_H;
      const lintelH = SHOWCASE_FLOOR_H - 2.6;
      b.blockY(0x6e6c66, sx0 + 0.25, fy + 2.6, sz0 - SHOWCASE_PART_T, portalW, lintelH, SHOWCASE_PART_T, 'concrete');
      // Floor number plaque beside entrance
      b.block(0xbcb6a4, sx0 - 0.55, fy + 1.55, sz0 - SHOWCASE_PART_T - 0.02, 0.34, 0.36, 0.03, 'plaster');
    }
    // Close front stair opening between Floor 12 (45.6) and Roof Deck (48.05) so players stay inside transit stairwell up to roof
    b.blockY(0x6e6c66, sx0 + 0.25, y0 + SHOWCASE_FLOORS * SHOWCASE_FLOOR_H, sz0 - SHOWCASE_PART_T, portalW, SHOWCASE_ROOF_DECK_OFFSET, SHOWCASE_PART_T, 'concrete');

    // Stair flights & half-landings for k = 0..12
    const visSteps = 12;
    const colSteps = 15;
    for (let k = 0; k <= SHOWCASE_FLOORS; k++) {
      const fy = y0 + k * SHOWCASE_FLOOR_H;
      const fullRise = k === SHOWCASE_FLOORS ? SHOWCASE_ROOF_DECK_OFFSET : SHOWCASE_FLOOR_H;
      const halfRise = fullRise * 0.5;
      const vRise = halfRise / visSteps;
      const vTread = SHOWCASE_STAIR.run / visSteps;

      // Visual concrete steps (no box collider per visual step; smooth fine-stepped ramp colliders added below)
      for (let s = 0; s < visSteps; s++) {
        b.block(0x6e6c66, sx0, fy + s * vRise, zf0 + s * vTread, SHOWCASE_STAIR.flightW, vRise, vTread, 'concrete', false);
        b.block(
          0x6e6c66,
          sx1 - SHOWCASE_STAIR.flightW,
          fy + halfRise + s * vRise,
          zf0 + SHOWCASE_STAIR.run - (s + 1) * vTread,
          SHOWCASE_STAIR.flightW,
          vRise,
          vTread,
          'concrete',
          false,
        );
      }

      // Smooth multi-slice ramp colliders (top flush slightly beneath analytic surfaceY ramp, solid underside)
      const cRise = halfRise / colSteps;
      const cTread = SHOWCASE_STAIR.run / colSteps;
      for (let s = 0; s < colSteps; s++) {
        const topA = fy + (s + 0.75) * cRise;
        const botA = Math.max(fy, topA - 0.32);
        sink.addBox(sx0, zf0 + s * cTread, sx0 + SHOWCASE_STAIR.flightW, zf0 + (s + 1) * cTread, botA, topA);

        const topB = fy + halfRise + (s + 0.75) * cRise;
        const botB = Math.max(fy + halfRise, topB - 0.32);
        sink.addBox(
          sx1 - SHOWCASE_STAIR.flightW,
          zf0 + SHOWCASE_STAIR.run - (s + 1) * cTread,
          sx1,
          zf0 + SHOWCASE_STAIR.run - s * cTread,
          botB,
          topB,
        );
      }

      // Half-landing concrete slab (solid)
      b.blockY(0x6c6a64, sx0, fy + halfRise - SHOWCASE_SLAB_T, zf1, sx1 - sx0, SHOWCASE_SLAB_T, sz1 - zf1, 'concrete');
      // Stairwell ceiling light
      b.block(0xe2e0d4, sx0 + 1.2, fy + halfRise + 2.2, zf1 + 0.35, 1.4, 0.06, 0.25, 'lamp');
    }

    // 3) Storeys k = 0..11: Floor slabs (split cleanly around stairwell hole [sx0..sx1] x [zf0..sz1]), walls & furniture
    for (let k = 0; k < SHOWCASE_FLOORS; k++) {
      const fy = y0 + k * SHOWCASE_FLOOR_H;
      const sy = k === 0 ? y0 : fy - SHOWCASE_SLAB_T;
      const slabT = k === 0 ? 0.05 : SHOWCASE_SLAB_T;
      const floorSurf = k <= 6 ? 'tile' : 'wood';
      const floorCol = k === 0 ? 0x908b82 : k <= 6 ? 0x807e78 : 0x7b6650;

      // 4 rectangular slabs covering interior around stair shaft cutout [sx0..sx1] x [zf0..sz1]
      b.block(floorCol, ix0, sy, iz0, ix1 - ix0, slabT, zf0 - iz0, floorSurf, k > 0);
      b.block(floorCol, ix0, sy, zf0, sx0 - SHOWCASE_PART_T - ix0, slabT, iz1 - zf0, floorSurf, k > 0);
      b.block(floorCol, sx1 + SHOWCASE_PART_T, sy, zf0, ix1 - (sx1 + SHOWCASE_PART_T), slabT, iz1 - zf0, floorSurf, k > 0);
      b.block(floorCol, sx0 - SHOWCASE_PART_T, sy, sz1 + SHOWCASE_PART_T, sx1 - sx0 + 2 * SHOWCASE_PART_T, slabT, iz1 - (sz1 + SHOWCASE_PART_T), floorSurf, k > 0);

      if (k === 0) {
        this.buildLobbyFloor(b, fy, ix0, iz0, ix1, iz1, cx, cz, sz0);
      } else {
        this.buildUpperFloor(b, k, fy, ix0, iz0, ix1, iz1, sx0, sz0);
      }
    }

    // 4) Roof Deck (y = y0 + SHOWCASE_ROOF_DECK_LOCAL_Y): concrete deck slab around stair shaft + rooftop booth + parapet
    const ry = stairColTop;
    const roofCeilingY = ry - SHOWCASE_SLAB_T;
    // Floor 11 ceiling / Roof deck structural slab around stair shaft
    b.block(0x706e68, ix0, roofCeilingY, iz0, ix1 - ix0, SHOWCASE_SLAB_T, zf0 - iz0, 'concrete', true);
    b.block(0x706e68, ix0, roofCeilingY, zf0, sx0 - SHOWCASE_PART_T - ix0, SHOWCASE_SLAB_T, iz1 - zf0, 'concrete', true);
    b.block(0x706e68, sx1 + SHOWCASE_PART_T, roofCeilingY, zf0, ix1 - (sx1 + SHOWCASE_PART_T), SHOWCASE_SLAB_T, iz1 - zf0, 'concrete', true);
    b.block(0x706e68, sx0 - SHOWCASE_PART_T, roofCeilingY, sz1 + SHOWCASE_PART_T, sx1 - sx0 + 2 * SHOWCASE_PART_T, SHOWCASE_SLAB_T, iz1 - (sz1 + SHOWCASE_PART_T), 'concrete', true);

    // Roof perimeter parapet colliders (+1.10 m high above roof deck so player overlooks city safely)
    // Also add Floor 12 near-landing slab (45.6 m) inside the stairwell transit vestibule
    b.block(
      0x6c6a64,
      sx0,
      y0 + SHOWCASE_FLOORS * SHOWCASE_FLOOR_H - SHOWCASE_SLAB_T,
      sz0,
      sx1 - sx0,
      SHOWCASE_SLAB_T,
      SHOWCASE_STAIR.near,
      'concrete',
      true,
    );
    const pTop = ry + 1.1;
    sink.addBox(x0, z0, x1, z0 + 0.55, ry, pTop);
    sink.addBox(x0, z1 - 0.55, x1, z1, ry, pTop);
    sink.addBox(x0, z0, x0 + 0.55, z1, ry, pTop);
    sink.addBox(x1 - 0.55, z0, x1, z1, ry, pTop);

    // Rooftop booth enclosure (matching roof.glb booth in (+X,+Z), exit portal open along -Z at z = sz0)
    b.blockY(0x64625c, sx0 - SHOWCASE_PART_T, ry, sz0, SHOWCASE_PART_T, 3.2, sz1 - sz0, 'concrete');
    b.blockY(0x64625c, sx1, ry, sz0, SHOWCASE_PART_T, 3.2, sz1 - sz0, 'concrete');
    b.blockY(0x64625c, sx0 - SHOWCASE_PART_T, ry, sz1, sx1 - sx0 + 2 * SHOWCASE_PART_T, 3.2, SHOWCASE_PART_T, 'concrete');
    b.blockY(0x64625c, sx0 + 0.25, ry + 2.55, sz0 - SHOWCASE_PART_T, portalW, 0.65, SHOWCASE_PART_T, 'concrete');
    b.block(0x5c5a55, sx0 - SHOWCASE_PART_T, ry + 3.2, sz0 - SHOWCASE_PART_T, sx1 - sx0 + 2 * SHOWCASE_PART_T, 0.2, sz1 - sz0 + 2 * SHOWCASE_PART_T, 'concrete', true);
    // Solid collider around the antenna/HVAC western half of the GLB booth (+0.6..+2.5, +0.2..+6.2)
    sink.addBox(cx + 0.6, cz + 0.2, sx0 - SHOWCASE_PART_T, sz1 + SHOWCASE_PART_T, ry, ry + 3.4);

    // Rooftop supply crate beside booth entrance
    this.addCrate(b, cx + 1.2, ry, cz - 2.6, 1.0, 0.85, 0.9);

    const interiorMesh = meshesFromBuffers(batch.buildBuffers(), 'skyscraperShowcaseInterior');
    this.interiorGroup = interiorMesh;
    this.root.add(interiorMesh);

    this.world.addPacked(SHOWCASE_OWNER, new Float32Array(sink.data));
    this.shelters?.add(SHOWCASE_OWNER, new Float32Array([x0, z0, x1, z1, stairColTop]));
    this.containers?.addChunk(
      SHOWCASE_OWNER,
      'downtown',
      b.containers.map((c, idx) => ({ ...c, id: c.id ?? SHOWCASE_CONTAINER_BASE + idx })),
    );
  }

  /** Builds lobby floor features, clean entrance soffit/columns, lighting, and security desk container zone. */
  private buildLobbyFloor(
    b: Builder,
    fy: number,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    cx: number,
    cz: number,
    sz0: number,
  ): void {
    const h = SHOWCASE_FLOOR_H - SHOWCASE_SLAB_T;
    // Two architectural marble pillars flanking lobby central aisle
    b.blockY(0x54524c, cx - 5.2, fy, cz - 3.6, 0.65, h, 0.65, 'concrete');
    b.blockY(0x54524c, cx + 4.55, fy, cz - 3.6, 0.65, h, 0.65, 'concrete');
    // Interior concrete base trim along side and back walls (gives finished room edge around tile floor)
    b.blockY(0x6e6a62, ix0, fy, iz0, 0.12, 1.05, iz1 - iz0, 'concrete');
    b.blockY(0x6e6a62, ix1 - 0.12, fy, iz0, 0.12, 1.05, iz1 - iz0, 'concrete');
    b.blockY(0x6e6a62, ix0, fy, iz1 - 0.12, ix1 - ix0, 1.05, 0.12, 'concrete');
    // Illuminated lobby sign header above stairwell doorway
    b.block(0xd8e0cc, cx + 3.4, fy + 2.75, sz0 - 0.34, 2.2, 0.22, 0.08, 'lamp');
    // Lobby overhead lights
    for (const lx of [cx - 4.0, cx, cx + 4.0]) {
      b.block(0xe8e6dc, lx - 0.9, fy + h - 0.06, cz - 4.0, 1.8, 0.05, 0.26, 'lamp');
      b.block(0xe8e6dc, lx - 0.9, fy + h - 0.06, cz + 0.2, 1.8, 0.05, 0.26, 'lamp');
    }
    // Reception security desk lootable search zone (placed over reception_desk_14k)
    const rx = cx + LOBBY_PROP_PLACEMENTS.desk.dx;
    const rz = cz + LOBBY_PROP_PLACEMENTS.desk.dz;
    b.container('reception', rx, rz, fy, [rx - 1.25, fy, rz - 1.25, rx + 1.25, fy + PROP_TARGET_HEIGHTS.desk, rz + 1.25]);
  }

  /** Builds corridor partitions, room dividers with open doorways, furniture & loot on storey `k` (1..11). */
  private buildUpperFloor(
    b: Builder,
    k: number,
    fy: number,
    ix0: number,
    iz0: number,
    ix1: number,
    iz1: number,
    sx0: number,
    sz0: number,
  ): void {
    const rand = mulberry32(20261124 + k * 997);
    const h = SHOWCASE_FLOOR_H - SHOWCASE_SLAB_T;
    const surf = k <= 6 ? 'plaster' : 'wood';
    const colWall = k <= 6 ? 0x9b9890 : 0xa59a86;
    const corrFrontZ = sz0 - 2.0 - SHOWCASE_PART_T; // z = 16.54
    const corrBackZ = sz0; // z = 18.80
    const doorW = 1.45;
    const doorH = 2.4;

    // Front corridor partition wall (full width divided into 3 rooms)
    const frontXs = [ix0, ix0 + 5.7, ix0 + 11.4, ix1];
    for (let u = 0; u < 3; u++) {
      const rx0 = frontXs[u];
      const rx1 = frontXs[u + 1];
      if (u > 0) b.blockY(colWall, rx0 - 0.13, fy, iz0, SHOWCASE_PART_T, h, corrFrontZ - iz0, surf);
      const gx = (rx0 + rx1) * 0.5 - doorW * 0.5;
      b.blockY(colWall, rx0, fy, corrFrontZ, gx - rx0, h, SHOWCASE_PART_T, surf);
      b.blockY(colWall, gx + doorW, fy, corrFrontZ, rx1 - (gx + doorW), h, SHOWCASE_PART_T, surf);
      b.blockY(colWall, gx, fy + doorH, corrFrontZ, doorW, h - doorH, SHOWCASE_PART_T, surf);

      // Furnish room (desk + cabinet / shelf + crate)
      const roomCx = (rx0 + rx1) * 0.5;
      this.addDesk(b, roomCx - 0.9, fy, iz0 + 2.2, k <= 6);
      if (u % 2 === k % 2) this.addCabinet(b, rx0 + 0.6, fy, iz0 + 4.4);
      else this.addCrate(b, rx1 - 1.1, fy, iz0 + 4.2, 0.95, 0.75, 0.85);
    }

    // Back rooms west of stairwell core ([ix0 .. sx0 - PART_T] x [corrBackZ .. iz1])
    const backRightX = sx0 - SHOWCASE_PART_T;
    const midBackX = (ix0 + backRightX) * 0.5;
    const backSpans: [number, number][] = [
      [ix0, midBackX],
      [midBackX, backRightX],
    ];
    b.blockY(colWall, midBackX - 0.13, fy, corrBackZ + SHOWCASE_PART_T, SHOWCASE_PART_T, h, iz1 - (corrBackZ + SHOWCASE_PART_T), surf);
    for (const [bx0, bx1] of backSpans) {
      const gx = (bx0 + bx1) * 0.5 - doorW * 0.5;
      b.blockY(colWall, bx0, fy, corrBackZ, gx - bx0, h, SHOWCASE_PART_T, surf);
      b.blockY(colWall, gx + doorW, fy, corrBackZ, bx1 - (gx + doorW), h, SHOWCASE_PART_T, surf);
      b.blockY(colWall, gx, fy + doorH, corrBackZ, doorW, h - doorH, SHOWCASE_PART_T, surf);

      const roomCx = (bx0 + bx1) * 0.5;
      if (rand() < 0.75) this.addDesk(b, roomCx, fy, iz1 - 2.1, k <= 6);
      if (rand() < 0.8) this.addCabinet(b, bx0 + 0.6, fy, iz1 - 4.3);
      else this.addCrate(b, bx1 - 1.1, fy, iz1 - 4.2, 0.9, 0.7, 0.8);
    }

    // Corridor ceiling light strips
    for (let lx = ix0 + 2.4; lx < ix1 - 1.5; lx += 5.0) {
      b.block(0xe2e0d4, lx - 0.7, fy + h - 0.06, corrFrontZ + 1.0, 1.4, 0.05, 0.22, 'lamp');
    }
  }

  private addDesk(b: Builder, cx: number, fy: number, cz: number, officeStyle: boolean): void {
    const col = officeStyle ? 0x625a50 : 0x6f533a;
    const w = 1.6;
    const d = 0.8;
    const h = 0.76;
    b.blockY(col, cx - w * 0.5, fy, cz - d * 0.5, w, h, d, 'wood');
    b.container('desk', cx, cz, fy, [cx - w * 0.5, fy, cz - d * 0.5, cx + w * 0.5, fy + h + 0.25, cz + d * 0.5]);
  }

  private addCabinet(b: Builder, x: number, fy: number, cz: number): void {
    const w = 0.75;
    const d = 0.65;
    const h = 1.45;
    b.blockY(0x4c5258, x, fy, cz - d * 0.5, w, h, d, 'metal');
    b.container('cabinet', x + w * 0.5, cz, fy, [x, fy, cz - d * 0.5, x + w, fy + h, cz + d * 0.5]);
  }

  private addCrate(b: Builder, x: number, fy: number, z: number, sx: number, sy: number, sz: number): void {
    b.block(0x7c6244, x, fy, z, sx, sy, sz, 'wood', true);
    b.container('crate', x + sx * 0.5, z + sz * 0.5, fy, [x, fy, z, x + sx, fy + sy, z + sz]);
  }

  /** Registers fallback colliders for the 3 inside-lobby props under SHOWCASE_PROPS_OWNER. */
  private registerFallbackPropColliders(): void {
    const y0 = PAVE.plaza;
    const cx = SHOWCASE_TOWER_CENTER.x;
    const cz = SHOWCASE_TOWER_CENTER.z;

    const tx = cx + LOBBY_PROP_PLACEMENTS.turnstile.dx;
    const tz = cz + LOBBY_PROP_PLACEMENTS.turnstile.dz;
    this.world.addOwned(SHOWCASE_PROPS_OWNER, tx - 0.34, tz - 0.5, tx + 0.34, tz + 0.5, y0, y0 + PROP_TARGET_HEIGHTS.turnstile);

    const dx = cx + LOBBY_PROP_PLACEMENTS.desk.dx;
    const dz = cz + LOBBY_PROP_PLACEMENTS.desk.dz;
    this.world.addOwned(SHOWCASE_PROPS_OWNER, dx - 1.22, dz - 1.23, dx + 1.22, dz + 1.23, y0, y0 + PROP_TARGET_HEIGHTS.desk);

    const ex = cx + LOBBY_PROP_PLACEMENTS.elevator.dx;
    const ez = cz + LOBBY_PROP_PLACEMENTS.elevator.dz;
    this.world.addOwned(SHOWCASE_PROPS_OWNER, ex - 1.18, ez - 0.12, ex + 1.18, ez + 0.12, y0, y0 + PROP_TARGET_HEIGHTS.elevator);
  }

  private async loadAll(): Promise<void> {
    try {
      await MeshoptDecoder.ready;
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);

      const [base, mid, roof, elevator, turnstile, desk] = await Promise.all([
        loader.loadAsync(baseUrl),
        loader.loadAsync(midUrl),
        loader.loadAsync(roofUrl),
        loader.loadAsync(elevatorUrl),
        loader.loadAsync(turnstileUrl),
        loader.loadAsync(deskUrl),
      ]);
      if (this.disposed) return;

      const y0 = PAVE.plaza;
      const cx = SHOWCASE_TOWER_CENTER.x;
      const cz = SHOWCASE_TOWER_CENTER.z;

      // 1) Assemble enterable 18 x 18 m modular skyscraper shell aligned on central (X, Z) axis facing -Z road
      const tower = assembleSkyscraper(base.scene, mid.scene, roof.scene, {
        width: SHOWCASE_TOWER_WIDTH,
        midCount: SHOWCASE_MID_SECTIONS,
        seed: 20261124,
      });
      tower.group.position.set(cx, y0, cz);
      this.prepVisuals(tower.group, true);
      this.root.add(tower.group);

      // Dim red blinking aviation warning light on antenna tip
      const beaconGeo = new SphereGeometry(0.18, 10, 8);
      const beaconMat = new MeshBasicMaterial({ color: 0xff2620 });
      const beaconMesh = new Mesh(beaconGeo, beaconMat);
      beaconMesh.position.copy(tower.beaconPos);
      beaconMesh.position.y += 0.14;
      tower.group.add(beaconMesh);
      const beaconLight = new PointLight(0xff261e, 1.4, 24, 2);
      beaconLight.position.copy(beaconMesh.position);
      tower.group.add(beaconLight);
      this.beaconMat = beaconMat;
      this.beaconLight = beaconLight;
      this.geosToDispose.push(beaconGeo);
      this.matsToDispose.push(beaconMat);

      // 2) Replace fallback prop colliders with exact loaded Box3 colliders — ALL INSIDE Ground Lobby
      this.world.removeOwner(SHOWCASE_PROPS_OWNER);

      const elevFitted = fitLobbyProp(elevator.scene, PROP_TARGET_HEIGHTS.elevator);
      elevFitted.group.rotation.y = LOBBY_PROP_PLACEMENTS.elevator.yaw;
      elevFitted.group.position.set(
        cx + LOBBY_PROP_PLACEMENTS.elevator.dx,
        y0,
        cz + SHOWCASE_TOWER_WIDTH * 0.5 - SHOWCASE_WALL_T - elevFitted.size.z * 0.5 - 0.03,
      );
      this.addPropWithCollider(elevFitted.group);

      const deskFitted = fitLobbyProp(desk.scene, PROP_TARGET_HEIGHTS.desk);
      deskFitted.group.rotation.y = LOBBY_PROP_PLACEMENTS.desk.yaw;
      deskFitted.group.position.set(cx + LOBBY_PROP_PLACEMENTS.desk.dx, y0, cz + LOBBY_PROP_PLACEMENTS.desk.dz);
      this.addPropWithCollider(deskFitted.group);

      const turnFitted = fitLobbyProp(turnstile.scene, PROP_TARGET_HEIGHTS.turnstile);
      turnFitted.group.rotation.y = LOBBY_PROP_PLACEMENTS.turnstile.yaw;
      turnFitted.group.position.set(cx + LOBBY_PROP_PLACEMENTS.turnstile.dx, y0, cz + LOBBY_PROP_PLACEMENTS.turnstile.dz);
      this.addPropWithCollider(turnFitted.group);
    } catch (err) {
      console.warn('SkyscraperShowcase load skipped:', err);
    }
  }

  private addPropWithCollider(prop: Group): void {
    this.prepVisuals(prop, false);
    this.root.add(prop);
    prop.updateMatrixWorld(true);
    const box = new Box3().setFromObject(prop);
    this.world.addOwned(SHOWCASE_PROPS_OWNER, box.min.x, box.min.z, box.max.x, box.max.z, box.min.y, box.max.y);
  }

  private prepVisuals(root: Object3D, doubleSide: boolean): void {
    root.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.geometry) this.geosToDispose.push(obj.geometry);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        if (doubleSide) m.side = DoubleSide;
        this.matsToDispose.push(m);
        if (m instanceof MeshStandardMaterial) {
          for (const tex of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.emissiveMap]) {
            if (!tex) continue;
            tex.anisotropy = Math.min(4, this.anisotropy);
            this.texsToDispose.push(tex);
          }
        }
      }
    });
  }

  update(dt: number): void {
    if (!this.beaconMat || !this.beaconLight) return;
    this.blinkT = (this.blinkT + dt) % 1.5;
    const pulse = this.blinkT < 0.45 ? Math.sin((this.blinkT / 0.45) * Math.PI) : 0.08;
    const r = 0.25 + 0.75 * pulse;
    this.beaconMat.color.setRGB(r, 0.03 * pulse, 0.03 * pulse);
    this.beaconLight.intensity = 0.15 + 1.65 * pulse;
  }

  dispose(): void {
    this.disposed = true;
    if (this.interiorGroup) {
      disposeBatchGroup(this.interiorGroup);
      this.interiorGroup = null;
    }
    this.root.removeFromParent();
    this.world.removeOwner(SHOWCASE_OWNER);
    this.world.removeOwner(SHOWCASE_PROPS_OWNER);
    this.shelters?.remove(SHOWCASE_OWNER);
    this.containers?.removeChunk(SHOWCASE_OWNER);
    for (const g of this.geosToDispose) g.dispose();
    for (const m of this.matsToDispose) m.dispose();
    for (const t of this.texsToDispose) t.dispose();
    this.geosToDispose.length = 0;
    this.matsToDispose.length = 0;
    this.texsToDispose.length = 0;
  }
}
