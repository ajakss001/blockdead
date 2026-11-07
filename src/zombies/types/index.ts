import type { ZombieType } from '../buildZombie';
import { WORKER } from './worker';
import { MEDIC } from './medic';
import { SOLDIER } from './soldier';
import { POLICE } from './police';
import { FIREFIGHTER } from './firefighter';
import { OFFICE } from './office';
import { GRANDMA } from './grandma';
import { JOGGER } from './jogger';
import { CHEF } from './chef';
import { COURIER } from './courier';
import { BUILDER } from './builder';
import { TOURIST } from './tourist';
import { SURVIVOR_F, SURVIVOR_M } from './survivor';

/** Every procedural zombie type by id (the viewer lists them; the game draws the near ones with them). */
export const ZOMBIE_TYPES: Record<string, ZombieType> = {
  [WORKER.id]: WORKER,
  [MEDIC.id]: MEDIC,
  [SOLDIER.id]: SOLDIER,
  [POLICE.id]: POLICE,
  [FIREFIGHTER.id]: FIREFIGHTER,
  [OFFICE.id]: OFFICE,
  [GRANDMA.id]: GRANDMA,
  [JOGGER.id]: JOGGER,
  [CHEF.id]: CHEF,
  [COURIER.id]: COURIER,
  [BUILDER.id]: BUILDER,
  [TOURIST.id]: TOURIST,
  [SURVIVOR_M.id]: SURVIVOR_M,
  [SURVIVOR_F.id]: SURVIVOR_F,
};

export { WORKER, MEDIC, SOLDIER, POLICE, FIREFIGHTER, OFFICE, GRANDMA, JOGGER, CHEF, COURIER, BUILDER, TOURIST, SURVIVOR_M, SURVIVOR_F };
