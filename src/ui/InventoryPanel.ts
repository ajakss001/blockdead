import { onLangChange, registerDataLocalizer, tr } from '../core/i18n';
import {
  type BagSection,
  dirtLabel,
  ensureStackUid,
  type ItemDef,
  type ItemId,
  ITEMS,
  type ItemStack,
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
import type { ContainerRef, Containers, CorpseData, CorpseSlotKey, CorpseZone } from '../systems/Containers';
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
type BagZone = 'rig' | 'pockets' | 'pack' | 'stash';

/** Magazines occupy 1×2 vertical cells in rigs, backpacks, and containers. */
const MAG_ITEMS: ReadonlySet<ItemId> = new Set<ItemId>([
  'mag_ak',
  'mag_m4',
  'mag_g17',
  'mag_m1911',
  'mod_ext_mag_ak',
  'mod_ext_mag_m4',
  'mod_ext_mag_g17',
]);

function itemGridSize(id: ItemId): [number, number] {
  return MAG_ITEMS.has(id) ? [1, 2] : [1, 1];
}

/** Where a dragged or selected item lives (bound to unique instance uid + container zone). */
type Place =
  | { from: 'bag'; uid: string; id: ItemId; zone: BagZone }
  | { from: 'box'; uid: string; id: ItemId }
  | { from: 'corpseSlot'; slot: CorpseSlotKey; id: ItemId }
  | { from: 'corpseZone'; cz: CorpseZone; uid: string; id: ItemId }
  | { from: 'slot'; slot: Slot };
type DropTarget = 'bag' | `bag:${BagSection}` | 'box' | `slot:${Slot}` | `quick:${number}`;

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
  private confirmNewChar = false;
  private searchingZone: CorpseZone | null = null;
  private searchProgress = 0;
  private searchTimer: number | null = null;
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
    this.confirmNewChar = false;
    this.stopSearch();
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
    this.stopSearch();
    this.confirmNewChar = false;
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

  private stopSearch(): void {
    if (this.searchTimer !== null) {
      window.clearInterval(this.searchTimer);
      this.searchTimer = null;
    }
    sfx.setLootLoop(false);
    this.searchingZone = null;
    this.searchProgress = 0;
  }

  private startCorpseSearch(ref: ContainerRef, zone: CorpseZone): void {
    const corpse = this.host.containers.corpseOf(ref);
    if (!corpse || isCorpseZoneSearched(corpse, zone) || this.searchingZone === zone) return;
    this.stopSearch();
    this.searchingZone = zone;
    this.searchProgress = 0;
    sfx.setLootLoop(true);
    const started = performance.now();
    const duration = zone === 'backpack' ? 950 : zone === 'rig' ? 800 : 650;
    this.searchTimer = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / duration);
      this.searchProgress = p;
      if (p >= 1) {
        this.host.containers.searchCorpseZone(ref, zone);
        this.stopSearch();
        sfx.item('pick');
      }
      if (this.isOpen) this.render();
    }, 55);
    this.render();
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
      fresh.addEventListener('click', () => {
        this.confirmNewChar = true;
        this.render();
      });
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

    if (this.confirmNewChar) {
      const backdrop = el('div', 'inv__confirm');
      const card = el('div', 'inv__confirm-card');
      card.append(
        el('div', 'inv__confirm-title', tr('НОВЫЙ ПЕРСОНАЖ', 'NEW CHARACTER')),
        el(
          'div',
          'inv__confirm-text',
          tr(
            'Начать новую игру новым персонажем? Текущий прогресс, инвентарь и мир будут полностью сброшены.',
            'Start a new game with a new character? Current progress, inventory, and world will be completely reset.',
          ),
        ),
      );
      const row = el('div', 'inv__confirm-actions');
      const yes = el('button', 'inv__btn inv__confirm-yes', tr('Создать нового персонажа', 'Start new character'));
      yes.addEventListener('click', () => {
        this.confirmNewChar = false;
        this.close();
        this.host.newCharacter?.();
      });
      const no = el('button', 'inv__btn inv__btn--quiet inv__confirm-no', tr('Отмена', 'Cancel'));
      no.addEventListener('click', () => {
        this.confirmNewChar = false;
        this.render();
      });
      row.append(yes, no);
      card.append(row);
      backdrop.append(card);
      this.root.replaceChildren(topbar, body, backdrop);
    } else {
      this.root.replaceChildren(topbar, body);
    }
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

  /** Partition carried stacks into rig, pockets, and backpack (honoring manual `bagZone` first). */
  private partitionCarried(inv: Inventory): {
    rigStacks: ItemStack[];
    pocketStacks: ItemStack[];
    packStacks: ItemStack[];
    rigUsed: number;
    pocketUsed: number;
    packUsed: number;
  } {
    const rigStacks: ItemStack[] = [];
    const pocketStacks: ItemStack[] = [];
    const packStacks: ItemStack[] = [];
    let rigUsed = 0;
    let pocketUsed = 0;
    let packUsed = 0;
    const deferred: ItemStack[] = [];

    for (const s of inv.stacks) {
      ensureStackUid(s);
      const [, ch] = itemGridSize(s.id);
      if (s.bagZone === 'rig' && inv.worn.vest && rigUsed + ch <= RIG_SLOTS) {
        rigStacks.push(s);
        rigUsed += ch;
      } else if (s.bagZone === 'pockets' && ch === 1 && pocketUsed + 1 <= POCKET_SLOTS) {
        pocketStacks.push(s);
        pocketUsed += 1;
      } else if (s.bagZone === 'pack') {
        packStacks.push(s);
        packUsed += ch;
      } else {
        deferred.push(s);
      }
    }

    for (const s of deferred) {
      const def = ITEMS[s.id];
      const [, ch] = itemGridSize(s.id);
      if (inv.worn.vest && (MAG_ITEMS.has(s.id) || def.kind === 'ammo') && rigUsed + ch <= RIG_SLOTS) {
        rigStacks.push(s);
        rigUsed += ch;
      } else if (ch === 1 && def.weight <= 0.6 && pocketUsed + 1 <= POCKET_SLOTS) {
        pocketStacks.push(s);
        pocketUsed += 1;
      } else {
        packStacks.push(s);
        packUsed += ch;
      }
    }

    return { rigStacks, pocketStacks, packStacks, rigUsed, pocketUsed, packUsed };
  }

  /** Center column: РАЗГРУЗКА (vest), КАРМАНЫ (pockets), РЮКЗАК (backpack), and БЫСТРЫЙ ДОСТУП (1–4). */
  private gearColumn(): HTMLElement {
    const inv = this.host.inventory;
    const col = el('div', 'inv__col inv__col-gear');
    const { rigStacks, pocketStacks, packStacks, rigUsed, pocketUsed, packUsed } = this.partitionCarried(inv);

    // 1. РАЗГРУЗКА (Tactical Rig) — 4×2 grid supporting 1×2 vertical magazines
    const rigSec = el('section', 'inv__section');
    const rigHead = el('div', 'inv__sec-head', tr('РАЗГРУЗКА', 'TACTICAL RIG'));
    const rigBody = el('div', 'inv__sec-split');
    rigBody.dataset.drop = 'bag:rig';
    const vestSlot = this.slotCell('vest', inv.worn.vest ? ITEMS[inv.worn.vest].name : tr('Разгрузка', 'Rig'), inv.worn.vest);
    vestSlot.classList.add('cell--featured');
    const rigGrid = el('div', 'inv__mini-grid inv__mini-grid--4');
    rigGrid.dataset.drop = 'bag:rig';
    for (const s of rigStacks) {
      rigGrid.append(this.itemCell({ from: 'bag', uid: ensureStackUid(s), id: s.id, zone: 'rig' }, s.id, s.count));
    }
    for (let i = rigUsed; i < RIG_SLOTS; i++) {
      rigGrid.append(el('div', `cell cell--empty${inv.worn.vest ? '' : ' cell--locked'}`));
    }
    rigBody.append(vestSlot, rigGrid);
    rigSec.append(rigHead, rigBody);

    // 2. КАРМАНЫ (Pockets) — 4×1 (only 1×1 items)
    const pocketsSec = el('section', 'inv__section');
    pocketsSec.dataset.drop = 'bag:pockets';
    pocketsSec.append(el('div', 'inv__sec-head', tr('КАРМАНЫ', 'POCKETS')));
    const pocketsGrid = el('div', 'inv__mini-grid inv__mini-grid--4');
    pocketsGrid.dataset.drop = 'bag:pockets';
    for (const s of pocketStacks) {
      pocketsGrid.append(this.itemCell({ from: 'bag', uid: ensureStackUid(s), id: s.id, zone: 'pockets' }, s.id, s.count));
    }
    for (let i = pocketUsed; i < POCKET_SLOTS; i++) pocketsGrid.append(el('div', 'cell cell--empty'));
    pocketsSec.append(pocketsGrid);

    // 3. РЮКЗАК (Backpack)
    const packSec = el('section', 'inv__section inv__section--grow');
    const packHead = el('div', 'inv__sec-head', tr('РЮКЗАК', 'BACKPACK'));
    const packBody = el('div', 'inv__sec-split inv__sec-split--grow');
    packBody.dataset.drop = 'bag:pack';
    const backSlot = this.slotCell('back', inv.worn.back ? ITEMS[inv.worn.back].name : tr('Рюкзак', 'Backpack'), inv.worn.back);
    backSlot.classList.add('cell--featured');
    const packGrid = el('div', 'inv__grid');
    packGrid.dataset.drop = 'bag:pack';
    for (const s of packStacks) {
      packGrid.append(this.itemCell({ from: 'bag', uid: ensureStackUid(s), id: s.id, zone: 'pack' }, s.id, s.count));
    }
    for (let n = packUsed; n < Math.max(PACK_MIN_CELLS, packUsed + 4); n++) {
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
          if (inv.hand === qId) {
            this.selected = { from: 'slot', slot: 'hand' };
          } else {
            const match = inv.stacks.find((s) => s.id === qId);
            if (match) this.selected = { from: 'bag', uid: ensureStackUid(match), id: qId, zone: 'pack' };
          }
          this.render();
        });
        cell.addEventListener('dblclick', () => {
          const def = ITEMS[qId];
          const match = inv.stacks.find((s) => s.id === qId);
          if (!match) return;
          const place: Place = { from: 'bag', uid: ensureStackUid(match), id: qId, zone: 'pack' };
          if (def.equip) this.equip(place);
          else if (useVerb(def)) this.use(place);
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

  /** Right column: Corpse Looting Pane (if bandit corpse) OR Filter rail + Container/Carried + Inspector. */
  private rightColumn(): HTMLElement {
    const col = el('div', 'inv__col inv__col-right');
    const corpse = this.container ? this.host.containers.corpseOf(this.container) : undefined;

    const topArea = el('div', 'inv__stash-area');
    if (this.container && corpse) {
      topArea.append(this.corpsePane(this.container, corpse));
    } else {
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
    }

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
    let used = 0;
    for (const s of list) {
      const [, ch] = itemGridSize(s.id);
      used += ch;
      grid.append(this.itemCell({ from: 'bag', uid: ensureStackUid(s), id: s.id, zone: 'stash' }, s.id, s.count));
    }
    for (let n = used; n < Math.max(BOX_MIN_CELLS, used + 2); n++) grid.append(el('div', 'cell cell--empty'));
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
    let used = 0;
    for (const s of items) {
      const [, ch] = itemGridSize(s.id);
      used += ch;
      grid.append(this.itemCell({ from: 'box', uid: ensureStackUid(s), id: s.id }, s.id, s.count));
    }
    for (let n = used; n < Math.max(BOX_MIN_CELLS, used + 2); n++) grid.append(el('div', 'cell cell--empty'));
    if (allItems.length === 0) pane.append(el('div', 'inv__empty', tr('Ничего полезного', 'Nothing useful')));
    pane.append(grid);
    return pane;
  }

  /** EFT-style structured corpse inventory: equipped slots + searchable tactical rig, pockets, backpack. */
  private corpsePane(ref: ContainerRef, corpse: CorpseData): HTMLElement {
    const pane = el('div', 'inv__pane inv__pane--box inv__pane--corpse');
    pane.dataset.drop = 'box';

    const tierLabel = corpse.tier === 'elite' ? tr('Элитный боец', 'Elite Fighter') : tr('Бандит-выживший', 'Bandit Survivor');
    const title = el('div', 'inv__title', `${corpse.name} · ${tierLabel}`);
    const hasRevealed =
      Object.values(corpse.slots).some(Boolean) ||
      (corpse.searchedRig && corpse.rig.length > 0) ||
      (corpse.searchedPockets && corpse.pockets.length > 0) ||
      (corpse.searchedBackpack && corpse.backpack.length > 0);
    if (hasRevealed) {
      const all = el('button', 'inv__btn inv__btn--small', tr('Взять всё', 'Take all'));
      all.addEventListener('click', () => this.takeAll());
      title.append(all);
    }
    pane.append(title);

    // 1. Equipped slots on body (honest weapon, armor vest, helmet, uniform, bag, clothes)
    const equipSec = el('section', 'inv__corpse-sec');
    equipSec.append(el('div', 'inv__sec-head', tr('СНАРЯЖЕНИЕ ТЕЛА', 'EQUIPPED ON BODY')));
    const equipGrid = el('div', 'inv__corpse-slots');
    const order: readonly CorpseSlotKey[] = ['hand', 'head', 'vest', 'outfit', 'back', 'torso', 'legs', 'feet', 'mask', 'face'];
    for (const slot of order) {
      const st = corpse.slots[slot];
      const coreEmpty = slot === 'hand' || slot === 'head' || slot === 'vest' || slot === 'back';
      if (!st && !coreEmpty) continue;
      const cell = el('div', `cell cell--slot${st ? '' : ' cell--vacant'}`);
      if (slot === 'hand') cell.classList.add('cell--wide');
      const lbl = SLOT_LABELS[slot as Slot] ? tr(SLOT_LABELS[slot as Slot][0], SLOT_LABELS[slot as Slot][1]) : slot;
      if (st) {
        cell.append(icon(st.id));
        if (st.mods?.length) cell.append(el('span', 'cell__count', `+${st.mods.length}`));
        cell.title = ITEMS[st.id].name;
        const place: Place = { from: 'corpseSlot', slot, id: st.id };
        if (this.same(place, this.selected)) cell.classList.add('cell--sel');
        this.bindCell(cell, place);
      }
      cell.append(el('span', 'cell__label', lbl));
      equipGrid.append(cell);
    }
    equipSec.append(equipGrid);
    pane.append(equipSec);

    // 2. Searchable zones (РАЗГРУЗКА, КАРМАНЫ, РЮКЗАК)
    const zones: { cz: CorpseZone; head: [string, string]; searchBtn: [string, string]; show: boolean; items: ItemStack[]; cols: number; minCells: number }[] = [
      {
        cz: 'rig',
        head: ['РАЗГРУЗКА', 'TACTICAL RIG'],
        searchBtn: ['Обыскать разгрузку', 'Search tactical rig'],
        show: Boolean(corpse.slots.vest || corpse.rig.length > 0 || corpse.searchedRig),
        items: corpse.rig,
        cols: 4,
        minCells: 8,
      },
      {
        cz: 'pockets',
        head: ['КАРМАНЫ', 'POCKETS'],
        searchBtn: ['Обыскать карманы', 'Search pockets'],
        show: true,
        items: corpse.pockets,
        cols: 4,
        minCells: 4,
      },
      {
        cz: 'backpack',
        head: ['РЮКЗАК', 'BACKPACK'],
        searchBtn: ['Обыскать рюкзак', 'Search backpack'],
        show: Boolean(corpse.slots.back || corpse.backpack.length > 0 || corpse.searchedBackpack),
        items: corpse.backpack,
        cols: 6,
        minCells: 6,
      },
    ];

    for (const z of zones) {
      if (!z.show) continue;
      const sec = el('section', 'inv__corpse-sec');
      const secHead = el('div', 'inv__sec-head', tr(z.head[0], z.head[1]));
      sec.append(secHead);
      if (!isCorpseZoneSearched(corpse, z.cz)) {
        const searchRow = el('div', 'inv__corpse-unsearched');
        if (this.searchingZone === z.cz) {
          const pct = Math.round(this.searchProgress * 100);
          searchRow.append(this.statMeter(tr('Обыск...', 'Searching...'), `${pct}%`, this.searchProgress, false));
        } else {
          const btn = el('button', 'inv__btn inv__btn--small inv__corpse-search', tr(z.searchBtn[0], z.searchBtn[1])) as HTMLButtonElement;
          btn.type = 'button';
          btn.dataset.search = z.cz;
          btn.addEventListener('click', () => this.startCorpseSearch(ref, z.cz));
          searchRow.append(btn);
        }
        sec.append(searchRow);
      } else {
        const grid = el('div', z.cols === 4 ? 'inv__mini-grid inv__mini-grid--4' : 'inv__grid');
        let used = 0;
        for (const s of z.items) {
          const [, ch] = itemGridSize(s.id);
          used += ch;
          grid.append(this.itemCell({ from: 'corpseZone', cz: z.cz, uid: ensureStackUid(s), id: s.id }, s.id, s.count));
        }
        for (let n = used; n < z.minCells; n++) grid.append(el('div', 'cell cell--empty'));
        if (z.items.length === 0) sec.append(el('div', 'inv__empty', tr('Пусто', 'Empty')));
        sec.append(grid);
      }
      pane.append(sec);
    }

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
    const stack = this.stackAt(sel);
    const dirt = def.wear ? this.dirtAt(sel) : null;
    const worn = def.durability ? this.dirtAt(sel) : null;
    const modNames = stack?.mods?.length ? stack.mods.map((m) => MODS[m].name).join(', ') : '';
    const info =
      describe(def) +
      (modNames ? ` · ${modNames}` : '') +
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
        btn.addEventListener('click', () => this.use({ from: 'bag', uid: ensureStackUid(s), id: s.id, zone: 'pack' }));
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
    const [, ch] = itemGridSize(id);
    const cell = el('div', `cell${ch === 2 ? ' cell--tall' : ''}`);
    cell.dataset.item = id;
    if ('uid' in place) cell.dataset.uid = place.uid;
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
    if (place.from === 'corpseSlot') {
      out.push([tr('Взять', 'Take'), () => this.takeFromCorpseSlot(place.slot)]);
      if (def.wear) out.push([tr('Надеть', 'Wear'), () => this.takeFromCorpseSlot(place.slot, true)]);
      if (def.equip) out.push([tr('В руку', 'Equip'), () => this.takeFromCorpseSlot(place.slot, true)]);
      return out;
    }
    if (place.from === 'corpseZone') {
      const cnt = this.corpseZoneCount(place.cz, place.uid);
      out.push([tr('Взять', 'Take'), () => this.takeFromCorpseZone(place.cz, place.uid, cnt)]);
      if (def.wear) out.push([tr('Надеть', 'Wear'), () => this.takeFromCorpseZone(place.cz, place.uid, 1, 'wear')]);
      if (def.equip) out.push([tr('В руку', 'Equip'), () => this.takeFromCorpseZone(place.cz, place.uid, 1, 'equip')]);
      return out;
    }
    if (place.from === 'box') {
      const cnt = this.boxStack(place.uid)?.count ?? 1;
      out.push([tr('Взять', 'Take'), () => this.take(place.uid, cnt)]);
      if (def.wear) out.push([tr('Надеть', 'Wear'), () => this.take(place.uid, 1, 'wear')]);
      if (def.equip) out.push([tr('В руку', 'Equip'), () => this.take(place.uid, 1, 'equip')]);
      return out;
    }
    const verb = useVerb(def);
    if (def.wear) out.push([tr('Надеть', 'Wear'), () => this.wear(place)]);
    else if (verb) out.push([verb, () => this.use(place)]);
    if (def.equip) out.push([tr('В руку', 'Equip'), () => this.equip(place)]);
    const stackCount = this.host.inventory.stackByUid(place.uid)?.count ?? 1;
    if (this.container) out.push([tr('Положить', 'Store'), () => this.store(place, stackCount)]);
    else out.push([tr('Выбросить', 'Drop'), () => this.drop(place), true]);
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
    if (place.from === 'corpseSlot') return void this.takeFromCorpseSlot(place.slot);
    if (place.from === 'corpseZone') {
      return void this.takeFromCorpseZone(place.cz, place.uid, this.corpseZoneCount(place.cz, place.uid));
    }
    if (place.from === 'box') return void this.take(place.uid, this.boxStack(place.uid)?.count ?? 1);
    const def = ITEMS[place.id];
    const count = this.host.inventory.stackByUid(place.uid)?.count ?? 1;
    if (this.container) this.store(place, count);
    else if (def.wear) this.wear(place);
    else if (def.equip) this.equip(place);
    else if (useVerb(def)) this.use(place);
  }

  private move(place: Place, to: DropTarget): void {
    const id = this.itemAt(place);
    if (!id) return;
    if (to.startsWith('quick:')) {
      const qi = Number(to.slice(6));
      if (place.from === 'box' && !this.take(place.uid, 1)) return;
      if (place.from === 'corpseSlot' && !this.takeFromCorpseSlot(place.slot)) return;
      if (place.from === 'corpseZone' && !this.takeFromCorpseZone(place.cz, place.uid, 1)) return;
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
      if (place.from === 'box') {
        this.take(place.uid, 1, slot === 'hand' ? 'equip' : 'wear');
        return;
      }
      if (place.from === 'corpseSlot') {
        this.takeFromCorpseSlot(place.slot, true);
        return;
      }
      if (place.from === 'corpseZone') {
        this.takeFromCorpseZone(place.cz, place.uid, 1, slot === 'hand' ? 'equip' : 'wear');
        return;
      }
      if (place.from === 'slot') return this.render();
      if (slot === 'hand') this.equip(place);
      else this.wear(place);
      return;
    }
    const toBagZone: BagSection | null = to.startsWith('bag:') ? (to.slice(4) as BagSection) : null;
    const isBagTarget = to === 'bag' || toBagZone !== null;

    if (toBagZone && place.from === 'bag') {
      this.moveToBagZone(place.uid, toBagZone);
      return;
    }
    if (toBagZone && !this.canPlaceInBagZone(id, toBagZone)) {
      this.render();
      return;
    }
    if (place.from === 'slot') {
      this.unslot(place.slot, to === 'box');
      if (toBagZone && this.selected?.from === 'bag') this.moveToBagZone(this.selected.uid, toBagZone);
      return;
    }
    if (place.from === 'bag' && to === 'box') {
      const count = this.host.inventory.stackByUid(place.uid)?.count ?? 1;
      return this.store(place, count);
    }
    if (place.from === 'box' && isBagTarget) {
      if (this.take(place.uid, this.boxStack(place.uid)?.count ?? 1) && toBagZone && this.selected?.from === 'bag') {
        this.moveToBagZone(this.selected.uid, toBagZone);
      }
      return;
    }
    if (place.from === 'corpseSlot' && isBagTarget) {
      if (this.takeFromCorpseSlot(place.slot) && toBagZone && this.selected?.from === 'bag') {
        this.moveToBagZone(this.selected.uid, toBagZone);
      }
      return;
    }
    if (place.from === 'corpseZone' && isBagTarget) {
      if (
        this.takeFromCorpseZone(place.cz, place.uid, this.corpseZoneCount(place.cz, place.uid)) &&
        toBagZone &&
        this.selected?.from === 'bag'
      ) {
        this.moveToBagZone(this.selected.uid, toBagZone);
      }
      return;
    }
    this.render();
  }

  private canPlaceInBagZone(id: ItemId, targetZone: BagSection, movingUid?: string): boolean {
    const inv = this.host.inventory;
    const [, ch] = itemGridSize(id);
    if (targetZone === 'pack') return true;
    const part = this.partitionCarried(inv);
    if (targetZone === 'rig') {
      if (!inv.worn.vest) {
        this.ctx.hud.toast(tr('Наденьте разгрузку', 'Equip a tactical rig first'), 1100);
        return false;
      }
      if (movingUid && part.rigStacks.some((s) => ensureStackUid(s) === movingUid)) return true;
      if (part.rigUsed + ch > RIG_SLOTS) {
        this.ctx.hud.toast(tr('Разгрузка заполнена', 'Tactical rig is full'), 1100);
        return false;
      }
      return true;
    }
    // pockets
    if (ch > 1) {
      this.ctx.hud.toast(tr('Не помещается в карман (1×2)', 'Does not fit in pocket (1×2)'), 1100);
      return false;
    }
    if (movingUid && part.pocketStacks.some((s) => ensureStackUid(s) === movingUid)) return true;
    if (part.pocketUsed + 1 > POCKET_SLOTS) {
      this.ctx.hud.toast(tr('Карманы заполнены', 'Pockets are full'), 1100);
      return false;
    }
    return true;
  }

  private moveToBagZone(uid: string, targetZone: BagSection): boolean {
    const inv = this.host.inventory;
    const stack = inv.stackByUid(uid);
    if (!stack) return false;
    if (!this.canPlaceInBagZone(stack.id, targetZone, uid)) {
      this.render();
      return false;
    }
    stack.bagZone = targetZone;
    inv.version++;
    sfx.item('move');
    this.selected = { from: 'bag', uid, id: stack.id, zone: targetZone };
    this.render();
    return true;
  }

  // ─── Actions ──────────────────────────────────────────────────────────────────

  private use(place: Place): void {
    if (place.from !== 'bag') return;
    const { inventory, survival, player } = this.host;
    const def = ITEMS[place.id];
    if (inventory.removeByUid(place.uid, 1) === 0) return;
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

  private wear(place: Place): void {
    if (place.from !== 'bag') return;
    if (!this.host.inventory.wearByUid(place.uid)) this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
    else {
      sfx.item('cloth');
      this.selected = { from: 'slot', slot: ITEMS[place.id].wear!.slot };
    }
    this.host.syncBody();
    this.render();
  }

  private equip(place: Place): void {
    if (place.from !== 'bag') return;
    if (!this.host.inventory.equipByUid(place.uid)) this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
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
    const beforeUids = new Set(inv.stacks.map((s) => ensureStackUid(s)));
    const ok = slot === 'hand' ? inv.holster() : inv.takeOff(slot);
    if (!ok) {
      this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'));
      this.selected = null;
    } else {
      sfx.item(slot === 'hand' ? 'move' : 'cloth');
      const addedStack = inv.stacks.find((s) => !beforeUids.has(ensureStackUid(s))) ?? inv.stacks.find((s) => s.id === id);
      const newUid = addedStack ? ensureStackUid(addedStack) : null;
      if (toBox && newUid) {
        this.store({ from: 'bag', uid: newUid, id, zone: 'pack' }, 1);
        return;
      }
      this.selected = !toBox && newUid ? { from: 'bag', uid: newUid, id, zone: 'pack' } : null;
    }
    this.host.syncBody();
    this.render();
  }

  private take(uid: string, count: number, then?: 'wear' | 'equip'): boolean {
    const ref = this.container;
    if (!ref) return false;
    const target = this.boxStack(uid);
    if (!target) return false;
    const id = target.id;
    let got = 0;
    let addedStackUid: string | null = null;
    const inv = this.host.inventory;
    const beforeUids = new Set(inv.stacks.map((s) => ensureStackUid(s)));

    if (onePiece(ITEMS[id])) {
      if (inv.add(id, 1, target.dirt ?? 0, target.tint, target.mods) > 0) {
        this.host.containers.takeByUid(ref, uid, 1);
        got = 1;
      }
    } else {
      got = inv.add(id, count);
      if (got > 0) this.host.containers.takeByUid(ref, uid, got);
    }

    if (got > 0) {
      const added = inv.stacks.find((s) => !beforeUids.has(ensureStackUid(s))) ?? inv.stacks.find((s) => s.id === id);
      addedStackUid = added ? ensureStackUid(added) : null;
      sfx.item('pick');
    }
    if (got < count) this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
    if (got > 0 && then === 'wear' && addedStackUid) {
      this.wear({ from: 'bag', uid: addedStackUid, id, zone: 'pack' });
      return true;
    }
    if (got > 0 && then === 'equip' && addedStackUid) {
      this.equip({ from: 'bag', uid: addedStackUid, id, zone: 'pack' });
      return true;
    }
    this.selected = got > 0 && addedStackUid ? { from: 'bag', uid: addedStackUid, id, zone: 'pack' } : this.selected;
    this.render();
    return got > 0;
  }

  private takeFromCorpseSlot(slot: CorpseSlotKey, autoAction = false): boolean {
    const ref = this.container;
    if (!ref) return false;
    const corpse = this.host.containers.corpseOf(ref);
    const st = corpse?.slots[slot];
    if (!corpse || !st) return false;
    const inv = this.host.inventory;
    if (inv.room(st.id) < 1) {
      this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
      return false;
    }
    const taken = this.host.containers.takeCorpseSlot(ref, slot);
    if (!taken) return false;
    const beforeUids = new Set(inv.stacks.map((s) => ensureStackUid(s)));
    const got = inv.add(taken.id, taken.count, taken.dirt ?? 0, taken.tint, taken.mods);
    if (got === 0) {
      corpse.slots[slot] = taken;
      this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
      return false;
    }
    const added = inv.stacks.find((s) => !beforeUids.has(ensureStackUid(s))) ?? inv.stacks.find((s) => s.id === taken.id);
    const newUid = added ? ensureStackUid(added) : null;
    sfx.item('pick');
    if (autoAction && newUid) {
      if (ITEMS[taken.id].wear) {
        this.wear({ from: 'bag', uid: newUid, id: taken.id, zone: 'pack' });
        return true;
      }
      if (ITEMS[taken.id].equip) {
        this.equip({ from: 'bag', uid: newUid, id: taken.id, zone: 'pack' });
        return true;
      }
    }
    this.selected = newUid ? { from: 'bag', uid: newUid, id: taken.id, zone: 'pack' } : null;
    this.render();
    return true;
  }

  private takeFromCorpseZone(cz: CorpseZone, uid: string, count: number, then?: 'wear' | 'equip'): boolean {
    const ref = this.container;
    if (!ref) return false;
    const corpse = this.host.containers.corpseOf(ref);
    if (!corpse) return false;
    const target = corpseList(corpse, cz).find((s) => ensureStackUid(s) === uid);
    if (!target) return false;
    const inv = this.host.inventory;
    const want = Math.min(count, target.count);
    const room = inv.room(target.id);
    if (room <= 0) {
      this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
      return false;
    }
    const taken = this.host.containers.takeCorpseItem(ref, cz, uid, want);
    if (!taken) return false;
    const beforeUids = new Set(inv.stacks.map((s) => ensureStackUid(s)));
    const got = inv.add(taken.id, taken.count, taken.dirt ?? 0, taken.tint, taken.mods);
    if (got < taken.count) {
      this.host.containers.putCorpseItem(ref, cz, { ...taken, count: taken.count - got });
    }
    if (got <= 0) {
      this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
      return false;
    }
    const added = inv.stacks.find((s) => !beforeUids.has(ensureStackUid(s))) ?? inv.stacks.find((s) => s.id === taken.id);
    const newUid = added ? ensureStackUid(added) : null;
    sfx.item('pick');
    if (got < count) this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'));
    if (then === 'wear' && newUid) {
      this.wear({ from: 'bag', uid: newUid, id: taken.id, zone: 'pack' });
      return true;
    }
    if (then === 'equip' && newUid) {
      this.equip({ from: 'bag', uid: newUid, id: taken.id, zone: 'pack' });
      return true;
    }
    this.selected = newUid ? { from: 'bag', uid: newUid, id: taken.id, zone: 'pack' } : this.selected;
    this.render();
    return true;
  }

  private takeAll(): void {
    const ref = this.container;
    if (!ref) return;
    const corpse = this.host.containers.corpseOf(ref);
    let full = false;
    if (corpse) {
      for (const slot of Object.keys(corpse.slots) as CorpseSlotKey[]) {
        const st = corpse.slots[slot];
        if (!st) continue;
        const got = this.host.inventory.add(st.id, st.count, st.dirt ?? 0, st.tint, st.mods);
        if (got > 0) this.host.containers.takeCorpseSlot(ref, slot);
        else full = true;
      }
      for (const cz of ['rig', 'pockets', 'backpack'] as const) {
        if (!isCorpseZoneSearched(corpse, cz)) continue;
        for (const s of [...corpseList(corpse, cz)]) {
          const got = this.host.inventory.add(s.id, s.count, s.dirt ?? 0, s.tint, s.mods);
          if (got > 0) {
            this.host.containers.takeCorpseItem(ref, cz, ensureStackUid(s), got);
          }
          if (got < s.count) full = true;
        }
      }
    } else {
      for (const s of [...this.host.containers.contents(ref)]) {
        const got = this.host.inventory.add(s.id, s.count, s.dirt ?? 0, s.tint, s.mods);
        if (got > 0) this.host.containers.takeByUid(ref, ensureStackUid(s), got);
        if (got < s.count) full = true;
      }
    }
    if (full) this.ctx.hud.toast(tr('Не всё влезло', 'Not everything fit'));
    sfx.item('pick');
    this.selected = null;
    this.render();
  }

  private store(place: Place, count: number): void {
    const ref = this.container;
    if (!ref || place.from !== 'bag') return;
    const stack = this.host.inventory.stackByUid(place.uid);
    if (!stack) return;
    const id = stack.id;
    const dirt = stack.dirt;
    const tint = stack.tint;
    const mods = stack.mods;
    const corpse = this.host.containers.corpseOf(ref);
    const removed = this.host.inventory.removeByUid(place.uid, count);
    if (removed > 0) {
      if (corpse) {
        this.host.containers.putCorpseItem(ref, 'backpack', {
          id,
          count: removed,
          ...(dirt !== undefined ? { dirt } : {}),
          ...(tint !== undefined ? { tint } : {}),
          ...(mods?.length ? { mods: [...mods] } : {}),
        });
      } else {
        this.host.containers.put(ref, id, removed, dirt, tint);
      }
    }
    sfx.item('move');
    this.selected = null;
    this.render();
  }

  private drop(place: Place): void {
    if (place.from !== 'bag') return;
    const s = this.host.inventory.stackByUid(place.uid);
    if (s) this.host.inventory.removeByUid(place.uid, s.count);
    this.selected = null;
    this.render();
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private stackAt(p: Place): ItemStack | null {
    const inv = this.host.inventory;
    if (p.from === 'bag') return inv.stackByUid(p.uid) ?? null;
    if (p.from === 'box') return this.boxStack(p.uid) ?? null;
    const corpse = this.container ? this.host.containers.corpseOf(this.container) : undefined;
    if (p.from === 'corpseSlot') return corpse?.slots[p.slot] ?? null;
    if (p.from === 'corpseZone') return corpse ? corpseList(corpse, p.cz).find((s) => ensureStackUid(s) === p.uid) ?? null : null;
    return null;
  }

  private itemAt(p: Place): ItemId | null {
    const inv = this.host.inventory;
    if (p.from === 'slot') return p.slot === 'hand' ? inv.hand : inv.worn[p.slot];
    return this.stackAt(p)?.id ?? null;
  }

  private dirtAt(p: Place): number {
    const inv = this.host.inventory;
    if (p.from === 'slot') return p.slot === 'hand' ? inv.handWear : inv.wornDirt[p.slot];
    return this.stackAt(p)?.dirt ?? 0;
  }

  private exists(p: Place): boolean {
    return this.itemAt(p) !== null;
  }

  private boxStack(uid: string): ItemStack | undefined {
    if (!this.container) return undefined;
    return this.host.containers.contents(this.container).find((s) => ensureStackUid(s) === uid);
  }

  private corpseZoneCount(cz: CorpseZone, uid: string): number {
    const corpse = this.container ? this.host.containers.corpseOf(this.container) : undefined;
    if (!corpse) return 0;
    return corpseList(corpse, cz).find((s) => ensureStackUid(s) === uid)?.count ?? 0;
  }

  private same(a: Place | null, b: Place | null): boolean {
    return !!a && !!b && placeKey(a) === placeKey(b);
  }
}

function isCorpseZoneSearched(c: CorpseData, cz: CorpseZone): boolean {
  return cz === 'pockets' ? c.searchedPockets : cz === 'rig' ? c.searchedRig : c.searchedBackpack;
}

function corpseList(c: CorpseData, cz: CorpseZone): ItemStack[] {
  return cz === 'pockets' ? c.pockets : cz === 'rig' ? c.rig : c.backpack;
}

function placeKey(p: Place): string {
  if (p.from === 'slot') return `slot:${p.slot}`;
  if (p.from === 'corpseSlot') return `cslot:${p.slot}`;
  if (p.from === 'corpseZone') return `czone:${p.cz}:${p.uid}`;
  if (p.from === 'bag') return `bag:${p.zone}:${p.uid}`;
  return `box:${p.uid}`;
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

function place0(p: Place): boolean {
  return p.from === 'bag' || p.from === 'slot';
}
