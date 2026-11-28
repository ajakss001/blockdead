import { DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import type { ItemId, WearSlot } from '../data/items';
import type { Appearance } from '../player/appearance';
import { CharacterFigure } from '../player/CharacterFigure';
import type { Worn } from '../systems/Inventory';
import { isGun, type ModId } from '../weapons/guns';

/** Drag: radians per CSS pixel; spin keeps a little inertia after release. */
const DRAG_SPEED = 0.012;
const SPIN_DAMPING = 5;
/** Camera: level with the middle of the body, framing head to shoes. */
const FRAME_HEIGHT = 2.05;

/**
 * Tarkov-style 3D survivor in the inventory and the character editor: stands upright, turns only
 * about its vertical axis when dragged (mouse or finger), shows exactly what is worn and held.
 *
 * Cost: its own small canvas and WebGL context, created on the first opening; it renders only while
 * its screen is open and only when something changed (rotation, clothes, looks).
 */
export class CharacterPreview {
  readonly canvas = document.createElement('canvas');
  readonly figure = new CharacterFigure();
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(28, 0.5, 0.1, 30);
  /** The figure faces +Z (the camera); start turned three-quarters so weapon stance, grip, and pack are visible. */
  private yaw = -0.55;
  private spin = 0;
  private dragX: number | null = null;
  private active = false;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private height = 1.76;
  private holdingGun = false;

  constructor(className = 'inv__doll') {
    this.figure.onChange = () => (this.dirty = true);
    this.canvas.className = className;
    this.canvas.style.touchAction = 'none';
    this.scene.add(new HemisphereLight(0xc8ccd8, 0x2a2622, 1.6));
    const key = new DirectionalLight(0xfff2dc, 2.2);
    key.position.set(1.5, 2.5, 2.5);
    const rim = new DirectionalLight(0x8aa0c8, 1.2);
    rim.position.set(-2, 1.5, -2);
    this.scene.add(key, rim, this.figure.root);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      this.spin = 0;
      this.canvas.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      const dx = e.clientX - this.dragX;
      this.dragX = e.clientX;
      this.yaw += dx * DRAG_SPEED;
      this.spin = dx * DRAG_SPEED * 60;
      this.dirty = true;
      e.stopPropagation();
    });
    const up = (e: PointerEvent) => {
      this.dragX = null;
      e.stopPropagation();
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  /** Dress the figure; cheap to call on every redraw. */
  setOutfit(worn: Worn, hand: ItemId | null, dirt?: Record<WearSlot, number>, tint?: Partial<Record<WearSlot, number>>, handMods?: readonly ModId[]): void {
    this.holdingGun = isGun(hand);
    this.figure.setOutfit(worn, hand, dirt, tint, handMods);
    this.dirty = true;
  }

  setAppearance(a: Appearance, classId?: string): void {
    this.figure.setAppearance(a, classId ?? null);
    this.height = a.height / 100;
    this.dirty = true;
  }

  /** Start rendering (screen opened). The WebGL context is created the first time. */
  start(): void {
    if (this.active) return;
    this.active = true;
    this.dirty = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.dragX = null;
    this.spin = 0;
  }

  dispose(): void {
    this.stop();
    this.figure.dispose();
    this.renderer?.dispose();
  }

  private readonly frame = (now: number): void => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.dragX === null && Math.abs(this.spin) > 0.01) {
      this.yaw += this.spin * dt;
      this.spin *= Math.exp(-SPIN_DAMPING * dt);
      this.dirty = true;
    }
    if (!this.ensureRenderer()) return;
    if (!this.dirty) return;
    this.dirty = false;
    this.figure.root.rotation.set(0, this.yaw, 0);
    this.renderer!.render(this.scene, this.camera);
  };

  private ensureRenderer(): boolean {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    if (!this.renderer) {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.setClearColor(0x000000, 0);
    }
    // Small canvas: a little supersampling on 1× screens keeps the figure crisp for almost nothing.
    const pr = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 2);
    if (
      this.canvas.width !== Math.round(w * pr) ||
      this.canvas.height !== Math.round(h * pr) ||
      this.camera.userData.h !== this.height ||
      this.camera.userData.gun !== this.holdingGun
    ) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // Level camera at mid-body; distance chosen so head, aimed weapon + suppressor, and shoes fit the canvas.
      const mid = this.height / 2;
      const fit = (FRAME_HEIGHT * (this.height / 1.76)) / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
      const fitW = fit / Math.min(1, this.camera.aspect / (this.holdingGun ? 0.66 : 0.45));
      this.camera.position.set(0, mid, Math.max(fit, fitW));
      this.camera.lookAt(0, mid, 0);
      this.camera.userData.h = this.height;
      this.camera.userData.gun = this.holdingGun;
      this.camera.updateProjectionMatrix();
      this.dirty = true;
    }
    return true;
  }
}
