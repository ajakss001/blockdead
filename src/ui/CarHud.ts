import { onLangChange, tr } from '../core/i18n';
import type { GameContext } from '../GameContext';
import type { Inventory } from '../systems/Inventory';
import { type CarState, vehicleName, type Vehicles } from '../systems/Vehicles';
import { itemIcon } from './pixelart';

function statusClass(v: number, warn = 0.55, crit = 0.25): string {
  if (v <= crit) return 'crit';
  if (v <= warn) return 'warn';
  return 'ok';
}

/**
 * Project Zomboid-style Car Dashboard HUD (bottom-center while driving)
 * + Interactive Vehicle Mechanics & Maintenance Modal (opened under the hood or via [R] / dashboard).
 */
export class CarHud {
  private readonly dash: HTMLDivElement;
  private readonly speedVal: HTMLSpanElement;
  private readonly speedUnit: HTMLSpanElement;
  private readonly gearBadge: HTMLSpanElement;
  private readonly titleEl: HTMLDivElement;
  private readonly fuelFill: HTMLDivElement;
  private readonly fuelPct: HTMLSpanElement;
  private readonly indEngine: HTMLButtonElement;
  private readonly indBattery: HTMLButtonElement;
  private readonly indTires: HTMLButtonElement;
  private readonly indLights: HTMLButtonElement;
  private readonly btnKey: HTMLButtonElement;
  private readonly btnHotwire: HTMLButtonElement;
  private readonly btnHorn: HTMLButtonElement;
  private readonly btnMech: HTMLButtonElement;
  private readonly btnExit: HTMLButtonElement;

  private readonly modal: HTMLDivElement;
  private inspectedCar: CarState | null = null;
  private readonly unsubs: (() => void)[] = [];

  constructor(
    private readonly ctx: GameContext,
    private readonly vehicles: Vehicles,
    private readonly inventory: Inventory,
    private readonly onExitRequest: () => void,
    private readonly onSave: () => void,
    root: HTMLElement,
  ) {
    // 1. Dashboard at the bottom of the screen
    this.dash = document.createElement('div');
    this.dash.className = 'car-dash';
    this.dash.hidden = true;

    this.dash.innerHTML = `
      <div class="car-dash__top">
        <div class="car-dash__title"></div>
        <div class="car-dash__actions">
          <button type="button" class="car-dash__btn" data-act="key"></button>
          <button type="button" class="car-dash__btn car-dash__btn--warn" data-act="hotwire"></button>
          <button type="button" class="car-dash__btn" data-act="horn"></button>
          <button type="button" class="car-dash__btn" data-act="mech"></button>
          <button type="button" class="car-dash__btn car-dash__btn--exit" data-act="exit"></button>
        </div>
      </div>
      <div class="car-dash__main">
        <div class="car-dash__speed">
          <span class="car-dash__gear">P</span>
          <span class="car-dash__kmh">00</span>
          <span class="car-dash__unit">км/ч</span>
        </div>
        <div class="car-dash__fuel">
          <div class="car-dash__fuel-head">
            <span class="car-dash__fuel-label"></span>
            <span class="car-dash__fuel-pct">0%</span>
          </div>
          <div class="car-dash__fuel-track"><div class="car-dash__fuel-fill"></div></div>
        </div>
        <div class="car-dash__lamps">
          <button type="button" class="car-dash__lamp" data-lamp="engine"></button>
          <button type="button" class="car-dash__lamp" data-lamp="battery"></button>
          <button type="button" class="car-dash__lamp" data-lamp="tires"></button>
          <button type="button" class="car-dash__lamp" data-lamp="lights"></button>
        </div>
      </div>
    `;

    this.titleEl = this.dash.querySelector('.car-dash__title')!;
    this.gearBadge = this.dash.querySelector('.car-dash__gear')!;
    this.speedVal = this.dash.querySelector('.car-dash__kmh')!;
    this.speedUnit = this.dash.querySelector('.car-dash__unit')!;
    this.fuelFill = this.dash.querySelector('.car-dash__fuel-fill')!;
    this.fuelPct = this.dash.querySelector('.car-dash__fuel-pct')!;
    this.indEngine = this.dash.querySelector('[data-lamp="engine"]')!;
    this.indBattery = this.dash.querySelector('[data-lamp="battery"]')!;
    this.indTires = this.dash.querySelector('[data-lamp="tires"]')!;
    this.indLights = this.dash.querySelector('[data-lamp="lights"]')!;

    this.btnKey = this.dash.querySelector('[data-act="key"]')!;
    this.btnHotwire = this.dash.querySelector('[data-act="hotwire"]')!;
    this.btnHorn = this.dash.querySelector('[data-act="horn"]')!;
    this.btnMech = this.dash.querySelector('[data-act="mech"]')!;
    this.btnExit = this.dash.querySelector('[data-act="exit"]')!;

    this.btnKey.addEventListener('click', () => this.vehicles.toggleIgnition());
    this.btnHotwire.addEventListener('click', () => {
      if (this.vehicles.hotwireActiveCar()) this.onSave();
    });
    this.btnHorn.addEventListener('click', () => this.vehicles.honkHorn());
    this.btnMech.addEventListener('click', () => {
      if (this.vehicles.activeCar) this.openMechanics(this.vehicles.activeCar);
    });
    this.btnExit.addEventListener('click', () => this.onExitRequest());

    this.indEngine.addEventListener('click', () => this.vehicles.activeCar && this.openMechanics(this.vehicles.activeCar));
    this.indBattery.addEventListener('click', () => this.vehicles.activeCar && this.openMechanics(this.vehicles.activeCar));
    this.indTires.addEventListener('click', () => this.vehicles.activeCar && this.openMechanics(this.vehicles.activeCar));
    this.indLights.addEventListener('click', () => this.vehicles.toggleLights());

    // 2. Project Zomboid-style Vehicle Mechanics Modal
    this.modal = document.createElement('div');
    this.modal.className = 'car-mech';
    this.modal.hidden = true;
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeMechanics();
    });

    root.append(this.dash, this.modal);

    const onKey = (e: KeyboardEvent) => {
      if (!this.modal.hidden) {
        if (e.code === 'Escape' || e.code === 'KeyE' || e.code === 'KeyR') {
          e.preventDefault();
          e.stopPropagation();
          this.closeMechanics(e.code === 'Escape');
        }
        return;
      }
      if (!this.vehicles.activeCar) return;
      if (e.repeat) return;
      if (e.code === 'KeyI') {
        this.vehicles.toggleIgnition();
      } else if (e.code === 'KeyK') {
        if (this.vehicles.hotwireActiveCar()) this.onSave();
      } else if (e.code === 'KeyH') {
        this.vehicles.honkHorn();
      } else if (e.code === 'KeyR') {
        this.openMechanics(this.vehicles.activeCar);
      }
    };
    window.addEventListener('keydown', onKey);
    this.unsubs.push(
      () => window.removeEventListener('keydown', onKey),
      onLangChange(() => {
        if (!this.modal.hidden && this.inspectedCar) this.renderMechanics(this.inspectedCar);
      }),
    );
  }

  get isOpen(): boolean {
    return !this.modal.hidden;
  }

  openMechanics(car: CarState): void {
    this.inspectedCar = car;
    this.modal.hidden = false;
    this.ctx.loop.pause('inventory');
    this.ctx.events.emit('ui:modal', { open: true });
    if (document.pointerLockElement) document.exitPointerLock();
    this.renderMechanics(car);
  }

  closeMechanics(viaEsc = false): void {
    if (this.modal.hidden) return;
    this.modal.hidden = true;
    this.inspectedCar = null;
    this.ctx.loop.resume('inventory');
    this.ctx.events.emit('ui:modal', { open: false });
    void viaEsc;
    this.ctx.requestPointerLock();
    this.onSave();
  }

  private renderMechanics(car: CarState): void {
    const inv = this.inventory;
    const hasWrench = inv.count('wrench') > 0 || inv.hand === 'wrench';
    const jerrycans = inv.count('jerrycan');
    const batteries = inv.count('carBattery');
    const engineParts = inv.count('engineParts');
    const tires = inv.count('carTire');
    const keys = inv.count('carKey');

    const pct = (v: number) => `${Math.round(v * 100)}%`;

    const rows: {
      part: 'fuel' | 'battery' | 'engine' | 'tires';
      icon: string;
      name: string;
      val: number;
      desc: string;
      req: string;
      canAct: boolean;
      btnLabel: string;
    }[] = [
      {
        part: 'engine',
        icon: itemIcon('engineParts'),
        name: tr('Двигатель', 'Engine'),
        val: car.engine,
        desc:
          car.engine < 0.2
            ? tr('Критический износ: глохнет и дымит', 'Critical wear: stalls and smokes')
            : car.engine < 0.45
              ? tr('Повреждён: снижена мощность, идёт дым', 'Damaged: reduced power, smoking')
              : tr('Исправен, держит обороты', 'Good condition, runs smoothly'),
        req: `${tr('Запчасти двигателя', 'Engine parts')}: ${engineParts} · ${tr('Гаечный ключ', 'Wrench')}: ${hasWrench ? '✓' : '✗'}`,
        canAct: car.engine < 0.99 && engineParts > 0 && hasWrench,
        btnLabel: tr('Ремонт (+35%)', 'Repair (+35%)'),
      },
      {
        part: 'battery',
        icon: itemIcon('carBattery'),
        name: tr('Аккумулятор', 'Battery'),
        val: car.battery,
        desc:
          car.battery < 0.1
            ? tr('Разряжен: стартер и фары не работают', 'Dead: starter & headlights offline')
            : tr('Питает стартер и фары, заряжается на ходу', 'Powers starter & headlights, charges while driving'),
        req: `${tr('Аккумулятор в рюкзаке', 'Car battery in bag')}: ${batteries}`,
        canAct: car.battery < 0.99 && batteries > 0,
        btnLabel: tr('Заменить (100%)', 'Replace (100%)'),
      },
      {
        part: 'fuel',
        icon: itemIcon('jerrycan'),
        name: tr('Бензобак', 'Fuel Tank'),
        val: car.fuel,
        desc:
          car.fuel <= 0.01
            ? tr('Пуст — двигатель не заведётся', 'Empty — engine cannot run')
            : tr('Запас топлива для поездки', 'Available fuel in tank'),
        req: `${tr('Канистра с бензином', 'Jerrycan')}: ${jerrycans}`,
        canAct: car.fuel < 0.99 && jerrycans > 0,
        btnLabel: tr('Заправить (+55%)', 'Refuel (+55%)'),
      },
      {
        part: 'tires',
        icon: itemIcon('carTire'),
        name: tr('Шины и ходовая', 'Tires & Suspension'),
        val: car.tires,
        desc:
          car.tires < 0.18
            ? tr('Пробиты: машину уводит, скорость упала', 'Blown out: pulls sideways, low speed')
            : tr('Влияют на сцепление, повороты и макс. скорость', 'Affects grip, steering, and top speed'),
        req: `${tr('Автомобильная шина', 'Car tire')}: ${tires} · ${tr('Гаечный ключ', 'Wrench')}: ${hasWrench ? '✓' : '✗'}`,
        canAct: car.tires < 0.99 && tires > 0 && hasWrench,
        btnLabel: tr('Заменить (+50%)', 'Replace (+50%)'),
      },
    ];

    const keyStatus = car.hasKey
      ? tr('Ключ в замке зажигания', 'Key in ignition')
      : car.hotwired
        ? tr('Провода соединены напрямую (взломано)', 'Hotwired ignition')
        : tr('Замок заблокирован (нет ключа)', 'Ignition locked (no key)');

    this.modal.innerHTML = `
      <div class="car-mech__card">
        <div class="car-mech__header">
          <div>
            <div class="car-mech__sub">${tr('ТЕХНИЧЕСКОЕ СОСТОЯНИЕ // МЕХАНИКА', 'VEHICLE MECHANICS // MAINTENANCE')}</div>
            <div class="car-mech__title">${vehicleName(car.kind)}</div>
          </div>
          <button type="button" class="car-mech__close">${tr('Закрыть [Esc]', 'Close [Esc]')}</button>
        </div>
        <div class="car-mech__ignition">
          <img src="${itemIcon('carKey')}" alt="" class="car-mech__icon" />
          <div class="car-mech__ignition-text">
            <div class="car-mech__part-name">${tr('Замок зажигания', 'Ignition Switch')}</div>
            <div class="car-mech__part-desc">${keyStatus}</div>
          </div>
          ${
            !car.hasKey && !car.hotwired
              ? `<div class="car-mech__ignition-btns">
                  ${
                    keys > 0
                      ? `<button type="button" class="car-mech__btn" data-ign="key">${tr('Вставить ключ', 'Insert Key')}</button>`
                      : ''
                  }
                  <button type="button" class="car-mech__btn car-mech__btn--warn" data-ign="hotwire">${tr('Замкнуть провода', 'Hotwire Wires')}</button>
                </div>`
              : `<span class="car-mech__badge ok">✓</span>`
          }
        </div>
        <div class="car-mech__list">
          ${rows
            .map(
              (r) => `
            <div class="car-mech__row">
              <img src="${r.icon}" alt="" class="car-mech__icon" />
              <div class="car-mech__info">
                <div class="car-mech__row-top">
                  <span class="car-mech__part-name">${r.name}</span>
                  <span class="car-mech__pct ${statusClass(r.val)}">${pct(r.val)}</span>
                </div>
                <div class="car-mech__bar"><div class="car-mech__bar-fill ${statusClass(r.val)}" style="width:${Math.round(r.val * 100)}%"></div></div>
                <div class="car-mech__part-desc">${r.desc}</div>
                <div class="car-mech__part-req">${r.req}</div>
              </div>
              <button type="button" class="car-mech__btn" data-part="${r.part}" ${r.canAct ? '' : 'disabled'}>${r.btnLabel}</button>
            </div>
          `,
            )
            .join('')}
        </div>
      </div>
    `;

    this.modal.querySelector('.car-mech__close')?.addEventListener('click', () => this.closeMechanics());
    this.modal.querySelector('[data-ign="key"]')?.addEventListener('click', () => {
      if (this.inventory.count('carKey') > 0) {
        this.inventory.remove('carKey', 1);
        car.hasKey = true;
        this.ctx.hud.toast(tr('Ключ вставлен в замок зажигания', 'Key inserted into ignition'), 1800);
        this.renderMechanics(car);
      }
    });
    this.modal.querySelector('[data-ign="hotwire"]')?.addEventListener('click', () => {
      car.hotwired = true;
      this.ctx.hud.toast(tr('Провода зажигания соединены напрямую!', 'Ignition wires hotwired!'), 2000);
      this.renderMechanics(car);
    });

    for (const btn of this.modal.querySelectorAll<HTMLButtonElement>('[data-part]')) {
      btn.addEventListener('click', () => {
        const part = btn.dataset.part as 'fuel' | 'battery' | 'engine' | 'tires';
        const msg = this.vehicles.performRepair(car, part);
        if (msg) this.ctx.hud.toast(msg, 2000);
        this.renderMechanics(car);
      });
    }
  }

  update(): void {
    const car = this.vehicles.activeCar;
    if (!car) {
      if (!this.dash.hidden) this.dash.hidden = true;
      return;
    }
    if (this.dash.hidden) this.dash.hidden = false;

    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    this.titleEl.textContent = vehicleName(car.kind);
    this.speedVal.textContent = String(kmh).padStart(2, '0');
    this.speedUnit.textContent = tr('км/ч', 'km/h');
    this.gearBadge.textContent = !car.engineOn ? 'P' : car.speed < -0.3 ? 'R' : Math.abs(car.speed) < 0.2 ? 'N' : 'D';

    const fuelLabel = this.dash.querySelector('.car-dash__fuel-label')!;
    fuelLabel.textContent = tr('ТОПЛИВО', 'FUEL');
    const fPct = Math.round(car.fuel * 100);
    this.fuelPct.textContent = `${fPct}%`;
    this.fuelFill.style.width = `${fPct}%`;
    this.fuelFill.className = `car-dash__fuel-fill ${statusClass(car.fuel, 0.35, 0.12)}`;

    this.indEngine.textContent = `${tr('ДВИГ', 'ENG')} ${Math.round(car.engine * 100)}%`;
    this.indEngine.className = `car-dash__lamp ${statusClass(car.engine, 0.55, 0.25)}`;

    this.indBattery.textContent = `${tr('АКБ', 'BAT')} ${Math.round(car.battery * 100)}%`;
    this.indBattery.className = `car-dash__lamp ${statusClass(car.battery, 0.45, 0.18)}`;

    this.indTires.textContent = `${tr('ШИНЫ', 'TIRE')} ${Math.round(car.tires * 100)}%`;
    this.indTires.className = `car-dash__lamp ${statusClass(car.tires, 0.5, 0.2)}`;

    this.indLights.textContent = `${tr('ФАРЫ', 'LIGHTS')} [F]`;
    this.indLights.className = `car-dash__lamp ${car.lightsOn && car.battery > 0.02 ? 'lit' : 'off'}`;

    const unlocked = car.hasKey || car.hotwired;
    this.btnKey.textContent = car.engineOn
      ? tr('Заглушить [I]', 'Stop [I]')
      : tr('Завести [I]', 'Start [I]');
    this.btnKey.className = `car-dash__btn ${car.engineOn ? 'on' : ''}`;
    this.btnHotwire.hidden = unlocked;
    this.btnHotwire.textContent = tr('Взлом проводов [K]', 'Hotwire [K]');
    this.btnHorn.textContent = tr('Сигнал [H]', 'Horn [H]');
    this.btnMech.textContent = tr('Капот [R]', 'Hood [R]');
    this.btnExit.textContent = tr('Выйти [E]', 'Exit [E]');
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.dash.remove();
    this.modal.remove();
  }
}
