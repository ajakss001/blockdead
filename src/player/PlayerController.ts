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
const GRAVITY = 9.8;
/** Jump apex above the feet, m: a curb, a crate or a sandbag wall, never a car roof. */
export const JUMP_HEIGHT = 0.45;
/** A drop bigger than this is a fall (gravity), smaller ones are followed like steps. */
const FALL_FROM = 0.35;

/** Height of the walkable surface under (x, z) for a body currently at height y (multi-storey). */
export type GroundFn = (x: number, z: number, y: number) => number;

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
  /** Class: how loud the footsteps are (1 = normal). */
  noiseMul = 1;
  /** Set from survival stats each step: exhaustion first slows, then forbids sprinting. */
  canSprint = true;
  sprintFactor = 1;
  /** Jumping: allowed now (no window, no search) and how high (fatigue; 0 = too tired). */
  canJump = true;
  jumpFactor = 1;
  airborne = false;
  vy = 0;
  /** This step only: took off; landed with this fall speed, m/s (sound, camera, noise). */
  jumped = false;
  landed = 0;

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
    this.sprinting = input.isHeld('sprint') && my > 0.3 && !this.crouched && this.canSprint;
    const maxSpeed = this.crouched ? SPEED_CROUCH : this.sprinting ? SPEED_SPRINT * this.sprintFactor : SPEED_WALK;

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
    this.jumped = false;
    this.landed = 0;
    if (input.consumePressed('jump') && !this.airborne && this.canJump && this.jumpFactor > 0 && !this.crouched) {
      this.vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT * this.jumpFactor);
      this.airborne = true;
      this.jumped = true;
    }
    if (ground) {
      const p = this.position;
      // The floor, or the top of a crate / table / sandbag under the feet (a bit higher in the air:
      // the legs tuck up onto it).
      let target = ground(p.x, p.z, p.y);
      const top = world.supportAt(p.x, p.z, PLAYER_RADIUS * 0.8, p.y + (this.airborne ? 0.3 : 0.35));
      if (top > target) target = top;
      if (this.airborne) {
        this.vy -= GRAVITY * dt;
        p.y += this.vy * dt;
        if (this.vy <= 0 && p.y <= target) {
          this.landed = -this.vy;
          p.y = target;
          this.vy = 0;
          this.airborne = false;
          if (this.landed > 2) this.addNoise(Math.min(0.6, this.landed * 0.1));
        }
      } else if (target < p.y - FALL_FROM) {
        // Walked off an edge.
        this.airborne = true;
        this.vy = 0;
      } else {
        // Climb quickly (steps), fall a little slower (reads as a drop, not a teleport).
        p.y = damp(p.y, target, target > p.y ? GROUND_FOLLOW : GROUND_FOLLOW * 0.6, dt);
      }
    }

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
    this.noise = Math.min(1, Math.max(this.gaitNoise * this.noiseMul, this.noiseImpulse));
  }

  eyeHeight(alpha: number): number {
    return lerp(EYE_STAND, EYE_CROUCH, lerp(this.prevCrouchT, this.crouchT, alpha));
  }
}
