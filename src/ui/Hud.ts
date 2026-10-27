export type MoodleId = 'hunger' | 'thirst' | 'tired' | 'anxiety' | 'bleeding' | 'pain';
/** 0 = hidden, 1..3 = severity. */
export type MoodleLevel = 0 | 1 | 2 | 3;

/** Muted, dirty palette: nothing on screen should look like a mobile game button. */
const MOODLES: Record<MoodleId, { label: string; color: string }> = {
  hunger: { label: 'Голод', color: '#9a8442' },
  thirst: { label: 'Жажда', color: '#6f7f86' },
  tired: { label: 'Усталость', color: '#7a7468' },
  anxiety: { label: 'Тревога', color: '#94704e' },
  bleeding: { label: 'Кровотечение', color: '#8a2420' },
  pain: { label: 'Боль', color: '#7c3a30' },
};

/**
 * Zomboid-style minimal HUD: plain-text state indicators in the corner that appear only when
 * something is wrong, and a thin timed-action bar under the crosshair. Pure DOM, no per-frame
 * layout: updates only touch textContent / opacity / transform.
 */
export class Hud {
  private readonly moodles = document.createElement('div');
  private readonly rows = new Map<MoodleId, HTMLDivElement>();
  private readonly levels = new Map<MoodleId, MoodleLevel>();
  private readonly action = document.createElement('div');
  private readonly actionLabel = document.createElement('div');
  private readonly actionFill = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private toastTimer = 0;

  constructor(parent: HTMLElement) {
    this.moodles.className = 'moodles';
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
    parent.append(this.moodles, this.action, this.prompt);
  }

  setMoodle(id: MoodleId, level: MoodleLevel): void {
    if (this.levels.get(id) === level) return;
    this.levels.set(id, level);
    let row = this.rows.get(id);
    if (level === 0) {
      row?.remove();
      this.rows.delete(id);
      return;
    }
    if (!row) {
      row = document.createElement('div');
      row.className = 'moodle';
      row.style.color = MOODLES[id].color;
      this.rows.set(id, row);
      this.moodles.append(row);
    }
    row.textContent = `${MOODLES[id].label} ${'▪'.repeat(level)}`;
    row.style.opacity = String(0.55 + level * 0.15);
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
