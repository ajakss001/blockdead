import { Group, Mesh, Vector3 } from 'three';
import type { ItemId } from '../data/items';
import type { ContainerType } from '../data/loot';
import { batteriesGeometry, batteriesHighlightMaterial, flashlightMaterial } from '../items/flashlight';
import { weaponHighlightMaterial, weaponMaterial, weaponMesh } from './buildWeapon';
import { WEAPONS, type WeaponId } from './config';

/** What can lie about: the four weapons, and packs of batteries for the flashlight. */
export type GroundKind = WeaponId | 'batteries';

/** The inventory item a thing lying about is. */
export function groundItem(kind: GroundKind): ItemId {
  return kind === 'batteries' ? 'batteries' : WEAPONS[kind].item;
}

/** Length along the model's −Z and where its origin is from the back end (as WeaponConfig). */
function sizeOf(kind: GroundKind): { length: number; grip: number } {
  return kind === 'batteries' ? { length: 0.052, grip: 0.036 } : WEAPONS[kind];
}

/** A weapon lying on the floor: on its side, picked up with E. */
export interface GroundWeapon {
  /** Unique: the container it lies by (or a debug id ≥ 3e9). */
  key: number;
  weapon: GroundKind;
  mesh: Mesh;
  /** The middle of the weapon, world. */
  at: Vector3;
}

/** Which containers may have a weapon lying beside them, how likely, and which ones. */
const NEAR: Partial<Record<ContainerType, { chance: number; weapons: GroundKind[] }>> = {
  garage: { chance: 0.3, weapons: ['hammer', 'crowbar', 'hammer'] },
  crate: { chance: 0.14, weapons: ['crowbar', 'hammer', 'batteries'] },
  plantStore: { chance: 0.25, weapons: ['crowbar', 'hammer'] },
  labTools: { chance: 0.2, weapons: ['hammer', 'crowbar'] },
  trunk: { chance: 0.025, weapons: ['crowbar', 'fireAxe'] },
  reception: { chance: 0.3, weapons: ['fireAxe', 'crowbar', 'batteries'] },
  bodyFire: { chance: 0.5, weapons: ['fireAxe'] },
  bodyMilitary: { chance: 0.45, weapons: ['tacticalKnife', 'batteries'] },
  bodyPolice: { chance: 0.3, weapons: ['batteries'] },
  bodyZombie: { chance: 0.06, weapons: ['batteries'] },
  shopCounter: { chance: 0.12, weapons: ['batteries'] },
  gasCounter: { chance: 0.2, weapons: ['batteries'] },
  desk: { chance: 0.04, weapons: ['batteries'] },
  armory: { chance: 0.4, weapons: ['tacticalKnife', 'crowbar'] },
  cafe: { chance: 0.12, weapons: ['tacticalKnife'] },
  canteen: { chance: 0.15, weapons: ['tacticalKnife'] },
};

export interface GroundSpot {
  id: number;
  type: ContainerType;
  x: number;
  z: number;
  y?: number;
  box?: readonly number[];
}

/** 0..1 from the seed and a key. */
function hash(seed: number, key: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(key + salt * 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const _v = new Vector3();

/**
 * Weapons lying about: by some workbenches, toolboxes, car boots, fallen firemen — fixed by the seed, so a
 * place always has the same ones until the player takes them (`taken` is saved). One mesh each (shared
 * geometry and material); the one under the crosshair gets the light outline.
 */
export class GroundWeapons {
  readonly group = new Group();
  private readonly byChunk = new Map<number, GroundWeapon[]>();
  private readonly loose: GroundWeapon[] = [];
  private readonly taken = new Set<number>();
  private focused: GroundWeapon | null = null;

  /**
   * `floor(x, y, z)`: the floor under a point near the storey at y; `free(x, y, z)`: nothing solid stands
   * on the floor there (no wall, no furniture).
   */
  constructor(
    private readonly seed: number,
    private readonly floor: (x: number, y: number, z: number) => number,
    private readonly free: (x: number, y: number, z: number) => boolean,
  ) {
    this.group.name = 'groundWeapons';
  }

  addChunk(key: number, spots: readonly GroundSpot[]): void {
    const list: GroundWeapon[] = [];
    for (const s of spots) {
      const near = NEAR[s.type];
      if (!near || this.taken.has(s.id) || hash(this.seed, s.id, 1) >= near.chance) continue;
      const weapon = near.weapons[Math.floor(hash(this.seed, s.id, 2) * near.weapons.length)];
      const w = this.placeBy(s, weapon);
      if (w) list.push(w);
    }
    if (list.length) this.byChunk.set(key, list);
  }

  removeChunk(key: number): void {
    const list = this.byChunk.get(key);
    if (!list) return;
    for (const w of list) this.group.remove(w.mesh);
    this.byChunk.delete(key);
    if (this.focused && list.includes(this.focused)) this.focused = null;
  }

  /** Lay a weapon at a point (debug, tests): `yaw` turns it about the vertical. */
  drop(weapon: GroundKind, x: number, y: number, z: number, yaw = 0): GroundWeapon {
    const w = this.make(3e9 + this.loose.length, weapon, x, y, z, yaw);
    this.loose.push(w);
    return w;
  }

  /** The weapon the ray (eye, unit direction) points at within `reach`, nearest first; `clear(t)`: nothing in between. */
  target(o: Vector3, d: Vector3, reach: number, clear: (t: number) => boolean): GroundWeapon | null {
    let best: GroundWeapon | null = null;
    let bestT = reach;
    for (const w of this.all()) {
      // A capsule round the weapon's length, a little fat so it is easy to aim at.
      const t = rayCapsule(o, d, w, 0.09);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = w;
      }
    }
    return best && clear(bestT) ? best : null;
  }

  /** The one under the crosshair gets the light outline (null: none). */
  setFocus(w: GroundWeapon | null): void {
    if (w === this.focused) return;
    const lit = (g: GroundWeapon, on: boolean) => {
      if (g.weapon === 'batteries') g.mesh.material = on ? batteriesHighlightMaterial() : flashlightMaterial();
      else g.mesh.material = on ? weaponHighlightMaterial() : weaponMaterial();
    };
    if (this.focused) lit(this.focused, false);
    this.focused = w;
    if (w) lit(w, true);
  }

  /** Picked up: gone for good. */
  take(w: GroundWeapon): void {
    if (this.focused === w) this.setFocus(null);
    this.group.remove(w.mesh);
    this.taken.add(w.key);
    for (const list of [...this.byChunk.values(), this.loose]) {
      const i = list.indexOf(w);
      if (i >= 0) list.splice(i, 1);
    }
  }

  get count(): number {
    let n = this.loose.length;
    for (const l of this.byChunk.values()) n += l.length;
    return n;
  }

  /** Every weapon lying in the loaded chunks. */
  all(): GroundWeapon[] {
    const out = [...this.loose];
    for (const l of this.byChunk.values()) out.push(...l);
    return out;
  }

  serialize(): number[] {
    return [...this.taken];
  }

  restore(keys: readonly number[] | undefined): void {
    this.taken.clear();
    for (const k of keys ?? []) this.taken.add(k);
    // Chunks already loaded: what was taken goes.
    for (const w of this.all()) if (this.taken.has(w.key)) this.take(w);
  }

  /** Beside the container's search zone, on the floor where nothing stands; null if there is no room. */
  private placeBy(s: GroundSpot, weapon: GroundKind): GroundWeapon | null {
    const b = s.box;
    const cx = b ? b[0] : s.x;
    const cz = b ? b[2] : s.z;
    const y = s.y ?? 0;
    const r = b ? Math.max(b[3], b[5]) + 0.35 : 0.7;
    const half = sizeOf(weapon).length / 2;
    const a0 = hash(this.seed, s.id, 3) * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const x = cx + Math.sin(a) * r;
      const z = cz + Math.cos(a) * r;
      // Lying across the direction out from the container.
      const yaw = a + Math.PI / 2 + (hash(this.seed, s.id, 4) - 0.5) * 0.8;
      const ex = -Math.sin(yaw) * half;
      const ez = -Math.cos(yaw) * half;
      const fy = this.floor(x, y, z);
      if (!this.free(x, fy, z) || !this.free(x + ex, fy, z + ez) || !this.free(x - ex, fy, z - ez)) continue;
      return this.make(s.id, weapon, x, fy, z, yaw);
    }
    return null;
  }

  private make(key: number, weapon: GroundKind, x: number, y: number, z: number, yaw: number): GroundWeapon {
    const mesh = weapon === 'batteries' ? new Mesh(batteriesGeometry(), flashlightMaterial()) : weaponMesh(weapon);
    const box = mesh.geometry.boundingBox!;
    const { grip, length } = sizeOf(weapon);
    const mid = grip - length / 2;
    // On its side: rolled a quarter turn about its length (the blade, +Y, to the side), the middle of
    // its length at (x, z), resting on its widest side.
    mesh.rotation.set(0, yaw, Math.PI / 2, 'YXZ');
    const lift = -box.min.x + 0.002;
    _v.set(0, 0, mid).applyEuler(mesh.rotation);
    mesh.position.set(x - _v.x, y + lift, z - _v.z);
    mesh.updateMatrixWorld();
    this.group.add(mesh);
    return { key, weapon, mesh, at: new Vector3(x, y + lift, z) };
  }
}

/** Distance along a ray to a capsule round the weapon's length (radius r), or −1. */
function rayCapsule(o: Vector3, d: Vector3, w: GroundWeapon, r: number): number {
  const half = sizeOf(w.weapon).length / 2;
  const yaw = w.mesh.rotation.y;
  const ax = -Math.sin(yaw);
  const az = -Math.cos(yaw);
  // Closest approach of the ray to the segment (sampled: cheap and plenty for a handful of weapons).
  let best = -1;
  for (let k = -4; k <= 4; k++) {
    const px = w.at.x + ax * half * (k / 4);
    const pz = w.at.z + az * half * (k / 4);
    const py = w.at.y;
    const t = (px - o.x) * d.x + (py - o.y) * d.y + (pz - o.z) * d.z;
    if (t < 0) continue;
    const qx = o.x + d.x * t - px;
    const qy = o.y + d.y * t - py;
    const qz = o.z + d.z * t - pz;
    if (qx * qx + qy * qy + qz * qz <= r * r && (best < 0 || t < best)) best = t;
  }
  return best;
}
