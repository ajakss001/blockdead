import { defineConfig } from '@playwright/test';

// End-to-end checks in a real browser. The game is a dev-mode build (window.__game hooks) in .e2e-dist,
// served to the page straight from disk through request routing (no local server needed).
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  use: { viewport: { width: 1280, height: 720 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } } }],
});
