import { onLangChange, registerDataLocalizer, tr } from '../core/i18n';
import {
  dirtLabel,
  type ItemDef,
  type ItemId,
  ITEMS,
  noteText,
  onePiece,
  useVerb,
  WEAR_STATS,
  type WearSlot,
  wornStat,
} from '../data/items';
import { type Skills, SKILLS, XP } from '../systems/Skills';
import { blocker, craft, type CraftWorld, needsLine, RECIPES } from '../systems/Crafting';
import type { GameContext } from '../GameContext';
import type { Player } from '../player/Player';
import type { ContainerRef, Containers } from '../systems/Containers';
import type { Survival } from '../systems/Survival';
import type { Appearance } from '../player/appearance';
import { CONTAINER_SOUND, sfx } from '../audio/Sound';
import { CharacterPreview } from './CharacterPreview';
import { isCustomItemIcon, itemIcon } from './pixelart';
import { capacityOf, GUNS, isGun, MOD_FITS, MOD_IDS, MODS, type ModId, type ModSlot } from '../weapons/guns';
import { Inventory, QUICK_SLOTS } from '../systems/Inventory';

const SLOT_NAMES: Record<ModSlot, string> = { muzzle: 'Ствол', mag: 'Магазин', rail: 'Планка' };

export interface InventoryHost {
  inventory: Inventory;
  survival: Survival;
  skills: Skills;
  containers: Containers;
  player: Player;
  /** What crafting needs from the world (a fire near, where to put what is built). */
  craft: CraftWorld;
  /** Keep the first-person body in sync with what is held and worn. */
  syncBody(): void;
  onClose(): void;
  /** «Новый персонаж»: retire this survivor and open the character editor. */
  newCharacter?(): void;
}

type Slot = WearSlot | 'hand';
type InvTab = 'gear' | 'health' | 'craft' | 'skills';
type FilterCat = 'all' | 'weapons' | 'apparel' | 'supplies' | 'misc';

/** Where a dragged or selected item lives. */
type Place = { from: 'bag'; id: ItemId } | { from: 'box'; id: ItemId } | { from: 'slot'; slot: Slot };
type DropTarget = 'bag' | 'box' | `slot:${Slot}` | `quick:${number}`;

const DOLL_LEFT: readonly Slot[] = ['head', 'mask', 'vest', 'hand', 'bag'];
const DOLL_RIGHT: readonly WearSlot[] = ['outfit', 'face', 'torso', 'hands', 'legs', 'feet'];

const SLOT_LABELS: Readonly<Record<Slot, [string, string]>> = {
  outfit: ['Костюм', 'Outfit'],
  head: ['Шлем', 'Head'],
  face: ['Очки', 'Eyewear'],
  mask: ['Маска', 'Mask'],
  torso: ['Торс', 'Torso'],
  vest: ['Разгрузка', 'Rig / Vest'],
  hands: ['Перчатки', 'Hands'],
  legs: ['Штаны', 'Legs'],
  feet: ['Обувь', 'Footwear'],
  back: ['Рюкзак', 'Backpack'],
  bag: ['Сумка', 'Bag'],
  hand: ['В руке', 'Weapon'],
};

const FILTERS: readonly { id: FilterCat; ru: string; en: string }[] = [
  { id: 'all', ru: 'Все', en: 'All' },
  { id: 'weapons', ru: 'Оружие', en: 'Gear' },
  { id: 'apparel', ru: 'Одежда', en: 'Apparel' },
  { id: 'supplies', ru: 'Еда/Мед', en: 'Supplies' },
  { id: 'misc', ru: 'Разное', en: 'Misc' },
];

registerDataLocalizer((lang) => {
  const idx = lang === 'en' ? 1 : 0;
  SLOT_NAMES.muzzle = idx ? 'Muzzle' : 'Ствол';
  SLOT_NAMES.mag = idx ? 'Magazine' : 'Магазин';
  SLOT_NAMES.rail = idx ? 'Rail' : 'Планка';
});

const RIG_SLOTS = 8;
const POCKET_SLOTS = 4;
const PACK_MIN_CELLS = 18;
const BOX_MIN_CELLS = 18;
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 320;
/** E and Esc close every game window (PC); Tab / I toggle the inventory. */
const CLOSE_KEYS = ['KeyE', 'Escape', 'Tab', 'KeyI'];

const WORDS_RU = ['норма', 'лёгкий', 'сильный', 'критич.'];
const WORDS_EN = ['ok', 'mild', 'severe', 'critical'];
const level = (v: number) => (v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0);

/**
 * Tarkov-inspired Dead Perimeter inventory screen:
 *  - Top bar tabs: СНАРЯЖЕНИЕ | ЗДОРОВЬЕ | КРАФТ | НАВЫКИ
 *  - 3-column Gear layout: Doll + Slots + Vitals | Разгрузка + Карманы + Рюкзак + Быстрый доступ | Контейнер/Фильтр + Инспектор
 * Supports tap/click select, double-tap/click default action, and drag & drop across slots, grids, containers, and Quick Access 1–4.
 */
export class InventoryPanel {
  isOpen = false;
  private activeTab: InvTab = 'gear';
  private filter: FilterCat = 'all';
  private container: ContainerRef | null = null;
  private selected: Place | null = null;
  private readonly root = document.createElement('div');
  /** 3D figure in the worn clothes; renders only while the panel's Gear tab is visible. */
  private readonly preview = new CharacterPreview();
  private lastTap = { key: '', t: 0 };
  private readonly heldAtOpen = new Set<string>();
  private releasing = false;
  private escDown = false;
  private drag: { place: Place; x: number; y: number; ghost: HTMLImageElement | null; pointer: number } | null = null;

  constructor(
    private readonly ctx: GameContext,
    private readonly host: InventoryHost,
    parent: HTMLElement,
  ) {
    this.root.className = 'inv';
    this.root.hidden = true;
    parent.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.escDown = true;
      if (!this.isOpen || !CLOSE_KEYS.includes(e.code)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || this.heldAtOpen.has(e.code)) return;
      this.close(e.code === 'Escape');
    });
    window.addEventListener('keyup', (e) => {
      this.heldAtOpen.delete(e.code);
      if (e.code === 'Escape') {
        if (this.isOpen && !this.escDown) this.close(true);
        this.escDown = false;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      if (this.releasing) this.releasing = false;
      else if (this.isOpen) this.close(true);
    });
    this.root.addEventListener('pointermove', (e) => this.onDragMove(e));
    this.root.addEventListener('pointerup', (e) => this.onDragEnd(e));
    this.root.addEventListener('pointercancel', () => this.cancelDrag());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    onLangChange(() => {
      if (this.isOpen) this.render();
    });
  }

  setAppearance(a: Appearance, classId?: string): void {
    this.preview.setAppearance(a, classId);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open(null);
  }

  open(container: ContainerRef | null): void {
    this.container = container;
    this.selected = null;
    if (container) this.activeTab = 'gear';
    if (!this.isOpen) {
      this.isOpen = true;
      this.heldAtOpen.clear();
      if (this.ctx.input.isHeld('use')) this.heldAtOpen.add('KeyE');
      if (this.ctx.input.isHeld('inventory')) for (const k of ['Tab', 'KeyI']) this.heldAtOpen.add(k);
      this.root.hidden = false;
      if (!container) sfx.item('invOpen');
      this.ctx.loop.pause('inventory');
      this.preview.start();
      this.ctx.events.emit('ui:modal', { open: true });
      if (document.pointerLockElement) {
        this.releasing = true;
        document.exitPointerLock();
      }
    }
    this.render();
  }

  close(viaEsc = false): void {
    if (!this.isOpen) return;
    this.cancelDrag();
    this.isOpen = false;
    this.preview.stop();
    this.root.hidden = true;
    const ref = this.container;
    if (ref) sfx.containerClose(CONTAINER_SOUND[ref.type] ?? 'shelf', { x: ref.x, y: ref.y + 0.8, z: ref.z });
    else sfx.item('invClose');
    this.container = null;
    this.ctx.loop.resume('inventory');
    this.ctx.events.emit('ui:modal', { open: false });
    void viaEsc;
    this.ctx.requestPointerLock();
    this.host.onClose();
  }

  // ─── Rendering ────────────────────────────────────────────────────────────────

  private render(): void {
    if (this.selected && !this.exists(this.selected)) this.selected = null;

    const topbar = el('div', 'inv__topbar');
    const tabs = el('div', 'inv__tabs');
    const defs: readonly { id: InvTab; ico: string; ru: string; en: string }[] = [
      { id: 'gear', ico: '▣', ru: 'СНАРЯЖЕНИЕ', en: 'GEAR' },
      { id: 'health', ico: '♥', ru: 'ЗДОРОВЬЕ', en: 'HEALTH' },
      { id: 'craft', ico: '⚒', ru: 'КРАФТ', en: 'CRAFT' },
      { id: 'skills', ico: '✦', ru: 'НАВЫКИ', en: 'SKILLS' },
    ];
    for (const d of defs) {
      const btn = el('button', `inv__tab${this.activeTab === d.id ? ' is-active' : ''}`) as HTMLButtonElement;
      btn.type = 'button';
      btn.append(el('span', 'inv__tab-ico', d.ico), el('span', '', tr(d.ru, d.en)));
      btn.addEventListener('click', () => {
        this.activeTab = d.id;
        if (d.id === 'gear') this.preview.start();
        else this.preview.stop();
        this.render();
      });
      tabs.append(btn);
    }

    const headRight = el('div', 'inv__head-right');
    if (this.host.newCharacter) {
      const fresh = el('button', 'inv__btn inv__btn--small inv__btn--quiet inv__new', tr('Новый персонаж', 'New character'));
      fresh.addEventListener('click', () => this.host.newCharacter?.());
      headRight.append(fresh);
    }
    const close = el('button', 'inv__close', '✕');
    close.addEventListener('click', () => this.close());
    headRight.append(close);
    topbar.append(tabs, headRight);

    let body: HTMLElement;
    if (this.activeTab === 'gear') body = this.gearBoard();
    else if (this.activeTab === 'health') body = this.healthBoard();
    else if (this.activeTab === 'craft') body = this.craftPane();
    else body = this.skillsBoard();

    this.root.replaceChildren(topbar, body);
  }

  private gearBoard(): HTMLElement {
    const board = el('div', 'inv__board');
    board.append(this.charColumn(), this.gearColumn(), this.rightColumn());
    return board;
  }

  /** Left column: equipment slots around 3D figure + weight/HP/protection bars at bottom. */
  private charColumn(): HTMLElement {
    const { inventory: inv, survival: sv } = this.host;
    const col = el('div', 'inv__col inv__col-char');

    const stage = el('div', 'inv__doll-stage');
    const leftSlots = el('div', 'inv__doll-side');
    for (const slot of DOLL_LEFT) {
      const itemId = slot === 'hand' ? inv.hand : inv.worn[slot];
      const cell = this.slotCell(slot, tr(SLOT_LABELS[slot][0], SLOT_LABELS[slot][1]), itemId);
      if (slot === 'hand') cell.classList.add('cell--wide');
      leftSlots.append(cell);
    }

    this.preview.setOutfit(inv.worn, inv.hand, inv.wornDirt, inv.wornTint);
    const figure = el('div', 'inv__figure');
    figure.append(this.preview.canvas, el('div', 'inv__figure-hint', '↔'));

    const rightSlots = el('div', 'inv__doll-side');
    for (const slot of DOLL_RIGHT) {
      rightSlots.append(this.slotCell(slot, tr(SLOT_LABELS[slot][0], SLOT_LABELS[slot][1]), inv.worn[slot]));
    }
    stage.append(leftSlots, figure, rightSlots);

    // Character vitals summary underneath the figure
    const stats = el('div', 'inv__char-stats');
    const unit = tr('кг', 'kg');
    const weightRatio = Inventory.noOverload ? Math.min(1, inv.weight / Math.max(1, inv.limit)) : Math.min(1, inv.weight / Math.max(1, inv.limit));
    const weightText = Inventory.noOverload
      ? `${inv.weight.toFixed(1)} ${unit} (${tr('без лимита', '∞')})`
      : `${inv.weight.toFixed(1)} / ${inv.limit.toFixed(0)} ${unit}`;
    stats.append(this.statMeter(tr('Вес', 'Weight'), weightText, weightRatio, !Inventory.noOverload && weightRatio > 0.9));

    const hpPct = Math.round(sv.health * 100);
    stats.append(this.statMeter(tr('Здоровье', 'Health'), `${hpPct} / 100`, sv.health, hpPct < 30));

    const metaGrid = el('div', 'inv__armor-line');
    for (const { key, label, format } of WEAR_STATS) {
      const val = key === 'bite' ? Math.min(0.95, wornStat(inv.worn, key) / 4) : wornStat(inv.worn, key);
      const pill = el('div', 'inv__armor-pill');
      pill.append(el('span', '', tr(label, key === 'bite' ? 'Bite res.' : 'Warmth')), el('b', '', format(val)));
      metaGrid.append(pill);
    }
    stats.append(metaGrid);

    col.append(stage, stats);
    return col;
  }

  private statMeter(label: string, valText: string, ratio: number, crit: boolean): HTMLElement {
    const row = el('div', 'inv__meter');
    const head = el('div', 'inv__meter-head');
    head.append(el('span', '', label), el('b', '', valText));
    const track = el('div', 'inv__meter-track');
    const fill = el('div', `inv__meter-fill${crit ? ' is-crit' : ''}`);
    fill.style.width = `${Math.max(0, Math.min(100, Math.round(ratio * 100)))}%`;
    track.append(fill);
    row.append(head, track);
    return row;
  }

  /** Center column: РАЗГРУЗКА (vest), КАРМАНЫ (pockets), РЮКЗАК (backpack), and БЫСТРЫЙ ДОСТУП (1–4). */
  private gearColumn(): HTMLElement {
    const inv = this.host.inventory;
    const col = el('div', 'inv__col inv__col-gear');

    // Partition carried stacks cleanly once (rig -> pockets -> backpack) with zero duplicates
    const rigIds = new Set<ItemId>();
    const pocketIds = new Set<ItemId>();
    const rigStacks: typeof inv.stacks = [];
    const pocketStacks: typeof inv.stacks = [];
    const packStacks: typeof inv.stacks = [];

    for (const s of inv.stacks) {
      const def = ITEMS[s.id];
      if (inv.worn.vest && def.kind === 'ammo' && rigStacks.length < RIG_SLOTS) {
        rigStacks.push(s);
        rigIds.add(s.id);
      } else if (def.weight <= 0.6 && pocketStacks.length < POCKET_SLOTS && !rigIds.has(s.id)) {
        pocketStacks.push(s);
        pocketIds.add(s.id);
      } else {
        packStacks.push(s);
      }
    }

    // 1. РАЗГРУЗКА (Tactical Rig)
    const rigSec = el('section', 'inv__section');
    const rigHead = el('div', 'inv__sec-head', tr('РАЗГРУЗКА', 'TACTICAL RIG'));
    const rigBody = el('div', 'inv__sec-split');
    rigBody.dataset.drop = 'bag';
    const vestSlot = this.slotCell('vest', inv.worn.vest ? ITEMS[inv.worn.vest].name : tr('Разгрузка', 'Rig'), inv.worn.vest);
    vestSlot.classList.add('cell--featured');
    const rigGrid = el('div', 'inv__mini-grid inv__mini-grid--4');
    rigGrid.dataset.drop = 'bag';
    for (const s of rigStacks) rigGrid.append(this.itemCell({ from: 'bag', id: s.id }, s.id, s.count));
    for (let i = rigStacks.length; i < RIG_SLOTS; i++) {
      rigGrid.append(el('div', `cell cell--empty${inv.worn.vest ? '' : ' cell--locked'}`));
    }
    rigBody.append(vestSlot, rigGrid);
    rigSec.append(rigHead, rigBody);

    // 2. КАРМАНЫ (Pockets)
    const pocketsSec = el('section', 'inv__section');
    pocketsSec.append(el('div', 'inv__sec-head', tr('КАРМАНЫ', 'POCKETS')));
    const pocketsGrid = el('div', 'inv__mini-grid inv__mini-grid--4');
    pocketsGrid.dataset.drop = 'bag';
    for (const s of pocketStacks) pocketsGrid.append(this.itemCell({ from: 'bag', id: s.id }, s.id, s.count));
    for (let i = pocketStacks.length; i < POCKET_SLOTS; i++) pocketsGrid.append(el('div', 'cell cell--empty'));
    pocketsSec.append(pocketsGrid);

    // 3. РЮКЗАК (Backpack)
    const packSec = el('section', 'inv__section inv__section--grow');
    const packHead = el('div', 'inv__sec-head', tr('РЮКЗАК', 'BACKPACK'));
    const packBody = el('div', 'inv__sec-split inv__sec-split--grow');
    packBody.dataset.drop = 'bag';
    const backSlot = this.slotCell('back', inv.worn.back ? ITEMS[inv.worn.back].name : tr('Рюкзак', 'Backpack'), inv.worn.back);
    backSlot.classList.add('cell--featured');
    const packGrid = el('div', 'inv__grid');
    packGrid.dataset.drop = 'bag';
    for (const s of packStacks) packGrid.append(this.itemCell({ from: 'bag', id: s.id }, s.id, s.count));
    for (let n = packStacks.length; n < Math.max(PACK_MIN_CELLS, packStacks.length + 4); n++) {
      packGrid.append(el('div', 'cell cell--empty'));
    }
    packBody.append(backSlot, packGrid);
    packSec.append(packHead, packBody);

    // 4. БЫСТРЫЙ ДОСТУП (Quick Access 1–4)
    const quickSec = el('section', 'inv__section inv__quickbar');
    quickSec.append(el('div', 'inv__sec-head', tr('БЫСТРЫЙ ДОСТУП', 'QUICK ACCESS')));
    const quickRow = el('div', 'inv__quick-cells');
    for (let i = 0; i < QUICK_SLOTS; i++) {
      const qId = inv.quick[i];
      const cell = el('div', `cell cell--quick${qId ? '' : ' cell--vacant'}`);
      cell.dataset.drop = `quick:${i}`;
      cell.append(el('span', 'cell__qnum', String(i + 1)));
      if (qId) {
        const has = inv.has(qId);
        const ic = icon(qId);
        if (!has) ic.classList.add('is-missing');
        cell.append(ic);
        const cnt = inv.count(qId);
        if (cnt > 1) cell.append(el('span', 'cell__count', String(cnt)));
        cell.title = `${ITEMS[qId].name} (${tr('ПКМ — очистить', 'Right-click — clear')})`;
        cell.addEventListener('click', () => {
          if (inv.hand === qId) this.selected = { from: 'slot', slot: 'hand' };
          else if (inv.count(qId) > 0) this.selected = { from: 'bag', id: qId };
          this.render();
        });
        cell.addEventListener('dblclick', () => {
          const def = ITEMS[qId];
          if (def.equip && inv.count(qId) > 0) this.equip(qId);
          else if (useVerb(def) && inv.count(qId) > 0) this.use(qId);
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          inv.setQuick(i, null);
          this.render();
        });
      }
      quickRow.append(cell);
    }
    quickSec.append(quickRow);

    col.append(rigSec, pocketsSec, packSec, quickSec);
    return col;
  }

  /** Right column: category filter rail + Container loot / Filtered carried items + Item Inspector card. */
  private rightColumn(): HTMLElement {
    const col = el('div', 'inv__col inv__col-right');

    const topArea = el('div', 'inv__stash-area');
    const filters = el('div', 'inv__filters');
    for (const f of FILTERS) {
      const b = el('button', `inv__filter-btn${this.filter === f.id ? ' is-active' : ''}`, tr(f.ru, f.en)) as HTMLButtonElement;
      b.type = 'button';
      b.addEventListener('click', () => {
        this.filter = f.id;
        this.render();
      });
      filters.append(b);
    }

    const pane = this.container ? this.boxPane(this.container) : this.filteredCarriedPane();
    topArea.append(filters, pane);

    const inspector = this.inspectorCard();
    col.append(topArea, inspector);
    return col;
  }

  private matchesFilter(id: ItemId): boolean {
    if (this.filter === 'all') return true;
    const k = ITEMS[id].kind;
    if (this.filter === 'weapons') return k === 'weapon' || k === 'ammo';
    if (this.filter === 'apparel') return k === 'clothing';
    if (this.filter === 'supplies') return k === 'food' || k === 'drink' || k === 'medical';
    return k === 'tool' || k === 'material' || k === 'junk';
  }

  private filteredCarriedPane(): HTMLElement {
    const pane = el('div', 'inv__pane inv__pane--stash');
    pane.dataset.drop = 'bag';
    const fObj = FILTERS.find((x) => x.id === this.filter) ?? FILTERS[0];
    pane.append(el('div', 'inv__title', `${tr('СНАРЯЖЕНИЕ', 'CARRIED')} · ${tr(fObj.ru, fObj.en)}`));
    const list = this.host.inventory.stacks.filter((s) => this.matchesFilter(s.id));
    const grid = el('div', 'inv__grid');
    grid.dataset.drop = 'bag';
    for (const s of list) grid.append(this.itemCell({ from: 'bag', id: s.id }, s.id, s.count));
    for (let n = list.length; n < Math.max(BOX_MIN_CELLS, list.length + 2); n++) grid.append(el('div', 'cell cell--empty'));
    if (list.length === 0) pane.append(el('div', 'inv__empty', tr('В этой категории ничего нет', 'Nothing in this category')));
    pane.append(grid);
    return pane;
  }

  private boxPane(ref: ContainerRef): HTMLElement {
    const pane = el('div', 'inv__pane inv__pane--box');
    pane.dataset.drop = 'box';
    const allItems = this.host.containers.contents(ref);
    const items = allItems.filter((s) => this.matchesFilter(s.id));
    const title = el('div', 'inv__title', this.host.containers.name(ref));
    if (allItems.length > 0) {
      const all = el('button', 'inv__btn inv__btn--small', tr('Взять всё', 'Take all'));
      all.addEventListener('click', () => this.takeAll());
      title.append(all);
    }
    pane.append(title);
    const grid = el('div', 'inv__grid');
    for (const s of items) grid.append(this.itemCell({ from: 'box', id: s.id }, s.id, s.count));
    for (let n = items.length; n < Math.max(BOX_MIN_CELLS, items.length + 2); n++) grid.append(el('div', 'cell cell--empty'));
    if (allItems.length === 0) pane.append(el('div', 'inv__empty', tr('Ничего полезного', 'Nothing useful')));
    pane.append(grid);
    return pane;
  }

  private inspectorCard(): HTMLElement {
    const card = el('div', 'inv__card inv__inspector');
    const sel = this.selected;
    const id = sel ? this.itemAt(sel) : null;
    if (!sel || !id) {
      card.append(
        el(
          'div',
          'inv__hint',
          this.ctx.input.mode === 'kbm'
            ? tr(
                'Клик — осмотреть · Двойной клик — действие · Перетащите на слот или в «Быстрый доступ» (1–4)',
                'Click — inspect · Double-click — action · Drag to slot or Quick Access (1–4)',
              )
            : tr('Тап — осмотреть · Двойной тап — действие · Перетащи в слот', 'Tap — inspect · Double-tap — action · Drag to slot'),
        ),
      );
      return card;
    }

    const head = el('div', 'inv__insp-head');
    head.append(icon(id, 'inv__card-icon'));
    const text = el('div', 'inv__card-text');
    const def = ITEMS[id];
    const dirt = def.wear ? this.dirtAt(sel) : null;
    const worn = def.durability ? this.dirtAt(sel) : null;
    const info =
      describe(def) +
      (dirt !== null ? ` · ${tr('грязь', 'dirt')} ${Math.round(dirt * 100)}% (${dirtLabel(dirt)})` : '') +
      (worn !== null ? ` · ${tr('прочность', 'durability')} ${Math.max(1, Math.round((1 - worn) * 100))}%` : '');
    text.append(el('div', 'inv__card-name', def.name), el('div', 'inv__card-info', info));
    head.append(text);
    card.append(head);

    const actions = el('div', 'inv__actions');
    for (const [label, fn, quiet] of this.actionsFor(sel, id)) {
      const b = el('button', `inv__btn inv__btn--small${quiet ? ' inv__btn--quiet' : ''}`, label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      actions.append(b);
    }
    card.append(actions);

    if (place0(sel) && isGun(id)) card.append(this.gunMods(id));
    else if ((MOD_IDS as readonly string[]).includes(id))
      card.append(el('div', 'inv__hint', `${tr('Подходит', 'Fits')}: ` + MOD_FITS[id as ModId].map((g) => GUNS[g].name).join(', ')));
    if (place0(sel) && (def.equip || useVerb(def))) card.append(this.quickRow(id));
    return card;
  }

  /** Health tab: detailed vitals breakdown & direct med/food use buttons. */
  private healthBoard(): HTMLElement {
    const { survival: sv, player, inventory: inv } = this.host;
    const wrap = el('div', 'inv__subboard inv__health-board');
    const words = tr(WORDS_RU, WORDS_EN);

    const vitals = el('div', 'inv__pane inv__health-vitals');
    vitals.append(el('div', 'inv__title', tr('СОСТОЯНИЕ ВЫЖИВШЕГО', 'SURVIVOR VITALS')));
    vitals.append(
      this.statMeter(tr('Здоровье', 'Health'), `${Math.round(sv.health * 100)}%`, sv.health, sv.health < 0.3),
      this.statMeter(tr('Голод', 'Hunger'), words[level(sv.hunger)], 1 - sv.hunger, sv.hunger > 0.65),
      this.statMeter(tr('Жажда', 'Thirst'), words[level(sv.thirst)], 1 - sv.thirst, sv.thirst > 0.65),
      this.statMeter(tr('Усталость', 'Fatigue'), words[level(sv.fatigue)], 1 - sv.fatigue, sv.fatigue > 0.65),
      this.statMeter(tr('Фонарь', 'Flashlight'), `${Math.round(player.battery * 100)}%`, player.battery, player.battery < 0.2),
    );
    if (sv.wounded) vitals.append(el('div', 'inv__wound-alert', tr('⚠ Открытая рана — требуется перевязка!', '⚠ Bleeding wound — bandage required!')));

    const medsPane = el('div', 'inv__pane inv__health-meds');
    medsPane.append(el('div', 'inv__title', tr('МЕДИЦИНА И ПРИПАСЫ', 'MEDICAL & RATIONS')));
    const usable = inv.stacks.filter((s) => useVerb(ITEMS[s.id]));
    if (usable.length === 0) {
      medsPane.append(el('div', 'inv__empty', tr('Нет медикаментов или еды в рюкзаке', 'No medical items or rations carried')));
    } else {
      const list = el('div', 'inv__med-list');
      for (const s of usable) {
        const def = ITEMS[s.id];
        const row = el('div', 'inv__med-row');
        row.append(icon(s.id, 'inv__card-icon'));
        const txt = el('div', 'inv__card-text');
        txt.append(el('div', 'inv__card-name', `${def.name} ×${s.count}`), el('div', 'inv__card-info', describe(def)));
        const btn = el('button', 'inv__btn inv__btn--small', useVerb(def) ?? tr('Использовать', 'Use'));
        btn.addEventListener('click', () => this.use(s.id));
        row.append(txt, btn);
        list.append(row);
      }
      medsPane.append(list);
    }

    wrap.append(vitals, medsPane);
    return wrap;
  }

  /** Skills tab: full grid of all skills & XP bars. */
  private skillsBoard(): HTMLElement {
    const sk = this.host.skills;
    const wrap = el('div', 'inv__subboard inv__skills-board');
    const grid = el('div', 'inv__skills-grid');
    for (const s of SKILLS) {
      const l = sk.level(s.id);
      const pct = Math.round(sk.progress(s.id) * 100);
      const card = el('div', `inv__skill-card${l ? '' : ' is-zero'}`);
      const top = el('div', 'inv__skill-top');
      top.append(el('span', 'inv__skill-name', s.name), el('b', 'inv__skill-lvl', `${tr('Ур.', 'Lv.')} ${l}`));
      const sub = el('div', 'inv__skill-per', `${s.per} ${tr('за уровень', 'per level')}`);
      const track = el('div', 'inv__meter-track');
      const fill = el('div', 'inv__meter-fill');
      fill.style.width = `${pct}%`;
      track.append(fill);
      card.append(top, sub, track);
      grid.append(card);
    }
    wrap.append(grid);
    return wrap;
  }

  private craftPane(): HTMLElement {
    const pane = el('div', 'inv__pane inv__pane--craft');
    pane.append(el('div', 'inv__title', tr('КРАФТ И ВЕРСТАК', 'CRAFTING')));
    const list = el('div', 'inv__recipes');
    const w = this.host.craft;
    for (const r of RECIPES) {
      const why = blocker(r, w);
      const row = el('div', `inv__recipe${why ? ' inv__recipe--no' : ''}`);
      const text = el('div', 'inv__recipe-text');
      text.append(el('div', 'inv__recipe-name', r.name), el('div', 'inv__recipe-about', r.about));
      const needs = el('div', 'inv__recipe-needs');
      for (const n of needsLine(r, this.host.inventory)) needs.append(el('span', n.ok ? 'ok' : 'no', n.text));
      if (why && !why.startsWith('нет:') && !why.startsWith('missing:')) needs.append(el('span', 'no', why));
      text.append(needs);
      const b = el('button', 'inv__btn inv__btn--small', tr('Сделать', 'Craft')) as HTMLButtonElement;
      b.disabled = !!why;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const res = craft(r, w);
        this.ctx.hud.toast(res.text, 1600);
        sfx.item(r.place ? 'drop' : 'cloth');
        this.host.syncBody();
        if (r.place && res.ok) this.close();
        else this.render();
      });
      row.append(text, b);
      list.append(row);
    }
    pane.append(list);
    return pane;
  }

  private itemCell(place: Place, id: ItemId, count: number): HTMLElement {
    const cell = el('div', 'cell');
    if (this.same(place, this.selected)) cell.classList.add('cell--sel');
    cell.append(icon(id));
    if (count > 1) cell.append(el('span', 'cell__count', String(count)));
    cell.title = ITEMS[id].name;
    this.bindCell(cell, place);
    return cell;
  }

  private slotCell(slot: Slot, label: string, id: ItemId | null): HTMLElement {
    const cell = el('div', 'cell cell--slot');
    cell.dataset.drop = `slot:${slot}`;
    const place: Place = { from: 'slot', slot };
    if (id) {
      cell.append(icon(id));
      cell.title = ITEMS[id].name;
      if (this.same(place, this.selected)) cell.classList.add('cell--sel');
      this.bindCell(cell, place);
    } else {
      cell.classList.add('cell--vacant');
    }
    cell.append(el('span', 'cell__label', label));
    return cell;
  }

  private gunMods(id: ItemId & keyof typeof GUNS): HTMLElement {
    const inv = this.host.inventory;
    const inst = inv.gun(id);
    const g = GUNS[id];
    const box = el('div', 'inv__mods');
    const loaded = inst.mag + (inst.chamber && g.feed !== 'rocket' ? 1 : 0);
    box.append(
      el(
        'div',
        'inv__hint',
        `${tr('Заряжено', 'Loaded')} ${loaded} / ${capacityOf(id, inst.mods)} · ${ITEMS[g.caliber].name}: ${inv.count(g.caliber)}${g.mag ? ` · ${tr('магазинов', 'magazines')}: ${inv.count(g.mag)}` : ''}`,
      ),
    );
    const slots = [...new Set(MOD_IDS.filter((m) => MOD_FITS[m].includes(id)).map((m) => MODS[m].slot))];
    for (const slot of slots) {
      const row = el('div', 'inv__mod');
      row.append(el('span', 'inv__mod-slot', SLOT_NAMES[slot]));
      const on = inst.mods.find((m) => MODS[m].slot === slot) as ModId | undefined;
      if (on) {
        const b = el('button', 'inv__btn inv__btn--small', `${MODS[on].name} ✕`);
        b.title = tr('Снять', 'Remove');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!inv.detachMod(id, on)) this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
          sfx.gunMech('magIn', 1.3);
          this.render();
        });
        row.append(b);
      } else row.append(el('span', 'inv__mod-empty', tr('пусто', 'empty')));
      for (const m of MOD_IDS) {
        if (m === on || MODS[m].slot !== slot || !MOD_FITS[m].includes(id) || inv.count(m) === 0) continue;
        const b = el('button', 'inv__btn inv__btn--small inv__btn--quiet', `+ ${MODS[m].name}`);
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          inv.attachMod(id, m);
          sfx.gunMech('magIn', 1.3);
          this.render();
        });
        row.append(b);
      }
      box.append(row);
    }
    return box;
  }

  private quickRow(id: ItemId): HTMLElement {
    const inv = this.host.inventory;
    const row = el('div', 'inv__mod');
    row.append(el('span', 'inv__mod-slot', tr('Быстрый доступ', 'Quick Access')));
    for (let i = 0; i < QUICK_SLOTS; i++) {
      const b = el('button', `inv__btn inv__btn--small${inv.quick[i] === id ? '' : ' inv__btn--quiet'}`, String(i + 1));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        inv.setQuick(i, inv.quick[i] === id ? null : id);
        this.render();
      });
      row.append(b);
    }
    return row;
  }

  private actionsFor(place: Place, id: ItemId): [string, () => void, boolean?][] {
    const def = ITEMS[id];
    const out: [string, () => void, boolean?][] = [];
    if (place.from === 'slot') {
      out.push([place.slot === 'hand' ? tr('Убрать в рюкзак', 'Holster') : tr('Снять', 'Take off'), () => this.unslot(place.slot)]);
      if (this.container) out.push([tr('Положить', 'Store'), () => this.unslot(place.slot, true)]);
      return out;
    }
    if (place.from === 'box') {
      out.push([tr('Взять', 'Take'), () => this.take(id, this.boxCount(id))]);
      if (def.wear) out.push([tr('Надеть', 'Wear'), () => this.take(id, 1) && this.wear(id)]);
      if (def.equip) out.push([tr('В руку', 'Equip'), () => this.take(id, 1) && this.equip(id)]);
      return out;
    }
    const verb = useVerb(def);
    if (def.wear) out.push([tr('Надеть', 'Wear'), () => this.wear(id)]);
    else if (verb) out.push([verb, () => this.use(id)]);
    if (def.equip) out.push([tr('В руку', 'Equip'), () => this.equip(id)]);
    if (this.container) out.push([tr('Положить', 'Store'), () => this.store(id, this.host.inventory.count(id))]);
    else out.push([tr('Выбросить', 'Drop'), () => this.drop(id), true]);
    return out;
  }

  // ─── Input: tap, double tap, drag ─────────────────────────────────────────────

  private bindCell(cell: HTMLElement, place: Place): void {
    cell.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this.drag = { place, x: e.clientX, y: e.clientY, ghost: null, pointer: e.pointerId };
      this.root.setPointerCapture(e.pointerId);
    });
  }

  private onDragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return;
      const id = this.itemAt(d.place);
      if (!id) return;
      d.ghost = icon(id, 'inv__ghost');
      sfx.item('drag');
      this.root.append(d.ghost);
    }
    d.ghost.style.transform = `translate(${e.clientX - 24}px, ${e.clientY - 24}px)`;
    for (const t of this.root.querySelectorAll('.drop-hover')) t.classList.remove('drop-hover');
    this.dropAt(e.clientX, e.clientY)?.el.classList.add('drop-hover');
  }

  private onDragEnd(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointer) return;
    this.drag = null;
    if (d.ghost) {
      d.ghost.remove();
      const target = this.dropAt(e.clientX, e.clientY);
      if (target) {
        sfx.item('drop');
        this.move(d.place, target.target);
      } else this.render();
      return;
    }
    const key = placeKey(d.place);
    const now = performance.now();
    if (this.lastTap.key === key && now - this.lastTap.t < DOUBLE_TAP_MS) {
      this.lastTap.key = '';
      this.primary(d.place);
      return;
    }
    this.lastTap = { key, t: now };
    this.selected = d.place;
    this.render();
  }

  private cancelDrag(): void {
    this.drag?.ghost?.remove();
    this.drag = null;
  }

  private dropAt(x: number, y: number): { el: HTMLElement; target: DropTarget } | null {
    const hit = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]');
    return hit ? { el: hit, target: hit.dataset.drop as DropTarget } : null;
  }

  private primary(place: Place): void {
    if (place.from === 'slot') return this.unslot(place.slot);
    if (place.from === 'box') return void this.take(place.id, this.boxCount(place.id));
    const def = ITEMS[place.id];
    if (this.container) this.store(place.id, this.host.inventory.count(place.id));
    else if (def.wear) this.wear(place.id);
    else if (def.equip) this.equip(place.id);
    else if (useVerb(def)) this.use(place.id);
  }

  private move(place: Place, to: DropTarget): void {
    const id = this.itemAt(place);
    if (!id) return;
    if (to.startsWith('quick:')) {
      const qi = Number(to.slice(6));
      if (place.from === 'box' && !this.take(id, 1)) return;
      this.host.inventory.setQuick(qi, id);
      sfx.item('move');
      this.render();
      return;
    }
    if (to.startsWith('slot:')) {
      const slot = to.slice(5) as Slot;
      const fits = slot === 'hand' ? !!ITEMS[id].equip : ITEMS[id].wear?.slot === slot;
      if (!fits) {
        this.ctx.hud.toast(tr('Сюда не подходит', 'Does not fit here'), 900);
        this.render();
        return;
      }
      if (place.from === 'box' && !this.take(id, 1)) return;
      if (place.from === 'slot') return this.render();
      if (slot === 'hand') this.equip(id);
      else this.wear(id);
      return;
    }
    if (place.from === 'slot') return this.unslot(place.slot, to === 'box');
    if (place.from === 'bag' && to === 'box') return this.store(id, this.host.inventory.count(id));
    if (place.from === 'box' && to === 'bag') return void this.take(id, this.boxCount(id));
    this.render();
  }

  // ─── Actions ──────────────────────────────────────────────────────────────────

  private use(id: ItemId): void {
    const { inventory, survival, player } = this.host;
    const def = ITEMS[id];
    if (inventory.remove(id, 1) === 0) return;
    sfx.item(def.kind === 'drink' ? 'drink' : def.kind === 'food' ? 'eat' : def.kind === 'medical' ? 'bandage' : 'pick');
    if (def.battery) {
      player.rechargeBattery(def.battery);
      this.ctx.hud.toast(tr('Фонарь заряжен', 'Flashlight charged'));
    } else {
      this.ctx.hud.toast(survival.consume(def));
      if (def.kind === 'medical') this.host.skills.add('firstAid', XP.heal);
      if (def.bottle) inventory.add('emptyBottle', 1);
    }
    this.render();
  }

  private wear(id: ItemId): void {
    if (!this.host.inventory.wear(id)) this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
    else {
      sfx.item('cloth');
      this.selected = { from: 'slot', slot: ITEMS[id].wear!.slot };
    }
    this.host.syncBody();
    this.render();
  }

  private equip(id: ItemId): void {
    if (!this.host.inventory.equip(id)) this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
    else {
      sfx.item('weapon');
      this.selected = { from: 'slot', slot: 'hand' };
    }
    this.host.syncBody();
    this.render();
  }

  private unslot(slot: Slot, toBox = false): void {
    const inv = this.host.inventory;
    const id = slot === 'hand' ? inv.hand : inv.worn[slot];
    if (!id) return;
    const ok = slot === 'hand' ? inv.holster() : inv.takeOff(slot);
    if (!ok) this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
    else {
      sfx.item(slot === 'hand' ? 'move' : 'cloth');
      if (toBox) this.store(id, 1);
    }
    this.selected = ok && !toBox ? { from: 'bag', id } : null;
    this.host.syncBody();
    this.render();
  }

  private take(id: ItemId, count: number): boolean {
    const ref = this.container;
    if (!ref) return false;
    let got = 0;
    if (onePiece(ITEMS[id])) {
      for (let n = 0; n < count; n++) {
        const dirt = this.host.containers.peekDirt(ref, id);
        if (this.host.inventory.add(id, 1, dirt, this.host.containers.peekTint(ref, id)) === 0) break;
        this.host.containers.take(ref, id, 1);
        got++;
      }
    } else {
      got = this.host.inventory.add(id, count);
      if (got > 0) this.host.containers.take(ref, id, got);
    }
    if (got < count) this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
    if (got > 0) sfx.item('pick');
    this.selected = got > 0 ? { from: 'bag', id } : this.selected;
    this.render();
    return got > 0;
  }

  private takeAll(): void {
    const ref = this.container;
    if (!ref) return;
    let full = false;
    for (const s of [...this.host.containers.contents(ref)]) {
      const got = this.host.inventory.add(s.id, s.count, s.dirt ?? 0, s.tint);
      if (got > 0) this.host.containers.take(ref, s.id, got);
      if (got < s.count) full = true;
    }
    if (full) this.ctx.hud.toast(tr('Не всё влезло', 'Not everything fit'));
    sfx.item('pick');
    this.render();
  }

  private store(id: ItemId, count: number): void {
    const ref = this.container;
    if (!ref) return;
    if (onePiece(ITEMS[id])) {
      for (let k = 0; k < count; k++) {
        const dirt = this.host.inventory.peekDirt(id);
        const tint = this.host.inventory.peekTint(id);
        if (this.host.inventory.remove(id, 1) === 0) break;
        this.host.containers.put(ref, id, 1, dirt, tint);
      }
    } else {
      const n = this.host.inventory.remove(id, count);
      if (n > 0) this.host.containers.put(ref, id, n);
    }
    sfx.item('move');
    this.selected = null;
    this.render();
  }

  private drop(id: ItemId): void {
    this.host.inventory.remove(id, this.host.inventory.count(id));
    this.selected = null;
    this.render();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private itemAt(p: Place): ItemId | null {
    const inv = this.host.inventory;
    if (p.from === 'slot') return p.slot === 'hand' ? inv.hand : inv.worn[p.slot];
    if (p.from === 'bag') return inv.count(p.id) > 0 ? p.id : null;
    return this.boxCount(p.id) > 0 ? p.id : null;
  }

  private dirtAt(p: Place): number {
    const inv = this.host.inventory;
    if (p.from === 'slot') return p.slot === 'hand' ? inv.handWear : inv.wornDirt[p.slot];
    if (p.from === 'bag') return inv.peekDirt(p.id);
    return this.container ? this.host.containers.peekDirt(this.container, p.id) : 0;
  }

  private exists(p: Place): boolean {
    return this.itemAt(p) !== null;
  }

  private boxCount(id: ItemId): number {
    if (!this.container) return 0;
    let n = 0;
    for (const s of this.host.containers.contents(this.container)) if (s.id === id) n += s.count;
    return n;
  }

  private same(a: Place | null, b: Place | null): boolean {
    return !!a && !!b && placeKey(a) === placeKey(b);
  }
}

function placeKey(p: Place): string {
  return p.from === 'slot' ? `slot:${p.slot}` : `${p.from}:${p.id}`;
}

function describe(def: ItemDef): string {
  const parts: string[] = [`${def.weight.toFixed(2).replace(/0$/, '')} ${tr('кг', 'kg')}`];
  if (def.note) parts.push(noteText(def.note));
  if (def.hunger) parts.push(`${tr('голод', 'hunger')} ${def.hunger < 0 ? '−' : '+'}${Math.round(Math.abs(def.hunger) * 100)}`);
  if (def.thirst) parts.push(`${tr('жажда', 'thirst')} ${def.thirst < 0 ? '−' : '+'}${Math.round(Math.abs(def.thirst) * 100)}`);
  if (def.fatigue) parts.push(`${tr('усталость', 'fatigue')} −${Math.round(Math.abs(def.fatigue) * 100)}`);
  if (def.pain) parts.push(tr('снимает боль', 'relieves pain'));
  if (def.dressesWound) parts.push(tr('перевязка раны', 'bandages wound'));
  if (def.health) parts.push(`${tr('здоровье', 'health')} +${Math.round(def.health * 100)}`);
  if (def.battery) parts.push(tr('заряд фонаря', 'flashlight battery'));
  if (def.wear) for (const { key, label, format } of WEAR_STATS) parts.push(`${label.toLowerCase()} ${format(def.wear.stats[key])}`);
  return parts.join(' · ');
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function icon(id: ItemId, cls = 'cell__icon'): HTMLImageElement {
  const img = document.createElement('img');
  img.className = isCustomItemIcon(id) ? `${cls} is-hd` : cls;
  img.src = itemIcon(id);
  img.alt = ITEMS[id].name;
  img.draggable = false;
  return img;
}

function place0(p: { from: string }): boolean {
  return p.from !== 'box';
}
