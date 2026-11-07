import { dirtLabel, type ItemDef, type ItemId, ITEMS, noteText, onePiece, useVerb, WEAR_STATS, type WearSlot, wornStat } from '../data/items';
import { type Skills, SKILLS, XP } from '../systems/Skills';
import type { GameContext } from '../GameContext';
import type { Player } from '../player/Player';
import type { ContainerRef, Containers } from '../systems/Containers';
import type { Inventory } from '../systems/Inventory';
import type { Survival } from '../systems/Survival';
import type { Appearance } from '../player/appearance';
import { CONTAINER_SOUND, sfx } from '../audio/Sound';
import { CharacterPreview } from './CharacterPreview';
import { openCredits } from './CreditsScreen';
import { volumeControl } from './VolumeControl';
import { itemIcon } from './pixelart';

export interface InventoryHost {
  inventory: Inventory;
  survival: Survival;
  skills: Skills;
  containers: Containers;
  player: Player;
  /** Keep the first-person body in sync with what is held and worn. */
  syncBody(): void;
  onClose(): void;
}

type Slot = WearSlot | 'hand';
/** Where a dragged or selected item lives. */
type Place = { from: 'bag'; id: ItemId } | { from: 'box'; id: ItemId } | { from: 'slot'; slot: Slot };
type DropTarget = 'bag' | 'box' | `slot:${Slot}`;

const SLOTS: { slot: Slot; label: string }[] = [
  { slot: 'head', label: 'Голова' },
  { slot: 'torso', label: 'Торс' },
  { slot: 'vest', label: 'Жилет' },
  { slot: 'hands', label: 'Руки' },
  { slot: 'legs', label: 'Ноги' },
  { slot: 'feet', label: 'Обувь' },
  { slot: 'back', label: 'Рюкзак' },
];
const BAG_MIN_CELLS = 24;
const BOX_MIN_CELLS = 12;
const DRAG_THRESHOLD = 6;
const DOUBLE_TAP_MS = 320;
/** E and Esc close every game window (PC); Tab / I toggle the inventory. */
const CLOSE_KEYS = ['KeyE', 'Escape', 'Tab', 'KeyI'];

const WORDS = ['нет', 'лёгкий', 'сильный', 'критический'];
const level = (v: number) => (v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0);

/**
 * Zomboid-style inventory: a 3D figure (drag to turn) with equipment slots, the backpack grid and the open
 * container's grid. Tap selects (item card with actions), double tap does the obvious thing,
 * drag & drop moves between grids and slots (mouse and touch alike). The game is paused while
 * it is open; on PC the pointer lock is released and re-acquired on close.
 */
export class InventoryPanel {
  isOpen = false;
  private container: ContainerRef | null = null;
  private selected: Place | null = null;
  private readonly root = document.createElement('div');
  /** 3D figure in the worn clothes; renders only while the panel is open. */
  private readonly preview = new CharacterPreview();
  private lastTap = { key: '', t: 0 };
  /** Close keys that were already down when the window opened. */
  private readonly heldAtOpen = new Set<string>();
  /** We are releasing the pointer lock ourselves (opening); any other loss of the lock is the player's Esc. */
  private releasing = false;
  /** An Esc keydown reached us (when the browser swallows it to drop the lock, only the keyup arrives). */
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
      // A key still held from before the window opened (holding E through the search) or its
      // auto-repeat must not close it: only a new press after a release does.
      if (e.repeat || this.heldAtOpen.has(e.code)) return;
      this.close();
    });
    window.addEventListener('keyup', (e) => {
      this.heldAtOpen.delete(e.code);
      if (e.code === 'Escape') {
        if (this.isOpen && !this.escDown) this.close();
        this.escDown = false;
      }
    });
    // Esc while the mouse was still captured: the browser eats the keydown and just drops the lock.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      if (this.releasing) this.releasing = false;
      else if (this.isOpen) this.close();
    });
    this.root.addEventListener('pointermove', (e) => this.onDragMove(e));
    this.root.addEventListener('pointerup', (e) => this.onDragEnd(e));
    this.root.addEventListener('pointercancel', () => this.cancelDrag());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Looks of the survivor (from the character editor / save) for the 3D figure. */
  setAppearance(a: Appearance): void {
    this.preview.setAppearance(a);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open(null);
  }

  open(container: ContainerRef | null): void {
    this.container = container;
    this.selected = null;
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

  close(): void {
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
    this.ctx.requestPointerLock();
    this.host.onClose();
  }

  // ─── Rendering ────────────────────────────────────────────────────────────────

  private render(): void {
    const { inventory: inv } = this.host;
    if (this.selected && !this.exists(this.selected)) this.selected = null;

    const head = el('div', 'inv__head');
    const ratio = inv.weight / inv.limit;
    const bar = el('div', 'inv__load');
    const fill = el('div', 'inv__load-fill');
    fill.style.width = `${Math.min(100, ratio * 100)}%`;
    if (ratio > 0.9) fill.classList.add('inv__load-fill--full');
    bar.append(fill);
    const close = el('button', 'inv__close', '✕');
    close.addEventListener('click', () => this.close());
    const credits = el('button', 'credits-link inv__credits', 'Авторы');
    credits.addEventListener('click', () => openCredits(this.root.parentElement ?? this.root));
    head.append(el('div', 'inv__heading', 'Инвентарь'), bar, el('div', 'inv__kg', `${inv.weight.toFixed(1)} / ${inv.limit.toFixed(0)} кг`), volumeControl('inv__volume'), credits, close);

    // Half the window is the survivor; the other half is the backpack (split with the container
    // when one is open).
    const main = el('div', 'inv__main');
    const storage = el('div', 'inv__storage');
    storage.append(this.bagPane());
    if (this.container) storage.append(this.boxPane(this.container));
    main.append(this.equipment(), storage);

    this.root.replaceChildren(head, main, this.card());
  }

  private equipment(): HTMLElement {
    const inv = this.host.inventory;
    const pane = el('div', 'inv__equip');
    // Clothing slots down the left, level with head, torso, legs and feet of the figure.
    const left = el('div', 'inv__slots');
    // Body down the left (head, torso, legs, feet); what goes over it on the right (vest, gloves, bag).
    const over = new Set<Slot>(['vest', 'hands', 'back']);
    for (const { slot, label } of SLOTS) if (!over.has(slot)) left.append(this.slotCell(slot, label, inv.worn[slot as WearSlot]));
    this.preview.setOutfit(inv.worn, inv.hand, inv.wornDirt, inv.wornTint);
    const figure = el('div', 'inv__figure');
    figure.append(this.preview.canvas, el('div', 'inv__figure-hint', '↔'));
    // In the hand, vest, gloves, bag, then the totals of every clothing stat (bite: over the four body
    // parts, the vest and gloves adding on top, at most 95%).
    const right = el('div', 'inv__slots inv__slots--right');
    right.append(this.slotCell('hand', 'В руке', inv.hand));
    for (const { slot, label } of SLOTS) if (over.has(slot)) right.append(this.slotCell(slot, label, inv.worn[slot as WearSlot]));
    const worn = inv.worn;
    const stats = el('div', 'inv__armor');
    for (const { key, label, format } of WEAR_STATS) {
      const row = el('div', 'inv__armor-row');
      row.append(el('span', '', label), el('b', '', format(key === 'bite' ? Math.min(0.95, wornStat(worn, key) / 4) : wornStat(worn, key))));
      stats.append(row);
    }
    right.append(stats);
    pane.append(left, figure, right);
    return pane;
  }

  private bagPane(): HTMLElement {
    const pane = el('div', 'inv__pane');
    pane.dataset.drop = 'bag';
    pane.append(el('div', 'inv__title', 'Рюкзак'));
    const grid = el('div', 'inv__grid');
    const stacks = this.host.inventory.stacks;
    for (const s of stacks) grid.append(this.itemCell({ from: 'bag', id: s.id }, s.id, s.count));
    for (let n = stacks.length; n < Math.max(BAG_MIN_CELLS, stacks.length + 4); n++) grid.append(el('div', 'cell cell--empty'));
    pane.append(grid);
    return pane;
  }

  private boxPane(ref: ContainerRef): HTMLElement {
    const pane = el('div', 'inv__pane inv__pane--box');
    pane.dataset.drop = 'box';
    const items = this.host.containers.contents(ref);
    const title = el('div', 'inv__title', this.host.containers.name(ref));
    if (items.length > 1) {
      const all = el('button', 'inv__btn inv__btn--small', 'Взять всё');
      all.addEventListener('click', () => this.takeAll());
      title.append(all);
    }
    pane.append(title);
    const grid = el('div', 'inv__grid');
    for (const s of items) grid.append(this.itemCell({ from: 'box', id: s.id }, s.id, s.count));
    for (let n = items.length; n < Math.max(BOX_MIN_CELLS, items.length + 2); n++) grid.append(el('div', 'cell cell--empty'));
    if (items.length === 0) pane.append(el('div', 'inv__empty', 'Ничего полезного'));
    pane.append(grid);
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

  /** The survivor's skills: level and progress to the next (all eight, the untrained dim). */
  private skillRow(): HTMLElement {
    const sk = this.host.skills;
    const row = el('div', 'inv__skills');
    for (const s of SKILLS) {
      const l = sk.level(s.id);
      const cell = el('div', `inv__skill${l ? '' : ' inv__skill--none'}`);
      cell.title = `${s.name}: ${s.per} за уровень`;
      const bar = el('i', 'inv__skill-bar');
      bar.style.width = `${Math.round(sk.progress(s.id) * 100)}%`;
      cell.append(el('span', '', s.name), el('b', '', String(l)), bar);
      row.append(cell);
    }
    return row;
  }

  /** Item card: what is selected and what can be done with it; otherwise the survivor's condition. */
  private card(): HTMLElement {
    const card = el('div', 'inv__card');
    const sel = this.selected;
    const id = sel ? this.itemAt(sel) : null;
    if (!sel || !id) {
      const { survival: sv, player } = this.host;
      const line = [
        `Здоровье ${Math.round(sv.health * 100)}%`,
        `Голод: ${WORDS[level(sv.hunger)]}`,
        `Жажда: ${WORDS[level(sv.thirst)]}`,
        `Усталость: ${WORDS[level(sv.fatigue)]}`,
        sv.wounded ? 'Рана!' : '',
        `Фонарь ${Math.round(player.battery * 100)}%`,
      ]
        .filter(Boolean)
        .join('   ·   ');
      card.append(el('div', 'inv__stats', line));
      card.append(this.skillRow());
      card.append(el('div', 'inv__hint', this.ctx.input.mode === 'kbm' ? 'Клик — выбрать, двойной клик — действие, перетаскивание — переложить' : 'Тап — выбрать, двойной тап — действие, перетащи пальцем — переложить'));
      return card;
    }
    const def = ITEMS[id];
    card.append(icon(id, 'inv__card-icon'));
    const text = el('div', 'inv__card-text');
    const dirt = def.wear ? this.dirtAt(sel) : null;
    const worn = def.durability ? this.dirtAt(sel) : null;
    const info =
      describe(def) +
      (dirt !== null ? ` · грязь ${Math.round(dirt * 100)}% (${dirtLabel(dirt)})` : '') +
      (worn !== null ? ` · прочность ${Math.max(1, Math.round((1 - worn) * 100))}%` : '');
    text.append(el('div', 'inv__card-name', def.name), el('div', 'inv__card-info', info));
    card.append(text);
    const actions = el('div', 'inv__actions');
    for (const [label, fn, quiet] of this.actionsFor(sel, id)) {
      const b = el('button', `inv__btn${quiet ? ' inv__btn--quiet' : ''}`, label);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
      actions.append(b);
    }
    card.append(actions);
    return card;
  }

  private actionsFor(place: Place, id: ItemId): [string, () => void, boolean?][] {
    const def = ITEMS[id];
    const out: [string, () => void, boolean?][] = [];
    if (place.from === 'slot') {
      out.push([place.slot === 'hand' ? 'Убрать в рюкзак' : 'Снять', () => this.unslot(place.slot)]);
      if (this.container) out.push(['Положить', () => this.unslot(place.slot, true)]);
      return out;
    }
    if (place.from === 'box') {
      out.push(['Взять', () => this.take(id, this.boxCount(id))]);
      if (def.wear) out.push(['Надеть', () => this.take(id, 1) && this.wear(id)]);
      if (def.equip) out.push(['В руку', () => this.take(id, 1) && this.equip(id)]);
      return out;
    }
    const verb = useVerb(def);
    if (def.wear) out.push(['Надеть', () => this.wear(id)]);
    else if (verb) out.push([verb, () => this.use(id)]);
    if (def.equip) out.push(['В руку', () => this.equip(id)]);
    if (this.container) out.push(['Положить', () => this.store(id, this.host.inventory.count(id))]);
    else out.push(['Выбросить', () => this.drop(id), true]);
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
    // A tap: select; a second tap on the same item soon after: default action.
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

  /** Double tap: bag → container if one is open, else wear/equip/use; container → bag; slot → bag. */
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
    if (to.startsWith('slot:')) {
      const slot = to.slice(5) as Slot;
      const fits = slot === 'hand' ? !!ITEMS[id].equip : ITEMS[id].wear?.slot === slot;
      if (!fits) {
        this.ctx.hud.toast('Сюда не подходит', 900);
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
      this.ctx.hud.toast('Фонарь заряжен');
    } else {
      this.ctx.hud.toast(survival.consume(def));
      if (def.kind === 'medical') this.host.skills.add('firstAid', XP.heal);
    }
    this.render();
  }

  private wear(id: ItemId): void {
    if (!this.host.inventory.wear(id)) this.ctx.hud.toast('Рюкзак переполнен');
    else {
      sfx.item('cloth');
      this.selected = { from: 'slot', slot: ITEMS[id].wear!.slot };
    }
    this.host.syncBody();
    this.render();
  }

  private equip(id: ItemId): void {
    if (!this.host.inventory.equip(id)) this.ctx.hud.toast('Рюкзак переполнен');
    else {
      sfx.item('weapon');
      this.selected = { from: 'slot', slot: 'hand' };
    }
    this.host.syncBody();
    this.render();
  }

  /** Slot → backpack (or straight into the open container). */
  private unslot(slot: Slot, toBox = false): void {
    const inv = this.host.inventory;
    const id = slot === 'hand' ? inv.hand : inv.worn[slot];
    if (!id) return;
    const ok = slot === 'hand' ? inv.holster() : inv.takeOff(slot);
    if (!ok) this.ctx.hud.toast('Рюкзак переполнен');
    else {
      sfx.item(slot === 'hand' ? 'move' : 'cloth');
      if (toBox) this.store(id, 1);
    }
    this.selected = ok && !toBox ? { from: 'bag', id } : null;
    this.host.syncBody();
    this.render();
  }

  /** Container → backpack; returns false if nothing fit. */
  private take(id: ItemId, count: number): boolean {
    const ref = this.container;
    if (!ref) return false;
    let got = 0;
    if (onePiece(ITEMS[id])) {
      // Clothing and weapons: piece by piece, each with its own dirt / wear.
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
    if (got < count) this.ctx.hud.toast('Слишком тяжело');
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
    if (full) this.ctx.hud.toast('Не всё влезло');
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

  /** Dirt of the selected piece of clothing (the one an action would move). */
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
  const parts: string[] = [`${def.weight.toFixed(2).replace(/0$/, '')} кг`];
  if (def.note) parts.push(noteText(def.note));
  if (def.hunger) parts.push(`голод ${def.hunger < 0 ? '−' : '+'}${Math.round(Math.abs(def.hunger) * 100)}`);
  if (def.thirst) parts.push(`жажда ${def.thirst < 0 ? '−' : '+'}${Math.round(Math.abs(def.thirst) * 100)}`);
  if (def.fatigue) parts.push(`усталость −${Math.round(Math.abs(def.fatigue) * 100)}`);
  if (def.pain) parts.push('снимает боль');
  if (def.dressesWound) parts.push('перевязка раны');
  if (def.health) parts.push(`здоровье +${Math.round(def.health * 100)}`);
  if (def.battery) parts.push('заряд фонаря');
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
  img.className = cls;
  img.src = itemIcon(id);
  img.alt = ITEMS[id].name;
  img.draggable = false;
  return img;
}
