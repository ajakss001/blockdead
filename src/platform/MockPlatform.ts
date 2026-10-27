import { detectDevice, type DeviceType } from '../core/device';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { AdResult } from '../core/types';
import type { IPlatform, SaveBlob } from './IPlatform';

const SAVE_KEY = 'blockdead.save';

/** Local development platform: localStorage saves and on-screen fake ads. */
export class MockPlatform implements IPlatform {
  readonly id = 'mock' as const;
  private adOpen = false;

  constructor(private readonly events: EventBus<GameEvents>) {}

  async init(): Promise<void> {}

  gameReady(): void {
    console.info('[platform:mock] gameReady');
  }

  gameplayStart(): void {}

  gameplayStop(): void {}

  async showInterstitial(): Promise<AdResult> {
    if (this.adOpen) return 'throttled';
    this.adOpen = true;
    this.events.emit('ad:start', { kind: 'interstitial' });
    await this.overlay('Межстраничная реклама (mock)', [{ label: 'Закрыть', value: true }], 1500);
    this.adOpen = false;
    this.events.emit('ad:end', { kind: 'interstitial', result: 'shown' });
    return 'shown';
  }

  async showRewarded(): Promise<boolean> {
    if (this.adOpen) return false;
    this.adOpen = true;
    this.events.emit('ad:start', { kind: 'rewarded' });
    const rewarded = await this.overlay('Видео за награду (mock)', [
      { label: 'Досмотреть', value: true },
      { label: 'Закрыть раньше', value: false },
    ]);
    this.adOpen = false;
    this.events.emit('ad:end', { kind: 'rewarded', result: rewarded ? 'shown' : 'closed' });
    return rewarded;
  }

  async save(data: SaveBlob): Promise<void> {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  async load(): Promise<SaveBlob | null> {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SaveBlob;
    } catch {
      return null;
    }
  }

  getLanguage(): string {
    return (navigator.language || 'ru').slice(0, 2);
  }

  getDeviceType(): DeviceType {
    return detectDevice().type;
  }

  private overlay(title: string, buttons: { label: string; value: boolean }[], autoCloseMs = 0): Promise<boolean> {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'mock-ad';
      const box = document.createElement('div');
      box.className = 'mock-ad__box';
      const h = document.createElement('div');
      h.className = 'mock-ad__title';
      h.textContent = title;
      box.append(h);

      let done = false;
      const finish = (value: boolean) => {
        if (done) return;
        done = true;
        root.remove();
        resolve(value);
      };
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.textContent = b.label;
        btn.addEventListener('click', () => finish(b.value));
        box.append(btn);
      }
      root.append(box);
      document.body.append(root);
      if (autoCloseMs > 0) setTimeout(() => finish(true), autoCloseMs);
    });
  }
}
