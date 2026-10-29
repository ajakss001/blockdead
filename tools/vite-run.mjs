// Runs a TypeScript module of the game in Node through Vite's SSR module runner (same resolution as the game).
import { createServer, createServerModuleRunner } from 'vite';
const [entry, ...args] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] } });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
let code = 0;
try {
  const mod = await runner.import("/" + entry.replace(/^[\/]+/, ""));
  code = (await mod.main?.(args)) ?? 0;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await runner.close();
  await server.close();
}
process.exit(code);
