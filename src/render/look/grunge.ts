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
  | 'paint'
  | 'glass'
  | 'facadeConcrete'
  | 'facadeBrick'
  | 'facadeOffice'
  | 'concrete'
  | 'tile';

export interface GrungeOptions {
  /** Texture side, px. 128 is the sweet spot: crisp at arm's length, 64 KB of VRAM. */
  size?: number;
  seed?: number;
  kind?: GrungeKind;
  /** Strength of the dark grime patches: 0 clean, 1 default, >1 spreads wider (dirty clothes). */
  grime?: number;
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

const cellHash = (a: number, b: number) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/**
 * Facade windows. The tile is 2 bays × 2 storeys (64 px each); canvas top = upper storey.
 * Each window is dark glass, smashed (black hole with shard teeth), boarded up, or has a faded curtain.
 * Office towers get full-height glass panels with a mullion instead.
 */
/** Draws the window grid; returns the rects of intact glass (not smashed, not boarded). */
function drawWindows(g: CanvasRenderingContext2D, size: number, _rand: Rand, office: boolean): [number, number, number, number][] {
  const glass: [number, number, number, number][] = [];
  const cell = size / 2;
  for (let fy = 0; fy < 2; fy++) {
    // Slab edge between storeys.
    g.fillStyle = 'rgba(30, 28, 26, 0.35)';
    g.fillRect(0, fy * cell + cell - 5, size, 5);
    for (let bx = 0; bx < 2; bx++) {
      const x0 = bx * cell + (office ? 3 : 11);
      const y0 = fy * cell + (office ? 5 : 12);
      const w = office ? cell - 6 : cell - 22;
      const h = office ? cell - 12 : 36;
      if (!office) {
        g.fillStyle = 'rgba(70, 66, 60, 0.9)';
        g.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
      }
      // Every window opening is cut out cleanly so the real 3D transparent glass panes show through at all distances.
      glass.push([x0, y0, w, h]);
      g.fillStyle = '#0c1014';
      g.fillRect(x0, y0, w, h);
      if (office) {
        g.fillStyle = 'rgba(90, 96, 100, 0.95)';
        g.fillRect(x0 + w / 2 - 1, y0, 2, h);
      }
    }
  }
  return glass;
}

/** Alpha 0.4 inside intact panes: near buildings the world shader cuts them out to show the rooms. */
function markGlass(g: CanvasRenderingContext2D, rects: [number, number, number, number][]): void {
  for (const [x, y, w, h] of rects) {
    const img = g.getImageData(x + 1, y + 1, w - 2, h - 2);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = 102;
    g.putImageData(img, x + 1, y + 1);
  }
}

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

/**
 * Procedural grunge: base color + micro-noise + low-frequency grime + per-kind features
 * (wood grain, asphalt grit, rust blooms, plaster drips, fabric weave, scratches).
 * Deterministic per seed; tiles seamlessly; ~1–3 ms per 128² texture.
 */
export function generateGrungeTexture(
  baseColor: ColorRepresentation,
  noiseIntensity: number,
  options: GrungeOptions = {},
): CanvasTexture {
  const tex = new CanvasTexture(generateGrungeCanvas(baseColor, noiseIntensity, options));
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Same as generateGrungeTexture, but returns the raw canvas (used to fill texture arrays). */
export function generateGrungeCanvas(
  baseColor: ColorRepresentation,
  noiseIntensity: number,
  options: GrungeOptions = {},
): HTMLCanvasElement {
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
  const grimeK = options.grime ?? 1;

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
          // Aged architectural plaster / wallpaper: subtle vertical seam and faint baseboard dampness, no giant camo blobs.
          if (x % 64 === 0) shade *= 0.94;
          const damp = smooth(0.76, 1.0, v) * 0.16;
          const drip = smooth(0.74, 0.94, column(u, 0.5)) * (0.15 + 0.5 * v);
          shade *= 1 - drip * 0.18 - damp;
          break;
        }
        case 'concrete':
        case 'facadeConcrete': {
          // Precast architectural concrete panels with subtle expansion seams and mineral grain.
          if (x % 64 === 0 || y % 32 === 0) shade *= 0.84;
          else shade *= 0.94 + cellHash(Math.floor(y / 32), Math.floor(x / 64)) * 0.12;
          const drip = smooth(0.68, 0.92, column(u, 0.5)) * smooth(0.15, 0.95, v);
          shade *= 1 - drip * 0.16;
          break;
        }
        case 'fabric':
          shade *= (x + y) % 2 === 0 ? 1.06 : 0.94;
          shade *= x % 3 === 0 ? 0.95 : 1;
          break;
        case 'rust':
        case 'metal': {
          const rust = smooth(kind === 'rust' ? 0.42 : 0.6, kind === 'rust' ? 0.6 : 0.75, blotch(u, v) * 0.6 + n * 0.4);
          // Brown rust (not red: nothing in the city should read as a stain).
          r = r + (116 - r) * rust;
          gg = gg + (82 - gg) * rust;
          b = b + (50 - b) * rust;
          shade *= 1 - rust * 0.15;
          break;
        }
        case 'carpaint': {
          // Faded paint: sparse rust blooms plus rust-colored drips running down the panels.
          const bloom = smooth(0.66, 0.82, blotch(u, v) * 0.6 + n * 0.4);
          const drip = smooth(0.7, 0.9, column(u, 0.5)) * smooth(0.2, 0.9, v);
          const rust = Math.max(bloom, drip * 0.7);
          r = r + (110 - r) * rust;
          gg = gg + (80 - gg) * rust;
          b = b + (52 - b) * rust;
          shade *= 1 - rust * 0.2;
          break;
        }
        case 'paint':
          // Painted panels of a big vehicle: faint mottling and grey dust low down, no rust, no stains.
          shade *= 1 - 0.12 * smooth(0.45, 0.9, v) - 0.05 * smooth(0.5, 0.8, blotch(u, v));
          break;
        case 'glass': {
          // Crisp dark-tinted glass with a subtle diagonal reflection sheen and light corner frost.
          const sheen = Math.max(0, 1 - Math.abs(((u + v * 0.65) % 1) - 0.45) * 7) * 0.18;
          const edge = Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2;
          const frost = smooth(0.75, 1.0, edge) * 0.14;
          shade *= 0.88 + sheen + frost;
          break;
        }
        case 'facadeBrick': {
          // Running bond: 6 px courses, 16 px bricks; mortar darker and greyer; per-brick tint.
          const row = Math.floor(y / 6);
          const off = (row % 2) * 8;
          if (y % 6 === 0 || (x + off) % 16 === 0) {
            r = r * 0.55 + 40;
            gg = gg * 0.6 + 40;
            b = b * 0.65 + 40;
          } else {
            shade *= 0.85 + cellHash(row, Math.floor((x + off) / 16)) * 0.3;
          }
          break;
        }
        case 'tile':
          if (x % 16 === 0 || y % 16 === 0) shade *= 0.6;
          else shade *= (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 1.05 : 0.9;
          break;
        case 'skin': {
          // Street dirt, grey-brown and neutral: nothing on the hands should read as a wound.
          const dirt = smooth(0.62, 0.85, blotch(u, v)) * 0.6;
          r = r + (96 - r) * dirt * 0.35;
          gg = gg + (86 - gg) * dirt * 0.35;
          b = b + (74 - b) * dirt * 0.35;
          break;
        }
        case 'foliage':
          shade *= 0.7 + 0.6 * smooth(0.3, 0.7, n);
          break;
        case 'ground': {
          // Subtle organic loam warmth without harsh dark camouflage blotches.
          const loam = (blotch(u, v) - 0.5) * 0.14;
          r = r * (1 + loam * 0.6);
          gg = gg * (1 + loam * 0.4);
          b = b * (1 - loam * 0.4);
          break;
        }
        default:
          break;
      }

      // Grime: low-frequency dark-brown patches (gentle on interior plaster, facades, fabric, glass and countryside ground).
      const surfGrime =
        kind === 'glass'
          ? 0.1
          : kind === 'ground'
            ? 0.12
            : kind === 'plaster' || kind === 'fabric'
              ? 0.24
              : kind === 'facadeBrick' || kind === 'facadeConcrete' || kind === 'facadeOffice'
                ? 0.32
                : 0.75;
      const dirt = smooth(0.5 - 0.14 * Math.max(0, grimeK - 1), 0.72, grime(u, v)) * Math.min(1, grimeK) * surfGrime;
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
  let glass: [number, number, number, number][] = [];
  if (kind === 'facadeConcrete' || kind === 'facadeBrick') glass = drawWindows(g, size, rand, false);
  if (kind === 'facadeOffice') glass = drawWindows(g, size, rand, true);
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
  // Last, so no later overlay restores the alpha.
  markGlass(g, glass);
  return canvas;
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
