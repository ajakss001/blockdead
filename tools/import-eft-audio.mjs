/**
 * Preprocesses all 58 Escape-from-Tarkov-style .wav assets listed in
 * C:\Users\pmoro\Downloads\dead_perimeter_audio_manifest.json into public/audio/:
 *  - Converts stereo 48 kHz -> mono 32 kHz 16-bit PCM WAV (antialiased 3-tap prefilter)
 *  - Trims leading silence on one-shots up to the first signal transient for zero-latency playback
 *  - Slices long footstep/run/crouch/glass recordings into 4-6 single-step clips
 *  - Writes public/audio/manifest.json mapping SampleGroup names -> file paths
 */
import fs from 'node:fs';
import path from 'node:path';

const DOWNLOADS = 'C:\\Users\\pmoro\\Downloads';
const MANIFEST_SRC = path.join(DOWNLOADS, 'dead_perimeter_audio_manifest.json');
const OUT_ROOT = path.resolve('public/audio');
const TARGET_SR = 32000;

/** Exact mapping of every source filename in the manifest to target group, path, and processing mode. */
const FILE_MAP = [
  // 1. Weapons, mechanics, ADS, armor
  { src: 'АК_(7.62_5.45)_Singl_#3-1795366767481.wav', group: 'shotAk', out: 'weapons/shot_ak.wav', mode: 'oneshot' },
  { src: 'M4A1_(5.56)_Single_i_#1-1795366813845.wav', group: 'shotM4', out: 'weapons/shot_m4.wav', mode: 'oneshot' },
  { src: 'Помповый_дробовик_(1_#4-1795366838504.wav', group: 'shotShotgun', out: 'weapons/shot_shotgun.wav', mode: 'oneshot' },
  { src: 'Пистолет_(9mm)_Singl_#4-1795366860977.wav', group: 'shotPistol', out: 'weapons/shot_pistol.wav', mode: 'oneshot' },
  { src: 'Охотничья_болтовая_в_#4-1795366880245.wav', group: 'shotHunting', out: 'weapons/shot_hunting.wav', mode: 'oneshot' },
  { src: 'Винтовкаавтомат_с_гл_#3-1795366958733.wav', group: 'shotRifleSup', out: 'weapons/shot_rifle_sup.wav', mode: 'oneshot' },
  { src: 'Пистолет_с_глушителе_#1-1795366978430.wav', group: 'shotPistolSup', out: 'weapons/shot_pistol_sup.wav', mode: 'oneshot' },
  { src: 'РПГ-7_(пуск_и_взрыв)_#2-1795366909066.wav', group: 'shotRpg', out: 'weapons/shot_rpg.wav', mode: 'oneshot' },
  { src: 'РПГ-7_(пуск_и_взрыв)_#2-1795366933604.wav', group: 'rpgExplosion', out: 'weapons/rpg_explosion.wav', mode: 'oneshot' },
  { src: 'Перезарядка_автомата_#2-1795367094633.wav', group: 'gunReloadRifle', out: 'weapons/reload_rifle.wav', mode: 'oneshot' },
  { src: 'Передергивание_цевья_#3-1795367042190.wav', group: 'gunPump', out: 'weapons/gun_pump.wav', mode: 'oneshot' },
  { src: 'Затвор_болтовой_винт_#4-1795367066718.wav', group: 'gunBolt', out: 'weapons/gun_bolt.wav', mode: 'oneshot' },
  { src: 'Проверка_магазина_(н_#4-1795367000503.wav', group: 'gunMagCheck', out: 'weapons/mag_check.wav', mode: 'oneshot' },
  { src: 'Осечка_пустой_магази_#4-1795367140773.wav', group: 'gunDry', out: 'weapons/gun_dry.wav', mode: 'oneshot' },
  { src: 'Попадание_пули_в_бро_#4-1795367157396.wav', group: 'armorHit', out: 'weapons/armor_hit.wav', mode: 'oneshot' },
  { src: 'Quick_soft_movement__#2-1795371329746.wav', group: 'adsRifle', out: 'weapons/ads_rifle.wav', mode: 'oneshot' },
  { src: 'Brief_quiet_sound_of_#2-1795371352446.wav', group: 'adsPistol', out: 'weapons/ads_pistol.wav', mode: 'oneshot' },

  // Casings
  { src: 'Single_spent_brass_r_#1-1795371377768.wav', group: 'casingAsphalt', out: 'casings/casing_asphalt.wav', mode: 'oneshot' },
  { src: 'Single_empty_brass_b_#1-1795371228694.wav', group: 'casingWood', out: 'casings/casing_wood.wav', mode: 'oneshot' },
  { src: 'Single_spent_brass_c_#1-1795371535554.wav', group: 'casingDirt', out: 'casings/casing_dirt.wav', mode: 'oneshot' },
  { src: 'Single_spent_brass_s_#2-1795371547525.wav', group: 'casingMetal', out: 'casings/casing_metal.wav', mode: 'oneshot' },
  { src: 'Single_empty_plastic_#4-1795371561233.wav', group: 'casingShotgun', out: 'casings/casing_shotgun.wav', mode: 'oneshot' },

  // 2. Footsteps (sliced into 4-6 single-step clips)
  { src: '1._Асфальт_(улица)_Х_#2-1795367313091.wav', group: 'stepAsphaltWalk', out: 'footsteps/asphalt_walk', mode: 'slice' },
  { src: 'Асфальт_—_Бег_Fast_h_#3-1795367566629.wav', group: 'stepAsphaltRun', out: 'footsteps/asphalt_run', mode: 'slice' },
  { src: 'Person_walking_slowl_#1-1795368754010.wav', group: 'stepDirtWalk', out: 'footsteps/dirt_walk', mode: 'slice' },
  { src: 'Person_running_stead_#3-1795368780413.wav', group: 'stepDirtRun', out: 'footsteps/dirt_run', mode: 'slice' },
  { src: 'Person_walking_slowl_#1-1795368808400.wav', group: 'stepWoodWalk', out: 'footsteps/wood_walk', mode: 'slice' },
  { src: 'Person_running_in_bo_#4-1795368835090.wav', group: 'stepWoodRun', out: 'footsteps/wood_run', mode: 'slice' },
  { src: 'Person_walking_up_co_#1-1795368872133.wav', group: 'stepConcreteWalk', out: 'footsteps/concrete_walk', mode: 'slice' },
  { src: 'Person_running_down__#1-1795368905343.wav', group: 'stepConcreteRun', out: 'footsteps/concrete_run', mode: 'slice' },
  { src: 'Muffled_heavy_footst_#2-1795368936822.wav', group: 'stepMuffled', out: 'footsteps/muffled', mode: 'slice' },
  { src: 'Person_walking_up_an_#3-1795368969820.wav', group: 'stepMetalWalk', out: 'footsteps/metal_walk', mode: 'slice' },
  { src: 'Person_running_fast__#2-1795368997591.wav', group: 'stepMetalRun', out: 'footsteps/metal_run', mode: 'slice' },

  // 3. Micro-foley, jumps, stamina
  { src: 'Single_natural_foot__#4-1795368159966.wav', group: 'pivotAsphalt', out: 'foley/pivot_asphalt.wav', mode: 'oneshot' },
  { src: 'Person_shifting_feet_#3-1795368186710.wav', group: 'pivotAsphaltFast', out: 'foley/pivot_asphalt_fast.wav', mode: 'oneshot' },
  { src: 'Single_natural_foot__#2-1795368287100.wav', group: 'pivotWood', out: 'foley/pivot_wood.wav', mode: 'oneshot' },
  { src: 'Single_foot_shift_tu_#1-1795368322925.wav', group: 'pivotConcrete', out: 'foley/pivot_concrete.wav', mode: 'oneshot' },
  { src: 'Single_foot_pivot_on_#4-1795368341534.wav', group: 'pivotDirt', out: 'foley/pivot_dirt.wav', mode: 'oneshot' },
  { src: 'Natural_muted_sound__#2-1795368366776.wav', group: 'crouchDown', out: 'foley/crouch_down.wav', mode: 'oneshot' },
  { src: 'Natural_muted_sound__#3-1795368430500.wav', group: 'standUp', out: 'foley/stand_up.wav', mode: 'oneshot' },
  { src: 'Slow_careful_crouch-_#2-1795368457853.wav', group: 'stepCrouch', out: 'footsteps/crouch', mode: 'slice' },
  { src: 'Single_heavy_boot_pu_#1-1795368477308.wav', group: 'jumpPush', out: 'foley/jump_push.wav', mode: 'oneshot' },
  { src: 'Single_heavy_two-foo_#1-1795368498888.wav', group: 'landHard', out: 'foley/land_hard.wav', mode: 'oneshot' },
  { src: 'Heavy_combat_boots_l_#1-1795368524325.wav', group: 'landMetal', out: 'foley/land_metal.wav', mode: 'oneshot' },
  { src: 'Exhausted_adult_male_#2-1795369131631.wav', group: 'breathClear', out: 'foley/breath_clear.wav', mode: 'loop' },
  { src: 'Muffled_exhausted_so_#1-1795369163189.wav', group: 'breathMask', out: 'foley/breath_mask.wav', mode: 'loop' },
  { src: 'Slow_heavy_muffled_h_#4-1795369184289.wav', group: 'heartbeat', out: 'foley/heartbeat.wav', mode: 'loop' },

  // 4. Environment, glass, doors, loot
  { src: 'Single_short_dry_woo_#2-1795369247294.wav', group: 'woodCreak', out: 'env/wood_creak.wav', mode: 'oneshot' },
  { src: 'Brief_sharp_dry_timb_#3-1795369266075.wav', group: 'woodCreakSharp', out: 'env/wood_creak_sharp.wav', mode: 'oneshot' },
  { src: 'Subtle_eerie_structu_#2-1795369287171.wav', group: 'buildingCreak', out: 'env/building_creak.wav', mode: 'oneshot' },
  { src: 'Heavy_combat_boot_st_#1-1795370147136.wav', group: 'stepGlassWalk', out: 'footsteps/glass_walk', mode: 'slice' },
  { src: 'Fast_rhythmic_runnin_#1-1795370318347.wav', group: 'stepGlassRun', out: 'footsteps/glass_run', mode: 'slice' },
  { src: 'Slow_careful_boot_st_#4-1795370345380.wav', group: 'stepGlassCrouch', out: 'footsteps/glass_crouch', mode: 'slice' },
  { src: 'Thick_apartment_wind_#1-1795370367008.wav', group: 'glassBreak', out: 'env/glass_break.wav', mode: 'oneshot' },
  { src: 'Loose_broken_glass_s_#2-1795370454333.wav', group: 'glassSettle', out: 'env/glass_settle.wav', mode: 'oneshot' },
  { src: 'Slowly_opening_an_ol_#2-1795368545061.wav', group: 'doorWood', out: 'env/door_wood.wav', mode: 'oneshot' },
  { src: 'Heavy_rusty_steel_en_#3-1795368584646.wav', group: 'doorMetal', out: 'env/door_metal.wav', mode: 'oneshot' },
  { src: 'Hands_searching_thro_#1-1795368602212.wav', group: 'lootSearch', out: 'foley/loot_search.wav', mode: 'loop' },
];

function readWavMonoFloat(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a valid RIFF/WAVE file: ${filePath}`);
  }
  let off = 12;
  let fmt = null;
  let dataStart = 0;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFmt: buf.readUInt16LE(off + 8),
        ch: buf.readUInt16LE(off + 10),
        sr: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      dataStart = off + 8;
      dataLen = Math.min(sz, buf.length - dataStart);
    }
    off += 8 + sz + (sz % 2);
  }
  if (!fmt || fmt.audioFmt !== 1 || fmt.bits !== 16 || dataLen <= 0) {
    throw new Error(`Unsupported WAV format in ${filePath}: ${JSON.stringify(fmt)}`);
  }
  const frames = Math.floor(dataLen / (fmt.ch * 2));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    const base = dataStart + i * fmt.ch * 2;
    for (let c = 0; c < fmt.ch; c++) {
      sum += buf.readInt16LE(base + c * 2) / 32768;
    }
    mono[i] = sum / fmt.ch;
  }
  return { sr: fmt.sr, samples: mono };
}

function resampleMono(samples, inSr, outSr) {
  if (inSr === outSr) return samples;
  // Mild 3-tap low-pass filter before downsampling to suppress aliasing.
  const src = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const a = i > 0 ? samples[i - 1] : samples[i];
    const b = samples[i];
    const c = i + 1 < samples.length ? samples[i + 1] : samples[i];
    src[i] = a * 0.25 + b * 0.5 + c * 0.25;
  }
  const ratio = inSr / outSr;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

function findPeakAbs(samples, start = 0, end = samples.length) {
  let peak = 0;
  for (let i = start; i < end; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

function trimAndFade(samples, sr, opts = {}) {
  const peak = findPeakAbs(samples);
  if (peak < 1e-5) return samples.slice(0, Math.min(samples.length, Math.round(sr * 0.1)));
  const startThresh = Math.max(0.012, peak * 0.02);
  const endThresh = Math.max(0.0025, peak * 0.004);
  let start = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= startThresh) {
      start = Math.max(0, i - Math.round(sr * (opts.leadPadSec ?? 0.002)));
      break;
    }
  }
  let end = samples.length;
  for (let i = samples.length - 1; i > start; i--) {
    if (Math.abs(samples[i]) >= endThresh) {
      end = Math.min(samples.length, i + Math.round(sr * (opts.tailPadSec ?? 0.03)));
      break;
    }
  }
  const out = samples.slice(start, Math.max(start + 64, end));
  const fadeIn = Math.min(Math.floor(out.length / 4), Math.round(sr * (opts.fadeInSec ?? 0.002)));
  const fadeOut = Math.min(Math.floor(out.length / 3), Math.round(sr * (opts.fadeOutSec ?? 0.008)));
  for (let i = 0; i < fadeIn; i++) out[i] *= i / Math.max(1, fadeIn);
  for (let i = 0; i < fadeOut; i++) out[out.length - 1 - i] *= i / Math.max(1, fadeOut);
  return out;
}

function sliceSteps(samples, sr) {
  const win = Math.round(sr * 0.01); // 10 ms RMS
  const hop = Math.round(sr * 0.004); // 4 ms hop
  const env = [];
  for (let pos = 0; pos + win <= samples.length; pos += hop) {
    let sum = 0;
    for (let k = 0; k < win; k++) {
      const v = samples[pos + k];
      sum += v * v;
    }
    env.push({ idx: pos, rms: Math.sqrt(sum / win) });
  }
  if (env.length === 0) return [trimAndFade(samples, sr)];

  const maxRms = env.reduce((m, e) => (e.rms > m ? e.rms : m), 0);
  const thresh = Math.max(0.018, maxRms * 0.16);
  const minGapSamples = Math.round(sr * 0.23);

  // Detect local energy peaks representing individual footstep impacts.
  const peaks = [];
  let lastPeakIdx = -minGapSamples;
  for (let i = 2; i < env.length - 2; i++) {
    const e = env[i];
    if (e.rms < thresh) continue;
    if (
      e.rms >= env[i - 1].rms &&
      e.rms >= env[i - 2].rms &&
      e.rms >= env[i + 1].rms &&
      e.rms >= env[i + 2].rms
    ) {
      if (e.idx - lastPeakIdx >= minGapSamples) {
        peaks.push({ idx: e.idx, rms: e.rms });
        lastPeakIdx = e.idx;
      } else if (peaks.length > 0 && e.rms > peaks[peaks.length - 1].rms) {
        peaks[peaks.length - 1] = { idx: e.idx, rms: e.rms };
        lastPeakIdx = e.idx;
      }
    }
  }

  let selected = peaks;
  if (selected.length > 6) {
    // Keep up to 6 clearest impacts in chronological order.
    selected = [...selected]
      .sort((a, b) => b.rms - a.rms)
      .slice(0, 6)
      .sort((a, b) => a.idx - b.idx);
  }

  const slices = [];
  if (selected.length >= 4) {
    for (let i = 0; i < selected.length; i++) {
      const pIdx = selected[i].idx;
      const prevMid = i > 0 ? Math.floor((selected[i - 1].idx + pIdx) / 2) : 0;
      const nextMid = i + 1 < selected.length ? Math.floor((pIdx + selected[i + 1].idx) / 2) : samples.length;
      const sStart = Math.max(prevMid, pIdx - Math.round(sr * 0.045));
      const sEnd = Math.min(nextMid, pIdx + Math.round(sr * 0.34));
      if (sEnd - sStart >= Math.round(sr * 0.08)) {
        slices.push(trimAndFade(samples.slice(sStart, sEnd), sr, { leadPadSec: 0.002, tailPadSec: 0.015, fadeInSec: 0.003, fadeOutSec: 0.02 }));
      }
    }
  }

  if (slices.length < 4) {
    // Fallback: divide the active signal span evenly into 4 steps.
    slices.length = 0;
    const active = trimAndFade(samples, sr, { leadPadSec: 0.005, tailPadSec: 0.02, fadeInSec: 0.002, fadeOutSec: 0.01 });
    const count = 4;
    const chunk = Math.floor(active.length / count);
    for (let i = 0; i < count; i++) {
      const s0 = i * chunk;
      const s1 = i + 1 === count ? active.length : (i + 1) * chunk;
      slices.push(trimAndFade(active.slice(s0, s1), sr, { leadPadSec: 0.002, tailPadSec: 0.015, fadeInSec: 0.003, fadeOutSec: 0.02 }));
    }
  }

  return slices;
}

function writeWavMono16(filePath, samples, sr) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const dataLen = samples.length * 2;
  const out = Buffer.alloc(44 + dataLen);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataLen, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); // PCM chunk size
  out.writeUInt16LE(1, 20); // PCM format
  out.writeUInt16LE(1, 22); // Mono
  out.writeUInt32LE(sr, 24);
  out.writeUInt32LE(sr * 2, 28); // Byte rate
  out.writeUInt16LE(2, 32); // Block align
  out.writeUInt16LE(16, 34); // Bits per sample
  out.write('data', 36);
  out.writeUInt32LE(dataLen, 40);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filePath, out);
  return out.length;
}

function main() {
  const srcManifest = JSON.parse(fs.readFileSync(MANIFEST_SRC, 'utf8'));
  const expectedFiles = Object.values(srcManifest.sounds).flat().map((x) => x.file);
  const mappedFiles = new Set(FILE_MAP.map((e) => e.src));
  for (const f of expectedFiles) {
    if (!mappedFiles.has(f)) throw new Error(`Manifest source file missing from FILE_MAP: ${f}`);
  }
  if (mappedFiles.size !== 58) throw new Error(`Expected 58 mapped files, got ${mappedFiles.size}`);

  if (fs.existsSync(OUT_ROOT)) fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  fs.mkdirSync(OUT_ROOT, { recursive: true });

  const outManifest = {};
  let totalBytes = 0;
  let totalClips = 0;

  for (const entry of FILE_MAP) {
    const srcPath = path.join(DOWNLOADS, entry.src);
    if (!fs.existsSync(srcPath)) throw new Error(`Missing source WAV: ${srcPath}`);
    const { sr, samples } = readWavMonoFloat(srcPath);
    const mono = resampleMono(samples, sr, TARGET_SR);

    if (entry.mode === 'slice') {
      const parts = sliceSteps(mono, TARGET_SR);
      outManifest[entry.group] = [];
      for (let i = 0; i < parts.length; i++) {
        const rel = `${entry.out}_${i + 1}.wav`;
        totalBytes += writeWavMono16(path.join(OUT_ROOT, rel), parts[i], TARGET_SR);
        outManifest[entry.group].push(rel);
        totalClips++;
      }
    } else {
      const processed = trimAndFade(
        mono,
        TARGET_SR,
        entry.mode === 'loop'
          ? { leadPadSec: 0.005, tailPadSec: 0.02, fadeInSec: 0.015, fadeOutSec: 0.015 }
          : { leadPadSec: 0.002, tailPadSec: 0.03, fadeInSec: 0.002, fadeOutSec: 0.006 },
      );
      totalBytes += writeWavMono16(path.join(OUT_ROOT, entry.out), processed, TARGET_SR);
      outManifest[entry.group] = [entry.out];
      totalClips++;
    }
  }

  fs.writeFileSync(path.join(OUT_ROOT, 'manifest.json'), JSON.stringify(outManifest, null, 2));
  console.log(`Processed ${FILE_MAP.length} source WAVs -> ${totalClips} clips across ${Object.keys(outManifest).length} groups (${(totalBytes / (1024 * 1024)).toFixed(2)} MB)`);
}

main();
