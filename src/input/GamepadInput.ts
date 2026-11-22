import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { tr } from '../core/i18n';
import type { Settings } from '../core/Settings';
import type { Action, InputManager } from './InputManager';

const SLOT_ACTIONS: readonly Action[] = ['slot1', 'slot2', 'slot3', 'slot4'];

export interface GamepadHooks {
  isModalOpen(): boolean;
  onMenuToggle(): void;
  onModalBack(): void;
  onActivate(): void;
  toast(text: string): void;
}

function btnDown(pad: Gamepad, idx: number, threshold = 0.25): boolean {
  const b = pad.buttons[idx];
  return !!b && (b.pressed || b.value > threshold);
}

/**
 * Full Web Gamepad API support for desktop controllers (Xbox, DualSense/DualShock, Switch Pro)
 * and mobile clip-on controllers (Backbone One, Razer Kishi, GameSir, etc.).
 */
export class GamepadInput {
  connected = false;
  name = '';

  private padIndex: number | null = null;
  private readonly prev = new Array<boolean>(20).fill(false);
  private wasMoving = false;
  private sprintLatched = false;
  private slotIdx = 0;
  private useLatchedAction: 'use' | 'reload' | null = null;
  private hasTarget = false;

  constructor(
    private readonly input: InputManager,
    private readonly settings: Settings,
    private readonly events: EventBus<GameEvents>,
    private readonly hooks: GamepadHooks,
  ) {
    this.events.on('ui:target', ({ target }) => {
      this.hasTarget = target;
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
      this.syncConnection(e.gamepad, true);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.padIndex === e.gamepad.index) {
        this.padIndex = null;
        this.releaseAllHeld();
        this.syncConnection(null, true);
      }
    });
  }

  private findActivePad(): Gamepad | null {
    const pads = navigator.getGamepads?.();
    if (!pads) return null;
    if (this.padIndex !== null) {
      const p = pads[this.padIndex];
      if (p && p.connected) return p;
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        this.padIndex = p.index;
        return p;
      }
    }
    return null;
  }

  private syncConnection(pad: Gamepad | null, notify: boolean): void {
    const isConn = !!pad;
    const label = pad ? pad.id.replace(/\s*\(STANDARD GAMEPAD.*?\)/i, '').trim() : '';
    if (isConn === this.connected && label === this.name) return;
    this.connected = isConn;
    this.name = label;
    this.events.emit('gamepad:changed', { connected: isConn, name: label });
    if (notify) {
      this.hooks.toast(
        isConn
          ? tr(`Геймпад подключён: ${label || 'Контроллер'}`, `Gamepad connected: ${label || 'Controller'}`)
          : tr('Геймпад отключён', 'Gamepad disconnected'),
      );
    }
  }

  private releaseAllHeld(): void {
    if (this.wasMoving) {
      this.input.setMove(0, 0);
      this.wasMoving = false;
    }
    if (this.sprintLatched) {
      this.input.release('sprint');
      this.sprintLatched = false;
    }
    if (this.useLatchedAction) {
      this.input.release(this.useLatchedAction);
      this.useLatchedAction = null;
    }
    const clear: Action[] = ['attack', 'aim', 'jump', 'crouch', 'flashlight', 'item2', 'map', 'fireMode', 'inventory', 'bash', 'slot1', 'slot2', 'slot3', 'slot4'];
    for (const a of clear) this.input.release(a);
    this.prev.fill(false);
  }

  /** Poll connected controller once per frame (safe even while paused so Start/B navigate menus). */
  update(dt: number): void {
    const pad = this.findActivePad();
    if (!pad) {
      if (this.connected) {
        this.releaseAllHeld();
        this.syncConnection(null, true);
      }
      return;
    }
    if (!this.connected) this.syncConnection(pad, false);

    const cfg = this.settings.data;
    if (!cfg.gamepadEnabled) {
      this.releaseAllHeld();
      return;
    }

    // Read raw buttons for edge/hold transitions.
    const startDown = btnDown(pad, 9);
    const startJustPressed = startDown && !this.prev[9];
    const bDown = btnDown(pad, 1);
    const bJustPressed = bDown && !this.prev[1];

    if (startJustPressed) {
      this.prev[9] = true;
      this.hooks.onMenuToggle();
    } else if (!startDown) {
      this.prev[9] = false;
    }

    const modal = this.hooks.isModalOpen();
    if (modal) {
      if (bJustPressed) this.hooks.onModalBack();
      // Keep prev synced while modal is open so closing doesn't fire a stale crouch/attack.
      for (let i = 0; i < Math.min(pad.buttons.length, this.prev.length); i++) {
        this.prev[i] = btnDown(pad, i);
      }
      if (this.wasMoving) {
        this.input.setMove(0, 0);
        this.wasMoving = false;
      }
      return;
    }

    const dz = cfg.gamepadDeadzone;
    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    const rx = pad.axes.length > 3 ? pad.axes[2] : (pad.axes[3] ?? 0);
    const ry = pad.axes.length > 3 ? pad.axes[3] : (pad.axes[4] ?? 0);

    // Check if user is actively giving controller input while PC PlayOverlay is up.
    if (!this.input.active) {
      const stickActive = Math.hypot(lx, ly) > dz || Math.hypot(rx, ry) > dz;
      let anyBtn = false;
      for (let i = 0; i < Math.min(pad.buttons.length, 16); i++) {
        if (i !== 9 && btnDown(pad, i)) {
          anyBtn = true;
          break;
        }
      }
      if (stickActive || anyBtn) this.hooks.onActivate();
      else {
        for (let i = 0; i < Math.min(pad.buttons.length, this.prev.length); i++) this.prev[i] = btnDown(pad, i);
        return;
      }
    }

    // Left stick: movement (analog, radial deadzone). Never fight WASD/Touch when idle.
    const lMag = Math.hypot(lx, ly);
    if (lMag > dz) {
      const scaled = Math.min(1, (lMag - dz) / Math.max(0.05, 1 - dz));
      const nx = (lx / lMag) * scaled;
      const ny = (-ly / lMag) * scaled;
      this.input.setMove(nx, ny);
      this.wasMoving = true;
    } else if (this.wasMoving) {
      this.input.setMove(0, 0);
      this.wasMoving = false;
      if (this.sprintLatched) {
        this.input.release('sprint');
        this.sprintLatched = false;
      }
    }

    // L3 (btn 10): latch sprint while moving forward.
    const l3 = btnDown(pad, 10);
    if (l3 && !this.prev[10]) {
      this.sprintLatched = !this.sprintLatched;
      if (this.sprintLatched) this.input.press('sprint');
      else this.input.release('sprint');
    } else if (this.sprintLatched && -ly <= 0.25) {
      this.sprintLatched = false;
      this.input.release('sprint');
    }
    this.prev[10] = l3;

    // Right stick: camera look (radial deadzone + quadratic acceleration).
    const rMag = Math.hypot(rx, ry);
    const clampedDt = Math.min(0.05, Math.max(0, dt));
    if (rMag > dz && clampedDt > 0) {
      const t = Math.min(1, (rMag - dz) / Math.max(0.05, 1 - dz));
      const curve = t * t * 0.7 + t * 0.3;
      const aiming = btnDown(pad, 6);
      const adsMul = aiming ? cfg.gamepadAdsScale : 1;
      const rate = 2.6 * clampedDt * adsMul;
      const dx = (rx / rMag) * curve * rate * cfg.gamepadSensX;
      const dy = (ry / rMag) * curve * rate * cfg.gamepadSensY * (cfg.gamepadInvertY ? -1 : 1);
      this.input.addLook(dx, dy);
    }

    // Continuous hold actions: RT -> attack, LT -> aim, A -> jump, R3 -> bash
    this.syncHold(7, 'attack', pad);
    this.syncHold(6, 'aim', pad);
    this.syncHold(0, 'jump', pad);
    this.syncHold(1, 'crouch', pad);
    this.syncHold(11, 'bash', pad);

    // Contextual X (btn 2): 'use' when crosshair is on container/door, else 'reload'
    const xDown = btnDown(pad, 2);
    if (xDown && !this.prev[2]) {
      this.useLatchedAction = this.hasTarget ? 'use' : 'reload';
      this.input.press(this.useLatchedAction);
    } else if (!xDown && this.prev[2] && this.useLatchedAction) {
      this.input.release(this.useLatchedAction);
      this.useLatchedAction = null;
    }
    this.prev[2] = xDown;

    // Quickslots: RB (5) next, LB (4) prev, Y (3) next
    const rb = btnDown(pad, 5);
    if (rb && !this.prev[5]) this.pulseSlot((this.slotIdx + 1) % 4);
    this.prev[5] = rb;

    const lb = btnDown(pad, 4);
    if (lb && !this.prev[4]) this.pulseSlot((this.slotIdx + 3) % 4);
    this.prev[4] = lb;

    const yBtn = btnDown(pad, 3);
    if (yBtn && !this.prev[3]) this.pulseSlot((this.slotIdx + 1) % 4);
    this.prev[3] = yBtn;

    // D-Pad + Select/Back
    this.syncTap(12, 'flashlight', pad);
    this.syncTap(13, 'item2', pad);
    this.syncTap(14, 'map', pad);
    this.syncTap(15, 'fireMode', pad);
    this.syncTap(8, 'inventory', pad);
  }

  private syncHold(btnIdx: number, action: Action, pad: Gamepad): void {
    const down = btnDown(pad, btnIdx);
    if (down && !this.prev[btnIdx]) this.input.press(action);
    else if (!down && this.prev[btnIdx]) this.input.release(action);
    this.prev[btnIdx] = down;
  }

  private syncTap(btnIdx: number, action: Action, pad: Gamepad): void {
    const down = btnDown(pad, btnIdx);
    if (down && !this.prev[btnIdx]) {
      this.input.press(action);
      this.input.release(action);
    }
    this.prev[btnIdx] = down;
  }

  private pulseSlot(idx: number): void {
    this.slotIdx = idx;
    const action = SLOT_ACTIONS[idx];
    this.input.press(action);
    this.input.release(action);
  }

  rumble(strong = 0.5, weak = 0.3, durationMs = 90): void {
    if (!this.settings.data.gamepadEnabled || !this.settings.data.gamepadVibration) return;
    const pad = this.findActivePad();
    const act = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, opts: Record<string, number>) => Promise<unknown> } }) | null)
      ?.vibrationActuator;
    if (!act?.playEffect) return;
    void act
      .playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(20, Math.min(1000, durationMs)),
        weakMagnitude: Math.max(0, Math.min(1, weak)),
        strongMagnitude: Math.max(0, Math.min(1, strong)),
      })
      .catch(() => {});
  }
}
