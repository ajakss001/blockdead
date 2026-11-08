/**
 * npm run sounds (and the last step of npm run import:assets) — recorded sounds from assets/incoming/sounds
 * (WAV, kept out of git) into public/sounds:
 *
 *   <name>.mp3     mono 44.1 kHz, ~96 kbps; silence trimmed off both ends, peak-normalised to −1 dBFS
 *   sounds.json    the groups the game plays from (src/audio/samples.ts): name → its variants
 *
 * Cuts: the long takes are split — melee_swing_heavy_hit by its pauses, the best 5 hits kept (loud, clean,
 * one impact each, from the impact on); metal_clatter_light (a continuous roll) at its transients into spent cases on the floor
 * (short taps) and magazine drops (the heaviest hits with their rattle); the RPG booms cut to 4.5 s, the
 * tail faded out. The rest pass whole (trimmed, normalised).
 *
 * Needs ffmpeg on PATH. With no input folder it changes nothing (the game falls back to its synthesis).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const IN = join(ROOT, 'assets', 'incoming', 'sounds');
const OUT = join(ROOT, 'public', 'sounds');
const RATE = 44100;

if (!existsSync(IN)) {
  console.log(`sounds: нет ${IN} — звуки не меняются`);
  process.exit(0);
}
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.log('sounds: нет ffmpeg в PATH — звуки не меняются');
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });

/** The file as mono float samples at RATE. */
function pcm(file) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
/** RMS per 10 ms frame, dB. */
function envelope(x) {
  const F = RATE / 100, n = Math.floor(x.length / F), e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < F; k++) s += x[i * F + k] ** 2;
    e[i] = 10 * Math.log10(s / F + 1e-12);
  }
  return e;
}
const peakDb = (x, a, b) => {
  let p = 0;
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) p = Math.max(p, Math.abs(x[i]));
  return 20 * Math.log10(p + 1e-12);
};
/** Runs of sound between pauses (below `floor` dB for at least `gap` s), [start, end] in seconds. */
function segments(e, floor, gap) {
  const out = [];
  let on = -1, quiet = 0;
  for (let i = 0; i < e.length; i++) {
    if (e[i] > floor) {
      if (on < 0) on = i;
      quiet = 0;
    } else if (on >= 0 && ++quiet * 0.01 >= gap) {
      out.push([on / 100, (i - quiet + 1) / 100]);
      on = -1;
    }
  }
  if (on >= 0) out.push([on / 100, e.length / 100]);
  return out;
}
/** Onsets: a frame ≥ 9 dB over the one 30 ms before it and a local peak, ≥ `space` s apart (louder kept). */
function onsets(e, space) {
  const c = [];
  for (let i = 3; i < e.length - 2; i++) if (e[i] - e[i - 3] >= 9 && e[i] >= e[i - 1] && e[i] >= e[i + 1] && e[i] > -45) c.push(i);
  c.sort((a, b) => e[b] - e[a]);
  const keep = [];
  for (const i of c) if (keep.every((k) => Math.abs(k - i) * 0.01 >= space)) keep.push(i);
  return keep.map((i) => ({ t: Math.max(0, (i - 2) / 100), db: e[i] }));
}

const groups = {};
const report = [];
/**
 * One output: [start, start+dur) of the file, mono, silence trimmed off both ends, peak to −1 dBFS, a fade
 * out over the last `fade` s.
 */
function cut(src, name, group, { start = 0, dur = 0, fade = 0.02 } = {}) {
  const file = join(IN, `${src}.wav`);
  const x = pcm(file);
  const a = Math.floor(start * RATE), b = dur ? Math.min(x.length, Math.floor((start + dur) * RATE)) : x.length;
  const gain = -1 - peakDb(x, a, b);
  // The length after the trims (for the fade's place): the last sample above −55 dB.
  let end = b;
  while (end > a && Math.abs(x[end - 1]) < 10 ** (-55 / 20)) end--;
  let beg = a;
  while (beg < end && Math.abs(x[beg]) < 10 ** (-50 / 20)) beg++;
  beg = Math.max(a, beg - Math.floor(0.004 * RATE));
  const len = (end - beg) / RATE;
  const f = Math.min(fade, len * 0.5);
  const out = join(OUT, `${name}.mp3`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', (beg / RATE).toFixed(4), '-t', len.toFixed(4), '-i', file,
    '-af', `aformat=channel_layouts=mono,aresample=${RATE},volume=${gain.toFixed(2)}dB,afade=t=in:d=0.003,afade=t=out:st=${Math.max(0, len - f).toFixed(4)}:d=${f.toFixed(4)}`,
    '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-id3v2_version', '0', '-write_xing', '0', '-c:a', 'libmp3lame', '-b:a', '96k', out]);
  (groups[group] ??= []).push(`${name}.mp3`);
  report.push(`${name}.mp3 ${len.toFixed(2)} с ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
const have = (n) => existsSync(join(IN, `${n}.wav`));

// RPG: the boom and 4.5 s of its roll, the last 2 s faded.
for (const k of [1, 2, 3]) if (have(`rpg_explosion_${k}`)) cut(`rpg_explosion_${k}`, `explosion_${k}`, 'explosion', { dur: 4.5, fade: 2 });

// Whole one-shots.
const WHOLE = [
  ['melee_swing', 'swing', 'swing', 0.15],
  ['melee_hit_metal', 'hit_metal', 'hitMetal', 0.6],
  ['dry_fire_click', 'dry_fire', 'dry', 0.03],
  ['mech_rattle', 'mech_rattle', 'rattle', 0.03],
  ['impact_metal', 'impact_metal', 'bulletMetal', 0.08],
  ['zombie_attack', 'zombie_attack', 'zAttack', 0.3],
  ['zombie_scream', 'zombie_scream', 'zScream', 0.6],
  ['zombie_breath', 'zombie_breath', 'zBreath', 0.15],
  ['zombie_death', 'zombie_death', 'zDeath', 0.6],
];
for (const [src, name, group, fade] of WHOLE) if (have(src)) cut(src, name, group, { fade });

// Heavy swing-to-thud: split by its pauses; the 5 loudest whole takes (0.3–2.5 s each), cut to their impact.
if (have('melee_swing_heavy_hit')) {
  const x = pcm(join(IN, 'melee_swing_heavy_hit.wav'));
  const segs = segments(envelope(x), -42, 0.12)
    .filter(([a, b]) => b - a >= 0.3 && b - a <= 2.5)
    .map(([a, b]) => ({ a, b, db: peakDb(x, Math.floor(a * RATE), Math.floor(b * RATE)) }))
    .sort((p, q) => q.db - p.db)
    .slice(0, 5)
    .sort((p, q) => p.a - q.a);
  // From the impact on (its loudest 10 ms, 25 ms before it): the game plays it at the moment of the blow, the
  // whoosh before it is the swing's own sound.
  const e = envelope(x);
  segs.forEach((s, i) => {
    let k = Math.floor(s.a * 100);
    for (let j = k; j < Math.min(e.length, Math.ceil(s.b * 100)); j++) if (e[j] > e[k]) k = j;
    const at = Math.max(s.a, k / 100 - 0.025);
    cut('melee_swing_heavy_hit', `heavy_hit_${i + 1}`, 'heavyHit', { start: at, dur: s.b - at + 0.12, fade: 0.15 });
  });
}

// The light metal clatter (one long roll): its transients. Cases: 4 short bright taps (0.35 s each); the
// magazine: the 2 heaviest hits with 0.8 s of their rattle (played lower, heavier).
if (have('metal_clatter_light')) {
  const x = pcm(join(IN, 'metal_clatter_light.wav'));
  const on = onsets(envelope(x), 0.45);
  const mags = on.slice(0, 2), cases = on.slice(2, 6);
  mags.sort((p, q) => p.t - q.t).forEach((o, i) => cut('metal_clatter_light', `mag_drop_${i + 1}`, 'magDrop', { start: o.t, dur: 0.8, fade: 0.3 }));
  cases.sort((p, q) => p.t - q.t).forEach((o, i) => cut('metal_clatter_light', `casing_${i + 1}`, 'casing', { start: o.t, dur: 0.35, fade: 0.15 }));
}

writeFileSync(join(OUT, 'sounds.json'), JSON.stringify(groups, null, 1) + '\n');
console.log(report.join('\n'));
const total = report.length;
console.log(`sounds: ${total} файлов → public/sounds`);
