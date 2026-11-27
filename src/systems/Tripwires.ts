import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { sfx } from '../audio/Sound';
import { tr } from '../core/i18n';
import type { InputManager } from '../input/InputManager';
import type { DoorNavSpot } from '../world/Doors';
import type { Bandit } from './Bandits';
import type { BlastSpec } from './Firearms';
import type { Inventory } from './Inventory';
import type { Zombie } from './zombies';

export const TRIPWIRE_MAX_SPAN = 3.5;
export const TRIPWIRE_MIN_SPAN = 0.5;
export const TRIPWIRE_HEIGHT = 0.30;
export const TRIPWIRE_FUSE_S = 0.35;
export const TRIPWIRE_DISARM_S = 2.0;

export const TRIPWIRE_BLAST: BlastSpec = {
  radius: 7.5,
  damage: 115,
  impulse: 3.5,
  noise: 65,
  selfDamage: 88,
  shrapnel: 28,
};

export interface TripwireSave {
  id: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  armed: boolean;
  friendly: boolean;
  key?: string;
}

export interface TripwireEntry {
  id: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  armed: boolean;
  fuseT: number;
  friendly: boolean;
  key?: string;
  mesh?: Group;
}

export interface TripwireWorld {
  scene: Scene;
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, ignoreGlass?: boolean): number;
  groundY(x: number, y: number, z: number): number;
  explode(at: Vector3, spec?: BlastSpec): void;
  sparkAt?(at: Vector3): void;
  toast(text: string, ms?: number): void;
}

const _pA = new Vector3();
const _pB = new Vector3();
const _mid = new Vector3();
const _dir = new Vector3();
const _axisY = new Vector3(0, 1, 0);
const _q = new Quaternion();

function distPointSegXZ(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax;
  const vz = bz - az;
  const wx = px - ax;
  const wz = pz - az;
  const len2 = vx * vx + vz * vz;
  if (len2 < 1e-6) return Math.hypot(wx, wz);
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2));
  return Math.hypot(wx - vx * t, wz - vz * t);
}

/**
 * Tactical explosive tripwires: wall-to-wall placement preview across doorways/corridors (`<= 3.5 m`),
 * subtle metallic glint wires, crouch 2.0 s disarm, 0.35 s pin-click warning + radial shrapnel detonation,
 * and rare enemy ambush traps inside bandit-held buildings.
 */
export class Tripwires {
  readonly list: TripwireEntry[] = [];
  private nextId = 1;
  private placing = false;
  private readonly handledAmbushKeys = new Set<string>();

  private readonly stakeGeo = new CylinderGeometry(0.022, 0.028, 0.34, 6);
  private readonly wireGeo = new BoxGeometry(1, 0.008, 0.008);
  private readonly pegMat = new MeshStandardMaterial({ color: 0x3b4933, roughness: 0.72, metalness: 0.25 });
  private readonly wireMat = new MeshStandardMaterial({ color: 0x9aa4a8, roughness: 0.3, metalness: 0.85 });

  private readonly previewGroup = new Group();
  private readonly previewWire: Mesh;
  private readonly previewPegA: Mesh;
  private readonly previewPegB: Mesh;
  private readonly previewMatOk = new MeshBasicMaterial({ color: 0x44ff77, transparent: true, opacity: 0.82 });
  private readonly previewMatBad = new MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.82 });
  private previewValid = false;
  private readonly previewA = new Vector3();
  private readonly previewB = new Vector3();

  constructor(private readonly w: TripwireWorld) {
    this.previewPegA = new Mesh(this.stakeGeo, this.previewMatBad);
    this.previewPegB = new Mesh(this.stakeGeo, this.previewMatBad);
    this.previewWire = new Mesh(this.wireGeo, this.previewMatBad);
    this.previewGroup.add(this.previewPegA, this.previewPegB, this.previewWire);
    this.previewGroup.visible = false;
    this.w.scene.add(this.previewGroup);
  }

  get isPlacing(): boolean {
    return this.placing;
  }

  startPlacement(inventory: Inventory): void {
    if (inventory.count('tripwire') <= 0) {
      this.w.toast(tr('Нет растяжки в инвентаре', 'No frag tripwire in inventory'), 1200);
      return;
    }
    this.placing = true;
    this.w.toast(
      tr('Наведите на проход (до 3.5 м): ЛКМ / E — поставить, ПКМ — отмена', 'Aim at doorway/corridor (<= 3.5 m): LMB / E — deploy, RMB — cancel'),
      2600,
    );
  }

  cancelPlacement(): void {
    this.placing = false;
    this.previewGroup.visible = false;
  }

  /** Evaluates horizontal span across walls/door jambs in front of player at 0.30 m height. */
  computePreview(px: number, py: number, pz: number, yaw: number): boolean {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const sx = Math.cos(yaw);
    const sz = -Math.sin(yaw);
    const probeX = px + fx * 1.25;
    const probeZ = pz + fz * 1.25;
    const floorY = this.w.groundY(probeX, py, probeZ);
    if (Math.abs(floorY - py) > 0.8) {
      this.previewValid = false;
      this.previewA.set(probeX - sx * 0.75, py + TRIPWIRE_HEIGHT, probeZ - sz * 0.75);
      this.previewB.set(probeX + sx * 0.75, py + TRIPWIRE_HEIGHT, probeZ + sz * 0.75);
      return false;
    }
    const wireY = floorY + TRIPWIRE_HEIGHT;
    const leftHit = this.w.rayHit(probeX, wireY + 0.05, probeZ, -sx, 0, -sz, 2.2, true);
    const rightHit = this.w.rayHit(probeX, wireY + 0.05, probeZ, sx, 0, sz, 2.2, true);
    const lDist = leftHit >= 0 ? leftHit : 1.0;
    const rDist = rightHit >= 0 ? rightHit : 1.0;
    this.previewA.set(probeX - sx * lDist, wireY, probeZ - sz * lDist);
    this.previewB.set(probeX + sx * rDist, wireY, probeZ + sz * rDist);
    const span = this.previewA.distanceTo(this.previewB);
    this.previewValid =
      leftHit >= 0 &&
      rightHit >= 0 &&
      span >= TRIPWIRE_MIN_SPAN &&
      span <= TRIPWIRE_MAX_SPAN &&
      this.w.rayHit(px, py + 0.5, pz, fx, 0, fz, 1.1, true) < 0;
    return this.previewValid;
  }

  /** Handles live preview update + confirm/cancel inputs. Returns true while consuming click/use input. */
  handlePlacementInput(
    px: number,
    py: number,
    pz: number,
    yaw: number,
    input: InputManager,
    inventory: Inventory,
  ): boolean {
    if (!this.placing) return false;
    if (inventory.count('tripwire') <= 0) {
      this.cancelPlacement();
      return false;
    }
    this.computePreview(px, py, pz, yaw);
    this.syncPreviewMesh();
    if (input.consumePressed('aim')) {
      this.cancelPlacement();
      this.w.toast(tr('Установка отменена', 'Placement cancelled'), 900);
      return true;
    }
    if (input.consumePressed('attack') || input.consumePressed('use')) {
      if (!this.previewValid) {
        this.w.toast(tr('Нужны две стены на расстоянии 0.5–3.5 м', 'Need two solid walls 0.5–3.5 m apart'), 1200);
        return true;
      }
      if (inventory.remove('tripwire', 1) > 0) {
        this.place(
          this.previewA.x,
          this.previewA.y,
          this.previewA.z,
          this.previewB.x,
          this.previewB.y,
          this.previewB.z,
          true,
        );
        sfx.item('click');
        this.w.toast(tr('Растяжка установлена', 'Tripwire deployed'), 1100);
      }
      this.cancelPlacement();
      return true;
    }
    return false;
  }

  place(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    friendly: boolean,
    key?: string,
    id = this.nextId++,
  ): TripwireEntry {
    if (id >= this.nextId) this.nextId = id + 1;
    const entry: TripwireEntry = { id, ax, ay, az, bx, by, bz, armed: true, fuseT: -1, friendly, key };
    entry.mesh = this.buildMesh(entry);
    this.w.scene.add(entry.mesh);
    this.list.push(entry);
    return entry;
  }

  /** Nearest disarmable tripwire within reach that the player faces. */
  disarmTarget(x: number, y: number, z: number, dirX: number, dirZ: number, reach = 1.65): TripwireEntry | null {
    let best: TripwireEntry | null = null;
    let bestD = reach;
    for (const t of this.list) {
      if (!t.armed || t.fuseT >= 0) continue;
      if (Math.abs(t.ay - TRIPWIRE_HEIGHT - y) > 1.2) continue;
      const d = distPointSegXZ(x, z, t.ax, t.az, t.bx, t.bz);
      if (d > bestD) continue;
      const mx = (t.ax + t.bx) * 0.5 - x;
      const mz = (t.az + t.bz) * 0.5 - z;
      const ml = Math.hypot(mx, mz);
      if (ml > 0.1 && (mx * dirX + mz * dirZ) / ml < 0.25) continue;
      bestD = d;
      best = t;
    }
    return best;
  }

  disarm(id: number): boolean {
    const idx = this.list.findIndex((t) => t.id === id);
    if (idx < 0) return false;
    const t = this.list[idx];
    if (t.key) this.handledAmbushKeys.add(t.key);
    this.removeAt(idx);
    sfx.item('click');
    return true;
  }

  /** Updates active tripwires: actor crossings trigger 0.35 s pin click fuse, then radial shrapnel detonation. */
  update(
    dt: number,
    playerPos: Vector3,
    playerCrouched: boolean,
    playerDead: boolean,
    zombies: readonly Zombie[],
    bandits: readonly Bandit[],
  ): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      if (t.fuseT >= 0) {
        t.fuseT -= dt;
        if (t.fuseT <= 0) {
          _mid.set((t.ax + t.bx) * 0.5, t.ay + 0.12, (t.az + t.bz) * 0.5);
          if (t.key) this.handledAmbushKeys.add(t.key);
          this.removeAt(i);
          this.w.explode(_mid, TRIPWIRE_BLAST);
        }
        continue;
      }
      if (!t.armed) continue;
      let tripped = false;
      if (!playerDead) {
        // Crouching slowly avoids accidentally snagging your own wire while letting you step up to disarm enemy wires.
        const playerRad = playerCrouched ? (t.friendly ? 0 : 0.16) : 0.36;
        if (
          playerRad > 0 &&
          Math.abs(playerPos.y - (t.ay - TRIPWIRE_HEIGHT)) <= 0.9 &&
          distPointSegXZ(playerPos.x, playerPos.z, t.ax, t.az, t.bx, t.bz) <= playerRad
        ) {
          tripped = true;
        }
      }
      if (!tripped) {
        for (const z of zombies) {
          if (z.state === 'dead') continue;
          if (Math.abs(z.pos.y - (t.ay - TRIPWIRE_HEIGHT)) > 0.9) continue;
          if (distPointSegXZ(z.pos.x, z.pos.z, t.ax, t.az, t.bx, t.bz) <= 0.38) {
            tripped = true;
            break;
          }
        }
      }
      if (!tripped) {
        for (const b of bandits) {
          if (b.isDead || b.state === 'dead') continue;
          if (Math.abs(b.pos.y - (t.ay - TRIPWIRE_HEIGHT)) > 0.9) continue;
          if (distPointSegXZ(b.pos.x, b.pos.z, t.ax, t.az, t.bx, t.bz) <= 0.38) {
            tripped = true;
            break;
          }
        }
      }
      if (tripped) {
        t.fuseT = TRIPWIRE_FUSE_S;
        _pA.set(t.ax, t.ay + 0.1, t.az);
        sfx.item('click');
        this.w.sparkAt?.(_pA);
      }
    }
  }

  /** Deterministic one-shot enemy tripwire placed by story dioramas (safe to call repeatedly). */
  addAmbushWire(ax: number, ay: number, az: number, bx: number, by: number, bz: number, key: string): void {
    if (this.handledAmbushKeys.has(key)) return;
    this.handledAmbushKeys.add(key);
    this.place(ax, ay, az, bx, by, bz, false, key);
  }

  /** Rare enemy ambush tripwires across interior doorways of buildings held by bandits. */
  spawnAmbushNearDoors(doors: readonly DoorNavSpot[], bandits: readonly Bandit[], seed: number): void {
    let added = 0;
    for (const d of doors) {
      if (added >= 2) break;
      if (!d.passable) continue;
      const key = `${Math.round(d.x * 2)},${Math.round(d.y * 2)},${Math.round(d.z * 2)}`;
      if (this.handledAmbushKeys.has(key)) continue;
      this.handledAmbushKeys.add(key);
      // Deterministic ~12% ambush rate, only if a bandit spawned/patrols nearby.
      const h = Math.abs(Math.sin(d.x * 12.9898 + d.z * 78.233 + seed * 37.719) * 43758.5453) % 1;
      if (h > 0.12) continue;
      const guarded = bandits.some((b) => !b.isDead && b.pos.distanceToSquared(_pA.set(d.x, d.y, d.z)) < 25 * 25);
      if (!guarded) continue;
      const tx = -d.nz;
      const tz = d.nx;
      const wireY = d.y + TRIPWIRE_HEIGHT;
      const h1 = this.w.rayHit(d.x, wireY + 0.05, d.z, tx, 0, tz, 1.4, true);
      const h2 = this.w.rayHit(d.x, wireY + 0.05, d.z, -tx, 0, -tz, 1.4, true);
      if (h1 < 0.25 || h2 < 0.25 || h1 + h2 > TRIPWIRE_MAX_SPAN) continue;
      this.place(
        d.x + tx * h1,
        wireY,
        d.z + tz * h1,
        d.x - tx * h2,
        wireY,
        d.z - tz * h2,
        false,
        key,
      );
      added++;
    }
  }

  serialize(): TripwireSave[] {
    return this.list.map((t) => ({
      id: t.id,
      ax: t.ax,
      ay: t.ay,
      az: t.az,
      bx: t.bx,
      by: t.by,
      bz: t.bz,
      armed: t.armed,
      friendly: t.friendly,
      key: t.key,
    }));
  }

  restore(saved: TripwireSave[] | undefined): void {
    this.clear();
    if (!saved) return;
    for (const s of saved) {
      if (!s.armed) continue;
      if (s.key) this.handledAmbushKeys.add(s.key);
      this.place(s.ax, s.ay, s.az, s.bx, s.by, s.bz, s.friendly, s.key, s.id);
    }
  }

  clear(): void {
    for (let i = this.list.length - 1; i >= 0; i--) this.removeAt(i);
  }

  dispose(): void {
    this.clear();
    this.previewGroup.removeFromParent();
    this.stakeGeo.dispose();
    this.wireGeo.dispose();
    this.pegMat.dispose();
    this.wireMat.dispose();
    this.previewMatOk.dispose();
    this.previewMatBad.dispose();
  }

  private removeAt(idx: number): void {
    const t = this.list[idx];
    t.mesh?.removeFromParent();
    this.list.splice(idx, 1);
  }

  private buildMesh(t: TripwireEntry): Group {
    const g = new Group();
    const pegA = new Mesh(this.stakeGeo, this.pegMat);
    const pegB = new Mesh(this.stakeGeo, this.pegMat);
    const wire = new Mesh(this.wireGeo, this.wireMat);
    pegA.position.set(t.ax, t.ay - 0.13, t.az);
    pegB.position.set(t.bx, t.by - 0.13, t.bz);
    _pA.set(t.ax, t.ay, t.az);
    _pB.set(t.bx, t.by, t.bz);
    _mid.addVectors(_pA, _pB).multiplyScalar(0.5);
    const len = _pA.distanceTo(_pB);
    _dir.subVectors(_pB, _pA).normalize();
    _q.setFromAxisAngle(_axisY, Math.atan2(-_dir.z, _dir.x));
    wire.position.copy(_mid);
    wire.quaternion.copy(_q);
    wire.scale.set(len, 1, 1);
    g.add(pegA, pegB, wire);
    return g;
  }

  private syncPreviewMesh(): void {
    this.previewGroup.visible = true;
    const mat = this.previewValid ? this.previewMatOk : this.previewMatBad;
    this.previewPegA.material = mat;
    this.previewPegB.material = mat;
    this.previewWire.material = mat;
    this.previewPegA.position.set(this.previewA.x, this.previewA.y - 0.13, this.previewA.z);
    this.previewPegB.position.set(this.previewB.x, this.previewB.y - 0.13, this.previewB.z);
    _mid.addVectors(this.previewA, this.previewB).multiplyScalar(0.5);
    const len = Math.max(0.1, this.previewA.distanceTo(this.previewB));
    _dir.subVectors(this.previewB, this.previewA).normalize();
    this.previewWire.position.copy(_mid);
    this.previewWire.quaternion.setFromAxisAngle(_axisY, Math.atan2(-_dir.z, _dir.x));
    this.previewWire.scale.set(len, 1.6, 1.6);
  }
}
