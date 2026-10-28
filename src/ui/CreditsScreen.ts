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
  const models = section('Модели', MODEL_CREDITS, 'Загрузка…');
  box.append(models);
  // Authors of the installed models come with the model library (public/models/models.json).
  void fetch(`${import.meta.env.BASE_URL}models/models.json`)
    .then((r) => (r.ok ? r.json() : { models: [] }))
    .catch(() => ({ models: [] }))
    .then((j: { models: { title: string; author: string; license: string; url: string }[] }) => {
      const seen = new Map<string, Credit>();
      for (const m of j.models) if (!seen.has(m.url)) seen.set(m.url, { what: 'Модель', title: m.title, author: m.author, license: m.license === 'CC0-1.0' ? 'CC0' : 'CC BY 4.0', url: m.url, changes: 'упрощена, текстуры уменьшены' });
      models.replaceWith(section('Модели', [...MODEL_CREDITS, ...seen.values()], 'Сторонних моделей пока нет.'));
    });
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
