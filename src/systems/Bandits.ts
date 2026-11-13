/**
 * Hostile living survivor bots (bandits): full Mixamo skeletal rig with AnimationMixer gaits,
 * worn gear meshes, held 3D weapons, physical Ragdoll on death, and AI that prioritizes nearby
 * zombies first and the player second. Light-to-medium aim difficulty.
 */

import {
  type AnimationAction,
  BoxGeometry,
  type BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  type Scene,
  SkinnedMesh,
  Vector3,
} from 'three';
import { sfx, type EchoPlace, type GunSound } from '../audio/Sound';
import { type BodyId, bodyAsset, bodyNow, type ClipId, loadBody } from '../characters/assets';
import { coverBody, gearGeometry, gearKind, gearTexture, hideBits, loadGear, wornGear } from '../characters/gear';
import { handFrame } from '../characters/hands';
import { characterMaterial } from '../characters/material';
import { CharacterRig, RagdollPose, stand } from '../characters/rig';
import { type ItemId, ITEMS } from '../data/items';
import { type Ragdoll, type StaticBox } from '../physics/ragdoll';
import { BASE_LOOK, type Appearance, type Sex } from '../player/appearance';
import { figureScale } from '../player/CharacterFigure';
import { playerRagdoll } from '../player/deathBody';
import { gripHands } from '../player/grips';
import { gunRigData } from '../player/gunPose';
import { buildHeldModel, HELD, type HeldId } from '../player/held';
import { GunModel } from '../weapons/gunModel';
import { GUNS, type GunId } from '../weapons/guns';
import type { Worn } from './Inventory';
import type { BanditTarget, ZombieSim } from './zombies';

export interface BanditLootItem {
  id: ItemId;
  count: number;
  condition?: number;
}

export const BANDIT_BODY_ID = 700000;

export interface BanditWorld {
  scene: Scene;
  groundY(x: number, z: number): number;
  resolveCircle(pos: Vector3, r: number): void;
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number;
  boxesNear(x: number, z: number, r: number, out: StaticBox[]): void;
  addRagdoll(rd: Ragdoll): void;
  removeRagdoll(rd: Ragdoll): void;
  zombies: ZombieSim;
  noise(x: number, y: number, z: number, r: number): void;
  hurtPlayer(hp: number, fromX: number, fromZ: number, cause: string): void;
  placeAt(x: number, z: number): EchoPlace;
  onDropLoot?(bot: Bandit): void;
  onRemoveCorpse?(bot: Bandit): void;
}

export interface BanditHit {
  bot: Bandit;
  dist: number;
  head: boolean;
  point: Vector3;
}

type BanditGunId = Exclude<GunId, 'launcher_rpg'>;
type BanditMeleeId = 'bat' | 'crowbar' | 'axe';

const BANDIT_GUNS: readonly BanditGunId[] = [
  'pistol_g17',
  'pistol_m1911',
  'shotgun_pump',
  'rifle_m4a1',
  'rifle_ak',
  'rifle_hunting',
];
const BANDIT_MELEE: readonly BanditMeleeId[] = ['bat', 'crowbar', 'axe'];

const GUN_SOUND: Record<BanditGunId, GunSound> = {
  pistol_g17: 'pistol',
  pistol_m1911: 'pistol45',
  shotgun_pump: 'shotgun',
  rifle_m4a1: 'rifle',
  rifle_ak: 'ak',
  rifle_hunting: 'hunting',
};

const BANDIT_OUTFITS: readonly Worn[] = [
  { outfit: null, head: null, face: null, mask: null, torso: 'hoodie', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: 'backpackSchool', bag: null },
  { outfit: null, head: null, face: null, mask: 'balaclava', torso: 'leatherJacket', vest: 'vestMilitary', hands: null, legs: 'jeans', feet: 'boots', back: null, bag: null },
  { outfit: null, head: null, face: null, mask: 'shemagh', torso: 'workJacket', vest: null, hands: null, legs: 'cargoPants', feet: 'sneakers', back: null, bag: null },
];

const MAX_ACTIVE = 4;
const SPAWN_MIN = 26;
const SPAWN_MAX = 54;
const DESPAWN_DIST = 88;
const CORPSE_LIFE = 95;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _to = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _one = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _q2 = new Quaternion();

interface Tracer {
  mesh: Mesh;
  life: number;
}

interface BanditRigVisual {
  body: BodyId;
  scale: number;
  rig: CharacterRig;
  gaits: { idle: AnimationAction; walk: AnimationAction; run: AnimationAction };
  weights: { idle: number; walk: number; run: number };
  gear: Map<string, SkinnedMesh>;
  hide: { value: number };
  heldObj: Group | null;
  gunModel: GunModel | null;
  geos: BufferGeometry[];
}

export interface Bandit extends BanditTarget {
  id: number;
  pos: Vector3;
  vel: Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  state: 'patrol' | 'combat' | 'dead';
  look: Appearance;
  worn: Worn;
  weapon: ItemId;
  isGun: boolean;
  ammoInMag: number;
  magCap: number;
  fireCd: number;
  burstLeft: number;
  burstPause: number;
  reloadT: number;
  reactT: number;
  meleeCd: number;
  aiming: number;
  patrolYaw: number;
  patrolT: number;
  investigateX: number;
  investigateZ: number;
  investigateT: number;
  deadT: number;
  loot: BanditLootItem[];
  root: Group;
  visual: BanditRigVisual | null;
  ragdoll: Ragdoll | null;
  ragdollPose: RagdollPose | null;
  lootDropped: boolean;
  hit(dmg: number, fromX: number, fromZ: number, head?: boolean): boolean;
}

function randomLook(): Appearance {
  const sex: Sex = Math.random() < 0.78 ? 'male' : 'female';
  const base = BASE_LOOK[sex];
  return {
    ...base,
    name: sex === 'male' ? 'Бандит' : 'Бандитка',
    height: base.height + Math.round((Math.random() - 0.5) * 8),
  };
}

function makeStack(id: ItemId, count = 1): BanditLootItem {
  const def = ITEMS[id];
  return {
    id,
    count,
    condition: def.durability ? 0.5 + Math.random() * 0.4 : undefined,
  };
}

function createBanditLoot(weapon: ItemId, isGun: boolean): BanditLootItem[] {
  const loot: BanditLootItem[] = [makeStack(weapon, 1)];
  if (isGun) {
    const g = GUNS[weapon as BanditGunId];
    loot.push(makeStack(g.caliber, 4 + Math.floor(Math.random() * 10)));
  }
  if (Math.random() < 0.8) loot.push(makeStack('bandage', 1 + (Math.random() < 0.35 ? 1 : 0)));
  if (Math.random() < 0.65) loot.push(makeStack('beans', 1));
  if (Math.random() < 0.65) loot.push(makeStack('water', 1));
  return loot;
}

export class Bandits {
  readonly list: Bandit[] = [];
  private nextId = 1;
  private spawnCd = 4;
  private maxActive = MAX_ACTIVE;
  private disposed = false;
  private readonly tracers: Tracer[] = [];
  private readonly tracerGeo = new BoxGeometry(0.025, 0.025, 1);
  private readonly tracerMat = new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.78 });

  constructor(private readonly w: BanditWorld) {
    // Preload male/female skeletal rigs so bandits spawn smoothly with animations.
    void loadBody('male');
    void loadBody('female');
  }

  setMaxActive(n: number): void {
    this.maxActive = Math.max(1, n);
  }

  update(dt: number, px: number, py: number, pz: number, playerDead: boolean, inCar: boolean): void {
    this.updateTracers(dt);

    this.spawnCd -= dt;
    let aliveCount = 0;
    for (const b of this.list) if (b.state !== 'dead') aliveCount++;
    if (this.spawnCd <= 0 && aliveCount < this.maxActive) {
      this.trySpawnAround(px, pz);
      this.spawnCd = (this.maxActive <= 2 ? 9 : 5) + Math.random() * 5;
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const dx = px - b.pos.x;
      const dz = pz - b.pos.z;
      const distSq = dx * dx + dz * dz;

      if (b.state === 'dead') {
        b.deadT += dt;
        if (b.ragdollPose && b.ragdoll && !b.ragdoll.asleep) {
          this.applyRagdollPose(b);
        }
        if (b.deadT > CORPSE_LIFE || distSq > DESPAWN_DIST * DESPAWN_DIST) {
          this.removeAt(i);
        }
        continue;
      }

      if (distSq > DESPAWN_DIST * DESPAWN_DIST) {
        this.removeAt(i);
        continue;
      }

      const dist = Math.sqrt(distSq);
      b.fireCd = Math.max(0, b.fireCd - dt);
      b.meleeCd = Math.max(0, b.meleeCd - dt);
      b.burstPause = Math.max(0, b.burstPause - dt);
      b.aiming = Math.max(0, b.aiming - dt * 2.5);
      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) {
          b.ammoInMag = b.magCap;
          b.burstLeft = b.isGun ? 2 + Math.floor(Math.random() * 3) : 1;
        }
      }

      // Priority 1: nearest visible zombie within 14 m.
      const nearZombie = this.findNearestZombie(b.pos.x, b.pos.y, b.pos.z, 14);
      const canSeePlayer = !playerDead && dist < 38 && this.hasLineOfSight(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + 1.35, pz);
      if (canSeePlayer && b.state !== 'combat') {
        b.state = 'combat';
        b.reactT = 0.55 + Math.random() * 0.35;
      }

      const prevX = b.pos.x;
      const prevZ = b.pos.z;
      let moveSpeed = 0;

      if (nearZombie) {
        // Fight zombies first
        b.aiming = 1;
        const zdx = nearZombie.pos.x - b.pos.x;
        const zdz = nearZombie.pos.z - b.pos.z;
        const zd = Math.hypot(zdx, zdz) || 1;
        b.yaw = Math.atan2(zdx, zdz);
        if (b.isGun) {
          if (zd < 5.5) {
            this.stepBandit(b, -zdx / zd, -zdz / zd, 2.5 * dt);
            moveSpeed = 2.5;
          } else if (zd > 11) {
            this.stepBandit(b, zdx / zd, zdz / zd, 3.0 * dt);
            moveSpeed = 3.0;
          }
          if (b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0) {
            this.shootAt(b, nearZombie.pos.x, nearZombie.pos.y + 1.25, nearZombie.pos.z, false);
          }
        } else {
          if (zd > 1.75) {
            this.stepBandit(b, zdx / zd, zdz / zd, 3.8 * dt);
            moveSpeed = 3.8;
          } else if (b.meleeCd <= 0) {
            b.meleeCd = 0.95;
            this.w.zombies.hit(nearZombie, 26, b.pos.x, b.pos.z, false, _v1.set(nearZombie.pos.x, nearZombie.pos.y + 1.1, nearZombie.pos.z));
            sfx.swing('heavy', 0.25, b.pos);
          }
        }
      } else if (b.state === 'combat' && !playerDead) {
        // Priority 2: engage the player
        b.aiming = 1;
        b.yaw = Math.atan2(dx, dz);
        b.investigateX = px;
        b.investigateZ = pz;
        b.investigateT = 8;

        if (b.reactT > 0) {
          b.reactT -= dt;
        } else if (b.isGun) {
          const desiredMin = inCar ? 11 : 10;
          const desiredMax = 24;
          if (!canSeePlayer || dist > desiredMax) {
            const spd = dist > 20 ? 3.8 : 2.9;
            this.stepBandit(b, dx / (dist || 1), dz / (dist || 1), spd * dt);
            moveSpeed = spd;
          } else if (dist < desiredMin) {
            this.stepBandit(b, -dx / (dist || 1), -dz / (dist || 1), 2.1 * dt);
            moveSpeed = 2.1;
          } else {
            const strafe = Math.sin(b.id * 1.7 + this.w.zombies.list.length * 0.01);
            this.stepBandit(b, (-dz / (dist || 1)) * strafe, (dx / (dist || 1)) * strafe, 1.4 * dt);
            moveSpeed = 1.4;
          }

          if (canSeePlayer && b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0 && dist < 36) {
            this.shootAt(b, px, py + (inCar ? 1.05 : 1.38), pz, true);
          }
        } else {
          if (dist > 1.65) {
            this.stepBandit(b, dx / (dist || 1), dz / (dist || 1), 4.25 * dt);
            moveSpeed = 4.25;
          } else if (b.meleeCd <= 0) {
            b.meleeCd = 1.05 + Math.random() * 0.25;
            sfx.swing('heavy', 0.3, b.pos);
            if (!inCar) {
              this.w.hurtPlayer(12 + Math.random() * 7, b.pos.x, b.pos.z, 'Нападение бандита');
            }
          }
        }
        if (!canSeePlayer && b.investigateT <= 0) b.state = 'patrol';
      } else {
        // Patrol or investigate last noise
        if (b.investigateT > 0) {
          b.investigateT -= dt;
          const idx = b.investigateX - b.pos.x;
          const idz = b.investigateZ - b.pos.z;
          const idist = Math.hypot(idx, idz);
          if (idist > 2.2) {
            b.yaw = Math.atan2(idx, idz);
            this.stepBandit(b, idx / idist, idz / idist, 2.3 * dt);
            moveSpeed = 2.3;
          }
        } else {
          b.patrolT -= dt;
          if (b.patrolT <= 0) {
            b.patrolYaw += (Math.random() - 0.5) * 2.4;
            b.patrolT = 2.5 + Math.random() * 4;
          }
          b.yaw = b.patrolYaw;
          this.stepBandit(b, Math.sin(b.yaw), Math.cos(b.yaw), 1.55 * dt);
          moveSpeed = 1.55;
        }
      }

      if (b.investigateT > 0 && !canSeePlayer) b.investigateT -= dt;

      if (dt > 1e-4) {
        b.vel.set((b.pos.x - prevX) / dt, 0, (b.pos.z - prevZ) / dt);
      }

      b.root.position.copy(b.pos);
      b.root.rotation.set(0, b.yaw, 0);
      this.animateRig(b, dt, moveSpeed);
    }
  }

  /** Attract nearby bandits to gunfire or explosions. */
  onNoise(x: number, z: number, r: number): void {
    const r2 = r * r;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const dx = x - b.pos.x;
      const dz = z - b.pos.z;
      if (dx * dx + dz * dz <= r2) {
        b.investigateX = x;
        b.investigateZ = z;
        b.investigateT = 9;
      }
    }
  }

  /** Ray test against living bandits (player bullets, melee, bash, rockets). */
  hitTest(o: Vector3, d: Vector3, maxDist: number, slack = 0.04): BanditHit | null {
    let best: BanditHit | null = null;
    let bestT = maxDist;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const cx = b.pos.x;
      const cz = b.pos.z;
      const ox = o.x - cx;
      const oz = o.z - cz;
      const a = d.x * d.x + d.z * d.z;
      if (a < 1e-6) continue;
      const t = -(ox * d.x + oz * d.z) / a;
      if (t < 0 || t > bestT) continue;
      const hitX = o.x + d.x * t;
      const hitY = o.y + d.y * t;
      const hitZ = o.z + d.z * t;
      if (hitY < b.pos.y || hitY > b.pos.y + 1.8) continue;
      const rad = 0.34 + slack;
      if ((hitX - cx) ** 2 + (hitZ - cz) ** 2 > rad * rad) continue;
      bestT = t;
      best = {
        bot: b,
        dist: t,
        head: hitY >= b.pos.y + 1.44,
        point: new Vector3(hitX, hitY, hitZ),
      };
    }
    return best;
  }

  /** Apply damage to a bandit. Returns true if killed. */
  hit(b: Bandit, dmg: number, fromX: number, fromZ: number, head = false): boolean {
    if (b.state === 'dead') return false;
    b.hp -= dmg;
    b.state = 'combat';
    b.investigateX = fromX;
    b.investigateZ = fromZ;
    b.investigateT = 10;
    if (b.hp <= 0) {
      b.hp = 0;
      b.state = 'dead';
      b.deadT = 0;
      this.becomeRagdoll(b, fromX, fromZ);
      if (!b.lootDropped) {
        b.lootDropped = true;
        this.w.onDropLoot?.(b);
      }
      return true;
    }
    if (head) b.reactT = Math.max(b.reactT, 0.25);
    return false;
  }

  /** Explosion damage from RPG rockets. */
  blastDamage(at: Vector3, radius: number, maxDmg: number): void {
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const d = Math.hypot(b.pos.x - at.x, b.pos.y + 1 - at.y, b.pos.z - at.z);
      if (d > radius) continue;
      _v1.set(b.pos.x, b.pos.y + 1, b.pos.z).sub(at);
      const len = _v1.length() || 1;
      _v1.divideScalar(len);
      const wall = this.w.rayHit(at.x, at.y, at.z, _v1.x, _v1.y, _v1.z, len);
      if (wall >= 0 && wall < len - 0.3) continue;
      const k = 1 - d / radius;
      this.hit(b, maxDmg * k * k + 25 * k, at.x, at.z, false);
    }
  }

  /** Rammed by a driving car. */
  ramByCar(cx: number, cz: number, carVx: number, carVz: number, radius = 1.45): void {
    const speed = Math.hypot(carVx, carVz);
    if (speed < 2.4) return;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      const dx = b.pos.x - cx;
      const dz = b.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const nx = d > 0.01 ? dx / d : carVx / speed;
      const nz = d > 0.01 ? dz / d : carVz / speed;
      this.stepBandit(b, nx, nz, 1.3);
      const dmg = speed * 12;
      sfx.strike('blunt', b.pos, false, b.hp <= dmg);
      this.hit(b, dmg, cx, cz, false);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (let i = this.list.length - 1; i >= 0; i--) this.removeAt(i);
    for (const t of this.tracers) this.w.scene.remove(t.mesh);
    this.tracers.length = 0;
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
  }

  private trySpawnAround(px: number, pz: number): void {
    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const sx = px + Math.cos(ang) * dist;
      const sz = pz + Math.sin(ang) * dist;
      const sy = this.w.groundY(sx, sz);
      if (sy < -5) continue;
      _v1.set(sx, sy, sz);
      this.w.resolveCircle(_v1, 0.45);
      const rx = _v1.x;
      const rz = _v1.z;
      if (Math.hypot(rx - px, rz - pz) < SPAWN_MIN * 0.85) continue;

      const isGun = Math.random() < 0.7;
      const weapon: ItemId = isGun
        ? BANDIT_GUNS[Math.floor(Math.random() * BANDIT_GUNS.length)]
        : BANDIT_MELEE[Math.floor(Math.random() * BANDIT_MELEE.length)];
      const magCap = isGun ? GUNS[weapon as BanditGunId].capacity : 1;
      const look = randomLook();
      const worn = BANDIT_OUTFITS[Math.floor(Math.random() * BANDIT_OUTFITS.length)];

      const root = new Group();
      root.position.set(rx, sy, rz);
      this.w.scene.add(root);

      const bot: Bandit = {
        id: this.nextId++,
        pos: new Vector3(rx, sy, rz),
        vel: new Vector3(),
        yaw: Math.random() * Math.PI * 2,
        hp: 95,
        maxHp: 95,
        state: 'patrol',
        look,
        worn,
        weapon,
        isGun,
        ammoInMag: magCap,
        magCap,
        fireCd: 0.4,
        burstLeft: isGun ? 2 + Math.floor(Math.random() * 3) : 1,
        burstPause: 0,
        reloadT: 0,
        reactT: 0.65,
        meleeCd: 0,
        aiming: 0,
        patrolYaw: Math.random() * Math.PI * 2,
        patrolT: 2 + Math.random() * 3,
        investigateX: rx,
        investigateZ: rz,
        investigateT: 0,
        deadT: 0,
        loot: createBanditLoot(weapon, isGun),
        root,
        visual: null,
        ragdoll: null,
        ragdollPose: null,
        lootDropped: false,
        hit: (dmg, fx, fz, head = false) => this.hit(bot, dmg, fx, fz, head),
      };

      this.buildVisual(bot);
      this.list.push(bot);
      return;
    }
  }

  private buildVisual(b: Bandit): void {
    const body: BodyId = b.look.sex;
    if (!bodyNow(body)) {
      void loadBody(body).then(() => {
        if (!this.disposed && b.state !== 'dead' && !b.visual && this.list.includes(b)) {
          this.buildVisual(b);
        }
      });
      return;
    }

    coverBody(body);
    const scale = figureScale(b.look, body);
    const hide = { value: 0 };
    const rig = new CharacterRig(body, 0, { cover: true, hide });
    rig.root.scale.setScalar(scale);
    rig.mesh.castShadow = true;
    b.root.add(rig.root);

    const walkClip: ClipId = body === 'female' ? 'walking_female' : 'walking';
    const gaits = {
      idle: rig.action('idle'),
      walk: rig.action(walkClip),
      run: rig.action('running'),
    };
    gaits.idle.play();
    gaits.walk.play();
    gaits.run.play();
    gaits.idle.setEffectiveWeight(1);
    gaits.walk.setEffectiveWeight(0);
    gaits.run.setEffectiveWeight(0);

    const geos: BufferGeometry[] = [];
    let heldObj: Group | null = null;
    let gunModel: GunModel | null = null;
    const hand = rig.socket('hand');
    const hf = handFrame(rig.rig, 'R');

    if (b.isGun) {
      const gid = b.weapon as GunId;
      gunModel = new GunModel(gid);
      hand.add(gunModel.root);
      if (hf) {
        const d = gunRigData(gid).main;
        _m.compose(hf.grip, hf.q, _one).multiply(_m2.compose(d.at, d.q, _one).invert());
        _m.decompose(gunModel.root.position, gunModel.root.quaternion, gunModel.root.scale);
      }
      heldObj = gunModel.root;
    } else if (b.weapon in HELD) {
      const hid = b.weapon as HeldId;
      heldObj = buildHeldModel(hid, geos);
      hand.add(heldObj);
      if (hf) {
        heldObj.quaternion.copy(hf.q);
        heldObj.position.copy(hf.grip).sub(new Vector3(0, HELD[hid].main.along, 0).applyQuaternion(hf.q));
      }
    }

    const visual: BanditRigVisual = {
      body,
      scale,
      rig,
      gaits,
      weights: { idle: 1, walk: 0, run: 0 },
      gear: new Map(),
      hide,
      heldObj,
      gunModel,
      geos,
    };
    b.visual = visual;
    this.dressVisual(b, visual);
  }

  private dressVisual(b: Bandit, v: BanditRigVisual): void {
    const want = wornGear(b.worn);
    let missing = false;
    for (const g of want) {
      if (gearKind(g) === 'box' || v.gear.has(g)) continue;
      const geo = gearGeometry(v.body, g, 0);
      if (!geo) {
        missing = true;
        continue;
      }
      const mat = characterMaterial(bodyAsset(v.body), v.rig.rig, {
        map: gearTexture(g),
        doubleSide: gearKind(g) === 'mask',
      });
      const m = new SkinnedMesh(geo, mat);
      m.bind(v.rig.mesh.skeleton, v.rig.mesh.bindMatrix);
      m.frustumCulled = false;
      m.castShadow = true;
      v.rig.mesh.add(m);
      v.gear.set(g, m);
    }
    v.hide.value = hideBits(want);
    if (missing) {
      void loadGear(v.body, want).then(() => {
        if (!this.disposed && b.visual === v && b.state !== 'dead') {
          coverBody(v.body);
          this.dressVisual(b, v);
        }
      });
    }
  }

  private animateRig(b: Bandit, dt: number, speed: number): void {
    const v = b.visual;
    if (!v) return;
    const targetIdle = speed < 0.25 ? 1 : 0;
    const targetRun = speed > 3.2 ? 1 : 0;
    const targetWalk = speed >= 0.25 && speed <= 3.2 ? 1 : 0;

    const k = 1 - Math.exp(-dt * 9);
    v.weights.idle += (targetIdle - v.weights.idle) * k;
    v.weights.walk += (targetWalk - v.weights.walk) * k;
    v.weights.run += (targetRun - v.weights.run) * k;

    v.gaits.idle.setEffectiveWeight(v.weights.idle);
    v.gaits.walk.setEffectiveWeight(v.weights.walk);
    v.gaits.run.setEffectiveWeight(v.weights.run);
    v.gaits.walk.setEffectiveTimeScale(speed > 0.25 ? Math.max(0.75, speed / 1.8) : 1);
    v.gaits.run.setEffectiveTimeScale(speed > 3.2 ? Math.max(0.85, speed / 4.2) : 1);

    v.rig.mixer.update(dt);

    // Pose right hand grip & raise arm forward when aiming/fighting.
    const hr = handFrame(v.rig.rig, 'R');
    if (hr) {
      const gripName = b.isGun ? gripHands(b.weapon as GunId, true, false).R : gripHands(b.weapon as HeldId, false, false).R;
      for (const [idx, q] of hr.poses[gripName]) v.rig.bones[idx].quaternion.copy(q);
    }
    if (b.aiming > 0.05) {
      this.bendElbow(v.rig, 0.35 + 0.65 * b.aiming);
    }
  }

  private bendElbow(r: CharacterRig, angle: number): void {
    r.root.updateMatrixWorld(true);
    const fore = r.bone('RightForeArm');
    const hand = r.bone('RightHand');
    const pFore = fore.getWorldPosition(_v1);
    const pHand = hand.getWorldPosition(_v2);
    const dir = pHand.sub(pFore).normalize();
    const fwd = _to.set(0, 0, 1).applyQuaternion(r.root.getWorldQuaternion(_q));
    const axis = dir.cross(fwd);
    if (axis.lengthSq() < 1e-6) return;
    _q2.setFromAxisAngle(axis.normalize(), angle);
    const w = fore.getWorldQuaternion(_q);
    const pw = fore.parent!.getWorldQuaternion(new Quaternion());
    fore.quaternion.copy(pw.invert().multiply(_q2).multiply(w));
    r.root.updateMatrixWorld(true);
  }

  private becomeRagdoll(b: Bandit, fromX: number, fromZ: number): void {
    const v = b.visual;
    if (!v) {
      b.root.rotation.set(-Math.PI / 2, b.yaw, 0);
      b.root.position.set(b.pos.x, b.pos.y + 0.14, b.pos.z);
      return;
    }

    // Transfer rig from b.root to world space (RagdollPose drives bones in world space).
    const rig = v.rig;
    b.root.updateMatrixWorld(true);
    const world = rig.bones.map((bone) => bone.matrixWorld.clone());

    rig.root.removeFromParent();
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.set(0, 0, 0);
    rig.root.scale.set(1, 1, 1);
    rig.root.updateMatrixWorld(true);
    for (const bone of rig.bones) bone.matrixAutoUpdate = true;
    this.w.scene.add(rig.root);

    const st = stand(v.body, 0);
    const boxes: StaticBox[] = [];
    this.w.boxesNear(b.pos.x, b.pos.z, 1.8, boxes);
    const killer = new Vector3(fromX, b.pos.y, fromZ);
    const rd = playerRagdoll(b.pos, b.yaw + Math.PI, v.scale, b.vel, killer, boxes, Math.random, st.shape);
    const pose = new RagdollPose(v.body, 0, rig.rig, world, rd, v.scale);
    this.w.addRagdoll(rd);
    b.ragdoll = rd;
    b.ragdollPose = pose;
    this.applyRagdollPose(b);
  }

  private applyRagdollPose(b: Bandit): void {
    if (!b.ragdollPose || !b.visual) return;
    const w = b.ragdollPose.update();
    const bones = b.visual.rig.bones;
    const parents = b.visual.rig.rig.parents;
    for (let k = 0; k < w.length; k++) {
      const p = parents[k];
      const local = p < 0 ? _m.copy(w[k]) : _m.copy(w[p]).invert().multiply(w[k]);
      local.decompose(bones[k].position, bones[k].quaternion, bones[k].scale);
    }
  }

  private removeAt(i: number): void {
    const b = this.list[i];
    if (b.state === 'dead') this.w.onRemoveCorpse?.(b);
    if (b.ragdoll) this.w.removeRagdoll(b.ragdoll);
    this.w.scene.remove(b.root);
    if (b.visual) {
      this.w.scene.remove(b.visual.rig.root);
      for (const m of b.visual.gear.values()) {
        m.removeFromParent();
        (m.material as { dispose(): void }).dispose();
      }
      b.visual.gear.clear();
      for (const g of b.visual.geos) g.dispose();
      b.visual.rig.dispose();
    }
    this.list.splice(i, 1);
  }

  private stepBandit(b: Bandit, nx: number, nz: number, step: number): void {
    b.pos.x += nx * step;
    b.pos.z += nz * step;
    this.w.resolveCircle(b.pos, 0.34);
    b.pos.y = this.w.groundY(b.pos.x, b.pos.z);
  }

  private hasLineOfSight(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    _v1.set(tx - ox, ty - oy, tz - oz);
    const len = _v1.length();
    if (len < 0.1) return true;
    _v1.divideScalar(len);
    const hit = this.w.rayHit(ox, oy, oz, _v1.x, _v1.y, _v1.z, len);
    return hit < 0 || hit > len - 0.35;
  }

  private findNearestZombie(x: number, y: number, z: number, radius: number) {
    let best = null;
    let bestD2 = radius * radius;
    for (const zmb of this.w.zombies.list) {
      if (zmb.state === 'dead' || Math.abs(zmb.pos.y - y) > 2.5) continue;
      const d2 = (zmb.pos.x - x) ** 2 + (zmb.pos.z - z) ** 2;
      if (d2 < bestD2 && this.hasLineOfSight(x, y + 1.45, z, zmb.pos.x, zmb.pos.y + 1.2, zmb.pos.z)) {
        bestD2 = d2;
        best = zmb;
      }
    }
    return best;
  }

  private shootAt(b: Bandit, tx: number, ty: number, tz: number, targetIsPlayer: boolean): void {
    const gId = b.weapon as BanditGunId;
    const g = GUNS[gId];
    const ox = b.pos.x + Math.sin(b.yaw) * 0.35;
    const oy = b.pos.y + 1.42;
    const oz = b.pos.z + Math.cos(b.yaw) * 0.35;

    _to.set(tx - ox, ty - oy, tz - oz);
    const targetDist = _to.length() || 1;
    _to.divideScalar(targetDist);

    const spread = gId === 'shotgun_pump' ? 0.16 : 0.125;
    _to.x += (Math.random() - 0.5) * spread;
    _to.y += (Math.random() - 0.5) * spread * 0.65;
    _to.z += (Math.random() - 0.5) * spread;
    _to.normalize();

    const maxRange = 46;
    const wall = this.w.rayHit(ox, oy, oz, _to.x, _to.y, _to.z, maxRange);
    const maxTrace = wall >= 0 ? wall : maxRange;

    let hitDist = maxTrace;
    if (targetIsPlayer) {
      const px = tx;
      const py = ty - 0.15;
      const pz = tz;
      const ex = px - ox;
      const ey = py - oy;
      const ez = pz - oz;
      const proj = ex * _to.x + ey * _to.y + ez * _to.z;
      if (proj > 0 && proj < hitDist) {
        const d2 = ex * ex + ey * ey + ez * ez - proj * proj;
        if (d2 < 0.36 * 0.36) {
          hitDist = proj;
          const rawDmg = (g.damage[0] + g.damage[1]) * 0.22;
          this.w.hurtPlayer(Math.max(5, Math.min(18, rawDmg)), b.pos.x, b.pos.z, 'Пулевое ранение от бандита');
        }
      }
    } else {
      const zh = this.w.zombies.hitTest(_v2.set(ox, oy, oz), _to, maxTrace, 0.05);
      if (zh) {
        hitDist = zh.dist;
        const dmg = g.damage[0] * 0.85;
        this.w.zombies.hit(zh.zombie, dmg, ox, oz, zh.head, zh.point);
      }
    }

    this.spawnTracer(ox, oy, oz, _to.x, _to.y, _to.z, Math.min(hitDist, 32));
    sfx.gunShot(GUN_SOUND[gId], b.pos, false, this.w.placeAt(b.pos.x, b.pos.z));
    this.w.noise(b.pos.x, b.pos.y, b.pos.z, Math.min(40, g.noise * 0.7));

    b.ammoInMag--;
    b.burstLeft--;
    if (b.ammoInMag <= 0) {
      b.reloadT = 2.2;
    } else if (b.burstLeft <= 0) {
      b.burstLeft = 2 + Math.floor(Math.random() * 3);
      b.burstPause = 1.0 + Math.random() * 0.7;
    } else {
      b.fireCd = Math.max(0.24, 60 / Math.min(260, g.rpm));
    }
  }

  private spawnTracer(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, dist: number): void {
    const len = Math.max(0.6, Math.min(dist, 24));
    const mesh = new Mesh(this.tracerGeo, this.tracerMat);
    mesh.scale.set(1, 1, len);
    mesh.position.set(ox + dx * (len * 0.5), oy + dy * (len * 0.5), oz + dz * (len * 0.5));
    mesh.lookAt(ox + dx * len, oy + dy * len, oz + dz * len);
    this.w.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.06 });
  }

  private updateTracers(dt: number): void {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.w.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
      }
    }
  }
}

export { _up };
export type { Group };
