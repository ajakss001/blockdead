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
import { characterMaterial, LENS_TINT } from '../characters/material';
import { CharacterRig, RagdollPose, stand } from '../characters/rig';
import { ensureStackUid, type ItemId, type ItemStack, WEAR_SLOTS, type WearSlot } from '../data/items';
import { type Ragdoll, type StaticBox } from '../physics/ragdoll';
import { BASE_LOOK, type Appearance, type Sex } from '../player/appearance';
import { bodyFor, figureScale } from '../player/CharacterFigure';
import { playerRagdoll } from '../player/deathBody';
import { gripHands } from '../player/grips';
import { gunRigData } from '../player/gunPose';
import { buildHeldModel, HELD, type HeldId } from '../player/held';
import { GunModel } from '../weapons/gunModel';
import { GUNS, type GunId, MOD_FITS, type ModId } from '../weapons/guns';
import { type BuildingDesc, FLOOR_H } from '../world/gen/highrise';
import { applyZonalArmor, type HitZone } from './Armor';
import type { CorpseData, CorpseSlotKey } from './Containers';
import type { Worn } from './Inventory';
import type { BanditTarget, ZombieSim } from './zombies';

export type FactionId = 'scavs' | 'pmc' | 'snipers';
export type SpawnKind = 'street' | 'indoor' | 'sniper';

export interface BanditLootItem {
  id: ItemId;
  count: number;
  condition?: number;
}

export const BANDIT_BODY_ID = 700000;

export interface BanditWorld {
  scene: Scene;
  groundY(x: number, z: number, y?: number): number;
  resolveCircle(pos: Vector3, r: number): void;
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): number;
  boxesNear(x: number, z: number, r: number, out: StaticBox[]): void;
  buildingsNear(x: number, z: number, r: number): BuildingDesc[];
  addRagdoll(rd: Ragdoll): void;
  removeRagdoll(rd: Ragdoll): void;
  zombies: ZombieSim;
  noise(x: number, y: number, z: number, r: number): void;
  hurtPlayer(hp: number, fromX: number, fromZ: number, cause: string, zone?: HitZone): void;
  placeAt(x: number, z: number): EchoPlace;
  isInteriorLoaded?(buildingId: number): boolean;
  onDropLoot?(bot: Bandit): void;
  onRemoveCorpse?(bot: Bandit): void;
}

export interface BanditHit {
  bot: Bandit;
  dist: number;
  head: boolean;
  zone: HitZone;
  point: Vector3;
}

type BanditGunId = Exclude<GunId, 'launcher_rpg'>;
type BanditMeleeId = 'bat' | 'crowbar' | 'axe';

const BANDIT_MELEE: readonly BanditMeleeId[] = ['bat', 'crowbar', 'axe'];

const GUN_SOUND: Record<BanditGunId, GunSound> = {
  pistol_g17: 'pistol',
  pistol_m1911: 'pistol45',
  shotgun_pump: 'shotgun',
  rifle_m4a1: 'rifle',
  rifle_ak: 'ak',
  rifle_hunting: 'hunting',
};

const FACTION_OUTFITS: Record<FactionId, readonly Worn[]> = {
  // Regular survivor bandits: no body armor, no ballistic helmets, simple firearms/melee
  scavs: [
    { outfit: null, head: null, face: null, mask: null, torso: 'hoodie', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: 'backpackSchool', bag: null },
    { outfit: null, head: null, face: null, mask: 'shemagh', torso: 'workJacket', vest: null, hands: 'workGloves', legs: 'cargoPants', feet: 'sneakers', back: null, bag: null },
    { outfit: 'outfitMechanic', head: null, face: null, mask: null, torso: null, vest: null, hands: null, legs: null, feet: 'boots', back: 'backpackSchool', bag: null },
    { outfit: null, head: null, face: null, mask: 'maskHalf', torso: 'leatherJacket', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: null, bag: null },
  ],
  // Elite tactical bandits: full body armor, helmets, tactical vests/rigs, military/SWAT gear
  pmc: [
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: null, mask: 'balaclava', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    { outfit: 'outfitSwat', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: 'gogglesTactical', mask: 'shemagh', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackHiking', bag: null },
  ],
  snipers: [
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
  ],
};

const FACTION_TINTS: Record<FactionId, readonly number[]> = {
  scavs: [0x6e4f3a, 0x3f4e5e, 0x585346, 0x4b3b36, 0x3b4a3c, 0x62503c],
  pmc: [0x3b4432, 0x2c302e, 0x454a3a, 0x25282c],
  snipers: [0x3c4836, 0x2f362c],
};

const MAX_ACTIVE = 4;
const SPAWN_MIN = 34;
const SPAWN_MAX = 64;
const DESPAWN_DIST = 92;
const CORPSE_LIFE = 95;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _to = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _one = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
const _barrel = new Vector3(0, 0, -1);
const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _q4 = new Quaternion();
const _q5 = new Quaternion();

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
  faction: FactionId;
  spawnKind: SpawnKind;
  pos: Vector3;
  vel: Vector3;
  yaw: number;
  hp: number;
  maxHp: number;
  isDead: boolean;
  state: 'patrol' | 'combat' | 'dead';
  look: Appearance;
  worn: Worn;
  wornDirt: Partial<Record<WearSlot, number>>;
  tint: number;
  weapon: ItemId;
  mods: ModId[];
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
  aimBlend: number;
  aimPitch: number;
  recoilKick: number;
  swingT: number;
  patrolYaw: number;
  patrolT: number;
  investigateX: number;
  investigateZ: number;
  investigateT: number;
  stepDist: number;
  deadT: number;
  loot: BanditLootItem[];
  corpse: CorpseData;
  root: Group;
  visual: BanditRigVisual | null;
  ragdoll: Ragdoll | null;
  ragdollPose: RagdollPose | null;
  lootDropped: boolean;
  hit(dmg: number, fromX: number, fromZ: number, head?: boolean, zone?: HitZone): boolean;
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

function rollEliteMods(weapon: GunId): ModId[] {
  const mods: ModId[] = [];
  if (MOD_FITS.mod_suppressor.includes(weapon) && Math.random() < 0.7) mods.push('mod_suppressor');
  if (MOD_FITS.mod_ext_mag_ak.includes(weapon) && Math.random() < 0.55) mods.push('mod_ext_mag_ak');
  else if (MOD_FITS.mod_ext_mag_m4.includes(weapon) && Math.random() < 0.55) mods.push('mod_ext_mag_m4');
  if (MOD_FITS.mod_flashlight.includes(weapon) && Math.random() < 0.5) mods.push('mod_flashlight');
  return mods;
}

function buildBanditLootAndCorpse(
  faction: FactionId,
  look: Appearance,
  worn: Worn,
  tint: number,
  weapon: ItemId,
  isGun: boolean,
  mods: ModId[],
): { loot: BanditLootItem[]; corpse: CorpseData } {
  const tier: 'regular' | 'elite' = faction === 'scavs' ? 'regular' : 'elite';
  const slots: Partial<Record<CorpseSlotKey, ItemStack>> = {};
  const weaponStack: ItemStack = {
    id: weapon,
    count: 1,
    dirt: 0.1 + Math.random() * 0.25,
    ...(mods.length ? { mods: [...mods] } : {}),
  };
  ensureStackUid(weaponStack);
  slots.hand = weaponStack;

  for (const slot of WEAR_SLOTS) {
    const id = worn[slot];
    if (!id) continue;
    const st: ItemStack = {
      id,
      count: 1,
      dirt: 0.08 + Math.random() * 0.24,
      ...(slot === 'torso' ? { tint } : {}),
    };
    ensureStackUid(st);
    slots[slot as CorpseSlotKey] = st;
  }

  const pockets: ItemStack[] = [];
  const rig: ItemStack[] = [];
  const backpack: ItemStack[] = [];
  const pushStack = (arr: ItemStack[], id: ItemId, count: number) => {
    if (count <= 0) return;
    const st: ItemStack = { id, count };
    ensureStackUid(st);
    arr.push(st);
  };

  if (tier === 'regular') {
    // Regular survivor bandits: simple gun with <= 10 rounds, no armor, minimal pocket meds/rations.
    if (isGun) {
      const g = GUNS[weapon as BanditGunId];
      pushStack(pockets, g.caliber, 4 + Math.floor(Math.random() * 7));
    }
    if (Math.random() < 0.65) pushStack(pockets, 'bandage', 1);
    if (worn.back) {
      if (Math.random() < 0.6) pushStack(backpack, 'water', 1);
      if (Math.random() < 0.6) pushStack(backpack, 'beans', 1);
    } else if (Math.random() < 0.45) {
      pushStack(pockets, 'crackers', 1);
    }
  } else {
    // Elite armored bandits: 40+ quality rounds, spare mags in rig, medicine & rations.
    const g = GUNS[weapon as BanditGunId];
    const totalAmmo = 40 + Math.floor(Math.random() * 26); // 40..65 rounds
    const rigTarget = worn.vest ? rig : pockets;
    pushStack(rigTarget, g.caliber, totalAmmo);
    if (g.mag) {
      const magCount = 1 + (Math.random() < 0.55 ? 1 : 0);
      for (let i = 0; i < magCount; i++) pushStack(rigTarget, g.mag, 1);
    }
    pushStack(rigTarget, 'bandage', 2);
    pushStack(pockets, 'painkillers', 1 + (Math.random() < 0.45 ? 1 : 0));
    if (Math.random() < 0.45) pushStack(pockets, 'antibiotics', 1);
    if (worn.back) {
      pushStack(backpack, 'ration', 1);
      pushStack(backpack, 'water', 1);
    }
  }

  const corpse: CorpseData = {
    name: look.name,
    tierLabel: faction === 'snipers' ? 'Снайпер' : tier === 'elite' ? 'Элитный боец' : 'Выживший-бандит',
    tier,
    slots,
    pockets,
    rig,
    backpack,
    searchedPockets: false,
    searchedRig: !worn.vest,
    searchedBackpack: !worn.back,
  };

  // Flat fallback mirror kept in sync for tests / serializers.
  const loot: BanditLootItem[] = [];
  for (const s of Object.values(slots)) if (s) loot.push({ id: s.id, count: s.count, condition: s.dirt });
  for (const s of [...pockets, ...rig, ...backpack]) loot.push({ id: s.id, count: s.count });
  return { loot, corpse };
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
    // Preload base male/female rigs; faction costume rigs load on demand when a bandit spawns with them.
    void loadBody('male');
    void loadBody('female');
  }

  setMaxActive(n: number): void {
    this.maxActive = Math.max(1, n);
  }

  /** Ensure newly spawned bots never collide with restored corpse container IDs. */
  reserveIdsAbove(id: number): void {
    if (id >= this.nextId) this.nextId = id + 1;
  }

  findByBodyId(containerId: number): Bandit | undefined {
    return this.list.find((b) => BANDIT_BODY_ID + b.id === containerId);
  }

  update(
    dt: number,
    px: number,
    py: number,
    pz: number,
    playerDead: boolean,
    inCar: boolean,
    playerReloading = false,
    playerVx = 0,
    playerVz = 0,
    fog = 0,
    playerArmed = false,
  ): void {
    this.updateTracers(dt);

    this.spawnCd -= dt;
    let aliveStreet = 0;
    let aliveIndoor = 0;
    let aliveSniper = 0;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      if (b.spawnKind === 'street') aliveStreet++;
      else if (b.spawnKind === 'indoor') aliveIndoor++;
      else aliveSniper++;
    }
    const baseStreet = this.maxActive <= 2 ? 1 : 2;
    const streetCap = baseStreet + (playerArmed && this.maxActive > 2 ? 1 : 0);
    const indoorCap = this.maxActive <= 2 ? 1 : 2;
    const sniperChance = playerArmed ? 0.28 : 0.08;
    if (this.spawnCd <= 0) {
      if (aliveIndoor < indoorCap && this.trySpawnIndoor(px, pz, playerArmed)) {
        // Spawned indoor rat
      } else if (aliveSniper < 1 && Math.random() < sniperChance && this.trySpawnSniper(px, pz)) {
        // Rooftop sniper
      } else if (aliveStreet < streetCap) {
        this.trySpawnAround(px, pz, playerArmed);
      }
      this.spawnCd = playerArmed
        ? (this.maxActive <= 2 ? 9 : 6) + Math.random() * 4.5
        : (this.maxActive <= 2 ? 14 : 11) + Math.random() * 6;
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const dx = px - b.pos.x;
      const dz = pz - b.pos.z;
      const distSq = dx * dx + dz * dz;

      if (b.isDead && b.state === 'dead') {
        b.deadT += dt;
        if (b.ragdollPose && b.ragdoll && !b.ragdoll.asleep) {
          this.applyRagdollPose(b);
        }
        if (b.isDead && !b.lootDropped && (!b.ragdoll || b.ragdoll.asleep || b.deadT > 2.0)) {
          b.lootDropped = true;
          this.w.onDropLoot?.(b);
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
      b.aiming = Math.max(0, b.aiming - dt * 1.4);
      b.recoilKick *= Math.exp(-dt * 14);
      b.swingT = Math.max(0, b.swingT - dt * 3.6);
      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) {
          b.ammoInMag = b.magCap;
          b.burstLeft = b.isGun ? 2 + Math.floor(Math.random() * 3) : 1;
        }
      }

      // Priority 1: nearest visible zombie within sight (reduced in fog).
      const fogMul = 1 - 0.68 * fog;
      const sightRange = (b.spawnKind === 'sniper' ? 56 : 38) * fogMul;
      const nearZombie = this.findNearestZombie(b.pos.x, b.pos.y, b.pos.z, 14 * (1 - 0.45 * fog));
      const canSeePlayer =
        !playerDead &&
        dist < sightRange &&
        (this.hasLineOfSight(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + 1.56, pz) ||
          this.hasLineOfSight(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + 1.15, pz));
      if (canSeePlayer && b.state !== 'combat') {
        b.state = 'combat';
        b.reactT =
          b.faction === 'snipers'
            ? 0.22 + Math.random() * 0.14
            : b.faction === 'pmc'
              ? 0.26 + Math.random() * 0.16
              : 0.34 + Math.random() * 0.2;
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
          b.aimPitch = Math.max(-0.45, Math.min(0.45, (nearZombie.pos.y - b.pos.y) / zd));
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
            b.swingT = 1;
            this.w.zombies.hit(nearZombie, 26, b.pos.x, b.pos.z, false, _v1.set(nearZombie.pos.x, nearZombie.pos.y + 1.1, nearZombie.pos.z));
            sfx.swing('heavy', 0.25, b.pos);
          }
        }
      } else if (b.state === 'combat' && !playerDead) {
        // Priority 2: Tarkov-like tactical AI vs player
        b.aiming = 1;
        b.yaw = Math.atan2(dx, dz);
        b.aimPitch = Math.max(-0.55, Math.min(0.55, (py - b.pos.y) / (dist || 1)));
        b.investigateX = px;
        b.investigateZ = pz;
        b.investigateT = 9;

        const nx = dx / (dist || 1);
        const nz = dz / (dist || 1);
        const playerFleeing = dist > 9 && (playerVx * nx + playerVz * nz) > 2.0;
        const shouldRetreat = b.hp < b.maxHp * 0.36 || (b.isGun && b.reloadT > 0);

        if (b.reactT > 0) {
          b.reactT -= dt;
        } else if (b.spawnKind === 'sniper') {
          // Rooftop snipers hold high ground and fire carefully
          if (shouldRetreat && dist < 24) {
            this.stepBandit(b, -nx, -nz, 1.8 * dt);
            moveSpeed = 1.8;
          }
          if (canSeePlayer && b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0 && dist < 56) {
            this.shootAt(b, px, py + (inCar ? 1.05 : 1.38), pz, true, inCar);
          }
        } else if (b.isGun) {
          if (shouldRetreat) {
            // Tactical retreat while reloading or badly hurt
            this.stepBandit(b, -nx, -nz, 3.0 * dt);
            moveSpeed = 3.0;
          } else if (playerReloading && dist < 26 && !inCar) {
            // Push aggressively when the player is reloading!
            this.stepBandit(b, nx, nz, 3.85 * dt);
            moveSpeed = 3.85;
          } else if (playerFleeing && dist < 34) {
            // Chase fleeing player
            this.stepBandit(b, nx, nz, 4.1 * dt);
            moveSpeed = 4.1;
          } else {
            const desiredMin = inCar ? 11 : 10;
            const desiredMax = 24;
            if (!canSeePlayer || dist > desiredMax) {
              const spd = dist > 20 ? 3.8 : 2.9;
              this.stepBandit(b, nx, nz, spd * dt);
              moveSpeed = spd;
            } else if (dist < desiredMin) {
              this.stepBandit(b, -nx, -nz, 2.1 * dt);
              moveSpeed = 2.1;
            } else {
              const strafe = Math.sin(b.id * 1.7 + this.w.zombies.list.length * 0.01);
              this.stepBandit(b, -nz * strafe, nx * strafe, 1.4 * dt);
              moveSpeed = 1.4;
            }
          }

          if (canSeePlayer && b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0 && dist < 38) {
            this.shootAt(b, px, py + (inCar ? 1.05 : 1.38), pz, true, inCar);
          }
        } else {
          if (b.hp < b.maxHp * 0.25 && dist < 6) {
            this.stepBandit(b, -nx, -nz, 3.6 * dt);
            moveSpeed = 3.6;
          } else if (dist > 1.65) {
            this.stepBandit(b, nx, nz, 4.25 * dt);
            moveSpeed = 4.25;
          } else if (canSeePlayer && b.meleeCd <= 0) {
            b.meleeCd = 1.05 + Math.random() * 0.25;
            b.swingT = 1;
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
        const moved = Math.hypot(b.pos.x - prevX, b.pos.z - prevZ);
        b.vel.set((b.pos.x - prevX) / dt, 0, (b.pos.z - prevZ) / dt);
        if (moved > 0.002) {
          b.stepDist += moved;
          const stride = moveSpeed > 3.2 ? 2.2 : 1.75;
          if (b.stepDist >= stride) {
            b.stepDist %= stride;
            const surf = Math.abs(b.pos.y) > 0.4 ? 'concrete' : 'asphalt';
            sfx.step(surf, moveSpeed > 3.2 ? 'run' : 'walk', b.pos, 0.78);
          }
        }
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
      const relY = hitY - b.pos.y;
      const head = relY >= 1.44;
      const zone: HitZone = head ? 'head' : relY >= 0.8 ? 'torso' : 'limbs';
      best = {
        bot: b,
        dist: t,
        head,
        zone,
        point: new Vector3(hitX, hitY, hitZ),
      };
    }
    return best;
  }

  /** Apply damage to a bandit with unified zonal armor mitigation. Returns true if killed. */
  hit(b: Bandit, dmg: number, fromX: number, fromZ: number, head = false, zone?: HitZone): boolean {
    if (b.isDead || b.state === 'dead') return false;
    const hitZone: HitZone = zone ?? (head ? 'head' : 'torso');
    const armor = applyZonalArmor(dmg, hitZone, b.worn, b.wornDirt);
    if (armor.armored && armor.hitSlot) {
      const nextDirt = Math.min(1, (b.wornDirt[armor.hitSlot] ?? 0) + 0.04);
      b.wornDirt[armor.hitSlot] = nextDirt;
      const st = b.corpse.slots[armor.hitSlot];
      if (st) st.dirt = nextDirt;
    }
    b.hp -= armor.damage;
    b.state = 'combat';
    b.investigateX = fromX;
    b.investigateZ = fromZ;
    b.investigateT = 10;
    if (b.hp <= 0) {
      b.hp = 0;
      b.isDead = true;
      b.state = 'dead';
      b.deadT = 0;
      this.becomeRagdoll(b, fromX, fromZ);
      if (b.isDead && !b.ragdoll && !b.lootDropped) {
        b.lootDropped = true;
        this.w.onDropLoot?.(b);
      }
      return true;
    }
    if (head) b.reactT = Math.max(b.reactT, 0.2);
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

  private trySpawnAround(px: number, pz: number, playerArmed: boolean): void {
    const simpleGuns: readonly BanditGunId[] = ['pistol_g17', 'pistol_m1911', 'shotgun_pump'];
    const eliteChance = playerArmed ? 0.62 : 0.12;
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

      const faction: FactionId = Math.random() < eliteChance ? 'pmc' : 'scavs';
      const isGun = faction === 'pmc' ? true : Math.random() < 0.72;
      const weapon: ItemId = isGun
        ? faction === 'pmc'
          ? (Math.random() < 0.5 ? 'rifle_m4a1' : 'rifle_ak')
          : simpleGuns[Math.floor(Math.random() * simpleGuns.length)]
        : BANDIT_MELEE[Math.floor(Math.random() * BANDIT_MELEE.length)];
      const mods: ModId[] = isGun && faction === 'pmc' ? rollEliteMods(weapon as GunId) : [];
      this.spawnBot(rx, sy, rz, faction, 'street', weapon, isGun, mods);
      return;
    }
  }

  private trySpawnIndoor(px: number, pz: number, playerArmed: boolean): boolean {
    const blds = this.w.buildingsNear(px, pz, 55).filter((b) => (this.w.isInteriorLoaded ? this.w.isInteriorLoaded(b.id) : true));
    if (blds.length === 0) return false;
    const bld = blds[Math.floor(Math.random() * blds.length)];
    const floor = Math.floor(Math.random() * Math.min(2, bld.floors));
    const sx = bld.cx + (Math.random() - 0.5) * Math.max(2, bld.w - 3.5);
    const sz = bld.cz + (Math.random() - 0.5) * Math.max(2, bld.d - 3.5);
    if (Math.hypot(sx - px, sz - pz) < 16) return false;
    const sy = this.w.groundY(sx, sz, floor * FLOOR_H + 0.5);
    _v1.set(sx, sy, sz);
    this.w.resolveCircle(_v1, 0.45);
    const eliteChance = playerArmed ? 0.58 : 0.1;
    const faction: FactionId = Math.random() < eliteChance ? 'pmc' : 'scavs';
    const isGun = faction === 'pmc' ? true : Math.random() < 0.65;
    const weapon: ItemId = isGun
      ? faction === 'pmc'
        ? (Math.random() < 0.5 ? 'rifle_m4a1' : 'rifle_ak')
        : (Math.random() < 0.5 ? 'pistol_g17' : 'shotgun_pump')
      : BANDIT_MELEE[Math.floor(Math.random() * BANDIT_MELEE.length)];
    const mods: ModId[] = isGun && faction === 'pmc' ? rollEliteMods(weapon as GunId) : [];
    this.spawnBot(_v1.x, sy, _v1.z, faction, 'indoor', weapon, isGun, mods);
    return true;
  }

  private trySpawnSniper(px: number, pz: number): boolean {
    const blds = this.w.buildingsNear(px, pz, 68).filter((b) => b.floors >= 2);
    if (blds.length === 0) return false;
    const bld = blds[Math.floor(Math.random() * blds.length)];
    const roofY = bld.floors * FLOOR_H;
    const edgeX = bld.cx + (Math.random() < 0.5 ? -1 : 1) * Math.max(1, bld.w * 0.35);
    const edgeZ = bld.cz + (Math.random() < 0.5 ? -1 : 1) * Math.max(1, bld.d * 0.35);
    const sy = this.w.groundY(edgeX, edgeZ, roofY + 0.5);
    if (sy < FLOOR_H * 1.5) return false;
    this.spawnBot(edgeX, sy, edgeZ, 'snipers', 'sniper', 'rifle_hunting', true, rollEliteMods('rifle_hunting'));
    return true;
  }

  private spawnBot(
    rx: number,
    sy: number,
    rz: number,
    faction: FactionId,
    spawnKind: SpawnKind,
    weapon: ItemId,
    isGun: boolean,
    mods: ModId[] = [],
  ): void {
      const magCap = isGun ? GUNS[weapon as BanditGunId].capacity : 1;
      const look = randomLook();
      const outfits = FACTION_OUTFITS[faction];
      const worn = outfits[Math.floor(Math.random() * outfits.length)];
      const tints = FACTION_TINTS[faction];
      const tint = tints[Math.floor(Math.random() * tints.length)];

      const root = new Group();
      root.position.set(rx, sy, rz);
      this.w.scene.add(root);

      const maxHp = faction === 'snipers' ? 260 : faction === 'pmc' ? 250 : 180;
      const builtLoot = buildBanditLootAndCorpse(faction, look, worn, tint, weapon, isGun, mods);
      const wornDirt: Partial<Record<WearSlot, number>> = {};
      for (const slot of WEAR_SLOTS) {
        const st = builtLoot.corpse.slots[slot as CorpseSlotKey];
        if (st?.dirt !== undefined) wornDirt[slot] = st.dirt;
      }
      const bot: Bandit = {
        id: this.nextId++,
        faction,
        spawnKind,
        pos: new Vector3(rx, sy, rz),
        vel: new Vector3(),
        yaw: Math.random() * Math.PI * 2,
        hp: maxHp,
        maxHp,
        isDead: false,
        state: 'patrol',
        look,
        worn,
        wornDirt,
        tint,
        weapon,
        isGun,
        mods,
        ammoInMag: magCap,
        magCap,
        fireCd: 0.4,
        burstLeft: isGun ? 2 + Math.floor(Math.random() * 3) : 1,
        burstPause: 0,
        reloadT: 0,
        reactT: 0.35,
        meleeCd: 0,
        aiming: 0,
        aimBlend: 0,
        aimPitch: 0,
        recoilKick: 0,
        swingT: 0,
        patrolYaw: Math.random() * Math.PI * 2,
        patrolT: 2 + Math.random() * 3,
        investigateX: rx,
        investigateZ: rz,
        investigateT: 0,
        stepDist: 0,
        deadT: 0,
        loot: builtLoot.loot,
        corpse: builtLoot.corpse,
        root,
        visual: null,
        ragdoll: null,
        ragdollPose: null,
        lootDropped: false,
        hit: (dmg, fx, fz, head = false, zone?: HitZone) => this.hit(bot, dmg, fx, fz, head, zone),
      };

      this.buildVisual(bot);
      this.list.push(bot);
  }

  private buildVisual(b: Bandit): void {
    const wantBody = bodyFor(b.look, b.worn.outfit);
    const body = bodyNow(wantBody);
    if (body !== wantBody) {
      void loadBody(wantBody).then(() => {
        if (!this.disposed && b.state !== 'dead' && !b.visual && this.list.includes(b)) {
          this.buildVisual(b);
        }
      });
      return;
    }

    coverBody(body);
    const scale = figureScale(b.look, body);
    const hide = { value: 0 };
    const rig = new CharacterRig(body, 1, { cover: true, hide });
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
      if (b.mods.length > 0) gunModel.setMods(b.mods);
      hand.add(gunModel.root);
      if (hf) {
        const d = gunRigData(gid).main;
        _m.compose(hf.grip, hf.q, _one).multiply(_m2.compose(d.at, d.q, _one).invert());
        _m.decompose(gunModel.root.position, gunModel.root.quaternion, gunModel.root.scale);
        gunModel.root.userData.rest = {
          p: gunModel.root.position.clone(),
          q: gunModel.root.quaternion.clone(),
          grip: hf.grip.clone(),
        };
      }
      heldObj = gunModel.root;
    } else if (b.weapon in HELD) {
      const hid = b.weapon as HeldId;
      heldObj = buildHeldModel(hid, geos);
      hand.add(heldObj);
      if (hf) {
        heldObj.quaternion.copy(hf.q);
        heldObj.position.copy(hf.grip).sub(new Vector3(0, HELD[hid].main.along, 0).applyQuaternion(hf.q));
        heldObj.userData.rest = {
          p: heldObj.position.clone(),
          q: heldObj.quaternion.clone(),
          grip: hf.grip.clone(),
        };
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
      const geo = gearGeometry(v.body, g, 1);
      if (!geo) {
        missing = true;
        continue;
      }
      const mat = characterMaterial(bodyAsset(v.body), v.rig.rig, {
        map: gearTexture(g, true),
        doubleSide: gearKind(g) === 'mask',
      });
      const m = new SkinnedMesh(geo, mat);
      m.bind(v.rig.mesh.skeleton, v.rig.mesh.bindMatrix);
      m.frustumCulled = false;
      m.castShadow = false;
      v.rig.mesh.add(m);
      v.gear.set(g, m);
      const lg = gearGeometry(v.body, g, 1, 'lens');
      if (lg && !v.gear.has(`${g}:lens`)) {
        const l = new SkinnedMesh(lg, characterMaterial(bodyAsset(v.body), v.rig.rig, { lens: LENS_TINT[g] ?? 0x1e1f1d }));
        l.bind(v.rig.mesh.skeleton, v.rig.mesh.bindMatrix);
        l.frustumCulled = false;
        l.renderOrder = 2;
        v.rig.mesh.add(l);
        v.gear.set(`${g}:lens`, l);
      }
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

    // Smoothly blend aiming stance (0 = relaxed/patrol, 1 = aiming/fighting).
    const wantAim = b.aiming > 0.05 ? 1 : 0;
    b.aimBlend += (wantAim - b.aimBlend) * (1 - Math.exp(-dt * 8));

    // Pose right & left hand grip.
    const hr = handFrame(v.rig.rig, 'R');
    if (hr) {
      const gripName = b.isGun ? gripHands(b.weapon as GunId, true, false).R : gripHands(b.weapon as HeldId, false, false).R;
      for (const [idx, q] of hr.poses[gripName]) v.rig.bones[idx].quaternion.copy(q);
    }

    // Reset held item to hand rest pose before applying aiming rotation.
    const rest = v.heldObj?.userData.rest as { p: Vector3; q: Quaternion; grip: Vector3 } | undefined;
    if (v.heldObj && rest) {
      v.heldObj.position.copy(rest.p);
      v.heldObj.quaternion.copy(rest.q);
    }

    if (b.aimBlend > 0.02) {
      v.rig.root.updateMatrixWorld(true);
      const rootQ = v.rig.root.getWorldQuaternion(_q3);
      const pitch = b.aimPitch + b.recoilKick * 0.22;

      if (b.isGun) {
        const isLong = GUNS[b.weapon as GunId].cls === 'long';
        if (isLong) {
          // Two-handed rifle/shotgun stance: right arm holds grip near shoulder, left arm supports handguard.
          this.pointBone(v.rig, 'RightArm', 'RightForeArm', -0.28, -0.18 + pitch * 0.6, 0.94, rootQ, b.aimBlend);
          this.pointBone(v.rig, 'RightForeArm', 'RightHand', 0.34, 0.24 + pitch, 0.91, rootQ, b.aimBlend);
          this.pointBone(v.rig, 'LeftArm', 'LeftForeArm', 0.24, -0.16 + pitch * 0.6, 0.95, rootQ, b.aimBlend);
          this.pointBone(v.rig, 'LeftForeArm', 'LeftHand', -0.22, 0.22 + pitch, 0.95, rootQ, b.aimBlend);
        } else {
          // Pistol stance: right arm extended forward at chest/eye level.
          this.pointBone(v.rig, 'RightArm', 'RightForeArm', -0.06, -0.05 + pitch * 0.7, 0.99, rootQ, b.aimBlend);
          this.pointBone(v.rig, 'RightForeArm', 'RightHand', 0.08, 0.12 + pitch, 0.99, rootQ, b.aimBlend);
        }

        // Aim the gun barrel straight toward the target.
        if (v.gunModel) {
          v.rig.root.updateMatrixWorld(true);
          const item = v.gunModel.root;
          const nowDir = _v1.copy(_barrel).applyQuaternion(item.getWorldQuaternion(_q)).normalize();
          const wantDir = _v2.set(0, Math.sin(pitch) + 0.03, Math.cos(pitch)).applyQuaternion(rootQ).normalize();
          const worldTurn = _q2.setFromUnitVectors(nowDir, wantDir);
          const parentW = item.parent!.getWorldQuaternion(_q4);
          const localTurn = _q.copy(parentW).invert().multiply(worldTurn).multiply(parentW);
          _q4.identity().slerp(localTurn, b.aimBlend);
          item.quaternion.premultiply(_q4);
          if (rest) item.position.sub(rest.grip).applyQuaternion(_q4).add(rest.grip);
        }
      } else {
        // Melee combat stance + swing animation.
        const swingPhase = b.swingT > 0 ? Math.sin(b.swingT * Math.PI) : 0;
        const swingPitch = -0.35 + swingPhase * 1.15;
        this.pointBone(v.rig, 'RightArm', 'RightForeArm', -0.15, 0.1 + swingPitch * 0.5, 0.96, rootQ, b.aimBlend);
        this.pointBone(v.rig, 'RightForeArm', 'RightHand', 0.12, 0.35 + swingPitch, 0.92, rootQ, b.aimBlend);
      }
    }
  }

  private pointBone(
    r: CharacterRig,
    boneName: string,
    childName: string,
    lx: number,
    ly: number,
    lz: number,
    rootQ: Quaternion,
    blend: number,
  ): void {
    const bone = r.bone(boneName);
    const child = r.bone(childName);
    const pA = bone.getWorldPosition(_v1);
    const pB = child.getWorldPosition(_v2);
    const curDir = pB.sub(pA).normalize();
    if (curDir.lengthSq() < 1e-6) return;
    const wantDir = _to.set(lx, ly, lz).normalize().applyQuaternion(rootQ);
    const turn = _q2.setFromUnitVectors(curDir, wantDir);
    _q4.identity().slerp(turn, blend);
    const w = bone.getWorldQuaternion(_q);
    const pw = bone.parent!.getWorldQuaternion(_q5);
    bone.quaternion.copy(pw.invert().multiply(_q4).multiply(w));
    r.root.updateMatrixWorld(true);
  }

  private becomeRagdoll(b: Bandit, fromX: number, fromZ: number): void {
    const v = b.visual;
    if (!v) {
      b.root.rotation.set(-Math.PI / 2, b.yaw, 0);
      b.root.position.set(b.pos.x, b.pos.y + 0.14, b.pos.z);
      return;
    }

    // Remove the held weapon mesh on death so there isn't an unpickable decoy next to the corpse;
    // the exact weapon is inside the bandit's lootable corpse inventory (`bot.loot`).
    if (v.heldObj) {
      v.heldObj.removeFromParent();
      v.heldObj = null;
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

    const st = stand(v.body, 1);
    const boxes: StaticBox[] = [];
    this.w.boxesNear(b.pos.x, b.pos.z, 1.8, boxes);
    const killer = new Vector3(fromX, b.pos.y, fromZ);
    const rd = playerRagdoll(b.pos, b.yaw + Math.PI, v.scale, b.vel, killer, boxes, Math.random, st.shape);
    const pose = new RagdollPose(v.body, 1, rig.rig, world, rd, v.scale);
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
      if (b.visual.heldObj) b.visual.heldObj.removeFromParent();
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
    b.pos.y = this.w.groundY(b.pos.x, b.pos.z, b.pos.y);
  }

  hasLineOfSight(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    _v1.set(tx - ox, ty - oy, tz - oz);
    const len = _v1.length();
    if (len < 0.1) return true;
    _v1.divideScalar(len);
    const hit = this.w.rayHit(ox, oy, oz, _v1.x, _v1.y, _v1.z, len);
    return hit < 0 || hit >= len - 0.05;
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

  private shootAt(b: Bandit, tx: number, ty: number, tz: number, targetIsPlayer: boolean, inCar = false): void {
    const gId = b.weapon as BanditGunId;
    const g = GUNS[gId];
    // Originate from the bot center (inside its collider) so thin 0.12 m walls can never be bypassed by a forward muzzle offset.
    const ox = b.pos.x;
    const oy = b.pos.y + 1.42;
    const oz = b.pos.z;
    if (!this.hasLineOfSight(ox, oy, oz, tx, ty, tz)) return;

    _to.set(tx - ox, ty - oy, tz - oz);
    const targetDist = _to.length() || 1;
    _to.divideScalar(targetDist);

    const spread =
      b.faction === 'snipers'
        ? 0.032
        : b.faction === 'pmc'
          ? gId === 'shotgun_pump'
            ? 0.095
            : 0.055
          : gId === 'shotgun_pump'
            ? 0.115
            : 0.075;
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
      if (proj > 0 && proj < maxTrace - 0.04) {
        const d2 = ex * ex + ey * ey + ez * ez - proj * proj;
        if (d2 < 0.36 * 0.36) {
          hitDist = proj;
          const hitY = oy + _to.y * proj;
          const playerFeetY = ty - (inCar ? 1.05 : 1.38);
          const relY = hitY - playerFeetY;
          const hitZone: HitZone = relY >= 1.44 ? 'head' : relY >= 0.78 ? 'torso' : 'limbs';
          const rawDmg = (g.damage[0] + g.damage[1]) * 0.24;
          this.w.hurtPlayer(Math.max(6, Math.min(24, rawDmg)), b.pos.x, b.pos.z, 'Пулевое ранение от бандита', hitZone);
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

    const muzzleOff = Math.min(0.32, hitDist * 0.4);
    this.spawnTracer(ox + _to.x * muzzleOff, oy + _to.y * muzzleOff, oz + _to.z * muzzleOff, _to.x, _to.y, _to.z, Math.max(0.2, Math.min(hitDist - muzzleOff, 32)));
    b.recoilKick = 1;
    sfx.gunShot(GUN_SOUND[gId], b.pos, b.mods.includes('mod_suppressor'), this.w.placeAt(b.pos.x, b.pos.z));

    b.ammoInMag--;
    b.burstLeft--;
    if (b.ammoInMag <= 0) {
      b.reloadT = 2.2;
    } else if (b.burstLeft <= 0) {
      b.burstLeft = 2 + Math.floor(Math.random() * 3);
      b.burstPause = 0.65 + Math.random() * 0.45;
    } else {
      b.fireCd = Math.max(0.18, 60 / Math.min(280, g.rpm));
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
