import { type Mesh, Object3D, type PerspectiveCamera, Raycaster, type Scene, SpotLight, Vector3 } from 'three';
import { type HitMaterial, sfx, type SwingKind } from '../audio/Sound';
import { SURFACE_LIST, type Surface } from '../render/look/surfaces';
import { clamp, damp, lerp } from '../core/math';
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

/**
 * Where the light sits relative to the eyes: in the left hand (below-left, so shadows fall visibly
 * behind objects), or as a headlamp just above the eyes when both hands hold a weapon.
 */
const HAND_LIGHT = { pos: new Vector3(-0.22, -0.28, 0.05), aim: new Vector3(-0.04, -0.12, -6) };
const HEAD_LIGHT = { pos: new Vector3(0.02, 0.09, -0.04), aim: new Vector3(0, -0.4, -6) };

/** What a swing sounds like hitting each world surface. */
const MATERIAL: Partial<Record<Surface, HitMaterial>> = {
  wood: 'wood',
  roof: 'wood',
  foliage: 'wood',
  metal: 'metal',
  trim: 'metal',
  carPaint: 'metal',
  lamp: 'metal',
  glass: 'glass',
  windowGlass: 'glass',
  carGlass: 'glass',
  rubber: 'soft',
};
const _o = new Vector3();
const _d = new Vector3();
const _ray = new Raycaster();

/** How far the eyes move forward when looking straight down (neck flexion), m. */
const NECK_LEAN = 0.14;

/** Full battery lasts this many seconds of light. */
const BATTERY_LIFE = 480;

/**
 * Player = controller (simulation) + camera rig + own body + viewmodel arms + flashlight.
 * Gameplay around it (inventory, searching, stats) lives in systems/ and is driven by the scene.
 * fixedUpdate moves the simulation; render interpolates and applies camera look at frame rate.
 */
export class Player {
  readonly controller: PlayerController;
  readonly body = new BodyModel();
  readonly viewmodel = new Viewmodel();
  readonly flashlight: SpotLight;
  flashlightOn = false;
  /** Flashlight charge, 0..1. */
  battery = 1;
  /** Set by the scene while a timed action runs: no attacking with your hands full. */
  busy = false;

  private readonly look: LookDelta = { x: 0, y: 0 };
  private readonly frame: ViewmodelFrame = {
    lookX: 0,
    lookY: 0,
    stepPhase: 0,
    speed: 0,
    sprinting: false,
    flashlightOn: false,
  };
  private flickerT = 0;
  private readonly lightTarget: Object3D;
  private headlamp = false;
  /** Camera dip after a landing, m (springs back). */
  private landDip = 0;
  private flickerNext = 12;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly camera: PerspectiveCamera,
    private readonly scene: Scene,
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
    this.flashlight.position.copy(HAND_LIGHT.pos);
    const target = new Object3D();
    target.position.copy(HAND_LIGHT.aim);
    this.flashlight.target = target;
    this.lightTarget = target;
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
    if (this.flashlightOn) {
      this.battery = Math.max(0, this.battery - dt / BATTERY_LIFE);
      if (this.battery === 0) {
        this.setFlashlight(false);
        this.ctx.hud.toast('Батарейка села');
      }
    }

    this.controller.canJump = !this.busy;
    this.controller.fixedUpdate(dt, input, this.world, this.ground);
    // Landing: the knees take it, the head dips.
    if (this.controller.landed > 0) this.landDip = Math.max(this.landDip, Math.min(0.09, 0.015 + this.controller.landed * 0.018));
    const attacking = input.isHeld('attack') && !this.controller.sprinting && !this.busy;
    this.viewmodel.fixedUpdate(dt, attacking);
    const vm = this.viewmodel;
    if (vm.swingStarted) {
      vm.swingStarted = false;
      const item = vm.currentItem;
      const kind: SwingKind = item === 'knife' ? 'blade' : item === 'fists' ? 'fist' : 'heavy';
      sfx.swing(kind, vm.swing.windup + vm.swing.strike, this.camera.position);
    }
    const strikeNoise = vm.consumeStrike();
    if (strikeNoise > 0) {
      this.controller.addNoise(strikeNoise);
      this.strikeSound();
    }

  }

  /** The blow lands: what is in front within reach, and what it is made of (stage 4 adds damage). */
  private strikeSound(): void {
    const item = this.viewmodel.currentItem;
    const reach = item === 'fists' ? 1.1 : item === 'knife' ? 1.3 : 1.75;
    const o = this.camera.getWorldPosition(_o);
    const d = this.camera.getWorldDirection(_d);
    const dist = this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, reach);
    if (dist < 0) return;
    // The material from the triangle the ray meets in the world meshes near the player.
    _ray.set(o, d);
    _ray.far = dist + 0.4;
    let material: HitMaterial = 'concrete';
    const targets: Mesh[] = [];
    this.scene.traverse((obj) => {
      if ((obj as Mesh).isMesh && /^(chunk|interior)/.test(obj.name)) targets.push(obj as Mesh);
    });
    for (const hit of _ray.intersectObjects(targets, false)) {
      const layer = hit.face ? (hit.object as Mesh).geometry.getAttribute('aLayer')?.getX(hit.face.a) : undefined;
      if (layer === undefined) continue;
      const surface = SURFACE_LIST[Math.round(layer)];
      // Decals lie on top of the real surface.
      if (surface.startsWith('decal')) continue;
      material = MATERIAL[surface] ?? 'concrete';
      break;
    }
    sfx.hit(material, { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist }, item === 'fists' ? 0.3 : item === 'knife' ? 0.5 : 1);
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
    // Looking down bends the neck: the head (eyes) moves forward over the belly, so you see your
    // legs and feet, not the top of your own stomach.
    const lean = clamp((-c.pitch - 0.6) / 0.8, 0, 1) * NECK_LEAN;
    this.landDip = damp(this.landDip, 0, 7, frameDt);
    this.camera.position.set(x + cos * bobX - sin * lean, y + c.eyeHeight(alpha) + bobY - lean * 0.35 - this.landDip, z - sin * bobX - cos * lean);
    this.camera.rotation.set(c.pitch, c.yaw, Math.sin(phase) * 0.004 * amp, 'YXZ');

    this.body.update(x, y, z, c.yaw, phase, c.speed, crouchT);
    this.updateFlicker(frameDt);
    // Both hands on a weapon: the flashlight is strapped to the forehead (same battery).
    const head = this.viewmodel.headlamp;
    if (head !== this.headlamp) {
      this.headlamp = head;
      const l = head ? HEAD_LIGHT : HAND_LIGHT;
      this.flashlight.position.copy(l.pos);
      this.lightTarget.position.copy(l.aim);
    }

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

  /** Render the shadow map once (used during loading to compile its shaders off-screen). */
  prewarmShadows(): void {
    this.flashlight.shadow.needsUpdate = true;
  }

  /** The flashlight is actually shining. */
  get lightOn(): boolean {
    return this.flashlightOn && this.battery > 0;
  }

  rechargeBattery(amount: number): void {
    this.battery = Math.min(1, this.battery + amount);
  }

  private setFlashlight(on: boolean): void {
    if (on && this.battery <= 0) {
      this.ctx.hud.toast('Нужны батарейки');
      return;
    }
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
      // A dying battery flickers far more often.
      this.flickerNext = this.battery < 0.15 ? 1.5 + Math.random() * 3 : 10 + Math.random() * 30;
    }
  }


  private applyQuality(preset: QualityPreset): void {
    const size = Math.max(preset.shadowMapSize, 1);
    const shadow = this.flashlight.shadow;
    if (shadow.camera.far !== preset.shadowDistance) {
      shadow.camera.far = preset.shadowDistance;
      shadow.camera.updateProjectionMatrix();
    }
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size);
      shadow.map?.dispose();
      shadow.map = null;
      shadow.needsUpdate = true;
    }
  }
}
