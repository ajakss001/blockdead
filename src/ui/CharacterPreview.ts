import {
  BoxGeometry,
  type BufferGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  type Material,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  WebGLRenderer,
} from 'three';
import { type ItemId, ITEMS } from '../data/items';
import { BodyModel } from '../player/BodyModel';
import { outfitFrom, SKIN } from '../player/outfit';
import { limbDown } from '../render/lowpoly';
import { characterMaterial } from '../render/look/materials';
import type { Worn } from '../systems/Inventory';

const HAIR = 0x2e241c;
const UNDERSHIRT = 0x8a8a82;
const SHOULDER_Y = 1.42;
const HIP_Y = 0.92;
/** Drag: radians per CSS pixel; spin keeps a little inertia after release. */
const DRAG_SPEED = 0.012;
const SPIN_DAMPING = 5;

/**
 * Tarkov-style 3D figure for the inventory: the survivor in exactly what they wear, turned by
 * dragging (mouse or finger). Legs and shoes are the first-person BodyModel itself; torso, arms,
 * head, hats and the held weapon are simple low-poly parts in the same grungy materials.
 *
 * Cost: its own small canvas and WebGL context, created on the first opening; it renders only while
 * the inventory is open and only when something changed (rotation, clothes).
 */
export class CharacterPreview {
  readonly canvas = document.createElement('canvas');
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 0.5, 0.1, 20);
  private readonly figure = new Group();
  private readonly body = new BodyModel();
  private readonly geometries: BufferGeometry[] = [];
  private readonly torso: Mesh;
  private readonly upperArms: Mesh[] = [];
  private readonly forearms: Mesh[] = [];
  private readonly hats = new Map<ItemId, Group>();
  private readonly held = new Map<ItemId, Group>();
  /** The body faces −Z; start turned three-quarters towards the camera. */
  private yaw = Math.PI - 0.5;
  private spin = 0;
  private dragX: number | null = null;
  private active = false;
  private dirty = true;
  private raf = 0;
  private last = 0;

  constructor() {
    this.canvas.className = 'inv__doll';
    this.canvas.style.touchAction = 'none';
    this.scene.add(new HemisphereLight(0xc8ccd8, 0x2a2622, 1.6));
    const key = new DirectionalLight(0xfff2dc, 2.2);
    key.position.set(1.5, 2.5, 2.5);
    const rim = new DirectionalLight(0x8aa0c8, 1.2);
    rim.position.set(-2, 1.5, -2);
    this.scene.add(key, rim, this.figure);
    this.camera.position.set(0, 1.0, 4.6);
    this.camera.lookAt(0, 0.9, 0);

    // Legs + anatomical shoes: the same model the player sees looking down.
    this.body.update(0, 0, 0, 0, 0, 0, 0);
    this.body.root.position.set(0, 0, 0);
    this.figure.add(this.body.root);

    const skin = characterMaterial('skin', SKIN);
    // Torso: a tapered 8-sided trunk, flattened front to back.
    const torsoGeo = this.geo(new CylinderGeometry(0.2, 0.16, SHOULDER_Y - HIP_Y + 0.08, 8));
    torsoGeo.scale(1, 1, 0.62);
    this.torso = new Mesh(torsoGeo, skin);
    this.torso.position.y = (SHOULDER_Y + HIP_Y) / 2;
    this.figure.add(this.torso);

    // Arms hang at the sides, slightly out; elbows soft.
    const upperGeo = this.geo(limbDown(0.055, 0.047, 0.3));
    const foreGeo = this.geo(limbDown(0.046, 0.04, 0.27));
    const handGeo = this.geo(new BoxGeometry(0.05, 0.09, 0.08));
    handGeo.translate(0, -0.045, 0);
    for (const side of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(side * 0.235, SHOULDER_Y - 0.03, 0);
      shoulder.rotation.z = side * 0.12;
      const upper = new Mesh(upperGeo, skin);
      const elbow = new Group();
      elbow.position.y = -0.3;
      elbow.rotation.x = 0.15;
      const fore = new Mesh(foreGeo, skin);
      const hand = new Group();
      hand.position.y = -0.27;
      hand.add(new Mesh(handGeo, skin));
      elbow.add(fore, hand);
      shoulder.add(upper, elbow);
      this.figure.add(shoulder);
      this.upperArms.push(upper);
      this.forearms.push(fore);
      if (side > 0) this.buildHeld(hand);
    }

    // Neck, head, hair.
    const neck = new Mesh(this.geo(new CylinderGeometry(0.055, 0.06, 0.1, 8)), skin);
    neck.position.y = SHOULDER_Y + 0.07;
    const head = new Mesh(this.geo(new IcosahedronGeometry(0.115, 1)), skin);
    head.scale.set(0.9, 1.08, 1);
    head.position.y = SHOULDER_Y + 0.23;
    const hairGeo = this.geo(new SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.45));
    const hair = new Mesh(hairGeo, characterMaterial('jeans', HAIR));
    hair.position.y = SHOULDER_Y + 0.25;
    hair.scale.set(0.95, 1.05, 1.05);
    this.figure.add(neck, head, hair);
    this.buildHats(SHOULDER_Y + 0.25);

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

  /** Dress the figure; cheap to call on every inventory redraw (only changed materials swap). */
  setOutfit(worn: Worn, hand: ItemId | null): void {
    const outfit = outfitFrom(worn);
    this.body.setOutfit(outfit);
    const skin = characterMaterial('skin', SKIN);
    const torsoItem = worn.torso ? ITEMS[worn.torso].wear! : null;
    const top = characterMaterial('jacket', torsoItem ? torsoItem.color : UNDERSHIRT);
    this.torso.material = top;
    // Sleeves: long ones cover both arm segments, a T-shirt only the upper arm, nothing = bare.
    for (const m of this.upperArms) m.material = torsoItem ? top : skin;
    for (const m of this.forearms) m.material = outfit.sleeves !== null ? characterMaterial('jacket', outfit.sleeves) : skin;
    for (const [id, g] of this.hats) g.visible = worn.head === id;
    for (const [id, g] of this.held) g.visible = hand === id;
    this.dirty = true;
  }

  /** Start rendering (inventory opened). The WebGL context is created the first time. */
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
    if (!this.dirty) return;
    if (!this.ensureRenderer()) return;
    this.dirty = false;
    this.figure.rotation.y = this.yaw;
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
    if (this.canvas.width !== Math.round(w * pr) || this.canvas.height !== Math.round(h * pr)) {
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }

  /** Placeholder hats: a cap with a brim, a knit beanie, a hard hat with a rim. */
  private buildHats(y: number): void {
    const make = (id: ItemId, build: (g: Group, m: Material) => void) => {
      const g = new Group();
      g.position.y = y;
      build(g, characterMaterial('cuff', ITEMS[id].wear!.color));
      g.visible = false;
      this.figure.add(g);
      this.hats.set(id, g);
    };
    const dome = this.geo(new SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    make('cap', (g, m) => {
      g.add(new Mesh(dome, m));
      const brim = new Mesh(this.geo(new BoxGeometry(0.17, 0.012, 0.11)), m);
      brim.position.set(0, 0.005, -0.15);
      g.add(brim);
    });
    make('beanie', (g, m) => {
      const hat = new Mesh(dome, m);
      hat.scale.set(1.04, 1.25, 1.04);
      const fold = new Mesh(this.geo(new CylinderGeometry(0.135, 0.135, 0.05, 10)), m);
      g.add(hat, fold);
    });
    make('hardhat', (g, m) => {
      const hat = new Mesh(dome, m);
      hat.scale.set(1.12, 1.05, 1.15);
      const rim = new Mesh(this.geo(new CylinderGeometry(0.17, 0.17, 0.015, 12)), m);
      g.add(hat, rim);
    });
  }

  /** Placeholder weapons in the right hand. */
  private buildHeld(hand: Group): void {
    const wood = characterMaterial('handle', 0x6e5034);
    const steel = characterMaterial('torch', 0x5a5e62);
    const make = (id: ItemId, parts: [BufferGeometry, Material, number, number][]) => {
      const g = new Group();
      for (const [geo, mat, y, z] of parts) {
        const m = new Mesh(geo, mat);
        m.position.set(0, y, z);
        g.add(m);
      }
      g.position.y = -0.06;
      g.visible = false;
      hand.add(g);
      this.held.set(id, g);
    };
    const stick = (r: number, len: number) => this.geo(new CylinderGeometry(r, r, len, 6));
    make('knife', [
      [this.geo(new BoxGeometry(0.025, 0.1, 0.03)), wood, 0, 0],
      [this.geo(new BoxGeometry(0.008, 0.16, 0.03)), steel, -0.13, 0],
    ]);
    make('axe', [
      [stick(0.014, 0.6), characterMaterial('handle', 0x8a3a24), -0.15, 0],
      [this.geo(new BoxGeometry(0.014, 0.08, 0.14)), steel, -0.43, 0.04],
    ]);
    make('bat', [[this.geo(new CylinderGeometry(0.035, 0.016, 0.65, 8)), wood, -0.24, 0]]);
    make('crowbar', [[stick(0.01, 0.55), steel, -0.2, 0]]);
    make('hammer', [
      [stick(0.012, 0.3), wood, -0.1, 0],
      [this.geo(new BoxGeometry(0.03, 0.03, 0.11)), steel, -0.25, 0],
    ]);
  }

  dispose(): void {
    this.stop();
    for (const g of this.geometries) g.dispose();
    this.body.dispose();
    this.renderer?.dispose();
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }
}
