import type { FrameStats } from '../core/Profiler';
import type { QualityLevel } from '../core/types';
import type { GameContext } from '../GameContext';
import type { RenderStats } from '../render/Renderer';
import { QUALITY_LEVELS } from '../render/QualityPresets';

const REFRESH_MS = 250;

interface StressConfig {
  instances: number;
  meshes: number;
}

/**
 * Developer overlay. Toggle: ` or F3 on keyboard, three-finger tap on touch.
 * Visible by default in dev builds or with ?debug=1.
 */
export class DebugPanel {
  private readonly root = document.createElement('div');
  private readonly text = document.createElement('pre');
  private readonly status = document.createElement('div');
  private readonly frame: FrameStats = { fps: 0, frameAvgMs: 0, frameP95Ms: 0, cpuAvgMs: 0 };
  private readonly gpu: RenderStats = {
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    bufferWidth: 0,
    bufferHeight: 0,
    pixelRatio: 0,
  };
  private stress: StressConfig = { instances: 400, meshes: 0 };

  constructor(
    private readonly ctx: GameContext,
    parent: HTMLElement,
  ) {
    this.root.className = 'debug';
    this.root.hidden = !(import.meta.env.DEV || new URLSearchParams(location.search).has('debug'));
    this.root.append(this.text, this.buildControls(), this.status);
    parent.append(this.root);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F3') {
        e.preventDefault();
        this.root.hidden = !this.root.hidden;
      }
    });
    window.addEventListener('touchstart', (e) => {
      if (e.touches.length === 3) this.root.hidden = !this.root.hidden;
    });
    setInterval(() => this.refresh(), REFRESH_MS);
  }

  private buildControls(): HTMLElement {
    const { quality, events, platform } = this.ctx;
    const wrap = document.createElement('div');
    wrap.className = 'debug__controls';

    this.row(wrap, 'Качество', [
      ...QUALITY_LEVELS.map((lvl: QualityLevel) => ({ label: lvl, onClick: () => quality.setLevel(lvl) })),
      {
        label: 'adaptive',
        onClick: (btn: HTMLButtonElement) => {
          quality.adaptive = !quality.adaptive;
          btn.classList.toggle('off', !quality.adaptive);
        },
      },
    ]);

    const setStress = (patch: Partial<StressConfig>) => {
      this.stress = { ...this.stress, ...patch };
      events.emit('debug:stress', this.stress);
    };
    this.row(
      wrap,
      'Инстансы',
      [0, 400, 5000, 20000].map((n) => ({ label: String(n), onClick: () => setStress({ instances: n }) })),
    );
    this.row(
      wrap,
      'Draw calls',
      [0, 100, 300, 500].map((n) => ({ label: `+${n}`, onClick: () => setStress({ meshes: n }) })),
    );
    this.row(wrap, 'Реклама', [
      {
        label: 'interstitial',
        onClick: async () => {
          this.status.textContent = `interstitial: ${await platform.showInterstitial()}`;
        },
      },
      {
        label: 'rewarded',
        onClick: async () => {
          this.status.textContent = `rewarded: ${(await platform.showRewarded()) ? 'награда выдана' : 'без награды'}`;
        },
      },
    ]);
    return wrap;
  }

  private row(
    parent: HTMLElement,
    title: string,
    buttons: { label: string; onClick: (btn: HTMLButtonElement) => void }[],
  ): void {
    const row = document.createElement('div');
    const label = document.createElement('span');
    label.textContent = title;
    row.append(label);
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.addEventListener('click', () => b.onClick(btn));
      row.append(btn);
    }
    parent.append(row);
  }

  private refresh(): void {
    if (this.root.hidden) return;
    const { profiler, renderer, quality, device, platform, loop } = this.ctx;
    const f = profiler.stats(this.frame);
    const g = renderer.stats(this.gpu);
    const p = quality.preset;
    this.text.textContent = [
      `FPS ${f.fps.toFixed(1)}  frame ${f.frameAvgMs.toFixed(1)}ms (p95 ${f.frameP95Ms.toFixed(1)})  cpu ${f.cpuAvgMs.toFixed(2)}ms`,
      `draw ${g.drawCalls}  tris ${(g.triangles / 1000).toFixed(1)}k  geo ${g.geometries}  tex ${g.textures}`,
      `quality ${p.level}${quality.adaptive ? ' (auto)' : ''}  scale ${quality.resolutionScale.toFixed(2)}  dpr ${g.pixelRatio.toFixed(2)}  ${g.bufferWidth}×${g.bufferHeight}`,
      `cap ${loop.targetFps}fps  fog ${p.fogFar}m  chunks r${p.chunkRadius}`,
      `GPU ${renderer.gpuName}`,
      `${device.type}  ${device.cores || '?'} cores  ${device.memoryGb || '?'} GB  touch ${device.touch}  platform ${platform.id}`,
    ].join('\n');
  }
}
