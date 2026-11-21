const WINDOW = 120;

export interface FrameStats {
  fps: number;
  frameAvgMs: number;
  frameP95Ms: number;
  cpuAvgMs: number;
}

/**
 * Frame timing over a rolling window (ring buffers, no per-frame allocation).
 * frame = interval between presented frames; cpu = main-thread work per frame.
 */
export class Profiler {
  private readonly frameMs = new Float32Array(WINDOW);
  private readonly cpuMs = new Float32Array(WINDOW);
  private readonly sortBuf = new Float32Array(WINDOW);
  private index = 0;
  private count = 0;
  private frameSum = 0;
  private cpuSum = 0;

  private readonly sectionStart = new Map<string, number>();
  /** Exponential moving average per named section, ms. */
  readonly sections = new Map<string, number>();
  /** Raw duration of the last occurrence of each section, ms (spike diagnostics). */
  readonly last = new Map<string, number>();
  /** Most recent frames that took over 40 ms, newest last. */
  readonly spikes: string[] = [];
  spikeCount = 0;

  noteSpike(line: string): void {
    this.spikeCount++;
    this.spikes.push(line);
    if (this.spikes.length > 4) this.spikes.shift();
  }

  record(frameMs: number, cpuMs: number): void {
    const i = this.index;
    this.frameSum += frameMs - this.frameMs[i];
    this.cpuSum += cpuMs - this.cpuMs[i];
    this.frameMs[i] = frameMs;
    this.cpuMs[i] = cpuMs;
    this.index = (i + 1) % WINDOW;
    if (this.count < WINDOW) this.count++;
  }

  begin(section: string): void {
    this.sectionStart.set(section, performance.now());
  }

  end(section: string): void {
    const start = this.sectionStart.get(section);
    if (start === undefined) return;
    const ms = performance.now() - start;
    this.last.set(section, ms);
    const prev = this.sections.get(section);
    this.sections.set(section, prev === undefined ? ms : prev * 0.9 + ms * 0.1);
  }

  get sampleCount(): number {
    return this.count;
  }

  get frameAvgMs(): number {
    return this.count ? this.frameSum / this.count : 0;
  }

  get cpuAvgMs(): number {
    return this.count ? this.cpuSum / this.count : 0;
  }

  /** Allocation-free, but sorts the window: call at UI rate (a few Hz), not every frame. */
  stats(out: FrameStats): FrameStats {
    const avg = this.frameAvgMs;
    out.frameAvgMs = avg;
    out.cpuAvgMs = this.cpuAvgMs;
    out.fps = avg > 0 ? 1000 / avg : 0;
    const n = this.count;
    if (n === 0) {
      out.frameP95Ms = 0;
      return out;
    }
    const view = this.sortBuf.subarray(0, n);
    view.set(this.frameMs.subarray(0, n));
    view.sort();
    out.frameP95Ms = view[Math.min(n - 1, Math.floor(n * 0.95))];
    return out;
  }

  /** Drop history, e.g. after the tab was hidden or quality changed. */
  reset(): void {
    this.frameMs.fill(0);
    this.cpuMs.fill(0);
    this.index = 0;
    this.count = 0;
    this.frameSum = 0;
    this.cpuSum = 0;
  }
}
