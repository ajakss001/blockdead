import './ui/styles.css';
import { detectDevice } from './core/device';
import { EventBus } from './core/EventBus';
import type { GameEvents } from './core/events';
import { GameLoop } from './core/GameLoop';
import { Profiler } from './core/Profiler';
import { DebugPanel } from './debug/DebugPanel';
import type { GameContext } from './GameContext';
import { createPlatform } from './platform/createPlatform';
import { pickInitialLevel } from './render/DeviceProfile';
import { QualityManager } from './render/QualityManager';
import { Renderer } from './render/Renderer';
import { TestScene } from './scenes/TestScene';

async function boot(): Promise<void> {
  const gameEl = document.getElementById('game')!;
  const uiEl = document.getElementById('ui')!;

  const events = new EventBus<GameEvents>();
  const profiler = new Profiler();
  const device = detectDevice();
  const platform = createPlatform(events);
  await platform.init();

  // MSAA is fixed at context creation, before the GPU name is known: decide by device class.
  const renderer = new Renderer(gameEl, events, device.type === 'desktop');
  const level = pickInitialLevel(device, renderer.gpuName);
  const quality = new QualityManager(events, renderer, profiler, level);

  const scene = new TestScene();
  const draw = (alpha: number, frameDt: number) => {
    scene.render(alpha, frameDt);
    renderer.beginFrame();
    profiler.begin('draw');
    renderer.render(scene.scene, scene.camera);
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

  const ctx: GameContext = { events, profiler, loop, platform, renderer, quality, device };
  scene.init(ctx);
  new DebugPanel(ctx, uiEl);

  // First frame is drawn synchronously, so the game reports ready even when it boots into
  // a hard pause (portrait phone, hidden tab) — otherwise gameReady() would wait for rotation.
  draw(0, 0);
  document.getElementById('loading')?.remove();
  platform.gameReady();

  wireLifecycle(ctx);
  loop.start();
}

/** Pause/resume rules shared by every scene: hidden tab, ads, portrait phone, lost GL context. */
function wireLifecycle({ events, loop }: GameContext): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.pause('hidden');
    else loop.resume('hidden');
  });

  events.on('ad:start', () => loop.pause('ad'));
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
