import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Profiler } from '../core/Profiler';
import type { QualityLevel } from '../core/types';
import { QUALITY_STORAGE_KEY } from './DeviceProfile';
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityPreset } from './QualityPresets';
import type { Renderer } from './Renderer';

/** Sustained over-budget time before stepping down, ms. */
const DEGRADE_AFTER_MS = 1500;
/** Sustained headroom before stepping resolution back up, ms. */
const RECOVER_AFTER_MS = 5000;
/** Let the profiler window refill after any change, ms (window = 120 frames ≈ 2 s at 60 FPS). */
const COOLDOWN_MS = 2500;
const SCALE_STEP = 0.05;

/**
 * Quality is the player's choice only: the preset (and its resolution) change in `setLevel` and nowhere else.
 * A freeze, a hitch, a chunk being built never lowers it. `adaptive` (off by default, a debug toggle) may only
 * trade resolution scale within the chosen preset's own range — it never switches the preset.
 */
export class QualityManager {
  /** Resolution-scale adaptation inside the chosen preset. Off: the player's choice stands. */
  adaptive = false;
  /**
   * Second safety net, for phones only (`main.ts` turns it on for non-desktop): a device that sits at more
   * than twice the frame budget for a second is not going to recover on its own, so the preset drops one
   * step. Without it a phone that once saved 'medium' in localStorage had no way back to a playable frame
   * (dropPreset was removed in 45eaf15).
   */
  allowPresetDrop = false;
  targetFps = 60;

  private _preset: QualityPreset;
  private _scale: number;
  private badSince = 0;
  private goodSince = 0;
  private cooldownUntil = 0;

  constructor(
    private readonly events: EventBus<GameEvents>,
    private readonly renderer: Renderer,
    private readonly profiler: Profiler,
    initial: QualityLevel,
  ) {
    this._preset = QUALITY_PRESETS[initial];
    this._scale = this._preset.resolutionScaleMax;
    this.apply('init');
  }

  get preset(): QualityPreset {
    return this._preset;
  }

  get resolutionScale(): number {
    return this._scale;
  }

  /** Manual choice from settings/debug; persisted and treated as the player's preference. */
  setLevel(level: QualityLevel): void {
    this._preset = QUALITY_PRESETS[level];
    this._scale = this._preset.resolutionScaleMax;
    try {
      localStorage.setItem(QUALITY_STORAGE_KEY, level);
    } catch {
      // Ignore: storage may be unavailable inside platform iframes.
    }
    this.apply('user');
  }

  /** Call once per rendered frame. */
  update(now: number): void {
    if (now < this.cooldownUntil || this.profiler.sampleCount < 60) {
      this.badSince = this.goodSince = 0;
      return;
    }
    if (!this.adaptive && !this.allowPresetDrop) {
      this.badSince = this.goodSince = 0;
      return;
    }
    const budget = 1000 / this.targetFps;
    const frame = this.profiler.frameAvgMs;
    // Hopelessly slow (under ~30 FPS): no amount of resolution scaling saves it, step the preset down now.
    if (this.allowPresetDrop && frame > budget * 2 && this._preset.level !== 'low') {
      if (this.badSince === 0) this.badSince = now;
      else if (now - this.badSince > 900) {
        this.dropOneLevel();
        return;
      }
    } else {
      this.badSince = 0;
    }
    if (!this.adaptive) {
      this.goodSince = 0;
      return;
    }
    const over = frame > budget * 1.12;
    const headroom = frame < budget * 1.04 && this.profiler.cpuAvgMs < budget * 0.5;

    if (over) {
      this.goodSince = 0;
      if (this.badSince === 0) this.badSince = now;
      else if (now - this.badSince > DEGRADE_AFTER_MS) this.degrade();
    } else if (headroom && this._scale < this._preset.resolutionScaleMax) {
      this.badSince = 0;
      if (this.goodSince === 0) this.goodSince = now;
      else if (now - this.goodSince > RECOVER_AFTER_MS) {
        this._scale = Math.min(this._preset.resolutionScaleMax, this._scale + SCALE_STEP);
        this.apply('auto');
      }
    } else {
      this.badSince = this.goodSince = 0;
    }
  }

  /** One preset down, without recording it as the player's choice (a device can hold it, a player may not). */
  private dropOneLevel(): void {
    const i = QUALITY_LEVELS.indexOf(this._preset.level);
    const next = QUALITY_LEVELS[Math.max(0, i - 1)];
    if (next === this._preset.level) return;
    this._preset = QUALITY_PRESETS[next];
    this._scale = this._preset.resolutionScaleMax;
    this.apply('auto');
  }

  private degrade(): void {
    // Only within the player's preset: at its resolution floor there is nothing more to take.
    if (this._scale - SCALE_STEP < this._preset.resolutionScaleMin - 1e-3) {
      this.badSince = 0;
      return;
    }
    this._scale -= SCALE_STEP;
    this.apply('auto');
  }

  private apply(source: 'init' | 'auto' | 'user'): void {
    this.renderer.setPixelRatioCap(this._preset.maxPixelRatio);
    this.renderer.setShadows(this._preset.shadowMapSize > 0);
    this.renderer.setResolutionScale(this._scale);
    this.badSince = this.goodSince = 0;
    this.cooldownUntil = performance.now() + COOLDOWN_MS;
    // Judge the new settings on fresh frames only, not on the slow history that triggered the change.
    this.profiler.reset();
    this.events.emit('quality:changed', { level: this._preset.level, resolutionScale: this._scale, source });
  }
}
