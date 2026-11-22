/**
 * Item icons from drawn sheets: assets/incoming/icons/*.jpg (not in git; generated pixel art on a magenta
 * or white background) → public/icons/items.png (one row of 32×32 cells) + items.json (id → cell).
 * Each cell is cut by hand-set coordinates, the background keyed out, the object fitted (aspect kept,
 * 1 px margin) and its colours passed through grim (half strength: the sheets are already muted).
 * No sheets → nothing written, exit 0 (the game draws its code icons: ui/pixelart).
 *
 *   node tools/vite-run.mjs tools/build-icons.ts
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { grim } from '../src/style/palette';

const SRC = 'assets/incoming/icons';
const OUT = 'public/icons';
const CELL = 32;

/** [x0, y0, x1, y1] in the sheet's pixels (1408×768 unless said), optional rotation (deg, clockwise). */
type Cut = { sheet: string; box: [number, number, number, number]; rotate?: number };

const grid = (sheet: string, cols: number, rows: number, c: number, r: number, width = 1408): Cut => {
  const w = width / cols, h = 768 / rows;
  return { sheet, box: [Math.round(c * w), Math.round(r * h), Math.round((c + 1) * w), Math.round((r + 1) * h)] };
};
const gear = (c: number, r: number) => grid('gear', 6, 4, c, r);
const outfit = (c: number, r: number) => grid('outfits', 4, 2, c, r);
const gun = (c: number, r: number) => grid('guns', 4, 2, c, r);
const melee = (c: number, r: number) => grid('melee', 3, 2, c, r, 1376);
const ammo = (x0: number, x1: number, r: number): Cut => ({ sheet: 'ammo', box: [x0, r * 192, x1, (r + 1) * 192] });

const CUTS: Record<string, Cut> = {
  helmetMilitary: gear(0, 0),
  helmetSwat: gear(1, 0),
  helmetFire: gear(2, 0),
  helmetConstruction: gear(4, 0),
  vestMilitary: gear(0, 1),
  vestSwat: gear(1, 1),
  backpackMilitary: gear(2, 1),
  backpackSchool: gear(3, 1),
  backpackHiking: gear(0, 2),
  bagMedic: gear(1, 2),
  toolboxMechanic: gear(2, 2),
  gogglesTactical: gear(0, 3),
  balaclava: gear(1, 3),
  shemagh: gear(2, 3),
  maskHalf: gear(3, 3),
  outfitSwat: outfit(0, 0),
  outfitMilitary: outfit(1, 0),
  outfitPolice: outfit(2, 0),
  outfitFirefighter: outfit(3, 0),
  outfitDoctor: outfit(0, 1),
  outfitMechanic: outfit(1, 1),
  outfitBuilder: outfit(2, 1),
  pistol_g17: gun(0, 0),
  pistol_m1911: gun(1, 0),
  shotgun_pump: gun(2, 0),
  rifle_m4a1: gun(3, 0),
  rifle_ak: gun(0, 1),
  rifle_hunting: gun(1, 1),
  launcher_rpg: gun(2, 1),
  rocket_rpg: gun(3, 1),
  knife: melee(0, 0),
  bat: melee(1, 0),
  hammer: melee(2, 0),
  crowbar: melee(0, 1),
  axe: melee(1, 1),
  ammo_9mm: ammo(0, 352, 0),
  ammo_45: ammo(352, 705, 0),
  ammo_12: ammo(705, 1056, 0),
  ammo_556: ammo(1056, 1408, 0),
  ammo_762: ammo(0, 352, 1),
  ammo_308: ammo(352, 705, 1),
  mag_g17: ammo(712, 842, 1),
  mag_m1911: ammo(1056, 1408, 1),
  mag_m4: ammo(0, 352, 2),
  mag_ak: ammo(352, 705, 2),
  mod_suppressor: ammo(878, 1052, 2),
  mod_ext_mag_m4: ammo(1056, 1408, 2),
  mod_ext_mag_ak: ammo(0, 352, 3),
  mod_flashlight: ammo(1056, 1408, 3),
  mod_ext_mag_g17: { sheet: 'mag_ext_g17', box: [0, 0, 1408, 768], rotate: 270 },
};

/** Background: the magenta (and the purple cell borders), or the white of some sheets. */
const isBg = (r: number, g: number, b: number) => (r > g * 1.25 + 20 && b > g * 1.25 + 20) || (r > 222 && g > 222 && b > 222);

const sheets = new Map<string, { data: Buffer; w: number; h: number }>();
async function sheet(name: string) {
  let s = sheets.get(name);
  if (!s) {
    const { data, info } = await sharp(`${SRC}/${name}.jpg`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    sheets.set(name, (s = { data, w: info.width, h: info.height }));
  }
  return s;
}

async function cell(cut: Cut): Promise<Buffer> {
  const s = await sheet(cut.sheet);
  // Inset past the cell borders.
  const [x0, y0, x1, y1] = [cut.box[0] + 6, cut.box[1] + 6, cut.box[2] - 6, cut.box[3] - 6];
  const w = x1 - x0, h = y1 - y0;
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * s.w + x0 + x) * 3, o = (y * w + x) * 4;
      const [r, g, b] = [s.data[i], s.data[i + 1], s.data[i + 2]];
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = isBg(r, g, b) ? 0 : 255;
    }
  // A sheet's grid lines caught in the cut (near its edges only): a solid column / row across nearly the
  // whole cell is not the object.
  const EDGE = 14;
  for (let x = 0; x < w; x++) {
    if (x >= EDGE && x < w - EDGE) continue;
    let n = 0;
    for (let y = 0; y < h; y++) n += rgba[(y * w + x) * 4 + 3] ? 1 : 0;
    if (n > h * 0.85) for (let y = 0; y < h; y++) rgba[(y * w + x) * 4 + 3] = 0;
  }
  for (let y = 0; y < h; y++) {
    if (y >= EDGE && y < h - EDGE) continue;
    let n = 0;
    for (let x = 0; x < w; x++) n += rgba[(y * w + x) * 4 + 3] ? 1 : 0;
    if (n > w * 0.85) for (let x = 0; x < w; x++) rgba[(y * w + x) * 4 + 3] = 0;
  }
  // The object's box: rows / columns with a few solid pixels (JPEG specks don't count).
  const solidRow = (y: number) => { let n = 0; for (let x = 0; x < w; x++) n += rgba[(y * w + x) * 4 + 3] ? 1 : 0; return n >= 3; };
  const solidCol = (x: number) => { let n = 0; for (let y = 0; y < h; y++) n += rgba[(y * w + x) * 4 + 3] ? 1 : 0; return n >= 3; };
  let top = 0, bot = h - 1, left = 0, right = w - 1;
  while (top < bot && !solidRow(top)) top++;
  while (bot > top && !solidRow(bot)) bot--;
  while (left < right && !solidCol(left)) left++;
  while (right > left && !solidCol(right)) right--;
  let img = sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).extract({ left, top, width: right - left + 1, height: bot - top + 1 });
  if (cut.rotate) img = sharp(await img.rotate(cut.rotate).png().toBuffer());
  // Fit into the cell less a 1 px margin, averaging down (no blur after: alpha hardened below).
  const fit = await img
    .resize(CELL - 2, CELL - 2, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'mks2021' })
    .extend({ top: 1, bottom: 1, left: 1, right: 1, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .raw()
    .toBuffer();
  for (let i = 0; i < fit.length; i += 4) {
    if (fit[i + 3] < 128) {
      fit[i] = fit[i + 1] = fit[i + 2] = fit[i + 3] = 0;
      continue;
    }
    // The grim palette at half strength (sharp gives the colour un-premultiplied).
    const c = grim((fit[i] << 16) | (fit[i + 1] << 8) | fit[i + 2], 0.5);
    fit[i] = (c >> 16) & 255;
    fit[i + 1] = (c >> 8) & 255;
    fit[i + 2] = c & 255;
    fit[i + 3] = 255;
  }
  return fit;
}

async function main(): Promise<void> {
  const have = Object.entries(CUTS).filter(([, c]) => existsSync(`${SRC}/${c.sheet}.jpg`));
  if (!have.length) {
    console.log(`build-icons: no sheets in ${SRC}, skipped (code icons stay)`);
    return;
  }
  const n = have.length;
  const atlas = Buffer.alloc(n * CELL * CELL * 4);
  const index: Record<string, number> = {};
  for (let k = 0; k < n; k++) {
    const [id, cut] = have[k];
    const px = await cell(cut);
    for (let y = 0; y < CELL; y++) px.copy(atlas, (y * n * CELL + k * CELL) * 4, y * CELL * 4, (y + 1) * CELL * 4);
    index[id] = k;
  }
  mkdirSync(OUT, { recursive: true });
  await sharp(atlas, { raw: { width: n * CELL, height: CELL, channels: 4 } }).png({ palette: false, compressionLevel: 9 }).toFile(`${OUT}/items.png`);
  writeFileSync(`${OUT}/items.json`, `${JSON.stringify({ cell: CELL, ids: index })}\n`);
  const missing = Object.keys(CUTS).filter((id) => !(id in index));
  console.log(`build-icons: ${n} icons → ${OUT}/items.png${missing.length ? `; no sheet for ${missing.join(', ')}` : ''}`);
}

await main();
