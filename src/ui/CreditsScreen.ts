import { type Credit, LIBRARY_CREDITS, MODEL_CREDITS } from '../data/credits';

/**
 * "Авторы": who made the third-party models (CC BY needs it) and the libraries. Links are shown as
 * text, not clickable: game platforms forbid leading players out of the game.
 */
export function openCredits(parent: HTMLElement): void {
  const root = el('div', 'credits');
  const box = el('div', 'credits__box');
  box.append(el('div', 'credits__title', 'Авторы'));
  box.append(el('p', 'credits__note', 'BlockDead: мир, персонажи и звуки созданы процедурно для этой игры.'));
  box.append(section('Модели', MODEL_CREDITS, 'Сторонних моделей пока нет.'));
  box.append(section('Библиотеки', LIBRARY_CREDITS, ''));
  const close = el('button', 'credits__close', 'Закрыть');
  box.append(close);
  root.append(box);
  // The pause screen under it grabs the mouse on click: keep clicks here.
  const done = (e: Event) => {
    e.stopPropagation();
    root.remove();
  };
  close.addEventListener('click', done);
  root.addEventListener('click', (e) => {
    e.stopPropagation();
    if (e.target === root) done(e);
  });
  parent.append(root);
}

function section(title: string, list: readonly Credit[], empty: string): HTMLElement {
  const s = el('div', 'credits__section');
  s.append(el('div', 'credits__head', title));
  if (list.length === 0) s.append(el('div', 'credits__empty', empty));
  for (const c of list) {
    const row = el('div', 'credits__row');
    row.append(el('div', 'credits__what', `${c.what}: «${c.title}»`));
    row.append(el('div', 'credits__by', `${c.author} · ${c.license}${c.changes ? ` · ${c.changes}` : ''}`));
    row.append(el('div', 'credits__url', c.url));
    s.append(row);
  }
  return s;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
