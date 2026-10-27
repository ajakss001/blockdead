import { defineConfig } from 'vite';

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
  server: { port: 5173 },
});
