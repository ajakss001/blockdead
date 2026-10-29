import type { ItemId, ItemStack } from '../data/items';
import type { ContainerRef } from './Containers';
import type { Appearance } from '../player/appearance';
import type { InventoryData } from './Inventory';
import type { IPlatform } from '../platform/IPlatform';
import type { SurvivalState } from './Survival';

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
  character?: { appearance: Partial<Appearance>; classId: string };
  /** In-game minutes since the first midnight (older saves: none → start of the night). */
  clock?: number;
  /** Touched containers only; untouched ones are re-rolled from the seed. */
  containers: [number, [ItemId, number, number?, number?][]][];
  /** The survivor died: the next start is a new character (the world, twins and bodies stay). */
  dead?: boolean;
  /** Dead survivors walking, and the bodies of those killed again (their things inside). */
  twins?: TwinRecord[];
  bodies?: ContainerRef[];
  /** In-game minute this survivor started (for "survived …"). */
  bornAt?: number;
}

/** A dead survivor as a zombie: where, the colors of their clothes and skin, everything they had. */
export interface TwinRecord {
  id: number;
  x: number;
  y: number;
  z: number;
  colors: [number, number, number];
  items: ItemStack[];
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
