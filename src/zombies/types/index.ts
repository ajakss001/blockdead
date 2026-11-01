import type { ZombieType } from '../buildZombie';
import { WORKER } from './worker';

/** Every procedural zombie type by id (the viewer lists them; the game draws the near ones with them). */
export const ZOMBIE_TYPES: Record<string, ZombieType> = {
  [WORKER.id]: WORKER,
};

export { WORKER };
