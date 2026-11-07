// After the build: the game (dist/) must stay under 100 MB, or the build fails.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const LIMIT = 100 * 1024 * 1024;
const size = (d) => readdirSync(d).reduce((s, f) => {
  const p = join(d, f);
  const st = statSync(p);
  return s + (st.isDirectory() ? size(p) : st.size);
}, 0);
const total = size(process.argv[2] ?? 'dist');
console.log(`build size: ${(total / 1048576).toFixed(1)} MB (limit 100 MB)`);
if (total > LIMIT) {
  console.error('build too large');
  process.exit(1);
}
