/**
 * Recorded sounds (public/sounds + public/audio/manifest.json), loaded lazily after the first gesture:
 * zero blocking at boot; both legacy zombie/melee clips and the Escape-from-Tarkov-style WAV packs
 * decode in the background. While a group is still decoding — or if offline — `pick`/`get` return null
 * and callers fall back to synthesis.
 */

export type SampleGroup =
  // Legacy recorded pack (public/sounds)
  | 'explosion'
  | 'swing'
  | 'hitMetal'
  | 'heavyHit'
  | 'dry'
  | 'rattle'
  | 'casing'
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
  | 'doorMetal';

const SOUNDS_BASE = `${import.meta.env.BASE_URL}sounds/`;
const AUDIO_BASE = `${import.meta.env.BASE_URL}audio/`;

export class Samples {
  private readonly buffers = new Map<SampleGroup, AudioBuffer[]>();
  private started = false;
  private last = new Map<SampleGroup, number>();

  constructor(private readonly ac: BaseAudioContext) {}

  /** Start background decode (once; call after the AudioContext exists). */
  load(): void {
    if (this.started || typeof fetch === 'undefined') return;
    this.started = true;
    void this.loadBank(AUDIO_BASE, 'manifest.json');
    void this.loadBank(SOUNDS_BASE, 'sounds.json');
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
    // Decode in small parallel batches so weapons/footsteps become available promptly without flooding.
    const batchSize = 6;
    for (let idx = 0; idx < entries.length; idx += batchSize) {
      await Promise.all(
        entries.slice(idx, idx + batchSize).map(async ([g, files]) => {
          const got: AudioBuffer[] = [];
          for (const f of files) {
            try {
              const r = await fetch(baseUrl + f);
              if (!r.ok) continue;
              got.push(await this.ac.decodeAudioData(await r.arrayBuffer()));
            } catch {
              // Skip failed file; synthesis fallback remains active.
            }
          }
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
