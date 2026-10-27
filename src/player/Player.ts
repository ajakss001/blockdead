import { Object3D, type PerspectiveCamera, type Scene, SpotLight, type Vector3 } from 'three';
import { clamp, lerp } from '../core/math';
import type { GameContext } from '../GameContext';
import type { LookDelta } from '../input/InputManager';
import type { QualityPreset } from '../render/QualityPresets';
import type { CollisionWorld } from '../world/CollisionWorld';
import { BodyModel } from './BodyModel';
import { type GroundFn, PlayerController, SPEED_WALK } from './PlayerController';
import { Viewmodel, type ViewmodelFrame } from './Viewmodel';

/**
 * Flashlight. Intensity is in candela (three ≥ r155 physical lights): with decay 2 the legacy
 * "intensity 2" would be invisible past a couple of meters; ~30 cd gives the same look.
 */
const FLASHLIGHT = {
  color: 0xfffaed,
  intensity: 30,
  distance: 28,
  angle: 0.45,
  penumbra: 0.35,
  decay: 2,
} as const;

/** Timed search, seconds (Zomboid: actions take time and leave you exposed). */
const SEARCH_TIME = 2;

/**
 * Player = controller (simulation) + camera rig + own body + viewmodel arms + flashlight + timed actions.
 * fixedUpdate moves the simulation; render interpolates and applies camera look at frame rate.
 */
export class Player {
  readonly controller: PlayerController;
  readonly body = new BodyModel();
  readonly viewmodel = new Viewmodel();
  readonly flashlight: SpotLight;
  flashlightOn = false;

  private readonly look: LookDelta = { x: 0, y: 0 };
  private readonly frame: ViewmodelFrame = {
    lookX: 0,
    lookY: 0,
    stepPhase: 0,
    speed: 0,
    sprinting: false,
    flashlightOn: false,
  };
  /** Seconds into the current search, or -1. */
  private searchT = -1;
  private flickerT = 0;
  private flickerNext = 12;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly camera: PerspectiveCamera,
    scene: Scene,
    private readonly world: CollisionWorld,
    spawn: Vector3,
    yaw: number,
    private readonly ground?: GroundFn,
  ) {
    this.controller = new PlayerController(spawn, yaw);
    scene.add(this.body.root);

    // Rigidly attached to the camera, but held in the left hand (below-left of the eyes):
    // a light exactly at the eye hides every shadow directly behind the object it falls on.
    const f = FLASHLIGHT;
    this.flashlight = new SpotLight(f.color, 0, f.distance, f.angle, f.penumbra, f.decay);
    this.flashlight.position.set(-0.22, -0.28, 0.05);
    const target = new Object3D();
    target.position.set(-0.04, -0.12, -6);
    this.flashlight.target = target;
    // castShadow stays constant (toggling it recompiles shaders); an unlit flashlight simply
    // stops re-rendering its shadow map via shadow.autoUpdate.
    this.flashlight.castShadow = true;
    this.flashlight.shadow.autoUpdate = false;
    this.flashlight.shadow.bias = -0.0006;
    this.flashlight.shadow.normalBias = 0.03;
    this.flashlight.shadow.camera.near = 0.15;
    this.flashlight.shadow.camera.far = f.distance;
    camera.add(this.flashlight, target);
    if (!camera.parent) scene.add(camera);

    this.applyQuality(ctx.quality.preset);
    this.unsubs.push(ctx.events.on('quality:changed', () => this.applyQuality(ctx.quality.preset)));
  }

  fixedUpdate(dt: number): void {
    const input = this.ctx.input;
    if (input.consumePressed('flashlight')) this.setFlashlight(!this.flashlightOn);
    if (input.consumePressed('item1')) this.viewmodel.equip('knife');
    if (input.consumePressed('item2')) this.viewmodel.equip('fists');

    this.controller.fixedUpdate(dt, input, this.world, this.ground);
    const attacking = input.isHeld('attack') && !this.controller.sprinting;
    this.updateSearch(dt, input.consumePressed('use'), attacking);
    this.viewmodel.fixedUpdate(dt, attacking && this.searchT < 0);
    const strikeNoise = this.viewmodel.consumeStrike();
    if (strikeNoise > 0) this.controller.addNoise(strikeNoise);

    // Placeholder until stage 3 stats: being loud makes you anxious.
    this.ctx.hud.setMoodle('anxiety', this.controller.noise > 0.75 ? 2 : this.controller.noise > 0.5 ? 1 : 0);
  }

  render(alpha: number, frameDt: number): void {
    const c = this.controller;
    this.ctx.input.consumeLook(this.look);
    c.applyLook(this.look.x, this.look.y);

    const x = lerp(c.prevPosition.x, c.position.x, alpha);
    const y = lerp(c.prevPosition.y, c.position.y, alpha);
    const z = lerp(c.prevPosition.z, c.position.z, alpha);
    const phase = lerp(c.prevStepPhase, c.stepPhase, alpha);
    const crouchT = lerp(c.prevCrouchT, c.crouchT, alpha);

    // Head bob: one vertical dip per step, one lateral sway per stride.
    const amp = clamp(c.speed / SPEED_WALK, 0, 1.6);
    const bobY = (Math.cos(phase * 2) - 1) * 0.5 * 0.045 * amp;
    const bobX = Math.sin(phase) * 0.02 * amp;
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    this.camera.position.set(x + cos * bobX, y + c.eyeHeight(alpha) + bobY, z - sin * bobX);
    this.camera.rotation.set(c.pitch, c.yaw, Math.sin(phase) * 0.004 * amp, 'YXZ');

    this.body.update(x, y, z, c.yaw, phase, c.speed, crouchT);
    this.updateFlicker(frameDt);

    const f = this.frame;
    f.lookX = this.look.x;
    f.lookY = this.look.y;
    f.stepPhase = phase;
    f.speed = c.speed;
    f.sprinting = c.sprinting;
    f.flashlightOn = this.flashlightOn;
    this.viewmodel.update(frameDt, f);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.body.dispose();
    this.viewmodel.dispose();
    this.flashlight.dispose();
  }

  private setFlashlight(on: boolean): void {
    this.flashlightOn = on;
    this.flashlight.intensity = on ? FLASHLIGHT.intensity : 0;
    this.flashlight.shadow.autoUpdate = on;
    this.flashlight.shadow.needsUpdate = on;
  }

  /** Cheap batteries: every 10–40 s the beam stutters for a fraction of a second. */
  private updateFlicker(dt: number): void {
    if (!this.flashlightOn) return;
    this.flickerT += dt;
    if (this.flickerT < this.flickerNext) return;
    const burst = this.flickerT - this.flickerNext;
    if (burst < 0.35) {
      this.flashlight.intensity = FLASHLIGHT.intensity * (Math.random() < 0.5 ? 0.15 : 0.7);
    } else {
      this.flashlight.intensity = FLASHLIGHT.intensity;
      this.flickerT = 0;
      this.flickerNext = 10 + Math.random() * 30;
    }
  }

  /** Search: hold still for SEARCH_TIME; moving or attacking cancels. Containers arrive in stage 3. */
  private updateSearch(dt: number, pressed: boolean, attacking: boolean): void {
    const hud = this.ctx.hud;
    if (this.searchT < 0) {
      if (pressed) this.searchT = 0;
      else return;
    }
    if (this.controller.speed > 0.4 || attacking) {
      this.searchT = -1;
      hud.toast('Прервано', 900);
      return;
    }
    this.searchT += dt;
    hud.showAction('Обыск…', this.searchT / SEARCH_TIME);
    if (this.searchT >= SEARCH_TIME) {
      this.searchT = -1;
      hud.toast('Ничего полезного');
    }
  }

  private applyQuality(preset: QualityPreset): void {
    const size = Math.max(preset.shadowMapSize, 1);
    const shadow = this.flashlight.shadow;
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
      shadow.needsUpdate = true;
    }
  }
}
