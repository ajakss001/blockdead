import type { DeviceInfo } from './core/device';
import type { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import type { GameLoop } from './core/GameLoop';
import type { Profiler } from './core/Profiler';
import type { DebugInfo } from './debug/DebugInfo';
import type { InputManager } from './input/InputManager';
import type { IPlatform } from './platform/IPlatform';
import type { QualityManager } from './render/QualityManager';
import type { Renderer } from './render/Renderer';
import type { StyleManager } from './render/style/StyleManager';

/** Services shared by scenes and systems. Passed explicitly — no globals, no service locator lookups. */
export interface GameContext {
  readonly events: EventBus<GameEvents>;
  readonly profiler: Profiler;
  readonly loop: GameLoop;
  readonly platform: IPlatform;
  readonly renderer: Renderer;
  readonly quality: QualityManager;
  readonly device: DeviceInfo;
  readonly input: InputManager;
  readonly debug: DebugInfo;
  readonly style: StyleManager;
}
