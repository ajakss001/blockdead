import { type BufferGeometry, Euler, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { ContainerType } from '../../data/loot';
import type { Surface } from '../../render/look/surfaces';
import { pickModel } from '../models';
import { modelLibrary, placeModel } from '../props/car';
import { LIFE, spotHash } from './lifeKinds';
import { PAL, type Rand } from './palette';
import type { Builder } from './pieces';

/*
 * Furniture kit for interiors: backed by baked 3D models in ModelLibrary (no primitive procedural
 * furniture fallbacks or clutter). Every piece is authored in its own frame and placed with Place.
 */

/** Quarter turns: the piece's front (+Z) faces 0 → +Z, 1 → +X, 2 → −Z, 3 → −X. */
export type Quarter = 0 | 1 | 2 | 3;

export const WOODS = [0x6d6250, 0x5e4c39, 0x7a6448, 0x4f4235, 0x84745c] as const;
export const FABRICS = [...PAL.fabric, 0x5a3e3a, 0x4a5058, 0x6a5a48, 0x3e4a52, 0x6a6a5a] as const;
export const CLOTHES = [0x3c4450, 0x6a3a32, 0x4a5a3a, 0x7a7060, 0x2e2e34, 0x8a6a4a, 0x5a4a6a, 0x9a9488] as const;
const ART = [0x5a6a5a, 0x7a6a4a, 0x4a5a6a, 0x8a7a5a, 0x6a4a3a, 0x5a5a7a] as const;
/** Muted fabric / print colours (clothes on a rail, pictures). */
export const ART_COLORS: readonly number[] = ART;

const _m = new Matrix4();
const _l = new Matrix4();
const _base = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

let flatQuad: BufferGeometry | null = null;
let wallQuad: BufferGeometry | null = null;
/** Horizontal 1×1 quad (paper, rugs' pattern). */
const flat = (): BufferGeometry => (flatQuad ??= new PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
/** Vertical 1×1 quad facing +Z (notes, posters). */
const wall = (): BufferGeometry => (wallQuad ??= new PlaneGeometry(1, 1));

export class Place {
  /** Free transform (tipped over / askew); null = quarter turns only. */
  private free: Matrix4 | null = null;

  constructor(
    readonly b: Builder,
    readonly x: number,
    readonly y: number,
    readonly z: number,
    readonly r: Quarter = 0,
  ) {}

  /** Local (x, z) → frame (x, z). */
  pt(lx: number, lz: number): [number, number] {
    switch (this.r) {
      case 0:
        return [this.x + lx, this.z + lz];
      case 1:
        return [this.x + lz, this.z - lx];
      case 2:
        return [this.x - lx, this.z - lz];
      default:
        return [this.x - lz, this.z + lx];
    }
  }

  /** A stable 0..1 for a local point (its world position and storey; leaves the random streams alone). */
  chance(lx: number, lz: number, salt: number): number {
    const [x, z] = this.pt(lx, lz);
    return spotHash(x, z + this.y * 7.3, salt);
  }

  /** What this place and the places made from it drew since the last container (frame AABB). */
  private readonly drawn = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  private parent: Place | null = null;
  private readonly record = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void => {
    for (let p: Place | null = this; p; p = p.parent) {
      const d = p.drawn;
      d[0] = Math.min(d[0], x0);
      d[1] = Math.min(d[1], y0);
      d[2] = Math.min(d[2], z0);
      d[3] = Math.max(d[3], x1);
      d[4] = Math.max(d[4], y1);
      d[5] = Math.max(d[5], z1);
    }
  };

  /** Geometry through the builder, its bounds recorded (the piece's search box). */
  private geo(template: BufferGeometry, color: number, matrix: Matrix4, surface: Surface): void {
    this.b.track = this.record;
    this.b.geo(template, color, matrix, surface);
    this.b.track = null;
  }

  /** A sub-place at a local offset, turned by `dr` more quarters. */
  at(lx: number, lz: number, dr = 0): Place {
    const [x, z] = this.pt(lx, lz);
    const p = new Place(this.b, x, this.y, z, ((this.r + dr) & 3) as Quarter);
    p.parent = this;
    return p;
  }

  /** The same spot with the piece knocked over / pushed askew: yaw, then pitch (forward) and roll (sideways); lifted by `lift`. */
  tipped(yaw: number, pitch = 0, roll = 0, lift = 0): Place {
    const p = new Place(this.b, this.x, this.y, this.z, this.r);
    p.parent = this;
    p.free = new Matrix4().compose(_p.set(this.x, this.y + lift, this.z), _q.setFromEuler(_e.set(pitch, (this.r * Math.PI) / 2 + yaw, roll, 'YXZ')), _s.set(1, 1, 1));
    return p;
  }

  /** This place's frame (position and turn) as a matrix, copied into `out`. */
  frame(out: Matrix4): Matrix4 {
    return out.copy(this.base());
  }

  private base(): Matrix4 {
    return this.free ?? _base.compose(_p.set(this.x, this.y, this.z), _q.setFromAxisAngle(_up, (this.r * Math.PI) / 2), _s.set(1, 1, 1));
  }

  /** Box by local center (x, z), bottom y and size. `solid`: a collider over its own height. */
  box(color: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, surface: Surface = 'wood', solid = false): void {
    if (this.free) {
      _l.compose(_p.set(lx, ly + sy / 2, lz), _q.identity(), _s.set(sx, sy, sz));
      this.geo(this.b.box, color, _m.multiplyMatrices(this.free, _l), surface);
      return;
    }
    const [cx, cz] = this.pt(lx, lz);
    const odd = this.r & 1;
    const ax = odd ? sz : sx;
    const az = odd ? sx : sz;
    this.b.track = this.record;
    this.b.block(color, cx - ax / 2, this.y + ly, cz - az / 2, ax, sy, az, surface);
    this.b.track = null;
    if (solid) this.b.solid(cx - ax / 2, cz - az / 2, cx + ax / 2, cz + az / 2, this.y + ly, this.y + ly + sy);
  }

  /** Rotated box by local center. */
  rbox(color: number, lx: number, cy: number, lz: number, sx: number, sy: number, sz: number, yaw: number, pitch = 0, roll = 0, surface: Surface = 'wood'): void {
    _l.compose(_p.set(lx, cy, lz), _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ')), _s.set(sx, sy, sz));
    this.geo(this.b.box, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** 8-sided cylinder by local center; `pitch` π/2 lays it along Z. */
  cyl(color: number, lx: number, cy: number, lz: number, radius: number, h: number, surface: Surface = 'metal', pitch = 0): void {
    _l.compose(_p.set(lx, cy, lz), _q.setFromEuler(_e.set(pitch, 0, 0)), _s.set(radius, h, radius));
    this.geo(this.b.cyl8, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  cone(color: number, lx: number, cy: number, lz: number, radius: number, h: number, surface: Surface = 'lamp'): void {
    _l.compose(_p.set(lx, cy, lz), _q.identity(), _s.set(radius, h, radius));
    this.geo(this.b.cone6, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  blob(color: number, lx: number, cy: number, lz: number, sx: number, sy: number, sz: number, surface: Surface = 'foliage'): void {
    _l.compose(_p.set(lx, cy, lz), _q.identity(), _s.set(sx, sy, sz));
    this.geo(this.b.ico, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** Flat sheet lying on a surface at height ly (paper, a towel), rotated by yaw. */
  sheet(color: number, lx: number, ly: number, lz: number, sx: number, sz: number, yaw: number, surface: Surface = 'plaster'): void {
    const jitter = (Math.abs(lx * 17.3 + lz * 31.7) % 1) * 0.008;
    const yOff = (ly <= 0.001 ? 0.025 : ly + 0.008) + jitter;
    _l.compose(_p.set(lx, yOff, lz), _q.setFromAxisAngle(_up, yaw), _s.set(sx, 1, sz));
    this.b.geo(flat(), color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** Sheet on the wall behind the piece (z = 0), facing +Z. */
  poster(color: number, lx: number, cy: number, sx: number, sy: number, roll = 0, surface: Surface = 'plaster'): void {
    _l.compose(_p.set(lx, cy, 0.012), _q.setFromEuler(_e.set(0, 0, roll)), _s.set(sx, sy, 1));
    this.b.geo(wall(), color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** Floor decal (soot, litter) at a local point. */
  decal(surface: Surface, lx: number, lz: number, size: number, rand: Rand, stretch = 1): void {
    _l.compose(_p.set(lx, 0.03, lz), _q.setFromAxisAngle(_up, rand() * Math.PI * 2), _s.set(size * stretch, 1, size));
    this.b.geo(flat(), 0xffffff, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** World-life spot (radio, lamp…) at a local point; the normal is the piece's front. */
  life(kind: number, lx: number, ly: number, lz: number, w: number, h: number, seed: number, tag = 0): void {
    const [cx, cz] = this.pt(lx, lz);
    const n = [[0, 1], [1, 0], [0, -1], [-1, 0]][this.r];
    this.b.life(kind, cx, this.y + ly, cz, n[0], n[1], w, h, seed, tag);
  }

  /**
   * Searchable spot in front of the piece; its search box is what the piece drew (since the last
   * container of this place or one under it). The count starts again here, for this place and up.
   */
  container(type: ContainerType, lx: number, lz: number): void {
    const [cx, cz] = this.pt(lx, lz);
    this.b.container(type, cx, cz, this.y, this.drawn[0] <= this.drawn[3] ? [...this.drawn] : undefined);
    this.resetBounds();
  }

  /** Clears accumulated drawn bounds for this place and its ancestors. */
  resetBounds(): void {
    for (let p: Place | null = this; p; p = p.parent) p.drawn.splice(0, 6, Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity);
  }

  /** Collider over a local rectangle (center, size), `h` tall from the floor. */
  solid(lx: number, lz: number, sx: number, sz: number, h: number): void {
    const [cx, cz] = this.pt(lx, lz);
    const odd = this.r & 1;
    const ax = (odd ? sz : sx) / 2;
    const az = (odd ? sx : sz) / 2;
    this.b.solid(cx - ax, cz - az, cx + ax, cz + az, this.y, this.y + h);
  }

  /** Place a baked 3D model from `ModelLibrary` in local coordinates (base at `ly`, facing +Z). */
  model(
    group: string,
    rand: Rand | number,
    lx = 0,
    ly = 0,
    lz = 0,
    yaw = 0,
    scale = 1,
    roughness = 0.78,
    metalness = 0.18,
    collide = false,
  ): boolean {
    const m = pickModel(modelLibrary(), group, typeof rand === 'number' ? rand : rand());
    if (!m) {
      if (modelLibrary() === null) {
        const [cx, cz] = this.pt(lx, lz);
        this.record(cx - 0.4, this.y + ly, cz - 0.4, cx + 0.4, this.y + ly + 1.0, cz + 0.4);
        this.b.logBox(cx - 0.4, this.y + ly, cz - 0.4, cx + 0.4, this.y + ly + 1.0, cz + 0.4);
      }
      return false;
    }
    const [cx, cz] = this.pt(lx, lz);
    if (!this.b.inClip(this.b.wx(cx), this.b.wz(cz))) return true;
    _l.compose(_p.set(lx, ly, lz), _q.setFromAxisAngle(_up, yaw), _s.set(scale, scale, scale));
    _m.multiplyMatrices(this.base(), _l);
    placeModel(this.b.batch, m, this.b.worldMatrix(_m), null, undefined, roughness, metalness);
    const hx = (m.size[0] * scale) / 2;
    const hz = (m.size[2] * scale) / 2;
    const hy = m.size[1] * scale;
    const cosY = Math.abs(Math.cos(yaw));
    const sinY = Math.abs(Math.sin(yaw));
    const rx = hx * cosY + hz * sinY;
    const rz = hx * sinY + hz * cosY;
    const odd = this.r & 1;
    const ax = odd ? rz : rx;
    const az = odd ? rx : rz;
    if (collide) this.b.solid(cx - ax, cz - az, cx + ax, cz + az, this.y + ly, this.y + ly + hy);
    this.record(cx - ax, this.y + ly, cz - az, cx + ax, this.y + ly + hy, cz + az);
    this.b.logBox(cx - ax, this.y + ly, cz - az, cx + ax, this.y + ly + hy, cz + az);
    return true;
  }
}

// ── Bedroom ────────────────────────────────────────────────────────────────────

export function bed(p: Place, rand: Rand, width = 1.5, _messy = false): void {
  const s = Math.min(1.15, width / 1.5);
  const lz = 1.1 * s + 0.04;
  p.model('bed', rand, 0, 0, lz, 0, s, 0.85, 0.05, true);
  p.life(LIFE.bed, 0, 0.5, lz - 0.02, 0, 0, 0);
}

export function nightstand(p: Place, rand: Rand, open = false): void {
  p.resetBounds();
  p.model('nightstand', rand, 0, 0, 0.44, 0, 1, 0.78, 0.12, true);
  p.container('nightstand', 0, 0.82);
  if (!open || rand() >= 0.5) p.model('tableLamp', rand, -0.08, 0.62, 0.44, rand() * 0.6, 1, 0.75, 0.15);
}

/** Wardrobe backed by 3D model. */
export function wardrobe(p: Place, rand: Rand, open = false): void {
  p.resetBounds();
  p.model(open ? 'wardrobeOpen' : 'wardrobe', rand, 0, 0, open ? 0.72 : 0.44, 0, 1, 0.8, 0.1, true);
  p.container('wardrobe', 0, open ? 1.1 : 0.85);
}

// ── Living room ─────────────────────────────────────────────────────────────────

export function sofa(p: Place, rand: Rand, len = 2.0, _messy = false): void {
  p.model('sofa', rand, 0, 0, 0.54, 0, Math.min(1.15, len / 2.0), 0.9, 0.04, true);
}

export function coffeeTable(p: Place, rand: Rand, messy = false): void {
  const q = messy ? p.tipped(0.4, 0, Math.PI / 2, 0.5) : p;
  if (q.model('coffeeTable', rand, 0, 0, 0.28, 0, 1, 0.78, 0.1, !messy) && !messy && rand() < 0.6) {
    p.model('mug', rand, -0.2, 0.38, 0.25, rand() * 6, 1, 0.65, 0.1);
  }
}

export function tvStand(p: Place, rand: Rand, messy = false): void {
  p.resetBounds();
  p.model('tvStand', rand, 0, 0, 0.36, 0, 1, 0.78, 0.12, true);
  p.container('tvstand', 0, 0.8);
  if (messy) {
    p.at(0.1, 1.05).tipped((rand() - 0.5) * 0.8, Math.PI / 2, 0, 0.24).model('tv', rand, 0, -0.25, 0, 0, 1, 0.65, 0.25);
  } else {
    p.model('tv', rand, 0, 0.51, 0.36, 0, 1, 0.65, 0.25, true);
  }
}

export function bookcase(p: Place, rand: Rand, _messy = false): void {
  p.resetBounds();
  p.model('bookcase', rand, 0, 0, 0.34, 0, 1, 0.82, 0.08, true);
  p.container('bookcase', 0, 0.72);
}

export function rug(_p: Place, _rand: Rand, _lz: number, _w: number, _d: number): void {}

/** Painting on the wall behind (z = 0); askew, or fallen and leaning against the wall. */
export function painting(p: Place, rand: Rand, cy = 1.55, fallen = false): void {
  if (fallen) {
    p.tipped(0, -0.25, 0, 0).model('painting', rand, 0, 0, 0.14, 0, 1, 0.8, 0.1);
  } else {
    p.model('painting', rand, 0, cy - 0.28, 0.03, 0, 1, 0.8, 0.1);
  }
}

export function floorLamp(_p: Place, _rand: Rand, _fallen = false): void {}

export function plant(_p: Place, _rand: Rand, _fallen = false): void {}

/** Crates / stacked boxes from 3D models. */
export function boxes(p: Place, rand: Rand, n = 3): void {
  p.resetBounds();
  p.model(n >= 2 ? (rand() < 0.5 ? 'stackedBoxes' : 'palletCrates') : 'woodenCrate', rand, 0, 0, 0.45, (rand() - 0.5) * 0.4, 0.85, 0.85, 0.05, true);
  p.container('boxes', 0, 0.75);
}

// ── Kitchen ─────────────────────────────────────────────────────────────────────

/** Counter run along the wall with skillet, wall cabinet and dishes (3D models only). */
export function kitchenRun(p: Place, rand: Rand, len: number, _messy = false, radio = false): void {
  p.resetBounds();
  const n = Math.max(1, Math.round(len / 1.6));
  const step = len / n;
  const scale = Math.min(1.15, step / 1.64);
  for (let i = 0; i < n; i++) {
    const cx = -len / 2 + step * (i + 0.5);
    p.model('kitchenCounter', rand, cx, 0, 0.42, 0, scale, 0.75, 0.15, true);
  }
  const sx = len / 2 - 0.35;
  const kx = -len / 2 + 0.5;
  p.container('counter', 0, 0.75);
  p.life(LIFE.tap, kx, 1.0, 0.2, 0, 0, 0, 1);
  const topY = 0.77 * scale;
  const topZ = 0.46;
  p.model('skillet', rand, sx - 0.12, topY, topZ, rand() * 6, 1, 0.55, 0.6);
  p.model('wallCabinet', rand, 0, 1.44, 0.34, 0, Math.min(1.5, len / 1.2), 0.78, 0.1);
  p.model('plate', rand, kx + 0.55, topY, topZ, rand() * 6, 1, 0.6, 0.08);
  for (let i = 0; i < 2; i++) if (rand() < 0.6) {
    p.model('mug', rand, -0.1 + i * 0.18, topY, topZ + 0.04, rand() * 6, 1, 0.65, 0.1);
  }
  if (radio) {
    // Battery radio spot (audio only, no procedural box).
    p.life(3, 0.15, 0.97, 0.2, 0, 0, rand());
  }
}

export function fridge(p: Place, rand: Rand, open = false): void {
  p.resetBounds();
  p.model('fridge', rand, 0, 0, 0.5, open ? (rand() < 0.5 ? 0.12 : -0.12) : 0, 1, 0.6, 0.35, true);
  p.container('fridge', 0, 1.0);
}

export function chair(p: Place, rand: Rand, _color?: number): void {
  p.model('chair', rand, 0, 0, 0, 0, 1, 0.8, 0.08, true);
}

/** A chair knocked onto its back or side. */
export function chairDown(p: Place, rand: Rand, _color?: number): void {
  if (rand() < 0.5) chair(p.tipped(rand() * 6, -Math.PI / 2, 0, 0.21), rand);
  else chair(p.tipped(rand() * 6, 0, Math.PI / 2, 0.21), rand);
}

/** Table centered on the place, chairs around it (some knocked over when `messy`). */
export function diningTable(p: Place, rand: Rand, chairs = 4, messy = false): void {
  p.model('diningTable', rand, 0, 0, 0, 0, 1, 0.78, 0.08, true);
  const seats: [number, number, Quarter][] = [
    [-0.38, -0.78, 0],
    [0.38, 0.78, 2],
    [0.38, -0.78, 0],
    [-0.38, 0.78, 2],
  ];
  for (let i = 0; i < Math.min(chairs, 4); i++) {
    const [x, z, r] = seats[i];
    if (messy && rand() < 0.5) chairDown(p.at(x * 1.15, Math.sign(z) * 1.05, r), rand);
    else chair(p.at(x + (rand() - 0.5) * 0.1, z + (rand() - 0.5) * 0.1, r), rand);
  }
  for (let i = 0; i < 2; i++) if (rand() < 0.6) {
    const px = (rand() - 0.5) * 0.8, pz = (rand() - 0.5) * 0.4;
    p.model('plate', rand, px, 0.71, pz, rand() * 6, 1, 0.6, 0.08);
  }
  if (rand() < 0.5) {
    const mx = (rand() - 0.5) * 0.6, mz = (rand() - 0.5) * 0.3;
    p.model('mug', rand, mx, 0.71, mz, rand() * 6, 1, 0.65, 0.1);
  }
}

// ── Offices ─────────────────────────────────────────────────────────────────────

export function officeChair(p: Place, rand: Rand, down = false): void {
  if (down) chairDown(p, rand);
  else chair(p, rand);
}

export function desk(p: Place, rand: Rand, _open = false, _messy = false): void {
  p.resetBounds();
  p.model('desk', rand, 0, 0, 0.58, 0, 1, 0.8, 0.15, true);
  p.container('desk', 0, 1.15);
}

export function partition(_p: Place, _len: number, _lz = 0): void {}

export function printer(_p: Place, _rand: Rand): void {}

export function waterCooler(_p: Place, _rand: Rand): void {}

export function filingCabinet(p: Place, rand: Rand, _open = false): void {
  p.resetBounds();
  p.model('locker', rand, 0, 0, 0.25, 0, 0.85, 0.55, 0.45, true);
  p.container('cabinet', 0, 0.75);
}

export function papers(_p: Place, _rand: Rand, _x0: number, _z0: number, _x1: number, _z1: number, _n: number): void {}

export function notes(_p: Place, _rand: Rand, _n = 2): void {}

// ── Leaving in a hurry ──────────────────────────────────────────────────────────

export function suitcase(p: Place, rand: Rand, _open = false): void {
  p.resetBounds();
  p.model('suitcase', rand, 0, 0, 0.16, (rand() - 0.5) * 0.6, 1, 0.8, 0.15);
  p.container('suitcase', 0, 0.55);
}

export function clothesPile(_p: Place, _rand: Rand, _lx: number, _lz: number, _n: number): void {}

/** Furniture dragged against a door from the inside: a wardrobe on its side, chair piled on it. */
export function barricade(p: Place, rand: Rand): void {
  if (p.at(0, 0.3).tipped(0, 0, Math.PI / 2, 0.5).model('wardrobe', rand, 0, 0, 0, 0, 1, 0.8, 0.1)) {
    p.solid(0, 0.32, 1.9, 0.6, 0.9);
    // Decorative only: the piled chair must not add a second colliding AABB inside the doorway.
    p.at(-0.4, 0.3).tipped(0.3, Math.PI, 0, 1.12).model('chair', rand, 0, 0, 0, 0, 1, 0.8, 0.08, false);
  }
}

// ── Windows ─────────────────────────────────────────────────────────────────────

export function curtains(_p: Place, _rand: Rand, _width: number, _sill: number, _head: number): void {}

// ── Lobby ───────────────────────────────────────────────────────────────────────

export function mailboxes(p: Place, rand: Rand): void {
  p.resetBounds();
  p.model('wallCabinet', rand, 0, 1.0, 0.28, 0, 1.15, 0.65, 0.35, true);
  p.container('mailboxes', 0, 0.6);
}

/** Dead elevator doors + keypad (3D models only). */
export function elevator(p: Place, rand: Rand): void {
  if (p.model('elevatorDoors', rand, 0, 0, 0.1, 0, 1, 0.55, 0.45)) {
    p.solid(0, 0.1, 2.1, 0.2, 2.2);
    p.model('keypad', rand, 1.15, 1.1, 0.06, 0, 1, 0.5, 0.3);
  }
}

/** Concierge / reception counter with a chair behind. */
export function concierge(p: Place, rand: Rand): void {
  p.resetBounds();
  p.model('receptionDesk', rand, 0, 0, 1.48, Math.PI, 0.72, 0.78, 0.15, true);
  p.container('reception', 0, 1.48);
  chair(p.at(0, 0.32, 0), rand);
}

export function bench(_p: Place, _rand: Rand, _down = false): void {}

// ── Shops ───────────────────────────────────────────────────────────────────────

export type ShopKind = 'grocery' | 'pharmacy' | 'cafe' | 'laundry';
export const SHOP_KINDS: readonly ShopKind[] = ['grocery', 'pharmacy', 'cafe', 'laundry'];
/** Sign-band color by shop kind (no names or logos). */
export const SHOP_SIGN: Record<ShopKind, number> = { grocery: 0x6a4a2a, pharmacy: 0x3a6a4a, cafe: 0x5a3a2a, laundry: 0x3a4a6a };

const SHELF_DIM: Record<string, [number, number]> = {
  groceryShelf: [2.0, 0.67],
  pharmacyShelf: [1.82, 0.65],
  metalShelf: [2.07, 0.72],
  storageRack: [3.06, 0.63],
};

/** Shelving unit (len along local X), backed strictly by 3D models. */
export function shopShelf(p: Place, rand: Rand, len: number, kind: ShopKind, messy = false): void {
  p.resetBounds();
  const grp = kind === 'pharmacy'
    ? (messy && rand() < 0.4 ? 'metalShelf' : 'pharmacyShelf')
    : (messy && rand() < 0.4 ? (rand() < 0.5 ? 'metalShelf' : 'storageRack') : 'groceryShelf');
  const [bw, bd] = SHELF_DIM[grp];
  const s = Math.min(1.15, len / bw);
  const lz = (bd * s) / 2 + 0.04;
  p.model(grp, rand, 0, 0, lz, 0, s, 0.75, 0.25, true);
  p.container(kind === 'pharmacy' ? 'pharmacy' : 'shelf', 0, lz + (bd * s) / 2 + 0.35);
}

/** Drinks cooler (3D fridge model). */
export function cooler(p: Place, rand: Rand): void {
  p.resetBounds();
  p.model('fridge', rand, 0, 0, 0.5, 0, 1, 0.6, 0.35, true);
  p.container('cooler', 0, 1.0);
}

/** Shop counter facing +Z customers (3D model only). */
export function shopCounter(p: Place, rand: Rand, kind: ShopKind): void {
  p.resetBounds();
  const cafe = kind === 'cafe';
  p.model(cafe ? 'receptionDesk' : 'checkout', rand, 0, 0, cafe ? 0.72 : 0.5, 0, cafe ? 0.58 : 1, 0.75, 0.2, true);
  p.container(cafe ? 'cafe' : 'shopCounter', 0, cafe ? 1.45 : 1.0);
}

export function cafeTable(p: Place, rand: Rand, messy = false): void {
  diningTable(p, rand, 2, messy);
}

export function washer(p: Place, rand: Rand, _stacked = false): void {
  p.resetBounds();
  p.model('metalShelf', rand, 0, 0, 0.35, 0, 0.75, 0.65, 0.4, true);
  p.container('laundry', 0, 0.8);
}
