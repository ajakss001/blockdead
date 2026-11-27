import {
  BoxGeometry,
  CanvasTexture,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import type { CollisionWorld } from './CollisionWorld';

export const WINDOW_OWNER_BASE = 5e15;
const MAX_PANES = 4096;

export interface WindowPaneSpot {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
}

interface PaneEntry {
  owner: number;
  chunkKey: number;
  spot: WindowPaneSpot;
  /** 0 = intact, 1 = spiderweb cracked (penetrable & body-breakable), 2 = shattered (gone) */
  stage: 0 | 1 | 2;
}

const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _m = new Matrix4();

/** Build full-pane spiderweb fracture texture with pure transparent background (no dark backdrop). */
function buildFullPaneCrackCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  if (!g) return null;
  const S = 256;
  const cx = S * 0.5;
  const cy = S * 0.5;
  g.clearRect(0, 0, S, S);

  // Subtle corner frost accents along edges without any dark backing disc
  g.strokeStyle = 'rgba(238, 246, 255, 0.90)';
  const rays = 18;
  for (let i = 0; i < rays; i++) {
    const baseA = (i / rays) * Math.PI * 2 + Math.sin(i * 5.7) * 0.14;
    const maxLen = S * (0.44 + ((i * 29) % 7) * 0.025);
    g.lineWidth = i % 3 === 0 ? 2.1 : 1.3;
    g.beginPath();
    let px = cx + Math.cos(baseA) * 3;
    let py = cy + Math.sin(baseA) * 3;
    g.moveTo(px, py);
    for (let seg = 1; seg <= 4; seg++) {
      const t = seg / 4;
      const jit = Math.sin(i * 11.3 + seg * 4.1) * 0.12;
      const nx = cx + Math.cos(baseA + jit) * maxLen * t;
      const ny = cy + Math.sin(baseA + jit) * maxLen * t;
      g.lineTo(nx, ny);
      px = nx;
      py = ny;
    }
    g.stroke();

    // Secondary branching split near outer third
    if (i % 2 === 0) {
      g.lineWidth = 1.0;
      g.beginPath();
      const bx = cx + Math.cos(baseA) * maxLen * 0.56;
      const by = cy + Math.sin(baseA) * maxLen * 0.56;
      g.moveTo(bx, by);
      const bAng = baseA + (i % 4 === 0 ? 0.28 : -0.26);
      g.lineTo(bx + Math.cos(bAng) * (S * 0.18), by + Math.sin(bAng) * (S * 0.18));
      g.stroke();
    }
  }

  // Polygonal web rings spanning entire glass pane
  g.strokeStyle = 'rgba(220, 236, 248, 0.68)';
  for (const rad of [18, 38, 64, 94, 118]) {
    g.lineWidth = rad > 70 ? 1.0 : 1.25;
    g.beginPath();
    for (let i = 0; i <= rays; i++) {
      const idx = i % rays;
      const a = (idx / rays) * Math.PI * 2 + Math.sin(idx * 5.7) * 0.14;
      const rJit = rad * (0.9 + ((idx * 17 + rad) % 5) * 0.045);
      const x = cx + Math.cos(a) * rJit;
      const y = cy + Math.sin(a) * rJit;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  // Tiny center perforation without any large halo
  g.strokeStyle = 'rgba(245, 250, 255, 0.95)';
  g.lineWidth = 1.6;
  g.beginPath();
  g.arc(cx, cy, 5, 0, Math.PI * 2);
  g.stroke();
  return cv;
}

/**
 * Pooled instanced manager for destructible building window glass:
 * - Stage 0: intact translucent pane (bullets pass through with 8% attenuation and advance to Stage 1)
 * - Stage 1: full-pane spiderweb cracked glass (bullets pass through; body passage/jump or melee advances to Stage 2)
 * - Stage 2: completely removed (clean open window frame + collider removed)
 */
export class WindowPanes {
  private readonly byOwner = new Map<number, PaneEntry>();
  private readonly byChunk = new Map<number, number[]>();
  private nextId = 1;
  private dirty = false;

  private readonly geo = new BoxGeometry(1, 1, 1);
  private readonly intactMesh: InstancedMesh;
  private readonly crackedMesh: InstancedMesh;
  private readonly crackTex: CanvasTexture | null = null;
  private readonly intactMat: MeshStandardMaterial;
  private readonly crackedMat: MeshBasicMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly world: CollisionWorld,
  ) {
    this.intactMat = new MeshStandardMaterial({
      color: 0x6a7a84,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      roughness: 0.12,
      metalness: 0.15,
      side: DoubleSide,
    });
    const cv = buildFullPaneCrackCanvas();
    if (cv) {
      this.crackTex = new CanvasTexture(cv);
    }
    this.crackedMat = new MeshBasicMaterial({
      map: this.crackTex,
      color: 0xeaf4fc,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      alphaTest: 0.02,
      side: DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.intactMesh = new InstancedMesh(this.geo, this.intactMat, MAX_PANES);
    this.intactMesh.name = 'world:windowIntact';
    this.intactMesh.castShadow = false;
    this.intactMesh.receiveShadow = false;
    this.intactMesh.frustumCulled = false;
    this.intactMesh.count = 0;
    this.intactMesh.visible = false;

    this.crackedMesh = new InstancedMesh(this.geo, this.crackedMat, MAX_PANES);
    this.crackedMesh.name = 'world:windowCracked';
    this.crackedMesh.castShadow = false;
    this.crackedMesh.receiveShadow = false;
    this.crackedMesh.frustumCulled = false;
    this.crackedMesh.count = 0;
    this.crackedMesh.visible = false;

    this.scene.add(this.intactMesh, this.crackedMesh);
  }

  isWindowOwner(owner: number): boolean {
    return owner >= WINDOW_OWNER_BASE && this.byOwner.has(owner);
  }

  isCracked(owner: number): boolean {
    return this.byOwner.get(owner)?.stage === 1;
  }

  addChunk(chunkKey: number, spots: WindowPaneSpot[]): void {
    if (!spots || spots.length === 0) return;
    const owners: number[] = [];
    const prevOwner = this.world.owner;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const owner = WINDOW_OWNER_BASE + this.nextId++;
      owners.push(owner);
      this.byOwner.set(owner, { owner, chunkKey, spot: s, stage: 0 });
      this.world.owner = owner;
      this.world.addBox(s.cx - s.sx * 0.5, s.cz - s.sz * 0.5, s.cx + s.sx * 0.5, s.cz + s.sz * 0.5, s.cy - s.sy * 0.5, s.cy + s.sy * 0.5, true, false);
    }
    this.world.owner = prevOwner;
    this.byChunk.set(chunkKey, owners);
    this.dirty = true;
    this.sync();
  }

  removeChunk(chunkKey: number): void {
    const owners = this.byChunk.get(chunkKey);
    if (!owners) return;
    for (let i = 0; i < owners.length; i++) {
      const owner = owners[i];
      const entry = this.byOwner.get(owner);
      if (entry && entry.stage < 2) {
        this.world.removeOwner(owner);
      }
      this.byOwner.delete(owner);
    }
    this.byChunk.delete(chunkKey);
    this.dirty = true;
    this.sync();
  }

  /** Stage 0 -> Stage 1 on first bullet impact (remains cracked and passable/penetrable). */
  bulletHit(owner: number): { spot: WindowPaneSpot; newlyCracked: boolean; stage: 1 } | null {
    const entry = this.byOwner.get(owner);
    if (!entry || entry.stage >= 2) return null;
    const newlyCracked = entry.stage === 0;
    if (newlyCracked) {
      entry.stage = 1;
      this.dirty = true;
      this.sync();
    }
    return { spot: entry.spot, newlyCracked, stage: 1 };
  }

  /** Stage 0/1 -> Stage 2: completely removes pane visual & collider. */
  shatter(owner: number): WindowPaneSpot | null {
    const entry = this.byOwner.get(owner);
    if (!entry || entry.stage >= 2) return null;
    entry.stage = 2;
    this.world.removeOwner(owner);
    this.dirty = true;
    this.sync();
    return entry.spot;
  }

  /** Shatters any Stage 1 spiderweb-cracked panes touched by a moving body cylinder (player/bot). */
  shatterCrackedNear(x: number, y: number, z: number, radius: number, height = 1.75): WindowPaneSpot[] {
    const broken: WindowPaneSpot[] = [];
    for (const entry of this.byOwner.values()) {
      if (entry.stage !== 1) continue;
      const s = entry.spot;
      if (y + height < s.cy - s.sy * 0.5 || y > s.cy + s.sy * 0.5) continue;
      const hx = Math.max(0.16, s.sx * 0.5) + radius + 0.14;
      const hz = Math.max(0.16, s.sz * 0.5) + radius + 0.14;
      if (Math.abs(x - s.cx) <= hx && Math.abs(z - s.cz) <= hz) {
        entry.stage = 2;
        this.world.removeOwner(entry.owner);
        broken.push(s);
        this.dirty = true;
      }
    }
    if (broken.length > 0) this.sync();
    return broken;
  }

  private sync(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let i0 = 0;
    let i1 = 0;
    for (const entry of this.byOwner.values()) {
      if (entry.stage >= 2) continue;
      const s = entry.spot;
      // Cracked Stage 1 gets tiny 2mm depth thickness on thin panes so both sides render crisp web lines
      const sx = s.sx < 0.06 && entry.stage === 1 ? 0.025 : s.sx;
      const sz = s.sz < 0.06 && entry.stage === 1 ? 0.025 : s.sz;
      _m.compose(_p.set(s.cx, s.cy, s.cz), _q.identity(), _s.set(sx, s.sy, sz));
      if (entry.stage === 0) {
        if (i0 < MAX_PANES) this.intactMesh.setMatrixAt(i0++, _m);
      } else {
        if (i1 < MAX_PANES) this.crackedMesh.setMatrixAt(i1++, _m);
      }
    }
    this.intactMesh.count = i0;
    this.intactMesh.visible = i0 > 0;
    this.intactMesh.instanceMatrix.needsUpdate = true;

    this.crackedMesh.count = i1;
    this.crackedMesh.visible = i1 > 0;
    this.crackedMesh.instanceMatrix.needsUpdate = true;
  }

  prewarm(): () => void {
    const prev0 = this.intactMesh.count;
    const prev1 = this.crackedMesh.count;
    const prevV0 = this.intactMesh.visible;
    const prevV1 = this.crackedMesh.visible;
    _m.compose(_p.set(0, -500, 0), _q.identity(), _s.set(0.01, 0.01, 0.01));
    if (prev0 === 0) {
      this.intactMesh.setMatrixAt(0, _m);
      this.intactMesh.count = 1;
      this.intactMesh.instanceMatrix.needsUpdate = true;
    }
    if (prev1 === 0) {
      this.crackedMesh.setMatrixAt(0, _m);
      this.crackedMesh.count = 1;
      this.crackedMesh.instanceMatrix.needsUpdate = true;
    }
    this.intactMesh.visible = true;
    this.crackedMesh.visible = true;
    return () => {
      this.intactMesh.count = prev0;
      this.crackedMesh.count = prev1;
      this.intactMesh.visible = prevV0;
      this.crackedMesh.visible = prevV1;
    };
  }

  dispose(): void {
    this.geo.dispose();
    this.intactMat.dispose();
    this.crackedMat.dispose();
    this.crackTex?.dispose();
    this.intactMesh.removeFromParent();
    this.crackedMesh.removeFromParent();
  }
}
