/**
 * The palette of a grim post-apocalyptic survival horror (CLAUDE.md, «Визуальный стиль»): every colour of
 * a model goes through `grim` — reference colours included. Pure sRGB maths, no three.js: the build code,
 * the tests and the tools share it.
 */

/** Pure white and pure black never appear: these stand in for them. */
export const WHITE = 0xa9a79c;
export const BLACK = 0x1e1f1d;
/** The only red there is: faded, rusty (never like blood). */
export const RUST_RED = 0x6e3b2e;

/** Zombie skin, eyes, stains. */
export const SKIN = 0x7a8274;
export const EYES = 0xb9bdb4;
/** Most a model may glow (emissive), e.g. the eyes. */
export const MAX_GLOW = 0.15;
export const DIRT = 0x4a4234;
export const SOOT = 0x2a2926;
export const OIL = 0x2f3330;

/** Weapons: rust on steel, insulating tape on handles. */
export const RUST = 0x6b4a33;
export const TAPE = 0x2b2c2e;

/** Final colours of the palette: `grim` leaves them as they are. */
const FINAL = new Set([WHITE, BLACK, RUST_RED, SKIN, EYES, DIRT, SOOT, OIL, RUST, TAPE]);

/** The cold grey-green the palette leans to (sRGB, its luminance 1). */
const COLD = [0.93, 1.03, 0.97];

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const LUM_WHITE = lum(...rgb(WHITE));
const LUM_BLACK = lum(...rgb(BLACK));
/** Above this a colour's lightness is squeezed (≈ #8E8C82 with the cloth's grime). */
const LUM_LIGHT = 0.46;

export function rgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export function hex(r: number, g: number, b: number): number {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}

const cache = new Map<number, number>();

/**
 * A colour as the grim world has it: half its saturation gone, a quarter darker, leaning to a cold
 * grey-green; whites go to WHITE, blacks to BLACK, reds to a faded rust. `amount` 0..1 (1: the full rule).
 */
export function grim(color: number, amount = 1): number {
  if (FINAL.has(color)) return color;
  const key = color + amount * 0x1000000;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const [r0, g0, b0] = rgb(color);
  let [h, s, l] = toHsl(r0, g0, b0);
  // Near white and near black: the palette's own.
  let out: [number, number, number];
  if (s < 0.18 && l > 0.86) out = rgb(WHITE);
  else if (l < 0.11) out = rgb(BLACK);
  else {
    // Reds (and pinks, oranges close to red) fade to rust: no colour like blood.
    const redness = Math.max(0, 1 - Math.min(Math.abs(h), Math.abs(1 - h)) / 0.07) * Math.min(1, s / 0.3);
    // Strong colours lose the most (a hi-vis yellow, a tracksuit teal end up dirty ochre, dull green):
    // half the saturation of a dull one, three quarters of a loud one; loud ones a shade darker too.
    const s0 = s;
    s = (s * 0.55) / (1 + 1.5 * s);
    l *= 0.76 * (1 - 0.12 * s0);
    out = fromHsl(h, s, l);
    // Towards the cold grey-green, at the same lightness.
    const L = lum(...out);
    out = out.map((v, i) => v + (L * COLD[i] - v) * 0.15) as [number, number, number];
    if (redness > 0) {
      const [rh, rs] = toHsl(...rgb(RUST_RED));
      // A shade duller than RUST_RED itself: a light red (a pink dress) must not stand out as the brightest thing.
      const rust = fromHsl(rh, rs * 0.72, l * 0.92);
      out = out.map((v, i) => v + (rust[i] - v) * redness) as [number, number, number];
    }
    // Light colours (cream, pale cloth) squeezed down: none as light as WHITE itself.
    const L1 = lum(...out);
    if (L1 > LUM_LIGHT) out = out.map((v) => (v * (LUM_LIGHT + (L1 - LUM_LIGHT) * 0.45)) / L1) as [number, number, number];
    // Inside the palette's range.
    const L2 = lum(...out);
    if (L2 > LUM_WHITE) out = out.map((v) => (v * LUM_WHITE) / L2) as [number, number, number];
    if (L2 < LUM_BLACK) out = out.map((v, i) => v + (rgb(BLACK)[i] - v) * (1 - L2 / LUM_BLACK)) as [number, number, number];
  }
  const res = amount >= 1 ? hex(...out) : hex(...out.map((v, i) => [r0, g0, b0][i] + (v - [r0, g0, b0][i]) * amount) as [number, number, number]);
  cache.set(key, res);
  return res;
}

/** HSL saturation (0..1) of a colour: for the checks (tests, the viewer). */
export function saturation(color: number): number {
  return toHsl(...rgb(color))[1];
}

/** Relative luminance (sRGB, 0..1). */
export function luminance(color: number): number {
  return lum(...rgb(color));
}
