import type { VisualStyle } from '../render/style/StyleManager';

/** DOM dressing that completes a visual style (cheap: static CSS, one text node updated per second). */
export function mountStyleOverlay(style: VisualStyle, parent: HTMLElement): void {
  if (style === 'diary') {
    const page = document.createElement('div');
    page.className = 'style-diary';
    parent.append(page);
  } else if (style === 'vhs') {
    const osd = document.createElement('div');
    osd.className = 'style-vhs';
    const rec = document.createElement('div');
    rec.className = 'style-vhs__rec';
    rec.textContent = '● REC';
    const stamp = document.createElement('div');
    stamp.className = 'style-vhs__stamp';
    osd.append(rec, stamp);
    parent.append(osd);
    // In-game date: the outbreak is in October 1993; the clock is real time for now.
    const tick = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      stamp.textContent = `27.10.1993  ${hh}:${mm}:${ss}`;
    };
    tick();
    setInterval(tick, 1000);
  }
}
