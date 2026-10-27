import type { ItemDef } from '../data/items';
import { clamp } from '../core/math';
import type { Hud, MoodleLevel } from '../ui/Hud';

/**
 * Pacing, per real second. A session of 10–15 minutes should make you hungry and thirsty once:
 * "Голод ▪" after ~6 min, "Жажда ▪" after ~4 min, starving / dehydrated after ~25 / ~15 min.
 */
const RATE = {
  hunger: 0.04 / 60,
  thirst: 0.06 / 60,
  fatigueWalk: 0.012 / 60,
  fatigueSprint: 0.15 / 60,
  restRecovery: 0.04 / 60,
  starvation: 0.12 / 60,
  bleeding: 0.25 / 60,
  regen: 0.03 / 60,
  painFade: 0.05 / 60,
};

const level = (v: number): MoodleLevel => (v >= 0.75 ? 3 : v >= 0.5 ? 2 : v >= 0.25 ? 1 : 0);

export interface SurvivalState {
  hunger: number;
  thirst: number;
  fatigue: number;
  health: number;
  pain: number;
  bleeding: boolean;
}

/** Hunger, thirst, fatigue, health, pain, bleeding — all 0..1 (health 1 = full). */
export class Survival implements SurvivalState {
  hunger = 0.12;
  thirst = 0.1;
  fatigue = 0;
  health = 1;
  pain = 0;
  bleeding = false;

  update(dt: number, speed: number, sprinting: boolean): void {
    this.hunger = clamp(this.hunger + RATE.hunger * dt, 0, 1);
    this.thirst = clamp(this.thirst + RATE.thirst * dt * (sprinting ? 1.8 : 1), 0, 1);
    const tiring = sprinting ? RATE.fatigueSprint : speed > 0.2 ? RATE.fatigueWalk : -RATE.restRecovery;
    this.fatigue = clamp(this.fatigue + tiring * dt, 0, 1);
    this.pain = clamp(this.pain - RATE.painFade * dt, 0, 1);

    let dh = 0;
    if (this.hunger > 0.85) dh -= RATE.starvation;
    if (this.thirst > 0.85) dh -= RATE.starvation * 1.5;
    if (this.bleeding) dh -= RATE.bleeding;
    if (dh === 0 && this.hunger < 0.5 && this.thirst < 0.5) dh = RATE.regen;
    this.health = clamp(this.health + dh * dt, 0, 1);
  }

  /** Too tired to run; fatigue also slows the sprint before that. */
  get canSprint(): boolean {
    return this.fatigue < 0.75;
  }

  get sprintFactor(): number {
    return this.fatigue < 0.5 ? 1 : 0.8;
  }

  /** Apply an item's effects. Returns a short result line for the HUD. */
  consume(def: ItemDef): string {
    if (def.hunger) this.hunger = clamp(this.hunger + def.hunger, 0, 1);
    if (def.thirst) this.thirst = clamp(this.thirst + def.thirst, 0, 1);
    if (def.fatigue) this.fatigue = clamp(this.fatigue + def.fatigue, 0, 1);
    if (def.health) this.health = clamp(this.health + def.health, 0, 1);
    if (def.pain) this.pain = clamp(this.pain + def.pain, 0, 1);
    if (def.stopsBleeding) {
      const was = this.bleeding;
      this.bleeding = false;
      return was ? 'Кровотечение остановлено' : 'Перевязано';
    }
    return def.name;
  }

  pushMoodles(hud: Hud): void {
    hud.setMoodle('hunger', level(this.hunger));
    hud.setMoodle('thirst', level(this.thirst));
    hud.setMoodle('tired', level(this.fatigue));
    hud.setMoodle('bleeding', this.bleeding ? 2 : 0);
    hud.setMoodle('pain', level(Math.max(this.pain, 1 - this.health)));
  }

  serialize(): SurvivalState {
    const { hunger, thirst, fatigue, health, pain, bleeding } = this;
    return { hunger, thirst, fatigue, health, pain, bleeding };
  }

  restore(s: Partial<SurvivalState>): void {
    Object.assign(this, s);
  }
}
