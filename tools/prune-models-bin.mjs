#!/usr/bin/env node
/**
 * Prunes all old Sketchfab vehicles/aircraft/props, obsolete street props replaced by newmodel.zip,
 * and unused Meshy doors from public/models/models.{json,bin} and atlas.jpg, keeping interior furniture.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const DIR = 'public/models';
const DROP = new Set([
  // 25 Sketchfab ground vehicles
  'sedan_thunderbolt', 'sedan_kiri', 'sedan_psx', 'small_car', 'pickup', 'coupe',
  'traffic_1', 'traffic_2', 'traffic_3', 'traffic_4', 'traffic_5',
  'van_delivery', 'van_transport', 'van_white',
  'police_cruiser', 'police_car', 'police_suv',
  'ambulance', 'ambulance_2', 'wreck',
  'tank', 'apc', 'army_truck', 'army_truck_2', 'helicopter',
  // 4 Sketchfab aircraft
  'airliner', 'light_plane', 'fighter_jet', 'huey',
  // 12 Sketchfab street props
  'sandbag', 'sandbag_2', 'jersey', 'barrier_a', 'barrier_b', 'barrier_low',
  'cone_block', 'cone', 'barricade', 'tent_military', 'tent_medical', 'stretcher',
  // Old Meshy street props & unused doors replaced by newmodel.zip / instanced doors
  'meshy_dumpster', 'meshy_barrel', 'meshy_wall_barrier', 'meshy_guard_booth',
  'meshy_shopping_cart', 'meshy_pallet_crates',
  'meshy_lab_door', 'meshy_barricaded_door', 'meshy_wooden_door',
]);

async function main() {
  const vehiclesDir = join(DIR, 'vehicles');
  if (existsSync(vehiclesDir)) {
    rmSync(vehiclesDir, { recursive: true, force: true });
    console.log('Deleted obsolete directory public/models/vehicles/');
  }

  const meta = JSON.parse(readFileSync(join(DIR, 'models.json'), 'utf8'));
  const oldBin = readFileSync(join(DIR, 'models.bin'));
  const { data: oldAtlas, info: oldAtlasInfo } = await sharp(readFileSync(join(DIR, 'atlas.jpg'))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const tile = meta.atlas;
  const oldCols = meta.atlasCols ?? 10;
  const kept = meta.models.filter((m) => !DROP.has(m.name));
  if (kept.length === meta.models.length) {
    // Re-running on an already-pruned set would remap layers against the wrong atlas tiles.
    console.log('Already pruned — skipping to preserve atlas.jpg');
    return;
  }
  console.log(`Pruning models.bin: ${meta.models.length} -> ${kept.length} models`);

  const chunks = [];
  let offset = 0;
  const newCols = oldCols;
  const newRows = Math.ceil(kept.length / newCols);
  const newW = newCols * tile;
  const newH = newRows * tile;
  const newAtlas = Buffer.alloc(newW * newH * 4, 255);
  const outModels = [];

  for (let i = 0; i < kept.length; i++) {
    const m = kept[i];
    const vLen = m.vertices * meta.stride;
    const iLen = m.indices * 2 + (m.indices % 2 ? 2 : 0);
    const vBuf = oldBin.subarray(m.vOffset, m.vOffset + vLen);
    const iBuf = oldBin.subarray(m.iOffset, m.iOffset + iLen);

    const vOffset = offset;
    chunks.push(vBuf);
    offset += vBuf.length;

    const iOffset = offset;
    chunks.push(iBuf);
    offset += iBuf.length;

    const sc = m.layer % oldCols;
    const sr = Math.floor(m.layer / oldCols);
    const dc = i % newCols;
    const dr = Math.floor(i / newCols);
    for (let y = 0; y < tile; y++) {
      const srcOff = ((sr * tile + y) * oldAtlasInfo.width + sc * tile) * 4;
      const dstOff = ((dr * tile + y) * newW + dc * tile) * 4;
      oldAtlas.copy(newAtlas, dstOff, srcOff, srcOff + tile * 4);
    }

    const clean = { ...m, layer: i, vOffset, iOffset };
    delete clean.lod1Offset;
    delete clean.lod1Indices;
    outModels.push(clean);
  }

  writeFileSync(join(DIR, 'models.bin'), Buffer.concat(chunks));
  writeFileSync(join(DIR, 'models.json'), JSON.stringify({ stride: meta.stride, atlas: tile, atlasCols: newCols, models: outModels }, null, 1));
  const atlasBuf = await sharp(newAtlas, { raw: { width: newW, height: newH, channels: 4 } })
    .removeAlpha()
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(DIR, 'atlas.jpg'), atlasBuf);

  const atlasSz = atlasBuf.length;
  console.log(`Pruned OK: ${outModels.length} models, models.bin ${(offset / 1048576).toFixed(2)} MB, atlas.jpg ${(atlasSz / 1048576).toFixed(2)} MB`);
}

await main();
