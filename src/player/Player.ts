import { Object3D, type PerspectiveCamera, type Scene, SpotLight, type Vector3 } from 'three';
import { clamp, lerp } from '../core/math';
import type { GameContext } from '../GameContext';
import type { LookDelta } from '../input/InputManager';
import type { CollisionWorld } from '../world/CollisionWorld';
import { BodyModel } from './BodyModel';
import { PlayerController, SPEED_WALK } from './PlayerController';
import { Viewmodel, type ViewmodelFrame } from './Viewmodel';

/** Candela when on. Off = 0, but the light stays in the scene: toggling light count recompiles shaders. */
const FLASHLIGHT_INTENSITY = 40;

/**
 * Player = controller (simulation) + camera rig + own body + viewmodel arms + flashlight.
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

  constructor(
    private readonly ctx: GameContext,
    private readonly camera: PerspectiveCamera,
    scene: Scene,
    private readonly world: CollisionWorld,
    spawn: Vector3,
    yaw: number,
  ) {
    this.controller = new PlayerController(spawn, yaw);
    scene.add(this.body.root);

    // Flashlight hangs off the camera, slightly left and down — roughly where the left hand is.
    this.flashlight = new SpotLight(0xfff1d0, 0, 26, 0.42, 0.45, 1.6);
    this.flashlight.position.set(-0.15, -0.2, 0);
    const target = new Object3D();
    target.position.set(-0.05, -0.15, -6);
    this.flashlight.target = target;
    camera.add(this.flashlight, target);
    if (!camera.parent) scene.add(camera);
  }

  fixedUpdate(dt: number): void {
    const input = this.ctx.input;
    if (input.consumePressed('flashlight')) {
      this.flashlightOn = !this.flashlightOn;
      this.flashlight.intensity = this.flashlightOn ? FLASHLIGHT_INTENSITY : 0;
    }
    if (input.consumePressed('item1')) this.viewmodel.equip('knife');
    if (input.consumePressed('item2')) this.viewmodel.equip('fists');

    this.controller.fixedUpdate(dt, input, this.world);
    this.viewmodel.fixedUpdate(dt, input.isHeld('attack') && !this.controller.sprinting);
    const strikeNoise = this.viewmodel.consumeStrike();
    if (strikeNoise > 0) this.controller.addNoise(strikeNoise);
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
    this.body.dispose();
    this.viewmodel.dispose();
    this.flashlight.dispose();
  }
}
