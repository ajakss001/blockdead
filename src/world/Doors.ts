import { BoxGeometry, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, type Scene, Vector3 } from 'three';
import { characterMaterial } from '../render/look/materials';
import type { CollisionWorld } from './CollisionWorld';
import type { DoorSpot } from './gen/pieces';

const LEAF_W = 0.95;
const LEAF_H = 2.05;
const SWING_SPEED = 6;
/** Door collider owners live in their own id range (above chunks and interiors). */
const DOOR_OWNER_BASE = 3e15;

interface DoorState {
  spot: DoorSpot;
  open: boolean;
  angle: number;
  owner: number;
}

interface DoorSet {
  mesh: InstancedMesh;
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

/**
 * Interior doors of the streamed high-rises: one InstancedMesh (one draw call) per building,
 * opened/closed with "use", swinging on their hinge. A closed door is a collider on its storey;
 * an open one is not. Boarded-up doors never open.
 */
export class Doors {
  private readonly sets = new Map<number, DoorSet>();
  private readonly geometry: BoxGeometry;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
  ) {
    this.geometry = new BoxGeometry(LEAF_W, LEAF_H, 0.05);
    this.geometry.translate(LEAF_W / 2, LEAF_H / 2, 0);
  }

  add(building: number, spots: DoorSpot[]): void {
    if (this.sets.has(building) || spots.length === 0) return;
    const mesh = new InstancedMesh(this.geometry, characterMaterial('handle', 0x5a4632), spots.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const doors = spots.map((spot, i) => ({ spot, open: false, angle: spot.yaw, owner: DOOR_OWNER_BASE + building * 1024 + i }));
    const set: DoorSet = { mesh, doors, dirty: true };
    doors.forEach((d) => this.collide(d, true));
    this.sets.set(building, set);
    this.scene.add(mesh);
    this.write(set);
  }

  remove(building: number): void {
    const set = this.sets.get(building);
    if (!set) return;
    for (const d of set.doors) this.world.removeOwner(d.owner);
    set.mesh.removeFromParent();
    set.mesh.dispose();
    this.sets.delete(building);
  }

  /** Closest door on the player's storey within reach that the player faces. */
  target(x: number, z: number, y: number, dirX: number, dirZ: number, reach = 1.7): DoorRef | null {
    let best: DoorRef | null = null;
    let bestScore = Infinity;
    for (const [building, set] of this.sets) {
      set.doors.forEach((d, index) => {
        if (Math.abs(d.spot.y - y) > 1.2) return;
        // Middle of the doorway.
        const mx = d.spot.hx + Math.cos(d.spot.yaw) * LEAF_W * 0.5;
        const mz = d.spot.hz - Math.sin(d.spot.yaw) * LEAF_W * 0.5;
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
    const d = this.sets.get(ref.building)?.doors[ref.index];
    if (!d) return 'closed';
    if (d.spot.barricaded) return 'barricaded';
    return d.open ? 'open' : 'closed';
  }

  /** Returns false if the door is boarded up. */
  toggle(ref: DoorRef): boolean {
    const set = this.sets.get(ref.building);
    const d = set?.doors[ref.index];
    if (!set || !d || d.spot.barricaded) return false;
    d.open = !d.open;
    this.collide(d, !d.open);
    return true;
  }

  /** Animate swinging leaves; only sets with moving doors re-upload their matrices. */
  update(dt: number): void {
    for (const set of this.sets.values()) {
      for (const d of set.doors) {
        const target = d.open ? d.spot.yaw + d.spot.swing * Math.PI * 0.48 : d.spot.yaw;
        const diff = target - d.angle;
        if (Math.abs(diff) < 1e-3) continue;
        d.angle += Math.sign(diff) * Math.min(Math.abs(diff), SWING_SPEED * dt);
        set.dirty = true;
      }
      if (set.dirty) this.write(set);
    }
  }

  get count(): number {
    let n = 0;
    for (const s of this.sets.values()) n += s.doors.length;
    return n;
  }

  private write(set: DoorSet): void {
    set.doors.forEach((d, i) => {
      _q.setFromAxisAngle(_up, d.angle);
      set.mesh.setMatrixAt(i, _m.compose(_p.set(d.spot.hx, d.spot.y, d.spot.hz), _q, _s));
    });
    set.mesh.instanceMatrix.needsUpdate = true;
    set.mesh.computeBoundingSphere();
    set.dirty = false;
  }

  private collide(d: DoorState, closed: boolean): void {
    this.world.removeOwner(d.owner);
    if (!closed) return;
    const ex = d.spot.hx + Math.cos(d.spot.yaw) * LEAF_W;
    const ez = d.spot.hz - Math.sin(d.spot.yaw) * LEAF_W;
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
