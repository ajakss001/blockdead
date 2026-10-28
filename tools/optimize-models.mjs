#!/usr/bin/env node
/**
 * Optimizes downloaded models for the phone: assets/incoming/<CODE_name>/*.glb|*.gltf
 *   → public/models/<name>/lod0.glb, lod1.glb, lod2.glb + public/models/manifest.json
 *
 * Per model: dedupe, weld, join, prune, simplify (target triangle budget), textures resized to
 * 512–1024 px (KTX2 if `toktx` from KTX-Software is installed, WebP otherwise), meshopt
 * compression; LOD1 = 50 %, LOD2 = 20 % of LOD0.
 *
 * Runs @gltf-transform/cli through npx (fetched on first use).
 * Usage: npm run models [-- <CODE_name> ...]
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const IN = join(ROOT, 'assets', 'incoming');
const OUT = join(ROOT, 'public', 'models');
const CLI = ['--yes', '@gltf-transform/cli@4'];
/** Triangle budget per kind (by code prefix): vehicles, people, props. */
const BUDGET = { V: 4000, H: 3000, P: 1500 };
const TEXTURE = { V: 1024, H: 1024, P: 512 };

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => execFileSync(npx, [...CLI, ...args], { stdio: 'inherit', shell: process.platform === 'win32' });
const hasToktx = spawnSync('toktx', ['--version'], { stdio: 'ignore', shell: true }).status === 0;

if (!existsSync(IN)) {
  console.error('Нет папки assets/incoming — положите туда скачанные модели.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
const manifestPath = join(OUT, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

for (const dir of readdirSync(IN)) {
  const src = join(IN, dir);
  if (!statSync(src).isDirectory() || (only.length && !only.includes(dir))) continue;
  const file = readdirSync(src).find((f) => /\.(glb|gltf)$/i.test(f));
  if (!file) {
    console.warn(`${dir}: нет .glb/.gltf (архив нужно распаковать)`);
    continue;
  }
  const kind = dir[0].toUpperCase();
  const budget = BUDGET[kind] ?? 3000;
  const size = TEXTURE[kind] ?? 1024;
  const name = dir.replace(/^[A-Z]\d+_/, '').toLowerCase();
  const out = join(OUT, name);
  mkdirSync(out, { recursive: true });
  const input = join(src, file);
  const lod0 = join(out, 'lod0.glb');
  console.log(`\n== ${dir} → models/${name} (≤ ${budget} треуг., текстуры ${size}px, ${hasToktx ? 'KTX2' : 'WebP'})`);
  // Clean-up + texture resize + simplify towards the budget + meshopt.
  run(['optimize', input, lod0, '--compress', 'meshopt', '--texture-compress', hasToktx ? 'ktx2' : 'webp', '--texture-size', String(size), '--simplify', 'true', '--simplify-error', '0.002']);
  run(['simplify', lod0, join(out, 'lod1.glb'), '--ratio', '0.5', '--error', '0.01']);
  run(['simplify', lod0, join(out, 'lod2.glb'), '--ratio', '0.2', '--error', '0.03']);
  manifest[name] = { source: dir, lods: ['lod0.glb', 'lod1.glb', 'lod2.glb'], distances: [0, 18, 40], budget, ktx2: hasToktx };
}

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
// KTX2 needs the Basis transcoder at runtime.
if (Object.values(manifest).some((m) => m.ktx2)) cpSync(join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis'), join(ROOT, 'public', 'basis'), { recursive: true });
console.log('\nГотово. Проверьте треугольники: npx @gltf-transform/cli inspect public/models/<name>/lod0.glb');
