import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// The project folder may be reached through a redirected path (e.g. a Windows app-data
// virtualization): workers resolve to the real path, so the dev server must serve both.
const root = process.cwd();
const realRoot = realpathSync.native(root);

/** Dev only: POST /__shot?name=x with a JPEG data URL saves it to .shots/x.jpg (visual checks from scripts). */
const shots: Plugin = {
  name: 'dev-shots',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const name = new URL(req.url ?? '', 'http://x').searchParams.get('name')?.replace(/[^\w-]/g, '') || 'shot';
        mkdirSync('.shots', { recursive: true });
        writeFileSync(`.shots/${name}.jpg`, Buffer.from(body.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        res.end('ok');
      });
    });
  },
};

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
  plugins: [shots],
});
