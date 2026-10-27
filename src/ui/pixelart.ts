import type { ItemId } from '../data/items';
import { ITEMS } from '../data/items';
import type { Worn } from '../systems/Inventory';

/**
 * Lo-fi pixel art drawn in code: every icon is a few primitives on a 16×16 grid, then one shared
 * pass adds a dark outline and top-light / bottom-shade, so all icons read as one hand-made set.
 * Rendered once to data URLs and shown with `image-rendering: pixelated`.
 */
class Sprite {
  readonly px: Uint32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Uint32Array(w * h);
  }

  dot(x: number, y: number, c: number): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = 0xff000000 | c;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.dot(x + i, y + j, c);
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, c: number): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / (rx + 0.5);
        const dy = (y - cy) / (ry + 0.5);
        if (dx * dx + dy * dy <= 1) this.dot(x, y, c);
      }
    }
  }

  /** Bresenham line, optionally `t` pixels thick (perpendicular offset). */
  line(x0: number, y0: number, x1: number, y1: number, c: number, t = 1): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const y = y0 + ((y1 - y0) * k) / n;
      for (let a = 0; a < t; a++) this.dot(x + (Math.abs(y1 - y0) > Math.abs(x1 - x0) ? a : 0), y + (Math.abs(y1 - y0) > Math.abs(x1 - x0) ? 0 : a), c);
    }
  }

  /** Outline + volume: lighten the top edge of each shape, darken its bottom edge. */
  finish(outline = 0x16110e): void {
    const { w, h, px } = this;
    const src = px.slice();
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[y * w + x] !== 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (src[i] !== 0) {
          const up = y > 0 && src[i - w] !== 0;
          const down = y < h - 1 && src[i + w] !== 0;
          if (!up) px[i] = shade(src[i], 1.28);
          else if (!down) px[i] = shade(src[i], 0.7);
          continue;
        }
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) px[i] = 0xff000000 | outline;
      }
    }
  }

  toDataURL(): string {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) {
      const p = this.px[i];
      img.data[i * 4] = (p >> 16) & 255;
      img.data[i * 4 + 1] = (p >> 8) & 255;
      img.data[i * 4 + 2] = p & 255;
      img.data[i * 4 + 3] = p === 0 ? 0 : 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }
}

function shade(argb: number, k: number): number {
  const r = Math.min(255, Math.round(((argb >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((argb >> 8) & 255) * k));
  const b = Math.min(255, Math.round((argb & 255) * k));
  return 0xff000000 | (r << 16) | (g << 8) | b;
}

const C = {
  tin: 0x9a9c96,
  tinLight: 0xc8c8be,
  steel: 0xa8acae,
  steelDark: 0x5a5e62,
  wood: 0x8a6440,
  woodDark: 0x5e4228,
  blood: 0x6a1410,
  paper: 0xd8d0b8,
  white: 0xe6e2d6,
  black: 0x24221f,
  rust: 0x8a4a2a,
} as const;

/** A tin can with a colored label (and a dent). */
function can(s: Sprite, label: number, mark: number): void {
  s.rect(4, 3, 8, 11, C.tin);
  s.rect(4, 6, 8, 5, label);
  s.rect(4, 3, 8, 1, C.tinLight);
  s.line(5, 4, 5, 12, C.tinLight);
  s.dot(7, 8, mark);
  s.dot(9, 7, mark);
  s.dot(8, 9, mark);
  s.dot(11, 12, C.steelDark);
}

/** Garment helpers in the 16×16 frame. */
function top(s: Sprite, c: number, hood: boolean, pockets: boolean, zip: number | null): void {
  s.rect(4, 3, 8, 11, c);
  s.line(4, 3, 1, 10, c, 2);
  s.line(11, 3, 14, 10, c, 2);
  s.rect(1, 10, 2, 2, shadeRGB(c, 0.75));
  s.rect(13, 10, 2, 2, shadeRGB(c, 0.75));
  s.rect(4, 13, 8, 1, shadeRGB(c, 0.75));
  if (hood) s.rect(6, 1, 4, 3, shadeRGB(c, 0.85));
  else s.rect(6, 2, 4, 2, shadeRGB(c, 1.2));
  if (zip !== null) s.line(8, 4, 8, 13, zip);
  if (pockets) {
    s.rect(5, 9, 2, 2, shadeRGB(c, 0.8));
    s.rect(9, 9, 2, 2, shadeRGB(c, 0.8));
  }
}

function pants(s: Sprite, c: number, cargo: boolean): void {
  s.rect(4, 1, 8, 2, shadeRGB(c, 0.8));
  s.rect(4, 3, 8, 3, c);
  s.rect(4, 6, 3, 9, c);
  s.rect(9, 6, 3, 9, c);
  s.line(8, 3, 8, 5, shadeRGB(c, 0.7));
  if (cargo) {
    s.rect(3, 8, 2, 3, shadeRGB(c, 0.85));
    s.rect(11, 8, 2, 3, shadeRGB(c, 0.85));
  } else {
    s.dot(5, 4, 0xc8a050);
    s.dot(10, 4, 0xc8a050);
  }
}

function shoeIcon(s: Sprite, c: number, boot: boolean): void {
  if (boot) {
    s.rect(4, 2, 5, 8, c);
    s.rect(4, 9, 10, 3, c);
    s.rect(3, 12, 12, 2, 0x221e1a);
    s.dot(5, 13, 0x3a342e);
    s.dot(8, 13, 0x3a342e);
    s.dot(11, 13, 0x3a342e);
    for (let y = 3; y < 9; y += 2) s.line(8, y, 9, y, 0x2a2018);
  } else {
    s.rect(3, 7, 5, 4, c);
    s.rect(6, 8, 7, 3, c);
    s.ellipse(12, 10, 2, 1.5, c);
    s.rect(2, 11, 13, 2, 0xd8d0be);
    s.line(7, 8, 10, 8, 0xd6cfbf);
    s.line(4, 9, 8, 9, shadeRGB(c, 1.3));
  }
}

function shadeRGB(c: number, k: number): number {
  return shade(c, k) & 0xffffff;
}

/** One draw routine per item. */
const DRAW: Record<ItemId, (s: Sprite) => void> = {
  beans: (s) => can(s, 0x8c3a24, 0xd8b070),
  soup: (s) => can(s, 0x3a5a7a, 0xe0dccc),
  chips: (s) => {
    s.rect(3, 2, 10, 12, 0xd0a030);
    for (let x = 3; x < 13; x += 2) s.dot(x, 1, 0xa07818);
    s.rect(3, 6, 10, 2, 0x9a2a1e);
    s.ellipse(8, 10, 3, 2, 0xf0d070);
  },
  chocolate: (s) => {
    s.rect(2, 4, 12, 8, 0x5a3420);
    s.line(6, 4, 6, 7, 0x3e2214);
    s.line(10, 4, 10, 7, 0x3e2214);
    s.rect(2, 8, 12, 4, 0xa02a26);
    s.line(2, 8, 13, 8, C.steel);
    s.rect(5, 9, 6, 2, 0xd8c070);
  },
  apple: (s) => {
    s.ellipse(8, 9, 5, 5, 0x8e3226);
    s.ellipse(10, 11, 1.5, 1.5, 0x5a2618);
    s.dot(6, 7, 0xd87060);
    s.line(8, 2, 8, 4, C.woodDark);
    s.dot(9, 3, 0x4a7a2a);
    s.dot(10, 3, 0x4a7a2a);
  },
  crackers: (s) => {
    s.rect(3, 3, 10, 10, 0x2a5a8a);
    s.rect(4, 5, 4, 4, 0xd8b060);
    s.rect(8, 7, 4, 4, 0xd8b060);
    s.dot(5, 6, 0xa07830);
    s.dot(10, 9, 0xa07830);
  },
  water: (s) => {
    s.rect(7, 1, 2, 2, 0x2a5aa0);
    s.rect(6, 3, 4, 1, 0x9ab8c8);
    s.rect(5, 4, 6, 11, 0x8aaabb);
    s.rect(5, 8, 6, 3, 0x2a6aa0);
    s.line(6, 5, 6, 13, 0xcfe4ee);
  },
  soda: (s) => {
    s.rect(5, 2, 6, 12, 0x2a6a3a);
    s.rect(5, 2, 6, 1, C.tinLight);
    s.line(5, 7, 10, 5, 0xe0dccc);
    s.line(5, 8, 10, 6, 0xe0dccc);
    s.dot(7, 1, C.steel);
  },
  juice: (s) => {
    s.rect(4, 5, 8, 10, 0xe2dac2);
    s.line(4, 5, 8, 2, 0xe2dac2, 2);
    s.line(11, 5, 8, 2, 0xc8c0a8, 2);
    s.ellipse(8, 10, 2.5, 2.5, 0xe08a20);
    s.line(10, 0, 10, 3, 0xd04040);
  },
  bandage: (s) => {
    s.ellipse(7, 9, 5, 4, C.white);
    s.ellipse(7, 9, 2, 1.5, 0xb8b2a2);
    s.rect(11, 10, 4, 2, C.white);
    s.dot(13, 10, 0xb03030);
  },
  rag: (s) => {
    s.rect(3, 5, 10, 7, 0xb8b0a0);
    s.rect(2, 7, 2, 4, 0xb8b0a0);
    s.rect(12, 4, 2, 3, 0xb8b0a0);
    s.line(4, 8, 11, 7, 0x8a8478);
    s.line(5, 10, 10, 10, 0x8a8478);
  },
  painkillers: (s) => {
    s.rect(4, 2, 8, 3, C.white);
    s.rect(5, 5, 6, 9, 0xd07a20);
    s.rect(5, 8, 6, 3, C.white);
    s.dot(7, 9, 0xb03030);
    s.dot(8, 9, 0xb03030);
  },
  antibiotics: (s) => {
    s.rect(2, 4, 12, 8, C.steel);
    for (let y = 6; y <= 9; y += 3) for (let x = 4; x <= 11; x += 3) s.rect(x, y, 2, 2, x % 2 ? 0x3a6ab0 : C.white);
  },
  batteries: (s) => {
    for (const x of [4, 9]) {
      s.rect(x, 4, 3, 10, C.black);
      s.rect(x, 4, 3, 3, 0xc08830);
      s.dot(x + 1, 3, C.steel);
    }
  },
  knife: (s) => {
    s.line(6, 9, 13, 2, C.steel, 2);
    s.line(7, 10, 13, 4, C.steelDark);
    s.line(2, 14, 6, 10, C.woodDark, 2);
    s.dot(10, 5, C.blood);
    s.dot(11, 5, C.blood);
  },
  bat: (s) => {
    s.line(2, 14, 13, 3, 0xb08850, 2);
    s.line(9, 7, 13, 3, 0xb08850, 3);
    s.line(3, 13, 5, 11, C.black, 2);
    s.dot(1, 15, C.woodDark);
    s.dot(12, 5, C.blood);
  },
  hammer: (s) => {
    s.line(3, 14, 10, 7, C.wood, 2);
    s.line(7, 3, 13, 9, C.steelDark, 3);
    s.dot(13, 10, C.steelDark);
  },
  crowbar: (s) => {
    s.line(3, 14, 12, 3, 0x8a2a20, 2);
    s.line(12, 3, 14, 4, 0x8a2a20, 2);
    s.dot(14, 6, 0x8a2a20);
    s.line(2, 15, 3, 14, C.steelDark);
  },
  axe: (s) => {
    s.line(3, 15, 11, 3, 0x8a3a24, 2);
    s.rect(9, 1, 6, 4, C.steelDark);
    s.line(14, 1, 14, 6, C.steel);
    s.rect(10, 5, 3, 1, C.steelDark);
    s.dot(13, 3, C.blood);
  },
  nails: (s) => {
    for (const [x, y] of [
      [3, 4],
      [7, 3],
      [11, 5],
      [5, 8],
    ]) {
      s.rect(x - 1, y, 3, 1, C.steelDark);
      s.line(x, y + 1, x, y + 7, C.steel);
    }
  },
  planks: (s) => {
    s.rect(1, 4, 14, 3, C.wood);
    s.rect(1, 9, 14, 3, 0x7a5636);
    s.line(3, 5, 9, 5, C.woodDark);
    s.line(6, 10, 13, 10, C.woodDark);
    s.dot(2, 5, C.steelDark);
    s.dot(13, 10, C.steelDark);
  },
  rope: (s) => {
    s.ellipse(8, 8, 6, 5, 0xb89a60);
    clearEllipse(s, 8, 8, 2.5, 1.5);
    s.line(13, 11, 15, 15, 0xb89a60);
  },
  tape: (s) => {
    s.ellipse(8, 8, 6, 6, 0x8a8c8e);
    clearEllipse(s, 8, 8, 2.5, 2.5);
    s.rect(12, 10, 3, 4, 0x8a8c8e);
  },
  lighter: (s) => {
    s.rect(6, 5, 5, 9, 0xc03424);
    s.rect(6, 2, 5, 3, C.steel);
    s.dot(9, 1, C.steelDark);
    s.line(7, 6, 7, 12, 0xe06850);
  },
  matches: (s) => {
    s.rect(2, 7, 12, 7, 0xd8c090);
    s.rect(4, 9, 8, 3, 0xa02820);
    for (const x of [5, 8, 11]) {
      s.line(x, 3, x, 7, C.paper);
      s.dot(x, 2, 0xb02020);
    }
  },
  junk: (s) => {
    s.line(2, 12, 9, 5, C.rust, 2);
    s.line(9, 5, 13, 7, C.rust, 2);
    s.ellipse(11, 12, 2, 2, C.steelDark);
    clearEllipse(s, 11, 12, 0.6, 0.6);
    s.rect(3, 3, 3, 2, 0x4a6a3a);
  },
  cap: (s) => {
    s.ellipse(8, 9, 5, 4, ITEMS.cap.wear!.color);
    clearRect(s, 2, 10, 14, 5);
    s.rect(8, 9, 7, 2, shadeRGB(ITEMS.cap.wear!.color, 0.8));
    s.dot(8, 5, shadeRGB(ITEMS.cap.wear!.color, 1.4));
  },
  beanie: (s) => {
    const c = ITEMS.beanie.wear!.color;
    s.ellipse(8, 9, 5, 5, c);
    clearRect(s, 2, 11, 14, 5);
    s.rect(3, 10, 11, 3, shadeRGB(c, 0.8));
    for (let x = 4; x < 13; x += 2) s.line(x, 10, x, 12, shadeRGB(c, 0.65));
    s.ellipse(8, 3, 1.5, 1.5, 0xd8d0c0);
  },
  hardhat: (s) => {
    const c = ITEMS.hardhat.wear!.color;
    s.ellipse(8, 9, 5, 5, c);
    clearRect(s, 2, 10, 14, 6);
    s.rect(1, 10, 14, 2, shadeRGB(c, 0.85));
    s.line(8, 4, 8, 9, shadeRGB(c, 1.25));
  },
  hoodie: (s) => top(s, ITEMS.hoodie.wear!.color, true, true, null),
  leatherJacket: (s) => top(s, ITEMS.leatherJacket.wear!.color, false, false, 0x9a9c96),
  workJacket: (s) => top(s, ITEMS.workJacket.wear!.color, false, true, 0x3a3428),
  jeans: (s) => pants(s, ITEMS.jeans.wear!.color, false),
  cargoPants: (s) => pants(s, ITEMS.cargoPants.wear!.color, true),
  sneakers: (s) => shoeIcon(s, ITEMS.sneakers.wear!.color, false),
  boots: (s) => shoeIcon(s, ITEMS.boots.wear!.color, true),
};

function clearEllipse(s: Sprite, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / (rx + 0.5);
      const dy = (y - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1 && x >= 0 && y >= 0 && x < s.w && y < s.h) s.px[y * s.w + x] = 0;
    }
  }
}

function clearRect(s: Sprite, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.px[y * s.w + x] = 0;
}

const iconCache = new Map<ItemId, string>();

/** Data URL of the item's 16×16 icon (cached). */
export function itemIcon(id: ItemId): string {
  let url = iconCache.get(id);
  if (!url) {
    const s = new Sprite(16, 16);
    DRAW[id](s);
    s.finish();
    url = s.toDataURL();
    iconCache.set(id, url);
  }
  return url;
}

const SKIN = 0xc8946c;
const HAIR = 0x3a2a1e;

/**
 * Paper doll, 32×64: the survivor in what they wear right now (bare skin and underwear where
 * a slot is empty), plus the weapon in the right hand. Shown scaled ×3 in the inventory.
 */
export function dollImage(worn: Worn, hand: ItemId | null): string {
  const s = new Sprite(32, 64);
  const col = (id: ItemId | null) => (id ? ITEMS[id].wear!.color : null);
  const torso = col(worn.torso);
  const legs = col(worn.legs);
  const feet = worn.feet ? ITEMS[worn.feet].wear! : null;

  // Head and neck.
  s.ellipse(16, 7, 4, 5, SKIN);
  s.rect(12, 3, 9, 3, HAIR);
  s.dot(14, 8, 0x2a1a12);
  s.dot(18, 8, 0x2a1a12);
  s.rect(14, 12, 5, 2, SKIN);

  // Arms (sleeves or skin) and hands.
  const arm = torso ?? SKIN;
  s.rect(7, 15, 3, 15, arm);
  s.rect(23, 15, 3, 15, arm);
  s.rect(7, 30, 3, 3, SKIN);
  s.rect(23, 30, 3, 3, SKIN);
  // Torso: jacket or an undershirt.
  s.rect(10, 14, 13, 17, torso ?? 0x8a8a82);
  if (torso !== null) {
    s.line(16, 15, 16, 30, shadeRGB(torso, 0.7));
    s.rect(10, 14, 13, 1, shadeRGB(torso, 1.2));
  }
  // Hips and legs.
  s.rect(10, 31, 13, 4, legs ?? 0x4e4e5a);
  s.rect(10, 35, 6, 18, legs ?? SKIN);
  s.rect(17, 35, 6, 18, legs ?? SKIN);
  if (legs === null) {
    s.rect(10, 35, 6, 3, 0x4e4e5a);
    s.rect(17, 35, 6, 3, 0x4e4e5a);
  }
  // Feet.
  if (feet?.shoe === 'boots') {
    s.rect(9, 50, 7, 9, feet.color);
    s.rect(17, 50, 7, 9, feet.color);
    s.rect(9, 58, 7, 2, 0x221e1a);
    s.rect(17, 58, 7, 2, 0x221e1a);
  } else if (feet) {
    s.rect(9, 53, 7, 5, feet.color);
    s.rect(17, 53, 7, 5, feet.color);
    s.rect(9, 58, 7, 2, 0xd8d0be);
    s.rect(17, 58, 7, 2, 0xd8d0be);
  } else {
    s.rect(10, 53, 6, 6, SKIN);
    s.rect(17, 53, 6, 6, SKIN);
  }
  // Headwear.
  const head = worn.head;
  if (head) {
    const c = ITEMS[head].wear!.color;
    if (head === 'cap') {
      s.rect(11, 1, 10, 4, c);
      s.rect(19, 4, 5, 1, shadeRGB(c, 0.8));
    } else if (head === 'beanie') {
      s.rect(11, 0, 10, 5, c);
      s.rect(11, 4, 10, 1, shadeRGB(c, 0.75));
    } else {
      s.ellipse(16, 4, 6, 4, c);
      clearRect(s, 9, 5, 24, 6);
      s.rect(9, 4, 15, 1, shadeRGB(c, 0.85));
    }
  }
  // Weapon held in the right hand (screen left).
  if (hand) {
    const steel = 0x8a8e92;
    if (hand === 'knife') s.line(8, 33, 8, 40, steel);
    else if (hand === 'axe') {
      s.line(8, 26, 8, 44, 0x8a3a24);
      s.rect(4, 26, 4, 4, steel);
    } else if (hand === 'bat') s.line(8, 22, 8, 44, 0xb08850, 2);
    else if (hand === 'crowbar') s.line(8, 24, 8, 44, 0x8a2a20);
    else if (hand === 'hammer') {
      s.line(8, 30, 8, 40, 0x8a6440);
      s.rect(6, 29, 5, 2, 0x5a5e62);
    }
  }
  s.finish();
  return s.toDataURL();
}
