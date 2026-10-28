/* Colors and random helpers shared by the world generators (no imports: safe from any module). */

/** Muted 90s-suburb-after-the-end palette. */
export const PAL = {
  grass: 0x4d5641,
  dirt: 0x5a5240,
  asphalt: 0x3a3c3e,
  dash: 0xa89b66,
  sidewalk: 0x74736c,
  curb: 0x85847c,
  path: 0x6c6a62,
  trim: 0xb9b4a4,
  window: 0x1f252a,
  floor: 0x5e4c39,
  ceiling: 0x3b3730,
  counter: 0x6d6250,
  counterTop: 0x9a9483,
  fence: 0x6e6352,
  trunk: 0x4a3b2e,
  leaves: [0x3f5236, 0x4a5a3a, 0x56603f, 0x4d4f34],
  metal: 0x3a3c3e,
  appliance: 0xb5b2a8,
  fabric: [0x4a3b38, 0x3c4450, 0x564c3c, 0x3e4a3e],
  bin: 0x3d4f3d,
  crate: 0x7a6646,
  sidings: [0x7d8a86, 0x8f7f6a, 0x857a6c, 0x6f7a6e, 0x8a8a80, 0x7a6a62],
  wallpapers: [0x7d7360, 0x6e7468, 0x7c6a62, 0x6c6858],
  roofs: [0x4a3f3a, 0x3d4146, 0x463b36, 0x3a3a34],
  shopFronts: [0x6a6e70, 0x7a6a58, 0x5e6658],
} as const;

export type Rand = () => number;
export const pick = <T>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
