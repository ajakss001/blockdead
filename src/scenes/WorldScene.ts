import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { AnxietyAudio } from '../audio/AnxietyAudio';
import { type FleshBlow, sfx, type StepSurface } from '../audio/Sound';
import { FLOOR_H, inStairCore } from '../world/gen/highrise';
import { CHUNK, ROAD_HALF } from '../world/gen/layout';
import { type ItemId, type ItemStack, WEAR_SLOTS, type WearSlot, wornStat } from '../data/items';
import type { Worn } from '../systems/Inventory';
import type { GameContext } from '../GameContext';
import { type ClassId, classDef, classMods, DEFAULT_CLASS } from '../data/classes';
import { BACKPACK_CAPACITY, ITEMS } from '../data/items';
import { type Appearance, DEFAULT_APPEARANCE, sanitizeAppearance } from '../player/appearance';
import { outfitFrom } from '../player/outfit';
import { type CharacterChoice, CharacterEditor, choiceTint, choiceWorn } from '../ui/CharacterEditor';
import { Player } from '../player/Player';
import type { RightItem } from '../player/Viewmodel';
import { BUCKETS } from '../render/look/surfaces';
import { worldMaterials } from '../render/look/worldMaterials';
import { airTemperature, Clock, feltTemperature, Shelters } from '../systems/Climate';
import { dirtSteps, soilClothes } from '../systems/Dirt';
import { Containers } from '../systems/Containers';
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
import { ZombieCrowd } from '../render/ZombieCrowd';
import { blowDamage, type PlayerSense, type Zombie, ZombieSim } from '../systems/zombies';
import { Dust } from '../render/Dust';
import { FISTS, HELD as HELD_CFG, type HeldId } from '../player/held';
import { routeHighrise } from '../world/gen/highrise';
import type { DoorRef } from '../world/Doors';
import type { ContainerRef } from '../systems/Containers';
import type { TwinRecord } from '../systems/SaveGame';

/**
 * Night setup. Ambient sits at the floor; a weak cold moon keeps silhouettes and roof lines
 * readable against the sky on a phone screen — everything else is flashlight.
 */
const NIGHT = {
  sky: 0x0a0d14,
  fogNear: 3,
  ambient: { color: 0x050510, intensity: 0.15 },
  moon: { color: 0x5a6c90, intensity: 0.35 },
} as const;

/** Overcast late-autumn day: grey sky, soft cool light, no hard sun. */
const DAY = {
  sky: 0x8d969f,
  fogNear: 12,
  ambient: { color: 0xc4c8d0, intensity: 1.05 },
  sun: { color: 0xfff2e0, intensity: 1.35 },
} as const;

const DEFAULT_SEED = 1993;
const _dayColor = new Color();
const _zs: PlayerSense = { pos: new Vector3(), eye: 1.6, noise: 0, crouched: false, lit: 0, daylight: 0 };
const _zView = new Vector3();
/** How each weapon's blow on a body sounds. */
const STRIKE_SOUND: Record<string, FleshBlow> = { axe: 'chop', knife: 'stab', fists: 'fist', bat: 'blunt', hammer: 'metal', crowbar: 'metal' };
const _so = new Vector3();
const _sd = new Vector3();
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
  readonly camera = new PerspectiveCamera(BASE_VFOV, 1, 0.05, 120);
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
  private interaction!: Interaction;
  private panel!: InventoryPanel;
  private saves!: SaveGame;
  private interiors!: Interiors;
  private doors!: Doors;
  private saveT = 0;
  private moodleT = 0;
  private readonly clock = new Clock();
  private ambient!: AmbientLight;
  private moon!: DirectionalLight;
  private lightKey = -1;
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
  private crowd!: ZombieCrowd;
  /** Visible dirt steps of the worn clothes, to re-dress the body only when a step changes. */
  private dirtShown = '';
  /** Who the survivor is: looks and former job (class). */
  private look: Appearance = { ...DEFAULT_APPEARANCE };
  private classId: ClassId = DEFAULT_CLASS;
  /** No save was found: a new game asks for a character first. */
  private isNewGame = true;
  private readonly dust = new Dust();
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
    this.scene.fog = new Fog(NIGHT.sky, NIGHT.fogNear, ctx.quality.preset.fogFar);
    this.ambient = new AmbientLight(NIGHT.ambient.color, NIGHT.ambient.intensity);
    this.scene.add(this.ambient);
    const moon = new DirectionalLight(NIGHT.moon.color, NIGHT.moon.intensity);
    moon.position.set(-30, 40, -10);
    this.scene.add(moon);
    this.moon = moon;
    this.sky = new Sky(this.scene, NIGHT.sky, moon.position);

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
      },
      zcount,
      seed,
    );
    this.crowd = new ZombieCrowd(Math.max(zcount, ctx.quality.preset.zombiesVisible));
    this.scene.add(this.crowd.mesh, this.dust.points);
    // A blow at its contact frame: a zombie in reach takes it (the head counts double).
    this.player.onStrike = (item) => this.strikeZombie(item);

    // Survival layer: containers follow their chunks; the inventory screen pauses the game.
    this.containers = new Containers(seed);
    this.doors = new Doors(this.scene, this.world);
    this.interiors = new Interiors(this.scene, this.world, this.chunks, this.containers, this.doors);
    this.chunks.onChunkLoaded = (key, data) => {
      this.containers.addChunk(key, data.zone, data.containers);
      this.interiors.addChunk(key, data.buildings);
      this.shelters.add(key, data.shelters);
      this.doors.add(entranceKey(key), data.doors);
      this.life?.add(key, data.ambient);
    };
    this.chunks.onChunkUnloaded = (key) => {
      this.containers.removeChunk(key);
      this.interiors.removeChunk(key);
      this.shelters.remove(key);
      this.doors.remove(entranceKey(key));
      this.life?.remove(key);
    };
    const syncBody = () => this.syncBody();
    this.panel = new InventoryPanel(
      ctx,
      {
        inventory: this.inventory,
        survival: this.survival,
        containers: this.containers,
        player: this.player,
        syncBody,
        onClose: () => this.save(),
      },
      document.getElementById('ui')!,
    );
    this.interaction = new Interaction(ctx, this.player, this.containers, this.inventory, this.panel, syncBody, this.doors);
    this.saves = new SaveGame(ctx.platform, seed);
    this.dread = new AnxietyAudio(ctx.events, ctx.loop);
    this.life = new WorldLife(this.scene, this.dread, (x, z) => layout.walkHeightAt(x, z));
    this.interiors.onAmbient = (owner, spots) => (spots ? this.life.add(owner, spots) : this.life.remove(owner));
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
    this.player.viewmodel.setSleeves(outfit.sleeves, outfit.skin, outfit.dirt.torso, outfit.gloves, outfit.dirt.hands);
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
      this.bodies = save.bodies ?? [];
      this.containers.restore(save.containers);
      for (const b of this.bodies) this.containers.addLoose(b, []);
      if (save.clock !== undefined) this.clock.minutes = save.clock;
      this.bornAt = save.dead ? this.clock.minutes : (save.bornAt ?? this.clock.minutes);
    }
    if (save && !save.dead) {
      this.isNewGame = false;
      // Saves before the editor: the default survivor and class, no editor.
      this.look = sanitizeAppearance(save.character?.appearance);
      this.classId = classDef(save.character?.classId).id;
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
    return () => {
      lifeDone();
      group.removeFromParent();
      g.dispose();
    };
  }

  fixedUpdate(dt: number): void {
    const c = this.player.controller;
    c.canSprint = this.survival.canSprint;
    c.sprintFactor = this.survival.sprintFactor;
    c.jumpFactor = this.survival.jumpFactor;
    // Tired: the swing is slower.
    this.player.viewmodel.swingRate = 1 - 0.25 * Math.min(1, Math.max(1 - this.survival.stamina, this.survival.fatigue));
    if (!this.dead) this.player.fixedUpdate(dt);
    // Zombies hear and see the player as it is after this step.
    _zs.pos.copy(c.position);
    _zs.eye = c.crouched ? 1.0 : 1.6;
    _zs.noise = c.noise;
    _zs.crouched = c.crouched;
    _zs.lit = this.player.flashlightOn && this.player.battery > 0 ? 0.7 : 0;
    _zs.daylight = this.clock.daylight;
    _zView.set(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    this.zombies.update(dt, _zs, _zView);
    // Nearest first: in a crowd the sound groups fill up with the zombies that matter.
    const near = (z: { pos: Vector3 }) => (z.pos.x - c.position.x) ** 2 + (z.pos.z - c.position.z) ** 2;
    this.zombies.sounds.sort((a, b) => near(a.z) - near(b.z));
    for (const { z, kind } of this.zombies.sounds) sfx.zombie(kind, { x: z.pos.x, y: z.pos.y + 1.5, z: z.pos.z }, z.pitch);
    for (const a of this.zombies.attacks) this.bitten(a.damage, a.from.pos, this.zombies.attacks.length);
    for (const z of this.zombies.killedTwins) this.lootTwin(z);
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
    if (c.jumped) this.survival.onJump();
    this.ctx.hud.setStamina(this.survival.stamina);
    // Footsteps on whatever is underfoot; jump and landing.
    const feet = { x: c.position.x, y: c.position.y + 0.05, z: c.position.z };
    const n = Math.floor(c.stepPhase / Math.PI);
    if (n !== this.stepN && !c.airborne && c.speed > 0.3) sfx.step(this.surfaceAt(feet.x, feet.z, c.position.y), c.crouched ? 'crouch' : c.sprinting ? 'run' : 'walk', feet);
    this.stepN = n;
    if (c.jumped) sfx.jump(feet);
    if (c.landed > 0.8) sfx.land(this.surfaceAt(feet.x, feet.z, c.position.y), feet, c.landed);
    if (!this.dead) this.interaction.fixedUpdate(dt);
    this.clock.update(dt);
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
    this.survival.update(dt, c.speed, c.sprinting, { felt: this.felt, dark, batteryDead: this.player.battery <= 0, threat: this.zombies.threat(c.position) });
    // Anxiety: heartbeat and breath, and the screen edges closing in with every beat.
    const a = this.survival.anxiety;
    this.dread.update(dt, a);
    this.ctx.fx.setDread(a * 0.8 + this.dread.pulse * a * 0.25);
    if (this.survival.health <= 0 && !this.dead) this.die(this.survival.infection >= 1 ? 'Заражение: вы обратились' : this.survival.hunger > 0.85 || this.survival.thirst > 0.85 ? 'Истощение' : this.deathCause || 'Раны');
    this.moodleT -= dt;
    if (this.moodleT <= 0) {
      this.moodleT = 0.25;
      this.survival.pushStats(this.ctx.hud, this.player.battery);
    }
  }

  render(alpha: number, frameDt: number): void {
    this.crowd.update(this.zombies.list, frameDt);
    this.dust.update(frameDt);
    this.player.render(alpha, frameDt);
    this.camera.getWorldDirection(this.lookDir);
    this.chunks.update(this.camera.position.x, this.camera.position.z, this.lookDir.x, this.lookDir.z);
    this.interaction.render(frameDt);
    this.interiors.update(frameDt, this.player.controller.position.x, this.player.controller.position.z, this.player.controller.position.y);
    this.doors.update(frameDt);
    const p = this.player.controller.position;
    const zone = this.chunks.zoneAt(p.x, p.z);
    this.life.update(frameDt, this.camera, p, !this.indoors, zone === 'downtown' || zone === 'town' || zone === 'suburb', this.ctx.loop.paused);
    this.applyDaylight(this.clock.daylight);
    const wa = this.life.windDirection;
    const ws = 0.0005 + this.life.windGust * 0.001;
    this.sky.wind.set(Math.cos(wa) * ws, 0, Math.sin(wa) * ws);
    this.sky.update(frameDt, this.camera, this.ctx.loop.paused);
    const cp = this.camera.position;
    sfx.setListener(cp.x, cp.y, cp.z, this.lookDir.x, this.lookDir.y, this.lookDir.z);
    if (!this.ctx.loop.paused) sfx.update(frameDt);
    if (!this.ctx.loop.paused) {
      this.saveT += frameDt;
      if (this.saveT >= AUTOSAVE_INTERVAL) this.save();
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
    this.ambient.color.set(NIGHT.ambient.color).lerp(_dayColor.set(DAY.ambient.color), k);
    this.ambient.intensity = NIGHT.ambient.intensity + (DAY.ambient.intensity - NIGHT.ambient.intensity) * k;
    this.moon.color.set(NIGHT.moon.color).lerp(_dayColor.set(DAY.sun.color), k);
    this.moon.intensity = NIGHT.moon.intensity + (DAY.sun.intensity - NIGHT.moon.intensity) * k;
    this.moon.position.set(-30 + 10 * k, 40 + 30 * k, -10 + 20 * k);
    this.sky.daylight = k;
    this.sky.skyColor = sky;
    this.life.daylight = k;
    this.player.viewmodel.setDaylight(k);
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
      clock: this.clock.minutes,
      character: { appearance: this.look, classId: this.classId },
      dead: this.dead || undefined,
      twins: this.twins,
      bodies: this.bodies,
      bornAt: this.bornAt,
      boards: this.doors.serializeBoards(),
    });
  }

  /** New game: the character editor over the paused world (?editor=0 skips it with the default survivor). */
  async createCharacter(): Promise<void> {
    if (!this.isNewGame || new URLSearchParams(location.search).get('editor') === '0') {
      this.applyClass();
      this.giveTestLoadout();
      return;
    }
    // The editor covers everything; afterwards the usual start screen (PC: click to play) shows.
    this.ctx.loop.pause('editor');
    this.creating = true;
    const choice = await new CharacterEditor(document.getElementById('ui')!).open();
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
    const cls = classDef(choice.classId);
    const worn = choiceWorn(choice);
    this.inventory.restore({ stacks: cls.items.map(([id, n]) => [id, n] as [typeof id, number]), hand: cls.hand, worn, wornTint: choiceTint(choice) });
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
    const strength = classMods(this.classId).strength;
    const dmg = blowDamage(cfg.damage, strength, res.head, Math.random());
    const killed = this.zombies.hit(res.zombie, dmg, o.x, o.z);
    sfx.strike(STRIKE_SOUND[item] ?? 'blunt', res.point, res.head, killed);
    this.dust.burst(res.point, res.head ? 14 : 10);
    return true;
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
      const z = this.zombies.spawnAt(t.x, t.z, 'idle', 'man', t.y);
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
    // First see it happen: the survivor goes down, looking at what got them; then the screen.
    this.player.startDeath(killer ?? null);
    window.setTimeout(() => this.showDeathScreen(cause), 2600);
    const c = this.player.controller.position;
    const inv = this.inventory;
    const items: ItemStack[] = inv.stacks.map((s) => ({ ...s }));
    if (inv.hand) items.push({ id: inv.hand, count: 1 });
    for (const slot of WEAR_SLOTS) {
      const id = inv.worn[slot];
      if (id) items.push({ id, count: 1, dirt: inv.wornDirt[slot], ...(inv.wornTint[slot] !== undefined ? { tint: inv.wornTint[slot] } : {}) });
    }
    const outfit = outfitFrom(inv.worn, this.look.skin, inv.wornDirt, inv.wornTint);
    this.twins.push({ id: 2_000_000_000 + Math.floor(Math.random() * 1e8), x: c.x, y: c.y, z: c.z, colors: [outfit.top ?? 0x8a8478, outfit.pants ?? 0x5a5448, this.look.skin], items });
    this.save();
  }

  private showDeathScreen(cause: string): void {
    this.ctx.loop.pause('menu');
    if (document.pointerLockElement) document.exitPointerLock();
    const minutes = Math.max(0, this.clock.minutes - this.bornAt);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const el = document.createElement('div');
    el.className = 'death-screen';
    el.style.cssText = 'position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(6,6,8,.88);color:#d8d2c4;font:16px/1.4 system-ui,sans-serif;text-align:center';
    el.innerHTML = `<div style="font-size:34px;letter-spacing:2px">Вот как вы умерли</div><div style="opacity:.85">${cause || this.deathCause || 'Неизвестно'}</div><div style="opacity:.7">Прожито: ${days} д ${hours} ч</div><div style="opacity:.6;max-width:420px">Ваш выживший поднялся и бродит там, где упал. В его одежде и с его вещами.</div>`;
    const btn = document.createElement('button');
    btn.className = 'death-screen__new';
    btn.textContent = 'Новый персонаж';
    btn.style.cssText = 'margin-top:10px;padding:12px 26px;font:inherit;font-size:18px;background:#3a3630;color:#eee;border:1px solid #6a6458;border-radius:4px;cursor:pointer';
    btn.addEventListener('click', () => location.reload());
    el.append(btn);
    (document.getElementById('ui') ?? document.body).append(el);
  }

  /** Class modifiers into the systems that use them. */
  private applyClass(): void {
    const m = classMods(this.classId);
    this.survival.mods = m;
    this.inventory.capacity = BACKPACK_CAPACITY + m.carry;
    this.interaction.searchMul = m.searchSpeed;
    this.interaction.carMul = m.carSearch;
    this.player.controller.noiseMul = m.stealth;
    this.panel.setAppearance(this.look);
  }

  dispose(): void {
    this.crowd.dispose();
    this.dust.dispose();
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
    (this.scene.fog as Fog).far = preset.fogFar;
    this.camera.far = preset.fogFar + 5;
    this.camera.updateProjectionMatrix();
    this.chunks.radius = preset.chunkRadius;
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
