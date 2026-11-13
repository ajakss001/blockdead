import { sfx } from '../audio/Sound';
import { onLangChange, tr } from '../core/i18n';

/** "Громкость" slider bound to the master volume (saved). Clicks stay inside (the pause screen grabs the mouse). */
export function volumeControl(cls = ''): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = `volume ${cls}`.trim();
  const text = document.createElement('span');
  const sync = () => {
    text.textContent = tr('Громкость', 'Volume');
  };
  sync();
  onLangChange(sync);
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.value = String(Math.round(sfx.level * 100));
  range.addEventListener('input', () => sfx.setVolume(Number(range.value) / 100));
  for (const e of ['click', 'pointerdown']) wrap.addEventListener(e, (ev) => ev.stopPropagation());
  wrap.append(text, range);
  return wrap;
}
