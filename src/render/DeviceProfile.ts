import type { DeviceInfo } from '../core/device';
import type { QualityLevel } from '../core/types';
import { QUALITY_LEVELS } from './QualityPresets';

export const QUALITY_STORAGE_KEY = 'blockdead.quality';

/** GPUs that cannot hold 60 FPS at native resolution with anything but the low preset. */
const WEAK_GPU = /Mali-(4|T[6-8])|Mali-G(31|51|52|57)|Adreno \(TM\) [3-5]\d\d|PowerVR|SGX|Intel\(R\) HD Graphics [2-5]\d{2,3}\b|SwiftShader|llvmpipe/i;
/** Mobile GPUs comfortable with medium. */
const STRONG_MOBILE_GPU = /Apple|Adreno \(TM\) (6[4-9]\d|7\d\d|8\d\d)|Mali-G(7[1-9]|7\d\d|6[1-9]\d|9\d\d)|Xclipse|Immortalis/i;

function isLevel(v: string | null): v is QualityLevel {
  return v !== null && (QUALITY_LEVELS as readonly string[]).includes(v);
}

/**
 * Initial preset: ?quality=… override → player's saved choice → hardware heuristic.
 * The heuristic is deliberately pessimistic on mobile; QualityManager only lowers further.
 */
export function pickInitialLevel(device: DeviceInfo, gpuName: string): QualityLevel {
  const forced = new URLSearchParams(location.search).get('quality');
  if (isLevel(forced)) return forced;
  try {
    const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
    if (isLevel(saved)) return saved;
  } catch {
    // Storage can be blocked in third-party iframes; fall through to the heuristic.
  }

  if (WEAK_GPU.test(gpuName)) return 'low';
  if (device.type === 'desktop') return 'high';

  const lowEndCpu = (device.cores > 0 && device.cores <= 4) || (device.memoryGb > 0 && device.memoryGb <= 3);
  if (lowEndCpu) return 'low';
  return STRONG_MOBILE_GPU.test(gpuName) ? 'medium' : 'low';
}
