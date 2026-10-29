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
export const JUMP_HEIGHT = 0.6;
/** Body height standing / crouched (walls, ceilings, squeezing under a lintel from a table). */
export const HEIGHT_STAND = 1.78;
export const HEIGHT_CROUCH = 1.2;
/** Climbing onto ledges (cars, tables, crates, parapets): rise above the feet, and how long it takes. */
export const MANTLE_MIN = 0.5;
export const MANTLE_MAX = 1.5;
const MANTLE_TIME = 0.45;
/** Falls: harmless below 4 m, deadly from 10 m. */
export const FALL_HURT = 4;
export const FALL_DEADLY = 10;
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

  /** This step only: fall damage as a share of health (0..1+), from the height dropped. */
  fallDamage = 0;
  /** Climbing onto a ledge: progress 0..1 (−1 = not climbing), from where to where. */
  mantleT = -1;
  private readonly mantleFrom = new Vector3();
  private readonly mantleTo = new Vector3();
  /** Highest point of the current time in the air (fall height). */
  private peakY = 0;
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
    if (input.consumePressed('crouch')) {
      // Standing up needs headroom (under a table-top lintel you stay down).
      if (!this.crouched) this.crouched = true;
      else if (world.ceilingAt(this.position.x, this.position.z, PLAYER_RADIUS * 0.9, this.position.y + HEIGHT_CROUCH - 0.05) > this.position.y + HEIGHT_STAND) this.crouched = false;
    }
    const height = this.crouched ? HEIGHT_CROUCH : HEIGHT_STAND;
    this.jumped = false;
    this.landed = 0;
    this.fallDamage = 0;
    if (this.mantleT >= 0) {
      // Climbing: up first, then over the edge; no control meanwhile.
      this.prevPosition.copy(this.position);
      this.mantleT = Math.min(1, this.mantleT + dt / MANTLE_TIME);
      const t = this.mantleT;
      const up = Math.min(1, t / 0.65);
      const over = Math.max(0, (t - 0.35) / 0.65);
      this.position.set(
        this.mantleFrom.x + (this.mantleTo.x - this.mantleFrom.x) * over,
        this.mantleFrom.y + (this.mantleTo.y - this.mantleFrom.y) * (1 - (1 - up) * (1 - up)),
        this.mantleFrom.z + (this.mantleTo.z - this.mantleFrom.z) * over,
      );
      this.velocity.set(0, 0, 0);
      if (t >= 1) {
        this.mantleT = -1;
        this.airborne = false;
        this.vy = 0;
        this.landed = 1;
      }
      this.speed = damp(this.speed, 0, 10, dt);
      return;
    }
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
    world.resolveCircle(this.position, PLAYER_RADIUS, height);
    const jump = input.consumePressed('jump');
    // Jump at a ledge in front (or still rising from a jump): climb onto it.
    if (jump || (this.airborne && this.vy > 0 && my > 0.3)) {
      const fx = -sin;
      const fz = -cos;
      const top = this.canJump ? world.ledgeAhead(this.position.x, this.position.z, fx, fz, this.position.y, MANTLE_MIN, MANTLE_MAX) : -1;
      if (top > 0 && (jump || my > 0.3)) {
        this.mantleFrom.copy(this.position);
        this.mantleTo.set(this.position.x + fx * 0.6, top, this.position.z + fz * 0.6);
        this.mantleT = 0;
        this.crouched = world.ceilingAt(this.mantleTo.x, this.mantleTo.z, PLAYER_RADIUS * 0.9, top + 0.05) <= top + HEIGHT_STAND;
        this.jumped = jump;
        return;
      }
    }
    if (jump && !this.airborne && this.canJump && this.jumpFactor > 0 && !this.crouched) {
      this.vy = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT * this.jumpFactor);
      this.airborne = true;
      this.jumped = true;
      this.peakY = this.position.y;
    }
    if (ground) {
      const p = this.position;
      // The floor, or the top of a crate / table / sandbag under the feet (a bit higher in the air:
      // the legs tuck up onto it).
      let target = ground(p.x, p.z, p.y);
      const top = world.supportAt(p.x, p.z, PLAYER_RADIUS * 0.8, p.y + (this.airborne ? 0.3 : 0.35), p.y);
      if (top > target) target = top;
      if (this.airborne) {
        this.vy -= GRAVITY * dt;
        p.y += this.vy * dt;
        this.peakY = Math.max(this.peakY, p.y);
        // The head stops at whatever is above (a lintel, a ceiling, the top of a wall opening).
        const ceil = world.ceilingAt(p.x, p.z, PLAYER_RADIUS * 0.9, p.y + 0.4);
        if (p.y + height > ceil) {
          p.y = ceil - height - 0.01;
          if (this.vy > 0) this.vy = 0;
        }
        if (this.vy <= 0 && p.y <= target) {
          this.landed = -this.vy;
          p.y = target;
          this.vy = 0;
          this.airborne = false;
          if (this.landed > 2) this.addNoise(Math.min(0.6, this.landed * 0.1));
          const drop = this.peakY - p.y;
          if (drop >= FALL_HURT) this.fallDamage = drop >= FALL_DEADLY ? 1 : 0.15 + (0.85 * (drop - FALL_HURT)) / (FALL_DEADLY - FALL_HURT);
        }
      } else if (target < p.y - FALL_FROM) {
        // Walked off an edge.
        this.airborne = true;
        this.vy = 0;
        this.peakY = p.y;
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
