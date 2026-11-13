import { langToggle, onLangChange, tr } from '../core/i18n';
import type { GameContext } from '../GameContext';
import type { KeyboardMouseInput } from '../input/KeyboardMouseInput';
import { openCredits } from './CreditsScreen';
import { volumeControl } from './VolumeControl';

const CONTROLS: readonly [[string, string], [string, string]][] = [
  [['WASD', 'WASD'], ['движение', 'move']],
  [['Shift', 'Shift'], ['бег', 'sprint']],
  [['C', 'C'], ['присесть', 'crouch']],
  [['ЛКМ', 'LMB'], ['атака', 'attack']],
  [['F', 'F'], ['фонарик', 'flashlight']],
  [['E', 'E'], ['обыскать / дверь', 'search / door']],
  [['Tab / I', 'Tab / I'], ['инвентарь', 'inventory']],
  [['M', 'M'], ['карта', 'map']],
  [['1–4 / H', '1–4 / H'], ['быстрые слоты / убрать', 'quickslots / holster']],
  [['ПКМ', 'RMB'], ['прицел', 'aim']],
  [['R / V', 'R / V'], ['перезарядка / осмотр', 'reload / inspect']],
  [['B / Q', 'B / Q'], ['режим огня / удар прикладом', 'fire mode / buttstroke']],
  [['Esc', 'Esc'], ['пауза', 'pause']],
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
  private busy = false;
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
    const list = document.createElement('div');
    list.className = 'play-overlay__controls';
    this.hint.className = 'play-overlay__hint';
    const credits = document.createElement('button');
    credits.className = 'credits-link';
    credits.addEventListener('click', (e) => {
      e.stopPropagation();
      openCredits(parent);
    });
    const syncText = () => {
      title.textContent = tr('Нажмите, чтобы играть', 'Click to play');
      list.replaceChildren();
      for (const [key, what] of CONTROLS) {
        const k = document.createElement('kbd');
        k.textContent = tr(key[0], key[1]);
        const span = document.createElement('span');
        span.textContent = tr(what[0], what[1]);
        list.append(k, span);
      }
      credits.textContent = tr('Авторы', 'Credits');
      this.soft.textContent = tr('Кликните, чтобы продолжить', 'Click to continue');
      if (this.hint.textContent) {
        this.hint.textContent = tr('Подождите секунду и нажмите ещё раз', 'Wait a second and click again');
      }
    };
    syncText();
    onLangChange(syncText);
    this.root.append(title, list, this.hint, volumeControl(), langToggle(), credits);
    this.soft.className = 'soft-hint';
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
      if (!this.root.hidden) this.hint.textContent = tr('Подождите секунду и нажмите ещё раз', 'Wait a second and click again');
      if (this.released && !this.modal) this.showSoft();
    });

    // A search holds the mouse: Esc then drops the lock (the browser eats the key). That is "stop
    // searching", not "leave the game" — the quiet hint, never the pause screen. The flag is cleared a
    // tick late, so a handler that already cancelled the search in the same event still counts as busy.
    ctx.events.on('ui:busy', ({ busy }) => {
      if (busy) this.busy = true;
      else window.setTimeout(() => (this.busy = false), 0);
    });
    ctx.events.on('input:active', ({ active }) => {
      if (active) this.released = false;
      else if (this.busy || this.modal) {
        this.released = true;
        this.showSoft();
      }
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
