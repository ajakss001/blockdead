/**
 * World-life spot kinds (Builder.life → WorldLife, Atmosphere): the generators (worker) and the scene share
 * them. Layout of a spot: kind, x, y, z, normal x, normal z, w, h, seed, tag.
 */
export const LIFE = {
  window: 0,
  lamp: 1,
  curtain: 2,
  radio: 3,
  shards: 4,
  room: 5,
  /** A tree (see TREE): grass round its foot, leaves under it (w crown radius, h scale, tag species). */
  tree: 6,
  /** Ivy / moss on a wall or a fence: bottom middle on the surface, normal out (w, h its size). */
  ivy: 7,
  /** An abandoned car: weeds round the wheels (normal = heading). */
  car: 8,
  /** A leak in the ceiling: y the ceiling, h the drop down to the floor. */
  drip: 9,
  /** A TV left on (static, the flicker on the walls): the screen's middle, normal out. */
  tv: 10,
  /** A phone that sometimes rings in an empty flat. */
  phone: 11,
  /** A fridge humming (only where the power is still on). */
  fridge: 12,
  /** A dripping kitchen tap. */
  tap: 13,
  /** Flies buzzing over the trash or something rotting. */
  flies: 14,
  /** Where crows may sit: a line (a ridge, a lamp arm) through x, y, z along (nx, nz), w long. */
  perch: 15,
  /** A fire: a burning car or a barrel (w = flame size). */
  fire: 16,
  /** A broken fire hydrant spouting water (y = its top). */
  hydrant: 17,
  /** A bush: w its scale, h 0 round / 1 low and spreading; normal = its turn. */
  bush: 18,
  /** A 3 m stretch of hedge along (nx, nz): w its length scale, h its height scale. */
  hedge: 19,
  // POI scenarios (what happened here): see world/gen/poiScenes.
  /** Something burnt out, still smouldering: thin smoke, no flame. */
  smoke: 20,
  /** A warning light: w its size, h its mode (5 blinking, 6 turning), tag its colour (0 red, 1 amber). */
  beacon: 21,
  /** A siren wailing (loud: zombies come). */
  siren: 22,
  /** A loudspeaker repeating the evacuation message through the static (loud). */
  speaker: 23,
  /** An alarm bell ringing (loud). */
  bell: 24,
  /** Music stuck on a loop from the speakers (a mall). */
  music: 25,
  /** A torn cable sparking: it burns if you touch it. */
  sparks: 26,
  /** Steam hissing out of a pipe. */
  steam: 27,
  /** Water jetting from a burst pipe along (nx, nz). */
  jet: 28,
  /** Something still turning: tag 0 a radar dish, 1 a searchlight beam; w its size. */
  spin: 29,
} as const;

/**
 * Tree species in a tree spot's tag (its normal is the turn, w the crown radius, h the scale, seed the variant).
 * Broad-leaved first: tag ≤ LEAFY drops leaves.
 */
export const TREE = { maple: 0, oak: 1, elm: 2, spruce: 3, pine: 4, dead: 5 } as const;
export const LEAFY = 2;

/**
 * A stable 0..1 from a position. The atmosphere's spots use it instead of the generators' random streams,
 * so adding them does not reshuffle the rest of the world (loot ids, doors, saves stay the same).
 */
export function spotHash(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
