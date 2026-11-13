import { onLangChange, tr } from '../core/i18n';
import { STAT_DIM_COLOR, type StatIcon, statIcon } from './pixelart';

/** Meters on the HUD; each is 0..1 where 1 = fine ("how much is left"). */
export type StatId = Exclude<StatIcon, 'wound'>;
/** 0 fine, 1 warning, 2 bad, 3 critical (blinks). */
export type Severity = 0 | 1 | 2 | 3;
/** Cold readings tint blue instead of amber. */
export type Tint = 'normal' | 'cold';

const STATS: { id: StatId; label: [string, string] }[] = [
  { id: 'health', label: ['Здоровье', 'Health'] },
  { id: 'hunger', label: ['Сытость', 'Satiety'] },
  { id: 'thirst', label: ['Вода', 'Hydration'] },
  { id: 'energy', label: ['Силы', 'Energy'] },
  { id: 'warmth', label: ['Тепло тела', 'Body warmth'] },
  { id: 'calm', label: ['Спокойствие', 'Calm'] },
  { id: 'battery', label: ['Заряд фонаря', 'Flashlight battery'] },
  { id: 'sick', label: ['Заражение', 'Infection'] },
];

/** Thematic colors per stat: full = rich natural color, depleting reveals gray underneath. */
const STAT_COLORS: Record<StatId, { normal: number; critical: number; cold?: number }> = {
  health: { normal: 0xd44038, critical: 0xf5382e },
  hunger: { normal: 0xd4964a, critical: 0xd8602e },
  thirst: { normal: 0x3e8ed0, critical: 0x56aaf5 },
  energy: { normal: 0x8e86d0, critical: 0xc8783a },
  warmth: { normal: 0xd6843c, critical: 0xd8602e, cold: 0x5ca4e8 },
  calm: { normal: 0x5eb068, critical: 0xd8602e },
  battery: { normal: 0xe0bc48, critical: 0xd8602e },
  sick: { normal: 0xaec640, critical: 0xd8602e },
};
const DIM = STAT_DIM_COLOR;

interface StatView {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  img: HTMLImageElement;
  ring: SVGCircleElement;
  fillKey: number;
  colorKey: string;
}

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

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
  private woundBadge!: HTMLDivElement;
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
      root.title = tr(label[0], label[1]);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 36 36');
      svg.setAttribute('class', 'stat__ring');
      const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      track.setAttribute('cx', '18');
      track.setAttribute('cy', '18');
      track.setAttribute('r', String(RING_R));
      track.setAttribute('class', 'stat__ring-track');
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', '18');
      ring.setAttribute('cy', '18');
      ring.setAttribute('r', String(RING_R));
      ring.setAttribute('class', 'stat__ring-fill');
      ring.style.strokeDasharray = `${RING_C.toFixed(2)}`;
      ring.style.strokeDashoffset = '0';
      svg.append(track, ring);

      const iconWrap = document.createElement('div');
      iconWrap.className = 'stat__icon';
      const base = document.createElement('img');
      base.className = 'stat__img';
      base.src = statIcon(id, DIM);
      base.alt = '';
      const fill = document.createElement('div');
      fill.className = 'stat__fill';
      const img = document.createElement('img');
      img.className = 'stat__img';
      img.alt = tr(label[0], label[1]);
      fill.append(img);
      iconWrap.append(base, fill);

      root.append(svg, iconWrap);
      this.stats.append(root);
      this.views.set(id, { root, fill, img, ring, fillKey: -1, colorKey: '' });
      this.setStat(id, 1, 0);
    }
    this.wound.className = 'stat__wound-img';
    const woundBadge = document.createElement('div');
    woundBadge.className = 'stat stat--wound';
    this.wound.src = statIcon('wound', 0xf0382e);
    this.wound.title = tr('Рана — нужна перевязка', 'Wound — needs bandage');
    woundBadge.hidden = true;
    woundBadge.append(this.wound);
    this.woundBadge = woundBadge;
    this.stats.append(woundBadge);
    onLangChange(() => {
      for (const { id, label } of STATS) {
        const v = this.views.get(id);
        if (v) {
          const text = tr(label[0], label[1]);
          v.root.title = text;
          v.img.alt = text;
        }
      }
      this.wound.title = tr('Рана — нужна перевязка', 'Wound — needs bandage');
    });

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

  /** value: 0..1 how much is left; AAA radial ring + bottom-up color fill over gray base. */
  setStat(id: StatId, value: number, severity: Severity, tint: Tint = 'normal'): void {
    const v = this.views.get(id)!;
    const clamped = Math.min(1, Math.max(0, value));
    if (id === 'sick') v.root.hidden = severity === 0 && clamped >= 0.99;
    const fillKey = Math.round(clamped * 24);
    if (fillKey !== v.fillKey) {
      v.fillKey = fillKey;
      // Whole pixels of the 24-px icon, so the level reads as crisp pixel art too.
      v.fill.style.height = `${(fillKey / 24) * 100}%`;
      v.ring.style.strokeDashoffset = (RING_C * (1 - clamped)).toFixed(2);
    }
    if (severity < 3) {
      v.root.style.opacity = (0.72 + 0.28 * clamped).toFixed(2);
    } else {
      v.root.style.opacity = '';
    }
    const colors = STAT_COLORS[id];
    const color = tint === 'cold' && colors.cold ? colors.cold : severity === 3 ? colors.critical : colors.normal;
    const colorKey = `${tint}${severity}:${color}`;
    if (colorKey !== v.colorKey) {
      v.colorKey = colorKey;
      v.img.src = statIcon(id, color);
      v.ring.style.stroke = `#${color.toString(16).padStart(6, '0')}`;
      v.root.classList.toggle('stat--warn', severity > 0);
      v.root.classList.toggle('stat--critical', severity === 3);
    }
  }

  setWound(on: boolean): void {
    if (this.woundBadge.hidden === !on) return;
    this.woundBadge.hidden = !on;
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
