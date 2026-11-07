import type { CostumeId } from '../characters/assets';
import type { MapSave } from './MapMemory';
import type { Placed } from './Base';
import type { ItemId, ItemStack } from '../data/items';
import type { ModelKind } from '../zombies/stats';
import type { ContainerRef } from './Containers';
import type { Appearance } from '../player/appearance';
import type { InventoryData } from './Inventory';
import type { IPlatform } from '../platform/IPlatform';
import type { SurvivalState } from './Survival';
import type { MetaData, SkillXp } from './Skills';

const VERSION = 1;

export interface SaveV1 {
  v: 1;
  seed: number;
  /** Unix ms of the save. */
  t: number;
  player: { x: number; y?: number; z: number; yaw: number; battery: number };
  stats: SurvivalState;
  inventory: InventoryData;
  /** Looks and class (older saves: none → default survivor, no editor). */
  character?: { appearance: Partial<Appearance>; classId: string; traits?: string[] };
  /** In-game minutes since the first midnight (older saves: none → start of the night). */
  clock?: number;
  /** Touched containers only; untouched ones are re-rolled from the seed. */
  containers: [number, [ItemId, number, number?, number?][]][];
  /** Weapons lying about that the player picked up (weapons/GroundWeapons keys). */
  ground?: number[];
  /** The survivor died: the next start is a new character (the world, twins and bodies stay). */
  dead?: boolean;
  /** Dead survivors walking, and the bodies of those killed again (their things inside). */
  twins?: TwinRecord[];
  bodies?: ContainerRef[];
  /** In-game minute this survivor started (for "survived …"). */
  bornAt?: number;
  /** Boards the player nailed across doors: hinge key, count, side. */
  /** Locked doors opened (hinge keys). */
  unlocked?: string[];
  /** Labs whose generator the player started (block "i,j"). */
  powered?: string[];
  boards?: [string, number, number][];
  /** This survivor's experience per skill and their kills. */
  skills?: SkillXp;
  kills?: number;
  /** What outlives the survivors of this world: the legacy of skills, deaths, the longest life, kills. */
  meta?: MetaData;
  /** What the survivor has seen of the map, and their marks. */
  map?: MapSave;
  /** What the survivors built (the base stays when one dies). */
  base?: Placed[];
}

/** A dead survivor as a zombie: where, the colors of their clothes and skin, everything they had. */
export interface TwinRecord {
  id: number;
  x: number;
  y: number;
  z: number;
  colors: [number, number, number];
  items: ItemStack[];
  /** The model they get up as (by their clothes); old saves: from the class worn then, else a courier. */
  kind?: ModelKind;
  /** The costume they wore (men; null: everyday clothes; old saves: by kind). */
  costume?: CostumeId | null;
}

/**
 * Progress through the platform (localStorage now, Yandex/VK cloud in stage 6). The world itself is
 * never stored — it regenerates from the seed; only the player and touched containers are.
 */
export class SaveGame {
  constructor(
    private readonly platform: IPlatform,
    readonly seed: number,
  ) {}

  async load(): Promise<SaveV1 | null> {
    if (new URLSearchParams(location.search).has('fresh')) return null;
    try {
      const data = (await this.platform.load()) as Partial<SaveV1> | null;
      if (!data || data.v !== VERSION || data.seed !== this.seed || !data.player) return null;
      return data as SaveV1;
    } catch {
      return null;
    }
  }

  async save(data: Omit<SaveV1, 'v' | 'seed' | 't'>): Promise<void> {
    try {
      await this.platform.save({ v: VERSION, seed: this.seed, t: Date.now(), ...data });
    } catch (e) {
      console.warn('[save] failed', e);
    }
  }
}
