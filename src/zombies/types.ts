import type { BodyId } from '../characters/assets';
import { type ModelKind, MODEL_KINDS, ZOMBIE_STATS } from './stats';

/**
 * The zombie kinds on the character models: a woman's kinds on the female body, the rest on the male one,
 * scaled to the kind's height; the clothes take the kind's colours (top, bottom: through grim in the
 * shader's tint); the game numbers from the kind's factors on the worker (walk 0.5, run 1.1 m/s, 100 HP).
 */
export interface ZombieType {
  id: ModelKind;
  name: string;
  body: BodyId;
  /** The model scaled to the kind's height. */
  scale: number;
  /** Clothes: top, bottom (sRGB). */
  tint: number;
  tint2: number;
  walk: number;
  run: number;
  animSpeed: number;
  hp: number;
}

const NAMES: Record<ModelKind, string> = {
  worker: 'Однорукий рабочий',
  medic: 'Медик',
  soldier: 'Военный',
  police: 'Полицейский',
  firefighter: 'Пожарный',
  office: 'Офисный работник',
  grandma: 'Бабушка',
  jogger: 'Бегун',
  chef: 'Повар',
  courier: 'Курьер',
  builder: 'Строитель',
  tourist: 'Турист',
  survivorM: 'Выживший',
  survivorF: 'Выжившая',
};

const BODY_HEIGHT: Record<'male' | 'female', number> = { male: 1.8, female: 1.7 };

export const ZOMBIE_TYPES = Object.fromEntries(
  MODEL_KINDS.map((id) => {
    const s = ZOMBIE_STATS[id];
    const body = s.female ? 'female' : 'male';
    const t: ZombieType = {
      id,
      name: NAMES[id],
      body,
      scale: s.height / BODY_HEIGHT[body],
      tint: s.colors[1],
      tint2: s.colors[2],
      walk: 0.5 * s.speed,
      run: 1.1 * s.speed,
      animSpeed: 0.85 * Math.sqrt(s.speed),
      hp: Math.round(100 * s.hp),
    };
    return [id, t];
  }),
) as Record<ModelKind, ZombieType>;
