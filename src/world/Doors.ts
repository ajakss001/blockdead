import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  Float32BufferAttribute,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { characterMaterial } from '../render/look/materials';
import type { LightingModel } from '../render/look/worldMaterials';
import type { CollisionWorld } from './CollisionWorld';
import type { DoorSpot, DoorStyle } from './gen/pieces';

/** Reference leaf size; each door scales its leaf to its own width. */
const LEAF_W = 1;
const LEAF_H = 2.05;
const SWING_SPEED = 6;
/** A draught closes a door at this share of a push. */
const DRAFT_SPEED = 0.13;
const START_CAPACITY = 128;
/** Door collider owners: a private id range, one per door. */
export const DOOR_OWNER_BASE = 3e15;
type PoolKey = DoorStyle | 'glassBroken';
/** Peek angle (~27.5 deg): leaves a ~0.46 m crack that admits bullets/LOS while blocking a 0.60 m capsule. */
const PEEK_ANGLE = 0.48;

interface DoorState {
  spot: DoorSpot;
  width: number;
  style: DoorStyle;
  poolKey: PoolKey;
  open: boolean;
  peek: boolean;
  glassBroken: boolean;
  angle: number;
  colliderAngle: number;
  owner: number;
  /** Index inside its pool (kept dense: removal moves the last door into the hole). */
  slot: number;
  set: number;
  /** Partner leaf of a double door (index inside the same set), or -1. */
  pair: number;
  /** How much beating it takes (zombies); broken doors hang open for good. */
  hp: number;
  broken: boolean;
  /** Boards the player nailed across it (0–3), and on which side of the leaf (±1 along its normal). */
  planks: number;
  plankSide: number;
  /** Swinging shut slowly (a draught or stealth peek), not pushed. */
  slow?: boolean;
}

export interface DoorBulletResult {
  kind: 'wood' | 'barricaded' | 'glass' | 'lab';
  penetrate: boolean;
  mul: number;
  brokenNow: boolean;
  glassShattered: boolean;
}

interface Pool {
  meshes: InstancedMesh[];
  doors: DoorState[];
  dirty: boolean;
}

export interface DoorRef {
  building: number;
  index: number;
}

/** Navigation descriptor for a doorway exposed to bot pathfinding. */
export interface DoorNavSpot {
  x: number;
  y: number;
  z: number;
  open: boolean;
  passable: boolean;
  nx: number;
  nz: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
const _qz = new Quaternion();
const _zAxis = new Vector3(0, 0, 1);
/** Boards: at most per door, how much beating each adds, how many fit in the instanced mesh. */
export const MAX_PLANKS = 3;
const PLANK_HP = 90;
const PLANK_CAPACITY = 256;

function doorKey(s: DoorSpot): string {
  return `${s.hx.toFixed(1)},${s.y.toFixed(1)},${s.hz.toFixed(1)}`;
}

/** Vertex color with alpha over the whole geometry (index dropped so the parts merge). */
function tint(g: BufferGeometry, color: number, alpha: number): BufferGeometry {
  const out = g.toNonIndexed();
  const c = new Color(color);
  const n = out.getAttribute('position').count;
  const data = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) data.set([c.r, c.g, c.b, alpha], i * 4);
  out.setAttribute('color', new Float32BufferAttribute(data, 4));
  return out;
}

/**
 * Every door in the world: entrance doors of buildings (with their chunk), doors inside streamed
 * high-rises (with the interior). Opened/closed with "use", swinging on the hinge; a closed door is a
 * collider on its storey, an open one is not; boarded-up doors never open; double doors open together.
 *
 * Draw calls: one shared InstancedMesh per style for the whole world (wood: 1, glass: 1 — frame and pane
 * in one mesh, opaque frame and see-through pane by vertex alpha),
 * however many doors are loaded.
 */
export class Doors {
  private readonly sets = new Map<number, DoorState[]>();
  /** Boards nailed by the player, by the door's hinge (kept while its building is unloaded; saved). */
  private readonly boards = new Map<string, [number, number]>();
  /** Locked doors the player has opened (by hinge; saved). */
  private readonly unlocked = new Set<string>();
  /** The boards themselves: one InstancedMesh for every door. */
  private readonly plankMesh: InstancedMesh;
  private readonly pools: Record<PoolKey, Pool>;
  private readonly byOwner = new Map<number, DoorState>();
  private nextOwner = 0;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
    lighting: LightingModel = 'standard',
  ) {
    const slab = (w: number, h: number, d: number, x: number, y: number, z = 0): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y, z);
    // Paneled wooden leaf with stiles, rails, raised panels, and lever handle; hinge at x = 0, leaf along +X.
    const wood = mergeGeometries([
      slab(LEAF_W, LEAF_H, 0.044, LEAF_W / 2, LEAF_H / 2),
      // Outer stiles and horizontal rails.
      slab(0.11, LEAF_H, 0.056, 0.055, LEAF_H / 2),
      slab(0.11, LEAF_H, 0.056, LEAF_W - 0.055, LEAF_H / 2),
      slab(LEAF_W, 0.14, 0.056, LEAF_W / 2, LEAF_H - 0.07),
      slab(LEAF_W, 0.18, 0.056, LEAF_W / 2, 0.92),
      slab(LEAF_W, 0.18, 0.056, LEAF_W / 2, 0.09),
      // Raised inner upper and lower panels.
      slab(LEAF_W - 0.3, 0.78, 0.052, LEAF_W / 2, 1.46),
      slab(LEAF_W - 0.3, 0.56, 0.052, LEAF_W / 2, 0.52),
      // Escutcheon plate & lever handle on both faces.
      slab(0.045, 0.16, 0.075, LEAF_W - 0.09, 1.0),
      slab(0.13, 0.024, 0.14, LEAF_W - 0.14, 1.02),
    ])!;
    // Glass door: aluminium frame (stiles, rails, push bar) around a pane.
    const frame = mergeGeometries([
      slab(0.07, LEAF_H, 0.06, 0.035, LEAF_H / 2),
      slab(0.07, LEAF_H, 0.06, LEAF_W - 0.035, LEAF_H / 2),
      slab(LEAF_W, 0.09, 0.06, LEAF_W / 2, LEAF_H - 0.045),
      slab(LEAF_W, 0.22, 0.06, LEAF_W / 2, 0.11),
      slab(LEAF_W * 0.7, 0.04, 0.1, LEAF_W / 2, 1.05),
    ])!;
    const pane = slab(LEAF_W - 0.14, LEAF_H - 0.31, 0.012, LEAF_W / 2, 0.22 + (LEAF_H - 0.31) / 2);
    const glassDoor = mergeGeometries([tint(frame, 0x8a8e90, 1), tint(pane, 0x5c6a72, 0.32)])!;
    const brokenGlassDoor = tint(frame, 0x8a8e90, 1);
    const lambert = lighting === 'lambert';
    const glass = lambert
      ? new MeshLambertMaterial({ vertexColors: true, transparent: true, side: DoubleSide })
      : new MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.4, transparent: true, side: DoubleSide });
    const glassFrameMat = lambert
      ? new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
      : new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, side: DoubleSide });
    const plank = (y: number, tilt: number, zOff: number): BufferGeometry => {
      const g = new BoxGeometry(LEAF_W + 0.16, 0.14, 0.035);
      g.rotateZ(tilt);
      g.translate(LEAF_W / 2, y, zOff);
      return g;
    };
    const barricadedLeaf = mergeGeometries([
      tint(wood, 0x5a4632, 1),
      tint(plank(0.48, 0.07, 0.045), 0x7a6446, 1),
      tint(plank(1.06, -0.09, 0.045), 0x6f5a3e, 1),
      tint(plank(1.62, 0.05, 0.045), 0x766044, 1),
      tint(plank(0.52, -0.06, -0.045), 0x745e42, 1),
      tint(plank(1.12, 0.08, -0.045), 0x6c573c, 1),
      tint(plank(1.66, -0.05, -0.045), 0x786246, 1),
    ])!;
    const barricadedMat = lambert
      ? new MeshLambertMaterial({ vertexColors: true, side: DoubleSide })
      : new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.04, side: DoubleSide });
    this.pools = {
      wood: this.pool([[wood, characterMaterial('handle', 0x5a4632)]]),
      glass: this.pool([[glassDoor, glass]]),
      glassBroken: this.pool([[brokenGlassDoor, glassFrameMat]]),
      lab: this.pool([[wood, characterMaterial('handle', 0x5c6468)]]),
      barricaded: this.pool([[barricadedLeaf, barricadedMat]]),
    };
    this.plankMesh = new InstancedMesh(new BoxGeometry(1, 0.15, 0.035), characterMaterial('handle', 0x7a6446), PLANK_CAPACITY);
    this.plankMesh.count = 0;
    this.plankMesh.frustumCulled = false;
    this.scene.add(this.plankMesh);
  }

  /** Open/closed of a set, in order (to carry over a rebuild of the same layout). */
  openStates(key: number): boolean[] | null {
    return this.sets.get(key)?.map((d) => d.open) ?? null;
  }

  /** Add a set of doors (an interior, or a chunk's entrances) under a key; `keep`: open states from before. */
  add(key: number, spots: DoorSpot[], keep: boolean[] | null = null): void {
    if (this.sets.has(key) || spots.length === 0) return;
    const same = keep !== null && keep.length === spots.length;
    const doors: DoorState[] = spots.map((spot, i) => {
      const style: DoorStyle = spot.style ?? (spot.lock ? 'lab' : spot.barricaded ? 'barricaded' : 'wood');
      const open = (same ? keep[i] : !!spot.open) && !spot.barricaded && !(spot.lock && !this.unlocked.has(doorKey(spot)));
      const owner = DOOR_OWNER_BASE + this.nextOwner++;
      const d: DoorState = {
        spot,
        width: spot.width ?? 0.95,
        style,
        poolKey: style,
        open,
        peek: false,
        glassBroken: false,
        angle: open ? spot.yaw + spot.swing * Math.PI * 0.48 : spot.yaw,
        colliderAngle: NaN,
        owner,
        slot: -1,
        set: key,
        pair: spot.pair !== undefined ? i + spot.pair : -1,
        hp: spot.barricaded ? 220 : spot.lock ? 600 : style === 'glass' ? 60 : 110,
        broken: false,
        planks: 0,
        plankSide: 1,
      };
      this.byOwner.set(owner, d);
      const pool = this.pools[d.poolKey];
      d.slot = pool.doors.length;
      pool.doors.push(d);
      this.ensureCapacity(pool);
      this.collide(d);
      return d;
    });
    this.sets.set(key, doors);
    for (const d of doors) {
      const b = this.boards.get(doorKey(d.spot));
      if (b) {
        d.planks = b[0];
        d.plankSide = b[1];
        d.open = false;
        d.peek = false;
        d.angle = d.spot.yaw;
        d.hp += PLANK_HP * d.planks;
        this.collide(d);
      }
    }
    for (const pool of Object.values(this.pools)) this.writeAll(pool);
    this.writePlanks();
  }

  remove(key: number): void {
    const doors = this.sets.get(key);
    if (!doors) return;
    for (const d of doors) {
      this.world.removeOwner(d.owner);
      this.byOwner.delete(d.owner);
      const pool = this.pools[d.poolKey];
      const last = pool.doors.pop()!;
      if (last !== d) {
        pool.doors[d.slot] = last;
        last.slot = d.slot;
      }
    }
    this.sets.delete(key);
    for (const pool of Object.values(this.pools)) this.writeAll(pool);
  }

  /** Closest door on the player's storey within reach that the player faces. */
  target(x: number, z: number, y: number, dirX: number, dirZ: number, reach = 1.7): DoorRef | null {
    let best: DoorRef | null = null;
    let bestScore = Infinity;
    for (const [building, doors] of this.sets) {
      doors.forEach((d, index) => {
        if (Math.abs(d.spot.y - y) > 1.2) return;
        // Middle of the doorway.
        const mx = d.spot.hx + Math.cos(d.spot.yaw) * d.width * 0.5;
        const mz = d.spot.hz - Math.sin(d.spot.yaw) * d.width * 0.5;
        const dx = mx - x;
        const dz = mz - z;
        const dist = Math.hypot(dx, dz);
        if (dist > reach) return;
        const facing = dist > 0.05 ? (dx * dirX + dz * dirZ) / dist : 1;
        if (facing < 0.3) return;
        const score = dist - facing * 0.5;
        if (score < bestScore) {
          bestScore = score;
          best = { building, index };
        }
      });
    }
    return best;
  }

  /** Middle of the doorway, style and state (for sounds and interactions). */
  info(ref: DoorRef): { x: number; y: number; z: number; style: DoorStyle; open: boolean; peek: boolean; glassBroken: boolean; creaky: boolean; pitch: number } | null {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d) return null;
    const s = d.spot;
    // The voice of this door, fixed by where it hangs (generated, never changes): 30% creak, pitch ±10%.
    const h = doorHash(s.hx, s.y, s.hz);
    return {
      x: s.hx + Math.cos(s.yaw) * d.width * 0.5,
      y: s.y + 1.1,
      z: s.hz - Math.sin(s.yaw) * d.width * 0.5,
      style: d.style,
      open: d.open,
      peek: d.peek,
      glassBroken: d.glassBroken,
      creaky: d.style === 'wood' && h < 0.3,
      pitch: 0.9 + 0.2 * ((h * 7.31) % 1),
    };
  }

  describe(ref: DoorRef): 'open' | 'peek' | 'closed' | 'barricaded' | 'boarded' | 'locked' {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d) return 'closed';
    if (d.spot.barricaded) return 'barricaded';
    if (this.lockOf(ref)) return 'locked';
    if (d.planks > 0) return 'boarded';
    if (d.open) return 'open';
    return d.peek ? 'peek' : 'closed';
  }

  /** Returns false if the door is boarded up or locked. Double doors swing together. */
  toggle(ref: DoorRef): boolean {
    const doors = this.sets.get(ref.building);
    const d = doors?.[ref.index];
    if (!doors || !d || d.spot.barricaded || d.broken || d.planks > 0 || this.lockOf(ref)) return false;
    const open = !d.open;
    for (const leaf of d.pair >= 0 && doors[d.pair] ? [d, doors[d.pair]] : [d]) {
      leaf.open = open;
      leaf.peek = false;
      leaf.slow = false;
      if (open) {
        // Clear closed doorway blocker immediately for synchronous callers (e.g. AI LOS), while update(dt) tracks the swinging leaf OBB.
        this.world.removeOwner(leaf.owner);
        leaf.colliderAngle = leaf.angle;
      } else {
        this.collide(leaf);
      }
    }
    return true;
  }

  /** Stealth peek (~27.5 deg crack): blocks body passage, lets bullets/LOS through silently. */
  peekToggle(ref: DoorRef): boolean {
    const doors = this.sets.get(ref.building);
    const d = doors?.[ref.index];
    if (!doors || !d || d.spot.barricaded || d.broken || d.planks > 0 || this.lockOf(ref)) return false;
    const nextPeek = d.open ? true : !d.peek;
    for (const leaf of d.pair >= 0 && doors[d.pair] ? [d, doors[d.pair]] : [d]) {
      leaf.open = false;
      leaf.peek = nextPeek;
      leaf.slow = true;
      this.collide(leaf);
    }
    return true;
  }

  /**
   * A draught swings an open door shut, slowly: a single wooden one on this storey between `minR` and
   * `maxR` m away (never one right by you). Returns where it is and its voice, or null if none.
   */
  draftClose(x: number, y: number, z: number, minR: number, maxR: number): { x: number; y: number; z: number; creaky: boolean; pitch: number; dur: number } | null {
    const pool: DoorRef[] = [];
    for (const [building, doors] of this.sets) {
      doors.forEach((d, index) => {
        if (!d.open || d.broken || d.pair >= 0 || d.style !== 'wood' || d.spot.barricaded || Math.abs(d.spot.y - y) > 1.2) return;
        const dist = Math.hypot(d.spot.hx - x, d.spot.hz - z);
        if (dist >= minR && dist <= maxR) pool.push({ building, index });
      });
    }
    if (pool.length === 0) return null;
    const ref = pool[Math.floor(Math.random() * pool.length)];
    const d = this.sets.get(ref.building)![ref.index];
    d.open = false;
    d.peek = false;
    d.slow = true;
    this.collide(d);
    const at = this.info(ref)!;
    return { x: at.x, y: at.y, z: at.z, creaky: at.creaky, pitch: at.pitch, dur: (Math.PI * 0.48) / (SWING_SPEED * DRAFT_SPEED) };
  }

  /** The nearest closed (unbroken) door within `r` on that storey: a handle and the doorway's middle. */
  closedNear(x: number, y: number, z: number, r: number): { ref: DoorRef; x: number; z: number } | null {
    let best: { ref: DoorRef; x: number; z: number } | null = null;
    let bestD = r;
    for (const [building, doors] of this.sets) {
      doors.forEach((d, index) => {
        if (d.open || d.broken || Math.abs(d.spot.y - y) > 1.2) return;
        const mx = d.spot.hx + Math.cos(d.spot.yaw) * d.width * 0.5;
        const mz = d.spot.hz - Math.sin(d.spot.yaw) * d.width * 0.5;
        const dist = Math.hypot(mx - x, mz - z);
        if (dist < bestD) {
          bestD = dist;
          best = { ref: { building, index }, x: mx, z: mz };
        }
      });
    }
    return best;
  }

  /** All loaded doors on roughly the same storey within `r` (used for A* doorway routing). */
  doorsNear(x: number, y: number, z: number, r: number): DoorNavSpot[] {
    const out: DoorNavSpot[] = [];
    for (const doors of this.sets.values()) {
      for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (Math.abs(d.spot.y - y) > 1.8) continue;
        const mx = d.spot.hx + Math.cos(d.spot.yaw) * d.width * 0.5;
        const mz = d.spot.hz - Math.sin(d.spot.yaw) * d.width * 0.5;
        if (Math.hypot(mx - x, mz - z) > r) continue;
        out.push({
          x: mx,
          y: d.spot.y,
          z: mz,
          open: d.open || d.broken,
          passable: d.open || d.broken || (!d.spot.barricaded && !d.spot.lock && d.planks === 0),
          nx: Math.sin(d.spot.yaw),
          nz: Math.cos(d.spot.yaw),
        });
      }
    }
    return out;
  }

  /** A zombie's blow. True when the door gives way: it swings open for good (both leaves of a pair). */
  damage(ref: DoorRef, amount: number): boolean {
    const doors = this.sets.get(ref.building);
    const d = doors?.[ref.index];
    if (!doors || !d || d.broken || d.open) return true;
    d.hp -= amount;
    if (d.hp > 0) return false;
    for (const leaf of d.pair >= 0 && doors[d.pair] ? [d, doors[d.pair]] : [d]) {
      leaf.broken = true;
      leaf.planks = 0;
      this.boards.delete(doorKey(leaf.spot));
      leaf.open = true;
      leaf.peek = false;
      this.world.removeOwner(leaf.owner);
      leaf.colliderAngle = leaf.angle;
    }
    this.writePlanks();
    return true;
  }

  /** Resolves bullet/blast impact against a door leaf owner: handles glass shatter, wood penetration, and lab ricochet. */
  bulletImpact(owner: number, damage: number): DoorBulletResult | null {
    const d = this.byOwner.get(owner);
    if (!d) return null;
    if (d.style === 'lab') {
      return { kind: 'lab', penetrate: false, mul: 0, brokenNow: false, glassShattered: false };
    }
    if (d.style === 'glass') {
      const brokenBefore = d.glassBroken;
      if (!brokenBefore) this.shatterGlass(d);
      return { kind: 'glass', penetrate: true, mul: brokenBefore ? 1.0 : 0.85, brokenNow: false, glassShattered: !brokenBefore };
    }
    const hadPlanks = d.planks > 0 || !!d.spot.barricaded;
    const doors = this.sets.get(d.set);
    const idx = doors?.indexOf(d) ?? -1;
    let brokenNow = false;
    if (idx >= 0) {
      if (d.planks > 0 && Math.random() < 0.35) this.removePlank({ building: d.set, index: idx });
      brokenNow = this.damage({ building: d.set, index: idx }, damage * 0.35);
    }
    return { kind: d.style === 'barricaded' ? 'barricaded' : 'wood', penetrate: true, mul: hadPlanks ? 0.32 : 0.55, brokenNow, glassShattered: false };
  }

  /** Shatters nearby glass doors (or damages nearby wood doors) within an explosion radius. */
  blastNear(at: Vector3, radius: number, damage = 90): { brokenGlassAt: Vector3[] } {
    const brokenGlassAt: Vector3[] = [];
    for (const [building, doors] of this.sets) {
      doors.forEach((d, index) => {
        const mx = d.spot.hx + Math.cos(d.angle) * d.width * 0.5;
        const mz = d.spot.hz - Math.sin(d.angle) * d.width * 0.5;
        const my = d.spot.y + 1.0;
        const dist = Math.hypot(mx - at.x, my - at.y, mz - at.z);
        if (dist > radius) return;
        const k = 1 - dist / radius;
        if (d.style === 'glass' && !d.glassBroken) {
          this.shatterGlass(d);
          brokenGlassAt.push(new Vector3(mx, my, mz));
        } else if (d.style !== 'lab' && !d.open && !d.broken) {
          this.damage({ building, index }, damage * k);
        }
      });
    }
    return { brokenGlassAt };
  }

  private shatterGlass(d: DoorState): void {
    if (d.glassBroken || d.poolKey === 'glassBroken') return;
    const oldPool = this.pools[d.poolKey];
    const last = oldPool.doors.pop()!;
    if (last !== d) {
      oldPool.doors[d.slot] = last;
      last.slot = d.slot;
    }
    const newPool = this.pools.glassBroken;
    d.poolKey = 'glassBroken';
    d.glassBroken = true;
    d.slot = newPool.doors.length;
    newPool.doors.push(d);
    this.ensureCapacity(newPool);
    this.writeAll(oldPool);
    this.writeAll(newPool);
  }

  /** The lock still holding this door shut, or null. */
  lockOf(ref: DoorRef): string | null {
    const d = this.sets.get(ref.building)?.[ref.index];
    return d?.spot.lock && !d.broken && !this.unlocked.has(doorKey(d.spot)) ? d.spot.lock : null;
  }

  /** Unlock it for good (a key, a code). */
  unlock(ref: DoorRef): void {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (d) this.unlocked.add(doorKey(d.spot));
  }

  /**
   * The power came back: every loaded door with this lock inside a rectangle lets go and swings open
   * (for good: remembered as unlocked).
   */
  releaseLock(lock: string, x0: number, z0: number, x1: number, z1: number): number {
    let n = 0;
    for (const [building, doors] of this.sets) {
      doors.forEach((d, index) => {
        if (d.spot.lock !== lock || d.spot.hx < x0 || d.spot.hx > x1 || d.spot.hz < z0 || d.spot.hz > z1) return;
        const ref = { building, index };
        if (!this.lockOf(ref)) return;
        this.unlock(ref);
        if (!d.open) this.toggle(ref);
        n++;
      });
    }
    return n;
  }

  serializeUnlocked(): string[] {
    return [...this.unlocked];
  }

  restoreUnlocked(list: string[] | undefined): void {
    this.unlocked.clear();
    for (const k of list ?? []) this.unlocked.add(k);
  }

  /** How many boards are on a door (0 if none or no such door). */
  planksOn(ref: DoorRef): number {
    return this.sets.get(ref.building)?.[ref.index]?.planks ?? 0;
  }

  /**
   * Nail one more board across a closed door, on the side the player stands (fromX, fromZ): the door
   * won't open, and each board takes a zombie a lot more beating. At most 3. False if it can't take one.
   */
  addPlank(ref: DoorRef, fromX: number, fromZ: number): boolean {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d || d.open || d.broken || d.spot.barricaded || d.planks >= MAX_PLANKS) return false;
    const nx = Math.sin(d.spot.yaw);
    const nz = Math.cos(d.spot.yaw);
    if (d.planks === 0) d.plankSide = (fromX - d.spot.hx) * nx + (fromZ - d.spot.hz) * nz >= 0 ? 1 : -1;
    d.planks++;
    d.hp += PLANK_HP;
    this.boards.set(doorKey(d.spot), [d.planks, d.plankSide]);
    this.writePlanks();
    return true;
  }

  /** Pry one board off (hammer / crowbar); true if one came off. */
  removePlank(ref: DoorRef): boolean {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d || d.planks <= 0) return false;
    d.planks--;
    d.hp = Math.max(1, d.hp - PLANK_HP);
    if (d.planks > 0) this.boards.set(doorKey(d.spot), [d.planks, d.plankSide]);
    else this.boards.delete(doorKey(d.spot));
    this.writePlanks();
    return true;
  }

  /** Boards the player nailed, for the save: hinge key → [count, side]. */
  serializeBoards(): [string, number, number][] {
    return [...this.boards].map(([k, [n, side]]) => [k, n, side]);
  }

  restoreBoards(list: [string, number, number][] | undefined): void {
    this.boards.clear();
    for (const [k, n, side] of list ?? []) this.boards.set(k, [n, side]);
    // Doors already loaded get theirs now.
    for (const doors of this.sets.values()) {
      for (const d of doors) {
        const b = this.boards.get(doorKey(d.spot));
        if (!b || d.planks > 0) continue;
        d.planks = b[0];
        d.plankSide = b[1];
        d.open = false;
        d.peek = false;
        d.hp += PLANK_HP * d.planks;
        this.collide(d);
      }
    }
    this.writePlanks();
  }

  /** Board instances: three slanting planks across the doorway per boarded door. */
  private writePlanks(): void {
    let n = 0;
    for (const doors of this.sets.values()) {
      for (const d of doors) {
        for (let i = 0; i < d.planks; i++) {
          if (n >= PLANK_CAPACITY) break;
          const nx = Math.sin(d.spot.yaw) * d.plankSide;
          const nz = Math.cos(d.spot.yaw) * d.plankSide;
          const mx = d.spot.hx + Math.cos(d.spot.yaw) * d.width * 0.5 + nx * 0.07;
          const mz = d.spot.hz - Math.sin(d.spot.yaw) * d.width * 0.5 + nz * 0.07;
          _q.setFromAxisAngle(_up, d.spot.yaw).multiply(_qz.setFromAxisAngle(_zAxis, (i - 1) * 0.18 + 0.05));
          _s.set((d.width + 0.3) / 1, 1, 1);
          _m.compose(_p.set(mx, d.spot.y + 0.55 + i * 0.6, mz), _q, _s);
          this.plankMesh.setMatrixAt(n++, _m);
        }
      }
    }
    this.plankMesh.count = n;
    this.plankMesh.instanceMatrix.needsUpdate = true;
    _s.set(1, 1, 1);
  }

  /** Ensure all door pools and plank mesh render at least one dummy instance during boot prewarm. */
  prewarm(): () => void {
    this.keepPrewarmVisible();
    return () => {
      for (const pool of Object.values(this.pools)) this.writeAll(pool);
      this.writePlanks();
    };
  }

  /** Keep all door meshes visible through scene.render() during boot prewarm. */
  keepPrewarmVisible(): void {
    _m.identity();
    for (const pool of Object.values(this.pools)) {
      for (const mesh of pool.meshes) {
        if (mesh.count === 0) {
          mesh.setMatrixAt(0, _m);
          mesh.instanceMatrix.needsUpdate = true;
          mesh.count = 1;
        }
        mesh.visible = true;
      }
    }
    if (this.plankMesh.count === 0) {
      this.plankMesh.setMatrixAt(0, _m);
      this.plankMesh.instanceMatrix.needsUpdate = true;
      this.plankMesh.count = 1;
    }
    this.plankMesh.visible = true;
  }

  /** Animate swinging leaves; only pools with moving doors re-upload their matrices and OBB colliders. */
  update(dt: number): void {
    for (const pool of Object.values(this.pools)) {
      for (const d of pool.doors) {
        const target = d.open ? d.spot.yaw + d.spot.swing * Math.PI * 0.48 : d.peek ? d.spot.yaw + d.spot.swing * PEEK_ANGLE : d.spot.yaw;
        const diff = target - d.angle;
        if (Math.abs(diff) < 1e-3) {
          if (Math.abs(d.colliderAngle - d.angle) > 0.005) this.collide(d);
          continue;
        }
        const rate = SWING_SPEED * (d.peek ? 0.55 : d.slow ? DRAFT_SPEED : 1);
        d.angle += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
        if (Math.abs(target - d.angle) < 1e-3) {
          d.angle = target;
          d.slow = false;
        }
        if (Math.abs(d.angle - d.colliderAngle) > 0.005 || d.angle === target) {
          this.collide(d);
        }
        this.write(pool, d);
        pool.dirty = true;
      }
      if (pool.dirty) this.flush(pool);
    }
  }

  get count(): number {
    let n = 0;
    for (const doors of this.sets.values()) n += doors.length;
    return n;
  }

  private pool(parts: [BufferGeometry, Material][]): Pool {
    const meshes = parts.map(([g, m]) => this.mesh(g, m, START_CAPACITY));
    return { meshes, doors: [], dirty: false };
  }

  private mesh(g: BufferGeometry, m: Material, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(g, m, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = !(m as MeshStandardMaterial).transparent;
    mesh.receiveShadow = true;
    // Doors are spread over the whole loaded world: one bounding volume would be meaningless.
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    return mesh;
  }

  private ensureCapacity(pool: Pool): void {
    const cap = pool.meshes[0].instanceMatrix.count;
    if (pool.doors.length <= cap) return;
    pool.meshes = pool.meshes.map((old) => {
      const mesh = this.mesh(old.geometry, old.material as Material, cap * 2);
      old.removeFromParent();
      old.dispose();
      return mesh;
    });
  }

  private write(pool: Pool, d: DoorState): void {
    _q.setFromAxisAngle(_up, d.angle);
    _s.set(d.width / LEAF_W, (d.spot.height ?? LEAF_H) / LEAF_H, 1);
    _m.compose(_p.set(d.spot.hx, d.spot.y, d.spot.hz), _q, _s);
    for (const mesh of pool.meshes) mesh.setMatrixAt(d.slot, _m);
  }

  private writeAll(pool: Pool): void {
    for (const d of pool.doors) this.write(pool, d);
    this.flush(pool);
  }

  private flush(pool: Pool): void {
    for (const mesh of pool.meshes) {
      mesh.count = pool.doors.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    pool.dirty = false;
  }

  private collide(d: DoorState): void {
    this.world.removeOwner(d.owner);
    d.colliderAngle = d.angle;
    const c = Math.cos(d.angle);
    const s = Math.sin(d.angle);
    const cx = d.spot.hx + c * (d.width * 0.5);
    const cz = d.spot.hz - s * (d.width * 0.5);
    // Thin open/peeking leaf (~0.09 m) admits bullets & LOS through the crack while closed leaf keeps 0.25 m thickness.
    const wideOpen = d.open && !d.peek;
    const halfT = (wideOpen || d.peek) && Math.abs(d.angle - d.spot.yaw) > 0.25 ? 0.045 : 0.125;
    this.world.addOwnedOriented(
      d.owner,
      cx,
      cz,
      d.width * 0.5 + 0.02,
      halfT,
      d.angle,
      d.spot.y,
      d.spot.y + (d.spot.height ?? LEAF_H),
      d.style === 'glass',
      true,
      wideOpen,
    );
  }
}

/** 0..1 from a door's hinge position (stable across reloads). */
function doorHash(x: number, y: number, z: number): number {
  let n = Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(y * 10), 19349663) ^ Math.imul(Math.round(z * 10), 83492791);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
