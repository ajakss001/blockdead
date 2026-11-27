import { Box3, Color, type Mesh, Object3D, type PerspectiveCamera, PointLight, Quaternion, Raycaster, type Scene, SpotLight, Vector3 } from 'three';
import { FLASHLIGHT } from '../items/config';
import { beamMask } from '../items/flashlight';
import { type HitMaterial, sfx, type SwingKind } from '../audio/Sound';
import { SURFACE_LIST, type Surface } from '../render/look/surfaces';
import { tr } from '../core/i18n';
import { clamp, damp, lerp } from '../core/math';
import type { GameContext } from '../GameContext';
import type { LookDelta } from '../input/InputManager';
import type { ShadowQuality } from '../core/Settings';
import type { QualityPreset } from '../render/QualityPresets';
import type { CollisionWorld } from '../world/CollisionWorld';
import type { Appearance } from './appearance';
import { BodyModel } from './BodyModel';
import type { GearId } from '../data/items';
import { bodyFor, figureScale } from './CharacterFigure';
import { bodyNow, type BodyId, loadBody } from '../characters/assets';
import type { ItemId } from '../data/items';
import { type GroundFn, PlayerController, SPEED_WALK } from './PlayerController';
import { Viewmodel, type ViewmodelFrame } from './Viewmodel';

/** Flashlight colours: fresh, and as the battery dies (dimmer and yellower). */
const LIGHT_COLOR = new Color(FLASHLIGHT.light.color);
const WEAK_COLOR = new Color(FLASHLIGHT.light.weakColor);
const _lp = new Vector3();
const _ld = new Vector3();
const _q = new Quaternion();

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
const _eye = new Vector3();
const _d = new Vector3();
const _ray = new Raycaster();


/** Full battery lasts this many seconds of light (items/config). */
const BATTERY_LIFE = FLASHLIGHT.battery.life;

/**
 * Player = controller (simulation) + camera rig + own body + viewmodel arms + flashlight.
 * Gameplay around it (inventory, searching, stats) lives in systems/ and is driven by the scene.
 * fixedUpdate moves the simulation; render interpolates and applies camera look at frame rate.
 */
export class Player {
  readonly controller: PlayerController;
  readonly body = new BodyModel();
  private lookWant: BodyId | null = null;
  readonly viewmodel = new Viewmodel();
  readonly flashlight: SpotLight;
  flashlightOn = false;
  /** Flashlight charge, 0..1. */
  battery = 1;
  /** Set by the scene while a timed action runs: no attacking with your hands full. */
  busy = false;
  /** 0..1 multiplier for walking head-bob, landing dip, and combat recoil jolt. */
  cameraBob = 1;

  private readonly look: LookDelta = { x: 0, y: 0 };
  private readonly frame: ViewmodelFrame = {
    lookX: 0,
    lookY: 0,
    stepPhase: 0,
    speed: 0,
    sprinting: false,
    flashlightOn: false,
  };
  /** Low battery: seconds to the next drop-out, and what is left of the current one. */
  private flickerT = 0;
  private dropT = 0;
  /** A dead battery still gives a weak flash when pressed: seconds left of it. */
  private flashT = 0;
  private readonly lightTarget: Object3D;
  private readonly bounceLight: PointLight;
  private suppressed = false;
  private forceFlashShadow: boolean | null = null;
  private shadowOverride: ShadowQuality | null = null;
  private readonly lastShadowPos = new Vector3(1e9, 0, 1e9);
  private readonly lastShadowDir = new Vector3();
  private shadowAccum = 0;
  /** The beam's direction in the world: it trails the camera a little (the light is in a hand). */
  private readonly beam = new Vector3();
  private beamSet = false;
  /** Camera dip after a landing, m (springs back). */
  private landDip = 0;
  /** Camera jolt when a blow lands (rad). */
  private hitKick = 0;
  /** The blow lands (contact frame): true if it hit something that is not the world (a zombie). */
  onStrike: ((item: string) => boolean) | null = null;
  /** The blow lands on the world (not a zombie) at a point: a car there may start wailing. */
  onStrikeWorld: ((x: number, y: number, z: number, item: string, glassOwner?: number) => void) | null = null;
  private readonly worldMeshCache: { mesh: Mesh; box: Box3 }[] = [];
  private readonly surfaceTargets: Mesh[] = [];
  private worldMeshCacheCount = -1;
  private worldMeshCacheAt = -1e9;

  /** Dead: the scene's death camera has the view; no arms, no body, no input. */
  private dead = false;

  /** The first-person body and arms: the look on its body (the costume in the outfit slot once it is loaded). */
  setLook(look: Appearance, outfit: ItemId | null = null): void {
    const want = bodyFor(look, outfit);
    const body = bodyNow(want);
    this.lookWant = want;
    if (body !== want) void loadBody(want).then(() => this.lookWant === want && this.setLook(look, outfit));
    this.body.setBody(body, figureScale(look, body));
    this.viewmodel.setBody(body, figureScale(look, body));
  }

  /** The gear worn on the first-person body (`handFree`: nothing held, the toolbox in the hand). */
  setGear(gear: readonly GearId[], handFree: boolean): void {
    this.body.setGear(gear, handFree);
  }

  /** The survivor died: hide the first-person arms, weapon and legs (the ragdoll figure takes over). */
  startDeath(): void {
    this.dead = true;
    this.suppressed = true;
    this.viewmodel.scene.visible = false;
    this.body.root.visible = false;
    this.flashlight.intensity = 0;
    this.bounceLight.intensity = 0;
  }

  /** A blow taken: the camera jolts. */
  hurt(strength = 1): void {
    this.hitKick = Math.max(this.hitKick, -0.05 * strength);
    this.landDip = Math.max(this.landDip, 0.04 * strength);
  }
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

    // On the camera, but from the lens of the flashlight in the left hand (Viewmodel.lightFrame):
    // a light exactly at the eye hides every shadow directly behind the object it falls on.
    // An uneven beam: the cookie (hot spot, dark ring, faint halo, the crack's streaks).
    const f = FLASHLIGHT.light;
    this.flashlight = new SpotLight(f.color, 0, f.distance, f.angle, f.penumbra, f.decay);
    this.flashlight.map = beamMask();
    this.flashlight.position.set(-0.2, -0.25, -0.3);
    const target = new Object3D();
    target.position.set(-0.2, -0.5, -6);
    this.flashlight.target = target;
    this.lightTarget = target;
    // Shadows on high quality only (set by applyQuality; switching recompiles shaders, so only then);
    // an unlit flashlight stops re-rendering its shadow map via shadow.autoUpdate.
    this.flashlight.castShadow = false;
    this.flashlight.shadow.autoUpdate = false;
    this.flashlight.shadow.bias = -0.0005;
    this.flashlight.shadow.normalBias = 0.035;
    this.flashlight.shadow.camera.near = 0.28;
    this.flashlight.shadow.camera.far = f.distance;
    this.flashlight.shadow.camera.layers.enable(2);
    camera.add(target);
    if (!camera.parent) scene.add(camera);
    this.bounceLight = new PointLight(f.color, 0, 9.5, 1.8);
    this.bounceLight.castShadow = false;
    // Lights stay in the scene for the whole run: adding or removing one changes every material's program.
    camera.add(this.flashlight);
    scene.add(this.bounceLight);

    this.applyQuality(ctx.quality.preset);
    this.unsubs.push(ctx.events.on('quality:changed', () => this.applyQuality(ctx.quality.preset)));
  }

  fixedUpdate(dt: number): void {
    const input = this.ctx.input;
    if (input.consumePressed('flashlight')) this.setFlashlight(!this.flashlightOn);
    if (this.flashlightOn && !this.viewmodel.lightBlocked) {
      this.battery = Math.max(0, this.battery - dt / BATTERY_LIFE);
      if (this.battery === 0) {
        this.setFlashlight(false);
        this.ctx.hud.toast(tr('Батарейка села', 'Battery died'));
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
      // A zombie in the way takes the blow (the scene checks); otherwise the world does.
      if (this.onStrike?.(this.viewmodel.currentItem)) this.viewmodel.recoil();
      else this.strikeSound();
      this.hitKick = 0.03;
    }

  }

  /** The blow lands: what is in front within reach, and what it is made of (stage 4 adds damage). */
  private strikeSound(): void {
    const item = this.viewmodel.currentItem;
    const reach = this.viewmodel.swing.reach;
    const o = this.camera.getWorldPosition(_o);
    const d = this.camera.getWorldDirection(_d);
    const det = this.world.rayHitDetail?.(o.x, o.y, o.z, d.x, d.y, d.z, reach, false) ?? null;
    const dist = det ? det.t : this.world.rayHit(o.x, o.y, o.z, d.x, d.y, d.z, reach);
    if (dist < 0) return;
    const surface = det?.glass ? 'windowGlass' : this.surfaceAlong(o, d, dist);
    const material: HitMaterial = (surface && MATERIAL[surface]) ?? 'concrete';
    if (!(material === 'glass' && this.onStrikeWorld)) {
      sfx.hit(material, { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist }, item === 'fists' ? 0.3 : item === 'knife' ? 0.5 : 1);
    }
    this.viewmodel.recoil();
    // A little in front of the surface: sparks fly off it, not inside it.
    const at = dist - 0.04;
    this.onStrikeWorld?.(o.x + d.x * at, o.y + d.y * at, o.z + d.z * at, item, det?.glass && !det.door ? det.owner : undefined);
  }

  /** Pre-build the spatial chunk/interior AABB cache during loading/prewarm so the first shot never stalls computing bounds. */
  warmSurfaceCache(): void {
    this.worldMeshCacheCount = -1;
    this.refreshWorldMeshCache();
  }

  private refreshWorldMeshCache(): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const count = this.scene.children.length;
    if (count === this.worldMeshCacheCount && now - this.worldMeshCacheAt < 500) return;
    this.worldMeshCacheCount = count;
    this.worldMeshCacheAt = now;
    this.worldMeshCache.length = 0;
    this.scene.traverse((obj) => {
      const m = obj as Mesh;
      if (!m.isMesh || !/^(chunk|interior)/.test(obj.name)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      if (!m.geometry.boundingBox) return;
      m.updateWorldMatrix(true, false);
      const box = new Box3().copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
      this.worldMeshCache.push({ mesh: m, box });
    });
  }

  /**
   * What the world is made of where a ray from `o` along `d` meets it (about `dist` away): the surface
   * of the triangle in the world meshes (chunks, interiors), decals skipped; null if none found.
   */
  surfaceAlong(o: Vector3, d: Vector3, dist: number): Surface | null {
    this.refreshWorldMeshCache();
    const t0 = Math.max(0, dist - 0.75);
    const t1 = dist + 0.4;
    const x0 = o.x + d.x * t0;
    const y0 = o.y + d.y * t0;
    const z0 = o.z + d.z * t0;
    const x1 = o.x + d.x * t1;
    const y1 = o.y + d.y * t1;
    const z1 = o.z + d.z * t1;
    const minX = (x0 < x1 ? x0 : x1) - 0.35;
    const maxX = (x0 > x1 ? x0 : x1) + 0.35;
    const minY = (y0 < y1 ? y0 : y1) - 0.35;
    const maxY = (y0 > y1 ? y0 : y1) + 0.35;
    const minZ = (z0 < z1 ? z0 : z1) - 0.35;
    const maxZ = (z0 > z1 ? z0 : z1) + 0.35;

    const targets = this.surfaceTargets;
    targets.length = 0;
    for (let i = 0; i < this.worldMeshCache.length; i++) {
      const e = this.worldMeshCache[i];
      if (!e.mesh.parent || !e.mesh.visible) continue;
      const b = e.box;
      if (b.max.x < minX || b.min.x > maxX || b.max.z < minZ || b.min.z > maxZ || b.max.y < minY || b.min.y > maxY) continue;
      targets.push(e.mesh);
    }
    if (targets.length === 0) return null;

    _ray.set(o, d);
    _ray.near = Math.max(0, dist - 0.8);
    _ray.far = dist + 0.4;
    for (const hit of _ray.intersectObjects(targets, false)) {
      const layer = hit.face ? (hit.object as Mesh).geometry.getAttribute('aLayer')?.getX(hit.face.a) : undefined;
      if (layer === undefined) continue;
      const surface = SURFACE_LIST[Math.round(layer)];
      // Decals lie on top of the real surface.
      if (!surface || surface.startsWith('decal')) continue;
      targets.length = 0;
      return surface;
    }
    targets.length = 0;
    return null;
  }

  /** A shot's jolt of the camera (decays fast); `zoom` the field of view's share in the sights. */
  shake(amount: number): void {
    this.shakeT = Math.max(this.shakeT, amount);
  }
  zoom = 1;

  /** The scene's field of view (resize); the sights' zoom applies on top. */
  setBaseFov(fov: number): void {
    this.baseFov = fov;
    this.camera.fov = fov * this.lastZoom;
    this.camera.updateProjectionMatrix();
  }
  private shakeT = 0;
  private lastZoom = 1;
  private baseFov = 0;
  private smoothEyeY = NaN;

  render(alpha: number, frameDt: number): void {
    const c = this.controller;
    this.ctx.input.consumeLook(this.look);
    if (this.dead) return;
    c.applyLook(this.look.x, this.look.y);

    const x = lerp(c.prevPosition.x, c.position.x, alpha);
    const y = lerp(c.prevPosition.y, c.position.y, alpha);
    const z = lerp(c.prevPosition.z, c.position.z, alpha);
    const phase = lerp(c.prevStepPhase, c.stepPhase, alpha);
    const crouchT = lerp(c.prevCrouchT, c.crouchT, alpha);

    const amp = clamp(c.speed / SPEED_WALK, 0, 1.6);
    const cos = Math.cos(c.yaw);
    const sin = Math.sin(c.yaw);
    // Keep 3rd-person lower-body rig animated (only pelvis/legs are on layer 0; upper torso/arms cast layer-2 shadow).
    this.body.update(x, y, z, c.yaw, c.speed, crouchT, c.pitch, c.airborne, frameDt);
    const bob = this.cameraBob;
    const baseY = y + c.eyeHeight(alpha);
    const bobY = -Math.abs(Math.sin(phase)) * 0.032 * amp * (1 - crouchT * 0.75) * bob;
    const targetEyeY = baseY + bobY;
    if (!Number.isFinite(this.smoothEyeY) || Math.abs(targetEyeY - this.smoothEyeY) > 1.5 || frameDt <= 0) {
      this.smoothEyeY = targetEyeY;
    } else {
      this.smoothEyeY = damp(this.smoothEyeY, targetEyeY, 20, frameDt);
    }
    // Decouple first-person camera XZ from crouched 3rd-person head bone animation so shoulders/torso never enter camera.
    const fwdPush = 0.04;
    _eye.set(x - sin * fwdPush, this.smoothEyeY, z - cos * fwdPush);
    const ahead = (_eye.x - x) * -sin + (_eye.z - z) * -cos;
    if (ahead > 0.02) {
      const room = this.world.rayHit(x, baseY, z, -sin, 0, -cos, ahead + 0.2);
      if (room >= 0) {
        const fit = Math.max(0, room - 0.18);
        if (fit < ahead) {
          _eye.x += sin * (ahead - fit);
          _eye.z += cos * (ahead - fit);
        }
      }
    }
    this.landDip = damp(this.landDip, 0, 7, frameDt);
    this.hitKick = damp(this.hitKick, 0, 16, frameDt);
    this.camera.position.set(_eye.x, _eye.y - this.landDip * bob, _eye.z);
    this.shakeT = damp(this.shakeT, 0, 14, frameDt);
    const sh = this.shakeT * 0.02 * bob;
    this.camera.rotation.set(
      c.pitch + this.viewmodel.cameraPitch - this.hitKick * bob + (Math.random() - 0.5) * sh,
      c.yaw + (Math.random() - 0.5) * sh,
      Math.sin(phase) * 0.004 * amp * bob + this.viewmodel.cameraRoll * bob + (Math.random() - 0.5) * sh,
      'YXZ',
    );
    // The sights narrow the view a little (the scene sets the base field of view on resize).
    if (!this.baseFov) this.baseFov = this.camera.fov;
    const want = 1 + (this.zoom - 1) * this.viewmodel.ads;
    if (Math.abs(want - this.lastZoom) > 1e-4) {
      this.lastZoom = want;
      this.camera.fov = this.baseFov * want;
      this.camera.updateProjectionMatrix();
    }
    const light = this.lightLevel(frameDt);

    const f = this.frame;
    f.lookX = this.look.x;
    f.lookY = this.look.y;
    f.stepPhase = phase;
    f.speed = c.speed;
    f.sprinting = c.sprinting;
    f.crouch = crouchT;
    f.flashlightOn = this.flashlightOn;
    f.light = light;
    this.viewmodel.update(frameDt, f);
    this.aimLight(frameDt, light);
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.body.dispose();
    this.viewmodel.dispose();
    this.flashlight.removeFromParent();
    this.flashlight.dispose();
    this.bounceLight.removeFromParent();
    this.bounceLight.dispose();
  }

  /** Temporarily suppress the hand flashlight while seated in a vehicle. */
  suppressLight(on: boolean): void {
    if (this.suppressed === on) return;
    this.suppressed = on;
    if (on) {
      this.flashlight.intensity = 0;
      this.bounceLight.intensity = 0;
    }
  }

  /** Render the shadow map once (used during loading to compile its shaders off-screen). */
  prewarmShadows(): void {
    this.flashlight.shadow.needsUpdate = true;
  }

  /** Prewarm only: force the flashlight shadow state during boot compilation, or restore the preset's. */
  setFlashlightShadow(on: boolean | null): void {
    this.forceFlashShadow = on;
    if (on !== null) {
      this.flashlight.castShadow = on;
      if (on && this.flashlight.shadow.mapSize.x < 256) {
        this.flashlight.shadow.mapSize.set(512, 512);
        this.flashlight.shadow.map?.dispose();
        this.flashlight.shadow.map = null;
      }
      this.flashlight.shadow.needsUpdate = on;
    } else {
      this.applyQuality(this.ctx.quality.preset);
    }
  }

  /** The flashlight is actually shining. */
  get lightOn(): boolean {
    return !this.suppressed && this.flashlightOn && this.battery > 0 && !this.viewmodel.lightBlocked;
  }

  rechargeBattery(amount: number): void {
    this.battery = Math.min(1, this.battery + amount);
  }

  /** F: the thumb clicks the button. A dead battery gives only a weak flash. */
  private setFlashlight(on: boolean): void {
    sfx.item('click');
    this.viewmodel.click();
    if (on && this.battery <= 0) {
      this.flashT = 0.12;
      this.ctx.hud.toast(tr('Нужны батарейки', 'Need batteries'));
      return;
    }
    if (on && this.viewmodel.lightBlocked)
      this.ctx.hud.toast(tr('Руки на оружии: светит только подствольный фонарь', 'Hands on weapon: only a weapon light can shine'));
    this.flashlightOn = on;
    this.dropT = 0;
    this.flickerT = 1;
    this.flashlight.shadow.autoUpdate = false;
    this.lastShadowPos.x = 1e9;
    if (this.flashlight.castShadow && on) this.flashlight.shadow.needsUpdate = true;
  }

  /**
   * How bright the flashlight is now, 0..1: full above 30% charge; below, dimmer (and yellower, see
   * aimLight); below 15% it flickers and drops out for 0.1–0.5 s now and then.
   */
  private lightLevel(dt: number): number {
    if (this.flashT > 0) {
      this.flashT -= dt;
      return this.flashT > 0 ? 0.1 : 0;
    }
    // A gun without the underbarrel flashlight: both hands on it, nothing shines (it comes back with the knife).
    if (!this.flashlightOn || this.viewmodel.lightBlocked) return 0;
    const b = this.battery;
    const B = FLASHLIGHT.battery;
    let k = b >= B.dim ? 1 : 0.3 + (0.7 * b) / B.dim;
    if (b < B.flicker) {
      this.flickerT -= dt;
      if (this.dropT > 0) {
        this.dropT -= dt;
        k *= 0.04;
      } else if (this.flickerT <= 0) {
        this.dropT = 0.1 + Math.random() * 0.4;
        // The emptier, the more often.
        this.flickerT = 0.5 + Math.random() * (0.6 + (6 * b) / B.flicker);
      } else {
        k *= 0.82 + 0.18 * Math.random();
      }
    }
    return k;
  }

  /**
   * The beam from the flashlight in the hand: from its lens, along it (Viewmodel.lightFrame), trailing
   * the camera's turns a little; brightness and colour by the battery.
   */
  private aimLight(dt: number, level: number): void {
    if (this.suppressed) return;
    const L = this.flashlight;
    if (level <= 0.02) {
      L.intensity = 0;
      this.bounceLight.intensity = 0;
      return;
    }
    L.intensity = FLASHLIGHT.light.intensity * level;
    const weak = this.battery < FLASHLIGHT.battery.dim ? 1 - this.battery / FLASHLIGHT.battery.dim : 0;
    L.color.copy(LIGHT_COLOR).lerp(WEAK_COLOR, weak);
    this.viewmodel.lightFrame(_lp, _ld);
    L.position.copy(_lp);
    this.camera.updateMatrixWorld();
    this.camera.getWorldQuaternion(_q);
    _ld.applyQuaternion(_q);
    if (!this.beamSet) {
      this.beam.copy(_ld);
      this.beamSet = true;
    } else this.beam.lerp(_ld, 1 - Math.exp(-12 * dt)).normalize();
    this.lightTarget.position.copy(this.beam).applyQuaternion(_q.invert()).multiplyScalar(6).add(_lp);
    this.camera.getWorldPosition(_o);
    const hit = this.world.rayHit(_o.x, _o.y, _o.z, this.beam.x, this.beam.y, this.beam.z, 12);
    if (hit < 11.8) {
      const d = Math.max(0.25, hit - 0.35);
      this.bounceLight.position.set(_o.x + this.beam.x * d, _o.y + this.beam.y * d, _o.z + this.beam.z * d);
      this.bounceLight.color.copy(L.color);
      this.bounceLight.intensity = 1.25 * level * (1 - hit / 14);
    } else {
      this.bounceLight.intensity = 0;
    }
    if (L.castShadow) {
      this.shadowAccum += dt;
      const moved = this.camera.position.distanceToSquared(this.lastShadowPos) > 0.000225;
      const turned = this.beam.dot(this.lastShadowDir) < 0.99998;
      if (moved || turned || this.shadowAccum >= 0.066) {
        L.shadow.needsUpdate = true;
        this.lastShadowPos.copy(this.camera.position);
        this.lastShadowDir.copy(this.beam);
        this.shadowAccum = 0;
      }
    }
  }


  setShadowOverride(mode: ShadowQuality | null): void {
    this.shadowOverride = mode;
    this.applyQuality(this.ctx.quality.preset);
  }

  private applyQuality(preset: QualityPreset): void {
    // Shadows from the flashlight on high quality only (unless pinned by boot prewarm or settings).
    const wantFlash = this.shadowOverride ? this.shadowOverride === 'high' : preset.level === 'high' && preset.shadowMapSize > 0;
    const shadows = this.forceFlashShadow ?? wantFlash;
    this.flashlight.shadow.autoUpdate = false;
    if (this.flashlight.castShadow !== shadows) {
      this.flashlight.castShadow = shadows;
      this.lastShadowPos.x = 1e9;
      this.flashlight.shadow.needsUpdate = shadows && (this.flashlightOn || this.forceFlashShadow === true);
    }
    const wantSize =
      this.shadowOverride === 'off'
        ? 0
        : this.shadowOverride === 'medium'
          ? 1024
          : this.shadowOverride === 'high'
            ? 2048
            : preset.shadowMapSize;
    const wantDist = this.shadowOverride === 'high' ? 32 : this.shadowOverride === 'medium' ? 22 : preset.shadowDistance;
    const size = Math.max(this.forceFlashShadow ? Math.max(wantSize, 512) : wantSize, 1);
    const shadow = this.flashlight.shadow;
    if (shadow.camera.far !== wantDist) {
      shadow.camera.far = wantDist;
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
