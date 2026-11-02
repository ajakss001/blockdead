/**
 * The light of the grim world (CLAUDE.md «Визуальный стиль»), shared by the game (scenes/WorldScene) and
 * the viewers (tools/zombie-viewer.html): an overcast cold day — a hemisphere of grey sky over dark earth,
 * a weak cold sun, grey fog — and a night that is darker still (the flashlight is the light).
 */
export const DAY = {
  /** Sky, background and fog: grey, no blue. */
  sky: 0x5e6366,
  fogNear: 6,
  hemi: { sky: 0x6e747a, ground: 0x3a3830, intensity: 2.4 },
  sun: { color: 0xb8bcc0, intensity: 0.75 },
} as const;

export const NIGHT = {
  sky: 0x07080a,
  fogNear: 2,
  hemi: { sky: 0x0a0c10, ground: 0x050504, intensity: 0.5 },
  moon: { color: 0x5a6470, intensity: 0.22 },
} as const;

/** The viewers' fog density (the game's at low quality, see render/GrimFog). */
export const VIEWER_FOG = 0.035;
