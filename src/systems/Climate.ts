/**
 * Time of day and air temperature; the scene lights the world from the same clock (day / night).
 */

/** Daytime 06:00–20:00 passes in 20 real minutes, the night 20:00–06:00 in 30. */
const DAY_RATE = (14 * 60) / (20 * 60);
const NIGHT_RATE = (10 * 60) / (30 * 60);
/** A new survivor starts at 07:00, the day ahead. */
export const START_MINUTE = 7 * 60;

/** Outdoor air, °C: coldest just before dawn, warmest mid-afternoon (late autumn, frost at night). */
const AIR = { min: -1, max: 10, coldestHour: 5 } as const;
/** Walls and a roof: wind and night chill stay outside. */
const INDOOR_BONUS = 10;
/** Moving keeps you warm, °C of felt temperature. */
const ACTIVITY = { walk: 1.5, sprint: 4 } as const;

export class Clock {
  /** Minutes since midnight of day 0. */
  minutes = START_MINUTE;

  update(dt: number): void {
    this.minutes += dt * (this.isNight ? NIGHT_RATE : DAY_RATE);
  }

  /** 0..24 */
  get hour(): number {
    return (this.minutes / 60) % 24;
  }

  get isNight(): boolean {
    const h = this.hour;
    return h >= 20 || h < 6;
  }

  /** 0 at night … 1 by day, dawn 05:00–07:00, dusk 19:00–21:00. */
  get daylight(): number {
    const h = this.hour;
    const s = (t: number) => t * t * (3 - 2 * t);
    if (h < 5 || h >= 21) return 0;
    if (h < 7) return s((h - 5) / 2);
    if (h < 19) return 1;
    return s(1 - (h - 19) / 2);
  }

  get label(): string {
    const m = Math.floor(this.minutes) % (24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }
}

/** Outdoor air temperature at an hour, °C (cosine between the coldest hour and 12 h later). */
export function outdoorAir(hour: number): number {
  const phase = ((hour - AIR.coldestHour) / 24) * Math.PI * 2;
  return AIR.min + (AIR.max - AIR.min) * (0.5 - 0.5 * Math.cos(phase));
}

export function airTemperature(hour: number, indoors: boolean): number {
  return outdoorAir(hour) + (indoors ? INDOOR_BONUS : 0);
}

/** What the body feels: air + clothing insulation + movement. */
export function feltTemperature(air: number, clothingWarmth: number, speed: number, sprinting: boolean): number {
  const activity = sprinting ? ACTIVITY.sprint : speed > 0.2 ? ACTIVITY.walk : 0;
  return air + clothingWarmth + activity;
}

/**
 * Roofed footprints (houses, shops, high-rises) per chunk, from the generator:
 * packed [minX, minZ, maxX, maxZ, roofY] — standing on the roof itself is outdoors.
 */
export const SHELTER_STRIDE = 5;

export class Shelters {
  private readonly byChunk = new Map<number, Float32Array>();

  add(key: number, packed: Float32Array): void {
    if (packed.length > 0) this.byChunk.set(key, packed);
  }

  remove(key: number): void {
    this.byChunk.delete(key);
  }

  covers(x: number, z: number, y: number): boolean {
    for (const a of this.byChunk.values()) {
      for (let i = 0; i + SHELTER_STRIDE - 1 < a.length; i += SHELTER_STRIDE) {
        if (x >= a[i] && z >= a[i + 1] && x <= a[i + 2] && z <= a[i + 3] && y < a[i + 4] - 0.5) return true;
      }
    }
    return false;
  }
}
