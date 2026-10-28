import type { ItemDef } from '../data/items';
import { clamp } from '../core/math';
import { type Hud, severityOf } from '../ui/Hud';

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
  wound: 0.25 / 60,
  regen: 0.03 / 60,
  painFade: 0.05 / 60,
  /** Health lost per second while hypothermic (body < COLD.hypothermia): ~16 min from full. */
  freezing: 0.06 / 60,
};

/**
 * Body temperature, °C. Below the comfort line of felt temperature the body cools in proportion
 * to the deficit; above it, it warms back to normal. Hoodie + jeans at night outside: chilly in
 * ~5 min, cold in ~14; in a T-shirt: 2 and 5.5 min. Under a roof you warm back up.
 */
export const COLD = {
  normal: 36.6,
  comfort: 20,
  /** °C per second per °C of deficit. */
  coolRate: 0.0006,
  warmRate: 0.02,
  chilly: 36.0,
  cold: 35.0,
  hypothermia: 34.0,
  floor: 33.0,
  /** Fatigue builds this much faster when cold. */
  fatigueFactor: 1.6,
} as const;

/** Anxiety per second: darkness after the battery died, darkness by choice, calming down with light. */
const DREAD = {
  deadBatteryJump: 0.3,
  deadBattery: 0.06,
  lightsOff: 0.006,
  calming: 0.02,
} as const;

/** What the world does to the body this step (computed by the scene). */
export interface Exposure {
  /** Felt temperature, °C (air + clothing + movement). */
  felt: number;
  /** No light of your own where it is dark (night, or inside a building). */
  dark: boolean;
  /** The flashlight has no charge left (darkness not by choice). */
  batteryDead: boolean;
}


export interface SurvivalState {
  hunger: number;
  thirst: number;
  fatigue: number;
  health: number;
  pain: number;
  /** An open wound drains health until it is dressed. */
  wounded: boolean;
  /** Body temperature, °C. */
  bodyTemp: number;
  /** 0..1 */
  anxiety: number;
}

/** Hunger, thirst, fatigue, health, pain, wound — all 0..1 (health 1 = full). */
export class Survival implements SurvivalState {
  hunger = 0.12;
  thirst = 0.1;
  fatigue = 0;
  health = 1;
  pain = 0;
  wounded = false;
  bodyTemp: number = COLD.normal;
  anxiety = 0;
  private wasBatteryDead = false;

  update(dt: number, speed: number, sprinting: boolean, env: Exposure): void {
    this.updateBodyTemp(dt, env.felt);
    this.updateAnxiety(dt, env);
    this.hunger = clamp(this.hunger + RATE.hunger * dt, 0, 1);
    this.thirst = clamp(this.thirst + RATE.thirst * dt * (sprinting ? 1.8 : 1), 0, 1);
    let tiring = sprinting ? RATE.fatigueSprint : speed > 0.2 ? RATE.fatigueWalk : -RATE.restRecovery;
    // Shivering wears you out: more tiring, slower rest.
    if (this.bodyTemp < COLD.cold) tiring = tiring > 0 ? tiring * COLD.fatigueFactor : tiring / COLD.fatigueFactor;
    this.fatigue = clamp(this.fatigue + tiring * dt, 0, 1);
    this.pain = clamp(this.pain - RATE.painFade * dt, 0, 1);

    let dh = 0;
    if (this.hunger > 0.85) dh -= RATE.starvation;
    if (this.thirst > 0.85) dh -= RATE.starvation * 1.5;
    if (this.wounded) dh -= RATE.wound;
    if (this.bodyTemp < COLD.hypothermia) dh -= RATE.freezing;
    if (dh === 0 && this.hunger < 0.5 && this.thirst < 0.5) dh = RATE.regen;
    this.health = clamp(this.health + dh * dt, 0, 1);
  }

  private updateBodyTemp(dt: number, felt: number): void {
    const deficit = COLD.comfort - felt;
    if (deficit > 0) this.bodyTemp -= deficit * COLD.coolRate * dt;
    else this.bodyTemp += Math.min(COLD.warmRate * dt, COLD.normal - this.bodyTemp);
    this.bodyTemp = clamp(this.bodyTemp, COLD.floor, COLD.normal);
  }

  /** Darkness without a working flashlight frightens; the moment it dies, sharply. */
  private updateAnxiety(dt: number, env: Exposure): void {
    let d = -DREAD.calming;
    if (env.dark) d = env.batteryDead ? DREAD.deadBattery : DREAD.lightsOff;
    if (env.batteryDead && !this.wasBatteryDead && env.dark) this.anxiety += DREAD.deadBatteryJump;
    this.wasBatteryDead = env.batteryDead;
    this.anxiety = clamp(this.anxiety + d * dt, 0, 1);
  }

  /** 0 = hypothermic, 1 = normal: how much warmth is left, for the HUD. */
  get warmthLeft(): number {
    return clamp((this.bodyTemp - COLD.hypothermia) / (COLD.normal - COLD.hypothermia), 0, 1);
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
    if (def.dressesWound) {
      const was = this.wounded;
      this.wounded = false;
      return was ? 'Рана перевязана' : 'Перевязано';
    }
    return def.name;
  }

  /** HUD indicators, all as "how much is left". */
  pushStats(hud: Hud, battery: number): void {
    const meter = (id: 'health' | 'hunger' | 'thirst' | 'energy' | 'battery', left: number) => hud.setStat(id, left, severityOf(left));
    meter('health', this.health);
    meter('hunger', 1 - this.hunger);
    meter('thirst', 1 - this.thirst);
    meter('energy', 1 - this.fatigue);
    meter('battery', battery);
    const t = this.bodyTemp;
    hud.setStat('warmth', this.warmthLeft, t < COLD.hypothermia ? 3 : t < COLD.cold ? 2 : t < COLD.chilly ? 1 : 0, 'cold');
    const a = this.anxiety;
    hud.setStat('calm', 1 - a, a > 0.85 ? 3 : a > 0.6 ? 2 : a > 0.3 ? 1 : 0);
    hud.setWound(this.wounded);
  }

  serialize(): SurvivalState {
    const { hunger, thirst, fatigue, health, pain, wounded, bodyTemp, anxiety } = this;
    return { hunger, thirst, fatigue, health, pain, wounded, bodyTemp, anxiety };
  }

  restore(s: Partial<SurvivalState> & { bleeding?: boolean }): void {
    const { bleeding, ...rest } = s;
    // Older saves have no bodyTemp / anxiety: the defaults stay.
    Object.assign(this, rest);
    // Saves before 3.6 called the wound "bleeding".
    if (bleeding !== undefined && s.wounded === undefined) this.wounded = bleeding;
  }
}
