import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PointLight,
  Quaternion,
  type Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { sfx } from '../audio/Sound';
import { grim } from '../style/palette';

/**
 * What a shot leaves in the world: the muzzle flash (a sprite on the gun in the hands and a light in the
 * world, one frame), spent cases flying out of the port and tinkling on the floor, the magazines dropped
 * from empty (they stay where they fell), the RPG's flash. Cases and magazines are simple bodies: thrown,
 * falling, bouncing on the floor, at rest for good; the oldest go first past the cap. Paused: nothing moves.
 */

const CASES = 60;
const MAGS = 24;
const G = 9.8;

interface Body {
  active: boolean;
  pos: Vector3;
  vel: Vector3;
  q: Quaternion;
  spin: Vector3;
  floor: number;
  rest: boolean;
  bounced: boolean;
  shell: boolean;
}

function makePool(n: number): Body[] {
  const list: Body[] = [];
  for (let i = 0; i < n; i++) {
    list.push({
      active: false,
      pos: new Vector3(),
      vel: new Vector3(),
      q: new Quaternion(),
      spin: new Vector3(),
      floor: 0,
      rest: true,
      bounced: true,
      shell: false,
    });
  }
  return list;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _v = new Vector3();

function flashTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  // Not a toy-bright yellow: a short warm flare fading to nothing.
  grad.addColorStop(0, 'rgba(255,236,200,1)');
  grad.addColorStop(0.25, 'rgba(240,190,120,0.75)');
  grad.addColorStop(0.6, 'rgba(160,110,60,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // A few prongs.
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,220,170,0.5)';
  g.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
    g.stroke();
  }
  return new CanvasTexture(c);
}

export class GunFx {
  /** The flash on the gun (a child of its muzzle, in the arms' scene). */
  readonly flash: Sprite;
  /** The flash's light in the world, 0 between shots (always in the scene: no shader rebuild). */
  readonly light = new PointLight(0xffc890, 0, 9, 2);
  private flashFrames = 0;
  private readonly cases: Body[] = makePool(CASES);
  private readonly mags: Body[] = makePool(MAGS);
  private caseCursor = 0;
  private magCursor = 0;
  private readonly caseMesh: InstancedMesh;
  private readonly shellMesh: InstancedMesh;
  private readonly magMesh: InstancedMesh;
  /** Where the floor is under a point (the scene's). */
  groundY: (x: number, y: number, z: number) => number = () => 0;

  constructor(scene: Scene) {
    const tex = flashTexture();
    this.flash = new Sprite(new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.scale.set(0.12, 0.12, 0.12);
    this.flash.visible = false;
    this.flash.renderOrder = 5;
    const brass = new MeshLambertMaterial({ color: grim(0x8a7444) });
    const hull = new MeshLambertMaterial({ color: grim(0x5a3a30) });
    const steel = new MeshLambertMaterial({ color: grim(0x34363a) });
    this.caseMesh = new InstancedMesh(new CylinderGeometry(0.0045, 0.0045, 0.022, 6), brass, CASES);
    this.shellMesh = new InstancedMesh(new CylinderGeometry(0.0105, 0.0105, 0.065, 8), hull, CASES);
    this.magMesh = new InstancedMesh(new BoxGeometry(0.03, 0.17, 0.065), steel, MAGS);
    for (const m of [this.caseMesh, this.shellMesh, this.magMesh]) {
      m.count = 0;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.frustumCulled = false;
      m.name = 'gunfx';
      scene.add(m);
    }
    scene.add(this.light);
  }

  /** A shot this frame: the flash on the gun and in the world at `muzzleWorld`. */
  muzzleFlash(muzzleWorld: Vector3, big = 1): void {
    this.flashFrames = 1;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = (0.08 + Math.random() * 0.05) * big;
    this.flash.scale.set(s, s, s);
    this.light.position.copy(muzzleWorld);
    this.light.intensity = 2.2 * big;
  }

  /** Suppressed: no flash to speak of. */
  noFlash(): void {
    this.flashFrames = 0;
    this.flash.visible = false;
    this.light.intensity = 0;
  }

  /** A case thrown out of the port (world), to the right and up, spinning. */
  eject(at: Vector3, right: Vector3, up: Vector3, shell: boolean): void {
    const b = this.cases[this.caseCursor];
    this.caseCursor = (this.caseCursor + 1) % CASES;
    b.active = true;
    b.pos.copy(at);
    b.vel.copy(right).multiplyScalar(1.6 + Math.random() * 0.8).addScaledVector(up, 1.2 + Math.random() * 0.8);
    b.q.setFromAxisAngle(_v.set(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6);
    b.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    b.floor = this.groundY(at.x, at.y, at.z);
    b.rest = false;
    b.bounced = false;
    b.shell = shell;
  }

  /** The empty magazine let go: it falls straight down out of the well. */
  dropMag(at: Vector3, q: Quaternion, vel: Vector3): void {
    const b = this.mags[this.magCursor];
    this.magCursor = (this.magCursor + 1) % MAGS;
    b.active = true;
    b.pos.copy(at);
    b.vel.copy(vel);
    b.q.copy(q);
    b.spin.set((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 4);
    b.floor = this.groundY(at.x, at.y, at.z);
    b.rest = false;
    b.bounced = false;
    b.shell = false;
  }

  update(dt: number): void {
    // The flash lasts one frame.
    if (this.flashFrames > 0) this.flashFrames--;
    else if (this.flash.visible || this.light.intensity > 0) {
      this.flash.visible = false;
      this.light.intensity = 0;
    }
    if (dt <= 0) return;
    this.step(this.cases, dt, 0.005, () => {});
    this.step(this.mags, dt, 0.015, (b) => sfx.magDrop(b.pos));
    this.writeCases();
    this.writeMags();
  }

  private step(list: Body[], dt: number, lift: number, land: (b: Body) => void): void {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || b.rest) continue;
      b.vel.y -= G * dt;
      b.pos.addScaledVector(b.vel, dt);
      _q.setFromAxisAngle(_v.copy(b.spin).normalize(), b.spin.length() * dt);
      b.q.premultiply(_q);
      if (b.pos.y <= b.floor + lift) {
        b.pos.y = b.floor + lift;
        if (!b.bounced) land(b);
        b.bounced = true;
        if (Math.abs(b.vel.y) < 0.6) {
          // At rest, lying on its side.
          b.rest = true;
          b.vel.set(0, 0, 0);
          const yaw = Math.random() * Math.PI * 2;
          b.q.setFromAxisAngle(_v.set(Math.cos(yaw), 0, Math.sin(yaw)), Math.PI / 2);
        } else {
          b.vel.y = -b.vel.y * 0.35;
          b.vel.x *= 0.5;
          b.vel.z *= 0.5;
          b.spin.multiplyScalar(0.5);
        }
      }
    }
  }

  private writeCases(): void {
    let cIdx = 0;
    let sIdx = 0;
    for (let i = 0; i < this.cases.length; i++) {
      const b = this.cases[i];
      if (!b.active) continue;
      if (b.shell) this.shellMesh.setMatrixAt(sIdx++, _m.compose(b.pos, b.q, _s));
      else this.caseMesh.setMatrixAt(cIdx++, _m.compose(b.pos, b.q, _s));
    }
    this.caseMesh.count = cIdx;
    this.caseMesh.instanceMatrix.needsUpdate = true;
    this.shellMesh.count = sIdx;
    this.shellMesh.instanceMatrix.needsUpdate = true;
  }

  private writeMags(): void {
    let idx = 0;
    for (let i = 0; i < this.mags.length; i++) {
      const b = this.mags[i];
      if (!b.active) continue;
      this.magMesh.setMatrixAt(idx++, _m.compose(b.pos, b.q, _s));
    }
    this.magMesh.count = idx;
    this.magMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.caseMesh, this.shellMesh, this.magMesh]) {
      m.geometry.dispose();
      (m.material as MeshLambertMaterial).dispose();
      m.removeFromParent();
    }
    this.flash.material.map?.dispose();
    this.flash.material.dispose();
    this.light.removeFromParent();
  }
}
