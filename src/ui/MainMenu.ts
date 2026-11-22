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

/**
 * Resident Evil–inspired title & pause main menu overlay over the live 3D foggy street.
 * Supports mouse/touch, keyboard (ArrowUp/Down, W/S, Enter), and Gamepad (D-Pad/Stick + A).
 */
export class MainMenu {
  private readonly root = document.createElement('div');
  private readonly eyebrow = document.createElement('div');
  private readonly nav = document.createElement('nav');
  private readonly confirmBox = document.createElement('div');
  private readonly confirmTitle = document.createElement('div');
  private readonly confirmDesc = document.createElement('div');
  private readonly confirmYes = document.createElement('button');
  private readonly confirmNo = document.createElement('button');
  private readonly footerHint = document.createElement('span');
  private readonly footerStatus = document.createElement('span');

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

    const panel = document.createElement('div');
    panel.className = 'main-menu__panel';

    // Resident Evil–style stark typographic header with crimson accent
    const brand = document.createElement('header');
    brand.className = 'main-menu__brand';
    this.eyebrow.className = 'main-menu__eyebrow';
    const logo = document.createElement('div');
    logo.className = 'main-menu__logo';
    logo.innerHTML = `BLOCK<span class="main-menu__dead">DEAD</span>`;
    const rule = document.createElement('div');
    rule.className = 'main-menu__rule';
    brand.append(this.eyebrow, logo, rule);

    this.nav.className = 'main-menu__nav';

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

    const footer = document.createElement('footer');
    footer.className = 'main-menu__footer';
    const footerLeft = document.createElement('div');
    footerLeft.className = 'main-menu__footer-left';
    this.footerHint.className = 'main-menu__footer-hint';
    footerLeft.append(langToggle(), this.footerHint);
    this.footerStatus.className = 'main-menu__footer-status';
    footer.append(footerLeft, this.footerStatus);

    panel.append(brand, this.nav, footer);
    this.root.append(panel, this.confirmBox);
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
    this.eyebrow.textContent = tr('ПРОТОКОЛ «РАССВЕТ»', 'PROTOCOL DAWN');
    this.footerHint.textContent = tr('↑↓ Выбор · Enter / A Подтвердить', '↑↓ Select · Enter / A Confirm');
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
          `День ${summary.day}  ·  ${summary.time}  ·  HP ${summary.health}%  ·  Убито: ${summary.kills}`,
          `Day ${summary.day}  ·  ${summary.time}  ·  HP ${summary.health}%  ·  Kills: ${summary.kills}`,
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
        sub: summary.hasSave
          ? tr('Начать с чистого листа в новом городе', 'Start fresh in a new survival run')
          : tr('Создать выжившего и войти в город', 'Create your survivor and enter the city'),
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
        sub: tr('Графика, дальтонизм, геймпад, звук', 'Graphics, colorblindness, controller, audio'),
        action: () => this.host.onOpenSettings('graphics'),
      },
      {
        id: 'controls',
        ru: 'УПРАВЛЕНИЕ',
        en: 'CONTROLS',
        sub: tr('Клавиатура/мышь и раскладка геймпада', 'Keyboard/mouse & controller bindings'),
        action: () => this.host.onOpenSettings(gp.connected ? 'gamepad' : 'controls'),
      },
      {
        id: 'credits',
        ru: 'АВТОРЫ',
        en: 'CREDITS',
        sub: tr('Модели, звук и библиотеки', '3D assets, audio & libraries'),
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
    const gpStr = gp.connected ? tr('Геймпад: подключён', 'Controller: connected') : tr('Клавиатура / Сенсор', 'KB+M / Touch');
    this.footerStatus.textContent = `${tr('Графика', 'Graphics')}: ${lvl}  ·  ${gpStr}`;
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
