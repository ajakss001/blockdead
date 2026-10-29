import { CONTAINER_SOUND, sfx } from '../audio/Sound';
import type { ItemId } from '../data/items';
import type { GameContext } from '../GameContext';
import type { Player } from '../player/Player';
import type { InventoryPanel } from '../ui/InventoryPanel';
import type { DoorRef, Doors } from '../world/Doors';
import type { ContainerRef, Containers } from './Containers';
import type { Inventory } from './Inventory';

/** Sound position of a container: its front, at about hand height. */
const spot = (ref: ContainerRef) => ({ x: ref.x, y: ref.y + 0.8, z: ref.z });

/** First search of a container takes time and leaves you exposed (Zomboid); reopening is instant. */
const SEARCH_TIME = 2;
const PROMPT_INTERVAL = 0.1;
/** Hotkey 1 draws the first of these that is in the backpack. */
const WEAPON_PRIORITY: ItemId[] = ['axe', 'crowbar', 'bat', 'knife', 'hammer'];

/**
 * "Use" and "inventory" actions: find the container the player faces, run the timed search,
 * open the inventory screen; also weapon hotkeys and the context prompt under the crosshair.
 */
export class Interaction {
  private searchT = -1;
  private searchRef: ContainerRef | null = null;
  private promptT = 0;
  private lastWeapon: ItemId | null = null;
  private searchTime = SEARCH_TIME;
  /** Class: search time multipliers (all containers, car trunks). */
  searchMul = 1;
  carMul = 1;

  constructor(
    private readonly ctx: GameContext,
    private readonly player: Player,
    private readonly containers: Containers,
    private readonly inventory: Inventory,
    private readonly panel: InventoryPanel,
    private readonly syncBody: () => void,
    private readonly doors: Doors,
  ) {
    // Esc during a search (the mouse is captured, the browser drops the lock): stop searching quietly,
    // as if a window closed — the soft "click to continue", never the pause screen.
    ctx.events.on('input:active', ({ active }) => {
      if (active || this.searchT < 0) return;
      this.cancelSearch(true);
      this.player.busy = false;
      ctx.events.emit('ui:modal', { open: true });
      ctx.events.emit('ui:modal', { open: false });
    });
  }

  fixedUpdate(dt: number): void {
    const { input, hud } = this.ctx;
    if (input.consumePressed('inventory')) {
      this.cancelSearch(false);
      this.panel.open(null);
      return;
    }
    if (input.consumePressed('item1')) this.drawWeapon();
    if (input.consumePressed('item2')) this.putAway();
    // Touch: one button draws or puts away, whatever is in hand (a class can start armed).
    if (input.consumePressed('weapon')) {
      if (this.inventory.hand) this.putAway();
      else this.drawWeapon();
    }

    const use = input.consumePressed('use');
    if (this.searchT >= 0) {
      if (this.player.controller.speed > 0.4 || input.isHeld('attack')) {
        this.cancelSearch(true);
      } else {
        this.searchT += dt;
        hud.showAction(`Обыск: ${this.containers.name(this.searchRef!)}`, this.searchT / this.searchTime);
        if (this.searchT >= this.searchTime) {
          const ref = this.searchRef!;
          this.searchT = -1;
          this.ctx.events.emit('ui:busy', { busy: false });
          this.searchRef = null;
          hud.hideAction();
          sfx.searching(null);
          this.panel.open(ref);
        }
      }
    } else if (use) {
      const door = this.doorTarget();
      const ref = this.target();
      if (door && (!ref || this.doorCloser(door, ref))) {
        const at = this.doors.info(door);
        if (!this.doors.toggle(door)) {
          hud.toast('Заколочено с той стороны', 1200);
          if (at) sfx.doorStuck(at);
        } else if (at) sfx.door(at.style, !at.open, at, at.creaky, at.pitch);
        this.player.busy = false;
        return;
      }
      if (!ref) hud.toast('Здесь нечего обыскивать', 900);
      else if (this.containers.isOpened(ref)) {
        sfx.containerOpen(CONTAINER_SOUND[ref.type] ?? 'shelf', spot(ref));
        this.panel.open(ref);
      } else {
        // Open it and start rummaging.
        const kind = CONTAINER_SOUND[ref.type] ?? 'shelf';
        sfx.containerOpen(kind, spot(ref));
        sfx.searching(kind, spot(ref));
        this.searchT = 0;
        this.ctx.events.emit('ui:busy', { busy: true });
        this.searchTime = SEARCH_TIME * this.searchMul * (ref.type === 'trunk' ? this.carMul : 1);
        this.searchRef = ref;
      }
    }
    this.player.busy = this.searchT >= 0;
  }

  /** Context prompt at ~10 Hz. */
  render(dt: number): void {
    this.promptT -= dt;
    if (this.promptT > 0) return;
    this.promptT = PROMPT_INTERVAL;
    if (this.searchT >= 0 || this.panel.isOpen) {
      this.ctx.hud.setPrompt(null);
      return;
    }
    const key = this.ctx.input.mode === 'kbm' ? 'E — ' : '';
    const ref = this.target();
    const door = this.doorTarget();
    if (door && (!ref || this.doorCloser(door, ref))) {
      const state = this.doors.describe(door);
      this.ctx.hud.setPrompt(state === 'barricaded' ? 'Дверь заколочена' : `${key}${state === 'open' ? 'Закрыть' : 'Открыть'} дверь`);
      return;
    }
    if (!ref) {
      this.ctx.hud.setPrompt(null);
      return;
    }
    const verb = this.containers.isOpened(ref) ? 'Открыть' : 'Обыскать';
    this.ctx.hud.setPrompt(`${key}${verb}: ${this.containers.name(ref)}`);
  }

  private target(): ContainerRef | null {
    const c = this.player.controller;
    return this.containers.target(c.position.x, c.position.z, -Math.sin(c.yaw), -Math.cos(c.yaw), c.position.y);
  }

  private doorTarget(): DoorRef | null {
    const c = this.player.controller;
    return this.doors.target(c.position.x, c.position.z, c.position.y, -Math.sin(c.yaw), -Math.cos(c.yaw));
  }

  /** Doors win when the player stands closer to them than to the container. */
  private doorCloser(_door: DoorRef, ref: ContainerRef): boolean {
    const c = this.player.controller;
    return Math.hypot(ref.x - c.position.x, ref.z - c.position.z) > 1.2;
  }

  private cancelSearch(notify: boolean): void {
    if (this.searchT < 0) return;
    sfx.searching(null);
    this.searchT = -1;
    this.ctx.events.emit('ui:busy', { busy: false });
    this.searchRef = null;
    if (notify) this.ctx.hud.toast('Прервано', 900);
    else this.ctx.hud.hideAction();
  }

  /** Hotkey 1: the best weapon in the backpack (or the last one put away). */
  private drawWeapon(): void {
    const inv = this.inventory;
    if (inv.hand) return;
    const best = (this.lastWeapon && inv.count(this.lastWeapon) > 0 ? this.lastWeapon : null) ?? WEAPON_PRIORITY.find((id) => inv.count(id) > 0);
    if (!best) {
      this.ctx.hud.toast('Нечем вооружиться', 900);
      return;
    }
    inv.equip(best);
    this.syncBody();
  }

  private putAway(): void {
    const inv = this.inventory;
    if (!inv.hand) return;
    const held = inv.hand;
    if (!inv.holster()) {
      this.ctx.hud.toast('Рюкзак переполнен', 900);
      return;
    }
    this.lastWeapon = held;
    this.syncBody();
  }
}
