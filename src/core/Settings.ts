import type { EventBus } from './EventBus';
import type { GameEvents } from './events';
import type { QualityLevel } from './types';

export type ShadowQuality = 'off' | 'medium' | 'high';
export type DrawDistance = 'near' | 'medium' | 'far';
export type FoliageQuality = 'off' | 'low' | 'medium' | 'high';
export type WeatherDensity = 'low' | 'high';
export type InteriorsLimit = 2 | 4 | 6;
export type FpsCap = 0 | 30 | 60 | 120;

export type ColorblindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';
export type ColorblindTarget = 'both' | 'world' | 'ui';
export type CrosshairColor = 'white' | 'yellow' | 'cyan' | 'magenta' | 'green';
export type CrosshairSize = 'small' | 'medium' | 'large';

export interface SettingsData {
  // Graphics (Call of Duty–style granular controls)
  fov: number;
  renderScale: number;
  fpsCap: FpsCap;
  adaptiveRes: boolean;
  shadows: ShadowQuality;
  drawDistance: DrawDistance;
  foliageQuality: FoliageQuality;
  interiorsLimit: InteriorsLimit;
  postFxGrade: boolean;
  weatherDensity: WeatherDensity;

  // Accessibility & Colorblindness
  colorblindMode: ColorblindMode;
  colorblindStrength: number;
  colorblindTarget: ColorblindTarget;
  cameraBob: number;
  crosshairColor: CrosshairColor;
  crosshairSize: CrosshairSize;
  highContrastHud: boolean;

  // Gamepad (PC + mobile clip-on controllers)
  gamepadEnabled: boolean;
  gamepadSensX: number;
  gamepadSensY: number;
  gamepadDeadzone: number;
  gamepadAdsScale: number;
  gamepadInvertY: boolean;
  gamepadVibration: boolean;
  gamepadHideTouch: boolean;

  // Mouse / Touch
  mouseSens: number;
  mouseInvertY: boolean;
  touchSens: number;
}

const STORAGE_KEY = 'blockdead.settings.v1';

export function defaultsForPreset(level: QualityLevel): Pick<
  SettingsData,
  'renderScale' | 'shadows' | 'drawDistance' | 'foliageQuality' | 'interiorsLimit' | 'postFxGrade' | 'weatherDensity'
> {
  if (level === 'low') {
    return {
      renderScale: 75,
      shadows: 'off',
      drawDistance: 'near',
      foliageQuality: 'low',
      interiorsLimit: 2,
      postFxGrade: false,
      weatherDensity: 'low',
    };
  }
  if (level === 'medium') {
    return {
      renderScale: 100,
      shadows: 'medium',
      drawDistance: 'medium',
      foliageQuality: 'medium',
      interiorsLimit: 4,
      postFxGrade: true,
      weatherDensity: 'high',
    };
  }
  return {
    renderScale: 100,
    shadows: 'high',
    drawDistance: 'far',
    foliageQuality: 'high',
    interiorsLimit: 6,
    postFxGrade: true,
    weatherDensity: 'high',
  };
}

export function createDefaultSettings(level: QualityLevel): SettingsData {
  return {
    fov: 75,
    ...defaultsForPreset(level),
    fpsCap: 60,
    adaptiveRes: false,

    colorblindMode: 'off',
    colorblindStrength: 100,
    colorblindTarget: 'both',
    cameraBob: 100,
    crosshairColor: 'white',
    crosshairSize: 'medium',
    highContrastHud: false,

    gamepadEnabled: true,
    gamepadSensX: 1.2,
    gamepadSensY: 1.0,
    gamepadDeadzone: 0.14,
    gamepadAdsScale: 0.55,
    gamepadInvertY: false,
    gamepadVibration: true,
    gamepadHideTouch: true,

    mouseSens: 1.0,
    mouseInvertY: false,
    touchSens: 1.0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function oneOf<T extends string | number | boolean>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

function sanitize(raw: Partial<SettingsData> | null, base: SettingsData): SettingsData {
  if (!raw || typeof raw !== 'object') return { ...base };
  return {
    fov: typeof raw.fov === 'number' && Number.isFinite(raw.fov) ? Math.round(clamp(raw.fov, 60, 100)) : base.fov,
    renderScale: typeof raw.renderScale === 'number' && Number.isFinite(raw.renderScale) ? Math.round(clamp(raw.renderScale, 50, 100)) : base.renderScale,
    fpsCap: oneOf(raw.fpsCap, [0, 30, 60, 120] as const, base.fpsCap),
    adaptiveRes: typeof raw.adaptiveRes === 'boolean' ? raw.adaptiveRes : base.adaptiveRes,
    shadows: oneOf(raw.shadows, ['off', 'medium', 'high'] as const, base.shadows),
    drawDistance: oneOf(raw.drawDistance, ['near', 'medium', 'far'] as const, base.drawDistance),
    foliageQuality: oneOf(raw.foliageQuality, ['off', 'low', 'medium', 'high'] as const, base.foliageQuality),
    interiorsLimit: oneOf(raw.interiorsLimit, [2, 4, 6] as const, base.interiorsLimit),
    postFxGrade: typeof raw.postFxGrade === 'boolean' ? raw.postFxGrade : base.postFxGrade,
    weatherDensity: oneOf(raw.weatherDensity, ['low', 'high'] as const, base.weatherDensity),

    colorblindMode: oneOf(raw.colorblindMode, ['off', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const, base.colorblindMode),
    colorblindStrength: typeof raw.colorblindStrength === 'number' && Number.isFinite(raw.colorblindStrength) ? Math.round(clamp(raw.colorblindStrength, 50, 100)) : base.colorblindStrength,
    colorblindTarget: oneOf(raw.colorblindTarget, ['both', 'world', 'ui'] as const, base.colorblindTarget),
    cameraBob: typeof raw.cameraBob === 'number' && Number.isFinite(raw.cameraBob) ? Math.round(clamp(raw.cameraBob, 0, 100)) : base.cameraBob,
    crosshairColor: oneOf(raw.crosshairColor, ['white', 'yellow', 'cyan', 'magenta', 'green'] as const, base.crosshairColor),
    crosshairSize: oneOf(raw.crosshairSize, ['small', 'medium', 'large'] as const, base.crosshairSize),
    highContrastHud: typeof raw.highContrastHud === 'boolean' ? raw.highContrastHud : base.highContrastHud,

    gamepadEnabled: typeof raw.gamepadEnabled === 'boolean' ? raw.gamepadEnabled : base.gamepadEnabled,
    gamepadSensX: typeof raw.gamepadSensX === 'number' && Number.isFinite(raw.gamepadSensX) ? clamp(Math.round(raw.gamepadSensX * 20) / 20, 0.5, 3.0) : base.gamepadSensX,
    gamepadSensY: typeof raw.gamepadSensY === 'number' && Number.isFinite(raw.gamepadSensY) ? clamp(Math.round(raw.gamepadSensY * 20) / 20, 0.5, 3.0) : base.gamepadSensY,
    gamepadDeadzone: typeof raw.gamepadDeadzone === 'number' && Number.isFinite(raw.gamepadDeadzone) ? clamp(Math.round(raw.gamepadDeadzone * 100) / 100, 0.05, 0.35) : base.gamepadDeadzone,
    gamepadAdsScale: typeof raw.gamepadAdsScale === 'number' && Number.isFinite(raw.gamepadAdsScale) ? clamp(Math.round(raw.gamepadAdsScale * 20) / 20, 0.3, 1.0) : base.gamepadAdsScale,
    gamepadInvertY: typeof raw.gamepadInvertY === 'boolean' ? raw.gamepadInvertY : base.gamepadInvertY,
    gamepadVibration: typeof raw.gamepadVibration === 'boolean' ? raw.gamepadVibration : base.gamepadVibration,
    gamepadHideTouch: typeof raw.gamepadHideTouch === 'boolean' ? raw.gamepadHideTouch : base.gamepadHideTouch,

    mouseSens: typeof raw.mouseSens === 'number' && Number.isFinite(raw.mouseSens) ? clamp(Math.round(raw.mouseSens * 20) / 20, 0.3, 3.0) : base.mouseSens,
    mouseInvertY: typeof raw.mouseInvertY === 'boolean' ? raw.mouseInvertY : base.mouseInvertY,
    touchSens: typeof raw.touchSens === 'number' && Number.isFinite(raw.touchSens) ? clamp(Math.round(raw.touchSens * 20) / 20, 0.3, 3.0) : base.touchSens,
  };
}

/** Persistent user settings (Graphics, Accessibility/Colorblindness, Gamepad, Controls). */
export class Settings {
  private _data: SettingsData;

  constructor(
    private readonly events: EventBus<GameEvents>,
    initialLevel: QualityLevel,
  ) {
    const base = createDefaultSettings(initialLevel);
    let parsed: Partial<SettingsData> | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) parsed = JSON.parse(saved) as Partial<SettingsData>;
    } catch {
      parsed = null;
    }
    this._data = sanitize(parsed, base);
  }

  get data(): Readonly<SettingsData> {
    return this._data;
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    if (this._data[key] === value) return;
    this._data = sanitize({ ...this._data, [key]: value }, this._data);
    this.save();
    this.events.emit('settings:changed', { key });
  }

  applyPresetDefaults(level: QualityLevel): void {
    this._data = { ...this._data, ...defaultsForPreset(level) };
    this.save();
    this.events.emit('settings:changed', {});
  }

  resetAll(level: QualityLevel): void {
    this._data = createDefaultSettings(level);
    this.save();
    this.events.emit('settings:changed', {});
  }

  /** Estimated GPU budget impact in MB for the CoD-style VRAM meter. */
  estimateVramMb(presetLevel: QualityLevel, deviceMemoryGb: number): { used: number; max: number } {
    const d = this._data;
    const base = presetLevel === 'low' ? 190 : 320;
    const renderMb = Math.round(((d.renderScale / 100) ** 2) * (presetLevel === 'high' ? 140 : 75));
    const shadowMb = d.shadows === 'high' ? 68 : d.shadows === 'medium' ? 24 : 0;
    const distMb = d.drawDistance === 'far' ? 190 : d.drawDistance === 'medium' ? 95 : 55;
    const foliageMb = d.foliageQuality === 'high' ? 48 : d.foliageQuality === 'medium' ? 28 : d.foliageQuality === 'low' ? 14 : 0;
    const intMb = d.interiorsLimit * 14;
    const postMb = d.postFxGrade && presetLevel !== 'low' ? 32 : 0;
    const used = base + renderMb + shadowMb + distMb + foliageMb + intMb + postMb;
    const max = deviceMemoryGb > 0 && deviceMemoryGb <= 4 ? 768 : 1536;
    return { used, max };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
    } catch {
      // Storage may be restricted inside platform iframes.
    }
  }
}
