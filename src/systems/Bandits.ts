/**
 * Living tactical survivor AI (EFT-inspired):
 * - Mixamo skeletons with crouch blending and analytical 2-bone IK two-handed weapon stances
 * - Faction war matrix: Scavs vs BEAR vs USEC vs Black Raiders vs Bosses & Guards (+ vs Zombies/Player)
 * - Tactical combat: cover search, crouch-peek bursts, flanking, reloading/healing behind cover, door opening
 * - Indoor ambushers ("rats") waiting silently in dark rooms/stairwells and 3 unique Bosses with escort squads
 */

import {
  AdditiveBlending,
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
  SphereGeometry,
  Vector3,
} from 'three';
import { sfx, type EchoPlace, type GunSound } from '../audio/Sound';
import { type BodyId, bodyAsset, bodyNow, type ClipId, loadBody } from '../characters/assets';
import { coverBody, gearGeometry, gearKind, gearTexture, hideBits, loadGear, wornGear } from '../characters/gear';
import { handFrame } from '../characters/hands';
import { slerpBoneWorld, solveTwoBoneIK } from '../characters/ik';
import { characterMaterial, LENS_TINT } from '../characters/material';
import { CharacterRig, RagdollPose, stand } from '../characters/rig';
import { tr } from '../core/i18n';
import { ensureStackUid, type ItemId, type ItemStack, WEAR_SLOTS, type WearSlot } from '../data/items';
import type { Ragdoll } from '../physics/ragdoll';
import { BASE_LOOK, type Appearance, type Sex } from '../player/appearance';
import { bodyFor, figureScale } from '../player/CharacterFigure';
import { playerRagdoll } from '../player/deathBody';
import { gripHands } from '../player/grips';
import { gunRigData } from '../player/gunPose';
import { buildHeldModel, HELD, type HeldId } from '../player/held';
import { GunModel } from '../weapons/gunModel';
import { GUNS, type GunId, MOD_FITS, type ModId } from '../weapons/guns';
import type { DoorNavSpot } from '../world/Doors';
import { type BuildingDesc, FLOOR_H } from '../world/gen/highrise';
import { applyZonalArmor, type HitZone } from './Armor';
import { type BlockedSpot, findBotPath, hasWalkableLine, type NavBox, type NavWaypoint } from './botNav';
import type { CorpseData, CorpseSlotKey } from './Containers';
import type { BlastSpec } from './Firearms';
import type { Worn } from './Inventory';
import type { BanditTarget, Zombie, ZombieSim } from './zombies';
import type { RayHitDetail } from '../world/CollisionWorld';

export type FactionId = 'scavs' | 'bear' | 'usec' | 'black' | 'boss' | 'pmc' | 'snipers';
export type SpawnKind = 'street' | 'indoor' | 'sniper' | 'boss';
export type BotRole = 'regular' | 'ambusher' | 'boss' | 'guard' | 'goon_assault' | 'goon_support' | 'goon_marksman';
export type BotMoveMode = 'idle' | 'walk' | 'aim_walk' | 'sprint';
export type BotTacticState = 'NONE' | 'SEEK_COVER' | 'IN_COVER' | 'PEEK_AND_SHOOT' | 'RETREAT_OR_FLANK' | 'PUSH_RELOAD';

/**
 * Faction hostility matrix (EFT rules, no cultists):
 * - Same faction never friendly-fires (Black Raiders stay cohesive with their own squad, Boss + Guards share 'boss').
 * - Any two distinct factions are mutually hostile and actively fight each other across the map.
 */
export function areFactionsHostile(a: FactionId, b: FactionId): boolean {
  return a !== b;
}

const FOV_HALF_RAD = (58 * Math.PI) / 180; // 116 deg horizontal field of view
const FIRE_CONE_RAD = (11 * Math.PI) / 180; // must aim within +/-11 deg of target before firing
/** Unified movement bounds matched to PlayerController (walk 2.2, sprint 4.25, ADS ~43% of walk). */
export const BOT_WALK_SPEED = 2.2;
export const BOT_ADS_SPEED = 0.95;
export const BOT_CROUCH_SPEED = 0.9;
export const BOT_SPRINT_SPEED = 4.25;
export const BOT_ADS_RAISE_MIN = 0.25;
export const BOT_ADS_RAISE_MAX = 0.35;
const RELOAD_PUSH_HEAR_RADIUS = 25;

export function angleDiff(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Proportional humanlike turn with ease-out deceleration, strictly capped to [-maxRateRad * dt, +maxRateRad * dt]. */
function turnTowardYaw(cur: number, target: number, maxRateRad: number, dt: number): number {
  if (dt <= 0) return cur;
  const diff = angleDiff(cur, target);
  const maxStep = maxRateRad * dt;
  const desired = diff * Math.min(1, dt * 6.5);
  let step = Math.abs(diff) <= maxStep ? desired : Math.sign(diff) * maxStep;
  if (Math.abs(step) > Math.abs(diff)) step = diff;
  return cur + step;
}

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
  rayHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, ignoreGlass?: boolean): number;
  rayHitDetail?(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, ignoreGlass?: boolean): RayHitDetail | null;
  boxesNear(x: number, z: number, r: number, out: NavBox[]): void;
  buildingsNear(x: number, z: number, r: number): BuildingDesc[];
  doorsNear?(x: number, y: number, z: number, r: number): DoorNavSpot[];
  onBreakGlass?(at: Vector3, dir: Vector3): void;
  onWindowBullet?(owner: number, at: Vector3, dir: Vector3, nx: number, ny: number, nz: number): boolean;
  shatterWindowNear?(x: number, y: number, z: number, r: number, dirX: number, dirZ: number): void;
  addRagdoll(rd: Ragdoll): void;
  removeRagdoll(rd: Ragdoll): void;
  zombies: ZombieSim;
  noise(x: number, y: number, z: number, r: number): void;
  hurtPlayer(hp: number, fromX: number, fromZ: number, cause: string, zone?: HitZone): void;
  placeAt(x: number, z: number): EchoPlace;
  openDoorNear?(x: number, y: number, z: number, radius?: number): boolean;
  isInteriorLoaded?(buildingId: number): boolean;
  onDropLoot?(bot: Bandit): void;
  onRemoveCorpse?(bot: Bandit): void;
  bushOccludes?(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean;
  explode?(at: Vector3, spec?: BlastSpec): void;
  toast?(text: string, ms?: number): void;
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
  scavs: [
    { outfit: null, head: null, face: null, mask: null, torso: 'hoodie', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: 'backpackSchool', bag: null },
    { outfit: null, head: null, face: null, mask: 'shemagh', torso: 'workJacket', vest: null, hands: 'workGloves', legs: 'cargoPants', feet: 'sneakers', back: null, bag: null },
    { outfit: 'outfitMechanic', head: null, face: null, mask: null, torso: null, vest: null, hands: null, legs: null, feet: 'boots', back: 'backpackSchool', bag: null },
    { outfit: null, head: null, face: null, mask: 'maskHalf', torso: 'leatherJacket', vest: null, hands: null, legs: 'jeans', feet: 'boots', back: null, bag: null },
  ],
  bear: [
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: null, mask: 'balaclava', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: 'gogglesTactical', mask: 'shemagh', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackHiking', bag: null },
  ],
  usec: [
    { outfit: 'outfitSwat', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    { outfit: 'outfitSwat', head: 'helmetSwat', face: null, mask: 'shemagh', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackHiking', bag: null },
  ],
  black: [
    { outfit: 'outfitSwat', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
  ],
  boss: [
    { outfit: 'outfitMilitary', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
  ],
  pmc: [
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: null, mask: 'balaclava', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    { outfit: 'outfitSwat', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
  ],
  snipers: [
    { outfit: 'outfitMilitary', head: 'helmetMilitary', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
  ],
};

const FACTION_TINTS: Record<FactionId, readonly number[]> = {
  scavs: [0x6e4f3a, 0x3f4e5e, 0x585346, 0x4b3b36, 0x3b4a3c, 0x62503c],
  bear: [0x3c4a32, 0x454e38, 0x323b2c],
  usec: [0x3a424c, 0x464e56, 0x2c343d],
  black: [0x14161a],
  boss: [0x582422, 0x1e2228],
  pmc: [0x3b4432, 0x2c302e, 0x454a3a, 0x25282c],
  snipers: [0x3c4836, 0x2f362c],
};

interface BossPreset {
  id: string;
  name: string;
  hp: number;
  weapon: BanditGunId;
  mods: ModId[];
  worn: Worn;
  tint: number;
}

const BOSS_PRESETS: readonly BossPreset[] = [
  {
    id: 'komendant',
    name: 'Комендант Мороз',
    hp: 520,
    weapon: 'rifle_ak',
    mods: ['mod_suppressor', 'mod_ext_mag_ak', 'mod_flashlight'],
    worn: { outfit: 'outfitMilitary', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    tint: 0x582422,
  },
  {
    id: 'shturmovik',
    name: 'Штурмовик Гром',
    hp: 460,
    weapon: 'shotgun_pump',
    mods: ['mod_flashlight'],
    worn: { outfit: 'outfitSwat', head: 'helmetSwat', face: 'gogglesTactical', mask: 'balaclava', torso: null, vest: 'vestSwat', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackMilitary', bag: null },
    tint: 0x1c222a,
  },
  {
    id: 'eger',
    name: 'Егерь Ворон',
    hp: 430,
    weapon: 'rifle_hunting',
    mods: ['mod_suppressor', 'mod_flashlight'],
    worn: { outfit: 'outfitMilitary', head: 'helmetMilitary', face: null, mask: 'shemagh', torso: null, vest: 'vestMilitary', hands: 'tacticalGloves', legs: null, feet: 'combatBoots', back: 'backpackHiking', bag: null },
    tint: 0x2a3b26,
  },
];

const MAX_ACTIVE = 10;
const SPAWN_MIN = 32;
const SPAWN_MAX = 66;
const DESPAWN_DIST = 96;
const CORPSE_LIFE = 95;

const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _to = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _upVec = new Vector3();
const _pShR = new Vector3();
const _gripR = new Vector3();
const _gripL = new Vector3();
const _wristR = new Vector3();
const _wristL = new Vector3();
const _poleR = new Vector3();
const _poleL = new Vector3();
const _gunPos = new Vector3();
const _m = new Matrix4();
const _m2 = new Matrix4();
const _one = new Vector3(1, 1, 1);
const _up = new Vector3(0, 1, 0);
const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();
const _q4 = new Quaternion();
const _qGunW = new Quaternion();
const _qWristR = new Quaternion();
const _qWristL = new Quaternion();
const _qFlipY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

interface Tracer {
  mesh: Mesh;
  life: number;
}

interface ThrownGrenade {
  pos: Vector3;
  vel: Vector3;
  fuse: number;
  mesh: Mesh;
}

interface SquadBlackboard {
  lastX: number;
  lastY: number;
  lastZ: number;
  lastT: number;
  tokens: number[];
  grenadeCd: number;
}

const HELI_PARTS: readonly ItemId[] = ['heliAvionics', 'heliFuelPump', 'heliBattery'];

interface BanditRigVisual {
  body: BodyId;
  scale: number;
  rig: CharacterRig;
  gaits: { idle: AnimationAction; walk: AnimationAction; run: AnimationAction; crouch: AnimationAction };
  weights: { idle: number; walk: number; run: number; crouch: number };
  gear: Map<string, SkinnedMesh>;
  hide: { value: number };
  heldObj: Group | null;
  gunModel: GunModel | null;
  geos: BufferGeometry[];
}

export interface SpawnBotOptions {
  role?: BotRole;
  squadId?: number;
  bossId?: number | null;
  bossPreset?: BossPreset;
}

export interface Bandit extends BanditTarget {
  id: number;
  faction: FactionId;
  spawnKind: SpawnKind;
  role: BotRole;
  squadId: number;
  bossId: number | null;
  bossPresetId?: string;
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
  crouching: boolean;
  crouchBlend: number;
  healT: number;
  medkits: number;
  doorCd: number;
  coverX: number;
  coverZ: number;
  coverT: number;
  coverKey: string | null;
  coverHeight: number;
  peekX: number;
  peekZ: number;
  peeksDone: number;
  moveMode: BotMoveMode;
  adsRaiseT: number;
  actualSpeed: number;
  tacticState: BotTacticState;
  tacticTimer: number;
  reloadPushGoalX: number;
  reloadPushGoalZ: number;
  reloadPushT: number;
  sprintBobPhase: number;
  grenadeCd: number;
  hasFireToken: boolean;
  flankSign: -1 | 1;
  flankT: number;
  lastHitT: number;
  ambushTriggered: boolean;
  navPath: NavWaypoint[];
  navIdx: number;
  navTimer: number;
  navGoalX: number;
  navGoalY: number;
  navGoalZ: number;
  stuckTimer: number;
  stuckAnchorX: number;
  stuckAnchorZ: number;
  blockedSpots: BlockedSpot[];
  glassFlank: boolean;
  maxTurnRate: number;
  lockedKind: 'none' | 'player' | 'bot' | 'zombie';
  lockedBotId: number | null;
  lockedZombie: Zombie | null;
  targetLockT: number;
  lastAttackerKind: 'none' | 'player' | 'bot';
  lastAttackerId: number | null;
  noiseReactT: number;
  aimPos: Vector3;
  aimPosInit: boolean;
  aimWarmupT: number;
  aimShots: number;
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
  glintMesh: Mesh | null;
  ragdoll: Ragdoll | null;
  ragdollPose: RagdollPose | null;
  ragdollDone: boolean;
  lootDropped: boolean;
  hit(dmg: number, fromX: number, fromZ: number, head?: boolean, zone?: HitZone): boolean;
}

function factionTitle(faction: FactionId, role: BotRole, preset?: BossPreset): string {
  if (preset) return preset.name;
  if (role === 'guard') return 'Охранник босса';
  if (role === 'goon_assault') return 'Goon · Штурмовик';
  if (role === 'goon_support') return 'Goon · Пулемётчик';
  if (role === 'goon_marksman') return 'Goon · Снайпер';
  switch (faction) {
    case 'bear': return 'Оперативник BEAR';
    case 'usec': return 'Боец USEC';
    case 'black': return 'Чёрный рейдер';
    case 'boss': return 'Свита босса';
    case 'snipers': return 'Снайпер';
    case 'pmc': return 'ЧВК-боец';
    default: return 'Дикий';
  }
}

function randomLook(customName?: string): Appearance {
  const sex: Sex = customName ? 'male' : Math.random() < 0.8 ? 'male' : 'female';
  const base = BASE_LOOK[sex];
  return {
    ...base,
    name: customName ?? (sex === 'male' ? 'Боец' : 'Мародёрка'),
    height: base.height + Math.round((Math.random() - 0.5) * 8),
  };
}

function rollMods(weapon: GunId, faction: FactionId, role: BotRole): ModId[] {
  const mods: ModId[] = [];
  const elite = faction === 'black' || faction === 'boss' || role === 'guard';
  const supChance = faction === 'black' ? 0.92 : elite ? 0.72 : faction === 'bear' || faction === 'usec' || faction === 'pmc' ? 0.45 : 0;
  const magChance = faction === 'black' || role === 'boss' ? 0.85 : faction !== 'scavs' ? 0.5 : 0;
  if (MOD_FITS.mod_suppressor.includes(weapon) && Math.random() < supChance) mods.push('mod_suppressor');
  if (MOD_FITS.mod_ext_mag_ak.includes(weapon) && Math.random() < magChance) mods.push('mod_ext_mag_ak');
  else if (MOD_FITS.mod_ext_mag_m4.includes(weapon) && Math.random() < magChance) mods.push('mod_ext_mag_m4');
  else if (MOD_FITS.mod_ext_mag_g17.includes(weapon) && Math.random() < magChance) mods.push('mod_ext_mag_g17');
  if (MOD_FITS.mod_flashlight.includes(weapon) && Math.random() < (elite ? 0.75 : 0.4)) mods.push('mod_flashlight');
  return mods;
}

function buildBanditLootAndCorpse(
  faction: FactionId,
  role: BotRole,
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
    dirt: faction === 'black' || role === 'boss' ? 0.05 : 0.1 + Math.random() * 0.22,
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
      dirt: faction === 'black' ? 0.05 : 0.08 + Math.random() * 0.22,
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
    const g = GUNS[weapon as BanditGunId];
    const extraMul = role === 'boss' ? 2 : faction === 'black' ? 1.5 : 1;
    const totalAmmo = Math.round((40 + Math.floor(Math.random() * 26)) * extraMul);
    const rigTarget = worn.vest ? rig : pockets;
    pushStack(rigTarget, g.caliber, totalAmmo);
    if (g.mag) {
      const magCount = role === 'boss' ? 3 : faction === 'black' ? 2 : 1 + (Math.random() < 0.55 ? 1 : 0);
      for (let i = 0; i < magCount; i++) pushStack(rigTarget, g.mag, 1);
    }
    pushStack(rigTarget, 'bandage', role === 'boss' ? 3 : 2);
    pushStack(pockets, 'painkillers', role === 'boss' ? 2 : 1 + (Math.random() < 0.45 ? 1 : 0));
    if (role === 'boss' || faction === 'black' || Math.random() < 0.45) pushStack(pockets, 'antibiotics', 1);
    if (worn.back) {
      pushStack(backpack, 'ration', role === 'boss' ? 2 : 1);
      pushStack(backpack, 'water', role === 'boss' ? 2 : 1);
      if (role === 'boss') {
        pushStack(backpack, 'batteries', 2);
        pushStack(backpack, 'mod_suppressor', 1);
        pushStack(backpack, HELI_PARTS[Math.floor(Math.random() * HELI_PARTS.length)], 1);
      } else if (role === 'goon_assault') {
        pushStack(backpack, 'heliBattery', 1);
      } else if (role === 'goon_support') {
        pushStack(backpack, 'heliFuelPump', 1);
      } else if (role === 'goon_marksman') {
        pushStack(backpack, 'heliAvionics', 1);
      } else if (faction === 'black' && Math.random() < 0.18) {
        pushStack(backpack, HELI_PARTS[Math.floor(Math.random() * HELI_PARTS.length)], 1);
      }
    }
  }

  const tierLabel =
    role === 'boss'
      ? `Босс · ${look.name}`
      : role === 'guard'
        ? 'Охранник босса'
        : role === 'goon_assault'
          ? 'Goon · Штурмовик'
          : role === 'goon_support'
            ? 'Goon · Пулемётчик'
            : role === 'goon_marksman'
              ? 'Goon · Снайпер'
              : faction === 'black'
                ? 'Чёрный рейдер'
                : faction === 'bear'
                  ? 'ЧВК BEAR'
                  : faction === 'usec'
                    ? 'ЧВК USEC'
                    : faction === 'snipers'
                      ? 'Снайпер'
                      : tier === 'elite'
                        ? 'Элитный боец'
                        : 'Дикий';

  const corpse: CorpseData = {
    name: look.name,
    tierLabel,
    tier,
    slots,
    pockets,
    rig,
    backpack,
    searchedPockets: false,
    searchedRig: !worn.vest,
    searchedBackpack: !worn.back,
  };

  const loot: BanditLootItem[] = [];
  for (const s of Object.values(slots)) if (s) loot.push({ id: s.id, count: s.count, condition: s.dirt });
  for (const s of [...pockets, ...rig, ...backpack]) loot.push({ id: s.id, count: s.count });
  return { loot, corpse };
}

export class Bandits {
  readonly list: Bandit[] = [];
  private nextId = 1;
  private nextSquadId = 1;
  private spawnCd = 4;
  private reloadPushCd = 0;
  private maxActive = MAX_ACTIVE;
  private disposed = false;
  private readonly tracers: Tracer[] = [];
  private readonly grenades: ThrownGrenade[] = [];
  private readonly squads = new Map<number, SquadBlackboard>();
  private readonly coverClaims = new Map<string, number>();
  private readonly coverBoxCache: NavBox[] = [];
  private readonly tracerGeo = new BoxGeometry(0.025, 0.025, 1);
  private readonly tracerMat = new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.78 });
  private readonly grenadeGeo = new SphereGeometry(0.07, 8, 6);
  private readonly grenadeMat = new MeshBasicMaterial({ color: 0x70ff50 });
  private readonly glintGeo = new BoxGeometry(0.09, 0.09, 0.02);
  private readonly glintMat = new MeshBasicMaterial({ color: 0xfff4c2, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });

  constructor(private readonly w: BanditWorld) {
    void loadBody('male');
    void loadBody('female');
  }

  setMaxActive(n: number): void {
    this.maxActive = Math.max(1, n);
  }

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
    playerCrouched = false,
  ): void {
    this.updateTracers(dt);
    this.updateGrenades(dt);
    this.updateSquadBlackboards(dt);
    this.applySeparation(dt);
    this.reloadPushCd = Math.max(0, this.reloadPushCd - dt);

    this.spawnCd -= dt;
    let aliveStreet = 0;
    let aliveIndoor = 0;
    let aliveSniper = 0;
    let aliveBoss = 0;
    let totalAlive = 0;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      totalAlive++;
      if (b.spawnKind === 'street') aliveStreet++;
      else if (b.spawnKind === 'indoor') aliveIndoor++;
      else if (b.spawnKind === 'boss') aliveBoss++;
      else aliveSniper++;
    }

    if (this.spawnCd <= 0 && totalAlive < this.maxActive) {
      const room = this.maxActive - totalAlive;
      const indoorCap = this.maxActive <= 4 ? 1 : 2;
      if (aliveBoss === 0 && room >= 3 && Math.random() < (playerArmed ? 0.35 : 0.14) && this.trySpawnBossGroup(px, pz, room)) {
        // Boss + guards spawned
      } else if (aliveIndoor < indoorCap && this.trySpawnIndoor(px, pz, playerArmed)) {
        // Indoor rat / patrol
      } else if (aliveSniper < 1 && this.maxActive >= 6 && Math.random() < (playerArmed ? 0.25 : 0.08) && this.trySpawnSniper(px, pz)) {
        // Rooftop sniper
      } else if (aliveStreet < Math.max(2, this.maxActive - 3)) {
        this.trySpawnSquad(px, pz, playerArmed, room);
      }
      this.spawnCd = playerArmed
        ? (this.maxActive <= 4 ? 8 : 5.5) + Math.random() * 4
        : (this.maxActive <= 4 ? 12 : 9) + Math.random() * 5;
    }

    const fogMul = 1 - 0.68 * fog;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      const dxPlayer = px - b.pos.x;
      const dzPlayer = pz - b.pos.z;
      const distPlayerSq = dxPlayer * dxPlayer + dzPlayer * dzPlayer;

      if (b.isDead && b.state === 'dead') {
        b.deadT += dt;
        if (b.ragdollPose && b.ragdoll && !b.ragdollDone) {
          this.applyRagdollPose(b);
          if (b.ragdoll.asleep) b.ragdollDone = true;
        }
        if (b.isDead && !b.lootDropped && (!b.ragdoll || b.ragdoll.asleep || b.deadT > 2.0)) {
          b.lootDropped = true;
          this.w.onDropLoot?.(b);
        }
        if (b.deadT > CORPSE_LIFE || distPlayerSq > DESPAWN_DIST * DESPAWN_DIST) this.removeAt(i);
        continue;
      }

      if (distPlayerSq > DESPAWN_DIST * DESPAWN_DIST) {
        this.removeAt(i);
        continue;
      }

      const distPlayer = Math.sqrt(distPlayerSq);
      b.fireCd = Math.max(0, b.fireCd - dt);
      b.meleeCd = Math.max(0, b.meleeCd - dt);
      b.burstPause = Math.max(0, b.burstPause - dt);
      b.aiming = Math.max(0, b.aiming - dt * 1.4);
      b.recoilKick *= Math.exp(-dt * 14);
      b.swingT = Math.max(0, b.swingT - dt * 3.6);
      b.doorCd = Math.max(0, b.doorCd - dt);
      b.coverT = Math.max(0, b.coverT - dt);
      if (b.coverT <= 0 && b.coverKey) this.releaseCover(b);
      b.tacticTimer = Math.max(0, b.tacticTimer - dt);
      b.reloadPushT = Math.max(0, b.reloadPushT - dt);
      b.grenadeCd = Math.max(0, b.grenadeCd - dt);
      b.flankT = Math.max(0, b.flankT - dt);
      b.navTimer = Math.max(0, b.navTimer - dt);
      b.targetLockT = Math.max(0, b.targetLockT - dt);
      b.noiseReactT = Math.max(0, b.noiseReactT - dt);
      b.lastHitT += dt;
      for (let k = b.blockedSpots.length - 1; k >= 0; k--) {
        b.blockedSpots[k].ttl -= dt;
        if (b.blockedSpots[k].ttl <= 0) b.blockedSpots.splice(k, 1);
      }

      if (b.reloadT > 0) {
        b.reloadT -= dt;
        if (b.reloadT <= 0) {
          b.ammoInMag = b.magCap;
          b.burstLeft = b.isGun ? 2 + Math.floor(Math.random() * 3) : 1;
        }
      }
      if (b.healT > 0) {
        b.healT -= dt;
        if (b.healT <= 0) {
          b.hp = Math.min(b.maxHp, b.hp + Math.round(b.maxHp * 0.35));
          b.medkits = Math.max(0, b.medkits - 1);
        }
      }

      // Boss relationship for guards
      const boss = b.role === 'guard' && b.bossId !== null ? this.list.find((o) => o.id === b.bossId) : undefined;
      const bossDeadEnraged = b.role === 'guard' && (!boss || boss.isDead || boss.state === 'dead');
      const bossDamaged = Boolean(boss && !boss.isDead && (boss.hp < boss.maxHp * 0.78 || boss.lastHitT < 4));

      // Threat sensing restricted to realistic 116 deg frontal FOV (plus close touch < 2m / active combat lock)
      const sightRange =
        (b.role === 'goon_marksman' ? 92 : b.spawnKind === 'sniper' ? 56 : b.role === 'ambusher' && !b.ambushTriggered ? 16 : 38) * fogMul;
      const nearZombie = this.findNearestZombie(b, 13 * (1 - 0.45 * fog));
      const nearHostileBot = this.findNearestHostileBot(b, sightRange * 0.92);
      const playerVisibleAngle =
        this.inFieldOfView(b, px, pz) ||
        distPlayer < 2.0 ||
        (b.lockedKind === 'player' && b.targetLockT > 0);
      const unalerted = b.state !== 'combat' && b.investigateT <= 0;
      const pEyeHigh = inCar ? 1.15 : playerCrouched ? 1.05 : 1.56;
      const pEyeMid = inCar ? 0.85 : playerCrouched ? 0.72 : 1.15;
      const pAimOff = inCar ? 1.05 : playerCrouched ? 0.92 : 1.38;
      const bushBlocked = unalerted && distPlayer > 6 && !!this.w.bushOccludes?.(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + pEyeHigh - 0.14, pz);
      const canSeePlayer =
        !playerDead &&
        !bushBlocked &&
        distPlayer < sightRange &&
        playerVisibleAngle &&
        (this.hasLineOfSight(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + pEyeHigh, pz) ||
          this.hasLineOfSight(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py + pEyeMid, pz));
      if (canSeePlayer) {
        const bb = this.getSquad(b.squadId);
        bb.lastX = px;
        bb.lastY = py;
        bb.lastZ = pz;
        bb.lastT = 12;
      }

      // Target stickiness (1.5-2.5s lock) so bots never oscillate between zombie/bot/player every frame
      let lockKind: 'none' | 'player' | 'bot' | 'zombie' = 'none';
      let lockBot: Bandit | null = null;
      let lockZombie: Zombie | null = null;
      let lockDist = Infinity;

      if (b.targetLockT > 0 && b.lockedKind !== 'none') {
        if (b.lockedKind === 'player' && canSeePlayer) {
          lockKind = 'player';
          lockDist = distPlayer;
        } else if (b.lockedKind === 'bot' && b.lockedBotId !== null) {
          const found = this.list.find((o) => o.id === b.lockedBotId && !o.isDead && o.state !== 'dead');
          if (
            found &&
            this.hasLineOfSight(b.pos.x, b.pos.y + 1.48, b.pos.z, found.pos.x, found.pos.y + (found.crouching ? 0.95 : 1.38), found.pos.z)
          ) {
            lockKind = 'bot';
            lockBot = found;
            lockDist = Math.hypot(found.pos.x - b.pos.x, found.pos.z - b.pos.z);
          }
        } else if (b.lockedKind === 'zombie' && b.lockedZombie && b.lockedZombie.state !== 'dead') {
          const zd = Math.hypot(b.lockedZombie.pos.x - b.pos.x, b.lockedZombie.pos.z - b.pos.z);
          if (zd < 15 && this.hasLineOfSight(b.pos.x, b.pos.y + 1.45, b.pos.z, b.lockedZombie.pos.x, b.lockedZombie.pos.y + 1.2, b.lockedZombie.pos.z)) {
            lockKind = 'zombie';
            lockZombie = b.lockedZombie;
            lockDist = zd;
          }
        }
      }

      const zDist = nearZombie ? Math.hypot(nearZombie.pos.x - b.pos.x, nearZombie.pos.z - b.pos.z) : Infinity;
      const botTargetDist = nearHostileBot ? Math.hypot(nearHostileBot.pos.x - b.pos.x, nearHostileBot.pos.z - b.pos.z) : Infinity;
      const pDistVis = canSeePlayer ? distPlayer : Infinity;

      let override = false;
      if (lockKind !== 'none') {
        if (b.lastHitT < 0.2 && b.lastAttackerKind === 'player' && lockKind !== 'player' && !playerDead) {
          override = true;
          lockKind = 'player';
          b.investigateX = px;
          b.investigateZ = pz;
          b.investigateT = 10;
        } else if (b.lastHitT < 0.2 && b.lastAttackerKind === 'bot' && b.lastAttackerId !== null && b.lastAttackerId !== b.lockedBotId) {
          const atk = this.list.find((o) => o.id === b.lastAttackerId && !o.isDead);
          if (atk) {
            override = true;
            lockKind = 'bot';
            lockBot = atk;
          }
        }
        if (!override) {
          const closestVis = Math.min(zDist, botTargetDist, pDistVis);
          if (closestVis < 4.0 && closestVis < lockDist - 0.35) {
            if (zDist === closestVis && lockKind !== 'zombie') {
              override = true;
              lockKind = 'zombie';
              lockZombie = nearZombie;
            } else if (botTargetDist === closestVis && nearHostileBot !== lockBot) {
              override = true;
              lockKind = 'bot';
              lockBot = nearHostileBot;
            } else if (pDistVis === closestVis && lockKind !== 'player') {
              override = true;
              lockKind = 'player';
            }
          }
        }
      }

      if (lockKind === 'none' || override || b.targetLockT <= 0) {
        if (!override) {
          if (zDist < 5.5 && zDist < botTargetDist && zDist < pDistVis) {
            lockKind = 'zombie';
            lockZombie = nearZombie;
          } else if (canSeePlayer && pDistVis <= botTargetDist * 0.92 && pDistVis <= zDist) {
            lockKind = 'player';
          } else if (nearHostileBot && botTargetDist <= zDist) {
            lockKind = 'bot';
            lockBot = nearHostileBot;
          } else if (nearZombie) {
            lockKind = 'zombie';
            lockZombie = nearZombie;
          } else if (canSeePlayer) {
            lockKind = 'player';
          } else {
            lockKind = 'none';
          }
        }

        const targetChanged =
          lockKind !== b.lockedKind ||
          (lockKind === 'bot' && (lockBot?.id ?? null) !== b.lockedBotId) ||
          (lockKind === 'zombie' && lockZombie !== b.lockedZombie);

        b.lockedKind = lockKind;
        b.lockedBotId = lockBot ? lockBot.id : null;
        b.lockedZombie = lockZombie;
        if (lockKind !== 'none') b.targetLockT = 1.5 + Math.random() * 1.0;
        if (targetChanged) {
          b.aimShots = 0;
          b.aimWarmupT = 0;
          b.aimPosInit = false;
        }
      }

      const activeZombie = lockKind === 'zombie' ? lockZombie : null;
      const choosePlayer = lockKind === 'player';
      const chooseBot = lockKind === 'bot' && lockBot !== null;
      const isPro =
        b.faction === 'bear' ||
        b.faction === 'usec' ||
        b.faction === 'pmc' ||
        b.faction === 'black' ||
        b.faction === 'boss' ||
        b.faction === 'snipers' ||
        b.role === 'guard' ||
        b.role === 'goon_assault' ||
        b.role === 'goon_support' ||
        b.role === 'goon_marksman';

      if (b.role === 'ambusher' && !b.ambushTriggered) {
        if (choosePlayer || chooseBot || activeZombie || b.lastHitT < 2 || distPlayer < 4.5) {
          b.ambushTriggered = true;
          b.state = 'combat';
          b.reactT = isPro ? 0.35 + Math.random() * 0.05 : 0.45 + Math.random() * 0.2;
        }
      } else if ((choosePlayer || chooseBot) && b.state !== 'combat') {
        b.state = 'combat';
        b.reactT = isPro ? 0.35 + Math.random() * 0.05 : 0.45 + Math.random() * 0.2;
      }

      if (b.glintMesh) {
        const showGlint = (b.role === 'goon_marksman' || b.spawnKind === 'sniper') && b.state === 'combat' && b.aiming > 0.5 && canSeePlayer && distPlayer > 18;
        b.glintMesh.visible = showGlint;
        if (showGlint) {
          const sx = b.pos.x + Math.sin(b.yaw) * 0.42;
          const sz = b.pos.z + Math.cos(b.yaw) * 0.42;
          const sy = b.pos.y + (b.crouching ? 1.06 : 1.46);
          b.glintMesh.position.set(sx, sy, sz);
          b.glintMesh.lookAt(px, py + 1.5, pz);
        }
      }

      const prevX = b.pos.x;
      const prevZ = b.pos.z;
      const prevMoveMode = b.moveMode;
      b.moveMode = 'idle';
      let moveSpeed = 0;

      if (activeZombie) {
        b.crouching = false;
        this.engageZombie(b, activeZombie, dt, (s) => (moveSpeed = s));
      } else if (b.state === 'combat' && (chooseBot || !playerDead)) {
        const targetIsPlayer = choosePlayer || (!chooseBot && !playerDead);
        const searchUnknown = !chooseBot && !choosePlayer && b.investigateT > 0;
        const tx = chooseBot ? lockBot!.pos.x : searchUnknown ? b.investigateX : px;
        const ty = chooseBot ? lockBot!.pos.y + 1.38 : searchUnknown ? this.w.groundY(b.investigateX, b.investigateZ, b.pos.y) + 1.38 : py + pAimOff;
        const tz = chooseBot ? lockBot!.pos.z : searchUnknown ? b.investigateZ : pz;
        const hasTargetLOS = chooseBot ? true : canSeePlayer;

        moveSpeed = this.runTacticalCombat(
          b,
          tx,
          ty,
          tz,
          hasTargetLOS,
          targetIsPlayer && !searchUnknown,
          chooseBot ? lockBot : null,
          inCar && targetIsPlayer,
          playerReloading && targetIsPlayer,
          playerCrouched && targetIsPlayer,
          playerVx,
          playerVz,
          boss,
          bossDamaged,
          bossDeadEnraged,
          dt,
        );

        if (b.reactT <= 0 && !b.isGun && !hasTargetLOS && b.investigateT <= 0) b.state = 'patrol';
        if (!hasTargetLOS && b.investigateT <= 0 && b.lastHitT > 6) b.state = 'patrol';
      } else if (b.role === 'ambusher' && !b.ambushTriggered) {
        // Patient room/stairwell ambusher: silently holds doorway angle crouched.
        this.resetAntiStuck(b);
        b.crouching = true;
        b.aiming = 1;
        b.moveMode = 'idle';
        b.yaw = turnTowardYaw(b.yaw, b.patrolYaw, b.maxTurnRate * 0.65, dt);
        b.aimPitch = 0;
      } else {
        b.crouching = false;
        b.aiming = 0;
        if (b.role === 'guard' && boss && !boss.isDead) {
          const bd = Math.hypot(boss.pos.x - b.pos.x, boss.pos.z - b.pos.z);
          if (bd > 5.8) {
            b.moveMode = 'sprint';
            b.aiming = 0;
            moveSpeed = this.navigateToward(b, boss.pos.x, boss.pos.y, boss.pos.z, 3.0, dt, true);
          } else {
            this.resetAntiStuck(b);
            b.patrolT -= dt;
            if (b.patrolT <= 0) {
              b.patrolYaw += (Math.random() - 0.5) * 1.8;
              b.patrolT = 2 + Math.random() * 2.5;
            }
            b.yaw = turnTowardYaw(b.yaw, b.patrolYaw, b.maxTurnRate * 0.65, dt);
          }
        } else if (b.investigateT > 0) {
          if (b.noiseReactT > 0) {
            this.resetAntiStuck(b);
          } else {
            b.investigateT -= dt;
            const idist = Math.hypot(b.investigateX - b.pos.x, b.investigateZ - b.pos.z);
            if (idist > 2.0) {
              b.moveMode = 'walk';
              const goalY = this.w.groundY(b.investigateX, b.investigateZ, b.pos.y);
              moveSpeed = this.navigateToward(b, b.investigateX, goalY, b.investigateZ, BOT_WALK_SPEED, dt, true);
            } else {
              this.resetAntiStuck(b);
            }
          }
        } else {
          b.patrolT -= dt;
          if (b.patrolT <= 0) {
            b.patrolYaw += (Math.random() - 0.5) * 2.2;
            b.patrolT = 2.5 + Math.random() * 4;
          }
          b.yaw = turnTowardYaw(b.yaw, b.patrolYaw, b.maxTurnRate * 0.65, dt);
          const pdx = Math.sin(b.yaw);
          const pdz = Math.cos(b.yaw);
          const movedPatrol = this.moveOrOpenDoor(b, pdx, pdz, 1.55, dt);
          this.trackAntiStuck(b, pdx, pdz, 1.55, dt);
          if (!movedPatrol && b.patrolT > 0.4) {
            b.patrolYaw += Math.PI * (0.55 + Math.random() * 0.4);
          }
          moveSpeed = movedPatrol ? 1.55 : 0;
          b.moveMode = movedPatrol ? 'walk' : 'idle';
        }
      }

      if (b.investigateT > 0 && !choosePlayer && !chooseBot) b.investigateT -= dt;

      const curMoveMode = b.moveMode as BotMoveMode;
      if (b.isGun && curMoveMode === 'sprint') {
        b.aiming = 0;
        if (prevMoveMode !== 'sprint' || b.adsRaiseT < BOT_ADS_RAISE_MIN) {
          b.adsRaiseT = BOT_ADS_RAISE_MIN + Math.random() * (BOT_ADS_RAISE_MAX - BOT_ADS_RAISE_MIN);
        }
        b.sprintBobPhase += dt * 11;
      } else if (curMoveMode !== 'sprint') {
        b.adsRaiseT = Math.max(0, b.adsRaiseT - dt);
        if (b.state === 'combat' && b.isGun && b.adsRaiseT > 0) {
          b.aiming = Math.min(b.aiming, 0.35);
        }
      }

      if (dt > 1e-4) {
        const moved = Math.hypot(b.pos.x - prevX, b.pos.z - prevZ);
        const instSpd = moved / dt;
        b.actualSpeed = instSpd;
        b.vel.set((b.pos.x - prevX) / dt, 0, (b.pos.z - prevZ) / dt);
        const quietRat = b.role === 'ambusher' && !b.ambushTriggered;
        if (!quietRat && moved > 0.002) {
          b.stepDist += moved;
          const stride = instSpd > 2.6 ? 2.2 : 1.75;
          if (b.stepDist >= stride) {
            b.stepDist %= stride;
            const surf = Math.abs(b.pos.y) > 0.4 ? 'concrete' : 'asphalt';
            sfx.step(surf, b.crouching ? 'crouch' : instSpd > 2.6 ? 'run' : 'walk', b.pos, b.crouching ? 0.35 : 0.78);
          }
        }
      } else {
        b.actualSpeed = 0;
      }
      void moveSpeed;

      b.root.position.copy(b.pos);
      b.root.rotation.set(0, b.yaw, 0);
      this.animateRig(b, dt, b.actualSpeed);
    }
  }

  private engageZombie(b: Bandit, nearZombie: Zombie, dt: number, setSpd: (s: number) => void): void {
    const zdx = nearZombie.pos.x - b.pos.x;
    const zdz = nearZombie.pos.z - b.pos.z;
    const zd = Math.hypot(zdx, zdz) || 1;
    const zYaw = Math.atan2(zdx, zdz);
    b.yaw = turnTowardYaw(b.yaw, zYaw, b.maxTurnRate, dt);
    this.updateAimTrack(b, nearZombie.pos.x, nearZombie.pos.y + 1.25, nearZombie.pos.z, dt);
    if (Math.abs(angleDiff(b.yaw, zYaw)) < (20 * Math.PI) / 180) b.aimWarmupT += dt;

    if (b.reactT > 0) {
      b.reactT -= dt;
      b.aiming = 1;
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      return;
    }

    if (b.isGun) {
      const dPitch = Math.max(-0.45, Math.min(0.45, (nearZombie.pos.y - b.pos.y) / zd));
      b.aimPitch += (dPitch - b.aimPitch) * Math.min(1, dt * 8);
      if (zd > 14) {
        b.moveMode = 'sprint';
        b.aiming = 0;
        this.moveOrOpenDoor(b, zdx / zd, zdz / zd, BOT_SPRINT_SPEED, dt);
        this.trackAntiStuck(b, zdx / zd, zdz / zd, BOT_SPRINT_SPEED, dt);
        setSpd(BOT_SPRINT_SPEED);
        return;
      }
      b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
      if (zd < 5.0) {
        b.moveMode = 'aim_walk';
        this.moveOrOpenDoor(b, -zdx / zd, -zdz / zd, BOT_ADS_SPEED, dt);
        this.trackAntiStuck(b, -zdx / zd, -zdz / zd, BOT_ADS_SPEED, dt);
        setSpd(BOT_ADS_SPEED);
      } else {
        b.moveMode = 'idle';
        this.resetAntiStuck(b);
      }
      if (b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.healT <= 0 && b.burstPause <= 0) {
        this.shootAt(b, nearZombie.pos.x, nearZombie.pos.y + 1.25, nearZombie.pos.z, false);
      }
    } else {
      b.aiming = 1;
      if (zd > 1.75) {
        b.moveMode = 'sprint';
        this.moveOrOpenDoor(b, zdx / zd, zdz / zd, BOT_SPRINT_SPEED, dt);
        this.trackAntiStuck(b, zdx / zd, zdz / zd, BOT_SPRINT_SPEED, dt);
        setSpd(BOT_SPRINT_SPEED);
      } else if (b.meleeCd <= 0) {
        b.moveMode = 'idle';
        this.resetAntiStuck(b);
        b.meleeCd = 0.95;
        b.swingT = 1;
        this.w.zombies.hit(nearZombie, 26, b.pos.x, b.pos.z, false, _v1.set(nearZombie.pos.x, nearZombie.pos.y + 1.1, nearZombie.pos.z));
        sfx.swing('heavy', 0.25, b.pos);
      }
    }
  }

  /** Triggered when player starts reloading: alerts nearby bots and sends 1-2 closest/assault rushers into PUSH_RELOAD. */
  onPlayerReloading(playerPos: Vector3): void {
    if (this.reloadPushCd > 0) return;
    const ppx = playerPos.x;
    const ppy = playerPos.y;
    const ppz = playerPos.z;
    const eyeY = ppy + 1.35;
    const aware: Bandit[] = [];

    for (const b of this.list) {
      if (b.isDead || b.state === 'dead' || !b.isGun) continue;
      const d = Math.hypot(ppx - b.pos.x, ppz - b.pos.z);
      const inHear = d <= RELOAD_PUSH_HEAR_RADIUS && Math.abs(ppy - b.pos.y) <= 6;
      const inSight = d <= 65 && this.hasLineOfSight(b.pos.x, b.pos.y + 1.45, b.pos.z, ppx, eyeY, ppz);
      if (!inHear && !inSight) continue;
      if (b.role === 'ambusher' && !b.ambushTriggered && !inSight) continue;
      aware.push(b);
      if (b.state !== 'combat') b.state = 'combat';
      b.ambushTriggered = true;
      b.reactT = Math.min(b.reactT, 0.12);
      b.investigateX = ppx;
      b.investigateZ = ppz;
      b.investigateT = 10;
      b.lockedKind = 'player';
      b.targetLockT = Math.max(b.targetLockT, 2.5);
    }
    if (aware.length === 0) return;

    const pushCandidates: Bandit[] = [];
    for (const b of aware) {
      const isOverwatch = b.role === 'goon_support' || b.role === 'goon_marksman' || b.spawnKind === 'sniper';
      if (isOverwatch) {
        if (b.tacticState === 'IN_COVER' || b.tacticState === 'SEEK_COVER' || b.tacticState === 'NONE') {
          b.tacticState = 'PEEK_AND_SHOOT';
          b.crouching = false;
          b.tacticTimer = 2.6;
          b.burstLeft = Math.max(b.burstLeft, 4);
          b.burstPause = 0;
        }
        continue;
      }
      if (b.reloadT > 0.25 || b.healT > 0.25 || b.tacticState === 'PUSH_RELOAD') continue;
      const d = Math.hypot(ppx - b.pos.x, ppz - b.pos.z);
      if (d > 5.5) pushCandidates.push(b);
    }
    if (pushCandidates.length === 0) return;

    pushCandidates.sort((a, b) => {
      const prio = (x: Bandit) => (x.role === 'goon_assault' ? 0 : x.faction === 'black' || x.role === 'boss' || x.role === 'guard' ? 1 : 2);
      const pDiff = prio(a) - prio(b);
      if (pDiff !== 0) return pDiff;
      return Math.hypot(a.pos.x - ppx, a.pos.z - ppz) - Math.hypot(b.pos.x - ppx, b.pos.z - ppz);
    });

    const maxPushers = pushCandidates.length >= 2 ? 2 : 1;
    let pushedCount = 0;
    let voiceAnchor: Bandit | null = null;
    for (let i = 0; i < pushCandidates.length && pushedCount < maxPushers; i++) {
      const b = pushCandidates[i];
      const curD = Math.hypot(ppx - b.pos.x, ppz - b.pos.z);
      const cov = this.findCoverNear(b, ppx, eyeY, ppz, 18, true);
      let gx = ppx;
      let gz = ppz;
      if (cov && Math.hypot(cov.x - ppx, cov.z - ppz) < curD - 4.0) {
        gx = cov.x;
        gz = cov.z;
        b.coverX = cov.x;
        b.coverZ = cov.z;
        b.peekX = cov.peekX;
        b.peekZ = cov.peekZ;
        b.coverHeight = cov.height;
        b.coverT = 8.0;
      } else {
        this.releaseCover(b);
        const awayX = (b.pos.x - ppx) / (curD || 1);
        const awayZ = (b.pos.z - ppz) / (curD || 1);
        const flankAng = (i % 2 === 0 ? 1 : -1) * (0.18 + Math.random() * 0.16);
        const c = Math.cos(flankAng);
        const s = Math.sin(flankAng);
        const targetR = Math.max(4.8, curD - (8.5 + Math.random() * 6.5));
        gx = ppx + (awayX * c - awayZ * s) * targetR;
        gz = ppz + (awayX * s + awayZ * c) * targetR;
        const gy = this.w.groundY(gx, gz, b.pos.y);
        _v2.set(gx, gy, gz);
        this.w.resolveCircle(_v2, 0.4);
        gx = _v2.x;
        gz = _v2.z;
      }
      b.tacticState = 'PUSH_RELOAD';
      b.moveMode = 'sprint';
      b.aiming = 0;
      b.crouching = false;
      b.adsRaiseT = BOT_ADS_RAISE_MIN + Math.random() * (BOT_ADS_RAISE_MAX - BOT_ADS_RAISE_MIN);
      b.reloadPushGoalX = gx;
      b.reloadPushGoalZ = gz;
      b.reloadPushT = 3.6;
      pushedCount++;
      if (!voiceAnchor) voiceAnchor = b;
    }
    if (voiceAnchor) {
      this.reloadPushCd = 2.0;
      sfx.pivot('asphalt', voiceAnchor.pos, true);
      this.w.toast?.(tr('Боец: «Перезаряжается! Давим!»', 'Raider: "Reloading! Push him!"'), 1600);
    }
  }

  private runTacticalCombat(
    b: Bandit,
    tx: number,
    ty: number,
    tz: number,
    hasLOS: boolean,
    targetIsPlayer: boolean,
    targetBot: Bandit | null,
    inCar: boolean,
    targetReloading: boolean,
    playerCrouched: boolean,
    targetVx: number,
    targetVz: number,
    boss: Bandit | undefined,
    bossDamaged: boolean,
    bossDeadEnraged: boolean,
    dt: number,
  ): number {
    const dx = tx - b.pos.x;
    const dz = tz - b.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;

    if (targetReloading && targetIsPlayer && this.reloadPushCd <= 0) {
      this.onPlayerReloading(_v3.set(tx, ty - (inCar ? 1.05 : playerCrouched ? 0.92 : 1.38), tz));
    }

    const desiredYaw = Math.atan2(dx, dz);
    const desiredPitch = Math.max(-0.55, Math.min(0.55, (ty - 1.38 - b.pos.y) / dist));
    b.aimPitch += (desiredPitch - b.aimPitch) * Math.min(1, dt * 8);

    const turnToTarget = () => {
      b.yaw = turnTowardYaw(b.yaw, desiredYaw, b.maxTurnRate, dt);
      if (hasLOS) {
        b.investigateX = tx;
        b.investigateZ = tz;
        b.investigateT = 10;
        this.updateAimTrack(b, tx, ty, tz, dt);
        const yawErr = Math.abs(angleDiff(b.yaw, desiredYaw));
        if (yawErr < (20 * Math.PI) / 180) b.aimWarmupT += dt;
        else if (yawErr > (35 * Math.PI) / 180) {
          b.aimWarmupT = 0;
          b.aimShots = 0;
        }
      } else {
        b.aimWarmupT = Math.max(0, b.aimWarmupT - dt * 1.8);
        if (b.aimWarmupT <= 0) b.aimShots = 0;
      }
    };

    if (b.reactT > 0) {
      b.reactT -= dt;
      turnToTarget();
      b.aiming = b.isGun ? 0.5 : 1;
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      return 0;
    }

    const goalFootY = targetBot ? targetBot.pos.y : ty - (inCar ? 1.05 : playerCrouched ? 0.92 : 1.38);
    const glassHit = hasLOS ? this.glassBetween(b.pos.x, b.pos.y + 1.4, b.pos.z, tx, ty, tz) : null;

    if (b.spawnKind === 'sniper' || b.role === 'goon_marksman') {
      turnToTarget();
      const maxRange = b.role === 'goon_marksman' ? 92 : 56;
      const keepDist = b.role === 'goon_marksman' ? 32 : 24;
      b.crouching = b.reloadT > 0 || b.burstPause > 0.15;
      b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
      if ((b.hp < b.maxHp * 0.45 || b.role === 'goon_marksman') && dist < keepDist) {
        if (hasWalkableLine(this.w, b.pos.x, b.pos.y, b.pos.z, b.pos.x - nx * 1.4, b.pos.y, b.pos.z - nz * 1.4, b.blockedSpots)) {
          b.moveMode = 'aim_walk';
          this.moveOrOpenDoor(b, -nx, -nz, BOT_ADS_SPEED, dt);
          this.trackAntiStuck(b, -nx, -nz, BOT_ADS_SPEED, dt);
          return BOT_ADS_SPEED;
        }
      }
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      if (hasLOS && b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0 && dist < maxRange) {
        this.shootAt(b, tx, ty, tz, targetIsPlayer, inCar, targetBot, false, playerCrouched);
      }
      return 0;
    }

    // Assault Goon throws a frag grenade when enemy takes cover or holds a room/corner 7..26 m away.
    const sq = this.getSquad(b.squadId);
    if (b.role === 'goon_assault' && b.grenadeCd <= 0 && sq.grenadeCd <= 0 && targetIsPlayer && dist >= 7 && dist <= 26) {
      if (!hasLOS || Math.random() < dt * 0.14) {
        this.throwGrenade(b, tx, goalFootY, tz);
        b.grenadeCd = 11 + Math.random() * 4;
        sq.grenadeCd = 7.5;
      }
    }

    if (!b.isGun) {
      b.crouching = false;
      b.aiming = 1;
      if (b.hp < b.maxHp * 0.25 && dist < 6) {
        if (hasWalkableLine(this.w, b.pos.x, b.pos.y, b.pos.z, b.pos.x - nx * 1.4, b.pos.y, b.pos.z - nz * 1.4, b.blockedSpots)) {
          turnToTarget();
          b.moveMode = 'sprint';
          this.moveOrOpenDoor(b, -nx, -nz, 3.6, dt);
          this.trackAntiStuck(b, -nx, -nz, 3.6, dt);
          return 3.6;
        }
      }
      if (dist > 1.65 || !hasLOS || glassHit !== null) {
        b.moveMode = 'sprint';
        return this.navigateToward(b, tx, goalFootY, tz, BOT_SPRINT_SPEED, dt, true);
      }
      turnToTarget();
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      if (b.meleeCd <= 0) {
        b.meleeCd = 1.05 + Math.random() * 0.25;
        b.swingT = 1;
        sfx.swing('heavy', 0.3, b.pos);
        if (targetBot) targetBot.hit(18, b.pos.x, b.pos.z, false, 'torso');
        else if (targetIsPlayer && !inCar) this.w.hurtPlayer(12 + Math.random() * 7, b.pos.x, b.pos.z, 'Нападение бандита');
      }
      return 0;
    }

    // Ambusher prefers crouching at doorway unless flanked/pushed closely
    if (b.role === 'ambusher' && b.tacticState === 'NONE' && hasLOS && glassHit === null && dist > 4.5 && b.lastHitT > 2) {
      turnToTarget();
      b.crouching = true;
      b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      if (b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.burstPause <= 0 && dist < 28) {
        this.shootAt(b, tx, ty, tz, targetIsPlayer, inCar, targetBot, false, playerCrouched);
      }
      return 0;
    }

    // Sees target through intact window glass: never run head-first into pane; hold standoff aim to break glass or sprint-flank
    if (glassHit !== null) {
      if (b.glassFlank) {
        b.crouching = false;
        b.moveMode = 'sprint';
        b.aiming = 0;
        return this.navigateToward(b, tx, goalFootY, tz, BOT_SPRINT_SPEED, dt, true);
      }
      turnToTarget();
      b.crouching = b.burstPause > 0.25;
      b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
      if (glassHit.dist < 2.8 && hasWalkableLine(this.w, b.pos.x, b.pos.y, b.pos.z, b.pos.x - nx * 1.4, b.pos.y, b.pos.z - nz * 1.4, b.blockedSpots)) {
        b.moveMode = 'aim_walk';
        this.moveOrOpenDoor(b, -nx, -nz, BOT_ADS_SPEED, dt);
        this.trackAntiStuck(b, -nx, -nz, BOT_ADS_SPEED, dt);
        if (b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.healT <= 0 && b.burstPause <= 0 && dist < 40) {
          this.shootAt(b, tx, ty, tz, targetIsPlayer, inCar, targetBot, false, playerCrouched);
        }
        return BOT_ADS_SPEED;
      }
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      if (b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.healT <= 0 && b.burstPause <= 0 && dist < 40) {
        this.shootAt(b, tx, ty, tz, targetIsPlayer, inCar, targetBot, false, playerCrouched);
      }
      return 0;
    }

    const needHeal = b.hp < b.maxHp * 0.42 && b.medkits > 0 && b.healT <= 0;
    if (needHeal && b.healT <= 0) b.healT = 2.5;
    const mustTakeCover = needHeal || b.healT > 0 || b.reloadT > 0;

    // 1) Aggressive Reload Push: sprint with weapon lowered to closer cover/flank, stop cleanly, raise ADS, then shoot.
    if (b.tacticState === 'PUSH_RELOAD' && !mustTakeCover) {
      const gDist = Math.hypot(b.reloadPushGoalX - b.pos.x, b.reloadPushGoalZ - b.pos.z);
      if (gDist > 1.0 && dist > 5.0 && b.reloadPushT > 0) {
        b.crouching = false;
        b.moveMode = 'sprint';
        b.aiming = 0;
        const gy = this.w.groundY(b.reloadPushGoalX, b.reloadPushGoalZ, b.pos.y);
        return this.navigateToward(b, b.reloadPushGoalX, gy, b.reloadPushGoalZ, BOT_SPRINT_SPEED, dt, true);
      }
      turnToTarget();
      this.resetAntiStuck(b);
      b.tacticState = 'PEEK_AND_SHOOT';
      b.tacticTimer = 2.6;
      b.peeksDone = 0;
      b.peekX = b.pos.x;
      b.peekZ = b.pos.z;
      b.burstLeft = 4 + Math.floor(Math.random() * 2);
      b.burstPause = 0;
      b.moveMode = 'idle';
      b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
      return 0;
    }

    // If reloading/healing out in the open, rush to cover first.
    if (mustTakeCover && b.tacticState !== 'IN_COVER' && b.tacticState !== 'SEEK_COVER') {
      const cov = this.findCoverNear(b, tx, ty, tz, 15, false);
      if (cov) {
        b.coverX = cov.x;
        b.coverZ = cov.z;
        b.peekX = cov.peekX;
        b.peekZ = cov.peekZ;
        b.coverHeight = cov.height;
        b.coverT = 7.5;
        b.tacticState = 'SEEK_COVER';
        b.peeksDone = 0;
      }
    }

    // 2) Seek initial or flanking cover while NOT in point-blank CQB (< 4.8 m) so ambushers/CQB fighters engage instead of turning tail.
    if (b.tacticState === 'NONE' && !bossDeadEnraged && dist >= 4.8 && b.role !== 'ambusher' && b.tacticTimer <= 0) {
      const cov = this.findCoverNear(b, tx, ty, tz, 15, false);
      if (cov) {
        b.coverX = cov.x;
        b.coverZ = cov.z;
        b.peekX = cov.peekX;
        b.peekZ = cov.peekZ;
        b.coverHeight = cov.height;
        b.coverT = 8.0;
        b.tacticState = 'SEEK_COVER';
        b.peeksDone = 0;
      } else {
        b.tacticTimer = 0.85;
      }
    }

    // 3) Cover State Machine: SEEK_COVER -> IN_COVER -> PEEK_AND_SHOOT -> RETREAT_OR_FLANK
    if (b.tacticState === 'SEEK_COVER') {
      if (!b.coverKey || b.coverT <= 0) {
        b.tacticState = 'NONE';
      } else {
        const cDist = Math.hypot(b.coverX - b.pos.x, b.coverZ - b.pos.z);
        if (cDist > 0.75) {
          b.crouching = false;
          b.moveMode = 'sprint';
          b.aiming = 0;
          const covY = this.w.groundY(b.coverX, b.coverZ, b.pos.y);
          return this.navigateToward(b, b.coverX, covY, b.coverZ, BOT_SPRINT_SPEED, dt, true);
        }
        turnToTarget();
        this.resetAntiStuck(b);
        b.tacticState = 'IN_COVER';
        b.tacticTimer = 1.0 + Math.random() * 1.5;
        b.crouching = true;
        b.moveMode = 'idle';
        b.aiming = 0.2;
        return 0;
      }
    }

    if (b.tacticState === 'IN_COVER') {
      turnToTarget();
      b.crouching = true;
      b.aiming = 0.2;
      const cdx = b.coverX - b.pos.x;
      const cdz = b.coverZ - b.pos.z;
      const cDist = Math.hypot(cdx, cdz);
      if (cDist > 0.65 && b.coverKey) {
        b.moveMode = 'walk';
        const covY = this.w.groundY(b.coverX, b.coverZ, b.pos.y);
        return this.navigateToward(b, b.coverX, covY, b.coverZ, BOT_CROUCH_SPEED, dt, false);
      }
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      const exposedInCover = hasLOS && b.tacticTimer < 1.8 && (b.coverHeight <= 1.42 ? this.hasLineOfSight(b.pos.x, b.pos.y + 0.95, b.pos.z, tx, ty, tz) : true);
      if ((exposedInCover || b.lastHitT < 0.22) && !mustTakeCover) {
        b.tacticState = 'RETREAT_OR_FLANK';
        return 0;
      }
      if (!mustTakeCover && b.tacticTimer <= 0) {
        b.tacticState = 'PEEK_AND_SHOOT';
        b.tacticTimer = 2.0 + Math.random() * 0.6;
        b.burstLeft = 3 + Math.floor(Math.random() * 3);
        b.burstPause = 0;
        b.adsRaiseT = Math.max(b.adsRaiseT, BOT_ADS_RAISE_MIN);
      }
      return 0;
    }

    if (b.tacticState === 'PEEK_AND_SHOOT') {
      if (b.burstPause > 0 || b.reloadT > 0 || b.healT > 0 || b.tacticTimer <= 0 || b.lastHitT < 0.16) {
        turnToTarget();
        b.tacticState = 'RETREAT_OR_FLANK';
        b.crouching = true;
        b.aiming = 0.25;
        b.moveMode = 'idle';
        this.resetAntiStuck(b);
        return 0;
      }
      turnToTarget();
        b.crouching = false;
        const needStepPeek = b.coverHeight > 1.42 && b.coverKey !== null && Math.hypot(b.peekX - b.pos.x, b.peekZ - b.pos.z) > 0.3;
        let spd = 0;
        if (needStepPeek) {
          b.moveMode = 'aim_walk';
          const pyPeek = this.w.groundY(b.peekX, b.peekZ, b.pos.y);
          spd = this.navigateToward(b, b.peekX, pyPeek, b.peekZ, BOT_ADS_SPEED, dt, false);
        } else {
          b.moveMode = 'idle';
          this.resetAntiStuck(b);
        }
        b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
        if (hasLOS && b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.healT <= 0 && b.burstPause <= 0 && dist < 44) {
          this.shootAt(b, tx, ty, tz, targetIsPlayer, inCar, targetBot, !b.hasFireToken, playerCrouched);
        }
        return spd;
    }

    if (b.tacticState === 'RETREAT_OR_FLANK') {
      b.peeksDone++;
      const coverValid = !!b.coverKey && b.coverT > 2.2;
      if (!coverValid || b.peeksDone >= 2 || bossDeadEnraged) {
        const nextCov = !bossDeadEnraged ? this.findCoverNear(b, tx, ty, tz, 16, dist > 16) : null;
        if (nextCov) {
          b.coverX = nextCov.x;
          b.coverZ = nextCov.z;
          b.peekX = nextCov.peekX;
          b.peekZ = nextCov.peekZ;
          b.coverHeight = nextCov.height;
          b.coverT = 8.0;
          b.tacticState = 'SEEK_COVER';
          b.peeksDone = 0;
          b.crouching = false;
          b.moveMode = 'sprint';
          b.aiming = 0;
          const covY = this.w.groundY(nextCov.x, nextCov.z, b.pos.y);
          return this.navigateToward(b, nextCov.x, covY, nextCov.z, BOT_SPRINT_SPEED, dt, true);
        }
        if (coverValid) {
          turnToTarget();
          b.peeksDone = 0;
          b.tacticState = 'IN_COVER';
          b.tacticTimer = 1.0 + Math.random() * 1.4;
          b.crouching = true;
          b.moveMode = 'idle';
          b.aiming = 0.2;
          return 0;
        }
        this.releaseCover(b);
        b.tacticState = 'NONE';
      } else {
        turnToTarget();
        b.tacticState = 'IN_COVER';
        b.tacticTimer = 1.0 + Math.random() * 1.4;
        b.crouching = true;
        b.aiming = 0.2;
        if (Math.hypot(b.coverX - b.pos.x, b.coverZ - b.pos.z) > 0.55) {
          b.moveMode = 'walk';
          const covY = this.w.groundY(b.coverX, b.coverZ, b.pos.y);
          return this.navigateToward(b, b.coverX, covY, b.coverZ, BOT_CROUCH_SPEED, dt, false);
        }
        b.moveMode = 'idle';
        this.resetAntiStuck(b);
        return 0;
      }
    }

    // 4) Open-ground fallback (when no valid cover collider exists nearby):
    // Sprint with lowered weapon ONLY when far/no LOS/closing; strictly <= BOT_ADS_SPEED (0.95 m/s) when aiming or shooting.
    b.crouching = mustTakeCover || (b.burstPause > 0.25 && hasLOS);
    const targetFleeing = dist > 11 && targetVx * nx + targetVz * nz > 2.0;

    if (mustTakeCover) {
      turnToTarget();
      b.aiming = 0.25;
      if (hasWalkableLine(this.w, b.pos.x, b.pos.y, b.pos.z, b.pos.x - nx * 1.4, b.pos.y, b.pos.z - nz * 1.4, b.blockedSpots)) {
        b.moveMode = 'walk';
        this.moveOrOpenDoor(b, -nx, -nz, BOT_CROUCH_SPEED, dt);
        this.trackAntiStuck(b, -nx, -nz, BOT_CROUCH_SPEED, dt);
        return BOT_CROUCH_SPEED;
      }
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
      return 0;
    }

    if (!hasLOS || dist > (bossDeadEnraged ? 5.5 : 22) || (targetFleeing && dist > 14)) {
      b.moveMode = 'sprint';
      b.aiming = 0;
      b.crouching = false;
      return this.navigateToward(b, tx, goalFootY, tz, BOT_SPRINT_SPEED, dt, true);
    }

    if (boss && !boss.isDead && !bossDamaged && Math.hypot(boss.pos.x - b.pos.x, boss.pos.z - b.pos.z) > 7.5) {
      b.moveMode = 'sprint';
      b.aiming = 0;
      b.crouching = false;
      return this.navigateToward(b, boss.pos.x, boss.pos.y, boss.pos.z, BOT_SPRINT_SPEED, dt, true);
    }

    turnToTarget();
    let moveSpeed = 0;
    if (dist < 6.0 && hasWalkableLine(this.w, b.pos.x, b.pos.y, b.pos.z, b.pos.x - nx * 1.4, b.pos.y, b.pos.z - nz * 1.4, b.blockedSpots)) {
      b.moveMode = 'aim_walk';
      this.moveOrOpenDoor(b, -nx, -nz, BOT_ADS_SPEED, dt);
      this.trackAntiStuck(b, -nx, -nz, BOT_ADS_SPEED, dt);
      moveSpeed = BOT_ADS_SPEED;
    } else if (!b.hasFireToken || b.burstPause > 0 || bossDamaged) {
      b.moveMode = 'aim_walk';
      const sx = -nz * b.flankSign;
      const sz = nx * b.flankSign;
      this.moveOrOpenDoor(b, sx, sz, BOT_ADS_SPEED, dt);
      this.trackAntiStuck(b, sx, sz, BOT_ADS_SPEED, dt);
      moveSpeed = BOT_ADS_SPEED;
    } else {
      b.moveMode = 'idle';
      this.resetAntiStuck(b);
    }

    b.aiming = b.adsRaiseT <= 0 ? 1 : 0.35;
    if (hasLOS && b.adsRaiseT <= 0 && b.fireCd <= 0 && b.reloadT <= 0 && b.healT <= 0 && b.burstPause <= 0 && dist < 40) {
      this.shootAt(b, tx, ty, tz, targetIsPlayer, inCar, targetBot, !b.hasFireToken, playerCrouched);
    }
    return moveSpeed;
  }

  /**
   * Find nearest unreserved solid cover point (car, building corner, concrete wall, barricade >= 0.85 m tall, ignoring glass)
   * that breaks LOS to threat and offers a walkable low stand-up or lateral corner peek line of sight.
   */
  private findCoverNear(
    b: Bandit,
    tx: number,
    ty: number,
    tz: number,
    searchRadius = 15,
    preferCloser = false,
  ): { x: number; z: number; peekX: number; peekZ: number; height: number } | null {
    const boxes = this.coverBoxCache;
    boxes.length = 0;
    this.w.boxesNear(b.pos.x, b.pos.z, searchRadius, boxes);
    let best: { x: number; z: number; peekX: number; peekZ: number; height: number; key: string } | null = null;
    let bestScore = Infinity;
    const playerCurDist = Math.hypot(b.pos.x - tx, b.pos.z - tz);

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.glass) continue;
      const boxH = box.maxY - b.pos.y;
      if (box.maxY - box.minY < 0.85 || box.minY > b.pos.y + 1.2 || boxH < 0.88) continue;
      const w = box.maxX - box.minX;
      const d = box.maxZ - box.minZ;
      if (Math.max(w, d) < 0.45 || Math.min(w, d) < 0.18) continue;
      if (Math.max(w, d) > 32) continue;

      const cx = (box.minX + box.maxX) * 0.5;
      const cz = (box.minZ + box.maxZ) * 0.5;
      const hx = w * 0.5;
      const hz = d * 0.5;
      const awayX = cx - tx;
      const awayZ = cz - tz;
      const len = Math.hypot(awayX, awayZ) || 1;
      const ax = awayX / len;
      const az = awayZ / len;
      const edgeDist = Math.min(hx / Math.max(0.15, Math.abs(ax)), hz / Math.max(0.15, Math.abs(az)));
      const baseX = cx + ax * (edgeDist + 0.64);
      const baseZ = cz + az * (edgeDist + 0.64);
      const lowCover = boxH <= 1.42;

      const cands: { x: number; z: number; px: number; pz: number }[] = [{ x: baseX, z: baseZ, px: baseX, pz: baseZ }];
      if (!lowCover) {
        const cornerList: [number, number][] = [
          [box.minX, box.minZ],
          [box.maxX, box.minZ],
          [box.minX, box.maxZ],
          [box.maxX, box.maxZ],
        ];
        for (const [kx, kz] of cornerList) {
          const toCenterX = cx - kx;
          const toCenterZ = cz - kz;
          const cl = Math.hypot(toCenterX, toCenterZ) || 1;
          // Tuck slightly behind corner face away from threat, peek laterally outside edge
          const dirToThreatX = tx - kx;
          const dirToThreatZ = tz - kz;
          const tl = Math.hypot(dirToThreatX, dirToThreatZ) || 1;
          const tnx = dirToThreatX / tl;
          const tnz = dirToThreatZ / tl;
          const outX = kx < cx ? -1 : 1;
          const outZ = kz < cz ? -1 : 1;
          const sx = kx - tnx * 0.68 + (toCenterX / cl) * 0.38;
          const sz = kz - tnz * 0.68 + (toCenterZ / cl) * 0.38;
          const pkX = kx + outX * 0.72 - tnx * 0.28;
          const pkZ = kz + outZ * 0.72 - tnz * 0.28;
          cands.push({ x: sx, z: sz, px: pkX, pz: pkZ });
        }
      }

      for (const cand of cands) {
        const moveDist = Math.hypot(cand.x - b.pos.x, cand.z - b.pos.z);
        if (moveDist > searchRadius || moveDist < 0.45) continue;
        const candY = this.w.groundY(cand.x, cand.z, b.pos.y);
        if (Math.abs(candY - b.pos.y) > 0.7) continue;

        _v3.set(cand.x, candY, cand.z);
        this.w.resolveCircle(_v3, 0.36);
        if (Math.hypot(_v3.x - cand.x, _v3.z - cand.z) > 0.14) continue;

        const threatDist = Math.hypot(cand.x - tx, cand.z - tz);
        if (threatDist < 4.0) continue;

        // Never pick cover whose approach runs straight through or past the enemy
        const vbx = cand.x - b.pos.x;
        const vbz = cand.z - b.pos.z;
        const vlen2 = vbx * vbx + vbz * vbz || 1;
        const tProj = Math.max(0, Math.min(1, ((tx - b.pos.x) * vbx + (tz - b.pos.z) * vbz) / vlen2));
        const closestThreatD = Math.hypot(b.pos.x + vbx * tProj - tx, b.pos.z + vbz * tProj - tz);
        if (closestThreatD < Math.min(3.6, playerCurDist - 0.4)) continue;

        const cKey = `${Math.round(cand.x * 0.5)},${Math.round(b.pos.y / 2)},${Math.round(cand.z * 0.5)}`;
        const claimer = this.coverClaims.get(cKey);
        if (claimer !== undefined && claimer !== b.id) continue;

        let crowded = false;
        for (const ally of this.list) {
          if (ally === b || ally.state === 'dead' || areFactionsHostile(b.faction, ally.faction)) continue;
          if (Math.hypot(ally.pos.x - cand.x, ally.pos.z - cand.z) < 2.8) {
            crowded = true;
            break;
          }
        }
        if (crowded) continue;

        const hideEye = candY + (lowCover ? 0.92 : 1.35);
        if (this.hasLineOfSight(cand.x, hideEye, cand.z, tx, ty, tz)) continue;

        let canPeek = false;
        if (lowCover) {
          canPeek = this.hasLineOfSight(cand.x, candY + 1.48, cand.z, tx, ty, tz);
        } else {
          const pkY = this.w.groundY(cand.px, cand.pz, candY);
          if (
            Math.abs(pkY - candY) <= 0.5 &&
            hasWalkableLine(this.w, cand.x, candY, cand.z, cand.px, pkY, cand.pz, b.blockedSpots) &&
            this.hasLineOfSight(cand.px, pkY + 1.42, cand.pz, tx, ty, tz)
          ) {
            canPeek = true;
          }
        }
        if (!canPeek && b.reloadT <= 0 && b.healT <= 0) continue;

        let score = moveDist;
        if (preferCloser) {
          const delta = playerCurDist - threatDist;
          score = moveDist - Math.max(-4, Math.min(14, delta)) * 1.15;
        }
        if (score < bestScore) {
          bestScore = score;
          best = { x: cand.x, z: cand.z, peekX: cand.px, peekZ: cand.pz, height: boxH, key: cKey };
        }
      }
    }
    if (best) {
      this.releaseCover(b);
      b.coverKey = best.key;
      this.coverClaims.set(best.key, b.id);
      return { x: best.x, z: best.z, peekX: best.peekX, peekZ: best.peekZ, height: best.height };
    }
    return null;
  }

  /** Returns intact window glass blocking the eye ray before any opaque wall, or null. */
  private glassBetween(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): { dist: number; x: number; y: number; z: number } | null {
    _v1.set(tx - ox, ty - oy, tz - oz);
    const len = _v1.length();
    if (len < 0.15) return null;
    _v1.divideScalar(len);
    const solidHit = this.w.rayHit(ox, oy, oz, _v1.x, _v1.y, _v1.z, len, false);
    if (solidHit < 0 || solidHit >= len - 0.05) return null;
    const opaqueHit = this.w.rayHit(ox, oy, oz, _v1.x, _v1.y, _v1.z, len, true);
    if (opaqueHit >= 0 && opaqueHit <= solidHit + 0.04) return null;
    return { dist: solidHit, x: ox + _v1.x * solidHit, y: oy + _v1.y * solidHit, z: oz + _v1.z * solidHit };
  }

  private resetAntiStuck(b: Bandit): void {
    b.stuckTimer = 0;
    b.stuckAnchorX = b.pos.x;
    b.stuckAnchorZ = b.pos.z;
  }

  /** Detect stall (< 0.2m displacement over 0.8s while moving) and mark blocked direction so A* replans cleanly. */
  private trackAntiStuck(b: Bandit, dirX: number, dirZ: number, speed: number, dt: number): boolean {
    if (speed <= 0.4) {
      this.resetAntiStuck(b);
      return false;
    }
    b.stuckTimer += dt;
    if (b.stuckTimer < 0.8) return false;

    const disp = Math.hypot(b.pos.x - b.stuckAnchorX, b.pos.z - b.stuckAnchorZ);
    b.stuckAnchorX = b.pos.x;
    b.stuckAnchorZ = b.pos.z;
    b.stuckTimer = 0;

    if (disp >= 0.2) return false;

    if (b.blockedSpots.length >= 6) b.blockedSpots.shift();
    b.blockedSpots.push({ x: b.pos.x + dirX * 0.65, z: b.pos.z + dirZ * 0.65, ttl: 5.0 });
    if (b.doorCd <= 0 && this.w.openDoorNear && this.w.openDoorNear(b.pos.x, b.pos.y, b.pos.z, 2.0)) {
      b.doorCd = 0.85;
    }
    b.flankSign = (b.flankSign === 1 ? -1 : 1) as -1 | 1;
    b.navPath.length = 0;
    b.navIdx = 0;
    b.navTimer = 0;
    return true;
  }

  /** Follow A* waypoint path through doorways and stairs (replanning on obstacle/timer/stuck). */
  private navigateToward(b: Bandit, tx: number, ty: number, tz: number, speed: number, dt: number, turnToPath: boolean): number {
    const goalChanged = Math.hypot(tx - b.navGoalX, tz - b.navGoalZ) > 2.4 || Math.abs(ty - b.navGoalY) > 1.2;
    if (b.navPath.length === 0 || b.navIdx >= b.navPath.length || b.navTimer <= 0 || goalChanged) {
      b.navPath = findBotPath(this.w, { x: b.pos.x, y: b.pos.y, z: b.pos.z }, { x: tx, y: ty, z: tz }, b.blockedSpots);
      b.navIdx = 0;
      b.navTimer = 0.55;
      b.navGoalX = tx;
      b.navGoalY = ty;
      b.navGoalZ = tz;
    }

    while (
      b.navIdx < b.navPath.length - 1 &&
      Math.hypot(b.navPath[b.navIdx].x - b.pos.x, b.navPath[b.navIdx].z - b.pos.z) < 0.58 &&
      Math.abs(b.navPath[b.navIdx].y - b.pos.y) <= 1.2
    ) {
      b.navIdx++;
    }

    const wp = b.navPath[Math.min(b.navIdx, b.navPath.length - 1)] ?? { x: tx, y: ty, z: tz };
    const dx = wp.x - b.pos.x;
    const dz = wp.z - b.pos.z;
    const d = Math.hypot(dx, dz);
    if (d <= 0.08) {
      this.resetAntiStuck(b);
      return 0;
    }

    const nx = dx / d;
    const nz = dz / d;
    if (turnToPath) b.yaw = turnTowardYaw(b.yaw, Math.atan2(nx, nz), b.maxTurnRate * 0.75, dt);

    if (wp.isDoor && d < 1.9 && b.doorCd <= 0 && this.w.openDoorNear) {
      if (this.w.openDoorNear(b.pos.x, b.pos.y, b.pos.z, 1.9)) b.doorCd = 0.85;
    }

    this.moveOrOpenDoor(b, nx, nz, speed, dt);
    this.trackAntiStuck(b, nx, nz, speed, dt);
    return speed;
  }

  /** Step horizontally and automatically open any closed door blocking the bot's path. */
  private moveOrOpenDoor(b: Bandit, nx: number, nz: number, speed: number, dt: number): boolean {
    const step = speed * dt;
    const beforeX = b.pos.x;
    const beforeZ = b.pos.z;
    this.stepBandit(b, nx, nz, step);
    const moved = Math.hypot(b.pos.x - beforeX, b.pos.z - beforeZ);
    if (moved < step * 0.32 && b.doorCd <= 0 && this.w.openDoorNear) {
      if (this.w.openDoorNear(b.pos.x, b.pos.y, b.pos.z, 1.7)) {
        b.doorCd = 0.85;
        this.stepBandit(b, nx, nz, step * 0.8);
        return true;
      }
    }
    return moved >= step * 0.2;
  }

  /** Attracted to noise (player or faction gunfire): alerts nearby bots to investigate after human reaction pause. */
  onNoise(x: number, z: number, r: number): void {
    const r2 = r * r;
    for (const b of this.list) {
      if (b.state === 'dead') continue;
      if (b.role === 'ambusher' && !b.ambushTriggered) continue;
      const dx = x - b.pos.x;
      const dz = z - b.pos.z;
      if (dx * dx + dz * dz <= r2) {
        if (b.state !== 'combat' && b.investigateT <= 0 && !this.inFieldOfView(b, x, z)) {
          b.noiseReactT = 0.25 + Math.random() * 0.2;
        }
        b.investigateX = x;
        b.investigateZ = z;
        b.investigateT = 9;
      }
    }
  }

  hitTest(o: Vector3, d: Vector3, maxDist: number, slack = 0.04, ignore?: Bandit): BanditHit | null {
    let best: BanditHit | null = null;
    let bestT = maxDist;
    for (const b of this.list) {
      if (b.state === 'dead' || b === ignore) continue;
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
      const topH = b.crouching ? 1.3 : 1.8;
      if (hitY < b.pos.y || hitY > b.pos.y + topH) continue;
      const rad = 0.34 + slack;
      if ((hitX - cx) ** 2 + (hitZ - cz) ** 2 > rad * rad) continue;
      bestT = t;
      const relY = hitY - b.pos.y;
      const headThreshold = b.crouching ? 0.98 : 1.44;
      const torsoThreshold = b.crouching ? 0.52 : 0.8;
      const head = relY >= headThreshold;
      const zone: HitZone = head ? 'head' : relY >= torsoThreshold ? 'torso' : 'limbs';
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

  hit(
    b: Bandit,
    dmg: number,
    fromX: number,
    fromZ: number,
    head = false,
    zone?: HitZone,
    attackerKind: 'player' | 'bot' = 'player',
    attackerId: number | null = null,
  ): boolean {
    if (b.isDead || b.state === 'dead') return false;
    const hitZone: HitZone = zone ?? (head ? 'head' : 'torso');
    const armor = applyZonalArmor(dmg, hitZone, b.worn, b.wornDirt);
    if (armor.armored && armor.hitSlot) {
      const nextDirt = Math.min(1, (b.wornDirt[armor.hitSlot] ?? 0) + 0.04);
      b.wornDirt[armor.hitSlot] = nextDirt;
      const st = b.corpse.slots[armor.hitSlot];
      if (st) st.dirt = nextDirt;
    }
    const prevState = b.state;
    b.hp -= armor.damage;
    b.lastHitT = 0;
    b.lastAttackerKind = attackerKind;
    b.lastAttackerId = attackerId;
    b.flankSign = Math.random() < 0.5 ? -1 : 1;
    b.state = 'combat';
    b.ambushTriggered = true;
    b.investigateX = fromX;
    b.investigateZ = fromZ;
    b.investigateT = 10;
    if (prevState !== 'combat') {
      b.reactT = Math.max(b.reactT, b.faction === 'scavs' ? 0.35 : 0.2);
    }

    // Alert living squadmates within 18m
    for (const mate of this.list) {
      if (mate !== b && mate.state !== 'dead' && mate.squadId === b.squadId && mate.pos.distanceTo(b.pos) < 18) {
        mate.state = 'combat';
        mate.investigateX = fromX;
        mate.investigateZ = fromZ;
        mate.investigateT = 10;
      }
    }

    if (b.hp <= 0) {
      b.hp = 0;
      b.isDead = true;
      b.state = 'dead';
      b.deadT = 0;
      this.releaseCover(b);
      if (b.glintMesh) b.glintMesh.visible = false;
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
    for (const g of this.grenades) this.w.scene.remove(g.mesh);
    this.tracers.length = 0;
    this.grenades.length = 0;
    this.squads.clear();
    this.coverClaims.clear();
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    this.grenadeGeo.dispose();
    this.grenadeMat.dispose();
    this.glintGeo.dispose();
    this.glintMat.dispose();
  }

  private pickStreetWeapon(faction: FactionId): { weapon: ItemId; isGun: boolean; mods: ModId[] } {
    const simpleGuns: readonly BanditGunId[] = ['pistol_g17', 'pistol_m1911', 'shotgun_pump'];
    if (faction === 'scavs') {
      const isGun = Math.random() < 0.72;
      const weapon: ItemId = isGun ? simpleGuns[Math.floor(Math.random() * simpleGuns.length)] : BANDIT_MELEE[Math.floor(Math.random() * BANDIT_MELEE.length)];
      return { weapon, isGun, mods: [] };
    }
    const pool: readonly BanditGunId[] =
      faction === 'bear'
        ? ['rifle_ak', 'shotgun_pump']
        : faction === 'usec'
          ? ['rifle_m4a1', 'shotgun_pump']
          : faction === 'black'
            ? ['rifle_ak', 'rifle_m4a1']
            : ['rifle_m4a1', 'rifle_ak'];
    const weapon = pool[Math.floor(Math.random() * pool.length)];
    return { weapon, isGun: true, mods: rollMods(weapon, faction, 'regular') };
  }

  private trySpawnSquad(px: number, pz: number, playerArmed: boolean, room: number): void {
    const roll = Math.random();
    const faction: FactionId =
      playerArmed
        ? roll < 0.25
          ? 'black'
          : roll < 0.53
            ? 'bear'
            : roll < 0.80
              ? 'usec'
              : 'scavs'
        : roll < 0.12
          ? 'black'
          : roll < 0.30
            ? 'bear'
            : roll < 0.48
              ? 'usec'
              : 'scavs';

    const wantSize = faction === 'scavs' ? (Math.random() < 0.55 ? 2 : 1) : faction === 'black' ? 2 : Math.random() < 0.55 ? 3 : 2;
    const count = Math.max(1, Math.min(room, wantSize));
    const squadId = this.nextSquadId++;

    for (let attempt = 0; attempt < 8; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      const ax = px + Math.cos(ang) * dist;
      const az = pz + Math.sin(ang) * dist;
      const sy = this.w.groundY(ax, az);
      if (sy < -5) continue;
      _v1.set(ax, sy, az);
      this.w.resolveCircle(_v1, 0.45);
      if (Math.hypot(_v1.x - px, _v1.z - pz) < SPAWN_MIN * 0.85) continue;

      const baseX = _v1.x;
      const baseZ = _v1.z;
      for (let m = 0; m < count; m++) {
        const offAng = (m / Math.max(1, count)) * Math.PI * 2 + Math.random() * 0.4;
        const offR = m === 0 ? 0 : 4.0 + Math.random() * 1.4;
        const mx = baseX + Math.cos(offAng) * offR;
        const mz = baseZ + Math.sin(offAng) * offR;
        const my = this.w.groundY(mx, mz, sy);
        _v2.set(mx, my, mz);
        this.w.resolveCircle(_v2, 0.45);
        const gear = this.pickStreetWeapon(faction);
        this.spawnBot(_v2.x, my, _v2.z, faction, 'street', gear.weapon, gear.isGun, gear.mods, { role: 'regular', squadId });
      }
      return;
    }
  }

  private trySpawnIndoor(px: number, pz: number, playerArmed: boolean): boolean {
    const blds = this.w.buildingsNear(px, pz, 55).filter((b) => (this.w.isInteriorLoaded ? this.w.isInteriorLoaded(b.id) : true));
    if (blds.length === 0) return false;
    const bld = blds[Math.floor(Math.random() * blds.length)];
    const floor = Math.floor(Math.random() * Math.min(2, bld.floors));
    const cornerSignX = Math.random() < 0.5 ? -1 : 1;
    const cornerSignZ = Math.random() < 0.5 ? -1 : 1;
    const isAmbusher = Math.random() < 0.62;
    const sx = bld.cx + (isAmbusher ? cornerSignX * Math.max(1.2, bld.w * 0.36) : (Math.random() - 0.5) * Math.max(2, bld.w - 3.5));
    const sz = bld.cz + (isAmbusher ? cornerSignZ * Math.max(1.2, bld.d * 0.34) : (Math.random() - 0.5) * Math.max(2, bld.d - 3.5));
    if (Math.hypot(sx - px, sz - pz) < 16) return false;
    const sy = this.w.groundY(sx, sz, floor * FLOOR_H + 0.5);
    _v1.set(sx, sy, sz);
    this.w.resolveCircle(_v1, 0.45);

    const faction: FactionId = playerArmed
      ? Math.random() < 0.4
        ? Math.random() < 0.5
          ? 'bear'
          : 'usec'
        : 'scavs'
      : Math.random() < 0.15
        ? 'bear'
        : 'scavs';
    const isGun = isAmbusher ? true : faction !== 'scavs' ? true : Math.random() < 0.72;
    const gear = isGun
      ? faction === 'bear'
        ? { weapon: 'rifle_ak' as ItemId, mods: rollMods('rifle_ak', faction, 'regular') }
        : faction === 'usec'
          ? { weapon: 'rifle_m4a1' as ItemId, mods: rollMods('rifle_m4a1', faction, 'regular') }
          : { weapon: (Math.random() < 0.55 ? 'shotgun_pump' : 'pistol_g17') as ItemId, mods: [] as ModId[] }
      : { weapon: BANDIT_MELEE[Math.floor(Math.random() * BANDIT_MELEE.length)] as ItemId, mods: [] as ModId[] };

    const bot = this.spawnBot(_v1.x, sy, _v1.z, faction, 'indoor', gear.weapon, isGun, gear.mods, {
      role: isAmbusher ? 'ambusher' : 'regular',
      squadId: this.nextSquadId++,
    });
    // Ambusher faces toward room center / corridor entry
    if (isAmbusher) bot.patrolYaw = Math.atan2(bld.cx - bot.pos.x, bld.cz - bot.pos.z);
    return true;
  }

  private trySpawnBossGroup(px: number, pz: number, room: number): boolean {
    const blds = this.w.buildingsNear(px, pz, 64).filter((b) => b.floors >= 2);
    let anchorX = 0;
    let anchorY = 0;
    let anchorZ = 0;
    let found = false;

    if (blds.length > 0) {
      const bld = blds[Math.floor(Math.random() * blds.length)];
      const floor = this.w.isInteriorLoaded?.(bld.id) ? Math.floor(Math.random() * Math.min(2, bld.floors)) : 0;
      const sx = bld.cx + (Math.random() - 0.5) * Math.max(2, bld.w * 0.4);
      const sz = bld.cz + (Math.random() - 0.5) * Math.max(2, bld.d * 0.4);
      if (Math.hypot(sx - px, sz - pz) >= 24) {
        anchorY = this.w.groundY(sx, sz, floor * FLOOR_H + 0.5);
        _v1.set(sx, anchorY, sz);
        this.w.resolveCircle(_v1, 0.45);
        anchorX = _v1.x;
        anchorZ = _v1.z;
        found = true;
      }
    }
    if (!found) {
      const ang = Math.random() * Math.PI * 2;
      const dist = 38 + Math.random() * 20;
      const sx = px + Math.cos(ang) * dist;
      const sz = pz + Math.sin(ang) * dist;
      const sy = this.w.groundY(sx, sz);
      if (sy < -5) return false;
      _v1.set(sx, sy, sz);
      this.w.resolveCircle(_v1, 0.45);
      anchorX = _v1.x;
      anchorY = sy;
      anchorZ = _v1.z;
    }

    if (room >= 3 && Math.random() < 0.35) {
      this.spawnGoonsSquad(anchorX, anchorY, anchorZ);
      return true;
    }

    const preset = BOSS_PRESETS[Math.floor(Math.random() * BOSS_PRESETS.length)];
    const squadId = this.nextSquadId++;
    const boss = this.spawnBot(anchorX, anchorY, anchorZ, 'boss', 'boss', preset.weapon, true, preset.mods, {
      role: 'boss',
      squadId,
      bossPreset: preset,
    });

    const guardCount = Math.max(2, Math.min(room - 1, 2 + Math.floor(Math.random() * 2)));
    for (let g = 0; g < guardCount; g++) {
      const ang = (g / guardCount) * Math.PI * 2;
      const gx = anchorX + Math.cos(ang) * 4.2;
      const gz = anchorZ + Math.sin(ang) * 4.2;
      const gy = this.w.groundY(gx, gz, anchorY);
      _v2.set(gx, gy, gz);
      this.w.resolveCircle(_v2, 0.45);
      const gw: BanditGunId = g % 2 === 0 ? 'rifle_ak' : 'rifle_m4a1';
      this.spawnBot(_v2.x, gy, _v2.z, 'boss', 'boss', gw, true, rollMods(gw, 'boss', 'guard'), {
        role: 'guard',
        squadId,
        bossId: boss.id,
      });
    }
    return true;
  }

  /** Spawns an elite 3-role Goons squad (Assault w/ grenades, Support gunner, 45–90 m Marksman w/ glint). */
  spawnGoonsNear(px: number, pz: number, dist = 36): Bandit[] {
    const ang = Math.random() * Math.PI * 2;
    const ax = px + Math.cos(ang) * dist;
    const az = pz + Math.sin(ang) * dist;
    const ay = this.w.groundY(ax, az);
    _v1.set(ax, ay, az);
    this.w.resolveCircle(_v1, 0.45);
    return this.spawnGoonsSquad(_v1.x, ay, _v1.z);
  }

  private spawnGoonsSquad(anchorX: number, anchorY: number, anchorZ: number): Bandit[] {
    const squadId = this.nextSquadId++;
    const specs: { role: BotRole; weapon: BanditGunId; mods: ModId[]; r: number; ang: number }[] = [
      { role: 'goon_assault', weapon: 'rifle_m4a1', mods: ['mod_flashlight', 'mod_ext_mag_m4'], r: 0, ang: 0 },
      { role: 'goon_support', weapon: 'rifle_ak', mods: ['mod_ext_mag_ak', 'mod_flashlight'], r: 4.5, ang: 2.1 },
      { role: 'goon_marksman', weapon: 'rifle_hunting', mods: ['mod_suppressor'], r: 6.5, ang: 4.2 },
    ];
    const spawned: Bandit[] = [];
    for (const s of specs) {
      const x = anchorX + Math.cos(s.ang) * s.r;
      const z = anchorZ + Math.sin(s.ang) * s.r;
      const y = this.w.groundY(x, z, anchorY);
      _v2.set(x, y, z);
      this.w.resolveCircle(_v2, 0.45);
      spawned.push(this.spawnBot(_v2.x, y, _v2.z, 'black', 'boss', s.weapon, true, s.mods, { role: s.role, squadId }));
    }
    return spawned;
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
    this.spawnBot(edgeX, sy, edgeZ, 'snipers', 'sniper', 'rifle_hunting', true, rollMods('rifle_hunting', 'snipers', 'regular'));
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
    opts: SpawnBotOptions = {},
  ): Bandit {
    const role: BotRole = opts.role ?? 'regular';
    const squadId = opts.squadId ?? this.nextSquadId++;
    const bossId = opts.bossId ?? null;
    const preset = opts.bossPreset;
    const magCap = isGun ? GUNS[weapon as BanditGunId].capacity : 1;
    const look = randomLook(preset?.name ?? factionTitle(faction, role));
    const outfits = FACTION_OUTFITS[faction] ?? FACTION_OUTFITS.pmc;
    const worn = preset ? preset.worn : outfits[Math.floor(Math.random() * outfits.length)];
    const tints = FACTION_TINTS[faction] ?? FACTION_TINTS.pmc;
    const tint = preset ? preset.tint : tints[Math.floor(Math.random() * tints.length)];

    const root = new Group();
    root.position.set(rx, sy, rz);
    this.w.scene.add(root);

    const maxHp = preset
      ? preset.hp
      : role === 'goon_assault'
        ? 360
        : role === 'goon_support'
          ? 340
          : role === 'goon_marksman'
            ? 290
            : role === 'guard'
              ? 270
              : faction === 'black'
                ? 290
                : faction === 'snipers'
                  ? 260
                  : faction === 'bear' || faction === 'usec' || faction === 'pmc'
                    ? 250
                    : 180;
    const builtLoot = buildBanditLootAndCorpse(faction, role, look, worn, tint, weapon, isGun, mods);
    const wornDirt: Partial<Record<WearSlot, number>> = {};
    for (const slot of WEAR_SLOTS) {
      const st = builtLoot.corpse.slots[slot as CorpseSlotKey];
      if (st?.dirt !== undefined) wornDirt[slot] = st.dirt;
    }

    const initYaw = Math.random() * Math.PI * 2;
    const isProTurn =
      faction === 'bear' ||
      faction === 'usec' ||
      faction === 'pmc' ||
      faction === 'black' ||
      faction === 'boss' ||
      faction === 'snipers' ||
      role === 'guard' ||
      role === 'goon_assault' ||
      role === 'goon_support' ||
      role === 'goon_marksman';
    const maxTurnDeg = isProTurn ? 180 + Math.random() * 60 : 120 + Math.random() * 40;
    const glintMesh =
      role === 'goon_marksman' || spawnKind === 'sniper' ? new Mesh(this.glintGeo, this.glintMat) : null;
    if (glintMesh) {
      glintMesh.visible = false;
      this.w.scene.add(glintMesh);
    }

    const bot: Bandit = {
      id: this.nextId++,
      faction,
      spawnKind,
      role,
      squadId,
      bossId,
      ...(preset ? { bossPresetId: preset.id } : {}),
      pos: new Vector3(rx, sy, rz),
      vel: new Vector3(),
      yaw: initYaw,
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
      aiming: role === 'ambusher' ? 1 : 0,
      aimBlend: role === 'ambusher' ? 1 : 0,
      aimPitch: 0,
      recoilKick: 0,
      swingT: 0,
      crouching: role === 'ambusher',
      crouchBlend: role === 'ambusher' ? 1 : 0,
      healT: 0,
      medkits: faction === 'scavs' ? 0 : role === 'boss' ? 3 : 1,
      doorCd: 0,
      coverX: rx,
      coverZ: rz,
      coverT: 0,
      coverKey: null,
      coverHeight: 1.5,
      peekX: rx,
      peekZ: rz,
      peeksDone: 0,
      moveMode: 'idle',
      adsRaiseT: 0,
      actualSpeed: 0,
      tacticState: 'NONE',
      tacticTimer: 0,
      reloadPushGoalX: rx,
      reloadPushGoalZ: rz,
      reloadPushT: 0,
      sprintBobPhase: Math.random() * Math.PI * 2,
      grenadeCd: role === 'goon_assault' ? 2.5 : 99,
      hasFireToken: true,
      flankSign: Math.random() < 0.5 ? -1 : 1,
      flankT: 0,
      lastHitT: 9,
      ambushTriggered: false,
      navPath: [],
      navIdx: 0,
      navTimer: 0,
      navGoalX: rx,
      navGoalY: sy,
      navGoalZ: rz,
      stuckTimer: 0,
      stuckAnchorX: rx,
      stuckAnchorZ: rz,
      blockedSpots: [],
      glassFlank: Math.random() < 0.35,
      maxTurnRate: (maxTurnDeg * Math.PI) / 180,
      lockedKind: 'none',
      lockedBotId: null,
      lockedZombie: null,
      targetLockT: 0,
      lastAttackerKind: 'none',
      lastAttackerId: null,
      noiseReactT: 0,
      aimPos: new Vector3(rx, sy + 1.35, rz),
      aimPosInit: false,
      aimWarmupT: 0,
      aimShots: 0,
      patrolYaw: initYaw,
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
      glintMesh,
      ragdoll: null,
      ragdollPose: null,
      ragdollDone: false,
      lootDropped: false,
      hit: (dmg, fx, fz, head = false, zone?: HitZone) => this.hit(bot, dmg, fx, fz, head, zone),
    };

    this.buildVisual(bot);
    this.list.push(bot);
    return bot;
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
      crouch: rig.action('crouched_walking'),
    };
    gaits.idle.play();
    gaits.walk.play();
    gaits.run.play();
    gaits.crouch.play();
    gaits.idle.setEffectiveWeight(1);
    gaits.walk.setEffectiveWeight(0);
    gaits.run.setEffectiveWeight(0);
    gaits.crouch.setEffectiveWeight(0);

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
      weights: { idle: 1, walk: 0, run: 0, crouch: 0 },
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
    const factionTone =
      b.faction === 'black'
        ? 0x262930
        : b.faction === 'boss' && b.role === 'boss'
          ? 0xa86460
          : b.faction === 'bear'
            ? 0xced6c0
            : b.faction === 'usec'
              ? 0xc4ccd4
              : 0xffffff;

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
      if (factionTone !== 0xffffff && 'color' in mat && mat.color) {
        mat.color.setHex(factionTone);
      }
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

    b.crouchBlend += ((b.crouching ? 1 : 0) - b.crouchBlend) * (1 - Math.exp(-dt * 9));
    const standW = Math.max(0, 1 - b.crouchBlend);
    const targetIdle = (speed < 0.18 ? 1 : 0) * standW;
    const targetRun = (speed > 2.6 ? 1 : 0) * standW;
    const targetWalk = (speed >= 0.18 && speed <= 2.6 ? 1 : 0) * standW;
    const targetCrouch = b.crouchBlend;

    const k = 1 - Math.exp(-dt * 9);
    v.weights.idle += (targetIdle - v.weights.idle) * k;
    v.weights.walk += (targetWalk - v.weights.walk) * k;
    v.weights.run += (targetRun - v.weights.run) * k;
    v.weights.crouch += (targetCrouch - v.weights.crouch) * k;

    v.gaits.idle.setEffectiveWeight(v.weights.idle);
    v.gaits.walk.setEffectiveWeight(v.weights.walk);
    v.gaits.run.setEffectiveWeight(v.weights.run);
    v.gaits.crouch.setEffectiveWeight(v.weights.crouch);
    v.gaits.walk.setEffectiveTimeScale(speed > 0.18 ? Math.max(0.42, speed / 1.8) : 1);
    v.gaits.run.setEffectiveTimeScale(speed > 2.6 ? Math.max(0.82, speed / 4.2) : 1);
    v.gaits.crouch.setEffectiveTimeScale(speed > 0.16 ? Math.max(0.65, speed / 1.2) : 0);

    v.rig.mixer.update(dt);

    // Blend aim weight smoothly: sprint keeps gun lowered in low-ready (0.66), aim_walk/idle raises into ADS (1.0).
    const wantAim = b.moveMode === 'sprint' ? 0.66 : b.aiming > 0.05 ? 1 : b.isGun ? 0.72 : 0;
    b.aimBlend += (wantAim - b.aimBlend) * (1 - Math.exp(-dt * 11));

    // Pose right & left finger curls.
    const hr = handFrame(v.rig.rig, 'R');
    const hl = handFrame(v.rig.rig, 'L');
    if (hr) {
      const gp = b.isGun ? gripHands(b.weapon as GunId, true, true) : gripHands(b.weapon as HeldId, false, false);
      for (const [idx, q] of hr.poses[gp.R]) v.rig.bones[idx].quaternion.copy(q);
      if (hl && b.isGun) for (const [idx, q] of hl.poses[gp.L]) v.rig.bones[idx].quaternion.copy(q);
    }

    const rest = v.heldObj?.userData.rest as { p: Vector3; q: Quaternion; grip: Vector3 } | undefined;
    if (v.heldObj && rest) {
      v.heldObj.position.copy(rest.p);
      v.heldObj.quaternion.copy(rest.q);
    }

    if (b.isGun && b.aimBlend > 0.02) {
      this.applyTwoHandedGunIK(b, v, hr, hl);
    } else if (!b.isGun && b.aimBlend > 0.02) {
      // Melee attack/ready stance
      v.rig.root.updateMatrixWorld(true);
      const rootQ = v.rig.root.getWorldQuaternion(_q3);
      const swingPhase = b.swingT > 0 ? Math.sin(b.swingT * Math.PI) : 0;
      const shoulder = v.rig.bone('RightArm').getWorldPosition(_pShR);
      const fwd = _fwd.set(0, 0, 1).applyQuaternion(rootQ);
      const right = _right.set(-1, 0, 0).applyQuaternion(rootQ);
      const target = _gripR.copy(shoulder).addScaledVector(fwd, (0.36 + swingPhase * 0.22) * v.scale).addScaledVector(right, 0.08 * v.scale).addScaledVector(_up, (0.04 - swingPhase * 0.28) * v.scale);
      const pole = _poleR.copy(right).multiplyScalar(0.6).addScaledVector(_up, -0.75);
      solveTwoBoneIK(v.rig, 'RightArm', 'RightForeArm', 'RightHand', target, pole, b.aimBlend);
    }
  }

  /** Bladed torso twist (~17°), shoulder-mounted rifle/pistol target, and analytical 2-bone IK for both arms. */
  private applyTwoHandedGunIK(
    b: Bandit,
    v: BanditRigVisual,
    hr: ReturnType<typeof handFrame>,
    hl: ReturnType<typeof handFrame>,
  ): void {
    const r = v.rig;
    const gid = b.weapon as GunId;
    const d = gunRigData(gid);
    const isLong = GUNS[gid].cls === 'long';
    const sc = v.scale;
    const blend = Math.min(1, b.aimBlend);
    const sprinting = b.moveMode === 'sprint';
    const activeAim = sprinting ? 0 : Math.min(1, Math.max(0, (b.aiming - 0.15) / 0.85));
    const sprintPump = sprinting ? Math.sin(b.sprintBobPhase) * 0.045 : 0;
    const lowPitch = sprinting ? -0.54 : -0.38;
    const combatPitch = (b.aimPitch + b.recoilKick * 0.16) * activeAim + lowPitch * (1 - activeAim) + sprintPump;

    // 1. Torso bladed combat twist (~17 deg around +Y, counter-twisted on Neck/Head to keep eyes locked on target).
    const twistRad = (sprinting ? 0.14 : 0.30) * blend;
    r.bone('Spine').quaternion.multiply(_q.setFromAxisAngle(_up, twistRad * 0.34));
    r.bone('Spine1').quaternion.multiply(_q.setFromAxisAngle(_up, twistRad * 0.36));
    r.bone('Spine2').quaternion.multiply(_q.setFromAxisAngle(_up, twistRad * 0.30));
    r.bone('Neck').quaternion.multiply(_q.setFromAxisAngle(_up, -twistRad * 0.55));
    r.bone('Head').quaternion.multiply(_q.setFromAxisAngle(_up, -twistRad * 0.45));
    r.root.updateMatrixWorld(true);

    const rootQ = r.root.getWorldQuaternion(_q3);
    const charRight = _v1.set(-1, 0, 0).applyQuaternion(rootQ).normalize();
    const aimQ = _q4.setFromAxisAngle(charRight, combatPitch).multiply(rootQ).normalize();

    const aimFwd = _fwd.set(0, 0, 1).applyQuaternion(aimQ).normalize();
    const aimRight = _right.set(-1, 0, 0).applyQuaternion(aimQ).normalize();
    const aimUp = _upVec.crossVectors(aimRight, aimFwd).normalize();

    // 2. Shoulder-pocket / chest weapon target anchored to RightArm shoulder
    const shoulderR = r.bone('RightArm').getWorldPosition(_pShR);
    const fwdDist = (isLong ? 0.27 : 0.36) * sc;
    const inwardDist = (isLong ? 0.075 : 0.115) * sc + sprintPump * 0.25 * sc;
    const dropDist = (isLong ? 0.065 : 0.04) * sc + (1 - activeAim) * (sprinting ? 0.145 : 0.10) * sc;

    _gripR
      .copy(shoulderR)
      .addScaledVector(aimFwd, fwdDist)
      .addScaledVector(aimRight, -inwardDist)
      .addScaledVector(aimUp, -dropDist);

    // GunModel barrel (-Zgun) aligned along aimFwd (+Zcharacter) requires aimQ * rotY(PI).
    _qGunW.copy(aimQ).multiply(_qFlipY);
    _v2.copy(d.main.at).applyQuaternion(_qGunW);
    _gunPos.copy(_gripR).sub(_v2);

    // Support hand target: forend/handguard for long guns, support cup on grip for pistols.
    if (isLong) {
      _v2.copy(d.off.at).applyQuaternion(_qGunW);
      _gripL.copy(_gunPos).add(_v2);
    } else {
      _gripL
        .copy(_gripR)
        .addScaledVector(aimFwd, 0.028 * sc)
        .addScaledVector(aimRight, -0.015 * sc)
        .addScaledVector(aimUp, -0.02 * sc);
    }

    // Convert palm grip centers -> wrist joint world targets using HandFrame.grip offset
    _wristR.copy(_gripR);
    _wristL.copy(_gripL);
    if (hr) {
      _qWristR.copy(_qGunW).multiply(d.main.q).multiply(_q.copy(hr.q).invert());
      _wristR.sub(_v2.copy(hr.grip).multiplyScalar(sc).applyQuaternion(_qWristR));
    } else {
      _qWristR.copy(_qGunW);
    }
    if (hl) {
      _qWristL.copy(_qGunW).multiply(d.off.q).multiply(_q.copy(hl.q).invert());
      _wristL.sub(_v2.copy(hl.grip).multiplyScalar(sc).applyQuaternion(_qWristL));
    } else {
      _qWristL.copy(_qGunW);
    }

    // 3. Solve analytical 2-bone IK for both arms with natural downward/outward elbow poles
    _poleR.copy(aimRight).multiplyScalar(0.65).addScaledVector(aimUp, -0.78).addScaledVector(aimFwd, -0.22);
    _poleL.copy(aimRight).multiplyScalar(-0.55).addScaledVector(aimUp, -0.82).addScaledVector(aimFwd, -0.15);

    solveTwoBoneIK(r, 'RightArm', 'RightForeArm', 'RightHand', _wristR, _poleR, blend);
    solveTwoBoneIK(r, 'LeftArm', 'LeftForeArm', 'LeftHand', _wristL, _poleL, blend);

    // 4. Align wrists onto grip axes
    if (hr) slerpBoneWorld(r.bone('RightHand'), r, _qWristR, blend);
    if (hl) slerpBoneWorld(r.bone('LeftHand'), r, _qWristL, blend);

    // 5. Anchor gun mesh squarely inside RightHand world transform with recoil kickback
    if (v.gunModel) {
      r.root.updateMatrixWorld(true);
      const handBone = r.socket('hand');
      const item = v.gunModel.root;
      _m.copy(handBone.matrixWorld).invert();
      _m2.compose(_gunPos, _qGunW, _one);
      _m.multiply(_m2);
      _m.decompose(_v3, _q2, _v2);
      item.position.lerp(_v3, blend);
      item.quaternion.slerp(_q2, blend);
      item.scale.copy(_v2);
    }
  }

  private inFieldOfView(b: Bandit, tx: number, tz: number, halfFovRad = FOV_HALF_RAD): boolean {
    const dx = tx - b.pos.x;
    const dz = tz - b.pos.z;
    if (dx * dx + dz * dz < 1.5 * 1.5) return true;
    return Math.abs(angleDiff(b.yaw, Math.atan2(dx, dz))) <= halfFovRad;
  }

  private canFireAtAngle(b: Bandit, tx: number, tz: number): boolean {
    const dx = tx - b.pos.x;
    const dz = tz - b.pos.z;
    if (dx * dx + dz * dz < 0.04) return true;
    return Math.abs(angleDiff(b.yaw, Math.atan2(dx, dz))) <= FIRE_CONE_RAD;
  }

  private updateAimTrack(b: Bandit, tx: number, ty: number, tz: number, dt: number): void {
    if (!b.aimPosInit) {
      b.aimPos.set(tx, ty - 0.12, tz);
      b.aimPosInit = true;
      return;
    }
    const isElite = b.faction === 'snipers' || b.faction === 'black' || b.role === 'boss';
    const trackRate = isElite ? 7.5 : b.faction === 'bear' || b.faction === 'usec' || b.faction === 'pmc' || b.role === 'guard' ? 6.2 : 5.0;
    const alpha = 1 - Math.exp(-dt * trackRate);
    b.aimPos.lerp(_v3.set(tx, ty, tz), alpha);
  }

  private findNearestHostileBot(b: Bandit, radius: number): Bandit | null {
    let best: Bandit | null = null;
    let bestD2 = radius * radius;
    for (const o of this.list) {
      if (o === b || o.state === 'dead' || o.isDead) continue;
      if (!areFactionsHostile(b.faction, o.faction)) continue;
      if (Math.abs(o.pos.y - b.pos.y) > 4.0) continue;
      const d2 = (o.pos.x - b.pos.x) ** 2 + (o.pos.z - b.pos.z) ** 2;
      if (d2 >= bestD2) continue;
      const inFov =
        this.inFieldOfView(b, o.pos.x, o.pos.z) ||
        d2 < 2.2 * 2.2 ||
        (b.lockedKind === 'bot' && b.lockedBotId === o.id && b.targetLockT > 0);
      if (!inFov) continue;
      if (this.hasLineOfSight(b.pos.x, b.pos.y + 1.48, b.pos.z, o.pos.x, o.pos.y + (o.crouching ? 0.95 : 1.38), o.pos.z)) {
        bestD2 = d2;
        best = o;
      }
    }
    return best;
  }

  private becomeRagdoll(b: Bandit, fromX: number, fromZ: number): void {
    const v = b.visual;
    if (!v) {
      const gy = this.w.groundY(b.pos.x, b.pos.z, b.pos.y);
      b.root.rotation.set(-Math.PI / 2, b.yaw, 0);
      b.root.position.set(b.pos.x, gy + 0.05, b.pos.z);
      return;
    }

    if (v.heldObj) {
      v.heldObj.removeFromParent();
      v.heldObj = null;
    }

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
    const boxes: NavBox[] = [];
    this.w.boxesNear(b.pos.x, b.pos.z, 1.8, boxes);
    const killer = new Vector3(fromX, b.pos.y, fromZ);
    const rd = playerRagdoll(
      b.pos,
      b.yaw + Math.PI,
      v.scale,
      b.vel,
      killer,
      boxes,
      Math.random,
      st.shape,
      (gx, gz, gy) => this.w.groundY(gx, gz, gy),
    );
    const pose = new RagdollPose(v.body, 1, rig.rig, world, rd, v.scale);
    this.w.addRagdoll(rd);
    b.ragdoll = rd;
    b.ragdollPose = pose;
    b.ragdollDone = false;
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
    this.releaseCover(b);
    if (b.glintMesh) this.w.scene.remove(b.glintMesh);
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
    this.w.shatterWindowNear?.(b.pos.x, b.pos.y, b.pos.z, 0.48, nx, nz);
    this.w.resolveCircle(b.pos, 0.34);
    b.pos.y = this.w.groundY(b.pos.x, b.pos.z, b.pos.y);
  }

  hasLineOfSight(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): boolean {
    _v1.set(tx - ox, ty - oy, tz - oz);
    const len = _v1.length();
    if (len < 0.1) return true;
    _v1.divideScalar(len);
    // Opaque walls, slabs, closed wood/lab doors, and vehicles block LOS.
    const hit = this.w.rayHit(ox, oy, oz, _v1.x, _v1.y, _v1.z, len, true);
    if (hit >= 0 && hit < len - 0.04) return false;
    // Closed doors of ANY style (including intact glass entrance doors) also block LOS; window glass panes stay see-through.
    if (this.w.rayHitDetail) {
      const solid = this.w.rayHitDetail(ox, oy, oz, _v1.x, _v1.y, _v1.z, len, false);
      if (solid && solid.door && solid.t < len - 0.04) return false;
    }
    return true;
  }

  private findNearestZombie(b: Bandit, radius: number) {
    let best = null;
    let bestD2 = radius * radius;
    for (const zmb of this.w.zombies.list) {
      if (zmb.state === 'dead' || Math.abs(zmb.pos.y - b.pos.y) > 2.5) continue;
      const d2 = (zmb.pos.x - b.pos.x) ** 2 + (zmb.pos.z - b.pos.z) ** 2;
      if (d2 >= bestD2) continue;
      const inFov =
        this.inFieldOfView(b, zmb.pos.x, zmb.pos.z) ||
        d2 < 2.5 * 2.5 ||
        (b.lockedKind === 'zombie' && b.lockedZombie === zmb && b.targetLockT > 0);
      if (!inFov) continue;
      if (this.hasLineOfSight(b.pos.x, b.pos.y + 1.45, b.pos.z, zmb.pos.x, zmb.pos.y + 1.2, zmb.pos.z)) {
        bestD2 = d2;
        best = zmb;
      }
    }
    return best;
  }

  private shootAt(
    b: Bandit,
    tx: number,
    ty: number,
    tz: number,
    targetIsPlayer: boolean,
    inCar = false,
    targetBot: Bandit | null = null,
    suppressive = false,
    playerCrouched = false,
  ): void {
    // Hard physical rule: never shoot in sprint, while raising weapon into ADS, or moving faster than tactical ADS walk.
    if (b.moveMode === 'sprint' || b.adsRaiseT > 0 || b.aiming < 0.45 || b.actualSpeed > BOT_ADS_SPEED + 0.25) return;

    const gId = b.weapon as BanditGunId;
    const g = GUNS[gId];
    const oy = b.pos.y + (b.crouching ? 1.02 : 1.42);
    const dirX = Math.sin(b.yaw);
    const dirZ = Math.cos(b.yaw);
    // Abort shot if wall/door presses right up against the barrel (cannot poke muzzle through walls/doors).
    const approxDist = Math.hypot(tx - b.pos.x, tz - b.pos.z);
    const muzzleAdv = Math.min(0.32, Math.max(0.05, approxDist * 0.35));
    const muzzleProbe = this.w.rayHit(b.pos.x, oy, b.pos.z, dirX, 0, dirZ, 0.36, false);
    if (muzzleProbe >= 0 && muzzleProbe < muzzleAdv + 0.02) return;
    const ox = b.pos.x + dirX * muzzleAdv;
    const oz = b.pos.z + dirZ * muzzleAdv;

    const rawAimX = b.aimPosInit ? b.aimPos.x : tx;
    const rawAimY = (b.aimPosInit ? b.aimPos.y : ty) + (b.aimShots < 2 ? -0.14 : 0);
    const rawAimZ = b.aimPosInit ? b.aimPos.z : tz;

    // Never fire sideways: barrel yaw must align within +/-11 deg of target before trigger pull
    if (!this.canFireAtAngle(b, tx, tz) || !this.canFireAtAngle(b, rawAimX, rawAimZ)) return;
    // Strict LOS check to both actual target and lagged aim point so stale aim never wallbangs
    if (!this.hasLineOfSight(b.pos.x, oy, b.pos.z, tx, ty, tz)) return;
    if (!this.hasLineOfSight(ox, oy, oz, rawAimX, rawAimY, rawAimZ)) return;

    _to.set(rawAimX - ox, rawAimY - oy, rawAimZ - oz);
    const targetDist = _to.length() || 1;
    _to.divideScalar(targetDist);

    const isEliteAim =
      b.faction === 'snipers' ||
      b.faction === 'black' ||
      b.role === 'boss' ||
      b.role === 'ambusher' ||
      b.role === 'goon_assault' ||
      b.role === 'goon_marksman';
    const isTactical = b.faction === 'bear' || b.faction === 'usec' || b.faction === 'pmc' || b.role === 'guard' || b.role === 'goon_support';
    const baseSpread =
      b.faction === 'snipers' || b.role === 'goon_marksman'
        ? 0.028
        : isEliteAim
          ? gId === 'shotgun_pump'
            ? 0.075
            : 0.038
          : isTactical
            ? gId === 'shotgun_pump'
              ? 0.095
              : 0.055
            : gId === 'shotgun_pump'
              ? 0.115
              : 0.078;
    // EFT accuracy warm-up: opening 1-2 sighting shots have wider spread before tightening on sustained sight
    const warmupMul =
      b.aimShots === 0
        ? 1.75
        : b.aimShots === 1
          ? 1.35
          : Math.max(1.0, 1.15 - Math.min(1, b.aimWarmupT / 2.0) * 0.15);
    const bushPenalty = this.w.bushOccludes?.(ox, oy, oz, rawAimX, rawAimY, rawAimZ) ? 1.85 : 1;
    const spread = baseSpread * warmupMul * bushPenalty * (suppressive ? 2.0 : 1);
    _to.x += (Math.random() - 0.5) * spread;
    _to.y += (Math.random() - 0.5) * spread * 0.65;
    _to.z += (Math.random() - 0.5) * spread;
    _to.normalize();

    const maxRange = b.role === 'goon_marksman' || b.spawnKind === 'sniper' ? 92 : 48;
    const solidDetail = this.w.rayHitDetail?.(ox, oy, oz, _to.x, _to.y, _to.z, maxRange, false) ?? null;
    const solidWall = solidDetail ? solidDetail.t : this.w.rayHit(ox, oy, oz, _to.x, _to.y, _to.z, maxRange, false);
    const opaqueWall = this.w.rayHit(ox, oy, oz, _to.x, _to.y, _to.z, maxRange, true);
    const doorBlocked = !!solidDetail && solidDetail.door && solidDetail.t >= 0;
    const shotGlass = !doorBlocked && solidWall >= 0 && (opaqueWall < 0 || solidWall < opaqueWall - 0.04);
    let maxTrace = opaqueWall >= 0 ? opaqueWall : maxRange;
    if (doorBlocked) maxTrace = Math.min(maxTrace, solidDetail!.t);

    let hitDist = maxTrace;
    let entityHitDist = Infinity;

    if (targetBot && !targetBot.isDead) {
      const hitRes = this.hitTest(_v2.set(ox, oy, oz), _to, maxTrace, 0.05, b);
      if (hitRes && areFactionsHostile(b.faction, hitRes.bot.faction)) {
        hitDist = hitRes.dist;
        entityHitDist = hitRes.dist;
        const dmg = (g.damage[0] + g.damage[1]) * 0.42 * (shotGlass && hitRes.dist > solidWall ? 0.92 : 1);
        this.hit(hitRes.bot, dmg, ox, oz, hitRes.head, hitRes.zone, 'bot', b.id);
      }
    } else if (targetIsPlayer) {
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
          const hitX = ox + _to.x * proj;
          const hitY = oy + _to.y * proj;
          const hitZ = oz + _to.z * proj;
          if (this.hasLineOfSight(ox, oy, oz, px, hitY, pz) && this.hasLineOfSight(hitX, hitY, hitZ, px, hitY, pz)) {
            hitDist = proj;
            entityHitDist = proj;
            const centerOff = inCar ? 1.05 : playerCrouched ? 0.92 : 1.38;
            const playerFeetY = ty - centerOff;
            const relY = hitY - playerFeetY;
            const headCut = playerCrouched ? 0.98 : 1.44;
            const torsoCut = playerCrouched ? 0.52 : 0.78;
            const hitZone: HitZone = relY >= headCut ? 'head' : relY >= torsoCut ? 'torso' : 'limbs';
            const rawDmg = (g.damage[0] + g.damage[1]) * (b.role === 'boss' ? 0.28 : 0.24) * (shotGlass && proj > solidWall ? 0.92 : 1);
            this.w.hurtPlayer(Math.max(6, Math.min(26, rawDmg)), b.pos.x, b.pos.z, 'Пулевое ранение от бандита', hitZone);
          }
        }
      }
    } else {
      const zh = this.w.zombies.hitTest(_v2.set(ox, oy, oz), _to, maxTrace, 0.05);
      if (zh) {
        hitDist = zh.dist;
        entityHitDist = zh.dist;
        const dmg = g.damage[0] * 0.85 * (shotGlass && zh.dist > solidWall ? 0.92 : 1);
        this.w.zombies.hit(zh.zombie, dmg, ox, oz, zh.head, zh.point);
      }
    }

    if (shotGlass && solidWall <= entityHitDist + 0.05) {
      const gAt = new Vector3(ox + _to.x * solidWall, oy + _to.y * solidWall, oz + _to.z * solidWall);
      const handled =
        solidDetail && solidDetail.glass && !solidDetail.door && this.w.onWindowBullet
          ? this.w.onWindowBullet(solidDetail.owner, gAt, _to.clone(), solidDetail.nx, solidDetail.ny, solidDetail.nz)
          : false;
      if (!handled) this.w.onBreakGlass?.(gAt, _to.clone());
      // Finish the firing burst through the freshly shattered window before displacing into cover.
      if (b.tacticState === 'NONE') {
        b.tacticState = 'PEEK_AND_SHOOT';
        b.tacticTimer = 1.1;
        b.peekX = b.pos.x;
        b.peekZ = b.pos.z;
      }
    }

    const muzzleOff = Math.min(0.32, hitDist * 0.4);
    this.spawnTracer(ox + _to.x * muzzleOff, oy + _to.y * muzzleOff, oz + _to.z * muzzleOff, _to.x, _to.y, _to.z, Math.max(0.2, Math.min(hitDist - muzzleOff, 32)));
    b.recoilKick = 1;
    const suppressed = b.mods.includes('mod_suppressor');
    sfx.gunShot(GUN_SOUND[gId], b.pos, suppressed, this.w.placeAt(b.pos.x, b.pos.z));
    this.w.noise(b.pos.x, b.pos.y, b.pos.z, suppressed ? 18 : g.noise * 0.85);

    b.aimShots++;
    b.ammoInMag--;
    b.burstLeft--;
    if (b.ammoInMag <= 0) {
      b.reloadT = 2.2;
    } else if (b.burstLeft <= 0) {
      b.burstLeft = b.role === 'goon_support' ? 4 + Math.floor(Math.random() * 4) : 2 + Math.floor(Math.random() * 3);
      b.burstPause =
        b.role === 'goon_support'
          ? 0.28 + Math.random() * 0.25
          : b.faction === 'black' || b.role === 'boss'
            ? 0.45 + Math.random() * 0.35
            : 0.65 + Math.random() * 0.45;
    } else {
      b.fireCd = Math.max(0.16, 60 / Math.min(300, g.rpm));
    }
  }

  private releaseCover(b: Bandit): void {
    if (b.coverKey) {
      if (this.coverClaims.get(b.coverKey) === b.id) this.coverClaims.delete(b.coverKey);
      b.coverKey = null;
    }
  }

  private getSquad(squadId: number): SquadBlackboard {
    let bb = this.squads.get(squadId);
    if (!bb) {
      bb = { lastX: 0, lastY: 0, lastZ: 0, lastT: 0, tokens: [], grenadeCd: 0 };
      this.squads.set(squadId, bb);
    }
    return bb;
  }

  /** Maintains shared squad target memory and enforces <= 2 simultaneous aimed shooters per squad. */
  private updateSquadBlackboards(dt: number): void {
    const aliveIds = new Set<number>();
    const bySquad = new Map<number, Bandit[]>();
    for (const b of this.list) {
      if (b.isDead || b.state === 'dead') continue;
      aliveIds.add(b.id);
      let arr = bySquad.get(b.squadId);
      if (!arr) {
        arr = [];
        bySquad.set(b.squadId, arr);
      }
      arr.push(b);
    }
    for (const [sid, bb] of this.squads) {
      bb.lastT = Math.max(0, bb.lastT - dt);
      bb.grenadeCd = Math.max(0, bb.grenadeCd - dt);
      bb.tokens = bb.tokens.filter((id) => aliveIds.has(id));
      if (!bySquad.has(sid)) {
        this.squads.delete(sid);
        continue;
      }
      const members = bySquad.get(sid)!;
      const maxTokens = Math.min(2, members.length);
      const activeTokens = new Set<number>(bb.tokens.slice(0, maxTokens));
      // Fill remaining fire token slots (prioritize boss/marksman/ambusher, then shooters ready in combat).
      if (activeTokens.size < maxTokens) {
        const ranked = members
          .filter((m) => m.state === 'combat' && m.reloadT <= 0 && m.healT <= 0 && !activeTokens.has(m.id))
          .sort((a, b) => {
            const pA = a.role === 'boss' || a.role === 'goon_marksman' || a.role === 'ambusher' ? 0 : 1;
            const pB = b.role === 'boss' || b.role === 'goon_marksman' || b.role === 'ambusher' ? 0 : 1;
            return pA - pB;
          });
        for (const m of ranked) {
          if (activeTokens.size >= maxTokens) break;
          activeTokens.add(m.id);
        }
      }
      bb.tokens = [...activeTokens];
      for (const m of members) m.hasFireToken = activeTokens.has(m.id) || members.length === 1;
    }
    for (const [key, ownerId] of this.coverClaims) {
      if (!aliveIds.has(ownerId)) this.coverClaims.delete(key);
    }
  }

  /** Enforces >= 3.8–4.5 m ally combat spacing and >= 1.1 m hard anti-overlap so squads spread out naturally. */
  private applySeparation(dt: number): void {
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const a = this.list[i];
      if (a.isDead || a.state === 'dead') continue;
      if (a.role === 'ambusher' && !a.ambushTriggered) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.list[j];
        if (b.isDead || b.state === 'dead') continue;
        if (b.role === 'ambusher' && !b.ambushTriggered) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 2.2) continue;
        const dx = a.pos.x - b.pos.x;
        const dz = a.pos.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        const sameTeam = !areFactionsHostile(a.faction, b.faction);
        const minSep = sameTeam ? (a.state === 'combat' || b.state === 'combat' ? 4.2 : 2.6) : 1.05;
        if (d >= minSep) continue;
        const nx = d > 0.01 ? dx / d : (i % 2 === 0 ? 1 : -1);
        const nz = d > 0.01 ? dz / d : (j % 2 === 0 ? 1 : -1);
        const push = Math.min(1.6 * dt, (minSep - d) * 0.5 * Math.min(1, dt * 3.5));
        if (push > 1e-4) {
          this.stepBandit(a, nx, nz, push);
          this.stepBandit(b, -nx, -nz, push);
        }
      }
    }
  }

  private throwGrenade(b: Bandit, tx: number, ty: number, tz: number): void {
    const start = new Vector3(b.pos.x, b.pos.y + 1.55, b.pos.z);
    const dur = 1.05;
    const vx = (tx - start.x) / dur;
    const vz = (tz - start.z) / dur;
    const vy = (ty + 0.1 - start.y + 0.5 * 9.8 * dur * dur) / dur;
    const mesh = new Mesh(this.grenadeGeo, this.grenadeMat);
    mesh.position.copy(start);
    this.w.scene.add(mesh);
    this.grenades.push({ pos: start, vel: new Vector3(vx, vy, vz), fuse: 1.45, mesh });
    sfx.swing('heavy', 0.35, b.pos);
    this.w.toast?.(tr('Боец: «Граната пошла!»', 'Goon: "Frag out!"'), 1600);
  }

  private updateGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.fuse -= dt;
      g.vel.y -= 9.8 * dt;
      const step = g.vel.length() * dt;
      if (step > 0.01) {
        _v1.copy(g.vel).divideScalar(step / dt);
        const hit = this.w.rayHit(g.pos.x, g.pos.y, g.pos.z, _v1.x, _v1.y, _v1.z, step);
        if (hit >= 0) {
          g.pos.addScaledVector(_v1, Math.max(0, hit - 0.05));
          g.vel.multiplyScalar(0.35);
          g.vel.y = Math.abs(g.vel.y) * 0.45;
        } else {
          g.pos.addScaledVector(g.vel, dt);
        }
      }
      const gy = this.w.groundY(g.pos.x, g.pos.z, g.pos.y);
      if (g.pos.y < gy + 0.08) {
        g.pos.y = gy + 0.08;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
      }
      g.mesh.position.copy(g.pos);
      if (g.fuse <= 0) {
        const at = g.pos.clone();
        this.w.scene.remove(g.mesh);
        this.grenades.splice(i, 1);
        this.w.explode?.(at, { radius: 6.5, damage: 95, impulse: 3, noise: 60, selfDamage: 75, shrapnel: 24 });
      }
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
