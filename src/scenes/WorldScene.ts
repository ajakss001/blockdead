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
import type { ItemId } from '../data/items';
import type { GameContext } from '../GameContext';
import { outfitFrom } from '../player/outfit';
import { Player } from '../player/Player';
import type { RightItem } from '../player/Viewmodel';
import { BUCKETS } from '../render/look/surfaces';
import { worldMaterials } from '../render/look/worldMaterials';
import { Containers } from '../systems/Containers';
import { Interaction } from '../systems/Interaction';
import { Inventory, type InventoryData } from '../systems/Inventory';
import { SaveGame } from '../systems/SaveGame';
import { Survival } from '../systems/Survival';
import { InventoryPanel } from '../ui/InventoryPanel';
import { ChunkManager } from '../world/ChunkManager';
import { Doors } from '../world/Doors';
import { Interiors } from '../world/Interiors';
import { CollisionWorld } from '../world/CollisionWorld';
import { WorldLayout } from '../world/gen/layout';
import type { IScene } from './IScene';

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

const DEFAULT_SEED = 1993;
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
  worn: { head: null, torso: 'hoodie', legs: 'jeans', feet: 'sneakers' },
  battery: 0.6,
};
/** Hand items with a first-person model. */
const HELD: Partial<Record<ItemId, RightItem>> = { knife: 'knife', axe: 'axe', bat: 'bat', crowbar: 'crowbar', hammer: 'hammer' };

/** The procedural, endless world: chunks stream around the player from a seed (?seed=…). */
export class WorldScene implements IScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 120);
  overlay?: { scene: Scene; camera: PerspectiveCamera };

  private ctx!: GameContext;
  private player!: Player;
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

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.scene.background = new Color(NIGHT.sky);
    this.scene.fog = new Fog(NIGHT.sky, NIGHT.fogNear, ctx.quality.preset.fogFar);
    this.scene.add(new AmbientLight(NIGHT.ambient.color, NIGHT.ambient.intensity));
    const moon = new DirectionalLight(NIGHT.moon.color, NIGHT.moon.intensity);
    moon.position.set(-30, 40, -10);
    this.scene.add(moon);

    const seed = Number(new URLSearchParams(location.search).get('seed')) || DEFAULT_SEED;
    const layout = new WorldLayout(seed);
    this.chunks = new ChunkManager(this.scene, this.world, layout, ctx.quality.preset.chunkRadius);
    // Standing surface: storeys, stairs and roofs inside high-rises; the terrain everywhere else.
    const ground = (x: number, z: number, y: number) => this.interiors.surfaceY(x, z, y) ?? layout.heightAt(x, z);
    this.player = new Player(ctx, this.camera, this.scene, this.world, SPAWN, SPAWN_YAW, ground);
    this.overlay = this.player.viewmodel;

    // Survival layer: containers follow their chunks; the inventory screen pauses the game.
    this.containers = new Containers(seed);
    this.doors = new Doors(this.scene, this.world);
    this.interiors = new Interiors(this.scene, this.world, this.chunks, this.containers, this.doors);
    this.chunks.onChunkLoaded = (key, data) => {
      this.containers.addChunk(key, data.zone, data.containers);
      this.interiors.addChunk(key, data.buildings);
    };
    this.chunks.onChunkUnloaded = (key) => {
      this.containers.removeChunk(key);
      this.interiors.removeChunk(key);
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
    const outfit = outfitFrom(this.inventory.worn);
    this.player.body.setOutfit(outfit);
    this.player.viewmodel.setSleeves(outfit.sleeves);
  }

  /** Restore the save (if any), then wait for the blocks around the player. */
  async load(): Promise<void> {
    const save = await this.saves.load();
    const c = this.player.controller;
    if (save) {
      c.position.set(save.player.x, save.player.y ?? 0, save.player.z);
      c.prevPosition.copy(c.position);
      c.yaw = save.player.yaw;
      this.player.battery = save.player.battery;
      this.survival.restore(save.stats);
      // Saves from before clothing existed: keep the starting clothes on.
      this.inventory.restore({ ...save.inventory, worn: save.inventory.worn ?? START_KIT.worn });
      this.containers.restore(save.containers);
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
    for (const bucket of BUCKETS) {
      const m = new Mesh(g, mats[bucket]);
      m.castShadow = bucket === 'cast';
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
    this.camera.getWorldDirection(this.lookDir);
    group.position.copy(this.camera.position).addScaledVector(this.lookDir, 0.5);
    this.scene.add(group);
    this.player.prewarmShadows();
    return () => {
      group.removeFromParent();
      g.dispose();
    };
  }

  fixedUpdate(dt: number): void {
    const c = this.player.controller;
    c.canSprint = this.survival.canSprint;
    c.sprintFactor = this.survival.sprintFactor;
    this.player.fixedUpdate(dt);
    this.interaction.fixedUpdate(dt);
    this.survival.update(dt, c.speed, c.sprinting);
    this.moodleT -= dt;
    if (this.moodleT <= 0) {
      this.moodleT = 0.25;
      this.survival.pushMoodles(this.ctx.hud);
    }
  }

  render(alpha: number, frameDt: number): void {
    this.player.render(alpha, frameDt);
    this.camera.getWorldDirection(this.lookDir);
    this.chunks.update(this.camera.position.x, this.camera.position.z, this.lookDir.x, this.lookDir.z);
    this.interaction.render(frameDt);
    this.interiors.update(frameDt, this.player.controller.position.x, this.player.controller.position.z);
    this.doors.update(frameDt);
    if (!this.ctx.loop.paused) {
      this.saveT += frameDt;
      if (this.saveT >= AUTOSAVE_INTERVAL) this.save();
    }
  }

  private save(): void {
    this.saveT = 0;
    const c = this.player.controller;
    void this.saves.save({
      player: { x: c.position.x, y: c.position.y, z: c.position.z, yaw: c.yaw, battery: this.player.battery },
      stats: this.survival.serialize(),
      inventory: this.inventory.serialize(),
      containers: this.containers.serialize(),
    });
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.ctx.debug.delete('player');
    this.ctx.debug.delete('world');
    this.ctx.debug.delete('survival');
    this.player.dispose();
    this.chunks.dispose();
  }

  private applyQuality(): void {
    const preset = this.ctx.quality.preset;
    (this.scene.fog as Fog).far = preset.fogFar;
    this.camera.far = preset.fogFar + 5;
    this.camera.updateProjectionMatrix();
    this.chunks.radius = preset.chunkRadius;
  }

  private resize(width: number, height: number): void {
    if (height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.player.viewmodel.setAspect(width / height);
  }
}
