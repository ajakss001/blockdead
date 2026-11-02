/** Hand-held things that are not weapons: the flashlight (model in items/flashlight, light in player/Player). */

const DEG = Math.PI / 180;

export const FLASHLIGHT = {
  /** Butt to lens, m. */
  length: 0.3,
  /** The grip point (model origin) from the butt along the body, m: where the left fist holds it. */
  grip: 0.1,
  light: {
    color: 0xffe2a8,
    /** Candela (physical lights, decay 2). */
    intensity: 60,
    angle: 25 * DEG,
    penumbra: 0.5,
    distance: 18,
    decay: 2,
    /** Low battery: the colour it fades towards (dimmer and yellower). */
    weakColor: 0xffb455,
  },
  battery: {
    /** A full charge lasts this many seconds of light; it drains only while on. */
    life: 300,
    /** Below this the light dims and yellows. */
    dim: 0.3,
    /** Below this it flickers and drops out for 0.1–0.5 s. */
    flicker: 0.15,
    /** What a pack of batteries brings back (data/items `batteries.battery`). */
    refill: 1,
  },
  /** The lens glow when on (emissive). */
  glow: 0xffe2a8,
  colors: {
    body: 0x3a3c3e,
    alu: 0x8c9196,
    tape: 0x2b2c2e,
    button: 0x1e1f1d,
    strap: 0x4a463c,
    lens: 0xc8c6b8,
    reflector: 0xb9bcbc,
  },
} as const;
