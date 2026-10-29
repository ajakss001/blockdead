import { Viewmodel } from '../player/Viewmodel';
import type { RightItem } from '../player/Viewmodel';
import { failures, type FrameRow, swingFrames, table } from './animCheck';

/**
 * ?animdebug=1 — the swing of what is in hand, played frame by frame (60 frames at 60 Hz, each held
 * for 120 ms, looping) on the real arms; an overlay shows per hand the wrist bend / sideways / twist,
 * forearm roll and how much the wrist turned since the last frame. On every item change the whole
 * table goes to the console, with frames over the limits (jumps over 15°) listed.
 */
export function installAnimDebug(vm: Viewmodel, root: HTMLElement): void {
  // A separate viewmodel computes the table, so the one on screen keeps its state.
  const probe = new Viewmodel();
  const box = document.createElement('pre');
  box.style.cssText =
    'position:absolute;left:8px;top:40px;z-index:50;margin:0;padding:6px 8px;background:rgba(0,0,0,.6);color:#d8f0c0;font:11px/1.35 monospace;pointer-events:none;white-space:pre';
  root.append(box);
  let item: RightItem | null = null;
  let rows: FrameRow[] = [];
  let frame = 0;
  const lead = 3 / 60;
  const tick = () => {
    if (vm.currentItem !== item) {
      item = vm.currentItem;
      rows = swingFrames(probe, item);
      const bad = failures(item, 'swing', rows);
      console.log(`[animdebug] ${item}: swing, 60 frames\n${table(rows)}`);
      console.log(bad.length ? `[animdebug] ${item}: ${bad.length} frame(s) over the limits\n${bad.map((f) => `  frame ${f.frame}: ${f.what}`).join('\n')}` : `[animdebug] ${item}: all frames within the limits`);
      frame = 0;
    }
    const r = rows[frame];
    vm.scrubT = r.phase === 'rest' ? -1 : (frame - lead * 60) / 60;
    const cell = (n: string, h: FrameRow['R'] | null) =>
      h ? `${n}  bend ${h.flex.toFixed(0).padStart(4)}°  side ${h.dev.toFixed(0).padStart(4)}°  twist ${h.twist.toFixed(0).padStart(4)}°  roll ${h.roll.toFixed(0).padStart(4)}°  Δ ${h.dWrist.toFixed(1).padStart(5)}°${h.dWrist > 15 ? ' !' : ''}` : '';
    box.textContent = `animdebug  ${item}  frame ${String(frame).padStart(2)}/59  ${r.phase}\n${cell('R', r.R)}\n${cell('L', r.L)}`;
    frame = (frame + 1) % rows.length;
  };
  setInterval(tick, 120);
}
