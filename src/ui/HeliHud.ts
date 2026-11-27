import { tr } from '../core/i18n';
import type { HeliHudSnapshot } from '../systems/Helicopter';

/**
 * Aviation dashboard HUD displayed while piloting the flyable Mi-8 EMERCOM helicopter.
 */
export class HeliHud {
  private readonly root = document.createElement('div');
  private readonly altEl: HTMLElement;
  private readonly spdEl: HTMLElement;
  private readonly vsiEl: HTMLElement;
  private readonly rpmEl: HTMLElement;
  private readonly fuelEl: HTMLElement;
  private readonly hullEl: HTMLElement;
  private readonly perimEl: HTMLElement;
  private readonly checkEl: HTMLElement;
  private readonly gaugesEl: HTMLElement;
  private readonly hintEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root.hidden = true;
    this.root.style.cssText =
      'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:25;background:rgba(12,16,14,0.86);border:1px solid #4c6252;border-radius:6px;padding:10px 16px;color:#d6e2d0;font:600 13px/1.35 system-ui,monospace;min-width:410px;pointer-events:none;box-shadow:0 4px 18px rgba(0,0,0,0.5)';
    this.root.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:18px;white-space:nowrap;margin-bottom:6px;color:#8cc898;font-size:12px;letter-spacing:0.6px">
        <span>МИ-8Т · ЭМЕРКОМ</span>
        <span data-h="perim"></span>
      </div>
      <div data-h="check" style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:6px;font-size:11.5px;padding:4px 8px;background:rgba(28,38,32,0.7);border-radius:4px"></div>
      <div data-h="gauges" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px 14px;margin-bottom:6px">
        <div>ALT: <strong data-h="alt">0</strong> m</div>
        <div>SPD: <strong data-h="spd">0</strong> km/h</div>
        <div>VSI: <strong data-h="vsi">0.0</strong> m/s</div>
        <div>RPM: <strong data-h="rpm">0</strong>%</div>
        <div>FUEL: <strong data-h="fuel">0</strong>%</div>
        <div>HULL: <strong data-h="hull">0</strong>%</div>
      </div>
      <div data-h="hint" style="font-size:11px;font-weight:400;color:#9da898;text-align:center"></div>
    `;
    this.altEl = this.root.querySelector('[data-h="alt"]')!;
    this.spdEl = this.root.querySelector('[data-h="spd"]')!;
    this.vsiEl = this.root.querySelector('[data-h="vsi"]')!;
    this.rpmEl = this.root.querySelector('[data-h="rpm"]')!;
    this.fuelEl = this.root.querySelector('[data-h="fuel"]')!;
    this.hullEl = this.root.querySelector('[data-h="hull"]')!;
    this.perimEl = this.root.querySelector('[data-h="perim"]')!;
    this.checkEl = this.root.querySelector('[data-h="check"]')!;
    this.gaugesEl = this.root.querySelector('[data-h="gauges"]')!;
    this.hintEl = this.root.querySelector('[data-h="hint"]')!;
    parent.appendChild(this.root);
  }

  update(snap: HeliHudSnapshot | null): void {
    // In 1st-person Mi-8 cockpit mode, all telemetry is rendered live on the 3D glass cockpit MFDs.
    if (!snap || (snap.piloting && !snap.chaseCam)) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.root.style.bottom = snap.piloting ? '18px' : '92px';
    this.gaugesEl.style.display = snap.piloting ? 'grid' : 'none';
    const item = (ok: boolean, label: string) =>
      `<span style="color:${ok ? '#7ae08e' : '#c87060'}">${ok ? '✓' : '○'} ${label}</span>`;
    this.checkEl.innerHTML = [
      item(snap.parts.avionics, tr('Авионика', 'Avionics')),
      item(snap.parts.fuelPump, tr('Насос ВД', 'Fuel Pump')),
      item(snap.parts.battery, tr('Борт-АКБ', 'Battery')),
      item(snap.fuel >= 0.2, `${tr('Топливо', 'Fuel')} ${Math.round(snap.fuel * 100)}%`),
    ].join('');
    this.altEl.textContent = snap.altitude.toFixed(1);
    this.spdEl.textContent = Math.round(snap.speedKmh).toString();
    this.vsiEl.textContent = (snap.vsi >= 0 ? '+' : '') + snap.vsi.toFixed(1);
    this.rpmEl.textContent = snap.rpmPct.toString();
    this.fuelEl.textContent = Math.round(snap.fuel * 100).toString();
    this.fuelEl.style.color = snap.fuel < 0.15 ? '#e06050' : '#d6e2d0';
    this.hullEl.textContent = Math.round(snap.hull * 100).toString();
    this.hullEl.style.color = snap.hull < 0.35 ? '#e0a040' : '#d6e2d0';
    this.perimEl.textContent = snap.piloting
      ? snap.distToPerimeter > 0
        ? tr(`До периметра: ${Math.round(snap.distToPerimeter)} м`, `Perimeter: ${Math.round(snap.distToPerimeter)} m`)
        : tr('ВЫ ЗА ПЕРИМЕТРОМ — НАБЕРИТЕ >25м!', 'OUTSIDE PERIMETER — CLIMB >25m!')
      : tr('ЧЕКЛИСТ КАБИНЫ', 'COCKPIT CHECKLIST');
    this.hintEl.textContent = snap.piloting
      ? tr('Space ↑ · Shift ↓ · WASD Полёт · Q/E Поворот · V Вид · F Выйти', 'Space ↑ · Shift ↓ · WASD Cyclic · Q/E Yaw · V Cam · F Exit')
      : tr('Подойдите с запчастями/канистрой [E] для ремонта и заправки', 'Approach with parts/jerrycan [E] to repair & refuel');
  }

  dispose(): void {
    this.root.remove();
  }
}
