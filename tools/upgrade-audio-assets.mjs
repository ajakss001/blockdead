import fs from 'node:fs';
import path from 'node:path';

const DOWNLOADS = 'C:/Users/pmoro/Downloads';
const PUBLIC_AUDIO = path.resolve('public/audio');

function readWav(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Invalid WAV: ${filePath}`);
  }
  let channels = 1;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let dataStart = 0;
  let dataSize = 0;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      dataStart = body;
      dataSize = Math.min(sz, buf.length - body);
      break;
    }
    off = body + sz + (sz & 1);
  }
  if (!dataSize || bitsPerSample !== 16) {
    throw new Error(`Unsupported WAV (${bitsPerSample}bit) in ${filePath}`);
  }
  const frames = Math.floor(dataSize / (channels * 2));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += buf.readInt16LE(dataStart + (i * channels + c) * 2) / 32768;
    }
    mono[i] = sum / channels;
  }
  return { sampleRate, samples: mono };
}

function resampleLinear(samples, srcRate, dstRate) {
  if (srcRate === dstRate) return samples;
  const outLen = Math.max(1, Math.round((samples.length * dstRate) / srcRate));
  const out = new Float32Array(outLen);
  const ratio = srcRate / dstRate;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const f = pos - i0;
    out[i] = samples[i0] * (1 - f) + samples[i1] * f;
  }
  return out;
}

function writeWav32kMono(filePath, samples, sampleRate = 32000) {
  const dataBytes = samples.length * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out);
}

function processClip(rawSamples, sampleRate, { startThresh = 0.014, maxSec = 10, fadeInMs = 4, fadeOutMs = 35, targetPeak = 0.708 }) {
  let start = 0;
  while (start < rawSamples.length && Math.abs(rawSamples[start]) < startThresh) start++;
  if (start >= rawSamples.length) start = 0;
  start = Math.max(0, start - Math.round(sampleRate * 0.002));

  let end = Math.min(rawSamples.length, start + Math.round(sampleRate * maxSec));
  // Trim trailing digital dead air
  while (end > start + Math.round(sampleRate * 0.06) && Math.abs(rawSamples[end - 1]) < 0.002) end--;

  const slice = rawSamples.slice(start, end);
  // DC offset removal
  let mean = 0;
  for (let i = 0; i < slice.length; i++) mean += slice[i];
  mean /= Math.max(1, slice.length);
  let peak = 0;
  for (let i = 0; i < slice.length; i++) {
    slice[i] -= mean;
    const a = Math.abs(slice[i]);
    if (a > peak) peak = a;
  }
  if (peak > 1e-5) {
    const scale = targetPeak / peak;
    for (let i = 0; i < slice.length; i++) slice[i] *= scale;
  }

  const fi = Math.min(Math.floor(slice.length * 0.15), Math.round((sampleRate * fadeInMs) / 1000));
  for (let i = 0; i < fi; i++) {
    slice[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, fi));
  }
  const fo = Math.min(Math.floor(slice.length * 0.4), Math.round((sampleRate * fadeOutMs) / 1000));
  for (let i = 0; i < fo; i++) {
    const idx = slice.length - 1 - i;
    slice[idx] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / Math.max(1, fo));
  }
  return slice;
}

function sliceFootsteps(samples, sr, count, { minGapSec, sliceDurSec }) {
  const win = Math.round(sr * 0.015);
  const env = new Float32Array(samples.length);
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
    if (i >= win) sumSq -= samples[i - win] * samples[i - win];
    env[i] = Math.sqrt(Math.max(0, sumSq / win));
  }
  let maxEnv = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > maxEnv) maxEnv = env[i];

  const minGap = Math.round(sr * minGapSec);
  const thresh = maxEnv * 0.18;
  const peaks = [];
  for (let i = win; i < env.length - win; i++) {
    if (env[i] < thresh) continue;
    let isLocal = true;
    const look = Math.round(sr * 0.06);
    for (let k = Math.max(0, i - look); k <= Math.min(env.length - 1, i + look); k++) {
      if (env[k] > env[i]) { isLocal = false; break; }
    }
    if (!isLocal) continue;
    if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minGap) {
      peaks.push(i);
    }
  }

  // Fallback to even segments if transient detector found fewer than requested
  const chosen = [];
  if (peaks.length >= count) {
    for (let i = 0; i < count; i++) {
      const pIdx = Math.floor((i * peaks.length) / count);
      const center = peaks[pIdx];
      let onset = Math.max(0, center - Math.round(sr * 0.045));
      while (onset < center && Math.abs(samples[onset]) < 0.012) onset++;
      onset = Math.max(0, onset - Math.round(sr * 0.002));
      const nextBound = pIdx + 1 < peaks.length ? peaks[pIdx + 1] - Math.round(sr * 0.05) : samples.length;
      const end = Math.min(nextBound, onset + Math.round(sr * sliceDurSec));
      if (end - onset >= Math.round(sr * 0.12)) {
        chosen.push(processClip(samples.slice(onset, end), sr, { startThresh: 0.005, maxSec: sliceDurSec, fadeInMs: 2, fadeOutMs: 30, targetPeak: 0.708 }));
      }
    }
  }
  while (chosen.length < count) {
    const idx = chosen.length;
    const span = Math.floor(samples.length / count);
    const seg = samples.slice(idx * span, Math.min(samples.length, idx * span + Math.round(sr * sliceDurSec)));
    chosen.push(processClip(seg, sr, { startThresh: 0.008, maxSec: sliceDurSec, fadeInMs: 2, fadeOutMs: 30, targetPeak: 0.708 }));
  }
  return chosen.slice(0, count);
}

const SRC_RATE = 32000;

// 1) Loot bag zip: strictly first 0.60 s of Unzipping_a_heavy_ny_#1-1795527979476.wav (no rummaging tail)
{
  const zipPath = path.join(DOWNLOADS, 'Unzipping_a_heavy_ny_#1-1795527979476.wav');
  const raw = readWav(zipPath);
  const resampled = resampleLinear(raw.samples, raw.sampleRate, SRC_RATE);
  const trimmed = processClip(resampled, SRC_RATE, { startThresh: 0.015, maxSec: 0.60, fadeInMs: 6, fadeOutMs: 45, targetPeak: 0.68 });
  const out = path.join(PUBLIC_AUDIO, 'foley/loot_bag_zip.wav');
  writeWav32kMono(out, trimmed, SRC_RATE);
  console.log(`zip -> ${(trimmed.length / SRC_RATE).toFixed(3)}s (${out})`);
}

// 2) Trim all UI sounds cleanly <= 0.80 s (item_move <= 0.55 s), zero clipping/rasp
for (const [file, maxSec] of [
  ['ui/item_move.wav', 0.45],
  ['ui/equip_weapon.wav', 0.72],
  ['ui/equip_vest.wav', 0.72],
  ['ui/equip_cloth.wav', 0.68],
  ['ui/equip_helmet.wav', 0.55],
]) {
  const full = path.join(PUBLIC_AUDIO, file);
  const raw = readWav(full);
  const resampled = resampleLinear(raw.samples, raw.sampleRate, SRC_RATE);
  const trimmed = processClip(resampled, SRC_RATE, { startThresh: 0.012, maxSec, fadeInMs: 4, fadeOutMs: 38, targetPeak: 0.68 });
  writeWav32kMono(full, trimmed, SRC_RATE);
  console.log(`${file} -> ${(trimmed.length / SRC_RATE).toFixed(3)}s`);
}

// 3) Dry indoor concrete/hallway footsteps (walk 1..5, run 1..6)
{
  const walkRaw = readWav(path.join(DOWNLOADS, 'Dry_close-up_footste_#4-1795527615160.wav'));
  const walk32 = resampleLinear(walkRaw.samples, walkRaw.sampleRate, SRC_RATE);
  const walkSlices = sliceFootsteps(walk32, SRC_RATE, 5, { minGapSec: 0.28, sliceDurSec: 0.28 });
  walkSlices.forEach((s, idx) => {
    const out = path.join(PUBLIC_AUDIO, `footsteps/concrete_walk_${idx + 1}.wav`);
    writeWav32kMono(out, s, SRC_RATE);
  });
  console.log(`concrete_walk x${walkSlices.length} -> ${walkSlices.map((s) => (s.length / SRC_RATE).toFixed(2) + 's').join(', ')}`);

  const runRaw = readWav(path.join(DOWNLOADS, 'Dry_close-up_running_#1-1795527653269.wav'));
  const run32 = resampleLinear(runRaw.samples, runRaw.sampleRate, SRC_RATE);
  const runSlices = sliceFootsteps(run32, SRC_RATE, 6, { minGapSec: 0.21, sliceDurSec: 0.22 });
  runSlices.forEach((s, idx) => {
    const out = path.join(PUBLIC_AUDIO, `footsteps/concrete_run_${idx + 1}.wav`);
    writeWav32kMono(out, s, SRC_RATE);
  });
  console.log(`concrete_run x${runSlices.length} -> ${runSlices.map((s) => (s.length / SRC_RATE).toFixed(2) + 's').join(', ')}`);
}

// 4) Glass break & broken glass floor settle from user Downloads masters
{
  const gbRaw = readWav(path.join(DOWNLOADS, 'Thick_apartment_wind_#1-1795370367008.wav'));
  const gb32 = resampleLinear(gbRaw.samples, gbRaw.sampleRate, SRC_RATE);
  const gbTrim = processClip(gb32, SRC_RATE, { startThresh: 0.018, maxSec: 1.85, fadeInMs: 2, fadeOutMs: 40, targetPeak: 0.78 });
  writeWav32kMono(path.join(PUBLIC_AUDIO, 'env/glass_break.wav'), gbTrim, SRC_RATE);

  const gsRaw = readWav(path.join(DOWNLOADS, 'Loose_broken_glass_s_#2-1795370454333.wav'));
  const gs32 = resampleLinear(gsRaw.samples, gsRaw.sampleRate, SRC_RATE);
  const gsTrim = processClip(gs32, SRC_RATE, { startThresh: 0.015, maxSec: 0.95, fadeInMs: 4, fadeOutMs: 40, targetPeak: 0.74 });
  writeWav32kMono(path.join(PUBLIC_AUDIO, 'env/glass_settle.wav'), gsTrim, SRC_RATE);
  console.log(`glass_break=${(gbTrim.length / SRC_RATE).toFixed(2)}s glass_settle=${(gsTrim.length / SRC_RATE).toFixed(2)}s`);
}
