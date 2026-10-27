# BlockDead — архитектура (рабочее название)

Документ — «память проекта» между этапами. В каждый новый этап в контекст подгружается
этот файл + интерфейсы нужных модулей, а не их реализация.

## Зафиксированные решения

| Решение | Значение |
|---|---|
| Стек | TypeScript + Vite + Three.js, UI на DOM/CSS (без React) |
| Цель FPS | **60 FPS на мобильных** (кап 60 на 90/120 Гц экранах), 60 на ПК |
| Мир | «2.5D-воксели»: рельеф из колонн + модульные здания; без строительства блоками в MVP (только баррикады) |
| Смерть | Мягкий пермадес: теряется персонаж и рюкзак, остаются перки/рецепты/часть сундука убежища |
| Ориентация | Только ландшафтная на мобильных (в портрете — заглушка «поверните устройство») |
| Платформы | Яндекс.Игры, VK Игры — через абстракцию `IPlatform` |

## Бюджет кадра (60 FPS = 16.6 мс)

| Подсистема | Бюджет (главный поток) |
|---|---|
| Рендер (CPU-сторона, draw calls) | ≤ 6 мс |
| ИИ + бой + коллизии | ≤ 4 мс (time-slicing ИИ) |
| Стриминг чанков | ≤ 1.5 мс (1 чанк/кадр max) |
| UI / прочее | ≤ 1 мс |
| Запас на GC/драйвер/браузер | ~4 мс |

Лимиты сцены: **≤ 100 draw calls**, **≤ 150k треугольников** (Low), без shadow maps на мобильных,
без постпроцессинга на мобильных.

## Пресеты качества (src/render/QualityPresets.ts)

| | low | medium | high |
|---|---|---|---|
| Радиус чанков (16 м) | 3 | 4 | 7 |
| Дальность тумана | 50 м | 66 м | 115 м |
| Масштаб разрешения (мин–макс) | 0.6–0.85 | 0.7–1.0 | 0.85–1.0 |
| Потолок devicePixelRatio | 1.0 | 1.5 | 2.0 |
| Зомби активных / видимых | 20 / 30 | 35 / 50 | 60 / 100 |
| Частота ИИ дальних зомби | 4 Гц | 6 Гц | 10 Гц |
| Тени | блоб | блоб | shadow map |
| Антиалиасинг | нет | нет | да |

Адаптивность: `QualityManager` следит за средним интервалом кадра. Просадка → сначала
снижаем масштаб разрешения шагами 0.05, на минимуме — понижаем пресет. Повышение — только
масштаба разрешения и с задержкой (пресет вверх автоматически не поднимаем — без «качелей»).

## Слои и модули

```
src/
  GameContext.ts  типизированный набор сервисов (events, loop, profiler, platform, renderer, quality, device)
  main.ts         bootstrap + жизненный цикл (visibility, реклама, ориентация, потеря GL-контекста)
  core/       GameLoop, EventBus, Pool, Profiler, device, random (mulberry32), scratch-векторы
  platform/   IPlatform → MockPlatform | (YandexPlatform | VKPlatform — этап 6), createPlatform
  input/      (этап 1) IInputSource → KeyboardMouse | Touch → InputState
  render/     Renderer, QualityManager, QualityPresets, DeviceProfile, (ViewmodelPass — этап 1)
  world/      (этап 2) Noise, ZoneMap, ChunkManager, генераторы, workers/
  entities/   (этапы 1,3,4) Player, Zombie, Container, Item
  systems/    (этапы 3–5) Stats, Noise, AI, Combat, Loot, Inventory, DayNight, Save
  ui/         HUD, инвентарь, оверлеи (DOM/CSS поверх canvas)
  debug/      DebugPanel
  scenes/     IScene + сцены (TestScene — этап 0)
  data/       (этап 3) JSON: предметы, лут-таблицы, зоны, баланс
```

Зависимости строго сверху вниз: `scenes → systems → entities → world/render/input → platform → core`.
`core` не импортирует ничего, кроме three.

## Контракты (кратко)

### core
- `GameLoop` — fixed timestep симуляции **60 Гц** (`fixedUpdate(dt)`), переменный `render(alpha, frameDt)`.
  Кап частоты rAF до `targetFps`. Clamp долгих кадров (вкладка в фоне) — не больше 5 шагов за кадр.
  Пауза/резюм через `pause(reason)`/`resume(reason)` — пауза держится, пока есть хоть одна причина
  (`'hidden' | 'ad' | 'menu'`).
  **Важно:** поворот камеры (look) применяется в `render` (частота кадра), а не в `fixedUpdate` — иначе инпут-лаг.
- `EventBus<GameEvents>` — типизированные события, `on/off/emit`. Карта событий — `core/events.ts`.
- `Pool<T>` — пул объектов: `acquire()/release()`, без аллокаций в горячем цикле.
- `Profiler` — кольцевые буферы интервалов кадра и CPU-времени, `begin(section)/end(section)`.
- `GameContext` (src/GameContext.ts) — типизированный контейнер сервисов, передаётся в сцены/системы (вместо глобалов).
- Кадры длиннее 250 мс (троттлинг iframe, отладчик) в профайлер не пишутся — иначе ложная деградация качества.
- Первый кадр рисуется синхронно при загрузке, затем `gameReady()` — даже если игра стартует в портрете/скрытой вкладке.

### platform
```ts
interface IPlatform {
  readonly id: 'mock' | 'yandex' | 'vk';
  init(): Promise<void>;
  gameReady(): void;               // Яндекс LoadingAPI.ready() — после первого кадра
  gameplayStart(): void; gameplayStop(): void;
  showInterstitial(): Promise<AdResult>;
  showRewarded(): Promise<boolean>; // true — награду выдавать
  save(data: SaveBlob): Promise<void>;
  load(): Promise<SaveBlob | null>;
  getLanguage(): string;
  getDeviceType(): 'mobile' | 'tablet' | 'desktop';
}
```
Во время рекламы платформа эмитит `ad:start` / `ad:end` → цикл ставится на паузу, звук глушится.

## Конвенции производительности

1. **Ноль аллокаций в кадре.** Никаких `new Vector3()` в update — используем `core/scratch.ts`
   или поля класса. Никаких замыканий/массивов в горячем цикле.
2. Один материал + атлас текстур для мира; цвета/AO — в атрибутах вершин.
3. Повторяющиеся объекты — только `InstancedMesh`.
4. Всё, что выгружается, — через `dispose()` или возврат в пул.
5. Тяжёлая генерация — в Web Worker, передача через transferable `ArrayBuffer`.
6. Баланс и контент — в `data/*.json`, не в коде.

## Статус этапов

| # | Этап | Статус |
|---|---|---|
| 0 | Фундамент | ✅ |
| 1 | Игрок и тело от первого лица | ⏳ |
| 2 | Процедурный мир | — |
| 3 | Выживание и инвентарь | — |
| 4 | Зомби, ИИ, бой | — |
| 5 | Игровой цикл и мета | — |
| 6 | Интеграция с площадками и релиз | — |
