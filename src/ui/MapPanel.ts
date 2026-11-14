import type { GameContext } from '../GameContext';
import { sfx } from '../audio/Sound';
import { onLangChange, tr } from '../core/i18n';
import { MAP_CELL, type MapMemory } from '../systems/MapMemory';
import { CHUNK, ROAD_HALF, type WorldLayout, type Zone } from '../world/gen/layout';
import { POI, type PoiSite } from '../world/gen/poi';

export interface MapHost {
  layout: WorldLayout;
  memory: MapMemory;
  /** Where the survivor stands and looks. */
  player(): { x: number; z: number; yaw: number };
  /** Active story objective coordinates and label, if any. */
  questTarget?(): { x: number; z: number; label: string } | null;
}

/** Faded paper-map colours (through the grim palette by eye: no bright spots). */
const ZONE_COLOR: Record<Zone, string> = {
  downtown: '#55554f',
  town: '#64615a',
  suburb: '#6d6a5e',
  forest: '#47503f',
  field: '#696550',
};
const ROAD = '#33332f';
const POI_FILL = '#5b4a3b';
const POI_EDGE = '#86735a';
const FOG = [28, 29, 27] as const;
const MARK = '#8a4b38';
const MIN_SCALE = 0.3;
const MAX_SCALE = 4;
const CLOSE_KEYS = ['KeyM', 'Escape', 'KeyE'];

/**
 * The paper map: the city drawn from the layout (blocks by zone, roads, the places with their names) under
 * a fog wherever the survivor hasn't been. Drag to move, wheel / pinch / buttons to zoom, a tap puts a mark
 * (a tap on a mark takes it off). The game is paused while it is open.
 */
export class MapPanel {
  isOpen = false;
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly info = document.createElement('div');
  private readonly fog = document.createElement('canvas');
  private vx = 0;
  private vz = 0;
  /** px per metre. */
  private scale = 1.2;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch = 0;
  private queued = false;
  private releasing = false;
  private escDown = false;
  private heldAtOpen = new Set<string>();

  constructor(
    private readonly ctx: GameContext,
    private readonly host: MapHost,
    parent: HTMLElement,
  ) {
    this.root.className = 'map';
    this.root.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'map__bar';
    const title = document.createElement('div');
    title.className = 'map__title';
    title.textContent = tr('Карта', 'Map');
    this.info.className = 'map__info';
    const btn = (label: string, fn: () => void, cls = '') => {
      const b = document.createElement('button');
      b.className = `map__btn ${cls}`;
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    };
    const tools = document.createElement('div');
    tools.className = 'map__tools';
    const meBtn = btn(tr('Я', 'Me'), () => this.center());
    tools.append(
      btn('−', () => this.zoom(1 / 1.5)),
      btn('+', () => this.zoom(1.5)),
      meBtn,
      btn('✕', () => this.close(), 'map__btn--close'),
    );
    onLangChange(() => {
      title.textContent = tr('Карта', 'Map');
      meBtn.textContent = tr('Я', 'Me');
      if (this.isOpen) this.draw();
    });
    bar.append(title, this.info, tools);
    this.canvas.className = 'map__canvas';
    this.root.append(this.canvas, bar);
    parent.append(this.root);

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = this.canvas.getBoundingClientRect();
        this.zoom(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.isOpen && this.draw());
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
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.heldAtOpen = new Set(this.ctx.input.isHeld('map') ? ['KeyM'] : []);
    this.root.hidden = false;
    sfx.item('invOpen');
    this.ctx.loop.pause('map');
    this.ctx.events.emit('ui:modal', { open: true });
    if (document.pointerLockElement) {
      this.releasing = true;
      document.exitPointerLock();
    }
    this.center();
  }

  close(viaEsc = false): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.pointers.clear();
    this.root.hidden = true;
    sfx.item('invClose');
    this.ctx.loop.resume('map');
    this.ctx.events.emit('ui:modal', { open: false });
    void viaEsc;
    this.ctx.requestPointerLock();
  }

  private center(): void {
    const p = this.host.player();
    this.vx = p.x;
    this.vz = p.z;
    this.draw();
  }

  /** Zoom by `k` about the screen point (sx, sy) (default: the middle). */
  private zoom(k: number, sx?: number, sy?: number): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    sx ??= w / 2;
    sy ??= h / 2;
    const wx = this.vx + (sx - w / 2) / this.scale;
    const wz = this.vz + (sy - h / 2) / this.scale;
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * k));
    this.vx = wx - (sx - w / 2) / this.scale;
    this.vz = wz - (sy - h / 2) / this.scale;
    this.draw();
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.moved = 0;
    else this.moved = 99; // a second finger: never a tap
    this.pinch = this.spread();
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size >= 2) {
      const s = this.spread();
      if (this.pinch > 0 && s > 0) this.zoom(s / this.pinch);
      this.pinch = s;
      return;
    }
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved < 6) return;
    this.vx -= dx / this.scale;
    this.vz -= dy / this.scale;
    this.queueDraw();
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (!this.pointers.delete(e.pointerId)) return;
    this.pinch = this.spread();
    if (this.pointers.size > 0 || this.moved >= 6) return;
    const r = this.canvas.getBoundingClientRect();
    const wx = this.vx + (e.clientX - r.left - r.width / 2) / this.scale;
    const wz = this.vz + (e.clientY - r.top - r.height / 2) / this.scale;
    this.host.memory.toggleMark(wx, wz, 16 / this.scale);
    sfx.item('invClose');
    this.draw();
  };

  private spread(): number {
    const ps = [...this.pointers.values()];
    return ps.length < 2 ? 0 : Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
  }

  private queueDraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      if (this.isOpen) this.draw();
    });
  }

  draw(): void {
    const { layout, memory } = this.host;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w === 0 || h === 0) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = this.scale;
    const x0 = this.vx - w / 2 / s;
    const z0 = this.vz - h / 2 / s;
    const x1 = this.vx + w / 2 / s;
    const z1 = this.vz + h / 2 / s;
    const X = (x: number) => (x - x0) * s;
    const Y = (z: number) => (z - z0) * s;
    g.fillStyle = `rgb(${FOG.join(',')})`;
    g.fillRect(0, 0, w, h);

    const i0 = Math.floor(x0 / CHUNK);
    const i1 = Math.floor(x1 / CHUNK);
    const j0 = Math.floor(z0 / CHUNK);
    const j1 = Math.floor(z1 / CHUNK);
    const sites = new Map<string, PoiSite>();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const site = layout.poi(i, j);
        g.fillStyle = site ? POI_FILL : ZONE_COLOR[layout.zone(i, j)];
        g.fillRect(X(i * CHUNK), Y(j * CHUNK), CHUNK * s + 0.5, CHUNK * s + 0.5);
        if (site) sites.set(`${site.i},${site.j}`, site);
      }
    }
    // Lots of the big places outlined, the blocks' grid faint.
    g.strokeStyle = POI_EDGE;
    g.lineWidth = 1.5;
    for (const site of sites.values()) g.strokeRect(X(site.i * CHUNK) + 2, Y(site.j * CHUNK) + 2, (site.bw ?? 1) * CHUNK * s - 4, (site.bd ?? 1) * CHUNK * s - 4);
    g.fillStyle = ROAD;
    const rw = Math.max(2, ROAD_HALF * 2 * s);
    for (let i = i0; i <= i1 + 1; i++) {
      for (let j = j0; j <= j1 + 1; j++) {
        if (layout.roadX(i, j)) g.fillRect(X(i * CHUNK) - rw / 2, Y(j * CHUNK) - rw / 2, rw, CHUNK * s + rw);
        if (layout.roadZ(i, j)) g.fillRect(X(i * CHUNK) - rw / 2, Y(j * CHUNK) - rw / 2, CHUNK * s + rw, rw);
      }
    }

    // The fog: one pixel per cell, scaled up smoothly (soft edges).
    const ci0 = Math.floor(x0 / MAP_CELL) - 2;
    const cj0 = Math.floor(z0 / MAP_CELL) - 2;
    const cw = Math.ceil(x1 / MAP_CELL) + 2 - ci0;
    const ch = Math.ceil(z1 / MAP_CELL) + 2 - cj0;
    this.fog.width = cw;
    this.fog.height = ch;
    const fg = this.fog.getContext('2d')!;
    const img = fg.createImageData(cw, ch);
    for (let b = 0; b < ch; b++) {
      for (let a = 0; a < cw; a++) {
        const o = (b * cw + a) * 4;
        img.data[o] = FOG[0];
        img.data[o + 1] = FOG[1];
        img.data[o + 2] = FOG[2];
        img.data[o + 3] = memory.has(ci0 + a, cj0 + b) ? 0 : 255;
      }
    }
    fg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    // Blurred by about a cell: the edge of what was seen is soft, not a staircase (no filter: still fine).
    g.filter = `blur(${Math.max(2, MAP_CELL * s * 0.45).toFixed(1)}px)`;
    g.drawImage(this.fog, X(ci0 * MAP_CELL), Y(cj0 * MAP_CELL), cw * MAP_CELL * s, ch * MAP_CELL * s);
    g.filter = 'none';

    // Names of the places seen (any part of the lot).
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const site of sites.values()) {
      if (!this.seen(site)) continue;
      const cx = X((site.i + (site.bw ?? 1) / 2) * CHUNK);
      const cz = Y((site.j + (site.bd ?? 1) / 2) * CHUNK);
      const name = POI[site.kind].name;
      g.fillStyle = 'rgba(20, 20, 18, 0.75)';
      const tw = g.measureText(name).width;
      g.fillRect(cx - tw / 2 - 4, cz - 9, tw + 8, 18);
      g.fillStyle = '#c9c2b2';
      g.fillText(name, cx, cz);
    }

    // Marks: crosses.
    g.strokeStyle = MARK;
    g.lineWidth = 3;
    for (const [mx, mz] of memory.marks) {
      const sx = X(mx);
      const sy = Y(mz);
      g.beginPath();
      g.moveTo(sx - 7, sy - 7);
      g.lineTo(sx + 7, sy + 7);
      g.moveTo(sx + 7, sy - 7);
      g.lineTo(sx - 7, sy + 7);
      g.stroke();
    }

    // Active story objective marker (amber circle + target crosshair + label).
    const qt = this.host.questTarget?.();
    if (qt) {
      const qx = X(qt.x);
      const qy = Y(qt.z);
      g.save();
      g.strokeStyle = '#e0a844';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(qx, qy, 11, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(qx, qy, 3.5, 0, Math.PI * 2);
      g.fillStyle = '#e0a844';
      g.fill();
      g.font = '600 11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      const tw = g.measureText(qt.label).width;
      g.fillStyle = 'rgba(18, 16, 12, 0.85)';
      g.fillRect(qx - tw / 2 - 5, qy - 29, tw + 10, 16);
      g.strokeStyle = 'rgba(224, 168, 68, 0.55)';
      g.lineWidth = 1;
      g.strokeRect(qx - tw / 2 - 5, qy - 29, tw + 10, 16);
      g.fillStyle = '#f0c878';
      g.fillText(qt.label, qx, qy - 15);
      g.restore();
    }

    // The survivor: an arrow where they look (forward = (−sin yaw, −cos yaw)).
    const p = this.host.player();
    const px = X(p.x);
    const py = Y(p.z);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    g.fillStyle = '#d8cfb8';
    g.strokeStyle = '#1e1f1d';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + fx * 11, py + fz * 11);
    g.lineTo(px - fx * 7 + fz * 7, py - fz * 7 - fx * 7);
    g.lineTo(px - fx * 3, py - fz * 3);
    g.lineTo(px - fx * 7 - fz * 7, py - fz * 7 + fx * 7);
    g.closePath();
    g.stroke();
    g.fill();

    const scaleM = Math.round(100 / s / 10) * 10;
    this.info.textContent = tr(
      `${scaleM} м в 100 пикс. · отметок: ${memory.marks.length} · нажмите на карту, чтобы отметить`,
      `${scaleM} m per 100 px · marks: ${memory.marks.length} · click map to mark`,
    );
  }

  private seen(site: PoiSite): boolean {
    const n = CHUNK / MAP_CELL;
    const ci = site.i * n;
    const cj = site.j * n;
    for (let a = 0; a < (site.bw ?? 1) * n; a++) for (let b = 0; b < (site.bd ?? 1) * n; b++) if (this.host.memory.has(ci + a, cj + b)) return true;
    return false;
  }
}
