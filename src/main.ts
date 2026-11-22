import './ui/styles.css';
import { detectDevice, type DeviceInfo } from './core/device';
import { onLangChange, tr } from './core/i18n';
import { EventBus } from './core/EventBus';
import { sfx } from './audio/Sound';
import type { GameEvents } from './core/events';
import { GameLoop } from './core/GameLoop';
import { Profiler } from './core/Profiler';
import { Settings } from './core/Settings';
import { DebugInfo } from './debug/DebugInfo';
import { DebugPanel } from './debug/DebugPanel';
import type { GameContext } from './GameContext';
import { GamepadInput } from './input/GamepadInput';
import { InputManager, type InputMode } from './input/InputManager';
import { KeyboardMouseInput } from './input/KeyboardMouseInput';
import { TouchInput } from './input/TouchInput';
import { createPlatform } from './platform/createPlatform';
import { pickInitialLevel } from './render/DeviceProfile';
import { debugKnobs, QualityManager } from './render/QualityManager';
import { Renderer } from './render/Renderer';
import { setMaterialAnisotropy } from './render/look/materials';
import { initWorldMaterials, loadModelAtlas } from './render/look/worldMaterials';
import { loadCharacters, setCharacterAnisotropy } from './characters/assets';
import { loadGearMeta, setGearAnisotropy, setGearSource } from './characters/gear';
import { PostFX } from './render/PostFX';
import { QUALITY_PRESETS } from './render/QualityPresets';
import type { IScene } from './scenes/IScene';
import { WorldScene } from './scenes/WorldScene';
import { TestScene } from './scenes/TestScene';
import { ColorblindFilter } from './ui/ColorblindFilter';
import { MainMenu } from './ui/MainMenu';
import { mountCrosshair, PlayOverlay } from './ui/PlayOverlay';
import { Hud } from './ui/Hud';
import { SettingsModal } from './ui/SettingsModal';
import { loadItemIcons } from './ui/pixelart';

const nextPaint = (): Promise<void> =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0))));

function setLoadingStatus(text: string, sub?: string, shaderPct?: number): void {
  const root = document.getElementById('loading');
  const textEl = document.getElementById('loading-text');
  const subEl = document.getElementById('loading-sub');
  const barFill = document.querySelector<HTMLDivElement>('#loading-bar > div');
  if (textEl) textEl.textContent = text;
  if (subEl && sub !== undefined) subEl.textContent = sub;
  if (shaderPct !== undefined && root && barFill) {
    root.classList.add('loading--shaders');
    barFill.style.width = `${Math.max(4, Math.min(100, Math.round(shaderPct)))}%`;
  }
}

const params = new URLSearchParams(location.search);

/** ?input=touch|kbm overrides detection (handy for testing touch controls with a mouse). */
function pickInputMode(device: DeviceInfo): InputMode {
  const forced = params.get('input');
  if (forced === 'touch' || forced === 'kbm') return forced;
  return device.touch && device.type !== 'desktop' ? 'touch' : 'kbm';
}

async function boot(): Promise<void> {
  // ?gripedit=<item> — the grip editor (dev): the item in the hands, gizmos, saved to src/data/grips.json.
  if (import.meta.env.DEV && params.has('gripedit')) {
    await loadCharacters(1024);
    const m = await import('./debug/gripEditor');
    await m.startGripEditor(params.get('gripedit'));
    return;
  }
  // ?gearedit=<gear|outfit|body> — the gear editor (dev): a piece's fit per body, saved to src/data/gearFit.json.
  if (import.meta.env.DEV && params.has('gearedit')) {
    setGearSource(2048);
    await loadCharacters(2048);
    const m = await import('./debug/gearEditor');
    await m.startGearEditor(params.get('gearedit'));
    return;
  }
  const gameEl = document.getElementById('game')!;
  const uiEl = document.getElementById('ui')!;
  setLoadingStatus(tr('Загрузка мира и моделей…', 'Loading world & models…'));

  const events = new EventBus<GameEvents>();
  const profiler = new Profiler();
  const debug = new DebugInfo();
  const device = detectDevice();
  const platform = createPlatform(events);
  await platform.init();

  const renderer = new Renderer(gameEl, events, false);
  const level = pickInitialLevel(device, renderer.gpuName);
  const quality = new QualityManager(events, renderer, profiler, level);
  // Quality is the player's choice: the preset never changes on its own. ?autodrop=1 opts into the
  // old phone safety net (one step down under ~30 FPS) for device testing only.
  quality.allowPresetDrop = params.get('autodrop') === '1' && device.type !== 'desktop';
  const settings = new Settings(events, level);
  const colorblind = new ColorblindFilter();
  colorblind.apply(settings.data);

  const input = new InputManager(pickInputMode(device), events);
  const maxAniso = renderer.gl.capabilities.getMaxAnisotropy();
  const aniso = level === 'low' ? 1 : Math.min(4, maxAniso);
  setMaterialAnisotropy(aniso);
  setCharacterAnisotropy(aniso);
  setGearAnisotropy(aniso);
  initWorldMaterials(QUALITY_PRESETS[level].lighting, aniso);
  // Third-party vehicles and props (one atlas layer each), before the world streams in.
  await loadModelAtlas(`${import.meta.env.BASE_URL}models/atlas.jpg`, 256, aniso);
  // The character models (player, zombies, bodies): everything that draws a person uses them synchronously.
  // Up close (the player, the menu, the inventory) 2048, the zombies 1024 (lodTexture); 512 on low.
  setGearSource(level === 'low' ? 512 : 2048);
  await Promise.all([loadCharacters(level === 'low' ? 512 : 2048), loadGearMeta(), loadItemIcons()]);
  // Anti-aliasing lives in the post-processing target (the canvas itself has none): MSAA is chosen
  // once at boot from the initial preset, like a context-level setting would be.
  const postfx = new PostFX(renderer, QUALITY_PRESETS[level].msaa, level, device.type !== 'desktop');
  postfx.setGrade(settings.data.postFxGrade);
  events.on('quality:changed', (e) => {
    postfx.setLevel(e.level);
    postfx.setGrade(settings.data.postFxGrade);
    postfx.setBypass(e.level === 'low');
  });
  const hud = new Hud(uiEl);
  const settingsModal = new SettingsModal(uiEl);
  const mainMenu = new MainMenu(uiEl);
  let modalOpen = false;
  events.on('ui:modal', ({ open }) => {
    modalOpen = open;
  });

  // ?scene=bench — the stage 0 rendering benchmark.
  const scene: IScene = params.get('scene') === 'bench' ? new TestScene() : new WorldScene();
  const programs = () => renderer.gl.info.programs?.length ?? 0;
  const newPrograms = (from: number): string[] => {
    const list = renderer.gl.info.programs ?? [];
    const names: string[] = [];
    for (let i = from; i < list.length; i++) {
      const tag = String(list[i].cacheKey ?? '').split(',').pop() ?? '';
      names.push(`${list[i].name || '?'}${tag ? `:${tag.slice(0, 28)}` : ''}`);
    }
    return names;
  };
  const draw = (alpha: number, frameDt: number, gameDt: number) => {
    const t0 = performance.now();
    const p0 = programs();
    profiler.begin('scene');
    scene.render(alpha, frameDt, gameDt);
    profiler.end('scene');
    renderer.beginFrame();
    profiler.begin('draw');
    postfx.render(frameDt);
    profiler.end('draw');
    const ms = performance.now() - t0;
    if (ms > 40) {
      const sec = [...profiler.last].map(([k, v]) => `${k} ${v.toFixed(0)}`).join(' ');
      const at = new Date().toLocaleTimeString();
      const added = newPrograms(p0);
      const names = added.slice(0, 4).join(', ') + (added.length > 4 ? ` +${added.length - 4}` : '');
      profiler.noteSpike(`${at} ${ms.toFixed(0)}ms prog ${p0}->${programs()} [${names}] | ${sec}`);
    }
  };

  let gamepad!: GamepadInput;
  const loop = new GameLoop(
    {
      fixedUpdate: (dt) => {
        profiler.begin('fixed');
        scene.fixedUpdate(dt);
        profiler.end('fixed');
      },
      render: (alpha, frameDt, gameDt) => {
        gamepad.update(frameDt);
        quality.update(performance.now());
        draw(alpha, frameDt, gameDt);
      },
    },
    profiler,
    events,
  );

  // One sound system: unlocked by the first gesture, muted with the pause reasons.
  sfx.attach(events, loop);
  const kbm = input.mode === 'kbm' ? new KeyboardMouseInput(input, renderer.gl.domElement) : null;
  gamepad = new GamepadInput(input, settings, events, {
    isModalOpen: () => modalOpen || settingsModal.isOpen || mainMenu.isOpen,
    onMenuToggle: () => {
      if (settingsModal.isOpen) settingsModal.close(false);
      else if (mainMenu.isOpen) settingsModal.open();
      else if (!modalOpen) settingsModal.open();
    },
    onModalBack: () => {
      if (settingsModal.isOpen) settingsModal.close(false);
      else if (mainMenu.isOpen) mainMenu.cancelConfirm();
    },
    onModalNav: (dir) => {
      if (mainMenu.isOpen && !settingsModal.isOpen && !document.querySelector('.credits')) mainMenu.moveSelection(dir);
    },
    onModalConfirm: () => {
      if (mainMenu.isOpen && !settingsModal.isOpen && !document.querySelector('.credits')) mainMenu.confirmSelection();
    },
    onActivate: () => input.setActive(true),
    toast: (text) => hud.toast(text),
  });

  const ctx: GameContext = {
    events,
    profiler,
    loop,
    platform,
    renderer,
    quality,
    settings,
    device,
    input,
    debug,
    hud,
    fx: { setDread: (amount) => postfx.setDread(amount), setDeath: (death, fade) => postfx.setDeath(death, fade) },
    requestPointerLock: () => void kbm?.requestLock(),
    openSettings: () => settingsModal.open(),
    openMainMenu: () => {
      void scene.saveNow?.();
      mainMenu.open();
    },
    rumble: (strong, weak, ms) => gamepad.rumble(strong, weak, ms),
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
  let touch: TouchInput | null = null;
  if (kbm) new PlayOverlay(ctx, kbm, uiEl);
  else touch = new TouchInput(input, uiEl, events, () => settingsModal.open());
  new DebugPanel(ctx, uiEl);

  const applyGlobalSettings = () => {
    const s = settings.data;
    const k = debugKnobs();
    if (k.scale === undefined) renderer.setResolutionScale(s.renderScale / 100);
    postfx.setGrade(s.postFxGrade);
    colorblind.apply(s);
    if (kbm) {
      kbm.sensitivity = 0.0022 * s.mouseSens;
      kbm.invertY = s.mouseInvertY;
    }
    if (touch) {
      touch.lookSensitivity = 0.0065 * s.touchSens;
      touch.setGamepadHidden(s.gamepadEnabled && s.gamepadHideTouch && gamepad.connected);
    }
  };
  events.on('settings:changed', applyGlobalSettings);
  events.on('quality:changed', applyGlobalSettings);
  events.on('gamepad:changed', applyGlobalSettings);
  settingsModal.bind(ctx, () => ({ connected: gamepad.connected, name: gamepad.name }), () => mainMenu.isOpen);
  mainMenu.bind({
    ctx,
    getSaveSummary: () =>
      scene.saveSummary?.() ?? { hasSave: false, day: 1, time: '00:00', kills: 0, health: 100 },
    onContinue: () => {},
    onNewGame: () => {
      void scene.createCharacter?.();
    },
    onNewGameOverwrite: async () => {
      await scene.resetSave?.();
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.set('menu', '0');
      location.href = nextUrl.toString();
    },
    onOpenSettings: (tab) => settingsModal.open(tab),
    isSubModalOpen: () => settingsModal.isOpen || !!document.querySelector('.credits'),
    getGamepadInfo: () => ({ connected: gamepad.connected, name: gamepad.name }),
  });
  applyGlobalSettings();

  if (import.meta.env.DEV) Object.assign(window, { __game: { ctx, scene, draw, postfx, settings, gamepad, settingsModal, mainMenu } });
  if (params.has('animdebug') && scene instanceof WorldScene) {
    const vm = scene.viewmodel;
    void import('./debug/animDebug').then((m) => m.installAnimDebug(vm, uiEl));
  }
  if (import.meta.env.DEV && scene instanceof WorldScene) void import('./debug/devHarness').then((m) => m.installDevHarness(ctx, scene, draw));

  // Shaders compile on first use, and on Windows (ANGLE → D3D) each one can stall a frame for
  // 100–500 ms. Draw every material, the shadow map and all post passes now, behind the loading screen.
  const t0 = performance.now();
  const warmLabel = tr('Компиляция шейдеров…', 'Compiling shaders…');
  setLoadingStatus(warmLabel, tr('Подготовка графики (0%)', 'Preparing graphics (0%)'), 5);
  await nextPaint();

  const cleanup = scene.prewarm?.();
  if (device.type === 'desktop') {
    postfx.setBypass(false);
    renderer.setShadows(true);
    scene.setFlashlightShadow?.(false);
    scene.setHeadShadow?.(false);
    setLoadingStatus(warmLabel, tr('Компиляция: материалы мира (20%)', 'Compiling: world materials (20%)'), 20);
    await nextPaint();
    draw(0, 0, 0);

    scene.setFlashlightShadow?.(true);
    scene.setHeadShadow?.(false);
    setLoadingStatus(warmLabel, tr('Компиляция: фонарик и тени (40%)', 'Compiling: flashlight & shadows (40%)'), 40);
    await nextPaint();
    draw(0, 0, 0);

    scene.setHeadShadow?.(true);
    setLoadingStatus(warmLabel, tr('Компиляция: фары и двойные тени (60%)', 'Compiling: headlights & depth (60%)'), 60);
    await nextPaint();
    draw(0, 0, 0);

    // WebGLShadowMap renders before setupLights() populates lights.state.spotShadow, so a second
    // draw at 2 shadow-casting spots is needed to compile all MeshDepthMaterial variants at boot.
    scene.setHeadShadow?.(true);
    setLoadingStatus(warmLabel, tr('Компиляция: карты глубины (80%)', 'Compiling: shadow depth maps (80%)'), 80);
    await nextPaint();
    draw(0, 0, 0);

    renderer.setShadows(false);
    scene.setFlashlightShadow?.(false);
    scene.setHeadShadow?.(false);
    postfx.setBypass(true);
    setLoadingStatus(warmLabel, tr('Компиляция: режим без постобработки (95%)', 'Compiling: bypass pass (95%)'), 95);
    await nextPaint();
    draw(0, 0, 0);

    postfx.setBypass(level === 'low');
    renderer.setShadows(QUALITY_PRESETS[level].shadowMapSize > 0);
    scene.setFlashlightShadow?.(null);
    scene.setHeadShadow?.(null);
  } else {
    setLoadingStatus(warmLabel, tr('Компиляция: основные шейдеры (50%)', 'Compiling: core shaders (50%)'), 50);
    await nextPaint();
    draw(0, 0, 0);
    if (QUALITY_PRESETS[level].shadowMapSize > 0) {
      scene.setHeadShadow?.(true);
      setLoadingStatus(warmLabel, tr('Компиляция: тени (90%)', 'Compiling: shadows (90%)'), 90);
      await nextPaint();
      draw(0, 0, 0);
      scene.setHeadShadow?.(false);
    }
  }
  cleanup?.();
  applyGlobalSettings();
  events.emit('settings:changed', {});
  setLoadingStatus(warmLabel, tr('Готово (100%)', 'Ready (100%)'), 100);
  // Also the first real frame, drawn synchronously, so the game reports ready even when it boots into
  // a hard pause (portrait phone, hidden tab) — otherwise gameReady() would wait for rotation.
  draw(0, 0, 0);
  profiler.clearSpikes();
  console.info(`[boot] shaders warmed in ${Math.round(performance.now() - t0)} ms`);
  document.getElementById('loading')?.remove();
  platform.gameReady();

  wireLifecycle(ctx);
  loop.start();
  if (params.get('menu') === '0') {
    // Direct entry (after New Game reset or automated runs): open CharacterEditor if fresh.
    await scene.createCharacter?.();
  } else {
    mainMenu.open();
  }
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

const rotateEl = document.getElementById('rotate');
if (rotateEl) {
  const syncRotate = () => {
    rotateEl.textContent = tr('Поверните устройство горизонтально', 'Rotate your device to landscape');
  };
  syncRotate();
  onLangChange(syncRotate);
}

boot().catch((err: unknown) => {
  console.error(err);
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = tr('Не удалось запустить игру. Проверьте поддержку WebGL2.', 'Failed to start the game. Please check WebGL2 support.');
});
