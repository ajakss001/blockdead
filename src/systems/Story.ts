import { sfx } from '../audio/Sound';
import { tr } from '../core/i18n';
import { type ItemId, ITEMS } from '../data/items';
import type { ContainerRef, Containers } from './Containers';
import type { Inventory } from './Inventory';
import type { MapMemory } from './MapMemory';
import { CHUNK, type WorldLayout } from '../world/gen/layout';
import { nearestPoi, POI, type PoiKind, type PoiSite, siteToWorld } from '../world/gen/poi';

export type StoryStage = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface StorySave {
  stage: StoryStage;
  target?: [number, number, PoiKind];
  holdTimer?: number;
  completed?: boolean;
}

export interface StoryHudState {
  act: string;
  objective: string;
  distance: string;
  urgent?: boolean;
  done?: boolean;
}

export interface StoryBriefing {
  code: string;
  title: string;
  body: string[];
  footer: string;
}

const HOLDOUT_SECONDS = 90;
const WAVE_INTERVAL = 12;

/**
 * 4-Act Story Mode: «Протокол „Рассвет“» (Protocol "Dawn").
 * Guides the survivor across the procedural city's key POIs:
 *   Act I   (Stage 0) -> Police Station (decryptor & Helios coordinates)
 *   Act II  (Stage 1) -> Helios Research Institute (restore generator power)
 *   Act II  (Stage 2) -> Helios Server/Containment (retrieve "Helios-0" sample)
 *   Act III (Stage 3) -> Military Base (retrieve high-gain military transponder)
 *   Act IV  (Stage 4) -> Airport (activate extraction beacon on the runway)
 *   Finale  (Stage 5) -> 90-second holdout at the Airport against incoming hordes
 *   Victory (Stage 6) -> Extraction helicopter arrives (Victory screen + Freeplay)
 */
export class StorySystem {
  stage: StoryStage = 0;
  target: { x: number; z: number; kind: PoiKind } | null = null;
  holdTimer = HOLDOUT_SECONDS;
  completed = false;
  private waveTimer = 2;
  private hudTimer = 0;

  constructor(
    private readonly layout: WorldLayout,
    private readonly memory: MapMemory,
    private readonly inventory: Inventory,
    private readonly containers: Containers,
    private readonly hooks: {
      toast(text: string, ms?: number): void;
      showBriefing(b: StoryBriefing): void;
      showVictory(): void;
      onWave(x: number, z: number): void;
      isLabPowered(x: number, z: number): boolean;
    },
  ) {}

  /** Initialize story on a fresh world or after loading a save. */
  init(px: number, pz: number, saved?: StorySave): void {
    if (saved) {
      this.stage = saved.stage ?? 0;
      this.holdTimer = saved.holdTimer ?? HOLDOUT_SECONDS;
      this.completed = saved.completed ?? this.stage >= 6;
      if (saved.target) {
        this.target = { x: saved.target[0], z: saved.target[1], kind: saved.target[2] };
      }
    }
    if (!this.target && this.stage < 6) {
      this.pickTargetForStage(px, pz);
    }
    if (this.target) {
      this.revealTarget(this.target.x, this.target.z);
    }
  }

  serialize(): StorySave {
    return {
      stage: this.stage,
      target: this.target ? [Math.round(this.target.x), Math.round(this.target.z), this.target.kind] : undefined,
      holdTimer: Math.round(this.holdTimer),
      completed: this.completed || undefined,
    };
  }

  private pickTargetForStage(px: number, pz: number): void {
    const want: PoiKind | null =
      this.stage === 0
        ? 'police'
        : this.stage === 1 || this.stage === 2
          ? 'lab'
          : this.stage === 3
            ? 'base'
            : this.stage === 4 || this.stage === 5
              ? 'airport'
              : null;
    if (!want) {
      this.target = null;
      return;
    }
    const ci = Math.floor(px / CHUNK);
    const cj = Math.floor(pz / CHUNK);
    const site = nearestPoi(this.layout, want, ci, cj, 48);
    if (site) {
      const [wx, wz] = this.siteCenter(site);
      this.target = { x: wx, z: wz, kind: want };
      this.revealTarget(wx, wz);
    }
  }

  private siteCenter(site: PoiSite): [number, number] {
    return siteToWorld(site, 0, 0);
  }

  private revealTarget(x: number, z: number): void {
    this.memory.explore(x, z, 72);
  }

  /** Give a quest item into the searched container (or directly into the backpack if needed). */
  private grantQuestItem(ref: ContainerRef | null, id: ItemId): void {
    if (this.inventory.count(id) > 0) return;
    if (ref) {
      const items = this.containers.contents(ref);
      if (!items.some((s) => s.id === id)) {
        items.unshift({ id, count: 1 });
      }
    } else {
      if (this.inventory.room(id) < 1) this.inventory.capacity += ITEMS[id].weight;
      this.inventory.add(id, 1);
    }
  }

  /** Called when the player opens/searches any container. */
  onContainerSearch(ref: ContainerRef, px: number, pz: number): void {
    const i = Math.floor(ref.x / CHUNK);
    const j = Math.floor(ref.z / CHUNK);
    const site = this.layout.poi(i, j);

    // Stage 0 -> Act I: Searching at the Police Station
    if (this.stage === 0 && (site?.kind === 'police' || ref.type === 'policeDesk' || ref.type === 'armory')) {
      this.grantQuestItem(ref, 'storyScanner');
      this.advanceTo(1, px, pz);
      if (this.target && this.hooks.isLabPowered(this.target.x, this.target.z)) {
        this.stage = 2;
      }
      this.hooks.showBriefing({
        code: tr('ПЕРЕХВАТ СВЯЗИ // УЧАСТОК №4', 'COMMS INTERCEPT // PRECINCT #4'),
        title: tr('Акт I: Источник заражения', 'Act I: Outbreak Source'),
        body: [
          tr(
            'В дежурной части найден полицейский дешифратор с последней сводкой штаба ГО.',
            'A police decryptor with the final Civil Defense dispatch was found in the precinct.',
          ),
          tr(
            '«Колонны на мостах уничтожены. Вспышка началась после аварии в закрытом НИИ „Гелиос“ за городом. Группа эвакуации „Рассвет“ ждёт данные нулевого штамма из изолятора НИИ — без них борт не пришлют.»',
            '"Bridge convoys destroyed. The outbreak began after a containment breach at the classified Helios Research Institute outside town. Extraction team \'Dawn\' requires the strain-zero data from Helios containment — no chopper will be sent without it."',
          ),
        ],
        footer: tr('Координаты НИИ «Гелиос» нанесены на вашу карту [M].', 'Coordinates of Helios Research Institute marked on your map [M].'),
      });
      return;
    }

    // Stage 1 -> If player searches inside Helios Lab while generator is already on
    if (this.stage === 1 && site?.kind === 'lab' && this.hooks.isLabPowered(ref.x, ref.z)) {
      this.stage = 2;
    }

    // Stage 2 -> Act II: Searching inside powered Helios Lab (especially serverRack / isolation / labFridge)
    if (
      this.stage === 2 &&
      (site?.kind === 'lab' || ref.type === 'isolation' || ref.type === 'serverRack' || ref.type === 'labFridge')
    ) {
      this.grantQuestItem(ref, 'storySample');
      this.grantQuestItem(ref, 'serumG7');
      this.advanceTo(3, px, pz);
      this.hooks.showBriefing({
        code: tr('АРХИВ НИИ «ГЕЛИОС» // СЕКТОР БИОЗАЩИТЫ', 'HELIOS ARCHIVE // BIO-CONTAINMENT SECTOR'),
        title: tr('Акт II: Контейнер «Гелиос-0»', 'Act II: Container "Helios-0"'),
        body: [
          tr(
            'Вы забрали криокапсулу «Гелиос-0» с исходным образцом грибкового штамма Г-7 и журналы лаборатории.',
            'You retrieved cryo-capsule "Helios-0" containing the original G-7 fungal strain sample and lab logs.',
          ),
          tr(
            'В распечатке с сервера указана резервная частота эвакуации, но гражданские рации её не пробьют. Нужен армейский транспондер дальней связи — такие остались на Военной базе.',
            'The server printout lists the backup extraction frequency, but civilian radios cannot reach it. You need a long-range military transponder from the Military Base.',
          ),
        ],
        footer: tr('Координаты Военной базы нанесены на карту [M].', 'Military Base coordinates marked on your map [M].'),
      });
      return;
    }

    // Stage 3 -> Act III: Searching at the Military Base
    if (this.stage === 3 && (site?.kind === 'base' || site?.kind === 'checkpoint' || ref.type === 'militaryCrate' || ref.type === 'baseArmory')) {
      this.grantQuestItem(ref, 'storyTransponder');
      this.grantQuestItem(ref, 'ration');
      this.advanceTo(4, px, pz);
      this.hooks.showBriefing({
        code: tr('ШИФРОГРАММА // ГАРНИЗОН «СЕВЕР»', 'CIPHER // GARRISON "NORTH"'),
        title: tr('Акт III: Протокол «Рассвет»', 'Act III: Protocol "Dawn"'),
        body: [
          tr(
            'Военный транспондер у вас. На индикаторе мигает зелёный канал дежурного авиазвена за периметром карантина.',
            'You secured the military transponder. The indicator flashes green on the standby air-wing channel outside the quarantine perimeter.',
          ),
          tr(
            '«Всем уцелевшим группам с допуском „Гелиос“: единственная полоса подскока — городской Аэропорт. Активируйте приводной маяк на перроне и удерживайте периметр 90 секунд до посадки борта.»',
            '"To all surviving units with Helios clearance: the only extraction strip is the municipal Airport. Activate the runway homing beacon and hold the perimeter for 90 seconds until touchdown."',
          ),
        ],
        footer: tr('Аэропорт отмечен на карте [M]. Приготовьте оружие и патроны перед включением маяка.', 'Airport marked on your map [M]. Prepare weapons and ammo before activating the beacon.'),
      });
      return;
    }
  }

  /** Called when the player starts a laboratory generator. */
  onPowerLab(x: number, z: number): void {
    if (this.stage === 1 || this.stage === 0) {
      this.stage = 2;
      this.target = { x, z, kind: 'lab' };
      this.hooks.toast(
        tr('Питание подано! Обыщите серверную или изолятор НИИ «Гелиос»', 'Power restored! Search the server room or containment in Helios Lab'),
        3200,
      );
    }
  }

  private advanceTo(next: StoryStage, px: number, pz: number): void {
    this.stage = next;
    sfx.item('pick');
    this.pickTargetForStage(px, pz);
  }

  /** Interactive prompt at the Airport when ready to start the final holdout. */
  spotAt(px: number, pz: number): { text: string; act: boolean; run(): void } | null {
    if (this.stage !== 4) return null;
    const i = Math.floor(px / CHUNK);
    const j = Math.floor(pz / CHUNK);
    const site = this.layout.poi(i, j);
    const nearTarget = this.target && Math.hypot(px - this.target.x, pz - this.target.z) < 34;
    if (site?.kind !== 'airport' && !nearTarget) return null;
    return {
      text: tr('Активировать маяк эвакуации «Рассвет» (начнётся штурм!)', 'Activate extraction beacon "Dawn" (triggers horde!)'),
      act: true,
      run: () => this.startHoldout(px, pz),
    };
  }

  private startHoldout(px: number, pz: number): void {
    if (this.stage !== 4) return;
    this.stage = 5;
    this.holdTimer = HOLDOUT_SECONDS;
    this.waveTimer = 1.5;
    if (!this.target) this.target = { x: px, z: pz, kind: 'airport' };
    sfx.item('invOpen');
    this.hooks.toast(
      tr('Маяк «Рассвет» включён! Продержитесь 90 секунд до прилёта вертолёта!', 'Beacon "Dawn" active! Hold out for 90 seconds until chopper arrival!'),
      4000,
    );
    this.hooks.onWave(px, pz);
  }

  /** Per-frame/step update: checks inventory milestones, runs Stage 5 holdout timer, and builds HUD state. */
  update(dt: number, px: number, pz: number, pyaw: number): StoryHudState {
    // Allow progression if the player picked up the quest item from a twin body or stash
    if (this.stage === 0 && this.inventory.count('storyScanner') > 0) {
      this.advanceTo(1, px, pz);
    } else if (this.stage === 1 && this.target && this.hooks.isLabPowered(this.target.x, this.target.z)) {
      this.stage = 2;
    } else if ((this.stage === 1 || this.stage === 2) && this.inventory.count('storySample') > 0) {
      this.advanceTo(3, px, pz);
    } else if (this.stage === 3 && this.inventory.count('storyTransponder') > 0) {
      this.advanceTo(4, px, pz);
    }

    if (this.stage === 5) {
      const distToAirport = this.target ? Math.hypot(px - this.target.x, pz - this.target.z) : 0;
      const inZone = distToAirport <= 75;
      if (inZone) {
        this.holdTimer = Math.max(0, this.holdTimer - dt);
        this.waveTimer -= dt;
        if (this.waveTimer <= 0) {
          this.waveTimer = WAVE_INTERVAL;
          this.hooks.onWave(px, pz);
        }
        if (this.holdTimer <= 0) {
          this.stage = 6;
          this.completed = true;
          this.target = null;
          this.hooks.showVictory();
        }
      }
    }

    this.hudTimer -= dt;
    return this.buildHudState(px, pz, pyaw);
  }

  private buildHudState(px: number, pz: number, pyaw: number): StoryHudState {
    if (this.stage === 6) {
      return {
        act: tr('ПРОТОКОЛ «РАССВЕТ»', 'PROTOCOL "DAWN"'),
        objective: tr('Эвакуация завершена · Свободное выживание', 'Extraction complete · Free survival'),
        distance: '✓',
        done: true,
      };
    }

    if (this.stage === 5) {
      const sec = Math.ceil(this.holdTimer);
      const mm = String(Math.floor(sec / 60)).padStart(2, '0');
      const ss = String(sec % 60).padStart(2, '0');
      const dist = this.target ? Math.hypot(px - this.target.x, pz - this.target.z) : 0;
      const out = dist > 75;
      return {
        act: tr(`ЭВАКУАЦИЯ · ${mm}:${ss}`, `EXTRACTION · ${mm}:${ss}`),
        objective: out
          ? tr('Вернитесь в периметр Аэропорта!', 'Return to the Airport perimeter!')
          : tr('Удерживайте зону посадки — маяк привлекает орду', 'Hold the landing zone — beacon draws the horde'),
        distance: `${mm}:${ss}`,
        urgent: true,
      };
    }

    const acts: Record<0 | 1 | 2 | 3 | 4, [string, string]> = {
      0: [
        tr('АКТ I · ТОЧКА НЕВОЗВРАТА', 'ACT I · POINT OF NO RETURN'),
        tr('Добраться до Полицейского участка и обыскать терминалы', 'Reach the Police Station and search the terminals'),
      ],
      1: [
        tr('АКТ II · СЕКРЕТ «ГЕЛИОСА»', 'ACT II · SECRET OF HELIOS'),
        tr('Найти НИИ «Гелиос» и запустить генератор (3 предохранителя)', 'Find Helios Lab and start the generator (3 fuses)'),
      ],
      2: [
        tr('АКТ II · ШТАММ «ГЕЛИОС-0»', 'ACT II · STRAIN "HELIOS-0"'),
        tr('Обыскать серверную или изолятор НИИ и забрать образец', 'Search Helios server room or containment for the sample'),
      ],
      3: [
        tr('АКТ III · ВОЕННАЯ ЧАСТОТА', 'ACT III · MILITARY FREQUENCY'),
        tr('Пробиться на Военную базу и найти военный транспондер', 'Reach the Military Base and find the military transponder'),
      ],
      4: [
        tr('АКТ IV · ПРОТОКОЛ «РАССВЕТ»', 'ACT IV · PROTOCOL "DAWN"'),
        tr('Прибыть в Аэропорт и активировать маяк эвакуации [E]', 'Reach the Airport and activate the extraction beacon [E]'),
      ],
    };

    const [act, objective] = acts[this.stage as 0 | 1 | 2 | 3 | 4];
    let distance = '';
    if (this.target) {
      const dx = this.target.x - px;
      const dz = this.target.z - pz;
      const d = Math.round(Math.hypot(dx, dz));
      // Relative angle from player's view direction (-sin(yaw), -cos(yaw))
      const worldAngle = Math.atan2(dx, -dz);
      const rel = Math.atan2(Math.sin(worldAngle + pyaw), Math.cos(worldAngle + pyaw));
      const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
      const idx = (Math.round((rel / (Math.PI * 2)) * 8) + 8) % 8;
      const place = POI[this.target.kind].name;
      distance = d < 28 ? `${place} · ${tr('рядом', 'here')}` : `${d} ${tr('м', 'm')} ${arrows[idx]}`;
    }

    return { act, objective, distance };
  }
}
