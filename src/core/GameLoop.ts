import type { EventBus } from './EventBus';
import type { GameEvents } from './events';
import type { Profiler } from './Profiler';
import type { PauseReason } from './types';

export interface LoopCallbacks {
  /** Deterministic simulation step (physics, AI, stats). dt is constant. */
  fixedUpdate(dt: number): void;
  /**
   * Called once per presented frame. alpha ∈ [0,1) is the interpolation factor between
   * the last two fixed steps; frameDt is real seconds since the previous frame.
   * Camera look must be applied here, not in fixedUpdate, to avoid input lag.
   */
  render(alpha: number, frameDt: number): void;
}

const HARD_REASONS: ReadonlySet<PauseReason> = new Set<PauseReason>(['hidden', 'ad', 'orientation', 'context']);
const MAX_STEPS_PER_FRAME = 5;
/** rAF timestamps jitter; accept frames that arrive slightly early. */
const CAP_TOLERANCE_MS = 1.0;
const STALL_MS = 250;

export class GameLoop {
  readonly fixedDt = 1 / 60;
  /** Frame cap. 60 keeps 90/120 Hz phones from overheating. 0 = uncapped. */
  targetFps = 60;

  private accumulator = 0;
  private lastFrame = 0;
  private lastPresented = 0;
  private rafId = 0;
  private running = false;
  private readonly reasons = new Set<PauseReason>();

  constructor(
    private readonly callbacks: LoopCallbacks,
    private readonly profiler: Profiler,
    private readonly events: EventBus<GameEvents>,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.syncRaf();
  }

  stop(): void {
    this.running = false;
    this.syncRaf();
  }

  pause(reason: PauseReason): void {
    if (this.reasons.has(reason)) return;
    this.reasons.add(reason);
    this.events.emit('loop:pause', { reason });
    this.syncRaf();
  }

  resume(reason: PauseReason): void {
    if (!this.reasons.delete(reason)) return;
    this.events.emit('loop:resume', { reason });
    this.syncRaf();
  }

  /** Simulation halted (soft or hard pause). Rendering continues on soft pause (menus). */
  get paused(): boolean {
    return this.reasons.size > 0;
  }

  private get hardPaused(): boolean {
    for (const r of this.reasons) if (HARD_REASONS.has(r)) return true;
    return false;
  }

  private syncRaf(): void {
    const shouldRun = this.running && !this.hardPaused;
    if (shouldRun && this.rafId === 0) {
      const now = performance.now();
      this.lastFrame = now;
      this.lastPresented = now;
      this.accumulator = 0;
      this.profiler.reset();
      this.rafId = requestAnimationFrame(this.tick);
    } else if (!shouldRun && this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private readonly tick = (now: number): void => {
    this.rafId = requestAnimationFrame(this.tick);

    if (this.targetFps > 0) {
      const minInterval = 1000 / this.targetFps;
      const sinceLast = now - this.lastFrame;
      if (sinceLast + CAP_TOLERANCE_MS < minInterval) return;
      // Carry the remainder (negative when accepted early) so the average interval is exactly
      // minInterval, and 90 Hz displays average ~60 instead of dropping to 45.
      this.lastFrame = now - Math.min(Math.max(sinceLast - minInterval, -CAP_TOLERANCE_MS), minInterval);
    } else {
      this.lastFrame = now;
    }

    const cpuStart = performance.now();
    const frameMs = now - this.lastPresented;
    this.lastPresented = now;
    const frameDt = Math.min(frameMs / 1000, 0.25);

    if (!this.paused) {
      this.accumulator += frameDt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < MAX_STEPS_PER_FRAME) {
        this.callbacks.fixedUpdate(this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps++;
      }
      // Spiral-of-death guard: drop the backlog instead of trying to catch up.
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    this.callbacks.render(this.accumulator / this.fixedDt, frameDt);
    // Stalls (throttled off-screen iframe, debugger, tab switch) say nothing about our
    // rendering cost; recording them would make QualityManager downgrade for no reason.
    if (frameMs < STALL_MS) this.profiler.record(frameMs, performance.now() - cpuStart);
  };
}
