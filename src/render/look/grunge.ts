import { CanvasTexture, Color, type ColorRepresentation, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../../core/random';

/** Surface recipes. Each adds its own features on top of the shared micro-noise and grime. */
export type GrungeKind =
  | 'grime'
  | 'plaster'
  | 'wood'
  | 'asphalt'
  | 'ground'
  | 'metal'
  | 'rust'
  | 'fabric'
  | 'skin'
  | 'foliage'
  | 'carpaint'
  | 'glass';

export interface GrungeOptions {
  /** Texture side, px. 128 is the sweet spot: crisp at arm's length, 64 KB of VRAM. */
  size?: number;
  seed?: number;
  kind?: GrungeKind;
  /** Number of dried blood splatters. */
  blood?: number;
}

type Rand = () => number;

/** Tileable value noise: a wrapped lattice, so every texture repeats seamlessly. */
function valueNoise(rand: Rand, cells: number): (u: number, v: number) => number {
  const lattice = new Float32Array(cells * cells);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (ix: number, iy: number) => lattice[(((iy % cells) + cells) % cells) * cells + (((ix % cells) + cells) % cells)];
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function fbm(rand: Rand): (u: number, v: number) => number {
  const octaves = [valueNoise(rand, 4), valueNoise(rand, 8), valueNoise(rand, 16), valueNoise(rand, 32)];
  const weights = [0.5, 0.25, 0.15, 0.1];
  return (u, v) => {
    let s = 0;
    for (let i = 0; i < octaves.length; i++) s += octaves[i](u, v) * weights[i];
    return s;
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Impact crack: radial fractures from one point plus two broken rings around it. */
function drawCracks(g: CanvasRenderingContext2D, size: number, rand: Rand): void {
  const cx = size * (0.3 + rand() * 0.4);
  const cy = size * (0.3 + rand() * 0.4);
  g.strokeStyle = 'rgba(225, 228, 230, 0.55)';
  g.lineWidth = 1;
  const rays = 9 + Math.floor(rand() * 5);
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + rand() * 0.3;
    let x = cx;
    let y = cy;
    g.beginPath();
    g.moveTo(x, y);
    const steps = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < steps; k++) {
      const len = size * (0.06 + rand() * 0.1);
      a += (rand() - 0.5) * 0.5;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  for (const ring of [0.08, 0.17]) {
    g.beginPath();
    for (let i = 0; i <= rays; i++) {
      const a = (i / rays) * Math.PI * 2;
      const r = size * ring * (0.8 + rand() * 0.4);
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0 || rand() < 0.25) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
}

/** Draw a shape 9 times around the tile so features crossing an edge wrap seamlessly. */
function wrapped(size: number, draw: (ox: number, oy: number) => void): void {
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) draw(dx * size, dy * size);
}

function bloodSplatter(g: CanvasRenderingContext2D, size: number, rand: Rand): void {
  const cx = rand() * size;
  const cy = rand() * size;
  const r = size * (0.04 + rand() * 0.06);
  g.fillStyle = `rgba(${48 + rand() * 20}, ${6 + rand() * 6}, ${6 + rand() * 4}, ${0.55 + rand() * 0.3})`;
  wrapped(size, (ox, oy) => {
    g.beginPath();
    g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
    g.fill();
    // Droplets flung around the main blot, plus one drip running down.
    for (let i = 0; i < 7; i++) {
      const a = rand() * Math.PI * 2;
      const d = r * (1.3 + rand() * 1.8);
      g.beginPath();
      g.arc(cx + ox + Math.cos(a) * d, cy + oy + Math.sin(a) * d, r * (0.08 + rand() * 0.18), 0, Math.PI * 2);
      g.fill();
    }
    g.fillRect(cx + ox - r * 0.12, cy + oy, r * 0.24, r * (1.5 + rand() * 2));
  });
}

/**
 * Procedural grunge: base color + micro-noise + low-frequency grime + per-kind features
 * (wood grain, asphalt grit, rust blooms, plaster drips, fabric weave, scratches) + dried blood.
 * Deterministic per seed; tiles seamlessly; ~1–3 ms per 128² texture.
 */
export function generateGrungeTexture(
  baseColor: ColorRepresentation,
  noiseIntensity: number,
  options: GrungeOptions = {},
): CanvasTexture {
  const size = options.size ?? 128;
  const kind = options.kind ?? 'grime';
  const rand = mulberry32(options.seed ?? 1);
  const base = new Color(baseColor);
  const [br, bg, bb] = base.getHexString().match(/../g)!.map((h) => parseInt(h, 16));

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  const d = img.data;

  const grime = fbm(rand);
  const detail = fbm(rand);
  const column = valueNoise(rand, 16);
  const blotch = valueNoise(rand, 6);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const white = rand();
      const n = detail(u, v);
      let shade = 1 + (white - 0.5) * noiseIntensity * 0.7 + (n - 0.5) * noiseIntensity * 1.4;
      let r = br;
      let gg = bg;
      let b = bb;

      switch (kind) {
        case 'wood':
          shade *= 0.82 + 0.18 * Math.sin((v * 34 + n * 9) * Math.PI);
          break;
        case 'asphalt':
          if (white > 0.965) shade *= 1.45;
          else if (white < 0.04) shade *= 0.45;
          break;
        case 'plaster': {
          // Water stains running down from the top of the wall.
          const drip = smooth(0.62, 0.85, column(u, 0.5)) * (0.3 + 0.7 * v);
          shade *= 1 - drip * 0.35;
          break;
        }
        case 'fabric':
          shade *= (x + y) % 2 === 0 ? 1.06 : 0.94;
          shade *= x % 3 === 0 ? 0.95 : 1;
          break;
        case 'rust':
        case 'metal': {
          const rust = smooth(kind === 'rust' ? 0.42 : 0.6, kind === 'rust' ? 0.6 : 0.75, blotch(u, v) * 0.6 + n * 0.4);
          r = r + (112 - r) * rust;
          gg = gg + (52 - gg) * rust;
          b = b + (24 - b) * rust;
          shade *= 1 - rust * 0.15;
          break;
        }
        case 'carpaint': {
          // Faded paint: sparse rust blooms plus rust-colored drips running down the panels.
          const bloom = smooth(0.66, 0.82, blotch(u, v) * 0.6 + n * 0.4);
          const drip = smooth(0.7, 0.9, column(u, 0.5)) * smooth(0.2, 0.9, v);
          const rust = Math.max(bloom, drip * 0.7);
          r = r + (104 - r) * rust;
          gg = gg + (54 - gg) * rust;
          b = b + (30 - b) * rust;
          shade *= 1 - rust * 0.2;
          break;
        }
        case 'glass':
          // Dust settles in soft clouds, lighter than the glass.
          shade *= 0.9 + 0.35 * smooth(0.35, 0.75, n);
          break;
        case 'skin': {
          const blush = smooth(0.55, 0.8, blotch(u, v));
          gg -= blush * 14;
          b -= blush * 12;
          break;
        }
        case 'foliage':
          shade *= 0.7 + 0.6 * smooth(0.3, 0.7, n);
          break;
        case 'ground': {
          const dirt = smooth(0.45, 0.65, blotch(u, v));
          r = r + (78 - r) * dirt;
          gg = gg + (66 - gg) * dirt;
          b = b + (48 - b) * dirt;
          break;
        }
        default:
          break;
      }

      // Grime: low-frequency dark-brown patches over everything.
      const dirt = smooth(0.5, 0.72, grime(u, v));
      shade *= 1 - dirt * 0.45;
      r = r + (52 - r) * dirt * 0.35;
      gg = gg + (44 - gg) * dirt * 0.35;
      b = b + (36 - b) * dirt * 0.35;

      const i = (y * size + x) * 4;
      d[i] = Math.max(0, Math.min(255, r * shade));
      d[i + 1] = Math.max(0, Math.min(255, gg * shade));
      d[i + 2] = Math.max(0, Math.min(255, b * shade));
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  if (kind === 'glass') drawCracks(g, size, rand);
  if (kind === 'metal' || kind === 'rust' || kind === 'carpaint') {
    // Scratches catch the flashlight as thin bright lines.
    g.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(210, 205, 195, ${0.08 + rand() * 0.18})`;
      const x0 = rand() * size;
      const y0 = rand() * size;
      const a = (rand() - 0.5) * 0.8;
      const len = size * (0.1 + rand() * 0.4);
      wrapped(size, (ox, oy) => {
        g.beginPath();
        g.moveTo(x0 + ox, y0 + oy);
        g.lineTo(x0 + ox + Math.cos(a) * len, y0 + oy + Math.sin(a) * len);
        g.stroke();
      });
    }
  }
  for (let i = 0; i < (options.blood ?? 0); i++) bloodSplatter(g, size, rand);

  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * Grayscale height map for bumpMap: pits, scratches and — for blades — notches along the edge.
 * Bump is cheaper than a normal map to generate and to sample on phones.
 */
export function generateBumpTexture(options: { size?: number; seed?: number; notches?: number } = {}): CanvasTexture {
  const size = options.size ?? 128;
  const rand = mulberry32(options.seed ?? 7);
  const noise = fbm(rand);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const pit = rand() > 0.985 ? -60 : 0;
      const h = 128 + (noise(x / size, y / size) - 0.5) * 90 + pit;
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, h));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Notches: dark semicircles bitten out of the top edge (the blade's cutting edge in UV space).
  g.fillStyle = '#000';
  for (let i = 0; i < (options.notches ?? 0); i++) {
    g.beginPath();
    g.arc(rand() * size, 0, size * (0.02 + rand() * 0.04), 0, Math.PI);
    g.fill();
  }
  g.strokeStyle = 'rgba(40, 40, 40, 0.8)';
  for (let i = 0; i < 10; i++) {
    g.beginPath();
    const x0 = rand() * size;
    const y0 = rand() * size;
    g.moveTo(x0, y0);
    g.lineTo(x0 + (rand() - 0.5) * size * 0.6, y0 + (rand() - 0.5) * size * 0.2);
    g.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = NoColorSpace;
  return tex;
}
