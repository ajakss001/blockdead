import type { Scene, Vector3 } from 'three';
import { Rain } from '../render/Rain';
import { Snow } from '../render/Snow';
import { setSnowCover } from '../render/look/worldMaterials';
import { ATMO, between } from './atmoConfig';

const W = ATMO.weather;
const MAX_DROPS = 10;

/**
 * Weather as an event: now and then it rains for a few minutes (it comes on and dies away slowly), some
 * rains are storms — lightning lights the street for a moment, the thunder follows. Rain falls round the
 * camera outside, beads run on the "lens" when you look out into it, and it drowns your footsteps for the
 * zombies (the scene reads `rain`). Rates: atmoConfig.
 */
export class Weather {
  /** Strength now 0..1, and where it is heading. */
  rain = 0;
  /** Snowfall strength 0..1 and accumulated snow cover on ground & roofs 0..1. */
  snow = 0.72;
  snowAccum = 0.35;
  private snowTarget = 0.78;
  private target = 0;
  private storm = false;
  /** Lightning flash 0..1 (the scene brightens the world with it). */
  flash = 0;
  private time = 0;
  private checkT = 60;
  private endT = 0;
  private lastEnd = -1e9;
  private boltT = 0;
  private reflash = -1;
  private dropT = 0;
  private readonly rainMesh: Rain;
  private readonly snowMesh: Snow;
  private readonly drops: HTMLElement;

  constructor(
    scene: Scene,
    ui: HTMLElement,
    /** Thunder: `delay` s after the flash, `power` 0..1. */
    private readonly onThunder: (delay: number, power: number) => void,
  ) {
    this.rainMesh = new Rain(scene);
    this.snowMesh = new Snow(scene);
    setSnowCover(this.snowAccum);
    this.drops = document.createElement('div');
    this.drops.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0';
    ui.prepend(this.drops);
  }

  /** Start rain now (debug, tests). */
  startRain(storm = false): void {
    this.target = 0.7 + Math.random() * 0.3;
    this.endT = this.time + between(W.rainTime);
    this.storm = storm;
    this.boltT = 3;
  }

  /**
   * `outdoors`: under the open sky (rain shows, beads on the lens); `lookUp`: the camera's pitch (drops
   * only land when you look out level or up).
   */
  setSnowDensity(k: number): void {
    this.snowMesh.density = Math.max(0.15, Math.min(1, k));
  }

  update(dt: number, camera: Vector3, windX: number, windZ: number, outdoors: boolean, lookUp: number, paused: boolean): void {
    this.drops.style.display = paused ? 'none' : '';
    if (paused) return;
    this.time += dt;
    // The sky turns once a minute or so.
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 60;
      if (this.target === 0 && this.time - this.lastEnd > W.rainGap && Math.random() < W.rainChance) this.startRain(Math.random() < W.storm);
    }
    if (this.target > 0 && this.time > this.endT) {
      this.target = 0;
      this.lastEnd = this.time;
    }
    this.rain += Math.sign(this.target - this.rain) * Math.min(Math.abs(this.target - this.rain), dt / 40);
    // Gentle winter snowfall cycles and accumulates snow on ground, cars & roofs.
    this.snowTarget = this.rain > 0.25 ? 0 : 0.68 + 0.22 * Math.sin(this.time * 0.015);
    this.snow += Math.sign(this.snowTarget - this.snow) * Math.min(Math.abs(this.snowTarget - this.snow), dt / 18);
    if (this.snow > 0.1) this.snowAccum = Math.min(0.88, this.snowAccum + dt * 0.008 * this.snow);
    else if (this.rain > 0.2) this.snowAccum = Math.max(0, this.snowAccum - dt * 0.015 * this.rain);
    setSnowCover(this.snowAccum);

    // Lightning: a flash, a flicker after it, the thunder a few seconds later (nearer — sooner, louder).
    if (this.storm && this.rain > 0.4) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = between(W.lightning);
        this.flash = 1;
        this.reflash = 0.1 + Math.random() * 0.12;
        const delay = 0.5 + Math.random() * 3.5;
        this.onThunder(delay, 1 - delay / 5);
      }
    }
    if (this.reflash > 0) {
      this.reflash -= dt;
      if (this.reflash <= 0) this.flash = 0.7;
    }
    this.flash *= Math.exp(-dt * 9);

    this.rainMesh.update(this.time, this.rain, camera, windX * 0.6, windZ * 0.6, outdoors);
    this.snowMesh.update(this.time, this.snow, camera, windX, windZ, outdoors);
    // Beads on the lens.
    this.dropT -= dt;
    if (outdoors && this.rain > 0.2 && lookUp > -0.35 && this.dropT <= 0 && this.drops.childElementCount < MAX_DROPS) {
      this.dropT = (0.5 + Math.random()) / this.rain;
      this.bead();
    }
  }

  /** One drop on the lens: a soft bright blob that slides a little and fades. */
  private bead(): void {
    const d = document.createElement('div');
    const size = 14 + Math.random() * 30;
    const life = 1.5 + Math.random() * 1.5;
    d.style.cssText = `position:absolute;left:${Math.random() * 100}%;top:${Math.random() * 85}%;width:${size}px;height:${size * 1.15}px;border-radius:50%;background:radial-gradient(circle at 40% 35%,rgba(255,255,255,.28),rgba(200,210,220,.10) 55%,rgba(0,0,0,0) 72%);filter:blur(.6px);transition:opacity ${life}s ease-in,transform ${life}s ease-in;opacity:1`;
    this.drops.appendChild(d);
    requestAnimationFrame(() => {
      d.style.opacity = '0';
      d.style.transform = `translateY(${10 + Math.random() * 30}px)`;
    });
    window.setTimeout(() => d.remove(), life * 1000 + 100);
  }

  dispose(): void {
    this.rainMesh.dispose();
    this.snowMesh.dispose();
    this.drops.remove();
  }
}
