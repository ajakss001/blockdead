import { tr } from '../../core/i18n';
import * as F from './furniture';
import type { Place } from './furniture';
import { LIFE, spotHash, TREE } from './lifeKinds';
import { hedge, lampPost, plantTree, trashBins } from './pieces';
import type { Rand } from './pieces';
import { LOT, type Site } from './poiSite';

/**
 * Stage-2 POI templates: the ValuMart hypermarket, the MegaPlaza mall, the water treatment plant and the
 * army checkpoint at the edge of town. Same frame as poiBuild (local +Z faces the road). Names on signs are
 * made up; no real brands or emblems.
 */

/** 5-row pixel font for the signs (Latin and the Cyrillic the signs need). */
const GLYPHS: Record<string, string[]> = {
  A: ['0110', '1001', '1111', '1001', '1001'],
  C: ['0111', '1000', '1000', '1000', '0111'],
  E: ['1111', '1000', '1110', '1000', '1111'],
  G: ['0111', '1000', '1011', '1001', '0111'],
  I: ['111', '010', '010', '010', '111'],
  L: ['1000', '1000', '1000', '1000', '1111'],
  M: ['10001', '11011', '10101', '10001', '10001'],
  N: ['1001', '1101', '1011', '1001', '1001'],
  O: ['0110', '1001', '1001', '1001', '0110'],
  P: ['1110', '1001', '1110', '1000', '1000'],
  R: ['1110', '1001', '1110', '1010', '1001'],
  T: ['11111', '00100', '00100', '00100', '00100'],
  U: ['1001', '1001', '1001', '1001', '0110'],
  V: ['10001', '10001', '10001', '01010', '00100'],
  Z: ['1111', '0001', '0110', '1000', '1111'],
  Э: ['1110', '0001', '0111', '0001', '1110'],
  В: ['1110', '1001', '1110', '1001', '1110'],
  К: ['1001', '1010', '1100', '1010', '1001'],
  У: ['1001', '1001', '0111', '0001', '0110'],
  Ц: ['10010', '10010', '10010', '10010', '11111'],
  И: ['1001', '1011', '1101', '1001', '1001'],
  Я: ['0111', '1001', '0111', '0101', '1001'],
  '>': ['1000', '0100', '0010', '0100', '1000'],
  ' ': ['00', '00', '00', '00', '00'],
};

/**
 * Block letters on a wall facing +Z (local): centred at x, bottom at y, standing just in front of z;
 * `cell` the size of one pixel. Runs of pixels in a row are one box.
 */
function signText(p: Place, text: string, x: number, y: number, z: number, cell: number, color: number): void {
  const glyphs = [...text].map((c) => GLYPHS[c] ?? GLYPHS[' ']);
  const width = glyphs.reduce((w, g) => w + (g[0].length + 1) * cell, -cell);
  let gx = x - width / 2;
  for (const g of glyphs) {
    g.forEach((row, r) => {
      const gy = y + (4 - r) * cell;
      let c = 0;
      while (c < row.length) {
        if (row[c] !== '1') {
          c++;
          continue;
        }
        let e = c;
        while (e < row.length && row[e] === '1') e++;
        p.box(color, gx + ((c + e) / 2) * cell, gy, z + cell * 0.25, (e - c) * cell, cell, cell * 0.5, 'plaster');
        c = e;
      }
    });
    gx += (g[0].length + 1) * cell;
  }
}

/** A shopping cart (static): wire basket on legs, red handle. Local yaw turns it. */
export function cart(p: Place, x: number, z: number, yaw: number, tipped = false): void {
  const q = tipped ? p.at(x, z).tipped(yaw, 0, Math.PI / 2 - 0.15, 0.3) : p.at(x, z).tipped(yaw);
  if (q.model('shoppingCart', 0, 0, 0, 0, 0, 1, 0.55, 0.55)) return;
  const W = 0x8a8c8e;
  q.box(W, 0, 0.42, 0, 0.55, 0.03, 0.85, 'metal');
  q.box(W, 0.27, 0.45, 0, 0.02, 0.45, 0.85, 'metal');
  q.box(W, -0.27, 0.45, 0, 0.02, 0.45, 0.85, 'metal');
  q.box(W, 0, 0.45, 0.42, 0.55, 0.42, 0.02, 'metal');
  q.box(W, 0, 0.45, -0.42, 0.55, 0.5, 0.02, 'metal');
  q.box(0x8a2a20, 0, 0.95, -0.52, 0.56, 0.04, 0.04, 'metal');
  for (const [lx, lz] of [
    [0.22, 0.36],
    [-0.22, 0.36],
    [0.22, -0.36],
    [-0.22, -0.36],
  ] as const) q.box(0x1a1a1a, lx, 0, lz, 0.04, 0.42, 0.06, 'rubber');
}

/** A gondola: two shelves back to back along local Z, `len` long, at (x, z0…z0+len). */
function gondola(S: Site, rand: Rand, x: number, zc: number, len: number): void {
  for (const side of [1, -1]) {
    const messy = rand() < 0.7 || S.has('emptyShelves');
    // Facing ±X: the shelf's local +Z (front) turns to the aisle.
    F.shopShelf(S.p.at(x + side * 0.02, zc, side > 0 ? 1 : 3), rand, len, 'grocery', messy);
    S.retype('superShelf');
  }
}

/** A forklift (placeholder): body, mast with forks, counterweight, wheels. */
function forklift(p: Place, x: number, z: number, yaw: number): void {
  const q = p.at(x, z).tipped(yaw);
  q.box(0xc8a030, 0, 0.25, 0, 1.0, 1.0, 1.9, 'metal');
  q.box(0x2a2a2a, 0, 1.25, -0.2, 0.9, 0.05, 1.0, 'metal');
  for (const s of [-0.42, 0.42]) q.box(0x2a2a2a, s, 1.25, -0.2, 0.05, 1.0, 0.05, 'metal');
  q.box(0x3a3a3a, 0, 0.1, 1.05, 0.9, 2.4, 0.12, 'metal');
  for (const s of [-0.25, 0.25]) q.box(0x5a5a5a, s, 0.05, 1.7, 0.12, 0.05, 1.1, 'metal');
  for (const [wx, wz] of [
    [0.5, 0.6],
    [-0.5, 0.6],
    [0.5, -0.6],
    [-0.5, -0.6],
  ] as const) q.box(0x1a1a1a, wx, 0, wz, 0.15, 0.45, 0.45, 'rubber');
  p.solid(x, z, 1.4, 1.4, 2.4);
}

/** A pallet with a stack of boxes on it (a container). */
function pallet(S: Site, rand: Rand, x: number, z: number, y = 0): void {
  const p = S.p;
  p.box(0x8a6a44, x, y, z, 1.2, 0.14, 1.0, 'wood', y === 0);
  const n = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) p.box(rand() < 0.5 ? 0x9a8462 : 0x7a6a50, x + (rand() - 0.5) * 0.1, y + 0.14 + k * 0.4, z + (rand() - 0.5) * 0.1, 1.1, 0.4, 0.9, 'wood', y === 0);
  if (y === 0) S.container('warehouse', x, z + 0.7);
}

/**
 * ValuMart: a hypermarket — the parking lot with abandoned carts, a huge dark sales floor with rows of
 * gondolas and the checkouts, the warehouse behind (pallet racks, pallets, forklifts) and the manager's
 * office. No light inside: bring a flashlight.
 */
export function hypermarket(S: Site, rand: Rand): void {
  const p = S.p;
  // Parking, carts left about, a corral.
  p.box(0x4a4a48, 0, 0, 19, LOT * 2, 0.03, 14, 'asphalt');
  for (let x = -22; x <= 22; x += 3) p.box(0xd8d4c8, x, 0.03, 20.5, 0.1, 0.005, 4.5, 'asphalt');
  for (let k = 0; k < 7; k++) cart(p, -20 + rand() * 40, 15 + rand() * 9, rand() * 6, rand() < 0.25);
  p.box(0x8a8c8e, 14, 0, 15.5, 4, 1.0, 0.06, 'metal', true);
  for (let k = 0; k < 4; k++) cart(p, 12.6 + k * 0.6, 16.2, Math.PI / 2);
  for (let k = 0; k < 3; k++) if (rand() < 0.6) S.car(-18 + k * 9, 21, Math.PI / 2, rand);

  const X0 = -24;
  const X1 = 24;
  const Z0 = -24;
  const Z1 = 12;
  const H = 7;
  const wall = 0x9a948a;
  S.wallX(wall, X0, X1, Z1, H, [
    { at: -8, w: 4, h: 3 },
    { at: 8, w: 4, h: 3 },
  ]);
  S.wallX(wall, X0, X1, Z0, H);
  S.wallZ(wall, Z0, Z1, X0, H);
  S.wallZ(wall, Z0, Z1, X1, H);
  S.roof(X0, Z0, X1, Z1, H, 0xa8a49a, 0x8a8880);
  // The name over the doors, a red band.
  p.box(0x8a2a20, 0, 4.3, Z1 + 0.1, 30, 2.4, 0.1, 'plaster');
  signText(p, 'VALUMART', 0, 4.6, Z1 + 0.15, 0.36, 0xe8e2d0);
  // The pylon by the road: seen from far down the street.
  p.box(0x6a6a66, 20, 0, 23, 0.6, 16, 0.6, 'metal', true);
  p.box(0x8a2a20, 20, 14.5, 23, 9, 3.2, 0.5, 'metal');
  signText(p, 'VALUMART', 20, 15, 23.3, 0.42, 0xe8e2d0);

  // Checkouts by the front.
  for (let k = 0; k < 6; k++) {
    F.shopCounter(p.at(-17.5 + k * 7, 8, 2), rand, 'grocery');
    p.box(0x2a2a2a, -17.5 + k * 7 + 1.6, 0, 7.5, 0.06, 1.2, 0.06, 'metal');
  }
  // Rows of gondolas.
  for (let k = 0; k < 9; k++) {
    const x = -19.5 + k * 4.9;
    gondola(S, rand, x, -2.5, 6);
    gondola(S, rand, x, -9.5 + 0.0, 5);
  }
  for (let k = 0; k < 5; k++) cart(p, -20 + rand() * 40, -6 + rand() * 10, rand() * 6, rand() < 0.3);
  F.papers(p, rand, X0 + 2, -12, X1 - 2, 6, 12);

  // The warehouse behind a wall with two wide doorways.
  S.wallX(0x8a8478, X0, X1, -12, H, [
    { at: -12, w: 3, h: 3.2 },
    { at: 4, w: 3, h: 3.2 },
  ]);
  // Pallet racks on the back wall: uprights, two beds of pallets.
  for (let k = 0; k < 5; k++) {
    const x = -21 + k * 6;
    for (const dx of [-2.8, 0, 2.8]) p.box(0x2a4a8a, x + dx, 0, -23, 0.12, 5, 0.12, 'metal', true);
    for (const y of [1.6, 3.3]) {
      p.box(0xc86a20, x, y, -23, 5.7, 0.12, 0.1, 'metal');
      p.box(0xc86a20, x, y, -22.0, 5.7, 0.12, 0.1, 'metal');
      pallet(S, rand, x - 1.4, -22.5, y + 0.12);
      if (rand() < 0.7) pallet(S, rand, x + 1.4, -22.5, y + 0.12);
    }
    pallet(S, rand, x - 1.4, -22.3);
  }
  for (let k = 0; k < 6; k++) pallet(S, rand, -18 + rand() * 26, -19 + rand() * 5);
  forklift(p, -8, -16, 0.4);
  forklift(p, 2, -18.5, -1.3);
  // Manager's office in the corner.
  S.wallX(0xb8b4a8, 14, X1, -17, 3, [{ at: 16, w: 1.0, h: 2.1 }]);
  S.doorX(16, -17);
  S.wallZ(0xb8b4a8, -24, -17, 14, 3);
  p.box(0xb8b4a8, 19, 3, -20.5, 10, 0.1, 7, 'plaster');
  F.desk(p.at(20, -21, 0), rand, rand() < 0.5);
  F.officeChair(p.at(20, -20.1, 2), rand);
  F.filingCabinet(p.at(23.4, -19, 3), rand, true);
  p.box(0x3a3a3a, 15.2, 0, -23.3, 0.8, 1.0, 0.7, 'metal', true);
  S.container('cabinet', 15.2, -22.7);
  F.notes(p.at(20, -21.4, 0), rand, 2);
}

/** Static stairs (a stopped escalator): `n` steps from (x0, z) rising towards +X, w wide. */
function escalator(p: Place, x0: number, z: number, w: number, rise: number, n: number): void {
  const run = 0.3;
  const h = rise / n;
  for (let k = 0; k < n; k++) p.box(0x6a6c6e, x0 + k * run + run / 2, 0, z, run, h * (k + 1), w, 'metal', true);
  for (const s of [-1, 1]) {
    const len = n * run;
    p.rbox(0x2a2a2a, x0 + len / 2, rise / 2 + 0.9, z + s * (w / 2 + 0.06), Math.hypot(len, rise), 0.08, 0.06, 0, 0, Math.atan2(rise, len), 'rubber');
    p.rbox(0xb8bcc0, x0 + len / 2, rise / 2 + 0.45, z + s * (w / 2 + 0.03), Math.hypot(len, rise), 0.9, 0.04, 0, 0, Math.atan2(rise, len), 'windowGlass');
  }
}

/** A clothes rail with things hanging on it (a container). */
function rack(S: Site, rand: Rand, x: number, z: number, y: number, alongX: boolean): void {
  const p = S.p;
  const L = 1.8;
  p.box(0x9a9a9a, x, y + 1.4, z, alongX ? L : 0.04, 0.04, alongX ? 0.04 : L, 'metal');
  for (const s of [-1, 1]) p.box(0x9a9a9a, x + (alongX ? (s * L) / 2 : 0), y, z + (alongX ? 0 : (s * L) / 2), 0.04, 1.42, 0.04, 'metal');
  const n = 3 + Math.floor(rand() * 6);
  for (let k = 0; k < n; k++) {
    const t = (k / Math.max(1, n - 1) - 0.5) * (L - 0.2);
    p.box(F.ART_COLORS[Math.floor(rand() * F.ART_COLORS.length)], x + (alongX ? t : 0), y + 0.6, z + (alongX ? 0 : t), alongX ? 0.06 : 0.5, 0.78, alongX ? 0.5 : 0.06, 'rubber');
  }
  S.solid(x, z, alongX ? L : 0.5, alongX ? 0.5 : L, y, y + 1.5);
  S.container('clothesRack', x, z, undefined, y);
}

/**
 * MegaPlaza: a two-storey mall — the atrium open to the roof with two stopped escalators, clothes shops round
 * it on both floors, a food court, a cinema upstairs, the parking lot in front.
 */
export function mall(S: Site, rand: Rand): void {
  const p = S.p;
  p.box(0x4a4a48, 0, 0, 18.5, LOT * 2, 0.03, 15, 'asphalt');
  for (let x = -22; x <= 22; x += 3) p.box(0xd8d4c8, x, 0.03, 20, 0.1, 0.005, 4.5, 'asphalt');
  for (let k = 0; k < 4; k++) if (rand() < 0.65) S.car(-18 + k * 11, 19.5, Math.PI / 2, rand);
  for (let k = 0; k < 3; k++) cart(p, -15 + rand() * 30, 13 + rand() * 4, rand() * 6, rand() < 0.3);

  const X0 = -24;
  const X1 = 24;
  const Z0 = -22;
  const Z1 = 10;
  const FH = 5;
  const H = FH * 2;
  const wall = 0xa8a090;
  // Glass front on the ground floor, the entrance in the middle.
  S.wallX(wall, X0, X1, Z1, H, [
    { at: 0, w: 5, h: 3.5 },
    { at: -12, w: 9, h: 3.8, sill: 0.4 },
    { at: 12, w: 9, h: 3.8, sill: 0.4 },
    { at: -12, w: 9, h: 8.8, sill: 6.2 },
    { at: 12, w: 9, h: 8.8, sill: 6.2 },
  ]);
  for (const x of [-12, 12]) {
    S.paneX(x, Z1, 9, 0.4, 3.8);
  }
  S.wallX(wall, X0, X1, Z0, H);
  S.wallZ(wall, Z0, Z1, X0, H);
  S.wallZ(wall, Z0, Z1, X1, H);
  S.roof(X0, Z0, X1, Z1, H, 0xb0aca2, 0xc8c4b8);
  // Upper windows are blind panels on the outside (the band between floors hides the slab).
  p.box(0x5a6a74, -12, 6.2, Z1 + 0.05, 9, 2.6, 0.05, 'windowGlass');
  p.box(0x5a6a74, 12, 6.2, Z1 + 0.05, 9, 2.6, 0.05, 'windowGlass');
  p.box(0x2a3a5a, 0, 4.2, Z1 + 0.1, 26, 1.6, 0.1, 'plaster');
  signText(p, 'MEGAPLAZA', 0, 4.35, Z1 + 0.15, 0.26, 0xe0dcc8);
  // Sign tower at the lot's corner: a landmark.
  p.box(0x2a3a5a, -21, 0, 22, 2.4, 18, 2.4, 'metal', true);
  p.box(0x2a3a5a, -21, 18, 22, 5.4, 2.6, 2.6, 'metal');
  signText(p, 'MEGAPLAZA', -21, 18.6, 23.35, 0.24, 0xe0dcc8);

  // The upper floor: a slab round the atrium hole (x −8…8, z −10…2), a railing round the hole.
  const ax0 = -8;
  const ax1 = 8;
  const az0 = -10;
  const az1 = 2;
  const slab = (x0: number, z0: number, x1: number, z1: number) => p.box(0x8a867c, (x0 + x1) / 2, FH - 0.25, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0, 'tile', true);
  slab(X0, Z0, X1, az0);
  slab(X0, az1, X1, Z1);
  slab(X0, az0, ax0, az1);
  slab(ax1, az0, X1, az1);
  p.box(0xb8b4a8, 0, FH - 0.3, (Z0 + Z1) / 2, X1 - X0, 0.05, Z1 - Z0, 'plaster');
  const rail = (x: number, z: number, w: number, d: number) => {
    p.box(0xb8bcc0, x, FH, z, w, 1.0, d, 'windowGlass', true);
    p.box(0x9a9a9a, x, FH + 1.0, z, w + 0.04, 0.06, d + 0.04, 'metal');
  };
  rail(0, az0 + 0.05, ax1 - ax0, 0.06);
  rail(-0.5, az1 - 0.05, ax1 - ax0 - 1, 0.06);
  rail(ax0 + 0.05, (az0 + az1) / 2, 0.06, az1 - az0);
  rail(ax1 - 0.05, -6.5, 0.06, 7);
  // Two stopped escalators rising east to the upper floor.
  escalator(p, ax1 - 7.6, -2.6, 1.1, FH, 25);
  escalator(p, ax1 - 7.6, -0.9, 1.1, FH, 25);
  // A dry fountain in the atrium.
  p.cyl(0x8a867c, -3, 0.25, -5, 2.2, 0.5, 'concrete');
  p.cyl(0x3a3e40, -3, 0.5, -5, 1.9, 0.02, 'concrete');
  p.solid(-3, -5, 4, 4, 0.5);

  // Ground floor west: three clothes shops, open fronts to the atrium.
  for (let k = 0; k < 3; k++) {
    const sz0 = Z0 + k * ((Z1 - Z0) / 3);
    const sz1 = sz0 + (Z1 - Z0) / 3;
    if (k > 0) S.wallX(0xb8b4a8, X0, -12, sz0, FH - 0.25);
    S.wallZ(0xb8b4a8, sz0, sz1, -12, FH - 0.25, [{ at: (sz0 + sz1) / 2, w: 4, h: 3 }]);
    for (let r = 0; r < 4; r++) rack(S, rand, -21.5 + (r % 2) * 5, sz0 + 2.5 + Math.floor(r / 2) * 4.5, 0, false);
    p.box(0xd8d0c0, -14, 0, sz0 + 1.5, 0.5, 1.75, 0.35, 'plaster', true);
  }
  // Ground floor east: the food court.
  p.box(0x5a4a3a, 22.5, 0, -6, 2, 1.1, 18, 'wood', true);
  for (let k = 0; k < 3; k++) {
    F.shopCounter(p.at(21.3, -12 + k * 6, 3), rand, 'cafe');
  }
  for (let k = 0; k < 8; k++) F.cafeTable(p.at(12 + (k % 4) * 2.4, -14 + Math.floor(k / 4) * 8 + (rand() - 0.5), 0), rand, rand() < 0.5);
  F.papers(p, rand, 10, -16, 20, 4, 8);

  // Upper floor west: more shops (the second escalator lands east, a walk round the gallery).
  for (let k = 0; k < 2; k++) {
    const sz0 = Z0 + k * 16;
    const sz1 = sz0 + 16;
    if (k > 0) p.box(0xb8b4a8, -18, FH, sz0, 12, FH - 0.3, 0.2, 'plaster', true);
    p.at(-12, (sz0 + sz1) / 2).box(0xb8b4a8, 0, FH, -5.5, 0.2, FH - 0.3, 5, 'plaster', true);
    p.at(-12, (sz0 + sz1) / 2).box(0xb8b4a8, 0, FH, 5.5, 0.2, FH - 0.3, 5, 'plaster', true);
    for (let r = 0; r < 4; r++) rack(S, rand, -21.5 + (r % 2) * 5, sz0 + 3 + Math.floor(r / 2) * 6, FH, false);
  }
  // Upper floor east: the cinema, dark, rows of seats facing the screen on the back wall.
  const cx0 = 10;
  S.p.box(0x3a3236, cx0, FH, -10, 0.2, FH - 0.3, 24, 'plaster', true);
  p.box(0x3a3236, (cx0 + X1) / 2 + 2.5, FH, -4.1, X1 - cx0 - 5, FH - 0.3, 0.2, 'plaster', true);
  p.box(0xd8d4cc, (cx0 + X1) / 2, FH + 1.2, Z0 + 0.15, 11, 3.6, 0.05, 'plaster');
  for (let row = 0; row < 5; row++) {
    for (let s = 0; s < 6; s++) {
      const x = cx0 + 2.5 + s * 1.7;
      const z = -7 - row * 2.2;
      p.box(0x5a1e24, x, FH, z, 0.6, 0.45, 0.6, 'rubber', true);
      p.box(0x5a1e24, x, FH + 0.45, z + 0.28, 0.6, 0.55, 0.12, 'rubber');
    }
  }
  F.boxes(p.at(22, -5, 2), rand, 2);
  S.container('cafe', 12, -5);
}

/**
 * The water treatment plant: two settling tanks with catwalks over the water, pipes, the pump house (leaks,
 * puddles), the control room, a chain-link fence; the water tower over it all is the landmark.
 */
export function waterPlant(S: Site, rand: Rand): void {
  const p = S.p;
  p.box(0x5a5a54, 0, 0, 0, LOT * 2, 0.03, LOT * 2, 'concrete');
  // Chain-link fence round the lot, the gate open.
  const fenceRun = (x0: number, z0: number, x1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(z1 - z0) < 1e-6;
    p.box(0x8a8c8a, (x0 + x1) / 2, 0, (z0 + z1) / 2, alongX ? len : 0.04, 2.2, alongX ? 0.04 : len, 'metal', true);
    for (let t = 0; t <= len; t += 3) p.box(0x5a5a5a, alongX ? Math.min(x0, x1) + t : x0, 0, alongX ? z0 : Math.min(z0, z1) + t, 0.08, 2.3, 0.08, 'metal');
  };
  const E = LOT - 0.5;
  fenceRun(-E, -E, E, -E);
  fenceRun(-E, -E, -E, E);
  fenceRun(E, -E, E, E);
  fenceRun(-E, E, -4, E);
  fenceRun(4, E, E, E);

  // Settling tanks: concrete rings with dark water, a catwalk to the middle.
  for (const [tx, tz, r] of [
    [-11, -10, 7],
    [11, -12, 6],
  ] as const) {
    p.cyl(0x8a867c, tx, 0.55, tz, r, 1.1, 'concrete');
    p.cyl(0x26302e, tx, 1.08, tz, r - 0.3, 0.04, 'plaster');
    p.solid(tx, tz, r * 1.6, r * 1.6, 1.1);
    p.box(0x6a6a66, tx, 1.5, tz, 0.9, 0.08, r * 2, 'metal', true);
    for (const s of [-1, 1]) p.box(0x9a9a2a, tx + s * 0.45, 1.58, tz, 0.04, 1.0, r * 2, 'metal');
    p.cyl(0x6a6a66, tx, 1.5, tz, 1.2, 0.12, 'metal');
    for (let k = 0; k < 3; k++) p.box(0x6a6a66, tx, 0, tz + r + 0.4 + k * 0.35, 0.9, 0.4 + k * 0.4, 0.35, 'metal', true);
  }
  // Pipes from the tanks to the pump house.
  // (A quarter-turned frame lays a pipe along local X.)
  p.at(0, -3, 1).cyl(0x4a6a8a, 0, 0.9, 0, 0.35, 22, 'metal', Math.PI / 2);
  p.cyl(0x4a6a8a, 6, 0.9, -6.5, 0.35, 7, 'metal', Math.PI / 2);
  p.solid(0, -3, 22, 0.8, 1.3);

  // Pump house: x 4…20, z 2…12, door to the yard; pumps, pipes, the roof leaks.
  S.wallX(0x8a8478, 4, 20, 12, 5, [{ at: 12, w: 1.2, h: 2.2 }]);
  S.doorX(12, 12, { width: 1.2 });
  S.wallX(0x8a8478, 4, 20, 2, 5, [{ at: 8, w: 1.2, h: 2.2 }]);
  S.doorX(8, 2, { width: 1.2, open: true });
  S.wallZ(0x8a8478, 2, 12, 4, 5);
  S.wallZ(0x8a8478, 2, 12, 20, 5);
  S.roof(4, 2, 20, 12, 5, 0x6a6a64);
  for (let k = 0; k < 3; k++) {
    const x = 7 + k * 5;
    p.box(0x3a5a7a, x, 0, 6, 2.2, 1.2, 1.4, 'metal', true);
    p.cyl(0x3a5a7a, x, 1.6, 6, 0.5, 0.9, 'metal');
    p.cyl(0x4a6a8a, x, 2.6, 8.5, 0.25, 5, 'metal', Math.PI / 2);
  }
  p.at(12, 10.8, 1).cyl(0x4a6a8a, 0, 3.6, 0, 0.3, 15, 'metal', Math.PI / 2);
  for (let k = 0; k < 3; k++) {
    const [lx, lz] = [6 + rand() * 12, 3 + rand() * 7];
    const [wx, wz] = p.pt(lx, lz);
    S.b.life(LIFE.drip, wx, 4.95, wz, 0, 0, 0, 4.91, spotHash(wx, wz, 71));
  }
  S.container('plantStore', 19.3, 3);
  p.box(0x5a6a5a, 19.3, 0, 3, 0.6, 1.9, 1.0, 'metal', true);
  S.container('plantStore', 4.7, 10.5);
  p.box(0x5a6a5a, 4.7, 0, 10.5, 0.6, 1.9, 1.0, 'metal', true);

  // Control room: x −20…−8, z 4…12, consoles under the windows.
  S.wallX(0xb8b4a8, -20, -8, 12, 3.4, [
    { at: -11, w: 1.0, h: 2.1 },
    { at: -16, w: 5, h: 2.4, sill: 1.0 },
  ]);
  S.paneX(-16, 12, 5, 1.0, 2.4);
  S.doorX(-11, 12);
  S.wallX(0xb8b4a8, -20, -8, 4, 3.4);
  S.wallZ(0xb8b4a8, 4, 12, -20, 3.4);
  S.wallZ(0xb8b4a8, 4, 12, -8, 3.4);
  S.roof(-20, 4, -8, 12, 3.4, 0x8a8a84);
  p.box(0x5a5e62, -14, 0, 4.6, 10, 1.0, 0.9, 'metal', true);
  for (let k = 0; k < 5; k++) p.box(0x14181a, -18 + k * 2, 1.05, 4.5, 1.2, 0.7, 0.05, 'glass');
  for (let k = 0; k < 8; k++) p.box(k % 3 ? 0x2a6a2a : 0x8a2a2a, -18.5 + k * 1.2, 0.9, 5.06, 0.08, 0.06, 0.02, 'plaster');
  F.officeChair(p.at(-15, 6), rand, rand() < 0.4);
  F.officeChair(p.at(-12, 6.2), rand);
  F.desk(p.at(-10, 9.5, 2), rand, true);
  F.notes(p.at(-10, 10, 0), rand, 2);
  F.filingCabinet(p.at(-19.5, 10, 1), rand, true);

  // The water tower: the landmark.
  const twx = -19;
  const twz = -19;
  for (const [dx, dz] of [
    [-2.2, -2.2],
    [2.2, -2.2],
    [-2.2, 2.2],
    [2.2, 2.2],
  ] as const) p.box(0x6a6a66, twx + dx, 0, twz + dz, 0.35, 18, 0.35, 'metal', true);
  p.cyl(0x8a9a9a, twx, 20.5, twz, 3.6, 5, 'metal');
  p.cone(0x6a6a66, twx, 23.7, twz, 3.8, 1.4, 'metal');
  for (let k = 0; k < 10; k++) p.box(0x5a5a5a, twx + 2.4, k * 1.8, twz, 0.5, 0.05, 0.05, 'metal');
}

/**
 * An army checkpoint where a through road enters town: concrete blocks in a chicane across the road, a
 * barrier arm, sandbag nests, a watchtower, tents, a truck and an APC left behind, "ЭВАКУАЦИЯ" signs, notes
 * on what happened, the dead soldiers' kit.
 */
export function checkpoint(S: Site, rand: Rand): void {
  const p = S.p;
  // The road runs along local X at z = +32 (the block's edge). Blocks in a chicane across it.
  const rz = 32;
  for (let k = 0; k < 4; k++) {
    const x = -16 + k * 3.2;
    const z = rz + (k % 2 ? 1.4 : -1.4);
    p.box(0x9a968a, x, 0, z, 2.2, 0.85, 0.6, 'concrete', true);
  }
  // Barrier arm, down, striped.
  p.box(0x6a6a66, -2, 0, rz - 3.4, 0.3, 1.1, 0.3, 'metal', true);
  if (!S.has('breached')) {
    for (let k = 0; k < 6; k++) p.box(k % 2 ? 0xd8d4c8 : 0xb02a20, -2 + 0.15 + k * 0.6 + 0.3, 1.0, rz - 3.4 + 0.0, 0.6, 0.1, 0.1, 'metal');
    p.solid(0, rz - 3.4, 3.6, 0.2, 1.1);
  }
  // Sandbag nests by the road.
  const bags = (x: number, z: number, len: number, alongX: boolean) => {
    for (let layer = 0; layer < 3; layer++) {
      for (let t = -len / 2 + 0.3; t < len / 2; t += 0.62) {
        const bx = x + (alongX ? t + (layer % 2) * 0.3 : 0);
        const bz = z + (alongX ? 0 : t + (layer % 2) * 0.3);
        p.rbox(0x8a7a5a, bx, 0.12 + layer * 0.22, bz, alongX ? 0.58 : 0.34, 0.22, alongX ? 0.34 : 0.58, (rand() - 0.5) * 0.15, 0, 0, 'rubber');
      }
    }
    p.solid(x, z, alongX ? len : 0.4, alongX ? 0.4 : len, 0.7);
  };
  bags(6, rz - 4.2, 5, true);
  bags(8.5, rz - 6.5, 4, false);
  bags(-20, rz - 4.2, 4, true);
  // Watchtower: four legs, a platform with walls and a roof, a ladder.
  const tx = 12;
  const tz = 20;
  for (const [dx, dz] of [
    [-1.2, -1.2],
    [1.2, -1.2],
    [-1.2, 1.2],
    [1.2, 1.2],
  ] as const) p.box(0x5a4a34, tx + dx, 0, tz + dz, 0.2, 5.5, 0.2, 'wood', true);
  p.box(0x6a5a40, tx, 5.5, tz, 3, 0.15, 3, 'wood', true);
  for (const s of [-1, 1]) {
    p.box(0x6a5a40, tx + s * 1.45, 5.65, tz, 0.1, 1.1, 3, 'wood', true);
    p.box(0x6a5a40, tx, 5.65, tz + s * 1.45, 3, 1.1, 0.1, 'wood', true);
  }
  p.box(0x4a4f36, tx, 7.6, tz, 3.4, 0.12, 3.4, 'rubber');
  for (const [dx, dz] of [
    [-1.5, -1.5],
    [1.5, -1.5],
    [-1.5, 1.5],
    [1.5, 1.5],
  ] as const) p.box(0x5a4a34, tx + dx, 6.75, tz + dz, 0.12, 0.85, 0.12, 'wood');
  for (let k = 0; k < 14; k++) p.box(0x5a4a34, tx - 1.5, 0.3 + k * 0.4, tz + 1.7, 0.6, 0.05, 0.06, 'wood');
  S.container('militaryCrate', tx, tz);
  // Tents (olive): a box with a pitched roof; inside a table, cots, crates.
  const tent = (x: number, z: number) => {
    p.box(0x4a4f36, x, 0, z, 4, 1.6, 6, 'rubber', true);
    p.rbox(0x4a4f36, x - 1.0, 2.05, z, 2.3, 0.08, 6.1, 0, 0, 0.6, 'rubber');
    p.rbox(0x4a4f36, x + 1.0, 2.05, z, 2.3, 0.08, 6.1, 0, 0, -0.6, 'rubber');
    S.container('militaryCrate', x, z + 3.3);
  };
  tent(-14, 6);
  tent(-6, 6);
  tent(4, -4);
  // A table outside with the notes, crates, the dead soldiers' kit.
  p.box(0x5a5a46, 0, 0, 12, 2, 0.75, 1, 'wood', true);
  F.notes(p.at(0, 12.2, 0), rand, 3);
  for (let k = 0; k < 4; k++) {
    p.box(0x4a5a3a, -8 + k * 1.1, 0, 14, 1.0, 0.6, 0.7, 'wood', true);
    S.container('militaryCrate', -8 + k * 1.1, 14.5);
  }
  S.container('bodyMilitary', 3, 18);
  if (rand() < 0.6) S.container('bodyMilitary', -18, 22);
  // Vehicles left behind.
  S.car(-14, 20, Math.PI / 2 + 0.2, rand, 'truck', 0x4a4f36);
  S.car(16, 6, 0.3, rand, 'apc', 0x4a4f36);
  // "ЭВАКУАЦИЯ" signs facing the road, an arrow into town.
  for (const x of [-22, 18]) {
    p.box(0x5a5a56, x, 0, rz - 4.6, 0.12, 2.6, 0.12, 'metal', true);
    p.box(0xd8d4c8, x, 1.9, rz - 4.6, 4.2, 0.7, 0.06, 'plaster');
    signText(p, tr('ЭВАКУАЦИЯ >', 'EVACUATION >'), x, 2.08, rz - 4.55, 0.068, 0xa02a20);
  }
}

/**
 * A square (сквер): a lawn gone to seed, two paths crossing at a dry fountain, benches, lamps, rows of
 * maples, oaks and elms (some dead), bushes, an overgrown hedge round it with gaps where the paths go out.
 */
export function park(S: Site, rand: Rand): void {
  const p = S.p;
  const b = S.b;
  p.box(0x4a5632, 0, 0, 0, LOT * 2, 0.05, LOT * 2, 'ground');
  // Paths, crossing.
  p.box(0x8a8478, 0, 0.05, 0, 2.6, 0.02, LOT * 2, 'asphalt');
  p.box(0x8a8478, 0, 0.05, 0, LOT * 2, 0.02, 2.6, 'asphalt');
  // The fountain, dry, leaves in the basin.
  p.cyl(0x8a867c, 0, 0.3, 0, 3, 0.6, 'concrete');
  p.cyl(0x3a3a30, 0, 0.6, 0, 2.7, 0.02, 'plaster');
  p.cyl(0x8a867c, 0, 1.1, 0, 0.35, 1.2, 'concrete');
  p.cyl(0x8a867c, 0, 1.75, 0, 0.9, 0.12, 'concrete');
  p.solid(0, 0, 5.6, 5.6, 0.6);
  // Benches facing the paths, lamps on the corners of the crossing.
  for (const [x, z, r] of [
    [-8, 2.1, 2],
    [8, 2.1, 2],
    [-8, -2.1, 0],
    [8, -2.1, 0],
    [2.1, 9, 1],
    [-2.1, -9, 3],
  ] as const) F.bench(p.at(x, z, r), rand, rand() < 0.2);
  for (const [x, z] of [
    [4, 4],
    [-4, -4],
    [4, -14],
    [-4, 14],
  ] as const) {
    const [wx, wz] = p.pt(x, z);
    lampPost(b, wx, wz, 0, 0);
  }
  const [tx, tz] = p.pt(5, 5);
  trashBins(b, tx, tz);
  // Trees in each quarter, bushes between.
  for (const [qx, qz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    for (let k = 0; k < 4; k++) {
      const lx = qx * (6 + spotHash(qx * 7 + k, qz, 50) * 16);
      const lz = qz * (6 + spotHash(qz * 5 + k, qx, 51) * 16);
      const [wx, wz] = p.pt(lx, lz);
      const species = spotHash(wx, wz, 52) < 0.1 ? TREE.dead : Math.floor(spotHash(wx, wz, 53) * 3);
      plantTree(b, wx, 0.05, wz, 0.95 + spotHash(wx, wz, 54) * 0.45, spotHash(wz, wx, 55) * 6.28, species);
    }
    for (let k = 0; k < 3; k++) {
      const lx = qx * (4 + spotHash(qx + k * 3, qz, 56) * 18);
      const lz = qz * (4 + spotHash(qz + k * 3, qx, 57) * 18);
      const [wx, wz] = p.pt(lx, lz);
      b.life(LIFE.bush, wx, 0.05, wz, 0, 1, 0.9 + spotHash(wx, wz, 58) * 0.5, spotHash(wx, wz, 59) < 0.4 ? 1 : 0, spotHash(wx, wz, 60));
    }
  }
  // The hedge round it, gaps where the paths leave.
  const E = LOT - 1;
  const corners = [p.pt(-E, -E), p.pt(E, -E), p.pt(E, E), p.pt(-E, E)];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = corners[k];
    const [bx, bz] = corners[(k + 1) % 4];
    const [mx, mz] = [(ax + bx) / 2, (az + bz) / 2];
    hedge(b, ax, az, bx, bz, Math.abs(bz - az) < 1e-6 ? mx : mz, 3.2);
  }
}
