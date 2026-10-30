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
  /** A tree: grass round its foot, leaves under it (w crown radius, h height). */
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
} as const;

/**
 * A stable 0..1 from a position. The atmosphere's spots use it instead of the generators' random streams,
 * so adding them does not reshuffle the rest of the world (loot ids, doors, saves stay the same).
 */
export function spotHash(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
