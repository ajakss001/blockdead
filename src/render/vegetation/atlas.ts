/**
 * The vegetation atlas, painted once on a canvas: sprigs of maple, oak and elm leaves, a bush's dense
 * leaves, fir and pine needle sprays, bare twigs and a strip of bark — 4×2 tiles of 256 px. Leaves have
 * light and shade across them so a card reads as a cluster, not a flat sheet. No image files.
 */
export const TILE = { maple: 0, oak: 1, elm: 2, bush: 3, fir: 4, pine: 5, twigs: 6, bark: 7 } as const;
export type Tile = (typeof TILE)[keyof typeof TILE];
const COLS = 4;
const ROWS = 2;
const S = 256;

/** UV rectangle of a tile: u0, v0, u1, v1 (canvas top row = high v, the texture is flipped). */
export function tileUv(t: number): [number, number, number, number] {
  const c = t % COLS;
  const r = Math.floor(t / COLS);
  return [c / COLS, 1 - (r + 1) / ROWS, (c + 1) / COLS, 1 - r / ROWS];
}

type Ctx = CanvasRenderingContext2D;

export function paintAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = S * COLS;
  cv.height = S * ROWS;
  const g = cv.getContext('2d')!;
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const at = (t: number, draw: (g: Ctx) => void) => {
    g.save();
    g.translate((t % COLS) * S, Math.floor(t / COLS) * S);
    g.beginPath();
    g.rect(0, 0, S, S);
    g.clip();
    draw(g);
    g.restore();
  };
  const greens = (k: number) => {
    const base = [
      [64, 86, 40],
      [78, 98, 44],
      [92, 104, 48],
      [56, 74, 36],
      [104, 108, 52],
      [118, 104, 50],
    ][k % 6];
    return base;
  };
  /** A leaf of a shape at (x, y), pointing at angle a, size s; shaded light → dark across. */
  const leaf = (g: Ctx, x: number, y: number, a: number, s: number, shape: 'maple' | 'oak' | 'elm' | 'bush', tone: number[], light: number) => {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    const [r, gg, b] = tone.map((v) => Math.min(255, v * light));
    const grad = g.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
    grad.addColorStop(0, `rgb(${r * 1.18},${gg * 1.18},${b * 1.1})`);
    grad.addColorStop(1, `rgb(${r * 0.72},${gg * 0.72},${b * 0.7})`);
    g.fillStyle = grad;
    g.beginPath();
    if (shape === 'maple') {
      // Five pointed lobes.
      for (let k = 0; k <= 10; k++) {
        const ang = -Math.PI / 2 + (k / 10) * Math.PI * 2;
        const rad = k % 2 ? s * 0.32 : s * (k === 0 || k === 10 ? 0.55 : k === 4 || k === 6 ? 0.42 : 0.5);
        g.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      }
    } else if (shape === 'oak') {
      // Long with rounded lobes down each side.
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const yy = -s * 0.55 + t * s * 1.1;
        const w = s * 0.24 * Math.sin(t * Math.PI) * (0.75 + 0.35 * Math.abs(Math.sin(t * Math.PI * 4)));
        g.lineTo(w, yy);
      }
      for (let k = 16; k >= 0; k--) {
        const t = k / 16;
        const yy = -s * 0.55 + t * s * 1.1;
        const w = s * 0.24 * Math.sin(t * Math.PI) * (0.75 + 0.35 * Math.abs(Math.sin(t * Math.PI * 4 + 0.6)));
        g.lineTo(-w, yy);
      }
    } else {
      // An oval with a point (elm, the bush).
      const w = shape === 'bush' ? 0.3 : 0.26;
      g.ellipse(0, 0, s * w, s * 0.5, 0, 0, Math.PI * 2);
    }
    g.closePath();
    g.fill();
    // Midrib.
    g.strokeStyle = `rgba(30,40,20,0.35)`;
    g.lineWidth = Math.max(1, s * 0.04);
    g.beginPath();
    g.moveTo(0, s * 0.45);
    g.lineTo(0, -s * 0.4);
    g.stroke();
    g.restore();
  };
  /** A sprig: a twig branching from the bottom middle, leaves along it, the back ones darker. */
  const sprig = (g: Ctx, shape: 'maple' | 'oak' | 'elm' | 'bush', count: number, size: number) => {
    const twigs: [number, number, number, number][] = [];
    const branch = (x: number, y: number, a: number, len: number, depth: number) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      g.strokeStyle = '#4a3a2a';
      g.lineWidth = Math.max(1, 5 - depth * 1.6);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      twigs.push([x, y, x2, y2]);
      if (depth < 2) {
        branch(x2, y2, a - 0.5 - rnd() * 0.3, len * 0.7, depth + 1);
        branch(x2, y2, a + 0.5 + rnd() * 0.3, len * 0.7, depth + 1);
        if (rnd() < 0.6) branch((x + x2) / 2, (y + y2) / 2, a + (rnd() < 0.5 ? -1 : 1) * 0.9, len * 0.55, depth + 1);
      }
    };
    branch(S / 2, S - 4, -Math.PI / 2 + (rnd() - 0.5) * 0.3, S * 0.3, 0);
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < count / 2; k++) {
        const [x0, y0, x1, y1] = twigs[Math.floor(rnd() * twigs.length)];
        const t = 0.3 + rnd() * 0.7;
        const x = x0 + (x1 - x0) * t + (rnd() - 0.5) * 30;
        const y = y0 + (y1 - y0) * t + (rnd() - 0.5) * 30;
        if (Math.hypot(x - S / 2, y - S / 2) > S * 0.47) continue;
        const a = Math.atan2(y - y0, x - x0) + (rnd() - 0.5) * 1.6 + Math.PI / 2;
        leaf(g, x, y, a, size * (0.75 + rnd() * 0.5), shape, greens(Math.floor(rnd() * 6)), pass ? 1.0 + rnd() * 0.15 : 0.62 + rnd() * 0.15);
      }
    }
  };
  at(TILE.maple, (g) => sprig(g, 'maple', 34, 54));
  at(TILE.oak, (g) => sprig(g, 'oak', 30, 58));
  at(TILE.elm, (g) => sprig(g, 'elm', 48, 34));
  at(TILE.bush, (g) => {
    for (let k = 0; k < 140; k++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * S * 0.44;
      const light = 0.6 + (1 - r / (S * 0.44)) * 0.35 + rnd() * 0.15;
      leaf(g, S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, rnd() * 6.3, 26 + rnd() * 14, 'bush', greens(Math.floor(rnd() * 6)), light);
    }
  });
  // Fir: a flat spray — a central twig, side twigs, needles combed along them.
  const needles = (g: Ctx, x0: number, y0: number, x1: number, y1: number, len: number, light: number) => {
    const n = Math.hypot(x1 - x0, y1 - y0) / 2.2;
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const a = Math.atan2(y1 - y0, x1 - x0);
      for (const side of [-1, 1]) {
        const na = a + side * (0.9 + rnd() * 0.4);
        const l = len * (0.6 + 0.4 * Math.sin(t * Math.PI)) * (0.8 + rnd() * 0.4);
        const c = 40 + rnd() * 30;
        g.strokeStyle = `rgb(${(c * 0.7 * light) | 0},${(c * 1.25 * light + 20) | 0},${(c * 0.75 * light) | 0})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(na) * l, y + Math.sin(na) * l);
        g.stroke();
      }
    }
  };
  at(TILE.fir, (g) => {
    g.strokeStyle = '#3a2e22';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S / 2, S - 6);
    g.lineTo(S / 2, 10);
    g.stroke();
    for (let k = 0; k < 9; k++) {
      const y = S - 30 - k * 24;
      const len = (S * 0.42 * (1 - k / 11)) | 0;
      for (const side of [-1, 1]) needles(g, S / 2, y, S / 2 + side * len, y - 30, 16, 0.75 + rnd() * 0.3);
    }
    needles(g, S / 2, S - 6, S / 2, 10, 20, 1.0);
  });
  at(TILE.pine, (g) => {
    // Pine: tufts of long needles at the twig ends.
    g.strokeStyle = '#4a3a2a';
    g.lineWidth = 4;
    const tips: [number, number][] = [];
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k - 2.5) * 0.32;
      const x = S / 2 + Math.cos(a) * S * 0.28;
      const y = S - 10 + Math.sin(a) * S * 0.55;
      g.beginPath();
      g.moveTo(S / 2, S - 10);
      g.lineTo(x, y);
      g.stroke();
      tips.push([x, y]);
    }
    for (const [x, y] of tips) {
      for (let k = 0; k < 40; k++) {
        const a = rnd() * Math.PI * 2;
        const l = 26 + rnd() * 34;
        const c = 45 + rnd() * 35;
        g.strokeStyle = `rgb(${(c * 0.75) | 0},${(c * 1.2 + 15) | 0},${(c * 0.7) | 0})`;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
    }
  });
  at(TILE.twigs, (g) => {
    const twig = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y + Math.sin(a) * len;
      g.strokeStyle = depth ? '#5a4a3c' : '#4a3c30';
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      if (depth < 4) {
        twig(x2, y2, a - 0.35 - rnd() * 0.4, len * 0.72, w * 0.7, depth + 1);
        if (rnd() < 0.8) twig(x2, y2, a + 0.35 + rnd() * 0.4, len * 0.68, w * 0.7, depth + 1);
      }
    };
    twig(S / 2, S - 4, -Math.PI / 2, S * 0.28, 6, 0);
  });
  at(TILE.bark, (g) => {
    g.fillStyle = '#5a4c40';
    g.fillRect(0, 0, S, S);
    for (let k = 0; k < 900; k++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const l = 8 + rnd() * 40;
      const c = 50 + rnd() * 60;
      g.strokeStyle = `rgba(${c | 0},${(c * 0.85) | 0},${(c * 0.7) | 0},0.6)`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 4, y + l);
      g.stroke();
    }
  });
  return cv;
}
