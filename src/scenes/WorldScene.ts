import { coverBody, wornGear } from '../characters/gear';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  FloatType,
  Fog,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Quaternion,
  RGBAFormat,
  Scene,
  SkinnedMesh,
  Sphere,
  type Texture,
  Vector3,
} from 'three';
import { bodyAsset, hasBody } from '../characters/assets';
import { characterMaterial, LENS_TINT } from '../characters/material';
import { CharacterRig } from '../characters/rig';
import { AnxietyAudio } from '../audio/AnxietyAudio';
import { type FleshBlow, type Gait, sfx, type StepSurface } from '../audio/Sound';
import { langToggle, onLangChange, tr } from '../core/i18n';
import { FLOOR_H, inStairCore } from '../world/gen/highrise';
import { BAND, CHUNK, DOWNTOWN_RADIUS, ROAD_HALF } from '../world/gen/layout';
import { type SceneKind, sceneAt } from '../world/gen/chaos';
import { type ItemId, type ItemStack, WEAR_SLOTS, type WearSlot, wornStat } from '../data/items';
import type { Worn } from '../systems/Inventory';
import type { GameContext } from '../GameContext';
import { type ClassId, classDef, classMods, type ClassMods, DEFAULT_CLASS } from '../data/classes';
import { sanitizeTraits, type TraitId, traitLearn, withTraits } from '../data/traits';
import { Hordes } from '../systems/Hordes';
import { MAP_SEEN, MapMemory } from '../systems/MapMemory';
import { Base, BASE, type Placed, type PlacedKind } from '../systems/Base';
import { BaseProps } from '../world/BaseProps';
import { MapPanel } from '../ui/MapPanel';
import { WorldEditor } from '../editor/WorldEditor';
import { gridSchedule, type GridSchedule, TAP_DRINK } from '../systems/Utilities';
import { describeXp, emptyMeta, type MetaData, SKILLS, Skills, weaponSkill, XP } from '../systems/Skills';
import { BACKPACK_CAPACITY, ITEMS } from '../data/items';
import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from '../player/appearance';
import { type CharacterChoice, CharacterEditor, choiceTint, choiceWorn } from '../ui/CharacterEditor';
import { Player } from '../player/Player';
import { Firearms } from '../systems/Firearms';
import { applyZonalArmor } from '../systems/Armor';
import { BANDIT_BODY_ID, Bandits } from '../systems/Bandits';
import { GunHud } from '../ui/GunHud';
import { isGun } from '../weapons/guns';
import type { EchoPlace } from '../audio/Sound';
import type { RightItem } from '../player/Viewmodel';
import { setSubCellSplit } from '../render/batchMeshes';
import { bladeMaterial, characterMaterial as lookCharacterMaterial } from '../render/look/materials';
import { BUCKETS } from '../render/look/surfaces';
import { worldMaterials } from '../render/look/worldMaterials';
import { buildWeapon, weaponHighlightMaterial, weaponMesh } from '../weapons/buildWeapon';
import { airTemperature, Clock, feltTemperature, Shelters } from '../systems/Climate';
import { dirtSteps, soilClothes } from '../systems/Dirt';
import { Containers } from '../systems/Containers';
import { weaponOf } from '../weapons/config';
import { GroundWeapons } from '../weapons/GroundWeapons';
import { Interaction } from '../systems/Interaction';
import { Inventory, type InventoryData } from '../systems/Inventory';
import { SaveGame } from '../systems/SaveGame';
import { StorySystem } from '../systems/Story';
import { Helicopter } from '../systems/Helicopter';
import { Tripwires } from '../systems/Tripwires';
import { Vehicles } from '../systems/Vehicles';
import { CarHud } from '../ui/CarHud';
import { HeliHud } from '../ui/HeliHud';
import { type BodyPart, PART_NAMES, Survival } from '../systems/Survival';
import { InventoryPanel } from '../ui/InventoryPanel';
import { ChunkManager } from '../world/ChunkManager';
import { Doors } from '../world/Doors';
import { Interiors } from '../world/Interiors';
import { WorldLife } from '../world/WorldLife';
import { Sky } from '../world/Sky';
import { CollisionWorld } from '../world/CollisionWorld';
import { WorldLayout } from '../world/gen/layout';
import type { IScene } from './IScene';
import { ZombieModels } from '../render/ZombieModels';
import { type ModelKind, ZOMBIE_STATS } from '../zombies/stats';
import { twinKind, zombieKindAt } from '../world/zombieKinds';
import { zombieRagdoll } from '../render/zombieBody';
import { PART, type Ragdoll, Ragdolls, type StaticBox } from '../physics/ragdoll';
import type { SearchBox } from '../world/gen/pieces';
import { PlayerDeath } from '../player/PlayerDeath';
import { deathSurroundings, type DeathSurroundings } from '../player/DeathCamera';
import { blowDamage, type PlayerSense, type Zombie, ZombieSim } from '../systems/zombies';
import { Ground } from '../render/Foliage';
import { Particles } from '../render/Particles';
import { Atmosphere } from '../world/Atmosphere';
import { rollLoot } from '../data/loot';
import { ATMO } from '../world/atmoConfig';
import { Weather } from '../world/Weather';
import { Pois } from '../world/Pois';
import { GlbPropPool } from '../world/GlbPropPool';
import { FarSmoke } from '../render/FarSmoke';
import { Landmarks } from '../render/Landmarks';
import { nearestPoi, POI, type PoiKind, siteToWorld } from '../world/gen/poi';
import { LAB_EMERGENCY, LAB_H, LAB_LIGHTS, LAB_SPARKS } from '../world/gen/poiLab';
import { LIFE } from '../world/gen/lifeKinds';
import { labCode } from '../world/gen/scenarios';
import { NOTE_VARS } from '../data/items';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FISTS, HELD as HELD_CFG, type HeldId } from '../player/held';
import { giveLoadout } from '../weapons/give';
import { routeHighrise } from '../world/gen/highrise';
import type { DoorRef } from '../world/Doors';
import type { ContainerRef } from '../systems/Containers';
import type { TwinRecord } from '../systems/SaveGame';
import { GrimFog } from '../render/GrimFog';
import { DAY, NIGHT } from '../style/stage';
import { flashlightMaterial, lensMaterial } from '../items/flashlight';
import { QUALITY_PRESETS } from '../render/QualityPresets';

// Day and night light (style/stage, CLAUDE.md «Визуальный стиль»): an overcast cold day — a grey sky
// hemisphere over dark earth, a weak cold sun, grey exponential fog; at night a floor of light, a weak cold
// moon for silhouettes and roof lines — everything else is the flashlight.

const DEFAULT_SEED = 1993;
const _dayColor = new Color();
const _indoorHaze = new Color(0x0b0b0c);
/** Loose-container ids of zombie bodies (above every chunk and interior id). */
const ZOMBIE_BODY_ID = 3e14;

/** The block a point is on ("i,j"). */
function blockKey(x: number, z: number): string {
  return `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
}

/** Edges of turned boxes (centre, half sizes, yaw) as line segments; one unit box when scaled by the outline. */
function boxEdges(boxes: SearchBox[]): BufferGeometry {
  const pos: number[] = [];
  const E = [
    [0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [cx, cy, cz, hx, hy, hz, yaw] of boxes) {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    const corner = (k: number) => {
      const u = k & 1 ? hx : -hx;
      const v = k & 2 ? hz : -hz;
      const y = k & 4 ? hy : -hy;
      return [cx + u * c + v * sn, cy + y, cz - u * sn + v * c];
    };
    for (const [a, b] of E) pos.push(...corner(a), ...corner(b));
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

/** A body's search zone: a box along it (feet to head), round its parts. */
function bodyBox(rd: Ragdoll): SearchBox {
  const P = rd.poses;
  const feet = P[PART.shinL].p.clone().add(P[PART.shinR].p).multiplyScalar(0.5);
  const ax = P[PART.head].p.x - feet.x;
  const az = P[PART.head].p.z - feet.z;
  const yaw = Math.atan2(-az, ax);
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const { p } of P) {
    const u = p.x * c - p.z * sn;
    const v = p.x * sn + p.z * c;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  const um = (u0 + u1) / 2;
  const vm = (v0 + v1) / 2;
  // Back from the turned frame: x = u·cos + v·sin, z = −u·sin + v·cos.
  return [um * c + vm * sn, (y0 + y1) / 2, -um * sn + vm * c, (u1 - u0) / 2 + 0.18, (y1 - y0) / 2 + 0.14, (v1 - v0) / 2 + 0.16, yaw];
}
const _sunDir = new Vector3();
const _sunColor = new Color();
/** The world-life key of the powered labs' emergency lights and sparks (no chunk has it). */
const LAB_FX_KEY = 2 ** 40;
function stashRef(p: Placed): ContainerRef {
  return { id: BASE.stashIds + p.id, type: 'stash', x: p.x, z: p.z, y: p.y, zone: 'town', box: [p.x, p.y + 0.28, p.z, 0.5, 0.3, 0.32, p.yaw] };
}

/** The base's fires in the world's flames, glow and crackle (WorldLife / Atmosphere). */
const BASE_FX_KEY = 2 ** 40 + 1;
/** While the game is being made (the dev server): no carry limit; `?weight=1` brings it back to check it. */
Inventory.noOverload = import.meta.env.DEV && new URLSearchParams(location.search).get('weight') !== '1';

/** Asleep the clock runs this many game minutes per real second (a night in ~40 s). */
const SLEEP_RATE = 12;
const _zs: PlayerSense = { pos: new Vector3(), eye: 1.6, noise: 0, crouched: false, lit: 0, daylight: 0 };
const _zView = new Vector3();
/** How each weapon's blow on a body sounds. */
const STRIKE_SOUND: Record<string, FleshBlow> = { axe: 'chop', knife: 'stab', fists: 'fist', bat: 'blunt', hammer: 'metal', crowbar: 'metal' };
const _so = new Vector3();
const _sd = new Vector3();
const _wallHit = new Vector3();
const BASE_VFOV = 75;
const MAX_HFOV = 100;
/** Door sets: interiors use building ids (positive); a chunk's entrance doors use negative keys. */
const entranceKey = (chunkKey: number) => -1 - chunkKey;
/** Sidewalk of the road along z = 0 in the heart of downtown, looking down the street. */
const SPAWN = new Vector3(20, 0, 4.6);
const SPAWN_YAW = -Math.PI / 2;
const AUTOSAVE_INTERVAL = 20;
/** Fresh survivor: hoodie, jeans, sneakers, the kitchen knife, a little water, a half-dead flashlight. */
const START_KIT: InventoryData & { battery: number } = {
  stacks: [
    ['water', 1],
    ['chocolate', 1],
  ],
  hand: 'knife',
  worn: { head: null, torso: 'hoodie', legs: 'jeans', feet: 'sneakers', back: 'backpackSchool' },
  battery: 0.6,
};
/** Hand items with a first-person model. */
const HELD: Partial<Record<ItemId, RightItem>> = { knife: 'knife', axe: 'axe', bat: 'bat', crowbar: 'crowbar', hammer: 'hammer' };

/** The procedural, endless world: chunks stream around the player from a seed (?seed=…). */
export class WorldScene implements IScene {
  readonly scene = new Scene();
  // Near 0.1 m (the body keeps the eye 0.3 m off walls): twice the depth precision of 0.05 on phones.
  readonly camera = new PerspectiveCamera(BASE_VFOV, 1, 0.08, 120);
  overlay?: { scene: Scene; camera: PerspectiveCamera };

  private ctx!: GameContext;
  private player!: Player;

  /** The first-person arms (?animdebug). */
  get viewmodel(): Player['viewmodel'] {
    return this.player.viewmodel;
  }
  private chunks!: ChunkManager;
  private readonly world = new CollisionWorld();
  private readonly lookDir = new Vector3();
  private readonly unsubs: (() => void)[] = [];
  private readonly survival = new Survival();
  private readonly inventory = new Inventory();
  private containers!: Containers;
  /** Weapons lying about, picked up with E (weapons/GroundWeapons). */
  private ground!: GroundWeapons;
  private interaction!: Interaction;
  private panel!: InventoryPanel;
  /** The paper map and what this survivor has seen of the world. */
  private readonly mapMemory = new MapMemory();
  private mapPanel!: MapPanel;
  private mapTimer = 0;
  /** What was built: fires, rain collectors, chests, tripwires. */
  private readonly base = new Base();
  private readonly baseProps = new BaseProps(this.base);
  private baseT = 0;
  private baseClock = -1;
  private baseFx = -1;
  /** Asleep: in a bed or not, the overlay. */
  private sleeping: { bed: boolean; el: HTMLDivElement } | null = null;
  private saves!: SaveGame;
  private story!: StorySystem;
  private vehicles!: Vehicles;
  private helicopter!: Helicopter;
  private heliHud!: HeliHud;
  private bandits!: Bandits;
  private tripwires!: Tripwires;
  private ambushScanT = 0;
  private carHud!: CarHud;
  private interiors!: Interiors;
  private doors!: Doors;
  private saveT = 0;
  private moodleT = 0;
  private readonly clock = new Clock();
  private ambient!: HemisphereLight;
  private moon!: DirectionalLight;
  private lightKey = -1;
  /** Ambient light from the hour (a lightning flash adds to it); fog's reach as a share of the preset's. */
  private ambientBase = 0;
  private fogK = 1;
  /** 0 outdoors … 1 inside: the haze inside a building is dark, not the bright sky's. */
  private indoorK = 0;
  private weather!: Weather;
  /** Unique places: their zombies when you come near (none with ?zombies=0). */
  private pois: Pois | null = null;
  private landmarks!: Landmarks;
  private farSmoke!: FarSmoke;
  private noteT = 0;
  private readonly shelters = new Shelters();
  private dread!: AnxietyAudio;
  /** Lit windows, dying lamps, curtains, paper in the wind, alarms, radios. */
  private life!: WorldLife;
  /** Clouds and the occasional plane / helicopter overhead. */
  sky!: Sky;
  private indoors = false;
  private air = 0;
  private felt = 0;
  private climateT = 0;
  /** Turn-in-place foot-pivot detector state. */
  private turnYawAccum = 0;
  private turnWindowT = 0;
  private turnCd = 0;
  private prevTurnYaw = 0;
  private turnInited = false;
  private readonly _surfOrig = new Vector3();
  private readonly _surfDown = new Vector3(0, -1, 0);
  private lastValidSurface: StepSurface = 'asphalt';
  private layout!: WorldLayout;
  private zombies!: ZombieSim;
  /** Every zombie, living and dead: the procedural models, batched per type, up to the fog. */
  private models!: ZombieModels;
  /** The dead: physics ragdolls (a few awake at once) driving their models' bones. */
  private readonly ragdolls = new Ragdolls();
  private readonly corpseRd = new Map<Zombie, Ragdoll>();
  /** Labs whose generator runs (block "i,j"; saved) and the glowing ceiling panels of those rooms. */
  private readonly powered = new Set<string>();
  private labPanels: Mesh | null = null;
  /** A faint outline round the container under the crosshair; ?interactdebug=1 draws every search zone. */
  private readonly searchOutline = new LineSegments(boxEdges([[0, 0, 0, 0.5, 0.5, 0.5, 0]]), new LineBasicMaterial({ color: 0xe8dcb0, transparent: true, opacity: 0.32 }));
  private zoneDebug: LineSegments | null = null;
  private zoneDebugT = 0;
  private editor!: WorldEditor;
  /** The player's death (ragdoll, camera) once it happened. */
  private death: PlayerDeath | null = null;
  private deathShown = false;
  /** ?die=1: die this many seconds in. ?zdebug=1: the zombie in front (K kills it / brings another). */
  private debugDieT = new URLSearchParams(location.search).get('die') === '1' ? 1.2 : -1;
  private debugZombie: Zombie | null = null;
  private debugSpawnT = new URLSearchParams(location.search).get('zdebug') === '1' ? 1 : -1;
  /** Visible dirt steps of the worn clothes, to re-dress the body only when a step changes. */
  private dirtShown = '';
  /** Who the survivor is: looks and former job (class). */
  private look: Appearance = { ...DEFAULT_APPEARANCE };
  private classId: ClassId = DEFAULT_CLASS;
  private traits: TraitId[] = [];
  /** What the survivor learnt by doing; and what outlives them (the legacy, deaths, kills). */
  private readonly skills = new Skills();
  private meta: MetaData = emptyMeta();
  /** When the city's power and water go (by the seed), and whether they are on now (null: not set yet). */
  private grid!: GridSchedule;
  private gridState: { power: boolean; water: boolean } | null = null;
  /** The groups out on the map that come to noise (`?hordes=0`: none). */
  private readonly hordes = new Hordes(Date.now() & 0xffff);
  private readonly hordesOn = new URLSearchParams(location.search).get('hordes') !== '0';
  /** The player's noise reaches the groups at most this often, s. */
  private hordeEar = 0;
  /** No save was found: a new game asks for a character first. */
  private isNewGame = true;
  private playerArmed = false;
  private readonly particles = new Particles();
  /** Guns in the hands: shots, noise, the RPG's blast. */
  private firearms!: Firearms;
  private gunHud!: GunHud;
  /** Where the last hurt came from (the HUD's hit-direction mark), and when (world seconds ago). */
  hitFrom: Vector3 | null = null;
  hitFromT = 9;
  /** Cars set on fire by a blast: their fire spots and how long they still burn. */
  private carFires: { key: number; t: number }[] = [];
  private carFireN = 0;
  private atmo!: Atmosphere;
  private glbPool!: GlbPropPool;
  /** Dead survivors walking (saved until killed), and the bodies they left with their things. */
  private twins: TwinRecord[] = [];
  private bodies: ContainerRef[] = [];
  private dead = false;
  private deathCause = '';
  /** In-game minute this survivor started. */
  private bornAt = 0;
  private readonly twinZombies = new Map<number, Zombie>();
  /** The editor is open: nothing to save yet (hiding the tab must not save a default survivor). */
  private creating = false;
  private bootMsaa = false;
  private prewarming = false;
  private readonly pinnedMaterials: Material[] = [];
  private readonly pinnedTextures: Texture[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.bootMsaa = ctx.quality.preset.msaa > 0;
    this.scene.background = new Color(NIGHT.sky);
    this.scene.fog = new GrimFog(NIGHT.sky, NIGHT.fogNear, ctx.quality.preset.fogFar);
    this.ambient = new HemisphereLight(NIGHT.hemi.sky, NIGHT.hemi.ground, NIGHT.hemi.intensity);
    this.scene.add(this.ambient);
    const moon = new DirectionalLight(NIGHT.moon.color, NIGHT.moon.intensity);
    moon.position.set(-30, 40, -10);
    moon.shadow.bias = -0.0005;
    moon.shadow.normalBias = 0.035;
    this.scene.add(moon);
    this.moon = moon;
    this.sky = new Sky(this.scene, NIGHT.sky, moon.position);
    this.sky.groundAt = (x, z) => layout.walkHeightAt(x, z);

    const seed = Number(new URLSearchParams(location.search).get('seed')) || DEFAULT_SEED;
    const layout = new WorldLayout(seed);
    this.layout = layout;
    const lowMem = ctx.device.memoryGb > 0 && ctx.device.memoryGb <= 4;
    const maxWorkers = ctx.device.type !== 'desktop' || lowMem ? 1 : 2;
    this.chunks = new ChunkManager(this.scene, this.world, layout, ctx.quality.preset.chunkRadius, maxWorkers);
    // Standing surface: storeys, stairs and roofs inside high-rises; paving and terrain everywhere else.
    const ground = (x: number, z: number, y: number) => this.interiors.surfaceY(x, z, y) ?? layout.walkHeightAt(x, z);
    this.player = new Player(ctx, this.camera, this.scene, this.world, SPAWN, SPAWN_YAW, ground);
    this.overlay = this.player.viewmodel;

    // Zombies (stage 4.1): ?zombies=N overrides the preset count, ?zombies=0 turns them off.
    const zq = new URLSearchParams(location.search).get('zombies');
    const zcount = zq !== null ? Math.max(0, Number(zq) || 0) : ctx.quality.preset.zombiesActive;
    this.zombies = new ZombieSim(
      {
        groundY: (x, z, y) => this.interiors.surfaceY(x, z, y) ?? layout.walkHeightAt(x, z),
        resolveCircle: (p, r, h) => this.world.resolveCircle(p, r, h),
        rayHit: (ox, oy, oz, dx, dy, dz, max) => this.world.rayHit(ox, oy, oz, dx, dy, dz, max),
        indoors: (x, z) => this.interiors.surfaceY(x, z, 0) != null,
        route: (from, to, out) => {
          const b = this.interiors.buildingAt(from.x, from.z) ?? this.interiors.buildingAt(to.x, to.z);
          return b ? routeHighrise(b, from, to, out) : false;
        },
        doorNear: (x, y, z, r) => this.doors.closedNear(x, y, z, r),
        hitDoor: (ref, d) => this.doors.damage(ref as DoorRef, d),
        kindAt: (x, z, _y, pick) => this.kindAt(x, z, pick),
      },
      zcount,
      seed,
    );
    // Every zombie is one of the modelled kinds (src/zombies), which one by place (`kindAt`).
    if (zcount > 0) this.pois = new Pois(layout, this.zombies);
    this.models = new ZombieModels(ctx.quality.preset.level);
    this.scene.add(this.particles.points, this.models.group);
    this.ragdolls.limit = ctx.quality.preset.level === 'low' ? 2 : 4;
    // ?zdebug=1: K brings a zombie in front of the player / kills it with a random blow.
    if (new URLSearchParams(location.search).get('zdebug') === '1') {
      const onKey = (e: KeyboardEvent) => e.code === 'KeyK' && !e.repeat && !this.dead && this.debugKey();
      window.addEventListener('keydown', onKey);
      this.unsubs.push(() => window.removeEventListener('keydown', onKey));
    }
    // A blow at its contact frame: a zombie in reach takes it (the head counts double).
    this.player.onStrike = (item) => this.strikeZombie(item);

    // Survival layer: containers follow their chunks; the inventory screen pauses the game.
    this.containers = new Containers(seed);
    // Weapons lying by some containers (on the floor of their storey, where nothing stands).
    this.ground = new GroundWeapons(
      seed,
      (x, y, z) => (y > 0.5 ? y : layout.walkHeightAt(x, z)),
      (x, y, z) => this.world.rayHit(x, y + 1.6, z, 0, -1, 0, 1.5) < 0,
    );
    this.containers.onChunk = (key, list) => (list ? this.ground.addChunk(key, list) : this.ground.removeChunk(key));
    this.scene.add(this.ground.group);
    this.scene.add(this.baseProps.group);
    this.doors = new Doors(this.scene, this.world, ctx.quality.preset.lighting);
    this.interiors = new Interiors(this.scene, this.world, this.chunks, this.containers, this.doors);
    this.glbPool = new GlbPropPool(this.scene, this.particles);
    this.tripwires = new Tripwires({
      scene: this.scene,
      rayHit: (ox, oy, oz, dx, dy, dz, max, ignoreGlass = false) => this.world.rayHit(ox, oy, oz, dx, dy, dz, max, ignoreGlass),
      groundY: (x, y, z) => this.interiors.surfaceY(x, z, y) ?? layout.walkHeightAt(x, z),
      explode: (at, spec) => this.firearms.explode(at, spec),
      sparkAt: (at) => this.particles.sparks(at.x, at.y, at.z, 6),
      toast: (t, ms) => this.ctx.hud.toast(t, ms),
    });
    this.bandits = new Bandits({
      scene: this.scene,
      groundY: (x, z, y = 0) => this.interiors.surfaceY(x, z, y) ?? layout.walkHeightAt(x, z),
      resolveCircle: (pos, r) => this.world.resolveCircle(pos, r),
      rayHit: (ox, oy, oz, dx, dy, dz, max, ignoreGlass = false) => this.world.rayHit(ox, oy, oz, dx, dy, dz, max, ignoreGlass),
      rayHitDetail: (ox, oy, oz, dx, dy, dz, max, ignoreGlass = false) => this.world.rayHitDetail(ox, oy, oz, dx, dy, dz, max, ignoreGlass),
      bushOccludes: (ox, oy, oz, tx, ty, tz) => this.glbPool.bushOccludes(ox, oy, oz, tx, ty, tz),
      boxesNear: (x, z, r, out) => this.world.boxesNear(x, z, r, (b) => out.push(b)),
      buildingsNear: (x, z, r) => this.interiors.buildingsNear(x, z, r),
      doorsNear: (x, y, z, r) => this.doors.doorsNear(x, y, z, r),
      onBreakGlass: (at, dir) => this.breakGlassAt(at, dir),
      addRagdoll: (rd) => this.ragdolls.add(rd),
      removeRagdoll: (rd) => this.ragdolls.remove(rd),
      zombies: this.zombies,
      noise: (x, y, z, r) => {
        this.zombies.noiseAt(x, y, z, r);
        this.hordes.hear(x, z, r);
        this.bandits.onNoise(x, z, r);
      },
      hurtPlayer: (hp, fx, fz, cause, zone = 'torso') => {
        const armor = applyZonalArmor(hp, zone, this.inventory.worn, this.inventory.wornDirt);
        if (armor.armored && armor.hitSlot) {
          this.inventory.wornDirt[armor.hitSlot] = Math.min(1, (this.inventory.wornDirt[armor.hitSlot] ?? 0) + 0.03);
          sfx.armorHit();
        }
        this.hurt(armor.damage, cause, true, new Vector3(fx, this.player.controller.position.y, fz));
      },
      placeAt: () => this.echoPlace(),
      openDoorNear: (x, y, z, radius = 1.7) => {
        const near = this.doors.closedNear(x, y, z, radius);
        if (!near || !this.doors.toggle(near.ref)) return false;
        const info = this.doors.info(near.ref);
        if (info && info.style !== 'glass') sfx.door(info.style === 'lab' ? 'metal' : 'wood', true, info, info.creaky, info.pitch);
        return true;
      },
      explode: (at, spec) => this.firearms.explode(at, spec),
      toast: (t, ms) => this.ctx.hud.toast(t, ms),
      isInteriorLoaded: (id) => this.interiors.isLoaded(id),
      onDropLoot: (bot) => {
        if (!bot.isDead || bot.state !== 'dead') return;
        const rd = bot.ragdoll;
        const pelvis = rd ? rd.poses[PART.pelvis].p : bot.pos;
        const box = rd
          ? bodyBox(rd)
          : ([bot.pos.x, bot.pos.y + 0.22, bot.pos.z, 0.75, 0.32, 0.55, bot.yaw] as [number, number, number, number, number, number, number]);
        const ref: ContainerRef = {
          id: BANDIT_BODY_ID + bot.id,
          type: 'bodyBandit',
          x: pelvis.x,
          z: pelvis.z,
          y: pelvis.y,
          zone: this.chunks.zoneAt(pelvis.x, pelvis.z),
          box,
        };
        this.containers.addLoose(ref, bot.loot, bot.corpse);
      },
      onRemoveCorpse: (bot) => this.containers.removeLoose(BANDIT_BODY_ID + bot.id),
    });
    this.chunks.onChunkLoaded = (key, data) => {
      this.containers.addChunk(key, data.zone, data.containers);
      this.interiors.addChunk(key, data.buildings);
      this.shelters.add(key, data.shelters);
      this.doors.add(entranceKey(key), data.doors);
      this.life?.add(key, data.ambient);
      this.atmo?.add(key, data.ambient);
      this.glbPool?.addChunk(key, data.glbs);
    };
    this.chunks.onChunkUnloaded = (key) => {
      this.containers.removeChunk(key);
      this.interiors.removeChunk(key);
      this.shelters.remove(key);
      this.doors.remove(entranceKey(key));
      this.life?.remove(key);
      this.atmo?.remove(key);
      this.glbPool?.removeChunk(key);
    };
    const syncBody = () => this.syncBody();
    this.panel = new InventoryPanel(
      ctx,
      {
        inventory: this.inventory,
        survival: this.survival,
        skills: this.skills,
        containers: this.containers,
        player: this.player,
        craft: {
          inventory: this.inventory,
          nearFire: () => {
            const p = this.player.controller.position;
            return !!this.base.fireNear(p.x, p.y, p.z, 2.5);
          },
          place: (kind) => this.placeBuilt(kind),
          onXp: (xp) => this.skills.add('carpentry', xp),
        },
        syncBody,
        onClose: () => void this.save(),
        newCharacter: () => void this.newCharacter(),
        startTripwirePlacement: () => this.tripwires.startPlacement(this.inventory),
      },
      document.getElementById('ui')!,
    );
    this.story = new StorySystem(this.layout, this.mapMemory, this.inventory, this.containers, {
      toast: (t, ms) => this.ctx.hud.toast(t, ms),
      showBriefing: (b) => this.ctx.hud.showBriefing(b),
      showVictory: () => this.showVictoryScreen(),
      onWave: (wx, wz) => {
        this.zombies.noiseAt(wx, 0, wz, 110);
        this.hordes.hear(wx, wz, 160);
        for (let k = 0; k < 3; k++) {
          const a = Math.random() * Math.PI * 2;
          const r = 28 + Math.random() * 14;
          this.zombies.spawnAt(wx + Math.cos(a) * r, wz + Math.sin(a) * r, 'chase');
        }
        // Spawn a Juggernaut boss on the first wave and mid-holdout wave
        if (this.story.holdTimer > 76 || Math.abs(this.story.holdTimer - 42) < 7) {
          const ba = Math.random() * Math.PI * 2;
          this.zombies.spawnAt(wx + Math.cos(ba) * 32, wz + Math.sin(ba) * 32, 'chase', 'juggernaut');
          this.ctx.hud.toast(
            tr('К полосе прорывается заражённый Громила!', 'An infected Juggernaut is breaching the runway!'),
            3200,
          );
        }
      },
      isLabPowered: (lx, lz) => this.powered.has(blockKey(lx, lz)),
    });
    this.vehicles = new Vehicles(
      this.scene,
      this.world,
      this.layout,
      this.inventory,
      this.zombies,
      this.particles,
      {
        toast: (t, ms) => this.ctx.hud.toast(t, ms),
        noise: (nx, ny, nz, r) => {
          this.zombies.noiseAt(nx, ny, nz, r);
          this.hordes.hear(nx, nz, r);
        },
        onKill: () => {
          this.skills.kills++;
        },
        onOpenMechanics: (car) => this.carHud.openMechanics(car),
        isMechanic: () => this.classId === 'mechanic',
      },
    );
    const bootAniso = ctx.quality.preset.level === 'low' ? 1 : Math.min(8, ctx.renderer.gl.capabilities.getMaxAnisotropy());
    this.vehicles.setAnisotropy(bootAniso);
    this.carHud = new CarHud(
      ctx,
      this.vehicles,
      this.inventory,
      () => this.exitVehicle(),
      () => void this.save(),
      document.getElementById('ui')!,
    );
    this.helicopter = new Helicopter({
      scene: this.scene,
      world: this.world,
      layout: this.layout,
      particles: this.particles,
      groundY: (gx, gz, refY = 0) => this.interiors.surfaceY(gx, gz, refY) ?? this.layout.walkHeightAt(gx, gz),
      toast: (t, ms) => this.ctx.hud.toast(t, ms),
      hurtPlayer: (hp, cause) => this.hurt(hp, cause, true),
      explode: (at, spec) => this.firearms.explode(at, spec),
      onEscape: () => this.showVictoryScreen('heli'),
      onSave: () => void this.save(),
    });
    this.heliHud = new HeliHud(document.getElementById('ui')!);
    const origPanelOpen = this.panel.open.bind(this.panel);
    this.panel.open = (ref) => {
      if (ref) {
        const p = this.player.controller.position;
        this.story.onContainerSearch(ref, p.x, p.z);
      }
      origPanelOpen(ref);
    };
    this.mapPanel = new MapPanel(
      ctx,
      {
        layout: this.layout,
        memory: this.mapMemory,
        player: () => {
          const pc = this.player.controller;
          return { x: pc.position.x, z: pc.position.z, yaw: this.vehicles.activeCar ? this.vehicles.activeCar.yaw : pc.yaw };
        },
        questTarget: () => {
          const t = this.story.target;
          return t ? { x: t.x, z: t.z, label: `${tr('Цель', 'Target')}: ${POI[t.kind].name}` } : null;
        },
        heli: () => ({
          x: this.helicopter.x,
          z: this.helicopter.z,
          repaired: this.helicopter.isRepaired,
          crashed: this.helicopter.crashed,
        }),
      },
      document.getElementById('ui')!,
    );
    this.interaction = new Interaction(ctx, this.player, this.containers, this.inventory, this.panel, syncBody, this.doors);
    this.interaction.tripwires = this.tripwires;
    this.interaction.onDoorNoise = (x, y, z, r) => {
      this.zombies.noiseAt(x, y, z, r);
      this.hordes.hear(x, z, r);
      this.bandits.onNoise(x, z, r);
    };
    this.interaction.ground = this.ground;
    this.interaction.onSkill = (id, xp) => this.skills.add(id, xp);
    this.grid = gridSchedule(seed);
    this.interaction.spot = { here: () => this.spotHere() };
    this.skills.onLevel = (s, l) => {
      this.ctx.hud.toast(tr(`Навык «${s.name}»: уровень ${l}`, `Skill "${s.name}": level ${l}`), 2200);
      this.applyMods();
    };
    // Search by the crosshair: a ray from the eye into the search zones, walls and objects in front stop it.
    this.interaction.aim = {
      eye: (out) => this.camera.getWorldPosition(out),
      dir: (out) => this.camera.getWorldDirection(out),
      blocked: (o, d, t) => {
        const hit = this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, t);
        return hit >= 0 && hit < t - 0.1;
      },
    };
    // The lab's generator: power where a point is, and starting it.
    this.interaction.power = {
      on: (x, z) => this.powered.has(blockKey(x, z)),
      start: (x, z) => this.powerLab(x, z),
    };
    this.interaction.canLoot = (ref) => {
      if (ref.type !== 'bodyBandit') return true;
      const b = this.bandits.findByBodyId(ref.id);
      return !b || (b.isDead && b.state === 'dead');
    };
    this.interaction.aimingAtLivingNpc = (o, d, reach) => !!this.bandits.hitTest(o, d, reach, 0.02);
    this.searchOutline.visible = false;
    this.searchOutline.frustumCulled = false;
    this.scene.add(this.searchOutline);
    if (new URLSearchParams(location.search).get('interactdebug') === '1') {
      this.zoneDebug = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x40ff80, depthTest: false, transparent: true, opacity: 0.8 }));
      this.zoneDebug.frustumCulled = false;
      this.zoneDebug.renderOrder = 10;
      this.scene.add(this.zoneDebug);
    }
    this.saves = new SaveGame(ctx.platform, seed);
    this.dread = new AnxietyAudio(ctx.events, ctx.loop);
    this.life = new WorldLife(this.scene, this.dread, (x, z) => layout.walkHeightAt(x, z));
    this.atmo = new Atmosphere(
      this.scene,
      this.particles,
      () => this.doors,
      (x, z) => this.groundKind(x, z),
      (x, z) => layout.walkHeightAt(x, z),
      () => {
        const c = this.player.controller.position;
        const b = this.interiors.buildingAt(c.x, c.z);
        return !!b && Math.round(c.y / FLOOR_H) < b.floors - 1;
      },
      this.world,
      (x, y, z, r) => {
        this.zombies.noiseAt(x, y, z, r);
        this.hordes.hear(x, z, r);
      },
      ctx.quality.preset.foliage.cap,
      ctx.quality.preset.level === 'low' ? 1 : Math.min(8, ctx.renderer.gl.capabilities.getMaxAnisotropy()),
    );
    // A blow to a wall: steel strikes sparks, glass breaks with 3D shatter + shards, the knife (and a fist) only a little dust.
    this.player.onStrikeWorld = (x, y, z, item) => {
      this.atmo.strikeAt(x, y, z);
      const eye = this.camera.getWorldPosition(_so);
      const dir = this.camera.getWorldDirection(_sd);
      const hitSurf = this.player.surfaceAlong(eye, dir, 2.5);
      if (hitSurf === 'windowGlass' || hitSurf === 'glass') {
        this.breakGlassAt(_wallHit.set(x, y, z), dir);
      } else if (weaponOf(item)?.sparks) {
        this.particles.sparks(x, y, z, 9);
      } else {
        this.particles.burst(_wallHit.set(x, y, z), 4, 0.4);
      }
      this.weaponBlow();
    };
    this.firearms = new Firearms({
      input: ctx.input,
      player: this.player,
      inventory: this.inventory,
      zombies: this.zombies,
      particles: this.particles,
      scene: this.scene,
      camera: this.camera,
      toast: (t, ms) => this.ctx.hud.toast(t, ms),
      rayHit: (o, d, max) => this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, max),
      rayHitDetail: (o, d, max, ignoreGlass = false) => this.world.rayHitDetail(o.x, o.y, o.z, d.x, d.y, d.z, max, ignoreGlass),
      doorBullet: (owner, dmg) => this.doors.bulletImpact(owner, dmg),
      doorsBlast: (at, radius, dmg) => this.doors.blastNear(at, radius, dmg),
      surface: (o, d, dist) => this.player.surfaceAlong(o, d, dist),
      noise: (x, y, z, r) => {
        this.zombies.noiseAt(x, y, z, r);
        this.hordes.hear(x, z, r);
        this.bandits.onNoise(x, z, r);
      },
      bandits: this.bandits,
      groundY: (x, y, z) => this.interiors.surfaceY(x, z, y) ?? layout.walkHeightAt(x, z),
      hurtSelf: (hp) => this.hurt(hp, tr('Подорвались на своём выстреле', 'Blew yourself up with your own shot'), true),
      igniteCars: (x, y, z, r) => this.igniteCars(x, y, z, r),
      carHit: (x, y, z) => this.atmo.carHit(x, y, z),
      onBreakGlass: (at, dir) => this.breakGlassAt(at, dir),
      onVehicleBulletHit: (at, dir, playSound) => this.handleVehicleBulletHit(at, dir, playSound),
      onReloadStart: () => this.bandits.onPlayerReloading(this.player.controller.position),
      handling: () => this.mods().firearms,
      place: () => this.echoPlace(),
      surfaceAt: () => this.surfaceAt(this.player.controller.position.x, this.player.controller.position.z, this.player.controller.position.y),
    });
    sfx.setOcclusionCheck((lx, ly, lz, sx, sy, sz) => {
      const dx = sx - lx;
      const dy = sy - ly;
      const dz = sz - lz;
      const dist = Math.hypot(dx, dy, dz);
      if (dist <= 0.6) return false;
      const hit = this.world.rayHit(lx, ly, lz, dx / dist, dy / dist, dz / dist, dist);
      return hit >= 0 && hit < dist - 0.5;
    });
    this.gunHud = new GunHud(document.getElementById('ui')!, ctx.input);
    this.firearms.onShot = (r) => this.gunHud.shot(r);
    // The trees' far-away impostors are baked once, now.
    this.atmo.vegetation.bake(ctx.renderer.gl);
    this.landmarks = new Landmarks(this.scene, layout);
    this.farSmoke = new FarSmoke(this.scene, layout);
    this.weather = new Weather(this.scene, document.getElementById('ui')!, (delay, power) => this.life.thunder(delay, power));
    this.interiors.onAmbient = (owner, spots) => {
      if (spots) {
        this.life.add(owner, spots);
        this.atmo.add(owner, spots);
      } else {
        this.life.remove(owner);
        this.atmo.remove(owner);
      }
    };
    this.inventory.restore(START_KIT);
    this.player.battery = START_KIT.battery;
    this.syncBody();
    this.unsubs.push(ctx.events.on('loop:pause', ({ reason }) => reason === 'hidden' && this.save()));

    this.resize(ctx.renderer.width, ctx.renderer.height);
    this.applyQuality();
    this.editor = new WorldEditor(this.scene, this.camera, ctx.renderer.gl.domElement, (on) => {
      this.ctx.events.emit('ui:modal', { open: on });
      this.player.viewmodel.scene.visible = !on && !this.dead && !this.vehicles.activeCar;
      if (!on) {
        const p = this.camera.position;
        this.player.controller.position.set(p.x, Math.max(0, p.y - 1.6), p.z);
        this.ctx.requestPointerLock();
      }
    });
    if (new URLSearchParams(location.search).get('editor') === '1') {
      this.editor.toggle(true);
    }
    this.unsubs.push(
      ctx.events.on('viewport:resize', ({ width, height }) => this.resize(width, height)),
      ctx.events.on('quality:changed', () => this.applyQuality()),
      ctx.events.on('settings:changed', () => this.applySettings()),
    );

    const c = this.player.controller;
    ctx.debug.set('player', () => {
      const p = c.position;
      const state = c.crouched ? tr('присед', 'crouch') : c.sprinting ? tr('бег', 'run') : c.speed > 0.2 ? tr('шаг', 'walk') : tr('стоит', 'idle');
      return `player ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}  ${c.speed.toFixed(1)} ${tr('м/с', 'm/s')}  ${state}  ${tr('шум', 'noise')} ${c.noise.toFixed(2)}`;
    });
    ctx.debug.set('world', () => {
      const ch = this.chunks;
      return `world seed ${seed}  zone ${ch.zoneAt(c.position.x, c.position.z)}  chunks ${ch.loadedCount} (+${ch.pendingCount})  gen ${ch.lastGenMs.toFixed(0)}ms  colliders ${this.world.boxCount}  interiors ${this.interiors.loadedCount}  doors ${this.doors.count}  ${tr('этаж', 'floor')} ${Math.round(c.position.y / 3.2)}`;
    });
    ctx.debug.set('climate', () => {
      const s = this.survival;
      return `${tr('время', 'time')} ${this.clock.label}  ${this.indoors ? tr('внутри', 'indoors') : tr('снаружи', 'outdoors')}  ${tr('воздух', 'air')} ${this.air.toFixed(1)}°  ${tr('ощущается', 'feels')} ${this.felt.toFixed(1)}°  ${tr('тело', 'body')} ${s.bodyTemp.toFixed(2)}°  ${tr('тревога', 'anxiety')} ${Math.round(s.anxiety * 100)}%`;
    });
    ctx.debug.set('hordes', () => {
      const c = this.player.controller.position;
      const near = this.hordes.list.reduce((m, h) => Math.min(m, Math.hypot(h.x - c.x, h.z - c.z)), Infinity);
      return `${tr('орды', 'hordes')} ${this.hordes.list.length} (${this.hordes.total} ${tr('зомби', 'zombies')}), ${tr('ближайшая', 'nearest')} ${Math.round(near)} ${tr('м', 'm')} · ${tr('свет', 'power')} ${this.gridState?.power ? tr('есть', 'on') : tr('нет', 'off')} ${tr('вода', 'water')} ${this.gridState?.water ? tr('есть', 'on') : tr('нет', 'off')}`;
    });
    ctx.debug.set('zombies', () => `${tr('зомби', 'zombies')} ${this.zombies.list.length}/${this.zombies.target}  ${tr('видят', 'seeing')} ${this.zombies.seeing}  ${tr('идут за мной', 'chasing')} ${this.zombies.chasing}  ${tr('шум', 'noise')} ${this.player.controller.noise.toFixed(2)}`);
    ctx.debug.set('survival', () => {
      const v = this.survival;
      const pct = (x: number) => Math.round(x * 100);
      return `hp ${pct(v.health)}  ${tr('голод', 'hunger')} ${pct(v.hunger)}  ${tr('жажда', 'thirst')} ${pct(v.thirst)}  ${tr('усталость', 'fatigue')} ${pct(v.fatigue)}  ${tr('фонарь', 'light')} ${pct(this.player.battery)}  ${tr('вес', 'weight')} ${this.inventory.weight.toFixed(1)}  ${tr('контейнеры', 'containers')} ${this.containers.loadedCount} (${tr('открыто', 'opened')} ${this.containers.openedCount})`;
    });
  }

  /** First-person body follows the inventory: weapon in the hand, sleeves, trousers, shoes. */
  private syncBody(): void {
    const hand = this.inventory.hand;
    this.player.viewmodel.equip(hand && isGun(hand) ? hand : (hand && HELD[hand]) ?? 'fists');
    this.player.setLook(this.look, this.inventory.worn.outfit);
    this.player.setGear(wornGear(this.inventory.worn), !hand);
    this.dirtShown = dirtSteps(this.inventory.wornDirt);
  }

  /** Restore the save (if any), then wait for the blocks around the player. */
  async load(): Promise<void> {
    const save = await this.saves.load();
    const c = this.player.controller;
    if (save) {
      // The world remembers the dead and their bodies; containers stay as they were.
      this.twins = save.twins ?? [];
      this.doors.restoreBoards(save.boards);
      this.doors.restoreUnlocked(save.unlocked);
      for (const k of save.powered ?? []) this.powered.add(k);
      this.labLights();
      this.bodies = save.bodies ?? [];
      this.containers.restore(save.containers);
      this.ground.restore(save.ground);
      for (const b of this.bodies) this.containers.addLoose(b, []);
      this.containers.restoreCorpses(save.corpses);
      let maxRestoredBotId = 0;
      for (const ref of this.containers.looseRefs) {
        if (ref.type === 'bodyBandit' && ref.id >= BANDIT_BODY_ID) {
          maxRestoredBotId = Math.max(maxRestoredBotId, ref.id - BANDIT_BODY_ID);
        }
      }
      if (maxRestoredBotId > 0) this.bandits.reserveIdsAbove(maxRestoredBotId);
      this.base.restore(save.base);
      for (const p of this.base.list) if (p.kind === 'stash') this.containers.addLoose(stashRef(p), []);
      this.tripwires.restore(save.tripwires);
      this.helicopter.restore(save.heli);
      if (save.clock !== undefined) this.clock.minutes = save.clock;
      this.bornAt = save.dead ? this.clock.minutes : (save.bornAt ?? this.clock.minutes);
      this.meta = { ...emptyMeta(), ...save.meta };
    }
    // Dev: ?hour=12 — the clock wound forward to that hour (0–24, fractions too) on load; time runs on from there.
    const hourQ = Number(new URLSearchParams(location.search).get('hour') || NaN);
    if (Number.isFinite(hourQ)) {
      const day = 24 * 60;
      const want = (((hourQ * 60) % day) + day) % day;
      this.clock.minutes += (((want - (this.clock.minutes % day)) % day) + day) % day;
    }
    if (save && !save.dead) {
      this.isNewGame = false;
      this.playerArmed = Boolean(save.playerArmed);
      // Saves before the editor: the default survivor and class, no editor.
      this.look = sanitizeAppearance(save.character?.appearance);
      this.classId = classDef(save.character?.classId).id;
      this.traits = sanitizeTraits(save.character?.traits);
      this.mapMemory.restore(save.map);
      this.skills.restore(save.skills, this.classId, save.kills);
      this.applyClass();
      c.position.set(save.player.x, save.player.y ?? 0, save.player.z);
      c.prevPosition.copy(c.position);
      c.yaw = save.player.yaw;
      this.player.battery = save.player.battery;
      this.survival.restore(save.stats);
      // Saves from before clothing existed: keep the starting clothes on.
      this.inventory.restore({ ...save.inventory, worn: save.inventory.worn ?? START_KIT.worn });
      this.giveDebug();
      this.syncBody();
    }
    // ?poi=gas|police: start in front of the nearest such place (for checking them).
    const want = new URLSearchParams(location.search).get('poi') as PoiKind | null;
    if (want && want in POI) {
      const site = nearestPoi(this.layout, want, Math.floor(c.position.x / CHUNK), Math.floor(c.position.z / CHUNK));
      if (site) {
        // In front of its gate side (big places: in front of the whole lot).
        const depth = ((site.r & 1 ? (site.bw ?? 1) : (site.bd ?? 1)) * CHUNK) / 2;
        const [px, pz] = siteToWorld(site, 0, depth - 3);
        const [cx, cz] = siteToWorld(site, 0, 0);
        c.position.set(px, 0.05, pz);
        c.prevPosition.copy(c.position);
        c.yaw = Math.atan2(-(cx - px), -(cz - pz));
      }
    }
    // ?chaos=evacuation|cordon|police|heli: start 14 m from the nearest intersection with that scene.
    const chaos = new URLSearchParams(location.search).get('chaos') as SceneKind | null;
    if (chaos) {
      const ci = Math.floor(c.position.x / CHUNK);
      const cj = Math.floor(c.position.z / CHUNK);
      const L = this.layout;
      let best: [number, number] | null = null;
      for (let r = 0; r <= 14 && !best; r++) {
        for (let i = ci - r; i <= ci + r && !best; i++) {
          for (let j = cj - r; j <= cj + r && !best; j++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
            const urban = L.isUrban(i, j) || L.isUrban(i - 1, j) || L.isUrban(i, j - 1) || L.isUrban(i - 1, j - 1);
            if (sceneAt(L.seed, i, j, urban, Math.max(Math.abs(i), Math.abs(j)) <= DOWNTOWN_RADIUS + 1)?.kind === chaos) best = [i * CHUNK, j * CHUNK];
          }
        }
      }
      if (best) {
        c.position.set(best[0] + 10, 0.05, best[1] + 10);
        c.prevPosition.copy(c.position);
        c.yaw = Math.atan2(10, 10);
      }
    }
    const spInit = new URLSearchParams(location.search);
    if (spInit.get('heli') === 'test') {
      const hx = this.helicopter.x;
      const hz = this.helicopter.z;
      c.position.set(hx - 7, 0.05, hz + 7);
      c.prevPosition.copy(c.position);
      c.yaw = Math.atan2(-(hx - c.position.x), -(hz - c.position.z));
      this.helicopter.placeForTest(hx, hz, false);
      for (const id of ['heliAvionics', 'heliFuelPump', 'heliBattery', 'jerrycan', 'jerrycan'] as const) {
        this.inventory.add(id, 1);
      }
      this.ctx.hud.toast(tr('ТЕСТ МИ-8: подойдите к вертолёту [E] для установки деталей и заправки', 'MI-8 TEST: approach chopper [E] to install parts & refuel'), 4200);
    }
    const { x, z } = c.position;
    this.story.init(x, z, save?.story);
    const done = this.chunks.whenLoaded(x, z, 1);
    const pump = window.setInterval(() => this.chunks.update(x, z, 0, 1), 16);
    await done;
    window.clearInterval(pump);
    this.vehicles.init(x, z, save?.cars);
    const sp = new URLSearchParams(location.search);
    if (sp.get('poi') === 'cars' || sp.has('car') || sp.has('cars')) {
      this.vehicles.spawnTestCars(x, z, c.yaw);
    }
    if (sp.has('heli') && sp.get('heli') !== 'test') {
      const ready = sp.get('heli') === 'ready';
      this.helicopter.placeForTest(x + 22, z - 18, ready);
    }
    if (import.meta.env.DEV) {
      (window as unknown as { __heliTest?: () => void }).__heliTest = () => {
        const hx = this.helicopter.x;
        const hz = this.helicopter.z;
        c.position.set(hx - 7, 0.05, hz + 7);
        c.prevPosition.copy(c.position);
        for (const id of ['heliAvionics', 'heliFuelPump', 'heliBattery', 'jerrycan', 'jerrycan'] as const) {
          this.inventory.add(id, 1);
        }
      };
    }
    if (sp.has('goons')) {
      this.bandits.spawnGoonsNear(x, z, 28);
    }
  }

  /**
   * Tiny triangles with each world material right in front of the camera (so none is culled before
   * its shader compiles), plus one shadow-map render for the flashlight's depth shaders.
   */
  prewarm(): () => void {
    this.prewarming = true;
    const group = new Group();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Int8Array([0, 0, 127, 0, 0, 127, 0, 0, 127]), 3, true));
    g.setAttribute('color', new BufferAttribute(new Uint8Array(3 * 3), 3, true));
    g.setAttribute('aSurfUv', new BufferAttribute(new Float32Array(3 * 2), 2));
    g.setAttribute('aLayer', new BufferAttribute(new Uint8Array(3), 1, false));
    g.setAttribute('aPbr', new BufferAttribute(new Uint8Array(3 * 2), 2, true));
    g.setIndex([0, 1, 2]);
    const mats = worldMaterials();
    for (const bucket of [...BUCKETS, 'castCut'] as const) {
      const m = new Mesh(g, mats[bucket]);
      m.castShadow = bucket === 'cast' || bucket === 'castCut';
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }

    const tempGeos: BufferGeometry[] = [g];
    const tempFigs: CharacterRig[] = [];
    const vmGroup = new Group();
    const tiny = new Matrix4().makeScale(0.001, 0.001, 0.001);
    const pin = (mat: Material): Material => {
      this.pinnedMaterials.push(mat);
      return mat;
    };

    if (hasBody('male')) {
      coverBody('male');
      const asset = bodyAsset('male');
      const rig0 = asset.lod0;
      const rig1 = asset.lod1;
      const skinData = new Float32Array(rig1.names.length * 16);
      for (let i = 0; i < rig1.names.length; i++) {
        const o = i * 16;
        skinData[o] = skinData[o + 5] = skinData[o + 10] = skinData[o + 15] = 1;
      }
      const dummySkin = new DataTexture(skinData, rig1.names.length * 4, 1, RGBAFormat, FloatType);
      dummySkin.minFilter = dummySkin.magFilter = NearestFilter;
      dummySkin.needsUpdate = true;
      this.pinnedTextures.push(dummySkin);

      const cloneSkinGeo = (extra: Record<string, InstancedBufferAttribute>): BufferGeometry => {
        const bg = new BufferGeometry();
        for (const [k, a] of Object.entries(rig1.geometry.attributes)) bg.setAttribute(k, a);
        bg.setIndex(rig1.geometry.index);
        for (const [k, a] of Object.entries(extra)) bg.setAttribute(k, a);
        bg.boundingSphere = new Sphere(new Vector3(0, 0.9, 0), 1.4);
        tempGeos.push(bg);
        return bg;
      };
      const addInst = (mat: Material, geo: BufferGeometry) => {
        const m = new InstancedMesh(geo, pin(mat), 1);
        m.setMatrixAt(0, tiny);
        m.instanceMatrix.needsUpdate = true;
        m.count = 1;
        m.frustumCulled = false;
        group.add(m);
      };

      // 1-4. Batched zombie crowd body + zombie gear (1-sided, 2-sided mask, lens).
      addInst(
        characterMaterial(asset, rig1, { zombie: true, skin: dummySkin, cover: true }),
        cloneSkinGeo({
          aTint: new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3),
          aTint2: new InstancedBufferAttribute(new Float32Array([1, 1, 1]), 3),
          aHide: new InstancedBufferAttribute(new Float32Array([0]), 1),
        }),
      );
      const tex = asset.textureLod ?? asset.texture;
      addInst(characterMaterial(asset, rig1, { skin: dummySkin, row: true, map: tex, doubleSide: false }), cloneSkinGeo({ aRow: new InstancedBufferAttribute(new Float32Array([0]), 1) }));
      addInst(characterMaterial(asset, rig1, { skin: dummySkin, row: true, map: tex, doubleSide: true }), cloneSkinGeo({ aRow: new InstancedBufferAttribute(new Float32Array([0]), 1) }));
      addInst(characterMaterial(asset, rig1, { skin: dummySkin, row: true, lens: LENS_TINT.goggles_tactical ?? 0x1e1f1d }), cloneSkinGeo({ aRow: new InstancedBufferAttribute(new Float32Array([0]), 1) }));

      // 5-9. Skinned character archetypes (player / bandit / death body & gear, plain + cover + mask + lens).
      const fig = new CharacterRig('male', 0);
      tempFigs.push(fig);
      const addSkinned = (mat: Material) => {
        const sm = new SkinnedMesh(rig0.geometry, pin(mat));
        sm.bind(fig.mesh.skeleton, fig.mesh.bindMatrix);
        sm.scale.setScalar(0.001);
        sm.castShadow = true;
        sm.receiveShadow = true;
        sm.frustumCulled = false;
        group.add(sm);
      };
      addSkinned(characterMaterial(asset, rig0));
      addSkinned(characterMaterial(asset, rig0, { cover: true, hide: { value: 0 } }));
      addSkinned(characterMaterial(asset, rig0, { map: asset.texture, doubleSide: false }));
      addSkinned(characterMaterial(asset, rig0, { map: asset.texture, doubleSide: true }));
      addSkinned(characterMaterial(asset, rig0, { lens: LENS_TINT.goggles_tactical ?? 0x1e1f1d }));

      // 10-12. Rigid gear box, world melee & highlight, GunModel / Vehicles / look materials.
      const tinyBox = new BoxGeometry(0.001, 0.001, 0.001);
      tempGeos.push(tinyBox);
      const tinyColorBox = tinyBox.clone();
      tinyColorBox.setAttribute(
        'color',
        new BufferAttribute(new Float32Array(tinyColorBox.attributes.position.count * 3).fill(1), 3),
      );
      tempGeos.push(tinyColorBox);
      const addWorld = (mat: Material, castShadow = true, target = group, geo: BufferGeometry = tinyBox) => {
        const m = new Mesh(geo, pin(mat));
        m.scale.setScalar(0.001);
        m.castShadow = castShadow;
        m.receiveShadow = true;
        m.frustumCulled = false;
        target.add(m);
      };
      addWorld(characterMaterial(asset, rig0, { map: asset.texture }));
      const wMesh = weaponMesh('tacticalKnife');
      wMesh.scale.setScalar(0.001);
      wMesh.frustumCulled = false;
      pin(wMesh.material as Material);
      group.add(wMesh);
      addWorld(weaponHighlightMaterial(), false, group, buildWeapon('tacticalKnife').geometry);
      addWorld(new MeshLambertMaterial({ color: 0xffffff, map: asset.texture }));
      addWorld(new MeshLambertMaterial({ color: 0x3c3f42 }));
      addWorld(new MeshLambertMaterial({ vertexColors: true }), true, group, tinyColorBox);
      addWorld(new MeshBasicMaterial({ map: asset.texture, transparent: true, depthWrite: false }), false);
      addWorld(lookCharacterMaterial('handle', 0x5a4632));
      addWorld(bladeMaterial());

      // Viewmodel GunModel (textured Lambert) and flashlight (body + lens) in overlay scene; knife & fp-arms are already attached there.
      addWorld(new MeshLambertMaterial({ color: 0xffffff, map: asset.texture }), false, vmGroup);
      addWorld(flashlightMaterial(), false, vmGroup, tinyColorBox);
      addWorld(lensMaterial(), false, vmGroup);
      vmGroup.position.set(0, 0, -0.5);
      this.player.viewmodel.scene.add(vmGroup);
    }

    this.camera.getWorldDirection(this.lookDir);
    group.position.copy(this.camera.position).addScaledVector(this.lookDir, 0.5);
    this.scene.add(group);
    this.player.prewarmShadows();
    this.player.warmSurfaceCache();
    const lifeDone = this.life.prewarm();
    const atmoDone = this.atmo.prewarm();
    const doorsDone = this.doors.prewarm();
    this.ctx.renderer.gl.compile(this.scene, this.camera);
    this.ctx.renderer.gl.compile(this.player.viewmodel.scene, this.player.viewmodel.camera);
    return () => {
      this.prewarming = false;
      lifeDone();
      atmoDone();
      doorsDone();
      group.removeFromParent();
      vmGroup.removeFromParent();
      for (const f of tempFigs) f.dispose();
      for (const geo of tempGeos) geo.dispose();
    };
  }

  setHeadShadow(on: boolean | null): void {
    this.vehicles.setHeadShadow(on);
  }

  setFlashlightShadow(on: boolean | null): void {
    this.player.setFlashlightShadow(on);
  }

  private exitVehicle(): void {
    const c = this.player.controller;
    const out = this.vehicles.exit(c.position, c.prevPosition);
    if (!out) return;
    c.yaw = out.yaw;
    if (!this.dead) {
      this.player.viewmodel.scene.visible = true;
      this.player.body.root.visible = true;
    }
    this.save();
  }

  fixedUpdate(dt: number): void {
    if (this.editor.active) return;
    const c = this.player.controller;
    if (this.debugSpawnT > 0 && (this.debugSpawnT -= dt) <= 0) this.debugKey();
    if (this.debugDieT > 0 && (this.debugDieT -= dt) <= 0) {
      const f = new Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      this.die(tr('Отладка', 'Debug'), c.position.clone().addScaledVector(f, 1));
    }
    const inCar = !this.dead && !!this.vehicles.activeCar;
    const inHeli = !this.dead && this.helicopter.piloting;
    if (inHeli) {
      this.player.viewmodel.scene.visible = false;
      this.player.body.root.visible = false;
      this.player.suppressLight(true);
      if (this.ctx.input.consumePressed('flashlight')) {
        if (this.helicopter.tryExit(c.position, c.prevPosition) && !this.dead) {
          c.yaw = this.helicopter.yaw;
          this.player.viewmodel.scene.visible = true;
          this.player.body.root.visible = true;
          this.player.suppressLight(false);
        }
      } else {
        this.helicopter.fixedUpdate(dt, this.ctx.input, c.position, c.prevPosition);
        c.yaw = this.helicopter.yaw;
      }
    } else if (inCar) {
      this.player.viewmodel.scene.visible = false;
      this.player.body.root.visible = false;
      this.player.suppressLight(true);
      if (this.ctx.input.consumePressed('use')) {
        this.exitVehicle();
      } else {
        if (this.ctx.input.consumePressed('flashlight')) this.vehicles.toggleLights();
        this.vehicles.fixedUpdate(dt, this.ctx.input, c.position, c.prevPosition);
        if (this.vehicles.activeCar) c.yaw = this.vehicles.activeCar.yaw;
      }
      this.helicopter.fixedUpdate(dt, null, c.position, c.prevPosition);
    } else {
      this.player.suppressLight(false);
      if (!this.dead) {
        this.player.viewmodel.scene.visible = true;
        this.player.body.root.visible = true;
      }
      c.canSprint = this.survival.canSprint;
      c.sprintFactor = this.survival.sprintFactor;
      c.jumpFactor = this.survival.jumpFactor;
      // Tired: the swing is slower.
      this.player.viewmodel.swingRate = 1 - 0.25 * Math.min(1, Math.max(1 - this.survival.stamina, this.survival.fatigue));
      if (!this.dead) this.player.fixedUpdate(dt);
      const consumedByWire = !this.dead && this.tripwires.handlePlacementInput(c.position.x, c.position.y, c.position.z, c.yaw, this.ctx.input, this.inventory);
      if (!this.dead && !consumedByWire && !this.tripwires.isPlacing) this.firearms.fixedUpdate(dt);
      this.vehicles.fixedUpdate(dt, this.ctx.input, c.position, c.prevPosition);
      this.helicopter.fixedUpdate(dt, null, c.position, c.prevPosition);
    }
    this.hitFromT += dt;
    for (let i = this.carFires.length - 1; i >= 0; i--) {
      const f = this.carFires[i];
      if ((f.t -= dt) > 0) continue;
      this.life.remove(f.key);
      this.atmo.remove(f.key);
      this.carFires.splice(i, 1);
    }
    // Zombies hear and see the player as it is after this step.
    _zs.pos.copy(c.position);
    _zs.eye = c.crouched ? 1.0 : 1.6;
    // Rain drowns footsteps.
    _zs.noise = c.noise * (1 - ATMO.weather.rainMasks * this.weather.rain);
    _zs.crouched = c.crouched;
    _zs.lit = this.player.lightOn ? 0.7 : 0;
    _zs.daylight = this.clock.daylight;
    _zs.fog = this.weather.fog;
    _zView.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    _zs.bandits = this.bandits.list;
    this.zombies.update(dt, _zs, _zView);
    if (!this.playerArmed && this.inventory.hasAnyGun()) this.playerArmed = true;
    this.bandits.update(
      dt,
      c.position.x,
      c.position.y,
      c.position.z,
      this.dead,
      !!this.vehicles.activeCar,
      !!this.firearms.hud()?.reloading,
      c.velocity.x,
      c.velocity.z,
      this.weather.fog,
      this.playerArmed,
      c.crouched,
    );
    this.tripwires.update(dt, c.position, c.crouched, this.dead, this.zombies.list, this.bandits.list);
    if ((this.ambushScanT -= dt) <= 0) {
      this.ambushScanT = 1.5;
      this.tripwires.spawnAmbushNearDoors(this.doors.doorsNear(c.position.x, c.position.y, c.position.z, 38), this.bandits.list, this.saves.seed);
    }
    if (this.vehicles.activeCar && Math.abs(this.vehicles.activeCar.speed) > 2.4) {
      const car = this.vehicles.activeCar;
      this.bandits.ramByCar(car.x, car.z, Math.sin(car.yaw) * car.speed, Math.cos(car.yaw) * car.speed);
    }
    this.updateHordes(dt);
    this.updateMap(dt);
    this.updateSleep(dt);
    this.updateBase(dt);
    this.pois?.update(dt, c.position.x, c.position.z);
    // Nearest first: in a crowd the sound groups fill up with the zombies that matter.
    const near = (z: { pos: Vector3 }) => (z.pos.x - c.position.x) ** 2 + (z.pos.z - c.position.z) ** 2;
    this.zombies.sounds.sort((a, b) => near(a.z) - near(b.z));
    for (const { z, kind } of this.zombies.sounds) sfx.zombie(kind, { x: z.pos.x, y: z.pos.y + 1.5, z: z.pos.z }, z.pitch);
    for (const a of this.zombies.attacks) {
      if (this.vehicles.activeCar) {
        if (Math.abs(this.vehicles.activeCar.speed) < 2.5) {
          this.vehicles.damageActiveCar(a.damage, a.from.pos);
        }
      } else {
        this.bitten(a.damage, a.from.pos, this.zombies.attacks.length);
      }
    }
    for (const z of this.zombies.killedTwins) this.lootTwin(z);
    // The dead go limp: a ragdoll each, from the pose they died in.
    for (const z of this.zombies.died) this.zombieRagdoll(z);
    for (const z of this.zombies.removed) {
      const rd = this.corpseRd.get(z);
      if (rd) this.ragdolls.remove(rd);
      this.corpseRd.delete(z);
      this.models.removeCorpse(z.id);
      this.containers.removeLoose(ZOMBIE_BODY_ID + z.id);
    }
    this.ragdolls.update(dt);
    // Asleep: frozen for good where it lies; ordinary bodies can be searched there, until cleared away.
    for (const [z, rd] of this.corpseRd) {
      if (!rd.asleep || z.rest) continue;
      z.rest = true;
      const pelvis = rd.poses[PART.pelvis].p;
      z.pos.x = pelvis.x;
      z.pos.z = pelvis.z;
      const box = bodyBox(rd);
      if (z.twin) {
        // A dead survivor's body: searchable along the body where it came to rest.
        const twinRef = this.bodies.find((b) => b.id === z.twin!.id);
        if (twinRef) Object.assign(twinRef, { x: box[0], z: box[2], box });
        continue;
      }
      const type = ZOMBIE_STATS[z.kind].loot;
      const ref = { id: ZOMBIE_BODY_ID + z.id, type, x: z.pos.x, z: z.pos.z, y: z.pos.y, zone: this.chunks.zoneAt(z.pos.x, z.pos.z), box };
      const loot = rollLoot(this.layout.seed, ref.id, type, ref.zone);
      if (z.kind === 'patientZero') {
        loot.unshift({ id: 'storySample', count: 1 }, { id: 'serumG7', count: 1 });
      } else if (z.kind === 'juggernaut') {
        loot.unshift({ id: 'antibiotics', count: 2 }, { id: 'ammo_556', count: 30 });
      }
      this.containers.addLoose(ref, loot);
    }
    // Zombies are solid to the player when on foot (and the walls still win).
    if (!this.vehicles.activeCar) {
      for (const z of this.zombies.list) {
        if (z.state === 'dead' || Math.abs(z.pos.y - c.position.y) > 1.2) continue;
        const dx = c.position.x - z.pos.x;
        const dz = c.position.z - z.pos.z;
        const d = Math.hypot(dx, dz);
        const min = 0.3 + 0.32;
        if (d < min && d > 1e-4) {
          c.position.x += (dx / d) * (min - d);
          c.position.z += (dz / d) * (min - d);
          this.world.resolveCircle(c.position, 0.3);
        }
      }
    }
    this.twinsNear(c.position);
    if (c.fallDamage > 0) this.hurt(c.fallDamage * 100, tr('Разбились при падении', 'Fell to your death'), true);
    this.hazards(dt, c.position);
    if (c.jumped) this.survival.onJump();
    this.ctx.hud.setStamina(this.survival.stamina);
    // Distance-based footsteps, crouch/stand, turn-in-place pivots, jump, and landing.
    const feet = { x: c.position.x, y: c.position.y + 0.05, z: c.position.z };
    if (c.crouchChanged) sfx.crouch(c.crouchChanged === 'down', feet);
    if (c.stepped) {
      const wet = this.atmo.puddleAt(feet.x, feet.z, c.position.y);
      if (wet) this.atmo.ripple(feet.x, c.position.y, feet.z);
      const gait: Gait = c.crouched ? 'crouch' : (c.sprinting && c.speed > 2.8) || c.speed > 3.35 ? 'run' : 'walk';
      sfx.step(wet ? 'water' : this.surfaceAt(feet.x, feet.z, c.position.y), gait, feet, 1, true, c.stepFoot);
    }
    this.turnCd = Math.max(0, this.turnCd - dt);
    if (!this.turnInited) {
      this.prevTurnYaw = c.yaw;
      this.turnInited = true;
    }
    let dYaw = c.yaw - this.prevTurnYaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    this.prevTurnYaw = c.yaw;
    if (!this.dead && !c.airborne && !this.vehicles.activeCar && c.speed < 0.1) {
      this.turnYawAccum += dYaw;
      this.turnWindowT += dt;
      if (this.turnWindowT > 0.45) {
        this.turnYawAccum *= 0.35;
        this.turnWindowT = 0;
      }
      if (Math.abs(this.turnYawAccum) >= (50 * Math.PI) / 180 && this.turnCd <= 0) {
        const surf = this.surfaceAt(feet.x, feet.z, c.position.y);
        sfx.pivot(surf, feet, Math.abs(this.turnYawAccum) >= (130 * Math.PI) / 180);
        this.turnYawAccum = 0;
        this.turnWindowT = 0;
        this.turnCd = 0.6;
      }
    } else {
      this.turnYawAccum = 0;
      this.turnWindowT = 0;
    }
    if (c.jumped) sfx.jump(feet);
    if (c.landed > 0.8) sfx.land(this.surfaceAt(feet.x, feet.z, c.position.y), feet, c.landed);
    if (!this.dead && !this.vehicles.activeCar && !this.helicopter.piloting) this.interaction.fixedUpdate(dt);
    this.clock.update(dt);
    this.updateGrid();
    // Climate & room reverb: outdoor streets dry (0.02), downtown alleys (0.10), concrete indoors (0.42).
    this.climateT -= dt;
    if (this.climateT <= 0) {
      this.climateT = 0.25;
      const p = c.position;
      this.indoors = this.shelters.covers(p.x, p.z, p.y);
      this.air = airTemperature(this.clock.hour, this.indoors);
      const b = this.indoors ? this.interiors.buildingAt(p.x, p.z) : null;
      const wet = this.indoors ? (b && inStairCore(b, p.x, p.z) ? 0.12 : 0.09) : this.chunks.zoneAt(p.x, p.z) === 'downtown' ? 0.06 : 0.02;
      sfx.setRoom(wet);
    }
    this.felt = feltTemperature(this.air, wornStat(this.inventory.worn, 'warmth'), c.speed, c.sprinting) + this.base.warmth(c.position.x, c.position.y, c.position.z);
    // Clothes get dirty: faster running, crawling, rummaging through containers.
    soilClothes(this.inventory, dt, { moving: c.speed > 0.2, sprinting: c.sprinting, crouching: c.crouched && c.speed > 0.2, searching: this.player.busy, weather: 1 });
    if (this.moodleT <= dt && dirtSteps(this.inventory.wornDirt) !== this.dirtShown) this.syncBody();
    // Dark = night without a light of your own (rooms by day get light through the windows).
    const dark = !this.player.lightOn && this.clock.isNight && !this.base.fireNear(c.position.x, c.position.y, c.position.z, BASE.lightReach);
    const threat = this.zombies.threat(c.position);
    if (!this.dead && c.speed > 0.3) {
      if (c.sprinting) this.skills.add('fitness', XP.sprint * dt);
      else if (c.crouched && threat > 0.05) this.skills.add('sneak', XP.sneak * dt);
    }
    this.survival.update(dt, c.speed, c.sprinting, { felt: this.felt, dark, batteryDead: this.player.battery <= 0, threat });
    sfx.updateStamina(dt, this.survival.stamina, this.survival.health, Boolean(this.inventory.worn.mask), this.dead);
    // Anxiety: heartbeat and breath, and the screen edges closing in with every beat.
    const a = this.survival.anxiety;
    if (!this.dead) this.dread.update(dt, a);
    this.ctx.fx.setDread(a * 0.8 + this.dread.pulse * a * 0.25);
    if (this.survival.health <= 0 && !this.dead)
      this.die(
        this.survival.infection >= 1
          ? tr('Заражение: вы обратились', 'Infection: you turned')
          : this.survival.hunger > 0.85 || this.survival.thirst > 0.85
            ? tr('Истощение', 'Exhaustion')
            : this.deathCause || tr('Раны', 'Wounds'),
      );
    this.moodleT -= dt;
    if (this.moodleT <= 0) {
      this.moodleT = 0.25;
      this.survival.pushStats(this.ctx.hud, this.player.battery);
      if (!this.dead) {
        this.ctx.hud.setStory(this.story.update(0.25, c.position.x, c.position.z, c.yaw));
        this.vehicles.ensurePoiCars(c.position.x, c.position.z);
      }
    }
  }

  /** gameDt: the world's time this frame, 0 while paused (GameLoop: the one pause check) — the world moves by it. */
  render(alpha: number, frameDt: number, gameDt: number): void {
    this.particles.update(gameDt);
    this.glbPool?.update(gameDt, this.camera.position, gameDt <= 0);
    // The survivor's body, arms and light move by world time (or the active vehicle camera when driving).
    if (this.editor.active) {
      this.editor.update(frameDt);
    } else if (this.helicopter.piloting && !this.dead) {
      const look = { x: 0, y: 0 };
      this.ctx.input.consumeLook(look);
      this.helicopter.applyCamera(this.camera, look.x);
    } else if (this.vehicles.activeCar && !this.dead) {
      this.vehicles.render(frameDt, this.camera, this.ctx.input);
    } else {
      this.player.render(alpha, gameDt);
      this.vehicles.render(frameDt, this.camera, this.ctx.input);
    }
    const inVehicle = !this.dead && (Boolean(this.vehicles.activeCar) || this.helicopter.piloting);
    document.body.classList.toggle('in-vehicle', inVehicle);
    this.carHud.update();
    const gp = this.player.controller.position;
    this.heliHud.update(this.dead ? null : this.helicopter.nearbyHudState(gp.x, gp.y, gp.z));
    this.firearms.render(gameDt);
    {
      const fa = this.firearms;
      let hurtAngle: number | null = null;
      if (this.hitFrom) {
        const c = this.player.controller;
        const dx = this.hitFrom.x - c.position.x;
        const dz = this.hitFrom.z - c.position.z;
        // 0 ahead (−Z rotated by yaw), + to the right.
        hurtAngle = Math.atan2(dx, -dz) + c.yaw;
        hurtAngle = Math.atan2(Math.sin(hurtAngle), Math.cos(hurtAngle));
      }
      this.gunHud.update(gameDt, {
        gun: this.dead || inVehicle ? null : fa.hud(),
        fov: this.camera.fov,
        sinceUse: fa.sinceUse,
        hitMark: fa.hitMark,
        hitMarkT: fa.hitMarkT,
        noise: fa.lastNoise,
        hurtAngle,
        hurtT: this.hitFromT,
        quick: this.inventory.quick,
        hand: this.inventory.hand,
        touch: this.ctx.input.mode === 'touch',
        inVehicle,
      });
    }
    if (this.death) this.renderDeath(gameDt);
    // After the camera moved: the zombies in its view, up to the fog (paused: their mixers and twitches too).
    this.models.update(this.zombies.list, this.player.controller.position, gameDt, this.camera, (this.scene.fog as Fog).far + 2);
    this.camera.getWorldDirection(this.lookDir);
    this.ctx.profiler.begin('chunks');
    this.chunks.update(this.camera.position.x, this.camera.position.z, this.lookDir.x, this.lookDir.z);
    this.ctx.profiler.end('chunks');
    const qp = this.ctx.quality.preset;
    const shadowDist = this.player.lightOn && qp.level === 'high' && qp.shadowMapSize > 0 ? qp.shadowDistance : 0;
    const carLodDist = qp.level === 'low' ? 16 : qp.level === 'medium' ? 28 : 42;
    this.chunks.updateDetail(this.camera.position.x, this.camera.position.z, shadowDist, carLodDist);
    this.interaction.render(frameDt);
    this.drawSearchZones(frameDt);
    this.interiors.update(
      frameDt,
      this.player.controller.position.x,
      this.player.controller.position.z,
      this.player.controller.position.y,
      this.lookDir.x,
      this.lookDir.z,
    );
    this.doors.update(gameDt);
    const p = this.player.controller.position;
    const zone = this.chunks.zoneAt(p.x, p.z);
    this.life.update(frameDt, this.camera, p, !this.indoors, zone === 'downtown' || zone === 'town' || zone === 'suburb', this.ctx.loop.paused);
    const paused = this.ctx.loop.paused;
    const wa = this.life.windDirection;
    const wind = 0.3 + this.life.windGust * 2.4;
    this.weather.update(frameDt, this.camera.position, Math.cos(wa) * wind, Math.sin(wa) * wind, !this.indoors, this.lookDir.y, paused);
    this.life.rain = this.weather.rain;
    this.life.hour = this.clock.hour;
    this.atmo.setSnow(this.weather.snowAccum);
    this.atmo.update(gameDt, p, this.indoors, wa, this.life.windGust, {
      eye: this.camera.position,
      look: this.lookDir,
      flashlight: this.player.lightOn,
      daylight: this.clock.daylight,
      felt: this.felt,
      speed: this.player.controller.speed,
      sprinting: this.player.controller.sprinting,
      crouched: this.player.controller.crouched,
      urban: zone === 'downtown' || zone === 'town',
      rain: this.weather.rain,
      camera: this.camera,
      sunDir: _sunDir.copy(this.moon.position).sub(this.moon.target.position).normalize(),
      sunColor: _sunColor.copy(this.moon.color).multiplyScalar(this.moon.intensity * this.clock.daylight),
      fogFar: (this.scene.fog as Fog).far,
    });
    this.applyDaylight(this.clock.daylight);
    // Lightning lights the world for a moment; fog thickens at night and in the rain, clears slowly by day.
    this.ambient.intensity = this.ambientBase + this.weather.flash * 2.2;
    const fogWant = (ATMO.night.fogNight + (1 - ATMO.night.fogNight) * this.clock.daylight) * (1 - (1 - ATMO.night.fogRain) * this.weather.rain) * (1 - 0.72 * this.weather.fog);
    this.fogK += (fogWant - this.fogK) * Math.min(1, gameDt / ATMO.night.fogLag);
    const sceneFog = this.scene.fog as Fog;
    sceneFog.near = NIGHT.fogNear * (1 - 0.65 * this.weather.fog);
    sceneFog.far = Math.max(15, this.drawDistFogFar() * this.fogK);
    this.indoorK += ((this.indoors ? 1 : 0) - this.indoorK) * Math.min(1, gameDt * 1.5);
    (this.scene.fog as Fog).color.copy(this.scene.background as Color).lerp(_indoorHaze, 0.85 * this.indoorK);
    this.landmarks.update(gameDt, this.camera.position, this.scene.fog as Fog);
    this.noteT -= gameDt;
    if (this.noteT <= 0) {
      // The lab notes quote the code of the lab nearby.
      this.noteT = 2;
      const site = nearestPoi(this.layout, 'lab', Math.floor(this.camera.position.x / CHUNK), Math.floor(this.camera.position.z / CHUNK), 12);
      if (site) labCode(this.layout.seed, site).split('-').forEach((d, k) => (NOTE_VARS[`lab${k + 1}`] = d));
    }
    this.farSmoke.update(gameDt, this.camera.position, this.scene.fog as Fog, this.clock.daylight, this.life.windDirection, this.life.windGust);
    const ws = 0.0005 + this.life.windGust * 0.001;
    this.sky.wind.set(Math.cos(wa) * ws, 0, Math.sin(wa) * ws);
    this.sky.update(frameDt, this.camera, this.ctx.loop.paused);
    const cp = this.camera.position;
    sfx.setListener(cp.x, cp.y, cp.z, this.lookDir.x, this.lookDir.y, this.lookDir.z);
    if (gameDt > 0) sfx.update(gameDt);
    this.saveT += gameDt;
    if (gameDt > 0 && this.saveT >= AUTOSAVE_INTERVAL) this.save();
    if (this.prewarming) {
      this.atmo.keepPrewarmVisible();
      this.life.keepPrewarmVisible();
      this.doors.keepPrewarmVisible();
    }
  }

  /** Day / night: sky, fog, ambient, sun or moon, clouds, lit windows, the arms' own lights. */
  private applyDaylight(k: number): void {
    const key = Math.round(k * 200);
    if (key === this.lightKey) return;
    this.lightKey = key;
    const sky = (this.scene.background as Color).set(NIGHT.sky).lerp(_dayColor.set(DAY.sky), k);
    const fog = this.scene.fog as Fog;
    fog.color.copy(sky);
    fog.near = NIGHT.fogNear + (DAY.fogNear - NIGHT.fogNear) * k;
    this.ambient.color.set(NIGHT.hemi.sky).lerp(_dayColor.set(DAY.hemi.sky), k);
    this.ambient.groundColor.set(NIGHT.hemi.ground).lerp(_dayColor.set(DAY.hemi.ground), k);
    this.ambientBase = NIGHT.hemi.intensity + (DAY.hemi.intensity - NIGHT.hemi.intensity) * k;
    this.moon.color.set(NIGHT.moon.color).lerp(_dayColor.set(DAY.sun.color), k);
    this.moon.intensity = NIGHT.moon.intensity + (DAY.sun.intensity - NIGHT.moon.intensity) * k;
    this.moon.position.set(-30 + 10 * k, 40 + 30 * k, -10 + 20 * k);
    this.sky.daylight = k;
    this.sky.skyColor = sky;
    this.life.daylight = k;
    this.player.viewmodel.setDaylight(k);
  }

  /**
   * What a patch of ground grows (Foliage): nothing under a roof or in a building, grass on open ground,
   * weeds in the cracks of paving, more along the curbs.
   */
  private groundKind(x: number, z: number): Ground {
    const y = this.layout.walkHeightAt(x, z);
    if (this.shelters.covers(x, z, y + 0.6) || this.interiors.buildingAt(x, z)) return Ground.None;
    const li = Math.round(x / CHUNK);
    const lj = Math.round(z / CHUNK);
    const rx = Math.abs(x - li * CHUNK);
    const rz = Math.abs(z - lj * CHUNK);
    const bi = Math.floor(x / CHUNK);
    const bj = Math.floor(z / CHUNK);
    const hasRoadX = this.layout.roadX(li, bj) || (rz <= BAND && (this.layout.roadX(li, lj) || this.layout.roadX(li, lj - 1)));
    const hasRoadZ = this.layout.roadZ(bi, lj) || (rx <= BAND && (this.layout.roadZ(li, lj) || this.layout.roadZ(li - 1, lj)));
    const onCurbX = hasRoadX && rx >= ROAD_HALF - 0.1 && rx <= ROAD_HALF + 0.22;
    const onCurbZ = hasRoadZ && rz >= ROAD_HALF - 0.1 && rz <= ROAD_HALF + 0.22;
    if ((hasRoadX && rx < ROAD_HALF - 0.1) || (hasRoadZ && rz < ROAD_HALF - 0.1)) return Ground.Paved;
    if (onCurbX || onCurbZ) return Ground.Curb;
    if ((hasRoadX && rx <= BAND) || (hasRoadZ && rz <= BAND)) {
      const urban = this.layout.isUrban(bi, bj) || this.layout.isUrban(li, lj) || this.layout.isUrban(li - 1, lj) || this.layout.isUrban(li, lj - 1);
      return urban ? Ground.Paved : Ground.Grass;
    }
    const site = this.layout.poi(bi, bj);
    if (site) {
      if (site.kind !== 'park') return Ground.Paved;
      // Park: lawns inside the four quadrants only; keep crossing paths & central fountain paved.
      const lx = Math.abs(x - (site.i + 0.5) * CHUNK);
      const lz = Math.abs(z - (site.j + 0.5) * CHUNK);
      return lx < 1.4 || lz < 1.4 || Math.hypot(lx, lz) < 3.2 ? Ground.Paved : Ground.Grass;
    }
    const zone = this.chunks.zoneAt(x, z);
    if (zone === 'downtown' || zone === 'town') return Ground.Paved;
    return zone === 'suburb' && y > 0.05 ? Ground.Paved : Ground.Grass;
  }

  /** What the feet are on: glass shards, a building's floor or stairs, pavement, road, grass (with fallback to last valid surface). */
  private surfaceAt(x: number, z: number, y: number): StepSurface {
    const raw = this.resolveSurfaceAt(x, z, y);
    if (raw) {
      this.lastValidSurface = raw;
      return raw;
    }
    return this.lastValidSurface;
  }

  private resolveSurfaceAt(x: number, z: number, y: number): StepSurface | null {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return null;
    if (this.life.onShards(x, z, y)) return 'glass';
    const b = this.interiors.buildingAt(x, z);
    if (b) {
      if (inStairCore(b, x, z)) return b.kind === 'offices' ? 'metal' : 'concrete';
      if (Math.round(y / FLOOR_H) <= 0) return 'tile';
      return b.kind === 'offices' ? 'tile' : 'wood';
    }
    if (y > 0.35) {
      const underfoot = this.player.surfaceAlong(this._surfOrig.set(x, y + 0.35, z), this._surfDown, 0.7);
      if (underfoot === 'metal' || underfoot === 'trim') return 'metal';
      if (underfoot === 'wood' || underfoot === 'roof') return 'wood';
      if (underfoot === 'glass' || underfoot === 'windowGlass') return 'glass';
      if (!underfoot && this.lastValidSurface) return this.lastValidSurface;
    }
    const zone = this.chunks.zoneAt(x, z);
    if (this.indoors) return zone === 'town' ? 'tile' : 'wood';

    // Mirror WorldLayout.walkHeightAt + buildChunk exactly so parks, yards, roads, and sidewalks match footsteps.
    const li = Math.round(x / CHUNK);
    const lj = Math.round(z / CHUNK);
    const dx = Math.abs(x - li * CHUNK);
    const dz = Math.abs(z - lj * CHUNK);
    const bi = Math.floor(x / CHUNK);
    const bj = Math.floor(z / CHUNK);
    if (dx <= BAND && dz <= BAND) {
      if (this.layout.roadX(li, lj) || this.layout.roadZ(li, lj) || this.layout.roadX(li, lj - 1) || this.layout.roadZ(li - 1, lj)) {
        if (dx <= ROAD_HALF || dz <= ROAD_HALF) return 'asphalt';
        const urbanCorner = this.layout.isUrban(li, lj) || this.layout.isUrban(li - 1, lj) || this.layout.isUrban(li, lj - 1) || this.layout.isUrban(li - 1, lj - 1);
        return urbanCorner ? 'concrete' : 'asphalt';
      }
    } else if (dx <= BAND && this.layout.roadX(li, bj)) {
      if (dx <= ROAD_HALF) return 'asphalt';
      return this.layout.urbanX(li, bj) ? 'concrete' : 'grass';
    } else if (dz <= BAND && this.layout.roadZ(bi, lj)) {
      if (dz <= ROAD_HALF) return 'asphalt';
      return this.layout.urbanZ(bi, lj) ? 'concrete' : 'grass';
    }

    const site = this.layout.poi(bi, bj);
    if (site) return site.kind === 'park' ? 'grass' : 'concrete';
    if (this.layout.isDowntown(bi, bj)) return 'concrete';
    return 'grass';
  }

  saveSummary() {
    const day = Math.floor(this.clock.minutes / 1440) + 1;
    const dayMin = Math.floor(((this.clock.minutes % 1440) + 1440) % 1440);
    const hh = String(Math.floor(dayMin / 60)).padStart(2, '0');
    const mm = String(dayMin % 60).padStart(2, '0');
    return {
      hasSave: !this.isNewGame && !this.dead,
      day,
      time: `${hh}:${mm}`,
      kills: this.skills.kills,
      health: Math.round(this.survival.health * 100),
    };
  }

  saveNow(): Promise<void> {
    return this.dead || this.creating ? Promise.resolve() : this.save();
  }

  async resetSave(): Promise<void> {
    await this.saves.clear();
  }

  needsFreshReset(): boolean {
    return (
      !this.isNewGame ||
      this.dead ||
      this.twins.length > 0 ||
      this.bodies.length > 0 ||
      this.clock.minutes > this.bornAt + 2 ||
      this.playerArmed
    );
  }

  /** Complete wipe & world regeneration into character creation (?menu=0, fresh seed). */
  async startFreshGame(): Promise<void> {
    this.dead = false;
    await this.saves.clear();
    const nextUrl = new URL(location.href);
    const nextSeed = ((this.layout.seed + 137 + Math.floor(Math.random() * 9000)) | 0) || DEFAULT_SEED + 1;
    nextUrl.searchParams.set('seed', String(nextSeed));
    nextUrl.searchParams.set('menu', '0');
    nextUrl.searchParams.delete('editor');
    location.assign(nextUrl.toString());
  }

  /**
   * «Новый персонаж» from the inventory: full clean reset of character, stats, inventory, and world,
   * restarting straight into character creation for a new session.
   */
  async newCharacter(): Promise<void> {
    await this.startFreshGame();
  }

  private save(): Promise<void> {
    if (this.creating) return Promise.resolve();
    this.saveT = 0;
    const c = this.player.controller;
    return this.saves.save({
      player: { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.yaw, battery: this.player.battery },
      stats: this.survival.serialize(),
      inventory: this.inventory.serialize(),
      containers: this.containers.serialize(),
      ground: this.ground.serialize(),
      clock: this.clock.minutes,
      character: { appearance: this.look, classId: this.classId, traits: this.traits },
      dead: this.dead || undefined,
      twins: this.twins,
      bodies: this.bodies,
      bornAt: this.bornAt,
      boards: this.doors.serializeBoards(),
      unlocked: this.doors.serializeUnlocked(),
      powered: [...this.powered],
      skills: this.skills.serialize(),
      kills: this.skills.kills,
      meta: this.meta,
      map: this.mapMemory.serialize(),
      base: this.base.serialize(),
      story: this.story.serialize(),
      cars: this.vehicles.serialize(),
      playerArmed: this.playerArmed || undefined,
      corpses: (() => {
        const c = this.containers.serializeCorpses();
        return c.length ? c : undefined;
      })(),
      tripwires: (() => {
        const tw = this.tripwires.serialize();
        return tw.length ? tw : undefined;
      })(),
      heli: this.helicopter.serialize(),
    });
  }

  /** New game: the character editor over the paused world (?editor=0 skips it with the default survivor). */
  async createCharacter(): Promise<void> {
    if (!this.isNewGame || new URLSearchParams(location.search).get('editor') === '0') {
      if (this.isNewGame) this.skills.start(this.classId, this.meta.legacy);
      this.applyClass();
      this.giveTestLoadout();
      return;
    }
    // The editor covers everything; afterwards the usual start screen (PC: click to play) shows.
    this.ctx.loop.pause('editor');
    this.creating = true;
    const choice = await new CharacterEditor(document.getElementById('ui')!, () => describeXp(this.meta.legacy)).open();
    this.applyChoice(choice);
    this.giveTestLoadout();
    this.creating = false;
    this.ctx.loop.resume('editor');
    this.save();
  }

  /** Test build (VITE_TEST_LOADOUT=melee) or ?loadout=melee: every melee weapon in the bag, room made for them. */
  private giveTestLoadout(): void {
    if (import.meta.env.VITE_TEST_LOADOUT !== 'melee' && new URLSearchParams(location.search).get('loadout') !== 'melee') return;
    const inv = this.inventory;
    for (const id of ['axe', 'bat', 'crowbar', 'knife', 'hammer'] as const) {
      if (inv.count(id) > 0 || inv.hand === id) continue;
      if (inv.room(id) < 1) inv.capacity += ITEMS[id].weight;
      inv.add(id, 1);
    }
    this.syncBody();
  }

  /** Looks, class, uniform or starter outfit (with its color), the class kit. */
  private applyChoice(choice: CharacterChoice): void {
    this.isNewGame = false;
    this.dead = false;
    this.playerArmed = false;
    this.look = { ...choice.appearance };
    this.classId = choice.classId;
    this.traits = [...choice.traits];
    // A new survivor doesn't know the city: a blank map, except the active story target.
    this.mapMemory.clear();
    const c = this.player.controller;
    c.position.copy(SPAWN);
    c.prevPosition.copy(SPAWN);
    c.yaw = SPAWN_YAW;
    c.velocity.set(0, 0, 0);
    this.story.init(c.position.x, c.position.z, this.story.serialize());
    const cls = classDef(choice.classId);
    const worn = choiceWorn(choice);
    this.inventory.restore({ stacks: cls.items.map(([id, n]) => [id, n] as [typeof id, number]), hand: cls.hand, worn, wornTint: choiceTint(choice) });
    this.skills.start(this.classId, this.meta.legacy);
    this.applyClass();
    this.giveDebug();
    this.syncBody();
    if (this.inventory.hasAnyGun()) this.playerArmed = true;
  }

  /** ?give=rifle_m4a1,mod_suppressor (or all, guns, mods, melee): the guns loaded and in hand, for checking them (weapons/give.ts). */
  private giveDebug(): void {
    const list = new URLSearchParams(location.search).get('give');
    if (list) giveLoadout(this.inventory, list);
  }

  /**
   * The player's blow at its contact frame: the nearest zombie in reach along the view (no wall between)
   * takes the weapon's damage — double on the head — with the class's strength. True if one was hit.
   */
  private strikeZombie(item: string): boolean {
    const cfg = item === 'fists' ? FISTS : HELD_CFG[item as HeldId];
    if (!cfg || cfg.damage[1] <= 0) return false;
    const o = this.camera.getWorldPosition(_so);
    const d = this.camera.getWorldDirection(_sd);
    const bHit = this.bandits.hitTest(o, d, cfg.reach);
    const res = this.zombies.hitTest(o, d, cfg.reach);
    if (bHit && (!res || bHit.dist < res.dist)) {
      const wall = this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, bHit.dist);
      if (wall >= 0 && wall < bHit.dist - 0.1) return false;
      const strength = this.mods().strength * this.skills.damage(item);
      const dmg = blowDamage(cfg.damage, strength, bHit.head, Math.random());
      const killed = this.bandits.hit(bHit.bot, dmg, o.x, o.z, bHit.head, bHit.zone);
      this.skills.add(weaponSkill(item), XP.hit + (killed ? XP.kill : 0));
      if (killed) this.skills.kills++;
      sfx.strike(STRIKE_SOUND[item] ?? 'blunt', bHit.point, bHit.head, killed);
      this.particles.burst(bHit.point, bHit.head ? 14 : 10);
      this.weaponBlow();
      return true;
    }
    if (!res) return false;
    const wall = this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, res.dist);
    if (wall >= 0 && wall < res.dist - 0.1) return false;
    const strength = this.mods().strength * this.skills.damage(item);
    const dmg = blowDamage(cfg.damage, strength, res.head, Math.random());
    const killed = this.zombies.hit(res.zombie, dmg, o.x, o.z, res.head, res.point);
    this.skills.add(weaponSkill(item), XP.hit + (killed ? XP.kill : 0));
    if (killed) this.skills.kills++;
    sfx.strike(STRIKE_SOUND[item] ?? 'blunt', res.point, res.head, killed);
    this.particles.burst(res.point, res.head ? 14 : 10);
    this.weaponBlow();
    return true;
  }

  private breakGlassAt(at: Vector3, dir: Vector3): void {
    this.world.breakGlassAt(at.x, at.y, at.z, 0.65);
    const floorAt = (gx: number, gz: number) => this.interiors.surfaceY(gx, gz, at.y) ?? this.layout.walkHeightAt(gx, gz);
    const floorY = floorAt(at.x, at.z);
    sfx.glassBreak(at, { x: at.x, y: floorY + 0.05, z: at.z });
    this.particles.burst(at, 10, 0.7);
    this.life.burstGlassShards(at.x, at.y, at.z, dir.x, dir.y, dir.z, 18, floorY);
    const hLen = Math.hypot(dir.x, dir.z);
    const hx = hLen > 1e-4 ? dir.x / hLen : 0;
    const hz = hLen > 1e-4 ? dir.z / hLen : 1;
    // Spawn broken glass decals + crunchy step trigger zones on BOTH sides of the window (indoor & outdoor).
    for (const sign of [-1, 1] as const) {
      const sx = at.x + hx * 1.1 * sign;
      const sz = at.z + hz * 1.1 * sign;
      const sy = floorAt(sx, sz);
      this.life.addDynamicShards(sx, sy, sz, 2.2);
    }
  }

  /** Shatters car windshields/side/rear glass on upper-cabin hits with zero allocations, else triggers metal car hit. */
  private handleVehicleBulletHit(at: Vector3, dir: Vector3, playSound: boolean): 'glass' | 'metal' | null {
    const v = this.glbPool.findVehicleAt(at.x, at.y, at.z);
    if (!v) return null;
    const noGlass = v.id === 'Semi_Trailer_Cargo_20' || v.id === 'zsu_23_4_shilka_14k' || v.id === 'burned_car_wreck';
    const inGlassZone =
      !noGlass &&
      (v.id === 'Semi_Truck_Tractor_24'
        ? v.localZ < v.hl * 0.12 && at.y > v.y + 1.95 && at.y < v.y + 3.2
        : at.y > v.y + v.H * 0.55);
    if (inGlassZone) {
      if (playSound) sfx.glassBreak(at, { x: at.x, y: v.y + 0.05, z: at.z });
      this.life.burstGlassShards(at.x, at.y, at.z, -dir.x, 0.25, -dir.z, 16, v.y);
      this.life.addDynamicShards(at.x - dir.x * 0.55, v.y, at.z - dir.z * 0.55, 1.4);
      this.life.addGlassCrackDecal(at.x, at.y, at.z, -dir.x, -dir.y, -dir.z, 0.44);
      this.atmo.carHit(at.x, at.y, at.z);
      return 'glass';
    }
    return 'metal';
  }

  /** A blow of the weapon in hand landed: it wears, and at the end of its blows it breaks. */
  private weaponBlow(): void {
    const id = this.inventory.hand;
    if (!id || !this.inventory.wearHand(this.skills.wear(id))) return;
    this.ctx.hud.toast(`${tr('Сломалось', 'Broke')}: ${ITEMS[id].name}`, 1800);
    sfx.item('move');
    this.syncBody();
  }

  /** Which modelled kind a new zombie at (x, z) is (src/world/zombieKinds.ts). */
  private kindAt(x: number, z: number, pick: number): ModelKind {
    return zombieKindAt(this.layout, this.chunks.zoneAt(x, z), x, z, pick);
  }

  /**
   * A zombie dies: its ragdoll (among the walls, cars and furniture round it) starts from its model's pose
   * and drives the model's bones.
   */
  private zombieRagdoll(z: Zombie): void {
    const start = z.death && this.models.deathStart(z);
    if (!start) return;
    const boxes: StaticBox[] = [];
    this.world.boxesNear(z.pos.x, z.pos.z, 1.6, (b) => boxes.push(b));
    const rd = zombieRagdoll(z, start, boxes, (gx, gz, gy) => this.interiors.surfaceY(gx, gz, gy) ?? this.layout.walkHeightAt(gx, gz));
    this.ragdolls.add(rd);
    this.corpseRd.set(z, rd);
    // Too many corpses drawn: the oldest goes, with its ragdoll and what could be searched on it.
    const { evicted } = this.models.addCorpse(z, rd);
    const old = evicted !== null && [...this.corpseRd.keys()].find((x) => x.id === evicted);
    if (!old || old.twin) return;
    this.ragdolls.remove(this.corpseRd.get(old)!);
    this.corpseRd.delete(old);
    this.containers.removeLoose(ZOMBIE_BODY_ID + old.id);
  }

  /**
   * A zombie's blow: it lands on a body part; the clothes on that part may stop the teeth (a bruise), or
   * it is a scratch or a bite — a bleeding wound, and maybe the infection.
   */
  private bitten(damage: number, from: Vector3, many = 1): void {
    if (this.sleeping) this.wake(tr('Вас укусили во сне!', 'You were bitten in your sleep!'));
    const r = Math.random();
    const part: BodyPart = r < 0.15 ? 'head' : r < 0.5 ? 'torso' : r < 0.8 ? 'arms' : 'legs';
    const outcome = this.survival.bitten(part, partArmor(this.inventory.worn, part));
    const hp = outcome === 'blocked' ? damage * 0.25 : outcome === 'scratch' ? damage * 0.7 : damage;
    sfx.attacked(outcome, many);
    this.ctx.hud.toast(
      outcome === 'blocked'
        ? `${tr('Одежда выдержала', 'Clothing held')}: ${PART_NAMES[part]}`
        : outcome === 'bite'
          ? `${tr('Укус', 'Bite')}: ${PART_NAMES[part]}`
          : `${tr('Царапина', 'Scratch')}: ${PART_NAMES[part]}`,
      1400,
    );
    this.hurt(hp, tr('Вас загрызли', 'Mauled by zombies'), true, from);
  }

  /** Fire burns whoever comes too close; a torn cable shocks (sparks fly). Damage comes in pulses. */
  private hazards(dt: number, at: Vector3): void {
    const h = this.dead ? null : this.atmo.hazard(at.x, at.y, at.z);
    if (!h) {
      this.hazardHp = 0;
      return;
    }
    this.hazardHp += dt * (h.kind === 'fire' ? 6 + 22 * (1 - h.d / h.r) : 30);
    if (h.kind === 'shock' && Math.random() < dt * 8) this.particles.sparks(at.x, at.y + 0.9, at.z, 5);
    if (this.hazardHp >= 4) {
      this.hurt(this.hazardHp, h.kind === 'fire' ? tr('Сгорели', 'Burned to death') : tr('Убило током', 'Electrocuted'), true);
      this.hazardHp = 0;
    }
  }

  private hazardHp = 0;

  /** The player takes `hp` of 100 (a bite, a fall); clothes soften bites. */
  /** Indoors, an alley (walls close on both sides) or the open street: the echo of a shot. */
  private echoPlace(): EchoPlace {
    if (this.indoors) return 'indoor';
    const c = this.camera.position;
    const yaw = this.player.controller.yaw;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const l = this.world.rayHit(c.x, c.y, c.z, -rx, 0, -rz, 7);
    const r = this.world.rayHit(c.x, c.y, c.z, rx, 0, rz, 7);
    return l >= 0 && r >= 0 ? 'alley' : 'street';
  }

  /** A blast sets the cars within `r` burning for a minute or so (fire spots like the base's fires). */
  private igniteCars(x: number, _y: number, z: number, r: number): void {
    for (const car of this.atmo.carsNear(x, z, r)) {
      const key = -2_000_000 - (this.carFireN++ % 100_000);
      const y = this.layout.walkHeightAt(car.x, car.z);
      const fx = new Float32Array([LIFE.fire, car.x, y + 0.9, car.z, 0, 1, 0.8, 0, Math.random(), 0]);
      this.life.add(key, fx);
      this.atmo.add(key, fx);
      this.carFires.push({ key, t: 60 + Math.random() * 40 });
    }
  }

  private hurt(hp: number, cause: string, ignoreArmor = false, from?: Vector3): void {
    if (this.dead) return;
    if (from) {
      this.hitFrom = from.clone();
      this.hitFromT = 0;
    }
    const armor = ignoreArmor ? 0 : Math.min(0.5, (wornStat(this.inventory.worn, 'bite') / 4) * 0.6);
    this.survival.health = Math.max(0, this.survival.health - (hp * (1 - armor)) / 100);
    this.survival.anxiety = Math.min(1, this.survival.anxiety + 0.08);
    this.player.hurt(Math.min(1, hp / 15));
    sfx.ouch(hp / 15);
    this.deathCause = cause;
    if (this.survival.health <= 0) this.die(cause, from);
  }

  /** Dead survivors near the player get up as zombies (once, until killed). */
  private twinsNear(p: Vector3): void {
    for (const t of this.twins) {
      if (this.twinZombies.has(t.id) || Math.hypot(t.x - p.x, t.z - p.z) > 70) continue;
      const z = this.zombies.spawnAt(t.x, t.z, 'idle', t.kind ?? twinKind({}, this.classId), t.y);
      z.twin = { id: t.id, x: t.x, y: t.y, z: t.z, colors: t.colors };
      if (t.costume !== undefined) z.costume = t.costume;
      if (t.gear) z.gear = t.gear;
      this.twinZombies.set(t.id, z);
    }
  }

  /** A twin killed: their body stays where it fell, with everything they had. */
  private lootTwin(z: Zombie): void {
    const i = this.twins.findIndex((t) => t.id === z.twin!.id);
    if (i < 0) return;
    const t = this.twins[i];
    this.twins.splice(i, 1);
    this.twinZombies.delete(t.id);
    const ref: ContainerRef = { id: t.id, type: 'bodyTwin', x: z.pos.x, z: z.pos.z, y: z.pos.y, zone: this.chunks.zoneAt(z.pos.x, z.pos.z) };
    this.bodies.push(ref);
    this.containers.addLoose(ref, t.items);
    this.save();
  }

  /**
   * Death (as in Project Zomboid): the survivor rises again as a zombie in their clothes with their things;
   * the screen says how it ended; a new survivor starts. The world, its opened containers and the twins stay.
   */
  private die(cause: string, killer?: Vector3): void {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause || this.deathCause;
    // The arms go; the whole survivor falls as a ragdoll and the camera rises over them. No input, no
    // touch buttons, no "click to play" while it plays.
    this.player.startDeath();
    this.ctx.events.emit('ui:modal', { open: true });
    for (const el of document.querySelectorAll<HTMLElement>('.touch, .crosshair')) el.style.visibility = 'hidden';
    const c = this.player.controller;
    const feet = c.position.clone();
    const boxes: StaticBox[] = [];
    this.world.boxesNear(feet.x, feet.z, 4, (b) => boxes.push(b));
    this.camera.updateMatrixWorld();
    const inv = this.inventory;
    this.death = new PlayerDeath(this.scene, {
      look: this.look,
      classId: this.classId,
      worn: inv.worn,
      dirt: inv.wornDirt,
      tint: inv.wornTint,
      hand: inv.hand,
      feet,
      yaw: c.yaw,
      velocity: c.velocity.clone(),
      eye: this.camera.getWorldPosition(new Vector3()),
      eyeQ: this.camera.getWorldQuaternion(new Quaternion()),
      killer: killer ?? null,
      boxes,
      around: this.deathSurroundings(feet),
    });
    this.ragdolls.add(this.death.ragdoll, true);
    const items: ItemStack[] = inv.stacks.map((s) => ({ ...s }));
    if (inv.hand) items.push({ id: inv.hand, count: 1 });
    for (const slot of WEAR_SLOTS) {
      const id = inv.worn[slot];
      if (id) items.push({ id, count: 1, dirt: inv.wornDirt[slot], ...(inv.wornTint[slot] !== undefined ? { tint: inv.wornTint[slot] } : {}) });
    }
    const life = Math.max(0, this.clock.minutes - this.bornAt);
    this.meta = {
      legacy: this.skills.bequeath(this.meta.legacy),
      deaths: this.meta.deaths + 1,
      bestLife: Math.max(this.meta.bestLife, life),
      kills: this.meta.kills + this.skills.kills,
    };
    const color = (slot: WearSlot) => { const id = inv.worn[slot]; return id ? (inv.wornTint[slot] ?? ITEMS[id].wear?.color ?? null) : null; };
    const bodyId = 2_000_000_000 + Math.floor(Math.random() * 1e8);
    if (this.survival.infection >= 1) {
      // Only infection deaths turn into a wandering zombie twin.
      this.twins.push({ id: bodyId, x: feet.x, y: feet.y, z: feet.z, colors: [color('torso') ?? 0x8a8478, color('legs') ?? 0x5a5448, 0x7a8274], items, kind: twinKind(inv.worn, this.classId, this.look.sex), costume: this.look.sex === 'male' ? ((inv.worn.outfit && ITEMS[inv.worn.outfit].wear?.costume) ?? null) : null, gear: wornGear(inv.worn) });
    } else {
      // Killed by bandits, wounds, or exhaustion: leave a lootable corpse right where the player died.
      const ref: ContainerRef = {
        id: bodyId,
        type: 'bodyTwin',
        x: feet.x,
        z: feet.z,
        y: feet.y,
        zone: this.chunks.zoneAt(feet.x, feet.z),
        box: [feet.x, feet.y + 0.2, feet.z, 0.7, 0.25, 0.45, c.yaw],
      };
      this.bodies.push(ref);
      this.containers.addLoose(ref, items);
    }
    this.save();
  }

  /**
   * The level round the body for the death camera: walls, cars, furniture and trunks (the colliders), tree
   * crowns, and indoors the ceiling (the storey's, or the roof's if lower).
   */
  private deathSurroundings(feet: Vector3): DeathSurroundings {
    const indoors = this.shelters.covers(feet.x, feet.z, feet.y + 1) || this.interiors.buildingAt(feet.x, feet.z) !== null;
    const roof = this.shelters.roofAt(feet.x, feet.z, feet.y + 1);
    const ceiling = indoors ? Math.min(roof ?? Infinity, feet.y + FLOOR_H - 0.2) : null;
    const crowns: number[] = [];
    this.atmo.vegetation.crownsNear(feet.x, feet.z, 30, (x, y, z, r) => crowns.push(x, y, z, r + 0.3));
    return deathSurroundings(this.world, feet.y, ceiling, crowns);
  }

  /** The generator started: the lab's electronic locks let go, its lamps come on; remembered. */
  private powerLab(x: number, z: number): void {
    const key = blockKey(x, z);
    if (this.powered.has(key)) return;
    this.powered.add(key);
    const i = Math.floor(x / CHUNK);
    const j = Math.floor(z / CHUNK);
    this.doors.releaseLock('labPower', i * CHUNK, j * CHUNK, (i + 1) * CHUNK, (j + 1) * CHUNK);
    this.labLights();
    this.story.onPowerLab(x, z);
    const site = this.layout.poi(i, j);
    if (site && site.kind === 'lab') {
      const [bx, bz] = siteToWorld(site, 0, -12);
      const hasBoss = this.zombies.list.some(
        (z) => z.state !== 'dead' && z.kind === 'patientZero' && Math.hypot(z.pos.x - bx, z.pos.z - bz) < 55,
      );
      if (!hasBoss) {
        this.zombies.spawnAt(bx, bz, 'chase', 'patientZero');
      }
      this.ctx.hud.toast(
        tr('Внимание: из изолятора вырвался Пациент Ноль!', 'Warning: Patient Zero broke out of containment!'),
        3600,
      );
    }
    this.save();
  }

  /** Lamps of every powered lab: real lights for the nearest (WorldLife's pool), a glowing panel each. */
  private labLights(): void {
    const lamps: number[] = [];
    const panels: BufferGeometry[] = [];
    for (const key of this.powered) {
      const [i, j] = key.split(',').map(Number);
      const site = this.layout.poi(i, j);
      if (!site || site.kind !== 'lab') continue;
      for (const [lx, lz] of LAB_LIGHTS) {
        const [x, z] = siteToWorld(site, lx, lz);
        lamps.push(x, LAB_H - 0.35, z);
        const g = new BoxGeometry(site.r & 1 ? 0.35 : 1.2, 0.04, site.r & 1 ? 1.2 : 0.35);
        g.translate(x, LAB_H - 0.08, z);
        panels.push(g);
      }
    }
    this.life.powered = lamps;
    // The emergency lights and the sparking cables of the powered labs (world-life spots of their own).
    const spots: number[] = [];
    for (const key of this.powered) {
      const [i, j] = key.split(',').map(Number);
      const site = this.layout.poi(i, j);
      if (!site || site.kind !== 'lab') continue;
      for (const [lx, y, lz] of LAB_EMERGENCY) {
        const [x, z] = siteToWorld(site, lx, lz);
        spots.push(LIFE.beacon, x, y, z, 0, 1, 0.7, 6, (x * 0.13 + z * 0.07) % 1, 0);
      }
      for (const [lx, y, lz] of LAB_SPARKS) {
        const [x, z] = siteToWorld(site, lx, lz);
        spots.push(LIFE.sparks, x, y, z, 0, 1, 1, 0, 0, 0);
      }
    }
    const fx = new Float32Array(spots);
    this.life.add(LAB_FX_KEY, fx);
    this.atmo.add(LAB_FX_KEY, fx);
    if (this.labPanels) {
      this.labPanels.geometry.dispose();
      this.labPanels.removeFromParent();
      this.labPanels = null;
    }
    if (panels.length) {
      this.labPanels = new Mesh(mergeGeometries(panels)!, new MeshBasicMaterial({ color: 0xe6eef4 }));
      for (const g of panels) g.dispose();
      this.labPanels.name = 'labPanels';
      this.scene.add(this.labPanels);
    }
  }

  private drawSearchZones(dt: number): void {
    // No wireframe box on anything searchable (furniture, desks, containers, vehicles, bodies): the [E]
    // prompt alone marks the focus. ?interactdebug=1 still draws the zones below.
    this.searchOutline.visible = false;
    if (this.zoneDebug && (this.zoneDebugT -= dt) <= 0) {
      this.zoneDebugT = 0.5;
      const c = this.player.controller.position;
      this.zoneDebug.geometry.dispose();
      this.zoneDebug.geometry = boxEdges(this.containers.boxesNear(c.x, c.z, 25));
    }
  }

  /** The death as it plays: the figure on its ragdoll, the camera, colour, sound; then the screen. */
  private renderDeath(gameDt: number): void {
    const d = this.death!;
    if (gameDt > 0) d.update(gameDt);
    d.place();
    const cam = d.camera;
    this.camera.position.copy(cam.position);
    this.camera.quaternion.copy(cam.quaternion);
    this.ctx.fx.setDeath(Math.min(1, cam.t / 4), cam.fade);
    sfx.setMuffle(Math.min(1, cam.t / 2.5) * 0.85);
    this.dread.dying(cam.t, cam.fade);
    if (cam.done && !this.deathShown) {
      this.deathShown = true;
      this.showDeathScreen(this.deathCause);
    }
  }

  /** ?zdebug=1, K: kill the zombie in front (a random blow), or bring one if there is none. */
  private debugKey(): void {
    const c = this.player.controller;
    const z = this.debugZombie;
    if (z && z.state !== 'dead') {
      const weapons = [FISTS, HELD_CFG.knife, HELD_CFG.hammer, HELD_CFG.bat, HELD_CFG.axe];
      const cfg = weapons[Math.floor(Math.random() * weapons.length)];
      const head = Math.random() < 0.3;
      // Lethal whatever it is; how hard it lands is the weapon's.
      z.hp = 0.5;
      const dmg = (head ? 2 : 1) * cfg.damage[1];
      const a = Math.random() * Math.PI * 2;
      const point = z.pos.clone().add(new Vector3(0, head ? 1.6 : 0.9 + Math.random() * 0.5, 0));
      this.zombies.hit(z, dmg, z.pos.x + Math.sin(a) * 1.5, z.pos.z + Math.cos(a) * 1.5, head, point);
      return;
    }
    const f = new Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const x = c.position.x + f.x * 2.6;
    const zz = c.position.z + f.z * 2.6;
    this.debugZombie = this.zombies.spawnAt(x, zz, 'idle', undefined, c.position.y);
    this.debugZombie.yaw = Math.atan2(-f.x, -f.z);
  }

  private showDeathScreen(cause: string): void {
    this.ctx.loop.pause('menu');
    if (document.pointerLockElement) document.exitPointerLock();
    const minutes = Math.max(0, this.clock.minutes - this.bornAt);
    const days = Math.floor(minutes / 1440);
    const n10 = days % 10;
    const n100 = days % 100;
    const el = document.createElement('div');
    el.className = 'death-screen';
    el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000;color:#d8d2c4;font:16px/1.4 system-ui,sans-serif;text-align:center';
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:14px';
    const btn = document.createElement('button');
    btn.className = 'death-screen__new';
    btn.style.cssText = 'margin-top:10px;padding:12px 26px;font:inherit;font-size:18px;background:#3a3630;color:#eee;border:1px solid #6a6458;border-radius:4px;cursor:pointer';
    btn.addEventListener('click', () => {
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.set('menu', '0');
      nextUrl.searchParams.delete('editor');
      location.assign(nextUrl.toString());
    });
    const menu = btn.cloneNode() as HTMLButtonElement;
    menu.className = 'death-screen__menu';
    menu.addEventListener('click', () => location.replace(location.pathname));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
    row.append(btn, menu);
    const toggle = langToggle();
    toggle.style.marginTop = '6px';
    const renderDeathText = () => {
      const word =
        n10 === 1 && n100 !== 11 ? 'день' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'дня' : 'дней';
      const lived = tr(`Вы прожили ${days} ${word}`, `You survived ${days} ${days === 1 ? 'day' : 'days'}`);
      const cText = translateCause(cause || this.deathCause);
      const risen = tr(
        'Ваш выживший поднялся и бродит там, где упал. В его одежде и с его вещами.',
        'Your survivor has risen and wanders where they fell. In their clothes and with their belongings.',
      );
      body.innerHTML = `<div style="font-size:34px;letter-spacing:2px">${lived}</div><div style="opacity:.85">${this.look.name} · ${classDef(this.classId).name}</div><div style="opacity:.6">${cText}</div><div style="opacity:.6;max-width:420px">${risen}</div>${this.lifeSummary()}`;
      btn.textContent = tr('Новый персонаж', 'New character');
      menu.textContent = tr('В меню', 'Main menu');
    };
    renderDeathText();
    onLangChange(renderDeathText);
    el.append(body, row, toggle);
    (document.getElementById('ui') ?? document.body).append(el);
  }

  /**
   * What is in front of the eye that isn't a container: the built things first, then a tap, then a bed.
   * Its prompt, and what E does.
   */
  private spotHere(): { text: string; act: boolean; run(): void } | null {
    const eye = this.camera.getWorldPosition(_so);
    const dir = this.camera.getWorldDirection(_sd);
    const carSpot = this.vehicles.spotAt(eye, dir);
    if (carSpot) return carSpot;
    const inv = this.inventory;
    const hud = this.ctx.hud;
    // The built thing nearest the line of sight, within 2 m.
    let built: Placed | null = null;
    let bd = 2.2;
    for (const p of this.base.list) {
      if (p.kind === 'stash' || Math.abs(p.y - (eye.y - 1.5)) > 1.8) continue;
      const dx = p.x - eye.x;
      const dz = p.z - eye.z;
      const d = Math.hypot(dx, dz);
      if (d < bd && (dx * dir.x + dz * dir.z) / Math.max(d, 1e-3) > 0.55) {
        bd = d;
        built = p;
      }
    }
    if (built) {
      const p = built;
      if (p.kind === 'fire') {
        const kindle = inv.count('lighter') + inv.count('matches') > 0;
        if (p.fuel > 0) {
          const h = Math.max(1, Math.round(p.fuel / 60));
          if (inv.count('planks') === 0)
            return { text: tr(`Костёр горит ещё ~${h} ч`, `Campfire burns for ~${h} h`), act: false, run() {} };
          return {
            text: tr(`Подбросить доску (горит ещё ~${h} ч)`, `Add plank (burns for ~${h} h)`),
            act: true,
            run: () => {
              inv.remove('planks', 1);
              p.fuel = Math.min(p.fuel + BASE.plank, 12 * 60);
              sfx.item('drop');
              hud.toast(tr('Огонь разгорелся', 'Fire flared up'), 1000);
            },
          };
        }
        if (inv.count('planks') === 0 || !kindle)
          return {
            text: tr('Потухший костёр: нужна доска и спички', 'Dead campfire: needs plank and matches'),
            act: false,
            run() {},
          };
        return {
          text: tr('Разжечь костёр снова', 'Relight campfire'),
          act: true,
          run: () => {
            inv.remove('planks', 1);
            if (inv.count('lighter') === 0) inv.remove('matches', 1);
            p.fuel = BASE.fire;
            this.base.version++;
            hud.toast(tr('Костёр горит', 'Campfire lit'), 1000);
          },
        };
      }
      if (p.kind === 'barrel') {
        const n = Math.floor(p.water);
        if (n < 1) return { text: tr('Сборник пуст — ждите дождя', 'Collector empty — wait for rain'), act: false, run() {} };
        if (inv.count('emptyBottle') > 0)
          return {
            text: tr(`Набрать дождевой воды (${n})`, `Collect rainwater (${n})`),
            act: true,
            run: () => {
              const k = Math.min(n, inv.count('emptyBottle'), inv.room('dirtyWater'));
              if (k < 1) return hud.toast(tr('Рюкзак переполнен', 'Backpack is full'), 1000);
              inv.remove('emptyBottle', k);
              inv.add('dirtyWater', k);
              p.water -= k;
              sfx.item('drink');
              hud.toast(tr(`Набрано бутылок: ${k}`, `Bottles filled: ${k}`), 1200);
            },
          };
        return {
          text: tr(`Попить дождевой воды (${n})`, `Drink rainwater (${n})`),
          act: true,
          run: () => {
            p.water -= 1;
            sfx.item('drink');
            hud.toast(this.survival.consume(ITEMS.dirtyWater), 1400);
          },
        };
      }
      if (p.kind === 'trap') {
        if (p.armed) return { text: tr('Растяжка натянута', 'Tripwire armed'), act: false, run() {} };
        return {
          text: tr('Натянуть растяжку снова', 'Re-arm tripwire'),
          act: true,
          run: () => {
            p.armed = true;
            this.base.version++;
            sfx.item('cloth');
          },
        };
      }
    }
    if (this.atmo.tapNear(eye, dir)) {
      if (!(this.gridState?.water ?? true)) return { text: tr('Кран сухой', 'Tap is dry'), act: false, run() {} };
      const bottles = inv.count('emptyBottle');
      return {
        text: bottles
          ? tr(`Попить и набрать воды (${bottles})`, `Drink and fill water (${bottles})`)
          : tr('Попить из крана', 'Drink from tap'),
        act: true,
        run: () => {
          this.survival.thirst = Math.max(0, this.survival.thirst - TAP_DRINK);
          sfx.item('drink');
          const k = Math.min(bottles, inv.room('water'));
          if (k > 0) {
            inv.remove('emptyBottle', k);
            inv.add('water', k);
          }
          hud.toast(
            k > 0
              ? tr(`Вы напились и набрали бутылок: ${k}`, `Drank water and filled bottles: ${k}`)
              : tr('Вы напились из-под крана', 'Drank from the tap'),
            1300,
          );
        },
      };
    }
    if (this.atmo.bedNear(eye, dir))
      return { text: tr('Лечь спать', 'Go to sleep'), act: true, run: () => this.sleep(true) };
    const pos = this.player.controller.position;
    const heliPrompt = this.helicopter.interactPrompt(pos.x, pos.y, pos.z, this.inventory);
    if (heliPrompt) {
      return {
        text: heliPrompt.replace(/^E — /, ''),
        act: !this.helicopter.crashed && heliPrompt.startsWith('E — '),
        run: () => {
          this.helicopter.interact(pos.x, pos.y, pos.z, this.inventory);
        },
      };
    }
    const storySpot = this.story.spotAt(eye.x, eye.z);
    if (storySpot) return storySpot;
    return null;
  }

  /** Victory screen when the survivor completes Act IV ("Protocol Dawn") or escapes via the Mi-8 Secret Ending. */
  private showVictoryScreen(ending: 'dawn' | 'heli' = 'dawn'): void {
    this.ctx.loop.pause('menu');
    this.ctx.events.emit('ui:modal', { open: true });
    if (document.pointerLockElement) document.exitPointerLock();
    const minutes = Math.max(0, this.clock.minutes - this.bornAt);
    const days = Math.floor(minutes / 1440);
    const el = document.createElement('div');
    el.className = 'victory-screen';
    el.style.cssText =
      'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(8,10,12,0.94);color:#d8d2c4;font:16px/1.45 system-ui,sans-serif;text-align:center;padding:20px';
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;max-width:540px';
    const keepBtn = document.createElement('button');
    keepBtn.style.cssText =
      'margin-top:8px;padding:12px 24px;font:inherit;font-size:16px;background:#3e523a;color:#eee;border:1px solid #769c6e;border-radius:4px;cursor:pointer';
    keepBtn.addEventListener('click', () => {
      this.survival.health = 1;
      this.survival.anxiety = 0;
      el.remove();
      this.ctx.loop.resume('menu');
      this.ctx.events.emit('ui:modal', { open: false });
      this.ctx.requestPointerLock();
      this.save();
    });
    const ngBtn = document.createElement('button');
    ngBtn.style.cssText =
      'margin-top:8px;padding:12px 24px;font:inherit;font-size:16px;background:#3a3630;color:#eee;border:1px solid #6a6458;border-radius:4px;cursor:pointer';
    ngBtn.addEventListener('click', async () => {
      const life = Math.max(0, this.clock.minutes - this.bornAt);
      this.meta = {
        legacy: this.skills.bequeath(this.meta.legacy),
        deaths: this.meta.deaths,
        bestLife: Math.max(this.meta.bestLife, life),
        kills: this.meta.kills + this.skills.kills,
      };
      this.dead = true;
      await this.save();
      location.reload();
    });
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
    row.append(keepBtn, ngBtn);
    const toggle = langToggle();
    toggle.style.marginTop = '6px';
    const renderText = () => {
      const title =
        ending === 'heli'
          ? tr('СЕКРЕТНАЯ КОНЦОВКА: ВОЗДУШНАЯ ЭВАКУАЦИЯ', 'SECRET ENDING: AIR EVACUATION')
          : tr('ПРОТОКОЛ «РАССВЕТ» ВЫПОЛНЕН', 'PROTOCOL "DAWN" COMPLETE');
      const sub =
        ending === 'heli'
          ? tr(
              'Восстановленный Ми-8 ЭМЕРКОМ пересёк внешний периметр карантинной зоны. Город и орды мертвецов остаются далеко внизу в тумане — вы прорвались к свободе по воздуху.',
              'Your repaired Mi-8 EMERCOM crossed the outer quarantine perimeter. The dead city fades into the mist below — you broke free through the skies.',
            )
          : tr(
              'Эвакуационный борт сел на взлётную полосу. Контейнер «Гелиос-0» и журналы лаборатории переданы группе биозащиты — у тех, кто остался за периметром, появился шанс создать антидот.',
              'The extraction chopper touched down on the runway. Container "Helios-0" and the laboratory logs were handed over to the bio-containment team — giving those beyond the perimeter a chance to synthesize an antidote.',
            );
      const stat = tr(
        `Дней в карантине: ${days} · Убито заражённых: ${this.skills.kills}`,
        `Days in quarantine: ${days} · Infected killed: ${this.skills.kills}`,
      );
      const tag =
        ending === 'heli'
          ? tr('БОРТ МИ-8 ЭМЕРКОМ // ПЕРИМЕТР ПРОЙДЕН', 'MI-8 EMERCOM // PERIMETER CLEARED')
          : tr('БОРТ ЭВАКУАЦИИ // СЕКТОР ЧИСТ', 'EXTRACTION CHOPPER // SECTOR CLEAR');
      body.innerHTML = `<div style="font-size:12px;letter-spacing:0.14em;color:#d8a248">${tag}</div><div style="font-size:30px;font-weight:700;letter-spacing:1.5px;color:#eee6d4">${title}</div><div style="opacity:.88">${this.look.name} · ${classDef(this.classId).name}</div><div style="opacity:.78;font-size:15px">${sub}</div><div style="opacity:.65;font-size:14px">${stat}</div>`;
      keepBtn.textContent = tr('Остаться в городе (свободная игра)', 'Stay in the city (freeplay)');
      ngBtn.textContent = tr('Эвакуироваться (новый выживший + наследие)', 'Evacuate (new survivor + legacy)');
    };
    renderText();
    onLangChange(renderText);
    el.append(body, row, toggle);
    (document.getElementById('ui') ?? document.body).append(el);
    this.save();
  }

  /** Puts what was built down in front of the survivor; an error, or null. */
  private placeBuilt(kind: PlacedKind): string | null {
    const c = this.player.controller;
    const fx = -Math.sin(c.yaw);
    const fz = -Math.cos(c.yaw);
    const x = c.position.x + fx * 1.2;
    const z = c.position.z + fz * 1.2;
    const y = c.position.y;
    const roof = this.shelters.covers(x, z, y);
    if (kind === 'fire' && roof)
      return tr('Костёр в доме — задохнётесь. Разведите снаружи.', 'Campfire indoors — you will suffocate. Build it outside.');
    if (kind === 'barrel' && roof)
      return tr('Под крышей дождь не наберётся: поставьте снаружи.', 'Rain cannot collect under a roof: place it outside.');
    if (this.base.near(x, y, z, 0.9)) return tr('Здесь уже что-то стоит', 'Something is already placed here');
    // Free ground there and a clear line to it (with room for its size): not into a wall or a car.
    _so.set(x, y, z);
    this.world.resolveCircle(_so, 0.45, 1.2);
    const reach = 1.2 + 0.55;
    const low = this.world.rayHit(c.position.x, y + 0.4, c.position.z, fx, 0, fz, reach);
    const mid = this.world.rayHit(c.position.x, y + 1.0, c.position.z, fx, 0, fz, reach);
    if (Math.hypot(_so.x - x, _so.z - z) > 0.05 || (low >= 0 && low < reach) || (mid >= 0 && mid < reach))
      return tr('Не помещается: отойдите от стены', 'Not enough room: step away from the wall');
    const p = this.base.add(kind, x, y, z, Math.atan2(fx, fz));
    if (kind === 'stash') this.containers.addLoose(stashRef(p), []);
    this.save();
    return null;
  }

  /** Fires burn, collectors fill, tripwires ring — by game time (asleep it runs fast); the fires into the world's flames. */
  private updateBase(dt: number): void {
    this.baseProps.update();
    if (this.baseFx !== this.base.version) {
      this.baseFx = this.base.version;
      const fires = this.base.list.filter((p) => p.kind === 'fire' && p.fuel > 0);
      const fx = new Float32Array(fires.length * 10);
      fires.forEach((p, i) => fx.set([LIFE.fire, p.x, p.y + 0.05, p.z, 0, 1, 0.32, 0, (p.id * 0.37) % 1, 0], i * 10));
      this.life.add(BASE_FX_KEY, fx);
      this.atmo.add(BASE_FX_KEY, fx);
    }
    this.baseT -= dt;
    if (this.baseT > 0) return;
    this.baseT = 0.25;
    if (this.baseClock < 0) this.baseClock = this.clock.minutes;
    const minutes = this.clock.minutes - this.baseClock;
    this.baseClock = this.clock.minutes;
    if (this.base.list.length === 0) return;
    const near = this.zombies.list.filter((z) => z.state !== 'dead').map((z) => ({ x: z.pos.x, z: z.pos.z }));
    const p = this.player.controller.position;
    this.base.update(minutes, this.weather.rain, (x, z) => !this.shelters.covers(x, z, 0), near, (t) => {
      sfx.street('rattle', { x: t.x, y: t.y + 0.3, z: t.z });
      this.zombies.noiseAt(t.x, t.y, t.z, BASE.trapNoise);
      if (Math.hypot(t.x - p.x, t.z - p.z) < 70)
        this.ctx.hud.toast(tr('Звякнули банки на растяжке', 'Cans rattled on the tripwire'), 1600);
      if (this.sleeping) this.wake(tr('Вас разбудил звон банок!', 'The rattling cans woke you up!'));
    });
  }

  /** Lie down: in a bed it restores fully; not with zombies about, nor too frightened, nor rested. */
  private sleep(bed: boolean): void {
    const s = this.survival;
    const c = this.player.controller.position;
    if (this.dead || this.sleeping) return;
    if (this.zombies.threat(c) > 0.02)
      return this.ctx.hud.toast(tr('Нельзя спать: рядом зомби', 'Cannot sleep: zombies nearby'), 1500);
    if (s.anxiety > 0.65)
      return this.ctx.hud.toast(tr('Слишком тревожно — не уснуть', 'Too anxious to sleep'), 1500);
    if (s.fatigue < 0.2) return this.ctx.hud.toast(tr('Спать не хочется', 'Not tired enough to sleep'), 1200);
    const el = document.createElement('div');
    el.className = 'sleep';
    document.getElementById('ui')!.append(el);
    this.sleeping = { bed, el };
    this.ctx.events.emit('ui:busy', { busy: true });
    this.updateSleep(0);
  }

  private wake(why: string): void {
    if (!this.sleeping) return;
    this.sleeping.el.remove();
    this.sleeping = null;
    this.ctx.events.emit('ui:busy', { busy: false });
    this.ctx.hud.toast(why, 2200);
    this.save();
  }

  /** Asleep: the clock runs fast, the body rests; a zombie near, a move or a key wakes you. */
  private updateSleep(dt: number): void {
    const z = this.sleeping;
    if (!z) return;
    const input = this.ctx.input;
    if (Math.abs(input.moveX) + Math.abs(input.moveY) > 0.3 || input.consumePressed('use') || input.consumePressed('attack') || input.consumePressed('jump'))
      return this.wake(tr('Вы проснулись', 'You woke up'));
    const m = SLEEP_RATE * dt;
    this.clock.minutes += m;
    this.survival.sleep(m, z.bed);
    const c = this.player.controller.position;
    if (this.zombies.threat(c) > 0.08)
      return this.wake(tr('Шорох рядом — вы проснулись!', 'Rustling nearby — you woke up!'));
    if (this.survival.fatigue <= (z.bed ? 0.01 : 0.31))
      return this.wake(
        z.bed
          ? tr('Вы выспались', 'You are well rested')
          : tr('Спать на полу — так себе: вы проснулись разбитым', 'Sleeping on the floor is rough: you woke up sore'),
      );
    if (this.survival.hunger > 0.85 || this.survival.thirst > 0.85)
      return this.wake(tr('Голод разбудил вас', 'Hunger woke you up'));
    z.el.textContent = `${tr('Сон', 'Sleeping')} · ${this.clock.label}`;
  }

  /** The map opens round the survivor (wider with orientation); M / the button opens it. */
  private updateMap(dt: number): void {
    if (this.ctx.input.consumePressed('map') && !this.dead) {
      this.mapPanel.open();
      return;
    }
    this.mapTimer -= dt;
    if (this.mapTimer > 0) return;
    this.mapTimer = 0.5;
    const pc = this.player.controller.position;
    this.mapMemory.explore(pc.x, pc.z, MAP_SEEN * this.skills.apply(this.mods()).orientation);
  }

  /**
   * The hordes: loud things the player does (running, hammering, a fight — the noise past 0.6) carry to
   * them; near ones spill into the crowd, up to half again the quality's zombie count.
   */
  private updateHordes(dt: number): void {
    if (!this.hordesOn || this.dead) return;
    const c = this.player.controller;
    this.hordeEar -= dt;
    if (c.noise > 0.6 && this.hordeEar <= 0) {
      this.hordeEar = 2;
      this.hordes.hear(c.position.x, c.position.z, c.noise * 30);
    }
    const room = Math.ceil(this.zombies.target * 1.5) - this.zombies.alive;
    this.hordes.update(dt, c.position.x, c.position.z, room, (x, z, tx, tz, drawn) => this.zombies.spawnSpill(x, z, tx, tz, drawn));
  }

  /** The power, then the water, go out across the city at their minute (said once, as it happens). */
  private updateGrid(): void {
    const power = this.clock.minutes < this.grid.powerOff;
    const water = this.clock.minutes < this.grid.waterOff;
    const was = this.gridState;
    if (was && was.power === power && was.water === water) return;
    this.gridState = { power, water };
    this.life.power = power;
    this.atmo.setUtilities(power, water);
    if (!was) return;
    if (was.power && !power) {
      this.ctx.hud.toast(tr('Свет погас во всём городе', 'Power went out across the city'), 3500);
      sfx.item('move');
    }
    if (was.water && !water)
      this.ctx.hud.toast(tr('Из кранов больше не течёт вода', 'Water is no longer running from the taps'), 3500);
  }

  /** The death screen's lines: kills, what was learnt, what the next survivor inherits, the world's records. */
  private lifeSummary(): string {
    const learnt = SKILLS.filter((s) => this.skills.level(s.id) > 0).map((s) => `${s.name} ${this.skills.level(s.id)}`).join(' · ');
    const legacy = describeXp(this.meta.legacy);
    const best = Math.floor(this.meta.bestLife / 1440);
    const line = (t: string, o = 0.75) => `<div style="opacity:${o};max-width:520px">${t}</div>`;
    return (
      line(`${tr('Убито зомби', 'Zombies killed')}: ${this.skills.kills}`) +
      (learnt ? line(`${tr('Навыки', 'Skills')}: ${learnt}`) : '') +
      line(
        legacy
          ? `${tr('Следующий выживший унаследует', 'Next survivor will inherit')}: ${legacy}`
          : tr('Наследия пока нет: навыки растут от дела', 'No legacy yet: skills grow by doing'),
        0.9,
      ) +
      line(
        tr(
          `Погибших в этом мире: ${this.meta.deaths} · лучшая жизнь: ${best} дн. · всего убито: ${this.meta.kills}`,
          `Deaths in this world: ${this.meta.deaths} · longest life: ${best} d · total killed: ${this.meta.kills}`,
        ),
        0.5,
      )
    );
  }

  /** Class modifiers into the systems that use them. */
  /** The class with the traits on top (skills come on top of these in applyMods). */
  private mods(): ClassMods {
    return withTraits(classMods(this.classId), this.traits);
  }

  private applyClass(): void {
    this.inventory.capacity = BACKPACK_CAPACITY + this.mods().carry;
    this.skills.learnMul = traitLearn(this.traits);
    this.applyMods();
    this.panel.setAppearance(this.look, this.classId);
  }

  /** The class's multipliers with the skills on top, into the systems (again on every level). */
  private applyMods(): void {
    const m = this.skills.apply(this.mods());
    this.survival.mods = m;
    this.interaction.searchMul = m.searchSpeed;
    this.interaction.carMul = m.carSearch;
    this.interaction.boardMul = 1 / m.barricade;
    this.player.controller.noiseMul = m.stealth;
  }

  dispose(): void {
    document.body.classList.remove('in-vehicle');
    sfx.setOcclusionCheck(null);
    sfx.setLootLoop(false);
    this.editor.dispose();
    this.firearms.dispose();
    this.tripwires.dispose();
    this.bandits.dispose();
    this.gunHud.dispose();
    this.carHud.dispose();
    this.heliHud.dispose();
    this.helicopter.dispose();
    this.vehicles.dispose();
    this.models.dispose();
    this.baseProps.dispose();
    this.particles.dispose();
    this.glbPool?.dispose();
    this.atmo.dispose();
    this.weather.dispose();
    this.landmarks.dispose();
    this.farSmoke.dispose();
    for (const off of this.unsubs) off();
    this.ctx.debug.delete('player');
    this.ctx.debug.delete('world');
    this.ctx.debug.delete('survival');
    this.player.dispose();
    this.life.dispose();
    this.chunks.dispose();
    for (const m of this.pinnedMaterials) m.dispose();
    for (const t of this.pinnedTextures) t.dispose();
    this.pinnedMaterials.length = 0;
    this.pinnedTextures.length = 0;
  }

  private drawDistFogFar(): number {
    const d = this.ctx.settings.data.drawDistance;
    return d === 'near' ? 42 : d === 'medium' ? 66 : 115;
  }

  private applyQuality(): void {
    const preset = this.ctx.quality.preset;
    this.interiors.maxLoaded = preset.interiors;
    this.life.clothEnabled = preset.lifeCloth;
    this.life.roomLights = preset.roomLights;
    this.sky.searchlightLight = preset.roomLights > 0;
    this.life.fireLights = preset.fireLights;
    this.ragdolls.limit = preset.level === 'low' ? 2 : 4;
    this.models.configure(preset.level);
    // Sub-cell meshes (12 calls per chunk) only pay off on a desktop GPU; phones are draw-call bound.
    // ?splitcells=1 / =0 forces the mode, so the two can be A/B'd on a phone without a rebuild.
    const splitQ = new URLSearchParams(location.search).get('splitcells');
    setSubCellSplit(splitQ === null ? preset.level === 'high' && this.ctx.device.type === 'desktop' : splitQ === '1');
    const isLow = preset.level === 'low';
    this.vehicles?.setAnisotropy(isLow ? 1 : Math.min(8, this.ctx.renderer.gl.capabilities.getMaxAnisotropy()));
    this.bandits?.setMaxActive(isLow ? 4 : 10);
    this.applySettings();
  }

  private applySettings(): void {
    const s = this.ctx.settings.data;
    const preset = this.ctx.quality.preset;
    this.resize(this.ctx.renderer.width, this.ctx.renderer.height);
    this.ctx.loop.targetFps = s.fpsCap;
    this.ctx.quality.adaptive = s.adaptiveRes;
    this.interiors.maxLoaded = s.interiorsLimit;

    const fogFar = this.drawDistFogFar();
    (this.scene.fog as Fog).far = Math.max(15, fogFar * this.fogK);
    this.camera.far = fogFar + 5;
    this.camera.updateProjectionMatrix();

    const chunksQ = new URLSearchParams(location.search).get('chunks');
    this.chunks.radius = chunksQ !== null ? Math.max(0, Number(chunksQ) || 0) : s.drawDistance === 'far' ? 2 : 1;

    // ?foliage=0 keeps cost-isolation override working alongside user settings.
    const foliageForcedOff = new URLSearchParams(location.search).get('foliage') === '0';
    const folPreset = QUALITY_PRESETS[s.foliageQuality === 'off' ? 'low' : s.foliageQuality];
    const foliageCap = foliageForcedOff || s.foliageQuality === 'off' ? 0 : folPreset.foliage.cap;
    this.atmo?.configure(folPreset.foliage.radius, folPreset.foliage.cell, foliageCap);
    // Keep alphaToCoverage shader state aligned with the active preset's MSAA so toggling foliage never recompiles shaders.
    const baseVariants = preset.level === 'low' ? 1 : Math.max(2, folPreset.vegetation.variants);
    this.atmo?.vegetation.configure(
      s.foliageQuality === 'off' ? { near: 0, mid: 0, fullKeep: 0, midKeep: 0, variants: baseVariants } : { ...folPreset.vegetation, variants: baseVariants },
      this.bootMsaa,
    );

    const shadowForcedOff = new URLSearchParams(location.search).get('shadow') === '0';
    this.ctx.renderer.setShadows(!shadowForcedOff && s.shadows !== 'off');
    this.player.setShadowOverride(s.shadows);
    this.vehicles?.setLowQuality(preset.level === 'low' || s.shadows === 'off');
    this.weather?.setSnowDensity(s.weatherDensity === 'low' ? 0.36 : 1.0);
    this.player.cameraBob = s.cameraBob / 100;
  }

  private resize(width: number, height: number): void {
    if (height === 0) return;
    const aspect = width / height;
    this.camera.aspect = aspect;
    const baseFov = this.ctx.settings.data.fov;
    const maxH = baseFov <= 75 ? MAX_HFOV : MAX_HFOV + (baseFov - 75) * 1.4;
    // Vertical FOV tracks user setting, while keeping portrait/ultra-wide screens undistorted.
    const maxV = (2 * Math.atan(Math.tan((maxH * Math.PI) / 360) / aspect) * 180) / Math.PI;
    this.player.setBaseFov(Math.min(baseFov, maxV));
    this.player.viewmodel.setAspect(width / height);
  }
}

/** How likely the clothes on a part stop a zombie's teeth (0..0.9). */
function partArmor(worn: Worn, part: BodyPart): number {
  const bite = (slot: WearSlot) => {
    const id = worn[slot];
    return id ? (ITEMS[id].wear?.stats.bite ?? 0) : 0;
  };
  const sleeves = worn.torso && ITEMS[worn.torso].wear?.sleeves !== false ? bite('torso') : 0;
  const a = part === 'head' ? bite('head') + bite('face') : part === 'torso' ? bite('torso') + bite('vest') : part === 'arms' ? sleeves * 0.8 + bite('hands') * 0.6 : bite('legs') + bite('feet') * 0.3;
  return Math.min(0.9, a);
}

const CAUSE_PAIRS: readonly [string, string][] = [
  ['Подорвались на своём выстреле', 'Blew yourself up with your own shot'],
  ['Отладка', 'Debug'],
  ['Разбились при падении', 'Fell to your death'],
  ['Заражение: вы обратились', 'Infection: you turned'],
  ['Истощение', 'Exhaustion'],
  ['Раны', 'Wounds'],
  ['Вас загрызли', 'Mauled by zombies'],
  ['Сгорели', 'Burned to death'],
  ['Убило током', 'Electrocuted'],
];

function translateCause(cause: string): string {
  if (!cause) return tr('Неизвестно', 'Unknown');
  for (const [ru, en] of CAUSE_PAIRS) {
    if (cause === ru || cause === en) return tr(ru, en);
  }
  return cause;
}
