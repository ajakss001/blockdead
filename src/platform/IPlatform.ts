import type { DeviceType } from '../core/device';
import type { AdResult } from '../core/types';

export type PlatformId = 'mock' | 'yandex' | 'vk';

/** Opaque save payload. Schema and versioning are owned by the Save system (stage 5). */
export type SaveBlob = Record<string, unknown>;

/**
 * Everything the game needs from a hosting platform. Game code talks only to this
 * interface; Yandex/VK adapters (stage 6) are drop-in replacements for MockPlatform.
 *
 * Contract for ads: implementations emit 'ad:start' before showing and 'ad:end' after,
 * so the loop pauses and audio is muted for the whole ad.
 */
export interface IPlatform {
  readonly id: PlatformId;
  init(): Promise<void>;
  /** Game is interactive. Yandex: LoadingAPI.ready(). Call once, after the first rendered frame. */
  gameReady(): void;
  /** Active gameplay started/stopped (platform analytics, Yandex GameplayAPI). */
  gameplayStart(): void;
  gameplayStop(): void;
  showInterstitial(): Promise<AdResult>;
  /** Resolves true only if the reward must be granted. */
  showRewarded(): Promise<boolean>;
  save(data: SaveBlob): Promise<void>;
  load(): Promise<SaveBlob | null>;
  getLanguage(): string;
  getDeviceType(): DeviceType;
}
