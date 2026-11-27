#!/usr/bin/env node
/**
 * Rebuilds public/models/atlas.jpg for the pruned models.json from the pre-prune atlas (git `debe82d~1`),
 * copying each kept model's ORIGINAL tile (matched by name) into its new layer slot.
 * Fixes furniture sampling stale car/vehicle tiles after the prune.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const REV = process.argv[2] ?? 'debe82d~1';
const oldMeta = JSON.parse(execFileSync('git', ['show', `${REV}:public/models/models.json`], { maxBuffer: 1 << 26 }).toString('utf8'));
const oldJpg = execFileSync('git', ['show', `${REV}:public/models/atlas.jpg`], { maxBuffer: 1 << 28 });
const meta = JSON.parse(readFileSync('public/models/models.json', 'utf8'));
const tile = meta.atlas;
const oldCols = oldMeta.atlasCols ?? 10;
const cols = meta.atlasCols ?? 10;
const { data: src, info } = await sharp(oldJpg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const rows = Math.ceil(meta.models.length / cols);
const W = cols * tile;
const H = rows * tile;
const out = Buffer.alloc(W * H * 4, 255);
const oldLayer = new Map(oldMeta.models.map((m) => [m.name, m.layer]));
for (const m of meta.models) {
  const ol = oldLayer.get(m.name);
  if (ol === undefined) throw new Error(`model ${m.name} missing in ${REV}`);
  const sc = ol % oldCols;
  const sr = Math.floor(ol / oldCols);
  const dc = m.layer % cols;
  const dr = Math.floor(m.layer / cols);
  for (let y = 0; y < tile; y++) {
    const so = ((sr * tile + y) * info.width + sc * tile) * 4;
    const d = ((dr * tile + y) * W + dc * tile) * 4;
    src.copy(out, d, so, so + tile * 4);
  }
  console.log(`${m.name}: old ${ol} -> new ${m.layer}`);
}
const jpg = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).removeAlpha().jpeg({ quality: 88, mozjpeg: true }).toBuffer();
writeFileSync('public/models/atlas.jpg', jpg);
console.log(`atlas.jpg rebuilt: ${W}x${H}, ${(jpg.length / 1048576).toFixed(2)} MB`);
