import { langToggle, onLangChange, tr } from '../core/i18n';
import type { GameContext } from '../GameContext';
import type { SaveSummary } from '../scenes/IScene';
import { openCredits } from './CreditsScreen';

export interface MainMenuHost {
  ctx: GameContext;
  getSaveSummary(): SaveSummary;
  onContinue(): void;
  onNewGame(): void;
  onNewGameOverwrite(): Promise<void>;
  onOpenSettings(tab: 'graphics' | 'gamepad' | 'controls'): void;
  isSubModalOpen(): boolean;
  getGamepadInfo(): { connected: boolean; name: string };
}

interface MenuEntry {
  id: 'continue' | 'new' | 'settings' | 'controls' | 'credits';
  ru: string;
  en: string;
  sub?: string;
  action: () => void;
}

const FOLIAGE_SVG = `<svg viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg">
  <g stroke="#080c07" stroke-linecap="round">
    <path d="M425 26 C355 52 285 88 188 142" stroke="#131910" stroke-width="4.5"/>
    <path d="M362 56 C318 42 278 24 236 6" stroke="#11170e" stroke-width="3.2"/>
    <path d="M300 84 C272 118 246 154 218 198" stroke="#10150d" stroke-width="2.8"/>
    <path d="M418 78 C362 94 316 114 268 148" stroke="#0f140c" stroke-width="2.6"/>
  </g>
  <g stroke="#1b2a14" stroke-width="1.6" stroke-linecap="round" opacity="0.92">
    <path d="M372 48 L350 12 M372 48 L368 8 M372 48 L388 10 M372 48 L404 18 M372 48 L338 22 M372 48 L352 72 M372 48 L374 78"/>
    <path d="M332 68 L302 30 M332 68 L318 24 M332 68 L342 28 M332 68 L294 48 M332 68 L316 102 M332 68 L344 104"/>
    <path d="M292 88 L256 48 M292 88 L272 42 M292 88 L298 46 M292 88 L244 74 M292 88 L266 126 M292 88 L294 128"/>
    <path d="M250 110 L206 74 M250 110 L224 64 M250 110 L252 68 M250 110 L198 100 M250 110 L218 146 M250 110 L248 152"/>
    <path d="M210 132 L162 104 M210 132 L176 90 M210 132 L202 88 M210 132 L152 132 M210 132 L172 164 M210 132 L198 176"/>
    <path d="M276 26 L242 2 M276 26 L264 -4 M276 26 L228 16 M276 26 L248 54 M276 26 L278 58"/>
    <path d="M244 158 L204 148 M244 158 L210 176 M244 158 L234 198 M244 158 L266 196 M244 158 L278 178"/>
    <path d="M388 88 L352 64 M388 88 L370 58 M388 88 L406 60 M388 88 L344 96 M388 88 L358 122 M388 88 L384 128"/>
    <path d="M332 108 L296 92 M332 108 L314 82 M332 108 L286 118 M332 108 L306 146 M332 108 L334 150"/>
  </g>
  <g stroke="#2a401f" stroke-width="1.2" stroke-linecap="round" opacity="0.78">
    <path d="M352 58 L334 24 M312 78 L288 42 M268 100 L238 66 M228 122 L194 94 M370 92 L352 122 M314 114 L298 144 M236 164 L216 190"/>
  </g>
</svg>`;

const NOTICE_ICON_SVG = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
  <polygon points="12,1.5 21,6.75 21,17.25 12,22.5 3,17.25 3,6.75" fill="#120b05"/>
  <rect x="10.9" y="6.2" width="2.2" height="7.4" rx="0.8" fill="#d97a26"/>
  <rect x="10.9" y="15.4" width="2.2" height="2.3" rx="0.8" fill="#d97a26"/>
</svg>`;

/**
 * Escape from Tarkov–inspired "Dead Perimeter" title & pause main menu overlay.
 * Supports mouse/touch, keyboard (ArrowUp/Down, W/S, Enter, Esc), and Gamepad (D-Pad/Stick + A/B).
 */
export class MainMenu {
  private readonly root = document.createElement('div');
  private readonly eyebrow = document.createElement('div');
  private readonly noticeTitle = document.createElement('div');
  private readonly noticeSub = document.createElement('div');
  private readonly nav = document.createElement('nav');
  private readonly confirmBox = document.createElement('div');
  private readonly confirmTitle = document.createElement('div');
  private readonly confirmDesc = document.createElement('div');
  private readonly confirmYes = document.createElement('button');
  private readonly confirmNo = document.createElement('button');
  private readonly tbVersion = document.createElement('span');
  private readonly tbMenuLabel = document.createElement('span');
  private readonly tbHint = document.createElement('span');
  private readonly tbStatus = document.createElement('span');
  private readonly tbGear = document.createElement('button');

  private buttons: HTMLButtonElement[] = [];
  private entries: MenuEntry[] = [];
  private selected = 0;
  private openState = false;
  private confirming = false;
  private host!: MainMenuHost;

  constructor(private readonly parent: HTMLElement) {
    this.root.className = 'main-menu';
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => e.stopPropagation());

    // Background layer: captured street/park image (blurred + vignette) + foreground pine foliage
    const bg = document.createElement('div');
    bg.className = 'main-menu__bg';
    const bgImg = document.createElement('img');
    bgImg.className = 'main-menu__bg-img';
    bgImg.src = `${import.meta.env.BASE_URL}ui/menu-bg.jpg`;
    bgImg.alt = '';
    bgImg.decoding = 'async';
    bgImg.setAttribute('aria-hidden', 'true');
    const vignette = document.createElement('div');
    vignette.className = 'main-menu__vignette';
    const foliage = document.createElement('div');
    foliage.className = 'main-menu__foliage';
    foliage.setAttribute('aria-hidden', 'true');
    foliage.innerHTML = FOLIAGE_SVG;
    bg.append(bgImg, vignette, foliage);

    // Centered Escape from Tarkov–style hero column
    const center = document.createElement('div');
    center.className = 'main-menu__center';

    const brand = document.createElement('header');
    brand.className = 'main-menu__brand';

    const dpWrap = document.createElement('div');
    dpWrap.className = 'main-menu__dp-wrap';
    const dpImg = document.createElement('img');
    dpImg.className = 'main-menu__dp';
    dpImg.src = `${import.meta.env.BASE_URL}ui/dp-logo.jpg`;
    dpImg.alt = 'DP';
    dpWrap.append(dpImg);

    const titleStack = document.createElement('div');
    titleStack.className = 'main-menu__title-stack';
    this.eyebrow.className = 'main-menu__eyebrow';
    const logo = document.createElement('div');
    logo.className = 'main-menu__logo';
    logo.innerHTML =
      `<span class="main-menu__logo-top">DEAD</span>` +
      `<span class="main-menu__logo-main">PERIMETER</span>`;
    titleStack.append(this.eyebrow, logo);
    brand.append(dpWrap, titleStack);

    // Tarkov-style amber Early Access / Beta notice banner
    const notice = document.createElement('div');
    notice.className = 'main-menu__notice';
    const noticeIcon = document.createElement('div');
    noticeIcon.className = 'main-menu__notice-icon';
    noticeIcon.innerHTML = NOTICE_ICON_SVG;
    const noticeText = document.createElement('div');
    noticeText.className = 'main-menu__notice-text';
    this.noticeTitle.className = 'main-menu__notice-title';
    this.noticeSub.className = 'main-menu__notice-sub';
    noticeText.append(this.noticeTitle, this.noticeSub);
    notice.append(noticeIcon, noticeText);

    this.nav.className = 'main-menu__nav';

    center.append(brand, notice, this.nav);

    // Thin dark Tarkov bottom taskbar
    const taskbar = document.createElement('footer');
    taskbar.className = 'main-menu__taskbar';

    const tbLeft = document.createElement('div');
    tbLeft.className = 'main-menu__tb-left';
    this.tbVersion.className = 'main-menu__tb-version';
    this.tbVersion.textContent = '0.1.0 Early Access';
    const tbPill = document.createElement('div');
    tbPill.className = 'main-menu__tb-pill is-active';
    const tbIco = document.createElement('span');
    tbIco.className = 'main-menu__tb-ico';
    tbIco.textContent = '≡';
    tbPill.append(tbIco, this.tbMenuLabel);
    tbLeft.append(this.tbVersion, tbPill);

    const tbRight = document.createElement('div');
    tbRight.className = 'main-menu__tb-right';
    this.tbHint.className = 'main-menu__tb-hint';
    this.tbStatus.className = 'main-menu__tb-status';
    const langWrap = document.createElement('div');
    langWrap.className = 'main-menu__tb-lang';
    langWrap.append(langToggle());
    this.tbGear.type = 'button';
    this.tbGear.className = 'main-menu__tb-gear';
    this.tbGear.textContent = '⚙';
    this.tbGear.addEventListener('click', () => this.host?.onOpenSettings('graphics'));
    tbRight.append(this.tbHint, this.tbStatus, langWrap, this.tbGear);

    taskbar.append(tbLeft, tbRight);

    // Overwrite-save confirmation dialog (inline inside menu)
    this.confirmBox.className = 'main-menu__confirm';
    this.confirmBox.hidden = true;
    const confirmCard = document.createElement('div');
    confirmCard.className = 'main-menu__confirm-card';
    this.confirmTitle.className = 'main-menu__confirm-title';
    this.confirmDesc.className = 'main-menu__confirm-desc';
    const confirmBtns = document.createElement('div');
    confirmBtns.className = 'main-menu__confirm-btns';

    this.confirmYes.type = 'button';
    this.confirmYes.className = 'main-menu__confirm-btn is-danger';
    this.confirmYes.addEventListener('click', () => {
      void this.acceptOverwrite();
    });

    this.confirmNo.type = 'button';
    this.confirmNo.className = 'main-menu__confirm-btn';
    this.confirmNo.addEventListener('click', () => this.hideConfirm());

    confirmBtns.append(this.confirmYes, this.confirmNo);
    confirmCard.append(this.confirmTitle, this.confirmDesc, confirmBtns);
    this.confirmBox.append(confirmCard);

    this.root.append(bg, center, taskbar, this.confirmBox);
    parent.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (!this.openState || this.host.isSubModalOpen()) return;
      if (this.confirming) {
        if (e.code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.hideConfirm();
        } else if (e.code === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          void this.acceptOverwrite();
        }
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW') {
        e.preventDefault();
        this.moveSelection(-1);
      } else if (e.code === 'ArrowDown' || e.code === 'KeyS') {
        e.preventDefault();
        this.moveSelection(1);
      } else if (e.code === 'Enter') {
        e.preventDefault();
        this.confirmSelection();
      }
    });

    onLangChange(() => {
      if (this.host) this.render();
    });
  }

  bind(host: MainMenuHost): void {
    this.host = host;
    host.ctx.events.on('quality:changed', () => {
      if (this.openState) this.renderStatus();
    });
    host.ctx.events.on('gamepad:changed', () => {
      if (this.openState) this.renderStatus();
    });
    this.render();
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (!this.host) return;
    this.confirming = false;
    this.confirmBox.hidden = true;
    this.openState = true;
    this.selected = 0;
    this.root.hidden = false;
    document.body.classList.add('main-menu-open');
    this.host.ctx.input.setActive(false);
    this.host.ctx.loop.pause('title');
    this.host.ctx.events.emit('ui:modal', { open: true });
    this.render();
  }

  close(acquireLock: boolean): void {
    if (!this.openState) return;
    this.openState = false;
    this.confirming = false;
    this.confirmBox.hidden = true;
    this.root.hidden = true;
    document.body.classList.remove('main-menu-open');
    this.host.ctx.events.emit('ui:modal', { open: false });
    this.host.ctx.loop.resume('title');
    if (acquireLock) {
      if (this.host.ctx.input.mode === 'kbm' && !this.host.getGamepadInfo().connected) {
        this.host.ctx.requestPointerLock();
      } else {
        this.host.ctx.input.setActive(true);
      }
    }
  }

  moveSelection(dir: -1 | 1): void {
    if (!this.openState || this.confirming || this.entries.length === 0) return;
    this.selected = (this.selected + dir + this.entries.length) % this.entries.length;
    this.syncSelected();
  }

  confirmSelection(): void {
    if (!this.openState) return;
    if (this.confirming) {
      void this.acceptOverwrite();
      return;
    }
    this.entries[this.selected]?.action();
  }

  cancelConfirm(): boolean {
    if (!this.openState || !this.confirming) return false;
    this.hideConfirm();
    return true;
  }

  private render(): void {
    const summary = this.host.getSaveSummary();
    this.eyebrow.textContent = tr('РАННИЙ ДОСТУП // ПРОТОКОЛ «РАССВЕТ»', 'EARLY ACCESS // PROTOCOL DAWN');
    this.noticeTitle.textContent = tr(
      'Внимание! Это ранняя версия «Dead Perimeter».',
      'Attention! This is an Early Access version of "Dead Perimeter".',
    );
    this.noticeSub.textContent = tr(
      'Механики, локации и графика активно дорабатываются. Удачной вылазки!',
      'This build does not represent final quality. Thank you for your understanding and support. Good luck!',
    );
    this.tbMenuLabel.textContent = tr('ГЛАВНОЕ МЕНЮ', 'MAIN MENU');
    this.tbHint.textContent = tr('↑↓ · Enter / A', '↑↓ · Enter / A');
    this.tbGear.title = tr('Настройки', 'Options');

    this.confirmTitle.textContent = tr('Начать новую игру?', 'Start a New Game?');
    this.confirmDesc.textContent = tr(
      `Текущее сохранение (День ${summary.day}, ${summary.time}) будет удалено без возможности восстановления.`,
      `Your existing save (Day ${summary.day}, ${summary.time}) will be permanently overwritten.`,
    );
    this.confirmYes.textContent = tr('Удалить и начать заново', 'Overwrite & Start');
    this.confirmNo.textContent = tr('Отмена', 'Cancel');

    const gp = this.host.getGamepadInfo();
    const list: MenuEntry[] = [];
    if (summary.hasSave) {
      list.push({
        id: 'continue',
        ru: 'ПРОДОЛЖИТЬ',
        en: 'CONTINUE',
        sub: tr(
          `День ${summary.day} · ${summary.time} · HP ${summary.health}% · Убито: ${summary.kills}`,
          `Day ${summary.day} · ${summary.time} · HP ${summary.health}% · Kills: ${summary.kills}`,
        ),
        action: () => {
          this.close(true);
          this.host.onContinue();
        },
      });
    }
    list.push(
      {
        id: 'new',
        ru: 'НОВАЯ ИГРА',
        en: 'NEW GAME',
        action: () => {
          if (this.host.getSaveSummary().hasSave) {
            this.showConfirm();
          } else {
            this.close(false);
            this.host.onNewGame();
          }
        },
      },
      {
        id: 'settings',
        ru: 'НАСТРОЙКИ',
        en: 'OPTIONS',
        action: () => this.host.onOpenSettings('graphics'),
      },
      {
        id: 'controls',
        ru: 'УПРАВЛЕНИЕ',
        en: 'CONTROLS',
        action: () => this.host.onOpenSettings(gp.connected ? 'gamepad' : 'controls'),
      },
      {
        id: 'credits',
        ru: 'АВТОРЫ',
        en: 'CREDITS',
        action: () => openCredits(this.parent),
      },
    );

    this.entries = list;
    this.selected = Math.min(this.selected, Math.max(0, list.length - 1));
    this.nav.replaceChildren();
    this.buttons = list.map((entry, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'main-menu__item';
      const title = document.createElement('span');
      title.className = 'main-menu__item-title';
      title.textContent = tr(entry.ru, entry.en);
      btn.append(title);
      if (entry.sub) {
        const sub = document.createElement('span');
        sub.className = 'main-menu__item-sub';
        sub.textContent = entry.sub;
        btn.append(sub);
      }
      btn.addEventListener('pointerenter', () => {
        this.selected = idx;
        this.syncSelected();
      });
      btn.addEventListener('click', () => {
        this.selected = idx;
        this.syncSelected();
        entry.action();
      });
      this.nav.append(btn);
      return btn;
    });
    this.syncSelected();
    this.renderStatus();
  }

  private syncSelected(): void {
    this.buttons.forEach((btn, i) => btn.classList.toggle('is-selected', i === this.selected));
  }

  private renderStatus(): void {
    const lvl = this.host.ctx.quality.preset.level.toUpperCase();
    const gp = this.host.getGamepadInfo();
    const gpStr = gp.connected ? tr('Геймпад: ВКЛ', 'Pad: ON') : tr('KB+M / Touch', 'KB+M / Touch');
    this.tbStatus.textContent = `${lvl} · ${gpStr}`;
  }

  private showConfirm(): void {
    this.confirming = true;
    this.confirmBox.hidden = false;
  }

  private hideConfirm(): void {
    this.confirming = false;
    this.confirmBox.hidden = true;
  }

  private async acceptOverwrite(): Promise<void> {
    this.confirmYes.disabled = true;
    this.hideConfirm();
    await this.host.onNewGameOverwrite();
  }
}
