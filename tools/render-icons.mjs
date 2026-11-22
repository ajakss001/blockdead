/**
 * Automatically renders transparent Tarkov-style 2D inventory icons (.png) directly from the game's
 * 3D models (firearms, magazines, attachments, melee, helmets, vests, backpacks, masks, outfits,
 * ammo cartons) using headless Chromium + Three.js WebGL OrthographicCamera + studio lighting.
 *
 * Output:
 *   public/icons/items/<id>.png  (auto-cropped RGBA with 6 px padding)
 *   src/ui/renderedIcons.ts      (manifest imported by src/ui/pixelart.ts)
 *
 * Usage:
 *   npm run render:icons
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { createServer } from 'vite';

const OUT_DIR = 'public/icons/items';
const MANIFEST_PATH = 'src/ui/renderedIcons.ts';
const PAD = 6; // 4..8 px requested transparent margin

const TARGET_MAX_CONTENT = {
  '4x2': [244, 116],
  '2x2': [180, 180],
  '2x1': [180, 96],
  '1x2': [96, 180],
  '1x1': [116, 116],
};

function autoCropAndResize(pngBuf, grid) {
  const src = PNG.sync.read(pngBuf);
  const { width: w, height: h, data } = src;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 6) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error('Rendered frame is completely transparent');
  }

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const key = `${grid[0]}x${grid[1]}`;
  const [maxBoxW, maxBoxH] = TARGET_MAX_CONTENT[key] ?? [140, 140];
  const scale = Math.min(maxBoxW / cropW, maxBoxH / cropH, 1);
  const dstW = Math.max(1, Math.round(cropW * scale));
  const dstH = Math.max(1, Math.round(cropH * scale));

  const outW = dstW + PAD * 2;
  const outH = dstH + PAD * 2;
  const out = new PNG({ width: outW, height: outH });

  // Area-averaged box/bilinear downsample in premultiplied RGBA space to preserve crisp halo-free fringes.
  const srcXf = cropW / dstW;
  const srcYf = cropH / dstH;
  for (let dy = 0; dy < dstH; dy++) {
    const sy0 = minY + dy * srcYf;
    const sy1 = Math.min(maxY + 1, minY + (dy + 1) * srcYf);
    const iy0 = Math.floor(sy0);
    const iy1 = Math.ceil(sy1);

    for (let dx = 0; dx < dstW; dx++) {
      const sx0 = minX + dx * srcXf;
      const sx1 = Math.min(maxX + 1, minX + (dx + 1) * srcXf);
      const ix0 = Math.floor(sx0);
      const ix1 = Math.ceil(sx1);

      let wSum = 0;
      let aSum = 0;
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;

      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const idx = (sy * w + sx) * 4;
          const pa = data[idx + 3] / 255;
          wSum += wt;
          aSum += pa * wt;
          rSum += data[idx] * pa * wt;
          gSum += data[idx + 1] * pa * wt;
          bSum += data[idx + 2] * pa * wt;
        }
      }

      const outA = wSum > 0 ? aSum / wSum : 0;
      const oi = ((dy + PAD) * outW + (dx + PAD)) * 4;
      if (outA <= 1 / 255) {
        out.data[oi] = out.data[oi + 1] = out.data[oi + 2] = out.data[oi + 3] = 0;
      } else {
        const inv = 1 / aSum;
        out.data[oi] = Math.min(255, Math.max(0, Math.round(rSum * inv)));
        out.data[oi + 1] = Math.min(255, Math.max(0, Math.round(gSum * inv)));
        out.data[oi + 2] = Math.min(255, Math.max(0, Math.round(bSum * inv)));
        out.data[oi + 3] = Math.min(255, Math.max(0, Math.round(outA * 255)));
      }
    }
  }

  return { buf: PNG.sync.write(out, { colorType: 6 }), width: outW, height: outH };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const server = await createServer({
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const addr = server.httpServer.address();
  const url = `http://127.0.0.1:${addr.port}/tools/render-icons.html`;

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('response', (r) => {
      if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) {
        errors.push(`HTTP ${r.status()} ${r.url()}`);
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__renderIcons === 'function', undefined, { timeout: 30000 });
    const items = await page.evaluate(() => window.__renderIcons());
    if (errors.length) {
      throw new Error(`Renderer page errors: ${errors.join(' | ')}`);
    }

    let totalBytes = 0;
    const idList = [];
    const spans = {};
    for (const item of items) {
      const b64 = item.dataUrl.replace(/^data:image\/png;base64,/, '');
      const { buf, width, height } = autoCropAndResize(Buffer.from(b64, 'base64'), item.grid);
      const outPath = `${OUT_DIR}/${item.id}.png`;
      writeFileSync(outPath, buf);
      totalBytes += buf.length;
      idList.push(item.id);
      spans[item.id] = item.grid;
      console.log(
        `${item.id.padEnd(20)} grid=${item.grid[0]}x${item.grid[1]}  ${String(width).padStart(3)}x${String(height).padEnd(3)}  ${(buf.length / 1024).toFixed(1)} KB`,
      );
    }

    const manifestSrc =
      `// Auto-generated by tools/render-icons.mjs (npm run render:icons). Do not edit manually.\n` +
      `import type { ItemId } from '../data/items';\n\n` +
      `export const RENDERED_ITEM_ICONS: readonly ItemId[] = ${JSON.stringify(idList, null, 2)} as const;\n\n` +
      `export const ITEM_GRID_SPANS: Partial<Record<ItemId, readonly [number, number]>> = ${JSON.stringify(spans, null, 2)};\n`;
    writeFileSync(MANIFEST_PATH, manifestSrc);

    console.log(`\nrender-icons: ${items.length} PNGs written to ${OUT_DIR}/ (${(totalBytes / 1024).toFixed(1)} KB total)`);
  } finally {
    await browser.close();
    await server.close();
  }
}

await main();
