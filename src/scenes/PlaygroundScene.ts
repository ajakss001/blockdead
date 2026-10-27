import { AmbientLight, Color, DirectionalLight, Fog, type Group, type Mesh, PerspectiveCamera, Scene } from 'three';
import type { GameContext } from '../GameContext';
import { Player } from '../player/Player';
import { StaticBatch } from '../render/StaticBatch';
import { CollisionWorld } from '../world/CollisionWorld';
import type { IScene } from './IScene';
import { buildPlayground, PLAYGROUND_SPAWN, PLAYGROUND_YAW } from './playground/buildPlayground';

/**
 * Night setup. Ambient is at the floor the brief asks for; a weak cold moon keeps silhouettes
 * and roof lines readable against the sky on a phone screen — everything else is flashlight.
 */
const NIGHT = {
  sky: 0x0a0d14,
  fogNear: 3,
  ambient: { color: 0x050510, intensity: 0.15 },
  moon: { color: 0x5a6c90, intensity: 0.35 },
} as const;

/** Stage 1 test yard: walk around, enter houses, look down at your legs, swing the knife. */
export class PlaygroundScene implements IScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(75, 1, 0.05, 120);
  overlay?: { scene: Scene; camera: PerspectiveCamera };

  private ctx!: GameContext;
  private player!: Player;
  private level!: Group;
  private readonly world = new CollisionWorld();
  private readonly unsubs: (() => void)[] = [];

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.scene.background = new Color(NIGHT.sky);
    this.scene.fog = new Fog(NIGHT.sky, NIGHT.fogNear, ctx.quality.preset.fogFar);

    this.scene.add(new AmbientLight(NIGHT.ambient.color, NIGHT.ambient.intensity));
    const moon = new DirectionalLight(NIGHT.moon.color, NIGHT.moon.intensity);
    moon.position.set(-30, 40, -10);
    this.scene.add(moon);

    const batch = new StaticBatch();
    buildPlayground(batch, this.world);
    this.level = batch.build();
    this.scene.add(this.level);

    this.player = new Player(ctx, this.camera, this.scene, this.world, PLAYGROUND_SPAWN, PLAYGROUND_YAW);
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
      return `player ${p.x.toFixed(1)}, ${p.z.toFixed(1)}  ${c.speed.toFixed(1)} м/с  ${state}  шум ${c.noise.toFixed(2)}  ${this.player.viewmodel.currentItem}  свет ${this.player.flashlightOn ? 'вкл' : 'выкл'}`;
    });
    ctx.debug.set('level', () => `level ${this.world.boxCount} colliders  input ${ctx.input.mode}${ctx.input.active ? '' : ' (неактивен)'}`);
  }

  fixedUpdate(dt: number): void {
    this.player.fixedUpdate(dt);
  }

  render(alpha: number, frameDt: number): void {
    this.player.render(alpha, frameDt);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.ctx.debug.delete('player');
    this.ctx.debug.delete('level');
    this.player.dispose();
    this.level.traverse((o) => (o as Mesh).geometry?.dispose());
  }

  private applyQuality(): void {
    const far = this.ctx.quality.preset.fogFar;
    (this.scene.fog as Fog).far = far;
    this.camera.far = far + 5;
    this.camera.updateProjectionMatrix();
  }

  private resize(width: number, height: number): void {
    if (height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.player.viewmodel.setAspect(width / height);
  }
}
