import { sfx } from '../audio/Sound';
import { onLangChange, setLang, getLang, tr } from '../core/i18n';
import type {
  ColorblindMode,
  ColorblindTarget,
  CrosshairColor,
  CrosshairSize,
  DrawDistance,
  FoliageQuality,
  FpsCap,
  InteriorsLimit,
  Settings,
  ShadowQuality,
  WeatherDensity,
} from '../core/Settings';
import type { QualityLevel } from '../core/types';
import type { GameContext } from '../GameContext';
import { openCredits } from './CreditsScreen';

type TabId = 'graphics' | 'accessibility' | 'gamepad' | 'controls' | 'audio' | 'interface';

interface ChoiceOption<T extends string | number | boolean> {
  value: T;
  ru: string;
  en: string;
}

interface RowMeta {
  titleRu: string;
  titleEn: string;
  descRu: string;
  descEn: string;
  tipPerfRu?: string;
  tipPerfEn?: string;
  tipQualRu?: string;
  tipQualEn?: string;
  previewKind?: 'graphics' | 'colorblind' | 'gamepad' | 'crosshair';
}

const TABS: readonly { id: TabId; ru: string; en: string }[] = [
  { id: 'graphics', ru: 'ГРАФИКА', en: 'GRAPHICS' },
  { id: 'accessibility', ru: 'ДОСТУПНОСТЬ', en: 'ACCESSIBILITY' },
  { id: 'gamepad', ru: 'ГЕЙМПАД', en: 'CONTROLLER' },
  { id: 'controls', ru: 'УПРАВЛЕНИЕ', en: 'KEYBOARD & MOUSE' },
  { id: 'audio', ru: 'АУДИО', en: 'AUDIO' },
  { id: 'interface', ru: 'ИНТЕРФЕЙС', en: 'INTERFACE' },
];

/**
 * Full Call of Duty–style tabbed settings modal («ПАРАМЕТРЫ»):
 * Graphics quality & render parameters, Colorblindness & Accessibility filters with before/after preview,
 * Gamepad (PC + mobile clip-on controllers), Controls, Audio, Interface, and live VRAM meter.
 */
export class SettingsModal {
  private readonly root = document.createElement('div');
  private readonly titleEl = document.createElement('h1');
  private readonly subtitleEl = document.createElement('div');
  private readonly tabsEl = document.createElement('div');
  private readonly listEl = document.createElement('div');
  private readonly previewCard = document.createElement('div');
  private readonly infoTitle = document.createElement('h2');
  private readonly infoDesc = document.createElement('p');
  private readonly infoTips = document.createElement('div');
  private readonly vramLabel = document.createElement('div');
  private readonly vramFill = document.createElement('div');
  private readonly vramNumbers = document.createElement('div');
  private readonly backBtn = document.createElement('button');
  private readonly resetBtn = document.createElement('button');
  private readonly footerStatus = document.createElement('div');

  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private readonly rowSyncs: Array<() => void> = [];
  private activeTab: TabId = 'graphics';
  private activeMeta: RowMeta;
  private openState = false;
  private ctx!: GameContext;
  private getGamepadInfo: () => { connected: boolean; name: string } = () => ({ connected: false, name: '' });
  private isParentModalOpen: () => boolean = () => false;

  constructor(parent: HTMLElement) {
    this.activeMeta = {
      titleRu: 'ПРЕСЕТ ГРАФИКИ',
      titleEn: 'GRAPHICS PRESET',
      descRu: 'Общий профиль графики: автоматически настраивает тени, дальность прорисовки, листву, интерьеры и разрешение.',
      descEn: 'Overall graphics profile: configures shadows, draw distance, foliage, building interiors, and render scale.',
      tipPerfRu: 'Выберите «Низк.» для максимальной частоты кадров на слабых устройствах.',
      tipPerfEn: 'Select Low for maximum frame rate on entry-level GPUs and phones.',
      tipQualRu: 'Выберите «Выс.» для чётких теней фонарика, фар и полной детализации.',
      tipQualEn: 'Select High for crisp flashlight/headlight shadows and maximum detail.',
      previewKind: 'graphics',
    };

    this.root.className = 'settings-modal';
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => e.stopPropagation());

    const shell = document.createElement('div');
    shell.className = 'settings__shell';

    // Header + tabs
    const header = document.createElement('header');
    header.className = 'settings__header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'settings__title-row';
    this.titleEl.className = 'settings__title';
    this.subtitleEl.className = 'settings__subtitle';
    titleWrap.append(this.titleEl, this.subtitleEl);

    this.tabsEl.className = 'settings__tabs';
    for (const t of TABS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings__tab';
      btn.addEventListener('click', () => {
        this.activeTab = t.id;
        this.renderTab();
      });
      this.tabButtons.set(t.id, btn);
      this.tabsEl.append(btn);
    }
    header.append(titleWrap, this.tabsEl);

    // Body: Left scrollable list + Right preview/info & VRAM column
    const body = document.createElement('div');
    body.className = 'settings__body';
    this.listEl.className = 'settings__list';

    const side = document.createElement('aside');
    side.className = 'settings__side';
    this.infoTitle.className = 'settings__info-title';
    this.previewCard.className = 'settings__preview';
    this.infoDesc.className = 'settings__info-desc';
    this.infoTips.className = 'settings__info-tips';

    const vramBox = document.createElement('div');
    vramBox.className = 'settings__vram';
    const vramHead = document.createElement('div');
    vramHead.className = 'settings__vram-head';
    this.vramLabel.className = 'settings__vram-label';
    this.vramNumbers.className = 'settings__vram-numbers';
    vramHead.append(this.vramLabel, this.vramNumbers);
    const vramTrack = document.createElement('div');
    vramTrack.className = 'settings__vram-track';
    this.vramFill.className = 'settings__vram-fill';
    const vramMaxMark = document.createElement('div');
    vramMaxMark.className = 'settings__vram-max';
    vramTrack.append(this.vramFill, vramMaxMark);
    vramBox.append(vramHead, vramTrack);

    side.append(this.infoTitle, this.previewCard, this.infoDesc, this.infoTips, vramBox);
    body.append(this.listEl, side);

    // Footer
    const footer = document.createElement('footer');
    footer.className = 'settings__footer';
    const footerBtns = document.createElement('div');
    footerBtns.className = 'settings__footer-btns';

    this.backBtn.type = 'button';
    this.backBtn.className = 'settings__btn settings__btn--primary';
    this.backBtn.addEventListener('click', () => this.close(true));

    this.resetBtn.type = 'button';
    this.resetBtn.className = 'settings__btn';
    this.resetBtn.addEventListener('click', () => {
      this.ctx.settings.resetAll(this.ctx.quality.preset.level);
      this.syncAll();
    });

    footerBtns.append(this.backBtn, this.resetBtn);
    this.footerStatus.className = 'settings__footer-status';
    footer.append(footerBtns, this.footerStatus);

    shell.append(header, body, footer);
    this.root.append(shell);
    parent.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (this.openState && e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close(false);
      }
    });
    onLangChange(() => {
      if (this.ctx) this.renderAll();
    });
  }

  bind(ctx: GameContext, getGamepadInfo: () => { connected: boolean; name: string }, isParentModalOpen: () => boolean = () => false): void {
    this.ctx = ctx;
    this.getGamepadInfo = getGamepadInfo;
    this.isParentModalOpen = isParentModalOpen;
    ctx.events.on('settings:changed', () => this.syncAll());
    ctx.events.on('quality:changed', () => this.syncAll());
    ctx.events.on('gamepad:changed', () => this.syncAll());
    this.renderAll();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(tab?: TabId): void {
    if (tab) this.activeTab = tab;
    if (this.openState) {
      this.renderTab();
      return;
    }
    this.openState = true;
    this.root.hidden = false;
    this.ctx.loop.pause('settings');
    this.ctx.events.emit('ui:modal', { open: true });
    this.renderAll();
  }

  close(fromClick: boolean): void {
    if (!this.openState) return;
    this.openState = false;
    this.root.hidden = true;
    this.ctx.loop.resume('settings');
    if (this.isParentModalOpen()) return;
    this.ctx.events.emit('ui:modal', { open: false });
    if (fromClick) this.ctx.requestPointerLock();
  }

  toggle(): void {
    if (this.openState) this.close(false);
    else this.open();
  }

  private renderAll(): void {
    this.titleEl.textContent = tr('ПАРАМЕТРЫ', 'SETTINGS');
    this.subtitleEl.textContent = tr('КОНФИГУРАЦИЯ СИСТЕМЫ И УПРАВЛЕНИЯ', 'SYSTEM & INPUT CONFIGURATION');
    for (const t of TABS) {
      const btn = this.tabButtons.get(t.id);
      if (btn) btn.textContent = tr(t.ru, t.en);
    }
    this.backBtn.textContent = tr('‹ Назад', '‹ Back');
    this.resetBtn.textContent = tr('Сброс настроек', 'Reset Defaults');
    this.renderTab();
  }

  private renderTab(): void {
    for (const [id, btn] of this.tabButtons) {
      btn.classList.toggle('is-active', id === this.activeTab);
    }
    this.listEl.replaceChildren();
    this.rowSyncs.length = 0;

    const s: Settings = this.ctx.settings;
    if (this.activeTab === 'graphics') this.buildGraphicsTab(s);
    else if (this.activeTab === 'accessibility') this.buildAccessibilityTab(s);
    else if (this.activeTab === 'gamepad') this.buildGamepadTab(s);
    else if (this.activeTab === 'controls') this.buildControlsTab(s);
    else if (this.activeTab === 'audio') this.buildAudioTab();
    else this.buildInterfaceTab();

    this.syncAll();
  }

  private addGroup(ru: string, en: string): void {
    const h = document.createElement('div');
    h.className = 'settings__group';
    h.textContent = tr(ru, en);
    this.listEl.append(h);
  }

  private attachRowFocus(row: HTMLElement, meta: RowMeta): void {
    const activate = () => {
      this.activeMeta = meta;
      for (const el of this.listEl.querySelectorAll('.settings__row.is-selected')) el.classList.remove('is-selected');
      row.classList.add('is-selected');
      this.renderInfo();
    };
    row.addEventListener('pointerenter', activate);
    row.addEventListener('focusin', activate);
    row.addEventListener('click', activate);
    if (this.listEl.querySelectorAll('.settings__row').length === 0) {
      this.activeMeta = meta;
      row.classList.add('is-selected');
    }
  }

  private addStepper<T extends string | number | boolean>(
    label: [string, string],
    options: readonly ChoiceOption<T>[],
    get: () => T,
    set: (v: T) => void,
    meta: RowMeta,
  ): void {
    const row = document.createElement('div');
    row.className = 'settings__row';
    row.tabIndex = 0;
    this.attachRowFocus(row, meta);

    const lbl = document.createElement('span');
    lbl.className = 'settings__row-label';
    lbl.textContent = tr(label[0], label[1]);

    const ctrl = document.createElement('div');
    ctrl.className = 'settings__stepper';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'settings__step-btn';
    prevBtn.textContent = '‹';

    const valEl = document.createElement('span');
    valEl.className = 'settings__step-val';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'settings__step-btn';
    nextBtn.textContent = '›';

    const step = (dir: -1 | 1) => {
      const cur = get();
      const idx = Math.max(0, options.findIndex((o) => o.value === cur));
      const next = (idx + dir + options.length) % options.length;
      set(options[next].value);
    };
    prevBtn.addEventListener('click', () => step(-1));
    nextBtn.addEventListener('click', () => step(1));
    row.addEventListener('keydown', (e) => {
      if (e.code === 'ArrowLeft') step(-1);
      else if (e.code === 'ArrowRight') step(1);
    });

    const sync = () => {
      const cur = get();
      const found = options.find((o) => o.value === cur) ?? options[0];
      valEl.textContent = tr(found.ru, found.en);
    };
    this.rowSyncs.push(sync);

    ctrl.append(prevBtn, valEl, nextBtn);
    row.append(lbl, ctrl);
    this.listEl.append(row);
  }

  private addSlider(
    label: [string, string],
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    get: () => number,
    set: (v: number) => void,
    meta: RowMeta,
  ): void {
    const row = document.createElement('div');
    row.className = 'settings__row';
    row.tabIndex = 0;
    this.attachRowFocus(row, meta);

    const lbl = document.createElement('span');
    lbl.className = 'settings__row-label';
    lbl.textContent = tr(label[0], label[1]);

    const ctrl = document.createElement('div');
    ctrl.className = 'settings__slider-wrap';
    const valEl = document.createElement('span');
    valEl.className = 'settings__slider-val';

    const range = document.createElement('input');
    range.type = 'range';
    range.className = 'settings__slider';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.addEventListener('input', () => set(Number(range.value)));

    const sync = () => {
      const v = get();
      range.value = String(v);
      valEl.textContent = format(v);
    };
    this.rowSyncs.push(sync);

    ctrl.append(valEl, range);
    row.append(lbl, ctrl);
    this.listEl.append(row);
  }

  private addActionButton(label: [string, string], btnText: [string, string], onClick: () => void, meta: RowMeta): void {
    const row = document.createElement('div');
    row.className = 'settings__row';
    this.attachRowFocus(row, meta);
    const lbl = document.createElement('span');
    lbl.className = 'settings__row-label';
    lbl.textContent = tr(label[0], label[1]);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings__btn settings__btn--inline';
    btn.textContent = tr(btnText[0], btnText[1]);
    btn.addEventListener('click', onClick);
    row.append(lbl, btn);
    this.listEl.append(row);
  }

  private buildGraphicsTab(s: Settings): void {
    this.addGroup('ЭКРАН И КАМЕРА', 'DISPLAY & CAMERA');
    this.addStepper<QualityLevel>(
      ['Пресет графики', 'Graphics Preset'],
      [
        { value: 'low', ru: 'Низк.', en: 'Low' },
        { value: 'medium', ru: 'Сред.', en: 'Medium' },
        { value: 'high', ru: 'Выс.', en: 'High' },
      ],
      () => this.ctx.quality.preset.level,
      (lvl) => {
        this.ctx.settings.applyPresetDefaults(lvl);
        this.ctx.quality.setLevel(lvl);
      },
      {
        titleRu: 'ПРЕСЕТ ГРАФИКИ',
        titleEn: 'GRAPHICS PRESET',
        descRu: 'Базовый профиль рендера: переключает освещение мира, постобработку, MSAA и рекомендуемые значения параметров.',
        descEn: 'Base rendering tier: updates lighting, post-processing pipeline, and recommended option values.',
        tipPerfRu: 'Уменьшите пресет для стабильных 60 FPS на мобильных и встроенных GPU.',
        tipPerfEn: 'Lower the preset for smooth frame rates on mobile and integrated GPUs.',
        tipQualRu: 'Увеличьте до «Выс.» для постобработки 16F и теней высокой чёткости.',
        tipQualEn: 'Increase to High for full post-processing and sharp shadows.',
        previewKind: 'graphics',
      },
    );
    this.addSlider(
      ['Поле зрения (FOV)', 'Field of View (FOV)'],
      60,
      100,
      1,
      (v) => `${v}°`,
      () => s.data.fov,
      (v) => s.set('fov', v),
      {
        titleRu: 'ПОЛЕ ЗРЕНИЯ (FOV)',
        titleEn: 'FIELD OF VIEW (FOV)',
        descRu: 'Угол обзора камеры в градусах. Широкий обзор помогает заметить зомби и укрытия по бокам.',
        descEn: 'Camera viewing angle in degrees. Wider FOV increases peripheral awareness during combat.',
        tipPerfRu: 'Меньшее значение может немного повысить FPS за счёт меньшего числа объектов в кадре.',
        tipPerfEn: 'Lower values slightly improve FPS with fewer objects in view.',
        tipQualRu: '80–90° оптимально для перестрелок на широкоформатном экране.',
        tipQualEn: '80–90° works best for situational awareness on widescreen displays.',
        previewKind: 'graphics',
      },
    );
    this.addSlider(
      ['Разрешение визуализации', 'Render Resolution'],
      50,
      100,
      5,
      (v) => `${v}%`,
      () => s.data.renderScale,
      (v) => s.set('renderScale', v),
      {
        titleRu: 'РАЗРЕШЕНИЕ ВИЗУАЛИЗАЦИИ',
        titleEn: 'RENDER RESOLUTION',
        descRu: 'Масштаб внутреннего рендера 3D-сцены. Интерфейс (HUD) всегда остаётся в полном чётком разрешении.',
        descEn: 'Internal 3D scene rendering scale. HUD elements always stay sharp at native resolution.',
        tipPerfRu: 'Уменьшите значение (70–85%) для значительного прироста производительности GPU.',
        tipPerfEn: 'Decrease (70–85%) for major GPU performance gains.',
        tipQualRu: 'Увеличьте до 100% для максимально чёткой картинки без мыла.',
        tipQualEn: 'Set to 100% for crisp native sharpness.',
        previewKind: 'graphics',
      },
    );
    this.addStepper<FpsCap>(
      ['Ограничение FPS', 'Frame Rate Cap'],
      [
        { value: 30, ru: '30 FPS', en: '30 FPS' },
        { value: 60, ru: '60 FPS', en: '60 FPS' },
        { value: 120, ru: '120 FPS', en: '120 FPS' },
        { value: 0, ru: 'Без лимита', en: 'Unlimited' },
      ],
      () => s.data.fpsCap,
      (v) => s.set('fpsCap', v),
      {
        titleRu: 'ОГРАНИЧЕНИЕ ЧАСТОТЫ КАДРОВ',
        titleEn: 'FRAME RATE CAP',
        descRu: 'Лимит FPS снижает нагрев телефона и троттлинг видеокарты при длительной игре.',
        descEn: 'Caps maximum frame rate to prevent overheating and battery drain on phones or laptops.',
        tipPerfRu: '60 FPS — оптимальный баланс плавности и нагрева.',
        tipPerfEn: '60 FPS gives the best balance of smoothness and thermal stability.',
        previewKind: 'graphics',
      },
    );
    this.addStepper<boolean>(
      ['Адаптивное разрешение', 'Dynamic Resolution'],
      [
        { value: false, ru: 'Выкл.', en: 'Off' },
        { value: true, ru: 'Вкл.', en: 'On' },
      ],
      () => s.data.adaptiveRes,
      (v) => s.set('adaptiveRes', v),
      {
        titleRu: 'АДАПТИВНОЕ РАЗРЕШЕНИЕ',
        titleEn: 'DYNAMIC RESOLUTION',
        descRu: 'Автоматически снижает масштаб рендера в тяжёлых сценах, чтобы удерживать целевой FPS.',
        descEn: 'Automatically lowers render scale when GPU load spikes to hold target FPS.',
        previewKind: 'graphics',
      },
    );

    this.addGroup('ДЕТАЛИЗАЦИЯ, ТЕНИ И МИР', 'DETAILS, SHADOWS & WORLD');
    this.addStepper<ShadowQuality>(
      ['Качество теней', 'Shadow Quality'],
      [
        { value: 'off', ru: 'Выкл.', en: 'Off' },
        { value: 'medium', ru: 'Сред.', en: 'Medium' },
        { value: 'high', ru: 'Выс.', en: 'High' },
      ],
      () => s.data.shadows,
      (v) => s.set('shadows', v),
      {
        titleRu: 'КАЧЕСТВО ТЕНЕЙ',
        titleEn: 'SHADOW QUALITY',
        descRu: 'Управляет динамическими тенями от фонарика игрока и фар автомобилей (1024px на Сред., 2048px на Выс.).',
        descEn: 'Controls dynamic shadows from player flashlight and vehicle headlights.',
        tipPerfRu: '«Выкл.» или «Сред.» удваивает скорость кадра ночью при включённом фонарике.',
        tipPerfEn: 'Off or Medium significantly improves GPU speed with flashlight active at night.',
        tipQualRu: '«Выс.» включает чёткие тени от фонарика на дистанции до 32 м.',
        tipQualEn: 'High enables crisp flashlight shadows up to 32 m.',
        previewKind: 'graphics',
      },
    );
    this.addStepper<DrawDistance>(
      ['Дальность прорисовки', 'Draw Distance'],
      [
        { value: 'near', ru: 'Близк. (42 м)', en: 'Near (42 m)' },
        { value: 'medium', ru: 'Сред. (66 м)', en: 'Medium (66 m)' },
        { value: 'far', ru: 'Дальн. (115 м)', en: 'Far (115 m)' },
      ],
      () => s.data.drawDistance,
      (v) => s.set('drawDistance', v),
      {
        titleRu: 'ДАЛЬНОСТЬ ПРОРИСОВКИ',
        titleEn: 'DRAW DISTANCE',
        descRu: 'Дистанция тумана и радиус активных кварталов (3×3 или 5×5 чанков) вокруг игрока.',
        descEn: 'Fog horizon distance and active city block radius (3×3 or 5×5 chunks).',
        tipPerfRu: 'Уменьшите радиус для снижения числа треугольников и нагрузки на память.',
        tipPerfEn: 'Reduce distance to lower geometry count and VRAM usage.',
        previewKind: 'graphics',
      },
    );
    this.addStepper<FoliageQuality>(
      ['Растительность и трава', 'Foliage & Grass'],
      [
        { value: 'off', ru: 'Выкл.', en: 'Off' },
        { value: 'low', ru: 'Низк.', en: 'Low' },
        { value: 'medium', ru: 'Сред.', en: 'Medium' },
        { value: 'high', ru: 'Выс.', en: 'High' },
      ],
      () => s.data.foliageQuality,
      (v) => s.set('foliageQuality', v),
      {
        titleRu: 'РАСТИТЕЛЬНОСТЬ И ТРАВА',
        titleEn: 'FOLIAGE & GRASS',
        descRu: 'Плотность травы, листвы под ногами и детализация крон деревьев.',
        descEn: 'Ground grass density, fallen leaves, and tree foliage LOD detail.',
        tipPerfRu: '«Выкл.» или «Низк.» освобождает пиксельный шейдер от лишней альфа-отрисовки.',
        tipPerfEn: 'Off or Low reduces fragment overdraw on integrated GPUs.',
        previewKind: 'graphics',
      },
    );
    this.addStepper<InteriorsLimit>(
      ['Интерьеры зданий', 'Interior Streaming'],
      [
        { value: 2, ru: '2 здания', en: '2 buildings' },
        { value: 4, ru: '4 здания', en: '4 buildings' },
        { value: 6, ru: '6 зданий', en: '6 buildings' },
      ],
      () => s.data.interiorsLimit,
      (v) => s.set('interiorsLimit', v),
      {
        titleRu: 'ИНТЕРЬЕРЫ ЗДАНИЙ В ПАМЯТИ',
        titleEn: 'LOADED INTERIORS',
        descRu: 'Сколько ближайших многоэтажек одновременно прорисовываются внутри через окна на дистанции до 34 м.',
        descEn: 'How many nearby high-rise interiors stay furnished and visible through windows up to 34 m.',
        tipQualRu: '6 зданий позволяют видеть обстановку через витрины по всей улице при перестрелке.',
        tipQualEn: '6 buildings keep surrounding storefronts visible across the street during firefights.',
        previewKind: 'graphics',
      },
    );
    this.addStepper<boolean>(
      ['Цветокоррекция и зерно', 'Film Grade & Grain'],
      [
        { value: true, ru: 'Вкл.', en: 'On' },
        { value: false, ru: 'Выкл.', en: 'Off' },
      ],
      () => s.data.postFxGrade,
      (v) => s.set('postFxGrade', v),
      {
        titleRu: 'КИНЕМАТОГРАФИЧНАЯ ПОСТОБРАБОТКА',
        titleEn: 'FILM GRADE & GRAIN',
        descRu: 'Холодная цветокоррекция, плёночное зерно и мягкая виньетка (без перекомпиляции шейдеров).',
        descEn: 'Cold film LUT tint, subtle grain, and vignette (switches without shader compile).',
        previewKind: 'graphics',
      },
    );
    this.addStepper<WeatherDensity>(
      ['Плотность погоды', 'Weather Particles'],
      [
        { value: 'low', ru: 'Низк.', en: 'Low' },
        { value: 'high', ru: 'Выс.', en: 'High' },
      ],
      () => s.data.weatherDensity,
      (v) => s.set('weatherDensity', v),
      {
        titleRu: 'ПЛОТНОСТЬ СНЕГА И ДОЖДЯ',
        titleEn: 'WEATHER PARTICLE DENSITY',
        descRu: 'Количество капель дождя и снежинок в кадре.',
        descEn: 'Number of rain drops and snowflakes rendered around the player.',
        previewKind: 'graphics',
      },
    );
  }

  private buildAccessibilityTab(s: Settings): void {
    this.addGroup('ФИЛЬТРЫ ДЛЯ ДАЛЬТОНИКОВ (ЦВЕТОКОРРЕКЦИЯ)', 'COLORBLIND ACCESSIBILITY');
    this.addStepper<ColorblindMode>(
      ['Режим дальтонизма', 'Colorblind Mode'],
      [
        { value: 'off', ru: 'Выкл.', en: 'Off' },
        { value: 'protanopia', ru: 'Протанопия (красный)', en: 'Protanopia (Red)' },
        { value: 'deuteranopia', ru: 'Дейтеранопия (зелёный)', en: 'Deuteranopia (Green)' },
        { value: 'tritanopia', ru: 'Тританопия (синий)', en: 'Tritanopia (Blue)' },
        { value: 'achromatopsia', ru: 'Ахроматопсия (ч/б контраст)', en: 'Achromatopsia (Mono)' },
      ],
      () => s.data.colorblindMode,
      (v) => s.set('colorblindMode', v),
      {
        titleRu: 'ФИЛЬТР ДАЛЬТОНИЗМА',
        titleEn: 'COLORBLIND FILTER',
        descRu: 'Смещает проблемные оттенки в различимые диапазоны: индикаторы здоровья, угрозы, лут и силуэты врагов легче считываются мгновенно.',
        descEn: 'Shifts overlapping color channels into distinct luminance & hue ranges for clear target and HUD readability.',
        tipQualRu: 'Применяется мгновенно без единого фриза и потери FPS.',
        tipQualEn: 'Applies instantaneously with zero shader compilation stutters.',
        previewKind: 'colorblind',
      },
    );
    this.addSlider(
      ['Интенсивность фильтра', 'Filter Intensity'],
      50,
      100,
      5,
      (v) => `${v}%`,
      () => s.data.colorblindStrength,
      (v) => s.set('colorblindStrength', v),
      {
        titleRu: 'ИНТЕНСИВНОСТЬ ФИЛЬТРА',
        titleEn: 'FILTER INTENSITY',
        descRu: 'Сила компенсации цвета от мягкого смещения (50%) до полной коррекции (100%).',
        descEn: 'Strength of color compensation from subtle shift (50%) to full separation (100%).',
        previewKind: 'colorblind',
      },
    );
    this.addStepper<ColorblindTarget>(
      ['Область фильтра', 'Color Filter Target'],
      [
        { value: 'both', ru: 'Мир и интерфейс', en: 'World & HUD' },
        { value: 'world', ru: 'Только игровой мир', en: 'World Only' },
        { value: 'ui', ru: 'Только интерфейс', en: 'HUD Only' },
      ],
      () => s.data.colorblindTarget,
      (v) => s.set('colorblindTarget', v),
      {
        titleRu: 'ОБЛАСТЬ ПРИМЕНЕНИЯ ФИЛЬТРА',
        titleEn: 'FILTER TARGET',
        descRu: 'Выберите, применять ли цветокоррекцию ко всему экрану, только к 3D-миру или только к иконкам HUD и прицелу.',
        descEn: 'Choose whether to filter both 3D world and HUD, world only, or HUD indicators only.',
        previewKind: 'colorblind',
      },
    );

    this.addGroup('ЗРЕНИЕ, ПРИЦЕЛ И КОМФОРТ КАМЕРЫ', 'CROSSHAIR & COMFORT');
    this.addStepper<CrosshairColor>(
      ['Цвет прицела', 'Crosshair Color'],
      [
        { value: 'white', ru: 'Белый', en: 'White' },
        { value: 'yellow', ru: 'Жёлтый', en: 'Yellow' },
        { value: 'cyan', ru: 'Голубой', en: 'Cyan' },
        { value: 'magenta', ru: 'Пурпурный', en: 'Magenta' },
        { value: 'green', ru: 'Ярко-зелёный', en: 'Lime Green' },
      ],
      () => s.data.crosshairColor,
      (v) => s.set('crosshairColor', v),
      {
        titleRu: 'ЦВЕТ ПРИЦЕЛА',
        titleEn: 'CROSSHAIR COLOR',
        descRu: 'Высококонтрастный цвет центральной точки прицеливания — не теряется в темноте и тумане.',
        descEn: 'High-visibility crosshair dot color so aim point never blends into dark fog.',
        previewKind: 'crosshair',
      },
    );
    this.addStepper<CrosshairSize>(
      ['Размер прицела', 'Crosshair Size'],
      [
        { value: 'small', ru: 'Мелкий', en: 'Small' },
        { value: 'medium', ru: 'Средний', en: 'Medium' },
        { value: 'large', ru: 'Крупный', en: 'Large' },
      ],
      () => s.data.crosshairSize,
      (v) => s.set('crosshairSize', v),
      {
        titleRu: 'РАЗМЕР ПРИЦЕЛА',
        titleEn: 'CROSSHAIR SIZE',
        descRu: 'Увеличьте точку прицела для лучшей видимости при ослабленном зрении.',
        descEn: 'Increase reticle dot size for easier tracking on small or mobile displays.',
        previewKind: 'crosshair',
      },
    );
    this.addStepper<boolean>(
      ['Контрастный HUD', 'High-Contrast HUD'],
      [
        { value: false, ru: 'Выкл.', en: 'Off' },
        { value: true, ru: 'Вкл.', en: 'On' },
      ],
      () => s.data.highContrastHud,
      (v) => s.set('highContrastHud', v),
      {
        titleRu: 'ПОВЫШЕННЫЙ КОНТРАСТ ИНТЕРФЕЙСА',
        titleEn: 'HIGH-CONTRAST HUD',
        descRu: 'Добавляет тёмную контрастную подложку, контуры и чёткую обводку для шкал состояния, подсказок и текста заданий.',
        descEn: 'Adds dark backing panels and high-contrast borders around HUD meters, prompts, and objectives.',
        previewKind: 'colorblind',
      },
    );
    this.addSlider(
      ['Раскачка камеры', 'Camera Movement'],
      0,
      100,
      10,
      (v) => (v === 0 ? tr('Выкл. (0%)', 'Off (0%)') : `${v}%`),
      () => s.data.cameraBob,
      (v) => s.set('cameraBob', v),
      {
        titleRu: 'РАСКАЧКА КАМЕРЫ ПРИ ХОДЬБЕ',
        titleEn: 'CAMERA BOB / MOTION',
        descRu: 'Снизьте до 0–50% при укачивании (motion sickness): убирает покачивание головы при беге, приземлении и тряске.',
        descEn: 'Lower to 0–50% to reduce motion sickness from head-bobbing, landing dips, and camera shake.',
        tipQualRu: 'Рекомендуется «Выкл. (0%)» или 50% при чувствительности к движению камеры.',
        tipQualEn: 'Recommended Off (0%) or 50% if you experience motion discomfort.',
        previewKind: 'graphics',
      },
    );
  }

  private buildGamepadTab(s: Settings): void {
    const info = this.getGamepadInfo();
    this.addGroup(
      info.connected
        ? tr(`ПОДКЛЮЧЁН: ${info.name}`, `CONNECTED: ${info.name}`)
        : tr('ГЕЙМПАД (ПК И МОБИЛЬНЫЕ КОНТРОЛЛЕРЫ)', 'CONTROLLER (PC & MOBILE CLIP-ON)'),
      info.connected ? `CONNECTED: ${info.name}` : 'CONTROLLER (PC & MOBILE CLIP-ON)',
    );
    this.addStepper<boolean>(
      ['Использовать геймпад', 'Enable Gamepad'],
      [
        { value: true, ru: 'Вкл.', en: 'On' },
        { value: false, ru: 'Выкл.', en: 'Off' },
      ],
      () => s.data.gamepadEnabled,
      (v) => s.set('gamepadEnabled', v),
      {
        titleRu: 'ПОДДЕРЖКА ГЕЙМПАДА',
        titleEn: 'GAMEPAD SUPPORT',
        descRu: 'Поддерживаются геймпады ПК (Xbox, DualSense, Switch Pro) и мобильные накладные контроллеры для телефона (Backbone One, Razer Kishi, GameSir).',
        descEn: 'Supports PC controllers (Xbox, DualSense) and mobile clip-on controllers (Backbone One, Razer Kishi, GameSir).',
        previewKind: 'gamepad',
      },
    );
    this.addSlider(
      ['Чувствительность по X', 'Horizontal Sensitivity'],
      0.5,
      3.0,
      0.05,
      (v) => v.toFixed(2),
      () => s.data.gamepadSensX,
      (v) => s.set('gamepadSensX', v),
      {
        titleRu: 'ГОРИЗОНТАЛЬНАЯ ЧУВСТВИТЕЛЬНОСТЬ СТИКА',
        titleEn: 'STICK SENSITIVITY (HORIZONTAL)',
        descRu: 'Скорость поворота камеры правым стиком по горизонтали.',
        descEn: 'Horizontal camera turn speed for the right thumbstick.',
        previewKind: 'gamepad',
      },
    );
    this.addSlider(
      ['Чувствительность по Y', 'Vertical Sensitivity'],
      0.5,
      3.0,
      0.05,
      (v) => v.toFixed(2),
      () => s.data.gamepadSensY,
      (v) => s.set('gamepadSensY', v),
      {
        titleRu: 'ВЕРТИКАЛЬНАЯ ЧУВСТВИТЕЛЬНОСТЬ СТИКА',
        titleEn: 'STICK SENSITIVITY (VERTICAL)',
        descRu: 'Скорость наклона камеры вверх и вниз правым стиком.',
        descEn: 'Vertical look pitch speed for the right thumbstick.',
        previewKind: 'gamepad',
      },
    );
    this.addSlider(
      ['Множитель в прицеле (ADS)', 'ADS Sensitivity Scale'],
      0.3,
      1.0,
      0.05,
      (v) => `${Math.round(v * 100)}%`,
      () => s.data.gamepadAdsScale,
      (v) => s.set('gamepadAdsScale', v),
      {
        titleRu: 'ЧУВСТВИТЕЛЬНОСТЬ В ПРИЦЕЛЕ (LT)',
        titleEn: 'ADS SENSITIVITY MULTIPLIER',
        descRu: 'Снижает скорость правого стика при зажатии LT для точного выстрела в голову.',
        descEn: 'Reduces right stick speed while holding LT for accurate headshots.',
        previewKind: 'gamepad',
      },
    );
    this.addSlider(
      ['Мёртвая зона стиков', 'Stick Deadzone'],
      0.05,
      0.35,
      0.01,
      (v) => `${Math.round(v * 100)}%`,
      () => s.data.gamepadDeadzone,
      (v) => s.set('gamepadDeadzone', v),
      {
        titleRu: 'МЁРТВАЯ ЗОНА СТИКОВ',
        titleEn: 'ANALOG DEADZONE',
        descRu: 'Увеличьте, если камера или персонаж медленно смещаются сами при отпущенных стиках (дрифт стиков).',
        descEn: 'Increase if your character or camera drifts while thumbsticks are at rest.',
        previewKind: 'gamepad',
      },
    );
    this.addStepper<boolean>(
      ['Инверсия оси Y', 'Invert Look Y'],
      [
        { value: false, ru: 'Выкл.', en: 'Off' },
        { value: true, ru: 'Вкл.', en: 'On' },
      ],
      () => s.data.gamepadInvertY,
      (v) => s.set('gamepadInvertY', v),
      {
        titleRu: 'ИНВЕРСИЯ ВЕРТИКАЛЬНОЙ ОСИ',
        titleEn: 'INVERT Y-AXIS',
        descRu: 'Меняет направление взгляда вверх/вниз на правом стике.',
        descEn: 'Reverses up/down camera pitch on the right stick.',
        previewKind: 'gamepad',
      },
    );
    this.addStepper<boolean>(
      ['Вибрация контроллера', 'Controller Vibration'],
      [
        { value: true, ru: 'Вкл.', en: 'On' },
        { value: false, ru: 'Выкл.', en: 'Off' },
      ],
      () => s.data.gamepadVibration,
      (v) => s.set('gamepadVibration', v),
      {
        titleRu: 'ВИБРАЦИЯ (HAPTICS)',
        titleEn: 'CONTROLLER VIBRATION',
        descRu: 'Отдача при выстрелах, ударах и получении урона на поддерживаемых геймпадах.',
        descEn: 'Tactile rumble on shots, melee strikes, and damage.',
        previewKind: 'gamepad',
      },
    );
    this.addActionButton(
      ['Проверка отдачи', 'Test Vibration'],
      ['Проверить вибрацию', 'Test Rumble'],
      () => this.ctx.rumble(0.7, 0.5, 220),
      {
        titleRu: 'ТЕСТ ВИБРАЦИИ ГЕЙМПАДА',
        titleEn: 'TEST CONTROLLER RUMBLE',
        descRu: 'Посылает короткий тестовый импульс на подключённый контроллер.',
        descEn: 'Sends a short vibration pulse to verify connected gamepad haptics.',
        previewKind: 'gamepad',
      },
    );
    this.addStepper<boolean>(
      ['Скрывать сенсорный HUD', 'Auto-Hide Touch Controls'],
      [
        { value: true, ru: 'Вкл.', en: 'On' },
        { value: false, ru: 'Выкл.', en: 'Off' },
      ],
      () => s.data.gamepadHideTouch,
      (v) => s.set('gamepadHideTouch', v),
      {
        titleRu: 'МОБИЛЬНЫЕ ГЕЙМПАДЫ ДЛЯ ТЕЛЕФОНА',
        titleEn: 'MOBILE CLIP-ON CONTROLLERS',
        descRu: 'Когда телефон вставлен в геймпад (Backbone, Kishi, GameSir), скрывает экранный стик и кнопки, оставляя весь экран чистым.',
        descEn: 'Automatically hides on-screen stick and buttons when a phone controller is connected.',
        previewKind: 'gamepad',
      },
    );
  }

  private buildControlsTab(s: Settings): void {
    this.addGroup('МЫШЬ И КЛАВИАТУРА / СЕНСОРНЫЙ ЭКРАН', 'MOUSE, KEYBOARD & TOUCH');
    this.addSlider(
      ['Чувствительность мыши', 'Mouse Sensitivity'],
      0.3,
      3.0,
      0.05,
      (v) => v.toFixed(2),
      () => s.data.mouseSens,
      (v) => s.set('mouseSens', v),
      {
        titleRu: 'ЧУВСТВИТЕЛЬНОСТЬ МЫШИ',
        titleEn: 'MOUSE SENSITIVITY',
        descRu: 'Множитель скорости поворота камеры мышью.',
        descEn: 'Multiplier for mouse camera look speed.',
      },
    );
    this.addStepper<boolean>(
      ['Инверсия мыши (Y)', 'Invert Mouse Y'],
      [
        { value: false, ru: 'Выкл.', en: 'Off' },
        { value: true, ru: 'Вкл.', en: 'On' },
      ],
      () => s.data.mouseInvertY,
      (v) => s.set('mouseInvertY', v),
      {
        titleRu: 'ИНВЕРСИЯ МЫШИ ПО ВЕРТИКАЛИ',
        titleEn: 'INVERT MOUSE Y',
        descRu: 'Меняет направление взгляда вверх/вниз при движении мыши.',
        descEn: 'Reverses vertical camera movement for mouse look.',
      },
    );
    this.addSlider(
      ['Чувствительность сенсора', 'Touch Look Sensitivity'],
      0.3,
      3.0,
      0.05,
      (v) => v.toFixed(2),
      () => s.data.touchSens,
      (v) => s.set('touchSens', v),
      {
        titleRu: 'ЧУВСТВИТЕЛЬНОСТЬ СЕНСОРНОГО ОБЗОРА',
        titleEn: 'TOUCH LOOK SENSITIVITY',
        descRu: 'Скорость поворота камеры при проведении пальцем по правой части экрана телефона.',
        descEn: 'Touch drag camera speed on phones and tablets.',
      },
    );
  }

  private buildAudioTab(): void {
    this.addGroup('ЗВУК И АТМОСФЕРА', 'SOUND & MIX');
    this.addSlider(
      ['Общая громкость', 'Master Volume'],
      0,
      100,
      1,
      (v) => `${v}%`,
      () => Math.round(sfx.level * 100),
      (v) => {
        sfx.setVolume(v / 100);
        this.syncAll();
      },
      {
        titleRu: 'ОБЩАЯ ГРОМКОСТЬ',
        titleEn: 'MASTER VOLUME',
        descRu: 'Управляет громкостью шагов, выстрелов, стонов зомби и фоновой атмосферы.',
        descEn: 'Adjusts overall volume of footsteps, gunfire, zombie audio, and ambience.',
      },
    );
  }

  private buildInterfaceTab(): void {
    this.addGroup('ЯЗЫК И ОТОБРАЖЕНИЕ', 'LANGUAGE & DISPLAY');
    this.addStepper<'ru' | 'en'>(
      ['Язык интерфейса', 'Interface Language'],
      [
        { value: 'ru', ru: 'Русский', en: 'Russian' },
        { value: 'en', ru: 'English', en: 'English' },
      ],
      () => getLang(),
      (lang) => setLang(lang),
      {
        titleRu: 'ЯЗЫК ИГРЫ',
        titleEn: 'GAME LANGUAGE',
        descRu: 'Переключает все меню, задачи, предметы и подсказки между русским и английским.',
        descEn: 'Switches all menus, objectives, item names, and hints between Russian and English.',
      },
    );
    this.addActionButton(
      ['Авторы и лицензии', 'Credits & Licenses'],
      ['Открыть', 'Open'],
      () => openCredits(this.root.parentElement ?? document.body),
      {
        titleRu: 'АВТОРЫ',
        titleEn: 'CREDITS',
        descRu: 'Открывает список использованных 3D-моделей, звуков, библиотек и сведений об игре.',
        descEn: 'Opens the list of 3D models, audio assets, libraries, and game credits.',
      },
    );
  }

  private renderInfo(): void {
    const m = this.activeMeta;
    this.infoTitle.textContent = tr(m.titleRu, m.titleEn);
    this.infoDesc.textContent = tr(m.descRu, m.descEn);

    this.infoTips.replaceChildren();
    if (m.tipPerfRu && m.tipPerfEn) {
      const tip = document.createElement('div');
      tip.className = 'settings__tip';
      tip.textContent = tr(m.tipPerfRu, m.tipPerfEn);
      this.infoTips.append(tip);
    }
    if (m.tipQualRu && m.tipQualEn) {
      const tip = document.createElement('div');
      tip.className = 'settings__tip settings__tip--gold';
      tip.textContent = tr(m.tipQualRu, m.tipQualEn);
      this.infoTips.append(tip);
    }

    this.renderPreview(m.previewKind ?? (this.activeTab === 'accessibility' ? 'colorblind' : this.activeTab === 'gamepad' ? 'gamepad' : 'graphics'));
  }

  private renderPreview(kind: 'graphics' | 'colorblind' | 'gamepad' | 'crosshair'): void {
    const s = this.ctx.settings.data;
    if (kind === 'colorblind' || kind === 'crosshair') {
      const swatchRow = (filtered: boolean, title: string) => `
        <div class="settings__preview-pane ${filtered ? 'is-filtered' : ''}">
          <div class="settings__preview-badge">${title}</div>
          <div class="settings__preview-scene">
            <div class="settings__preview-sky"></div>
            <div class="settings__preview-building"></div>
            <div class="settings__preview-zombie"></div>
            <div class="settings__preview-crosshair"></div>
          </div>
          <div class="settings__cb-swatches">
            <span style="background:#d44038" title="HP / Alert"></span>
            <span style="background:#5eb068" title="Safe / Stamina"></span>
            <span style="background:#d4964a" title="Hunger / Warning"></span>
            <span style="background:#3e8ed0" title="Thirst / Cold"></span>
            <span style="background:#aec640" title="Infection"></span>
          </div>
        </div>
      `;
      this.previewCard.innerHTML = `<div class="settings__preview-split">${swatchRow(false, tr('ДО (ОРИГИНАЛ)', 'BEFORE'))}${swatchRow(true, tr('ПОСЛЕ (ФИЛЬТР)', 'AFTER'))}</div>`;
      return;
    }

    if (kind === 'gamepad') {
      const gp = this.getGamepadInfo();
      const binds = [
        ['L-Stick / Л. стик', tr('Движение', 'Move')],
        ['R-Stick / П. стик', tr('Камера', 'Look')],
        ['LT / RT', tr('Прицел / Огонь', 'Aim / Attack')],
        ['LB / RB', tr('Слоты 1–4', 'Quickslots')],
        ['A / B', tr('Прыжок / Присед (Назад)', 'Jump / Crouch (Back)')],
        ['X / Y', tr('Обыск · Перезарядка / Слот', 'Use · Reload / Next')],
        ['L3 / R3', tr('Бег / Удар прикладом', 'Sprint / Bash')],
        ['D-Pad ↑↓←→', tr('Фонарь / Убрать / Карта / Огонь', 'Light / Holster / Map / Mode')],
        ['Select / Start', tr('Рюкзак / Параметры', 'Inventory / Settings')],
      ];
      this.previewCard.innerHTML = `
        <div class="settings__gp-status ${gp.connected ? 'is-on' : ''}">
          ${
            gp.connected
              ? tr(`Подключён: ${gp.name || 'Стандартный геймпад'}`, `Connected: ${gp.name || 'Standard Controller'}`)
              : tr('Геймпад не обнаружен — подключите по USB/BT или вставьте телефон и нажмите любую кнопку', 'No controller active — connect via USB/BT or clip-on and press any button')
          }
        </div>
        <div class="settings__gp-grid">
          ${binds.map(([k, v]) => `<div class="settings__gp-k">${k}</div><div class="settings__gp-v">${v}</div>`).join('')}
        </div>
      `;
      return;
    }

    // Graphics comparison card (shows active parameters visually)
    const fovW = Math.round(((s.fov - 50) / 60) * 100);
    this.previewCard.innerHTML = `
      <div class="settings__preview-split">
        <div class="settings__preview-pane">
          <div class="settings__preview-badge">${tr('НИЗКАЯ НАГРУЗКА', 'LOW SPEC')}</div>
          <div class="settings__preview-scene is-low-preview">
            <div class="settings__preview-sky"></div>
            <div class="settings__preview-building"></div>
          </div>
          <div class="settings__preview-meta">${tr('Тени: Выкл • 75%', 'Shadows: Off • 75%')}</div>
        </div>
        <div class="settings__preview-pane">
          <div class="settings__preview-badge">${tr('ТЕКУЩИЕ НАСТРОЙКИ', 'CURRENT')}</div>
          <div class="settings__preview-scene ${s.shadows === 'off' ? 'is-low-preview' : ''}">
            <div class="settings__preview-sky"></div>
            <div class="settings__preview-building"></div>
            <div class="settings__preview-beam" style="opacity:${s.shadows === 'high' ? 0.9 : 0.45}; width:${Math.max(30, fovW)}%"></div>
          </div>
          <div class="settings__preview-meta">${s.renderScale}% • FOV ${s.fov}° • ${tr(`Интерьеры: ${s.interiorsLimit}`, `Interiors: ${s.interiorsLimit}`)}</div>
        </div>
      </div>
    `;
  }

  private syncAll(): void {
    for (const fn of this.rowSyncs) fn();
    if (this.openState) this.renderInfo();

    const lvl = this.ctx.quality.preset.level;
    const { used, max } = this.ctx.settings.estimateVramMb(lvl, this.ctx.device.memoryGb);
    const pct = Math.min(100, Math.round((used / max) * 100));
    this.vramLabel.textContent = tr('ЗАГРУЗКА ВИДЕОПАМЯТИ', 'ESTIMATED VRAM USAGE');
    this.vramNumbers.textContent = `${used} / ${max} MB`;
    this.vramFill.style.width = `${pct}%`;
    this.vramFill.classList.toggle('is-warn', pct >= 70 && pct < 90);
    this.vramFill.classList.toggle('is-crit', pct >= 90);

    const gp = this.getGamepadInfo();
    const gpText = gp.connected ? tr('Геймпад: подключён', 'Gamepad: connected') : tr('Геймпад: не подключён', 'Gamepad: disconnected');
    const qText = tr(`Пресет: ${lvl.toUpperCase()}`, `Preset: ${lvl.toUpperCase()}`);
    this.footerStatus.textContent = `${qText}  •  ${gpText}`;
  }
}
