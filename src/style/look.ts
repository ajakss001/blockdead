import { Color } from 'three';
import { DIRT, OIL, SOOT } from './palette';

/**
 * Which look the models are built in: grim (the game, CLAUDE.md «Визуальный стиль») or the old toy look
 * (the viewer's «до» button). Builders key their caches by it.
 */
export const look = { grim: true };

/** Value noise in 3D (0..1) from a position: for grime baked into vertex colours. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const f = (t: number) => t * t * (3 - 2 * t);
  const fx = f(x - xi);
  const fy = f(y - yi);
  const fz = f(z - zi);
  const h = (a: number, b: number, c: number) => {
    const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return s - Math.floor(s);
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const x0 = l(h(xi, yi, zi), h(xi + 1, yi, zi), fx);
  const x1 = l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), fx);
  const x2 = l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), fx);
  const x3 = l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), fx);
  return l(l(x0, x1, fy), l(x2, x3, fy), fz);
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Hash and value noise in GLSL (zHash, zNoise: 0..1) for the shaders' grime, stains and wear. */
export const NOISE_GLSL = /* glsl */ `
float zHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float zNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(zHash(i), zHash(i + vec3(1, 0, 0)), f.x), mix(zHash(i + vec3(0, 1, 0)), zHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(zHash(i + vec3(0, 0, 1)), zHash(i + vec3(1, 0, 1)), f.x), mix(zHash(i + vec3(0, 1, 1)), zHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

/** A GLSL vec3 literal of a colour in the renderer's working (linear) space. */
export function glslColor(hex: number): string {
  const c = new Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/**
 * Stains by position (dirt, soot, oil), never red: GLSL using `zNoise`/`zHash` (characters/material) or the
 * same functions, on `p` (a position in the part's own frame, m) — `amount` the share of the surface.
 */
export function stainGlsl(p: string, rgb: string, amount = 1): string {
  return `{
  // Warped, three octaves, soft-edged: smears and splashes, not round blots.
  vec3 zq = ${p} + 0.09 * vec3(zNoise(${p} * 9.0), zNoise(${p} * 9.0 + 5.2), zNoise(${p} * 9.0 + 9.1));
  float zsn = zNoise(zq * 5.0 + 3.1) * 0.5 + zNoise(zq * 13.0 + 9.7) * 0.32 + zNoise(zq * 37.0) * 0.18;
  float zst = smoothstep(${(0.64 - 0.06 * amount).toFixed(3)}, ${(0.78 - 0.06 * amount).toFixed(3)}, zsn);
  if (zst > 0.0) {
    float zw = zHash(floor(${p} * 3.0) + 1.3);
    vec3 zc = zw < 0.45 ? ${glslColor(DIRT)} : zw < 0.8 ? ${glslColor(SOOT)} : ${glslColor(OIL)};
    ${rgb} = mix(${rgb}, zc, zst * 0.5);
  }
}`;
}
