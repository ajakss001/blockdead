import { realpathSync } from 'node:fs';
import { defineConfig } from 'vite';

// The project folder may be reached through a redirected path (e.g. a Windows app-data
// virtualization): workers resolve to the real path, so the dev server must serve both.
const root = process.cwd();
const realRoot = realpathSync.native(root);

export default defineConfig({
  // Relative paths: Yandex/VK serve the build from an arbitrary sub-path inside an iframe.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
  },
  // Module workers: the chunk worker imports three.js and the world generator.
  worker: { format: 'es' },
  server: { port: 5173, fs: { allow: [root, realRoot] } },
});
