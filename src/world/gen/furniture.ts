import { type BufferGeometry, Euler, Matrix4, PlaneGeometry, Quaternion, Vector3 } from 'three';
import type { ContainerType } from '../../data/loot';
import type { Surface } from '../../render/look/surfaces';
import { spotHash } from './lifeKinds';
import { PAL, pick, type Rand } from './palette';
import type { Builder } from './pieces';

/*
 * Furniture kit for interiors: low-poly boxes (and a few cylinders) merged into the chunk / interior
 * batch, so a furnished room costs triangles, never draw calls. Every piece is authored in its own
 * frame — back against the wall at z = 0, front towards +Z, centered on x = 0, standing on y = 0 —
 * and placed with a Place: a position plus quarter turns (boxes stay axis-aligned and can collide;
 * colliders are limited to the piece's height so storeys don't block each other), or tipped over
 * with a free rotation for the mess people left behind. No blood anywhere: chaos is dirt, litter,
 * open drawers, knocked-over chairs, suitcases.
 */

/** Quarter turns: the piece's front (+Z) faces 0 → +Z, 1 → +X, 2 → −Z, 3 → −X. */
export type Quarter = 0 | 1 | 2 | 3;

export const WOODS = [0x6d6250, 0x5e4c39, 0x7a6448, 0x4f4235, 0x84745c] as const;
export const FABRICS = [...PAL.fabric, 0x5a3e3a, 0x4a5058, 0x6a5a48, 0x3e4a52, 0x6a6a5a] as const;
export const CLOTHES = [0x3c4450, 0x6a3a32, 0x4a5a3a, 0x7a7060, 0x2e2e34, 0x8a6a4a, 0x5a4a6a, 0x9a9488] as const;
const ART = [0x5a6a5a, 0x7a6a4a, 0x4a5a6a, 0x8a7a5a, 0x6a4a3a, 0x5a5a7a] as const;
const APPLIANCE = 0xb5b2a8;
const DARK = 0x1c1c1e;
const PAPER = 0xd6d0bc;
const CARDBOARD = 0x8a7356;
const METAL = 0x5a5e60;
const LAMINATE = 0x8a8070;
const CERAMIC = 0xd2cec2;

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

  /** A sub-place at a local offset, turned by `dr` more quarters. */
  at(lx: number, lz: number, dr = 0): Place {
    const [x, z] = this.pt(lx, lz);
    return new Place(this.b, x, this.y, z, ((this.r + dr) & 3) as Quarter);
  }

  /** The same spot with the piece knocked over / pushed askew: yaw, then pitch (forward) and roll (sideways); lifted by `lift`. */
  tipped(yaw: number, pitch = 0, roll = 0, lift = 0): Place {
    const p = new Place(this.b, this.x, this.y, this.z, this.r);
    p.free = new Matrix4().compose(_p.set(this.x, this.y + lift, this.z), _q.setFromEuler(_e.set(pitch, (this.r * Math.PI) / 2 + yaw, roll, 'YXZ')), _s.set(1, 1, 1));
    return p;
  }

  private base(): Matrix4 {
    return this.free ?? _base.compose(_p.set(this.x, this.y, this.z), _q.setFromAxisAngle(_up, (this.r * Math.PI) / 2), _s.set(1, 1, 1));
  }

  /** Box by local center (x, z), bottom y and size. `solid`: a collider over its own height. */
  box(color: number, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, surface: Surface = 'wood', solid = false): void {
    if (this.free) {
      _l.compose(_p.set(lx, ly + sy / 2, lz), _q.identity(), _s.set(sx, sy, sz));
      this.b.geo(this.b.box, color, _m.multiplyMatrices(this.free, _l), surface);
      return;
    }
    const [cx, cz] = this.pt(lx, lz);
    const odd = this.r & 1;
    const ax = odd ? sz : sx;
    const az = odd ? sx : sz;
    this.b.block(color, cx - ax / 2, this.y + ly, cz - az / 2, ax, sy, az, surface);
    if (solid) this.b.solid(cx - ax / 2, cz - az / 2, cx + ax / 2, cz + az / 2, this.y + ly, this.y + ly + sy);
  }

  /** Rotated box by local center. */
  rbox(color: number, lx: number, cy: number, lz: number, sx: number, sy: number, sz: number, yaw: number, pitch = 0, roll = 0, surface: Surface = 'wood'): void {
    _l.compose(_p.set(lx, cy, lz), _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ')), _s.set(sx, sy, sz));
    this.b.geo(this.b.box, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** 8-sided cylinder by local center; `pitch` π/2 lays it along Z. */
  cyl(color: number, lx: number, cy: number, lz: number, radius: number, h: number, surface: Surface = 'metal', pitch = 0): void {
    _l.compose(_p.set(lx, cy, lz), _q.setFromEuler(_e.set(pitch, 0, 0)), _s.set(radius, h, radius));
    this.b.geo(this.b.cyl8, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  cone(color: number, lx: number, cy: number, lz: number, radius: number, h: number, surface: Surface = 'lamp'): void {
    _l.compose(_p.set(lx, cy, lz), _q.identity(), _s.set(radius, h, radius));
    this.b.geo(this.b.cone6, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  blob(color: number, lx: number, cy: number, lz: number, sx: number, sy: number, sz: number, surface: Surface = 'foliage'): void {
    _l.compose(_p.set(lx, cy, lz), _q.identity(), _s.set(sx, sy, sz));
    this.b.geo(this.b.ico, color, _m.multiplyMatrices(this.base(), _l), surface);
  }

  /** Flat sheet lying on a surface at height ly (paper, a towel), rotated by yaw. */
  sheet(color: number, lx: number, ly: number, lz: number, sx: number, sz: number, yaw: number, surface: Surface = 'plaster'): void {
    _l.compose(_p.set(lx, ly + 0.006, lz), _q.setFromAxisAngle(_up, yaw), _s.set(sx, 1, sz));
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

  /** Searchable spot in front of the piece. */
  container(type: ContainerType, lx: number, lz: number): void {
    const [cx, cz] = this.pt(lx, lz);
    this.b.container(type, cx, cz, this.y);
  }

  /** Collider over a local rectangle (center, size), `h` tall from the floor. */
  solid(lx: number, lz: number, sx: number, sz: number, h: number): void {
    const [cx, cz] = this.pt(lx, lz);
    const odd = this.r & 1;
    const ax = (odd ? sz : sx) / 2;
    const az = (odd ? sx : sz) / 2;
    this.b.solid(cx - ax, cz - az, cx + ax, cz + az, this.y, this.y + h);
  }
}

// ── Bedroom ────────────────────────────────────────────────────────────────────

export function bed(p: Place, rand: Rand, width = 1.5, messy = false): void {
  const L = 2.0;
  const wood = pick(rand, WOODS);
  const fabric = pick(rand, FABRICS);
  p.box(wood, 0, 0, L / 2, width, 0.3, L);
  p.box(0xa8a090, 0, 0.3, L / 2 + 0.02, width - 0.06, 0.16, L - 0.08, 'rubber');
  p.box(wood, 0, 0, 0.03, width + 0.06, 0.95, 0.06);
  p.box(0xbab4a6, 0, 0.46, 0.27, width * 0.75, 0.1, 0.34, 'rubber');
  if (messy) {
    // Sheets dragged half onto the floor.
    p.rbox(fabric, width * 0.32, 0.36, L * 0.62, width * 0.9, 0.05, L * 0.62, 0.3, 0, -0.45, 'rubber');
  } else {
    p.box(fabric, 0, 0.46, L * 0.63, width + 0.02, 0.06, L * 0.7, 'rubber');
  }
  p.solid(0, L / 2, width, L, 0.6);
}

export function nightstand(p: Place, rand: Rand, open = false): void {
  const wood = pick(rand, WOODS);
  p.box(wood, 0, 0, 0.2, 0.45, 0.5, 0.4, 'wood', true);
  if (open) p.box(wood, 0, 0.3, 0.42, 0.38, 0.13, 0.36);
  else p.box(DARK, 0, 0.36, 0.402, 0.36, 0.012, 0.006);
  if (open && rand() < 0.5) {
    p.rbox(0x6a6458, 0.25, 0.04, 0.75, 0.05, 0.3, 0.05, 0.4, 0, Math.PI / 2, 'metal');
    p.cone(0xc8b890, 0.45, 0.08, 0.72, 0.13, 0.16);
  } else {
    p.box(0x6a6458, -0.1, 0.5, 0.2, 0.12, 0.03, 0.12, 'metal');
    p.box(0x6a6458, -0.1, 0.53, 0.2, 0.02, 0.22, 0.02, 'metal');
    p.cone(0xc8b890, -0.1, 0.8, 0.2, 0.13, 0.16);
  }
  p.container('nightstand', 0, 0.7);
}

/** Wardrobe 1.2 × 2.0 × 0.6. Open: leaves swung out, clothes inside and spilled on the floor. */
export function wardrobe(p: Place, rand: Rand, open = false): void {
  const wood = pick(rand, WOODS);
  if (!open) {
    p.box(wood, 0, 0, 0.3, 1.2, 2.0, 0.6, 'wood', true);
    p.box(DARK, 0, 0.1, 0.603, 0.015, 1.8, 0.008);
    p.box(METAL, -0.06, 1.0, 0.61, 0.025, 0.18, 0.025, 'metal');
    p.box(METAL, 0.06, 1.0, 0.61, 0.025, 0.18, 0.025, 'metal');
  } else {
    p.box(wood, 0, 0, 0.02, 1.2, 2.0, 0.04);
    p.box(wood, -0.58, 0, 0.3, 0.04, 2.0, 0.6);
    p.box(wood, 0.58, 0, 0.3, 0.04, 2.0, 0.6);
    p.box(wood, 0, 1.96, 0.3, 1.2, 0.04, 0.6);
    p.box(wood, 0, 0, 0.3, 1.2, 0.08, 0.6);
    p.box(0x1a1816, 0, 0.08, 0.05, 1.12, 1.88, 0.01);
    p.box(METAL, 0, 1.75, 0.3, 1.1, 0.02, 0.02, 'metal');
    for (let i = 0; i < 4; i++) if (rand() < 0.6) p.box(pick(rand, CLOTHES), -0.4 + i * 0.26, 0.85, 0.3, 0.06, 0.88, 0.42, 'rubber');
    // Leaves swung out past 90°.
    const a = 1.6 + rand() * 0.4;
    p.rbox(wood, -0.6 + 0.3 * Math.cos(a), 1.0, 0.6 + 0.3 * Math.sin(a), 0.6, 1.96, 0.025, -a);
    if (rand() < 0.7) p.rbox(wood, 0.6 - 0.3 * Math.cos(a), 1.0, 0.6 + 0.3 * Math.sin(a), 0.6, 1.96, 0.025, a);
    p.solid(0, 0.3, 1.2, 0.6, 2.0);
    clothesPile(p, rand, 0, 0.95, 3 + Math.floor(rand() * 3));
  }
  p.container('wardrobe', 0, 0.75);
}

// ── Living room ─────────────────────────────────────────────────────────────────

export function sofa(p: Place, rand: Rand, len = 2.0, messy = false): void {
  const fabric = pick(rand, FABRICS);
  p.box(fabric, 0, 0, 0.45, len, 0.42, 0.9, 'rubber');
  p.box(fabric, 0, 0.42, 0.11, len, 0.45, 0.22, 'rubber');
  p.box(fabric, -len / 2 + 0.1, 0.42, 0.45, 0.2, 0.2, 0.9, 'rubber');
  p.box(fabric, len / 2 - 0.1, 0.42, 0.45, 0.2, 0.2, 0.9, 'rubber');
  if (messy) p.rbox(fabric, (rand() - 0.5) * len, 0.08, 1.3, 0.55, 0.16, 0.5, rand() * 3, 0.1, 0, 'rubber');
  else p.box(fabric, -len / 4, 0.42, 0.5, len / 2 - 0.25, 0.1, 0.6, 'rubber');
  p.solid(0, 0.45, len, 0.9, 0.85);
}

export function coffeeTable(p: Place, rand: Rand, messy = false): void {
  const wood = pick(rand, WOODS);
  const q = messy ? p.tipped(0.4, 0, Math.PI / 2, 0.5) : p;
  q.box(wood, 0, 0.36, 0.28, 1.0, 0.05, 0.55);
  q.box(wood, -0.45, 0, 0.28, 0.05, 0.36, 0.5);
  q.box(wood, 0.45, 0, 0.28, 0.05, 0.36, 0.5);
  if (!messy) {
    p.solid(0, 0.28, 1.0, 0.55, 0.42);
    if (rand() < 0.6) p.cyl(CERAMIC, -0.2, 0.46, 0.25, 0.04, 0.09, 'plaster');
    if (rand() < 0.6) p.sheet(PAPER, 0.2, 0.41, 0.3, 0.22, 0.3, rand() * 3);
  }
}

export function tvStand(p: Place, rand: Rand, messy = false): void {
  p.box(0x2a2622, 0, 0, 0.22, 1.2, 0.5, 0.45, 'wood', true);
  if (messy) {
    // The set was pulled off and dropped face down.
    p.at(0.1, 0.95).tipped((rand() - 0.5) * 0.8, Math.PI / 2, 0, 0.24).box(0x2a2a2a, 0, -0.25, 0, 0.62, 0.5, 0.48, 'metal');
  } else {
    p.box(0x2a2a2a, 0, 0.5, 0.24, 0.62, 0.5, 0.46, 'metal');
    p.box(0x0e1012, 0, 0.56, 0.475, 0.5, 0.38, 0.01, 'glass');
  }
  p.container('tvstand', 0, 0.7);
}

export function bookcase(p: Place, rand: Rand, messy = false): void {
  const wood = pick(rand, WOODS);
  p.box(wood, 0, 0, 0.02, 0.9, 1.9, 0.03);
  p.box(wood, -0.435, 0, 0.16, 0.03, 1.9, 0.32);
  p.box(wood, 0.435, 0, 0.16, 0.03, 1.9, 0.32);
  for (const y of [0, 0.46, 0.92, 1.38, 1.87]) p.box(wood, 0, y, 0.16, 0.84, 0.03, 0.3);
  for (const y of [0.03, 0.49, 0.95, 1.41]) {
    let x = -0.4;
    while (x < 0.36) {
      const w = 0.1 + rand() * 0.22;
      if (!messy || rand() < 0.4) p.box(pick(rand, ART), x + w / 2, y, 0.17, w - 0.01, 0.2 + rand() * 0.1, 0.22, 'rubber');
      x += w + (rand() < 0.3 ? 0.08 : 0);
    }
  }
  if (messy) for (let i = 0; i < 5; i++) p.rbox(pick(rand, ART), (rand() - 0.5) * 1.2, 0.02, 0.5 + rand() * 0.6, 0.16, 0.04, 0.22, rand() * 3, 0, 0, 'rubber');
  p.solid(0, 0.16, 0.9, 0.32, 1.9);
  p.container('bookcase', 0, 0.55);
}

export function rug(p: Place, rand: Rand, lz: number, w: number, d: number): void {
  const a = pick(rand, FABRICS);
  p.box(a, 0, 0, lz, w, 0.012, d, 'rubber');
  p.box(pick(rand, ART), 0, 0.012, lz, w - 0.3, 0.004, d - 0.3, 'rubber');
}

/** Painting on the wall behind (z = 0); askew, or fallen and leaning against the wall. */
export function painting(p: Place, rand: Rand, cy = 1.55, fallen = false): void {
  const w = 0.5 + rand() * 0.4;
  const h = 0.4 + rand() * 0.25;
  const frame = pick(rand, WOODS);
  if (fallen) {
    const q = p.tipped(0, -0.25, 0, 0);
    q.box(frame, 0, 0, 0.12, w, h, 0.03);
    q.box(pick(rand, ART), 0, 0.04, 0.137, w - 0.08, h - 0.08, 0.005);
    return;
  }
  const roll = rand() < 0.4 ? (rand() - 0.5) * 0.3 : 0;
  p.rbox(frame, 0, cy, 0.015, w, h, 0.03, 0, 0, roll);
  // The picture on a pale mat: a landscape, a portrait or a still life (never two flat stripes — they read
  // as a flag). Offsets turn with the frame's roll.
  const iw = w - 0.12;
  const ih = h - 0.12;
  const c = Math.cos(roll);
  const s = Math.sin(roll);
  const at = (x: number, y: number, z: number, bw: number, bh: number, color: number) =>
    p.rbox(color, x * c - y * s, cy + x * s + y * c, z, bw, bh, 0.004, 0, 0, roll, 'plaster');
  at(0, 0, 0.031, w - 0.06, h - 0.06, PAPER);
  const kind = rand();
  if (kind < 0.45) {
    // Landscape: an overcast sky, a field, a dark treeline or a house, a pale moon.
    const sky = pick(rand, [0x6e7470, 0x7a6e66, 0x5e6466, 0x86786a]);
    const field = pick(rand, [0x4e5236, 0x5c4a34, 0x3e4632, 0x6a5a3c]);
    at(0, ih * 0.15, 0.034, iw, ih * 0.7, sky);
    at(0, -ih * 0.35, 0.035, iw, ih * 0.3, field);
    const tx = (rand() - 0.5) * iw * 0.5;
    if (rand() < 0.5) for (let i = 0; i < 3; i++) at(tx + (i - 1) * iw * 0.12, -ih * 0.1 + i * 0.01, 0.036, iw * 0.1, ih * (0.28 + rand() * 0.12), 0x2a2e24);
    else {
      at(tx, -ih * 0.12, 0.036, iw * 0.24, ih * 0.22, 0x5a3e30);
      at(tx, ih * 0.03, 0.037, iw * 0.28, ih * 0.08, 0x3a2a24);
    }
    at(-tx * 0.8 + iw * 0.2, ih * 0.3, 0.036, iw * 0.08, iw * 0.08, 0xc8c0a8);
  } else if (kind < 0.75) {
    // Portrait: a dark ground, the shoulders, a face.
    at(0, 0, 0.034, iw, ih, pick(rand, [0x2e2620, 0x3a2e2a, 0x2a2e2a]));
    at(0, -ih * 0.32, 0.035, iw * 0.6, ih * 0.36, pick(rand, [0x1e1c1c, 0x3a3030, 0x2c3430]));
    at(0, ih * 0.08, 0.036, iw * 0.26, ih * 0.38, pick(rand, [0xa08670, 0x8e7460, 0xb09478]));
  } else {
    // Still life: a dark table and wall, a jug, fruit.
    at(0, ih * 0.12, 0.034, iw, ih * 0.76, pick(rand, [0x3e3a30, 0x463c34, 0x343832]));
    at(0, -ih * 0.38, 0.035, iw, ih * 0.24, pick(rand, [0x5a3e2a, 0x4a3426]));
    at(-iw * 0.15, -ih * 0.08, 0.036, iw * 0.2, ih * 0.42, pick(rand, [0x8a6a4a, 0x6a6a5a, 0x7a4a3a]));
    for (let i = 0; i < 3; i++) at(iw * (0.08 + i * 0.1), -ih * 0.22, 0.036, iw * 0.08, iw * 0.08, pick(rand, [0x8a3a2a, 0x9a7a3a, 0x5a6a3a, 0x7a2a2a]));
  }
}

export function floorLamp(p: Place, rand: Rand, fallen = false): void {
  const q = fallen ? p.tipped(rand() * 6, 0, Math.PI / 2 - 0.08, 0.12) : p;
  q.cyl(0x3a3834, 0, 0.015, 0, 0.15, 0.03);
  q.box(0x3a3834, 0, 0.03, 0, 0.03, 1.45, 0.03, 'metal');
  q.cone(0xb8a888, 0, 1.55, 0, 0.22, 0.28);
}

export function plant(p: Place, rand: Rand, fallen = false): void {
  const leaves = pick(rand, [0x4a5236, 0x5a5a3a, 0x6a5e3e, 0x56603f]);
  if (fallen) {
    const q = p.tipped(rand() * 6, Math.PI / 2, 0, 0.18);
    q.cyl(0x6a4a3a, 0, 0.17, 0, 0.17, 0.34, 'plaster');
    p.decal('decalSoot', 0, 0.5, 0.8, rand);
    p.blob(leaves, 0.1, 0.12, 0.65, 0.35, 0.15, 0.3);
    return;
  }
  p.cyl(0x6a4a3a, 0, 0.17, 0, 0.17, 0.34, 'plaster');
  p.blob(leaves, 0, 0.62, 0, 0.32, 0.38, 0.32);
  p.solid(0, 0, 0.36, 0.36, 0.5);
}

/** Cardboard boxes, stacked, some open: moving out, or packing what they could. */
export function boxes(p: Place, rand: Rand, n = 3): void {
  // Centered on x = 0.
  const widths = Array.from({ length: n }, () => 0.4 + rand() * 0.2);
  const total = widths.reduce((s, w) => s + w + 0.05, -0.05);
  let x = -total / 2;
  for (let i = 0; i < n; i++) {
    const w = widths[i];
    const h = 0.3 + rand() * 0.15;
    const yaw = (rand() - 0.5) * 0.4;
    p.rbox(CARDBOARD, x + w / 2, h / 2, 0.3, w, h, 0.4, yaw);
    if (rand() < 0.5) p.rbox(0x7a6346, x + w / 2 + 0.05, h + 0.12 + 0.01, 0.3, w * 0.9, 0.24, 0.36, yaw + 0.3);
    x += w + 0.05;
  }
  p.solid(0, 0.3, total, 0.45, 0.5);
  p.container('boxes', 0, 0.65);
}

// ── Kitchen ─────────────────────────────────────────────────────────────────────

/** Counter run along the wall: cabinets, worktop, sink, stove, wall cabinets, dishes. */
export function kitchenRun(p: Place, rand: Rand, len: number, messy = false, radio = false): void {
  const cab = pick(rand, [0x7a6a58, 0x8a8478, 0x6a5e50, 0x8e8a7c]);
  p.box(cab, 0, 0, 0.3, len, 0.86, 0.58);
  p.box(0x9a9483, 0, 0.86, 0.31, len + 0.02, 0.04, 0.62, 'plaster');
  p.solid(0, 0.3, len, 0.6, 0.9);
  // Stove at one end, sink at the other.
  const sx = len / 2 - 0.32;
  p.box(APPLIANCE, sx, 0, 0.3, 0.6, 0.9, 0.6, 'metal');
  p.box(0x2a2a2a, sx, 0.9, 0.3, 0.5, 0.01, 0.5, 'metal');
  p.box(0x161616, sx, 0.25, 0.602, 0.44, 0.3, 0.01, 'glass');
  p.cyl(METAL, sx - 0.12, 0.98, 0.42, 0.12, 0.14);
  const kx = -len / 2 + 0.5;
  p.box(0x5a5e60, kx, 0.87, 0.3, 0.5, 0.035, 0.4, 'metal');
  p.box(METAL, kx, 0.9, 0.08, 0.03, 0.25, 0.03, 'metal');
  p.box(cab, 0, 1.45, 0.17, len, 0.65, 0.34);
  if (messy || rand() < 0.3) {
    // A wall cabinet hangs open, emptied.
    const ox = -len / 2 + 0.4 + rand() * (len - 0.8);
    p.box(0x1a1816, ox, 1.48, 0.345, 0.38, 0.58, 0.005);
    p.rbox(cab, ox - 0.19 + 0.19 * Math.cos(1.8), 1.77, 0.35 + 0.19 * Math.sin(1.8), 0.38, 0.6, 0.02, -1.8);
  }
  // Dishes: a stack of plates, mugs, a pot left on the stove.
  p.cyl(CERAMIC, kx + 0.5, 0.92, 0.35, 0.11, 0.04 + rand() * 0.05, 'plaster');
  for (let i = 0; i < 2; i++) if (rand() < 0.6) p.cyl(pick(rand, [CERAMIC, 0x8a4a3a, 0x3a5a6a]), -0.1 + i * 0.15, 0.93, 0.45, 0.04, 0.09, 'plaster');
  if (radio) {
    // Battery radio, still hissing (WorldLife plays it).
    p.life(3, 0.15, 0.97, 0.2, 0, 0, rand());
    p.box(0x2a2826, 0.15, 0.88, 0.2, 0.3, 0.17, 0.1, 'metal');
    p.rbox(METAL, 0.25, 1.15, 0.2, 0.01, 0.4, 0.01, 0, 0, -0.4, 'metal');
  }
  if (messy) {
    // Broken plates on the floor.
    for (let i = 0; i < 6; i++) p.sheet(CERAMIC, (rand() - 0.5) * len, 0, 0.75 + rand() * 0.5, 0.06 + rand() * 0.06, 0.05 + rand() * 0.05, rand() * 3);
    p.decal('decalLitter', 0, 0.9, 1.2, rand);
  }
  p.container('counter', 0, 0.75);
}

export function fridge(p: Place, rand: Rand, open = false): void {
  if (!open) {
    p.box(APPLIANCE, 0, 0, 0.32, 0.7, 1.8, 0.64, 'metal', true);
    p.box(0x8a8880, 0, 1.2, 0.642, 0.66, 0.012, 0.006, 'metal');
    p.box(0x6a6a66, 0.28, 1.28, 0.655, 0.03, 0.32, 0.03, 'metal');
  } else {
    p.box(APPLIANCE, 0, 0, 0.3, 0.7, 1.8, 0.6, 'metal', true);
    p.box(0x2a2a28, 0, 0.06, 0.602, 0.62, 1.68, 0.006, 'metal');
    for (const y of [0.5, 0.9, 1.3]) p.box(0x8a8a86, 0, y, 0.56, 0.6, 0.015, 0.08, 'metal');
    const a = 1.2 + rand() * 0.6;
    p.rbox(APPLIANCE, -0.35 + 0.35 * Math.cos(a), 0.9, 0.62 + 0.35 * Math.sin(a), 0.7, 1.78, 0.05, -a, 0, 0, 'metal');
  }
  p.container('fridge', 0, 0.8);
}

export function chair(p: Place, rand: Rand, color: number = pick(rand, WOODS)): void {
  p.box(color, 0, 0.43, 0, 0.42, 0.04, 0.42);
  p.box(color, 0, 0.47, -0.19, 0.42, 0.45, 0.04);
  for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) p.box(color, lx, 0, lz, 0.035, 0.43, 0.035);
}

/** A chair knocked onto its back or side. */
export function chairDown(p: Place, rand: Rand, color: number = pick(rand, WOODS)): void {
  if (rand() < 0.5) chair(p.tipped(rand() * 6, -Math.PI / 2, 0, 0.21), rand, color);
  else chair(p.tipped(rand() * 6, 0, Math.PI / 2, 0.21), rand, color);
}

/** Table centered on the place, chairs around it (some knocked over when `messy`). */
export function diningTable(p: Place, rand: Rand, chairs = 4, messy = false): void {
  const wood = pick(rand, WOODS);
  p.box(wood, 0, 0.72, 0, 1.2, 0.04, 0.8);
  for (const lx of [-0.55, 0.55]) for (const lz of [-0.35, 0.35]) p.box(wood, lx, 0, lz, 0.05, 0.72, 0.05);
  p.solid(0, 0, 1.2, 0.8, 0.76);
  const seats: [number, number, Quarter][] = [
    [-0.3, -0.62, 0],
    [0.3, 0.62, 2],
    [0.3, -0.62, 0],
    [-0.3, 0.62, 2],
  ];
  for (let i = 0; i < Math.min(chairs, 4); i++) {
    const [x, z, r] = seats[i];
    if (messy && rand() < 0.5) chairDown(p.at(x * 1.6, z * 1.8, r), rand, wood);
    else chair(p.at(x + (rand() - 0.5) * 0.15, z + (rand() - 0.5) * 0.15, r), rand, wood);
  }
  // Dinner never finished.
  for (let i = 0; i < 2; i++) if (rand() < 0.6) p.cyl(CERAMIC, (rand() - 0.5) * 0.8, 0.77, (rand() - 0.5) * 0.4, 0.11, 0.015, 'plaster');
  if (rand() < 0.5) p.cyl(pick(rand, [CERAMIC, 0x8a4a3a]), (rand() - 0.5) * 0.6, 0.8, (rand() - 0.5) * 0.3, 0.04, 0.09, 'plaster');
  if (rand() < 0.4) p.sheet(PAPER, (rand() - 0.5) * 0.6, 0.74, (rand() - 0.5) * 0.3, 0.21, 0.3, rand() * 3);
}

// ── Offices ─────────────────────────────────────────────────────────────────────

export function officeChair(p: Place, rand: Rand, down = false): void {
  const c = pick(rand, [0x2a2c30, 0x3a3e46, 0x4a3a3a]);
  const q = down ? p.tipped(rand() * 6, 0, Math.PI / 2, 0.3) : p;
  q.box(0x2a2a2a, 0, 0.05, 0, 0.55, 0.03, 0.06, 'metal');
  q.box(0x2a2a2a, 0, 0.05, 0, 0.06, 0.03, 0.55, 'metal');
  q.box(0x3a3a3a, 0, 0.08, 0, 0.05, 0.36, 0.05, 'metal');
  q.box(c, 0, 0.44, 0, 0.46, 0.07, 0.46, 'rubber');
  q.box(c, 0, 0.55, -0.22, 0.44, 0.5, 0.06, 'rubber');
}

/** Office desk with a CRT monitor and keyboard (monitor on the floor when `messy`). */
export function desk(p: Place, rand: Rand, open = false, messy = false): void {
  p.box(LAMINATE, 0, 0.72, 0.375, 1.4, 0.04, 0.75);
  p.box(LAMINATE, -0.68, 0, 0.375, 0.04, 0.72, 0.72);
  p.box(LAMINATE, 0, 0.3, 0.04, 1.32, 0.42, 0.02);
  p.box(0x7a7264, 0.45, 0, 0.4, 0.4, 0.62, 0.6);
  if (open) p.box(0x7a7264, 0.45, 0.42, 0.78, 0.36, 0.16, 0.5);
  p.solid(0, 0.375, 1.4, 0.75, 0.76);
  if (messy) {
    const q = p.at(-0.2, 1.05).tipped(rand() * 3, Math.PI / 2, 0, 0.2);
    q.box(0x9a968a, 0, -0.2, 0, 0.4, 0.36, 0.38, 'metal');
  } else {
    p.box(0x9a968a, -0.15, 0.76, 0.22, 0.4, 0.36, 0.36, 'metal');
    p.box(0x14181a, -0.15, 0.8, 0.402, 0.32, 0.26, 0.006, 'glass');
  }
  p.box(0x8a8678, -0.15, 0.76, 0.56, 0.42, 0.025, 0.14, 'metal');
  for (let i = 0; i < 2; i++) p.sheet(PAPER, 0.25 + (rand() - 0.5) * 0.3, 0.74, 0.4 + (rand() - 0.5) * 0.2, 0.21, 0.3, rand() * 3);
  p.container('desk', 0, 0.95);
}

/** Cubicle panel along local X (fabric, waist-to-shoulder high). */
export function partition(p: Place, len: number, lz = 0): void {
  p.box(0x5a6068, 0, 0, lz, len, 1.3, 0.06, 'rubber', true);
  p.box(0x3a3c3e, 0, 1.3, lz, len, 0.03, 0.08, 'metal');
}

export function printer(p: Place, rand: Rand): void {
  p.box(0x6a6a66, 0, 0, 0.25, 0.6, 0.7, 0.5, 'metal', true);
  p.box(0xb0aca0, 0, 0.7, 0.25, 0.5, 0.25, 0.42, 'metal');
  p.box(PAPER, 0, 0.95, 0.3, 0.21, 0.01, 0.3, 'plaster');
  for (let i = 0; i < 4; i++) p.sheet(PAPER, (rand() - 0.5) * 1.2, 0, 0.8 + rand() * 0.6, 0.21, 0.3, rand() * 3);
}

export function waterCooler(p: Place, rand: Rand): void {
  p.box(0xc8c4b8, 0, 0, 0.18, 0.32, 0.95, 0.32, 'metal', true);
  if (rand() < 0.35) {
    // The bottle was taken off and dropped.
    p.at(0.3, 0.6).tipped(rand() * 6, Math.PI / 2, 0, 0.14).cyl(0x7a9aaa, 0, 0, 0, 0.13, 0.42, 'glass');
  } else {
    p.cyl(0x7a9aaa, 0, 1.16, 0.18, 0.13, 0.42, 'glass');
  }
}

export function filingCabinet(p: Place, rand: Rand, open = false): void {
  p.box(METAL, 0, 0, 0.25, 0.5, 1.3, 0.5, 'metal', true);
  for (const y of [0.3, 0.62, 0.94]) p.box(0x3a3c3e, 0, y, 0.505, 0.3, 0.02, 0.01, 'metal');
  if (open) {
    p.box(0x6a6e70, 0, 0.66, 0.75, 0.44, 0.26, 0.5, 'metal');
    for (let i = 0; i < 5; i++) p.sheet(PAPER, (rand() - 0.5) * 1.4, 0, 0.9 + rand() * 0.9, 0.21, 0.3, rand() * 3);
  }
  p.container('cabinet', 0, 0.75);
}

/** Paper scattered over the floor of a local rectangle. */
export function papers(p: Place, rand: Rand, x0: number, z0: number, x1: number, z1: number, n: number): void {
  for (let i = 0; i < n; i++) p.sheet(PAPER, x0 + rand() * (x1 - x0), 0, z0 + rand() * (z1 - z0), 0.21, 0.3, rand() * 6);
}

/** Notes pinned on the wall behind the piece: "gone to the evacuation point", lists, a child's drawing. */
export function notes(p: Place, rand: Rand, n = 2): void {
  for (let i = 0; i < n; i++) {
    const x = (rand() - 0.5) * 0.8;
    const y = 1.3 + rand() * 0.4;
    const roll = (rand() - 0.5) * 0.25;
    p.poster(pick(rand, [PAPER, 0xd8cc9a, 0xc8d0c8]), x, y, 0.21, 0.29, roll);
    // Scribbled lines.
    for (let k = 0; k < 3; k++) p.rbox(0x2a2a30, x, y + 0.08 - k * 0.06, 0.016, 0.14, 0.008, 0.002, 0, 0, roll, 'plaster');
  }
}

// ── Leaving in a hurry ──────────────────────────────────────────────────────────

export function suitcase(p: Place, rand: Rand, open = false): void {
  const c = pick(rand, [0x2a3440, 0x5a2a2a, 0x3a3a34, 0x6a5a3a]);
  if (open) {
    p.box(c, 0, 0, 0.25, 0.7, 0.12, 0.45, 'rubber');
    p.at(0, 0.5).tipped(0, -0.3, 0, 0).box(c, 0, 0, -0.03, 0.7, 0.45, 0.05, 'rubber');
    for (let i = 0; i < 2; i++) p.box(pick(rand, CLOTHES), (rand() - 0.5) * 0.4, 0.12, 0.25, 0.3, 0.05, 0.3, 'rubber');
    clothesPile(p, rand, 0, 0.75, 2);
  } else {
    p.rbox(c, 0, 0.35, 0.15, 0.48, 0.7, 0.25, (rand() - 0.5) * 0.6, 0, 0, 'rubber');
    p.box(0x1a1a1a, 0, 0.7, 0.15, 0.2, 0.08, 0.03, 'metal');
  }
  p.container('suitcase', 0, 0.55);
}

/** Clothes dropped on the floor around a local point. */
export function clothesPile(p: Place, rand: Rand, lx: number, lz: number, n: number): void {
  for (let i = 0; i < n; i++) p.rbox(pick(rand, CLOTHES), lx + (rand() - 0.5) * 0.9, 0.02, lz + (rand() - 0.5) * 0.6, 0.35 + rand() * 0.2, 0.03, 0.3 + rand() * 0.2, rand() * 6, 0, 0, 'rubber');
}

/** Furniture dragged against a door from the inside: a wardrobe on its side, chairs piled on it. */
export function barricade(p: Place, rand: Rand): void {
  const wood = pick(rand, WOODS);
  p.box(wood, 0, 0, 0.32, 1.9, 0.62, 0.6, 'wood', true);
  p.box(DARK, 0, 0.1, 0.623, 1.8, 0.015, 0.006);
  chair(p.at(-0.4, 0.3).tipped(0.3, Math.PI, 0, 1.12), rand, pick(rand, WOODS));
  p.rbox(pick(rand, FABRICS), 0.45, 0.82, 0.3, 0.9, 0.4, 0.4, 0.2, 0, 0.1, 'rubber');
}

// ── Windows ─────────────────────────────────────────────────────────────────────

/** Curtains either side of a window on the wall behind (z = 0); sometimes one is torn down. */
export function curtains(p: Place, rand: Rand, width: number, sill: number, head: number): void {
  const c = pick(rand, FABRICS);
  const h = head - sill + 0.55;
  p.box(METAL, 0, head + 0.12, 0.1, width + 0.7, 0.02, 0.02, 'metal');
  const torn = rand() < 0.25;
  for (const side of [-1, 1]) {
    if (torn && side > 0) {
      p.rbox(c, side * (width / 2 + 0.1), 0.03, 0.5, 0.5, 0.04, 0.8, rand() * 0.6, 0, 0, 'rubber');
      continue;
    }
    const w = 0.35 + rand() * 0.25;
    p.box(c, side * (width / 2 + 0.2 - w / 2 + 0.1), head + 0.12 - h, 0.08, w, h, 0.04, 'rubber');
  }
}

// ── Lobby ───────────────────────────────────────────────────────────────────────

/** Wall of mailboxes, a few doors forced open. */
export function mailboxes(p: Place, rand: Rand): void {
  const cols = 6;
  const rows = 4;
  const w = 1.6;
  const h = 1.0;
  p.box(0x6a6e6a, 0, 0.8, 0.12, w, h, 0.24, 'metal', true);
  for (let i = 1; i < cols; i++) p.box(0x3a3c3a, -w / 2 + (i * w) / cols, 0.8, 0.242, 0.012, h, 0.006, 'metal');
  for (let k = 1; k < rows; k++) p.box(0x3a3c3a, 0, 0.8 + (k * h) / rows, 0.242, w, 0.012, 0.006, 'metal');
  for (let n = 0; n < 4; n++) {
    const i = Math.floor(rand() * cols);
    const k = Math.floor(rand() * rows);
    const cx = -w / 2 + (i + 0.5) * (w / cols);
    const cy = 0.8 + (k + 0.5) * (h / rows);
    p.box(0x121212, cx, cy - h / rows / 2 + 0.01, 0.243, w / cols - 0.02, h / rows - 0.02, 0.004, 'metal');
    p.rbox(0x7a7e7a, cx - w / cols / 2 + 0.02, cy, 0.3, 0.012, h / rows - 0.03, w / cols - 0.03, -0.4 - rand() * 0.6, 0, 0, 'metal');
  }
  papers(p, rand, -0.8, 0.3, 0.8, 1.3, 6);
  p.container('mailboxes', 0, 0.55);
}

/** Dead elevator: doors pried a hand's width apart, a black shaft behind. */
export function elevator(p: Place, rand: Rand): void {
  p.box(0x4a4c4e, 0, 0, 0.05, 1.4, 2.3, 0.1, 'metal');
  p.box(0x050505, 0, 0, 0.11, 1.0, 2.1, 0.01, 'metal');
  const gap = 0.12 + rand() * 0.25;
  p.box(0x7a7e80, -0.25 - gap / 2, 0, 0.14, 0.5, 2.1, 0.04, 'metal', true);
  p.box(0x7a7e80, 0.25 + gap / 2, 0, 0.14, 0.5, 2.1, 0.04, 'metal', true);
  p.box(0x2a2a2a, 0.85, 1.1, 0.13, 0.12, 0.25, 0.04, 'metal');
  // "Не работает" sheet taped on.
  p.poster(PAPER, -0.3 - gap / 2, 1.5, 0.21, 0.3, 0.06);
  p.poster(PAPER, -0.3 - gap / 2, 1.5, 0.21, 0.3, 0.06);
}

/** Concierge / security counter (L-shaped) with an old monitor and a chair behind. */
export function concierge(p: Place, rand: Rand): void {
  p.box(0x6d6250, 0, 0, 0.35, 2.4, 1.05, 0.6, 'wood', true);
  p.box(0x9a9483, 0, 1.05, 0.35, 2.5, 0.04, 0.7, 'plaster');
  p.box(0x6d6250, 1.2 - 0.3, 0, -0.5, 0.6, 1.05, 1.1, 'wood', true);
  p.box(0x9a968a, -0.5, 0.75, -0.25, 0.4, 0.34, 0.36, 'metal');
  officeChair(p.at(0, -0.7, 2), rand, rand() < 0.4);
  papers(p, rand, -1.2, 0.8, 1.2, 1.8, 5);
  p.container('reception', 0, 0.85);
}

export function bench(p: Place, rand: Rand, down = false): void {
  const q = down ? p.tipped(rand() * 0.5, 0, Math.PI / 2, 0.22) : p;
  q.box(0x4a3b38, 0, 0.42, 0.22, 2.0, 0.06, 0.45, 'rubber');
  q.box(0x2a2a2a, -0.85, 0, 0.22, 0.06, 0.42, 0.4, 'metal');
  q.box(0x2a2a2a, 0.85, 0, 0.22, 0.06, 0.42, 0.4, 'metal');
  if (!down) p.solid(0, 0.22, 2.0, 0.45, 0.48);
}

// ── Shops ───────────────────────────────────────────────────────────────────────

export type ShopKind = 'grocery' | 'pharmacy' | 'cafe' | 'laundry';
export const SHOP_KINDS: readonly ShopKind[] = ['grocery', 'pharmacy', 'cafe', 'laundry'];
/** Sign-band color by shop kind (no names or logos). */
export const SHOP_SIGN: Record<ShopKind, number> = { grocery: 0x6a4a2a, pharmacy: 0x3a6a4a, cafe: 0x5a3a2a, laundry: 0x3a4a6a };

/** Shelving unit (len along local X), stocked or stripped; goods knocked onto the floor when `messy`. */
export function shopShelf(p: Place, rand: Rand, len: number, kind: ShopKind, messy = false): void {
  const frame = kind === 'pharmacy' ? 0xb8b4aa : METAL;
  p.box(frame, 0, 0, 0.25, len, 0.08, 0.5, 'metal');
  p.box(frame, 0, 0.08, 0.02, len, 1.6, 0.04, 'metal');
  for (const y of [0.45, 0.85, 1.25, 1.65]) p.box(frame, 0, y, 0.25, len, 0.025, 0.5, 'metal');
  const goods = kind === 'pharmacy' ? [0xd0ccc0, 0x8aa0b0, 0xc0a0a0, 0xa0b890] : [0x6a3a2a, 0x3a4a5a, 0x7a7050, 0x4a5a3a, 0x8a6a3a];
  const stock = messy ? 0.25 : 0.65;
  for (const y of [0.08, 0.475, 0.875, 1.275]) {
    for (let x = -len / 2 + 0.1; x < len / 2 - 0.15; x += 0.3) {
      if (rand() < stock) p.box(pick(rand, goods), x + 0.12, y, 0.27, 0.22, 0.1 + rand() * 0.14, 0.38, kind === 'pharmacy' ? 'plaster' : 'wood');
    }
  }
  if (messy) for (let i = 0; i < 6; i++) p.rbox(pick(rand, goods), (rand() - 0.5) * len, 0.05, 0.8 + rand() * 0.6, 0.18, 0.1, 0.12, rand() * 6, 0, 0, 'wood');
  p.solid(0, 0.25, len, 0.5, 1.7);
  p.container(kind === 'pharmacy' ? 'pharmacy' : 'shelf', 0, 0.7);
}

/** Glass-front drinks cooler against the wall (dead, warm). */
export function cooler(p: Place, rand: Rand): void {
  p.box(0x3a3c3e, 0, 0, 0.35, 1.2, 2.0, 0.7, 'metal', true);
  p.box(0x0e1214, 0, 0.1, 0.705, 1.1, 1.8, 0.005, 'metal');
  for (const y of [0.25, 0.75, 1.25]) for (let x = -0.45; x < 0.5; x += 0.15) if (rand() < 0.5) p.cyl(pick(rand, [0x6a3a2a, 0x3a6a4a, 0xa09060, 0x5a7aa0]), x, y + 0.12, 0.6, 0.035, 0.24, 'glass');
  p.box(0x6a7a84, 0, 0.1, 0.72, 1.1, 1.8, 0.01, 'windowGlass');
  p.container('cooler', 0, 0.95);
}

/** Shop counter with a cash register (drawer out), facing +Z customers. */
export function shopCounter(p: Place, rand: Rand, kind: ShopKind): void {
  p.box(0x6d6250, 0, 0, 0.35, 2.2, 1.0, 0.7, 'wood', true);
  p.box(0x9a9483, 0, 1.0, 0.35, 2.3, 0.04, 0.78, 'plaster');
  p.box(0x2a2a2a, -0.6, 1.04, 0.3, 0.38, 0.22, 0.34, 'metal');
  p.box(0x4a4a44, -0.6, 0.95, 0.62, 0.34, 0.08, 0.3, 'metal');
  if (kind === 'cafe') {
    // Espresso machine and a pastry case.
    p.box(0x8a8a86, 0.55, 1.04, 0.3, 0.5, 0.42, 0.4, 'metal');
    p.box(0x6a7a84, 0.55, 1.04, 0.62, 0.9, 0.3, 0.005, 'windowGlass');
  }
  papers(p, rand, -1.2, 0.9, 1.2, 1.6, 3);
  p.container(kind === 'cafe' ? 'cafe' : 'shopCounter', 0, 0.9);
}

/** Small round café table on a pole, two chairs; sometimes knocked over. */
export function cafeTable(p: Place, rand: Rand, messy = false): void {
  const down = messy && rand() < 0.5;
  const q = down ? p.tipped(rand() * 6, 0, Math.PI / 2, 0.38) : p;
  q.cyl(0x8a7a60, 0, 0.74, 0, 0.38, 0.03, 'wood');
  q.box(0x2a2a2a, 0, 0, 0, 0.05, 0.73, 0.05, 'metal');
  q.cyl(0x2a2a2a, 0, 0.01, 0, 0.22, 0.02, 'metal');
  if (!down) {
    p.solid(0, 0, 0.6, 0.6, 0.76);
    if (rand() < 0.6) p.cyl(CERAMIC, 0.1, 0.8, 0.05, 0.04, 0.08, 'plaster');
  }
  for (const [x, z, r] of [
    [0, -0.6, 0],
    [0, 0.6, 2],
  ] as [number, number, Quarter][]) {
    if (messy && rand() < 0.5) chairDown(p.at(x, z * 1.4, r), rand, 0x3a3a34);
    else chair(p.at(x + (rand() - 0.5) * 0.2, z, r), rand, 0x3a3a34);
  }
}

/** Front-loading washing machine (or a dryer stacked on one); the porthole sometimes hangs open. */
export function washer(p: Place, rand: Rand, stacked = false): void {
  const top = stacked ? 1.7 : 0.85;
  p.box(0xc8c4b8, 0, 0, 0.3, 0.62, top, 0.6, 'metal', true);
  for (let k = 0; k < (stacked ? 2 : 1); k++) {
    const cy = 0.42 + k * 0.85;
    p.cyl(0x2a2e30, 0, cy, 0.61, 0.21, 0.02, 'metal', Math.PI / 2);
    if (rand() < 0.3) p.cyl(0x8a8e90, -0.3, cy, 0.85, 0.2, 0.03, 'metal', Math.PI / 2);
    else p.cyl(0x4a5a64, 0, cy, 0.625, 0.16, 0.01, 'glass', Math.PI / 2);
    p.box(0x8a8678, 0, cy + 0.32, 0.605, 0.5, 0.06, 0.01, 'metal');
  }
  p.container('laundry', 0, 0.8);
}
