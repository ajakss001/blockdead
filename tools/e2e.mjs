// npm run test:e2e — a dev-mode build of the game (keeps the window.__game hooks) into .e2e-dist, then Playwright.
import { spawnSync } from 'node:child_process';
import { build } from 'vite';

process.env.NODE_ENV = 'development';
await build({ mode: 'development', logLevel: 'warn', build: { outDir: '.e2e-dist', emptyOutDir: true, minify: false } });
const r = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', shell: true });
process.exit(r.status ?? 1);
