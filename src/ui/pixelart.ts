import type { ItemId } from '../data/items';
import { ITEMS } from '../data/items';
import { RENDERED_ITEM_ICONS } from './renderedIcons';

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
const DRAW: Partial<Record<ItemId, (s: Sprite) => void>> = {
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
  emptyBottle: (s) => {
    s.rect(7, 1, 2, 2, 0x4a5a64);
    s.rect(6, 3, 4, 1, 0x8a9aa0);
    s.rect(5, 4, 6, 11, 0x6e7c82);
    s.rect(6, 5, 4, 9, 0x3a4248);
    s.line(6, 5, 6, 13, 0xa8b4b8);
  },
  dirtyWater: (s) => {
    s.rect(7, 1, 2, 2, 0x4a5a64);
    s.rect(6, 3, 4, 1, 0x8a9aa0);
    s.rect(5, 4, 6, 11, 0x7a8a7c);
    s.rect(5, 7, 6, 8, 0x5a6a50);
    s.dot(7, 11, 0x3e4434);
    s.dot(9, 9, 0x3e4434);
    s.line(6, 5, 6, 13, 0xa8b4a8);
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
    // Clean rolled sterile gauze bandage with spiral top, shaded wrap & unrolled tail.
    s.rect(3, 5, 8, 8, 0xd8d3c4);
    s.rect(3, 5, 8, 2, C.white);
    s.rect(3, 11, 8, 2, 0xb6b0a0);
    s.ellipse(7, 5, 4, 2, C.white);
    s.ellipse(7, 5, 2, 1, 0x9b9586);
    s.dot(7, 5, 0x6f6a5e);
    // Unrolled gauze strip on the right + small red medical cross.
    s.rect(10, 9, 5, 3, C.white);
    s.rect(11, 11, 4, 1, 0xc4beb0);
    s.line(6, 8, 6, 10, 0xc83838);
    s.line(5, 9, 7, 9, 0xc83838);
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
  },
  bat: (s) => {
    s.line(2, 14, 13, 3, 0xb08850, 2);
    s.line(9, 7, 13, 3, 0xb08850, 3);
    s.line(3, 13, 5, 11, C.black, 2);
    s.dot(1, 15, C.woodDark);
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
  map: (s) => {
    s.rect(2, 3, 12, 10, C.paper);
    s.line(5, 3, 5, 12, 0xb8b0a0);
    s.line(10, 3, 10, 12, 0xb8b0a0);
    s.line(2, 9, 13, 6, 0x6a8a5a, 1);
    s.line(4, 5, 12, 11, 0xa04030, 1);
    s.dot(8, 8, 0x3a5a9a);
  },
  walkie: (s) => {
    s.rect(5, 4, 6, 10, C.black);
    s.rect(9, 1, 1, 4, C.steelDark);
    s.rect(6, 6, 4, 3, 0x5a6a5a);
    s.dot(7, 11, 0xb03030);
  },
  armoryKey: (s) => {
    s.ellipse(5, 6, 3, 3, 0xb89a50);
    clearEllipse(s, 5, 6, 1.2, 1.2);
    s.line(7, 8, 13, 13, 0xb89a50, 2);
    s.rect(11, 12, 2, 2, 0xb89a50);
    s.rect(1, 10, 4, 3, 0xd04030);
  },
  armoryNote: (s) => {
    s.rect(3, 2, 10, 12, C.paper);
    for (const y of [5, 8, 11]) s.line(5, y, 11, y, 0x6a6458);
    s.rect(4, 3, 3, 2, 0xd0b040);
  },
  keycardGreen: (s) => {
    s.rect(2, 4, 12, 8, 0x3a8a4a);
    s.rect(2, 6, 12, 2, C.black);
    s.rect(4, 9, 4, 2, C.white);
  },
  keycardBlue: (s) => {
    s.rect(2, 4, 12, 8, 0x3a5aa0);
    s.rect(2, 6, 12, 2, C.black);
    s.rect(4, 9, 4, 2, C.white);
  },
  fuse: (s) => {
    s.rect(6, 3, 4, 10, 0xd8d0c0);
    s.rect(5, 2, 6, 2, C.steel);
    s.rect(5, 12, 6, 2, C.steel);
    s.line(8, 5, 8, 10, 0xb08a30);
  },
  labNote1: (s) => {
    s.rect(3, 2, 10, 12, C.paper);
    for (const y of [5, 8, 11]) s.line(5, y, 11, y, 0x6a6458);
    s.rect(10, 3, 2, 2, 0x3a8a4a);
  },
  labNote2: (s) => {
    s.rect(3, 2, 10, 12, C.paper);
    for (const y of [5, 8, 11]) s.line(5, y, 11, y, 0x6a6458);
    s.rect(10, 3, 2, 2, 0x3a6ab0);
  },
  labNote3: (s) => {
    s.rect(3, 2, 10, 12, C.paper);
    for (const y of [5, 8, 11]) s.line(5, y, 11, y, 0x6a6458);
    s.rect(10, 3, 2, 2, 0xb08a30);
  },
  labNote4: (s) => {
    s.rect(3, 2, 10, 12, C.white);
    for (let y = 4; y < 13; y += 2) s.line(4, y, 11, y, 0x3a3a3a);
  },
  labJournal1: (s) => {
    s.rect(3, 2, 10, 12, 0x1e4a4e);
    s.rect(5, 5, 6, 2, C.white);
  },
  labJournal2: (s) => {
    s.rect(3, 2, 10, 12, 0x2a2c30);
    s.rect(3, 2, 2, 12, 0x5a5048);
    s.rect(6, 5, 5, 1, C.paper);
  },
  labJournal3: (s) => {
    s.rect(3, 2, 10, 12, C.paper);
    for (const y of [5, 8]) s.line(5, y, 11, y, 0x6a6458);
    s.line(5, 11, 8, 11, 0x6a6458);
  },
  campNote1: (s) => {
    s.rect(3, 2, 10, 12, 0x5a4a3a);
    s.rect(4, 3, 8, 10, C.paper);
    for (const y of [5, 7, 9, 11]) s.line(5, y, 11, y, 0x6a6458);
  },
  campNote2: (s) => {
    s.rect(3, 2, 10, 12, C.paper);
    for (const y of [4, 6, 8, 10, 12]) s.line(5, y, 11, y, 0x3a5a9a);
  },
  campNote3: (s) => {
    s.rect(4, 3, 8, 10, 0xc8b890);
    for (const y of [6, 9]) s.line(5, y, 10, y, 0x5a4a3a);
  },
  campNote4: (s) => {
    s.rect(2, 3, 12, 10, 0xd8d0b0);
    s.line(4, 5, 11, 10, 0x6a8a5a);
    s.dot(6, 7, 0xb03030);
    s.dot(10, 6, 0xb03030);
  },
  ration: (s) => {
    s.rect(2, 4, 12, 9, 0x5a5e3e);
    s.rect(2, 4, 12, 2, 0x4a4e32);
    s.rect(5, 8, 6, 3, 0xc8c0a0);
  },
  serumG7: (s) => {
    s.rect(6, 2, 4, 2, C.steelDark);
    s.rect(5, 4, 6, 10, 0xc8d8dc);
    s.rect(6, 7, 4, 6, 0x6ab0a0);
  },
  junk: (s) => {
    s.line(2, 12, 9, 5, C.rust, 2);
    s.line(9, 5, 13, 7, C.rust, 2);
    s.ellipse(11, 12, 2, 2, C.steelDark);
    clearEllipse(s, 11, 12, 0.6, 0.6);
    s.rect(3, 3, 3, 2, 0x4a6a3a);
  },
  soap: (s) => {
    s.rect(3, 6, 10, 6, 0xd8cfa8);
    s.rect(4, 5, 8, 1, 0xe8e0bc);
    s.line(5, 8, 10, 8, 0xb8ae88);
    s.dot(13, 4, 0xe6e8ea);
    s.dot(12, 2, 0xe6e8ea);
    s.dot(14, 1, 0xe6e8ea);
  },
  tshirt: (s) => {
    const c = ITEMS.tshirt.wear!.color;
    s.rect(4, 3, 8, 11, c);
    s.rect(1, 3, 3, 4, c);
    s.rect(12, 3, 3, 4, c);
    s.rect(6, 3, 4, 1, shadeRGB(c, 0.7));
  },
  hoodie: (s) => top(s, ITEMS.hoodie.wear!.color, true, true, null),
  leatherJacket: (s) => top(s, ITEMS.leatherJacket.wear!.color, false, false, 0x9a9c96),
  workJacket: (s) => top(s, ITEMS.workJacket.wear!.color, false, true, 0x3a3428),
  jeans: (s) => pants(s, ITEMS.jeans.wear!.color, false),
  cargoPants: (s) => pants(s, ITEMS.cargoPants.wear!.color, true),
  sneakers: (s) => shoeIcon(s, ITEMS.sneakers.wear!.color, false),
  boots: (s) => shoeIcon(s, ITEMS.boots.wear!.color, true),
};

// ── Firearms, rounds, magazines, mods: drawn from the models (muzzle to the right, side view). ──
const G = {
  poly: 0x34363a,
  polyLight: 0x4a4d50,
  metal: 0x55595c,
  blued: 0x3e4246,
  wood: 0x7a5636,
  woodDark: 0x553a24,
  brass: 0xa88a48,
  olive: 0x4e5636,
  shell: 0x6e3b2e,
} as const;

/** A cartridge standing upright: case, then the bullet. */
function round(s: Sprite, x: number, y: number, h: number, w: number, tip: number, cas: number = G.brass): void {
  s.rect(x, y + 2, w, h - 2, cas);
  s.rect(x + (w > 2 ? 1 : 0), y, Math.max(1, w - (w > 2 ? 2 : 0)), 2, tip);
  s.rect(x, y + h - 1, w, 1, shadeRGB(cas, 0.7));
}

/** A box magazine leaning a little forward, with the top round showing. */
function magIcon(s: Sprite, c: number, len: number, curve: number): void {
  for (let i = 0; i < len; i++) s.rect(6 + Math.round((i * curve) / len), 2 + i, 4, 1, c);
  s.rect(6, 2, 4, 1, shadeRGB(c, 1.3));
  s.rect(7, 1, 2, 1, G.brass);
  s.rect(6 + curve, 2 + len, 4, 1, shadeRGB(c, 0.7));
}

const GUN_DRAW: Partial<Record<ItemId, (s: Sprite) => void>> = {
  pistol_g17: (s) => {
    s.rect(2, 4, 12, 3, G.poly); // slide
    s.rect(2, 4, 12, 1, G.polyLight);
    s.rect(13, 3, 1, 1, G.poly); // front sight
    s.rect(3, 3, 1, 1, G.poly);
    s.rect(4, 7, 9, 2, G.blued); // frame
    s.line(5, 9, 3, 14, G.poly, 3); // grip
    s.rect(7, 9, 3, 2, G.blued); // trigger guard
    s.dot(8, 9, 0x1e1f1d);
  },
  pistol_m1911: (s) => {
    s.rect(2, 4, 12, 3, G.metal);
    s.rect(2, 4, 12, 1, 0x7a7e80);
    s.rect(13, 3, 1, 1, G.metal);
    s.rect(2, 3, 2, 1, G.metal); // hammer
    s.rect(4, 7, 9, 2, G.metal);
    s.line(5, 9, 3, 14, G.wood, 3); // wooden grip panels
    s.line(5, 10, 4, 13, G.woodDark);
    s.rect(7, 9, 3, 2, G.metal);
    s.dot(8, 9, 0x1e1f1d);
  },
  shotgun_pump: (s) => {
    s.rect(4, 6, 12, 1, G.blued); // barrel
    s.rect(4, 7, 11, 1, G.metal); // tube under it
    s.rect(9, 7, 4, 2, G.wood); // pump
    s.rect(3, 5, 6, 3, G.blued); // receiver
    s.line(3, 7, 0, 10, G.wood, 3); // stock
    s.rect(4, 8, 2, 2, G.blued); // trigger guard
    s.dot(15, 5, G.metal); // bead
  },
  rifle_m4a1: (s) => {
    s.rect(5, 6, 8, 2, G.poly); // handguard
    s.rect(13, 6, 3, 1, G.blued); // barrel
    s.rect(3, 5, 5, 3, G.blued); // receiver
    s.rect(3, 4, 4, 1, G.poly); // rail / carry
    s.rect(11, 4, 1, 2, G.poly); // front sight post
    s.rect(6, 8, 2, 4, G.poly); // magazine
    s.dot(4, 8, G.poly); // grip
    s.line(4, 9, 3, 11, G.poly, 2);
    s.rect(0, 5, 3, 3, G.poly); // stock
    s.rect(0, 8, 1, 1, G.poly);
  },
  rifle_ak: (s) => {
    s.rect(6, 6, 5, 2, G.wood); // handguard
    s.rect(11, 6, 5, 1, G.blued); // barrel
    s.rect(9, 5, 5, 1, G.blued); // gas tube
    s.rect(14, 4, 1, 2, G.blued); // front sight
    s.rect(3, 5, 4, 3, G.blued); // receiver
    for (let i = 0; i < 5; i++) s.rect(6 + Math.round(i * 0.5), 8 + i, 2, 1, G.shell); // curved magazine
    s.line(4, 8, 3, 11, G.wood, 2); // grip
    s.line(3, 6, 0, 8, G.wood, 2); // stock
    s.rect(0, 9, 1, 1, G.woodDark);
  },
  rifle_hunting: (s) => {
    s.rect(4, 5, 12, 1, G.blued); // barrel
    s.rect(4, 6, 9, 2, G.wood); // fore-end
    s.rect(3, 5, 4, 2, G.blued); // action
    s.dot(5, 4, G.metal); // bolt handle
    s.dot(6, 4, G.metal);
    s.line(4, 7, 0, 10, G.wood, 3); // stock
    s.rect(4, 8, 2, 1, G.blued);
    s.dot(15, 4, G.blued); // front sight
  },
  launcher_rpg: (s) => {
    s.rect(1, 6, 10, 2, G.olive); // tube
    s.rect(1, 5, 2, 4, G.blued);
    s.rect(4, 5, 3, 1, G.woodDark); // heat shield
    s.rect(11, 5, 2, 4, G.olive); // warhead body
    s.rect(13, 6, 2, 2, G.olive);
    s.dot(15, 6, G.olive);
    s.dot(15, 7, G.olive);
    s.rect(5, 8, 1, 3, G.blued); // grips
    s.rect(8, 8, 1, 3, G.blued);
  },
  rocket_rpg: (s) => {
    s.line(2, 14, 8, 8, G.olive, 2); // motor
    s.ellipse(10, 6, 2.5, 2.5, G.olive); // warhead
    s.line(11, 5, 14, 2, G.olive, 2);
    s.dot(15, 1, G.olive);
    s.line(1, 13, 3, 15, G.metal); // fins
  },
  ammo_9mm: (s) => {
    for (const [x, y] of [[3, 6], [7, 5], [11, 6]] as const) round(s, x, y, 6, 2, G.brass);
    s.rect(2, 12, 12, 2, 0x5a5448);
  },
  ammo_45: (s) => {
    for (const [x, y] of [[3, 6], [7, 5], [11, 6]] as const) round(s, x, y, 6, 3, G.metal);
    s.rect(2, 12, 13, 2, 0x5a5448);
  },
  ammo_12: (s) => {
    for (const [x, y] of [[2, 4], [7, 3], [12, 4]] as const) {
      s.rect(x, y, 3, 8, G.shell);
      s.rect(x, y + 8, 3, 2, G.brass);
      s.rect(x + 1, y, 1, 1, shadeRGB(G.shell, 0.7));
    }
  },
  ammo_556: (s) => {
    for (const [x, y] of [[3, 3], [7, 2], [11, 3]] as const) {
      round(s, x, y, 10, 2, G.brass);
      s.dot(x, y + 3, shadeRGB(G.brass, 0.8));
    }
  },
  ammo_762: (s) => {
    for (const [x, y] of [[3, 4], [7, 3], [11, 4]] as const) round(s, x, y, 9, 2, 0x8a6a3a, 0x6a6448);
  },
  ammo_308: (s) => {
    for (const [x, y] of [[3, 2], [7, 1], [11, 2]] as const) round(s, x, y, 12, 2, 0x9a7a5a);
  },
  mag_g17: (s) => magIcon(s, G.poly, 9, 0),
  mag_m1911: (s) => magIcon(s, G.metal, 8, 0),
  mag_m4: (s) => magIcon(s, G.blued, 11, 1),
  mag_ak: (s) => magIcon(s, G.shell, 11, 4),
  mod_ext_mag_g17: (s) => {
    magIcon(s, G.poly, 13, 0);
    s.rect(6, 12, 4, 1, G.polyLight);
  },
  mod_ext_mag_m4: (s) => magIcon(s, G.poly, 13, 1),
  mod_ext_mag_ak: (s) => magIcon(s, G.shell, 13, 5),
  mod_suppressor: (s) => {
    s.line(2, 12, 12, 2, G.blued, 3);
    s.line(1, 13, 3, 11, G.metal, 3);
    s.dot(13, 2, 0x1e1f1d);
  },
  mod_flashlight: (s) => {
    s.rect(3, 6, 8, 4, G.poly);
    s.rect(11, 5, 3, 6, G.polyLight);
    s.rect(14, 6, 1, 4, 0xb8b8a8); // lens
    s.rect(4, 4, 6, 2, G.blued); // rail clamp
    s.dot(6, 10, G.metal); // button
  },
  storyScanner: (s) => {
    s.rect(4, 3, 8, 11, 0x2c3a4a);
    s.rect(5, 4, 6, 4, 0x4a8a68); // lit green screen
    s.line(6, 6, 9, 5, 0x9ce6b8);
    s.rect(5, 1, 1, 2, C.steel); // antenna
    s.dot(5, 9, 0xd8a038);
    s.dot(7, 9, C.tin);
    s.dot(9, 9, C.tin);
    s.rect(5, 11, 6, 1, C.steelDark);
  },
  storySample: (s) => {
    s.rect(4, 2, 8, 2, C.steel); // cryo cap
    s.rect(5, 4, 6, 9, 0x4888a8); // glass cylinder
    s.rect(6, 5, 4, 7, 0x7ac8b0); // glowing bio sample
    s.line(6, 4, 6, 12, 0xb8e6f0); // highlight
    s.rect(4, 13, 8, 2, C.steel); // base
    s.dot(8, 8, 0xd8602e); // biohazard core
  },
  storyTransponder: (s) => {
    s.rect(3, 5, 10, 9, 0x4a5236); // olive military casing
    s.rect(4, 6, 8, 7, 0x363c28);
    s.rect(10, 1, 2, 4, C.steel); // heavy antenna
    s.dot(11, 1, 0xe05838); // beacon tip
    s.rect(5, 7, 4, 3, 0xc8963e); // amber frequency dial
    s.dot(10, 8, 0x5eb068);
    s.dot(10, 10, 0xd8602e);
  },
};

// ── Clothing and gear (the pieces' own colours, already grim). ──
/** A whole-body uniform: a jacket over trousers. */
function overall(s: Sprite, top: number, legs: number, detail?: (s: Sprite) => void): void {
  s.rect(5, 1, 6, 7, top);
  s.line(5, 1, 2, 7, top, 2);
  s.line(10, 1, 13, 7, top, 2);
  s.rect(6, 1, 4, 1, shadeRGB(top, 1.25));
  s.rect(5, 8, 6, 2, legs);
  s.rect(5, 10, 2, 5, legs);
  s.rect(9, 10, 2, 5, legs);
  s.rect(5, 8, 6, 1, shadeRGB(legs, 0.7));
  detail?.(s);
}

function helmetIcon(s: Sprite, c: number, brim: boolean): void {
  s.ellipse(8, 8, 6, 5, c);
  s.px.fill(0, 160); // the dome only: below the rim cut off
  if (brim) s.rect(1, 10, 14, 2, shadeRGB(c, 0.85));
  else s.rect(2, 10, 12, 2, shadeRGB(c, 0.75));
}

function vestIcon(s: Sprite, c: number, pouches: boolean): void {
  s.rect(4, 3, 8, 11, c);
  s.rect(4, 1, 2, 2, c);
  s.rect(10, 1, 2, 2, c);
  for (let x = 7; x < 9; x++) for (let y = 3; y < 6; y++) s.px[y * 16 + x] = 0; // the neck
  if (pouches) for (const x of [4, 7, 10]) s.rect(x, 9, 2, 3, shadeRGB(c, 1.25));
  else s.rect(5, 7, 6, 4, shadeRGB(c, 1.15));
}

function packIcon(s: Sprite, c: number, top: boolean, side: boolean): void {
  s.rect(4, 3, 8, 11, c);
  s.rect(5, 2, 6, 1, c);
  s.rect(5, 8, 6, 4, shadeRGB(c, 1.2)); // front pocket
  s.line(5, 8, 10, 8, shadeRGB(c, 0.7));
  if (top) s.rect(4, 3, 8, 3, shadeRGB(c, 0.85));
  if (side) {
    s.rect(2, 6, 2, 6, shadeRGB(c, 0.85));
    s.rect(12, 6, 2, 6, shadeRGB(c, 0.85));
  }
  s.rect(7, 0, 2, 2, 0x3a3832); // handle
}

const WEAR_DRAW: Partial<Record<ItemId, (s: Sprite) => void>> = {
  outfitSwat: (s) => overall(s, ITEMS.outfitSwat.wear!.color, ITEMS.outfitSwat.wear!.color, (sp) => sp.rect(6, 3, 4, 4, 0x3a3e44)),
  outfitMilitary: (s) =>
    overall(s, ITEMS.outfitMilitary.wear!.color, ITEMS.outfitMilitary.wear!.color, (sp) => {
      for (const [x, y] of [[6, 3], [9, 5], [7, 11], [10, 12], [3, 5]] as const) sp.rect(x, y, 2, 1, 0x464430);
    }),
  outfitPolice: (s) =>
    overall(s, ITEMS.outfitPolice.wear!.color, 0x1f2533, (sp) => {
      sp.rect(9, 3, 1, 2, 0x9a8a50); // badge
      sp.line(8, 1, 8, 7, 0x3a4a6a);
    }),
  outfitFirefighter: (s) =>
    overall(s, ITEMS.outfitFirefighter.wear!.color, ITEMS.outfitFirefighter.wear!.color, (sp) => {
      sp.rect(5, 6, 6, 1, 0xa9a79c); // faded reflective bands
      sp.rect(5, 13, 2, 1, 0xa9a79c);
      sp.rect(9, 13, 2, 1, 0xa9a79c);
    }),
  outfitDoctor: (s) =>
    overall(s, ITEMS.outfitDoctor.wear!.color, ITEMS.outfitDoctor.wear!.color, (sp) => {
      sp.line(7, 1, 8, 3, shadeRGB(ITEMS.outfitDoctor.wear!.color, 0.7));
      sp.line(9, 1, 8, 3, shadeRGB(ITEMS.outfitDoctor.wear!.color, 0.7));
      sp.rect(6, 4, 2, 2, shadeRGB(ITEMS.outfitDoctor.wear!.color, 1.2));
    }),
  outfitMechanic: (s) =>
    overall(s, ITEMS.outfitMechanic.wear!.color, ITEMS.outfitMechanic.wear!.color, (sp) => {
      sp.line(8, 1, 8, 9, shadeRGB(ITEMS.outfitMechanic.wear!.color, 0.7));
      sp.rect(9, 11, 1, 2, 0x2f3330); // oil
    }),
  outfitBuilder: (s) =>
    overall(s, ITEMS.outfitBuilder.wear!.color, ITEMS.outfitBuilder.wear!.color, (sp) => {
      sp.rect(5, 5, 6, 1, 0x8a7a48); // faded hi-vis band
      sp.rect(5, 2, 1, 4, 0x8a7a48);
      sp.rect(10, 2, 1, 4, 0x8a7a48);
    }),
  helmetMilitary: (s) => {
    helmetIcon(s, ITEMS.helmetMilitary.wear!.color, false);
    s.line(4, 6, 12, 6, shadeRGB(ITEMS.helmetMilitary.wear!.color, 0.8)); // cover band
  },
  helmetSwat: (s) => {
    helmetIcon(s, 0x2a2c30, false);
    s.rect(11, 7, 2, 2, G.metal); // rail
  },
  helmetFire: (s) => {
    helmetIcon(s, 0x3a362e, true);
    s.line(8, 3, 8, 9, 0x524c40); // ridge
    s.rect(6, 7, 4, 2, 0x8a7a48); // faded front badge
  },
  helmetConstruction: (s) => {
    helmetIcon(s, ITEMS.helmetConstruction.wear!.color, true);
    s.line(8, 3, 8, 9, shadeRGB(ITEMS.helmetConstruction.wear!.color, 1.2));
  },
  vestMilitary: (s) => vestIcon(s, ITEMS.vestMilitary.wear!.color, true),
  vestSwat: (s) => {
    vestIcon(s, 0x2a2c30, false);
    s.rect(6, 8, 4, 1, 0x8a8a80); // faded lettering
  },
  backpackMilitary: (s) => packIcon(s, ITEMS.backpackMilitary.wear!.color, true, true),
  backpackSchool: (s) => packIcon(s, ITEMS.backpackSchool.wear!.color, false, false),
  backpackHiking: (s) => {
    packIcon(s, ITEMS.backpackHiking.wear!.color, true, false);
    s.rect(3, 13, 10, 2, 0x4a4f36); // bedroll
  },
  bagMedic: (s) => {
    s.rect(2, 6, 12, 8, ITEMS.bagMedic.wear!.color);
    s.line(4, 6, 6, 2, 0x3a3832);
    s.line(11, 6, 9, 2, 0x3a3832);
    s.line(6, 2, 9, 2, 0x3a3832);
    s.rect(7, 8, 2, 5, 0xa9a79c); // faded cross
    s.rect(5, 10, 6, 1, 0xa9a79c);
  },
  toolboxMechanic: (s) => {
    s.rect(2, 7, 12, 7, ITEMS.toolboxMechanic.wear!.color);
    s.rect(2, 7, 12, 2, shadeRGB(ITEMS.toolboxMechanic.wear!.color, 1.2));
    s.rect(5, 4, 6, 1, G.metal);
    s.rect(5, 5, 1, 2, G.metal);
    s.rect(10, 5, 1, 2, G.metal);
    s.rect(7, 10, 2, 1, G.metal); // latch
  },
  gogglesTactical: (s) => {
    s.rect(2, 5, 12, 6, 0x2a2c2e);
    s.rect(3, 6, 4, 4, 0x4a4e4a);
    s.rect(9, 6, 4, 4, 0x4a4e4a);
    s.rect(0, 7, 2, 2, 0x26282a); // strap
    s.rect(14, 7, 2, 2, 0x26282a);
    s.dot(4, 7, 0x7a7e78);
  },
  balaclava: (s) => {
    s.ellipse(8, 8, 5, 7, ITEMS.balaclava.wear!.color);
    for (let x = 4; x < 12; x++) for (let y = 6; y < 8; y++) s.px[y * 16 + x] = 0xff7a8274; // eye slot: skin
    s.dot(8, 7, ITEMS.balaclava.wear!.color);
  },
  shemagh: (s) => {
    const c = ITEMS.shemagh.wear!.color;
    s.rect(2, 4, 12, 8, c);
    s.line(2, 12, 6, 15, c, 2);
    for (let y = 5; y < 12; y += 2) for (let x = 3; x < 14; x += 3) s.dot(x + (y % 4 === 1 ? 1 : 0), y, shadeRGB(c, 0.7));
  },
  maskHalf: (s) => {
    const c = ITEMS.maskHalf.wear!.color;
    s.rect(3, 6, 10, 6, c);
    s.rect(4, 5, 8, 1, c);
    s.rect(5, 12, 6, 1, c);
    s.line(4, 8, 11, 8, shadeRGB(c, 0.8));
    s.line(4, 10, 11, 10, shadeRGB(c, 0.8));
    s.line(0, 5, 3, 7, 0x3a3a36); // ear loops
    s.line(15, 5, 12, 7, 0x3a3a36);
  },
};

const SPECIAL_DRAW: Partial<Record<string, (s: Sprite) => void>> = {
  tripwire: (s) => {
    // Grenade body + wooden/metal stake + taut steel tripwire across.
    s.rect(2, 5, 4, 8, 0x3c4b34);
    s.rect(3, 4, 2, 1, 0x7b807a);
    s.dot(5, 4, 0xc8a440); // pin ring
    s.rect(12, 6, 2, 8, 0x5c4632);
    s.line(5, 8, 12, 8, 0xb6bec2); // wire
  },
  heliAvionics: (s) => {
    s.rect(2, 3, 12, 10, 0x26343c);
    s.rect(3, 4, 10, 8, 0x1a262c);
    s.rect(4, 5, 5, 4, 0x389c68); // radar/avionics screen
    s.dot(11, 5, 0xe09030);
    s.dot(11, 7, 0x40d070);
    s.dot(11, 9, 0xd84040);
    s.rect(4, 10, 5, 1, 0x809098);
  },
  heliFuelPump: (s) => {
    s.rect(3, 5, 8, 7, 0x8a3a2a);
    s.rect(5, 3, 4, 2, 0x9aa2a6);
    s.rect(11, 7, 3, 2, 0x9aa2a6);
    s.rect(4, 12, 6, 2, 0x282c30);
    s.dot(6, 7, 0xd0a848);
  },
  heliBattery: (s) => {
    s.rect(2, 4, 12, 10, 0x22262c);
    s.rect(2, 4, 12, 2, 0x323840);
    s.rect(4, 2, 2, 2, 0xc84038); // + terminal
    s.rect(10, 2, 2, 2, 0x3878c8); // - terminal
    s.line(7, 7, 9, 9, 0xe8c040);
    s.line(9, 9, 7, 11, 0xe8c040);
  },
};

Object.assign(DRAW, GUN_DRAW, WEAR_DRAW, SPECIAL_DRAW);

/** Generic clothing icon by slot, in the item's color (the pieces with their own drawing: WEAR_DRAW). */
function garment(s: Sprite, id: ItemId): void {
  const w = ITEMS[id].wear;
  if (!w) {
    s.rect(4, 4, 8, 8, 0x6a6458);
    return;
  }
  const c = w.color;
  switch (w.slot) {
    case 'torso':
      top(s, c, false, true, shadeRGB(c, 0.7));
      break;
    case 'legs':
      pants(s, c, true);
      break;
    case 'feet':
      shoeIcon(s, c, w.shoe === 'boots');
      break;
    case 'hands':
      // A glove: palm, four fingers, a thumb.
      s.rect(5, 7, 6, 6, c);
      for (let i = 0; i < 4; i++) s.rect(5 + i * 1.5, 3, 1, 4, c);
      s.rect(11, 7, 2, 3, c);
      s.rect(5, 12, 6, 2, shadeRGB(c, 0.7));
      break;
  }
}

function clearEllipse(s: Sprite, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / (rx + 0.5);
      const dy = (y - cy) / (ry + 0.5);
      if (dx * dx + dy * dy <= 1 && x >= 0 && y >= 0 && x < s.w && y < s.h) s.px[y * s.w + x] = 0;
    }
  }
}

/** HUD indicators: health, hunger, thirst, energy, body warmth, calm, flashlight battery; wound is a status. */
export type StatIcon = 'health' | 'hunger' | 'thirst' | 'energy' | 'warmth' | 'calm' | 'battery' | 'wound' | 'sick';

/** One-color silhouettes (+ a darker detail tone), tinted per severity by the HUD. */
const STAT_DRAW: Record<StatIcon, (s: Sprite, c: number, d: number) => void> = {
  sick: (s, c, d) => {
    // A thermometer: stem and bulb, the column up high.
    s.rect(7, 2, 3, 9, d);
    s.rect(8, 4, 1, 7, c);
    s.ellipse(8, 12, 3, 3, c);
    for (const y of [4, 6, 8]) s.rect(10, y, 2, 1, d);
  },
  health: (s, c) => {
    s.ellipse(5, 6, 3, 3, c);
    s.ellipse(10, 6, 3, 3, c);
    for (let y = 7; y <= 13; y++) s.rect(2 + (y - 7), y, 12 - 2 * (y - 7), 1, c);
    s.dot(5, 5, shadeRGB(c, 1.35));
  },
  hunger: (s, c, d) => {
    // A loaf of bread with scored top.
    s.ellipse(8, 9, 6, 4, c);
    s.rect(2, 10, 13, 3, c);
    for (const x of [5, 8, 11]) s.line(x, 7, x + 1, 9, d);
  },
  thirst: (s, c) => {
    s.ellipse(8, 10, 4, 4, c);
    for (let y = 2; y <= 8; y++) {
      const w = Math.round((y - 2) * 0.6);
      s.rect(8 - w, y, 1 + 2 * w, 1, c);
    }
    s.dot(6, 9, shadeRGB(c, 1.4));
  },
  energy: (s, c, d) => {
    // Crescent moon and a "z": tiredness.
    s.ellipse(7, 9, 5, 5, c);
    clearEllipse(s, 10, 7, 4, 4);
    s.line(11, 2, 14, 2, d);
    s.line(14, 2, 11, 5, d);
    s.line(11, 5, 14, 5, d);
  },
  warmth: (s, c, d) => {
    // Thermometer.
    s.rect(7, 1, 3, 10, c);
    s.ellipse(8, 12, 3, 3, c);
    s.line(8, 4, 8, 11, d);
    for (const y of [3, 6, 9]) s.dot(11, y, c);
  },
  calm: (s, c, d) => {
    // Heartbeat trace in a frame: the faster it gets, the less calm you are.
    s.rect(1, 3, 14, 10, d);
    s.line(2, 8, 5, 8, c);
    s.line(5, 8, 7, 4, c);
    s.line(7, 4, 9, 12, c);
    s.line(9, 12, 10, 8, c);
    s.line(10, 8, 13, 8, c);
  },
  battery: (s, c, d) => {
    // Flashlight with a beam.
    s.rect(1, 7, 7, 3, c);
    s.rect(8, 6, 3, 5, c);
    s.dot(4, 8, d);
    s.line(12, 6, 14, 4, c);
    s.line(12, 8, 15, 8, c);
    s.line(12, 10, 14, 12, c);
  },
  wound: (s, c, d) => {
    // Crisp adhesive bandage strip with central pad.
    s.line(3, 12, 12, 3, c, 3);
    s.line(4, 11, 11, 4, c, 3);
    s.rect(6, 6, 4, 4, d);
    s.dot(7, 7, c);
    s.dot(8, 8, c);
  },
};

const STAT_IDS: readonly StatIcon[] = ['health', 'hunger', 'thirst', 'energy', 'warmth', 'calm', 'battery', 'sick', 'wound'];
const statImages = new Map<StatIcon, ImageData>();
const statCache = new Map<string, string>();
export const STAT_DIM_COLOR = 0x55574f;

/** Data URL of a 24×24 HUD indicator in the given color (cached per color). */
export function statIcon(id: StatIcon, color: number): string {
  const key = `${id}:${color}`;
  let url = statCache.get(key);
  if (!url) {
    const src = statImages.get(id);
    if (src) {
      url = tintStatImage(id, src, color);
    } else {
      const s = new Sprite(16, 16);
      STAT_DRAW[id](s, color, shadeRGB(color, 0.55));
      s.finish(0x0c0a08);
      url = s.toDataURL();
    }
    statCache.set(key, url);
  }
  return url;
}

function tintStatImage(id: StatIcon, src: ImageData, color: number): string {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d')!;
  const out = g.createImageData(src.width, src.height);
  const tr = (color >> 16) & 255;
  const tg = (color >> 8) & 255;
  const tb = color & 255;
  const isDim = color === STAT_DIM_COLOR;

  for (let i = 0; i < src.data.length; i += 4) {
    const a = src.data[i + 3];
    if (a === 0) continue;
    const r = src.data[i];
    const gr = src.data[i + 1];
    const b = src.data[i + 2];
    const lum = (0.299 * r + 0.587 * gr + 0.114 * b) / 255;

    // Keep the dark pixel-art outline intact.
    if (r < 55 && gr < 55 && b < 55) {
      out.data[i] = r;
      out.data[i + 1] = gr;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
      continue;
    }

    if (id === 'wound' && !isDim) {
      // Keep the bandage cream & crimson blood spot colors.
      out.data[i] = r;
      out.data[i + 1] = gr;
      out.data[i + 2] = b;
      out.data[i + 3] = a;
      continue;
    }

    if (isDim) {
      const v = Math.round(lum * 115);
      out.data[i] = v;
      out.data[i + 1] = v;
      out.data[i + 2] = Math.min(255, Math.round(v * 0.96));
      out.data[i + 3] = a;
      continue;
    }

    // Map sprite shading (typically ~0.25..0.85 lum) onto rich thematic color with highlights.
    const k = Math.min(1.25, 0.35 + lum * 1.15);
    out.data[i] = Math.min(255, Math.round(tr * k));
    out.data[i + 1] = Math.min(255, Math.round(tg * k));
    out.data[i + 2] = Math.min(255, Math.round(tb * k));
    out.data[i + 3] = a;
  }
  g.putImageData(out, 0, 0);
  return c.toDataURL();
}

const iconCache = new Map<ItemId, string>();
/** Drawn icons (public/icons/items.png, tools/build-icons.ts): 32×32, they win over the code ones. */
const sheetIcons = new Map<string, string>();

async function loadStatIcons(base: string): Promise<void> {
  await Promise.all(
    STAT_IDS.map(async (id) => {
      try {
        const img = new Image();
        img.src = `${base}stats/${id}.png`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        statImages.set(id, g.getImageData(0, 0, c.width, c.height));
      } catch {
        // Fallback to procedural icon if missing.
      }
    }),
  );
  statCache.clear();
}

/** Loads the drawn icons once at boot; no atlas (or an error) leaves the code icons. */
export async function loadItemIcons(): Promise<void> {
  const base = `${import.meta.env.BASE_URL}icons/`;
  await loadStatIcons(base);
  try {
    const res = await fetch(`${base}items.json`);
    if (!res.ok) return;
    const meta = (await res.json()) as { cell: number; ids: Record<string, number> };
    const img = new Image();
    img.src = `${base}items.png`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = meta.cell;
    const g = c.getContext('2d')!;
    for (const [id, k] of Object.entries(meta.ids)) {
      g.clearRect(0, 0, meta.cell, meta.cell);
      g.drawImage(img, k * meta.cell, 0, meta.cell, meta.cell, 0, 0, meta.cell, meta.cell);
      sheetIcons.set(id, c.toDataURL());
    }
    iconCache.clear();
  } catch {
    // The code icons stay.
  }
}

const RENDERED_SET = new Set<ItemId>(RENDERED_ITEM_ICONS);

const CUSTOM_ITEM_ICONS = new Set<ItemId>([
  'carKey',
  'jerrycan',
  'carBattery',
  'engineParts',
  'carTire',
  'wrench',
  'storyScanner',
  'storySample',
  'storyTransponder',
  ...RENDERED_ITEM_ICONS,
]);

/** True when the item's icon is a 3D-rendered smooth PNG (use smooth scaling instead of pixelated). */
export function isCustomItemIcon(id: ItemId): boolean {
  return RENDERED_SET.has(id);
}

/** Data URL of the item's icon: the rendered/custom PNG if there is, else the atlas or 16×16 code one. */
export function itemIcon(id: ItemId): string {
  if (CUSTOM_ITEM_ICONS.has(id)) return `${import.meta.env.BASE_URL}icons/items/${id}.png`;
  const drawn = sheetIcons.get(id);
  if (drawn) return drawn;
  let url = iconCache.get(id);
  if (!url) {
    const s = new Sprite(16, 16);
    (DRAW[id] ?? ((sp: Sprite) => garment(sp, id)))(s);
    s.finish();
    url = s.toDataURL();
    iconCache.set(id, url);
  }
  return url;
}
