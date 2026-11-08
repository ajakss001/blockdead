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

/**
 * Dev only: POST /__grips with the grips as JSON writes src/data/grips.json (the grip editor's «Сохранить»,
 * ?gripedit=<id>); the editor keeps its state, so that write does not reload the page.
 */
let gripsSaved = 0;
const grips: Plugin = {
  name: 'dev-grips',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__grips', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body) as Record<string, unknown>;
          const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v);
          gripsSaved = Date.now();
          writeFileSync('src/data/grips.json', `${JSON.stringify(data, round, 2)}\n`);
          res.end('ok');
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e));
        }
      });
    });
  },
  handleHotUpdate(ctx) {
    if (ctx.file.endsWith('src/data/grips.json') && Date.now() - gripsSaved < 3000) return [];
  },
};

/**
 * Dev only: POST /__gearfit with the fits as JSON writes src/data/gearFit.json (the gear editor's «Сохранить»,
 * ?gearedit=<id>); like the grips, that write does not reload the editor.
 */
let gearFitSaved = 0;
const gearFit: Plugin = {
  name: 'dev-gearfit',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__gearfit', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const data = JSON.parse(body) as Record<string, unknown>;
          const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 100000) / 100000 : v);
          gearFitSaved = Date.now();
          writeFileSync('src/data/gearFit.json', `${JSON.stringify(data, round, 2)}\n`);
          res.end('ok');
        } catch (e) {
          res.statusCode = 400;
          res.end(String(e));
        }
      });
    });
  },
  handleHotUpdate(ctx) {
    if (ctx.file.endsWith('src/data/gearFit.json') && Date.now() - gearFitSaved < 3000) return [];
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
  plugins: [shots, grips, gearFit],
});
