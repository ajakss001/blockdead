import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Page } from '@playwright/test';

/** The game at http://game.test/, files from .e2e-dist (built by `npm run test:e2e`). */
export const ORIGIN = 'http://game.test';
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };

export async function serveGame(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = join('.e2e-dist', path === '/' ? 'index.html' : path);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' } });
  });
}
