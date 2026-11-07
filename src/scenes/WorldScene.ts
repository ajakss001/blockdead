import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import { AnxietyAudio } from '../audio/AnxietyAudio';
import { type FleshBlow, sfx, type StepSurface } from '../audio/Sound';
import { FLOOR_H, inStairCore } from '../world/gen/highrise';
import { CHUNK, DOWNTOWN_RADIUS, ROAD_HALF } from '../world/gen/layout';
import { type SceneKind, sceneAt } from '../world/gen/chaos';
import { type ItemId, type ItemStack, WEAR_SLOTS, type WearSlot, wornStat } from '../data/items';
import type { Worn } from '../systems/Inventory';
import type { GameContext } from '../GameContext';
import { type ClassId, classDef, classMods, type ClassMods, DEFAULT_CLASS } from '../data/classes';
import { sanitizeTraits, type TraitId, traitLearn, withTraits } from '../data/traits';
import { Hordes } from '../systems/Hordes';
import { MAP_SEEN, MapMemory } from '../systems/MapMemory';
import { MapPanel } from '../ui/MapPanel';
import { gridSchedule, type GridSchedule, TAP_DRINK } from '../systems/Utilities';
import { describeXp, emptyMeta, type MetaData, SKILLS, Skills, weaponSkill, XP } from '../systems/Skills';
import { BACKPACK_CAPACITY, ITEMS } from '../data/items';
import { type Appearance, DEFAULT_APPEARANCE, handScale, sanitizeAppearance } from '../player/appearance';
import { outfitFrom } from '../player/outfit';
import { type CharacterChoice, CharacterEditor, choiceTint, choiceWorn } from '../ui/CharacterEditor';
import { Player } from '../player/Player';
import type { RightItem } from '../player/Viewmodel';
import { BUCKETS } from '../render/look/surfaces';
import { worldMaterials } from '../render/look/worldMaterials';
import { airTemperature, Clock, feltTemperature, Shelters } from '../systems/Climate';
import { dirtSteps, soilClothes } from '../systems/Dirt';
import { Containers } from '../systems/Containers';
import { weaponOf } from '../weapons/config';
import { GroundWeapons } from '../weapons/GroundWeapons';
import { Interaction } from '../systems/Interaction';
import { Inventory, type InventoryData } from '../systems/Inventory';
import { SaveGame } from '../systems/SaveGame';
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
import { FarSmoke } from '../render/FarSmoke';
import { Landmarks } from '../render/Landmarks';
import { nearestPoi, POI, type PoiKind, siteToWorld } from '../world/gen/poi';
import { LAB_EMERGENCY, LAB_H, LAB_LIGHTS, LAB_SPARKS } from '../world/gen/poiLab';
import { LIFE } from '../world/gen/lifeKinds';
import { labCode } from '../world/gen/scenarios';
import { NOTE_VARS } from '../data/items';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FISTS, HELD as HELD_CFG, type HeldId } from '../player/held';
import { routeHighrise } from '../world/gen/highrise';
import type { DoorRef } from '../world/Doors';
import { type ContainerRef, searchBox } from '../systems/Containers';
import type { TwinRecord } from '../systems/SaveGame';
import { GrimFog } from '../render/GrimFog';
import { DAY, NIGHT } from '../style/stage';

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
  worn: { head: null, torso: 'hoodie', legs: 'jeans', feet: 'sneakers', back: 'schoolBackpack' },
  battery: 0.6,
};
/** Hand items with a first-person model. */
const HELD: Partial<Record<ItemId, RightItem>> = { knife: 'knife', axe: 'axe', bat: 'bat', crowbar: 'crowbar', hammer: 'hammer' };

/** The procedural, endless world: chunks stream around the player from a seed (?seed=…). */
export class WorldScene implements IScene {
  readonly scene = new Scene();
  // Near 0.1 m (the body keeps the eye 0.3 m off walls): twice the depth precision of 0.05 on phones.
  readonly camera = new PerspectiveCamera(BASE_VFOV, 1, 0.1, 120);
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
  private saves!: SaveGame;
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
  /** Last step index (stepPhase / π) a footstep was played for. */
  private stepN = 0;
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
  private readonly particles = new Particles();
  private atmo!: Atmosphere;
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

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.scene.background = new Color(NIGHT.sky);
    this.scene.fog = new GrimFog(NIGHT.sky, NIGHT.fogNear, ctx.quality.preset.fogFar);
    this.ambient = new HemisphereLight(NIGHT.hemi.sky, NIGHT.hemi.ground, NIGHT.hemi.intensity);
    this.scene.add(this.ambient);
    const moon = new DirectionalLight(NIGHT.moon.color, NIGHT.moon.intensity);
    moon.position.set(-30, 40, -10);
    this.scene.add(moon);
    this.moon = moon;
    this.sky = new Sky(this.scene, NIGHT.sky, moon.position);
    this.sky.groundAt = (x, z) => layout.walkHeightAt(x, z);

    const seed = Number(new URLSearchParams(location.search).get('seed')) || DEFAULT_SEED;
    const layout = new WorldLayout(seed);
    this.layout = layout;
    this.chunks = new ChunkManager(this.scene, this.world, layout, ctx.quality.preset.chunkRadius);
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
    this.doors = new Doors(this.scene, this.world);
    this.interiors = new Interiors(this.scene, this.world, this.chunks, this.containers, this.doors);
    this.chunks.onChunkLoaded = (key, data) => {
      this.containers.addChunk(key, data.zone, data.containers);
      this.interiors.addChunk(key, data.buildings);
      this.shelters.add(key, data.shelters);
      this.doors.add(entranceKey(key), data.doors);
      this.life?.add(key, data.ambient);
      this.atmo?.add(key, data.ambient);
    };
    this.chunks.onChunkUnloaded = (key) => {
      this.containers.removeChunk(key);
      this.interiors.removeChunk(key);
      this.shelters.remove(key);
      this.doors.remove(entranceKey(key));
      this.life?.remove(key);
      this.atmo?.remove(key);
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
        syncBody,
        onClose: () => this.save(),
      },
      document.getElementById('ui')!,
    );
    this.mapPanel = new MapPanel(
      ctx,
      {
        layout: this.layout,
        memory: this.mapMemory,
        player: () => {
          const pc = this.player.controller;
          return { x: pc.position.x, z: pc.position.z, yaw: pc.yaw };
        },
      },
      document.getElementById('ui')!,
    );
    this.interaction = new Interaction(ctx, this.player, this.containers, this.inventory, this.panel, syncBody, this.doors);
    this.interaction.ground = this.ground;
    this.interaction.onSkill = (id, xp) => this.skills.add(id, xp);
    this.grid = gridSchedule(seed);
    this.interaction.tap = {
      near: () => !!this.atmo.tapNear(this.camera.getWorldPosition(_so), this.camera.getWorldDirection(_sd)),
      running: () => this.gridState?.water ?? true,
      drink: () => {
        this.survival.thirst = Math.max(0, this.survival.thirst - TAP_DRINK);
        sfx.item('drink');
      },
    };
    this.skills.onLevel = (s, l) => {
      this.ctx.hud.toast(`Навык «${s.name}»: уровень ${l}`, 2200);
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
    );
    // A blow to a wall: steel strikes sparks, the knife (and a fist) only a little dust; the weapon wears.
    this.player.onStrikeWorld = (x, y, z, item) => {
      this.atmo.strikeAt(x, y, z);
      if (weaponOf(item)?.sparks) this.particles.sparks(x, y, z, 9);
      else this.particles.burst(_wallHit.set(x, y, z), 4, 0.4);
      this.weaponBlow();
    };
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
    this.unsubs.push(
      ctx.events.on('viewport:resize', ({ width, height }) => this.resize(width, height)),
      ctx.events.on('quality:changed', () => this.applyQuality()),
    );

    const c = this.player.controller;
    ctx.debug.set('player', () => {
      const p = c.position;
      const state = c.crouched ? 'присед' : c.sprinting ? 'бег' : c.speed > 0.2 ? 'шаг' : 'стоит';
      return `player ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)}  ${c.speed.toFixed(1)} м/с  ${state}  шум ${c.noise.toFixed(2)}`;
    });
    ctx.debug.set('world', () => {
      const ch = this.chunks;
      return `world seed ${seed}  zone ${ch.zoneAt(c.position.x, c.position.z)}  chunks ${ch.loadedCount} (+${ch.pendingCount})  gen ${ch.lastGenMs.toFixed(0)}ms  colliders ${this.world.boxCount}  interiors ${this.interiors.loadedCount}  doors ${this.doors.count}  этаж ${Math.round(c.position.y / 3.2)}`;
    });
    ctx.debug.set('climate', () => {
      const s = this.survival;
      return `время ${this.clock.label}  ${this.indoors ? 'внутри' : 'снаружи'}  воздух ${this.air.toFixed(1)}°  ощущается ${this.felt.toFixed(1)}°  тело ${s.bodyTemp.toFixed(2)}°  тревога ${Math.round(s.anxiety * 100)}%`;
    });
    ctx.debug.set('hordes', () => {
      const c = this.player.controller.position;
      const near = this.hordes.list.reduce((m, h) => Math.min(m, Math.hypot(h.x - c.x, h.z - c.z)), Infinity);
      return `орды ${this.hordes.list.length} (${this.hordes.total} зомби), ближайшая ${Math.round(near)} м · свет ${this.gridState?.power ? 'есть' : 'нет'} вода ${this.gridState?.water ? 'есть' : 'нет'}`;
    });
    ctx.debug.set('zombies', () => `зомби ${this.zombies.list.length}/${this.zombies.target}  видят ${this.zombies.seeing}  идут за мной ${this.zombies.chasing}  шум ${this.player.controller.noise.toFixed(2)}`);
    ctx.debug.set('survival', () => {
      const v = this.survival;
      const pct = (x: number) => Math.round(x * 100);
      return `hp ${pct(v.health)}  голод ${pct(v.hunger)}  жажда ${pct(v.thirst)}  усталость ${pct(v.fatigue)}  фонарь ${pct(this.player.battery)}  вес ${this.inventory.weight.toFixed(1)}  контейнеры ${this.containers.loadedCount} (открыто ${this.containers.openedCount})`;
    });
  }

  /** First-person body follows the inventory: weapon in the hand, sleeves, trousers, shoes. */
  private syncBody(): void {
    const hand = this.inventory.hand;
    this.player.viewmodel.equip((hand && HELD[hand]) ?? 'fists');
    const outfit = outfitFrom(this.inventory.worn, this.look.skin, this.inventory.wornDirt, this.inventory.wornTint);
    this.player.body.setOutfit(outfit);
    this.player.viewmodel.setSleeves(outfit.sleeves, outfit.skin, outfit.dirt.torso, outfit.gloves, outfit.dirt.hands, handScale(this.look));
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
      if (save.clock !== undefined) this.clock.minutes = save.clock;
      this.bornAt = save.dead ? this.clock.minutes : (save.bornAt ?? this.clock.minutes);
      this.meta = { ...emptyMeta(), ...save.meta };
    }
    if (save && !save.dead) {
      this.isNewGame = false;
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
    const { x, z } = c.position;
    const done = this.chunks.whenLoaded(x, z, 1);
    const pump = window.setInterval(() => this.chunks.update(x, z, 0, 1), 16);
    await done;
    window.clearInterval(pump);
  }

  /**
   * Tiny triangles with each world material right in front of the camera (so none is culled before
   * its shader compiles), plus one shadow-map render for the flashlight's depth shaders.
   */
  prewarm(): () => void {
    const group = new Group();
    const g = new BufferGeometry();
    const tri = (n: number) => new BufferAttribute(new Float32Array(3 * n), n);
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0]), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
    g.setAttribute('color', tri(3));
    g.setAttribute('aSurfUv', tri(2));
    g.setAttribute('aLayer', tri(1));
    g.setAttribute('aPbr', tri(2));
    const mats = worldMaterials();
    for (const bucket of [...BUCKETS, 'castCut'] as const) {
      const m = new Mesh(g, mats[bucket]);
      m.castShadow = bucket === 'cast' || bucket === 'castCut';
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
    this.camera.getWorldDirection(this.lookDir);
    group.position.copy(this.camera.position).addScaledVector(this.lookDir, 0.5);
    this.scene.add(group);
    this.player.prewarmShadows();
    const lifeDone = this.life.prewarm();
    const atmoDone = this.atmo.prewarm();
    return () => {
      lifeDone();
      atmoDone();
      group.removeFromParent();
      g.dispose();
    };
  }

  fixedUpdate(dt: number): void {
    const c = this.player.controller;
    if (this.debugSpawnT > 0 && (this.debugSpawnT -= dt) <= 0) this.debugKey();
    if (this.debugDieT > 0 && (this.debugDieT -= dt) <= 0) {
      const f = new Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
      this.die('Отладка', c.position.clone().addScaledVector(f, 1));
    }
    c.canSprint = this.survival.canSprint;
    c.sprintFactor = this.survival.sprintFactor;
    c.jumpFactor = this.survival.jumpFactor;
    // Tired: the swing is slower.
    this.player.viewmodel.swingRate = 1 - 0.25 * Math.min(1, Math.max(1 - this.survival.stamina, this.survival.fatigue));
    if (!this.dead) this.player.fixedUpdate(dt);
    // Zombies hear and see the player as it is after this step.
    _zs.pos.copy(c.position);
    _zs.eye = c.crouched ? 1.0 : 1.6;
    // Rain drowns footsteps.
    _zs.noise = c.noise * (1 - ATMO.weather.rainMasks * this.weather.rain);
    _zs.crouched = c.crouched;
    _zs.lit = this.player.flashlightOn && this.player.battery > 0 ? 0.7 : 0;
    _zs.daylight = this.clock.daylight;
    _zView.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    this.zombies.update(dt, _zs, _zView);
    this.updateHordes(dt);
    this.updateMap(dt);
    this.pois?.update(dt, c.position.x, c.position.z);
    // Nearest first: in a crowd the sound groups fill up with the zombies that matter.
    const near = (z: { pos: Vector3 }) => (z.pos.x - c.position.x) ** 2 + (z.pos.z - c.position.z) ** 2;
    this.zombies.sounds.sort((a, b) => near(a.z) - near(b.z));
    for (const { z, kind } of this.zombies.sounds) sfx.zombie(kind, { x: z.pos.x, y: z.pos.y + 1.5, z: z.pos.z }, z.pitch);
    for (const a of this.zombies.attacks) this.bitten(a.damage, a.from.pos, this.zombies.attacks.length);
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
      this.containers.addLoose(ref, rollLoot(this.layout.seed, ref.id, type, ref.zone));
    }
    // Zombies are solid to the player (and the walls still win).
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
    this.twinsNear(c.position);
    if (c.fallDamage > 0) this.hurt(c.fallDamage * 100, 'Разбились при падении', true);
    this.hazards(dt, c.position);
    if (c.jumped) this.survival.onJump();
    this.ctx.hud.setStamina(this.survival.stamina);
    // Footsteps on whatever is underfoot; jump and landing.
    const feet = { x: c.position.x, y: c.position.y + 0.05, z: c.position.z };
    const n = Math.floor(c.stepPhase / Math.PI);
    if (n !== this.stepN && !c.airborne && c.speed > 0.3) {
      const wet = this.atmo.puddleAt(feet.x, feet.z, c.position.y);
      if (wet) this.atmo.ripple(feet.x, c.position.y, feet.z);
      sfx.step(wet ? 'water' : this.surfaceAt(feet.x, feet.z, c.position.y), c.crouched ? 'crouch' : c.sprinting ? 'run' : 'walk', feet);
    }
    this.stepN = n;
    if (c.jumped) sfx.jump(feet);
    if (c.landed > 0.8) sfx.land(this.surfaceAt(feet.x, feet.z, c.position.y), feet, c.landed);
    if (!this.dead) this.interaction.fixedUpdate(dt);
    this.clock.update(dt);
    this.updateGrid();
    // Climate: where you are (under a roof or not) and the hour decide the air; clothes and movement the rest.
    this.climateT -= dt;
    if (this.climateT <= 0) {
      this.climateT = 0.25;
      const p = c.position;
      this.indoors = this.shelters.covers(p.x, p.z, p.y);
      this.air = airTemperature(this.clock.hour, this.indoors);
      // Echo: bare rooms ring, the canyon streets downtown a little, open ground hardly at all.
      sfx.setRoom(this.indoors ? 0.38 : this.chunks.zoneAt(p.x, p.z) === 'downtown' ? 0.2 : 0.06);
    }
    this.felt = feltTemperature(this.air, wornStat(this.inventory.worn, 'warmth'), c.speed, c.sprinting);
    // Clothes get dirty: faster running, crawling, rummaging through containers.
    soilClothes(this.inventory, dt, { moving: c.speed > 0.2, sprinting: c.sprinting, crouching: c.crouched && c.speed > 0.2, searching: this.player.busy, weather: 1 });
    if (this.moodleT <= dt && dirtSteps(this.inventory.wornDirt) !== this.dirtShown) this.syncBody();
    // Dark = night without a light of your own (rooms by day get light through the windows).
    const dark = !this.player.lightOn && this.clock.isNight;
    if (!this.dead && c.speed > 0.3) {
      if (c.sprinting) this.skills.add('fitness', XP.sprint * dt);
      else if (c.crouched && this.zombies.threat(c.position) > 0.05) this.skills.add('sneak', XP.sneak * dt);
    }
    this.survival.update(dt, c.speed, c.sprinting, { felt: this.felt, dark, batteryDead: this.player.battery <= 0, threat: this.zombies.threat(c.position) });
    // Anxiety: heartbeat and breath, and the screen edges closing in with every beat.
    const a = this.survival.anxiety;
    if (!this.dead) this.dread.update(dt, a);
    this.ctx.fx.setDread(a * 0.8 + this.dread.pulse * a * 0.25);
    if (this.survival.health <= 0 && !this.dead) this.die(this.survival.infection >= 1 ? 'Заражение: вы обратились' : this.survival.hunger > 0.85 || this.survival.thirst > 0.85 ? 'Истощение' : this.deathCause || 'Раны');
    this.moodleT -= dt;
    if (this.moodleT <= 0) {
      this.moodleT = 0.25;
      this.survival.pushStats(this.ctx.hud, this.player.battery);
    }
  }

  /** gameDt: the world's time this frame, 0 while paused (GameLoop: the one pause check) — the world moves by it. */
  render(alpha: number, frameDt: number, gameDt: number): void {
    this.particles.update(gameDt);
    this.player.render(alpha, frameDt);
    if (this.death) this.renderDeath(gameDt);
    // After the camera moved: the zombies in its view, up to the fog (paused: their mixers and twitches too).
    this.models.update(this.zombies.list, this.player.controller.position, gameDt, this.camera, (this.scene.fog as Fog).far + 2);
    this.camera.getWorldDirection(this.lookDir);
    this.chunks.update(this.camera.position.x, this.camera.position.z, this.lookDir.x, this.lookDir.z);
    this.interaction.render(frameDt);
    this.drawSearchZones(frameDt);
    this.interiors.update(frameDt, this.player.controller.position.x, this.player.controller.position.z, this.player.controller.position.y);
    this.doors.update(frameDt);
    const p = this.player.controller.position;
    const zone = this.chunks.zoneAt(p.x, p.z);
    this.life.update(frameDt, this.camera, p, !this.indoors, zone === 'downtown' || zone === 'town' || zone === 'suburb', this.ctx.loop.paused);
    const paused = this.ctx.loop.paused;
    const wa = this.life.windDirection;
    const wind = 0.3 + this.life.windGust * 2.4;
    this.weather.update(frameDt, this.camera.position, Math.cos(wa) * wind, Math.sin(wa) * wind, !this.indoors, this.lookDir.y, paused);
    this.life.rain = this.weather.rain;
    this.life.hour = this.clock.hour;
    this.atmo.update(gameDt, p, this.indoors, wa, this.life.windGust, {
      eye: this.camera.position,
      look: this.lookDir,
      flashlight: this.player.flashlightOn && this.player.battery > 0,
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
    const fogWant = (ATMO.night.fogNight + (1 - ATMO.night.fogNight) * this.clock.daylight) * (1 - (1 - ATMO.night.fogRain) * this.weather.rain);
    this.fogK += (fogWant - this.fogK) * Math.min(1, gameDt / ATMO.night.fogLag);
    (this.scene.fog as Fog).far = this.ctx.quality.preset.fogFar * this.fogK;
    this.indoorK += ((this.indoors ? 1 : 0) - this.indoorK) * Math.min(1, gameDt * 1.5);
    (this.scene.fog as Fog).color.copy(this.scene.background as Color).lerp(_indoorHaze, 0.85 * this.indoorK);
    this.landmarks.update(frameDt, this.camera.position, this.scene.fog as Fog);
    this.noteT -= frameDt;
    if (this.noteT <= 0) {
      // The lab notes quote the code of the lab nearby.
      this.noteT = 2;
      const site = nearestPoi(this.layout, 'lab', Math.floor(this.camera.position.x / CHUNK), Math.floor(this.camera.position.z / CHUNK), 12);
      if (site) labCode(this.layout.seed, site).split('-').forEach((d, k) => (NOTE_VARS[`lab${k + 1}`] = d));
    }
    this.farSmoke.update(frameDt, this.camera.position, this.scene.fog as Fog, this.clock.daylight, this.life.windDirection, this.life.windGust);
    const ws = 0.0005 + this.life.windGust * 0.001;
    this.sky.wind.set(Math.cos(wa) * ws, 0, Math.sin(wa) * ws);
    this.sky.update(frameDt, this.camera, this.ctx.loop.paused);
    const cp = this.camera.position;
    sfx.setListener(cp.x, cp.y, cp.z, this.lookDir.x, this.lookDir.y, this.lookDir.z);
    if (gameDt > 0) sfx.update(gameDt);
    this.saveT += gameDt;
    if (gameDt > 0 && this.saveT >= AUTOSAVE_INTERVAL) this.save();
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
    // A POI's lot is paved (only weeds in the cracks); a square is all lawn.
    const site = this.layout.poi(Math.floor(x / CHUNK), Math.floor(z / CHUNK));
    if (site) return site.kind === 'park' ? Ground.Grass : Ground.Paved;
    const zone = this.chunks.zoneAt(x, z);
    const rx = Math.abs(x - Math.round(x / CHUNK) * CHUNK);
    const rz = Math.abs(z - Math.round(z / CHUNK) * CHUNK);
    const curb = Math.abs(rx - ROAD_HALF) < 0.35 || Math.abs(rz - ROAD_HALF) < 0.35;
    if (zone === 'downtown' || zone === 'town') return curb ? Ground.Curb : Ground.Paved;
    if (rx < ROAD_HALF || rz < ROAD_HALF) return curb ? Ground.Curb : Ground.Paved;
    return (zone === 'suburb' && y > 0.05) ? Ground.Paved : Ground.Grass;
  }

  /** What the feet are on: glass shards, a building's floor or stairs, pavement, road, grass. */
  private surfaceAt(x: number, z: number, y: number): StepSurface {
    if (this.life.onShards(x, z, y)) return 'glass';
    const b = this.interiors.buildingAt(x, z);
    if (b) {
      if (inStairCore(b, x, z)) return b.kind === 'offices' ? 'metal' : 'concrete';
      if (Math.round(y / FLOOR_H) <= 0) return 'tile';
      return b.kind === 'offices' ? 'tile' : 'wood';
    }
    const zone = this.chunks.zoneAt(x, z);
    if (this.indoors) return zone === 'town' ? 'tile' : 'wood';
    const urban = zone === 'downtown' || zone === 'town' || zone === 'suburb';
    const h = this.layout.walkHeightAt(x, z);
    if (zone === 'downtown' || zone === 'town') return h > 0.035 ? 'concrete' : 'asphalt';
    // Suburbs and the country: the roads on the chunk grid, grass and dirt elsewhere.
    const rx = Math.abs(x - Math.round(x / CHUNK) * CHUNK);
    const rz = Math.abs(z - Math.round(z / CHUNK) * CHUNK);
    if (rx < ROAD_HALF || rz < ROAD_HALF) return 'asphalt';
    return urban && h > 0.05 ? 'concrete' : 'grass';
  }

  private save(): void {
    if (this.creating) return;
    this.saveT = 0;
    const c = this.player.controller;
    void this.saves.save({
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
    const choice = await new CharacterEditor(document.getElementById('ui')!, describeXp(this.meta.legacy)).open();
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
    this.look = { ...choice.appearance };
    this.classId = choice.classId;
    this.traits = [...choice.traits];
    // A new survivor doesn't know the city: a blank map.
    this.mapMemory.clear();
    const cls = classDef(choice.classId);
    const worn = choiceWorn(choice);
    this.inventory.restore({ stacks: cls.items.map(([id, n]) => [id, n] as [typeof id, number]), hand: cls.hand, worn, wornTint: choiceTint(choice) });
    this.skills.start(this.classId, this.meta.legacy);
    this.applyClass();
    this.syncBody();
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
    const res = this.zombies.hitTest(o, d, cfg.reach);
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

  /** A blow of the weapon in hand landed: it wears, and at the end of its blows it breaks. */
  private weaponBlow(): void {
    const id = this.inventory.hand;
    if (!id || !this.inventory.wearHand(this.skills.wear(id))) return;
    this.ctx.hud.toast(`Сломалось: ${ITEMS[id].name}`, 1800);
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
    this.world.boxesNear(z.pos.x, z.pos.z, 2.6, (b) => boxes.push(b));
    const rd = zombieRagdoll(z, start, boxes);
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
    const r = Math.random();
    const part: BodyPart = r < 0.15 ? 'head' : r < 0.5 ? 'torso' : r < 0.8 ? 'arms' : 'legs';
    const outcome = this.survival.bitten(part, partArmor(this.inventory.worn, part));
    const hp = outcome === 'blocked' ? damage * 0.25 : outcome === 'scratch' ? damage * 0.7 : damage;
    sfx.attacked(outcome, many);
    this.ctx.hud.toast(outcome === 'blocked' ? `Одежда выдержала: ${PART_NAMES[part]}` : outcome === 'bite' ? `Укус: ${PART_NAMES[part]}` : `Царапина: ${PART_NAMES[part]}`, 1400);
    this.hurt(hp, 'Вас загрызли', true, from);
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
      this.hurt(this.hazardHp, h.kind === 'fire' ? 'Сгорели' : 'Убило током', true);
      this.hazardHp = 0;
    }
  }

  private hazardHp = 0;

  /** The player takes `hp` of 100 (a bite, a fall); clothes soften bites. */
  private hurt(hp: number, cause: string, ignoreArmor = false, from?: Vector3): void {
    if (this.dead) return;
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
    const outfit = outfitFrom(inv.worn, this.look.skin, inv.wornDirt, inv.wornTint);
    this.twins.push({ id: 2_000_000_000 + Math.floor(Math.random() * 1e8), x: feet.x, y: feet.y, z: feet.z, colors: [outfit.top ?? 0x8a8478, outfit.pants ?? 0x5a5448, this.look.skin], items, kind: twinKind(inv.worn, this.classId, this.look.sex) });
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
    const f = this.dead ? null : this.interaction.focus;
    this.searchOutline.visible = !!f;
    if (f) {
      const b = searchBox(f);
      this.searchOutline.position.set(b[0], b[1], b[2]);
      this.searchOutline.scale.set(b[3] * 2, b[4] * 2, b[5] * 2);
      this.searchOutline.rotation.set(0, b[6], 0);
    }
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
    const word = n10 === 1 && n100 !== 11 ? 'день' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'дня' : 'дней';
    const el = document.createElement('div');
    el.className = 'death-screen';
    el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000;color:#d8d2c4;font:16px/1.4 system-ui,sans-serif;text-align:center';
    el.innerHTML = `<div style="font-size:34px;letter-spacing:2px">Вы прожили ${days} ${word}</div><div style="opacity:.85">${this.look.name} · ${classDef(this.classId).name}</div><div style="opacity:.6">${cause || this.deathCause || 'Неизвестно'}</div><div style="opacity:.6;max-width:420px">Ваш выживший поднялся и бродит там, где упал. В его одежде и с его вещами.</div>${this.lifeSummary()}`;
    const btn = document.createElement('button');
    btn.className = 'death-screen__new';
    btn.textContent = 'Новый персонаж';
    btn.style.cssText = 'margin-top:10px;padding:12px 26px;font:inherit;font-size:18px;background:#3a3630;color:#eee;border:1px solid #6a6458;border-radius:4px;cursor:pointer';
    btn.addEventListener('click', () => location.reload());
    const menu = btn.cloneNode() as HTMLButtonElement;
    menu.className = 'death-screen__menu';
    menu.textContent = 'В меню';
    menu.addEventListener('click', () => location.replace(location.pathname));
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;justify-content:center';
    row.append(btn, menu);
    el.append(row);
    (document.getElementById('ui') ?? document.body).append(el);
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
      this.ctx.hud.toast('Свет погас во всём городе', 3500);
      sfx.item('move');
    }
    if (was.water && !water) this.ctx.hud.toast('Из кранов больше не течёт вода', 3500);
  }

  /** The death screen's lines: kills, what was learnt, what the next survivor inherits, the world's records. */
  private lifeSummary(): string {
    const learnt = SKILLS.filter((s) => this.skills.level(s.id) > 0).map((s) => `${s.name} ${this.skills.level(s.id)}`).join(' · ');
    const legacy = describeXp(this.meta.legacy);
    const best = Math.floor(this.meta.bestLife / 1440);
    const line = (t: string, o = 0.75) => `<div style="opacity:${o};max-width:520px">${t}</div>`;
    return (
      line(`Убито зомби: ${this.skills.kills}`) +
      (learnt ? line(`Навыки: ${learnt}`) : '') +
      line(legacy ? `Следующий выживший унаследует: ${legacy}` : 'Наследия пока нет: навыки растут от дела', 0.9) +
      line(`Погибших в этом мире: ${this.meta.deaths} · лучшая жизнь: ${best} дн. · всего убито: ${this.meta.kills}`, 0.5)
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
    this.panel.setAppearance(this.look);
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
    this.models.dispose();
    this.particles.dispose();
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
  }

  private applyQuality(): void {
    const preset = this.ctx.quality.preset;
    this.interiors.maxLoaded = preset.interiors;
    this.life.clothEnabled = preset.lifeCloth;
    this.life.roomLights = preset.roomLights;
    this.sky.searchlightLight = preset.roomLights > 0;
    this.life.fireLights = preset.fireLights;
    this.atmo?.configure(preset.foliage.radius, preset.foliage.cell, preset.foliage.cap);
    this.atmo?.vegetation.configure(preset.vegetation, preset.msaa > 0);
    (this.scene.fog as Fog).far = preset.fogFar;
    this.camera.far = preset.fogFar + 5;
    this.camera.updateProjectionMatrix();
    this.chunks.radius = preset.chunkRadius;
    this.ragdolls.limit = preset.level === 'low' ? 2 : 4;
    this.models.configure(preset.level);
  }

  private resize(width: number, height: number): void {
    if (height === 0) return;
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Vertical FOV 75°, but never wider than 100° horizontally: on a 812×375 phone a fixed 75° would
    // be ~117° across, stretching everything near the edges (legs looked long, feet far away).
    const maxV = (2 * Math.atan(Math.tan((MAX_HFOV * Math.PI) / 360) / aspect) * 180) / Math.PI;
    this.camera.fov = Math.min(BASE_VFOV, maxV);
    this.camera.updateProjectionMatrix();
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
  const a = part === 'head' ? bite('head') : part === 'torso' ? bite('torso') + bite('vest') : part === 'arms' ? sleeves * 0.8 + bite('hands') * 0.6 : bite('legs') + bite('feet') * 0.3;
  return Math.min(0.9, a);
}
