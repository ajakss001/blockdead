import { AmbientLight, Color, DirectionalLight, Fog, PerspectiveCamera, Scene, Vector3 } from 'three';
import type { GameContext } from '../GameContext';
import { Player } from '../player/Player';
import { ChunkManager } from '../world/ChunkManager';
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
/** Sidewalk of the road along z = 0, looking down the street: houses of the starting suburb on the right. */
const SPAWN = new Vector3(20, 0, 4.6);
const SPAWN_YAW = -Math.PI / 2;

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
    this.player = new Player(ctx, this.camera, this.scene, this.world, SPAWN, SPAWN_YAW, (x, z) => layout.heightAt(x, z));
    this.overlay = this.player.viewmodel;

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
      return `world seed ${seed}  zone ${ch.zoneAt(c.position.x, c.position.z)}  chunks ${ch.loadedCount} (+${ch.pendingCount})  gen ${ch.lastGenMs.toFixed(0)}ms  colliders ${this.world.boxCount}`;
    });
  }

  /** Wait for the blocks around the spawn point, so the first frame isn't an empty void. */
  load(): Promise<void> {
    const done = this.chunks.whenLoaded(SPAWN.x, SPAWN.z, 1);
    const pump = window.setInterval(() => this.chunks.update(SPAWN.x, SPAWN.z, 0, 1), 16);
    return done.then(() => window.clearInterval(pump));
  }

  fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt);
  }

  render(alpha: number, frameDt: number): void {
    this.player.render(alpha, frameDt);
    this.camera.getWorldDirection(this.lookDir);
    this.chunks.update(this.camera.position.x, this.camera.position.z, this.lookDir.x, this.lookDir.z);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.ctx.debug.delete('player');
    this.ctx.debug.delete('world');
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
