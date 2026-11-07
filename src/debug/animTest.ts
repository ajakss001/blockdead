import './domStub';
import { Viewmodel } from '../player/Viewmodel';
import { allAnimations, failures, type FrameRow, ITEMS, table } from './animCheck';
import { loadCharactersNode } from './nodeCharacters';

/**
 * npm run test:anim — every animation of every weapon, frame by frame on the real viewmodel; fails on
 * wrist / forearm limits, jumps over 15° per frame, gaps over 1 cm, weapon head or hands out of the frame.
 * `-- --table axe` prints the swing table of one item.
 */
export async function main(args: string[]): Promise<number> {
  await loadCharactersNode();
  const vm = new Viewmodel();
  vm.setBody('male', 1);
  vm.setAspect(16 / 9);
  const want = args.includes('--table') ? args[args.indexOf('--table') + 1] : null;
  let failed = 0;
  for (const item of ITEMS) {
    const anims = allAnimations(vm, item);
    const fails = Object.entries(anims).flatMap(([anim, rows]) => failures(item, anim, rows));
    const peak = (rows: FrameRow[], f: (r: FrameRow) => number) => Math.max(...rows.map(f));
    const all = Object.values(anims).flat().filter((r) => !r.swap);
    const hands = (r: FrameRow) => [r.R, r.L].filter((h) => h !== null);
    const stat = (k: 'flex' | 'dev' | 'twist' | 'roll' | 'dWrist') => peak(all, (r) => Math.max(...hands(r).map((h) => Math.abs(h[k])))).toFixed(0);
    const gap = (peak(all, (r) => Math.max(...hands(r).map((h) => Math.max(h.sleeveGap, h.socketGap)))) * 100).toFixed(2);
    console.log(
      `${fails.length ? 'FAIL' : 'ok  '} ${item.padEnd(8)} max: flex ${stat('flex')}°  dev ${stat('dev')}°  twist ${stat('twist')}°  roll ${stat('roll')}°  wrist/frame ${stat('dWrist')}°  gap ${gap} cm  (${Object.keys(anims).join(', ')})`,
    );
    const shown = new Set<string>();
    for (const f of fails) {
      const k = `${f.anim}:${f.what.replace(/[\d.]+/g, '#')}`;
      if (shown.has(k)) continue;
      shown.add(k);
      const count = fails.filter((g) => `${g.anim}:${g.what.replace(/[\d.]+/g, '#')}` === k).length;
      console.log(`       ${f.anim} frame ${f.frame}: ${f.what}${count > 1 ? `  (${count} frames)` : ''}`);
    }
    if (want === item) console.log(table(anims.swing));
    failed += fails.length;
  }
  console.log(failed ? `\ntest:anim FAILED (${failed} frame failures)` : '\ntest:anim passed');
  vm.dispose();
  return failed ? 1 : 0;
}
