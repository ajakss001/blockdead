export type Lang = 'ru' | 'en';

const STORAGE_KEY = 'blockdead.lang';

function detectInitialLang(): Lang {
  if (typeof location !== 'undefined') {
    try {
      const q = new URLSearchParams(location.search).get('lang')?.toLowerCase();
      if (q === 'en' || q === 'ru') return q;
    } catch {
      /* ignore */
    }
  }
  if (typeof localStorage !== 'undefined') {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'ru') return saved;
    } catch {
      /* ignore */
    }
  }
  return 'ru';
}

let currentLang: Lang = detectInitialLang();

const dataLocalizers: Array<(lang: Lang) => void> = [];
const uiListeners = new Set<(lang: Lang) => void>();

function syncDocumentLang(): void {
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = currentLang;
    document.documentElement.setAttribute('translate', 'no');
  }
}

syncDocumentLang();

export function getLang(): Lang {
  return currentLang;
}

export function tr<T = string>(ru: T, en: T): T {
  return currentLang === 'en' ? en : ru;
}

/**
 * Registers a data-table localizer that runs immediately and before any UI listener
 * whenever the language changes.
 */
export function registerDataLocalizer(fn: (lang: Lang) => void): void {
  dataLocalizers.push(fn);
  fn(currentLang);
}

/**
 * Subscribes a UI callback that runs after all data tables have been updated.
 */
export function onLangChange(fn: (lang: Lang) => void): () => void {
  uiListeners.add(fn);
  return () => uiListeners.delete(fn);
}

export function setLang(lang: Lang): void {
  const next: Lang = lang === 'en' ? 'en' : 'ru';
  if (next === currentLang) return;
  currentLang = next;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, currentLang);
    } catch {
      /* ignore */
    }
  }
  syncDocumentLang();
  for (const fn of dataLocalizers) fn(currentLang);
  for (const fn of uiListeners) fn(currentLang);
}

export function toggleLang(): void {
  setLang(currentLang === 'ru' ? 'en' : 'ru');
}

/**
 * Reusable RU / EN tumbler switch. Stops click/pointerdown propagation so it can sit inside
 * PlayOverlay or headers without triggering pointer lock.
 */
export function langToggle(cls = ''): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `lang-toggle ${cls}`.trim();
  wrap.setAttribute('translate', 'no');

  const ruBtn = document.createElement('button');
  ruBtn.type = 'button';
  ruBtn.className = 'lang-toggle__btn';
  ruBtn.textContent = 'RU';

  const enBtn = document.createElement('button');
  enBtn.type = 'button';
  enBtn.className = 'lang-toggle__btn';
  enBtn.textContent = 'EN';

  const sync = () => {
    const isEn = currentLang === 'en';
    ruBtn.classList.toggle('on', !isEn);
    enBtn.classList.toggle('on', isEn);
    ruBtn.setAttribute('aria-pressed', String(!isEn));
    enBtn.setAttribute('aria-pressed', String(isEn));
    wrap.title = isEn ? 'Language: English (switch to Russian)' : 'Язык: Русский (переключить на английский)';
  };

  ruBtn.addEventListener('click', () => setLang('ru'));
  enBtn.addEventListener('click', () => setLang('en'));

  for (const e of ['click', 'pointerdown']) {
    wrap.addEventListener(e, (ev) => ev.stopPropagation());
  }

  sync();
  onLangChange(sync);

  wrap.append(ruBtn, enBtn);
  return wrap;
}
