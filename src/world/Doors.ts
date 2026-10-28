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
import type { CollisionWorld } from './CollisionWorld';
import type { DoorSpot, DoorStyle } from './gen/pieces';

/** Reference leaf size; each door scales its leaf to its own width. */
const LEAF_W = 1;
const LEAF_H = 2.05;
const SWING_SPEED = 6;
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
  private readonly pools: Record<DoorStyle, Pool>;
  private nextOwner = 0;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
  ) {
    const slab = (w: number, h: number, d: number, x: number, y: number, z = 0): BufferGeometry => new BoxGeometry(w, h, d).translate(x, y, z);
    // Wooden leaf with a handle; hinge at x = 0, leaf along +X.
    const wood = mergeGeometries([slab(LEAF_W, LEAF_H, 0.05, LEAF_W / 2, LEAF_H / 2), slab(0.04, 0.04, 0.14, LEAF_W - 0.1, 1.0)])!;
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
    };
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
      const style = spot.style ?? 'wood';
      const open = (same ? keep[i] : !!spot.open) && !spot.barricaded;
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
      };
      const pool = this.pools[style];
      d.slot = pool.doors.length;
      pool.doors.push(d);
      this.ensureCapacity(pool);
      this.collide(d, !d.open);
      return d;
    });
    this.sets.set(key, doors);
    for (const pool of Object.values(this.pools)) this.writeAll(pool);
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

  describe(ref: DoorRef): 'open' | 'closed' | 'barricaded' {
    const d = this.sets.get(ref.building)?.[ref.index];
    if (!d) return 'closed';
    if (d.spot.barricaded) return 'barricaded';
    return d.open ? 'open' : 'closed';
  }

  /** Returns false if the door is boarded up. Double doors swing together. */
  toggle(ref: DoorRef): boolean {
    const doors = this.sets.get(ref.building);
    const d = doors?.[ref.index];
    if (!doors || !d || d.spot.barricaded) return false;
    const open = !d.open;
    for (const leaf of d.pair >= 0 && doors[d.pair] ? [d, doors[d.pair]] : [d]) {
      leaf.open = open;
      this.collide(leaf, !open);
    }
    return true;
  }

  /** Animate swinging leaves; only pools with moving doors re-upload their matrices. */
  update(dt: number): void {
    for (const pool of Object.values(this.pools)) {
      for (const d of pool.doors) {
        const target = d.open ? d.spot.yaw + d.spot.swing * Math.PI * 0.48 : d.spot.yaw;
        const diff = target - d.angle;
        if (Math.abs(diff) < 1e-3) continue;
        d.angle += Math.sign(diff) * Math.min(Math.abs(diff), SWING_SPEED * dt);
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
    _s.set(d.width / LEAF_W, 1, 1);
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
