import { Vector3 } from 'three';
import { clamp, damp, lerp } from '../core/math';
import type { InputManager } from '../input/InputManager';
import type { CollisionWorld } from '../world/CollisionWorld';

export const PLAYER_RADIUS = 0.3;
export const SPEED_WALK = 2.2;
export const SPEED_SPRINT = 4.6;
export const SPEED_CROUCH = 1.1;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.08;

/** Velocity response, 1/s. High enough to feel immediate, low enough to avoid jitter. */
const ACCEL = 14;
/** Distance covered by one step, m. One full leg cycle (2π of stepPhase) = two steps. */
const STRIDE_WALK = 0.75;
const STRIDE_SPRINT = 1.15;
const PITCH_LIMIT = 1.45;
/** How fast the feet follow the ground (1/s): smooths steps and slope changes. */
const GROUND_FOLLOW = 18;

/** Ground height at (x, z). */
export type GroundFn = (x: number, z: number) => number;

/** Footstep loudness by gait, 0..1 — zombies (stage 4) hear the player through this. */
const NOISE_CROUCH = 0.1;
const NOISE_WALK = 0.35;
const NOISE_SPRINT = 0.9;

/**
 * Kinematic first-person mover. Runs in fixedUpdate; the camera reads interpolated state.
 * Axes: yaw 0 looks along -Z, +X is right. Positive yaw turns left.
 */
export class PlayerController {
  readonly position = new Vector3();
  readonly prevPosition = new Vector3();
  readonly velocity = new Vector3();
  yaw = 0;
  pitch = 0;

  crouched = false;
  crouchT = 0;
  prevCrouchT = 0;
  sprinting = false;
  /** Smoothed ground speed, m/s (actual displacement, so walking into a wall reads ~0). */
  speed = 0;
  stepPhase = 0;
  prevStepPhase = 0;
  /** Current noise emitted by the player, 0..1. */
  noise = 0;

  private gaitNoise = 0;
  private noiseImpulse = 0;

  constructor(spawn: Vector3, yaw: number) {
    this.position.copy(spawn);
    this.prevPosition.copy(spawn);
    this.yaw = yaw;
  }

  applyLook(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = clamp(this.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
  }

  /** One-off loud event (attack, breaking glass). Decays over ~1 s. */
  addNoise(level: number): void {
    this.noiseImpulse = Math.max(this.noiseImpulse, level);
  }

  fixedUpdate(dt: number, input: InputManager, world: CollisionWorld, ground?: GroundFn): void {
    if (input.consumePressed('crouch')) this.crouched = !this.crouched;
    const mx = input.moveX;
    const my = input.moveY;
    this.sprinting = input.isHeld('sprint') && my > 0.3 && !this.crouched;
    const maxSpeed = this.crouched ? SPEED_CROUCH : this.sprinting ? SPEED_SPRINT : SPEED_WALK;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward = (-sin, -cos), right = (cos, -sin)
    const wishX = (cos * mx - sin * my) * maxSpeed;
    const wishZ = (-sin * mx - cos * my) * maxSpeed;
    const k = 1 - Math.exp(-ACCEL * dt);
    this.velocity.x += (wishX - this.velocity.x) * k;
    this.velocity.z += (wishZ - this.velocity.z) * k;

    this.prevPosition.copy(this.position);
    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    world.resolveCircle(this.position, PLAYER_RADIUS);
    if (ground) this.position.y = damp(this.position.y, ground(this.position.x, this.position.z), GROUND_FOLLOW, dt);

    // Velocity follows the resolved displacement, so pushing into a wall slides instead of building up.
    const dx = this.position.x - this.prevPosition.x;
    const dz = this.position.z - this.prevPosition.z;
    this.velocity.x = dx / dt;
    this.velocity.z = dz / dt;
    const moved = Math.hypot(dx, dz);
    this.speed = damp(this.speed, moved / dt, 10, dt);

    const runT = clamp((this.speed - SPEED_WALK) / (SPEED_SPRINT - SPEED_WALK), 0, 1);
    this.prevStepPhase = this.stepPhase;
    this.stepPhase += (moved / lerp(STRIDE_WALK, STRIDE_SPRINT, runT)) * Math.PI;

    this.prevCrouchT = this.crouchT;
    this.crouchT = damp(this.crouchT, this.crouched ? 1 : 0, 8, dt);

    const gait = this.speed < 0.2 ? 0 : this.crouched ? NOISE_CROUCH : this.sprinting ? NOISE_SPRINT : NOISE_WALK;
    this.gaitNoise = damp(this.gaitNoise, gait, 4, dt);
    this.noiseImpulse = Math.max(0, this.noiseImpulse - dt * 1.2);
    this.noise = Math.max(this.gaitNoise, this.noiseImpulse);
  }

  eyeHeight(alpha: number): number {
    return lerp(EYE_STAND, EYE_CROUCH, lerp(this.prevCrouchT, this.crouchT, alpha));
  }
}
