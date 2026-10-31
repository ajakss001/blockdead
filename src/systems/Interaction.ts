import { CONTAINER_SOUND, sfx } from '../audio/Sound';
import type { ItemId } from '../data/items';
import type { GameContext } from '../GameContext';
import type { Player } from '../player/Player';
import type { InventoryPanel } from '../ui/InventoryPanel';
import { type DoorRef, type Doors, MAX_PLANKS } from '../world/Doors';

/** Locks on POI doors: the key that opens it, the note with its code (both found nearby). */
const LOCKS: Record<string, { key: ItemId; code: ItemId; name: string; digits: string }> = {
  armory: { key: 'armoryKey', code: 'armoryNote', name: 'от оружейной', digits: '4-7-1-9' },
};

/** Boarding a door up: a board and four nails, seconds of hammering; prying one off. */
const NAILS_PER_PLANK = 4;
const NAIL_TIME = 4;
const PRY_TIME = 3;
import type { ContainerRef, Containers } from './Containers';
import type { Inventory } from './Inventory';
import { Vector3 } from 'three';

const _o = new Vector3();
const _d = new Vector3();

/** Sound position of a container: its front, at about hand height. */
const spot = (ref: ContainerRef) => ({ x: ref.x, y: ref.y + 0.8, z: ref.z });

/** First search of a container takes time and leaves you exposed (Zomboid); reopening is instant. */
const SEARCH_TIME = 2;
/** How far the crosshair reaches a search zone (m). */
const REACH = 2;
const PROMPT_INTERVAL = 0.1;
/** Hotkey 1 draws the first of these that is in the backpack. */
const WEAPON_PRIORITY: ItemId[] = ['axe', 'crowbar', 'bat', 'knife', 'hammer'];

/**
 * "Use" and "inventory" actions: find the container the player faces, run the timed search,
 * open the inventory screen; also weapon hotkeys and the context prompt under the crosshair.
 */
export class Interaction {
  private searchT = -1;
  /** E held on a door (−1 = not): a tap opens/closes, holding starts boarding it up / prying a board off. */
  private holdT = -1;
  private holdDoor: DoorRef | null = null;
  /** Boarding (or prying) in progress: seconds, the door, which. */
  private boardT = -1;
  private boardDoor: DoorRef | null = null;
  private boardPry = false;
  private boardKnock = 0;
  private searchRef: ContainerRef | null = null;
  private promptT = 0;
  private lastWeapon: ItemId | null = null;
  private searchTime = SEARCH_TIME;
  /**
   * The crosshair: eye and view direction, and whether anything solid stands within t of the eye along it
   * (set by the scene; without it the old "faced and near" rule is used).
   */
  aim: { eye(out: Vector3): Vector3; dir(out: Vector3): Vector3; blocked(o: Vector3, d: Vector3, t: number): boolean } | null = null;
  /** The container under the crosshair (refreshed with the prompt): the scene outlines it. */
  focus: ContainerRef | null = null;
  private targeting = false;
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
    if (this.updateBoarding(dt, use)) return;
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
        // Hammer, boards and nails at hand (or boards to pry off): wait — a tap opens, a hold boards up.
        if (this.canNail(door) || this.canPry(door)) {
          this.holdT = 0;
          this.holdDoor = door;
          return;
        }
        this.toggleDoor(door);
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
      this.focus = null;
      return;
    }
    const key = this.ctx.input.mode === 'kbm' ? 'E — ' : '';
    const ref = this.target();
    const door = this.doorTarget();
    this.focus = ref && !(door && this.doorCloser(door, ref)) ? ref : null;
    this.setTargeting(!!ref || !!door);
    if (door && (!ref || this.doorCloser(door, ref))) {
      const state = this.doors.describe(door);
      const hold = this.ctx.input.mode === 'kbm' ? 'держать E' : 'удерживать';
      if (state === 'boarded') this.ctx.hud.setPrompt(`Заколочено досками: ${this.doors.planksOn(door)}/${MAX_PLANKS}${this.canPry(door) ? ` · ${hold} — оторвать доску` : ''}`);
      else if (state === 'barricaded') this.ctx.hud.setPrompt('Дверь заколочена');
      else if (state === 'locked') this.ctx.hud.setPrompt(`${key}Заперто — открыть ключом или кодом`);
      else this.ctx.hud.setPrompt(`${key}${state === 'open' ? 'Закрыть' : 'Открыть'} дверь${this.canNail(door) ? ` · ${hold} — заколотить` : ''}`);
      return;
    }
    if (!ref) {
      this.ctx.hud.setPrompt(null);
      return;
    }
    const verb = this.containers.isOpened(ref) ? 'Открыть' : 'Обыскать';
    this.ctx.hud.setPrompt(`${key}${verb}: ${this.containers.name(ref)}`);
  }

  private toggleDoor(door: DoorRef): void {
    const at = this.doors.info(door);
    const lock = this.doors.lockOf(door);
    if (lock) {
      const l = LOCKS[lock];
      const by = l && (this.inventory.count(l.key) > 0 ? 'key' : this.inventory.count(l.code) > 0 ? 'code' : null);
      if (!l || !by) {
        this.ctx.hud.toast(l ? `Заперто. Нужен ключ ${l.name} или код` : 'Заперто', 1600);
        if (at) sfx.doorStuck(at);
        this.player.busy = false;
        return;
      }
      this.doors.unlock(door);
      this.ctx.hud.toast(by === 'key' ? 'Ключ подошёл' : `Код набран: ${l.digits}`, 1600);
    }
    const state = this.doors.describe(door);
    if (!this.doors.toggle(door)) {
      this.ctx.hud.toast(state === 'boarded' ? 'Заколочено досками' : 'Заколочено с той стороны', 1200);
      if (at) sfx.doorStuck(at);
    } else if (at) sfx.door(at.style, !at.open, at, at.creaky, at.pitch);
    this.player.busy = false;
  }

  /** A hammer (in hand or in the bag), a board and four nails — and a closed door that takes one more. */
  private canNail(door: DoorRef): boolean {
    const inv = this.inventory;
    const state = this.doors.describe(door);
    return (state === 'closed' || (state === 'boarded' && this.doors.planksOn(door) < MAX_PLANKS)) && (inv.hand === 'hammer' || inv.count('hammer') > 0) && inv.count('planks') > 0 && inv.count('nails') >= NAILS_PER_PLANK;
  }

  /** Boards on it and something to pry them with (a hammer's claw, a crowbar). */
  private canPry(door: DoorRef): boolean {
    const inv = this.inventory;
    const tool = inv.hand === 'hammer' || inv.hand === 'crowbar' || inv.count('hammer') > 0 || inv.count('crowbar') > 0;
    return tool && this.doors.planksOn(door) > 0 && !this.canNail(door);
  }

  /**
   * Holding E on a door, then boarding it up / prying a board off: a progress bar, loud hammering (it
   * carries — zombies hear it), interrupted by moving or attacking. Returns true while it owns the step.
   */
  private updateBoarding(dt: number, pressed: boolean): boolean {
    const { input, hud } = this.ctx;
    if (this.holdT >= 0 && this.holdDoor) {
      if (input.isHeld('use') && !pressed) {
        this.holdT += dt;
        if (this.holdT < 0.45) return true;
        this.boardPry = !this.canNail(this.holdDoor);
        this.boardDoor = this.holdDoor;
        this.boardT = 0;
        this.boardKnock = 0;
        this.holdT = -1;
        this.ctx.events.emit('ui:busy', { busy: true });
        this.player.busy = true;
        return true;
      }
      // Let go early: a plain open / close.
      const door = this.holdDoor;
      this.holdT = -1;
      this.holdDoor = null;
      this.toggleDoor(door);
      return true;
    }
    if (this.boardT < 0 || !this.boardDoor) return false;
    const door = this.boardDoor;
    const stop = (msg: string | null) => {
      this.boardT = -1;
      this.boardDoor = null;
      this.player.busy = false;
      this.ctx.events.emit('ui:busy', { busy: false });
      if (msg) hud.toast(msg, 1100);
      else hud.hideAction();
    };
    if (this.player.controller.speed > 0.4 || input.isHeld('attack')) {
      stop('Прервано');
      return true;
    }
    const time = this.boardPry ? PRY_TIME : NAIL_TIME;
    this.boardT += dt;
    hud.showAction(this.boardPry ? 'Отдираю доску' : 'Заколачиваю дверь', this.boardT / time);
    // Hammer blows: loud.
    this.boardKnock -= dt;
    const at = this.doors.info(door);
    if (this.boardKnock <= 0 && at) {
      this.boardKnock = this.boardPry ? 0.7 : 0.45;
      sfx.hit('wood', at, 1);
      this.player.controller.addNoise(0.75);
    }
    if (this.boardT >= time) {
      if (this.boardPry) {
        if (this.doors.removePlank(door)) this.inventory.add('planks', 1);
        stop(null);
      } else if (this.canNail(door)) {
        const c = this.player.controller.position;
        this.inventory.remove('planks', 1);
        this.inventory.remove('nails', NAILS_PER_PLANK);
        this.doors.addPlank(door, c.x, c.z);
        stop(null);
        hud.toast(`Доска прибита: ${this.doors.planksOn(door)}/${MAX_PLANKS}`, 1100);
      } else stop('Нечем заколотить');
    }
    return true;
  }

  /** Only what the crosshair is on: the ray from the eye hits its search zone within reach, nothing in front. */
  private target(): ContainerRef | null {
    const aim = this.aim;
    if (!aim) {
      const c = this.player.controller;
      return this.containers.target(c.position.x, c.position.z, -Math.sin(c.yaw), -Math.cos(c.yaw), c.position.y);
    }
    const o = aim.eye(_o);
    const d = aim.dir(_d);
    return this.containers.targetRay(o.x, o.y, o.z, d.x, d.y, d.z, REACH, (t) => !aim.blocked(o, d, t));
  }

  /** Tell the touch controls whether there is something to use (only when it changes). */
  private setTargeting(on: boolean): void {
    if (on === this.targeting) return;
    this.targeting = on;
    this.ctx.events.emit('ui:target', { target: on });
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
