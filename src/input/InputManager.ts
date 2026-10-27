import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';

export type Action = 'attack' | 'sprint' | 'crouch' | 'flashlight' | 'use' | 'item1' | 'item2';
export type InputMode = 'kbm' | 'touch';

export interface LookDelta {
  x: number;
  y: number;
}

/**
 * Device-independent input state. Exactly one source (keyboard+mouse or touch) writes into it.
 *
 * - move: analog vector, x = strafe right, y = forward, length ≤ 1.
 * - look: radians accumulated since the last consumeLook() — consumed once per rendered frame.
 * - held actions: polled every fixed step (attack, sprint).
 * - pressed actions: edge-triggered, consumed exactly once by the simulation (crouch, flashlight).
 */
export class InputManager {
  moveX = 0;
  moveY = 0;
  /** True when the game receives input (pointer locked on PC; always on touch). */
  active = false;

  private lookX = 0;
  private lookY = 0;
  private readonly held = new Set<Action>();
  private readonly pressed = new Set<Action>();

  constructor(
    readonly mode: InputMode,
    private readonly events: EventBus<GameEvents>,
  ) {}

  setMove(x: number, y: number): void {
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    this.moveX = x;
    this.moveY = y;
  }

  addLook(dx: number, dy: number): void {
    this.lookX += dx;
    this.lookY += dy;
  }

  consumeLook(out: LookDelta): LookDelta {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = this.lookY = 0;
    return out;
  }

  press(action: Action): void {
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  }

  release(action: Action): void {
    this.held.delete(action);
  }

  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  /** True once per press. */
  consumePressed(action: Action): boolean {
    return this.pressed.delete(action);
  }

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) this.reset();
    this.events.emit('input:active', { active });
  }

  /** Drop everything held — on blur, pause, losing pointer lock. Prevents stuck keys. */
  reset(): void {
    this.held.clear();
    this.pressed.clear();
    this.moveX = this.moveY = 0;
    this.lookX = this.lookY = 0;
  }
}
