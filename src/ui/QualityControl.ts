import { onLangChange, tr } from '../core/i18n';
import type { GameContext } from '../GameContext';
import type { QualityLevel } from '../core/types';

const LEVELS: readonly { id: QualityLevel; ru: string; en: string }[] = [
  { id: 'low', ru: 'Низк.', en: 'Low' },
  { id: 'medium', ru: 'Сред.', en: 'Med' },
  { id: 'high', ru: 'Выс.', en: 'High' },
];

/** Graphics preset selector (Low / Medium / High) mounted in the pause overlay and inventory header. */
export function qualityControl(ctx: GameContext, className = ''): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = className ? `quality ${className}` : 'quality';
  const stop = (e: Event) => e.stopPropagation();
  wrap.addEventListener('pointerdown', stop);
  wrap.addEventListener('click', stop);

  const label = document.createElement('span');
  label.className = 'quality__label';
  wrap.append(label);

  const btns = LEVELS.map((lvl) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quality__btn';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ctx.settings.applyPresetDefaults(lvl.id);
      ctx.quality.setLevel(lvl.id);
    });
    wrap.append(btn);
    return { lvl, btn };
  });

  const syncState = () => {
    const cur = ctx.quality.preset.level;
    for (const { lvl, btn } of btns) {
      const active = lvl.id === cur;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  };

  const syncText = () => {
    label.textContent = tr('Графика', 'Graphics');
    for (const { lvl, btn } of btns) {
      btn.textContent = tr(lvl.ru, lvl.en);
    }
  };

  syncText();
  syncState();
  onLangChange(syncText);
  ctx.events.on('quality:changed', syncState);
  return wrap;
}
