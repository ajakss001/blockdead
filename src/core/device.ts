export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export interface DeviceInfo {
  type: DeviceType;
  touch: boolean;
  /** Logical CPU cores; 0 if unknown. */
  cores: number;
  /** Approximate RAM in GB (Chromium only, capped at 8); 0 if unknown. */
  memoryGb: number;
  ios: boolean;
}

let cached: DeviceInfo | null = null;

export function detectDevice(): DeviceInfo {
  if (cached) return cached;
  const ua = navigator.userAgent;
  // iPadOS reports itself as Mac; touch points give it away.
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touch = navigator.maxTouchPoints > 0 || coarse;
  const tablet = /iPad|Tablet/i.test(ua) || (ios && !/iPhone|iPod/i.test(ua)) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const mobile =
    !tablet &&
    (/Android|iPhone|iPod|Mobile/i.test(ua) || coarse || (touch && Math.min(screen.width, screen.height) < 600));
  cached = {
    type: tablet ? 'tablet' : mobile ? 'mobile' : 'desktop',
    touch,
    cores: navigator.hardwareConcurrency || 0,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0,
    ios,
  };
  return cached;
}
