/**
 * Recorded sounds (public/sounds, built by tools/build-sounds.mjs from assets/incoming/sounds), loaded lazily:
 * nothing at boot; after the first gesture creates the AudioContext, the list (sounds.json, a few hundred
 * bytes) and then the groups one by one in the background (≈ 0.5 MB in all). Until a group has come — or if
 * it never does (offline, no files) — `pick` gives null and the caller plays its synthesized sound instead.
 */

/** The groups sounds.json may hold (tools/build-sounds.mjs). */
export type SampleGroup =
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
  | 'zDeath';

const BASE = `${import.meta.env.BASE_URL}sounds/`;

export class Samples {
  private readonly buffers = new Map<SampleGroup, AudioBuffer[]>();
  private started = false;
  private last = new Map<SampleGroup, number>();

  constructor(private readonly ac: BaseAudioContext) {}

  /** Start the background load (once; call after the context exists). */
  load(): void {
    if (this.started || typeof fetch === 'undefined') return;
    this.started = true;
    void (async () => {
      let list: Partial<Record<SampleGroup, string[]>>;
      try {
        const r = await fetch(`${BASE}sounds.json`);
        if (!r.ok) return;
        list = (await r.json()) as Partial<Record<SampleGroup, string[]>>;
      } catch {
        return;
      }
      for (const [g, files] of Object.entries(list) as [SampleGroup, string[]][]) {
        const got: AudioBuffer[] = [];
        for (const f of files) {
          try {
            const r = await fetch(BASE + f);
            if (!r.ok) continue;
            got.push(await this.ac.decodeAudioData(await r.arrayBuffer()));
          } catch {
            // A file that would not come or decode: the group plays the others (or the synthesis).
          }
        }
        if (got.length) this.buffers.set(g, got);
      }
    })();
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
