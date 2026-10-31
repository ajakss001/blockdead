import type { Color } from 'three';
import { spotHash } from './lifeKinds';

/** Burnt: a colour taken most of the way to soot (the texture stays, only darker). */
export function char(color: number, k = 0.82): number {
  const s = [0x1c, 0x1a, 0x18];
  let out = 0;
  for (let i = 0; i < 3; i++) {
    const c = (color >> (16 - i * 8)) & 0xff;
    out = (out << 8) | Math.round(c + (s[i] - c) * k);
  }
  return out;
}

/** A model's vertex colours charred: dark, in patches (soot thicker in places, paint showing through in others). */
export function charTint(color: Color, x: number, y: number, z: number): void {
  const n = spotHash(Math.floor(x * 1.7), Math.floor(z * 1.7) + Math.floor(y * 2.3) * 13, 7);
  color.multiplyScalar(0.1 + 0.2 * n);
  color.r += 0.03;
  color.g += 0.025;
  color.b += 0.02;
}
