import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { onLangChange, tr } from '../core/i18n';
import type { Action, InputManager } from './InputManager';

/** Joystick travel in CSS px. */
const STICK_RADIUS = 42;
/** Left share of the screen that spawns the movement stick; the rest is look. */
const STICK_ZONE = 0.45;
/** Stick deflection that counts as "stopped" (cancels latched sprint). */
const STICK_DEADZONE = 0.15;

type ButtonKind = 'hold' | 'tap' | 'toggle' | 'latch';

/**
 * Phone controls: resting + floating movement stick on the left, drag-to-look on the right,
 * compact top-left utility bar and compact bottom-right thumb cluster.
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
    this.knob.className = 'touch__knob';
    this.stick.append(this.knob);

    // Compact top-left utility bar (keeps clutter out of the right look/combat zone).
    const topBar = document.createElement('div');
    topBar.className = 'touch__bar';
    topBar.append(
      this.button(['Рюкзак', 'Bag'], 'inventory', 'tap', 'touch__pill'),
      this.button(['Карта', 'Map'], 'map', 'tap', 'touch__pill'),
      this.button(['Свет', 'Light'], 'flashlight', 'toggle', 'touch__pill'),
      this.weaponButton(),
    );

    // Compact bottom-right combat & movement cluster.
    const buttons = document.createElement('div');
    buttons.className = 'touch__buttons';
    buttons.append(
      this.button(['Атака', 'Attack'], 'attack', 'hold', 'touch__btn--attack'),
      (this.sprintButton = this.button(['Бег', 'Sprint'], 'sprint', 'latch', 'touch__btn--sprint')),
      this.button(['Присед', 'Crouch'], 'crouch', 'toggle', 'touch__btn--crouch'),
      this.button(['Прыжок', 'Jump'], 'jump', 'tap', 'touch__btn--jump'),
      (this.useButton = this.button(['Обыск', 'Use'], 'use', 'tap', 'touch__btn--use')),
      this.button(['Перезар.', 'Reload'], 'reload', 'tap', 'touch__btn--gun touch__btn--reload'),
      this.button(['Прицел', 'Aim'], 'aim', 'latch', 'touch__btn--gun touch__btn--aim'),
    );
    this.root.append(this.stick, topBar, buttons);
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
    if ((e.target as HTMLElement | null)?.closest('button')) return; // buttons handle themselves
    if (e.clientX < window.innerWidth * STICK_ZONE && this.stickId === -1) {
      this.stickId = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.stick.classList.add('touch__stick--active');
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.stick.style.bottom = 'auto';
      this.knob.style.transform = 'translate(-50%, -50%)';
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
      this.stick.classList.remove('touch__stick--active');
      this.stick.style.left = '';
      this.stick.style.top = '';
      this.stick.style.bottom = '';
      this.knob.style.transform = 'translate(-50%, -50%)';
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

  private button(label: [string, string], action: Action, kind: ButtonKind, cls: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `touch__btn ${cls}`;
    const sync = () => {
      btn.textContent = tr(label[0], label[1]);
    };
    sync();
    onLangChange(sync);
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
    btn.className = 'touch__btn touch__pill touch__btn--weapon';
    const sync = () => {
      btn.textContent = tr('Оружие', 'Weapon');
    };
    sync();
    onLangChange(sync);
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.press('weapon');
      this.input.release('weapon');
    });
    return btn;
  }
}
