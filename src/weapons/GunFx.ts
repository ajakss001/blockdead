import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  type Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { sfx } from '../audio/Sound';
import { grim } from '../style/palette';

const CASES = 60;
const MAGS = 24;
const MAX_HOLES = 96;
const MAX_TRACERS = 16;
const G = 9.8;

export type BulletHoleKind = 'wood' | 'metal' | 'stone' | 'glass';

interface RicochetTracer {
  pos: Vector3;
  q: Quaternion;
  len: number;
  life: number;
  maxLife: number;
}

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

interface HolePool {
  mesh: InstancedMesh;
  cursor: number;
  filled: number;
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
const _qSpin = new Quaternion();
const _s = new Vector3(1, 1, 1);
const _v = new Vector3();
const _n = new Vector3();
const _zAxis = new Vector3(0, 0, 1);
const _tinyMat = new Matrix4().compose(new Vector3(0, -50, 0), new Quaternion(), new Vector3(0.0001, 0.0001, 0.0001));

function flashTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,236,200,1)');
  grad.addColorStop(0.25, 'rgba(240,190,120,0.75)');
  grad.addColorStop(0.6, 'rgba(160,110,60,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
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

function holeTexture(kind: BulletHoleKind): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, 64, 64);

  if (kind === 'glass') {
    g.strokeStyle = 'rgba(215,235,245,0.78)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + (i % 2) * 0.17;
      const len = 14 + (i % 3) * 6;
      g.beginPath();
      g.moveTo(32 + Math.cos(a) * 5, 32 + Math.sin(a) * 5);
      g.lineTo(32 + Math.cos(a) * len, 32 + Math.sin(a) * len);
      g.stroke();
    }
    g.beginPath();
    g.arc(32, 32, 11, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = 'rgba(12,18,22,0.85)';
    g.beginPath();
    g.arc(32, 32, 5.5, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'metal') {
    const rim = g.createRadialGradient(32, 32, 3, 32, 32, 17);
    rim.addColorStop(0, 'rgba(8,9,11,0.96)');
    rim.addColorStop(0.45, 'rgba(130,136,145,0.78)');
    rim.addColorStop(0.75, 'rgba(42,45,50,0.45)');
    rim.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rim;
    g.beginPath();
    g.arc(32, 32, 17, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(4,5,6,0.98)';
    g.beginPath();
    g.arc(32, 32, 6, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'wood') {
    g.fillStyle = 'rgba(72,48,28,0.65)';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.beginPath();
      g.ellipse(32 + Math.cos(a) * 8, 32 + Math.sin(a) * 4, 8, 2.2, a * 0.25, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(16,11,7,0.96)';
    g.beginPath();
    g.arc(32, 32, 6.5, 0, Math.PI * 2);
    g.fill();
  } else {
    const crater = g.createRadialGradient(32, 32, 4, 32, 32, 20);
    crater.addColorStop(0, 'rgba(14,14,15,0.96)');
    crater.addColorStop(0.42, 'rgba(92,90,85,0.72)');
    crater.addColorStop(0.78, 'rgba(48,46,44,0.32)');
    crater.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = crater;
    g.beginPath();
    g.arc(32, 32, 20, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(10,10,11,0.98)';
    g.beginPath();
    g.arc(32, 32, 6.2, 0, Math.PI * 2);
    g.fill();
  }
  return new CanvasTexture(c);
}

/**
 * Pooled weapon effects: muzzle flash sprite + light, spent cases/shells, empty magazines,
 * and pre-allocated bullet-hole decal pools (zero runtime shader/material/geometry allocations).
 */
export class GunFx {
  readonly flash: Sprite;
  readonly light = new PointLight(0xffc890, 0, 9, 2);
  private flashFrames = 0;
  private prewarming = false;
  private readonly cases: Body[] = makePool(CASES);
  private readonly mags: Body[] = makePool(MAGS);
  private caseCursor = 0;
  private magCursor = 0;
  private readonly caseMesh: InstancedMesh;
  private readonly shellMesh: InstancedMesh;
  private readonly magMesh: InstancedMesh;
  private readonly holeGeo = new PlaneGeometry(0.14, 0.14);
  private readonly holes: Record<BulletHoleKind, HolePool>;
  private readonly glassHolePos = new Float32Array(MAX_HOLES * 3);
  private readonly glassHoleActive = new Uint8Array(MAX_HOLES);
  private readonly tracers: RicochetTracer[] = Array.from({ length: MAX_TRACERS }, () => ({
    pos: new Vector3(),
    q: new Quaternion(),
    len: 0,
    life: 0,
    maxLife: 0.095,
  }));
  private tracerCursor = 0;
  private readonly tracerGeo = new BoxGeometry(0.018, 0.018, 1);
  private readonly tracerMat: MeshBasicMaterial;
  private readonly tracerMesh: InstancedMesh;
  groundY: (x: number, y: number, z: number) => number = () => 0;

  constructor(scene: Scene) {
    const tex = flashTexture();
    this.flash = new Sprite(
      new SpriteMaterial({ map: tex, blending: AdditiveBlending, depthWrite: false, transparent: true }),
    );
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

    const makeHolePool = (kind: BulletHoleKind): HolePool => {
      const mat = new MeshBasicMaterial({
        map: holeTexture(kind),
        transparent: true,
        alphaTest: 0.04,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new InstancedMesh(this.holeGeo, mat, MAX_HOLES);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 3;
      mesh.name = `bullethole:${kind}`;
      scene.add(mesh);
      return { mesh, cursor: 0, filled: 0 };
    };
    this.holes = {
      wood: makeHolePool('wood'),
      metal: makeHolePool('metal'),
      stone: makeHolePool('stone'),
      glass: makeHolePool('glass'),
    };
    this.tracerMat = new MeshBasicMaterial({
      color: 0xffd880,
      transparent: true,
      opacity: 0.9,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.tracerMesh = new InstancedMesh(this.tracerGeo, this.tracerMat, MAX_TRACERS);
    this.tracerMesh.count = 0;
    this.tracerMesh.visible = false;
    this.tracerMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.castShadow = false;
    this.tracerMesh.receiveShadow = false;
    this.tracerMesh.renderOrder = 4;
    this.tracerMesh.name = 'gunfx:tracers';
    scene.add(this.tracerMesh);
    scene.add(this.light);
  }

  /** Pre-compile all GunFx & bullet-hole decal shaders before gameplay begins (prevents prog spikes on first shot). */
  prewarm(vmScene: Scene): () => void {
    this.prewarming = true;
    const prevParent = this.flash.parent;
    if (!prevParent) {
      this.flash.position.set(0, 0, -0.5);
      vmScene.add(this.flash);
    }
    this.keepPrewarmVisible();
    return () => {
      this.prewarming = false;
      this.flash.visible = false;
      if (!prevParent && this.flash.parent === vmScene) vmScene.remove(this.flash);
      this.flash.position.set(0, 0, 0);
      this.writeCases();
      this.writeMags();
      this.writeTracers();
      for (const hp of Object.values(this.holes)) {
        hp.mesh.count = hp.filled;
        hp.mesh.instanceMatrix.needsUpdate = true;
      }
    };
  }

  /** Keep all GunFx meshes and muzzle sprite visible during boot prewarm render passes. */
  keepPrewarmVisible(): void {
    this.flash.visible = true;
    for (const m of [this.caseMesh, this.shellMesh, this.magMesh]) {
      if (m.count === 0) {
        m.setMatrixAt(0, _tinyMat);
        m.instanceMatrix.needsUpdate = true;
        m.count = 1;
      }
      m.visible = true;
    }
    if (this.tracerMesh.count === 0) {
      this.tracerMesh.setMatrixAt(0, _tinyMat);
      this.tracerMesh.instanceMatrix.needsUpdate = true;
      this.tracerMesh.count = 1;
    }
    this.tracerMesh.visible = true;
    for (const hp of Object.values(this.holes)) {
      if (hp.mesh.count === 0) {
        hp.mesh.setMatrixAt(0, _tinyMat);
        hp.mesh.instanceMatrix.needsUpdate = true;
        hp.mesh.count = 1;
      }
      hp.mesh.visible = true;
    }
  }

  /** Record a bright ricochet tracer streak in the pooled instanced mesh (zero runtime allocations). */
  addRicochetTracer(from: Vector3, to: Vector3): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.05) return;
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    t.pos.set((from.x + to.x) * 0.5, (from.y + to.y) * 0.5, (from.z + to.z) * 0.5);
    _n.set(dx / len, dy / len, dz / len);
    t.q.setFromUnitVectors(_zAxis, _n);
    t.len = len;
    t.life = 0.095;
    t.maxLife = 0.095;
    if (!this.prewarming) this.writeTracers();
  }

  /** Stamp a pooled bullet hole decal onto geometry along its surface normal (zero allocations). */
  addBulletHole(pos: Vector3, normal: Vector3, kind: BulletHoleKind): void {
    const pool = this.holes[kind];
    _n.copy(normal);
    if (_n.lengthSq() < 1e-4) _n.set(0, 0, 1);
    else _n.normalize();
    _q.setFromUnitVectors(_zAxis, _n);
    _qSpin.setFromAxisAngle(_n, Math.random() * Math.PI * 2);
    _q.premultiply(_qSpin);
    const sc = 0.85 + Math.random() * 0.35;
    _s.set(sc, sc, 1);
    _v.copy(pos).addScaledVector(_n, 0.008);
    _m.compose(_v, _q, _s);
    const idx = pool.cursor;
    if (kind === 'glass') {
      this.glassHolePos[idx * 3] = _v.x;
      this.glassHolePos[idx * 3 + 1] = _v.y;
      this.glassHolePos[idx * 3 + 2] = _v.z;
      this.glassHoleActive[idx] = 1;
    }
    pool.mesh.setMatrixAt(idx, _m);
    pool.cursor = (idx + 1) % MAX_HOLES;
    if (pool.filled < MAX_HOLES) pool.filled++;
    pool.mesh.count = pool.filled;
    pool.mesh.instanceMatrix.needsUpdate = true;
    _s.set(1, 1, 1);
  }

  /** Hide pooled glass bullet-hole decals inside a shattered window/door box so decals never float in open air. */
  clearGlassHolesInBox(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
    const pool = this.holes.glass;
    let changed = false;
    for (let i = 0; i < pool.filled; i++) {
      if (!this.glassHoleActive[i]) continue;
      const i3 = i * 3;
      if (
        Math.abs(this.glassHolePos[i3] - cx) <= hx &&
        Math.abs(this.glassHolePos[i3 + 1] - cy) <= hy &&
        Math.abs(this.glassHolePos[i3 + 2] - cz) <= hz
      ) {
        this.glassHoleActive[i] = 0;
        pool.mesh.setMatrixAt(i, _tinyMat);
        changed = true;
      }
    }
    if (changed) pool.mesh.instanceMatrix.needsUpdate = true;
  }

  muzzleFlash(muzzleWorld: Vector3, big = 1): void {
    this.flashFrames = 1;
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = (0.08 + Math.random() * 0.05) * big;
    this.flash.scale.set(s, s, s);
    this.light.position.copy(muzzleWorld);
    this.light.intensity = 2.2 * big;
  }

  noFlash(): void {
    this.flashFrames = 0;
    if (!this.prewarming) this.flash.visible = false;
    this.light.intensity = 0;
  }

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
    if (!this.prewarming) {
      if (this.flashFrames > 0) this.flashFrames--;
      else if (this.flash.visible || this.light.intensity > 0) {
        this.flash.visible = false;
        this.light.intensity = 0;
      }
    }
    if (dt <= 0) return;
    this.step(this.cases, dt, 0.005, () => {});
    this.step(this.mags, dt, 0.015, (b) => sfx.magDrop(b.pos));
    let tracerDirty = false;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (t.life > 0) {
        t.life = Math.max(0, t.life - dt);
        tracerDirty = true;
      }
    }
    if (!this.prewarming) {
      this.writeCases();
      this.writeMags();
      if (tracerDirty) this.writeTracers();
    }
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

  private writeTracers(): void {
    let count = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      const k = t.life / t.maxLife;
      const w = 0.55 + 0.65 * k;
      _s.set(w, w, t.len);
      this.tracerMesh.setMatrixAt(count++, _m.compose(t.pos, t.q, _s));
    }
    _s.set(1, 1, 1);
    this.tracerMesh.count = count;
    this.tracerMesh.visible = count > 0;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const m of [this.caseMesh, this.shellMesh, this.magMesh]) {
      m.geometry.dispose();
      (m.material as MeshLambertMaterial).dispose();
      m.removeFromParent();
    }
    this.tracerGeo.dispose();
    this.tracerMat.dispose();
    this.tracerMesh.removeFromParent();
    this.holeGeo.dispose();
    for (const hp of Object.values(this.holes)) {
      const mat = hp.mesh.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.dispose();
      hp.mesh.removeFromParent();
    }
    this.flash.material.map?.dispose();
    this.flash.material.dispose();
    this.light.removeFromParent();
  }
}
