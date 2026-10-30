import { type StatIcon, statIcon } from './pixelart';

/** Meters on the HUD; each is 0..1 where 1 = fine ("how much is left"). */
export type StatId = Exclude<StatIcon, 'wound'>;
/** 0 fine, 1 warning, 2 bad, 3 critical (blinks). */
export type Severity = 0 | 1 | 2 | 3;
/** Cold readings tint blue instead of amber. */
export type Tint = 'normal' | 'cold';

const STATS: { id: StatId; label: string }[] = [
  { id: 'health', label: 'Здоровье' },
  { id: 'hunger', label: 'Сытость' },
  { id: 'thirst', label: 'Вода' },
  { id: 'energy', label: 'Силы' },
  { id: 'warmth', label: 'Тепло тела' },
  { id: 'calm', label: 'Спокойствие' },
  { id: 'battery', label: 'Заряд фонаря' },
  { id: 'sick', label: 'Заражение' },
];

/** Muted lo-fi palette: severity reads by hue, nothing screams like a mobile-game button. */
const PALETTE: Record<Tint, readonly number[]> = {
  normal: [0xa3ab96, 0xc8a050, 0xc8783a, 0xd8602e],
  cold: [0xa3ab96, 0x86a4c0, 0x6a92c8, 0x5a84d8],
};
const DIM = 0x55574f;

interface StatView {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  img: HTMLImageElement;
  fillKey: number;
  colorKey: string;
}

/**
 * Zomboid-style HUD: a compact row of pixel-art indicators in the top-right corner (clear of the
 * phone buttons), filled from the bottom by how much is left and tinted by severity; critical ones
 * blink. Plus the thin timed-action bar under the crosshair, toasts and the context prompt.
 * Updates touch only style/src when a value actually changes.
 */
export class Hud {
  private readonly stats = document.createElement('div');
  private readonly views = new Map<StatId, StatView>();
  private readonly wound = document.createElement('img');
  private readonly action = document.createElement('div');
  private readonly actionLabel = document.createElement('div');
  private readonly actionFill = document.createElement('div');
  private readonly prompt = document.createElement('div');
  /** Stamina bar under the crosshair: shown while not full. */
  private readonly stamina = document.createElement('div');
  private readonly staminaFill = document.createElement('div');
  private staminaKey = -1;
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.stats.className = 'stats';
    for (const { id, label } of STATS) {
      const root = document.createElement('div');
      root.className = 'stat';
      root.title = label;
      const base = document.createElement('img');
      base.className = 'stat__img';
      base.src = statIcon(id, DIM);
      base.alt = '';
      const fill = document.createElement('div');
      fill.className = 'stat__fill';
      const img = document.createElement('img');
      img.className = 'stat__img';
      img.alt = label;
      fill.append(img);
      root.append(base, fill);
      this.stats.append(root);
      this.views.set(id, { root, fill, img, fillKey: -1, colorKey: '' });
      this.setStat(id, 1, 0);
    }
    this.wound.className = 'stat stat__img stat--wound';
    this.wound.src = statIcon('wound', PALETTE.normal[3]);
    this.wound.title = 'Рана — нужна перевязка';
    this.wound.hidden = true;
    this.stats.append(this.wound);

    this.action.className = 'action';
    this.action.hidden = true;
    this.actionLabel.className = 'action__label';
    const track = document.createElement('div');
    track.className = 'action__track';
    this.actionFill.className = 'action__fill';
    track.append(this.actionFill);
    this.action.append(this.actionLabel, track);
    this.prompt.className = 'prompt';
    this.prompt.hidden = true;
    this.stamina.className = 'stamina';
    this.staminaFill.className = 'stamina__fill';
    this.stamina.append(this.staminaFill);
    parent.append(this.stats, this.action, this.prompt, this.stamina);
  }

  /** Stamina 0..1 (call every step; DOM only changes when the value does). */
  setStamina(v: number): void {
    const key = Math.round(v * 100);
    if (key === this.staminaKey) return;
    this.staminaKey = key;
    this.staminaFill.style.width = `${key}%`;
    this.stamina.classList.toggle('full', key >= 100);
    this.stamina.classList.toggle('low', key < 25);
  }

  /** value: 0..1 how much is left; severity picks the color, 3 blinks. */
  setStat(id: StatId, value: number, severity: Severity, tint: Tint = 'normal'): void {
    const v = this.views.get(id)!;
    const fillKey = Math.round(Math.min(1, Math.max(0, value)) * 16);
    if (fillKey !== v.fillKey) {
      v.fillKey = fillKey;
      // Whole pixels of the 16-px icon, so the level reads as pixel art too.
      v.fill.style.height = `${(fillKey / 16) * 100}%`;
    }
    const colorKey = `${tint}${severity}`;
    if (colorKey !== v.colorKey) {
      v.colorKey = colorKey;
      v.img.src = statIcon(id, PALETTE[tint][severity]);
      v.root.classList.toggle('stat--warn', severity > 0);
      v.root.classList.toggle('stat--critical', severity === 3);
    }
  }

  setWound(on: boolean): void {
    if (this.wound.hidden === !on) return;
    this.wound.hidden = !on;
  }

  /** Context hint under the crosshair ("E — Обыскать: Холодильник"); null hides it. */
  setPrompt(text: string | null): void {
    if (text === null) {
      this.prompt.hidden = true;
      return;
    }
    if (this.prompt.textContent !== text) this.prompt.textContent = text;
    this.prompt.hidden = false;
  }

  /** Show / advance the timed-action bar. progress 0..1. */
  showAction(label: string, progress: number): void {
    window.clearTimeout(this.toastTimer);
    this.action.hidden = false;
    this.action.classList.remove('action--done');
    if (this.actionLabel.textContent !== label) this.actionLabel.textContent = label;
    this.actionFill.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
  }

  hideAction(): void {
    this.action.hidden = true;
  }

  /** Short result line in place of the bar ("Ничего полезного"), fades by itself. */
  toast(text: string, ms = 1400): void {
    this.actionLabel.textContent = text;
    this.action.classList.add('action--done');
    this.action.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.hideAction(), ms);
  }
}

/** Severity of a "how much is left" value: < 50% warn, < 25% bad, < 10% critical. */
export function severityOf(left: number): Severity {
  return left < 0.1 ? 3 : left < 0.25 ? 2 : left < 0.5 ? 1 : 0;
}
