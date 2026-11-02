import './ui/styles.css';
import { detectDevice, type DeviceInfo } from './core/device';
import { EventBus } from './core/EventBus';
import { sfx } from './audio/Sound';
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
import { setMaterialAnisotropy } from './render/look/materials';
import { initWorldMaterials, loadModelAtlas } from './render/look/worldMaterials';
import { PostFX } from './render/PostFX';
import { QUALITY_PRESETS } from './render/QualityPresets';
import type { IScene } from './scenes/IScene';
import { WorldScene } from './scenes/WorldScene';
import { TestScene } from './scenes/TestScene';
import { mountCrosshair, PlayOverlay } from './ui/PlayOverlay';
import { Hud } from './ui/Hud';

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

  const renderer = new Renderer(gameEl, events, false);
  const level = pickInitialLevel(device, renderer.gpuName);
  const quality = new QualityManager(events, renderer, profiler, level);
  const input = new InputManager(pickInputMode(device), events);
  const maxAniso = renderer.gl.capabilities.getMaxAnisotropy();
  setMaterialAnisotropy(maxAniso);
  initWorldMaterials(QUALITY_PRESETS[level].lighting, maxAniso);
  // Third-party vehicles and props (one atlas layer each), before the world streams in.
  await loadModelAtlas(`${import.meta.env.BASE_URL}models/atlas.jpg`, 256, maxAniso);
  // Anti-aliasing lives in the post-processing target (the canvas itself has none): MSAA is chosen
  // once at boot from the initial preset, like a context-level setting would be.
  const postfx = new PostFX(renderer, QUALITY_PRESETS[level].msaa);
  // The grade, grain and vignette cost nothing extra (one pass either way) but stay off on low.
  postfx.setGrade(level !== 'low');
  events.on('quality:changed', (e) => postfx.setGrade(e.level !== 'low'));
  const hud = new Hud(uiEl);

  // ?scene=bench — the stage 0 rendering benchmark.
  const scene: IScene = params.get('scene') === 'bench' ? new TestScene() : new WorldScene();
  const draw = (alpha: number, frameDt: number) => {
    scene.render(alpha, frameDt);
    renderer.beginFrame();
    profiler.begin('draw');
    postfx.render(frameDt);
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

  // One sound system: unlocked by the first gesture, muted with the pause reasons.
  sfx.attach(events, loop);
  const kbm = input.mode === 'kbm' ? new KeyboardMouseInput(input, renderer.gl.domElement) : null;
  const ctx: GameContext = {
    events,
    profiler,
    loop,
    platform,
    renderer,
    quality,
    device,
    input,
    debug,
    hud,
    fx: { setDread: (amount) => postfx.setDread(amount), setDeath: (death, fade) => postfx.setDeath(death, fade) },
    requestPointerLock: () => void kbm?.requestLock(),
  };
  scene.init(ctx);
  await scene.load?.();
  postfx.setScene(scene.scene, scene.camera, scene.overlay);
  // ?hud=demo — preview the state indicators before survival stats exist (stage 3).
  if (params.get('hud') === 'demo') {
    hud.setStat('hunger', 0.4, 1);
    hud.setStat('warmth', 0.15, 2, 'cold');
    hud.setStat('battery', 0.05, 3);
    hud.setWound(true);
  }

  mountCrosshair(uiEl);
  if (kbm) new PlayOverlay(ctx, kbm, uiEl);
  else new TouchInput(input, uiEl, events);
  new DebugPanel(ctx, uiEl);

  if (import.meta.env.DEV) Object.assign(window, { __game: { ctx, scene, draw, postfx } });
  if (params.has('animdebug') && scene instanceof WorldScene) {
    const vm = scene.viewmodel;
    void import('./debug/animDebug').then((m) => m.installAnimDebug(vm, uiEl));
  }
  if (import.meta.env.DEV && scene instanceof WorldScene) void import('./debug/devHarness').then((m) => m.installDevHarness(ctx, scene, draw));

  // Shaders compile on first use, and on Windows (ANGLE → D3D) each one can stall a frame for
  // 100–500 ms. Draw every material, the shadow map and all post passes now, behind the loading screen.
  const t0 = performance.now();
  const cleanup = scene.prewarm?.();
  draw(0, 0);
  cleanup?.();
  // Also the first real frame, drawn synchronously, so the game reports ready even when it boots into
  // a hard pause (portrait phone, hidden tab) — otherwise gameReady() would wait for rotation.
  draw(0, 0);
  console.info(`[boot] shaders warmed in ${Math.round(performance.now() - t0)} ms`);
  document.getElementById('loading')?.remove();
  platform.gameReady();

  wireLifecycle(ctx);
  loop.start();
  // New game: the character editor over the paused world.
  await scene.createCharacter?.();
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
