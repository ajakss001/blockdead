import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { IPlatform, PlatformId } from './IPlatform';
import { MockPlatform } from './MockPlatform';

/** Which platform we are running on: explicit ?platform=… wins, otherwise guess from the host page. */
export function detectPlatformId(): PlatformId {
  const params = new URLSearchParams(location.search);
  const forced = params.get('platform');
  if (forced === 'yandex' || forced === 'vk' || forced === 'mock') return forced;
  if (params.has('vk_app_id')) return 'vk';
  if (/(^|\.)yandex\.(ru|com|net)$|(^|\.)playhop\.com$/.test(referrerHost())) return 'yandex';
  return 'mock';
}

function referrerHost(): string {
  try {
    return document.referrer ? new URL(document.referrer).hostname : '';
  } catch {
    return '';
  }
}

export function createPlatform(events: EventBus<GameEvents>): IPlatform {
  const id = detectPlatformId();
  // Yandex/VK adapters arrive in stage 6; until then every environment gets the mock.
  if (id !== 'mock') console.warn(`[platform] ${id} adapter not implemented yet, using mock`);
  return new MockPlatform(events);
}
