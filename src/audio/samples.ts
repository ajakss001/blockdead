/**
 * Recorded sounds (public/sounds + public/audio/manifest.json), loaded lazily after the first gesture:
 * zero blocking at boot; both legacy zombie/melee clips and the Escape-from-Tarkov-style WAV packs
 * decode in the background. While a group is still decoding — or if offline — `pick`/`get` return null
 * and callers fall back to synthesis.
 */

export type SampleGroup =
  // Legacy recorded pack (public/sounds — only clips not superseded by WAV pack)
  | 'swing'
  | 'hitMetal'
  | 'heavyHit'
  | 'magDrop'
  | 'bulletMetal'
  | 'zAttack'
  | 'zScream'
  | 'zBreath'
  | 'zDeath'
  // Weapons, combat, ADS, armor hit (public/audio/weapons)
  | 'shotAk'
  | 'shotM4'
  | 'shotShotgun'
  | 'shotPistol'
  | 'shotHunting'
  | 'shotRifleSup'
  | 'shotPistolSup'
  | 'shotRpg'
  | 'rpgExplosion'
  | 'gunReloadRifle'
  | 'gunMagOut'
  | 'gunMagIn'
  | 'gunPump'
  | 'gunBolt'
  | 'gunMagCheck'
  | 'gunDry'
  | 'armorHit'
  | 'adsRifle'
  | 'adsPistol'
  // Spent casings (public/audio/casings)
  | 'casingAsphalt'
  | 'casingWood'
  | 'casingDirt'
  | 'casingMetal'
  | 'casingShotgun'
  // Sliced footsteps (public/audio/footsteps)
  | 'stepAsphaltWalk'
  | 'stepAsphaltRun'
  | 'stepDirtWalk'
  | 'stepDirtRun'
  | 'stepWoodWalk'
  | 'stepWoodRun'
  | 'stepConcreteWalk'
  | 'stepConcreteRun'
  | 'stepMetalWalk'
  | 'stepMetalRun'
  | 'stepMuffled'
  | 'stepCrouch'
  | 'stepGlassWalk'
  | 'stepGlassRun'
  | 'stepGlassCrouch'
  // Micro-foley & stamina (public/audio/foley)
  | 'pivotAsphalt'
  | 'pivotAsphaltFast'
  | 'pivotWood'
  | 'pivotConcrete'
  | 'pivotDirt'
  | 'crouchDown'
  | 'standUp'
  | 'jumpPush'
  | 'landHard'
  | 'landMetal'
  | 'breathClear'
  | 'breathMask'
  | 'heartbeat'
  | 'lootSearch'
  // Environment, glass, doors (public/audio/env)
  | 'woodCreak'
  | 'woodCreakSharp'
  | 'buildingCreak'
  | 'glassBreak'
  | 'glassSettle'
  | 'doorWood'
  | 'doorMetal'
  | 'tvStatic'
  // Loot container opening/closing (public/audio/foley)
  | 'lootCrateWood'
  | 'lootDrawer'
  | 'lootBoxCardboard'
  | 'lootBagZip'
  // Inventory & equipment UX (public/audio/ui)
  | 'uiItemMove'
  | 'uiEquipWeapon'
  | 'uiEquipVest'
  | 'uiEquipCloth'
  | 'uiEquipHelmet';

const SOUNDS_BASE = `${import.meta.env.BASE_URL}sounds/`;
const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`;

export class Samples {
  private readonly buffers = new Map<SampleGroup, AudioBuffer[]>();
  private started = false;
  private ready = false;
  private last = new Map<SampleGroup, number>();

  constructor(private readonly ac: BaseAudioContext) {}

  /** True once initial bank decoding has finished. */
  get isLoaded(): boolean {
    return this.ready;
  }

  /** Number of decoded sample groups currently ready in memory. */
  get groupCount(): number {
    return this.buffers.size;
  }

  /** Inject pre-decoded buffers (used by deterministic Node audio tests). */
  seedForTest(group: SampleGroup, list: AudioBuffer[]): void {
    this.buffers.set(group, list);
    this.started = true;
    this.ready = true;
  }

  /** Start background decode (once; call after the AudioContext exists). */
  load(): void {
    if (this.started || typeof fetch === 'undefined') return;
    this.started = true;
    void Promise.all([
      this.loadBank(AUDIO_BASE, 'manifest.json'),
      this.loadBank(SOUNDS_BASE, 'sounds.json'),
    ]).then(() => {
      this.ready = true;
    });
  }

  private async loadBank(baseUrl: string, manifestFile: string): Promise<void> {
    let list: Partial<Record<SampleGroup, string[]>>;
    try {
      const r = await fetch(baseUrl + manifestFile);
      if (!r.ok) return;
      list = (await r.json()) as Partial<Record<SampleGroup, string[]>>;
    } catch {
      return;
    }
    const entries = Object.entries(list) as [SampleGroup, string[]][];
    // Decode in bounded parallel batches so weapons/footsteps become available immediately without flooding.
    const batchSize = 8;
    for (let idx = 0; idx < entries.length; idx += batchSize) {
      await Promise.all(
        entries.slice(idx, idx + batchSize).map(async ([g, files]) => {
          const decoded = await Promise.all(
            files.map(async (f) => {
              try {
                const r = await fetch(baseUrl + f);
                if (!r.ok) return null;
                return await this.ac.decodeAudioData(await r.arrayBuffer());
              } catch {
                return null;
              }
            }),
          );
          const got = decoded.filter((b): b is AudioBuffer => b !== null);
          if (got.length) this.buffers.set(g, got);
        }),
      );
    }
  }

  /** First buffer of the group (for continuous loops like breathing, heartbeat, loot search). */
  get(g: SampleGroup): AudioBuffer | null {
    return this.buffers.get(g)?.[0] ?? null;
  }

  /** A variant of the group, never the one played just before it (null: not loaded). */
  pick(g: SampleGroup): AudioBuffer | null {
    const l = this.buffers.get(g);
    if (!l?.length) return null;
    let i = Math.floor(Math.random() * l.length);
    if (l.length > 1 && i === this.last.get(g)) i = (i + 1) % l.length;
    this.last.set(g, i);
    return l[i];
  }
}
