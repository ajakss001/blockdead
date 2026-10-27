import { defineConfig } from 'vite';

export default defineConfig({
  // Relative paths: Yandex/VK serve the build from an arbitrary sub-path inside an iframe.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 800,
  },
  server: { port: 5173 },
});
