import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const SIZE = 1024;
const DOWNLOADS = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Downloads') : 'C:\\Users\\pmoro\\Downloads';
const OUT_DIR = 'public/textures/pbr';

const ZIPS = {
  brick: 'Bricks097_1K-JPG.zip',
  plaster: 'PaintedPlaster018_1K-JPG.zip',
  wood: 'Planks025C_1K-JPG.zip',
  tile: 'Tiles040_1K-JPG.zip',
};

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

/** Converts a periodic 1024x1024 heightmap [0..1] into an OpenGL tangent-space NormalGL buffer. */
function heightToNormalGL(h, strength) {
  const out = Buffer.allocUnsafe(SIZE * SIZE * 3);
  const at = (x, y) => h[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Sobel 3x3
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
      // NormalGL: +X right, +Y up (screen row y goes downward so bottom - top is -dY -> +dY? Wait: increasing image y goes down = -V, so dh/dV = -(b - t); therefore N = normalize(-dH/dU, -dH/dV, 1) = normalize(-dX, +dY, 1)).
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

async function rawRGB(path) {
  const { data } = await sharp(path)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function writeJpgRgb(buf, path, quality, isNormal = false) {
  await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .jpeg({ quality, chromaSubsampling: isNormal ? '4:4:4' : '4:2:0', mozjpeg: true })
    .toFile(path);
}

async function processArchiveSet(name, dir, prefix, hasAo) {
  const color = await rawRGB(join(dir, `${prefix}_Color.jpg`));
  const ao = hasAo ? await rawRGB(join(dir, `${prefix}_AmbientOcclusion.jpg`)) : null;
  const normal = await rawRGB(join(dir, `${prefix}_NormalGL.jpg`));
  const rough = await rawRGB(join(dir, `${prefix}_Roughness.jpg`));

  const albedo = Buffer.allocUnsafe(SIZE * SIZE * 3);
  for (let i = 0; i < albedo.length; i += 3) {
    const aoFactor = ao ? 0.62 + 0.38 * (ao[i] / 255) : 1.0;
    albedo[i] = Math.min(255, Math.round(color[i] * aoFactor));
    albedo[i + 1] = Math.min(255, Math.round(color[i + 1] * aoFactor));
    albedo[i + 2] = Math.min(255, Math.round(color[i + 2] * aoFactor));
  }

  await writeJpgRgb(albedo, join(OUT_DIR, `${name}_albedo.jpg`), 88, false);
  await writeJpgRgb(normal, join(OUT_DIR, `${name}_normal.jpg`), 88, true);
  await writeJpgRgb(rough, join(OUT_DIR, `${name}_rough.jpg`), 84, false);
}

async function buildConcreteSet(plasterDir) {
  const pCol = await rawRGB(join(plasterDir, 'PaintedPlaster018_1K-JPG_Color.jpg'));
  const pNrm = await rawRGB(join(plasterDir, 'PaintedPlaster018_1K-JPG_NormalGL.jpg'));
  const pRgh = await rawRGB(join(plasterDir, 'PaintedPlaster018_1K-JPG_Roughness.jpg'));

  const nLow = makePeriodicNoise(4101, 8);
  const nMid = makePeriodicNoise(4102, 24);
  const nFine = makePeriodicNoise(4103, 96);
  const rand = mulberry32(4109);

  const albedo = Buffer.allocUnsafe(SIZE * SIZE * 3);
  const height = new Float32Array(SIZE * SIZE);
  const rough = Buffer.allocUnsafe(SIZE * SIZE * 3);

  const panelW = SIZE / 2;
  const panelH = SIZE / 4;

  // Hairline structural cracks (wrapped across tile)
  const crackMap = new Float32Array(SIZE * SIZE);
  for (let c = 0; c < 6; c++) {
    let cx = rand() * SIZE;
    let cy = rand() * SIZE;
    let ang = rand() * Math.PI * 2;
    for (let s = 0; s < 140; s++) {
      ang += (rand() - 0.5) * 0.45;
      cx = (cx + Math.cos(ang) * 2.2 + SIZE) % SIZE;
      cy = (cy + Math.sin(ang) * 2.2 + SIZE) % SIZE;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((iy + dy + SIZE) % SIZE) * SIZE + ((ix + dx + SIZE) % SIZE);
          const dist = Math.hypot(dx, dy);
          crackMap[idx] = Math.max(crackMap[idx], Math.max(0, 1 - dist * 0.55));
        }
      }
    }
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = y * SIZE + x;
      const i3 = idx * 3;
      const lum = (pCol[i3] * 0.3 + pCol[i3 + 1] * 0.59 + pCol[i3 + 2] * 0.11) / 255;
      const n = nLow(x, y) * 0.5 + nMid(x, y) * 0.32 + nFine(x, y) * 0.18;

      // Precast concrete panel seams + tie-rod formwork holes
      const lx = x % panelW;
      const ly = y % panelH;
      const dxSeam = Math.min(lx, panelW - lx);
      const dySeam = Math.min(ly, panelH - ly);
      const dSeam = Math.min(dxSeam, dySeam);
      const seamDip = dSeam < 5 ? (1 - dSeam / 5) : 0;

      // Tie-rod holes inset 48px from horizontal & vertical seams
      const holeX = Math.min(Math.abs(lx - 52), Math.abs(panelW - 52 - lx));
      const holeY = Math.min(Math.abs(ly - 42), Math.abs(panelH - 42 - ly));
      const dHole = Math.hypot(holeX, holeY);
      const holeDip = dHole < 7 ? (1 - dHole / 7) : 0;

      const pit = (lum - 0.5) * 0.25 + (n - 0.5) * 0.45 - seamDip * 0.85 - holeDip * 0.75 - crackMap[idx] * 0.55;
      height[idx] = pit;

      // Cool neutral mineral concrete tone
      const shade = Math.max(0.28, Math.min(1.0, 0.72 * lum + 0.28 * n - seamDip * 0.34 - holeDip * 0.38 - crackMap[idx] * 0.24));
      const v = Math.round(shade * 212);
      albedo[i3] = v;
      albedo[i3 + 1] = Math.min(255, Math.round(v * 0.99));
      albedo[i3 + 2] = Math.min(255, Math.round(v * 0.96));

      // Matte mineral concrete with smoother troweled/worn patches and rough seams/cracks
      const rBase = Math.max(
        135,
        Math.min(252, Math.round(145 + (pRgh[i3] / 255) * 65 + (1 - n) * 40 + seamDip * 28 + crackMap[idx] * 24)),
      );
      rough[i3] = rough[i3 + 1] = rough[i3 + 2] = rBase;
    }
  }

  const macroNrm = heightToNormalGL(height, 2.2);
  const blendedNrm = Buffer.allocUnsafe(SIZE * SIZE * 3);
  for (let i = 0; i < blendedNrm.length; i += 3) {
    // Combine Reoriented/Additive XY detail from PaintedPlaster018_NormalGL + Concrete seam/crack macro normals
    const nx1 = (pNrm[i] / 255) * 2 - 1;
    const ny1 = (pNrm[i + 1] / 255) * 2 - 1;
    const nz1 = (pNrm[i + 2] / 255) * 2 - 1;
    const nx2 = (macroNrm[i] / 255) * 2 - 1;
    const ny2 = (macroNrm[i + 1] / 255) * 2 - 1;
    const nz2 = (macroNrm[i + 2] / 255) * 2 - 1;
    let nx = nx1 * 0.65 + nx2;
    let ny = ny1 * 0.65 + ny2;
    let nz = nz1 * nz2;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    blendedNrm[i] = Math.max(0, Math.min(255, Math.round((nx * 0.5 + 0.5) * 255)));
    blendedNrm[i + 1] = Math.max(0, Math.min(255, Math.round((ny * 0.5 + 0.5) * 255)));
    blendedNrm[i + 2] = Math.max(0, Math.min(255, Math.round((nz * 0.5 + 0.5) * 255)));
  }

  await writeJpgRgb(albedo, join(OUT_DIR, 'concrete_albedo.jpg'), 88, false);
  await writeJpgRgb(blendedNrm, join(OUT_DIR, 'concrete_normal.jpg'), 88, true);
  await writeJpgRgb(rough, join(OUT_DIR, 'concrete_rough.jpg'), 84, false);
}

async function buildAsphaltSet() {
  const nMacro = makePeriodicNoise(5201, 10);
  const nMid = makePeriodicNoise(5202, 48);
  const nGrit = makePeriodicNoise(5203, 144);
  const nMicro = makePeriodicNoise(5204, 288);
  const rand = mulberry32(5207);

  const albedo = Buffer.allocUnsafe(SIZE * SIZE * 3);
  const height = new Float32Array(SIZE * SIZE);
  const rough = Buffer.allocUnsafe(SIZE * SIZE * 3);

  // Fine sealed tar cracks across asphalt
  const cracks = new Float32Array(SIZE * SIZE);
  for (let c = 0; c < 4; c++) {
    let cx = rand() * SIZE;
    let cy = rand() * SIZE;
    let ang = rand() * Math.PI * 2;
    for (let s = 0; s < 160; s++) {
      ang += (rand() - 0.5) * 0.5;
      cx = (cx + Math.cos(ang) * 2.0 + SIZE) % SIZE;
      cy = (cy + Math.sin(ang) * 2.0 + SIZE) % SIZE;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const idx = ((iy + dy + SIZE) % SIZE) * SIZE + ((ix + dx + SIZE) % SIZE);
          const dist = Math.hypot(dx, dy);
          cracks[idx] = Math.max(cracks[idx], Math.max(0, 1 - dist * 0.6));
        }
      }
    }
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = y * SIZE + x;
      const i3 = idx * 3;
      const grit = nGrit(x, y);
      const micro = nMicro(x, y);
      const mid = nMid(x, y);
      const macro = nMacro(x, y);
      const pebble = micro > 0.72 ? (micro - 0.72) * 1.4 : micro < 0.25 ? -(0.25 - micro) * 1.1 : 0;

      const h = macro * 0.26 + mid * 0.34 + grit * 0.28 + pebble * 0.42 - cracks[idx] * 0.6;
      height[idx] = h;

      // Crushed aggregate dark grey asphalt with lighter mineral flecks
      const base = 64 + macro * 20 + mid * 22 + grit * 20 + (micro > 0.75 ? 26 : micro < 0.24 ? -14 : 0) - cracks[idx] * 30;
      const clampB = Math.max(24, Math.min(155, Math.round(base)));
      albedo[i3] = clampB;
      albedo[i3 + 1] = clampB;
      albedo[i3 + 2] = Math.min(158, clampB + 2);

      // Matte bitumen ~225..248, exposed worn mineral stone ~160..195
      const rVal = micro > 0.75 ? 168 : Math.max(175, Math.min(250, Math.round(238 - grit * 34 + cracks[idx] * 14)));
      rough[i3] = rough[i3 + 1] = rough[i3 + 2] = rVal;
    }
  }

  const normal = heightToNormalGL(height, 1.9);
  await writeJpgRgb(albedo, join(OUT_DIR, 'asphalt_albedo.jpg'), 88, false);
  await writeJpgRgb(normal, join(OUT_DIR, 'asphalt_normal.jpg'), 88, true);
  await writeJpgRgb(rough, join(OUT_DIR, 'asphalt_rough.jpg'), 84, false);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const stage = mkdtempSync(join(tmpdir(), 'blockdead-pbr-'));
  try {
    for (const [name, zipFile] of Object.entries(ZIPS)) {
      const zipPath = join(DOWNLOADS, zipFile);
      if (!existsSync(zipPath)) throw new Error(`Missing archive: ${zipPath}`);
      const dest = join(stage, name);
      mkdirSync(dest, { recursive: true });
      execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`],
        { stdio: 'inherit' },
      );
    }

    await processArchiveSet('brick', join(stage, 'brick'), 'Bricks097_1K-JPG', true);
    await processArchiveSet('plaster', join(stage, 'plaster'), 'PaintedPlaster018_1K-JPG', true);
    await processArchiveSet('wood', join(stage, 'wood'), 'Planks025C_1K-JPG', true);
    await processArchiveSet('tile', join(stage, 'tile'), 'Tiles040_1K-JPG', false);
    await buildConcreteSet(join(stage, 'plaster'));
    await buildAsphaltSet();

    let totalBytes = 0;
    for (const mat of ['brick', 'plaster', 'wood', 'tile', 'concrete', 'asphalt']) {
      for (const map of ['albedo', 'normal', 'rough']) {
        const p = join(OUT_DIR, `${mat}_${map}.jpg`);
        const meta = await sharp(p).metadata();
        const stats = await sharp(p).stats();
        const sz = statSync(p).size;
        totalBytes += sz;
        if (meta.width !== SIZE || meta.height !== SIZE) {
          throw new Error(`Invalid dimensions for ${p}: ${meta.width}x${meta.height}`);
        }
        if (map === 'normal' && stats.channels[2].mean < 170) {
          throw new Error(`Invalid tangent NormalGL blue mean for ${p}: ${stats.channels[2].mean}`);
        }
        console.log(`${mat}_${map}.jpg: ${meta.width}x${meta.height} ${(sz / 1024).toFixed(1)}KB`);
      }
    }
    console.log(`Total 18 PBR maps: ${(totalBytes / 1048576).toFixed(2)} MB`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

await main();
