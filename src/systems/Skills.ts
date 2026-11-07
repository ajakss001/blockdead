import type { ClassId, ClassMods } from '../data/classes';

/*
 * Skills grow by doing (Zomboid): every blow, sprint, search, dressing, plank gives experience to its skill;
 * levels 0–10 make the survivor a little better at it. They sit on top of the class: the class sets where a
 * survivor starts and the multipliers it had, a skill multiplies further.
 *
 * Legacy (the meta): when a survivor dies, a share of each skill's experience stays with the world, and the
 * next survivor starts with it — the character and the bag are lost, what was learnt partly is not.
 */

export type SkillId = 'axe' | 'blunt' | 'blade' | 'fitness' | 'sneak' | 'search' | 'firstAid' | 'carpentry';

export interface SkillDef {
  id: SkillId;
  name: string;
  /** What a level gives, for the panel. */
  per: string;
}

export const SKILLS: readonly SkillDef[] = [
  { id: 'axe', name: 'Топоры', per: 'урон +5%, износ −5%' },
  { id: 'blunt', name: 'Дробящее', per: 'урон +5%, износ −5%' },
  { id: 'blade', name: 'Клинки', per: 'урон +5%, износ −5%' },
  { id: 'fitness', name: 'Выносливость', per: 'усталость −4%' },
  { id: 'sneak', name: 'Скрытность', per: 'шум −5%' },
  { id: 'search', name: 'Обыск', per: 'обыск −5% времени' },
  { id: 'firstAid', name: 'Первая помощь', per: 'лечение +6%' },
  { id: 'carpentry', name: 'Плотницкое', per: 'доски −6% времени' },
];

export const MAX_LEVEL = 10;
/** Share of a dead survivor's experience the next one inherits. */
export const LEGACY_SHARE = 0.5;

/** Experience for one act. */
export const XP = {
  hit: 6,
  kill: 14,
  /** Per second of sprinting. */
  sprint: 1,
  /** Per second of moving crouched with zombies near. */
  sneak: 1.5,
  search: 8,
  trunk: 10,
  heal: 12,
  nail: 15,
  pry: 6,
} as const;

/** Experience to reach a level: 60, 180, 360 … 3300 at 10. */
export function xpFor(level: number): number {
  return (60 * level * (level + 1)) / 2;
}

export function levelOf(xp: number): number {
  let l = 0;
  while (l < MAX_LEVEL && xp >= xpFor(l + 1)) l++;
  return l;
}

/** Which skill a weapon trains (fists and everything blunt: blunt). */
export function weaponSkill(item: string): SkillId {
  if (item === 'axe') return 'axe';
  if (item === 'knife') return 'blade';
  return 'blunt';
}

/** Where a class starts (levels), and how fast it learns. */
const CLASS_SKILLS: Partial<Record<ClassId, Partial<Record<SkillId, number>>>> = {
  military: { fitness: 2, blade: 1, blunt: 1 },
  swat: { blunt: 2, fitness: 1 },
  police: { blunt: 2, search: 1 },
  firefighter: { axe: 2, fitness: 1 },
  medic: { firstAid: 3 },
  mechanic: { blunt: 1, search: 2 },
  builder: { carpentry: 3, blunt: 1 },
  office: { search: 1, sneak: 1 },
};
/** The unemployed have nothing to start with but learn faster. */
const CLASS_LEARN: Partial<Record<ClassId, number>> = { unemployed: 1.25 };

export type SkillXp = Partial<Record<SkillId, number>>;

export interface MetaData {
  /** Experience the next survivor inherits. */
  legacy: SkillXp;
  deaths: number;
  /** Longest life, in-game minutes. */
  bestLife: number;
  /** Zombies killed by every survivor of this world. */
  kills: number;
}

export function emptyMeta(): MetaData {
  return { legacy: {}, deaths: 0, bestLife: 0, kills: 0 };
}

export class Skills {
  private xp: SkillXp = {};
  private learn = 1;
  /** Zombies this survivor killed. */
  kills = 0;
  /** Level reached (for the toast). */
  onLevel: ((s: SkillDef, level: number) => void) | null = null;
  /** Bumped on every change (the panel redraws). */
  version = 0;

  /** A new survivor: the class's start plus the legacy of the dead. */
  start(classId: ClassId, legacy: SkillXp): void {
    this.xp = {};
    this.kills = 0;
    const cls = CLASS_SKILLS[classId] ?? {};
    for (const s of SKILLS) {
      const v = xpFor(cls[s.id] ?? 0) + (legacy[s.id] ?? 0);
      if (v > 0) this.xp[s.id] = v;
    }
    this.setClass(classId);
    this.version++;
  }

  setClass(classId: ClassId): void {
    this.learn = CLASS_LEARN[classId] ?? 1;
  }

  add(id: SkillId, amount: number): void {
    const before = this.xp[id] ?? 0;
    const after = Math.min(xpFor(MAX_LEVEL), before + amount * this.learn);
    if (after === before) return;
    this.xp[id] = after;
    const l = levelOf(after);
    if (l > levelOf(before)) {
      this.version++;
      this.onLevel?.(SKILLS.find((s) => s.id === id)!, l);
    }
  }

  level(id: SkillId): number {
    return levelOf(this.xp[id] ?? 0);
  }

  /** 0..1 to the next level. */
  progress(id: SkillId): number {
    const x = this.xp[id] ?? 0;
    const l = levelOf(x);
    if (l >= MAX_LEVEL) return 1;
    return (x - xpFor(l)) / (xpFor(l + 1) - xpFor(l));
  }

  /** Melee damage multiplier for the weapon in hand. */
  damage(item: string): number {
    return 1 + 0.05 * this.level(weaponSkill(item));
  }

  /** Weapon wear multiplier per blow. */
  wear(item: string): number {
    return 1 - 0.05 * this.level(weaponSkill(item));
  }

  /** The class's multipliers with the skills on top. */
  apply(m: ClassMods): ClassMods {
    return {
      ...m,
      stamina: m.stamina * (1 - 0.04 * this.level('fitness')),
      stealth: m.stealth * (1 - 0.05 * this.level('sneak')),
      searchSpeed: m.searchSpeed * (1 - 0.05 * this.level('search')),
      healing: m.healing * (1 + 0.06 * this.level('firstAid')),
      medicine: m.medicine * (1 + 0.04 * this.level('firstAid')),
      // Speed: −6% of the time a level.
      barricade: m.barricade / (1 - 0.06 * this.level('carpentry')),
    };
  }

  /** What the dead leave to the next survivor: the better of the old legacy and a share of this life's. */
  bequeath(legacy: SkillXp): SkillXp {
    const out: SkillXp = { ...legacy };
    for (const s of SKILLS) {
      const v = Math.floor((this.xp[s.id] ?? 0) * LEGACY_SHARE);
      if (v > (out[s.id] ?? 0)) out[s.id] = v;
    }
    return out;
  }

  serialize(): SkillXp {
    const out: SkillXp = {};
    for (const s of SKILLS) if (this.xp[s.id]) out[s.id] = Math.round(this.xp[s.id]! * 10) / 10;
    return out;
  }

  restore(xp: SkillXp | undefined, classId: ClassId, kills = 0): void {
    this.xp = { ...(xp ?? {}) };
    this.kills = kills;
    this.setClass(classId);
    this.version++;
  }
}

/** "Топоры 2 · Обыск 1" for a set of experience (levels ≥ 1 only). */
export function describeXp(xp: SkillXp): string {
  return SKILLS.filter((s) => levelOf(xp[s.id] ?? 0) > 0)
    .map((s) => `${s.name} ${levelOf(xp[s.id]!)}`)
    .join(' · ');
}

/** A class's starting skills, "Дробящее 2 · Обыск 1" (empty: none). */
export function classSkillText(classId: ClassId): string {
  const cls = CLASS_SKILLS[classId] ?? {};
  const text = SKILLS.filter((s) => cls[s.id]).map((s) => `${s.name} ${cls[s.id]}`).join(' · ');
  return CLASS_LEARN[classId] ? (text ? `${text} · ` : '') + 'учится быстрее' : text;
}
