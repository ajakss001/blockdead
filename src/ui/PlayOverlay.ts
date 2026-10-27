import type { GameContext } from '../GameContext';
import type { KeyboardMouseInput } from '../input/KeyboardMouseInput';

const CONTROLS: [string, string][] = [
  ['WASD', 'движение'],
  ['Shift', 'бег'],
  ['C', 'присесть'],
  ['ЛКМ', 'атака'],
  ['F', 'фонарик'],
  ['1 / 2', 'нож / кулаки'],
  ['Esc', 'пауза'],
];

/**
 * PC only: "click to play" screen that requests pointer lock. Shown whenever the lock is lost
 * (Esc, alt-tab) — the simulation is soft-paused meanwhile, rendering continues behind it.
 */
export class PlayOverlay {
  private readonly root = document.createElement('div');
  private readonly hint = document.createElement('div');

  constructor(ctx: GameContext, kbm: KeyboardMouseInput, parent: HTMLElement) {
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
    this.root.append(title, list, this.hint);
    parent.append(this.root);

    this.root.addEventListener('click', () => {
      this.hint.textContent = '';
      void kbm.requestLock();
    });
    // Chrome refuses to re-lock for ~1 s after Esc.
    document.addEventListener('pointerlockerror', () => {
      this.hint.textContent = 'Подождите секунду и нажмите ещё раз';
    });

    ctx.events.on('input:active', ({ active }) => this.sync(ctx, active));
    this.sync(ctx, ctx.input.active);
  }

  private sync(ctx: GameContext, active: boolean): void {
    this.root.hidden = active;
    if (active) ctx.loop.resume('menu');
    else ctx.loop.pause('menu');
  }
}

export function mountCrosshair(parent: HTMLElement): void {
  const el = document.createElement('div');
  el.className = 'crosshair';
  parent.append(el);
}
