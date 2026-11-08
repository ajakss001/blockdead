import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Action, InputManager } from './InputManager';

/** Joystick travel in CSS px. */
const STICK_RADIUS = 56;
/** Left share of the screen that spawns the movement stick; the rest is look. */
const STICK_ZONE = 0.42;
/** Stick deflection that counts as "stopped" (cancels latched sprint). */
const STICK_DEADZONE = 0.15;

type ButtonKind = 'hold' | 'tap' | 'toggle' | 'latch';

/**
 * Phone controls: floating movement stick on the left, drag-to-look on the right, action buttons.
 * Pointer Events with per-pointerId tracking, so stick, look and buttons work simultaneously.
 */
export class TouchInput {
  /** Radians per CSS pixel of drag. */
  lookSensitivity = 0.0065;

  private readonly root = document.createElement('div');
  private readonly stick = document.createElement('div');
  private readonly knob = document.createElement('div');
  private sprintButton!: HTMLButtonElement;
  private useButton!: HTMLButtonElement;

  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private lookId = -1;
  private lookLastX = 0;
  private lookLastY = 0;

  constructor(
    private readonly input: InputManager,
    parent: HTMLElement,
    events?: EventBus<GameEvents>,
  ) {
    this.root.className = 'touch';
    this.stick.className = 'touch__stick';
    this.stick.hidden = true;
    this.knob.className = 'touch__knob';
    this.stick.append(this.knob);

    const buttons = document.createElement('div');
    buttons.className = 'touch__buttons';
    buttons.append(
      this.button('Атака', 'attack', 'hold', 'touch__btn--attack'),
      (this.sprintButton = this.button('Бег', 'sprint', 'latch', 'touch__btn--sprint')),
      this.button('Присед', 'crouch', 'toggle', 'touch__btn--crouch'),
      this.button('Свет', 'flashlight', 'toggle', 'touch__btn--light'),
      (this.useButton = this.button('Обыск', 'use', 'tap', 'touch__btn--use')),
      this.button('Рюкзак', 'inventory', 'tap', 'touch__btn--bag'),
      this.button('Прыжок', 'jump', 'tap', 'touch__btn--jump'),
      this.button('Карта', 'map', 'tap', 'touch__btn--map'),
      this.button('Перезар.', 'reload', 'tap', 'touch__btn--gun touch__btn--reload'),
      this.button('Прицел', 'aim', 'latch', 'touch__btn--gun touch__btn--aim'),
      this.weaponButton(),
    );
    this.root.append(this.stick, buttons);
    parent.append(this.root);
    // The search / door button only while the crosshair is on something to use.
    this.useButton.hidden = true;
    events?.on('ui:target', ({ target }) => (this.useButton.hidden = !target));

    this.root.addEventListener('pointerdown', this.onDown);
    this.root.addEventListener('pointermove', this.onMove);
    this.root.addEventListener('pointerup', this.onUp);
    this.root.addEventListener('pointercancel', this.onUp);
    input.setActive(true);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.target !== this.root) return; // buttons handle themselves
    if (e.clientX < window.innerWidth * STICK_ZONE && this.stickId === -1) {
      this.stickId = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.knob.style.transform = 'translate(-50%, -50%)';
      this.stick.hidden = false;
    } else if (this.lookId === -1) {
      this.lookId = e.pointerId;
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    } else {
      return;
    }
    this.root.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      let dx = e.clientX - this.stickX;
      let dy = e.clientY - this.stickY;
      const len = Math.hypot(dx, dy);
      if (len > STICK_RADIUS) {
        dx *= STICK_RADIUS / len;
        dy *= STICK_RADIUS / len;
      }
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      this.input.setMove(dx / STICK_RADIUS, -dy / STICK_RADIUS);
      if (len / STICK_RADIUS < STICK_DEADZONE) this.cancelSprint();
    } else if (e.pointerId === this.lookId) {
      this.input.addLook((e.clientX - this.lookLastX) * this.lookSensitivity, (e.clientY - this.lookLastY) * this.lookSensitivity);
      this.lookLastX = e.clientX;
      this.lookLastY = e.clientY;
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = -1;
      this.stick.hidden = true;
      this.input.setMove(0, 0);
      this.cancelSprint();
    } else if (e.pointerId === this.lookId) {
      this.lookId = -1;
    }
  };

  private cancelSprint(): void {
    if (!this.sprintButton.classList.contains('on')) return;
    this.sprintButton.classList.remove('on');
    this.input.release('sprint');
  }

  private button(label: string, action: Action, kind: ButtonKind, cls: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `touch__btn ${cls}`;
    btn.textContent = label;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      switch (kind) {
        case 'hold':
          btn.classList.add('on');
          this.input.press(action);
          break;
        case 'tap':
          // Edge on touch-down; held until the finger lifts, so a long press can't act twice.
          this.input.press(action);
          break;
        case 'toggle':
          btn.classList.toggle('on');
          this.input.press(action);
          this.input.release(action);
          break;
        case 'latch':
          if (btn.classList.toggle('on')) this.input.press(action);
          else this.input.release(action);
          break;
      }
    });
    if (kind === 'hold' || kind === 'tap') {
      const up = () => {
        btn.classList.remove('on');
        this.input.release(action);
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
    }
    return btn;
  }

  /** One button draws the weapon or puts it away. */
  private weaponButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'touch__btn touch__btn--weapon';
    btn.textContent = 'Оружие';
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.press('weapon');
      this.input.release('weapon');
    });
    return btn;
  }
}
