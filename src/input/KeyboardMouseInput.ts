import type { Action, InputManager } from './InputManager';

const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
  KeyC: 'crouch',
  KeyF: 'flashlight',
  KeyE: 'use',
  Tab: 'inventory',
  KeyI: 'inventory',
  KeyM: 'map',
  Digit1: 'item1',
  Digit2: 'item2',
  Space: 'jump',
};

const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];

/** Chrome occasionally reports huge movementX/Y spikes under pointer lock; ignore them. */
const MAX_MOUSE_DELTA = 400;

/** PC input: WASD + mouse look through the Pointer Lock API. */
export class KeyboardMouseInput {
  /** Radians per mouse count. */
  sensitivity = 0.0022;

  private readonly keys = new Set<string>();
  /** Quiet "click to continue" state after a game window: keys work, mouse look waits for a click. */
  keysWithoutLock = false;

  constructor(
    private readonly input: InputManager,
    readonly canvas: HTMLCanvasElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Must be called from a user gesture (click). */
  requestLock(): Promise<void> {
    // unadjustedMovement = raw mouse without OS acceleration; not supported everywhere.
    try {
      const result = this.canvas.requestPointerLock({ unadjustedMovement: true }) as unknown;
      if (result instanceof Promise) {
        return result.catch(() => this.canvas.requestPointerLock() as unknown as Promise<void>);
      }
    } catch {
      this.canvas.requestPointerLock();
    }
    return Promise.resolve();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.locked && !this.keysWithoutLock) return;
    const action = KEY_ACTIONS[e.code];
    const isMove = FORWARD.includes(e.code) || BACK.includes(e.code) || LEFT.includes(e.code) || RIGHT.includes(e.code);
    if (!action && !isMove) return;
    e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    if (action) this.input.press(action);
    this.updateMove();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    const action = KEY_ACTIONS[e.code];
    if (action) this.input.release(action);
    this.updateMove();
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.input.reset();
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    if (!this.locked) return;
    if (Math.abs(e.movementX) > MAX_MOUSE_DELTA || Math.abs(e.movementY) > MAX_MOUSE_DELTA) return;
    this.input.addLook(e.movementX * this.sensitivity, e.movementY * this.sensitivity);
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    if (this.locked && e.button === 0) this.input.press('attack');
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.input.release('attack');
  };

  private readonly onLockChange = (): void => {
    this.keys.clear();
    this.input.setActive(this.locked);
  };

  private updateMove(): void {
    const k = this.keys;
    const any = (codes: string[]) => (codes.some((c) => k.has(c)) ? 1 : 0);
    this.input.setMove(any(RIGHT) - any(LEFT), any(FORWARD) - any(BACK));
  }
}
