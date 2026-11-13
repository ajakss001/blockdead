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

const TOUCH_ICONS: Partial<Record<Action, string>> = {
  inventory: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="#1b1915" stroke-width="1.2" stroke-linejoin="round"><path d="M9 5a3 3 0 0 1 6 0v1h2a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2V5zm2 0v1h2V5a1 1 0 0 0-2 0z"/><rect x="8.5" y="13" width="7" height="4" rx="1" fill="#1b1915" opacity="0.28"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" fill="currentColor" fill-opacity="0.22"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/><path d="M6 13c2-2 4 1 6-1s4 2 6 0" stroke-dasharray="2 2"/></svg>',
  flashlight: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="#1b1915" stroke-width="1.1" stroke-linejoin="round"><path d="M15 3l6 6-3 3-2-1-7 7-3-3 7-7-1-2 3-3z"/><circle cx="11.5" cy="12.5" r="1.1" fill="#1b1915"/></svg>',
  weapon: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="#1b1915" stroke-width="1.1" stroke-linejoin="round"><path d="M3 8h16l1.5 2-1.5 2H11l-1.8 6H5.5l1.6-6H3V8z"/><circle cx="12" cy="13" r="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  attack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="13" r="6.5"/><line x1="11" y1="3.5" x2="11" y2="7.5"/><line x1="11" y1="18.5" x2="11" y2="22.5"/><line x1="1.5" y1="13" x2="5.5" y2="13"/><line x1="16.5" y1="13" x2="20.5" y2="13"/><path d="M16 8c0-2.5 2-3.5 1.5-5.5 2 1 3.5 3 3 5-.2.9-1 1.5-2 1.8" fill="currentColor" stroke="none"/></svg>',
  sprint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="5" r="2" fill="currentColor" stroke="none"/><path d="M6 16l4-4 3 1.5 2.5-4.5"/><path d="M9.5 12l-2-3 4-2 3 2 3-1"/><path d="M5 20l4.5-3.5"/></svg>',
  crouch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="14.5" cy="5.5" r="2" fill="currentColor" stroke="none"/><path d="M7 18l4-5 3.5 1.5v4.5h3"/><path d="M11 13l3-3.5 4 1.5"/></svg>',
  jump: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="#1b1915" stroke-width="1" stroke-linejoin="round"><path d="M9 20c3-4 4-8 4-12H9.5L14 3l4.5 5H15c0 5-1.5 9-4 12H9z"/></svg>',
  use: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="#1b1915" stroke-width="1" stroke-linejoin="round"><path d="M6 14a6 6 0 1 1 12 0" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M11 11V7.5a1 1 0 1 1 2 0V11h1V8.5a1 1 0 1 1 2 0V14a4 4 0 0 1-8 0v-2.5a1 1 0 1 1 2 0V11h1z"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.5-5.8"/><polygon points="21 3 21 9 15 9" fill="currentColor" stroke="none"/></svg>',
  aim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><line x1="12" y1="2" x2="12" y2="6.5"/><line x1="12" y1="17.5" x2="12" y2="22"/><line x1="2" y1="12" x2="6.5" y2="12"/><line x1="17.5" y1="12" x2="22" y2="12"/></svg>',
};

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
    const icon = TOUCH_ICONS[action];
    if (icon) {
      btn.innerHTML = icon + (action === 'attack' ? '<span class="touch__badge" hidden></span>' : '');
    }
    const sync = () => {
      const text = tr(label[0], label[1]);
      btn.setAttribute('aria-label', text);
      btn.title = text;
      if (!icon) btn.textContent = text;
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
    btn.innerHTML = TOUCH_ICONS.weapon ?? '';
    const sync = () => {
      const text = tr('Оружие', 'Weapon');
      btn.setAttribute('aria-label', text);
      btn.title = text;
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
