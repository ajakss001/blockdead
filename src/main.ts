import './ui/styles.css';
import { detectDevice, type DeviceInfo } from './core/device';
import { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import { GameLoop } from './core/GameLoop';
import { Profiler } from './core/Profiler';
import { DebugInfo } from './debug/DebugInfo';
import { DebugPanel } from './debug/DebugPanel';
import type { GameContext } from './GameContext';
import { InputManager, type InputMode } from './input/InputManager';
import { KeyboardMouseInput } from './input/KeyboardMouseInput';
import { TouchInput } from './input/TouchInput';
import { createPlatform } from './platform/createPlatform';
import { pickInitialLevel } from './render/DeviceProfile';
import { QualityManager } from './render/QualityManager';
import { Renderer } from './render/Renderer';
import { pickStyle, StyleManager } from './render/style/StyleManager';
import type { IScene } from './scenes/IScene';
import { PlaygroundScene } from './scenes/PlaygroundScene';
import { TestScene } from './scenes/TestScene';
import { mountCrosshair, PlayOverlay } from './ui/PlayOverlay';
import { mountStyleOverlay } from './ui/StyleOverlay';

const params = new URLSearchParams(location.search);

/** ?input=touch|kbm overrides detection (handy for testing touch controls with a mouse). */
function pickInputMode(device: DeviceInfo): InputMode {
  const forced = params.get('input');
  if (forced === 'touch' || forced === 'kbm') return forced;
  return device.touch && device.type !== 'desktop' ? 'touch' : 'kbm';
}

async function boot(): Promise<void> {
  const gameEl = document.getElementById('game')!;
  const uiEl = document.getElementById('ui')!;

  const events = new EventBus<GameEvents>();
  const profiler = new Profiler();
  const debug = new DebugInfo();
  const device = detectDevice();
  const platform = createPlatform(events);
  await platform.init();

  // MSAA is fixed at context creation, before the GPU name is known: decide by device class.
  const renderer = new Renderer(gameEl, events, device.type === 'desktop');
  const level = pickInitialLevel(device, renderer.gpuName);
  const quality = new QualityManager(events, renderer, profiler, level);
  const input = new InputManager(pickInputMode(device), events);
  // ?style=diary|vhs — visual identity prototypes; plain is the neutral baseline.
  const style = new StyleManager(pickStyle());

  // ?scene=bench — the stage 0 rendering benchmark.
  const scene: IScene = params.get('scene') === 'bench' ? new TestScene() : new PlaygroundScene();
  const draw = (alpha: number, frameDt: number) => {
    scene.render(alpha, frameDt);
    style.update(frameDt, renderer);
    renderer.beginFrame();
    profiler.begin('draw');
    renderer.render(scene.scene, scene.camera);
    if (scene.overlay) renderer.renderOverlay(scene.overlay.scene, scene.overlay.camera);
    profiler.end('draw');
  };

  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => scene.fixedUpdate(dt),
      render: (alpha, frameDt) => {
        quality.update(performance.now());
        draw(alpha, frameDt);
      },
    },
    profiler,
    events,
  );

  const ctx: GameContext = { events, profiler, loop, platform, renderer, quality, device, input, debug, style };
  scene.init(ctx);

  mountCrosshair(uiEl);
  mountStyleOverlay(style.style, uiEl);
  if (input.mode === 'touch') {
    new TouchInput(input, uiEl);
  } else {
    const kbm = new KeyboardMouseInput(input, renderer.gl.domElement);
    new PlayOverlay(ctx, kbm, uiEl);
  }
  new DebugPanel(ctx, uiEl);

  if (import.meta.env.DEV) Object.assign(window, { __game: { ctx, scene } });

  // First frame is drawn synchronously, so the game reports ready even when it boots into
  // a hard pause (portrait phone, hidden tab) — otherwise gameReady() would wait for rotation.
  draw(0, 0);
  document.getElementById('loading')?.remove();
  platform.gameReady();

  wireLifecycle(ctx);
  loop.start();
}

/** Pause/resume rules shared by every scene: hidden tab, ads, portrait phone, lost GL context. */
function wireLifecycle({ events, loop, input }: GameContext): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.reset();
      loop.pause('hidden');
    } else {
      loop.resume('hidden');
    }
  });

  events.on('ad:start', () => {
    input.reset();
    loop.pause('ad');
  });
  events.on('ad:end', () => loop.resume('ad'));
  events.on('gl:contextlost', () => loop.pause('context'));
  events.on('gl:contextrestored', () => loop.resume('context'));

  const portrait = matchMedia('(orientation: portrait) and (pointer: coarse)');
  const onOrientation = () => (portrait.matches ? loop.pause('orientation') : loop.resume('orientation'));
  portrait.addEventListener('change', onOrientation);
  onOrientation();

  // No browser context menu / long-press callout over the game.
  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

boot().catch((err: unknown) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = 'Не удалось запустить игру. Проверьте поддержку WebGL2.';
});
