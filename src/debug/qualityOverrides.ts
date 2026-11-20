/**
 * Dev-only knobs for isolating one cost at a time on a real phone:
 *
 *   ?quality=medium&shadow=0    medium without its shadow pass
 *   ?quality=high&chunks=1      high, but the 3x3 world of medium
 *   ?quality=high&fog=66        high, but the view distance of medium
 *   ?quality=medium&scale=0.7   medium at 70% resolution
 *
 * No effect in a production build: `import.meta.env.DEV` is false there.
 */
const query = import.meta.env.DEV && typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;

function num(name: string, min: number, max: number): number | null {
  const raw = query?.get(name) ?? null;
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

/** Resolution scale, multiplied on top of the capped devicePixelRatio. */
export const overrideScale = num('scale', 0.4, 2);
/** `?shadow=0` turns the shadow pass off without changing the preset. */
export const overrideShadow: boolean | null = query?.get('shadow') === '0' ? false : null;
/** Fog end distance, m: what actually decides how much of the world is drawn. */
export const overrideFog = num('fog', 20, 200);
/** World streaming radius in chunks. */
export const overrideChunks = num('chunks', 0, 3);
