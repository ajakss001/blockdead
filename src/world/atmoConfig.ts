/**
 * How often the world's small events happen — all in one place. They are rare and random on purpose: a
 * crow every few minutes is unsettling, one every ten seconds is wallpaper. Times in real seconds as
 * [min, max] ranges, distances in metres, chances 0..1.
 */
export const ATMO = {
  street: {
    /** A perch (a house ridge, a lamp arm) has crows on it with this chance; empty again after a flush for … */
    crowPerch: 0.3,
    crowRespawn: [150, 300],
    /** They take off when you come this close (crouching: the second number). */
    crowFlush: [9, 5],
    /** …and the racket draws zombies within this radius. */
    crowNoise: 24,
    /** An idle crow caws now and then. */
    crowCaw: [10, 30],
    /** A car alarm: how long it wails, how far zombies hear it (every few seconds while it does). */
    alarmTime: [14, 24],
    alarmNoise: 38,
    alarmNoiseEvery: 3,
    /** Running into a car at this speed (m/s) or more sets its alarm off, with this chance. */
    alarmBump: 2.6,
    alarmBumpChance: 0.6,
    /** A rat running along a wall in town. */
    rats: [35, 90],
    /** A shopping cart the wind pushes about (one at a time, in town). */
    cart: [60, 150],
    /** In a gust: loose sheet metal rattling, a sign creaking on its bracket. */
    rattle: [12, 30],
    /** Far away: a dog barking, a siren, a shot or two. */
    dog: [70, 170],
    siren: [160, 380],
    shot: [140, 420],
  },
  night: {
    /** Crickets from dusk to dawn (hours). */
    crickets: [20.5, 5],
    /** Birds at dawn (hours), a phrase every … s. */
    birds: [5, 8.5],
    birdEvery: [2, 7],
    /** Moths round a lit lamp and round the flashlight's beam at night. */
    moths: 5,
    /** Dust in the flashlight beam indoors, specks a second. */
    motes: 10,
    /** Breath shows below this felt temperature, °C, one out-breath every … s (half that sprinting). */
    breathBelow: 6,
    breathEvery: 3.4,
    /** Fog: its reach at night and in the rain (share of the preset's), how slowly it thickens / clears, s. */
    fogNight: 0.62,
    fogRain: 0.78,
    fogLag: 90,
  },
  weather: {
    /** Every minute the sky may turn: chance of rain starting (not within `rainGap` s of the last). */
    rainChance: 0.07,
    rainGap: 360,
    rainTime: [180, 420],
    /** A share of the rains are storms: lightning every … s. */
    storm: 0.35,
    lightning: [10, 35],
    /** Rain drowns the player's footsteps for zombies by this share. */
    rainMasks: 0.45,
  },
} as const;

/** A random value in a [min, max] range. */
export function between(r: readonly [number, number]): number {
  return r[0] + Math.random() * (r[1] - r[0]);
}
