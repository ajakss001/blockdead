import type { GameContext } from '../GameContext';
import type { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { openCredits } from './CreditsScreen';
import { volumeControl } from './VolumeControl';

const CONTROLS: [string, string][] = [
  ['WASD', 'движение'],
  ['Shift', 'бег'],
  ['C', 'присесть'],
  ['ЛКМ', 'атака'],
  ['F', 'фонарик'],
  ['E', 'обыскать / дверь'],
  ['Tab / I', 'инвентарь'],
  ['1 / 2', 'оружие / убрать'],
  ['Esc', 'пауза'],
];

/** After a window closes, how long the browser gets to hand the pointer lock back before we hint. */
const RELOCK_GRACE_MS = 450;

/**
 * PC only. Two ways to be without the pointer lock:
 * - the player left the game (Esc, alt-tab): full "click to play" screen, simulation soft-paused;
 * - a game window (inventory, container) just closed and the browser did not give the lock back
 *   (it refuses after Esc, and needs a moment otherwise): no screen and no pause — a quiet
 *   "click to continue" line, the keyboard keeps working, a click restores mouse look.
 */
export class PlayOverlay {
  private readonly root = document.createElement('div');
  private readonly hint = document.createElement('div');
  private readonly soft = document.createElement('div');
  private modal = false;
  /** Lock was released by a game window, not by the player. */
  private released = false;
  private graceTimer = 0;

  constructor(
    private readonly ctx: GameContext,
    private readonly kbm: KeyboardMouseInput,
    parent: HTMLElement,
  ) {
    this.root.className = 'play-overlay';
    const title = document.createElement('div');
    title.className = 'play-overlay__title';
    title.textContent = 'Нажмите, чтобы играть';
    const list = document.createElement('div');
    list.className = 'play-overlay__controls';
    for (const [key, what] of CONTROLS) {
      const k = document.createElement('kbd');
      k.textContent = key;
      const span = document.createElement('span');
      span.textContent = what;
      list.append(k, span);
    }
    this.hint.className = 'play-overlay__hint';
    const credits = document.createElement('button');
    credits.className = 'credits-link';
    credits.textContent = 'Авторы';
    credits.addEventListener('click', (e) => {
      e.stopPropagation();
      openCredits(parent);
    });
    this.root.append(title, list, this.hint, volumeControl(), credits);
    this.soft.className = 'soft-hint';
    this.soft.textContent = 'Кликните, чтобы продолжить';
    this.soft.hidden = true;
    parent.append(this.root, this.soft);

    this.root.addEventListener('click', () => {
      this.hint.textContent = '';
      void kbm.requestLock();
    });
    // In the quiet state any click on the game picks the mouse back up.
    kbm.canvas.addEventListener('click', () => {
      if (!this.soft.hidden) void kbm.requestLock();
    });
    document.addEventListener('pointerlockerror', () => {
      // Chrome refuses to re-lock for ~1 s after Esc.
      if (!this.root.hidden) this.hint.textContent = 'Подождите секунду и нажмите ещё раз';
      if (this.released && !this.modal) this.showSoft();
    });

    ctx.events.on('input:active', ({ active }) => {
      if (active) this.released = false;
      this.sync();
    });
    // Game windows release the lock on purpose: never the full screen over them or right after them.
    ctx.events.on('ui:modal', ({ open }) => {
      this.modal = open;
      if (open) {
        this.released = true;
        window.clearTimeout(this.graceTimer);
      } else {
        this.graceTimer = window.setTimeout(() => {
          if (!this.ctx.input.active && !this.modal) this.showSoft();
        }, RELOCK_GRACE_MS);
      }
      this.sync();
    });
    this.sync();
  }

  private showSoft(): void {
    this.soft.hidden = false;
    this.kbm.keysWithoutLock = true;
  }

  private sync(): void {
    const active = this.ctx.input.active;
    if (active || this.modal) {
      this.soft.hidden = true;
      this.kbm.keysWithoutLock = false;
    }
    // The full screen only when the player let go of the game themselves.
    const full = !active && !this.modal && !this.released;
    this.root.hidden = !full;
    if (full) this.ctx.loop.pause('menu');
    else this.ctx.loop.resume('menu');
  }
}

export function mountCrosshair(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'crosshair';
  parent.append(el);
}
