import { getLang, tr } from '../core/i18n';
import type { InputManager } from '../input/InputManager';
import type { GunHudState } from '../systems/Firearms';
import { type ItemId, ITEMS } from '../data/items';
import { isCustomItemIcon, itemIcon } from './pixelart';
import { GUNS } from '../weapons/guns';

/**
 * The gun's HUD: rounds (in the magazine + chamber / in the pack), the fire mode and the name — it fades
 * 3 s after the last shot or aim, the count goes rust when few are left, «Перезарядка (R)» when empty.
 * One canvas over the view draws the dynamic crosshair (its gap is the gun's real spread; a circle for
 * the shotgun, nothing for the RPG, hidden in the sights), the hit marker (white; a headshot heavier and
 * crossed), the noise wave of a shot, where a hurt came from, and the reload ring. Quick slots 1–4 sit
 * at the bottom (tap on a phone). On touch the fire button shows the count; reload and aim buttons show
 * only with a gun. Muted colours, nothing bright.
 */

export interface GunHudFrame {
  gun: GunHudState | null;
  /** Vertical field of view, deg (the crosshair's gap from the spread). */
  fov: number;
  /** Seconds since the last shot / aim. */
  sinceUse: number;
  hitMark: 'body' | 'head' | null;
  hitMarkT: number;
  /** The last shot's noise radius, m (the wave), and its age. */
  noise: number;
  /** Direction of the last hurt relative to the view (radians, 0 = ahead, + to the right), its age; null = none. */
  hurtAngle: number | null;
  hurtT: number;
  quick: readonly (ItemId | null)[];
  hand: ItemId | null;
  touch: boolean;
  inVehicle?: boolean;
}

const WHITE = 'rgba(214,212,202,';

function magCheckStatus(magTotal: number, capacity: number): string {
  if (magTotal <= 0) return tr('Пуст', 'Empty');
  const cap = Math.max(1, capacity);
  if (magTotal >= cap) return tr('Полон', 'Full');
  const ratio = magTotal / cap;
  if (ratio >= 0.75) return tr('Почти полон', 'Almost full');
  if (ratio >= 0.4) return tr('Около половины', 'About half');
  if (ratio >= 0.15) return tr('Меньше половины', 'Less than half');
  return tr('Почти пуст', 'Almost empty');
}

function magCheckMode(gun: GunHudState): string {
  const g = GUNS[gun.id];
  const raw = gun.mode.toUpperCase();
  if (raw.includes('АВТО') || raw.includes('AUTO')) return tr('АВТО', 'AUTO');
  if (raw.includes('ОДИН') || raw.includes('SEMI')) return tr('ОДИН.', 'SEMI');
  if (raw.includes('ПОМП') || raw.includes('PUMP')) return tr('ПОМПА', 'PUMP');
  if (raw.includes('ЗАТВОР') || raw.includes('БОЛТ') || raw.includes('BOLT')) return tr('БОЛТ', 'BOLT');
  if (g.action === 'pump') return tr('ПОМПА', 'PUMP');
  if (g.action === 'bolt') return tr('БОЛТ', 'BOLT');
  if (g.action === 'auto') return tr('ОДИН.', 'SEMI');
  return raw;
}

export class GunHud {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly panel = document.createElement('div');
  private readonly icon = document.createElement('img');
  private readonly name = document.createElement('div');
  private readonly count = document.createElement('div');
  private readonly mode = document.createElement('div');
  private readonly reload = document.createElement('div');
  private readonly magPopup = document.createElement('div');
  private readonly magStatus = document.createElement('span');
  private readonly magMode = document.createElement('div');
  private readonly textWrap = document.createElement('div');
  private readonly slots = document.createElement('div');
  private readonly slotEls: HTMLButtonElement[] = [];
  private readonly dot: HTMLElement | null;
  private magKey = '';
  private slotKey = '';
  private noiseAge = 9;
  private lastNoise = 0;

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
  ) {
    this.canvas.className = 'gunhud__canvas';
    this.g = this.canvas.getContext('2d')!;
    this.panel.className = 'gunhud';
    this.panel.hidden = true;
    this.name.className = 'gunhud__name';
    this.count.className = 'gunhud__count';
    this.mode.className = 'gunhud__mode';
    this.reload.className = 'gunhud__reload';
    this.reload.hidden = true;
    this.icon.className = 'gunhud__icon';
    this.icon.alt = '';
    this.textWrap.className = 'gunhud__text';
    this.textWrap.append(this.count, this.mode);
    this.panel.append(this.textWrap, this.icon);

    this.magPopup.className = 'gunhud__magcheck';
    const magRow = document.createElement('div');
    magRow.className = 'gunhud__magcheck-row';
    const magIcon = document.createElement('span');
    magIcon.className = 'gunhud__magcheck-icon';
    magIcon.innerHTML =
      '<svg viewBox="0 0 18 22" width="14" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5 2h8l1.2 11.2c.2 2.2.8 4.1 1.6 5.6l-5.2 1.2c-1-1.8-1.6-3.9-1.8-6.4L5 2Z"/><path d="M5.5 6.5h7.8M6 10.5h7.8" opacity=".55"/></svg>';
    this.magStatus.className = 'gunhud__magcheck-status';
    magRow.append(magIcon, this.magStatus);
    this.magMode.className = 'gunhud__magcheck-mode';
    this.magPopup.append(magRow, this.magMode);

    this.slots.className = 'quickslots';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('button');
      b.className = 'quickslot';
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.input.press(`slot${i + 1}` as 'slot1');
        this.input.release(`slot${i + 1}` as 'slot1');
      });
      this.slotEls.push(b);
      this.slots.append(b);
    }
    parent.append(this.canvas, this.panel, this.reload, this.magPopup, this.slots);
    this.dot = parent.querySelector('.crosshair');
  }

  /** A shot's noise (the wave starts again). */
  shot(noise: number): void {
    this.lastNoise = noise;
    this.noiseAge = 0;
  }

  update(dt: number, f: GunHudFrame): void {
    this.noiseAge += dt;
    if (f.inVehicle) {
      if (this.dot) this.dot.style.visibility = 'hidden';
      this.panel.hidden = true;
      this.reload.hidden = true;
      this.magPopup.classList.remove('is-visible');
      this.slots.hidden = true;
      this.updateTouch(f);
      const c = this.canvas;
      const g = this.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      return;
    }
    this.slots.hidden = false;
    const gun = f.gun;
    this.updatePanel(f);
    this.updateSlots(f);
    this.updateTouch(f);
    if (this.dot) this.dot.style.visibility = gun ? 'hidden' : '';
    this.draw(f);
  }

  private updatePanel(f: GunHudFrame): void {
    const gun = f.gun;
    // Permanent bottom-right weapon/ammo HUD stays hidden; only tactical mag-check & reload/jam warnings appear.
    this.panel.hidden = true;
    this.textWrap.classList.remove('is-visible');
    if (!gun) {
      this.reload.hidden = true;
      this.magPopup.classList.remove('is-visible');
      return;
    }
    const showMag = !f.inVehicle && gun.magCheckLeft > 0;
    if (showMag) {
      const status = gun.jammed ? tr('Заклинило', 'Jammed') : magCheckStatus(gun.mag, gun.capacity);
      const modeText = magCheckMode(gun);
      const key = `${gun.id}|${status}|${modeText}|${gun.jammed ? 1 : 0}|${getLang()}`;
      if (key !== this.magKey) {
        this.magKey = key;
        this.magStatus.textContent = status;
        this.magStatus.style.color = gun.jammed || gun.mag <= 0 ? '#f0867a' : '';
        this.magMode.textContent = modeText;
        this.magMode.hidden = !modeText;
      }
    }
    this.magPopup.classList.toggle('is-visible', showMag);

    const wantReload = gun.mag === 0 && !gun.reloading && gun.reserve > 0;
    this.reload.hidden = !wantReload && !gun.jammed;
    this.reload.textContent = gun.jammed
      ? f.touch
        ? tr('Заклинило — Перезар.', 'Jammed — Reload')
        : tr('Заклинило — R', 'Jammed — R')
      : f.touch
        ? tr('Перезарядка', 'Reload')
        : tr('Перезарядка (R)', 'Reload (R)');
  }

  private updateSlots(f: GunHudFrame): void {
    const key = f.quick.join(',') + '|' + f.hand + '|' + getLang();
    if (key === this.slotKey) return;
    this.slotKey = key;
    f.quick.forEach((id, i) => {
      const b = this.slotEls[i];
      b.replaceChildren();
      const n = document.createElement('span');
      n.className = 'quickslot__n';
      n.textContent = String(i + 1);
      b.append(n);
      b.classList.toggle('on', !!id && id === f.hand);
      b.title = id ? ITEMS[id].name : tr('Пусто', 'Empty');
      if (id) {
        const img = document.createElement('img');
        if (isCustomItemIcon(id)) img.className = 'is-hd';
        img.src = itemIcon(id);
        img.alt = ITEMS[id].name;
        b.append(img);
      }
    });
  }

  private updateTouch(f: GunHudFrame): void {
    this.slots.classList.toggle('quickslots--touch', f.touch);
    this.panel.classList.toggle('gunhud--touch', f.touch);
    if (!f.touch) return;
    const root = document.querySelector('.touch');
    root?.classList.toggle('touch--gun', !!f.gun);
    const fire = document.querySelector<HTMLElement>('.touch__btn--attack');
    if (fire) {
      const badge = fire.querySelector<HTMLElement>('.touch__badge');
      if (badge) {
        const t = f.gun ? String(f.gun.mag) : '';
        if (badge.textContent !== t) badge.textContent = t;
        badge.hidden = !f.gun;
      }
    }
  }

  private draw(f: GunHudFrame): void {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const gun = f.gun;
    const pxPerRad = h / 2 / Math.tan((f.fov * Math.PI) / 360);
    g.lineCap = 'round';
    // The crosshair: its gap is the spread.
    if (gun && !gun.ads && gun.crosshair !== 'none') {
      const r = Math.max(5, Math.tan((gun.spread * Math.PI) / 180) * pxPerRad);
      g.strokeStyle = `${WHITE}0.6)`;
      g.lineWidth = 1.5;
      g.beginPath();
      if (gun.crosshair === 'circle') {
        g.arc(cx, cy, r, 0, Math.PI * 2);
      } else {
        const len = 7;
        g.moveTo(cx - r - len, cy);
        g.lineTo(cx - r, cy);
        g.moveTo(cx + r, cy);
        g.lineTo(cx + r + len, cy);
        g.moveTo(cx, cy - r - len);
        g.lineTo(cx, cy - r);
        g.moveTo(cx, cy + r);
        g.lineTo(cx, cy + r + len);
      }
      g.stroke();
      g.fillStyle = `${WHITE}0.5)`;
      g.fillRect(cx - 1, cy - 1, 2, 2);
    }
    // The reload ring.
    if (gun?.reloading) {
      g.strokeStyle = `${WHITE}0.18)`;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, 22, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = `${WHITE}0.65)`;
      g.beginPath();
      g.arc(cx, cy, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, gun.reloadK));
      g.stroke();
    }
    // The hit marker: white; a headshot bigger, thicker, with a cross in the middle.
    if (f.hitMark && f.hitMarkT < 0.3) {
      const a = 1 - f.hitMarkT / 0.3;
      const head = f.hitMark === 'head';
      const r0 = head ? 7 : 5;
      const r1 = head ? 16 : 11;
      g.strokeStyle = `${WHITE}${0.9 * a})`;
      g.lineWidth = head ? 3 : 2;
      g.beginPath();
      for (const [sx, sy] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        g.moveTo(cx + sx * r0, cy + sy * r0);
        g.lineTo(cx + sx * r1, cy + sy * r1);
      }
      if (head) {
        g.moveTo(cx - 3, cy - 3);
        g.lineTo(cx + 3, cy + 3);
        g.moveTo(cx + 3, cy - 3);
        g.lineTo(cx - 3, cy + 3);
      }
      g.stroke();
    }
    // The noise wave: rings from the bottom middle, as big as the shot was loud.
    if (this.noiseAge < 1.2 && this.lastNoise > 0) {
      const k = this.noiseAge / 1.2;
      const big = Math.min(1, this.lastNoise / 120);
      const by = h - 64;
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const kk = k - i * 0.12;
        if (kk < 0) continue;
        g.strokeStyle = `rgba(190,180,150,${0.5 * (1 - kk) * (0.4 + big * 0.6)})`;
        g.beginPath();
        g.arc(cx, by, 10 + kk * (30 + big * 90), Math.PI * 1.15, Math.PI * 1.85);
        g.stroke();
      }
    }
    // Where the hurt came from: a dull arc on a ring around the middle.
    if (f.hurtAngle != null && f.hurtT < 1.5) {
      const a = 1 - f.hurtT / 1.5;
      const ang = f.hurtAngle - Math.PI / 2;
      const R = Math.min(w, h) * 0.22;
      g.strokeStyle = `rgba(150,90,62,${0.75 * a})`;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(cx, cy, R, ang - 0.35, ang + 0.35);
      g.stroke();
    }
  }

  dispose(): void {
    this.canvas.remove();
    this.panel.remove();
    this.reload.remove();
    this.magPopup.remove();
    this.slots.remove();
  }
}
