import { join } from 'node:path';
import sharp from 'sharp';

const SIZE = 1024;
const OUT_DIR = 'public/textures/pbr';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePeriodicNoise(seed, cells) {
  const rand = mulberry32(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (x, y) => {
    const fx = (x / SIZE) * cells;
    const fy = (y / SIZE) * cells;
    const ix0 = ((Math.floor(fx) % cells) + cells) % cells;
    const iy0 = ((Math.floor(fy) % cells) + cells) % cells;
    const ix1 = (ix0 + 1) % cells;
    const iy1 = (iy0 + 1) % cells;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = g[iy0 * cells + ix0] * (1 - sx) + g[iy0 * cells + ix1] * sx;
    const b = g[iy1 * cells + ix0] * (1 - sx) + g[iy1 * cells + ix1] * sx;
    return a * (1 - sy) + b * sy;
  };
}

function heightToNormalGL(h, strength) {
  const out = Buffer.allocUnsafe(SIZE * SIZE * 3);
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tl = at(x - 1, y - 1);
      const t = at(x, y - 1);
      const tr = at(x + 1, y - 1);
      const l = at(x - 1, y);
      const r = at(x + 1, y);
      const bl = at(x - 1, y + 1);
      const b = at(x, y + 1);
      const br = at(x + 1, y + 1);
      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      let nx = -dX;
      let ny = dY;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const idx = (y * SIZE + x) * 3;
      out[idx] = Math.max(0, Math.min(255, Math.round((nx * 0.5 + 0.5) * 255)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round((ny * 0.5 + 0.5) * 255)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round((nz * 0.5 + 0.5) * 255)));
    }
  }
  return out;
}

async function main() {
  // Periodic multi-scale organic meadow/loam noises — soft gentle variation, NO dark camo blotches.
  const nBroad = makePeriodicNoise(6101, 6);
  const nMid = makePeriodicNoise(6102, 24);
  const nFine = makePeriodicNoise(6103, 96);
  const nCrumb = makePeriodicNoise(6104, 224);
  const rand = mulberry32(6109);

  const height = new Float32Array(SIZE * SIZE);
  const bladeMask = new Float32Array(SIZE * SIZE);

  // Fine flat meadow grass stalks & clover mat baked subtly into ground height/albedo.
  for (let i = 0; i < 4500; i++) {
    let x = rand() * SIZE;
    let y = rand() * SIZE;
    let ang = rand() * Math.PI * 2;
    const len = 6 + Math.floor(rand() * 14);
    const w = 0.55 + rand() * 0.45;
    for (let s = 0; s < len; s++) {
      ang += (rand() - 0.5) * 0.35;
      x = (x + Math.cos(ang) * 1.4 + SIZE) % SIZE;
      y = (y + Math.sin(ang) * 1.4 + SIZE) % SIZE;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const idx = iy * SIZE + ix;
      bladeMask[idx] = Math.max(bladeMask[idx], w * (1 - s / (len + 2)));
    }
  }

  const albedo = Buffer.allocUnsafe(SIZE * SIZE * 3);
  const rough = Buffer.allocUnsafe(SIZE * SIZE * 3);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = y * SIZE + x;
      const i3 = idx * 3;
      const broad = nBroad(x, y);
      const mid = nMid(x, y);
      const fine = nFine(x, y);
      const crumb = nCrumb(x, y);
      const blade = bladeMask[idx];

      // Subtle relief heightmap for NormalGL
      height[idx] = broad * 0.12 + mid * 0.24 + fine * 0.34 + crumb * 0.30 + blade * 0.25;

      // Smooth organic loam/meadow variation (luminance ~0.62..0.76, zero high-contrast blobs)
      const soil = 0.62 + (broad - 0.5) * 0.08 + (mid - 0.5) * 0.10 + (fine - 0.5) * 0.12 + (crumb - 0.5) * 0.10;
      const turfTint = blade * 0.07;
      const r = Math.max(110, Math.min(230, Math.round(soil * 240 - turfTint * 24)));
      const g = Math.max(115, Math.min(235, Math.round(soil * 246 + turfTint * 16)));
      const b = Math.max(95, Math.min(220, Math.round(soil * 212 - turfTint * 30)));
      albedo[i3] = r;
      albedo[i3 + 1] = g;
      albedo[i3 + 2] = b;

      // Matte organic soil & dry turf roughness
      const rg = Math.max(190, Math.min(252, Math.round(212 + (1 - fine) * 26 + (crumb - 0.5) * 22 - blade * 16)));
      rough[i3] = rough[i3 + 1] = rough[i3 + 2] = rg;
    }
  }

  const normal = heightToNormalGL(height, 1.85);
  await sharp(albedo, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 88, mozjpeg: true }).toFile(join(OUT_DIR, 'ground_albedo.jpg'));
  await sharp(normal, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 88, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(join(OUT_DIR, 'ground_normal.jpg'));
  await sharp(rough, { raw: { width: SIZE, height: SIZE, channels: 3 } }).jpeg({ quality: 84, mozjpeg: true }).toFile(join(OUT_DIR, 'ground_rough.jpg'));
  console.log('Generated 1024x1024 seamless PBR ground_{albedo,normal,rough}.jpg');
}

await main();
