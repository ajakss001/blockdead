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
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { characterMaterial } from '../render/look/materials';
import { MODEL_LAYER_BASE } from '../render/look/surfaces';
import { worldMaterials } from '../render/look/worldMaterials';
import type { CollisionWorld } from './CollisionWorld';
import type { DoorSpot, DoorStyle } from './gen/pieces';
import { loadModelLibrary, modelGeometry, pickModel } from './models';

/** Reference leaf size; each door scales its leaf to its own width. */
const LEAF_W = 1;
const LEAF_H = 2.05;
const SWING_SPEED = 6;
/** A draught closes a door at this share of a push. */
const DRAFT_SPEED = 0.13;
const START_CAPACITY = 128;
/** Door collider owners: a private id range, one per door. */
const DOOR_OWNER_BASE = 3e15;

interface DoorState {
  spot: DoorSpot;
  width: number;
  style: DoorStyle;
  open: boolean;
  angle: number;
  owner: number;
  /** Index inside its style pool (kept dense: removal moves the last door into the hole). */
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
  /** Swinging shut slowly (a draught), not pushed. */
  slow?: boolean;
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
  private readonly pools: Record<DoorStyle, Pool>;
  private nextOwner = 0;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
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
    const glass = new MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.4, transparent: true, side: DoubleSide });
    this.pools = {
      wood: this.pool([[wood, characterMaterial('handle', 0x5a4632)]]),
      glass: this.pool([[glassDoor, glass]]),
      lab: this.pool([[wood, characterMaterial('handle', 0x5c6468)]]),
      barricaded: this.pool([[wood, characterMaterial('handle', 0x5a4632)]]),
    };
    void loadModelLibrary(`${import.meta.env.BASE_URL}models/`).then((lib) => {
      if (!lib) return;
      const mat = worldMaterials().cast;
      const swap = (style: DoorStyle, group: string, rough: number, metal: number) => {
        const m = pickModel(lib, group, 0);
        if (!m) return;
        const g = modelGeometry(lib, m).clone();
        const sx = LEAF_W / Math.max(0.05, m.size[0]);
        const sy = LEAF_H / Math.max(0.05, m.size[1]);
        const sz = 0.16 / Math.max(0.05, m.size[2]);
        g.scale(sx, sy, sz);
        g.translate(LEAF_W / 2, 0, 0);
        const n = g.attributes.position.count;
        const uv = g.attributes.uv;
        const surfUv = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          surfUv[i * 2] = uv.getX(i);
          surfUv[i * 2 + 1] = uv.getY(i);
        }
        const layers = new Float32Array(n).fill(MODEL_LAYER_BASE + m.layer);
        const pbr = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          pbr[i * 2] = rough;
          pbr[i * 2 + 1] = metal;
        }
        g.setAttribute('aSurfUv', new Float32BufferAttribute(surfUv, 2));
        g.setAttribute('aLayer', new Float32BufferAttribute(layers, 1));
        g.setAttribute('aPbr', new Float32BufferAttribute(pbr, 2));
        const mesh = this.pools[style].meshes[0];
        mesh.geometry.dispose();
        mesh.geometry = g;
        mesh.material = mat;
      };
      swap('wood', 'woodenDoor', 0.78, 0.1);
      swap('lab', 'labDoor', 0.55, 0.45);
      swap('barricaded', 'barricadedDoor', 0.82, 0.12);
    });
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
      const d: DoorState = {
        spot,
        width: spot.width ?? 0.95,
        style,
        open,
        angle: open ? spot.yaw + spot.swing * Math.PI * 0.48 : spot.yaw,
        owner: DOOR_OWNER_BASE + this.nextOwner++,
        slot: -1,
        set: key,
        pair: spot.pair !== undefined ? i + spot.pair : -1,
        hp: spot.barricaded ? 220 : spot.lock ? 600 : style === 'glass' ? 60 : 110,
        broken: false,
        planks: 0,
        plankSide: 1,
      };
      const pool = this.pools[style];
      d.slot = pool.doors.length;
      pool.doors.push(d);
      this.ensureCapacity(pool);
      this.collide(d, !d.open);
      return d;
    });
    this.sets.set(key, doors);
    for (const d of doors) {
      const b = this.boards.get(doorKey(d.spot));
      if (b) {
        d.planks = b[0];
        d.plankSide = b[1];
        d.open = false;
        d.angle = d.spot.yaw;
        d.hp += PLANK_HP * d.planks;
        this.collide(d, true);
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
      const pool = this.pools[d.style];
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

  /** Middle of the doorway, style and state (for sounds). */
  info(ref: DoorRef): { x: number; y: number; z: number; style: DoorStyle; open: boolean; creaky: boolean; pitch: number } | null {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d) return null;
    const s = d.spot;
    // The voice of this door, fixed by where it hangs (generated, never changes): 30% creak, pitch ±10%.
    const h = doorHash(s.hx, s.y, s.hz);
    return { x: s.hx + Math.cos(s.yaw) * d.width * 0.5, y: s.y + 1.1, z: s.hz - Math.sin(s.yaw) * d.width * 0.5, style: d.style, open: d.open, creaky: d.style === 'wood' && h < 0.3, pitch: 0.9 + 0.2 * ((h * 7.31) % 1) };
  }

  describe(ref: DoorRef): 'open' | 'closed' | 'barricaded' | 'boarded' | 'locked' {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d) return 'closed';
    if (d.spot.barricaded) return 'barricaded';
    if (this.lockOf(ref)) return 'locked';
    if (d.planks > 0) return 'boarded';
    return d.open ? 'open' : 'closed';
  }

  /** Returns false if the door is boarded up. Double doors swing together. */
  toggle(ref: DoorRef): boolean {
    const doors = this.sets.get(ref.building);
    const d = doors?.[ref.index];
    if (!doors || !d || d.spot.barricaded || d.broken || d.planks > 0 || this.lockOf(ref)) return false;
    const open = !d.open;
    for (const leaf of d.pair >= 0 && doors[d.pair] ? [d, doors[d.pair]] : [d]) {
      leaf.open = open;
      leaf.slow = false;
      this.collide(leaf, !open);
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
    d.slow = true;
    this.collide(d, true);
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
      this.collide(leaf, false);
    }
    this.writePlanks();
    return true;
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
        d.hp += PLANK_HP * d.planks;
        this.collide(d, true);
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

  /** Animate swinging leaves; only pools with moving doors re-upload their matrices. */
  update(dt: number): void {
    for (const pool of Object.values(this.pools)) {
      for (const d of pool.doors) {
        const target = d.open ? d.spot.yaw + d.spot.swing * Math.PI * 0.48 : d.spot.yaw;
        const diff = target - d.angle;
        if (Math.abs(diff) < 1e-3) continue;
        d.angle += Math.sign(diff) * Math.min(Math.abs(diff), SWING_SPEED * (d.slow ? DRAFT_SPEED : 1) * dt);
        if (Math.abs(target - d.angle) < 1e-3) d.slow = false;
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

  private collide(d: DoorState, closed: boolean): void {
    this.world.removeOwner(d.owner);
    if (!closed) return;
    const ex = d.spot.hx + Math.cos(d.spot.yaw) * d.width;
    const ez = d.spot.hz - Math.sin(d.spot.yaw) * d.width;
    const t = 0.08;
    this.world.addOwned(
      d.owner,
      Math.min(d.spot.hx, ex) - t,
      Math.min(d.spot.hz, ez) - t,
      Math.max(d.spot.hx, ex) + t,
      Math.max(d.spot.hz, ez) + t,
      d.spot.y,
      d.spot.y + LEAF_H,
    );
  }
}

/** 0..1 from a door's hinge position (stable across reloads). */
function doorHash(x: number, y: number, z: number): number {
  let n = Math.imul(Math.round(x * 10), 73856093) ^ Math.imul(Math.round(y * 10), 19349663) ^ Math.imul(Math.round(z * 10), 83492791);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
