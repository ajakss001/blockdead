import { CONTAINER_SOUND, sfx } from '../audio/Sound';
import { registerDataLocalizer, tr } from '../core/i18n';
import { XP } from './Skills';
import { type ItemId, ITEMS, NOTE_VARS } from '../data/items';
import type { GameContext } from '../GameContext';
import type { Player } from '../player/Player';
import type { InventoryPanel } from '../ui/InventoryPanel';
import { type DoorRef, type Doors, MAX_PLANKS } from '../world/Doors';
import { type GroundWeapon, type GroundWeapons, groundItem } from '../weapons/GroundWeapons';
import { TRIPWIRE_DISARM_S, type TripwireEntry, type Tripwires } from './Tripwires';

/**
 * Locks on POI doors. A key (or an access card) opens it; or a code — every note that holds a part of
 * it; an electronic one only while its building has power (the lab's generator), and then maybe a code too.
 */
interface Lock {
  key?: ItemId;
  code?: ItemId[];
  power?: boolean;
  /** What the prompt says while it holds. */
  prompt: string;
  /** Said when a key / card opens it. */
  keyName?: string;
  digits?: string;
}
const LOCKS: Record<string, Lock> = {
  armory: { key: 'armoryKey', code: ['armoryNote'], prompt: 'Заперто — открыть ключом или кодом', keyName: 'ключ от оружейной', digits: '4-7-1-9' },
  labGreen: { key: 'keycardGreen', prompt: 'Считыватель: нужен пропуск уровня 1', keyName: 'пропуск уровня 1' },
  labBlue: { key: 'keycardBlue', prompt: 'Считыватель: нужен пропуск уровня 2', keyName: 'пропуск уровня 2' },
  labPower: { power: true, prompt: 'Электронный замок — нет питания' },
  labIsolation: { power: true, code: ['labNote1', 'labNote2', 'labNote3', 'labNote4'], prompt: 'Изолятор: кодовый замок' },
};

const LOCK_TEXT: Readonly<Record<string, { prompt: [string, string]; keyName?: [string, string] }>> = {
  armory: {
    prompt: ['Заперто — открыть ключом или кодом', 'Locked — open with key or code'],
    keyName: ['ключ от оружейной', 'armory key'],
  },
  labGreen: {
    prompt: ['Считыватель: нужен пропуск уровня 1', 'Card reader: Level 1 keycard required'],
    keyName: ['пропуск уровня 1', 'Level 1 keycard'],
  },
  labBlue: {
    prompt: ['Считыватель: нужен пропуск уровня 2', 'Card reader: Level 2 keycard required'],
    keyName: ['пропуск уровня 2', 'Level 2 keycard'],
  },
  labPower: {
    prompt: ['Электронный замок — нет питания', 'Electronic lock — no power'],
  },
  labIsolation: {
    prompt: ['Изолятор: кодовый замок', 'Containment: keypad lock'],
  },
};

registerDataLocalizer((lang) => {
  const idx = lang === 'en' ? 1 : 0;
  for (const [k, t] of Object.entries(LOCK_TEXT)) {
    LOCKS[k].prompt = t.prompt[idx];
    if (t.keyName) LOCKS[k].keyName = t.keyName[idx];
  }
});
/** Fuses the lab's generator takes. */
const FUSES = 3;

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
  /** E held on a door (−1 = not): tap opens/closes, hold boards up / prys, crouch-hold stealth-peeks. */
  private holdT = -1;
  private holdDoor: DoorRef | null = null;
  private holdMode: 'board' | 'peek' | null = null;
  /** Disarming an explosive tripwire while crouched. */
  private disarmT = -1;
  private disarmWire: TripwireEntry | null = null;
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
  /** The lab's power: is it on where a point is, and start the generator there (the scene keeps it). */
  power: { on(x: number, z: number): boolean; start(x: number, z: number): void } | null = null;
  /** The container under the crosshair (refreshed with the prompt): the scene outlines it. */
  focus: ContainerRef | null = null;
  /** Weapons lying about (set by the scene): the one under the crosshair is picked up with E. */
  ground: GroundWeapons | null = null;
  private targeting = false;
  /** Class: search time multipliers (all containers, car trunks). */
  searchMul = 1;
  carMul = 1;
  /** Class and carpentry: boarding and prying time multiplier. */
  boardMul = 1;
  /** A kitchen tap in front (the scene finds it): is there one, does it run, drink from it. */
  /** Something in front that isn't a container (a tap, a bed, what the survivor built): its prompt (`act`: E does it). */
  spot: { here(): { text: string; act: boolean; run(): void } | null } | null = null;
  /** Optional check forbidding looting living NPC bodies while keeping static containers lootable. */
  canLoot: ((ref: ContainerRef) => boolean) | null = null;
  /** Optional check hiding bodyBandit focus when aiming at a living bandit. */
  aimingAtLivingNpc: ((o: Vector3, d: Vector3, reach: number) => boolean) | null = null;
  /** Experience for what was done here (the scene gives it to the skills). */
  onSkill: ((id: 'search' | 'carpentry', xp: number) => void) | null = null;
  /** Emits AI-audible noise when a door opens normally (~12 m) or stealth-peeks (~2 m). */
  onDoorNoise: ((x: number, y: number, z: number, radius: number) => void) | null = null;
  /** Deployed and enemy ambush explosive tripwires (for crouch disarming). */
  tripwires: Tripwires | null = null;

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
    // Quick slots 1–4: draw what is in the slot (the one in hand: put it away).
    for (let i = 0; i < 4; i++) if (input.consumePressed(`slot${i + 1}` as 'slot1')) this.quickSlot(i);
    // Touch: one button draws or puts away, whatever is in hand (a class can start armed).
    if (input.consumePressed('weapon')) {
      if (this.inventory.hand) this.putAway();
      else this.drawWeapon();
    }

    const use = input.consumePressed('use');
    const peek = input.consumePressed('peek');
    if (this.updateDisarm(dt)) return;
    if (this.updateBoarding(dt, use)) return;
    if (this.searchT >= 0) {
      if (this.player.controller.speed > 0.4 || input.isHeld('attack')) {
        this.cancelSearch(true);
      } else {
        this.searchT += dt;
        hud.showAction(`${tr('Обыск', 'Searching')}: ${this.containers.name(this.searchRef!)}`, this.searchT / this.searchTime);
        if (this.searchT >= this.searchTime) {
          const ref = this.searchRef!;
          this.onSkill?.('search', ref.type === 'trunk' ? XP.trunk : XP.search);
          this.searchT = -1;
          this.ctx.events.emit('ui:busy', { busy: false });
          this.searchRef = null;
          hud.hideAction();
          sfx.searching(null);
          this.panel.open(ref);
        }
      }
    } else if (peek) {
      const door = this.doorTarget();
      if (door) this.peekDoor(door);
    } else if (use) {
      const wire = this.disarmTarget();
      if (wire) {
        if (this.player.controller.crouched) {
          this.disarmWire = wire;
          this.disarmT = 0;
          this.ctx.events.emit('ui:busy', { busy: true });
          this.player.busy = true;
          return;
        }
        hud.toast(tr('Присядьте (C) и зажмите E чтобы обезвредить растяжку', 'Crouch (C) and hold E to disarm tripwire'), 1500);
        return;
      }
      const lying = this.groundTarget();
      if (lying) {
        this.pickUp(lying);
        return;
      }
      const door = this.doorTarget();
      const ref = this.target();
      if (door && (!ref || this.doorCloser(door, ref))) {
        if (this.canNail(door) || this.canPry(door)) {
          this.holdT = 0;
          this.holdDoor = door;
          this.holdMode = 'board';
          return;
        }
        if (this.player.controller.crouched) {
          this.holdT = 0;
          this.holdDoor = door;
          this.holdMode = 'peek';
          return;
        }
        this.toggleDoor(door);
        return;
      }
      const s = ref ? null : this.spot?.here();
      if (s) {
        if (s.act) s.run();
        else hud.toast(s.text, 1200);
      } else if (!ref) hud.toast(tr('Здесь нечего обыскивать', 'Nothing to search here'), 900);
      else if (this.canLoot && !this.canLoot(ref)) hud.toast(tr('Нельзя обыскать живого', 'Cannot loot living NPC'), 900);
      else if (ref.type === 'generator') this.startGenerator(ref);
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
      this.ground?.setFocus(null);
      return;
    }
    const key = this.ctx.input.mode === 'kbm' ? 'E — ' : '';
    const lying = this.groundTarget();
    this.ground?.setFocus(lying);
    if (lying) {
      this.focus = null;
      this.setTargeting(true);
      this.ctx.hud.setPrompt(`${key}${tr('Подобрать', 'Pick up')}: ${ITEMS[groundItem(lying.weapon)].name}`);
      return;
    }
    const wire = this.disarmTarget();
    if (wire) {
      this.focus = null;
      this.setTargeting(true);
      this.ctx.hud.setPrompt(
        this.player.controller.crouched
          ? tr('Зажать E (2 сек) — Обезвредить растяжку', 'Hold E (2s) — Disarm tripwire')
          : tr('Присядьте (C) и зажмите E — Обезвредить растяжку', 'Crouch (C) & hold E — Disarm tripwire'),
      );
      return;
    }
    const ref = this.target();
    const door = this.doorTarget();
    this.focus = ref && !(door && this.doorCloser(door, ref)) ? ref : null;
    this.setTargeting(!!ref || !!door);
    if (door && (!ref || this.doorCloser(door, ref))) {
      const state = this.doors.describe(door);
      const hold = this.ctx.input.mode === 'kbm' ? tr('держать E', 'hold E') : tr('удерживать', 'hold');
      const peekHint = this.ctx.input.mode === 'kbm' ? ` · Alt+E — ${tr('приоткрыть тихо', 'stealth peek')}` : '';
      if (state === 'boarded')
        this.ctx.hud.setPrompt(
          `${tr('Заколочено досками', 'Boarded up')}: ${this.doors.planksOn(door)}/${MAX_PLANKS}${this.canPry(door) ? ` · ${hold} — ${tr('оторвать доску', 'pry plank off')}` : ''}`,
        );
      else if (state === 'barricaded') this.ctx.hud.setPrompt(tr('Дверь заколочена', 'Door is barricaded'));
      else if (state === 'locked') this.ctx.hud.setPrompt(`${key}${this.lockPrompt(door)}`);
      else if (state === 'peek')
        this.ctx.hud.setPrompt(
          `${key}${tr('Распахнуть', 'Open wide')}${this.ctx.input.mode === 'kbm' ? ` · Alt+E — ${tr('тихо закрыть', 'close quietly')}` : ''}`,
        );
      else
        this.ctx.hud.setPrompt(
          `${key}${state === 'open' ? tr('Закрыть дверь', 'Close door') : tr('Открыть дверь', 'Open door')}${this.canNail(door) ? ` · ${hold} — ${tr('заколотить', 'board up')}` : peekHint}`,
        );
      return;
    }
    if (!ref) {
      const s = this.spot?.here();
      if (s?.act) this.setTargeting(true);
      this.ctx.hud.setPrompt(s ? `${s.act ? key : ''}${s.text}` : null);
      return;
    }
    if (ref.type === 'generator') {
      const on = this.power?.on(ref.x, ref.z);
      this.ctx.hud.setPrompt(
        on
          ? tr('Генератор работает', 'Generator is running')
          : `${key}${tr('Запустить генератор (предохранители', 'Start generator (fuses')} ${Math.min(FUSES, this.inventory.count('fuse'))}/${FUSES})`,
      );
      return;
    }
    const verb = this.containers.isOpened(ref) ? tr('Открыть', 'Open') : tr('Обыскать', 'Search');
    this.ctx.hud.setPrompt(`${key}${verb}: ${this.containers.name(ref)}`);
  }

  private toggleDoor(door: DoorRef): void {
    const at = this.doors.info(door);
    const lock = this.doors.lockOf(door);
    if (lock) {
      const l = LOCKS[lock];
      const inv = this.inventory;
      const powered = !!at && !!this.power?.on(at.x, at.z);
      const notes = l?.code ? l.code.filter((id) => inv.count(id) > 0).length : 0;
      let by: 'key' | 'code' | 'power' | null = null;
      if (l && (!l.power || powered)) {
        if (l.key && inv.count(l.key) > 0) by = 'key';
        else if (l.code && notes === l.code.length) by = 'code';
        else if (!l.key && !l.code) by = 'power';
      }
      if (!l || !by) {
        const msg = !l
          ? tr('Заперто', 'Locked')
          : l.power && !powered
            ? tr('Электронный замок мёртв: нет питания', 'Electronic lock is dead: no power')
            : l.code && !l.key
              ? tr(`Нужен код: известно цифр ${notes} из ${l.code.length}`, `Code required: ${notes} of ${l.code.length} digits known`)
              : `${tr('Заперто. Нужен', 'Locked. Need')} ${l.keyName ?? tr('ключ', 'key')}${l.code ? tr(' или код', ' or code') : ''}`;
        this.ctx.hud.toast(msg, 1800);
        if (at) sfx.doorStuck(at);
        this.player.busy = false;
        return;
      }
      this.doors.unlock(door);
      this.ctx.hud.toast(
        by === 'key'
          ? l.key?.startsWith('keycard')
            ? tr('Пропуск принят', 'Keycard accepted')
            : tr('Ключ подошёл', 'Key worked')
          : by === 'code'
            ? `${tr('Код набран', 'Code entered')}: ${lock === 'labIsolation' ? ['lab1', 'lab2', 'lab3', 'lab4'].map((k) => NOTE_VARS[k]).join('-') : l.digits}`
            : tr('Замок открыт', 'Lock opened'),
        1600,
      );
    }
    const state = this.doors.describe(door);
    if (!this.doors.toggle(door)) {
      this.ctx.hud.toast(state === 'boarded' ? tr('Заколочено досками', 'Boarded up') : tr('Заколочено с той стороны', 'Barricaded from the other side'), 1200);
      if (at) sfx.doorStuck(at);
    } else if (at) {
      const style: 'wood' | 'glass' | 'metal' =
        at.style === 'glass' ? 'glass' : at.style === 'lab' || at.y < 0.8 ? 'metal' : 'wood';
      sfx.door(style, !at.open, at, at.creaky, at.pitch, false);
      this.onDoorNoise?.(at.x, at.y, at.z, 12);
    }
    this.player.busy = false;
  }

  private peekDoor(door: DoorRef): void {
    const lock = this.doors.lockOf(door);
    if (lock) {
      this.toggleDoor(door);
      return;
    }
    const at = this.doors.info(door);
    const state = this.doors.describe(door);
    if (!this.doors.peekToggle(door)) {
      this.ctx.hud.toast(state === 'boarded' ? tr('Заколочено досками', 'Boarded up') : tr('Заколочено с той стороны', 'Barricaded from the other side'), 1200);
      if (at) sfx.doorStuck(at);
    } else if (at) {
      const style: 'wood' | 'glass' | 'metal' =
        at.style === 'glass' ? 'glass' : at.style === 'lab' || at.y < 0.8 ? 'metal' : 'wood';
      sfx.door(style, !at.peek, at, at.creaky, at.pitch, true);
      this.onDoorNoise?.(at.x, at.y, at.z, 2);
    }
    this.player.busy = false;
  }

  private disarmTarget(): TripwireEntry | null {
    if (!this.tripwires) return null;
    const c = this.player.controller;
    return this.tripwires.disarmTarget(c.position.x, c.position.y, c.position.z, -Math.sin(c.yaw), -Math.cos(c.yaw));
  }

  private updateDisarm(dt: number): boolean {
    if (this.disarmT < 0 || !this.disarmWire) return false;
    const { input, hud } = this.ctx;
    const stop = (msg: string | null) => {
      this.disarmT = -1;
      this.disarmWire = null;
      this.player.busy = false;
      this.ctx.events.emit('ui:busy', { busy: false });
      hud.hideAction();
      if (msg) hud.toast(msg, 1200);
    };
    if (!input.isHeld('use') || !this.player.controller.crouched || this.player.controller.speed > 0.45 || !this.disarmWire.armed) {
      stop(tr('Обезвреживание прервано', 'Disarm interrupted'));
      return true;
    }
    this.disarmT += dt;
    hud.showAction(tr('Обезвреживание растяжки', 'Disarming tripwire'), this.disarmT / TRIPWIRE_DISARM_S);
    if (this.disarmT >= TRIPWIRE_DISARM_S) {
      const ok = this.tripwires?.disarm(this.disarmWire.id);
      if (ok) {
        const added = this.inventory.add('tripwire', 1);
        sfx.item('pick');
        stop(added > 0 ? tr('Растяжка обезврежена (+1)', 'Tripwire disarmed (+1)') : tr('Растяжка обезврежена (рюкзак полон)', 'Tripwire disarmed (pack full)'));
      } else {
        stop(null);
      }
    }
    return true;
  }

  /** What a locked door's prompt says (an electronic lock tells whether it has power). */
  private lockPrompt(door: DoorRef): string {
    const l = LOCKS[this.doors.lockOf(door) ?? ''];
    if (!l) return tr('Заперто', 'Locked');
    const at = this.doors.info(door);
    if (l.power && at && this.power?.on(at.x, at.z)) return l.code ? `${l.prompt} — ${tr('набрать код', 'enter code')}` : tr('Замок открыт', 'Lock opened');
    return l.prompt;
  }

  /** The lab's generator: three fuses in, it starts — the lights, the electronic locks. */
  private startGenerator(ref: ContainerRef): void {
    const hud = this.ctx.hud;
    if (!this.power) return;
    if (this.power.on(ref.x, ref.z)) {
      hud.toast(tr('Генератор уже работает', 'Generator is already running'), 1200);
      return;
    }
    const have = this.inventory.count('fuse');
    if (have < FUSES) {
      hud.toast(tr(`Не хватает предохранителей: ${have} из ${FUSES}`, `Not enough fuses: ${have} of ${FUSES}`), 1600);
      sfx.containerOpen('locker', spot(ref));
      return;
    }
    this.inventory.remove('fuse', FUSES);
    this.syncBody();
    this.power.start(ref.x, ref.z);
    sfx.containerOpen('locker', spot(ref));
    hud.toast(tr('Генератор запущен: свет и электронные замки работают', 'Generator started: lights and electronic locks are online'), 2200);
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
        if (this.holdMode === 'peek') {
          if (this.holdT < 0.35) return true;
          const door = this.holdDoor;
          this.holdT = -1;
          this.holdDoor = null;
          this.holdMode = null;
          this.peekDoor(door);
          return true;
        }
        if (this.holdT < 0.45) return true;
        this.boardPry = !this.canNail(this.holdDoor);
        this.boardDoor = this.holdDoor;
        this.boardT = 0;
        this.boardKnock = 0;
        this.holdT = -1;
        this.holdMode = null;
        this.ctx.events.emit('ui:busy', { busy: true });
        this.player.busy = true;
        return true;
      }
      // Let go early: a plain open / close.
      const door = this.holdDoor;
      this.holdT = -1;
      this.holdDoor = null;
      this.holdMode = null;
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
      stop(tr('Прервано', 'Interrupted'));
      return true;
    }
    const time = (this.boardPry ? PRY_TIME : NAIL_TIME) * this.boardMul;
    this.boardT += dt;
    hud.showAction(this.boardPry ? tr('Отдираю доску', 'Prying plank off') : tr('Заколачиваю дверь', 'Boarding up door'), this.boardT / time);
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
        if (this.doors.removePlank(door)) {
          this.inventory.add('planks', 1);
          this.onSkill?.('carpentry', XP.pry);
        }
        stop(null);
      } else if (this.canNail(door)) {
        const c = this.player.controller.position;
        this.inventory.remove('planks', 1);
        this.inventory.remove('nails', NAILS_PER_PLANK);
        this.doors.addPlank(door, c.x, c.z);
        this.onSkill?.('carpentry', XP.nail);
        stop(null);
        hud.toast(`${tr('Доска прибита', 'Plank nailed')}: ${this.doors.planksOn(door)}/${MAX_PLANKS}`, 1100);
      } else stop(tr('Нечем заколотить', 'Nothing to board up with'));
    }
    return true;
  }

  /** Only what the crosshair is on: the ray from the eye hits its search zone within reach, nothing in front. */
  private target(): ContainerRef | null {
    const aim = this.aim;
    let ref: ContainerRef | null;
    if (!aim) {
      const c = this.player.controller;
      ref = this.containers.target(c.position.x, c.position.z, -Math.sin(c.yaw), -Math.cos(c.yaw), c.position.y);
    } else {
      const o = aim.eye(_o);
      const d = aim.dir(_d);
      ref = this.containers.targetRay(o.x, o.y, o.z, d.x, d.y, d.z, REACH, (t) => !aim.blocked(o, d, t));
      if (ref?.type === 'bodyBandit' && this.aimingAtLivingNpc?.(o, d, REACH)) return null;
    }
    if (ref && this.canLoot && !this.canLoot(ref)) return null;
    return ref;
  }

  /** The weapon lying under the crosshair within reach, nothing solid in between. */
  private groundTarget(): GroundWeapon | null {
    const aim = this.aim;
    if (!this.ground || !aim) return null;
    const o = aim.eye(_o);
    const d = aim.dir(_d);
    return this.ground.target(o, d, REACH, (t) => !aim.blocked(o, d, t));
  }

  /** Into the empty hand, else into the bag (if it is not too heavy). */
  private pickUp(w: GroundWeapon): void {
    const inv = this.inventory;
    const item = groundItem(w.weapon);
    if (!inv.hand && ITEMS[item].equip) {
      inv.hand = item;
      inv.handWear = 0;
      inv.version++;
      this.syncBody();
      sfx.item('weapon');
    } else if (inv.add(item, 1) === 0) {
      this.ctx.hud.toast(tr('Слишком тяжело', 'Too heavy'), 900);
      return;
    } else {
      sfx.item('pick');
    }
    this.ground!.take(w);
    this.ctx.hud.toast(`${tr('Подобрано', 'Picked up')}: ${ITEMS[item].name}`, 1200);
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
    if (notify) this.ctx.hud.toast(tr('Прервано', 'Interrupted'), 900);
    else this.ctx.hud.hideAction();
  }

  /** Hotkey 1: the best weapon in the backpack (or the last one put away). */
  private drawWeapon(): void {
    const inv = this.inventory;
    if (inv.hand) return;
    const best = (this.lastWeapon && inv.count(this.lastWeapon) > 0 ? this.lastWeapon : null) ?? WEAPON_PRIORITY.find((id) => inv.count(id) > 0);
    if (!best) {
      this.ctx.hud.toast(tr('Нечем вооружиться', 'No weapon to equip'), 900);
      return;
    }
    inv.equip(best);
    sfx.item('weapon');
    this.syncBody();
  }

  private quickSlot(i: number): void {
    const inv = this.inventory;
    const id = inv.quick[i];
    if (!id || !inv.has(id)) {
      this.ctx.hud.toast(tr(`Слот ${i + 1} пуст`, `Slot ${i + 1} is empty`), 800);
      return;
    }
    if (inv.hand === id) {
      this.putAway();
      return;
    }
    if (!inv.equip(id)) {
      this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'), 900);
      return;
    }
    sfx.item('weapon');
    this.syncBody();
  }

  private putAway(): void {
    const inv = this.inventory;
    if (!inv.hand) return;
    const held = inv.hand;
    if (!inv.holster()) {
      this.ctx.hud.toast(tr('Рюкзак переполнен', 'Backpack is full'), 900);
      return;
    }
    this.lastWeapon = held;
    sfx.item('weapon');
    this.syncBody();
  }
}
