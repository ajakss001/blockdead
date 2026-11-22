import type { DeviceInfo } from './core/device';
import type { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import type { GameLoop } from './core/GameLoop';
import type { Profiler } from './core/Profiler';
import type { Settings } from './core/Settings';
import type { DebugInfo } from './debug/DebugInfo';
import type { InputManager } from './input/InputManager';
import type { IPlatform } from './platform/IPlatform';
import type { QualityManager } from './render/QualityManager';
import type { Renderer } from './render/Renderer';
import type { Hud } from './ui/Hud';

/** Services shared by scenes and systems. Passed explicitly — no globals, no service locator lookups. */
export interface GameContext {
  readonly events: EventBus<GameEvents>;
  readonly profiler: Profiler;
  readonly loop: GameLoop;
  readonly platform: IPlatform;
  readonly renderer: Renderer;
  readonly quality: QualityManager;
  readonly settings: Settings;
  readonly device: DeviceInfo;
  readonly input: InputManager;
  readonly debug: DebugInfo;
  readonly hud: Hud;
  /** Screen effects driven by gameplay. */
  readonly fx: { setDread(amount: number): void; setDeath(death: number, fade: number): void };
  /** PC: re-acquire pointer lock after a UI closes (no-op on touch). Must run inside a user gesture. */
  requestPointerLock(): void;
  /** Open the full settings modal (CoD-style options screen). */
  openSettings(): void;
  /** Trigger controller rumble when available and enabled. */
  rumble(strong?: number, weak?: number, ms?: number): void;
}
